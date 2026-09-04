import React, { useState } from "react";
import PropTypes from "prop-types";
import {
  correctSegment,
  confirmArtifact,
  isOpenGap,
} from "../../utils/transcriptionCorrections";

// Phase-1 transcription review (D3, slice #4). The user sees exactly what the AI
// read BEFORE any notes are generated, and corrects it inline: wrong words are
// fixed in place, and each `[unclear]` gap can be tapped and filled. Notes
// generation (slice #6) is GATED behind the confirm action here — Phase 2 runs
// only on the corrected artifact this component emits via onConfirm, so misreads
// are caught before they propagate into notes.
//
// This component is a thin shell over ../../utils/transcriptionCorrections: all
// segment mutation lives there (framework-free, unit-tested). Corrections mutate
// the STRUCTURED segments Phase 2 consumes. The component NEVER deletes strokes —
// original ink stays the source of truth (story 7); it only ever reads and
// corrects text.
//
// Props (the seam — no live fetch; the caller injects the artifact + callbacks):
//   artifact   the phase-1 transcription artifact to review
//   onConfirm  called with the corrected artifact when the user confirms the gate
//   onCorrect  optional; called with the corrected artifact after every edit, so a
//              caller can persist corrections as they happen
export default function TranscriptionReview({ artifact, onConfirm, onCorrect }) {
  const [draft, setDraft] = useState(artifact);
  const [activeGap, setActiveGap] = useState(null); // "cropId:index" being filled

  const applyCorrection = (cropId, index, text) => {
    const next = correctSegment(draft, cropId, index, text);
    setDraft(next);
    onCorrect?.(next);
    return next;
  };

  const gateOpen = draft.hasUnclear; // still gaps to fill → notes stay blocked

  return (
    <section
      aria-label="Transcription review"
      className="flex flex-col gap-4 rounded-card border border-[var(--surface-border)] bg-[var(--surface-card)] p-4"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--surface-text)]">
          Review transcription
        </h2>
        <p className="text-xs text-[var(--surface-muted)]">
          Check what was read before notes are generated.
        </p>
      </header>

      <ol className="flex flex-col gap-3">
        {draft.entries.map((entry) => (
          <li
            key={entry.cropId}
            className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              {entry.segments.map((segment, index) => {
                const key = `${entry.cropId}:${index}`;
                const open = isOpenGap(segment);

                if (open && activeGap !== key) {
                  // A first-class [unclear] gap: tap to fill (story 6).
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setActiveGap(key)}
                      className="rounded border border-dashed border-amber-500 px-2 py-1 text-xs font-medium text-amber-600"
                    >
                      [unclear]
                    </button>
                  );
                }

                return (
                  <input
                    key={key}
                    aria-label={
                      open
                        ? `Fill unclear segment in crop ${entry.cropId}`
                        : `Correct segment "${segment.text}" in crop ${entry.cropId}`
                    }
                    defaultValue={segment.text}
                    autoFocus={activeGap === key}
                    onChange={(e) =>
                      applyCorrection(entry.cropId, index, e.target.value)
                    }
                    className="rounded border border-[var(--surface-border)] bg-transparent px-2 py-1 text-sm text-[var(--surface-text)] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                  />
                );
              })}
            </div>
          </li>
        ))}
      </ol>

      <footer className="flex items-center justify-between gap-3">
        {gateOpen && (
          <p role="alert" className="text-xs text-amber-600">
            Fill every [unclear] gap before generating notes.
          </p>
        )}
        <button
          type="button"
          disabled={gateOpen}
          onClick={() => onConfirm?.(confirmArtifact(draft))}
          className="ml-auto inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Confirm &amp; generate notes
        </button>
      </footer>
    </section>
  );
}

TranscriptionReview.propTypes = {
  artifact: PropTypes.shape({
    phase: PropTypes.string,
    hasUnclear: PropTypes.bool,
    entries: PropTypes.arrayOf(
      PropTypes.shape({
        cropId: PropTypes.string.isRequired,
        segments: PropTypes.arrayOf(
          PropTypes.shape({
            text: PropTypes.string.isRequired,
            uncertain: PropTypes.bool,
          })
        ).isRequired,
        sourceElementIds: PropTypes.array,
        bbox: PropTypes.object,
      })
    ).isRequired,
  }).isRequired,
  onConfirm: PropTypes.func,
  onCorrect: PropTypes.func,
};
