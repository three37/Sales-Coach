/** The planning workflow, written once and run in every browser and screen size. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(d, body, what, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await d.ev(body).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(100);
  }
}

/** Tag an element found by its visible text or label so it can be clicked like any other. */
async function mark(d, kind, text, nth = 0) {
  const sel = await d.ev(
    `const [kind, text, nth] = arguments;
     const vis = (e) => e.getClientRects().length > 0;
     let found = [];
     if (kind === 'button') found = [...document.querySelectorAll('button')].filter(vis).filter((b) => b.textContent.trim() === text);
     if (kind === 'label') found = [...document.querySelectorAll('label')].filter(vis).filter((l) => l.textContent.trim().startsWith(text))
       .map((l) => (l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector('input')));
     const el = found[nth];
     if (!el) return null;
     const k = 'm' + Math.random().toString(36).slice(2);
     el.setAttribute('data-e2e', k);
     return '[data-e2e="' + k + '"]';`,
    kind,
    text,
    nth,
  );
  if (!sel) throw new Error(`No ${kind} “${text}” (#${nth}) on screen`);
  return sel;
}
const clickText = async (d, text, nth) => d.click(await mark(d, 'button', text, nth));
const field = (d, label, nth) => mark(d, 'label', label, nth);

const stat = (d, name) => d.ev(`return document.querySelector('[data-testid="stat-${name}"]').textContent.trim()`);
const stats = async (d) => ({ waypoints: await stat(d, 'waypoints'), distance: await stat(d, 'distance'), duration: await stat(d, 'duration') });
const missionName = (d) => d.ev(`return document.querySelector('.mission-name').textContent`);
const count = (d, sel) => d.ev(`return document.querySelectorAll(arguments[0]).length`, sel);
const text = (d, sel) => d.ev(`const e = document.querySelector(arguments[0]); return e ? e.textContent.trim() : null`, sel);
const tab = (d, i) => d.click(`.tabs button:nth-child(${i})`);
/** Open the Route tab and leave any waypoint or POI editor, so the list is showing. */
async function toList(d) {
  await tab(d, 1);
  if (await count(d, '.editor-head')) await d.click('.editor-head .btn');
}
const tool = (d, i) => d.click(`.toolbar .segmented button:nth-child(${i})`);

async function mapPoint(d, fx, fy) {
  const r = await d.ev(`const r = document.querySelector('.map').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }`);
  return { x: r.x + r.w * fx, y: r.y + r.h * fy };
}
const center = (d, sel) =>
  d.ev(`const r = document.querySelector(arguments[0]).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`, sel);

const secs = (mmss) => mmss.split(':').reduce((a, p) => a * 60 + Number(p), 0);
const fmtDuration = (s) => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
function haversine(a, b) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const s = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
/** Distance and time worked out independently from an exported file (straight legs). */
function expected(mission) {
  let dist = 0;
  let time = 0;
  mission.waypoints.forEach((w, i) => {
    time += w.holdSec;
    const next = mission.waypoints[i + 1];
    if (!next) return;
    const leg = haversine(w, next);
    dist += leg;
    time += leg / (w.speedMps ?? mission.defaults.speedMps);
  });
  return { dist, time };
}
const settingsOf = (file) => {
  const m = structuredClone(JSON.parse(file).mission);
  delete m.id;
  delete m.name;
  delete m.updatedAt;
  return m;
};

