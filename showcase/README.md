# Ex Nihilo

Ten interactive machines, computed live in the browser with no libraries, no
frameworks and no images. Built as a showcase of what can be written from
scratch in a single session.

| Machine | What it is | Where |
| --- | --- | --- |
| Field | Ray-marched signed distance fields with soft shadows and ambient occlusion (GLSL) | `js/hero.js` |
| Reaction | Gray–Scott reaction-diffusion on float framebuffers, paintable | `js/reaction.js` |
| Fractal | Mandelbrot and Julia explorer with smooth colouring | `js/fractal.js` |
| Cloth | Tearable Verlet cloth with constraint relaxation | `js/cloth.js` |
| Flock | Reynolds boids with a spatial hash and a pointer-driven predator | `js/boids.js` |
| Epicycles | Draw a shape; a discrete Fourier transform redraws it with spinning circles | `js/fourier.js` |
| Maze | Depth-first maze carving solved live by A*, Dijkstra or greedy search | `js/maze.js` |
| Othello | Reversi engine: negamax, alpha–beta pruning, iterative deepening on a time budget | `js/othello.js` |
| Lisp | A Scheme-flavoured interpreter with closures and proper tail calls, plus a REPL | `js/lisp.js` |
| Synth | Subtractive synthesizer and drum machine with a look-ahead step sequencer (Web Audio) | `js/synth.js` |

`js/core.js` runs the page: each machine starts when it scrolls into view and
stops when it leaves, every bench can open its own source, and the page
measures its own size on load.

## Running it

Open `index.html` through any static server (the source viewer and the live
line count fetch the script files, which `file://` blocks in most browsers):

```sh
python3 -m http.server 8000
# then visit http://localhost:8000/
```

## Single-file build

```sh
node build.mjs             # dist/index.html, everything inlined
node build.mjs --fragment  # dist/fragment.html, no document wrapper
```

The only external resources are three typefaces from Google Fonts; the page
falls back to system faces if they are unavailable.

## Tests

`build.mjs` has no dependencies. The pure logic (interpreter, engine, maze,
rhythm generator) exposes itself on `Showcase.lib` so it can be exercised
outside a browser; see the pull request that introduced this directory for the
Node test script used.
