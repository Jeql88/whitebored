// Behaviour tests for the full-screen StudyView (slice #9, D22/story 41). This is the
// dedicated full-screen study surface — NOT a cramped side tab — hosting the two views
// (flashcards + mock exam) over the SAME card data (story 33). Prop-driven: cards and
// callbacks are injected (the seam); no live fetch, no socket, no model. The route
// container (StudyRoute) wires the real fetch on top of this presentational shell.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudyView from "./StudyView";

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

describe("StudyView", () => {
  it("opens on flashcards and switches to the mock exam over the same cards (stories 33, 41)", async () => {
    const user = userEvent.setup();
    render(<StudyView cards={[card()]} />);

    // Flashcards view first (the deck's first card is shown).
    expect(screen.getByRole("complementary", { name: /flashcards/i })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /mock exam/i }));
    // Same card, now in the exam view (a second view over one data model).
    expect(screen.getByRole("region", { name: /mock exam/i })).toBeInTheDocument();
    expect(screen.getByText("What comes after Approval?")).toBeInTheDocument();
  });

  it("supports the 'my notes only' source selection (story 34, notes-only portion)", () => {
    render(<StudyView cards={[card()]} />);
    // The source control shows notes-only as selected — this slice is notes-only; the
    // notes+documents decks arrive with the documents/scope slices.
    const source = screen.getByRole("group", { name: /source/i });
    expect(source).toHaveTextContent(/my notes only/i);
  });

  it("advances the flashcards deck with Next (controlled index lives here)", async () => {
    const user = userEvent.setup();
    render(
      <StudyView
        cards={[card({ id: "a", question: "Q one" }), card({ id: "b", question: "Q two" })]}
      />
    );
    expect(screen.getByText("Q one")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Q two")).toBeInTheDocument();
  });

  it("passes grading through to the caller so SM-2 runs server-side (story 39)", async () => {
    const user = userEvent.setup();
    const onGrade = vi.fn();
    const c = card();
    render(<StudyView cards={[c]} onGrade={onGrade} />);
    await user.click(screen.getByRole("button", { name: /show answer/i }));
    await user.click(screen.getByRole("button", { name: /easy/i }));
    expect(onGrade).toHaveBeenCalledWith(c, 5);
  });

  it("exposes an exit affordance back to the board (full-screen route, story 41)", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<StudyView cards={[card()]} onExit={onExit} />);
    await user.click(screen.getByRole("button", { name: /back to board|exit/i }));
    expect(onExit).toHaveBeenCalled();
  });

  it("shows an empty state when the board has no cards", () => {
    render(<StudyView cards={[]} />);
    expect(screen.getByText(/no flashcards yet/i)).toBeInTheDocument();
  });
});
