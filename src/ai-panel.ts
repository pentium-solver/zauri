import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { marked } from "marked";
import { parseEditsFromResponse, type ProposedEdit } from "./ai-edits";
import { getSettings, patchSettings, updateAISettings } from "./settings";
import { getThreadProvider, setThreadProvider, forkThread, addThreadUsage, getThreadUsage } from "./projects";
import { formatShortcut } from "./shortcuts";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

interface ComposerImage {
  name: string;
  path: string;
  dataUrl: string;
}

interface MessageAttachment {
  name: string;
  dataUrl?: string;
}

interface ReplyTarget {
  role: "user" | "assistant";
  content: string;
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
        <button id="ai-search-toggle" class="ai-header-btn" title="Search messages (${formatShortcut("Cmd+F")})">
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
        <button id="ai-fork-btn" class="ai-header-labeled-btn" title="Fork conversation">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M5 3v4a2 2 0 002 2h2a2 2 0 002-2V3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            <circle cx="5" cy="2.5" r="1.5" stroke="currentColor" stroke-width="1"/>
            <circle cx="11" cy="2.5" r="1.5" stroke="currentColor" stroke-width="1"/>
            <circle cx="8" cy="13" r="1.5" stroke="currentColor" stroke-width="1"/>
            <line x1="8" y1="9" x2="8" y2="11.5" stroke="currentColor" stroke-width="1.3"/>
          </svg>
          <span>Fork</span>
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
      <div id="ai-reply-bar"></div>
      <div id="ai-image-preview"></div>
      <div id="ai-composer">
        <button id="ai-attach" class="ai-attach-btn" title="Attach image">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M14 8.5l-5.5 5.5a3.5 3.5 0 01-5-5L9 3.5a2 2 0 013 3L6.5 12a.5.5 0 01-.7-.7L11 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
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
        <button class="ai-toolbar-dropdown-btn" id="ai-model-btn" data-value="claude-opus-4-6[1m]">Opus 1M <span class="dropdown-caret">&#9662;</span></button>
        <div class="ai-toolbar-sep"></div>
        <button class="ai-toolbar-dropdown-btn" id="ai-permission-btn" data-value="default">Default <span class="dropdown-caret">&#9662;</span></button>
        <div class="ai-toolbar-sep"></div>
        <button class="ai-toolbar-toggle" id="ai-thinking-btn" data-enabled="false" title="Stream thinking tokens">Think</button>
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
  ensureActiveThread: () => Promise<string | null>;
  saveMessage: (role: "user" | "assistant", content: string) => Promise<void>;
  saveSessionId: (sid: string) => Promise<void>;
  clearSessionId: () => Promise<void>;
  forkAndSwitch: () => Promise<void>;
  saveModelAndPermission: (model: string, permissionMode: string) => Promise<void>;
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
  const replyBar = document.getElementById("ai-reply-bar")!;

  let currentProvider = "claude";
  let pendingPlan: string | null = null;
  let isPlanHintDismissed = false;
  let replyTarget: ReplyTarget | null = null;
  let attachedImages: ComposerImage[] = [];
  let currentStreamToolCalls: Map<string, HTMLElement> = new Map();
  let currentThinkingContent = "";
  let lastStreamError: string | null = null;

  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  function getContextWindowEstimate(provider: string, model: string): number {
    if (provider === "claude") {
      return model.includes("[1m]") ? 1_000_000 : 200_000;
    }

    switch (model) {
      case "gpt-5.4":
        return 400_000;
      case "o3":
        return 200_000;
      case "o4-mini":
      case "codex-mini":
      default:
        return 128_000;
    }
  }

  function removePlanHint() {
    document.getElementById("plan-execute-hint")?.remove();
  }

  function updatePlanHint() {
    input.placeholder = pendingPlan
      ? "Press Enter to execute plan, or type to modify..."
      : "Ask about your code...";

    if (!pendingPlan || isPlanHintDismissed || input.value.trim() !== "") {
      removePlanHint();
      return;
    }

    let hint = document.getElementById("plan-execute-hint");
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "plan-execute-hint";
      hint.className = "plan-execute-hint fade-in";
      hint.innerHTML = `
        <span>Press Enter to execute plan</span>
        <button type="button" class="plan-execute-close" aria-label="Dismiss plan hint">&times;</button>
      `;
      hint.querySelector(".plan-execute-close")?.addEventListener("click", () => {
        isPlanHintDismissed = true;
        removePlanHint();
      });
    }

