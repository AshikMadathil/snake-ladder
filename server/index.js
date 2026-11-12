const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/health', (req, res) => res.send('ok'));   // add this

const server = http.createServer(app);
// const io = new Server(server, {
//   cors: { origin: process.env.CORS_ORIGIN || '*' },
// });
// 2. Allow your frontend (Socket.IO example)
const io = new Server(server, {
    cors: { origin: process.env.CLIENT_URL || "*", methods: ["GET", "POST"] }
  });// Board: 100 squares. Key = start, value = end.
const JUMPS = {
  // ladders
  4: 14, 9: 31, 20: 38, 28: 84, 40: 59, 51: 67, 63: 81, 71: 91,
  // snakes
  17: 7, 54: 34, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 99: 78,
};
const COLORS = ['red', 'blue', 'green', 'yellow'];
const MAX_PLAYERS = 4;
const rooms = new Map();

const makeCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

function publicState(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: room.players,
    turnIndex: room.turnIndex,
    lastRoll: room.lastRoll,
    winnerId: room.winnerId,
  };
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    let code;
    do { code = makeCode(); } while (rooms.has(code));
    const room = {
      code, status: 'lobby', hostId: socket.id,
      players: [{ id: socket.id, name, color: COLORS[0], pos: 0 }],
      turnIndex: 0, lastRoll: null, winnerId: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.code = code;
    cb({ ok: true, code });
    io.to(code).emit('state', publicState(room));
  });

  socket.on('joinRoom', ({ code, name }, cb) => {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.status !== 'lobby') return cb({ ok: false, error: 'Game already started' });
    if (room.players.length >= MAX_PLAYERS) return cb({ ok: false, error: 'Room is full' });
    room.players.push({
      id: socket.id, name, color: COLORS[room.players.length], pos: 0,
    });
    socket.join(room.code);
    socket.data.code = room.code;
    cb({ ok: true, code: room.code });
    io.to(room.code).emit('state', publicState(room));
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || room.players.length < 2) return;
    room.status = 'playing';
    io.to(room.code).emit('state', publicState(room));
  });

  socket.on('rollDice', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.status !== 'playing') return;
    const player = room.players[room.turnIndex];
    if (player.id !== socket.id) return; // not your turn

    const roll = Math.floor(Math.random() * 6) + 1;
    let from = player.pos;
    let to = from + roll;
    let jump = null;

    if (to <= 100) {
      player.pos = to;
      if (JUMPS[to]) {
        jump = { from: to, to: JUMPS[to] };
        player.pos = JUMPS[to];
      }
    } // exact roll needed to land on 100

    room.lastRoll = { playerId: player.id, roll, from, to: player.pos, jump };

    if (player.pos === 100) {
      room.status = 'finished';
      room.winnerId = player.id;
    } else if (roll !== 6) {
      room.turnIndex = (room.turnIndex + 1) % room.players.length; // 6 = extra turn
    }
    io.to(room.code).emit('state', publicState(room));
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code);
    if (!room) return;
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx === -1) return;
    room.players.splice(idx, 1);
    if (room.players.length === 0) return rooms.delete(room.code);
    if (room.hostId === socket.id) room.hostId = room.players[0].id;
    if (room.turnIndex >= room.players.length) room.turnIndex = 0;
    io.to(room.code).emit('state', publicState(room));
  });
});

server.listen(3000, () => console.log('Server on :3000'));

// 1. Use the port Render gives you
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on ${PORT}`));