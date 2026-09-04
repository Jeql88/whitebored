"use strict";

// Recognition module — the reading-only pipeline that reads the drawing itself
// (handwriting AND diagram structure) with Gemini, replacing the on-demand Google
// Vision OCR path (PRD D1/D2/D5). Public surface:
//
//   const { groupCrops } = require("./recognition");
//   groupCrops(elements)         → structure-first crops (client-side grouping)
//
//   const { createRecognizer } = require("./recognition");
//   const recognizer = createRecognizer({ gemini, userId });
//   await recognizer.recognize(crops)
//       → [ { cropId, segments: [{ text, uncertain }], sourceElementIds, bbox } ]
//
// All Gemini access goes through the central module (slice #1); this module never
// touches the SDK. See recognize.js and grouping.js for the mechanics.
//
// --- Google Vision fallback (documented, kept behind the same seam) ------------
// The old Google Vision OCR path (`server/routes/ocr.js`) remains available as a
// documented fallback per spec §6 / PRD "Further Notes". It lives behind this
// same reading-only seam: it takes a rendered board image and returns text, which
// maps onto one crop's `segments` (a single certain segment of the Vision text).
// It is NOT the default — Gemini reads structure, which Vision cannot — but it is
// the graceful-degradation route when GEMINI_API_KEY is unset (mirroring the OCR
// route's own GOOGLE_VISION_KEY 503-degradation). Wiring the route swaps in
// whichever recognizer the config supports; the caller sees the same seam.

const { groupCrops } = require("./grouping");
const { createRecognizer, SCHEMA_INSTRUCTION } = require("./recognize");

module.exports = { groupCrops, createRecognizer, SCHEMA_INSTRUCTION };
