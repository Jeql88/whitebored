"use strict";

// Behaviour tests for the AI-chat responder + socket channel (slice #13, D10/D11).
// Every seam is faked: the central Gemini module is built on the slice-#1 stub (no
// network, no real model), retrieve() is a stub returning canned chunks, and the
// socket is a fake that records emits and lets a test fire the inbound event by hand
// (no real Socket.IO, per the slice constraints). We assert observable behaviour:
// the message shape a chat answer produces, that its tag is provenance-derived and
// locally verified, and the socket wiring.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createChatResponder } = require("./index");
const { registerChatHandlers } = require("./socketChat");
const { createGemini } = require("../gemini");
const { createGeminiStub, createFakeClock } = require("../gemini/testHarness");

// A Gemini reply as the module expects from the injected client: an SDK-shaped
// object whose `.text` is the JSON the model produced.
function modelReply(obj) {
  return { text: JSON.stringify(obj) };
}

function makeResponder(stub, { retrieve, documents } = {}) {
  const gemini = createGemini({ client: stub, clock: createFakeClock() });
  return createChatResponder({
    gemini,
    retrieve: retrieve || (async () => []),
    documents: documents || { get: async () => null },
  });
}

// --- responder: message shape + provenance ----------------------------------------

test("a board-grounded answer produces a message tagged 'from your board'", async () => {
  const stub = createGeminiStub();
  stub.enqueue(modelReply({ answer: "Approval comes before review." }));
  const responder = makeResponder(stub);

  const msg = await responder.answer({
    question: "What is the order?",
    boardText: "Approval step then review step",
    scope: { boardId: "b1" },
    userId: "u1",
  });

  assert.equal(msg.role, "assistant");
  assert.equal(msg.text, "Approval comes before review.");
  assert.equal(msg.source.bucket, "board");
  assert.equal(msg.source.label, "from your board");
});

test("a document-cited answer verified against a retrieved chunk tags 'from [doc], p.N'", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelReply({
      answer: "Mitochondria are the powerhouse of the cell.",
      citation: { docId: "doc1", page: 3 },
    })
  );
  const retrieve = async () => [
    { docId: "doc1", boardId: "b1", page: 3, text: "Mitochondria are the powerhouse of the cell.", score: 0.9 },
  ];
  const documents = { get: async () => ({ filename: "biology.pdf" }) };
  const responder = makeResponder(stub, { retrieve, documents });

  const msg = await responder.answer({
    question: "What are mitochondria?",
    boardText: "",
    scope: { boardId: "b1" },
    userId: "u1",
  });

  assert.equal(msg.source.bucket, "document");
  assert.equal(msg.source.docId, "doc1");
  assert.equal(msg.source.page, 3);
  assert.equal(msg.source.label, "from biology.pdf, p.3");
});

test("a self-reported citation that matches no retrieved chunk is downgraded to general knowledge", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelReply({
      answer: "A fact the model claims from a document.",
      citation: { docId: "doc1", page: 99 },
    })
  );
  // The retrieved set has doc1 p.3 only — the cited p.99 does not exist.
  const retrieve = async () => [
    { docId: "doc1", boardId: "b1", page: 3, text: "unrelated chunk text", score: 0.5 },
  ];
  const responder = makeResponder(stub, {
    retrieve,
    documents: { get: async () => ({ filename: "biology.pdf" }) },
  });

  const msg = await responder.answer({
    question: "Tell me something",
    boardText: "",
    scope: { boardId: "b1" },
    userId: "u1",
  });

  assert.equal(msg.source.bucket, "general");
  assert.equal(msg.source.label, "general knowledge");
});

test("an answer grounded in neither board nor document is tagged general knowledge", async () => {
  const stub = createGeminiStub();
  stub.enqueue(
    modelReply({
      answer: "Photosynthesis converts light into sugar.",
      notInMaterial: true,
    })
  );
  const responder = makeResponder(stub);

  const msg = await responder.answer({
    question: "What is photosynthesis?",
    boardText: "Approval step then review step",
    scope: { boardId: "b1" },
    userId: "u1",
  });

  assert.equal(msg.source.bucket, "general");
});

