'use strict';

const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const path        = require('path');
const compression = require('compression');
const helmet      = require('helmet');
const { MongoClient } = require('mongodb');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { maxHttpBufferSize: 1e6, pingInterval: 25000, pingTimeout: 60000 });

const PORT   = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Middleware ─────────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));

// ── In-memory room store ───────────────────────────────────────────────────
const rooms = {};

const AVATAR_COLORS = ['#e06c75','#98c379','#e5c07b','#61afef','#c678dd','#56b6c2','#d19a66','#be5046'];
const pickColor = i => AVATAR_COLORS[i % AVATAR_COLORS.length];

function defaultFiles() {
  return [
    { id:'f1', name:'main.py',    code:'# Python\nprint("Hello, World!")\n',       language:'python'     },
    { id:'f2', name:'script.js',  code:'// JavaScript\nconsole.log("Hello!");\n',  language:'javascript' },
    { id:'f3', name:'Main.java',  code:'// Java\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello!");\n    }\n}\n', language:'java' },
    { id:'f4', name:'main.cpp',   code:'// C++\n#include <iostream>\nint main() {\n    std::cout << "Hello!" << std::endl;\n    return 0;\n}\n', language:'cpp' },
    { id:'f5', name:'Program.cs', code:'// C#\nusing System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello!");\n    }\n}\n', language:'csharp' },
    { id:'f6', name:'notes.txt',  code:'Your notes here…\n', language:'text' },
  ];
}

// ── Access control helper ─────────────────────────────────────────────────
// Returns true if socketId is allowed to make edits in the room
function canEdit(room, socketId) {
  if (!room) return false;
  if (socketId === room.hostId) return true;       // host always can edit
  if (room.defaultAccess === 'edit') return true;  // open-edit room
  return room.editUsers.has(socketId);             // individually granted
}

// ── Room factory ──────────────────────────────────────────────────────────
function makeRoom(overrides = {}) {
  return {
    hostId:        null,
    users:         new Map(),
    files:         defaultFiles(),
    nextFileId:    7,
    defaultAccess: 'edit',    // 'edit' | 'view'
    editUsers:     new Set(), // socket IDs with individual edit grant
    ...overrides,
  };
}

// ── MongoDB persistence ────────────────────────────────────────────────────
let roomsCol  = null;
const saveTimers = {};

async function initDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('[db] No MONGODB_URI set — rooms will not persist across restarts');
    return;
  }
  try {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 6000 });
    await client.connect();
    roomsCol = client.db('codeshare').collection('rooms');

    const docs = await roomsCol.find({}).toArray();
    for (const doc of docs) {
      rooms[doc.name] = makeRoom({
        password:      doc.password,
        files:         doc.files,
        nextFileId:    doc.nextFileId || 7,
        defaultAccess: doc.defaultAccess || 'edit',
      });
    }
    console.log(`[db] Connected to MongoDB. Loaded ${docs.length} room(s).`);
  } catch (err) {
    console.error('[db] Could not connect to MongoDB:', err.message);
    console.log('[db] Continuing without persistence.');
  }
}

async function saveRoom(name) {
  if (!roomsCol || !rooms[name]) return;
  const { password, files, nextFileId, defaultAccess } = rooms[name];
  try {
    await roomsCol.replaceOne(
      { name },
      { name, password, files, nextFileId, defaultAccess, savedAt: new Date() },
      { upsert: true }
    );
  } catch (err) {
    console.error('[db] saveRoom failed:', err.message);
  }
}

function scheduleSave(name) {
  clearTimeout(saveTimers[name]);
  saveTimers[name] = setTimeout(() => saveRoom(name), 2000);
}

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', rooms: Object.keys(rooms).length, db: !!roomsCol })
);

// ── REST API ───────────────────────────────────────────────────────────────

app.post('/api/create-room', async (req, res) => {
  const { roomName, password } = req.body;
  if (!roomName || !password)
    return res.status(400).json({ error: 'Room name and password are required' });

  const name = roomName.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  if (!name)      return res.status(400).json({ error: 'Room name contains no valid characters' });
  if (rooms[name]) return res.status(409).json({ error: 'A room with that name already exists' });

  rooms[name] = makeRoom({ password });
  await saveRoom(name);
  console.log(`[room] Created: ${name}`);
  res.json({ success:true, roomName:name });
});

app.post('/api/join-room', async (req, res) => {
  const { roomName, password } = req.body;
  const name = roomName.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');

  if (!rooms[name] && roomsCol) {
    const doc = await roomsCol.findOne({ name });
    if (doc) rooms[name] = makeRoom({ password:doc.password, files:doc.files, nextFileId:doc.nextFileId||7, defaultAccess:doc.defaultAccess||'edit' });
  }

  if (!rooms[name])                      return res.status(404).json({ error: 'Room not found' });
  if (rooms[name].password !== password) return res.status(401).json({ error: 'Incorrect password' });
  res.json({ success:true, roomName:name });
});

