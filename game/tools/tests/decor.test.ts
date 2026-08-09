import { generateIsland, isBuildable, worldToCell } from '../../src/render/island';
import { BALANCE, createDemoIsland, createNewGame, plotHalf, spotRefusal, type GameState } from '../../src/sim';
import { decorCells, planDecor, planObstacles, reservedMask } from '../../src/scenes/decor';
import { describe, eq, ok, test } from './harness';

/**
 * The island's dressing may never stand where a building could.
 *
 * This is the one rule the composition has to keep, and it is the kind that
 * decays quietly: a prop dropped on a plot does not throw, does not fail tsc,
 * and does not look wrong until the day a player tries to build there and finds
 * a palm growing through the roof. So it is asserted here rather than trusted.
 *
 * The check is deliberately independent of decor.ts's own zoning — it re-derives
 * "could a building stand here" straight from the sim (`spotRefusal`, `plotHalf`)
 * and the terrain (`isBuildable`), then asserts no planned prop lands on it.
 */

const SEED = 'la-leyenda';
const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);
// The island that SHIPS, not a number typed here. OPENING.md fixed the grid at
// 44 and islandScene.ts generates its terrain from `island.grid`; this file was
// still asserting the rule against a 26-cell island nobody renders, so the whole
// suite was passing on a map with a different coastline, different plateau and a
// different free set from the one a player boots into.
const SIZE = BALANCE.island.grid;

// The non-waterfront catalogue: a Muelle is placed at its stored cell rather
// than snapped onto the plateau, so the plateau test below does not describe it.
const BUILD_TYPES = [
  'ayuntamiento', 'aserradero', 'mercado', 'destileria', 'fundicion',
  'almacen', 'banco', 'bodega', 'deposito', 'astillero',
];

/** Every cell some future building could stand on or claim, derived here. */
function claimable(shape: ReturnType<typeof generateIsland>, state: GameState): Set<number> {
  const out = new Set<number>();
  for (const type of BUILD_TYPES) {
    const half = plotHalf(type);
    const lo = -Math.floor(half - 0.001);
    const hi = Math.floor(half - 0.001);
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        let fits = true;
        for (let dz = lo; dz <= hi && fits; dz++) {
          for (let dx = lo; dx <= hi && fits; dx++) {
            if (!isBuildable(shape, x + dx, z + dz)) fits = false;
          }
        }
        if (!fits || spotRefusal(state, type, x, z) !== null) continue;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) >= half || Math.abs(dz) >= half) continue;
            out.add((z + dz) * SIZE + (x + dx));
          }
        }
      }
    }
  }
  return out;
}

