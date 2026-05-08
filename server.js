// ============================================================
// server.js — Family Feud multiplayer server
// Express serves the static game files.
// WebSocket handles real-time buzz events between players and host.
// ============================================================

const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// gameCode → Room
const rooms = new Map();

// Remove stale rooms every 30 minutes (rooms older than 4 hours)
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff) rooms.delete(code);
  }
}, 30 * 60 * 1000);

// Unambiguous characters for codes (no 0/O, 1/I/L)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ── HTTP ─────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Create a new game room and return codes to the host
app.post('/api/create-game', (req, res) => {
  let gameCode;
  do {
    gameCode = generateCode(6);
  } while (rooms.has(gameCode));

  const hostToken = generateCode(12);

  rooms.set(gameCode, {
    gameCode,
    hostToken,
    hostWs: null,
    players: [null, null],       // indexed by team (0 = team1, 1 = team2)
    teamNames: ['Team 1', 'Team 2'],
    buzzerActive: false,
    phase: 'intro',
    createdAt: Date.now(),
  });

  res.json({ gameCode, hostToken });
});

// ── WebSocket ─────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let room = null;
  let clientRole = null;   // 'host' | 'player'
  let clientTeam = -1;     // 0 | 1 (players only)

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── JOIN ──
    if (msg.type === 'join') {
      room = rooms.get(msg.gameCode);
      if (!room) {
        safeSend(ws, { type: 'error', message: 'Game not found. Check your code.' });
        return;
      }

      clientRole = msg.role;

      if (clientRole === 'host') {
        if (msg.token !== room.hostToken) {
          safeSend(ws, { type: 'error', message: 'Invalid host token.' });
          return;
        }
        room.hostWs = ws;
        safeSend(ws, { type: 'joined', role: 'host', gameCode: room.gameCode });
        // Tell host about players already connected
        room.players.forEach((p, i) => {
          if (p?.readyState === WebSocket.OPEN) {
            safeSend(ws, { type: 'player-joined', team: i });
          }
        });
        return;
      }

      if (clientRole === 'player') {
        clientTeam = Number(msg.team);
        if (clientTeam !== 0 && clientTeam !== 1) {
          safeSend(ws, { type: 'error', message: 'Invalid team number.' });
          return;
        }
        room.players[clientTeam] = ws;
        safeSend(ws, {
          type: 'joined',
          role: 'player',
          team: clientTeam,
          teamName: room.teamNames[clientTeam],
          buzzerActive: room.buzzerActive,
          phase: room.phase,
        });
        safeSend(room.hostWs, { type: 'player-joined', team: clientTeam });
        return;
      }
    }

    if (!room) return; // Must join before sending other messages

    // ── BUZZ (player → host) ──
    if (msg.type === 'buzz' && clientRole === 'player') {
      safeSend(room.hostWs, { type: 'buzz', team: clientTeam });
      return;
    }

    // ── GAME EVENT (host → players) ──
    if (msg.type === 'game-event' && clientRole === 'host') {
      if (typeof msg.buzzerActive === 'boolean') room.buzzerActive = msg.buzzerActive;
      if (msg.phase) room.phase = msg.phase;
      if (Array.isArray(msg.teamNames)) room.teamNames = msg.teamNames;
      // Relay to all connected players
      room.players.forEach((p) => safeSend(p, msg));
    }
  });

  ws.on('close', () => {
    if (!room) return;
    if (clientRole === 'host') {
      room.hostWs = null;
    } else if (clientRole === 'player' && clientTeam >= 0) {
      room.players[clientTeam] = null;
      safeSend(room.hostWs, { type: 'player-left', team: clientTeam });
    }
  });

  ws.on('error', () => {}); // Prevent unhandled error crashes
});

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nFamily Feud server running → http://localhost:${PORT}`);
  console.log('Share your LAN IP with players, e.g. http://192.168.1.X:3000\n');
});
