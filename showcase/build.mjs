/* build.mjs — inlines css/ and js/ into a single self-contained HTML file.
   node build.mjs            → dist/index.html   (complete document)
   node build.mjs --fragment → dist/fragment.html (no doctype/html/head/body,
                               for hosts that wrap the page themselves) */
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(here, p), 'utf8');
let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, p) => `<style data-core>\n${read(p)}\n</style>`);
html = html.replace(/<script ([^>]*?)src="(js\/[^"]+)"><\/script>/g, (_, attrs, p) => `<script ${attrs.trim()}>\n${read(p)}\n</script>`);
if (process.argv.includes('--fragment')) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>|<meta name="viewport"[^>]*>/g, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = head.trim() + '\n' + body.trim() + '\n';
}
fs.mkdirSync(path.join(here, 'dist'), { recursive: true });
const out = process.argv.includes('--fragment') ? 'dist/fragment.html' : 'dist/index.html';
fs.writeFileSync(path.join(here, out), html);
console.log(`${out}: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB, ${html.split('\n').length} lines`);
