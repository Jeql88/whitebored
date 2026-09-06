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

  it("never scales a crop down below its natural size", () => {
    // Downscaling would throw away ink the model needs; the rule only ever
    // upscales, or leaves a large crop as it is.
    const d = cropDimensions(2000, 1500);
    expect(d.scale).toBeGreaterThanOrEqual(1);
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
