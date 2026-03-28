import { invoke } from "@tauri-apps/api/core";

export interface ZauriSettings {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  aiProvider: "claude" | "codex";
  gitAuthorName: string;
  gitAuthorEmail: string;
}

const defaults: ZauriSettings = {
  fontSize: 13,
  tabSize: 2,
  wordWrap: false,
  aiProvider: "claude",
  gitAuthorName: "",
  gitAuthorEmail: "",
};

let settings: ZauriSettings = { ...defaults };
let onChangeCallback: ((s: ZauriSettings) => void) | null = null;

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

export function showSettings() {
  let overlay = document.getElementById("settings-modal");
  if (overlay) {
    overlay.classList.remove("hidden");
    return;
  }

  overlay = document.createElement("div");
  overlay.id = "settings-modal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:460px">
      <div class="modal-header">
        <span>Settings</span>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="settings-section">
          <div class="settings-section-title">Editor</div>
          <div class="settings-row">
            <label>Font Size</label>
            <input type="number" id="set-font-size" min="10" max="24" value="${settings.fontSize}" />
          </div>
          <div class="settings-row">
            <label>Tab Size</label>
            <select id="set-tab-size">
              <option value="2" ${settings.tabSize === 2 ? "selected" : ""}>2</option>
              <option value="4" ${settings.tabSize === 4 ? "selected" : ""}>4</option>
              <option value="8" ${settings.tabSize === 8 ? "selected" : ""}>8</option>
            </select>
          </div>
          <div class="settings-row">
            <label>Word Wrap</label>
            <input type="checkbox" id="set-word-wrap" ${settings.wordWrap ? "checked" : ""} />
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">AI</div>
          <div class="settings-row">
            <label>Default Provider</label>
            <select id="set-ai-provider">
              <option value="claude" ${settings.aiProvider === "claude" ? "selected" : ""}>Claude</option>
              <option value="codex" ${settings.aiProvider === "codex" ? "selected" : ""}>Codex</option>
            </select>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">Git</div>
          <div class="settings-row">
            <label>Author Name</label>
            <input type="text" id="set-git-name" value="${settings.gitAuthorName}" placeholder="Your Name" />
          </div>
          <div class="settings-row">
            <label>Author Email</label>
            <input type="text" id="set-git-email" value="${settings.gitAuthorEmail}" placeholder="you@example.com" />
          </div>
        </div>
        <div class="settings-actions">
          <button class="modal-btn primary" id="set-save">Save</button>
          <button class="modal-btn" id="set-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;

  const close = () => overlay!.classList.add("hidden");

  overlay.querySelector(".modal-close")!.addEventListener("click", close);
  overlay.querySelector("#set-cancel")!.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelector("#set-save")!.addEventListener("click", async () => {
    settings.fontSize = parseInt((overlay!.querySelector("#set-font-size") as HTMLInputElement).value) || 13;
    settings.tabSize = parseInt((overlay!.querySelector("#set-tab-size") as HTMLSelectElement).value) || 2;
    settings.wordWrap = (overlay!.querySelector("#set-word-wrap") as HTMLInputElement).checked;
    settings.aiProvider = (overlay!.querySelector("#set-ai-provider") as HTMLSelectElement).value as "claude" | "codex";
    settings.gitAuthorName = (overlay!.querySelector("#set-git-name") as HTMLInputElement).value;
    settings.gitAuthorEmail = (overlay!.querySelector("#set-git-email") as HTMLInputElement).value;
    await save();
    close();
  });

  document.body.appendChild(overlay);
}

export function hideSettings() {
  document.getElementById("settings-modal")?.classList.add("hidden");
}
