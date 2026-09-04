// Behaviour tests for the Phase-1 transcription review UI (slice #4), driven
// through the rendered UI with Testing Library (query by role/text, drive with
// user-event) — never implementation details. The artifact and callbacks are
// injected as props (the seam); no live fetch, no network.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TranscriptionReview from "./TranscriptionReview";

function makeArtifact(overrides = {}) {
  return {
    phase: "transcription",
    hasUnclear: false,
    entries: [
      {
        cropId: "c1",
        segments: [{ text: "helllo", uncertain: false }],
        sourceElementIds: ["f1"],
        bbox: { x: 0, y: 0, width: 10, height: 10 },
      },
      {
        cropId: "c2",
        segments: [{ text: "world", uncertain: false }],
        sourceElementIds: ["f2"],
        bbox: { x: 0, y: 0, width: 10, height: 10 },
      },
    ],
    ...overrides,
  };
}

function withGap() {
  return {
    phase: "transcription",
    hasUnclear: true,
    entries: [
      {
        cropId: "c1",
        segments: [
          { text: "hello", uncertain: false },
          { text: "", uncertain: true },
        ],
        sourceElementIds: ["f1"],
        bbox: { x: 0, y: 0, width: 10, height: 10 },
      },
    ],
  };
}

describe("TranscriptionReview", () => {
  it("shows the transcription for review (each read segment is present) before notes", () => {
    render(<TranscriptionReview artifact={makeArtifact()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("region", { name: /transcription review/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("helllo")).toBeInTheDocument();
    expect(screen.getByDisplayValue("world")).toBeInTheDocument();
  });

  it("corrects a wrong word inline and emits the corrected artifact", async () => {
    const user = userEvent.setup();
    const onCorrect = vi.fn();
    render(
      <TranscriptionReview artifact={makeArtifact()} onConfirm={vi.fn()} onCorrect={onCorrect} />
    );

    const field = screen.getByDisplayValue("helllo");
    await user.clear(field);
    await user.type(field, "hello");

    const last = onCorrect.mock.calls.at(-1)[0];
    expect(last.entries[0].segments[0].text).toBe("hello");
  });

  it("lets the user tap an [unclear] gap and fill it, which clears the gap", async () => {
    const user = userEvent.setup();
    const onCorrect = vi.fn();
    render(
      <TranscriptionReview artifact={withGap()} onConfirm={vi.fn()} onCorrect={onCorrect} />
    );

    // The gap is shown as a tappable [unclear] control, not silently filled.
    const gap = screen.getByRole("button", { name: /\[unclear\]/i });
    await user.click(gap);

    const input = screen.getByLabelText(/fill unclear segment/i);
    await user.type(input, "again");

    const last = onCorrect.mock.calls.at(-1)[0];
    expect(last.entries[0].segments[1]).toEqual({ text: "again", uncertain: false });
    expect(last.hasUnclear).toBe(false);
  });

  it("blocks notes generation until every gap is filled (gate)", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<TranscriptionReview artifact={withGap()} onConfirm={onConfirm} />);

    const confirm = screen.getByRole("button", { name: /confirm & generate notes/i });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    // Fill the gap → gate opens.
    await user.click(screen.getByRole("button", { name: /\[unclear\]/i }));
    await user.type(screen.getByLabelText(/fill unclear segment/i), "again");

    expect(confirm).toBeEnabled();
  });

  it("confirming emits the corrected, structured artifact for Phase 2", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<TranscriptionReview artifact={makeArtifact()} onConfirm={onConfirm} />);

    await user.clear(screen.getByDisplayValue("helllo"));
    await user.type(screen.getByDisplayValue(""), "hello");
    await user.click(screen.getByRole("button", { name: /confirm & generate notes/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const emitted = onConfirm.mock.calls[0][0];
    expect(emitted.phase).toBe("transcription");
    expect(emitted.entries[0].segments[0].text).toBe("hello");
    // structured segments preserved, not flattened to a string
    expect(Array.isArray(emitted.entries[0].segments)).toBe(true);
    expect(emitted.entries[0].sourceElementIds).toEqual(["f1"]);
  });

  it("never triggers stroke deletion (no destructive callback exists / is called)", async () => {
    const user = userEvent.setup();
    const onDeleteStrokes = vi.fn(); // component takes no such prop; prove none fires
    const { container } = render(
      <TranscriptionReview
        artifact={makeArtifact()}
        onConfirm={vi.fn()}
        onDeleteStrokes={onDeleteStrokes}
      />
    );

    await user.clear(screen.getByDisplayValue("helllo"));
    await user.type(screen.getByDisplayValue(""), "hello");
    await user.click(screen.getByRole("button", { name: /confirm & generate notes/i }));

    expect(onDeleteStrokes).not.toHaveBeenCalled();
    // No delete/remove affordance is rendered in the review UI.
    expect(container.textContent).not.toMatch(/delete|remove strokes/i);
  });
});
