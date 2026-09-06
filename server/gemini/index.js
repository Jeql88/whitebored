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

// The free tier's binding constraint is a DAILY cap (~20 generate calls), not the
// per-minute burst the throttle above smooths. Without tracking it the app only
// learns it is out of budget by spending a call and getting a 429 — and a user
// halfway through a board read then loses the rest of it. Counting locally lets the
// last calls be refused up front, with an honest message, instead of failing
// mid-pipeline. Set GEMINI_DAILY_BUDGET to match the key's real quota; 0 disables
// the check for a paid key with no meaningful daily limit.
const DEFAULT_DAILY = { max: 0 };

function startOfNextDay(now) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function isRateLimit(err) {
  return err && err.status === 429;
}

// A 429 that will not clear by waiting (the free tier's per-DAY cap). Retrying it
// spends the caller's whole backoff budget — up to a minute of a user staring at a
// spinner — to reach the identical failure, so it is surfaced immediately.
function isQuotaExhausted(err) {
  return Boolean(err && err.quotaExhausted);
}

function createGemini({ client, clock = realClock, backoff, perUser, daily } = {}) {
  if (!client || typeof client.generate !== "function") {
    throw new Error("createGemini: a client with generate(request) is required");
  }

  const backoffCfg = { ...DEFAULT_BACKOFF, ...(backoff || {}) };
  const throttle = { ...DEFAULT_PER_USER, ...(perUser || {}) };
  const dailyCfg = { ...DEFAULT_DAILY, ...(daily || {}) };

  // Calls spent today, per user, and when that count resets. Purely local
  // bookkeeping: it cannot know what the key spent elsewhere, so it is a guard
  // against predictable waste, never a source of truth about the real quota.
  const spentToday = new Map(); // userId -> { count, resetAt }

  function dailyState(userId) {
    let d = spentToday.get(userId);
    const now = clock.now();
    if (!d || d.resetAt <= now) {
      d = { count: 0, resetAt: startOfNextDay(now) };
      spentToday.set(userId, d);
    }
    return d;
  }

  // Would this call exceed the day's budget? Checked BEFORE spending it.
  function overDailyBudget(userId) {
    if (!dailyCfg.max) return false;
    return dailyState(userId).count >= dailyCfg.max;
  }

  function recordDailySpend(userId) {
    if (!dailyCfg.max) return;
    dailyState(userId).count += 1;
  }

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
        if (isQuotaExhausted(err)) throw err; // waiting cannot help — fail now
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
    recordDailySpend(request && request.userId);
    return { status: "ok", response };
  }

  // Embeddings share the client seam and the same 429 backoff, but are a distinct
  // model capability (embedContent, not generateContent), so they get their own
  // client method rather than overloading generate(). Retrieval (slice #12/D14) is
  // the single caller: it embeds each chunk ONCE at upload and a query ONCE per
  // search, always through this choke point — no feature touches the SDK directly.
  //
  // Embeddings are not part of the burst-smoothing "deferred/working" story (that
  // serves interactive generate calls); an upload-time or query-time embed simply
  // awaits its result. It still rides the 429 backoff so a rate-limited embed
  // retries instead of failing. Returns whatever the client's embed resolves to
  // (the retrieval module normalizes the vector shape).
  async function embedWithBackoff(request) {
    let attempt = 0;
    for (;;) {
      try {
        return await client.embed(request);
      } catch (err) {
        if (isQuotaExhausted(err)) throw err; // waiting cannot help — fail now
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

    // Refuse up front once the day's budget is gone. Spending the call to be told
    // 429 costs the same quota and fails deeper in the pipeline, where a partly
    // read board is harder to recover than a clear "not today".
    if (overDailyBudget(userId)) {
      const err = new Error(
        "The daily AI budget for this key is used up. It resets at midnight."
      );
      err.status = 429;
      err.quotaExhausted = true;
      err.budgetedLocally = true;
      throw err;
    }

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

  // Public embeddings entry point. Present only when the injected client can embed,
  // so a client wired for generate-only degrades by simply not exposing embed()
  // (callers null-check, same as createGeminiFromConfig returning null).
  async function embed(request) {
    if (typeof client.embed !== "function") {
      throw new Error("gemini.embed: the injected client does not support embeddings");
    }
    return embedWithBackoff(request);
  }

  const api = { generate };
  if (typeof client.embed === "function") api.embed = embed;
  return api;
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
    embedModel: config.GEMINI_EMBED_MODEL,
  });
  // The daily budget is opt-in: unset, nothing changes. Set it to the key's real
  // quota and the last calls of the day are refused with a clear message instead
  // of failing mid-pipeline on a 429.
  const dailyMax = Number(config.GEMINI_DAILY_BUDGET) || 0;
  return createGemini({ client, daily: { max: dailyMax }, ...opts });
}

module.exports = { createGemini, createGeminiFromConfig };
