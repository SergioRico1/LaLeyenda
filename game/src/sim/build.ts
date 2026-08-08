import {
  BALANCE, allowedCount, buildingSpec, levelSpec, maxLevelAt, reachableLevel,
  type Cost,
} from './balance';
import { MINUTE, HOUR } from './duration';
import { canAfford, payInPlace, townHallLevel } from './economy';
import type { Building, GameState, Refusal } from './types';

/**
 * build.ts — the builder limit, upgrades and the gem speed-up.
 *
 * RETENTION.md §1 is right that the scarce resource is the builder, not the
 * gold. UI_SPEC §9 corrects the count: **the game starts with TWO**, because
 * with one, every timer is a hard stop and the blinking-free-builder hook —
 * the document's own star mechanic — can never exist.
 */

/** Permanent builders plus the 24h "carpintero de guardia" while it lives. */
export function buildersTotal(state: GameState, now: number): number {
  const temp = state.builders.tempUntil !== null && state.builders.tempUntil > now ? 1 : 0;
  return state.builders.owned + temp;
}

export function buildersBusy(state: GameState): number {
  let busy = 0;
  for (const b of state.buildings) if (b.work) busy++;
  return busy;
}

export function buildersFree(state: GameState, now: number): number {
  return Math.max(0, buildersTotal(state, now) - buildersBusy(state));
}

/* --------------------------------------------------------------------------
 * what an upgrade costs and whether it is allowed
 * ----------------------------------------------------------------------- */

export interface UpgradePlan {
  toLevel: number;
  cost: Cost;
  timeMs: number;
}

/** null when the building is already at the top of what it can reach. */
export function upgradePlan(building: Building): UpgradePlan | null {
  const spec = buildingSpec(building.type);
  const toLevel = building.level + 1;
  if (toLevel > spec.levels.length) return null;
  const row = spec.levels[toLevel - 1];
  return { toLevel, cost: row.cost, timeMs: row.timeMs };
}

/**
 * Every reason an upgrade can be refused, in the order the UI wants to say
 * them out loud. A tap is never silent (§3.5): the refusal names the key.
 */
export function upgradeRefusal(state: GameState, building: Building, now: number): Refusal | null {
  if (building.work) return 'busy';
  const spec = buildingSpec(building.type);
  const plan = upgradePlan(building);
  if (!plan) return 'max-level';

  const hall = townHallLevel(state);
  if (spec.kind !== 'townhall' && plan.toLevel > maxLevelAt(building.type, hall)) return 'town-hall-too-low';
  if (spec.kind === 'townhall' && plan.toLevel > BALANCE.townHall.maxLevel) return 'max-level';

  if (buildersFree(state, now) <= 0) return 'no-builders';
  if (!canAfford(state, plan.cost)) return 'not-enough-resources';
  return null;
}

/** Starts the timer and occupies a builder, in place. Caller has checked. */
export function startUpgradeInPlace(state: GameState, building: Building, now: number): UpgradePlan {
  const plan = upgradePlan(building)!;
  payInPlace(state, plan.cost);
  building.work = {
    kind: building.level === 0 ? 'build' : 'upgrade',
    toLevel: plan.toLevel,
    startedAt: now,
    endsAt: now + plan.timeMs,
  };
  return plan;
}

/* --------------------------------------------------------------------------
 * placing a new building
 * ----------------------------------------------------------------------- */

export function placeRefusal(state: GameState, type: string, now: number): Refusal | null {
  const spec = BALANCE.buildings[type];
  if (!spec) return 'unknown-building';
  const hall = townHallLevel(state);
  if (hall < spec.unlockAtTownHall) return 'town-hall-too-low';
  if (state.buildings.filter((b) => b.type === type).length >= allowedCount(type, hall)) {
    return 'town-hall-too-low';
  }
  if (buildersFree(state, now) <= 0) return 'no-builders';
  if (!canAfford(state, levelSpec(type, 1).cost)) return 'not-enough-resources';
  return null;
}

/** A plot appears immediately at level 0 with a build job on it, so the island
 *  never shows nothing while the timer runs (§3.11). */
