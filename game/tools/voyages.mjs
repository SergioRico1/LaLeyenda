#!/usr/bin/env node
/**
 * tools/voyages.mjs — play the sea a thousand times and print what happened.
 *
 * `node tools/voyages.mjs [runs]`
 *
 * The balance of the open sea is not a thing to eyeball. `src/sim/sea.ts` is a
 * pure deterministic simulation with no browser in the loop, so a fleet of
 * seeded voyages can be played end to end in a second and the answer read off a
 * table. tools/tests/voyages.ts holds the autopilot — two models of player, a
 * beginner and someone who has understood the ship — and this file is the
 * runner that prints the sweep.
 *
 * Same bundling trick as tools/test.mjs: esbuild turns the TypeScript into one
 * ESM file that imports the game's real simulation, not a copy of it.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outFile = path.join(root, 'node_modules', '.cache', 'laleyenda', 'voyages.mjs');

const result = await build({
  entryPoints: [path.join(root, 'tools', 'tests', 'voyages.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  loader: { '.json': 'json' },
  write: false,
  logLevel: 'warning',
});
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, result.outputFiles[0].text);

const {
  SWEEP, playFleet, summarise, straightOut, timeToKill, breakOff, tideSweep, weightRun,
} = await import(pathToFileURL(outFile).href);

const runs = Number(process.argv[2] ?? 200);

const BOLD = '[1m';
const DIM = '[2m';
const OFF = '[0m';

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const secs = (x) => (x ? `${x.toFixed(0)}s` : '—');

function table(rows, columns) {
  const width = columns.map((c) => Math.max(c.head.length, ...rows.map((r) => String(c.cell(r)).length)));
  const line = (cells) => cells.map((c, i) => String(c).padStart(width[i])).join('  ');
  console.log(`  ${BOLD}${line(columns.map((c) => c.head))}${OFF}`);
  console.log(`  ${DIM}${line(width.map((w) => '─'.repeat(w)))}${OFF}`);
  for (const row of rows) console.log(`  ${line(columns.map((c) => c.cell(row)))}`);
}

console.log(`\n${BOLD}Voyages${OFF} ${DIM}— ${runs} seeded runs per line, autopilot on the real stick mapping${OFF}\n`);

const rows = SWEEP.map((plan) => ({ plan, ...summarise(playFleet(runs, plan, `${plan.skill}-r${plan.ring}-`)) }));

table(rows, [
  { head: 'anillo', cell: (r) => r.plan.ring },
  { head: 'piloto', cell: (r) => r.plan.skill },
  { head: 'sitios', cell: (r) => r.plan.sites },
  { head: 'vuelve', cell: (r) => pct(r.survived) },
  { head: 'hundido', cell: (r) => pct(r.sunk) },
  { head: 'sin fin', cell: (r) => pct(r.timedOut) },
  { head: 't.hundir', cell: (r) => secs(r.timeToSink) },
  { head: 't.viaje', cell: (r) => secs(r.timeHome) },
  { head: 'carga', cell: (r) => Math.round(r.cargoHome) },
  { head: 'carga/viaje', cell: (r) => Math.round(r.cargoPerVoyage) },
  { head: 'carga/min', cell: (r) => Math.round(r.cargoPerMinute) },
  { head: 'casco', cell: (r) => pct(r.hullHome) },
  { head: 'sitios', cell: (r) => r.sitesHome },
  { head: 'llegó a', cell: (r) => r.reached },
  { head: 'bajas', cell: (r) => r.kills.toFixed(1) },
  { head: 'daño bicho', cell: (r) => Math.round(r.mobDamage) },
  { head: 'daño roca', cell: (r) => Math.round(r.reefDamage) },
]);

/* ---------------------------------------------------------------------------
 * LA MAREA — SEA_PLAY.md item 1, as a curve rather than as a claim.
 *
 * One ring, one pilot, one set of seeds. The only thing that moves down a
 * column is how long the ship stays out before turning for home, so `vuelve`
 * falling down the column IS the tide — except that staying out longer costs
 * something in any sea, which is why `sin marea` runs the identical fleet with
 * the tide switched off through the loadout (`tideRate: 0`). The gap between
 * the two survival columns is the part the tide is responsible for.
 */
console.log(`\n${BOLD}La marea sube${OFF} ${DIM}— el mismo viaje, quedándose fuera más tiempo · «sin marea» es el mismo mar con el reloj parado${OFF}\n`);

// Rings 1 to 3, which is where the base survival is high enough that a FALL is
// attributable. Ring 4 and 5 already kill the majority of a loitering fleet on
// their own — the sweep at the top of this file says so — and a column that
// starts at 30% cannot show anything about a tide.
const LOITERS = [0, 60, 120, 180, 240];
for (const [ring, skill] of [[1, 'novato'], [2, 'novato'], [3, 'veterano']]) {
  console.log(`  ${DIM}anillo ${ring} · ${skill}${OFF}`);
  table(tideSweep(runs, ring, skill, LOITERS), [
    { head: 'fuera', cell: (r) => `${r.loiter}s` },
    { head: 'marea', cell: (r) => r.tide.toFixed(2) },
    { head: 'oleadas', cell: (r) => r.swells.toFixed(1) },
    { head: 'vuelve', cell: (r) => pct(r.survived) },
    { head: 'sin marea', cell: (r) => pct(r.flat) },
    { head: 'diferencia', cell: (r) => `${((r.survived - r.flat) * 100).toFixed(0)}pp` },
    { head: 't.viaje', cell: (r) => secs(r.seconds) },
    { head: 'casco', cell: (r) => pct(r.hull) },
    { head: 'carga', cell: (r) => Math.round(r.cargo) },
    { head: 'bajas', cell: (r) => r.kills.toFixed(1) },
  ]);
  console.log('');
}

