/* fourier.js — draw anything; the machine redraws it with spinning circles.
   A closed path is a sequence of complex numbers. The discrete Fourier
   transform splits it into rotating vectors, each with its own radius,
   speed and phase. Chain them tip to tail and the last tip retraces your
   drawing. The slider chooses how many terms to keep: a handful gives a
   ghost of the shape, all of them gives the shape exactly. */
(function () {
  'use strict';
  const N = 240;
  const dft = (pts) => { // pts: [{x,y}] → [{re, im, freq, amp, phase}] sorted by amplitude
    const out = [];
    for (let k = 0; k < N; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) { const a = -2 * Math.PI * k * n / N; re += pts[n].x * Math.cos(a) - pts[n].y * Math.sin(a); im += pts[n].x * Math.sin(a) + pts[n].y * Math.cos(a); }
      re /= N; im /= N;
      const freq = k <= N / 2 ? k : k - N; // negative frequencies spin the other way
      out.push({ re, im, freq, amp: Math.hypot(re, im), phase: Math.atan2(im, re) });
    }
    return out.sort((a, b) => b.amp - a.amp);
  };
  /* resample a hand-drawn polyline to N points, evenly spaced along its length, centred */
  const resample = (raw) => {
    const pts = raw.length > 2 ? [...raw, raw[0]] : raw;
    let total = 0; const seg = [0];
    for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(total); }
    const out = []; let j = 1;
    for (let i = 0; i < N; i++) {
      const d = total * i / N;
      while (j < seg.length - 1 && seg[j] < d) j++;
      const t = (d - seg[j - 1]) / ((seg[j] - seg[j - 1]) || 1);
      out.push({ x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * t, y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * t });
    }
    const cx = out.reduce((s, p) => s + p.x, 0) / N, cy = out.reduce((s, p) => s + p.y, 0) / N;
    return out.map((p) => ({ x: p.x - cx, y: p.y - cy }));
  };
  const heart = (scale) => Array.from({ length: N }, (_, i) => { const t = i / N * 2 * Math.PI; return { x: 16 * Math.sin(t) ** 3 * scale, y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * scale }; });
  Showcase.lib.fourier = { dft, resample, N };

  Showcase.register('fourier', (root) => {
    const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
    const slider = root.querySelector('[data-terms]'), termsOut = root.querySelector('[data-terms-out]');
    let shape = null, coeffs = null, drawing = null, time = 0, trace = [];
    const setShape = (pts) => { shape = pts; coeffs = dft(pts); trace = []; time = 0; };
    const useHeart = () => { Showcase.fit(canvas, 1); setShape(heart(canvas.height / 42)); };
    Showcase.pointer(canvas,
      (p) => { if (drawing) { const c = { x: p.px - canvas.width / 2, y: p.py - canvas.height / 2 }; const l = drawing[drawing.length - 1]; if (Math.hypot(c.x - l.x, c.y - l.y) > 2) drawing.push(c); } },
      (p) => { drawing = [{ x: p.px - canvas.width / 2, y: p.py - canvas.height / 2 }]; },
      () => { if (drawing && drawing.length > 8) setShape(resample(drawing)); drawing = null; });
    slider.addEventListener('input', () => { termsOut.textContent = slider.value; trace = []; });
    root.querySelector('[data-action=heart]').addEventListener('click', useHeart);
    useHeart();

    return Showcase.loop((t, dt) => {
      if (Showcase.fit(canvas, 1)) useHeart();
      const W = canvas.width, H = canvas.height, dpr = W / canvas.clientWidth;
      const terms = Math.min(+slider.value, N);
      ctx.fillStyle = '#0f1216'; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(W / 2, H / 2);
      if (drawing) { // live pen
        ctx.strokeStyle = '#e9e4d8'; ctx.lineWidth = 2 * dpr; ctx.beginPath(); drawing.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y)); ctx.stroke();
        ctx.restore(); return;
      }
      // the target, faint
      ctx.strokeStyle = 'rgba(233,228,216,0.12)'; ctx.lineWidth = 1 * dpr; ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.beginPath(); shape.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y)); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      // epicycles
      let x = 0, y = 0;
      for (let k = 0; k < terms; k++) {
        const c = coeffs[k], px = x, py = y;
        const ang = c.freq * time + c.phase;
        x += c.amp * Math.cos(ang); y += c.amp * Math.sin(ang);
        if (c.amp > 1.5 * dpr) {
          ctx.strokeStyle = 'rgba(95,211,230,0.28)'; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.arc(px, py, c.amp, 0, 7); ctx.stroke();
          ctx.strokeStyle = 'rgba(95,211,230,0.7)'; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
        }
      }
      trace.push({ x, y }); if (trace.length > N * 1.05) trace.shift();
      ctx.strokeStyle = '#e0a458'; ctx.lineWidth = 2.2 * dpr; ctx.lineJoin = 'round'; ctx.beginPath(); trace.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y)); ctx.stroke();
      ctx.fillStyle = '#f0c078'; ctx.beginPath(); ctx.arc(x, y, 3.5 * dpr, 0, 7); ctx.fill();
      ctx.restore();
      time += (2 * Math.PI / N) * Math.max(1, dt * 60) * 0.9;
    });
  });
})();
