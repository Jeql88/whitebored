import React, { useState } from "react";
import PropTypes from "prop-types";

// The Flashcards study view (slice #8, D17/D18). Like NotesPanel and
// TranscriptionReview, this is a thin, PROP-DRIVEN shell: the caller owns the cards
// collection (generated + persisted server-side by server/cards) and the socket, and
// injects the cards + callbacks as props. No live fetch, no socket here — so the
// component is drivable from a test with fakes.
//
// A card is the server card shape (server/cards):
//   { id, question, answer, deck, boardId, sourceElementIds, reviewState, relationship? }
//
// Behaviour:
//   - Studies ONE card at a time: shows the question, and a "Show answer" flip reveals
//     the answer (a flashcard's whole point — recall before you see it).
//   - Each card links back to its source SHAPE on the board (story 36): a "Show on
//     board" affordance emits onRevealSource(sourceElementIds, card). Only a card that
//     traces to a shape shows it (a relationship card always does).
//   - Grading a revealed card drives SM-2 (story 39): the grade buttons call
//     onGrade(card, grade) — the caller applies the schedule server-side and advances.
//     Grades follow SM-2's quality scale; we surface the three the user thinks in
//     (Again = 1 / a lapse, Good = 4, Easy = 5) rather than the raw 0–5.
//   - Relationship cards (story 37) render with a small "From your diagram" badge so
//     the user knows the question came from the board's arrows, not just the text.
//   - Responsive (D22): a docked right COLUMN on wide screens and a slide-over SHEET on
//     narrow, mirroring NotesPanel. `variant` picks the chrome; `onClose` dismisses the
//     sheet.
//
// Props (the seam):
//   cards          the card collection (controlled by the caller)
//   index          which card is showing (controlled); defaults to 0
//   onGrade        (card, grade) => void   grading entry point (drives SM-2)
//   onRevealSource (sourceElementIds, card) => void   click-to-highlight on the board
//   variant        "docked" | "sheet"      responsive chrome (D22)
//   onClose        optional; sheet dismiss

// The grades the study UI offers, mapped to SM-2 quality values the server's review()
// consumes. "Again" is a lapse (grade < 3); "Good"/"Easy" are passes of rising ease.
const GRADES = [
  { label: "Again", grade: 1 },
  { label: "Good", grade: 4 },
  { label: "Easy", grade: 5 },
];

function hasSource(card) {
  return (
    card &&
    Array.isArray(card.sourceElementIds) &&
    card.sourceElementIds.length > 0
  );
}

export default function Flashcards({
  cards = [],
  index = 0,
  onGrade,
  onRevealSource,
  variant = "docked",
  onClose,
}) {
  const isSheet = variant === "sheet";
  // Reveal state is local, per card: flipping back to the question on card change is
  // handled by keying off the index so a new card always starts face-down.
  const [revealedIndex, setRevealedIndex] = useState(null);
  const card = cards[index];
  const revealed = revealedIndex === index;

  const chrome = isSheet
    ? "fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col gap-4 border-l border-[var(--surface-border)] bg-[var(--surface-card)] p-4 shadow-xl"
    : "flex h-full w-80 flex-col gap-4 border-l border-[var(--surface-border)] bg-[var(--surface-card)] p-4";

  return (
    <aside aria-label="Flashcards" data-variant={variant} className={chrome}>
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--surface-text)]">Flashcards</h2>
        {isSheet && onClose && (
          <button
            type="button"
            aria-label="Close flashcards"
            onClick={onClose}
            className="rounded p-1 text-[var(--surface-muted)] hover:text-[var(--surface-text)]"
          >
            ✕
          </button>
        )}
      </header>

      {cards.length === 0 || !card ? (
        <p className="text-xs text-[var(--surface-muted)]">
          No flashcards yet. Generate notes, then create flashcards from them.
        </p>
      ) : (
        <>
          <p className="text-xs text-[var(--surface-muted)]">
            Card {index + 1} of {cards.length}
          </p>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
            <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
              {card.relationship && (
                <span className="mb-2 inline-block rounded bg-brand-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-700">
                  From your diagram
                </span>
              )}
              <p className="text-sm font-medium text-[var(--surface-text)]">
                {card.question}
              </p>

              {revealed && (
                <p
                  aria-label="Answer"
                  className="mt-3 border-t border-[var(--surface-border)] pt-3 text-sm text-[var(--surface-text)]"
                >
                  {card.answer}
                </p>
              )}
            </div>

            {hasSource(card) && (
              <button
                type="button"
                onClick={() => onRevealSource?.(card.sourceElementIds, card)}
                className="inline-flex items-center justify-center rounded-lg border border-[var(--surface-border)] px-3 py-2 text-sm text-[var(--surface-text)] hover:border-brand-500 hover:bg-brand-50/40"
              >
                Show on board
              </button>
            )}
          </div>

          {revealed ? (
            <div className="flex gap-2">
              {GRADES.map((g) => (
                <button
                  key={g.grade}
                  type="button"
                  onClick={() => onGrade?.(card, g.grade)}
                  className="flex-1 rounded-lg border border-[var(--surface-border)] px-3 py-2 text-sm font-medium text-[var(--surface-text)] hover:border-brand-500 hover:bg-brand-50/40"
                >
                  {g.label}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRevealedIndex(index)}
              className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Show answer
            </button>
          )}
        </>
      )}
    </aside>
  );
}

Flashcards.propTypes = {
  cards: PropTypes.arrayOf(
    PropTypes.shape({
      question: PropTypes.string.isRequired,
      answer: PropTypes.string.isRequired,
      sourceElementIds: PropTypes.array,
      relationship: PropTypes.bool,
    })
  ),
  index: PropTypes.number,
  onGrade: PropTypes.func,
  onRevealSource: PropTypes.func,
  variant: PropTypes.oneOf(["docked", "sheet"]),
  onClose: PropTypes.func,
};
