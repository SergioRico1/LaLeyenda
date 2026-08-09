import { Rng } from '../core/rng';
import { BALANCE, levelSpec } from './balance';
import { createCaptain } from './captain';
import { HOUR, MINUTE } from './duration';
import { emptyStore } from './economy';
import { newChestTray } from './chests';
import { islandCentreCell, seedObstaclesInPlace } from './obstacles';
import { rollQuestsInPlace } from './progression';
import { initialRngState } from './rng';
import { SIM_VERSION, type Building, type Captain, type GameState } from './types';

/**
 * state.ts — how a game begins.
 *
 * Two constructors, and the difference matters:
 *
 *   createNewGame()   the real first launch and THE DEFAULT BOOT. OPENING.md,
 *                     decided by the user on 9 Aug: **the Ayuntamiento and
 *                     nothing else**, standing in the middle of a large fixed
 *                     island covered in obstacles the player clears.
 *
 *   createDemoIsland() a mid-game island at Ayuntamiento 4 with every producer
 *                     and store standing, kept for framing screenshots and for
 *                     exercising the late-game HUD. It boots only behind
 *                     `?save=demo` — it used to be the default because there
 *                     was no way to place a building, and a fresh save was
 *                     therefore an island you could not play.
 */

const nextId = (buildings: Building[]): number =>
  buildings.reduce((max, b) => Math.max(max, b.id), 0) + 1;

function building(id: number, type: string, x: number, z: number, level: number, stock = 0): Building {
  return { id, type, x, z, level, stock, work: null };
}

function baseState(seed: string, now: number, tzOffsetMinutes: number): GameState {
  return {
    version: SIM_VERSION,
    seed,
    createdAt: now,
    now,
    tzOffsetMinutes,
    rngState: initialRngState(seed),
    // Rolled off a FORKED stream (`seed:captain`), so an island always has
    // someone standing on it even when nobody has been through creation —
    // every fixture, every screenshot and every test included — and so that
    // changing how a captain rolls can never move a palm on the island.
    captain: createCaptain(seed),
    buildings: [],
    nextBuildingId: 1,
    obstacles: [],
    nextObstacleId: 1,
    store: emptyStore(),
    gems: 0,
    xp: 0,
    level: 1,
    notoriety: 0,
    builders: { owned: BALANCE.builders.start, tempUntil: null },
    chests: newChestTray(),
    freeChestAt: now + BALANCE.chests.freeChest.everyMs,
    freeChestsBanked: 0,
    daily: { day: 1, lastClaimedDay: null, week: 0, stormPasses: BALANCE.daily.stormPassesPerMonth },
    quests: { daily: [], rolledDay: null, coronas: 0 },
    stats: {
      collects: 0, upgrades: 0, chestsOpened: 0, obstacles: 0,
      'collected.oro': 0, 'collected.madera': 0, 'collected.ron': 0, 'collected.metal': 0,
    },
    flags: {},
  };
}

function seedQuests(state: GameState): void {
  const rng = new Rng(state.seed);
  rng.cursor = state.rngState;
  rollQuestsInPlace(state, state.now, rng);
  state.rngState = rng.cursor;
}

/* --------------------------------------------------------------------------
 * the real first launch — OPENING.md
 * ----------------------------------------------------------------------- */

/**
 * Day one, the Clash way. OPENING.md, decided by the user on 9 Aug:
 *
 *   > **the player starts with the Ayuntamiento and nothing else.** Everything
 *   > on the island after that, they built.
 *
 * What that replaces is §4.10's beat sheet, which seeded six buildings and
 * choreographed an opening onto a working economy — a timer already running, a
 * producer already full, a chest already brewing. Every one of those was
 * something the player found rather than did, and the ownership Clash trades on
 * comes from the opposite: a mature base is entirely the player's own placements.
 *
 * Three parts, and they only work together (OPENING.md's own framing):
 *
 *  1. **The map is large and FIXED.** 44 cells from the first frame, never
 *     growing, so there is no plateau moving under anyone's feet and no save to
 *     migrate. The hall stands in the middle of it.
 *  2. **One building.** This one.
 *  3. **The empty land is covered in obstacles.** Part 3 is the one everybody
 *     forgets and it is load-bearing: without it this island is a void with a
 *     single building in it. With it, the emptiness is wilderness being tamed,
 *     and a player with nothing affordable still has something to do in their
 *     first thirty seconds — which is also where their first 300 madera comes
 *     from.
 *
 * What the player finds, and every number is doing a job:
 *
 *   · 250 madera, against an Aserradero Nv1 at 300. Deliberately just short:
 *     the tutorial's first instruction is *clear that palm, then put your
 *     Aserradero on the ground it freed*, and the smallest obstacle payout (40)
 *     always closes the gap. Being handed enough would make the first clear
 *     optional, and an optional tutorial beat is one nobody performs.
 *   · Two builders, both idle, so the very first frame has a free carpenter and
 *     §4.8's rule 1 fires on it. No 24h loan — that was beat 2:25 paying for a
 *     builder wall this opening does not have.
 *   · Five gems, the same five §4.4's golden rule is written for.
 *   · An empty tray and an unclaimed daily. There is no Muelle yet, so there is
 *     no Cofre Libre cadence to start — the harbour is something to build.
 *   · `tutorialDone` FALSE. The beat sheet is no longer pre-walked, because the
 *     tutorial finally has a job that is obvious and physical.
 *   · A CAPTAIN. `captain` is the one the creation screen built, or — for every
 *     fixture, capture and direct boot that never went through creation — one
 *     rolled off the seed. `seed` stays the single source of truth for the
 *     island, so a captain arriving with a different one is corrected rather
 *     than believed: the ground has already been generated by the time anyone
 *     could disagree about it.
 */
