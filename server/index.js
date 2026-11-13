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
const TURN_MS = 15000;     // time limit for one turn; then the dice is rolled automatically
const MAX_MISSED = 3;      // this many auto-rolls in a row and the player is removed as inactive
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
  missed: 0,       // turns in a row that were rolled automatically
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
    turnLeft: room.deadline ? Math.max(0, room.deadline - Date.now()) : 0,
    turnMs: TURN_MS,
  };
}

/** Move the turn to the next player who is still playing. */
function advanceTurn(room) {
  const n = room.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (room.turnIndex + i) % n;
    const p = room.players[idx];
    if (!p.finished && !p.left) { room.turnIndex = idx; armTimer(room); return; }
  }
}

function clearTimer(room) {
  clearTimeout(room.timer);
  room.timer = null;
  room.deadline = 0;
}

/** Start the countdown for the current player. When it runs out the dice is rolled for them. */
function armTimer(room) {
  clearTimeout(room.timer);
  if (room.status !== 'playing') { room.deadline = 0; return; }
  room.deadline = Date.now() + TURN_MS;
  room.timer = setTimeout(() => {
    if (room.status !== 'playing') return;
    const player = room.players[room.turnIndex];
    if (!player || player.finished || player.left) return;
    player.missed += 1;
    if (player.missed >= MAX_MISSED) {
      player.left = true; // away too long: out of the game
      if (!checkGameOver(room)) advanceTurn(room);
      io.to(room.code).emit('state', publicState(room));
      return;
    }
    doRoll(room, player);
    io.to(room.code).emit('state', publicState(room));
  }, TURN_MS + 300);
}

/** Roll the dice for a player: move, apply snake / ladder, rank, pass the turn (a 6 gives no extra turn). */
function doRoll(room, player) {
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

  room.lastRoll = { playerId: player.id, roll, from, to: player.pos, jump, rank, n: (room.rollNo = (room.rollNo || 0) + 1) };
  if (!checkGameOver(room)) advanceTurn(room);
  else clearTimer(room);
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
  clearTimer(room);
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
      voice: new Set(), // socket ids that joined the voice chat
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
    armTimer(room);
    io.to(room.code).emit('state', publicState(room));
  });

  socket.on('rollDice', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.status !== 'playing') return;
    const player = room.players[room.turnIndex];
    if (!player || player.id !== socket.id || player.finished || player.left) return; // not your turn

    player.missed = 0;
    doRoll(room, player);
    io.to(room.code).emit('state', publicState(room));
  });

  // ---- Voice chat: the server only relays WebRTC signalling, the audio itself flows peer-to-peer ----
  function voiceLeave() {
    const room = rooms.get(socket.data.code);
    if (!room || !room.voice.delete(socket.id)) return;
    socket.to(room.code).emit('voiceLeft', socket.id);
  }

  socket.on('voiceJoin', (_data, cb) => {
    const room = rooms.get(socket.data.code);
    if (!room) return cb && cb({ ok: false });
    const peers = [...room.voice].filter((id) => id !== socket.id);
    room.voice.add(socket.id);
    cb && cb({ ok: true, peers }); // the newcomer calls everybody already in voice
  });

  socket.on('voiceLeave', voiceLeave);

  socket.on('voiceSignal', ({ to, data } = {}) => {
    const room = rooms.get(socket.data.code);
    if (!room || !room.voice.has(socket.id) || !room.voice.has(to)) return;
    io.to(to).emit('voiceSignal', { from: socket.id, data });
  });

  // Called when a player taps "leave" (or closes the tab): remove them from the room.
  function leave() {
    voiceLeave();
    const room = rooms.get(socket.data.code);
    if (!room) return;
    socket.leave(room.code);
    socket.data.code = null;
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx === -1) return;

    if (room.status === 'lobby') {
      room.players.splice(idx, 1);
    } else {
      room.players[idx].left = true; // keep them in the list so indexes and ranks stay stable
    }

    const connected = room.players.filter((p) => !p.left);
    if (connected.length === 0) { clearTimer(room); rooms.delete(room.code); return; }
    if (room.hostId === socket.id) room.hostId = connected[0].id;

    if (room.status === 'playing') {
      if (!checkGameOver(room) && room.players[room.turnIndex].left) advanceTurn(room);
    }
    if (room.turnIndex >= room.players.length) room.turnIndex = 0;
    io.to(room.code).emit('state', publicState(room));
  }

  socket.on('leaveRoom', leave);
  socket.on('disconnect', leave);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on ${PORT}`));
