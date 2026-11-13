/**
 * End-to-end checks. Usage:
 *   npm run build && npm run e2e
 * Options (environment): E2E_URL to test an already running copy, E2E_ENGINES=chromium,webkit,webkitgtk,
 *   E2E_SCREENS=phone,phone-landscape,tablet,desktop
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PlaywrightDriver, WebDriverDriver, loadPlaywright, webkitGtkAvailable } from './drivers.mjs';
import { runFlow } from './flow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  { kind: 'phone', label: 'Phone portrait 390×844', width: 390, height: 844, touch: true, rotate: true },
  { kind: 'phone-landscape', label: 'Phone landscape 844×390', width: 844, height: 390, touch: true },
  { kind: 'tablet', label: 'Tablet portrait 820×1180', width: 820, height: 1180, touch: true, rotate: true },
  { kind: 'desktop', label: 'Desktop 1280×800', width: 1280, height: 800, touch: false },
];

/** A solid-colour 256×256 PNG, used to stand in for map and terrain tiles. */
function solidPng(r, g, b) {
  const size = 256;
  const row = Buffer.alloc(1 + size * 3);
  for (let i = 0; i < size; i++) row.set([r, g, b], 1 + i * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function ensureServer() {
  if (process.env.E2E_URL) return { url: process.env.E2E_URL, stop: () => {} };
  const url = 'http://localhost:4173/';
  const up = () => fetch(url).then((r) => r.ok).catch(() => false);
  if (await up()) return { url, stop: () => {} };
  const proc = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: path.join(here, '..'), stdio: 'ignore', detached: true });
  for (let i = 0; i < 40 && !(await up()); i++) await sleep(250);
  return { url, stop: () => { try { process.kill(-proc.pid); } catch { /* gone */ } } };
}

const results = [];
function recorder(engine, screen) {
  return (name, ok, detail = '') => {
    const existing = results.find((r) => r.engine === engine && r.screen === screen && r.name === name);
    if (existing) Object.assign(existing, { ok: existing.ok && ok, detail: detail || existing.detail });
    else results.push({ engine, screen, name, ok, detail });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  };
}

