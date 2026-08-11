import {
  allowedCount, BALANCE, buildCatalog, buildersFree, buildersTotal, buildingSpec, claimableQuests,
  dailyAvailable, finishNowCost, HOUR, isFull, isProducer, levelSpec, maxLevelAt, nextAction,
  producerResource, storeCap, townHallLevel, townHallUnlocks, upgradeGains, upgradePlan,
  upgradeRefusal,
  type Building, type GameState, type ResourceId, type UpgradePlan,
} from '../sim';
import { dur, n } from './format';
import type { HudState, ResourceState, WorldItemSpec } from './hud';
import type { SlotState } from './components/tray';
import type { BuildOption } from './panels/buildPicker';
import type { StatLine, UpgradeView } from './panels/upgradeSheet';
import { COPY, UNLOCK_LABEL, type RefusalKey } from './copy';

/**
 * present.ts — sim state → what the HUD draws. Replaces `mockState.ts`.
 *
 * This is the whole adapter layer and it is a pure function: no clock, no DOM,
 * no three.js. `hud.ts` takes an HudState and renders it; `islandScene.ts`
 * takes the anchors and projects them. Neither knows the sim exists, and the
 * sim knows nothing about either — which is the separation PLAN.md's golden
 * rule is protecting.
 */

/** A world-anchored HUD object and the building it hangs over. */
export interface WorldAnchor {
  buildingId: number;
  /** World units above the building's ground cell. */
  lift: number;
  item: WorldItemSpec;
}

/* --------------------------------------------------------------------------
 * the HUD
 * ----------------------------------------------------------------------- */

export function toHudState(state: GameState, now: number): HudState {
  const hall = townHallLevel(state);

  // §4.1 staged reveal — three rows early, five at Ayuntamiento 4. Four full
  // bars on the first screen is noise a new player cannot read.
  const resources: ResourceState[] = (Object.keys(BALANCE.resources) as ResourceId[])
    .filter((id) => hall >= BALANCE.resources[id].revealAtTownHall)
    .sort((a, b) => BALANCE.resources[a].pillRow - BALANCE.resources[b].pillRow)
    .map((id) => ({
      id,
      value: Math.floor(state.store[id]),
      cap: storeCap(state, id),
      // §3.1: one full producer does not earn a pulse; two or more do.
      pressing: fullProducers(state, id) >= 2,
    }));

  const unlocking = state.chests.filter((s) => s.state === 'unlocking');
  const waiting = state.chests.some((s) => s.state === 'waiting');
  const ready = state.chests.filter((s) => s.state === 'ready').length;

  return {
    level: state.level,
    xp: state.xp,
    xpMax: xpMax(state.level),
    builders: { free: buildersFree(state, now), total: buildersTotal(state, now) },
    // §2.4 priority 3 — rank/notoriety. Pre-formatted here because format.n is
    // the only thing allowed to make a thin-space separator (§6.15).
    status: n(state.notoriety),
    resources,
    gems: state.gems,
    badges: {
      // §3.8: a badge only for something claimable in 1–2 taps. Never "new".
      cofres: ready + state.freeChestsBanked + (waiting && unlocking.length === 0 ? 1 : 0),
      diario: claimableQuests(state) + (dailyAvailable(state, now) ? 1 : 0),
      construir: buildersFree(state, now) > 0 ? 1 : 0,
    },
    chestTimerMs: unlocking.length
      ? Math.max(0, Math.min(...unlocking.map((s) => (s.endsAt ?? now) - now)))
      : null,
    chestSlots: state.chests.map<SlotState>((slot) => {
      switch (slot.state) {
        case 'unlocking':
          return { state: 'unlocking', remainingMs: Math.max(0, (slot.endsAt ?? now) - now), totalMs: slot.totalMs };
        case 'ready': return { state: 'ready' };
        case 'waiting': return { state: 'waiting' };
        default: return { state: 'empty' };
      }
    }),
    // ¡Zarpar! stays shut until there is a SHIP — never a dead tap, it names
    // the key. balance.json hangs `unlocksAction: zarpar` on the Muelle, but
    // §4.10's exit state wants the Muelle standing at 3:00 *and* Zarpar still
    // closed ("one closed door with the key said out loud"), and the Astillero
    // is the building whose level rows actually carry a `ship`. A dock with no
    // boat is a dock; the door it opens is the shipyard's.
    sailLocked: !state.buildings.some(
      (b) => buildingSpec(b.type).kind === 'support' && b.level > 0 && levelSpec(b.type, b.level).ship
    ),
    leftHanded: Boolean(state.flags.leftHanded),
    // §4.8 — resolved once, in the sim, and handed over. The HUD does not get
    // its own copy of the priority list to drift from.
    cue: nextAction(state, now),
  };
}

