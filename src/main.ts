import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { EditorView, keymap, drawSelection, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { searchKeymap } from "@codemirror/search";
import { getFileIcon, getFolderIcon, chevronRight, chevronDown } from "./icons";
import { getLanguageExtension } from "./languages";
import { createAIPanel, initAIPanel, toggleAIPanel, createMessageEl } from "./ai-panel";
import { createTerminalPanel, initTerminal, toggleTerminal } from "./terminal";
import { initGitStatus, showBranchSelector, toggleGitPanel, refreshStatus } from "./git";
import { loadSettingsFromDisk, showSettings } from "./settings";
import { showAbout } from "./about";
import { checkForUpdates, handlePostUpdateLaunch } from "./updater";
import { registerCommands, showCommandPalette } from "./command-palette";
import {
  isPreviewable,
  showPreview,
  updatePreviewContent,
  hidePreview,
  isPreviewOpen,
  getPreviewPath,
  setPreviewRootPath,
} from "./preview";
import { minimapExtension } from "./minimap";
import { formatShortcut } from "./shortcuts";
import {
  loadProjects,
  createProject,
  findProjectByRoot,
  getProjects,
  getThreadsForProject,
  createThread,
  deleteThread,
  addMessageToThread,
  setThreadSessionId,
  getThreadSessionId,
  clearThreadSessionId,
  setThreadModelAndPermission,
  forkThread,
  getThreadProvider,
  onStoreChange,
  saveSession,
  getSession,
  timeAgo,
  type Thread,
} from "./projects";
import { diffExtension, activateDiff, clearDiff } from "./diff-decorations";
import { lspExtensions, connectLsp, notifyChange } from "./lsp-client";
import { contextMenuExtension } from "./context-menu";
import { linter } from "@codemirror/lint";
import {
  type ProposedEdit,
  pendingEdits,
  addPendingEdit,
  removePendingEdit,
  pushSnapshot,
  canRevert,
  revertLastSnapshot,
} from "./ai-edits";

// ---- Types ----
interface DirEntry {
  name: string;
  is_dir: boolean;
}

interface SearchMatch {
  file: string;
  line: number;
  col: number;
  text: string;
}

interface Tab {
  path: string;
  name: string;
  content: string;
  modified: boolean;
  editorState: EditorState | null;
}

// ---- State ----
let rootPath: string | null = null;
const tabs: Map<string, Tab> = new Map();
let activeTabPath: string | null = null;
let editorView: EditorView | null = null;
const startTime = performance.now();

// ---- DOM refs ----
const fileTree = document.getElementById("file-tree")!;
const tabBar = document.getElementById("tab-bar")!;
const editorContainer = document.getElementById("editor-container")!;
const statusFile = document.getElementById("status-file")!;
const statusPerf = document.getElementById("status-perf")!;
const searchPanel = document.getElementById("search-panel")!;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchResults = document.getElementById("search-results")!;
const searchClose = document.getElementById("search-close")!;

// ---- Custom editor theme to match x-lock palette ----
const zauriTheme = EditorView.theme({
  "&": {
    backgroundColor: "#0e0e10 !important",
  },
  ".cm-gutters": {
    backgroundColor: "#0e0e10 !important",
    borderRight: "0.5px solid rgba(255,255,255,0.06) !important",
    color: "rgba(255,255,255,0.2) !important",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(255,255,255,0.03) !important",
    color: "rgba(255,255,255,0.4) !important",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(168, 130, 255, 0.04) !important",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(168, 130, 255, 0.2) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "#a882ff !important",
  },
});

// ---- Editor ----
function createEditorState(content: string, filename: string): EditorState {
  return EditorState.create({
    doc: content,
    extensions: [
      basicSetup,
      oneDark,
      zauriTheme,
      keymap.of(searchKeymap),
      drawSelection(),
      rectangularSelection(),
      crosshairCursor(),
      EditorState.allowMultipleSelections.of(true),
      getLanguageExtension(filename),
      diffExtension,
      lspExtensions((uri, line) => {
        // Navigate to definition
        const path = uri.replace("file://", "");
        const name = path.split("/").pop() || path;
        openFile(path, name).then(() => {
          // Jump to line after file opens
          if (editorView) {
            const lineInfo = editorView.state.doc.line(Math.min(line, editorView.state.doc.lines));
            editorView.dispatch({
              selection: { anchor: lineInfo.from },
              effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
            });
          }
        });
      }),
      linter(() => []), // Placeholder — diagnostics pushed by LSP
      minimapExtension,
      contextMenuExtension({
        onGoToDefinition: () => {
          if (editorView) {
            editorView.dom.dispatchEvent(new MouseEvent("click", { metaKey: true }));
          }
        },
        onFindReferences: () => {
          if (editorView) {
            const event = new KeyboardEvent("keydown", { key: "F12", shiftKey: true });
            editorView.dom.dispatchEvent(event);
          }
        },
        onRename: () => {
          if (editorView) {
            const event = new KeyboardEvent("keydown", { key: "F2" });
            editorView.dom.dispatchEvent(event);
          }
        },
        onAskAI: (selectedText: string) => {
          // Show AI panel (don't toggle — keep open if already open)
          const aiPanel = document.getElementById("ai-panel");
          if (aiPanel?.classList.contains("hidden")) {
            toggleAIPanel();
          }
          const input = document.getElementById("ai-input") as HTMLTextAreaElement;
          if (input) {
            input.value = selectedText
              ? `Explain this code:\n\n${selectedText}`
              : "What does this file do?";
            input.focus();
          }
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && activeTabPath) {
          const tab = tabs.get(activeTabPath);
          if (tab) {
            tab.modified = true;
            tab.editorState = update.state;
            renderTabs();
            // Notify LSP of change
            notifyChange(update.state.doc.toString());
          }
        }
      }),
    ],
  });
}

function setEditorContent(state: EditorState) {
  if (editorView) {
    editorView.destroy();
  }

  const welcome = document.getElementById("welcome");
  if (welcome) welcome.remove();

  editorView = new EditorView({
    state,
    parent: editorContainer,
  });
}

// ---- File tree with guide lines ----
async function loadDirectory(path: string, container: HTMLElement, depth: number = 0) {
  try {
    const entries: DirEntry[] = await invoke("list_directory", { path });
    const totalEntries = entries.length;

    entries.forEach((entry, index) => {
      const isLast = index === totalEntries - 1;
      const fullPath = `${path}/${entry.name}`;

      const item = document.createElement("div");
      item.className = "tree-item";
      item.dataset.path = fullPath;

      // Build indent with guide lines
      const indent = document.createElement("div");
      indent.style.display = "flex";
      indent.style.alignItems = "center";
      indent.style.flexShrink = "0";
      indent.style.paddingLeft = `${depth * 18 + 4}px`;
      indent.style.position = "relative";

      if (entry.is_dir) {
        // Chevron for directories
        const chevron = document.createElement("span");
        chevron.className = "chevron";
        chevron.innerHTML = chevronRight;
        indent.appendChild(chevron);
      } else {
        // Spacer for files (no chevron)
        const spacer = document.createElement("span");
        spacer.className = "chevron-spacer";
        indent.appendChild(spacer);
      }

      // Icon
      const iconWrapper = document.createElement("span");
      iconWrapper.className = "icon-wrapper";
      if (entry.is_dir) {
        iconWrapper.innerHTML = getFolderIcon(entry.name, false);
      } else {
        iconWrapper.innerHTML = getFileIcon(entry.name);
      }

      // Name
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = entry.name;

      item.appendChild(indent);
      item.appendChild(iconWrapper);
      item.appendChild(name);
      container.appendChild(item);

      if (entry.is_dir) {
        const children = document.createElement("div");
        children.className = "tree-children";
        // Position guide line
        children.style.position = "relative";

        // Add vertical guide line
        const guide = document.createElement("div");
        guide.className = "tree-guide";
        guide.style.left = `${depth * 18 + 12}px`;
        if (isLast) {
          // For the last item, we don't want the guide extending to infinity
          guide.style.height = "0px"; // Will be updated when expanded
        }
        children.appendChild(guide);

        container.appendChild(children);

        let loaded = false;
        item.addEventListener("click", async (e) => {
          e.stopPropagation();
          const chevron = item.querySelector(".chevron");
          const iconEl = item.querySelector(".icon-wrapper");
          if (!loaded) {
            await loadDirectory(fullPath, children, depth + 1);
            loaded = true;
          }
          const isExpanded = children.classList.toggle("expanded");
          if (chevron) chevron.innerHTML = isExpanded ? chevronDown : chevronRight;
          if (iconEl) iconEl.innerHTML = getFolderIcon(entry.name, isExpanded);

          // Update guide line height based on content
          if (isExpanded) {
            requestAnimationFrame(() => {
              guide.style.height = `${children.scrollHeight}px`;
            });
          }
        });
      } else {
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          openFile(fullPath, entry.name);
        });
      }
    });
  } catch (err) {
    console.error("Failed to load directory:", err);
  }
}

