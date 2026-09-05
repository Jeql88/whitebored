import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScopeBar from "./ScopeBar";

const scope = (over = {}) => ({
  source: "notes",
  range: { kind: "all" },
  count: 10,
  difficulty: "mixed",
  format: "flashcards",
  ...over,
});

describe("ScopeBar", () => {
  it("is always visible above generate and renders the current scope (story 42)", () => {
    render(<ScopeBar scope={scope({ count: 20, difficulty: "hard" })} onGenerate={() => {}} />);

    const bar = screen.getByRole("region", { name: /scope/i });
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveTextContent(/20/);
    expect(bar).toHaveTextContent(/hard/i);
    expect(bar).toHaveTextContent(/my notes/i);
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("edit control mutates scope directly (story 45)", async () => {
    const onScopeChange = vi.fn();
    render(<ScopeBar scope={scope()} onScopeChange={onScopeChange} onGenerate={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    const count = screen.getByLabelText(/questions/i);
    await userEvent.clear(count);
    await userEvent.type(count, "25");
    await userEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(onScopeChange).toHaveBeenCalledWith(expect.objectContaining({ count: 25 }));
  });

  it("shows a chat-driven diff as applied, never silently (stories 43, 44)", () => {
    render(
      <ScopeBar
        scope={scope({ count: 20 })}
        diff={{ count: { from: 10, to: 20 } }}
        onGenerate={() => {}}
      />
    );

    const applied = screen.getByRole("status");
    expect(applied).toHaveTextContent(/10/);
    expect(applied).toHaveTextContent(/20/);
  });

  it("blocks generation until a concept range is confirmed, showing the resolved range (story 47)", async () => {
    const onGenerate = vi.fn();
    const onConfirmScope = vi.fn();
    render(
      <ScopeBar
        scope={scope({
          range: { kind: "concept", phrase: "up to mitosis", resolved: { from: 1, to: 9 }, confirmed: false },
        })}
        matchedTopics={["Cell structure", "Mitosis"]}
        onConfirmScope={onConfirmScope}
        onGenerate={onGenerate}
      />
    );

    // The resolved range is shown so the user can check it before committing.
    expect(screen.getByRole("region", { name: /scope/i })).toHaveTextContent(/1.*9/);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirmScope).toHaveBeenCalled();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("generates once a structural range needs no confirmation (story 46)", async () => {
    const onGenerate = vi.fn();
    render(<ScopeBar scope={scope({ range: { kind: "pages", from: 2, to: 6 } })} onGenerate={onGenerate} />);

    expect(screen.getByRole("region", { name: /scope/i })).toHaveTextContent(/2.*6/);
    await userEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(onGenerate).toHaveBeenCalled();
  });

  it("says an unresolvable concept could not be placed rather than guessing", () => {
    render(
      <ScopeBar
        scope={scope({ range: { kind: "concept", phrase: "quantum tunnelling", resolved: null, confirmed: false } })}
        onGenerate={() => {}}
      />
    );

    expect(screen.getByRole("region", { name: /scope/i })).toHaveTextContent(/couldn't place|could not place/i);
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });

  it("labels the two decks separately for notes+documents and never merges them (stories 34, 35)", () => {
    render(<ScopeBar scope={scope({ source: "notes+documents" })} onGenerate={() => {}} />);

    const decks = screen.getAllByRole("listitem");
    expect(decks).toHaveLength(2);
    expect(decks[0]).toHaveTextContent(/my notes/i);
    expect(decks[1]).toHaveTextContent(/documents/i);
  });
});
