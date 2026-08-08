import * as THREE from 'three';
import { Rng } from '../core/rng';

/**
 * The player's island: a stepped voxel landmass built from a height/material grid.
 *
 * The reference island is not a smooth mesh — it is a stack of flat plateaus with
 * visible vertical dirt walls where the grass steps up from the sand, and a crisp
 * beach ring at the waterline. So the terrain is generated as a grid of cells and
 * merged into a handful of geometries (one per material) to keep draw calls low.
 */

export const CELL = 1; // world units per grid cell

export type Material = 'sand' | 'grass' | 'dirt' | 'rock' | 'path';

export interface TerrainCell {
  height: number; // in steps
  material: Material;
  buildable: boolean;
}

export interface IslandShape {
  size: number; // grid is size x size
  cells: TerrainCell[]; // row-major, length size*size
}

/*
 * Colour.
 *
 * Every number below was solved, not picked. The reference's terrain pixels are
 * the TARGET — sand #e3d7b8, grass #95b944, the brown under a grass step
 * #bf8b41 lit and #926532 shaded — but a target is not an albedo. Our rig lands
 * a lit top face at roughly (0.86, 0.96, 1.00) of its own albedo in linear
 * light (the hemisphere's #cfe9ff sky is a cool wash that eats red), and a
 * vertical face at roughly 0.66 flat. Feeding the reference's pixel straight in
 * as albedo is exactly what produced the complaint: sand entered at #e2d8bc and
 * left the frame at #d2d2bc — hue 60, saturation 10%, which is not sand, it is
 * grey. So each albedo here is target ÷ that measured response, and the comment
 * on each line is the pixel it is aiming at.
 *
 * Re-measure with tools if the lighting rig moves: sample a flat top face and a
 * wall out of a capture, divide by these, and the ratios fall out.
 */
const PALETTE: Record<Material, number> = {
  sand: 0xf8dfbc, // -> #e3d7b8, the plaza sand
  grass: 0xa5c146, // -> #95b944
  dirt: 0xd7a36a, // -> #c9a06a
  rock: 0xa5a6a8, // -> #9aa3a8
  path: 0xf8dfbc, // -> #e3d7b8; paths are sand in the reference, not a stripe
};

/** The beach ring reads a shade paler and cooler than the plaza it rings —
 *  #e0dac1 against #e3d7b8. Small, but it is what keeps the two sand tiers from
 *  merging into one field once the step between them is only a few pixels. */
const SAND_BEACH = 0xf5e3c5; // -> #e0dac1

/**
 * Wall skins.
 *
 * A step in the reference is never one flat band. It is a LIP of whatever caps
 * it — a dark green rind under grass, a pale sand rind under sand — sitting on
 * a body of brown, and that two-part edge is most of why the island reads as
 * carved blocks rather than as a coloured height map.
 *
 * Each skin carries a sun and a shade variant. The camera sits on the +x/+z
 * diagonal, so exactly two of a block's four walls are ever on screen: the one
 * facing +x (screen right) and the one facing +z (screen left). The sun in the
 * reference comes from screen right — every palm lays its shadow to the left of
 * its own trunk — so +x is lit and +z is shaded. The previous code called both
 * of them lit, which is why the terraces read flat: the entire frame contained
 * exactly one wall colour, and a step you cannot see two sides of is not a step.
 */
interface WallSkin {
  lipSun: number;
  lipShade: number;
  bodySun: number;
  bodyShade: number;
  /** Share of one step the lip occupies. Measured off the reference by counting
   *  pixels down a wall: a grass rind runs about a quarter of the step, a sand
   *  one about a third. */
  lip: number;
}

const WALL_GRASS: WallSkin = {
  lipSun: 0x84b334, // -> #6d9529
  lipShade: 0x5f9c32, // -> #4e8227
  bodySun: 0xe5a751, // -> #bf8b41
  bodyShade: 0xb07a3f, // -> #926532
  lip: 0.26,
};

const WALL_SAND: WallSkin = {
  // The sunlit sand rind is #fbefce in the reference — brighter than a vertical
  // face in our rig can reach at any albedo, so this one is pinned at the
  // ceiling and lands short. It is still by a wide margin the brightest thing
  // on the wall, which is the job it is doing.
  lipSun: 0xfffff8, // -> ~#d5d5cf, aiming at #fbefce
  lipShade: 0xece6ca, // -> #c5c0a5
  bodySun: 0xffcba0, // -> ~#deb482, aiming at #e0b082
  bodyShade: 0xb59175, // -> #97785e
  lip: 0.34,
};

