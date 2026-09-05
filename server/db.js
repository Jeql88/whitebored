// MongoDB connection + collection accessors.
//
// connectDB() must resolve before the HTTP server starts listening, so route
// and socket handlers can rely on the collections being populated. On failure
// we log and exit rather than serving a broken process.

const { MongoClient } = require("mongodb");
const { MONGO_URI, DB_NAME } = require("./config");

const client = new MongoClient(MONGO_URI, {
  serverSelectionTimeoutMS: 5000,  // fail fast if Atlas is unreachable
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,                 // one dyno doesn't need more; free Atlas caps at 500
});
const db = client.db(DB_NAME);

const collections = {
  whiteboards: null,
  scenes: null, // one full-scene snapshot per board
  comments: null,
  users: null,
  notes: null, // one Notes artifact record per board (Sketch-to-Notes, D6)
  spaces: null, // group-study Space entity (Sketch-to-Notes, D21) — members + boards
};

async function connectDB() {
  await client.connect();
  await client.db(DB_NAME).command({ ping: 1 });

  const db = client.db(DB_NAME);
  collections.whiteboards = db.collection("whiteboards");
  collections.scenes = db.collection("scenes");
  collections.comments = db.collection("comments");
  // BetterAuth's mongo-adapter stores users in the SINGULAR "user" collection
  // (its default model name), not "users". Pointing here is essential: collab
  // lookups, the share "People with access" list, and admin user management all
  // resolve accounts through this handle.
  collections.users = db.collection("user");
  collections.notes = db.collection("notes");
  // Group-study Spaces (D21). A Space has members and gathers boards that carry its id.
  collections.spaces = db.collection("spaces");

  // One snapshot doc per board — enforce + speed up lookups by whiteboardId.
  await collections.scenes.createIndex({ whiteboardId: 1 }, { unique: true });

  // One Notes artifact record per board (D6/story 8) — enforce + speed lookups.
  await collections.notes.createIndex({ boardId: 1 }, { unique: true });

  // Dashboard lists boards by owner OR editor OR collaborator OR visitor.
  await collections.whiteboards.createIndex({ userId: 1 });
  await collections.whiteboards.createIndex({ editors: 1 });
  await collections.whiteboards.createIndex({ "collaborators.userId": 1 });
  await collections.whiteboards.createIndex({ visitors: 1 });
  // Content search (Sketch-to-Notes D20) across board name + the three extracted-text
  // fields: transcribed handwriting, typed labels, and generated notes. Replaces the
  // old flat `textIndex`. The search endpoint (/api/search) does substring matching so
  // it can report WHICH field matched; this text index still speeds keyword lookups.
  await collections.whiteboards.createIndex({
    name: "text",
    transcriptionText: "text",
    typedLabelsText: "text",
    notesText: "text",
  });
  // Default dashboard sort — without this every list request is a full collection scan.
  await collections.whiteboards.createIndex({ updatedAt: -1 });
  // Space membership grants visibility/search of boards carrying a spaceId (D21). This
  // index speeds the widened search scope's `{ spaceId: { $in } }` clause and the
  // spaceBoardIds lookup. Additive — it does not affect existing per-board sharing.
  await collections.whiteboards.createIndex({ spaceId: 1 });
  // Space membership lookup (which Spaces a user belongs to → memberSpaceIds).
  await collections.spaces.createIndex({ members: 1 });
  // Comment listing per board.
  await collections.comments.createIndex({ whiteboardId: 1, createdAt: 1 });

  console.log(`[db] Connected to MongoDB database "${DB_NAME}"`);
}

// Accessors — throw if used before connectDB() resolves (programming error).
function getCollections() {
  if (!collections.whiteboards) {
    throw new Error("[db] getCollections() called before connectDB() resolved");
  }
  return collections;
}

module.exports = { connectDB, getCollections, client, db };
