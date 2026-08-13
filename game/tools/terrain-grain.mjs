#!/usr/bin/env node
/**
 * Measures the GRAIN of the terrain surface, so "the ground is flat" is a number
 * rather than an adjective — the land-side twin of tools/sea-metrics.mjs.
 *
 *   node tools/terrain-grain.mjs shots/x.png reference/island_hero.png
 *
 * For each image it classifies every pixel as sand or grass by hue, then slides a
 * window over the frame and keeps only the windows that are essentially PURE
 * (>= 99% one class). Those are patches of bare ground: no building, no palm, no
 * coastline. For each surviving patch it reports
 *
 *   colours  distinct RGB triples in the patch
 *   sd       luminance standard deviation
 *   detail   share of pixels whose Sobel gradient exceeds --grad (default 14)
 *   hue-sd   standard deviation of hue in degrees, i.e. whether the variation is
 *            real colour or only brightness
 *
 * and prints the MEDIAN across patches. The median, not the mean: a handful of
 * windows will always straddle a cast shadow, and one shadow edge can double a
 * mean while telling you nothing about the surface underneath it.
 *
 * Scale matters — a patch measured at twice the magnification has four times the
 * pixels and more unique colours for free. The comparison this tool exists for is
 * per WORLD CELL, so both frames must be sampled at roughly the same pixels per
 * terrain cell: the 1600px reference and our 1280px landscape shot both land at
 * ~26px, which is why those are the two the numbers are quoted from. --w rescales
 * if a frame is captured at some other size.
 */
import sharp from 'sharp';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const files = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1]?.startsWith('--') && !argv[i]?.startsWith('--') && ['grad', 'w', 'patch', 'stride', 'pure'].includes(argv[i - 1]?.slice(2))));

const GRAD = Number(flag('grad', 14));
const PATCH = Number(flag('patch', 40));
const STRIDE = Number(flag('stride', 8));
const PURE = Number(flag('pure', 0.99));
const WIDTH = flag('w', null);

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Hue in degrees, 0-360. Undefined for greys, which are excluded by class. */
function hue(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Circular standard deviation, in degrees. */
function hueStd(hues) {
  if (!hues.length) return 0;
  let sx = 0, sy = 0;
  for (const h of hues) { const a = (h * Math.PI) / 180; sx += Math.cos(a); sy += Math.sin(a); }
  const r = Math.hypot(sx, sy) / hues.length;
  return r >= 1 ? 0 : (Math.sqrt(-2 * Math.log(r)) * 180) / Math.PI;
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Sand: warm and pale — red leads blue by a clear margin and nothing is dark.
 * Grass: green leads both. Both bands are wide on purpose; a band tight enough to
 * exclude the reference's own mottle would measure the band, not the ground.
 */
function classify(r, g, b) {
  const L = lum(r, g, b);
  if (g > r + 6 && g > b + 28 && L > 55 && L < 210) return 2;                       // grass
  // Sand is pale with blue the lowest channel. `r >= g` is deliberately NOT
  // required: our own sand renders a shade cooler than the reference's, and a
  // classifier that excluded it would have reported "no sand found" instead of
  // the flat surface that is the thing being measured.
  if (b < g && b < r && r - b > 14 && r - b < 92 && Math.abs(r - g) < 24 && L > 120) return 1;
  return 0;
}

async function measure(file) {
  let img = sharp(file).removeAlpha();
  if (WIDTH) {
    const meta = await sharp(file).metadata();
    img = img.resize(Number(WIDTH), Math.round((meta.height / meta.width) * Number(WIDTH)), { kernel: 'lanczos3' });
  }
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, n = w * h;

  const cls = new Uint8Array(n);
  const L = new Float32Array(n);
  const H = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    cls[i] = classify(r, g, b);
    L[i] = lum(r, g, b);
    H[i] = hue(r, g, b);
  }

  // Sobel over luminance, computed once for the whole frame.
  const G = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
      const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
      G[i] = Math.hypot(gx, gy) / 4;
    }
  }

  const out = {};
  for (const [name, want] of [['sand', 1], ['grass', 2]]) {
    const colours = [], sds = [], details = [], hues = [];
    for (let y = 1; y + PATCH < h - 1; y += STRIDE) {
      for (let x = 1; x + PATCH < w - 1; x += STRIDE) {
        let hit = 0;
        for (let py = 0; py < PATCH; py++) {
          for (let px = 0; px < PATCH; px++) if (cls[(y + py) * w + x + px] === want) hit++;
        }
        if (hit < PURE * PATCH * PATCH) continue;

        const seen = new Set();
        const hs = [];
        let sum = 0, sum2 = 0, det = 0;
        for (let py = 0; py < PATCH; py++) {
          for (let px = 0; px < PATCH; px++) {
            const i = (y + py) * w + x + px;
            seen.add((data[i * 3] << 16) | (data[i * 3 + 1] << 8) | data[i * 3 + 2]);
            sum += L[i]; sum2 += L[i] * L[i];
            if (G[i] > GRAD) det++;
            hs.push(H[i]);
          }
        }
        const count = PATCH * PATCH;
        const mean = sum / count;
        colours.push(seen.size);
        sds.push(Math.sqrt(Math.max(0, sum2 / count - mean * mean)));
        details.push((det / count) * 100);
        hues.push(hueStd(hs));
      }
    }
    out[name] = {
      patches: colours.length,
      colours: median(colours),
      sd: median(sds),
      detail: median(details),
      hueSd: median(hues),
    };
  }
  return { file, w, h, ...out };
}

const rows = [];
for (const f of files) rows.push(await measure(f));

const pad = (s, n) => String(s).padEnd(n);
console.log(`patch ${PATCH}x${PATCH}px  stride ${STRIDE}  purity ${PURE}  grad>${GRAD}`);
console.log(
  `${pad('image', 34)}${pad('size', 11)}${pad('surface', 8)}${pad('patches', 9)}` +
  `${pad('colours', 9)}${pad('sd', 8)}${pad('detail%', 9)}hue-sd`
);
for (const r of rows) {
  for (const surface of ['sand', 'grass']) {
    const s = r[surface];
    console.log(
      `${pad(r.file.slice(-33), 34)}${pad(`${r.w}x${r.h}`, 11)}${pad(surface, 8)}${pad(s.patches, 9)}` +
      `${pad(s.colours, 9)}${pad(s.sd.toFixed(2), 8)}${pad(s.detail.toFixed(1), 9)}${s.hueSd.toFixed(1)}`
    );
  }
}
