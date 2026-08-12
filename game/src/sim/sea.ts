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

// ---------------------------------------------------------------------------
// LA MAREA — the other axis of difficulty, and the one the sea did not have
//
// `ringOf` above is the WHERE. This is the WHEN. SEA_PLAY.md's diagnosis, which
// is correct: "minute ten is exactly as tense as minute one. Pressure is spatial
// only — it rises when you sail outward and falls when you sail back — so the
// only shape a voyage has is one the player draws by leaving."
//
// The tide is one number between 0 and 1, read off the voyage clock and nothing
// else. It MULTIPLIES the ring curve rather than replacing it: how many a cell
// posts, how tough what it posts is, and how close the sea puts things to the
// ship. At level 0 every roll in this file happens in the same order with the
// same arguments as it did before the tide existed, which is why `grace` matters
// as much as `span` — a first voyage sails in the sea that was measured.
//
// Pure, and a function of one argument, so the harness can print the curve
// rather than infer it. `sea.tide` in balance.json is where the shape is argued.

const TIDE = SEA.tide;
/** The level each named stage begins at. Exported so the HUD can put its ticks
 *  where the sim's stages actually are rather than at eyeballed percentages. */
export const TIDE_STAGE_AT: readonly number[] = TIDE.stages;
const SWELL = TIDE.swell;

/** What the sea is called at each step of the flood, outermost id first used by
 *  the HUD. Ids, not copy — the presentation layer names them in Spanish. */
export const TIDE_STAGES = ['calm', 'making', 'high', 'flood'] as const;
export type TideStage = (typeof TIDE_STAGES)[number];

/**
 * The tide at `seconds` of voyage, 0 to 1.
 *
 * Flat through `grace`, then linear to full flood over `span`, then held. `rate`
 * is the loadout's hand on the clock — Contramaestre below 1 makes the whole
 * thing later, grace included, which is what "the tide rises more slowly" has
 * to mean if it is to be worth a pick.
 */
