import { createNewGame, type GameState } from '../../src/sim';

/** A fixed instant, so nothing in the suite depends on when it is run. */
export const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);

/** UTC, so day boundaries in the tests are the ones the assertions describe. */
export const TZ = 0;

/** §4.10's island exactly as a new player receives it, session state and all. */
export const game = (seed = 'test'): GameState => createNewGame(seed, T0, TZ);

/**
 * The same island with the authored session STRIPPED: no job running, no
 * loaned carpenter, no chest brewing, nothing banked and nothing accumulated.
 *
 * The mechanic suites build on this rather than on `game()`. An assertion about
 * how a producer fills, or about what an hour away pays, has no business
 * breaking because §4.10's beat sheet was re-cut — and when it silently does,
 * the failure reads as an economy bug that is not there.
 */
export function quiet(seed = 'test'): GameState {
  const state = game(seed);
  return {
    ...state,
    buildings: state.buildings.map((b) => ({ ...b, work: null, stock: 0 })),
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
