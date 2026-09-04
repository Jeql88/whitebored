"use strict";

// The shared "protect what's yours across regeneration" primitive.
//
// Five features (D7 notes, D15 fact-check dismissals, D18 cards, and implicitly
// coverage/scope) all need the same mechanic: when content is regenerated, match
// each new item back to the prior item it corresponds to, so the user's edits,
// dismissals, and review state survive the regenerate instead of being wiped.
// This module builds that matching once; the consumers reuse it.
//
//   const { items, retired } = reconcile({ prior, next, boardElementIds, fingerprint });
//
// The primitive is GENERIC on purpose. It never inspects a consumer's own state
// (notes' `userEdited`/`text`, a card's `reviewState`, a flag's `dismissed`). It
// matches purely on two injected signals:
//   - `fingerprint(item)` — an opaque identity the consumer computes (a note's
//     text, a card's question, a discrepancy's claim). Two items with the same
//     fingerprint are "the same content".
//   - `sourceElementIds` — the board shapes an item traces to, checked against the
//     shapes that still exist (`boardElementIds`). An item whose shapes are gone
//     no longer traces to the board and is retired.
// Every other field rides along untouched, so the same call serves any consumer.

// Identity of an item for matching: its fingerprint paired with the set of board
// shapes it traces to. Exposed so consumers can reason about (and test) matching
// the same way this module does. `sourceElementIds` is order-insensitive — the
// same shapes in a different order are the same source.
function identityOf(item, fingerprint) {
  return { fingerprint: fingerprint(item), sourceElementIds: normalizeIds(item) };
}

function normalizeIds(item) {
  const ids = item && item.sourceElementIds;
  if (!Array.isArray(ids)) return [];
  // Sorted + de-duplicated so order and repeats never affect a match.
  return [...new Set(ids)].sort();
}

// Reconcile a freshly generated `next` list against the `prior` list.
//
//   items:   one entry per `next` item, in `next` order, each
//            { status, prior, next } where `prior` is the matched prior item or
//            null. The consumer reads `status` to decide what to carry forward.
//   retired: prior items with no match in `next` (their content is gone, or their
//            shapes were deleted from the board) — the consumer drops or archives
//            these.
function reconcile({ prior = [], next = [], boardElementIds = [], fingerprint }) {
  if (typeof fingerprint !== "function") {
    throw new Error("reconcile: a fingerprint(item) function is required");
  }

  const onBoard = new Set(boardElementIds);

  // Index prior items by fingerprint. A fingerprint can repeat (two prior lines
  // that ended up identical), so each bucket is a queue consumed in order.
  const priorByFingerprint = new Map();
  for (const p of prior) {
    const key = fingerprint(p);
    let bucket = priorByFingerprint.get(key);
    if (!bucket) {
      bucket = [];
      priorByFingerprint.set(key, bucket);
    }
    bucket.push(p);
  }

  const matchedPrior = new Set();
  const items = [];

  for (const n of next) {
    const bucket = priorByFingerprint.get(fingerprint(n));

    // A prior only counts as a match if its shapes still exist on the board. A
    // prior whose shapes were deleted no longer traces to anything the user drew,
    // so we must not carry its (possibly edited) state forward under the new line
    // — and it stays unmatched so it retires below. Scan the bucket for the first
    // still-traceable prior rather than blindly taking the head.
    let match = null;
    if (bucket) {
      const idx = bucket.findIndex((p) => traceable(p, onBoard));
      if (idx !== -1) match = bucket.splice(idx, 1)[0];
    }

    if (match) matchedPrior.add(match);

    items.push({
      status: match ? "unchanged" : "new",
      prior: match,
      next: n,
    });
  }

  const retired = prior.filter((p) => !matchedPrior.has(p));

  return { items, retired };
}

// True when every shape an item traces to still exists on the board. An item with
// no sourceElementIds does not trace to the board at all, so it is not traceable.
function traceable(item, onBoard) {
  const ids = normalizeIds(item);
  if (ids.length === 0) return false;
  return ids.every((id) => onBoard.has(id));
}

module.exports = { reconcile, identityOf };
