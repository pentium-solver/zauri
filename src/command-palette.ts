// Command Palette: Cmd+Shift+P fuzzy search for actions
import { fuzzyMatch, highlightFuzzyMatch, escapeHtml } from "./fuzzy";

interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  category?: string;
  action: () => void;
}

let paletteEl: HTMLElement | null = null;
let commands: PaletteCommand[] = [];

export function registerCommands(cmds: PaletteCommand[]) {
  commands = cmds;
}

export function showCommandPalette() {
  if (paletteEl) {
    paletteEl.remove();
    paletteEl = null;
    return;
  }

  paletteEl = document.createElement("div");
  paletteEl.className = "command-palette-overlay";
  paletteEl.innerHTML = `
    <div class="command-palette">
      <input type="text" class="command-palette-input" placeholder="Type a command..." autofocus />
      <div class="command-palette-list"></div>
    </div>
  `;

  const input = paletteEl.querySelector(".command-palette-input") as HTMLInputElement;
  const list = paletteEl.querySelector(".command-palette-list")!;
  let selectedIdx = 0;

  function render(filter: string) {
    const filtered = filter
      ? commands.map((command) => {
          const labelMatch = fuzzyMatch(filter, command.label);
          const categoryMatch = command.category ? fuzzyMatch(filter, command.category) : null;
          const bestMatch = labelMatch || categoryMatch;
          if (!bestMatch) {
            return null;
          }
          const score = Math.max(labelMatch?.score || Number.NEGATIVE_INFINITY, categoryMatch?.score || Number.NEGATIVE_INFINITY);
          return { command, labelMatch, categoryMatch, score };
        }).filter((item): item is NonNullable<typeof item> => Boolean(item))
          .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label))
      : commands.map((command) => ({ command, labelMatch: null, categoryMatch: null, score: 0 }));

    selectedIdx = 0;
    list.innerHTML = "";

    if (!filtered.length) {
      list.innerHTML = `<div class="command-palette-empty">No commands found</div>`;
      return;
    }

    filtered.forEach((item, i) => {
      const cmd = item.command;
      const row = document.createElement("div");
      row.className = `command-palette-item${i === selectedIdx ? " selected" : ""}`;
      row.innerHTML = `
        <span class="cmd-label">${item.labelMatch ? highlightFuzzyMatch(cmd.label, item.labelMatch.indices) : escapeHtml(cmd.label)}</span>
        ${cmd.category ? `<span class="cmd-category">${item.categoryMatch ? highlightFuzzyMatch(cmd.category, item.categoryMatch.indices) : escapeHtml(cmd.category)}</span>` : ""}
        ${cmd.shortcut ? `<span class="cmd-shortcut">${cmd.shortcut}</span>` : ""}
      `;
      row.addEventListener("click", () => {
        close();
        cmd.action();
      });
      row.addEventListener("mouseenter", () => {
        list.querySelectorAll(".command-palette-item").forEach((el, idx) => {
          el.classList.toggle("selected", idx === i);
        });
        selectedIdx = i;
      });
      list.appendChild(row);
    });
  }

  function close() {
    paletteEl?.remove();
    paletteEl = null;
  }

  input.addEventListener("input", () => render(input.value));

  input.addEventListener("keydown", (e) => {
    const items = list.querySelectorAll(".command-palette-item");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle("selected", i === selectedIdx));
      items[selectedIdx]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle("selected", i === selectedIdx));
      items[selectedIdx]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = items[selectedIdx] as HTMLElement;
      if (selected) selected.click();
    } else if (e.key === "Escape") {
      close();
    }
  });

  paletteEl.addEventListener("click", (e) => {
    if (e.target === paletteEl) close();
  });

  render("");
  document.body.appendChild(paletteEl);
  input.focus();
}
