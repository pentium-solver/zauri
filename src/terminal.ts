import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "xterm/css/xterm.css";

let sessionId: string | null = null;
let isSpawned = false;
let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;

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
    <div id="terminal-xterm"></div>
  `;
  return panel;
}

export function initTerminal(getRootPath: () => string | null) {
  const xtermContainer = document.getElementById("terminal-xterm")!;
  const closeBtn = document.getElementById("terminal-close")!;
  const clearBtn = document.getElementById("terminal-clear")!;

  // Create xterm.js instance with theme matching our editor
  term = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontSize: 13,
    fontFamily: '"SF Mono", "Cascadia Code", "JetBrains Mono", "Fira Code", ui-monospace, monospace',
    lineHeight: 1.4,
    theme: {
      background: "#141416",
      foreground: "rgba(255,255,255,0.88)",
      cursor: "#a882ff",
      cursorAccent: "#0e0e10",
      selectionBackground: "rgba(168, 130, 255, 0.25)",
      selectionForeground: "#ffffff",
      black: "#1a1a1e",
      red: "#f87171",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#a882ff",
      cyan: "#22d3ee",
      white: "rgba(255,255,255,0.88)",
      brightBlack: "rgba(255,255,255,0.25)",
      brightRed: "#fca5a5",
      brightGreen: "#6ee7b7",
      brightYellow: "#fde68a",
      brightBlue: "#93c5fd",
      brightMagenta: "#c4a8ff",
      brightCyan: "#67e8f9",
      brightWhite: "#ffffff",
    },
  });

  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());

  term.open(xtermContainer);

  // Send keystrokes to PTY
  term.onData((data) => {
    if (isSpawned && sessionId) {
      invoke("terminal_write", {
        terminalId: sessionId,
        data,
      }).catch(() => {});
    }
  });

  // Listen for PTY output
  listen<{ id: string; data: string; stream: string }>("terminal-output", (event) => {
    if (event.payload.id !== sessionId || !term) return;
    term.write(event.payload.data);
  });

  listen<{ id: string; code: number }>("terminal-exit", (event) => {
    if (event.payload.id !== sessionId || !term) return;
    term.writeln(`\r\n[Process exited with code ${event.payload.code}]`);
    isSpawned = false;
    sessionId = null;
  });

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
      term?.writeln(`\r\nFailed to spawn terminal: ${err}`);
      isSpawned = false;
      sessionId = null;
    }
  }

  closeBtn.addEventListener("click", () => {
    document.getElementById("terminal-panel")!.classList.add("hidden");
  });

  clearBtn.addEventListener("click", () => {
    term?.clear();
  });

  // Fit terminal when panel opens or resizes
  const resizeObserver = new ResizeObserver(() => {
    if (fitAddon && term) {
      try {
        fitAddon.fit();
        // Notify PTY of new size
        if (sessionId) {
          invoke("terminal_resize", {
            terminalId: sessionId,
            cols: term.cols,
            rows: term.rows,
          }).catch(() => {});
        }
      } catch {
        // Ignore fit errors when element is hidden
      }
    }
  });
  resizeObserver.observe(xtermContainer);

  // Auto-spawn when panel opens
  const observer = new MutationObserver(async () => {
    const panel = document.getElementById("terminal-panel");
    if (panel && !panel.classList.contains("hidden")) {
      if (!isSpawned) {
        await ensureSession();
      }
      // Fit after becoming visible
      requestAnimationFrame(() => {
        fitAddon?.fit();
        term?.focus();
      });
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
      requestAnimationFrame(() => {
        fitAddon?.fit();
        term?.focus();
      });
    }
  }
}
