"use strict";

// Has the board changed since it was last read?
//
// Per-crop fingerprints already stop unchanged ink being re-sent to the model,
// but the client still rasterizes every crop and uploads megabytes to find that
// out. A board-level check answers the same question before any of that work
// happens, which is what makes "just ask, and it reads only if it needs to"
// affordable on a tier metered in calls per day.
//
// The version is derived from the elements themselves rather than a timestamp:
// a board is re-saved on every pan and zoom, so an updatedAt would report change
// constantly while the ink is identical. Only geometry and content count.

const crypto = require("crypto");

// What makes a stroke the same stroke: where it is, how big it is, and — for
// typed text — what it says. Deliberately NOT included: styling, opacity, z-order,
// selection state, or the version counters Excalidraw bumps on every interaction.
// Those change constantly and never change what the model would read.
function elementSignature(el) {
  if (!el || el.isDeleted) return "";
  const round = (n) => Math.round(Number(n) || 0);
  const parts = [
    el.id,
    el.type,
    round(el.x),
    round(el.y),
    round(el.width),
    round(el.height),
  ];
  // Typed text is read verbatim, so its content is part of its identity.
  if (typeof el.text === "string") parts.push(el.text);
  // A stroke's path matters, but hashing every point is wasteful; its point
  // COUNT distinguishes a redrawn stroke from a moved one cheaply.
  if (Array.isArray(el.points)) parts.push(`p${el.points.length}`);
  return parts.join(":");
}

// A stable id for the readable content of a board. Order-independent, so merely
// re-ordering elements (which Excalidraw does when anything is selected) does not
// read as a change.
function boardVersion(elements = []) {
  const live = (Array.isArray(elements) ? elements : []).filter(
    (el) => el && !el.isDeleted
  );
  if (live.length === 0) return "empty";

  const signatures = live.map(elementSignature).filter(Boolean).sort();
  return crypto.createHash("sha1").update(signatures.join("|")).digest("hex");
}

// Whether a read is needed. Absent either side, assume yes: a board that has
// never been read must be read, and a stored artifact with no version predates
// this check and cannot be trusted to match.
function boardChangedSince(elements, previousVersion) {
  if (!previousVersion) return true;
  return boardVersion(elements) !== previousVersion;
}

module.exports = { boardVersion, boardChangedSince, elementSignature };
