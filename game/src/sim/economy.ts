import { BALANCE, RESOURCE_IDS, buildingSpec, levelSpec, type Cost, type ResourceId } from './balance';
import { HOUR } from './duration';
import type { Building, GameState } from './types';

/**
 * economy.ts — the two caps, and the arithmetic that moves resource between
 * them. This is the mechanic UI_SPEC §4.2 says RETENTION.md fuses by mistake:
 *
 *   producer.stock ──[ collect ]──▶ state.store
 *        ▲                              ▲
 *   capped by the building's       capped by the SUM of the store
 *   own `capacity` (§4.2 col 3)    buildings for that resource
 *
 * A producer that hits its own capacity stops dead — that is the `¡Lleno!`
 * chip. A store that is full makes collecting spill, which is a different
 * message and a different upgrade. Two independent decisions; §9 says that
 * tension is half the economy.
 *
 * Every function here is pure arithmetic over a state passed in. No clock.
 */

export const clone = <T>(value: T): T => structuredClone(value);

export const emptyStore = (): Record<ResourceId, number> => ({ oro: 0, madera: 0, ron: 0, metal: 0 });

/* --------------------------------------------------------------------------
 * levels
 * ----------------------------------------------------------------------- */

export function townHallLevel(state: GameState): number {
  const hall = state.buildings.find((b) => buildingSpec(b.type).kind === 'townhall');
  return hall ? Math.max(1, hall.level) : 1;
}

/* --------------------------------------------------------------------------
 * cap #1 — the producer's own internal capacity
 * ----------------------------------------------------------------------- */

export function isProducer(building: Building): boolean {
  return buildingSpec(building.type).kind === 'producer' && building.level > 0;
}

/** Units the building can hold before it stops and shows `¡Lleno!` (§3.10). */
export function producerCapacity(building: Building): number {
  if (!isProducer(building)) return 0;
  return levelSpec(building.type, building.level).capacity ?? 0;
}

/** Units per hour at the building's current level. */
export function producerRate(building: Building): number {
  if (!isProducer(building)) return 0;
  return levelSpec(building.type, building.level).rate ?? 0;
}

export function producerResource(building: Building): ResourceId | null {
  return buildingSpec(building.type).resource ?? null;
}

export const isFull = (building: Building): boolean =>
  isProducer(building) && building.stock >= producerCapacity(building) - 1e-6;

/** Hours to fill from empty — §4.2's session cadence, 3h early → 12h late. */
export function fillTimeMs(building: Building): number {
  const rate = producerRate(building);
  return rate <= 0 ? Infinity : (producerCapacity(building) / rate) * HOUR;
}

/* --------------------------------------------------------------------------
 * cap #2 — the store
 * ----------------------------------------------------------------------- */

/** The sum of every built store of this resource. Zero before one exists,
 *  which is why a resource with no store cannot be banked at all. */
export function storeCap(state: GameState, resource: ResourceId): number {
  let cap = 0;
  for (const b of state.buildings) {
    const spec = buildingSpec(b.type);
    if (spec.kind !== 'store' || spec.resource !== resource || b.level < 1) continue;
    cap += levelSpec(b.type, b.level).capacity ?? 0;
  }
  return cap;
}

export function storeCaps(state: GameState): Record<ResourceId, number> {
  const caps = emptyStore();
  for (const r of RESOURCE_IDS) caps[r] = storeCap(state, r);
  return caps;
}

/**
 * §4.7 — every rank division is +2% production.
 *
 * ✎ Counted from ZERO at Grumete I, so a brand-new island produces exactly the
 * rate §4.2's tables print. §4.7's "+42% at cap" implies counting all 21
 * divisions, which would make every published rate a 2% lie from minute one;
 * this reaches +40% at Leyenda III instead. The table wins over the footnote.
 *
 * ✎ §4.7 calls it an *offline* bonus. Applying it only while away would make
 * the same elapsed hour pay differently depending on whether the player was
 * watching, which no amount of UI can explain. It applies uniformly.
 */
export function productionMultiplier(state: GameState): number {
  const { tiers, divisionsPerRank, perDivisionOfflineBonus } = BALANCE.ranks;
  let divisions = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (state.notoriety < tiers[i].at) break;
    const next = tiers[i + 1];
    const span = (next ? next.at : tiers[i].at + 600) - tiers[i].at;
    const into = span > 0 ? Math.min(1, (state.notoriety - tiers[i].at) / span) : 1;
    divisions = i * divisionsPerRank + Math.min(divisionsPerRank - 1, Math.floor(into * divisionsPerRank));
  }
  return 1 + divisions * perDivisionOfflineBonus;
}

