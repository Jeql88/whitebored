// Auth routes — merged in from the former standalone auth-service.
// Mounted at /api/auth.

const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config");
const { getCollections } = require("../db");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  const { users } = getCollections();
  if (await users.findOne({ username })) {
    return res.status(400).json({ error: "User exists" });
  }
  const hash = await bcrypt.hash(password, 10);
  await users.insertOne({ username, password: hash });
  res.json({ success: true });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const { users } = getCollections();
  const user = await users.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign({ userId: user._id, username }, JWT_SECRET, {
    expiresIn: "1d",
  });
  res.json({ token });
});

module.exports = router;
