import React from "react";
import PropTypes from "prop-types";
import { NOTE_TYPES, isHighlightable } from "../../utils/notesArtifact";

// The Notes artifact panel beside the canvas (slice #6, D6/D8/D9/D22). This is the
// AI panel's first tab and the hub later slices build on. It is a thin,
// prop-driven shell (same seam as TranscriptionReview): the caller owns the
// streamed lines and the socket, and injects them + callbacks as props. No live
// fetch, no socket here — so the component is drivable from a test with fakes.
//
// Behaviour:
//   - A note-type picker (Lecture / Meeting / Process / Freeform) chosen BEFORE
//     generating — it selects the prompt template only (D8/story 10).
//   - Generate produces notes from the CORRECTED transcription (the caller wires
//     onGenerate to emit the socket "generateNotes"). While generating, the panel
//     shows a "working" state (story 14/56) rather than a dead spinner.
//   - Lines STREAM in: the caller appends each verified line to `lines` as the
//     server confirms it (D9), and the panel renders them in order. Because a line
//     is only ever handed here AFTER server-side verification, none ever flicker or
//     retract (story 15).
//   - Clicking a line highlights its source shape(s) on the board via onHighlight
//     (story 9). Only lines that trace to a shape are clickable.
//   - Responsive (D22): a docked right COLUMN on wide screens (the caller reflows
//     the canvas) and a slide-over SHEET on narrow. `variant` picks the chrome;
//     `onClose` (sheet) lets the user dismiss it.
//
// Props (the seam):
//   noteType            currently selected type id
//   onNoteTypeChange    (typeId) => void        picker change
//   onGenerate          (typeId) => void        the generation entry point
//   lines               streamed note lines (controlled by the caller)
//   generating          boolean — show the working state
//   onHighlight         (sourceElementIds, line) => void   click-to-highlight
//   variant             "docked" | "sheet"      responsive chrome (D22)
//   onClose             optional; sheet dismiss

const KIND_LABEL = {
  summary: "Summary",
  heading: "Heading",
  "key-point": "Key point",
  "sequence-step": "Step",
};

export default function NotesPanel({
  noteType = "freeform",
  onNoteTypeChange,
  onGenerate,
  lines = [],
  generating = false,
  onHighlight,
  variant = "docked",
  onClose,
}) {
  const isSheet = variant === "sheet";
  // "embedded" = rendered inside another panel's chrome (the study sidebar), so
  // this panel contributes CONTENT only: full width, no border, no own surface.
  const isEmbedded = variant === "embedded";

  return (
    <aside
      aria-label="Notes"
      data-variant={variant}
      className={
        isSheet
          ? // Slide-over sheet on narrow screens (D22/story 54): overlays, doesn't
            // eat a fixed column of drawing space.
            "fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col gap-4 border-l border-[var(--surface-border)] bg-[var(--surface-card)] p-4 shadow-xl"
          : // Docked right column on wide screens (D22/story 55): the caller reflows
            // the canvas to make room.
            isEmbedded
            ? "flex h-full w-full flex-col gap-4 bg-transparent p-4"
            : "flex h-full w-80 flex-col gap-4 border-l border-[var(--surface-border)] bg-[var(--surface-card)] p-4"
      }
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--surface-text)]">Notes</h2>
        {isSheet && onClose && (
          <button
            type="button"
            aria-label="Close notes"
            onClick={onClose}
            className="rounded p-1 text-[var(--surface-muted)] hover:text-[var(--surface-text)]"
          >
            ✕
          </button>
        )}
      </header>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="notes-type"
          className="text-xs font-medium text-[var(--surface-muted)]"
        >
          Note type
        </label>
        <select
          id="notes-type"
          aria-label="Note type"
          value={noteType}
          disabled={generating}
          onChange={(e) => onNoteTypeChange?.(e.target.value)}
          className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] px-3 py-2 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50"
        >
          {NOTE_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={generating}
          onClick={() => onGenerate?.(noteType)}
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating ? "Generating…" : "Generate"}
        </button>
      </div>

      {generating && (
        // The "working" state during model waits (story 14/56) — never a dead
        // spinner; lines arrive under it as they stream in.
        <p role="status" className="text-xs text-[var(--surface-muted)]">
          Reading your board…
        </p>
      )}

      {lines.length === 0 && !generating ? (
        <p className="text-xs text-[var(--surface-muted)]">
          Pick a note type and press Generate to turn your board into notes.
        </p>
      ) : (
        <ol className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {lines.map((line, index) => {
            const highlightable = isHighlightable(line);
            const kindLabel = KIND_LABEL[line.kind] || "Note";
            return (
              <li key={index}>
                <button
                  type="button"
                  disabled={!highlightable}
                  onClick={() =>
                    highlightable &&
                    onHighlight?.(line.sourceElementIds, line)
                  }
                  aria-label={
                    highlightable
                      ? `Highlight source of "${line.text}"`
                      : line.text
                  }
                  className={
                    "w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] px-3 py-2 text-left text-sm text-[var(--surface-text)] " +
                    (highlightable
                      ? "cursor-pointer hover:border-brand-500 hover:bg-brand-50/40"
                      : "cursor-default")
                  }
                >
                  <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-[var(--surface-muted)]">
                    {kindLabel}
                  </span>
                  {line.text}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

NotesPanel.propTypes = {
  noteType: PropTypes.string,
  onNoteTypeChange: PropTypes.func,
  onGenerate: PropTypes.func,
  lines: PropTypes.arrayOf(
    PropTypes.shape({
      text: PropTypes.string.isRequired,
      kind: PropTypes.string,
      sourceElementIds: PropTypes.array,
      origin: PropTypes.string,
    })
  ),
  generating: PropTypes.bool,
  onHighlight: PropTypes.func,
  variant: PropTypes.oneOf(["docked", "sheet", "embedded"]),
  onClose: PropTypes.func,
};
