import {
  BALANCE, MINUTE, chestTrayHint, claimQuest, clearNowCost, clearObstacle, createDemoIsland,
  finishClearNow, gemSpeedupCost, landCargoInPlace, markLandingSeen, nextAction, previewLanding,
  spilledStoreNeeded, storeCap, tick,
  type GameState,
} from '../../src/sim';
import { season } from '../../src/sim/rivals';
import { describe, test, ok, eq, deepEq } from './harness';
import { T0, TZ, game, quiet } from './fixtures';

/**
 * playtest.test.ts — round 11's playtest, each finding pinned by a test.
 *
 * The playtester walked the whole cold path in a real browser and four things
 * came back broken: cargo evaporating in silence (finding 1), the chest tap
 * answering nonsense on day one (2), clear jobs with no visible state (3), and
 * a Diario that claimed rewards without ever showing the quest list (5). Every
 * case here is the headless half of one of those — the mechanism the UI now
 * stands on, asserted where a regression would put the bug back.
 */

/* --------------------------------------------------------------------------
 * finding 1 — "landing manifest said Ron 180 · Metal 99 … the save ledger
 * reads ron:0, metal:0". A player must never watch loot evaporate in silence.
 *
 * ROUND 17 MOVED THE PREMISE AND LEFT EVERY CLAIM STANDING, so it is worth
 * being exact about what changed. Round 11's fix was to make the loss LEGIBLE —
 * a landing report in the save, a toast that names what spilled, a resolver
 * that points at the missing store — and it was the right fix for what the
 * playtester saw. What it did not touch was the reason the loss happened: a
 * day-one hall could hold ZERO ron and zero metal, while every kind of site in
 * ring 1 pays one or the other.
 *
 * The deciding fact came from these very cases. Two of them below say that on
 * day one the Bodega is locked behind Ayuntamiento 2 and `spilledStoreNeeded`
 * therefore returns null — so a brand-new player was told they had lost 180 ron
 * and the game could not name the remedy. A legible loss you can act on is a
 * lesson; a legible loss you cannot act on is a punishment for playing the way
 * the game told you to.
 *
 * So the hall now keeps a TASTE of each (`townHall.baseStorage`, 150), and the
 * amounts below are raised past it. Every mechanism round 11 built is still
 * exercised, at the moment it is actually useful: when the player is carrying
 * real quantities and the Bodega is a thing they can go and build.
 * ----------------------------------------------------------------------- */