async function extraChromiumChecks(pw, url) {
  const record = recorder('chromium', 'Extra checks');

  // Map tiles and terrain, with the tile servers stood in for locally (they are not reachable from every test machine).
  console.log('\nchromium · map tiles and terrain (stand-in tile servers)');
  let tileRequests = 0;
  const d = await PlaywrightDriver.create(pw.chromium, {
    viewport: { width: 1280, height: 800 },
    routes: [
      ['https://tile.openstreetmap.org/**', (route) => { tileRequests++; return route.fulfill({ contentType: 'image/png', body: solidPng(200, 40, 160) }); }],
      // Terrarium encoding of 1280.0 m everywhere.
      ['https://s3.amazonaws.com/elevation-tiles-prod/**', (route) => route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: solidPng(133, 0, 0) })],
    ],
  });
  try {
    await d.goto(url);
    await d.page.waitForSelector('.wp-marker');
    await d.page.waitForFunction(() => window.__waypathMap?.areTilesLoaded?.() && window.__waypathMap.loaded());
    await sleep(500);
    const shot = (await d.page.screenshot({ clip: { x: 900, y: 600, width: 40, height: 40 } })).toString('base64');
    const px = await d.page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = 40;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(20, 20, 1, 1).data];
    }, shot);
    record('Raster map tiles are requested and drawn', tileRequests > 0 && Math.abs(px[0] - 200) < 12 && Math.abs(px[1] - 40) < 12 && Math.abs(px[2] - 160) < 12, `${tileRequests} tile requests, map pixel rgb(${px.slice(0, 3).join(',')})`);

    await d.click('.tabs button:nth-child(3)');
    await d.page.waitForFunction(() => /Terrain data is loaded/.test(document.querySelector('[data-testid="elevation-status"]')?.textContent ?? ''), null, { timeout: 10000 });
    const agl = d.page.locator('[aria-label="Altitude reference"] button', { hasText: 'AGL' });
    const enabled = await agl.isEnabled();
    await agl.click();
    const label = await d.page.locator('label', { hasText: /^Altitude above/ }).first().textContent();
    await d.click('.tabs button:nth-child(1)');
    await d.click('[aria-label="Edit waypoint 1"]');
    const note = await d.page.locator('.tab-body .section .hint').first().textContent();
    record('Terrain lookup enables above-ground mode and relabels altitude', enabled && /above ground \(AGL\)/.test(label) && /1280 m above sea level/.test(note), `label “${label}”; waypoint note “${note.slice(0, 60)}…”`);

    await d.click('.tabs button:nth-child(3)');
    await d.page.locator('[aria-label="Units"] button', { hasText: 'Feet' }).click();
    const stat = await d.page.locator('[data-testid="stat-distance"]').textContent();
    record('Units switch to feet and miles', /ft|mi/.test(stat), stat);
    await d.screenshot(path.join(outDir, 'chromium-tiles.png'));
  } catch (e) {
    record('Map tiles and terrain checks', false, String(e.message).split('\n')[0]);
  }
  await d.close();

  // Installable app: manifest, service worker, offline start.
  console.log('\nchromium · installable app and offline start');
  const p = await PlaywrightDriver.create(pw.chromium, { viewport: { width: 390, height: 844 }, touch: true, serviceWorkers: 'allow' });
  try {
    await p.goto(url);
    await p.page.waitForSelector('.wp-marker');
    const manifest = await p.page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
    const iconsOk = (await Promise.all(manifest.icons.map((i) => p.page.evaluate((src) => fetch(src).then((r) => r.ok && r.headers.get('content-type')), i.src)))).every((t) => t === 'image/png');
    record('Web app manifest is complete', manifest.display === 'standalone' && manifest.name && manifest.start_url && iconsOk && manifest.icons.some((i) => i.sizes === '512x512') && manifest.icons.some((i) => i.purpose === 'maskable'), `${manifest.name}, ${manifest.icons.length} icons, display ${manifest.display}`);
    await p.page.evaluate(() => navigator.serviceWorker.ready);
    await p.page.waitForFunction(() => navigator.serviceWorker.controller != null, null, { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    await p.context.setOffline(true);
    await p.page.reload();
    await p.page.waitForSelector('.wp-marker', { timeout: 15000 });
    const offline = await p.page.evaluate(() => ({ name: document.querySelector('.mission-name').textContent, markers: document.querySelectorAll('.wp-marker').length }));
    record('App starts offline after the first visit, with saved missions', offline.markers === 5, `offline reload showed “${offline.name}” with ${offline.markers} waypoints`);
  } catch (e) {
    record('Installable app checks', false, String(e.message).split('\n')[0]);
  }
  await p.close();
}

const server = await ensureServer();
const pw = loadPlaywright();
const wanted = (process.env.E2E_ENGINES ?? 'chromium,webkit,webkitgtk').split(',');
const engines = [];
const skipped = [];
for (const name of wanted) {
  if (name === 'webkitgtk') {
    if (webkitGtkAvailable()) engines.push({ name, make: (v) => WebDriverDriver.create({ viewport: v }) });
    else skipped.push('webkitgtk (WebKitWebDriver not installed)');
  } else if (!pw) skipped.push(`${name} (Playwright not installed)`);
  else if (!fs.existsSync(pw[name].executablePath())) skipped.push(`${name} (Playwright browser not installed)`);
  else
    engines.push({
      name,
      make: (v) =>
        PlaywrightDriver.create(pw[name], {
          viewport: { width: v.width, height: v.height },
          touch: v.touch,
          // Keep the run self-contained: map tiles are not needed for the workflow, and terrain is covered separately.
          routes: [['https://tile.openstreetmap.org/**', (r) => r.abort()], ['https://s3.amazonaws.com/**', (r) => r.abort()]],
        }),
    });
}

const versions = {};
for (const engine of engines) {
  for (const v of VIEWPORTS.filter((x) => !process.env.E2E_SCREENS || process.env.E2E_SCREENS.split(',').includes(x.kind))) {
    console.log(`\n${engine.name} · ${v.label}`);
    const record = recorder(engine.name, v.label);
    let d;
    try {
      d = await engine.make(v);
      versions[engine.name] = d.version;
      await runFlow(d, { url: server.url, viewport: v, kind: v.kind, record });
      await d.screenshot(path.join(outDir, `${engine.name}-${v.kind}.png`)).catch(() => {});
    } catch (e) {
      record('Run completed', false, String(e.message).split('\n')[0]);
    }
    await d?.close().catch(() => {});
  }
}
if (pw && engines.some((e) => e.name === 'chromium')) await extraChromiumChecks(pw, server.url);
server.stop();

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ ranAt: new Date().toISOString(), versions, skipped, results }, null, 2));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Engines: ${Object.entries(versions).map(([k, v]) => `${k} ${v}`).join('; ')}`);
if (skipped.length) console.log(`Skipped: ${skipped.join('; ')}`);
for (const f of failed) console.log(`FAILED  ${f.engine} · ${f.screen} · ${f.name}  ${f.detail}`);
process.exit(failed.length ? 1 : 0);
