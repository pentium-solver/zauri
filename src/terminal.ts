import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

let sessionId: string | null = null;
let isSpawned = false;

export function createTerminalPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.id = "terminal-panel";
  panel.className = "hidden";
  panel.innerHTML = `
    <div id="terminal-resize"></div>
    <div id="terminal-header">
      <div class="terminal-tabs">
        <span class="terminal-tab active">Terminal</span>
      </div>
      <div class="terminal-actions">
        <button id="terminal-clear" class="terminal-action-btn" title="Clear">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
        <button id="terminal-close" class="terminal-action-btn" title="Close">&times;</button>
      </div>
    </div>
    <div id="terminal-output"></div>
    <div id="terminal-input-line">
      <input id="terminal-input" type="text" spellcheck="false" autocomplete="off" placeholder="Type a command..." />
    </div>
  `;
  return panel;
}

export function initTerminal(getRootPath: () => string | null) {
  const output = document.getElementById("terminal-output")!;
  const input = document.getElementById("terminal-input") as HTMLInputElement;
  const closeBtn = document.getElementById("terminal-close")!;
  const clearBtn = document.getElementById("terminal-clear")!;

  let commandHistory: string[] = [];
  let historyIndex = -1;

  // Listen for PTY output
  listen<{ id: string; data: string; stream: string }>("terminal-output", (event) => {
    if (event.payload.id !== sessionId) return;
    appendOutput(event.payload.data, event.payload.stream);
  });

  listen<{ id: string; code: number }>("terminal-exit", (event) => {
    if (event.payload.id !== sessionId) return;
    appendOutput(`\nProcess exited (${event.payload.code})\n`, "exit");
    isSpawned = false;
    sessionId = null;
  });

  function appendOutput(text: string, stream: string) {
    // Parse ANSI escape codes minimally — strip them for now
    const clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    if (!clean) return;

    const el = document.createElement("span");
    el.className = `terminal-text ${stream === "stderr" ? "stderr" : ""}`;
    el.textContent = clean;
    output.appendChild(el);
    output.scrollTop = output.scrollHeight;
  }

  async function ensureSession() {
    if (isSpawned && sessionId) return;

    sessionId = `pty-${Date.now()}`;
    isSpawned = true;
    const workingDir = getRootPath() || ".";

    try {
      await invoke("terminal_spawn", {
        workingDir,
        terminalId: sessionId,
      });
    } catch (err) {
      appendOutput(`Failed to spawn terminal: ${err}\n`, "stderr");
      isSpawned = false;
      sessionId = null;
    }
  }

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      const cmd = input.value;
      if (!cmd && !isSpawned) return;

      input.value = "";
      if (cmd) {
        commandHistory.unshift(cmd);
        historyIndex = -1;
      }

      if (isSpawned && sessionId) {
        // Send to PTY
        await invoke("terminal_write", {
          terminalId: sessionId,
          data: cmd + "\n",
        }).catch(() => {});
      } else {
        // Spawn PTY first, then send
        await ensureSession();
        if (sessionId) {
          // PTY auto-starts shell, just send the command
          if (cmd) {
            // Small delay to let the shell start
            setTimeout(async () => {
              await invoke("terminal_write", {
                terminalId: sessionId,
                data: cmd + "\n",
              }).catch(() => {});
            }, 200);
          }
        }
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        historyIndex++;
        input.value = commandHistory[historyIndex];
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        input.value = commandHistory[historyIndex];
      } else {
        historyIndex = -1;
        input.value = "";
      }
    } else if (e.key === "c" && e.ctrlKey) {
      // Send Ctrl+C to PTY
      if (isSpawned && sessionId) {
        await invoke("terminal_write", {
          terminalId: sessionId,
          data: "\x03",
        }).catch(() => {});
      }
    }
  });

  closeBtn.addEventListener("click", () => {
    document.getElementById("terminal-panel")!.classList.add("hidden");
  });

  clearBtn.addEventListener("click", () => {
    output.innerHTML = "";
  });

  // Auto-spawn when panel opens
  const observer = new MutationObserver(async () => {
    const panel = document.getElementById("terminal-panel");
    if (panel && !panel.classList.contains("hidden")) {
      if (!isSpawned) {
        await ensureSession();
      }
      input.focus();
    }
  });
  observer.observe(document.getElementById("terminal-panel")!, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

export function toggleTerminal() {
  const panel = document.getElementById("terminal-panel");
  if (panel) {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      const input = document.getElementById("terminal-input") as HTMLInputElement;
      input?.focus();
    }
  }
}
