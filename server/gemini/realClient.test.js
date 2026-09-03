"use strict";

// The real client is never network-tested (no test hits a real model). What we
// DO pin here is the faithfulness contract between the real client's error
// normalization and the stub the deterministic tests rely on: a Gemini 429 must
// become the exact { status: 429, retryAfterMs? } shape the central module's
// backoff keys off, so the stub in testHarness.js is not standing in for a lie.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { normalizeError } = require("./realClient");
const { GeminiRateLimitError } = require("./testHarness");

test("a 429-status SDK error normalizes to the module's rate-limit shape", () => {
  const sdkErr = Object.assign(new Error("429 Too Many Requests"), { status: 429 });
  const norm = normalizeError(sdkErr);

  assert.equal(norm.status, 429);
  // Matches what createGeminiStub().enqueueRateLimit() produces.
  assert.equal(norm.status, new GeminiRateLimitError().status);
});

test("a RESOURCE_EXHAUSTED SDK error also normalizes to status 429", () => {
  const sdkErr = Object.assign(new Error("quota"), { status: "RESOURCE_EXHAUSTED" });
  assert.equal(normalizeError(sdkErr).status, 429);
});

test("a retry-after header is carried through as retryAfterMs", () => {
  const sdkErr = Object.assign(new Error("429"), {
    status: 429,
    headers: { "retry-after": "7" },
  });
  assert.equal(normalizeError(sdkErr).retryAfterMs, 7000);
});

test("a non-429 SDK error propagates unchanged (fail loud)", () => {
  const sdkErr = Object.assign(new Error("500 boom"), { status: 500 });
  assert.equal(normalizeError(sdkErr), sdkErr); // same reference, not swallowed
});
