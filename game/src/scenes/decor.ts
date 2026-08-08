import * as THREE from 'three';
import { CELL, STEP, cellToWorld, isBuildable, type IslandShape } from '../render/island';
import type { ScatterItem } from '../render/scatter';
import { BALANCE, buildingSpec, plotHalf, spotRefusal, type GameState } from '../sim';
import { Rng } from '../core/rng';

/**
 * decor.ts — where the island's dressing may stand, and what stands there.
 *
 * THE RULE THIS FILE EXISTS TO KEEP
 *
 * Decoration must never occupy ground a building could later be placed on.
 * Placement validity is the sim's, not ours, so `reservedMask` asks the sim
 * (`plotHalf`, `spotRefusal`) which cells any future building could claim and
 * decoration is confined to what is left. Nothing here re-implements the rule;
 * it only reads it and takes the complement.
 *
 * That complement turns out to have real shape, and it is the shape the
 * composition is built on:
 *
 *   • the beach ring, which no building can stand on at all;
 *   • the plateau rim, one cell deep, where a footprint would hang off the edge;
 *   • an apron around every standing building — because two plots may not
 *     overlap, the ground within one plot-width of a building is refused to
 *     every NEW building while being claimed by none, so it is permanently free;
 *   • and, where those aprons meet, a corridor running between the buildings.
 *     That corridor is the island's path network, and it is where the reference
 *     puts its fences, its lamps and its crates.
 *
 * A useful consequence: placing a building can only ever GROW this set (a new
 * building refuses more ground than it claims), so decoration planted once is
 * never invalidated by later construction and never has to be swept up.
 *
 * WHAT IT PLANTS
 *
 * island_hero.png is packed, but it is not sprinkled. Palms cluster in stands
 * along the rims and leave the middle open; bushes bank against walls; the
 * plaza in front of the town hall stays clear. So the plan below is written as
 * named passes with their own rules, not as one loop rolling dice per cell.
 */

/** How the composition treats a cell that decoration may use. */
export type Zone =
  /** Sand outside the buildable plateau — palms, rocks, driftwood, shells. */
  | 'beach'
  /** Buildable ground one cell from the drop — the palm stands and the railing. */
  | 'rim'
  /** Free ground within a plot-width of a standing building — its garden. */
  | 'apron'
  /** Everything else the buildings' exclusion zones leave open — the paths. */
  | 'path';

export interface DecorCell {
  x: number;
  z: number;
  zone: Zone;
  /** Distance in cells to the nearest standing building centre. */
  toBuilding: number;
  /** Distance in cells to the nearest water cell. */
  toWater: number;
}

/**
 * Every cell any future building could stand on or claim, as 1s.
 *
 * The terrain half of validity is the ghost's (a footprint must sit entirely on
 * buildable ground); the sim half is `spotRefusal`. Deliberately NOT
 * `placeRefusal` — that one also answers "you cannot afford it" and "the hall is
 * too low", which are true today and false tomorrow. A mask that shrank as the
 * player earned gold would let decoration appear on ground that later became
 * buildable, so only the permanent, geometric half is used here.
 */
export function reservedMask(shape: IslandShape, state: GameState): Uint8Array {
  const { size } = shape;
  const claimed = new Uint8Array(size * size);

  for (const [type, spec] of Object.entries(BALANCE.buildings)) {
    // A waterfront building is placed at its stored cell rather than snapped to
    // the plateau, so the plateau test below does not describe it.
    if (spec.waterfront) continue;
    const half = plotHalf(type);
    // The span the ghost lights up, and the reach `plotsOverlap` would use.
    const lo = -Math.floor(half - 0.001);
    const hi = Math.floor(half - 0.001);
    const reach = Math.ceil(half - 1e-6);

    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        let fits = true;
        for (let dz = lo; dz <= hi && fits; dz++) {
          for (let dx = lo; dx <= hi && fits; dx++) {
            if (!isBuildable(shape, x + dx, z + dz)) fits = false;
          }
        }
        if (!fits) continue;
        if (spotRefusal(state, type, x, z) !== null) continue;

        for (let dz = -reach; dz <= reach; dz++) {
          for (let dx = -reach; dx <= reach; dx++) {
            if (Math.abs(dx) >= half || Math.abs(dz) >= half) continue;
            const cx = x + dx;
            const cz = z + dz;
            if (cx < 0 || cz < 0 || cx >= size || cz >= size) continue;
            claimed[cz * size + cx] = 1;
          }
        }
      }
    }
  }
  return claimed;
}