// ---- Tabs ----
function renderTabs() {
  tabBar.innerHTML = "";
  for (const [path, tab] of tabs) {
    const tabEl = document.createElement("div");
    tabEl.className = `tab${path === activeTabPath ? " active" : ""}${tab.modified ? " modified" : ""}`;

    // Tab icon
    const tabIcon = document.createElement("span");
    tabIcon.className = "tab-icon";
    tabIcon.innerHTML = getFileIcon(tab.name);
    tabEl.appendChild(tabIcon);

    const nameEl = document.createElement("span");
    nameEl.className = "tab-name";
    nameEl.textContent = tab.name;
    tabEl.appendChild(nameEl);

    const closeEl = document.createElement("span");
    closeEl.className = "tab-close";
    closeEl.textContent = "\u00D7";
    closeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(path);
    });
    tabEl.appendChild(closeEl);

    tabEl.addEventListener("click", () => switchTab(path));

    // Drag to reorder
    tabEl.draggable = true;
    tabEl.dataset.path = path;
    tabEl.addEventListener("dragstart", (e) => {
      e.dataTransfer!.setData("text/plain", path);
      tabEl.classList.add("dragging");
    });
    tabEl.addEventListener("dragend", () => {
      tabEl.classList.remove("dragging");
    });
    tabEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      tabEl.classList.add("drag-over");
    });
    tabEl.addEventListener("dragleave", () => {
      tabEl.classList.remove("drag-over");
    });
    tabEl.addEventListener("drop", (e) => {
      e.preventDefault();
      tabEl.classList.remove("drag-over");
      const fromPath = e.dataTransfer!.getData("text/plain");
      if (fromPath && fromPath !== path) {
        // Reorder tabs map
        const entries = Array.from(tabs.entries());
        const fromIdx = entries.findIndex(([p]) => p === fromPath);
        const toIdx = entries.findIndex(([p]) => p === path);
        if (fromIdx >= 0 && toIdx >= 0) {
          const [moved] = entries.splice(fromIdx, 1);
          entries.splice(toIdx, 0, moved);
          tabs.clear();
          for (const [p, t] of entries) tabs.set(p, t);
          renderTabs();
        }
      }
    });

    tabBar.appendChild(tabEl);
  }
  // Persist session
  saveSession(rootPath, Array.from(tabs.keys()), activeTabPath);
}

