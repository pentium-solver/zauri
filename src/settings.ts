import { invoke } from "@tauri-apps/api/core";
import {
  eventToShortcut,
  formatShortcut,
  getShortcutValue,
  shortcutDefinitions,
} from "./shortcuts";

export interface ZauriSettings {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  aiProvider: "claude" | "codex";
  aiModel: string;
  aiPermission: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
  aiSidebarWidth: number;
  keybindings: Record<string, string>;
}

const defaults: ZauriSettings = {
  fontSize: 13,
  tabSize: 2,
  wordWrap: false,
  aiProvider: "claude",
  aiModel: "claude-opus-4-6[1m]",
  aiPermission: "default",
  gitAuthorName: "",
  gitAuthorEmail: "",
  aiSidebarWidth: 380,
  keybindings: {},
};

let settings: ZauriSettings = { ...defaults };
let onChangeCallback: ((s: ZauriSettings) => void) | null = null;
let isOpen = false;

export function getSettings(): ZauriSettings {
  return settings;
}

export function onSettingsChange(cb: (s: ZauriSettings) => void) {
  onChangeCallback = cb;
}

export async function loadSettingsFromDisk(): Promise<ZauriSettings> {
  try {
    const data: string = await invoke("load_settings");
    const parsed = JSON.parse(data);
    settings = {
      ...defaults,
      ...parsed,
      keybindings: { ...defaults.keybindings, ...(parsed.keybindings || {}) },
    };
  } catch {
    settings = { ...defaults };
  }
  return settings;
}

async function save() {
  await invoke("save_settings", { data: JSON.stringify(settings) });
  onChangeCallback?.(settings);
}

export async function patchSettings(next: Partial<ZauriSettings>) {
  settings = {
    ...settings,
    ...next,
    keybindings: next.keybindings ? { ...next.keybindings } : settings.keybindings,
  };
  await save();
}

export async function updateAISettings(provider: string, model: string, permission: string) {
  settings.aiProvider = provider as "claude" | "codex";
  settings.aiModel = model;
  settings.aiPermission = permission;
  await save();
}

export function isSettingsOpen(): boolean {
  return isOpen;
}

function renderShortcutRows(pendingKeybindings: Record<string, string>): string {
  return shortcutDefinitions.map((definition) => {
    const override = Object.prototype.hasOwnProperty.call(pendingKeybindings, definition.id);
    const value = override ? pendingKeybindings[definition.id] || "" : getShortcutValue(definition.id);
    const isCustomized = override && value !== definition.defaultShortcut;
    return `
      <div class="settings-shortcut-item" data-command-id="${definition.id}">
        <div class="settings-field-info">
          <span class="settings-field-label">${definition.label}</span>
          <span class="settings-field-desc">${definition.category}</span>
        </div>
        <div class="settings-shortcut-actions">
          <button
            class="settings-shortcut-btn${isCustomized ? " customized" : ""}"
            data-command-id="${definition.id}"
            data-value="${value}"
            type="button"
          >
            ${value ? formatShortcut(value) : "Unbound"}
          </button>
          <button class="settings-shortcut-reset" data-command-id="${definition.id}" type="button">
            Reset
          </button>
        </div>
      </div>
    `;
  }).join("");
}

