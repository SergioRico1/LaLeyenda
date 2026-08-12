import { describe, eq, near, ok, test } from './harness';
import { Rng } from '../../src/core/rng';
import {
  NEUTRAL_LOADOUT, SEA_CELL, SEA_RANGE, SEA_STEP, SHIPS, effectiveShip, holdUsed, ringOf,
  sitesNear, startVoyage, steer, stepVoyage,
  type Loadout, type ShipSpec, type Site, type Voyage,
} from '../../src/sim/sea';
import {
  KILL_VALUE, PERTRECHOS, POOL_LEVELS, SITE_VALUE, canTake, earn, earnedBy,
  levelOf, loadoutOf, noteEvents, offerFor, pertrechoById, progress, startPertrechos,
  taken as takenList, takeOffer, threshold, type PertrechoId, type PertrechosState,
} from '../../src/sim/pertrechos';

/** A fresh neutral loadout — the identity, copied so a test cannot scribble on
 *  the shared constant. */
const emptyLoadout = (): Loadout => ({ ...NEUTRAL_LOADOUT });

/**
 * The ship a loadout actually sails.
 *
 * `effectiveShip` is the sim's own answer and the only one that counts — it is
 * what `stepVoyage` reads at the top of every step. The hold is empty, so the
 * weight rule contributes exactly nothing and what is left in the difference is
 * the pertrechos. Before the two Loadouts were made one this file had its own
 * `riggedShip`, which was the problem: a second implementation of the seam,
 * agreeing with itself and with nothing else.
 */
const rigged = (shipType: string, loadout: Loadout): ShipSpec =>
  effectiveShip(startVoyage('rigged', shipType, { loadout }));

/**
 * pertrechos.test.ts — SEA_PLAY.md item 3, held to its five promises.
 *
 * The brief for this module names exactly what has to be true, and each one is a
 * group below: the offer is deterministic per seed, it is three DISTINCT
 * options, the pool drains, a full run reaches a sensible number of picks, and
 * taking one changes the loadout the way the card claims.
 *
 * The fourth of those is the only one that cannot be answered by reading the
 * module, because it is a question about the SEA rather than about this file. So
 * it is answered the way sim/ answers every balance question: by playing real
 * voyages headlessly and counting. `fleetPicks` at the foot of this file is a
 * compact model of the pilot in tools/tests/voyages.ts — it steers through the
 * same `clamp(delta * 2.2)` conversion src/ui/stick.ts feeds the scene — and
 * every pertrecho it earns comes out of a real `mob-killed` or `looted` event
 * from a real `stepVoyage`.
 */

/** Takes whatever the offer's first card is, over and over, until the voyage
 *  runs out of pertrechos to spend. The greedy player, for pool tests.
 *
 *  It earns exactly as far as the ladder can be walked — `threshold(POOL_LEVELS)`
 *  — because that is what emptying the pool costs and a smaller number would
 *  quietly be testing a HALF-drained pool. */
function takeAll(seed: string, upTo = threshold(POOL_LEVELS)): PertrechosState {
  let state = startPertrechos(seed);
  for (let earned = 1; earned <= upTo; earned++) {
    state = earn(state, 1);
    while (state.offer) {
      const first = state.offer.cards[0].id;
      state = takeOffer(state, first).pertrechos;
    }
  }
  return state;
}

