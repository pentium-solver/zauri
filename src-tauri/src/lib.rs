mod lsp;

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::CString;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::Emitter;

// FFI bindings to Zig backend
extern "C" {
    fn zauri_init();
    fn zauri_read_file(path: *const i8, buf: *mut u8, buf_len: u32, bytes_read: *mut u32) -> i32;
    fn zauri_write_file(path: *const i8, data: *const u8, data_len: u32) -> i32;
    fn zauri_list_dir(path: *const i8, buf: *mut u8, buf_len: u32, bytes_written: *mut u32) -> i32;
    fn zauri_search(
        root_path: *const i8,
        query: *const i8,
        buf: *mut u8,
        buf_len: u32,
        bytes_written: *mut u32,
    ) -> i32;
}

#[derive(Serialize, Deserialize)]
struct DirEntry {
    name: String,
    is_dir: bool,
}

#[derive(Serialize, Deserialize)]
struct SearchMatch {
    file: String,
    line: u32,
    col: u32,
    text: String,
}

// Buffer size for file operations (10MB)
const BUF_SIZE: u32 = 10 * 1024 * 1024;
// Buffer size for directory listing and search (1MB)
const LIST_BUF_SIZE: u32 = 1024 * 1024;

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let start = Instant::now();
    let c_path = CString::new(path.clone()).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; BUF_SIZE as usize];
    let mut bytes_read: u32 = 0;

    let result = unsafe {
        zauri_read_file(
            c_path.as_ptr(),
            buf.as_mut_ptr(),
            BUF_SIZE,
            &mut bytes_read,
        )
    };

    if result != 0 {
        return Err(format!("Failed to read file '{}': error code {}", path, result));
    }

    let content = String::from_utf8_lossy(&buf[..bytes_read as usize]).to_string();
    let duration = start.elapsed().as_secs_f64() * 1000.0;
    eprintln!("[perf] read_file({}) = {:.2}ms ({} bytes)", path, duration, bytes_read);

    Ok(content)
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let start = Instant::now();
    let c_path = CString::new(path.clone()).map_err(|e| e.to_string())?;
    let data = content.as_bytes();

    let result = unsafe { zauri_write_file(c_path.as_ptr(), data.as_ptr(), data.len() as u32) };

    if result != 0 {
        return Err(format!("Failed to write file '{}': error code {}", path, result));
    }

    let duration = start.elapsed().as_secs_f64() * 1000.0;
    eprintln!("[perf] write_file({}) = {:.2}ms ({} bytes)", path, duration, data.len());

    Ok(())
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let start = Instant::now();
    let c_path = CString::new(path.clone()).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; LIST_BUF_SIZE as usize];
    let mut bytes_written: u32 = 0;

    let result = unsafe {
        zauri_list_dir(
            c_path.as_ptr(),
            buf.as_mut_ptr(),
            LIST_BUF_SIZE,
            &mut bytes_written,
        )
    };

    if result != 0 {
        return Err(format!("Failed to list directory '{}': error code {}", path, result));
    }

    let json_str = String::from_utf8_lossy(&buf[..bytes_written as usize]);
    let mut entries: Vec<DirEntry> =
        serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let duration = start.elapsed().as_secs_f64() * 1000.0;
    eprintln!(
        "[perf] list_directory({}) = {:.2}ms ({} entries)",
        path,
        duration,
        entries.len()
    );

    Ok(entries)
}

#[tauri::command]
fn search_files(root_path: String, query: String) -> Result<Vec<SearchMatch>, String> {
    let start = Instant::now();
    let c_root = CString::new(root_path.clone()).map_err(|e| e.to_string())?;
    let c_query = CString::new(query.clone()).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; LIST_BUF_SIZE as usize];
    let mut bytes_written: u32 = 0;

    let result = unsafe {
        zauri_search(
            c_root.as_ptr(),
            c_query.as_ptr(),
            buf.as_mut_ptr(),
            LIST_BUF_SIZE,
            &mut bytes_written,
        )
    };

    if result != 0 {
        return Err(format!("Search failed: error code {}", result));
    }

    let json_str = String::from_utf8_lossy(&buf[..bytes_written as usize]);
    let matches: Vec<SearchMatch> =
        serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

    let duration = start.elapsed().as_secs_f64() * 1000.0;
    eprintln!(
        "[perf] search('{}' in {}) = {:.2}ms ({} matches)",
        query,
        root_path,
        duration,
        matches.len()
    );

    Ok(matches)
}

