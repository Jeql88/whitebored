// Behaviour tests for the AI Chat panel (slice #13, D10/D11), driven through the
// rendered UI with Testing Library (query by role/text, drive with user-event) —
// never implementation details. Messages and callbacks are injected as props (the
// seam): no live socket, no model. The panel just renders the conversation and its
// provenance tags, and reports a sent question through onSend.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPanel from "./ChatPanel";

function boardMsg(over = {}) {
  return {
    role: "assistant",
    text: "Approval comes before review.",
    source: { bucket: "board", label: "from your board", addableToNotes: true },
    ...over,
  };
}

function docMsg(over = {}) {
  return {
    role: "assistant",
    text: "Mitochondria are the powerhouse of the cell.",
    source: {
      bucket: "document",
      label: "from biology.pdf, p.3",
      docId: "doc1",
      page: 3,
      addableToNotes: true,
    },
    ...over,
  };
}

function generalMsg(over = {}) {
  return {
    role: "assistant",
    text: "Photosynthesis converts light into sugar.",
    source: { bucket: "general", label: "general knowledge", addableToNotes: false },
    ...over,
  };
}

describe("ChatPanel", () => {
  it("renders a board answer with its 'from your board' provenance tag (story 17)", () => {
    render(<ChatPanel messages={[boardMsg()]} />);
    expect(screen.getByText("Approval comes before review.")).toBeInTheDocument();
    expect(screen.getByText("from your board")).toBeInTheDocument();
  });

  it("renders a document answer with its 'from [doc], p.N' tag (story 17)", () => {
    render(<ChatPanel messages={[docMsg()]} />);
    expect(screen.getByText("from biology.pdf, p.3")).toBeInTheDocument();
  });

  it("marks the general-knowledge tag as visually distinct (story 18, D11)", () => {
    render(<ChatPanel messages={[generalMsg()]} />);
    const tag = screen.getByText("general knowledge");
    // The distinct styling is signalled by a data attribute the test can assert on
    // without coupling to exact classes — the general bucket must be marked apart.
    expect(tag).toHaveAttribute("data-bucket", "general");
  });

  it("tags each bucket with its own data-bucket so the three are distinguishable", () => {
    render(
      <ChatPanel messages={[boardMsg(), docMsg(), generalMsg()]} />
    );
    expect(screen.getByText("from your board")).toHaveAttribute("data-bucket", "board");
    expect(screen.getByText("from biology.pdf, p.3")).toHaveAttribute("data-bucket", "document");
    expect(screen.getByText("general knowledge")).toHaveAttribute("data-bucket", "general");
  });

  it("sends a typed question through onSend and clears the input (story 16)", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} />);

    const input = screen.getByPlaceholderText(/ask/i);
    await user.type(input, "What is the order?");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith("What is the order?");
    expect(input).toHaveValue("");
  });

  it("does not send a blank question", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} />);

    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows a working state while an answer is pending (story 56)", () => {
    render(<ChatPanel messages={[]} pending />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the user's own questions in the transcript", () => {
    render(
      <ChatPanel
        messages={[{ role: "user", text: "What is the order?" }, boardMsg()]}
      />
    );
    expect(screen.getByText("What is the order?")).toBeInTheDocument();
    expect(screen.getByText("Approval comes before review.")).toBeInTheDocument();
  });

  it("offers Add to notes only on board/document answers, never general (story 19)", async () => {
    const user = userEvent.setup();
    const onAddToNotes = vi.fn();
    render(
      <ChatPanel
        messages={[boardMsg(), generalMsg()]}
        onAddToNotes={onAddToNotes}
      />
    );

    // Exactly one addable answer here (the board one) → exactly one add button.
    const addButtons = screen.getAllByRole("button", { name: /add to notes/i });
    expect(addButtons).toHaveLength(1);

    await user.click(addButtons[0]);
    expect(onAddToNotes).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Approval comes before review." })
    );
  });
});
