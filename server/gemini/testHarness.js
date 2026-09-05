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
  const embedCalls = [];

  const stub = {
    calls,
    embedCalls,

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

  // --- embeddings seam ------------------------------------------------------------
  // The stub only advertises embed() once the test opts in, mirroring the real
  // client's capability contract: the central module exposes gemini.embed only when
  // the client supports it. Tests that need embeddings register a canned embedder,
  // keeping the stub faithful (deterministic vectors, no network, no real model).
  //
  //   stub.embedWith(fn)   fn(text) -> number[]; called per input text
  //   stub.enqueueEmbeddings([[...], ...])  queue one batch of vectors (FIFO)
  //   stub.enqueueEmbedRateLimit(...)       queue a 429 for the next embed call
  //   stub.embedCalls      every embed request the module handed the client
  //
  // Request shape mirrors the real client: { userId, texts: string[] }. Resolves to
  // { embeddings: number[][] } aligned to texts.
  const embedScript = []; // { kind: "ok"|"error", value }
  let embedFn = null;

  stub.embedWith = function embedWith(fn) {
    embedFn = fn;
    return stub;
  };

  stub.enqueueEmbeddings = function enqueueEmbeddings(embeddings) {
    embedScript.push({ kind: "ok", value: embeddings });
    return stub;
  };

  stub.enqueueEmbedRateLimit = function enqueueEmbedRateLimit({ retryAfterMs } = {}) {
    embedScript.push({ kind: "error", value: new GeminiRateLimitError({ retryAfterMs }) });
    return stub;
  };

  stub.embed = async function embed(request) {
    embedCalls.push(request);
    const texts = Array.isArray(request?.texts) ? request.texts : [request?.texts];

    // A queued script step wins (used to inject 429s or exact batches); otherwise
    // fall back to the per-text embedder function.
    const step = embedScript.shift();
    if (step) {
      if (step.kind === "error") throw step.value;
      return { embeddings: step.value };
    }
    if (embedFn) {
      return { embeddings: texts.map((t) => embedFn(t)) };
    }
    throw new Error(
      "GeminiStub: embed() called but no embedder was registered " +
        "(use stub.embedWith(fn) or stub.enqueueEmbeddings([...]))"
    );
  };

  return stub;
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
