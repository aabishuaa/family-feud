// ============================================================
// admin.js — game-pack manager
// Talks to the server's /api/packs REST endpoints.
// Falls back to GAME_PACK_SEEDS when the server is unreachable.
// ============================================================

(function () {
  'use strict';

  const $  = (id) => document.getElementById(id);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  // ── State ────────────────────────────────────────────────
  let packs = [];          // summary list
  let currentPack = null;  // full pack of the one being edited
  let dirty = false;       // unsaved changes?

  let roundQuery = ''; // current rounds search filter (lower-cased)

  // ── Boot ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    if (window.Icons) Icons.hydrate(document);
    createStarfield();
    wireGlobalUi();
    await refreshPackList();
  });

  function createStarfield() {
    const c = $('stars-container');
    if (!c) return;
    for (let i = 0; i < 80; i++) {
      const s = document.createElement('div');
      s.className = 'star';
      s.style.cssText = `
        left:${Math.random()*100}%;top:${Math.random()*100}%;
        width:${1+Math.random()*2}px;height:${1+Math.random()*2}px;
        animation-delay:${Math.random()*4}s;animation-duration:${2+Math.random()*3}s;`;
      c.appendChild(s);
    }
  }

  // ── API helpers ──────────────────────────────────────────
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed: ${res.status}`);
    }
    return res.json();
  }

  // ── Pack list (left sidebar) ─────────────────────────────
  async function refreshPackList() {
    const list = $('pack-list');
    try {
      const data = await api('/api/packs');
      packs = data.packs || [];
    } catch (err) {
      // Server unreachable — fall back to seeds for read-only browsing
      list.innerHTML = `<div class="pack-list-empty">${Icons.svg('warning')} Server unreachable — start with <code>npm start</code> to enable editing.</div>`;
      packs = (window.GAME_PACK_SEEDS || []).map((p) => ({
        id: p.id, name: p.name, icon: p.icon, builtIn: p.builtIn,
        roundCount: p.rounds.length, fmCount: p.fastMoneyRounds?.[0]?.questions?.length || 0,
      }));
      renderPackList();
      return;
    }
    renderPackList();
  }

  function renderPackList() {
    const list = $('pack-list');
    list.innerHTML = '';
    if (!packs.length) {
      list.innerHTML = '<div class="pack-list-empty">No game modes yet — click NEW MODE to create one.</div>';
      return;
    }
    packs.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'pack-item';
      if (currentPack?.id === p.id) item.classList.add('active');
      item.innerHTML = `
        <span class="pack-icon">${p.icon || '🎯'}</span>
        <div class="pack-info">
          <div class="pack-name">${escapeHtml(p.name)}</div>
          <div class="pack-meta">
            <span>${p.roundCount} rounds</span>
            <span>·</span>
            <span>${p.fmCount} fast money</span>
            ${p.builtIn ? '<span class="builtin-tag">BUILT-IN</span>' : ''}
          </div>
        </div>`;
      item.addEventListener('click', () => loadPack(p.id));
      list.appendChild(item);
    });
  }

  // ── Load a pack into the editor ──────────────────────────
  async function loadPack(id) {
    if (dirty) {
      const ok = await confirmDialog('Unsaved changes', 'Discard your changes and load a different pack?', 'DISCARD');
      if (!ok) return;
    }
    try {
      const data = await api(`/api/packs/${id}`);
      currentPack = data.pack;
    } catch (err) {
      // Fallback to seed if server fetch fails
      const seed = (window.GAME_PACK_SEEDS || []).find((p) => p.id === id);
      if (!seed) { toast('Failed to load pack: ' + err.message, true); return; }
      currentPack = JSON.parse(JSON.stringify(seed));
    }
    dirty = false;
    renderPackList();
    renderEditor();
  }

  // ── Editor rendering ─────────────────────────────────────
  function renderEditor() {
    $('editor-empty').classList.add('hidden');
    $('editor-content').classList.remove('hidden');
    const p = currentPack;

    // Reset the rounds search when opening a different pack
    roundQuery = '';
    if ($('rounds-search')) $('rounds-search').value = '';
    if ($('rounds-search-clear')) $('rounds-search-clear').classList.add('hidden');

    $('pack-icon').value = p.icon || '🎯';
    $('pack-name').value = p.name || '';

    const fmCount = p.fastMoneyRounds?.[0]?.questions?.length || 0;
    $('editor-stats').textContent =
      `${p.rounds.length} rounds · ${fmCount} fast money question${fmCount === 1 ? '' : 's'}`;

    // Read-only banner for built-in packs
    const ro = $('readonly-banner');
    ro.classList.toggle('hidden', !p.builtIn);
    setReadonlyMode(!!p.builtIn);

    renderRounds();
    renderFastMoney();
    renderSettings();
  }

  function setReadonlyMode(readonly) {
    $('btn-save').disabled   = readonly;
    $('btn-delete').disabled = readonly;
    $$('input', $('editor-content')).forEach((el) => {
      // settings inputs share these classes; just disable everywhere
      el.disabled = readonly;
    });
    // Re-enable name/icon to keep UX consistent (still saved when not readonly)
    $('pack-icon').disabled = readonly;
    $('pack-name').disabled = readonly;
    // Search is a browse aid — always usable, even on read-only packs
    if ($('rounds-search')) $('rounds-search').disabled = false;
  }

  function renderRounds() {
    const wrap = $('rounds-container');
    wrap.innerHTML = '';
    const total = currentPack.rounds.length;
    const countEl = $('rounds-count');

    if (!total) {
      wrap.innerHTML = '<div class="rounds-empty">No rounds yet — click ADD ROUND to start.</div>';
      if (countEl) countEl.textContent = '';
      return;
    }

    // Filter by the search query (matches question text or any answer text)
    const q = roundQuery;
    const matches = currentPack.rounds
      .map((round, i) => ({ round, i }))
      .filter(({ round }) => {
        if (!q) return true;
        if ((round.question || '').toLowerCase().includes(q)) return true;
        return (round.answers || []).some((a) => (a.text || '').toLowerCase().includes(q));
      });

    if (countEl) {
      countEl.textContent = q
        ? `${matches.length} of ${total} shown`
        : `${total} round${total === 1 ? '' : 's'}`;
    }

    if (!matches.length) {
      wrap.innerHTML = `<div class="rounds-empty">No rounds match “${escapeHtml(q)}”.</div>`;
      return;
    }

    // Keep original index so edits/reorder/delete stay correct
    matches.forEach(({ round, i }) => wrap.appendChild(buildRoundCard(round, i)));
  }

  function buildRoundCard(round, idx) {
    const card = document.createElement('div');
    card.className = 'round-card';
    card.innerHTML = `
      <div class="round-head">
        <div class="round-num">${idx + 1}</div>
        <input class="round-question" type="text" value="${escapeAttr(round.question)}"
               placeholder="We surveyed 100 people…">
        <div class="round-actions">
          <button class="icon-btn" data-act="up"     title="Move up">${Icons.svg('chevUp')}</button>
          <button class="icon-btn" data-act="down"   title="Move down">${Icons.svg('chevDown')}</button>
          <button class="icon-btn danger" data-act="delete" title="Delete round">${Icons.svg('trash')}</button>
        </div>
      </div>
      <div class="answers-list"></div>
      <button class="btn-add-answer">${Icons.svg('plus')} ADD ANSWER</button>
    `;

    // Question input
    card.querySelector('.round-question').addEventListener('input', (e) => {
      round.question = e.target.value;
      markDirty();
    });

    // Answers
    const list = card.querySelector('.answers-list');
    round.answers.forEach((ans, ai) => list.appendChild(buildAnswerRow(round, ans, ai)));

    // Add answer
    card.querySelector('.btn-add-answer').addEventListener('click', () => {
      if (round.answers.length >= 8) { toast('Max 8 answers per round', true); return; }
      const newId = (Math.max(0, ...round.answers.map((a) => a.id)) || 0) + 1;
      round.answers.push({ id: newId, text: '', points: 0 });
      list.appendChild(buildAnswerRow(round, round.answers[round.answers.length - 1], round.answers.length - 1));
      markDirty();
    });

    // Round actions
    card.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => roundAction(btn.dataset.act, idx));
    });

    return card;
  }

  function buildAnswerRow(round, ans, idx) {
    const row = document.createElement('div');
    row.className = 'answer-row';
    row.innerHTML = `
      <span class="answer-rank">${idx + 1}</span>
      <input class="answer-text-input"   type="text"   value="${escapeAttr(ans.text)}"   placeholder="Answer text">
      <input class="answer-points-input" type="number" value="${ans.points}" min="0" max="100">
      <button class="icon-btn danger" title="Delete">${Icons.svg('strike')}</button>
    `;
    const [textInput, ptsInput, delBtn] =
      [row.querySelector('.answer-text-input'), row.querySelector('.answer-points-input'), row.querySelector('button')];
    textInput.addEventListener('input', () => { ans.text   = textInput.value; markDirty(); });
    ptsInput .addEventListener('input', () => { ans.points = Number(ptsInput.value) || 0; markDirty(); });
    delBtn   .addEventListener('click', () => {
      const i = round.answers.indexOf(ans);
      if (i >= 0) round.answers.splice(i, 1);
      markDirty();
      renderRounds();
    });
    return row;
  }

  function roundAction(act, idx) {
    const r = currentPack.rounds;
    if (act === 'up' && idx > 0) {
      [r[idx - 1], r[idx]] = [r[idx], r[idx - 1]];
    } else if (act === 'down' && idx < r.length - 1) {
      [r[idx + 1], r[idx]] = [r[idx], r[idx + 1]];
    } else if (act === 'delete') {
      r.splice(idx, 1);
    } else {
      return;
    }
    markDirty();
    renderRounds();
  }

  // ── Fast Money ───────────────────────────────────────────
  function renderFastMoney() {
    const wrap = $('fm-container');
    wrap.innerHTML = '';
    const fmRound = currentPack.fastMoneyRounds?.[0];
    if (!fmRound) {
      currentPack.fastMoneyRounds = [{ questions: [] }];
    }
    const questions = currentPack.fastMoneyRounds[0].questions;

    if (!questions.length) {
      wrap.innerHTML = '<div class="rounds-empty">No fast money questions yet — click ADD FAST MONEY QUESTION.</div>';
      return;
    }
    questions.forEach((q, i) => wrap.appendChild(buildFmCard(q, i)));
  }

  function buildFmCard(q, idx) {
    const card = document.createElement('div');
    card.className = 'fm-card';
    card.innerHTML = `
      <div class="round-head">
        <div class="round-num">${idx + 1}</div>
        <input class="round-question" type="text" value="${escapeAttr(q.question)}"
               placeholder="Fast money question…">
        <div class="round-actions">
          <button class="icon-btn danger" data-act="delete-fm" title="Delete">${Icons.svg('trash')}</button>
        </div>
      </div>
      <div class="answers-list"></div>
      <button class="btn-add-answer">${Icons.svg('plus')} ADD ANSWER</button>
    `;
    card.querySelector('.round-question').addEventListener('input', (e) => {
      q.question = e.target.value;
      markDirty();
    });
    const list = card.querySelector('.answers-list');
    q.answers = q.answers || [];
    q.answers.forEach((ans, ai) => list.appendChild(buildFmAnswerRow(q, ans, ai)));
    card.querySelector('.btn-add-answer').addEventListener('click', () => {
      if (q.answers.length >= 6) { toast('Max 6 answers', true); return; }
      q.answers.push({ text: '', points: 0 });
      list.appendChild(buildFmAnswerRow(q, q.answers[q.answers.length - 1], q.answers.length - 1));
      markDirty();
    });
    card.querySelector('[data-act="delete-fm"]').addEventListener('click', () => {
      const arr = currentPack.fastMoneyRounds[0].questions;
      arr.splice(idx, 1);
      markDirty();
      renderFastMoney();
    });
    return card;
  }

  function buildFmAnswerRow(q, ans, idx) {
    const row = document.createElement('div');
    row.className = 'answer-row';
    row.innerHTML = `
      <span class="answer-rank">${idx + 1}</span>
      <input class="answer-text-input"   type="text"   value="${escapeAttr(ans.text)}"   placeholder="Answer text">
      <input class="answer-points-input" type="number" value="${ans.points}" min="0" max="100">
      <button class="icon-btn danger" title="Delete">${Icons.svg('strike')}</button>
    `;
    const [textInput, ptsInput, delBtn] =
      [row.querySelector('.answer-text-input'), row.querySelector('.answer-points-input'), row.querySelector('button')];
    textInput.addEventListener('input', () => { ans.text   = textInput.value; markDirty(); });
    ptsInput .addEventListener('input', () => { ans.points = Number(ptsInput.value) || 0; markDirty(); });
    delBtn   .addEventListener('click', () => {
      const i = q.answers.indexOf(ans);
      if (i >= 0) q.answers.splice(i, 1);
      markDirty();
      renderFastMoney();
    });
    return row;
  }

  // ── Settings ─────────────────────────────────────────────
  function renderSettings() {
    const s = currentPack.settings || {};
    $('set-total-rounds').value = s.totalRounds ?? 4;
    $('set-max-strikes').value  = s.maxStrikes  ?? 3;
    $('set-multipliers').value  = (s.roundMultipliers || [1, 2, 3, 4]).join(', ');
    $('set-fm-target').value    = s.fastMoneyTarget ?? 200;
    $('set-fm-time1').value     = s.fastMoneyTimeP1 ?? 30;
    $('set-fm-time2').value     = s.fastMoneyTimeP2 ?? 30;
  }

  function readSettings() {
    const mult = $('set-multipliers').value
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n) && n > 0);
    return {
      totalRounds:    Math.max(1, Math.min(6, parseInt($('set-total-rounds').value) || 4)),
      maxStrikes:     Math.max(1, Math.min(5, parseInt($('set-max-strikes').value)  || 3)),
      roundMultipliers: mult.length ? mult : [1, 2, 3, 4],
      fastMoneyTarget:  Math.max(50,  Math.min(500, parseInt($('set-fm-target').value)  || 200)),
      fastMoneyTimeP1:  Math.max(5,   Math.min(120, parseInt($('set-fm-time1').value)   || 30)),
      fastMoneyTimeP2:  Math.max(5,   Math.min(120, parseInt($('set-fm-time2').value)   || 30)),
    };
  }

  // ── Tabs ─────────────────────────────────────────────────
  function activateTab(name) {
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.tabPanel === name));
  }

  // ── Save / create / delete ───────────────────────────────
  async function savePack() {
    if (!currentPack) return;
    if (currentPack.builtIn) { toast('Built-in packs cannot be edited', true); return; }
    const payload = {
      name: $('pack-name').value.trim() || 'Untitled',
      icon: $('pack-icon').value.trim() || '🎯',
      settings: readSettings(),
      rounds: currentPack.rounds,
      fastMoneyRounds: currentPack.fastMoneyRounds,
    };
    try {
      const data = await api(`/api/packs/${currentPack.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      currentPack = data.pack;
      dirty = false;
      toast('Saved!');
      await refreshPackList();
      renderEditor();
    } catch (err) {
      toast('Save failed: ' + err.message, true);
    }
  }

  async function createPack() {
    if (dirty) {
      const ok = await confirmDialog('Unsaved changes', 'Discard your changes and create a new pack?', 'DISCARD');
      if (!ok) return;
    }
    try {
      const data = await api('/api/packs', {
        method: 'POST',
        body: JSON.stringify({ name: 'New Mode', icon: '🎯' }),
      });
      currentPack = data.pack;
      dirty = false;
      await refreshPackList();
      renderEditor();
      activateTab('rounds');
      $('pack-name').focus();
      $('pack-name').select();
      toast('New mode created — start adding questions!');
    } catch (err) {
      toast('Create failed: ' + err.message, true);
    }
  }

  async function deletePack() {
    if (!currentPack || currentPack.builtIn) return;
    const ok = await confirmDialog(
      `Delete “${currentPack.name}”?`,
      'This will permanently remove the mode and all its questions. This cannot be undone.',
      'DELETE',
    );
    if (!ok) return;
    try {
      await api(`/api/packs/${currentPack.id}`, { method: 'DELETE' });
      currentPack = null;
      dirty = false;
      $('editor-content').classList.add('hidden');
      $('editor-empty').classList.remove('hidden');
      await refreshPackList();
      toast('Mode deleted');
    } catch (err) {
      toast('Delete failed: ' + err.message, true);
    }
  }

  async function duplicatePack() {
    if (!currentPack) return;
    try {
      const data = await api('/api/packs', {
        method: 'POST',
        body: JSON.stringify({
          name: `${currentPack.name} (Copy)`,
          icon: currentPack.icon,
          settings: currentPack.settings,
          rounds: currentPack.rounds,
          fastMoneyRounds: currentPack.fastMoneyRounds,
        }),
      });
      currentPack = data.pack;
      dirty = false;
      await refreshPackList();
      renderEditor();
      toast('Duplicated — edit your copy below.');
    } catch (err) {
      toast('Duplicate failed: ' + err.message, true);
    }
  }

  // ── UI helpers ───────────────────────────────────────────
  function markDirty() { dirty = true; }

  function toast(msg, isError = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.remove('hidden');
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.classList.add('hidden'), 300);
    }, 2400);
  }

  function confirmDialog(title, msg, okLabel = 'CONFIRM') {
    return new Promise((resolve) => {
      $('confirm-title').textContent = title;
      $('confirm-msg').textContent   = msg;
      $('confirm-ok').textContent    = okLabel;
      $('confirm-overlay').classList.remove('hidden');
      const cleanup = (val) => {
        $('confirm-overlay').classList.add('hidden');
        $('confirm-ok').onclick     = null;
        $('confirm-cancel').onclick = null;
        resolve(val);
      };
      $('confirm-ok').onclick     = () => cleanup(true);
      $('confirm-cancel').onclick = () => cleanup(false);
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ── Wire global UI events ────────────────────────────────
  function wireGlobalUi() {
    $('btn-new-pack').addEventListener('click', createPack);
    $('btn-save').addEventListener('click', savePack);
    $('btn-delete').addEventListener('click', deletePack);
    $('btn-cancel').addEventListener('click', async () => {
      if (!currentPack) return;
      if (dirty) {
        const ok = await confirmDialog('Reload', 'Discard unsaved changes and reload?', 'DISCARD');
        if (!ok) return;
      }
      loadPack(currentPack.id);
    });
    $('btn-duplicate').addEventListener('click', duplicatePack);

    // Rounds search
    const searchInput = $('rounds-search');
    const searchClear = $('rounds-search-clear');
    searchInput.addEventListener('input', () => {
      roundQuery = searchInput.value.trim().toLowerCase();
      searchClear.classList.toggle('hidden', !searchInput.value);
      if (currentPack) renderRounds();
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      roundQuery = '';
      searchClear.classList.add('hidden');
      renderRounds();
      searchInput.focus();
    });

    $('btn-add-round').addEventListener('click', () => {
      if (!currentPack || currentPack.builtIn) return;
      // Clear any active search so the newly-added round is visible
      if (roundQuery) {
        roundQuery = '';
        searchInput.value = '';
        searchClear.classList.add('hidden');
      }
      const newId = (Math.max(0, ...currentPack.rounds.map((r) => r.id)) || 0) + 1;
      currentPack.rounds.push({
        id: newId,
        question: '',
        answers: [{ id: 1, text: '', points: 0 }],
      });
      markDirty();
      renderRounds();
      // Scroll to and focus the new round's question field
      const cards = $('rounds-container').querySelectorAll('.round-card');
      const last = cards[cards.length - 1];
      if (last) {
        last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        last.querySelector('.round-question')?.focus();
      }
    });

    $('btn-add-fm').addEventListener('click', () => {
      if (!currentPack || currentPack.builtIn) return;
      currentPack.fastMoneyRounds = currentPack.fastMoneyRounds || [{ questions: [] }];
      currentPack.fastMoneyRounds[0].questions = currentPack.fastMoneyRounds[0].questions || [];
      if (currentPack.fastMoneyRounds[0].questions.length >= 5) {
        toast('Max 5 fast money questions', true);
        return;
      }
      currentPack.fastMoneyRounds[0].questions.push({
        question: '',
        answers: [{ text: '', points: 0 }],
      });
      markDirty();
      renderFastMoney();
    });

    // Header inputs
    $('pack-name').addEventListener('input', (e) => {
      currentPack && (currentPack.name = e.target.value);
      markDirty();
    });
    $('pack-icon').addEventListener('input', (e) => {
      currentPack && (currentPack.icon = e.target.value);
      markDirty();
    });

    // Settings → also flag dirty
    ['set-total-rounds','set-max-strikes','set-multipliers','set-fm-target','set-fm-time1','set-fm-time2']
      .forEach((id) => $(id).addEventListener('input', markDirty));

    // Tabs
    $$('.tab-btn').forEach((b) => b.addEventListener('click', () => activateTab(b.dataset.tab)));

    // Warn before leaving with unsaved changes
    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    // Cmd/Ctrl-S to save
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (currentPack && !currentPack.builtIn) savePack();
      }
    });
  }

})();