app.get('/room/:name', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'room.html'))
);

// ── Socket.io ──────────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  socket.on('join-room', async ({ roomName, password, username }) => {
    if (!rooms[roomName] && roomsCol) {
      const doc = await roomsCol.findOne({ name: roomName });
      if (doc) rooms[roomName] = makeRoom({ password:doc.password, files:doc.files, nextFileId:doc.nextFileId||7, defaultAccess:doc.defaultAccess||'edit' });
    }

    const room = rooms[roomName];
    if (!room)                      { socket.emit('error',{message:'Room not found'});     return; }
    if (room.password !== password) { socket.emit('error',{message:'Incorrect password'}); return; }

    if (room.users.size === 0 || !room.hostId) room.hostId = socket.id;

    const user = {
      id:       socket.id,
      username: (username||'').trim() || `User${Math.floor(Math.random()*9000)+1000}`,
      color:    pickColor(room.users.size),
      isHost:   socket.id === room.hostId,
      canEdit:  canEdit(room, socket.id),
    };
    room.users.set(socket.id, user);
    socket.roomName = roomName;
    socket.join(roomName);

    socket.emit('room-state', {
      files:         room.files,
      users:         Array.from(room.users.values()),
      hostId:        room.hostId,
      currentUser:   user,
      defaultAccess: room.defaultAccess,
    });
    socket.to(roomName).emit('user-joined', { users:Array.from(room.users.values()), newUser:user });
    console.log(`[room] ${user.username} joined "${roomName}" (${room.users.size} users) canEdit=${user.canEdit}`);
  });

  // ── Mutating events — all guarded by canEdit ──────────────────────────────

  socket.on('code-change', ({ roomName, fileId, code }) => {
    const room = rooms[roomName]; if (!room) return;
    if (!canEdit(room, socket.id)) return;
    const file = room.files.find(f => f.id === fileId);
    if (file) { file.code = code; scheduleSave(roomName); }
    socket.to(roomName).emit('code-change', { fileId, code });
  });

  socket.on('language-change', ({ roomName, fileId, language }) => {
    const room = rooms[roomName]; if (!room) return;
    if (!canEdit(room, socket.id)) return;
    const file = room.files.find(f => f.id === fileId);
    if (file) { file.language = language; saveRoom(roomName); }
    io.to(roomName).emit('language-change', { fileId, language });
  });

  socket.on('file-create', ({ roomName, name }) => {
    const room = rooms[roomName]; if (!room) return;
    if (!canEdit(room, socket.id)) return;
    const newFile = { id:`f${room.nextFileId++}`, name:name||'untitled.txt', code:'', language:'text' };
    room.files.push(newFile);
    saveRoom(roomName);
    io.to(roomName).emit('file-created', { file:newFile });
  });

  socket.on('file-rename', ({ roomName, fileId, name }) => {
    const room = rooms[roomName]; if (!room) return;
    if (!canEdit(room, socket.id)) return;
    const file = room.files.find(f => f.id === fileId);
    if (!file || !name.trim()) return;
    file.name = name.trim();
    saveRoom(roomName);
    io.to(roomName).emit('file-renamed', { fileId, name:file.name });
  });

  socket.on('file-delete', ({ roomName, fileId }) => {
    const room = rooms[roomName];
    if (!room || room.files.length <= 1) return;
    if (!canEdit(room, socket.id)) return;
    const idx = room.files.findIndex(f => f.id === fileId);
    if (idx === -1) return;
    room.files.splice(idx, 1);
    saveRoom(roomName);
    io.to(roomName).emit('file-deleted', { fileId });
  });

  // ── Access control events ─────────────────────────────────────────────────

  // Host switches default access mode for everyone
  socket.on('set-default-access', ({ roomName, access }) => {
    const room = rooms[roomName]; if (!room) return;
    if (room.hostId !== socket.id) return;
    room.defaultAccess = access;
    if (access === 'edit') room.editUsers.clear(); // clear individual grants in open mode
    saveRoom(roomName);
    room.users.forEach((user, sid) => { user.canEdit = canEdit(room, sid); });
    io.to(roomName).emit('access-mode-changed', {
      defaultAccess: access,
      users: Array.from(room.users.values()),
    });
    console.log(`[access] "${roomName}" default access → ${access}`);
  });

  // Guest requests edit access from host
  socket.on('request-edit', ({ roomName }) => {
    const room = rooms[roomName]; if (!room) return;
    const user = room.users.get(socket.id); if (!user) return;
    if (canEdit(room, socket.id)) return; // already has edit
    io.to(room.hostId).emit('edit-requested', { userId: socket.id, username: user.username });
    console.log(`[access] ${user.username} requested edit in "${roomName}"`);
  });

  // Host grants edit to a specific user
  socket.on('grant-edit', ({ roomName, userId }) => {
    const room = rooms[roomName]; if (!room) return;
    if (room.hostId !== socket.id) return;
    room.editUsers.add(userId);
    const user = room.users.get(userId);
    if (user) user.canEdit = true;
    io.to(userId).emit('edit-access-granted');
    io.to(roomName).emit('user-access-updated', { users: Array.from(room.users.values()) });
    console.log(`[access] granted edit to ${user?.username} in "${roomName}"`);
  });

  // Host denies a request
  socket.on('deny-edit', ({ roomName, userId }) => {
    const room = rooms[roomName]; if (!room) return;
    if (room.hostId !== socket.id) return;
    io.to(userId).emit('edit-access-denied');
  });

  // Host revokes edit from a specific user
  socket.on('revoke-edit', ({ roomName, userId }) => {
    const room = rooms[roomName]; if (!room) return;
    if (room.hostId !== socket.id) return;
    room.editUsers.delete(userId);
    const user = room.users.get(userId);
    if (user) user.canEdit = false;
    io.to(userId).emit('edit-access-revoked');
    io.to(roomName).emit('user-access-updated', { users: Array.from(room.users.values()) });
    console.log(`[access] revoked edit from ${user?.username} in "${roomName}"`);
  });

  // ── Chat ──────────────────────────────────────────────────────────────────

  socket.on('chat-message', ({ roomName, text }) => {
    const room = rooms[roomName]; if (!room) return;
    const user = room.users.get(socket.id); if (!user) return;
    const clean = String(text || '').trim().slice(0, 500);
    if (!clean) return;
    io.to(roomName).emit('chat-message', {
      userId:   socket.id,
      username: user.username,
      color:    user.color,
      text:     clean,
      ts:       Date.now(),
    });
  });

  // ── Typing indicators ─────────────────────────────────────────────────────

  socket.on('typing-start', ({ roomName }) => {
    const room = rooms[roomName]; if (!room) return;
    const user = room.users.get(socket.id); if (!user) return;
    socket.to(roomName).emit('typing-start', { userId: socket.id, username: user.username });
  });

  socket.on('typing-stop', ({ roomName }) => {
    const room = rooms[roomName]; if (!room) return;
    socket.to(roomName).emit('typing-stop', { userId: socket.id });
  });

  // ── Live cursors ──────────────────────────────────────────────────────────

  socket.on('cursor-move', ({ roomName, pos }) => {
    const room = rooms[roomName]; if (!room) return;
    const user = room.users.get(socket.id); if (!user) return;
    socket.to(roomName).emit('cursor-move', {
      userId:   socket.id,
      username: user.username,
      color:    user.color,
      pos:      typeof pos === 'number' ? pos : 0,
    });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    const roomName = socket.roomName;
    if (!roomName || !rooms[roomName]) return;
    const room = rooms[roomName];
    const leaving = room.users.get(socket.id);
    room.users.delete(socket.id);
    room.editUsers.delete(socket.id); // clean up any individual grant
    // Clear typing indicator for this user
    socket.to(roomName).emit('typing-stop', { userId: socket.id });
    console.log(`[room] ${leaving?.username ?? socket.id} left "${roomName}" (${room.users.size} remaining)`);

    if (room.users.size === 0) {
      clearTimeout(saveTimers[roomName]);
      saveRoom(roomName);
      delete rooms[roomName];
      console.log(`[room] "${roomName}" evicted from memory (saved to DB)`);
      return;
    }

    if (room.hostId === socket.id) {
      const next = room.users.values().next().value;
      next.isHost = true; next.canEdit = true; room.hostId = next.id;
    }
    io.to(roomName).emit('user-left', { users:Array.from(room.users.values()), leftUserId:socket.id, newHostId:room.hostId });
  });
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
async function shutdown() {
  console.log('\n[server] Shutting down — saving all rooms…');
  await Promise.all(Object.keys(rooms).map(saveRoom));
  server.close(() => { console.log('[server] Done.'); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
process.on('uncaughtException',  err => console.error('[uncaughtException]', err));
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

// ── Start ──────────────────────────────────────────────────────────────────
initDB().then(() => {
  server.listen(PORT, () =>
    console.log(`\n  CodeShare → http://localhost:${PORT}  [${isProd ? 'production' : 'development'}]\n`)
  );
});
