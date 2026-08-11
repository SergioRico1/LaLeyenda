import {
  HARBOUR_BUILDING, SHIP_ORDER, SHIPYARD_BUILDING, flagship, nextShip, ownedShips, ownsShip,
  purchaseOf, shipForVoyage, shipSpec, shipyardLevel,
} from '../../src/sim/shipyard';
import { MOBS, SHIPS, SHIP_TYPES, holdUsed, startVoyage, steer, stepVoyage } from '../../src/sim/sea';
import {
  BALANCE, buildingSpec, place, startUpgrade, tick, townHallLevel, type GameState,
} from '../../src/sim';
import { describe, eq, ok, test } from './harness';
import { find, game, quiet, rich } from './fixtures';

/**
 * The shipyard — PLAN.md Fase 4's ladder, proven headlessly.
 *
 * The design under test is one sentence: ownership IS a level row — the
 * Muelle's single level carries the free starter skiff (round 12: the sea is
 * day one), the Astillero's upper rows carry the deep four — the purchase IS
 * the ordinary build or upgrade, and the next voyage sails the best hull
 * owned. No second ledger, no migration, no way to drift. So the proof has to
 * walk the REAL flow — place the dock, raise the hall, place the yard, pay
 * the rows, serve the timers — and watch the fleet grow out of it.
 */

/** Runs the clock past a building's current job. */
function serve(state: GameState, buildingId: number): GameState {
  const building = state.buildings.find((b) => b.id === buildingId);
  if (!building?.work) throw new Error('serve: nothing under way');
  return tick(state, building.work.endsAt + 1000).state;
}

/** Refills the coffers — this suite is about the ladder, not the earning. */
function fund(state: GameState): GameState {
  return { ...state, store: { oro: 900_000, madera: 900_000, ron: 900_000, metal: 900_000 } };
}

/** The hall at `level`, through real upgrades with real timers. */
function raiseHall(state: GameState, level: number): GameState {
  let s = state;
  while (townHallLevel(s) < level) {
    s = fund(s);
    const hall = find(s, 'ayuntamiento');
    const up = startUpgrade(s, hall.id, s.now);
    if (!up.ok) throw new Error(`raiseHall: refused at ${townHallLevel(s)} (${up.refusal})`);
    s = serve(up.state, hall.id);
  }
  return s;
}

/** An island with the Astillero standing at `level`, every rung paid for. */
function withYard(level: number): GameState {
  // Hall 3 opens the yard; rungs 2..5 open at halls 4, 5, 6 and 7.
  let s = raiseHall(rich('yard'), Math.max(3, level + 2));
  s = fund(s);
  const placed = place(s, SHIPYARD_BUILDING, 31, 31, s.now);
  if (!placed.ok) throw new Error(`withYard: place refused (${placed.refusal})`);
  s = placed.state;
  const yard = find(s, SHIPYARD_BUILDING);
  s = serve(s, yard.id); // the build job — level 1, the skiff
  for (let rung = 2; rung <= level; rung++) {
    s = fund(s);
    const up = startUpgrade(s, yard.id, s.now);
    if (!up.ok) throw new Error(`withYard: rung ${rung} refused (${up.refusal})`);
    s = serve(up.state, yard.id);
  }
  return s;
}

