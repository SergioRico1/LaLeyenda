import { BALANCE, type ResourceId } from './balance';
import {
  buildersFree, finishNowCost, placeInPlace, placeRefusal, startUpgradeInPlace, upgradeRefusal,
} from './build';
import {
  awardChestInPlace, openChestInPlace, skipCost, startChestInPlace, startRefusal,
} from './chests';
import { clone, collectInPlace, isProducer } from './economy';
import { advanceInPlace, type OfflineSummary } from './offline';
import { claimDailyInPlace, claimQuestInPlace, dailyAvailable, noteInPlace } from './progression';
import type { ActionResult, GameState, SimEvent, SimResult } from './types';

/**
 * sim/index.ts — the whole public surface of the simulation.
 *
 * Every function here is pure: it takes a state (and a time, always passed IN)
 * and returns a NEW state plus the events that happened. Nothing mutates the
 * argument, nothing reads a clock, nothing touches the DOM or three.js.
 * ui/ dispatches into these; render/ only reads the result.
 */

export * from './balance';
export * from './types';
export { createNewGame, createDemoIsland } from './state';
export { advanceInPlace, applyLongAbsenceGiftInPlace, type OfflineSummary } from './offline';
export {
  buildersFree, buildersTotal, buildersBusy, gemSpeedupCost, finishNowCost, upgradePlan, placeable,
} from './build';
export {
  storeCap, storeCaps, producerCapacity, producerRate, producerResource, isProducer, isFull,
  townHallLevel, fillTimeMs, canAfford, productionMultiplier,
} from './economy';
export { readyCount, unlockingSlot, skipCost, type Loot } from './chests';
export {
  dailyAvailable, dailyReward, claimableQuests, questComplete, localDayIndex, xpForLevel,
} from './progression';
export { checkStorageInvariant, checkStoreLadder, auditStorage } from './invariant';
export { parseDuration, SECOND, MINUTE, HOUR, DAY } from './duration';

const fail = (state: GameState, refusal: ActionResult['refusal']): ActionResult =>
  ({ state, events: [], ok: false, refusal });

/* --------------------------------------------------------------------------
 * time
 * ----------------------------------------------------------------------- */

/** Advance the world to `now`. A frame and a three-day absence are the same
 *  call; only the summary is interesting for the second one. */
export function tick(state: GameState, now: number): SimResult & { summary: OfflineSummary } {
  const next = clone(state);
  const { events, summary } = advanceInPlace(next, now);
  return { state: next, events, summary };
}

/* --------------------------------------------------------------------------
 * the minutes clock — collecting
 * ----------------------------------------------------------------------- */

export function collect(state: GameState, buildingId: number): ActionResult & { amount: number; spilled: number } {
  const next = clone(state);
  const building = next.buildings.find((b) => b.id === buildingId);
  if (!building) return { ...fail(next, 'unknown-building'), amount: 0, spilled: 0 };
  if (!isProducer(building) || building.stock <= 0) {
    return { ...fail(next, 'nothing-to-collect'), amount: 0, spilled: 0 };
  }

  const { resource, moved, spilled } = collectInPlace(next, building);
  if (!resource) return { ...fail(next, 'nothing-to-collect'), amount: 0, spilled: 0 };

  const events: SimEvent[] = [{ type: 'collected', buildingId, resource, amount: moved, spilled }];
  if (moved > 0) {
    noteInPlace(next, 'collects');
    noteInPlace(next, `collected.${resource}` as keyof GameState['stats'], moved);
  }
  // moved === 0 with stock left is the store being full: a real refusal the UI
  // turns into `Almacén al máximo`, not a silent no-op.
  return {
    state: next, events, ok: moved > 0,
    refusal: moved > 0 ? undefined : 'store-full',
    amount: moved, spilled,
  };
}

/** §3.9 — offered only at 4+ pending bubbles, and unlocked at Ayto 4. */
export function collectAll(state: GameState): ActionResult & { totals: Partial<Record<ResourceId, number>> } {
  let current = state;
  const events: SimEvent[] = [];
  const totals: Partial<Record<ResourceId, number>> = {};
  for (const building of state.buildings) {
    if (!isProducer(building) || building.stock <= 0) continue;
    const result = collect(current, building.id);
    if (!result.ok) continue;
    current = result.state;
    events.push(...result.events);
    for (const event of result.events) {
      if (event.type !== 'collected') continue;
      totals[event.resource] = (totals[event.resource] ?? 0) + event.amount;
    }
  }
  return { state: current, events, ok: events.length > 0, totals };
}

/* --------------------------------------------------------------------------
 * the hours clock — builders and timers
 * ----------------------------------------------------------------------- */

export function startUpgrade(state: GameState, buildingId: number, now: number): ActionResult {
  const next = clone(state);
  const building = next.buildings.find((b) => b.id === buildingId);
  if (!building) return fail(next, 'unknown-building');
  const refusal = upgradeRefusal(next, building, now);
  if (refusal) return fail(next, refusal);
  startUpgradeInPlace(next, building, now);
  return { state: next, events: [], ok: true };
}

export function place(state: GameState, type: string, x: number, z: number, now: number): ActionResult {
  const next = clone(state);
  const refusal = placeRefusal(next, type, now);
  if (refusal) return fail(next, refusal);
  placeInPlace(next, type, x, z, now);
  return { state: next, events: [], ok: true };
}

