import { Rng } from '../core/rng';
import { BALANCE, levelSpec } from './balance';
import { HOUR, MINUTE } from './duration';
import { emptyStore } from './economy';
import { newChestTray } from './chests';
import { rollQuestsInPlace } from './progression';
import { initialRngState } from './rng';
import { SIM_VERSION, type Building, type GameState } from './types';

/**
 * state.ts — how a game begins.
 *
 * Two constructors, and the difference matters:
 *
 *   createNewGame()   the real first launch, built to §4.10's beat sheet — one
 *                     Aserradero pre-seeded with 60 madera so no bubble is ever
 *                     empty, one Mercado, the two starting stores, 5 gems.
 *
 *   createDemoIsland() a mid-game island at Ayuntamiento 4 with every producer
 *                     and store standing. Until the build/placement flow lands
 *                     there is no way for a player to place a building, so a
 *                     genuinely fresh save would be an island you cannot play.
 *                     This is the scene's default; the numbers are §2.1's.
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
    buildings: [],
    nextBuildingId: 1,
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
 * the real first launch — §4.10
 * ----------------------------------------------------------------------- */

export function createNewGame(seed: string, now: number, tzOffsetMinutes: number): GameState {
  const state = baseState(seed, now, tzOffsetMinutes);
  state.buildings = [
    building(1, 'ayuntamiento', 13, 11, 1),
    // Beat 0:20 — the first producer is PRE-SEEDED so the very first bubble is
    // never empty. The 1-second payoff for opening the app is not negotiable.
    building(2, 'aserradero', 8, 9, 1, 60),
    building(3, 'mercado', 18, 9, 1),
    building(4, 'almacen', 13, 7, 1),
    building(5, 'banco', 14, 17, 1),
  ];
  state.nextBuildingId = nextId(state.buildings);
  state.store.oro = 250;   // beat 0:32
  state.gems = 5;          // beat 1:32 spends exactly one of them
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
