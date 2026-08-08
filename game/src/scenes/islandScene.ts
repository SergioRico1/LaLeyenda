import * as THREE from 'three';
import { Stage } from '../render/stage';
import { Water } from '../render/water';
import {
  generateIsland, buildIslandMesh, buildShoreSDF, cellToWorld, worldToCell, STEP, CELL,
  type IslandShape,
} from '../render/island';
import { createGhost, type Ghost } from '../render/ghost';
import { instantiate, preload } from '../render/assets';
import { Rng } from '../core/rng';
import { createGame, type Game } from '../core/game';
import {
  BALANCE, buildingSpec, claimDaily, claimFreeChest, claimQuest, collect, collectAll, finishNow,
  levelSpec, openChest, place, placeRefusal, questComplete, spotRefusal, startChest, startUpgrade,
  townHallLevel, type GameState, type Refusal,
} from '../sim';
import { createHud, type Hud, type ResourceId } from '../ui/hud';
import { bakeIcons, bakeModelIcons, type IconSet } from '../ui/icons';
import { buildingIdOf, toBuildOptions, toHudState, toUpgradeView, toWorldItems } from '../ui/present';
import { createBuildPicker } from '../ui/panels/buildPicker';
import { createUpgradeSheet } from '../ui/panels/upgradeSheet';
import { createBuildBar } from '../ui/panels/buildBar';
import type { RefusalKey } from '../ui/copy';

/** The home island: the builder scene, seen from the Clash-of-Clans style camera.
 *
 *  The island layout is **data, not scene** (PLAN.md's third multiplayer rule):
 *  everything below is built from `game.state().buildings`, so attacking someone
 *  else's island would one day be loading their JSON instead of yours. */

const DECOR = ['tree_palm', 'tree_palm_tall', 'deco_bush', 'deco_fern'] as const;

/** Every model the island can need, so preload() gets one pass. */
export const ISLAND_MODELS = [
  ...new Set(Object.values(BALANCE.buildings).map((b) => b.model)),
  ...DECOR, 'ship_skiff', 'chest_bandit',
];

export interface IslandScene {
  update(dt: number, elapsed: number): void;
}

/** A screenshot must be byte-identical between runs, so under `?shot=1` the
 *  sim clock is frozen here instead of reading the wall clock. */
const SHOT_EPOCH = Date.UTC(2026, 0, 5, 12, 0, 0);