export function createNewGame(
  seed: string,
  now: number,
  tzOffsetMinutes: number,
  captain?: Captain
): GameState {
  const state = baseState(seed, now, tzOffsetMinutes);
  if (captain) state.captain = { ...captain, seed };

  // The middle of the island, derived from the one grid constant rather than
  // written down twice — so the hall and the obstacle field cannot disagree
  // about where the centre is.
  const centre = islandCentreCell();
  state.buildings = [building(1, 'ayuntamiento', centre, centre, 1)];
  state.nextBuildingId = nextId(state.buildings);

  state.store.madera = 250;
  state.gems = 5;

  seedObstaclesInPlace(state);
  seedQuests(state);
  return state;
}

/* --------------------------------------------------------------------------
 * the island the scene actually shows today
 * ----------------------------------------------------------------------- */

/**
 * Ayuntamiento 4: five pills (§4.1), every producer and store standing, one
 * builder busy and one free so the free-builder hook is live, and a chest tray
 * mid-cycle. Cells match the layout render/ was tuned against.
 *
 * ✎ These cells are a 26-grid layout and they PRE-DATE both the 44 grid and the
 * clearance rule, so this fixture packs tighter than `place()` would now allow.
 * That is left alone on purpose: reference/SPACING.md's own measurement is that
 * eleven buildings need 283 cells and a 26 grid offers 255, so there is no
 * re-spacing of this layout that would satisfy the rule — the fix is the bigger
 * island, and the fixture is a framing prop rather than an island anyone plays.
 * It carries no obstacles for the same reason: a mid-game island has been
 * cleared, and a field seeded for a 44 grid would not land on this one.
 */
export function createDemoIsland(seed: string, now: number, tzOffsetMinutes: number): GameState {
  const state = baseState(seed, now, tzOffsetMinutes);

  state.buildings = [
    building(1, 'ayuntamiento', 13, 11, 4),
    building(2, 'aserradero', 8, 9, 2),
    building(3, 'mercado', 18, 9, 3),
    building(4, 'destileria', 8, 14, 2),
    building(5, 'fundicion', 19, 14, 1),
    building(6, 'almacen', 13, 7, 2),
    building(7, 'banco', 14, 17, 1),
    building(8, 'bodega', 16, 20, 2),
    building(9, 'deposito', 11, 21, 1),
    building(10, 'muelle', 22, 18, 1),
    building(11, 'astillero', 9, 18, 1),
  ];
  state.nextBuildingId = nextId(state.buildings);

  // §2.1's portrait diagram, which is also the mock the HUD was built against.
  state.store = { oro: 815, madera: 2436, ron: 1556, metal: 480 };
  state.gems = 256;
  state.level = 3;
  state.xp = 62;
  state.notoriety = 1240;

  // Producers part-filled, so bubbles are up on three of them in frame 1 and
  // two more are at their cap wearing `¡Lleno!`.
  const stock = (id: number, value: number) => {
    const b = state.buildings.find((x) => x.id === id);
    if (b) b.stock = value;
  };
  stock(2, 260);                                     // Aserradero, bubble
  stock(3, 320);                                     // Mercado, bubble
  stock(4, 180);                                     // Destilería, bubble
  stock(5, levelSpec('fundicion', 1).capacity ?? 0); // Fundición ¡Lleno!

  // One upgrade running, one builder free — the state §4.10 calls the real
  // deliverable of a session.
  const hall = state.buildings[0];
  const upgradeMs = levelSpec('ayuntamiento', 5).timeMs;
  const remaining = 7 * MINUTE + 17 * 1000;
  hall.work = { kind: 'upgrade', toLevel: 5, startedAt: now - (upgradeMs - remaining), endsAt: now + remaining };

  // Tray mid-cycle: one ready, one unlocking at 3h 51m, one waiting, one empty.
  state.chests[0] = { type: 'plata', state: 'ready', endsAt: null, totalMs: BALANCE.chests.types.plata.timeMs };
  state.chests[1] = {
    type: 'oro', state: 'unlocking',
    endsAt: now + 3 * HOUR + 51 * MINUTE,
    totalMs: BALANCE.chests.types.oro.timeMs,
  };
  state.chests[2] = { type: 'madera', state: 'waiting', endsAt: null, totalMs: BALANCE.chests.types.madera.timeMs };

  seedQuests(state);
  // A returning player has already done some of today's work; two of the three
  // dailies sit claimable, which is what puts a `3` on the Diario.
  for (const quest of state.quests.daily.slice(0, 2)) quest.progress = quest.target;

  return state;
}
