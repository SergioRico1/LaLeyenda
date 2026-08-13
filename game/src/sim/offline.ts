import { BALANCE, RESOURCE_IDS, buildingSpec, type ResourceId } from './balance';
import { finishWorkInPlace } from './build';
import { emptyStore, grantInPlace, isFull, producerResource, produceInPlace } from './economy';
import { finishClearInPlace } from './obstacles';
import { awardChestInPlace, readyCount } from './chests';
import { addXpInPlace, dailyAvailable, noteInPlace, questDayIndex, rollQuestsInPlace } from './progression';
import { withRng } from './rng';
import type { GameState, SimEvent } from './types';

/**
 * offline.ts — advancing the world from one instant to another.
 *
 * There is no separate "offline mode": a 16ms frame and a 30h absence run
 * through the same function. What matters is that the window is integrated
 * **piecewise**, split at every completion inside it — an Aserradero that
 * finishes its upgrade six hours into a twelve-hour absence must spend the
 * remaining six hours producing at the NEW rate into the NEW capacity. Fold
 * the window into one multiplication and the player is quietly robbed.
 *
 * §4.7: the only limit on offline production is the producer's own cap. There
 * is no artificial offline rule, because scarcity should come from the machine
 * and never from punishing someone for living.
 */

export interface OfflineSummary {
  elapsedMs: number;
  /** Units that appeared in producers during the window, per resource. */
  produced: Record<ResourceId, number>;
  /** Everything sitting in producers right now, waiting for a tap. */
  pending: Record<ResourceId, number>;
  finished: Array<{ buildingId: number; type: string; toLevel: number }>;
  /** Obstacles a builder finished clearing while the player was away. */
  obstaclesCleared: number;
  chestsReady: number;
  freeChestsBanked: number;
  fullProducers: number;
  dailyAvailable: boolean;
  claimableQuests: number;
  /** ≥72h away — §3.22C's `La Isla Resistió` rather than the normal HUD. */
  longAbsence: boolean;
}

const MAX_EVENTS = 4096;

/**
 * Advances `state` in place to `to`, applying production, timers and chests.
 * Returns the events that happened plus a summary the UI can stage a
 * welcome-back moment from.
 */
export function advanceInPlace(state: GameState, to: number): { events: SimEvent[]; summary: OfflineSummary } {
  const from = state.now;
  const events: SimEvent[] = [];
  const finished: OfflineSummary['finished'] = [];

  const before = new Map<number, number>();
  for (const b of state.buildings) before.set(b.id, b.stock);

  // Never return before settling work that is already due.
  //
  // Paying gems to finish a job sets its endsAt to the current instant and then
  // advances to that same instant. Bailing out here on `to <= from` meant the
  // player was charged and the building stayed under construction, with no
  // completion event emitted — and since the scene ticks several times a second,
  // that was the common path rather than an edge case. Clamping instead of
  // returning lets the loop below collect anything ending at exactly `now`,
  // while zero-length production slices contribute nothing.
  const target = Math.max(to, from);

  let cursor = from;
  let freeGranted = 0;

  for (let guard = 0; guard < MAX_EVENTS; guard++) {
    const next = nextEventTime(state, target);
    if (next === null) break;
    const at = Math.max(cursor, next);

    slice(state, cursor, at, events);
    cursor = at;

    // --- builds and upgrades ------------------------------------------------
    for (const b of state.buildings) {
      if (!b.work || b.work.endsAt > at) continue;
      const toLevel = b.work.toLevel;
      const xp = finishWorkInPlace(b);
      const levelled = addXpInPlace(state, xp);
      noteInPlace(state, 'upgrades');
      finished.push({ buildingId: b.id, type: b.type, toLevel });
      events.push({ type: 'work-finished', buildingId: b.id, building: b.type, toLevel, at });
      if (levelled !== null) events.push({ type: 'level-up', level: levelled });
    }

    // --- obstacles ----------------------------------------------------------
    // Taken from a snapshot: `finishClearInPlace` rebuilds the array, so
    // iterating the live one would skip the entry after each removal.
    for (const o of [...state.obstacles]) {
      if (!o.work || o.work.endsAt > at) continue;
      const paid = finishClearInPlace(state, o, (madera) => grantInPlace(state, { madera }).madera ?? 0);
      const levelled = addXpInPlace(state, BALANCE.xp.perObstacle);
      noteInPlace(state, 'obstacles');
      events.push({
        type: 'obstacle-cleared', obstacleId: o.id, kind: o.kind, x: o.x, z: o.z,
        madera: paid.madera, gems: paid.gems, at,
      });
      if (levelled !== null) events.push({ type: 'level-up', level: levelled });
    }

    // --- chests -------------------------------------------------------------
    state.chests.forEach((slot, i) => {
      if (slot.state !== 'unlocking' || slot.endsAt === null || slot.endsAt > at) return;
      slot.state = 'ready';
      slot.endsAt = null;
      events.push({ type: 'chest-ready', slot: i, chest: slot.type ?? '', at });
    });

    // --- the 24h carpintero de guardia expiring -----------------------------
    if (state.builders.tempUntil !== null && state.builders.tempUntil <= at) {
      state.builders.tempUntil = null;
      events.push({ type: 'builder-expired', at });
    }

    // --- Cofre Libre at the Muelle, stacking to 2 ---------------------------
    // Gated on the dock actually standing. It never mattered while every island
    // began with a Muelle; with OPENING.md's opening it does, and an island with
    // no harbour quietly posting harbour chests would be the game paying out for
    // a building the player has not built yet.
    if (state.freeChestAt <= at) {
      const dock = state.buildings.some((b) => b.type === BALANCE.chests.freeChest.building && b.level >= 1);
      if (dock && state.freeChestsBanked < BALANCE.chests.freeChest.stack) {
        state.freeChestsBanked++;
        freeGranted++;
      }
      state.freeChestAt = at + BALANCE.chests.freeChest.everyMs;
    }
  }

  slice(state, cursor, target, events);
  state.now = target;

  // The three dailies refresh at 04:00 local (§4.7 / §9).
  if (state.quests.rolledDay !== questDayIndex(state, to)) {
    withRng(state, (rng) => rollQuestsInPlace(state, to, rng));
  }

  const cleared = events.reduce((n, e) => n + (e.type === 'obstacle-cleared' ? 1 : 0), 0);
  return { events, summary: summarise(state, from, before, finished, freeGranted, cleared) };
}

