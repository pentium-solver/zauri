use serde::{Deserialize, Serialize};
use std::ffi::CString;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
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
fn check_claude_cli() -> Result<String, String> {
    let output = Command::new("claude")
        .args(["--version"])
        .output()
        .map_err(|e| format!("Claude CLI not found: {}. Install with: npm install -g @anthropic-ai/claude-code", e))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(version)
    } else {
        Err("Claude CLI not responding".to_string())
    }
}

#[tauri::command]
fn ai_chat(
    app: tauri::AppHandle,
    prompt: String,
    working_dir: String,
    context_files: Vec<String>,
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

    // Spawn claude CLI in a thread to avoid blocking
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let result = Command::new("claude")
            .args([
                "--print",           // Non-interactive, print response
                "--output-format", "text",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&working_dir)
            .spawn();

        match result {
            Ok(mut child) => {
                // Write prompt to stdin
                if let Some(mut stdin) = child.stdin.take() {
                    use std::io::Write;
                    let _ = stdin.write_all(full_prompt.as_bytes());
                    drop(stdin); // Close stdin to signal EOF
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
            check_claude_cli,
            ai_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
