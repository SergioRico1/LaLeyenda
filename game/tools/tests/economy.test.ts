import {
  BALANCE, HOUR, MINUTE, buildersFree, collect, createNewGame, landCargoInPlace, previewLanding,
  producerCapacity, startUpgrade, storeCap, tick, type ResourceId,
} from '../../src/sim';
import { cellsInRing, siteAt } from '../../src/sim/sea';

/** The seed a new island is rolled with in these cases. Any would do — the
 *  claims below are about the STORE, which no seed changes. */
const SEED = 'la-leyenda';
import { toHudState } from '../../src/ui/present';
import { describe, eq, near, ok, test } from './harness';
import { T0, find, quiet, rich, stockOf } from './fixtures';

/**
 * The mechanic UI_SPEC §4.2 says RETENTION.md fuses by mistake, and the
 * builder limit §9 corrects from 1 to 2.
 */

describe('§4.2 two separate caps', () => {
  test('a producer fills its OWN capacity and stops — the store is irrelevant', () => {
    const start = quiet();
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
    const filled = tick(quiet(), T0 + 10 * HOUR).state;
    const result = collect(filled, find(filled, 'aserradero').id);

    ok(result.ok, 'the collect succeeded');
    eq(result.amount, 600, 'the whole 600 moved');
    eq(result.state.store.madera, 600, 'the store went up by exactly that');
    eq(stockOf(result.state, 'aserradero'), 0, 'and the producer is empty again');
  });

  test('a full STORE is a different failure: the collect spills and the stock stays', () => {
    let state = tick(quiet(), T0 + 10 * HOUR).state;
    state = { ...state, store: { ...state.store, madera: storeCap(state, 'madera') } };

    const result = collect(state, find(state, 'aserradero').id);
    ok(!result.ok, 'the collect is refused');
    eq(result.refusal, 'store-full', 'and it names why — `Almacén al máximo`, not `¡Lleno!`');
    eq(result.amount, 0, 'nothing moved');
    eq(result.spilled, 600, 'the 600 is still in the building');
    eq(stockOf(result.state, 'aserradero'), 600, 'so the bubble stays up');
  });

  test('a half-full store takes what fits and leaves the rest in the building', () => {
    let state = tick(quiet(), T0 + 10 * HOUR).state;
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
    const state = quiet();
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

/**
 * THE GAME MUST NEVER PAY YOU IN SOMETHING IT CANNOT KEEP AND WILL NOT NAME.
 *
 * The owner, 12 Aug, looking at the HUD: *"veo que un recurso no aparece"*.
 * They were right, and it was worse than invisible. `townHall.baseStorage` was
 * oro and madera only, on the rule that ron and metal must earn their store —
 * which was true while the only way to get a resource was to build the thing
 * that makes it, and stopped being true the moment the sea became a
 * first-session activity. Every kind of site in ring 1 pays ron or metal, so a
 * brand-new player's first voyage came home carrying a currency with a cap of
 * ZERO: `previewLanding` spilled every unit of it, the end-of-voyage card said
 * so, and the HUD had never drawn the row it was talking about.
 *
 * These are the two halves of the promise, asserted where they are decided.
 */
describe('a first voyage comes home to somewhere to put it', () => {
  test('a day-one island can hold some of everything the near sea pays', () => {
    // Walked off the REAL sea rather than off the loot table: what matters is
    // what a first voyage can actually sail over, and ring 1 is the water the
    // Muelle's skiff is sold for.
    const day = createNewGame(SEED, T0, 0);
    const seen = new Set<string>();
    for (const [cx, cy] of cellsInRing(1)) {
      const site = siteAt('la-leyenda', cx, cy);
      if (!site) continue;
      for (const res of Object.keys(site.loot) as ResourceId[]) {
        seen.add(res);
        ok(
          storeCap(day, res) > 0,
          `a ${site.kind} in ring 1 pays ${res}, and a day-one island holds ${storeCap(day, res)} of it`
        );
      }
    }
    ok(seen.has('ron'), 'and ring 1 really does pay ron — the case this is about');
  });

  test('the ron off a first voyage lands rather than going over the side', () => {
    // An islet and a wreck, which is exactly what ring 1 has to offer.
    const day = createNewGame(SEED, T0, 0);
    const hold = { madera: 45, ron: 38, oro: 35 };
    const landing = previewLanding(day, hold);
    eq(landing.landed.ron, 38, 'every unit of it reached the island');
    eq(Object.keys(landing.spilled).length, 0, 'and nothing at all was spilled');
  });

  test('but a store still has to be earned for any real quantity', () => {
    // The hall's strongroom is a TASTE. If it were a supply the Bodega would be
    // decoration, and "earn your store" is the rule this is trying not to break.
    const day = createNewGame(SEED, T0, 0);
    const haul = { ron: 400, metal: 400 };
    const landing = previewLanding(day, haul);
    ok((landing.spilled.ron ?? 0) > 0, 'four hundred ron does not fit in a hall');
    ok((landing.spilled.metal ?? 0) > 0, 'nor four hundred metal');
    ok(storeCap(day, 'ron') < 400, 'the strongroom is a taste, not a supply');
  });
});

/**
 * The other half, and it lives in the presenter because that is where the
 * decision is: §4.1's staged reveal was a pure function of the town hall, so a
 * resource could be in the save and off the screen at the same time.
 */
describe('the HUD never hides a resource you are holding', () => {
  test('a day-one island still gets the staged reveal', () => {
    const rail = toHudState(createNewGame(SEED, T0, 0), T0).resources.map((r) => r.id);
    eq(JSON.stringify(rail), JSON.stringify(['oro', 'madera']), 'two rows, not four');
  });

  test('and a resource arrives on the rail the moment the player owns any', () => {
    const day = createNewGame(SEED, T0, 0);
    ok(!toHudState(day, T0).resources.some((r) => r.id === 'ron'), 'no ron before the voyage');
    landCargoInPlace(day, { ron: 38 });
    const rail = toHudState(day, T0).resources;
    const ron = rail.find((r) => r.id === 'ron');
    ok(ron !== undefined, 'and a row for it the moment there is some');
    eq(ron?.value, 38, 'reading what the save actually says');
    // The order is still `pillRow`, so a row arriving never shuffles the others.
    eq(JSON.stringify(rail.map((r) => r.id)), JSON.stringify(['oro', 'madera', 'ron']), 'in its own place');
  });

  test('every resource the store holds has a row, at every hall level', () => {
    // The general form of the bug: whatever put it there — a voyage, a chest, a
    // daily, a migration from an older save — a number in the store the screen
    // does not draw is a number the player cannot act on.
    const state = createNewGame(SEED, T0, 0);
    landCargoInPlace(state, { oro: 10, madera: 10, ron: 10, metal: 10 });
    const shown = new Set(toHudState(state, T0).resources.map((r) => r.id));
    for (const res of Object.keys(state.store) as ResourceId[]) {
      if (state.store[res] <= 0) continue;
      ok(shown.has(res), `${res} is in the store and on the screen`);
    }
  });
});
