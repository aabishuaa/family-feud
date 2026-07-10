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
  let hostUrl    = null;
  let connected  = false;
  const playerOnline = [false, false];

  // Callbacks set by game.js
  let onBuzz          = null;  // player phone buzzed in
  let onControlAction = null;  // remote host panel pressed a button
  let onControlJoined = null;  // a remote host panel connected (send it fresh state)
  let onConnected     = null;  // this board finished joining the room

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
      hostUrl  = `${base}/host.html?game=${gameCode}&token=${hostToken}`;

      return { gameCode, team1Url, team2Url, hostUrl };
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
        if (typeof onConnected === 'function') onConnected();
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

      if (msg.type === 'control-action' && typeof onControlAction === 'function') {
        onControlAction(msg);
      }

      if (msg.type === 'control-joined' && typeof onControlJoined === 'function') {
        onControlJoined();
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
      s0.innerHTML = `<span class="status-dot"></span> ${playerOnline[0] ? 'Connected' : 'Waiting for player…'}`;
      s0.classList.toggle('mp-connected', playerOnline[0]);
    }
    if (s1) {
      s1.innerHTML = `<span class="status-dot"></span> ${playerOnline[1] ? 'Connected' : 'Waiting for player…'}`;
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
    setOnBuzz(fn)          { onBuzz = fn; },
    setOnControlAction(fn) { onControlAction = fn; },
    setOnControlJoined(fn) { onControlJoined = fn; },
    setOnConnected(fn)     { onConnected = fn; },
    getGameCode()   { return gameCode; },
    getTeam1Url()   { return team1Url; },
    getTeam2Url()   { return team2Url; },
    getHostUrl()    { return hostUrl; },
    isConnected()   { return connected; },
    isPlayerOnline(team) { return playerOnline[team]; },
  };
})();
