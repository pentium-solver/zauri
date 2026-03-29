use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

struct LspProcess {
    child: Child,
    stdin: std::process::ChildStdin,
}

type LspMap = Arc<Mutex<HashMap<String, LspProcess>>>;

static LSP_SERVERS: std::sync::LazyLock<LspMap> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

fn get_server_command(language: &str) -> Option<(String, Vec<String>)> {
    match language {
        "typescript" | "javascript" | "typescriptreact" | "javascriptreact" => Some((
            "typescript-language-server".to_string(),
            vec!["--stdio".to_string()],
        )),
        "rust" => Some(("rust-analyzer".to_string(), vec![])),
        "python" => Some((
            "pyright-langserver".to_string(),
            vec!["--stdio".to_string()],
        )),
        "go" => Some(("gopls".to_string(), vec!["serve".to_string()])),
        "c" | "cpp" => Some(("clangd".to_string(), vec![])),
        _ => None,
    }
}

fn language_from_extension(ext: &str) -> &str {
    match ext {
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "typescriptreact",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "javascriptreact",
        "rs" => "rust",
        "py" | "pyw" => "python",
        "go" => "go",
        "c" | "h" => "c",
        "cpp" | "cxx" | "cc" | "hpp" => "cpp",
        _ => "unknown",
    }
}

/// Spawn a language server for the given language and working directory.
#[tauri::command]
pub fn lsp_spawn(
    app: tauri::AppHandle,
    language: String,
    working_dir: String,
) -> Result<(), String> {
    let key = format!("{}:{}", language, working_dir);

    // Check if already running
    {
        let servers = LSP_SERVERS.lock().unwrap();
        if servers.contains_key(&key) {
            return Ok(()); // Already running
        }
    }

    let (cmd, args) = get_server_command(&language)
        .ok_or_else(|| format!("No LSP server configured for language: {}", language))?;

    eprintln!("[lsp] Spawning {} {} for {} in {}", cmd, args.join(" "), language, working_dir);

    let mut child = Command::new(&cmd)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(&working_dir)
        .env("PATH", crate::extended_path())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}. Is it installed?", cmd, e))?;

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

    // Stderr logging
    if let Some(stderr) = child.stderr.take() {
        let lang = language.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                eprintln!("[lsp:{}:stderr] {}", lang, line);
            }
        });
    }

    // Store the process
    {
        let mut servers = LSP_SERVERS.lock().unwrap();
        servers.insert(key.clone(), LspProcess { child, stdin });
    }

    // Read stdout in a background thread — parse LSP Content-Length framed messages
    let app_handle = app.clone();
    let key_clone = key.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            // Read headers until blank line
            let mut content_length: usize = 0;
            loop {
                let mut header = String::new();
                match reader.read_line(&mut header) {
                    Ok(0) => return, // EOF
                    Ok(_) => {
                        let trimmed = header.trim();
                        if trimmed.is_empty() {
                            break; // End of headers
                        }
                        if let Some(len) = trimmed.strip_prefix("Content-Length: ") {
                            content_length = len.parse().unwrap_or(0);
                        }
                    }
                    Err(_) => return,
                }
            }

            if content_length == 0 {
                continue;
            }

            // Read body
            let mut body = vec![0u8; content_length];
            if reader.read_exact(&mut body).is_err() {
                return;
            }

            let json = String::from_utf8_lossy(&body).to_string();
            let _ = app_handle.emit("lsp-response", serde_json::json!({
                "key": key_clone,
                "message": json,
            }).to_string());
        }
    });

    Ok(())
}

/// Send a JSON-RPC request/notification to a language server.
#[tauri::command]
pub fn lsp_send(key: String, message: String) -> Result<(), String> {
    let mut servers = LSP_SERVERS.lock().unwrap();
    let server = servers
        .get_mut(&key)
        .ok_or_else(|| format!("No LSP server for key: {}", key))?;

    let content = message.as_bytes();
    let header = format!("Content-Length: {}\r\n\r\n", content.len());

    server
        .stdin
        .write_all(header.as_bytes())
        .map_err(|e| e.to_string())?;
    server
        .stdin
        .write_all(content)
        .map_err(|e| e.to_string())?;
    server.stdin.flush().map_err(|e| e.to_string())?;

    Ok(())
}

/// Shutdown a language server.
#[tauri::command]
pub fn lsp_shutdown(key: String) -> Result<(), String> {
    let mut servers = LSP_SERVERS.lock().unwrap();
    if let Some(mut server) = servers.remove(&key) {
        let _ = server.child.kill();
    }
    Ok(())
}

/// Get the LSP key for a file path.
#[tauri::command]
pub fn lsp_key_for_file(file_path: String, working_dir: String) -> Result<String, String> {
    let ext = file_path
        .rsplit('.')
        .next()
        .unwrap_or("");
    let lang = language_from_extension(ext);
    if lang == "unknown" {
        return Err(format!("No LSP support for extension: .{}", ext));
    }
    Ok(format!("{}:{}", lang, working_dir))
}

/// Auto-detect and spawn the right LSP server for a file.
#[tauri::command]
pub fn lsp_ensure_for_file(
    app: tauri::AppHandle,
    file_path: String,
    working_dir: String,
) -> Result<String, String> {
    let ext = file_path.rsplit('.').next().unwrap_or("");
    let lang = language_from_extension(ext);
    if lang == "unknown" {
        return Err(format!("No LSP support for .{}", ext));
    }
    let key = format!("{}:{}", lang, working_dir);

    // Spawn if not already running
    {
        let servers = LSP_SERVERS.lock().unwrap();
        if servers.contains_key(&key) {
            return Ok(key);
        }
    }

    lsp_spawn(app, lang.to_string(), working_dir)?;
    Ok(key)
}
