// LSP Client: bridges CodeMirror 6 ↔ Tauri ↔ Language Server
// Handles go-to-definition, hover, autocomplete, diagnostics, rename, find references

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EditorView } from "@codemirror/view";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { hoverTooltip } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { type Extension } from "@codemirror/state";

// ---- State ----
let requestId = 0;
const pendingRequests = new Map<number, (result: any) => void>();
let activeKey: string | null = null;
let documentVersion = 0;

// ---- Tauri Event Listener ----
let listenerInitialized = false;

function initListener() {
  if (listenerInitialized) return;
  listenerInitialized = true;

  listen<string>("lsp-response", (event) => {
    try {
      const data = JSON.parse(event.payload);
      const msg = JSON.parse(data.message);

      // Response to a request
      if (msg.id !== undefined && pendingRequests.has(msg.id)) {
        const resolve = pendingRequests.get(msg.id)!;
        pendingRequests.delete(msg.id);
        resolve(msg.result || null);
      }

      // Notification from server (diagnostics, etc.)
      if (msg.method === "textDocument/publishDiagnostics" && msg.params) {
        handleDiagnostics(msg.params);
      }
    } catch {
      // Ignore parse errors
    }
  });
}

// ---- JSON-RPC helpers ----

function sendRequest(method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!activeKey) {
      reject("No LSP server active");
      return;
    }
    const id = ++requestId;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    pendingRequests.set(id, resolve);

    invoke("lsp_send", { key: activeKey, message: msg }).catch((e) => {
      pendingRequests.delete(id);
      reject(e);
    });

    // Timeout after 10s
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject("LSP request timeout");
      }
    }, 10000);
  });
}

function sendNotification(method: string, params: any) {
  if (!activeKey) return;
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
  invoke("lsp_send", { key: activeKey, message: msg }).catch(() => {});
}

// ---- Document Sync ----

export function notifyDidOpen(uri: string, languageId: string, text: string) {
  documentVersion = 1;
  sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId, version: documentVersion, text },
  });
}

export function notifyDidChange(uri: string, text: string) {
  documentVersion++;
  sendNotification("textDocument/didChange", {
    textDocument: { uri, version: documentVersion },
    contentChanges: [{ text }],
  });
}

export function notifyDidClose(uri: string) {
  sendNotification("textDocument/didClose", {
    textDocument: { uri },
  });
}

// ---- LSP Features ----

async function goToDefinition(view: EditorView, pos: number): Promise<{ uri: string; line: number; col: number } | null> {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineNum = line.number - 1; // 0-based
  const col = pos - line.from;

  try {
    const result = await sendRequest("textDocument/definition", {
      textDocument: { uri: currentUri },
      position: { line: lineNum, character: col },
    });

    if (!result) return null;
    const loc = Array.isArray(result) ? result[0] : result;
    if (!loc) return null;

    const range = loc.range || loc.targetRange;
    return {
      uri: loc.uri || loc.targetUri,
      line: (range?.start?.line || 0) + 1,
      col: (range?.start?.character || 0) + 1,
    };
  } catch {
    return null;
  }
}

async function getHover(view: EditorView, pos: number): Promise<string | null> {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);

  try {
    const result = await sendRequest("textDocument/hover", {
      textDocument: { uri: currentUri },
      position: { line: line.number - 1, character: pos - line.from },
    });

    if (!result?.contents) return null;
    const contents = result.contents;
    if (typeof contents === "string") return contents;
    if (contents.value) return contents.value;
    if (Array.isArray(contents)) return contents.map((c: any) => (typeof c === "string" ? c : c.value)).join("\n");
    return null;
  } catch {
    return null;
  }
}

async function getCompletions(view: EditorView, pos: number): Promise<any[]> {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);

  try {
    const result = await sendRequest("textDocument/completion", {
      textDocument: { uri: currentUri },
      position: { line: line.number - 1, character: pos - line.from },
    });

    if (!result) return [];
    const items = Array.isArray(result) ? result : result.items || [];
    return items;
  } catch {
    return [];
  }
}

