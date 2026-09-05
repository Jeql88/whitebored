// Behaviour tests for the MockExam view (slice #9, D17/D22), driven through the
// rendered UI with Testing Library (query by role/text, drive with user-event). The
// exam is a SECOND VIEW over the SAME card records as flashcards (story 33): cards and
// callbacks are injected as props (the seam) — no live fetch, no socket, no model.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockExam from "./MockExam";

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

describe("MockExam", () => {
  it("renders questions from the same card records as flashcards (story 33)", () => {
    render(<MockExam cards={[card()]} />);
    expect(screen.getByText("What comes after Approval?")).toBeInTheDocument();
    expect(screen.getByText(/question 1 of 1/i)).toBeInTheDocument();
  });

  it("carries a plain disclaimer that it's from the user's notes, not a real exam (story 38)", () => {
    render(<MockExam cards={[card()]} />);
    expect(
      screen.getByText(/generated from your notes/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/not a prediction of a real exam/i)).toBeInTheDocument();
  });

  it("hides the answer until the user reveals it (recall before you see it)", async () => {
    const user = userEvent.setup();
    render(<MockExam cards={[card()]} />);
    expect(screen.queryByText("Review")).toBeNull();
    await user.click(screen.getByRole("button", { name: /reveal answer/i }));
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("grading a response drives SM-2 via the same onGrade seam as flashcards (story 39)", async () => {
    const user = userEvent.setup();
    const onGrade = vi.fn();
    const c = card();
    render(<MockExam cards={[c]} onGrade={onGrade} />);

    await user.click(screen.getByRole("button", { name: /reveal answer/i }));
    // "Correct" maps to SM-2 quality 5 (a strong pass); "I got it wrong" to 1 (a lapse).
    await user.click(screen.getByRole("button", { name: /^correct/i }));
    expect(onGrade).toHaveBeenCalledWith(c, 5);
  });

  it("walks through the exam and shows a score at the end (story 33)", async () => {
    const user = userEvent.setup();
    render(<MockExam cards={[card({ id: "a", question: "Q one", answer: "A one" }), card({ id: "b", question: "Q two", answer: "A two" })]} />);

    await user.click(screen.getByRole("button", { name: /reveal answer/i }));
    await user.click(screen.getByRole("button", { name: /^correct/i }));
    // Advances to the second question.
    expect(screen.getByText("Q two")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reveal answer/i }));
    await user.click(screen.getByRole("button", { name: /got it wrong/i }));

    // Result screen: 1 of 2 correct.
    expect(screen.getByText(/1 of 2/i)).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("links a question back to its source shape on the board (story 36)", async () => {
    const user = userEvent.setup();
    const onRevealSource = vi.fn();
    render(<MockExam cards={[card()]} onRevealSource={onRevealSource} />);
    await user.click(screen.getByRole("button", { name: /show on board/i }));
    expect(onRevealSource).toHaveBeenCalledWith(
      ["boxA"],
      expect.objectContaining({ question: "What comes after Approval?" })
    );
  });

  it("shows an empty state when there are no cards", () => {
    render(<MockExam cards={[]} />);
    expect(screen.getByText(/no cards to examine/i)).toBeInTheDocument();
  });
});
