#!/usr/bin/env node
/**
 * tools/blind.mjs — puts our frame next to the shipped game's, unlabelled.
 *
 *   node tools/blind.mjs --piece island --round 3 --swap 1
 *
 * The comparison this project keeps needing is not "does our screenshot look
 * nice", it is "held against the real thing with no label, which one does a
 * cold eye pick". That only works if the judge cannot tell which is which, so
 * this writes two files called a.png and b.png and keeps the mapping in a
 * key.json the judge is simply never pointed at.
 *
 * Both frames are rendered at the SAME size and aspect. Pirate Nation's stills
 * are 16:9 landscape; our phone frame is portrait. Comparing those directly
 * would be judging the crop, not the craft, so ours is shot at the reference's
 * shape for the comparison and the phone framing is judged separately.
 *
 * --swap is passed in rather than rolled here, so the caller controls the order
 * and can vary it per round without this file needing a clock or a random
 * source it would then have to be trusted about.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

/** Each piece: what to shoot, and which shipped frame it is measured against. */
const PIECES = {
  island: {
    reference: 'reference/island_hero.png',
    shoot: ['island', '--hud', '0', '--w', '1280', '--h', '720', '--t', '2.0'],
    about: 'the home island seen from the builder camera — terrain, lagoon, buildings, light',
  },
  sea: {
    reference: 'reference/sea_combat.png',
    shoot: ['sea', '--hud', '0', '--w', '1280', '--h', '720', '--t', '4.0', '--at', '150,40'],
    about: 'the open sea — water, horizon, islets and whatever is sailing on it',
  },
};

const pieceName = flag('piece', 'island');
const round = Number(flag('round', '1'));
const swap = flag('swap', '0') === '1';
const piece = PIECES[pieceName];
if (!piece) {
  console.error(`unknown piece ${pieceName} — have: ${Object.keys(PIECES).join(', ')}`);
  process.exit(1);
}

const outDir = path.join(ROOT, 'shots', 'blind', `${pieceName}-r${round}`);
fs.mkdirSync(outDir, { recursive: true });
const ours = path.join(outDir, 'ours.png');

const shot = spawnSync('node', [path.join(ROOT, 'tools', 'shoot.mjs'), ...piece.shoot, '--out', ours], {
  cwd: ROOT, encoding: 'utf8', timeout: 600000,
});
if (shot.status !== 0 || !fs.existsSync(ours)) {
  console.error(`shoot failed for ${pieceName}:\n${shot.stderr || shot.stdout}`);
  process.exit(1);
}

const W = 1280;
const H = 720;
// `cover` on both: the reference is cropped to 16:9 rather than squashed, so
// nothing is judged on a distortion neither game would ever ship.
const norm = (src, dest) =>
  sharp(src).resize(W, H, { fit: 'cover', position: 'centre' }).png().toFile(dest);

const A = path.join(outDir, 'a.png');
const B = path.join(outDir, 'b.png');
await norm(ours, swap ? B : A);
await norm(path.join(ROOT, piece.reference), swap ? A : B);

const key = {
  piece: pieceName,
  round,
  about: piece.about,
  a: swap ? 'reference' : 'ours',
  b: swap ? 'ours' : 'reference',
  reference: piece.reference,
};
fs.writeFileSync(path.join(outDir, 'key.json'), JSON.stringify(key, null, 2));

// Only the paths go to stdout. The mapping stays in the file, so a judge given
// this output has nothing to go on but the pixels.
console.log(JSON.stringify({ dir: outDir, a: A, b: B, about: piece.about }, null, 2));