// ---- Project Store Persistence ----

fn get_store_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let dir = std::path::Path::new(&home).join(".zauri");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("projects.json")
}

#[tauri::command]
fn load_project_store() -> Result<String, String> {
    let path = get_store_path();
    match std::fs::read_to_string(&path) {
        Ok(data) => Ok(data),
        Err(_) => Ok(r#"{"projects":[],"threads":[]}"#.to_string()),
    }
}

#[tauri::command]
fn save_project_store(data: String) -> Result<(), String> {
    let path = get_store_path();
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

// ---- Settings Persistence ----

fn get_settings_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let dir = std::path::Path::new(&home).join(".zauri");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("settings.json")
}

#[tauri::command]
fn load_settings() -> Result<String, String> {
    let path = get_settings_path();
    match std::fs::read_to_string(&path) {
        Ok(data) => Ok(data),
        Err(_) => Ok(r#"{}"#.to_string()),
    }
}

#[tauri::command]
fn save_settings(data: String) -> Result<(), String> {
    let path = get_settings_path();
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

// ---- Git Operations ----

/// Build extended PATH that includes common tool install locations.
/// Needed because bundled .app doesn't inherit shell PATH.
/// Create a Command that works on Windows (wraps through cmd /C for .cmd/.ps1 scripts)
fn portable_command(program: &str) -> Command {
    if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", program]);
        cmd
    } else {
        Command::new(program)
    }
}

fn extended_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    if cfg!(target_os = "windows") {
        let userprofile = std::env::var("USERPROFILE").unwrap_or_default();
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        format!(
            "{};{}\\.cargo\\bin;{}\\go\\bin;{}\\npm;{}\\..\\Local\\Programs\\Python;C:\\Program Files\\nodejs",
            current, userprofile, userprofile, appdata, appdata
        )
    } else {
        let home = std::env::var("HOME").unwrap_or_default();
        format!(
            "{}:{}/go/bin:{}/.cargo/bin:{}/.local/bin:{}/.bun/bin:/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin",
            current, home, home, home, home
        )
    }
}

fn run_git(working_dir: &str, args: &[&str]) -> Result<String, String> {
    let output = portable_command("git")
        .args(args)
        .current_dir(working_dir)
        .env("PATH", extended_path())
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "Git command failed".to_string()
        } else {
            stderr
        })
    }
}

#[derive(Serialize)]
struct GitStatus {
    branch: String,
    modified: u32,
    added: u32,
    deleted: u32,
    ahead: u32,
    behind: u32,
    is_repo: bool,
}