function switchTab(path: string) {
  if (activeTabPath && editorView) {
    const currentTab = tabs.get(activeTabPath);
    if (currentTab) {
      currentTab.editorState = editorView.state;
    }
  }

  activeTabPath = path;
  const tab = tabs.get(path);
  if (tab && tab.editorState) {
    setEditorContent(tab.editorState);
  }

  statusFile.textContent = path;
  renderTabs();
  highlightActiveFile();
}

function closeTab(path: string) {
  tabs.delete(path);
  if (activeTabPath === path) {
    const remaining = Array.from(tabs.keys());
    if (remaining.length > 0) {
      switchTab(remaining[remaining.length - 1]);
    } else {
      activeTabPath = null;
      if (editorView) {
        editorView.destroy();
        editorView = null;
      }
      showWelcome();
      statusFile.textContent = "No file open";
    }
  }
  renderTabs();
}

// ---- Welcome screen ----
function showWelcome() {
  editorContainer.innerHTML = `
    <div id="welcome" class="fade-in">
      <div class="welcome-glow welcome-glow-1"></div>
      <div class="welcome-glow welcome-glow-2"></div>
      <div class="welcome-inner">
        <h1>Zauri</h1>
        <p class="subtitle">Pick a workspace item or start something new</p>
        <div class="welcome-buttons">
          <button class="welcome-btn primary" id="welcome-open-folder">Open folder</button>
          <button class="welcome-btn" id="welcome-new-file">New file</button>
        </div>
        <div class="welcome-shortcuts">
          <div class="welcome-shortcut featured">
            <span class="shortcut-key">${formatShortcut("Cmd+L", true)}</span>
            <span class="shortcut-label">AI assistant</span>
            <span class="shortcut-badge">NEW</span>
          </div>
          <div class="welcome-shortcut">
            <span class="shortcut-key">${formatShortcut("Cmd+O", true)}</span>
            <span class="shortcut-label">Open folder</span>
          </div>
          <div class="welcome-shortcut">
            <span class="shortcut-key">${formatShortcut("Cmd+Shift+F", true)}</span>
            <span class="shortcut-label">Search in files</span>
          </div>
          <div class="welcome-shortcut">
            <span class="shortcut-key">${formatShortcut("Cmd+`", true)}</span>
            <span class="shortcut-label">Terminal</span>
          </div>
          <div class="welcome-shortcut">
            <span class="shortcut-key">${formatShortcut("Cmd+Shift+G", true)}</span>
            <span class="shortcut-label">Git</span>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById("welcome-open-folder")?.addEventListener("click", openFolder);
}

// ---- File operations ----
async function openFile(path: string, name: string) {
  const t0 = performance.now();

  if (tabs.has(path)) {
    switchTab(path);
    return;
  }

  try {
    const content: string = await invoke("read_file", { path });
    const t1 = performance.now();

    const state = createEditorState(content, name);
    tabs.set(path, {
      path,
      name,
      content,
      modified: false,
      editorState: state,
    });

    activeTabPath = path;
    setEditorContent(state);
    renderTabs();

    statusFile.textContent = path;
    statusPerf.textContent = `Opened in ${(t1 - t0).toFixed(1)}ms`;
    highlightActiveFile();

    // Connect LSP for this file
    if (editorView && rootPath) {
      connectLsp(editorView, path, rootPath, content);
    }

    // Auto-preview HTML files
    if (isPreviewable(name)) {
      showPreview(path, content);
    } else if (isPreviewOpen() && getPreviewPath() !== path) {
      // Keep preview if switching between files
    }
  } catch (err) {
    console.error("Failed to open file:", err);
    statusPerf.textContent = `Error: ${err}`;
  }
}

