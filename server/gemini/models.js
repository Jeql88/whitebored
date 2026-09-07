"use strict";

// The Gemini models this app offers, and the rules for choosing between them.
//
// Why a registry rather than a single configured model: the free tier is metered
// PER MODEL, and any one model can be congested at any moment (a trivial prompt on
// gemini-3.6-flash measured 30s against 0.7s on gemini-3.5-flash-lite, and 3.5-flash
// returned 503 "high demand" outright). So the app needs two things a fixed model
// cannot give it: the user can switch when they exhaust one model's daily quota,
// and a request that hits 503/429 can fall through to the next model automatically
// rather than failing the whole board read.
//
// Ordering is deliberate: `fallbackOrder` runs cheapest-and-fastest first. Reading
// handwriting is a bulk, low-judgement job over many small images — the lite models
// do it well and leave the heavier models' quota for work that needs them.

const MODELS = [
  {
    id: "gemini-3.5-flash-lite",
    label: "Flash Lite 3.5",
    note: "Fastest. Best for reading a board.",
    vision: true,
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Flash Lite 3.1",
    note: "Fast, separate quota from 3.5.",
    vision: true,
  },
  {
    id: "gemini-3.7-flash",
    label: "Flash 3.7",
    note: "Stronger reasoning, slower.",
    vision: true,
  },
  {
    id: "gemini-3.8-flash",
    label: "Flash 3.8",
    note: "Newest. Best for writing notes.",
    vision: true,
  },
  {
    id: "gemini-3.6-flash",
    label: "Flash 3.6",
    note: "Often congested; kept as a fallback.",
    vision: true,
  },
];

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

// Reading images is the bulk job: many small crops, no judgement required, so the
// fastest model first. Writing notes is one call over text where quality shows, so
// it leads with a stronger model. Both end at the same tail, giving every request
// several separate quotas to fall through before it can fail.
const READ_ORDER = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
];

const WRITE_ORDER = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.6-flash",
];

// A model is worth failing over from when the FAILURE is about capacity or quota
// rather than the request: 429 (rate limited / quota exhausted) and 503 (the
// model is congested) both succeed on a different model, while a 400 means the
// request itself is wrong and would fail identically everywhere.
function isCapacityError(err) {
  // A per-DAY quota wall is the key's whole allowance, not one model's capacity —
  // falling through would spend more calls to reach the same failure.
  if (err?.quotaExhausted) return false;
  const status = err?.status ?? err?.code;
  if (status === 429 || status === 503) return true;
  const message = String(err?.message || "");
  return /RESOURCE_EXHAUSTED|UNAVAILABLE|high demand|quota/i.test(message);
}

// The order to try for a job, with the user's choice (if any) promoted to the
// front. An unknown id is ignored rather than trusted — it would 404 on every
// crop and look like a broken read.
function orderFor(job, preferred) {
  const base = job === "write" ? WRITE_ORDER : READ_ORDER;
  if (!preferred || !BY_ID.has(preferred)) return [...base];
  return [preferred, ...base.filter((id) => id !== preferred)];
}

module.exports = { MODELS, BY_ID, READ_ORDER, WRITE_ORDER, orderFor, isCapacityError };