describe('the ladder itself', () => {
  test('five classes, in PLAN.md order, and every one of them sails', () => {
    eq(JSON.stringify(SHIP_ORDER), JSON.stringify(['skiff', 'sloop', 'galleon', 'frigate', 'marauder']),
      'Skiff → Sloop → Galleon → Frigate → Marauder');
    eq(JSON.stringify(SHIP_ORDER), JSON.stringify(SHIP_TYPES),
      'and it is exactly the sea\'s own order — every hull the sea knows is purchasable');
    for (const ship of SHIP_ORDER) {
      const spec = SHIPS[ship];
      ok(!!spec, `${ship} is in the sea's own table`);
      for (const [key, value] of Object.entries(spec)) {
        ok(typeof value === 'number' && value > 0, `${ship}.${key} is a real number`);
      }
    }
  });

  test('every hull has exactly one purchase row, and the skiff\'s is the Muelle\'s', () => {
    // Round 12's design call as data: THE STARTER SKIFF SAILS FREE. Its
    // purchase row is the 300-madera, one-minute dock the tutorial has the
    // player build in their first session — not the Astillero, which now
    // gates better hulls rather than sailing at all.
    const rows = new Map<string, string>();
    for (const [building, spec] of Object.entries(BALANCE.buildings)) {
      for (const level of spec.levels) {
        if (!level.ship) continue;
        ok(!rows.has(level.ship), `${level.ship} is sold in one place only`);
        rows.set(level.ship, building);
      }
    }
    eq(rows.size, SHIP_ORDER.length, 'five hulls, five rows');
    eq(rows.get('skiff'), HARBOUR_BUILDING, 'the skiff comes with the dock');
    for (const deep of ['sloop', 'galleon', 'frigate', 'marauder']) {
      eq(rows.get(deep), SHIPYARD_BUILDING, `${deep} is the Astillero's`);
    }

    const dock = purchaseOf('skiff');
    eq(dock.level, 1, 'the dock\'s only level');
    eq(dock.cost.madera, 300, 'at the 300 madera a first session has already cleared');
    eq(buildingSpec(HARBOUR_BUILDING).unlockAtTownHall, 1, 'open from hall 1 — the sea is day one');
    // And the yard's own first level is the yard, not a hull: building it
    // buys the RIGHT to the deep ladder, not a boat the player already owns.
    ok(!buildingSpec(SHIPYARD_BUILDING).levels[0].ship, 'the Astillero\'s level 1 carries no ship');
  });

  test('every rung buys hull, guns and hold', () => {
    for (let i = 1; i < SHIP_ORDER.length; i++) {
      const below = shipSpec(SHIP_ORDER[i - 1]);
      const above = shipSpec(SHIP_ORDER[i]);
      const pair = `${SHIP_ORDER[i]} over ${SHIP_ORDER[i - 1]}`;
      ok(above.hull > below.hull, `${pair}: tougher`);
      ok(above.hold > below.hold, `${pair}: carries more`);
      ok(above.damage > below.damage, `${pair}: hits harder`);
      ok(above.range > below.range, `${pair}: shoots further`);
      ok(above.repair > below.repair, `${pair}: a bigger crew patches faster`);
    }
  });

  test('and pays for them in handling — a marauder is not a better skiff', () => {
    for (let i = 1; i < SHIP_ORDER.length; i++) {
      const below = shipSpec(SHIP_ORDER[i - 1]);
      const above = shipSpec(SHIP_ORDER[i]);
      const pair = `${SHIP_ORDER[i]} vs ${SHIP_ORDER[i - 1]}`;
      ok(above.turn < below.turn, `${pair}: answers the helm slower`);
      ok(above.accel < below.accel, `${pair}: takes longer to gather way`);
      ok(above.turnDrag > below.turnDrag, `${pair}: bleeds more speed hard over`);
    }
  });

  test('each hull is rated one ring deeper — the ladder is also the map', () => {
    // `rated` drives the sea's zone-warning (finding 6): the ring after it is
    // the first the sim announces as outranking the hull. The skiff's 2 is
    // measured, not chosen — the fleet table has rings 1-2 at 100% survival
    // with the hull barely marked, and ring 3 is where a fifth of it stays.
    eq(shipSpec('skiff').rated, 2, 'the skiff is a rings-1-and-2 boat; ring 3 is the playtest\'s ambush');
    for (let i = 1; i < SHIP_ORDER.length; i++) {
      const below = shipSpec(SHIP_ORDER[i - 1]);
      const above = shipSpec(SHIP_ORDER[i]);
      eq(above.rated, below.rated + 1, `${SHIP_ORDER[i]} is rated exactly one ring past ${SHIP_ORDER[i - 1]}`);
    }
  });

  test('nothing in the sea catches any of them in a straight line', () => {
    const fastest = Math.max(...Object.values(MOBS).map((m) => m.speed));
    for (const ship of SHIP_ORDER) {
      ok(shipSpec(ship).speed > fastest, `${ship} outruns everything (escape stays a real play)`);
    }
  });

  test('the guns scale against the mob table the way the doc claims', () => {
    const volleys = (ship: string, hp: number) => Math.ceil(hp / shipSpec(ship).damage);
    eq(volleys('skiff', MOBS.hammerdead.hp), 4, 'a skiff needs four broadsides for a hammerdead');
    eq(volleys('frigate', MOBS.hammerdead.hp), 2, 'a frigate needs two');
    ok(volleys('frigate', MOBS.squid.hp) < 10, 'a frigate pays the squid in under ten volleys');
    ok(volleys('skiff', MOBS.squid.hp) >= 20, 'a skiff is still hopelessly outgunned by the boss');
  });

  test('the prices are the long-arc sink: each paid rung at least doubles the gold', () => {
    // The free skiff does not soften the arc: the PAID ladder — the
    // Astillero's ship rows — still climbs 20k → 90k → 220k → 450k oro,
    // which is RETENTION.md's days/weeks clock untouched by round 12.
    const rungs = SHIP_ORDER
      .map((ship) => purchaseOf(ship))
      .filter((row) => row.building === SHIPYARD_BUILDING);
    eq(rungs.length, SHIP_ORDER.length - 1, 'every hull but the free skiff is the yard\'s');
    for (let i = 1; i < rungs.length; i++) {
      const below = rungs[i - 1].cost.oro ?? 0;
      const above = rungs[i].cost.oro ?? 0;
      ok(above >= below * 2, `paid rung ${i + 1} (${above}) is at least double rung ${i} (${below})`);
    }
    ok((rungs[rungs.length - 1].cost.oro ?? 0) >= 450_000, 'and the marauder is a real campaign');
  });
});

