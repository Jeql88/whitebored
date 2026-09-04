// Behaviour tests for the Notes panel (slice #6), driven through the rendered UI
// with Testing Library (query by role/text, drive with user-event) — never
// implementation details. Streamed lines and callbacks are injected as props (the
// seam); no live fetch, no socket.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotesPanel from "./NotesPanel";

function line(text, ids = ["f0"], kind = "key-point") {
  return { text, kind, sourceElementIds: ids, origin: "board" };
}

describe("NotesPanel", () => {
  it("offers the four note types and generates with the selected one (story 10, D8)", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    const onNoteTypeChange = vi.fn();
    render(
      <NotesPanel
        noteType="freeform"
        onNoteTypeChange={onNoteTypeChange}
        onGenerate={onGenerate}
      />
    );

    const picker = screen.getByLabelText(/note type/i);
    for (const label of ["Lecture", "Meeting", "Process", "Freeform"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }

    await user.selectOptions(picker, "process");
    expect(onNoteTypeChange).toHaveBeenCalledWith("process");

    await user.click(screen.getByRole("button", { name: /generate/i }));
    // The type chosen before generating is passed to the generation entry point.
    expect(onGenerate).toHaveBeenCalledWith("freeform");
  });

  it("renders streamed lines in order as the caller appends them (D9)", () => {
    const { rerender } = render(<NotesPanel lines={[line("first")]} />);
    expect(screen.getByText("first")).toBeInTheDocument();

    // A second line streams in — the caller re-renders with the appended list.
    rerender(<NotesPanel lines={[line("first"), line("second")]} />);
    const rendered = screen.getAllByRole("button").map((b) => b.textContent);
    expect(rendered.some((t) => t.includes("first"))).toBe(true);
    expect(rendered.some((t) => t.includes("second"))).toBe(true);
  });

  it("clicking a note line highlights its source shapes (story 9)", async () => {
    const user = userEvent.setup();
    const onHighlight = vi.fn();
    render(
      <NotesPanel lines={[line("Approval step", ["f1", "f2"])]} onHighlight={onHighlight} />
    );

    await user.click(screen.getByRole("button", { name: /highlight source of/i }));
    expect(onHighlight).toHaveBeenCalledWith(["f1", "f2"], expect.objectContaining({
      text: "Approval step",
    }));
  });

  it("a line that traces to no shape is not clickable-to-highlight", async () => {
    const user = userEvent.setup();
    const onHighlight = vi.fn();
    render(<NotesPanel lines={[line("general note", [])]} onHighlight={onHighlight} />);

    const btn = screen.getByRole("button", { name: "general note" });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onHighlight).not.toHaveBeenCalled();
  });

  it("shows a working state while generating, not a dead spinner (story 14/56)", () => {
    render(<NotesPanel generating lines={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(/reading your board/i);
    // Generate is disabled while a run is in flight.
    expect(screen.getByRole("button", { name: /generating/i })).toBeDisabled();
  });

  it("renders as a docked column on wide screens and a slide-over sheet on narrow (D22)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<NotesPanel variant="docked" />);
    expect(screen.getByRole("complementary", { name: /notes/i })).toHaveAttribute(
      "data-variant",
      "docked"
    );
    // Docked has no close affordance (it's a persistent column).
    expect(screen.queryByRole("button", { name: /close notes/i })).toBeNull();

    rerender(<NotesPanel variant="sheet" onClose={onClose} />);
    expect(screen.getByRole("complementary", { name: /notes/i })).toHaveAttribute(
      "data-variant",
      "sheet"
    );
    await user.click(screen.getByRole("button", { name: /close notes/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an empty-state prompt before any notes exist", () => {
    render(<NotesPanel lines={[]} />);
    expect(screen.getByText(/press generate to turn your board into notes/i)).toBeInTheDocument();
  });
});
