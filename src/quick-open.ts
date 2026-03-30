import { invoke } from "@tauri-apps/api/core";
import { fuzzyMatch, highlightFuzzyMatch, escapeHtml } from "./fuzzy";

let quickOpenEl: HTMLElement | null = null;
const fileCache = new Map<string, string[]>();

async function getProjectFiles(rootPath: string): Promise<string[]> {
  if (!fileCache.has(rootPath)) {
    const files: string[] = await invoke("list_project_files", { rootPath });
    fileCache.set(rootPath, files);
  }
  return fileCache.get(rootPath) || [];
}

export function invalidateQuickOpen(rootPath?: string) {
  if (rootPath) {
    fileCache.delete(rootPath);
    return;
  }
  fileCache.clear();
}

export function showQuickOpen(
  getRootPath: () => string | null,
  onOpenFile: (relativePath: string) => void,
) {
  if (quickOpenEl) {
    quickOpenEl.remove();
    quickOpenEl = null;
    return;
  }

  const rootPath = getRootPath();
  if (!rootPath) {
    return;
  }
  const projectRoot = rootPath;

  quickOpenEl = document.createElement("div");
  quickOpenEl.className = "command-palette-overlay";
  quickOpenEl.innerHTML = `
    <div class="command-palette quick-open">
      <input type="text" class="command-palette-input" placeholder="Quick open files..." autofocus />
      <div class="command-palette-list"></div>
    </div>
  `;

  const input = quickOpenEl.querySelector(".command-palette-input") as HTMLInputElement;
  const list = quickOpenEl.querySelector(".command-palette-list") as HTMLElement;
  let selectedIdx = 0;
  let visibleFiles: string[] = [];

  function close() {
    quickOpenEl?.remove();
    quickOpenEl = null;
  }

  async function render(query: string) {
    const files = await getProjectFiles(projectRoot);
    const ranked = query
      ? files.map((file) => {
          const name = file.split("/").pop() || file;
          const nameMatch = fuzzyMatch(query, name);
          const pathMatch = fuzzyMatch(query, file);
          const bestMatch = nameMatch || pathMatch;
          if (!bestMatch) {
            return null;
          }
          const score = Math.max(
            (nameMatch?.score || Number.NEGATIVE_INFINITY) + 40,
            pathMatch?.score || Number.NEGATIVE_INFINITY,
          );
          return { file, score, nameMatch, pathMatch };
        }).filter((item): item is NonNullable<typeof item> => Boolean(item))
          .sort((a, b) => b.score - a.score || a.file.length - b.file.length)
      : files.slice(0, 200).map((file) => ({ file, score: 0, nameMatch: null, pathMatch: null }));

    visibleFiles = ranked.slice(0, 200).map((item) => item.file);
    selectedIdx = 0;
    list.innerHTML = "";

    if (!visibleFiles.length) {
      list.innerHTML = `<div class="command-palette-empty">No files found</div>`;
      return;
    }

    ranked.slice(0, 200).forEach((item, index) => {
      const file = item.file;
      const name = file.split("/").pop() || file;
      const directory = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
      const row = document.createElement("div");
      row.className = `command-palette-item${index === selectedIdx ? " selected" : ""}`;
      row.innerHTML = `
        <div class="quick-open-main">
          <span class="cmd-label">${item.nameMatch ? highlightFuzzyMatch(name, item.nameMatch.indices) : escapeHtml(name)}</span>
          <span class="cmd-category quick-open-dir">${item.pathMatch ? highlightFuzzyMatch(directory, item.pathMatch.indices.filter((hit) => hit < directory.length)) : escapeHtml(directory)}</span>
        </div>
      `;
      row.addEventListener("click", () => {
        close();
        onOpenFile(file);
      });
      row.addEventListener("mouseenter", () => {
        list.querySelectorAll(".command-palette-item").forEach((el, idx) => {
          el.classList.toggle("selected", idx === index);
        });
        selectedIdx = index;
      });
      list.appendChild(row);
    });
  }

  input.addEventListener("input", () => {
    void render(input.value);
  });

  input.addEventListener("keydown", (event) => {
    const items = list.querySelectorAll(".command-palette-item");
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
      items.forEach((el, idx) => el.classList.toggle("selected", idx === selectedIdx));
      items[selectedIdx]?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      items.forEach((el, idx) => el.classList.toggle("selected", idx === selectedIdx));
      items[selectedIdx]?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = visibleFiles[selectedIdx];
      if (selected) {
        close();
        onOpenFile(selected);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  quickOpenEl.addEventListener("click", (event) => {
    if (event.target === quickOpenEl) {
      close();
    }
  });

  document.body.appendChild(quickOpenEl);
  input.focus();
  void render("");
}