/** Produces over one uninterrupted slice and reports producers hitting cap. */
function slice(state: GameState, from: number, to: number, events: SimEvent[]): void {
  if (to <= from) return;
  const wasFull = new Set(state.buildings.filter(isFull).map((b) => b.id));
  const filled = produceInPlace(state, to - from);
  for (const id of filled) {
    if (wasFull.has(id)) continue;
    const b = state.buildings.find((x) => x.id === id);
    const resource = b ? producerResource(b) : null;
    if (b && resource) events.push({ type: 'producer-full', buildingId: b.id, resource, at: to });
  }
}

/** The next instant in (now, to] where something completes, or null. */
function nextEventTime(state: GameState, to: number): number | null {
  let best = Infinity;
  for (const b of state.buildings) {
    if (b.work && b.work.endsAt <= to) best = Math.min(best, b.work.endsAt);
  }
  for (const o of state.obstacles) {
    if (o.work && o.work.endsAt <= to) best = Math.min(best, o.work.endsAt);
  }
  for (const slot of state.chests) {
    if (slot.state === 'unlocking' && slot.endsAt !== null && slot.endsAt <= to) best = Math.min(best, slot.endsAt);
  }
  if (state.builders.tempUntil !== null && state.builders.tempUntil <= to) {
    best = Math.min(best, state.builders.tempUntil);
  }
  if (state.freeChestAt <= to) best = Math.min(best, state.freeChestAt);
  return Number.isFinite(best) ? best : null;
}

function summarise(
  state: GameState,
  from: number,
  before: Map<number, number>,
  finished: OfflineSummary['finished'],
  freeChestsBanked: number,
  obstaclesCleared: number
): OfflineSummary {
  const produced = emptyStore();
  const pending = emptyStore();
  let fullProducers = 0;

  for (const b of state.buildings) {
    const resource = producerResource(b);
    if (!resource || buildingSpec(b.type).kind !== 'producer') continue;
    produced[resource] += Math.max(0, b.stock - (before.get(b.id) ?? 0));
    pending[resource] += b.stock;
    if (isFull(b)) fullProducers++;
  }
  for (const r of RESOURCE_IDS) {
    produced[r] = Math.round(produced[r]);
    pending[r] = Math.round(pending[r]);
  }

  const elapsedMs = Math.max(0, state.now - from);
  return {
    elapsedMs,
    produced,
    pending,
    finished,
    obstaclesCleared,
    chestsReady: readyCount(state),
    freeChestsBanked,
    fullProducers,
    dailyAvailable: dailyAvailable(state, state.now),
    claimableQuests: state.quests.daily.filter((q) => !q.claimed && q.progress >= q.target).length,
    longAbsence: elapsedMs >= BALANCE.offline.longAbsenceMs,
  };
}

/**
 * §3.22C — after ≥72h the return is its own scene, and it ships with a gift
 * chest so the tray is never the thing that is empty.
 */
export function applyLongAbsenceGiftInPlace(state: GameState): string | null {
  const type = BALANCE.offline.longAbsenceGiftChest;
  return awardChestInPlace(state, type) >= 0 ? type : null;
}
