// How large a crop's exported image should be.
//
// Kept in its own module, free of any Excalidraw import, because this is pure
// arithmetic that decides what a board read COSTS — and cost rules deserve tests
// that run without pulling a canvas library into the test environment.

// Gemini bills an image in 768x768 tiles, so a crop that fits one tile is the
// cheapest read available. Handwriting needs no more resolution than that.
const TILE = 768;
// Below this the model rejects an image outright; this floor always wins.
const MIN_SHORT_EDGE = 320;
// Breathing room around the strokes, in board units. Also what lifts a thin crop
// clear of the model's minimum edge without stretching it out of shape.
export const PADDING = 24;

// How big a crop's exported image should be, given the drawing's own size.
//
// Two competing needs, resolved in the right order.
//
// Gemini bills an image in 768px TILES, so every pixel past a tile boundary costs
// tokens with no gain in legibility for handwriting. On a ~20-call-per-day free
// tier those tokens are the budget, so an ordinary crop should fit ONE tile. The
// old cap of 1600 on the long edge spent 2-3 tiles per crop for resolution the
// model does not need.
//
// But the model also REFUSES an image whose edges are too small ("Unable to
// process input image"), which is why a short-edge minimum exists at all. The two
// collide on a long thin line of writing: honouring the minimum by SCALING would
// stretch a 1200x30 strip to 12800px wide — seventeen tiles to read one line. So
// scaling only ever fits the tile, and the minimum is met by growing the CANVAS,
// which costs whitespace rather than resolution.
export function cropDimensions(w, h) {
  const longest = Math.max(w, h);
  const shortest = Math.max(1, Math.min(w, h));
  const scale = Math.max(1, Math.min(MIN_SHORT_EDGE / shortest, TILE / longest));

  // Excalidraw centres the drawing in the dimensions it is given, so the extra
  // pixels are plain background: the ink keeps its aspect ratio, and the image
  // stays inside one tile wherever it can.
  return {
    width: Math.max(Math.round(w * scale), MIN_SHORT_EDGE),
    height: Math.max(Math.round(h * scale), MIN_SHORT_EDGE),
    scale,
  };
}