async function saveCurrentFile() {
  if (!activeTabPath || !editorView) return;
  const tab = tabs.get(activeTabPath);
  if (!tab) return;

  const t0 = performance.now();
  const content = editorView.state.doc.toString();

  try {
    await invoke("write_file", { path: activeTabPath, content });
    const t1 = performance.now();

    tab.content = content;
    tab.modified = false;
    renderTabs();

    // Live-reload preview if this file is being previewed
    if (isPreviewOpen() && getPreviewPath() === activeTabPath) {
      updatePreviewContent(content);
    }

    statusPerf.textContent = `Saved in ${(t1 - t0).toFixed(1)}ms`;
  } catch (err) {
    console.error("Failed to save:", err);
    statusPerf.textContent = `Save error: ${err}`;
  }
}

// ---- Search ----
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

async function performSearch(query: string) {
  if (!rootPath || query.length < 2) {
    searchResults.innerHTML = "";
    return;
  }

  const t0 = performance.now();
  try {
    const matches: SearchMatch[] = await invoke("search_files", {
      rootPath,
      query,
    });
    const t1 = performance.now();

    searchResults.innerHTML = "";
    for (const match of matches) {
      const el = document.createElement("div");
      el.className = "search-result";

      const relPath = match.file.startsWith(rootPath!)
        ? match.file.slice(rootPath!.length + 1)
        : match.file;

      el.innerHTML = `
        <span class="file-path">${escapeHtml(relPath)}</span>
        <span class="line-num">:${match.line}</span>
        <span class="match-text">${escapeHtml(match.text)}</span>
      `;
      el.addEventListener("click", () => {
        const name = relPath.split("/").pop() || relPath;
        openFile(match.file, name);
      });
      searchResults.appendChild(el);
    }

    statusPerf.textContent = `Search: ${matches.length} results in ${(t1 - t0).toFixed(1)}ms`;
  } catch (err) {
    console.error("Search failed:", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toggleSearch() {
  searchPanel.classList.toggle("hidden");
  if (!searchPanel.classList.contains("hidden")) {
    searchInput.focus();
  }
}

// ---- Folder open ----
async function openFolder() {
  const selected = await open({ directory: true, multiple: false });
  if (selected && typeof selected === "string") {
    rootPath = selected;
    setPreviewRootPath(rootPath);
    fileTree.innerHTML = "";
    await loadDirectory(selected, fileTree);
    // Update titlebar
    const folderName = selected.split("/").pop() || selected;
    updateTitlebar(folderName);
    // Auto-create project for this folder
    await createProject(folderName, selected);
    renderProjects();
    refreshStatus();
  }
}

async function openProjectFolder(workspaceRoot: string) {
  rootPath = workspaceRoot;
  setPreviewRootPath(rootPath);
  fileTree.innerHTML = "";
  await loadDirectory(workspaceRoot, fileTree);
  refreshStatus();
}

// ---- Highlight active file in tree ----
function updateTitlebar(projectName?: string) {
  const el = document.getElementById("titlebar-project");
  if (el) {
    if (projectName) {
      el.textContent = projectName;
    } else if (rootPath) {
      el.textContent = rootPath.split("/").pop() || "";
    }
  }
}

function highlightActiveFile() {
  document.querySelectorAll(".tree-item.active").forEach((el) => {
    el.classList.remove("active");
  });
  if (activeTabPath) {
    document.querySelectorAll(".tree-item").forEach((el) => {
      if ((el as HTMLElement).dataset.path === activeTabPath) {
        el.classList.add("active");
      }
    });
  }
}

// ---- Keyboard shortcuts ----
document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;

  if (mod && e.key === "w") {
    e.preventDefault();
    if (activeTabPath) closeTab(activeTabPath);
  } else if (mod && e.key === "s") {
    e.preventDefault();
    saveCurrentFile();
  } else if (mod && e.key === "o") {
    e.preventDefault();
    openFolder();
  } else if (mod && e.shiftKey && (e.key === "P" || e.key === "p")) {
    e.preventDefault();
    showCommandPalette();
  } else if (mod && e.shiftKey && (e.key === "F" || e.key === "f")) {
    e.preventDefault();
    toggleSearch();
  } else if (mod && e.key === "l") {
    e.preventDefault();
    toggleAIPanel();
  } else if (mod && e.key === "`") {
    e.preventDefault();
    toggleTerminal();
  } else if (mod && e.key === ",") {
    e.preventDefault();
    showSettings();
  } else if (mod && e.shiftKey && (e.key === "G" || e.key === "g")) {
    e.preventDefault();
    toggleGitPanel();
  } else if (e.key === "Escape") {
    // Close modals/panels in priority order
    const settingsModal = document.getElementById("settings-modal");
    const aboutModal = document.getElementById("about-modal");
    if (settingsModal && !settingsModal.classList.contains("hidden")) {
      settingsModal.classList.add("hidden");
    } else if (aboutModal && !aboutModal.classList.contains("hidden")) {
      aboutModal.classList.add("hidden");
    } else {
      const aiPanel = document.getElementById("ai-panel");
      if (aiPanel && !aiPanel.classList.contains("hidden")) {
        aiPanel.classList.add("hidden");
      } else if (!searchPanel.classList.contains("hidden")) {
        searchPanel.classList.add("hidden");
      }
    }
  }
});

// ---- Event listeners ----
document.getElementById("open-folder-btn")?.addEventListener("click", openFolder);
// Wire initial welcome screen buttons (HTML version)
document.getElementById("welcome-open-folder")?.addEventListener("click", openFolder);
searchClose.addEventListener("click", () => searchPanel.classList.add("hidden"));

searchInput.addEventListener("input", () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    performSearch(searchInput.value);
  }, 300);
});

