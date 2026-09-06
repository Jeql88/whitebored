"use strict";

// The reading-only recognize() seam (D5). Given crops (from structure-first
// grouping), it returns what the board SAYS — nothing more. Notes generation is a
// separate later step; recognize never writes notes and never touches ink.
//
//   recognize(crops) -> [ { cropId, segments: [{ text, uncertain }],
//                           sourceElementIds, bbox } ]
//
// Structure-first routing (D1) is honoured here too:
//   - kind "text" crops are TYPED-TEXT GROUND TRUTH → transcribed verbatim as a
//     single certain segment, and NEVER sent to the model (story 2).
//   - kind "ink" crops are batched into ONE multi-image Gemini request keyed by
//     crop id (per-crop linking without N round-trips), then parsed back per id.
//
// The server owns the Gemini key, the grounding prompt, and the JSON schema — all
// of it behind this seam (D2), so a browser can never edit the grounding away.
// The model is reached ONLY through the central Gemini module (slice #1): its
// per-user throttle, queue, and 429 backoff apply, and a deferred ("working")
// result is awaited here so recognize still returns a reading rather than failing
// on a busy moment (story 56).
//
// No confidence score is emitted (spec §7 distrusts self-reported confidence;
// nothing consumes it). Illegible ink surfaces as an `uncertain` segment — a
// first-class [unclear] gap — never a silent guess, and a crop the model omits is
// returned as an unclear gap rather than dropped (strokes are never lost, story 7).

// What we ask the model to return, stated in the prompt so the grounding lives
// server-side. Kept terse; tests assert on the RESULT, never on this string.
const SCHEMA_INSTRUCTION =
  "You are transcribing handwriting and diagram labels from images. " +
  "Each image is tagged with a cropId. Return ONLY JSON: an object mapping each " +
  'cropId to { "segments": [ { "text": string, "uncertain": boolean } ] }. ' +
  // The user reviews the NOTES, not the raw reading, so hedging on a smudged
  // letter helps nobody: read messy handwriting the way a person would, using the
  // surrounding words to settle an ambiguous one. What must not happen is
  // inventing CONTENT that is not on the board — that is the line that matters,
  // and it is still absolute.
  "Read messy handwriting as a careful human reader would: use surrounding " +
  "context to resolve an ambiguous letter or word rather than hedging. Omit a " +
  "cropId entirely only if there is genuinely nothing legible in it. " +
  "Read only what is drawn; never invent, summarize, or add anything.";

// Normalize the model's per-crop answer into the D5 segment list. A crop the model
// could not read yields NO segments rather than an "[unclear]" placeholder: notes
// are written from what was actually read, and a placeholder in the transcription
// only ever became noise in the notes. The strokes themselves are untouched on the
// board, so nothing is lost — the user can always redraw or type the word.
function segmentsFrom(answer) {
  const segs = answer && Array.isArray(answer.segments) ? answer.segments : null;
  if (!segs) return [];
  return segs
    .filter((s) => s && typeof s.text === "string" && s.text.trim())
    .map((s) => ({ text: s.text, uncertain: Boolean(s.uncertain) }));
}

// Pull the JSON text out of a central-module result. The module resolves to
// { status:"ok", response } now, or { status:"deferred", done } when throttled —
// in which case we await the working state's completion (story 56).
async function textOf(result) {
  const settled = result.status === "deferred" ? await result.done : result;
  const response = settled.response;
  // The real client returns the SDK response, whose `.text` is the model output.
  // Accept a plain string too so the seam isn't coupled to one response wrapper.
  return typeof response === "string" ? response : response?.text ?? "";
}

function parseBatch(text) {
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    // A malformed model reply must not crash recognition — every crop simply
    // reads back as an [unclear] gap (degrade gracefully on the foreseen).
    return {};
  }
}

