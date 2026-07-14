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
    fmStage: 'idle',     // idle | entry | grading | between | done
    fmAnswers: [[], []], // per player: [{text, pts, said, graded}]
    fmTeam: 0,           // index of the team playing fast money
    confettiAnimId: null,
    selectedPackId: 'default',
    availablePacks: [],
    roundPrepared: false, // board tiles laid out, waiting for START ROUND
    // Face-off tracking (show rules):
    //   stage 'first'  → the team that buzzed is answering
    //   stage 'second' → the other team answers to try to beat it
    faceoff: { firstTeam: -1, turn: -1, stage: 'buzz', firstRank: -1, winner: -1 },
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
        faceoffTurn:   state.faceoff.turn,
        faceoffWinner: state.faceoff.winner,
        fastMoneyNext: $('btn-start-round')?.dataset.fastMoney === 'true',
        fm: buildFMSync(),
      },
    });
  }

  // Fast Money state for the remote host panel (null outside FM).
  function buildFMSync() {
    if (state.phase !== 'fastMoney') return null;
    const questions = fmQuestions();
    const stage = state.fmStage;
    const p = state.fmCurrentPlayer;
    const q = state.fmCurrentQ;

    const sync = {
      stage,
      player: p,
      q,
      questionCount: questions.length,
      timeLeft: state.fmTimeLeft,
      scores: [...state.fmScores],
      total: state.fmScores[0] + state.fmScores[1],
      target: GAME_DATA.settings.fastMoneyTarget || 200,
      teamName: state.teams[state.fmTeam]?.name || '',
    };

    if (stage === 'entry' && questions[q]) {
      sync.question = questions[q].question;
    }
    if (stage === 'grading' && questions[q]) {
      const rec = state.fmAnswers[p][q];
      sync.grading = {
        question: questions[q].question,
        said: rec.said ? (rec.text || '(no answer)') : null, // null until revealed
        revealed: rec.said,
        bank: questions[q].answers.map((a) => ({ text: a.text, points: a.points })),
        suggested: rec.said ? fmMatchBank(q, rec.text) : -1,
      };
    }
    return sync;
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
    prepareRound(); // lay the face-down tiles on the board straight away
    updateStatusBar('Press START ROUND to reveal the question and begin Round 1!');
  }

  // ── ROUND PREP ─────────────────────────────────────────────
  // Lay out the (face-down) board for the upcoming round without
  // revealing the question — the board is shown first, then the host
  // presses START ROUND to reveal the question and go live.
  function prepareRound() {
    const roundIdx = state.usedRounds[state.round % state.usedRounds.length];
    state.currentRound = GAME_DATA.rounds[roundIdx];
    state.multiplier = GAME_DATA.settings.roundMultipliers[state.round] || 1;
    state.strikes = 0;
    state.roundPoints = 0;
    state.revealedAnswers = new Set();
    state.activeTeam = 0;

    $('round-number').textContent = state.round + 1;
    $('running-points').textContent = '0';

    // Load the question text but keep it hidden until START ROUND
    $('question-text').textContent = state.currentRound.question;
    $('question-text').classList.add('hidden');

    buildBoard(state.currentRound.answers); // face-down numbered tiles
    resetStrikes();
    clearActiveTeam();
    updateTeamDisplays();

    if (state.multiplier > 1) {
      $('multiplier-badge').textContent = `×${state.multiplier}`;
      $('multiplier-badge').classList.remove('hidden');
    } else {
      $('multiplier-badge').classList.add('hidden');
    }

    state.faceoff = { firstTeam: -1, turn: -1, stage: 'buzz', firstRank: -1, winner: -1 };
    state.roundPrepared = true;
    broadcastState();
  }

  // ── START ROUND ────────────────────────────────────────────
  function startRound() {
    if (state.phase !== 'setup') return;
    // After all rounds are done, Start Round button launches fast money
    if ($('btn-start-round').dataset.fastMoney === 'true') {
      $('btn-start-round').dataset.fastMoney = '';
      $('btn-start-round').textContent = '';
      setStartRoundLabel(false);
      startFastMoney();
      return;
    }

    // Ensure the board is laid out (normally done on screen entry)
    if (!state.roundPrepared) prepareRound();

    // Reveal the question — the round is now officially live
    $('question-text').classList.remove('hidden');
    state.roundPrepared = false;

    Sounds.surveySays();
    showOverlay(`ROUND ${state.round + 1}`, 1800);
    setTimeout(() => {
      setPhase('faceoff');
      updateStatusBar('Teams buzz in to start! Click your BUZZ button!');
    }, 1800);
  }

  // Swap the START ROUND button label between round / fast-money modes.
  function setStartRoundLabel(fastMoney) {
    const btn = $('btn-start-round');
    btn.innerHTML = fastMoney
      ? `${Icons.svg('star')}<span>FAST MONEY!</span>`
      : `${Icons.svg('play')}<span>START ROUND</span>`;
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
        if (state.phase === 'faceoffAnswer') {
          faceoffReveal(ans.id);
        } else if (state.phase === 'playing' || state.phase === 'steal') {
          revealAnswer(ans.id);
        } else if (state.phase === 'roundEnd') {
          revealLeftover(ans.id);
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

    // Check board cleared (only ends the round during actual play —
    // face-off reveals can never clear the board on their own)
    if (
      state.revealedAnswers.size === state.currentRound.answers.length &&
      (state.phase === 'playing' || state.phase === 'steal')
    ) {
      setTimeout(() => endRound(state.activeTeam), 1200);
    }
  }

  // ── REVEAL ALL / END PLAY ──────────────────────────────────
  // During play or a steal this ENDS the round (pot to the active
  // team). Nothing auto-flips: any still-covered answers wait on the
  // board for the host to reveal them one by one during roundEnd.
  // Pressing it again during roundEnd flips all remaining leftovers.
  function revealAllAnswers() {
    if (state.phase === 'playing' || state.phase === 'steal') {
      endRound(state.activeTeam);
    } else if (state.phase === 'roundEnd') {
      revealAllLeftovers();
    }
  }

  // Host-controlled reveal of a leftover (unanswered) answer after the
  // round has ended. Shown dimmed — points are NOT added to anything;
  // only answers found in play count (the Family Feud steal rule).
  function revealLeftover(ansId) {
    if (state.phase !== 'roundEnd') return;
    if (state.revealedAnswers.has(ansId)) return;
    const tile = $q(`.tile[data-ans-id="${ansId}"]`);
    if (!tile) return;
    tile.classList.add('revealed', 'dimmed');
    state.revealedAnswers.add(ansId);
    Sounds.reveal();
    broadcastState();
    updateRoundEndStatus();
  }

  // Convenience: flip every remaining leftover with a steady cadence.
  function revealAllLeftovers() {
    if (state.phase !== 'roundEnd') return;
    const remaining = state.currentRound.answers.filter((a) => !state.revealedAnswers.has(a.id));
    remaining.forEach((ans, i) => {
      setTimeout(() => revealLeftover(ans.id), i * 700);
    });
  }

  function updateRoundEndStatus() {
    if (state.phase !== 'roundEnd') return;
    const left = state.currentRound.answers.length - state.revealedAnswers.size;
    updateStatusBar(
      left > 0
        ? `${left} answer${left === 1 ? '' : 's'} still covered — tap to reveal, or press NEXT ROUND.`
        : 'Board complete! Press NEXT ROUND when everyone is ready.'
    );
  }

  // ── ADD STRIKE ─────────────────────────────────────────────
  function addStrike() {
    // During a face-off, a strike passes the answer to the other team
    if (state.phase === 'faceoffAnswer') { faceoffStrike(); return; }
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
    setTimeout(() => { if (state.phase === 'steal') endRound(winner); }, 2200);
  }

  // ── STEAL WRONG ────────────────────────────────────────────
  function stealWrong() {
    if (state.phase !== 'steal') return;
    Sounds.stealFail();
    const winner = 1 - state.activeTeam; // original playing team wins
    showOverlay(`${state.teams[winner].name.toUpperCase()}\nKEEPS THE POINTS!`, 2000);
    setTimeout(() => { if (state.phase === 'steal') endRound(winner); }, 2200);
  }

  // ── PASS CONTROL (mid-round host override) ─────────────────
  // Each team plays with its own set of strikes, so passing control
  // also refreshes the strikes.
  function passControl() {
    if (state.phase !== 'playing') return;
    state.activeTeam = 1 - state.activeTeam;
    setActiveTeam(state.activeTeam);
    state.strikes = 0;
    renderStrikes();
    updateStatusBar(`${state.teams[state.activeTeam].name} is now playing with fresh strikes!`);
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

    // No auto-advance and no auto-reveal: leftover answers stay covered
    // until the host taps them (or hits REVEAL ALL), then NEXT ROUND.
    setTimeout(updateRoundEndStatus, 2600);
  }

  // Move from roundEnd → setup for the next round (or arm Fast Money).
  function advanceAfterRound() {
    if (state.phase !== 'roundEnd') return; // guard against double-transition
    state.round++;
    $('round-number').textContent = state.round + 1;
    if (state.round < GAME_DATA.settings.totalRounds) {
      setPhase('setup');
      prepareRound(); // lay out the next round's face-down board
      updateStatusBar(`Round ${state.round + 1} — Press START ROUND to reveal the question.`);
    } else {
      // All rounds done — announce the winner, who advances to Fast Money
      const leadIdx = state.teams[0].score >= state.teams[1].score ? 0 : 1;
      state.fmTeam = leadIdx;
      setPhase('setup');
      Sounds.roundWin();
      showOverlay(
        `${state.teams[leadIdx].name.toUpperCase()} WINS!\nADVANCING TO FAST MONEY`,
        3200
      );
      setActiveTeam(leadIdx);
      updateStatusBar(`${state.teams[leadIdx].name} advances! Press FAST MONEY to begin.`);
      setStartRoundLabel(true);
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

  // ── FACE-OFF (show rules) ──────────────────────────────────
  // 1. First team to buzz gives an answer.
  //    · Top answer → they win the face-off outright.
  //    · Any other board answer → the other team answers too; the
  //      HIGHER answer wins the face-off.
  //    · Strike → the other team gets the face-off answer instead.
  // 2. The face-off winner chooses PLAY or PASS.
  // 3. Whoever plays starts with a fresh set of strikes — face-off
  //    strikes never carry into the round.

  function buzzIn(teamIdx) {
    if (state.phase !== 'faceoff') return;
    Sounds.buzzIn();
    state.faceoff.firstTeam = teamIdx;
    state.faceoff.turn = teamIdx;
    state.faceoff.stage = 'first';
    state.faceoff.firstRank = -1;
    setActiveTeam(teamIdx);
    setPhase('faceoffAnswer');
    updateStatusBar(
      `${state.teams[teamIdx].name} buzzed first! Reveal their answer, or STRIKE if it's not on the board.`
    );
  }

  // Host reveals the answering team's guess during the face-off.
  function faceoffReveal(ansId) {
    if (state.phase !== 'faceoffAnswer') return;
    const fo = state.faceoff;
    const rank = state.currentRound.answers.findIndex((a) => a.id === ansId);
    if (rank === -1 || state.revealedAnswers.has(ansId)) return;

    revealAnswer(ansId); // flips the tile, adds points to the pot

    if (fo.stage === 'first') {
      fo.firstRank = rank;
      if (rank === 0) {
        // Top answer — face-off won outright
        faceoffWon(fo.firstTeam);
      } else {
        // Other team gets a chance to beat it
        fo.stage = 'second';
        fo.turn = 1 - fo.firstTeam;
        setActiveTeam(fo.turn);
        updateStatusBar(
          `${state.teams[fo.turn].name}, can you beat it? Reveal their answer, or STRIKE.`
        );
        broadcastState();
      }
    } else {
      // Second answer revealed — higher rank (lower index) wins.
      // If the first team struck (firstRank -1), any answer wins.
      const winner = (fo.firstRank === -1 || rank < fo.firstRank)
        ? fo.turn
        : fo.firstTeam;
      faceoffWon(winner);
    }
  }

  // The answering team's guess wasn't on the board.
  function faceoffStrike() {
    if (state.phase !== 'faceoffAnswer') return;
    const fo = state.faceoff;
    Sounds.wrong();
    showOverlay('STRIKE!', 900);

    if (fo.stage === 'first') {
      // Face-off passes straight to the other team
      fo.firstRank = -1;
      fo.stage = 'second';
      fo.turn = 1 - fo.firstTeam;
      setActiveTeam(fo.turn);
      setTimeout(() => {
        updateStatusBar(`${state.teams[fo.turn].name}'s turn to answer the face-off!`);
      }, 900);
      broadcastState();
    } else if (fo.firstRank >= 0) {
      // Second team struck but the first team has an answer up — first team wins
      faceoffWon(fo.firstTeam);
    } else {
      // Both struck — keep alternating until someone lands an answer
      fo.turn = 1 - fo.turn;
      setActiveTeam(fo.turn);
      setTimeout(() => {
        updateStatusBar(`Still nobody on the board — back to ${state.teams[fo.turn].name}!`);
      }, 900);
      broadcastState();
    }
  }

  function faceoffWon(teamIdx) {
    state.faceoff.winner = teamIdx;
    setActiveTeam(teamIdx);
    Sounds.correct();
    setPhase('passOrPlay'); // switch immediately so stray taps can't re-enter the face-off
    showOverlay(`${state.teams[teamIdx].name.toUpperCase()}\nWINS THE FACE-OFF!`, 2000);
    updateStatusBar(`${state.teams[teamIdx].name} — PLAY the board or PASS to the other team?`);
  }

  // Face-off winner's decision. Whoever plays gets fresh strikes.
  function chooseControl(play) {
    if (state.phase !== 'passOrPlay') return;
    const winner = state.faceoff.winner;
    const playingTeam = play ? winner : 1 - winner;
    state.activeTeam = playingTeam;
    setActiveTeam(playingTeam);
    state.strikes = 0;
    renderStrikes();
    Sounds.buzzIn();
    setPhase('playing');
    showOverlay(
      play
        ? `${state.teams[playingTeam].name.toUpperCase()}\nPLAYS!`
        : `PASSED!\n${state.teams[playingTeam].name.toUpperCase()} PLAYS!`,
      1600
    );
    updateStatusBar(`${state.teams[playingTeam].name} is playing with fresh strikes!`);
  }

  // ── STATUS BAR ─────────────────────────────────────────────
  const statusMessages = {
    intro:         '',
    lobby:         'Waiting for players to join…',
    setup:         'Press START ROUND to begin!',
    faceoff:       'FACE-OFF! First team to buzz answers first!',
    faceoffAnswer: 'Reveal the answering team\'s guess, or STRIKE if it\'s not up there.',
    passOrPlay:    'Face-off won — choose PLAY or PASS!',
    playing:       'Click a tile to reveal an answer, or hit STRIKE for a wrong answer.',
    steal:         'Steal attempt — click correct tile, or STEAL WRONG if incorrect.',
    revealAll:     'Revealing all answers…',
    roundEnd:      'Round over! Reveal leftover answers, then press NEXT ROUND.',
    fastMoney:     'FAST MONEY round!',
    gameEnd:       '',
  };

  function updateStatusBar(msg) {
    $('status-message').textContent = msg || statusMessages[state.phase] || '';
  }

  // ── CONTROL BUTTONS ────────────────────────────────────────
  function updateControlButtons() {
    const p = state.phase;
    const isPlaying   = p === 'playing';
    const isSteal     = p === 'steal';
    const isFaceoff   = p === 'faceoff';
    const isFoAnswer  = p === 'faceoffAnswer';
    const isChoosing  = p === 'passOrPlay';

    $('btn-start-round').disabled    = p !== 'setup';
    $('btn-strike').disabled         = !(isPlaying || isFoAnswer);
    $('btn-pass').disabled           = !isPlaying;
    $('btn-choose-play').disabled    = !isChoosing;
    $('btn-choose-pass').disabled    = !isChoosing;
    $('btn-steal-correct').disabled  = !isSteal;
    $('btn-steal-wrong').disabled    = !isSteal;
    $('btn-reveal-all').disabled     = !(isPlaying || isSteal || p === 'roundEnd');
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
  // Show-style flow, per player:
  //   1. ENTRY   — questions appear ONE AT A TIME with a text box; the
  //                host types the player's answer and presses Enter to
  //                advance. A 30-second clock runs the whole time.
  //   2. GRADING — back through each question in order: reveal what
  //                they said, cross-reference it against the question's
  //                answer bank (auto-matched, host can override), and
  //                award the points.
  // Player 2 repeats both stages; total ≥ target wins.

  function fmQuestions() {
    return GAME_DATA.fastMoneyRounds[0].questions;
  }

  function startFastMoney() {
    const teamIdx = state.fmTeam ?? (state.teams[0].score >= state.teams[1].score ? 0 : 1);
    state.fmTeam = teamIdx;
    state.fmStage = 'idle';
    state.fmCurrentPlayer = 0;
    state.fmScores = [0, 0];
    state.fmCurrentQ = 0;

    const questions = fmQuestions();
    state.fmAnswers = [
      questions.map(() => ({ text: '', pts: 0, said: false, graded: false })),
      questions.map(() => ({ text: '', pts: 0, said: false, graded: false })),
    ];

    const target = GAME_DATA.settings.fastMoneyTarget || 200;
    $('fm-target-subtitle').textContent = target;
    $('fm-target-val').textContent = target;
    $('fm-team-name').textContent = state.teams[teamIdx].name;
    $('fm-p1-label').textContent = `${state.teams[teamIdx].name} — Player 1`;
    $('fm-p2-label').textContent = `${state.teams[teamIdx].name} — Player 2`;
    $('fm-p1-score').textContent = '0';
    $('fm-p2-score').textContent = '0';
    $('fm-total').textContent    = '0';
    $('fm-total').classList.remove('fm-win');
    $('fm-result-banner').classList.add('hidden');
    $('fm-timer').textContent = '—';
    $('fm-timer').classList.remove('urgent');

    buildFMBoard(questions);
    fmShowView('idle');
    $('fm-btn-start-p1').disabled = false;
    $('fm-btn-start-p2').disabled = true;
    $('fm-grading-box').classList.add('hidden');

    showScreen('fast-money-screen');
    Sounds.surveySays();
    setPhase('fastMoney');
  }

  // Swap the main fast-money view: 'idle' | 'entry' | 'board'
  function fmShowView(view) {
    $('fm-idle-view').classList.toggle('hidden',  view !== 'idle');
    $('fm-entry-view').classList.toggle('hidden', view !== 'entry');
    $('fm-board').classList.toggle('hidden',      view !== 'board');
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
        <div class="fm-q-text">${escapeHtml(q.question)}</div>
        <div class="fm-answers-col">
          <div class="fm-p-answer fm-covered" id="fm-p1-q${i}">&nbsp;</div>
          <div class="fm-p-answer fm-covered" id="fm-p2-q${i}">&nbsp;</div>
        </div>
        <div class="fm-pts-col">
          <div class="fm-pts fm-covered" id="fm-p1-pts${i}">&nbsp;</div>
          <div class="fm-pts fm-covered" id="fm-p2-pts${i}">&nbsp;</div>
        </div>`;
      board.appendChild(row);
    });
  }

  // ── ENTRY STAGE ────────────────────────────────────────────
  function startFMPlayer(playerIdx) {
    if (state.phase !== 'fastMoney') return;
    // Player 1 only from the start, player 2 only after player 1 is graded
    if (playerIdx === 0 && state.fmStage !== 'idle') return;
    if (playerIdx === 1 && state.fmStage !== 'between') return;
    state.fmCurrentPlayer = playerIdx;
    state.fmCurrentQ = 0;
    state.fmStage = 'entry';

    const timeLimit = playerIdx === 0
      ? (GAME_DATA.settings.fastMoneyTimeP1 || 30)
      : (GAME_DATA.settings.fastMoneyTimeP2 || 30);

    $('fm-btn-start-p1').disabled = true;
    $('fm-btn-start-p2').disabled = true;
    $('fm-grading-box').classList.add('hidden');

    fmShowView('entry');
    startFMTimer(timeLimit);      // set the clock BEFORE the first broadcast
    fmShowEntryQuestion();        // broadcasts question + correct timeLeft
    updateStatusBar(`Player ${playerIdx + 1} — type their answer, ENTER for next question!`);
  }

  function fmShowEntryQuestion() {
    const questions = fmQuestions();
    $('fm-entry-num').textContent = `QUESTION ${state.fmCurrentQ + 1} / ${questions.length}`;
    $('fm-entry-question').textContent = questions[state.fmCurrentQ].question;
    const input = $('fm-entry-input');
    input.value = '';
    input.focus();
    broadcastState(); // remote panel sees the new question
  }

  // Save the typed answer and advance. `textOverride` comes from the
  // remote host panel; otherwise the board's input box is read.
  function fmEntrySubmit(textOverride) {
    if (state.fmStage !== 'entry') return;
    const p = state.fmCurrentPlayer;
    const text = (textOverride !== undefined ? String(textOverride) : $('fm-entry-input').value).trim();
    state.fmAnswers[p][state.fmCurrentQ].text = text; // empty = pass
    Sounds.tick();

    state.fmCurrentQ++;
    if (state.fmCurrentQ >= fmQuestions().length) {
      endFMEntry(false);
    } else {
      fmShowEntryQuestion();
    }
  }

  // Entry over — either all questions answered or the clock hit zero.
  function endFMEntry(timedOut) {
    clearFMTimer();
    if (timedOut) Sounds.timeUp();
    state.fmStage = 'grading';
    state.fmCurrentQ = 0;

    fmShowView('board');
    fmHighlightRow(0);
    $('fm-grading-box').classList.remove('hidden');
    $('fm-grading-qnum').textContent = 'Q1';
    $('fm-btn-reveal-said').disabled = false;
    $('fm-match-wrap').classList.add('hidden');
    updateStatusBar(
      `Time! Now reveal Player ${state.fmCurrentPlayer + 1}'s answers one by one and award points.`
    );
    broadcastState();
  }

  function fmHighlightRow(idx) {
    $all('.fm-row').forEach((r, i) => r.classList.toggle('fm-active', i === idx));
  }

  // ── GRADING STAGE ──────────────────────────────────────────
  // Normalise for matching: lowercase, strip punctuation, squash spaces.
  function fmNorm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Find the best answer-bank match for what the player said.
  // Returns bank index or -1 for no match.
  function fmMatchBank(qIdx, saidText) {
    const said = fmNorm(saidText);
    if (!said) return -1;
    const bank = fmQuestions()[qIdx].answers.map((a) => fmNorm(a.text));

    let i = bank.findIndex((b) => b === said);
    if (i >= 0) return i;
    i = bank.findIndex((b) => b.includes(said) || said.includes(b));
    if (i >= 0) return i;
    // Token overlap (any shared word longer than 2 chars)
    const saidTokens = new Set(said.split(' ').filter((w) => w.length > 2));
    i = bank.findIndex((b) => b.split(' ').some((w) => w.length > 2 && saidTokens.has(w)));
    return i;
  }

  // Step 1 — reveal what the player said on the board.
  function fmRevealSaid() {
    if (state.fmStage !== 'grading') return;
    const p = state.fmCurrentPlayer;
    const q = state.fmCurrentQ;
    const rec = state.fmAnswers[p][q];
    if (rec.said) return;
    rec.said = true;

    const cell = $(`fm-p${p + 1}-q${q}`);
    cell.textContent = rec.text || '(no answer)';
    cell.classList.remove('fm-covered');
    cell.classList.add('fm-said-reveal');
    Sounds.reveal();

    // Build the answer-bank selector with the auto-match preselected
    const bank = fmQuestions()[q].answers;
    const match = fmMatchBank(q, rec.text);
    const sel = $('fm-bank-select');
    sel.innerHTML = '';
    bank.forEach((a, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${a.text} — ${a.points} pts`;
      sel.appendChild(opt);
    });
    const none = document.createElement('option');
    none.value = -1;
    none.textContent = 'No match — 0 pts';
    sel.appendChild(none);
    sel.value = String(match);

    $('fm-match-hint').textContent = match >= 0
      ? `Auto-matched: "${bank[match].text}" (${bank[match].points} pts) — change if wrong:`
      : 'No bank match found — pick one or award 0:';
    $('fm-match-wrap').classList.remove('hidden');
    $('fm-btn-reveal-said').disabled = true;
    broadcastState(); // remote panel gets the revealed answer + bank
  }

  // Step 2 — award the selected bank answer's points. `bankIdxOverride`
  // comes from the remote host panel; otherwise the board's dropdown.
  function fmAwardPoints(bankIdxOverride) {
    if (state.fmStage !== 'grading') return;
    const p = state.fmCurrentPlayer;
    const q = state.fmCurrentQ;
    const rec = state.fmAnswers[p][q];
    if (!rec.said || rec.graded) return;

    const bank = fmQuestions()[q].answers;
    const idx = bankIdxOverride !== undefined
      ? parseInt(bankIdxOverride)
      : parseInt($('fm-bank-select').value);
    const pts = idx >= 0 && bank[idx] ? bank[idx].points : 0;

    rec.pts = pts;
    rec.graded = true;
    state.fmScores[p] += pts;

    const ptsEl = $(`fm-p${p + 1}-pts${q}`);
    ptsEl.textContent = pts > 0 ? pts : 'X';
    ptsEl.classList.remove('fm-covered');
    ptsEl.classList.toggle('pts-zero', pts === 0);

    if (pts > 0) Sounds.correct();
    else         Sounds.wrong();

    $(`fm-p${p + 1}-score`).textContent = state.fmScores[p];
    $('fm-total').textContent = state.fmScores[0] + state.fmScores[1];

    // Advance to the next question, or wrap up this player's grading
    state.fmCurrentQ++;
    if (state.fmCurrentQ >= fmQuestions().length) {
      endFMGrading();
    } else {
      fmHighlightRow(state.fmCurrentQ);
      $('fm-grading-qnum').textContent = `Q${state.fmCurrentQ + 1}`;
      $('fm-btn-reveal-said').disabled = false;
      $('fm-match-wrap').classList.add('hidden');
      broadcastState();
    }
  }

  function endFMGrading() {
    fmHighlightRow(-1);
    $('fm-grading-box').classList.add('hidden');

    if (state.fmCurrentPlayer === 0) {
      state.fmStage = 'between';
      $('fm-btn-start-p2').disabled = false;
      updateStatusBar(
        `Player 1 scored ${state.fmScores[0]}! Bring in Player 2 and press PLAYER 2 START.`
      );
    } else {
      state.fmStage = 'done';
      finishFastMoney();
    }
    broadcastState();
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
        endFMEntry(true); // time's up mid-entry
      } else {
        broadcastState(); // keep the remote panel's clock in step
      }
    }, 1000);
  }

  function clearFMTimer() {
    clearInterval(state.fmTimer);
    state.fmTimer = null;
  }

  function finishFastMoney() {
    const total  = state.fmScores[0] + state.fmScores[1];
    const target = GAME_DATA.settings.fastMoneyTarget || 200;
    const won    = total >= target;
    clearFMTimer();

    $('fm-total').classList.toggle('fm-win', won);
    $('fm-result-text').textContent = won
      ? `${total} POINTS — ${state.teams[state.fmTeam].name.toUpperCase()} WINS THE GRAND PRIZE!`
      : `${total} points — so close! ${target} needed.`;
    $('fm-result-banner').classList.remove('hidden');

    if (won) Sounds.gameOver();
    else     Sounds.roundWin();

    setTimeout(() => showEndScreen(), 3500);
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
    state.roundPrepared = false;
    setStartRoundLabel(false);
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
    $('btn-mute').innerHTML = Icons.svg(muted ? 'volumeOff' : 'volumeOn');
  }

  // ── KEYBOARD SHORTCUTS ─────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const key = e.key.toLowerCase();

    // Buzz: Q = Team 1, P = Team 2
    if (key === 'q') buzzIn(0);
    if (key === 'p') buzzIn(1);

    // Reveal answers 1-8 by keyboard number
    if (/^[1-8]$/.test(key)) {
      const ans = state.currentRound?.answers[parseInt(key) - 1];
      if (ans) {
        if (state.phase === 'faceoffAnswer') faceoffReveal(ans.id);
        else if (state.phase === 'playing' || state.phase === 'steal') revealAnswer(ans.id);
        else if (state.phase === 'roundEnd') revealLeftover(ans.id);
      }
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
        if (state.phase === 'faceoffAnswer') {
          faceoffReveal(Number(msg.ansId));
        } else if (state.phase === 'playing' || state.phase === 'steal') {
          revealAnswer(Number(msg.ansId));
        } else if (state.phase === 'roundEnd') {
          revealLeftover(Number(msg.ansId));
        }
        break;
      case 'strike':         addStrike(); break;
      case 'pass':           passControl(); break;
      case 'choose-play':    chooseControl(true);  break;
      case 'choose-pass':    chooseControl(false); break;
      case 'steal-correct':  stealCorrect(msg.ansId ? Number(msg.ansId) : null); break;
      case 'steal-wrong':    stealWrong(); break;
      case 'reveal-all':     revealAllAnswers(); break;
      case 'next-round':     advanceAfterRound(); break;
      case 'buzz':           buzzIn(Number(msg.team)); break;
      // Fast Money remote control
      case 'fm-start':       startFMPlayer(Number(msg.player)); break;
      case 'fm-entry':       fmEntrySubmit(String(msg.text ?? '')); break;
      case 'fm-reveal-said': fmRevealSaid(); break;
      case 'fm-award':       fmAwardPoints(Number(msg.bankIdx)); break;
      case 'fm-finish':
        if (state.phase === 'fastMoney' && state.fmStage !== 'done') {
          clearFMTimer();
          state.fmStage = 'done';
          finishFastMoney();
        }
        break;
      case 'end-game':
        if (!['intro', 'lobby', 'gameEnd'].includes(state.phase)) endGameNow();
        break;
    }
  }

  // ── EVENT WIRING ───────────────────────────────────────────
  function init() {
    // Replace all [data-icon] placeholders with inline SVG
    if (window.Icons) Icons.hydrate(document);
    setStartRoundLabel(false);

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
    $('btn-choose-play').addEventListener('click', () => chooseControl(true));
    $('btn-choose-pass').addEventListener('click', () => chooseControl(false));
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
    $('fm-entry-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        fmEntrySubmit();
      }
    });
    $('fm-btn-reveal-said').addEventListener('click', fmRevealSaid);
    $('fm-btn-award').addEventListener('click', fmAwardPoints);
    $('fm-btn-end-fm').addEventListener('click', () => {
      if (!confirm('Finish Fast Money now with the current total?')) return;
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
