"use strict";

// Structure-first crop grouping (D1). Turns an Excalidraw element list into the
// crops that recognize() reads, grouping in strict order of reliability so the
// most trustworthy signal always wins:
//
//   1. Typed `text` elements are ground truth — each becomes its own crop of
//      kind "text" carrying the text verbatim, and is NEVER handed to the model.
//   2. Excalidraw structure defines boundaries where it exists:
//        - a text label bound to a container (`containerId`) rides with it,
//        - elements sharing a `groupIds` entry form one crop,
//        - a freedraw stroke geometrically inside a rectangle joins that rect.
//   3. Only free-floating `freedraw` strokes with NO structural signal fall
//      through to distance-based agglomerative clustering (gap threshold scaled
//      to stroke height).
//
// The output crop shape (input to recognize):
//   { cropId, kind: "text"|"ink", sourceElementIds[], bbox, text?, image? }
// `text` is set only for kind "text"; `image` is attached later by the client for
// ink crops before upload — grouping itself is pure and never touches pixels.
//
// This module is deliberately pure and deterministic: same elements in, same
// crops out, no clock/model/network. That is what lets the D5 seam tests assert
// the typed-text bypass, boundary derivation, and clustering directly.

// A crop id derived from a stable member id, so re-running grouping on the same
// scene yields the same ids (crops are keyed by id through the whole pipeline).
function cropIdFor(memberIds) {
  return `crop-${[...memberIds].sort()[0]}`;
}

function isLive(el) {
  return el && !el.isDeleted && el.id;
}

function bboxOf(elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Is `inner` fully contained within `outer`'s box? Used for the geometric-
// containment signal (a stroke drawn inside a rectangle belongs to it).
function contains(outer, inner) {
  const ox = outer.x ?? 0;
  const oy = outer.y ?? 0;
  const ow = outer.width ?? 0;
  const oh = outer.height ?? 0;
  const ix = inner.x ?? 0;
  const iy = inner.y ?? 0;
  const iw = inner.width ?? 0;
  const ih = inner.height ?? 0;
  return ix >= ox && iy >= oy && ix + iw <= ox + ow && iy + ih <= oy + oh;
}

// Union-Find over element ids: each structural signal unions two elements into
// the same crop. Order of unions doesn't matter, so the three signals compose.
function makeUnionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]));
  function find(id) {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    // Path compression keeps repeated finds cheap on large scenes.
    let cur = id;
    while (parent.get(cur) !== root) {
      const nxt = parent.get(cur);
      parent.set(cur, root);
      cur = nxt;
    }
    return root;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return { find, union };
}

// Distance-based agglomerative clustering for free-floating strokes. Two strokes
// merge when the gap between their boxes is below a threshold scaled to their
// stroke height — a proxy for "these belong to the same word/line". Applied only
// to strokes with no structural home (structure already decided the rest).
// Two strokes merge when the gap between them is small RELATIVE TO THE SMALLER of
// the two — scaling off the taller box let one long stroke (an arrow, a big
// container outline) claim a merge radius of hundreds of pixels, and because
// merging is transitive that chained the entire board into a single crop. A cap
// bounds it absolutely: handwriting in the same word or line is close in real
// terms, however tall the neighbouring shape happens to be.
const GAP_TO_HEIGHT = 1.2; // gap under 1.2x the SMALLER box merges
const MAX_MERGE_GAP = 60; // px — beyond this, strokes are separate content
// A stroke this much taller than its neighbour is not writing on the same line —
// it is an underline, a bracket, a container outline or an arrow drawn ACROSS the
// text. Its box overlaps everything it spans, and overlap alone used to merge
// unconditionally (see clusterFreeStrokes), so one such stroke chained the board
// into a single crop. Scale must be comparable before proximity means anything.
const MAX_HEIGHT_RATIO = 12;
// A stroke longer than this relative to its thickness is a RULE, not a letter: an
// underline, bracket, arrow or box edge. Its bbox overlaps everything it crosses,
// so it must never be merged by proximity. Letters — including a tittle or a comma
// — stay well under this.
const ELONGATED_RATIO = 6;
// Strokes below this are specks: a stray tap, the dot of an i left behind, a
// zero-area artefact. They carry no readable content of their own, so they never
// seed or extend a cluster — they ride along only if a real stroke claims them.
const MIN_STROKE_EXTENT = 2; // px

