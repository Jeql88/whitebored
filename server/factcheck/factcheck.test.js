"use strict";

// Fact-check pass (D15) — behaviour tests through the public interface. The Gemini
// client is stubbed via the shared harness; retrieve is faked/injected; no DB, no
// network. Tests assert on the RESULT (the flag set the pass returns), never on
// prompt strings or call counts.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createGemini } = require("../gemini");
const { createGeminiStub } = require("../gemini/testHarness");
const {
  createFactChecker,
  discrepancyFingerprint,
  reconcileDismissals,
  acceptFlag,
} = require("./index");

// A notes record (D6). The board CLAIM under check comes from these lines.
function notes(over = {}) {
  return {
    boardId: "b1",
    noteType: "lecture",
    lines: [
      {
        text: "Mitochondria make proteins",
        kind: "key-point",
        sourceElementIds: ["boxA"],
        origin: "board",
      },
    ],
    ...over,
  };
}

// A retrieve() fake: returns the given hits for any query. Faithful to the seam's
// contract (retrieve(query, scope) -> [{docId, boardId, page, text, score}]).
function fakeRetrieve(hits) {
  return async () => hits;
}

const CHUNK = {
  docId: "d1",
  boardId: "b1",
  page: 3,
  text: "Mitochondria produce ATP via cellular respiration; they do not make proteins.",
  score: 0.95,
};

// Build a checker whose model returns exactly `flags` as its JSON reply.
function checkerReturning(rawFlags, retrieveHits = [CHUNK]) {
  const stub = createGeminiStub();
  stub.enqueue({ text: JSON.stringify({ discrepancies: rawFlags }) });
  const gemini = createGemini({ client: stub });
  return createFactChecker({ gemini, retrieve: fakeRetrieve(retrieveHits), userId: "u1" });
}

test("produces discrepancies with the {boardClaim, sourceClaim, citation, severity} shape (story 26)", async () => {
  const checker = checkerReturning([
    {
      boardClaim: "Mitochondria make proteins",
      sourceClaim: "Mitochondria produce ATP",
      citation: { docId: "d1", page: 3 },
      severity: "high",
    },
  ]);

  const { boardId, flags } = await checker.check({ notes: notes(), boardId: "b1" });
  assert.equal(boardId, "b1");
  assert.equal(flags.length, 1);
  const f = flags[0];
  assert.equal(f.boardClaim, "Mitochondria make proteins");
  assert.equal(f.sourceClaim, "Mitochondria produce ATP");
  assert.deepEqual(f.citation, { docId: "d1", page: 3 });
  assert.equal(f.severity, "high");
  assert.equal(f.status, "open"); // a fresh flag starts open (not yet judged)
  assert.ok(f.id, "each flag carries a stable id for the UI");
});

test("drops a flag whose citation can't be verified against the retrieved chunk (D15)", async () => {
  // sourceClaim asserts "chloroplast", a term the retrieved chunk never contains —
  // the model asserted, not read, so the flag is unverifiable and dropped.
  const checker = checkerReturning([
    {
      boardClaim: "Mitochondria make proteins",
      sourceClaim: "Chloroplast produces sugar",
      citation: { docId: "d1", page: 3 },
      severity: "high",
    },
  ]);
  const { flags } = await checker.check({ notes: notes(), boardId: "b1" });
  assert.equal(flags.length, 0);
});

test("drops a flag whose citation points at a page no retrieved chunk covers (D15)", async () => {
  const checker = checkerReturning([
    {
      boardClaim: "Mitochondria make proteins",
      sourceClaim: "Mitochondria produce ATP",
      citation: { docId: "d1", page: 99 }, // no retrieved chunk on page 99
      severity: "high",
    },
  ]);
  const { flags } = await checker.check({ notes: notes(), boardId: "b1" });
  assert.equal(flags.length, 0);
});

