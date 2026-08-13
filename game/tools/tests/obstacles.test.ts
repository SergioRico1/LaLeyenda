import {
  BALANCE, MINUTE, buildersFree, clearObstacle, clearRefusal, createNewGame, islandCentreCell,
  obstacleAt, obstacleUnder, place, plotHalf, reseedObstaclesInPlace, seedObstaclesInPlace,
  spotRefusal, spotRefusalNow, storeCap, tick,
  type GameState,
} from '../../src/sim';
import { generateIsland, isBuildable } from '../../src/render/island';
import { planDecor } from '../../src/scenes/decor';
import { describe, eq, ok, test } from './harness';
import { T0, TZ } from './fixtures';

/**
 * obstacles.test.ts — OPENING.md part 3, the load-bearing one.
 *
 *   > The empty land is covered in OBSTACLES — trees, rocks, bushes — that you
 *   > clear for a small resource payout and a short builder timer. Part 3 is the
 *   > one everybody forgets, and it is load-bearing. Without it a Clash base on
 *   > day one would be a vast green void with a single building in the middle.
 *
 * Four things have to be true or the concept does not do its job, and each one
 * of them is a silent failure: the field has to be DENSE enough that day one is
 * not a barren field, it has to be THIN enough near the hall that the first
 * building has somewhere to go, it has to be ON THE ISLAND, and it must not
 * fight `src/scenes/decor.ts` over the same cells.
 */

const GRID = BALANCE.island.grid;
const SEEDS = [
  'la-leyenda', 'retencion', 'a', 'bahia', 'tortuga', 'xyz', 'q7', 'zz', 'mm', 'kk',
  'beats', 'first', 'perezoso', 'test', 'resolver-24h', 'demo', 'seed1', 'seed2', 'hola', 'pirata',
];

const fresh = (seed = 'la-leyenda'): GameState => createNewGame(seed, T0, TZ);

const buildableCells = (seed: string): number => {
  const shape = generateIsland(seed, GRID);
  let n = 0;
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) if (isBuildable(shape, x, z)) n++;
  return n;
};