// The gap on each axis independently. gapBetween() collapses these into one
// radial distance, which cannot express "far apart across, but on the same line".
function gapAxes(a, b) {
  const ax2 = (a.x ?? 0) + (a.width ?? 0);
  const bx2 = (b.x ?? 0) + (b.width ?? 0);
  const ay2 = (a.y ?? 0) + (a.height ?? 0);
  const by2 = (b.y ?? 0) + (b.height ?? 0);
  return {
    dx: Math.max(0, Math.max(a.x ?? 0, b.x ?? 0) - Math.min(ax2, bx2)),
    dy: Math.max(0, Math.max(a.y ?? 0, b.y ?? 0) - Math.min(ay2, by2)),
  };
}

function gapBetween(a, b) {
  const ax2 = (a.x ?? 0) + (a.width ?? 0);
  const bx2 = (b.x ?? 0) + (b.width ?? 0);
  const ay2 = (a.y ?? 0) + (a.height ?? 0);
  const by2 = (b.y ?? 0) + (b.height ?? 0);
  const dx = Math.max(0, Math.max(a.x ?? 0, b.x ?? 0) - Math.min(ax2, bx2));
  const dy = Math.max(0, Math.max(a.y ?? 0, b.y ?? 0) - Math.min(ay2, by2));
  return Math.hypot(dx, dy);
}

// Writing runs in LINES, so the axes are not symmetric: letters in a word sit
// side by side with almost no vertical offset, and the next line sits below with
// almost no horizontal offset. Testing a single radial distance either splits
// words apart (too tight) or chains down the page (too loose), so each axis gets
// its own budget — generous horizontally, about a line-height vertically.
function clusterFreeStrokes(uf, strokes) {
  for (let i = 0; i < strokes.length; i++) {
    for (let j = i + 1; j < strokes.length; j++) {
      const a = strokes[i];
      const b = strokes[j];

      const ha = Math.max(0, a.height ?? 0);
      const hb = Math.max(0, b.height ?? 0);
      const taller = Math.max(ha, hb);
      const smaller = Math.max(1, Math.min(ha, hb));

      // An underline, bracket, box outline or arrow drawn ACROSS the page overlaps
      // the box of every word it spans, and overlapping boxes have a gap of zero on
      // both axes — so the proximity test below passed unconditionally and
      // transitivity chained the whole board into one crop.
      //
      // What separates such a stroke from ordinary writing is not its size but its
      // SHAPE: a rule or bracket is extremely elongated (very long on one axis,
      // nearly flat on the other), while letters — even a tittle, a comma, or a
      // full stop — are roughly as tall as they are wide. So an elongated stroke is
      // never merged by proximity, whatever its scale, and a compact speck still
      // joins the word it belongs to.
      const elongation = (el) => {
        const w = Math.max(el.width ?? 0, 0.01);
        const h = Math.max(el.height ?? 0, 0.01);
        return Math.max(w, h) / Math.min(w, h);
      };
      if (elongation(a) > ELONGATED_RATIO || elongation(b) > ELONGATED_RATIO) continue;

      // Among compact strokes, scale still has to be comparable: a whole scribbled
      // diagram sitting beside a word is not part of that word.
      if (taller > smaller * MAX_HEIGHT_RATIO) continue;

      const { dx, dy } = gapAxes(a, b);

      // Budgets scale to the TALLER of the two, which is the size of the writing
      // itself. Scaling to the smaller one meant a tittle, comma or full stop — a
      // mark 1-2px tall — could never reach the letter it belongs to, because its
      // own size set a sub-pixel budget. Using the taller box is safe now that
      // elongated rules are excluded above: the runaway merges it used to cause all
      // came from long strokes, which no longer take part in proximity at all.
      const scale = taller;

      // Same line, next word: a wide horizontal reach but the strokes must
      // actually overlap vertically, which is what keeps it on one line.
      const sameLine =
        dy <= scale * 0.5 && dx <= Math.min(scale * GAP_TO_HEIGHT * 2, MAX_MERGE_GAP);
      // Next line of the same block: directly above/below, within a line height.
      const nextLine =
        dx <= scale * 0.5 && dy <= Math.min(scale * GAP_TO_HEIGHT, MAX_MERGE_GAP);

      if (sameLine || nextLine) uf.union(a.id, b.id);
    }
  }
}

