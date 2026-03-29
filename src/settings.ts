import { invoke } from "@tauri-apps/api/core";

export interface ZauriSettings {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  aiProvider: "claude" | "codex";
  aiModel: string;
  aiPermission: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
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
    settings = { ...defaults, ...parsed };
  } catch {
    settings = { ...defaults };
  }
  return settings;
}

async function save() {
  await invoke("save_settings", { data: JSON.stringify(settings) });
  onChangeCallback?.(settings);
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

export function showSettings() {
  if (isOpen) return;
  isOpen = true;

  const container = document.getElementById("editor-container")!;
  const existing = document.getElementById("settings-page");
  if (existing) {
    existing.style.display = "flex";
    return;
  }

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

  // AI provider selection
  page.querySelectorAll(".settings-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      page.querySelectorAll(".settings-option").forEach((o) => {
        o.classList.remove("selected");
        const badge = o.querySelector(".settings-selected-badge");
        if (badge) badge.remove();
      });
      opt.classList.add("selected");
      const badge = document.createElement("span");
      badge.className = "settings-selected-badge";
      badge.textContent = "SELECTED";
      opt.appendChild(badge);
    });
  });

  const close = () => {
    page.style.display = "none";
    isOpen = false;
  };

  page.querySelector("#set-back")!.addEventListener("click", close);

  // Custom dropdown for tab size
  const tabSizeBtn = page.querySelector("#set-tab-size") as HTMLElement;
  tabSizeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".custom-dropdown").forEach((d) => d.remove());
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
      const closeMenu = () => { menu.remove(); document.removeEventListener("click", closeMenu); };
      document.addEventListener("click", closeMenu);
    }, 0);
  });

  page.querySelector("#set-save")!.addEventListener("click", async () => {
    settings.fontSize = parseInt((page.querySelector("#set-font-size") as HTMLInputElement).value) || 13;
    settings.tabSize = parseInt((page.querySelector("#set-tab-size") as HTMLElement).dataset.value || "2");
    settings.wordWrap = (page.querySelector("#set-word-wrap") as HTMLInputElement).checked;
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
    setTimeout(() => { btn.disabled = false; btn.textContent = "Force Quit"; }, 2000);
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
