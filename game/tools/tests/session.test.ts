import {
  BALANCE, DAY, HOUR, MINUTE, claimDaily, createDemoIsland, createNewGame, dailyAvailable,
  isProducer, nextAction, openChest, startChest, tick,
} from '../../src/sim';
import { describe, eq, ok, test } from './harness';
import { T0, TZ, find, game } from './fixtures';

/**
 * The session loop itself — UI_SPEC §7's "Loop" checklist, as assertions.
 * These are the ones that fail quietly if they ever break: nothing crashes,
 * the player simply opens a dead island and does not come back.
 */

describe('§4.10 the first session', () => {
  test('a brand-new island has a bubble waiting in frame 1', () => {
    const state = createNewGame('first', T0, TZ);
    const saw = find(state, 'aserradero');
    ok(saw.stock >= 1, `the first producer is pre-seeded (${saw.stock}) — no bubble is ever empty`);
    eq(state.gems, 5, 'and the five gems beat 1:32 spends exactly one of');
  });

  test('the staged reveal starts at three pills, not five', () => {
    const state = createNewGame('first', T0, TZ);
    const shown = Object.entries(BALANCE.resources).filter(([, r]) => r.revealAtTownHall <= 1);
    eq(shown.length, 2, 'Madera and Oro (plus Gemas, which has no cap and no bar)');
    ok(state.store.metal === 0, 'and Metal does not exist yet');
  });
});

describe('§4.8 the next-action resolver', () => {
  test('it always returns a hit — a fresh island', () => {
    const state = createNewGame('resolver', T0, TZ);
    ok(nextAction(state, T0) !== 'none', `got ${nextAction(state, T0)}`);
  });

  test('it always returns a hit — the demo island, and after each thing is cleared', () => {
    let state = createDemoIsland('resolver', T0, TZ);
    // Walk the priority list down: free builder → chests → diario → …
    eq(nextAction(state, T0), 'construir', 'a free carpenter outranks everything');

    state = { ...state, builders: { owned: 1, tempUntil: null } };
    eq(nextAction(state, T0), 'cofres', 'then the ready chest');

    state = openChest(state, 0).state;
    state = startChest(state, 2, T0).state;
    ok(nextAction(state, T0) !== 'none', `still a hit: ${nextAction(state, T0)}`);

    state = claimDaily(state, T0).state;
    state = { ...state, quests: { ...state.quests, daily: state.quests.daily.map((q) => ({ ...q, claimed: true })) } };
    // Everything cleared, everything busy, producers part-full: §4.8's five
    // rules have no answer here, and 'recoger' is the sixth that closes the
    // hole without inventing a hook. 'none' would be a real bug.
    eq(nextAction(state, T0), 'recoger', 'the bubbles on the island are the answer');
  });

  test('an island with everything collected and nothing brewing asks you to sail', () => {
    let state = createDemoIsland('sail', T0, TZ);
    state = {
      ...state,
      builders: { owned: 1, tempUntil: null },
      chests: state.chests.map(() => ({ type: null, state: 'empty' as const, endsAt: null, totalMs: 0 })),
      freeChestsBanked: 0,
      daily: { ...state.daily, lastClaimedDay: Math.floor(T0 / DAY) },
      quests: { ...state.quests, daily: state.quests.daily.map((q) => ({ ...q, claimed: true })) },
      buildings: state.buildings.map((b) => (isProducer(b) ? { ...b, stock: 0 } : b)),
    };
    eq(nextAction(state, T0), 'zarpar', 'the sea is the answer when the island is quiet');
  });
});

describe('§9 the daily streak PAUSES, it does not reset', () => {
  test('missing three days resumes at the next day of the chain', () => {
    let state = game();
    eq(state.daily.day, 1, 'starts on day 1');

    state = claimDaily(state, T0).state;
    eq(state.daily.day, 2, 'tomorrow is day 2');

    // Vanish for three days. A reset-on-miss design would send this back to 1.
    ok(!dailyAvailable(state, T0 + 6 * HOUR), 'not twice in one day');
    ok(dailyAvailable(state, T0 + 4 * DAY), 'available again on return');
    state = claimDaily(state, T0 + 4 * DAY).state;
    eq(state.daily.day, 3, 'the chain carried on from where it paused');
  });

  test('a full week rolls the multiplier over', () => {
    let state = game();
    for (let d = 0; d < BALANCE.daily.days.length; d++) {
      state = claimDaily(state, T0 + d * DAY).state;
    }
    eq(state.daily.day, 1, 'back to the top of the chain');
    eq(state.daily.week, 1, 'on the second week`s multiplier');
  });

  test('day 4 drops a chest into the tray, which is what chains the two loops', () => {
    let state = game();
    for (let d = 0; d < 3; d++) state = claimDaily(state, T0 + d * DAY).state;
    const before = state.chests.filter((c) => c.type).length;
    state = claimDaily(state, T0 + 3 * DAY).state;
    eq(state.chests.filter((c) => c.type).length, before + 1, 'a Cofre de Plata placed itself');
  });
});

describe('§7 "at every session close there is a timer running AND something to collect"', () => {
  test('the island the game opens on satisfies it', () => {
    const state = createDemoIsland('close', T0, TZ);
    ok(state.buildings.some((b) => b.work), 'something is building');
    ok(state.buildings.some((b) => isProducer(b) && b.stock >= 1), 'something is collectable');
    ok(state.chests.some((c) => c.state === 'unlocking'), 'and a chest is brewing');
  });

  test('and it still does after a session of collecting everything', () => {
    let state = createDemoIsland('close', T0, TZ);
    for (const b of state.buildings) {
      if (isProducer(b)) state = { ...state, buildings: state.buildings.map((x) => (x.id === b.id ? { ...x, stock: 0 } : x)) };
    }
    // Two minutes later the producers are already refilling — the island is
    // never left visually dead.
    state = tick(state, T0 + 2 * MINUTE).state;
    ok(state.buildings.some((b) => isProducer(b) && b.stock > 0), 'production restarted immediately');
  });
});
