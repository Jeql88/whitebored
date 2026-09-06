import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudioSidebar from "./StudioSidebar";

// The sidebar owns tab selection and shared chrome; the panels inside it are
// already covered by their own tests. So we assert what THIS component decides:
// one region, which panel is showing, and that the scope bar follows the tabs
// that actually generate study material.

const scope = {
  source: "notes",
  range: { kind: "all" },
  count: 10,
  difficulty: "mixed",
  format: "flashcards",
};

function renderSidebar(props = {}) {
  return render(
    <StudioSidebar
      activeTab="notes"
      onTabChange={() => {}}
      notesLines={[]}
      messages={[]}
      documents={[]}
      flags={[]}
      {...props}
    />
  );
}

describe("StudioSidebar", () => {
  it("is a single labelled region with a tab for each tool", () => {
    renderSidebar();

    expect(screen.getByRole("complementary", { name: /study tools/i })).toBeInTheDocument();
    // Three destinations. Fact-check and coverage are properties of the notes,
    // not places to go, so they render inside the notes document instead.
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Notes", "Chat", "Documents"]);
  });

  it("shows only the active tab's panel, so the tools never fight for the same space", () => {
    renderSidebar({ activeTab: "documents" });

    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /documents/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /notes/i })).toHaveAttribute("aria-selected", "false");
    // The notes panel is not merely hidden — it is not rendered at all.
    expect(screen.queryByRole("complementary", { name: /^notes$/i })).not.toBeInTheDocument();
  });

  it("reports the selected tab when another is clicked", async () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });

    await userEvent.click(screen.getByRole("tab", { name: /documents/i }));

    expect(onTabChange).toHaveBeenCalledWith("documents");
  });

  it("shows the scope bar on the tabs that generate study material", () => {
    renderSidebar({ activeTab: "notes", scope });
    expect(screen.getByRole("region", { name: /scope/i })).toBeInTheDocument();
  });

  it("hides the scope bar on tabs that only read, so it cannot mislead", () => {
    renderSidebar({ activeTab: "documents", scope });
    expect(screen.queryByRole("region", { name: /scope/i })).not.toBeInTheDocument();
  });

  it("closes from the header control", async () => {
    const onClose = vi.fn();
    renderSidebar({ onClose });

    await userEvent.click(screen.getByRole("button", { name: /close study tools/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape, the convention for an overlay surface", async () => {
    const onClose = vi.fn();
    renderSidebar({ onClose });

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});

// The Notes tab is one action, not a pipeline the user has to drive (D3 intact).
// The review step is an INTERRUPTION that appears only when the AI was unsure —
// so a clean board goes from one click straight to notes, and a board with gaps
// still cannot produce notes until the user fixes them.
describe("StudioSidebar — notes in one action", () => {
  const artifact = (hasUnclear) => ({
    phase: "transcription",
    hasUnclear,
    entries: [
      {
        cropId: "c1",
        segments: [
          { text: "Mitosis has four phases", uncertain: false },
          ...(hasUnclear ? [{ text: "", uncertain: true }] : []),
        ],
        sourceElementIds: ["s1"],
        bbox: { x: 0, y: 0, width: 10, height: 10 },
      },
    ],
  });

  it("offers a single Generate notes action before anything exists", () => {
    renderSidebar({ activeTab: "notes" });

    expect(screen.getByRole("button", { name: /generate notes/i })).toBeInTheDocument();
    // No separate "read the board" step to click first.
    expect(screen.queryByRole("button", { name: /^read the board$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /transcription review/i })).not.toBeInTheDocument();
  });

  it("runs the whole pipeline from that one button", async () => {
    const onGenerateNotes = vi.fn();
    renderSidebar({ activeTab: "notes", onGenerateNotes });

    await userEvent.click(screen.getByRole("button", { name: /generate notes/i }));

    expect(onGenerateNotes).toHaveBeenCalled();
  });

  it("interrupts with the review ONLY when the read left gaps", () => {
    renderSidebar({ activeTab: "notes", transcript: artifact(true), transcriptConfirmed: false });

    expect(screen.getByRole("region", { name: /transcription review/i })).toBeInTheDocument();
    // Notes are not written from text the user has not corrected.
    expect(screen.queryByRole("article", { name: /notes/i })).not.toBeInTheDocument();
  });

  it("does not interrupt when the read was clean — notes are what shows", () => {
    renderSidebar({
      activeTab: "notes",
      transcript: artifact(false),
      transcriptConfirmed: true,
      notesLines: [{ text: "Mitosis has four phases", kind: "key-point", sourceElementIds: ["s1"], origin: "board" }],
    });

    expect(screen.queryByRole("region", { name: /transcription review/i })).not.toBeInTheDocument();
    // The notes render as a document, not a panel-with-a-header.
    expect(screen.getByRole("article", { name: /notes/i })).toBeInTheDocument();
    expect(screen.getByText(/Mitosis has four phases/)).toBeInTheDocument();
  });

  it("offers a re-read once notes exist, so a changed board can be picked up", async () => {
    const onReread = vi.fn();
    renderSidebar({
      activeTab: "notes",
      notesLines: [{ text: "a line", kind: "key-point", sourceElementIds: ["s1"], origin: "board" }],
      onReread,
    });

    await userEvent.click(screen.getByRole("button", { name: /re-read board/i }));

    expect(onReread).toHaveBeenCalled();
  });

  it("shows progress on the action itself rather than a separate spinner", () => {
    renderSidebar({ activeTab: "notes", transcribing: true });
    expect(screen.getByRole("button", { name: /reading your board/i })).toBeDisabled();
  });
});

// The panels were written to stand alone: in "docked" mode each carries its own
// w-80 width and left border. Nested inside the sidebar that produced a fixed,
// under-wide child with a spurious inner border. They render "embedded" here —
// content only — so the sidebar owns the frame.
describe("StudioSidebar — embedded panel chrome", () => {
  it("renders its panels without their own width or border", () => {
    renderSidebar({ activeTab: "chat" });

    const panel = screen.getByRole("complementary", { name: /ai chat/i });
    expect(panel).toHaveAttribute("data-variant", "embedded");
    // The sidebar sets the width; a nested w-80 would under-fill it.
    expect(panel.className).not.toMatch(/\bw-80\b/);
    expect(panel.className).not.toMatch(/\bborder-l\b/);
    expect(panel.className).toMatch(/\bw-full\b/);
  });

  it("still gives each panel its own accessible name, so the tools stay distinguishable", () => {
    renderSidebar({ activeTab: "documents" });
    expect(screen.getByRole("complementary", { name: /documents/i })).toBeInTheDocument();
  });
});
