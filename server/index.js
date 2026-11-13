const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { randomUUID } = require('crypto');

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
const TURN_MS = 60000;     // time limit for one turn (1 minute); then the dice is rolled automatically
const PAUSE_MS = 800;      // the number stays on the dice this long before the token starts to move
const DICE_MS = 900;       // the dice tumbles this long on every screen before the number shows
const HOP_MS = 210;        // one square of token movement on the client
const SLIDE_MS = 1100;     // snake / ladder slide on the client
const START_ROLLS = [1, 6]; // a token on the start line only moves out on one of these
const MAX_MISSED = 3;      // this many auto-rolls in a row and the player is removed as inactive
const GRACE_MS = 60000;    // a dropped connection (phone locked, app switched, bad network) has this long to come back
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
  left: false,     // left or was removed (stays in the list during a game so turn order is stable)
  offline: false,  // connection dropped, waiting for the player to come back
  token: randomUUID(), // secret that lets this player rejoin after a reload / reconnect
  grace: null,     // timer that removes the player if they do not come back
});

const publicPlayer = (p) => ({
  id: p.id, name: p.name, color: p.color, pos: p.pos, finished: p.finished,
  rank: p.rank, loser: p.loser, left: p.left, offline: p.offline,
});

function publicState(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map(publicPlayer),
    turnIndex: room.turnIndex,
    lastRoll: room.lastRoll,
    winnerId: room.winnerId,
    turnLeft: room.deadline ? Math.max(0, room.deadline - Date.now()) : 0,
    readyIn: Math.max(0, (room.readyAt || 0) - Date.now()), // dice + token movement still playing on the screens
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
  // the next player's minute starts after the dice and the token movement have finished
  room.deadline = Math.max(Date.now(), room.readyAt || 0) + TURN_MS;
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
  }, Math.max(0, room.deadline - Date.now()) + 300);
}