const WALL_ROCK: WallSkin = {
  lipSun: 0xc8ccd0,
  lipShade: 0x9aa0a6,
  bodySun: 0xa8a5a0,
  bodyShade: 0x7d7b78,
  lip: 0.3,
};

function wallSkin(material: Material): WallSkin {
  if (material === 'grass') return WALL_GRASS;
  if (material === 'rock') return WALL_ROCK;
  return WALL_SAND;
}

const STEP = 0.66; // world height of one terrain step

/** How far a coastal wall carries on below sea level. Only its top is ever
 *  seen; the rest exists so the water never cuts under the island. */
const SKIRT = 0.9;

/*
 * The three tiers, in steps.
 *
 * The beach sits two steps up rather than one because the waterline is pinned
 * at 0.82 of a step: at BEACH = 1 the sand stood a fifth of a step out of the
 * sea and the coastal wall was a two-pixel line, where the reference stands its
 * beach a full step clear of the surf and shows a proper sand-over-brown cliff
 * all the way round. Everything above rides up with it, so the steps BETWEEN
 * the tiers — which is what the town is built and dressed against — are
 * unchanged.
 */
const BEACH = 2;
const PLATEAU = 3;
const PLOT = 4;

/** Generates the home island: a rounded landmass with a beach ring, a raised
 *  grass interior and sand paths carved through it. Deterministic per seed. */
export function generateIsland(seed: string, size = 40): IslandShape {
  const rng = new Rng(seed);
  const cells: TerrainCell[] = [];
  const c = (size - 1) / 2;

  // Wobble the coastline so it does not read as a perfect circle. Shallower
  // than it was, because the notches below now carry the irregularity: a deep
  // lobe on top of them bends the long straight runs the reference's rim is
  // mostly made of, and two kinds of wobble at once read as erosion.
  const lobes = Array.from({ length: 5 }, () => ({
    angle: rng.range(0, Math.PI * 2),
    amp: rng.range(0.02, 0.055),
    freq: rng.int(2, 4),
  }));

  /*
   * Notches.
   *
   * A smooth radius sampled onto a grid gives a staircase, and a staircase is
   * not what the reference has: their rim jogs in and out by exactly one cell
   * every few cells the whole way round, and the same is true of the line where
   * the plaza steps up off the beach. That cell-scale jog is a lot of why their
   * coast reads as carved blocks and a smooth lobe function reads as a shape
   * with anti-aliasing turned off.
   *
   * So the edge carries a second term that is quantised to one whole cell and
   * held CONSTANT over a run of about three of them. The rim and the plaza get
   * their own tables, or the two lines jog together and the beach stays a
   * constant-width ribbon — which is the one thing the reference's never is.
   */
  const bands = Math.max(8, size); // ~3.5 cells of coast each, on a 26 grid
  const notch = (count: number, odds: readonly number[]): number[] =>
    Array.from({ length: count }, () => rng.pick(odds) / c);
  const rimNotch = notch(bands, [0, 0, 0, 1, -1]);
  // The plaza's line jogs over runs twice as long as the rim's. At the rim's
  // pitch it came out as a two-cell sawtooth that chewed the buildable plateau
  // into spits, and a plateau shredded that fine has nowhere left that a grass
  // plot or a building will fit.
  const plazaBands = Math.max(6, Math.round(bands / 2));
  const plazaNotch = notch(plazaBands, [0, 0, 0, 1, -1]);

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dz = (z - c) / c;
      const angle = Math.atan2(dz, dx);
      // Squarish base shape (superellipse) matches the reference silhouette
      // better than a circle — the island reads as a rounded square.
      const r = Math.pow(Math.abs(dx) ** 3.2 + Math.abs(dz) ** 3.2, 1 / 3.2);
      const turn = (angle + Math.PI) / (Math.PI * 2);
      const band = Math.min(bands - 1, Math.floor(turn * bands));
      let edge = 0.86 + rimNotch[band];
      for (const l of lobes) edge += Math.sin(angle * l.freq + l.angle) * l.amp;

      let height = 0;
      const material: Material = 'sand';

      if (r < edge) {
        height = BEACH; // the ring that meets the surf
        // The ring is deeper to the south and west, which is what gives the
        // reference its big open plaza instead of a uniform border.
        const sector =
          0.09 +
          0.10 * (0.5 - Math.cos(angle) * 0.35 - Math.sin(angle) * 0.25) +
          plazaNotch[Math.min(plazaBands - 1, Math.floor(turn * plazaBands))];
        if (r < edge - sector) height = PLATEAU; // the plateau the town sits on
      }

      cells.push({ height, material, buildable: false });
    }
  }

  carveRim(cells, size);
  for (const cell of cells) cell.buildable = cell.height === PLATEAU;
  stampGrassPlots(cells, size, rng);
  return { size, cells };
}

