import {
  BALANCE, MINUTE, buildCatalog, buildersFree, finishNowCost, place, placeRefusal, plotHalf,
  plotsOverlap, plotsTooClose, spotRefusal, startUpgrade, townHallUnlocks, upgradeGains,
  upgradePlan, upgradeRefusal, type GameState,
} from '../../src/sim';
import { generateIsland, isBuildable } from '../../src/render/island';
import { refusalText } from '../../src/ui/copy';
import { describe, deepEq, eq, ok, test } from './harness';
import { T0, find, quiet, rich } from './fixtures';

/**
 * §3.15 build mode and §3.16 the upgrade sheet — the sim half.
 *
 * These are the queries the two panels are built out of. They matter more than
 * their size suggests: before this slice existed, `place()` and `startUpgrade()`
 * were correct and dispatched by nothing a finger could reach, so nothing here
 * had ever been exercised by a real tap. A wrong refusal is not a crash, it is
 * a greyed button with a sentence under it that is not true.
 */

const hallAt = (state: GameState, level: number): GameState => ({
  ...state,
  buildings: state.buildings.map((b) => (b.type === 'ayuntamiento' ? { ...b, level } : b)),
});

describe('§3.15 the picker list', () => {
  test('the catalogue is every building, not only the placeable ones', () => {
    const state = quiet();
    const rows = buildCatalog(state, T0);
    const types = rows.map((r) => r.type);
    ok(types.includes('fundicion'), 'a Fundición four hall levels away is still listed');
    ok(!types.includes('ayuntamiento'), 'but the Ayuntamiento is not a thing you place');
    eq(rows.length, Object.values(BALANCE.buildings).filter((b) => b.kind !== 'townhall').length, 'all of them');
  });

  test('every row carries the reason it is greyed, and they are different reasons', () => {
    const state = quiet();   // Ayuntamiento 1, one of every unlocked building
    const by = new Map(buildCatalog(state, T0).map((r) => [r.type, r]));

    eq(by.get('aserradero')!.refusal, 'max-count', 'one Aserradero is all Ayto 1 allows');
    eq(by.get('aserradero')!.owned, 1, 'and the row says 1/1');
    eq(by.get('aserradero')!.allowed, 1, '');
    eq(by.get('destileria')!.refusal, 'town-hall-too-low', 'the Destilería needs a bigger hall');
    eq(by.get('destileria')!.unlockAtTownHall, 2, 'and the row knows which one to name');
    ok(!by.get('destileria')!.unlocked, 'so it draws as a promise rather than an option');
  });

  test('"you already have the maximum" and "your hall is too small" are not the same sentence', () => {
    // Both used to answer `town-hall-too-low`, which reads as a lie next to a
    // 1/1 counter — the player raises the Ayuntamiento and the row still says
    // no, for a reason the game never mentioned.
    const state = quiet();
    eq(placeRefusal(state, 'aserradero', T0), 'max-count', 'the slot is taken');
    eq(placeRefusal(state, 'fundicion', T0), 'town-hall-too-low', 'the hall is the wall');
  });

  test('a row opens up the moment the Ayuntamiento does', () => {
    const state = rich();
    eq(placeRefusal(state, 'destileria', T0), 'town-hall-too-low', 'shut at Ayto 1');
    eq(placeRefusal(hallAt(state, 2), 'destileria', T0), null, 'open at Ayto 2');
  });

  test('cost and time on a row are the level-1 row the sim will actually charge', () => {
    const row = buildCatalog(rich(), T0).find((r) => r.type === 'muelle')!;
    const spec = BALANCE.buildings.muelle.levels[0];
    deepEq(row.cost, spec.cost, 'same cost');
    eq(row.timeMs, spec.timeMs, 'same time');
  });

  test('with no builder free, every row says so', () => {
    let state = rich();
    state = startUpgrade(state, find(state, 'almacen').id, T0).state;
    state = startUpgrade(state, find(state, 'banco').id, T0).state;
    eq(buildersFree(state, T0), 0, 'both are out');
    for (const row of buildCatalog(hallAt(state, 4), T0)) {
      if (row.refusal === 'max-count' || row.refusal === 'town-hall-too-low') continue;
      eq(row.refusal, 'no-builders', `${row.type} blames the carpenter, not the price`);
    }
  });
});

