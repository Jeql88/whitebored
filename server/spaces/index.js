"use strict";

// Spaces module facade (D21 / slice #18). One seam to reach the Space entity's
// persistence + membership (store.js), the combined-study mock-paper generator
// (combinedStudy.js), and the Space search-scope helper.
//
//   const { createSpaceStore, spaceBoardsScope, createCombinedStudy } = require("../spaces");
//
// The Space widens D20 search WITHOUT changing its mechanism: the SAME createSearchStore
// runs; only the access scope filter grows to include the user's Space boards. The
// canonical widening point is accessibleBoardsScope(userId, memberSpaceIds) in
// server/search/store.js (slice #10 designed that seam for exactly this). `spaceBoardsScope`
// here is a thin alias so a caller reaching for the Space naturally finds the widened
// scope in the spaces module. Both return the identical filter.

const { createSpaceStore, DEFAULT_SPACE_NAME } = require("./store");
const { createCombinedStudy, PAPER_DISCLAIMER, DEFAULT_DECK } = require("./combinedStudy");
const { accessibleBoardsScope } = require("../search/store");

// The board-visibility scope for a Space member: their own accessible boards (per-board
// sharing) PLUS every board in the Spaces they belong to. Delegates to the D20 widening
// seam so there is exactly one definition of "which boards may this user see", used by
// both the dashboard/search route and any Space-scoped listing (slice #17 scope bar).
function spaceBoardsScope(userId, memberSpaceIds = []) {
  return accessibleBoardsScope(userId, memberSpaceIds);
}

module.exports = {
  createSpaceStore,
  createCombinedStudy,
  spaceBoardsScope,
  DEFAULT_SPACE_NAME,
  PAPER_DISCLAIMER,
  DEFAULT_DECK,
};
