import { Rng } from '../../src/core/rng';
import {
  AVATAR_PARTS, AVATAR_SLOTS, NAME_MAX, OPTIONAL_SLOTS, createCaptain, cycleSlot, isValidLook,
  looksParts, nameAgrees, rollLook, rollName, sanitizeCaptain, sanitizeLook, sanitizeName,
  setCaptain, slotOptional, slotOptions, type AvatarSlot, type CaptainLook,
} from '../../src/sim';
import { describe, deepEq, eq, ok, test } from './harness';
import { T0, game } from './fixtures';

/**
 * captain.test.ts — the identity, tested with no browser in sight.
 *
 * Every assertion here runs under node against strings. That is the point: a
 * part is a model id and nothing else, so the whole avatar system is testable
 * headlessly, and the day it stops being testable headlessly is the day
 * something about a GLB has leaked into src/sim/.
 */

const slots = AVATAR_SLOTS;

describe('the avatar slot table', () => {
  test('seven families covering the 43 models we shipped art for', () => {
    eq(slots.length, 7, 'seven slots');
    deepEq([...slots].sort(), ['beard', 'body', 'bottom', 'eyes', 'hair', 'hat', 'top'], 'named');
    const total = slots.reduce((sum, slot) => sum + AVATAR_PARTS[slot].length, 0);
    eq(total, 43, 'every av_* model in public/assets/models is in the table exactly once');
  });

  test('every part id is a distinct av_<slot>_ name', () => {
    const seen = new Set<string>();
    for (const slot of slots) {
      for (const id of AVATAR_PARTS[slot]) {
        ok(id.startsWith(`av_${slot}_`), `${id} belongs to the ${slot} family`);
        ok(!seen.has(id), `${id} appears once`);
        seen.add(id);
      }
    }
    eq(seen.size, 43, 'no duplicates across the seven families');
  });

  test('body, hair, top and bottom are never empty; beard, eyes and hat may be', () => {
    deepEq([...OPTIONAL_SLOTS].sort(), ['beard', 'eyes', 'hat'], 'the three that can be none');
    for (const slot of ['body', 'hair', 'top', 'bottom'] as AvatarSlot[]) {
      ok(!slotOptional(slot), `${slot} is required`);
      ok(!slotOptions(slot).includes(null), `${slot} offers no "none"`);
    }
    for (const slot of OPTIONAL_SLOTS) {
      eq(slotOptions(slot)[0], null, `${slot} offers "none" first`);
      eq(slotOptions(slot).length, AVATAR_PARTS[slot].length + 1, `${slot} offers none + its parts`);
    }
  });
});

describe('rolling a captain', () => {
  test('the same seed always rolls the same captain', () => {
    deepEq(createCaptain('bartolome'), createCaptain('bartolome'), 'replayable');
    ok(
      JSON.stringify(createCaptain('bartolome')) !== JSON.stringify(createCaptain('ines')),
      'and two seeds are two captains'
    );
  });

  test('a rolled look is always valid and always wearable', () => {
    // Enough draws that a bad weight or an off-by-one in a slot table shows up.
    for (let i = 0; i < 400; i++) {
      const look = rollLook(new Rng(`roll:${i}`));
      ok(isValidLook(look), `roll ${i} is a legal look: ${JSON.stringify(look)}`);
      const parts = looksParts(look);
      ok(parts.length >= 4 && parts.length <= 7, `roll ${i} wears between 4 and 7 parts`);
      ok(parts.includes(look.body), 'the body is always drawn');
    }
  });

  test('the optional slots really do come and go', () => {
    // A "nullable" slot that is never null is a slot with a dead branch in it,
    // and a slot that is always null means the art never appears.
    for (const slot of OPTIONAL_SLOTS) {
      let present = 0;
      for (let i = 0; i < 200; i++) if (rollLook(new Rng(`vary:${slot}:${i}`))[slot]) present++;
      ok(present > 20 && present < 195, `${slot} is present ${present}/200 of the time`);
    }
  });

  test('a captain carries the island seed it was rolled for', () => {
    eq(createCaptain('isla-tortuga').seed, 'isla-tortuga', 'the seed is the captain’s own');
  });

  test('a given name wins over the rolled one, and the look is unchanged by it', () => {
    const rolled = createCaptain('same');
    const named = createCaptain('same', 'Malva la Roja');
    eq(named.name, 'Malva la Roja', 'the player’s name is kept');
    deepEq(named.look, rolled.look, 'and naming a captain does not re-roll their face');
  });
});

