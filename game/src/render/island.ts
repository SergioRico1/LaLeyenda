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

const PALETTE: Record<Material, number> = {
  sand: 0xf2e4c0,
  grass: 0x6fbf3f,
  dirt: 0x9a6b3f,
  rock: 0x9aa3a8,
  path: 0xe4d3a8,
};

const STEP = 0.34; // world height of one terrain step

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
        height = 1; // beach
        if (r < edge - 0.14) {
          height = 2; // raised interior
          material = 'grass';
          buildable = true;
        }
        if (r < edge - 0.52 && rng.chance(0.1)) {
          height = 3; // occasional higher shelf
          material = 'grass';
        }
      }

      cells.push({ height, material, buildable });
    }
  }

  carvePaths(cells, size, rng);
  return { size, cells };
}

/** Sand paths crossing the island, like the reference's walkways between plots. */
function carvePaths(cells: TerrainCell[], size: number, rng: Rng): void {
  const at = (x: number, z: number) => cells[z * size + x];
  const inBounds = (x: number, z: number) => x >= 0 && z >= 0 && x < size && z < size;

  const lanes = [
    { axis: 'x' as const, at: Math.round(size * rng.range(0.34, 0.42)) },
    { axis: 'x' as const, at: Math.round(size * rng.range(0.62, 0.7)) },
    { axis: 'z' as const, at: Math.round(size * rng.range(0.44, 0.56)) },
  ];

  for (const lane of lanes) {
    const width = rng.int(2, 3);
    for (let i = 0; i < size; i++) {
      for (let w = 0; w < width; w++) {
        const x = lane.axis === 'x' ? lane.at + w : i;
        const z = lane.axis === 'x' ? i : lane.at + w;
        if (!inBounds(x, z)) continue;
        const cell = at(x, z);
        if (cell.height >= 2) {
          cell.material = 'path';
          cell.buildable = false;
        }
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

  const byMaterial = new Map<Material, { positions: number[]; normals: number[] }>();
  const push = (mat: Material, verts: number[], normal: [number, number, number]) => {
    let entry = byMaterial.get(mat);
    if (!entry) byMaterial.set(mat, (entry = { positions: [], normals: [] }));
    entry.positions.push(...verts);
    for (let i = 0; i < verts.length / 3; i++) entry.normals.push(...normal);
  };

  const half = (size * CELL) / 2;
  const quad = (
    mat: Material,
    p: [number, number, number][],
    normal: [number, number, number]
  ) => {
    const [a, b, c, d] = p;
    push(mat, [...a, ...b, ...c, ...a, ...c, ...d], normal);
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
        // Grass sits on dirt; sand cliffs stay sand.
        const wallMat: Material = cell.material === 'grass' || cell.material === 'path' ? 'dirt' : 'sand';
        quad(wallMat, side.verts(y, yBottom - (neighbourHeight === 0 ? 0.6 : 0)), side.normal);
      }
    }
  }

  for (const [mat, data] of byMaterial) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    const material = new THREE.MeshLambertMaterial({ color: PALETTE[mat] });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `terrain_${mat}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}

/** Renders island coverage into a texture the water shader samples to know where
 *  the shore is. Blurred so the shallow bands fade outward from the coastline. */
export function buildDepthMask(shape: IslandShape, resolution = 128): THREE.DataTexture {
  const { size, cells } = shape;
  const raw = new Float32Array(resolution * resolution);

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const gx = Math.min(size - 1, Math.floor((x / resolution) * size));
      const gz = Math.min(size - 1, Math.floor((y / resolution) * size));
      raw[y * resolution + x] = cells[gz * size + gx].height > 0 ? 1 : 0;
    }
  }

  // Separable box blur, a few passes — cheap approximation of a distance field.
  const blurred = new Float32Array(raw);
  const tmp = new Float32Array(raw.length);
  const radius = Math.max(2, Math.round(resolution / 24));
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = x + k;
          if (sx < 0 || sx >= resolution) continue;
          sum += blurred[y * resolution + sx];
          n++;
        }
        tmp[y * resolution + x] = sum / n;
      }
    }
    for (let x = 0; x < resolution; x++) {
      for (let y = 0; y < resolution; y++) {
        let sum = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const sy = y + k;
          if (sy < 0 || sy >= resolution) continue;
          sum += tmp[sy * resolution + x];
          n++;
        }
        blurred[y * resolution + x] = sum / n;
      }
    }
  }

  const data = new Uint8Array(resolution * resolution * 4);
  for (let i = 0; i < blurred.length; i++) {
    const v = Math.round(Math.min(1, blurred[i]) * 255);
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
