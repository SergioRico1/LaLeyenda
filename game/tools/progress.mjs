#!/usr/bin/env node
// Builds the live progress page from progress/status.json plus whatever
// screenshots the rounds reference. Images are inlined so the page can be
// published as a single self-contained file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const STATUS = path.join(ROOT, 'progress', 'status.json');
const OUT = path.join(ROOT, 'progress', 'index.html');

const status = JSON.parse(fs.readFileSync(STATUS, 'utf8'));

const inlined = new Map();
async function dataUri(rel, width = 900) {
  if (!rel) return null;
  if (inlined.has(rel)) return inlined.get(rel);
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  const buf = await sharp(file).resize(width, null, { withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const uri = `data:image/webp;base64,${buf.toString('base64')}`;
  inlined.set(rel, uri);
  return uri;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STATE_LABEL = { done: 'wins the blind test', in_progress: 'in progress', pending: 'not started' };

const sections = [];
for (const piece of status.pieces) {
  const barShot = /\.(png|jpg)$/.test(piece.bar ?? '') ? await dataUri(piece.bar) : null;
  const rounds = [];
  for (const round of piece.rounds) {
    const shot = await dataUri(round.shot);
    rounds.push(`
      <li class="round">
        <div class="round-head"><span class="badge">Round ${round.n}</span></div>
        <p class="summary">${esc(round.summary)}</p>
        ${round.gap ? `<p class="gap"><strong>Biggest remaining gap:</strong> ${esc(round.gap)}</p>` : ''}
        ${
          shot
            ? `<div class="compare">
                 <figure><img src="${shot}" alt="our output"><figcaption>Ours</figcaption></figure>
                 ${barShot ? `<figure><img src="${barShot}" alt="the bar"><figcaption>The bar</figcaption></figure>` : ''}
               </div>`
            : ''
        }
      </li>`);
  }

  sections.push(`
    <section class="piece" id="${esc(piece.id)}">
      <header>
        <h2>${esc(piece.name)}</h2>
        <span class="state state-${esc(piece.status)}">${esc(STATE_LABEL[piece.status] ?? piece.status)}</span>
      </header>
      <p class="piece-bar"><strong>Bar:</strong> ${esc(/\.(png|jpg)$/.test(piece.bar ?? '') ? 'blind A/B against ' + piece.bar : piece.bar)}</p>
      ${rounds.length ? `<ol class="rounds">${rounds.join('')}</ol>` : '<p class="empty">No rounds yet.</p>'}
    </section>`);
}

const done = status.pieces.filter((p) => p.status === 'done').length;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(status.title)}</title>
<style>
  :root {
    --bg: #f4f1ea; --panel: #fffdf8; --ink: #241a12; --muted: #6c5c4c;
    --line: #ded5c6; --accent: #1f7a8c; --warn: #c26b1c; --ok: #3f8f3f;
  }
  :root:not([data-theme="light"]) { color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #14110e; --panel: #1e1a15; --ink: #f0e8dc; --muted: #a08f7c;
      --line: #342d24; --accent: #4fc3d9; --warn: #e39a4a; --ok: #6fc46f;
    }
  }
  :root[data-theme="dark"] {
    --bg: #14110e; --panel: #1e1a15; --ink: #f0e8dc; --muted: #a08f7c;
    --line: #342d24; --accent: #4fc3d9; --warn: #e39a4a; --ok: #6fc46f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
  h1 { font-size: clamp(1.6rem, 4vw, 2.3rem); margin: 0 0 .4rem; letter-spacing: -.01em; }
  .lede { color: var(--muted); margin: 0 0 .3rem; }
  .barline {
    margin: 1.25rem 0 2.5rem; padding: .9rem 1.1rem; background: var(--panel);
    border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 6px;
  }
  .barline strong { color: var(--accent); }
  .piece { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 1.25rem 1.4rem; margin-bottom: 1.5rem; }
  .piece header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  .piece h2 { font-size: 1.2rem; margin: 0; }
  .state { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; padding: .2rem .6rem; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
  .state-done { color: var(--ok); border-color: var(--ok); }
  .state-in_progress { color: var(--warn); border-color: var(--warn); }
  .piece-bar { color: var(--muted); font-size: .92rem; margin: .5rem 0 1rem; }
  .rounds { list-style: none; margin: 0; padding: 0; }
  .round { border-top: 1px solid var(--line); padding: 1rem 0 .4rem; }
  .badge { font-size: .78rem; font-weight: 600; letter-spacing: .04em; color: var(--accent); text-transform: uppercase; }
  .summary { margin: .4rem 0 .5rem; }
  .gap { margin: .4rem 0 .8rem; color: var(--muted); font-size: .95rem; }
  .compare { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: .9rem; margin: .8rem 0 .4rem; }
  figure { margin: 0; }
  figure img { width: 100%; height: auto; display: block; border-radius: 6px; border: 1px solid var(--line); }
  figcaption { font-size: .8rem; color: var(--muted); margin-top: .35rem; text-align: center; }
  .empty { color: var(--muted); font-style: italic; margin: .5rem 0 0; }
  footer { color: var(--muted); font-size: .85rem; margin-top: 2.5rem; text-align: center; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>${esc(status.title)}</h1>
    <p class="lede">${esc(status.goal)}</p>
    <div class="barline"><strong>The bar:</strong> ${esc(status.bar)}</div>
    <p class="lede">${done} of ${status.pieces.length} pieces currently win the blind comparison.</p>
    ${sections.join('')}
    <footer>Built from progress/status.json — regenerate with <code>node tools/progress.mjs</code></footer>
  </div>
</body>
</html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`${path.relative(ROOT, OUT)} (${(html.length / 1024).toFixed(0)}KB)`);