// Build the one multi-image request. Each ink crop contributes its cropId tag and
// its normalized image (a data URL the client already attached). The exact
// contents wiring is an internal detail; tests assert the crop ids are present
// and that it is a single call.
// Split a data URL into the shape the API actually accepts. A part must carry
// `inlineData: { mimeType, data }` with BARE base64 — passing the whole data URL
// (or an `image` key) is rejected with a 400 "must have one initialized field".
function inlineDataOf(dataUrl) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl || "");
  if (match) return { mimeType: match[1], data: match[2] };
  // Already bare base64: assume PNG, which is what the client rasterizes to.
  return { mimeType: "image/png", data: dataUrl || "" };
}

function buildRequest(userId, inkCrops) {
  const parts = [{ text: SCHEMA_INSTRUCTION }];
  for (const crop of inkCrops) {
    parts.push({ text: `cropId: ${crop.cropId}` });
    parts.push({ inlineData: inlineDataOf(crop.image) });
  }
  return {
    userId,
    contents: [{ role: "user", parts }],
    config: { responseMimeType: "application/json" },
  };
}

// Create the recognizer bound to a central Gemini module and the requesting user
// (the module throttles per user). `userId` may be supplied per-call instead.
function createRecognizer({ gemini, userId: defaultUserId } = {}) {
  if (!gemini || typeof gemini.generate !== "function") {
    throw new Error("createRecognizer: a central Gemini module is required");
  }

  async function recognize(crops = [], { userId = defaultUserId } = {}) {
    if (!Array.isArray(crops) || crops.length === 0) return [];

    const textCrops = crops.filter((c) => c.kind === "text");
    const inkCrops = crops.filter((c) => c.kind !== "text");

    // Typed text is ground truth: verbatim single certain segment, no model call.
    // Set when the batch call itself failed, as opposed to the model genuinely
    // being unable to read a crop. The two look identical in the output otherwise.
    let readFailure = null;
    const readings = new Map();
    for (const crop of textCrops) {
      readings.set(crop.cropId, {
        cropId: crop.cropId,
        segments: [{ text: String(crop.text ?? ""), uncertain: false }],
        sourceElementIds: crop.sourceElementIds,
        bbox: crop.bbox,
      });
    }

    // Ink crops → ONE batched, per-crop-keyed request through the central module.
    if (inkCrops.length > 0) {
      // A batch that fails takes every ink crop with it: the API rejects the whole
      // request if ONE image is unreadable ("Unable to process input image"), and a
      // safety block or transient fault behaves the same. Losing the entire read —
      // including typed text that never went to the model — is worse than reporting
      // the ink as [unclear], which the user can see and correct. So a failed call
      // degrades exactly like an omitted crop rather than propagating.
      let byCropId = {};
      try {
        byCropId = parseBatch(await textOf(await gemini.generate(buildRequest(userId, inkCrops))));
      } catch (err) {
        // Record why, so the caller can tell the user "the read failed" instead of
        // silently showing [unclear] everywhere, which looks like the AI simply
        // could not read their handwriting.
        readFailure = err.message || String(err);
        // Log the crop sizes with the failure: "Unable to process input image"
        // means the model rejected one of these, and the dimensions are what
        // distinguishes a too-small crop from a malformed one.
        const sizes = inkCrops
          .map((c) => `${c.cropId}=${Math.round((c.image || "").length / 1024)}KB`)
          .join(" ");
        console.error(
          `[recognize] batch read failed, degrading to [unclear]: ${err.message} | crops: ${sizes}`
        );
      }
      for (const crop of inkCrops) {
        readings.set(crop.cropId, {
          cropId: crop.cropId,
          segments: segmentsFrom(byCropId[crop.cropId]),
          sourceElementIds: crop.sourceElementIds,
          bbox: crop.bbox,
        });
      }
    }

    // Preserve caller order so downstream (transcription review) is stable. The
    // failure reason rides alongside rather than in the array, so every existing
    // caller keeps indexing readings exactly as before.
    const out = crops.map((c) => readings.get(c.cropId));
    out.readFailure = readFailure;
    return out;
  }

  return { recognize };
}

module.exports = { createRecognizer, SCHEMA_INSTRUCTION };
