import type { ResourceId } from './balance';
import raw from '../data/balance.json';
import { Rng } from '../core/rng';

/**
 * sea.ts — the voyage, as a pure simulation.
 *
 * PLAN.md's golden rule applies here more than anywhere else in the game: this
 * file contains ALL of the sailing, the enemies and the shooting, and it knows
 * nothing about three.js, the DOM or the clock. It advances on a fixed step,
 * every roll comes off a seeded stream, and the same seed with the same inputs
 * produces the same voyage on any device. That is what makes it testable today
 * and what would make it replayable on a server later.
 *
 * Three decisions worth stating up front, because each one is a design choice
 * rather than an implementation detail:
 *
 * - **The world is a function, not a list.** There is no array of islands.
 *   `siteAt(seed, cell)` answers what is in a square of the sea, deterministically,
 *   for any cell however far out. Nothing has to be generated in advance, nothing
 *   has to be saved, and the render layer asks the same function the sim does, so
 *   the two cannot disagree about where a reef is.
 *
 * - **Cannons fire themselves.** PLAN.md calls for the player to play positioning
 *   and dodging, not a fire button — the "sea survivors" ADN. A broadside goes off
 *   when a target is inside the arc on that side and the side has reloaded. The
 *   skill is turning your flank to the enemy and your bow to everything else.
 *
 * - **Distance is difficulty.** Everything about a square of sea — whether it
 *   holds anything, what patrols it, what it drops — is drawn from a ring index
 *   computed from how far it is from home. This is the whole risk/reward curve,
 *   and it is one number.
 *
 * And one rule that is not a design decision but a house rule: NO NUMBER IS
 * WRITTEN HERE. Every hull, bite, payout and radius comes out of
 * src/data/balance.json, the same file the island's economy is drawn from, so
 * the balance of the game can be read and diffed in one place. What this file
 * owns is the behaviour those numbers drive.
 */

// ---------------------------------------------------------------------------
// Units: world units and seconds, matching the island scene (1 unit = 1 cell).

const SEA = raw.sea;

/** Fixed simulation step. The renderer interpolates between these. */
export const SEA_STEP = 1 / 30;

/**
 * Side of one world cell of open sea, in world units.
 *
 * Sized against what the camera can actually see, which is roughly 80 units
 * across. At 90 a cell was wider than the screen, so with about half of them
 * holding anything the player spent most of a voyage looking at empty water
 * with no reason to steer. At 55 there is usually something in view and always
 * something just out of it, which is the difference between exploring and
 * commuting.
 */
export const SEA_CELL: number = SEA.cell;

/** How far from the ship the sim keeps sites and mobs alive. Beyond this a mob
 *  is forgotten and its cell will re-spawn it if the player comes back — which
 *  is correct, since the cell's contents are a function of the seed. */
export const SEA_RANGE = SEA_CELL * 2.2;

export interface Vec2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// The world, as a function of the seed

export type SiteKind = 'none' | 'reef' | 'islet' | 'harvest' | 'wreck' | 'lair';

export interface Site {
  kind: SiteKind;
  x: number;
  y: number;
  radius: number;
  /** Ring index — 0 is home water, and it only grows outward. */
  ring: number;
  /** What taking this site pays, empty for a reef. */
  loot: Partial<Record<ResourceId, number>>;
  /** Stable identity, so a claimed site stays claimed across a re-entry. */
  id: string;
}

/**
 * How far out a cell is, in rings. Ring 0 is the water around home.
 *
 * A square shell, not a circle, so the rings tile the grid exactly and no cell
 * is ever between two of them. What changed after the sea was first played is
 * how THICK a shell is.
 *
 * The ring index is the difficulty of the game: it decides what spawns, how
 * much of it, and what it pays. It used to be the plain Chebyshev distance in
 * cells — one shell, one ring — which meant the difficulty curve was calibrated
 * in cells while the player experiences it in seconds. A cell is 55 units and a
 * skiff does 17 a second, so holding the throttle for half a minute crossed
 * NINE rings. The player was in water designed to kill them before they had
 * made a single decision, and the measured result was three ships in four on
 * the bottom at the thirty-second mark.
 *
 * `bands` gives each ring a thickness in cell-shells, so difficulty advances at
 * a pace a person can feel: ring 1 is about four seconds out, ring 4 about
 * twenty-seven. The last band repeats outward forever, which is what keeps the
 * open sea open.
 */
const BANDS: readonly number[] = SEA.rings.bands;
const BANDED = BANDS.reduce((a, b) => a + b, 0);

export function ringOf(cx: number, cy: number): number {
  const d = Math.max(Math.abs(cx), Math.abs(cy));
  if (d <= 0) return 0;
  // Past the table the last band tiles outward, and is answered directly rather
  // than by counting — nothing should walk a loop proportional to how far a
  // player has sailed.
  if (d > BANDED) return BANDS.length + Math.ceil((d - BANDED) / BANDS[BANDS.length - 1]);
  let edge = 0;
  for (let ring = 1; ring <= BANDS.length; ring++) {
    edge += BANDS[ring - 1];
    if (d <= edge) return ring;
  }
  return BANDS.length;
}

