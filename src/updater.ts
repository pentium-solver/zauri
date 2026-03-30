import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";

const UPDATE_BANNER_ID = "update-banner";
const POST_UPDATE_STORAGE_KEY = "zauri.post-update";

export type UpdateOrigin = "startup" | "about" | "command";

export interface UpdateState {
  phase: "idle" | "checking" | "available" | "latest" | "downloading" | "installing" | "restarting" | "updated" | "error";
  version?: string;
  currentVersion?: string;
  message?: string;
  detail?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  userInitiated?: boolean;
  origin?: UpdateOrigin;
}

let currentUpdate: Update | null = null;
let state: UpdateState = { phase: "idle" };
let dismissedVersion: string | null = null;

const listeners = new Set<(state: UpdateState) => void>();

function setState(nextState: UpdateState) {
  state = nextState;
  renderUpdateBanner();
  for (const listener of listeners) {
    listener(state);
  }
}

function isAboutVisible(): boolean {
  const page = document.getElementById("about-page");
  return page instanceof HTMLElement && page.style.display !== "none";
}

function ensureUpdateBanner(): HTMLDivElement {
  const existing = document.getElementById(UPDATE_BANNER_ID);
  if (existing instanceof HTMLDivElement) {
    return existing;
  }

  const banner = document.createElement("div");
  banner.id = UPDATE_BANNER_ID;
  banner.className = "update-banner fade-in";
  document.body.appendChild(banner);
  return banner;
}

function hideUpdateBanner() {
  document.getElementById(UPDATE_BANNER_ID)?.remove();
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
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

function progressPercent(downloadedBytes?: number, totalBytes?: number): number {
  if (!downloadedBytes || !totalBytes || totalBytes <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (downloadedBytes / totalBytes) * 100));
}

function progressText(updateState: UpdateState): string {
  if (updateState.phase === "downloading") {
    if (updateState.totalBytes) {
      return `${formatBytes(updateState.downloadedBytes)} / ${formatBytes(updateState.totalBytes)}`;
    }
    return `${formatBytes(updateState.downloadedBytes)} downloaded`;
  }
  if (updateState.phase === "installing") {
    return "Download complete";
  }
  return "";
}

function shouldShowBanner(updateState: UpdateState): boolean {
  if (updateState.origin === "about" && isAboutVisible()) {
    return false;
  }

  if (updateState.phase === "available") {
    return updateState.version !== dismissedVersion;
  }

  if (updateState.phase === "checking") {
    return !!updateState.userInitiated && updateState.origin !== "about";
  }

  if (updateState.phase === "latest") {
    return !!updateState.userInitiated && updateState.origin !== "about";
  }

  return ["downloading", "installing", "restarting", "error"].includes(updateState.phase);
}

function renderUpdateBanner() {
  if (!shouldShowBanner(state)) {
    hideUpdateBanner();
    return;
  }

  const banner = ensureUpdateBanner();

  const progressVisible = state.phase === "downloading" || state.phase === "installing" || state.phase === "restarting";
  const percent = progressVisible && state.totalBytes ? progressPercent(state.downloadedBytes, state.totalBytes) : state.phase === "installing" || state.phase === "restarting" ? 100 : 0;
  const summary =
    state.message ??
    (state.phase === "available" && state.version
      ? `Zauri v${state.version} is available`
      : state.phase === "latest"
        ? "You're on the latest version."
        : state.phase === "checking"
          ? "Checking for updates..."
          : "Update status unavailable");

  const detail =
    state.phase === "available"
      ? "Install now and restart into the new build."
      : state.phase === "error"
        ? state.detail ?? "The update could not be completed."
        : progressText(state);

  const dismissLabel = state.phase === "available" ? "Later" : "Close";

  banner.innerHTML = `
    <div class="update-banner-body">
      <div class="update-copy">
        <span class="update-title">${summary}</span>
        <span class="update-detail">${detail}</span>
      </div>
      <div class="update-actions">
        ${state.phase === "available" || state.phase === "error" ? `<button id="update-install" class="update-btn primary">${state.phase === "error" ? "Retry Update" : "Update & Restart"}</button>` : ""}
        ${state.phase === "checking" ? "" : `<button id="update-dismiss" class="update-btn">${dismissLabel}</button>`}
      </div>
    </div>
    ${
      progressVisible
        ? `<div class="update-progress ${state.totalBytes ? "" : "indeterminate"}"><div class="update-progress-fill" style="width:${percent}%"></div></div>`
        : ""
    }
  `;

  const installBtn = banner.querySelector<HTMLButtonElement>("#update-install");
  const dismissBtn = banner.querySelector<HTMLButtonElement>("#update-dismiss");

  installBtn?.addEventListener("click", () => {
    void installAvailableUpdate();
  });

  dismissBtn?.addEventListener("click", () => {
    dismissUpdateBanner();
  });

  if (state.phase === "latest" || (state.phase === "error" && !currentUpdate)) {
    window.setTimeout(() => {
      if (state.phase === "latest" || (state.phase === "error" && !currentUpdate)) {
        hideUpdateBanner();
      }
    }, 4000);
  }
}