test("keeps verifiable flags and drops unverifiable ones in the same pass", async () => {
  const checker = checkerReturning([
    {
      boardClaim: "Mitochondria make proteins",
      sourceClaim: "Mitochondria produce ATP", // verifiable
      citation: { docId: "d1", page: 3 },
      severity: "high",
    },
    {
      boardClaim: "Mitochondria make proteins",
      sourceClaim: "Photosynthesis occurs here", // "photosynthesis" not in chunk
      citation: { docId: "d1", page: 3 },
      severity: "medium",
    },
  ]);
  const { flags } = await checker.check({ notes: notes(), boardId: "b1" });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].sourceClaim, "Mitochondria produce ATP");
});

test("runs no model call and produces no flags when no document is attached (no chunks)", async () => {
  // With nothing retrievable, there is nothing to check against — the pass short-
  // circuits without a model call (story 25: works with nothing uploaded).
  const stub = createGeminiStub();
  const gemini = createGemini({ client: stub });
  const checker = createFactChecker({ gemini, retrieve: fakeRetrieve([]), userId: "u1" });

  const { flags } = await checker.check({ notes: notes(), boardId: "b1" });
  assert.equal(flags.length, 0);
  assert.equal(stub.calls.length, 0, "no model call when there's nothing to check against");
});

test("produces no flags for empty notes without a model call", async () => {
  const stub = createGeminiStub();
  const gemini = createGemini({ client: stub });
  const checker = createFactChecker({ gemini, retrieve: fakeRetrieve([CHUNK]), userId: "u1" });

  const { flags } = await checker.check({ notes: notes({ lines: [] }), boardId: "b1" });
  assert.equal(flags.length, 0);
  assert.equal(stub.calls.length, 0);
});

test("a malformed model reply yields no flags rather than crashing (degrade gracefully)", async () => {
  const stub = createGeminiStub();
  stub.enqueue({ text: "not json at all" });
  const gemini = createGemini({ client: stub });
  const checker = createFactChecker({ gemini, retrieve: fakeRetrieve([CHUNK]), userId: "u1" });

  const { flags } = await checker.check({ notes: notes(), boardId: "b1" });
  assert.equal(flags.length, 0);
});

// --- dismissal survives regeneration (story 29) ----------------------------------

test("a dismissed flag stays dismissed when the pass re-runs (D15, via fingerprint)", async () => {
  // First pass: the flag is produced and the user dismisses it.
  const first = await checkerReturning([
    {
      boardClaim: "Mitochondria make proteins",
      sourceClaim: "Mitochondria produce ATP",
      citation: { docId: "d1", page: 3 },
      severity: "high",
    },
  ]).check({ notes: notes(), boardId: "b1" });

  const dismissed = first.flags.map((f) => ({ ...f, status: "dismissed" }));

  // Re-run the pass. The model surfaces the SAME discrepancy again. Passing the
  // prior (dismissed) flags in means the re-surfaced flag must NOT reappear as open.
  const second = await checkerReturning([
    {
      boardClaim: "Mitochondria make proteins",
      sourceClaim: "Mitochondria produce ATP",
      citation: { docId: "d1", page: 3 },
      severity: "high",
    },
  ]).check({ notes: notes(), boardId: "b1", prior: dismissed });

  const open = second.flags.filter((f) => f.status === "open");
  assert.equal(open.length, 0, "the re-surfaced discrepancy is not re-nagged");
  const stillDismissed = second.flags.filter((f) => f.status === "dismissed");
  assert.equal(stillDismissed.length, 1);
});

test("an accepted flag's judgement also survives a re-run", async () => {
  const first = await checkerReturning([
    {
      boardClaim: "Mitochondria make proteins",
      sourceClaim: "Mitochondria produce ATP",
      citation: { docId: "d1", page: 3 },
      severity: "high",
    },
  ]).check({ notes: notes(), boardId: "b1" });

  const accepted = first.flags.map((f) => ({ ...f, status: "accepted" }));
  const second = await checkerReturning([
    {
      boardClaim: "Mitochondria make proteins",
      sourceClaim: "Mitochondria produce ATP",
      citation: { docId: "d1", page: 3 },
      severity: "high",
    },
  ]).check({ notes: notes(), boardId: "b1", prior: accepted });

  assert.equal(second.flags.length, 1);
  assert.equal(second.flags[0].status, "accepted");
});