describe('pertrechos · the pool', () => {
  test('every entry maps onto a loadout field, and moves it', () => {
    for (const spec of PERTRECHOS) {
      const fields = [
        ...Object.keys(spec.mul ?? {}), ...Object.keys(spec.add ?? {}), ...Object.keys(spec.set ?? {}),
      ];
      ok(fields.length > 0, `${spec.id} changes nothing at all`);
      const neutral = emptyLoadout();
      const one = loadoutOf([spec.id]);
      let moved = 0;
      for (const field of fields as (keyof Loadout)[]) {
        ok(field in neutral, `${spec.id} names ${field}, which is not a loadout field`);
        if (one[field] !== neutral[field]) moved++;
      }
      eq(moved, fields.length, `${spec.id} declares a field it does not actually move`);
    }
  });

  test('no entry is a downgrade printed as an upgrade', () => {
    // The two multipliers that measure a COST rather than a virtue. Anything
    // above 1 on these is a card that makes the ship worse while claiming not to.
    for (const spec of PERTRECHOS) {
      const cost = spec.mul ?? {};
      if (cost.reload !== undefined) ok(cost.reload < 1, `${spec.id} makes reloading slower`);
      if (cost.tideRate !== undefined) ok(cost.tideRate < 1, `${spec.id} makes the tide rise faster`);
      for (const [field, factor] of Object.entries(cost)) {
        if (field === 'reload' || field === 'tideRate') continue;
        ok(factor > 1, `${spec.id} multiplies ${field} by ${factor}`);
      }
    }
  });

  test('every card carries a name and one line short enough to read', () => {
    for (const spec of PERTRECHOS) {
      ok(spec.name.length > 0 && spec.name.length <= 26, `${spec.id}: name "${spec.name}"`);
      ok(spec.line.length > 0 && spec.line.length <= 56, `${spec.id}: line is ${spec.line.length} chars`);
      ok(spec.line.endsWith('.'), `${spec.id}: the line is a sentence`);
      ok(spec.stacks >= 1 && spec.stacks <= 3, `${spec.id}: stacks ${spec.stacks}`);
    }
    eq(new Set(PERTRECHOS.map((p) => p.id)).size, PERTRECHOS.length, 'two entries share an id');
    eq(new Set(PERTRECHOS.map((p) => p.name)).size, PERTRECHOS.length, 'two entries share a name');
  });

  test('SEA_PLAY.md\'s eight are all present', () => {
    for (const id of ['metralla', 'palanqueta', 'polvora', 'cobre', 'artilleros',
      'arpon', 'contramaestre', 'bodega'] as PertrechoId[]) {
      ok(pertrechoById(id) !== null, `the pool is missing ${id}`);
    }
  });
});

describe('pertrechos · the offer is deterministic per seed', () => {

  test('the same seed offers the same first three, every time', () => {
    for (const seed of ['la-leyenda', 'abc', 'zzz-9', 'voyage-42']) {
      const a = offerFor(seed, 1, []);
      const b = offerFor(seed, 1, []);
      eq(a.map((c) => c.id).join(','), b.map((c) => c.id).join(','), `seed ${seed} drew twice`);
    }
  });

  test('a replayed voyage offers the same choices all the way down', () => {
    const play = (seed: string): string[] => {
      let state = startPertrechos(seed);
      const seen: string[] = [];
      for (let i = 0; i < 200; i++) {
        state = earn(state, 1);
        if (!state.offer) continue;
        seen.push(`${state.offer.index}:${state.offer.cards.map((c) => `${c.id}${c.level}`).join('|')}`);
        // A player who always takes the middle card — any fixed policy will do,
        // as long as the replay makes the same choices.
        const pick = state.offer.cards[Math.min(1, state.offer.cards.length - 1)].id;
        state = takeOffer(state, pick).pertrechos;
      }
      return seen;
    };
    eq(play('la-leyenda').join('\n'), play('la-leyenda').join('\n'), 'the same voyage diverged');
    ok(play('la-leyenda').join('\n') !== play('otra-mar').join('\n'), 'two seeds offered the same run');
  });

  test('different seeds mostly draw different hands', () => {
    const hands = new Set<string>();
    for (let i = 0; i < 60; i++) hands.add(offerFor(`s${i}`, 1, []).map((c) => c.id).sort().join(','));
    // 10 choose 3 is 120 hands, so 60 seeds cannot fill it; what this catches is
    // a stream that ignores the seed and answers the same thing every time.
    ok(hands.size >= 20, `60 seeds drew only ${hands.size} distinct hands`);
  });

  test('the offer does not depend on WHEN the threshold was crossed', () => {
    // One big earn versus a hundred small ones. Same cards, or the offer is a
    // function of the voyage's history rather than of its seed.
    const slow = (() => {
      let s = startPertrechos('tempo');
      for (let i = 0; i < 100; i++) s = earn(s, 1);
      return s;
    })();
    const fast = earn(startPertrechos('tempo'), 100);
    eq(
      fast.offer?.cards.map((c) => c.id).join(',') ?? '',
      slow.offer?.cards.map((c) => c.id).join(',') ?? '',
      'the same total earned two different offers'
    );
  });
});

