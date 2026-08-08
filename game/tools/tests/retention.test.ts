import {
  BALANCE, DAY, HOUR, MINUTE, buildersFree, buildCatalog, claimDaily, claimFreeChest, claimQuest,
  collect, createNewGame, dailyAvailable, isProducer, nextAction, openChest, place, producerCapacity,
  questComplete, skipChest, skipCost, spotRefusal, startChest, startUpgrade, tick, upgradeRefusal,
  type GameState,
} from '../../src/sim';
import { describe, eq, ok, test } from './harness';
import { T0, TZ } from './fixtures';

/**
 * retention.test.ts — RETENTION.md's ONE rule, made enforceable.
 *
 *   > Regla de diseño: **nunca dejes al jugador sin un timer corriendo y sin
 *   > algo que recoger.** Si una sesión termina con la isla "vacía" (nada
 *   > construyéndose, nada produciendo), el bucle se ha roto y hay que
 *   > arreglarlo.
 *
 * The document ends by asking that as a question. UI_SPEC §9 says turning the
 * question into a mechanism is the job; §4.8 did half of it by making the HUD
 * answer it. This file does the other half, which is proving the answer is
 * never "no" in the first place.
 *
 * The instrument is a bot that plays a NEW GAME greedily for 24 simulated
 * hours. A bot is the right tool because this failure is invisible to every
 * other kind of test: nothing throws, no number is wrong, the player simply
 * opens a dead island on the second day and does not come back.
 *
 * ─── two claims, deliberately kept apart ───────────────────────────────────
 *
 * 1. THE RULE, on the state the player FINDS. A timer is running, or something
 *    is waiting to be collected. Measured across the whole day, on every
 *    arrival, this is violated for **0 seconds**.
 *
 * 2. THE SESSION CLOSE, on the state the player LEAVES. RETENTION.md's session
 *    loop step 5 is "cierras con algo construyéndose": a session must be able
 *    to end with a timer running. Checking that instant-by-instant would be
 *    meaningless — the bot has just collected everything, so of course nothing
 *    is collectable in that microsecond. What matters is the LENGTH of the
 *    stretch during which no timer runs and none can be started. That is
 *    measured and budgeted, not asserted pointwise.
 *
 * Splitting them matters. Asserted as one pointwise conjunction, the rule is
 * either trivially true (count "a producer exists" as collectable) or trivially
 * false (check one tick after a collect-all). Neither version can fail for the
 * reason the design cares about.
 */

/* --------------------------------------------------------------------------
 * the three predicates
 * ----------------------------------------------------------------------- */

/** Something is being built, upgraded, or brewed — a dated reason to return. */
function runningTimer(state: GameState): string | null {
  for (const b of state.buildings) if (b.work) return `${b.type}→Nv${b.work.toLevel}`;
  const slot = state.chests.findIndex((c) => c.state === 'unlocking');
  return slot >= 0 ? `cofre ${state.chests[slot].type}` : null;
}

/**
 * Something is one tap from a reward, right now.
 *
 * Deliberately NARROW: accumulated production, a finished chest, and a Cofre
 * Libre waiting at the Muelle. A claimable daily or quest is not counted even
 * though §4.8 surfaces it — the daily arrives once a day whether the island is
 * alive or dead, so letting it stand in for production would let a corpse pass
 * this test every morning.
 */
function collectable(state: GameState): string | null {
  for (const b of state.buildings) {
    if (isProducer(b) && b.stock >= 1) return `${b.type} ×${Math.floor(b.stock)}`;
  }
  if (state.chests.some((c) => c.state === 'ready')) return 'cofre listo';
  if (state.freeChestsBanked > 0) return 'cofre libre en el muelle';
  return null;
}

/** A timer the player could start right now, if they wanted to leave one. */
function startableTimer(state: GameState): string | null {
  const now = state.now;
  if (state.chests.some((c) => c.state === 'waiting') && !state.chests.some((c) => c.state === 'unlocking')) {
    return 'un cofre en la bandeja';
  }
  if (buildersFree(state, now) <= 0) return null;
  const up = state.buildings.find((b) => upgradeRefusal(state, b, now) === null);
  if (up) return `${up.type} → Nv${up.level + 1}`;
  const open = buildCatalog(state, now).find((e) => e.refusal === null);
  return open ? `colocar ${open.type}` : null;
}

