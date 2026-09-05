import React, { useState } from "react";
import PropTypes from "prop-types";
import Flashcards from "./Flashcards";
import MockExam from "./MockExam";

// StudyView — the full-screen study surface (slice #9, D22/story 41). Studying is NOT
// cramped into a side tab: flashcards and the mock exam open in their own full view.
// This is the presentational shell — PROP-DRIVEN so it's drivable from a test with
// fakes; the route container (StudyRoute) fetches the board's cards and wires grading
// (review() server-side) on top of it.
//
// One data model, two views (story 33): the same `cards` drive both the Flashcards and
// MockExam views; a tab switches between them. Grading flows out through onGrade(card,
// grade) — the SAME seam both child views use — so SM-2 runs in ONE place server-side.
//
// Source selection (story 34, notes-only portion): this slice is notes-only. The
// source control shows "My notes only" selected; the notes+documents two-deck story
// (two labelled decks, never merged) arrives with the documents/scope slices, at which
// point this control gains the other options and filters `cards` by deck.
//
// Props (the seam):
//   cards          the board's card collection (controlled by the caller)
//   onGrade        (card, grade) => void   grading (drives SM-2 server-side)
//   onRevealSource (sourceElementIds, card) => void   click-to-highlight on the board
//   onExit         optional; leave the full-screen route back to the board
//   boardName      optional; shown in the header for context

const VIEWS = { FLASHCARDS: "flashcards", EXAM: "exam" };

export default function StudyView({
  cards = [],
  onGrade,
  onRevealSource,
  onExit,
  boardName,
}) {
  const [view, setView] = useState(VIEWS.FLASHCARDS);
  const [index, setIndex] = useState(0);

  const atEnd = index >= cards.length - 1;

  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--surface-bg)]">
      <header className="flex items-center justify-between gap-4 border-b border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onExit}
            className="rounded-lg border border-[var(--surface-border)] px-3 py-1.5 text-sm text-[var(--surface-text)] hover:border-brand-500 hover:bg-brand-50/40"
          >
            ← Back to board
          </button>
          {boardName && (
            <span className="text-sm font-medium text-[var(--surface-text)]">
              {boardName}
            </span>
          )}
        </div>

        {/* Two views, one data model (story 33). */}
        <div role="tablist" aria-label="Study view" className="flex gap-1 rounded-lg bg-[var(--surface-bg)] p-1">
          <ViewTab
            id={VIEWS.FLASHCARDS}
            label="Flashcards"
            active={view === VIEWS.FLASHCARDS}
            onSelect={setView}
          />
          <ViewTab
            id={VIEWS.EXAM}
            label="Mock exam"
            active={view === VIEWS.EXAM}
            onSelect={setView}
          />
        </div>

        {/* Source selection (story 34, notes-only portion). */}
        <div
          role="group"
          aria-label="Source"
          className="text-xs text-[var(--surface-muted)]"
        >
          <span className="rounded-lg border border-brand-500 bg-brand-50/40 px-3 py-1.5 font-medium text-[var(--surface-text)]">
            My notes only
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-stretch justify-center overflow-hidden">
        <div className="flex w-full max-w-2xl flex-col">
          {view === VIEWS.FLASHCARDS ? (
            <div className="flex h-full flex-col">
              <div className="flex-1 overflow-hidden">
                {/* Flashcards is docked (full-view here, not a side sheet). */}
                <div className="mx-auto h-full">
                  <Flashcards
                    cards={cards}
                    index={Math.min(index, Math.max(0, cards.length - 1))}
                    onGrade={onGrade}
                    onRevealSource={onRevealSource}
                    variant="docked"
                  />
                </div>
              </div>
              {cards.length > 0 && (
                <nav className="flex items-center justify-between border-t border-[var(--surface-border)] px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setIndex((i) => Math.max(0, i - 1))}
                    disabled={index <= 0}
                    className="rounded-lg border border-[var(--surface-border)] px-4 py-2 text-sm text-[var(--surface-text)] disabled:opacity-40 hover:border-brand-500 hover:bg-brand-50/40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setIndex((i) => Math.min(cards.length - 1, i + 1))}
                    disabled={atEnd}
                    className="rounded-lg border border-[var(--surface-border)] px-4 py-2 text-sm text-[var(--surface-text)] disabled:opacity-40 hover:border-brand-500 hover:bg-brand-50/40"
                  >
                    Next
                  </button>
                </nav>
              )}
            </div>
          ) : (
            <MockExam
              cards={cards}
              onGrade={onGrade}
              onRevealSource={onRevealSource}
              variant="docked"
            />
          )}
        </div>
      </main>
    </div>
  );
}

function ViewTab({ id, label, active, onSelect }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(id)}
      className={
        "rounded px-3 py-1.5 text-sm font-medium " +
        (active
          ? "bg-[var(--surface-card)] text-[var(--surface-text)] shadow-sm"
          : "text-[var(--surface-muted)] hover:text-[var(--surface-text)]")
      }
    >
      {label}
    </button>
  );
}

StudyView.propTypes = {
  cards: PropTypes.array,
  onGrade: PropTypes.func,
  onRevealSource: PropTypes.func,
  onExit: PropTypes.func,
  boardName: PropTypes.string,
};