describe('pertrechos · three distinct options', () => {

  test('every offer of a full pool is three, and no two the same', () => {
    for (let i = 0; i < 120; i++) {
      const cards = offerFor(`seed${i}`, 1 + (i % 5), []);
      eq(cards.length, 3, `seed${i} offered ${cards.length}`);
      eq(new Set(cards.map((c) => c.id)).size, 3, `seed${i} offered a duplicate`);
    }
  });

  test('a card names the stack it would put you on', () => {
    // Two levels of artilleros in the bag: the next offer that carries it must
    // say III, and it must be the last time it is ever offered.
    const bag: PertrechoId[] = ['artilleros', 'artilleros'];
    let sawThird = false;
    for (let i = 1; i < 400; i++) {
      const card = offerFor('stacks', i, bag).find((c) => c.id === 'artilleros');
      if (!card) continue;
      eq(card.level, 3, 'a third artilleros was offered at the wrong level');
      eq(card.stacks, 3, 'the card lost its ceiling');
      sawThird = true;
    }
    ok(sawThird, 'artilleros was never offered again with two taken');
    // And with all three taken it is gone.
    for (let i = 1; i < 400; i++) {
      ok(
        !offerFor('stacks', i, ['artilleros', 'artilleros', 'artilleros']).some((c) => c.id === 'artilleros'),
        'a maxed artilleros was offered again'
      );
    }
  });

  test('a one-shot pertrecho is never offered twice', () => {
    for (const id of PERTRECHOS.filter((p) => p.stacks === 1).map((p) => p.id)) {
      for (let i = 1; i < 200; i++) {
        ok(!offerFor(`once${i}`, i, [id]).some((c) => c.id === id), `${id} came round again`);
      }
    }
  });
});

describe('pertrechos · the pool drains', () => {

  test('a greedy voyage empties it exactly once and then stops', () => {
    const state = takeAll('vaciar');
    eq(state.taken.length, POOL_LEVELS, 'the drained pool did not hand over every level');
    eq(state.offer, null, 'an offer survived the empty pool');
    for (const spec of PERTRECHOS) {
      eq(levelOf(state.taken, spec.id), spec.stacks, `${spec.id} did not reach its ceiling`);
    }
  });

  test('the last offers shrink rather than repeat', () => {
    // The offer's size is bounded by how many pertrechos are still ELIGIBLE, not
    // by how many levels are left in them — three cards need three different
    // things to put on them. So max out all but the last `left` of the pool and
    // count: three, two, one, none, and never a padded three with a repeat in it.
    const maxOut = (keep: number): PertrechoId[] => {
      const bag: PertrechoId[] = [];
      const spare = PERTRECHOS.slice(PERTRECHOS.length - keep).map((p) => p.id);
      for (const spec of PERTRECHOS) {
        if (spare.includes(spec.id)) continue;
        for (let i = 0; i < spec.stacks; i++) bag.push(spec.id);
      }
      return bag;
    };
    const sizes = [3, 2, 1, 0].map((left) => {
      const cards = offerFor('shrink', 1, maxOut(left));
      eq(new Set(cards.map((c) => c.id)).size, cards.length, `a repeat with ${left} left`);
      return cards.length;
    });
    eq(sizes.join(','), '3,2,1,0', 'the tail of the pool did not shrink cleanly');
  });

  test('a spent pool does not stall the ladder', () => {
    // Past the end, earning goes on consuming thresholds instead of rebuilding
    // an empty offer for the rest of the voyage.
    let state = takeAll('gastado');
    const offersAtEnd = state.offers;
    state = earn(state, 5000);
    ok(state.offers > offersAtEnd, 'the ladder froze once the pool was spent');
    eq(state.offer, null, 'an empty pool raised an offer anyway');
  });
});

