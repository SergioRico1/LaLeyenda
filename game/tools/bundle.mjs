#!/usr/bin/env node
// What the player actually downloads, measured rather than remembered.
//
//   node tools/bundle.mjs              build, then measure everything in dist/
//   node tools/bundle.mjs --no-build   measure the dist/ that is already there
//   node tools/bundle.mjs --boot       ALSO drive a real browser over the built
//                                      files and record what each screen fetches
//   node tools/bundle.mjs --json p     write the same numbers as JSON
//
// WHY THIS FILE EXISTS. PRODUCTION.md §7 carries three numbers and has been
// wrong about one of them for several rounds — it recorded 436 draw calls long
// after a round measured 132. A number typed into a checklist by hand goes
// stale the first time anybody changes anything, and a stale number in a
// release checklist is worse than no number, because it is believed. Everything
// below is re-derivable in one command so the figure in the document can be
// replaced instead of defended.
//
// THE THREE TOTALS, AND WHY THERE ARE THREE.
//
//   raw     bytes on disk. This is what a Capacitor/App Store build carries
//           inside the .ipa, because a native shell does not negotiate
//           Content-Encoding with itself — it reads files off the filesystem.
//   gzip    what a web player downloads from a server with gzip on.
//   brotli  the same player on any browser of the last eight years, from a
//           server with brotli on.
//
// These differ by a factor of three here and the difference decides whether we
// pass §7's 10 MB budget, so reporting one number without saying which one it
// is would be dishonest. The models are voxel meshes with vertex colours and no
// textures, which is the best case for a general-purpose compressor: they
// shrink to a fifth. Fonts and .webp are already compressed and do not move.
//
// TOTAL vs BOOT. The total below is every byte in dist/ — the number that
// matters for an app bundle, where everything ships whether it is opened or
// not. A web player fetches far less, because models load per scene. `--boot`
// measures that second number the only honest way: it serves the BUILT files,
// drives a real browser to each screen, and records every request the page
// actually made. Nothing is assumed about which model belongs to which scene.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DIST = path.join(ROOT, 'dist');

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

// An unknown flag is an ERROR, never a shrug — see the same block in
// tools/perf.mjs for the four times this project has paid for the alternative.
const KNOWN = new Set(['--no-build', '--boot', '--json']);
const unknown = argv.filter((a) => a.startsWith('--') && !KNOWN.has(a));
if (unknown.length) {
  console.error(`unknown flag: ${unknown.join(', ')}\n  known: ${[...KNOWN].join(' ')}`);
  process.exit(2);
}

/** §7's budget, in bytes. Ten megabytes, counted as the store counts them. */
const BUDGET = 10 * 1024 * 1024;

const kb = (n) => (n / 1024).toFixed(1);
const mb = (n) => (n / (1024 * 1024)).toFixed(2);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

// ---------------------------------------------------------------------------
// 1 · Build, unless told not to.
//
// Building by default is the point of the tool: a dist/ left over from three
// commits ago measures a game nobody is shipping. `--no-build` exists for the
// case where the caller has just built and wants the numbers again in a second.

if (!has('no-build')) {
  process.stdout.write('building...');
  try {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(' ok\n\n');
  } catch (e) {
    process.stdout.write(' FAILED\n\n');
    console.error(String(e.stdout ?? '') + String(e.stderr ?? ''));
    process.exit(1);
  }
}

