"use strict";

// Board content search (D20 / stories 48–50).
//
// Replaces the old flat client-side `textIndex` filter with a server-side keyword
// search over FOUR board fields:
//
//   name              — the board's title
//   transcriptionText — recognized handwriting (D3 phase-1 transcription)
//   typedLabelsText   — typed Excalidraw text labels, taken as-is (D1/story 2)
//   notesText         — the generated Notes artifact text (D6)
//
// Search is keyword/substring only and NEVER sent to AI (story 50): it is instant,
// offline, and free. Results report WHICH field matched (story 49) so the UI can say
// whether a hit was in notes, a typed label, or handwriting.
//
//   const store = createSearchStore({ collection });   // inject the DB seam
//   await store.search({ query, scope });              // → [ { board, matchedFields } ]
//
// `scope` is a Mongo filter naming the boards the caller may see — the route builds
// it from the user's access (owner / editor / collaborator / visitor), so a user only
// ever searches boards they can access. Ships scoped to the user's own boards; the
// SAME mechanism widens to the Space later by passing a wider scope (D20/D21) — the
// store never changes.
//
// The Mongo collection is injected (the DB seam), so this is unit-tested with an
// in-memory fake that behaves like a real collection's text-index find(). Production
// wiring passes the real `whiteboards` collection from db.js.

// The four searchable fields, in the order a result reports them.
const SEARCH_FIELDS = ["name", "transcriptionText", "typedLabelsText", "notesText"];

// Fields returned for each result board — enough to render a dashboard card without
// leaking scene/thumbnail bulk. Kept in step with the dashboard list projection.
const RESULT_PROJECTION = {
  name: 1,
  userId: 1,
  updatedAt: 1,
  createdAt: 1,
  transcriptionText: 1,
  typedLabelsText: 1,
  notesText: 1,
};

// Substring match, case- and diacritic-insensitive enough for keyword search.
// Mongo's $text is stemmed/word-boundaried and can't say WHICH field hit; we do a
// plain substring check per field to (a) determine the matched fields for the result
// and (b) keep the contract "substring only" honest regardless of the index's tokenizer.
function fieldContains(value, needle) {
  if (typeof value !== "string" || !value) return false;
  return value.toLowerCase().includes(needle);
}

// Which of the four fields contain the query, in field order (story 49).
function matchedFieldsFor(board, needle) {
  return SEARCH_FIELDS.filter((f) => fieldContains(board[f], needle));
}

// Build the Mongo filter for boards a user may access, mirroring the dashboard list
// (owner OR editor OR collaborator OR visitor). Centralised here so search enforces
// EXACTLY the same access as `GET /api/whiteboards` — a user searches only boards they
// can access (D20). Returns null when there is no user id (caller must fail closed).
// Widening to the Space (D21) is a change to THIS scope, not to the search store.
function accessibleBoardsScope(userId) {
  if (!userId) return null;
  return {
    $or: [
      { userId },
      { editors: userId },
      { "collaborators.userId": userId },
      { visitors: userId },
    ],
  };
}

function createSearchStore({ collection } = {}) {
  if (!collection || typeof collection.find !== "function") {
    throw new Error("createSearchStore: a Mongo collection is required");
  }

  // search({ query, scope, limit }) → [ { board, matchedFields } ]
  // - query: the raw search string (trimmed/lowercased here for substring matching)
  // - scope: a Mongo filter for accessible boards (required — no scope = no results,
  //          never a full-collection scan; fail closed on missing access, D20)
  // - limit: max results (default 50), a guard against unbounded scans
  async function search({ query, scope, limit = 50 } = {}) {
    const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
    // Empty query → no results (an empty search box lists nothing, not everything).
    if (!needle) return [];
    // Missing/empty scope → fail closed: a caller with no accessible boards sees none.
    if (!scope || typeof scope !== "object") return [];

    // Substring match across the four fields, ANDed with the access scope so the DB
    // never returns a board the user can't see. `$regex` keeps it substring (not
    // stemmed) and honours the story-50 "keyword/substring only, never AI" contract.
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const contentFilter = {
      $or: SEARCH_FIELDS.map((f) => ({ [f]: { $regex: escaped, $options: "i" } })),
    };
    const filter = { $and: [scope, contentFilter] };

    const boards = await collection
      .find(filter, { projection: RESULT_PROJECTION })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();

    return boards.map((board) => ({
      board: stripContentFields(board),
      matchedFields: matchedFieldsFor(board, needle),
    }));
  }

  return { search };
}

// The result card doesn't need the full text blobs echoed back — only which fields
// matched. Drop the searchable text from the returned board to keep responses small.
function stripContentFields(board) {
  const { transcriptionText, typedLabelsText, notesText, ...rest } = board;
  return rest;
}

module.exports = { createSearchStore, accessibleBoardsScope, SEARCH_FIELDS };
