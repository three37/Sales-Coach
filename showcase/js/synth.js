/* synth.js — a subtractive synthesizer and drum machine, built from oscillators.
   There are no samples here. The pluck is two detuned oscillators through a
   resonant low-pass filter whose cutoff sweeps with each note; the kick is a
   sine wave whose pitch falls 160 → 45 Hz in a tenth of a second; the snare
   and hat are shaped white noise. Reverb is a convolution against an impulse
   response the page synthesises on the fly. Notes are scheduled slightly
   ahead of the audio clock so timing stays tight while the UI redraws. */
(function () {
  'use strict';
  const STEPS = 16;
  const MELODY = [77, 75, 72, 70, 67, 65, 63, 60]; // C minor pentatonic, top row highest
  const DRUMS = ['kick', 'snare', 'hat'];
  const ROWS = MELODY.length + DRUMS.length;
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const euclid = (n, k, rot = 0) => Array.from({ length: n }, (_, i) => Math.floor(((i + rot) % n) * k / n) !== Math.floor((((i + rot) % n) - 1) * k / n) ? 1 : 0);

  const defaultPattern = () => {
    const p = Array.from({ length: ROWS }, () => new Uint8Array(STEPS));
    const notes = [[7, 0], [5, 2], [4, 3], [2, 6], [4, 8], [7, 10], [1, 12], [3, 14], [0, 15], [6, 4], [5, 11]];
    notes.forEach(([r, s]) => p[r][s] = 1);
    p[8].set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]);
    p[9].set([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1]);
    p[10].set([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1]);
    return p;
  };
  const generate = () => {
    const p = Array.from({ length: ROWS }, () => new Uint8Array(STEPS));
    p[8].set(euclid(STEPS, 3 + ((Math.random() * 3) | 0)));
    p[9].set(euclid(STEPS, 2 + ((Math.random() * 2) | 0), 4));
    p[10].set(euclid(STEPS, [5, 7, 9, 11][(Math.random() * 4) | 0], (Math.random() * 4) | 0));
    let row = 4 + ((Math.random() * 3) | 0);
    for (let s = 0; s < STEPS; s++) {
      if (Math.random() < 0.55 || s === 0) {
        row = Math.max(0, Math.min(7, row + [-2, -1, -1, 0, 1, 1, 2, 3][(Math.random() * 8) | 0]));
        p[row][s] = 1;
        if (Math.random() < 0.18) p[Math.max(0, Math.min(7, row + (Math.random() < 0.5 ? -2 : 2)))][s] = 1;
      }
    }
    return p;
  };
  Showcase.lib.synth = { euclid, generate, STEPS, ROWS };

  Showcase.register('synth', (root) => {
    const grid = root.querySelector('.seq-grid');
    const canvas = root.querySelector('canvas');
    const ctx2d = canvas.getContext('2d');
    const playBtn = root.querySelector('[data-action=play]');
    const tempo = root.querySelector('[data-tempo]');
    const tempoOut = root.querySelector('[data-tempo-out]');
    let pattern = defaultPattern();
    let ac = null, nodes = null, analyser = null, timer = 0, playing = false;
    let step = 0, nextTime = 0;
    const queue = [];
    const cells = [];

    /* ---- grid UI ---- */
    const NAMES = ['F5', 'E♭5', 'C5', 'B♭4', 'G4', 'F4', 'E♭4', 'C4'];
    grid.style.gridTemplateColumns = `3.4em repeat(${STEPS}, 1fr)`;
    for (let r = 0; r < ROWS; r++) for (let s = 0; s < STEPS; s++) {
      if (s === 0) { const l = document.createElement('span'); l.className = 'seq-label'; l.textContent = r < 8 ? NAMES[r] : DRUMS[r - 8]; grid.appendChild(l); }
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cell' + (r >= 8 ? ' drum' : '') + (s % 4 === 0 ? ' beat' : '');
      b.setAttribute('aria-label', `${r < 8 ? 'note ' + MELODY[r] : DRUMS[r - 8]} step ${s + 1}`);
      b.addEventListener('click', () => { pattern[r][s] ^= 1; b.classList.toggle('on', !!pattern[r][s]); });
      grid.appendChild(b); cells.push(b);
    }
    const paint = () => cells.forEach((b, i) => b.classList.toggle('on', !!pattern[(i / STEPS) | 0][i % STEPS]));
    paint();

    /* ---- audio graph ---- */
    const impulse = (seconds, decay) => {
      const len = ac.sampleRate * seconds, buf = ac.createBuffer(2, len, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
      return buf;
    };
    const noise = () => { const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return buf; };
    const build = () => {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const master = ac.createGain(); master.gain.value = 0.7;
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      analyser = ac.createAnalyser(); analyser.fftSize = 1024;
      master.connect(comp).connect(analyser).connect(ac.destination);
      const synthBus = ac.createGain(); synthBus.gain.value = 0.5; synthBus.connect(master);
      const delay = ac.createDelay(1); const fb = ac.createGain(); fb.gain.value = 0.32; const wet = ac.createGain(); wet.gain.value = 0.35;
      synthBus.connect(delay); delay.connect(fb).connect(delay); delay.connect(wet).connect(master);
      const verb = ac.createConvolver(); verb.buffer = impulse(2.2, 3.5); const verbGain = ac.createGain(); verbGain.gain.value = 0.28;
      synthBus.connect(verb).connect(verbGain).connect(master);
      const drumBus = ac.createGain(); drumBus.gain.value = 0.9; drumBus.connect(master); drumBus.connect(verb);
      nodes = { master, synthBus, drumBus, delay, noise: noise() };
    };
    const pluck = (t, freq) => {
      const o1 = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; o1.frequency.value = freq; o2.frequency.value = freq; o2.detune.value = 8;
      f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(Math.min(12000, freq * 8), t); f.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 0.35);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.006); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      o1.connect(f); o2.connect(f); f.connect(g).connect(nodes.synthBus);
      o1.start(t); o2.start(t); o1.stop(t + 0.6); o2.stop(t + 0.6);
    };
    const kick = (t) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
      g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      o.connect(g).connect(nodes.drumBus); o.start(t); o.stop(t + 0.45);
    };
    const snare = (t) => {
      const n = ac.createBufferSource(); n.buffer = nodes.noise; const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
      const g = ac.createGain(); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      n.connect(bp).connect(g).connect(nodes.drumBus); n.start(t); n.stop(t + 0.22);
      const o = ac.createOscillator(), g2 = ac.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
      g2.gain.setValueAtTime(0.5, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12); o.connect(g2).connect(nodes.drumBus); o.start(t); o.stop(t + 0.13);
    };
    const hat = (t) => {
      const n = ac.createBufferSource(); n.buffer = nodes.noise; const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8000;
      const g = ac.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      n.connect(hp).connect(g).connect(nodes.drumBus); n.start(t); n.stop(t + 0.06);
    };
    const trigger = (s, t) => {
      for (let r = 0; r < 8; r++) if (pattern[r][s]) pluck(t, hz(MELODY[r]));
      if (pattern[8][s]) kick(t); if (pattern[9][s]) snare(t); if (pattern[10][s]) hat(t);
    };
    const schedule = () => { // classic look-ahead scheduler
      const spb = 60 / +tempo.value / 4;
      while (nextTime < ac.currentTime + 0.12) {
        trigger(step, nextTime); queue.push({ step, time: nextTime });
        nextTime += spb; step = (step + 1) % STEPS;
      }
    };
    const start = async () => {
      if (!ac) build();
      if (ac.state === 'suspended') await ac.resume();
      playing = true; step = 0; nextTime = ac.currentTime + 0.05;
      timer = setInterval(schedule, 25);
      playBtn.textContent = 'Stop'; playBtn.classList.add('on');
    };
    const stop = () => {
      playing = false; clearInterval(timer); queue.length = 0;
      cells.forEach((c) => c.classList.remove('now'));
      playBtn.textContent = 'Play'; playBtn.classList.remove('on');
    };
    playBtn.addEventListener('click', () => playing ? stop() : start());
    root.querySelector('[data-action=generate]').addEventListener('click', () => { pattern = generate(); paint(); });
    root.querySelector('[data-action=clear]').addEventListener('click', () => { pattern = pattern.map((r) => new Uint8Array(STEPS)); paint(); });
    tempo.addEventListener('input', () => tempoOut.textContent = tempo.value);

    /* ---- visualiser + playhead ---- */
    let current = -1;
    const wave = new Uint8Array(1024), freq = new Uint8Array(512);
    const loop = Showcase.loop(() => {
      Showcase.fit(canvas, 1);
      const W = canvas.width, H = canvas.height, dpr = W / canvas.clientWidth;
      ctx2d.fillStyle = '#0f1216'; ctx2d.fillRect(0, 0, W, H);
      if (playing) {
        while (queue.length && queue[0].time <= ac.currentTime) current = queue.shift().step;
        for (let s = 0; s < STEPS; s++) for (let r = 0; r < ROWS; r++) cells[r * STEPS + s].classList.toggle('now', s === current);
        analyser.getByteFrequencyData(freq);
        const bars = 64, bw = W / bars;
        for (let i = 0; i < bars; i++) { const v = freq[(i * 2.5) | 0] / 255; ctx2d.fillStyle = `rgba(95,211,230,${0.12 + v * 0.35})`; ctx2d.fillRect(i * bw + 1, H - v * H * 0.9, bw - 2, v * H * 0.9); }
        analyser.getByteTimeDomainData(wave);
        ctx2d.strokeStyle = '#e0a458'; ctx2d.lineWidth = 1.5 * dpr; ctx2d.beginPath();
        for (let i = 0; i < wave.length; i++) { const x = i / wave.length * W, y = H / 2 + (wave[i] - 128) / 128 * H * 0.45; i ? ctx2d.lineTo(x, y) : ctx2d.moveTo(x, y); }
        ctx2d.stroke();
      } else {
        ctx2d.strokeStyle = 'rgba(233,228,216,0.18)'; ctx2d.lineWidth = 1 * dpr; ctx2d.beginPath(); ctx2d.moveTo(0, H / 2); ctx2d.lineTo(W, H / 2); ctx2d.stroke();
      }
    });
    return { start: loop.start, stop: loop.stop }; // scrolling away keeps the music going; only the scope sleeps
  });
})();
