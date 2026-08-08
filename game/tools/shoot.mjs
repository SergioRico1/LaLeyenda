#!/usr/bin/env node
// Screenshots the real running game. This is how critics inspect output — they
// never judge the source, they judge the pixels this produces.
//
//   npm run shoot -- island                     one shot, default framing
//   npm run shoot -- island --w 1280 --h 720    explicit size
//   npm run shoot -- island --out my.png        explicit destination
//   npm run shoot -- island --mobile            portrait phone framing
//   npm run shoot -- island --act place         drive a real interaction first
//
// `--act` runs a scripted set of taps from tools/acts.mjs before capturing, so a
// panel, a bottom sheet or a placement ghost can be reviewed as pixels rather
// than described. A feature that only exists after a tap is otherwise a feature
// no critic can see.
//
// Boots a Vite dev server on a free port, waits for window.__ready (set once the
// scene has advanced to a fixed simulated time), then captures. Deterministic:
// the same commit and args always produce the same image.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ACTS } from './acts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SHOTS = path.join(ROOT, 'shots');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const scene = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true) ?? 'island';
const mobile = has('mobile');
const width = Number(flag('w', mobile ? 430 : 1280));
const height = Number(flag('h', mobile ? 932 : 720));
const time = flag('t', '2.0');
const seed = flag('seed', 'la-leyenda');
const outArg = flag('out', null);
// --act runs a scripted interaction (tools/acts.mjs) before the capture, so a
// panel or a placement ghost can be reviewed as pixels rather than described.
const act = flag('act', null);

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const port = await freePort();
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const serverErrors = [];
server.stderr.on('data', (d) => serverErrors.push(String(d)));

const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 60000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('ready in') || String(d).includes('Local:')) {
      clearTimeout(timer);
      setTimeout(() => resolve(true), 400);
    }
  });
});

if (!ready) {
  server.kill();
  console.error('vite failed to start\n' + serverErrors.join(''));
  process.exit(1);
}

// The environment ships a Chromium build that may not match the version this
// Playwright expects, so use the pre-installed binary when it is present.
const preinstalled = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find((p) => fs.existsSync(p));

const browser = await chromium.launch({
  ...(preinstalled ? { executablePath: preinstalled } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
    // Scenes log diagnostics (model sizes, counts) with a [tag] prefix.
    else if (has('verbose') && m.text().startsWith('[')) console.log(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // Any --key value pair the harness does not consume itself is forwarded to the
  // scene as a query param, so scenes can add their own knobs without touching this.
  const OWN_FLAGS = new Set(['w', 'h', 't', 'seed', 'out', 'mobile', 'verbose', 'act']);
  const extra = new URLSearchParams();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (OWN_FLAGS.has(key)) continue;
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '1';
    extra.set(key, value);
  }

  const url =
    `http://localhost:${port}/?scene=${scene}&shot=1&w=${width}&h=${height}&t=${time}` +
    `&seed=${encodeURIComponent(seed)}${extra.toString() ? '&' + extra.toString() : ''}`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  await page.waitForFunction(() => window.__ready === true || window.__error, { timeout: 120000 });
  const err = await page.evaluate(() => window.__error);
  if (err) throw new Error(`scene failed:\n${err}`);

  if (act) {
    if (!ACTS[act]) throw new Error(`unknown --act ${act} (have: ${Object.keys(ACTS).join(', ')})`);
    await ACTS[act](page);
  }

  fs.mkdirSync(SHOTS, { recursive: true });
  const out = outArg
    ? path.resolve(outArg)
    : path.join(SHOTS, `${scene}${mobile ? '_mobile' : ''}.png`);
  await page.screenshot({ path: out });

  console.log(out);
  if (consoleErrors.length) {
    console.error('\nconsole errors during capture:');
    for (const e of consoleErrors.slice(0, 10)) console.error('  ' + e);
    exitCode = 1;
  }
} catch (e) {
  console.error(String(e.message || e));
  exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
process.exit(exitCode);
