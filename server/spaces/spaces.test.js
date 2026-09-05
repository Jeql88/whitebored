"use strict";

// Behaviour tests for the lightweight Space entity (D21 / slice #18, stories 51–53).
// NO real Mongo, NO network: the DB collections are injected as in-memory fakes that
// honour the same query surface the store issues. We assert only observable behaviour
// through the public interface:
//
//   - a Space has members; membership is additive on top of per-board sharing
//   - V1 ships ONE Space everyone joins (ensureDefaultSpace is idempotent)
//   - Space members see everyone's Space boards visible + searchable together (story 51)
//   - searching the Space surfaces ALL versions of a topic (story 52)
//   - a mock paper is generated from the COMBINED Space boards with a document
//     attached (story 53)
//
// Search widening is asserted to preserve the D20 mechanism: the SAME createSearchStore
// runs, only the scope filter widens (accessibleBoardsScope gains member space ids).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  createSpaceStore,
  spaceBoardsScope,
  createCombinedStudy,
  DEFAULT_SPACE_NAME,
} = require("./index");
const { createSearchStore, accessibleBoardsScope } = require("../search/store");

// --- fakes -----------------------------------------------------------------------

// A fake spaces collection faithful to the surface the store uses: findOne (by _id or
// by name), insertOne, updateOne with $addToSet, find({ members }).toArray().
function fakeSpaces() {
  const docs = new Map(); // id string -> space doc (with _id)
  let seq = 0;
  return {
    docs,
    async findOne(query) {
      for (const doc of docs.values()) {
        if (query._id != null && String(doc._id) === String(query._id)) return doc;
        if (query.name != null && doc.name === query.name) return doc;
        if (query.members != null && Array.isArray(doc.members) && doc.members.includes(query.members)) return doc;
      }
      return null;
    },
    async insertOne(record) {
      const _id = record._id || `space-${++seq}`;
      docs.set(String(_id), { ...record, _id });
      return { insertedId: _id };
    },
    async updateOne(query, update) {
      let target = null;
      for (const doc of docs.values()) {
        if (query._id != null && String(doc._id) === String(query._id)) target = doc;
      }
      if (!target) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$addToSet && update.$addToSet.members != null) {
        if (!Array.isArray(target.members)) target.members = [];
        if (!target.members.includes(update.$addToSet.members)) {
          target.members.push(update.$addToSet.members);
        }
      }
      return { matchedCount: 1, modifiedCount: 1 };
    },
    find(query) {
      const rows = [...docs.values()].filter((doc) => {
        if (query.members != null) return Array.isArray(doc.members) && doc.members.includes(query.members);
        return true;
      });
      return { async toArray() { return rows; } };
    },
  };
}

// A fake whiteboards collection for the search + spaceBoardIds path. Faithful to the
// query operators the store/scope emit ($and / $or / $regex / equality / array-in /
// dotted array-membership) — the same fake shape the D20 search test uses, extended
// with $in for spaceId.
function fakeBoards(docs) {
  function matches(doc, filter) {
    return Object.entries(filter).every(([key, cond]) => {
      if (key === "$and") return cond.every((f) => matches(doc, f));
      if (key === "$or") return cond.some((f) => matches(doc, f));
      const value = doc[key];
      if (cond && typeof cond === "object" && "$regex" in cond) {
        const re = new RegExp(cond.$regex, cond.$options || "");
        return typeof value === "string" && re.test(value);
      }
      if (cond && typeof cond === "object" && "$in" in cond) {
        if (Array.isArray(value)) return value.some((v) => cond.$in.includes(v));
        return cond.$in.includes(value);
      }
      if (key.includes(".")) {
        const [arrKey, sub] = key.split(".");
        const arr = doc[arrKey];
        return Array.isArray(arr) && arr.some((el) => el && el[sub] === cond);
      }
      if (Array.isArray(value)) return value.includes(cond);
      return value === cond;
    });
  }
  return {
    find(filter, opts) {
      let rows = docs.filter((d) => matches(d, filter));
      const cursor = {
        sort(spec) {
          const [f, dir] = Object.entries(spec)[0];
          rows = rows.slice().sort((a, b) => (a[f] > b[f] ? dir : -dir));
          return cursor;
        },
        limit(n) { rows = rows.slice(0, n); return cursor; },
        async toArray() {
          const proj = opts?.projection;
          if (!proj) return rows;
          return rows.map((r) => {
            const out = {};
            for (const k of Object.keys(proj)) if (k in r) out[k] = r[k];
            out._id = r._id;
            return out;
          });
        },
      };
      return cursor;
    },
  };
}