export async function createIslandScene(stage: Stage, seed = 'la-leyenda'): Promise<IslandScene> {
  const params = new URLSearchParams(location.search);
  const shot = params.get('shot') === '1';

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

  /* --- the simulation ---------------------------------------------------- */

  let sceneElapsed = 0;
  // §4.10's island is the DEFAULT boot. `?save=demo` is the only route to the
  // Ayuntamiento-4 fixture, which exists to frame shots and exercise the
  // late-game HUD — it is not a game anyone starts.
  const saveParam = params.get('save');
  const game: Game = await createGame({
    seed,
    persist: !shot,
    start: saveParam === 'demo' ? 'demo' : saveParam === 'new' ? 'new' : 'stored',
    clock: shot ? () => SHOT_EPOCH + sceneElapsed * 1000 : undefined,
  });

  // ?parts=terrain,buildings,decor,ship narrows what gets built, so a problem
  // can be isolated to one category without editing code.
  const partsParam = params.get('parts');
  const parts = new Set((partsParam ?? 'terrain,buildings,decor,ship').split(','));
  const bare = !parts.has('buildings') && !parts.has('decor') && !parts.has('ship');

  if (!bare) await preload(ISLAND_MODELS);

  /* --- buildings, placed from the save ----------------------------------- */

  const bldgRng = new Rng(`${seed}:bldg`);
  /** Grid cell → world position, per building id. World-anchored HUD hangs off
   *  the GRID, not off a model's bounding box, so it stays correct however the
   *  model itself ends up normalized. */
  const anchorFor = new Map<number, THREE.Vector3>();
  /** What a tap on the island can hit — §3.16's route into the upgrade sheet. */
  const pickable: THREE.Object3D[] = [];

  const placeBuilding = async (b: GameState['buildings'][number]) => {
    const spec = buildingSpec(b.type);
    const cell = spec.waterfront ? { x: b.x, z: b.z } : snapToBuildable(shape, b.x, b.z, b.type);
    const inst = await instantiate(spec.model, { fit: spec.footprint * CELL, clip: 'idle' });
    const pos = cellToWorld(shape, cell.x, cell.z);
    inst.object.position.x += pos.x;
    inst.object.position.z += pos.z;
    inst.object.position.y += pos.y;
    inst.object.rotation.y = bldgRng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    inst.object.userData.buildingId = b.id;
    stage.scene.add(inst.object);
    pickable.push(inst.object);
    if (inst.mixer) mixers.push(inst.mixer);
    anchorFor.set(b.id, new THREE.Vector3(pos.x, pos.y, pos.z));

    const size = new THREE.Box3().setFromObject(inst.object).getSize(new THREE.Vector3());
    console.log(
      `[place] ${spec.model.padEnd(18)} size ${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)}` +
      ` at ${inst.object.position.x.toFixed(1)},${inst.object.position.y.toFixed(1)},${inst.object.position.z.toFixed(1)}` +
      ` (${b.type} Nv${b.level}, footprint ${spec.footprint})`
    );
  };

  const placed = new Set<number>();
  async function syncBuildings(): Promise<void> {
    if (!parts.has('buildings')) return;
    for (const b of game.state().buildings) {
      if (placed.has(b.id)) continue;
      placed.add(b.id);
      await placeBuilding(b);
    }
  }
  await syncBuildings();

  // Palms and undergrowth on any free grass, thickest around the coast.
  const decorSlots: Array<{ x: number; z: number }> = [];
  const occupied = game.state().buildings.map((b) => ({ ...b, footprint: buildingSpec(b.type).footprint }));
  for (let z = 0; z < shape.size; z++) {
    for (let x = 0; x < shape.size; x++) {
      const cell = shape.cells[z * shape.size + x];
      if (!cell.buildable) continue;
      const nearBuilding = occupied.some(
        (b) => Math.abs(b.x - x) < b.footprint * 0.8 && Math.abs(b.z - z) < b.footprint * 0.8
      );
      if (!nearBuilding) decorSlots.push({ x, z });
    }
  }

  for (const slot of parts.has('decor') ? decorSlots : []) {
    if (!rng.chance(0.09)) continue;
    const model = rng.pick(DECOR);
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
  const camParam = params.get('cam');
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
      const size = b.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z);
      if (Number.isFinite(span) && span > worst.span) worst = { name: child.name || child.type, span };
    }
    console.log(`[scene] largest object: ${worst.name} span ${worst.span.toFixed(1)}`);
  }

  /* --- HUD --------------------------------------------------------------- */
  // Declared before createHud, which syncs on the way in.
  let anchors = toWorldItems(game.state(), game.now());

  // `?hud=0` drops the overlay entirely, so the world can be judged on its own
  // pixels without chrome in the frame.
  const hudEnabled = params.get('hud') !== '0';
  const uiRoot = document.getElementById('ui');

  let hud: Hud | null = null;
  if (hudEnabled && uiRoot) {
    hud = await createHud(uiRoot, stage.renderer, toHudState(game.state(), game.now()), {
      // The one interaction the whole loop hangs off: a tap on a ready bubble
      // moves the producer's stock into the store (§4.2), and the number flies.
      onCollect(worldItemId) {
        const id = buildingIdOf(worldItemId);
        if (id === null) return 0;
        return game.dispatch((s) => collect(s, id)).amount;
      },
      onCollectAll() {
        game.dispatch((s) => collectAll(s));
      },
      onOpen: route,
    });
    syncHud();
  }

  /** Re-derived on every sim step and projected each frame from the cache: the
   *  anchors only move when the state does. */
  function syncHud(): void {
    if (!hud) return;
    anchors = toWorldItems(game.state(), game.now());
    hud.setState(toHudState(game.state(), game.now()));
    hud.setWorldItems(anchors.map((a) => a.item));
  }

  game.onChange(() => { if (hud) hud.setState(toHudState(game.state(), game.now())); });

  /* --- §3.15 build mode + §3.16 the upgrade sheet ------------------------- */

  // The picker rows and the sheet header show the building being discussed, so
  // the models are baked into icons through the same rig as the HUD's. Both
  // bakes are memoized, so asking again here costs nothing.
  const modelIcons = uiRoot && !bare
    ? await bakeModelIcons(stage.renderer, [...new Set(Object.values(BALANCE.buildings).map((b) => b.model))], 56)
    : {};
  const iconSet: IconSet = uiRoot ? await bakeIcons(stage.renderer) : {};

  const ghost: Ghost = createGhost(shape);
  stage.scene.add(ghost.object);

  /** Non-null only while a placement is in progress. */
  let placing: { type: string; footprint: number } | null = null;

  const picker = uiRoot ? createBuildPicker({
    icons: iconSet,
    onPick: (type) => void beginPlacement(type),
  }) : null;

  const sheet = uiRoot ? createUpgradeSheet({
    icons: iconSet,
    onUpgrade: (id) => {
      const result = game.dispatch((s) => startUpgrade(s, id, game.now()));
      if (result.ok) { sheet!.close(); void syncBuildings(); }
      else refreshSheet();
    },
    onFinishNow: (id) => {
      const result = game.dispatch((s) => finishNow(s, id, game.now()));
      if (result.ok) { sheet!.close(); void syncBuildings(); }
      else refreshSheet();
    },
  }) : null;

  const bar = uiRoot ? createBuildBar({
    icons: iconSet,
    onConfirm: confirmPlacement,
    onCancel: endPlacement,
  }) : null;

  if (uiRoot) {
    if (picker) uiRoot.append(picker.el);
    if (sheet) uiRoot.append(sheet.el);
    if (bar) uiRoot.append(bar.el);
  }

  async function beginPlacement(type: string): Promise<void> {
    const spec = buildingSpec(type);
    placing = { type, footprint: spec.footprint };
    // Start under the middle of the island rather than at 0,0, so the first
    // frame of the ghost is somewhere plausible even before a finger moves.
    moveGhost(Math.floor(shape.size / 2), Math.floor(shape.size / 2));
    ghost.show(true);
    bar?.show({ label: spec.label, cost: levelSpec(type, 1).cost, timeMs: levelSpec(type, 1).timeMs });
    await ghost.setModel(spec.model, spec.footprint);
    refreshPlacement();
  }

  function endPlacement(): void {
    placing = null;
    ghost.show(false);
    bar?.hide();
  }

  /**
   * Where the sim and the terrain each answer the half they own.
   *
   * The sim knows about builders, cost, counts and whether another building's
   * plot is in the way. It knows nothing about the coastline — the island shape
   * is generated per seed in render/island.ts and never enters the save — so
   * buildable ground is the ghost's answer. Both have to be green.
   */
  function placementRefusal(): Refusal | null {
    if (!placing) return null;
    const state = game.state();
    const now = game.now();
    return placeRefusal(state, placing.type, now)
      ?? spotRefusal(state, placing.type, ghost.cell.x, ghost.cell.z)
      ?? (ghost.valid ? null : 'cell-occupied');
  }

  function moveGhost(x: number, z: number): void {
    if (!placing) return;
    const blocked = spotRefusal(game.state(), placing.type, x, z) !== null;
    const before = ghost.cell;
    ghost.setCell(x, z, blocked);
    // §3.15's haptics: a tick on crossing each cell, a distinct double tick on
    // entering an invalid one.
    if (before.x !== x || before.z !== z) {
      navigator.vibrate?.(ghost.valid && !blocked ? 6 : [12, 40, 12]);
    }
  }

  function refreshPlacement(): void {
    if (!placing || !bar) return;
    const refusal = placementRefusal();
    bar.setValid(refusal === null, refusal as RefusalKey | null, buildingSpec(placing.type).unlockAtTownHall);
  }

  function confirmPlacement(): void {
    if (!placing) return;
    const { x, z } = ghost.cell;
    const result = game.dispatch((s) => place(s, placing!.type, x, z, game.now()));
    if (!result.ok) { refreshPlacement(); return; }
    endPlacement();
    void syncBuildings();
  }

  function openSheetFor(buildingId: number): void {
    const building = game.state().buildings.find((b) => b.id === buildingId);
    if (!building || !sheet) return;
    if (placing) endPlacement();
    sheet.show(toUpgradeView(game.state(), building, game.now(), modelIcons));
  }

  /** Keeps an open sheet honest while the world moves under it. */
  function refreshSheet(): void {
    const id = sheet?.buildingId;
    if (id == null) return;
    const building = game.state().buildings.find((b) => b.id === id);
    if (building) sheet!.refresh(toUpgradeView(game.state(), building, game.now(), modelIcons));
    else sheet!.close();
  }

  /* --- pointer: the finger the ghost follows, and the tap that opens a sheet */

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down: { x: number; y: number; moved: boolean } | null = null;

  function toNdc(event: PointerEvent): void {
    const rect = stage.renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** The grid cell under the pointer, or null if it missed the island. */
  function cellUnder(event: PointerEvent): { x: number; z: number } | null {
    toNdc(event);
    raycaster.setFromCamera(pointer, stage.camera);
    const hit = raycaster.intersectObject(terrain, true)[0];
    if (!hit) return null;
    return worldToCell(shape, hit.point.x, hit.point.z);
  }

  function buildingUnder(event: PointerEvent): number | null {
    toNdc(event);
    raycaster.setFromCamera(pointer, stage.camera);
    for (const hit of raycaster.intersectObjects(pickable, true)) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        const id = node.userData.buildingId;
        if (typeof id === 'number') return id;
        node = node.parent;
      }
    }
    return null;
  }

  const canvas = stage.renderer.domElement;
  canvas.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY, moved: false };
    if (!placing) return;
    const cell = cellUnder(event);
    if (cell) { moveGhost(cell.x, cell.z); refreshPlacement(); }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!placing) return;
    // §3.15 — "a translucent ghost of the real model follows the finger". On a
    // phone that means while the finger is DOWN; with a mouse there is no such
    // state, so hovering moves it too.
    if (down) {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) down.moved = true;
    } else if (event.pointerType === 'touch') {
      return;
    }
    const cell = cellUnder(event);
    if (cell) { moveGhost(cell.x, cell.z); refreshPlacement(); }
  });

  const release = (event: PointerEvent) => {
    const start = down;
    down = null;
    if (!start || placing) return;
    // A tap, not a drag: the island is pannable in a later slice and a swipe
    // must never be read as "open this building".
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
    const id = buildingUnder(event);
    if (id !== null) openSheetFor(id);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => { down = null; });

  /**
   * Placeholder routes. The panels are the next slice; until they exist each
   * destination performs the one action it would offer, so every badge is
   * actually clearable and the §4.8 resolver can be exercised end to end.
   */
  function route(what: string, detail?: string): void {
    const now = game.now();
    const state = game.state();

    switch (what) {
      case 'Cofres': {
        const ready = state.chests.findIndex((c) => c.state === 'ready');
        if (ready >= 0) {
          const loot = game.dispatch((s) => openChest(s, ready)).loot;
          console.log('[route] cofre abierto', loot);
          return;
        }
        if (state.freeChestsBanked > 0) { game.dispatch((s) => claimFreeChest(s)); return; }
        const waiting = state.chests.findIndex((c) => c.state === 'waiting');
        if (waiting >= 0) game.dispatch((s) => startChest(s, waiting, now));
        return;
      }
      case 'Diario de a Bordo': {
        const quest = state.quests.daily.findIndex(questComplete);
        if (quest >= 0) { game.dispatch((s) => claimQuest(s, quest)); return; }
        game.dispatch((s) => claimDaily(s, now));
        return;
      }
      case 'Construir': {
        console.log('[route] construibles:', placeable(state, now));
        return;
      }
      case 'Terminar Ya': {
        // §4.4 — and the last five minutes of any timer cost exactly one gem.
        const running = state.buildings.find((b) => b.work);
        if (!running) return;
        const result = game.dispatch((s) => finishNow(s, running.id, now));
        console.log(`[route] terminar ya: ${running.type} por ${result.gems} 💎 (${result.ok ? 'ok' : result.refusal})`);
        return;
      }
      case 'Mejorar almacén': {
        // §3.10 / §10.11 — `¡Lleno!` is a button, and it goes to the store for
        // THAT resource. The chip now carries the resource with it; without it
        // a metal producer's chip would upgrade whichever store happened to be
        // affordable first, which is a different building entirely.
        const resource = detail as ResourceId | undefined;
        const stores = state.buildings.filter((b) => {
          const spec = buildingSpec(b.type);
          return spec.kind === 'store' && (!resource || spec.resource === resource);
        });
        for (const b of stores) {
          const plan = upgradePlan(b);
          if (!plan) continue;
          const result = game.dispatch((s) => startUpgrade(s, b.id, now));
          if (result.ok) { console.log(`[route] mejorando ${b.type} → Nv${plan.toLevel}`); return; }
          console.log(`[route] ${b.type} Nv${plan.toLevel}: ${result.refusal}`);
        }
        console.log(`[route] sin almacén mejorable para ${resource ?? 'ningún recurso'}`);
        return;
      }
      default:
        console.log(`[hud] open: ${what}`);
    }
  }

  // PLAN.md promises the player a manual backup. Until Ajustes has a panel this
  // is the route to it, and it is a real one.
  (window as unknown as Record<string, unknown>).laLeyenda = {
    state: () => game.state(),
    export: () => game.exportSave(),
    import: (file: Blob) => game.importSave(file),
    save: () => game.saveNow(),
    reset: () => game.reset(),
  };

  /* --- frame ------------------------------------------------------------- */

  const ndc = new THREE.Vector3();
  // The sim is integrated a few times a second, not every frame: nothing in the
  // economy moves fast enough to need 60Hz, and each tick clones the state.
  const SIM_STEP = 0.25;
  let nextSimAt = 0;

  return {
    update(dt, elapsed) {
      sceneElapsed = elapsed;
      water.update(elapsed, stage.camera);
      for (const m of mixers) m.update(dt);

      if (elapsed >= nextSimAt) {
        nextSimAt = elapsed + SIM_STEP;
        if (game.tick()) void syncBuildings();
        syncHud();
      }

      if (!hud) return;
      // Re-project every world-anchored element on the next frame (§2.3).
      // matrixWorldInverse is otherwise only refreshed inside renderer.render,
      // and in shot mode every update runs before the first render.
      stage.camera.updateMatrixWorld();
      stage.camera.matrixWorldInverse.copy(stage.camera.matrixWorld).invert();
      const width = window.innerWidth;
      const height = window.innerHeight;
      for (const anchor of anchors) {
        const base = anchorFor.get(anchor.buildingId);
        if (!base) continue;
        ndc.set(base.x, base.y + anchor.lift, base.z).project(stage.camera);
        hud.place(
          anchor.item.id,
          (ndc.x * 0.5 + 0.5) * width,
          (-ndc.y * 0.5 + 0.5) * height,
          ndc.z < 1
        );
      }
      hud.tick(elapsed);
    },
  };
}

/**
 * The save stores a grid cell; the terrain is generated per seed. If a seed
 * change ever moves the coastline under a stored building, snap it to the
 * nearest buildable cell rather than dropping it in the sea.
 */
function snapToBuildable(shape: IslandShape, x: number, z: number, type: string): { x: number; z: number } {
  const at = (cx: number, cz: number) =>
    cx >= 0 && cz >= 0 && cx < shape.size && cz < shape.size && shape.cells[cz * shape.size + cx].buildable;
  if (at(x, z)) return { x, z };

  for (let r = 1; r < shape.size; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (at(x + dx, z + dz)) {
          console.warn(`[island] ${type} at ${x},${z} is not buildable — snapped to ${x + dx},${z + dz}`);
          return { x: x + dx, z: z + dz };
        }
      }
    }
  }
  return { x, z };
}
