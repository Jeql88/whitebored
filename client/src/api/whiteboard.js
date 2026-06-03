import { apiFetch } from "./config";

const WB = "/api/whiteboards";

export function getWhiteboards() {
  return apiFetch(WB);
}

export async function getActiveBoards() {
  const data = await apiFetch(`${WB}/active`);
  return Array.isArray(data.active) ? data.active : [];
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