// A fake cards collection: findOne / find({ boardId: {$in}, deck }).toArray().
function fakeCards(collections) {
  // collections: array of { boardId, deck, cards: [...] }
  return {
    find(filter) {
      const rows = collections.filter((c) => {
        const bid = filter.boardId;
        const okBoard = bid && bid.$in ? bid.$in.includes(c.boardId) : bid ? c.boardId === bid : true;
        const okDeck = filter.deck ? c.deck === filter.deck : true;
        return okBoard && okDeck;
      });
      return { async toArray() { return rows; } };
    },
  };
}

const ALICE = "u-alice";
const BOB = "u-bob";

function board(id, fields = {}) {
  return {
    _id: id,
    name: fields.name || "Untitled",
    userId: fields.userId || ALICE,
    updatedAt: fields.updatedAt || new Date(2026, 0, 1),
    createdAt: new Date(2026, 0, 1),
    transcriptionText: fields.transcriptionText || "",
    typedLabelsText: fields.typedLabelsText || "",
    notesText: fields.notesText || "",
    ...fields,
  };
}

// === Space entity + membership (V1: one Space everyone joins) =====================

test("createSpaceStore requires a collection (fails loud)", () => {
  assert.throws(() => createSpaceStore({}), /collection/i);
});

test("ensureDefaultSpace creates the one shared Space, idempotently", async () => {
  const store = createSpaceStore({ collection: fakeSpaces() });
  const a = await store.ensureDefaultSpace();
  assert.ok(a && a._id, "returns a space with an id");
  assert.equal(a.name, DEFAULT_SPACE_NAME);
  const b = await store.ensureDefaultSpace();
  // Idempotent — V1 has exactly one Space, not one-per-call.
  assert.equal(String(b._id), String(a._id));
});

test("a Space has members; join adds a member and is idempotent", async () => {
  const store = createSpaceStore({ collection: fakeSpaces() });
  const space = await store.ensureDefaultSpace();
  await store.join(space._id, ALICE);
  await store.join(space._id, ALICE); // idempotent — no duplicate
  await store.join(space._id, BOB);
  assert.equal(await store.isMember(space._id, ALICE), true);
  assert.equal(await store.isMember(space._id, BOB), true);
  const reloaded = await store.getSpace(space._id);
  assert.deepEqual(reloaded.members.slice().sort(), [ALICE, BOB].sort());
});

test("a non-member is not a member; a missing space is safe", async () => {
  const store = createSpaceStore({ collection: fakeSpaces() });
  const space = await store.ensureDefaultSpace();
  assert.equal(await store.isMember(space._id, ALICE), false);
  assert.equal(await store.isMember("nope", ALICE), false);
});

test("memberSpaceIds lists the spaces a user has joined (empty for a non-member)", async () => {
  const store = createSpaceStore({ collection: fakeSpaces() });
  const space = await store.ensureDefaultSpace();
  assert.deepEqual(await store.memberSpaceIds(BOB), []);
  await store.join(space._id, BOB);
  assert.deepEqual(await store.memberSpaceIds(BOB), [String(space._id)]);
});

test("spaceBoardIds returns the ids of all boards carrying that spaceId", async () => {
  const store = createSpaceStore({ collection: fakeSpaces() });
  const boards = fakeBoards([
    board("b-a", { userId: ALICE, spaceId: "s1" }),
    board("b-b", { userId: BOB, spaceId: "s1" }),
    board("b-solo", { userId: ALICE }), // no spaceId — not in the Space
    board("b-other", { userId: BOB, spaceId: "s2" }),
  ]);
  const ids = (await store.spaceBoardIds("s1", boards)).sort();
  assert.deepEqual(ids, ["b-a", "b-b"]);
});

