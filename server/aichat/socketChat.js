"use strict";

const { classifyIntent } = require("./intent");

// The AI-chat Socket.IO channel (slice #13, D10) — the "Chat" tab's transport. It
// wires the chat responder to a socket without the responder or its tests ever
// knowing about Socket.IO: the socket is the seam, driven in tests with a fake that
// records emits and fires the inbound event by hand (no real Socket.IO, per the
// slice constraints).
//
//   registerChatHandlers(socket, { responder, canAccess, boardText });
//
// It listens for one client event and emits two:
//   in:  "aiChatMessage" { boardId, text }
//   out: "aiChatReply"   { boardId, message }   the assistant message (see index.js)
//        "aiChatError"   { boardId, error }     denied access or an unexpected fault
//
// This is a SEPARATE channel from the human "Room" chat (chatMessage/chatHistory in
// presence.js), which is untouched — the two chats coexist (D10). Access is checked
// through the injected `canAccess(user, boardId)` seam (mirroring the notes/scene
// handlers) so a client can't ask the AI about a board it can't reach; the board
// context is fetched through the injected `boardText(boardId)` seam so this file
// stays drivable from a unit test with fakes.

function registerChatHandlers(socket, {
  responder,
  canAccess,
  boardText,
  // Optional: when wired, chat can act on the board rather than only describe it.
  needsRead,   // (boardId, elements) -> boolean
  makeNotes,   // (boardId, opts) -> notes record
  makeCards,   // (boardId, opts) -> cards collection
} = {}) {
  if (!responder || typeof responder.answer !== "function") {
    throw new Error("registerChatHandlers: a chat responder is required");
  }

  socket.on("aiChatMessage", async (payload = {}) => {
    const { boardId, text, elements, model } = payload;
    if (!boardId || typeof boardId !== "string") return;
    const question = typeof text === "string" ? text.trim() : "";
    if (!question) return; // empty question — nothing to ask, no model call

    // Gate on board access when a checker is wired (production). Fail closed on a
    // rejected/false check — no reply, and the model is never called.
    if (typeof canAccess === "function") {
      const ok = await canAccess(socket.user, boardId).catch(() => false);
      const allowed = ok === true || (ok && ok.allowed === true);
      if (!allowed) {
        socket.emit("aiChatError", { boardId, error: "forbidden" });
        return;
      }
    }

    try {
      const intent = classifyIntent(question);

      // Tell the user what is about to happen. A request that has to re-read the
      // board takes far longer than one that does not, and silence for that long
      // reads as a hang.
      const stale =
        typeof needsRead === "function"
          ? await needsRead(boardId, elements).catch(() => false)
          : false;
      if (stale) {
        socket.emit("aiChatStatus", {
          boardId,
          status: "reading",
          message: "Your board changed — reading it first…",
        });
      }

      // Acting on the board is a different job from answering about it.
      if (intent === "notes" && typeof makeNotes === "function") {
        socket.emit("aiChatStatus", { boardId, status: "working", message: "Writing your notes…" });
        const record = await makeNotes(boardId, { elements, model, stale, userId: socket.user?.userId });
        socket.emit("aiChatReply", {
          boardId,
          message: {
            role: "assistant",
            text: record?.lines?.length
              ? `I wrote ${record.lines.length} notes from your board. They are in the Notes tab.`
              : "I read your board but could not write notes that trace back to it.",
            source: { bucket: "board", label: "from your board", addableToNotes: false },
            artifact: { kind: "notes", count: record?.lines?.length ?? 0 },
          },
        });
        return;
      }

      if (intent === "cards" && typeof makeCards === "function") {
        socket.emit("aiChatStatus", { boardId, status: "working", message: "Making your flashcards…" });
        const deck = await makeCards(boardId, { elements, model, stale, userId: socket.user?.userId });
        socket.emit("aiChatReply", {
          boardId,
          message: {
            role: "assistant",
            text: deck?.cards?.length
              ? `I made ${deck.cards.length} flashcards. Open Study to review them.`
              : "I could not make flashcards from this board yet — try adding more written detail.",
            source: { bucket: "board", label: "from your board", addableToNotes: false },
            artifact: { kind: "cards", count: deck?.cards?.length ?? 0 },
          },
        });
        return;
      }

      const board =
        typeof boardText === "function"
          ? await boardText(boardId).catch(() => "")
          : "";
      const message = await responder.answer({
        question,
        boardText: board || "",
        scope: { boardId },
        userId: socket.user?.userId,
        // The model the user picked, if any — chat honours the same choice the
        // rest of the app does rather than always taking the server default.
        model,
      });
      socket.emit("aiChatReply", { boardId, message });
    } catch (err) {
      // The central module absorbs rate limits into a working state, so a throw here
      // is a real fault — fail loud to the client rather than leaving it waiting.
      console.error("[aichat] answer failed:", err.message);
      socket.emit("aiChatError", { boardId, error: "answer_failed" });
    }
  });
}

module.exports = { registerChatHandlers };
