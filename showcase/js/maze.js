/* maze.js — a perfect maze carved by depth-first search, solved live by A*.
   Toggle the heuristic weight to watch the algorithm change character:
   weight 0 is Dijkstra (thorough, blind), 1 is textbook A* (optimal, guided),
   and 3 is greedy best-first (fast, may take a worse route). The count of
   cells expanded is the honest measure of how much each one had to think. */
(function () {
  'use strict';
  class Heap { // binary min-heap on .f
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  }
  /* grid[y][x]: 1 = wall, 0 = open. Cells live at odd coordinates. */
  const carve = (cols, rows, rnd) => {
    const W = cols * 2 + 1, H = rows * 2 + 1;
    const g = Array.from({ length: H }, () => new Uint8Array(W).fill(1));
    const stack = [[1, 1]]; g[1][1] = 0;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const opts = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => nx > 0 && ny > 0 && nx < W && ny < H && g[ny][nx] === 1);
      if (!opts.length) { stack.pop(); continue; }
      const [nx, ny] = opts[(rnd() * opts.length) | 0];
      g[(y + ny) / 2][(x + nx) / 2] = 0; g[ny][nx] = 0;
      stack.push([nx, ny]);
    }
    // a few extra openings so there is more than one route
    for (let i = 0; i < cols * rows * 0.06; i++) { const x = 1 + ((rnd() * (W - 2)) | 0), y = 1 + ((rnd() * (H - 2)) | 0); if ((x + y) % 2 === 1) g[y][x] = 0; }
    return g;
  };
  /* Generator-based A*: yields after every expansion so the UI can animate it. */
  function* astar(g, start, goal, weight) {
    const W = g[0].length, H = g.length, id = (x, y) => y * W + x;
    const h = (x, y) => (Math.abs(x - goal[0]) + Math.abs(y - goal[1])) * weight;
    const gScore = new Float64Array(W * H).fill(Infinity), came = new Int32Array(W * H).fill(-1);
    const closed = new Uint8Array(W * H);
    const open = new Heap();
    gScore[id(...start)] = 0; open.push({ x: start[0], y: start[1], f: h(...start) });
    let expanded = 0;
    while (open.size) {
      const cur = open.pop(); const ci = id(cur.x, cur.y);
      if (closed[ci]) continue; closed[ci] = 1; expanded++;
      if (cur.x === goal[0] && cur.y === goal[1]) {
        const path = []; for (let i = ci; i !== -1; i = came[i]) path.push([i % W, (i / W) | 0]);
        return { path: path.reverse(), expanded, closed };
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || g[ny][nx]) continue;
        const ni = id(nx, ny), ng = gScore[ci] + 1;
        if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = ci; open.push({ x: nx, y: ny, f: ng + h(nx, ny) }); }
      }
      yield { closed, expanded, frontier: open.a };
    }
    return { path: [], expanded, closed };
  }
  Showcase.lib.maze = { carve, astar, Heap };

  Showcase.register('maze', (root) => {
    const canvas = root.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const readout = root.querySelector('[data-readout]');
    let g, cols = 39, rows = 21, weight = 1, run = null, state = null, result = null, seed = 1;

    const newMaze = () => { g = carve(cols, rows, Showcase.rng(seed++)); solve(); };
    const solve = () => {
      const start = [1, 1], goal = [g[0].length - 2, g.length - 2];
      run = astar(g, start, goal, weight); state = null; result = null;
    };
    root.querySelectorAll('[data-weight]').forEach((b) => b.addEventListener('click', () => {
      weight = +b.dataset.weight; root.querySelectorAll('[data-weight]').forEach((x) => x.classList.toggle('on', x === b)); solve();
    }));
    root.querySelector('[data-action=maze]').addEventListener('click', newMaze);
    newMaze();

    const draw = () => {
      Showcase.fit(canvas, 1);
      const W = g[0].length, H = g.length;
      const cell = Math.min(canvas.width / W, canvas.height / H);
      const ox = (canvas.width - cell * W) / 2, oy = (canvas.height - cell * H) / 2;
      ctx.fillStyle = '#0f1216'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#232a34';
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x]) ctx.fillRect(ox + x * cell, oy + y * cell, cell + 0.5, cell + 0.5);
      const closed = (state || result || {}).closed;
      if (closed) { ctx.fillStyle = 'rgba(95,211,230,0.22)'; for (let i = 0; i < closed.length; i++) if (closed[i]) ctx.fillRect(ox + (i % W) * cell, oy + ((i / W) | 0) * cell, cell, cell); }
      if (state) { ctx.fillStyle = 'rgba(95,211,230,0.75)'; for (const n of state.frontier) ctx.fillRect(ox + n.x * cell, oy + n.y * cell, cell, cell); }
      if (result && result.path.length) {
        ctx.strokeStyle = '#e0a458'; ctx.lineWidth = Math.max(2, cell * 0.45); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath(); result.path.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](ox + (x + 0.5) * cell, oy + (y + 0.5) * cell)); ctx.stroke();
      }
      ctx.fillStyle = '#e9e4d8'; ctx.fillRect(ox + cell, oy + cell, cell, cell); ctx.fillRect(ox + (W - 2) * cell, oy + (H - 2) * cell, cell, cell);
    };
    return Showcase.loop(() => {
      if (run) {
        for (let i = 0; i < 6 && run; i++) {
          const r = run.next();
          if (r.done) { result = r.value; run = null; readout.textContent = `${result.expanded} cells expanded · path ${result.path.length - 1} steps · ${weight === 0 ? 'Dijkstra' : weight === 1 ? 'A*' : 'greedy'}`; }
          else { state = r.value; readout.textContent = `${state.expanded} cells expanded…`; }
        }
      }
      draw();
    });
  });
})();
