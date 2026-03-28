export function showAbout() {
  let overlay = document.getElementById("about-modal");
  if (overlay) {
    overlay.classList.remove("hidden");
    return;
  }

  overlay = document.createElement("div");
  overlay.id = "about-modal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:420px">
      <div class="modal-header">
        <span>About</span>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body about-body">
        <h1 class="about-title">Zauri</h1>
        <p class="about-version">v0.1.0</p>
        <p class="about-tagline">A lightweight, fast code editor with AI assistance</p>

        <div class="about-section">
          <h3>What Zauri aims to do</h3>
          <ul>
            <li>Sub-100ms startup with native performance</li>
            <li>Zig-powered backend for file I/O and search</li>
            <li>Built-in AI coding assistant (Claude + Codex)</li>
            <li>Inline diffs with accept/reject for AI edits</li>
            <li>Git integration with branch management</li>
            <li>Minimal footprint, maximal utility</li>
          </ul>
        </div>

        <div class="about-section">
          <h3>Tech Stack</h3>
          <div class="about-tech-grid">
            <span class="tech-badge">Tauri</span>
            <span class="tech-badge">Rust</span>
            <span class="tech-badge">Zig</span>
            <span class="tech-badge">TypeScript</span>
            <span class="tech-badge">CodeMirror 6</span>
            <span class="tech-badge">xterm.js</span>
            <span class="tech-badge">Vite</span>
          </div>
        </div>

        <div class="about-section">
          <h3>Inspirations</h3>
          <p>VS Code, t3code, Flora</p>
        </div>

        <div class="about-section">
          <a href="#" id="about-repo-link" class="about-link">github.com/pentium-solver/zauri</a>
        </div>
      </div>
    </div>
  `;

  const close = () => overlay!.classList.add("hidden");
  overlay.querySelector(".modal-close")!.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelector("#about-repo-link")!.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://github.com/pentium-solver/zauri");
    } catch {
      // Fallback
      window.open("https://github.com/pentium-solver/zauri", "_blank");
    }
  });

  document.body.appendChild(overlay);
}

export function hideAbout() {
  document.getElementById("about-modal")?.classList.add("hidden");
}
