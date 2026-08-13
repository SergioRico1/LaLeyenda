import {
  HARBOUR, MOBS, NEUTRAL_LOADOUT, SEA_CELL, SEA_RANGE, SEA_STEP, SHIPS, SHIP_TYPES,
  SONDEO_TIERS, TIDE_STAGES, TIDE_STAGE_AT, ZAFARRANCHO, abandonVoyageInPlace, bearingHome,
  careenBill, cellsInRing, effectiveShip, holdLoad, holdUsed, landfallShare, loadoutOf,
  mobsAt, previewAbandon,
  canDash, callDash, holdManifest, nearestPrize, readDash, readTide, ringOf, siteAt, sitesNear,
  startVoyage, steer,
  stepVoyage, stow, tideAt, tideClock,
  tideStageOf, type Loadout, type SeaEvent, type Voyage,
} from '../../src/sim/sea';
import { landCargoInPlace, previewLanding, storeCap } from '../../src/sim';
import { clone } from '../../src/sim/economy';
import { deepEq, describe, eq, near, ok, test } from './harness';
import { quiet } from './fixtures';
import { breakOff, playFleet, straightOut, summarise, weightRun } from './voyages';

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

/**
 * Outside the harbour, pointed at it, laden, and marked as having gone — a ship
 * one order away from banking a hold, with a quiet sea around her.
 *
 * The approach is CHOSEN rather than assumed: a seeded sea moors islets as
 * close as forty-four units to the harbour, and a run that grounds on one is
 * deflected away and never arrives — which measures the scenery rather than the
 * arrival. Eight bearings are sampled and the first clear one is sailed.
 */
function outboundLaden(seed: string): Voyage {
  const out = startVoyage(seed);
  const away = SEA_CELL * 1.2;
  const clear = (angle: number) => {
    for (let t = 0; t <= 1; t += 1 / 12) {
      const x = Math.cos(angle) * away * (1 - t);
      const y = Math.sin(angle) * away * (1 - t);
      for (const site of sitesNear(seed, x, y, 60)) {
        if (Math.hypot(site.x - x, site.y - y) < site.radius + SHIPS.skiff.radius + 8) return false;
      }
    }
    return true;
  };
  const bearing = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4).find(clear) ?? 0;
  out.x = Math.cos(bearing) * away;
  out.y = Math.sin(bearing) * away;
  out.heading = bearing + Math.PI;
  out.departed = true;
  out.cargo = { oro: 300 };
  for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) out.seen.push(`${cx}:${cy}`);
  return out;
}

/**
 * A patch of water to stage a fight in, CHOSEN rather than assumed — the same
 * discipline `laden()` above needs, and for the same reason.
 *
 * Two properties, both load-bearing. It is well outside the harbour, because a
 * ship that has not cast off is one the sea leaves alone (`sheltered` in
 * sea.ts) and one the `home` latch ends the voyage of the moment she is marked
 * as departed — a fight staged at (0,0) is a fight that never happens. And
 * neither the cell nor any of its neighbours carries a site, because a fixture
 * parked on a wreck measures the loot table instead of the thing it is about.
 *
 * Everything a fixture puts on the water must be placed RELATIVE to what this
 * returns, so the geometry each test argues for survives the move.
 */
const OPEN_WATER = new Map<string, { x: number; y: number; heading: number }>();

function openWater(seed: string, runway = 0): { x: number; y: number; heading: number } {
  const memo = OPEN_WATER.get(`${seed}|${runway}`);
  if (memo) return memo;

  // An empty CELL is the wrong thing to look for — two thirds of them carry a
  // site, and an empty one next to a wreck moored on the boundary is not open
  // water. Nor is a single point enough: a ship at a skiff's top speed covers a
  // hundred units in six seconds, and a dodge case that grounds on a reef
  // reports a hit it never took.
  //
  // So what is maximised is the worst clearance from any site's SHORE along the
  // whole course the fixture will sail — a lattice of start points crossed with
  // eight bearings, sampled every twenty units down the runway. The winner has
  // to beat 40 units, comfortably outside `loot.reach` plus a site radius.
  const clearance = (x: number, y: number): number => {
    const cx = Math.round(x / SEA_CELL);
    const cy = Math.round(y / SEA_CELL);
    let gap = Infinity;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const s = siteAt(seed, cx + dx, cy + dy);
        if (s) gap = Math.min(gap, Math.hypot(s.x - x, s.y - y) - s.radius);
      }
    }
    return gap;
  };

  let best: { x: number; y: number; heading: number; gap: number } | null = null;
  for (let x = SEA_CELL * 2; x <= SEA_CELL * 9; x += 20) {
    for (let y = -SEA_CELL * 5; y <= SEA_CELL * 5; y += 20) {
      const here = clearance(x, y);
      if (best && here <= best.gap) continue;   // no bearing can beat the start
      for (let b = 0; b < 8; b++) {
        const heading = (b * Math.PI) / 4;
        let gap = here;
        for (let along = 20; along <= runway; along += 20) {
          gap = Math.min(gap, clearance(x + Math.cos(heading) * along, y + Math.sin(heading) * along));
        }
        if (!best || gap > best.gap) best = { x, y, heading, gap };
      }
    }
  }
  if (!best || best.gap < 40) {
    throw new Error(`no open water near the harbour for seed ${seed} (best ${best?.gap.toFixed(1)})`);
  }
  const found = { x: best.x, y: best.y, heading: best.heading };
  OPEN_WATER.set(`${seed}|${runway}`, found);
  return found;
}

/**
 * A point in the SHIP'S OWN FRAME turned into world coordinates: `ahead` down
 * her course, `abeam` off her starboard side (the sign the broadside code uses
 * — `beam = heading + PI/2` is starboard).
 *
 * Every fixture that used to write absolute coordinates around a ship at the
 * origin pointed along +x says the same thing through this instead, so the
 * geometry each one argues for survives being moved into open water.
 */
function offBow(v: Voyage, ahead: number, abeam: number): { x: number; y: number } {
  return {
    x: v.x + Math.cos(v.heading) * ahead + Math.cos(v.heading + Math.PI / 2) * abeam,
    y: v.y + Math.sin(v.heading) * ahead + Math.sin(v.heading + Math.PI / 2) * abeam,
  };
}

/** Marks every cell within four of the ship as already swept, so the only
 *  things on the water are the ones the fixture put there. */
function sweep(v: Voyage): void {
  const cx0 = Math.round(v.x / SEA_CELL);
  const cy0 = Math.round(v.y / SEA_CELL);
  for (let cx = -4; cx <= 4; cx++) for (let cy = -4; cy <= 4; cy++) v.seen.push(`${cx0 + cx}:${cy0 + cy}`);
}

/** Sinks a laden ship `cells` out along +x and hands back the wreck. Nothing
 *  moves: she is dead in the water, so where she goes down is where she was. */