if (!fs.existsSync(DIST)) {
  console.error('no dist/ — run without --no-build');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2 · Weigh every file three ways.

/** Every file under dist/, as paths relative to dist/. */
const walk = (dir, base = dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
};

/**
 * Which budget line a file belongs to.
 *
 * Ordered by how a reader thinks about the download rather than by extension:
 * the code, the look, the world, and the two kinds of picture. `models` is
 * deliberately its own class because it is 95% of the bytes and every
 * conversation about the budget is really a conversation about it.
 */
const classOf = (rel) => {
  const ext = path.extname(rel).toLowerCase();
  if (ext === '.js' || ext === '.mjs') return 'js';
  if (ext === '.css') return 'css';
  if (ext === '.html') return 'html';
  if (ext === '.glb' || ext === '.gltf') return 'models';
  if (ext === '.woff2' || ext === '.woff' || ext === '.ttf') return 'fonts';
  if (['.webp', '.png', '.jpg', '.jpeg', '.svg', '.ktx2', '.basis'].includes(ext)) return 'textures';
  if (ext === '.json') return 'json';
  return 'other';
};

const files = walk(DIST).map((rel) => {
  const bytes = fs.readFileSync(path.join(DIST, rel));
  return {
    rel,
    class: classOf(rel),
    raw: bytes.length,
    // Level 6 is what nginx, Vercel and every CDN default to. Level 9 would
    // flatter the number by a percent or two and describe nobody's server.
    gzip: zlib.gzipSync(bytes, { level: 6 }).length,
    brotli: zlib.brotliCompressSync(bytes).length,
  };
});

const sum = (rows, key) => rows.reduce((a, r) => a + r[key], 0);
const total = { raw: sum(files, 'raw'), gzip: sum(files, 'gzip'), brotli: sum(files, 'brotli') };

const CLASSES = ['js', 'css', 'html', 'models', 'fonts', 'textures', 'json', 'other'];
const byClass = CLASSES
  .map((c) => {
    const rows = files.filter((f) => f.class === c);
    return { class: c, n: rows.length, raw: sum(rows, 'raw'), gzip: sum(rows, 'gzip'), brotli: sum(rows, 'brotli') };
  })
  .filter((r) => r.n > 0);

console.log('EVERY BYTE IN dist/ — what an app bundle carries\n');
console.log(`  ${pad('class', 10)}${lpad('files', 6)}${lpad('raw', 12)}${lpad('gzip', 12)}${lpad('brotli', 12)}`);
console.log(`  ${'-'.repeat(52)}`);
for (const r of byClass) {
  console.log(`  ${pad(r.class, 10)}${lpad(r.n, 6)}${lpad(kb(r.raw) + ' KB', 12)}${lpad(kb(r.gzip) + ' KB', 12)}${lpad(kb(r.brotli) + ' KB', 12)}`);
}
console.log(`  ${'-'.repeat(52)}`);
console.log(`  ${pad('TOTAL', 10)}${lpad(files.length, 6)}${lpad(mb(total.raw) + ' MB', 12)}${lpad(mb(total.gzip) + ' MB', 12)}${lpad(mb(total.brotli) + ' MB', 12)}`);

// ---------------------------------------------------------------------------
// 3 · The code and the chrome, chunk by chunk.
//
// Separated from the models because they are the part a code change moves. If
// this table grows by 200 KB between two rounds, somebody imported a library.

console.log('\nCODE AND CHROME, by chunk\n');
const code = files.filter((f) => f.class === 'js' || f.class === 'css' || f.class === 'html')
  .sort((a, b) => b.gzip - a.gzip);
console.log(`  ${pad('file', 34)}${lpad('raw', 12)}${lpad('gzip', 12)}${lpad('brotli', 12)}`);
console.log(`  ${'-'.repeat(70)}`);
for (const f of code) {
  console.log(`  ${pad(f.rel, 34)}${lpad(kb(f.raw) + ' KB', 12)}${lpad(kb(f.gzip) + ' KB', 12)}${lpad(kb(f.brotli) + ' KB', 12)}`);
}

// ---------------------------------------------------------------------------
// 4 · The heaviest models.

const models = files.filter((f) => f.class === 'models').sort((a, b) => b.gzip - a.gzip);
console.log(`\nHEAVIEST MODELS (${models.length} total)\n`);
console.log(`  ${pad('file', 34)}${lpad('raw', 12)}${lpad('gzip', 12)}${lpad('brotli', 12)}`);
console.log(`  ${'-'.repeat(70)}`);
for (const f of models.slice(0, 12)) {
  console.log(`  ${pad(path.basename(f.rel), 34)}${lpad(kb(f.raw) + ' KB', 12)}${lpad(kb(f.gzip) + ' KB', 12)}${lpad(kb(f.brotli) + ' KB', 12)}`);
}

// ---------------------------------------------------------------------------
// 5 · Models nothing in the game asks for.
//
// A fetched-but-unused model is pure weight: it ships in the app bundle, it
// costs a store reviewer's download, and no player will ever see it.

const SEARCHED = [path.join(ROOT, 'src'), path.join(ROOT, 'tools', 'acts.mjs'), path.join(ROOT, 'index.html')]
  .filter((p) => fs.existsSync(p));

// Two corpora, because "the source mentions it" is not the same claim as "the
// source loads it". `bldg_foundry` is why: 386 KB of model whose every
// appearance in src/ is a doc-comment example or a note explaining that the
// building was swapped for the blacksmith. A plain text search calls that used.
//
// So: search the source as written, and search it again with comments removed —
// line and block comments in TS/JS, and the `$`-prefixed note fields the
// balance data uses for the same purpose. A model that survives only in the
// first corpus is named in prose and loaded by nothing.
const stripProse = (text, file) => {
  if (file.endsWith('.json')) {
    // `"$modelNote": "... bldg_foundry ..."` is a comment that JSON cannot
    // spell. The convention is a leading $ on the key; honour it.
    return text.replace(/"\$[^"]*"\s*:\s*"(?:[^"\\]|\\.)*"/g, '""');
  }
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
};

const corpora = (() => {
  const asWritten = [];
  const codeOnly = [];
  const readAll = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const e of fs.readdirSync(p)) readAll(path.join(p, e)); return; }
    const text = fs.readFileSync(p, 'utf8');
    asWritten.push(text);
    codeOnly.push(stripProse(text, p));
  };
  for (const p of SEARCHED) readAll(p);
  return { asWritten: asWritten.join('\n'), codeOnly: codeOnly.join('\n') };
})();

