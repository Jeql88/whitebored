"use strict";

// Behaviour tests for the AI-chat provenance gate (slice #13, D11). Provenance is
// PROVENANCE-BASED, NOT self-reported: the tag follows from which context bucket
// actually grounds the answer, and a board/document tag is VERIFIED LOCALLY before
// it is allowed to render. These tests are pure (no model, no network) — they drive
// classifyProvenance directly with a model reply + the two context buckets.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { classifyProvenance } = require("./provenance");

// One retrieved chunk record as slice #12's retrieve() returns it.
function chunk(over = {}) {
  return {
    docId: "doc1",
    boardId: "b1",
    page: 3,
    text: "Mitochondria are the powerhouse of the cell.",
    score: 0.9,
    ...over,
  };
}

test("a board-grounded answer whose key terms are in the board text tags 'from your board'", () => {
  const tag = classifyProvenance({
    answer: "Approval comes before review.",
    boardText: "Approval step then review step on the board",
    hits: [],
    documents: {},
  });
  assert.equal(tag.bucket, "board");
  assert.equal(tag.label, "from your board");
});

test("a document-cited answer verified against a real retrieved chunk tags 'from [doc], p.N'", () => {
  const tag = classifyProvenance({
    answer: "Mitochondria are the powerhouse of the cell.",
    citation: { docId: "doc1", page: 3 },
    boardText: "",
    hits: [chunk()],
    documents: { doc1: { filename: "biology.pdf" } },
  });
  assert.equal(tag.bucket, "document");
  assert.equal(tag.docId, "doc1");
  assert.equal(tag.page, 3);
  assert.equal(tag.label, "from biology.pdf, p.3");
});

test("a citation that points to no real retrieved chunk is NOT trusted — downgraded to general", () => {
  // The model claims a document source, but nothing in the retrieved set matches
  // that docId+page. A self-reported citation must never render a document tag.
  const tag = classifyProvenance({
    answer: "Some fact the model asserts.",
    citation: { docId: "doc1", page: 99 },
    boardText: "",
    hits: [chunk({ page: 3 })], // real chunk is p.3, model cited p.99
    documents: { doc1: { filename: "biology.pdf" } },
  });
  assert.equal(tag.bucket, "general");
  assert.equal(tag.label, "general knowledge");
});

test("a claimed board answer whose key terms are NOT in the board text is downgraded to general", () => {
  // Model answered but the substance ("photosynthesis") is nowhere on the board and
  // there is no valid citation → it cannot wear a board tag.
  const tag = classifyProvenance({
    answer: "Photosynthesis converts light to sugar.",
    boardText: "Approval step then review step",
    hits: [],
    documents: {},
  });
  assert.equal(tag.bucket, "general");
});

test("the model may say 'not in your material' and answer as general knowledge", () => {
  const tag = classifyProvenance({
    answer: "In general, cells produce energy via respiration.",
    notInMaterial: true,
    boardText: "cells respiration energy general produce via", // even if terms coincide
    hits: [],
    documents: {},
  });
  // notInMaterial forces the honest general-knowledge path regardless of coincidental
  // term overlap — the model explicitly disclaimed the material.
  assert.equal(tag.bucket, "general");
  assert.equal(tag.label, "general knowledge");
});

test("document provenance wins over board when a valid citation is present", () => {
  // The answer's terms coincide with the board too, but a verified citation is the
  // stronger, more specific provenance — prefer the document tag.
  const tag = classifyProvenance({
    answer: "Mitochondria are the powerhouse of the cell.",
    citation: { docId: "doc1", page: 3 },
    boardText: "mitochondria powerhouse cell", // would also verify as board
    hits: [chunk()],
    documents: { doc1: { filename: "biology.pdf" } },
  });
  assert.equal(tag.bucket, "document");
});

test("a document tag falls back to the docId when no filename is known, still local-verified", () => {
  const tag = classifyProvenance({
    answer: "Mitochondria are the powerhouse of the cell.",
    citation: { docId: "doc1", page: 3 },
    boardText: "",
    hits: [chunk()],
    documents: {}, // no filename metadata
  });
  assert.equal(tag.bucket, "document");
  assert.match(tag.label, /doc1/);
  assert.match(tag.label, /p\.3/);
});
