import {
  BALANCE, HOUR, MINUTE, buildersFree, collect, producerCapacity, startUpgrade, storeCap, tick,
} from '../../src/sim';
import { describe, eq, near, ok, test } from './harness';
import { T0, find, game, rich, stockOf } from './fixtures';

/**
 * The mechanic UI_SPEC §4.2 says RETENTION.md fuses by mistake, and the
 * builder limit §9 corrects from 1 to 2.
 */

describe('§4.2 two separate caps', () => {
  test('a producer fills its OWN capacity and stops — the store is irrelevant', () => {
    const start = game();
    const saw = find(start, 'aserradero');
    const capacity = producerCapacity(saw);
    eq(capacity, 600, 'Aserradero Nv1 holds 600');
    ok(storeCap(start, 'madera') > capacity, 'and the Almacén has far more room than that');

    // Ten hours is more than three times the fill time.
    const after = tick(start, T0 + 10 * HOUR).state;
    eq(stockOf(after, 'aserradero'), capacity, 'the building stopped at its own capacity');
    eq(after.store.madera, 0, 'and not one unit reached the store on its own');
  });

  test('collecting is the ONLY path from the producer to the store', () => {
    const filled = tick(game(), T0 + 10 * HOUR).state;
    const result = collect(filled, find(filled, 'aserradero').id);

    ok(result.ok, 'the collect succeeded');
    eq(result.amount, 600, 'the whole 600 moved');
    eq(result.state.store.madera, 600, 'the store went up by exactly that');
    eq(stockOf(result.state, 'aserradero'), 0, 'and the producer is empty again');
  });

  test('a full STORE is a different failure: the collect spills and the stock stays', () => {
    let state = tick(game(), T0 + 10 * HOUR).state;
    state = { ...state, store: { ...state.store, madera: storeCap(state, 'madera') } };

    const result = collect(state, find(state, 'aserradero').id);
    ok(!result.ok, 'the collect is refused');
    eq(result.refusal, 'store-full', 'and it names why — `Almacén al máximo`, not `¡Lleno!`');
    eq(result.amount, 0, 'nothing moved');
    eq(result.spilled, 600, 'the 600 is still in the building');
    eq(stockOf(result.state, 'aserradero'), 600, 'so the bubble stays up');
  });

  test('a half-full store takes what fits and leaves the rest in the building', () => {
    let state = tick(game(), T0 + 10 * HOUR).state;
    const cap = storeCap(state, 'madera');
    state = { ...state, store: { ...state.store, madera: cap - 250 } };

    const result = collect(state, find(state, 'aserradero').id);
    eq(result.amount, 250, 'only the 250 that fits moved');
    eq(result.state.store.madera, cap, 'the store is exactly full');
    eq(stockOf(result.state, 'aserradero'), 350, 'the other 350 waits in the producer');
  });

  test('upgrading a producer raises BOTH its rate and its own capacity', () => {
    const a = BALANCE.buildings.aserradero.levels[0];
    const b = BALANCE.buildings.aserradero.levels[1];
    ok((b.rate ?? 0) > (a.rate ?? 0), 'rate goes up');
    ok((b.capacity ?? 0) > (a.capacity ?? 0), 'capacity goes up');
    // Two independent upgrade decisions: the store ladder is a different
    // building entirely, which is the tension §9 says is half the economy.
    ok(BALANCE.buildings.almacen.id !== BALANCE.buildings.aserradero.id, 'and the store is another building');
  });
});

describe('§4.3 / §9 the builder limit — START WITH TWO', () => {
  test('a fresh island has two builders, both free', () => {
    const state = game();
    eq(state.builders.owned, 2, 'two owned');
    eq(buildersFree(state, T0), 2, 'two free');
  });

  test('two upgrades run at once; the third is refused for want of a builder', () => {
    let state = rich();

    const first = startUpgrade(state, find(state, 'almacen').id, T0);
    ok(first.ok, 'the Almacén upgrade starts');
    state = first.state;
    eq(buildersFree(state, T0), 1, 'one builder left');

    const second = startUpgrade(state, find(state, 'banco').id, T0);
    ok(second.ok, 'the Banco upgrade starts too');
    state = second.state;
    eq(buildersFree(state, T0), 0, 'no builders left');

    const third = startUpgrade(state, find(state, 'mercado').id, T0);
    ok(!third.ok, 'the third upgrade is refused');
    eq(third.refusal, 'no-builders', 'and the refusal is the builder, not the cost');
    eq(third.state.store.madera, state.store.madera, 'a refused upgrade charges nothing');
  });

  test('finishing a job frees the builder and the queue moves again', () => {
    let state = rich();
    state = startUpgrade(state, find(state, 'almacen').id, T0).state;
    state = startUpgrade(state, find(state, 'banco').id, T0).state;

    const later = T0 + 25 * MINUTE; // both are 20m jobs
    state = tick(state, later).state;

    eq(buildersFree(state, later), 2, 'both builders are free again');
    eq(find(state, 'almacen').level, 2, 'and the Almacén actually levelled');
    ok(startUpgrade(state, find(state, 'mercado').id, later).ok, 'the queued upgrade now starts');
  });

  test('the 24h carpintero de guardia lends a third slot and then takes it back', () => {
    let state = rich();
    state = { ...state, builders: { ...state.builders, tempUntil: T0 + BALANCE.builders.tempBuilderMs } };
    eq(buildersFree(state, T0), 3, 'three while the loan lasts');

    state = startUpgrade(state, find(state, 'almacen').id, T0).state;
    state = startUpgrade(state, find(state, 'banco').id, T0).state;
    ok(startUpgrade(state, find(state, 'mercado').id, T0).ok, 'three jobs run at once');

    const after = tick(state, T0 + BALANCE.builders.tempBuilderMs + MINUTE).state;
    eq(after.builders.tempUntil, null, 'the loan expired');
    eq(buildersFree(after, after.now), 2, 'and the island is back to two');
  });

  test('an upgrade charges its cost up front and starts a real timer', () => {
    const state = rich();
    const before = state.store.madera;
    const result = startUpgrade(state, find(state, 'almacen').id, T0);
    const work = find(result.state, 'almacen').work!;

    eq(state.store.madera, before, 'the input state was not mutated');
    eq(result.state.store.madera, before - 1000, 'the Almacén Nv2 cost was paid');
    eq(work.endsAt - work.startedAt, 20 * MINUTE, 'and the timer is the table time');
    near(producerCapacity(find(result.state, 'aserradero')), 600, 0, 'nothing else moved');
  });
});