// === Widened search scope (story 51/52) — SAME D20 mechanism, wider filter =========

test("spaceBoardsScope returns null for a missing user (caller fails closed)", () => {
  assert.equal(spaceBoardsScope(undefined, ["s1"]), null);
});

test("accessibleBoardsScope stays backward-compatible with one argument (D20 unchanged)", () => {
  // The D20 route + its 14 tests call accessibleBoardsScope(userId) with ONE arg.
  const scope = accessibleBoardsScope(ALICE);
  assert.ok(scope && Array.isArray(scope.$or));
  // No spaceId clause when no space ids are passed — the per-board sharing scope.
  assert.ok(!scope.$or.some((c) => "spaceId" in c));
});

test("passing member space ids widens the scope with a spaceId clause (additive)", () => {
  const scope = accessibleBoardsScope(ALICE, ["s1", "s2"]);
  // The original four sharing clauses are still present (membership LAYERS ON, not replaces).
  const keys = scope.$or.map((c) => Object.keys(c)[0]);
  assert.ok(keys.includes("userId"));
  assert.ok(keys.includes("editors"));
  assert.ok(keys.includes("collaborators.userId"));
  assert.ok(keys.includes("visitors"));
  // Plus the new Space clause.
  const spaceClause = scope.$or.find((c) => "spaceId" in c);
  assert.ok(spaceClause, "a spaceId clause is added");
  assert.deepEqual(spaceClause.spaceId.$in, ["s1", "s2"]);
});

test("Space members search everyone's Space boards together (story 51)", async () => {
  // Alice searches; Bob's board is in the same Space. Alice can see it via the Space,
  // not via per-board sharing (she is not an owner/editor/collaborator/visitor of it).
  const boards = fakeBoards([
    board("b-alice", { userId: ALICE, spaceId: "s1", notesText: "mitosis in alice's notes" }),
    board("b-bob", { userId: BOB, spaceId: "s1", notesText: "mitosis in bob's notes" }),
    board("b-stranger", { userId: BOB, notesText: "mitosis but not shared, not in space" }),
  ]);
  const store = createSearchStore({ collection: boards });
  const scope = accessibleBoardsScope(ALICE, ["s1"]);
  const results = await store.search({ query: "mitosis", scope });
  const ids = results.map((r) => r.board._id).sort();
  assert.deepEqual(ids, ["b-alice", "b-bob"], "sees own + Space peer, not the stranger board");
});

test("searching the Space surfaces ALL versions of a topic (story 52)", async () => {
  // Three members each drew "mitosis"; the Space search returns every version.
  const boards = fakeBoards([
    board("v1", { userId: ALICE, spaceId: "s1", name: "Mitosis (Alice)", notesText: "mitosis phases" }),
    board("v2", { userId: BOB, spaceId: "s1", name: "Mitosis (Bob)", transcriptionText: "mitosis diagram" }),
    board("v3", { userId: "u-cara", spaceId: "s1", name: "Cell division", typedLabelsText: "mitosis" }),
  ]);
  const store = createSearchStore({ collection: boards });
  const scope = accessibleBoardsScope(ALICE, ["s1"]);
  const results = await store.search({ query: "mitosis", scope });
  assert.equal(results.length, 3, "every member's version of the topic is surfaced");
  // The D20 mechanism is preserved: each result still reports which field matched.
  const byId = Object.fromEntries(results.map((r) => [r.board._id, r.matchedFields]));
  assert.deepEqual(byId.v1, ["name", "notesText"]);
  assert.deepEqual(byId.v2, ["name", "transcriptionText"]);
  assert.deepEqual(byId.v3, ["typedLabelsText"]);
});

// === Combined study: mock paper from combined boards + a document (story 53) =======

test("createCombinedStudy requires a cards collection (fails loud)", () => {
  assert.throws(() => createCombinedStudy({}), /collection/i);
});