/** Chebyshev distance from every cell to the nearest cell passing `test`. */
function distanceField(shape: IslandShape, test: (x: number, z: number) => boolean): Float32Array {
  const { size } = shape;
  const dist = new Float32Array(size * size).fill(Infinity);
  const queue: number[] = [];
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (test(x, z)) { dist[z * size + x] = 0; queue.push(z * size + x); }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % size;
    const z = (i - x) / size;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const cx = x + dx;
        const cz = z + dz;
        if (cx < 0 || cz < 0 || cx >= size || cz >= size) continue;
        const j = cz * size + cx;
        if (dist[j] <= dist[i] + 1) continue;
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
  }
  return dist;
}

/** The cells decoration may use, each tagged with the zone it belongs to. */
export function decorCells(shape: IslandShape, state: GameState): DecorCell[] {
  const { size, cells } = shape;
  const claimed = reservedMask(shape, state);
  const toWater = distanceField(shape, (x, z) => cells[z * size + x].height <= 0);

  const centres = state.buildings.map((b) => ({ ...b, half: plotHalf(b.type) }));
  const out: DecorCell[] = [];

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const cell = cells[z * size + x];
      if (cell.height <= 0) continue;          // sea
      if (claimed[z * size + x]) continue;     // a building could stand here

      let toBuilding = Infinity;
      for (const b of centres) {
        toBuilding = Math.min(toBuilding, Math.max(Math.abs(b.x - x), Math.abs(b.z - z)));
      }

      // The thresholds are tight on purpose. `apron` has to mean "hard against
      // a wall", because at <= 3 it swallowed every free cell on the plateau and
      // left `path` empty — the corridor between the buildings then got a
      // garden's dressing instead of a path's, and not one fence was ever laid.
      let zone: Zone;
      if (!cell.buildable) zone = 'beach';
      else if (toWater[z * size + x] <= 1) zone = 'rim';
      else if (toBuilding <= 2) zone = 'apron';
      else zone = 'path';

      out.push({ x, z, zone, toBuilding, toWater: toWater[z * size + x] });
    }
  }
  return out;
}

/* --------------------------------------------------------------------------
 * the composition
 * ----------------------------------------------------------------------- */

/** Models this file can place, so the scene can preload exactly these. */
export const DECOR_MODELS = [
  'tree_palm', 'tree_palm_tall', 'deco_bush', 'deco_bush_alt', 'deco_fern', 'deco_plant',
  'deco_hedge', 'deco_crate', 'deco_crate_red', 'deco_barrel', 'deco_fence', 'deco_fence_post',
  'deco_totem', 'deco_rock_lg', 'deco_rock_sm', 'deco_driftwood',
  'deco_sandmound', 'deco_starfish', 'harv_cotton',
] as const;

/**
 * Props that do not go into the shadow map.
 *
 * Everything ankle-high. These models are 600–1 200 triangles each and there
 * are two hundred of them, so the shadow pass was doubling the layer's whole
 * vertex cost to draw smudges under shrubs that are already in the shade of
 * whatever they are banked against. The things whose shadows actually read —
 * palms, rocks, driftwood, totems, the posts — keep theirs.
 */
const NO_SHADOW = new Set([
  'deco_bush', 'deco_bush_alt', 'deco_fern', 'deco_plant', 'deco_hedge',
  'deco_crate', 'deco_crate_red', 'deco_barrel', 'deco_starfish', 'harv_cotton',
  'deco_sandmound',
]);