/* --------------------------------------------------------------------------
 * production
 * ----------------------------------------------------------------------- */

/**
 * Advances every producer's own stock by `ms`, in place, on a state the caller
 * already owns. Capped by the producer's capacity and nothing else: §4.7 is
 * explicit that the limit is the machine, never an artificial offline rule.
 *
 * Returns the ids of producers that crossed into full during this slice, which
 * is what the `¡Lleno!` chip and the "producers full" notification key off.
 */
export function produceInPlace(state: GameState, ms: number): number[] {
  if (ms <= 0) return [];
  const mult = productionMultiplier(state);
  const filled: number[] = [];
  for (const b of state.buildings) {
    if (!isProducer(b)) continue;
    const cap = producerCapacity(b);
    if (b.stock >= cap) continue;
    const gained = producerRate(b) * mult * (ms / HOUR);
    if (gained <= 0) continue;
    b.stock = Math.min(cap, b.stock + gained);
    if (b.stock >= cap - 1e-6) filled.push(b.id);
  }
  return filled;
}

/* --------------------------------------------------------------------------
 * collect — the only path from cap #1 to cap #2
 * ----------------------------------------------------------------------- */

export interface CollectOutcome {
  resource: ResourceId | null;
  /** What actually reached the store. */
  moved: number;
  /** What the store had no room for and was left in the producer. */
  spilled: number;
}

/** Moves one producer's stock into the store, in place. */
export function collectInPlace(state: GameState, building: Building): CollectOutcome {
  const resource = producerResource(building);
  if (!resource || !isProducer(building) || building.stock <= 0) {
    return { resource, moved: 0, spilled: 0 };
  }
  const room = Math.max(0, storeCap(state, resource) - state.store[resource]);
  const moved = Math.min(building.stock, room);
  const spilled = building.stock - moved;

  state.store[resource] = Math.round((state.store[resource] + moved) * 1000) / 1000;
  building.stock = spilled;
  return { resource, moved, spilled };
}

/**
 * Unloads a voyage's hold into the island's stores.
 *
 * This is the one function that closes PLAN.md's main loop: everything the sea
 * pays out has to arrive here or sailing is a side activity rather than the
 * other half of the game.
 *
 * It obeys the SAME cap a collection does, and for the same reason — a store
 * that can be exceeded from the dock makes upgrading it pointless. What spills
 * is reported rather than silently dropped, because arriving with a full hold
 * and being told nothing is the version of this that feels like a bug.
 */
export function landCargoInPlace(
  state: GameState,
  cargo: Partial<Record<ResourceId, number>>
): { landed: Partial<Record<ResourceId, number>>; spilled: Partial<Record<ResourceId, number>> } {
  const landed: Partial<Record<ResourceId, number>> = {};
  const spilled: Partial<Record<ResourceId, number>> = {};

  for (const resource of RESOURCE_IDS) {
    const held = cargo[resource] ?? 0;
    if (held <= 0) continue;
    const room = Math.max(0, storeCap(state, resource) - state.store[resource]);
    const moved = Math.min(held, room);
    if (moved > 0) {
      state.store[resource] = Math.round((state.store[resource] + moved) * 1000) / 1000;
      landed[resource] = moved;
    }
    const over = held - moved;
    if (over > 0) spilled[resource] = over;
  }

  return { landed, spilled };
}

/* --------------------------------------------------------------------------
 * paying for things
 * ----------------------------------------------------------------------- */

export function canAfford(state: GameState, cost: Cost): boolean {
  for (const r of RESOURCE_IDS) {
    const need = cost[r] ?? 0;
    if (need > 0 && state.store[r] + 1e-6 < need) return false;
  }
  return true;
}

export function payInPlace(state: GameState, cost: Cost): void {
  for (const r of RESOURCE_IDS) {
    const need = cost[r] ?? 0;
    if (need > 0) state.store[r] = Math.max(0, state.store[r] - need);
  }
}

/**
 * Adds resources to the store, clamped by its capacity, and reports what
 * actually landed.
 *
 * Callers must use the return value rather than what they asked for. A chest
 * reveal that rolls 1 492 oro into a bank with room for 685 destroys 807 of it,
 * and announcing the roll rather than the deposit tells the player they received
 * something they did not — the single worst kind of lie a reward screen can tell.
 */
export function grantInPlace(state: GameState, gain: Cost): Cost {
  const granted: Cost = {};
  for (const r of RESOURCE_IDS) {
    const amount = gain[r] ?? 0;
    if (amount <= 0) continue;
    const before = state.store[r];
    state.store[r] = Math.min(storeCap(state, r), before + amount);
    granted[r] = state.store[r] - before;
  }
  return granted;
}
