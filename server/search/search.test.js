"use strict";

// Behaviour tests for board content search (D20 / stories 48–50). NO real Mongo, NO
// network: the DB collection is injected as an in-memory fake that honours the same
// query the store issues (access scope $and'd with a per-field substring $or). We
// assert only external behaviour through the public interface: the right boards come
// back, results say which field matched, access is enforced, and nothing is ever
// sent to AI (there is no AI seam to send to — search is pure).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  createSearchStore,
  accessibleBoardsScope,
  SEARCH_FIELDS,
} = require("./store");

// --- fake collection -------------------------------------------------------------

// A fake faithful to the slice of the Mongo collection surface the store uses:
// find(filter, opts).sort().limit().toArray(), evaluating the $and / $or / $regex /
// equality / array-membership operators the store and scope actually emit. Keeping
// the fake honest to the real query shape is what makes the unit test meaningful.
function fakeCollection(docs) {
  function matches(doc, filter) {
    return Object.entries(filter).every(([key, cond]) => {
      if (key === "$and") return cond.every((f) => matches(doc, f));
      if (key === "$or") return cond.some((f) => matches(doc, f));
      const value = doc[key];
      if (cond && typeof cond === "object" && "$regex" in cond) {
        const re = new RegExp(cond.$regex, cond.$options || "");
        return typeof value === "string" && re.test(value);
      }
      // Equality against a scalar, or membership when the field is an array
      // (editors / visitors are arrays; "collaborators.userId" is handled below).
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
    calls: [],
    find(filter, opts) {
      this.calls.push({ filter, opts });
      let rows = docs.filter((d) => matches(d, filter));
      const cursor = {
        sort(spec) {
          const [field, dir] = Object.entries(spec)[0];
          rows = rows.slice().sort((a, b) => (a[field] > b[field] ? dir : -dir));
          return cursor;
        },
        limit(n) {
          rows = rows.slice(0, n);
          return cursor;
        },
        async toArray() {
          // Honour the projection: drop unlisted fields so a leak would be caught.
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

const OWNER = "u-owner";

// A board owned by OWNER with the given searchable text on each field.
function board(id, fields = {}) {
  return {
    _id: id,
    name: fields.name || "Untitled",
    userId: OWNER,
    updatedAt: fields.updatedAt || new Date(2026, 0, 1),
    createdAt: new Date(2026, 0, 1),
    transcriptionText: fields.transcriptionText || "",
    typedLabelsText: fields.typedLabelsText || "",
    notesText: fields.notesText || "",
    ...fields,
  };
}

function storeOver(docs) {
  return createSearchStore({ collection: fakeCollection(docs) });
}

// --- construction ----------------------------------------------------------------

test("constructing a store without a collection fails loud", () => {
  assert.throws(() => createSearchStore({}), /collection/i);
});

// --- the three fields + name (stories 48, 49) ------------------------------------

test("searches all four fields: name, transcription, typed labels, notes", async () => {
  const docs = [
    board("b-name", { name: "Mitosis lecture" }),
    board("b-transcription", { transcriptionText: "the cell begins mitosis here" }),
    board("b-labels", { typedLabelsText: "mitosis phase" }),
    board("b-notes", { notesText: "Summary: mitosis produces two cells" }),
    board("b-miss", { name: "Budget", notesText: "unrelated" }),
  ];
  const results = await storeOver(docs).search({
    query: "mitosis",
    scope: accessibleBoardsScope(OWNER),
  });
  const ids = results.map((r) => r.board._id).sort();
  assert.deepEqual(ids, ["b-labels", "b-name", "b-notes", "b-transcription"]);
});

test("a result reports which field matched (story 49)", async () => {
  const docs = [
    board("b1", { name: "Cells", notesText: "mitosis summary" }),
  ];
  const [result] = await storeOver(docs).search({
    query: "mitosis",
    scope: accessibleBoardsScope(OWNER),
  });
  assert.deepEqual(result.matchedFields, ["notesText"]);
});

test("a hit in several fields reports each matched field, in field order (story 48)", async () => {
  const docs = [
    board("b1", {
      name: "budget",
      typedLabelsText: "BUDGET header",
      notesText: "the budget summary",
      transcriptionText: "no hit here",
    }),
  ];
  const [result] = await storeOver(docs).search({
    query: "budget",
    scope: accessibleBoardsScope(OWNER),
  });
  // Field order is name, transcriptionText, typedLabelsText, notesText.
  assert.deepEqual(result.matchedFields, ["name", "typedLabelsText", "notesText"]);
});

test("matched fields are drawn only from the known searchable set", async () => {
  const docs = [board("b1", { notesText: "widget" })];
  const [result] = await storeOver(docs).search({
    query: "widget",
    scope: accessibleBoardsScope(OWNER),
  });
  for (const f of result.matchedFields) assert.ok(SEARCH_FIELDS.includes(f));
});

// --- keyword / substring, case-insensitive (story 50) ----------------------------

test("matching is case-insensitive substring (keyword only, never AI — story 50)", async () => {
  const docs = [board("b1", { notesText: "Photosynthesis in plants" })];
  const results = await storeOver(docs).search({
    query: "SYNTH",
    scope: accessibleBoardsScope(OWNER),
  });
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].matchedFields, ["notesText"]);
});

test("regex metacharacters in the query are treated literally, not as a pattern", async () => {
  const docs = [
    board("b-literal", { notesText: "cost is $5.00 today" }),
    board("b-other", { notesText: "cost is 9900 cents" }),
  ];
  const results = await storeOver(docs).search({
    query: "$5.00",
    scope: accessibleBoardsScope(OWNER),
  });
  // "$5.00" must match literally; ".": if treated as regex it would also hit "9900".
  const ids = results.map((r) => r.board._id);
  assert.deepEqual(ids, ["b-literal"]);
});

// --- access scoping (D20 — a user searches only boards they can access) -----------

test("returns boards the user owns, edits, collaborates on, or visits — nothing else", async () => {
  const other = "u-other";
  const docs = [
    board("b-own", { name: "keyword", userId: OWNER }),
    board("b-editor", { name: "keyword", userId: other, editors: [OWNER] }),
    board("b-collab", { name: "keyword", userId: other, collaborators: [{ userId: OWNER, role: "viewer" }] }),
    board("b-visitor", { name: "keyword", userId: other, visitors: [OWNER] }),
    board("b-stranger", { name: "keyword", userId: other }),
  ];
  const results = await storeOver(docs).search({
    query: "keyword",
    scope: accessibleBoardsScope(OWNER),
  });
  const ids = results.map((r) => r.board._id).sort();
  assert.deepEqual(ids, ["b-collab", "b-editor", "b-own", "b-visitor"]);
  assert.ok(!ids.includes("b-stranger"), "a board the user can't access never leaks");
});

test("a matching board the user can't access is not returned even on a text hit", async () => {
  const docs = [board("b-secret", { name: "secret sauce", userId: "someone-else" })];
  const results = await storeOver(docs).search({
    query: "secret",
    scope: accessibleBoardsScope(OWNER),
  });
  assert.deepEqual(results, []);
});

test("no scope fails closed: returns nothing rather than scanning every board", async () => {
  const docs = [board("b1", { name: "keyword" })];
  const store = storeOver(docs);
  assert.deepEqual(await store.search({ query: "keyword", scope: null }), []);
  assert.deepEqual(await store.search({ query: "keyword" }), []);
});

test("accessibleBoardsScope returns null for a missing user (caller must fail closed)", () => {
  assert.equal(accessibleBoardsScope(undefined), null);
  assert.equal(accessibleBoardsScope(""), null);
});

// --- empty / degenerate queries --------------------------------------------------

test("an empty or whitespace query returns nothing (an empty box lists nothing)", async () => {
  const docs = [board("b1", { name: "anything" })];
  const store = storeOver(docs);
  assert.deepEqual(await store.search({ query: "", scope: accessibleBoardsScope(OWNER) }), []);
  assert.deepEqual(await store.search({ query: "   ", scope: accessibleBoardsScope(OWNER) }), []);
  assert.deepEqual(await store.search({ scope: accessibleBoardsScope(OWNER) }), []);
});

// --- result shape ----------------------------------------------------------------

test("results are newest-first and capped by limit", async () => {
  const docs = [
    board("b-old", { name: "note", updatedAt: new Date(2026, 0, 1) }),
    board("b-new", { name: "note", updatedAt: new Date(2026, 5, 1) }),
    board("b-mid", { name: "note", updatedAt: new Date(2026, 2, 1) }),
  ];
  const results = await storeOver(docs).search({
    query: "note",
    scope: accessibleBoardsScope(OWNER),
    limit: 2,
  });
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.board._id), ["b-new", "b-mid"]);
});

test("the returned board omits the bulky text blobs (only matchedFields report them)", async () => {
  const docs = [board("b1", { name: "Standup", notesText: "meeting agenda notes" })];
  const [result] = await storeOver(docs).search({
    query: "meeting",
    scope: accessibleBoardsScope(OWNER),
  });
  assert.equal(result.board.name, "Standup");
  assert.ok(!("notesText" in result.board), "notesText not echoed back");
  assert.ok(!("transcriptionText" in result.board), "transcriptionText not echoed back");
  assert.ok(!("typedLabelsText" in result.board), "typedLabelsText not echoed back");
  // But the client still learns notes matched.
  assert.deepEqual(result.matchedFields, ["notesText"]);
});