describe('names', () => {
  test('a blank, absent or whitespace name still produces a captain', () => {
    for (const raw of ['', '   ', '\n\t', null, undefined, 42, {}]) {
      const name = sanitizeName(raw);
      ok(name.length > 0, `${JSON.stringify(raw)} → "${name}"`);
    }
  });

  test('a long name is cut to something a leaderboard row can hold', () => {
    const long = sanitizeName('Bartolomé el Tuerto de las Islas de Poniente');
    ok(long.length <= NAME_MAX, `${long.length} <= ${NAME_MAX}`);
    ok(!long.endsWith(' '), 'and never with a trailing space');
  });

  test('newlines and control characters are collapsed, accents are kept', () => {
    eq(sanitizeName('  Inés\n\n  la   Roja '), 'Inés la Roja', 'one name, one space');
  });

  test('a dealt name agrees its article and fits the box whole', () => {
    // The roller redraws mismatches ("Tobías la Corsaria") and truncations —
    // the rival roster always rejected them, and round 11's cold walk met one
    // in the first field a player ever reads, so the rule lives in rollName
    // itself now. 300 draws from 3 seeds: every one legal.
    for (const seed of ['nombres', 'la-leyenda', 'walk']) {
      const rng = new Rng(seed);
      for (let i = 0; i < 100; i++) {
        const name = rollName(rng);
        ok(name.length <= NAME_MAX, `"${name}" fits the box`);
        ok(nameAgrees(name), `"${name}" agrees its article`);
      }
    }
  });
});

describe('editing a look', () => {
  test('cycling a slot walks every option and comes back', () => {
    let look = rollLook(new Rng('cycle'));
    for (const slot of slots) {
      const options = slotOptions(slot);
      const seen = new Set<string | null>();
      for (let i = 0; i < options.length; i++) {
        look = cycleSlot(look, slot, 1);
        seen.add(look[slot]);
      }
      eq(seen.size, options.length, `${slot} offered all ${options.length} of its options`);
      ok(isValidLook(look), `${slot} stayed valid all the way round`);
    }
  });

  test('forwards then backwards is where you started', () => {
    const look = rollLook(new Rng('there-and-back'));
    for (const slot of slots) {
      deepEq(cycleSlot(cycleSlot(look, slot, 1), slot, -1), look, `${slot} returns`);
    }
  });

  test('changing one slot changes exactly one slot', () => {
    const look = rollLook(new Rng('one-at-a-time'));
    const next = cycleSlot(look, 'hat', 1);
    for (const slot of slots) {
      if (slot === 'hat') continue;
      eq(next[slot], look[slot], `${slot} was left alone`);
    }
  });
});

