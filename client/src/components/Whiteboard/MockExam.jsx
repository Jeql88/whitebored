import React, { useState } from "react";
import PropTypes from "prop-types";
import {
  startSession,
  currentCard,
  answerCurrent,
  advance,
  isComplete,
  scoreOf,
  gradeForResponse,
  RESPONSES,
  EXAM_DISCLAIMER,
} from "../../utils/examSession";

// The MockExam study view (slice #9, D17/D22). The exam is a SECOND VIEW over the SAME
// card records as flashcards (story 33) — one data model, two views. Like Flashcards,
// this is a thin, PROP-DRIVEN shell: the caller owns the cards (generated + persisted
// server-side by server/cards) and injects them + callbacks. No live fetch, no socket,
// no model here, so it's drivable from a test with fakes.
//
// A card is the server card shape (server/cards):
//   { id, question, answer, deck, boardId, sourceElementIds, reviewState, relationship? }
//
// Behaviour:
//   - Walks the deck ONE question at a time (examSession): shows the question, a
//     "Reveal answer" flip shows the model answer, then the user self-grades their
//     recall. Recall before you see it — a mock exam over your own notes is a recall
//     check, not a graded paper.
//   - The exam carries the plain disclaimer (story 38) that it's from the user's notes
//     and not a real-exam prediction — a VIEW PROPERTY (EXAM_DISCLAIMER), not a data
//     field, so the exact same card records drive both views.
//   - Self-grading drives SM-2 (story 39) through the SAME onGrade(card, grade) seam
//     Flashcards uses: each response maps to an SM-2 quality grade (gradeForResponse)
//     and the caller applies review() server-side. Scheduling lives in ONE place.
//   - Each question links back to its source SHAPE on the board (story 36) via
//     onRevealSource(sourceElementIds, card), same as flashcards.
//   - At the end, a result screen reports the score (correct out of total, percent).
//   - Responsive (D22) via `variant`: a docked column on wide, a slide-over sheet on
//     narrow — mirrors Flashcards/NotesPanel — though the study route hosts it full-
//     screen (variant "docked").
//
// Props (the seam):
//   cards          the card collection (controlled by the caller)
//   onGrade        (card, grade) => void   grading entry point (drives SM-2)
//   onRevealSource (sourceElementIds, card) => void   click-to-highlight on the board
//   onFinish       optional; called with the score when the exam completes
//   variant        "docked" | "sheet"      responsive chrome (D22)
//   onClose        optional; sheet dismiss

// The self-grade choices, mapped (via examSession.gradeForResponse) to SM-2 quality.
const CHOICES = [
  { label: "Correct", response: RESPONSES.CORRECT },
  { label: "Partial", response: RESPONSES.PARTIAL },
  { label: "I got it wrong", response: RESPONSES.WRONG },
];

function hasSource(card) {
  return (
    card &&
    Array.isArray(card.sourceElementIds) &&
    card.sourceElementIds.length > 0
  );
}

export default function MockExam({
  cards = [],
  onGrade,
  onRevealSource,
  onFinish,
  variant = "docked",
  onClose,
}) {
  const isSheet = variant === "sheet";
  const [session, setSession] = useState(() => startSession(cards));
  const [revealed, setRevealed] = useState(false);
  const card = currentCard(session);
  const done = isComplete(session);

  const chrome = isSheet
    ? "fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col gap-4 border-l border-[var(--surface-border)] bg-[var(--surface-card)] p-4 shadow-xl"
    : "flex h-full w-full flex-col gap-4 bg-[var(--surface-card)] p-4";

  function grade(response) {
    // Record the self-grade, drive SM-2 through the shared seam, then advance. The
    // caller owns applying review() server-side (same contract as Flashcards.onGrade).
    onGrade?.(card, gradeForResponse(response));
    const answered = answerCurrent(session, response);
    const next = advance(answered);
    setSession(next);
    setRevealed(false);
    if (isComplete(next)) onFinish?.(scoreOf(next));
  }

  return (
    <section aria-label="Mock exam" data-variant={variant} className={chrome}>
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--surface-text)]">Mock exam</h2>
        {isSheet && onClose && (
          <button
            type="button"
            aria-label="Close mock exam"
            onClick={onClose}
            className="rounded p-1 text-[var(--surface-muted)] hover:text-[var(--surface-text)]"
          >
            ✕
          </button>
        )}
      </header>

      {/* The disclaimer (story 38): plain text, from the user's notes, not a real exam. */}
      <p
        role="note"
        className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] px-3 py-2 text-xs text-[var(--surface-muted)]"
      >
        {EXAM_DISCLAIMER}
      </p>

      {session.total === 0 ? (
        <p className="text-xs text-[var(--surface-muted)]">
          No cards to examine yet. Generate notes, then create flashcards from them.
        </p>
      ) : done ? (
        <ExamResult score={scoreOf(session)} />
      ) : (
        <>
          <p className="text-xs text-[var(--surface-muted)]">
            Question {session.index + 1} of {session.total}
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
              {CHOICES.map((c) => (
                <button
                  key={c.response}
                  type="button"
                  onClick={() => grade(c.response)}
                  className="flex-1 rounded-lg border border-[var(--surface-border)] px-3 py-2 text-sm font-medium text-[var(--surface-text)] hover:border-brand-500 hover:bg-brand-50/40"
                >
                  {c.label}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Reveal answer
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ExamResult({ score }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <p className="text-2xl font-semibold text-[var(--surface-text)]">
        {score.percent}%
      </p>
      <p className="text-sm text-[var(--surface-muted)]">
        {score.correct} of {score.total} correct
      </p>
    </div>
  );
}

MockExam.propTypes = {
  cards: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      question: PropTypes.string.isRequired,
      answer: PropTypes.string.isRequired,
      sourceElementIds: PropTypes.array,
      relationship: PropTypes.bool,
    })
  ),
  onGrade: PropTypes.func,
  onRevealSource: PropTypes.func,
  onFinish: PropTypes.func,
  variant: PropTypes.oneOf(["docked", "sheet"]),
  onClose: PropTypes.func,
};