/** RETENTION.md's literal corpse: "nada construyéndose, nada produciendo". */
const producing = (state: GameState): boolean =>
  state.buildings.some((b) => isProducer(b) && b.stock < producerCapacity(b) - 1e-6);

const clock = (state: GameState): string => {
  const m = Math.round((state.now - T0) / MINUTE);
  return `t+${String((m / 60) | 0).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}m`;
};

function report(state: GameState, headline: string): string {
  return (
    `${headline} at ${clock(state)}\n` +
    `      builders free: ${buildersFree(state, state.now)}/${state.builders.owned}` +
    `${state.builders.tempUntil ? ' (+1 prestado)' : ''}\n` +
    `      store: ${JSON.stringify(state.store)} · gemas ${state.gems}\n` +
    `      buildings: ${state.buildings.map((b) => `${b.type} Nv${b.level}${b.work ? '*' : ''}`).join(', ')}\n` +
    `      chests: ${state.chests.map((c) => `${c.type ?? '—'}:${c.state}`).join(', ')}\n` +
    `      §4.8 resolver says: ${nextAction(state, state.now)}`
  );
}

/* --------------------------------------------------------------------------
 * the bot
 * ----------------------------------------------------------------------- */

/**
 * The first grid cell whose plot is clear.
 *
 * The sim knows nothing about terrain — buildable ground is generated per seed
 * in render/island.ts and is the ghost's business (§3.15). What is checked here
 * is the half the sim owns: two buildings may not share a plot.
 */
function freeSpot(state: GameState, type: string): { x: number; z: number } | null {
  for (let z = 4; z <= 22; z++) {
    for (let x = 4; x <= 22; x++) {
      if (spotRefusal(state, type, x, z) === null) return { x, z };
    }
  }
  return null;
}

const priceOf = (cost: Record<string, number | undefined>): number =>
  Object.values(cost).reduce<number>((sum, v) => sum + (v ?? 0), 0);

/**
 * "Always takes the best available action", repeated until nothing changes.
 *
 * The order is a real player's, and it is the GREEDIEST reading on purpose:
 * bank everything, then spend every builder down to zero. Spending hard is the
 * adversarial case — it is what empties the store, and an empty store with idle
 * builders is precisely the wall this file exists to find. A patient player who
 * saves for a target is strictly easier to satisfy.
 *
 * It does not spend gems. Gems buying time is a player's choice, not "the best
 * available action", and a bot that burned them to end its own timers would be
 * measuring self-sabotage rather than the design.
 */
function playGreedily(state: GameState, log: string[]): GameState {
  const now = state.now;
  const note = (what: string) => log.push(`${clock(state)} ${what}`);

  for (let pass = 0; pass < 40; pass++) {
    let acted = false;
    const take = <T extends { ok: boolean; state: GameState }>(result: T, what?: string): void => {
      if (!result.ok) return;
      state = result.state;
      acted = true;
      if (what) note(what);
    };

    // --- bank everything already earned -------------------------------------
    if (dailyAvailable(state, now)) take(claimDaily(state, now), 'recompensa diaria');

    const quest = state.quests.daily.findIndex(questComplete);
    if (quest >= 0) take(claimQuest(state, quest), `misión ${state.quests.daily[quest].id}`);

    const ready = state.chests.findIndex((c) => c.state === 'ready');
    if (ready >= 0) take(openChest(state, ready), `abre cofre ${state.chests[ready].type}`);

    if (state.freeChestsBanked > 0) take(claimFreeChest(state), 'cofre libre del muelle');

    for (const b of state.buildings) {
      if (isProducer(b) && b.stock >= 1) take(collect(state, b.id));
    }

    // --- keep the tray brewing (§4.5: only one at a time) -------------------
    if (!state.chests.some((c) => c.state === 'unlocking')) {
      const waiting = state.chests.findIndex((c) => c.state === 'waiting');
      if (waiting >= 0) take(startChest(state, waiting, now), `arranca cofre ${state.chests[waiting].type}`);
    }

    // --- spend the builders -------------------------------------------------
    // The Ayuntamiento first: it gates every count and every level ceiling, so
    // a greedy player who skips it walls themselves in within the hour.
    const hall = state.buildings.find((b) => b.type === 'ayuntamiento');
    if (hall && buildersFree(state, now) > 0 && upgradeRefusal(state, hall, now) === null) {
      take(startUpgrade(state, hall.id, now), `Ayuntamiento → Nv${hall.level + 1}`);
    }

    // Then a new building: another producer compounds, an upgrade does not.
    if (buildersFree(state, now) > 0) {
      const open = buildCatalog(state, now)
        .filter((e) => e.refusal === null)
        .sort((a, b) => priceOf(a.cost) - priceOf(b.cost))[0];
      const spot = open ? freeSpot(state, open.type) : null;
      if (open && spot) take(place(state, open.type, spot.x, spot.z, now), `coloca ${open.type}`);
    }

    // Then the lowest-level upgrade, so a builder is never idle for want of a
    // slightly better option it cannot afford.
    if (buildersFree(state, now) > 0) {
      const pick = state.buildings
        .filter((b) => upgradeRefusal(state, b, now) === null)
        .sort((a, b) => a.level - b.level)[0];
      if (pick) take(startUpgrade(state, pick.id, now), `${pick.type} → Nv${pick.level + 1}`);
    }

    if (!acted) break;
  }
  return state;
}