// ---- Terminal setup ----
const terminalPanelEl = createTerminalPanel();
// Insert terminal before the search panel in #main
const mainEl = document.getElementById("main")!;
mainEl.insertBefore(terminalPanelEl, searchPanel);
initTerminal(() => rootPath);

// ---- Projects & Threads ----

let activeThreadId: string | null = null;
const projectsList = document.getElementById("projects-list")!;

function renderProjects() {
  const projects = getProjects();
  projectsList.innerHTML = "";

  if (projects.length === 0) {
    projectsList.innerHTML = `<div class="projects-empty">Open a folder to create a project</div>`;
    return;
  }

  for (const project of projects) {
    const threads = getThreadsForProject(project.id);
    const el = document.createElement("div");
    el.className = "project-item";

    const header = document.createElement("div");
    header.className = "project-header";
    header.innerHTML = `
      <span class="project-chevron">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="project-folder-icon">
        <path d="M1.5 2.5h4l1.5 1.5h7.5v9.5h-13z" fill="#8b8b96" opacity="0.6"/>
        <path d="M1.5 4h13v8.5a1 1 0 01-1 1h-11a1 1 0 01-1-1z" fill="#8b8b96" opacity="0.4"/>
      </svg>
      <span class="project-name">${escapeHtml(project.title)}</span>
    `;

    const threadList = document.createElement("div");
    threadList.className = "project-threads expanded";

    // New thread button
    const newThreadBtn = document.createElement("div");
    newThreadBtn.className = "thread-item thread-new";
    newThreadBtn.textContent = "+ New thread";
    newThreadBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const thread = await createThread(project.id);
      activeThreadId = thread.id;
      renderProjects();
    });
    threadList.appendChild(newThreadBtn);

    for (const thread of threads) {
      const threadEl = document.createElement("div");
      threadEl.className = `thread-item${thread.id === activeThreadId ? " active" : ""}`;
      threadEl.innerHTML = `
        <span class="thread-title">${escapeHtml(thread.title)}</span>
        <span class="thread-time">${timeAgo(thread.createdAt)}</span>
        <button class="thread-delete" title="Delete thread">&times;</button>
      `;
      threadEl.querySelector(".thread-title")!.addEventListener("click", (e) => {
        e.stopPropagation();
        switchToThread(thread, project.workspaceRoot);
      });
      threadEl.querySelector(".thread-delete")!.addEventListener("click", async (e) => {
        e.stopPropagation();
        await deleteThread(thread.id);
        if (activeThreadId === thread.id) {
          activeThreadId = null;
          const aiMessages = document.getElementById("ai-messages");
          if (aiMessages) aiMessages.innerHTML = "";
        }
        renderProjects();
      });
      threadList.appendChild(threadEl);
    }

    header.addEventListener("click", () => {
      threadList.classList.toggle("expanded");
      const chevron = header.querySelector(".project-chevron");
      if (chevron) {
        chevron.innerHTML = threadList.classList.contains("expanded")
          ? `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          : `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      }
      // Open project folder on click
      openProjectFolder(project.workspaceRoot);
    });

    el.appendChild(header);
    el.appendChild(threadList);
    projectsList.appendChild(el);
  }
}