/* ---------------------------------------------------------------------------
 * EL PESO — SEA_PLAY.md item 2. The same escape, run twice on the same seeds
 * from the same water with the same hull: hold empty against hold full.
 */
console.log(`${BOLD}Volver a casa con la bodega llena o vacía${OFF} ${DIM}— mismas semillas, mismo casco, misma agua${OFF}\n`);

table(
  [[3, 1], [4, 1], [4, 0.4], [5, 0.4]].map(([ring, hull]) => weightRun(runs, ring, hull)),
  [
    { head: 'anillo', cell: (r) => r.ring },
    { head: 'casco', cell: (r) => pct(r.hull) },
    { head: 'vacía: llega', cell: (r) => pct(r.emptyHome) },
    { head: 'vacía: seg', cell: (r) => r.emptySeconds.toFixed(1) },
    { head: 'vacía: casco', cell: (r) => pct(r.emptyHull) },
    { head: 'llena: llega', cell: (r) => pct(r.fullHome) },
    { head: 'llena: seg', cell: (r) => r.fullSeconds.toFixed(1) },
    { head: 'llena: casco', cell: (r) => pct(r.fullHull) },
    { head: 'coste', cell: (r) => `+${(r.fullSeconds - r.emptySeconds).toFixed(1)}s` },
  ]
);

console.log(`\n${BOLD}Todo a estribor y a ver qué pasa${OFF} ${DIM}— acelerador abierto, timón fijo, sin tocar nada${OFF}\n`);

const control = [15, 30, 45, 60, 90].map((seconds) => {
  const fleet = Array.from({ length: runs }, (_, i) => straightOut(`straight${i}`, seconds));
  const sunk = fleet.filter((r) => r.outcome === 'sunk');
  return {
    seconds,
    sunk: sunk.length / fleet.length,
    hull: fleet.reduce((a, r) => a + r.hull, 0) / fleet.length,
    reached: fleet.reduce((a, r) => a + r.reached, 0) / fleet.length,
    distance: fleet.reduce((a, r) => a + r.distance, 0) / fleet.length,
    mob: fleet.reduce((a, r) => a + r.damageFromMobs, 0) / fleet.length,
    reef: fleet.reduce((a, r) => a + r.damageFromReefs, 0) / fleet.length,
  };
});

table(control, [
  { head: 'segundos', cell: (r) => r.seconds },
  { head: 'hundido', cell: (r) => pct(r.sunk) },
  { head: 'casco medio', cell: (r) => pct(r.hull) },
  { head: 'anillo medio', cell: (r) => r.reached.toFixed(1) },
  { head: 'distancia', cell: (r) => Math.round(r.distance) },
  { head: 'daño bicho', cell: (r) => Math.round(r.mob) },
  { head: 'daño roca', cell: (r) => Math.round(r.reef) },
]);

console.log(`\n${BOLD}Romper el combate y correr a casa${OFF} ${DIM}— casco tocado, bodega llena, rumbo a puerto${OFF}\n`);

const escapes = [[3, 0.4], [4, 0.4], [4, 0.25], [5, 0.4]].map(([ring, hull]) => {
  const fleet = Array.from({ length: runs }, (_, i) => breakOff(`escape${ring}-${hull}-${i}`, ring, hull));
  return {
    ring, hull,
    home: fleet.filter((r) => r.outcome === 'home').length / fleet.length,
    sunk: fleet.filter((r) => r.outcome === 'sunk').length / fleet.length,
    seconds: fleet.reduce((a, r) => a + r.seconds, 0) / fleet.length,
  };
});

table(escapes, [
  { head: 'anillo', cell: (r) => r.ring },
  { head: 'casco al huir', cell: (r) => pct(r.hull) },
  { head: 'llega a casa', cell: (r) => pct(r.home) },
  { head: 'hundido', cell: (r) => pct(r.sunk) },
  { head: 'segundos', cell: (r) => r.seconds.toFixed(0) },
]);

console.log(`\n${BOLD}Tiempo en hundir un bicho${OFF} ${DIM}— uno solo, a la banda, sin nadie más${OFF}\n`);
table(
  ['blowfish', 'kelpling', 'hammerdead', 'squid'].map((kind) => ({ kind, t: timeToKill(kind) })),
  [
    { head: 'bicho', cell: (r) => r.kind },
    { head: 'tiempo', cell: (r) => (Number.isFinite(r.t) ? `${r.t.toFixed(1)}s` : 'nunca') },
  ]
);
console.log('');
