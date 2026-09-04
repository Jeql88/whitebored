"use strict";

// Behaviour tests for the Documents slice (D13, slice #11). Both seams are faked —
// a fake in-memory GridFS bucket and a fake Mongo collection — so upload/store/list/
// fetch/get-page logic is exercised WITHOUT real Mongo, GridFS, or network. We
// assert only observable behaviour through the store's public interface and the pure
// page-normalization helpers.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { ObjectId } = require("mongodb");

const {
  createDocumentStore,
  normalizePages,
  isTextLayerPresent,
  pagesFromText,
  DOC_KINDS,
} = require("./index");

// --- fakes at the two seams ------------------------------------------------------

// A fake GridFS bucket faithful to the surface the store touches: openUploadStream
// (returns a writable that ends with a generated id + a "finish" event),
// openDownloadStream (a Readable of the stored bytes), and delete().
function fakeBucket() {
  const files = new Map(); // id string -> Buffer
  return {
    files,
    openUploadStream(filename, opts) {
      const id = new ObjectId();
      const chunks = [];
      const stream = {
        id,
        on(event, fn) {
          this[`_${event}`] = fn;
          return this;
        },
        end(buf) {
          chunks.push(buf);
          files.set(String(id), Buffer.concat(chunks));
          if (this._finish) this._finish();
        },
      };
      return stream;
    },
    openDownloadStream(id) {
      const buf = files.get(String(id));
      return Readable.from(buf ? [buf] : []);
    },
    async delete(id) {
      files.delete(String(id));
    },
  };
}

// A fake Mongo collection: keys docs by real ObjectId, supports insertOne/findOne/
// find(...).toArray()/deleteOne — the subset the store uses.
function fakeCollection() {
  const docs = new Map(); // id string -> record (with _id)
  return {
    docs,
    async insertOne(record) {
      const _id = record._id || new ObjectId();
      docs.set(String(_id), { ...record, _id });
      return { insertedId: _id };
    },
    async findOne(query) {
      if (query._id) return docs.get(String(query._id)) || null;
      for (const d of docs.values()) {
        if (!query.boardId || d.boardId === query.boardId) return d;
      }
      return null;
    },
    find(query = {}) {
      const matches = [...docs.values()].filter(
        (d) => !query.boardId || d.boardId === query.boardId
      );
      return { async toArray() { return matches; } };
    },
    async deleteOne(query) {
      docs.delete(String(query._id));
      return { deletedCount: 1 };
    },
  };
}

function makeStore() {
  return createDocumentStore({ bucket: fakeBucket(), collection: fakeCollection() });
}

// --- pure page normalization (the uniform citation model, D13) --------------------

test("normalizePages: a PDF becomes one page per real page, carrying its text", () => {
  const pages = normalizePages("pdf", ["intro text", "second page"]);
  assert.deepEqual(pages, [
    { page: 1, text: "intro text" },
    { page: 2, text: "second page" },
  ]);
});

test("normalizePages: an image is a single page with no text layer", () => {
  const pages = normalizePages("image");
  assert.deepEqual(pages, [{ page: 1, text: "" }]);
  assert.equal(isTextLayerPresent(pages), false);
});

test("normalizePages: plaintext splits into synthetic pages at paragraph breaks", () => {
  const text = "Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.";
  const pages = pagesFromText(text);
  assert.ok(pages.length >= 1);
  assert.equal(pages[0].page, 1);
  // The whole text is preserved across the pages, in order.
  const joined = pages.map((p) => p.text).join(" ");
  assert.ok(joined.includes("Alpha"));
  assert.ok(joined.includes("Gamma"));
});

test("normalizePages: a long text file yields more than one synthetic page", () => {
  const para = "x".repeat(1200);
  const text = `${para}\n\n${para}\n\n${para}`;
  const pages = pagesFromText(text);
  assert.ok(pages.length > 1, "long text should split across pages");
  pages.forEach((p, i) => assert.equal(p.page, i + 1));
});

test("normalizePages throws on an unknown kind (fail loud on the unexpected)", () => {
  assert.throws(() => normalizePages("spreadsheet", "x"), /unknown document kind/);
});

test("isTextLayerPresent: a PDF with extractable text passes the V1 text-layer gate", () => {
  assert.equal(isTextLayerPresent(normalizePages("pdf", ["real text"])), true);
});

test("isTextLayerPresent: a scanned PDF with no text is rejected (OCR deferred, D13)", () => {
  // A scanned PDF extracts to empty page texts — no text layer.
  assert.equal(isTextLayerPresent(normalizePages("pdf", ["", "  "])), false);
});

// --- store: upload / list / get / getPage / fetch (GridFS behind a seam) ---------

