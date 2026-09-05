import { apiFetch } from "./config";

const WB = "/api/whiteboards";

export function getWhiteboards() {
  return apiFetch(WB);
}

export async function getActiveBoards() {
  const data = await apiFetch(`${WB}/active`);
  return {
    active: Array.isArray(data.active) ? data.active : [],
    users: data.users && typeof data.users === "object" ? data.users : {},
  };
}

// Server-side content search (D20): keyword/substring over board name +
// transcription + typed labels + notes, scoped to boards the user can access.
// Returns [{ board, matchedFields }] so a result can say which source matched.
export async function searchBoards(query, { limit } = {}) {
  const params = new URLSearchParams({ q: query });
  if (limit) params.set("limit", String(limit));
  const data = await apiFetch(`/api/search?${params}`);
  return {
    query: typeof data.query === "string" ? data.query : "",
    results: Array.isArray(data.results) ? data.results : [],
  };
}

export function createWhiteboard(name) {
  return apiFetch(WB, { method: "POST", body: { name } });
}

export function deleteWhiteboard(id) {
  return apiFetch(`${WB}/${id}`, { method: "DELETE" });
}

export async function updateWhiteboard(id, name) {
  const data = await apiFetch(`${WB}/${id}`, { method: "PATCH", body: { name } });
  if (data.error) throw new Error(data.error);
  return data;
}

export function saveThumbnail(id, thumbnail) {
  // Best-effort; thumbnail is non-critical.
  return apiFetch(`${WB}/${id}/thumbnail`, { method: "PUT", body: { thumbnail } });
}

export function getBoardInfo(id) {
  return apiFetch(`${WB}/${id}/info`, { auth: false });
}

export function updateShareSettings(id, settings) {
  return apiFetch(`${WB}/${id}/share`, { method: "PATCH", body: settings });
}

export function duplicateWhiteboard(id) {
  return apiFetch(`${WB}/${id}/duplicate`, { method: "POST" });
}

export async function extractText(id, image) {
  return apiFetch(`${WB}/${id}/ocr`, { method: "POST", body: { image } });
}

export function getComments(whiteboardId) {
  return apiFetch(`${WB}/${whiteboardId}/comments`);
}

export function addComment(whiteboardId, text) {
  return apiFetch(`${WB}/${whiteboardId}/comments`, { method: "POST", body: { text } });
}

export function deleteComment(whiteboardId, commentId) {
  return apiFetch(`${WB}/${whiteboardId}/comments/${commentId}`, { method: "DELETE" });
}

export function getCollaborators(id) {
  return apiFetch(`${WB}/${id}/collaborators`);
}

export function addCollaborator(id, email, role) {
  return apiFetch(`${WB}/${id}/collaborators`, { method: "POST", body: { email, role } });
}

export function removeCollaborator(id, userId) {
  return apiFetch(`${WB}/${id}/collaborators/${userId}`, { method: "DELETE" });
}

export function updateCollaboratorRole(id, userId, role) {
  return apiFetch(`${WB}/${id}/collaborators/${userId}`, { method: "PATCH", body: { role } });
}

// --- Study (slice #9): the board's flashcard/mock-exam cards ---------------------
//
// The full-screen study route reads the board's cards (one data model, two views:
// flashcards + mock exam) and posts a grade back to schedule the card. Cards are the
// server/cards shape ({ id, question, answer, deck, boardId, sourceElementIds,
// reviewState }); grading is applied server-side via SM-2 review() (never client-side).
//
// `deck` scopes the source (story 34): "notes" is the notes-only deck this slice ships;
// "document" and combined decks arrive with the documents/scope slices.

export async function getBoardCards(id, { deck = "notes" } = {}) {
  const params = new URLSearchParams({ deck });
  const data = await apiFetch(`${WB}/${id}/cards?${params}`);
  return {
    cards: Array.isArray(data.cards) ? data.cards : [],
    deck: typeof data.deck === "string" ? data.deck : deck,
    error: data.error,
  };
}

// Post a self-assessed grade (SM-2 quality 0–5) for one card; the server applies
// review() and returns the card's new reviewState. Scheduling is never done client-side.
export function gradeBoardCard(id, cardId, grade, { deck = "notes" } = {}) {
  return apiFetch(`${WB}/${id}/cards/${cardId}/grade`, {
    method: "POST",
    body: { grade, deck },
  });
}

// Generate (or regenerate) a board's card deck from its notes. Regeneration keeps
// a reviewed card's schedule — the server routes it through the shared reconcile
// primitive — so studying progress survives a rebuild.
export function generateBoardCards(id, { deck = "notes", boardElementIds = [] } = {}) {
  return apiFetch(`${WB}/${id}/cards/generate`, {
    method: "POST",
    body: { deck, boardElementIds },
  });
}

// --- Documents (D13) --------------------------------------------------------

export async function getBoardDocuments(id) {
  const data = await apiFetch(`${WB}/${id}/documents`);
  return Array.isArray(data) ? data : [];
}

export function getBoardDocument(id, docId) {
  return apiFetch(`${WB}/${id}/documents/${docId}`);
}

// Upload a document. The caller supplies base64 `data`; for a PDF it also supplies
// `pageTexts` extracted client-side (the server has no PDF infra by design, D13).
export function uploadBoardDocument(id, doc) {
  return apiFetch(`${WB}/${id}/documents`, { method: "POST", body: doc });
}

export function deleteBoardDocument(id, docId) {
  return apiFetch(`${WB}/${id}/documents/${docId}`, { method: "DELETE" });
}

// The raw bytes URL, used by the inline PDF/image viewer (and #page=N deep links).
export function boardDocumentRawUrl(id, docId) {
  return `${WB}/${id}/documents/${docId}/raw`;
}
