// Behaviour tests for the Flashcards view (slice #8), driven through the rendered UI
// with Testing Library (query by role/text, drive with user-event) — never
// implementation details. Cards and callbacks are injected as props (the seam); no
// live fetch, no socket, no model.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Flashcards from "./Flashcards";

function card(over = {}) {
  return {
    id: "notes-0",
    question: "What comes after Approval?",
    answer: "Review",
    deck: "notes",
    boardId: "b1",
    sourceElementIds: ["boxA", "boxB"],
    reviewState: { ease: 2.5, interval: 0, dueDate: null, lapses: 0, reps: 0 },
    ...over,
  };
}

describe("Flashcards", () => {
  it("shows the question and reveals the answer only after Show answer (story 39)", async () => {
    const user = userEvent.setup();
    render(<Flashcards cards={[card()]} />);

    expect(screen.getByText("What comes after Approval?")).toBeInTheDocument();
    // Answer is hidden until the card is flipped — recall before you see it.
    expect(screen.queryByText("Review")).toBeNull();

    await user.click(screen.getByRole("button", { name: /show answer/i }));
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("links each card back to its source shape on the board (story 36)", async () => {
    const user = userEvent.setup();
    const onRevealSource = vi.fn();
    render(<Flashcards cards={[card()]} onRevealSource={onRevealSource} />);

    await user.click(screen.getByRole("button", { name: /show on board/i }));
    expect(onRevealSource).toHaveBeenCalledWith(
      ["boxA", "boxB"],
      expect.objectContaining({ question: "What comes after Approval?" })
    );
  });

  it("a card that traces to no shape offers no board link", () => {
    render(<Flashcards cards={[card({ sourceElementIds: [] })]} />);
    expect(screen.queryByRole("button", { name: /show on board/i })).toBeNull();
  });

  it("grading a revealed card drives SM-2 with the chosen quality (story 39)", async () => {
    const user = userEvent.setup();
    const onGrade = vi.fn();
    const c = card();
    render(<Flashcards cards={[c]} onGrade={onGrade} />);

    // Grade buttons appear only once the answer is shown (you grade your recall).
    expect(screen.queryByRole("button", { name: /again/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: /show answer/i }));

    await user.click(screen.getByRole("button", { name: /again/i }));
    // "Again" is a lapse in SM-2 terms (grade < 3).
    expect(onGrade).toHaveBeenCalledWith(c, 1);

    await user.click(screen.getByRole("button", { name: /easy/i }));
    expect(onGrade).toHaveBeenCalledWith(c, 5);
  });

  it("badges a relationship card as coming from the diagram (story 37)", () => {
    render(<Flashcards cards={[card({ relationship: true })]} />);
    expect(screen.getByText(/from your diagram/i)).toBeInTheDocument();
  });

  it("does not badge a plain fact card", () => {
    render(<Flashcards cards={[card({ relationship: false })]} />);
    expect(screen.queryByText(/from your diagram/i)).toBeNull();
  });

  it("shows the position in the deck and the requested card (controlled index)", () => {
    const cards = [card({ question: "Q one" }), card({ question: "Q two" })];
    render(<Flashcards cards={cards} index={1} />);
    expect(screen.getByText("Q two")).toBeInTheDocument();
    expect(screen.getByText(/card 2 of 2/i)).toBeInTheDocument();
  });

  it("renders as a docked column on wide screens and a slide-over sheet on narrow (D22)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<Flashcards cards={[card()]} variant="docked" />);
    expect(screen.getByRole("complementary", { name: /flashcards/i })).toHaveAttribute(
      "data-variant",
      "docked"
    );
    expect(screen.queryByRole("button", { name: /close flashcards/i })).toBeNull();

    rerender(<Flashcards cards={[card()]} variant="sheet" onClose={onClose} />);
    expect(screen.getByRole("complementary", { name: /flashcards/i })).toHaveAttribute(
      "data-variant",
      "sheet"
    );
    await user.click(screen.getByRole("button", { name: /close flashcards/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an empty state when there are no cards", () => {
    render(<Flashcards cards={[]} />);
    expect(screen.getByText(/no flashcards yet/i)).toBeInTheDocument();
  });
});
