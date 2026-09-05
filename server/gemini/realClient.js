"use strict";

// The real Gemini client that plugs into the central module's injectable seam.
//
// It is the *only* place the @google/genai SDK is touched; everything else in the
// module treats the client as an opaque { generate(request) -> Promise<response> }.
// Tests substitute createGeminiStub() here instead, so no test loads the SDK or
// hits the network.
//
//   const client = createRealClient({ apiKey, model });
//   const gemini = createGemini({ client });
//
// `request` shape (what callers pass to gemini.generate, minus the fields the
// module strips for its own use):
//   { contents, config? }  — passed straight to the SDK's generateContent.
//
// Error normalization: a Gemini rate-limit response surfaces as an Error carrying
// `status: 429` (and `retryAfterMs` when the API advertises a retry delay). The
// central module's backoff keys off exactly that shape, and createGeminiStub
// reproduces it, so the fake stays faithful to this real error mode.

// Pull a Retry-After (seconds) out of the SDK error if present, in ms.
function retryAfterMsFrom(err) {
  const header =
    err?.retryAfter ??
    err?.response?.headers?.get?.("retry-after") ??
    err?.headers?.["retry-after"];
  if (header == null) return undefined;
  const secs = Number(header);
  return Number.isFinite(secs) ? secs * 1000 : undefined;
}

function normalizeError(err) {
  // The @google/genai SDK exposes an HTTP status on the error. A 429 (or the
  // RESOURCE_EXHAUSTED status) is the rate-limit case the module retries.
  const status = err?.status ?? err?.code ?? err?.response?.status;
  const isRateLimit =
    status === 429 || err?.status === "RESOURCE_EXHAUSTED";
  if (isRateLimit) {
    const e = new Error(err?.message || "429 Too Many Requests");
    e.status = 429;
    e.cause = err;
    const retryAfterMs = retryAfterMsFrom(err);
    if (retryAfterMs != null) e.retryAfterMs = retryAfterMs;
    return e;
  }
  return err; // fail loud on everything else — propagate unchanged
}

// Free-tier embedding model. Distinct from the generation model; overridable via
// config (GEMINI_EMBED_MODEL) at the wiring seam, defaulted here so the embed path
// works out of the box.
const DEFAULT_EMBED_MODEL = "text-embedding-004";

function createRealClient({ apiKey, model, embedModel = DEFAULT_EMBED_MODEL } = {}) {
  if (!apiKey) {
    throw new Error("createRealClient: a Gemini apiKey is required");
  }
  // Lazy require so the SDK is a hard dependency only for the real path — the
  // stubbed test path never reaches here.
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generate(request) {
      const { userId, contents, config } = request || {};
      void userId; // consumed by the module's throttle; not sent to the model
      try {
        return await ai.models.generateContent({
          model: request?.model || model,
          contents,
          config,
        });
      } catch (err) {
        throw normalizeError(err);
      }
    },

    // Embeddings capability behind the same seam (slice #12/D14). The central
    // module rides its 429 backoff on this exactly as it does generate(). Request
    // shape: { userId, texts: string[], model? }. Resolves to { embeddings: number[][] }
    // aligned to `texts` — the shape the retrieval module normalizes. A 429 is
    // normalized to the same { status: 429 } the module retries on.
    async embed(request) {
      const { userId, texts, model: reqModel } = request || {};
      void userId; // consumed by the module's throttle; not sent to the model
      const list = Array.isArray(texts) ? texts : [texts];
      try {
        const res = await ai.models.embedContent({
          model: reqModel || embedModel,
          contents: list,
        });
        // The SDK returns { embeddings: [{ values: number[] }, ...] }; unwrap to
        // plain number[][] so callers never depend on the SDK's envelope.
        const embeddings = (res?.embeddings || []).map((e) => e?.values || e);
        return { embeddings };
      } catch (err) {
        throw normalizeError(err);
      }
    },
  };
}

// Exported so a test can pin the faithfulness contract: a real Gemini 429 must
// normalize to the same { status: 429, retryAfterMs? } shape the stub fakes and
// the central module retries on.
module.exports = { createRealClient, normalizeError, DEFAULT_EMBED_MODEL };
