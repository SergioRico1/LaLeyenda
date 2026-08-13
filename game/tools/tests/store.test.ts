import {
  GEM_PACKS, creditPack, packById, packValue, pricedGemSpends,
} from '../../src/sim/gems';
import { awardChestInPlace } from '../../src/sim/chests';
import { MINUTE, finishNow, skipChest, startChest, startUpgrade, tick } from '../../src/sim';
import { describe, eq, ok, test } from './harness';
import { T0, find, game, rich } from './fixtures';

/**
 * store.test.ts — the gem store's pure ledger (src/sim/gems.ts).
 *
 * The payment call itself is behind the ✎ SEAM in src/ui/panels/store.ts and
 * is deliberately not here: by design everything on THIS side of the seam is
 * plain arithmetic, which is what these cases hold. The two spend paths the
 * game already has (Terminar Ya and the chest skip) are exercised against a
 * credited balance, because a store whose gems could not be spent would be the
 * worst possible version of "the shelf is real".
 */

describe('the shelf', () => {
  test('four packs, each one real: unique id, a name, gems and a price', () => {
    eq(GEM_PACKS.length, 4, 'four tiers, like the reference shelf');
    const ids = new Set(GEM_PACKS.map((p) => p.id));
    eq(ids.size, GEM_PACKS.length, 'ids are unique');
    for (const pack of GEM_PACKS) {
      ok(pack.label.length > 0, `${pack.id} has a name`);
      ok(pack.gems > 0, `${pack.id} contains gems`);
      ok(Number.isInteger(pack.priceCents) && pack.priceCents > 0, `${pack.id} has an integer cent price`);
      eq(packById(pack.id), pack, `${pack.id} is findable`);
    }
  });

  test('every gem price balance.json publishes is purchasable EXACTLY', () => {
    // The builder unlocks are the only fixed gem prices in the game (500 /
    // 1200 / 2500). A shelf that sold 550s and 1300s would make every builder
    // cost "one pack plus a bit more", which is the oldest trick in the store.
    const priced = pricedGemSpends();
    ok(priced.length >= 3, 'balance.json still prices the builders in gems');
    for (const spend of priced) {
      ok(
        GEM_PACKS.some((p) => p.gems === spend),
        `a pack of exactly ${spend} gems exists for the ${spend}-gem unlock`
      );
    }
  });

  test('bigger packs are sorted, better value, and never a decoy', () => {
    for (let i = 1; i < GEM_PACKS.length; i++) {
      const small = GEM_PACKS[i - 1];
      const big = GEM_PACKS[i];
      ok(big.gems > small.gems, `${big.id} holds more than ${small.id}`);
      ok(big.priceCents > small.priceCents, `${big.id} costs more than ${small.id}`);
      // Value per euro rises with size — no tier exists only to make its
      // neighbour look bad…
      ok(
        packValue(big) >= packValue(small),
        `${big.id} (${packValue(big).toFixed(1)}/€) is at least the value of ${small.id} (${packValue(small).toFixed(1)}/€)`
      );
    }
    // …and it rises MILDLY. A 10× bulk multiplier is the "best value" scream
    // RETENTION.md's shop refuses; the whole ladder stays under 4×.
    const spread = packValue(GEM_PACKS[GEM_PACKS.length - 1]) / packValue(GEM_PACKS[0]);
    ok(spread < 4, `value spread ${spread.toFixed(2)}× stays under 4×`);
  });
});

describe('the credit', () => {
  test('a settled pack lands as exactly its gems, and touches nothing else', () => {
    const before = game();
    const result = creditPack(before, 'bolsa');
    ok(result.ok, 'the credit clears');
    eq(result.gems, 500, 'reports what landed');
    eq(result.state.gems, before.gems + 500, 'the ledger moved by the pack');
    // Everything that is not the gem balance is byte-identical.
    const stripped = (s: typeof before) => JSON.stringify({ ...s, gems: 0 });
    eq(stripped(result.state), stripped(before), 'nothing else in the save moved');
    eq(before.gems, 5, 'and the input state was not mutated');
  });

  test('a pack this build does not sell is refused, not credited as zero', () => {
    const before = game();
    const result = creditPack(before, 'megapack_9000');
    ok(!result.ok, 'refused');
    eq(result.refusal, 'unknown-building', 'with a reason the UI can voice');
    eq(result.state.gems, before.gems, 'and no gems moved');
  });

  test('the credit is deterministic and serializable', () => {
    const a = creditPack(game(), 'arcon').state;
    const b = creditPack(game(), 'arcon').state;
    eq(JSON.stringify(a), JSON.stringify(b), 'same input, same ledger');
    eq(JSON.stringify(JSON.parse(JSON.stringify(a))), JSON.stringify(a), 'survives the save envelope');
  });
});

describe('credited gems spend where gems already spend', () => {
  test('Terminar Ya works on purchased gems, at the price it quoted', () => {
    // A rich island that is gem-broke: resources for the upgrade, nothing to
    // hurry it with.
    let state = rich();
    state.gems = 0;
    state = startUpgrade(state, find(state, 'almacen').id, T0).state;
    state = tick(state, T0 + MINUTE).state;

    const id = find(state, 'almacen').id;
    const refused = finishNow(state, id, state.now);
    ok(!refused.ok && refused.refusal === 'not-enough-gems', 'broke, the finish refuses');
    ok(refused.gems > 0, 'and names its price');

    state = creditPack(state, 'bolsa').state;
    const paid = finishNow(state, id, state.now);
    ok(paid.ok, 'funded, the same finish clears');
    eq(paid.gems, refused.gems, 'at the price it quoted while refusing');
    eq(paid.state.gems, 500 - paid.gems, 'and the ledger shows the debit');
    eq(find(paid.state, 'almacen').level, 2, 'the building actually finished');
  });

  test('the chest skip works on purchased gems', () => {
    let state = rich();
    state.gems = 0;
    const slot = awardChestInPlace(state, 'oro');
    ok(slot >= 0, 'the fixture takes a chest');
    state = startChest(state, slot, T0).state;
    state = tick(state, T0 + 5 * MINUTE).state;

    const refused = skipChest(state, slot, state.now);
    ok(!refused.ok && refused.refusal === 'not-enough-gems', 'broke, the skip refuses');

    state = creditPack(state, 'cofre').state;
    const paid = skipChest(state, slot, state.now);
    ok(paid.ok, 'funded, the same skip clears');
    eq(paid.state.gems, 1200 - paid.gems, 'and the ledger shows the debit');
    eq(paid.state.chests[slot].state, 'ready', 'the chest is ready to open');
  });
});
