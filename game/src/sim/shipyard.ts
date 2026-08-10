import { BALANCE, buildingSpec, maxLevelAt, type Cost } from './balance';
import { SHIPS, type ShipSpec } from './sea';
import type { GameState } from './types';

/**
 * shipyard.ts — who owns which hull, as pure functions on the save.
 *
 * PLAN.md Fase 4 promises the ladder (Skiff → Sloop → Galleon → Frigate →
 * Marauder) and ROADMAP round 10 orders it built. The one design decision this
 * file exists to state is WHERE ownership lives:
 *
 *   **Ownership is the Astillero's level. There is no second ledger.**
 *
 * balance.json has always hung a `ship` on each Astillero level row, the HUD's
 * ¡Zarpar! lock has always read those rows (`sailLocked` in ui/present.ts),
 * and the upgrade sheet already charges and times them through the same
 * builder-and-timer machinery as every other building. So the purchase IS the
 * upgrade: tap the Astillero, pay the row (20k → 90k → 220k → 450k oro, the
 * long-arc sink RETENTION.md's days/weeks clock asks for), wait the timer, own
 * the hull. A separate `ownedShips` array in the save would have to be kept
 * agreeing with that building forever, and the first migration that forgot one
 * side would strand a player with a frigate they cannot sail or a bill they
 * already paid. Deriving it means no new save field, no migration, and no way
 * for the two to drift — a version-1 save that upgrades its shipyard owns the
 * sloop with zero ceremony.
 *
 * The fleet has no loadout screen on purpose: you sail your best hull, the way
 * a Clash player attacks with their best-trained army. `flagship` is that rule.
 *
 * Everything here is arithmetic over GameState — no clock, no randomness, no
 * three.js — so tools/tests/shipyard.test.ts can prove the whole ladder
 * headlessly, purchase included.
 */

/** The building whose levels are the ladder. */
export const SHIPYARD_BUILDING = 'astillero';

/**
 * The five classes in sailing order, read off the Astillero's own level rows
 * rather than written down a second time — the rows are the price list, so
 * they are also the order.
 */
export const SHIP_ORDER: readonly string[] = buildingSpec(SHIPYARD_BUILDING)
  .levels.map((level) => level.ship)
  .filter((ship): ship is string => typeof ship === 'string');

/** A hull's sailing numbers — sea.ts's own table, re-exported so a caller with
 *  a ship id never has to know which module owns the sea. */
export function shipSpec(ship: string): ShipSpec {
  const spec = SHIPS[ship];
  if (!spec) throw new Error(`[shipyard] unknown ship: ${ship}`);
  return spec;
}

/**
 * The Astillero's finished level — 0 with none standing.
 *
 * `level` is 0 while the first build job runs (the plot exists, the building
 * does not), and a mid-upgrade keeps its OLD level until the work completes,
 * so a hull is never sailable before its timer has been served.
 */
export function shipyardLevel(state: GameState): number {
  let level = 0;
  for (const building of state.buildings) {
    if (building.type === SHIPYARD_BUILDING) level = Math.max(level, building.level);
  }
  return level;
}

/** Every hull the captain has paid for, in sailing order. Level N of the
 *  Astillero owns the first N rungs — buying up never loses a hull. */
export function ownedShips(state: GameState): string[] {
  return SHIP_ORDER.slice(0, Math.min(SHIP_ORDER.length, shipyardLevel(state)));
}

export function ownsShip(state: GameState, ship: string): boolean {
  const rung = SHIP_ORDER.indexOf(ship);
  return rung >= 0 && shipyardLevel(state) >= rung + 1;
}

/**
 * The hull at the helm: the best one owned, or null with no shipyard standing.
 *
 * Null rather than a silent 'skiff' because the two callers want different
 * things from an empty yard: the island HUD keeps ¡Zarpar! locked (it already
 * does, off the same rows), while a voyage that somehow starts anyway — a
 * capture, a dev boot — falls back via `shipForVoyage`.
 */
export function flagship(state: GameState): string | null {
  const owned = ownedShips(state);
  return owned.length > 0 ? owned[owned.length - 1] : null;
}

/** What the next voyage sails. The one caller-facing answer. */
export function shipForVoyage(state: GameState): string {
  return flagship(state) ?? SHIP_ORDER[0] ?? 'skiff';
}

export interface NextShip {
  ship: string;
  /** The Astillero level that buys it. */
  level: number;
  cost: Cost;
  timeMs: number;
  /** The Ayuntamiento level that opens that rung — the honest answer to "why
   *  is this greyed", read off the same ladder the sim enforces. */
  hallNeeded: number;
}

/**
 * The next rung of the ladder, priced — or null from the top of it.
 *
 * This is a reading, not an action: the purchase itself goes through the
 * ordinary upgrade flow (`startUpgrade` on the Astillero), which is what
 * charges the cost, occupies the builder and serves the timer. Anything that
 * wants to SELL the next hull — a sheet, a locked CTA naming its key — prints
 * these numbers and dispatches that.
 */
export function nextShip(state: GameState): NextShip | null {
  const yard = buildingSpec(SHIPYARD_BUILDING);
  const level = shipyardLevel(state) + 1;
  const row = yard.levels[level - 1];
  if (!row || !row.ship) return null;

  let hallNeeded = BALANCE.townHall.maxLevel;
  for (let hall = 1; hall <= BALANCE.townHall.maxLevel; hall++) {
    if (hall >= yard.unlockAtTownHall && maxLevelAt(SHIPYARD_BUILDING, hall) >= level) {
      hallNeeded = hall;
      break;
    }
  }
  return { ship: row.ship, level, cost: row.cost, timeMs: row.timeMs, hallNeeded };
}
