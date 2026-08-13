import { Rng } from '../core/rng';
import { BALANCE, type ObstacleTier } from './balance';
import type { GameState, Obstacle, Refusal } from './types';

/**
 * obstacles.ts — the wilderness, and taking it apart one cell at a time.
 *
 * OPENING.md settled the opening: the player starts with the Ayuntamiento and
 * nothing else. Part three of that decision is the one everybody forgets and it
 * is load-bearing — **the empty land is covered in obstacles**. Without them a
 * day-one island is a vast void with a single building in the middle, and the
 * large fixed map that makes a mature island legible is exactly what makes the
 * first session read as content that is missing.
 *
 * With them, the emptiness is EARNED SPACE. A brand-new player has something to
 * do in their first thirty seconds that costs nothing, teaches the
 * builder-and-timer loop before any building is affordable, and pays for the
 * first Aserradero.
 *
 * ─── what is deliberately NOT here ─────────────────────────────────────────
 *
 * **No respawn.** Clash regrows its obstacles; we do not. A field that grows
 * back into ground the player deliberately cleared is a system fighting the
 * layout they made, and our island is fixed at 44 rather than expanding, so
 * there is no shortage of ground to protect.
 *
 * **No terrain.** `src/sim/` owns no heightmap — `src/render/island.ts`
 * generates it, and the sim may not import three.js. So the default field is
 * seeded inside the largest superellipse that is buildable for EVERY seed
 * (`island.obstacleRadius`, a measured number, re-checked by
 * tools/tests/obstacles.test.ts against the real generator). A caller that DOES
 * know the terrain — the scene, at load — can widen the field to the true
 * plateau with `reseedObstaclesInPlace`.
 *
 * ─── what the scene still has to wire up ───────────────────────────────────
 *
 * This file is the whole sim side, and it is finished. Two things live outside
 * it, both in files this slice deliberately did not touch:
 *
 *  1. `src/scenes/islandScene.ts` still generates its terrain at a hard-coded
 *     26. OPENING.md fixes the island at 44 and everything here — the hall's
 *     own cell included — is derived from `BALANCE.island.grid`, so until that
 *     literal becomes `BALANCE.island.grid` the two disagree and the scene
 *     snaps the Ayuntamiento to the nearest cell its smaller island has.
 *  2. Nothing draws `state.obstacles` yet. `kind` names the model family
 *     ('palmera', 'roca', 'pecio', 'penasco'), `work` is a live timer to put a
 *     bar over, and `pays` is the reward a tooltip can promise up front.
 *     `clearObstacle(state, id, now)` is the tap.
 */

/** Does a building's plot reach this cell? Kept here so seeding and the
 *  placement refusal agree on what "on top of" means. */
const CELL_REACH = 0.5;

/* --------------------------------------------------------------------------
 * where the field may go
 * ----------------------------------------------------------------------- */

/**
 * The superellipse `render/island.ts` shapes the coast with, normalised so 1 is
 * the grid's own half-width. The renderer's plateau is this shape eaten into by
 * five lobes, three notch tables and a sector inset; none of that is knowable
 * here, so the default seeding stays inside the radius that survives all of it.
 */
export function islandRadius(x: number, z: number, grid = BALANCE.island.grid): number {
  const c = (grid - 1) / 2;
  const dx = (x - c) / c;
  const dz = (z - c) / c;
  const p = BALANCE.island.exponent;
  return Math.pow(Math.abs(dx) ** p + Math.abs(dz) ** p, 1 / p);
}

/** The cell the Ayuntamiento stands on when a game begins: the grid's centre. */
export function islandCentreCell(grid = BALANCE.island.grid): number {
  return Math.round((grid - 1) / 2);
}

/** The sim's own conservative answer to "could the island have ground here". */
export const defaultBuildable = (x: number, z: number): boolean =>
  islandRadius(x, z) < BALANCE.island.obstacleRadius;