function sinkAt(cells: number, cargo: Partial<Record<'oro' | 'madera' | 'metal' | 'ron', number>>): Voyage {
  const v = startVoyage(`sink-${cells}`);
  v.x = SEA_CELL * cells;
  v.departed = true;
  v.hull = 1;
  v.cargo = { ...cargo };
  v.mobs.push({
    id: 1, kind: 'hammerdead', x: v.x + 4, y: 0, heading: Math.PI, hp: 999,
    state: 'attack', cooldown: 0, homeX: v.x, homeY: 0, tether: 0, cell: `${Math.round(cells)}:0`,
  });
  for (let cx = -20; cx <= 20; cx++) for (let cy = -3; cy <= 3; cy++) v.seen.push(`${cx}:${cy}`);
  const { voyage } = sail(v, 6, { throttle: 0 });
  if (!voyage.sunk) throw new Error(`the fixture at ${cells} cells did not sink`);
  return voyage;
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
      // Under way, because the sea does not come for a ship still alongside —
      // and this is a fixture about a creature noticing a VOYAGE.
      v.departed = true;
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
  test('a site is surveyed, and then it is spent', () => {
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
    v.departed = true;
    // Round 17: a site is no longer taken by touching it — the sondeo surveys
    // it, and the haul lands when the survey ends. Long enough for the whole
    // ladder, so this is about a site paying ONCE rather than about the beat.
    const first = sail(v, SONDEO_TIERS[SONDEO_TIERS.length - 1].at + 1, { throttle: 0 });
    const looted = first.events.filter((e) => e.kind === 'looted' && e.x === site.x);
    eq(looted.length, 1, 'it paid out exactly once');
    ok(holdUsed(first.voyage) > 0, 'and the hold has something in it');
    ok(first.voyage.taken.includes(site.id), 'and the site is spent');

    const second = sail(first.voyage, 4, { throttle: 0 });
    eq(
      second.events.filter((e) => e.kind === 'looted' && e.x === site.x).length, 0,
      'and it does not pay again'
    );
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
    v.departed = true;   // under way; the harbour itself is never fought in
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
      // Every ending stops the run, not just the wet one. A voyage that is over
      // is over — see the freeze at the top of stepVoyage — and steps taken
      // after it are steps no player is present for.
      if (v.sunk || v.home) break;
    }
    return { warn, warnedAt, crossed, hit, rated };
  }

  test('full throttle from spawn: the warning precedes the first outranked hit', () => {
    // The playtest's own input — hold the drag and go — with the sea live, so
    // what is being measured is the real race between the plate and the teeth.
    let worst = Infinity;
    let measured = 0;
    const runs = [];
    for (const seed of ['la-leyenda', 'isla-a', 'isla-b', 'isla-c', 'isla-d', 'isla-e']) {
      for (const heading of [0, 0.6, 1.1]) {
        runs.push({ seed, heading, ...runOutbound(seed, heading) });
      }
    }
    for (const { seed, heading, warn, hit, crossed } of runs) {
      // ROUND 14: a run can now END before it ever reaches water the hull is
      // not rated for. isla-d at 1.1 rad is one: the scenery deflects her, she
      // comes back through the harbour at step 706 and the voyage is over
      // there. It used to keep sailing through home water and get warned 1178
      // steps in — a plate no player could ever have seen, because the scene
      // had already put the end-of-voyage card up. The claim is unchanged and
      // is now made only about runs the claim is about; the count below is what
      // stops that turning into a test that quietly asserts nothing.
      if (crossed < 0) continue;
      ok(warn >= 0, `${seed}@${heading}: the run was warned at all`);
      if (hit < 0) continue;              // nothing bit on this run
      ok(warn < hit, `${seed}@${heading}: warned at step ${warn}, first outranked hit at ${hit}`);
      worst = Math.min(worst, (hit - warn) * SEA_STEP);
      measured++;
    }
    ok(measured >= 16, `${measured} of ${runs.length} runs reached outranked water and were measured`);
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

/**
 * THE VOYAGE IS A DECISION — round 13's playtest, finding 1, which is a design
 * hole rather than a bug:
 *
 *   "The sea has no stakes and no decisions. Volver (top-right, always live)
 *    banks the entire hold instantly from any distance and any hull state — I
 *    tapped it at 200m out with the hull at 19% and kept everything, twice.
 *    Sinking costs almost nothing either: you keep half the cargo and the hull
 *    is restored to 100% free."
 *
 * One rule answers both halves: the sea charges by distance. What the harbour
 * takes off a voyage is the hold times the share for the water it ended in, so
 * a full hold banks in full only from home water — and the only way there is to
 * sail. Sinking keeps its half, exactly as PLAN.md requires, and then swims the
 * same distance with it.
 */
describe('the sea charges for the trip back', () => {
  /** A ship parked `cells` out along +x with `cargo` in the hold. */
  const laden = (cells: number, cargo: Partial<Record<'oro' | 'madera' | 'metal' | 'ron', number>>) => {
    const v = startVoyage('tithe');
    v.x = SEA_CELL * cells;
    v.departed = true;
    v.cargo = { ...cargo };
    return v;
  };

  test('home water banks the whole hold, and nothing else does', () => {
    eq(landfallShare(0, 0), 1, 'at the mooring');
    eq(landfallShare(SEA_CELL * HARBOUR * 0.99, 0), 1, 'anywhere inside the harbour');
    ok(landfallShare(SEA_CELL * HARBOUR * 1.01, 0) < 1, 'and one unit outside it, the sea takes a cut');
  });

  test('every ring out costs more, and the far sea stops getting worse', () => {
    // Read off the ring the HUD's zone chip is already showing, so the charge
    // is never a number the player has not been looking at all voyage.
    const at = (cells: number) => landfallShare(SEA_CELL * cells, 0);
    const shares = [1, 3, 5, 9, 13, 30].map(at);
    for (let i = 1; i < shares.length; i++) {
      ok(shares[i] <= shares[i - 1], `ring ${i} keeps no more than the ring inside it`);
    }
    ok(shares[0] > shares[3], 'the near sea is much kinder than the deep');
    ok(shares[shares.length - 1] >= 0.5, 'and the floor holds however far out you go');
    eq(shares[4], shares[5], 'past the table the last band tiles outward forever');
  });

  test('quitting four zones out lands the share, and only the share', () => {
    const v = laden(9, { oro: 400, madera: 200 });   // ring 4
    const quote = previewAbandon(v);
    eq(quote.ring, 4, 'nine cells out is zone 4');
    const events = abandonVoyageInPlace(v);
    eq(events.length, 1, 'the sim says what happened');
    const done = events[0];
    ok(done.kind === 'abandoned' && done.share === quote.share, 'and it charged what it quoted');
    eq(v.cargo.oro, Math.ceil(400 * quote.share), 'the gold that reaches the island');
    eq(v.cargo.madera, Math.ceil(200 * quote.share), 'and the timber');
    ok((v.cargo.oro ?? 0) < 400, 'which is less than was aboard — that is the whole point');
  });

  test('the quote on the button is the price at the till', () => {
    for (const cells of [1, 2.5, 4, 6, 12]) {
      const v = laden(cells, { oro: 137, ron: 41 });
      const quote = previewAbandon(v);
      const before = { ...v.cargo };
      abandonVoyageInPlace(v);
      eq(JSON.stringify(v.cargo), JSON.stringify(quote.kept), `${cells} cells out: quoted exactly`);
      // And the quote itself never moved the ship's hold.
      ok(before.oro === 137, 'previewing charges nothing');
      for (const res of ['oro', 'ron'] as const) {
        eq((quote.kept[res] ?? 0) + (quote.lost[res] ?? 0), before[res], `${res} is all accounted for`);
      }
    }
  });

  test('turning for home at the harbour costs nothing at all', () => {
    const v = laden(0.2, { oro: 500 });
    eq(previewAbandon(v).share, 1, 'inside home water there is nothing to charge');
    abandonVoyageInPlace(v);
    eq(v.cargo.oro, 500, 'the hold is untouched');
  });

  test('sailing her in banks everything the tithe would have taken', () => {
    const out = { ...outboundLaden('bank'), cargo: { oro: 300 } };
    const quit = { ...out, cargo: { ...out.cargo } };
    abandonVoyageInPlace(quit);
    const arrived = sail(out, 20, { throttle: 1 }).voyage;
    ok(arrived.home, 'she made it in');
    eq(arrived.cargo.oro, 300, 'and the whole hold banks');
    ok((quit.cargo.oro ?? 0) < 300, 'where leaving from out there would not have');
  });

  test('being sunk out in the deep costs half, and then the distance', () => {
    // PLAN.md still binds: it is LOOT, never progress. Half the hold rounded in
    // the player's favour, and the crew then swim the same water everyone else
    // sails, so the share applies to what they are carrying.
    const near = sinkAt(0.2, { oro: 400 });
    const far = sinkAt(9, { oro: 400 });
    eq(near.cargo.oro, 200, 'at the harbour mouth it is exactly half');
    eq(near.careened, 0, 'and there is nothing to refloat her from');
    ok((far.cargo.oro ?? 0) < 200, 'four zones out keeps less than half');
    ok(far.careened > 0, 'because the yard has to go and get her');
  });

  test('drowning is never the better answer', () => {
    // If sinking ever paid more than quitting in the same water, the optimal
    // play would be to let the ship go down, and the whole tithe would be a
    // tax on caring.
    for (const cells of [1, 3, 5, 9, 13]) {
      const quit = laden(cells, { oro: 600, madera: 300 });
      abandonVoyageInPlace(quit);
      const drowned = sinkAt(cells, { oro: 600, madera: 300 });
      const total = (c: Partial<Record<string, number>>) =>
        Object.values(c).reduce((a: number, b) => a + (b ?? 0), 0);
      ok(
        total(drowned.cargo) < total(quit.cargo),
        `${cells} cells out: sunk lands ${total(drowned.cargo)}, quit lands ${total(quit.cargo)}`
      );
    }
  });

  test('the careen takes what it can and never leaves a debt', () => {
    const bill = careenBill('skiff');
    ok(bill > 0, `a skiff's refit is worth something (${bill})`);
    const broke = sinkAt(9, { oro: 4 });
    eq(broke.careened <= bill, true, 'it can never take more than it is owed');
    for (const amount of Object.values(broke.cargo)) ok((amount ?? 0) >= 0, 'and never below empty');
    const rich = sinkAt(9, { madera: 800 });
    eq(rich.careened, bill, 'a hold that can cover it pays the whole bill');
  });

  test('a bigger hull is a bigger refit', () => {
    const ladder = ['skiff', 'sloop', 'galleon', 'frigate', 'marauder'].map(careenBill);
    for (let i = 1; i < ladder.length; i++) {
      ok(ladder[i] > ladder[i - 1], `${ladder[i]} costs more to refloat than ${ladder[i - 1]}`);
    }
  });

  test('a voyage that came home on her own bottom owes the yard nothing', () => {
    const arrived = sail(outboundLaden('nobill'), 20, { throttle: 1 }).voyage;
    ok(arrived.home, 'she is in');
    eq(arrived.careened, 0, 'and nobody had to refloat her');
  });
});

/**
 * THE LEDGER BUG, and it is the same shape as every other bug this sea has had:
 * a voyage that goes on happening after the player has been told it ended.
 *
 * Round 13's playtest, verified three times in three: "the end-of-voyage
 * summary does not match the ledger — Voyage A promised Oro 48 and Madera 265
 * and credited +24 and +133", about half. Exactly half is the sinking rule, and
 * that is what it was: the scene's frame loop keeps stepping the simulation
 * while the end card is up, so a ship abandoned at 19% hull with a hammerdead
 * alongside went to the bottom UNDERNEATH the card, and the object the island
 * landed was not the object the card was built from.
 */
describe('a voyage that has ended is over', () => {
  /** The playtest's own move: quit with the hull nearly gone and teeth in it. */
  const cornered = (seed: string) => {
    const v = startVoyage(seed);
    // Ring 3, and fifty units of clear water all round her: the point is what
    // the hold does under the card, so nothing must be able to add to it.
    v.x = -SEA_CELL * 5;
    v.departed = true;
    v.hull = SHIPS.skiff.hull * 0.19;              // "the hull at 19%"
    v.cargo = { oro: 48, madera: 265 };            // the playtest's own manifest
    v.mobs.push({
      id: 1, kind: 'hammerdead', x: v.x - 4, y: 0, heading: 0, hp: 999,
      state: 'attack', cooldown: 0, homeX: v.x, homeY: 0, tether: 0, cell: '-5:0',
    });
    for (let cx = -8; cx <= 0; cx++) for (let cy = -3; cy <= 3; cy++) v.seen.push(`${cx}:${cy}`);
    return v;
  };

  test('the card and the ledger are the same numbers', () => {
    const v = cornered('ledger');
    abandonVoyageInPlace(v);                       // the player taps Volver
    const card = JSON.stringify(v.cargo);          // what the end card prints

    // Now the scene goes on rendering frames for as long as the player reads
    // the card. Ten seconds of them, with the sea exactly as hostile as it was.
    const after = sail(v, 10, { throttle: 0 }).voyage;
    eq(JSON.stringify(after.cargo), card, 'nothing under the card changed the hold');
    ok(!after.sunk, 'and the sea cannot sink a voyage that is already over');
    eq(after.x, v.x, 'she does not drift either');
  });

  test('without the latch the same ten seconds halve it — which is the bug', () => {
    // The evidence that the test above is testing something. Same ship, same
    // sea, same ten seconds, minus the one line that says the voyage ended.
    const v = cornered('ledger');
    const promised = (v.cargo.oro ?? 0) + (v.cargo.madera ?? 0);
    const after = sail(v, 10, { throttle: 0 }).voyage;
    ok(after.sunk, 'left running, this ship goes down while the card is up');
    const credited = (after.cargo.oro ?? 0) + (after.cargo.madera ?? 0);
    ok(credited < promised * 0.75, `promised ${promised}, credited ${credited}`);
  });

  test('arriving home is also an ending, and it holds', () => {
    const arrived = sail(outboundLaden('frozen'), 20, { throttle: 1 }).voyage;
    ok(arrived.home, 'she is in');
    const banked = JSON.stringify(arrived.cargo);
    const later = sail(arrived, 30, { throttle: 1 }).voyage;
    eq(JSON.stringify(later.cargo), banked, 'the hold is banked and stays banked');
    eq(later.x, arrived.x, 'and she does not sail back out from under the card');
    eq(later.step, arrived.step, 'the simulation has genuinely stopped');
  });

  test('abandoning latches once, like every other ending', () => {
    const v = startVoyage('once');
    v.x = SEA_CELL * 9;
    v.departed = true;
    v.cargo = { oro: 1000 };
    eq(abandonVoyageInPlace(v).length, 1, 'the first tap ends the voyage');
    const once = JSON.stringify(v.cargo);
    eq(abandonVoyageInPlace(v).length, 0, 'a second tap is not a second charge');
    eq(JSON.stringify(v.cargo), once, 'and the hold is charged exactly once');
    ok(v.abandoned, 'the flag the scene and the HUD both read');
  });

  test('a sunk ship cannot then be abandoned, or a wreck would pay twice', () => {
    const wreck = sinkAt(5, { oro: 300 });
    const banked = JSON.stringify(wreck.cargo);
    eq(abandonVoyageInPlace(wreck).length, 0, 'there is nothing left to leave');
    eq(JSON.stringify(wreck.cargo), banked, 'and the hold is untouched');
  });

  test('what the card promises is what the island banks', () => {
    // End to end through the real seam: the sim charges its tithe, the scene
    // previews the landing off the stored save, the island lands the same
    // object after the tap. One arithmetic, three readings of it.
    const v = startVoyage('endtoend');
    v.x = SEA_CELL * 5;
    v.departed = true;
    v.cargo = { madera: 300, oro: 90 };
    abandonVoyageInPlace(v);

    const island = clone(quiet());
    const preview = previewLanding(island, v.cargo);
    const later = sail(v, 12, { throttle: 1 }).voyage;   // the card is up a while
    const { landed, spilled } = landCargoInPlace(island, later.cargo);
    eq(JSON.stringify(landed), JSON.stringify(preview.landed), 'the card listed what landed');
    eq(JSON.stringify(spilled), JSON.stringify(preview.spilled), 'and what the caps refused');
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
  /**
   * `greed` is round 17's axis: how many tiers of a sondeo this pilot holds for
   * before steering away and banking. It defaults to the whole ladder, which is
   * the greediest line there is — and since round 17 that is a STRATEGY rather
   * than the only way to take a site, so several of the claims below are about
   * the difference between two of them.
   */
  const fleet = (ring: number, skill: 'novato' | 'veterano', greed?: number, runs = 40) =>
    summarise(playFleet(
      runs,
      { ring, skill, sites: Math.min(6, 1 + ring), limit: 240, greed },
      `t-${skill}-${ring}-${greed ?? 'all'}-`
    ));

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
    ok(four.survived >= five.survived, 'and ring 5 is never kinder than ring 4');
    ok(five.survived < 0.85, `the far sea is a real gamble (${(five.survived * 100).toFixed(0)}% come back)`);
    ok(four.hullHome < 0.9, 'and you come back from ring 4 knowing you were there');
  });

  /**
   * WHAT ROUND 17 CHANGED, SAID OUT LOUD.
   *
   * Before el sondeo a site was taken by touching it, so the far sea was a
   * gamble anybody could take: a beginner stripping ring 5 came home 57% of the
   * time. It no longer is. A survey is eight seconds on station per prize, and
   * six of those at ring 5 is nearly a minute of a starter hull parked in water
   * it is three zones under-rated for, with the tide making the whole time and
   * the survey's own noise calling things in.
   *
   * That is a deliberate change and it is the better game: the far sea is now a
   * gamble for A PILOT WHO KNOWS WHAT THEY ARE DOING, which is what the zone
   * warning has been saying since round 12 and what the shipyard exists to sell
   * the answer to. What must NOT be true is that it is a wall — that skill and
   * restraint buy nothing out there — and that is what this measures.
   */
  test('the far sea is a gamble for somebody who can sail, not a wall', () => {
    const salt = fleet(5, 'veterano');
    ok(salt.survived > 0.2, `a pilot who can sail still gets home from ring 5 (${(salt.survived * 100).toFixed(0)}%)`);
    ok(salt.survived < 0.85, `and it is still a gamble (${(salt.survived * 100).toFixed(0)}%)`);
    ok(
      salt.survived > fleet(5, 'novato').survived,
      'and out there, unlike the shallows, skill is what survival is made of'
    );
  });

  /**
   * THE DECISION EL SONDEO EXISTS TO POSE, measured.
   *
   * SEA_PLAY.md §5: "the question is never 'loot or not' — it is 'is the next
   * tier worth another twenty seconds', asked again every few seconds." That is
   * only true if BOTH answers are live: if holding for the last tier were free
   * the ladder would be a formality, and if it were suicide nobody would ever
   * climb it. So the trade has to show up as more cargo bought with a worse
   * return rate, in the same water, on the same seeds.
   */
  test('holding for the last tier buys cargo and costs hulls', () => {
    const skim = fleet(3, 'novato', 1);
    const strip = fleet(3, 'novato', SONDEO_TIERS.length);
    ok(
      strip.cargoHome > skim.cargoHome * 1.4,
      `stripping a site is worth far more (${strip.cargoHome.toFixed(0)} against ${skim.cargoHome.toFixed(0)})`
    );
    ok(
      skim.survived > strip.survived,
      `and it is paid for in hulls (${(skim.survived * 100).toFixed(0)}% home against ${(strip.survived * 100).toFixed(0)}%)`
    );
    // And the trade is still LIVE in bad water rather than collapsing into one
    // answer: at ring 4 restraint is worth twenty points of return, which is
    // what makes it a decision the player re-takes at every site instead of a
    // habit they formed in the shallows.
    //
    // Measured rather than assumed, and it corrected me: I expected the gap to
    // WIDEN with depth and on these seeds it does not (28pp at ring 3 against
    // 20pp at ring 4). The reason is that a ring-4 skimmer needs more sites to
    // fill the same hold, so restraint buys fewer seconds out there than it
    // does in the shallows — a real property of the design, and not the one I
    // would have written down.
    const deepSkim = fleet(4, 'novato', 1);
    const deepStrip = fleet(4, 'novato', SONDEO_TIERS.length);
    ok(
      deepSkim.survived > deepStrip.survived + 0.1,
      `and in ring 4 water it is worth ${((deepSkim.survived - deepStrip.survived) * 100).toFixed(0)} points of return`
    );
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
    // MEASURED AT RING 2, and the move from ring 4 is a finding rather than a
    // convenience. Since round 17 the careful line pays better per minute from
    // ring 3 out — a survey is eight seconds whoever is holding the helm, so the
    // time a veteran spends standing off is no longer the whole difference
    // between the two trips, while the hull they save is. Skill dominating in
    // deep water is the design; what has to stay true is that the fast careless
    // line is a REAL ANSWER somewhere, and in the water a new player is actually
    // in, it is.
    const green = fleet(2, 'novato');
    const salt = fleet(2, 'veterano');
    ok(green.timeHome < salt.timeHome, 'the reckless line is the quicker trip');
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
    // A lair is deep water, and this fixture now sails in some: departed, so
    // the sea comes for her, and clear of the harbour, so the `home` latch does
    // not end the voyage under the fight.
    // 200 units of runway: two of these cases put way on and hold it for ten
    // seconds, and a hull that grounds mid-dodge reports a hit it never took.
    const at = openWater('kraken', 200);
    v.x = at.x;
    v.y = at.y;
    v.heading = at.heading;
    v.departed = true;
    const post = offBow(v, 0, distance);
    v.mobs.push({
      id: 1, kind: 'squid', x: post.x, y: post.y, heading: v.heading - Math.PI / 2,
      hp: opts.hp ?? MOBS.squid.hp, state: 'patrol', cooldown: 0,
      homeX: post.x, homeY: post.y, tether: 400, cell: '1:0',
    });
    sweep(v);
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
    const post = offBow(again, 0, 14);
    again.mobs.push({
      id: 99, kind: 'squid', x: post.x, y: post.y, heading: again.heading - Math.PI / 2, hp: 1,
      state: 'patrol', cooldown: 0, homeX: post.x, homeY: post.y, tether: 400, cell: '2:0',
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
 * EL SONDEO — the owner's own idea, SEA_PLAY.md §5, and the round that finally
 * answers ROADMAP round 10's "a site is taken by sailing over it, which is the
 * placeholder, not the design".
 *
 * Four properties make it a game rather than a timer, and three of them are the
 * design rather than the feature:
 *
 *   PARTIAL EXTRACTION IS ALWAYS ALLOWED. The question is never "loot or not",
 *     it is "is the next tier worth another few seconds", asked again every few
 *     seconds. One decision at the start would be a menu.
 *   THE ATTENTION IS CAUSED, NOT ROLLED. The survey makes noise and the noise
 *     brings something. A player who dies at 90% must be able to blame
 *     themselves.
 *   IT SPENDS THE ROUND'S OWN CURRENCY. Time on station ages the tide faster
 *     than time sailing, so looting is never free even when nothing comes.
 *   THE VERB IS THE HELM. There is no button in any of this — staying is
 *     steering to stay and leaving is steering away.
 */
describe('el sondeo: the loot is revealed, and only banks when you break off', () => {
  /** The nearest site of `kind` in a seeded sea, and a voyage parked on it. */
  function atSite(seed: string, want: (s: NonNullable<ReturnType<typeof siteAt>>) => boolean) {
    let found = null as ReturnType<typeof siteAt>;
    for (let cx = -8; cx <= 8 && !found; cx++) {
      for (let cy = -8; cy <= 8 && !found; cy++) {
        const s = siteAt(seed, cx, cy);
        if (s && want(s)) found = s;
      }
    }
    ok(found !== null, `${seed} has a site to survey`);
    const v = startVoyage(seed);
    v.x = found!.x;
    v.y = found!.y;
    v.departed = true;
    for (let cx = -9; cx <= 9; cx++) for (let cy = -9; cy <= 9; cy++) v.seen.push(`${cx}:${cy}`);
    return { v, site: found! };
  }

  const atWreck = (seed: string) => atSite(seed, (s) => s.kind === 'wreck');

  test('coming inside the reach starts a survey, and nothing is aboard yet', () => {
    const { v, site } = atWreck('la-leyenda');
    const first = sail(v, 0.5, { throttle: 0 });
    const started = first.events.find((e) => e.kind === 'sondeo-started');
    ok(started?.kind === 'sondeo-started', 'the survey began');
    eq(started?.kind === 'sondeo-started' && started.site, 'wreck', 'and it knows what it is on');
    eq(
      started?.kind === 'sondeo-started' && started.tiers.length, SONDEO_TIERS.length,
      'and hands over the whole ladder, so the screen can name the next rung'
    );
    ok(!first.events.some((e) => e.kind === 'looted'), 'nothing has paid');
    eq(holdUsed(first.voyage), 0, 'and the hold is empty');
    ok(first.voyage.sondeo !== null, 'the voyage knows the boats are away');
    eq(first.voyage.sondeo?.siteId, site.id, 'on this site');
  });

  test('the tiers come up in order, each worth more than the last', () => {
    const { v } = atWreck('la-leyenda');
    const out = sail(v, SONDEO_TIERS[SONDEO_TIERS.length - 1].at + 1, { throttle: 0 });
    const tiers = out.events.filter((e) => e.kind === 'sondeo-tier');
    eq(tiers.length, SONDEO_TIERS.length, 'every rung of the ladder was climbed');
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      if (tier.kind !== 'sondeo-tier') continue;
      eq(tier.tier, i + 1, `tier ${i + 1} announced itself in order`);
      eq(tier.share, SONDEO_TIERS[i].share, 'at the share the table says');
      const gained = Object.values(tier.gained).reduce((a, b) => a + (b ?? 0), 0);
      ok(gained > 0, `tier ${i + 1} turned something up`);
    }
    // The last rung is worth more than the first: that is where the intriga is.
    const first = tiers[0];
    const last = tiers[tiers.length - 1];
    if (first.kind === 'sondeo-tier' && last.kind === 'sondeo-tier') {
      const a = Object.values(first.gained).reduce((x, y) => x + (y ?? 0), 0);
      const b = Object.values(last.gained).reduce((x, y) => x + (y ?? 0), 0);
      ok(b > a, `the last tier pays ${b} against the first's ${a}`);
    }
  });

  test('breaking off banks what was turned up, and never more', () => {
    const { v } = atWreck('la-leyenda');
    // Long enough for exactly one rung, then away.
    const early = sail(v, SONDEO_TIERS[0].at + 0.2, { throttle: 0 });
    eq(early.voyage.sondeo?.tier, 1, 'one tier up');
    const secured = Object.values(early.voyage.sondeo?.revealed ?? {})
      .reduce((a, b) => a + (b ?? 0), 0);
    ok(secured > 0, 'and it is holding something');

    const gone = sail(early.voyage, 4, { throttle: 1 });
    const ended = gone.events.find((e) => e.kind === 'sondeo-ended');
    ok(ended?.kind === 'sondeo-ended', 'the survey ended');
    eq(ended?.kind === 'sondeo-ended' && ended.whole, false, 'and it says it was not finished');
    const looted = gone.events.find((e) => e.kind === 'looted');
    ok(looted?.kind === 'looted', 'BAILING PAYS — that is the whole mechanic');
    eq(holdUsed(gone.voyage), secured, 'exactly what was turned up, and not a unit more');
    eq(gone.voyage.sondeo, null, 'and the boats are back');
  });

  test('a survey run to the end pays the whole site without sailing away', () => {
    const { v, site } = atWreck('la-leyenda');
    const out = sail(v, SONDEO_TIERS[SONDEO_TIERS.length - 1].at + 1, { throttle: 0 });
    const ended = out.events.find((e) => e.kind === 'sondeo-ended');
    ok(ended?.kind === 'sondeo-ended' && ended.whole, 'it finished rather than being broken off');
    const whole = Object.values(site.loot).reduce((a, b) => a + (b ?? 0), 0);
    // Measured off the 'looted' for THIS site rather than off the hold: a ship
    // parked where two prizes overlap starts surveying the neighbour the moment
    // this one ends, and the hold would then be carrying both.
    const paid = out.events
      .filter((e) => e.kind === 'looted' && e.x === site.x && e.y === site.y)
      .reduce((sum, e) => sum + (e.kind === 'looted'
        ? Object.values(e.loot).reduce((a, b) => a + (b ?? 0), 0) : 0), 0);
    eq(paid, whole, 'and the last tier pays the site out exactly');
  });

  test('breaking off SPENDS the site: no coming back for the rest', () => {
    const { v, site } = atWreck('la-leyenda');
    const early = sail(v, SONDEO_TIERS[0].at + 0.2, { throttle: 0 });
    const gone = sail(early.voyage, 4, { throttle: 1 });
    ok(gone.voyage.taken.includes(site.id), 'the site is spent');
    const banked = holdUsed(gone.voyage);

    // Come round again and park on it. Nothing.
    const back = sail({ ...gone.voyage, x: site.x, y: site.y }, 3, { throttle: 0 });
    ok(!back.events.some((e) => e.kind === 'sondeo-started'), 'no second survey');
    eq(holdUsed(back.voyage), banked, 'and not a unit more in the hold');
  });

  test('the survey makes NOISE, and the noise is what comes', () => {
    const { v, site } = atWreck('la-leyenda');
    const quiet = v.mobs.length;
    const out = sail(v, SONDEO_TIERS[SONDEO_TIERS.length - 1].at, { throttle: 0 });
    const heard = out.events.filter((e) => e.kind === 'sondeo-noise');
    ok(heard.length > 0, `staying drew ${heard.length} of them`);
    ok(out.voyage.mobs.length > quiet, 'and they are really on the water');
    // CAUSED, not rolled: every one of them is tagged with the site that made
    // the noise, so nothing here is a creature that happened to be passing.
    const drawn = out.voyage.mobs.filter((m) => m.cell.startsWith(`sondeo:${site.id}:`));
    ok(drawn.length > 0, 'and they are tagged with the survey that called them');
    // At most, because the broadsides fire themselves: some of what the noise
    // drew is already on the bottom by the time the survey ends, which is the
    // fight the mechanic is for.
    ok(drawn.length <= heard.length, 'and nothing arrived that this survey did not call');
    // Close enough to matter. A threat that surfaces outside its own sight is
    // scenery — the swell learned that the hard way in round 16.
    for (const mob of drawn) {
      const gap = Math.hypot(mob.x - site.x, mob.y - site.y);
      ok(gap <= MOBS[mob.kind].sight, `${mob.kind} surfaced inside its own sight (${gap.toFixed(0)})`);
    }
  });

  test('a short survey draws less than a long one — the danger is the CHOICE', () => {
    const drew = (seconds: number): number => {
      const { v, site } = atWreck('la-leyenda');
      const out = sail(v, seconds, { throttle: 0 });
      return out.voyage.mobs.filter((m) => m.cell.startsWith(`sondeo:${site.id}:`)).length;
    };
    ok(
      drew(SONDEO_TIERS[SONDEO_TIERS.length - 1].at) > drew(SONDEO_TIERS[0].at + 0.2),
      'staying for the good stuff is what brings the sea'
    );
  });

  test('time on station spends the tide, and faster than time sailing', () => {
    // The same seconds, one of them spent surveying and one spent sailing in
    // open water. SEA_PLAY.md §5: "looting raises the tide" is the sentence
    // that makes this a cost rather than a free timer.
    // Both start past `grace`, or the tide is flat at zero on both sides and
    // the comparison measures nothing at all.
    const { v } = atWreck('la-leyenda');
    v.atSea = 60;
    const control = underWayFar('la-leyenda');
    control.atSea = 60;
    const surveyed = sail(v, 12, { throttle: 0 }).voyage;
    const sailing = sail(control, 12, { throttle: 0 }).voyage;
    near(surveyed.atSea, sailing.atSea, 0.001, 'the same wall clock either way');
    ok(surveyed.surveyed > 0, 'the survey was counted');
    ok(
      surveyed.tide > sailing.tide,
      `the tide is further in after a survey (${surveyed.tide.toFixed(3)} against ${sailing.tide.toFixed(3)})`
    );
  });

  /** Open water far from any site, for the control above: the same seconds with
   *  nothing to survey. */
  function underWayFar(seed: string): Voyage {
    const v = startVoyage(seed);
    const at = openWater(seed);
    v.x = at.x;
    v.y = at.y;
    v.departed = true;
    sweep(v);
    return v;
  }

  test('a full hold refuses to start one rather than spending the site', () => {
    const { v, site } = atWreck('la-leyenda');
    v.cargo = { oro: SHIPS.skiff.hold };
    const out = sail(v, 3, { throttle: 0 });
    ok(!out.events.some((e) => e.kind === 'sondeo-started'), 'no survey on a full hold');
    ok(out.events.some((e) => e.kind === 'hold-full'), 'and it says why');
    ok(!out.voyage.taken.includes(site.id), 'the site is NOT spent for nothing');
  });

  test('sinking mid-survey loses every unbanked unit of it', () => {
    const { v } = atWreck('la-leyenda');
    v.hull = 1;
    v.mobs.push({
      id: 77, kind: 'hammerdead', x: v.x + 4, y: v.y, heading: Math.PI, hp: 999,
      state: 'attack', cooldown: 0, homeX: v.x + 4, homeY: v.y, tether: 0, cell: '9:9',
    });
    const out = sail(v, SONDEO_TIERS[0].at + 1, { throttle: 0 });
    ok(out.voyage.sunk, 'she went down with the boats away');
    eq(holdUsed(out.voyage), 0, 'and every unbanked unit went with her');
    ok(!out.events.some((e) => e.kind === 'looted'), 'nothing was ever banked');
  });

  test('the wait has teeth: the sea keeps biting while the boats are away', () => {
    const { v } = atWreck('la-leyenda');
    v.mobs.push({
      id: 77, kind: 'kelpling', x: v.x + 5, y: v.y, heading: Math.PI, hp: 999,
      state: 'attack', cooldown: 0, homeX: v.x + 5, homeY: v.y, tether: 0, cell: '9:9',
    });
    const { events } = sail(v, SONDEO_TIERS[SONDEO_TIERS.length - 1].at + 1, { throttle: 0 });
    ok(events.some((e) => e.kind === 'looted'), 'the survey still completes');
    ok(
      events.some((e) => e.kind === 'hit' && e.target === 'ship' && e.by === 'mob'),
      'but the hull paid for the wait — surveying under fire is a choice'
    );
  });

  test('a survey replays exactly, noise and all', () => {
    const run = () => sail(atWreck('replay-sondeo').v, 12, { throttle: 0 }).voyage;
    const a = run();
    const b = run();
    eq(a.mobs.length, b.mobs.length, 'the same creatures were drawn');
    eq(holdUsed(a), holdUsed(b), 'the same cargo turned up');
    eq(a.hull, b.hull, 'and the same damage taken');
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

/**
 * LA MAREA — SEA_PLAY.md item 1, which is the voyage's arc.
 *
 * The diagnosis it answers, verbatim: "Minute ten is exactly as tense as minute
 * one. Pressure is spatial only — it rises when you sail outward and falls when
 * you sail back — so the only shape a voyage has is one the player draws by
 * leaving." Distance was the whole difficulty curve and there was no clock.
 *
 * Four claims, and every one of them is asserted below rather than described:
 * the tide MULTIPLIES the ring curve instead of replacing it; a first voyage
 * sails in the sea the fleet table measured, unchanged, because the grace
 * covers it; the sea gets worse in the three ways the design names — more,
 * tougher, closer; and the player is TOLD, because a rising threat nobody can
 * see is a difficulty knob and this file is not allowed to have one.
 */
describe('the tide is the voyage clock', () => {
  test('slack water first, then it makes, and it never ebbs', () => {
    eq(tideAt(0), 0, 'the harbour is slack water');
    eq(tideAt(30), 0, 'and so is half a minute out — the grace is the whole point');
    const walk = [0, 30, 60, 90, 150, 210, 300, 600, 3600].map((s) => tideAt(s));
    for (let i = 1; i < walk.length; i++) {
      ok(walk[i] >= walk[i - 1], `the tide at step ${i} is never below the one before it`);
    }
    ok(tideAt(180) > 0.3 && tideAt(180) < 0.8, `three minutes out is mid-flood (${tideAt(180).toFixed(2)})`);
    eq(tideAt(600), 1, 'and ten minutes out is as bad as it gets');
    eq(tideAt(6000), 1, 'which is a ceiling, not a ramp with no end');
  });

  test('the clock and its inverse agree, which is what the HUD counts down to', () => {
    for (const level of [0, 0.25, 0.5, 0.75, 1]) {
      near(tideAt(tideClock(level)), level, 1e-9, `the clock for ${level} reads back as ${level}`);
    }
    // Contramaestre: the whole clock later, grace included.
    ok(tideClock(0.5, 0.6) > tideClock(0.5), 'a slower tide reaches half flood later');
    eq(tideAt(200, 0), 0, 'and a tide rate of zero is a sea with no clock at all');
  });

  test('the stages are named, ordered, and a real player crosses all of them', () => {
    eq(tideStageOf(0), 0, 'slack water is stage zero');
    eq(tideStageOf(1), TIDE_STAGES.length - 1, 'and full flood is the last one');
    let last = -1;
    for (let level = 0; level <= 1.0001; level += 0.02) {
      const stage = tideStageOf(Math.min(1, level));
      ok(stage >= last, `the stage never goes backwards (at ${level.toFixed(2)})`);
      last = stage;
    }
    eq(new Set(TIDE_STAGES).size, TIDE_STAGES.length, 'and every stage has its own name');
  });

  /**
   * THE ONE THAT PROTECTS EVERYTHING ALREADY MEASURED.
   *
   * Round 12 measured ring 1 at 100% returns and the whole fleet table is
   * written against a sea with no clock in it. That table stays true only if
   * slack water is BYTE-IDENTICAL to the sea that shipped — same rolls, same
   * order, same cell stream — so the tide is a coefficient that is exactly 1
   * for the first `grace` seconds rather than a rewrite of the spawner.
   */
  test('slack water is the sea that was measured, exactly', () => {
    for (let cx = -8; cx <= 8; cx++) {
      for (let cy = -8; cy <= 8; cy++) {
        const before = mobsAt('la-leyenda', cx, cy, 1);
        const after = mobsAt('la-leyenda', cx, cy, 1, { tide: 0, toward: { x: 0, y: 0 } });
        eq(JSON.stringify(after), JSON.stringify(before), `cell ${cx},${cy} is untouched at slack water`);
      }
    }
  });

  test('a first voyage never leaves slack water', () => {
    // ROUND 17 MOVED THIS, and the change is worth writing down rather than
    // quietly weakening. Before el sondeo a ring-1 trip finished inside `grace`
    // with the tide at EXACTLY zero, and the promise was that a beginner sails
    // the sea the fleet table measured, roll for roll. A survey now costs its
    // seconds twice — once on the wall clock and again through `sondeo.tide` —
    // so two prizes stripped to the last rung push a first voyage a little past
    // the grace and the tide reads about 0.035.
    //
    // The promise that actually matters is the one the PLAYER can be told, and
    // it is unchanged: a first voyage never leaves slack water. `tideStageOf`
    // is what the HUD prints, what the plate announces and what decides whether
    // the sea has a new name — and at 0.035 the answer is still Calma, with the
    // first named stage three tenths away. The beginner is not lied to and is
    // not hunted; they are just no longer at a hard zero.
    const first = summarise(playFleet(24, { ring: 1, skill: 'novato', sites: 2, limit: 240 }, 't-tide-first-'));
    ok(first.survived >= 0.95, `a beginner still comes home from ring 1 (${(first.survived * 100).toFixed(0)}%)`);
    eq(tideStageOf(first.tide), 0, `and does it in slack water (level ${first.tide.toFixed(3)})`);
    ok(first.tide < TIDE_STAGE_AT[1] * 0.5, 'and not even halfway to the first stage that has a name');
    const second = summarise(playFleet(24, { ring: 2, skill: 'novato', sites: 3, limit: 240 }, 't-tide-second-'));
    eq(tideStageOf(second.tide), 0, `ring 2 is still slack water too (${second.tide.toFixed(3)})`);
  });

  /** More of them, and it is the RING's own draw that is multiplied. */
  test('the flood posts more than slack water does, at every ring', () => {
    const count = (ring: number, tide: number) => {
      let total = 0;
      for (const [cx, cy] of cellsInRing(ring)) {
        total += mobsAt('la-leyenda', cx, cy, 1, { tide }).length;
      }
      return total;
    };
    for (const ring of [1, 2, 3, 4]) {
      const slack = count(ring, 0);
      const flood = count(ring, 1);
      ok(flood > slack, `ring ${ring} posts ${flood} at the flood against ${slack} at slack`);
    }
    // And it is still the ring that decides the SHAPE of the sea. Ring 1 at the
    // worst hour it has must not out-post ring 4 at its best, or distance has
    // stopped being difficulty and the tide has replaced the curve instead of
    // multiplying it.
    const perCell = (ring: number, tide: number) => count(ring, tide) / cellsInRing(ring).length;
    ok(
      perCell(1, 1) < perCell(4, 0),
      `ring 1 flooded (${perCell(1, 1).toFixed(2)}/cell) is still thinner than ring 4 at slack (${perCell(4, 0).toFixed(2)}/cell)`
    );
  });

  test('and what it posts is tougher, and posted closer in', () => {
    let slackHp = 0;
    let floodHp = 0;
    let slackPost = 0;
    let floodPost = 0;
    let posts = 0;
    for (const [cx, cy] of cellsInRing(3)) {
      const site = siteAt('la-leyenda', cx, cy);
      for (const mob of mobsAt('la-leyenda', cx, cy, 1, { tide: 0 })) slackHp += mob.hp / MOBS[mob.kind].hp;
      for (const mob of mobsAt('la-leyenda', cx, cy, 1, { tide: 1 })) floodHp += mob.hp / MOBS[mob.kind].hp;
      if (!site || site.kind === 'reef' || site.kind === 'lair') continue;
      const gap = (tide: number) => mobsAt('la-leyenda', cx, cy, 1, { tide })
        .map((m) => Math.hypot(m.homeX - site.x, m.homeY - site.y));
      const a = gap(0);
      const b = gap(1);
      // Compared guard for guard on the same draws, so this is the POST
      // shrinking rather than a different number of guards being averaged.
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        slackPost += a[i];
        floodPost += b[i];
        posts++;
      }
    }
    ok(floodHp > slackHp * 1.2, `the flood's shoal carries ${(floodHp / slackHp).toFixed(2)}x the hit points`);
    ok(posts > 10, `and there were guards to measure (${posts})`);
    ok(floodPost < slackPost, `guards hug their site harder at the flood (${(floodPost / posts).toFixed(1)} against ${(slackPost / posts).toFixed(1)} units off)`);
  });

  test('a bite taken late is a worse bite than the same bite taken early', () => {
    const bite = (tide: number): number => {
      const v = startVoyage('bite');
      v.departed = true;   // a tide this high is hours from the harbour
      const [mob] = mobsAt('la-leyenda', 2, 0, 1, { tide: 1 });
      v.mobs.push({
        ...(mob ?? { id: 1, kind: 'kelpling' as const, heading: 0, state: 'attack' as const, cooldown: 0, tether: 0, cell: '0:0' }),
        id: 1, kind: 'kelpling', x: 4, y: 0, homeX: 4, homeY: 0, hp: 9999,
        state: 'attack', cooldown: 0, tether: 0, cell: '0:0', heading: Math.PI,
        tough: tide > 0 ? 1 + tide * 0.5 : undefined,
      });
      for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) v.seen.push(`${cx}:${cy}`);
      const { events } = sail(v, 4, { throttle: 0 });
      const hit = events.find((e) => e.kind === 'hit' && e.target === 'ship' && e.by === 'mob');
      return hit?.kind === 'hit' ? hit.damage : 0;
    };
    const early = bite(0);
    const late = bite(1);
    eq(early, MOBS.kelpling.damage, 'at slack water a kelpling bites for exactly what the table says');
    ok(late > early, `and the same creature born at the flood bites for ${late} instead of ${early}`);
  });

  /**
   * The clock on its own, with the fight taken out of it: a ship still
   * alongside, which the sea leaves alone (see `sheltered` in sea.ts), so what
   * this measures is the TIDE and not how long a skiff survives ring 1.
   */
  test('the voyage carries the tide, and says so once per stage', () => {
    let v = startVoyage('marea');
    const stages: number[] = [];
    const levels: number[] = [];
    for (let i = 0; i < Math.round(330 / SEA_STEP); i++) {
      const out = stepVoyage(v);
      v = out.voyage;
      levels.push(v.tide);
      for (const e of out.events) if (e.kind === 'tide-turn') stages.push(e.stage);
    }
    for (let i = 1; i < levels.length; i++) ok(levels[i] >= levels[i - 1], 'the level on the voyage only rises');
    eq(v.tide, 1, 'five and a half minutes out is full flood');
    eq(JSON.stringify(stages), JSON.stringify([1, 2, 3]), 'and every stage announced itself exactly once, in order');
    const read = readTide(v);
    eq(read.stage, TIDE_STAGES.length - 1, 'the read agrees with the voyage');
    eq(read.stageId, TIDE_STAGES[TIDE_STAGES.length - 1], 'and names it');
    eq(read.toNext, 0, 'with nothing left to count down to');
    ok(read.spawns > 1 && read.toughness > 1, 'and prints what the sea is doing, so the HUD can say it');
  });

  test('the countdown is a real countdown', () => {
    let v = startVoyage('cuenta');
    for (let i = 0; i < Math.round(90 / SEA_STEP); i++) v = stepVoyage(v).voyage;
    const read = readTide(v);
    ok(read.stage < TIDE_STAGES.length - 1, 'a minute and a half out is not the worst of it yet');
    ok(read.toNext > 0, `and there is a stated number of seconds before it gets worse (${read.toNext.toFixed(0)}s)`);
    let later = v;
    for (let i = 0; i < Math.round((read.toNext + 0.2) / SEA_STEP); i++) later = stepVoyage(later).voyage;
    ok(readTide(later).stage > read.stage, 'and waiting exactly that long is what it takes');
  });

  /**
   * THE SWELL, and it is why the tide is an arc rather than an exploration tax.
   *
   * A cell hands over its patrol once per voyage, so a ship parked in swept
   * water meets nothing however long it waits. Without this the whole system
   * could be sat out by stopping, which is the opposite of rising action.
   */
  test('the sea comes to a ship that will not come to it', () => {
    // Parked, throttle shut, in ring 2, for long enough for the tide to make.
    const v = startVoyage('oleada');
    v.x = SEA_CELL * 3.5;
    v.departed = true;
    for (let cx = -12; cx <= 12; cx++) for (let cy = -12; cy <= 12; cy++) v.seen.push(`${cx}:${cy}`);
    const { voyage, events } = sail(v, 200, { throttle: 0 });
    const swells = events.filter((e) => e.kind === 'swell');
    ok(swells.length >= 3, `the tide sent something ${swells.length} times`);
    ok(voyage.mobs.length > 0, 'and it is on the water beside her');
    ok(
      events.some((e) => e.kind === 'hit' && e.target === 'ship' && e.by === 'mob'),
      'and it reached her — a swell that never arrives is scenery'
    );
    // Bigger, and nearer, as it goes on: the last swell of a voyage must not be
    // the same event as the first or the tide is a metronome, not a threat.
    const first = swells[0];
    const last = swells[swells.length - 1];
    ok(first.kind === 'swell' && last.kind === 'swell' && last.level > first.level, 'and the sea is worse by the end than it was at the start');
  });

  test('home water is never swollen — a voyage can always end', () => {
    const v = startVoyage('puerto');
    for (let cx = -6; cx <= 6; cx++) for (let cy = -6; cy <= 6; cy++) v.seen.push(`${cx}:${cy}`);
    const { voyage, events } = sail(v, 240, { throttle: 0 });
    ok(voyage.tide > 0.5, 'four minutes at the mooring is a made tide');
    eq(events.filter((e) => e.kind === 'swell').length, 0, 'and the harbour is still empty water');
    eq(voyage.mobs.length, 0, 'with nothing in it');
  });

  test('however high it gets, the fight stays countable', () => {
    const v = startVoyage('gentio');
    v.x = SEA_CELL * 12;              // ring 4, the busiest pool in the game
    v.departed = true;
    let worst = 0;
    let cur = steer(v, { throttle: 0 });
    for (let i = 0; i < Math.round(420 / SEA_STEP); i++) {
      cur = stepVoyage(cur).voyage;
      worst = Math.max(worst, cur.mobs.length);
      if (cur.sunk) break;
    }
    // The same budget `patrols` is written against, and the same reason: a
    // fight nobody can count is weather, and it is also a draw-call bill.
    ok(worst <= 16, `the worst hour of the worst water put ${worst} creatures on the sea at once`);
  });

  test('a voyage with a tide in it still replays exactly', () => {
    const run = () => {
      let v = startVoyage('replay-marea');
      for (let i = 0; i < Math.round(200 / SEA_STEP); i++) v = stepVoyage(steer(v, { turn: 0.2, throttle: 1 })).voyage;
      return v;
    };
    const a = run();
    const b = run();
    eq(a.x, b.x, 'same seed, same helm, same position');
    eq(a.hull, b.hull, 'the same damage taken');
    eq(a.swells, b.swells, 'and the sea sent the same swells at the same moments');
    eq(a.mobs.length, b.mobs.length, 'with the same creatures still afloat');
  });

  /**
   * THE SHAPE, MEASURED. SEA_PLAY.md: "tools/voyages.mjs must show the tide
   * producing a survival curve that falls with time at sea."
   *
   * The control is what makes this an assertion about the TIDE rather than
   * about being out longer, which costs something in any sea: the same fleet,
   * the same seeds, the same water, with the clock stopped through the loadout.
   */
  test('survival falls with time at sea, and the tide is why', () => {
    const stay = (loiter: number, loadout?: Partial<Loadout>) => summarise(playFleet(
      24, { ring: 2, skill: 'novato', sites: 3, limit: loiter + 240, loiter, loadout }, `t-marea-${loiter}-`
    ));
    const quick = stay(0);
    const long = stay(240);
    const control = stay(240, { tideRate: 0 });
    ok(quick.survived >= 0.9, `a ring-2 trip that does not linger comes home (${(quick.survived * 100).toFixed(0)}%)`);
    ok(
      long.survived < quick.survived - 0.2,
      `four minutes of one-more-site costs ${((quick.survived - long.survived) * 100).toFixed(0)} points of it (${(long.survived * 100).toFixed(0)}%)`
    );
    ok(
      control.survived > long.survived + 0.15,
      `and the same four minutes with the clock stopped comes home ${((control.survived - long.survived) * 100).toFixed(0)} points more often (${(control.survived * 100).toFixed(0)}%) — the fall is the tide`
    );
  });
});

/**
 * THE HOLD HAS WEIGHT — SEA_PLAY.md item 2.
 *
 * "A full hold weighs nothing. Turning costs nothing. Fleeing is free. Every
 * decision the sea offers is currently yes." The cheapest change that makes
 * risk physical instead of numerical, and the one that gives the tide teeth:
 * heavy and late is exactly when the sea should be frightening.
 *
 * The line the design draws, and every case here is on one side of it: the
 * penalty falls on DODGING and barely on ESCAPE. A full hold must be a decision
 * with a price, never a punishment for having succeeded.
 */
describe('the hold has weight', () => {
  const laden = (ship: string, load: number): Voyage => {
    const v = startVoyage('peso', ship);
    v.cargo = { oro: Math.round(SHIPS[ship].hold * load) };
    return v;
  };

  test('an empty hold is exactly the ship the shipyard sold', () => {
    for (const ship of SHIP_TYPES) {
      const spec = effectiveShip(startVoyage('vacio', ship));
      eq(JSON.stringify(spec), JSON.stringify(SHIPS[ship]), `an empty ${ship} is the ${ship} on the sheet`);
    }
  });

  test('cargo costs speed and helm, in proportion to how full she is', () => {
    const empty = effectiveShip(laden('skiff', 0));
    const half = effectiveShip(laden('skiff', 0.5));
    const full = effectiveShip(laden('skiff', 1));
    ok(full.speed < half.speed && half.speed < empty.speed, 'every unit aboard is a unit of way');
    ok(full.turn < half.turn && half.turn < empty.turn, 'and a wider turn');
    ok(full.accel < empty.accel, 'and a slower pickup out of a standing start');
    ok(full.turnDrag > empty.turnDrag, 'and more way lost through a hard turn');
    near(
      (empty.speed - half.speed) * 2, empty.speed - full.speed, 1e-9,
      'and it is proportional — half a hold costs half of what a full one does'
    );
  });

  test('the hold cannot be over-full, and the numbers cannot invert', () => {
    const over = laden('skiff', 3);
    eq(holdLoad(over), 1, 'a hold stuffed past its own bottom is still just full');
    const spec = effectiveShip(over);
    ok(spec.speed > 0 && spec.turn > 0 && spec.accel > 0, 'and she still sails');
    ok(spec.turnDrag < 1, 'and a hard turn can never stop her dead');
  });

  test('what a full hold does NOT cost is the hull, the hold or the guns', () => {
    for (const ship of SHIP_TYPES) {
      const spec = effectiveShip(laden(ship, 1));
      eq(spec.hull, SHIPS[ship].hull, `a laden ${ship} is as strong as an empty one`);
      eq(spec.hold, SHIPS[ship].hold, 'and the hold does not shrink under its own cargo');
      eq(spec.damage, SHIPS[ship].damage, 'and the guns hit as hard');
      eq(spec.radius, SHIPS[ship].radius, 'and she is the same size boat');
      eq(spec.rated, SHIPS[ship].rated, 'and rated for the same water');
    }
  });

  test('a decision, not a punishment: a full hold still outruns the sea', () => {
    // The rule that keeps item 2 from turning into a tax on succeeding. If a
    // laden ship could be run down by a hammerdead, the correct play would be
    // to stop taking sites — and the whole risk curve inverts.
    const fastest = Math.max(...Object.values(MOBS).map((m) => m.speed));
    for (const ship of SHIP_TYPES) {
      const spec = effectiveShip(laden(ship, 1));
      ok(
        spec.speed > fastest * 1.15,
        `a full ${ship} makes ${spec.speed.toFixed(1)} against the sea's fastest ${fastest}`
      );
    }
  });

  test('and she sails the way the numbers say, not just reads that way', () => {
    // The stats are one thing; the track through the water is what a thumb
    // feels. Same seed, same helm, same seconds — one loaded, one not.
    const run = (load: number) => {
      let v = laden('skiff', load);
      v.departed = true;
      for (let cx = -6; cx <= 6; cx++) for (let cy = -6; cy <= 6; cy++) v.seen.push(`${cx}:${cy}`);
      let heading = 0;
      for (let i = 0; i < Math.round(6 / SEA_STEP); i++) {
        v = stepVoyage(steer(v, { turn: 1, throttle: 1 })).voyage;
        heading = v.heading;
      }
      return { swept: heading, gone: Math.hypot(v.x, v.y), speed: v.speed };
    };
    const light = run(0);
    const heavy = run(1);
    ok(heavy.speed < light.speed, `a full hold is slower through the water (${heavy.speed.toFixed(1)} against ${light.speed.toFixed(1)})`);
    ok(
      heavy.swept < light.swept,
      `and six seconds of full helm turns her ${(light.swept - heavy.swept).toFixed(2)} radians less far round`
    );
  });

  /**
   * SEA_PLAY.md's own measurement: "the weight showing up as a measurable
   * difference between running home loaded and running home empty."
   */
  test('running home rich is a harder job than running home empty', () => {
    const row = weightRun(24, 4, 1);
    ok(
      row.fullSeconds > row.emptySeconds + 1,
      `the same escape takes ${(row.fullSeconds - row.emptySeconds).toFixed(1)}s longer with the hold full (${row.fullSeconds.toFixed(1)}s against ${row.emptySeconds.toFixed(1)}s)`
    );
    ok(
      row.fullHull < row.emptyHull,
      `and she comes in more beaten (${(row.fullHull * 100).toFixed(0)}% against ${(row.emptyHull * 100).toFixed(0)}%)`
    );
    // But still gets in. A rich ship that could not get home would make the
    // whole risk curve read backwards.
    ok(row.fullHome >= 0.6, `and she still gets in (${(row.fullHome * 100).toFixed(0)}%)`);
  });
});

/**
 * PERTRECHOS — SEA_PLAY.md item 3, from the sim's side of the seam.
 *
 * The pool, the thresholds and the one-of-three offer are another module's
 * work and are deliberately absent. What is asserted here is the CONTRACT that
 * module builds against: a flat bag of named coefficients, neutral by default,
 * each one landing in exactly one place in the simulation, and an empty bag
 * reproducing the shipped ship step for step.
 */
describe('the pertrechos seam', () => {
  const gear = (partial: Partial<Loadout>): Loadout => loadoutOf(partial);

  test('an empty loadout is not a loadout at all', () => {
    eq(JSON.stringify(loadoutOf()), JSON.stringify(NEUTRAL_LOADOUT), 'nothing in means neutral out');
    eq(JSON.stringify(startVoyage('neutro').loadout), JSON.stringify(NEUTRAL_LOADOUT), 'and a voyage starts neutral');
    // The property that let this land before the module that fills it: the same
    // voyage with an explicitly neutral loadout is the same voyage, step for
    // step, hull for hull, over long enough for every system to have run.
    const run = (loadout?: Partial<Loadout>) => {
      let v = startVoyage('sin-pertrechos', 'skiff', { loadout });
      for (let i = 0; i < Math.round(120 / SEA_STEP); i++) {
        v = stepVoyage(steer(v, { turn: 0.25, throttle: 1 })).voyage;
      }
      return `${v.x.toFixed(6)}|${v.y.toFixed(6)}|${v.hull.toFixed(6)}|${v.mobs.length}|${v.swells}|${holdUsed(v)}`;
    };
    eq(run({}), run(), 'an empty bag changes nothing about the voyage');
  });

  test('a partial loadout is filled in, never left with holes', () => {
    const one = gear({ reload: 0.7 });
    eq(one.reload, 0.7, 'what was given is kept');
    eq(one.range, 1, 'and everything else is neutral');
    eq(one.spread, false, 'including the flags');
    eq(one.chainSlow, 0, 'and the ones whose identity is zero');
  });

  test('the guns read reload, range and arc', () => {
    const shots = (loadout: Partial<Loadout>, at: { x: number; y: number }) => {
      const v = startVoyage('canones', 'skiff', { loadout });
      // Under way in clear water: alongside, the sea leaves her alone and the
      // `home` latch would end the voyage before a second broadside reloaded.
      const here = openWater('canones');
      v.x = here.x;
      v.y = here.y;
      v.heading = here.heading;
      v.departed = true;
      // `at` is written in the ship's frame: x ahead, y off the starboard beam.
      const post = offBow(v, at.x, at.y);
      v.mobs.push({
        id: 1, kind: 'blowfish', x: post.x, y: post.y, heading: v.heading, hp: 99999,
        state: 'patrol', cooldown: 0, homeX: post.x, homeY: post.y, tether: 0, cell: '0:1',
      });
      sweep(v);
      return sail(v, 10, { throttle: 0 }).events.filter((e) => e.kind === 'fired').length;
    };
    const abeam = { x: 0, y: 26 };
    ok(shots({ reload: 0.5 }, abeam) > shots({}, abeam), 'a faster reload is more broadsides in the same ten seconds');
    // Past the skiff's 54 by more than the 16-unit circle a patrol walks round
    // its own anchor — six units of margin was less than the patrol's own orbit,
    // so the target strolled INTO range and the base gun scored a hit off it.
    const far = { x: 0, y: SHIPS.skiff.range + 24 };
    eq(shots({}, far), 0, 'out of range is out of range');
    ok(shots({ range: 1.4 }, far) > 0, 'and a longer gun reaches it');
    // Off the beam by more than the arc, so only a wider arc bears.
    const bearing = SHIPS.skiff.arc + 0.18;
    const wide = { x: Math.cos(Math.PI / 2 - bearing) * 30, y: Math.sin(Math.PI / 2 - bearing) * 30 };
    eq(shots({}, wide), 0, 'and outside the arc nothing fires');
    ok(shots({ arc: 1.6 }, wide) > 0, 'until the arc is opened');
  });

  test('the helm reads speed and turn', () => {
    const sailed = (loadout: Partial<Loadout>) => {
      let v = startVoyage('timon', 'skiff', { loadout });
      for (let i = 0; i < Math.round(8 / SEA_STEP); i++) {
        v = stepVoyage(steer(v, { turn: 1, throttle: 1 })).voyage;
      }
      return { speed: v.speed, swept: v.heading };
    };
    ok(sailed({ speed: 1.25 }).speed > sailed({}).speed, 'a faster hull is faster');
    ok(sailed({ turn: 1.35 }).swept > sailed({}).swept, 'and a better helm comes round further');
  });

  test('the tide reads its own rate', () => {
    const after = (rate: number) => {
      let v = startVoyage('contramaestre', 'skiff', { loadout: { tideRate: rate } });
      for (let i = 0; i < Math.round(200 / SEA_STEP); i++) v = stepVoyage(v).voyage;
      return v.tide;
    };
    ok(after(0.6) < after(1), `the contramaestre buys a lower tide at the same hour (${after(0.6).toFixed(2)} against ${after(1).toFixed(2)})`);
    eq(after(0), 0, 'and a rate of zero is the control the harness sweeps against');
  });

  test('chain shot slows what it hits', () => {
    const chased = (chainSlow: number) => {
      const v = startVoyage('palanqueta', 'skiff', { loadout: { chainSlow } });
      v.mobs.push({
        id: 1, kind: 'hammerdead', x: 0, y: 30, heading: -Math.PI / 2, hp: 99999,
        state: 'chase', cooldown: 0, homeX: 0, homeY: 30, tether: 400, cell: '0:1',
      });
      for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) v.seen.push(`${cx}:${cy}`);
      const after = sail(v, 6, { throttle: 0 }).voyage;
      return Math.hypot(after.mobs[0].y - after.y, after.mobs[0].x - after.x);
    };
    const loose = chased(0);
    const dragging = chased(0.4);
    ok(dragging > loose, `a chained hammerdead is ${(dragging - loose).toFixed(1)} units further off after six seconds`);
  });

  test('grape spreads the broadside: more balls, each for less', () => {
    const volley = (spread: boolean) => {
      const v = startVoyage('metralla', 'skiff', { loadout: { spread } });
      v.mobs.push({
        id: 1, kind: 'blowfish', x: 0, y: 40, heading: 0, hp: 99999,
        state: 'patrol', cooldown: 0, homeX: 0, homeY: 40, tether: 0, cell: '0:1',
      });
      for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) v.seen.push(`${cx}:${cy}`);
      let cur = steer(v, { throttle: 0 });
      for (let i = 0; i < Math.round(6 / SEA_STEP); i++) {
        const out = stepVoyage(cur);
        cur = out.voyage;
        if (out.events.some((e) => e.kind === 'fired')) return cur.shots;
      }
      return cur.shots;
    };
    const ball = volley(false);
    const grape = volley(true);
    eq(ball.length, 1, 'a plain broadside is one ball');
    ok(grape.length > 1, `and grape is ${grape.length}`);
    ok(grape[0].damage < ball[0].damage, `each for less (${grape[0].damage} against ${ball[0].damage})`);
    ok(
      grape.reduce((a, s) => a + s.damage, 0) > ball[0].damage,
      'worth more than the ball if every one of them finds something, which is the trade'
    );
    const spreadOut = Math.abs(Math.atan2(grape[0].vy, grape[0].vx) - Math.atan2(grape[grape.length - 1].vy, grape[grape.length - 1].vx));
    ok(spreadOut > 0.05, `and they actually fan (${spreadOut.toFixed(2)} radians across)`);
  });

  test('the false hold saves more of the cargo, and drowning is still worse than quitting', () => {
    const drowned = (holdGuard: number) => {
      const v = sinkAt(9, { oro: 800 });
      const again = startVoyage('bodega', 'skiff', { loadout: { holdGuard } });
      again.x = v.x;
      again.y = v.y;
      again.departed = true;
      again.hull = 1;
      again.cargo = { oro: 800 };
      again.mobs.push({
        id: 1, kind: 'hammerdead', x: again.x + 4, y: 0, heading: Math.PI, hp: 999,
        state: 'attack', cooldown: 0, homeX: again.x, homeY: 0, tether: 0, cell: '9:0',
      });
      for (let cx = -20; cx <= 20; cx++) for (let cy = -3; cy <= 3; cy++) again.seen.push(`${cx}:${cy}`);
      const wreck = sail(again, 6, { throttle: 0 }).voyage;
      ok(wreck.sunk, 'the fixture sank');
      return (wreck.cargo.oro ?? 0) + wreck.careened;
    };
    const plain = drowned(0);
    const guarded = drowned(0.3);
    ok(guarded > plain, `a false hold lands ${guarded - plain} more units of a sinking (${guarded} against ${plain})`);

    // And the promise landfall makes still holds, however many are stacked.
    const quit = startVoyage('bodega-quit');
    quit.x = SEA_CELL * 9;
    quit.departed = true;
    quit.cargo = { oro: 800 };
    abandonVoyageInPlace(quit);
    ok(
      drowned(1) < (quit.cargo.oro ?? 0),
      `even a hold that is all false lands less by drowning (${drowned(1)}) than by turning for home (${quit.cargo.oro})`
    );
  });

  /**
   * THE THREE THE SEA LEARNED THIS ROUND, and why they are here rather than in
   * pertrechos.test.ts: that file can prove a card sets a field, but only this
   * one can prove the sim does anything with it. Estiba, the carpenter and the
   * harpoon were three cards whose fields nothing read.
   */
  test('estiba carries more, and the hold really holds it', () => {
    // What the hull is RATED to carry...
    const rated = (hold: number): number =>
      effectiveShip(startVoyage('estiba', 'skiff', { loadout: { hold } })).hold;
    eq(rated(1), SHIPS.skiff.hold, 'a stock skiff carries exactly what the table says');
    eq(rated(1.22), Math.round(SHIPS.skiff.hold * 1.22), 'and a stowed one carries more, in whole units');

    // ...and what it actually takes aboard, which is the half that matters:
    // `stow` clamps against this same number, so a bigger hold is a bigger
    // haul rather than a bigger label.
    const filled = (hold: number): number => {
      const v = startVoyage('estiba-carga', 'skiff', { loadout: { hold } });
      v.departed = true;
      const before = holdUsed(v);
      const spec = effectiveShip(v);
      // One site's worth, ten times over: far more than either hull can take,
      // so what is left in the hold is the cap and nothing else.
      for (let i = 0; i < 10; i++) stow(v, spec, { oro: 400, madera: 400 });
      ok(holdUsed(v) > before, 'the fixture stowed something');
      return holdUsed(v);
    };
    eq(filled(1), SHIPS.skiff.hold, 'a stock hold fills to exactly its own number');
    ok(filled(1.22) > filled(1), `and estiba lands more of it (${filled(1.22)} against ${filled(1)})`);
    // The argument the pertrecho is FOR: more capacity is more weight, so the
    // ship it buys is a slower ship. A card that were pure upside would not be
    // a choice.
    const heavy = startVoyage('estiba-peso', 'skiff', { loadout: { hold: 1.22 } });
    heavy.cargo = { oro: SHIPS.skiff.hold };
    const light = startVoyage('estiba-peso', 'skiff', {});
    light.cargo = { oro: SHIPS.skiff.hold };
    ok(
      effectiveShip(heavy).speed > effectiveShip(light).speed,
      'the same cargo in a bigger hold is a lighter ship — that is the trade, not a bug'
    );
  });

  test('the carpenter patches faster, and only when nothing is biting', () => {
    const patched = (repair: number): number => {
      const v = startVoyage('carpintero', 'skiff', { loadout: { repair } });
      v.departed = true;
      v.hull = 10;
      v.sinceHit = 999;   // long past the calm the crew need before they start
      sweep(v);
      return sail(v, 6, { throttle: 0 }).voyage.hull;
    };
    const crew = patched(1);
    const shipwright = patched(1.45);
    ok(crew > 10, 'a stock crew patch at all');
    ok(shipwright > crew, `the shipwright patches faster (${shipwright} against ${crew})`);
  });

  test('the harpoon drags what is in the arc, and never the ship', () => {
    // Abeam and inside the guns, running flat out away from the ship.
    const chase = (harpoon: number) => {
      const v = startVoyage('arpon', 'skiff', { loadout: { harpoon } });
      const here = openWater('arpon');
      v.x = here.x;
      v.y = here.y;
      v.heading = here.heading;
      v.departed = true;
      const post = offBow(v, 0, 40);
      v.mobs.push({
        id: 1, kind: 'blowfish', x: post.x, y: post.y, heading: v.heading + Math.PI / 2, hp: 99999,
        state: 'patrol', cooldown: 0, homeX: post.x, homeY: post.y, tether: 0, cell: '0:1',
      });
      sweep(v);
      const out = sail(v, 3, { throttle: 0 }).voyage;
      const mob = out.mobs.find((m) => m.id === 1);
      return {
        gap: mob ? Math.hypot(mob.x - out.x, mob.y - out.y) : Infinity,
        ship: { x: out.x, y: out.y },
      };
    };
    const free = chase(0);
    const hauled = chase(9);
    ok(hauled.gap < free.gap, `the harpoon holds it in (${hauled.gap.toFixed(1)} against ${free.gap.toFixed(1)})`);
    // The hull does not move an inch toward what it hooked. A harpoon that
    // pulled the ship would be a way to swim, and the sea has exactly one verb.
    eq(hauled.ship.x, free.ship.x, 'the ship was dragged on x');
    eq(hauled.ship.y, free.ship.y, 'the ship was dragged on y');
  });
});

/**
 * ZAFARRANCHO — SEA_PLAY.md item 4, and the round-16 leg that was missing.
 *
 * The brief's first sentence is the thing this has to answer: "the player has
 * ONE VERB. Steering." So the tests below are about a second one existing, being
 * rare, being a MANOEUVRE rather than a straight-line boost, and — the one that
 * keeps it honest — not being an escape from anything except by moving the hull.
 */
/**
 * THE HOLD AS A MANIFEST — the owner, looking at the HUD: the sea said
 * `24/900` and nothing about of WHAT.
 *
 * Survivable while a hold was a score; el sondeo made it a decision. "Is the
 * next tier worth another few seconds" turns on whether what is coming up is
 * the ron the Destilería is waiting for or more of the madera already aboard,
 * and that is not answerable against a number with no kind attached.
 */
/**
 * EL RUMBO — the answer to "which way", which the first ten seconds of every
 * voyage did not have.
 *
 * Read off a capture of the frame after ¡Zarpar!: an empty blue rectangle and a
 * stat card. Nothing on the water, nothing in range of the plumes, and no
 * instrument that pointed anywhere but home. So the opening beat was picking a
 * direction at random and holding a thumb down until something appeared.
 *
 * The compass has always pointed home. This is the other heading, and between
 * them they are the only decision the sea offers outside a fight.
 */
describe('the compass knows where the next prize is', () => {
  test('a voyage at the harbour already has somewhere to go', () => {
    // The case that matters most, because it is the one a player meets first.
    const prize = nearestPrize(startVoyage('la-leyenda'));
    ok(prize !== null, 'there is something to point at from the dock');
    ok(prize!.distance > 0, `and it is ${prize!.distance.toFixed(0)} units away`);
    const site = siteAt('la-leyenda', Math.round(prize!.site.x / SEA_CELL), Math.round(prize!.site.y / SEA_CELL));
    eq(site?.id, prize!.site.id, 'and it is a real site in the seeded sea');
  });

  test('it is the NEAREST one, and the bearing points at it', () => {
    const v = startVoyage('rumbo');
    v.x = SEA_CELL * 2;
    const prize = nearestPrize(v);
    ok(prize !== null, 'something is in range');
    for (const site of sitesNear(v.seed, v.x, v.y, SEA_CELL * 5)) {
      if (site.kind === 'reef' || site.kind === 'lair') continue;
      const d = Math.hypot(site.x - v.x, site.y - v.y);
      ok(d >= prize!.distance - 1e-9, `nothing worth taking is nearer than ${prize!.distance.toFixed(0)}`);
    }
    near(
      prize!.bearing, Math.atan2(prize!.site.y - v.y, prize!.site.x - v.x), 1e-9,
      'and the bearing is the bearing to it'
    );
  });

  test('a reef is not a prize, and neither is a boss', () => {
    // A reef pays nothing and a lair is not a destination to point a new player
    // at — `zone-warning` is the mechanism for water that outranks a hull.
    for (let cx = 0; cx <= 6; cx++) {
      for (let cy = -6; cy <= 6; cy++) {
        const v = startVoyage('la-leyenda');
        v.x = cx * SEA_CELL;
        v.y = cy * SEA_CELL;
        const prize = nearestPrize(v);
        if (!prize) continue;
        ok(prize.site.kind !== 'reef', 'never a reef');
        ok(prize.site.kind !== 'lair', 'never a lair');
      }
    }
  });

  test('the needle moves on the moment a prize is spent', () => {
    const v = startVoyage('la-leyenda');
    v.x = SEA_CELL * 2;
    const first = nearestPrize(v);
    ok(first !== null, 'something to take');
    v.taken.push(first!.site.id);
    const second = nearestPrize(v);
    ok(second === null || second.site.id !== first!.site.id, 'it points somewhere else now');
    if (second) ok(second.distance >= first!.distance, 'and the next one is further, which is the cost of taking');
  });
});

describe('the hold says what is in it, not just how much', () => {
  test('an empty hold is an empty manifest, not four zeroes', () => {
    deepEq(holdManifest(startVoyage('manifiesto')), [], 'nothing aboard, nothing to draw');
  });

  test('every kind aboard is listed, and nothing else is', () => {
    const v = startVoyage('manifiesto');
    v.cargo = { madera: 120, ron: 60, oro: 20 };
    const kinds = holdManifest(v).map((slice) => slice.id);
    eq(kinds.length, 3, 'three kinds aboard, three slices');
    ok(!kinds.includes('metal'), 'and no slice for the metal that is not there');
    eq(holdManifest(v).find((s) => s.id === 'ron')?.units, 60, 'reading the cargo itself');
  });

  test('the shares are of the CARGO, so they always fill the strip', () => {
    // Against capacity the bar would double as a fullness gauge, which the
    // numeral beside it already gives to the unit — and the mix would then be
    // squeezed into however full the ship happened to be.
    const v = startVoyage('manifiesto');
    v.cargo = { madera: 120, ron: 60, oro: 20 };
    const slices = holdManifest(v);
    const total = slices.reduce((sum, s) => sum + s.share, 0);
    near(total, 1, 1e-9, 'the shares of a manifest sum to one');
    near(slices.find((s) => s.id === 'madera')!.share, 0.6, 1e-9, 'and each one is its own share of it');
    // A nearly-empty hold reads exactly as clearly as a full one, which is the
    // whole point: that is when the player is choosing what to survey next.
    const thin = startVoyage('manifiesto');
    thin.cargo = { madera: 12, ron: 6, oro: 2 };
    deepEq(
      holdManifest(thin).map((s) => s.share), slices.map((s) => s.share),
      'a tenth of the cargo draws the same mix'
    );
  });

  test('it is read in the island rail\'s order, so there is one manifest to learn', () => {
    const v = startVoyage('manifiesto');
    // Written in a deliberately scrambled order — the manifest sorts it.
    v.cargo = { metal: 5, ron: 5, madera: 5, oro: 5 };
    eq(
      JSON.stringify(holdManifest(v).map((s) => s.id)),
      JSON.stringify(['oro', 'madera', 'ron', 'metal']),
      'oro, madera, ron, metal — balance.json pillRow, the same order the island shows'
    );
  });
});

describe('zafarrancho: the one thing to press that is not the helm', () => {
  /** Under way in clear water with a runway to use the burst in — a ship marked
   *  departed at the origin is a ship the `home` latch ends the voyage of on
   *  its very first step, and every one of these cases needs several. */
  const underWay = (seed: string): Voyage => {
    const v = startVoyage(seed, 'skiff', {});
    const at = openWater(seed, 140);
    v.x = at.x;
    v.y = at.y;
    v.heading = at.heading;
    v.departed = true;
    sweep(v);
    return v;
  };

  test('a voyage starts with it ready and nothing running', () => {
    const v = startVoyage('zafa');
    eq(v.dash, 0, 'nothing is running at the dock');
    eq(v.dashCooldown, 0, 'and nothing is being waited for');
    ok(canDash(v), 'the first one is free');
    const read = readDash(v);
    ok(read.ready && !read.running, 'and the button says so');
    eq(read.charge, 1, 'a full charge');
    eq(read.wait, 0, 'with no wait to print');
  });

  test('calling it runs for its seconds and then stops on its own', () => {
    const v = callDash(underWay('zafa-run'));
    ok(v.dash > 0, 'the burst started');
    const first = sail(v, ZAFARRANCHO.seconds - 0.2, { throttle: 1 });
    ok(first.voyage.dash > 0, 'still running just before its time');
    ok(!first.events.some((e) => e.kind === 'dash-ended'), 'and it has not said otherwise');
    const after = sail(first.voyage, 0.5, { throttle: 1 });
    eq(after.voyage.dash, 0, 'and over just after it');
    ok(after.events.some((e) => e.kind === 'dash-ended'), 'which the sea says once');
  });

  test('it cannot be held down: one call, then a real wait', () => {
    const v = callDash(underWay('zafa-wait'));
    ok(!canDash(v), 'a second call the same instant is refused');
    eq(callDash(v), v, 'and refused by returning the same voyage, not a changed one');
    // Through the burst and most of the wait, it is still not ready.
    const mid = sail(v, ZAFARRANCHO.cooldown - 0.5, { throttle: 1 }).voyage;
    ok(!canDash(mid), `still on the wait at ${(ZAFARRANCHO.cooldown - 0.5).toFixed(0)}s`);
    ok(readDash(mid).charge > 0.9, 'though the button is nearly full');
    const ready = sail(mid, 1, { throttle: 1 });
    ok(canDash(ready.voyage), 'and ready a moment later');
    ok(ready.events.some((e) => e.kind === 'dash-ready'), 'and it says so, once');
    // The cooldown is the WHOLE cycle, not the wait after the burst: a player
    // learning "twelve seconds" must not find it is really fifteen.
    ok(
      ZAFARRANCHO.cooldown > ZAFARRANCHO.seconds,
      'a cooldown shorter than the burst would make it permanent'
    );
  });

  test('it is a manoeuvre, not a straight line', () => {
    const swept = (dash: boolean): { heading: number; way: number } => {
      let v = underWay('zafa-vira');
      const from = { x: v.x, y: v.y, heading: v.heading };
      if (dash) v = callDash(v);
      const out = sail(v, ZAFARRANCHO.seconds, { turn: 1, throttle: 1 }).voyage;
      return { heading: Math.abs(out.heading - from.heading), way: out.speed };
    };
    const plain = swept(false);
    const called = swept(true);
    ok(
      called.heading > plain.heading * 1.3,
      `she comes round much further (${called.heading.toFixed(2)} rad against ${plain.heading.toFixed(2)})`
    );
    // And she keeps her WAY while doing it, which is the half `drag` buys and
    // the half that makes it a zafarrancho rather than a handbrake. Measured as
    // speed rather than as distance from the start on purpose: a tighter turn
    // ends up NEARER where it began, so displacement would score the better
    // manoeuvre lower — the first draft of this line did exactly that.
    ok(
      called.way > plain.way * 1.3,
      `and holds her way through it (${called.way.toFixed(1)} against ${plain.way.toFixed(1)})`
    );
  });

  test('it moves the hull and NOTHING else', () => {
    const spec = SHIPS.skiff;
    const plain = underWay('zafa-solo');
    const dashing = callDash(underWay('zafa-solo'));
    const a = effectiveShip(plain);
    const b = effectiveShip(dashing);
    ok(b.speed > a.speed && b.turn > a.turn, 'speed and helm are what it buys');
    eq(b.hull, a.hull, 'not one point of hull');
    eq(b.damage, a.damage, 'not a heavier ball');
    eq(b.reload, a.reload, 'not a faster gun');
    eq(b.range, a.range, 'not a longer reach');
    eq(b.hold, a.hold, 'and not a bigger hold');
    eq(a.hull, spec.hull, 'and the plain ship is the shipyard ship');
  });

  test('the weight and the pertrechos still count under it', () => {
    // A laden ship under zafarrancho is a laden ship moving faster, not an
    // empty one — otherwise the burst would erase SEA_PLAY.md item 2 for three
    // seconds at a time, which is exactly when a heavy hold matters most.
    const laden = (dash: boolean): number => {
      let v = underWay('zafa-peso');
      v.cargo = { oro: SHIPS.skiff.hold };
      if (dash) v = callDash(v);
      return effectiveShip(v).speed;
    };
    const empty = (dash: boolean): number => {
      let v = underWay('zafa-peso');
      if (dash) v = callDash(v);
      return effectiveShip(v).speed;
    };
    ok(laden(true) > laden(false), 'the burst helps a full hold');
    ok(laden(true) < empty(true), 'but a full hold under it is still slower than an empty one');
    near(laden(true) / laden(false), empty(true) / empty(false), 1e-9, 'and the burst is the same multiplier either way');
  });

  test('a voyage that has ended cannot call it', () => {
    for (const end of ['sunk', 'home', 'abandoned'] as const) {
      const v = { ...startVoyage(`zafa-${end}`), [end]: true };
      ok(!canDash(v), `a ${end} voyage refuses it`);
      eq(callDash(v).dash, 0, 'and nothing starts');
      ok(!readDash(v).ready, 'and the button knows');
    }
  });

  test('a voyage with a zafarrancho in it still replays exactly', () => {
    const run = () => {
      let v = underWay('zafa-replay');
      for (let i = 0; i < Math.round(40 / SEA_STEP); i++) {
        if (i === 60 || i === 500) v = callDash(v);
        v = stepVoyage(steer(v, { turn: 0.4, throttle: 1 })).voyage;
      }
      return v;
    };
    const a = run();
    const b = run();
    eq(a.x, b.x, 'same seed, same calls, same position');
    eq(a.heading, b.heading, 'on the same heading');
    eq(a.dashCooldown, b.dashCooldown, 'with the same wait left');
    eq(a.hull, b.hull, 'and the same damage taken');
  });
});
