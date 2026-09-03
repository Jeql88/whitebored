"use strict";

// Central Gemini module — the single choke point every AI feature calls through.
//
// It owns the deterministic plumbing around the model call so no feature has to
// reinvent it: per-user throttling, a burst-smoothing queue, and 429 backoff-retry.
// The Gemini client itself is injected (the network seam), so this logic is unit-
// tested with the client stubbed and no request ever reaches a real model. A clock
// seam makes throttling/queue/backoff deterministic under test.
//
//   const gemini = createGemini({ client, clock?, perUser?, backoff? });
//   const result = await gemini.generate({ userId, ...request });
//
// `generate` resolves to one of:
//   { status: "ok", response }                 — ran now, model responded
//   { status: "deferred", done: Promise<...> } — over the user's throttle; the
//        call was queued (burst-smoothing) and the caller gets a "working" state
//        immediately. `done` resolves to the eventual { status: "ok", response }
//        when the queue drains. This is the story-56 path: a rate-limited call
//        yields a working/deferred state, never a hard failure.

// Real wall-clock + timers. The fake in testHarness.js stands in for this so tests
// advance time by hand instead of waiting.
const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

const DEFAULT_BACKOFF = { baseMs: 1000, maxRetries: 5 };
// Per-user throttle. Mirrors the rateLimit middleware's window/max bucket shape,
// applied here as a token budget that both admits immediate calls and paces the
// burst-smoothing queue. Free-tier Gemini limits per minute; tune at the seam.
const DEFAULT_PER_USER = { windowMs: 60 * 1000, max: 15 };

function isRateLimit(err) {
  return err && err.status === 429;
}

function createGemini({ client, clock = realClock, backoff, perUser } = {}) {
  if (!client || typeof client.generate !== "function") {
    throw new Error("createGemini: a client with generate(request) is required");
  }

  const backoffCfg = { ...DEFAULT_BACKOFF, ...(backoff || {}) };
  const throttle = { ...DEFAULT_PER_USER, ...(perUser || {}) };

  // Per-user state: a window bucket (count/resetAt, as in the rateLimit
  // middleware) plus a FIFO queue of deferred jobs waiting for budget. One entry
  // per user keeps the choke point per-user, so one user's burst never defers
  // another's call.
  const users = new Map(); // userId -> { count, resetAt, queue: [], draining: bool }

  function delay(ms) {
    return new Promise((resolve) => clock.setTimeout(resolve, ms));
  }

  function userState(userId) {
    let s = users.get(userId);
    if (!s) {
      s = { count: 0, resetAt: 0, queue: [], draining: false };
      users.set(userId, s);
    }
    return s;
  }

  // Roll the window forward if it has elapsed. Returns true if there is budget for
  // one more call in the current window (and consumes it).
  function tryConsume(s) {
    const now = clock.now();
    if (s.resetAt <= now) {
      s.count = 0;
      s.resetAt = now + throttle.windowMs;
    }
    if (s.count >= throttle.max) return false;
    s.count += 1;
    return true;
  }

  // Call the client, retrying on 429 with exponential backoff. A 429 that
  // advertises retryAfterMs is honoured; otherwise we back off baseMs * 2^attempt.
  // Non-429 errors propagate immediately (fail loud on the unexpected).
  async function callWithBackoff(request) {
    let attempt = 0;
    for (;;) {
      try {
        return await client.generate(request);
      } catch (err) {
        if (!isRateLimit(err) || attempt >= backoffCfg.maxRetries) throw err;
        const wait =
          err.retryAfterMs != null
            ? err.retryAfterMs
            : backoffCfg.baseMs * 2 ** attempt;
        attempt += 1;
        await delay(wait);
      }
    }
  }

  async function run(request) {
    const response = await callWithBackoff(request);
    return { status: "ok", response };
  }

  // Drain a user's queue as budget frees up, smoothing the burst across windows.
  // Runs at most once per user at a time; re-arms itself via the clock until the
  // queue empties.
  function scheduleDrain(s) {
    if (s.draining) return;
    s.draining = true;

    const pump = async () => {
      while (s.queue.length > 0 && tryConsume(s)) {
        const job = s.queue.shift();
        try {
          job.resolve(await run(job.request));
        } catch (err) {
          job.reject(err);
        }
      }
      if (s.queue.length === 0) {
        s.draining = false;
        return;
      }
      // Out of budget — wait until the window resets, then pump again.
      const wait = Math.max(0, s.resetAt - clock.now());
      await delay(wait);
      await pump();
    };

    // Kick off asynchronously so the caller gets its "deferred" handle first.
    pump();
  }

  async function generate(request) {
    const userId = request && request.userId;
    const s = userState(userId);

    // Under budget and nothing already queued ahead of us → run now.
    if (s.queue.length === 0 && tryConsume(s)) {
      return run(request);
    }

    // Over budget → defer. Return a working state immediately; `done` resolves
    // when the queue drains. Never throw a rate limit at the caller.
    let resolve, reject;
    const done = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    s.queue.push({ request, resolve, reject });
    scheduleDrain(s);
    return { status: "deferred", done };
  }

  return { generate };
}

// Production wiring: build the central module from config with the real Gemini
// client behind the seam. Returns null when no key is configured so AI features
// degrade gracefully (mirrors the OCR route's GOOGLE_VISION_KEY handling) rather
// than crashing the server at boot. Lazily requires the real client so the test
// path never loads the SDK.
function createGeminiFromConfig(config, opts = {}) {
  if (!config.GEMINI_API_KEY) return null;
  const { createRealClient } = require("./realClient");
  const client = createRealClient({
    apiKey: config.GEMINI_API_KEY,
    model: config.GEMINI_MODEL,
  });
  return createGemini({ client, ...opts });
}

module.exports = { createGemini, createGeminiFromConfig };
