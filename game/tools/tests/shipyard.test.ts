import {
  SHIP_ORDER, SHIPYARD_BUILDING, flagship, nextShip, ownedShips, ownsShip, shipForVoyage,
  shipSpec, shipyardLevel,
} from '../../src/sim/shipyard';
import { MOBS, SHIPS, holdUsed, startVoyage, steer, stepVoyage } from '../../src/sim/sea';
import {
  buildingSpec, place, startUpgrade, tick, townHallLevel, type GameState,
} from '../../src/sim';
import { describe, eq, ok, test } from './harness';
import { find, game, rich } from './fixtures';

/**
 * The shipyard — PLAN.md Fase 4's ladder, proven headlessly.
 *
 * The design under test is one sentence: ownership IS the Astillero's level,
 * the purchase IS the ordinary upgrade, and the next voyage sails the best
 * hull owned. No second ledger, no migration, no way to drift. So the proof
 * has to walk the REAL flow — raise the hall, place the yard, pay the rows,
 * serve the timers — and watch the fleet grow out of it.
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
    for (const ship of SHIP_ORDER) {
      const spec = SHIPS[ship];
      ok(!!spec, `${ship} is in the sea's own table`);
      for (const [key, value] of Object.entries(spec)) {
        ok(typeof value === 'number' && value > 0, `${ship}.${key} is a real number`);
      }
    }
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

  test('the prices are the long-arc sink: each rung at least doubles the gold', () => {
    const rows = buildingSpec(SHIPYARD_BUILDING).levels;
    eq(rows.length, SHIP_ORDER.length, 'one price row per hull');
    for (let i = 2; i < rows.length; i++) {
      const below = rows[i - 1].cost.oro ?? 0;
      const above = rows[i].cost.oro ?? 0;
      ok(above >= below * 2, `rung ${i + 1} (${above}) is at least double rung ${i} (${below})`);
    }
    ok((rows[rows.length - 1].cost.oro ?? 0) >= 450_000, 'and the marauder is a real campaign');
  });
});

describe('ownership is the shipyard, and nothing else', () => {
  test('a day-one island owns no hull at all', () => {
    const fresh = game('day-one');
    eq(shipyardLevel(fresh), 0, 'no yard standing');
    eq(ownedShips(fresh).length, 0, 'no fleet');
    eq(flagship(fresh), null, 'no flagship');
    eq(shipForVoyage(fresh), 'skiff', 'but a voyage forced anyway falls back to the skiff');
    const first = nextShip(fresh);
    ok(first !== null && first.ship === 'skiff' && first.level === 1, 'the first purchase on offer is the skiff');
    eq(first?.hallNeeded, 3, 'and it names the hall that opens the yard');
  });

  test('the whole ladder, bought through the real flow, rung by rung', () => {
    for (const level of [1, 3, 5]) {
      const s = withYard(level);
      eq(shipyardLevel(s), level, `the yard stands at ${level}`);
      eq(ownedShips(s).length, level, 'one hull per rung paid');
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