describe('§3.15 where the ghost may land', () => {
  test('a plot is narrower than the model that stands on it', () => {
    // `footprint` is how wide the MODEL is fitted; the shipped layouts let roofs
    // and jetties overhang. Fusing the two would make an island the renderer was
    // tuned against illegal by its own rule.
    ok(plotHalf('muelle') < BALANCE.buildings.muelle.footprint / 2, 'the plot is the smaller of the two');
  });

  test('two plots that share ground overlap; touching ones do not', () => {
    const a = { type: 'aserradero', x: 10, z: 10 };
    ok(plotsOverlap(a, { type: 'aserradero', x: 11, z: 10 }), 'one cell apart is a collision');
    ok(!plotsOverlap(a, { type: 'aserradero', x: 13, z: 10 }), 'three cells apart is not');
  });

  test('the ghost is refused on top of something already built', () => {
    const state = rich();
    const saw = find(state, 'aserradero');
    eq(spotRefusal(state, 'mercado', saw.x, saw.z), 'cell-occupied', 'right on top of it');
    eq(spotRefusal(state, 'mercado', 2, 2), null, 'and clear in an empty corner');
  });
});

/* --------------------------------------------------------------------------
 * reference/SPACING.md — nothing abuts
 * ----------------------------------------------------------------------- */

