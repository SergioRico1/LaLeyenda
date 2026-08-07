#!/usr/bin/env node
// Measures every model's true rendered size from its pixels and writes the
// result into public/assets/models/manifest.json.
//
// The game scales each model to a target footprint, so it needs to know how big
// the model actually draws. Nothing analytical agrees on that number for this
// library: three.js reports the pre-armature extent for skinned meshes, and
// walking the file's node transforms double-counts the armature scale on models
// whose skinned node also carries one. Rendering a silhouette under an
// orthographic camera of known extent sidesteps the disagreement entirely — the
// pixels are what the player sees.
//
// Two passes per model: a coarse one to find the rough scale, then a tight one
// for precision. Front view gives width and height, top view gives depth.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const MODELS = path.join(ROOT, 'public', 'assets', 'models');
const W = 512;
const H = 512;

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
await new Promise((resolve) => {
  const timer = setTimeout(resolve, 60000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('Local:')) {
      clearTimeout(timer);
      setTimeout(resolve, 400);
    }
  });
});

const preinstalled = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  ...(preinstalled ? { executablePath: preinstalled } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

/** Silhouette bounds in pixels, or null if nothing was drawn. */
async function silhouette(buf) {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY, w: info.width, h: info.height };
}

async function shoot(id, extent, axis) {
  const url =
    `http://localhost:${port}/?scene=measure&shot=1&w=${W}&h=${H}&t=0` +
    `&id=${encodeURIComponent(id)}&extent=${extent}&axis=${axis}`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true || window.__error, { timeout: 90000 });
  const err = await page.evaluate(() => window.__error);
  if (err) throw new Error(err);
  return silhouette(await page.screenshot());
}

/** Measures one axis pair, zooming in until the silhouette fills a useful area. */
async function measure(id, axis) {
  let extent = 4000;
  let shot = await shoot(id, extent, axis);
  if (!shot) throw new Error('nothing rendered');

  // Zoom until the silhouette covers a decent share of the frame, so a few
  // stray pixels cannot swing the result.
  for (let pass = 0; pass < 6; pass++) {
    const frac = Math.max((shot.maxX - shot.minX) / shot.w, (shot.maxY - shot.minY) / shot.h);
    if (frac > 0.35) break;
    extent *= Math.max(2, Math.min(20, 0.6 / Math.max(frac, 0.002)));
    const next = await shoot(id, extent, axis);
    if (!next) break;
    shot = next;
  }

  const aspect = W / H;
  const unitsPerPxX = (extent * aspect) / shot.w;
  const unitsPerPxY = extent / shot.h;
  return {
    a: (shot.maxX - shot.minX + 1) * unitsPerPxX,
    b: (shot.maxY - shot.minY + 1) * unitsPerPxY,
    // Centre offset from the origin, in world units (y is flipped on screen).
    centreA: ((shot.minX + shot.maxX + 1) / 2 - shot.w / 2) * unitsPerPxX,
    centreB: -(((shot.minY + shot.maxY + 1) / 2 - shot.h / 2) * unitsPerPxY),
    extent,
  };
}

const manifestPath = path.join(MODELS, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const ids = Object.keys(manifest);

for (const id of ids) {
  try {
    const front = await measure(id, 'front'); // x, y
    const top = await measure(id, 'top');     // x, z
    const size = [front.a, front.b, top.b];
    const centre = [front.centreA, front.centreB, top.centreB];

    manifest[id].size = size.map((v) => Number(v.toFixed(3)));
    manifest[id].min = [
      Number((centre[0] - size[0] / 2).toFixed(3)),
      Number((centre[1] - size[1] / 2).toFixed(3)),
      Number((centre[2] - size[2] / 2).toFixed(3)),
    ];
    console.log(
      `  ${id.padEnd(20)} ${size.map((v) => v.toFixed(1).padStart(9)).join(' x ')}   baseY ${manifest[id].min[1].toFixed(1)}`
    );
  } catch (err) {
    console.error(`  FAILED ${id}: ${err.message}`);
  }
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\ncalibrated ${ids.length} models -> ${path.relative(ROOT, manifestPath)}`);

await browser.close();
server.kill();
