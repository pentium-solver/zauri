import { invoke } from "@tauri-apps/api/core";
import { fuzzyMatch, highlightFuzzyMatch, escapeHtml } from "./fuzzy";

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

interface GitFileStatusEntry {
  path: string;
  staged_status: string;
  unstaged_status: string;
}

let cachedStatus: GitStatus | null = null;
let getRootPath: () => string | null = () => null;

export function getGitStatus(): GitStatus | null {
  return cachedStatus;
}

export function initGitStatus(rootPathGetter: () => string | null) {
  getRootPath = rootPathGetter;
  void refreshStatus();
  setInterval(() => {
    void refreshStatus();
  }, 10000);
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
  const sidebarGitBar = document.getElementById("sidebar-git-bar");
  const sidebarBranchName = document.getElementById("sidebar-branch-name");

  if (!cachedStatus || !cachedStatus.is_repo) {
    if (branchEl) branchEl.textContent = "";
    if (changesEl) changesEl.textContent = "";
    if (syncEl) syncEl.textContent = "";
    if (sidebarGitBar) sidebarGitBar.classList.add("hidden");
    return;
  }

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

export async function showBranchSelector(anchorEl?: HTMLElement) {
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

  const listEl = branchDropdown.querySelector(".branch-list") as HTMLElement;
  const searchInput = branchDropdown.querySelector(".branch-search") as HTMLInputElement;

  function renderList(filter: string) {
    const query = filter.trim();
    const filtered = query
      ? branches.map((branch) => {
          const match = fuzzyMatch(query, branch.name);
          if (!match) return null;
          return { branch, match };
        }).filter((item): item is NonNullable<typeof item> => Boolean(item))
          .sort((a, b) => b.match.score - a.match.score || a.branch.name.localeCompare(b.branch.name))
      : branches.map((branch) => ({ branch, match: null }));

    listEl.innerHTML = "";

    filtered.forEach(({ branch, match }) => {
      const item = document.createElement("div");
      item.className = `branch-item${branch.is_current ? " current" : ""}`;
      item.innerHTML = `
        <span>${match ? highlightFuzzyMatch(branch.name, match.indices) : escapeHtml(branch.name)}</span>
        ${branch.is_remote ? '<span class="branch-remote">remote</span>' : ""}
        ${branch.is_current ? '<span class="branch-current-badge">current</span>' : ""}
      `;
      if (!branch.is_current) {
        item.addEventListener("click", async () => {
          try {
            await invoke("git_checkout", { workingDir: root, branch: branch.name });
            await refreshStatus();
          } catch (error) {
            console.error("Checkout failed:", error);
          }
          closeBranchSelector();
        });
      }
      listEl.appendChild(item);
    });

    if (query && !branches.some((branch) => branch.name === query)) {
      const createItem = document.createElement("div");
      createItem.className = "branch-item branch-create";
      createItem.innerHTML = `<span>Create <strong>${escapeHtml(query)}</strong></span>`;
      createItem.addEventListener("click", async () => {
        try {
          await invoke("git_create_branch", { workingDir: root, branch: query });
          await refreshStatus();
        } catch (error) {
          console.error("Branch creation failed:", error);
        }
        closeBranchSelector();
      });
      listEl.appendChild(createItem);
    }
  }

  searchInput.addEventListener("input", () => renderList(searchInput.value));
  renderList("");

  const anchor = anchorEl || document.getElementById("status-git-branch");
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    if (rect.top < window.innerHeight / 2) {
      branchDropdown.style.left = `${rect.left}px`;
      branchDropdown.style.top = `${rect.bottom + 4}px`;
    } else {
      branchDropdown.style.left = `${rect.left}px`;
      branchDropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    }
  }

  document.body.appendChild(branchDropdown);
  setTimeout(() => {
    document.addEventListener("click", onOutsideClick);
  }, 0);
  searchInput.focus();
}