function groupCrops(elements = []) {
  const live = elements.filter(isLive);
  const byId = new Map(live.map((el) => [el.id, el]));

  // 1. Typed text is ground truth → its own crop, verbatim, never OCR'd. A text
  //    element BOUND to a container is not ground truth on its own; it rides with
  //    the container's ink crop below, so we exclude bound labels here.
  const crops = [];
  const typed = live.filter((el) => el.type === "text" && !el.containerId);
  for (const el of typed) {
    crops.push({
      cropId: cropIdFor([el.id]),
      kind: "text",
      text: String(el.text ?? ""),
      sourceElementIds: [el.id],
      bbox: bboxOf([el]),
    });
  }

  // Everything not claimed as ground-truth typed text is a candidate for an ink
  // crop: freedraw, shapes, and container-bound labels.
  const typedIds = new Set(typed.map((el) => el.id));
  const inkEls = live.filter((el) => !typedIds.has(el.id));
  if (inkEls.length === 0) return crops;

  const uf = makeUnionFind(inkEls.map((el) => el.id));

  // 2a. containerId binding: a bound label unions with its container.
  for (const el of inkEls) {
    if (el.containerId && byId.has(el.containerId)) uf.union(el.id, el.containerId);
  }

  // 2b. groupIds: any two elements sharing a group id union together.
  const groupToMembers = new Map();
  for (const el of inkEls) {
    for (const g of el.groupIds || []) {
      if (!groupToMembers.has(g)) groupToMembers.set(g, []);
      groupToMembers.get(g).push(el.id);
    }
  }
  for (const members of groupToMembers.values()) {
    for (let i = 1; i < members.length; i++) uf.union(members[0], members[i]);
  }

  // 2c. geometric containment: a freedraw stroke inside a rectangle joins it.
  const rects = inkEls.filter((el) => el.type === "rectangle");
  const strokes = inkEls.filter((el) => el.type === "freedraw");
  for (const stroke of strokes) {
    for (const rect of rects) {
      if (contains(rect, stroke)) {
        uf.union(stroke.id, rect.id);
        break;
      }
    }
  }

  // 3. Distance clustering — ONLY for free-floating strokes with no structural
  //    signal (still alone in their union component). Structured strokes keep
  //    their structural home; clustering never pulls them in.
  const componentSize = new Map();
  for (const el of inkEls) {
    const root = uf.find(el.id);
    componentSize.set(root, (componentSize.get(root) || 0) + 1);
  }
  const freeFloating = strokes.filter(
    (s) =>
      componentSize.get(uf.find(s.id)) === 1 &&
      !s.containerId &&
      (s.groupIds || []).length === 0
  );
  clusterFreeStrokes(uf, freeFloating);

  // Materialize ink crops from the union components.
  const components = new Map(); // root -> [elements]
  for (const el of inkEls) {
    const root = uf.find(el.id);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(el);
  }
  for (const members of components.values()) {
    const ids = members.map((el) => el.id);
    const bbox = bboxOf(members);
    // A crop whose ENTIRE extent is a speck holds no readable content: a stray
    // tap, a zero-area artefact, the leftover dot of a lifted pen. Rasterizing one
    // scales it ~320x into a blank image the model cannot read, and every such
    // crop still costs a slot in a 12-image request and a share of the per-user
    // model budget — crowding out the real handwriting on a busy board. Dropping
    // it loses nothing: the strokes stay on the board untouched, exactly as an
    // unread crop does.
    // Either dimension being degenerate is enough: a 0x3.4 sliver is as unreadable
    // as a 1x1 dot, and rasterizing it just stretches nothing into a tall blank.
    if (bbox.width < MIN_STROKE_EXTENT || bbox.height < MIN_STROKE_EXTENT) continue;
    crops.push({
      cropId: cropIdFor(ids),
      kind: "ink",
      sourceElementIds: ids,
      bbox,
    });
  }

  return crops;
}

module.exports = { groupCrops };
