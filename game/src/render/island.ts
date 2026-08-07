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

// Albedos sampled off the reference. The paths are barely distinguishable from
// the sand there, and the grass is far more olive than a naive bright green.
const PALETTE: Record<Material, number> = {
  sand: 0xe2d8bc,
  grass: 0x95b944,
  dirt: 0xd9a060,
  rock: 0x9aa3a8,
  path: 0xe3d7b8,
};

// Sun-facing and shaded variants for the vertical walls. Baking the face ramp
// into vertex colours is what stops the terraces reading as a flat decal.
const WALL_TERRACE_SUN = 0xd9a060;
const WALL_TERRACE_SHADE = 0x926532;
const WALL_CLIFF_SUN = 0xe0b082;
const WALL_CLIFF_SHADE = 0x97785e;

const STEP = 0.66; // world height of one terrain step

/** Generates the home island: a rounded landmass with a beach ring, a raised
 *  grass interior and sand paths carved through it. Deterministic per seed. */
export function generateIsland(seed: string, size = 40): IslandShape {
  const rng = new Rng(seed);
  const cells: TerrainCell[] = [];
  const c = (size - 1) / 2;

  // Wobble the coastline so it does not read as a perfect circle.
  const lobes = Array.from({ length: 5 }, () => ({
    angle: rng.range(0, Math.PI * 2),
    amp: rng.range(0.04, 0.11),
    freq: rng.int(2, 4),
  }));

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dz = (z - c) / c;
      const angle = Math.atan2(dz, dx);
      // Squarish base shape (superellipse) matches the reference silhouette
      // better than a circle — the island reads as a rounded square.
      const r = Math.pow(Math.abs(dx) ** 3.2 + Math.abs(dz) ** 3.2, 1 / 3.2);
      let edge = 0.86;
      for (const l of lobes) edge += Math.sin(angle * l.freq + l.angle) * l.amp;

      let height = 0;
      let material: Material = 'sand';
      let buildable = false;

      if (r < edge) {
        height = 1; // beach ring, at the waterline
        // The ring is deeper to the south and west, which is what gives the
        // reference its big open plaza instead of a uniform border.
        const sector = 0.09 + 0.10 * (0.5 - Math.cos(angle) * 0.35 - Math.sin(angle) * 0.25);
        if (r < edge - sector) {
          height = 2; // the plateau the town sits on
          buildable = true;
        }
      }

      cells.push({ height, material, buildable });
    }
  }

  stampGrassPlots(cells, size, rng);
  return { size, cells };
}

/**
 * Stamps grass plots onto the sand plateau.
 *
 * The reference is not a plaza cut by straight avenues — it is a sand surface
 * with rounded grass plots dropped onto it, and the sand between them reads as
 * the paths. Generating it the other way round (carving lanes through grass)
 * produces a ruler-straight cross that nothing in the reference has.
 */
function stampGrassPlots(cells: TerrainCell[], size: number, rng: Rng): void {
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < size && z < size;
  const plots = 7;

  const taken: Array<{ x: number; z: number; w: number; h: number }> = [];

  for (let attempt = 0; attempt < 60 && taken.length < plots; attempt++) {
    const w = rng.int(5, 8);
    const h = rng.int(4, 6);
    const ox = rng.int(2, Math.max(3, size - w - 2));
    const oz = rng.int(2, Math.max(3, size - h - 2));

    // Keep a lane of sand between plots — that sand is what reads as the paths.
    const clash = taken.some(
      (t) => ox < t.x + t.w + 2 && ox + w + 2 > t.x && oz < t.z + t.h + 2 && oz + h + 2 > t.z
    );
    if (clash) continue;

    // Every cell of the footprint must be on the plateau, so plots never spill
    // onto the beach or hang off the coast.
    let fits = true;
    for (let z = 0; z < h && fits; z++) {
      for (let x = 0; x < w && fits; x++) {
        const gx = ox + x;
        const gz = oz + z;
        if (!inside(gx, gz) || !cells[gz * size + gx].buildable) fits = false;
      }
    }
    if (!fits) continue;

    taken.push({ x: ox, z: oz, w, h });
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        // Clip the corners so the plot reads as a rounded rectangle.
        const corner = Math.min(x, w - 1 - x) + Math.min(z, h - 1 - z);
        if (corner < 1) continue;
        const cell = cells[(oz + z) * size + (ox + x)];
        cell.height = 3;
        cell.material = 'grass';
      }
    }
  }
}

/** Builds the terrain meshes. One merged geometry per material keeps this at a
 *  handful of draw calls no matter how many cells the island has. */
export function buildIslandMesh(shape: IslandShape): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island';
  const { size, cells } = shape;
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

      // Top face
      quad(cell.material, [
        [x0, y, z0],
        [x0, y, z1],
        [x1, y, z1],
        [x1, y, z0],
      ], [0, 1, 0]);

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
        const yBottom = Math.max(0, neighbourHeight) * STEP;
        // A wall that drops all the way to the water is a coastal cliff; one
        // between two land levels is a terrace. They are different colours in
        // the reference, and the coastal brown is what separates the island
        // silhouette from the sea.
        const coastal = neighbourHeight === 0;
        // The sun sits to the +x/+z side, so those faces catch light and the
        // opposite ones fall into shade.
        const lit = side.normal[0] > 0 || side.normal[2] > 0;
        const colour = coastal
          ? (lit ? WALL_CLIFF_SUN : WALL_CLIFF_SHADE)
          : (lit ? WALL_TERRACE_SUN : WALL_TERRACE_SHADE);
        quad('dirt', side.verts(y, yBottom - (coastal ? 0.6 : 0)), side.normal, colour);
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
