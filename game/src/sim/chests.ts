import type { Rng } from '../core/rng';
import { BALANCE, chestSpec } from './balance';
import { gemSpeedupCost } from './build';
import { grantInPlace } from './economy';
import { withRng } from './rng';
import type { ChestSlot, GameState, Refusal } from './types';

/**
 * chests.ts — §4.5 / §3.13.
 *
 * Four slots from the start, **but only one unlocks at a time**. That Clash
 * Royale restriction is the whole pressure: a full tray is not a reward, it is
 * a queue, and the queue is what brings the player back at 3h 51m.
 */

export const emptySlot = (): ChestSlot => ({ type: null, state: 'empty', endsAt: null, totalMs: 0 });

export function newChestTray(): ChestSlot[] {
  return Array.from({ length: BALANCE.chests.slots }, emptySlot);
}

export function unlockingSlot(state: GameState): number {
  return state.chests.findIndex((s) => s.state === 'unlocking');
}

export function freeSlot(state: GameState): number {
  return state.chests.findIndex((s) => s.state === 'empty');
}

export function readyCount(state: GameState): number {
  return state.chests.filter((s) => s.state === 'ready').length;
}

/** Drops a chest into the first free slot. Returns the slot, or -1 if the tray
 *  is full — the caller decides whether that is a loss or a hold. */
export function awardChestInPlace(state: GameState, type: string): number {
  const slot = freeSlot(state);
  if (slot < 0) return -1;
  state.chests[slot] = { type, state: 'waiting', endsAt: null, totalMs: chestSpec(type).timeMs };
  return slot;
}

/**
 * What a tap on Cofres should DO right now — round 11's playtest, finding 2.
 *
 * On a day-one save the tray is four empty slots, and the old route fell
 * through every case to the toast `Solo un cofre a la vez` — a refusal about a
 * rule the player had never met, over zero chests. This resolves the tap in
 * priority order and, when there is genuinely nothing, answers with WHEN
 * chests come instead of a mis-worded rule: the running unlock's clock, the
 * Muelle's next Cofre Libre, or the fact that there is no Muelle yet at all.
 */
export type ChestTrayHint =
  | { kind: 'open'; slot: number }
  | { kind: 'claim-free' }
  | { kind: 'start'; slot: number }
  | { kind: 'unlocking'; remainingMs: number }
  /** Nothing in the tray, but the dock stands: the next Cofre Libre lands in `inMs`. */
  | { kind: 'come-later'; inMs: number }
  /** Nothing in the tray and no Muelle: the honest answer is the building. */
  | { kind: 'build-dock' };

export function chestTrayHint(state: GameState, now: number): ChestTrayHint {
  const ready = state.chests.findIndex((s) => s.state === 'ready');
  if (ready >= 0) return { kind: 'open', slot: ready };
  if (state.freeChestsBanked > 0) return { kind: 'claim-free' };

  const unlocking = state.chests.filter((s) => s.state === 'unlocking' && s.endsAt !== null);
  const waiting = state.chests.findIndex((s) => s.state === 'waiting');
  if (waiting >= 0 && unlocking.length < BALANCE.chests.concurrentUnlocks) {
    return { kind: 'start', slot: waiting };
  }
  if (unlocking.length > 0) {
    return { kind: 'unlocking', remainingMs: Math.max(0, Math.min(...unlocking.map((s) => s.endsAt! - now)) ) };
  }

  const dock = state.buildings.some(
    (b) => b.type === BALANCE.chests.freeChest.building && b.level >= 1
  );
  return dock
    ? { kind: 'come-later', inMs: Math.max(0, state.freeChestAt - now) }
    : { kind: 'build-dock' };
}

export function startRefusal(state: GameState, slot: number): Refusal | null {
  const cell = state.chests[slot];
  if (!cell || cell.state !== 'waiting') return 'slot-busy';
  const running = state.chests.filter((s) => s.state === 'unlocking').length;
  if (running >= BALANCE.chests.concurrentUnlocks) return 'another-chest-unlocking';
  return null;
}

export function startChestInPlace(state: GameState, slot: number, now: number): void {
  const cell = state.chests[slot];
  const total = chestSpec(cell.type!).timeMs;
  cell.state = 'unlocking';
  cell.totalMs = total;
  cell.endsAt = now + total;
}

/** "Abrir ahora" — §4.4's ladder, and 1 gem inside the last five minutes. */
export function skipCost(state: GameState, slot: number, now: number): number | null {
  const cell = state.chests[slot];
  if (!cell || cell.state !== 'unlocking' || cell.endsAt === null) return null;
  return gemSpeedupCost(cell.endsAt - now);
}

/* --------------------------------------------------------------------------
 * opening
 * ----------------------------------------------------------------------- */

export interface Loot {
  oro: number;
  madera: number;
  gemas: number;
  fragmentos: number;
}

/** What a chest actually paid out, plus what it rolled before the store cap
 *  clamped it. The reveal shows `oro`/`madera`; `rolled` is there so the UI can
 *  tell the player their storage is costing them loot rather than hiding it. */
export interface ChestPayout extends Loot {
  rolled: Loot;
}

export function rollLoot(spec: ReturnType<typeof chestSpec>, rng: Rng): Loot {
  const roll = (key: string): number => {
    const range = spec.loot[key];
    return range ? rng.int(range[0], range[1]) : 0;
  };
  return { oro: roll('oro'), madera: roll('madera'), gemas: roll('gemas'), fragmentos: roll('fragmentos') };
}

/**
 * Empties a ready slot and banks the loot.
 *
 * ✎ §3.22A decides that EXPEDITION loot lands as bubbles on the island rather
 * than in storage. A chest is the other case — it is its own celebration scene
 * (§3.22B) and the reveal *is* the moment, so it pays straight into the store,
 * clamped by the store cap like everything else.
 */
export function openChestInPlace(state: GameState, slot: number): ChestPayout | null {
  const cell = state.chests[slot];
  if (!cell || cell.state !== 'ready' || !cell.type) return null;
  const spec = chestSpec(cell.type);
  const loot = withRng(state, (rng) => rollLoot(spec, rng));

  // Report what reached the store, not what the dice said: a full Banco silently
  // ate the difference and the reveal announced the roll regardless.
  const granted = grantInPlace(state, { oro: loot.oro, madera: loot.madera });
  state.gems += loot.gemas;
  state.chests[slot] = emptySlot();
  return { ...loot, oro: granted.oro ?? 0, madera: granted.madera ?? 0, rolled: loot };
}
