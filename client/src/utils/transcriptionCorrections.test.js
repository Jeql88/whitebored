// Unit tests for the framework-free transcription correction helpers (D3/D4).
// These assert the pure segment-mutation logic the TranscriptionReview component
// is a thin shell over: corrections mutate structured segments (by value), an
// [unclear] gap is a flagged+empty segment, filling one clears the flag, and the
// artifact-wide hasUnclear badge is always recomputed from the segments.
import { describe, it, expect } from "vitest";
import {
  computeHasUnclear,
  isOpenGap,
  correctSegment,
  confirmArtifact,
} from "./transcriptionCorrections";

function artifact() {
  return {
    phase: "transcription",
    hasUnclear: true,
    entries: [
      {
        cropId: "c1",
        segments: [
          { text: "helllo", uncertain: false },
          { text: "", uncertain: true },
        ],
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
  };
}

describe("isOpenGap", () => {
  it("is true only for a flagged, still-empty segment", () => {
    expect(isOpenGap({ text: "", uncertain: true })).toBe(true);
    expect(isOpenGap({ text: "filled", uncertain: true })).toBe(false);
    expect(isOpenGap({ text: "", uncertain: false })).toBe(false);
  });
});

describe("computeHasUnclear", () => {
  it("reflects whether any open gap remains", () => {
    expect(computeHasUnclear(artifact().entries)).toBe(true);
    expect(
      computeHasUnclear([
        { segments: [{ text: "a", uncertain: false }] },
      ])
    ).toBe(false);
  });
});

describe("correctSegment", () => {
  it("replaces a wrong word in place and does not mutate the input", () => {
    const before = artifact();
    const after = correctSegment(before, "c1", 0, "hello");
    expect(after.entries[0].segments[0].text).toBe("hello");
    // input untouched (pure)
    expect(before.entries[0].segments[0].text).toBe("helllo");
  });

  it("filling an [unclear] gap clears the uncertain flag and updates hasUnclear", () => {
    const after = correctSegment(artifact(), "c1", 1, "again");
    expect(after.entries[0].segments[1]).toEqual({
      text: "again",
      uncertain: false,
    });
    expect(after.hasUnclear).toBe(false);
  });

  it("fails loud on an unknown cropId", () => {
    expect(() => correctSegment(artifact(), "nope", 0, "x")).toThrow(/cropId/);
  });

  it("fails loud on an out-of-range segment index", () => {
    expect(() => correctSegment(artifact(), "c1", 9, "x")).toThrow(/range/);
  });
});

describe("confirmArtifact", () => {
  it("returns the artifact with a recomputed gap badge", () => {
    const filled = correctSegment(artifact(), "c1", 1, "again");
    const confirmed = confirmArtifact(filled);
    expect(confirmed.phase).toBe("transcription");
    expect(confirmed.hasUnclear).toBe(false);
  });

  it("rejects a non-transcription artifact", () => {
    expect(() => confirmArtifact({ phase: "notes" })).toThrow();
  });
});