describe('playtest 1 · the landing report', () => {
  test('REPRO: a day-one island spills what will not fit in the hall', () => {
    const state = game();
    const ronCap = storeCap(state, 'ron');
    const metalCap = storeCap(state, 'metal');
    ok(ronCap > 0, `no Bodega, but the hall keeps a taste of ron (${ronCap})`);
    ok(ronCap < 400, 'a taste and not a supply — the Bodega is still the answer');

    const { landed, spilled } = landCargoInPlace(state, { ron: 400, metal: 300, oro: 40 });
    eq(landed.oro, 40, 'the oro fits in the hall strongroom');
    eq(landed.ron, ronCap, 'the ron fills the strongroom exactly');
    eq(spilled.ron, 400 - ronCap, 'and the rest is reported spilled');
    eq(spilled.metal, 300 - metalCap, 'the metal too');
    eq(state.store.ron, ronCap, 'the ledger honestly holds what it holds');
  });

  test('the landing is WRITTEN INTO THE SAVE, spill and all, so a later boot can say it', () => {
    const state = game();
    const ronCap = storeCap(state, 'ron');
    const metalCap = storeCap(state, 'metal');
    landCargoInPlace(state, { ron: 400, metal: 300, oro: 40 });

    ok(state.landing, 'the landing report exists on the state');
    deepEq(state.landing!.landed, { oro: 40, ron: ronCap, metal: metalCap }, 'what landed is recorded');
    deepEq(
      state.landing!.spilled, { ron: 400 - ronCap, metal: 300 - metalCap },
      'what spilled is recorded'
    );
    eq(state.landing!.seen, false, 'and nobody has been told yet');
  });

  /**
   * The case the owner was actually looking at, and the one round 11 could not
   * have written because the sea was not a first-session activity yet.
   */
  test('a FIRST VOYAGE is not a lesson in loss: everything it can carry lands', () => {
    const state = game();
    // An islet and a wreck, which is exactly what ring 1 has to offer.
    const { landed, spilled } = landCargoInPlace(state, { madera: 45, ron: 38, oro: 35 });
    eq(landed.ron, 38, 'every drop of the first voyage\'s ron reached the island');
    deepEq(spilled, {}, 'and nothing at all went over the side');
    ok(state.store.ron > 0, 'the ledger says so, which is what puts it on the HUD');
  });

  test('a clean landing still reports what landed — the arrival toast is always true', () => {
    const state = quiet();                       // Almacén standing, cap 2 000
    landCargoInPlace(state, { madera: 120 });
    deepEq(state.landing!.landed, { madera: 120 }, 'the full hold banked');
    deepEq(state.landing!.spilled, {}, 'nothing spilled');
    eq(spilledStoreNeeded(state), null, 'and no store is being asked for');
  });

  test('an empty hold leaves no report — arriving with nothing is not an event', () => {
    const state = game();
    landCargoInPlace(state, {});
    eq(state.landing ?? null, null, 'no report for an empty hold');
  });

  test('markLandingSeen stops the repeat without forgetting the loss', () => {
    const state = game();
    const over = 400 - storeCap(state, 'ron');
    landCargoInPlace(state, { ron: 400 });
    const result = markLandingSeen(state);
    ok(result.ok, 'acknowledging is never refused');
    eq(result.state.landing!.seen, true, 'seen travels in the save');
    deepEq(result.state.landing!.spilled, { ron: over }, 'the loss itself is kept');
  });

  test('the resolver points a spill at the missing store once it is buildable', () => {
    const state = game();
    state.buildings[0].level = 2;                // Ayuntamiento 2: Bodega reachable
    landCargoInPlace(state, { ron: 400 });
    eq(spilledStoreNeeded(state), 'ron', 'the ron store is the named gap');
    eq(nextAction(state, T0), 'almacen', 'and the resolver says: build it');
  });

  test('on day one the Bodega is locked behind the hall, so the cue stays construir', () => {
    const state = game();                        // Ayuntamiento 1
    landCargoInPlace(state, { ron: 400 });
    eq(spilledStoreNeeded(state), null, 'a store the hall does not allow is not pointed at');
    eq(nextAction(state, T0), 'construir', 'the generic build cue still leads the way');
  });

  test('placing the missing store retires the cue, even while it is still building', () => {
    const state = game();
    state.buildings[0].level = 2;
    landCargoInPlace(state, { ron: 400 });
    state.buildings.push({
      id: 99, type: 'bodega', x: 30, z: 30, level: 0, stock: 0,
      work: { kind: 'build', toLevel: 1, startedAt: T0, endsAt: T0 + MINUTE },
    });
    eq(spilledStoreNeeded(state), null, 'a Bodega on the ground answers the spill');
    eq(nextAction(state, T0), 'construir', 'the cue falls back to the ordinary ladder');
  });

  test('previewLanding agrees with the landing and touches nothing', () => {
    const state = game();
    const before = JSON.stringify(state);
    const preview = previewLanding(state, { ron: 400, metal: 300, oro: 40 });
    eq(JSON.stringify(state), before, 'a preview mutates nothing');
    const real = landCargoInPlace(structuredClone(state), { ron: 400, metal: 300, oro: 40 });
    deepEq(preview, { landed: real.landed, spilled: real.spilled },
      'the card the sea could print and the landing that follows are one arithmetic');
  });

  test('the next landing replaces the report — one voyage, one truth', () => {
    const state = quiet();
    landCargoInPlace(state, { ron: 50 });
    landCargoInPlace(state, { madera: 80 });
    deepEq(state.landing!.landed, { madera: 80 }, 'the new arrival is the report');
    deepEq(state.landing!.spilled, {}, 'the old spill does not leak into the new report');
  });
});

/* --------------------------------------------------------------------------
 * finding 2 — the chest tap on a day-one save: "no tray opens, just a
 * mis-worded toast 'Solo un cofre a la vez' over zero chests."
 * ----------------------------------------------------------------------- */

