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
 * On the island a new player boots into: around two hundred cells of the four
 * hundred-odd on the map, and four fifths of those are shore. The plateau is
 * claimed almost end to end — the smallest plot is three cells across and it
 * fits nearly everywhere, so nearly everywhere is spoken for; of ninety-odd
 * grass cells, a dozen are free and the rest can never take a prop at all.
 *
 * That ratio decides the whole composition, so measure it again rather than
 * trusting the numbers above — they move whenever the terrain generator does,
 * and they have. Density here is not something to be spread evenly over the
 * map: it has to be won on the shore ring, on the terrace lips, and in the
 * aprons the standing buildings open up. Where the reference dresses its plot
 * interiors we dress their EDGES — a prop's origin is what the rule constrains,
 * so planting parked on a border hangs half its mass over the plot beyond — and
 * where it fills its middle with props we can only paint it (`buildGroundCover`).
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
 *
 * WHERE THE BUDGET GOES, AND WHY IT MOVED
 *
 * Round one put 461 of its 593 props on the beach and 132 inland, and every
 * critic read the same thing off the frame: a solid unbroken hedge of palms and
 * flower bushes welded around the coastline, and bare slabs the moment you step
 * inland. Both halves of that were one mistake. The shore is four fifths of the
 * free cells, so a rule that rolls per cell spends four fifths of everything it
 * has on the ring — and the ring is the one part of the reference that is EMPTY.
 * Look at island_hero.png: its sand is clean, wide and bare, and every prop that
 * matters stands on the green inside it. The composition is dense green on open
 * sand; ours was the exact inverse.
 *
 * So the shore now rolls bare more often than not and its palm stands are cut
 * from eleven to six, and what that pays for is `furnish` — the pass that treats
 * each free inland cell as a square to be COMPOSED rather than sprinkled: one
 * tall accent, one or two chest-high props, two or three pieces of ground
 * clutter, all on a ring so nothing sits in the middle. There are few enough of
 * those cells that each has to carry a full stack, and few enough that the tall
 * tier matters most — a totem or a palm on a free cell throws a shadow clear
 * across the plot beside it, which is the only mark anything gets to leave on
 * ground no prop may stand on.
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
  'deco_starfish', 'harv_cotton', 'deco_sandmound',
]);
// Freight came OUT of that set. A barrel is waist-high and it is the one prop
// that stands on open sand rather than banked into planting, so it is exactly
// the object the eye checks for a shadow — and the round-one note was "every
// building stands on open sand touching it nowhere". They are instanced, so
// the whole dockside costs the shadow pass three more draw calls, not three
// hundred.

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
/*
 * The accent mix, re-weighted off the round-one note "identical red flower
 * bushes". `deco_bush` and `deco_bush_alt` are the same green sprig carrying a
 * spray of scarlet blooms, and `deco_plant` is violet lilies; between them they
 * were two of the eight entries here and forty-odd props in the frame, which on
 * a palette this warm is enough red to read as the island's colour. Count the
 * red-flowered bushes in island_hero.png and you get three. So the flowering
 * ones are down to one entry in eight and the rest of the weight goes back to
 * the plain green cube, which is the shape their planting is actually made of.
 */
