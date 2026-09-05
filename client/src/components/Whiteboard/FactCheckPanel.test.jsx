// Behaviour tests for the FactCheckPanel (slice #15, D15), driven through the
// rendered UI with Testing Library — never implementation details. Flags and
// callbacks are injected as props (the seam); no live fetch, no socket, no model.
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FactCheckPanel from "./FactCheckPanel";

// The server flag shape (server/factcheck).
function flag(over = {}) {
  return {
    id: "flag-0",
    boardClaim: "Mitochondria make proteins",
    sourceClaim: "Mitochondria produce ATP",
    citation: { docId: "d1", page: 3 },
    severity: "high",
    status: "open",
    ...over,
  };
}

describe("FactCheckPanel", () => {
  it("shows an open flag's board claim, source claim and severity (stories 26/27)", () => {
    render(<FactCheckPanel flags={[flag()]} />);
    expect(screen.getByText(/mitochondria make proteins/i)).toBeInTheDocument();
    expect(screen.getByText(/mitochondria produce atp/i)).toBeInTheDocument();
    expect(screen.getByText(/high/i)).toBeInTheDocument();
  });

  it("clicking the citation jumps to that page in the document (story 24)", async () => {
    const user = userEvent.setup();
    const onCitationClick = vi.fn();
    render(<FactCheckPanel flags={[flag()]} onCitationClick={onCitationClick} />);

    await user.click(screen.getByRole("button", { name: /p\.?\s*3/i }));
    expect(onCitationClick).toHaveBeenCalledWith({ docId: "d1", page: 3 });
  });

  it("Dismiss calls onDismiss with the flag (story 28)", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const f = flag();
    render(<FactCheckPanel flags={[f]} onDismiss={onDismiss} />);

    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith(f);
  });

  it("Accept calls onAccept with the flag and never edits anything itself (story 28)", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const f = flag();
    render(<FactCheckPanel flags={[f]} onAccept={onAccept} />);

    await user.click(screen.getByRole("button", { name: /^accept/i }));
    // The panel only reports the intent — the caller performs Accept server-side and
    // surfaces the edit offer. The panel itself mutates nothing.
    expect(onAccept).toHaveBeenCalledWith(f);
  });

  it("surfaces a pending edit OFFER for the user to confirm or decline (story 28)", async () => {
    const user = userEvent.setup();
    const onConfirmEdit = vi.fn();
    const onDeclineEdit = vi.fn();
    // The caller, after Accept, hands back the offer the server produced.
    const pendingEdit = {
      flagId: "flag-0",
      lineIndex: 0,
      currentText: "Mitochondria make proteins",
      suggestedText: "Mitochondria produce ATP",
    };
    render(
      <FactCheckPanel
        flags={[flag()]}
        pendingEdit={pendingEdit}
        onConfirmEdit={onConfirmEdit}
        onDeclineEdit={onDeclineEdit}
      />
    );

    // The offer shows both the current line and the proposed replacement — the user
    // decides; nothing has been applied.
    expect(screen.getByText(/edit this note line\?/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /apply edit/i }));
    expect(onConfirmEdit).toHaveBeenCalledWith(pendingEdit);
    expect(onDeclineEdit).not.toHaveBeenCalled();
  });

  it("declining the edit offer leaves the note line unchanged (story 28)", async () => {
    const user = userEvent.setup();
    const onDeclineEdit = vi.fn();
    const pendingEdit = {
      flagId: "flag-0",
      lineIndex: 0,
      currentText: "Mitochondria make proteins",
      suggestedText: "Mitochondria produce ATP",
    };
    render(
      <FactCheckPanel
        flags={[flag()]}
        pendingEdit={pendingEdit}
        onDeclineEdit={onDeclineEdit}
      />
    );

    await user.click(screen.getByRole("button", { name: /keep my note/i }));
    expect(onDeclineEdit).toHaveBeenCalledWith(pendingEdit);
  });

  it("shows only OPEN flags — a dismissed flag is not re-nagged (story 29)", () => {
    render(
      <FactCheckPanel
        flags={[
          flag({ id: "a", boardClaim: "Open claim", status: "open" }),
          flag({ id: "b", boardClaim: "Dismissed claim", status: "dismissed" }),
          flag({ id: "c", boardClaim: "Accepted claim", status: "accepted" }),
        ]}
      />
    );
    expect(screen.getByText(/open claim/i)).toBeInTheDocument();
    expect(screen.queryByText(/dismissed claim/i)).toBeNull();
    expect(screen.queryByText(/accepted claim/i)).toBeNull();
  });

  it("shows an all-clear empty state when there are no open flags", () => {
    render(<FactCheckPanel flags={[flag({ status: "dismissed" })]} />);
    expect(screen.getByText(/no contradictions/i)).toBeInTheDocument();
  });

  it("renders as a docked column on wide screens and a slide-over sheet on narrow (D22)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<FactCheckPanel flags={[flag()]} variant="docked" />);
    expect(
      screen.getByRole("complementary", { name: /fact.?check/i })
    ).toHaveAttribute("data-variant", "docked");
    expect(screen.queryByRole("button", { name: /close fact.?check/i })).toBeNull();

    rerender(<FactCheckPanel flags={[flag()]} variant="sheet" onClose={onClose} />);
    expect(
      screen.getByRole("complementary", { name: /fact.?check/i })
    ).toHaveAttribute("data-variant", "sheet");
    await user.click(screen.getByRole("button", { name: /close fact.?check/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("each flag exposes both Accept and Dismiss controls", () => {
    render(<FactCheckPanel flags={[flag()]} />);
    const item = screen.getByRole("listitem");
    expect(within(item).getByRole("button", { name: /^accept/i })).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });
});
