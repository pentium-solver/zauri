import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { marked } from "marked";
import { parseEditsFromResponse, type ProposedEdit } from "./ai-edits";
import { getSettings, updateAISettings } from "./settings";
import { getThreadProvider, setThreadProvider, forkThread } from "./projects";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

let isStreaming = false;
let messages: ChatMessage[] = [];
let currentStreamContent = "";

// ---- DOM setup ----
export function createAIPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.id = "ai-panel";
  panel.className = "hidden";
  panel.innerHTML = `
    <div id="ai-resize-handle"></div>
    <div id="ai-header">
      <span class="ai-label">AI Assistant</span>
      <div class="ai-header-actions">
        <span id="ai-status" class="ai-status"></span>
        <button id="ai-search-toggle" class="ai-header-btn" title="Search messages (Cmd+F)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="3.5" stroke="currentColor" stroke-width="1.2"/>
            <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
        <button id="ai-compact-btn" class="ai-header-btn" title="Compact conversation">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 4h10M3 8h6M3 12h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button id="ai-fork-btn" class="ai-header-btn" title="Fork conversation">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M5 3v4a2 2 0 002 2h2a2 2 0 002-2V3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            <circle cx="5" cy="2.5" r="1.5" stroke="currentColor" stroke-width="1"/>
            <circle cx="11" cy="2.5" r="1.5" stroke="currentColor" stroke-width="1"/>
            <circle cx="8" cy="13" r="1.5" stroke="currentColor" stroke-width="1"/>
            <line x1="8" y1="9" x2="8" y2="11.5" stroke="currentColor" stroke-width="1.3"/>
          </svg>
        </button>
        <button id="ai-close" class="ai-header-btn" title="Close">&times;</button>
      </div>
    </div>
    <div id="ai-search-bar" class="hidden">
      <input type="text" id="ai-search-input" placeholder="Search messages..." />
      <span id="ai-search-count"></span>
      <button id="ai-search-close" class="ai-header-btn">&times;</button>
    </div>
    <div id="ai-messages"></div>
    <div id="ai-input-area">
      <div id="ai-context-bar"></div>
      <div id="ai-composer">
        <textarea id="ai-input" placeholder="Ask about your code..." rows="3"></textarea>
        <button id="ai-send" title="Send (Enter)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M6 4l5 4-5 4" fill="currentColor"/>
          </svg>
        </button>
        <button id="ai-stop" class="hidden" title="Stop (Esc)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/>
          </svg>
        </button>
      </div>
      <div id="ai-toolbar">
        <button class="ai-provider-btn active" data-provider="claude" title="Claude Code">
          <svg width="14" height="14" viewBox="0 0 256 257" fill="currentColor" class="icon-claude">
            <path d="m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z"/>
          </svg>
          <span>Claude</span>
        </button>
        <button class="ai-provider-btn" data-provider="codex" title="Codex">
          <svg width="14" height="14" viewBox="0 0 256 260" fill="currentColor" class="icon-codex">
            <path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z"/>
          </svg>
          <span>Codex</span>
        </button>
        <div class="ai-toolbar-sep"></div>
        <button class="ai-toolbar-dropdown-btn" id="ai-model-btn" data-value="claude-opus-4-6[1m]">Opus 4.6 [1M] <span class="dropdown-caret">&#9662;</span></button>
        <div class="ai-toolbar-sep"></div>
        <button class="ai-toolbar-dropdown-btn" id="ai-permission-btn" data-value="default">Default <span class="dropdown-caret">&#9662;</span></button>
      </div>
      <div id="ai-usage-bar">
        <span id="ai-usage-tokens">0 tokens</span>
        <span id="ai-usage-cost"></span>
        <div id="ai-rate-limit-bar" class="hidden">
          <div id="ai-rate-fill"></div>
        </div>
      </div>
    </div>
  `;
  return panel;
}

interface EditCallbacks {
  getFileContent: (path: string) => string | null;
  showProposedEdit: (edit: ProposedEdit) => void;
  acceptAllEdits: () => Promise<void>;
  rejectAllEdits: () => void;
}

