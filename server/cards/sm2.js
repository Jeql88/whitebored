"use strict";

// SM-2 spaced-repetition scheduling (story 39) — the pure arithmetic that decides
// when a flashcard is next due. There is NO AI cost here: SM-2 is a deterministic
// function of the card's current schedule and the grade the user just gave it, so
// this module is a plain calculator with a `now` seam for the clock (kept injectable
// so `dueDate` is deterministic under test, mirroring the Gemini module's clock seam).
//
//   const state = freshSchedule();                 // a brand-new card's schedule
//   const next  = review(state, grade, { now });   // schedule after a review
//
// The per-card schedule fields the spec names (D18/story 39):
//   ease      SM-2 easiness factor, starts at 2.5, floored at 1.3
//   interval  days until next due
//   dueDate   ISO date string the card next becomes due
//   lapses    number of times the card was failed (grade < 3) after graduating
//   reps      consecutive successful reviews (resets to 0 on a lapse)
//
// Grades follow SM-2's 0–5 quality scale; a grade < 3 is a lapse (the answer was
// not recalled well enough) and the card restarts its interval. The three-argument
// interval schedule (1 day, then 6 days, then interval*ease) is standard SM-2.

const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;
const LAPSE_THRESHOLD = 3; // grade below this = failed recall = a lapse

// A brand-new card: never reviewed, due immediately (interval 0, due "now" when the
// caller stamps it). `dueDate` is left null so the store/generator stamps it against
// the same clock the rest of the record uses; a null dueDate reads as "due now".
function freshSchedule() {
  return {
    ease: DEFAULT_EASE,
    interval: 0,
    dueDate: null,
    lapses: 0,
    reps: 0,
  };
}

// Add whole days to a Date and return the ISO date (YYYY-MM-DD) — schedules are
// day-grained, so we don't carry a time-of-day that would make "due today" drift.
function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Clamp a grade into the SM-2 0–5 quality scale so a bad caller value can't push
// the ease factor out of range (fail-safe on the foreseen: an out-of-range grade
// degrades to the nearest valid one rather than corrupting the schedule).
function clampGrade(grade) {
  const g = Number.isFinite(grade) ? Math.round(grade) : 0;
  return Math.max(0, Math.min(5, g));
}

// Apply a review to a schedule and return the NEW schedule (never mutates the input,
// so a reconcile that carries a prior schedule forward stays referentially clean).
// `now` is injected for deterministic dueDate under test.
function review(state, grade, { now = () => Date.now() } = {}) {
  const prev = { ...freshSchedule(), ...(state || {}) };
  const q = clampGrade(grade);
  const today = new Date(now());

  // Ease is nudged by the standard SM-2 formula and floored at 1.3, regardless of
  // pass/fail — a hard-but-passed card still eases off, a failed one eases harder.
  const ease = Math.max(
    MIN_EASE,
    prev.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  );

  if (q < LAPSE_THRESHOLD) {
    // A lapse: restart the interval (relearn from 1 day), bump the lapse count, and
    // reset the streak. Ease still takes its (downward) adjustment above.
    return {
      ease,
      interval: 1,
      dueDate: addDays(today, 1),
      lapses: prev.lapses + 1,
      reps: 0,
    };
  }

  // A pass: advance the interval on the standard SM-2 ladder.
  const reps = prev.reps + 1;
  let interval;
  if (reps === 1) interval = 1;
  else if (reps === 2) interval = 6;
  else interval = Math.round(prev.interval * ease);

  return {
    ease,
    interval,
    dueDate: addDays(today, interval),
    lapses: prev.lapses,
    reps,
  };
}

// True when a card is due for review at `now` (null dueDate = a fresh, never-seen
// card, which is always due). Used by a study view to pick the next card.
function isDue(state, { now = () => Date.now() } = {}) {
  const due = state && state.dueDate;
  if (!due) return true;
  return new Date(due).getTime() <= new Date(now()).setUTCHours(0, 0, 0, 0) + 86400000 - 1;
}

module.exports = { freshSchedule, review, isDue, MIN_EASE, DEFAULT_EASE };
