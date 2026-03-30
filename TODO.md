# Zauri Roadmap

*Last updated: 2026-03-29*

## Done

- [x] **Multi-cursor editing** — Alt+Click, Cmd+D, rectangular selection
- [x] **Command palette** — Cmd+Shift+P with fuzzy search, categories, shortcuts
- [x] **Tab drag reorder** — drag tabs to reorder with visual indicator
- [x] **Minimap** — canvas-based code overview with viewport indicator, click to scroll
- [x] **Browser preview** — auto-preview HTML files, live reload on save, split view

## Next Up

- [ ] **Split view** — side-by-side editing of two files in separate panes
- [ ] **Breadcrumbs** — `src > components > Editor.tsx > render()` path bar using LSP/tree-sitter
- [ ] **Extensions/plugins** — user-installable plugins without forking
- [ ] **Themes** — light mode, custom color schemes, VS Code theme import
- [ ] **Image/PDF preview** — preview non-code files inline
- [ ] **Collaborative editing** — real-time multiplayer via CRDTs
- [ ] **Worktree support** — isolated git worktrees per AI thread (t3code-style)
- [ ] **Semantic highlighting** — LSP-based token coloring
- [ ] **Workspace symbol search** — Cmd+T to find symbols across project
- [ ] **Code folding** — collapse functions/blocks

Debugger + run configurations: DAP-based breakpoints, step/continue, variables/watch, debug console, launch/attach profiles.
Test explorer + coverage: test discovery, gutter run/debug, failed-test navigation, coverage overlay, watch mode.
Tasks + Problems: first-class build/lint/test tasks with parsed diagnostics instead of raw terminal-only output.
Workspace trust + permissions: gate tasks, debuggers, agents, MCP servers, and workspace config in untrusted repos.
Extension platform: languages, debuggers, linters, themes, AI tools, and previews should be pluggable.
MCP host + tool permissions: make AI/tool integrations first-class and approval-based.
Inline AI: Cmd+K edits, quick-fix-to-agent, refactor preview, partial accept, next-edit suggestions.
Background agents with worktree isolation: let an agent code/test on a side worktree while the user keeps editing.
Remote dev + devcontainers/SSH: this is baseline for serious team use now.
Project rules + memory: make repo/user/session instructions and learned conventions explicit, not ad hoc.
Smarter web preview: live reload, error overlay, console bridge, device presets, click-to-source.