import {
  MOBS, SEA_CELL, SEA_STEP, SHIPS, bearingHome, holdUsed, mobsAt, ringOf, siteAt,
  startVoyage, steer, stepVoyage, type SeaEvent, type Voyage,
} from '../../src/sim/sea';
import { landCargoInPlace, storeCap } from '../../src/sim';
import { clone } from '../../src/sim/economy';
import { describe, eq, near, ok, test } from './harness';
import { quiet } from './fixtures';

/**
 * The voyage is the half of the game PLAN.md calls Fase 2, and the half that
 * has no screen to be inspected on yet. Everything it promises has to be
 * provable here or it is not provable anywhere.
 */

/** Runs `seconds` of voyage with a fixed helm, collecting every event. */
function sail(v: Voyage, seconds: number, helm?: { turn?: number; throttle?: number }): {
  voyage: Voyage; events: SeaEvent[];
} {
  let voyage = helm ? steer(v, helm) : v;
  const events: SeaEvent[] = [];
  for (let i = 0; i < Math.round(seconds / SEA_STEP); i++) {
    const out = stepVoyage(voyage);
    voyage = out.voyage;
    events.push(...out.events);
  }
  return { voyage, events };
}

describe('the world is a function of the seed', () => {
  test('the same cell answers the same way however many times it is asked', () => {
    for (const [cx, cy] of [[1, 0], [3, -2], [7, 7], [-4, 5]]) {
      const a = siteAt('la-leyenda', cx, cy);
      const b = siteAt('la-leyenda', cx, cy);
      eq(JSON.stringify(a), JSON.stringify(b), `cell ${cx},${cy} is stable`);
    }
  });

  test('a different seed gives a different sea', () => {
    let differences = 0;
    for (let cx = -4; cx <= 4; cx++) {
      for (let cy = -4; cy <= 4; cy++) {
        if (JSON.stringify(siteAt('a', cx, cy)) !== JSON.stringify(siteAt('b', cx, cy))) differences++;
      }
    }
    ok(differences > 20, `two seeds disagree about the sea (${differences} of 81 cells)`);
  });

  test('home water is clear, so a voyage can always begin and end', () => {
    eq(siteAt('la-leyenda', 0, 0), null, 'nothing is moored on top of the harbour');
    eq(mobsAt('la-leyenda', 0, 0, 1).length, 0, 'and nothing patrols it');
  });

  test('a site never straddles the cell that produced it', () => {
    for (let cx = -6; cx <= 6; cx++) {
      for (let cy = -6; cy <= 6; cy++) {
        const site = siteAt('la-leyenda', cx, cy);
        if (!site) continue;
        const dx = Math.abs(site.x - cx * SEA_CELL);
        const dy = Math.abs(site.y - cy * SEA_CELL);
        ok(
          dx + site.radius < SEA_CELL / 2 && dy + site.radius < SEA_CELL / 2,
          `site at ${cx},${cy} stays inside its own cell`
        );
      }
    }
  });
});

describe('distance is difficulty', () => {
  test('rings grow outward from home in every direction', () => {
    eq(ringOf(0, 0), 0, 'home is ring 0');
    eq(ringOf(-3, 1), 3, 'the ring is the larger axis, so it is a square shell');
  });

  test('the far sea pays more than the near sea', () => {
    const payout = (ring: number) => {
      let total = 0;
      for (let cx = -ring; cx <= ring; cx++) {
        for (let cy = -ring; cy <= ring; cy++) {
          if (ringOf(cx, cy) !== ring) continue;
          const site = siteAt('la-leyenda', cx, cy);
          if (site) total += Object.values(site.loot).reduce((a, b) => a + b, 0);
        }
      }
      return total / Math.max(1, 8 * ring);
    };
    const near1 = payout(1);
    const far = payout(5);
    ok(far > near1 * 2, `ring 5 pays far more per cell than ring 1 (${far.toFixed(0)} vs ${near1.toFixed(0)})`);
  });

  test('the far sea is also worse to be in', () => {
    const threat = (ring: number) => {
      let hp = 0;
      let cells = 0;
      for (let cx = -ring; cx <= ring; cx++) {
        for (let cy = -ring; cy <= ring; cy++) {
          if (ringOf(cx, cy) !== ring) continue;
          cells++;
          for (const mob of mobsAt('la-leyenda', cx, cy, 1)) hp += MOBS[mob.kind].hp;
        }
      }
      return hp / cells;
    };
    ok(threat(4) > threat(1) * 2, `ring 4 is much deadlier per cell than ring 1`);
  });

  test('ring 1 is thin enough for a first voyage to survive it', () => {
    let worst = 0;
    for (let cx = -1; cx <= 1; cx++) {
      for (let cy = -1; cy <= 1; cy++) {
        if (ringOf(cx, cy) !== 1) continue;
        worst = Math.max(worst, mobsAt('la-leyenda', cx, cy, 1).length);
      }
    }
    ok(worst <= 2, `no ring-1 cell holds more than two enemies (worst was ${worst})`);
  });
});

