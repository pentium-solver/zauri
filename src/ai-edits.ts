// AI Code Editing System
// Parses Claude's filepath: code blocks, manages pending edits, snapshots for revert

// ---- Types ----

export interface ProposedEdit {
  filePath: string;
  newContent: string;
  originalContent: string;
  additions: number;
  deletions: number;
}

export interface DiffLine {
  type: "same" | "add" | "remove";
  lineNumber: number; // line number in the new content (for add/same) or original (for remove)
  text: string;
}

export interface Snapshot {
  id: string;
  timestamp: number;
  description: string;
  files: Map<string, string>; // filePath -> content before edit
}

// ---- State ----

export const pendingEdits: Map<string, ProposedEdit> = new Map();
export const historyStack: Snapshot[] = [];
const MAX_SNAPSHOTS = 20;

// ---- Response Parser ----

/**
 * Extracts filepath: fenced code blocks from Claude's response text.
 * Format: ```filepath:/absolute/path\n<content>\n```
 */
export function parseEditsFromResponse(
  responseText: string,
  rootPath: string,
  getFileContent: (path: string) => string | null,
): ProposedEdit[] {
  const edits: ProposedEdit[] = [];
  // Match ```filepath:/path/to/file followed by content and closing ```
  const regex = /```filepath:([\S]+)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(responseText)) !== null) {
    let filePath = match[1].trim();
    const newContent = match[2];

    // Resolve relative paths against rootPath
    if (!filePath.startsWith("/")) {
      filePath = `${rootPath}/${filePath}`;
    }

    // Get original content from open tabs or null
    const originalContent = getFileContent(filePath) || "";

    // Compute diff stats
    const { additions, deletions } = computeDiffStats(originalContent, newContent);

    // Last occurrence wins if same file appears multiple times
    const existing = edits.findIndex((e) => e.filePath === filePath);
    const edit: ProposedEdit = {
      filePath,
      newContent,
      originalContent,
      additions,
      deletions,
    };

    if (existing >= 0) {
      edits[existing] = edit;
    } else {
      edits.push(edit);
    }
  }

  return edits;
}

// ---- Line Diff ----

/**
 * Simple line-based diff using Longest Common Subsequence.
 * Returns lines annotated with add/remove/same.
 */
export function computeLineDiff(original: string, proposed: string): DiffLine[] {
  const oldLines = original.split("\n");
  const newLines = proposed.split("\n");
  const result: DiffLine[] = [];

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;

  // For very large files, fall back to simple comparison
  if (m * n > 1_000_000) {
    return simpleDiff(oldLines, newLines);
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const rawDiff: Array<{ type: "same" | "add" | "remove"; text: string }> = [];
  let i = m,
    j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      rawDiff.unshift({ type: "same", text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawDiff.unshift({ type: "add", text: newLines[j - 1] });
      j--;
    } else {
      rawDiff.unshift({ type: "remove", text: oldLines[i - 1] });
      i--;
    }
  }

  // Assign line numbers (in the new content for display)
  let newLineNum = 1;
  let oldLineNum = 1;
  for (const entry of rawDiff) {
    if (entry.type === "same") {
      result.push({ type: "same", lineNumber: newLineNum, text: entry.text });
      newLineNum++;
      oldLineNum++;
    } else if (entry.type === "add") {
      result.push({ type: "add", lineNumber: newLineNum, text: entry.text });
      newLineNum++;
    } else {
      result.push({ type: "remove", lineNumber: oldLineNum, text: entry.text });
      oldLineNum++;
    }
  }

  return result;
}

/** Fallback for very large files — just mark all as changed */
function simpleDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  for (let i = 0; i < oldLines.length; i++) {
    result.push({ type: "remove", lineNumber: i + 1, text: oldLines[i] });
  }
  for (let i = 0; i < newLines.length; i++) {
    result.push({ type: "add", lineNumber: i + 1, text: newLines[i] });
  }
  return result;
}

function computeDiffStats(original: string, proposed: string): { additions: number; deletions: number } {
  const oldLines = new Set(original.split("\n"));
  const newLines = proposed.split("\n");
  let additions = 0;
  let deletions = 0;

  const newSet = new Set(newLines);
  for (const line of newLines) {
    if (!oldLines.has(line)) additions++;
  }
  for (const line of oldLines) {
    if (!newSet.has(line)) deletions++;
  }
  return { additions, deletions };
}

// ---- Pending Edits Management ----

export function addPendingEdit(edit: ProposedEdit) {
  pendingEdits.set(edit.filePath, edit);
}

export function removePendingEdit(filePath: string) {
  pendingEdits.delete(filePath);
}

export function clearAllPendingEdits() {
  pendingEdits.clear();
}

export function hasPendingEdit(filePath: string): boolean {
  return pendingEdits.has(filePath);
}

export function getPendingEdit(filePath: string): ProposedEdit | undefined {
  return pendingEdits.get(filePath);
}

// ---- Snapshot / Revert ----

export function pushSnapshot(description: string, files: Map<string, string>) {
  historyStack.push({
    id: `snap-${Date.now()}`,
    timestamp: Date.now(),
    description,
    files,
  });
  // Trim old snapshots
  while (historyStack.length > MAX_SNAPSHOTS) {
    historyStack.shift();
  }
}

export function popSnapshot(): Snapshot | undefined {
  return historyStack.pop();
}

export function canRevert(): boolean {
  return historyStack.length > 0;
}

export async function revertLastSnapshot(
  restoreFile: (path: string, content: string) => Promise<void>,
): Promise<Snapshot | undefined> {
  const snapshot = popSnapshot();
  if (!snapshot) return undefined;

  for (const [path, content] of snapshot.files) {
    await restoreFile(path, content);
  }
  return snapshot;
}