describe('playtest 2 · the chest tray answers honestly', () => {
  test('day one, no Muelle: the answer is the harbour, not "one chest at a time"', () => {
    const hint = chestTrayHint(game(), T0);
    eq(hint.kind, 'build-dock', 'zero chests and no dock names the building');
  });

  test('a standing Muelle promises the Cofre Libre, with the wait named', () => {
    const state = quiet();                       // the fixture has a Muelle
    const hint = chestTrayHint(state, T0);
    eq(hint.kind, 'come-later', 'zero chests but a dock: the next one is coming');
    if (hint.kind === 'come-later') {
      eq(hint.inMs, BALANCE.chests.freeChest.everyMs, 'and the toast can say when');
    }
  });

  test('a ready chest outranks everything: the tap opens it', () => {
    const state = quiet();
    state.chests[1] = { type: 'plata', state: 'ready', endsAt: null, totalMs: 0 };
    deepEq(chestTrayHint(state, T0), { kind: 'open', slot: 1 }, 'the ready slot is the tap');
  });

  test('a banked Cofre Libre is claimed before anything is started', () => {
    const state = quiet();
    state.freeChestsBanked = 1;
    state.chests[0] = { type: 'bronce', state: 'waiting', endsAt: null, totalMs: 1 };
    eq(chestTrayHint(state, T0).kind, 'claim-free', 'the banked chest comes off the dock first');
  });

  test('a waiting chest with the bench free is started', () => {
    const state = quiet();
    state.chests[2] = { type: 'bronce', state: 'waiting', endsAt: null, totalMs: 1 };
    deepEq(chestTrayHint(state, T0), { kind: 'start', slot: 2 }, 'the waiting chest starts');
  });

  test('waiting behind an unlocking chest reads the clock, not a refusal', () => {
    const state = quiet();
    state.chests[0] = { type: 'oro', state: 'unlocking', endsAt: T0 + 47 * MINUTE, totalMs: 1 };
    state.chests[1] = { type: 'bronce', state: 'waiting', endsAt: null, totalMs: 1 };
    const hint = chestTrayHint(state, T0);
    eq(hint.kind, 'unlocking', 'the truthful answer is the running timer');
    if (hint.kind === 'unlocking') eq(hint.remainingMs, 47 * MINUTE, 'with its remaining time');
  });

  /* --- round 13: the tap now OPENS the tray, and the tray makes claims -----
   *
   * The resolver was right and the answer never appeared — every branch was a
   * toast, and the playtest recorded "tapped 3x on day one: no panel, no
   * toast, no empty state". The tray is a sheet now, and a sheet has room to
   * say where chests come from, which is a promise the game has to keep. The
   * line it replaced did not: "los traen el mar y el Muelle, uno al día" was
   * wrong about the sea and wrong about the cadence. These pin the sources the
   * empty state actually names.
   */
  test('the empty tray promises the Muelle, and the Muelle delivers on that clock', () => {
    const state = quiet();                       // the fixture has a Muelle
    eq(chestTrayHint(state, T0).kind, 'come-later', 'the dock stands, so one is coming');
    const later = tick(state, T0 + BALANCE.chests.freeChest.everyMs).state;
    eq(later.freeChestsBanked, 1, 'and it arrives exactly when the sheet said');
    eq(chestTrayHint(later, later.now).kind, 'claim-free', 'with the tray offering to take it');
  });

  test('the sea does not post chests — the empty state must not say it does', () => {
    // The old toast sent a chestless player out to sea for chests. Nothing in
    // the landing path awards one, so the tray names the Muelle and the Diario
    // and nothing else; this is what stops that line coming back.
    const state = game();
    eq(chestTrayHint(state, T0).kind, 'build-dock', 'day one, no dock: the answer is the dock');
    const before = JSON.stringify(state.chests);
    landCargoInPlace(state, { oro: 400, madera: 400, ron: 120, metal: 90 });
    eq(JSON.stringify(state.chests), before, 'a whole hold landed and the tray is untouched');
    eq(state.freeChestsBanked, 0, 'and nothing was banked at a dock that does not exist');
    eq(chestTrayHint(state, T0).kind, 'build-dock', 'so the honest answer has not changed');
  });

  test('the Diario really is the other source the empty state names', () => {
    // The sheet prints the days of the chain that carry a chest and the corona
    // price of the Cofre de la Corona. Both come out of balance.json, and both
    // have to exist or the empty state is selling a door with nothing behind it.
    const days = BALANCE.daily.days.filter((d) => d.chest).map((d) => d.day);
    ok(days.length > 0, `the seven-day chain carries chests (days ${days.join(', ')})`);
    ok(BALANCE.chests.crownChest.at > 0, 'and the corona chest has a price to name');
    ok(
      BALANCE.chests.types[BALANCE.chests.crownChest.type] !== undefined,
      'which is a chest type that exists'
    );
    eq(
      BALANCE.chests.freeChest.building, 'muelle',
      'and the building the empty state sends the player to build is the one that pays'
    );
  });
});

