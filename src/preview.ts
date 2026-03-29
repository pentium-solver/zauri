// Browser preview: renders HTML files in an iframe

let previewEl: HTMLElement | null = null;
let previewIframe: HTMLIFrameElement | null = null;
let currentPreviewPath: string | null = null;

export function isPreviewable(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return ["html", "htm", "svg"].includes(ext);
}

export function showPreview(filePath: string, content: string) {
  const container = document.getElementById("editor-container")!;
  currentPreviewPath = filePath;

  if (!previewEl) {
    previewEl = document.createElement("div");
    previewEl.id = "preview-panel";
    previewEl.innerHTML = `
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
    container.appendChild(previewEl);

    document.getElementById("preview-refresh")!.addEventListener("click", () => {
      if (currentPreviewPath) refreshPreview();
    });
    document.getElementById("preview-close")!.addEventListener("click", hidePreview);

    previewIframe = document.getElementById("preview-iframe") as HTMLIFrameElement;
  }

  previewEl.style.display = "flex";
  updatePreviewContent(content);
}

export function updatePreviewContent(content: string) {
  if (!previewIframe) return;

  // Inject base tag for relative paths
  const basePath = currentPreviewPath ? currentPreviewPath.substring(0, currentPreviewPath.lastIndexOf("/") + 1) : "";
  const withBase = content.includes("<base")
    ? content
    : content.replace("<head>", `<head><base href="file://${basePath}">`);

  previewIframe.srcdoc = withBase;
}

function refreshPreview() {
  if (previewIframe && previewIframe.srcdoc) {
    const content = previewIframe.srcdoc;
    previewIframe.srcdoc = "";
    requestAnimationFrame(() => {
      previewIframe!.srcdoc = content;
    });
  }
}

export function hidePreview() {
  if (previewEl) {
    previewEl.style.display = "none";
  }
  currentPreviewPath = null;
}

export function isPreviewOpen(): boolean {
  return previewEl !== null && previewEl.style.display !== "none";
}

export function getPreviewPath(): string | null {
  return currentPreviewPath;
}
