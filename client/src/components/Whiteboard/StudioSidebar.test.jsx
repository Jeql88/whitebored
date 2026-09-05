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
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Notes",
      "Chat",
      "Documents",
      "Fact-check",
      "Coverage",
    ]);
  });

  it("shows only the active tab's panel, so the tools never fight for the same space", () => {
    renderSidebar({ activeTab: "documents" });

    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /documents/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /notes/i })).toHaveAttribute("aria-selected", "false");
    // The notes panel is not merely hidden — it is not rendered at all.
    expect(screen.queryByRole("region", { name: /^notes$/i })).not.toBeInTheDocument();
  });

  it("reports the selected tab when another is clicked", async () => {
    const onTabChange = vi.fn();
    renderSidebar({ onTabChange });

    await userEvent.click(screen.getByRole("tab", { name: /coverage/i }));

    expect(onTabChange).toHaveBeenCalledWith("coverage");
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
