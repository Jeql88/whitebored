"use strict";

// The streaming seam (D9): notes stream line-by-line over the EXISTING Socket.IO
// channel. This wires the notes generator to a socket without the generator or its
// tests ever knowing about Socket.IO — the socket is the seam, driven in tests with
// a fake that records emits and lets a test fire the incoming event by hand (no
// real Socket.IO, per the slice constraints).
//
//   registerNotesHandlers(socket, { generator, store, canAccess });
//
// It listens for one client event and emits three:
//   in:  "generateNotes"  { boardId, transcription, noteType }
//   out: "notesLine"      { boardId, line }     one per VERIFIED line, as ready
//        "notesDone"      { boardId, record }   the persisted record, when complete
//        "notesError"     { boardId, error }    on an unexpected failure
//
// The generator's `onLine` callback is bridged straight to a `notesLine` emit, so a
// line reaches the client the moment it passes local verification — nothing
// flickers, because an un-traceable line is dropped inside the generator and never
// emitted (D9). When generation finishes the record is persisted (one per board,
// story 8) and `notesDone` carries it so a late-joining or reloading client can
// render the whole artifact.
//
// Access is checked through the injected `canAccess(user, boardId)` seam (mirroring
// the scene/presence handlers) so a client can't generate notes for a board it
// can't reach. All deps are injected so this file is drivable from a unit test with
// fakes; the production wiring in socket/index.js passes the real generator, store,
// and access check.

function registerNotesHandlers(socket, { generator, store, canAccess } = {}) {
  if (!generator || typeof generator.generate !== "function") {
    throw new Error("registerNotesHandlers: a notes generator is required");
  }

  socket.on("generateNotes", async (payload = {}) => {
    const { boardId, transcription, noteType } = payload;
    if (!boardId) return;

    // Gate on board access when a checker is wired (production). A test may omit it
    // to drive the generator directly. Fail closed on a rejected/false check.
    if (typeof canAccess === "function") {
      const ok = await canAccess(socket.user, boardId).catch(() => false);
      const allowed = ok === true || (ok && ok.allowed === true);
      if (!allowed) {
        socket.emit("notesError", { boardId, error: "forbidden" });
        return;
      }
    }

    try {
      const userId = socket.user?.userId;
      const record = await generator.generate({
        transcription,
        noteType,
        boardId,
        userId,
        // Bridge each verified line straight to the client as it is confirmed.
        onLine: (line) => socket.emit("notesLine", { boardId, line }),
      });

      // Persist the whole artifact (one record per board) before signalling done,
      // so a reload after "done" always finds the notes.
      if (store && typeof store.save === "function") {
        await store.save(record).catch((err) => {
          // Persistence failure is unexpected but must not lose the streamed lines
          // the client already has; surface it rather than swallowing it.
          console.error("[notes] persist failed:", err.message);
        });
      }

      socket.emit("notesDone", { boardId, record });
    } catch (err) {
      // Generation itself failing is unexpected (the central module absorbs rate
      // limits into a working state, so this is a real fault) — fail loud to the
      // client rather than leaving it spinning.
      console.error("[notes] generation failed:", err.message);
      socket.emit("notesError", { boardId, error: "generation_failed" });
    }
  });
}

module.exports = { registerNotesHandlers };