export function placeInPlace(state: GameState, type: string, x: number, z: number, now: number): Building {
  const row = levelSpec(type, 1);
  payInPlace(state, row.cost);
  const building: Building = {
    id: state.nextBuildingId++,
    type, x, z,
    level: 0,
    stock: 0,
    work: { kind: 'build', toLevel: 1, startedAt: now, endsAt: now + row.timeMs },
  };
  state.buildings.push(building);
  return building;
}

/* --------------------------------------------------------------------------
 * completion
 * ----------------------------------------------------------------------- */

/** Applies a finished job. Returns the XP it earned (§4.7: sqrt of seconds). */
export function finishWorkInPlace(building: Building): number {
  const work = building.work;
  if (!work) return 0;
  building.level = work.toLevel;
  building.work = null;
  // A producer whose capacity just grew keeps whatever it had accumulated.
  return Math.round(BALANCE.xp.perBuildSecondsSqrt * Math.sqrt(Math.max(0, work.endsAt - work.startedAt) / 1000));
}

/* --------------------------------------------------------------------------
 * §4.4 gem speed-up
 * ----------------------------------------------------------------------- */

/**
 * The GOLDEN RULE first: the last 5 minutes of ANY timer cost 1 gem. Always,
 * everywhere. It is the most habit-forming number in Clash and it is free for
 * us — it teaches gems→time at a price that cannot hurt, at the moment the
 * player is happy rather than frustrated.
 */
type Tier = (typeof BALANCE.gemSpeedup.tiers)[number];

const tierCost = (tier: Tier, ms: number): number => {
  if (tier.perMinuteOver > 0) {
    const minutes = Math.ceil(ms / MINUTE);
    return tier.base + Math.ceil(Math.max(0, minutes - tier.overMinutes) * tier.perMinuteOver);
  }
  if (tier.perHourOver > 0) {
    const hours = Math.ceil(ms / HOUR);
    return tier.base + Math.ceil(Math.max(0, hours - tier.overHours) * tier.perHourOver);
  }
  return tier.base;
};

export function gemSpeedupCost(remainingMs: number): number {
  if (remainingMs <= 0) return 0;
  const g = BALANCE.gemSpeedup;
  if (remainingMs <= g.goldenRuleUnderMs) return g.goldenRuleCost;

  // §4.4's three formulas are discontinuous at their own boundaries: 1h reads
  // 22 under the first and 20 under the second; 24h reads 158 then 150. Taken
  // literally that prices a LONGER wait cheaper, which is both confusing and
  // exploitable. Each tier is therefore floored at the value the previous tier
  // reaches at its ceiling, so the ladder only ever goes up. The published
  // anchors (22 · 86 · 318) are untouched.
  let floor = g.goldenRuleCost;
  for (const tier of g.tiers) {
    if (remainingMs <= tier.underMs) return Math.max(floor, tierCost(tier, remainingMs));
    floor = Math.max(floor, tierCost(tier, tier.underMs));
  }
  const last = g.tiers[g.tiers.length - 1];
  return Math.max(floor, tierCost(last, remainingMs));
}

/** What "Terminar Ya" costs on this building right now, or null if idle. */
export function finishNowCost(building: Building, now: number): number | null {
  if (!building.work) return null;
  return gemSpeedupCost(building.work.endsAt - now);
}

/* --------------------------------------------------------------------------
 * queries the HUD asks
 * ----------------------------------------------------------------------- */

/** Every building type the island could still place right now, with its cost. */
export function placeable(state: GameState, now: number): Array<{ type: string; cost: Cost; timeMs: number; refusal: Refusal | null }> {
  const hall = townHallLevel(state);
  const out: Array<{ type: string; cost: Cost; timeMs: number; refusal: Refusal | null }> = [];
  for (const [type, spec] of Object.entries(BALANCE.buildings)) {
    if (spec.kind === 'townhall') continue;
    if (reachableLevel(type, hall) < 1) continue;
    if (state.buildings.filter((b) => b.type === type).length >= allowedCount(type, hall)) continue;
    const row = levelSpec(type, 1);
    out.push({ type, cost: row.cost, timeMs: row.timeMs, refusal: placeRefusal(state, type, now) });
  }
  return out;
}
