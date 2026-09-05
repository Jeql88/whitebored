"use strict";

// Local citation verification for the fact-check pass (D15) — the gate every flag
// passes through before it is shown. A flag is only kept if the source claim it
// asserts actually appears in the retrieved chunk it cites AND that chunk's page is
// the page the citation points at. A flag whose sourceClaim can't be traced to its
// cited chunk is the model asserting, not evidence — so it is dropped.
//
// Tests assert observable behaviour through the public interface (verifyFlag), with
// retrieved chunks passed as data. No model, no network — pure string/term match.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { verifyFlag } = require("./verify");

// A retrieved chunk is the retrieve() hit shape: { docId, boardId, page, text, score }.
function chunk(over = {}) {
  return {
    docId: "d1",
    boardId: "b1",
    page: 3,
    text: "Mitochondria are the powerhouse of the cell and produce ATP via respiration.",
    score: 0.9,
    ...over,
  };
}

function flag(over = {}) {
  return {
    boardClaim: "Mitochondria make proteins",
    sourceClaim: "Mitochondria produce ATP",
    citation: { docId: "d1", page: 3 },
    severity: "high",
    ...over,
  };
}

test("keeps a flag whose sourceClaim terms all appear in the cited chunk", () => {
  assert.equal(verifyFlag(flag(), [chunk()]), true);
});

test("drops a flag whose sourceClaim introduces a term the cited chunk never contains", () => {
  // "chloroplast" is not in the chunk — the model asserted it, so it's unverifiable.
  const f = flag({ sourceClaim: "Chloroplast produces ATP" });
  assert.equal(verifyFlag(f, [chunk()]), false);
});

test("drops a flag whose citation points at a page no retrieved chunk covers", () => {
  // The chunk that supports the claim is on page 3, but the citation says page 9.
  const f = flag({ citation: { docId: "d1", page: 9 } });
  assert.equal(verifyFlag(f, [chunk()]), false);
});

test("drops a flag whose citation points at a docId not among the retrieved chunks", () => {
  const f = flag({ citation: { docId: "OTHER", page: 3 } });
  assert.equal(verifyFlag(f, [chunk()]), false);
});

test("drops a flag with no citation at all", () => {
  assert.equal(verifyFlag(flag({ citation: undefined }), [chunk()]), false);
});

test("drops a flag whose sourceClaim has no key terms (all glue words)", () => {
  assert.equal(verifyFlag(flag({ sourceClaim: "it is the one" }), [chunk()]), false);
});

test("verifies against the specific cited chunk, not just any retrieved chunk", () => {
  // The claim's terms live in a DIFFERENT chunk (page 7); the cited chunk (page 3)
  // does not contain them — so the citation is unverifiable and the flag drops.
  const cited = chunk({ page: 3, text: "The nucleus stores DNA." });
  const other = chunk({ page: 7, text: "Mitochondria produce ATP in respiration." });
  const f = flag({ citation: { docId: "d1", page: 3 } });
  assert.equal(verifyFlag(f, [cited, other]), false);
});