interface ThreadCallbacks {
  getActiveThreadId: () => string | null;
  getSessionId: () => string | undefined;
  saveMessage: (role: "user" | "assistant", content: string) => Promise<void>;
  saveSessionId: (sid: string) => Promise<void>;
}

export function initAIPanel(
  getActiveFilePath: () => string | null,
  getOpenFilePaths: () => string[],
  getRootPath: () => string | null,
  editCallbacks?: EditCallbacks,
  threadCallbacks?: ThreadCallbacks,
) {
  const panel = document.getElementById("ai-panel")!;
  const messagesContainer = document.getElementById("ai-messages")!;
  const input = document.getElementById("ai-input") as HTMLTextAreaElement;
  const sendBtn = document.getElementById("ai-send")!;
  const stopBtn = document.getElementById("ai-stop")!;
  const closeBtn = document.getElementById("ai-close")!;
  const statusEl = document.getElementById("ai-status")!;
  const contextBar = document.getElementById("ai-context-bar")!;

  let currentProvider = "claude";

  // ---- Provider-specific configs ----
  const providerConfigs: Record<string, {
    models: { value: string; label: string }[];
    defaultModel: string;
    defaultModelLabel: string;
    permissions: { value: string; label: string }[];
    defaultPerm: string;
    defaultPermLabel: string;
  }> = {
    claude: {
      models: [
        { value: "claude-opus-4-6", label: "Opus 4.6" },
        { value: "claude-opus-4-6[1m]", label: "Opus 4.6 [1M]" },
        { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
        { value: "claude-sonnet-4-6[1m]", label: "Sonnet 4.6 [1M]" },
        { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
      ],
      defaultModel: "claude-opus-4-6[1m]",
      defaultModelLabel: "Opus 4.6 [1M]",
      permissions: [
        { value: "default", label: "Default" },
        { value: "plan", label: "Plan" },
        { value: "auto", label: "Auto" },
        { value: "bypassPermissions", label: "Bypass" },
      ],
      defaultPerm: "default",
      defaultPermLabel: "Default",
    },
    codex: {
      models: [
        { value: "gpt-5.4", label: "GPT-5.4" },
        { value: "o3", label: "o3" },
        { value: "o4-mini", label: "o4-mini" },
        { value: "codex-mini", label: "Codex Mini" },
      ],
      defaultModel: "gpt-5.4",
      defaultModelLabel: "GPT-5.4",
      permissions: [
        { value: "untrusted", label: "Suggest" },
        { value: "on-request", label: "Normal" },
        { value: "full-auto", label: "Full Auto" },
        { value: "never", label: "Bypass Sandbox" },
      ],
      defaultPerm: "full-auto",
      defaultPermLabel: "Full Auto",
    },
  };

  const modelBtn = panel.querySelector("#ai-model-btn") as HTMLElement;
  const permBtn = panel.querySelector("#ai-permission-btn") as HTMLElement;

  // Shared dropdown opener
  function openDropdown(
    triggerBtn: HTMLElement,
    options: { value: string; label: string }[],
  ) {
    document.querySelectorAll(".custom-dropdown").forEach((d) => d.remove());
    const menu = document.createElement("div");
    menu.className = "custom-dropdown";
    const currentVal = triggerBtn.dataset.value;

    for (const opt of options) {
      const item = document.createElement("div");
      item.className = `custom-dropdown-item${opt.value === currentVal ? " selected" : ""}`;
      item.innerHTML = `<span class="dropdown-check">${opt.value === currentVal ? "\u2713" : ""}</span> ${opt.label}`;
      item.addEventListener("click", (ev) => {
        ev.stopPropagation();
        triggerBtn.dataset.value = opt.value;
        triggerBtn.innerHTML = `${opt.label} <span class="dropdown-caret">&#9662;</span>`;
        menu.remove();
        // Persist selection
        updateAISettings(currentProvider, modelBtn.dataset.value || "", permBtn.dataset.value || "");
      });
      menu.appendChild(item);
    }

    const rect = triggerBtn.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    document.body.appendChild(menu);

    const closeMenu = () => {
      menu.remove();
      document.removeEventListener("click", closeMenu);
    };
    setTimeout(() => document.addEventListener("click", closeMenu), 0);
  }

  modelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const cfg = providerConfigs[currentProvider] || providerConfigs.claude;
    openDropdown(modelBtn, cfg.models);
  });

  permBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const cfg = providerConfigs[currentProvider] || providerConfigs.claude;
    openDropdown(permBtn, cfg.permissions);
  });

  function switchProviderConfig(provider: string) {
    const cfg = providerConfigs[provider] || providerConfigs.claude;
    modelBtn.dataset.value = cfg.defaultModel;
    modelBtn.innerHTML = `${cfg.defaultModelLabel} <span class="dropdown-caret">&#9662;</span>`;
    permBtn.dataset.value = cfg.defaultPerm;
    permBtn.innerHTML = `${cfg.defaultPermLabel} <span class="dropdown-caret">&#9662;</span>`;
  }

  // Provider buttons
  const providerBtns = panel.querySelectorAll<HTMLButtonElement>(".ai-provider-btn");
  providerBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetProvider = btn.dataset.provider || "claude";
      if (targetProvider === currentProvider) return;

      // Check if current thread is locked to a different provider
      const threadId = threadCallbacks?.getActiveThreadId();
      if (threadId) {
        const lockedProvider = getThreadProvider(threadId);
        if (lockedProvider && lockedProvider !== targetProvider) {
          // Offer to fork
          showForkDialog(threadId, targetProvider, messagesContainer);
          return;
        }
      }

      providerBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentProvider = targetProvider;
      activeProviderName = currentProvider === "codex" ? "Codex" : "Claude";
      switchProviderConfig(currentProvider);
      checkProvider(statusEl, currentProvider);
      updateAISettings(currentProvider, modelBtn.dataset.value || "", permBtn.dataset.value || "");
    });
  });

  function showForkDialog(threadId: string, targetProvider: string, container: HTMLElement) {
    document.getElementById("fork-dialog")?.remove();
    const dialog = document.createElement("div");
    dialog.id = "fork-dialog";
    dialog.className = "ai-fork-dialog fade-in";
    const targetName = targetProvider === "codex" ? "Codex" : "Claude";
    dialog.innerHTML = `
      <div class="fork-dialog-text">
        This thread is locked to <strong>${activeProviderName}</strong>.
        Fork to <strong>${targetName}</strong>?
      </div>
      <div class="fork-dialog-actions">
        <button class="fork-btn primary" id="fork-confirm">Fork conversation</button>
        <button class="fork-btn" id="fork-cancel">Cancel</button>
      </div>
    `;
    dialog.querySelector("#fork-confirm")?.addEventListener("click", async () => {
      dialog.remove();
      await executeFork(threadId, targetProvider);
    });
    dialog.querySelector("#fork-cancel")?.addEventListener("click", () => dialog.remove());
    container.appendChild(dialog);
    container.scrollTop = container.scrollHeight;
  }

  // Restore saved AI settings
  const savedSettings = getSettings();
  if (savedSettings.aiProvider) {
    currentProvider = savedSettings.aiProvider;
    activeProviderName = currentProvider === "codex" ? "Codex" : "Claude";
    providerBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.provider === currentProvider);
    });
    switchProviderConfig(currentProvider);
    // Restore saved model/permission ONLY if they belong to this provider
    const cfg = providerConfigs[currentProvider];
    if (savedSettings.aiModel && cfg) {
      const modelOpt = cfg.models.find((m: { value: string }) => m.value === savedSettings.aiModel);
      if (modelOpt) {
        modelBtn.dataset.value = savedSettings.aiModel;
        modelBtn.innerHTML = `${modelOpt.label} <span class="dropdown-caret">&#9662;</span>`;
      }
      // else: keep the default set by switchProviderConfig
    }
    if (savedSettings.aiPermission && cfg) {
      const permOpt = cfg.permissions.find((p: { value: string }) => p.value === savedSettings.aiPermission);
      if (permOpt) {
        permBtn.dataset.value = savedSettings.aiPermission;
        permBtn.innerHTML = `${permOpt.label} <span class="dropdown-caret">&#9662;</span>`;
      }
    }
  }
  checkProvider(statusEl, currentProvider);

  // Resize handle
  const resizeHandle = document.getElementById("ai-resize-handle")!;
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener("mousedown", (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const diff = startX - e.clientX;
    const newWidth = Math.max(280, Math.min(800, startWidth + diff));
    panel.style.width = `${newWidth}px`;
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });

  // Event listeners
  closeBtn.addEventListener("click", () => panel.classList.add("hidden"));

  // Fork button
  const forkBtn = document.getElementById("ai-fork-btn")!;
  forkBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const threadId = threadCallbacks?.getActiveThreadId();
    if (!threadId) return;

    document.querySelectorAll(".custom-dropdown").forEach((d) => d.remove());
    const menu = document.createElement("div");
    menu.className = "custom-dropdown";

    const otherProvider = currentProvider === "claude" ? "codex" : "claude";
    const otherName = otherProvider === "codex" ? "Codex" : "Claude";

    const items = [
      { label: `Fork (continue with ${activeProviderName})`, provider: currentProvider },
      { label: `Fork to ${otherName}`, provider: otherProvider },
    ];

    for (const item of items) {
      const el = document.createElement("div");
      el.className = "custom-dropdown-item";
      el.innerHTML = `<span class="dropdown-check"></span> ${item.label}`;
      el.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        menu.remove();
        await executeFork(threadId, item.provider);
      });
      menu.appendChild(el);
    }

    const rect = forkBtn.getBoundingClientRect();
    menu.style.right = `${window.innerWidth - rect.right}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = "auto";
    document.body.appendChild(menu);
    const closeMenu = () => { menu.remove(); document.removeEventListener("click", closeMenu); };
    setTimeout(() => document.addEventListener("click", closeMenu), 0);
  });

  async function executeFork(threadId: string, targetProvider: string) {
    const forked = await forkThread(threadId, targetProvider);
    if (!forked) return;

    const msgCount = forked.messages.length;
    const totalChars = forked.messages.reduce((sum, m) => sum + m.content.length, 0);
    const approxTokens = Math.round(totalChars / 4);
    const targetName = targetProvider === "codex" ? "Codex" : "Claude";
    const isSameProvider = targetProvider === currentProvider;

    // Switch provider if different
    if (!isSameProvider) {
      providerBtns.forEach((b) => b.classList.remove("active"));
      providerBtns.forEach((b) => {
        if (b.dataset.provider === targetProvider) b.classList.add("active");
      });
      currentProvider = targetProvider;
      activeProviderName = targetName;
      switchProviderConfig(currentProvider);
      checkProvider(statusEl, currentProvider);
      updateAISettings(currentProvider, modelBtn.dataset.value || "", permBtn.dataset.value || "");
    }

    // Clear chat and show fork banner
    messagesContainer.innerHTML = "";
    const banner = document.createElement("div");
    banner.className = "ai-fork-banner fade-in";
    banner.innerHTML = `
      <div class="fork-banner-icon">&#8618;</div>
      <div class="fork-banner-text">
        <strong>Forked${isSameProvider ? "" : ` to ${targetName}`}</strong>
        <span>${msgCount} messages &middot; ~${approxTokens.toLocaleString()} tokens of context</span>
      </div>
    `;
    messagesContainer.appendChild(banner);

    window.dispatchEvent(new CustomEvent("zauri-switch-thread", {
      detail: { threadId: forked.id, skipLoadMessages: true },
    }));
  }

  sendBtn.addEventListener("click", () => sendMessage());
  stopBtn.addEventListener("click", async () => {
    try {
      await invoke("ai_cancel");
    } catch { /* ignore */ }
    removeLoading();
    isStreaming = false;
    sendBtn.classList.remove("hidden");
    stopBtn.classList.add("hidden");
    sendBtn.removeAttribute("disabled");
    input.removeAttribute("disabled");
    input.focus();
    statusEl.textContent = "Cancelled";
    statusEl.className = "ai-status error";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 150) + "px";
  });

  // ---- Token usage tracking ----
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  const usageTokensEl = document.getElementById("ai-usage-tokens")!;
  const usageCostEl = document.getElementById("ai-usage-cost")!;
  const rateLimitBar = document.getElementById("ai-rate-limit-bar")!;
  const rateFill = document.getElementById("ai-rate-fill")!;

  function updateUsageDisplay() {
    const total = totalInputTokens + totalOutputTokens;
    usageTokensEl.textContent = `${total.toLocaleString()} tokens`;
    if (totalCost > 0) {
      usageCostEl.textContent = `$${totalCost.toFixed(4)}`;
    }
  }

  listen<string>("ai-usage", (event) => {
    try {
      const data = JSON.parse(event.payload);
      totalInputTokens += data.input_tokens || 0;
      totalOutputTokens += data.output_tokens || 0;
      totalCost += data.cost_usd || 0;
      updateUsageDisplay();
    } catch { /* ignore */ }
  });

  listen<string>("ai-rate-limit", (event) => {
    try {
      const data = JSON.parse(event.payload);
      if (data.resets_at > 0) {
        rateLimitBar.classList.remove("hidden");
        const now = Date.now() / 1000;
        const total = data.resets_at - now;
        const updateTimer = () => {
          const remaining = data.resets_at - Date.now() / 1000;
          if (remaining <= 0) {
            rateLimitBar.classList.add("hidden");
            return;
          }
          const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
          rateFill.style.width = `${pct}%`;
          rateFill.title = `Rate limit resets in ${Math.ceil(remaining / 60)}m`;
          requestAnimationFrame(updateTimer);
        };
        updateTimer();
      }
    } catch { /* ignore */ }
  });

  // ---- Message search ----
  const searchBar = document.getElementById("ai-search-bar")!;
  const searchInput2 = document.getElementById("ai-search-input") as HTMLInputElement;
  const searchCount = document.getElementById("ai-search-count")!;

  document.getElementById("ai-search-toggle")!.addEventListener("click", () => {
    searchBar.classList.toggle("hidden");
    if (!searchBar.classList.contains("hidden")) {
      searchInput2.focus();
    } else {
      // Clear highlights
      messagesContainer.querySelectorAll(".search-highlight").forEach((el) => {
        const parent = el.parentNode!;
        parent.replaceChild(document.createTextNode(el.textContent || ""), el);
        parent.normalize();
      });
    }
  });

  document.getElementById("ai-search-close")!.addEventListener("click", () => {
    searchBar.classList.add("hidden");
    messagesContainer.querySelectorAll(".search-highlight").forEach((el) => {
      const parent = el.parentNode!;
      parent.replaceChild(document.createTextNode(el.textContent || ""), el);
      parent.normalize();
    });
  });

  searchInput2.addEventListener("input", () => {
    const query = searchInput2.value.toLowerCase();
    // Clear previous highlights
    messagesContainer.querySelectorAll(".search-highlight").forEach((el) => {
      const parent = el.parentNode!;
      parent.replaceChild(document.createTextNode(el.textContent || ""), el);
      parent.normalize();
    });
    if (!query) {
      searchCount.textContent = "";
      return;
    }
    let count = 0;
    messagesContainer.querySelectorAll(".ai-msg-content").forEach((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      let node;
      while ((node = walker.nextNode())) textNodes.push(node as Text);
      for (const tn of textNodes) {
        const text = tn.textContent || "";
        const idx = text.toLowerCase().indexOf(query);
        if (idx >= 0) {
          const before = text.slice(0, idx);
          const match = text.slice(idx, idx + query.length);
          const after = text.slice(idx + query.length);
          const span = document.createElement("mark");
          span.className = "search-highlight";
          span.textContent = match;
          const frag = document.createDocumentFragment();
          if (before) frag.appendChild(document.createTextNode(before));
          frag.appendChild(span);
          if (after) frag.appendChild(document.createTextNode(after));
          tn.parentNode!.replaceChild(frag, tn);
          count++;
        }
      }
    });
    searchCount.textContent = count > 0 ? `${count} found` : "No results";
  });

  // ---- Compact button ----
  document.getElementById("ai-compact-btn")!.addEventListener("click", () => {
    if (!messages.length) return;
    const summary = messages.map((m) => `${m.role}: ${m.content.slice(0, 100)}`).join("\n");
    const compactMsg = `Summarize this conversation concisely, then continue:\n\n${summary}`;
    // Clear messages and add as system context
    messagesContainer.innerHTML = "";
    const banner = document.createElement("div");
    banner.className = "ai-fork-banner fade-in";
    banner.innerHTML = `
      <div class="fork-banner-icon">&#128220;</div>
      <div class="fork-banner-text">
        <strong>Compacted</strong>
        <span>${messages.length} messages condensed into context</span>
      </div>
    `;
    messagesContainer.appendChild(banner);
    messages.length = 0;
    // Send compact request
    const root = getRootPath() || ".";
    invoke("ai_chat", {
      prompt: compactMsg,
      workingDir: root,
      contextFiles: [],
      provider: currentProvider,
      sessionId: threadCallbacks?.getSessionId() || null,
      model: (panel.querySelector("#ai-model-btn") as HTMLElement)?.dataset.value || null,
      permissionMode: (panel.querySelector("#ai-permission-btn") as HTMLElement)?.dataset.value || null,
    }).catch(() => {});
    isStreaming = false;
    showLoading();
    statusEl.textContent = "Compacting...";
    statusEl.className = "ai-status thinking";
    sendBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
  });

  // --- Loading dots element ---
  let loadingEl: HTMLElement | null = null;

  function showLoading() {
    loadingEl = document.createElement("div");
    loadingEl.className = "ai-msg ai-msg-assistant ai-loading fade-in";
    loadingEl.innerHTML = `<div class="ai-msg-header">${activeProviderName}</div><div class="ai-loading-dots"><span></span><span></span><span></span></div>`;
    messagesContainer.appendChild(loadingEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function removeLoading() {
    if (loadingEl) {
      loadingEl.remove();
      loadingEl = null;
    }
  }

  // Listen for response text
  listen<string>("ai-response-chunk", (event) => {
    const token = event.payload;
    if (token === null || token === undefined || token === "") return;

    removeLoading();

    if (!isStreaming) {
      isStreaming = true;
      currentStreamContent = "";
      // Create the message element
      const msg = createMessageEl("assistant", "");
      messagesContainer.appendChild(msg);
    }

    // Append token (preserve whitespace — don't trim!)
    currentStreamContent += token;

    // Update display with raw text during streaming (fast updates)
    const contentEl = messagesContainer.querySelector(".ai-msg-assistant:last-child .ai-msg-content");
    if (contentEl) {
      contentEl.textContent = currentStreamContent;
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });

  // Log AI debug messages
  listen<string>("ai-log", (event) => {
    console.log("[ai:log]", event.payload);
    // Show errors inline
    if (event.payload?.toLowerCase().includes("error")) {
      removeLoading();
      const errEl = createMessageEl("system", event.payload);
      messagesContainer.appendChild(errEl);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  });

  // Capture session ID for conversation continuity
  listen<string>("ai-session-id", (event) => {
    if (event.payload && threadCallbacks) {
      threadCallbacks.saveSessionId(event.payload);
    }
  });

  listen<string>("ai-response-done", (event) => {
    removeLoading();
    isStreaming = false;

    const responseText = currentStreamContent.trim();
    if (responseText) {
      messages.push({
        role: "assistant",
        content: responseText,
        timestamp: Date.now(),
      });
      threadCallbacks?.saveMessage("assistant", responseText);

      // Re-render the last message as markdown
      const lastMsg = messagesContainer.querySelector(".ai-msg-assistant:last-child .ai-msg-content");
      if (lastMsg) {
        lastMsg.innerHTML = renderMarkdown(responseText);
      }

      // Parse for file edits
      const root = getRootPath();
      if (root && editCallbacks) {
        const edits = parseEditsFromResponse(
          responseText,
          root,
          editCallbacks.getFileContent,
        );

        if (edits.length > 0) {
          // Show proposed changes panel below the message
          const changesEl = document.createElement("div");
          changesEl.className = "ai-proposed-changes fade-in";

          let html = `<div class="ai-changes-header">
            <span>Proposed Changes (${edits.length} file${edits.length > 1 ? "s" : ""})</span>
            <div class="ai-changes-actions">
              <button class="ai-changes-btn accept-all">Accept All</button>
              <button class="ai-changes-btn reject-all">Reject All</button>
            </div>
          </div><div class="ai-changes-list">`;

          for (const edit of edits) {
            const name = edit.filePath.split("/").pop() || edit.filePath;
            html += `<div class="ai-change-item" data-path="${escapeHtml(edit.filePath)}">
              <span class="ai-change-name">${escapeHtml(name)}</span>
              <span class="ai-change-stats">
                <span class="stat-add">+${edit.additions}</span>
                <span class="stat-del">-${edit.deletions}</span>
              </span>
            </div>`;
          }
          html += `</div>`;
          changesEl.innerHTML = html;

          // Wire events
          changesEl.querySelector(".accept-all")?.addEventListener("click", () => {
            editCallbacks!.acceptAllEdits();
            changesEl.remove();
          });
          changesEl.querySelector(".reject-all")?.addEventListener("click", () => {
            editCallbacks!.rejectAllEdits();
            changesEl.remove();
          });
          changesEl.querySelectorAll(".ai-change-item").forEach((item) => {
            item.addEventListener("click", () => {
              const path = (item as HTMLElement).dataset.path;
              const edit = edits.find((e) => e.filePath === path);
              if (edit) editCallbacks!.showProposedEdit(edit);
            });
          });

          messagesContainer.appendChild(changesEl);

          // Also show first edit in editor
          editCallbacks.showProposedEdit(edits[0]);
        } else if (currentProvider === "codex" && root) {
          // Codex edits files directly — check git for changes and offer review
          invoke("git_status", { workingDir: root }).then((status: any) => {
            const total = (status?.modified || 0) + (status?.added || 0) + (status?.deleted || 0);
            if (total > 0) {
              const reviewEl = document.createElement("div");
              reviewEl.className = "ai-proposed-changes fade-in";
              reviewEl.innerHTML = `
                <div class="ai-changes-header">
                  <span>Codex made ${total} file change${total > 1 ? "s" : ""}</span>
                  <div class="ai-changes-actions">
                    <button class="ai-changes-btn accept-all" id="codex-accept">Keep Changes</button>
                    <button class="ai-changes-btn reject-all" id="codex-revert">Revert All</button>
                  </div>
                </div>
              `;
              reviewEl.querySelector("#codex-accept")?.addEventListener("click", () => {
                reviewEl.remove();
              });
              reviewEl.querySelector("#codex-revert")?.addEventListener("click", async () => {
                try {
                  await invoke("git_checkout_files", { workingDir: root });
                } catch {
                  // Fallback: git checkout .
                  await invoke("terminal_exec", {
                    command: "git checkout .",
                    workingDir: root,
                    terminalId: "revert",
                  });
                }
                reviewEl.remove();
              });
              messagesContainer.appendChild(reviewEl);
              messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
          }).catch(() => {});
        }
      }
    }

    statusEl.textContent = event.payload === "ok" ? "Ready" : "Error";
    statusEl.className = `ai-status ${event.payload === "ok" ? "ready" : "error"}`;
    sendBtn.classList.remove("hidden");
    stopBtn.classList.add("hidden");
    sendBtn.removeAttribute("disabled");
    input.removeAttribute("disabled");
    input.focus();
    currentStreamContent = "";
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });

  function sendMessage() {
    const text = input.value.trim();
    if (!text || isStreaming) return;

    // Add user message
    messages.push({ role: "user", content: text, timestamp: Date.now() });
    threadCallbacks?.saveMessage("user", text);
    // Lock thread to current provider on first message
    const tid = threadCallbacks?.getActiveThreadId();
    if (tid) setThreadProvider(tid, currentProvider);
    const msg = createMessageEl("user", text);
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Show loading dots
    showLoading();

    input.value = "";
    input.style.height = "auto";
    sendBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
    input.setAttribute("disabled", "true");
    statusEl.textContent = "Thinking...";
    statusEl.className = "ai-status thinking";

    // Gather context
    const openFiles = getOpenFilePaths();
    const rootPath = getRootPath() || ".";

    const modelVal = (panel.querySelector("#ai-model-btn") as HTMLElement)?.dataset.value || "opus";
    const permVal = (panel.querySelector("#ai-permission-btn") as HTMLElement)?.dataset.value || "default";

    invoke("ai_chat", {
      prompt: text,
      workingDir: rootPath,
      contextFiles: openFiles,
      provider: currentProvider,
      sessionId: threadCallbacks?.getSessionId() || null,
      model: modelVal,
      permissionMode: permVal,
    }).catch((err) => {
      const errMsg = createMessageEl("system", `Error: ${err}`);
      messagesContainer.appendChild(errMsg);
      statusEl.textContent = "Error";
      statusEl.className = "ai-status error";
      sendBtn.removeAttribute("disabled");
      input.removeAttribute("disabled");
    });
  }

  // Update context bar when files change
  function updateContextBar() {
    const activeFile = getActiveFilePath();
    const openFiles = getOpenFilePaths();

    if (openFiles.length === 0) {
      contextBar.innerHTML = "";
      return;
    }

    const chips = openFiles.map((f) => {
      const name = f.split("/").pop() || f;
      const isActive = f === activeFile;
      return `<span class="context-chip${isActive ? " active" : ""}">${escapeHtml(name)}</span>`;
    });

    contextBar.innerHTML = `<span class="context-label">Context:</span>${chips.join("")}`;
  }

  // Expose updateContextBar
  (panel as any)._updateContext = updateContextBar;
}

async function checkProvider(statusEl: HTMLElement, provider: string) {
  try {
    const version: string = await invoke("check_ai_provider", { provider });
    statusEl.textContent = "Ready";
    statusEl.className = "ai-status ready";
    statusEl.title = version;
  } catch (err) {
    statusEl.textContent = "Not found";
    statusEl.className = "ai-status error";
    statusEl.title = String(err);
  }
}

function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
}

// Expose for thread switching
(window as any).__renderMarkdown = renderMarkdown;

// Track current provider name globally for message headers
let activeProviderName = "Claude";

function createMessageEl(role: string, content: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `ai-msg ai-msg-${role} fade-in`;

  // Header row with name and timestamp
  const headerRow = document.createElement("div");
  headerRow.className = "ai-msg-header-row";

  const header = document.createElement("div");
  header.className = "ai-msg-header";
  header.textContent = role === "user" ? "You" : role === "assistant" ? activeProviderName : "System";

  const timestamp = document.createElement("span");
  timestamp.className = "ai-msg-time";
  const now = new Date();
  timestamp.textContent = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;

  headerRow.appendChild(header);
  headerRow.appendChild(timestamp);

  const body = document.createElement("div");
  body.className = "ai-msg-content";

  if (role === "assistant" && content) {
    body.innerHTML = renderMarkdown(content);
  } else {
    body.textContent = content;
  }

  // Hover actions
  const actions = document.createElement("div");
  actions.className = "ai-msg-actions";
  actions.innerHTML = `
    <button class="msg-action-btn" title="Copy" data-action="copy">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3 11V3h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
    </button>
    ${role === "user" ? '<button class="msg-action-btn" title="Retry" data-action="retry"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 0110.5-4M14 8a6 6 0 01-10.5 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M12 1v3.5h-3.5M4 15v-3.5h3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' : ""}
    <button class="msg-action-btn" title="Delete" data-action="delete">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
    </button>
  `;

  actions.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement;
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "copy") {
      navigator.clipboard.writeText(content || body.textContent || "");
      btn.title = "Copied!";
      setTimeout(() => (btn.title = "Copy"), 1500);
    } else if (action === "delete") {
      el.remove();
    } else if (action === "retry") {
      // Re-send this user message
      const inputEl = document.getElementById("ai-input") as HTMLTextAreaElement;
      if (inputEl) {
        inputEl.value = content;
        inputEl.dispatchEvent(new Event("input"));
        inputEl.focus();
      }
    }
  });

  el.appendChild(headerRow);
  el.appendChild(body);
  el.appendChild(actions);
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toggleAIPanel() {
  const panel = document.getElementById("ai-panel");
  if (panel) {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      const input = document.getElementById("ai-input") as HTMLTextAreaElement;
      input?.focus();
      // Update context
      (panel as any)._updateContext?.();
    }
  }
}