/** The cells that make up a ring, as `[cx, cy]`. Only the sea's own tests and
 *  tools need this; the game asks the question the other way round. */
export function cellsInRing(ring: number): [number, number][] {
  const out: [number, number][] = [];
  let reach = 0;
  for (let r = 1; r <= ring; r++) reach += BANDS[Math.min(r - 1, BANDS.length - 1)];
  for (let cx = -reach; cx <= reach; cx++) {
    for (let cy = -reach; cy <= reach; cy++) {
      if (ringOf(cx, cy) === ring) out.push([cx, cy]);
    }
  }
  return out;
}

/** A cell's own stream. Forked from the seed and the coordinates, so two cells
 *  never share rolls and a cell answers the same way however you reach it. */
function cellRng(seed: string, cx: number, cy: number, salt: string): Rng {
  return new Rng(`${seed}:sea:${cx}:${cy}:${salt}`);
}

/**
 * Answers already worked out.
 *
 * `siteAt` is a pure function of three arguments, so remembering what it said
 * changes nothing anybody can observe — and it is asked a great deal. One
 * simulation step queries the sea twice, the renderer queries it every frame,
 * and the balance harness plays fourteen million steps in a row. Without this
 * the harness that proves the sea is playable is too slow to run.
 *
 * Bounded and dropped wholesale rather than aged: the working set is the cells
 * around one ship, so any bound far above that is never reached in play, and a
 * voyage that does cross it loses nothing but the work of asking again.
 */
const siteMemo = new Map<string, Site | null>();

/**
 * What is in this square of sea.
 *
 * Called by the sim to know what to collide with and by the renderer to know
 * what to draw. One function, so they cannot disagree.
 *
 * The Site it returns is SHARED, not a copy — treat it as frozen. Nothing in
 * the game writes to one, and the memo above is why it must stay that way.
 */
export function siteAt(seed: string, cx: number, cy: number): Site | null {
  const memoKey = `${seed}:${cx}:${cy}`;
  const remembered = siteMemo.get(memoKey);
  if (remembered !== undefined) return remembered;
  const answer = computeSiteAt(seed, cx, cy);
  if (siteMemo.size > 20000) siteMemo.clear();
  siteMemo.set(memoKey, answer);
  return answer;
}

function computeSiteAt(seed: string, cx: number, cy: number): Site | null {
  const ring = ringOf(cx, cy);
  if (ring === 0) return null; // home water stays clear — you can always leave

  const rng = cellRng(seed, cx, cy, 'site');

  // The sea gets busier as it gets more dangerous, but never solid: an empty
  // cell is what makes the full ones feel like a find.
  const occupied = SEA.rings.occupancyBase
    + Math.min(SEA.rings.occupancyMax, ring * SEA.rings.occupancyPerRing);
  if (!rng.chance(occupied)) return null;

  const kind: SiteKind = rng.chance(0.30)
    ? 'reef'
    : rng.chance(0.42)
      ? 'harvest'
      : rng.chance(0.55)
        ? 'islet'
        : ring >= 3 && rng.chance(0.45)
          ? 'lair'
          : 'wreck';

  // Kept off the cell edges so a site never straddles two cells, which would
  // let the ship clip through the half that has not been asked for yet.
  const margin = SEA_CELL * 0.28;
  const x = cx * SEA_CELL + rng.range(margin, SEA_CELL - margin) - SEA_CELL / 2;
  const y = cy * SEA_CELL + rng.range(margin, SEA_CELL - margin) - SEA_CELL / 2;

  const radius =
    kind === 'reef' ? rng.range(4, 8)
      : kind === 'wreck' ? rng.range(3, 5)
        : kind === 'lair' ? rng.range(9, 13)
          : rng.range(6, 11);

  return { kind, x, y, radius, ring, loot: siteLoot(kind, ring, rng), id: `${cx}:${cy}` };
}

/** What a site pays. Scales with the ring, which is the whole risk curve. */
function siteLoot(kind: SiteKind, ring: number, rng: Rng): Partial<Record<ResourceId, number>> {
  if (kind === 'reef') return {};
  const table = SEA.loot;
  const scale = 1 + ring * table.perRing;
  const roll = (base: number) => Math.round(base * scale * rng.range(table.spread[0], table.spread[1]));
  switch (kind) {
    case 'harvest':
      return rng.chance(0.5) ? { madera: roll(table.harvest.madera) } : { metal: roll(table.harvest.metal) };
    case 'islet':
      return { madera: roll(table.islet.madera), ron: roll(table.islet.ron) };
    case 'wreck':
      return { oro: roll(table.wreck.oro), ron: roll(table.wreck.ron) };
    case 'lair':
      return { oro: roll(table.lair.oro), metal: roll(table.lair.metal) };
    default:
      return {};
  }
}

