import { describe, it, expect } from "vitest";
import { cropDimensions } from "./cropDimensions";

// How many 768px billing tiles an image costs. This is the actual unit of spend
// on the free tier, so it is what the sizing rule is judged against.
const tiles = (d) => Math.ceil(d.width / 768) * Math.ceil(d.height / 768);

describe("cropDimensions", () => {
  it("keeps an ordinary line of handwriting inside a single billing tile", () => {
    // Typical crops: a few words, a short phrase, a labelled box. Each of these
    // used to cost 3 tiles under a 1600px long edge, for resolution the model does
    // not need to read handwriting.
    for (const [w, h] of [
      [400, 60],
      [200, 40],
      [600, 120],
      [300, 50],
      [500, 90],
    ]) {
      expect(tiles(cropDimensions(w, h)), `${w}x${h} should cost one tile`).toBe(1);
    }
  });

  it("never returns an edge below the model's minimum, whatever the aspect ratio", () => {
    // The model refuses an image whose edges are too small, and the previous
    // `Math.max(64, ...)` floor silently produced 64px and 80px edges on thin
    // crops — well under the minimum that caused those rejections.
    for (const [w, h] of [
      [1200, 30],
      [400, 20],
      [80, 30],
      [900, 25],
      [5, 2],
    ]) {
      const d = cropDimensions(w, h);
      expect(Math.min(d.width, d.height), `${w}x${h} short edge`).toBeGreaterThanOrEqual(320);
    }
  });

  it("does not stretch a thin strip to meet the minimum", () => {
    // Reaching a 320px short edge by SCALING a 1200x30 strip would make it
    // 12800px wide — seventeen tiles to read one line. The minimum is met by
    // padding the canvas instead, so the long edge stays bounded.
    const d = cropDimensions(1200, 30);
    expect(d.width).toBeLessThanOrEqual(1600);
  });

  it("shrinks a crop that would otherwise span many billing tiles", () => {
    // This previously asserted the opposite — that a crop is never scaled DOWN,
    // on the reasoning that downscaling throws away ink. That rule is what let a
    // 3340x1601 crop go out at full size for 15 tiles. Handwriting stays legible
    // far below its native size, and the short-edge floor still guards the
    // model's minimum, so fitting the tile is the right trade.
    const d = cropDimensions(2000, 1500);
    expect(tiles(d)).toBeLessThanOrEqual(2);
    expect(Math.min(d.width, d.height)).toBeGreaterThanOrEqual(320);
  });

  it("costs strictly fewer tiles than the previous 1600px rule", () => {
    const previous = (w, h) => {
      const longest = Math.max(w, h);
      const shortest = Math.max(1, Math.min(w, h));
      const s = Math.max(1, Math.min(320 / shortest, 1600 / longest));
      return { width: Math.max(64, Math.round(w * s)), height: Math.max(64, Math.round(h * s)) };
    };
    const board = [
      [400, 60],
      [200, 40],
      [600, 120],
      [900, 300],
      [80, 30],
      [300, 50],
      [500, 90],
      [400, 20],
    ];
    const before = board.reduce((n, [w, h]) => n + tiles(previous(w, h)), 0);
    const after = board.reduce((n, [w, h]) => n + tiles(cropDimensions(w, h)), 0);
    expect(after).toBeLessThan(before);
  });
});

describe("cropDimensions — shapes a real board actually produces", () => {
  it("shrinks an oversized crop to fit a tile instead of sending it whole", () => {
    // From a real board dump: one crop covered 3340x1601 board units. The scale
    // was clamped to a MINIMUM of 1, so it could never shrink — the image went out
    // at full size, costing ~10 tiles and burning the daily budget on one crop.
    const d = cropDimensions(3340, 1601);
    expect(tiles(d), "an oversized crop must not cost many tiles").toBeLessThanOrEqual(2);
  });

  it("does not blow a hairline stroke up past a tile", () => {
    // 4.9x25 board units — a single short pen stroke. Scaling it to meet the short
    // edge minimum inflated it 30x into a 320x768 canvas of mostly blank space
    // around a smeared line, which reads worse than the original.
    const d = cropDimensions(4.9, 25);
    expect(tiles(d), "a hairline stroke must stay within one tile").toBe(1);
  });

  it("still meets the model's minimum edge, which it refuses images below", () => {
    // The floor exists because the API rejects small images outright; shrinking
    // must not reintroduce that failure.
    for (const [w, h] of [
      [4.9, 25],
      [23, 15.5],
      [21, 14],
    ]) {
      const d = cropDimensions(w, h);
      expect(Math.min(d.width, d.height), `${w}x${h} short edge`).toBeGreaterThanOrEqual(320);
    }
  });
});
