import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotesDocument from "./NotesDocument";

const line = (text, kind = "key-point", sourceElementIds = ["s1"]) => ({
  text,
  kind,
  sourceElementIds,
  origin: "board",
});

describe("NotesDocument", () => {
  it("renders a heading as a heading, not as a labelled row", () => {
    render(<NotesDocument lines={[line("Cell Division", "heading", [])]} />);

    // A reader should see document structure; "Heading:" as a caption on every
    // row is what made the old output read as chips rather than notes.
    expect(screen.getByRole("heading", { name: "Cell Division" })).toBeInTheDocument();
    expect(screen.queryByText(/^Heading$/)).not.toBeInTheDocument();
  });

  it("numbers sequence steps in order, restarting under a new heading", () => {
    render(
      <NotesDocument
        lines={[
          line("Prepare", "sequence-step"),
          line("Submit", "sequence-step"),
          line("Next Section", "heading", []),
          line("Review", "sequence-step"),
        ]}
      />
    );

    expect(screen.getByText("2")).toBeInTheDocument();
    // The count restarts under a new heading, so a second list does not continue
    // from the first — hence two "1"s and no "3".
    expect(screen.getAllByText("1")).toHaveLength(2);
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });

  it("renders inline markdown as formatting, never as literal characters", () => {
    render(<NotesDocument lines={[line("Mitosis has **four** phases")]} />);

    expect(screen.getByText("four").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("makes a line with source shapes clickable to highlight", async () => {
    const onHighlight = vi.fn();
    render(<NotesDocument lines={[line("Traceable point")]} onHighlight={onHighlight} />);

    await userEvent.click(screen.getByRole("button", { name: /traceable point/i }));

    expect(onHighlight).toHaveBeenCalledWith(["s1"], expect.objectContaining({ text: "Traceable point" }));
  });

  it("does not offer highlight on a line with no source shapes", () => {
    render(<NotesDocument lines={[line("From a document", "key-point", [])]} />);
    expect(screen.queryByRole("button", { name: /from a document/i })).not.toBeInTheDocument();
  });

  it("shows a fact-check flag beside the claim it contradicts", () => {
    render(
      <NotesDocument
        lines={[line("Mitosis has five phases")]}
        flags={[
          {
            id: "f1",
            boardClaim: "Mitosis has five phases",
            sourceClaim: "Mitosis has four phases",
            citation: { docId: "d1", page: 7 },
            status: "open",
          },
        ]}
      />
    );

    // Inline, not in a separate tab the reader has to go find.
    expect(screen.getByText(/Mitosis has four phases/)).toBeInTheDocument();
    expect(screen.getByText(/p\.7/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });

  it("never shows a dismissed flag", () => {
    render(
      <NotesDocument
        lines={[line("A claim")]}
        flags={[{ id: "f1", boardClaim: "A claim", sourceClaim: "Contradiction", status: "dismissed" }]}
      />
    );
    expect(screen.queryByText(/Contradiction/)).not.toBeInTheDocument();
  });

  it("still surfaces a flag whose line cannot be matched, rather than dropping it", () => {
    render(
      <NotesDocument
        lines={[line("Something else")]}
        flags={[{ id: "f1", boardClaim: "not present anywhere", sourceClaim: "Orphan flag", status: "open" }]}
      />
    );
    expect(screen.getByText(/Orphan flag/)).toBeInTheDocument();
  });

  it("closes with coverage gaps, which are surfaced but never auto-added", async () => {
    const onCitationClick = vi.fn();
    render(
      <NotesDocument
        lines={[line("A point")]}
        gaps={[{ id: "t1", label: "Meiosis", pageStart: 12, docId: "d1" }]}
        onCitationClick={onCitationClick}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /meiosis/i }));

    expect(onCitationClick).toHaveBeenCalledWith({ docId: "d1", page: 12 });
    // Surfaced as a gap — there is deliberately no control to add it to the notes.
    expect(screen.queryByRole("button", { name: /add to notes/i })).not.toBeInTheDocument();
  });
});