/** The instant something next completes, so no wall is stepped over. */
function nextCompletion(state: GameState, limit: number): number {
  let best = limit;
  const consider = (t: number) => { if (t > state.now && t < best) best = t; };
  for (const b of state.buildings) if (b.work) consider(b.work.endsAt);
  for (const c of state.chests) if (c.state === 'unlocking' && c.endsAt !== null) consider(c.endsAt);
  consider(state.freeChestAt);
  return best;
}

/* --------------------------------------------------------------------------
 * the run
 * ----------------------------------------------------------------------- */

/**
 * The measured budget for claim 2.
 *
 * 111 minutes is the worst stretch the greediest possible player can produce
 * across the seeds sampled below, and it happens deep in the second half of the
 * day, once the Ayuntamiento-3 ladder has been stripped bare. Two hours is that
 * ceiling with room to move; if a balance change pushes past it, the game has
 * started asking someone to sit and wait for an afternoon, and this fails.
 */
const INERT_BUDGET_MS = 2 * HOUR;

interface Run {
  /** Longest stretch with no timer running and none startable. */
  maxInertMs: number;
  inertAt: number;
  /** Longest stretch, on arrival, with no timer AND nothing to collect. */
  maxStrandedMs: number;
  strandedAt: number;
  actions: number;
  steps: number;
  end: GameState;
}

function playFirstDay(seed: string, hours = 24): Run {
  let state = createNewGame(seed, T0, TZ);
  const log: string[] = [];
  const until = T0 + hours * HOUR;

  let inert = 0, maxInertMs = 0, inertAt = 0;
  let stranded = 0, maxStrandedMs = 0, strandedAt = 0;
  let previous = state.now;
  let steps = 0;

  while (state.now < until) {
    const dt = state.now - previous;
    previous = state.now;

    // --- claim 1, on ARRIVAL: what the player finds on opening the app ------
    if (!runningTimer(state) && !collectable(state)) {
      stranded += dt;
      if (stranded > maxStrandedMs) { maxStrandedMs = stranded; strandedAt = state.now; }
      // The corpse RETENTION.md actually names: nothing building AND nothing
      // producing. There is no budget for this one — it fails on sight.
      ok(producing(state), report(state, 'the island is DEAD — nothing building, nothing producing'));
    } else {
      stranded = 0;
    }

    state = playGreedily(state, log);

    // --- claim 2, on DEPARTURE: could this session end with a timer? --------
    if (!runningTimer(state) && !startableTimer(state)) {
      inert += dt;
      if (inert > maxInertMs) { maxInertMs = inert; inertAt = state.now; }
    } else {
      inert = 0;
    }

    // Never step over a completion — the wall appears at the instant a timer
    // ends, and a coarse stride would walk straight past it.
    const target = Math.min(nextCompletion(state, until), state.now + MINUTE);
    state = tick(state, Math.max(target, state.now + 1000)).state;
    steps++;
  }

  return { maxInertMs, inertAt, maxStrandedMs, strandedAt, actions: log.length, steps, end: state };
}

