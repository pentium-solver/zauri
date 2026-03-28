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

// ---- AI Integration: Claude CLI agent ----

#[tauri::command]
fn check_ai_provider(provider: String) -> Result<String, String> {
    let (cmd, args): (&str, &[&str]) = match provider.as_str() {
        "claude" => ("claude", &["--version"]),
        "codex" => ("codex", &["--version"]),
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    let output = Command::new(cmd)
        .args(args)
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

    // Spawn AI CLI in a thread to avoid blocking
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let (cmd, args): (String, Vec<String>) = match provider.as_str() {
            "codex" => (
                "codex".to_string(),
                vec![
                    "--full-auto".to_string(),
                    "--quiet".to_string(),
                    full_prompt.clone(),
                ],
            ),
            _ => (
                "claude".to_string(),
                vec![
                    "--print".to_string(),
                    "--output-format".to_string(),
                    "text".to_string(),
                ],
            ),
        };

        let use_stdin = provider != "codex"; // Codex takes prompt as arg

        let result = Command::new(&cmd)
            .args(&args)
            .stdin(if use_stdin { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&working_dir)
            .spawn();

        match result {
            Ok(mut child) => {
                // Write prompt to stdin (Claude uses stdin, Codex uses args)
                if use_stdin {
                    if let Some(mut stdin) = child.stdin.take() {
                        use std::io::Write;
                        let _ = stdin.write_all(full_prompt.as_bytes());
                        drop(stdin);
                    }
                }

                // Stream stdout line by line
                if let Some(stdout) = child.stdout.take() {
                    let reader = BufReader::new(stdout);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            let _ = app_handle.emit("ai-response-chunk", &line);
                        }
                    }
                }

                // Wait for process to finish
                match child.wait() {
                    Ok(status) => {
                        let _ = app_handle.emit(
                            "ai-response-done",
                            if status.success() { "ok" } else { "error" },
                        );
                    }
                    Err(e) => {
                        let _ = app_handle.emit("ai-response-done", &format!("error: {}", e));
                    }
                }
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "ai-response-done",
                    &format!("Failed to start Claude CLI: {}", e),
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            list_directory,
            search_files,
            get_startup_time,
            check_ai_provider,
            ai_chat,
            terminal_spawn,
            terminal_write,
            terminal_resize,
            terminal_exec,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
