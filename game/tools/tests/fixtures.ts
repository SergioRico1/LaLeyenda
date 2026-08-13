import { createNewGame, type Building, type GameState } from '../../src/sim';

/** A fixed instant, so nothing in the suite depends on when it is run. */
export const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);

/** UTC, so day boundaries in the tests are the ones the assertions describe. */
export const TZ = 0;

/** OPENING.md's island exactly as a new player receives it: the Ayuntamiento,
 *  a field of obstacles, and nothing else. */
export const game = (seed = 'test'): GameState => createNewGame(seed, T0, TZ);

/**
 * A STARTED island: one of every building the Ayuntamiento opens at Nv1,
 * standing, idle, with nothing banked and nothing accumulated.
 *
 * The mechanic suites build on this rather than on `game()`, and it is now
 * built here rather than derived from it. An assertion about how a producer
 * fills, or about what an hour away pays, has no business breaking because the
 * OPENING changed — and when it silently does, the failure reads as an economy
 * bug that is not there. `game()` used to be six buildings and stripping its
 * session left exactly this; OPENING.md took it down to one, so the fixture
 * states its own island instead of inheriting one.
 *
 * The cells are spaced to satisfy reference/SPACING.md's clearance rule, so
 * this fixture is an island `place()` would actually have allowed.
 */
export function quiet(seed = 'test'): GameState {
  const state = game(seed);
  const at = (id: number, type: string, x: number, z: number): Building =>
    ({ id, type, x, z, level: 1, stock: 0, work: null });

  return {
    ...state,
    buildings: [
      at(1, 'ayuntamiento', 22, 22),
      at(2, 'aserradero', 16, 22),
      at(3, 'mercado', 28, 22),
      at(4, 'almacen', 22, 16),
      at(5, 'banco', 22, 28),
      at(6, 'muelle', 16, 16),
    ],
    nextBuildingId: 7,
    // Cleared ground, so the fixture's cells are never contested by scenery.
    obstacles: [],
    builders: { ...state.builders, tempUntil: null },
    chests: state.chests.map(() => ({ type: null, state: 'empty' as const, endsAt: null, totalMs: 0 })),
    store: { oro: 0, madera: 0, ron: 0, metal: 0 },
    gems: 0,
    stats: {
      collects: 0, upgrades: 0, chestsOpened: 0, obstacles: 0,
      'collected.oro': 0, 'collected.madera': 0, 'collected.ron': 0, 'collected.metal': 0,
    },
  };
}

/** A quiet island with the shopping list already paid for. */
export function rich(seed = 'test'): GameState {
  const state = quiet(seed);
  state.store = { oro: 500_000, madera: 500_000, ron: 500_000, metal: 500_000 };
  state.gems = 100_000;
  return state;
}

export const find = (state: GameState, type: string) => {
  const building = state.buildings.find((b) => b.type === type);
  if (!building) throw new Error(`fixture has no ${type}`);
  return building;
};

export const stockOf = (state: GameState, type: string): number => find(state, type).stock;
