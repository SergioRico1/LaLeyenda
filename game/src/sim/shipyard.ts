import { BALANCE, buildingSpec, maxLevelAt, type Cost } from './balance';
import { SHIPS, SHIP_TYPES, type ShipSpec } from './sea';
import type { GameState } from './types';

/**
 * shipyard.ts — who owns which hull, as pure functions on the save.
 *
 * PLAN.md Fase 4 promises the ladder (Skiff → Sloop → Galleon → Frigate →
 * Marauder) and ROADMAP round 10 ordered it built. Round 12 moved its first
 * rung, and the move is the round's whole finding: the playtest walked the
 * entire cold path and never sailed, because the starter hull hung off an
 * Astillero that sits behind hall 2, hall 3 and 5 000 madera. The design call,
 * made once and built here: **the starter skiff sails free.** The skiff is the
 * MUELLE's — a 300-madera dock at hall 1 comes with a boat tied to it — and
 * the Astillero gates BETTER hulls, not sailing at all.
 *
 * The one design decision this file exists to state is WHERE ownership lives:
 *
 *   **Ownership is a level row. There is no second ledger.**
 *
 * balance.json hangs a `ship` on the level row that buys each hull — the
 * Muelle's single level carries the skiff, the Astillero's rows 2..5 carry the
 * deep four (its row 1 is the yard itself). The HUD's ¡Zarpar! lock reads
 * those rows (`sailLocked` in ui/present.ts), the tutorial's `hasShip` reads
 * those rows, and the purchase is the ordinary build/upgrade with its cost and
 * its timer. A separate `ownedShips` array in the save would have to be kept
 * agreeing with the buildings forever, and the first migration that forgot one
 * side would strand a player with a frigate they cannot sail or a bill they
 * already paid. Deriving it means no new save field, no migration, and no way
 * for the two to drift — a version-1 save that raises its shipyard owns the
 * sloop with zero ceremony, and one that built a dock last month wakes up
 * owning the skiff it was always owed.
 *
 * The fleet has no loadout screen on purpose: you sail your best hull, the way
 * a Clash player attacks with their best-trained army. `flagship` is that rule.
 *
 * Everything here is arithmetic over GameState — no clock, no randomness, no
 * three.js — so tools/tests/shipyard.test.ts can prove the whole ladder
 * headlessly, purchase included.
 */

/** The building whose upper levels are the deep ladder. */
export const SHIPYARD_BUILDING = 'astillero';

/** The building whose single level carries the free starter hull. */
export const HARBOUR_BUILDING = 'muelle';

/** Where a hull is bought: the building and the level row that carries it. */
export interface Purchase {
  building: string;
  level: number;
  cost: Cost;
  timeMs: number;
}

/**
 * Every hull's purchase row, found by walking the catalogue once. balance.json
 * is the only author: a hull with no row cannot be owned, and a hull with two
 * rows is a data bug this loop would surface in tests immediately (the later
 * row would win, and the price assertions read these).
 */
const PURCHASES: Readonly<Record<string, Purchase>> = (() => {
  const out: Record<string, Purchase> = {};
  for (const [building, spec] of Object.entries(BALANCE.buildings)) {
    spec.levels.forEach((row, i) => {
      if (row.ship) out[row.ship] = { building, level: i + 1, cost: row.cost, timeMs: row.timeMs };
    });
  }
  return out;
})();

/**
 * The five classes in sailing order — sea.ts's own SHIP_TYPES, narrowed to the
 * hulls that actually have a purchase row. The sea owns what a hull IS; the
 * catalogue owns what it COSTS; this is where the two are checked against each
 * other (the suite asserts every SHIP_TYPE is purchasable).
 */
export const SHIP_ORDER: readonly string[] = SHIP_TYPES.filter((ship) => PURCHASES[ship]);

/** A hull's sailing numbers — sea.ts's own table, re-exported so a caller with
 *  a ship id never has to know which module owns the sea. */
export function shipSpec(ship: string): ShipSpec {
  const spec = SHIPS[ship];
  if (!spec) throw new Error(`[shipyard] unknown ship: ${ship}`);
  return spec;
}

/** Where `ship` is (or would be) bought. Throws on a hull balance.json does
 *  not sell, which is a data bug rather than a state. */
export function purchaseOf(ship: string): Purchase {
  const row = PURCHASES[ship];
  if (!row) throw new Error(`[shipyard] no purchase row for: ${ship}`);
  return row;
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

/**
 * Every hull the captain owns, in sailing order.
 *
 * A hull is owned when some standing building has REACHED the row that carries
 * it: the Muelle at level 1 owns the skiff, the Astillero at level N owns every
 * ship on rows 1..N. Reaching, not standing-at, so buying up never loses a
 * hull; finished levels only, so paying is not owning until the timer is
 * served (level stays below the row mid-work).
 */
export function ownedShips(state: GameState): string[] {
  const owned = new Set<string>();
  for (const building of state.buildings) {
    if (building.level < 1) continue;
    const rows = buildingSpec(building.type).levels;
    const reached = Math.min(building.level, rows.length);
    for (let i = 0; i < reached; i++) {
      const ship = rows[i].ship;
      if (ship) owned.add(ship);
    }
  }
  return SHIP_ORDER.filter((ship) => owned.has(ship));
}

export function ownsShip(state: GameState, ship: string): boolean {
  return ownedShips(state).includes(ship);
}

/**
 * The hull at the helm: the best one owned, or null with no dock standing.
 *
 * Null rather than a silent 'skiff' because the two callers want different
 * things from a boatless island: the HUD keeps ¡Zarpar! locked (it already
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
  /** The building whose level row buys it — 'muelle' for the skiff,
   *  'astillero' for everything after. */
  building: string;
  /** The level of that building that buys it. */
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
 * ordinary build/upgrade flow (`place` or `startUpgrade` on the named
 * building), which is what charges the cost, occupies the builder and serves
 * the timer. Anything that wants to SELL the next hull — a sheet, a locked
 * CTA naming its key — prints these numbers and dispatches that.
 */
export function nextShip(state: GameState): NextShip | null {
  const owned = new Set(ownedShips(state));
  const ship = SHIP_ORDER.find((s) => !owned.has(s));
  if (!ship) return null;
  const row = purchaseOf(ship);
  const spec = buildingSpec(row.building);

  let hallNeeded = BALANCE.townHall.maxLevel;
  for (let hall = 1; hall <= BALANCE.townHall.maxLevel; hall++) {
    if (hall >= spec.unlockAtTownHall && maxLevelAt(row.building, hall) >= row.level) {
      hallNeeded = hall;
      break;
    }
  }
  return { ship, building: row.building, level: row.level, cost: row.cost, timeMs: row.timeMs, hallNeeded };
}
