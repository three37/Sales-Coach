/* lisp.js — a Scheme-flavoured Lisp interpreter: tokenizer, reader,
   environment model, and an evaluator with proper tail calls, in about 200
   lines. Closures, recursion, first-class functions and quoting all work;
   the evaluator is a loop, not recursive, so (count-to 100000) needs no
   deeper a JavaScript stack than (count-to 1). Programs stop after a few
   million steps so an infinite loop can never take the page down. */
(function () {
  'use strict';
  class Sym { constructor(name) { this.name = name; } toString() { return this.name; } }
  const table = new Map();
  const sym = (n) => table.get(n) || (table.set(n, new Sym(n)), table.get(n));
  class Lambda { constructor(params, body, env, name) { this.params = params; this.body = body; this.env = env; this.name = name || 'lambda'; } }
  class LispError extends Error {}
  class Env {
    constructor(names = [], values = [], outer = null) { this.vars = new Map(); this.outer = outer; names.forEach((n, i) => this.vars.set(n, values[i])); }
    find(n) { let e = this; while (e) { if (e.vars.has(n)) return e; e = e.outer; } throw new LispError(`unbound symbol: ${n}`); }
    get(n) { return this.find(n).vars.get(n); }
    set(n, v) { this.vars.set(n, v); }
  }

  /* reader */
  const tokenize = (src) => { const re = /\s*(;[^\n]*|[()']|"(?:\\.|[^"\\])*"|[^\s()';"]+)/g; const out = []; let m; while ((m = re.exec(src)) && m[1] !== undefined) { if (m[1][0] !== ';') out.push(m[1]); if (re.lastIndex >= src.length) break; } return out; };
  const atom = (t) => {
    if (t === '#t') return true; if (t === '#f') return false;
    if (t[0] === '"') return JSON.parse(t);
    const n = Number(t); return Number.isNaN(n) ? sym(t) : n;
  };
  const read = (tokens) => {
    if (!tokens.length) throw new LispError('unexpected end of input');
    const t = tokens.shift();
    if (t === '(') { const list = []; while (tokens[0] !== ')') { if (!tokens.length) throw new LispError('missing )'); list.push(read(tokens)); } tokens.shift(); return list; }
    if (t === ')') throw new LispError('unexpected )');
    if (t === "'") return [sym('quote'), read(tokens)];
    return atom(t);
  };
  const parse = (src) => { const tokens = tokenize(src), forms = []; while (tokens.length) forms.push(read(tokens)); return forms; };

  /* printer */
  const str = (v) => {
    if (v === true) return '#t'; if (v === false) return '#f';
    if (typeof v === 'string') return JSON.stringify(v);
    if (v instanceof Sym) return v.name;
    if (Array.isArray(v)) return `(${v.map(str).join(' ')})`;
    if (v instanceof Lambda) return `#<procedure ${v.name}>`;
    if (typeof v === 'function') return `#<builtin ${v.lispName || ''}>`;
    if (v === undefined) return '';
    return String(v);
  };

  /* evaluator */
  let budget = 0;
  const truthy = (v) => v !== false;
  const bind = (proc, args) => {
    if (proc.params instanceof Sym) return new Env([proc.params.name], [args], proc.env);
    if (args.length !== proc.params.length) throw new LispError(`${proc.name} expects ${proc.params.length} argument(s), got ${args.length}`);
    return new Env(proc.params.map((p) => p.name), args, proc.env);
  };
  const call = (proc, args) => {
    if (typeof proc === 'function') return proc(...args);
    if (proc instanceof Lambda) return evaluate([sym('begin'), ...proc.body], bind(proc, args));
    throw new LispError(`${str(proc)} is not a procedure`);
  };
  function evaluate(x, env) {
    for (;;) {
      if (--budget < 0) throw new LispError('evaluation limit reached (is there an infinite loop?)');
      if (x instanceof Sym) return env.get(x.name);
      if (!Array.isArray(x) || x.length === 0) return x;
      const head = x[0];
      if (head instanceof Sym) {
        switch (head.name) {
          case 'quote': return x[1];
          case 'if': x = truthy(evaluate(x[1], env)) ? x[2] : x.length > 3 ? x[3] : false; continue;
          case 'define':
            if (Array.isArray(x[1])) { const [name, ...params] = x[1]; env.set(name.name, new Lambda(params, x.slice(2), env, name.name)); return sym(name.name); }
            { const v = evaluate(x[2], env); if (v instanceof Lambda && v.name === 'lambda') v.name = x[1].name; env.set(x[1].name, v); return sym(x[1].name); }
          case 'set!': env.find(x[1].name).set(x[1].name, evaluate(x[2], env)); return undefined;
          case 'lambda': return new Lambda(x[1], x.slice(2), env);
          case 'begin': for (let i = 1; i < x.length - 1; i++) evaluate(x[i], env); x = x[x.length - 1]; continue;
          case 'let': { const names = x[1].map((b) => b[0].name), vals = x[1].map((b) => evaluate(b[1], env)); env = new Env(names, vals, env); x = [sym('begin'), ...x.slice(2)]; continue; }
          case 'cond': { let next = false; for (const clause of x.slice(1)) { if ((clause[0] instanceof Sym && clause[0].name === 'else') || truthy(evaluate(clause[0], env))) { next = [sym('begin'), ...clause.slice(1)]; break; } } x = next; continue; }
          case 'and': { let v = true; for (const e of x.slice(1)) { v = evaluate(e, env); if (!truthy(v)) return v; } return v; }
          case 'or': { for (const e of x.slice(1)) { const v = evaluate(e, env); if (truthy(v)) return v; } return false; }
          case 'when': if (!truthy(evaluate(x[1], env))) return undefined; x = [sym('begin'), ...x.slice(2)]; continue;
        }
      }
      const proc = evaluate(head, env);
      const args = x.slice(1).map((a) => evaluate(a, env));
      if (proc instanceof Lambda) { env = bind(proc, args); x = [sym('begin'), ...proc.body]; continue; }
      if (typeof proc === 'function') return proc(...args);
      throw new LispError(`${str(head)} is not a procedure`);
    }
  }

  /* the standard library */
  const globals = (out) => {
    const env = new Env();
    const def = (n, f) => { f.lispName = n; env.set(n, f); };
    const num = (v, op) => { if (typeof v !== 'number') throw new LispError(`${op}: expected a number, got ${str(v)}`); return v; };
    const chain = (n, cmp) => def(n, (...a) => { for (let i = 1; i < a.length; i++) if (!cmp(num(a[i - 1], n), num(a[i], n))) return false; return true; });
    def('+', (...a) => a.reduce((s, v) => s + num(v, '+'), 0));
    def('*', (...a) => a.reduce((s, v) => s * num(v, '*'), 1));
    def('-', (a, ...r) => r.length ? r.reduce((s, v) => s - num(v, '-'), num(a, '-')) : -num(a, '-'));
    def('/', (a, ...r) => r.reduce((s, v) => s / num(v, '/'), num(a, '/')));
    chain('=', (a, b) => a === b); chain('<', (a, b) => a < b); chain('>', (a, b) => a > b); chain('<=', (a, b) => a <= b); chain('>=', (a, b) => a >= b);
    const equal = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i])));
    def('equal?', equal); def('eq?', (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && !a.length && !b.length));
    def('not', (v) => v === false);
    def('car', (l) => { if (!Array.isArray(l) || !l.length) throw new LispError(`car: not a pair: ${str(l)}`); return l[0]; });
    def('cdr', (l) => { if (!Array.isArray(l) || !l.length) throw new LispError(`cdr: not a pair: ${str(l)}`); return l.slice(1); });
    def('cons', (a, l) => { if (!Array.isArray(l)) throw new LispError('cons: this Lisp only builds proper lists'); return [a, ...l]; });
    def('list', (...a) => a); def('length', (l) => l.length); def('append', (...ls) => ls.flat(1)); def('reverse', (l) => [...l].reverse());
    def('list-ref', (l, i) => l[i]); def('range', (a, b, s = 1) => { const o = []; for (let i = a; s > 0 ? i < b : i > b; i += s) o.push(i); return o; });
    def('null?', (v) => Array.isArray(v) && v.length === 0); def('pair?', (v) => Array.isArray(v) && v.length > 0); def('list?', Array.isArray);
    def('number?', (v) => typeof v === 'number'); def('symbol?', (v) => v instanceof Sym); def('string?', (v) => typeof v === 'string');
    def('procedure?', (v) => v instanceof Lambda || typeof v === 'function'); def('boolean?', (v) => typeof v === 'boolean');
    def('map', (f, ...ls) => ls[0].map((_, i) => call(f, ls.map((l) => l[i]))));
    def('filter', (f, l) => l.filter((v) => truthy(call(f, [v]))));
    def('reduce', (f, init, l) => l.reduce((acc, v) => call(f, [acc, v]), init)); env.set('fold', env.get('reduce'));
    def('apply', (f, ...a) => call(f, [...a.slice(0, -1), ...a[a.length - 1]]));
    def('for-each', (f, l) => { l.forEach((v) => call(f, [v])); return undefined; });
    def('display', (v) => { out(typeof v === 'string' ? v : str(v)); return undefined; });
    def('newline', () => { out('\n'); return undefined; });
    def('string-append', (...s) => s.join('')); def('number->string', (n) => String(n)); def('string->symbol', (s) => sym(s)); def('symbol->string', (s) => s.name);
    def('string-length', (s) => s.length); def('string-upcase', (s) => s.toUpperCase());
    ['abs', 'min', 'max', 'sqrt', 'floor', 'ceil', 'round', 'exp', 'log', 'sin', 'cos', 'atan'].forEach((n) => def(n === 'ceil' ? 'ceiling' : n, (...a) => Math[n](...a)));
    def('expt', Math.pow); def('modulo', (a, b) => ((a % b) + b) % b); def('remainder', (a, b) => a % b); def('quotient', (a, b) => Math.trunc(a / b));
    def('even?', (n) => n % 2 === 0); def('odd?', (n) => n % 2 !== 0); def('zero?', (n) => n === 0);
    def('error', (...m) => { throw new LispError(m.map((v) => typeof v === 'string' ? v : str(v)).join(' ')); });
    env.set('nil', []); env.set('else', true);
    return env;
  };
  /* run(source) → { results: [string], output: string, error?: string } */
  const run = (src, env, maxSteps = 3e6) => {
    let output = ''; const results = [];
    env = env || globals((s) => output += s);
    budget = maxSteps;
    try { for (const form of parse(src)) { const v = evaluate(form, env); if (v !== undefined) results.push(str(v)); } }
    catch (e) { return { results, output, error: e instanceof LispError ? e.message : e instanceof RangeError ? 'recursion too deep (the JavaScript stack ran out)' : `internal: ${e.message}` }; }
    return { results, output };
  };
  Showcase.lib.lisp = { parse, evaluate, run, globals, str, sym, Lambda };

  /* ---- REPL ---- */
  const EXAMPLES = {
    fib: `; recursion and higher-order functions
(define (fib n)
  (if (< n 2) n
      (+ (fib (- n 1)) (fib (- n 2)))))

(map fib (range 0 16))`,
    closure: `; a closure remembers the environment it was born in
(define (make-counter)
  (let ((n 0))
    (lambda () (set! n (+ n 1)) n)))

(define tick (make-counter))
(tick) (tick) (tick)
(define other (make-counter))
(other)   ; a fresh n`,
    sort: `; quicksort, as a sentence
(define (quicksort xs)
  (if (null? xs) '()
      (let ((p (car xs)) (rest (cdr xs)))
        (append (quicksort (filter (lambda (x) (< x p)) rest))
                (list p)
                (quicksort (filter (lambda (x) (>= x p)) rest))))))

(quicksort '(3 1 4 1 5 9 2 6 5 3 5 8 9 7 9))`,
    tail: `; proper tail calls: a hundred thousand iterations, no stack
(define (count-to n acc)
  (if (= n 0) acc
      (count-to (- n 1) (+ acc 1))))

(count-to 100000 0)`,
    church: `; Church numerals: arithmetic with nothing but functions
(define zero (lambda (f) (lambda (x) x)))
(define (succ n) (lambda (f) (lambda (x) (f ((n f) x)))))
(define (add a b) (lambda (f) (lambda (x) ((a f) ((b f) x)))))
(define (mul a b) (lambda (f) (a (b f))))
(define (to-int n) ((n (lambda (x) (+ x 1))) 0))

(define three (succ (succ (succ zero))))
(to-int (mul (add three three) three))   ; (3+3)*3`
  };
  Showcase.register('lisp', (root) => {
    const editor = root.querySelector('textarea'), out = root.querySelector('.repl-out');
    const runBtn = root.querySelector('[data-action=run]');
    let env = null;
    const show = (src) => {
      let printed = '';
      env = env || globals((s) => printed += s);
      const t0 = performance.now();
      const res = run(src, env);
      const ms = performance.now() - t0;
      const entry = document.createElement('div'); entry.className = 'repl-entry';
      const inp = document.createElement('pre'); inp.className = 'repl-in'; inp.textContent = src.trim(); entry.appendChild(inp);
      if (printed) { const p = document.createElement('pre'); p.className = 'repl-print'; p.textContent = printed; entry.appendChild(p); }
      res.results.forEach((r) => { const p = document.createElement('pre'); p.className = 'repl-val'; p.textContent = '⇒ ' + r; entry.appendChild(p); });
      if (res.error) { const p = document.createElement('pre'); p.className = 'repl-err'; p.textContent = 'error: ' + res.error; entry.appendChild(p); }
      const meta = document.createElement('div'); meta.className = 'repl-meta'; meta.textContent = `${ms < 1 ? '<1' : ms.toFixed(0)} ms`; entry.appendChild(meta);
      out.appendChild(entry); out.scrollTop = out.scrollHeight;
    };
    runBtn.addEventListener('click', () => show(editor.value));
    editor.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); show(editor.value); } });
    root.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => { editor.value = EXAMPLES[b.dataset.example]; show(editor.value); }));
    root.querySelector('[data-action=clear]').addEventListener('click', () => { out.innerHTML = ''; env = null; });
    editor.value = EXAMPLES.fib; show(editor.value);
    return { start() {}, stop() {} };
  });
})();
