import * as THREE from 'three';
import { CELL, PALETTE, STEP, cellToWorld, isBuildable, type IslandShape } from '../render/island';
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
 * HOW MUCH GROUND THAT ACTUALLY IS
 *
 * On the island a new player boots into: 138 cells, and 108 of them are beach.
 * The plateau is claimed almost end to end — the smallest plot is three cells
 * across and it fits nearly everywhere, so nearly everywhere is spoken for.
 * That single number decides the whole composition. Density on this island is
 * not something to be spread evenly over the map, because five sixths of the
 * map will not take a prop at all; it has to be won on the shore ring, on the
 * terrace lips, and in the aprons the six standing buildings open up. Where the
 * reference dresses its plot interiors we dress their EDGES, and where it fills
 * its middle with props we can only paint it (see `buildGroundCover`).
 *
 * WHAT IT PLANTS
 *
 * island_hero.png is packed, but it is not sprinkled. Palms cluster in stands
 * and leave the ground between them bare; bushes run in lines along the edge of
 * a plot rather than dotting it; the harbour's whole cargo is in one heap at the
 * head of the pier. So the plan below is a list of named passes with their own
 * rules and their own claim on the ground, run in priority order — the harbour
 * takes its cells before the palms can — rather than one loop rolling dice per
 * cell. Every free cell ends up carrying four or five props; nearly none of them
 * arrived there independently.
 */

/** How the composition treats a cell that decoration may use. */
export type Zone =
  /** Sand outside the buildable plateau — palms, rocks, driftwood, shells. */
  | 'beach'
  /** Buildable ground on the terrace lip — the palm stands and the railing. */
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
      let underRoof = false;
      for (const b of centres) {
        const d = Math.max(Math.abs(b.x - x), Math.abs(b.z - z));
        toBuilding = Math.min(toBuilding, d);
        // The ground a building ALREADY stands on. `claimed` does not cover it:
        // the mask is "somewhere a NEW plot could go", and no new plot may
        // overlap this one, so every cell under a standing building falls out
        // of the mask and back into the free set. Fifty of them did, and the
        // decoration planted there was inside the walls — a palm through the
        // hall's roof, crates floating on the pier's deck. The rule at the top
        // of this file is about FUTURE buildings; this is the present one.
        if (d < b.half) underRoof = true;
      }
      if (underRoof) continue;

      // `rim` is the terrace LIP — buildable ground with a drop beside it —
      // not "near the sea". Those are different sets and only the first one is
      // useful: it is the edge a railing runs along and the shelf the palm
      // stands sit on. Keyed off the water it was three cells on this island
      // and the railing pass never fired.
      const lip = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !isBuildable(shape, x + dx, z + dz));

      let zone: Zone;
      if (!cell.buildable) zone = 'beach';
      else if (lip) zone = 'rim';
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
  'deco_archway', 'deco_flag',
] as const;

// deco_fishpoles is deliberately NOT in that list. It is a drying rack with two
// rods, and a rod is a one-voxel arc four units long: at the scale a rack has to
// be to read as a rack, the rods sweep two cells out over the terrace and come
// out as bent grey debris lying across the beach. Nothing in the reference is
// that thin. If it ever goes back in it wants to be at the END of a pier, where
// the arcs have water under them instead of sand.

/**
 * Props that do not go into the shadow map.
 *
 * Everything ankle-high. These models are 600–1 200 triangles each and there
 * are hundreds of them, so the shadow pass was doubling the layer's whole
 * vertex cost to draw smudges under shrubs that are already in the shade of
 * whatever they are banked against. The things whose shadows actually read —
 * palms, rocks, driftwood, totems, the posts, the gate — keep theirs.
 */
const NO_SHADOW = new Set([
  'deco_bush', 'deco_bush_alt', 'deco_fern', 'deco_plant', 'deco_hedge',
  'deco_crate', 'deco_crate_red', 'deco_barrel', 'deco_starfish', 'harv_cotton',
  'deco_sandmound',
]);

/**
 * The shrubs, ordered by how much of the reference's planting they actually do.
 *
 * `deco_hedge` is a solid green cube with a flower on top and it is the only one
 * of the five that reads as a BUSH at the island's on-screen size; the others
 * are open sprigs that vanish into the grass under them, and `deco_plant` is a
 * spray of violet lilies that at any density turns the plot borders purple.
 * So the hedge carries the runs and the rest are seasoning.
 */
const SHRUBS = ['deco_hedge', 'deco_hedge', 'deco_hedge', 'deco_fern', 'deco_bush_alt'] as const;
const SHRUBS_ACCENT = [
  'deco_hedge', 'deco_hedge', 'deco_hedge', 'deco_hedge',
  'deco_fern', 'deco_bush', 'deco_bush_alt', 'deco_plant',
] as const;
/**
 * Cargo, weighted toward barrels.
 *
 * Both crates are open-topped boxes, and at two thirds of a cell the camera
 * looks straight down into them — a pair of them side by side reads as two
 * skips, not as freight. They stay in for the colour a red one gives a
 * dockside, but small and outnumbered by the closed shape.
 */
