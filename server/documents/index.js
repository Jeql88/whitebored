"use strict";

// Documents module facade (D13, slice #11). One place to build the document store
// and reach the pure page-normalization helpers, so the route (and slice #12's
// chunk/embed) import from a single seam.
//
//   const { createDocumentStore } = require("../documents");
//   const store = createDocumentStore({ bucket, collection });
//
// The uniform "pages" model (pages.js) and the GridFS-backed store (store.js) are
// re-exported here. Production wiring (real GridFSBucket + the "documents"
// collection) is built in the route factory from db.js; tests inject fakes at both
// seams so no real Mongo/GridFS is touched.

const {
  createDocumentStore,
  streamToBuffer,
  toObjectId,
} = require("./store");
const {
  DOC_KINDS,
  TEXT_PAGE_TARGET_CHARS,
  isTextLayerPresent,
  normalizePages,
  pagesFromPdf,
  pagesFromImage,
  pagesFromText,
} = require("./pages");

module.exports = {
  createDocumentStore,
  streamToBuffer,
  toObjectId,
  DOC_KINDS,
  TEXT_PAGE_TARGET_CHARS,
  isTextLayerPresent,
  normalizePages,
  pagesFromPdf,
  pagesFromImage,
  pagesFromText,
};