const SEEDS = ['retencion', 'a', 'bahia', 'tortuga', 'xyz', 'la-leyenda', 'q7', 'zz', 'mm', 'kk'];

/** A simulated day costs about a second; the claims below read the same run. */
const runs = new Map<string, Run>();
const day = (seed: string): Run => {
  let run = runs.get(seed);
  if (!run) runs.set(seed, (run = playFirstDay(seed)));
  return run;
};

describe("RETENTION.md's one rule — a greedy 24h playthrough of a NEW GAME", () => {
  test('claim 1: the player never opens the app to no timer and nothing to collect', () => {
    for (const seed of SEEDS) {
      const run = day(seed);
      ok(run.steps > 1000, `${seed}: the day was actually simulated (${run.steps} steps)`);
      ok(
        run.maxStrandedMs === 0,
        `${seed}: stranded for ${Math.round(run.maxStrandedMs / MINUTE)}m ` +
        `(worst at t+${Math.round((run.strandedAt - T0) / MINUTE)}m)`
      );
    }
  });

  test('claim 2: a session can always end with a timer running, within the budget', () => {
    let worst = { seed: '', ms: 0, at: 0 };
    for (const seed of SEEDS) {
      const run = day(seed);
      if (run.maxInertMs > worst.ms) worst = { seed, ms: run.maxInertMs, at: run.inertAt };
      ok(
        run.maxInertMs <= INERT_BUDGET_MS,
        `${seed}: no timer running and none startable for ` +
        `${Math.round(run.maxInertMs / MINUTE)}m — the budget is ${INERT_BUDGET_MS / MINUTE}m`
      );
    }
    console.log(
      `      worst inert stretch: ${Math.round(worst.ms / MINUTE)}m on "${worst.seed}"` +
      ` at t+${Math.round((worst.at - T0) / HOUR)}h · budget ${INERT_BUDGET_MS / MINUTE}m`
    );
  });

  test('a day of greedy play really does move the island forward', () => {
    // Guards the guard. If the bot silently stopped acting — a refusal it never
    // noticed, a catalogue that went empty — both claims above would pass
    // against a game nobody can play, which is the exact bug they exist for.
    const run = day('retencion');
    ok(run.actions > 40, `${run.actions} deliberate actions in the day`);
    ok(run.end.buildings.length > 6, `the island grew to ${run.end.buildings.length} buildings`);
    ok(run.end.buildings[0].level >= 3, `the Ayuntamiento reached Nv${run.end.buildings[0].level}`);
    ok(run.end.stats.chestsOpened >= 2, `${run.end.stats.chestsOpened} chests opened`);
  });

  test('§4.8 never has to answer "none" during that day either', () => {
    // The same bug seen from the HUD's side: there is a hook to surface and the
    // resolver cannot find one.
    let state = createNewGame('resolver-24h', T0, TZ);
    const log: string[] = [];
    const until = T0 + DAY;
    while (state.now < until) {
      ok(nextAction(state, state.now) !== 'none', report(state, 'the resolver ran dry on arrival'));
      state = playGreedily(state, log);
      ok(nextAction(state, state.now) !== 'none', report(state, 'the resolver ran dry after playing'));
      const target = Math.min(nextCompletion(state, until), state.now + MINUTE);
      state = tick(state, Math.max(target, state.now + 1000)).state;
    }
  });

  test('a player who only ever collects — never builds — is still not stranded', () => {
    // The lazy opposite of the greedy bot, and most real sessions. Someone who
    // taps bubbles and nothing else must still find the island alive.
    let state = createNewGame('perezoso', T0, TZ);
    const until = T0 + DAY;
    while (state.now < until) {
      for (const b of state.buildings) {
        if (isProducer(b) && b.stock >= 1) state = collect(state, b.id).state;
      }
      ok(
        runningTimer(state) !== null || collectable(state) !== null || producing(state),
        report(state, 'a player who only collects found a dead island')
      );
      state = tick(state, state.now + 5 * MINUTE).state;
    }
  });
});