function onOutsideClick(event: MouseEvent) {
  if (branchDropdown && !branchDropdown.contains(event.target as Node)) {
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

function summarizeStatus(code: string): string {
  switch (code) {
    case "M": return "Modified";
    case "A": return "Added";
    case "D": return "Deleted";
    case "R": return "Renamed";
    case "C": return "Copied";
    case "?": return "Untracked";
    default: return code || "Clean";
  }
}

export function toggleGitPanel() {
  if (gitPanel) {
    gitPanel.remove();
    gitPanel = null;
    return;
  }

  const root = getRootPath();
  if (!root || !cachedStatus?.is_repo) return;

  const totalChanges = cachedStatus.modified + cachedStatus.added + cachedStatus.deleted;

  gitPanel = document.createElement("div");
  gitPanel.className = "modal-overlay";
  gitPanel.innerHTML = `
    <div class="modal-card" style="max-width:640px">
      <div class="modal-header">
        <span>Git</span>
        <button class="modal-close">&times;</button>
      </div>
      <div class="git-panel-body">
        <div class="git-branch-row">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M5 3v6.5a2.5 2.5 0 005 0V8M5 3L3 5M5 3l2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <strong>${escapeHtml(cachedStatus.branch)}</strong>
          ${totalChanges > 0 ? `<span class="git-changes-badge">${totalChanges} change${totalChanges > 1 ? "s" : ""}</span>` : '<span class="git-clean-badge">Clean</span>'}
        </div>

        <div class="git-stage-section">
          <div class="git-stage-header">
            <span>Staging</span>
            <div class="git-stage-actions">
              <button class="git-stage-link" id="git-stage-all" type="button">Stage all</button>
              <button class="git-stage-link" id="git-unstage-all" type="button">Unstage all</button>
            </div>
          </div>
          <div id="git-stage-list" class="git-stage-list"></div>
        </div>

        <div class="git-divider"></div>

        <div class="git-section">
          <textarea id="git-commit-msg" class="git-commit-input" placeholder="Commit message..." rows="2"></textarea>
          <div class="git-btn-row">
            <button class="git-action-button primary" id="git-btn-commit">Commit Staged</button>
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

        <div class="git-divider"></div>

        <div class="git-section">
          <input type="text" id="git-pr-title" class="git-pr-input" placeholder="PR title..." />
          <button class="git-action-button" id="git-btn-pr" style="width:100%">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="5" cy="4" r="2" stroke="currentColor" stroke-width="1.2"/><circle cx="11" cy="12" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M5 6v4a2 2 0 002 2h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            Create Pull Request
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
  gitPanel.addEventListener("click", (event) => {
    if (event.target === gitPanel) close();
  });

  const statusMsg = gitPanel.querySelector("#git-action-status") as HTMLElement;
  const stageList = gitPanel.querySelector("#git-stage-list") as HTMLElement;

  const showStatus = (message: string, isError = false) => {
    statusMsg.textContent = message;
    statusMsg.className = `git-action-status ${isError ? "error" : "success"}`;
  };

  async function renderFileStatuses() {
    try {
      const files: GitFileStatusEntry[] = await invoke("git_file_statuses", { workingDir: root });
      const staged = files.filter((file) => !!file.staged_status);
      const unstaged = files.filter((file) => !!file.unstaged_status);

      if (!files.length) {
        stageList.innerHTML = `<div class="git-stage-empty">Working tree clean</div>`;
        return;
      }

      const renderSection = (
        title: string,
        items: GitFileStatusEntry[],
        mode: "stage" | "unstage",
      ) => {
        if (!items.length) return "";
        return `
          <div class="git-stage-group">
            <div class="git-stage-group-title">${title}</div>
            ${items.map((file) => `
              <div class="git-file-row" data-path="${escapeHtml(file.path)}" data-mode="${mode}">
                <div class="git-file-meta">
                  <span class="git-file-path">${escapeHtml(file.path)}</span>
                  <span class="git-file-badges">
                    ${file.staged_status ? `<span class="git-file-badge staged">${escapeHtml(summarizeStatus(file.staged_status))}</span>` : ""}
                    ${file.unstaged_status ? `<span class="git-file-badge unstaged">${escapeHtml(summarizeStatus(file.unstaged_status))}</span>` : ""}
                  </span>
                </div>
                <button class="git-file-action" type="button">${mode === "stage" ? "Stage" : "Unstage"}</button>
              </div>
            `).join("")}
          </div>
        `;
      };

      stageList.innerHTML = `
        ${renderSection("Staged", staged, "unstage")}
        ${renderSection("Unstaged", unstaged, "stage")}
      `;

      stageList.querySelectorAll(".git-file-row").forEach((row) => {
        row.addEventListener("click", async () => {
          const path = (row as HTMLElement).dataset.path || "";
          const mode = (row as HTMLElement).dataset.mode;
          try {
            if (mode === "stage") {
              await invoke("git_stage_file", { workingDir: root, path });
            } else {
              await invoke("git_unstage_file", { workingDir: root, path });
            }
            await refreshStatus();
            await renderFileStatuses();
          } catch (error) {
            showStatus(String(error), true);
          }
        });
      });
    } catch (error) {
      stageList.innerHTML = `<div class="git-stage-empty">Failed to load file status</div>`;
      showStatus(String(error), true);
    }
  }

  gitPanel.querySelector("#git-stage-all")!.addEventListener("click", async () => {
    try {
      await invoke("git_stage_all", { workingDir: root });
      await refreshStatus();
      await renderFileStatuses();
    } catch (error) {
      showStatus(String(error), true);
    }
  });

  gitPanel.querySelector("#git-unstage-all")!.addEventListener("click", async () => {
    try {
      await invoke("git_unstage_all", { workingDir: root });
      await refreshStatus();
      await renderFileStatuses();
    } catch (error) {
      showStatus(String(error), true);
    }
  });

  gitPanel.querySelector("#git-btn-commit")!.addEventListener("click", async () => {
    const message = (gitPanel!.querySelector("#git-commit-msg") as HTMLTextAreaElement).value.trim();
    if (!message) return showStatus("Enter a commit message", true);
    try {
      const result: string = await invoke("git_commit", { workingDir: root, message });
      showStatus(result);
      await refreshStatus();
      await renderFileStatuses();
    } catch (error) {
      showStatus(String(error), true);
    }
  });

  gitPanel.querySelector("#git-btn-commit-push")!.addEventListener("click", async () => {
    const message = (gitPanel!.querySelector("#git-commit-msg") as HTMLTextAreaElement).value.trim();
    if (!message) return showStatus("Enter a commit message", true);
    try {
      await invoke("git_commit", { workingDir: root, message });
      showStatus("Committed. Pushing...");
      const result: string = await invoke("git_push", { workingDir: root });
      showStatus(result || "Pushed successfully");
      await refreshStatus();
      await renderFileStatuses();
    } catch (error) {
      showStatus(String(error), true);
    }
  });

  gitPanel.querySelector("#git-btn-pull")!.addEventListener("click", async () => {
    try {
      const result: string = await invoke("git_pull", { workingDir: root });
      showStatus(result || "Pulled successfully");
      await refreshStatus();
      await renderFileStatuses();
    } catch (error) {
      showStatus(String(error), true);
    }
  });

  gitPanel.querySelector("#git-btn-push")!.addEventListener("click", async () => {
    try {
      const result: string = await invoke("git_push", { workingDir: root });
      showStatus(result || "Pushed successfully");
      await refreshStatus();
      await renderFileStatuses();
    } catch (error) {
      showStatus(String(error), true);
    }
  });

  gitPanel.querySelector("#git-btn-pr")!.addEventListener("click", async () => {
    const title = (gitPanel!.querySelector("#git-pr-title") as HTMLInputElement).value.trim();
    if (!title) return showStatus("Enter a PR title", true);
    try {
      showStatus("Pushing...");
      await invoke("git_push", { workingDir: root });
      showStatus("Creating PR...");
      const result: string = await invoke("git_create_pr", { workingDir: root, title });
      showStatus(result);
      await refreshStatus();
    } catch (error) {
      showStatus(String(error), true);
    }
  });

  document.body.appendChild(gitPanel);
  void renderFileStatuses();
}
