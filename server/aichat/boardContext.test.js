"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createBoardContext, REASONS } = require("./boardContext");

const artifactWith = (words, version) => ({
  phase: "transcription",
  boardVersion: version,
  entries: words.map((w, i) => ({
    cropId: `c${i}`,
    segments: [{ text: w, uncertain: false }],
    sourceElementIds: [`e${i}`],
  })),
});

const els = [{ id: "e1" }];

function ctx(over = {}) {
  return createBoardContext({
    loadArtifact: async () => artifactWith(["Mitosis"], "v1"),
    currentVersion: () => "v1",
    readBoard: async () => artifactWith(["Fresh"], "v2"),
    ...over,
  });
}

test("an unchanged board is not re-read", () => {
  // The whole point: a transcription is the expensive operation, and a board that
  // has not changed already has one.
  const c = ctx();
  assert.equal(c.decide({ artifact: artifactWith(["a"], "v1"), elements: els }), REASONS.FRESH);
});

test("a changed board is re-read", () => {
  const c = ctx({ currentVersion: () => "v2" });
  assert.equal(c.decide({ artifact: artifactWith(["a"], "v1"), elements: els }), REASONS.CHANGED);
});

test("a board never read before is read", () => {
  const c = ctx();
  assert.equal(c.decide({ artifact: null, elements: els }), REASONS.NEVER_READ);
  assert.equal(c.decide({ artifact: { entries: [] }, elements: els }), REASONS.NEVER_READ);
});

test("an explicit request re-reads even when nothing changed", () => {
  // /read-board must do something, or it is a lie.
  const c = ctx();
  assert.equal(
    c.decide({ artifact: artifactWith(["a"], "v1"), elements: els, force: true }),
    REASONS.FORCED
  );
});

test("an artifact read before versions existed is re-read once", () => {
  const c = ctx();
  assert.equal(
    c.decide({ artifact: artifactWith(["a"], undefined), elements: els }),
    REASONS.CHANGED
  );
});

test("no geometry to compare means trust what is stored", () => {
  // An older client, or a board whose scene has not loaded. Paying for a
  // speculative read here would spend quota to learn nothing.
  const c = ctx();
  assert.equal(c.decide({ artifact: artifactWith(["a"], "v1"), elements: [] }), REASONS.FRESH);
  assert.equal(c.decide({ artifact: artifactWith(["a"], "v1"), elements: undefined }), REASONS.FRESH);
});

test("resolving an unchanged board returns stored text and reads nothing", async () => {
  let read = false;
  const c = ctx({ readBoard: async () => { read = true; return artifactWith(["x"], "v2"); } });

  const out = await c.resolve({ boardId: "b1", elements: els });

  assert.match(out.text, /Mitosis/);
  assert.equal(out.didRead, false);
  assert.equal(read, false, "an unchanged board must not reach the model");
});

test("resolving a changed board reads and returns the fresh text", async () => {
  const c = ctx({ currentVersion: () => "v2" });
  const out = await c.resolve({ boardId: "b1", elements: els });

  assert.match(out.text, /Fresh/);
  assert.equal(out.didRead, true);
});

test("a failed read falls back to the stored text rather than failing the message", async () => {
  // Quota, a congested model, a malformed upload. Stale text beats no answer.
  const c = ctx({
    currentVersion: () => "v2",
    readBoard: async () => {
      throw Object.assign(new Error("quota exhausted"), { status: 429 });
    },
  });

  const out = await c.resolve({ boardId: "b1", elements: els });

  assert.match(out.text, /Mitosis/, "the previous transcription is still used");
  assert.equal(out.didRead, false);
  assert.match(out.readError, /quota/);
});

test("a read that returns nothing does not erase what we already had", async () => {
  // Replacing real text with silence is strictly worse than keeping it.
  const c = ctx({
    currentVersion: () => "v2",
    readBoard: async () => artifactWith([], "v2"),
  });

  const out = await c.resolve({ boardId: "b1", elements: els });

  assert.match(out.text, /Mitosis/);
  assert.equal(out.readEmpty, true);
});

test("progress is announced only when a read actually happens", async () => {
  const seen = [];
  const c = ctx({ currentVersion: () => "v2", onStatus: (s, m) => seen.push([s, m]) });
  await c.resolve({ boardId: "b1", elements: els });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], "reading");

  const quiet = [];
  const c2 = ctx({ onStatus: (s, m) => quiet.push([s, m]) });
  await c2.resolve({ boardId: "b1", elements: els });
  assert.deepEqual(quiet, [], "an unchanged board must not claim to be reading");
});

test("a missing artifact is not an error", async () => {
  const c = ctx({ loadArtifact: async () => null, readBoard: undefined });
  const out = await c.resolve({ boardId: "b1", elements: els });
  assert.equal(out.text, "");
  assert.equal(out.reason, REASONS.UNAVAILABLE);
});
