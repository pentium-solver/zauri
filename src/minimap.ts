// Minimap: scrollbar-style code overview
// Renders a scaled-down canvas of the document

import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type Extension } from "@codemirror/state";

const CHAR_WIDTH = 1.2;
const LINE_HEIGHT = 2.5;
const MINIMAP_WIDTH = 60;

class MinimapView {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  wrapper: HTMLElement;
  view: EditorView;

  constructor(view: EditorView) {
    this.view = view;

    this.wrapper = document.createElement("div");
    this.wrapper.className = "minimap-wrapper";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "minimap-canvas";
    this.canvas.width = MINIMAP_WIDTH * 2; // retina
    this.canvas.height = 1;
    this.ctx = this.canvas.getContext("2d")!;

    this.wrapper.appendChild(this.canvas);
    view.dom.appendChild(this.wrapper);

    // Click to scroll
    this.canvas.addEventListener("click", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      const line = Math.floor(ratio * view.state.doc.lines) + 1;
      const safeLine = Math.min(line, view.state.doc.lines);
      const pos = view.state.doc.line(safeLine).from;
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "center" }),
      });
    });

    this.render();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.render();
    }
  }

  render() {
    const doc = this.view.state.doc;
    const lines = doc.lines;
    const height = Math.max(lines * LINE_HEIGHT, 100);

    this.canvas.height = height * 2;
    this.canvas.style.height = `${height}px`;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.scale(2, 2);

    // Draw viewport indicator
    const scrollInfo = this.view.dom.querySelector(".cm-scroller");
    if (scrollInfo) {
      const scrollTop = scrollInfo.scrollTop;
      const scrollHeight = scrollInfo.scrollHeight;
      const clientHeight = scrollInfo.clientHeight;
      if (scrollHeight > 0) {
        const viewTop = (scrollTop / scrollHeight) * height;
        const viewHeight = (clientHeight / scrollHeight) * height;
        this.ctx.fillStyle = "rgba(168, 130, 255, 0.08)";
        this.ctx.fillRect(0, viewTop, MINIMAP_WIDTH, viewHeight);
        this.ctx.strokeStyle = "rgba(168, 130, 255, 0.2)";
        this.ctx.lineWidth = 0.5;
        this.ctx.strokeRect(0, viewTop, MINIMAP_WIDTH, viewHeight);
      }
    }

    // Draw lines as colored bars
    for (let i = 1; i <= Math.min(lines, 5000); i++) {
      const line = doc.line(i);
      const text = line.text;
      if (!text.trim()) continue;

      const indent = text.length - text.trimStart().length;
      const contentLen = Math.min(text.trimEnd().length - indent, 80);

      const y = (i - 1) * LINE_HEIGHT;
      const x = indent * CHAR_WIDTH;

      // Color based on content
      const isComment = text.trimStart().startsWith("//") || text.trimStart().startsWith("#") || text.trimStart().startsWith("--");
      const isString = text.includes('"') || text.includes("'") || text.includes("`");

      if (isComment) {
        this.ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      } else if (isString) {
        this.ctx.fillStyle = "rgba(168, 130, 255, 0.15)";
      } else {
        this.ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
      }

      this.ctx.fillRect(x, y, contentLen * CHAR_WIDTH, LINE_HEIGHT - 0.5);
    }

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  destroy() {
    this.wrapper.remove();
  }
}

const minimapPlugin = ViewPlugin.fromClass(MinimapView, {
  // No decorations needed
});

export const minimapExtension: Extension = [minimapPlugin];