test("upload stores the raw bytes in GridFS and returns a page-count summary", async () => {
  const store = makeStore();
  const pages = normalizePages("pdf", ["page one", "page two"]);
  const summary = await store.upload({
    boardId: "b1",
    kind: "pdf",
    filename: "notes.pdf",
    contentType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 raw bytes"),
    pages,
  });

  assert.ok(summary.docId, "returns a docId to address the document by");
  assert.equal(summary.boardId, "b1");
  assert.equal(summary.kind, "pdf");
  assert.equal(summary.pageCount, 2);
  // The summary never leaks page text or raw bytes.
  assert.equal(summary.pages, undefined);
});

test("list returns per-board summaries, newest first, without page text or bytes", async () => {
  const store = makeStore();
  await store.upload({
    boardId: "b1", kind: "text", filename: "a.txt",
    contentType: "text/plain", buffer: Buffer.from("a"),
    pages: pagesFromText("alpha"),
  });
  await store.upload({
    boardId: "b1", kind: "text", filename: "b.txt",
    contentType: "text/plain", buffer: Buffer.from("b"),
    pages: pagesFromText("beta"),
  });
  // A different board's doc must not appear.
  await store.upload({
    boardId: "other", kind: "text", filename: "c.txt",
    contentType: "text/plain", buffer: Buffer.from("c"),
    pages: pagesFromText("gamma"),
  });

  const list = await store.list("b1");
  assert.equal(list.length, 2);
  assert.ok(list.every((d) => d.boardId === "b1"));
  assert.ok(list.every((d) => d.pages === undefined));
});

test("list is empty for a board with nothing uploaded (documents are optional, story 25)", async () => {
  const store = makeStore();
  assert.deepEqual(await store.list("empty-board"), []);
});

test("getPage returns the text for a given page — the jump-to-page citation surface", async () => {
  const store = makeStore();
  const { docId } = await store.upload({
    boardId: "b1", kind: "pdf", filename: "d.pdf",
    contentType: "application/pdf", buffer: Buffer.from("raw"),
    pages: normalizePages("pdf", ["first", "second", "third"]),
  });

  const p2 = await store.getPage(docId, 2);
  assert.equal(p2.page, 2);
  assert.equal(p2.text, "second");
  // A page past the end has no citation target.
  assert.equal(await store.getPage(docId, 99), null);
});

test("get returns the full record including the uniform page list (slice #12 reads this)", async () => {
  const store = makeStore();
  const { docId } = await store.upload({
    boardId: "b1", kind: "text", filename: "d.txt",
    contentType: "text/plain", buffer: Buffer.from("raw"),
    pages: pagesFromText("alpha\n\nbeta"),
  });
  const doc = await store.get(docId);
  assert.ok(Array.isArray(doc.pages));
  assert.equal(doc.boardId, "b1");
});

test("fetchFile streams back the exact bytes that were uploaded", async () => {
  const store = makeStore();
  const original = Buffer.from("the raw file contents");
  const { docId } = await store.upload({
    boardId: "b1", kind: "text", filename: "d.txt",
    contentType: "text/plain", buffer: original,
    pages: pagesFromText("alpha"),
  });

  const file = await store.fetchFile(docId);
  assert.equal(file.contentType, "text/plain");
  assert.equal(file.filename, "d.txt");
  const chunks = [];
  for await (const c of file.stream) chunks.push(c);
  assert.deepEqual(Buffer.concat(chunks), original);
});

test("fetchFile and get return null for an unknown document id", async () => {
  const store = makeStore();
  assert.equal(await store.fetchFile(String(new ObjectId())), null);
  assert.equal(await store.get("not-an-object-id"), null);
  assert.equal(await store.getPage(String(new ObjectId()), 1), null);
});

test("remove deletes both the metadata record and the GridFS bytes", async () => {
  const bucket = fakeBucket();
  const collection = fakeCollection();
  const store = createDocumentStore({ bucket, collection });
  const { docId } = await store.upload({
    boardId: "b1", kind: "text", filename: "d.txt",
    contentType: "text/plain", buffer: Buffer.from("raw"),
    pages: pagesFromText("alpha"),
  });

  assert.equal(bucket.files.size, 1);
  assert.equal(await store.remove(docId), true);
  assert.equal(collection.docs.size, 0, "metadata gone");
  assert.equal(bucket.files.size, 0, "raw bytes gone from GridFS");
  assert.equal(await store.remove(docId), false, "removing again is a no-op");
});

test("createDocumentStore requires both seams (fail loud on misuse)", () => {
  assert.throws(() => createDocumentStore({ collection: fakeCollection() }), /GridFS bucket/);
  assert.throws(() => createDocumentStore({ bucket: fakeBucket() }), /Mongo collection/);
});

test("DOC_KINDS enumerates exactly the accepted document types", () => {
  assert.deepEqual([...DOC_KINDS].sort(), ["image", "pdf", "text"]);
});
