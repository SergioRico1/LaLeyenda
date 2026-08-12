import {
  BALANCE, DAY, HOUR, MINUTE, buildersFree, buildCatalog, claimDaily, claimFreeChest, claimQuest,
  clearObstacle, collect, createNewGame, dailyAvailable, isProducer, nextAction, openChest, place,
  placeRefusal, producerCapacity, questComplete, spotRefusal, spotRefusalNow, startChest,
  startUpgrade, storeCap, tick, upgradeRefusal,
  type GameState,
} from '../../src/sim';
import { generateIsland, isBuildable } from '../../src/render/island';
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
 * ─── what OPENING.md changed here ──────────────────────────────────────────
 *
 * The opening is now the Ayuntamiento and NOTHING ELSE: no producer, no store,
 * no dock, no timer, 250 madera against a 300-madera Aserradero. Every claim
 * below got harder, and one of them got a new answer.
 *
 * The old corpse test was `producing()` — some producer is below its cap. On a
 * day-one island that is false at t = 0 by construction, and it is *not* a
 * corpse: two carpenters are standing free on an island covered in palms, which
 * is the most alive an opening can be. So the corpse test is now **producing OR
 * startable** — nothing running, nothing to collect, and nothing the player
 * could set going with a free builder. That is strictly the same verdict as
 * before everywhere the old island reached, and the right one where it did not.
 * The stranded STRETCH is still budgeted at zero and still asserted.
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
 * the island the bot actually stands on
 * ----------------------------------------------------------------------- */

/**
 * The real terrain, at the real size.
 *
 * The sim owns no heightmap, so the old bot scanned a hard-coded 4..22 box and
 * never asked whether the ground existed. That was survivable when the island
 * was 26 cells and pre-populated; it is not now, because reference/SPACING.md's
 * third change is *size the island against what it must hold* and the only
 * honest way to check that is to make the bot build on the ground the renderer
 * generates. So the plateau comes from `generateIsland` at `island.grid`, and
 * every placement below has to fit on it WITH the clearance rule applied.
 */
const GRID = BALANCE.island.grid;
const shapes = new Map<string, ReturnType<typeof generateIsland>>();
const plateau = (seed: string) => {
  let shape = shapes.get(seed);
  if (!shape) shapes.set(seed, (shape = generateIsland(seed, GRID)));
  return shape;
};

/** Does a whole footprint sit on the plateau? The ghost's half of validity. */
function fitsOnLand(seed: string, type: string, x: number, z: number): boolean {
  const shape = plateau(seed);
  const half = BALANCE.buildings[type].footprint * BALANCE.placement.plotFactor / 2;
  const reach = Math.floor(half - 0.001);
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (!isBuildable(shape, x + dx, z + dz)) return false;
    }
  }
  return true;
}

/* --------------------------------------------------------------------------
 * the three predicates
 * ----------------------------------------------------------------------- */

/** Something is being built, cleared, upgraded, or brewed — a dated reason to
 *  return. Clearing an obstacle is a timer like any other, and on day one it is
 *  the ONLY timer the player can afford. */
function runningTimer(state: GameState): string | null {
  for (const b of state.buildings) if (b.work) return `${b.type}→Nv${b.work.toLevel}`;
  for (const o of state.obstacles) if (o.work) return `despejando ${o.kind}`;
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
 * this test every morning. An uncleared obstacle is not counted either: it is a
 * reason to spend a builder, not a reward waiting to be taken.
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
  if (open) return `colocar ${open.type}`;
  // OPENING.md's floor, and the reason day one is playable at all: an obstacle
  // costs nothing, so a free builder ALWAYS has a job while the wilderness
  // lasts. It is last because it is the fallback, not the ambition.
  const standing = state.obstacles.find((o) => !o.work);
  return standing ? `despejar ${standing.kind}` : null;
}

/** RETENTION.md's literal corpse: "nada construyéndose, nada produciendo" —
 *  widened by OPENING.md, see the header. */
const alive = (state: GameState): boolean =>
  state.buildings.some((b) => isProducer(b) && b.stock < producerCapacity(b) - 1e-6)
  || startableTimer(state) !== null;

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
    `      obstáculos: ${state.obstacles.length} en pie, ${state.obstacles.filter((o) => o.work).length} en obras\n` +
    `      chests: ${state.chests.map((c) => `${c.type ?? '—'}:${c.state}`).join(', ')}\n` +
    `      §4.8 resolver says: ${nextAction(state, state.now)}`
  );
}