export function showSettings() {
  if (isOpen) return;
  isOpen = true;

  const container = document.getElementById("editor-container")!;
  const existing = document.getElementById("settings-page");
  if (existing) {
    existing.remove();
  }

  const pendingKeybindings: Record<string, string> = { ...settings.keybindings };
  let capturingCommandId: string | null = null;

  const page = document.createElement("div");
  page.id = "settings-page";
  page.className = "settings-page";
  page.innerHTML = `
    <div class="settings-scroll">
      <div class="settings-top">
        <h1>Settings</h1>
        <p class="settings-subtitle">Configure app-level preferences for this device.</p>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <h2>Editor</h2>
          <p>Customize the code editor appearance and behavior.</p>
        </div>

        <div class="settings-field">
          <div class="settings-field-info">
            <span class="settings-field-label">Font Size</span>
            <span class="settings-field-desc">Size of text in the code editor (10-24px).</span>
          </div>
          <input type="number" id="set-font-size" min="10" max="24" value="${settings.fontSize}" />
        </div>

        <div class="settings-field">
          <div class="settings-field-info">
            <span class="settings-field-label">Tab Size</span>
            <span class="settings-field-desc">Number of spaces per indentation level.</span>
          </div>
          <button class="settings-dropdown-btn" id="set-tab-size" data-value="${settings.tabSize}">${settings.tabSize} spaces <span class="dropdown-caret">&#9662;</span></button>
        </div>

        <div class="settings-field">
          <div class="settings-field-info">
            <span class="settings-field-label">Word Wrap</span>
            <span class="settings-field-desc">Wrap long lines instead of horizontal scrolling.</span>
          </div>
          <label class="toggle">
            <input type="checkbox" id="set-word-wrap" ${settings.wordWrap ? "checked" : ""} />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <h2>Keyboard Shortcuts</h2>
          <p>Press a shortcut with modifiers to rebind it. Use Backspace or Delete to clear a binding.</p>
        </div>
        <div class="settings-shortcut-list">
          ${renderShortcutRows(pendingKeybindings)}
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <h2>AI Assistant</h2>
          <p>Configure the default AI coding assistant provider.</p>
        </div>

        <div class="settings-option-group">
          <label class="settings-option ${settings.aiProvider === "claude" ? "selected" : ""}" data-val="claude">
            <div class="settings-option-info">
              <span class="settings-option-name">Claude</span>
              <span class="settings-option-desc">Anthropic's Claude Code CLI.</span>
            </div>
            ${settings.aiProvider === "claude" ? '<span class="settings-selected-badge">SELECTED</span>' : ""}
          </label>
          <label class="settings-option ${settings.aiProvider === "codex" ? "selected" : ""}" data-val="codex">
            <div class="settings-option-info">
              <span class="settings-option-name">Codex</span>
              <span class="settings-option-desc">OpenAI's Codex CLI.</span>
            </div>
            ${settings.aiProvider === "codex" ? '<span class="settings-selected-badge">SELECTED</span>' : ""}
          </label>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <h2>Git</h2>
          <p>Configure Git identity for commits made from Zauri.</p>
        </div>

        <div class="settings-field">
          <div class="settings-field-info">
            <span class="settings-field-label">Author Name</span>
            <span class="settings-field-desc">Your name for Git commits.</span>
          </div>
          <input type="text" id="set-git-name" value="${settings.gitAuthorName}" placeholder="Your Name" />
        </div>

        <div class="settings-field">
          <div class="settings-field-info">
            <span class="settings-field-label">Author Email</span>
            <span class="settings-field-desc">Your email for Git commits.</span>
          </div>
          <input type="text" id="set-git-email" value="${settings.gitAuthorEmail}" placeholder="you@example.com" />
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <h2>Danger Zone</h2>
          <p>Force quit background processes.</p>
        </div>

        <div class="settings-field">
          <div class="settings-field-info">
            <span class="settings-field-label">Kill Claude</span>
            <span class="settings-field-desc">Force quit all running claude processes.</span>
          </div>
          <button class="settings-danger-btn" id="set-kill-claude">Force Quit</button>
        </div>
      </div>

      <div class="settings-footer">
        <button class="settings-save-btn" id="set-save">Save Settings</button>
        <button class="settings-back-btn" id="set-back">&larr; Back</button>
      </div>
    </div>
  `;

  const close = () => {
    page.style.display = "none";
    isOpen = false;
    capturingCommandId = null;
    page.querySelectorAll(".settings-shortcut-btn.capturing").forEach((button) => {
      button.classList.remove("capturing");
    });
  };

  function getPendingShortcut(commandId: string): string {
    if (Object.prototype.hasOwnProperty.call(pendingKeybindings, commandId)) {
      return pendingKeybindings[commandId] || "";
    }
    return getShortcutValue(commandId);
  }

  function updateShortcutButton(commandId: string) {
    const button = page.querySelector(`.settings-shortcut-btn[data-command-id="${commandId}"]`) as HTMLButtonElement | null;
    if (!button) return;

    const definition = shortcutDefinitions.find((candidate) => candidate.id === commandId);
    const value = getPendingShortcut(commandId);
    const isCustomized = Object.prototype.hasOwnProperty.call(pendingKeybindings, commandId)
      && value !== (definition?.defaultShortcut || "");

    button.dataset.value = value;
    button.classList.toggle("customized", isCustomized);
    button.textContent = value ? formatShortcut(value) : "Unbound";
  }

  function beginCapture(commandId: string) {
    capturingCommandId = commandId;
    page.querySelectorAll(".settings-shortcut-btn").forEach((button) => {
      button.classList.remove("capturing");
    });
    const button = page.querySelector(`.settings-shortcut-btn[data-command-id="${commandId}"]`) as HTMLButtonElement | null;
    if (button) {
      button.classList.add("capturing");
      button.textContent = "Type shortcut";
    }
  }

  function endCapture() {
    const activeCommandId = capturingCommandId;
    capturingCommandId = null;
    if (activeCommandId) {
      updateShortcutButton(activeCommandId);
    }
  }

  function assignShortcut(commandId: string, shortcut: string) {
    shortcutDefinitions.forEach((definition) => {
      if (definition.id !== commandId && getPendingShortcut(definition.id) === shortcut) {
        pendingKeybindings[definition.id] = "";
        updateShortcutButton(definition.id);
      }
    });

    pendingKeybindings[commandId] = shortcut;
    updateShortcutButton(commandId);
  }

  page.addEventListener("keydown", (event) => {
    if (!capturingCommandId) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      endCapture();
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      pendingKeybindings[capturingCommandId] = "";
      endCapture();
      return;
    }

    const shortcut = eventToShortcut(event);
    if (!shortcut) return;
    assignShortcut(capturingCommandId, shortcut);
    endCapture();
  }, true);

  page.querySelectorAll(".settings-shortcut-btn").forEach((button) => {
    button.addEventListener("click", () => {
      beginCapture((button as HTMLElement).dataset.commandId || "");
    });
  });

  page.querySelectorAll(".settings-shortcut-reset").forEach((button) => {
    button.addEventListener("click", () => {
      const commandId = (button as HTMLElement).dataset.commandId || "";
      delete pendingKeybindings[commandId];
      if (capturingCommandId === commandId) {
        capturingCommandId = null;
      }
      updateShortcutButton(commandId);
    });
  });

  page.querySelectorAll(".settings-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      page.querySelectorAll(".settings-option").forEach((option) => {
        option.classList.remove("selected");
        const badge = option.querySelector(".settings-selected-badge");
        if (badge) badge.remove();
      });
      opt.classList.add("selected");
      const badge = document.createElement("span");
      badge.className = "settings-selected-badge";
      badge.textContent = "SELECTED";
      opt.appendChild(badge);
    });
  });

  page.querySelector("#set-back")!.addEventListener("click", close);

  const tabSizeBtn = page.querySelector("#set-tab-size") as HTMLElement;
  tabSizeBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    document.querySelectorAll(".custom-dropdown").forEach((dropdown) => dropdown.remove());
    const menu = document.createElement("div");
    menu.className = "custom-dropdown";
    for (const size of [2, 4, 8]) {
      const item = document.createElement("div");
      item.className = `custom-dropdown-item${String(size) === tabSizeBtn.dataset.value ? " selected" : ""}`;
      item.innerHTML = `<span class="dropdown-check">${String(size) === tabSizeBtn.dataset.value ? "\u2713" : ""}</span> ${size} spaces`;
      item.addEventListener("click", (ev) => {
        ev.stopPropagation();
        tabSizeBtn.dataset.value = String(size);
        tabSizeBtn.innerHTML = `${size} spaces <span class="dropdown-caret">&#9662;</span>`;
        menu.remove();
      });
      menu.appendChild(item);
    }
    const rect = tabSizeBtn.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    document.body.appendChild(menu);
    setTimeout(() => {
      const closeMenu = () => {
        menu.remove();
        document.removeEventListener("click", closeMenu);
      };
      document.addEventListener("click", closeMenu);
    }, 0);
  });

  page.querySelector("#set-save")!.addEventListener("click", async () => {
    settings.fontSize = parseInt((page.querySelector("#set-font-size") as HTMLInputElement).value, 10) || 13;
    settings.tabSize = parseInt((page.querySelector("#set-tab-size") as HTMLElement).dataset.value || "2", 10);
    settings.wordWrap = (page.querySelector("#set-word-wrap") as HTMLInputElement).checked;
    settings.keybindings = { ...pendingKeybindings };
    const selectedProvider = page.querySelector(".settings-option.selected");
    settings.aiProvider = (selectedProvider?.getAttribute("data-val") as "claude" | "codex") || "claude";
    settings.gitAuthorName = (page.querySelector("#set-git-name") as HTMLInputElement).value;
    settings.gitAuthorEmail = (page.querySelector("#set-git-email") as HTMLInputElement).value;
    await save();
    close();
  });

  page.querySelector("#set-kill-claude")!.addEventListener("click", async () => {
    const btn = page.querySelector("#set-kill-claude") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Killing...";
    try {
      await invoke("kill_claude_processes");
      btn.textContent = "Done";
    } catch {
      btn.textContent = "Failed";
    }
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "Force Quit";
    }, 2000);
  });

  container.appendChild(page);
}

export function hideSettings() {
  const page = document.getElementById("settings-page");
  if (page) {
    page.style.display = "none";
    isOpen = false;
  }
}