export function tideAt(seconds: number, rate = 1): number {
  const t = (seconds * rate - TIDE.grace) / TIDE.span;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** The inverse: the voyage clock at which the tide reaches `level`. What the
 *  HUD counts down to, and what the harness sweeps by. */
export function tideClock(level: number, rate = 1): number {
  return (TIDE.grace + Math.max(0, Math.min(1, level)) * TIDE.span) / rate;
}

/** Which named step of the flood a level is in. */
export function tideStageOf(level: number): number {
  let stage = 0;
  for (let i = 1; i < TIDE_STAGE_AT.length; i++) if (level >= TIDE_STAGE_AT[i]) stage = i;
  return stage;
}

/**
 * Everything the HUD needs to draw the tide, off one voyage.
 *
 * Exported and shaped for the presentation layer on purpose: a rising threat the
 * player cannot see is a difficulty knob, and SEA_PLAY.md is explicit that this
 * has to be legible. `level` is the bar, `stage` is the pips, `toNext` is the
 * countdown, and the three multipliers are what the sea is actually doing —
 * printable, so the player can be told rather than surprised.
 */
export interface TideRead {
  /** 0 at slack water, 1 at full flood. */
  level: number;
  /** Index into TIDE_STAGES. */
  stage: number;
  stageId: TideStage;
  /** Seconds of voyage until the next stage; 0 once the tide is in. */
  toNext: number;
  /** Multiplier on how many the sea posts. */
  spawns: number;
  /** Multiplier on the hp and the bite of what it posts from here on. */
  toughness: number;
  /** 0 to 1: how much nearer than the horizon the swell is surfacing. */
  closeness: number;
}

export function readTide(v: Voyage): TideRead {
  const level = v.tide;
  const stage = tideStageOf(level);
  const rate = v.loadout.tideRate;
  const next = stage + 1 < TIDE_STAGE_AT.length
    ? Math.max(0, tideClock(TIDE_STAGE_AT[stage + 1], rate) - v.atSea)
    : 0;
  return {
    level,
    stage,
    stageId: TIDE_STAGES[stage],
    toNext: next,
    spawns: 1 + level * TIDE.spawnPerLevel,
    toughness: 1 + level * TIDE.toughPerLevel,
    closeness: level,
  };
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
/**
 * How many creatures may be on the water at once, counted across every source.
 *
 * The per-cell budget is a budget per cell, and fifteen cells are awake at a
 * time — so the only place the crowd can actually be bounded is here. See
 * `sea.$maxLive` in balance.json for why it is one number rather than one per
 * spawner: the tide multiplies the cell budget, and two separate ceilings meant
 * neither of them was the ceiling.
 */
const SEA_MAX_LIVE: number = SEA.maxLive;
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
  /** The cell that produced it, so it is spawned exactly once per visit.
   *  A swell mob belongs to no cell and carries `swell:<n>` instead. */
  cell: string;
  /**
   * The tide multiplier this creature was born under, absent below 1.
   *
   * BAKED IN AT BIRTH rather than read live, and that is the design and not an
   * optimisation: what is already on the water stays what it was, and the
   * frightening thing about a rising tide is what it BRINGS. A player who
   * cleared a nest at slack water does not watch it grow teeth behind them.
   */
  tough?: number;
  /** Seconds of Palanqueta left on it — see `Loadout.chainSlow`. */
  slow?: number;

  // --- the boss's own machinery, absent on everything that is not one -------
  /** A strike being telegraphed: where the tentacles will fall, and when.
   *  Replaced whole on every change, never mutated — stepVoyage's mob copies
   *  are shallow. */
  cast?: { left: number; span: number; targets: Vec2[]; frenzy: boolean } | null;
  /** 1 while submerged. A dived squid cannot be shot and cannot cast; it is
   *  closing, and every hull in the game can outrun it. */
  dive?: number;
  /** Latched at half health, so the phase turn announces itself exactly once. */
  frenzied?: boolean;
}

/**
 * What patrols a cell, deterministically.
 *
 * `tide` is the voyage clock's hand on this cell, and it MULTIPLIES what the
 * ring was already going to post — more of them, tougher, and posted tighter to
 * the thing they are guarding. At tide 0 every draw below happens in the same
 * order with the same arguments as it did before the tide existed, so the sea a
 * first voyage sails is the sea the fleet table measured; `toward` is the ship,
 * used only to decide which HALF of an open-water cell the loners are standing
 * in, so a late arrival is met rather than found.
 */
export function mobsAt(
  seed: string, cx: number, cy: number, nextId: number,
  flood: { tide?: number; toward?: Vec2 } = {}
): Mob[] {
  const ring = ringOf(cx, cy);
  if (ring === 0) return [];
  const tide = Math.max(0, Math.min(1, flood.tide ?? 0));
  const site = siteAt(seed, cx, cy);
  const rng = cellRng(seed, cx, cy, 'mobs');

  // A lair is a boss and its escort, and nothing else in the cell matters. The
  // squid is the one thing the tide does not touch: its whole fight is a
  // telegraphed cast and a health bar the HUD draws in pips, and moving either
  // would make the boss a different boss depending on when you found it.
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
  //
  // THE TIDE IS A COEFFICIENT ON THAT BUDGET, not a second budget. It raises
  // the odds that empty water carries a loner at all and then multiplies
  // whatever the ring drew — so the shape of the sea is still the ring's, and
  // what late means is MORE OF IT. Neither line consumes an extra draw, which
  // is what keeps a tide-0 cell identical to the cell that shipped.
  const openChance = PATROL_OPEN * (1 + tide * TIDE.openPerLevel);
  const drawn = guarded
    ? rng.int(band[0], band[1])
    : rng.chance(openChance) ? rng.int(1, Math.max(1, band[0])) : 0;
  const count = Math.round(drawn * (1 + tide * TIDE.spawnPerLevel));

  // Guards stand on the treasure. Anchoring a patrol anywhere in its cell made
  // the two halves of the game independent: the loot was over there, the
  // monsters were over here, and a ship at full way outruns everything in the
  // sea, so a voyage never had to choose. Measured across a fleet, mobs were
  // doing less damage than the scenery. A patrol ringed round the thing it is
  // guarding is also the readable version — you can SEE what taking that islet
  // is going to cost before you commit to it.
  //
  // AND THE TIDE PUTS THEM CLOSER. Two different meanings of closer, one for
  // each kind of anchor. A guard's post shrinks toward the shore it is standing
  // on, so at the flood the ring of teeth is inside the water the ship has to
  // enter to take the site and cannot be skirted at all. An open-water loner is
  // dragged toward the ship's own side of its cell — the sea meeting a late
  // arrival rather than being found by it. Neither uses a draw.
  const half = SEA_CELL / 2;
  const pull = tide * half;
  /** The anchor's offset inside its own cell, leaned toward the ship and then
   *  held inside the cell — a loner never wanders into the next square. */
  const lean = (drift: number, centre: number, ship: number | undefined): number =>
    ship === undefined ? drift
      : Math.max(-half, Math.min(half, drift + Math.sign(ship - (centre + drift)) * pull));

  const out: Mob[] = [];
  for (let i = 0; i < count; i++) {
    const bearing = rng.range(-Math.PI, Math.PI);
    const reachOut = rng.range(PATROL_POST[0], PATROL_POST[1]) * (1 - tide * TIDE.postShrink);
    const post = guarded ? guarded.radius + reachOut : 0;
    const driftX = rng.range(-half, half);
    const driftY = rng.range(-half, half);
    const hx = guarded ? guarded.x + Math.cos(bearing) * post
      : cx * SEA_CELL + lean(driftX, cx * SEA_CELL, flood.toward?.x);
    const hy = guarded ? guarded.y + Math.sin(bearing) * post
      : cy * SEA_CELL + lean(driftY, cy * SEA_CELL, flood.toward?.y);
    const mob = makeMob(rng.pick(pool), hx, hy, hx, hy, nextId + i, `${cx}:${cy}`, rng);
    // What the ring drew, made worse by when it was drawn. Hp is set here so it
    // is a real number on a real creature the guns have to chew through; the
    // multiplier rides along so the bite can be scaled by the same figure.
    if (tide > 0) {
      mob.tough = 1 + tide * TIDE.toughPerLevel;
      mob.hp = Math.round(MOBS[mob.kind].hp * mob.tough);
    }
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
  /** The deepest ring this hull is a match for. One ring further out and the
   *  voyage raises 'zone-warning' — see balance.json `sea.$rated`. */
  rated: number;
}

/**
 * PLAN.md Fase 4's ladder, in sailing order. Ownership is the Astillero's level
 * (src/sim/shipyard.ts); this table is what each hull IS once it is owned.
 */
export const SHIP_TYPES = ['skiff', 'sloop', 'galleon', 'frigate', 'marauder'] as const;
export type ShipType = (typeof SHIP_TYPES)[number];

export const SHIPS: Record<string, ShipSpec> = {
  skiff: SEA.ships.skiff,
  sloop: SEA.ships.sloop,
  galleon: SEA.ships.galleon,
  frigate: SEA.ships.frigate,
  marauder: SEA.ships.marauder,
};

/** Seconds of not being touched before the crew can start patching. */
const CALM: number = SEA.ships.calm;

// ---------------------------------------------------------------------------
// WEIGHT, and PERTRECHOS: the two things that change what a hull is, mid-voyage
//
// One helper answers both, because there is exactly one place in this file that
// should be allowed to say what the ship's numbers ARE right now, and everything
// downstream — the helm, the guns, the renderer's arc, the HUD's speed readout —
// has to be reading the same answer or they will disagree on screen.

const WEIGHT = SEA.weight;
const GEAR = SEA.loadout;
/**
 * Zafarrancho — see balance.json `sea.$zafarrancho` for the whole argument.
 *
 * Exported because the HUD counts the same seconds the sim does and the suite
 * asserts against the table rather than against copies of its numbers.
 */
export const ZAFARRANCHO: {
  seconds: number; cooldown: number; speed: number; turn: number; drag: number;
} = SEA.zafarrancho;
const DASH = ZAFARRANCHO;

/**
 * THE PERTRECHOS SEAM. SEA_PLAY.md item 3, from this side of it.
 *
 * A flat bag of named coefficients on the ship the sim already simulates. The
 * pool, the thresholds and the one-of-three offer are another module's job and
 * are deliberately not here; what is here is the CONTRACT — fill a field, and
 * the simulation below already reads it, every step, with no further wiring.
 *
 * Neutral is the identity: `NEUTRAL_LOADOUT` reproduces the shipped ship
 * exactly, and the suite asserts that a voyage with an empty loadout replays
 * step for step against one with none at all. Multipliers COMPOSE by
 * multiplication, so two picks of the same pertrecho stack without any of this
 * needing to know that two were picked.
 */
export interface Loadout {
  /** Multiplier on the reload. BELOW 1 is faster — Brigada de artilleros. */
  reload: number;
  /** Multiplier on gun range, both sides — Pólvora fina. */
  range: number;
  /** Multiplier on the half-angle of the firing arc off each beam. */
  arc: number;
  /** Multiplier on top speed, applied after the hold's weight — Fondo de cobre. */
  speed: number;
  /** Multiplier on the helm's rate, applied after the hold's weight. */
  turn: number;
  /** Multiplier on how fast the tide makes. BELOW 1 is a slower tide —
   *  Contramaestre. It scales the whole clock, `tide.grace` included. */
  tideRate: number;
  /** 0 to 1: the fraction of its speed a ball takes off what it hits, for
   *  `loadout.chain.seconds` — Palanqueta. 0 is no chain shot at all. */
  chainSlow: number;
  /** The broadside fires a fan instead of a ball — Metralla. More of them,
   *  each for less; see `sea.loadout.spread` for the trade. */
  spread: boolean;
  /** 0 to 1: added to the share of the hold that survives a sinking, capped by
   *  `sea.loadout.guardMax` — Bodega falsa. */
  holdGuard: number;
  /** Multiplier on the hold — Estiba maestra. Rounded where it is applied,
   *  because `stow` counts cargo in whole units. It argues with the weight
   *  rule on purpose: more capacity is more to carry. */
  hold: number;
  /** Multiplier on the carpenter's rate — Carpintero de ribera. The eight in
   *  SEA_PLAY.md are seven guns and a hull-speed bonus, with no answer at all
   *  to "the hull is going"; this is that answer. */
  repair: number;
  /** World units a second a target already inside the firing arc is dragged
   *  toward the beam — Arpón. 0 is no harpoon. It pulls the TARGET, never the
   *  ship, so it can never be used to swim. */
  harpoon: number;
}

/** The identity element. An empty loadout changes NOTHING, which is the
 *  property that lets this land before the module that fills it. */
export const NEUTRAL_LOADOUT: Loadout = {
  reload: 1, range: 1, arc: 1, speed: 1, turn: 1, tideRate: 1,
  chainSlow: 0, spread: false, holdGuard: 0,
  hold: 1, repair: 1, harpoon: 0,
};

/** A loadout with any subset of the fields set, defaulted to neutral. What the
 *  pertrechos module hands in, and the one place a partial becomes whole. */
export function loadoutOf(partial: Partial<Loadout> = {}): Loadout {
  return { ...NEUTRAL_LOADOUT, ...partial };
}

/**
 * The hold this voyage actually has, in whole units.
 *
 * ONE expression, because two would drift. `effectiveShip` needs it and so does
 * `holdLoad`, and `effectiveShip` cannot ask `holdLoad` for it without going
 * round in a circle — the weight rule's input is the hold, and the hold is one
 * of the things the loadout moves. Rounded, because `stow` counts cargo in
 * whole units and a hold of 1097.99 is a hold that can never quite be filled.
 */
export function ratedHold(v: Voyage): number {
  return Math.round(SHIPS[v.shipType].hold * v.loadout.hold);
}

/**
 * How full the hold is, 0 to 1. The one input the weight rule has.
 *
 * Measured against the hold the ship HAS rather than the one the shipyard sold,
 * which is what makes Estiba maestra a trade rather than a straight upgrade in
 * one direction or the other: a bigger hold carrying the same cargo is a
 * lighter ship, and a bigger hold filled to the brim is a heavier one.
 */
export function holdLoad(v: Voyage): number {
  const hold = ratedHold(v);
  return hold > 0 ? Math.max(0, Math.min(1, holdUsed(v) / hold)) : 0;
}

/**
 * THE SHIP AS SHE IS RIGHT NOW: her rating, her cargo and her pertrechos.
 *
 * Exported because the render layer draws the firing arc and the HUD prints the
 * speed, and a ship that handles one way and is drawn another is worse than no
 * feedback at all. Everything the hold and the loadout can move is moved here
 * and nowhere else.
 *
 * What is NOT moved: hull, hold, radius, damage, repair and rated. Those are
 * what the hull IS — the shipyard sold them, the end card reports them, and a
 * cargo that changed the size of the hold it is sitting in would be a joke.
 */
export function effectiveShip(v: Voyage): ShipSpec {
  const spec = SHIPS[v.shipType];
  const load = holdLoad(v);
  const gear = v.loadout;
  return {
    ...spec,
    // ZAFARRANCHO rides on top of everything else — the weight and the
    // pertrechos both still count, so a full hold under zafarrancho is a full
    // hold moving faster rather than an empty one. It is three seconds of the
    // ship handled harder, not three seconds of a different ship.
    speed: spec.speed * (1 - load * WEIGHT.speed) * gear.speed * (v.dash > 0 ? DASH.speed : 1),
    turn: spec.turn * (1 - load * WEIGHT.turn) * gear.turn * (v.dash > 0 ? DASH.turn : 1),
    accel: spec.accel * (1 - load * WEIGHT.accel),
    // Drag goes the other way: a laden hull gives up MORE way through a hard
    // turn, which is what makes a full hold feel like a full hold on the stick.
    //
    // And this is the multiplier that makes zafarrancho a MANOEUVRE rather than
    // a straight-line boost: turning normally sheds way, so a hard turn at
    // speed is a slow turn. For these three seconds it barely costs anything,
    // which is what lets a hull be thrown across a telegraph instead of arcing
    // politely away from it.
    turnDrag: Math.min(0.9, spec.turnDrag * (1 + load * WEIGHT.drag) * (v.dash > 0 ? DASH.drag : 1)),
    reload: spec.reload * gear.reload,
    range: spec.range * gear.range,
    arc: spec.arc * gear.arc,
    hold: ratedHold(v),
    repair: spec.repair * gear.repair,
  };
}

/**
 * How close to the origin, in cells, counts as being back in the harbour.
 *
 * Was 0.3 — sixteen units, less than a ship's turning circle. A player carrying
 * a full hold had to thread a needle to bank it, and a near miss meant going
 * round again with whatever was chasing them. The departure latch arms outside
 * this same radius and no closer than `DEPARTED` unless the ship is carrying
 * loot, so no amount of bobbing at the harbour mouth can arm and trip it in one
 * breath.
 *
 * EXPORTED because the HUD needs the same number. It kept its own 0.5, which is
 * two and a half units of sea further out, and spent every voyage announcing an
 * arrival the simulation had not made yet.
 */
export const HARBOUR: number = SEA.harbour;

/** How far out, in cells, counts as having left — see the latch at the foot of
 *  `stepVoyage`, which is where the reasoning is. */
const DEPARTED: number = SEA.departed;

/* --------------------------------------------------------------------------
 * landfall — what the harbour actually takes off a voyage
 * ----------------------------------------------------------------------- */

const LANDFALL = SEA.landfall;
const KEEP: readonly number[] = LANDFALL.keep;
const SUNK_SHARE: number = LANDFALL.sunk;
const CAREEN_RATE: number = LANDFALL.careen.rate;
const CAREEN_ORDER = LANDFALL.careen.order as readonly ResourceId[];

/**
 * The fraction of a hold that reaches the stores from a voyage that ended HERE.
 *
 * Round 13's playtest found the sea's biggest hole and it was not a bug: "Volver
 * banks the entire hold instantly from any distance and any hull state — I
 * tapped it at 200m out with the hull at 19% and kept everything, twice." Every
 * ring pays more than the last, and nothing at all charged for the trip back, so
 * the risk/reward curve `rings` spends forty lines calibrating never reached the
 * player. Distance was difficulty in one direction only.
 *
 * This is the other direction, and it is one number: THE SEA CHARGES BY
 * DISTANCE. A full hold banks in full only from home water — the arrival the
 * departure latch and the 'home' event below already model — and anywhere else
 * the crew land what they can carry through the water they are in.
 *
 * Indexed by the ring the voyage ended in, which is the number the HUD's zone
 * chip has been showing all voyage, so the charge is never a surprise. Inside
 * `harbour` it is exactly 1: the last twenty-five units of water are worth the
 * whole tithe, and Volver at the dock costs nothing at all.
 */
export function landfallShare(x: number, y: number): number {
  // ONE definition of home in this file, and it is the one the 'home' event and
  // the HUD's compass already use. The harbour's own CELL is a shade wider than
  // its radius — 27.5 units against 24.75 — so the table is read from ring 1
  // for anything outside home water, including that sliver: the gentlest rate
  // in the table for the water closest to the dock, and no second answer to the
  // question "am I home".
  if (Math.hypot(x, y) < SEA_CELL * HARBOUR) return 1;
  const ring = ringOf(Math.round(x / SEA_CELL), Math.round(y / SEA_CELL));
  return KEEP[Math.min(Math.max(ring, 1), KEEP.length) - 1];
}

/** What the yard charges to refloat and patch a hull that went down out there.
 *  A fraction of the hull it is repairing, so every deck pays its own size. */
export function careenBill(shipType: string): number {
  return Math.round((SHIPS[shipType] ?? SHIPS.skiff).hull * CAREEN_RATE);
}

/**
 * Takes `share` of every resource in `from`, rounding in the player's favour.
 *
 * One place, so the tithe, the sinking and anything that comes later cannot
 * disagree about what "half" means. `Math.ceil` is deliberate and is the rule
 * the sinking rule already had: an odd unit belongs to the crew.
 */
function keepShare(
  from: Partial<Record<ResourceId, number>>, share: number
): { kept: Partial<Record<ResourceId, number>>; lost: Partial<Record<ResourceId, number>> } {
  const kept: Partial<Record<ResourceId, number>> = {};
  const lost: Partial<Record<ResourceId, number>> = {};
  for (const [res, amount] of Object.entries(from) as [ResourceId, number][]) {
    if (!(amount > 0)) continue;
    const stays = Math.ceil(amount * share);
    if (stays > 0) kept[res] = stays;
    if (amount - stays > 0) lost[res] = amount - stays;
  }
  return { kept, lost };
}

/**
 * Charges `units` against a hold, materials first, and reports what it took.
 *
 * PLAN.md Fase 3's cheap-but-real repair, charged where this round can actually
 * charge it. It stops when the hold is dry: a wreck can leave the player with
 * nothing, and it can never leave them owing anything. `order` puts timber and
 * iron in front of the gold because that is what a yard wants and because
 * taking the gold last is the version of this a player forgives.
 */
function chargeBill(
  hold: Partial<Record<ResourceId, number>>, units: number
): Partial<Record<ResourceId, number>> {
  const taken: Partial<Record<ResourceId, number>> = {};
  let owed = units;
  for (const res of CAREEN_ORDER) {
    if (owed <= 0) break;
    const have = hold[res] ?? 0;
    if (have <= 0) continue;
    const pay = Math.min(have, owed);
    taken[res] = pay;
    hold[res] = have - pay;
    owed -= pay;
  }
  return taken;
}

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
   * Units the yard actually took off this voyage to refloat and patch her.
   *
   * 0 on every voyage that came back on her own bottom, and 0 on one that went
   * down inside the harbour. It is recorded rather than recomputed because the
   * bill is charged against a hold that may not cover it — what the player is
   * owed an explanation for is what was TAKEN, not what was owed.
   */
  careened: number;
  /**
   * Set once the player has struck the colours and left the sea from here.
   *
   * The third way a voyage ends, and until this round the only one the
   * simulation could not see: sinking and arriving are things the sea does, and
   * quitting is a thing a thumb does. That asymmetry was a real bug and not a
   * tidiness point — with no end state to latch, the scene went on stepping the
   * sim underneath the end-of-voyage card, so a ship abandoned at 19% hull with
   * mobs still on her went down while the player was reading what she had
   * brought home, and the ledger credited half of what the card had promised.
   * Verified three times in three by round 13's playtest.
   *
   * Set by `abandonVoyageInPlace`, which is what the sea HUD's Volver dispatches
   * into the sim. Like `sunk` and `home` it freezes `stepVoyage`, so the numbers
   * on the card are the numbers the island banks.
   */
  abandoned: boolean;
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
  /**
   * Whether this voyage is still owed the Cofre de las Profundidades.
   *
   * True at the start of a voyage whose caller says the season's chest is
   * unclaimed (the sim keeps no calendar, so once-per-season is the caller's
   * fact, handed in through startVoyage); cleared the moment a squid kill pays
   * it, so a second boss on the same voyage pays only its bounty.
   */
  deepChest: boolean;
  /**
   * A boarding party away at a wreck — see balance.json `sea.boarding`.
   *
   * Wrecks are not taken by touch: the party rows over for `span` seconds and
   * the loot only lands if the ship is still on station when they return.
   * Null whenever nobody is over the side.
   */
  boarding: { siteId: string; left: number; span: number } | null;
  /**
   * The deepest ring this voyage has already been warned about — 0 until the
   * first 'zone-warning'. The latch that makes the warning ONE event per
   * crossing rather than a toast per step: a deeper crossing warns again, a
   * ship bobbing on a ring boundary does not, and a retreat-and-return is not
   * re-lectured about water it has already been told about.
   */
  warnedRing: number;

  // --- LA MAREA. The voyage's own clock, and what the sea does with it. -----
  /**
   * Seconds since ¡Zarpar!, accumulated a step at a time.
   *
   * `step` counts steps and is the determinism ledger; this is the number a
   * PERSON is in, and it is separate because `dt` is an argument. A voyage that
   * has ended stops adding to it, like everything else here.
   */
  atSea: number;
  /** The tide, 0 to 1 — `tideAt(atSea, loadout.tideRate)`, kept on the voyage
   *  so the HUD can draw it without recomputing the rule. */
  tide: number;
  /** The last stage the voyage was TOLD about. The same latch `warnedRing` is:
   *  one 'tide-turn' per crossing, and the tide only ever makes. */
  tideStage: number;
  /** How many swells the sea has already sent. The swell's own clock, and the
   *  index its seeded stream is forked on, so a replay sends the same ones. */
  swells: number;

  // --- ZAFARRANCHO. The one verb that is not the helm. ---------------------
  /** Seconds of the burst still running; 0 when she is sailing normally. */
  dash: number;
  /** Seconds until it can be called again; 0 when it is ready. Counts down
   *  through the burst as well, so `cooldown` is the whole cycle rather than
   *  the wait after it — one number for the player to read. */
  dashCooldown: number;

  /**
   * The pertrechos in the hold, as coefficients — see `Loadout`.
   *
   * Owned by another module and read by this one. Neutral by default, which is
   * why this landed before that module exists.
   */
  loadout: Loadout;
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
  /** `lost` is what went down with her — the half, plus whatever the distance
   *  home took off the half. `careen` is the yard's bill for refloating her,
   *  charged out of what did land and empty when she sank inside the harbour.
   *  Both are itemised because the end card has to be able to say WHY. */
  | { kind: 'sunk'; lost: Partial<Record<ResourceId, number>>; careen: Partial<Record<ResourceId, number>> }
  | { kind: 'home' }
  /** The player left the sea from here rather than sailing the hold home.
   *  `kept` is what the crew land, `lost` is the sea's tithe on the rest. */
  | { kind: 'abandoned'; ring: number; share: number; kept: Partial<Record<ResourceId, number>>; lost: Partial<Record<ResourceId, number>> }
  /** The ship has crossed into a ring deeper than its hull is rated for
   *  (`ShipSpec.rated`) — round 11's playtest finding 6: twin ring-3
   *  hammerdeads melted a skiff with no warning that zones outrank the
   *  starter hull. Once per crossing, deterministic, and only ever deeper:
   *  the presentation layer draws it, the player still chooses. */
  | { kind: 'zone-warning'; ring: number; rated: number }
  // --- the tide. The voyage's arc, said out loud. --------------------------
  /** The tide has made into a new stage. Once per crossing, deterministic, and
   *  only ever upward — the same latch the zone warning uses, for the same
   *  reason. `level` is 0..1 and `stage` indexes TIDE_STAGES; the presentation
   *  layer names it and the player decides whether to stay. */
  | { kind: 'tide-turn'; stage: number; stageId: TideStage; level: number }
  // --- zafarrancho. Two, because the START is the player's own doing and needs
  // no announcing — they just pressed it — while the END and the READY are
  // things the sea tells them about. A wake that stops with no cue reads as a
  // stutter, and a button that goes live in silence is a button nobody presses.
  | { kind: 'dash-ended' }
  | { kind: 'dash-ready' }
  /** The sea has put something on the water near the ship, because it is late
   *  rather than because the ship went anywhere. `count` surfaced at (x, y);
   *  the renderer owes this a boil of foam, because a threat that simply
   *  appears is a threat the player was not warned about. */
  | { kind: 'swell'; x: number; y: number; count: number; level: number }
  // --- the boss's beats. Every one is a picture the scene owes the player. --
  /** Tentacles rise: the strike circles are on the water, and there are
   *  `seconds` left to not be inside one. */
  | { kind: 'squid-tell'; x: number; y: number; targets: Vec2[]; seconds: number; frenzy: boolean }
  /** They fall. `hit` says whether the ship was still standing in one — the
   *  damage itself also arrives as a normal 'hit' event, so every existing
   *  consumer (veil, shake, balance harness) keeps working unchanged. */
  | { kind: 'squid-strike'; targets: Vec2[]; hit: boolean; damage: number }
  | { kind: 'squid-dive'; x: number; y: number }
  | { kind: 'squid-surface'; x: number; y: number }
  /** Half health: the pattern is about to change, once per squid. */
  | { kind: 'squid-phase'; x: number; y: number }
  /** The guaranteed reward, through the same stow() everything else pays. */
  | { kind: 'deep-chest'; x: number; y: number; loot: Partial<Record<ResourceId, number>> }
  // --- boarding a wreck. The loot itself still arrives as 'looted'. ---------
  | { kind: 'boarding-started'; siteId: string; x: number; y: number; seconds: number }
  /** The ship left the wreck with the party still aboard it: nothing pays,
   *  and coming back starts the clock from zero. */
  | { kind: 'boarding-broken'; siteId: string };

export function startVoyage(
  seed: string, shipType = 'skiff',
  opts: { deepChest?: boolean; loadout?: Partial<Loadout> } = {}
): Voyage {
  const spec = SHIPS[shipType];
  return {
    seed, step: 0, shipType,
    x: 0, y: 0, heading: 0, speed: 0, hull: spec.hull,
    reloadPort: 0, reloadStarboard: 0,
    helm: { turn: 0, throttle: 0 },
    cargo: {}, mobs: [], shots: [], taken: [], seen: [], nextId: 1,
    sinceHit: CALM, aground: 0,
    sunk: false, careened: 0, abandoned: false, departed: false, home: false,
    deepChest: opts.deepChest ?? true,
    boarding: null,
    warnedRing: 0,
    atSea: 0, tide: 0, tideStage: 0, swells: 0,
    dash: 0, dashCooldown: 0,
    loadout: loadoutOf(opts.loadout),
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
 *
 * Exported for the suite, which has to be able to prove that a hold made bigger
 * by Estiba maestra actually TAKES more rather than merely reporting a larger
 * number — and this is the one function that decides that.
 */
export function stow(
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

/** The boss's numbers — balance.json `sea.boss`, where the design is argued. */
const BOSS = SEA.boss;

/** The strike circle's radius, exported so the renderer draws the tell the
 *  exact size the resolution will use. One number, one owner. */
export const SQUID_STRIKE_RADIUS: number = BOSS.strikeRadius;

/**
 * One step of the Giant Squid — ROADMAP round 10's missing fight.
 *
 * The design in one paragraph: the squid never bites on contact. It CASTS —
 * tentacles rise over marked circles of water, a beat of warning passes, and
 * only a ship still inside a circle when they fall is hit. So every point of
 * damage the boss ever deals was dodgeable on the stick, which is the one
 * property a telegraphed fight has to have. At half health the circles start
 * leading the ship's own course and come faster, so phase one is dodged by
 * moving and phase two by TURNING. And because its arms are shorter than any
 * ship's guns, standing off and shelling it is answered rather than allowed:
 * out of reach it submerges — unshootable — and closes, so the fight has to be
 * fought inside the pocket where the circles can find you.
 *
 * Everything here mutates `mob` (already this step's copy) and reads the ship
 * from `v`; the caller's generic machinery is skipped entirely for the boss,
 * so nothing below fights the station-keeping rules written for a kelpling.
 */
function stepSquid(
  v: Voyage, mob: Mob, distance: number, tethered: boolean, dt: number, events: SeaEvent[]
): void {
  const ms = MOBS.squid;

  // Half health turns the phase, exactly once, wherever the fight stands. The
  // clock is pulled in so the new pattern is SEEN within a breath of the
  // announcement instead of deduced three casts later.
  if (!mob.frenzied && mob.hp <= ms.hp * BOSS.frenzyAt) {
    mob.frenzied = true;
    mob.cooldown = Math.min(mob.cooldown, 0.8);
    events.push({ kind: 'squid-phase', x: mob.x, y: mob.y });
  }
  const frenzy = mob.frenzied === true;

  // Same aggro rules as the rest of the sea; 'attack' means "in the pocket".
  if (distance < ms.sight && !tethered) {
    mob.state = distance <= BOSS.strikeRange ? 'attack' : 'chase';
  } else if (mob.state !== 'patrol' && (distance > ms.sight * 1.5 || tethered)) {
    mob.state = 'patrol';
  }

  // --- tentacles in the air ------------------------------------------------
  // A casting squid is planted. The circles were fixed the moment the tell
  // went up — dodging is the SHIP's job, and moving the goal after the warning
  // would make the warning a lie.
  if (mob.cast) {
    const left = mob.cast.left - dt;
    if (left > 0) {
      // Replaced, never mutated: the step's mob copies are shallow.
      mob.cast = { ...mob.cast, left };
    } else {
      const spec = SHIPS[v.shipType];
      const damage = mob.cast.frenzy ? BOSS.frenzyDamage : BOSS.strikeDamage;
      // One bite per volley however many circles catch the hull: the volley is
      // one attack drawn in three places, not three attacks stacked.
      const hit = mob.cast.targets.some(
        (t) => Math.hypot(v.x - t.x, v.y - t.y) <= BOSS.strikeRadius + spec.radius * 0.45
      );
      if (hit) {
        v.hull -= damage;
        v.sinceHit = 0;
        // A normal 'hit' as well, so the veil, the shake and the balance
        // harness all keep reading the fight without learning a new word.
        events.push({ kind: 'hit', x: v.x, y: v.y, damage, target: 'ship', by: 'mob' });
      }
      events.push({ kind: 'squid-strike', targets: mob.cast.targets, hit, damage });
      mob.cast = null;
      mob.cooldown = frenzy ? BOSS.cadenceFrenzy : BOSS.cadence;
    }
    return;
  }

  // --- underwater ----------------------------------------------------------
  // Fast, unshootable, and closing — or going home, once the chase is off.
  // Every hull in the game outruns diveSpeed, so running always works; what a
  // dive refuses to allow is parking at gun range and shelling a boss whose
  // arms are shorter than your cannons.
  if (mob.dive) {
    const hunting = mob.state !== 'patrol';
    const tx = hunting ? v.x : mob.homeX;
    const ty = hunting ? v.y : mob.homeY;
    const want = Math.atan2(ty - mob.y, tx - mob.x);
    const swing = ms.turn * 1.6 * dt;
    mob.heading += Math.max(-swing, Math.min(swing, angleDelta(mob.heading, want)));
    mob.x += Math.cos(mob.heading) * ms.speed * BOSS.diveSpeed * dt;
    mob.y += Math.sin(mob.heading) * ms.speed * BOSS.diveSpeed * dt;

    const shipGap = Math.hypot(v.x - mob.x, v.y - mob.y);
    const homeGap = Math.hypot(mob.x - mob.homeX, mob.y - mob.homeY);
    if (hunting ? shipGap <= BOSS.strikeRange * 0.7 : homeGap < 6) {
      mob.dive = 0;
      // The pause is the player's window: a surfacing squid can be shot for
      // `surfacePause` before its first cast can begin.
      mob.cooldown = Math.max(mob.cooldown, BOSS.surfacePause);
      events.push({ kind: 'squid-surface', x: mob.x, y: mob.y });
    }
    return;
  }

  // --- surfaced, nobody worth fighting -------------------------------------
  if (mob.state === 'patrol') {
    const offPost = Math.hypot(mob.x - mob.homeX, mob.y - mob.homeY);
    if (offPost > 10) {
      mob.dive = 1;
      events.push({ kind: 'squid-dive', x: mob.x, y: mob.y });
      return;
    }
    // The same slow circle every guard walks — the shape that reads as
    // "it has not noticed you yet".
    const want = Math.atan2(
      mob.homeY + Math.sin(mob.id * 1.7 + v.step * dt * 0.35) * 16 - mob.y,
      mob.homeX + Math.cos(mob.id * 1.7 + v.step * dt * 0.35) * 16 - mob.x
    );
    const swing = ms.turn * dt;
    mob.heading += Math.max(-swing, Math.min(swing, angleDelta(mob.heading, want)));
    mob.x += Math.cos(mob.heading) * ms.speed * 0.45 * dt;
    mob.y += Math.sin(mob.heading) * ms.speed * 0.45 * dt;
    return;
  }

  // --- hunting on the surface ----------------------------------------------
  // Out of the pocket is out of the fight, and it does not stay that way.
  if (distance > BOSS.strikeRange * 1.15) {
    mob.dive = 1;
    events.push({ kind: 'squid-dive', x: mob.x, y: mob.y });
    return;
  }

  // In the pocket: face the ship, hold a station its circles can reach from,
  // and cast on its own clock.
  const want = Math.atan2(v.y - mob.y, v.x - mob.x);
  const swing = ms.turn * dt;
  mob.heading += Math.max(-swing, Math.min(swing, angleDelta(mob.heading, want)));
  const keep = BOSS.strikeRange * 0.7;
  const closing = distance < keep * 0.8 ? -0.5 : distance > keep * 1.15 ? 0.6 : 0.12;
  mob.x += Math.cos(mob.heading) * ms.speed * closing * dt;
  mob.y += Math.sin(mob.heading) * ms.speed * closing * dt;

  if (mob.cooldown <= 0 && distance <= BOSS.strikeRange) {
    // Phase one: one circle, dropped ON the ship — any way at all walks out of
    // it. Phase two: a line of them laid along the ship's own course, so the
    // straight line that dodged phase one now runs INTO the second and third
    // circle, and the dodge becomes a turn.
    const targets: Vec2[] = [{ x: v.x, y: v.y }];
    let span = BOSS.tell;
    if (frenzy) {
      span = BOSS.tellFrenzy;
      const vx = Math.cos(v.heading) * v.speed;
      const vy = Math.sin(v.heading) * v.speed;
      for (let i = 1; i < BOSS.volley; i++) {
        targets.push({
          x: v.x + vx * BOSS.volleyLead * i,
          y: v.y + vy * BOSS.volleyLead * i,
        });
      }
    }
    mob.cast = { left: span, span, targets, frenzy };
    events.push({ kind: 'squid-tell', x: mob.x, y: mob.y, targets, seconds: span, frenzy });
  }
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
  // A VOYAGE THAT HAS ENDED IS OVER, AND ALL THREE ENDINGS COUNT.
  //
  // `sunk` has frozen the step since the sim was written. The other two did
  // not, and that was round 13's ledger bug: the scene keeps its frame loop
  // running while the end-of-voyage card is up, so a ship that reached home or
  // was abandoned went on sailing, went on being shot at, and could go down
  // underneath the card — halving a hold the card had already promised in full.
  // "Voyage A promised Oro 48 and Madera 265 and credited +24 and +133", three
  // times in three. The card, the preview and the island ledger are the same
  // arithmetic on the same object, so the only fix that holds is for that
  // object to stop changing the instant the voyage ends.
  if (v.sunk || v.home || v.abandoned) return { voyage: v, events };

  v.step += 1;

  // --- zafarrancho, running down -------------------------------------------
  // ABOVE the `effectiveShip` read below, and that is the whole reason it is
  // here rather than beside the tide: `spec` is taken ONCE at the top of the
  // step and everything under it sails that ship. Ticking the burst down after
  // the read would give every dash one extra step of boosted hull at the end,
  // and the step the burst ends on would be a step where the numbers and the
  // screen disagree about which ship is on the water.
  if (v.dash > 0) {
    v.dash = Math.max(0, v.dash - dt);
    if (v.dash === 0) events.push({ kind: 'dash-ended' });
  }
  if (v.dashCooldown > 0) {
    v.dashCooldown = Math.max(0, v.dashCooldown - dt);
    if (v.dashCooldown === 0) events.push({ kind: 'dash-ready' });
  }

  // THE HULL AS SHE IS, not as the shipyard sold her: what the hold weighs and
  // what the pertrechos changed are already in these numbers. One read, at the
  // top, so nothing below can be sailing a different ship from the guns.
  //
  // `rated`, `hull`, `hold` and `radius` are the same either way, so the few
  // places that only want the rating (the zone warning, the boss's own reach)
  // are free to keep asking SHIPS directly.
  const spec = effectiveShip(v);

  // --- the tide ------------------------------------------------------------
  // SEA_PLAY.md item 1: the voyage's arc, and the only pressure in this file
  // that is not a distance. It is read before anything spawns, because what the
  // tide is at this instant is what the sea hands over at this instant.
  v.atSea += dt;
  v.tide = tideAt(v.atSea, v.loadout.tideRate);
  const stage = tideStageOf(v.tide);
  if (stage > v.tideStage) {
    // Latched like the zone warning, and for the same reason: this is a thing
    // said once, at a crossing, about water the player can still choose to
    // leave. The tide never ebbs inside a voyage, so it can never un-say it.
    v.tideStage = stage;
    events.push({ kind: 'tide-turn', stage, stageId: TIDE_STAGES[stage], level: v.tide });
  }

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

    // A ship boarding THIS site is moored to it, not ramming it. Without the
    // exemption the boarding beat punished exactly the thing it asks for —
    // holding station against the wreck for the length of the wait cost a
    // scrape every grace period, and the fleet table read reef damage TRIPLED
    // at every ring. The hull still cannot clip through (the push-out above
    // has already run); it just stops being charged for staying.
    const moored = v.boarding !== null && v.boarding.siteId === site.id;

    // How much of the ship's way was aimed AT the rock: 1 is head-on, 0 is a
    // touch along its face, below 0 is already leaving.
    const hx = Math.cos(v.heading);
    const hy = Math.sin(v.heading);
    const into = -(hx * nx + hy * ny);
    if (into <= 0) continue;

    const free = spec.speed * ground.safeSpeed;
    const impact = into * v.speed;
    if (!moored && v.aground <= 0 && impact > free) {
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
  //
  // Except a wreck, which since ROADMAP round 10 is a BEAT rather than a
  // touch: the boarding party rows over for `sea.boarding.seconds`, and the
  // haul comes back as a burst only if the ship is still on station when they
  // do. Nothing about the rest of the step pauses for it — mobs keep closing,
  // the guns keep firing, the hull keeps taking bites — so boarding under
  // fire is a choice with a price, which is the whole point of the wait.
  const grabRange = (site: Site) => site.radius + spec.radius + SEA.loot.reach;
  const payOut = (site: Site): void => {
    const taken = stow(v, spec, site.loot);
    const used = Object.values(taken).reduce((a, b) => a + b, 0);
    v.taken.push(site.id);
    events.push({ kind: 'looted', site: site.kind, loot: taken, x: site.x, y: site.y });
    if (used < Object.values(site.loot).reduce((a, b) => a + b, 0)) events.push({ kind: 'hold-full' });
  };

  // The party that is already over the side. Drift out past the slack and
  // they row back empty — coming round again starts the clock from zero, so
  // a wreck is a commitment rather than a drive-by.
  if (v.boarding) {
    const [bcx, bcy] = v.boarding.siteId.split(':').map(Number);
    const site = siteAt(v.seed, bcx, bcy);
    if (!site || v.taken.includes(site.id)) {
      v.boarding = null;
    } else if (Math.hypot(v.x - site.x, v.y - site.y) > grabRange(site) + SEA.boarding.slack) {
      events.push({ kind: 'boarding-broken', siteId: site.id });
      v.boarding = null;
    } else {
      const left = v.boarding.left - dt;
      if (left > 0) {
        v.boarding = { ...v.boarding, left };
      } else if (spec.hold - holdUsed(v) <= 0) {
        // The party is back and the hold is full: the wreck is NOT consumed
        // for nothing — same refusal the instant path gives, said every step
        // the ship stays parked on an unclaimable prize.
        v.boarding = { ...v.boarding, left: 0 };
        events.push({ kind: 'hold-full' });
      } else {
        payOut(site);
        v.boarding = null;
      }
    }
  }

  for (const site of sitesNear(v.seed, v.x, v.y, 60)) {
    if (site.kind === 'reef' || v.taken.includes(site.id)) continue;
    if (Math.hypot(v.x - site.x, v.y - site.y) > grabRange(site)) continue;
    // A lair does not give up its cargo while its guardian is alive.
    if (site.kind === 'lair' && v.mobs.some((m) => m.cell === site.id && m.kind === 'squid')) continue;

    if (spec.hold - holdUsed(v) <= 0) { events.push({ kind: 'hold-full' }); continue; }

    // A wreck has an inside: the party rows over instead of the ship grabbing.
    if (site.kind === 'wreck') {
      if (!v.boarding) {
        v.boarding = { siteId: site.id, left: SEA.boarding.seconds, span: SEA.boarding.seconds };
        events.push({
          kind: 'boarding-started', siteId: site.id, x: site.x, y: site.y,
          seconds: SEA.boarding.seconds,
        });
      }
      continue;
    }

    payOut(site);
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
      // The tide is handed to the cell, not applied after it: how many it
      // posts, how tough they are and which half of it they are standing in are
      // all the cell's own answer, asked at the hour the ship arrived.
      const born = mobsAt(v.seed, cx, cy, v.nextId, { tide: v.tide, toward: { x: v.x, y: v.y } });
      // THE CROWD CEILING, and it is deferral rather than deletion. A cell that
      // does not fit is left UNSWEPT, so it hands over the moment the guns make
      // room — the sea keeps a queue instead of a pile, and "a cell hands over
      // its patrol once per voyage" still holds because it has not handed over
      // anything yet. All-or-nothing per cell, so a brood arrives as the brood
      // the cell drew; and admitted regardless on an empty sea, because a cell
      // whose own draw is larger than the whole ceiling must never deadlock.
      if (v.mobs.length > 0 && v.mobs.length + born.length > SEA_MAX_LIVE) continue;
      v.seen.push(key);
      v.nextId += born.length;
      v.mobs.push(...born);
    }
  }

  // --- the swell -----------------------------------------------------------
  // WHAT MAKES THE CLOCK BITE WHEN THE SHIP IS NOT MOVING.
  //
  // A cell hands over its patrol exactly once per voyage, which is the rule
  // that stops a player farming one square by driving in and out of it — and it
  // would also have made the tide a tax on EXPLORING rather than on STAYING.
  // Park in swept water and no cell has anything left to give, so a rising tide
  // that only multiplies spawns is a rising tide a player can wait out by
  // stopping. That is the opposite of an arc.
  //
  // So the sea itself puts things on the water: on its own clock, faster and
  // closer and in greater numbers the higher the tide, drawn from the pool of
  // the ring the ship is standing in — the tide MULTIPLIES the ring here too,
  // it does not overrule it, and ring 1 stays a ring-1 problem however late it
  // gets. Never in home water, because the harbour is the one place a voyage
  // can always end. Never past `maxLive`, which is the same readability budget
  // `patrols` is written against: a fight nobody can count is weather.
  const flood = v.tide;
  if (flood > 0 && !v.sunk) {
    const every = SWELL.every[0] + (SWELL.every[1] - SWELL.every[0]) * flood;
    const due = Math.floor(v.atSea / every);
    const here = ringOf(Math.round(v.x / SEA_CELL), Math.round(v.y / SEA_CELL));
    if (due > v.swells && here > 0 && v.mobs.length < SEA_MAX_LIVE) {
      const rng = new Rng(`${v.seed}:swell:${due}`);
      const pool = byRing(PATROL_POOLS, here) as readonly MobKind[];
      const wanted = Math.round(SWELL.count[0] + (SWELL.count[1] - SWELL.count[0]) * flood);
      // ONE KIND PER SWELL. A shoal is a shoal — three of the same thing
      // surfacing together is a readable event, three different things is
      // weather, and the sim's own crowding note is that a fight nobody can
      // count is not a fight.
      const kind = rng.pick(pool);
      // HOW CLOSE, measured against what the creature can SEE rather than in
      // bare units, because the two are the same question. A swell at 1.35 of
      // its own sight surfaces outside its notice: it is something the tide has
      // put in the water for the ship to find. At 0.7 it surfaces already
      // inside it and comes straight on. So an early tide gets in the way and a
      // late one hunts, which is the escalation stated in one number.
      //
      // The first version of this measured `range` against SEA_RANGE — 82 units
      // at three-quarter flood, past every sight radius in the game. The fleet
      // table said it exactly: ring 1 at 0.78 tide, 13.7 swells sent, hull home
      // 100%, kills unchanged. Twenty-seven creatures spawned and not one of
      // them ever met the ship.
      const gap = MOBS[kind].sight * (SWELL.range[0] + (SWELL.range[1] - SWELL.range[0]) * flood);
      const bearing = rng.range(-Math.PI, Math.PI);
      const sx = v.x + Math.cos(bearing) * gap;
      const sy = v.y + Math.sin(bearing) * gap;
      const count = Math.min(wanted, SEA_MAX_LIVE - v.mobs.length);
      for (let i = 0; i < count; i++) {
        const abeam = rng.range(-SWELL.spread, SWELL.spread);
        const x = sx + Math.cos(bearing + Math.PI / 2) * abeam;
        const y = sy + Math.sin(bearing + Math.PI / 2) * abeam;
        const mob = makeMob(kind, x, y, x, y, v.nextId + i, `swell:${due}`, rng);
        // A long leash, like every open-water patrol: the sea sent it, so it
        // follows for a while and then gives up. Short enough that outrunning
        // the tide is still the answer it has always been.
        mob.tether = PATROL_ROAM;
        mob.tough = 1 + flood * TIDE.toughPerLevel;
        mob.hp = Math.round(MOBS[kind].hp * mob.tough);
        v.mobs.push(mob);
      }
      v.nextId += count;
      events.push({ kind: 'swell', x: sx, y: sy, count, level: flood });
    }
    // Counted whether or not anything surfaced, so a crowded sea skips its turn
    // rather than saving it up and emptying the whole tide at once the moment
    // the guns clear a space.
    if (due > v.swells) v.swells = due;
  }

  // --- mobs ----------------------------------------------------------------
  // A SHIP THAT HAS NOT CAST OFF IS NOT UNDER WAY, and until she is the sea
  // leaves her alone.
  //
  // The swell already says the harbour is "the one place a voyage can always
  // end", but nothing stopped a ring-1 patrol from following a ship into it —
  // and an open-water leash is 110 units against a 55-unit cell. So a player who
  // tapped Zarpar and then looked away SANK AT THE SPAWN POINT: parked at (0,0),
  // never departed, hull zero in seventy-two seconds, and charged the careen
  // bill and half a hold for a voyage they had not begun.
  //
  // The latch is `departed`, not the position, and that distinction is the whole
  // design. Home water is not a shield: the moment she has left, the harbour is
  // a DESTINATION and the run back to it is a race — which is the only thing
  // that makes the weight in the hold mean anything, and what round 14's tithe
  // is priced against. What is protected is the ten seconds before the voyage
  // starts, and nothing else.
  const sheltered = !v.departed;
  for (const mob of v.mobs) {
    const ms = MOBS[mob.kind];
    mob.cooldown = Math.max(0, mob.cooldown - dt);
    // Palanqueta, running out. The DEPTH of the slow is read live off the
    // loadout rather than stored on the creature, so a second chain pertrecho
    // taken mid-voyage deepens what is already in the water instead of waiting
    // for the next volley — and a voyage with no chain shot at all reads a 0
    // here and does exactly what it always did.
    if (mob.slow) mob.slow = Math.max(0, mob.slow - dt);
    const chained = mob.slow ? 1 - v.loadout.chainSlow : 1;

    const toShipX = v.x - mob.x;
    const toShipY = v.y - mob.y;
    const distance = Math.hypot(toShipX, toShipY);
    const tethered = sheltered
      || (mob.tether > 0 && Math.hypot(v.x - mob.homeX, v.y - mob.homeY) > mob.tether);

    // The boss plays its own game — see `stepSquid`, which is the whole fight.
    if (mob.kind === 'squid') {
      stepSquid(v, mob, distance, tethered, dt, events);
      continue;
    }

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
    // 0.78 of reach was still INSIDE the ship. A kelpling wants seven units and
    // was holding five and a half; it draws five and a half units long and the
    // skiff draws eight, so on the glass the creature was standing in the middle
    // of the deck. Read off a capture, a fight looked like the boat had grown a
    // fish. Station-keeping only reads as station-keeping if the station is
    // outside the hull, so it holds near the edge of its reach instead — which
    // changes nothing about the trade, because everything from here to `reach`
    // bites at exactly the same cadence.
    const keep = ms.reach * 0.9;
    const closing = mob.state === 'attack'
      ? (distance < keep ? -0.6 : 0.15)
      : mob.state === 'chase' ? 1 : 0.45;
    mob.x += Math.cos(mob.heading) * ms.speed * chained * closing * dt;
    mob.y += Math.sin(mob.heading) * ms.speed * chained * closing * dt;

    // EL ARPÓN. Anything already standing in a firing arc is hauled toward the
    // ship, which is the pertrecho's whole promise: what tries to run does not
    // get to. It pulls the TARGET and never the hull — a harpoon that moved the
    // ship would be a grappling hook, and a grappling hook is a way to swim.
    //
    // Gated on the arcs rather than on range alone on purpose. It is the answer
    // to a creature leaving the guns, so it has to be a reason to KEEP a beam
    // presented rather than a free tractor beam that makes presenting one
    // pointless — which is the same skill the whole fight is about. Clamped to
    // the step's own distance so nothing can ever be pulled past the hull.
    if (v.loadout.harpoon > 0 && distance > spec.radius * 2 && distance <= spec.range) {
      const bearing = Math.atan2(mob.y - v.y, mob.x - v.x);
      const inArc = Math.abs(Math.abs(angleDelta(v.heading, bearing)) - Math.PI / 2) <= spec.arc;
      if (inArc) {
        const pull = Math.min(v.loadout.harpoon * dt, distance - spec.radius * 2);
        mob.x -= Math.cos(bearing) * pull;
        mob.y -= Math.sin(bearing) * pull;
      }
    }

    if (mob.state === 'attack' && mob.cooldown <= 0 && distance <= ms.reach) {
      mob.cooldown = ms.cadence;
      // The tide it was born under, on the bite as well as on the hp — so a
      // late creature is not merely a longer job, it is a worse trade. Rounded,
      // because a hull bar in fractions is a hull bar nobody can read.
      const bite = Math.round(ms.damage * (mob.tough ?? 1));
      v.hull -= bite;
      v.sinceHit = 0;
      events.push({ kind: 'hit', x: v.x, y: v.y, damage: bite, target: 'ship', by: 'mob' });
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
      // A dived squid is not a target: a broadside spent on a shadow under the
      // water would teach the player their guns are broken.
      if (mob.dive) continue;
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

    // METRALLA, and it is a trade rather than an upgrade: the same broadside
    // leaves the ship as a fan of balls, each for a fraction of the ball it
    // replaced. Against a crowd on the beam every one of them finds something
    // and the volley is worth more than it was; against a boss, one connects
    // and it is worth less. Off, this is one ball at full damage — the
    // arithmetic below reduces to exactly the line it replaced.
    const balls = v.loadout.spread ? GEAR.spread.shots : 1;
    const each = v.loadout.spread ? spec.damage * GEAR.spread.damage : spec.damage;
    for (let i = 0; i < balls; i++) {
      const fan = balls === 1 ? 0 : (i - (balls - 1) / 2) * GEAR.spread.arc;
      v.shots.push({
        id: v.nextId++,
        x: v.x, y: v.y,
        vx: Math.cos(shotHeading + fan) * 70,
        vy: Math.sin(shotHeading + fan) * 70,
        life: spec.range / 70 + 0.2,
        damage: each,
        from: 'ship',
      });
    }
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
        // A ball cannot strike what is under the water; it passes over.
        if (mob.hp <= 0 || mob.dive) continue;
        if (Math.hypot(mob.x - shot.x, mob.y - shot.y) > MOBS[mob.kind].radius + 1.2) continue;
        mob.hp -= shot.damage;
        // Palanqueta. A ball that connects leaves the thing it hit dragging,
        // which is the pertrecho that answers a chase rather than a swarm.
        if (v.loadout.chainSlow > 0) mob.slow = GEAR.chain.seconds;
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
      // Where it came from, in cells — except that a swell belongs to no cell
      // (its key is `swell:<n>`), so the water it DIED in is the honest answer
      // and it is the same answer for everything that has a cell of its own.
      const [cx, cy] = mob.cell.startsWith('swell:')
        ? [Math.round(mob.x / SEA_CELL), Math.round(mob.y / SEA_CELL)]
        : mob.cell.split(':').map(Number);
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
      // The reward moment the boss owed. GUARANTEED — no roll — because a
      // player who beat a telegraphed two-phase fight has already paid in
      // full; scaled by the lair's ring like every other payout; through the
      // same stow() as every site and bounty, so the hold's arithmetic cannot
      // disagree with itself. Once per voyage at most, and only on a voyage
      // still owed the season's chest.
      if (mob.kind === 'squid' && v.deepChest) {
        v.deepChest = false;
        const scale = 1 + ringOf(cx, cy) * BOSS.deepChestPerRing;
        const chest: Partial<Record<ResourceId, number>> = {};
        for (const [res, base] of Object.entries(BOSS.deepChest) as [ResourceId, number][]) {
          chest[res] = Math.round(base * scale);
        }
        events.push({ kind: 'deep-chest', x: mob.x, y: mob.y, loot: stow(v, spec, chest) });
      }
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
    // loot, never progress — so `sunk` is a share of the cargo and never
    // touches a building, a level or a hull the player paid for.
    //
    // Then the landfall share, because the crew are swimming from wherever she
    // went down: half at the harbour mouth, a third of it four zones out. And
    // then the yard's bill for refloating her, which is the round's cheap-real
    // repair and the reason sinking costs something beyond the hold's fraction
    // even when the fraction is small. Order matters and this is it — halve,
    // carry home, pay the carpenter out of what landed.
    //
    // BODEGA FALSA raises the half and nothing else — see `Loadout.holdGuard`.
    // Capped below 1 on purpose: the landfall promise this file makes is that
    // drowning is never better than quitting in the same water, and that holds
    // for any guarded share strictly under 1 however many are stacked.
    const share = landfallShare(v.x, v.y);
    const saved = Math.min(GEAR.guardMax, SUNK_SHARE + v.loadout.holdGuard);
    const { kept, lost } = keepShare(v.cargo, saved * share);
    v.cargo = kept;
    const careen = share < 1 ? chargeBill(v.cargo, careenBill(v.shipType)) : {};
    v.careened = Object.values(careen).reduce((a: number, b) => a + (b ?? 0), 0);
    events.push({ kind: 'sunk', lost, careen });
  } else if (!v.home && v.departed
             && ringOf(Math.round(v.x / SEA_CELL), Math.round(v.y / SEA_CELL)) === 0
             && Math.hypot(v.x, v.y) < SEA_CELL * HARBOUR) {
    v.home = true;
    events.push({ kind: 'home' });
  }

  // --- the water outranks the hull -----------------------------------------
  // Finding 6 of round 11's playtest, verbatim: "twin zone-3 tritons melt a
  // skiff 86%->6% in one exchange with no warning that zones outrank the
  // starter hull." The fleet table says ring 3 is a wall rather than a cliff —
  // a skiff still comes home 99 times in a hundred, a fifth of the hull
  // poorer — so the mobs stay as they are and the missing thing is the
  // WARNING. Purely positional, so the same voyage replays the same events;
  // `warnedRing` above is why it is one event per crossing rather than a
  // banner per step, and why only a DEEPER crossing speaks again.
  //
  // ROUND 13 MOVED IT ONE CELL EARLIER, because a warning at the crossing
  // measured as no warning at all. The blind playtest: "one held drag took the
  // skiff to ZONA 3 within ~2 min; hull went 100->15% before I saw any zone
  // plate." Reproduced over eight seeds and three headings at full throttle,
  // the old rule fired at the boundary and the first outranked hit landed
  // between 0.3 and 13 seconds later — a third of a second, four times out of
  // twenty-four. That is a plate a player reads with the hull already going.
  //
  // The fix is geometric, not cosmetic: a ring is a square shell of cells, so
  // ask about the cell ONE STEP AHEAD ON THE CURRENT HEADING as well as the
  // one underneath. The deeper of the two is what the voyage is warned about,
  // which buys a whole cell of water — 55 units, about 3.2 seconds at a
  // skiff's 17 a second — between the plate and the water it is about.
  //
  // Two properties survive the move. It is still purely positional, so the
  // same voyage replays the same events; and it still cannot skip a ring,
  // because a single cell step changes a Chebyshev distance by at most one, so
  // `warnedRing` latches every shell exactly once whether it was announced
  // from the near side or entered head-on.
  if (!v.sunk) {
    const here = ringOf(Math.round(v.x / SEA_CELL), Math.round(v.y / SEA_CELL));
    const ahead = ringOf(
      Math.round((v.x + Math.cos(v.heading) * SEA_CELL) / SEA_CELL),
      Math.round((v.y + Math.sin(v.heading) * SEA_CELL) / SEA_CELL)
    );
    const ring = Math.max(here, ahead);
    if (ring > spec.rated && ring > v.warnedRing) {
      v.warnedRing = ring;
      events.push({ kind: 'zone-warning', ring, rated: spec.rated });
    }
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
  //
  // The second half had a hole in it, and it is the SAME BUG as the one that
  // shipped: a voyage announcing an arrival the player never made. Loot armed
  // the latch wherever the ship happened to be, and the nearest island in a
  // seeded sea sits about forty-four units out with a loot reach of twenty-odd
  // — so a ship taking it from the near side is INSIDE the harbour at the
  // moment it arms. The next step saw a departed ship in ring 0 and ended the
  // run: tap ¡Zarpar!, sail at the first island you see, and two and a bit
  // seconds later you are handed an end-of-voyage card with one site of cargo.
  // Measured at five voyages in every four hundred before this line changed.
  //
  // Being outside the harbour is what "somewhere else" means, so both proofs
  // now require it.
  const out = Math.hypot(v.x, v.y);
  if (!v.departed && out > SEA_CELL * HARBOUR
      && (out > SEA_CELL * DEPARTED || v.taken.length > 0)) {
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

/**
 * What abandoning the voyage from here would land, without abandoning it.
 *
 * The number the sea HUD paints on the Volver button and reads out in its
 * confirmation, and the same arithmetic `abandonVoyageInPlace` performs — so
 * the price the player is quoted is the price they pay. Pure; touches nothing.
 */
export function previewAbandon(v: Voyage): {
  ring: number;
  share: number;
  kept: Partial<Record<ResourceId, number>>;
  lost: Partial<Record<ResourceId, number>>;
} {
  const share = landfallShare(v.x, v.y);
  return {
    ring: ringOf(Math.round(v.x / SEA_CELL), Math.round(v.y / SEA_CELL)),
    share,
    ...keepShare(v.cargo, share),
  };
}

/**
 * THE PLAYER HAS LEFT THE SEA FROM HERE. The sim's third ending.
 *
 * Round 13's playtest: "Volver (top-right, always live) banks the entire hold
 * instantly from any distance and any hull state." Volver still returns the
 * player to the island — a game you cannot leave is not a game — but leaving is
 * now an ENDING with a place attached, and `landfallShare` charges for the
 * water between that place and the harbour. Sail the hold home and it all
 * banks; drop it four zones out and 40% of it never sees a store.
 *
 * IN PLACE, and deliberately so, in the codebase's own `...InPlace` idiom
 * (`landCargoInPlace`, `collectInPlace`, `advanceInPlace`). The sea scene hands
 * ONE voyage object to the end-of-voyage card and to the island's landing, and
 * `SeaHudOptions.onLeave` — the scene's signature, not this round's file —
 * returns nothing, so a new-state-out action could not reach either of them.
 * The direction is still the house rule's: the UI says the player quit HERE,
 * the sim decides what that costs, and the freeze at the top of `stepVoyage`
 * makes the answer final.
 */
export function abandonVoyageInPlace(v: Voyage): SeaEvent[] {
  if (v.sunk || v.home || v.abandoned) return [];
  const { ring, share, kept, lost } = previewAbandon(v);
  v.abandoned = true;
  v.cargo = kept;
  return [{ kind: 'abandoned', ring, share, kept, lost }];
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

/* --------------------------------------------------------------------------
 * ZAFARRANCHO — SEA_PLAY.md item 4
 * ----------------------------------------------------------------------- */

/** What the HUD needs to draw the one button: is it ready, and if not, how
 *  far through the wait. `running` is the burst itself, so the button can
 *  say "now" rather than only "soon". */
export interface DashRead {
  ready: boolean;
  running: boolean;
  /** 0 at the moment it was called, 1 when it is ready again. */
  charge: number;
  /** Seconds left of the wait, 0 when ready. */
  wait: number;
}

export function readDash(v: Voyage): DashRead {
  const over = v.sunk || v.home || v.abandoned;
  return {
    ready: !over && v.dashCooldown <= 0,
    running: v.dash > 0,
    charge: DASH.cooldown > 0 ? 1 - Math.max(0, v.dashCooldown) / DASH.cooldown : 1,
    wait: Math.max(0, v.dashCooldown),
  };
}

/** Whether calling it right now would do anything. The button asks this. */
export function canDash(v: Voyage): boolean {
  return readDash(v).ready;
}

/**
 * Pipe the hands to zafarrancho.
 *
 * REFUSED rather than queued when it is not ready, and refused rather than
 * silently ignored when the voyage has ended — a control that pretends to work
 * is worse than one that visibly does not, and the HUD reads `canDash` for
 * exactly this reason. Returns the voyage unchanged if it was not called, so a
 * caller can compare identity to know whether the tap landed.
 *
 * The cooldown starts NOW, not when the burst ends, so `cooldown` is the whole
 * cycle and there is one number for the player to learn.
 */
export function callDash(v: Voyage): Voyage {
  if (!canDash(v)) return v;
  return { ...v, dash: DASH.seconds, dashCooldown: DASH.cooldown };
}