/* --------------------------------------------------------------------------
 * the bot
 * ----------------------------------------------------------------------- */

/**
 * The first grid cell a building may legally stand on — terrain, plots,
 * CLEARANCE and uncleared ground all included.
 *
 * `spotRefusalNow` rather than `spotRefusal`, so the bot has to route around
 * the palm it has not cut down yet exactly as a player's finger does.
 */
function freeSpot(state: GameState, seed: string, type: string): { x: number; z: number } | null {
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) {
      if (!fitsOnLand(seed, type, x, z)) continue;
      if (spotRefusalNow(state, type, x, z) === null) return { x, z };
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
 * Clearing is LAST, and that ordering is the whole point of putting it in the
 * bot at all: a carpenter only goes into the trees when it has nothing better
 * to do, so the wilderness is spent exactly as fast as the economy stalls. Put
 * it first and the island is strip-mined inside half an hour and the test stops
 * measuring the design.
 *
 * It does not spend gems. Gems buying time is a player's choice, not "the best
 * available action", and a bot that burned them to end its own timers would be
 * measuring self-sabotage rather than the design.
 */
function playGreedily(state: GameState, seed: string, log: string[]): GameState {
  const now = state.now;
  const note = (what: string) => log.push(`${clock(state)} ${what}`);

  for (let pass = 0; pass < 60; pass++) {
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
      for (const open of buildCatalog(state, now)
        .filter((e) => e.refusal === null)
        .sort((a, b) => priceOf(a.cost) - priceOf(b.cost))) {
        const spot = freeSpot(state, seed, open.type);
        if (!spot) continue;
        take(place(state, open.type, spot.x, spot.z, now), `coloca ${open.type}`);
        break;
      }
    }

    // Then the lowest-level upgrade, so a builder is never idle for want of a
    // slightly better option it cannot afford.
    if (buildersFree(state, now) > 0) {
      const pick = state.buildings
        .filter((b) => upgradeRefusal(state, b, now) === null)
        .sort((a, b) => a.level - b.level)[0];
      if (pick) take(startUpgrade(state, pick.id, now), `${pick.type} → Nv${pick.level + 1}`);
    }

    // And last, the trees. A builder with nothing it can afford still has this.
    while (buildersFree(state, now) > 0) {
      const next = state.obstacles.find((o) => !o.work);
      if (!next) break;
      const before = state.obstacles.filter((o) => o.work).length;
      take(clearObstacle(state, next.id, now), `despeja ${next.kind}`);
      if (state.obstacles.filter((o) => o.work).length === before) break;
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
  for (const o of state.obstacles) if (o.work) consider(o.work.endsAt);
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
 * Two hours was the ceiling under the old opening, measured off the worst seed
 * once the Ayuntamiento-3 ladder had been stripped bare. It is kept exactly
 * where it was: the opening got poorer, not the afternoon, and moving a budget
 * to accommodate a change is how a budget stops meaning anything.
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
  /** Obstacles the day actually consumed, and what is left standing. */
  cleared: number;
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
      // The corpse RETENTION.md actually names. There is no budget for this
      // one — it fails on sight.
      ok(alive(state), report(state, 'the island is DEAD — nothing running, nothing to start'));
    } else {
      stranded = 0;
    }

    state = playGreedily(state, seed, log);

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

  return {
    maxInertMs, inertAt, maxStrandedMs, strandedAt,
    actions: log.length, steps, end: state, cleared: state.stats.obstacles,
  };
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
    console.log(
      `      day one: ${run.end.buildings.length} buildings, Ayto Nv${run.end.buildings[0].level},` +
      ` ${run.cleared} obstáculos despejados, ${run.end.obstacles.length} en pie`
    );
  });

  test('the first day is BUILT, not found — every building on it was placed', () => {
    // The sentence OPENING.md opens with, as an assertion: "Everything on the
    // island after that, they built." A regression that quietly re-seeded the
    // opening would pass every other test in this file.
    const fresh = createNewGame('retencion', T0, TZ);
    eq(fresh.buildings.length, 1, 'a new game is one building');
    const run = day('retencion');
    ok(run.end.buildings.length - 1 >= 5, `and the player placed ${run.end.buildings.length - 1} more`);
  });

  test('§4.8 never has to answer "none" during that day either', () => {
    // The same bug seen from the HUD's side: there is a hook to surface and the
    // resolver cannot find one.
    let state = createNewGame('resolver-24h', T0, TZ);
    const log: string[] = [];
    const until = T0 + DAY;
    while (state.now < until) {
      ok(nextAction(state, state.now) !== 'none', report(state, 'the resolver ran dry on arrival'));
      state = playGreedily(state, 'resolver-24h', log);
      ok(nextAction(state, state.now) !== 'none', report(state, 'the resolver ran dry after playing'));
      const target = Math.min(nextCompletion(state, until), state.now + MINUTE);
      state = tick(state, Math.max(target, state.now + 1000)).state;
    }
  });

  test('a player who only clears and collects — never plans — is still not stranded', () => {
    // The lazy opposite of the greedy bot, and most real sessions. Someone who
    // taps what the island offers and nothing else must still find it alive.
    //
    // On the old island "what the island offers" was bubbles only. On this one
    // the tutorial's single instruction — clear that palm, then put an
    // Aserradero on the ground it freed — is part of the offer, so the bot
    // takes the ONE cheapest thing it can afford whenever a carpenter is idle
    // and otherwise just taps. Anything less than that is not a lazy player, it
    // is a player who never started.
    const seed = 'perezoso';
    let state = createNewGame(seed, T0, TZ);
    const until = T0 + DAY;
    while (state.now < until) {
      for (const b of state.buildings) {
        if (isProducer(b) && b.stock >= 1) state = collect(state, b.id).state;
      }
      const ready = state.chests.findIndex((c) => c.state === 'ready');
      if (ready >= 0) state = openChest(state, ready).state;

      while (buildersFree(state, state.now) > 0) {
        const cheapest = buildCatalog(state, state.now)
          .filter((e) => e.refusal === null)
          .sort((a, b) => priceOf(a.cost) - priceOf(b.cost))[0];
        const spot = cheapest ? freeSpot(state, seed, cheapest.type) : null;
        const built = cheapest && spot ? place(state, cheapest.type, spot.x, spot.z, state.now) : null;
        if (built?.ok) { state = built.state; continue; }

        const tree = state.obstacles.find((o) => !o.work);
        const cut = tree ? clearObstacle(state, tree.id, state.now) : null;
        if (!cut?.ok) break;
        state = cut.state;
      }

      ok(
        runningTimer(state) !== null || collectable(state) !== null || alive(state),
        report(state, 'a player who only taps found a dead island')
      );
      state = tick(state, state.now + 5 * MINUTE).state;
    }
  });
});

