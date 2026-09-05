"use strict";

// Persistence + membership for the lightweight Space entity (D21 / slice #18).
//
// A Space is a group-study workspace: it has a name and a list of member user ids.
// A board optionally belongs to a Space via a `spaceId` field (see db.js). Membership
// grants VISIBILITY, SEARCH SCOPE, and COMBINED STUDY across every board carrying the
// Space's id — an ADDITIONAL grouping layer ON TOP OF the existing per-board sharing
// (owner / editor / collaborator / visitor), never a replacement.
//
//   const store = createSpaceStore({ collection });   // inject the Mongo seam
//   const space = await store.ensureDefaultSpace();    // V1: the one shared Space
//   await store.join(space._id, userId);               // add a member (idempotent)
//   await store.isMember(space._id, userId);           // → bool
//   await store.memberSpaceIds(userId);                // → [ spaceId, … ]
//   await store.spaceBoardIds(space._id, boards);      // → [ boardId, … ] with that spaceId
//
// A Space doc's shape:
//   { _id, name, members: [ userId ], createdAt }
//
// V1 ships ONE Space everyone joins (D21). ensureDefaultSpace is idempotent — it
// creates the shared Space once and returns the same one thereafter, so callers can
// call it freely (e.g. lazily on first board create or first search) without racing a
// second Space into existence.
//
// The Mongo collection is injected (the DB seam), so this is unit-tested with an
// in-memory fake behaving like a real collection's findOne/insertOne/updateOne/find,
// exactly as notes/cards/documents stores are. Production wiring passes the real
// `spaces` collection from db.js. No AI, no network — pure persistence.

// The single V1 Space's name. Stable so ensureDefaultSpace can find-or-create by name
// (there is exactly one) rather than relying on a hard-coded id.
const DEFAULT_SPACE_NAME = "Everyone";

function createSpaceStore({ collection } = {}) {
  if (!collection || typeof collection.findOne !== "function") {
    throw new Error("createSpaceStore: a Mongo collection is required");
  }

  // Find-or-create the single V1 Space (D21: one Space everyone joins). Idempotent:
  // keyed by the well-known name so repeated calls never create a second Space.
  async function ensureDefaultSpace() {
    const existing = await collection.findOne({ name: DEFAULT_SPACE_NAME });
    if (existing) return existing;
    const record = { name: DEFAULT_SPACE_NAME, members: [], createdAt: new Date() };
    const { insertedId } = await collection.insertOne(record);
    return { ...record, _id: insertedId };
  }

  async function getSpace(spaceId) {
    if (!spaceId) return null;
    return collection.findOne({ _id: spaceId });
  }

  // Add a user to a Space's members. Idempotent via $addToSet — joining twice is a
  // no-op, so a "join on login/first-search" caller never accumulates duplicates.
  async function join(spaceId, userId) {
    if (!spaceId || !userId) return false;
    const result = await collection.updateOne(
      { _id: spaceId },
      { $addToSet: { members: userId } }
    );
    return result.matchedCount > 0;
  }

  async function isMember(spaceId, userId) {
    if (!spaceId || !userId) return false;
    const space = await getSpace(spaceId);
    return Boolean(space && Array.isArray(space.members) && space.members.includes(userId));
  }

  // The ids of every Space a user has joined. This is the input the search-scope
  // widening consumes (accessibleBoardsScope(userId, memberSpaceIds)). Returns [] for
  // a non-member so the caller keeps failing closed to their own boards.
  async function memberSpaceIds(userId) {
    if (!userId) return [];
    const spaces = await collection.find({ members: userId }).toArray();
    return spaces.map((s) => String(s._id));
  }

  // The ids of every board carrying this spaceId — the combined set a group studies
  // from. Reads the injected whiteboards collection (passed in, not owned here) so the
  // Space store stays a single-collection module and the caller supplies the boards
  // seam it already holds.
  async function spaceBoardIds(spaceId, boardsCollection) {
    if (!spaceId || !boardsCollection) return [];
    const boards = await boardsCollection
      .find({ spaceId }, { projection: { _id: 1 } })
      .toArray();
    return boards.map((b) => String(b._id));
  }

  return { ensureDefaultSpace, getSpace, join, isMember, memberSpaceIds, spaceBoardIds };
}

module.exports = { createSpaceStore, DEFAULT_SPACE_NAME };
