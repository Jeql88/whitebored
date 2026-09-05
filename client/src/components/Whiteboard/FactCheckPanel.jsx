import React from "react";
import PropTypes from "prop-types";

// The Fact-check panel beside the canvas (slice #15, D15/D22). Like NotesPanel and
// Flashcards, this is a thin, PROP-DRIVEN shell: the caller owns the flags (produced
// + verified + persisted server-side by server/factcheck) and the socket, and injects
// the flags + callbacks as props. No live fetch, no socket, no model here — so the
// component is drivable from a test with fakes.
//
// A flag is the server flag shape (server/factcheck):
//   { id, boardClaim, sourceClaim, citation: { docId, page }, severity, status }
//   status ::= "open" | "accepted" | "dismissed"
//
// Behaviour:
//   - Shows ONLY open flags (story 29): a flag the user already judged
//     (accepted/dismissed) is never re-nagged. Every displayed flag is EVIDENCE —
//     its citation was verified server-side before it ever reached the client (D15).
//   - Each flag shows what the board says vs. what the source says, its severity, and
//     a clickable citation that deep-links to the page (story 24) via onCitationClick.
//   - Accept / Dismiss are the user's call (story 28). The panel only REPORTS the
//     intent (onAccept / onDismiss); it NEVER edits notes, the board, or ink itself.
//   - After Accept, the caller may hand back a `pendingEdit` OFFER (the server's
//     acceptFlag() result). The panel shows the current line vs. the suggested text
//     and lets the user Apply or Keep — the edit is applied only on explicit confirm.
//   - Responsive (D22): a docked right COLUMN on wide screens and a slide-over SHEET
//     on narrow, mirroring NotesPanel/Flashcards. `variant` picks the chrome.
//
// Props (the seam):
//   flags            the flag records (controlled by the caller)
//   onAccept         (flag) => void          user accepts a flag (caller does the rest)
//   onDismiss        (flag) => void          user dismisses a flag (persists server-side)
//   onCitationClick  (citation) => void      jump-to-page deep link (story 24)
//   pendingEdit      optional edit OFFER to confirm: { flagId, lineIndex,
//                                                      currentText, suggestedText }
//   onConfirmEdit    (pendingEdit) => void   user applies the suggested line edit
//   onDeclineEdit    (pendingEdit) => void   user keeps their note as-is
//   variant          "docked" | "sheet"      responsive chrome (D22)
//   onClose          optional; sheet dismiss

const SEVERITY_STYLE = {
  high: "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};

function Citation({ citation, onCitationClick }) {
  if (!citation) return null;
  return (
    <button
      type="button"
      onClick={() => onCitationClick?.(citation)}
      className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline"
    >
      Source: p.{citation.page}
    </button>
  );
}

Citation.propTypes = {
  citation: PropTypes.shape({ docId: PropTypes.string, page: PropTypes.number }),
  onCitationClick: PropTypes.func,
};

export default function FactCheckPanel({
  flags = [],
  onAccept,
  onDismiss,
  onCitationClick,
  pendingEdit,
  onConfirmEdit,
  onDeclineEdit,
  variant = "docked",
  onClose,
}) {
  const isSheet = variant === "sheet";
  // "embedded" = rendered inside another panel's chrome (the study sidebar), so
  // this panel contributes CONTENT only: full width, no border, no own surface.
  const isEmbedded = variant === "embedded";
  // Only open flags are surfaced — a judged flag stays judged (story 29).
  const openFlags = flags.filter((f) => f && f.status === "open");

  const chrome = isSheet
    ? "fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col gap-4 border-l border-[var(--surface-border)] bg-[var(--surface-card)] p-4 shadow-xl"
    : isEmbedded
            ? "flex h-full w-full flex-col gap-4 bg-transparent p-4"
            : "flex h-full w-80 flex-col gap-4 border-l border-[var(--surface-border)] bg-[var(--surface-card)] p-4";

  return (
    <aside aria-label="Fact-check" data-variant={variant} className={chrome}>
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--surface-text)]">Fact-check</h2>
        {isSheet && onClose && (
          <button
            type="button"
            aria-label="Close fact-check"
            onClick={onClose}
            className="rounded p-1 text-[var(--surface-muted)] hover:text-[var(--surface-text)]"
          >
            ✕
          </button>
        )}
      </header>

      {/* The edit OFFER surfaced after Accept — the user confirms; nothing is applied
          until they do (story 28: Accept never auto-edits). */}
      {pendingEdit && (
        <div className="rounded-lg border border-brand-500 bg-brand-50/40 p-3">
          <p className="text-xs font-semibold text-[var(--surface-text)]">
            Edit this note line?
          </p>
          <p className="mt-2 text-xs text-[var(--surface-muted)]">
            <span className="line-through">{pendingEdit.currentText}</span>
          </p>
          <p className="text-xs text-[var(--surface-text)]">
            → {pendingEdit.suggestedText}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => onConfirmEdit?.(pendingEdit)}
              className="flex-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
            >
              Apply edit
            </button>
            <button
              type="button"
              onClick={() => onDeclineEdit?.(pendingEdit)}
              className="flex-1 rounded-lg border border-[var(--surface-border)] px-3 py-1.5 text-xs font-medium text-[var(--surface-text)] hover:border-brand-500"
            >
              Keep my note
            </button>
          </div>
        </div>
      )}

      {openFlags.length === 0 ? (
        <p className="text-xs text-[var(--surface-muted)]">
          No contradictions found between your board and the attached source.
        </p>
      ) : (
        <ul className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {openFlags.map((f) => (
            <li
              key={f.id}
              className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span
                  className={
                    "rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                    (SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.low)
                  }
                >
                  {f.severity}
                </span>
                <Citation citation={f.citation} onCitationClick={onCitationClick} />
              </div>

              <p className="text-xs text-[var(--surface-muted)]">Your board says</p>
              <p className="mb-2 text-sm text-[var(--surface-text)]">{f.boardClaim}</p>

              <p className="text-xs text-[var(--surface-muted)]">The source says</p>
              <p className="mb-3 text-sm text-[var(--surface-text)]">{f.sourceClaim}</p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onAccept?.(f)}
                  className="flex-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss?.(f)}
                  className="flex-1 rounded-lg border border-[var(--surface-border)] px-3 py-1.5 text-xs font-medium text-[var(--surface-text)] hover:border-brand-500"
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

FactCheckPanel.propTypes = {
  flags: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      boardClaim: PropTypes.string.isRequired,
      sourceClaim: PropTypes.string.isRequired,
      citation: PropTypes.shape({ docId: PropTypes.string, page: PropTypes.number }),
      severity: PropTypes.string,
      status: PropTypes.string,
    })
  ),
  onAccept: PropTypes.func,
  onDismiss: PropTypes.func,
  onCitationClick: PropTypes.func,
  pendingEdit: PropTypes.shape({
    flagId: PropTypes.string,
    lineIndex: PropTypes.number,
    currentText: PropTypes.string,
    suggestedText: PropTypes.string,
  }),
  onConfirmEdit: PropTypes.func,
  onDeclineEdit: PropTypes.func,
  variant: PropTypes.oneOf(["docked", "sheet", "embedded"]),
  onClose: PropTypes.func,
};
