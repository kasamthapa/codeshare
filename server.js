/**
 * CodeShare — Production Server
 * Express + Socket.io, in-memory rooms, multi-file tabs.
 */

'use strict';

const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const path        = require('path');
const compression = require('compression');   // gzip all responses
const helmet      = require('helmet');        // security headers

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  // Allow larger payloads (full file content can be big)
  maxHttpBufferSize: 1e6,  // 1 MB
  // Ping/pong to detect stale connections quickly behind proxies
  pingInterval: 25000,
  pingTimeout:  60000,
});

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Middleware ─────────────────────────────────────────────────────────────
app.set('trust proxy', 1);   // required when running behind Fly.io / Railway proxy

app.use(compression());       // gzip — critical for the ~1 MB JS bundle

// Helmet sets safe HTTP headers; disable contentSecurityPolicy so CDN-free
// inline scripts (our <script> blocks) work without a CSP nonce setup.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProd ? '7d' : 0,   // cache static assets in production
}));

// ── Health check (required by Fly.io / load balancers) ────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', rooms: Object.keys(rooms).length }));

// ── In-memory store ────────────────────────────────────────────────────────
const rooms = {};

const AVATAR_COLORS = [
  '#e06c75','#98c379','#e5c07b','#61afef',
  '#c678dd','#56b6c2','#d19a66','#be5046',
];
const pickColor = i => AVATAR_COLORS[i % AVATAR_COLORS.length];

function defaultFiles() {
  return [
    { id:'f1', name:'main.py',   code:'# Python\nprint("Hello, World!")\n',       language:'python'     },
    { id:'f2', name:'script.js', code:'// JavaScript\nconsole.log("Hello!");\n',  language:'javascript' },
    { id:'f3', name:'Main.java', code:'// Java\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello!");\n    }\n}\n', language:'java' },
    { id:'f4', name:'main.cpp',  code:'// C++\n#include <iostream>\nint main() {\n    std::cout << "Hello!" << std::endl;\n    return 0;\n}\n', language:'cpp' },
    { id:'f5', name:'notes.txt', code:'Your notes here…\n',                        language:'text'       },
  ];
}

// ── REST API ───────────────────────────────────────────────────────────────

app.post('/api/create-room', (req, res) => {
  const { roomName, password } = req.body;
  if (!roomName || !password)
    return res.status(400).json({ error: 'Room name and password are required' });

  const name = roomName.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  if (!name)
    return res.status(400).json({ error: 'Room name contains no valid characters' });
  if (rooms[name])
    return res.status(409).json({ error: 'A room with that name already exists' });

  rooms[name] = { password, hostId:null, users:new Map(), files:defaultFiles(), nextFileId:6 };
  console.log(`[room] Created: ${name}`);
  res.json({ success:true, roomName:name });
});

app.post('/api/join-room', (req, res) => {
  const { roomName, password } = req.body;
  const name = roomName.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  if (!rooms[name])     return res.status(404).json({ error:'Room not found' });
  if (rooms[name].password !== password) return res.status(401).json({ error:'Incorrect password' });
  res.json({ success:true, roomName:name });
});

app.get('/room/:name', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'room.html')));

// ── Socket.io ──────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  // join-room: validate, add user, send full state ──────────────────────────
  socket.on('join-room', ({ roomName, password, username }) => {
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

    socket.emit('room-state', {
      files: room.files,
      users: Array.from(room.users.values()),
      hostId: room.hostId,
      currentUser: user,
    });
    socket.to(roomName).emit('user-joined', { users:Array.from(room.users.values()), newUser:user });
    console.log(`[room] ${user.username} joined "${roomName}" (${room.users.size} users)`);
  });

  // code-change: save per-file, relay to others ─────────────────────────────
  socket.on('code-change', ({ roomName, fileId, code }) => {
    const room = rooms[roomName]; if (!room) return;
    const file = room.files.find(f => f.id === fileId);
    if (file) file.code = code;
    socket.to(roomName).emit('code-change', { fileId, code });
  });

  // language-change: save per-file, broadcast to all ────────────────────────
  socket.on('language-change', ({ roomName, fileId, language }) => {
    const room = rooms[roomName]; if (!room) return;
    const file = room.files.find(f => f.id === fileId);
    if (file) file.language = language;
    io.to(roomName).emit('language-change', { fileId, language });
  });

  // file-create ──────────────────────────────────────────────────────────────
  socket.on('file-create', ({ roomName, name }) => {
    const room = rooms[roomName]; if (!room) return;
    const newFile = { id:`f${room.nextFileId++}`, name:name||`untitled.txt`, code:'', language:'text' };
    room.files.push(newFile);
    io.to(roomName).emit('file-created', { file:newFile });
  });

  // file-rename ──────────────────────────────────────────────────────────────
  socket.on('file-rename', ({ roomName, fileId, name }) => {
    const room = rooms[roomName]; if (!room) return;
    const file = room.files.find(f => f.id === fileId);
    if (!file || !name.trim()) return;
    file.name = name.trim();
    io.to(roomName).emit('file-renamed', { fileId, name:file.name });
  });

  // file-delete ──────────────────────────────────────────────────────────────
  socket.on('file-delete', ({ roomName, fileId }) => {
    const room = rooms[roomName];
    if (!room || room.files.length <= 1) return;
    const idx = room.files.findIndex(f => f.id === fileId);
    if (idx === -1) return;
    room.files.splice(idx, 1);
    io.to(roomName).emit('file-deleted', { fileId });
  });

  // disconnect ───────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const roomName = socket.roomName;
    if (!roomName || !rooms[roomName]) return;
    const room = rooms[roomName];
    const leaving = room.users.get(socket.id);
    room.users.delete(socket.id);
    console.log(`[room] ${leaving?.username ?? socket.id} left "${roomName}" (${room.users.size} remaining)`);

    if (room.users.size === 0) { delete rooms[roomName]; return; }
    if (room.hostId === socket.id) {
      const next = room.users.values().next().value;
      next.isHost = true; room.hostId = next.id;
    }
    io.to(roomName).emit('user-left', { users:Array.from(room.users.values()), leftUserId:socket.id, newHostId:room.hostId });
  });
});

// ── Graceful shutdown (Fly.io / Railway send SIGTERM on deploy) ────────────
function shutdown() {
  console.log('\n[server] Shutting down gracefully…');
  server.close(() => {
    console.log('[server] All connections closed. Exiting.');
    process.exit(0);
  });
  // Force-exit after 10 s if connections don't close
  setTimeout(() => process.exit(1), 10_000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

// ── Unhandled errors — log but don't crash ────────────────────────────────
process.on('uncaughtException',  (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

// ── Start ──────────────────────────────────────────────────────────────────
server.listen(PORT, () => console.log(`\n  CodeShare → http://localhost:${PORT}  [${isProd ? 'production' : 'development'}]\n`));