function fullProducers(state: GameState, resource: ResourceId): number {
  let count = 0;
  for (const b of state.buildings) {
    if (isProducer(b) && producerResource(b) === resource && isFull(b)) count++;
  }
  return count;
}

/** The XP bar's denominator. XP unlocks nothing (§4.7) — it is the free
 *  "you progressed" signal for sessions where nothing else finished. */
function xpMax(level: number): number {
  const { base, growth } = BALANCE.xp.levelCurve;
  return Math.round(base * Math.pow(growth, Math.max(0, level - 1)));
}

/* --------------------------------------------------------------------------
 * the world-anchored layer
 * ----------------------------------------------------------------------- */

/** Deterministic per building, so bubbles never bob in sync (§3.9). */
const phaseOf = (id: number): number => ((id * 0.3819660112501051) % 1);

export function toWorldItems(state: GameState, now: number): WorldAnchor[] {
  const anchors: WorldAnchor[] = [];

  for (const b of state.buildings) {
    const spec = buildingSpec(b.type);

    // §3.11 — a build or upgrade wears its timer bar.
    if (b.work) {
      anchors.push({
        buildingId: b.id,
        lift: spec.footprint * 1.3,
        item: {
          id: `timer-${b.id}`,
          kind: 'timer',
          remainingMs: Math.max(0, b.work.endsAt - now),
          totalMs: Math.max(1, b.work.endsAt - b.work.startedAt),
        },
      });
    }

    if (!isProducer(b)) continue;
    const resource = producerResource(b);
    if (!resource) continue;

    // §3.9 — the bubble appears as soon as the producer holds ≥1 unit, not
    // when it fills. The island is never visually dead.
    const amount = Math.floor(b.stock);
    if (amount >= 1) {
      anchors.push({
        buildingId: b.id,
        lift: spec.footprint * 1.3,
        item: { id: `pick-${b.id}`, kind: 'bubble', resource, amount, phase: phaseOf(b.id) },
      });
    }

    // §3.10 — the quiet register, anchored lower and to the side of the peak
    // so it can never collide with the bubble on the same structure.
    if (isFull(b)) {
      anchors.push({
        buildingId: b.id,
        lift: spec.footprint * 0.9,
        item: { id: `full-${b.id}`, kind: 'full', resource },
      });
    }
  }

  return anchors;
}

/** `pick-<id>` → the building id, so a bubble tap knows what to collect. */
export function buildingIdOf(worldItemId: string): number | null {
  const match = /^[a-z]+-(\d+)$/.exec(worldItemId);
  return match ? Number(match[1]) : null;
}

/* --------------------------------------------------------------------------
 * §3.15 build mode and §3.16 the upgrade sheet
 * ----------------------------------------------------------------------- */

/** Model id → baked icon, handed in by the scene. Keeps this file DOM-free. */
export type ModelIcons = Record<string, string | undefined>;

/** §3.15's picker rows: the whole catalogue, each carrying its own refusal. */
export function toBuildOptions(state: GameState, now: number, icons: ModelIcons): BuildOption[] {
  return buildCatalog(state, now).map((entry) => {
    const spec = buildingSpec(entry.type);
    return {
      type: entry.type,
      label: spec.label,
      icon: icons[spec.model],
      cost: entry.cost,
      timeMs: entry.timeMs,
      refusal: entry.refusal as RefusalKey | null,
      owned: entry.owned,
      allowed: entry.allowed,
      unlockAtTownHall: entry.unlockAtTownHall,
      unlocked: entry.unlocked,
    };
  });
}

/**
 * The one builder job worth suggesting when the picker has nothing to offer.
 *
 * §4.8 rule 1 blinks Construir whenever a carpenter is idle, and at
 * Ayuntamiento 1 the §4.10 island already owns one of every building the hall
 * allows — so following that blink lands on a picker where every row is
 * correctly greyed. The rule is right (there IS a builder to spend) and the
 * picker is right (there IS nothing to place); what would be wrong is stopping
 * there, because §4.8 also promises the solution is reachable in ≤2 taps.
 *
 * So the picker carries the answer with it: the Ayuntamiento when it can be
 * raised, since it is the building that unblocks the picker itself, and
 * otherwise the cheapest job going.
 */
