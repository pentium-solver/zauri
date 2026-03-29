# Zauri

Lightweight desktop code editor built with Tauri (Rust) + Zig + TypeScript + CodeMirror 6.

## Architecture

```
src/                    # Frontend (TypeScript)
  main.ts               # Editor core: tabs, file tree, keyboard shortcuts
  ai-panel.ts           # AI chat: Claude + Codex integration, streaming, fork
  lsp-client.ts         # LSP bridge: go-to-def, autocomplete, diagnostics, rename
  terminal.ts           # xterm.js PTY terminal
  git.ts                # Git status polling, branch selector, commit/push/pull
  projects.ts           # Project/thread persistence to ~/.zauri/projects.json
  settings.ts           # Full-page settings with editor/AI/git config
  about.ts              # About page with update checker
  languages.ts          # 40+ CodeMirror language grammars
  icons.ts              # Custom SVG file type icons
  ai-edits.ts           # Parse filepath: blocks, diff engine, snapshot/revert
  diff-decorations.ts   # CM6 inline diff (green/red line highlighting)
  context-menu.ts       # Custom right-click menu
  command-palette.ts    # Cmd+Shift+P fuzzy action search
  preview.ts            # HTML live preview in iframe
  minimap.ts            # Canvas code overview
  updater.ts            # Auto-update from GitHub releases
  styles.css            # All UI styling

src-tauri/
  src/lib.rs            # Rust backend: file I/O (Zig FFI), AI chat, git, settings
  src/lsp.rs            # LSP process manager (spawn/relay/shutdown)

zig-backend/
  src/main.zig          # Zig: file read/write, directory listing, search
```

## Key Patterns

- **AI chat** spawns `claude --print --output-format stream-json --include-partial-messages` or `codex exec --json`
- **Session continuity** via `--resume <session_id>` (Claude) per thread
- **File edits** use `filepath:` fenced code blocks — parsed and shown as inline diffs
- **LSP** spawns language servers as subprocesses, relays JSON-RPC via stdin/stdout
- **All external commands** use `portable_command()` (wraps cmd /C on Windows) and `extended_path()` (includes ~/go/bin, ~/.cargo/bin, etc.)
- **Persistence** to `~/.zauri/projects.json` (projects, threads, messages, usage, sessions) and `~/.zauri/settings.json`

## Building

```bash
bun install
bun run tauri dev      # Development
bun run tauri build    # Production
```

## Stack

Tauri 2 · Rust · Zig 0.15 · TypeScript · Vite · CodeMirror 6 · xterm.js · marked
