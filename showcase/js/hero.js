/* hero.js — ray-marched signed distance fields.
   No triangles, no meshes: the whole scene is a single mathematical function
   map(p) that returns the distance from any point to the nearest surface.
   Each pixel marches a ray through that field, then shades what it hits with
   soft shadows, ambient occlusion and a fresnel rim, all in one GLSL pass. */
(function () {
  'use strict';
  const FS = `#version 300 es
  precision highp float;
  uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse;
  out vec4 o;

  float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0-h); }
  float sdSphere(vec3 p, float r){ return length(p) - r; }
  float sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
  mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  float map(vec3 p){
    float t = uTime * 0.55;
    float d = 1e9;
    for (int i = 0; i < 6; i++) {
      float f = float(i);
      vec3 c = vec3(sin(t*0.9 + f*1.7) * 1.3, cos(t*0.7 + f*2.1) * 0.9, sin(t*0.5 + f*1.3) * 1.1);
      d = smin(d, sdSphere(p - c, 0.42 + 0.14*sin(t*1.3 + f)), 0.55);
    }
    vec3 q = p; q.xy *= rot(t*0.35); q.yz *= rot(t*0.27);
    d = smin(d, sdTorus(q, vec2(2.0, 0.16)), 0.35);
    return d;
  }
  vec3 normal(vec3 p){
    vec2 e = vec2(8e-4, 0.0);
    return normalize(vec3(map(p+e.xyy)-map(p-e.xyy), map(p+e.yxy)-map(p-e.yxy), map(p+e.yyx)-map(p-e.yyx)));
  }
  float occlusion(vec3 p, vec3 n){
    float o = 0.0, s = 1.0;
    for (int i = 1; i <= 5; i++) { float h = 0.05 * float(i); o += (h - map(p + n*h)) * s; s *= 0.65; }
    return clamp(1.0 - 2.5*o, 0.0, 1.0);
  }
  float shadow(vec3 ro, vec3 rd){
    float r = 1.0, t = 0.04;
    for (int i = 0; i < 32; i++) {
      float h = map(ro + rd*t);
      r = min(r, 10.0*h/t);
      t += clamp(h, 0.02, 0.25);
      if (h < 1e-3 || t > 8.0) break;
    }
    return clamp(r, 0.0, 1.0);
  }
  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;
    float yaw = uTime*0.12 + (uMouse.x - 0.5) * 1.6;
    float pitch = 0.25 + (uMouse.y - 0.5) * 0.9;
    vec3 ro = vec3(sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch)) * 6.5;
    vec3 f = normalize(-ro), r = normalize(cross(f, vec3(0,1,0))), u = cross(r, f);
    vec3 rd = normalize(f*1.7 + uv.x*r + uv.y*u);

    vec3 bg = mix(vec3(0.055, 0.065, 0.085), vec3(0.020, 0.022, 0.030), clamp(uv.y + 0.6, 0.0, 1.0));
    float t = 0.0; vec3 p; bool hit = false;
    for (int i = 0; i < 96; i++) {
      p = ro + rd*t;
      float d = map(p);
      if (d < 8e-4) { hit = true; break; }
      t += d * 0.9;
      if (t > 24.0) break;
    }
    vec3 col = bg;
    if (hit) {
      vec3 n = normal(p);
      vec3 key = normalize(vec3(0.6, 0.9, 0.35));
      vec3 fill = normalize(vec3(-0.7, 0.2, -0.6));
      float dif = max(dot(n, key), 0.0) * shadow(p + n*0.01, key);
      float dif2 = max(dot(n, fill), 0.0) * 0.35;
      float spec = pow(max(dot(reflect(-key, n), -rd), 0.0), 40.0);
      float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
      float ao = occlusion(p, n);
      // brass base, drifting toward cyan by height
      vec3 brass = vec3(0.88, 0.64, 0.35);
      vec3 cyan  = vec3(0.37, 0.83, 0.90);
      vec3 base = mix(brass, cyan, smoothstep(-1.2, 1.4, p.y + 0.4*sin(uTime*0.4)));
      col = base * (0.10 + dif*0.95 + dif2) * ao + spec*0.7 + fres * vec3(0.55, 0.75, 1.0) * 0.55;
      col = mix(col, bg, 1.0 - exp(-0.012 * t*t));
    }
    col *= 1.0 - 0.35 * dot(uv, uv);
    o = vec4(pow(col, vec3(0.4545)), 1.0);
  }`;

  Showcase.register('hero', (root) => {
    const canvas = root.querySelector('canvas');
    const gl = GL.context(canvas);
    const prog = GL.program(gl, FS).use();
    const screen = GL.screen(gl);
    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    root.addEventListener('pointermove', (ev) => {
      const r = canvas.getBoundingClientRect();
      mouse.tx = (ev.clientX - r.left) / r.width; mouse.ty = 1 - (ev.clientY - r.top) / r.height;
    });
    const scale = Math.min(1, 0.55 / Math.min(window.devicePixelRatio || 1, 2) * 1.6); // ~880px wide render on a laptop
    const loop = Showcase.loop((t) => {
      Showcase.fit(canvas, scale);
      mouse.x += (mouse.tx - mouse.x) * 0.06; mouse.y += (mouse.ty - mouse.y) * 0.06;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(prog.u.uRes, canvas.width, canvas.height);
      gl.uniform1f(prog.u.uTime, t);
      gl.uniform2f(prog.u.uMouse, mouse.x, mouse.y);
      screen.draw();
    });
    return loop;
  });
})();
