"use strict";

// AI-chat responder (slice #13, D10/D11) — the "Chat" tab's brain. It answers a
// question about the board, the notes, or the uploaded documents, and stamps every
// answer with a provenance-derived, locally-verified source tag.
//
//   const responder = createChatResponder({ gemini, retrieve, documents });
//   const message = await responder.answer({ question, boardText, scope, userId });
//
// PUBLIC INTERFACE
//   answer({ question, boardText, scope, userId }) -> assistant message:
//     {
//       role: "assistant",
//       text,                       // the model's answer prose
//       source: {                   // the provenance tag (see provenance.js)
//         bucket,                   // "board" | "document" | "general"
//         label,                    // "from your board" | "from [doc], p.N" | "general knowledge"
//         addableToNotes,           // board/document → true; general → false (story 19)
//         docId?, page?,            // present on a document tag (the citation, verified)
//       },
//     }
//
// SEAMS (all injected; tests fake every one — no Mongo, no model, no network):
//   - gemini     the central Gemini module (createGemini). The SINGLE model choke
//                point; this module never touches the SDK. A deferred ("working")
//                result is awaited so a throttled call still answers (story 56).
//   - retrieve   slice #12's retriever's retrieve(query, scope) -> hits[] — the
//                retrieved-document-chunk context bucket. Injected read-only.
//   - documents  a document source with get(docId) -> { filename, ... } (slice #11),
//                used only to label a verified citation with its filename.
//
// The message shape is the contract slice #14 (add-to-notes-from-chat) builds on:
// it carries provenance INTO a note line via `text` + `source`, and only adds when
// `source.addableToNotes` is true.

const { classifyProvenance } = require("./provenance");

// How many retrieved chunks to feed the model as document context. Enough to ground
// an answer or a citation without flooding the window (mirrors retrieval's top-k).
const DEFAULT_CONTEXT_K = 6;

// The grounding fence (§7 / D11). The model is told the two context buckets, is
// REQUIRED to cite a document by { docId, page } when it uses one, and is EXPLICITLY
// allowed to disclaim the material and answer from general knowledge. The wording is
// server-side grounding and is never asserted in tests (tests assert on the RESULT);
// what matters is the JSON contract the parser reads back.
const SYSTEM_FENCE =
  "You are the study assistant for a whiteboard. Answer the user's question using " +
  "the BOARD context and the DOCUMENT context below when they are relevant. " +
  "If a fact comes from a document chunk, cite it with that chunk's docId and page. " +
  "If the answer is in NEITHER the board nor the documents, you MUST set " +
  "notInMaterial to true and answer from general knowledge — never pretend an " +
  'unsupported fact came from the material. Return ONLY JSON: { "answer": string, ' +
  '"citation"?: { "docId": string, "page": number }, "notInMaterial"?: boolean }.';

// Pull the JSON text out of a central-module result. { status:"ok", response } now,
// or { status:"deferred", done } when throttled — await the working state so the
// chat still answers on a busy moment (story 56). Mirrors notes/index.js's textOf.
async function textOf(result) {
  const settled = result.status === "deferred" ? await result.done : result;
  const response = settled.response;
  return typeof response === "string" ? response : response?.text ?? "";
}

// Parse the model reply into { answer, citation?, notInMaterial? }. A malformed reply
// must not crash the chat — it degrades to an empty answer classified as general
// knowledge (degrade on the foreseen), never a thrown error at the user.
function parseReply(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { answer: "" };
  }
  if (!obj || typeof obj !== "object") return { answer: "" };
  const answer = typeof obj.answer === "string" ? obj.answer.trim() : "";
  const out = { answer };
  if (obj.notInMaterial === true) out.notInMaterial = true;
  if (
    obj.citation &&
    typeof obj.citation === "object" &&
    obj.citation.docId != null &&
    obj.citation.page != null
  ) {
    out.citation = { docId: obj.citation.docId, page: obj.citation.page };
  }
  return out;
}

function buildRequest({ userId, question, boardText, hits }) {
  const boardBlock = boardText && boardText.trim() ? boardText.trim() : "(empty)";
  const docBlock =
    hits.length > 0
      ? hits
          .map((h) => `[docId:${h.docId} page:${h.page}] ${h.text}`)
          .join("\n")
      : "(no documents)";
  return {
    userId,
    contents: [
      {
        role: "user",
        parts: [
          { text: SYSTEM_FENCE },
          { text: `BOARD context:\n${boardBlock}` },
          { text: `DOCUMENT context:\n${docBlock}` },
          { text: `Question:\n${question}` },
        ],
      },
    ],
    config: { responseMimeType: "application/json" },
  };
}

function createChatResponder({ gemini, retrieve, documents } = {}) {
  if (!gemini || typeof gemini.generate !== "function") {
    throw new Error("createChatResponder: a central Gemini module is required");
  }
  if (typeof retrieve !== "function") {
    throw new Error("createChatResponder: a retrieve(query, scope) function is required");
  }

  // Build the filename lookup for the docs the retrieval surfaced, so a verified
  // citation can render "from [filename], p.N" rather than a bare id. Best-effort:
  // a missing document simply falls back to the docId in the tag.
  async function documentMetaFor(hits) {
    const map = {};
    if (!documents || typeof documents.get !== "function") return map;
    const ids = [...new Set(hits.map((h) => h.docId))];
    await Promise.all(
      ids.map(async (id) => {
        const meta = await documents.get(id).catch(() => null);
        if (meta) map[id] = meta;
      })
    );
    return map;
  }

  async function answer({ question, boardText = "", scope = {}, userId } = {}) {
    const q = typeof question === "string" ? question.trim() : "";
    if (!q) {
      throw new Error("createChatResponder.answer: a question is required");
    }

    // The retrieved-document-chunk context bucket (slice #12). Failure here must not
    // sink the whole answer — degrade to no document context rather than erroring.
    const k = Number.isFinite(scope.k) ? scope.k : DEFAULT_CONTEXT_K;
    const hits = await retrieve(q, { ...scope, k }).catch(() => []);

    const result = await gemini.generate(
      buildRequest({ userId, question: q, boardText, hits })
    );
    const reply = parseReply(await textOf(result));

    const docMeta = await documentMetaFor(hits);
    const source = classifyProvenance({
      answer: reply.answer,
      citation: reply.citation,
      notInMaterial: reply.notInMaterial,
      boardText,
      hits,
      documents: docMeta,
    });

    return { role: "assistant", text: reply.answer, source };
  }

  return { answer };
}

module.exports = { createChatResponder, DEFAULT_CONTEXT_K };
