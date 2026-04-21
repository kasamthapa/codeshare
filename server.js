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
    { id:'f1', name:'main.py',   code:'# Python\nprint("Hello, World!")\n',       language:'python'     },
    { id:'f2', name:'script.js', code:'// JavaScript\nconsole.log("Hello!");\n',  language:'javascript' },
    { id:'f3', name:'Main.java', code:'// Java\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello!");\n    }\n}\n', language:'java' },
    { id:'f4', name:'main.cpp',  code:'// C++\n#include <iostream>\nint main() {\n    std::cout << "Hello!" << std::endl;\n    return 0;\n}\n', language:'cpp' },
    { id:'f5', name:'Program.cs', code:'// C#\nusing System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello!");\n    }\n}\n', language:'csharp' },
    { id:'f6', name:'notes.txt', code:'Your notes here…\n', language:'text' },
  ];
}

// ── MongoDB persistence ────────────────────────────────────────────────────
// Rooms are kept in memory for fast access AND saved to MongoDB so they
// survive server restarts. Code is saved 2 seconds after the last change
// (debounced) to avoid hammering the DB on every keystroke.

let roomsCol  = null;   // MongoDB collection, null if no DB configured
const saveTimers = {};  // per-room debounce timers

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

    // Load every saved room into memory on startup
    const docs = await roomsCol.find({}).toArray();
    for (const doc of docs) {
      rooms[doc.name] = {
        password:   doc.password,
        files:      doc.files,
        nextFileId: doc.nextFileId || 6,
        hostId:     null,
        users:      new Map(),
      };
    }
    console.log(`[db] Connected to MongoDB. Loaded ${docs.length} room(s).`);
  } catch (err) {
    console.error('[db] Could not connect to MongoDB:', err.message);
    console.log('[db] Continuing without persistence.');
  }
}

// Save a room to MongoDB (called after every mutating operation, debounced for code changes)
async function saveRoom(name) {
  if (!roomsCol || !rooms[name]) return;
  const { password, files, nextFileId } = rooms[name];
  try {
    await roomsCol.replaceOne(
      { name },
      { name, password, files, nextFileId, savedAt: new Date() },
      { upsert: true }
    );
  } catch (err) {
    console.error('[db] saveRoom failed:', err.message);
  }
}

// Debounced save — waits 2 s after the last code-change before writing to DB
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
  if (!name)     return res.status(400).json({ error: 'Room name contains no valid characters' });
  if (rooms[name]) return res.status(409).json({ error: 'A room with that name already exists' });

  rooms[name] = { password, hostId:null, users:new Map(), files:defaultFiles(), nextFileId:7 };
  await saveRoom(name);   // persist immediately
  console.log(`[room] Created: ${name}`);
  res.json({ success:true, roomName:name });
});

app.post('/api/join-room', async (req, res) => {
  const { roomName, password } = req.body;
  const name = roomName.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');

  // Check memory first, then DB (room may have been evicted from memory)
  if (!rooms[name] && roomsCol) {
    const doc = await roomsCol.findOne({ name });
    if (doc) {
      rooms[name] = { password:doc.password, files:doc.files, nextFileId:doc.nextFileId||6, hostId:null, users:new Map() };
    }
  }

  if (!rooms[name])                    return res.status(404).json({ error: 'Room not found' });
  if (rooms[name].password !== password) return res.status(401).json({ error: 'Incorrect password' });
  res.json({ success:true, roomName:name });
});

app.get('/room/:name', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'room.html'))
);

// ── Socket.io ──────────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  socket.on('join-room', async ({ roomName, password, username }) => {
    // If room is not in memory, try loading from DB (handles reconnects after restart)
    if (!rooms[roomName] && roomsCol) {
      const doc = await roomsCol.findOne({ name: roomName });
      if (doc) {
        rooms[roomName] = { password:doc.password, files:doc.files, nextFileId:doc.nextFileId||6, hostId:null, users:new Map() };
      }
    }

    const room = rooms[roomName];
    if (!room)                      { socket.emit('error',{message:'Room not found'});     return; }
    if (room.password !== password) { socket.emit('error',{message:'Incorrect password'}); return; }

    if (room.users.size === 0 || !room.hostId) room.hostId = socket.id;

    const user = {
      id: socket.id,
      username: (username||'').trim() || `User${Math.floor(Math.random()*9000)+1000}`,
      color: pickColor(room.users.size),
      isHost: socket.id === room.hostId,
    };
    room.users.set(socket.id, user);
    socket.roomName = roomName;
    socket.join(roomName);

    socket.emit('room-state', { files:room.files, users:Array.from(room.users.values()), hostId:room.hostId, currentUser:user });
    socket.to(roomName).emit('user-joined', { users:Array.from(room.users.values()), newUser:user });
    console.log(`[room] ${user.username} joined "${roomName}" (${room.users.size} users)`);
  });

  socket.on('code-change', ({ roomName, fileId, code }) => {
    const room = rooms[roomName]; if (!room) return;
    const file = room.files.find(f => f.id === fileId);
    if (file) { file.code = code; scheduleSave(roomName); }   // debounced DB write
    socket.to(roomName).emit('code-change', { fileId, code });
  });

  socket.on('language-change', ({ roomName, fileId, language }) => {
    const room = rooms[roomName]; if (!room) return;
    const file = room.files.find(f => f.id === fileId);
    if (file) { file.language = language; saveRoom(roomName); }
    io.to(roomName).emit('language-change', { fileId, language });
  });

  socket.on('file-create', ({ roomName, name }) => {
    const room = rooms[roomName]; if (!room) return;
    const newFile = { id:`f${room.nextFileId++}`, name:name||'untitled.txt', code:'', language:'text' };
    room.files.push(newFile);
    saveRoom(roomName);
    io.to(roomName).emit('file-created', { file:newFile });
  });

  socket.on('file-rename', ({ roomName, fileId, name }) => {
    const room = rooms[roomName]; if (!room) return;
    const file = room.files.find(f => f.id === fileId);
    if (!file || !name.trim()) return;
    file.name = name.trim();
    saveRoom(roomName);
    io.to(roomName).emit('file-renamed', { fileId, name:file.name });
  });

  socket.on('file-delete', ({ roomName, fileId }) => {
    const room = rooms[roomName];
    if (!room || room.files.length <= 1) return;
    const idx = room.files.findIndex(f => f.id === fileId);
    if (idx === -1) return;
    room.files.splice(idx, 1);
    saveRoom(roomName);
    io.to(roomName).emit('file-deleted', { fileId });
  });

  socket.on('disconnect', () => {
    const roomName = socket.roomName;
    if (!roomName || !rooms[roomName]) return;
    const room = rooms[roomName];
    const leaving = room.users.get(socket.id);
    room.users.delete(socket.id);
    console.log(`[room] ${leaving?.username ?? socket.id} left "${roomName}" (${room.users.size} remaining)`);

    // Room is empty — remove from memory but KEEP in DB so code persists
    if (room.users.size === 0) {
      clearTimeout(saveTimers[roomName]);
      saveRoom(roomName);   // final save before evicting from memory
      delete rooms[roomName];
      console.log(`[room] "${roomName}" evicted from memory (saved to DB)`);
      return;
    }

    if (room.hostId === socket.id) {
      const next = room.users.values().next().value;
      next.isHost = true; room.hostId = next.id;
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