function switchToThread(thread: Thread, workspaceRoot: string) {
  activeThreadId = thread.id;
  // Load messages into AI panel
  const aiMessages = document.getElementById("ai-messages");
  const aiPanel = document.getElementById("ai-panel");
  if (aiPanel && thread.provider) {
    (aiPanel as any)._setProvider?.(thread.provider);
  }
  if (aiMessages) {
    aiMessages.innerHTML = "";
    for (const msg of thread.messages) {
      aiMessages.appendChild(createMessageEl(msg.role, msg.content));
    }
    // Scroll to bottom
    requestAnimationFrame(() => {
      aiMessages.scrollTop = aiMessages.scrollHeight;
    });
  }
  // Restore token usage, model/permission, and placeholder for this thread
  if (aiPanel) {
    (aiPanel as any)._restoreUsage?.(thread.id);
    (aiPanel as any)._updatePlaceholder?.(thread.messages.length > 0);
    if (thread.model && thread.permissionMode) {
      (aiPanel as any)._setModelAndPermission?.(thread.model, thread.permissionMode);
    }
  }

  // Open the project folder if not already open
  if (rootPath !== workspaceRoot) {
    openProjectFolder(workspaceRoot);
  }
  renderProjects();
}

// Wire up new project button
document.getElementById("new-project-btn")?.addEventListener("click", openFolder);

// Load projects on startup
onStoreChange(renderProjects);

// ---- AI Code Edit Integration ----

/** Get file content from open tab or null */
function getFileContent(path: string): string | null {
  const tab = tabs.get(path);
  if (tab && tab.editorState) {
    return tab.editorState.doc.toString();
  }
  return tab?.content || null;
}

/** Show proposed edit diff in the editor */
function showProposedEdit(edit: ProposedEdit) {
  addPendingEdit(edit);

  // Open the file if not already open, then switch to it
  const tab = tabs.get(edit.filePath);
  const name = edit.filePath.split("/").pop() || edit.filePath;

  if (tab) {
    // Replace editor content with proposed content and show diff
    const state = createEditorState(edit.newContent, name);
    tab.editorState = state;
    if (activeTabPath === edit.filePath) {
      setEditorContent(state);
      if (editorView) {
        activateDiff(editorView, edit.originalContent, edit.newContent, () => acceptEdit(edit.filePath), () => rejectEdit(edit.filePath));
      }
    } else {
      switchTab(edit.filePath);
      requestAnimationFrame(() => {
        if (editorView) {
          activateDiff(editorView, edit.originalContent, edit.newContent, () => acceptEdit(edit.filePath), () => rejectEdit(edit.filePath));
        }
      });
    }
  } else {
    // File not open — open it with proposed content
    const state = createEditorState(edit.newContent, name);
    tabs.set(edit.filePath, {
      path: edit.filePath,
      name,
      content: edit.originalContent,
      modified: true,
      editorState: state,
    });
    activeTabPath = edit.filePath;
    setEditorContent(state);
    renderTabs();
    requestAnimationFrame(() => {
      if (editorView) {
        activateDiff(editorView, edit.originalContent, edit.newContent, () => acceptEdit(edit.filePath), () => rejectEdit(edit.filePath));
      }
    });
  }
  renderTabs();
  updateRevertUI();
}

/** Accept an AI edit — save to disk */
async function acceptEdit(filePath: string) {
  const edit = pendingEdits.get(filePath);
  if (!edit) return;

  // Snapshot before accepting
  const snapshot = new Map<string, string>();
  snapshot.set(filePath, edit.originalContent);
  pushSnapshot(`AI edit: ${filePath.split("/").pop()}`, snapshot);

  // Write to disk
  try {
    await invoke("write_file", { path: filePath, content: edit.newContent });
  } catch (err) {
    console.error("Failed to save:", err);
  }

  // Update tab state
  const tab = tabs.get(filePath);
  if (tab) {
    tab.content = edit.newContent;
    tab.modified = false;
  }

  // Clear diff decorations
  removePendingEdit(filePath);
  if (editorView && activeTabPath === filePath) {
    clearDiff(editorView);
  }

  renderTabs();
  updateRevertUI();
  statusPerf.textContent = "Changes accepted";
}

/** Reject an AI edit — restore original */
async function rejectEdit(filePath: string) {
  const edit = pendingEdits.get(filePath);
  if (!edit) return;

  try {
    await invoke("write_file", { path: filePath, content: edit.originalContent });
  } catch (err) {
    console.error("Failed to restore file:", err);
  }

  // Restore original content in editor
  const tab = tabs.get(filePath);
  const name = filePath.split("/").pop() || filePath;
  if (tab) {
    const state = createEditorState(edit.originalContent, name);
    tab.editorState = state;
    tab.content = edit.originalContent;
    tab.modified = false;
    if (activeTabPath === filePath) {
      setEditorContent(state);
    }
  }

  removePendingEdit(filePath);
  renderTabs();
  updateRevertUI();
  statusPerf.textContent = "Changes rejected";
}

/** Accept all pending edits */
async function acceptAllEdits() {
  const paths = Array.from(pendingEdits.keys());
  for (const path of paths) {
    await acceptEdit(path);
  }
}