/**
 * Two rules the notched edge above cannot keep on its own, enforced after the
 * fact because they are cheap here and fiddly to bake into the radius.
 *
 * 1. No cell of land hangs off the island by a thread. A notch that lands on a
 *    corner leaves a one-cell spit, and a spit renders as a lone square pillar
 *    standing in the sea.
 * 2. The plaza NEVER touches water. Their island always shows a pale sand rim
 *    between the plaza and the surf; a notch that cut through to the coast put
 *    a three-step cliff straight into the sea, which reads as a quarry, not a
 *    beach.
 */
function carveRim(cells: TerrainCell[], size: number): void {
  const at = (x: number, z: number) =>
    x < 0 || z < 0 || x >= size || z >= size ? null : cells[z * size + x];
  const neighbours = (x: number, z: number) => [at(x - 1, z), at(x + 1, z), at(x, z - 1), at(x, z + 1)];

  // Spits first, so a cell about to be dropped is not also demoting its
  // neighbours to beach on the way out.
  for (let pass = 0; pass < 2; pass++) {
    const drop: number[] = [];
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const cell = at(x, z)!;
        if (cell.height === 0) continue;
        if (neighbours(x, z).filter((n) => n && n.height > 0).length < 2) drop.push(z * size + x);
      }
    }
    if (!drop.length) break;
    for (const i of drop) cells[i].height = 0;
  }

  const demote: number[] = [];
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const cell = at(x, z)!;
      if (cell.height !== PLATEAU) continue;
      if (neighbours(x, z).some((n) => !n || n.height === 0)) demote.push(z * size + x);
    }
  }
  for (const i of demote) cells[i].height = BEACH;
}

/**
 * Stamps grass plots onto the sand plateau.
 *
 * The reference is not a plaza cut by straight avenues — it is a sand surface
 * with rounded grass plots dropped onto it, and the sand between them reads as
 * the paths. Generating it the other way round (carving lanes through grass)
 * produces a ruler-straight cross that nothing in the reference has.
 *
 * This is a PACKER, not a dartboard. Throwing random rectangles at the plateau
 * and keeping the ones that miss is how it used to work, and on a 26-cell
 * island it landed two or three plots out of ten and left the frame almost
 * entirely sand — and worse, the count swung wildly on any change that shifted
 * the random stream by one draw, so the island's green cover was decided by
 * something nobody was looking at. Half of their plateau is green. Sweeping
 * every position for the best fit gets there and stays there.
 */
