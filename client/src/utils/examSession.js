// Mock-exam session helpers (D17, D22, slice #9) — framework-free, pure functions the
// MockExam view renders. The mock exam is a SECOND VIEW over the same card records as
// flashcards (story 33): one data model, two views. A session walks the board's cards,
// records ONE self-graded response per question, and reports a score.
//
//   let s = startSession(cards);          // a session over the board's cards
//   s = answerCurrent(s, RESPONSES.CORRECT);
//   s = advance(s);                       // next question
//   isComplete(s);                        // all questions answered?
//   scoreOf(s);                           // { total, correct, percent }
//
// Every function is pure (returns a new session, never mutates) so the view can hold a
// session in React state and drive it like a reducer.
//
// GRADING. The exam does NOT reimplement SM-2. Each self-graded response maps to an
// SM-2 quality grade (gradeForResponse), the same 0–5 value the server's cards/sm2.js
// `review()` consumes — so grading a card from the exam schedules it identically to
// grading it from flashcards. The view emits onGrade(card, gradeForResponse(response))
// and the caller applies review() server-side, exactly as Flashcards does. This module
// only chooses the grade; scheduling lives in one place (the server).

// The three self-assessed outcomes a user picks after seeing the model answer. Kept
// coarse on purpose — a mock exam over your own notes is a recall check, not a graded
// paper — and each maps to an SM-2 quality band.
export const RESPONSES = {
  WRONG: "wrong",     // didn't recall it → an SM-2 lapse (grade < 3)
  PARTIAL: "partial", // roughly right → a bare pass
  CORRECT: "correct", // recalled it → a strong pass
};

// SM-2 quality grades (0–5) per response. Mirrors Flashcards' GRADES mapping so the two
// views schedule a card the same way: Wrong = 1 (a lapse), Partial = 3 (a bare pass),
// Correct = 5 (an easy pass). The server's review() is the only thing that consumes it.
const RESPONSE_GRADE = {
  [RESPONSES.WRONG]: 1,
  [RESPONSES.PARTIAL]: 3,
  [RESPONSES.CORRECT]: 5,
};

// The plain disclaimer the exam view carries (story 38): the exam is drawn from the
// user's own notes and is not a prediction of a real exam. Plain text, a view property.
export const EXAM_DISCLAIMER =
  "This mock exam is generated from your notes. It is not a prediction of a real exam — " +
  "use it to check your recall, not to guess what will be asked.";

// The SM-2 quality grade for a self-graded response. Unknown responses degrade to a
// lapse (fail-safe: an unexpected value can't be scored as a pass).
export function gradeForResponse(response) {
  return Object.prototype.hasOwnProperty.call(RESPONSE_GRADE, response)
    ? RESPONSE_GRADE[response]
    : 1;
}

// A fresh session over a list of card records. `cards` is the exact flashcards data
// model (server/cards shape) — no separate exam data (story 33).
export function startSession(cards = []) {
  const list = Array.isArray(cards) ? cards : [];
  return { cards: list, total: list.length, index: 0, responses: [] };
}

// The card currently under examination, or null past the end.
export function currentCard(session) {
  return session.cards[session.index] || null;
}

// Record (or overwrite) the response to the CURRENT question. Overwrites rather than
// appends so a user who changes their self-grade before advancing doesn't double-count.
export function answerCurrent(session, response) {
  const card = currentCard(session);
  if (!card) return session;
  const cardId = card.id;
  const others = session.responses.filter((r) => r.cardId !== cardId);
  return { ...session, responses: [...others, { cardId, response }] };
}

// Move to the next question. Advancing past the last question leaves index at total,
// which reads as complete.
export function advance(session) {
  return { ...session, index: Math.min(session.index + 1, session.total) };
}

// True once every question has a recorded response (or the deck was empty). An empty
// deck is trivially complete.
export function isComplete(session) {
  return session.total === 0 || session.responses.length >= session.total;
}

// The session score: how many were self-graded CORRECT out of the total, plus a whole
// percent (0 for an empty deck). Partial and wrong don't count toward the score, but
// they still schedule the card via gradeForResponse.
export function scoreOf(session) {
  const total = session.total;
  const correct = session.responses.filter(
    (r) => r.response === RESPONSES.CORRECT
  ).length;
  const percent = total === 0 ? 0 : Math.round((correct / total) * 100);
  return { total, correct, percent };
}