interface Plan {
  items: ScatterItem[];
  /** Cells already spoken for, so two passes never stack props on one spot. */
  used: Set<number>;
}

const key = (x: number, z: number): number => z * 1000 + x;

/**
 * The dressing, as a deterministic list of props.
 *
 * Every draw comes from the seeded Rng — a screenshot has to be byte-identical
 * between runs, and an island that reshuffled its own palms on reload would be
 * a different island every session.
 */
export function planDecor(shape: IslandShape, state: GameState, seed: string): ScatterItem[] {
  const rng = new Rng(`${seed}:decor:v2`);
  const cells = decorCells(shape, state);
  const plan: Plan = { items: [], used: new Set() };

  const byZone = (zone: Zone) => cells.filter((c) => c.zone === zone);

  // The plaza: the reference leaves a big open sand court rather than filling
  // every cell, so the ground in front of the town hall is held clear and every
  // pass below skips it.
  //
  // Kept small, because the reserved mask already does most of this job — the
  // open middle of the island is open precisely because it is where buildings
  // go. At 4.5 this was mostly re-excluding ground no prop could have used, and
  // the part it did reach was the one quadrant that then read as empty.
  const hall = state.buildings.find((b) => buildingSpec(b.type).kind === 'townhall');
  const plaza = hall ? { x: hall.x, z: hall.z + 5, r: 3 } : null;
  const inPlaza = (c: DecorCell) =>
    plaza !== null && Math.hypot(c.x - plaza.x, c.z - plaza.z) < plaza.r;

  const free = (c: DecorCell) => !plan.used.has(key(c.x, c.z)) && !inPlaza(c);

  /** Places one prop, jittered inside its cell, and marks the cell taken. */
  const put = (
    c: DecorCell,
    model: string,
    scale: number,
    opts: { jitter?: number; lift?: number; scaleY?: number; claim?: boolean } = {}
  ): void => {
    const at = cellToWorld(shape, c.x, c.z);
    const jitter = opts.jitter ?? 0.28;
    plan.items.push({
      model,
      position: new THREE.Vector3(
        at.x + rng.range(-jitter, jitter) * CELL,
        at.y + (opts.lift ?? 0),
        at.z + rng.range(-jitter, jitter) * CELL
      ),
      rotationY: rng.range(0, Math.PI * 2),
      scale,
      scaleY: opts.scaleY,
    });
    if (opts.claim !== false) plan.used.add(key(c.x, c.z));
  };

  /* --- pass 1: the palm stands ------------------------------------------
   * The reference does not sprinkle palms; it plants STANDS of three to six
   * that overlap each other, along the rims, and leaves the middle bare. Seed
   * points are drawn from the rim and beach cells nearest the water, then each
   * stand fills its own neighbourhood. */
  {
    const candidates = cells
      .filter((c) => (c.zone === 'rim' || c.zone === 'beach') && c.toWater >= 1 && free(c))
      .sort((a, b) => a.toWater - b.toWater || key(a.x, a.z) - key(b.x, b.z));
    const stands = 6;
    for (let s = 0; s < stands && candidates.length; s++) {
      // Spread the stands around the coast by angle rather than picking at
      // random, so they never all land on one shore.
      const wantAngle = (s / stands) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const half = shape.size / 2;
      let best: DecorCell | null = null;
      let bestScore = Infinity;
      for (const c of candidates) {
        if (!free(c)) continue;
        const angle = Math.atan2(c.z - half, c.x - half);
        let d = Math.abs(angle - wantAngle);
        if (d > Math.PI) d = Math.PI * 2 - d;
        const score = d * 3 + c.toWater;
        if (score < bestScore) { bestScore = score; best = c; }
      }
      if (!best) break;

      const trunks = rng.int(3, 5);
      const near = candidates
        .filter((c) => free(c) && Math.hypot(c.x - best!.x, c.z - best!.z) <= 2.2)
        .slice(0, trunks);
      for (const c of near) {
        const tall = rng.chance(0.45);
        // Measured against the reference: a palm crown there spans roughly a
        // twelfth of the island, not a sixth. At the old 2.6–3.9 the stands
        // closed into a hedge around the coast and hid the island inside it.
        put(c, tall ? 'tree_palm_tall' : 'tree_palm', rng.range(1.6, 2.3), {
          jitter: 0.42,
          scaleY: rng.range(0.88, 1.18),
        });
      }
      // Undergrowth at the foot of the stand — the reference never shows a bare
      // trunk on bare ground.
      for (const c of near) {
        if (!rng.chance(0.7)) continue;
        const at = cellToWorld(shape, c.x, c.z);
        plan.items.push({
          model: rng.pick(['deco_hedge', 'deco_hedge', 'deco_plant', 'deco_fern', 'deco_bush']),
          position: new THREE.Vector3(
            at.x + rng.range(-0.45, 0.45) * CELL,
            at.y,
            at.z + rng.range(-0.45, 0.45) * CELL
          ),
          rotationY: rng.range(0, Math.PI * 2),
          scale: rng.range(0.7, 1.15),
        });
      }
    }
  }

  /* --- pass 2: the beach ------------------------------------------------
   * Rocks and driftwood at the waterline, shells scattered thinly. The beach
   * stays mostly open — it is open in the reference too — so this is a low
   * density pass with a few strong features rather than a carpet. */
  {
    const beach = byZone('beach').filter(free);
    for (const c of beach) {
      const r = rng.next();
      if (r < 0.1) {
        put(c, rng.chance(0.35) ? 'deco_rock_lg' : 'deco_rock_sm', rng.range(1.6, 2.8), { jitter: 0.35 });
      } else if (r < 0.16) {
        put(c, 'deco_driftwood', rng.range(1.8, 2.6), { jitter: 0.3 });
      } else if (r < 0.24) {
        put(c, 'deco_sandmound', rng.range(1.4, 2.2), { jitter: 0.3 });
      } else if (r < 0.34) {
        put(c, 'deco_starfish', rng.range(0.5, 0.8), { jitter: 0.4 });
      } else if (r < 0.42) {
        put(c, rng.pick(['deco_hedge', 'deco_hedge', 'deco_bush_alt']), rng.range(0.7, 1.0), { jitter: 0.35 });
      }
    }
  }

  /* --- pass 3: the aprons ----------------------------------------------
   * The ground a building's own plot keeps free of OTHER buildings is its
   * garden, and in the reference it is the densest texture on the island:
   * bushes banked against the walls, crates and barrels stacked at the corners,
   * a lamp on the approach. */
  {
    const apron = byZone('apron').filter(free);
    for (const c of apron) {
      const r = rng.next();
      if (r < 0.34) {
        // A bank of three, not one — the reference plants them in runs. Kept to
        // three rather than five: these shrubs are ~1 200 triangles apiece and
        // the fourth and fifth of a clump are almost entirely hidden by the
        // first three at this camera angle.
        const at = cellToWorld(shape, c.x, c.z);
        const n = rng.int(2, 3);
        for (let i = 0; i < n; i++) {
          plan.items.push({
            model: rng.pick(['deco_hedge', 'deco_hedge', 'deco_plant', 'deco_bush', 'deco_fern']),
            position: new THREE.Vector3(
              at.x + rng.range(-0.46, 0.46) * CELL,
              at.y,
              at.z + rng.range(-0.46, 0.46) * CELL
            ),
            rotationY: rng.range(0, Math.PI * 2),
            scale: rng.range(0.6, 1.05),
          });
        }
        plan.used.add(key(c.x, c.z));
      } else if (r < 0.48) {
        // Crates and barrels come in little heaps, and one of them is stacked.
        const at = cellToWorld(shape, c.x, c.z);
        const n = rng.int(2, 4);
        for (let i = 0; i < n; i++) {
          const stacked = i > 0 && rng.chance(0.3);
          plan.items.push({
            model: rng.pick(['deco_crate', 'deco_crate_red', 'deco_barrel', 'deco_barrel']),
            position: new THREE.Vector3(
              at.x + rng.range(-0.34, 0.34) * CELL,
              at.y + (stacked ? 0.52 : 0),
              at.z + rng.range(-0.34, 0.34) * CELL
            ),
            rotationY: rng.range(0, Math.PI * 2),
            scale: rng.range(0.5, 0.68),
          });
        }
        plan.used.add(key(c.x, c.z));
      } else if (r < 0.54) {
        // A plain wooden post, which is what the reference stands along its
        // plot corners. The pirate lamp went here first and was a mistake: it
        // is a grey-white lantern on a thin pole, and four of them in a row
        // read as mushrooms rather than as street furniture.
        put(c, 'deco_fence_post', rng.range(0.3, 0.42), { jitter: 0.25 });
      } else if (r < 0.6) {
        put(c, 'deco_totem', rng.range(1.0, 1.4), { jitter: 0.2 });
      }
    }
  }

  /* --- pass 4: the paths -------------------------------------------------
   * The corridor the exclusion zones leave between buildings IS the path
   * network, so it gets what the reference threads along its paths: a fence
   * line on one side, lamps at intervals, and the occasional crate. Fences run
   * ALONG the corridor, so each segment is turned to face the nearest claimed
   * ground rather than given a random yaw. */
  {
    const path = byZone('path').filter(free);
    const claimed = reservedMask(shape, state);
    const isClaimed = (x: number, z: number) =>
      x >= 0 && z >= 0 && x < shape.size && z < shape.size && claimed[z * shape.size + x] === 1;

    for (const c of path) {
      const r = rng.next();
      if (r < 0.42) {
        // A fence panel hugs the edge of the corridor: find which side the
        // buildable ground it is fencing off lies on.
        const sides: Array<[number, number, number]> = [
          [1, 0, 0], [-1, 0, Math.PI], [0, 1, Math.PI / 2], [0, -1, -Math.PI / 2],
        ];
        const facing = sides.filter(([dx, dz]) => isClaimed(c.x + dx, c.z + dz));
        if (facing.length) {
          const [dx, dz, yaw] = facing[rng.int(0, facing.length - 1)];
          const at = cellToWorld(shape, c.x, c.z);
          plan.items.push({
            model: 'deco_fence',
            position: new THREE.Vector3(at.x + dx * 0.42 * CELL, at.y, at.z + dz * 0.42 * CELL),
            rotationY: yaw + Math.PI / 2,
            scale: CELL * 1.02,
          });
          if (rng.chance(0.35)) {
            plan.items.push({
              model: 'deco_fence_post',
              position: new THREE.Vector3(at.x + dx * 0.42 * CELL, at.y, at.z + dz * 0.42 * CELL - 0.5 * CELL),
              rotationY: yaw,
              scale: 0.34,
            });
          }
          plan.used.add(key(c.x, c.z));
        }
      } else if (r < 0.54) {
        put(c, 'deco_fence_post', rng.range(0.3, 0.44), { jitter: 0.2 });
      } else if (r < 0.68) {
        const at = cellToWorld(shape, c.x, c.z);
        for (let i = 0; i < rng.int(2, 3); i++) {
          plan.items.push({
            model: rng.pick(['deco_crate', 'deco_crate_red', 'deco_barrel']),
            position: new THREE.Vector3(
              at.x + rng.range(-0.3, 0.3) * CELL, at.y, at.z + rng.range(-0.3, 0.3) * CELL
            ),
            rotationY: rng.range(0, Math.PI * 2),
            scale: rng.range(0.5, 0.66),
          });
        }
        plan.used.add(key(c.x, c.z));
      } else if (r < 0.86) {
        const at = cellToWorld(shape, c.x, c.z);
        for (let i = 0; i < rng.int(2, 4); i++) {
          plan.items.push({
            model: rng.pick(['deco_hedge', 'deco_hedge', 'harv_cotton', 'deco_bush_alt']),
            position: new THREE.Vector3(
              at.x + rng.range(-0.45, 0.45) * CELL, at.y, at.z + rng.range(-0.45, 0.45) * CELL
            ),
            rotationY: rng.range(0, Math.PI * 2),
            scale: rng.range(0.62, 1.0),
          });
        }
        plan.used.add(key(c.x, c.z));
      }
    }
  }

  /* --- pass 5: the railing ----------------------------------------------
   * Where the plateau drops to the beach the reference runs a low fence, which
   * is what stops the terrace edge reading as a bare extruded step. */
  {
    for (const c of cells) {
      if (c.zone !== 'rim' || !free(c)) continue;
      if (!rng.chance(0.5)) continue;
      const sides: Array<[number, number, number]> = [
        [1, 0, 0], [-1, 0, Math.PI], [0, 1, Math.PI / 2], [0, -1, -Math.PI / 2],
      ];
      const outward = sides.filter(([dx, dz]) => !isBuildable(shape, c.x + dx, c.z + dz));
      if (!outward.length) continue;
      const [dx, dz, yaw] = outward[rng.int(0, outward.length - 1)];
      const at = cellToWorld(shape, c.x, c.z);
      plan.items.push({
        model: rng.chance(0.72) ? 'deco_fence' : 'deco_fence_post',
        position: new THREE.Vector3(at.x + dx * 0.44 * CELL, at.y, at.z + dz * 0.44 * CELL),
        rotationY: yaw + Math.PI / 2,
        scale: CELL,
      });
      plan.used.add(key(c.x, c.z));
    }
  }

  /* --- pass 6: framing the town hall -------------------------------------
   * §3's own emphasis rule, in the world: the building the whole island is
   * about gets a pair of lamps and a totem on its approach, so the eye lands
   * on it rather than wandering. */
  if (hall) {
    const approach = cells
      .filter((c) => c.zone !== 'beach' && Math.hypot(c.x - hall.x, c.z - (hall.z + 3)) < 3)
      .sort((a, b) => Math.hypot(a.x - hall.x, a.z - hall.z) - Math.hypot(b.x - hall.x, b.z - hall.z));
    // Palms, because that is what the reference frames ITS hall with, and
    // because the two candidates tried first both failed at this scale: the
    // pirate lamp is a grey lantern that reads as a mushroom, and the flag is
    // four units of bare pole with its banner above the top of the frame.
    let framed = 0;
    for (const c of approach) {
      if (framed >= 2) break;
      if (plan.used.has(key(c.x, c.z))) continue;
      put(c, framed === 0 ? 'tree_palm_tall' : 'tree_palm', rng.range(2.1, 2.5), {
        jitter: 0.12,
        scaleY: rng.range(0.95, 1.1),
      });
      framed++;
    }
    for (const c of approach) {
      if (plan.used.has(key(c.x, c.z))) continue;
      put(c, 'deco_fence_post', rng.range(0.34, 0.44), { jitter: 0.2 });
    }
  }

  // Applied once here rather than at each push site, so a pass added later
  // cannot forget it.
  return plan.items.map((item) => ({ ...item, castShadow: !NO_SHADOW.has(item.model) }));
}

