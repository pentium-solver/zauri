import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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
        <button id="ai-close" class="ai-header-btn" title="Close">&times;</button>
      </div>
    </div>
    <div id="ai-messages"></div>
    <div id="ai-input-area">
      <div id="ai-context-bar"></div>
      <div id="ai-composer">
        <textarea id="ai-input" placeholder="Ask about your code..." rows="3"></textarea>
        <button id="ai-send" title="Send (Enter)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15"/>
            <path d="M6 4l5 4-5 4" fill="currentColor"/>
          </svg>
        </button>
      </div>
      <div id="ai-toolbar">
        <button class="ai-provider-btn active" data-provider="claude" title="Claude Code">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 1C4.134 1 1 4.134 1 8s3.134 7 7 7 7-3.134 7-7S11.866 1 8 1z" fill="#D97757" opacity="0.8"/>
            <path d="M5.5 6.5l2.5 2 2.5-2M6 10h4" stroke="white" stroke-width="1" stroke-linecap="round"/>
          </svg>
          <span>Claude</span>
        </button>
        <button class="ai-provider-btn" data-provider="codex" title="Codex">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="#10A37F" stroke-width="1.2" fill="none"/>
            <path d="M5.5 8a2.5 2.5 0 015 0M8 5.5v5" stroke="#10A37F" stroke-width="1" stroke-linecap="round"/>
          </svg>
          <span>Codex</span>
        </button>
        <div class="ai-toolbar-sep"></div>
        <span id="ai-toolbar-status" class="ai-toolbar-info">Chat</span>
      </div>
    </div>
  `;
  return panel;
}

export function initAIPanel(
  getActiveFilePath: () => string | null,
  getOpenFilePaths: () => string[],
  getRootPath: () => string | null,
) {
  const panel = document.getElementById("ai-panel")!;
  const messagesContainer = document.getElementById("ai-messages")!;
  const input = document.getElementById("ai-input") as HTMLTextAreaElement;
  const sendBtn = document.getElementById("ai-send")!;
  const closeBtn = document.getElementById("ai-close")!;
  const statusEl = document.getElementById("ai-status")!;
  const contextBar = document.getElementById("ai-context-bar")!;

  let currentProvider = "claude";

  // Provider buttons
  const providerBtns = panel.querySelectorAll<HTMLButtonElement>(".ai-provider-btn");
  providerBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      providerBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentProvider = btn.dataset.provider || "claude";
      checkProvider(statusEl, currentProvider);
    });
  });

  // Check initial provider
  checkProvider(statusEl, "claude");

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

  sendBtn.addEventListener("click", () => sendMessage());
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

  // --- Loading dots element ---
  let loadingEl: HTMLElement | null = null;

  function showLoading() {
    loadingEl = document.createElement("div");
    loadingEl.className = "ai-msg ai-msg-assistant ai-loading fade-in";
    loadingEl.innerHTML = `<div class="ai-msg-header">Claude</div><div class="ai-loading-dots"><span></span><span></span><span></span></div>`;
    messagesContainer.appendChild(loadingEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function removeLoading() {
    if (loadingEl) {
      loadingEl.remove();
      loadingEl = null;
    }
  }

  // Listen for response chunks (from "assistant" event — partial text)
  listen<string>("ai-response-chunk", (event) => {
    const text = event.payload;
    if (!text) return;

    removeLoading();

    if (!isStreaming) {
      isStreaming = true;
      const msg = createMessageEl("assistant", "");
      messagesContainer.appendChild(msg);
      currentStreamContent = "";
    }

    currentStreamContent += text;
    const lastMsg = messagesContainer.querySelector(".ai-msg:last-child .ai-msg-content");
    if (lastMsg) {
      lastMsg.textContent = currentStreamContent;
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });

  // Listen for definitive result (replaces any partial content)
  listen<string>("ai-response-result", (event) => {
    const text = event.payload;
    if (!text) return;

    removeLoading();

    // If we already have a streaming message, update it with the final text
    // If not, create a new message
    if (!isStreaming) {
      isStreaming = true;
      const msg = createMessageEl("assistant", "");
      messagesContainer.appendChild(msg);
    }

    currentStreamContent = text;
    const lastMsg = messagesContainer.querySelector(".ai-msg:last-child .ai-msg-content");
    if (lastMsg) {
      lastMsg.textContent = text;
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });

  listen<string>("ai-response-done", (event) => {
    removeLoading();
    isStreaming = false;

    if (currentStreamContent) {
      messages.push({
        role: "assistant",
        content: currentStreamContent.trim(),
        timestamp: Date.now(),
      });
    }
    statusEl.textContent = event.payload === "ok" ? "Ready" : "Error";
    statusEl.className = `ai-status ${event.payload === "ok" ? "ready" : "error"}`;
    sendBtn.removeAttribute("disabled");
    input.removeAttribute("disabled");
    input.focus();
    currentStreamContent = "";
  });

  function sendMessage() {
    const text = input.value.trim();
    if (!text || isStreaming) return;

    // Add user message
    messages.push({ role: "user", content: text, timestamp: Date.now() });
    const msg = createMessageEl("user", text);
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Show loading dots
    showLoading();

    input.value = "";
    input.style.height = "auto";
    sendBtn.setAttribute("disabled", "true");
    input.setAttribute("disabled", "true");
    statusEl.textContent = "Thinking...";
    statusEl.className = "ai-status thinking";

    // Gather context
    const openFiles = getOpenFilePaths();
    const rootPath = getRootPath() || ".";

    invoke("ai_chat", {
      prompt: text,
      workingDir: rootPath,
      contextFiles: openFiles,
      provider: currentProvider,
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

function createMessageEl(role: string, content: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `ai-msg ai-msg-${role} fade-in`;

  const header = document.createElement("div");
  header.className = "ai-msg-header";
  header.textContent = role === "user" ? "You" : role === "assistant" ? "Claude" : "System";

  const body = document.createElement("div");
  body.className = "ai-msg-content";
  body.textContent = content;

  el.appendChild(header);
  el.appendChild(body);
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
