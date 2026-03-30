mod lsp;

use base64::Engine;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
fn write_temp_image(name: String, data_url: String) -> Result<String, String> {
    let (_, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "Invalid image data URL".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| e.to_string())?;

    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "zauri-img-{}-{}.{}",
        std::process::id(),
        stamp,
        ext
    ));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
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

#[derive(Serialize)]
struct GitChangedFile {
    path: String,
    original_content: String,
    current_content: String,
    additions: usize,
    deletions: usize,
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

fn diff_stats(original: &str, current: &str) -> (usize, usize) {
    let old_lines: std::collections::HashSet<&str> = original.lines().collect();
    let new_lines: std::collections::HashSet<&str> = current.lines().collect();
    let additions = current.lines().filter(|line| !old_lines.contains(line)).count();
    let deletions = original.lines().filter(|line| !new_lines.contains(line)).count();
    (additions, deletions)
}

#[tauri::command]
fn git_changed_files(working_dir: String) -> Result<Vec<GitChangedFile>, String> {
    if run_git(&working_dir, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Ok(Vec::new());
    }

    let has_head = run_git(&working_dir, &["rev-parse", "--verify", "HEAD"]).is_ok();
    let mut changed_paths: Vec<String> = Vec::new();

    if has_head {
        let diff = run_git(&working_dir, &["diff", "--name-only", "HEAD", "--"]).unwrap_or_default();
        for line in diff.lines() {
            let path = line.trim();
            if !path.is_empty() {
                changed_paths.push(path.to_string());
            }
        }
    }

    let untracked = run_git(
        &working_dir,
        &["ls-files", "--others", "--exclude-standard"],
    )
    .unwrap_or_default();
    for line in untracked.lines() {
        let path = line.trim();
        if !path.is_empty() {
            changed_paths.push(path.to_string());
        }
    }

    changed_paths.sort();
    changed_paths.dedup();

    let mut result = Vec::new();
    for relative_path in changed_paths {
        let full_path = std::path::Path::new(&working_dir).join(&relative_path);
        let current_content = std::fs::read_to_string(&full_path).unwrap_or_default();
        let original_content = if has_head {
            run_git(&working_dir, &["show", &format!("HEAD:{}", relative_path)]).unwrap_or_default()
        } else {
            String::new()
        };
        let (additions, deletions) = diff_stats(&original_content, &current_content);
        result.push(GitChangedFile {
            path: relative_path,
            original_content,
            current_content,
            additions,
            deletions,
        });
    }

    Ok(result)
}

fn emit_tool_call(
    app: &tauri::AppHandle,
    name: &str,
    input: String,
    status: &str,
) {
    let payload = serde_json::json!({
        "name": name,
        "input": input,
        "status": status,
    });
    let _ = app.emit("ai-tool-call", payload.to_string());
}

fn emit_text_chunk(app: &tauri::AppHandle, text: &str, emitted_text: &mut bool) {
    if text.is_empty() {
        return;
    }
    *emitted_text = true;
    let _ = app.emit("ai-response-chunk", text);
}

fn emit_thinking_chunk(app: &tauri::AppHandle, text: &str) {
    if text.is_empty() {
        return;
    }
    let _ = app.emit("ai-thinking-chunk", text);
}

fn collect_json_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => {
            if text.trim().is_empty() {
                None
            } else {
                Some(text.clone())
            }
        }
        serde_json::Value::Array(items) => {
            let joined = items
                .iter()
                .filter_map(collect_json_text)
                .collect::<Vec<_>>()
                .join("");
            if joined.trim().is_empty() {
                None
            } else {
                Some(joined)
            }
        }
        serde_json::Value::Object(map) => {
            for key in ["text", "delta", "content", "summary", "reasoning", "message"] {
                if let Some(value) = map.get(key) {
                    if let Some(text) = collect_json_text(value) {
                        return Some(text);
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn event_looks_like_reasoning(event_type: &str, event: &serde_json::Value) -> bool {
    let mut labels = vec![event_type.to_ascii_lowercase()];

    if let Some(value) = event
        .get("item")
        .and_then(|item| item.get("type").or_else(|| item.get("kind")))
        .and_then(|value| value.as_str())
    {
        labels.push(value.to_ascii_lowercase());
    }

    if let Some(value) = event
        .get("item_type")
        .and_then(|value| value.as_str())
    {
        labels.push(value.to_ascii_lowercase());
    }

    if let Some(value) = event
        .get("delta")
        .and_then(|delta| delta.get("type"))
        .and_then(|value| value.as_str())
    {
        labels.push(value.to_ascii_lowercase());
    }

    if let Some(value) = event
        .get("part")
        .and_then(|part| part.get("type"))
        .and_then(|value| value.as_str())
    {
        labels.push(value.to_ascii_lowercase());
    }

    labels
        .iter()
        .any(|label| label.contains("reason") || label.contains("think"))
}

fn extract_codex_event_text(event: &serde_json::Value) -> Option<String> {
    for key in ["text", "delta", "item", "part", "content", "message"] {
        if let Some(value) = event.get(key) {
            if let Some(text) = collect_json_text(value) {
                return Some(text);
            }
        }
    }
    None
}

fn emit_done(app: &tauri::AppHandle, done_emitted: &mut bool, payload: String) {
    if *done_emitted {
        return;
    }
    let _ = app.emit("ai-response-done", payload);
    *done_emitted = true;
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
    images: Option<Vec<String>>,
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

    // Append image references for providers that don't support native image attachments.
    if provider != "codex" {
        if let Some(ref imgs) = images {
            if !imgs.is_empty() {
                full_prompt.push_str(
                    "\n\nThe user has attached the following image(s). Use the Read tool to view them:\n",
                );
                for img_path in imgs {
                    full_prompt.push_str(&format!("- {}\n", img_path));
                }
            }
        }
    }

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
        "- Always use the ABSOLUTE path (working directory + relative path). Never just the filename.\n",
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
        "- When referencing files, ALWAYS use the full relative path from the project root in backticks, like `dashboard/src/pages/Compare.tsx` or `server/cmd/server/main.go`. NEVER use just the filename like `Compare.tsx` — the editor needs the full path to make it clickable and openable.\n",
        "- If the task involves running commands (build, test, install), suggest the exact terminal commands.\n",
        "- Don't apologize or hedge. Just do the task.\n",
        "- If asked about Zauri itself (features, updates, how it works), ",
        "refer to https://raw.githubusercontent.com/pentium-solver/zauri/main/ZAURI_CONTEXT.md for the latest info.\n"
    ));

    // Spawn AI CLI in a thread to avoid blocking
    let app_handle = app.clone();
    let want_thinking = stream_thinking.unwrap_or(false);
    std::thread::spawn(move || {
        let codex_with_images = provider == "codex"
            && images
                .as_ref()
                .map(|paths| !paths.is_empty())
                .unwrap_or(false);
        let mut output_last_message_path: Option<std::path::PathBuf> = None;

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
                    Some("untrusted") => {
                        codex_args.push("-a".to_string());
                        codex_args.push("untrusted".to_string());
                    }
                    Some("on-request") => {
                        codex_args.push("-a".to_string());
                        codex_args.push("on-request".to_string());
                    }
                    Some("full-auto") => codex_args.push("--full-auto".to_string()),
                    Some("never-ask") => {
                        codex_args.push("-a".to_string());
                        codex_args.push("never".to_string());
                    }
                    Some("on-failure") => {
                        codex_args.push("-a".to_string());
                        codex_args.push("on-failure".to_string());
                    }
                    Some(_) => {
                        // No --full-auto: codex exec runs with default approval
                    }
                    None => codex_args.push("--full-auto".to_string()),
                }
                codex_args.push("-C".to_string());
                codex_args.push(working_dir.clone());
                codex_args.push("-c".to_string());
                codex_args.push(format!(
                    "hide_agent_reasoning={}",
                    if want_thinking { "false" } else { "true" }
                ));
                if want_thinking {
                    codex_args.push("-c".to_string());
                    codex_args.push("model_reasoning_summary=\"detailed\"".to_string());
                }
                if let Some(ref m) = model {
                    codex_args.push("-m".to_string());
                    codex_args.push(m.clone());
                }
                if let Some(ref imgs) = images {
                    let mut extra_dirs = HashSet::new();
                    for img_path in imgs {
                        if let Some(parent) = std::path::Path::new(img_path).parent() {
                            if extra_dirs.insert(parent.to_path_buf()) {
                                codex_args.push("--add-dir".to_string());
                                codex_args.push(parent.to_string_lossy().to_string());
                            }
                        }
                    }
                }
                // Add images
                if let Some(ref imgs) = images {
                    for img_path in imgs {
                        codex_args.push("-i".to_string());
                        codex_args.push(img_path.clone());
                    }
                }
                if codex_with_images {
                    let output_path = std::env::temp_dir().join(format!(
                        "zauri-codex-last-message-{}-{}.txt",
                        std::process::id(),
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_nanos()
                    ));
                    codex_args.push("-o".to_string());
                    codex_args.push(output_path.to_string_lossy().to_string());
                    output_last_message_path = Some(output_path);
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

                let last_stderr = Arc::new(Mutex::new(String::new()));
                // Stream stderr in background for logging
                if let Some(stderr) = child.stderr.take() {
                    let stderr_app = app_handle.clone();
                    let stderr_state = Arc::clone(&last_stderr);
                    std::thread::spawn(move || {
                        let reader = BufReader::new(stderr);
                        for line in reader.lines().map_while(Result::ok) {
                            let trimmed = line.trim().to_string();
                            if !trimmed.is_empty() {
                                if let Ok(mut last) = stderr_state.lock() {
                                    *last = trimmed.clone();
                                }
                                eprintln!("[ai:stderr] {}", trimmed);
                                // Also emit to frontend for visibility
                                let _ = stderr_app.emit("ai-log", &trimmed);
                            }
                        }
                    });
                }

                let mut got_result = false;
                let mut done_emitted = false;
                let mut emitted_text = false;
                let defer_done_until_exit = output_last_message_path.is_some();
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

                                    if inner_type == Some("content_block_start") {
                                        if let Some(content_block) = event.get("event").and_then(|e| e.get("content_block")) {
                                            let block_type = content_block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                            if block_type == "tool_use" {
                                                let name = content_block
                                                    .get("name")
                                                    .and_then(|value| value.as_str())
                                                    .unwrap_or("tool");
                                                let input = content_block
                                                    .get("input")
                                                    .map(|value| value.to_string())
                                                    .unwrap_or_default();
                                                emit_tool_call(&app_handle, name, input, "running");
                                            }
                                        }
                                    } else if inner_type == Some("content_block_delta") {
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

                                    // Check for permission denials
                                    if let Some(denials) = event.get("permission_denials").and_then(|d| d.as_array()) {
                                        if !denials.is_empty() {
                                            let denial_info: Vec<String> = denials.iter().map(|d| {
                                                let tool = d.get("tool_name").and_then(|t| t.as_str()).unwrap_or("unknown");
                                                let input = d.get("tool_input").map(|i| i.to_string()).unwrap_or_default();
                                                format!("{}: {}", tool, input)
                                            }).collect();
                                            let _ = app_handle.emit("ai-permission-denied", serde_json::json!({
                                                "denials": denial_info,
                                                "count": denials.len(),
                                            }).to_string());
                                        }
                                    }

                                    got_result = true;
                                    emit_done(&app_handle, &mut done_emitted, "ok".to_string());
                                }
                                Some("rate_limit_event") => {
                                    if let Some(info) = event.get("rate_limit_info") {
                                        let status = info.get("status").and_then(|s| s.as_str()).unwrap_or("unknown");
                                        let resets_at = info.get("resetsAt").or_else(|| info.get("resets_at")).and_then(|r| r.as_u64()).unwrap_or(0);
                                        let limit_type = info.get("rateLimitType").or_else(|| info.get("rate_limit_type")).and_then(|t| t.as_str()).unwrap_or("");
                                        let overage_reason = info.get("overageDisabledReason").and_then(|r| r.as_str()).unwrap_or("");

                                        let _ = app_handle.emit("ai-rate-limit", serde_json::json!({
                                            "status": status,
                                            "resets_at": resets_at,
                                            "type": limit_type,
                                        }).to_string());

                                        // If rate limited, show error and stop
                                        if status == "blocked" || status == "rejected" {
                                            let msg = if overage_reason == "out_of_credits" {
                                                "Usage limit reached. Extra usage balance is empty — add credits or enable auto-reload at claude.ai/settings, or wait for your limit to reset.".to_string()
                                            } else if overage_reason == "org_level_disabled" {
                                                "Usage limit reached. Extra usage is disabled at the organization level — enable it at claude.ai/settings or wait for your limit to reset.".to_string()
                                            } else if resets_at > 0 {
                                                let now = std::time::SystemTime::now()
                                                    .duration_since(std::time::UNIX_EPOCH)
                                                    .unwrap_or_default()
                                                    .as_secs();
                                                let mins = if resets_at > now { (resets_at - now) / 60 } else { 0 };
                                                format!("Rate limit reached ({}). Resets in ~{} minutes.", limit_type, mins)
                                            } else {
                                                format!("Rate limit reached ({}). Please wait before retrying.", limit_type)
                                            };
                                            eprintln!("[ai] {}", msg);
                                            let _ = app_handle.emit("ai-response-chunk", &msg);
                                            got_result = true;
                                            emit_done(&app_handle, &mut done_emitted, msg);
                                        }
                                    }
                                }

                                // ---- Codex events (--json JSONL) ----
                                Some("item.started") | Some("item.completed") => {
                                    if let Some(item) = event.get("item") {
                                        let item_type = item
                                            .get("type")
                                            .or_else(|| item.get("kind"))
                                            .and_then(|value| value.as_str())
                                            .unwrap_or("");
                                        let looks_like_tool = item_type.contains("tool")
                                            || item.get("tool_name").is_some()
                                            || item.get("call_id").is_some();
                                        if looks_like_tool {
                                            let name = item
                                                .get("tool_name")
                                                .or_else(|| item.get("name"))
                                                .and_then(|value| value.as_str())
                                                .unwrap_or("tool");
                                            let input = item
                                                .get("arguments")
                                                .or_else(|| item.get("input"))
                                                .map(|value| value.to_string())
                                                .unwrap_or_default();
                                            let status = if event_type == Some("item.started") {
                                                "running"
                                            } else {
                                                "completed"
                                            };
                                            emit_tool_call(&app_handle, name, input, status);
                                        }
                                        if event_type == Some("item.completed") {
                                            if let Some(text) = collect_json_text(item) {
                                                if item_type.contains("reasoning") {
                                                    if want_thinking {
                                                        emit_thinking_chunk(&app_handle, &text);
                                                    }
                                                } else if item_type.contains("message") || item_type.is_empty() {
                                                    emit_text_chunk(&app_handle, &text, &mut emitted_text);
                                                }
                                            }
                                        }
                                    }
                                }
                                Some("agent_message_delta") => {
                                    if let Some(text) = event
                                        .get("delta")
                                        .or_else(|| event.get("text"))
                                        .and_then(|t| t.as_str())
                                    {
                                        emit_text_chunk(&app_handle, text, &mut emitted_text);
                                    }
                                }
                                Some("agent_message") => {
                                    if let Some(text) = event.get("text").and_then(|t| t.as_str()) {
                                        emit_text_chunk(&app_handle, text, &mut emitted_text);
                                    }
                                }
                                Some("item.delta") | Some("item.content_delta") => {
                                    if let Some(text) = extract_codex_event_text(&event) {
                                        if event_looks_like_reasoning(event_type.unwrap_or(""), &event) {
                                            if want_thinking {
                                                emit_thinking_chunk(&app_handle, &text);
                                            }
                                        } else {
                                            emit_text_chunk(&app_handle, &text, &mut emitted_text);
                                        }
                                    }
                                }
                                Some("response.output_text.delta")
                                | Some("response.output_text.done")
                                | Some("response.reasoning_summary_text.delta")
                                | Some("response.reasoning_summary_text.done")
                                | Some("response.reasoning.delta")
                                | Some("response.reasoning.done") => {
                                    if let Some(text) = extract_codex_event_text(&event) {
                                        if event_looks_like_reasoning(event_type.unwrap_or(""), &event) {
                                            if want_thinking {
                                                emit_thinking_chunk(&app_handle, &text);
                                            }
                                        } else {
                                            emit_text_chunk(&app_handle, &text, &mut emitted_text);
                                        }
                                    }
                                }
                                Some("response.completed") => {
                                    if !got_result {
                                        got_result = true;
                                    }
                                    if !defer_done_until_exit {
                                        emit_done(&app_handle, &mut done_emitted, "ok".to_string());
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
                                    if !defer_done_until_exit {
                                        emit_done(&app_handle, &mut done_emitted, "ok".to_string());
                                    }
                                }
                                Some("session.completed") | Some("agent.completed") => {
                                    if !got_result {
                                        got_result = true;
                                    }
                                    if !defer_done_until_exit {
                                        emit_done(&app_handle, &mut done_emitted, "ok".to_string());
                                    }
                                }
                                Some("turn.failed") | Some("session.failed") | Some("agent.failed") => {
                                    let msg = event
                                        .get("error")
                                        .and_then(|value| {
                                            value
                                                .get("message")
                                                .and_then(|message| message.as_str())
                                                .or_else(|| value.as_str())
                                        })
                                        .unwrap_or("Codex request failed")
                                        .to_string();
                                    emit_text_chunk(
                                        &app_handle,
                                        &format!("Error: {}", msg),
                                        &mut emitted_text,
                                    );
                                    got_result = true;
                                    emit_done(&app_handle, &mut done_emitted, msg);
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
                                        emit_text_chunk(
                                            &app_handle,
                                            "Rate limit reached. Please wait before sending another message.",
                                            &mut emitted_text,
                                        );
                                    } else {
                                        emit_text_chunk(
                                            &app_handle,
                                            &format!("Error: {}", msg),
                                            &mut emitted_text,
                                        );
                                    }
                                    got_result = true;
                                    emit_done(&app_handle, &mut done_emitted, msg.to_string());
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
                            if !t.is_empty() && output_last_message_path.is_none() {
                                emit_text_chunk(&app_handle, t, &mut emitted_text);
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
                        if status.success() && !emitted_text {
                            if let Some(output_path) = output_last_message_path.as_ref() {
                                if let Ok(text) = std::fs::read_to_string(output_path) {
                                    let trimmed = text.trim();
                                    if !trimmed.is_empty() {
                                        emit_text_chunk(&app_handle, trimmed, &mut emitted_text);
                                    }
                                }
                            }
                        }
                        if !done_emitted {
                            let stderr_message = last_stderr
                                .lock()
                                .map(|value| value.clone())
                                .unwrap_or_default();
                            if status.success() {
                                if defer_done_until_exit && !emitted_text {
                                    emit_done(
                                        &app_handle,
                                        &mut done_emitted,
                                        "Codex completed without a final message.".to_string(),
                                    );
                                } else {
                                    emit_done(&app_handle, &mut done_emitted, "ok".to_string());
                                }
                            } else if !stderr_message.is_empty() {
                                emit_done(&app_handle, &mut done_emitted, stderr_message);
                            } else if got_result {
                                emit_done(
                                    &app_handle,
                                    &mut done_emitted,
                                    "The request failed before a final response was produced.".to_string(),
                                );
                            } else {
                                emit_done(
                                    &app_handle,
                                    &mut done_emitted,
                                    format!("{} exited with status {}", cmd, status),
                                );
                            }
                        }
                    }
                    Err(e) => {
                        emit_done(&app_handle, &mut done_emitted, format!("error: {}", e));
                    }
                }
            }
            Err(e) => {
                let _ = app_handle.emit("ai-response-done", format!("Failed to start {} CLI: {}", cmd, e));
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
            let _ = Command::new("pkill")
                .args(["-TERM", "-P", &p.to_string()])
                .output();
            let _ = Command::new("kill")
                .args(["-TERM", &p.to_string()])
                .output();
        }
        Ok(())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn kill_claude_processes() -> Result<String, String> {
    if cfg!(target_os = "windows") {
        let out = Command::new("taskkill")
            .args(["/F", "/IM", "claude.exe"])
            .output()
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        let out = Command::new("pkill")
            .args(["-9", "-f", "claude"])
            .output()
            .map_err(|e| e.to_string())?;
        // pkill exits 1 if no processes matched — that's fine
        Ok(format!("Killed {} process(es)", if out.status.success() { "all matching" } else { "0" }))
    }
}

#[tauri::command]
fn read_project_context(working_dir: String) -> Result<String, String> {
    for filename in &["CLAUDE.md", "claude.md", "AGENTS.md"] {
        let path = std::path::Path::new(&working_dir).join(filename);
        if let Ok(content) = std::fs::read_to_string(&path) {
            return Ok(format!("## Project Context (from {})\n{}", filename, content));
        }
    }
    Err("No CLAUDE.md, claude.md, or AGENTS.md found in project root.".to_string())
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
            write_temp_image,
            list_directory,
            search_files,
            get_startup_time,
            load_project_store,
            save_project_store,
            load_settings,
            save_settings,
            git_status,
            git_changed_files,
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
            kill_claude_processes,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_exec,
            lsp::lsp_spawn,
            lsp::lsp_send,
            lsp::lsp_shutdown,
            lsp::lsp_key_for_file,
            lsp::lsp_ensure_for_file,
            read_project_context,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