describe('pertrechos · taking one changes the loadout it claims to', () => {

  test('a voyage with nothing taken sails exactly the ship balance.json describes', () => {
    const empty = emptyLoadout();
    for (const type of Object.keys(SHIPS)) {
      eq(JSON.stringify(rigged(type, empty)), JSON.stringify(SHIPS[type]), `${type} moved`);
    }
    eq(JSON.stringify(loadoutOf([])), JSON.stringify(empty), 'an empty build is not neutral');
  });

  test('metralla opens the broadside, and the trade is the sea\'s to measure', () => {
    const l = loadoutOf(['metralla']);
    eq(l.spread, true, 'metralla did not open the broadside');
    // How many balls, across what fan, for what fraction of a ball's bite is
    // `sea.loadout.spread` in balance.json and is asserted where it is applied
    // — sea.test.ts, "grape spreads the broadside: more balls, each for less".
    // A second copy of those numbers here is exactly the duplication that made
    // this module ship a loadout nothing read.
    eq(JSON.stringify(rigged('skiff', l)), JSON.stringify(SHIPS.skiff), 'and moves no hull number');
    eq(levelOf(['metralla'], 'metralla'), 1, 'a flag has one level and no more');
  });

  test('brigada de artilleros stacks three times, and each one is faster', () => {
    const one = rigged('skiff', loadoutOf(['artilleros']));
    const two = rigged('skiff', loadoutOf(['artilleros', 'artilleros']));
    const three = rigged('skiff', loadoutOf(['artilleros', 'artilleros', 'artilleros']));
    ok(one.reload < SHIPS.skiff.reload, 'level I did not speed the reload');
    ok(two.reload < one.reload && three.reload < two.reload, 'the stack stopped paying');
    near(three.reload, 1.7 * 0.84 ** 3, 1e-9, 'three levels of artilleros');
    // And a fourth is unreachable: the offer never carries it.
    eq(levelOf(['artilleros', 'artilleros', 'artilleros'], 'artilleros'), 3, 'level count');
  });

  test('the other seven land on the fields their line promises', () => {
    const skiff = SHIPS.skiff;
    ok(rigged('skiff', loadoutOf(['polvora'])).range > skiff.range, 'pólvora fina: reach');
    ok(rigged('skiff', loadoutOf(['cobre'])).speed > skiff.speed, 'fondo de cobre: speed');
    ok(rigged('skiff', loadoutOf(['cobre'])).turn > skiff.turn, 'fondo de cobre: gobierno');
    ok(rigged('skiff', loadoutOf(['carpintero'])).repair > skiff.repair, 'carpintero: patching');
    ok(rigged('skiff', loadoutOf(['estiba'])).hold > skiff.hold, 'estiba: hold');
    ok(loadoutOf(['palanqueta']).chainSlow > 0, 'palanqueta: the slow');
    ok(loadoutOf(['arpon']).harpoon > 0, 'arpón: pull');
    ok(loadoutOf(['contramaestre']).tideRate < 1, 'contramaestre: tide');
    ok(loadoutOf(['bodega']).holdGuard > 0, 'bodega falsa: what comes up with the crew');
    // The guard is a share ADDED to sea.landfall.sunk (0.5) and must not be
    // able to carry that past a whole hold on its own.
    ok(0.5 + loadoutOf(['bodega']).holdGuard <= 1, 'bodega falsa banks more than the hold');
  });

  test('the hold is a whole number of units, because cargo is counted in them', () => {
    const stowed = rigged('skiff', loadoutOf(['estiba', 'estiba']));
    eq(stowed.hold, Math.round(stowed.hold), 'a fractional hold');
    eq(stowed.hold, Math.round(900 * 1.22 * 1.22), 'two levels of estiba');
  });

  test('the cached loadout is never out of step with what was taken', () => {
    let state = startPertrechos('cache');
    for (let i = 0; i < 300; i++) {
      state = earn(state, 1);
      if (!state.offer) continue;
      state = takeOffer(state, state.offer.cards[i % state.offer.cards.length].id).pertrechos;
      eq(JSON.stringify(state.loadout), JSON.stringify(loadoutOf(state.taken)), 'the cache drifted');
    }
    ok(state.taken.length > 0, 'nothing was ever taken');
  });

  test('an id that is not on the table is refused, not applied', () => {
    let state = earn(startPertrechos('refuse'), 999);
    ok(state.offer !== null, 'no offer to refuse from');
    const notOffered = PERTRECHOS.map((p) => p.id).find((id) => !canTake(state, id))!;
    const result = takeOffer(state, notOffered);
    eq(result.taken, null, 'an unoffered pertrecho was handed over');
    eq(result.pertrechos, state, 'a refused take still changed the state');
    eq(result.pertrechos.offer, state.offer, 'a refused take cleared the table');
    // And so is a name this build has never heard of.
    eq(takeOffer(state, 'cañón láser').taken, null, 'an invented id was accepted');
    // The offered one goes through.
    state = takeOffer(state, state.offer!.cards[0].id).pertrechos;
    eq(state.taken.length, 1, 'an offered pertrecho was refused');
  });
});