describe('the ship', () => {
  test('a voyage with the same inputs replays exactly', () => {
    const a = sail(startVoyage('replay'), 12, { turn: 0.3, throttle: 1 }).voyage;
    const b = sail(startVoyage('replay'), 12, { turn: 0.3, throttle: 1 }).voyage;
    eq(a.x, b.x, 'same seed, same helm, same position');
    eq(a.y, b.y, 'on both axes');
    eq(a.hull, b.hull, 'and the same damage taken');
  });

  test('it accelerates rather than jumping to top speed', () => {
    const spec = SHIPS.skiff;
    const early = sail(startVoyage('accel'), 0.5, { throttle: 1 }).voyage;
    ok(early.speed < spec.speed * 0.6, 'half a second in, it is still building way');
    const later = sail(startVoyage('accel'), 6, { throttle: 1 }).voyage;
    near(later.speed, spec.speed, 0.5, 'six seconds in, it is at top speed');
  });

  test('a ship dead in the water barely turns', () => {
    const stopped = sail(startVoyage('turn'), 2, { turn: 1, throttle: 0 }).voyage;
    const moving = sail(startVoyage('turn'), 2, { turn: 1, throttle: 1 }).voyage;
    ok(
      Math.abs(moving.heading) > Math.abs(stopped.heading) * 1.8,
      'making way is what lets the rudder bite'
    );
  });

  test('the helm cannot be pushed past its stops', () => {
    const v = steer(startVoyage('clamp'), { turn: 8, throttle: 40 });
    eq(v.helm.turn, 1, 'hard over is hard over');
    eq(v.helm.throttle, 1, 'and full is full');
  });
});

describe('combat', () => {
  /** Puts a mob at a bearing off the ship and runs until something happens. */
  function withMob(bearing: number, distance: number, seconds = 4) {
    const v = startVoyage('combat');
    v.mobs.push({
      id: 99, kind: 'blowfish', x: Math.cos(bearing) * distance, y: Math.sin(bearing) * distance,
      heading: 0, hp: 999, state: 'patrol', cooldown: 0,
      homeX: Math.cos(bearing) * distance, homeY: Math.sin(bearing) * distance,
      tether: 0, cell: '9:9',
    });
    // `seen` blocks the spawner so the fight is only the mob under test.
    for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) v.seen.push(`${cx}:${cy}`);
    return sail(v, seconds, { throttle: 0 });
  }

  test('a target on the beam is fired on', () => {
    const { events } = withMob(Math.PI / 2, 30);
    const fired = events.filter((e) => e.kind === 'fired');
    ok(fired.length > 0, 'the starboard battery went off by itself');
    eq(fired[0].kind === 'fired' && fired[0].side, 'starboard', 'and it was the side facing the target');
  });

  test('a target dead ahead is not', () => {
    const { events } = withMob(0, 30);
    eq(events.filter((e) => e.kind === 'fired').length, 0, 'the bow has no guns, which is the whole point');
  });

  test('a target out of range is not, however well placed', () => {
    const { events } = withMob(Math.PI / 2, SHIPS.skiff.range + 25);
    eq(events.filter((e) => e.kind === 'fired').length, 0, 'range still applies on the beam');
  });

  test('a broadside actually connects', () => {
    const { events } = withMob(Math.PI / 2, 30, 6);
    ok(events.some((e) => e.kind === 'hit' && e.target === 'mob'), 'the shot reached what it was aimed at');
  });

  test('enough hits sink a mob', () => {
    const v = startVoyage('kill');
    v.mobs.push({
      id: 1, kind: 'blowfish', x: 0, y: 28, heading: 0, hp: MOBS.blowfish.hp,
      state: 'patrol', cooldown: 0, homeX: 0, homeY: 28, tether: 0, cell: '0:1',
    });
    for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) v.seen.push(`${cx}:${cy}`);
    const { events } = sail(v, 14, { throttle: 0 });
    ok(events.some((e) => e.kind === 'mob-killed'), 'the blowfish went down');
  });
});

