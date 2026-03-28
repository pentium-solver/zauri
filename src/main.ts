import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { searchKeymap } from "@codemirror/search";

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
const openFolderBtn = document.getElementById("open-folder-btn")!;

// ---- Language detection ----
function getLanguageExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
      return javascript();
    case "ts":
    case "tsx":
    case "mts":
      return javascript({ typescript: true, jsx: ext.includes("x") });
    case "py":
    case "pyw":
      return python();
    case "html":
    case "htm":
    case "svelte":
    case "vue":
      return html();
    case "css":
    case "scss":
    case "less":
      return css();
    case "json":
    case "jsonc":
      return json();
    case "md":
    case "mdx":
      return markdown();
    case "rs":
      return rust();
    case "c":
    case "h":
    case "cpp":
    case "cxx":
    case "cc":
    case "hpp":
    case "zig":
      return cpp();
    default:
      return [];
  }
}

// ---- Editor ----
function createEditorState(content: string, filename: string): EditorState {
  return EditorState.create({
    doc: content,
    extensions: [
      basicSetup,
      oneDark,
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

// ---- File tree ----
async function loadDirectory(path: string, container: HTMLElement, depth = 0) {
  try {
    const entries: DirEntry[] = await invoke("list_directory", { path });

    for (const entry of entries) {
      const item = document.createElement("div");
      item.className = "tree-item";
      item.style.paddingLeft = `${8 + depth * 16}px`;

      const icon = document.createElement("span");
      icon.className = "icon";
      icon.textContent = entry.is_dir ? "\u{1F4C1}" : "\u{1F4C4}";

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = entry.name;

      item.appendChild(icon);
      item.appendChild(name);
      container.appendChild(item);

      const fullPath = `${path}/${entry.name}`;

      if (entry.is_dir) {
        const children = document.createElement("div");
        children.className = "tree-children";
        container.appendChild(children);

        let loaded = false;
        item.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!loaded) {
            await loadDirectory(fullPath, children, depth + 1);
            loaded = true;
          }
          children.classList.toggle("expanded");
          icon.textContent = children.classList.contains("expanded")
            ? "\u{1F4C2}"
            : "\u{1F4C1}";
        });
      } else {
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          openFile(fullPath, entry.name);
        });
      }
    }
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

    const nameEl = document.createElement("span");
    nameEl.className = "tab-name";
    nameEl.textContent = tab.name;

    const closeEl = document.createElement("span");
    closeEl.className = "tab-close";
    closeEl.textContent = "\u00D7";
    closeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(path);
    });

    tabEl.appendChild(nameEl);
    tabEl.appendChild(closeEl);
    tabEl.addEventListener("click", () => switchTab(path));
    tabBar.appendChild(tabEl);
  }
}

function switchTab(path: string) {
  // Save current editor state
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
      editorContainer.innerHTML =
        '<div id="welcome"><h1>Zauri</h1><p>Open a file from the tree</p></div>';
      statusFile.textContent = "No file open";
    }
  }
  renderTabs();
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

      // Show relative path
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
  // Simple approach: find by text content match
  if (activeTabPath) {
    const name = activeTabPath.split("/").pop();
    document.querySelectorAll(".tree-item").forEach((el) => {
      const nameEl = el.querySelector(".name");
      if (nameEl && nameEl.textContent === name) {
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
  } else if (mod && e.shiftKey && e.key === "F") {
    e.preventDefault();
    toggleSearch();
  } else if (e.key === "Escape") {
    if (!searchPanel.classList.contains("hidden")) {
      searchPanel.classList.add("hidden");
    }
  }
});

// ---- Event listeners ----
openFolderBtn.addEventListener("click", openFolder);
searchClose.addEventListener("click", () => searchPanel.classList.add("hidden"));

searchInput.addEventListener("input", () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    performSearch(searchInput.value);
  }, 300);
});

// ---- Startup metrics ----
window.addEventListener("DOMContentLoaded", () => {
  const loadTime = performance.now() - startTime;
  statusPerf.textContent = `Ready in ${loadTime.toFixed(0)}ms`;
  console.log(`[perf] Frontend DOM ready: ${loadTime.toFixed(1)}ms`);
});