const withId = models.map((f) => ({ id: path.basename(f.rel, '.glb'), ...f }));
const unused = withId.filter((m) => !corpora.asWritten.includes(m.id));
const proseOnly = withId.filter((m) => corpora.asWritten.includes(m.id) && !corpora.codeOnly.includes(m.id));

const deadTable = (title, rows, note) => {
  if (!rows.length) { console.log(`\n${title} — none`); return; }
  const t = { raw: sum(rows, 'raw'), gzip: sum(rows, 'gzip') };
  console.log(`\n${title} — ${rows.length} files, ${kb(t.raw)} KB raw / ${kb(t.gzip)} KB gzip\n`);
  for (const m of rows) {
    console.log(`  ${pad(m.id, 34)}${lpad(kb(m.raw) + ' KB', 12)}${lpad(kb(m.gzip) + ' KB', 12)}`);
  }
  if (note) console.log(`\n  ${note}`);
};

deadTable('MODELS NO SOURCE FILE NAMES AT ALL', unused,
  'Text search over src/. It errs safe: an id assembled at runtime would be listed\n  here for a human to check rather than silently dropped.');
deadTable('MODELS NAMED ONLY IN COMMENTS AND NOTES', proseOnly,
  'Every appearance is a doc-comment example or a note. Nothing loads these — but\n  check by hand before deleting, because a comment can also be the last trace of\n  something a URL parameter still reaches.');

const deletable = [...unused, ...proseOnly];
if (deletable.length) {
  console.log(`\n  Both lists together: ${deletable.length} models, ` +
    `${kb(sum(deletable, 'raw'))} KB raw / ${kb(sum(deletable, 'gzip'))} KB gzip — ` +
    `${((sum(deletable, 'raw') / total.raw) * 100).toFixed(1)}% of the bundle.`);
}

// ---------------------------------------------------------------------------
// 6 · What a boot actually fetches. Only with --boot.
//
// Everything above is a property of the directory. This is a property of the
// GAME, and the two are different numbers: a web player never downloads the
// eleven building models they have not unlocked. The only trustworthy way to
// separate them is to run it, so this serves the built output over a real
// socket, points a real browser at each screen, and writes down every request.

const boot = has('boot') ? await measureBoot() : null;