describe('mobs', () => {
  test('one that has not seen you patrols, and one that has gives chase', () => {
    const make = (distance: number) => {
      const v = startVoyage('ai');
      v.mobs.push({
        id: 1, kind: 'kelpling', x: distance, y: 0, heading: Math.PI, hp: 999,
        state: 'patrol', cooldown: 0, homeX: distance, homeY: 0, tether: 0, cell: '1:0',
      });
      for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) v.seen.push(`${cx}:${cy}`);
      return sail(v, 1, { throttle: 0 }).voyage.mobs[0];
    };
    eq(make(MOBS.kelpling.sight + 40).state, 'patrol', 'far away it has not noticed the ship');
    eq(make(MOBS.kelpling.sight - 8).state, 'chase', 'inside its sight it comes for you');
  });

  test('a lair guardian cannot be kited off its site', () => {
    const site = (() => {
      for (let cx = 3; cx <= 9; cx++) {
        for (let cy = -9; cy <= 9; cy++) {
          const s = siteAt('la-leyenda', cx, cy);
          if (s?.kind === 'lair') return s;
        }
      }
      return null;
    })();
    ok(site !== null, 'the sea contains at least one lair to test');
    if (!site) return;

    const v = startVoyage('la-leyenda');
    const boss = mobsAt('la-leyenda', ...(site.id.split(':').map(Number) as [number, number]), 1)[0];
    ok(boss.tether > 0, 'the guardian is tethered to its lair');

    // Stand well outside the tether and wait: it must go home, not follow.
    v.x = site.x + boss.tether + 60;
    v.y = site.y;
    v.mobs.push({ ...boss });
    for (let cx = -12; cx <= 12; cx++) for (let cy = -12; cy <= 12; cy++) v.seen.push(`${cx}:${cy}`);
    const after = sail(v, 6, { throttle: 0 }).voyage.mobs[0];
    eq(after.state, 'patrol', 'it lost interest rather than following the ship home');
  });
});

describe('loot and the hold', () => {
  test('sailing over a site takes it, once', () => {
    const site = (() => {
      for (let cx = 1; cx <= 6; cx++) {
        for (let cy = -6; cy <= 6; cy++) {
          const s = siteAt('la-leyenda', cx, cy);
          if (s && s.kind !== 'reef') return s;
        }
      }
      return null;
    })();
    ok(site !== null, 'the sea contains a site worth taking');
    if (!site) return;

    const v = startVoyage('la-leyenda');
    v.x = site.x;
    v.y = site.y;
    const first = sail(v, 1, { throttle: 0 });
    const looted = first.events.filter((e) => e.kind === 'looted');
    eq(looted.length, 1, 'it paid out exactly once');
    ok(holdUsed(first.voyage) > 0, 'and the hold has something in it');

    const second = sail(first.voyage, 2, { throttle: 0 });
    eq(second.events.filter((e) => e.kind === 'looted').length, 0, 'and it does not pay again');
  });

  test('the hold has a bottom, and says so', () => {
    const v = startVoyage('full');
    v.cargo = { oro: SHIPS.skiff.hold };
    const site = siteAt('full', 1, 0) ?? siteAt('full', 2, 0);
    if (!site || site.kind === 'reef') return;
    v.x = site.x;
    v.y = site.y;
    const { voyage, events } = sail(v, 1, { throttle: 0 });
    eq(holdUsed(voyage), SHIPS.skiff.hold, 'not one unit over the hold');
    ok(events.some((e) => e.kind === 'hold-full'), 'and the player is told why');
  });

  test('being sunk costs half the cargo and never more', () => {
    const v = startVoyage('sink');
    v.cargo = { oro: 101, madera: 40 };
    v.hull = 1;
    v.mobs.push({
      id: 1, kind: 'hammerdead', x: 4, y: 0, heading: Math.PI, hp: 999,
      state: 'attack', cooldown: 0, homeX: 4, homeY: 0, tether: 0, cell: '0:0',
    });
    for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) v.seen.push(`${cx}:${cy}`);
    const { voyage, events } = sail(v, 4, { throttle: 0 });
    ok(voyage.sunk, 'the ship went down');
    eq(voyage.cargo.oro, 51, 'an odd number rounds in the player favour');
    eq(voyage.cargo.madera, 20, 'and an even one is halved');
    ok(events.some((e) => e.kind === 'sunk'), 'and it announced itself');
  });

  test('a sunk voyage stops advancing', () => {
    const v = { ...startVoyage('dead'), sunk: true, x: 0 };
    const after = sail(steer(v, { throttle: 1 }), 3).voyage;
    eq(after.x, 0, 'a wreck does not keep sailing');
  });
});

