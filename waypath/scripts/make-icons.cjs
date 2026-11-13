// Renders public/icon.svg to the PNG sizes the manifest and iOS need. Run: node scripts/make-icons.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../public/icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shots = [
    ['icon-192.png', 192, 1],
    ['icon-512.png', 512, 1],
    ['apple-touch-icon.png', 180, 1],
    // Maskable icons keep the artwork inside the central safe zone.
    ['icon-maskable-512.png', 512, 0.72],
  ];
  for (const [name, size, scale] of shots) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;background:#0b5d4a;display:grid;place-items:center;height:100vh"><div style="width:${size * scale}px;height:${size * scale}px">${svg}</div></body>`,
    );
    await page.screenshot({ path: path.join(__dirname, '../public', name) });
  }
  await browser.close();
})();
