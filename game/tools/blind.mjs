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
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

// This parser used to ignore any flag it did not recognise, and that silence
// cost two rounds: callers passed `--save demo` believing it reached the
// shoot, it never did, and the blind compared the wrong game state for nine
// rounds while everyone read the flag in their scrollback as proof it had not.
// An option this harness does not understand is now a refusal, not a shrug.
const KNOWN = new Set(['--piece', '--round', '--swap']);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    if (!KNOWN.has(argv[i])) {
      console.error(`unknown flag ${argv[i]} — the shoot is configured in PIECES, not on this CLI`);
      process.exit(1);
    }
    i++; // skip the flag's value
  }
}

const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

/** Each piece: what to shoot, and which shipped frame it is measured against. */
const PIECES = {
  island: {
    reference: 'reference/island_hero.png',
    // `--save demo` is load-bearing. The reference shows a settlement somebody
    // played into existence, and for nine rounds this entry silently shot the
    // DAY-ONE island against it — one lone hall and empty ground, identifiable
    // as ours on content alone, no metadata needed. Worse, callers passed
    // `--save demo` on the CLI and this harness ignored every flag it did not
    // know, so the fix everyone believed was in force never ran. A round-9
    // judge caught both. Unknown flags are a hard error now for exactly that
    // reason.
    shoot: ['island', '--save', 'demo', '--hud', '0', '--w', '1280', '--h', '720', '--t', '2.0'],
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

// The blind directory holds the two candidates and the key — NOTHING else, and
// that has to be enforced on entry, not assumed. Moving the staging capture out
// of this directory was not enough: a stale ours.png from a pre-fix run was
// still sitting in round 9's directory, and a one-line pixel diff against it
// resolved the mapping. A judge found it. Anything already here that is not
// ours goes now, whatever left it behind.
for (const f of fs.readdirSync(outDir)) {
  if (!['a.png', 'b.png', 'key.json'].includes(f)) fs.rmSync(path.join(outDir, f), { force: true });
}

// Our raw capture is written OUTSIDE the blind directory and deleted when the
// pair has been built. It used to sit next to a.png and b.png as `ours.png`,
// and a round-8 judge pointed out that its byte size matched its twin to within
// 0.1% while the other file was nearly double — so `ls` handed over the mapping
// before a single image was opened. Every verdict taken before this was fixed
// has to be read with that in mind.
const staging = path.join(ROOT, 'shots', `.blind-staging-${pieceName}-r${round}.png`);
const ours = staging;

const shot = spawnSync('node', [path.join(ROOT, 'tools', 'shoot.mjs'), ...piece.shoot, '--out', ours], {
  cwd: ROOT, encoding: 'utf8', timeout: 600000,
});
if (shot.status !== 0 || !fs.existsSync(ours)) {
  console.error(`shoot failed for ${pieceName}:\n${shot.stderr || shot.stdout}`);
  process.exit(1);
}

const W = 1280;
const H = 720;

/**
 * The corners the shipped game signs its own screenshots in.
 *
 * `island_hero.png` carries a "Pirate Nation" wordmark top-left and a
 * "ProofOfPlay" watermark bottom-right. Both survived the resize, so the
 * reference identified itself on sight and the comparison was never blind at
 * all — a round-8 judge caught it, and I had read one of these frames myself
 * without connecting the logo to the protocol.
 *
 * Painted on BOTH images at the SAME coordinates, because a patch on one only
 * would be the same tell wearing a different hat. Generous enough to cover the
 * marks at any of the sizes we normalise to, and neutral mid-grey so it reads
 * as an obvious redaction rather than as content either game drew.
 */
const BRANDING = [
  { left: 0, top: 0, width: Math.round(W * 0.22), height: Math.round(H * 0.20) },
  { left: Math.round(W * 0.80), top: Math.round(H * 0.82), width: Math.round(W * 0.20), height: Math.round(H * 0.18) },
];

const patch = (box) => ({
  input: {
    create: {
      width: box.width, height: box.height, channels: 4,
      background: { r: 128, g: 128, b: 128, alpha: 1 },
    },
  },
  left: box.left, top: box.top,
});

// `cover` on both: the reference is cropped to 16:9 rather than squashed, so
// nothing is judged on a distortion neither game would ever ship. Identical
// encoder settings on both, so the two files cannot be told apart by weight
// the way ours.png used to give itself away.
//
// THE JITTER IS THE FOURTH LEAK'S FIX, and the fourth judge in a row to break
// this harness earned it. The reference side of every round was byte-identical
// — r10's candidate carried the same md5 as r9's and r8's — and the earlier
// rounds' key.json files sit on disk naming which of THEIR files was the
// reference, so one hash lookup resolved any future round for good. Every pair
// is therefore built through a random crop window (same window for BOTH
// candidates, so it is never a tell) and a random encoder level, minted fresh
// per run from crypto randomness — this is a judging tool, not the sim, so
// nondeterminism here is the point. Cross-round pixel comparison still exists
// for a judge willing to correlate through the shift; the honest fix for that
// would be withholding history entirely, and the progress page needs it. The
// bar is raised from "one command" to "an argued forensic effort", and a judge
// that argues it earns the find.
const JITTER = 8;
const rnd = (n) => crypto.randomInt(0, n + 1);
const win = { dx: rnd(JITTER), dy: rnd(JITTER) };
const level = 7 + rnd(2);

const norm = (src, dest) =>
  sharp(src)
    .resize(W + JITTER, H + JITTER, { fit: 'cover', position: 'centre' })
    .extract({ left: win.dx, top: win.dy, width: W, height: H })
    .composite(BRANDING.map(patch))
    .png({ compressionLevel: level, effort: 7 })
    .toFile(dest);

const A = path.join(outDir, 'a.png');
const B = path.join(outDir, 'b.png');
await norm(ours, swap ? B : A);
await norm(path.join(ROOT, piece.reference), swap ? A : B);

// The staging capture goes now. Nothing is left in the blind directory but the
// two candidates and the key.
fs.rmSync(staging, { force: true });

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