function dismissUpdateBanner() {
  if (state.phase === "available" && state.version) {
    dismissedVersion = state.version;
    hideUpdateBanner();
    return;
  }

  if (state.phase === "latest" || state.phase === "error") {
    setState({ phase: "idle" });
    return;
  }

  hideUpdateBanner();
}

function storePendingPostUpdate(version: string) {
  localStorage.setItem(
    POST_UPDATE_STORAGE_KEY,
    JSON.stringify({
      version,
      at: Date.now(),
    }),
  );
}

async function resolveCurrentVersion(): Promise<string | undefined> {
  try {
    return await getVersion();
  } catch {
    return undefined;
  }
}

export function getUpdateState(): UpdateState {
  return state;
}

export function subscribeToUpdateState(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export async function checkForUpdates(silent = true, origin: UpdateOrigin = silent ? "startup" : "command"): Promise<Update | null> {
  if (state.phase === "checking" || state.phase === "downloading" || state.phase === "installing" || state.phase === "restarting") {
    return currentUpdate;
  }

  if (!silent) {
    dismissedVersion = null;
  }

  setState({
    phase: "checking",
    userInitiated: !silent,
    origin,
    message: "Checking for updates...",
  });

  try {
    const update = await check();
    if (!update) {
      currentUpdate = null;
      const currentVersion = await resolveCurrentVersion();
      setState({
        phase: "latest",
        currentVersion,
        userInitiated: !silent,
        origin,
        message: "You're on the latest version.",
      });
      return null;
    }

    currentUpdate = update;
    setState({
      phase: "available",
      version: update.version,
      currentVersion: update.currentVersion,
      detail: update.body?.trim(),
      userInitiated: !silent,
      origin,
      message: `Zauri v${update.version} is available`,
    });
    console.log(`[updater] Update available: v${update.version}`);
    return update;
  } catch (error) {
    currentUpdate = null;
    const detail = formatError(error);
    if (silent) {
      console.error("[updater]", detail);
      setState({ phase: "idle" });
      return null;
    }

    setState({
      phase: "error",
      userInitiated: true,
      origin,
      message: "Could not check for updates.",
      detail,
    });
    return null;
  }
}

export async function installAvailableUpdate(): Promise<void> {
  const update = currentUpdate ?? (await checkForUpdates(false, "command"));
  if (!update) {
    return;
  }

  let downloadedBytes = 0;
  let totalBytes: number | undefined;

  const version = update.version;

  try {
    setState({
      phase: "downloading",
      version,
      currentVersion: update.currentVersion,
      downloadedBytes: 0,
      totalBytes,
      message: `Preparing Zauri v${version}...`,
    });

    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        totalBytes = event.data.contentLength;
        setState({
          phase: "downloading",
          version,
          currentVersion: update.currentVersion,
          downloadedBytes,
          totalBytes,
          message: `Downloading Zauri v${version}...`,
        });
        return;
      }

      if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        setState({
          phase: "downloading",
          version,
          currentVersion: update.currentVersion,
          downloadedBytes,
          totalBytes,
          message: `Downloading Zauri v${version}...`,
        });
        return;
      }

      setState({
        phase: "installing",
        version,
        currentVersion: update.currentVersion,
        downloadedBytes,
        totalBytes,
        message: `Installing Zauri v${version}...`,
      });
    });

    setState({
      phase: "installing",
      version,
      currentVersion: update.currentVersion,
      downloadedBytes,
      totalBytes,
      message: `Installing Zauri v${version}...`,
    });

    storePendingPostUpdate(version);
    setState({
      phase: "restarting",
      version,
      currentVersion: update.currentVersion,
      downloadedBytes,
      totalBytes,
      message: `Restarting into Zauri v${version}...`,
    });

    await new Promise((resolve) => window.setTimeout(resolve, 700));
    await relaunch();
  } catch (error) {
    setState({
      phase: "error",
      version,
      currentVersion: update.currentVersion,
      userInitiated: true,
      origin: state.origin ?? "command",
      message: "Update failed.",
      detail: formatError(error),
    });
  }
}

export async function handlePostUpdateLaunch(): Promise<boolean> {
  const raw = localStorage.getItem(POST_UPDATE_STORAGE_KEY);
  if (!raw) {
    return false;
  }

  localStorage.removeItem(POST_UPDATE_STORAGE_KEY);

  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version !== "string" || !parsed.version) {
      return false;
    }

    const currentVersion = await resolveCurrentVersion();
    if (!currentVersion || currentVersion !== parsed.version) {
      return false;
    }

    currentUpdate = null;
    dismissedVersion = null;
    setState({
      phase: "updated",
      version: currentVersion,
      currentVersion,
      origin: "startup",
      message: `Updated to Zauri v${currentVersion}`,
      detail: "The new build is ready.",
    });
    return true;
  } catch {
    return false;
  }
}
