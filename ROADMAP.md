# Zauri Roadmap

Updated for `v0.6.8` (`March 2026`).

This roadmap captures the current product direction for Zauri and folds in the major ideas already present across the app, docs, and codebase.

## Core Direction

Build a lightweight desktop code editor with a native feel, strong local workflows, and an AI assistant that can operate on real project context without turning the editor into a web wrapper for chat.

## Shipped Foundation

- [x] AI assistant with Claude and Codex support
- [x] Real-time streaming responses
- [x] Session resume per thread
- [x] Conversation forking between providers
- [x] Model selector and permission selector
- [x] Thinking mode and token tracking
- [x] Context window visibility with estimated token usage and file-level context chips
- [x] File-edit flows via `filepath:` fenced blocks and inline diffs
- [x] Auto-inject project context such as `CLAUDE.md`
- [x] Clickable file-path links inside chat
- [x] Thread archiving and smarter auto-title generation
- [x] Resizable AI sidebar with persisted width
- [x] LSP integration with go-to-definition, autocomplete, inline diagnostics, rename, and find references
- [x] Git integration with branch switching, status indicators, commit, push, pull, and PR creation
- [x] Git staging and unstage flows inside the Git panel
- [x] Full PTY terminal powered by `xterm.js`
- [x] Editor support for 40+ languages
- [x] Multi-cursor editing
- [x] Command palette
- [x] Quick open and fuzzy search across commands, branches, and project files
- [x] Minimap
- [x] Custom keybindings and expanded keyboard shortcuts
- [x] Browser preview for HTML and SVG content
- [x] Custom context menu
- [x] Find and replace
- [x] Working word-wrap toggle in editor settings and shortcuts
- [x] Persistent projects and threaded AI conversations
- [x] In-app auto-updater backed by GitHub releases

## Next

### AI Workflows

- [ ] Make AI edits easier to review, batch, accept, reject, and revert
- [ ] Improve conversation context controls so users can see exactly what is being sent
- [ ] Strengthen thread/session continuity across restarts and workspace switches
- [ ] Add better usage visibility around tokens, costs, and rate limits
- [ ] Tighten provider-specific UX so Claude and Codex flows feel first-class rather than generic

### Editor

- [ ] Make file tabs, search, quick-open, and file-tree flows faster on larger projects
- [ ] Expand language-specific ergonomics beyond baseline syntax support
- [ ] Improve browser preview with more reliable asset rewriting and refresh behavior
- [ ] Add more editor polish around find/replace, context actions, and navigation
- [ ] Continue reducing UI friction in sidebar, titlebar, and panel management

### LSP

- [ ] Add deeper symbol navigation and richer hover details
- [ ] Surface more code actions and refactor entry points
- [ ] Improve LSP resilience, startup time, and diagnostics handling
- [ ] Expand support quality across TypeScript, Rust, Python, Go, C, and C++

### Git

- [ ] Deepen the Git panel with richer working-tree insight
- [ ] Add better branch, commit, and PR workflows inside the editor
- [ ] Improve status refresh behavior and error handling for large repos
- [ ] Move toward hunk-level diff and staging workflows

### Terminal And Tasks

- [ ] Make terminal sessions feel more persistent and project-aware
- [ ] Add better handoff between terminal output and AI context
- [ ] Introduce lightweight saved commands or task runners

### Projects

- [ ] Improve project switching and workspace restoration
- [ ] Make threaded AI history easier to scan and manage
- [ ] Add stronger project metadata and organization features

### Updates And Stability

- [ ] Improve updater messaging, download progress, and restart UX
- [ ] Harden crash recovery and session recovery paths
- [ ] Continue performance work across Rust, Zig, and frontend boundaries

## Later

- [ ] Extension or plugin system
- [ ] Remote-development workflows
- [ ] Built-in test and run surfaces
- [ ] Richer theme and customization support
- [ ] More advanced preview and app-building workflows
- [ ] Better collaboration and sharing primitives for AI threads and project context

## Product Principles

- Keep startup fast and the runtime lean
- Prefer local-first workflows and direct file access
- Treat AI as a real editor feature, not a detached chat pane
- Preserve clear diffs and explicit user control over file changes
- Keep the stack pragmatic: Tauri, Rust, Zig, and TypeScript where each makes sense