export async function renameSymbol(view: EditorView, pos: number, newName: string): Promise<any> {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);

  return sendRequest("textDocument/rename", {
    textDocument: { uri: currentUri },
    position: { line: line.number - 1, character: pos - line.from },
    newName,
  });
}

export async function findReferences(view: EditorView, pos: number): Promise<any[]> {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);

  try {
    const result = await sendRequest("textDocument/references", {
      textDocument: { uri: currentUri },
      position: { line: line.number - 1, character: pos - line.from },
      context: { includeDeclaration: true },
    });
    return result || [];
  } catch {
    return [];
  }
}

// ---- Diagnostics Handler ----

let activeView: EditorView | null = null;
let currentUri = "";

function handleDiagnostics(params: { uri: string; diagnostics: any[] }) {
  if (!activeView || params.uri !== currentUri) return;

  const diagnostics: Diagnostic[] = params.diagnostics.map((d: any) => {
    const from = activeView!.state.doc.line(d.range.start.line + 1).from + d.range.start.character;
    const toLine = activeView!.state.doc.line(d.range.end.line + 1);
    const to = Math.min(toLine.from + d.range.end.character, toLine.to);
    return {
      from: Math.max(0, from),
      to: Math.max(from, to),
      severity: d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info",
      message: d.message,
      source: d.source || "lsp",
    };
  });

  activeView.dispatch(setDiagnostics(activeView.state, diagnostics));
}

// ---- CM6 Extensions ----

// Autocomplete source using LSP
function lspCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
  if (!activeKey || !context.view) return Promise.resolve(null);

  return getCompletions(context.view as EditorView, context.pos).then((items) => {
    if (!items.length) return null;

    const word = context.matchBefore(/\w*/);
    return {
      from: word?.from ?? context.pos,
      options: items.slice(0, 50).map((item: any) => ({
        label: item.label || item.insertText || "",
        type: kindToType(item.kind),
        detail: item.detail || "",
        info: item.documentation?.value || item.documentation || undefined,
        boost: item.sortText ? -parseInt(item.sortText, 10) || 0 : 0,
      })),
    };
  }).catch(() => null);
}

function kindToType(kind: number | undefined): string {
  const map: Record<number, string> = {
    1: "text", 2: "method", 3: "function", 4: "constructor",
    5: "property", 6: "variable", 7: "class", 8: "interface",
    9: "module", 10: "property", 11: "enum", 12: "keyword",
    13: "text", 14: "constant", 15: "namespace",
  };
  return map[kind || 0] || "text";
}

// Hover tooltip using LSP
const lspHoverTooltip = hoverTooltip(async (view: EditorView, pos: number) => {
  if (!activeKey) return null;
  const text = await getHover(view, pos);
  if (!text) return null;

  return {
    pos,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "lsp-hover-tooltip";
      // Render as code if it looks like a type signature
      if (text.includes("```")) {
        const cleaned = text.replace(/```\w*\n?/g, "").replace(/```/g, "");
        const pre = document.createElement("pre");
        pre.textContent = cleaned;
        dom.appendChild(pre);
      } else {
        dom.textContent = text;
      }
      return { dom };
    },
  };
});

// Cmd+Click go-to-definition
let onNavigate: ((uri: string, line: number) => void) | null = null;

const cmdClickHandler = EditorView.domEventHandlers({
  click(event, view) {
    if (!(event.metaKey || event.ctrlKey)) return false;
    if (!activeKey) return false;

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;

    event.preventDefault();
    goToDefinition(view, pos).then((loc) => {
      if (loc && onNavigate) {
        onNavigate(loc.uri, loc.line);
      }
    });
    return true;
  },
});

// Cmd+Click cursor style
const cmdClickCursor = EditorView.domEventHandlers({
  mousemove(event, view) {
    const el = view.dom;
    if (event.metaKey || event.ctrlKey) {
      el.style.cursor = "pointer";
    } else {
      el.style.cursor = "";
    }
  },
  mouseleave(_event, view) {
    view.dom.style.cursor = "";
  },
});

