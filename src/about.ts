import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  checkForUpdates,
  getUpdateState,
  installAvailableUpdate,
  subscribeToUpdateState,
  type UpdateState,
} from "./updater";

let isOpen = false;
let aboutPage: HTMLElement | null = null;
let cleanupUpdateSubscription: (() => void) | null = null;

export function isAboutOpen(): boolean {
  return isOpen;
}

function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function renderUpdateState(page: HTMLElement, updateState: UpdateState) {
  const statusEl = page.querySelector<HTMLElement>("#about-update-status");
  const badgeEl = page.querySelector<HTMLElement>("#about-update-badge");
  const highlightEl = page.querySelector<HTMLElement>("#about-update-highlight");
  const highlightTitleEl = page.querySelector<HTMLElement>("#about-update-highlight-title");
  const highlightBodyEl = page.querySelector<HTMLElement>("#about-update-highlight-body");
  const notesEl = page.querySelector<HTMLElement>("#about-update-notes");
  const progressWrapEl = page.querySelector<HTMLElement>("#about-update-progress");
  const progressFillEl = page.querySelector<HTMLElement>("#about-update-progress-fill");
  const progressLabelEl = page.querySelector<HTMLElement>("#about-update-progress-label");
  const progressBytesEl = page.querySelector<HTMLElement>("#about-update-progress-bytes");
  const installBtn = page.querySelector<HTMLButtonElement>("#about-install-update");
  const checkBtn = page.querySelector<HTMLButtonElement>("#about-check-update");

  if (!statusEl || !badgeEl || !highlightEl || !highlightTitleEl || !highlightBodyEl || !notesEl || !progressWrapEl || !progressFillEl || !progressLabelEl || !progressBytesEl || !installBtn || !checkBtn) {
    return;
  }

  const badgeClass = `about-update-badge about-update-badge-${updateState.phase}`;
  badgeEl.className = badgeClass;
  highlightEl.classList.add("hidden");
  notesEl.classList.add("hidden");
  progressWrapEl.classList.add("hidden");
  progressWrapEl.classList.remove("indeterminate");
  progressFillEl.style.width = "0%";
  progressLabelEl.textContent = "";
  progressBytesEl.textContent = "";
  installBtn.disabled = false;

  switch (updateState.phase) {
    case "checking":
      badgeEl.textContent = "Checking";
      statusEl.textContent = "Checking for updates...";
      installBtn.style.display = "none";
      checkBtn.textContent = "Checking...";
      checkBtn.disabled = true;
      break;
    case "available":
      badgeEl.textContent = "Available";
      statusEl.textContent = updateState.message ?? (updateState.version ? `Zauri v${updateState.version} is available.` : "Update available.");
      installBtn.style.display = "inline-flex";
      installBtn.textContent = updateState.version ? `Update to v${updateState.version}` : "Update & Restart";
      checkBtn.textContent = "Check Again";
      checkBtn.disabled = false;
      if (updateState.detail) {
        notesEl.textContent = updateState.detail;
        notesEl.classList.remove("hidden");
      }
      break;
    case "latest":
      badgeEl.textContent = "Current";
      statusEl.textContent = updateState.currentVersion
        ? `You're on the latest version: v${updateState.currentVersion}.`
        : "You're on the latest version.";
      installBtn.style.display = "none";
      checkBtn.textContent = "Check Again";
      checkBtn.disabled = false;
      break;
    case "downloading": {
      const hasTotal = !!updateState.totalBytes;
      const percent = hasTotal && updateState.totalBytes
        ? Math.max(0, Math.min(100, (updateState.downloadedBytes ?? 0) / updateState.totalBytes * 100))
        : 0;

      badgeEl.textContent = "Downloading";
      statusEl.textContent = updateState.message ?? (updateState.version ? `Downloading Zauri v${updateState.version}...` : "Downloading update...");
      progressWrapEl.classList.remove("hidden");
      if (!hasTotal) {
        progressWrapEl.classList.add("indeterminate");
      }
      progressFillEl.style.width = `${percent}%`;
      progressLabelEl.textContent = updateState.version ? `Downloading v${updateState.version}` : "Downloading update";
      progressBytesEl.textContent = hasTotal
        ? `${formatBytes(updateState.downloadedBytes)} / ${formatBytes(updateState.totalBytes)}`
        : `${formatBytes(updateState.downloadedBytes)} downloaded`;
      installBtn.style.display = "inline-flex";
      installBtn.textContent = "Downloading...";
      installBtn.disabled = true;
      checkBtn.textContent = "Check Again";
      checkBtn.disabled = true;
      break;
    }
    case "installing":
      badgeEl.textContent = "Installing";
      statusEl.textContent = updateState.message ?? (updateState.version ? `Installing Zauri v${updateState.version}...` : "Installing update...");
      progressWrapEl.classList.remove("hidden");
      progressFillEl.style.width = "100%";
      progressLabelEl.textContent = updateState.version ? `Installing v${updateState.version}` : "Installing update";
      progressBytesEl.textContent = "Download complete";
      installBtn.style.display = "inline-flex";
      installBtn.textContent = "Installing...";
      installBtn.disabled = true;
      checkBtn.textContent = "Check Again";
      checkBtn.disabled = true;
      break;
    case "restarting":
      badgeEl.textContent = "Restarting";
      statusEl.textContent = updateState.message ?? (updateState.version ? `Restarting into Zauri v${updateState.version}...` : "Restarting...");
      progressWrapEl.classList.remove("hidden");
      progressFillEl.style.width = "100%";
      progressLabelEl.textContent = "Restarting Zauri";
      progressBytesEl.textContent = "The new version will open in a moment";
      installBtn.style.display = "inline-flex";
      installBtn.textContent = "Restarting...";
      installBtn.disabled = true;
      checkBtn.textContent = "Check Again";
      checkBtn.disabled = true;
      break;
    case "updated":
      badgeEl.textContent = "Updated";
      statusEl.textContent = updateState.version
        ? `You're now running Zauri v${updateState.version}.`
        : "Zauri was updated successfully.";
      highlightTitleEl.textContent = updateState.version
        ? `Updated to v${updateState.version}`
        : "Update complete";
      highlightBodyEl.textContent = "The editor restarted into the new build. Review the version here, then keep working.";
      highlightEl.classList.remove("hidden");
      installBtn.style.display = "none";
      checkBtn.textContent = "Check for Updates";
      checkBtn.disabled = false;
      break;
    case "error":
      badgeEl.textContent = "Error";
      statusEl.textContent = updateState.message ?? "Update failed.";
      installBtn.style.display = "inline-flex";
      installBtn.textContent = "Retry Update";
      checkBtn.textContent = "Check Again";
      checkBtn.disabled = false;
      if (updateState.detail) {
        notesEl.textContent = updateState.detail;
        notesEl.classList.remove("hidden");
      }
      break;
    case "idle":
    default:
      badgeEl.textContent = "Ready";
      statusEl.textContent = "Check for updates to verify you're current.";
      installBtn.style.display = "none";
      checkBtn.textContent = "Check for Updates";
      checkBtn.disabled = false;
      break;
  }
}

