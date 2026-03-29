import { invoke } from "@tauri-apps/api/core";

interface GitStatus {
  branch: string;
  modified: number;
  added: number;
  deleted: number;
  ahead: number;
  behind: number;
  is_repo: boolean;
}

interface GitBranch {
  name: string;
  is_current: boolean;
  is_remote: boolean;
}

let cachedStatus: GitStatus | null = null;
let getRootPath: () => string | null = () => null;

export function getGitStatus(): GitStatus | null {
  return cachedStatus;
}

export function initGitStatus(rootPathGetter: () => string | null) {
  getRootPath = rootPathGetter;
  refreshStatus();
  setInterval(refreshStatus, 10000);
}

export async function refreshStatus() {
  const root = getRootPath();
  if (!root) return;

  try {
    cachedStatus = await invoke("git_status", { workingDir: root });
    updateStatusBar();
  } catch {
    cachedStatus = null;
  }
}

function updateStatusBar() {
  const branchEl = document.getElementById("status-git-branch");
  const changesEl = document.getElementById("status-git-changes");
  const syncEl = document.getElementById("status-git-sync");

  // Update sidebar git bar visibility
  const sidebarGitBar = document.getElementById("sidebar-git-bar");
  const sidebarBranchName = document.getElementById("sidebar-branch-name");

  if (!cachedStatus || !cachedStatus.is_repo) {
    if (branchEl) branchEl.textContent = "";
    if (changesEl) changesEl.textContent = "";
    if (syncEl) syncEl.textContent = "";
    if (sidebarGitBar) sidebarGitBar.classList.add("hidden");
    return;
  }

  // Show sidebar git bar
  if (sidebarGitBar) sidebarGitBar.classList.remove("hidden");
  if (sidebarBranchName) sidebarBranchName.textContent = cachedStatus.branch;

  if (branchEl) {
    branchEl.innerHTML = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" style="vertical-align:-1px;margin-right:3px"><path d="M5 3v6.5a2.5 2.5 0 005 0V8M5 3L3 5M5 3l2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>${escapeHtml(cachedStatus.branch)}`;
  }

  if (changesEl) {
    const total = cachedStatus.modified + cachedStatus.added + cachedStatus.deleted;
    changesEl.textContent = total > 0 ? `${total} changed` : "";
    changesEl.className = total > 0 ? "status-git-item has-changes" : "status-git-item";
  }

  if (syncEl) {
    const parts: string[] = [];
    if (cachedStatus.ahead > 0) parts.push(`${cachedStatus.ahead}\u2191`);
    if (cachedStatus.behind > 0) parts.push(`${cachedStatus.behind}\u2193`);
    syncEl.textContent = parts.join(" ");
  }
}

// ---- Branch Selector ----

let branchDropdown: HTMLElement | null = null;

export async function showBranchSelector() {
  if (branchDropdown) {
    branchDropdown.remove();
    branchDropdown = null;
    return;
  }

  const root = getRootPath();
  if (!root) return;

  let branches: GitBranch[];
  try {
    branches = await invoke("git_branches", { workingDir: root });
  } catch {
    return;
  }

  branchDropdown = document.createElement("div");
  branchDropdown.className = "branch-dropdown";
  branchDropdown.innerHTML = `
    <input type="text" class="branch-search" placeholder="Search or create branch..." autofocus />
    <div class="branch-list"></div>
  `;

  const listEl = branchDropdown.querySelector(".branch-list")!;
  const searchInput = branchDropdown.querySelector(".branch-search") as HTMLInputElement;

  function renderList(filter: string) {
    listEl.innerHTML = "";
    const filtered = branches.filter((b) =>
      b.name.toLowerCase().includes(filter.toLowerCase()),
    );

    for (const branch of filtered) {
      const item = document.createElement("div");
      item.className = `branch-item${branch.is_current ? " current" : ""}`;
      item.innerHTML = `
        <span>${escapeHtml(branch.name)}</span>
        ${branch.is_remote ? '<span class="branch-remote">remote</span>' : ""}
        ${branch.is_current ? '<span class="branch-current-badge">current</span>' : ""}
      `;
      if (!branch.is_current) {
        item.addEventListener("click", async () => {
          try {
            await invoke("git_checkout", { workingDir: root, branch: branch.name });
            await refreshStatus();
          } catch (e) {
            console.error("Checkout failed:", e);
          }
          closeBranchSelector();
        });
      }
      listEl.appendChild(item);
    }

    // Show "Create branch" option if filter doesn't match any exactly
    if (filter && !branches.some((b) => b.name === filter)) {
      const createItem = document.createElement("div");
      createItem.className = "branch-item branch-create";
      createItem.innerHTML = `<span>Create <strong>${escapeHtml(filter)}</strong></span>`;
      createItem.addEventListener("click", async () => {
        try {
          await invoke("git_create_branch", { workingDir: root, branch: filter });
          await refreshStatus();
        } catch (e) {
          console.error("Branch creation failed:", e);
        }
        closeBranchSelector();
      });
      listEl.appendChild(createItem);
    }
  }

  searchInput.addEventListener("input", () => renderList(searchInput.value));
  renderList("");

  // Position near the status bar branch element
  const anchor = document.getElementById("status-git-branch");
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    branchDropdown.style.left = `${rect.left}px`;
    branchDropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  }

  document.body.appendChild(branchDropdown);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener("click", onOutsideClick);
  }, 0);
  searchInput.focus();
}

function onOutsideClick(e: MouseEvent) {
  if (branchDropdown && !branchDropdown.contains(e.target as Node)) {
    closeBranchSelector();
  }
}

function closeBranchSelector() {
  if (branchDropdown) {
    branchDropdown.remove();
    branchDropdown = null;
  }
  document.removeEventListener("click", onOutsideClick);
}

// ---- Git Actions Panel ----

let gitPanel: HTMLElement | null = null;

export function toggleGitPanel() {
  if (gitPanel) {
    gitPanel.remove();
    gitPanel = null;
    return;
  }

  const root = getRootPath();
  if (!root || !cachedStatus?.is_repo) return;

  const totalChanges = cachedStatus!.modified + cachedStatus!.added + cachedStatus!.deleted;

  gitPanel = document.createElement("div");
  gitPanel.className = "modal-overlay";
  gitPanel.innerHTML = `
    <div class="modal-card" style="max-width:400px">
      <div class="modal-header">
        <span>Git</span>
        <button class="modal-close">&times;</button>
      </div>
      <div class="git-panel-body">
        <div class="git-branch-row">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M5 3v6.5a2.5 2.5 0 005 0V8M5 3L3 5M5 3l2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <strong>${escapeHtml(cachedStatus!.branch)}</strong>
          ${totalChanges > 0 ? `<span class="git-changes-badge">${totalChanges} change${totalChanges > 1 ? "s" : ""}</span>` : '<span class="git-clean-badge">Clean</span>'}
        </div>

        <div class="git-section">
          <textarea id="git-commit-msg" class="git-commit-input" placeholder="Commit message..." rows="2"></textarea>
          <div class="git-btn-row">
            <button class="git-action-button primary" id="git-btn-commit">Commit</button>
            <button class="git-action-button" id="git-btn-commit-push">Commit & Push</button>
          </div>
        </div>

        <div class="git-divider"></div>

        <div class="git-btn-row">
          <button class="git-action-button" id="git-btn-pull">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M5 10l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Pull
          </button>
          <button class="git-action-button" id="git-btn-push">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M5 6l3-3 3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Push
          </button>
        </div>

        <div id="git-action-status" class="git-action-status"></div>
      </div>
    </div>
  `;

  const close = () => {
    gitPanel?.remove();
    gitPanel = null;
  };

  gitPanel.querySelector(".modal-close")!.addEventListener("click", close);
  gitPanel.addEventListener("click", (e) => {
    if (e.target === gitPanel) close();
  });

  const statusMsg = gitPanel.querySelector("#git-action-status") as HTMLElement;
  const showStatus = (msg: string, isError = false) => {
    statusMsg.textContent = msg;
    statusMsg.className = `git-action-status ${isError ? "error" : "success"}`;
  };

  gitPanel.querySelector("#git-btn-commit")!.addEventListener("click", async () => {
    const msg = (gitPanel!.querySelector("#git-commit-msg") as HTMLTextAreaElement).value.trim();
    if (!msg) return showStatus("Enter a commit message", true);
    try {
      const result: string = await invoke("git_commit", { workingDir: root, message: msg });
      showStatus(result);
      await refreshStatus();
    } catch (e) {
      showStatus(String(e), true);
    }
  });

  gitPanel.querySelector("#git-btn-commit-push")!.addEventListener("click", async () => {
    const msg = (gitPanel!.querySelector("#git-commit-msg") as HTMLTextAreaElement).value.trim();
    if (!msg) return showStatus("Enter a commit message", true);
    try {
      await invoke("git_commit", { workingDir: root, message: msg });
      showStatus("Committed. Pushing...");
      const result: string = await invoke("git_push", { workingDir: root });
      showStatus(result || "Pushed successfully");
      await refreshStatus();
    } catch (e) {
      showStatus(String(e), true);
    }
  });

  gitPanel.querySelector("#git-btn-pull")!.addEventListener("click", async () => {
    try {
      const result: string = await invoke("git_pull", { workingDir: root });
      showStatus(result || "Pulled successfully");
      await refreshStatus();
    } catch (e) {
      showStatus(String(e), true);
    }
  });

  gitPanel.querySelector("#git-btn-push")!.addEventListener("click", async () => {
    try {
      const result: string = await invoke("git_push", { workingDir: root });
      showStatus(result || "Pushed successfully");
      await refreshStatus();
    } catch (e) {
      showStatus(String(e), true);
    }
  });

  document.body.appendChild(gitPanel);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