describe('the field itself', () => {
  test('day one is not a barren field — obstacles cover a real share of the island', () => {
    // The whole objection to a big fixed island was that day one would look
    // empty, and this is the answer to it. A number rather than a feeling: the
    // shipped reference puts buildings at roughly a quarter to a third of the
    // land, and this covers a comparable share with things to clear.
    let worst = { seed: '', share: 1 };
    for (const seed of SEEDS) {
      const state = fresh(seed);
      const share = state.obstacles.length / buildableCells(seed);
      if (share < worst.share) worst = { seed, share };
      ok(state.obstacles.length >= 90, `${seed}: only ${state.obstacles.length} obstacles on a ${GRID} grid`);
      ok(share >= 0.1, `${seed}: obstacles cover ${(share * 100).toFixed(1)}% of the buildable island`);
    }
    console.log(`      thinnest island: ${(worst.share * 100).toFixed(1)}% cover on "${worst.seed}"`);
  });

  test('every obstacle stands on the island, and all but a handful on the plateau', () => {
    // The sim owns no heightmap, so the default field is seeded inside a
    // superellipse measured to survive every seed's coastline. This is the
    // measurement, re-run against the real generator: nothing may ever land in
    // the sea, and the beach is a rounding error rather than a habit.
    let worstOff = { seed: '', off: 0, total: 0 };
    for (const seed of SEEDS) {
      const state = fresh(seed);
      const shape = generateIsland(seed, GRID);
      let off = 0;
      for (const o of state.obstacles) {
        ok(
          shape.cells[o.z * GRID + o.x].height > 0,
          `${seed}: a ${o.kind} at ${o.x},${o.z} is standing in the sea`
        );
        if (!isBuildable(shape, o.x, o.z)) off++;
      }
      if (off > worstOff.off) worstOff = { seed, off, total: state.obstacles.length };
      ok(
        off / state.obstacles.length <= 0.06,
        `${seed}: ${off}/${state.obstacles.length} obstacles missed the plateau`
      );
    }
    console.log(`      worst seed "${worstOff.seed}": ${worstOff.off}/${worstOff.total} off the plateau, 0 in the water`);
  });

  test('they thin out around the Ayuntamiento, and the first building always fits', () => {
    // "so the first building has somewhere to go" — checked by actually going
    // there. A fresh player's opening move being refused by their own scenery
    // is the worst possible first tap.
    for (const seed of SEEDS) {
      const state = fresh(seed);
      const hall = state.buildings[0];
      const shape = generateIsland(seed, GRID);

      for (const o of state.obstacles) {
        const d = Math.max(Math.abs(o.x - hall.x), Math.abs(o.z - hall.z));
        ok(d >= BALANCE.obstacles.clearingRadius, `${seed}: a ${o.kind} is ${d} cells from the hall`);
      }

      // Somewhere an Aserradero could actually stand: on land, clear of the
      // hall's plot AND its clearance, and with nothing growing on it.
      let spot: { x: number; z: number } | null = null;
      for (let z = 0; z < GRID && !spot; z++) {
        for (let x = 0; x < GRID && !spot; x++) {
          const half = plotHalf('aserradero');
          let land = true;
          for (let dz = -1; dz <= 1 && land; dz++) {
            for (let dx = -1; dx <= 1 && land; dx++) if (!isBuildable(shape, x + dx, z + dz)) land = false;
          }
          if (land && spotRefusalNow(state, 'aserradero', x, z) === null && half > 0) spot = { x, z };
        }
      }
      ok(spot !== null, `${seed}: nowhere on the island to put the first Aserradero`);
    }
  });

  test('the same seed always grows the same island', () => {
    const a = fresh('determinism');
    const b = fresh('determinism');
    eq(JSON.stringify(a.obstacles), JSON.stringify(b.obstacles), 'byte for byte');
    ok(
      JSON.stringify(fresh('otra').obstacles) !== JSON.stringify(a.obstacles),
      'and a different seed grows a different one'
    );
  });

  test('the field is off the sim RNG stream, so play does not reshuffle the island', () => {
    // Seeded off `${seed}:obstacles` rather than off `state.rngState`. If it
    // came off the sim cursor, an island rolled after a chest opened would be a
    // different island — and the player's own ground would move under them
    // between one save and the next.
    const state = fresh('cursor');
    const played = { ...state, rngState: (state.rngState ^ 0x5f5f5f5f) >>> 0, obstacles: [] };
    seedObstaclesInPlace(played);
    eq(JSON.stringify(played.obstacles), JSON.stringify(state.obstacles), 'a moved cursor grows the same island');
  });
});

