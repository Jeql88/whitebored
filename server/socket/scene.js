// Scene synchronization: full-scene broadcast model.
//
// Each board has exactly one snapshot document in the `scenes` collection.
// On change, a client emits the entire scene; we upsert it and rebroadcast to
// everyone else in the room. On join, we send the stored snapshot back.

const { ObjectId } = require("mongodb");
const { getCollections } = require("../db");

// Strip appState down to what is safe to persist/share. The full Excalidraw
// appState carries a runtime `collaborators` Map and viewport dimensions that
// corrupt remote hydration, so we keep only the document-level background.
function sanitizeAppState(appState = {}) {
  return {
    viewBackgroundColor: appState.viewBackgroundColor || "#ffffff",
  };
}

async function loadScene(whiteboardId) {
  const { scenes } = getCollections();
  const doc = await scenes.findOne({ whiteboardId });
  if (!doc) return null;
  return {
    elements: doc.elements || [],
    appState: sanitizeAppState(doc.appState),
    files: doc.files || {},
  };
}

function registerSceneHandlers(io, socket) {
  const { scenes, whiteboards } = getCollections();

  // Persist + rebroadcast a full scene update.
  socket.on("sceneUpdate", async ({ whiteboardId, elements, appState, files }) => {
    if (!whiteboardId) return;

    const cleanAppState = sanitizeAppState(appState);
    const userId = socket.user.userId;

    await scenes.updateOne(
      { whiteboardId },
      {
        $set: {
          whiteboardId,
          elements: elements || [],
          appState: cleanAppState,
          files: files || {},
          updatedAt: new Date(),
          updatedBy: userId,
        },
      },
      { upsert: true }
    );

    // Rebroadcast to everyone in the room EXCEPT the sender (avoids echo loop).
    socket.to(whiteboardId).emit("sceneUpdate", {
      elements: elements || [],
      appState: cleanAppState,
      files: files || {},
    });

    // Touch the board so the dashboard ordering + editor list stays fresh.
    try {
      await whiteboards.updateOne(
        { _id: new ObjectId(whiteboardId) },
        { $set: { updatedAt: new Date() }, $addToSet: { editors: userId } }
      );
    } catch {
      // whiteboardId may not be a valid ObjectId for ad-hoc/guest boards.
    }
  });
}

module.exports = { registerSceneHandlers, loadScene };
