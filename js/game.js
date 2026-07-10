// ============================================================
// game.js — Family Feud Game Engine
// ============================================================

(function () {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const $q = (sel, ctx = document) => ctx.querySelector(sel);
  const $all = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  // ── State ──────────────────────────────────────────────────
  const state = {
    phase: 'intro',      // intro | setup | faceoff | playing | steal | revealAll | roundEnd | fastMoney | gameEnd
    round: 0,            // 0-based index into GAME_DATA.rounds
    teams: [
      { name: 'Team 1', score: 0 },
      { name: 'Team 2', score: 0 },
    ],
    activeTeam: 0,       // index 0 or 1
    strikes: 0,
    roundPoints: 0,
    revealedAnswers: new Set(), // answer IDs revealed this round
    currentRound: null,  // pointer to current GAME_DATA.rounds[n]
    multiplier: 1,
    usedRounds: [],      // tracks which round IDs have been used
    fmCurrentPlayer: 0,
    fmScores: [0, 0],
    fmTimer: null,
    fmTimeLeft: 0,
    fmCurrentQ: 0,
    confettiAnimId: null,
    selectedPackId: 'default',
    availablePacks: [],
  };

  // ── Phase transition ───────────────────────────────────────
  function setPhase(phase) {
    state.phase = phase;
    document.body.dataset.phase = phase;
    updateControlButtons();
    updateStatusBar();
    broadcastState();
  }

  // Push full game state to the server. Player phones receive only the
  // phase/buzzer fields (server strips `sync`); remote host-control
  // panels receive everything, including answers, so the host can
  // reveal from another device.
  function broadcastState() {
    Multiplayer.broadcast({
      phase: state.phase,
      buzzerActive: state.phase === 'faceoff',
      teamNames: [state.teams[0].name, state.teams[1].name],
      sync: {
        round:       state.round,
        totalRounds: GAME_DATA?.settings?.totalRounds ?? 4,
        multiplier:  state.multiplier,
        question:    state.currentRound?.question || '',
        answers: (state.currentRound?.answers || []).map((a) => ({
          id: a.id,
          text: a.text,
          points: a.points * state.multiplier,
          revealed: state.revealedAnswers.has(a.id),
        })),
        strikes:     state.strikes,
        maxStrikes:  GAME_DATA?.settings?.maxStrikes ?? 3,
        roundPoints: state.roundPoints,
        scores:      [state.teams[0].score, state.teams[1].score],
        activeTeam:  state.activeTeam,
        fastMoneyNext: $('btn-start-round')?.dataset.fastMoney === 'true',
      },
    });
  }

  // ── Screen management ──────────────────────────────────────
  function showScreen(id) {
    $all('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
  }

  // ── Shuffle helper ─────────────────────────────────────────
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── START GAME ─────────────────────────────────────────────
  async function startGame() {
    Sounds.init();
    const n1 = $('team1-name-input').value.trim() || 'Team 1';
    const n2 = $('team2-name-input').value.trim() || 'Team 2';
    state.teams[0] = { name: n1, score: 0 };
    state.teams[1] = { name: n2, score: 0 };
    state.round = 0;

    const btn = $('btn-start-game');
    btn.disabled = true;
    btn.textContent = 'LOADING…';

    // Load the selected pack as the active GAME_DATA
    const ok = await loadSelectedPack();
    if (!ok) {
      btn.disabled = false;
      btn.textContent = 'START GAME';
      return;
    }

    state.usedRounds = shuffle([...Array(GAME_DATA.rounds.length).keys()]);

    // Register buzz handler so player phones can trigger buzz-in
    Multiplayer.setOnBuzz((teamIdx) => buzzIn(teamIdx));

    // Try to create a multiplayer room via the server
    btn.textContent = 'CREATING ROOM…';
    const room = await Multiplayer.createRoom(state.selectedPackId);

    btn.disabled = false;
    btn.textContent = 'START GAME';

    if (room) {
      // Show codes screen so players can join before game begins
      _showCodesScreen(n1, n2, room);
    } else {
      // Server not running — just start locally
      _proceedToGame();
    }
  }

  function _showCodesScreen(n1, n2, room) {
    $('display-game-code').textContent = room.gameCode;
    $('team1-link-display').textContent = room.team1Url;
    $('team2-link-display').textContent = room.team2Url;
    $('host-link-display').textContent  = room.hostUrl;

    // Copy buttons
    document.querySelectorAll('.btn-copy-link').forEach((btn) => {
      btn.onclick = () => {
        const url = btn.dataset.copy === 'team1' ? room.team1Url
                  : btn.dataset.copy === 'team2' ? room.team2Url
                  : room.hostUrl;
        navigator.clipboard.writeText(url).then(() => {
          const orig = btn.textContent;
          btn.textContent = '✓ Copied!';
          setTimeout(() => { btn.textContent = orig; }, 1800);
        });
      };
    });

    showScreen('codes-screen');
    Multiplayer.connect();
    setPhase('lobby');
  }

  function _proceedToGame() {
    updateTeamDisplays();
    showScreen('game-screen');
    Sounds.theme();
    createStarfield();
    setPhase('setup');
    updateStatusBar('Press START ROUND to begin Round 1!');
  }

  // ── ROUND SETUP ────────────────────────────────────────────
  function startRound() {
    if (state.phase !== 'setup') return;
    // After all rounds are done, Start Round button launches fast money
    if ($('btn-start-round').dataset.fastMoney === 'true') {
      $('btn-start-round').dataset.fastMoney = '';
      $('btn-start-round').textContent = '▶ START ROUND';
      startFastMoney();
      return;
    }

    // Pick next question
    const roundIdx = state.usedRounds[state.round % state.usedRounds.length];
    state.currentRound = GAME_DATA.rounds[roundIdx];
    state.multiplier = GAME_DATA.settings.roundMultipliers[state.round] || 1;
    state.strikes = 0;
    state.roundPoints = 0;
    state.revealedAnswers = new Set();
    state.activeTeam = 0;

    // Round banner
    $('round-number').textContent = state.round + 1;
    $('running-points').textContent = '0';

    // Question
    $('question-text').textContent = state.currentRound.question;
    $('question-text').classList.remove('hidden');

    buildBoard(state.currentRound.answers);
    resetStrikes();
    clearActiveTeam();
    updateTeamDisplays();
    broadcastState(); // control panel sees the new question immediately

    if (state.multiplier > 1) {
      $('multiplier-badge').textContent = `×${state.multiplier}`;
      $('multiplier-badge').classList.remove('hidden');
    } else {
      $('multiplier-badge').classList.add('hidden');
    }

    Sounds.surveySays();
    showOverlay(`ROUND ${state.round + 1}`, 1800);
    setTimeout(() => {
      setPhase('faceoff');
      updateStatusBar('Teams buzz in to start! Click your BUZZ button!');
    }, 1800);
  }

  // ── BOARD BUILDING ─────────────────────────────────────────
  function buildBoard(answers) {
    const board = $('answer-board');
    board.innerHTML = '';

    // Determine grid columns: 1 col ≤4, else 2 cols
    const cols = answers.length > 4 ? 2 : 1;
    board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

    answers.forEach((ans, i) => {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.ansId = ans.id;
      tile.innerHTML = `
        <div class="tile-inner">
          <div class="tile-front">
            <span class="tile-number">${i + 1}</span>
          </div>
          <div class="tile-back">
            <span class="tile-answer">${ans.text}</span>
            <span class="tile-points">${ans.points * state.multiplier}</span>
          </div>
        </div>`;

      tile.addEventListener('click', () => {
        if (state.phase === 'playing' || state.phase === 'steal') {
          revealAnswer(ans.id);
        }
      });

      board.appendChild(tile);
    });
  }

  // ── REVEAL ANSWER ──────────────────────────────────────────
  function revealAnswer(ansId) {
    if (state.revealedAnswers.has(ansId)) return;

    const tile = $q(`.tile[data-ans-id="${ansId}"]`);
    if (!tile) return;

    state.revealedAnswers.add(ansId);
    tile.classList.add('revealed');

    const ans = state.currentRound.answers.find((a) => a.id === ansId);
    const pts = ans.points * state.multiplier;
    state.roundPoints += pts;
    animatePointsCounter($('running-points'), state.roundPoints);
    broadcastState();

    // #1 answer special sound
    if (state.currentRound.answers[0].id === ansId) {
      Sounds.numberOne();
      tile.classList.add('number-one');
    } else {
      Sounds.reveal();
    }

    // Floating points bubble
    spawnPointsBubble(tile, `+${pts}`);

    // Check board cleared
    if (state.revealedAnswers.size === state.currentRound.answers.length) {
      setTimeout(() => endRound(state.activeTeam), 1200);
    }
  }

  // ── REVEAL ALL REMAINING ───────────────────────────────────
  function revealAllAnswers() {
    if (state.phase !== 'playing' && state.phase !== 'steal' && state.phase !== 'revealAll') return;
    revealAndEnd(state.activeTeam);
  }

  // Reveal remaining tiles then award points to winnerIdx.
  function revealAndEnd(winnerIdx) {
    setPhase('revealAll');
    Sounds.revealAll();

    state.currentRound.answers.forEach((ans, i) => {
      if (!state.revealedAnswers.has(ans.id)) {
        setTimeout(() => {
          const tile = $q(`.tile[data-ans-id="${ans.id}"]`);
          if (tile) {
            tile.classList.add('revealed', 'dimmed');
            state.roundPoints += ans.points * state.multiplier;
            state.revealedAnswers.add(ans.id);
            broadcastState();
          }
        }, i * 300);
      }
    });

    const delay = state.currentRound.answers.length * 300;
    setTimeout(() => animatePointsCounter($('running-points'), state.roundPoints), delay + 200);
    setTimeout(() => endRound(winnerIdx), delay + 1000);
  }

  // ── ADD STRIKE ─────────────────────────────────────────────
  function addStrike() {
    if (state.phase !== 'playing') return;
    if (state.strikes >= GAME_DATA.settings.maxStrikes) return;

    state.strikes++;
    renderStrikes();
    Sounds.wrong();
    flashStrike(state.strikes - 1);
    broadcastState();

    if (state.strikes >= GAME_DATA.settings.maxStrikes) {
      // Offer steal to other team
      setTimeout(() => {
        setPhase('steal');
        const otherTeam = 1 - state.activeTeam;
        setActiveTeam(otherTeam);
        showOverlay(`${state.teams[otherTeam].name.toUpperCase()}\nSTEAL!`, 2000);
        Sounds.steal();
        setTimeout(() => {
          updateStatusBar(`${state.teams[otherTeam].name} — Give ONE answer to steal!`);
        }, 2000);
      }, 800);
    }
  }

  // ── STEAL CORRECT ──────────────────────────────────────────
  function stealCorrect(ansId) {
    if (state.phase !== 'steal') return;
    if (ansId) revealAnswer(ansId);
    Sounds.stealWin();
    const winner = state.activeTeam;
    showOverlay(`${state.teams[winner].name.toUpperCase()}\nSTEALS IT!`, 2000);
    setTimeout(() => revealAndEnd(winner), 2200);
  }

  // ── STEAL WRONG ────────────────────────────────────────────
  function stealWrong() {
    if (state.phase !== 'steal') return;
    Sounds.stealFail();
    const winner = 1 - state.activeTeam; // original playing team wins
    showOverlay(`${state.teams[winner].name.toUpperCase()}\nKEEPS THE POINTS!`, 2000);
    setTimeout(() => revealAndEnd(winner), 2200);
  }

  // ── PASS CONTROL ───────────────────────────────────────────
  function passControl() {
    if (state.phase !== 'playing') return;
    state.activeTeam = 1 - state.activeTeam;
    setActiveTeam(state.activeTeam);
    updateStatusBar(`${state.teams[state.activeTeam].name} is now playing!`);
    broadcastState();
  }

  // ── END ROUND ──────────────────────────────────────────────
  function endRound(winnerTeamIdx) {
    setPhase('roundEnd');
    const pts = state.roundPoints;
    const prevScore = state.teams[winnerTeamIdx].score;
    state.teams[winnerTeamIdx].score += pts;
    // Update names but keep score el at old value so animation can count up
    ['team1', 'team2'].forEach((prefix, i) => {
      $(`${prefix}-name-display`).textContent = state.teams[i].name;
    });
    animateScoreAdd(winnerTeamIdx, prevScore, pts);
    broadcastState(); // push updated scores to the control panel

    Sounds.roundWin();
    showOverlay(
      `${state.teams[winnerTeamIdx].name.toUpperCase()}\nWINS ${pts} POINTS!`,
      2500
    );

    setTimeout(advanceAfterRound, 2800);
  }

  // Move from roundEnd → setup for the next round (or arm Fast Money).
  function advanceAfterRound() {
    if (state.phase !== 'roundEnd') return; // guard against double-transition
    state.round++;
    $('round-number').textContent = state.round + 1;
    if (state.round < GAME_DATA.settings.totalRounds) {
      setPhase('setup');
      updateStatusBar(`Round ${state.round + 1} — Press START ROUND to continue.`);
    } else {
      setPhase('setup');
      updateStatusBar('All rounds complete! Press START ROUND to go to Fast Money!');
      $('btn-start-round').textContent = '★ FAST MONEY!';
      $('btn-start-round').dataset.fastMoney = 'true';
      broadcastState(); // let the control panel know Fast Money is next
    }
  }

  // ── STRIKES ────────────────────────────────────────────────
  function resetStrikes() {
    state.strikes = 0;
    renderStrikes();
  }

  function renderStrikes() {
    $all('.strike-slot').forEach((slot, i) => {
      slot.classList.toggle('active', i < state.strikes);
    });
  }

  function flashStrike(idx) {
    const slot = $all('.strike-slot')[idx];
    if (!slot) return;
    slot.classList.add('flash');
    setTimeout(() => slot.classList.remove('flash'), 600);
  }

  // ── TEAM DISPLAY ───────────────────────────────────────────
  function updateTeamDisplays() {
    ['team1', 'team2'].forEach((prefix, i) => {
      $(`${prefix}-name-display`).textContent = state.teams[i].name;
      $(`${prefix}-score`).textContent = state.teams[i].score;
    });
  }

  function setActiveTeam(idx) {
    state.activeTeam = idx;
    $('team1-panel').classList.toggle('active-team', idx === 0);
    $('team2-panel').classList.toggle('active-team', idx === 1);
    $('team1-active-badge').classList.toggle('hidden', idx !== 0);
    $('team2-active-badge').classList.toggle('hidden', idx !== 1);
  }

  function clearActiveTeam() {
    $('team1-panel').classList.remove('active-team');
    $('team2-panel').classList.remove('active-team');
    $('team1-active-badge').classList.add('hidden');
    $('team2-active-badge').classList.add('hidden');
  }

  // ── BUZZ IN ────────────────────────────────────────────────
  function buzzIn(teamIdx) {
    if (state.phase !== 'faceoff') return;
    Sounds.buzzIn();
    setActiveTeam(teamIdx);
    setPhase('playing');
    $('team1-buzz-btn').disabled = true;
    $('team2-buzz-btn').disabled = true;
    updateStatusBar(`${state.teams[teamIdx].name} buzzes in! Click a tile to reveal!`);
  }

  // ── STATUS BAR ─────────────────────────────────────────────
  const statusMessages = {
    intro:     '',
    lobby:     'Waiting for players to join…',
    setup:     'Press START ROUND to begin!',
    faceoff:   'Both teams ready — click BUZZ to ring in!',
    playing:   'Click a tile to reveal an answer, or hit STRIKE for a wrong answer.',
    steal:     'Steal attempt — click correct tile, or STEAL WRONG if incorrect.',
    revealAll: 'Revealing all answers…',
    roundEnd:  'Round over! Points awarded.',
    fastMoney: 'FAST MONEY round!',
    gameEnd:   '',
  };

  function updateStatusBar(msg) {
    $('status-message').textContent = msg || statusMessages[state.phase] || '';
  }

  // ── CONTROL BUTTONS ────────────────────────────────────────
  function updateControlButtons() {
    const p = state.phase;
    const isPlaying = p === 'playing';
    const isSteal   = p === 'steal';
    const isFaceoff = p === 'faceoff';

    $('btn-start-round').disabled    = p !== 'setup';
    $('btn-strike').disabled         = !isPlaying;
    $('btn-pass').disabled           = !isPlaying;
    $('btn-steal-correct').disabled  = !isSteal;
    $('btn-steal-wrong').disabled    = !isSteal;
    $('btn-reveal-all').disabled     = !(isPlaying || isSteal);
    $('btn-next-round').disabled     = p !== 'roundEnd';
    $('btn-end-game').disabled       = ['intro', 'lobby', 'gameEnd'].includes(p);

    $('team1-buzz-btn').disabled   = !isFaceoff;
    $('team2-buzz-btn').disabled   = !isFaceoff;
  }

  // ── OVERLAY ────────────────────────────────────────────────
  function showOverlay(text, duration = 2000) {
    const overlay = $('game-overlay');
    const textEl  = $('overlay-text');
    textEl.innerHTML = text.replace(/\n/g, '<br>');
    overlay.classList.add('active');
    overlay.classList.remove('fadeout');
    clearTimeout(overlay._timer);
    overlay._timer = setTimeout(() => {
      overlay.classList.add('fadeout');
      setTimeout(() => overlay.classList.remove('active', 'fadeout'), 500);
    }, duration);
  }

  // ── ANIMATIONS ─────────────────────────────────────────────
  function animatePointsCounter(el, target) {
    const start = parseInt(el.textContent) || 0;
    const diff  = target - start;
    const dur   = 600;
    const tStart = performance.now();
    function step(now) {
      const p = Math.min((now - tStart) / dur, 1);
      el.textContent = Math.round(start + diff * easeOut(p));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function animateScoreAdd(teamIdx, from, pts) {
    const el = $(`team${teamIdx + 1}-score`);
    el.classList.add('score-flash');
    setTimeout(() => el.classList.remove('score-flash'), 700);
    const start  = from;
    const target = from + pts;
    const dur = 800;
    const tStart = performance.now();
    function step(now) {
      const p = Math.min((now - tStart) / dur, 1);
      el.textContent = Math.round(start + (target - start) * easeOut(p));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function spawnPointsBubble(tileEl, text) {
    const bubble = document.createElement('div');
    bubble.className = 'points-bubble';
    bubble.textContent = text;
    tileEl.appendChild(bubble);
    setTimeout(() => bubble.remove(), 1000);
  }

  // ── STARFIELD ──────────────────────────────────────────────
  function createStarfield() {
    const container = $('stars-container');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 120; i++) {
      const star = document.createElement('div');
      star.className = 'star';
      star.style.cssText = `
        left: ${Math.random() * 100}%;
        top:  ${Math.random() * 100}%;
        width: ${1 + Math.random() * 2}px;
        height: ${1 + Math.random() * 2}px;
        animation-delay: ${Math.random() * 4}s;
        animation-duration: ${2 + Math.random() * 3}s;
      `;
      container.appendChild(star);
    }
  }

  // ── CONFETTI ───────────────────────────────────────────────
  function launchConfetti() {
    const canvas = $('confetti-canvas');
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx    = canvas.getContext('2d');
    const pieces = [];
    const colors = ['#ffd700','#ff4500','#1e90ff','#fff','#00ff88','#ff69b4'];
    for (let i = 0; i < 180; i++) {
      pieces.push({
        x: Math.random() * canvas.width,
        y: -10,
        w: 8 + Math.random() * 10,
        h: 8 + Math.random() * 10,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 6,
        vy: 3 + Math.random() * 4,
        angle: Math.random() * 360,
        spin: (Math.random() - 0.5) * 8,
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;
        p.angle += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.angle * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      state.confettiAnimId = requestAnimationFrame(draw);
    }
    draw();
    setTimeout(() => {
      cancelAnimationFrame(state.confettiAnimId);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, 5000);
  }

  // ── FAST MONEY ─────────────────────────────────────────────
  function startFastMoney() {
    // Determine winning team by score so far
    const winnerIdx = state.teams[0].score >= state.teams[1].score ? 0 : 1;
    state.fmCurrentPlayer = 0;
    state.fmScores = [0, 0];
    state.fmCurrentQ = 0;

    const fmData = GAME_DATA.fastMoneyRounds[0];
    $('fm-team-name').textContent = state.teams[winnerIdx].name;

    buildFMBoard(fmData.questions);
    showScreen('fast-money-screen');
    Sounds.surveySays();
    $('fm-p1-score').textContent = '0';
    $('fm-p2-score').textContent = '0';
    $('fm-total').textContent    = '0';
    $('fm-p1-label').textContent = `${state.teams[winnerIdx].name} — Player 1`;
    $('fm-p2-label').textContent     = `${state.teams[winnerIdx].name} — Player 2`;
    $('fm-btn-start-p1').disabled = false;
    $('fm-btn-start-p2').disabled = true;

    setPhase('fastMoney');
  }

  function buildFMBoard(questions) {
    const board = $('fm-board');
    board.innerHTML = '';
    questions.forEach((q, i) => {
      const row = document.createElement('div');
      row.className = 'fm-row';
      row.dataset.qIdx = i;
      row.innerHTML = `
        <div class="fm-q-num">${i + 1}</div>
        <div class="fm-q-text">${q.question}</div>
        <div class="fm-answers-col">
          <div class="fm-p-answer fm-p1-answer" id="fm-p1-q${i}">—</div>
          <div class="fm-p-answer fm-p2-answer" id="fm-p2-q${i}">—</div>
        </div>
        <div class="fm-pts-col">
          <div class="fm-pts" id="fm-p1-pts${i}">—</div>
          <div class="fm-pts" id="fm-p2-pts${i}">—</div>
        </div>`;
      board.appendChild(row);
    });
  }

  function startFMPlayer(playerIdx) {
    state.fmCurrentPlayer = playerIdx;
    state.fmCurrentQ = 0;
    const timeLimit = playerIdx === 0
      ? GAME_DATA.settings.fastMoneyTimeP1
      : GAME_DATA.settings.fastMoneyTimeP2;
    startFMTimer(timeLimit);
    $('fm-btn-start-p1').disabled = true;
    $('fm-btn-start-p2').disabled = true;
    $('fm-answer-form').classList.remove('hidden');
    highlightFMQuestion(0);
    updateStatusBar(`Player ${playerIdx + 1} — Answer quickly! Time is running!`);
  }

  function startFMTimer(seconds) {
    clearFMTimer();
    state.fmTimeLeft = seconds;
    $('fm-timer').textContent = seconds;
    $('fm-timer').classList.remove('urgent');
    state.fmTimer = setInterval(() => {
      state.fmTimeLeft--;
      $('fm-timer').textContent = state.fmTimeLeft;
      if (state.fmTimeLeft <= 5) {
        $('fm-timer').classList.add('urgent');
        Sounds.urgentTick();
      } else {
        Sounds.tick();
      }
      if (state.fmTimeLeft <= 0) {
        clearFMTimer();
        Sounds.timeUp();
        endFMPlayer();
      }
    }, 1000);
  }

  function clearFMTimer() {
    clearInterval(state.fmTimer);
    state.fmTimer = null;
  }

  function fmMarkAnswer(pts) {
    const p = state.fmCurrentPlayer;
    const q = state.fmCurrentQ;
    const ansInput = $('fm-ans-input');
    const ansText  = ansInput.value.trim() || '—';
    ansInput.value = '';

    const prefix = p === 0 ? 'p1' : 'p2';
    $(`fm-${prefix}-q${q}`).textContent = ansText;
    const ptsEl = $(`fm-${prefix === 'p1' ? 'p1' : 'p2'}-pts${q}`);
    ptsEl.textContent = pts > 0 ? pts : '✕';
    ptsEl.classList.toggle('pts-zero', pts === 0);

    state.fmScores[p] += pts;
    if (pts > 0) Sounds.correct();
    else         Sounds.wrong();

    $(`fm-p${p + 1}-score`).textContent = state.fmScores[p];
    $('fm-total').textContent = state.fmScores[0] + state.fmScores[1];

    // Advance question or end player
    state.fmCurrentQ++;
    if (state.fmCurrentQ >= GAME_DATA.fastMoneyRounds[0].questions.length) {
      clearFMTimer();
      endFMPlayer();
    } else {
      highlightFMQuestion(state.fmCurrentQ);
    }
  }

  function highlightFMQuestion(idx) {
    $all('.fm-row').forEach((r, i) => r.classList.toggle('fm-active', i === idx));
  }

  function endFMPlayer() {
    clearFMTimer();
    $('fm-answer-form').classList.add('hidden');
    highlightFMQuestion(-1);

    if (state.fmCurrentPlayer === 0) {
      $('fm-btn-start-p2').disabled = false;
      updateStatusBar('Player 1 done! Cover board, then start Player 2.');
    } else {
      finishFastMoney();
    }
  }

  function finishFastMoney() {
    const total = state.fmScores[0] + state.fmScores[1];
    const won   = total >= GAME_DATA.settings.fastMoneyTarget;
    clearFMTimer();

    $('fm-total').classList.toggle('fm-win', won);
    $('fm-result-text').textContent = won
      ? `🎉 ${total} POINTS — YOU WIN THE GRAND PRIZE!`
      : `${total} points — Keep playing to improve!`;
    $('fm-result-banner').classList.remove('hidden');

    if (won) Sounds.gameOver();
    else     Sounds.roundWin();

    setTimeout(() => showEndScreen(), 3000);
  }

  // ── GAME END ───────────────────────────────────────────────
  function showEndScreen() {
    const t0 = state.teams[0].score;
    const t1 = state.teams[1].score;
    const winnerIdx = t0 >= t1 ? 0 : 1;

    $('end-winner-name').textContent  = state.teams[winnerIdx].name;
    $('end-team1-name').textContent   = state.teams[0].name;
    $('end-team1-score').textContent  = t0;
    $('end-team2-name').textContent   = state.teams[1].name;
    $('end-team2-score').textContent  = t1;
    $(`end-team${winnerIdx + 1}-box`).classList.add('winner-box');

    showScreen('end-screen');
    Sounds.gameOver();
    setTimeout(launchConfetti, 400);
    setPhase('gameEnd');
  }

  // End the game right now: whoever is ahead wins (skips Fast Money).
  function endGameNow() {
    clearFMTimer();
    $('btn-start-round').textContent = '▶ START ROUND';
    $('btn-start-round').dataset.fastMoney = '';
    showEndScreen();
  }

  // Abandon the game and return to the home screen.
  function resetToIntro() {
    clearFMTimer();
    cancelAnimationFrame(state.confettiAnimId);
    state.teams[0].score = 0;
    state.teams[1].score = 0;
    state.round = 0;
    $('btn-start-round').textContent = '▶ START ROUND';
    $('btn-start-round').dataset.fastMoney = '';
    $('end-team1-box').classList.remove('winner-box');
    $('end-team2-box').classList.remove('winner-box');
    showScreen('intro-screen');
    setPhase('intro');
    loadGameModes();
  }

  function playAgain() {
    const cc = $('confetti-canvas');
    if (cc) cc.getContext('2d').clearRect(0, 0, cc.width, cc.height);
    resetToIntro();
  }

  // ── MUTE TOGGLE ────────────────────────────────────────────
  function toggleMute() {
    const muted = Sounds.toggleMute();
    $('btn-mute').textContent = muted ? '🔇' : '🔊';
  }

  // ── KEYBOARD SHORTCUTS ─────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const key = e.key.toLowerCase();

    // Buzz: Q = Team 1, P = Team 2
    if (key === 'q') buzzIn(0);
    if (key === 'p') buzzIn(1);

    // Reveal answers 1-8 by keyboard number
    if (/^[1-8]$/.test(key) && (state.phase === 'playing' || state.phase === 'steal')) {
      const num = parseInt(key);
      const ans = state.currentRound?.answers[num - 1];
      if (ans) revealAnswer(ans.id);
    }

    // S or X = Strike, A = Reveal All, M = Mute
    if (key === 's' || key === 'x') addStrike();
    if (key === 'a') revealAllAnswers();
    if (key === 'm') toggleMute();
  });

  // ── REMOTE HOST CONTROL ────────────────────────────────────
  // Actions arriving from the host-control panel (host.html) opened
  // on another device. Each maps to the same functions the on-board
  // buttons use, so all phase guards still apply.
  function handleControlAction(msg) {
    switch (msg.action) {
      case 'proceed':        // begin game from the lobby screen
        if (state.phase === 'lobby') _proceedToGame();
        break;
      case 'start-round':    startRound(); break;
      case 'reveal':
        if (state.phase === 'playing' || state.phase === 'steal') {
          revealAnswer(Number(msg.ansId));
        }
        break;
      case 'strike':         addStrike(); break;
      case 'pass':           passControl(); break;
      case 'steal-correct':  stealCorrect(msg.ansId ? Number(msg.ansId) : null); break;
      case 'steal-wrong':    stealWrong(); break;
      case 'reveal-all':     revealAllAnswers(); break;
      case 'next-round':     advanceAfterRound(); break;
      case 'buzz':           buzzIn(Number(msg.team)); break;
      case 'end-game':
        if (!['intro', 'lobby', 'gameEnd'].includes(state.phase)) endGameNow();
        break;
    }
  }

  // ── EVENT WIRING ───────────────────────────────────────────
  function init() {
    // Intro
    $('btn-start-game').addEventListener('click', startGame);
    $('team1-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('team2-name-input').focus(); });
    $('team2-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });

    // Codes screen
    $('btn-proceed-game').addEventListener('click', _proceedToGame);
    $('btn-skip-mp').addEventListener('click', _proceedToGame);
    $('btn-back-intro').addEventListener('click', () => {
      showScreen('intro-screen');
      setPhase('intro');
    });

    // Game controls
    $('btn-start-round').addEventListener('click', startRound);
    $('btn-strike').addEventListener('click', addStrike);
    $('btn-pass').addEventListener('click', passControl);
    $('btn-reveal-all').addEventListener('click', revealAllAnswers);
    $('btn-steal-wrong').addEventListener('click', stealWrong);
    $('btn-next-round').addEventListener('click', advanceAfterRound);
    $('btn-end-game').addEventListener('click', () => {
      if (confirm('End the game now? The team with the highest score wins.')) endGameNow();
    });
    $('btn-exit-game').addEventListener('click', () => {
      if (confirm('Leave this game and return to the home screen? Scores will be lost.')) resetToIntro();
    });
    $('btn-mute').addEventListener('click', toggleMute);

    // Remote host-control panel
    Multiplayer.setOnControlAction(handleControlAction);
    Multiplayer.setOnControlJoined(() => broadcastState());
    Multiplayer.setOnConnected(() => broadcastState());

    // Team buzz buttons
    $('team1-buzz-btn').addEventListener('click', () => buzzIn(0));
    $('team2-buzz-btn').addEventListener('click', () => buzzIn(1));

    // Steal controls for specific tile — any revealed tile click during steal counts as stealCorrect
    $('btn-steal-correct').addEventListener('click', () => {
      // Find first unrevealed answer to use as a placeholder (host taps the tile)
      stealCorrect(null);
    });

    // Fast Money
    $('fm-btn-start-p1').addEventListener('click', () => startFMPlayer(0));
    $('fm-btn-start-p2').addEventListener('click', () => startFMPlayer(1));
    $('fm-btn-correct').addEventListener('click', () => {
      const pts = parseInt($('fm-pts-input').value) || 0;
      fmMarkAnswer(pts);
    });
    $('fm-btn-wrong').addEventListener('click', () => fmMarkAnswer(0));
    $('fm-pts-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const pts = parseInt($('fm-pts-input').value) || 0;
        fmMarkAnswer(pts);
      }
    });
    $('fm-btn-skip').addEventListener('click', () => {
      $('fm-ans-input').value = 'PASS';
      fmMarkAnswer(0);
    });
    $('fm-btn-end-fm').addEventListener('click', () => {
      clearFMTimer();
      finishFastMoney();
    });

    // End screen
    $('btn-play-again').addEventListener('click', playAgain);

    // Start in intro phase
    setPhase('intro');
    showScreen('intro-screen');

    // Populate the game-mode picker
    loadGameModes();
  }

  // ── GAME MODES (packs) ─────────────────────────────────────
  async function loadGameModes() {
    const grid = $('mode-grid');
    if (!grid) return;
    let list = [];
    try {
      const res = await fetch('/api/packs');
      if (!res.ok) throw new Error();
      const data = await res.json();
      list = data.packs || [];
    } catch {
      // Server not running — use embedded seed packs as a read-only fallback
      list = (window.GAME_PACK_SEEDS || []).map((p) => ({
        id: p.id, name: p.name, icon: p.icon, builtIn: p.builtIn,
        roundCount: p.rounds.length,
        fmCount: p.fastMoneyRounds?.[0]?.questions?.length || 0,
      }));
    }
    state.availablePacks = list;
    renderModeGrid();
  }

  function renderModeGrid() {
    const grid = $('mode-grid');
    grid.innerHTML = '';
    if (!state.availablePacks.length) {
      grid.innerHTML = `<div class="mode-loading">No game modes — visit <a href="admin.html">Admin</a> to create one.</div>`;
      return;
    }
    state.availablePacks.forEach((p) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mode-card';
      const isReady = p.roundCount > 0;
      if (state.selectedPackId === p.id) card.classList.add('selected');
      if (!isReady) card.classList.add('mode-empty');
      card.innerHTML = `
        <div class="mode-icon">${p.icon || '🎯'}</div>
        <div class="mode-card-name">${escapeHtml(p.name)}</div>
        <div class="mode-card-meta">${p.roundCount} round${p.roundCount === 1 ? '' : 's'}${p.builtIn ? ' · built-in' : ''}</div>
        ${!isReady ? '<div class="mode-empty-tag">Empty — add questions in Admin</div>' : ''}
      `;
      card.addEventListener('click', () => selectMode(p.id));
      grid.appendChild(card);
    });
  }

  function selectMode(id) {
    state.selectedPackId = id;
    renderModeGrid();
  }

  // Fetches full pack data and replaces GAME_DATA. Returns true on success.
  async function loadSelectedPack() {
    const id = state.selectedPackId;
    try {
      const res = await fetch(`/api/packs/${id}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      // Reject packs with no rounds — game cannot start
      if (!data.pack?.rounds?.length) {
        alert(`The "${data.pack?.name || id}" mode has no questions yet. Add some in the Admin panel first.`);
        return false;
      }
      window.GAME_DATA = data.pack;
      return true;
    } catch {
      // Fallback to seed
      const seed = (window.GAME_PACK_SEEDS || []).find((p) => p.id === id);
      if (!seed || !seed.rounds.length) {
        alert('Could not load this game mode. Add questions in the Admin panel.');
        return false;
      }
      window.GAME_DATA = JSON.parse(JSON.stringify(seed));
      return true;
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);
})();