export function suggestedUpgrade(
  state: GameState, now: number
): { buildingId: number; label: string } | null {
  if (buildersFree(state, now) <= 0) return null;
  const startable = state.buildings.filter((b) => upgradeRefusal(state, b, now) === null);
  if (startable.length === 0) return null;

  const price = (b: Building): number => {
    const plan = upgradePlan(b);
    return plan ? Object.values(plan.cost).reduce<number>((sum, v) => sum + (v ?? 0), 0) : Infinity;
  };
  const hall = startable.find((b) => buildingSpec(b.type).kind === 'townhall');
  const pick = hall ?? startable.sort((a, b) => price(a) - price(b))[0];
  return { buildingId: pick.id, label: buildingSpec(pick.type).label };
}

/**
 * The Ayuntamiento level at which `type` would be allowed to reach `level`.
 *
 * The single most useful number the game can print, and the only place the
 * player is told what the Ayuntamiento is actually for: "Requiere Ayuntamiento
 * 3" turns a wall into a plan. Read off the same ladder the sim enforces, so
 * the promise and the rule cannot disagree.
 */
function hallNeededFor(type: string, level: number): number | undefined {
  const spec = buildingSpec(type);
  for (let hall = 1; hall <= BALANCE.townHall.maxLevel; hall++) {
    if (hall >= spec.unlockAtTownHall && maxLevelAt(type, hall) >= level) return hall;
  }
  return undefined;
}

/** Unlock ids in the town-hall table: buildings and resources carry labels in
 *  balance.json; the feature ids (a chest slot, a hull, a carpenter, a season)
 *  are named in copy.ts's UNLOCK_LABEL. A bare id on the game's most-read
 *  sheet is the loudest possible prototype tell, so it is the last resort. */
const unlockLabel = (id: string): string =>
  BALANCE.buildings[id]?.label ?? BALANCE.resources[id as ResourceId]?.label
    ?? UNLOCK_LABEL[id] ?? id;

/* --------------------------------------------------------------------------
 * LAYOUT_SPEC item 5 — the 2×2 stat grid
 *
 * Four label/value pairs: production, capacity, the attribute that matters for
 * THIS building, and time. Every figure is read off the level rows the sim
 * charges against — `upgradeGains` for the two the sim already publishes, and
 * the same `levels[]` table for the rest. Nothing here is invented and nothing
 * is recomputed from a second copy of the balance data.
 *
 * The third slot is what changes per kind, because "the attribute that matters"
 * genuinely differs:
 *
 *   producer  Se llena en — capacity ÷ rate. §4.2 tunes this ladder deliberately
 *             (3h early, 12h late): it is how long the building keeps earning
 *             while the player is away, which is the number the whole return
 *             loop is built on and the only one that says why capacity matters.
 *   store     Se llena en — the island-wide cap after the upgrade ÷ what the
 *             island actually produces. The same question as the producer's,
 *             asked of the other cap: how long until this spills again.
 *   support   Nivel máx — it produces nothing and holds nothing, so the figure
 *             that decides the tap is how far it may go at this Ayuntamiento.
 *   townhall  Recursos — the hall produces nothing and holds nothing, so its
 *             first two slots are the two ceilings it actually raises, and the
 *             third is §4.1's staged reveal: the levels that put a new currency
 *             in the player's pocket are the ones worth queueing for.
 * ----------------------------------------------------------------------- */

/** A signed increase, or nothing at all when the figure does not move. */
const rise = (from: number, to: number): string | undefined =>
  to > from ? `+${n(to - from)}` : undefined;

/** Every producer of `resource` on the island, summed. What flows into a store. */
function islandRate(state: GameState, resource: ResourceId): number {
  let rate = 0;
  for (const b of state.buildings) {
    if (isProducer(b) && producerResource(b) === resource) {
      rate += levelSpec(b.type, b.level).rate ?? 0;
    }
  }
  return rate;
}

/** How many buildings of any type the island may hold at Ayuntamiento `hall`. */
function buildingsAllowedAt(hall: number): number {
  let total = 0;
  for (const type of Object.keys(BALANCE.buildings)) total += allowedCount(type, hall);
  return total;
}

/** How many currencies are revealed at Ayuntamiento `hall` — §4.1's staged
 *  reveal, read off the same table that decides how many pills the HUD shows. */
function resourcesAt(hall: number): number {
  return (Object.keys(BALANCE.resources) as ResourceId[])
    .filter((id) => hall >= BALANCE.resources[id].revealAtTownHall).length;
}

