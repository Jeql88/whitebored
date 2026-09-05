import { describe, it, expect } from "vitest";
import { hasTextLayer } from "./pdfText";

// extractPdfPageTexts drives the real pdf.js worker, which needs a browser; it is
// exercised by hand. The text-layer GATE is the decision logic worth pinning here,
// because it is what stops a scanned PDF being uploaded only to be refused.
describe("hasTextLayer", () => {
  it("accepts a PDF with text on any page", () => {
    expect(hasTextLayer(["", "Mitosis has four phases", ""])).toBe(true);
  });

  it("rejects a scan — every page empty", () => {
    expect(hasTextLayer(["", "   ", ""])).toBe(false);
  });

  it("rejects a malformed or absent extraction rather than assuming text", () => {
    expect(hasTextLayer([])).toBe(false);
    expect(hasTextLayer(null)).toBe(false);
    expect(hasTextLayer("not an array")).toBe(false);
  });
});