test("the message carries the fields slice #14 needs to carry provenance into a note line", async () => {
  const stub = createGeminiStub();
  stub.enqueue(modelReply({ answer: "Approval comes before review." }));
  const responder = makeResponder(stub);

  const msg = await responder.answer({
    question: "Order?",
    boardText: "Approval step then review step",
    scope: { boardId: "b1" },
    userId: "u1",
  });

  // #14 (add-to-notes-from-chat) reads exactly these: the text and the source tag.
  assert.equal(typeof msg.text, "string");
  assert.ok(msg.source && typeof msg.source.bucket === "string");
  // board/document answers are addable; general knowledge is not (story 19).
  assert.equal(msg.source.addableToNotes, true);
});

test("a general-knowledge message is marked NOT addable to notes (story 19)", async () => {
  const stub = createGeminiStub();
  stub.enqueue(modelReply({ answer: "Some general fact.", notInMaterial: true }));
  const responder = makeResponder(stub);

  const msg = await responder.answer({
    question: "General?",
    boardText: "",
    scope: { boardId: "b1" },
    userId: "u1",
  });

  assert.equal(msg.source.bucket, "general");
  assert.equal(msg.source.addableToNotes, false);
});

// --- socket channel (the D10 AI-chat channel) -------------------------------------

// A fake socket faithful to the subset the handler uses: on() registers a handler,
// emit() records, and fire() invokes a registered handler as Socket.IO would.
function fakeSocket({ user } = {}) {
  const handlers = {};
  const emitted = [];
  const rooms = new Set();
  return {
    user,
    rooms,
    emitted,
    on(event, fn) {
      handlers[event] = fn;
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    async fire(event, payload) {
      if (handlers[event]) await handlers[event](payload);
    },
    join(id) {
      rooms.add(id);
    },
  };
}

test("registerChatHandlers answers an aiChatMessage and emits an aiChatReply", async () => {
  const stub = createGeminiStub();
  stub.enqueue(modelReply({ answer: "Approval comes before review." }));
  const responder = makeResponder(stub);
  const socket = fakeSocket({ user: { userId: "u1" } });
  socket.join("b1");

  registerChatHandlers(socket, {
    responder,
    canAccess: async () => true,
    boardText: async () => "Approval step then review step",
  });

  await socket.fire("aiChatMessage", { boardId: "b1", text: "What is the order?" });

  const reply = socket.emitted.find((e) => e.event === "aiChatReply");
  assert.ok(reply, "an aiChatReply is emitted");
  assert.equal(reply.payload.boardId, "b1");
  assert.equal(reply.payload.message.source.bucket, "board");
  assert.equal(reply.payload.message.role, "assistant");
});

test("the AI-chat channel fails closed when board access is denied", async () => {
  const stub = createGeminiStub();
  const responder = makeResponder(stub);
  const socket = fakeSocket({ user: { userId: "u1" } });
  socket.join("b1");

  registerChatHandlers(socket, {
    responder,
    canAccess: async () => false,
    boardText: async () => "",
  });

  await socket.fire("aiChatMessage", { boardId: "b1", text: "hi" });

  assert.ok(
    socket.emitted.some((e) => e.event === "aiChatError"),
    "an aiChatError is emitted on denied access"
  );
  assert.ok(
    !socket.emitted.some((e) => e.event === "aiChatReply"),
    "no reply leaks for a board the user can't reach"
  );
  assert.equal(stub.calls.length, 0, "the model is never called for a denied board");
});

test("an empty or missing question is ignored (no model call)", async () => {
  const stub = createGeminiStub();
  const responder = makeResponder(stub);
  const socket = fakeSocket({ user: { userId: "u1" } });
  socket.join("b1");

  registerChatHandlers(socket, {
    responder,
    canAccess: async () => true,
    boardText: async () => "something",
  });

  await socket.fire("aiChatMessage", { boardId: "b1", text: "   " });
  await socket.fire("aiChatMessage", { boardId: "b1" });

  assert.equal(stub.calls.length, 0);
  assert.ok(!socket.emitted.some((e) => e.event === "aiChatReply"));
});