#[tauri::command]
fn git_status(working_dir: String) -> Result<GitStatus, String> {
    // Check if it's a git repo
    if run_git(&working_dir, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Ok(GitStatus {
            branch: String::new(),
            modified: 0,
            added: 0,
            deleted: 0,
            ahead: 0,
            behind: 0,
            is_repo: false,
        });
    }

    let branch = run_git(&working_dir, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_else(|_| "HEAD".to_string());

    let porcelain = run_git(&working_dir, &["status", "--porcelain"]).unwrap_or_default();
    let mut modified = 0u32;
    let mut added = 0u32;
    let mut deleted = 0u32;
    for line in porcelain.lines() {
        if line.len() < 2 {
            continue;
        }
        let status = &line[..2];
        if status.contains('M') {
            modified += 1;
        } else if status.contains('A') || status.contains('?') {
            added += 1;
        } else if status.contains('D') {
            deleted += 1;
        }
    }

    let (ahead, behind) =
        match run_git(&working_dir, &["rev-list", "--count", "--left-right", "@{upstream}...HEAD"])
        {
            Ok(output) => {
                let parts: Vec<&str> = output.split_whitespace().collect();
                if parts.len() == 2 {
                    (
                        parts[1].parse().unwrap_or(0),
                        parts[0].parse().unwrap_or(0),
                    )
                } else {
                    (0, 0)
                }
            }
            Err(_) => (0, 0), // No upstream
        };

    Ok(GitStatus {
        branch,
        modified,
        added,
        deleted,
        ahead,
        behind,
        is_repo: true,
    })
}

#[derive(Serialize)]
struct GitBranch {
    name: String,
    is_current: bool,
    is_remote: bool,
}

#[tauri::command]
fn git_branches(working_dir: String) -> Result<Vec<GitBranch>, String> {
    let output = run_git(&working_dir, &["branch", "-a", "--no-color"])?;
    let mut branches = Vec::new();

    for line in output.lines() {
        let is_current = line.starts_with('*');
        let name = line.trim_start_matches('*').trim().to_string();
        if name.contains("HEAD ->") || name.is_empty() {
            continue;
        }
        let is_remote = name.starts_with("remotes/");
        let clean_name = name
            .trim_start_matches("remotes/origin/")
            .trim_start_matches("remotes/")
            .to_string();

        // Skip duplicates (remote branch that matches local)
        if is_remote && branches.iter().any(|b: &GitBranch| b.name == clean_name) {
            continue;
        }

        branches.push(GitBranch {
            name: clean_name,
            is_current,
            is_remote,
        });
    }

    Ok(branches)
}

#[tauri::command]
fn git_checkout(working_dir: String, branch: String) -> Result<(), String> {
    run_git(&working_dir, &["checkout", &branch])?;
    Ok(())
}

#[tauri::command]
fn git_create_branch(working_dir: String, branch: String) -> Result<(), String> {
    run_git(&working_dir, &["checkout", "-b", &branch])?;
    Ok(())
}

#[tauri::command]
fn git_commit(working_dir: String, message: String) -> Result<String, String> {
    run_git(&working_dir, &["add", "-A"])?;
    let output = run_git(&working_dir, &["commit", "-m", &message])?;
    // Extract commit hash from output
    Ok(output.lines().next().unwrap_or("committed").to_string())
}

#[tauri::command]
fn git_push(working_dir: String) -> Result<String, String> {
    // Try regular push first, fall back to push -u origin <branch>
    match run_git(&working_dir, &["push"]) {
        Ok(out) => Ok(out),
        Err(_) => {
            let branch =
                run_git(&working_dir, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
            run_git(&working_dir, &["push", "-u", "origin", &branch])
        }
    }
}

#[tauri::command]
fn git_pull(working_dir: String) -> Result<String, String> {
    run_git(&working_dir, &["pull"])
}

#[tauri::command]
fn git_create_pr(working_dir: String, title: String) -> Result<String, String> {
    // Use gh CLI to create PR
    let output = portable_command("gh")
        .args(["pr", "create", "--title", &title, "--body", "", "--fill"])
        .current_dir(&working_dir)
        .env("PATH", extended_path())
        .output()
        .map_err(|e| format!("gh CLI not found: {}", e))?;

    if output.status.success() {
        let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(if url.is_empty() {
            "PR created".to_string()
        } else {
            format!("PR created: {}", url)
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "Failed to create PR".to_string()
        } else {
            stderr
        })
    }
}

// ---- AI Integration: Claude CLI agent ----

// Track the current AI child process for cancellation
static AI_CHILD_PID: std::sync::LazyLock<Arc<Mutex<Option<u32>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(None)));