describe('reference/SPACING.md — buildings keep their distance', () => {
  /**
   * The measurement this enforces, off two official screenshots of a Pirate
   * Nation starter island:
   *
   *   > Every building has clearance on all sides. No two structures touch, and
   *   > none shares a silhouette edge with another. The gap between neighbours
   *   > is on the order of a building's own width — enough that each reads as a
   *   > separate object at a glance, and enough for its cast shadow to land on
   *   > open ground rather than on the next roof.
   *
   * It lives in the placement rules and not in the renderer because it is a rule
   * about the LAYOUT, and the layout is data. Every blind judge so far has
   * picked the shipped game "obvious at a glance", and the reason they gave in
   * round 3 was silhouettes merging — *"packed roof-edge to roof-edge with no
   * gaps; you cannot count the buildings"*. No amount of re-lighting fixes that.
   */
  const alone = (): GameState => ({
    ...rich(),
    buildings: [{ id: 1, type: 'aserradero', x: 20, z: 20, level: 1, stock: 0, work: null }],
    obstacles: [],
  });

  test('a legal, non-overlapping spot can still be too close — and says so', () => {
    const state = alone();
    // Two footprint-5 plots are 3 cells wide, so 3 apart is the tightest that
    // does not overlap. Under the clearance rule that is now a refusal, and a
    // DIFFERENT refusal: "Aquí no cabe" would be a lie about ground that is free.
    ok(!plotsOverlap({ type: 'mercado', x: 23, z: 20 }, state.buildings[0]), 'nothing is overlapping');
    eq(spotRefusal(state, 'mercado', 23, 20), 'too-close', 'and it is still refused');
    ok(plotsTooClose({ type: 'mercado', x: 23, z: 20 }, state.buildings[0]), 'by the clearance rule');
  });

  test('the gap it enforces is a full building wide, in cells', () => {
    const state = alone();
    const clearance = BALANCE.placement.clearance;
    const need = plotHalf('aserradero') + plotHalf('mercado') + clearance;
    ok(clearance >= 1, `at least one empty cell (${clearance})`);
    for (let d = 0; d < Math.ceil(need); d++) {
      ok(spotRefusal(state, 'mercado', 20 + d, 20) !== null, `${d} cells apart is refused`);
    }
    eq(spotRefusal(state, 'mercado', 20 + Math.ceil(need), 20), null, `${Math.ceil(need)} apart is allowed`);
    // The plots are 3 cells wide each, so the first legal gap is 2 empty cells —
    // "on the order of a building's own width", as measured.
    eq(Math.ceil(need) - (plotHalf('aserradero') + plotHalf('mercado')), clearance, 'and the gap IS the clearance');
  });

  test('it applies on the diagonal too, not only along an axis', () => {
    const state = alone();
    eq(spotRefusal(state, 'mercado', 23, 23), 'too-close', 'corner to corner is still touching');
    eq(spotRefusal(state, 'mercado', 25, 25), null, 'and clear once both axes clear');
  });

  test('the refusal reaches the confirm tap, not only the ghost', () => {
    const state = alone();
    const result = place(state, 'mercado', 23, 20, T0);
    ok(!result.ok, 'a stale panel cannot sneak one in');
    eq(result.refusal, 'too-close', 'and it names the key');
    eq(result.state.store.madera, state.store.madera, 'a refused placement charges nothing');
  });

  test('the UI has a line for it, so the ghost is never red without a reason', () => {
    // §3.5: a tap is never silent. A refusal the copy table does not know falls
    // through to "No disponible", which tells the player nothing about what to do.
    eq(refusalText('too-close'), 'Demasiado pegado', 'named');
    ok(refusalText('too-close') !== refusalText('cell-occupied'), 'and not the same sentence as an overlap');
  });

  test('the 44 grid can hold the whole catalogue WITH the clearance', () => {
    // reference/SPACING.md's third change: *size the island against what it must
    // hold*. If the grid cannot fit every building the Ayuntamiento unlocks with
    // the gap applied, the island is too small and the buildings will crowd
    // however the props are tuned. So: place one of everything, greedily, on the
    // real terrain, and count what is left over.
    const shape = generateIsland('la-leyenda', BALANCE.island.grid);
    const size = BALANCE.island.grid;
    let state: GameState = {
      ...rich(),
      buildings: [{ id: 1, type: 'ayuntamiento', x: 22, z: 22, level: 8, stock: 0, work: null }],
      obstacles: [],
      nextBuildingId: 2,
    };

    const types = Object.entries(BALANCE.buildings)
      .filter(([, spec]) => spec.kind !== 'townhall')
      .flatMap(([type, spec]) => Array.from({ length: spec.countByTownHall[7] }, () => type));

    let placed = 0;
    for (const type of types) {
      const half = BALANCE.buildings[type].footprint * BALANCE.placement.plotFactor / 2;
      const reach = Math.floor(half - 0.001);
      let done = false;
      for (let z = 0; z < size && !done; z++) {
        for (let x = 0; x < size && !done; x++) {
          let land = true;
          for (let dz = -reach; dz <= reach && land; dz++) {
            for (let dx = -reach; dx <= reach && land; dx++) if (!isBuildable(shape, x + dx, z + dz)) land = false;
          }
          if (!land || spotRefusal(state, type, x, z) !== null) continue;
          state = { ...state, buildings: [...state.buildings, { id: state.nextBuildingId, type, x, z, level: 1, stock: 0, work: null }], nextBuildingId: state.nextBuildingId + 1 };
          placed++;
          done = true;
        }
      }
      ok(done, `nowhere left for a ${type} — the island cannot hold its own catalogue`);
    }
    console.log(`      ${placed + 1} buildings placed on a ${size} grid with ${BALANCE.placement.clearance} cells of clearance`);
  });

  test('confirming re-checks BOTH halves, so a stale panel cannot be raced', () => {
    const state = hallAt(rich(), 2);
    const saw = find(state, 'aserradero');
    // The picker said yes — a second Aserradero is allowed at Ayto 2 — but the
    // finger is over the first one.
    eq(placeRefusal(state, 'aserradero', T0), null, 'the type is fine');
    const result = place(state, 'aserradero', saw.x, saw.z, T0);
    ok(!result.ok, 'and the placement is still refused');
    eq(result.refusal, 'cell-occupied', 'by the cell, not by the cost');
    eq(result.state.store.madera, state.store.madera, 'a refused placement charges nothing');
  });

  test('a confirmed placement spends a builder and starts a real timer', () => {
    const state = hallAt(rich(), 2);
    const before = buildersFree(state, T0);
    const result = place(state, 'aserradero', 3, 3, T0);
    ok(result.ok, 'it went through');

    const built = result.state.buildings.find((b) => b.x === 3 && b.z === 3)!;
    eq(built.level, 0, '§3.11 — the plot exists at level 0 while the timer runs');
    eq(built.work!.kind, 'build', 'wearing a build job');
    eq(built.work!.endsAt - T0, 2 * MINUTE, 'for the table time');
    eq(buildersFree(result.state, T0), before - 1, 'and one carpenter is now busy');
    eq(result.state.store.madera, state.store.madera - 300, 'the cost was paid up front');
  });
});

