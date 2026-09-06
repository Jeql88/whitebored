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

// --- Quota 429s: the free tier's per-DAY cap ---------------------------------
// A real board read returned this error on its tail chunks while earlier chunks
// read fine. Two things were wrong: the advertised retry delay lives in the JSON
// error BODY (never a Retry-After header), so backoff ignored it; and a per-day
// cap was retried like a transient burst, spending ~50s to fail identically.

const QUOTA_429 = JSON.stringify({
  error: {
    code: 429,
    message:
      "You exceeded your current quota. Please retry in 49.586168423s.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "49s" },
    ],
  },
});

test("a quota 429 carries the retry delay the API advertised in its body", () => {
  const err = normalizeError(Object.assign(new Error(QUOTA_429), { status: 429 }));
  assert.equal(err.status, 429);
  assert.equal(err.retryAfterMs, 49_000, "the RetryInfo delay must be honoured");
});

test("a per-DAY quota 429 is marked exhausted so backoff does not retry into a wall", () => {
  const err = normalizeError(Object.assign(new Error(QUOTA_429), { status: 429 }));
  assert.equal(err.quotaExhausted, true);
});

test("an ordinary burst 429 is NOT marked exhausted and still retries", () => {
  const burst = normalizeError(
    Object.assign(new Error("429 Too Many Requests: rate limit exceeded"), { status: 429 })
  );
  assert.equal(burst.status, 429);
  assert.ok(!burst.quotaExhausted, "a transient burst must still be retried");
});
