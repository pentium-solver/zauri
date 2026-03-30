export interface FuzzyMatch {
  score: number;
  indices: number[];
}

function isBoundary(char: string | undefined): boolean {
  return !char || /[\/\\_\-\s.]/.test(char);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedTarget = target.toLowerCase();
  if (!normalizedQuery) {
    return { score: 0, indices: [] };
  }

  const indices: number[] = [];
  let score = 0;
  let searchFrom = 0;
  let previousIndex = -1;

  for (const char of normalizedQuery) {
    const index = normalizedTarget.indexOf(char, searchFrom);
    if (index === -1) {
      return null;
    }

    indices.push(index);
    score += 10;

    if (isBoundary(target[index - 1])) {
      score += 16;
    }

    if (previousIndex >= 0) {
      if (index === previousIndex + 1) {
        score += 20;
      } else {
        score -= Math.min(8, index - previousIndex - 1);
      }
    } else if (index === 0) {
      score += 12;
    }

    if (target[index] === query[indices.length - 1]) {
      score += 1;
    }

    previousIndex = index;
    searchFrom = index + 1;
  }

  score -= Math.max(0, target.length - normalizedQuery.length) * 0.05;
  return { score, indices };
}

export function highlightFuzzyMatch(text: string, indices: number[]): string {
  if (!indices.length) {
    return escapeHtml(text);
  }

  const hits = new Set(indices);
  let html = "";
  for (let i = 0; i < text.length; i += 1) {
    const escaped = escapeHtml(text[i]);
    html += hits.has(i) ? `<mark>${escaped}</mark>` : escaped;
  }
  return html;
}
