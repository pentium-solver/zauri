// CodeMirror 6 diff decorations
// Shows green/red line highlighting for proposed AI edits with accept/reject toolbar

import { EditorView, Decoration, DecorationSet, WidgetType } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import { computeLineDiff } from "./ai-edits";

// ---- Effects ----

/** Set diff decorations for the current file */
export const setDiffEffect = StateEffect.define<{
  original: string;
  proposed: string;
  onAccept: () => void;
  onReject: () => void;
} | null>();

// ---- Toolbar Widget ----

class DiffToolbarWidget extends WidgetType {
  constructor(
    private onAccept: () => void,
    private onReject: () => void,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "ai-diff-toolbar";
    bar.innerHTML = `
      <span class="ai-diff-label">AI suggested changes</span>
      <div class="ai-diff-actions">
        <button class="ai-diff-btn accept">Accept</button>
        <button class="ai-diff-btn reject">Reject</button>
      </div>
    `;
    bar.querySelector(".accept")!.addEventListener("click", (e) => {
      e.preventDefault();
      this.onAccept();
    });
    bar.querySelector(".reject")!.addEventListener("click", (e) => {
      e.preventDefault();
      this.onReject();
    });
    return bar;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// ---- Line Decorations ----

const addedLineDeco = Decoration.line({ class: "cm-diff-added" });
// Reserved for future inline removed-line display
// const removedLineDeco = Decoration.line({ class: "cm-diff-removed" });

// ---- State Field ----

export const diffDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },

  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiffEffect)) {
        if (effect.value === null) {
          // Clear decorations
          return Decoration.none;
        }

        const { original, proposed, onAccept, onReject } = effect.value;
        const diffLines = computeLineDiff(original, proposed);
        const decos: any[] = [];

        // Add toolbar widget at the very top
        decos.push(
          Decoration.widget({
            widget: new DiffToolbarWidget(onAccept, onReject),
            side: -1,
          }).range(0),
        );

        // The editor shows the PROPOSED content. We mark lines that differ.
        // We need to map diff results to actual editor lines.
        // Since the editor doc IS the proposed content, we track which
        // proposed lines are "add" (new) vs "same" (unchanged).
        let editorLine = 1;
        const doc = tr.state.doc;

        for (const dl of diffLines) {
          if (dl.type === "add") {
            // This line exists in proposed (editor) but not in original
            if (editorLine <= doc.lines) {
              const line = doc.line(editorLine);
              decos.push(addedLineDeco.range(line.from));
            }
            editorLine++;
          } else if (dl.type === "same") {
            editorLine++;
          }
          // "remove" lines don't exist in the editor doc (they were in original only)
        }

        // Sort decorations by position (required by CM6)
        decos.sort((a: any, b: any) => a.from - b.from || a.startSide - b.startSide);
        return Decoration.set(decos);
      }
    }
    return decorations;
  },

  provide: (f) => EditorView.decorations.from(f),
});

// ---- Extension ----

export const diffExtension = [diffDecorationField];

// ---- Helper to activate/deactivate diff view ----

export function activateDiff(
  view: EditorView,
  original: string,
  proposed: string,
  onAccept: () => void,
  onReject: () => void,
) {
  view.dispatch({
    effects: setDiffEffect.of({ original, proposed, onAccept, onReject }),
  });
}

export function clearDiff(view: EditorView) {
  view.dispatch({
    effects: setDiffEffect.of(null),
  });
}
