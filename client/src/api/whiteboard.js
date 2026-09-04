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
