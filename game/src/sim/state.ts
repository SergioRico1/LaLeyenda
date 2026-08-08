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
 *   createNewGame()   the real first launch and THE DEFAULT BOOT. It returns
 *                     §4.10's **exit state at 3:00** — the beat sheet already
 *                     walked — with the beats that are a tap left live, so the
 *                     player performs them instead of finding them spent.
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

/** Puts a job on a building that is `remaining` ms from finishing. */
function working(b: Building, toLevel: number, now: number, remaining: number): Building {
  const total = levelSpec(b.type, toLevel).timeMs;
  b.work = {
    kind: b.level === 0 ? 'build' : 'upgrade',
    toLevel,
    startedAt: now - Math.max(0, total - remaining),
    endsAt: now + remaining,
  };
  return b;
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

/**
 * §4.10, as state rather than as a script.
 *
 * The beat sheet ends by naming its own deliverable: *"Exit state at 3:00 — the
 * real deliverable of the session. Six reasons to return across three time
 * scales."* That list, not the 0:00 island, is what a save has to contain,
 * because the loop has to already be turning the first time anyone looks at it.
 * The previous constructor shipped the 0:00 island — five buildings, no Muelle,
 * no chest, no temp builder — and an honest playthrough hit a wall five minutes
 * in with nothing affordable and every timer stopped.
 *
 * So this returns the 3:00 state, with one rule about which beats are spent:
 *
 *   • Beats that are *scenery* are pre-consumed (the Muelle stands, the tutorial
 *     grants are banked, the hall upgrade is already running).
 *   • Beats that are *a tap* are left live, because a tutorial beat the player
 *     never performs has taught nothing. The chest still has to be opened, the
 *     daily still has to be claimed, and the third builder still has to be
 *     given a job.
 *
 * Reason to return, by number, exactly as §4.10 lists them:
 *   1. Ayuntamiento Nv1→2 building, 8m 12s left.
 *   2. Muelle finished; its Cofre Libre cadence started.
 *   3. Aserradero bubble at 35% of its cap and visibly rising.
 *   4. A chest brewing in the tray.
 *   5. Tomorrow's daily named and unclaimed (day 1 of the chain).
 *   6. ¡Zarpar! still shut, with the Astillero named as its key.
 */
export function createNewGame(seed: string, now: number, tzOffsetMinutes: number): GameState {
  const state = baseState(seed, now, tzOffsetMinutes);

  const hall = building(1, 'ayuntamiento', 13, 11, 1);
  // Reason 1. Beat 0:45 hands the player 950 of the 1 000 madera on purpose and
  // 1:05 starts the job; 8m 12s of the 10m timer is what is left at 3:00.
  working(hall, 2, now, 8 * MINUTE + 12 * 1000);

  // Reason 3. Beat 0:20's pre-seeded producer, three minutes older: 35% of the
  // 600 it can hold. The very first bubble is never empty — the one-second
  // payoff for opening the app is not negotiable.
  const saw = building(2, 'aserradero', 8, 9, 1, Math.round((levelSpec('aserradero', 1).capacity ?? 600) * 0.35));
  // Beat 1:15's second timer. §3.11 is written for two bars on screen at once,
  // and beat 2:25 cannot expose a builder wall with one carpenter still idle —
  // so both permanent builders are out, and the loan is what frees the player.
  // It keeps producing at Nv1 while it works, so the bubble above it is real.
  working(saw, 2, now, 3 * MINUTE + 40 * 1000);

  state.buildings = [
    hall,
    saw,
    building(3, 'mercado', 18, 9, 1, 40),   // beat 0:32, and its own bubble
    building(4, 'almacen', 13, 7, 1),
    building(5, 'banco', 14, 17, 1),
    // Reason 2. Beat 1:15 — placed for a 1m timer, long finished by 3:00.
    building(6, 'muelle', 22, 18, 1),
  ];
  state.nextBuildingId = nextId(state.buildings);

  // Pre-financed (§4.10's own words). The oro is beat 0:32's grant; the madera
  // is what beat 2:25's gifted carpenter is meant to spend — an Almacén Nv2 at
  // 1 000 madera is the one job available at Ayuntamiento 1, and a third
  // builder with no affordable job would be a gift that mocks the player.
  state.store.oro = 250;
  state.store.madera = 1000;
  state.gems = 5;

  // Beat 2:25 — the builder wall is exposed on purpose, then a 24h carpintero
  // de guardia is gifted. Two permanent builders are on the two timers above,
  // so the loan is the free one and §4.8's rule 1 fires on the first frame.
  state.builders.tempUntil = now + BALANCE.builders.tempBuilderMs;

  // Reason 4 and beat 1:32 in one object: a Cofre de Madera already unlocking,
  // PRE-AGED to inside §4.4's golden-rule window so "Abrir ahora" costs exactly
  // one of the five gems. That price is the whole lesson — gems buy time, at a
  // number that cannot hurt, on the session where the player is happiest.
  const chest = BALANCE.chests.types.madera;
  state.chests[0] = {
    type: chest.id,
    state: 'unlocking',
    endsAt: now + 4 * MINUTE,
    totalMs: chest.timeMs,
  };
  // The Muelle is standing, so its 4h Cofre Libre clock is already ticking.
  state.freeChestAt = now + BALANCE.chests.freeChest.everyMs;

  // Beat 0:20 and 0:45 were two taps on a bubble. Nothing else has been done:
  // the daily is unclaimed (reason 5) and no chest has been opened yet.
  state.stats.collects = 2;
  seedQuests(state);

  // §4.10 has been walked. A guide layer reads this rather than replaying it.
  state.flags.tutorialDone = true;
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