/* --------------------------------------------------------------------------
 * ground cover
 * ----------------------------------------------------------------------- */

/**
 * The flowers, tufts and worn edges that stop a buildable plot reading as one
 * flat rectangle of paint.
 *
 * WHY THIS IS NOT A PROP, AND WHY THAT MATTERS
 *
 * Everything in `planDecor` is an object, so it obeys the rule at the top of
 * this file and stays off ground a building could claim. That rule leaves the
 * empty plots themselves untouched — and empty plots are most of the island's
 * open ground, which is exactly where the verification found "six unpainted
 * mid-green rectangles".
 *
 * Both things are wanted at once: no object may stand where a building could
 * go, AND no plot may read as bare paint. The only thing that satisfies both is
 * cover with no volume and no silhouette. These are flat quads laid two
 * centimetres above the surface: they cannot be collided with, cannot poke
 * through a roof, and a building placed on the cell simply covers them the way
 * its foundation covers the grass underneath. They are texture, not scenery —
 * the same job island.ts's per-cell colour grain does, at a finer grain than
 * one cell.
 *
 * Sampled off the reference, whose grass is dense with pale flower dots and
 * whose plot edges wear to dirt where they meet the sand.
 */
export function buildGroundCover(shape: IslandShape, seed: string): THREE.Mesh {
  const rng = new Rng(`${seed}:cover`);
  const { size, cells } = shape;

  const positions: number[] = [];
  const colours: number[] = [];
  const tint = new THREE.Color();

  const quad = (cx: number, cy: number, cz: number, r: number, yaw: number, colour: number) => {
    const c = Math.cos(yaw) * r;
    const s = Math.sin(yaw) * r;
    // Two triangles, flat on the ground, rotated about y.
    const a = [cx - c + s, cy, cz - s - c];
    const b = [cx + c + s, cy, cz + s - c];
    const d = [cx + c - s, cy, cz + s + c];
    const e = [cx - c - s, cy, cz - s + c];
    // Wound so the geometric normal is +y. The other order makes every quad
    // face the sea floor, which back-face culling then removes — the cover is
    // there, costs its triangles, and draws nothing.
    positions.push(...a, ...d, ...b, ...a, ...e, ...d);
    tint.setHex(colour, THREE.SRGBColorSpace);
    for (let i = 0; i < 6; i++) colours.push(tint.r, tint.g, tint.b);
  };

  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= size || z >= size ? null : cells[z * size + x]);

  // Pale flower heads and a darker tuft, the two things the reference's grass is
  // covered in. The dirt is for the worn edge where a plot meets its drop.
  const FLOWERS = [0xf3f0e2, 0xfaf6de, 0xe8ecd2, 0xfff3c4];
  const TUFTS = [0x7ea436, 0x86ad3c, 0x6f9530, 0xa3c65a, 0x8fbb44];
  const WORN = [0xc9a86a, 0xbf9a5c];
  // Within a few percent of island.ts's own sand albedo (0xe2d8bc), so this
  // grains the beach instead of littering it.
  const SAND = [0xdccfae, 0xe8e0c8, 0xd8cba8, 0xeae3cd, 0xd2c4a2];
  const SHELL = [0xf6efe0, 0xe6d2c4, 0xfbf6ea];

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const cell = cells[z * size + x];
      if (cell.height <= 0) continue;
      const y = cell.height * STEP + 0.02;
      const x0 = x * CELL - (size * CELL) / 2 + CELL / 2;
      const z0 = z * CELL - (size * CELL) / 2 + CELL / 2;

      if (cell.material === 'grass') {
        // Dense enough to read as a meadow at the island's on-screen size and
        // never so regular that the grid shows through. The tufts carry most of
        // the work — they are near the grass's own value, so they dither the
        // surface rather than spotting it, and the brighter flowers are rarer.
        const dots = rng.int(14, 22);
        for (let i = 0; i < dots; i++) {
          const px = x0 + rng.range(-0.47, 0.47) * CELL;
          const pz = z0 + rng.range(-0.47, 0.47) * CELL;
          const flower = rng.chance(0.28);
          quad(
            px, y, pz,
            flower ? rng.range(0.028, 0.045) : rng.range(0.05, 0.11),
            rng.range(0, Math.PI / 2),
            flower ? rng.pick(FLOWERS) : rng.pick(TUFTS)
          );
        }
        // Where the plot steps down, its lip wears to earth.
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
          const n = at(x + dx, z + dz);
          return !n || n.height < cell.height;
        });
        if (edge) {
          for (let i = 0; i < rng.int(2, 4); i++) {
            quad(
              x0 + rng.range(-0.48, 0.48) * CELL, y, z0 + rng.range(-0.48, 0.48) * CELL,
              rng.range(0.1, 0.2), rng.range(0, Math.PI / 2), rng.pick(WORN)
            );
          }
        }
      } else {
        // Sand: drift and shell grit, close enough in value to the sand itself
        // that it dithers rather than spots. The reference's beach is open, but
        // it is not a blank fill — it carries a fine grain at this scale, and a
        // high-contrast pebble here read as litter rather than sand.
        for (let i = 0; i < rng.int(5, 10); i++) {
          quad(
            x0 + rng.range(-0.47, 0.47) * CELL, y, z0 + rng.range(-0.47, 0.47) * CELL,
            rng.range(0.06, 0.15), rng.range(0, Math.PI / 2),
            rng.pick(SAND)
          );
        }
        if (rng.chance(0.18)) {
          quad(
            x0 + rng.range(-0.4, 0.4) * CELL, y, z0 + rng.range(-0.4, 0.4) * CELL,
            rng.range(0.04, 0.07), rng.range(0, Math.PI / 2),
            rng.pick(SHELL)
          );
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  // Every quad faces straight up, so the normal is a constant and does not need
  // to be derived per vertex.
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'ground_cover';
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The satellite islets island_hero.png sets around its island.
 *
 * They sit in open water where nothing can ever be built, they give the eye
 * something at the frame's edge, and they are the reference's own answer to a
 * horizon of flat blue. Deliberately small: the sea is not to be shrunk.
 */
export function planIslets(shape: IslandShape, seed: string): ScatterItem[] {
  const rng = new Rng(`${seed}:islets`);
  const items: ScatterItem[] = [];
  const half = (shape.size * CELL) / 2;
  const waterline = STEP * 0.82;

  // Placed by hand rather than scattered: three islets, off three different
  // shores, at distances that keep them clear of the island's own beach.
  const spots = [
    { x: -half - 10.5, z: -1.5, r: 1.0 },
    { x: 3.5, z: -half - 9.5, r: 0.75 },
    { x: half + 9.5, z: 8.5, r: 0.85 },
  ];

  // deco_sandmound is 32 x 3 x 32 in its own units and `fit` normalizes by the
  // widest axis, so a mound of width w stands (3/32)·w tall. Everything on top
  // of it has to be lifted by exactly that or it is buried in the sand.
  const MOUND_ASPECT = 3 / 32;

  for (const spot of spots) {
    const width = 8.5 * spot.r;
    const squash = 2.2;
    const base = new THREE.Vector3(spot.x, waterline - 0.3, spot.z);
    const top = base.y + MOUND_ASPECT * width * squash;
    items.push({
      model: 'deco_sandmound',
      position: base.clone(),
      rotationY: rng.range(0, Math.PI * 2),
      scale: width,
      scaleY: squash,
    });
    const palms = rng.int(2, 3);
    for (let i = 0; i < palms; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const reach = rng.range(0.3, 1.4) * spot.r;
      items.push({
        model: rng.chance(0.5) ? 'tree_palm_tall' : 'tree_palm',
        position: new THREE.Vector3(
          base.x + Math.cos(angle) * reach,
          top,
          base.z + Math.sin(angle) * reach
        ),
        rotationY: rng.range(0, Math.PI * 2),
        scale: rng.range(2.0, 2.8),
        scaleY: rng.range(0.9, 1.1),
      });
    }
    items.push({
      model: rng.chance(0.5) ? 'deco_rock_lg' : 'deco_rock_sm',
      position: new THREE.Vector3(
        base.x + rng.range(-1.8, 1.8) * spot.r,
        top,
        base.z + rng.range(-1.8, 1.8) * spot.r
      ),
      rotationY: rng.range(0, Math.PI * 2),
      scale: rng.range(1.4, 2.2),
    });
    if (rng.chance(0.7)) {
      items.push({
        model: rng.pick(['deco_hedge', 'deco_hedge', 'deco_bush_alt']),
        position: new THREE.Vector3(base.x + rng.range(-1.6, 1.6), top, base.z + rng.range(-1.6, 1.6)),
        rotationY: rng.range(0, Math.PI * 2),
        scale: rng.range(0.8, 1.2),
      });
    }
  }
  return items.map((item) => ({ ...item, castShadow: !NO_SHADOW.has(item.model) }));
}
