// Custom right-click context menu for the editor

import { EditorView } from "@codemirror/view";
import { isLspActive } from "./lsp-client";

let menuEl: HTMLElement | null = null;

interface MenuAction {
  label: string;
  icon?: string;
  shortcut?: string;
  divider?: boolean;
  action?: () => void;
  disabled?: boolean;
}

function closeMenu() {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
  document.removeEventListener("click", closeMenu);
  document.removeEventListener("contextmenu", closeOnNextContext);
}

function closeOnNextContext() {
  closeMenu();
}

export function showContextMenu(
  x: number,
  y: number,
  view: EditorView,
  callbacks: {
    onGoToDefinition: () => void;
    onFindReferences: () => void;
    onRename: () => void;
    onAskAI: (text: string) => void;
  },
) {
  closeMenu();

  const selection = view.state.selection.main;
  const hasSelection = selection.from !== selection.to;
  const selectedText = hasSelection ? view.state.sliceDoc(selection.from, selection.to) : "";
  const lspActive = isLspActive();

  const word = view.state.wordAt(selection.head);
  const wordText = word ? view.state.sliceDoc(word.from, word.to) : "";

  const actions: MenuAction[] = [
    ...(lspActive ? [
      { label: "Go to Definition", shortcut: "Cmd+Click", action: callbacks.onGoToDefinition, disabled: !wordText },
      { label: "Find References", shortcut: "Shift+F12", action: callbacks.onFindReferences, disabled: !wordText },
      { label: "Rename Symbol", shortcut: "F2", action: callbacks.onRename, disabled: !wordText },
      { divider: true } as MenuAction,
    ] : []),
    { label: "Cut", shortcut: "Cmd+X", action: () => { document.execCommand("cut"); }, disabled: !hasSelection },
    { label: "Copy", shortcut: "Cmd+C", action: () => { document.execCommand("copy"); }, disabled: !hasSelection },
    { label: "Paste", shortcut: "Cmd+V", action: () => { document.execCommand("paste"); } },
    { label: "Select All", shortcut: "Cmd+A", action: () => { view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); } },
    { divider: true } as MenuAction,
    {
      label: hasSelection ? "Ask AI about selection" : "Ask AI about this file",
      shortcut: "Cmd+L",
      action: () => callbacks.onAskAI(selectedText),
    },
  ];

  menuEl = document.createElement("div");
  menuEl.className = "context-menu";

  for (const action of actions) {
    if (action.divider) {
      const div = document.createElement("div");
      div.className = "context-menu-divider";
      menuEl.appendChild(div);
      continue;
    }

    const item = document.createElement("div");
    item.className = `context-menu-item${action.disabled ? " disabled" : ""}`;

    const label = document.createElement("span");
    label.className = "context-menu-label";
    label.textContent = action.label;

    item.appendChild(label);

    if (action.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.className = "context-menu-shortcut";
      shortcut.textContent = action.shortcut;
      item.appendChild(shortcut);
    }

    if (!action.disabled && action.action) {
      const fn = action.action;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        closeMenu();
        fn();
      });
    }

    menuEl.appendChild(item);
  }

  // Position — clamp to viewport
  document.body.appendChild(menuEl);
  const menuW = menuEl.offsetWidth;
  const menuH = menuEl.offsetHeight;
  const left = Math.min(x, window.innerWidth - menuW - 8);
  const top = Math.min(y, window.innerHeight - menuH - 8);
  menuEl.style.left = `${Math.max(4, left)}px`;
  menuEl.style.top = `${Math.max(4, top)}px`;

  // Close on click outside or next right-click
  setTimeout(() => {
    document.addEventListener("click", closeMenu);
    document.addEventListener("contextmenu", closeOnNextContext);
  }, 0);
}

/**
 * CM6 extension that intercepts right-click to show custom context menu.
 */
export function contextMenuExtension(callbacks: {
  onGoToDefinition: () => void;
  onFindReferences: () => void;
  onRename: () => void;
  onAskAI: (text: string) => void;
}) {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, view, callbacks);
      return true;
    },
  });
}