const CARGO = [
  'deco_barrel', 'deco_barrel', 'deco_barrel', 'deco_crate', 'deco_crate_red',
] as const;
/** Small enough that a crate's opening does not become its silhouette. */
const CARGO_LO = 0.34;
const CARGO_HI = 0.48;

/**
 * A free-standing post: thin and roughly knee-to-waist high.
 *
 * The model is 5.7 wide by 14 tall, and `fit` normalizes on the footprint, so
 * scale reads as WIDTH and the height follows at 2.45x. Left at its natural
 * ratio a post wide enough to see is nearly a cell tall and reads as a bollard;
 * the reference's are slim enough to be poles. Hence the stretch.
 */
const post = (rng: Rng): { scale: number; scaleY: number } => ({
  scale: rng.range(0.2, 0.25),
  scaleY: rng.range(1.5, 1.9),
});

/** The four orthogonal neighbours, each with the yaw that faces it. */
const SIDES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, Math.PI], [0, 1, Math.PI / 2], [0, -1, -Math.PI / 2],
];

interface Plan {
  items: ScatterItem[];
  /** Cells whose CENTRE is spoken for, so two passes never stack features. */
  used: Set<number>;
  /**
   * Borders already dressed.
   *
   * Keyed on the border itself rather than on either cell, so the two cells that
   * meet along it cannot both fence it — and so a cell can carry a feature in
   * its middle AND a hedge run down its edge, which is where most of the
   * reference's density actually lives.
   */
  edges: Set<number>;
}

const key = (x: number, z: number): number => z * 1000 + x;

/** One id per cell border, shared by the two cells that meet along it. */
const edgeKey = (x: number, z: number, dx: number, dz: number): number =>
  (2 * x + dx) * 4096 + (2 * z + dz);

/**
 * The dressing, as a deterministic list of props.
 *
 * Every draw comes from the seeded Rng — a screenshot has to be byte-identical
 * between runs, and an island that reshuffled its own palms on reload would be
 * a different island every session.
 */
