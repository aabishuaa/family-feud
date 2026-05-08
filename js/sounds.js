// ============================================================
// sounds.js — Synthesized sound effects via Web Audio API
// No external files needed. All sounds generated in real-time.
// ============================================================

const Sounds = (() => {
  let ctx = null;
  let muted = false;
  let masterGain = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.8;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, duration, type = 'sine', vol = 0.35, startTime = 0) {
    if (muted) return;
    const c = getCtx();
    const t = c.currentTime + startTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(masterGain);
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  function toneRamp(freqStart, freqEnd, duration, type = 'sine', vol = 0.3, startTime = 0) {
    if (muted) return;
    const c = getCtx();
    const t = c.currentTime + startTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(masterGain);
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  function noise(duration, freqLow = 200, freqHigh = 8000, vol = 0.15, startTime = 0) {
    if (muted) return;
    const c = getCtx();
    const t = c.currentTime + startTime;
    const samples = Math.ceil(c.sampleRate * duration);
    const buffer = c.createBuffer(1, samples, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = (freqLow + freqHigh) / 2;
    filter.Q.value = 0.5;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    src.start(t);
  }

  // ── Public sound methods ──────────────────────────────────

  // Intro theme — short ascending fanfare
  function theme() {
    const melody = [
      [392, 0.12], [523, 0.12], [659, 0.12], [784, 0.18],
      [659, 0.10], [784, 0.10], [1047, 0.45],
    ];
    let t = 0;
    melody.forEach(([f, d]) => { tone(f, d + 0.08, 'sine', 0.38, t); t += d; });
  }

  // Buzz-in sound — two-tone alert
  function buzzIn() {
    tone(880, 0.12, 'square', 0.28, 0);
    tone(1320, 0.18, 'square', 0.25, 0.12);
  }

  // Correct answer — bright ascending bell chord
  function correct() {
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((f, i) => tone(f, 0.55, 'sine', 0.38, i * 0.11));
  }

  // #1 answer — extra triumphant ascending run
  function numberOne() {
    const run = [440, 554, 659, 880, 1108, 1320];
    run.forEach((f, i) => tone(f, 0.22, 'sine', 0.32, i * 0.07));
  }

  // Wrong answer — harsh descending buzzer
  function wrong() {
    const c = getCtx();
    if (muted) return;
    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    // Distortion wave shaper for buzzer texture
    const dist = c.createWaveShaper();
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = (Math.PI + 200) * x / (Math.PI + 200 * Math.abs(x));
    }
    dist.curve = curve;
    osc.connect(dist);
    dist.connect(gain);
    gain.connect(masterGain);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.setValueAtTime(130, t + 0.25);
    osc.frequency.setValueAtTime(90,  t + 0.55);
    gain.gain.setValueAtTime(0.38, t);
    gain.gain.setValueAtTime(0.35, t + 0.6);
    gain.gain.linearRampToValueAtTime(0, t + 0.8);
    osc.start(t);
    osc.stop(t + 0.85);
  }

  // Strike — three heavy descending thumps
  function strike() {
    [[196, 0], [147, 0.28], [110, 0.56]].forEach(([f, delay]) => {
      tone(f, 0.35, 'square', 0.3, delay);
      noise(0.3, 100, 400, 0.1, delay);
    });
  }

  // Tile reveal — quick whoosh + bell
  function reveal() {
    noise(0.18, 1000, 8000, 0.12, 0);
    toneRamp(400, 900, 0.12, 'sine', 0.18, 0);
    tone(880, 0.35, 'sine', 0.3, 0.12);
  }

  // Reveal all remaining answers — sweeping whoosh + fanfare
  function revealAll() {
    noise(0.6, 500, 8000, 0.18, 0);
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => tone(f, 0.3, 'sine', 0.32, 0.2 + i * 0.1));
  }

  // "SURVEY SAYS!" announcement sting
  function surveySays() {
    tone(440, 0.18, 'sine', 0.35, 0);
    tone(880, 0.18, 'sine', 0.35, 0.18);
    tone(1320, 0.4,  'sine', 0.38, 0.36);
  }

  // Steal attempt — dramatic tense sting
  function steal() {
    [220, 277, 330, 415, 554].forEach((f, i) => tone(f, 0.28, 'sawtooth', 0.18, i * 0.08));
  }

  // Steal success — triumphant gliss
  function stealWin() {
    [330, 415, 523, 659, 830].forEach((f, i) => tone(f, 0.28, 'sine', 0.32, i * 0.09));
  }

  // Steal fail — sad trombone-ish drop
  function stealFail() {
    toneRamp(440, 220, 0.5, 'sawtooth', 0.25, 0);
    toneRamp(330, 165, 0.5, 'sawtooth', 0.15, 0.12);
  }

  // Round win fanfare
  function roundWin() {
    const melody = [
      [523, 0.14], [523, 0.14], [523, 0.14],
      [659, 0.28], [523, 0.14], [659, 0.14], [784, 0.55],
    ];
    let t = 0;
    melody.forEach(([f, d]) => { tone(f, d + 0.08, 'sine', 0.38, t); t += d; });
  }

  // Game over grand fanfare
  function gameOver() {
    const melody = [
      [523, 0.18], [659, 0.18], [784, 0.18], [1047, 0.32],
      [784, 0.18], [1047, 0.18], [1319, 0.65],
    ];
    let t = 0;
    melody.forEach(([f, d]) => {
      tone(f, d + 0.1, 'sine', 0.42, t);
      tone(f / 2, d + 0.1, 'sine', 0.18, t); // low harmony
      t += d;
    });
  }

  // Fast money countdown tick
  function tick() {
    tone(440, 0.08, 'square', 0.18, 0);
  }

  // Fast money last-5-seconds urgent tick
  function urgentTick() {
    tone(880, 0.08, 'square', 0.22, 0);
  }

  // Fast money time-up buzzer
  function timeUp() {
    wrong();
  }

  function toggleMute() {
    muted = !muted;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.8;
    return muted;
  }

  // Warm up the audio context on first user interaction
  function init() {
    getCtx();
  }

  return {
    theme, buzzIn, correct, numberOne, wrong, strike,
    reveal, revealAll, surveySays, steal, stealWin, stealFail,
    roundWin, gameOver, tick, urgentTick, timeUp,
    toggleMute, init,
    get muted() { return muted; },
  };
})();
