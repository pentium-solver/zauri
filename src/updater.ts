// Auto-updater: checks for updates on startup, shows notification

import { check } from "@tauri-apps/plugin-updater";

export async function checkForUpdates(silent = true) {
  try {
    const update = await check();
    if (!update) return; // No update available

    // Show update notification
    const banner = document.createElement("div");
    banner.id = "update-banner";
    banner.className = "update-banner fade-in";
    banner.innerHTML = `
      <span>Zauri ${update.version} is available</span>
      <div class="update-actions">
        <button id="update-install" class="update-btn primary">Update & Restart</button>
        <button id="update-dismiss" class="update-btn">Later</button>
      </div>
    `;

    banner.querySelector("#update-install")!.addEventListener("click", async () => {
      banner.innerHTML = `<span>Downloading update...</span>`;
      try {
        await update.downloadAndInstall();
        // Restart the app
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch (e) {
        banner.innerHTML = `<span>Update failed: ${e}</span>`;
        setTimeout(() => banner.remove(), 5000);
      }
    });

    banner.querySelector("#update-dismiss")!.addEventListener("click", () => {
      banner.remove();
    });

    document.body.appendChild(banner);
  } catch (e) {
    if (!silent) {
      console.error("[updater]", e);
    }
  }
}
