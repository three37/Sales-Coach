/* core.js — exhibit lifecycle, navigation, view-source, live stats.
   Every machine on this page registers here. An IntersectionObserver starts a
   machine when it scrolls into view and stops it when it leaves, so the page
   only ever spends GPU/CPU on what you are actually looking at. */
(function () {
  'use strict';

  const Showcase = {
    lib: {},            // pure logic exposed for tests (lisp, othello, maze…)
    machines: new Map(),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,

    /* factory(root) → { start(), stop(), destroy?() } */
    register(id, factory) {
      const root = document.getElementById(id);
      if (!root) return;
      const stage = root.querySelector('.stage');
      let api = null;
      let failed = false;
      const boot = () => {
        if (api || failed) return;
        try { api = factory(root); }
        catch (err) {
          failed = true;
          console.error(`[${id}]`, err);
          Showcase.fail(root, err.message || String(err));
        }
      };
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { boot(); api && api.start(); root.classList.add('live'); }
          else { api && api.stop(); root.classList.remove('live'); }
        }
      }, { threshold: 0.08 });
      io.observe(stage || root);
      this.machines.set(id, { root, get api() { return api; } });
    },

    fail(root, message) {
      const stage = root.querySelector('.stage');
      if (!stage) return;
      const note = document.createElement('div');
      note.className = 'stage-fail';
      note.textContent = `This machine could not start here: ${message}`;
      stage.appendChild(note);
    },

    /* A requestAnimationFrame loop that is safe to start/stop repeatedly. */
    loop(fn) {
      let raf = 0, last = 0, running = false;
      const tick = (now) => {
        if (!running) return;
        const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
        last = now;
        fn(now / 1000, dt);
        raf = requestAnimationFrame(tick);
      };
      return {
        start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(tick); },
        stop() { running = false; cancelAnimationFrame(raf); },
        get running() { return running; }
      };
    },

    /* Size a canvas to its CSS box × device pixel ratio (optionally scaled down). */
    fit(canvas, scale = 1) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
      return false;
    },

    /* Pointer position in canvas pixel coordinates (or normalised 0–1). */
    pointer(canvas, onMove, onDown, onUp) {
      const pos = (ev) => {
        const r = canvas.getBoundingClientRect();
        return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height, px: (ev.clientX - r.left) * canvas.width / r.width, py: (ev.clientY - r.top) * canvas.height / r.height };
      };
      canvas.addEventListener('pointermove', (ev) => onMove && onMove(pos(ev), ev));
      canvas.addEventListener('pointerdown', (ev) => { canvas.setPointerCapture(ev.pointerId); onDown && onDown(pos(ev), ev); });
      canvas.addEventListener('pointerup', (ev) => onUp && onUp(pos(ev), ev));
      canvas.addEventListener('pointercancel', (ev) => onUp && onUp(pos(ev), ev));
      canvas.addEventListener('pointerleave', (ev) => onUp && onUp(pos(ev), ev));
    },

    rng(seed) { // small deterministic PRNG (mulberry32) for reproducible scenes
      let a = seed >>> 0;
      return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    }
  };
  window.Showcase = Showcase;

  /* ---------- source viewer ---------- */
  const sourceOf = async (id) => {
    const script = document.querySelector(`script[data-machine="${id}"]`);
    if (!script) return '// source not found';
    if (script.src) { try { return await (await fetch(script.src)).text(); } catch { return script.textContent; } }
    return script.textContent.replace(/^\n/, '');
  };

  const KEYWORDS = new Set('const let var function return if else for while do break continue new class extends this typeof instanceof of in switch case default try catch finally throw async await yield null undefined true false void delete'.split(' '));
  const highlight = (src) => {
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    let out = '';
    const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|\b(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|\b([A-Za-z_$][\w$]*)\b|([\s\S])/g;
    let m;
    while ((m = re.exec(src))) {
      if (m[1]) out += `<i class="c">${esc(m[1])}</i>`;
      else if (m[2]) out += `<i class="s">${esc(m[2])}</i>`;
      else if (m[3]) out += `<i class="n">${m[3]}</i>`;
      else if (m[4]) out += KEYWORDS.has(m[4]) ? `<i class="k">${m[4]}</i>` : esc(m[4]);
      else out += esc(m[5]);
    }
    return out;
  };

  const modal = document.getElementById('source-modal');
  const openSource = async (id, title) => {
    modal.querySelector('.modal-title').textContent = title;
    const code = modal.querySelector('code');
    code.textContent = 'loading…';
    modal.showModal();
    const src = await sourceOf(id);
    code.innerHTML = highlight(src);
    modal.querySelector('.modal-meta').textContent = `${src.split('\n').length} lines · ${(new Blob([src]).size / 1024).toFixed(1)} KB`;
  };
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-source]');
    if (btn) openSource(btn.dataset.source, btn.dataset.title || btn.dataset.source);
    if (ev.target.matches('[data-close]') || ev.target === modal) modal.close();
  });

  /* ---------- navigation + progress ---------- */
  const nav = document.querySelector('.nav');
  const links = [...document.querySelectorAll('.nav-links a')];
  const sections = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const navIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    }
  }, { rootMargin: '-40% 0px -55% 0px' });
  sections.forEach((s) => navIO.observe(s));
  const progress = document.querySelector('.progress');
  addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
    nav.classList.toggle('scrolled', scrollY > 40);
  }, { passive: true });

  /* ---------- reveal on scroll (from a visible resting state) ---------- */
  if (!Showcase.reducedMotion) {
    const revealIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); } });
    }, { threshold: 0.15 });
    document.querySelectorAll('.reveal').forEach((el) => revealIO.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
  }

  /* ---------- live stats: this page measuring itself ---------- */
  const measure = async () => {
    const scripts = [...document.querySelectorAll('script[data-machine], script[data-core]')];
    const styles = [...document.querySelectorAll('style[data-core], link[rel=stylesheet][href$=".css"]')];
    let lines = 0, bytes = 0;
    const count = (txt) => { lines += txt.split('\n').length; bytes += new Blob([txt]).size; };
    for (const s of scripts) count(s.src ? await fetch(s.src).then((r) => r.text()).catch(() => '') : s.textContent);
    for (const s of styles) count(s.href ? await fetch(s.href).then((r) => r.text()).catch(() => '') : s.textContent);
    count(document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ''));
    const set = (k, v) => document.querySelectorAll(`[data-stat="${k}"]`).forEach((el) => el.textContent = v);
    set('lines', lines.toLocaleString());
    set('kb', (bytes / 1024).toFixed(0));
    set('machines', document.querySelectorAll('.machine').length);
  };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', measure) : measure();
})();
