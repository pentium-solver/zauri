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
      <div class="ai-header-left">
        <select id="ai-provider" class="ai-provider-select">
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </div>
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
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 14l12-6L2 2v5l8 1-8 1z" fill="currentColor"/>
          </svg>
        </button>
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
  const providerSelect = document.getElementById("ai-provider") as HTMLSelectElement;

  // Check provider availability
  checkProvider(statusEl, "claude");

  providerSelect.addEventListener("change", () => {
    checkProvider(statusEl, providerSelect.value);
  });

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

  // Listen for streaming response chunks
  listen<string>("ai-response-chunk", (event) => {
    const line = event.payload;
    // Skip empty lines at the start of the response
    if (!isStreaming && line.trim() === "") return;

    if (!isStreaming) {
      isStreaming = true;
      const msg = createMessageEl("assistant", "");
      messagesContainer.appendChild(msg);
      currentStreamContent = "";
    }
    // Only add newline between lines, not before the first one
    if (currentStreamContent.length > 0) {
      currentStreamContent += "\n";
    }
    currentStreamContent += line;
    const lastMsg = messagesContainer.querySelector(".ai-msg:last-child .ai-msg-content");
    if (lastMsg) {
      lastMsg.textContent = currentStreamContent.trimEnd();
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });

  listen<string>("ai-response-done", (event) => {
    isStreaming = false;
    if (currentStreamContent) {
      messages.push({
        role: "assistant",
        content: currentStreamContent,
        timestamp: Date.now(),
      });
    }
    statusEl.textContent = event.payload === "ok" ? "Ready" : "Error";
    statusEl.className = `ai-status ${event.payload === "ok" ? "ready" : "error"}`;
    sendBtn.removeAttribute("disabled");
    input.removeAttribute("disabled");
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
      provider: providerSelect.value,
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
