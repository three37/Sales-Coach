/* othello.js — a Reversi engine: alpha-beta negamax with iterative deepening.
   The engine searches as deep as it can inside a fixed time budget, ordering
   moves by a positional table so the best lines are tried first and more of
   the tree can be cut. Evaluation weighs corners, edges, mobility and,
   near the end, the actual disc count. It reports how far it looked and how
   many positions it examined, so you can see the thinking, not just the move. */
(function () {
  'use strict';
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const W = [
    120, -20, 20, 5, 5, 20, -20, 120,
    -20, -40, -5, -5, -5, -5, -40, -20,
    20, -5, 15, 3, 3, 15, -5, 20,
    5, -5, 3, 3, 3, 3, -5, 5,
    5, -5, 3, 3, 3, 3, -5, 5,
    20, -5, 15, 3, 3, 15, -5, 20,
    -20, -40, -5, -5, -5, -5, -40, -20,
    120, -20, 20, 5, 5, 20, -20, 120];
  const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  const initial = () => { const b = new Uint8Array(64); b[27] = WHITE; b[28] = BLACK; b[35] = BLACK; b[36] = WHITE; return b; };
  const flips = (b, i, p) => {
    if (b[i] !== EMPTY) return [];
    const r0 = i >> 3, c0 = i & 7, out = [];
    for (const [dr, dc] of DIRS) {
      let r = r0 + dr, c = c0 + dc, n = 0;
      while (r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === 3 - p) { r += dr; c += dc; n++; }
      if (n && r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === p) for (let k = 1; k <= n; k++) out.push((r0 + dr * k) * 8 + c0 + dc * k);
    }
    return out;
  };
  const moves = (b, p) => { const out = []; for (let i = 0; i < 64; i++) { if (b[i] !== EMPTY) continue; const f = flips(b, i, p); if (f.length) out.push({ i, f }); } return out; };
  const play = (b, m, p) => { const n = new Uint8Array(b); n[m.i] = p; for (const i of m.f) n[i] = p; return n; };
  const count = (b) => { let black = 0, white = 0, empty = 0; for (let i = 0; i < 64; i++) b[i] === BLACK ? black++ : b[i] === WHITE ? white++ : empty++; return { black, white, empty }; };

  const evaluate = (b, p) => {
    const o = 3 - p, c = count(b);
    let pos = 0;
    for (let i = 0; i < 64; i++) if (b[i] === p) pos += W[i]; else if (b[i] === o) pos -= W[i];
    const mine = moves(b, p).length, theirs = moves(b, o).length;
    const discs = (p === BLACK ? c.black - c.white : c.white - c.black);
    const mobility = 9 * (mine - theirs);
    const endgame = c.empty <= 12 ? discs * (14 - c.empty) : 0;
    return pos + mobility + endgame;
  };
  const terminal = (b, p) => { const c = count(b); const d = p === BLACK ? c.black - c.white : c.white - c.black; return d > 0 ? 100000 + d : d < 0 ? -100000 + d : 0; };

  class Timeout extends Error {}
  let nodes = 0, deadline = 0;
  const negamax = (b, p, depth, alpha, beta, passed) => {
    if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Timeout();
    const ms = moves(b, p);
    if (!ms.length) { if (passed) return terminal(b, p); return -negamax(b, 3 - p, depth, -beta, -alpha, true); }
    if (depth === 0) return evaluate(b, p);
    ms.sort((x, y) => W[y.i] - W[x.i]);
    let best = -Infinity;
    for (const m of ms) {
      const v = -negamax(play(b, m, p), 3 - p, depth - 1, -beta, -alpha, false);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  };
  /* think(board, player, budgetMs) → { move, depth, nodes, ms, score } */
  const think = (b, p, budgetMs = 450) => {
    const t0 = performance.now(); deadline = t0 + budgetMs; nodes = 0;
    const ms = moves(b, p); if (!ms.length) return null;
    ms.sort((x, y) => W[y.i] - W[x.i]);
    let best = ms[0], bestScore = 0, depthDone = 0;
    for (let depth = 1; depth <= 14; depth++) {
      try {
        let alpha = -Infinity, cur = null, curScore = -Infinity;
        for (const m of ms) {
          const v = -negamax(play(b, m, p), 3 - p, depth - 1, -Infinity, -alpha, false);
          if (v > curScore) { curScore = v; cur = m; }
          if (v > alpha) alpha = v;
        }
        best = cur; bestScore = curScore; depthDone = depth;
        ms.splice(ms.indexOf(cur), 1); ms.unshift(cur); // try last depth's favourite first
        if (Math.abs(curScore) > 90000) break; // forced result found
      } catch (e) { if (!(e instanceof Timeout)) throw e; break; }
    }
    return { move: best, depth: depthDone, nodes, ms: performance.now() - t0, score: bestScore };
  };
  Showcase.lib.othello = { initial, flips, moves, play, count, evaluate, think, BLACK, WHITE };

  /* ---- board UI ---- */
  Showcase.register('othello', (root) => {
    const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
    const status = root.querySelector('[data-status]'), thought = root.querySelector('[data-thought]');
    let board = initial(), human = BLACK, turn = BLACK, over = false, hover = -1, last = -1, busy = false;
    const flipAt = new Float64Array(64); // animation start time per square

    const legal = () => moves(board, turn);
    const announce = () => {
      const c = count(board);
      const who = turn === human ? 'Your move' : 'Engine thinking…';
      status.textContent = over
        ? (c.black === c.white ? `Draw, ${c.black} – ${c.white}` : `${(c.black > c.white) === (human === BLACK) ? 'You win' : 'Engine wins'}, ${human === BLACK ? c.black : c.white} – ${human === BLACK ? c.white : c.black}`)
        : `${who} · you ${human === BLACK ? c.black : c.white}, engine ${human === BLACK ? c.white : c.black}`;
    };
    const advance = () => {
      turn = 3 - turn;
      if (!legal().length) {
        turn = 3 - turn;
        if (!legal().length) { over = true; }
        else if (turn !== human) status.textContent = 'You have no legal move: the engine plays again';
      }
      announce();
      if (!over && turn !== human) setTimeout(engineMove, 380);
    };
    const engineMove = () => {
      busy = true;
      const res = think(board, turn, 450);
      busy = false;
      if (!res) { advance(); return; }
      const now = performance.now();
      res.move.f.forEach((i) => flipAt[i] = now); flipAt[res.move.i] = now;
      board = play(board, res.move, turn); last = res.move.i;
      thought.textContent = `Looked ${res.depth} plies ahead · ${res.nodes.toLocaleString()} positions in ${res.ms.toFixed(0)} ms · eval ${res.score > 0 ? '+' : ''}${res.score > 90000 ? 'winning' : res.score < -90000 ? 'losing' : res.score}`;
      advance();
    };
    const reset = (asWhite) => {
      board = initial(); human = asWhite ? WHITE : BLACK; turn = BLACK; over = false; last = -1; flipAt.fill(0); thought.textContent = '';
      announce();
      if (turn !== human) setTimeout(engineMove, 300);
    };
    const cellAt = (p) => { const c = Math.floor(p.x * 8), r = Math.floor(p.y * 8); return c >= 0 && c < 8 && r >= 0 && r < 8 ? r * 8 + c : -1; };
    Showcase.pointer(canvas, (p) => { hover = cellAt(p); }, null, () => { });
    canvas.addEventListener('click', (ev) => {
      if (over || busy || turn !== human) return;
      const r = canvas.getBoundingClientRect();
      const i = cellAt({ x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height });
      const m = legal().find((m) => m.i === i);
      if (!m) return;
      const now = performance.now(); m.f.forEach((k) => flipAt[k] = now); flipAt[i] = now;
      board = play(board, m, human); last = i;
      advance();
    });
    root.querySelector('[data-action=new]').addEventListener('click', () => reset(false));
    root.querySelector('[data-action=white]').addEventListener('click', () => reset(true));
    announce();

    const draw = () => {
      Showcase.fit(canvas, 1);
      const S = Math.min(canvas.width, canvas.height), cell = S / 8, ox = (canvas.width - S) / 2, oy = (canvas.height - S) / 2;
      const dpr = canvas.width / canvas.clientWidth, now = performance.now();
      ctx.fillStyle = '#0f1216'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1b3a35'; ctx.fillRect(ox, oy, S, S);
      ctx.strokeStyle = 'rgba(15,18,22,0.9)'; ctx.lineWidth = 1 * dpr;
      for (let k = 0; k <= 8; k++) { ctx.beginPath(); ctx.moveTo(ox + k * cell, oy); ctx.lineTo(ox + k * cell, oy + S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(ox, oy + k * cell); ctx.lineTo(ox + S, oy + k * cell); ctx.stroke(); }
      const hints = !over && turn === human ? legal() : [];
      for (let i = 0; i < 64; i++) {
        const x = ox + (i & 7) * cell + cell / 2, y = oy + (i >> 3) * cell + cell / 2;
        if (i === last) { ctx.fillStyle = 'rgba(224,164,88,0.25)'; ctx.fillRect(x - cell / 2, y - cell / 2, cell, cell); }
        if (board[i]) {
          const age = Math.min(1, (now - flipAt[i]) / 320);
          const squash = flipAt[i] ? Math.abs(Math.cos(age * Math.PI)) : 1; // flip: shrink then grow
          const showColor = age < 0.5 && flipAt[i] ? 3 - board[i] : board[i];
          ctx.fillStyle = showColor === BLACK ? '#14171c' : '#e9e4d8';
          ctx.beginPath(); ctx.ellipse(x, y, cell * 0.4 * squash, cell * 0.4, 0, 0, 7); ctx.fill();
          ctx.strokeStyle = showColor === BLACK ? 'rgba(233,228,216,0.25)' : 'rgba(0,0,0,0.25)'; ctx.stroke();
        } else if (hints.some((m) => m.i === i)) {
          ctx.fillStyle = i === hover ? 'rgba(224,164,88,0.9)' : 'rgba(233,228,216,0.28)';
          ctx.beginPath(); ctx.arc(x, y, cell * (i === hover ? 0.14 : 0.08), 0, 7); ctx.fill();
        }
      }
    };
    return Showcase.loop(draw);
  });
})();