/**
 * How thickly the wilderness sits on a cell, 0…1.
 *
 * Two falls, and both are doing a job the frame can see:
 *
 *  · **Up, away from the hall.** Zero inside `clearingRadius`, full by
 *    `thinRadius`. That hole is the town square, and it is what guarantees the
 *    first Aserradero somewhere to stand — a fresh player's opening move being
 *    refused by their own scenery is the worst possible first tap.
 *  · **Down again at the edge**, over `shoreFeather` cells. A wood that stops
 *    on a perfect line reads as a hedge, which is exactly reference/SPACING.md's
 *    complaint about our palms (*"palms cluster; they never form a hedge"*).
 *    It also puts fewer obstacles in the one band where the sim's conservative
 *    disc is most likely to disagree with the terrain the renderer generated.
 *
 * `toEdge` is in CELLS, measured off whatever mask is being seeded, so the same
 * curve feathers the sim's default disc and the scene's real coastline.
 */
export function obstacleDensity(
  x: number, z: number, hallX: number, hallZ: number, toEdge: number
): number {
  const spec = BALANCE.obstacles;
  // Chebyshev, not euclidean: a plot is a square, and the hole this leaves has
  // to be a square one for a square footprint to fit in it.
  const toHall = Math.max(Math.abs(x - hallX), Math.abs(z - hallZ));
  const inland = clamp01((toHall - spec.clearingRadius) / Math.max(1e-6, spec.thinRadius - spec.clearingRadius));
  const shore = clamp01(toEdge / spec.shoreFeather);
  return inland * shore;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Chebyshev distance from every cell to the nearest cell OUTSIDE the mask.
 *
 * A wavefront rather than a radius, so it describes the actual shape being
 * seeded: on the sim's conservative disc it is the distance to that circle, and
 * on a scene's real plateau it is the distance to the real coast and to every
 * inlet in it.
 */
function edgeDistance(grid: number, inside: (x: number, z: number) => boolean): Float32Array {
  const dist = new Float32Array(grid * grid).fill(Infinity);
  const queue: number[] = [];
  for (let z = 0; z < grid; z++) {
    for (let x = 0; x < grid; x++) {
      if (inside(x, z)) continue;
      dist[z * grid + x] = 0;
      queue.push(z * grid + x);
    }
  }
  // A grid that is entirely inside has no edge at all; everything is deep.
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % grid;
    const z = (i - x) / grid;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const cx = x + dx;
        const cz = z + dz;
        if (cx < 0 || cz < 0 || cx >= grid || cz >= grid) continue;
        const j = cz * grid + cx;
        if (dist[j] <= dist[i] + 1) continue;
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
  }
  return dist;
}

/* --------------------------------------------------------------------------
 * queries
 * ----------------------------------------------------------------------- */

/** The obstacle standing on a cell, or null. */
export function obstacleAt(state: GameState, x: number, z: number): Obstacle | null {
  for (const o of state.obstacles) {
    if (Math.abs(o.x - x) < CELL_REACH + 1e-6 && Math.abs(o.z - z) < CELL_REACH + 1e-6) return o;
  }
  return null;
}

/**
 * Whether anything in `reach` cells of (x, z) is still standing — the question
 * a footprint asks, since a plot claims more than one cell.
 */
export function obstacleUnder(state: GameState, x: number, z: number, reach: number): Obstacle | null {
  for (const o of state.obstacles) {
    if (Math.abs(o.x - x) < reach && Math.abs(o.z - z) < reach) return o;
  }
  return null;
}

export const obstacleTier = (o: Obstacle): ObstacleTier => BALANCE.obstacles[o.tier];

/** Obstacles currently holding a builder. */
export function obstaclesBusy(state: GameState): number {
  let busy = 0;
  for (const o of state.obstacles) if (o.work) busy++;
  return busy;
}

/* --------------------------------------------------------------------------
 * clearing one
 * ----------------------------------------------------------------------- */

/**
 * Every reason clearing can be refused, in the order the UI wants to say them.
 * `buildersFree` is passed in rather than imported so build.ts can own the
 * builder arithmetic without the two modules importing each other.
 */
export function clearRefusal(state: GameState, obstacleId: number, freeBuilders: number): Refusal | null {
  const target = state.obstacles.find((o) => o.id === obstacleId);
  if (!target) return 'unknown-obstacle';
  if (target.work) return 'busy';
  if (freeBuilders <= 0) return 'no-builders';
  return null;
}

/** Starts the timer and occupies a builder, in place. Caller has checked. */
export function startClearInPlace(obstacle: Obstacle, now: number): void {
  obstacle.work = { startedAt: now, endsAt: now + obstacleTier(obstacle).timeMs };
}