describe('§3.16 what the sheet promises', () => {
  test('a producer promises both of its numbers, from the rows the sim charges', () => {
    const saw = find(quiet(), 'aserradero');
    const gains = upgradeGains(saw);
    const rows = BALANCE.buildings.aserradero.levels;
    deepEq(
      gains,
      [
        { metric: 'rate', from: rows[0].rate, to: rows[1].rate },
        { metric: 'capacity', from: rows[0].capacity, to: rows[1].capacity },
      ],
      'rate and its own capacity, Nv1 → Nv2'
    );
  });

  test('a store promises one, and the Ayuntamiento promises unlocks instead', () => {
    const state = quiet();
    eq(upgradeGains(find(state, 'almacen'))[0].metric, 'storage', 'the Almacén sells storage');
    eq(upgradeGains(find(state, 'muelle')).length, 0, 'a support building has no figure to sell');
    ok(townHallUnlocks(2).includes('destileria'), 'the hall sells what it opens');
  });

  test('nothing is promised at the top of the ladder', () => {
    const state = quiet();
    const dock = find(state, 'muelle');
    eq(upgradePlan(dock), null, 'the Muelle is Nv1 and stays Nv1');
    eq(upgradeRefusal(state, dock, T0), 'max-level', 'and the sheet says exactly that');
    deepEq(upgradeGains(dock), [], 'with no table to show');
  });

  test('the refusal names the key, and a different key each time', () => {
    const poor = quiet();
    eq(upgradeRefusal(poor, find(poor, 'almacen'), T0), 'not-enough-resources', 'an empty store');

    const state = rich();
    eq(upgradeRefusal(state, find(state, 'almacen'), T0), null, 'a full one is fine');
    eq(
      upgradeRefusal(hallAt(state, 1), { ...find(state, 'almacen'), level: 2 }, T0),
      'town-hall-too-low',
      'until the ladder runs into the hall'
    );

    const busy = { ...find(state, 'almacen'), work: { kind: 'upgrade' as const, toLevel: 2, startedAt: T0, endsAt: T0 + MINUTE } };
    eq(upgradeRefusal(state, busy, T0), 'busy', 'and a building already in obras says so');
  });

  test('the working face prices the gem finish, and the last five minutes cost one', () => {
    let state = rich();
    state = startUpgrade(state, find(state, 'almacen').id, T0).state;   // a 20m job
    const job = find(state, 'almacen');
    ok(finishNowCost(job, T0)! > 1, 'twenty minutes out it is a real price');
    eq(finishNowCost(job, T0 + 16 * MINUTE), 1, 'four minutes out it is the golden rule');
    eq(finishNowCost(find(rich(), 'almacen'), T0), null, 'and an idle building has no price at all');
  });
});
