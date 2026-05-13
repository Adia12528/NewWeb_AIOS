require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

/**
 * AIOS-Lite Mission Control Backend
 * 
 * AUTHORIZATION MODEL:
 * - Leader (role: 'leader', memberIndex: 0): Full authority
 *   * Can view, create, update, delete team members
 *   * Can edit any team member's tasks and credentials
 *   * Can access all management functions
 *   
 * - Team Members (role: 'member', memberIndex: 1-3): Limited authority
 *   * Can only edit their OWN tasks (authorization: memberIndex must match)
 *   * Can view other members' checklists (read-only)
 *   * Cannot change team member names or create/delete members
 *   
 * - Everyone: Progress visibility
 *   * Can see overall team progress and weekly breakdown
 *   * Can see team statistics
 *   * Can view other members' task lists (read-only)
 */

const app = express();
const DATA_FILE = path.join(__dirname, 'progress.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const PORT = process.env.PORT || 3001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB || 'hackathon';
const COLLECTION = process.env.MONGO_COLLECTION || 'progress';
const USERS_COLLECTION = process.env.MONGO_USERS_COLLECTION || 'users';
const RESET_ON_START = process.env.RESET_ON_START === 'true';
const DEFAULT_USERS = [
  { _id: 'leader', username: 'adisoni01', password: 'A12528@as', role: 'leader', name: 'ADI', memberIndex: 0 }
];

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let dbClient;
let collection;
let usersCollection;

function readUsersFile() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    const raw = fs.readFileSync(USERS_FILE, 'utf8') || '[]';
    const users = JSON.parse(raw);
    return Array.isArray(users) ? users : [];
  } catch (e) {
    console.error('Failed reading users file fallback:', e);
    return [];
  }
}

function writeUsersFile(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed writing users file fallback:', e);
    return false;
  }
}

function ensureDefaultLeader(users) {
  const list = Array.isArray(users) ? users.slice() : [];
  const hasLeader = list.some((user) => user && (user.username === DEFAULT_USERS[0].username || user._id === 'leader' || user.memberIndex === 0));
  if (!hasLeader) {
    list.unshift({ ...DEFAULT_USERS[0], createdAt: new Date() });
  }
  return list;
}

async function readUsersSnapshot() {
  if (usersCollection) {
    try {
      return await usersCollection.find({}).toArray();
    } catch (e) {
      console.error('Failed reading users from MongoDB:', e);
    }
  }
  return readUsersFile();
}

async function findUserByQuery(query) {
  if (usersCollection) {
    try {
      return await usersCollection.findOne(query);
    } catch (e) {
      console.error('Failed reading user from MongoDB:', e);
    }
  }

  const users = readUsersFile();
  return users.find((user) => Object.entries(query).every(([key, value]) => user && user[key] === value)) || null;
}

async function persistUsersSnapshot(users) {
  const nextUsers = ensureDefaultLeader(users);

  if (usersCollection) {
    try {
      await usersCollection.deleteMany({});
      if (nextUsers.length) {
        await usersCollection.insertMany(nextUsers);
      }
    } catch (e) {
      console.error('Failed writing users to MongoDB:', e);
    }
  }

  writeUsersFile(nextUsers);
  return nextUsers;
}

async function connectMongo() {
  try {
    dbClient = new MongoClient(MONGO_URI);
    await dbClient.connect();
    const db = dbClient.db(DB_NAME);
    collection = db.collection(COLLECTION);
    usersCollection = db.collection(USERS_COLLECTION);
    console.log('Connected to MongoDB at', MONGO_URI);

    if (RESET_ON_START) {
      try {
        await collection.deleteMany({});
        await usersCollection.deleteMany({});
        console.log('Reset progress state because RESET_ON_START=true');
      } catch (e) {
        console.error('Error clearing database:', e);
      }
    }

    // Initialize the default leader account without wiping existing data
    for (const user of DEFAULT_USERS) {
      const userExists = await usersCollection.findOne({ username: user.username });
      if (!userExists) {
        await usersCollection.insertOne({
          _id: user._id,
          username: user.username,
          password: user.password,
          role: user.role,
          name: user.name,
          memberIndex: user.memberIndex,
          createdAt: new Date()
        });
        console.log(`Created user: ${user.username} (${user.name})`);
      } else {
        // Update existing user with correct credentials
        await usersCollection.updateOne(
          { username: user.username },
          { $set: { name: user.name, password: user.password, role: 'leader', memberIndex: 0 } }
        );
        console.log(`Updated user: ${user.username} (${user.name})`);
      }
    }

    const mongoUsers = await usersCollection.find({}).toArray();
    const fileUsers = readUsersFile();
    if (fileUsers.length > mongoUsers.length) {
      await persistUsersSnapshot(fileUsers);
      console.log('Migrated local users.json -> MongoDB');
    } else {
      writeUsersFile(mongoUsers);
    }

    // migrate file-based state if present and collection empty
    const existing = await collection.findOne({ _id: 'state' });
    if (!existing && fs.existsSync(DATA_FILE)) {
      try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8') || '{}';
        const obj = JSON.parse(raw);
        obj._id = 'state';
        await collection.insertOne(obj);
        console.log('Migrated local progress.json -> MongoDB');
      } catch (e) {
        console.error('Migration failed:', e);
      }
    }
  } catch (e) {
    console.error('MongoDB connection failed:', e);
    dbClient = null;
    writeUsersFile(ensureDefaultLeader(readUsersFile()));
  }
}

