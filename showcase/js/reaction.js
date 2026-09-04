/* reaction.js — Gray-Scott reaction-diffusion on the GPU.
   Two virtual chemicals, A and B, diffuse across a float texture and react:
   A + 2B → 3B. A is fed in at rate F; B is removed at rate K. Vary F and K
   by a few thousandths and the same equation grows coral, cells that divide,
   or worms. Each frame runs the update twelve times by ping-ponging between
   two framebuffers. Paint with the pointer to add chemical B. */
(function () {
  'use strict';
  const SIM = `#version 300 es
  precision highp float;
  uniform sampler2D uState; uniform vec2 uTexel; uniform vec2 uMouse; uniform float uBrush; uniform float uF; uniform float uK; uniform float uAspect;
  in vec2 uv; out vec4 o;
  void main(){
    vec2 c = texture(uState, uv).rg;
    vec2 lap = -c
      + 0.20 * (texture(uState, uv + vec2(uTexel.x, 0)).rg + texture(uState, uv - vec2(uTexel.x, 0)).rg
              + texture(uState, uv + vec2(0, uTexel.y)).rg + texture(uState, uv - vec2(0, uTexel.y)).rg)
      + 0.05 * (texture(uState, uv + uTexel).rg + texture(uState, uv - uTexel).rg
              + texture(uState, uv + vec2(uTexel.x, -uTexel.y)).rg + texture(uState, uv - vec2(uTexel.x, -uTexel.y)).rg);
    float a = c.r, b = c.g, abb = a*b*b;
    a += 1.0*lap.x - abb + uF*(1.0 - a);
    b += 0.5*lap.y + abb - (uF + uK)*b;
    if (uBrush > 0.0) {
      float d = distance(vec2(uv.x*uAspect, uv.y), vec2(uMouse.x*uAspect, uMouse.y));
      b = mix(b, 0.9, smoothstep(0.03, 0.0, d));
    }
    o = vec4(clamp(a, 0.0, 1.0), clamp(b, 0.0, 1.0), 0.0, 1.0);
  }`;
  const SEED = `#version 300 es
  precision highp float; uniform float uSeed; in vec2 uv; out vec4 o;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
  void main(){
    float b = 0.0;
    for (int i = 0; i < 18; i++) { vec2 c = vec2(hash(vec2(float(i), 1.0)), hash(vec2(2.0, float(i)))); b += smoothstep(0.035, 0.0, distance(uv, c)); }
    o = vec4(1.0, clamp(b, 0.0, 1.0), 0.0, 1.0);
  }`;
  const SHOW = `#version 300 es
  precision highp float; uniform sampler2D uState; uniform vec2 uTexel; in vec2 uv; out vec4 o;
  void main(){
    float b = texture(uState, uv).g;
    float bx = texture(uState, uv + vec2(uTexel.x, 0)).g - b;   // cheap emboss lighting
    float by = texture(uState, uv + vec2(0, uTexel.y)).g - b;
    vec3 ink = vec3(0.055, 0.07, 0.09);
    vec3 mid = vec3(0.16, 0.42, 0.55);
    vec3 hi  = vec3(0.88, 0.64, 0.35);
    float v = smoothstep(0.08, 0.42, b);
    vec3 col = mix(ink, mid, v);
    col = mix(col, hi, smoothstep(0.30, 0.55, b));
    col += (bx*1.5 - by*1.5) * 1.2;
    o = vec4(col, 1.0);
  }`;
  const PRESETS = { coral: [0.0545, 0.062], mitosis: [0.0367, 0.0649], worms: [0.058, 0.065], holes: [0.039, 0.058] };

  Showcase.register('reaction', (root) => {
    const canvas = root.querySelector('canvas');
    const gl = GL.context(canvas);
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('float framebuffers unsupported');
    const sim = GL.program(gl, SIM), seed = GL.program(gl, SEED), show = GL.program(gl, SHOW);
    const screen = GL.screen(gl);
    const W = 420; let H = 236, targets = null;
    let preset = PRESETS.coral;
    const mouse = { x: 0, y: 0, down: false };

    const build = () => {
      Showcase.fit(canvas, 1);
      H = Math.max(64, Math.round(W * canvas.height / canvas.width));
      targets = [GL.target(gl, W, H), GL.target(gl, W, H)];
      reseed();
    };
    const reseed = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[0].fb); gl.viewport(0, 0, W, H);
      seed.use(); gl.uniform1f(seed.u.uSeed, Math.random() * 100); screen.draw();
      simulate(400); // a few seconds of growth, so the dish is never empty on arrival
    };
    const simulate = (steps) => {
      sim.use();
      gl.uniform2f(sim.u.uTexel, 1 / W, 1 / H);
      gl.uniform1f(sim.u.uF, preset[0]); gl.uniform1f(sim.u.uK, preset[1]);
      gl.uniform1f(sim.u.uAspect, W / H);
      gl.uniform2f(sim.u.uMouse, mouse.x, mouse.y); gl.uniform1f(sim.u.uBrush, mouse.down ? 1 : 0);
      gl.viewport(0, 0, W, H);
      for (let i = 0; i < steps; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[1].fb);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, targets[0].tex);
        gl.uniform1i(sim.u.uState, 0);
        screen.draw();
        targets.reverse();
      }
    };
    Showcase.pointer(canvas, (p) => { mouse.x = p.x; mouse.y = 1 - p.y; }, (p) => { mouse.down = true; mouse.x = p.x; mouse.y = 1 - p.y; }, () => { mouse.down = false; });
    root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      preset = PRESETS[b.dataset.preset];
      root.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    root.querySelector('[data-action=reseed]').addEventListener('click', reseed);
    build();

    return Showcase.loop(() => {
      if (Showcase.fit(canvas, 1)) build();
      simulate(16);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      show.use(); gl.bindTexture(gl.TEXTURE_2D, targets[0].tex); gl.uniform1i(show.u.uState, 0); gl.uniform2f(show.u.uTexel, 1 / W, 1 / H);
      screen.draw();
    });
  });
})();