// Rename keybinding (F2)
const renameKeymap = keymap.of([{
  key: "F2",
  run(view) {
    if (!activeKey) return false;
    const pos = view.state.selection.main.head;
    const word = view.state.wordAt(pos);
    if (!word) return false;

    const currentName = view.state.sliceDoc(word.from, word.to);
    const newName = prompt(`Rename "${currentName}" to:`, currentName);
    if (!newName || newName === currentName) return true;

    renameSymbol(view, pos, newName).then((edit) => {
      if (edit?.changes) {
        // Apply workspace edit — for now just handle current document
        const docChanges = edit.changes[currentUri] || edit.documentChanges?.[0]?.edits;
        if (docChanges) {
          // Sort in reverse order so positions don't shift
          const sorted = [...docChanges].sort((a: any, b: any) =>
            b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character
          );
          const changes = sorted.map((change: any) => {
            const from = view.state.doc.line(change.range.start.line + 1).from + change.range.start.character;
            const to = view.state.doc.line(change.range.end.line + 1).from + change.range.end.character;
            return { from, to, insert: change.newText };
          });
          view.dispatch({ changes });
        }
      }
    }).catch(() => {});

    return true;
  },
}]);

// Find references (Shift+F12)
const refsKeymap = keymap.of([{
  key: "Shift-F12",
  run(view) {
    if (!activeKey) return false;
    const pos = view.state.selection.main.head;

    findReferences(view, pos).then((refs) => {
      if (!refs.length) return;
      // Emit event for main.ts to show references panel
      window.dispatchEvent(new CustomEvent("zauri-show-references", {
        detail: { references: refs },
      }));
    }).catch(() => {});

    return true;
  },
}]);

// ---- Public API ----

/**
 * Returns CM6 extensions for LSP integration.
 * Call once when creating editor state.
 */
export function lspExtensions(navigateFn: (uri: string, line: number) => void): Extension {
  onNavigate = navigateFn;
  initListener();

  return [
    autocompletion({ override: [lspCompletionSource] }),
    lspHoverTooltip,
    cmdClickHandler,
    cmdClickCursor,
    renameKeymap,
    refsKeymap,
  ];
}

/**
 * Connect the current editor view to LSP.
 * Call when switching files or opening new ones.
 */
export async function connectLsp(
  view: EditorView,
  filePath: string,
  rootPath: string,
  content: string,
): Promise<boolean> {
  activeView = view;
  currentUri = `file://${filePath}`;

  try {
    const key: string = await invoke("lsp_ensure_for_file", {
      filePath,
      workingDir: rootPath,
    });
    activeKey = key;

    // Initialize if first time
    if (documentVersion === 0) {
      // Send initialize request
      await sendRequest("initialize", {
        processId: null,
        capabilities: {
          textDocument: {
            completion: { completionItem: { snippetSupport: false } },
            hover: { contentFormat: ["plaintext", "markdown"] },
            definition: {},
            references: {},
            rename: { prepareSupport: false },
            publishDiagnostics: {},
          },
        },
        rootUri: `file://${rootPath}`,
        workspaceFolders: [{ uri: `file://${rootPath}`, name: rootPath.split("/").pop() }],
      });
      sendNotification("initialized", {});
    }

    // Notify file open
    const ext = filePath.split(".").pop() || "";
    const langId = extToLanguageId(ext);
    notifyDidOpen(currentUri, langId, content);

    return true;
  } catch (e) {
    console.log("[lsp] Not available:", e);
    activeKey = null;
    return false;
  }
}

function extToLanguageId(ext: string): string {
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact",
    rs: "rust", py: "python", go: "go", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    json: "json", html: "html", css: "css", md: "markdown",
  };
  return map[ext] || "plaintext";
}

/**
 * Notify LSP of document changes. Call on editor updates.
 */
export function notifyChange(content: string) {
  if (activeKey && currentUri) {
    notifyDidChange(currentUri, content);
  }
}

/**
 * Check if LSP is currently active.
 */
export function isLspActive(): boolean {
  return activeKey !== null;
}