/** Reject all pending edits */
function rejectAllEdits() {
  const paths = Array.from(pendingEdits.keys());
  for (const path of paths) {
    void rejectEdit(path);
  }
}

/** Revert last AI edit from history */
async function revertLast() {
  const snapshot = await revertLastSnapshot(async (path, content) => {
    await invoke("write_file", { path, content });
    const tab = tabs.get(path);
    const name = path.split("/").pop() || path;
    if (tab) {
      const state = createEditorState(content, name);
      tab.editorState = state;
      tab.content = content;
      tab.modified = false;
      if (activeTabPath === path) {
        setEditorContent(state);
      }
    }
  });
  if (snapshot) {
    statusPerf.textContent = `Reverted: ${snapshot.description}`;
  }
  renderTabs();
  updateRevertUI();
}

/** Update revert button visibility in status bar */
function updateRevertUI() {
  const revertBtn = document.getElementById("status-revert");
  if (revertBtn) {
    revertBtn.style.display = canRevert() ? "inline" : "none";
  }
}

// ---- AI Panel setup ----
const aiPanelEl = createAIPanel();
document.getElementById("app")!.appendChild(aiPanelEl);
initAIPanel(
  () => activeTabPath,
  () => Array.from(tabs.keys()),
  () => rootPath,
  { getFileContent, showProposedEdit, acceptAllEdits, rejectAllEdits },
  {
    getActiveThreadId: () => activeThreadId,
    getSessionId: () => activeThreadId ? getThreadSessionId(activeThreadId) : undefined,
    ensureActiveThread: async () => {
      if (activeThreadId) return activeThreadId;
      if (!rootPath) return null;

      const projectName = rootPath.split("/").pop() || rootPath;
      const project = findProjectByRoot(rootPath) || await createProject(projectName, rootPath);
      const thread = await createThread(project.id);
      activeThreadId = thread.id;
      renderProjects();
      return thread.id;
    },
    saveMessage: async (role: "user" | "assistant", content: string) => {
      if (activeThreadId) {
        await addMessageToThread(activeThreadId, role, content);
        renderProjects();
      }
    },
    saveSessionId: async (sid: string) => {
      if (activeThreadId) {
        await setThreadSessionId(activeThreadId, sid);
      }
    },
    clearSessionId: async () => {
      if (activeThreadId) {
        await clearThreadSessionId(activeThreadId);
      }
    },
    saveModelAndPermission: async (model: string, permissionMode: string) => {
      if (activeThreadId) {
        await setThreadModelAndPermission(activeThreadId, model, permissionMode);
      }
    },
    forkAndSwitch: async () => {
      if (!activeThreadId || !rootPath) return;
      const currentProvider = getThreadProvider(activeThreadId) || "claude";
      const forked = await forkThread(activeThreadId, currentProvider, "new session");
      if (forked) {
        switchToThread(forked, rootPath);
        renderProjects();
      }
    },
  },
);

// Wire up sidebar buttons
document.getElementById("search-btn")?.addEventListener("click", toggleSearch);
document.getElementById("settings-btn")?.addEventListener("click", showSettings);
document.getElementById("status-git-branch")?.addEventListener("click", (e) => {
  showBranchSelector(e.currentTarget as HTMLElement);
});

// Sidebar git bar
document.getElementById("sidebar-branch-btn")?.addEventListener("click", (e) => {
  showBranchSelector(e.currentTarget as HTMLElement);
});
document.getElementById("sidebar-git-actions-btn")?.addEventListener("click", toggleGitPanel);

// Status bar quick actions
document.getElementById("status-terminal-btn")?.addEventListener("click", toggleTerminal);
document.getElementById("status-ai-btn")?.addEventListener("click", toggleAIPanel);
document.getElementById("status-about-btn")?.addEventListener("click", showAbout);

