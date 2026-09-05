// Behaviour tests for the CoveragePanel (slice #16, D16), driven through the rendered
// UI with Testing Library — never implementation details. Topics + callbacks are
// injected as props (the seam); no live fetch, no socket, no model.
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CoveragePanel from "./CoveragePanel";

// The server coverage-report shape (server/coverage).
function report(over = {}) {
  return {
    boardId: "b1",
    total: 3,
    coveredCount: 1,
    gapCount: 2,
    topics: [
      { id: "topic-a", label: "Cell structure", pageStart: 1, pageEnd: 1, status: "covered" },
      { id: "topic-b", label: "Mitochondria and ATP", pageStart: 2, pageEnd: 2, status: "gap" },
      { id: "topic-c", label: "Photosynthesis", pageStart: 3, pageEnd: 4, status: "gap" },
    ],
    ...over,
  };
}

describe("CoveragePanel", () => {
  it("shows the stable N-topics denominator as covered / total (story 31)", () => {
    render(<CoveragePanel report={report()} />);
    // 1 of 3 topics covered — the trustworthy count is visible.
    expect(screen.getByText(/1\s*\/\s*3/)).toBeInTheDocument();
  });

  it("lists every topic with its coverage status (story 30)", () => {
    render(<CoveragePanel report={report()} />);
    expect(screen.getByText(/cell structure/i)).toBeInTheDocument();
    expect(screen.getByText(/mitochondria and atp/i)).toBeInTheDocument();
    expect(screen.getByText(/photosynthesis/i)).toBeInTheDocument();
  });

  it("a gap cites its page range and deep-links to it (stories 24/30)", async () => {
    const user = userEvent.setup();
    const onCitationClick = vi.fn();
    render(<CoveragePanel report={report()} onCitationClick={onCitationClick} />);

    // The single-page gap deep-links to page 2.
    await user.click(screen.getByRole("button", { name: /p\.?\s*2/i }));
    expect(onCitationClick).toHaveBeenCalledWith({ docId: undefined, page: 2 });
  });

  it("shows a page RANGE for a multi-page gap", () => {
    render(<CoveragePanel report={report()} />);
    // topic-c spans pages 3–4.
    expect(screen.getByRole("button", { name: /p\.?\s*3\s*[–-]\s*4/i })).toBeInTheDocument();
  });

  it("passes the document id through on a citation click when known (story 24)", async () => {
    const user = userEvent.setup();
    const onCitationClick = vi.fn();
    render(<CoveragePanel report={report()} docId="d1" onCitationClick={onCitationClick} />);
    await user.click(screen.getByRole("button", { name: /p\.?\s*2/i }));
    expect(onCitationClick).toHaveBeenCalledWith({ docId: "d1", page: 2 });
  });

  it("marks covered topics distinctly from gaps (story 30)", () => {
    render(<CoveragePanel report={report()} />);
    const covered = screen.getByText(/cell structure/i).closest("li");
    const gap = screen.getByText(/photosynthesis/i).closest("li");
    expect(covered).toHaveAttribute("data-status", "covered");
    expect(gap).toHaveAttribute("data-status", "gap");
  });

  it("NEVER auto-adds a gap to the notes — it surfaces gaps as a report only (story 32)", () => {
    // The panel exposes no 'add to notes' control: a gap is a revision cue, not a
    // one-click crutch. It reports; it never writes.
    render(<CoveragePanel report={report()} />);
    expect(screen.queryByRole("button", { name: /add to notes/i })).toBeNull();
  });

  it("shows an all-covered celebratory state when there are no gaps", () => {
    render(
      <CoveragePanel
        report={report({
          coveredCount: 1,
          gapCount: 0,
          total: 1,
          topics: [{ id: "t", label: "Only topic", pageStart: 1, pageEnd: 1, status: "covered" }],
        })}
      />
    );
    expect(screen.getByText(/no gaps/i)).toBeInTheDocument();
  });

  it("shows an empty state when no document is attached (no report)", () => {
    render(<CoveragePanel report={null} />);
    expect(screen.getByText(/no document/i)).toBeInTheDocument();
  });

  it("shows an empty state when the report has no topics", () => {
    render(<CoveragePanel report={report({ topics: [], total: 0, coveredCount: 0, gapCount: 0 })} />);
    expect(screen.getByText(/no document|no topics/i)).toBeInTheDocument();
  });

  it("renders as a docked column on wide screens and a slide-over sheet on narrow (D22)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<CoveragePanel report={report()} variant="docked" />);
    expect(
      screen.getByRole("complementary", { name: /coverage/i })
    ).toHaveAttribute("data-variant", "docked");
    expect(screen.queryByRole("button", { name: /close coverage/i })).toBeNull();

    rerender(<CoveragePanel report={report()} variant="sheet" onClose={onClose} />);
    expect(
      screen.getByRole("complementary", { name: /coverage/i })
    ).toHaveAttribute("data-variant", "sheet");
    await user.click(screen.getByRole("button", { name: /close coverage/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
