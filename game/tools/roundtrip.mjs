#!/usr/bin/env node
/**
 * tools/roundtrip.mjs — the island → sea → island loop, driven for real.
 *
 *   npm run test:roundtrip
 *
 * This exists because the screenshot harness CANNOT test it. Every act in
 * tools/acts.mjs runs under `?shot=1`, which boots exactly one scene and never
 * switches — the router that hands the stage from the island to the sea and
 * back only runs in the live game. So the single most structural thing added to
 * this project, the scene transition that closes PLAN.md's main loop, was
 * shipping with nothing watching it.
 *
 * It runs the game the way a player does: no shot mode, no test hooks, real
 * taps on real buttons. `?save=demo` for speed and stability: the demo island
 * has a boat already owned, so the trip starts at the first tap. (Since round
 * 12 a cold start reaches the sea too — the tutorial's Muelle carries the
 * starter skiff — but that route takes minutes of real timers, and the gate's
 * walk covers it; this harness only guards the scene handoff.)
 *
 * Four things have to hold, and the third is the one a screenshot would miss:
 *
 *   1. ¡Zarpar! leaves the island and the sea HUD appears.
 *   2. The ISLAND HUD IS GONE. Two scenes sharing the stage means two update
 *      loops on one camera; if dispose stops working this is what catches it.
 *   3. Volver ends the voyage and offers the card.
 *   4. The island comes back, and the sea HUD is gone with it.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });

const port = await freePort();
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
});
const up = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 60000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('ready in') || String(d).includes('Local:')) {
      clearTimeout(timer);
      setTimeout(() => resolve(true), 400);
    }
  });
});
if (!up) { server.kill(); console.error('vite failed to start'); process.exit(1); }

const preinstalled = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(preinstalled ? { executablePath: preinstalled } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const steps = [];
const step = (name, ok, detail = '') => {
  steps.push({ name, ok, detail });
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? `  ${detail}` : ''}`);
};

let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  console.log('\nisland → sea → island\n');

  await page.goto(`http://localhost:${port}/?save=demo`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.hud', { timeout: 60000, state: 'attached' });
  step('the island boots', true);

  const sail = page.locator('button[aria-label="¡Zarpar!"]');
  await sail.waitFor({ timeout: 15000, state: 'visible' });
  await sail.click();

  await page.waitForSelector('.sea', { timeout: 30000, state: 'visible' });
  step('¡Zarpar! reaches the open sea', true);

  // The one a capture could never show: the island must be GONE, not merely
  // covered. A stale HUD here means dispose stopped running and two scenes are
  // driving the same camera.
  const islandStillThere = await page.locator('.hud').count();
  step('the island scene was torn down, not left underneath', islandStillThere === 0,
    islandStillThere ? `${islandStillThere} island HUD still in the DOM` : '');
  if (islandStillThere) exitCode = 1;

  // Sail for a moment so the voyage is a real one with a hold and a hull.
  await page.waitForTimeout(2500);

  await page.locator('.sea__leave').click();
  await page.waitForSelector('.sea__end', { timeout: 15000, state: 'visible' });
  step('Volver ends the voyage and offers the card', true);

  await page.locator('.sea__endCta').click();
  await page.waitForSelector('.hud', { timeout: 30000, state: 'attached' });
  step('the island comes back', true);

  const seaStillThere = await page.locator('.sea').count();
  step('and the sea scene went with it', seaStillThere === 0,
    seaStillThere ? `${seaStillThere} sea HUD still in the DOM` : '');
  if (seaStillThere) exitCode = 1;

  if (errors.length) {
    step('no console errors during the round trip', false, errors[0].slice(0, 120));
    exitCode = 1;
  } else {
    step('no console errors during the round trip', true);
  }
} catch (err) {
  console.error(`\n  \x1b[31m✗\x1b[0m ${String(err.message || err).split('\n')[0]}`);
  exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}

const passed = steps.filter((s) => s.ok).length;
console.log(`\n${passed}/${steps.length} steps passed\n`);
process.exit(exitCode);
