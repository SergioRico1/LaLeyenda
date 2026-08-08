#!/usr/bin/env node
// Reports what one real frame of a scene actually costs the GPU.
//
//   node tools/perf.mjs                 the island, as the phone sees it
//   node tools/perf.mjs --parts terrain isolate one category
//
// PLAN.md's budget is 60fps on a mid-range phone and under 100 draw calls. A
// count of scene nodes does not answer that — three.js batches nothing by
// itself, so the only honest figure is renderer.info after a frame has been
// drawn. The scene exposes it through window.laLeyenda.stats().
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

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
const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 60000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('ready in') || String(d).includes('Local:')) {
      clearTimeout(timer);
      setTimeout(() => resolve(true), 400);
    }
  });
});
if (!ready) { server.kill(); console.error('vite failed to start'); process.exit(1); }

const preinstalled = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(preinstalled ? { executablePath: preinstalled } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
  const extra = new URLSearchParams();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '1';
    extra.set(argv[i].slice(2), value);
  }
  const url = `http://localhost:${port}/?scene=island&shot=1&w=430&h=932&t=2.0` +
    (extra.toString() ? '&' + extra.toString() : '');
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true || window.__error, { timeout: 120000 });
  const err = await page.evaluate(() => window.__error);
  if (err) throw new Error(err);

  const stats = await page.evaluate(() => window.laLeyenda.stats());
  const budget = 100;
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(11)} ${v}`);

  // Frame cost. This runs on SwiftShader, a CPU rasteriser, so the absolute
  // milliseconds mean nothing about a phone — only the RATIO between two runs
  // is signal. Compare `--parts terrain,buildings,ship` against the full scene
  // to price a layer.
  const ms = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    window.__step(8); sync();                 // warm the pipeline
    const t0 = performance.now();
    window.__step(30); sync();                // readPixels blocks on the GPU
    return (performance.now() - t0) / 30;
  });
  console.log(`  ${'ms/frame'.padEnd(11)} ${ms.toFixed(1)}  (SwiftShader — ratios only)`);

  console.log(`\ndraw calls ${stats.calls} / ${budget} — ${stats.calls <= budget ? 'OK' : 'OVER BUDGET'}`);
  if (stats.calls > budget) exitCode = 1;
} catch (e) {
  console.error(String(e.message || e));
  exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
process.exit(exitCode);
