import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { searchKeymap } from "@codemirror/search";
import { getFileIcon, getFolderIcon, chevronRight, chevronDown } from "./icons";
import { getLanguageExtension } from "./languages";
import { createAIPanel, initAIPanel, toggleAIPanel } from "./ai-panel";
import { createTerminalPanel, initTerminal, toggleTerminal } from "./terminal";

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
    backgroundColor: "#050505 !important",
  },
  ".cm-gutters": {
    backgroundColor: "#050505 !important",
    borderRight: "1px solid #1e1e22 !important",
    color: "#55555e !important",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#141416 !important",
    color: "#8b8b96 !important",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(168, 85, 247, 0.04) !important",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(168, 85, 247, 0.2) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "#c084fc !important",
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
      getLanguageExtension(filename),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && activeTabPath) {
          const tab = tabs.get(activeTabPath);
          if (tab) {
            tab.modified = true;
            tab.editorState = update.state;
            renderTabs();
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
    tabBar.appendChild(tabEl);
  }
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
      <h1>Zauri</h1>
      <p class="subtitle">Pick a Workspace Item or Start Something New</p>
      <div class="actions">
        <button class="action-btn" id="welcome-open-folder">Open Folder</button>
      </div>
      <div class="shortcuts">
        <div class="shortcut"><kbd>Cmd+O</kbd> <span>Open Folder</span></div>
        <div class="shortcut"><kbd>Cmd+S</kbd> <span>Save File</span></div>
        <div class="shortcut"><kbd>Cmd+Shift+F</kbd> <span>Search in Files</span></div>
        <div class="shortcut"><kbd>Cmd+L</kbd> <span>AI Assistant</span></div>
        <div class="shortcut"><kbd>Cmd+\`</kbd> <span>Terminal</span></div>
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
    fileTree.innerHTML = "";
    await loadDirectory(selected, fileTree);
  }
}

// ---- Highlight active file in tree ----
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

  if (mod && e.key === "s") {
    e.preventDefault();
    saveCurrentFile();
  } else if (mod && e.key === "o") {
    e.preventDefault();
    openFolder();
  } else if (mod && e.shiftKey && (e.key === "F" || e.key === "f")) {
    e.preventDefault();
    toggleSearch();
  } else if (mod && e.key === "l") {
    e.preventDefault();
    toggleAIPanel();
  } else if (mod && e.key === "`") {
    e.preventDefault();
    toggleTerminal();
  } else if (e.key === "Escape") {
    const aiPanel = document.getElementById("ai-panel");
    if (aiPanel && !aiPanel.classList.contains("hidden")) {
      aiPanel.classList.add("hidden");
    } else if (!searchPanel.classList.contains("hidden")) {
      searchPanel.classList.add("hidden");
    }
  }
});

// ---- Event listeners ----
document.getElementById("open-folder-btn")?.addEventListener("click", openFolder);
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

// ---- AI Panel setup ----
const aiPanelEl = createAIPanel();
document.getElementById("app")!.appendChild(aiPanelEl);
initAIPanel(
  () => activeTabPath,
  () => Array.from(tabs.keys()),
  () => rootPath,
);

// Wire up sidebar buttons
document.getElementById("search-btn")?.addEventListener("click", toggleSearch);
document.getElementById("ai-btn")?.addEventListener("click", toggleAIPanel);
document.getElementById("terminal-btn")?.addEventListener("click", toggleTerminal);

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

// ---- Startup ----
window.addEventListener("DOMContentLoaded", () => {
  const loadTime = performance.now() - startTime;
  statusPerf.textContent = `Ready in ${loadTime.toFixed(0)}ms`;
  console.log(`[perf] Frontend DOM ready: ${loadTime.toFixed(1)}ms`);
});