/** Every site within `range` of a point. The sim's collision set and the
 *  renderer's draw set are the same query. */
export function sitesNear(seed: string, x: number, y: number, range = SEA_RANGE): Site[] {
  const out: Site[] = [];
  const reach = Math.ceil(range / SEA_CELL) + 1;
  const cx0 = Math.round(x / SEA_CELL);
  const cy0 = Math.round(y / SEA_CELL);
  for (let cy = cy0 - reach; cy <= cy0 + reach; cy++) {
    for (let cx = cx0 - reach; cx <= cx0 + reach; cx++) {
      const site = siteAt(seed, cx, cy);
      if (site && Math.hypot(site.x - x, site.y - y) <= range) out.push(site);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mobs

export type MobKind = 'blowfish' | 'kelpling' | 'hammerdead' | 'squid';

export interface MobSpec {
  hp: number;
  speed: number;
  turn: number;
  damage: number;
  /** Seconds between attacks. */
  cadence: number;
  /** How close it must be to attack. */
  reach: number;
  /** How far it notices the player. */
  sight: number;
  radius: number;
}

/** Read straight out of balance.json — `sea.mobs`, where the reasoning lives. */
export const MOBS: Record<MobKind, MobSpec> = {
  blowfish: SEA.mobs.blowfish,
  kelpling: SEA.mobs.kelpling,
  hammerdead: SEA.mobs.hammerdead,
  squid: SEA.mobs.squid,
};

/** `[min, max]` enemies in a cell of this ring, and the pool they come from.
 *  The last entry of each list repeats for every ring beyond it. */
const PATROL_COUNT: readonly (readonly number[])[] = SEA.patrols.count;
const PATROL_POOLS: readonly (readonly string[])[] = SEA.patrols.pools;
/** How far past its site a guard will chase before going back to its post. */
const PATROL_TETHER: number = SEA.patrols.tether;
/** How far off its site's shore a guard stands, min and max. */
const PATROL_POST: readonly number[] = SEA.patrols.post;
/** How far from its own patch an open-water patrol will follow a ship. */
const PATROL_ROAM: number = SEA.patrols.roam;
/** Chance a cell with nothing worth guarding carries a lone patrol anyway. */
const PATROL_OPEN: number = SEA.patrols.openChance;
const byRing = <T>(table: readonly T[], ring: number): T => table[Math.min(ring, table.length) - 1];

export interface Mob {
  id: number;
  kind: MobKind;
  x: number;
  y: number;
  heading: number;
  hp: number;
  state: 'patrol' | 'chase' | 'attack';
  /** Seconds until it can attack again. */
  cooldown: number;
  /** Where it patrols around — a lair boss never leaves its site. */
  homeX: number;
  homeY: number;
  /** Set for a lair guardian, which must not be kited off its site. */
  tether: number;
  /** The cell that produced it, so it is spawned exactly once per visit. */
  cell: string;
}

/** What patrols a cell, deterministically. */
export function mobsAt(seed: string, cx: number, cy: number, nextId: number): Mob[] {
  const ring = ringOf(cx, cy);
  if (ring === 0) return [];
  const site = siteAt(seed, cx, cy);
  const rng = cellRng(seed, cx, cy, 'mobs');

  // A lair is a boss and its escort, and nothing else in the cell matters.
  if (site?.kind === 'lair') {
    const boss = makeMob('squid', site.x, site.y, site.x, site.y, nextId, `${cx}:${cy}`, rng);
    boss.tether = site.radius + 26;
    return [boss];
  }

  // Ring 1 is deliberately thin. A player's first voyage should be able to
  // reach something and come back, and the ramp does the rest.
  const band = byRing(PATROL_COUNT, ring);
  const pool = byRing(PATROL_POOLS, ring) as readonly MobKind[];
  const guarded = site && site.kind !== 'reef' ? site : null;

  // How many, and this is a budget rather than a taste.
  //
  // A cell is 55 units and the sim keeps two and a bit cells of sea alive
  // around the ship, so about fifteen cells are awake at once — anything spawned
  // per-cell is multiplied by fifteen before the player sees it. At two to four
  // in EVERY cell, ring 4 had twenty-four creatures inside a screen and a half.
  // That is not a fight, it is weather: nothing is individually readable, the
  // guns cannot pick a target worth killing, and a hull at 40% could not get out
  // of ring 4 alive in eighteen tries out of a hundred, whatever the player did.
  // It is also twenty-four models against PLAN.md's hundred-draw-call budget.
  //
  // So: patrols belong to sites, open water gets the occasional loner, and the
  // deep sea is dangerous because of WHAT is there rather than how much.
  const count = guarded
    ? rng.int(band[0], band[1])
    : rng.chance(PATROL_OPEN) ? rng.int(1, Math.max(1, band[0])) : 0;

  // Guards stand on the treasure. Anchoring a patrol anywhere in its cell made
  // the two halves of the game independent: the loot was over there, the
  // monsters were over here, and a ship at full way outruns everything in the
  // sea, so a voyage never had to choose. Measured across a fleet, mobs were
  // doing less damage than the scenery. A patrol ringed round the thing it is
  // guarding is also the readable version — you can SEE what taking that islet
  // is going to cost before you commit to it.
  const out: Mob[] = [];
  for (let i = 0; i < count; i++) {
    const bearing = rng.range(-Math.PI, Math.PI);
    const post = guarded ? guarded.radius + rng.range(PATROL_POST[0], PATROL_POST[1]) : 0;
    const hx = guarded ? guarded.x + Math.cos(bearing) * post
      : cx * SEA_CELL + rng.range(-SEA_CELL / 2, SEA_CELL / 2);
    const hy = guarded ? guarded.y + Math.sin(bearing) * post
      : cy * SEA_CELL + rng.range(-SEA_CELL / 2, SEA_CELL / 2);
    const mob = makeMob(rng.pick(pool), hx, hy, hx, hy, nextId + i, `${cx}:${cy}`, rng);
    // Everything in the sea belongs to a patch of it.
    //
    // A guard stays with what it is guarding on a short leash: it will run a
    // ship off and then go back, so the site is still defended when the player
    // thinks better of it and comes round again, and the cost of taking that
    // islet is a price rather than a thing you can wait out.
    //
    // Open-water patrols get a long one, and that matters more than it looks.
    // A hammerdead makes 15 against a skiff's 17 and only broke off at 90 units,
    // so shaking one off took the better part of a minute — and every cell
    // crossed added more, until a ship in ring 4 was towing a shoal it could
    // neither outrun nor outshoot. Measured: a fifteen-in-a-hundred survival
    // rate for a run to ring 4, and nothing the player did changed it. A chase
    // that ends when you have left its water is an encounter; one that does not
    // is a conga line.
    mob.tether = guarded ? guarded.radius + PATROL_TETHER : PATROL_ROAM;
    out.push(mob);
  }
  return out;
}

function makeMob(
  kind: MobKind, x: number, y: number, hx: number, hy: number,
  id: number, cell: string, rng: Rng
): Mob {
  return {
    id, kind, x, y, heading: rng.range(-Math.PI, Math.PI), hp: MOBS[kind].hp,
    state: 'patrol', cooldown: 0, homeX: hx, homeY: hy, tether: 0, cell,
  };
}

// ---------------------------------------------------------------------------
// The ship

export interface ShipSpec {
  hull: number;
  /** Top speed under full throttle. */
  speed: number;
  /** Radians per second at full helm. */
  turn: number;
  /** How fast it reaches top speed — a ship is not a car. */
  accel: number;
  /** Fraction of top speed given up at full helm. Turning has to cost
   *  something or nothing in the sea can ever catch anybody. */
  turnDrag: number;
  damage: number;
  /** Seconds a broadside takes to reload. */
  reload: number;
  /** Half-angle of the firing arc off each beam. */
  arc: number;
  range: number;
  radius: number;
  /** Total units of cargo the hold takes. */
  hold: number;
  /** Hull a second the crew patches back on, once nothing has touched the ship
   *  for `CALM` seconds. See balance.json `sea.ships` for why this exists. */
  repair: number;
}

export const SHIPS: Record<string, ShipSpec> = { skiff: SEA.ships.skiff };

/** Seconds of not being touched before the crew can start patching. */
const CALM: number = SEA.ships.calm;

/**
 * How close to the origin, in cells, counts as being back in the harbour.
 *
 * Was 0.3 — sixteen units, less than a ship's turning circle. A player carrying
 * a full hold had to thread a needle to bank it, and a near miss meant going
 * round again with whatever was chasing them. The departure latch arms at 0.9
 * cells, so there is still half a cell of open water between "gone" and "back"
 * and no amount of bobbing at the harbour mouth can trip both in one breath.
 */
const HARBOUR: number = SEA.harbour;

/** How far out, in cells, counts as having left — see the latch at the foot of
 *  `stepVoyage`, which is where the reasoning is. */
const DEPARTED: number = SEA.departed;

export interface Shot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds left before it falls in the sea. */
  life: number;
  damage: number;
  from: 'ship' | 'mob';
}

export interface Helm {
  /** -1 hard to port, +1 hard to starboard. */
  turn: number;
  /** 0..1. */
  throttle: number;
}

export interface Voyage {
  seed: string;
  /** Fixed steps taken. The only clock this simulation has. */
  step: number;
  shipType: string;
  x: number;
  y: number;
  heading: number;
  speed: number;
  hull: number;
  /** Seconds until each side can fire again. */
  reloadPort: number;
  reloadStarboard: number;
  helm: Helm;
  cargo: Partial<Record<ResourceId, number>>;
  mobs: Mob[];
  shots: Shot[];
  /** Sites already emptied, by id. */
  taken: string[];
  /** Cells whose mobs have been spawned this voyage. */
  seen: string[];
  nextId: number;
  /** Seconds since anything last hurt the ship. The crew patch her once this
   *  passes `CALM`, which is what makes breaking off a real play. */
  sinceHit: number;
  /** Seconds of grace left after touching a reef, so a ship pinned against one
   *  is scraping rather than being hit twenty times a second. */
  aground: number;
  /** Set once the ship goes down; the voyage is over but readable. */
  sunk: boolean;
  /**
   * Set once the ship has actually left home water.
   *
   * You cannot come BACK from somewhere you never went, and without this latch
   * the game said you had. A voyage spawns at exactly (0, 0) — the harbour —
   * so the arrival test was true from the first frame, and the only thing
   * holding the modal back was a `step > 60` guard worth two seconds. A player
   * who paused to look at the sea before touching the throttle was told they
   * were home and handed an end-of-voyage card, with the open sea unreachable
   * behind it. Distance travelled is not the condition; having gone is.
   */
  departed: boolean;
  /** Set when the player has made it back to home water with the hold. */
  home: boolean;
}

export type SeaEvent =
  | { kind: 'fired'; side: 'port' | 'starboard'; x: number; y: number }
  /** `by` is what dealt it, which is the only way anything downstream — a
   *  camera shake, a balance harness — can tell a reef from a set of jaws.
   *  Nothing is obliged to read it; the renderer switches on `target`. */
  | { kind: 'hit'; x: number; y: number; damage: number; target: 'ship' | 'mob'; by: 'cannon' | 'mob' | 'reef' }
  | { kind: 'mob-killed'; mob: MobKind; x: number; y: number; ring: number; loot: Partial<Record<ResourceId, number>> }
  | { kind: 'looted'; site: SiteKind; loot: Partial<Record<ResourceId, number>>; x: number; y: number }
  | { kind: 'hold-full' }
  | { kind: 'sunk'; lost: Partial<Record<ResourceId, number>> }
  | { kind: 'home' };

export function startVoyage(seed: string, shipType = 'skiff'): Voyage {
  const spec = SHIPS[shipType];
  return {
    seed, step: 0, shipType,
    x: 0, y: 0, heading: 0, speed: 0, hull: spec.hull,
    reloadPort: 0, reloadStarboard: 0,
    helm: { turn: 0, throttle: 0 },
    cargo: {}, mobs: [], shots: [], taken: [], seen: [], nextId: 1,
    sinceHit: CALM, aground: 0,
    sunk: false, departed: false, home: false,
  };
}

/** Units of cargo in the hold. */
export function holdUsed(v: Voyage): number {
  let total = 0;
  for (const amount of Object.values(v.cargo)) total += amount ?? 0;
  return total;
}

/** What a sunk creature leaves floating. See balance.json `sea.bounty`. */
const BOUNTY: Record<MobKind, Partial<Record<ResourceId, number>>> = SEA.bounty;

/**
 * Puts what it can of `haul` in the hold and returns what actually went in.
 *
 * One place, so a boarded island and a sunk shark cannot disagree about what a
 * full hold means. Mutates `v.cargo`, which is fine — `stepVoyage` has already
 * copied it.
 */
function stow(
  v: Voyage, spec: ShipSpec, haul: Partial<Record<ResourceId, number>>
): Partial<Record<ResourceId, number>> {
  const taken: Partial<Record<ResourceId, number>> = {};
  let room = spec.hold - holdUsed(v);
  for (const [res, amount] of Object.entries(haul) as [ResourceId, number][]) {
    const give = Math.max(0, Math.min(amount, room));
    if (give <= 0) continue;
    taken[res] = give;
    v.cargo[res] = (v.cargo[res] ?? 0) + give;
    room -= give;
  }
  return taken;
}

const TAU = Math.PI * 2;

/** Shortest signed angle from a to b, in (-pi, pi]. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * One fixed step of the voyage.
 *
 * Returns a NEW voyage and the events that happened, like the rest of sim/.
 * `dt` is a parameter rather than a constant only so tests can prove the
 * behaviour is step-size independent where it should be; gameplay always
 * passes SEA_STEP.
 */
export function stepVoyage(prev: Voyage, dt: number = SEA_STEP): { voyage: Voyage; events: SeaEvent[] } {
  const v: Voyage = {
    ...prev,
    cargo: { ...prev.cargo },
    mobs: prev.mobs.map((m) => ({ ...m })),
    shots: prev.shots.map((s) => ({ ...s })),
    taken: [...prev.taken],
    seen: [...prev.seen],
  };
  const events: SeaEvent[] = [];
  if (v.sunk) return { voyage: v, events };

  v.step += 1;
  const spec = SHIPS[v.shipType];

  // --- the ship ------------------------------------------------------------
  // Turning scales with speed. A ship dead in the water does not pivot, and
  // that is what makes throttle a real decision rather than a thing you hold.
  const way = v.speed / spec.speed;
  v.heading += v.helm.turn * spec.turn * dt * (0.25 + 0.75 * way);
  // A hull heels and drags in a hard turn, so hard over costs way. Without it
  // a ship could hold top speed through any manoeuvre, which made running away
  // free and every chase in the game a formality: nothing in the sea is faster
  // than 17, so nothing could ever catch anybody. Turning is now the thing that
  // lets a hammerdead close, and holding a straight line is how you escape one.
  const wanted = v.helm.throttle * spec.speed * (1 - spec.turnDrag * Math.abs(v.helm.turn));
  v.speed += Math.sign(wanted - v.speed) * Math.min(spec.accel * dt, Math.abs(wanted - v.speed));
  v.x += Math.cos(v.heading) * v.speed * dt;
  v.y += Math.sin(v.heading) * v.speed * dt;

  // --- running aground -----------------------------------------------------
  // Sites are solid, and hitting one hurts — but only for the speed that was
  // going INTO it. Scraping along a reef used to cost as much as ramming it
  // head-on, and a ship pinned against one took a fresh hit every quarter of a
  // second for as long as the thumb stayed down: measured across a fleet of
  // voyages, scenery was a third of all the damage in the game. It is friction,
  // not a fight, and nobody ever chose it.
  v.aground = Math.max(0, v.aground - dt);
  const ground = SEA.grounding;
  for (const site of sitesNear(v.seed, v.x, v.y, 60)) {
    const dx = v.x - site.x;
    const dy = v.y - site.y;
    const away = Math.hypot(dx, dy) || 1;
    const gap = away - (site.radius + spec.radius);
    if (gap >= 0) continue;
    const nx = dx / away;
    const ny = dy / away;
    v.x -= nx * gap;
    v.y -= ny * gap;

    // How much of the ship's way was aimed AT the rock: 1 is head-on, 0 is a
    // touch along its face, below 0 is already leaving.
    const hx = Math.cos(v.heading);
    const hy = Math.sin(v.heading);
    const into = -(hx * nx + hy * ny);
    if (into <= 0) continue;

    const free = spec.speed * ground.safeSpeed;
    const impact = into * v.speed;
    if (v.aground <= 0 && impact > free) {
      const damage = Math.max(1, Math.round((impact - free) * ground.damagePerUnit));
      v.hull -= damage;
      v.sinceHit = 0;
      v.aground = ground.grace;
      events.push({ kind: 'hit', x: v.x, y: v.y, damage, target: 'ship', by: 'reef' });
    }

    // The rock turns the bow along its own face rather than stopping the ship.
    // Whichever of the two tangents the ship is already closer to; the helm has
    // had its say earlier in the step, and this is the shore having the last one.
    const along = hy * nx - hx * ny >= 0 ? Math.atan2(nx, -ny) : Math.atan2(-nx, ny);
    const swing = ground.deflect * dt;
    v.heading += Math.max(-swing, Math.min(swing, angleDelta(v.heading, along)));
    // And it takes only the way that was aimed at it, so a graze costs nothing.
    v.speed *= 1 - into * (1 - ground.speedKept);
  }

  // --- looting -------------------------------------------------------------
  // Sailing over a site takes it. There is no interact button: on a phone,
  // steering onto the thing you want IS the interaction.
  for (const site of sitesNear(v.seed, v.x, v.y, 60)) {
    if (site.kind === 'reef' || v.taken.includes(site.id)) continue;
    if (Math.hypot(v.x - site.x, v.y - site.y) > site.radius + spec.radius + SEA.loot.reach) continue;
    // A lair does not give up its cargo while its guardian is alive.
    if (site.kind === 'lair' && v.mobs.some((m) => m.cell === site.id && m.kind === 'squid')) continue;

    if (spec.hold - holdUsed(v) <= 0) { events.push({ kind: 'hold-full' }); continue; }
    const taken = stow(v, spec, site.loot);
    const used = Object.values(taken).reduce((a, b) => a + b, 0);
    v.taken.push(site.id);
    events.push({ kind: 'looted', site: site.kind, loot: taken, x: site.x, y: site.y });
    if (used < Object.values(site.loot).reduce((a, b) => a + b, 0)) events.push({ kind: 'hold-full' });
  }

  // --- spawning ------------------------------------------------------------
  // Each cell hands over its patrol once per voyage, when the ship first comes
  // within range. Leaving and returning does not re-stock it, which is what
  // stops a player farming one cell by driving in and out of it.
  const reach = Math.ceil(SEA_RANGE / SEA_CELL);
  const cx0 = Math.round(v.x / SEA_CELL);
  const cy0 = Math.round(v.y / SEA_CELL);
  for (let cy = cy0 - reach; cy <= cy0 + reach; cy++) {
    for (let cx = cx0 - reach; cx <= cx0 + reach; cx++) {
      const key = `${cx}:${cy}`;
      if (v.seen.includes(key)) continue;
      if (Math.hypot(cx * SEA_CELL - v.x, cy * SEA_CELL - v.y) > SEA_RANGE) continue;
      v.seen.push(key);
      const born = mobsAt(v.seed, cx, cy, v.nextId);
      v.nextId += born.length;
      v.mobs.push(...born);
    }
  }

  // --- mobs ----------------------------------------------------------------
  for (const mob of v.mobs) {
    const ms = MOBS[mob.kind];
    mob.cooldown = Math.max(0, mob.cooldown - dt);

    const toShipX = v.x - mob.x;
    const toShipY = v.y - mob.y;
    const distance = Math.hypot(toShipX, toShipY);
    const tethered = mob.tether > 0 && Math.hypot(v.x - mob.homeX, v.y - mob.homeY) > mob.tether;

    if (distance < ms.sight && !tethered) {
      mob.state = distance <= ms.reach ? 'attack' : 'chase';
    } else if (mob.state !== 'patrol' && (distance > ms.sight * 1.5 || tethered)) {
      mob.state = 'patrol';
    }

    // Patrol is a slow circle of its anchor: something to see from a distance,
    // and a shape that reads as "it has not noticed you yet".
    const target = mob.state === 'patrol'
      ? { x: mob.homeX + Math.cos(mob.id * 1.7 + v.step * dt * 0.35) * 16,
          y: mob.homeY + Math.sin(mob.id * 1.7 + v.step * dt * 0.35) * 16 }
      : { x: v.x, y: v.y };

    const want = Math.atan2(target.y - mob.y, target.x - mob.x);
    mob.heading += Math.max(-ms.turn * dt, Math.min(ms.turn * dt, angleDelta(mob.heading, want)));
    // Station-keeping, not shoving.
    //
    // "Stops closing" used to mean closing at a quarter speed, which over a few
    // seconds simply parks the creature INSIDE the hull — three of them at once
    // and the ship is invisible under a pile of fish. A mob in reach now holds
    // its distance and backs off if it is closer than it wants to be, which is
    // also what makes a swarm read as a swarm rather than as one object.
    const keep = ms.reach * 0.78;
    const closing = mob.state === 'attack'
      ? (distance < keep ? -0.6 : 0.15)
      : mob.state === 'chase' ? 1 : 0.45;
    mob.x += Math.cos(mob.heading) * ms.speed * closing * dt;
    mob.y += Math.sin(mob.heading) * ms.speed * closing * dt;

    if (mob.state === 'attack' && mob.cooldown <= 0 && distance <= ms.reach) {
      mob.cooldown = ms.cadence;
      v.hull -= ms.damage;
      v.sinceHit = 0;
      events.push({ kind: 'hit', x: v.x, y: v.y, damage: ms.damage, target: 'ship', by: 'mob' });
    }
  }

  // --- broadsides ----------------------------------------------------------
  // The cannons decide, not the player. A side fires when it has reloaded and
  // something is inside its arc — so the whole skill is presenting the right
  // beam to the right enemy, which is a steering problem.
  v.reloadPort = Math.max(0, v.reloadPort - dt);
  v.reloadStarboard = Math.max(0, v.reloadStarboard - dt);

  for (const side of ['port', 'starboard'] as const) {
    const ready = side === 'port' ? v.reloadPort : v.reloadStarboard;
    if (ready > 0) continue;
    const beam = v.heading + (side === 'port' ? -Math.PI / 2 : Math.PI / 2);

    let best: Mob | null = null;
    let bestDistance = Infinity;
    for (const mob of v.mobs) {
      const distance = Math.hypot(mob.x - v.x, mob.y - v.y);
      if (distance > spec.range || distance >= bestDistance) continue;
      const bearing = Math.atan2(mob.y - v.y, mob.x - v.x);
      if (Math.abs(angleDelta(beam, bearing)) > spec.arc) continue;
      best = mob;
      bestDistance = distance;
    }
    if (!best) continue;

    // Aimed where the target will be, not where it is. Without the lead, a
    // hammerdead is functionally immune at range and the fight reads as broken.
    const ms = MOBS[best.kind];
    const flight = bestDistance / 70;
    const aimX = best.x + Math.cos(best.heading) * ms.speed * flight;
    const aimY = best.y + Math.sin(best.heading) * ms.speed * flight;
    const shotHeading = Math.atan2(aimY - v.y, aimX - v.x);

    if (side === 'port') v.reloadPort = spec.reload;
    else v.reloadStarboard = spec.reload;
    v.shots.push({
      id: v.nextId++,
      x: v.x, y: v.y,
      vx: Math.cos(shotHeading) * 70,
      vy: Math.sin(shotHeading) * 70,
      life: spec.range / 70 + 0.2,
      damage: spec.damage,
      from: 'ship',
    });
    events.push({ kind: 'fired', side, x: v.x, y: v.y });
  }

  // --- shots ---------------------------------------------------------------
  const surviving: Shot[] = [];
  for (const shot of v.shots) {
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.life -= dt;
    if (shot.life <= 0) continue;

    let struck = false;
    if (shot.from === 'ship') {
      for (const mob of v.mobs) {
        if (mob.hp <= 0) continue;
        if (Math.hypot(mob.x - shot.x, mob.y - shot.y) > MOBS[mob.kind].radius + 1.2) continue;
        mob.hp -= shot.damage;
        events.push({ kind: 'hit', x: shot.x, y: shot.y, damage: shot.damage, target: 'mob', by: 'cannon' });
        struck = true;
        break;
      }
    }
    if (!struck) surviving.push(shot);
  }
  v.shots = surviving;

  // --- deaths and housekeeping --------------------------------------------
  const alive: Mob[] = [];
  for (const mob of v.mobs) {
    if (mob.hp <= 0) {
      const [cx, cy] = mob.cell.split(':').map(Number);
      // Sinking something pays. It did not, and that was a hole under the whole
      // combat system: the guns are automatic, so the only reason to turn a
      // beam onto anything was to stop it biting you — and running was always
      // cheaper than that. Measured, a pilot that fought whatever came at it
      // came home with LESS than one that drove straight past, at every ring.
      // A game whose central verb is a net loss is a game nobody plays twice.
      events.push({
        kind: 'mob-killed', mob: mob.kind, x: mob.x, y: mob.y, ring: ringOf(cx, cy),
        loot: stow(v, spec, BOUNTY[mob.kind]),
      });
      continue;
    }
    // Far-away mobs are dropped, not simulated. Their cell stays in `seen`, so
    // they do not come back — sailing away from a fight ends it for good.
    if (Math.hypot(mob.x - v.x, mob.y - v.y) > SEA_RANGE * 1.6) continue;
    alive.push(mob);
  }
  v.mobs = alive;

  // --- the carpenter -------------------------------------------------------
  // Nothing has touched her for a while, so the crew get to work. This is the
  // one rule that makes sinking a DECISION: without it a hull is a countdown
  // that started when the player left the harbour, every voyage ends the same
  // way, and running for quieter water buys nothing at all. With it, breaking
  // off a fight is a play — and drowning means the player chose to stay.
  v.sinceHit += dt;
  if (v.sinceHit > CALM && v.hull > 0 && v.hull < spec.hull) {
    v.hull = Math.min(spec.hull, v.hull + spec.repair * dt);
  }

  if (v.hull <= 0) {
    v.hull = 0;
    v.sunk = true;
    // Half the hold, rounded in the player's favour. PLAN.md: being sunk costs
    // loot, never progress.
    const lost: Partial<Record<ResourceId, number>> = {};
    for (const [res, amount] of Object.entries(v.cargo) as [ResourceId, number][]) {
      const half = Math.floor(amount / 2);
      if (half > 0) lost[res] = half;
      v.cargo[res] = amount - half;
    }
    events.push({ kind: 'sunk', lost });
  } else if (!v.home && v.departed
             && ringOf(Math.round(v.x / SEA_CELL), Math.round(v.y / SEA_CELL)) === 0
             && Math.hypot(v.x, v.y) < SEA_CELL * HARBOUR) {
    v.home = true;
    events.push({ kind: 'home' });
  }

  // The latch. Having gone is not a distance, and treating it as one stranded
  // people: the radius was 0.9 of a cell — 49 units — while the nearest
  // lootable island in a seeded sea can be taken from twenty-two units out. A
  // player who left the harbour, took the first thing they saw and turned round
  // had done a whole voyage without ever arming the latch, so the arrival never
  // fired, the hold could never be banked and the only way out of the game was
  // to abandon the run. The measured fleet hit it on one first voyage in eight.
  //
  // So: far enough out, OR carrying something that is not from around here.
  // Both are proof, and the radius keeps a comfortable margin over the arrival
  // check so bobbing on the harbour mouth cannot arm and trip it in one breath.
  if (!v.departed && (Math.hypot(v.x, v.y) > SEA_CELL * DEPARTED || v.taken.length > 0)) {
    v.departed = true;
  }

  return { voyage: v, events };
}

/**
 * Which way home is, as an angle to rotate a screen-up arrow by, clockwise.
 *
 * Pure and here rather than in the HUD because it is not decoration: home is
 * invisible from two cells out, so a player who cannot find it cannot bank
 * anything they are carrying, and an arrow pointing the wrong way is worse than
 * no arrow at all. It was wrong the first time — computed as the bearing FROM
 * home rather than TO it — which is exactly the kind of sign error that looks
 * plausible in a screenshot and strands somebody in open water.
 *
 * The camera holds a fixed world orientation, so screen-up is world -y and
 * screen-right is world +x. An arrow rotated clockwise by theta points along
 * (sin theta, -cos theta); pointing it at the origin from (x, y) therefore
 * wants sin theta = -x/d and cos theta = y/d.
 */
export function bearingHome(x: number, y: number): number {
  return Math.atan2(-x, y);
}

/** Sets the helm for the next steps. Clamped here so no caller can exceed it. */
export function steer(v: Voyage, helm: Partial<Helm>): Voyage {
  return {
    ...v,
    helm: {
      turn: Math.max(-1, Math.min(1, helm.turn ?? v.helm.turn)),
      throttle: Math.max(0, Math.min(1, helm.throttle ?? v.helm.throttle)),
    },
  };
}
