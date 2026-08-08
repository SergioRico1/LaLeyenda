import { createNewGame, type GameState } from '../../src/sim';

/** A fixed instant, so nothing in the suite depends on when it is run. */
export const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);

/** UTC, so day boundaries in the tests are the ones the assertions describe. */
export const TZ = 0;

export const game = (seed = 'test'): GameState => createNewGame(seed, T0, TZ);

/** A fresh island with the shopping list already paid for. */
export function rich(seed = 'test'): GameState {
  const state = game(seed);
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
