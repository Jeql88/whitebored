"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createGemini } = require("./index");
const { createGeminiStub, createFakeClock } = require("./testHarness");

test("passes the request through to the injected client and returns its response", async () => {
  const stub = createGeminiStub();
  stub.enqueue({ text: "hello from the model" });

  const gemini = createGemini({ client: stub, clock: createFakeClock() });

  const result = await gemini.generate({ userId: "u1", prompt: "hi" });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.response, { text: "hello from the model" });
  // The client saw exactly the request the caller passed (sans internal fields).
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].prompt, "hi");
});

test("retries after a 429 with backoff and returns the eventual success", async () => {
  const stub = createGeminiStub();
  stub.enqueueRateLimit(); // first attempt is throttled by the model
  stub.enqueue({ text: "second-attempt success" });

  const clock = createFakeClock();
  const gemini = createGemini({
    client: stub,
    clock,
    backoff: { baseMs: 1000, maxRetries: 3 },
  });

  const pending = gemini.generate({ userId: "u1", prompt: "hi" });

  // Advance past the backoff so the retry fires.
  await clock.tick(2000);

  const result = await pending;
  assert.equal(result.status, "ok");
  assert.deepEqual(result.response, { text: "second-attempt success" });
  assert.equal(stub.calls.length, 2);
});

test("a call that exceeds the per-user throttle is deferred, not failed (story 56)", async () => {
  const stub = createGeminiStub();
  stub.enqueue({ text: "first" });
  stub.enqueue({ text: "second (deferred)" });

  const clock = createFakeClock();
  const gemini = createGemini({
    client: stub,
    clock,
    perUser: { windowMs: 1000, max: 1 }, // one call per second per user
  });

  // First call is under the limit → runs immediately, resolves "ok".
  const first = await gemini.generate({ userId: "u1", prompt: "a" });
  assert.equal(first.status, "ok");

  // Second call within the same window exceeds the limit → deferred "working"
  // state instead of a hard failure. The client hasn't been called a 2nd time yet.
  const second = await gemini.generate({ userId: "u1", prompt: "b" });
  assert.equal(second.status, "deferred");
  assert.equal(stub.calls.length, 1);

  // Once the window elapses, the queued work drains and completes.
  await clock.tick(1000);
  const settled = await second.done;
  assert.equal(settled.status, "ok");
  assert.deepEqual(settled.response, { text: "second (deferred)" });
  assert.equal(stub.calls.length, 2);
});

test("throttling is per user — one user's burst does not defer another's call", async () => {
  const stub = createGeminiStub();
  stub.enqueue({ text: "u1-first" });
  stub.enqueue({ text: "u2-first" });

  const clock = createFakeClock();
  const gemini = createGemini({
    client: stub,
    clock,
    perUser: { windowMs: 1000, max: 1 },
  });

  const a = await gemini.generate({ userId: "u1", prompt: "a" });
  const b = await gemini.generate({ userId: "u2", prompt: "b" });

  assert.equal(a.status, "ok");
  assert.equal(b.status, "ok"); // different user, own fresh budget
  assert.equal(stub.calls.length, 2);
});

test("the burst-smoothing queue drains deferred jobs in order across windows", async () => {
  const stub = createGeminiStub();
  stub.enqueue({ n: 1 });
  stub.enqueue({ n: 2 });
  stub.enqueue({ n: 3 });

  const clock = createFakeClock();
  const gemini = createGemini({
    client: stub,
    clock,
    perUser: { windowMs: 1000, max: 1 }, // one per window → forces a queue
  });

  // Fire a burst of three from one user. Only the first runs now; the rest queue.
  const r1 = await gemini.generate({ userId: "u1", prompt: "1" });
  const r2 = await gemini.generate({ userId: "u1", prompt: "2" });
  const r3 = await gemini.generate({ userId: "u1", prompt: "3" });

  assert.equal(r1.status, "ok");
  assert.equal(r2.status, "deferred");
  assert.equal(r3.status, "deferred");
  assert.equal(stub.calls.length, 1);

  // Each subsequent window admits exactly one queued job, in FIFO order.
  await clock.tick(1000);
  assert.deepEqual((await r2.done).response, { n: 2 });
  assert.equal(stub.calls.length, 2);

  await clock.tick(1000);
  assert.deepEqual((await r3.done).response, { n: 3 });
  assert.equal(stub.calls.length, 3);

  // The queued jobs preserved caller order.
  assert.deepEqual(stub.calls.map((c) => c.prompt), ["1", "2", "3"]);
});

test("a non-429 client error is not retried and propagates (fail loud)", async () => {
  const stub = createGeminiStub();
  const boom = new Error("model exploded");
  stub.enqueueError(boom);

  const gemini = createGemini({ client: stub, clock: createFakeClock() });

  await assert.rejects(
    () => gemini.generate({ userId: "u1", prompt: "x" }),
    /model exploded/
  );
  assert.equal(stub.calls.length, 1); // no retry on an unexpected error
});

test("a persistent 429 gives up after maxRetries and propagates", async () => {
  const stub = createGeminiStub();
  stub.enqueueRateLimit();
  stub.enqueueRateLimit();
  stub.enqueueRateLimit(); // three 429s; maxRetries=2 → 1 initial + 2 retries

  const clock = createFakeClock();
  const gemini = createGemini({
    client: stub,
    clock,
    backoff: { baseMs: 100, maxRetries: 2 },
  });

  const pending = gemini.generate({ userId: "u1", prompt: "x" });
  const assertion = assert.rejects(pending, (err) => err.status === 429);

  await clock.tick(10000); // advance past all backoffs
  await assertion;
  assert.equal(stub.calls.length, 3);
});

test("a per-day quota 429 fails immediately instead of exhausting the backoff", async () => {
  // Retrying a daily cap spends the whole backoff budget — up to a minute of the
  // user watching a spinner — to arrive at the identical failure. It must surface
  // at once, and cost exactly one call.
  const stub = createGeminiStub();
  const exhausted = Object.assign(new Error("Quota exceeded ... PerDay ..."), {
    status: 429,
    quotaExhausted: true,
  });
  stub.enqueueError(exhausted);

  const clock = createFakeClock();
  const gemini = createGemini({ client: stub, clock });

  await assert.rejects(() => gemini.generate({ userId: "u1" }), /Quota exceeded/);
  assert.equal(stub.calls.length, 1, "a daily cap must not be retried");
});