// ---- Resize handles ----
function setupResize(
  handle: HTMLElement | null,
  target: HTMLElement,
  axis: "x" | "y",
  invert: boolean = false,
) {
  if (!handle) return;
  let startPos = 0;
  let startSize = 0;

  handle.addEventListener("mousedown", (e) => {
    startPos = axis === "x" ? e.clientX : e.clientY;
    startSize = axis === "x" ? target.offsetWidth : target.offsetHeight;
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();

    const onMove = (e: MouseEvent) => {
      const current = axis === "x" ? e.clientX : e.clientY;
      const diff = invert ? startPos - current : current - startPos;
      const newSize = startSize + diff;
      if (axis === "x") {
        target.style.width = `${newSize}px`;
      } else {
        target.style.height = `${newSize}px`;
      }
    };

    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

const sidebar = document.getElementById("sidebar")!;
setupResize(document.getElementById("sidebar-resize"), sidebar, "x");
setupResize(document.getElementById("terminal-resize"), terminalPanelEl, "y", true);

// Revert button
document.getElementById("status-revert")?.addEventListener("click", revertLast);

// Load projects and restore session on startup
loadProjects().then(async () => {
  renderProjects();
  // Restore previous session
  const session = getSession();
  if (session?.rootPath) {
    rootPath = session.rootPath;
    setPreviewRootPath(rootPath);
    updateTitlebar();
    fileTree.innerHTML = "";
    await loadDirectory(session.rootPath, fileTree);
    refreshStatus();
    // Reopen files
    if (session.openFiles?.length) {
      for (const filePath of session.openFiles) {
        const name = filePath.split("/").pop() || filePath;
        try {
          await openFile(filePath, name);
        } catch { /* file may not exist anymore */ }
      }
      // Switch to last active file
      if (session.activeFile && tabs.has(session.activeFile)) {
        switchTab(session.activeFile);
      }
    }
  }
});

// Listen for thread fork events from AI panel
// Handle clickable file paths from AI panel
window.addEventListener("zauri-open-file", ((e: CustomEvent) => {
  const filePath = e.detail?.path;
  if (!filePath || !rootPath) return;
  // Resolve relative path against rootPath
  const fullPath = filePath.startsWith("/") ? filePath : `${rootPath}/${filePath}`;
  const name = fullPath.split("/").pop() || fullPath;
  openFile(fullPath, name);
}) as EventListener);

window.addEventListener("zauri-switch-thread", ((e: CustomEvent) => {
  const { threadId, skipLoadMessages } = e.detail;
  if (!threadId) return;
  const allProjects = getProjects();
  for (const project of allProjects) {
    const threads = getThreadsForProject(project.id);
    const thread = threads.find((t: Thread) => t.id === threadId);
    if (thread) {
      if (skipLoadMessages) {
        // Just update the active thread ID without reloading messages
        activeThreadId = thread.id;
        if (rootPath !== project.workspaceRoot) {
          openProjectFolder(project.workspaceRoot);
        }
      } else {
        switchToThread(thread, project.workspaceRoot);
      }
      renderProjects();
      const aiPanel = document.getElementById("ai-panel");
      if (aiPanel?.classList.contains("hidden")) {
        toggleAIPanel();
      }
      break;
    }
  }
}) as EventListener);

// Init git status polling
initGitStatus(() => rootPath);

// Load settings
loadSettingsFromDisk();

// ---- Startup ----
window.addEventListener("DOMContentLoaded", () => {
  const loadTime = performance.now() - startTime;
  statusPerf.textContent = `Ready in ${loadTime.toFixed(0)}ms`;
  console.log(`[perf] Frontend DOM ready: ${loadTime.toFixed(1)}ms`);

  void (async () => {
    const reopenedAfterUpdate = await handlePostUpdateLaunch();
    if (reopenedAfterUpdate) {
      showAbout();
      return;
    }

    window.setTimeout(() => {
      void checkForUpdates(true, "startup");
    }, 3000);
  })();

  // Register command palette commands
  registerCommands([
    { id: "file.open", label: "Open Folder", shortcut: formatShortcut("Cmd+O"), category: "File", action: openFolder },
    { id: "file.save", label: "Save File", shortcut: formatShortcut("Cmd+S"), category: "File", action: saveCurrentFile },
    { id: "file.close", label: "Close Tab", shortcut: formatShortcut("Cmd+W"), category: "File", action: () => { if (activeTabPath) closeTab(activeTabPath); } },
    { id: "view.terminal", label: "Toggle Terminal", shortcut: formatShortcut("Cmd+`"), category: "View", action: toggleTerminal },
    { id: "view.ai", label: "Toggle AI Assistant", shortcut: formatShortcut("Cmd+L"), category: "View", action: toggleAIPanel },
    { id: "view.search", label: "Search in Files", shortcut: formatShortcut("Cmd+Shift+F"), category: "View", action: toggleSearch },
    { id: "view.settings", label: "Open Settings", shortcut: formatShortcut("Cmd+,"), category: "View", action: showSettings },
    { id: "view.about", label: "About Zauri", category: "View", action: showAbout },
    { id: "git.panel", label: "Git Actions", shortcut: formatShortcut("Cmd+Shift+G"), category: "Git", action: toggleGitPanel },
    { id: "git.branch", label: "Switch Branch", category: "Git", action: () => showBranchSelector() },
    { id: "editor.palette", label: "Command Palette", shortcut: formatShortcut("Cmd+Shift+P"), category: "Editor", action: showCommandPalette },
    { id: "view.preview", label: "Toggle Preview", category: "View", action: () => {
      if (isPreviewOpen()) { hidePreview(); }
      else if (activeTabPath && editorView) {
        showPreview(activeTabPath, editorView.state.doc.toString());
      }
    }},
    { id: "editor.updates", label: "Check for Updates", category: "Editor", action: () => checkForUpdates(false, "command") },
  ]);
});
