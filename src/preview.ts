import { convertFileSrc } from "@tauri-apps/api/core";

// Browser preview: renders HTML files in an iframe.

let previewEl: HTMLElement | null = null;
let previewIframe: HTMLIFrameElement | null = null;
let currentPreviewPath: string | null = null;
let previewRootPath: string | null = null;
let lastRenderedContent = "";

export function isPreviewable(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return ["html", "htm", "svg"].includes(ext);
}

function resetPreviewRefs() {
  previewEl = null;
  previewIframe = null;
}

function ensurePreview() {
  if (previewEl && !previewEl.isConnected) {
    resetPreviewRefs();
  }

  if (previewEl && previewIframe) {
    return;
  }

  const container = document.getElementById("editor-container");
  if (!container) {
    return;
  }

  const panel = document.createElement("div");
  panel.id = "preview-panel";
  panel.innerHTML = `
    <div class="preview-header">
      <span class="preview-label">Preview</span>
      <div class="preview-actions">
        <button class="preview-btn" id="preview-refresh" title="Refresh">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M2 8a6 6 0 0110.5-4M14 8a6 6 0 01-10.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            <path d="M12 1v3.5h-3.5M4 15v-3.5h3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="preview-btn" id="preview-close" title="Close preview">&times;</button>
      </div>
    </div>
    <iframe id="preview-iframe" sandbox="allow-scripts allow-same-origin" class="preview-frame"></iframe>
  `;

  const refreshBtn = panel.querySelector<HTMLButtonElement>("#preview-refresh");
  const closeBtn = panel.querySelector<HTMLButtonElement>("#preview-close");
  const iframe = panel.querySelector<HTMLIFrameElement>("#preview-iframe");

  if (!refreshBtn || !closeBtn || !iframe) {
    return;
  }

  refreshBtn.addEventListener("click", () => {
    if (lastRenderedContent) {
      updatePreviewContent(lastRenderedContent);
    }
  });

  closeBtn.addEventListener("click", () => {
    hidePreview();
  });

  container.appendChild(panel);
  previewEl = panel;
  previewIframe = iframe;
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? normalized : normalized.slice(0, lastSlash);
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function setPreviewRootPath(rootPath: string | null) {
  previewRootPath = rootPath;
}

function shouldRewriteUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (value.startsWith("#")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("data:")) return false;
  if (value.startsWith("blob:")) return false;
  if (value.startsWith("javascript:")) return false;
  if (value.startsWith("mailto:")) return false;
  if (value.startsWith("tel:")) return false;
  return !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function resolvePreviewUrl(raw: string, fileDirUrl: string, rootDirUrl: string): string {
  const value = raw.trim();
  if (!shouldRewriteUrl(value)) {
    return value;
  }

  const isRootRelative = value.startsWith("/");
  const normalized = isRootRelative ? value.slice(1) : value;
  const base = isRootRelative ? rootDirUrl : fileDirUrl;

  try {
    return new URL(normalized, base).toString();
  } catch {
    return value;
  }
}

function rewriteSrcSet(srcset: string, fileDirUrl: string, rootDirUrl: string): string {
  return srcset
    .split(",")
    .map((entry) => {
      const part = entry.trim();
      if (!part) return "";

      const splitIndex = part.search(/\s/);
      if (splitIndex === -1) {
        return resolvePreviewUrl(part, fileDirUrl, rootDirUrl);
      }

      const urlPart = part.slice(0, splitIndex);
      const descriptor = part.slice(splitIndex);
      return `${resolvePreviewUrl(urlPart, fileDirUrl, rootDirUrl)}${descriptor}`;
    })
    .filter(Boolean)
    .join(", ");
}

function rewriteCssUrls(cssText: string, fileDirUrl: string, rootDirUrl: string): string {
  return cssText.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote: string, value: string) => {
    const resolved = resolvePreviewUrl(value, fileDirUrl, rootDirUrl);
    if (resolved === value) {
      return match;
    }
    return `url(${quote}${resolved}${quote})`;
  });
}

function injectBaseTag(content: string, baseHref: string): string {
  if (/<base[\s>]/i.test(content)) {
    return content;
  }

  const headMatch = content.match(/<head(\s[^>]*)?>/i);
  if (headMatch) {
    return content.replace(headMatch[0], `${headMatch[0]}<base href="${baseHref}">`);
  }

  const htmlMatch = content.match(/<html(\s[^>]*)?>/i);
  if (htmlMatch) {
    return content.replace(htmlMatch[0], `${htmlMatch[0]}<head><base href="${baseHref}"></head>`);
  }

  return `<!doctype html><html><head><base href="${baseHref}"></head><body>${content}</body></html>`;
}

function buildPreviewDocument(content: string): string {
  if (!currentPreviewPath) {
    return content;
  }

  const fileDir = dirname(currentPreviewPath);
  const rootDir = previewRootPath || fileDir;
  const fileDirUrl = ensureTrailingSlash(convertFileSrc(fileDir));
  const rootDirUrl = ensureTrailingSlash(convertFileSrc(rootDir));

  let next = content.replace(
    /(\s(?:src|href|poster)=)(["'])([^"']+)\2/gi,
    (_match, prefix: string, quote: string, value: string) =>
      `${prefix}${quote}${resolvePreviewUrl(value, fileDirUrl, rootDirUrl)}${quote}`,
  );

  next = next.replace(
    /(\ssrcset=)(["'])([^"']+)\2/gi,
    (_match, prefix: string, quote: string, value: string) =>
      `${prefix}${quote}${rewriteSrcSet(value, fileDirUrl, rootDirUrl)}${quote}`,
  );

  next = next.replace(
    /(\sstyle=)(["'])([\s\S]*?)\2/gi,
    (_match, prefix: string, quote: string, value: string) =>
      `${prefix}${quote}${rewriteCssUrls(value, fileDirUrl, rootDirUrl)}${quote}`,
  );

  next = next.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    (_match, attrs: string, value: string) =>
      `<style${attrs}>${rewriteCssUrls(value, fileDirUrl, rootDirUrl)}</style>`,
  );

  return injectBaseTag(next, fileDirUrl);
}

export function showPreview(filePath: string, content: string) {
  currentPreviewPath = filePath;
  ensurePreview();
  if (!previewEl) return;

  previewEl.style.display = "flex";
  updatePreviewContent(content);
}

export function updatePreviewContent(content: string) {
  lastRenderedContent = content;
  ensurePreview();
  if (!previewIframe) return;

  previewIframe.srcdoc = buildPreviewDocument(content);
}

export function hidePreview() {
  currentPreviewPath = null;
  lastRenderedContent = "";

  if (previewIframe) {
    previewIframe.srcdoc = "";
  }

  if (previewEl) {
    previewEl.remove();
  }

  resetPreviewRefs();
}

export function isPreviewOpen(): boolean {
  return previewEl !== null && previewEl.isConnected;
}

export function getPreviewPath(): string | null {
  return currentPreviewPath;
}