// Read state from MongoDB or file fallback
async function readState() {
  if (collection) {
    try {
      const doc = await collection.findOne({ _id: 'state' });
      if (doc) {
        const { _id, ...rest } = doc;
        return rest;
      }
      return {};
    } catch (e) {
      console.error('Failed reading state from MongoDB:', e);
    }
  }
  // fallback to file
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    console.error('Failed reading state file fallback:', e);
    return {};
  }
}

// Write state to MongoDB or file fallback
async function writeState(obj) {
  if (collection) {
    try {
      const doc = Object.assign({}, obj, { _id: 'state' });
      await collection.replaceOne({ _id: 'state' }, doc, { upsert: true });
      return true;
    } catch (e) {
      console.error('Failed writing state to MongoDB:', e);
      return false;
    }
  }
  // fallback to file
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed writing state file fallback:', e);
    return false;
  }
}

// Generate a simple token
function generateToken(user) {
  const payload = {
    username: user.username,
    role: user.role,
    memberIndex: user.memberIndex,
    name: user.name,
    timestamp: Date.now()
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

// Verify token
function verifyToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    return payload;
  } catch (e) {
    return null;
  }
}

// Middleware to extract and verify token from header
function extractUser(req) {
  const authHeader = req.header('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;
  return verifyToken(token);
}

// ===========================
// AUTHENTICATION ENDPOINTS
// ===========================

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }

  try {
    const user = await findUserByQuery({ username });
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        username: user.username,
        role: user.role,
        name: user.name,
        memberIndex: user.memberIndex
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user info from token
app.get('/api/auth/me', async (req, res) => {
  const user = extractUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ user });
});

