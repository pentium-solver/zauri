const isMacPlatform = /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");

const macSymbolMap: Record<string, string> = {
  Cmd: "\u2318",
  Ctrl: "\u2303",
  Shift: "\u21E7",
  Alt: "\u2325",
};

const macTextMap: Record<string, string> = {
  Cmd: "Cmd",
  Ctrl: "Ctrl",
  Shift: "Shift",
  Alt: "Option",
};

const otherTextMap: Record<string, string> = {
  Cmd: "Ctrl",
  Ctrl: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
};

export function isMac(): boolean {
  return isMacPlatform;
}

export function formatShortcut(shortcut: string, useSymbols: boolean = false): string {
  const joiner = useSymbols && isMacPlatform ? " " : "+";
  const parts = shortcut.split("+").map((part) => part.trim());

  return parts
    .map((part) => {
      if (!isMacPlatform) {
        return otherTextMap[part] || part;
      }
      if (useSymbols) {
        return macSymbolMap[part] || part;
      }
      return macTextMap[part] || part;
    })
    .join(joiner);
}