describe('OPENING.md — day one is the Ayuntamiento and nothing else', () => {
  const fresh = (seed = 'beats') => createNewGame(seed, T0, TZ);

  test('one building, and it is the hall, standing in the middle of the island', () => {
    const state = fresh();
    eq(state.buildings.length, 1, 'exactly one');
    const hall = state.buildings[0];
    eq(hall.type, 'ayuntamiento', 'the Ayuntamiento');
    eq(hall.level, 1, 'at Nv1');
    eq(hall.work, null, 'and idle — the first timer is the player`s to start');
    const centre = Math.round((BALANCE.island.grid - 1) / 2);
    eq(hall.x, centre, 'on the centre column of the fixed 44 grid');
    eq(hall.z, centre, 'and its centre row');
  });

  test('both carpenters are free, so §4.8 rule 1 fires on the first frame', () => {
    const state = fresh();
    eq(state.builders.owned, BALANCE.builders.start, 'two permanent');
    eq(state.builders.tempUntil, null, 'and no 24h loan — that beat paid for a builder wall this opening does not have');
    eq(buildersFree(state, T0), 2, 'both idle');
    eq(nextAction(state, T0), 'construir', 'and the HUD says so');
  });

  test('the tray is empty and the Cofre Libre clock does not run without a Muelle', () => {
    const state = fresh();
    ok(!state.chests.some((c) => c.type), 'nothing brewing, nothing found');
    ok(!state.buildings.some((b) => b.type === 'muelle'), 'the harbour is something to build');
    const away = tick(state, T0 + 12 * HOUR).state;
    eq(away.freeChestsBanked, 0, 'twelve hours with no dock banks no dock chests');
  });

  test('the hall holds resources, or a one-building island could hold none', () => {
    // The wall this replaced: `storeCap` sums store BUILDINGS, so an island with
    // only an Ayuntamiento had a capacity of zero, and every obstacle payout,
    // daily and chest landed as nothing at all.
    const state = fresh();
    ok(storeCap(state, 'madera') > 0, `the hall banks ${storeCap(state, 'madera')} madera`);
    ok(storeCap(state, 'oro') > 0, `and ${storeCap(state, 'oro')} oro`);
    // Ron and metal used to be exactly zero here, on the rule that they must
    // earn their store. Round 17 gave the hall a TASTE of each, because the sea
    // pays both in ring 1 and a first voyage was spilling its ron against a cap
    // of nothing — for a currency the HUD had never even drawn. The rule
    // survives as the thing it was actually protecting: a store is what you
    // build when you want any REAL quantity, and the hall is nowhere near one.
    ok(storeCap(state, 'ron') > 0, `the hall keeps a taste of ron (${storeCap(state, 'ron')})`);
    ok(storeCap(state, 'metal') > 0, `and of metal (${storeCap(state, 'metal')})`);
    for (const res of ['ron', 'metal'] as const) {
      ok(
        storeCap(state, res) < storeCap(state, 'madera') / 4,
        `${res} is a taste beside what the hall really banks, not a supply`
      );
    }
  });

  test('the opening is 50 madera short of an Aserradero, and one palm covers it', () => {
    // The tutorial's whole first instruction, as arithmetic: clear that palm,
    // then put your Aserradero on the ground it freed. Being handed enough
    // would make the first clear optional, and an optional beat is one nobody
    // performs; being handed too little would make it a grind.
    const state = fresh();
    const cost = BALANCE.buildings.aserradero.levels[0].cost.madera ?? 0;
    ok(state.store.madera < cost, `${state.store.madera} against ${cost} — short on purpose`);
    eq(placeRefusal(state, 'aserradero', T0), 'not-enough-resources', 'and the picker says which key is missing');
    const cheapest = BALANCE.obstacles.small.madera[0];
    ok(state.store.madera + cheapest >= cost, `the smallest payout (${cheapest}) always closes it`);
  });

  test('one clear really does buy the first Aserradero, end to end', () => {
    let state = fresh();
    const tree = state.obstacles.find((o) => o.tier === 'small')!;
    const started = clearObstacle(state, tree.id, T0);
    ok(started.ok, 'a free carpenter takes the job');
    state = tick(started.state, T0 + BALANCE.obstacles.small.timeMs).state;
    ok(!state.obstacles.some((o) => o.id === tree.id), 'the palm is gone');
    eq(state.stats.obstacles, 1, 'and the Diario counted it');
    eq(placeRefusal(state, 'aserradero', state.now), null, 'the Aserradero is now affordable');
  });

  test('the daily chain is unclaimed, sitting on day 1', () => {
    const state = fresh();
    ok(dailyAvailable(state, T0), 'claimable right now');
    eq(state.daily.day, 1, 'at the top of the seven');
  });

  test('the five gems are there, and the tutorial has NOT been pre-walked', () => {
    const state = fresh();
    eq(state.gems, 5, '§4.4 golden-rule money');
    ok(!state.flags.tutorialDone, 'the tutorial finally has a job, so it runs');
    eq(state.stats.collects, 0, 'and nothing has been done on the player`s behalf');
  });

  test('the hall stands clear of its own island', () => {
    const state = fresh();
    for (const b of state.buildings) {
      const others = { ...state, buildings: state.buildings.filter((x) => x.id !== b.id) };
      eq(spotRefusal(others, b.type, b.x, b.z), null, `${b.type} at ${b.x},${b.z} stands clear`);
    }
    ok(!state.obstacles.some((o) => Math.abs(o.x - state.buildings[0].x) < 2 && Math.abs(o.z - state.buildings[0].z) < 2),
      'and nothing is growing through its roof');
  });
});
