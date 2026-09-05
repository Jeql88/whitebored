// Per-page PDF text extraction, in the browser (D13).
//
// The server deliberately has no PDF infrastructure: it stores bytes and a uniform
// page model, and the CLIENT is what already renders the PDF, so it is also what
// reads the text layer. This module is the seam between the two — it turns a File
// into the `pageTexts` array the upload route expects, one entry per page, in
// order, so a citation's page number lines up with what the viewer shows.
//
// A PDF with no selectable text (a scan) yields empty strings; the server rejects
// that with a clear 422 rather than storing something retrieval can never read.

import * as pdfjs from "pdfjs-dist";
// Vite resolves this to a hashed asset URL; pdf.js runs its parser in that worker.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Join a page's text items into a readable line. pdf.js hands back positioned
// runs, not sentences, so we insert a break where it marks end-of-line and a
// space otherwise — enough structure for chunking and key-term matching.
function textFromContent(content) {
  return content.items
    .map((item) => (item.str || "") + (item.hasEOL ? "\n" : " "))
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Extract every page's text, in page order. Throws only if the file itself can't
// be parsed — an unreadable PDF is a real error the caller must surface, whereas
// a page that simply has no text is legitimately an empty string.
export async function extractPdfPageTexts(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: bytes }).promise;

  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      pages.push(textFromContent(await page.getTextContent()));
    }
    return pages;
  } finally {
    // Release the worker's copy of the document either way.
    await doc.destroy();
  }
}

// Does this PDF carry a usable text layer? Mirrors the server's V1 gate so the UI
// can explain a scan BEFORE uploading megabytes that will be refused.
export function hasTextLayer(pageTexts) {
  return Array.isArray(pageTexts) && pageTexts.some((t) => typeof t === "string" && t.trim());
}
