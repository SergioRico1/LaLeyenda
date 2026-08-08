import type { ResourceId } from './balance';
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
 */

// ---------------------------------------------------------------------------
// Units: world units and seconds, matching the island scene (1 unit = 1 cell).

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
export const SEA_CELL = 55;

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

/** How far out a cell is, in rings. Ring 0 is the water around home. */
export function ringOf(cx: number, cy: number): number {
  return Math.max(Math.abs(cx), Math.abs(cy));
}

/** A cell's own stream. Forked from the seed and the coordinates, so two cells
 *  never share rolls and a cell answers the same way however you reach it. */
function cellRng(seed: string, cx: number, cy: number, salt: string): Rng {
  return new Rng(`${seed}:sea:${cx}:${cy}:${salt}`);
}

/**
 * What is in this square of sea.
 *
 * Called by the sim to know what to collide with and by the renderer to know
 * what to draw. One function, so they cannot disagree.
 */
export function siteAt(seed: string, cx: number, cy: number): Site | null {
  const ring = ringOf(cx, cy);
  if (ring === 0) return null; // home water stays clear — you can always leave

  const rng = cellRng(seed, cx, cy, 'site');

  // The sea gets busier as it gets more dangerous, but never solid: an empty
  // cell is what makes the full ones feel like a find.
  const occupied = 0.42 + Math.min(0.28, ring * 0.05);
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
  const scale = 1 + ring * 0.85;
  const roll = (base: number) => Math.round(base * scale * rng.range(0.8, 1.25));
  switch (kind) {
    case 'harvest':
      return rng.chance(0.5) ? { madera: roll(60) } : { metal: roll(40) };
    case 'islet':
      return { madera: roll(45), ron: roll(18) };
    case 'wreck':
      return { oro: roll(35), ron: roll(20) };
    case 'lair':
      return { oro: roll(90), metal: roll(70) };
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

export const MOBS: Record<MobKind, MobSpec> = {
  // Slow, harmless alone, always in a group — the ring-1 tutorial in monster form.
  blowfish: { hp: 30, speed: 5, turn: 1.6, damage: 4, cadence: 1.6, reach: 5, sight: 34, radius: 2.2 },
  // Bites hard up close, so it punishes stopping.
  kelpling: { hp: 55, speed: 8, turn: 2.2, damage: 9, cadence: 1.9, reach: 6, sight: 42, radius: 2.6 },
  // Faster than the ship: cannot be outrun, only out-turned.
  hammerdead: { hp: 70, speed: 14, turn: 2.8, damage: 12, cadence: 1.4, reach: 7, sight: 55, radius: 3 },
  // The first boss. Guards a lair and does not leave it.
  squid: { hp: 420, speed: 7, turn: 1.2, damage: 26, cadence: 2.4, reach: 12, sight: 60, radius: 7 },
};

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
  const count = ring === 1 ? rng.int(0, 2) : rng.int(1, Math.min(5, 1 + ring));
  const pool: MobKind[] =
    ring <= 1 ? ['blowfish']
      : ring === 2 ? ['blowfish', 'blowfish', 'kelpling']
        : ring === 3 ? ['blowfish', 'kelpling', 'kelpling', 'hammerdead']
          : ['kelpling', 'hammerdead', 'hammerdead'];

  const out: Mob[] = [];
  for (let i = 0; i < count; i++) {
    const hx = cx * SEA_CELL + rng.range(-SEA_CELL / 2, SEA_CELL / 2);
    const hy = cy * SEA_CELL + rng.range(-SEA_CELL / 2, SEA_CELL / 2);
    out.push(makeMob(rng.pick(pool), hx, hy, hx, hy, nextId + i, `${cx}:${cy}`, rng));
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
  damage: number;
  /** Seconds a broadside takes to reload. */
  reload: number;
  /** Half-angle of the firing arc off each beam. */
  arc: number;
  range: number;
  radius: number;
  /** Total units of cargo the hold takes. */
  hold: number;
}

export const SHIPS: Record<string, ShipSpec> = {
  skiff: {
    hull: 120, speed: 17, turn: 1.5, accel: 9, damage: 11, reload: 2.1,
    arc: 0.55, range: 46, radius: 2.4, hold: 900,
  },
};

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
  /** Set once the ship goes down; the voyage is over but readable. */
  sunk: boolean;
  /** Set when the player has made it back to home water with the hold. */
  home: boolean;
}

export type SeaEvent =
  | { kind: 'fired'; side: 'port' | 'starboard'; x: number; y: number }
  | { kind: 'hit'; x: number; y: number; damage: number; target: 'ship' | 'mob' }
  | { kind: 'mob-killed'; mob: MobKind; x: number; y: number; ring: number }
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
    sunk: false, home: false,
  };
}