describe('pertrechos · the ladder and the queue', () => {

  test('thresholds rise, and the first one is reachable on a first voyage', () => {
    eq(threshold(0), 0, 'nothing costs nothing');
    ok(threshold(1) <= 6, `the first choice costs ${threshold(1)} — too far for a first voyage`);
    for (let n = 1; n < 12; n++) {
      ok(threshold(n + 1) > threshold(n), `threshold ${n + 1} is not past ${n}`);
      ok(
        threshold(n + 1) - threshold(n) > threshold(n) - threshold(n - 1),
        `the ladder stopped steepening at ${n}`
      );
    }
  });

  test('a kill and a taking are what pay, and nothing else is', () => {
    eq(earnedBy({ kind: 'mob-killed', mob: 'hammerdead', x: 0, y: 0, ring: 3, loot: {} }), 3, 'hammerdead');
    eq(earnedBy({ kind: 'looted', site: 'wreck', loot: {}, x: 0, y: 0 }), 4, 'wreck');
    eq(earnedBy({ kind: 'looted', site: 'reef', loot: {}, x: 0, y: 0 }), 0, 'a reef is not a site');
    eq(earnedBy({ kind: 'home' }), 0, 'coming home paid pertrechos');
    eq(earnedBy({ kind: 'hold-full' }), 0, 'a full hold paid pertrechos');
    eq(earnedBy({ kind: 'deep-chest', x: 0, y: 0, loot: {} }), 0, 'the chest paid twice for one squid');
    // The boss is worth a fight's worth on its own, and the ring never changes
    // what anything pays — deep water already pays more in cargo.
    ok(KILL_VALUE.squid >= 4 * KILL_VALUE.hammerdead, 'the squid does not pay like a boss');
    eq(
      earnedBy({ kind: 'mob-killed', mob: 'blowfish', x: 0, y: 0, ring: 1, loot: {} }),
      earnedBy({ kind: 'mob-killed', mob: 'blowfish', x: 0, y: 0, ring: 5, loot: {} }),
      'a deep blowfish paid more than a shallow one'
    );
    ok(SITE_VALUE.lair > SITE_VALUE.wreck && SITE_VALUE.wreck > SITE_VALUE.harvest, 'site order');
  });

  test('one decision on the table at a time, and the rest queue', () => {
    // Enough for four choices in one breath. Exactly one card set comes up.
    let state = earn(startPertrechos('cola'), threshold(4));
    eq(state.offer?.index, 1, 'the queue jumped the first choice');
    eq(state.offers, 1, 'more than one offer was raised at once');
    state = earn(state, 1);
    eq(state.offer?.index, 1, 'a second offer landed on top of the first');
    // Answering one brings the next up immediately — the player is already past
    // its threshold and should not have to go and earn again for it.
    state = takeOffer(state, state.offer!.cards[0].id).pertrechos;
    eq(state.offer?.index, 2, 'the queue did not advance on a take');
    state = takeOffer(state, state.offer!.cards[0].id).pertrechos;
    eq(state.offer?.index, 3, 'the queue stopped after two');
  });

  test('progress reads the bar the HUD would draw', () => {
    let state = startPertrechos('barra');
    eq(progress(state).to, threshold(1), 'the first bar does not end at the first choice');
    near(progress(state).fraction, 0, 1e-9, 'an untouched bar is not empty');
    state = earn(state, threshold(1) - 1);
    ok(progress(state).fraction > 0.5, 'the bar did not fill');
    eq(progress(state).picks, 0, 'picks counted before anything was taken');
    state = takeOffer(earn(state, 1), earn(state, 1).offer!.cards[0].id).pertrechos;
    eq(progress(state).picks, 1, 'a taken pertrecho was not counted');
    eq(progress(state).from, threshold(1), 'the bar did not move on to the next rung');
  });

  test('the end-of-voyage list groups a stack instead of repeating it', () => {
    const state = takeAll('lista');
    const list = takenList(state);
    eq(list.length, PERTRECHOS.length, 'the list did not group');
    for (const entry of list) eq(entry.level, entry.spec.stacks, `${entry.spec.id} listed at the wrong level`);
  });

  test('noteEvents folds a step of the sea straight in', () => {
    const state = noteEvents(startPertrechos('eventos'), [
      { kind: 'fired', side: 'port', x: 0, y: 0 },
      { kind: 'mob-killed', mob: 'kelpling', x: 0, y: 0, ring: 2, loot: {} },
      { kind: 'looted', site: 'islet', loot: {}, x: 0, y: 0 },
      { kind: 'home' },
    ]);
    eq(state.earned, KILL_VALUE.kelpling + SITE_VALUE.islet, 'the fold did not add up');
  });
});

/* --------------------------------------------------------------------------
 * A FULL RUN, played rather than imagined
 * ----------------------------------------------------------------------- */

const TAU = Math.PI * 2;
function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * One real voyage, with its pertrechos counted off real events.
 *
 * The pilot is the shape of tools/tests/voyages.ts's: head for the nearest thing
 * worth taking that is not a boss lair, stand out to sea when there is nothing
 * in sight, steer round the rocks, and turn for home when the hull is at 45% or
 * the hold is full. It steers through `clamp(delta * 2.2)`, which is what
 * seaScene turns a thumb into — a pilot that can hold a rudder better than the
 * input device allows would be measuring a game nobody can play.
 */