/**
 * Applies a finished clear: the cell opens, the payout lands, the counter that
 * `Despeja {target} obstáculos` watches ticks.
 *
 * Returns what actually reached the store — `grantInPlace` is passed in so the
 * madera obeys the same cap a collection does. A payout that could exceed the
 * store would make upgrading the Almacén pointless, and announcing the roll
 * rather than the deposit is the worst lie a reward can tell.
 */
export function finishClearInPlace(
  state: GameState,
  obstacle: Obstacle,
  grant: (madera: number) => number
): { madera: number; gems: number } {
  state.obstacles = state.obstacles.filter((o) => o.id !== obstacle.id);
  const madera = grant(obstacle.pays.madera);
  state.gems += obstacle.pays.gems;
  return { madera, gems: obstacle.pays.gems };
}

/* --------------------------------------------------------------------------
 * seeding the field
 * ----------------------------------------------------------------------- */

export interface SeedOptions {
  /** Grid size. Defaults to `island.grid` — 44, fixed from day one. */
  grid?: number;
  /** Ground the island actually has. Defaults to the conservative superellipse. */
  buildable?: (x: number, z: number) => boolean;
}

/**
 * Fills the island with palms, rocks and wrecks, deterministically.
 *
 * The stream is forked off the ISLAND SEED rather than off `state.rngState`, so
 * a player's field is theirs, is the same on every device, and does not shift
 * because a chest was opened before the island was drawn.
 *
 * Two shaping rules, and they are the difference between a field and a mess:
 *
 *  1. **A clearing around the Ayuntamiento.** Density is zero inside
 *     `clearingRadius` and ramps to full by `thinRadius`, so the first
 *     Aserradero always has somewhere to go and the hall is never walled in.
 *     Without it a fresh player's opening move can be refused by their own
 *     scenery, which is the worst possible first tap.
 *  2. **Nothing on a standing building.** Cheap here, and it lets the same
 *     function re-seed a mid-game island.
 */
export function seedObstaclesInPlace(state: GameState, options: SeedOptions = {}): void {
  const grid = options.grid ?? BALANCE.island.grid;
  const buildable = options.buildable ?? defaultBuildable;
  const spec = BALANCE.obstacles;
  const rng = new Rng(`${state.seed}:obstacles`);

  const centre = state.buildings.find((b) => b.type === BALANCE.townHall.building);
  const cx = centre?.x ?? islandCentreCell(grid);
  const cz = centre?.z ?? islandCentreCell(grid);

  state.obstacles = [];
  const toEdge = edgeDistance(grid, buildable);
  let id = 1;

  for (let z = 0; z < grid; z++) {
    for (let x = 0; x < grid; x++) {
      if (!buildable(x, z)) continue;
      if (!rng.chance(spec.coverage * obstacleDensity(x, z, cx, cz, toEdge[z * grid + x]))) continue;
      if (standsOnABuilding(state, x, z)) continue;

      const large = rng.chance(spec.largeShare);
      const tier = large ? spec.large : spec.small;
      state.obstacles.push({
        id: id++,
        tier: large ? 'large' : 'small',
        kind: rng.pick(tier.kinds),
        x, z,
        pays: {
          madera: rng.int(tier.madera[0], tier.madera[1]),
          gems: rng.chance(tier.gemChance) ? rng.int(tier.gems[0], tier.gems[1]) : 0,
        },
        work: null,
      });
    }
  }
  state.nextObstacleId = id;
}

/**
 * Re-seeds against terrain the caller actually knows.
 *
 * The scene generates the heightmap and is the only place the true plateau
 * exists; this is the one line that hands it to the sim, so the field can cover
 * the whole island rather than the disc the sim can prove is safe. Idempotent
 * per seed, and it never runs over an island the player has started clearing —
 * doing so would regrow ground they paid a builder for.
 */
export function reseedObstaclesInPlace(state: GameState, buildable: (x: number, z: number) => boolean, grid?: number): boolean {
  if (state.stats.obstacles > 0 || state.obstacles.some((o) => o.work)) return false;
  seedObstaclesInPlace(state, { grid, buildable });
  return true;
}

function standsOnABuilding(state: GameState, x: number, z: number): boolean {
  for (const b of state.buildings) {
    const half = (BALANCE.buildings[b.type]?.footprint ?? 0) * BALANCE.placement.plotFactor / 2;
    if (Math.abs(b.x - x) < half && Math.abs(b.z - z) < half) return true;
  }
  return false;
}
