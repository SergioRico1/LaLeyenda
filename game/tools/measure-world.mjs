#!/usr/bin/env node
/**
 * Measures the world's pixels the way the verification did, so a claim about the
 * frame is a number and not an adjective.
 *
 *   node tools/measure-world.mjs shots/x.png reference/island_hero.png
 *
 * Two segmentations, each reported separately:
 *
 *   SEA  — pixels whose hue sits in the blue arc and which are not land. The
 *          reference's sea carries wave crests, foam and colour banding; ours
 *          carried a near-flat fill, so the interesting figures are the spread
 *          (std-dev of luminance) and how much of it is EDGE rather than field.
 *
 *   LAND — everything else inside the island's bounding blob. The island is the
 *          half the composition round owns: a packed island has small, busy
 *          patches, so the figures are the same two plus the largest empty run,
 *          which is what "six unpainted mid-green rectangles" actually means.
 *
 * Both images are resampled to a common width first, because detail share is a
 * per-pixel measure and a 1600px reference would otherwise read as sharper than
 * a 430px phone shot purely from scale.
 */
import fs from 'node:fs';
import sharp from 'sharp';

const WIDTH = 900; // common comparison width

/** Sobel gradient magnitude over a single channel. */
function gradient(lum, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1] +
        lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
      const gy =
        -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] +
        lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
      out[i] = Math.hypot(gx, gy) / 4;
    }
  }
  return out;
}

function stats(values) {
  if (!values.length) return { mean: 0, std: 0 };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let acc = 0;
  for (const v of values) acc += (v - mean) ** 2;
  return { mean, std: Math.sqrt(acc / values.length) };
}

/**
 * Sea mask. Blue-dominant and not sand/grass: the reference's deep water, its
 * shallow shelf and its foam all satisfy b > r with a strong blue lead, while
 * beach (r >= b) and grass (g dominant) never do.
 */
function isSea(r, g, b) {
  return b > r + 24 && b > g + 6;
}

async function measure(file) {
  const src = sharp(file).removeAlpha();
  const meta = await src.metadata();
  const w = WIDTH;
  const h = Math.round((meta.height / meta.width) * WIDTH);
  const { data } = await sharp(file)
    .removeAlpha()
    .resize(w, h, { kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const n = w * h;
  const lum = new Float32Array(n);
  const sea = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sea[i] = isSea(r, g, b) ? 1 : 0;
  }

  const grad = gradient(lum, w, h);

  // The land blob: not-sea, minus the isolated specks the hue test leaves in
  // the water (a foam crest can read as land for one pixel). One erode/dilate
  // pass on a 3x3 is enough, and keeps the beach edge honest.
  const land = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (sea[i]) continue;
      let solid = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!sea[i + dy * w + dx]) solid++;
      }
      if (solid >= 6) land[i] = 1;
    }
  }

  const seaLum = [];
  const landLum = [];
  let seaDetail = 0;
  let landDetail = 0;
  let seaN = 0;
  let landN = 0;
  for (let i = 0; i < n; i++) {
    if (sea[i]) {
      seaN++;
      seaLum.push(lum[i]);
      if (grad[i] > 14) seaDetail++;
    } else if (land[i]) {
      landN++;
      landLum.push(lum[i]);
      if (grad[i] > 14) landDetail++;
    }
  }

  // The largest square of land carrying NO detail at all — the direct measure of
  // "an unpainted rectangle". Computed as the biggest axis-aligned square whose
  // every pixel is land and below the gradient threshold, via the standard
  // largest-square DP.
  const dp = new Int32Array(n);
  let biggest = 0;
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const i = y * w + x;
      if (!land[i] || grad[i] > 10) { dp[i] = 0; continue; }
      dp[i] = 1 + Math.min(dp[i - 1], dp[i - w], dp[i - w - 1]);
      if (dp[i] > biggest) biggest = dp[i];
    }
  }

  return {
    file,
    w, h,
    seaShare: (seaN / n) * 100,
    landShare: (landN / n) * 100,
    seaStd: stats(seaLum).std,
    seaDetail: seaN ? (seaDetail / seaN) * 100 : 0,
    landStd: stats(landLum).std,
    landDetail: landN ? (landDetail / landN) * 100 : 0,
    // Reported as a share of the land's own width so a 430px shot and a 1600px
    // reference are comparable.
    emptiestSquare: (biggest / Math.sqrt(Math.max(1, landN))) * 100,
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/measure-world.mjs <image> [image...]');
  process.exit(1);
}

const rows = [];
for (const f of files) {
  if (!fs.existsSync(f)) { console.error(`missing: ${f}`); process.exit(1); }
  rows.push(await measure(f));
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 6) => v.toFixed(1).padStart(n);
console.log(
  pad('image', 34) + pad('sea%', 7) + pad('seaStd', 8) + pad('seaDet%', 9) +
  pad('land%', 7) + pad('landStd', 9) + pad('landDet%', 10) + 'emptySq%'
);
for (const r of rows) {
  console.log(
    pad(r.file.length > 32 ? '…' + r.file.slice(-31) : r.file, 34) +
    num(r.seaShare, 5) + '  ' + num(r.seaStd, 6) + '  ' + num(r.seaDetail, 7) + '  ' +
    num(r.landShare, 5) + '  ' + num(r.landStd, 7) + '  ' + num(r.landDetail, 8) + '  ' +
    num(r.emptiestSquare, 6)
  );
}
