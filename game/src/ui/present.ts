import {
  BALANCE, buildersFree, buildersTotal, buildingSpec, claimableQuests, dailyAvailable, isFull,
  isProducer, nextAction, producerResource, storeCap, townHallLevel,
  type GameState, type ResourceId,
} from '../sim';
import { n } from './format';
import type { HudState, ResourceState, WorldItemSpec } from './hud';
import type { SlotState } from './components/tray';

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
    // ¡Zarpar! before the Muelle exists — never a dead tap, it names the key.
    sailLocked: !state.buildings.some((b) => b.type === 'muelle' && b.level > 0),
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
