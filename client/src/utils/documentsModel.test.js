// Unit tests for the framework-free Documents helpers (slice #11). Pure functions —
// no React, no fetch — so the jump-to-page clamping and citation resolution logic
// is verified on its own (same split as notesArtifact.test).
import { describe, it, expect } from "vitest";
import {
  citation,
  pageCount,
  clampPage,
  pageAt,
  isResolvable,
} from "./documentsModel";

function doc(pageCountN = 3, kind = "pdf") {
  return {
    docId: "d1",
    boardId: "b1",
    kind,
    filename: "notes.pdf",
    contentType: "application/pdf",
    pages: Array.from({ length: pageCountN }, (_, i) => ({
      page: i + 1,
      text: `page ${i + 1} text`,
    })),
  };
}

describe("documentsModel", () => {
  it("citation addresses a document by docId + page", () => {
    expect(citation("d1", 4)).toEqual({ docId: "d1", page: 4 });
    expect(citation("d1")).toEqual({ docId: "d1", page: 1 });
  });

  it("pageCount reflects the uniform page list; 0 for an absent doc", () => {
    expect(pageCount(doc(5))).toBe(5);
    expect(pageCount(null)).toBe(0);
    expect(pageCount({ pages: [] })).toBe(0);
  });

  it("clampPage keeps a jump target inside the real page range", () => {
    const d = doc(3);
    expect(clampPage(d, 2)).toBe(2);
    expect(clampPage(d, 0)).toBe(1);
    expect(clampPage(d, 99)).toBe(3); // a citation past the end lands on the last page
    expect(clampPage(null, 5)).toBe(1); // empty doc → a valid page
  });

  it("pageAt returns the page record for a number, or null", () => {
    const d = doc(3);
    expect(pageAt(d, 2)).toEqual({ page: 2, text: "page 2 text" });
    expect(pageAt(d, 99)).toBeNull();
  });

  it("isResolvable verifies a citation points at a real page (D11/D13)", () => {
    const d = doc(3);
    expect(isResolvable(d, citation("d1", 2))).toBe(true);
    expect(isResolvable(d, citation("d1", 99))).toBe(false);
    expect(isResolvable(d, citation("other", 1))).toBe(false);
    expect(isResolvable(null, citation("d1", 1))).toBe(false);
  });
});