/** "Terminar Ya" — pay gems, and the last five minutes always cost exactly 1. */
export function finishNow(state: GameState, buildingId: number, now: number): ActionResult & { gems: number } {
  const next = clone(state);
  const building = next.buildings.find((b) => b.id === buildingId);
  if (!building || !building.work) return { ...fail(next, 'unknown-building'), gems: 0 };
  const cost = finishNowCost(building, now) ?? 0;
  if (next.gems < cost) return { ...fail(next, 'not-enough-gems'), gems: cost };
  next.gems -= cost;
  building.work.endsAt = now;
  // Completion, XP and the finished event all belong to the tick.
  const { events } = advanceInPlace(next, now);
  return { state: next, events, ok: true, gems: cost };
}

/* --------------------------------------------------------------------------
 * chests
 * ----------------------------------------------------------------------- */

export function startChest(state: GameState, slot: number, now: number): ActionResult {
  const next = clone(state);
  const refusal = startRefusal(next, slot);
  if (refusal) return fail(next, refusal);
  startChestInPlace(next, slot, now);
  return { state: next, events: [], ok: true };
}

export function skipChest(state: GameState, slot: number, now: number): ActionResult & { gems: number } {
  const next = clone(state);
  const cost = skipCost(next, slot, now);
  if (cost === null) return { ...fail(next, 'not-ready'), gems: 0 };
  if (next.gems < cost) return { ...fail(next, 'not-enough-gems'), gems: cost };
  next.gems -= cost;
  next.chests[slot].endsAt = now;
  const { events } = advanceInPlace(next, now);
  return { state: next, events, ok: true, gems: cost };
}

export function openChest(state: GameState, slot: number): ActionResult & { loot: ReturnType<typeof openChestInPlace> } {
  const next = clone(state);
  const chest = next.chests[slot]?.type ?? '';
  const loot = openChestInPlace(next, slot);
  if (!loot) return { ...fail(next, 'not-ready'), loot: null };
  noteInPlace(next, 'chestsOpened');
  const { rolled, ...granted } = loot;
  return {
    state: next, ok: true, loot,
    // The event carries what LANDED. `rolled` stays on the action result for a
    // UI that wants to point out the store cap ate the difference.
    events: [{ type: 'chest-opened', slot, chest, loot: { ...granted } }],
  };
}

/** Moves a banked Cofre Libre from the Muelle into a free tray slot. */
export function claimFreeChest(state: GameState): ActionResult {
  const next = clone(state);
  if (next.freeChestsBanked <= 0) return fail(next, 'not-ready');
  if (awardChestInPlace(next, BALANCE.chests.freeChest.type) < 0) return fail(next, 'slot-busy');
  next.freeChestsBanked--;
  return { state: next, events: [], ok: true };
}

/* --------------------------------------------------------------------------
 * the days clock
 * ----------------------------------------------------------------------- */

export function claimDaily(state: GameState, now: number): ActionResult {
  const next = clone(state);
  if (!dailyAvailable(next, now)) return fail(next, 'already-claimed');
  const claim = claimDailyInPlace(next, now);
  return { state: next, events: [{ type: 'daily-claimed', day: claim.day }], ok: true };
}

export function claimQuest(state: GameState, index: number): ActionResult {
  const next = clone(state);
  const quest = next.quests.daily[index];
  if (!claimQuestInPlace(next, index)) return fail(next, 'not-ready');
  return { state: next, events: [{ type: 'quest-complete', questId: quest.id }], ok: true };
}

/* --------------------------------------------------------------------------
 * §4.8 — the next-action resolver, as a mechanism rather than an intention
 * ----------------------------------------------------------------------- */

export type NextAction = 'construir' | 'cofres' | 'diario' | 'pills' | 'zarpar' | 'recoger' | 'none';

/**
 * Evaluated on every session start and after every state change; the first hit
 * wins. If it ever returns 'none' the loop is broken and that is a bug — the
 * caller is expected to log it.
 */
export function nextAction(state: GameState, now: number): NextAction {
  if (buildersFree(state, now) > 0) return 'construir';

  // §4.8 #2: a chest sitting in the tray with nothing brewing, or one already
  // open-able. Both are one tap from a reward; a chest mid-timer is not.
  const ready = state.chests.some((s) => s.state === 'ready');
  const waiting = state.chests.some((s) => s.state === 'waiting');
  const unlocking = state.chests.some((s) => s.state === 'unlocking');
  if (ready || state.freeChestsBanked > 0 || (waiting && !unlocking)) return 'cofres';

  if (dailyAvailable(state, now) || state.quests.daily.some((q) => !q.claimed && q.progress >= q.target)) {
    return 'diario';
  }

  const fullByResource = new Map<ResourceId, number>();
  for (const b of state.buildings) {
    if (!isProducer(b)) continue;
    const spec = BALANCE.buildings[b.type];
    const resource = spec.resource;
    if (!resource) continue;
    const cap = spec.levels[b.level - 1]?.capacity ?? 0;
    if (cap > 0 && b.stock >= cap - 1e-6) fullByResource.set(resource, (fullByResource.get(resource) ?? 0) + 1);
  }
  // §3.1: one full producer does not earn a pulse; two or more do.
  for (const count of fullByResource.values()) if (count >= 2) return 'pills';

  const producers = state.buildings.filter(isProducer);
  const idle = producers.length > 0 && producers.every((b) => {
    const cap = BALANCE.buildings[b.type].levels[b.level - 1]?.capacity ?? 1;
    return b.stock < cap * 0.2;
  });
  if (idle) return 'zarpar';

  // ✎ §4.8's five rules leave one hole: every builder busy, every chest
  // brewing, nothing claimable, and producers sitting between 20% and full.
  // There IS something to do there — collect — and the bubbles are already
  // saying so, so this hit surfaces no chrome. It exists so that 'none' keeps
  // meaning "the loop is genuinely broken" rather than "the list is short".
  if (producers.some((b) => b.stock >= 1)) return 'recoger';

  return 'none';
}
