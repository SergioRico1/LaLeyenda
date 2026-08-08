import { Rng } from '../core/rng';
import type { GameState } from './types';

/**
 * rng.ts — the sim's only source of randomness.
 *
 * PLAN.md's golden rule: no `Math.random()` anywhere in gameplay. Every roll
 * comes off the seeded stream whose cursor lives IN the save, so re-opening a
 * game continues the sequence instead of replaying rolls the player already
 * saw — and so a future server could re-run the same chest opening and get the
 * same loot.
 */

/** Runs `fn` with the state's stream and writes the cursor back. */
export function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = new Rng(state.seed);
  rng.cursor = state.rngState;
  const out = fn(rng);
  state.rngState = rng.cursor;
  return out;
}

export function initialRngState(seed: string): number {
  return Rng.hash(`${seed}:sim`);
}