#[tauri::command]
fn check_ai_provider(provider: String) -> Result<String, String> {
    let (cmd, args): (&str, &[&str]) = match provider.as_str() {
        "claude" => ("claude", &["--version"]),
        "codex" => ("codex", &["--version"]),
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    let output = portable_command(cmd)
        .args(args)
        .env("PATH", extended_path())
        .output()
        .map_err(|e| format!("{} CLI not found: {}", provider, e))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(version)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!("{} CLI error: {}", provider, stderr))
    }
}

#[tauri::command]
fn ai_chat(
    app: tauri::AppHandle,
    prompt: String,
    working_dir: String,
    context_files: Vec<String>,
    provider: String,
    session_id: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    stream_thinking: Option<bool>,
) -> Result<(), String> {
    // Build context from open files
    let mut full_prompt = String::new();

    if !context_files.is_empty() {
        full_prompt.push_str("I have these files open in my editor:\n\n");
        for file_path in &context_files {
            let c_path = CString::new(file_path.clone()).map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; BUF_SIZE as usize];
            let mut bytes_read: u32 = 0;

            let result = unsafe {
                zauri_read_file(c_path.as_ptr(), buf.as_mut_ptr(), BUF_SIZE, &mut bytes_read)
            };

            if result == 0 {
                let content = String::from_utf8_lossy(&buf[..bytes_read as usize]);
                // Truncate large files to keep context manageable
                let truncated = if content.len() > 5000 {
                    format!("{}...\n[truncated, {} total bytes]", &content[..5000], content.len())
                } else {
                    content.to_string()
                };
                full_prompt.push_str(&format!("--- {} ---\n{}\n\n", file_path, truncated));
            }
        }
        full_prompt.push_str("---\n\n");
    }

    full_prompt.push_str(&prompt);

    // Append system instructions
    full_prompt.push_str(concat!(
        "\n\n## Environment\n",
        "You are running inside **Zauri**, a lightweight desktop code editor built with Tauri, Zig, and TypeScript. ",
        "You are NOT in Cursor, VS Code, Zed, or any other editor.\n\n",

        "## What you can see\n",
        "- The user has files open in tabs. Their contents are shown above as context between `--- path ---` markers.\n",
        "- You know the project's working directory.\n",
        "- The user may have selected specific code before asking you.\n\n",

        "## How to suggest code changes\n",
        "When you want to create or modify files, output the COMPLETE file content in a fenced code block ",
        "with `filepath:` followed by the **absolute** file path as the info string:\n",
        "```filepath:/absolute/path/to/file.ts\n",
        "// complete file content here\n",
        "```\n",
        "- Always use absolute paths (the working directory is provided above).\n",
        "- Output the FULL file, not just changed parts — the editor diffs it against the original.\n",
        "- You may include multiple `filepath:` blocks to edit multiple files in one response.\n",
        "- The user will see a diff view with green (added) and red (removed) lines, and can Accept or Reject each file.\n\n",

        "## What the editor supports\n",
        "- **File tree**: the user can browse and open files from the sidebar.\n",
        "- **Terminal**: a full shell is available (Cmd+`).\n",
        "- **Git**: the user can commit, push, pull, switch branches, and create PRs from the editor.\n",
        "- **LSP**: go-to-definition, autocomplete, inline errors, rename — available for TS/JS, Rust, Python, Go, C/C++.\n",
        "- **Search**: project-wide text search (Cmd+Shift+F).\n\n",

        "## Guidelines\n",
        "- Be concise. The user is a developer working in their editor.\n",
        "- If asked to create a file, use a `filepath:` block with the full content.\n",
        "- If asked to explain code, reference specific line numbers and function names.\n",
        "- If the task involves running commands (build, test, install), suggest the exact terminal commands.\n",
        "- Don't apologize or hedge. Just do the task.\n"
    ));

    // Spawn AI CLI in a thread to avoid blocking
    let app_handle = app.clone();
    let want_thinking = stream_thinking.unwrap_or(false);
    std::thread::spawn(move || {
        // Claude CLI --print --output-format stream-json sends JSON lines:
        //   {type:"system"} -> init
        //   {type:"assistant", message:{content:[{text:"..."}]}} -> response text
        //   {type:"result", result:"..."} -> final text
        // It does NOT stream token-by-token. The response arrives as complete text.

        let (cmd, args): (String, Vec<String>) = match provider.as_str() {
            "codex" => {
                let mut codex_args = vec![
                    "exec".to_string(),
                    "--json".to_string(),
                ];
                // Sandbox/approval mode
                match permission_mode.as_deref() {
                    Some("never") => codex_args.push("--dangerously-bypass-approvals-and-sandbox".to_string()),
                    Some("untrusted") | Some("on-request") => {
                        // No --full-auto: codex exec runs with default approval
                    }
                    _ => codex_args.push("--full-auto".to_string()),
                }
                if let Some(ref m) = model {
                    codex_args.push("-m".to_string());
                    codex_args.push(m.clone());
                }
                codex_args.push(full_prompt.clone());
                (
                    "codex".to_string(),
                    codex_args,
                )
            },
            _ => {
                let mut claude_args = vec![
                    "--print".to_string(),
                    "--output-format".to_string(),
                    "stream-json".to_string(),
                    "--include-partial-messages".to_string(),
                ];
                // Resume existing session for conversation continuity
                if let Some(ref sid) = session_id {
                    claude_args.push("--resume".to_string());
                    claude_args.push(sid.clone());
                }
                // Model selection
                if let Some(ref m) = model {
                    claude_args.push("--model".to_string());
                    claude_args.push(m.clone());
                }
                // Permission mode
                if let Some(ref pm) = permission_mode {
                    claude_args.push("--permission-mode".to_string());
                    claude_args.push(pm.clone());
                }
                (
                    "claude".to_string(),
                    claude_args,
                )
            },
        };

        let use_stdin = provider != "codex";

        // Log the command being run
        eprintln!("[ai] Running: {} {}", cmd, args.join(" "));
        eprintln!("[ai] Provider: {}, CWD: {}", provider, working_dir);

        let result = portable_command(&cmd)
            .args(&args)
            .stdin(if use_stdin { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&working_dir)
            .env("PATH", extended_path())
            .spawn();

        match result {
            Ok(mut child) => {
                // Store PID for cancellation
                {
                    let mut pid = AI_CHILD_PID.lock().unwrap();
                    *pid = Some(child.id());
                }

                if use_stdin {
                    if let Some(mut stdin) = child.stdin.take() {
                        use std::io::Write;
                        let _ = stdin.write_all(full_prompt.as_bytes());
                        drop(stdin);
                    }
                }

                // Stream stderr in background for logging
                if let Some(stderr) = child.stderr.take() {
                    let stderr_app = app_handle.clone();
                    std::thread::spawn(move || {
                        let reader = BufReader::new(stderr);
                        for line in reader.lines().map_while(Result::ok) {
                            let trimmed = line.trim().to_string();
                            if !trimmed.is_empty() {
                                eprintln!("[ai:stderr] {}", trimmed);
                                // Also emit to frontend for visibility
                                let _ = stderr_app.emit("ai-log", &trimmed);
                            }
                        }
                    });
                }

                let mut got_result = false;
                if let Some(stdout) = child.stdout.take() {
                    let reader = BufReader::new(stdout);
                    for line in reader.lines().map_while(Result::ok) {
                        let trimmed = line.trim().to_string();
                        if trimmed.is_empty() {
                            continue;
                        }

                        if let Ok(event) = serde_json::from_str::<serde_json::Value>(&trimmed) {
                            let event_type = event.get("type").and_then(|t| t.as_str());

                            match event_type {
                                // ---- Claude events ----
                                Some("stream_event") => {
                                    let inner_type = event
                                        .get("event")
                                        .and_then(|e| e.get("type"))
                                        .and_then(|t| t.as_str());

                                    if inner_type == Some("content_block_delta") {
                                        let delta = event.get("event").and_then(|e| e.get("delta"));
                                        let delta_type = delta.and_then(|d| d.get("type")).and_then(|t| t.as_str());

                                        match delta_type {
                                            Some("text_delta") => {
                                                if let Some(text) = delta.and_then(|d| d.get("text")).and_then(|t| t.as_str()) {
                                                    let _ = app_handle.emit("ai-response-chunk", text);
                                                }
                                            }
                                            Some("thinking_delta") if want_thinking => {
                                                if let Some(text) = delta.and_then(|d| d.get("thinking")).and_then(|t| t.as_str()) {
                                                    let _ = app_handle.emit("ai-thinking-chunk", text);
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                                Some("result") => {
                                    if let Some(sid) = event.get("session_id").and_then(|s| s.as_str()) {
                                        let _ = app_handle.emit("ai-session-id", sid);
                                    }
                                    // Emit usage stats
                                    let usage_data = serde_json::json!({
                                        "input_tokens": event.get("usage").and_then(|u| u.get("input_tokens")).and_then(|t| t.as_u64()).unwrap_or(0),
                                        "output_tokens": event.get("usage").and_then(|u| u.get("output_tokens")).and_then(|t| t.as_u64()).unwrap_or(0),
                                        "cache_read": event.get("usage").and_then(|u| u.get("cache_read_input_tokens")).and_then(|t| t.as_u64()).unwrap_or(0),
                                        "cost_usd": event.get("total_cost_usd").and_then(|c| c.as_f64()).unwrap_or(0.0),
                                        "duration_ms": event.get("duration_ms").and_then(|d| d.as_u64()).unwrap_or(0),
                                    });
                                    let _ = app_handle.emit("ai-usage", usage_data.to_string());
                                    got_result = true;
                                    let _ = app_handle.emit("ai-response-done", "ok");
                                }
                                Some("rate_limit_event") => {
                                    if let Some(info) = event.get("rate_limit_info") {
                                        let status = info.get("status").and_then(|s| s.as_str()).unwrap_or("unknown");
                                        let resets_at = info.get("resetsAt").and_then(|r| r.as_u64()).unwrap_or(0);
                                        let limit_type = info.get("rateLimitType").and_then(|t| t.as_str()).unwrap_or("");

                                        let _ = app_handle.emit("ai-rate-limit", serde_json::json!({
                                            "status": status,
                                            "resets_at": resets_at,
                                            "type": limit_type,
                                        }).to_string());

                                        // If rate limited, show error and stop
                                        if status == "blocked" || status == "rejected" {
                                            let mins = if resets_at > 0 {
                                                let now = std::time::SystemTime::now()
                                                    .duration_since(std::time::UNIX_EPOCH)
                                                    .unwrap_or_default()
                                                    .as_secs();
                                                if resets_at > now { (resets_at - now) / 60 } else { 0 }
                                            } else { 0 };
                                            let msg = format!(
                                                "Rate limit reached ({}). Resets in ~{} minutes.",
                                                limit_type, mins
                                            );
                                            eprintln!("[ai] {}", msg);
                                            let _ = app_handle.emit("ai-response-chunk", &msg);
                                            got_result = true;
                                            let _ = app_handle.emit("ai-response-done", "error");
                                        }
                                    }
                                }

                                // ---- Codex events (--json JSONL) ----
                                Some("item.completed") => {
                                    // Codex complete message chunk — may arrive multiple times
                                    if let Some(text) = event
                                        .get("item")
                                        .and_then(|i| i.get("text"))
                                        .and_then(|t| t.as_str())
                                    {
                                        if !text.is_empty() {
                                            // Emit with trailing space to prevent run-on
                                            let _ = app_handle.emit("ai-response-chunk", text);
                                        }
                                    }
                                }
                                Some("item.content_delta") => {
                                    // Codex streaming delta
                                    if let Some(text) = event
                                        .get("delta")
                                        .and_then(|d| d.get("text"))
                                        .or_else(|| event.get("text"))
                                        .and_then(|t| t.as_str())
                                    {
                                        let _ = app_handle.emit("ai-response-chunk", text);
                                    }
                                }
                                Some("turn.completed") => {
                                    // Codex turn complete — extract usage
                                    if let Some(usage) = event.get("usage") {
                                        let usage_data = serde_json::json!({
                                            "input_tokens": usage.get("input_tokens").and_then(|t| t.as_u64()).unwrap_or(0),
                                            "output_tokens": usage.get("output_tokens").and_then(|t| t.as_u64()).unwrap_or(0),
                                            "cache_read": usage.get("cached_input_tokens").and_then(|t| t.as_u64()).unwrap_or(0),
                                            "cost_usd": 0.0,
                                            "duration_ms": 0,
                                        });
                                        let _ = app_handle.emit("ai-usage", usage_data.to_string());
                                    }
                                    got_result = true;
                                    let _ = app_handle.emit("ai-response-done", "ok");
                                }
                                Some("session.completed") | Some("agent.completed") => {
                                    if !got_result {
                                        got_result = true;
                                        let _ = app_handle.emit("ai-response-done", "ok");
                                    }
                                }
                                Some("error") => {
                                    let msg = event.get("message")
                                        .or_else(|| event.get("error"))
                                        .and_then(|m| m.as_str())
                                        .unwrap_or("Unknown error");
                                    let code = event.get("code")
                                        .and_then(|c| c.as_str())
                                        .unwrap_or("");
                                    eprintln!("[ai:error] {} ({})", msg, code);

                                    // Detect rate limit errors
                                    let is_rate_limit = code.contains("rate_limit")
                                        || msg.to_lowercase().contains("rate limit")
                                        || msg.to_lowercase().contains("too many requests");

                                    if is_rate_limit {
                                        let _ = app_handle.emit("ai-response-chunk",
                                            "Rate limit reached. Please wait before sending another message.");
                                    } else {
                                        let _ = app_handle.emit("ai-response-chunk", &format!("Error: {}", msg));
                                    }
                                    got_result = true;
                                    let _ = app_handle.emit("ai-response-done", "error");
                                }

                                _ => {
                                    // Log unhandled event types for debugging
                                    if let Some(t) = event_type {
                                        eprintln!("[ai:event] unhandled type: {}", t);
                                    }
                                }
                            }
                        } else {
                            // Raw text (non-JSON) — from codex or fallback
                            let t = trimmed.trim();
                            if !t.is_empty() {
                                let _ = app_handle.emit("ai-response-chunk", t);
                            }
                        }
                    }
                }

                // Clear PID
                {
                    let mut pid = AI_CHILD_PID.lock().unwrap();
                    *pid = None;
                }

                match child.wait() {
                    Ok(status) => {
                        if !got_result {
                            let _ = app_handle.emit(
                                "ai-response-done",
                                if status.success() { "ok" } else { "error" },
                            );
                        }
                    }
                    Err(e) => {
                        let _ = app_handle.emit("ai-response-done", &format!("error: {}", e));
                    }
                }
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "ai-response-done",
                    &format!("Failed to start {} CLI: {}", cmd, e),
                );
            }
        }
    });

    Ok(())
}

// ---- Terminal (PTY-based) ----

// Global PTY sessions
type PtyWriters = Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>;

static PTY_WRITERS: std::sync::LazyLock<PtyWriters> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

#[tauri::command]
fn terminal_spawn(
    app: tauri::AppHandle,
    working_dir: String,
    terminal_id: String,
) -> Result<(), String> {
    let pty_system = NativePtySystem::default();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Detect user's preferred shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&working_dir);
    cmd.env("TERM", "xterm-256color");

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    // Store the writer for sending input
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    {
        let mut writers = PTY_WRITERS.lock().unwrap();
        writers.insert(terminal_id.clone(), writer);
    }

    // Read PTY output in a thread
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let app_handle = app.clone();
    let id = terminal_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(
                        "terminal-output",
                        serde_json::json!({
                            "id": id,
                            "data": data,
                            "stream": "stdout"
                        }),
                    );
                }
                Err(_) => break,
            }
        }
    });

    // Wait for child exit in another thread
    let app_handle2 = app.clone();
    let id2 = terminal_id.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        let _ = app_handle2.emit(
            "terminal-exit",
            serde_json::json!({ "id": id2, "code": 0 }),
        );
        // Clean up writer
        let mut writers = PTY_WRITERS.lock().unwrap();
        writers.remove(&id2);
    });

    Ok(())
}