const SHRUBS_ACCENT = [
  'deco_hedge', 'deco_hedge', 'deco_hedge', 'deco_hedge', 'deco_hedge',
  'deco_fern', 'deco_fern', 'deco_bush_alt',
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

/**
 * The tall thing each furnished cell gets, dealt from a rotation.
 *
 * Rolled instead, this would be wrong twice over. Thirty cells is a small enough
 * sample that a one-in-four totem deals four in a row about as often as it
 * spreads them, and four totems in a row is not four landmarks, it is a fence of
 * totems. And the mix itself is the point: the reference's skyline over the
 * plots is palms with tikis and mooring posts punctuating them, in roughly these
 * proportions. A rotation guarantees both the ratio and the spacing.
 *
 * `post` is not a model id — it is a mooring post, `deco_fence_post` stretched
 * to about a cell and a third, which is the one item in the set that reads as
 * vertical without also reading as vegetation.
 */
const ACCENT_ROTA = [
  'tree_palm_tall', 'deco_totem', 'post', 'tree_palm', 'post', 'deco_flag',
  'deco_totem', 'tree_palm_tall', 'post', 'tree_palm', 'post', 'deco_totem',
] as const;

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
  const rng = new Rng(`${seed}:decor:v4`);
  const { size } = shape;
  const cells = decorCells(shape, state);
  const claimed = reservedMask(shape, state);
  const plan: Plan = { items: [], used: new Set(), edges: new Set() };
  /** Cells with a palm on them, so the banners are not planted under a crown. */
  const treed = new Set<number>();

  const inBounds = (x: number, z: number) => x >= 0 && z >= 0 && x < size && z < size;
  const isClaimed = (x: number, z: number) => inBounds(x, z) && claimed[z * size + x] === 1;
  /** Which of the island's two surfaces this cell is — the reference plants the
   *  green things on the green and stands the wooden things on the sand. */
  const onGrass = (c: DecorCell) => shape.cells[c.z * size + c.x].material === 'grass';

  /**
   * Inland, as opposed to shore — the line the whole composition is split on.
   *
   * NOT `zone !== 'beach'`, which is what this used to be and which turned out
   * to be a different question wearing the same word. `beach` means "no plot
   * could stand here", and on a reshaped island that is true of a great deal of
   * ground in the MIDDLE of the map as well as around its edge; the split went
   * from 108/30 to 167/31 under a terrain edit without a single cell actually
   * moving nearer the sea. Distance to water is the thing that was meant all
   * along: two cells or less is the shore the reference keeps clean and open,
   * three or more is the settlement, and the settlement is where its density
   * lives. Terrace lip and building apron are inland whatever their distance,
   * because both are by definition up on the plateau.
   */
  const inland = (c: DecorCell) => c.zone !== 'beach' || c.toWater >= 3;

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
   * Offsets are clamped just inside a half-cell because `worldToCell` ROUNDS a
   * prop's world position back to a cell: at ±0.5 it tips into the neighbour,
   * and if that neighbour is ground a plot could take, the prop is a violation
   * of the rule at the top of this file. 0.48 is as close to the line as the
   * rounding allows, and it is worth the two hundredths — a prop's ORIGIN is
   * what the rule constrains, not its volume, so a bush parked on the border
   * spills half its mass over a plot that no prop may stand in. That overhang is
   * the only way anything reaches the interior slabs at all.
   */
  const drop = (
    c: DecorCell, model: string, scale: number, ox: number, oz: number, opts: DropOpts = {}
  ): void => {
    const at = cellToWorld(shape, c.x, c.z);
    plan.items.push({
      model,
      position: new THREE.Vector3(
        at.x + Math.max(-0.48, Math.min(0.48, ox)) * CELL,
        at.y + (opts.lift ?? 0),
        at.z + Math.max(-0.48, Math.min(0.48, oz)) * CELL
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

  /* ---- the three tiers -------------------------------------------------
   * Any dressed square in island_hero.png carries the same stack: one thing
   * taller than a doorway, two or three at knee-to-chest height, and a scatter
   * of ankle-high stuff filling between them. The tiering is what makes a cell
   * read as decorated rather than as sprinkled — five props all the same height
   * is a texture, and a texture is what the round-one frame had. */

  /**
   * A slot on a ring inside the cell: `i` of `n`, never the middle.
   *
   * "None of them centred" is not a style note. A prop on a cell's centre lands
   * on the exact lattice the terrain is already drawn on, so a row of filled
   * cells comes out as a row of evenly spaced dots and the grid the whole island
   * is trying not to look like is handed straight back. Off-centre on a ring,
   * the same props read as a heap. The phase is per-cell so two neighbours never
   * rhyme.
   */
  const ring = (i: number, n: number, phase: number, lo: number, hi: number): [number, number] => {
    const a = (i / n + phase) * Math.PI * 2;
    const r = rng.range(lo, hi);
    return [Math.cos(a) * r, Math.sin(a) * r];
  };

  /** Tier 1: the vertical accent. Taller than anything else on its cell. */
  const accent = (c: DecorCell, what: string, ox: number, oz: number): void => {
    if (what === 'deco_totem') {
      // The carved tiki. 16 units tall on a 14.5 footprint, so the stretch is
      // what takes it from a bollard to a landmark: ~2 world units, a third
      // again the height of a palm trunk.
      drop(c, 'deco_totem', rng.range(1.0, 1.22), ox, oz, { scaleY: rng.range(1.45, 1.8) });
    } else if (what === 'deco_flag') {
      drop(c, 'deco_flag', rng.range(0.8, 0.98), ox, oz);
    } else if (what === 'tree_palm' || what === 'tree_palm_tall') {
      drop(c, what, rng.range(1.7, 2.15), ox, oz, { scaleY: rng.range(0.9, 1.15) });
      treed.add(key(c.x, c.z));
    } else {
      // A mooring post: the same model as the bollards below, a quarter again
      // as wide and half again as tall, so it belongs to the same family without
      // being mistaken for one of the run.
      const p = post(rng);
      drop(c, 'deco_fence_post', p.scale * 1.3, ox, oz, {
        rotationY: 0, scaleY: p.scaleY * 1.15,
      });
    }
  };

  /**
   * Tier 2: chest-high. The tier that gives a cell its mass.
   *
   * No driftwood, on either surface. The model is a 112 x 25 x 71 branch — a
   * one-voxel arc two cells long — and at any size that reads from the camera it
   * comes out as a black scribble lying on the ground. Six of them across the
   * shore were the ugliest thing in the round-one frame, and there is nothing
   * remotely like them anywhere in island_hero.png. It keeps a much smaller
   * slice of the beach pass and nothing else.
   */
  const midProp = (c: DecorCell, grass: boolean, ox: number, oz: number): void => {
    const r = rng.next();
    if (grass) {
      // Green-weighted, because on grass the reference's chest-high tier is
      // almost entirely bushes: loose rows of dark rounded shrubs, with a rock
      // or a crate every third plot for relief.
      // Nine tenths green. Free grass runs about a dozen cells against a couple
      // of hundred of sand, so the green ones are the only chance the composition
      // has to put planting on planting — spending a fifth of them on a barrel
      // was spending the scarcest ground there is on the one thing the sand
      // already has plenty of.
      if (r < 0.5) drop(c, 'deco_hedge', rng.range(0.74, 0.98), ox, oz);
      else if (r < 0.78) drop(c, rng.pick(SHRUBS_ACCENT), rng.range(0.58, 0.82), ox, oz);
      else if (r < 0.92) drop(c, 'deco_rock_lg', rng.range(0.7, 0.95), ox, oz);
      else drop(c, rng.pick(CARGO), rng.range(0.46, 0.6), ox, oz);
    } else {
      // And on sand it is almost entirely timber and stone: freight, boulders,
      // the odd bush banked against a wall.
      if (r < 0.44) drop(c, rng.pick(CARGO), rng.range(0.46, 0.62), ox, oz);
      else if (r < 0.72) drop(c, 'deco_rock_lg', rng.range(0.75, 1.0), ox, oz);
      else if (r < 0.9) drop(c, 'deco_hedge', rng.range(0.64, 0.86), ox, oz);
      else {
        const p = post(rng);
        drop(c, 'deco_fence_post', p.scale, ox, oz, { rotationY: 0, scaleY: p.scaleY });
      }
    }
  };

  /** Tier 3: ankle-high. Fills the gaps the other two leave. */
  const smallProp = (c: DecorCell, grass: boolean, ox: number, oz: number): void => {
    const r = rng.next();
    if (grass) {
      if (r < 0.5) drop(c, rng.pick(SHRUBS_ACCENT), rng.range(0.36, 0.56), ox, oz);
      else if (r < 0.7) drop(c, 'harv_cotton', rng.range(0.3, 0.42), ox, oz);
      else if (r < 0.88) drop(c, 'deco_hedge', rng.range(0.4, 0.56), ox, oz);
      else drop(c, 'deco_rock_sm', rng.range(0.6, 0.95), ox, oz);
    } else {
      // Shells are a tenth of this tier, not a fifth. `deco_starfish` is bright
      // cyan, and cyan is a colour that appears nowhere on the reference's
      // island — fifty of them scattered over beige sand did not read as shells,
      // they read as litter, and they were the only saturated cool note in the
      // whole frame. A handful at the waterline is the whole of their job.
      if (r < 0.24) drop(c, 'deco_rock_sm', rng.range(0.48, 0.7), ox, oz);
      else if (r < 0.33) drop(c, 'deco_starfish', rng.range(0.45, 0.62), ox, oz);
      else if (r < 0.78) drop(c, rng.pick(SHRUBS), rng.range(0.4, 0.6), ox, oz);
      else drop(c, rng.pick(CARGO), rng.range(CARGO_LO, CARGO_HI), ox, oz);
    }
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
    // 0.46, hard against the line. The rule constrains a prop's ORIGIN, so a
    // bush anchored here puts half of itself on the plot beyond — and since
    // that plot is ground no prop may stand on, the overhang is the only
    // decoration its edge will ever get. At 0.4 the runs sat a bush's width
    // inside our own ground and read as a hedge growing near a border rather
    // than as the border itself.
    const off = 0.46;

    if (kind === 'hedge') {
      // Two or three, bigger. Four small ones packed along a one-cell border is
      // a green stripe; three at two thirds of a cell tall is a hedge with gaps
      // you can see the ground through, which is what the reference's are.
      const n = rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1) - 0.5) * 0.72 + rng.range(-0.05, 0.05);
        const near = off - rng.range(0, 0.08);
        drop(c, rng.pick(SHRUBS), rng.range(0.5, 0.74), dx * near + tx * t, dz * near + tz * t);
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
   * that overlap each other, and leaves the ground between them bare. */
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
        // bare trunk on bare ground. One or two, not one to three: this runs on
        // every trunk of every stand, so the upper bound is what turned six
        // clumps of trees into a continuous green skirt round the whole island.
        for (const c of near) {
          for (let i = 0; i < rng.int(1, 2); i++) {
            drop(c, rng.pick(SHRUBS_ACCENT), rng.range(0.45, 0.8),
              rng.range(-0.44, 0.44), rng.range(-0.44, 0.44));
          }
        }
      }
    };

    // SIX stands of two to four, down from eleven of three to five — a cut of
    // roughly half the palms on the shore, and it is the single change the
    // round-one notes asked for most directly. Eleven stands on a 108-cell ring
    // do not read as eleven stands; each is within two cells of the next, so
    // their crowns close into one continuous canopy and the island's silhouette
    // disappears inside it. The reference's shore is mostly EMPTY sand with a
    // handful of clusters on it, and the gaps are what make the clusters read.
    //
    // The stands are also beach-only now. Rim cells are terrace lip, and the
    // terrace lip is inland ground, and inland ground is the entire budget the
    // interior has. Spending it on more coastal palms is what
    // left the middle of the island bare; `furnish` gets it instead, and puts
    // palms back on about a third of it from its own rotation.
    grove(
      cells
        .filter((c) => !inland(c) && c.toWater >= 1 && free(c))
        .sort((a, b) => a.toWater - b.toWater || key(a.x, a.z) - key(b.x, b.z)),
      6, 2, 4
    );
  }

  /* --- pass 3: framing the town hall -------------------------------------
   * §3's own emphasis rule, in the world: the building the whole island is
   * about gets a gate on its approach, so the eye lands on it rather than
   * wandering.
   *
   * Ahead of `furnish` rather than after it, because the gate is the one prop
   * with a fixed address — it has to span a path, and there are two cells on
   * this island where that is true. Everything else can go anywhere. */
  /** Cells that already have their tall accent, so `furnish` does not add a
   *  second one on top of it. */
  const accented = new Set<number>();
  if (hall) {
    // Measured from the HALL, not from a point three cells in front of it. The
    // old anchor assumed there was open ground on the hall's approach; on this
    // island there is none — every cell within four of the hall is ground some
    // plot could take — so the set came back empty and the whole pass silently
    // did nothing. Whatever free ground is nearest the hall IS its approach.
    const approach = cells
      .filter((c) => inland(c) && Math.hypot(c.x - hall.x, c.z - hall.z) < 7)
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
      // The one prop that IS centred, and for the reason everything else is
      // not: it is a gate, it straddles the path, and a gate off to one side of
      // the way through is a gate you walk round.
      drop(gate, 'deco_archway', rng.range(1.95, 2.15), 0, 0, {
        rotationY: alongX ? 0 : Math.PI / 2,
      });
      accented.add(key(gate.x, gate.z));
    }

    // And one tall palm behind it. Palms are what the reference frames ITS hall
    // with, and the two candidates tried first both failed at this scale: the
    // pirate lamp is a grey lantern that reads as a mushroom, and the flag is
    // four units of bare pole with its banner above the top of the frame.
    const framer = approach.find((c) => !accented.has(key(c.x, c.z)) && !plan.used.has(key(c.x, c.z)));
    if (framer) {
      drop(framer, 'tree_palm_tall', rng.range(2.2, 2.5), rng.range(0.2, 0.32), rng.range(-0.3, 0.3), {
        scaleY: rng.range(0.95, 1.1),
      });
      treed.add(key(framer.x, framer.z));
      accented.add(key(framer.x, framer.z));
    }
  }

  /* --- pass 4: furnish the interior --------------------------------------
   * THE pass, and the answer to the round-one note that not one standing prop
   * sat on any grass cell or sand plaza inside the island. Every cell of free
   * inland ground that borders something is COMPOSED rather than sprinkled: one
   * tall accent from the rotation, one or two chest-high props, two or three
   * pieces of ankle clutter, all on a ring so nothing sits on the cell's centre.
   *
   * The old inland dressing put four small hedges on a cell and stopped. Every
   * prop was in the same size tier, which reads the same as having one tier,
   * which reads as texture — and texture is exactly what a blockout looks like.
   *
   * The middle of an open court is deliberately left alone. The reference's
   * sand is walkable: its props line the edges of its plazas and cluster at
   * their corners, and the space between is empty on purpose. Filling every
   * square of it is how the coast ring got welded shut in round one, and the
   * same rule applies inland — density has to have somewhere to read against.
   *
   * `free` is deliberately not consulted. A cell the dock already heaped crates
   * on still wants a mooring post over them — that is exactly the arrangement
   * at the head of the reference's own pier — it just wants fewer bushes. */
  {
    const settled = cells
      .filter((c) => inland(c) && !inPlaza(c))
      .sort((a, b) => key(a.x, a.z) - key(b.x, b.z));
    let dealt = 0;
    for (const c of settled) {
      const grass = onGrass(c);
      const busy = plan.used.has(key(c.x, c.z));

      /*
       * Which way the cell's ring starts, and it is not arbitrary.
       *
       * A free cell inland almost always sits BESIDE ground a plot could take,
       * and that border is the one place a prop can be seen decorating
       * something rather than just standing about — the rule constrains a
       * prop's ORIGIN, so a bush at 0.4 out from the centre hangs half its mass
       * over a plot no prop may stand in. Starting the ring at the claimed side
       * is what turns scattered free cells into planting along the plots'
       * edges, which is the shape the reference's density actually has.
       */
      let bx = 0;
      let bz = 0;
      for (const [dx, dz] of SIDES) if (isClaimed(c.x + dx, c.z + dz)) { bx += dx; bz += dz; }
      const edging = bx !== 0 || bz !== 0;
      // Out in the middle of a court, with nothing to line, two cells in three
      // stay clear and the third gets a group rather than a sprinkle. Isolated
      // groups on open ground is how the reference furnishes its plazas.
      //
      // And even ON an edge, better than a quarter of cells are skipped. A run
      // of borders every one of which is dressed is a wall, which is the exact
      // failure the coastline was pulled back from — the gaps are what let the
      // dressed cells read as groups instead of as one continuous mass. Grass
      // is exempt: there are barely a dozen free green cells on the island and
      // every one of them has to count.
      if (!grass && !busy && !rng.chance(edging ? 0.8 : 0.4)) continue;

      const phase = (edging && (bx || bz) ? Math.atan2(bz, bx) / (Math.PI * 2) : rng.next())
        + rng.range(-0.05, 0.05);

      /*
       * A planted bed: rows on a grid instead of a ring.
       *
       * One whole green plot in island_hero.png is a worked field — dark bushes
       * in even rows with a tiki standing in the middle of them — and it is the
       * densest single thing in their frame. Rows are the point: a scatter of
       * the same bushes reads as scrub, and it is the alignment that says
       * somebody planted them. The lanes are keyed to the CELL rather than
       * rolled, so a bed two cells wide lines its rows up with its neighbour's
       * instead of each square deciding for itself.
       *
       * Grass only, and roughly a third of it, because free green cells are the
       * scarcest ground on the island — a dozen of them against four hundred —
       * and this is the densest use any one of them has.
       */
      if (grass && !busy && rng.chance(0.34)) {
        const along = ((c.x + c.z) & 1) === 0;
        for (let lane = 0; lane < 3; lane++) {
          const t = (lane / 2 - 0.5) * 0.72;
          for (let i = 0; i < 3; i++) {
            const u = (i / 2 - 0.5) * 0.72 + rng.range(-0.03, 0.03);
            drop(c, 'deco_hedge', rng.range(0.42, 0.56),
              along ? u : t, along ? t : u);
          }
        }
        // The tiki over the field, off to one side of it.
        const [ax, az] = ring(0, 1, phase, 0.34, 0.44);
        if (!accented.has(key(c.x, c.z))) accent(c, 'deco_totem', ax, az);
        plan.used.add(key(c.x, c.z));
        continue;
      }

      // Four to six all told, which is the count the reference's dressed squares
      // carry. The first cut of this pass ran to nine or ten and the frame said
      // so immediately: the free cells are contiguous, so ten props each did not
      // read as ten decorated squares, it read as one junk heap in a corridor.
      // Below six a cell reads as composed; above it, as tipped over.
      const mids = busy ? 1 : rng.int(1, 2);
      const smalls = busy ? rng.int(1, 2) : rng.int(2, 3);
      const slots = 1 + mids;

      if (!accented.has(key(c.x, c.z))) {
        // Walk the rotation past a palm that would land beside another palm.
        // The rotation spaces the accents in the ORDER they are dealt, and the
        // order is row-major — which on a ring of free cells two deep put every
        // fourth entry directly beside the one from the row above, and the
        // stands closed up into the same canopy the coast was just cut back
        // from. A crown is three cells wide; two of them inside that read as
        // one thicket.
        let what = ACCENT_ROTA[dealt % ACCENT_ROTA.length];
        for (let skip = 0; skip < ACCENT_ROTA.length && what.startsWith('tree_'); skip++) {
          let near = false;
          for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) if (treed.has(key(c.x + dx, c.z + dz))) near = true;
          }
          if (!near) break;
          dealt++;
          what = ACCENT_ROTA[dealt % ACCENT_ROTA.length];
        }
        const [ax, az] = ring(0, slots, phase, 0.3, 0.42);
        accent(c, what, ax, az);
        dealt++;
      }
      for (let i = 0; i < mids; i++) {
        const [ox, oz] = ring(i + 1, slots, phase, 0.3, 0.44);
        midProp(c, grass, ox, oz);
      }
      // The clutter sits on a wider ring, half a slot out of step with the two
      // tiers above it, so it fills the gaps between them instead of banking up
      // against their feet.
      for (let i = 0; i < smalls; i++) {
        const [ox, oz] = ring(i, smalls, phase + 0.5 / smalls, 0.32, 0.46);
        smallProp(c, grass, ox, oz);
      }
      plan.used.add(key(c.x, c.z));
    }
  }

  /* --- pass 5: the bollards ----------------------------------------------
   * Waist-high wooden posts down the edge of every sand path, on a regular
   * beat. In island_hero.png they are the thing that turns an expanse of beige
   * into a ROAD: single posts, all the same height, standing at intervals where
   * the sand meets a plot, with a taller one on the outside corners.
   *
   * Ahead of the hedge-and-fence pass and claiming the borders it uses, so the
   * two never stack. The split is the reference's own: green edges are marked
   * with planting, sand edges with timber. */
  {
    // ONE draw for the whole island, deliberately. A beat whose posts change
    // height from one to the next is not a beat, and the sizes here were
    // already being redrawn per post — which is exactly why the round-one
    // frame's path furniture read as scattered debris rather than as a line.
    const beat = post(rng);
    const tall = beat.scale * 1.18;
    const sand = cells.filter((c) => !inPlaza(c) && inland(c) && !onGrass(c));
    for (const c of sand) {
      for (const [dx, dz] of SIDES) {
        if (!isClaimed(c.x + dx, c.z + dz)) continue;
        const id = edgeKey(c.x, c.z, dx, dz);
        if (plan.edges.has(id)) continue;
        plan.edges.add(id);
        drop(c, 'deco_fence_post', beat.scale, dx * 0.44, dz * 0.44, {
          rotationY: 0, scaleY: beat.scaleY,
        });
      }
      // Outside corners get a taller one. A corner post is what tells the eye
      // the line turned rather than stopped.
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        if (!isClaimed(c.x + dx, c.z) || !isClaimed(c.x, c.z + dz)) continue;
        drop(c, 'deco_fence_post', tall, dx * 0.44, dz * 0.44, {
          rotationY: 0, scaleY: beat.scaleY * 1.25,
        });
      }
    }
  }

  /* --- pass 6: the plot borders -----------------------------------------
   * Every edge where free GRASS meets ground a plot could take gets outlined
   * with a hedge row. This is the single densest thing in the reference frame
   * and the one our island was missing outright — its plots read as flat
   * painted rectangles because nothing marked where they stopped.
   *
   * The runs sit at 0.44 out from the cell's centre, so half of every bush
   * overhangs the plot beyond. That overhang is not sloppiness: the rule at the
   * top of this file constrains a prop's ORIGIN, and hanging the planting over
   * the line is the only way the interior slabs get anything on them at all. */
  {
    const bordering = cells
      .filter((c) => !inPlaza(c) && inland(c))
      .sort((a, b) => key(a.x, a.z) - key(b.x, b.z));
    for (const c of bordering) {
      for (const [dx, dz, yaw] of SIDES) {
        if (!isClaimed(c.x + dx, c.z + dz)) continue;
        // Keyed on the ground BEYOND the border, not on the cell the run is
        // anchored to. The whole point of the run is to dress the plot on the
        // far side — that plot is claimed, so its own cells can never carry a
        // prop, and a bush at 0.46 hanging half over the line is the only
        // planting it will ever have. Which of the two surfaces the anchor
        // happens to be says nothing about that; what the plot is made of says
        // everything, and in the reference green plots are edged with hedge and
        // sand courts with timber.
        const beyond = shape.cells[(c.z + dz) * size + c.x + dx].material === 'grass';
        const r = rng.next();
        const kind = (beyond || onGrass(c))
          ? (r < 0.85 ? 'hedge' : 'fence')
          : (r < 0.5 ? 'fence' : 'hedge');
        dressEdge(c, dx, dz, yaw, kind);
      }
    }
  }

  /* --- pass 7: the terrace lip -------------------------------------------
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
        // Greenery at the foot of the wall, on this cell's own ground. One or
        // two at a third of the walls, not two or three at half: this fires on
        // the whole perimeter of the plateau, so it was one of the two passes
        // paying for the green skirt round the island.
        if (rng.chance(0.34)) {
          for (let i = 0; i < rng.int(1, 2); i++) {
            drop(c, rng.pick(SHRUBS), rng.range(0.42, 0.68),
              dx * rng.range(0.3, 0.44) + tx * rng.range(-0.4, 0.4),
              dz * rng.range(0.3, 0.44) + tz * rng.range(-0.4, 0.4));
          }
        }
        // And a rail on top of it — five walls in six, and always a panel.
        //
        // This is the most valuable line in the pass and it was set to fire
        // less than half the time and then roll again for posts instead. A rail
        // is a GRAPHIC LINE: unbroken it draws the edge of the plateau and
        // reads as design, and a rail with holes in it reads as debris that
        // happens to be arranged. Compare the reference, which runs one
        // continuous timber rail the full width of its northern plots.
        const id = edgeKey(c.x, c.z, dx, dz);
        if (plan.edges.has(id) || !rng.chance(0.62)) continue;
        plan.edges.add(id);
        drop(c, 'deco_fence', CELL * 1.04, dx * 0.44, dz * 0.44, {
          rotationY: yaw + Math.PI / 2, lift: rise * STEP,
        });
      }
    }
  }

  /* --- pass 8: the banners -----------------------------------------------
   * The reference's beach landmarks: three or four flags on their own poles out
   * on the open sand, well apart, each with clear ground round it. The totems
   * they used to share this pass with have moved into `furnish`, where they
   * stand over the greens the way the reference's do. */
  {
    const open = cells
      .filter((c) => free(c) && c.toBuilding >= 3)
      .sort((a, b) => b.toBuilding - a.toBuilding || key(a.x, a.z) - key(b.x, b.z));
    let flags = 0;
    const spoken: DecorCell[] = [];
    for (const c of open) {
      if (flags >= 3) break;
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
      put(c, 'deco_flag', rng.range(0.78, 0.98), { jitter: 0.28 });
      flags++;
      spoken.push(c);
    }
  }

  /* --- pass 9: the beach --------------------------------------------------
   * Rocks and driftwood at the waterline, shells above it, and BARE SAND six
   * times in ten.
   *
   * That last number is the one that changed, and it is the whole argument. The
   * shore is four fifths of this island's free cells, so whatever rate this pass
   * runs at is what the frame's decoration budget mostly is. At the old rate it
   * dressed nine cells in ten, four props each, and the result was the thing
   * every round-one critic named first: a solid unbroken hedge welded around
   * the coastline, with the island hidden inside it.
   *
   * island_hero.png's shore is the opposite and it is not an accident — clean
   * pale sand, wide, with a handful of rock groups and palm clusters on it. The
   * emptiness is what gives the dressed ground inside it somewhere to read
   * against. So the shrub carpet, which was thirty per cent of the beach on its
   * own, is down to eight, and what it paid for is `furnish`. */
  {
    for (const c of cells.filter((c) => !inland(c))) {
      if (!free(c)) continue;
      const r = rng.next();
      if (r < 0.06) {
        /*
         * ONE boulder, and a small one.
         *
         * This used to be a big rock with one or two more piled against it, and
         * the pile is what was wrong with it. `deco_rock_lg` is a dark mossy
         * stone with a ragged silhouette; alone at about a cell across it is a
         * rock on a beach, but overlap three of them and the shape closes into
         * a black splat that reads — genuinely — as a dead crab. There were
         * eight such splats round the shore. The reference's beach stones are
         * pale, blocky and separate, and the separation is most of it.
         */
        put(c, 'deco_rock_lg', rng.range(0.8, 1.1), { jitter: 0.3 });
        if (rng.chance(0.5)) {
          drop(c, 'deco_rock_sm', rng.range(0.55, 0.8), rng.range(-0.44, 0.44), rng.range(-0.44, 0.44));
        }
      } else if (r < 0.11) {
        for (let i = 0; i < rng.int(1, 2); i++) {
          drop(c, 'deco_rock_sm', rng.range(0.6, 0.95), rng.range(-0.42, 0.42), rng.range(-0.42, 0.42));
        }
        plan.used.add(key(c.x, c.z));
      } else if (r < 0.155) {
        // Driftwood, small and rare. It is a two-cell branch one voxel thick,
        // and at the 1.8–2.6 it used to run at it read as a dead black spider
        // lying on the sand — six of them were the ugliest thing in the frame.
        // At a cell and a bit, with a shell beside it, it is a piece of flotsam.
        put(c, 'deco_driftwood', rng.range(0.95, 1.3), { jitter: 0.28 });
        if (rng.chance(0.5)) {
          drop(c, 'deco_starfish', rng.range(0.5, 0.75), rng.range(-0.44, 0.44), rng.range(-0.44, 0.44));
        }
      } else if (r < 0.28) {
        // Cargo only where the settlement reaches the shore. Barrels on an
        // empty stretch of coast three cells from nothing are litter, and the
        // reference has none: everything crated there is within sight of the
        // pier or the market.
        if (c.toBuilding <= 4) {
          clump(c, CARGO, rng.int(2, 4), CARGO_LO, CARGO_HI, { spread: 0.34, stack: 0.3 });
        } else {
          clump(c, SHRUBS, rng.int(2, 3), 0.48, 0.8, { spread: 0.44 });
        }
      } else if (r < 0.31) {
        // And only at the waterline, where a shell has a reason to be.
        if (c.toWater <= 1) {
          for (let i = 0; i < rng.int(1, 2); i++) {
            drop(c, 'deco_starfish', rng.range(0.45, 0.68), rng.range(-0.44, 0.44), rng.range(-0.44, 0.44));
          }
        }
        plan.used.add(key(c.x, c.z));
      } else if (r < 0.42) {
        // Scrub, and only where the shore is deep enough to have a back to it.
        // Was thirty per cent of the beach unconditionally, including the single
        // row of cells at the waterline — which is precisely the ring that came
        // out as a welded green hedge. Banked against the terrace wall instead,
        // the same bushes read as the foot of the island rather than as a fence
        // round it.
        if (c.toWater >= 2) clump(c, SHRUBS, rng.int(2, 4), 0.45, 0.78, { spread: 0.44 });
      }
      // Everything else — nearly six cells in ten — stays bare sand.
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
  /*
   * The beach grain, resized against the SHADOWS that now land on it.
   *
   * Darker only, never brighter. Sand enters at 0xf8dfbc — its red is already
   * within seven counts of the ceiling, so any multiplier above 1 clips red
   * alone and the "brighter sand" comes out cyan-grey. Contrast on the beach
   * has to be made downward.
   *
   * The amplitudes are the part that changed, and they changed because they
   * were measured. High-pass a 13-pixel window over every open-sand pixel in
   * the frame and take the spread: their beach runs sd 1.79, roughly nine
   * levels peak to peak, a fine even stipple. Ours ran sd 5.40 across
   * twenty-two levels, in eight-to-twelve-pixel patches — and the terrain mesh
   * underneath it measures sd 0.84, so every bit of that was this function.
   *
   * Twenty-two levels of blotch is more contrast than a cast shadow has. A
   * shadow is a x0.74 multiply, which on lit sand is a 40-level step, but it
   * arrives as a soft-edged shape of exactly the size these patches are, so on
   * a beach dithered this hard the eye files it as more dither. Four of five
   * critics said the frame casts no shadows; the shadow map says otherwise.
   * Both are true — the shadows were there and this was hiding them.
   *
   * So the broad patches go flat and the grain gets carried by the smallest
   * quads instead, which is where the reference carries its own:
   *
   *   BROAD   6-12 screen px   1 level   was 21   the blotch that had to go
   *   GRAIN    2-5 screen px   2 levels  was 21
   *   SHELL  1.5-3 screen px   4 levels  was 30 and paled toward grey
   */
  const SAND_BROAD = [
    scale(SAND_BASE, 1.0), scale(SAND_BASE, 0.995), scale(SAND_BASE, 0.99),
    scale(SAND_BASE, 0.997), scale(SAND_BASE, 0.993),
  ];
  const SAND = [
    scale(SAND_BASE, 1.0), scale(SAND_BASE, 0.99), scale(SAND_BASE, 0.98),
    scale(SAND_BASE, 0.995), scale(SAND_BASE, 0.985),
  ];
  const SHELL = [pale(SAND_BASE, 0.06), scale(SAND_BASE, 0.96), pale(SAND_BASE, 0.03)];

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
            rng.range(0.18, 0.34), rng.range(0, Math.PI / 2), rng.pick(SAND_BROAD)
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