    const inputArea = document.getElementById("ai-input-area");
    if (inputArea && hint.parentElement !== inputArea) {
      inputArea.prepend(hint);
    }
  }

  function clearPlanHint() {
    pendingPlan = null;
    isPlanHintDismissed = false;
    updatePlanHint();
  }

  function updateReplyBar() {
    if (!replyTarget) {
      replyBar.innerHTML = "";
      replyBar.classList.remove("active");
      return;
    }

    const preview = replyTarget.content.replace(/\s+/g, " ").slice(0, 120);
    replyBar.classList.add("active");
    replyBar.innerHTML = `
      <div class="ai-reply-pill">
        <span class="ai-reply-label">Replying to ${replyTarget.role === "assistant" ? activeProviderName : "you"}</span>
        <span class="ai-reply-text">${escapeHtml(preview)}${replyTarget.content.length > 120 ? "..." : ""}</span>
        <button type="button" class="ai-reply-clear" aria-label="Clear reply">&times;</button>
      </div>
    `;
    replyBar.querySelector(".ai-reply-clear")?.addEventListener("click", () => {
      replyTarget = null;
      updateReplyBar();
      input.focus();
    });
  }

  function buildPrompt(text: string): string {
    if (!replyTarget) return text;

    const who = replyTarget.role === "assistant" ? activeProviderName : "You";
    return `Reply to this message from ${who}:\n"""\n${replyTarget.content}\n"""\n\n${text}`;
  }

  function ensureStreamingMessage(): HTMLElement {
    removeLoading();
    if (!isStreaming) {
      isStreaming = true;
      currentStreamContent = "";
      currentThinkingContent = "";
      currentStreamToolCalls.clear();
      const msg = createMessageEl("assistant", "");
      messagesContainer.appendChild(msg);
    }
    return messagesContainer.querySelector(".ai-msg-assistant:last-child") as HTMLElement;
  }

  function getStreamingMessage(): HTMLElement | null {
    return messagesContainer.querySelector(".ai-msg-assistant:last-child") as HTMLElement | null;
  }

  function ensureThinkingBlock(msgEl: HTMLElement): HTMLElement {
    let thinkBlock = msgEl.querySelector(".ai-thinking-block") as HTMLElement | null;
    if (thinkBlock) {
      return thinkBlock;
    }

    thinkBlock = document.createElement("div");
    thinkBlock.className = "ai-thinking-block is-active";
    thinkBlock.innerHTML = `
      <div class="ai-thinking-label">Thinking</div>
      <div class="ai-thinking-summary ai-msg-content"></div>
    `;

    const content = msgEl.querySelector(".ai-msg-content");
    if (content) {
      msgEl.insertBefore(thinkBlock, content);
    } else {
      msgEl.appendChild(thinkBlock);
    }
    return thinkBlock;
  }

  function updateThinkingBlock(chunk: string, msgEl: HTMLElement = ensureStreamingMessage()) {
    if (!chunk) return;

    currentThinkingContent += chunk;
    const thinkBlock = ensureThinkingBlock(msgEl);
    const summary = thinkBlock.querySelector(".ai-thinking-summary");
    if (summary) {
      const thinkingText = currentThinkingContent.trim();
      summary.innerHTML = renderMarkdown(thinkingText || "Thinking...");
      linkifyFilePaths(summary as HTMLElement);
    }
    thinkBlock.classList.add("is-active");
    thinkBlock.classList.remove("is-complete");
  }

  function finalizeThinkingBlock(msgEl: ParentNode | null = getStreamingMessage()) {
    const thinkBlock = msgEl?.querySelector(".ai-thinking-block") as HTMLElement | null;
    if (!thinkBlock) return;

    const summary = thinkBlock.querySelector(".ai-thinking-summary");
    const finalText = currentThinkingContent.trim();
    if (!finalText) {
      thinkBlock.remove();
      return;
    }

    if (summary) {
      summary.innerHTML = renderMarkdown(finalText);
      linkifyFilePaths(summary as HTMLElement);
    }
    thinkBlock.classList.remove("is-active");
    thinkBlock.classList.add("is-complete");
  }

  function resolveStreamError(payload: string | null | undefined): string | null {
    if (!payload || payload === "ok") return null;
    if (payload !== "error") return payload;
    return lastStreamError;
  }

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
        { value: "claude-opus-4-6", label: "Opus" },
        { value: "claude-opus-4-6[1m]", label: "Opus 1M" },
        { value: "claude-sonnet-4-6", label: "Sonnet" },
        { value: "claude-sonnet-4-6[1m]", label: "Sonnet 1M" },
        { value: "claude-haiku-4-5-20251001", label: "Haiku" },
      ],
      defaultModel: "claude-opus-4-6[1m]",
      defaultModelLabel: "Opus 1M",
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
        updateContextBar();
      });
      menu.appendChild(item);
    }

    const rect = triggerBtn.getBoundingClientRect();
    document.body.appendChild(menu);
    // Clamp so menu doesn't overflow right edge
    const menuWidth = menu.offsetWidth;
    const left = Math.min(rect.left, window.innerWidth - menuWidth - 8);
    menu.style.left = `${Math.max(4, left)}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;

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
      updateContextBar();
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

  // Thinking toggle
  const thinkingBtn = panel.querySelector("#ai-thinking-btn") as HTMLElement;
  thinkingBtn.addEventListener("click", () => {
    const enabled = thinkingBtn.dataset.enabled === "true";
    thinkingBtn.dataset.enabled = enabled ? "false" : "true";
    thinkingBtn.classList.toggle("active", !enabled);
  });

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
  panel.style.width = `${Math.max(280, Math.min(800, savedSettings.aiSidebarWidth || 380))}px`;

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
      void patchSettings({ aiSidebarWidth: panel.offsetWidth });
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
    clearGapTimer();
    isStreaming = false;
    isSending = false;
    finalizeThinkingBlock();
    sendBtn.classList.remove("hidden");
    stopBtn.classList.add("hidden");
    sendBtn.removeAttribute("disabled");
    input.removeAttribute("disabled");
    input.focus();
    statusEl.textContent = "Cancelled";
    statusEl.className = "ai-status error";
    currentThinkingContent = "";
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // If there's a pending plan and input is empty, execute it
      if (pendingPlan && input.value.trim() === "") {
        input.value = `PLEASE IMPLEMENT THIS PLAN:\n${pendingPlan}`;
        clearPlanHint();
      }
      void sendMessage();
    }
  });

  // Auto-resize textarea
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 150) + "px";
    updatePlanHint();
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
      const inTok = data.input_tokens || 0;
      const outTok = data.output_tokens || 0;
      const cost = data.cost_usd || 0;
      totalInputTokens += inTok;
      totalOutputTokens += outTok;
      totalCost += cost;
      updateUsageDisplay();
      // Persist to thread
      const tid = threadCallbacks?.getActiveThreadId();
      if (tid) addThreadUsage(tid, inTok, outTok, cost);
    } catch { /* ignore */ }
  });

  listen<string>("ai-rate-limit", (event) => {
    try {
      const data = JSON.parse(event.payload);
      if (data.status === "rejected") {
        threadCallbacks?.forkAndSwitch();
      }
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
    updateContextBar();
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

  // Gap timer — show inline dots if no tokens for 5s during streaming
  let gapTimer: ReturnType<typeof setTimeout> | null = null;
  let inlineDotsEl: HTMLElement | null = null;

  function startGapTimer() {
    clearGapTimer();
    gapTimer = setTimeout(() => {
      if (isStreaming) {
        const contentEl = messagesContainer.querySelector(".ai-msg-assistant:last-child .ai-msg-content");
        if (contentEl && !inlineDotsEl) {
          inlineDotsEl = document.createElement("span");
          inlineDotsEl.className = "inline-loading-dots";
          inlineDotsEl.innerHTML = "<span></span><span></span><span></span>";
          contentEl.appendChild(inlineDotsEl);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }
    }, 5000);
  }

  function clearGapTimer() {
    if (gapTimer) { clearTimeout(gapTimer); gapTimer = null; }
    if (inlineDotsEl) { inlineDotsEl.remove(); inlineDotsEl = null; }
  }

  // Listen for thinking tokens (shown as a transient muted indicator)
  listen<string>("ai-thinking-chunk", (event) => {
    const token = event.payload;
    if (!token) return;

    clearGapTimer();
    updateThinkingBlock(token);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    startGapTimer();
  });

  // ---- Image attachments ----
  const imagePreview = document.getElementById("ai-image-preview")!;
  const attachBtn = document.getElementById("ai-attach")!;
  function addImage(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        const path: string = await invoke("write_temp_image", { name: file.name, dataUrl });
        attachedImages.push({ name: file.name, path, dataUrl });
        renderImagePreview();
      } catch (err) {
        messagesContainer.appendChild(createMessageEl("system", `Error attaching image: ${err}`));
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    };
    reader.readAsDataURL(file);
  }

  function renderImagePreview() {
    if (attachedImages.length === 0) {
      imagePreview.innerHTML = "";
      imagePreview.style.display = "none";
      return;
    }
    imagePreview.style.display = "flex";
    imagePreview.innerHTML = attachedImages.map((img, i) => `
      <div class="ai-image-thumb">
        <img src="${img.dataUrl}" alt="${img.name}" />
        <span class="ai-image-name">${escapeHtml(img.name)}</span>
        <button class="ai-image-remove" data-idx="${i}">&times;</button>
      </div>
    `).join("");
    imagePreview.querySelectorAll(".ai-image-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt((e.target as HTMLElement).dataset.idx || "0");
        attachedImages.splice(idx, 1);
        renderImagePreview();
      });
    });
  }

  // Attach button — file picker
  attachBtn.addEventListener("click", () => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.multiple = true;
    fileInput.addEventListener("change", () => {
      if (fileInput.files) {
        Array.from(fileInput.files).forEach(addImage);
      }
    });
    fileInput.click();
  });

  // Paste images
  input.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) addImage(file);
      }
    }
  });

  // Drag and drop images
  input.addEventListener("dragover", (e) => { e.preventDefault(); input.classList.add("drag-over"); });
  input.addEventListener("dragleave", () => { input.classList.remove("drag-over"); });
  input.addEventListener("drop", (e) => {
    e.preventDefault();
    input.classList.remove("drag-over");
    if (e.dataTransfer?.files) {
      Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/")).forEach(addImage);
    }
  });

  window.addEventListener("zauri-ai-reply", ((event: CustomEvent) => {
    const detail = event.detail as ReplyTarget | undefined;
    if (!detail) return;
    replyTarget = detail;
    updateReplyBar();
    input.focus();
  }) as EventListener);

  function renderToolCall(payload: { name?: string; input?: string; status?: string }) {
    const msgEl = ensureStreamingMessage();
    let container = msgEl.querySelector(".ai-tool-calls") as HTMLElement | null;
    if (!container) {
      container = document.createElement("div");
      container.className = "ai-tool-calls";
      const content = msgEl.querySelector(".ai-msg-content");
      if (content) msgEl.insertBefore(container, content);
      else msgEl.appendChild(container);
    }

    const name = payload.name || "Tool";
    const inputText = payload.input?.trim() || "";
    const key = `${name}:${inputText}`;
    const status = payload.status || "running";
    let row = currentStreamToolCalls.get(key);

    if (!row) {
      row = document.createElement("div");
      row.className = "ai-tool-call";
      row.innerHTML = `
        <div class="ai-tool-call-header">
          <span class="ai-tool-call-name"></span>
          <span class="ai-tool-call-status"></span>
        </div>
        <pre class="ai-tool-call-input"></pre>
      `;
      container.appendChild(row);
      currentStreamToolCalls.set(key, row);
    }

    row.querySelector(".ai-tool-call-name")!.textContent = name;
    row.querySelector(".ai-tool-call-status")!.textContent = status;
    row.querySelector(".ai-tool-call-input")!.textContent = inputText;
  }

  listen<string>("ai-tool-call", (event) => {
    try {
      renderToolCall(JSON.parse(event.payload));
    } catch {
      renderToolCall({ name: event.payload });
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });

  // Progressive markdown rendering flag
  let markdownRenderPending = false;

  // Listen for response text
  listen<string>("ai-response-chunk", (event) => {
    const token = event.payload;
    if (token === null || token === undefined || token === "") return;

    clearPlanHint();
    clearGapTimer();
    const msgEl = ensureStreamingMessage();

    // Append token (preserve whitespace — don't trim!)
    currentStreamContent += token;

    // Progressive markdown rendering — throttled to avoid perf issues
    const contentEl = msgEl.querySelector(".ai-msg-content");
    if (contentEl) {
      if (!markdownRenderPending) {
        markdownRenderPending = true;
        requestAnimationFrame(() => {
          markdownRenderPending = false;
          if (contentEl && isStreaming) {
            contentEl.innerHTML = renderMarkdown(currentStreamContent);
            linkifyFilePaths(contentEl as HTMLElement);
          }
          messagesContainer.scrollTop = messagesContainer.scrollHeight;

          // Live diff detection — check for filepath: blocks as they stream in
          if (currentStreamContent.includes("```filepath:") && editCallbacks) {
            const root = getRootPath();
            if (root) {
              // Only process complete blocks (has closing ```)
              const completeBlockRegex = /```filepath:([\S]+)\n([\s\S]*?)```/g;
              let match;
              while ((match = completeBlockRegex.exec(currentStreamContent)) !== null) {
                const filePath = match[1].startsWith("/") ? match[1] : `${root}/${match[1]}`;
                const blockId = `live-diff-${filePath}`;
                // Only show each file's diff once during streaming
                if (!document.getElementById(blockId)) {
                  const newContent = match[2];
                  const originalContent = editCallbacks.getFileContent(filePath) || "";
                  if (originalContent !== newContent) {
                    const diffBanner = document.createElement("div");
                    diffBanner.id = blockId;
                    diffBanner.className = "ai-live-diff fade-in";
                    const name = filePath.split("/").pop() || filePath;
                    diffBanner.innerHTML = `
                      <span class="live-diff-icon">&#9998;</span>
                      <span class="live-diff-name">${name}</span>
                      <button class="live-diff-view" data-path="${filePath}">View Diff</button>
                    `;
                    diffBanner.querySelector(".live-diff-view")?.addEventListener("click", () => {
                      const edit = {
                        filePath,
                        newContent,
                        originalContent,
                        additions: 0,
                        deletions: 0,
                      };
                      editCallbacks!.showProposedEdit(edit);
                    });
                    msgEl.appendChild(diffBanner);
                  }
                }
              }
            }
          }
        });
      }
    }

    // Restart gap timer for next pause
    startGapTimer();
  });

  // Log AI debug messages
  listen<string>("ai-log", (event) => {
    console.log("[ai:log]", event.payload);
    const logLine = event.payload?.trim();
    if (logLine && /(error|failed|panic|denied|timed out|timeout)/i.test(logLine)) {
      lastStreamError = logLine;
    }
  });

  // Capture session ID for conversation continuity
  // Handle permission denials — show "Allow & Retry" banner
  listen<string>("ai-permission-denied", (event) => {
    try {
      const data = JSON.parse(event.payload);
      const banner = document.createElement("div");
      banner.className = "ai-permission-banner fade-in";
      banner.innerHTML = `
        <div class="permission-text">
          <strong>Permission denied</strong> — ${data.count} action${data.count > 1 ? "s" : ""} blocked
        </div>
        <div class="permission-actions">
          <button class="permission-btn primary" id="perm-retry">Allow & Retry</button>
          <button class="permission-btn" id="perm-dismiss">Dismiss</button>
        </div>
      `;
      banner.querySelector("#perm-retry")?.addEventListener("click", () => {
        banner.remove();
        // Re-send the last user message with auto permission mode
        const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
        if (lastUserMsg) {
          // Temporarily override permission to auto
          const origPerm = (panel.querySelector("#ai-permission-btn") as HTMLElement)?.dataset.value;
          const permBtn = panel.querySelector("#ai-permission-btn") as HTMLElement;
          if (permBtn) permBtn.dataset.value = "bypassPermissions";
          input.value = lastUserMsg.content;
          sendMessage();
          // Restore original permission
          if (permBtn && origPerm) permBtn.dataset.value = origPerm;
        }
      });
      banner.querySelector("#perm-dismiss")?.addEventListener("click", () => banner.remove());
      messagesContainer.appendChild(banner);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch { /* ignore */ }
  });

  listen<string>("ai-session-id", (event) => {
    if (event.payload && threadCallbacks) {
      threadCallbacks.saveSessionId(event.payload);
    }
  });

  function showProposedChanges(edits: ProposedEdit[], label: string = `Proposed Changes (${edits.length} file${edits.length > 1 ? "s" : ""})`) {
    if (!editCallbacks || edits.length === 0) return;

    const changesEl = document.createElement("div");
    changesEl.className = "ai-proposed-changes fade-in";

    let html = `<div class="ai-changes-header">
      <span>${escapeHtml(label)}</span>
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

    changesEl.querySelector(".accept-all")?.addEventListener("click", async () => {
      await editCallbacks.acceptAllEdits();
      changesEl.remove();
    });
    changesEl.querySelector(".reject-all")?.addEventListener("click", () => {
      editCallbacks.rejectAllEdits();
      changesEl.remove();
    });
    changesEl.querySelectorAll(".ai-change-item").forEach((item) => {
      item.addEventListener("click", () => {
        const path = (item as HTMLElement).dataset.path;
        const edit = edits.find((candidate) => candidate.filePath === path);
        if (edit) editCallbacks.showProposedEdit(edit);
      });
    });

    messagesContainer.appendChild(changesEl);
    editCallbacks.showProposedEdit(edits[0]);
  }

  listen<string>("ai-response-done", (event) => {
    removeLoading();
    clearGapTimer();
    isStreaming = false;
    isSending = false;
    currentStreamToolCalls.clear();

    const streamingMsg = getStreamingMessage();
    finalizeThinkingBlock(streamingMsg);
    const responseText = currentStreamContent.trim();

    // Remove empty assistant bubble if no content received
    if (!responseText) {
      const emptyMsg = streamingMsg;
      if (emptyMsg) {
        const content = emptyMsg.querySelector(".ai-msg-content");
        const hasToolCalls = !!emptyMsg.querySelector(".ai-tool-call");
        const hasThinking = !!emptyMsg.querySelector(".ai-thinking-block .ai-thinking-summary")?.textContent?.trim();
        if (content && !content.textContent?.trim() && !hasToolCalls && !hasThinking) {
          emptyMsg.remove();
        }
      }
      const streamError = resolveStreamError(event.payload);
      if (streamError) {
        const errMsg = createMessageEl("system", streamError);
        messagesContainer.appendChild(errMsg);
      } else if (event.payload !== "ok") {
        const errMsg = createMessageEl("system", "No response received. Try sending again.");
        messagesContainer.appendChild(errMsg);
      }
    }

    if (responseText) {
      messages.push({
        role: "assistant",
        content: responseText,
        timestamp: Date.now(),
      });
      threadCallbacks?.saveMessage("assistant", responseText);
      updateContextBar();

      // Re-render the last message as markdown
      const lastMsg = streamingMsg?.querySelector(".ai-msg-content");
      if (lastMsg) {
        lastMsg.innerHTML = renderMarkdown(responseText);
        linkifyFilePaths(lastMsg as HTMLElement);
      }

      // Detect plan responses — show "Press Enter to execute"
      const lowerResp = responseText.toLowerCase();
      const hasPlanIndicators = (
        (lowerResp.includes("plan") || lowerResp.includes("approach") || lowerResp.includes("implementation")) &&
        (lowerResp.includes("step") || lowerResp.includes("1.") || lowerResp.includes("phase"))
      );
      if (hasPlanIndicators && !responseText.includes("```filepath:")) {
        pendingPlan = responseText;
        isPlanHintDismissed = false;
        updatePlanHint();
      } else {
        clearPlanHint();
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
          showProposedChanges(edits);
        } else if (currentProvider === "codex" && root) {
          invoke<any[]>("git_changed_files", { workingDir: root }).then((files) => {
            const directEdits = files.map((file) => ({
              filePath: `${root}/${file.path}`,
              originalContent: file.original_content || "",
              newContent: file.current_content || "",
              additions: file.additions || 0,
              deletions: file.deletions || 0,
            } satisfies ProposedEdit)).filter((edit) => edit.originalContent !== edit.newContent);

            if (directEdits.length > 0) {
              showProposedChanges(
                directEdits,
                `Codex changed ${directEdits.length} file${directEdits.length > 1 ? "s" : ""}`,
              );
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
    updateReplyBar();
    currentStreamContent = "";
    currentThinkingContent = "";
    lastStreamError = null;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    updateContextBar();
  });

  let isSending = false;
  let projectContext: string | null = null; // Loaded via /init

  async function handleSlashInit() {
    const root = getRootPath();
    if (!root) {
      const errMsg = createMessageEl("system", "No project folder open. Open a folder first.");
      messagesContainer.appendChild(errMsg);
      return;
    }
    try {
      const context: string = await invoke("read_project_context", { workingDir: root });
      projectContext = context;
      const sysMsg = createMessageEl("system", `Project context loaded (CLAUDE.md). ${context.length} chars injected into future prompts.`);
      messagesContainer.appendChild(sysMsg);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      updateContextBar();
    } catch (e) {
      const errMsg = createMessageEl("system", String(e));
      messagesContainer.appendChild(errMsg);
    }
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isStreaming || isSending) return;

    // Handle slash commands
    if (text.startsWith("/")) {
      const cmd = text.split(" ")[0].toLowerCase();
      if (cmd === "/init") {
        input.value = "";
        await handleSlashInit();
        return;
      } else if (cmd === "/clear") {
        input.value = "";
        messagesContainer.innerHTML = "";
        messages.length = 0;
        currentStreamContent = "";
        currentThinkingContent = "";
        projectContext = null;
        replyTarget = null;
        updateReplyBar();
        clearPlanHint();
        updateContextBar();
        return;
      }
    }

    isSending = true;
    clearPlanHint();
    lastStreamError = null;

    const activeThreadId = await threadCallbacks?.ensureActiveThread();
    const sentAttachments = attachedImages.map((img) => ({ name: img.name, dataUrl: img.dataUrl }));
    const sentReplyTarget = replyTarget;
    const composedPrompt = buildPrompt(text);

    // Add user message
    messages.push({ role: "user", content: text, timestamp: Date.now() });
    await threadCallbacks?.saveMessage("user", text);
    if (activeThreadId) {
      await setThreadProvider(activeThreadId, currentProvider);
    }
    const msg = createMessageEl("user", text, {
      attachments: sentAttachments,
      replyTo: sentReplyTarget || undefined,
    });
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    updateContextBar();

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

    const imagePaths = attachedImages.map((img) => img.path);
    // Clear images after sending
    attachedImages = [];
    renderImagePreview();
    replyTarget = null;
    updateReplyBar();
    currentStreamToolCalls.clear();

    await threadCallbacks?.saveModelAndPermission(modelVal, permVal);

    invoke("ai_chat", {
      prompt: projectContext ? `${projectContext}\n\n${composedPrompt}` : composedPrompt,
      workingDir: rootPath,
      contextFiles: openFiles,
      provider: currentProvider,
      sessionId: (activeThreadId && threadCallbacks?.getSessionId()) || null,
      model: modelVal,
      images: imagePaths,
      permissionMode: permVal,
      streamThinking: thinkingBtn.dataset.enabled === "true",
    }).catch((err) => {
      removeLoading();
      isSending = false;
      isStreaming = false;
      finalizeThinkingBlock();
      currentThinkingContent = "";
      const errMsg = createMessageEl("system", `Error: ${err}`);
      messagesContainer.appendChild(errMsg);
      statusEl.textContent = "Error";
      statusEl.className = "ai-status error";
      sendBtn.classList.remove("hidden");
      stopBtn.classList.add("hidden");
      sendBtn.removeAttribute("disabled");
      input.removeAttribute("disabled");
    });
  }

  // Update context bar when files change
  function updateContextBar() {
    const activeFile = getActiveFilePath();
    const openFiles = getOpenFilePaths();

    const threadTokens = messages.reduce((total, message) => total + estimateTokens(message.content), 0);
    const fileDetails = openFiles.map((filePath) => {
      const content = editCallbacks?.getFileContent(filePath) || "";
      return {
        path: filePath,
        name: filePath.split("/").pop() || filePath,
        tokens: estimateTokens(content),
        active: filePath === activeFile,
      };
    });
    const fileTokens = fileDetails.reduce((total, file) => total + file.tokens, 0);
    const initTokens = projectContext ? estimateTokens(projectContext) : 0;
    const totalTokens = threadTokens + fileTokens + initTokens;
    const modelValue = modelBtn.dataset.value || "";
    const contextLimit = getContextWindowEstimate(currentProvider, modelValue);
    const usagePercent = Math.min(100, Math.round((totalTokens / contextLimit) * 100));

    if (openFiles.length === 0 && messages.length === 0 && !projectContext) {
      contextBar.innerHTML = "";
      return;
    }

    const fileChips = fileDetails.map((file) =>
      `<span class="context-chip${file.active ? " active" : ""}">${escapeHtml(file.name)} <span class="context-chip-meta">~${file.tokens.toLocaleString()}</span></span>`,
    ).join("");

    const metaChips = [
      `<span class="context-chip subtle">Thread ${messages.length} msg${messages.length === 1 ? "" : "s"} <span class="context-chip-meta">~${threadTokens.toLocaleString()}</span></span>`,
      projectContext
        ? `<span class="context-chip subtle">Project context <span class="context-chip-meta">~${initTokens.toLocaleString()}</span></span>`
        : "",
    ].filter(Boolean).join("");

    contextBar.innerHTML = `
      <div class="context-overview">
        <span class="context-label">Context</span>
        <span class="context-total">~${totalTokens.toLocaleString()} / ${contextLimit.toLocaleString()} est. tokens</span>
      </div>
      <div class="context-meter">
        <div class="context-meter-fill" style="width:${usagePercent}%"></div>
      </div>
      <div class="context-chips">${metaChips}${fileChips}</div>
    `;
  }

  // Expose updateContextBar
  (panel as any)._updateContext = updateContextBar;
  (panel as any)._restoreUsage = (threadId: string) => {
    const usage = getThreadUsage(threadId);
    totalInputTokens = usage.inputTokens;
    totalOutputTokens = usage.outputTokens;
    totalCost = usage.costUsd;
    updateUsageDisplay();
  };

  (panel as any)._updatePlaceholder = (hasMessages: boolean) => {
    if (!hasMessages && currentProvider === "claude") {
      input.placeholder = "Ask about your code... (try /init)";
    } else {
      input.placeholder = "Ask about your code...";
    }
  };

  (panel as any)._setModelAndPermission = (model: string, permissionMode: string) => {
    const cfg = providerConfigs[currentProvider] || providerConfigs.claude;
    const modelOpt = cfg.models.find((m: { value: string }) => m.value === model);
    if (modelOpt) {
      modelBtn.dataset.value = model;
      modelBtn.innerHTML = `${modelOpt.label} <span class="dropdown-caret">&#9662;</span>`;
    }
    const permOpt = cfg.permissions.find((p: { value: string }) => p.value === permissionMode);
    if (permOpt) {
      permBtn.dataset.value = permissionMode;
      permBtn.innerHTML = `${permOpt.label} <span class="dropdown-caret">&#9662;</span>`;
    }
    updateContextBar();
  };
  (panel as any)._setProvider = (provider: string) => {
    const nextProvider = provider === "codex" ? "codex" : "claude";
    currentProvider = nextProvider;
    activeProviderName = nextProvider === "codex" ? "Codex" : "Claude";
    providerBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.provider === nextProvider);
    });
    switchProviderConfig(nextProvider);
    updateReplyBar();
    checkProvider(statusEl, nextProvider);
    updateContextBar();
  };
  (panel as any)._setThreadMessages = (threadMessages: ChatMessage[]) => {
    messages = threadMessages.map((message) => ({ ...message }));
    updateContextBar();
  };
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

