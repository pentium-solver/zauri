# Zauri Editor — AI Context

*This file is fetched by Zauri's AI assistant to stay up-to-date on the editor itself.*

## What is Zauri?
A lightweight desktop code editor built from scratch with Tauri (Rust), Zig, and TypeScript. Open source at https://github.com/pentium-solver/zauri

## Current Version
v0.6.5 (March 2026)

## Features
- **AI Assistant** — Claude + Codex with real-time streaming, session resume, conversation forking, model/permission selectors, thinking mode, token tracking
- **LSP** — Go-to-definition (Cmd+Click), autocomplete, inline diagnostics, F2 rename, Shift+F12 find references
- **Git** — Branch selector, commit/push/pull, PR creation, status indicators
- **Terminal** — Full PTY via xterm.js
- **Editor** — 40+ languages, multi-cursor, command palette, minimap, browser preview, custom context menu, find/replace
- **Projects** — Persistent projects with threaded AI conversations, fork threads between providers
- **Auto-updater** — In-app updates from GitHub releases

## Tech Stack
Tauri 2 (Rust) · Zig 0.15 · TypeScript · CodeMirror 6 · xterm.js · Vite · marked

## How AI works in Zauri
- Claude uses `claude --print --output-format stream-json --include-partial-messages`
- Codex uses `codex exec --json`
- File edits use `filepath:` fenced code blocks which show as inline diffs
- Session continuity via `--resume <session_id>` per thread
- CLAUDE.md from the project root is auto-injected as context
- File paths in backticks become clickable links in the chat
