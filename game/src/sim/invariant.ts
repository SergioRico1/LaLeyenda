import {
  BALANCE, RESOURCE_IDS, allowedCount, buildingSpec, maxLevelAt, type ResourceId,
} from './balance';

/**
 * invariant.ts — UI_SPEC §4.2's STORE INVARIANT, as code.
 *
 * > For every Ayuntamiento level N, the total reachable capacity of each
 * > resource must exceed the most expensive cost the player can need at that
 * > level by ≥25%. If Ayto 4 costs 45 000 madera and the reachable cap is
 * > 40 000, the player is sealed in with no exit and no shop to sell them one.
 *
 * The spec asks for this to be a build-failing test, and it is: `npm test`
 * walks the shipped balance.json and refuses on any violation. It is the one
 * piece of balance that cannot be left to judgement, because the failure mode
 * is silent — nothing crashes, the player simply cannot progress and quits.
 */

export interface Violation {
  townHall: number;
  resource: ResourceId;
  reachable: number;
  worst: number;
  required: number;
  /** What costs that much, so the failure names the offender. */
  source: string;
}

export interface InvariantRow {
  townHall: number;
  resource: ResourceId;
  reachable: number;
  worst: number;
  required: number;
  source: string;
  ok: boolean;
}

/** Everything the island can bank in `resource` once fully upgraded at `hall`. */
export function reachableCapacity(resource: ResourceId, hall: number): number {
  // The hall's own strongroom counts: it is real capacity, and on a day-one
  // island it is the only capacity there is.
  let total = BALANCE.townHall.baseStorage[resource] ?? 0;
  for (const [type, spec] of Object.entries(BALANCE.buildings)) {
    if (spec.kind !== 'store' || spec.resource !== resource) continue;
    if (hall < spec.unlockAtTownHall) continue;
    const level = maxLevelAt(type, hall);
    if (level < 1) continue;
    total += (spec.levels[level - 1].capacity ?? 0) * allowedCount(type, hall);
  }
  return total;
}

/**
 * The single most expensive thing the player can be asked to pay in
 * `resource` while sitting at Ayuntamiento `hall` — including the upgrade OUT
 * of that level, which is the one that actually walls people in.
 */
export function worstCost(resource: ResourceId, hall: number): { amount: number; source: string } {
  let amount = 0;
  let source = 'none';

  const next = BALANCE.townHall.levels[hall]; // levels[hall] is level hall+1
  if (next) {
    const need = next.cost[resource] ?? 0;
    if (need > amount) { amount = need; source = `Ayuntamiento Nv${next.level}`; }
  }

  for (const spec of Object.values(BALANCE.buildings)) {
    if (spec.kind === 'townhall') continue;
    if (hall < spec.unlockAtTownHall) continue;
    const top = maxLevelAt(spec.id, hall);
    for (let level = 1; level <= top; level++) {
      const need = spec.levels[level - 1].cost[resource] ?? 0;
      if (need > amount) { amount = need; source = `${spec.label} Nv${level}`; }
    }
  }
  return { amount, source };
}

/** Every (Ayuntamiento level × resource) pair, checked. */
export function auditStorage(headroom = BALANCE.invariant.storageHeadroom): InvariantRow[] {
  const rows: InvariantRow[] = [];
  for (let hall = 1; hall <= BALANCE.townHall.maxLevel; hall++) {
    for (const resource of RESOURCE_IDS) {
      const { amount, source } = worstCost(resource, hall);
      const reachable = reachableCapacity(resource, hall);
      const required = amount * (1 + headroom);
      rows.push({
        townHall: hall, resource, reachable, worst: amount, required, source,
        // A resource nothing costs at this level cannot wall anyone.
        ok: amount === 0 || reachable >= required,
      });
    }
  }
  return rows;
}

export function checkStorageInvariant(headroom = BALANCE.invariant.storageHeadroom): Violation[] {
  return auditStorage(headroom)
    .filter((row) => !row.ok)
    .map((row) => ({
      townHall: row.townHall, resource: row.resource, reachable: row.reachable,
      worst: row.worst, required: row.required, source: row.source,
    }));
}

/**
 * A second, stricter guard the spec implies but does not spell out: a store
 * whose own next level costs more than that store can currently hold is a wall
 * with no exit either. Checked in the same resource the store banks.
 */
export function checkStoreLadder(): Violation[] {
  const out: Violation[] = [];
  for (const [type, spec] of Object.entries(BALANCE.buildings)) {
    if (spec.kind !== 'store' || !spec.resource) continue;
    const resource = spec.resource;
    for (let level = 2; level <= spec.levels.length; level++) {
      const need = spec.levels[level - 1].cost[resource] ?? 0;
      if (need === 0) continue;
      const ladder = spec.maxLevelByTownHall ?? [];
      const at = ladder.findIndex((cap) => cap >= level);
      const hall = at >= 0 ? at + 1 : BALANCE.townHall.maxLevel;
      const held = (spec.levels[level - 2].capacity ?? 0) * allowedCount(type, hall);
      if (held < need) {
        out.push({
          townHall: hall, resource, reachable: held, worst: need, required: need,
          source: `${buildingSpec(type).label} Nv${level} costs more ${resource} than Nv${level - 1} can hold`,
        });
      }
    }
  }
  return out;
}