// Get all users (leader only)
app.get('/api/users', async (req, res) => {
  const user = extractUser(req);
  if (!user || user.role !== 'leader') {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const users = await readUsersSnapshot();
    const userList = users.filter((u) => u.role !== 'leader').map(u => ({
      username: u.username,
      name: u.name,
      memberIndex: u.memberIndex,
      role: u.role
    }));
    res.json({ users: userList });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create or update a team member user (leader only)
app.post('/api/users', async (req, res) => {
  const user = extractUser(req);
  if (!user || user.role !== 'leader') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { username, password, name, memberIndex } = req.body || {};
  const parsedMemberIndex = Number(memberIndex);
  if (!username || !password || name === undefined || memberIndex === undefined || Number.isNaN(parsedMemberIndex)) {
    return res.status(400).json({ error: 'Missing required fields: username, password, name, memberIndex' });
  }

  if (parsedMemberIndex < 0 || parsedMemberIndex > 3) {
    return res.status(400).json({ error: 'memberIndex must be between 0 and 3' });
  }

  try {
    const users = ensureDefaultLeader(await readUsersSnapshot());
    const existingByIndex = users.find((u) => Number(u.memberIndex) === parsedMemberIndex) || null;
    const existingByUsername = users.find((u) => u.username === username) || null;

    if (existingByUsername && (!existingByIndex || existingByUsername.username !== existingByIndex.username)) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const nextUser = {
      username,
      password,
      name,
      memberIndex: parsedMemberIndex,
      role: parsedMemberIndex === 0 ? 'leader' : 'member',
      createdAt: new Date(),
      createdBy: user.username
    };

    if (existingByIndex) {
      const existingIndex = users.findIndex((u) => Number(u.memberIndex) === parsedMemberIndex);
      users[existingIndex] = { ...existingByIndex, ...nextUser, _id: existingByIndex._id || (parsedMemberIndex === 0 ? 'leader' : undefined), updatedAt: new Date() };
      await persistUsersSnapshot(users);
      return res.json({
        status: 'ok',
        user: {
          username,
          name,
          memberIndex: parsedMemberIndex,
          role: parsedMemberIndex === 0 ? 'leader' : 'member'
        }
      });
    }

    const insertDoc = parsedMemberIndex === 0
      ? { _id: 'leader', ...nextUser }
      : nextUser;

    users.push(insertDoc);
    await persistUsersSnapshot(users);
    res.json({
      status: 'ok',
      user: {
        username,
        name,
        memberIndex: parsedMemberIndex,
        role: parsedMemberIndex === 0 ? 'leader' : 'member'
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update a team member's credentials (leader only)
app.patch('/api/users/:username', async (req, res) => {
  const user = extractUser(req);
  if (!user || user.role !== 'leader') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { username } = req.params;
  const { password, name } = req.body || {};

  if (!password && !name) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  try {
    const users = ensureDefaultLeader(await readUsersSnapshot());
    const existingIndex = users.findIndex((u) => u.username === username);

    if (existingIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates = { updatedAt: new Date() };
    if (password) updates.password = password;
    if (name) updates.name = name;
    users[existingIndex] = { ...users[existingIndex], ...updates };
    await persistUsersSnapshot(users);

    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete a team member (leader only)
app.delete('/api/users/:username', async (req, res) => {
  const user = extractUser(req);
  if (!user || user.role !== 'leader') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { username } = req.params;

  try {
    const users = ensureDefaultLeader(await readUsersSnapshot());
    const existing = users.find((u) => u.username === username) || null;
    if (existing && (existing.role === 'leader' || existing.memberIndex === 0)) {
      return res.status(400).json({ error: 'Cannot delete leader account' });
    }

    const nextUsers = users.filter((u) => u.username !== username);
    if (nextUsers.length === users.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    await persistUsersSnapshot(nextUsers);
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ===========================
// STATE ENDPOINTS
// ===========================

// Return current saved state
app.get('/api/state', async (req, res) => {
  try {
    const state = await readState();
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read state' });
  }
});

// Replace entire state (simple persistence)
app.post('/api/state', async (req, res) => {
  const user = extractUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Only leader can replace entire state
  if (user.role !== 'leader') {
    return res.status(403).json({ error: 'Only leader can update global state' });
  }
  
  const payload = req.body || {};
  // verify write token if configured (for backward compatibility)
  const writeToken = process.env.WRITE_TOKEN;
  if (writeToken) {
    const provided = req.header('x-write-token') || req.query.token || '';
    if (provided !== writeToken) return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const ok = await writeState(payload);
    if (!ok) return res.status(500).json({ error: 'Failed to save state' });
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save state' });
  }
});

// Update a single member task (patch)
// AUTHORIZATION: Leader can update any member's task; members can only update their own
app.post('/api/member/:id/task', async (req, res) => {
  const user = extractUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const memberId = String(req.params.id);
  
  // Check authorization: leader can update any member, regular member can only update themselves
  if (user.role !== 'leader' && user.memberIndex !== parseInt(memberId)) {
    return res.status(403).json({ error: 'Cannot update other members\' tasks' });
  }

  const { key, status } = req.body || {};
  if (!key || typeof status === 'undefined') return res.status(400).json({ error: 'Missing key or status' });
  
  // verify write token if configured (for backward compatibility)
  const writeToken = process.env.WRITE_TOKEN;
  if (writeToken) {
    const provided = req.header('x-write-token') || req.query.token || '';
    if (provided !== writeToken) return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const state = await readState();
    state.memberTaskStatus = state.memberTaskStatus || {};
    const memberKey = `${memberId}::${key}`;
    if (status === 'todo') delete state.memberTaskStatus[memberKey];
    else state.memberTaskStatus[memberKey] = status;
    const ok = await writeState(state);
    if (!ok) return res.status(500).json({ error: 'Failed to save state' });
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save member task' });
  }
});

// Simple health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Start server
async function start() {
  await connectMongo();
  app.listen(PORT, () => {
    console.log(`Progress backend listening on http://localhost:${PORT}`);
  });
}

start().catch((e) => {
  console.error('Failed to start server:', e);
  process.exit(1);
});
