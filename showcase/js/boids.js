/* boids.js — Craig Reynolds' flocking, 1986, with a spatial hash.
   Three rules per bird, each looking only at its neighbours: steer apart
   from anyone too close, match the heading of the flock, drift toward its
   centre. None of them knows what a flock is; the flock is what falls out.
   The pointer is a hawk. A grid of buckets keeps neighbour lookups O(n). */
(function () {
  'use strict';
  Showcase.register('boids', (root) => {
    const canvas = root.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const N = 360, R = 60, CELL = R;
    let boids = [], W = 0, H = 0;
    const hawk = { x: -1e4, y: -1e4, on: false };
    const rnd = Showcase.rng(7);

    const reset = () => {
      Showcase.fit(canvas, 1); W = canvas.width; H = canvas.height;
      boids = Array.from({ length: N }, () => { const a = rnd() * 6.283; return { x: rnd() * W, y: rnd() * H, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80 }; });
    };
    Showcase.pointer(canvas, (p) => { hawk.x = p.px; hawk.y = p.py; hawk.on = true; }, null, () => { hawk.on = false; });
    reset();

    const grid = new Map();
    const key = (x, y) => ((x / CELL) | 0) * 4096 + ((y / CELL) | 0);
    const step = (dt) => {
      const dpr = canvas.width / canvas.clientWidth;
      const r = R * dpr, r2 = r * r, sep2 = (22 * dpr) ** 2, maxV = 190 * dpr, maxF = 900 * dpr;
      grid.clear();
      for (const b of boids) { const k = key(b.x, b.y); let cell = grid.get(k); if (!cell) grid.set(k, cell = []); cell.push(b); }
      for (const b of boids) {
        let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, n = 0;
        const gx = (b.x / CELL) | 0, gy = (b.y / CELL) | 0;
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          const cell = grid.get((gx + i) * 4096 + gy + j); if (!cell) continue;
          for (const o of cell) {
            if (o === b) continue;
            const dx = o.x - b.x, dy = o.y - b.y, d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            n++; ax += o.vx; ay += o.vy; cx += o.x; cy += o.y;
            if (d2 < sep2) { const inv = 1 / (d2 + 1); sx -= dx * inv; sy -= dy * inv; }
          }
        }
        let fx = 0, fy = 0;
        if (n) {
          fx += sx * 1400 * dpr + ((ax / n - b.vx) * 3.0) + ((cx / n - b.x) * 2.0);
          fy += sy * 1400 * dpr + ((ay / n - b.vy) * 3.0) + ((cy / n - b.y) * 2.0);
        }
        if (hawk.on) { const dx = b.x - hawk.x, dy = b.y - hawk.y, d2 = dx * dx + dy * dy; if (d2 < (140 * dpr) ** 2) { const d = Math.sqrt(d2) + 1; fx += dx / d * 2400 * dpr; fy += dy / d * 2400 * dpr; } }
        const m = 60 * dpr; // soft walls
        if (b.x < m) fx += (m - b.x) * 12; if (b.x > W - m) fx -= (b.x - W + m) * 12;
        if (b.y < m) fy += (m - b.y) * 12; if (b.y > H - m) fy -= (b.y - H + m) * 12;
        const f = Math.hypot(fx, fy); if (f > maxF) { fx *= maxF / f; fy *= maxF / f; }
        b.vx += fx * dt; b.vy += fy * dt;
        const v = Math.hypot(b.vx, b.vy) || 1;
        const target = Math.min(maxV, Math.max(70 * dpr, v));
        b.vx *= target / v; b.vy *= target / v;
        b.x += b.vx * dt; b.y += b.vy * dt;
      }
    };
    const draw = () => {
      const dpr = canvas.width / canvas.clientWidth;
      ctx.fillStyle = 'rgba(15,18,22,0.55)'; ctx.fillRect(0, 0, W, H); // motion trails
      for (const b of boids) {
        const a = Math.atan2(b.vy, b.vx), s = 5 * dpr;
        const hue = 185 + Math.sin(a) * 25;
        ctx.fillStyle = `hsl(${hue} 70% ${62 + Math.cos(a) * 8}%)`;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(a) * s * 1.8, b.y + Math.sin(a) * s * 1.8);
        ctx.lineTo(b.x + Math.cos(a + 2.5) * s, b.y + Math.sin(a + 2.5) * s);
        ctx.lineTo(b.x + Math.cos(a - 2.5) * s, b.y + Math.sin(a - 2.5) * s);
        ctx.fill();
      }
      if (hawk.on) { ctx.strokeStyle = 'rgba(224,164,88,0.8)'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(hawk.x, hawk.y, 14 * dpr, 0, 7); ctx.stroke(); }
    };
    return Showcase.loop((t, dt) => {
      if (Showcase.fit(canvas, 1)) reset();
      step(dt); draw();
    });
  });
})();
