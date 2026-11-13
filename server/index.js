const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Snake & Ladder server is running'));
app.get('/health', (req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || '*', methods: ['GET', 'POST'] },
});

// Board: 100 squares. Key = start, value = end.
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

const newPlayer = (id, name, color) => ({
  id,
  name: String(name || 'Player').trim().slice(0, 12) || 'Player',
  color,
  pos: 0,
  finished: false, // reached square 100
  rank: null,      // 1 = first to finish ... the last player gets the final rank
  loser: false,    // the one player left when everybody else has finished
  left: false,     // disconnected during the game (stays in the list so turn order is stable)
});

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

/** Move the turn to the next player who is still playing. */
function advanceTurn(room) {
  const n = room.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (room.turnIndex + i) % n;
    const p = room.players[idx];
    if (!p.finished && !p.left) { room.turnIndex = idx; return; }
  }
}

/** The game ends when at most one player is still playing. */
function checkGameOver(room) {
  const active = room.players.filter((p) => !p.finished && !p.left);
  if (active.length > 1) return false;

  if (active.length === 1) {
    const last = active[0];
    last.finished = true;
    last.rank = ++room.finishedCount;
    if (room.finishedCount === 1) room.winnerId = last.id; // everybody else left: wins by default
    else last.loser = true;                                  // the last one standing is the loser
  }
  room.status = 'finished';
  return true;
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name } = {}, cb) => {
    let code;
    do { code = makeCode(); } while (code.length !== 6 || rooms.has(code));
    const room = {
      code,
      status: 'lobby',
      hostId: socket.id,
      players: [newPlayer(socket.id, name, COLORS[0])],
      turnIndex: 0,
      lastRoll: null,
      winnerId: null,
      finishedCount: 0,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.code = code;
    cb({ ok: true, code });
    io.to(code).emit('state', publicState(room));
  });

  socket.on('joinRoom', ({ code, name } = {}, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.status !== 'lobby') return cb({ ok: false, error: 'Game already started' });
    if (room.players.length >= MAX_PLAYERS) return cb({ ok: false, error: 'Room is full' });
    const color = COLORS.find((c) => !room.players.some((p) => p.color === c));
    room.players.push(newPlayer(socket.id, name, color));
    socket.join(room.code);
    socket.data.code = room.code;
    cb({ ok: true, code: room.code });
    io.to(room.code).emit('state', publicState(room));
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.status !== 'lobby') return;
    if (room.hostId !== socket.id || room.players.length < 2) return;
    room.status = 'playing';
    room.turnIndex = 0;
    io.to(room.code).emit('state', publicState(room));
  });

  socket.on('rollDice', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.status !== 'playing') return;
    const player = room.players[room.turnIndex];
    if (!player || player.id !== socket.id || player.finished || player.left) return; // not your turn

    const roll = Math.floor(Math.random() * 6) + 1;
    const from = player.pos;
    const to = from + roll;
    let jump = null;

    if (to <= 100) {
      player.pos = to;
      if (JUMPS[to]) {
        jump = { from: to, to: JUMPS[to] };
        player.pos = JUMPS[to];
      }
    } // exact roll needed to land on 100

    let rank = null;
    if (player.pos === 100) {
      player.finished = true;
      player.rank = ++room.finishedCount;
      rank = player.rank;
      if (rank === 1) room.winnerId = player.id;
    }

    room.lastRoll = { playerId: player.id, roll, from, to: player.pos, jump, rank };

    if (player.finished) {
      if (!checkGameOver(room)) advanceTurn(room); // others keep playing
    } else if (roll !== 6) {
      advanceTurn(room); // 6 = extra turn
    }
    io.to(room.code).emit('state', publicState(room));
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code);
    if (!room) return;
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx === -1) return;

    if (room.status === 'lobby') {
      room.players.splice(idx, 1);
    } else {
      room.players[idx].left = true; // keep them in the list so indexes and ranks stay stable
    }

    const connected = room.players.filter((p) => !p.left);
    if (connected.length === 0) { rooms.delete(room.code); return; }
    if (room.hostId === socket.id) room.hostId = connected[0].id;

    if (room.status === 'playing') {
      if (!checkGameOver(room) && room.players[room.turnIndex].left) advanceTurn(room);
    }
    if (room.turnIndex >= room.players.length) room.turnIndex = 0;
    io.to(room.code).emit('state', publicState(room));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on ${PORT}`));
