import * as THREE from 'three';
import { Stage } from '../render/stage';
import { Water } from '../render/water';
import { generateIsland, buildIslandMesh, buildShoreSDF, cellToWorld, STEP, CELL } from '../render/island';
import { instantiate, preload } from '../render/assets';
import { Rng } from '../core/rng';

/** The home island: the builder scene, seen from the Clash-of-Clans style camera. */

interface Placement {
  model: string;
  x: number;
  z: number;
  footprint: number;
  clip?: string;
}

const BUILDINGS: Placement[] = [
  { model: 'bldg_townhall', x: 13, z: 11, footprint: 6, clip: 'idle' },
  { model: 'bldg_marketplace', x: 18, z: 9, footprint: 5, clip: 'idle' },
  { model: 'bldg_foundry', x: 19, z: 14, footprint: 5, clip: 'idle' },
  { model: 'bldg_distillery', x: 8, z: 14, footprint: 5 },
  { model: 'bldg_shipwright', x: 9, z: 18, footprint: 5 },
  { model: 'bldg_docks', x: 22, z: 18, footprint: 7, clip: 'idle' },
  { model: 'bldg_bank', x: 14, z: 17, footprint: 4 },
  { model: 'bldg_tikibar', x: 16, z: 20, footprint: 4 },
  { model: 'bldg_windmill', x: 8, z: 9, footprint: 5, clip: 'idle' },
  { model: 'bldg_workshop', x: 13, z: 7, footprint: 5, clip: 'idle' },
];

export const ISLAND_MODELS = [
  ...BUILDINGS.map((b) => b.model),
  'tree_palm', 'tree_palm_tall', 'deco_bush', 'deco_fern', 'ship_skiff', 'chest_bandit',
];

export interface IslandScene {
  update(dt: number, elapsed: number): void;
}

export async function createIslandScene(stage: Stage, seed = 'la-leyenda'): Promise<IslandScene> {
  const shape = generateIsland(seed, 26);
  const rng = new Rng(`${seed}:decor`);
  const mixers: THREE.AnimationMixer[] = [];

  const terrain = buildIslandMesh(shape, `${seed}:grain`);
  stage.scene.add(terrain);

  const islandWorldSize = shape.size * CELL;
  const SDF_RANGE = 10;
  const water = new Water({
    size: 420,
    // One water cell is about a fifth of a terrain block in the reference.
    cell: CELL * 0.2,
    palette: 'lagoon',
    shoreSDF: buildShoreSDF(shape, SDF_RANGE),
    sdfOrigin: new THREE.Vector2(-islandWorldSize / 2, -islandWorldSize / 2),
    sdfSize: islandWorldSize,
    sdfRange: SDF_RANGE,
  });
  water.mesh.position.y = STEP * 0.82; // waterline just below the beach top
  stage.scene.add(water.mesh);

  // ?parts=terrain,buildings,decor,ship narrows what gets built, so a problem
  // can be isolated to one category without editing code.
  const partsParam = new URLSearchParams(location.search).get('parts');
  const parts = new Set((partsParam ?? 'terrain,buildings,decor,ship').split(','));
  const bare = !parts.has('buildings') && !parts.has('decor') && !parts.has('ship');

  if (!bare) await preload(ISLAND_MODELS);

  const place = async (p: Placement) => {
    const inst = await instantiate(p.model, { fit: p.footprint * CELL, clip: p.clip });
    const pos = cellToWorld(shape, p.x, p.z);
    inst.object.position.x += pos.x;
    inst.object.position.z += pos.z;
    inst.object.position.y += pos.y;
    inst.object.rotation.y = rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    stage.scene.add(inst.object);
    if (inst.mixer) mixers.push(inst.mixer);
    const box = new THREE.Box3().setFromObject(inst.object);
    const size = box.getSize(new THREE.Vector3());
    console.log(
      `[place] ${p.model.padEnd(18)} size ${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)}` +
      ` at ${inst.object.position.x.toFixed(1)},${inst.object.position.y.toFixed(1)},${inst.object.position.z.toFixed(1)}`
    );
    return inst;
  };

  if (parts.has('buildings')) for (const b of BUILDINGS) await place(b);

  // Palms and undergrowth on any free grass, thickest around the coast.
  const decorSlots: Array<{ x: number; z: number }> = [];
  for (let z = 0; z < shape.size; z++) {
    for (let x = 0; x < shape.size; x++) {
      const cell = shape.cells[z * shape.size + x];
      if (!cell.buildable) continue;
      const nearBuilding = BUILDINGS.some(
        (b) => Math.abs(b.x - x) < b.footprint * 0.8 && Math.abs(b.z - z) < b.footprint * 0.8
      );
      if (!nearBuilding) decorSlots.push({ x, z });
    }
  }

  for (const slot of parts.has('decor') ? decorSlots : []) {
    if (!rng.chance(0.09)) continue;
    const model = rng.pick(['tree_palm', 'tree_palm_tall', 'deco_bush', 'deco_fern'] as const);
    const footprint = model.startsWith('tree') ? rng.range(3.2, 4.4) : rng.range(1.2, 1.8);
    const inst = await instantiate(model, { fit: footprint });
    const pos = cellToWorld(shape, slot.x, slot.z);
    inst.object.position.x += pos.x + rng.range(-0.3, 0.3);
    inst.object.position.z += pos.z + rng.range(-0.3, 0.3);
    inst.object.position.y += pos.y;
    inst.object.rotation.y = rng.range(0, Math.PI * 2);
    stage.scene.add(inst.object);
    if (inst.mixer) mixers.push(inst.mixer);
  }

  // The player's ship, moored off the dock.
  if (parts.has('ship')) {
    const ship = await instantiate('ship_skiff', { fit: 5, clip: 'Idle' });
    ship.object.position.set(-17, STEP * 0.85, 9);
    ship.object.rotation.y = -0.5;
    stage.scene.add(ship.object);
    if (ship.mixer) mixers.push(ship.mixer);
  }

  // Camera: high angled view looking down at the island, like the reference.
  // `?cam=x,y,z` overrides it so shots can be framed without editing code.
  const target = new THREE.Vector3(0, 0, 0);
  const camParam = new URLSearchParams(location.search).get('cam');
  const camPos = camParam
    ? (camParam.split(',').map(Number) as [number, number, number])
    : ([26, 29, 32] as [number, number, number]);
  stage.camera.position.set(camPos[0], camPos[1], camPos[2]);
  stage.camera.lookAt(target);
  stage.sun.target.position.copy(target);
  stage.sun.target.updateMatrixWorld();

  {
    const terrainBox = new THREE.Box3().setFromObject(terrain);
    const ts = terrainBox.getSize(new THREE.Vector3());
    console.log(`[scene] terrain ${ts.x.toFixed(1)}x${ts.y.toFixed(1)}x${ts.z.toFixed(1)}`);
    console.log(`[scene] camera ${stage.camera.position.toArray().map((v) => v.toFixed(1)).join(',')} fov ${stage.camera.fov}`);
    let worst = { name: '', span: 0 };
    for (const child of stage.scene.children) {
      const b = new THREE.Box3().setFromObject(child);
      const s = b.getSize(new THREE.Vector3());
      const span = Math.max(s.x, s.y, s.z);
      if (Number.isFinite(span) && span > worst.span) worst = { name: child.name || child.type, span };
    }
    console.log(`[scene] largest object: ${worst.name} span ${worst.span.toFixed(1)}`);
  }

  return {
    update(dt, elapsed) {
      water.update(elapsed, stage.camera);
      for (const m of mixers) m.update(dt);
    },
  };
}