async function measureBoot() {
  const { chromium } = await import('playwright');

  // Own static server rather than `vite preview`: this one is thirty lines, has
  // no config, and — more to the point — a request it serves is a request the
  // page made, with nothing injected, transformed or pre-bundled on the way.
  const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.glb': 'model/gltf-binary',
    '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png',
  };
  const byPath = new Map(files.map((f) => ['/' + f.rel.split(path.sep).join('/'), f]));

  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/') url = '/index.html';
    const hit = byPath.get(url);
    if (!hit) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', TYPES[path.extname(url)] ?? 'application/octet-stream');
    res.end(fs.readFileSync(path.join(DIST, hit.rel)));
  });

  const port = await new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
  await new Promise((resolve) => server.listen(port, resolve));

  const preinstalled = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
    .find((p) => fs.existsSync(p));
  const browser = await chromium.launch({
    ...(preinstalled ? { executablePath: preinstalled } : {}),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  // The screens a first session walks, in the order it walks them. `island` is
  // measured twice because a save with eleven buildings pulls eleven models a
  // day-one save does not, and §7's budget has to survive the second one.
  const SCREENS = [
    ['title', 'screen=title'],
    ['captain', 'screen=captain'],
    ['island day one', 'screen=island'],
    ['island demo', 'screen=island&save=demo'],
    ['sea', 'screen=sea'],
  ];

  const results = [];
  /** Every distinct file any screen asked for, for the union row below. */
  const everAsked = new Map();
  try {
    for (const [label, query] of SCREENS) {
      // A fresh context per screen, so nothing is warm: this is a cold cache
      // every time, which is the only cache a first-time player has.
      const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const got = new Map();
      page.on('response', (r) => {
        const u = new URL(r.url());
        if (u.port !== String(port)) return;
        let p = decodeURIComponent(u.pathname);
        if (p === '/') p = '/index.html';
        const hit = byPath.get(p);
        if (hit) got.set(hit.rel, hit);
      });

      const url = `http://localhost:${port}/?${query}&shot=1&w=430&h=932&t=2.0`;
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.__ready === true || window.__error, { timeout: 120000 })
        .catch(() => {});
      // A scene can keep streaming after it says it is ready — the sea pulls
      // sites in as the ship moves. Give the network a moment to go quiet so
      // the count is the whole first look at the screen, not the first frame.
      await page.waitForTimeout(2500);

      const rows = [...got.values()];
      for (const r of rows) everAsked.set(r.rel, r);
      results.push({
        screen: label,
        n: rows.length,
        models: rows.filter((r) => r.class === 'models').length,
        raw: sum(rows, 'raw'),
        gzip: sum(rows, 'gzip'),
        brotli: sum(rows, 'brotli'),
      });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  // The rows above each start from an empty cache, so they double-count the
  // code every screen shares. A real first session walks title → captain →
  // island → sea in ONE browser, and the second screen does not re-fetch what
  // the first already has: the union of the sets is what that session costs.
  // Sound because vite content-hashes its filenames — same name, same bytes.
  const union = [...everAsked.values()];
  results.push({
    screen: 'first session',
    n: union.length,
    models: union.filter((r) => r.class === 'models').length,
    raw: sum(union, 'raw'),
    gzip: sum(union, 'gzip'),
    brotli: sum(union, 'brotli'),
    union: true,
  });

  console.log('\nWHAT A COLD BOOT ACTUALLY FETCHES — recorded from a real browser\n');
  console.log(`  ${pad('screen', 18)}${lpad('reqs', 6)}${lpad('models', 8)}${lpad('raw', 12)}${lpad('gzip', 12)}${lpad('brotli', 12)}`);
  console.log(`  ${'-'.repeat(68)}`);
  for (const r of results) {
    if (r.union) console.log(`  ${'-'.repeat(68)}`);
    console.log(`  ${pad(r.screen, 18)}${lpad(r.n, 6)}${lpad(r.models, 8)}${lpad(kb(r.raw) + ' KB', 12)}${lpad(kb(r.gzip) + ' KB', 12)}${lpad(kb(r.brotli) + ' KB', 12)}`);
  }
  console.log('\n  Each screen row is a COLD cache. The last row is the union — one');
  console.log('  browser walking all four, which is what a first session really pays.');
  return results;
}

// ---------------------------------------------------------------------------
// 7 · The verdict.
//
// Judged on gzip, because that is what the web player — the one we can actually
// ship to today — downloads. The raw figure is printed beside it because it is
// the one an .ipa carries, and it is the one that fails first.

console.log('\n' + '='.repeat(72));
const okGzip = total.gzip <= BUDGET;
const okRaw = total.raw <= BUDGET;
console.log(`initial download ${mb(total.gzip)} MB gzipped / ${mb(total.brotli)} MB brotli / ${mb(total.raw)} MB raw`);
console.log(`budget ${mb(BUDGET)} MB — gzip ${okGzip ? 'OK' : 'OVER'}, raw ${okRaw ? 'OK' : 'OVER'}`);
if (!okRaw) {
  console.log(`\nraw is over by ${mb(total.raw - BUDGET)} MB. That is the number a Capacitor`);
  console.log('build carries and the number a server with compression off would send.');
}

if (flag('json')) {
  fs.writeFileSync(flag('json'), JSON.stringify({
    measured: new Date().toISOString(),
    budget: BUDGET,
    total,
    byClass,
    files: files.map(({ rel, class: c, raw, gzip, brotli }) => ({ rel, class: c, raw, gzip, brotli })),
    unused: unused.map((u) => ({ id: u.id, raw: u.raw, gzip: u.gzip })),
    proseOnly: proseOnly.map((u) => ({ id: u.id, raw: u.raw, gzip: u.gzip })),
    deletable: { n: deletable.length, raw: sum(deletable, 'raw'), gzip: sum(deletable, 'gzip') },
    boot,
  }, null, 2) + '\n');
  console.log(`\njson → ${flag('json')}`);
}

// Failing on gzip only. The raw overrun is real and is reported loudly above,
// but it is a fact about a shell we have not built yet — failing the command on
// it would break every caller before anybody has decided what to do about it.
process.exit(okGzip ? 0 : 1);
