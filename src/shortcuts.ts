const isMacPlatform = /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");

const macSymbolMap: Record<string, string> = {
  Cmd: "\u2318",
  Ctrl: "\u2303",
  Shift: "\u21E7",
  Alt: "\u2325",
};

const macTextMap: Record<string, string> = {
  Cmd: "Cmd",
  Ctrl: "Ctrl",
  Shift: "Shift",
  Alt: "Option",
};

const otherTextMap: Record<string, string> = {
  Cmd: "Ctrl",
  Ctrl: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
};

const modifierOrder = ["Cmd", "Ctrl", "Alt", "Shift"] as const;

export interface ShortcutDefinition {
  id: string;
  label: string;
  category: string;
  defaultShortcut: string;
  description?: string;
}

export const shortcutDefinitions: ShortcutDefinition[] = [
  { id: "file.open", label: "Open Folder", category: "File", defaultShortcut: "Cmd+O" },
  { id: "file.quickOpen", label: "Quick Open", category: "File", defaultShortcut: "Cmd+P" },
  { id: "file.save", label: "Save File", category: "File", defaultShortcut: "Cmd+S" },
  { id: "file.close", label: "Close Tab", category: "File", defaultShortcut: "Cmd+W" },
  { id: "thread.new", label: "New Thread", category: "AI", defaultShortcut: "Cmd+Shift+N" },
  { id: "thread.archive", label: "Archive Thread", category: "AI", defaultShortcut: "Cmd+Alt+A" },
  { id: "view.ai", label: "Toggle AI Assistant", category: "View", defaultShortcut: "Cmd+L" },
  { id: "view.terminal", label: "Toggle Terminal", category: "View", defaultShortcut: "Cmd+`" },
  { id: "view.search", label: "Search In Files", category: "View", defaultShortcut: "Cmd+Shift+F" },
  { id: "view.settings", label: "Open Settings", category: "View", defaultShortcut: "Cmd+," },
  { id: "git.panel", label: "Git Actions", category: "Git", defaultShortcut: "Cmd+Shift+G" },
  { id: "editor.palette", label: "Command Palette", category: "Editor", defaultShortcut: "Cmd+Shift+P" },
  { id: "editor.wordWrap", label: "Toggle Word Wrap", category: "Editor", defaultShortcut: "Alt+Z" },
];

let shortcutOverrides: Record<string, string> = {};

export function isMac(): boolean {
  return isMacPlatform;
}

export function formatShortcut(shortcut: string, useSymbols: boolean = false): string {
  if (!shortcut) return "Unbound";
  const joiner = useSymbols && isMacPlatform ? " " : "+";
  const parts = shortcut.split("+").map((part) => part.trim());

  return parts
    .map((part) => {
      if (!isMacPlatform) {
        return otherTextMap[part] || part;
      }
      if (useSymbols) {
        return macSymbolMap[part] || part;
      }
      return macTextMap[part] || part;
    })
    .join(joiner);
}

function normalizeKeyName(rawKey: string): string | null {
  if (!rawKey) return null;
  if (rawKey === " ") return "Space";
  if (rawKey === "Escape") return "Esc";
  if (rawKey === "ArrowUp" || rawKey === "ArrowDown" || rawKey === "ArrowLeft" || rawKey === "ArrowRight") {
    return rawKey;
  }
  if (rawKey === ",") return ",";
  if (rawKey === ".") return ".";
  if (rawKey === "`") return "`";
  if (rawKey.length === 1) {
    return /[a-z]/i.test(rawKey) ? rawKey.toUpperCase() : rawKey;
  }
  if (/^(Meta|Control|Shift|Alt)$/.test(rawKey)) {
    return null;
  }
  return rawKey.length <= 1 ? rawKey.toUpperCase() : rawKey[0].toUpperCase() + rawKey.slice(1);
}

export function setShortcutOverrides(overrides: Record<string, string> | undefined) {
  shortcutOverrides = { ...(overrides || {}) };
}

export function getShortcutDefinition(id: string): ShortcutDefinition | undefined {
  return shortcutDefinitions.find((definition) => definition.id === id);
}

export function getShortcutValue(id: string): string {
  const definition = getShortcutDefinition(id);
  if (!definition) {
    return "";
  }
  if (Object.prototype.hasOwnProperty.call(shortcutOverrides, id)) {
    return shortcutOverrides[id] || "";
  }
  return definition.defaultShortcut;
}

export function getShortcutLabel(id: string, useSymbols: boolean = false): string {
  return formatShortcut(getShortcutValue(id), useSymbols);
}

export function eventToShortcut(event: KeyboardEvent): string | null {
  const key = normalizeKeyName(event.key);
  if (!key) {
    return null;
  }

  const parts: string[] = [];
  if (isMacPlatform ? event.metaKey : event.ctrlKey) {
    parts.push("Cmd");
  }
  if (isMacPlatform ? event.ctrlKey : false) {
    parts.push("Ctrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  parts.push(key);

  return parts.join("+");
}

function canonicalizeShortcut(shortcut: string): string {
  if (!shortcut) return "";

  const rawParts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
  const modifiers = modifierOrder.filter((modifier) => rawParts.includes(modifier));
  const key = rawParts.find((part) => !modifierOrder.includes(part as (typeof modifierOrder)[number])) || "";
  return [...modifiers, key].filter(Boolean).join("+");
}

export function eventMatchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  if (!shortcut) {
    return false;
  }
  return canonicalizeShortcut(eventToShortcut(event) || "") === canonicalizeShortcut(shortcut);
}

export function eventMatchesCommand(event: KeyboardEvent, commandId: string): boolean {
  return eventMatchesShortcut(event, getShortcutValue(commandId));
}
