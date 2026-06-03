// Board access control. A user may access a board if they own it or are an
// editor. Boards are shared by link; shareAccess and shareMode control guest behavior.

const { ObjectId } = require("mongodb");
const { getCollections } = require("../db");

// Safe ObjectId: returns null instead of throwing on malformed input.
function toObjectId(id) {
  try {
    return new ObjectId(String(id));
  } catch {
    return null;
  }
}

// Resolve the board doc (or null). Centralizes the id guard.
async function getBoard(whiteboardId) {
  const _id = toObjectId(whiteboardId);
  if (!_id) return null;
  const { whiteboards } = getCollections();
  return whiteboards.findOne({ _id });
}

// Can this user access this board?
// Returns { allowed: bool, shareMode: "edit"|"view" }
// - owner or editor → always allowed, full edit
// - guest → allowed only if shareAccess !== "auth"; shareMode controls edit vs view
async function canAccessBoard(user, whiteboardId) {
  const board = await getBoard(whiteboardId);
  if (!board) return { allowed: false, shareMode: "edit" };

  const shareAccess = board.shareAccess || "anyone";
  const shareMode = board.shareMode || "edit";

  if (user?.isGuest) {
    if (shareAccess === "auth") return { allowed: false, shareMode };
    return { allowed: true, shareMode };
  }

  const uid = user?.userId;
  if (!uid) return { allowed: false, shareMode };
  if (String(board.userId) === String(uid)) return { allowed: true, shareMode: "edit" }; // owner always edits

  // Explicit collaborator with a role (editor or viewer)
  const collab = Array.isArray(board.collaborators)
    ? board.collaborators.find((c) => String(c.userId) === String(uid))
    : null;
  if (collab) return { allowed: true, shareMode: collab.role === "viewer" ? "view" : "edit" };

  // Legacy editors array (backward compat)
  if (Array.isArray(board.editors) && board.editors.map(String).includes(String(uid))) {
    return { allowed: true, shareMode: "edit" };
  }

  // Authenticated non-member visiting via link — same logic as guests
  if (shareAccess !== "auth") return { allowed: true, shareMode };
  return { allowed: false, shareMode };
}

module.exports = { canAccessBoard, getBoard, toObjectId };
