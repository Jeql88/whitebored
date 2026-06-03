// MongoDB connection + collection accessors.
//
// connectDB() must resolve before the HTTP server starts listening, so route
// and socket handlers can rely on the collections being populated. On failure
// we log and exit rather than serving a broken process.

const { MongoClient } = require("mongodb");
const { MONGO_URI, DB_NAME } = require("./config");

const client = new MongoClient(MONGO_URI);
const db = client.db(DB_NAME);

const collections = {
  whiteboards: null,
  scenes: null, // one full-scene snapshot per board
  comments: null,
  users: null,
};

async function connectDB() {
  await client.connect();
  await client.db(DB_NAME).command({ ping: 1 });

  const db = client.db(DB_NAME);
  collections.whiteboards = db.collection("whiteboards");
  collections.scenes = db.collection("scenes");
  collections.comments = db.collection("comments");
  collections.users = db.collection("users");

  // One snapshot doc per board — enforce + speed up lookups by whiteboardId.
  await collections.scenes.createIndex({ whiteboardId: 1 }, { unique: true });

  // Email is the reset identifier — unique when present. `sparse` allows
  // pre-existing accounts that have no email yet.
  await collections.users.createIndex(
    { email: 1 },
    { unique: true, sparse: true }
  );

  // Dashboard lists boards by owner OR editor OR collaborator OR visitor.
  await collections.whiteboards.createIndex({ userId: 1 });
  await collections.whiteboards.createIndex({ editors: 1 });
  await collections.whiteboards.createIndex({ "collaborators.userId": 1 });
  await collections.whiteboards.createIndex({ visitors: 1 });
  // Content search across board name + extracted text (typed + OCR).
  await collections.whiteboards.createIndex({ textIndex: "text", name: "text" });

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