describe('§4.10 the fresh island IS the beat sheet', () => {
  const fresh = () => createNewGame('beats', T0, TZ);

  test('reason 1 — the Ayuntamiento is upgrading, 8m 12s left', () => {
    const hall = fresh().buildings.find((b) => b.type === 'ayuntamiento')!;
    ok(hall.work !== null, 'a job is running on it');
    eq(hall.work!.toLevel, 2, 'Nv1 → Nv2');
    eq(hall.work!.endsAt - T0, 8 * MINUTE + 12_000, '8m 12s remaining, as §4.10 prints it');
  });

  test('reason 2 — the Muelle is standing and its Cofre Libre clock is ticking', () => {
    const state = fresh();
    const dock = state.buildings.find((b) => b.type === 'muelle');
    ok(dock !== undefined && dock.level >= 1, 'built, not a plot');
    eq(state.freeChestAt - T0, BALANCE.chests.freeChest.everyMs, 'the 4h cadence started');
  });

  test('reason 3 — the Aserradero bubble is at 35% and rising', () => {
    const state = fresh();
    const saw = state.buildings.find((b) => b.type === 'aserradero')!;
    eq(saw.stock, Math.round((BALANCE.buildings.aserradero.levels[0].capacity ?? 0) * 0.35), 'a third up');
    ok(saw.stock >= 1, 'so frame 1 has a bubble on it');
    ok(
      tick(state, T0 + MINUTE).state.buildings.find((b) => b.type === 'aserradero')!.stock > saw.stock,
      'and it is visibly rising'
    );
  });

  test('reason 4 / beat 1:32 — a chest is brewing, pre-aged to cost exactly 1 gem', () => {
    const state = fresh();
    eq(state.gems, 5, 'the five starting gems');
    const slot = state.chests.findIndex((c) => c.state === 'unlocking');
    ok(slot >= 0, 'one chest is unlocking');
    // §4.4's golden rule: the last five minutes of ANY timer cost exactly one.
    eq(skipCost(state, slot, T0), 1, '"Abrir ahora" is one of those five gems');
    eq(skipChest(state, slot, T0).state.gems, 4, 'and paying it really does leave four');
  });

  test('reason 5 — the daily chain is unclaimed, sitting on day 1', () => {
    const state = fresh();
    ok(dailyAvailable(state, T0), 'claimable right now');
    eq(state.daily.day, 1, 'at the top of the seven');
  });

  test('beat 2:25 — the 24h carpintero is on loan, and it is the free one', () => {
    const state = fresh();
    eq(state.builders.owned, BALANCE.builders.start, 'two permanent');
    eq(state.builders.tempUntil, T0 + BALANCE.builders.tempBuilderMs, 'plus a 24h loan');
    eq(buildersFree(state, T0), 1, 'two are busy, so the loaned one is what blinks');
    eq(nextAction(state, T0), 'construir', 'and §4.8 rule 1 fires on the first frame');
  });

  test('the gifted carpenter has an affordable job the moment it arrives', () => {
    // A third builder with nothing it can pay for is a gift that mocks the
    // player, and that is exactly what the old fresh save became five minutes
    // in: one 5m timer, then a wall.
    const state = fresh();
    const startable = startableTimer(state);
    ok(startable !== null, 'something can be started right now');
    console.log(`      the loaned carpenter's job on arrival: ${startable}`);
  });

  test('no two buildings on the shipped island share a plot', () => {
    const state = fresh();
    for (const b of state.buildings) {
      const others = { ...state, buildings: state.buildings.filter((x) => x.id !== b.id) };
      eq(spotRefusal(others, b.type, b.x, b.z), null, `${b.type} at ${b.x},${b.z} stands clear`);
    }
  });

  test('and the fresh island is what the game boots into, not a demo fixture', () => {
    // The regression this whole slice exists to close: createDemoIsland was the
    // default because a fresh save could not be played.
    const state = fresh();
    eq(state.buildings.filter((b) => b.type === 'ayuntamiento')[0].level, 1, 'Ayuntamiento Nv1');
    ok(state.buildings.length === 6, 'six buildings, not a mid-game island');
    ok(state.flags.tutorialDone === true, '§4.10 is marked walked, so a guide layer knows');
  });
});