test("a genuinely NEW discrepancy after a re-run is open, alongside a carried dismissal", async () => {
  const dismissed = [
    {
      id: "old",
      boardClaim: "Mitochondria make proteins",
      sourceClaim: "Mitochondria produce ATP",
      citation: { docId: "d1", page: 3 },
      severity: "high",
      status: "dismissed",
    },
  ];

  // Chunk carries both facts so both new claims verify.
  const chunk = {
    ...CHUNK,
    text: "Mitochondria produce ATP. The cell membrane is a phospholipid bilayer.",
  };
  const second = await checkerReturning(
    [
      {
        boardClaim: "Mitochondria make proteins",
        sourceClaim: "Mitochondria produce ATP", // the old, dismissed one
        citation: { docId: "d1", page: 3 },
        severity: "high",
      },
      {
        boardClaim: "The membrane is a wall",
        sourceClaim: "membrane is a phospholipid bilayer", // brand new
        citation: { docId: "d1", page: 3 },
        severity: "medium",
      },
    ],
    [chunk]
  ).check({
    notes: notes({
      lines: [
        { text: "Mitochondria make proteins", sourceElementIds: ["boxA"] },
        { text: "The membrane is a wall", sourceElementIds: ["boxB"] },
      ],
    }),
    boardId: "b1",
    prior: dismissed,
  });

  const statuses = second.flags.map((f) => f.status).sort();
  assert.deepEqual(statuses, ["dismissed", "open"]);
});

// --- fingerprint is content-based, page-insensitive so a re-page doesn't re-nag ----

test("the discrepancy fingerprint keys on the claims, not incidental fields", () => {
  const a = {
    boardClaim: "Mitochondria make proteins",
    sourceClaim: "Mitochondria produce ATP",
    citation: { docId: "d1", page: 3 },
    severity: "high",
  };
  // Same claims, different severity + page — the same discrepancy, so same fingerprint.
  const b = { ...a, severity: "low", citation: { docId: "d1", page: 4 } };
  assert.equal(discrepancyFingerprint(a), discrepancyFingerprint(b));

  const c = { ...a, boardClaim: "Something else entirely" };
  assert.notEqual(discrepancyFingerprint(a), discrepancyFingerprint(c));
});

// --- Accept offers a line edit; never auto-edits (story 28) -----------------------

test("acceptFlag marks the flag accepted and OFFERS a line edit — it never mutates notes", () => {
  const noteRecord = notes();
  const flag = {
    id: "f0",
    boardClaim: "Mitochondria make proteins",
    sourceClaim: "Mitochondria produce ATP",
    citation: { docId: "d1", page: 3 },
    severity: "high",
    status: "open",
  };

  const { flag: accepted, edit } = acceptFlag(flag, noteRecord);

  // The flag is now accepted...
  assert.equal(accepted.status, "accepted");
  // ...but the notes record is untouched: nothing auto-edited.
  assert.equal(noteRecord.lines[0].text, "Mitochondria make proteins");

  // The returned edit is an OFFER the user confirms: it identifies the specific line
  // (by index) and proposes the source claim as the replacement — it is data, not an
  // applied change.
  assert.equal(edit.lineIndex, 0);
  assert.equal(edit.suggestedText, "Mitochondria produce ATP");
  assert.equal(edit.currentText, "Mitochondria make proteins");
});

test("acceptFlag offers no line edit when the flag's board claim matches no note line", () => {
  const noteRecord = notes({ lines: [{ text: "Unrelated note", sourceElementIds: ["x"] }] });
  const flag = {
    id: "f0",
    boardClaim: "Mitochondria make proteins",
    sourceClaim: "Mitochondria produce ATP",
    citation: { docId: "d1", page: 3 },
    severity: "high",
    status: "open",
  };
  const { flag: accepted, edit } = acceptFlag(flag, noteRecord);
  assert.equal(accepted.status, "accepted");
  assert.equal(edit, null); // nothing to offer; still never auto-edits
});
