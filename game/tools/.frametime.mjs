// Times N rendered frames of the island at phone size, so the cost of a shader
// change is a number. SwiftShader is a CPU rasteriser, so treat the RATIO
// between two runs as the signal, never the absolute milliseconds.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const freePort = () => new Promise((r) => {
  const s = net.createServer();
  s.listen(0, () => { const { port } = s.address(); s.close(() => r(port)); });
});
const port = await freePort();
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => {
  const t = setTimeout(() => r(false), 60000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('ready in') || String(d).includes('Local:')) { clearTimeout(t); setTimeout(() => r(true), 400); }
  });
});
const pre = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(pre ? { executablePath: pre } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
const extra = argv.join('&').replace(/--/g, '');
await page.goto(`http://localhost:${port}/?scene=island&shot=1&w=430&h=932&t=2.0&hud=0${extra ? '&' + extra : ''}`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__ready === true || window.__error, { timeout: 120000 });
const ms = await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2')
    || document.querySelector('canvas').getContext('webgl');
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  window.__step(10); sync();               // warm
  const t0 = performance.now();
  window.__step(40); sync();               // readPixels blocks until the GPU is done
  return (performance.now() - t0) / 40;
});
console.log(`${ms.toFixed(1)} ms/frame`);
await browser.close();
server.kill();
process.exit(0);
