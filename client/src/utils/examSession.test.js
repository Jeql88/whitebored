// Unit tests for the framework-free mock-exam session helpers (D17, D22, slice #9).
// Pure functions — no React, no DOM, no network. The mock exam is a SECOND VIEW over
// the same card records as flashcards (story 33): a session walks the cards, records a
// self-graded response per question, and produces a score. Each response maps to an
// SM-2 quality grade so the SAME server-side review() drives scheduling from either
// view — this module never reimplements SM-2, it only chooses the grade.
import { describe, it, expect } from "vitest";
import {
  startSession,
  answerCurrent,
  advance,
  scoreOf,
  isComplete,
  RESPONSES,
  gradeForResponse,
  EXAM_DISCLAIMER,
} from "./examSession";

function card(over = {}) {
  return {
    id: "notes-0",
    question: "What comes after Approval?",
    answer: "Review",
    deck: "notes",
    boardId: "b1",
    sourceElementIds: ["boxA"],
    reviewState: { ease: 2.5, interval: 0, dueDate: null, lapses: 0, reps: 0 },
    ...over,
  };
}

describe("examSession", () => {
  it("starts a session over the same card records as flashcards (story 33)", () => {
    const cards = [card({ id: "a" }), card({ id: "b" })];
    const s = startSession(cards);
    expect(s.total).toBe(2);
    expect(s.index).toBe(0);
    expect(s.responses).toEqual([]);
    expect(isComplete(s)).toBe(false);
  });

  it("an empty deck yields a complete session with a zero score", () => {
    const s = startSession([]);
    expect(s.total).toBe(0);
    expect(isComplete(s)).toBe(true);
    expect(scoreOf(s).total).toBe(0);
    expect(scoreOf(s).percent).toBe(0);
  });

  it("records a self-graded response for the current question", () => {
    const s0 = startSession([card({ id: "a" }), card({ id: "b" })]);
    const s1 = answerCurrent(s0, RESPONSES.CORRECT);
    expect(s1.responses).toEqual([{ cardId: "a", response: RESPONSES.CORRECT }]);
    // The source session is not mutated (pure) — reducer-friendly for React state.
    expect(s0.responses).toEqual([]);
  });

  it("advances to the next question and completes at the end", () => {
    let s = startSession([card({ id: "a" }), card({ id: "b" })]);
    s = advance(answerCurrent(s, RESPONSES.CORRECT));
    expect(s.index).toBe(1);
    expect(isComplete(s)).toBe(false);
    s = advance(answerCurrent(s, RESPONSES.WRONG));
    expect(isComplete(s)).toBe(true);
  });

  it("scores correct responses out of the total, as a percent (story 33)", () => {
    let s = startSession([card({ id: "a" }), card({ id: "b" }), card({ id: "c" }), card({ id: "d" })]);
    s = advance(answerCurrent(s, RESPONSES.CORRECT));
    s = advance(answerCurrent(s, RESPONSES.CORRECT));
    s = advance(answerCurrent(s, RESPONSES.PARTIAL));
    s = advance(answerCurrent(s, RESPONSES.WRONG));
    const score = scoreOf(s);
    expect(score.total).toBe(4);
    expect(score.correct).toBe(2);
    expect(score.percent).toBe(50);
  });

  it("maps each self-graded response to an SM-2 quality grade (reuses server review())", () => {
    // "Wrong" is a lapse (grade < 3); "Correct"/"Partial" are passes of rising ease.
    // These are the same 0–5 quality values the server's review() consumes — the exam
    // view never reimplements scheduling, it only picks the grade.
    expect(gradeForResponse(RESPONSES.WRONG)).toBeLessThan(3);
    expect(gradeForResponse(RESPONSES.PARTIAL)).toBeGreaterThanOrEqual(3);
    expect(gradeForResponse(RESPONSES.CORRECT)).toBeGreaterThan(
      gradeForResponse(RESPONSES.PARTIAL)
    );
  });

  it("re-answering the current question overwrites, never appends", () => {
    let s = startSession([card({ id: "a" })]);
    s = answerCurrent(s, RESPONSES.WRONG);
    s = answerCurrent(s, RESPONSES.CORRECT);
    expect(s.responses).toEqual([{ cardId: "a", response: RESPONSES.CORRECT }]);
  });

  it("carries a plain disclaimer that it's from the user's notes, not a real exam (story 38)", () => {
    expect(EXAM_DISCLAIMER).toMatch(/your notes/i);
    expect(EXAM_DISCLAIMER).toMatch(/not.*real|not.*predict/i);
  });
});
