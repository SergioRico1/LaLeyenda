#!/usr/bin/env node
/**
 * Measures the texture of the water in a frame, so "the sea is flat" is a number
 * and not an opinion.
 *
 *   node tools/sea-metrics.mjs reference/island_hero.png shots/sea_before.png
 *
 * Segmentation: seed sea from strong blue and land from anything warm or green,
 * then hand every leftover pixel — foam, sun glitter, whitecaps, all of which are
 * white rather than blue — to whichever seed dominates its neighbourhood. A
 * one-sided fill would quietly punish whichever image has the BIGGER bright
 * chips, which is exactly the quantity being compared.
 *
 * Reported per image:
 *   sea      share of the frame that is water
 *   stddev   luminance standard deviation across the sea
 *   detail   share of sea pixels whose Sobel gradient exceeds --grad (default 14)
 *
 * --bands adds the same figures per eighth of the frame, far edge to near one.
 * That is the row that matters: the reference runs sd 20 at the top to sd 74 at
 * the bottom, and a whole-frame average can hide a sea that is flat at both ends.
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
  const wet = new Uint8Array(n);    // unambiguously blue water
  const dry = new Uint8Array(n);    // sand, wood, grass, foliage — never water
  const L = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    L[i] = lum(r, g, b);
    if (b > r + 25 && b > 45) wet[i] = 1;
    else if (r > b + 18 || (g > r + 18 && g > b + 18)) dry[i] = 1;
  }

  // Everything still unclaimed is white or near-white — foam, glitter, a gull —
  // and goes to whichever seed wins its neighbourhood.
  const R = Math.max(3, Math.round(w / 40));
  const nearWet = boxMean(wet, w, h, R);
  const nearDry = boxMean(dry, w, h, R);
  const sea = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    sea[i] = wet[i] || (!dry[i] && nearWet[i] > nearDry[i]) ? 1 : 0;
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

  // Per-eighth, far edge to near one.
  const bands = [];
  const bh = Math.ceil(h / 8);
  for (let y0 = 0; y0 < h; y0 += bh) {
    let s = 0, s2 = 0, c = 0, bright = 0, dark = 0;
    for (let y = y0; y < Math.min(h, y0 + bh); y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!sea[i]) continue;
        s += L[i]; s2 += L[i] * L[i]; c++;
        if (L[i] > 200) bright++;
        if (L[i] < 55) dark++;
      }
    }
    if (c < 1500) { bands.push(null); continue; }
    const m = s / c;
    bands.push({ mean: m, sd: Math.sqrt(s2 / c - m * m), bright: (100 * bright) / c, dark: (100 * dark) / c });
  }

  return {
    file,
    size: `${w}x${h}`,
    seaShare: (100 * count) / n,
    mean,
    stddev: Math.sqrt(sum2 / count - mean * mean),
    detail: (100 * detail) / gradCount,
    bands,
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

if (argv.includes('--bands')) {
  for (const r of rows) {
    console.log(`\n${r.file}   far -> near, by eighth`);
    const cell = (b, get) => pad(b ? get(b) : '—', 7);
    console.log('  sd      ' + r.bands.map((b) => cell(b, (x) => x.sd.toFixed(0))).join(''));
    console.log('  mean    ' + r.bands.map((b) => cell(b, (x) => x.mean.toFixed(0))).join(''));
    console.log('  L>200   ' + r.bands.map((b) => cell(b, (x) => x.bright.toFixed(0) + '%')).join(''));
    console.log('  L<55    ' + r.bands.map((b) => cell(b, (x) => x.dark.toFixed(0) + '%')).join(''));
  }
}
