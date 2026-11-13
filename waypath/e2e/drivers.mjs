/**
 * Two thin browser drivers with the same small API, so one test flow can run in
 * Chromium / WebKit through Playwright and in WebKitGTK through plain WebDriver.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

/* ------------------------------ Playwright ------------------------------ */

export class PlaywrightDriver {
  static async create(browserType, { viewport, touch, routes = [], serviceWorkers = 'block' }) {
    const d = new PlaywrightDriver();
    d.touch = !!touch;
    d.engine = browserType.name();
    d.browser = await browserType.launch();
    d.context = await d.browser.newContext({
      viewport,
      hasTouch: d.touch,
      isMobile: d.touch && d.engine !== 'firefox',
      acceptDownloads: true,
      serviceWorkers,
    });
    for (const [pattern, handler] of routes) await d.context.route(pattern, handler);
    d.context.setDefaultTimeout(8000);
    d.page = await d.context.newPage();
    d.errors = [];
    d.page.on('pageerror', (e) => d.errors.push(String(e.message)));
    d.version = d.browser.version();
    return d;
  }
  async goto(url) {
    await this.page.goto(url);
  }
  async reload() {
    await this.page.reload();
  }
  async ev(body, ...args) {
    return this.page.evaluate(([b, a]) => new Function(b)(...a), [body, args]);
  }
  async click(sel) {
    const loc = this.page.locator(sel).first();
    if (this.touch) await loc.tap();
    else await loc.click();
  }
  async fill(sel, value) {
    await this.page.locator(sel).first().fill(String(value));
  }
  async select(sel, value) {
    await this.page.locator(sel).first().selectOption(String(value));
  }
  async tapAt(x, y) {
    if (this.touch) await this.page.touchscreen.tap(x, y);
    else await this.page.mouse.click(x, y);
  }
  async drag(from, to) {
    const steps = 8;
    const at = (i) => ({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    if (this.touch && this.engine === 'chromium') {
      const cdp = await this.context.newCDPSession(this.page);
      const send = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
      await send('touchStart', from);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', at(i));
        await sleep(20);
      }
      await send('touchEnd');
      return;
    }
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    for (let i = 1; i <= steps; i++) await this.page.mouse.move(at(i).x, at(i).y);
    await this.page.mouse.up();
  }
  async press(key) {
    await this.page.keyboard.press(key);
  }
  async download(action) {
    const [dl] = await Promise.all([this.page.waitForEvent('download', { timeout: 10000 }), action()]);
    return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8'), real: true };
  }
  async upload(sel, file) {
    await this.page.locator(sel).first().setInputFiles(file);
  }
  async setViewport(viewport) {
    await this.page.setViewportSize(viewport);
  }
  async screenshot(file) {
    await this.page.screenshot({ path: file });
  }
  async close() {
    await this.browser.close();
  }
}

/* ------------------------------ WebDriver (WebKitGTK) ------------------------------ */

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const KEYS = { Escape: '', Control: '', Shift: '', Delete: '', Enter: '' };

export function webkitGtkAvailable() {
  try {
    execSync('which WebKitWebDriver xvfb-run', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export class WebDriverDriver {
  static async create({ viewport, port = 4460 + Math.floor(Math.random() * 400) }) {
    const d = new WebDriverDriver();
    d.touch = false;
    d.engine = 'webkitgtk';
    d.errors = [];
    d.proc = spawn('xvfb-run', ['-a', '-s', '-screen 0 1700x1500x24', 'WebKitWebDriver', `--port=${port}`], {
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' },
    });
    d.base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 40; i++) {
      try {
        await fetch(d.base + '/status');
        break;
      } catch {
        await sleep(250);
      }
    }
    const s = await d.call('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          browserName: 'MiniBrowser',
          'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] },
        },
      },
    });
    d.sid = s.sessionId;
    d.version = 'WebKitGTK ' + s.capabilities.browserVersion;
    d.viewport = viewport;
    await d.setViewport(viewport);
    return d;
  }
  async call(method, path, body) {
    const r = await fetch(this.base + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (j.value && j.value.error) throw new Error(`${path}: ${j.value.error}: ${String(j.value.message).slice(0, 300)}`);
    return j.value;
  }
  s(path, body, method = 'POST') {
    return this.call(method, `/session/${this.sid}${path}`, body);
  }
  async goto(url) {
    await this.s('/url', { url });
  }
  async reload() {
    await this.s('/refresh', {});
  }
  async ev(body, ...args) {
    return this.s('/execute/sync', { script: body, args });
  }
  async el(sel) {
    for (let i = 0; i < 40; i++) {
      try {
        return (await this.s('/element', { using: 'css selector', value: sel }))[ELEMENT];
      } catch (e) {
        if (i === 39) throw e;
        await sleep(125);
      }
    }
  }
  async click(sel) {
    try {
      await this.s(`/element/${await this.el(sel)}/click`, {});
    } catch (e) {
      // Say what was in the way; WebKit's own message does not.
      const top = await this.ev(
        `const e = document.querySelector(arguments[0]); if (!e) return 'element is gone';
         const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
         return 'at its centre is ' + (t ? t.tagName + '.' + t.className + ' “' + (t.textContent || '').slice(0, 40) + '”' : 'nothing') + ', window ' + innerWidth + '×' + innerHeight;`,
        sel,
      ).catch(() => '');
      throw new Error(`${e.message} (${sel}: ${top})`);
    }
  }
  async fill(sel, value) {
    const id = await this.el(sel);
    await this.s(`/element/${id}/clear`, {});
    await this.s(`/element/${id}/value`, { text: String(value) });
  }
  async select(sel, value) {
    await this.click(`${sel} option[value="${value}"]`);
  }
  pointer(actions) {
    return this.s('/actions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions }] });
  }
  async tapAt(x, y) {
    await this.pointer([
      { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y), origin: 'viewport' },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: 40 },
      { type: 'pointerUp', button: 0 },
    ]);
  }
  async drag(from, to) {
    const steps = 8;
    const moves = [];
    for (let i = 1; i <= steps; i++) {
      moves.push({
        type: 'pointerMove',
        duration: 30,
        x: Math.round(from.x + ((to.x - from.x) * i) / steps),
        y: Math.round(from.y + ((to.y - from.y) * i) / steps),
        origin: 'viewport',
      });
    }
    await this.pointer([
      { type: 'pointerMove', duration: 0, x: Math.round(from.x), y: Math.round(from.y), origin: 'viewport' },
      { type: 'pointerDown', button: 0 },
      ...moves,
      { type: 'pointerUp', button: 0 },
    ]);
  }
  async press(combo) {
    const parts = combo.split('+').map((k) => KEYS[k] ?? k);
    const actions = [...parts.map((value) => ({ type: 'keyDown', value })), ...parts.reverse().map((value) => ({ type: 'keyUp', value }))];
    await this.s('/actions', { actions: [{ type: 'key', id: 'kb', actions }] });
  }
  /**
   * WebDriver cannot observe the browser's own download hand-off, so this records the
   * file the page asks the browser to save (name and contents) at the moment it asks.
   */
  async download(action) {
    await this.ev(`
      window.__dl = null;
      if (!window.__dlHooked) {
        window.__dlHooked = true;
        const blobs = new Map();
        const make = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (b) => { const u = make(b); blobs.set(u, b); return u; };
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          const b = blobs.get(this.href);
          if (this.download && b) b.text().then((text) => (window.__dl = { name: this.download, text }));
          return click.call(this);
        };
      }`);
    await action();
    for (let i = 0; i < 60; i++) {
      const got = await this.ev('return window.__dl');
      if (got) {
        // MiniBrowser shows a download bar that eats into the page; put the page back to its size.
        await this.setViewport(this.viewport);
        return { ...got, real: false };
      }
      await sleep(100);
    }
    throw new Error('The page never asked to save a file');
  }
  async upload(sel, file) {
    await this.s(`/element/${await this.el(sel)}/value`, { text: file });
  }
  async setViewport(viewport) {
    this.viewport = viewport;
    // The window includes the browser's own toolbar, so adjust until the page itself has the requested size.
    await this.s('/window/rect', { width: viewport.width, height: viewport.height });
    for (let i = 0; i < 6; i++) {
      await sleep(350);
      const inner = await this.ev('return { w: window.innerWidth, h: window.innerHeight }').catch(() => null);
      if (!inner || (inner.w === viewport.width && inner.h === viewport.height)) return;
      const rect = await this.s('/window/rect', undefined, 'GET');
      await this.s('/window/rect', { width: rect.width + viewport.width - inner.w, height: rect.height + viewport.height - inner.h });
    }
  }
  async screenshot(file) {
    fs.writeFileSync(file, Buffer.from(await this.s('/screenshot', undefined, 'GET'), 'base64'));
  }
  async close() {
    await this.call('DELETE', `/session/${this.sid}`).catch(() => {});
    try {
      process.kill(-this.proc.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    try {
      execSync('pkill -f WebKitWebDriver; pkill -f MiniBrowser; pkill -f "Xvfb :"', { stdio: 'ignore' });
    } catch {
      /* nothing left to stop */
    }
  }
}