describe('clearing one', () => {
  test('it costs a builder and a timer, and pays exactly ONCE', () => {
    // The bug this exists for: an obstacle whose payout is applied on every
    // tick that sees it finished, or that survives its own clear and can be
    // farmed. Both are silent — nothing throws, the player just gets rich.
    let state = fresh('pago');
    const target = state.obstacles.find((o) => o.tier === 'small')!;
    const before = state.store.madera;
    const gemsBefore = state.gems;
    const freeBefore = buildersFree(state, T0);

    state = clearObstacle(state, target.id, T0).state;
    eq(buildersFree(state, T0), freeBefore - 1, 'a carpenter is on it');
    eq(state.store.madera, before, 'and nothing is paid up front');

    // Half way through: still standing, still nothing paid.
    state = tick(state, T0 + BALANCE.obstacles.small.timeMs / 2).state;
    ok(state.obstacles.some((o) => o.id === target.id), 'still there mid-timer');
    eq(state.store.madera, before, 'still unpaid mid-timer');

    const done = tick(state, T0 + BALANCE.obstacles.small.timeMs);
    state = done.state;
    const paid = done.events.filter((e) => e.type === 'obstacle-cleared');
    eq(paid.length, 1, 'exactly one clear event');
    eq(state.store.madera, before + target.pays.madera, 'the stored roll is what landed');
    eq(state.gems, gemsBefore + target.pays.gems, 'and its gems');
    eq(buildersFree(state, T0 + BALANCE.obstacles.small.timeMs), freeBefore, 'the carpenter is back');

    // Ticking on, and on, must never pay again.
    const after = tick(state, T0 + 6 * MINUTE);
    eq(after.state.store.madera, before + target.pays.madera, 'a later tick pays nothing more');
    eq(after.events.filter((e) => e.type === 'obstacle-cleared').length, 0, 'and announces nothing');
    ok(!after.state.obstacles.some((o) => o.id === target.id), 'the obstacle is gone for good');
    eq(after.state.stats.obstacles, 1, 'and the Diario counted it exactly once');
  });

  test('clearing three in one absence pays all three, once each', () => {
    let state = fresh('ausencia');
    state = { ...state, builders: { owned: 3, tempUntil: null } };
    const targets = state.obstacles.filter((o) => o.tier === 'small').slice(0, 3);
    const owed = targets.reduce((sum, o) => sum + o.pays.madera, 0);
    const before = state.store.madera;
    for (const o of targets) state = clearObstacle(state, o.id, T0).state;

    const done = tick(state, T0 + 30 * MINUTE);
    eq(done.events.filter((e) => e.type === 'obstacle-cleared').length, 3, 'three events');
    eq(done.state.store.madera, before + owed, 'three payouts');
    eq(done.summary.obstaclesCleared, 3, 'and the welcome-back summary says so');
  });

  test('the payout obeys the store cap like every other income', () => {
    // A payout that could exceed the store would make upgrading the Almacén
    // pointless, and announcing a roll the store ate is the worst lie a reward
    // can tell.
    let state = fresh('tope');
    const cap = storeCap(state, 'madera');
    state = { ...state, store: { ...state.store, madera: cap } };
    const target = state.obstacles.find((o) => o.tier === 'small')!;
    state = clearObstacle(state, target.id, T0).state;
    const done = tick(state, T0 + BALANCE.obstacles.small.timeMs);
    eq(done.state.store.madera, cap, 'the store did not go over');
    const event = done.events.find((e) => e.type === 'obstacle-cleared')!;
    eq(event.type === 'obstacle-cleared' ? event.madera : -1, 0, 'and the event reports what LANDED, not what was rolled');
  });

  test('every refusal names its key', () => {
    const state = fresh('rechazo');
    const target = state.obstacles[0];
    eq(clearRefusal(state, 9999, 2), 'unknown-obstacle', 'one that is already cleared');
    eq(clearRefusal(state, target.id, 0), 'no-builders', 'with every carpenter out');
    const busy = clearObstacle(state, target.id, T0).state;
    eq(clearRefusal(busy, target.id, 2), 'busy', 'and one already being worked on');
    ok(!clearObstacle(busy, target.id, T0).ok, 'so a second tap does nothing');
  });

  test('a large obstacle is a real timer and a real payout', () => {
    const state = fresh('grande');
    const big = state.obstacles.find((o) => o.tier === 'large');
    ok(big !== undefined, 'the field has some');
    ok(BALANCE.obstacles.large.timeMs > BALANCE.obstacles.small.timeMs, 'it takes longer');
    ok(big!.pays.madera >= BALANCE.obstacles.large.madera[0], 'and pays more');
  });
});

