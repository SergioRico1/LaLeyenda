import {
  BALANCE, DAY, HOUR, MINUTE, buildersFree, collect, dailyAvailable, producerCapacity,
  startChest, startUpgrade, tick,
} from '../../src/sim';
import { describe, eq, near, ok, test } from './harness';
import { T0, find, quiet, rich, stockOf } from './fixtures';

/**
 * §4.7: the only limit on offline production is the producer's own cap. There
 * is no artificial offline rule — scarcity comes from the machine, never from
 * punishing someone for living.
 */

describe('offline catch-up', () => {
  test('an hour away pays exactly an hour of production', () => {
    const state = tick(quiet(), T0 + HOUR).state;
    near(stockOf(state, 'aserradero'), 200, 0.001, 'Nv1 makes 200/h');
    near(stockOf(state, 'mercado'), 150, 0.001, 'the Mercado makes 150/h');
  });

  test('production is capped by the producer, and by nothing else', () => {
    const state = tick(quiet(), T0 + 30 * DAY).state;
    for (const b of state.buildings) {
      const cap = producerCapacity(b);
      if (cap <= 0) continue;
      eq(b.stock, cap, `${b.type} sits at its own capacity after a month away`);
    }
  });

  test('the summary describes the welcome-back moment', () => {
    const result = tick(quiet(), T0 + 4 * HOUR);
    near(result.summary.produced.madera, 600, 0.001, 'wood produced while away');
    near(result.summary.pending.madera, 600, 0.001, 'and what is waiting for a tap');
    eq(result.summary.fullProducers, 2, 'both starting producers are at cap');
    ok(!result.summary.longAbsence, '4h is not a long absence');
    ok(tick(quiet(), T0 + 80 * HOUR).summary.longAbsence, '80h is — §3.22C `La Isla Resistió`');
  });

  test('the window is integrated PIECEWISE, split at every completion inside it', () => {
    // Aserradero Nv1 → Nv2 takes 5m and moves 200/h → 320/h.
    let state = rich();
    state = { ...state, buildings: state.buildings.map((b) => (b.type === 'aserradero' ? { ...b, stock: 0 } : b)) };
    state = startUpgrade(state, find(state, 'aserradero').id, T0).state;

    const after = tick(state, T0 + HOUR).state;
    const expected = 200 * (5 / 60) + 320 * (55 / 60);

    near(stockOf(after, 'aserradero'), expected, 0.01, '5m at the old rate, 55m at the new one');
    ok(Math.abs(stockOf(after, 'aserradero') - 320) > 1, 'not the whole hour at the new rate');
    ok(Math.abs(stockOf(after, 'aserradero') - 200) > 1, 'and not the whole hour at the old one');
  });

  test('a capacity raised mid-window is honoured for the rest of it', () => {
    // Nv1 holds 600. Left alone for 6h the building would stop at 600; with the
    // upgrade landing at 5m it can climb to Nv2's 960.
    let state = rich();
    state = { ...state, buildings: state.buildings.map((b) => (b.type === 'aserradero' ? { ...b, stock: 0 } : b)) };
    state = startUpgrade(state, find(state, 'aserradero').id, T0).state;

    const after = tick(state, T0 + 6 * HOUR).state;
    eq(stockOf(after, 'aserradero'), 960, 'it filled the NEW capacity, not the old one');
  });

  test('timers finish while away and hand their builders back', () => {
    let state = rich();
    state = startUpgrade(state, find(state, 'almacen').id, T0).state;
    state = startUpgrade(state, find(state, 'banco').id, T0).state;
    eq(buildersFree(state, T0), 0, 'both builders are out');

    const result = tick(state, T0 + 12 * HOUR);
    eq(buildersFree(result.state, result.state.now), 2, 'both are back');
    eq(result.summary.finished.length, 2, 'and the summary names both jobs');
    ok(
      result.events.some((e) => e.type === 'work-finished' && e.building === 'almacen'),
      'a work-finished event was raised for the Almacén'
    );
  });

  test('a chest unlocking when you leave is ready when you come back', () => {
    let state = rich();
    state = { ...state, chests: state.chests.map((c, i) => (i === 0 ? { ...c, type: 'plata', state: 'waiting' as const } : c)) };
    state = startChest(state, 0, T0).state;
    eq(state.chests[0].state, 'unlocking', 'it is brewing');

    const result = tick(state, T0 + 4 * HOUR); // Plata is a 3h chest
    eq(result.state.chests[0].state, 'ready', 'and ready on return');
    eq(result.summary.chestsReady, 1, 'the summary counts it');
    ok(result.events.some((e) => e.type === 'chest-ready'), 'with an event for the badge');
  });

  test('the Cofre Libre stacks to two and no further — that gap IS the pressure', () => {
    const every = BALANCE.chests.freeChest.everyMs;
    const state = tick(quiet(), T0 + 40 * every).state;
    eq(state.freeChestsBanked, BALANCE.chests.freeChest.stack, 'banked at the stack limit');
  });

  test('a new calendar day makes the daily claimable again', () => {
    const state = quiet();
    ok(dailyAvailable(state, T0), 'never claimed → available');
    const claimed = { ...state, daily: { ...state.daily, lastClaimedDay: Math.floor(T0 / DAY) } };
    ok(!dailyAvailable(claimed, T0 + HOUR), 'same day → not available');
    ok(dailyAvailable(claimed, T0 + DAY), 'next day → available again');
  });

  test('tick is pure: the state passed in is never touched', () => {
    const before = quiet();
    const snapshot = JSON.stringify(before);
    const after = tick(before, T0 + 8 * HOUR).state;
    eq(JSON.stringify(before), snapshot, 'the input is byte-identical afterwards');
    ok(JSON.stringify(after) !== snapshot, 'and the result really did move on');
  });

  test('replaying the same window in slices lands where one jump does', () => {
    const oneJump = tick(quiet(), T0 + 6 * HOUR).state;
    let sliced = quiet();
    for (let i = 1; i <= 6 * 60; i++) sliced = tick(sliced, T0 + i * MINUTE).state;
    near(stockOf(sliced, 'aserradero'), stockOf(oneJump, 'aserradero'), 0.001, 'same wood');
    near(stockOf(sliced, 'mercado'), stockOf(oneJump, 'mercado'), 0.001, 'same gold');
  });

  test('the round trip is closed: away → collect → the store goes up', () => {
    const away = tick(quiet(), T0 + 3 * HOUR).state;
    const saw = find(away, 'aserradero');
    const result = collect(away, saw.id);
    near(result.state.store.madera, saw.stock, 0.001, 'everything the island made is now banked');
    eq(result.state.stats.collects, 1, 'and the tap was counted for the dailies');
  });
});