/** Roll the dice for a player: move, apply snake / ladder, rank, pass the turn (a 6 gives no extra turn). */
function doRoll(room, player) {
  const roll = Math.floor(Math.random() * 6) + 1;
  const from = player.pos;
  const to = from + roll;
  let jump = null;
  const blocked = from === 0 && !START_ROLLS.includes(roll); // needs a 1 or a 6 to start

  if (blocked) {
    // stays on the start line
  } else if (to <= 100) {
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

  room.lastRoll = { playerId: player.id, roll, from, to: player.pos, jump, rank, blocked, n: (room.rollNo = (room.rollNo || 0) + 1) };
  // how long the screens need to show the dice and walk the token before the next player may roll
  const walked = player.pos !== from;
  const steps = walked ? Math.min(roll, 6) : 0;
  room.readyAt = Date.now() + DICE_MS + PAUSE_MS + steps * HOP_MS + (jump ? SLIDE_MS : 0) + 400;

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

/** Take a player out of a room for good (they tapped leave, or did not come back in time). */
function removePlayer(room, player) {
  clearTimeout(player.grace);
  player.grace = null;
  if (room.voice.delete(player.id)) io.to(room.code).emit('voiceLeft', player.id);
  const idx = room.players.indexOf(player);
  if (idx === -1 || player.left) return;

  if (room.status === 'lobby') room.players.splice(idx, 1);
  else player.left = true; // keep them in the list so indexes and ranks stay stable

  const connected = room.players.filter((p) => !p.left);
  if (connected.length === 0) { clearTimer(room); rooms.delete(room.code); return; }
  if (room.hostId === player.id) room.hostId = (connected.find((p) => !p.offline) || connected[0]).id;

  if (room.status === 'playing') {
    if (!checkGameOver(room) && room.players[room.turnIndex].left) advanceTurn(room);
  }
  if (room.turnIndex >= room.players.length) room.turnIndex = 0;
  io.to(room.code).emit('state', publicState(room));
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name } = {}, cb) => {
    leave(); // never be in two rooms at once
    let code;
    do { code = makeCode(); } while (code.length !== 6 || rooms.has(code));
    const host = newPlayer(socket.id, name, COLORS[0]);
    const room = {
      code,
      status: 'lobby',
      hostId: socket.id,
      players: [host],
      turnIndex: 0,
      lastRoll: null,
      winnerId: null,
      finishedCount: 0,
      voice: new Set(), // socket ids that joined the voice chat
      chat: [],         // last text messages of the room
      chatNo: 0,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.code = code;
    cb({ ok: true, code, token: host.token });
    io.to(code).emit('state', publicState(room));
  });

  socket.on('joinRoom', ({ code, name } = {}, cb) => {
    leave();
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.status !== 'lobby') return cb({ ok: false, error: 'Game already started' });
    if (room.players.length >= MAX_PLAYERS) return cb({ ok: false, error: 'Room is full' });
    const color = COLORS.find((c) => !room.players.some((p) => p.color === c));
    const me = newPlayer(socket.id, name, color);
    room.players.push(me);
    socket.join(room.code);
    socket.data.code = room.code;
    cb({ ok: true, code: room.code, token: me.token });
    socket.emit('chatHistory', room.chat);
    io.to(room.code).emit('state', publicState(room));
  });

  // Come back after a reload or a dropped connection: the secret token proves who you are.
  socket.on('rejoinRoom', ({ code, token } = {}, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const p = room && token ? room.players.find((x) => x.token === token) : null;
    if (!p || p.left) return cb({ ok: false, error: 'That game is no longer available' });
    clearTimeout(p.grace);
    p.grace = null;
    p.offline = false;
    const old = p.id;
    if (old !== socket.id) {
      p.id = socket.id;
      if (room.hostId === old) room.hostId = p.id;
      if (room.winnerId === old) room.winnerId = p.id;
      if (room.lastRoll && room.lastRoll.playerId === old) room.lastRoll.playerId = p.id;
      if (room.voice.delete(old)) io.to(room.code).emit('voiceLeft', old);
      io.sockets.sockets.get(old)?.disconnect(true); // the stale connection of the same player
    }
    socket.join(room.code);
    socket.data.code = room.code;
    cb({ ok: true, code: room.code });
    socket.emit('chatHistory', room.chat);
    io.to(room.code).emit('state', publicState(room));
  });

  socket.on('startGame', (_d, cb) => {
    const reply = (r) => typeof cb === 'function' && cb(r);
    const room = rooms.get(socket.data.code);
    if (!room) return reply({ ok: false, error: 'You are not in a room. Go back and rejoin.' });
    if (room.status !== 'lobby') return reply({ ok: true });
    if (room.hostId !== socket.id) return reply({ ok: false, error: 'Only the host can start the game' });
    if (room.players.length < 2) return reply({ ok: false, error: 'Need at least 2 players' });
    room.status = 'playing';
    room.turnIndex = 0;
    room.readyAt = 0;
    armTimer(room);
    reply({ ok: true });
    io.to(room.code).emit('state', publicState(room));
  });

  socket.on('rollDice', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.status !== 'playing') return;
    const player = room.players[room.turnIndex];
    if (!player || player.id !== socket.id || player.finished || player.left) return; // not your turn

    if (Date.now() < (room.readyAt || 0) - 200) return; // previous move is still being shown
    player.missed = 0;
    doRoll(room, player);
    io.to(room.code).emit('state', publicState(room));
  });

  // ---- Text chat: relayed to everybody in the room, last 60 messages are kept for people who rejoin ----
  let lastChat = 0;
  socket.on('chat', ({ text } = {}) => {
    const room = rooms.get(socket.data.code);
    const p = room && room.players.find((x) => x.id === socket.id);
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!p || p.left || !clean || Date.now() - lastChat < 400) return;
    lastChat = Date.now();
    const msg = { id: ++room.chatNo, color: p.color, name: p.name, text: clean, t: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > 60) room.chat.shift();
    io.to(room.code).emit('chat', msg);
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

  // Player tapped leave: out of the room for good.
  function leave() {
    const room = rooms.get(socket.data.code);
    if (!room) return;
    socket.leave(room.code);
    socket.data.code = null;
    const p = room.players.find((x) => x.id === socket.id);
    if (p) removePlayer(room, p);
  }

  // Connection dropped (locked phone, switched app, bad network): keep the seat for a while.
  function dropped() {
    const room = rooms.get(socket.data.code);
    if (!room) return;
    const p = room.players.find((x) => x.id === socket.id); // not found = already rejoined on a new socket
    if (!p || p.left) return;
    if (room.voice.delete(p.id)) io.to(room.code).emit('voiceLeft', p.id);
    p.offline = true;
    clearTimeout(p.grace);
    p.grace = setTimeout(() => removePlayer(room, p), GRACE_MS);
    io.to(room.code).emit('state', publicState(room));
  }

  socket.on('leaveRoom', leave);
  socket.on('disconnect', dropped);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on ${PORT}`));