export async function runFlow(d, { url, viewport, kind, record }) {
  const check = (name, ok, detail = '') => record(name, !!ok, detail);
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      record(name, false, String(e.message).replace(/\s+/g, ' ').slice(0, 400));
    }
  };

  await d.goto(url);

  await step('First launch shows a working sample mission', async () => {
    await until(d, `return document.querySelectorAll('.wp-marker').length === 5`, 'sample markers', 20000);
    const s = await stats(d);
    check('First launch shows a working sample mission', (await missionName(d)).includes('Sample') && s.waypoints === '5' && secs(s.duration) > 0, JSON.stringify(s));
  });

  await step('Layout matches the screen', async () => {
    const l = await d.ev(`
      const p = document.querySelector('.panel').getBoundingClientRect(), s = document.querySelector('.stage').getBoundingClientRect();
      const inView = (sel) => [...document.querySelectorAll(sel)].every((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
      const minSide = (sel) => Math.min(...[...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
      return { side: p.right <= s.left + 1, below: p.top >= s.bottom - 1, mapW: s.width, mapH: s.height,
        visible: inView('.topbar button, .toolbar button, .map-tools button, .panel-head, .tabs button'),
        minTarget: minSide('.topbar button, .toolbar button, .map-tools button, .tabs button'), w: innerWidth, h: innerHeight };`);
    const wantSide = kind === 'desktop' || kind === 'phone-landscape';
    check(
      'Layout matches the screen',
      (wantSide ? l.side : l.below) && l.visible && l.minTarget >= 44 && l.mapW >= 200 && l.mapH >= 200,
      `${l.w}×${l.h}: panel ${l.side ? 'beside' : l.below ? 'below' : '??'} map, map ${Math.round(l.mapW)}×${Math.round(l.mapH)}, smallest control ${Math.round(l.minTarget)}px`,
    );
  });

  await step('Create a new mission', async () => {
    await d.click('.mission-btn');
    await clickText(d, 'New mission');
    await until(d, `return document.querySelectorAll('.wp-marker').length === 0 && !document.querySelector('.dialog')`, 'empty mission');
    check('Create a new mission', (await stat(d, 'waypoints')) === '0');
  });

  await step('Tap the map to add three waypoints', async () => {
    await tool(d, 2);
    for (const [fx, fy] of [[0.22, 0.6], [0.45, 0.36], [0.7, 0.58]]) {
      const p = await mapPoint(d, fx, fy);
      await d.tapAt(p.x, p.y);
      await sleep(350);
    }
    await until(d, `return document.querySelectorAll('.wp-marker').length === 3`, 'three markers');
    const s = await stats(d);
    check('Tap the map to add three waypoints', s.waypoints === '3' && secs(s.duration) > 0, JSON.stringify(s));
  });

  await step('Add a point of interest', async () => {
    await tool(d, 3);
    const p = await mapPoint(d, 0.47, 0.6);
    await d.tapAt(p.x, p.y);
    await until(d, `return document.querySelectorAll('.poi-marker').length === 1`, 'POI marker');
    const backToSelect = await d.ev(`return document.querySelector('.toolbar .segmented button:nth-child(1)').getAttribute('aria-pressed') === 'true'`);
    check('Add a point of interest', backToSelect && (await stat(d, 'waypoints')) === '3');
  });

  await step('Changing speed updates the time estimate', async () => {
    await tab(d, 3);
    const before = await stats(d);
    const inc = '[aria-label="Increase Speed"]';
    for (let i = 0; i < 3; i++) await d.click(inc);
    await sleep(200);
    const faster = await stats(d);
    await d.fill(await field(d, 'Speed'), '4');
    await sleep(200);
    const slower = await stats(d);
    const ratio = secs(slower.duration) / secs(faster.duration);
    check(
      'Changing speed updates the time estimate',
      secs(faster.duration) < secs(before.duration) && secs(slower.duration) > secs(before.duration) && Math.abs(ratio - 2) < 0.15 && before.distance === slower.distance,
      `5 m/s ${before.duration} → 8 m/s ${faster.duration} → 4 m/s ${slower.duration}, distance unchanged at ${slower.distance}`,
    );
  });

  let poiValue = '';
  await step('Mission settings: name and face-the-POI heading', async () => {
    await d.fill('#mission-name', 'E2E plan');
    const headingSel = await field(d, 'Drone heading');
    poiValue = await d.ev(`return [...document.querySelector(arguments[0]).options].find((o) => o.value.startsWith('poi:')).value`, headingSel);
    await d.select(headingSel, poiValue);
    await sleep(200);
    check('Mission settings: name and face-the-POI heading', (await missionName(d)) === 'E2E plan' && (await d.ev(`return document.querySelector(arguments[0]).value`, headingSel)) === poiValue);
  });

  await step('Per-waypoint overrides: altitude, speed, heading, gimbal, hold, action', async () => {
    await toList(d);
    await d.click('[aria-label="Edit waypoint 2"]');
    await d.click(await field(d, 'Use mission default', 0));
    await d.fill(await field(d, 'Altitude'), '75');
    // After the first toggle is off, the remaining "Use mission default" is the speed one.
    await d.click(await field(d, 'Use mission default', 1));
    await d.fill(await field(d, 'Speed'), '9');
    await d.select(await field(d, 'Drone heading from here'), 'custom');
    await d.fill(await field(d, 'Heading (0°'), '135');
    await d.select(await field(d, 'Gimbal pitch'), 'pitch');
    await d.fill(await field(d, 'Pitch (0°'), '-45');
    await d.fill(await field(d, 'Hold time'), '4');
    await d.select(await field(d, 'Camera action'), 'photo');
    await d.click('.editor-head .btn');
    const row = await text(d, '[aria-label="Edit waypoint 2"]');
    check('Per-waypoint overrides: altitude, speed, heading, gimbal, hold, action', /75 m/.test(row) && /9 m\/s/.test(row) && /135°/.test(row) && /hold 4s/.test(row) && /take photo/.test(row), row);
  });

  await step('Undo and redo', async () => {
    await d.click('[aria-label="Undo"]');
    const undone = await text(d, '[aria-label="Edit waypoint 2"]');
    await d.click('[aria-label="Redo"]');
    const redone = await text(d, '[aria-label="Edit waypoint 2"]');
    let keys = 'not run (touch screen)';
    if (!d.touch) {
      await d.press('Control+z');
      const k1 = await text(d, '[aria-label="Edit waypoint 2"]');
      await d.press('Control+Shift+z');
      const k2 = await text(d, '[aria-label="Edit waypoint 2"]');
      keys = !/take photo/.test(k1) && /take photo/.test(k2) ? 'keyboard shortcuts work' : 'KEYBOARD SHORTCUTS FAILED';
    }
    check('Undo and redo', !/take photo/.test(undone) && /take photo/.test(redone) && !/FAILED/.test(keys), keys);
  });

  await step('Drag a waypoint to reposition it', async () => {
    const before = await stats(d);
    const from = await center(d, '.wp-marker[data-index="3"]');
    await d.drag(from, { x: from.x + 40, y: from.y + 36 });
    await sleep(300);
    const after = await stats(d);
    const now = await center(d, '.wp-marker[data-index="3"]');
    const moved = Math.hypot(now.x - from.x, now.y - from.y);
    await d.click('[aria-label="Undo"]');
    await sleep(200);
    const undone = await stats(d);
    await d.click('[aria-label="Redo"]');
    await sleep(200);
    check(
      'Drag a waypoint to reposition it',
      moved > 30 && after.distance !== before.distance && undone.distance === before.distance && (await stat(d, 'distance')) === after.distance,
      `marker moved ${Math.round(moved)}px (${d.touch ? 'touch' : 'mouse'}), distance ${before.distance} → ${after.distance}, one undo step restores it`,
    );
    await d.ev(`document.querySelector('.maplibregl-canvas').blur()`);
  });

  await step('Reorder waypoints', async () => {
    await toList(d);
    const before = await stats(d);
    await d.click('[aria-label="Move waypoint 3 earlier"]');
    await sleep(200);
    const swapped = await stats(d);
    const row2 = await text(d, '[aria-label="Edit waypoint 3"]');
    await d.click('[aria-label="Move waypoint 2 later"]');
    await sleep(200);
    const back = await stats(d);
    check('Reorder waypoints', swapped.distance !== before.distance && /hold 4s/.test(row2) && back.distance === before.distance && back.duration === before.duration, `${before.distance} → ${swapped.distance} → ${back.distance}`);
  });

  await step('Preview: play, pause, scrub, playback speed', async () => {
    await tab(d, 2);
    await until(d, `return document.querySelectorAll('.drone-marker').length === 1`, 'drone marker');
    const start = await center(d, '.drone-marker');
    await d.click('[aria-label="Play"]');
    await sleep(1500);
    await d.click('[aria-label="Pause"]');
    const t1 = secs(await text(d, '[data-testid="preview-time"]'));
    await sleep(400);
    const t2 = secs(await text(d, '[data-testid="preview-time"]'));
    const moved = await center(d, '.drone-marker');
    // Scrub by clicking the slider about 45% along.
    const r = await d.ev(`const r = document.querySelector('.scrub').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }`);
    await d.tapAt(r.x + r.w * 0.45, r.y + r.h / 2);
    await sleep(300);
    const mid = { time: secs(await text(d, '[data-testid="preview-time"]')), wp: await text(d, '[data-testid="tm-waypoint"]'), alt: await text(d, '[data-testid="tm-altitude"]'), hdg: await text(d, '[data-testid="tm-heading"]') };
    const total = secs(await stat(d, 'duration'));
    // Fastest playback to the end.
    await d.click('[aria-label="Playback speed"] button:nth-child(5)');
    await d.click('[aria-label="Play"]');
    await until(d, `return /Finished at 3/.test(document.querySelector('[data-testid="tm-waypoint"]').textContent)`, 'preview to finish', 30000);
    const flown = await d.ev(`return [...document.querySelectorAll('.telemetry div')].find((x) => x.querySelector('dt').textContent === 'Flown').querySelector('dd').textContent`);
    const dist = await stat(d, 'distance');
    check(
      'Preview: play, pause, scrub, playback speed',
      t1 > 0 && t2 === t1 && Math.hypot(moved.x - start.x, moved.y - start.y) > 3 && mid.time > total * 0.25 && mid.time < total * 0.65 && /Flying|Holding/.test(mid.wp) && /above takeoff/.test(mid.alt) && /\d+°/.test(mid.hdg) && flown.replace(/\s+/g, ' ').startsWith(`${dist} of ${dist}`),
      `paused at ${t1}s; scrubbed to ${mid.time}s of ${total}s: ${mid.wp}, ${mid.alt}, heading ${mid.hdg}; finished with ${flown.replace(/\s+/g, ' ')}`,
    );
  });

  let saved;
  await step('Reload recovers the mission', async () => {
    await toList(d);
    saved = { ...(await stats(d)), name: await missionName(d), row: await text(d, '[aria-label="Edit waypoint 2"]') };
    await sleep(700);
    await d.reload();
    await until(d, `return document.querySelectorAll('.wp-marker').length === 3 && document.querySelectorAll('.poi-marker').length === 1`, 'markers after reload', 20000);
    const now = { ...(await stats(d)), name: await missionName(d), row: await text(d, '[aria-label="Edit waypoint 2"]') };
    check('Reload recovers the mission', JSON.stringify(now) === JSON.stringify(saved), `${now.name}: ${now.waypoints} waypoints, ${now.distance}, ${now.duration}`);
  });

  let file1;
  await step('Export the mission file', async () => {
    await d.click('[aria-label="Export and import"]');
    file1 = await d.download(() => clickText(d, 'Save mission file'));
    const data = JSON.parse(file1.text);
    const m = data.mission;
    const w = m.waypoints[1];
    const e = expected(m);
    const shown = await stats(d);
    const settingsOk =
      data.format === 'waypath.mission' && data.version === 1 && m.name === 'E2E plan' && m.waypoints.length === 3 && m.pois.length === 1 &&
      m.defaults.speedMps === 4 && m.defaults.heading.mode === 'poi' && m.defaults.heading.poiId === m.pois[0].id &&
      w.altitudeM === 75 && w.speedMps === 9 && w.heading.mode === 'custom' && w.heading.deg === 135 && w.gimbal.mode === 'pitch' && w.gimbal.deg === -45 && w.holdSec === 4 && w.action === 'photo';
    const mathOk = Math.abs(secs(shown.duration) - e.time) <= 1 && shown.distance === (e.dist < 1000 ? `${Math.round(e.dist)} m` : `${(e.dist / 1000).toFixed(2)} km`);
    check('Export the mission file', settingsOk && /\.waypath\.json$/.test(file1.name), `${file1.name}, ${file1.text.length} bytes${file1.real ? ', saved through the browser download' : ', captured as the page handed it to the browser'}`);
    check('Distance and time match an independent calculation', mathOk, `file gives ${Math.round(e.dist)} m and ${fmtDuration(e.time)}; app shows ${shown.distance} and ${shown.duration}`);
  });

  await step('Export KML', async () => {
    const kml = await d.download(() => clickText(d, 'Save KML'));
    check('Export KML', /\.kml$/.test(kml.name) && kml.text.startsWith('<?xml') && (kml.text.match(/<Placemark>/g) || []).length === 5 && kml.text.includes('<LineString>'), `${kml.name}, 3 waypoints + 1 POI + route line`);
  });

  await step('Reimport keeps every setting', async () => {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'waypath-e2e-')), file1.name);
    fs.writeFileSync(tmp, file1.text);
    await d.upload('.dialog input[type="file"]', tmp);
    await until(d, `return document.querySelector('.mission-name').textContent === 'E2E plan (imported)'`, 'imported mission to open');
    await until(d, `return document.querySelectorAll('.wp-marker').length === 3`, 'imported markers');
    const now = await stats(d);
    if (await count(d, '.dialog')) await d.click('.dialog [aria-label="Close"]');
    await d.click('[aria-label="Export and import"]');
    const file2 = await d.download(() => clickText(d, 'Save mission file'));
    await d.click('.dialog [aria-label="Close"]');
    const same = JSON.stringify(settingsOf(file1.text)) === JSON.stringify(settingsOf(file2.text));
    check('Reimport keeps every setting', same && now.distance === saved.distance && now.duration === saved.duration, same ? 're-exported file is identical apart from id, name and timestamp' : 'FILES DIFFER');
  });

  await step('Rename, duplicate, reopen and delete missions', async () => {
    await d.click('.mission-btn');
    await d.click('[aria-label="Rename E2E plan (imported)"]');
    await d.fill('.rename input', 'Renamed plan');
    await clickText(d, 'Save');
    await until(d, `return document.querySelector('.mission-name').textContent === 'Renamed plan'`, 'rename');
    await d.click('[aria-label="Duplicate Renamed plan"]');
    await until(d, `return document.querySelector('.mission-name').textContent === 'Renamed plan copy'`, 'duplicate');
    const copy = await stats(d);
    await d.click('.mission-btn');
    const listed = await d.ev(`return [...document.querySelectorAll('.mission-list .row-title')].map((e) => e.textContent)`);
    await d.click('[aria-label="Open E2E plan"]');
    await until(d, `return document.querySelector('.mission-name').textContent === 'E2E plan'`, 'reopen');
    const reopened = await stats(d);
    await d.click('.mission-btn');
    await d.click('[aria-label="Delete Renamed plan"]');
    await clickText(d, 'Delete?');
    await until(d, `return ![...document.querySelectorAll('.mission-list .row-title')].some((e) => e.textContent === 'Renamed plan')`, 'delete');
    await d.click('.dialog [aria-label="Close"]');
    check(
      'Rename, duplicate, reopen and delete missions',
      copy.distance === saved.distance && reopened.duration === saved.duration && ['Renamed plan copy', 'Renamed plan', 'E2E plan'].every((n) => listed.includes(n)) && listed.some((n) => n.startsWith('Sample')),
      `list had: ${listed.join(', ')}`,
    );
  });

  await step('Smooth turns use the same path for totals and preview', async () => {
    await d.click('.mission-btn');
    await d.click('[aria-label="Open Renamed plan copy"]');
    await until(d, `return document.querySelector('.mission-name').textContent === 'Renamed plan copy'`, 'open copy');
    await toList(d);
    await d.click('[aria-label="Edit waypoint 2"]');
    await d.fill(await field(d, 'Hold time'), '0');
    await d.select(await field(d, 'Camera action'), 'none');
    await d.click('.editor-head .btn');
    const straight = await stats(d);
    await tab(d, 3);
    await clickText(d, 'Smooth turns');
    await d.fill(await field(d, 'Start turning this far'), '40');
    await sleep(250);
    const curved = await stats(d);
    await tab(d, 2);
    await d.click('[aria-label="Playback speed"] button:nth-child(5)');
    await d.click('[aria-label="Play"]');
    await until(d, `return /Finished at 3/.test(document.querySelector('[data-testid="tm-waypoint"]').textContent)`, 'curved preview to finish', 30000);
    const flown = (await d.ev(`return [...document.querySelectorAll('.telemetry div')].find((x) => x.querySelector('dt').textContent === 'Flown').querySelector('dd').textContent`)).replace(/\s+/g, ' ');
    const clock = await text(d, '.clock');
    const num = (s) => parseFloat(s) * (/km/.test(s) ? 1000 : 1);
    check(
      'Smooth turns use the same path for totals and preview',
      num(curved.distance) < num(straight.distance) && secs(curved.duration) <= secs(straight.duration) && flown.startsWith(`${curved.distance} of ${curved.distance}`) && clock.replace(/\s+/g, ' ') === `${curved.duration} / ${curved.duration}`,
      `straight ${straight.distance} / ${straight.duration} → curved ${curved.distance} / ${curved.duration}; preview ended at ${flown}, ${clock.replace(/\s+/g, ' ')}`,
    );
  });

  await step('Above-ground mode is only offered with terrain data', async () => {
    await tab(d, 3);
    await sleep(1200);
    const s = await d.ev(`
      const b = [...document.querySelectorAll('[aria-label="Altitude reference"] button')].find((x) => /AGL/.test(x.textContent));
      const m = [...document.querySelectorAll('label')].map((l) => l.textContent).find((t) => t.startsWith('Altitude '));
      return { disabled: b.disabled, status: document.querySelector('[data-testid="elevation-status"]').textContent, label: m };`);
    const hasTerrain = /Terrain data is loaded/.test(s.status);
    check('Above-ground mode is only offered with terrain data', s.disabled === !hasTerrain && /above takeoff point/.test(s.label), hasTerrain ? 'terrain loaded here, so the option is on' : 'no terrain data reachable here, so the option is off and the label reads “above takeoff point”');
  });

  if (viewport.rotate) {
    await step('Rotating the screen keeps the plan and controls', async () => {
      await d.setViewport({ width: viewport.height, height: viewport.width });
      await sleep(500);
      const l = await d.ev(`
        const inView = (sel) => [...document.querySelectorAll(sel)].every((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
        const s = document.querySelector('.stage').getBoundingClientRect();
        return { ok: inView('.topbar button, .toolbar button, .map-tools button, .panel-head, .tabs button'), mapW: s.width, mapH: s.height, markers: document.querySelectorAll('.wp-marker').length, w: innerWidth, h: innerHeight };`);
      check('Rotating the screen keeps the plan and controls', l.ok && l.markers === 3 && l.mapW >= 200 && l.mapH >= 200, `${l.w}×${l.h}, map ${Math.round(l.mapW)}×${Math.round(l.mapH)}`);
    });
  }

  const size = await d.ev('return { w: innerWidth, h: innerHeight }');
  if (!viewport.rotate && (size.w !== viewport.width || size.h !== viewport.height)) record('Screen size', true, `the browser window gave ${size.w}×${size.h} instead of ${viewport.width}×${viewport.height}`);
  check('No script errors during the run', d.errors.length === 0, d.errors.slice(0, 2).join(' | '));
}