/* --------------------------------------------------------------------------
 * finding 3 — clear jobs: "no timer capsule, no world item, no way to inspect
 * or rush — it reads as a soft-lock." The sim half: rushable at the same
 * price curve a construction pays.
 * ----------------------------------------------------------------------- */

describe('playtest 3 · a clear job is inspectable and rushable', () => {
  const withLargeClear = (): { state: GameState; id: number } => {
    const state = game();
    state.gems = 100;
    const target = state.obstacles.find((o) => o.tier === 'large');
    ok(target, 'the seeded island holds at least one pecio or peñasco');
    const result = clearObstacle(state, target!.id, T0);
    ok(result.ok, 'a carpenter takes the job');
    return { state: result.state, id: target!.id };
  };

  test('clearNowCost prices the clear on the SAME curve as a build', () => {
    const { state, id } = withLargeClear();
    const later = T0 + 4 * MINUTE;
    const remaining = BALANCE.obstacles.large.timeMs - 4 * MINUTE;
    eq(clearNowCost(state, id, later), gemSpeedupCost(remaining), 'one ladder for every timer');
  });

  test('the golden rule holds: under five minutes a clear costs exactly 1 gem', () => {
    const state = game();
    state.gems = 5;
    const palm = state.obstacles.find((o) => o.tier === 'small')!;
    const { state: cleared } = clearObstacle(state, palm.id, T0);
    eq(clearNowCost(cleared, palm.id, T0), 1, 'a 30s palm is inside the golden five minutes');
  });

  test('finishClearNow pays the gems, fells the obstacle and lands the madera', () => {
    const { state, id } = withLargeClear();
    const before = state.obstacles.find((o) => o.id === id)!;
    const madera0 = state.store.madera;
    const cost = clearNowCost(state, id, T0)!;

    const result = finishClearNow(state, id, T0);
    ok(result.ok, 'the rush is accepted');
    eq(result.gems, cost, 'the price charged is the one quoted');
    // The clear's own rolled gem payout still lands: rushing buys time, never
    // eats the reward.
    eq(result.state.gems, 100 - cost + before.pays.gems, 'the gems left the purse');
    ok(!result.state.obstacles.some((o) => o.id === id), 'the obstacle is off the island');
    eq(result.state.store.madera, madera0 + before.pays.madera, 'the payout landed in the store');
    ok(result.events.some((e) => e.type === 'obstacle-cleared'), 'and the event says so');
    eq(result.state.stats.obstacles, 1, 'the Despeja-N quest counter ticks');
  });

  test('refusals: an idle obstacle is not-ready, an empty purse is not-enough-gems', () => {
    const state = game();
    const idle = state.obstacles[0];
    eq(finishClearNow(state, idle.id, T0).refusal, 'not-ready', 'nothing to rush');
    eq(clearNowCost(state, idle.id, T0), null, 'and no price is quoted for it');

    const { state: started, id } = (() => {
      const s = game();
      s.gems = 0;
      const big = s.obstacles.find((o) => o.tier === 'large')!;
      return { state: clearObstacle(s, big.id, T0).state, id: big.id };
    })();
    eq(finishClearNow(started, id, T0).refusal, 'not-enough-gems', 'the price is named');
  });
});

/* --------------------------------------------------------------------------
 * finding 5 — the Diario auto-claimed rewards as bare toasts. Claiming stays
 * explicit; the data the panel draws is the save's own.
 * ----------------------------------------------------------------------- */

describe('playtest 5 · the Diario claims stay explicit', () => {
  test('the demo island opens the panel on two claimable quests', () => {
    const state = createDemoIsland('test', T0, TZ);
    eq(state.quests.daily.length, BALANCE.quests.dailyCount, 'three dailies in the save');
    eq(state.quests.daily.filter((q) => !q.claimed && q.progress >= q.target).length, 2,
      'two of them sit claimable');
  });

  test('claiming is a tap per quest, and a second tap on the same one refuses', () => {
    const state = createDemoIsland('test', T0, TZ);
    const first = claimQuest(state, 0);
    ok(first.ok, 'the first claim lands');
    eq(first.state.gems, state.gems + BALANCE.quests.reward.gemas, 'gems granted');
    eq(first.state.quests.coronas, BALANCE.quests.reward.coronas, 'a corona granted');
    const again = claimQuest(first.state, 0);
    eq(again.refusal, 'not-ready', 'the same reward cannot be taken twice');
  });

  test('the season line has a season to print', () => {
    const s = season(T0);
    ok(s.endsAt > T0, 'the season is running');
    ok(s.index >= 0, 'and has an index the plate can name');
  });
});
