// ============================================================
// server.js — Family Feud server
//   • serves static game files
//   • REST API for game packs (modes/categories) — persisted to data/packs.json
//   • WebSocket relays buzz events between players and the host
// ============================================================

const express  = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http     = require('http');
const path     = require('path');
const fs       = require('fs');

const { GAME_PACK_SEEDS, DEFAULT_SETTINGS } = require('./js/data.js');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// ── Pack storage ─────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, 'data');
const PACKS_FILE = path.join(DATA_DIR, 'packs.json');

function loadPacks() {
  try {
    if (!fs.existsSync(PACKS_FILE)) return null;
    const txt = fs.readFileSync(PACKS_FILE, 'utf8');
    const parsed = JSON.parse(txt);
    if (Array.isArray(parsed?.packs)) return parsed.packs;
  } catch (err) {
    console.warn('Failed to load packs.json:', err.message);
  }
  return null;
}

function savePacks(packs) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PACKS_FILE, JSON.stringify({ packs }, null, 2));
}

// In-memory cache of all packs (built-in + custom). Always written through.
let PACKS = loadPacks();
if (!PACKS) {
  PACKS = JSON.parse(JSON.stringify(GAME_PACK_SEEDS));
} else {
  // Refresh built-in packs from seeds (they're read-only, so seeds are the source of truth)
  for (const seed of GAME_PACK_SEEDS.filter((s) => s.builtIn)) {
    const idx = PACKS.findIndex((p) => p.id === seed.id);
    if (idx >= 0) PACKS[idx] = JSON.parse(JSON.stringify(seed));
    else PACKS.unshift(JSON.parse(JSON.stringify(seed)));
  }
  // Migrate custom packs still carrying the old 3-round defaults to the new 4-round structure
  for (const p of PACKS) {
    if (p.builtIn) continue;
    const s = p.settings || {};
    if (s.totalRounds === 3 && (s.roundMultipliers || []).join(',') === '1,2,3') {
      s.totalRounds = DEFAULT_SETTINGS.totalRounds;
      s.roundMultipliers = [...DEFAULT_SETTINGS.roundMultipliers];
    }
  }
}
savePacks(PACKS);

function findPack(id) {
  return PACKS.find((p) => p.id === id);
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 32) || 'pack';
}

function uniqueId(base) {
  let id = base, n = 2;
  while (findPack(id)) { id = `${base}-${n++}`; }
  return id;
}

// Validate / sanitise an incoming pack object before storing.
function sanitisePack(input, existing = null) {
  const settings = { ...DEFAULT_SETTINGS, ...(existing?.settings || {}), ...(input?.settings || {}) };

  const rounds = Array.isArray(input?.rounds) ? input.rounds.map((r, i) => ({
    id: Number(r.id) || (i + 1),
    question: String(r.question || '').slice(0, 500),
    answers: Array.isArray(r.answers)
      ? r.answers.slice(0, 8).map((a, j) => ({
          id:     Number(a.id) || (j + 1),
          text:   String(a.text || '').slice(0, 80),
          points: Math.max(0, Math.min(100, Number(a.points) || 0)),
        }))
      : [],
  })) : (existing?.rounds || []);

  const fmInput = Array.isArray(input?.fastMoneyRounds) ? input.fastMoneyRounds[0] : null;
  const fmQuestions = Array.isArray(fmInput?.questions) ? fmInput.questions.map((q) => ({
    question: String(q.question || '').slice(0, 300),
    answers: Array.isArray(q.answers) ? q.answers.slice(0, 6).map((a) => ({
      text:   String(a.text || '').slice(0, 80),
      points: Math.max(0, Math.min(100, Number(a.points) || 0)),
    })) : [],
  })) : (existing?.fastMoneyRounds?.[0]?.questions || []);

  return {
    id:       existing?.id || input.id,
    name:     String(input?.name || existing?.name || 'Untitled Pack').slice(0, 40),
    icon:     String(input?.icon || existing?.icon || '🎯').slice(0, 4),
    builtIn:  existing?.builtIn === true, // builtIn flag is preserved, never set from user input
    settings,
    rounds,
    fastMoneyRounds: [{ questions: fmQuestions }],
  };
}

// ── Multiplayer rooms ────────────────────────────────────────
const rooms = new Map();

setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff) rooms.delete(code);
  }
}, 30 * 60 * 1000);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// ── HTTP ─────────────────────────────────────────────────────
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname)));

// List packs (summary only, no rounds payload)
app.get('/api/packs', (req, res) => {
  res.json({
    packs: PACKS.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      builtIn: !!p.builtIn,
      roundCount: p.rounds?.length || 0,
      fmCount: p.fastMoneyRounds?.[0]?.questions?.length || 0,
    })),
  });
});

