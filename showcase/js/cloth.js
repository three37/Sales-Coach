/* cloth.js — a tearable cloth with Verlet integration.
   Every point remembers only where it was last frame; velocity is implied.
   Neighbouring points are joined by distance constraints that are relaxed
   a few times per frame, which is what gives the fabric its weight. Pull it
   with the pointer; switch to scissors and cut. Stretched threads glow. */
(function () {
  'use strict';
  Showcase.register('cloth', (root) => {
    const canvas = root.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const COLS = 46, ROWS = 26;
    let pts = [], links = [], spacing = 10, mode = 'drag';
    const mouse = { x: 0, y: 0, px: 0, py: 0, down: false };
    const gravity = 1800;

    const build = () => {
      Showcase.fit(canvas, 1);
      const dpr = canvas.width / canvas.clientWidth;
      spacing = Math.min(canvas.width * 0.8 / (COLS - 1), canvas.height * 0.72 / (ROWS - 1));
      const ox = (canvas.width - spacing * (COLS - 1)) / 2, oy = 24 * dpr;
      pts = []; links = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const x = ox + c * spacing, y = oy + r * spacing;
        pts.push({ x, y, ox: x, oy: y, pin: r === 0 && (c % 5 === 0 || c === COLS - 1) });
      }
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        if (c < COLS - 1) links.push({ a: i, b: i + 1, len: spacing, alive: true });
        if (r < ROWS - 1) links.push({ a: i, b: i + COLS, len: spacing, alive: true });
      }
    };
    Showcase.pointer(canvas,
      (p) => { mouse.x = p.px; mouse.y = p.py; },
      (p) => { mouse.down = true; mouse.x = mouse.px = p.px; mouse.y = mouse.py = p.py; },
      () => { mouse.down = false; });
    root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      root.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
      canvas.style.cursor = mode === 'cut' ? 'crosshair' : 'grab';
    }));
    root.querySelector('[data-action=reset]').addEventListener('click', build);
    build();

    const step = (t, dt) => {
      const dpr = canvas.width / canvas.clientWidth;
      const wind = Math.sin(t * 0.7) * 260 * dpr + Math.sin(t * 2.3) * 90 * dpr;
      const dt2 = dt * dt;
      const grab = 28 * dpr, blade = 14 * dpr;
      for (const p of pts) {
        if (p.pin) continue;
        const vx = (p.x - p.ox) * 0.995, vy = (p.y - p.oy) * 0.995;
        p.ox = p.x; p.oy = p.y;
        p.x += vx + wind * dt2; p.y += vy + gravity * dpr * dt2;
      }
      if (mouse.down) {
        const dx = mouse.x - mouse.px, dy = mouse.y - mouse.py;
        if (mode === 'drag') {
          for (const p of pts) {
            if (p.pin) continue;
            const d = Math.hypot(p.x - mouse.x, p.y - mouse.y);
            if (d < grab) { p.x += dx; p.y += dy; p.ox = p.x - dx * 0.6; p.oy = p.y - dy * 0.6; }
          }
        } else {
          for (const l of links) {
            if (!l.alive) continue;
            const a = pts[l.a], b = pts[l.b];
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            if (Math.hypot(mx - mouse.x, my - mouse.y) < blade) l.alive = false;
          }
        }
        mouse.px = mouse.x; mouse.py = mouse.y;
      }
      for (let k = 0; k < 4; k++) {
        for (const l of links) {
          if (!l.alive) continue;
          const a = pts[l.a], b = pts[l.b];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1e-6;
          const diff = (d - l.len) / d;
          if (d > l.len * 4.5) { l.alive = false; continue; } // tears under extreme strain
          const w = a.pin ? 0 : b.pin ? 1 : 0.5;
          if (!a.pin) { a.x += dx * diff * w; a.y += dy * diff * w; }
          if (!b.pin) { b.x -= dx * diff * (1 - w); b.y -= dy * diff * (1 - w); }
        }
      }
      for (const p of pts) { // keep inside the frame
        if (p.y > canvas.height - 2) { p.y = canvas.height - 2; p.oy = p.y; }
        if (p.x < 2) p.x = 2; else if (p.x > canvas.width - 2) p.x = canvas.width - 2;
      }
    };
    const draw = () => {
      const dpr = canvas.width / canvas.clientWidth;
      ctx.fillStyle = '#0f1216'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 1 * dpr;
      for (const l of links) {
        if (!l.alive) continue;
        const a = pts[l.a], b = pts[l.b];
        const strain = Math.min(1, Math.max(0, (Math.hypot(b.x - a.x, b.y - a.y) / l.len - 1) * 2.2));
        ctx.strokeStyle = strain < 0.05 ? 'rgba(95,211,230,0.45)' : `rgba(${95 + 130 * strain | 0},${211 - 50 * strain | 0},${230 - 150 * strain | 0},${0.45 + 0.55 * strain})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.fillStyle = '#e0a458';
      for (const p of pts) if (p.pin) { ctx.beginPath(); ctx.arc(p.x, p.y, 3 * dpr, 0, 7); ctx.fill(); }
    };
    return Showcase.loop((t, dt) => {
      if (Showcase.fit(canvas, 1)) build();
      step(t, dt / 2); step(t, dt / 2);
      draw();
    });
  });
})();