/** Make file paths in <code> elements clickable to open in editor */
function linkifyFilePaths(container: HTMLElement) {
  const openFilePath = (path: string) => {
    window.dispatchEvent(new CustomEvent("zauri-open-file", { detail: { path } }));
  };

  // Match inline <code> elements (not inside <pre>)
  container.querySelectorAll("code").forEach((codeEl) => {
    if (codeEl.closest("pre")) return; // Skip code blocks
    if (codeEl.querySelector("a")) return; // Already linkified

    const text = codeEl.textContent || "";
    // Match file-like paths: has a / or . extension, common code extensions
    const isFilePath = /^[\w.\-\/\\]+\.\w{1,10}$/.test(text) && text.includes(".");
    if (!isFilePath) return;

    // Check if it looks like a real file path (has a known extension)
    const ext = text.split(".").pop()?.toLowerCase() || "";
    const codeExts = ["ts", "tsx", "js", "jsx", "go", "rs", "py", "rb", "java", "c", "h", "cpp", "hpp",
      "css", "scss", "html", "json", "toml", "yaml", "yml", "md", "sh", "bash", "zig", "vue", "svelte",
      "sql", "proto", "xml", "env", "lock", "mod", "sum", "txt", "cfg", "conf", "dockerfile"];
    if (!codeExts.includes(ext) && !text.includes("/")) return;

    codeEl.classList.add("file-link");
    codeEl.title = `Open ${text}`;
    codeEl.addEventListener("click", () => openFilePath(text));
  });

  container.querySelectorAll("a").forEach((linkEl) => {
    const href = linkEl.getAttribute("href") || "";
    const text = (linkEl.textContent || "").trim();
    const target = href.startsWith("#") ? text : href;
    if (!/^[\w.\-\/\\]+\.\w{1,10}$/.test(target) && !target.includes("/")) return;
    linkEl.classList.add("file-link");
    linkEl.addEventListener("click", (event) => {
      event.preventDefault();
      openFilePath(target);
    });
  });
}