export function planDecor(shape: IslandShape, state: GameState, seed: string): ScatterItem[] {
  const rng = new Rng(`${seed}:decor:v3`);
  const { size } = shape;
  const cells = decorCells(shape, state);
  const claimed = reservedMask(shape, state);
  const plan: Plan = { items: [], used: new Set(), edges: new Set() };

  const byZone = (zone: Zone) => cells.filter((c) => c.zone === zone);
  const inBounds = (x: number, z: number) => x >= 0 && z >= 0 && x < size && z < size;
  const isClaimed = (x: number, z: number) => inBounds(x, z) && claimed[z * size + x] === 1;
  /** Which of the island's two surfaces this cell is — the reference plants the
   *  green things on the green and stands the wooden things on the sand. */
  const onGrass = (c: DecorCell) => shape.cells[c.z * size + c.x].material === 'grass';

  // The plaza: the reference leaves a big open sand court rather than filling
  // every cell, so the ground in front of the town hall is held clear and every
  // pass below skips it.
  //
  // Kept small, because the reserved mask already does most of this job — the
  // open middle of the island is open precisely because it is where buildings
  // go. At 4.5 this was mostly re-excluding ground no prop could have used, and
  // the part it did reach was the one quadrant that then read as empty.
  const hall = state.buildings.find((b) => buildingSpec(b.type).kind === 'townhall');
  const plaza = hall ? { x: hall.x, z: hall.z + 5, r: 2.6 } : null;
  const inPlaza = (c: DecorCell) =>
    plaza !== null && Math.hypot(c.x - plaza.x, c.z - plaza.z) < plaza.r;

  const free = (c: DecorCell) => !plan.used.has(key(c.x, c.z)) && !inPlaza(c);

  interface DropOpts { lift?: number; scaleY?: number; rotationY?: number }

  /**
   * One prop at an explicit offset from a cell's centre, in cells.
   *
   * Offsets are clamped just inside a half-cell because the test that keeps
   * decoration off buildable ground rounds a prop's world position back to a
   * cell: anything that strays past ±0.5 is a prop standing on its neighbour's
   * ground and reported against whichever cell it drifted into.
   */
  const drop = (
    c: DecorCell, model: string, scale: number, ox: number, oz: number, opts: DropOpts = {}
  ): void => {
    const at = cellToWorld(shape, c.x, c.z);
    plan.items.push({
      model,
      position: new THREE.Vector3(
        at.x + Math.max(-0.46, Math.min(0.46, ox)) * CELL,
        at.y + (opts.lift ?? 0),
        at.z + Math.max(-0.46, Math.min(0.46, oz)) * CELL
      ),
      rotationY: opts.rotationY ?? rng.range(0, Math.PI * 2),
      scale,
      scaleY: opts.scaleY,
    });
  };

  /** Places one prop, jittered inside its cell, and marks the cell taken. */
  const put = (
    c: DecorCell,
    model: string,
    scale: number,
    opts: DropOpts & { jitter?: number; claim?: boolean } = {}
  ): void => {
    const j = opts.jitter ?? 0.28;
    drop(c, model, scale, rng.range(-j, j), rng.range(-j, j), opts);
    if (opts.claim !== false) plan.used.add(key(c.x, c.z));
  };

  /** A heap of `n` props inside one cell, and the cell is then spoken for. */
  const clump = (
    c: DecorCell, models: readonly string[], n: number, lo: number, hi: number,
    opts: { spread?: number; stack?: number } = {}
  ): void => {
    const spread = opts.spread ?? 0.4;
    for (let i = 0; i < n; i++) {
      const stacked = i > 0 && opts.stack !== undefined && rng.chance(opts.stack);
      drop(
        c, rng.pick(models), rng.range(lo, hi),
        rng.range(-spread, spread), rng.range(-spread, spread),
        stacked ? { lift: rng.range(0.3, 0.42) } : {}
      );
    }
    plan.used.add(key(c.x, c.z));
  };

  /**
   * Dresses ONE border of a cell — a run of bushes, a fence panel or a pair of
   * posts laid along it — and reports whether it did.
   *
   * This is the pass that closed the gap with the reference. Their island reads
   * as packed not because every square has something on it but because every
   * plot is OUTLINED: a hedge row where the grass meets the path, a rail where
   * the terrace drops. Ours had four fence panels on the whole island because
   * the only zone that laid them held seven cells.
   */
  const dressEdge = (
    c: DecorCell, dx: number, dz: number, yaw: number, kind: 'hedge' | 'fence' | 'posts'
  ): boolean => {
    const id = edgeKey(c.x, c.z, dx, dz);
    if (plan.edges.has(id)) return false;
    plan.edges.add(id);
    // Along the border, perpendicular to the direction that crosses it.
    const tx = dz;
    const tz = dx;
    const off = 0.4;

    if (kind === 'hedge') {
      const n = rng.int(3, 4);
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1) - 0.5) * 0.76 + rng.range(-0.04, 0.04);
        const near = off - rng.range(0, 0.12);
        drop(c, rng.pick(SHRUBS), rng.range(0.4, 0.62), dx * near + tx * t, dz * near + tz * t);
      }
      return true;
    }
    if (kind === 'fence') {
      drop(c, 'deco_fence', CELL * 1.04, dx * off, dz * off, { rotationY: yaw + Math.PI / 2 });
      if (rng.chance(0.45)) {
        const p = post(rng);
        drop(c, 'deco_fence_post', p.scale, dx * off + tx * 0.42, dz * off + tz * 0.42, {
          rotationY: 0, scaleY: p.scaleY,
        });
      }
      return true;
    }
    for (const t of [-0.34, 0.34]) {
      if (!rng.chance(0.75)) continue;
      const p = post(rng);
      drop(c, 'deco_fence_post', p.scale, dx * off + tx * t, dz * off + tz * t, {
        rotationY: 0, scaleY: p.scaleY,
      });
    }
    return true;
  };

  /* --- pass 1: the dock's cargo ------------------------------------------
   * The reference stacks its whole harbour in one place: crates two high,
   * barrels on their sides, all of it on the sand at the head of the pier
   * rather than spread evenly around the coast.
   *
   * FIRST, before anything else takes ground. The quay is four or five cells
   * and they are the cells closest to the water on that shore, which is exactly
   * what every other pass wants too — run after the palm stands and the harbour
   * gets a grove where its crates should be. Asking the stands to leave a radius
   * clear was tried and is not enough: there is more than one pass with an
   * appetite for the waterline. */
  {
    const dock = state.buildings.find((b) => buildingSpec(b.type).waterfront);
    if (dock) {
      const quay = cells
        .filter((c) => free(c) && Math.hypot(c.x - dock.x, c.z - dock.z) <= 4.5)
        .sort((a, b) =>
          Math.hypot(a.x - dock.x, a.z - dock.z) - Math.hypot(b.x - dock.x, b.z - dock.z));
      for (let i = 0; i < Math.min(6, quay.length); i++) {
        clump(quay[i], CARGO, rng.int(4, 7), CARGO_LO, CARGO_HI, { spread: 0.34, stack: 0.45 });
      }
    }
  }

  /* --- pass 2: the palm stands ------------------------------------------
   * The reference does not sprinkle palms; it plants STANDS of three to six
   * that overlap each other, and leaves the ground between them bare. Half the
   * stands go on the coast and half up on the terraces, which is how theirs is
   * arranged — four crowns over the totem in the middle of the island, not only
   * a fringe around its edge. */
  const treed = new Set<number>();
  {
    const half = shape.size / 2;
    const grove = (pool: DecorCell[], stands: number, trunkLo: number, trunkHi: number): void => {
      for (let s = 0; s < stands && pool.length; s++) {
        // Spread the stands by angle rather than picking at random, so they
        // never all land on one shore.
        const wantAngle = (s / stands) * Math.PI * 2 + rng.range(-0.3, 0.3);
        let best: DecorCell | null = null;
        let bestScore = Infinity;
        for (const c of pool) {
          if (!free(c)) continue;
          const angle = Math.atan2(c.z - half, c.x - half);
          let d = Math.abs(angle - wantAngle);
          if (d > Math.PI) d = Math.PI * 2 - d;
          const score = d * 3 + c.toWater * 0.5;
          if (score < bestScore) { bestScore = score; best = c; }
        }
        if (!best) break;

        const trunks = rng.int(trunkLo, trunkHi);
        // 1.8 rather than 2.2: at the wider radius a "stand" spanned five cells
        // and read as a line of separate trees. The reference's crowns overlap.
        const near = pool
          .filter((c) => free(c) && Math.hypot(c.x - best!.x, c.z - best!.z) <= 1.8)
          .slice(0, trunks);
        for (const c of near) {
          const tall = rng.chance(0.45);
          // Measured against the reference: a palm crown there spans roughly a
          // twelfth of the island, not a sixth. At the old 2.6–3.9 the stands
          // closed into a hedge around the coast and hid the island inside it.
          put(c, tall ? 'tree_palm_tall' : 'tree_palm', rng.range(1.6, 2.3), {
            jitter: 0.4,
            scaleY: rng.range(0.88, 1.18),
          });
          treed.add(key(c.x, c.z));
        }
        // Undergrowth at the foot of the stand — the reference never shows a
        // bare trunk on bare ground.
        for (const c of near) {
          for (let i = 0; i < rng.int(1, 3); i++) {
            drop(c, rng.pick(SHRUBS_ACCENT), rng.range(0.45, 0.8),
              rng.range(-0.44, 0.44), rng.range(-0.44, 0.44));
          }
        }
      }
    };

    // Eleven stands, not six. The plateau of this island is claimed almost end
    // to end — a plot could go nearly anywhere on it, so decoration may go
    // almost nowhere — and the shore ring is where the frame's greenery has to
    // come from. Eleven stands of three to five is the count at which the coast
    // reads as a palm-fringed island rather than as a tan band with trees on it.
    grove(
      cells
        .filter((c) => (c.zone === 'rim' || c.zone === 'beach') && c.toWater >= 1 && free(c))
        .sort((a, b) => a.toWater - b.toWater || key(a.x, a.z) - key(b.x, b.z)),
      11, 3, 5
    );
    grove(
      cells
        .filter((c) => c.zone !== 'beach' && free(c))
        .sort((a, b) => key(a.x, a.z) - key(b.x, b.z)),
      4, 2, 4
    );
  }

  /* --- pass 3: the plot borders -----------------------------------------
   * Every edge where free ground meets ground a plot could take gets outlined:
   * a hedge row on the grass, a fence or a pair of posts on the sand. This is
   * the single densest thing in the reference frame and the one our island was
   * missing outright — its plots read as flat painted rectangles because
   * nothing marked where they stopped. */
  {
    const bordering = cells
      .filter((c) => !inPlaza(c) && c.zone !== 'beach')
      .sort((a, b) => key(a.x, a.z) - key(b.x, b.z));
    for (const c of bordering) {
      for (const [dx, dz, yaw] of SIDES) {
        if (!isClaimed(c.x + dx, c.z + dz)) continue;
        const r = rng.next();
        const kind = onGrass(c)
          ? (r < 0.78 ? 'hedge' : r < 0.9 ? 'posts' : 'fence')
          : (r < 0.44 ? 'fence' : r < 0.74 ? 'posts' : r < 0.88 ? 'hedge' : 'fence');
        dressEdge(c, dx, dz, yaw, kind);
      }
    }
  }

  /* --- pass 4: the terrace lip -------------------------------------------
   * Where the plateau steps down the reference runs a low rail along the top
   * and banks greenery against the wall below, and that two-part edge is what
   * stops a terrace reading as a bare extruded step.
   *
   * The rail is anchored to the cell BELOW the step and lifted onto the lip.
   * That is not a dodge, it is the only place it can go: almost every cell on
   * top of this island's plateau is ground some plot could take, and the rule
   * this file exists to keep forbids standing anything there. The cell at the
   * foot of the wall is beach — permanently unbuildable — so a rail owned by it
   * and drawn at the height of the ground it guards is decoration that can
   * never be in a builder's way. */
  {
    const lipHeight = (x: number, z: number) => shape.cells[z * size + x].height;
    for (const c of cells) {
      if (inPlaza(c)) continue;
      for (const [dx, dz, yaw] of SIDES) {
        const nx = c.x + dx;
        const nz = c.z + dz;
        if (!inBounds(nx, nz)) continue;
        const rise = lipHeight(nx, nz) - lipHeight(c.x, c.z);
        // Only the outward face of a step, and only where the ground above is
        // the plateau proper rather than another slab of beach.
        if (rise <= 0 || !isBuildable(shape, nx, nz)) continue;

        const tx = dz;
        const tz = dx;
        // Greenery at the foot of the wall, on this cell's own ground.
        if (rng.chance(0.5)) {
          for (let i = 0; i < rng.int(2, 3); i++) {
            drop(c, rng.pick(SHRUBS), rng.range(0.42, 0.68),
              dx * rng.range(0.3, 0.44) + tx * rng.range(-0.4, 0.4),
              dz * rng.range(0.3, 0.44) + tz * rng.range(-0.4, 0.4));
          }
        }
        // And a rail on top of it.
        const id = edgeKey(c.x, c.z, dx, dz);
        if (plan.edges.has(id) || !rng.chance(0.46)) continue;
        plan.edges.add(id);
        const lift = rise * STEP;
        if (rng.chance(0.75)) {
          drop(c, 'deco_fence', CELL * 1.04, dx * 0.44, dz * 0.44, {
            rotationY: yaw + Math.PI / 2, lift,
          });
        } else {
          for (const t of [-0.34, 0.34]) {
            const p = post(rng);
            drop(c, 'deco_fence_post', p.scale, dx * 0.44 + tx * t, dz * 0.44 + tz * t, {
              rotationY: 0, lift, scaleY: p.scaleY,
            });
          }
        }
      }
    }
  }

  /* --- pass 5: framing the town hall -------------------------------------
   * §3's own emphasis rule, in the world: the building the whole island is
   * about gets a gate on its approach and a pair of palms behind it, so the eye
   * lands on it rather than wandering. */
  if (hall) {
    // Measured from the HALL, not from a point three cells in front of it. The
    // old anchor assumed there was open ground on the hall's approach; on this
    // island there is none — every cell within four of the hall is ground some
    // plot could take — so the set came back empty and the whole pass, gate and
    // framing palms both, silently did nothing. Whatever free ground is nearest
    // the hall IS its approach.
    const approach = cells
      .filter((c) => c.zone !== 'beach' && Math.hypot(c.x - hall.x, c.z - hall.z) < 7)
      .sort((a, b) => Math.hypot(a.x - hall.x, a.z - hall.z) - Math.hypot(b.x - hall.x, b.z - hall.z));

    // The gate spans a path, so it only goes where BOTH of the cells its legs
    // reach over are free ground — an arch with one leg planted on a plot is an
    // arch through somebody's future wall.
    const gate = approach.find((c) => {
      if (plan.used.has(key(c.x, c.z))) return false;
      const alongX = !isClaimed(c.x - 1, c.z) && !isClaimed(c.x + 1, c.z);
      const alongZ = !isClaimed(c.x, c.z - 1) && !isClaimed(c.x, c.z + 1);
      return alongX || alongZ;
    });
    if (gate) {
      const alongX = !isClaimed(gate.x - 1, gate.z) && !isClaimed(gate.x + 1, gate.z);
      put(gate, 'deco_archway', rng.range(1.9, 2.1), {
        jitter: 0.06, rotationY: alongX ? 0 : Math.PI / 2,
      });
    }

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
  }

  /* --- pass 6: the banners and the totems --------------------------------
   * The reference's landmarks: a totem pole or two standing over the greens and
   * three or four flags on their own poles out on the open sand. They are the
   * only props there taller than a person, and they are what stops a packed
   * island reading as one uniform carpet of shrubbery. */
  {
    const open = cells
      .filter((c) => free(c) && c.toBuilding >= 3)
      .sort((a, b) => b.toBuilding - a.toBuilding || key(a.x, a.z) - key(b.x, b.z));
    let flags = 0;
    let totems = 0;
    const spoken: DecorCell[] = [];
    for (const c of open) {
      if (flags >= 3 && totems >= 2) break;
      if (!free(c)) continue;
      // A landmark next to another landmark is one landmark. Three cells apart
      // is roughly the reference's spacing between its totem and its banners.
      if (spoken.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 4)) continue;
      // And a landmark under a palm crown is no landmark at all — the first
      // banner planted came out as a red smudge behind three trunks. A flag is
      // two units of thin pole with the only readable part at the top, so it
      // needs sky above it, not canopy.
      let shaded = false;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) if (treed.has(key(c.x + dx, c.z + dz))) shaded = true;
      }
      if (shaded) continue;
      if (c.zone !== 'beach' && totems < 2) {
        put(c, 'deco_totem', rng.range(1.0, 1.25), { jitter: 0.12, scaleY: rng.range(1.3, 1.55) });
        totems++;
      } else if (flags < 3) {
        put(c, 'deco_flag', rng.range(0.75, 0.95), { jitter: 0.15 });
        flags++;
      } else {
        continue;
      }
      spoken.push(c);
    }
  }

  /* --- pass 7: the gardens ------------------------------------------------
   * Everything still open on the plateau. The reference leaves almost none of
   * it bare, so this fills rather than samples: greenery on the green, cargo
   * and posts on the sand, and a crop patch wherever a whole cell of grass is
   * going spare. */
  {
    const inland = cells
      .filter((c) => c.zone !== 'beach' && free(c))
      .sort((a, b) => key(a.x, a.z) - key(b.x, b.z));
    for (const c of inland) {
      const r = rng.next();
      if (onGrass(c)) {
        if (r < 0.3) {
          // A crop bed: four to six stalks on a grid, not a scatter. Rows are
          // what makes the reference's fields read as cultivated ground.
          const rows = rng.int(2, 3);
          const cols = rng.int(2, 3);
          for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
              drop(c, 'harv_cotton', rng.range(0.34, 0.42),
                (i / (rows - 1 || 1) - 0.5) * 0.62, (j / (cols - 1 || 1) - 0.5) * 0.62);
            }
          }
          plan.used.add(key(c.x, c.z));
        } else if (r < 0.92) {
          clump(c, SHRUBS_ACCENT, rng.int(3, 5), 0.42, 0.72, { spread: 0.42 });
        }
      } else if (r < 0.28) {
        clump(c, CARGO, rng.int(3, 5), CARGO_LO, CARGO_HI, { spread: 0.34, stack: 0.32 });
      } else if (r < 0.44) {
        // Free-standing posts, which is what the reference stands along its
        // plot corners. The pirate lamp went here first and was a mistake: it
        // is a grey-white lantern on a thin pole, and four of them in a row
        // read as mushrooms rather than as street furniture.
        for (let i = 0; i < rng.int(1, 2); i++) {
          const p = post(rng);
          drop(c, 'deco_fence_post', p.scale,
            rng.range(-0.36, 0.36), rng.range(-0.36, 0.36),
            { rotationY: 0, scaleY: p.scaleY });
        }
        plan.used.add(key(c.x, c.z));
      } else if (r < 0.62) {
        clump(c, SHRUBS, rng.int(2, 4), 0.42, 0.68, { spread: 0.42 });
      } else if (r < 0.68) {
        put(c, rng.chance(0.5) ? 'deco_rock_sm' : 'deco_driftwood', rng.range(1.0, 1.5), { jitter: 0.24 });
      }
      // The rest is left as open sand: the reference's paths are walkable.
    }
  }

  /* --- pass 8: the beach --------------------------------------------------
   * Rocks and driftwood at the waterline, shells above it. The beach stays
   * more open than the plateau — it is open in the reference too — but its
   * features come in GROUPS: three boulders leaning on each other, a pair of
   * mounds, a run of shells, never one lonely pebble per cell. */
  {
    for (const c of byZone('beach')) {
      if (!free(c)) continue;
      const r = rng.next();
      if (r < 0.13) {
        put(c, 'deco_rock_lg', rng.range(1.7, 2.6), { jitter: 0.3 });
        for (let i = 0; i < rng.int(1, 2); i++) {
          drop(c, 'deco_rock_sm', rng.range(0.9, 1.5), rng.range(-0.44, 0.44), rng.range(-0.44, 0.44));
        }
      } else if (r < 0.24) {
        for (let i = 0; i < rng.int(2, 3); i++) {
          drop(c, 'deco_rock_sm', rng.range(0.9, 1.8), rng.range(-0.42, 0.42), rng.range(-0.42, 0.42));
        }
        plan.used.add(key(c.x, c.z));
      } else if (r < 0.34) {
        put(c, 'deco_driftwood', rng.range(1.8, 2.6), { jitter: 0.28 });
        if (rng.chance(0.5)) {
          drop(c, 'deco_starfish', rng.range(0.5, 0.75), rng.range(-0.44, 0.44), rng.range(-0.44, 0.44));
        }
      } else if (r < 0.44) {
        // Was a deco_sandmound with scrub on it. The mound is a 32 x 3 slab —
        // read as a raised sand PLATFORM with a hard shadowed lip, and on sand
        // that is a modelling error rather than a dune. It earns its keep under
        // the islets, where it is the ground; here it only ever looked broken.
        clump(c, SHRUBS, rng.int(3, 4), 0.5, 0.85, { spread: 0.4 });
        if (rng.chance(0.4)) {
          drop(c, 'deco_rock_sm', rng.range(0.9, 1.4), rng.range(-0.4, 0.4), rng.range(-0.4, 0.4));
        }
      } else if (r < 0.5) {
        // Cargo only where the settlement reaches the shore. Barrels on an
        // empty stretch of coast three cells from nothing are litter, and the
        // reference has none: everything crated there is within sight of the
        // pier or the market.
        if (c.toBuilding <= 4) {
          clump(c, CARGO, rng.int(2, 4), CARGO_LO, CARGO_HI, { spread: 0.34, stack: 0.3 });
        } else {
          clump(c, SHRUBS, rng.int(3, 4), 0.48, 0.8, { spread: 0.44 });
        }
      } else if (r < 0.58) {
        for (let i = 0; i < rng.int(2, 3); i++) {
          drop(c, 'deco_starfish', rng.range(0.45, 0.75), rng.range(-0.44, 0.44), rng.range(-0.44, 0.44));
        }
        if (rng.chance(0.5)) {
          drop(c, 'deco_driftwood', rng.range(1.4, 2.0), rng.range(-0.3, 0.3), rng.range(-0.3, 0.3));
        }
        plan.used.add(key(c.x, c.z));
      } else if (r < 0.88) {
        // Scrub. The largest single slice, because a shore of bare sand with
        // eight boulders on it is what "sparse" looked like: it is the low
        // green that makes the ring read as land rather than as beach.
        clump(c, SHRUBS, rng.int(3, 5), 0.45, 0.78, { spread: 0.44 });
      }
      // Everything else stays bare sand.
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

  /** A flat rectangle on the ground: half-extent `r` across, `rz` along, yawed.
   *  Square unless `rz` is given, which is what draws a furrow. */
  const quad = (
    cx: number, cy: number, cz: number, r: number, yaw: number, colour: number, rz = r
  ) => {
    const c = Math.cos(yaw) * r;
    const s = Math.sin(yaw) * r;
    const cz2 = Math.cos(yaw) * rz;
    const sz2 = Math.sin(yaw) * rz;
    // Two triangles, flat on the ground, rotated about y.
    const a = [cx - c + sz2, cy, cz - s - cz2];
    const b = [cx + c + sz2, cy, cz + s - cz2];
    const d = [cx + c - sz2, cy, cz + s + cz2];
    const e = [cx - c - sz2, cy, cz - s + cz2];
    // Wound so the geometric normal is +y. The other order makes every quad
    // face the sea floor, which back-face culling then removes — the cover is
    // there, costs its triangles, and draws nothing.
    positions.push(...a, ...d, ...b, ...a, ...e, ...d);
    tint.setHex(colour, THREE.SRGBColorSpace);
    for (let i = 0; i < 6; i++) colours.push(tint.r, tint.g, tint.b);
  };

  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= size || z >= size ? null : cells[z * size + x]);

  /*
   * Every colour below is derived from the terrain's OWN albedo rather than
   * written down.
   *
   * This layer is painted on the terrain and has to belong to it, and a literal
   * hex here cannot. island.ts's palette is not a set of colours, it is a set of
   * colours DIVIDED BY the rig's measured response — sand enters at 0xf8dfbc to
   * leave the frame at #e3d7b8 — so a value picked by eye off the reference and
   * pasted in renders about 12% darker and a good deal cooler than the ground it
   * is sitting on. That is exactly what happened: the sand grain was written as
   * #dccfae, which is what sand should LOOK like, and it came out as grey
   * blotches scattered over warm sand. Deriving from the palette means the cover
   * tracks the terrain automatically, including through a recalibration of it.
   */
  const scale = (base: number, k: number): number => {
    const r = Math.min(255, Math.round(((base >> 16) & 255) * k));
    const g = Math.min(255, Math.round(((base >> 8) & 255) * k));
    const b = Math.min(255, Math.round((base & 255) * k));
    return (r << 16) | (g << 8) | b;
  };
  /** Toward white, for the flower heads and the shell grit. */
  const pale = (base: number, t: number): number => {
    const mix = (v: number) => Math.min(255, Math.round(v + (255 - v) * t));
    return (mix((base >> 16) & 255) << 16) | (mix((base >> 8) & 255) << 8) | mix(base & 255);
  };

  const GRASS = PALETTE.grass;
  const SAND_BASE = PALETTE.sand;

  // Pale flower heads and a darker tuft, the two things the reference's grass is
  // covered in. The dirt is for the worn edge where a plot meets its drop.
  const FLOWERS = [pale(GRASS, 0.86), pale(GRASS, 0.92), pale(GRASS, 0.8), pale(GRASS, 0.95)];
  const TUFTS = [
    scale(GRASS, 0.82), scale(GRASS, 0.88), scale(GRASS, 0.74),
    scale(GRASS, 1.04), scale(GRASS, 0.93),
  ];
  const WORN = [scale(PALETTE.dirt, 0.98), scale(PALETTE.dirt, 0.86)];
  // Broad, low-contrast mottling — the layer under the tufts. A plot the size
  // of six cells painted in one albedo reads as a rectangle of paint no matter
  // how many dots are sprinkled on it, because the dots are all the same size
  // and the eye reads the average. These are big enough to be shapes.
  const MOTTLE = [scale(GRASS, 0.94), scale(GRASS, 0.88), scale(GRASS, 1.06), scale(GRASS, 0.91)];
  // The rows of a worked field: darker than the grass either side of them, so a
  // bed reads as furrows rather than as stripes painted on a lawn.
  const CROP = [scale(GRASS, 0.7), scale(GRASS, 0.78), scale(GRASS, 0.85)];
  // Within a few percent of the sand itself, so this grains the beach rather
  // than littering it.
  // Darker only, never brighter. Sand enters at 0xf8dfbc — its red is already
  // within seven counts of the ceiling, so any multiplier above 1 clips red
  // alone and the "brighter sand" comes out cyan-grey. Contrast on the beach
  // has to be made downward.
  const SAND = [
    scale(SAND_BASE, 1.0), scale(SAND_BASE, 0.965), scale(SAND_BASE, 0.93),
    scale(SAND_BASE, 0.985), scale(SAND_BASE, 0.9),
  ];
  const SHELL = [pale(SAND_BASE, 0.55), scale(SAND_BASE, 0.8), pale(SAND_BASE, 0.7)];

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const cell = cells[z * size + x];
      if (cell.height <= 0) continue;
      const y = cell.height * STEP + 0.02;
      const x0 = x * CELL - (size * CELL) / 2 + CELL / 2;
      const z0 = z * CELL - (size * CELL) / 2 + CELL / 2;

      if (cell.material === 'grass') {
        // Three scales, laid coarse to fine. One scale of dot cannot break up a
        // plot: whatever its density, the eye averages it back to the flat fill
        // underneath. The mottle gives the plot shapes, the tufts give it a
        // surface, the flowers give it sparkle.
        for (let i = 0; i < rng.int(3, 5); i++) {
          quad(
            x0 + rng.range(-0.4, 0.4) * CELL, y, z0 + rng.range(-0.4, 0.4) * CELL,
            rng.range(0.17, 0.32), rng.range(0, Math.PI / 2), rng.pick(MOTTLE)
          );
        }

        // Every third plot is a worked field: four furrows of short dashes on
        // the grid. Keyed off the cell rather than rolled, so a bed is whole
        // cells wide and its rows line up with its neighbours' instead of each
        // cell deciding on its own.
        // Furrows run the full width of the cell and land on the same lanes in
        // the cell next door, so a bed several cells across reads as one worked
        // field rather than as each square deciding for itself.
        if ((((x >> 1) * 7 + (z >> 1) * 5) % 9) < 4) {
          const along = ((((x / 5) | 0) + ((z / 5) | 0)) & 1) === 0;
          for (let r = 0; r < 4; r++) {
            const lane = (r / 3 - 0.5) * 0.74;
            quad(
              x0 + (along ? 0 : lane * CELL), y, z0 + (along ? lane * CELL : 0),
              0.5 * CELL, along ? 0 : Math.PI / 2, rng.pick(CROP), rng.range(0.045, 0.062) * CELL
            );
          }
        }

        const dots = rng.int(18, 26);
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
        // Where the plot steps down, its lip wears to earth — hugging the side
        // that actually drops. Scattered anywhere in the cell (which is what it
        // used to do) the same quads read as mud spilt on the lawn; pinned to
        // the edge they read as the worn rim of a terrace.
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = at(x + dx, z + dz);
          if (n && n.height >= cell.height) continue;
          for (let i = 0; i < rng.int(2, 3); i++) {
            const t = rng.range(-0.4, 0.4);
            quad(
              x0 + (dx * rng.range(0.36, 0.46) + dz * t) * CELL, y,
              z0 + (dz * rng.range(0.36, 0.46) + dx * t) * CELL,
              rng.range(0.05, 0.09), dz !== 0 ? 0 : Math.PI / 2, rng.pick(WORN),
              rng.range(0.1, 0.18)
            );
          }
        }
      } else {
        // The same coarse-then-fine layering as the grass, at a fraction of the
        // contrast. The court in front of the hall is the largest single fill in
        // the frame and the reference's is not flat — it is trodden, with
        // broad paler and warmer patches under the grain.
        for (let i = 0; i < rng.int(2, 4); i++) {
          quad(
            x0 + rng.range(-0.38, 0.38) * CELL, y, z0 + rng.range(-0.38, 0.38) * CELL,
            rng.range(0.18, 0.34), rng.range(0, Math.PI / 2), rng.pick(SAND)
          );
        }
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

        // Where a path runs alongside a plot, the grass spills over the line.
        // The reference's plot edges are ragged and ours were drawn with a
        // ruler: a straight sand/grass boundary a whole island long is the
        // clearest possible signal that the ground is a painted grid, and a
        // handful of tufts on the sand side is what breaks it.
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = at(x + dx, z + dz);
          if (!n || n.material !== 'grass' || n.height !== cell.height) continue;
          for (let i = 0; i < rng.int(3, 6); i++) {
            const t = rng.range(-0.45, 0.45);
            quad(
              x0 + (dx * rng.range(0.18, 0.47) + dz * t) * CELL, y,
              z0 + (dz * rng.range(0.18, 0.47) + dx * t) * CELL,
              rng.range(0.05, 0.1), rng.range(0, Math.PI / 2), rng.pick(TUFTS)
            );
          }
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
    // Three or four palms leaning together, not two standing apart: every islet
    // in the reference is a CLUMP, and two trees on a sandbank read as two
    // trees on a sandbank rather than as an island.
    const palms = rng.int(3, 4);
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
    for (let i = 0; i < rng.int(1, 2); i++) {
      items.push({
        model: rng.chance(0.45) ? 'deco_rock_lg' : 'deco_rock_sm',
        position: new THREE.Vector3(
          base.x + rng.range(-1.9, 1.9) * spot.r,
          top,
          base.z + rng.range(-1.9, 1.9) * spot.r
        ),
        rotationY: rng.range(0, Math.PI * 2),
        scale: rng.range(1.3, 2.1),
      });
    }
    for (let i = 0; i < rng.int(3, 5); i++) {
      items.push({
        model: rng.pick(SHRUBS),
        position: new THREE.Vector3(
          base.x + rng.range(-2.1, 2.1) * spot.r, top, base.z + rng.range(-2.1, 2.1) * spot.r
        ),
        rotationY: rng.range(0, Math.PI * 2),
        scale: rng.range(0.6, 1.0),
      });
    }
    if (rng.chance(0.6)) {
      items.push({
        model: rng.chance(0.5) ? 'deco_driftwood' : 'deco_starfish',
        position: new THREE.Vector3(
          base.x + rng.range(-2.4, 2.4) * spot.r, top, base.z + rng.range(-2.4, 2.4) * spot.r
        ),
        rotationY: rng.range(0, Math.PI * 2),
        scale: rng.range(0.7, 1.6),
      });
    }
  }
  return items.map((item) => ({ ...item, castShadow: !NO_SHADOW.has(item.model) }));
}