async function refreshVersion(page: HTMLElement) {
  const versionEl = page.querySelector<HTMLElement>("#about-version");
  if (!versionEl) {
    return;
  }

  try {
    const version = await getVersion();
    versionEl.textContent = `v${version}`;
  } catch {
    versionEl.textContent = "Version unavailable";
  }
}

function buildAboutPage(): HTMLElement {
  const page = document.createElement("div");
  page.id = "about-page";
  page.className = "settings-page";
  page.innerHTML = `
    <div class="settings-scroll">
      <div class="about-hero">
        <h1 class="about-logo">Zauri</h1>
        <span class="about-ver" id="about-version">Loading version...</span>
        <p class="about-tagline">A lightweight, fast code editor with AI assistance.</p>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <h2>What Zauri aims to do</h2>
          <p>Built for developers who want speed, simplicity, and AI-powered workflows.</p>
        </div>
        <div class="about-goals">
          <div class="about-goal">
            <span class="about-goal-icon">&#9889;</span>
            <div>
              <strong>Sub-100ms startup</strong>
              <p>Native performance with a Zig-powered backend for file I/O and search.</p>
            </div>
          </div>
          <div class="about-goal">
            <span class="about-goal-icon">&#129302;</span>
            <div>
              <strong>AI coding assistant</strong>
              <p>Built-in Claude and Codex integration with inline diffs, accept/reject, and streaming responses.</p>
            </div>
          </div>
          <div class="about-goal">
            <span class="about-goal-icon">&#128268;</span>
            <div>
              <strong>Git integration</strong>
              <p>Branch management, commit/push/pull, status tracking all from the editor.</p>
            </div>
          </div>
          <div class="about-goal">
            <span class="about-goal-icon">&#128230;</span>
            <div>
              <strong>Minimal footprint</strong>
              <p>~9MB binary, ~3MB DMG. No Electron. Desktop-native via Tauri.</p>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <h2>Tech Stack</h2>
          <p>The technologies powering Zauri.</p>
        </div>
        <div class="about-tech-list">
          <div class="about-tech-item">
            <strong>Tauri</strong>
            <span>Desktop framework (Rust core, web UI)</span>
          </div>
          <div class="about-tech-item">
            <strong>Zig</strong>
            <span>Backend library for file I/O and search</span>
          </div>
          <div class="about-tech-item">
            <strong>Rust</strong>
            <span>Tauri commands, FFI bridge, PTY terminal, git ops</span>
          </div>
          <div class="about-tech-item">
            <strong>TypeScript</strong>
            <span>Frontend application logic</span>
          </div>
          <div class="about-tech-item">
            <strong>CodeMirror 6</strong>
            <span>Code editor with 40+ language grammars</span>
          </div>
          <div class="about-tech-item">
            <strong>xterm.js</strong>
            <span>Terminal emulator (same as VS Code)</span>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <h2>Inspirations</h2>
          <p>Standing on the shoulders of giants.</p>
        </div>
        <div class="about-inspirations">
          <div class="about-insp-item">
            <strong>VS Code</strong>
            <span>The gold standard for code editors</span>
          </div>
          <div class="about-insp-item">
            <strong>t3code</strong>
            <span>AI-first editor with Claude/Codex integration</span>
          </div>
          <div class="about-insp-item">
            <strong>Flora</strong>
            <span>Clean, minimal editor design language</span>
          </div>
        </div>
      </div>

      <div class="settings-card about-update-card">
        <div class="settings-card-header about-update-header">
          <div>
            <h2>Updates</h2>
            <p id="about-update-status">Checking for updates...</p>
          </div>
          <span id="about-update-badge" class="about-update-badge about-update-badge-checking">Checking</span>
        </div>

        <div id="about-update-highlight" class="about-update-highlight hidden">
          <strong id="about-update-highlight-title"></strong>
          <p id="about-update-highlight-body"></p>
        </div>

        <div id="about-update-progress" class="about-update-progress hidden">
          <div class="about-update-progress-bar">
            <div id="about-update-progress-fill" class="about-update-progress-fill"></div>
          </div>
          <div class="about-update-progress-meta">
            <span id="about-update-progress-label"></span>
            <span id="about-update-progress-bytes"></span>
          </div>
        </div>

        <div id="about-update-notes" class="about-update-notes hidden"></div>

        <div class="git-btn-row about-update-actions">
          <button class="git-action-button primary" id="about-install-update">Update & Restart</button>
          <button class="git-action-button" id="about-check-update">Check for Updates</button>
        </div>
      </div>

      <div class="settings-footer">
        <a href="#" id="about-repo-link" class="about-repo-btn">View on GitHub</a>
        <button class="settings-back-btn" id="about-back">&larr; Back</button>
      </div>
    </div>
  `;

  page.querySelector<HTMLButtonElement>("#about-back")?.addEventListener("click", () => {
    page.style.display = "none";
    isOpen = false;
  });

  page.querySelector<HTMLAnchorElement>("#about-repo-link")?.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await openUrl("https://github.com/pentium-solver/zauri");
    } catch {
      window.open("https://github.com/pentium-solver/zauri", "_blank");
    }
  });

  page.querySelector<HTMLButtonElement>("#about-check-update")?.addEventListener("click", () => {
    void checkForUpdates(false, "about");
  });

  page.querySelector<HTMLButtonElement>("#about-install-update")?.addEventListener("click", () => {
    void installAvailableUpdate();
  });

  cleanupUpdateSubscription?.();
  cleanupUpdateSubscription = subscribeToUpdateState((updateState) => {
    renderUpdateState(page, updateState);
  });

  renderUpdateState(page, getUpdateState());

  return page;
}

export function showAbout() {
  const container = document.getElementById("editor-container");
  if (!container) {
    return;
  }

  if (!aboutPage) {
    aboutPage = buildAboutPage();
  }

  if (!aboutPage.isConnected) {
    container.appendChild(aboutPage);
  }

  aboutPage.style.display = "flex";
  isOpen = true;

  void refreshVersion(aboutPage);
  renderUpdateState(aboutPage, getUpdateState());

  const updateState = getUpdateState();
  if (updateState.phase === "idle") {
    void checkForUpdates(true, "about");
  }
}

export function hideAbout() {
  if (aboutPage) {
    aboutPage.style.display = "none";
    isOpen = false;
  }
}