describe('the loop closes', () => {
  test('coming back to home water is an event the island can hear', () => {
    // Well outside the harbour, pointed at it, under way.
    const out = startVoyage('home');
    out.x = SEA_CELL * 0.55;
    out.heading = Math.PI;
    for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) out.seen.push(`${cx}:${cy}`);

    const early = sail(out, 1, { throttle: 1 });
    ok(!early.events.some((e) => e.kind === 'home'), 'still at sea one second in');

    const arriving = sail(early.voyage, 4, { throttle: 1 });
    ok(arriving.events.some((e) => e.kind === 'home'), 'and it reports reaching home water');
    ok(arriving.voyage.home, 'the flag the island reads is set');
  });

  test('arriving home is announced once, not every step', () => {
    const out = startVoyage('home');
    out.x = SEA_CELL * 0.55;
    out.heading = Math.PI;
    for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) out.seen.push(`${cx}:${cy}`);
    const { events } = sail(out, 8, { throttle: 1 });
    eq(events.filter((e) => e.kind === 'home').length, 1, 'exactly one arrival');
  });

  test('a cell is only ever stocked once per voyage', () => {
    const out = sail(startVoyage('stock'), 20, { throttle: 1 });
    const cells = new Set(out.voyage.seen);
    eq(cells.size, out.voyage.seen.length, 'no cell was spawned twice');
  });

  test('mobs left far behind do not follow', () => {
    const out = sail(startVoyage('flee'), 40, { throttle: 1 });
    for (const mob of out.voyage.mobs) {
      ok(
        Math.hypot(mob.x - out.voyage.x, mob.y - out.voyage.y) < SEA_CELL * 4,
        'nothing is still chasing from cells away'
      );
    }
  });
});

describe('the hold reaches the island', () => {
  test('cargo lands in the stores, capped like any other income', () => {
    const start = quiet();
    const before = start.store.madera;
    const cap = storeCap(start, 'madera');
    const state = clone(start);
    const { landed, spilled } = landCargoInPlace(state, { madera: 40 });
    eq(landed.madera, 40, 'forty of the wood arrived');
    eq(spilled.madera, undefined, 'and none of it spilled');
    eq(state.store.madera, before + 40, 'the store went up by exactly that');
    ok(state.store.madera <= cap, 'and stayed inside the cap');
  });

  test('what will not fit is reported rather than dropped in silence', () => {
    const state = clone(quiet());
    const cap = storeCap(state, 'madera');
    state.store.madera = cap - 10;
    const { landed, spilled } = landCargoInPlace(state, { madera: 100 });
    eq(landed.madera, 10, 'only the room that existed was filled');
    eq(spilled.madera, 90, 'and the rest is named');
    eq(state.store.madera, cap, 'the store is exactly full, never over');
  });

  test('a hold full of something the island cannot store spills entirely', () => {
    const state = clone(quiet());
    const cap = storeCap(state, 'oro');
    state.store.oro = cap;
    const { landed, spilled } = landCargoInPlace(state, { oro: 25 });
    eq(landed.oro, undefined, 'nothing landed');
    eq(spilled.oro, 25, 'all of it is accounted for');
  });
});

describe('finding the way home', () => {
  /** Where a screen-up arrow rotated clockwise by `a` actually points, in
   *  world (x, y) — the same convention the fixed-orientation camera uses. */
  const pointsAt = (a: number) => ({ x: Math.sin(a), y: -Math.cos(a) });

  test('the arrow points at the harbour from anywhere', () => {
    for (const [x, y] of [[150, 40], [-90, 0], [0, 220], [0, -70], [-30, -180], [400, -400]]) {
      const to = pointsAt(bearingHome(x, y));
      const want = { x: -x, y: -y };
      const length = Math.hypot(want.x, want.y);
      const dot = (to.x * want.x + to.y * want.y) / length;
      near(dot, 1, 1e-9, `from ${x},${y} the arrow points at the origin`);
    }
  });

  test('due east of home, the arrow points west', () => {
    const to = pointsAt(bearingHome(200, 0));
    near(to.x, -1, 1e-9, 'straight back along the x axis');
    near(to.y, 0, 1e-9, 'and not up or down it');
  });
});

describe('a swarm is a swarm, not a pile', () => {
  test('an attacking mob holds its distance instead of parking in the hull', () => {
    const v = startVoyage('spacing');
    for (let i = 0; i < 3; i++) {
      v.mobs.push({
        id: i + 1, kind: 'kelpling', x: 5 + i, y: i - 1, heading: 0, hp: 999,
        state: 'attack', cooldown: 0, homeX: 5, homeY: 0, tether: 0, cell: '0:0',
      });
    }
    for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) v.seen.push(`${cx}:${cy}`);
    // Ten seconds of being swarmed while dead in the water — the worst case.
    const after = sail(v, 10, { throttle: 0 }).voyage;
    for (const mob of after.mobs) {
      const gap = Math.hypot(mob.x - after.x, mob.y - after.y);
      ok(gap > MOBS.kelpling.radius, `a kelpling is ${gap.toFixed(1)} out, not inside the boat`);
    }
  });
});