test("a mock paper is generated from the COMBINED Space boards (story 53)", async () => {
  const cards = fakeCards([
    { boardId: "b-a", deck: "notes", cards: [
      { id: "a1", question: "Q1?", answer: "A1", deck: "notes", boardId: "b-a", sourceElementIds: ["e1"] },
      { id: "a2", question: "Q2?", answer: "A2", deck: "notes", boardId: "b-a", sourceElementIds: ["e2"] },
    ] },
    { boardId: "b-b", deck: "notes", cards: [
      { id: "b1", question: "Q3?", answer: "A3", deck: "notes", boardId: "b-b", sourceElementIds: ["e3"] },
    ] },
    // A board NOT in the Space must not bleed into the combined paper.
    { boardId: "b-out", deck: "notes", cards: [
      { id: "o1", question: "QX?", answer: "AX", deck: "notes", boardId: "b-out", sourceElementIds: ["e9"] },
    ] },
  ]);
  const study = createCombinedStudy({ cardsCollection: cards });
  const paper = await study.generatePaper({
    spaceId: "s1",
    boardIds: ["b-a", "b-b"],
    document: { docId: "doc-42", filename: "past-paper.pdf" },
  });
  assert.equal(paper.spaceId, "s1");
  // Combined questions come from BOTH boards, none from outside the Space.
  const qs = paper.questions.map((q) => q.question).sort();
  assert.deepEqual(qs, ["Q1?", "Q2?", "Q3?"]);
  assert.ok(paper.questions.every((q) => ["b-a", "b-b"].includes(q.boardId)));
});

test("the mock paper carries the attached document (story 53)", async () => {
  const cards = fakeCards([
    { boardId: "b-a", deck: "notes", cards: [
      { id: "a1", question: "Q1?", answer: "A1", deck: "notes", boardId: "b-a", sourceElementIds: ["e1"] },
    ] },
  ]);
  const study = createCombinedStudy({ cardsCollection: cards });
  const paper = await study.generatePaper({
    spaceId: "s1",
    boardIds: ["b-a"],
    document: { docId: "doc-42", filename: "past-paper.pdf" },
  });
  assert.deepEqual(paper.document, { docId: "doc-42", filename: "past-paper.pdf" });
});

test("the mock paper carries the honesty disclaimer and never merges decks (D17)", async () => {
  const cards = fakeCards([
    { boardId: "b-a", deck: "notes", cards: [
      { id: "a1", question: "Q1?", answer: "A1", deck: "notes", boardId: "b-a", sourceElementIds: ["e1"] },
    ] },
    // A document-deck collection for the same board must NOT appear in a notes-deck paper.
    { boardId: "b-a", deck: "document", cards: [
      { id: "d1", question: "Qdoc?", answer: "Adoc", deck: "document", boardId: "b-a", citation: { docId: "x", page: 1 } },
    ] },
  ]);
  const study = createCombinedStudy({ cardsCollection: cards });
  const paper = await study.generatePaper({ spaceId: "s1", boardIds: ["b-a"], deck: "notes" });
  assert.ok(typeof paper.disclaimer === "string" && paper.disclaimer.length > 0);
  const qs = paper.questions.map((q) => q.question);
  assert.deepEqual(qs, ["Q1?"], "the notes-deck paper never pulls in document-deck cards");
});

test("a document is optional — a paper generates from combined boards with nothing attached (story 25 spirit)", async () => {
  const cards = fakeCards([
    { boardId: "b-a", deck: "notes", cards: [
      { id: "a1", question: "Q1?", answer: "A1", deck: "notes", boardId: "b-a", sourceElementIds: ["e1"] },
    ] },
  ]);
  const study = createCombinedStudy({ cardsCollection: cards });
  const paper = await study.generatePaper({ spaceId: "s1", boardIds: ["b-a"] });
  assert.equal(paper.document, null);
  assert.equal(paper.questions.length, 1);
});

test("no boards yields an empty paper, not an error (degrade on the foreseen)", async () => {
  const study = createCombinedStudy({ cardsCollection: fakeCards([]) });
  const paper = await study.generatePaper({ spaceId: "s1", boardIds: [] });
  assert.deepEqual(paper.questions, []);
});
