// Unit tests for the framework-free Notes artifact helpers (D6/D9). Pure functions
// — no React, no DOM. These own the streaming state transitions the panel renders.
import { describe, it, expect } from "vitest";
import {
  emptyNotes,
  appendLine,
  isHighlightable,
  NOTE_TYPES,
  DEFAULT_NOTE_TYPE,
} from "./notesArtifact";

describe("notesArtifact", () => {
  it("starts empty for a board", () => {
    const a = emptyNotes("b1");
    expect(a).toEqual({ boardId: "b1", noteType: DEFAULT_NOTE_TYPE, lines: [] });
  });

  it("appends a streamed line without mutating the prior artifact", () => {
    const a = emptyNotes("b1");
    const b = appendLine(a, {
      text: "Approval first",
      kind: "heading",
      sourceElementIds: ["f0"],
    });
    expect(a.lines).toHaveLength(0); // original untouched
    expect(b.lines).toHaveLength(1);
    expect(b.lines[0]).toEqual({
      text: "Approval first",
      kind: "heading",
      sourceElementIds: ["f0"],
      origin: "board",
    });
  });

  it("preserves order across successive streamed lines", () => {
    let a = emptyNotes("b1");
    a = appendLine(a, { text: "one", sourceElementIds: ["f0"] });
    a = appendLine(a, { text: "two", sourceElementIds: ["f1"] });
    expect(a.lines.map((l) => l.text)).toEqual(["one", "two"]);
  });

  it("ignores a malformed stream frame (no blank rows injected)", () => {
    let a = emptyNotes("b1");
    a = appendLine(a, { text: "   " });
    a = appendLine(a, null);
    expect(a.lines).toHaveLength(0);
  });

  it("defaults kind and origin when the stream omits them", () => {
    const a = appendLine(emptyNotes("b1"), { text: "x" });
    expect(a.lines[0].kind).toBe("key-point");
    expect(a.lines[0].origin).toBe("board");
  });

  it("marks a line highlightable only when it traces to a shape", () => {
    expect(isHighlightable({ sourceElementIds: ["f0"] })).toBe(true);
    expect(isHighlightable({ sourceElementIds: [] })).toBe(false);
    expect(isHighlightable({})).toBe(false);
  });

  it("exposes the four note types", () => {
    expect(NOTE_TYPES.map((t) => t.id)).toEqual([
      "lecture",
      "meeting",
      "process",
      "freeform",
    ]);
  });
});
