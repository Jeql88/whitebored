# Test harness + central Gemini module skeleton (D23)

Status: done
Slice: 1

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D23, Testing Decisions).

## What to build

Stand up the repo's first server-side test runner and a Gemini-stub harness, and introduce a single central Gemini module that every later AI feature calls through. The repo currently has no test runner; this slice establishes the pattern all subsequent slices follow: server-side unit tests with the Gemini client injected/stubbed, never hitting a real model.

The central module owns the Gemini key, per-user throttling, a burst-smoothing queue, and 429 backoff-retry (reuse the existing `rateLimit` middleware pattern). It is the single choke point where a paid Gemini tier could later be swapped in. It exposes an injectable client seam so tests substitute a stub and assert the deterministic logic (throttling, queueing, backoff, request batching) without a network call. Generation surfaces a "working" state during waits rather than hard-failing on a rate limit.

## Acceptance criteria

- [ ] A test runner is configured and `npm test` (or equivalent) runs server-side unit tests
- [ ] A reusable Gemini-stub harness lets tests inject canned model responses; no test hits a real model
- [ ] A central Gemini module exists with per-user throttling, a burst-smoothing queue, and 429 backoff-retry
- [ ] The Gemini client is injectable so the deterministic wrapper logic is unit-tested with the client stubbed
- [ ] A rate-limited call yields a "working"/deferred state instead of a hard failure (story 56)

## Blocked by

- None - can start immediately