function upgradeStats(state: GameState, building: Building, plan: UpgradePlan): StatLine[] {
  const spec = buildingSpec(building.type);
  const gains = upgradeGains(building);
  const gain = (metric: 'rate' | 'capacity' | 'storage') => gains.find((g) => g.metric === metric);
  const stats: StatLine[] = [];

  if (spec.kind === 'producer') {
    const rate = gain('rate');
    const cap = gain('capacity');
    if (rate) {
      stats.push({
        label: COPY['stat.rate'],
        value: `${n(rate.to)}<u>${COPY['sheet.perHour']}</u>`,
        delta: rise(rate.from, rate.to),
      });
    }
    if (cap) {
      stats.push({ label: COPY['stat.capacity'], value: n(cap.to), delta: rise(cap.from, cap.to) });
    }
    if (rate && cap && rate.to > 0) {
      stats.push({ label: COPY['stat.fillsIn'], value: dur((cap.to / rate.to) * HOUR) });
    }
  } else if (spec.kind === 'store' && spec.resource) {
    const store = gain('storage');
    const rate = islandRate(state, spec.resource);
    stats.push({
      label: COPY['stat.rate'],
      value: `${n(rate)}<u>${COPY['sheet.perHour']}</u>`,
    });
    if (store) {
      stats.push({ label: COPY['stat.storage'], value: n(store.to), delta: rise(store.from, store.to) });
      // The island-wide cap after this upgrade, divided by what the island
      // actually makes: how long until this resource starts spilling again.
      //
      // The island cap is deliberately NOT printed as its own cell. It is
      // already the denominator of the resource pill at the top of the screen
      // (§3.1), and on an island with one store of a resource — which is every
      // island below Ayuntamiento 3 — it is the identical figure to the cell
      // beside it. A grid cell that repeats its neighbour reads as a bug.
      const cap = storeCap(state, spec.resource) + (store.to - store.from);
      if (rate > 0) stats.push({ label: COPY['stat.fillsIn'], value: dur((cap / rate) * HOUR) });
    }
  } else if (spec.kind === 'support') {
    // A support building neither produces nor stores: its value is the action
    // it unlocks, which the sim carries as an id (`ship: "sloop"`) rather than
    // as anything printable. What IS printable and does decide the tap is the
    // ceiling — how far this building may go before the Ayuntamiento is the
    // thing in the way. Two real cells, not four with two dashes in them.
    stats.push({
      label: COPY['stat.maxLevel'],
      value: String(maxLevelAt(building.type, townHallLevel(state))),
    });
  } else if (spec.kind === 'townhall') {
    const from = BALANCE.townHall.levels[building.level - 1];
    const to = BALANCE.townHall.levels[plan.toLevel - 1];
    if (to) {
      stats.push({
        label: COPY['stat.maxLevel'],
        value: String(to.maxBuildingLevel),
        delta: rise(from?.maxBuildingLevel ?? 0, to.maxBuildingLevel),
      });
      const buildings = buildingsAllowedAt(plan.toLevel);
      stats.push({
        label: COPY['stat.buildings'],
        value: String(buildings),
        delta: rise(buildingsAllowedAt(building.level), buildings),
      });
      // NOT a count of `to.unlocks` — the row under the grid already names
      // them, and "Desbloquea 3" over "Desbloquea: Astillero · …" read as one
      // label printed twice. How many currencies the island runs is the other
      // thing a hall level decides, and it is the one that changes the HUD.
      stats.push({
        label: COPY['stat.resources'],
        value: String(resourcesAt(plan.toLevel)),
        delta: rise(resourcesAt(building.level), resourcesAt(plan.toLevel)),
      });
    }
  }

  stats.push({ label: COPY['stat.time'], value: dur(plan.timeMs) });
  return stats;
}

/** §3.16 — everything the sheet draws about one building. */
export function toUpgradeView(
  state: GameState, building: Building, now: number, icons: ModelIcons
): UpgradeView {
  const spec = buildingSpec(building.type);
  const plan = upgradePlan(building);
  const refusal = upgradeRefusal(state, building, now) as RefusalKey | null;

  return {
    buildingId: building.id,
    label: spec.label,
    icon: icons[spec.model],
    // A plot mid-build is level 0; the sheet says the level it is becoming.
    level: building.level,
    plan: plan ? { toLevel: plan.toLevel, cost: plan.cost, timeMs: plan.timeMs } : undefined,
    stats: plan ? upgradeStats(state, building, plan) : [],
    unlocks: spec.kind === 'townhall' && plan
      ? townHallUnlocks(plan.toLevel).map(unlockLabel)
      : undefined,
    refusal,
    work: building.work
      ? {
          toLevel: building.work.toLevel,
          remainingMs: Math.max(0, building.work.endsAt - now),
          totalMs: Math.max(1, building.work.endsAt - building.work.startedAt),
          gems: finishNowCost(building, now) ?? 0,
        }
      : undefined,
    gems: state.gems,
    store: state.store,
    townHallNeeded: plan ? hallNeededFor(building.type, plan.toLevel) : undefined,
  };
}
