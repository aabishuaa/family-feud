// ============================================================
// multiplayer.js — WebSocket client for the host (game screen)
// Loaded before game.js; exposes a global Multiplayer object.
// game.js calls Multiplayer.createRoom(), Multiplayer.connect(),
// and Multiplayer.broadcast() at key moments.
// ============================================================

const Multiplayer = (() => {
  let ws         = null;
  let gameCode   = null;
  let hostToken  = null;
  let team1Url   = null;
  let team2Url   = null;
  let connected  = false;
  const playerOnline = [false, false];

  // Callback set by game.js so buzz events call into game logic
  let onBuzz = null;

  // ── Room creation ─────────────────────────────────────────
  async function createRoom(packId) {
    try {
      const res = await fetch('/api/create-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId: packId || 'default' }),
      });
      if (!res.ok) throw new Error('Server unavailable');
      const data = await res.json();
      gameCode  = data.gameCode;
      hostToken = data.hostToken;

      const base = window.location.origin;
      team1Url = `${base}/player.html?game=${gameCode}&team=0`;
      team2Url = `${base}/player.html?game=${gameCode}&team=1`;

      return { gameCode, team1Url, team2Url };
    } catch {
      return null; // Server not available — fall back to local play
    }
  }

  // ── WebSocket connection ──────────────────────────────────
  function connect() {
    if (!gameCode || !hostToken) return;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', gameCode, role: 'host', token: hostToken }));
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'joined') {
        connected = true;
      }

      if (msg.type === 'player-joined') {
        playerOnline[msg.team] = true;
        _updatePlayerBadges();
      }

      if (msg.type === 'player-left') {
        playerOnline[msg.team] = false;
        _updatePlayerBadges();
      }

      if (msg.type === 'buzz' && typeof onBuzz === 'function') {
        onBuzz(msg.team);
      }
    };

    ws.onclose = () => { connected = false; };
    ws.onerror = () => {};
  }

  // ── Broadcast phase/state to players ─────────────────────
  function broadcast(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'game-event', ...data }));
    }
  }

  // ── UI helpers ────────────────────────────────────────────
  function _updatePlayerBadges() {
    // Game screen team panels
    const b0 = document.getElementById('team1-online-badge');
    const b1 = document.getElementById('team2-online-badge');
    if (b0) b0.classList.toggle('hidden', !playerOnline[0]);
    if (b1) b1.classList.toggle('hidden', !playerOnline[1]);

    // Codes screen status labels
    const s0 = document.getElementById('mp-p0-status');
    const s1 = document.getElementById('mp-p1-status');
    if (s0) {
      s0.textContent = playerOnline[0] ? '● Connected' : '○ Waiting for player…';
      s0.classList.toggle('mp-connected', playerOnline[0]);
    }
    if (s1) {
      s1.textContent = playerOnline[1] ? '● Connected' : '○ Waiting for player…';
      s1.classList.toggle('mp-connected', playerOnline[1]);
    }

    const g0 = document.getElementById('team1-link-group');
    const g1 = document.getElementById('team2-link-group');
    if (g0) g0.classList.toggle('is-connected', playerOnline[0]);
    if (g1) g1.classList.toggle('is-connected', playerOnline[1]);
  }

  // ── Public API ────────────────────────────────────────────
  return {
    createRoom,
    connect,
    broadcast,
    setOnBuzz(fn) { onBuzz = fn; },
    getGameCode()   { return gameCode; },
    getTeam1Url()   { return team1Url; },
    getTeam2Url()   { return team2Url; },
    isConnected()   { return connected; },
    isPlayerOnline(team) { return playerOnline[team]; },
  };
})();