function stampGrassPlots(cells: TerrainCell[], size: number, rng: Rng): void {
  const idx = (x: number, z: number) => z * size + x;
  const plateau = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < size && z < size && cells[idx(x, z)].buildable;

  // A plot may only cover a cell whose eight neighbours are all plateau too, so
  // every plot keeps a sand margin and never becomes the plateau's own cliff.
  const open = new Uint8Array(size * size);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let ok = 1;
      for (let dz = -1; dz <= 1 && ok; dz++) {
        for (let dx = -1; dx <= 1 && ok; dx++) if (!plateau(x + dx, z + dz)) ok = 0;
      }
      open[idx(x, z)] = ok;
    }
  }

  /** Lane of sand kept between two plots. This is what reads as the paths. */
  const GAP = 2;
  const PLOTS = 14;

  // Down to 4 on a side. The big rectangles go in first and leave strips four
  // and five cells wide behind them; without something small enough to take
  // those strips the packer stops after two plots and calls the plateau full.
  // Four is the floor, not three: the corner clip below takes a cell off each
  // corner, and on a three-wide plot that leaves a plus sign.
  const shapes: Array<[number, number]> = [];
  for (let w = 9; w >= 4; w--) {
    for (let h = 7; h >= 4; h--) shapes.push([w, h]);
  }
  shapes.sort((a, b) => b[0] * b[1] - a[0] * a[1]);

  // Summed-area table over `open`, so testing a rectangle is four lookups
  // rather than fifty — the sweep below tests tens of thousands of them.
  const stride = size + 1;
  const sat = new Int32Array(stride * stride);
  const rebuild = () => {
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        sat[(z + 1) * stride + x + 1] =
          open[idx(x, z)] +
          sat[z * stride + x + 1] +
          sat[(z + 1) * stride + x] -
          sat[z * stride + x];
      }
    }
  };
  const clear = (ox: number, oz: number, w: number, h: number) =>
    sat[(oz + h) * stride + ox + w] -
      sat[oz * stride + ox + w] -
      sat[(oz + h) * stride + ox] +
      sat[oz * stride + ox] ===
    w * h;

  for (let n = 0; n < PLOTS; n++) {
    rebuild();

    // Start the size search a little way down the list so the plots are not all
    // the same rectangle. Largest-first alone tiles the plateau like a
    // spreadsheet; theirs are visibly different sizes.
    const from = rng.int(0, Math.min(4, shapes.length - 1));
    let best: { ox: number; oz: number; w: number; h: number } | null = null;
    let bestScore = -1;

    for (let s = from; s < shapes.length && !best; s++) {
      const [w, h] = shapes[s];
      for (let oz = 0; oz + h <= size; oz++) {
        for (let ox = 0; ox + w <= size; ox++) {
          if (!clear(ox, oz, w, h)) continue;
          // Among the fits, prefer the one backed up hardest against ground it
          // cannot use — the plateau's edge or another plot. Packing to the
          // obstacles is what leaves the leftover sand as LANES between plots
          // instead of as one ragged field with plots adrift in it.
          let contact = 0;
          for (let x = ox - 1; x <= ox + w; x++) {
            if (!open[idx(Math.min(size - 1, Math.max(0, x)), Math.max(0, oz - 1))]) contact++;
            if (!open[idx(Math.min(size - 1, Math.max(0, x)), Math.min(size - 1, oz + h))]) contact++;
          }
          for (let z = oz - 1; z <= oz + h; z++) {
            if (!open[idx(Math.max(0, ox - 1), Math.min(size - 1, Math.max(0, z)))]) contact++;
            if (!open[idx(Math.min(size - 1, ox + w), Math.min(size - 1, Math.max(0, z)))]) contact++;
          }
          if (contact > bestScore) {
            bestScore = contact;
            best = { ox, oz, w, h };
          }
        }
      }
    }
    if (!best) break;

    const { ox, oz, w, h } = best;
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        // Clip the corners so the plot reads as a rounded rectangle.
        const corner = Math.min(x, w - 1 - x) + Math.min(z, h - 1 - z);
        if (corner < 1) continue;
        const cell = cells[idx(ox + x, oz + z)];
        cell.height = PLOT;
        cell.material = 'grass';
      }
    }
    for (let z = oz - GAP; z < oz + h + GAP; z++) {
      for (let x = ox - GAP; x < ox + w + GAP; x++) {
        if (x >= 0 && z >= 0 && x < size && z < size) open[idx(x, z)] = 0;
      }
    }
  }
}

/** Builds the terrain meshes. One merged geometry per material keeps this at a
 *  handful of draw calls no matter how many cells the island has. */