function playForPicks(seed: string, ring: number, shipType = 'skiff'): { picks: number; seconds: number } {
  const spec = SHIPS[shipType];
  const rng = new Rng(`${seed}:pilot`);
  const course = rng.range(-Math.PI, Math.PI);
  const sweep = rng.chance(0.5) ? 1 : -1;
  let home = false;
  let v: Voyage = startVoyage(seed, shipType);
  let p = startPertrechos(seed);
  const ringAt = (at: Voyage) => ringOf(Math.round(at.x / SEA_CELL), Math.round(at.y / SEA_CELL));
  let steps = 0;
  const limit = Math.round(300 / SEA_STEP);

  for (steps = 0; steps < limit; steps++) {
    if (v.hull / spec.hull < 0.45 || holdUsed(v) >= spec.hold) home = true;
    const near = sitesNear(v.seed, v.x, v.y, SEA_RANGE);
    let aim: number;
    if (home) {
      aim = Math.atan2(-v.y, -v.x);
    } else {
      let target: Site | null = null;
      let best = Infinity;
      for (const site of near) {
        if (site.kind === 'reef' || site.kind === 'lair') continue;
        if (site.ring > ring || v.taken.includes(site.id)) continue;
        const d = Math.hypot(site.x - v.x, site.y - v.y);
        if (d < best) { best = d; target = site; }
      }
      if (target) {
        aim = Math.atan2(target.y - v.y, target.x - v.x);
      } else if (ringAt(v) < ring) {
        aim = course;
      } else {
        const outward = Math.atan2(v.y, v.x);
        const tangent = outward + sweep * (Math.PI / 2);
        aim = ringAt(v) > ring ? tangent + angleDelta(tangent, outward + Math.PI) * 0.8 : tangent;
      }
      for (const site of near) {
        if (site.kind !== 'reef') continue;
        if (Math.hypot(site.x - v.x, site.y - v.y) > site.radius + spec.radius + 34) continue;
        const bearing = Math.atan2(site.y - v.y, site.x - v.x);
        const off = angleDelta(bearing, aim);
        if (Math.abs(off) > 1) continue;
        aim = bearing + Math.sign(off || 1);
      }
    }
    v = steer(v, { turn: Math.max(-1, Math.min(1, angleDelta(v.heading, aim) * 2.2)), throttle: 1 });
    const out = stepVoyage(v);
    v = out.voyage;
    p = noteEvents(p, out.events);
    // The player answers whatever is on the table. WHICH card is taken cannot
    // change how many arrive, so the policy here is not a balance decision.
    while (p.offer) p = takeOffer(p, p.offer.cards[0].id).pertrechos;
    if (v.sunk || v.home) break;
  }
  return { picks: p.taken.length, seconds: (steps + 1) * SEA_STEP };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

describe('pertrechos · a full run reaches a sensible number of picks', () => {

  test('a day-one skiff comes home having made two to four choices', () => {
    for (const ring of [1, 2, 3]) {
      const runs = Array.from({ length: 24 }, (_, i) => playForPicks(`picks-r${ring}-${i}`, ring));
      const picks = runs.map((r) => r.picks);
      const mid = median(picks);
      ok(mid >= 2 && mid <= 4, `ring ${ring}: median ${mid} picks over ${runs.length} voyages`);
      ok(Math.max(...picks) <= POOL_LEVELS, `ring ${ring}: ${Math.max(...picks)} picks, past the pool`);
      // A voyage that offers nothing at all is the failure this whole system
      // exists to prevent, and it must not happen to a whole fleet.
      ok(picks.filter((n) => n === 0).length <= runs.length / 4, `ring ${ring}: too many empty voyages`);
    }
  });

  test('a bigger hull sails longer and therefore builds further', () => {
    const skiff = Array.from({ length: 16 }, (_, i) => playForPicks(`hull-s${i}`, 3, 'skiff'));
    const galleon = Array.from({ length: 16 }, (_, i) => playForPicks(`hull-g${i}`, 4, 'galleon'));
    const a = median(skiff.map((r) => r.picks));
    const b = median(galleon.map((r) => r.picks));
    ok(b > a, `galleon ${b} picks vs skiff ${a} — the build does not follow the hull`);
    ok(b <= POOL_LEVELS, `galleon ran past the pool with ${b}`);
  });
});