describe('the island dressing never stands on buildable ground', () => {
  for (const [label, make] of [
    ['the island a new player boots into', () => createNewGame(SEED, T0, 0)],
    ['the Ayuntamiento-4 fixture', () => createDemoIsland(SEED, T0, 0)],
  ] as const) {
    test(`${label} keeps every prop off ground a building could claim`, () => {
      const shape = generateIsland(SEED, SIZE);
      const state = make();
      const reserved = claimable(shape, state);

      let checked = 0;
      for (const prop of planDecor(shape, state, SEED)) {
        const cell = worldToCell(shape, prop.position.x, prop.position.z);
        if (cell.x < 0 || cell.z < 0 || cell.x >= SIZE || cell.z >= SIZE) continue;
        checked++;
        ok(
          !reserved.has(cell.z * SIZE + cell.x),
          `${prop.model} at cell ${cell.x},${cell.z} is on ground a building could be placed on`
        );
      }
      ok(checked > 80, `the plan should actually contain props (saw ${checked})`);
    });
  }

  test('the dressing and the wilderness never claim the same cell', () => {
    // OPENING.md's one warning about obstacles: "Two systems, one visual
    // language, and they must not fight over the same cells." Mostly the two are
    // complements — an obstacle stands on buildable ground and a prop may not —
    // but not entirely: the terrace lip and the building aprons are buildable
    // ground no FOOTPRINT fits on, so they fall out of the reserved mask and
    // back into the set decoration draws from. A bush standing in the hole a
    // player paid a builder to clear is the failure this catches.
    const shape = generateIsland(SEED, SIZE);
    const state = createNewGame(SEED, T0, 0);
    ok(state.obstacles.length > 20, `the island should have a field (saw ${state.obstacles.length})`);

    const wild = new Set(state.obstacles.map((o) => o.z * SIZE + o.x));
    for (const prop of planDecor(shape, state, SEED)) {
      const cell = worldToCell(shape, prop.position.x, prop.position.z);
      ok(
        !wild.has(cell.z * SIZE + cell.x),
        `${prop.model} at cell ${cell.x},${cell.z} stands on an obstacle`
      );
    }

    // And the wilderness stays on the island it was seeded for: the sim owns no
    // terrain, so it seeds inside a superellipse that is conservative rather
    // than exact, and a palm floating over the sea is the way that goes wrong.
    let drawn = 0;
    for (const prop of planObstacles(shape, state, SEED)) {
      const cell = worldToCell(shape, prop.position.x, prop.position.z);
      ok(
        cell.x >= 0 && cell.z >= 0 && cell.x < SIZE && cell.z < SIZE
        && shape.cells[cell.z * SIZE + cell.x].height > 0,
        `${prop.model} at cell ${cell.x},${cell.z} stands on water`
      );
      drawn++;
    }
    ok(drawn > state.obstacles.length, `every obstacle should be drawn (saw ${drawn})`);
  });

  test('decor.ts and the sim agree on which cells are reserved', () => {
    const shape = generateIsland(SEED, SIZE);
    const state = createNewGame(SEED, T0, 0);
    const mine = reservedMask(shape, state);
    const theirs = claimable(shape, state);
    for (let i = 0; i < SIZE * SIZE; i++) {
      eq(mine[i] === 1, theirs.has(i), `cell ${i % SIZE},${Math.floor(i / SIZE)} disagrees`);
    }
  });

  test('building on a free cell only ever frees MORE ground for decoration', () => {
    // The invariant that lets decoration be planted once and never swept up: a
    // new building refuses more ground to future buildings than it claims for
    // itself, so the safe set grows monotonically as the island is built out.
    const shape = generateIsland(SEED, SIZE);
    const before = createNewGame(SEED, T0, 0);
    const safeBefore = new Set(decorCells(shape, before).map((c) => c.z * SIZE + c.x));

    // The invariant is geometric, so the building is appended directly rather
    // than placed: what is being tested is what a new plot does to the mask,
    // not whether this island can currently afford one.
    let spot: { x: number; z: number } | null = null;
    for (let z = 0; z < SIZE && !spot; z++) {
      for (let x = 0; x < SIZE && !spot; x++) {
        let fits = true;
        for (let dz = -1; dz <= 1 && fits; dz++) {
          for (let dx = -1; dx <= 1 && fits; dx++) if (!isBuildable(shape, x + dx, z + dz)) fits = false;
        }
        if (fits && spotRefusal(before, 'mercado', x, z) === null) spot = { x, z };
      }
    }
    ok(spot !== null, 'the island should have somewhere left to build');

    const after: GameState = {
      ...before,
      buildings: [
        ...before.buildings,
        { id: 99, type: 'mercado', x: spot!.x, z: spot!.z, level: 1, stock: 0, work: null },
      ],
    };
    const safeAfter = new Set(decorCells(shape, after).map((c) => c.z * SIZE + c.x));
    for (const cell of safeBefore) {
      ok(safeAfter.has(cell), `cell ${cell % SIZE},${Math.floor(cell / SIZE)} was decor-safe and stopped being so`);
    }
    ok(safeAfter.size > safeBefore.size, 'and the new building opens ground of its own');
  });
});
