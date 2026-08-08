#!/usr/bin/env node
// Selects the few pieces of the third-party vector UI pack that suit this game,
// tunes them to our warm palette, and writes them to public/assets/ui/.
//
// LICENSING — why this is a build step and not committed art.
//
// The pack (dobo_ui, Vector UI Pack) permits using and reworking the assets in
// commercial projects but forbids redistributing them. Shipping them inside a
// game build is use; committing the files to a public repository is closer to
// distribution. So neither the source pack (tools/uipack/) nor the processed
// output (public/assets/ui/) is tracked, and everything that consumes them
// degrades gracefully when they are absent — see src/ui/pack.css.
//
// To enable them: drop the extracted pack into tools/uipack/ and run
//   npm run assets:ui
//
// WHAT IS TAKEN, AND WHY ONLY THIS MUCH
//
// The pack's own language is flat candy-coloured casual — saturated purples and
// pinks, soft single gradients, no hard gloss step. Our HUD is built against
// Clash's four-layer rule (ink contour, hard gloss step, warm rim, extrusion
// lip) and sits over a warm voxel world, so wholesale adoption would be a step
// backwards. What is taken is the handful of shapes CSS genuinely cannot draw:
// a radial ray burst, a chunky pointer, a parchment panel, a nameplate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(HERE, 'uipack');
const OUT = path.join(ROOT, 'public', 'assets', 'ui');

if (!fs.existsSync(SRC)) {
  console.error(
    `No pack at ${path.relative(ROOT, SRC)}.\n` +
    'Drop the extracted vector UI pack there and re-run. The game runs without it.'
  );
  process.exit(0);
}

/**
 * `tint` rotates the source hue toward ours and lifts saturation; the pack's
 * cream variants are already close, so most of these are gentle corrections
 * rather than recolours. `width` keeps the file small — these are UI overlays,
 * not textures, and nothing is drawn above its natural size.
 */
const PIECES = [
  {
    id: 'burst',
    from: 'Effects/effect_cream.png',
    width: 512,
    // The chest reveal's ray burst. Warmed to our gold and left translucent so
    // it can sit under the loot without washing it out.
    tint: { hue: -6, saturation: 1.12, brightness: 1.04 },
  },
  {
    id: 'pointer',
    from: 'Arrows/arrowAdvanced_cream.png',
    width: 192,
    // The "do this now" nudge. Warmed toward the CTA orange so it reads as an
    // instruction rather than as decoration.
    tint: { hue: -10, saturation: 1.2, brightness: 1.0 },
  },
  {
    id: 'parchment',
    from: 'Modals/notebookModal_v1.png',
    width: 720,
    // Quests and the daily streak. A ledger with a warm header is exactly the
    // right object for a pirate logbook, and it is the one panel shape CSS
    // cannot fake convincingly.
    tint: { hue: -4, saturation: 1.06, brightness: 1.02 },
  },
  {
    id: 'nameplate',
    from: 'Labels/labelSimple_cream.png',
    fallbackFrom: 'Labels',
    width: 480,
    tint: { hue: -4, saturation: 1.06, brightness: 1.0 },
  },
];

/** Picks the first cream/white variant in a directory, for pieces whose exact
 *  filename varies between pack revisions. */
function resolveSource(piece) {
  const direct = path.join(SRC, piece.from);
  if (fs.existsSync(direct)) return direct;
  if (!piece.fallbackFrom) return null;
  const dir = path.join(SRC, piece.fallbackFrom);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  const warm = files.find((f) => /cream|white|tan/i.test(f)) ?? files[0];
  return warm ? path.join(dir, warm) : null;
}

fs.mkdirSync(OUT, { recursive: true });

let written = 0;
for (const piece of PIECES) {
  const source = resolveSource(piece);
  if (!source) {
    console.warn(`  skipped ${piece.id}: no source for ${piece.from}`);
    continue;
  }
  const dest = path.join(OUT, `${piece.id}.webp`);
  await sharp(source)
    .resize(piece.width, null, { withoutEnlargement: true })
    .modulate(piece.tint)
    .webp({ quality: 92, alphaQuality: 100 })
    .toFile(dest);
  const kb = Math.round(fs.statSync(dest).size / 1024);
  console.log(`  ${piece.id.padEnd(11)} ${String(kb).padStart(4)}KB  ← ${path.relative(SRC, source)}`);
  written++;
}

// A marker the stylesheet can key off, so the UI only switches to the pack's
// artwork when the artwork is actually present.
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ pieces: PIECES.map((p) => p.id) }, null, 2));
console.log(`\n${written} piece(s) → ${path.relative(ROOT, OUT)}`);