describe('ownership is a level row, and nothing else', () => {
  test('a day-one island owns no hull, and what it is offered is the dock', () => {
    const fresh = game('day-one');
    eq(shipyardLevel(fresh), 0, 'no yard standing');
    eq(ownedShips(fresh).length, 0, 'no fleet');
    eq(flagship(fresh), null, 'no flagship — ¡Zarpar! stays locked off these same rows');
    eq(shipForVoyage(fresh), 'skiff', 'but a voyage forced anyway falls back to the skiff');
    const first = nextShip(fresh);
    ok(first !== null && first.ship === 'skiff' && first.level === 1, 'the first purchase on offer is the skiff');
    eq(first?.building, HARBOUR_BUILDING, 'and it is the dock that sells it');
    eq(first?.hallNeeded, 1, 'open from hall 1 — the sea is a first-session door, not a campaign');
    eq(first?.cost.madera, 300, 'at a price the opening itself funds');
  });

  test('the dock alone puts the skiff at the helm — round 12\'s whole finding', () => {
    // A day-one hall-1 island, the Muelle placed through the real flow: pay
    // 300 madera, spend a carpenter, serve the one-minute timer. No hall 2,
    // no hall 3, no Astillero anywhere — and the ¡Zarpar! rows say boat.
    let s = quiet('dock-alone');
    s.buildings = s.buildings.filter((b) => b.type !== HARBOUR_BUILDING);
    eq(flagship(s), null, 'without the dock: no boat');
    s.store.madera = 300;

    const placed = place(s, HARBOUR_BUILDING, 16, 16, s.now);
    ok(placed.ok, `the dock goes down (${placed.refusal ?? 'ok'})`);
    s = placed.state;
    eq(townHallLevel(s), 1, 'still a hall-1 island');
    eq(s.store.madera, 0, 'the 300 was really charged');
    eq(flagship(s), null, 'mid-build is not owned: the timer is part of the price');

    s = serve(s, find(s, HARBOUR_BUILDING).id);
    eq(JSON.stringify(ownedShips(s)), JSON.stringify(['skiff']), 'served, the skiff is owned');
    eq(flagship(s), 'skiff', 'and at the helm');
    eq(shipForVoyage(s), 'skiff', 'so the first voyage sails it');
    eq(nextShip(s)?.ship, 'sloop', 'and the ladder on offer starts at the sloop');
    eq(nextShip(s)?.building, SHIPYARD_BUILDING, 'which is the Astillero\'s to sell');
    eq(nextShip(s)?.hallNeeded, 4, 'with its hall said out loud');
  });

  test('the whole ladder, bought through the real flow, rung by rung', () => {
    // `withYard` builds on the quiet fixture, whose Muelle already owns the
    // skiff — so a yard at level N (level 1 is the yard itself, ships start
    // on row 2) still owns exactly N hulls, newest at the helm.
    for (const level of [1, 3, 5]) {
      const s = withYard(level);
      eq(shipyardLevel(s), level, `the yard stands at ${level}`);
      eq(ownedShips(s).length, level, 'skiff plus one hull per paid rung');
      eq(flagship(s), SHIP_ORDER[level - 1], 'the flagship is the newest hull');
      eq(shipForVoyage(s), SHIP_ORDER[level - 1], 'and it is what the next voyage sails');
      ok(ownsShip(s, SHIP_ORDER[0]), 'buying up never loses the skiff');
      if (level < SHIP_ORDER.length) {
        ok(!ownsShip(s, SHIP_ORDER[level]), 'and nothing above the paid rung is owned');
      }
    }
  });

  test('a hull mid-upgrade is not owned until its timer is served', () => {
    let s = fund(raiseHall(withYard(1), 4));
    const yard = find(s, SHIPYARD_BUILDING);
    const up = startUpgrade(s, yard.id, s.now);
    ok(up.ok, 'the sloop purchase starts');
    s = up.state;
    eq(flagship(s), 'skiff', 'the sloop is on the slipway, not at the helm');
    ok(!ownsShip(s, 'sloop'), 'paying is not owning; the timer is part of the price');
    s = serve(s, yard.id);
    eq(flagship(s), 'sloop', 'served, she sails');
  });

  test('the hall gates the ladder — the deep hulls are a campaign, not a purchase', () => {
    const s = fund(withYard(1)); // hall 3, yard 1
    const refused = startUpgrade(s, find(s, SHIPYARD_BUILDING).id, s.now);
    ok(!refused.ok, 'the sloop cannot be bought at hall 3');
    eq(refused.refusal, 'town-hall-too-low', 'and the refusal names the actual wall');
    const offer = nextShip(s);
    eq(offer?.ship, 'sloop', 'the offer still stands');
    eq(offer?.hallNeeded, 4, 'with the hall it needs said out loud');
  });

  test('nextShip walks the ladder and runs out honestly', () => {
    const top = withYard(5);
    eq(nextShip(top), null, 'a full fleet has nothing left to buy');
    const mid = withYard(2);
    const offer = nextShip(mid);
    eq(offer?.ship, 'galleon', 'the offer is always the next rung');
    eq(JSON.stringify(offer?.cost), JSON.stringify(buildingSpec(SHIPYARD_BUILDING).levels[2].cost),
      'priced off the same row the sim will charge');
  });
});

describe('the hull actually changes the voyage', () => {
  test('a voyage starts with the hull it was given', () => {
    for (const ship of SHIP_ORDER) {
      const v = startVoyage('helm', ship);
      eq(v.shipType, ship, `sails as ${ship}`);
      eq(v.hull, SHIPS[ship].hull, 'with its own hull number');
    }
  });

  test('two hulls under the same helm are two different voyages', () => {
    const run = (ship: string) => {
      let v = steer(startVoyage('same-sea', ship), { turn: 0.4, throttle: 1 });
      for (let i = 0; i < 30 * 8; i++) v = stepVoyage(v).voyage;
      return v;
    };
    const skiff = run('skiff');
    const galleon = run('galleon');
    ok(
      Math.hypot(skiff.x - galleon.x, skiff.y - galleon.y) > 5,
      'same seed, same thumb, measurably different tracks — the stats are real'
    );
  });

  test('the bigger hold actually holds more', () => {
    const v = startVoyage('hold', 'frigate');
    v.cargo = { oro: SHIPS.skiff.hold + 500 };
    ok(holdUsed(v) < SHIPS.frigate.hold, 'a load that drowns a skiff rides easily in a frigate');
  });
});
