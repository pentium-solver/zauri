// Auto-updater: checks for updates on startup, shows notification

import { check } from "@tauri-apps/plugin-updater";

export async function checkForUpdates(silent = true) {
  try {
    // Don't show duplicate banners
    if (document.getElementById("update-banner")) return;

    const update = await check();
    if (!update) {
      console.log("[updater] Already on latest version");
      return;
    }

    console.log(`[updater] Update available: v${update.version}`);

    const banner = document.createElement("div");
    banner.id = "update-banner";
    banner.className = "update-banner fade-in";
    banner.innerHTML = `
      <span>Zauri v${update.version} is available</span>
      <div class="update-actions">
        <button id="update-install" class="update-btn primary">Update & Restart</button>
        <button id="update-dismiss" class="update-btn">Later</button>
      </div>
    `;

    banner.querySelector("#update-install")!.addEventListener("click", async () => {
      banner.innerHTML = `<span>Downloading update...</span>`;
      try {
        await update.downloadAndInstall();
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