function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
}

// Expose for thread switching
(window as any).__renderMarkdown = renderMarkdown;

// Track current provider name globally for message headers
let activeProviderName = "Claude";

export function createMessageEl(
  role: string,
  content: string,
  options?: { attachments?: MessageAttachment[]; replyTo?: ReplyTarget },
): HTMLElement {
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

  if (content) {
    // Render markdown for both user and assistant messages
    // (user messages may contain pasted code, backticks, lists, etc.)
    const hasFormatting = content.includes("`") || content.includes("**") || content.includes("- ") || content.includes("```") || content.includes("1.");
    if (role === "assistant" || hasFormatting) {
      body.innerHTML = renderMarkdown(content);
      if (role !== "system") linkifyFilePaths(body);
    } else {
      body.textContent = content;
    }
  }

  const replyEl = options?.replyTo ? document.createElement("div") : null;
  if (replyEl && options?.replyTo) {
    replyEl.className = "ai-msg-reply";
    replyEl.innerHTML = `
      <span class="ai-msg-reply-label">Replying to ${options.replyTo.role === "assistant" ? activeProviderName : "you"}</span>
      <span class="ai-msg-reply-text">${escapeHtml(options.replyTo.content.replace(/\s+/g, " ").slice(0, 160))}${options.replyTo.content.length > 160 ? "..." : ""}</span>
    `;
  }

  const attachmentsEl = options?.attachments?.length ? document.createElement("div") : null;
  if (attachmentsEl && options?.attachments) {
    attachmentsEl.className = "ai-msg-attachments";
    attachmentsEl.innerHTML = options.attachments.map((attachment) => `
      <div class="ai-msg-attachment">
        ${attachment.dataUrl ? `<img src="${attachment.dataUrl}" alt="${escapeHtml(attachment.name)}" />` : ""}
        <span>${escapeHtml(attachment.name)}</span>
      </div>
    `).join("");
  }

  // Hover actions
  const actions = document.createElement("div");
  actions.className = "ai-msg-actions";
  actions.innerHTML = `
    <button class="msg-action-btn" title="Copy" data-action="copy">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3 11V3h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
    </button>
    ${role !== "system" ? '<button class="msg-action-btn" title="Reply to this" data-action="reply"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6.5 4.5L2.5 8l4 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 8h5.5a4.5 4.5 0 014.5 4.5V13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>' : ""}
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
    } else if (action === "reply") {
      window.dispatchEvent(new CustomEvent("zauri-ai-reply", {
        detail: { role, content },
      }));
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
  if (replyEl) el.appendChild(replyEl);
  el.appendChild(body);
  if (attachmentsEl) el.appendChild(attachmentsEl);
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
