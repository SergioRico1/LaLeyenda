import {
  MOBS, SEA_CELL, SEA_RANGE, SEA_STEP, SHIPS, bearingHome, cellsInRing, holdUsed, mobsAt,
  ringOf, siteAt, sitesNear, startVoyage, steer, stepVoyage, type SeaEvent, type Voyage,
} from '../../src/sim/sea';
import { landCargoInPlace, storeCap } from '../../src/sim';
import { clone } from '../../src/sim/economy';
import { describe, eq, near, ok, test } from './harness';
import { quiet } from './fixtures';
import { breakOff, playFleet, straightOut, summarise } from './voyages';

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
  /**
   * These four used to walk `cx, cy` from -ring to +ring and keep the cells
   * whose ring matched, which quietly assumed one ring was one cell-shell. It
   * is not any more — a ring is a BAND of shells, because difficulty was being
   * calibrated in cells and experienced in seconds, and half a minute of open
   * throttle used to cross nine of them. Under the band curve every one of
   * these loops searched an area that could not contain the ring it was asking
   * about, and two of them divided by a cell count of zero.
   *
   * The subjects were right and are unchanged: the far sea pays more, the far
   * sea is worse to be in, ring 1 is thin. Only the way the cells are found
   * has changed, and `cellsInRing` is now the sim's own answer to that.
   */
  test('rings grow outward from home in every direction', () => {
    eq(ringOf(0, 0), 0, 'home is ring 0');
    eq(ringOf(-3, 1), ringOf(3, -1), 'the ring is the larger axis, so it is a square shell');
    eq(ringOf(-3, 1), ringOf(0, 3), 'and it does not care which axis that is');
    ok(ringOf(9, 0) > ringOf(3, 0), 'and it only grows outward');
  });

  test('a ring is thicker than a cell, so difficulty ramps at a human pace', () => {
    // 17 units a second, 55 to a cell: a ring per shell put a player nine rings
    // out in thirty seconds of holding the throttle.
    eq(ringOf(1, 0), 1, 'the first cell out is ring 1');
    eq(ringOf(2, 0), 1, 'and so is the second — ring 1 is two cells thick');
    eq(ringOf(3, 0), 2, 'ring 2 starts at three cells, about eleven seconds out');
    eq(ringOf(5, 0), 3, 'ring 3 at five, about seventeen seconds');
    eq(ringOf(8, 0), 4, 'ring 4 at eight, about twenty-seven');
    ok(ringOf(30, 0) > 5, 'and the bands keep tiling outward, so the sea stays open');
  });

  test('the far sea pays more than the near sea', () => {
    const payout = (ring: number) => {
      const cells = cellsInRing(ring);
      let total = 0;
      for (const [cx, cy] of cells) {
        const site = siteAt('la-leyenda', cx, cy);
        if (site) total += Object.values(site.loot).reduce((a, b) => a + b, 0);
      }
      return total / cells.length;
    };
    const near1 = payout(1);
    const far = payout(5);
    ok(far > near1 * 2, `ring 5 pays far more per cell than ring 1 (${far.toFixed(0)} vs ${near1.toFixed(0)})`);
  });

  test('the far sea is also worse to be in', () => {
    const threat = (ring: number) => {
      const cells = cellsInRing(ring);
      let hp = 0;
      for (const [cx, cy] of cells) {
        for (const mob of mobsAt('la-leyenda', cx, cy, 1)) hp += MOBS[mob.kind].hp;
      }
      return hp / cells.length;
    };
    ok(threat(4) > threat(1) * 2, `ring 4 is much deadlier per cell than ring 1`);
  });

  test('ring 1 is thin enough for a first voyage to survive it', () => {
    let worst = 0;
    for (const [cx, cy] of cellsInRing(1)) {
      worst = Math.max(worst, mobsAt('la-leyenda', cx, cy, 1).length);
    }
    ok(worst <= 2, `no ring-1 cell holds more than two enemies (worst was ${worst})`);
  });

  /**
   * A number nobody was watching, and it decided the whole game.
   *
   * The sim keeps two and a bit cells of sea alive around the ship, which is
   * about fifteen cells — so anything spawned per-cell is multiplied by fifteen
   * before a player sees it. Two to four in every cell put TWENTY-FOUR
   * creatures inside a screen and a half at ring 4. Nothing was individually
   * readable, the automatic broadsides had no target worth picking, and a hull
   * at 40% got out of ring 4 alive eighteen times in a hundred whatever the
   * player did. It is also twenty-four models against PLAN.md's hundred-draw-
   * call budget.
   */
  test('the sea is never so crowded that a fight stops being readable', () => {
    const reach = Math.ceil(SEA_RANGE / SEA_CELL);
    const around = (ax: number, ay: number) => {
      let awake = 0;
      for (let cx = ax - reach; cx <= ax + reach; cx++) {
        for (let cy = ay - reach; cy <= ay + reach; cy++) {
          if (Math.hypot((cx - ax) * SEA_CELL, (cy - ay) * SEA_CELL) > SEA_RANGE) continue;
          awake += mobsAt('la-leyenda', cx, cy, 1).length;
        }
      }
      return awake;
    };
    // Averaged over the whole ring rather than sampled at one spot: a single
    // cell can be a nest and that is fine, a whole band of them is not.
    const crowd = (ring: number) => {
      const cells = cellsInRing(ring);
      let total = 0;
      for (let i = 0; i < cells.length; i += Math.max(1, Math.floor(cells.length / 24))) {
        total += around(cells[i][0], cells[i][1]);
      }
      return total / Math.ceil(cells.length / Math.max(1, Math.floor(cells.length / 24)));
    };
    ok(crowd(1) <= 6, `ring 1 is calm enough to learn in (${crowd(1).toFixed(1)} awake at once)`);
    ok(crowd(5) <= 20, `even ring 5 stays countable (${crowd(5).toFixed(1)} awake at once)`);
    ok(crowd(5) > crowd(1), 'and the deep sea is still busier than the shallows');
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
  /** Outside the harbour, pointed at it, under way, and marked as having gone. */
  const outbound = (seed: string) => {
    const out = startVoyage(seed);
    out.x = SEA_CELL * 1.2;
    out.departed = true;
    out.heading = Math.PI;
    for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) out.seen.push(`${cx}:${cy}`);
    return out;
  };

  test('coming back to home water is an event the island can hear', () => {
    const early = sail(outbound('home'), 1, { throttle: 1 });
    ok(!early.events.some((e) => e.kind === 'home'), 'still at sea one second in');

    const arriving = sail(early.voyage, 20, { throttle: 1 });
    ok(arriving.events.some((e) => e.kind === 'home'), 'and it reports reaching home water');
    ok(arriving.voyage.home, 'the flag the island reads is set');
  });

  test('arriving home is announced once, not every step', () => {
    const { events } = sail(outbound('home'), 30, { throttle: 1 });
    eq(events.filter((e) => e.kind === 'home').length, 1, 'exactly one arrival');
  });

  /**
   * The bug a player found on a phone: sail out, and before the sea had
   * finished loading he was handed "De vuelta a puerto — sin carga esta vez"
   * with the open ocean unreachable behind it.
   *
   * A voyage spawns at exactly (0, 0), which IS home water, so the arrival
   * condition was true from frame one. The only thing holding it back was a
   * `step > 60` guard worth two seconds — pause to look at the water and the
   * voyage ended before it began. The suite missed it because every arrival
   * test teleported the ship outside the harbour first, so nothing ever
   * exercised the state every real voyage actually starts in.
   */
  test('a voyage that has only just begun is not an arrival', () => {
    let v = startVoyage('fresh');
    ok(!v.departed, 'a fresh voyage has not left yet');

    // Sit at the spawn doing nothing at all for a full minute.
    const idle = sail(v, 60, { throttle: 0 });
    ok(!idle.events.some((e) => e.kind === 'home'), 'drifting at the spawn is not coming home');
    ok(!idle.voyage.home, 'and the flag stays down');

    // Now potter about near the harbour mouth without ever really leaving.
    v = idle.voyage;
    for (let i = 0; i < 6; i++) {
      const leg = sail(v, 5, { throttle: 1, turn: i % 2 === 0 ? 1 : -1 });
      ok(!leg.events.some((e) => e.kind === 'home'), `still has not left on leg ${i}`);
      v = leg.voyage;
    }
    ok(!v.home, 'circling the harbour never counts as a return');
  });

  /**
   * The same bug, one layer down, and it was still live.
   *
   * The latch also arms on having taken anything, because carrying loot is
   * proof you went somewhere — but it armed WHEREVER THE SHIP WAS. The nearest
   * island in a seeded sea sits about forty-four units out and can be taken
   * from twenty-odd units off its shore, so a ship collecting it from the near
   * side is still inside the harbour when the latch arms, and the next step
   * reads a departed ship in ring 0 and ends the run. Tap ¡Zarpar!, steer at
   * the first island you can see, and two seconds later you are looking at an
   * end-of-voyage card. Measured across four hundred seeded runs: five of them.
   */
  test('taking the first island you see does not end the voyage', () => {
    for (const seed of ['instant-140', 'instant-158', 'instant-236', 'instant-238', 'instant-308']) {
      // The nearest thing worth taking, driven at from a standing start.
      const near = sitesNear(seed, 0, 0, SEA_CELL * 1.6)
        .filter((s) => s.kind !== 'reef')
        .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0];
      ok(near, `${seed} has something to sail at`);
      let v = startVoyage(seed);
      const course = Math.atan2(near.y, near.x);
      let ended = 0;
      for (let i = 0; i < 30 * 12; i++) {
        const turn = ((course - v.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const out = stepVoyage(steer(v, { turn: Math.max(-1, Math.min(1, turn * 2.2)), throttle: 1 }));
        v = out.voyage;
        if (out.events.some((e) => e.kind === 'home')) { ended = i / 30; break; }
      }
      ok(!ended, `${seed} was still at sea after twelve seconds, not sent home at ${ended.toFixed(1)}s`);
    }
  });

  test('leaving arms the latch, and only then can you come back', () => {
    // Ten seconds out, which clears the latch radius with room to spare and is
    // short enough that the ring-1 mobs have not finished the ship off. Thirty
    // seconds of open throttle from the spawn sinks it — see the balance note
    // in PRODUCTION.md section 3.
    const away = sail(startVoyage('round-trip'), 10, { throttle: 1 });
    ok(!away.voyage.sunk, 'the ship survived the outbound leg');
    ok(away.voyage.departed, 'a real voyage out sets the latch');
    ok(!away.voyage.home, 'and it is not home while it is out there');

    const back = sail({ ...away.voyage, x: SEA_CELL * 0.1, y: 0 }, 1, { throttle: 0 });
    ok(back.events.some((e) => e.kind === 'home'), 'having gone, arriving is an event');
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

/**
 * Finding 6 of round 11's playtest, verbatim: "twin zone-3 tritons melt a
 * skiff 86%->6% in one exchange with no warning that zones outrank the starter
 * hull." The fleet table says ring 3 is a wall, not a cliff — 99% of skiffs
 * still come home, a fifth of the hull poorer — so the creatures stay as they
 * are and the missing piece is the WARNING: one deterministic sim event per
 * deeper crossing past the hull's `rated` water, for the sea HUD to draw.
 */
describe('the water warns before it outranks the hull', () => {
  /** A voyage with the spawner silenced, so the only thing under test is the
   *  geometry of the warning — not whatever patrols the crossed cells. */
  function quietSea(seed: string, ship = 'skiff') {
    const v = startVoyage(seed, ship);
    for (let cx = -20; cx <= 20; cx++) for (let cy = -20; cy <= 20; cy++) v.seen.push(`${cx}:${cy}`);
    return v;
  }
  const warningsIn = (events: SeaEvent[]) =>
    events.filter((e): e is Extract<SeaEvent, { kind: 'zone-warning' }> => e.kind === 'zone-warning');

  test('crossing into ring 3 on a skiff warns, once, and says both numbers', () => {
    eq(SHIPS.skiff.rated, 2, 'the skiff is rated for rings 1 and 2');
    let v = quietSea('aviso');
    v.x = SEA_CELL * 5; // five cells out is the first ring-3 water
    const first = stepVoyage(v);
    const warned = warningsIn(first.events);
    eq(warned.length, 1, 'the crossing announces itself exactly once');
    eq(warned[0].ring, 3, 'naming the ring entered');
    eq(warned[0].rated, 2, 'and the water the hull is actually rated for');

    const second = stepVoyage(first.voyage);
    eq(warningsIn(second.events).length, 0, 'and it is a crossing event, not a banner per step');
  });

  test('rated water is silent — the warning is a threshold, not a narrator', () => {
    let v = quietSea('silencio');
    const out = sail(v, 9, { throttle: 1 });
    eq(warningsIn(out.events).length, 0, 'nine seconds out is still rings 1-2: nothing to say');
  });

  test('bobbing on the boundary is one warning, and retreat is not amnesia', () => {
    let v = quietSea('frontera');
    v.x = SEA_CELL * 5;
    v = stepVoyage(v).voyage;               // warned about ring 3
    v.x = SEA_CELL * 3;                     // back into ring 2
    const back = stepVoyage(v);
    eq(warningsIn(back.events).length, 0, 'coming back in says nothing');
    v = back.voyage;
    v.x = SEA_CELL * 5;                     // and out again
    const again = stepVoyage(v);
    eq(warningsIn(again.events).length, 0, 'water already warned about is not re-lectured');
  });

  test('each DEEPER ring warns again, in order', () => {
    let v = quietSea('hondura');
    const rings: number[] = [];
    for (const cells of [5, 8, 12]) {       // ring 3, ring 4, ring 5
      v.x = SEA_CELL * cells;
      const out = stepVoyage(v);
      v = out.voyage;
      rings.push(...warningsIn(out.events).map((w) => w.ring));
    }
    eq(JSON.stringify(rings), JSON.stringify([3, 4, 5]), 'one warning per deeper band, in the order crossed');
  });

  test('a deeper hull is not nagged in water it is rated for', () => {
    let frigate = quietSea('fragata', 'frigate');
    frigate.x = SEA_CELL * 5;               // ring 3: a skiff is warned here
    eq(warningsIn(stepVoyage(frigate).events).length, 0, 'the frigate is rated 5 — ring 3 is its water');
    frigate.x = SEA_CELL * 17;              // ring 6 outranks even a frigate
    const deep = warningsIn(stepVoyage(frigate).events);
    eq(deep.length, 1, 'but the sea is deeper than every hull somewhere');
    eq(deep[0].ring, 6, 'and the warning still names where');
  });

  /* --- round 13: the warning has to arrive BEFORE the water ---------------
   *
   * Round 12 shipped the event at the boundary crossing and the blind
   * playtest still reported no warning at all: "one held drag took the skiff
   * to ZONA 3 within ~2 min; hull went 100->15% before I saw any zone plate."
   * Measured over eight seeds at three headings, full throttle, the old rule
   * put the plate between 0.3 and 13 seconds ahead of the first hit taken in
   * outranked water — and 0.3s four times in twenty-four. The sim now asks
   * about the cell one step ahead on the current heading as well as the one
   * underneath, which is a whole cell of water: 55 units, ~3.2s at a skiff's
   * speed. These two tests are what stops it sliding back.
   */

  /** Steps a live voyage (mobs and all) and reports the three instants that
   *  matter: the warning, the crossing, and the first hit taken in water the
   *  hull is not rated for. -1 for "never happened". */
  function runOutbound(seed: string, heading: number, seconds = 90) {
    const rated = SHIPS.skiff.rated;
    let v = steer({ ...startVoyage(seed, 'skiff'), heading }, { throttle: 1 });
    const ringNow = () => ringOf(Math.round(v.x / SEA_CELL), Math.round(v.y / SEA_CELL));
    let warn = -1, warnedAt = -1, crossed = -1, hit = -1;
    for (let i = 0; i < Math.round(seconds / SEA_STEP); i++) {
      const out = stepVoyage(v);
      v = out.voyage;
      const here = ringNow();
      if (crossed < 0 && here > rated) crossed = i;
      for (const e of out.events) {
        if (e.kind === 'zone-warning' && warn < 0) { warn = i; warnedAt = here; }
        if (e.kind === 'hit' && e.target === 'ship' && hit < 0 && here > rated) hit = i;
      }
      if (v.sunk) break;
    }
    return { warn, warnedAt, crossed, hit, rated };
  }

  test('full throttle from spawn: the warning precedes the first outranked hit', () => {
    // The playtest's own input — hold the drag and go — with the sea live, so
    // what is being measured is the real race between the plate and the teeth.
    let worst = Infinity;
    for (const seed of ['la-leyenda', 'isla-a', 'isla-b', 'isla-c', 'isla-d', 'isla-e']) {
      for (const heading of [0, 0.6, 1.1]) {
        const { warn, hit } = runOutbound(seed, heading);
        ok(warn >= 0, `${seed}@${heading}: the run was warned at all`);
        if (hit < 0) continue;              // nothing bit on this run
        ok(warn < hit, `${seed}@${heading}: warned at step ${warn}, first outranked hit at ${hit}`);
        worst = Math.min(worst, (hit - warn) * SEA_STEP);
      }
    }
    // The number the round is actually about. At the boundary this measured
    // 0.3s; a player cannot turn a ship in 0.3s, so the plate was decoration.
    ok(worst >= 2, `the tightest margin over the fleet is ${worst.toFixed(1)}s of warning`);
  });

  test('the plate lands while the ship is still in water it is rated for', () => {
    for (const seed of ['la-leyenda', 'isla-c', 'isla-g']) {
      for (const heading of [0, 0.6, 1.1]) {
        const { warn, warnedAt, crossed, rated } = runOutbound(seed, heading);
        ok(warn >= 0, `${seed}@${heading}: warned`);
        ok(warnedAt <= rated, `${seed}@${heading}: warned from ring ${warnedAt}, still inside the rating`);
        ok(warn < crossed, `${seed}@${heading}: warned at ${warn}, crossed at ${crossed}`);
      }
    }
  });

  test('a look-ahead does not warn about water behind or beside the heading', () => {
    // Pointed back at home from the near edge of ring 2, one cell ahead is
    // shallower, not deeper — the ship is leaving, and a warning here would
    // be the narrator this file keeps refusing to be.
    const v = quietSea('rumbo');
    v.x = SEA_CELL * 4;                     // ring 2, one cell short of ring 3
    v.heading = Math.PI;                    // hard about, heading home
    eq(warningsIn(stepVoyage(v).events).length, 0, 'sailing in says nothing');

    const out = { ...v, heading: 0 };       // same water, pointed at the deep
    const warned = warningsIn(stepVoyage(out).events);
    eq(warned.length, 1, 'the same cell, pointed outward, warns');
    eq(warned[0].ring, 3, 'about the ring one cell ahead');
  });

  test('a straight run out is warned before the 2-to-3 crossing, then only deeper', () => {
    // The playtest's own path: hold the throttle and watch. The first thing
    // the sim says about danger is the approach to ring 3 — the exact water
    // where the twin hammerdeads took the skiff apart unannounced.
    const run = (seed: string) => {
      let v = steer(startVoyage(seed), { throttle: 1 });
      const seen: { ring: number; rated: number }[] = [];
      for (let i = 0; i < Math.round(35 / SEA_STEP); i++) {
        const out = stepVoyage(v);
        v = out.voyage;
        for (const w of warningsIn(out.events)) seen.push({ ring: w.ring, rated: w.rated });
        if (v.sunk) break;
      }
      return seen;
    };
    const seen = run('marcha');
    ok(seen.length >= 1, 'the run was warned at all');
    eq(seen[0].ring, 3, 'first at the 2-to-3 crossing');
    for (let i = 1; i < seen.length; i++) {
      ok(seen[i].ring > seen[i - 1].ring, 'and after that only ever deeper');
    }
    eq(JSON.stringify(run('marcha')), JSON.stringify(seen), 'deterministically — same seed, same warnings');
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

/**
 * The balance, as numbers rather than as a feeling.
 *
 * Nobody had ever played this. PRODUCTION.md §3 said so twice — "hull nearly
 * gone in six seconds", "nobody has played this" — and the test above about the
 * departure latch had to be cut from thirty seconds to ten to have a boat left
 * to sail home. Measured with `tools/voyages.mjs` before this round: a
 * beginner's FIRST voyage, ring 1, the tutorial water, got home 68 times in a
 * hundred. Ring 3 was five. Ring 4 was none at all.
 *
 * These cases play real fleets through the real simulation with an autopilot
 * that steers exactly the way `src/ui/stick.ts` makes a thumb steer, and assert
 * the handful of numbers the design actually promises. They are slower than the
 * rest of the suite and that is the price of knowing.
 *
 * The bounds are deliberately loose — this is a floor under the design, not a
 * lock on today's tuning. `node tools/voyages.mjs` prints the full table.
 */
describe('somebody has played this', () => {
  const fleet = (ring: number, skill: 'novato' | 'veterano', runs = 40) =>
    summarise(playFleet(runs, { ring, skill, sites: Math.min(6, 1 + ring), limit: 240 }, `t-${skill}-${ring}-`));

  test('a first voyage ends in cargo, not on the bottom', () => {
    const first = fleet(1, 'novato');
    ok(first.survived >= 0.95, `a beginner comes home from ring 1 (${(first.survived * 100).toFixed(0)}%)`);
    ok(first.cargoHome > 100, `and comes home with something (${first.cargoHome.toFixed(0)} units)`);
    ok(first.timeHome < 40, `in the length of a bus stop (${first.timeHome.toFixed(0)}s)`);
  });

  test('tutorial water stays tutorial water', () => {
    const second = fleet(2, 'novato');
    ok(second.survived >= 0.9, `ring 2 is still forgiving (${(second.survived * 100).toFixed(0)}%)`);
  });

  test('the deep sea is a decision, and it costs', () => {
    const three = fleet(3, 'novato');
    const four = fleet(4, 'novato');
    const five = fleet(5, 'novato');
    ok(three.survived >= four.survived, 'ring 4 is never kinder than ring 3');
    ok(four.survived > five.survived, 'and ring 5 is worse than ring 4');
    ok(five.survived < 0.85, `the far sea is a real gamble (${(five.survived * 100).toFixed(0)}% come back)`);
    ok(five.survived > 0.2, `but not a foregone conclusion (${(five.survived * 100).toFixed(0)}%)`);
    ok(four.hullHome < 0.85, 'and you come back from ring 4 knowing you were there');
    ok(three.hullHome > four.hullHome, 'the hull bar reads the depth you went to');
  });

  test('sailing further out pays more', () => {
    ok(fleet(3, 'novato').cargoHome > fleet(1, 'novato').cargoHome * 2, 'ring 3 fills the hold, ring 1 does not');
  });

  /**
   * What skill buys, stated honestly.
   *
   * It is NOT survival. Measured over hundreds of voyages the two pilots come
   * home at about the same rate, and that is the game rather than a fault in
   * the model: the careful one stands off a defended island and clears it from
   * gun range, which costs almost no hull and takes twice as long — and time at
   * sea is itself the risk. The reckless one drives in, takes the bites and is
   * back in half the time. Two playable answers to the same question.
   *
   * What skill does buy is measurable and is what these assert: a much
   * healthier ship at the same ring, and far more sunk on the way, which since
   * `sea.bounty` exists is money.
   */
  test('knowing what you are doing is worth something', () => {
    const green = fleet(4, 'novato');
    const salt = fleet(4, 'veterano');
    ok(
      salt.kills > green.kills * 1.3,
      `the one who turns a beam onto things sinks far more of them (${salt.kills.toFixed(1)} vs ${green.kills.toFixed(1)})`
    );
    ok(
      salt.hullHome > green.hullHome,
      `and brings the ship back in better shape (${(salt.hullHome * 100).toFixed(0)}% vs ${(green.hullHome * 100).toFixed(0)}%)`
    );
  });

  test('and being reckless is a real answer too, not just a worse one', () => {
    // If the fast, careless line were strictly dominated there would be one way
    // to play. It is not: it is out and back in half the time.
    const green = fleet(4, 'novato');
    const salt = fleet(4, 'veterano');
    ok(green.timeHome < salt.timeHome, 'the reckless line is much the quicker trip');
    ok(green.cargoPerMinute > salt.cargoPerMinute, 'and pays better per minute at sea');
  });

  test('sinking something pays, or nobody would ever fire', () => {
    // The guns are automatic, so if a kill is worth nothing then the only
    // reason to engage is to stop being bitten — and running is always cheaper.
    const v = startVoyage('bounty');
    v.mobs.push({
      id: 1, kind: 'blowfish', x: 0, y: 26, heading: 0, hp: MOBS.blowfish.hp,
      state: 'patrol', cooldown: 0, homeX: 0, homeY: 26, tether: 0, cell: '0:1',
    });
    for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) v.seen.push(`${cx}:${cy}`);
    const { voyage, events } = sail(v, 14, { throttle: 0 });
    const kill = events.find((e) => e.kind === 'mob-killed');
    ok(kill?.kind === 'mob-killed' && Object.keys(kill.loot).length > 0, 'the wreck leaves something floating');
    ok(holdUsed(voyage) > 0, 'and it reaches the hold');
  });

  test('breaking off a fight is a real play, not theatre', () => {
    // If a hurt ship cannot get out, the hull bar is a countdown that started
    // when the player left the harbour and being sunk is not their decision.
    const runs = Array.from({ length: 40 }, (_, i) => breakOff(`t-escape-${i}`, 3, 0.4));
    const home = runs.filter((r) => r.outcome === 'home').length / runs.length;
    ok(home >= 0.8, `a ring-3 ship at 40% hull that runs for it gets home (${(home * 100).toFixed(0)}%)`);
  });

  test('half a minute of open throttle is not a death sentence', () => {
    // The thing the owner did on a phone, and the thing PRODUCTION.md §3
    // recorded: hold the throttle, look at the sea, sink. Thirty seconds used
    // to drown three ships in four.
    const short = Array.from({ length: 40 }, (_, i) => straightOut(`t-straight-${i}`, 30));
    const sunk = short.filter((r) => r.outcome === 'sunk').length / short.length;
    ok(sunk <= 0.15, `thirty seconds of not steering is survivable (${(sunk * 100).toFixed(0)}% sank)`);

    // But it cannot be free either, or distance means nothing.
    const long = Array.from({ length: 40 }, (_, i) => straightOut(`t-straight-${i}`, 120));
    const lost = long.filter((r) => r.outcome === 'sunk').length / long.length;
    ok(lost >= 0.6, `two minutes of never touching the helm is not (${(lost * 100).toFixed(0)}% sank)`);
  });

  test('scenery scuffs the ship, it does not sink it', () => {
    // Reefs were 28–42% of ALL damage taken and, worse, the arithmetic was
    // wrong twice over: damage came off raw speed so a graze cost as much as a
    // ram, and there was no grace, so a ship pinned against a rock took a fresh
    // hit every quarter second. Taking a site meant RAMMING it too, because the
    // radius that paid out was shorter than the ship is long.
    //
    // Measured absolutely rather than as a share, because a share only says
    // which of two numbers is bigger. A whole voyage's worth of bumping must
    // cost less than a quarter of the hull.
    const total = summarise(playFleet(40, { ring: 3, skill: 'novato', sites: 4, limit: 240 }, 't-reef-'));
    ok(
      total.reefDamage < SHIPS.skiff.hull * 0.25,
      `a voyage of bumping into things costs ${total.reefDamage.toFixed(0)} of a ${SHIPS.skiff.hull} hull`
    );
  });

  test('a ship pinned against a rock is not held there and ground down', () => {
    // The failure this replaced: a site ATE momentum, and a ship with no way
    // has no rudder, so it stayed. Ninety seconds of open throttle in a
    // straight line covered 299 units of a sea the ship crosses at 17 a second.
    const far = Array.from({ length: 20 }, (_, i) => straightOut(`t-slide-${i}`, 40));
    const travelled = far.reduce((a, r) => a + r.distance, 0) / far.length;
    ok(travelled > 350, `forty seconds of open throttle actually goes somewhere (${travelled.toFixed(0)} units)`);
  });
});

/**
 * The boss fight — ROADMAP round 10's "no phases, no tell, no reward moment",
 * closed. Every claim below is the design: damage is telegraphed and dodgeable
 * on the stick, half health changes the pattern, standing off is answered by
 * the dive, and the kill pays a guaranteed chest through the same stow() as
 * everything else.
 */
describe('the giant squid has a fight', () => {
  /**
   * A voyage that is only the boss: spawner blocked, squid placed by hand —
   * ON THE STARBOARD BEAM, because a boss dead ahead is a boss the automatic
   * broadsides can never answer, and half of these cases are about the guns.
   */
  function bossVoyage(distance: number, opts: { hp?: number; deepChest?: boolean; ship?: string } = {}) {
    const v = startVoyage('kraken', opts.ship ?? 'skiff', { deepChest: opts.deepChest });
    v.mobs.push({
      id: 1, kind: 'squid', x: 0, y: distance, heading: -Math.PI / 2,
      hp: opts.hp ?? MOBS.squid.hp, state: 'patrol', cooldown: 0,
      homeX: 0, homeY: distance, tether: 400, cell: '1:0',
    });
    for (let cx = -4; cx <= 4; cx++) for (let cy = -4; cy <= 4; cy++) v.seen.push(`${cx}:${cy}`);
    return v;
  }

  const bossDown = (events: SeaEvent[]) =>
    events.some((e) => e.kind === 'mob-killed' && e.mob === 'squid');

  test('every point of boss damage is telegraphed first', () => {
    // Dead in the water inside its reach: the worst place to be, on purpose.
    const { events } = sail(bossVoyage(16), 12, { throttle: 0 });
    const order: string[] = [];
    for (const e of events) {
      if (e.kind === 'squid-tell' || e.kind === 'squid-strike') order.push(e.kind);
      if (e.kind === 'hit' && e.target === 'ship') order.push('hit');
    }
    ok(order.includes('hit'), 'a ship that sits still is eventually hit');
    eq(order[0], 'squid-tell', 'and nothing lands before a tell has been up');
    for (let i = 0; i < order.length; i++) {
      if (order[i] !== 'hit') continue;
      ok(order.slice(0, i).includes('squid-tell'), `hit #${i} was telegraphed`);
    }
    const tell = events.find((e) => e.kind === 'squid-tell');
    ok(tell?.kind === 'squid-tell' && tell.seconds > 0.6, 'the warning is a real beat, not a frame');
    eq(tell?.kind === 'squid-tell' && tell.targets.length, 1, 'phase one drops one circle');
  });

  test('the strike window is a dodge the stick can make', () => {
    // Same squid, same clock — but this ship has way on and keeps it. The
    // starting speed is the test's honesty: the dodge the design promises is
    // "keep moving", not "out-accelerate a strike from a standing start" —
    // a ship dead in the water is SUPPOSED to be hit, and the case above
    // proves it is.
    const v = bossVoyage(20);
    v.speed = SHIPS.skiff.speed;
    const { voyage, events } = sail(v, 6, { throttle: 1, turn: 0 });
    const strikes = events.filter((e) => e.kind === 'squid-strike');
    ok(strikes.length > 0, 'the squid did try');
    ok(
      !events.some((e) => e.kind === 'hit' && e.target === 'ship'),
      'a hull under way walks out of the circle: the tell is a real dodge window'
    );
    eq(voyage.hull, SHIPS.skiff.hull, 'not one point of hull lost');
  });

  test('at half health the pattern changes, and says so once', () => {
    // Under way, so the volley has a course to lead.
    const v = bossVoyage(16, { hp: Math.floor(MOBS.squid.hp * 0.5) - 1 });
    v.speed = SHIPS.skiff.speed;
    const { events } = sail(v, 10, { throttle: 1 });
    eq(events.filter((e) => e.kind === 'squid-phase').length, 1, 'the turn announces itself exactly once');
    const tell = events.find((e) => e.kind === 'squid-tell');
    ok(tell?.kind === 'squid-tell' && tell.frenzy, 'the casts are frenzied');
    ok(tell?.kind === 'squid-tell' && tell.targets.length === 3, 'three circles now, not one');
    ok(tell?.kind === 'squid-tell' && tell.seconds < 1, 'and the warning beat is shorter');
    // The volley leads the course, so the circles are a LINE along it: holding
    // the phase-one dodge — straight ahead — now sails INTO the second and
    // third circle, and the dodge becomes a turn.
    if (tell?.kind === 'squid-tell') {
      const [a, b, c] = tell.targets;
      const spread = Math.hypot(c.x - a.x, c.y - a.y);
      ok(spread > 8, `a real line, not a point (${spread.toFixed(1)} units long)`);
      ok(Math.hypot(b.x - a.x, b.y - a.y) < spread, 'laid out in order along the course');
    }
  });

  test('standing off at gun range is answered, not allowed', () => {
    // Just outside its strike but well inside the guns: the piñata position.
    // It dives on sight, and while it is under, the broadsides hold — a
    // battery emptied into a shadow would teach the player their guns are
    // broken. It closes at a speed every hull outruns, surfaces in its own
    // pocket, and the rhythm resumes; the standoff bought nothing.
    const opening = sail(bossVoyage(45), 1, { throttle: 0 });
    ok(opening.events.some((e) => e.kind === 'squid-dive'), 'the boss refuses the deck-chair fight');
    ok(opening.voyage.mobs[0].dive === 1, 'and is under the water');
    ok(!opening.events.some((e) => e.kind === 'fired'), 'with not a broadside spent on it');

    const under = sail(opening.voyage, 0.5, { throttle: 0 });
    ok(!under.events.some((e) => e.kind === 'fired'), 'still nothing to shoot while it closes');

    const surfaced = sail(under.voyage, 8, { throttle: 0 });
    ok(surfaced.events.some((e) => e.kind === 'squid-surface'), 'it comes up in the pocket');
    ok(surfaced.events.some((e) => e.kind === 'squid-tell'), 'and the rhythm resumes');
    ok(surfaced.events.some((e) => e.kind === 'fired'), 'where the guns finally have their answer too');
  });

  test('the kill pays the chest of the deep, once, through the hold', () => {
    // One volley from dead, on a frigate — the chest is sized to be worth a
    // boss trip, which means it is deliberately more than a skiff's whole
    // hold; the hulls that can realistically win the fight can also carry it.
    const first = sail(bossVoyage(14, { hp: 1, ship: 'frigate' }), 8, { throttle: 0 });
    const chest = first.events.find((e) => e.kind === 'deep-chest');
    ok(bossDown(first.events), 'the squid went down');
    ok(chest?.kind === 'deep-chest', 'and the Cofre de las Profundidades came up with it');
    const paid = chest?.kind === 'deep-chest'
      ? Object.values(chest.loot).reduce((a, b) => a + (b ?? 0), 0) : 0;
    ok(paid > 400, `worth the trip (${paid} units of cargo)`);
    ok(holdUsed(first.voyage) >= paid, 'and it is really in the hold');
    ok(!first.voyage.deepChest, 'the voyage remembers it has been paid');

    // A second boss on the same voyage pays only its bounty.
    const again = first.voyage;
    again.mobs.push({
      id: 99, kind: 'squid', x: 0, y: 14, heading: -Math.PI / 2, hp: 1,
      state: 'patrol', cooldown: 0, homeX: 0, homeY: 14, tether: 400, cell: '2:0',
    });
    const second = sail(again, 8, { throttle: 0 });
    ok(second.events.some((e) => e.kind === 'mob-killed' && e.mob === 'squid'), 'second kill lands');
    ok(!second.events.some((e) => e.kind === 'deep-chest'), 'no second chest');
  });

  test('a voyage the season already paid gets no chest at all', () => {
    const { events } = sail(bossVoyage(14, { hp: 1, deepChest: false }), 8, { throttle: 0 });
    ok(bossDown(events), 'the kill still lands');
    ok(!events.some((e) => e.kind === 'deep-chest'), 'the chest does not: once per season means once');
  });
});

/**
 * Boarding — the other half of ROADMAP round 10's "a site is taken by sailing
 * over it, which is the placeholder, not the design". Wrecks only: the party
 * rows over, the sea keeps happening, and the loot lands as a burst or not at
 * all. Everything else in the sea still pays on touch.
 */
describe('boarding a wreck is a beat, not a touch', () => {
  /** The nearest wreck in a seeded sea, and a voyage parked on it. */
  function atWreck(seed: string) {
    let wreck = null as ReturnType<typeof siteAt>;
    for (let cx = -8; cx <= 8 && !wreck; cx++) {
      for (let cy = -8; cy <= 8 && !wreck; cy++) {
        const s = siteAt(seed, cx, cy);
        if (s?.kind === 'wreck') wreck = s;
      }
    }
    ok(wreck !== null, `${seed} has a wreck to board`);
    const v = startVoyage(seed);
    v.x = wreck!.x;
    v.y = wreck!.y;
    for (let cx = -9; cx <= 9; cx++) for (let cy = -9; cy <= 9; cy++) v.seen.push(`${cx}:${cy}`);
    return { v, wreck: wreck! };
  }

  test('the party rows over, and the loot lands only when they are back', () => {
    const { v } = atWreck('la-leyenda');
    const first = sail(v, 1, { throttle: 0 });
    ok(first.events.some((e) => e.kind === 'boarding-started'), 'the party goes over the side');
    ok(!first.events.some((e) => e.kind === 'looted'), 'and nothing has paid yet');
    ok(first.voyage.boarding !== null, 'the voyage knows they are away');
    eq(holdUsed(first.voyage), 0, 'the hold is still empty');

    const done = sail(first.voyage, 5, { throttle: 0 });
    const looted = done.events.find((e) => e.kind === 'looted');
    ok(looted?.kind === 'looted' && looted.site === 'wreck', 'they come back with the wreck\'s cargo');
    ok(holdUsed(done.voyage) > 0, 'which is really in the hold');
    eq(done.voyage.boarding, null, 'and everyone is back aboard');
  });

  test('sailing off mid-boarding pays nothing, and coming back starts over', () => {
    const { v, wreck } = atWreck('la-leyenda');
    const started = sail(v, 1, { throttle: 0 });
    ok(started.voyage.boarding !== null, 'the party is away');

    // Open the throttle and leave. The wreck pays nothing.
    const fled = sail(started.voyage, 3, { throttle: 1 });
    ok(fled.events.some((e) => e.kind === 'boarding-broken'), 'the party rows back empty');
    ok(!fled.events.some((e) => e.kind === 'looted'), 'no drive-by looting');
    eq(holdUsed(fled.voyage), 0, 'the hold says so too');

    // Come round again: the clock starts from zero, and serving it pays.
    const back = { ...fled.voyage, x: wreck.x, y: wreck.y };
    const second = sail(back, 1, { throttle: 0 });
    ok(second.events.some((e) => e.kind === 'boarding-started'), 'a fresh party, a fresh clock');
    const done = sail(second.voyage, 5, { throttle: 0 });
    ok(done.events.some((e) => e.kind === 'looted'), 'commitment is what pays');
  });

  test('everything that is not a wreck still pays on touch', () => {
    const islet = (() => {
      for (let cx = -8; cx <= 8; cx++) {
        for (let cy = -8; cy <= 8; cy++) {
          const s = siteAt('la-leyenda', cx, cy);
          if (s && (s.kind === 'islet' || s.kind === 'harvest')) return s;
        }
      }
      return null;
    })();
    ok(islet !== null, 'the sea has something instant to take');
    const v = startVoyage('la-leyenda');
    v.x = islet!.x;
    v.y = islet!.y;
    for (let cx = -9; cx <= 9; cx++) for (let cy = -9; cy <= 9; cy++) v.seen.push(`${cx}:${cy}`);
    const { events } = sail(v, 0.5, { throttle: 0 });
    ok(events.some((e) => e.kind === 'looted'), 'picked clean from the deck, no party, no wait');
  });

  test('the wait has teeth: the sea keeps biting while the party is away', () => {
    const { v } = atWreck('la-leyenda');
    v.mobs.push({
      id: 77, kind: 'kelpling', x: v.x + 5, y: v.y, heading: Math.PI, hp: 999,
      state: 'attack', cooldown: 0, homeX: v.x + 5, homeY: v.y, tether: 0, cell: '9:9',
    });
    const { events } = sail(v, 5, { throttle: 0 });
    ok(events.some((e) => e.kind === 'looted'), 'the boarding still completes');
    ok(
      events.some((e) => e.kind === 'hit' && e.target === 'ship' && e.by === 'mob'),
      'but the hull paid for the wait — boarding under fire is a choice'
    );
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
      // Its own radius is not enough of a bar, and the frame proved it: a
      // kelpling draws five and a half units long against a skiff that draws
      // eight, so anything much inside its reach is standing on the deck. It has
      // to hold near the EDGE of what it can bite from, which costs the fight
      // nothing — everything from here to `reach` bites at the same cadence.
      ok(
        gap > MOBS.kelpling.reach * 0.8,
        `a kelpling is ${gap.toFixed(1)} out of a reach of ${MOBS.kelpling.reach}, not inside the boat`
      );
    }
  });
});
