"use strict";

// Persistence for attached documents (D13). Two seams are injected:
//
//   const store = createDocumentStore({ bucket, collection });
//
//   - bucket     a GridFS bucket (mongodb GridFSBucket) — stores the RAW file
//                bytes. Injected so tests use a fake in-memory bucket, never real
//                Mongo/GridFS. The raw bytes stay in Mongo/Atlas (no new external
//                service).
//   - collection the "documents" metadata collection — one record per uploaded
//                document: its board, kind, filename, GridFS file id, and the
//                normalized uniform page list (from pages.js). Injected so tests
//                use an in-memory fake (same pattern as notes/store.js).
//
// Metadata (the page list, board scoping, listing) lives in the collection; the
// heavy raw bytes live in GridFS. A citation addresses a document by its metadata
// `_id` (docId) + a `page`; the inline viewer fetches page text from metadata and
// the raw file from GridFS. Slice #12 (chunk/embed) reads the same metadata pages.
//
// Public interface:
//   await store.upload({ boardId, kind, filename, contentType, buffer, pages })
//        → { docId, boardId, kind, filename, contentType, pageCount, createdAt }
//   await store.list(boardId)      → [ document summary, … ]  (no page text/bytes)
//   await store.get(docId)         → full document record (incl. pages), or null
//   await store.getPage(docId, n)  → { page, text } for page n, or null
//   await store.fetchFile(docId)   → { stream, contentType, filename }, or null
//   await store.remove(docId)      → true if removed
//
// The store is dumb about validation policy (text-layer requirement, allowed
// kinds): the route enforces that before calling upload(). The store just persists
// what it is given and reads it back — keeping the one seam clean (see notes/store).

const { ObjectId } = require("mongodb");

function toObjectId(id) {
  try {
    return new ObjectId(String(id));
  } catch {
    return null;
  }
}

// Read a Node Readable (GridFS download stream) fully into a Buffer. Used only by
// callers that want the bytes in memory (e.g. re-embedding); the route streams
// straight to the HTTP response instead.
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// Write a Buffer into a GridFS bucket via its upload stream, resolving with the
// created file's id. Kept here so the store owns the GridFS write dance and the
// route stays declarative.
function uploadToBucket(bucket, filename, contentType, buffer) {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      contentType,
    });
    uploadStream.on("error", reject);
    uploadStream.on("finish", () => resolve(uploadStream.id));
    uploadStream.end(buffer);
  });
}

function createDocumentStore({ bucket, collection } = {}) {
  if (!bucket || typeof bucket.openUploadStream !== "function") {
    throw new Error("createDocumentStore: a GridFS bucket is required");
  }
  if (!collection || typeof collection.insertOne !== "function") {
    throw new Error("createDocumentStore: a Mongo collection is required");
  }

  // Summary projection for listing — never ship page text or raw bytes in a list.
  function summarize(doc) {
    if (!doc) return null;
    return {
      docId: String(doc._id),
      boardId: doc.boardId,
      kind: doc.kind,
      filename: doc.filename,
      contentType: doc.contentType,
      pageCount: Array.isArray(doc.pages) ? doc.pages.length : 0,
      createdAt: doc.createdAt,
    };
  }

  async function upload({
    boardId,
    kind,
    filename,
    contentType,
    buffer,
    pages,
  }) {
    if (!boardId) throw new Error("upload: boardId is required");
    if (!Buffer.isBuffer(buffer)) throw new Error("upload: a Buffer is required");

    const fileId = await uploadToBucket(bucket, filename, contentType, buffer);

    const record = {
      boardId,
      kind,
      filename,
      contentType,
      fileId,
      pages: Array.isArray(pages) ? pages : [],
      createdAt: new Date(),
    };
    const { insertedId } = await collection.insertOne(record);
    return summarize({ ...record, _id: insertedId });
  }

  async function list(boardId) {
    if (!boardId) return [];
    const docs = await collection
      .find({ boardId }, { projection: { pages: 0, fileId: 0 } })
      .toArray();
    // Newest first so the tab shows the most recently attached document on top.
    return docs
      .map(summarize)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async function get(docId) {
    const _id = toObjectId(docId);
    if (!_id) return null;
    return collection.findOne({ _id });
  }

  async function getPage(docId, pageNumber) {
    const doc = await get(docId);
    if (!doc || !Array.isArray(doc.pages)) return null;
    const page = doc.pages.find((p) => p.page === Number(pageNumber));
    return page || null;
  }

  // Return a fresh GridFS download stream for the raw file plus its content type,
  // so the route can pipe it to the HTTP response. Null when the doc is unknown.
  async function fetchFile(docId) {
    const doc = await get(docId);
    if (!doc || !doc.fileId) return null;
    return {
      stream: bucket.openDownloadStream(doc.fileId),
      contentType: doc.contentType,
      filename: doc.filename,
    };
  }

  async function remove(docId) {
    const doc = await get(docId);
    if (!doc) return false;
    if (doc.fileId && typeof bucket.delete === "function") {
      await bucket.delete(doc.fileId).catch(() => {});
    }
    await collection.deleteOne({ _id: doc._id });
    return true;
  }

  return { upload, list, get, getPage, fetchFile, remove, summarize };
}

module.exports = { createDocumentStore, streamToBuffer, toObjectId };