export function buildIslandMesh(shape: IslandShape, seed = 'terrain'): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island';
  const { size, cells } = shape;
  const grain = new Rng(seed);

  // Per-cell albedo jitter.
  //
  // Sized off the reference rather than off taste, because the previous
  // strength was an order of magnitude too high and the grass came out as a
  // checkerboard. Counted over a patch of their grass the whole spread is
  // #90b43e..#a2be5b — about ±2% of value — and their sand is tighter still,
  // ±1%. Their walls are the loose ones, dithered across ±10%. So the tops get
  // almost nothing and the walls keep their grain, which is also the right way
  // round for us: one of our cells is 22 screen pixels, so anything the top
  // face does reads as a visible tile, while a wall band is 3 pixels tall and
  // reads as texture.
  //
  // The slow drift only applies where the strength is loose enough to carry it;
  // on a top face it was the source of the blotching, not of variation.
  const jitter = (colour: number, x: number, z: number, strength: number, drift = 0): number => {
    const fine = grain.range(-1, 1) * strength;
    const slow = Math.sin(x * 0.37 + z * 0.21) * 0.5 + Math.sin(x * 0.11 - z * 0.29) * 0.5;
    const k = 1 + fine + slow * drift;
    const r = Math.min(255, Math.max(0, Math.round(((colour >> 16) & 0xff) * k)));
    const g = Math.min(255, Math.max(0, Math.round(((colour >> 8) & 0xff) * k)));
    const b = Math.min(255, Math.max(0, Math.round((colour & 0xff) * k)));
    return (r << 16) | (g << 8) | b;
  };
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= size || z >= size ? null : cells[z * size + x]);

  const byMaterial = new Map<Material, { positions: number[]; normals: number[]; colours: number[] }>();
  const tint = new THREE.Color();
  const push = (mat: Material, verts: number[], normal: [number, number, number], colour: number) => {
    let entry = byMaterial.get(mat);
    if (!entry) byMaterial.set(mat, (entry = { positions: [], normals: [], colours: [] }));
    entry.positions.push(...verts);
    tint.setHex(colour, THREE.SRGBColorSpace);
    for (let i = 0; i < verts.length / 3; i++) {
      entry.normals.push(...normal);
      entry.colours.push(tint.r, tint.g, tint.b);
    }
  };

  const half = (size * CELL) / 2;
  const quad = (
    mat: Material,
    p: [number, number, number][],
    normal: [number, number, number],
    colour = PALETTE[mat]
  ) => {
    const [a, b, c, d] = p;
    push(mat, [...a, ...b, ...c, ...a, ...c, ...d], normal, colour);
  };

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const cell = cells[z * size + x];
      if (cell.height <= 0) continue;

      const x0 = x * CELL - half;
      const x1 = x0 + CELL;
      const z0 = z * CELL - half;
      const z1 = z0 + CELL;
      const y = cell.height * STEP;

      // Top face. The beach ring is its own shade of sand — see SAND_BEACH.
      const isBeach = cell.material === 'sand' && cell.height <= BEACH;
      const topAlbedo = isBeach ? SAND_BEACH : PALETTE[cell.material];
      const topStrength = cell.material === 'grass' ? 0.022 : 0.01;
      quad(cell.material, [
        [x0, y, z0],
        [x0, y, z1],
        [x1, y, z1],
        [x1, y, z0],
      ], [0, 1, 0], jitter(topAlbedo, x, z, topStrength));

      // Side walls, only where the neighbour is lower — the exposed dirt/sand
      // cliffs that give the island its stepped silhouette.
      const sides: Array<{ n: TerrainCell | null; verts: (yTop: number, yBot: number) => [number, number, number][]; normal: [number, number, number] }> = [
        {
          n: at(x, z - 1),
          verts: (t, b) => [[x0, t, z0], [x1, t, z0], [x1, b, z0], [x0, b, z0]],
          normal: [0, 0, -1],
        },
        {
          n: at(x, z + 1),
          verts: (t, b) => [[x1, t, z1], [x0, t, z1], [x0, b, z1], [x1, b, z1]],
          normal: [0, 0, 1],
        },
        {
          n: at(x - 1, z),
          verts: (t, b) => [[x0, t, z1], [x0, t, z0], [x0, b, z0], [x0, b, z1]],
          normal: [-1, 0, 0],
        },
        {
          n: at(x + 1, z),
          verts: (t, b) => [[x1, t, z0], [x1, t, z1], [x1, b, z1], [x1, b, z0]],
          normal: [1, 0, 0],
        },
      ];

      for (const side of sides) {
        const neighbourHeight = side.n ? side.n.height : 0;
        if (neighbourHeight >= cell.height) continue;
        // A wall that drops all the way to the water carries on below it, so
        // the sea never cuts in under the island.
        const coastal = neighbourHeight <= 0;
        const yBottom = Math.max(0, neighbourHeight) * STEP - (coastal ? SKIRT : 0);

        // +x faces screen right, into the sun; +z faces screen left, away from
        // it. The other two are behind the block and never drawn, but they are
        // given the shaded variant anyway so a camera swung off the diagonal
        // finds the ramp already there instead of a flat island.
        const skin = wallSkin(cell.material);
        const lit = side.normal[0] > 0;

        // Lip on top, body under it — the two-part edge that makes a step read
        // as a carved block. Clamped so a wall shorter than its own lip is all
        // lip rather than lip hanging past the bottom of the wall.
        const lipBottom = Math.max(yBottom, y - skin.lip * STEP);
        quad(
          'dirt',
          side.verts(y, lipBottom),
          side.normal,
          jitter(lit ? skin.lipSun : skin.lipShade, x, z, 0.03)
        );
        if (lipBottom > yBottom + 1e-4) {
          quad(
            'dirt',
            side.verts(lipBottom, yBottom),
            side.normal,
            jitter(lit ? skin.bodySun : skin.bodyShade, x, z, 0.05, 0.035)
          );
        }
      }
    }
  }

  for (const [mat, data] of byMaterial) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colours, 3));
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `terrain_${mat}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}

/**
 * Bakes the distance from every point to the nearest land into a texture, in
 * world units, normalized against `range`.
 *
 * The water shader keys its depth bands and its foam density off true shoreline
 * distance. An earlier version blurred island coverage instead, which produced
 * visible contour rings — blurred coverage is not distance, and the difference
 * shows up immediately as banding that follows the blur kernel rather than the
 * coast.
 */
export function buildShoreSDF(shape: IslandShape, range = 8, resolution = 256): THREE.DataTexture {
  const { size, cells } = shape;
  const worldSize = size * CELL;
  const texelWorld = worldSize / resolution;
  const INF = 1e9;
  const dist = new Float32Array(resolution * resolution).fill(INF);

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const gx = Math.min(size - 1, Math.floor((x / resolution) * size));
      const gz = Math.min(size - 1, Math.floor((y / resolution) * size));
      if (cells[gz * size + gx].height > 0) dist[y * resolution + x] = 0;
    }
  }

  // Chamfer distance transform: two sweeps with a 3x3 mask approximate Euclidean
  // distance closely enough, and cost a fraction of an exact transform.
  const D1 = texelWorld;
  const D2 = texelWorld * Math.SQRT2;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= resolution || y >= resolution ? INF : dist[y * resolution + x]);

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const i = y * resolution + x;
      dist[i] = Math.min(
        dist[i],
        at(x - 1, y) + D1, at(x, y - 1) + D1,
        at(x - 1, y - 1) + D2, at(x + 1, y - 1) + D2
      );
    }
  }
  for (let y = resolution - 1; y >= 0; y--) {
    for (let x = resolution - 1; x >= 0; x--) {
      const i = y * resolution + x;
      dist[i] = Math.min(
        dist[i],
        at(x + 1, y) + D1, at(x, y + 1) + D1,
        at(x + 1, y + 1) + D2, at(x - 1, y + 1) + D2
      );
    }
  }

  const data = new Uint8Array(resolution * resolution * 4);
  for (let i = 0; i < dist.length; i++) {
    const v = Math.round(Math.min(1, dist[i] / range) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/** The grid cell a world-space point falls in. Inverse of `cellToWorld`. */
export function worldToCell(shape: IslandShape, wx: number, wz: number): { x: number; z: number } {
  const half = (shape.size * CELL) / 2;
  return {
    x: Math.round((wx + half - CELL / 2) / CELL),
    z: Math.round((wz + half - CELL / 2) / CELL),
  };
}

/** Whether a cell exists and is part of the buildable plateau. */
export function isBuildable(shape: IslandShape, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= shape.size || z >= shape.size) return false;
  return shape.cells[z * shape.size + x].buildable;
}

/** World-space position of the centre-top of a grid cell. */
export function cellToWorld(shape: IslandShape, x: number, z: number): THREE.Vector3 {
  const half = (shape.size * CELL) / 2;
  const cell = shape.cells[z * shape.size + x];
  return new THREE.Vector3(
    x * CELL - half + CELL / 2,
    (cell?.height ?? 0) * STEP,
    z * CELL - half + CELL / 2
  );
}

export { STEP, PALETTE };
