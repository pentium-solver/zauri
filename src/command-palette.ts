// Command Palette: Cmd+Shift+P fuzzy search for actions

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
      ? commands.filter((c) =>
          c.label.toLowerCase().includes(filter.toLowerCase()) ||
          (c.category || "").toLowerCase().includes(filter.toLowerCase())
        )
      : commands;

    selectedIdx = 0;
    list.innerHTML = "";

    filtered.forEach((cmd, i) => {
      const item = document.createElement("div");
      item.className = `command-palette-item${i === selectedIdx ? " selected" : ""}`;
      item.innerHTML = `
        <span class="cmd-label">${highlightMatch(cmd.label, filter)}</span>
        ${cmd.category ? `<span class="cmd-category">${cmd.category}</span>` : ""}
        ${cmd.shortcut ? `<span class="cmd-shortcut">${cmd.shortcut}</span>` : ""}
      `;
      item.addEventListener("click", () => {
        close();
        cmd.action();
      });
      item.addEventListener("mouseenter", () => {
        list.querySelectorAll(".command-palette-item").forEach((el, idx) => {
          el.classList.toggle("selected", idx === i);
        });
        selectedIdx = i;
      });
      list.appendChild(item);
    });
  }

  function highlightMatch(text: string, query: string): string {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return `${text.slice(0, idx)}<mark>${text.slice(idx, idx + query.length)}</mark>${text.slice(idx + query.length)}`;
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