// Full pack
app.get('/api/packs/:id', (req, res) => {
  const pack = findPack(req.params.id);
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  res.json({ pack });
});

// Create pack
app.post('/api/packs', (req, res) => {
  const name = String(req.body?.name || 'New Pack').trim().slice(0, 40);
  const id   = uniqueId(slugify(name));
  const pack = sanitisePack({ ...req.body, name }, { id, builtIn: false });
  pack.id = id;
  PACKS.push(pack);
  savePacks(PACKS);
  res.status(201).json({ pack });
});

// Update pack (cannot edit built-in packs)
app.put('/api/packs/:id', (req, res) => {
  const idx = PACKS.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Pack not found' });
  if (PACKS[idx].builtIn) return res.status(403).json({ error: 'Built-in pack is read-only' });
  PACKS[idx] = sanitisePack(req.body, PACKS[idx]);
  savePacks(PACKS);
  res.json({ pack: PACKS[idx] });
});

// Delete pack
app.delete('/api/packs/:id', (req, res) => {
  const idx = PACKS.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Pack not found' });
  if (PACKS[idx].builtIn) return res.status(403).json({ error: 'Built-in pack cannot be deleted' });
  PACKS.splice(idx, 1);
  savePacks(PACKS);
  res.json({ ok: true });
});

// Create a new game room
app.post('/api/create-game', (req, res) => {
  let gameCode;
  do { gameCode = generateCode(6); } while (rooms.has(gameCode));
  const hostToken = generateCode(12);
  const packId    = String(req.body?.packId || 'default');

  rooms.set(gameCode, {
    gameCode, hostToken, packId,
    hostWs: null,
    players: [null, null],
    controls: [],                // remote host-control connections
    lastEvent: null,             // last game-event, replayed to controls on join
    teamNames: ['Team 1', 'Team 2'],
    buzzerActive: false,
    phase: 'intro',
    createdAt: Date.now(),
  });

  res.json({ gameCode, hostToken });
});

// ── WebSocket ────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let room = null;
  let clientRole = null;
  let clientTeam = -1;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

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
        room.players.forEach((p, i) => {
          if (p?.readyState === WebSocket.OPEN) safeSend(ws, { type: 'player-joined', team: i });
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
          type: 'joined', role: 'player', team: clientTeam,
          teamName:     room.teamNames[clientTeam],
          buzzerActive: room.buzzerActive,
          phase:        room.phase,
        });
        safeSend(room.hostWs, { type: 'player-joined', team: clientTeam });
        return;
      }

      // Remote host-control panel — authenticated with the host token
      if (clientRole === 'control') {
        if (msg.token !== room.hostToken) {
          safeSend(ws, { type: 'error', message: 'Invalid host token.' });
          return;
        }
        room.controls.push(ws);
        safeSend(ws, { type: 'joined', role: 'control', gameCode: room.gameCode });
        // Replay the last known state, then ask the board for a fresh sync
        if (room.lastEvent) safeSend(ws, room.lastEvent);
        safeSend(room.hostWs, { type: 'control-joined' });
        return;
      }
    }

    if (!room) return;

    if (msg.type === 'buzz' && clientRole === 'player') {
      safeSend(room.hostWs, { type: 'buzz', team: clientTeam });
      return;
    }

    // Control panel button presses relayed to the board
    if (msg.type === 'control-action' && clientRole === 'control') {
      safeSend(room.hostWs, msg);
      return;
    }

    if (msg.type === 'game-event' && clientRole === 'host') {
      if (typeof msg.buzzerActive === 'boolean') room.buzzerActive = msg.buzzerActive;
      if (msg.phase) room.phase = msg.phase;
      if (Array.isArray(msg.teamNames)) room.teamNames = msg.teamNames;
      room.lastEvent = msg;
      // Players get the event WITHOUT the sync payload (it contains the answers!)
      const { sync, ...playerMsg } = msg;
      room.players.forEach((p) => safeSend(p, playerMsg));
      // Controls get the full state including answers
      room.controls.forEach((c) => safeSend(c, msg));
    }
  });

  ws.on('close', () => {
    if (!room) return;
    if (clientRole === 'host') {
      room.hostWs = null;
    } else if (clientRole === 'player' && clientTeam >= 0) {
      room.players[clientTeam] = null;
      safeSend(room.hostWs, { type: 'player-left', team: clientTeam });
    } else if (clientRole === 'control') {
      room.controls = room.controls.filter((c) => c !== ws);
    }
  });

  ws.on('error', () => {});
});

// ── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nFamily Feud server running → http://localhost:${PORT}`);
  console.log(`Admin panel  → http://localhost:${PORT}/admin.html`);
  console.log(`Loaded ${PACKS.length} game packs from ${PACKS_FILE}\n`);
});
