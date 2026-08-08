#!/usr/bin/env node
/**
 * Measures the texture of the water in a frame, so "the sea is flat" is a number
 * and not an opinion.
 *
 *   node tools/sea-metrics.mjs reference/island_hero.png shots/sea_before.png
 *
 * Segmentation: a strong-blue seed mask, morphologically closed so foam chips and
 * sun glitter (which are white, not blue) count as sea rather than punching holes
 * in it. The close is masked off warm pixels so it cannot eat into the sand.
 *
 * Reported per image:
 *   sea      share of the frame that is water
 *   stddev   luminance standard deviation across the sea
 *   detail   share of sea pixels whose Sobel gradient exceeds --grad (default 14)
 *
 * Gradients are scale sensitive, so every image is measured at the same width
 * (--w, default 430 — the phone frame we actually ship). The 1600px reference is
 * area-downsampled onto that width, which asks the only question that matters:
 * how much of its texture survives on our screen.
 */
import sharp from 'sharp';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const files = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));

const GRAD = Number(flag('grad', 14));
const WIDTH = Number(flag('w', 430));

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

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
  const seed = new Uint8Array(n);   // unambiguously blue water
  const warm = new Uint8Array(n);   // sand, wood, grass, skin — never water
  const L = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    L[i] = lum(r, g, b);
    if (b > r + 25 && b > 45) seed[i] = 1;
    if (r > b + 18 || (g > r + 18 && g > b + 18)) warm[i] = 1;
  }

  // Morphological close on the seed, done as a separable box mean: a pixel that
  // is not blue but sits inside a blue neighbourhood is foam, not land.
  const R = Math.max(2, Math.round(w / 160));
  const blur = boxMean(seed, w, h, R);
  const sea = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    sea[i] = seed[i] || (blur[i] > 0.55 && !warm[i]) ? 1 : 0;
  }

  // Statistics over the sea only, and gradients only where the whole 3x3 stencil
  // is sea so the coastline does not count as "detail".
  let sum = 0, sum2 = 0, count = 0, detail = 0, gradCount = 0;
  for (let i = 0; i < n; i++) {
    if (!sea[i]) continue;
    sum += L[i];
    sum2 += L[i] * L[i];
    count++;
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!sea[i]) continue;
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (!sea[i + dy * w + dx]) { all = false; break; }
      }
      if (!all) continue;
      const gx =
        -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] +
        L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
      const gy =
        -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] +
        L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
      const mag = Math.hypot(gx, gy) / 4;
      gradCount++;
      if (mag > GRAD) detail++;
    }
  }

  const mean = sum / count;
  return {
    file,
    size: `${w}x${h}`,
    seaShare: (100 * count) / n,
    mean,
    stddev: Math.sqrt(sum2 / count - mean * mean),
    detail: (100 * detail) / gradCount,
  };
}

/** Separable box mean of a 0/1 mask, radius r. */
function boxMean(mask, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += mask[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1);
      const add = Math.min(w - 1, x + r + 1), sub = Math.max(0, x - r);
      acc += mask[y * w + add] - mask[y * w + sub];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      const add = Math.min(h - 1, y + r + 1), sub = Math.max(0, y - r);
      acc += tmp[add * w + x] - tmp[sub * w + x];
    }
  }
  return out;
}

const rows = [];
for (const f of files) rows.push(await measure(f));

const pad = (s, n) => String(s).padEnd(n);
console.log(`grad>${GRAD}, measured at width ${WIDTH}`);
console.log(`${pad('file', 34)} ${pad('size', 10)} ${pad('sea%', 8)} ${pad('mean', 8)} ${pad('stddev', 8)} detail%`);
for (const r of rows) {
  console.log(
    `${pad(r.file, 34)} ${pad(r.size, 10)} ${pad(r.seaShare.toFixed(1), 8)} ` +
    `${pad(r.mean.toFixed(1), 8)} ${pad(r.stddev.toFixed(1), 8)} ${r.detail.toFixed(1)}`
  );
}