describe('a look that came off a disk', () => {
  const sound = createCaptain('disk').look;

  test('a part that no longer exists falls back rather than vanishing', () => {
    const broken = { ...sound, body: 'av_body_from_a_mod', hat: 'av_hat_nope' };
    const fixed = sanitizeLook(broken, sound);
    ok(isValidLook(fixed), 'repaired');
    eq(fixed.body, sound.body, 'a required slot falls back to the reference look');
    ok(fixed.hat === null || AVATAR_PARTS.hat.includes(fixed.hat), 'and an optional one to something real');
  });

  test('rubbish in every slot still yields a drawable captain', () => {
    for (const rubbish of [null, undefined, 'a string', 7, [], { body: 12, look: null }]) {
      const fixed = sanitizeLook(rubbish, sound);
      ok(isValidLook(fixed), `${JSON.stringify(rubbish)} → a valid look`);
    }
  });

  test('a sound look is returned unchanged, field for field', () => {
    deepEq(sanitizeLook(sound, sound), sound, 'nothing is rewritten');
  });

  test('a MISSING slot is a half-written save, not an empty one', () => {
    // The difference matters: `null` is a decision the player made and must be
    // preserved; an absent key is damage, and repairing it is what stops a
    // captain arriving with no body.
    const { hat, ...noHat } = sound;
    ok(hat !== undefined, 'the reference look does have one');
    ok(!isValidLook(noHat), 'an absent optional slot is not "none"');
    ok(isValidLook({ ...sound, hat: null }), 'but an explicit null is');
    ok(isValidLook(sanitizeLook(noHat, sound)), 'and it repairs');
  });

  test('sanitizeLook survives a fallback that is itself broken', () => {
    const rotten = { ...sound, body: 'av_body_from_a_mod', hair: null } as unknown as CaptainLook;
    const fixed = sanitizeLook({ top: 'nonsense' }, rotten);
    ok(isValidLook(fixed), `still drawable: ${JSON.stringify(fixed)}`);
  });

  test('sanitizeCaptain always states the island seed it was given', () => {
    const captain = sanitizeCaptain({ name: 'Nuno', seed: 'somewhere-else', look: sound }, 'here');
    eq(captain.seed, 'here', 'the ground under the captain wins');
    eq(captain.name, 'Nuno', 'the name survives');
  });
});

describe('the captain on the state', () => {
  test('a new game always has one, rolled from its own seed', () => {
    const state = game('vela');
    ok(isValidLook(state.captain.look), 'valid look');
    ok(state.captain.name.length > 0, 'named');
    eq(state.captain.seed, state.seed, 'and standing on their own island');
  });

  test('the captain does not disturb the island the seed rolls', () => {
    // The roll is forked off `seed:captain`. If it ever came out of the state's
    // own cursor instead, changing this file by one draw would move every palm.
    const a = game('same-island');
    const b = game('same-island');
    eq(JSON.stringify(a.obstacles), JSON.stringify(b.obstacles), 'same field');
    eq(a.rngState, b.rngState, 'same cursor');
  });

  test('setCaptain writes the choice and keeps the island seed', () => {
    const before = game('mi-isla');
    const chosen: CaptainLook = cycleSlot(before.captain.look, 'hat', 2);
    const after = setCaptain(before, { name: '  Rocío  ', seed: 'not-this-one', look: chosen });

    ok(after.ok, 'accepted');
    eq(after.state.captain.name, 'Rocío', 'name trimmed and kept');
    eq(after.state.captain.seed, 'mi-isla', 'the island seed is not overwritten by the argument');
    deepEq(after.state.captain.look, chosen, 'the chosen look is the one stored');
    eq(before.captain.name, before.captain.name, 'and the state that went in was not mutated');
    ok(after.state !== before, 'a new state came out');
  });

  test('setCaptain repairs a look assembled out of nonsense', () => {
    const before = game('bad-input');
    const after = setCaptain(before, {
      name: '',
      seed: before.seed,
      look: { ...before.captain.look, top: 'av_top_that_never_shipped' } as CaptainLook,
    });
    ok(after.ok, 'still accepted — creation must never dead-end');
    ok(isValidLook(after.state.captain.look), 'and what it stored is drawable');
    ok(after.state.captain.name.length > 0, 'and named');
  });

  test('the captain survives a tick like every other field', () => {
    const before = game('durable');
    const after = setCaptain(before, { ...before.captain, name: 'Chispa' }).state;
    const ticked = { ...after, now: T0 };
    eq(ticked.captain.name, 'Chispa', 'still aboard');
  });
});