describe('obstacles and buildings share the ground, and the rules say who wins', () => {
  test('a building may not be placed on top of one', () => {
    const state = fresh('encima');
    const target = state.obstacles.find(
      (o) => spotRefusal(state, 'aserradero', o.x, o.z) === null
    )!;
    ok(target !== undefined, 'there is a cell that is legal but for the obstacle');
    eq(spotRefusalNow(state, 'aserradero', target.x, target.z), 'obstacle', 'the ghost goes red');
    const attempt = place({ ...state, store: { ...state.store, madera: 5000 } }, 'aserradero', target.x, target.z, T0);
    ok(!attempt.ok, 'and the confirm is refused');
    eq(attempt.refusal, 'obstacle', 'by the palm, not by the price');
  });

  test('a plot is refused for an obstacle under its EDGE, not only its centre', () => {
    const state = fresh('borde');
    const target = state.obstacles[0];
    const half = plotHalf('aserradero');
    ok(obstacleUnder(state, target.x, target.z, half) !== null, 'dead centre');
    ok(obstacleUnder(state, target.x + 1, target.z, half) !== null, 'and one cell over, still under the roof');
    ok(obstacleAt(state, target.x + 1, target.z) !== target, 'though the cell itself is a different one');
  });

  test('clearing it opens the ground it was standing on', () => {
    let state = fresh('abre');
    const target = state.obstacles.find((o) => spotRefusal(state, 'aserradero', o.x, o.z) === null)!;
    eq(spotRefusalNow(state, 'aserradero', target.x, target.z), 'obstacle', 'shut while it stands');
    state = { ...state, builders: { owned: 4, tempUntil: null } };
    // Everything within a plot's reach has to go, not only the one cell.
    for (const o of state.obstacles.filter((o) => obstacleUnder({ ...state, obstacles: [o] }, target.x, target.z, plotHalf('aserradero')))) {
      state = clearObstacle(state, o.id, state.now).state;
      state = tick(state, state.now + BALANCE.obstacles.large.timeMs).state;
    }
    eq(spotRefusalNow(state, 'aserradero', target.x, target.z), null, 'and open once they are gone');
  });

  test('the two scatter systems never contest a cell', () => {
    // OPENING.md's one warning: decor.ts already scatters props for looks and
    // has a test keeping them off ground a building could claim; obstacles are
    // the opposite and DO occupy that ground. "Two systems, one visual language,
    // and they must not fight over the same cells."
    //
    // They cannot, and the reason is structural rather than lucky: decor builds
    // its reserved mask out of `spotRefusal`, which answers PERMANENT geometry
    // only. An obstacle is transient, so it is invisible to that mask, so the
    // ground under it stays reserved against decoration for exactly as long as a
    // building could one day stand there. Fusing the obstacle check into
    // `spotRefusal` would open every one of these cells to the scatter.
    const seed = 'la-leyenda';
    const state = fresh(seed);
    const shape = generateIsland(seed, GRID);
    const taken = new Set(state.obstacles.map((o) => o.z * GRID + o.x));

    let checked = 0;
    for (const prop of planDecor(shape, state, seed)) {
      const x = Math.round(prop.position.x / 1 + (GRID - 1) / 2);
      const z = Math.round(prop.position.z / 1 + (GRID - 1) / 2);
      if (x < 0 || z < 0 || x >= GRID || z >= GRID) continue;
      checked++;
      ok(!taken.has(z * GRID + x), `a ${prop.model} is planted on an obstacle at ${x},${z}`);
    }
    ok(checked > 40, `the decor plan should actually contain props (saw ${checked})`);
  });
});

describe('re-seeding against terrain the scene actually knows', () => {
  test('a caller with a real heightmap can widen the field to the whole plateau', () => {
    const seed = 'resiembra';
    const shape = generateIsland(seed, GRID);
    const state = fresh(seed);
    const before = state.obstacles.length;

    const widened = { ...state, obstacles: [...state.obstacles] };
    ok(reseedObstaclesInPlace(widened, (x, z) => isBuildable(shape, x, z)), 'it re-seeded');
    ok(widened.obstacles.length > before, `${before} → ${widened.obstacles.length} once the terrain is known`);
    for (const o of widened.obstacles) {
      ok(isBuildable(shape, o.x, o.z), `a ${o.kind} at ${o.x},${o.z} is off the plateau`);
    }
  });

  test('it refuses to regrow ground the player has already paid to clear', () => {
    let state = fresh('respeto');
    const target = state.obstacles[0];
    state = clearObstacle(state, target.id, T0).state;
    ok(!reseedObstaclesInPlace(state, () => true), 'not while a carpenter is mid-job');
    state = tick(state, T0 + 30 * MINUTE).state;
    ok(!reseedObstaclesInPlace(state, () => true), 'and not once anything has been cleared');
  });
});

describe('the island is fixed, and the sim and the balance agree on how big', () => {
  test('the grid is one number, read from balance.json, and the hall sits on its centre', () => {
    // reference/SPACING.md: eleven buildings need 283 cells for their footprints
    // alone and a 26 grid offers 255 — they do not fit at all. 44 is the size
    // that puts footprints at the ~31% coverage the shipped game sits at, and
    // OPENING.md fixes it from day one so no plateau ever moves under a save.
    eq(BALANCE.island.grid, 44, 'forty-four, per OPENING.md');
    eq(islandCentreCell(), 22, 'and its centre cell');
    eq(fresh().buildings[0].x, islandCentreCell(), 'which is where the hall stands');
    for (const seed of SEEDS.slice(0, 6)) {
      ok(buildableCells(seed) > 850, `${seed}: ${buildableCells(seed)} buildable cells`);
    }
  });
});