#[tauri::command]
fn terminal_write(terminal_id: String, data: String) -> Result<(), String> {
    let mut writers = PTY_WRITERS.lock().unwrap();
    if let Some(writer) = writers.get_mut(&terminal_id) {
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Terminal session not found".to_string())
    }
}

#[tauri::command]
fn terminal_resize(terminal_id: String, cols: u16, rows: u16) -> Result<(), String> {
    // PTY resize would need master handle stored — for now just acknowledge
    let _ = (terminal_id, cols, rows);
    Ok(())
}

// Keep the simple exec for one-off commands (used by AI too)
#[tauri::command]
fn terminal_exec(
    app: tauri::AppHandle,
    command: String,
    working_dir: String,
    terminal_id: String,
) -> Result<(), String> {
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

        let result = Command::new(&shell)
            .args(["-c", &command])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&working_dir)
            .spawn();

        match result {
            Ok(mut child) => {
                if let Some(stdout) = child.stdout.take() {
                    let reader = BufReader::new(stdout);
                    let id = terminal_id.clone();
                    let app = app_handle.clone();
                    std::thread::spawn(move || {
                        for line in reader.lines().map_while(Result::ok) {
                            let _ = app.emit("terminal-output", serde_json::json!({
                                "id": id, "data": line, "stream": "stdout"
                            }));
                        }
                    });
                }
                if let Some(stderr) = child.stderr.take() {
                    let reader = BufReader::new(stderr);
                    let id = terminal_id.clone();
                    let app = app_handle.clone();
                    std::thread::spawn(move || {
                        for line in reader.lines().map_while(Result::ok) {
                            let _ = app.emit("terminal-output", serde_json::json!({
                                "id": id, "data": line, "stream": "stderr"
                            }));
                        }
                    });
                }
                match child.wait() {
                    Ok(status) => {
                        let _ = app_handle.emit("terminal-exit", serde_json::json!({
                            "id": terminal_id, "code": status.code().unwrap_or(-1)
                        }));
                    }
                    Err(e) => {
                        let _ = app_handle.emit("terminal-exit", serde_json::json!({
                            "id": terminal_id, "code": -1, "error": e.to_string()
                        }));
                    }
                }
            }
            Err(e) => {
                let _ = app_handle.emit("terminal-exit", serde_json::json!({
                    "id": terminal_id, "code": -1, "error": e.to_string()
                }));
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn ai_cancel() -> Result<(), String> {
    let mut pid = AI_CHILD_PID.lock().unwrap();
    if let Some(p) = pid.take() {
        eprintln!("[ai] Cancelling process {}", p);
        if cfg!(target_os = "windows") {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &p.to_string()])
                .output();
        } else {
            let _ = Command::new("kill")
                .args(["-TERM", &format!("-{}", p)])
                .output();
        }
        Ok(())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn get_startup_time() -> f64 {
    let pid = std::process::id();
    eprintln!("[perf] startup check for pid {}", pid);
    0.0
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    unsafe { zauri_init() };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            list_directory,
            search_files,
            get_startup_time,
            load_project_store,
            save_project_store,
            load_settings,
            save_settings,
            git_status,
            git_branches,
            git_checkout,
            git_create_branch,
            git_commit,
            git_push,
            git_pull,
            git_create_pr,
            check_ai_provider,
            ai_chat,
            ai_cancel,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_exec,
            lsp::lsp_spawn,
            lsp::lsp_send,
            lsp::lsp_shutdown,
            lsp::lsp_key_for_file,
            lsp::lsp_ensure_for_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