/** Units of cargo in the hold. */
export function holdUsed(v: Voyage): number {
  let total = 0;
  for (const amount of Object.values(v.cargo)) total += amount ?? 0;
  return total;
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
  const wanted = v.helm.throttle * spec.speed;
  v.speed += Math.sign(wanted - v.speed) * Math.min(spec.accel * dt, Math.abs(wanted - v.speed));
  v.x += Math.cos(v.heading) * v.speed * dt;
  v.y += Math.sin(v.heading) * v.speed * dt;

  // Running aground: a reef stops the ship and hurts. Sites are solid.
  for (const site of sitesNear(v.seed, v.x, v.y, 60)) {
    const dx = v.x - site.x;
    const dy = v.y - site.y;
    const gap = Math.hypot(dx, dy) - (site.radius + spec.radius);
    if (gap >= 0) continue;
    const nx = dx / (Math.hypot(dx, dy) || 1);
    const ny = dy / (Math.hypot(dx, dy) || 1);
    v.x -= nx * gap;
    v.y -= ny * gap;
    if (v.speed > spec.speed * 0.35) {
      const damage = Math.round(v.speed * 0.9);
      v.hull -= damage;
      events.push({ kind: 'hit', x: v.x, y: v.y, damage, target: 'ship' });
    }
    v.speed *= 0.25;
  }

  // --- looting -------------------------------------------------------------
  // Sailing over a site takes it. There is no interact button: on a phone,
  // steering onto the thing you want IS the interaction.
  for (const site of sitesNear(v.seed, v.x, v.y, 60)) {
    if (site.kind === 'reef' || v.taken.includes(site.id)) continue;
    if (Math.hypot(v.x - site.x, v.y - site.y) > site.radius + spec.radius + 3) continue;
    // A lair does not give up its cargo while its guardian is alive.
    if (site.kind === 'lair' && v.mobs.some((m) => m.cell === site.id && m.kind === 'squid')) continue;

    const room = spec.hold - holdUsed(v);
    if (room <= 0) { events.push({ kind: 'hold-full' }); continue; }
    const taken: Partial<Record<ResourceId, number>> = {};
    let used = 0;
    for (const [res, amount] of Object.entries(site.loot) as [ResourceId, number][]) {
      const give = Math.max(0, Math.min(amount, room - used));
      if (give <= 0) continue;
      taken[res] = give;
      v.cargo[res] = (v.cargo[res] ?? 0) + give;
      used += give;
    }
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
      events.push({ kind: 'hit', x: v.x, y: v.y, damage: ms.damage, target: 'ship' });
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
        events.push({ kind: 'hit', x: shot.x, y: shot.y, damage: shot.damage, target: 'mob' });
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
      events.push({ kind: 'mob-killed', mob: mob.kind, x: mob.x, y: mob.y, ring: ringOf(cx, cy) });
      continue;
    }
    // Far-away mobs are dropped, not simulated. Their cell stays in `seen`, so
    // they do not come back — sailing away from a fight ends it for good.
    if (Math.hypot(mob.x - v.x, mob.y - v.y) > SEA_RANGE * 1.6) continue;
    alive.push(mob);
  }
  v.mobs = alive;

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
  } else if (!v.home && ringOf(Math.round(v.x / SEA_CELL), Math.round(v.y / SEA_CELL)) === 0
             && Math.hypot(v.x, v.y) < SEA_CELL * 0.3 && v.step > 60) {
    v.home = true;
    events.push({ kind: 'home' });
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
