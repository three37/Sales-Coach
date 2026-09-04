/* fractal.js — Mandelbrot & Julia sets, rendered per pixel on the GPU.
   z ← z² + c, iterated until it escapes. The colour is the smoothed
   iteration count. Scroll to zoom toward the cursor, drag to pan, and in
   Julia mode the pointer chooses the constant c, so the whole set morphs
   as you move. Float precision runs out around 100 000× magnification;
   it is a genuine limit of 32-bit numbers, and the page is honest about it. */
(function () {
  'use strict';
  const FS = `#version 300 es
  precision highp float;
  uniform vec2 uRes; uniform vec2 uCenter; uniform float uScale; uniform vec2 uC; uniform int uJulia; uniform float uTime;
  out vec4 o;
  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;
    vec2 pt = uCenter + uv * uScale;
    vec2 z = uJulia == 1 ? pt : vec2(0.0);
    vec2 c = uJulia == 1 ? uC : pt;
    float n = 0.0; bool esc = false;
    for (int i = 0; i < 400; i++) {
      z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
      if (dot(z, z) > 256.0) { esc = true; break; }
      n += 1.0;
    }
    vec3 col = vec3(0.04, 0.05, 0.07);
    if (esc) {
      float sn = n - log2(log2(dot(z, z))) + 4.0;
      float band = 0.5 + 0.5*sin(sn*0.35 - uTime*0.4);          // slow-breathing contour bands
      float depth = 1.0 - exp(-sn * 0.045);                      // 0 far away → 1 at the boundary
      vec3 teal  = vec3(0.09, 0.30, 0.38);
      vec3 cyan  = vec3(0.37, 0.83, 0.90);
      vec3 brass = vec3(0.88, 0.64, 0.35);
      vec3 paper = vec3(0.91, 0.89, 0.85);
      col = mix(teal, cyan, band);
      col = mix(col, brass, smoothstep(0.55, 1.0, depth) * pow(band, 2.0));
      col = mix(col, paper, smoothstep(0.90, 1.0, depth) * band * 0.6);
      col = mix(vec3(0.06, 0.07, 0.09), col, smoothstep(0.0, 0.35, depth));
    }
    o = vec4(col, 1.0);
  }`;

  Showcase.register('fractal', (root) => {
    const canvas = root.querySelector('canvas');
    const gl = GL.context(canvas);
    const prog = GL.program(gl, FS).use();
    const screen = GL.screen(gl);
    const view = { cx: -0.55, cy: 0.0, scale: 2.6, julia: false, c: [-0.8, 0.156] };
    const readout = root.querySelector('[data-readout]');
    let drag = null;

    const toPlane = (p) => { // pointer (0–1) → complex plane
      const asp = canvas.width / canvas.height;
      return [view.cx + (p.x - 0.5) * asp * view.scale, view.cy + (0.5 - p.y) * view.scale];
    };
    Showcase.pointer(canvas,
      (p, ev) => {
        if (drag) { const asp = canvas.width / canvas.height; view.cx = drag.cx - (p.x - drag.x) * asp * view.scale; view.cy = drag.cy + (p.y - drag.y) * view.scale; }
        else if (view.julia) view.c = toPlane(p);
      },
      (p) => { drag = { x: p.x, y: p.y, cx: view.cx, cy: view.cy }; },
      () => { drag = null; });
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      const p = { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
      const before = toPlane(p);
      view.scale *= Math.exp(ev.deltaY * 0.0015);
      view.scale = Math.min(4, Math.max(2e-5, view.scale));
      const after = toPlane(p);
      view.cx += before[0] - after[0]; view.cy += before[1] - after[1];
    }, { passive: false });
    canvas.addEventListener('dblclick', (ev) => {
      const r = canvas.getBoundingClientRect();
      [view.cx, view.cy] = toPlane({ x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height });
      view.scale *= 0.35;
    });
    root.querySelector('[data-action=julia]').addEventListener('click', (ev) => {
      view.julia = !view.julia; ev.currentTarget.classList.toggle('on', view.julia);
      view.cx = view.julia ? 0 : -0.55; view.cy = 0; view.scale = view.julia ? 3.2 : 2.6;
    });
    root.querySelector('[data-action=reset]').addEventListener('click', () => { view.cx = view.julia ? 0 : -0.55; view.cy = 0; view.scale = view.julia ? 3.2 : 2.6; });

    return Showcase.loop((t) => {
      Showcase.fit(canvas, 1);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(prog.u.uRes, canvas.width, canvas.height);
      gl.uniform2f(prog.u.uCenter, view.cx, view.cy);
      gl.uniform1f(prog.u.uScale, view.scale);
      gl.uniform2f(prog.u.uC, view.c[0], view.c[1]);
      gl.uniform1i(prog.u.uJulia, view.julia ? 1 : 0);
      gl.uniform1f(prog.u.uTime, t);
      screen.draw();
      const mag = (2.6 / view.scale);
      readout.textContent = view.julia
        ? `c = ${view.c[0].toFixed(4)} ${view.c[1] < 0 ? '−' : '+'} ${Math.abs(view.c[1]).toFixed(4)}i`
        : `centre ${view.cx < 0 ? '−' : ''}${Math.abs(view.cx).toFixed(6)} ${view.cy < 0 ? '−' : '+'} ${Math.abs(view.cy).toFixed(6)}i · ${mag >= 1000 ? mag.toExponential(1) : mag.toFixed(1)}×`;
    });
  });
})();
