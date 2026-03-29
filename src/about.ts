let isOpen = false;

export function isAboutOpen(): boolean {
  return isOpen;
}

export function showAbout() {
  if (isOpen) return;
  isOpen = true;

  const container = document.getElementById("editor-container")!;
  const existing = document.getElementById("about-page");
  if (existing) {
    existing.style.display = "flex";
    return;
  }

  const page = document.createElement("div");
  page.id = "about-page";
  page.className = "settings-page";
  page.innerHTML = `
    <div class="settings-scroll">
      <div class="about-hero">
        <h1 class="about-logo">Zauri</h1>
        <span class="about-ver" id="about-version">v0.5.0</span>
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
              <p>Branch management, commit/push/pull, status tracking — all from the editor.</p>
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

      <div class="settings-card">
        <div class="settings-card-header">
          <h2>Updates</h2>
          <p id="about-update-status">Checking for updates...</p>
        </div>
        <button class="git-action-button" id="about-check-update" style="width:100%">Check for Updates</button>
      </div>

      <div class="settings-footer">
        <a href="#" id="about-repo-link" class="about-repo-btn">View on GitHub</a>
        <button class="settings-back-btn" id="about-back">&larr; Back</button>
      </div>
    </div>
  `;

  const close = () => {
    page.style.display = "none";
    isOpen = false;
  };

  page.querySelector("#about-back")!.addEventListener("click", close);

  page.querySelector("#about-repo-link")!.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://github.com/pentium-solver/zauri");
    } catch {
      window.open("https://github.com/pentium-solver/zauri", "_blank");
    }
  });

  // Update check in about page
  const updateStatus = page.querySelector("#about-update-status") as HTMLElement;
  page.querySelector("#about-check-update")!.addEventListener("click", async () => {
    updateStatus.textContent = "Checking...";
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        updateStatus.textContent = `Update available: v${update.version}`;
        updateStatus.style.color = "#a882ff";
      } else {
        updateStatus.textContent = "You're on the latest version.";
        updateStatus.style.color = "#34d399";
      }
    } catch {
      updateStatus.textContent = "Could not check for updates.";
    }
  });

  // Auto-check on open
  (async () => {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      const ver = await getVersion();
      const verEl = page.querySelector("#about-version");
      if (verEl) verEl.textContent = `v${ver}`;

      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        updateStatus.textContent = `Update available: v${update.version}`;
        updateStatus.style.color = "#a882ff";
      } else {
        updateStatus.textContent = "You're on the latest version.";
        updateStatus.style.color = "#34d399";
      }
    } catch {
      updateStatus.textContent = "Could not check for updates.";
    }
  })();

  container.appendChild(page);
}

export function hideAbout() {
  const page = document.getElementById("about-page");
  if (page) {
    page.style.display = "none";
    isOpen = false;
  }
}
