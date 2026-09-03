"use strict";

// Test harness for the central Gemini module.
//
// Two fakes injected at the module's seams:
//   - createGeminiStub()  stands in for the real Gemini client (the network seam).
//   - createFakeClock()   stands in for wall-clock time + timers (the time seam),
//                         so throttling/queue/backoff are asserted without real waits.
//
// NO test ever hits a real model — the stub returns only canned responses that the
// test enqueues.

// A rate-limit error faithful to how the real client signals a 429: an Error whose
// `status` is 429 and which optionally advertises a Retry-After (seconds). The
// module's backoff logic keys off `status === 429`, so the stub must reproduce it
// exactly or tests would pass against a lie.
class GeminiRateLimitError extends Error {
  constructor({ retryAfterMs } = {}) {
    super("429 Too Many Requests");
    this.name = "GeminiRateLimitError";
    this.status = 429;
    if (retryAfterMs != null) this.retryAfterMs = retryAfterMs;
  }
}

// Injectable Gemini client stub.
//
//   stub.enqueue(response)            queue a canned success response
//   stub.enqueueError(error)          queue a thrown error (e.g. a 429)
//   stub.enqueueRateLimit({ retryAfterMs })  shorthand for a queued 429
//   stub.calls                        every request the module handed the client
//
// Responses are consumed FIFO. Running dry is a loud failure — a test that makes
// more calls than it primed is a bug in the test, not a silent empty response.
function createGeminiStub() {
  const script = []; // { kind: "ok"|"error", value }
  const calls = [];

  return {
    calls,

    enqueue(response) {
      script.push({ kind: "ok", value: response });
      return this;
    },

    enqueueError(error) {
      script.push({ kind: "error", value: error });
      return this;
    },

    enqueueRateLimit({ retryAfterMs } = {}) {
      script.push({ kind: "error", value: new GeminiRateLimitError({ retryAfterMs }) });
      return this;
    },

    // The seam method the module calls. Signature mirrors the real client:
    // (request) -> Promise<response>, rejecting on model/transport errors.
    async generate(request) {
      calls.push(request);
      const step = script.shift();
      if (!step) {
        throw new Error(
          `GeminiStub: client called ${calls.length} time(s) but only ` +
            `${calls.length - 1} response(s) were enqueued`
        );
      }
      if (step.kind === "error") throw step.value;
      return step.value;
    },
  };
}

// Deterministic clock: virtual `now`, and a `setTimeout` that records timers
// instead of scheduling them on the real event loop. `tick(ms)` advances virtual
// time and fires every timer whose deadline has passed, in deadline order.
// Yield the event loop a few turns so chains of awaited continuations settle. A
// handful of turns covers the module's catch -> schedule-timer depth; it is a
// bounded drain, not a spin.
async function drainMicrotasks(turns = 5) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

function createFakeClock(startMs = 0) {
  let nowMs = startMs;
  let seq = 0;
  const timers = new Map(); // id -> { at, fn }

  function fireDue() {
    // Fire in deadline order; re-scan after each fire so timers scheduled by a
    // callback are honoured within the same tick.
    for (;;) {
      let next = null;
      for (const [id, t] of timers) {
        if (t.at <= nowMs && (next === null || t.at < next.at)) next = { id, ...t };
      }
      if (!next) break;
      timers.delete(next.id);
      next.fn();
    }
  }

  return {
    now() {
      return nowMs;
    },

    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: nowMs + Math.max(0, ms || 0), fn });
      return id;
    },

    clearTimeout(id) {
      timers.delete(id);
    },

    // Advance virtual time by `ms`, firing timers as their deadlines arrive.
    //
    // Between steps we drain microtasks (a few turns) so awaited continuations —
    // e.g. a retry that schedules its backoff timer only *after* its rejection is
    // caught — get to register their timers before we scan again. Without this the
    // clock races ahead of a not-yet-scheduled timer and the awaiter deadlocks.
    async tick(ms) {
      const target = nowMs + ms;
      let guard = 0;
      for (;;) {
        await drainMicrotasks();
        let soonest = null;
        for (const t of timers.values()) {
          if (t.at <= target && (soonest === null || t.at < soonest)) soonest = t.at;
        }
        if (soonest === null) break;
        nowMs = soonest;
        fireDue();
        if (++guard > 10000) throw new Error("createFakeClock: runaway tick loop");
      }
      nowMs = target;
      await drainMicrotasks();
    },
  };
}

module.exports = { createGeminiStub, createFakeClock, GeminiRateLimitError };
