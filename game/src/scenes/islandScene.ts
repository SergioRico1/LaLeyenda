import * as THREE from 'three';
import { Stage } from '../render/stage';
import { Water } from '../render/water';
import {
  generateIsland, buildIslandMesh, buildShoreSDF, cellToWorld, worldToCell, STEP, CELL,
  type IslandShape,
} from '../render/island';
import { createGhost, type Ghost } from '../render/ghost';
import { createCameraRig, type CameraRig } from '../render/cameraRig';
import { buildScatter } from '../render/scatter';
import { DECOR_MODELS, buildGroundCover, planDecor, planIslets } from './decor';
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
import {
  buildingIdOf, suggestedUpgrade, toBuildOptions, toHudState, toUpgradeView, toWorldItems,
} from '../ui/present';
import { createCelebrate, type RewardItem } from '../ui/celebrate';
import { sfx } from '../ui/sfx';
import type { SimEvent } from '../sim';
import { createBuildPicker } from '../ui/panels/buildPicker';
import { createUpgradeSheet } from '../ui/panels/upgradeSheet';
import { createBuildBar } from '../ui/panels/buildBar';
import { COPY, refusalText, type RefusalKey } from '../ui/copy';

/** The home island: the builder scene, seen from the Clash-of-Clans style camera.
 *
 *  The island layout is **data, not scene** (PLAN.md's third multiplayer rule):
 *  everything below is built from `game.state().buildings`, so attacking someone
 *  else's island would one day be loading their JSON instead of yours. */

/** Every model the island can need, so preload() gets one pass. */
export const ISLAND_MODELS = [
  ...new Set(Object.values(BALANCE.buildings).map((b) => b.model)),
  ...DECOR_MODELS, 'ship_skiff', 'chest_bandit',
];

export interface IslandScene {
  update(dt: number, elapsed: number): void;
  /** Tears the scene down so another one can have the stage. Everything this
   *  added to the scene graph, the DOM and the canvas goes with it — the game
   *  itself does NOT, because it outlives any one view of it. */
  dispose(): void;
}

export interface IslandSceneOptions {
  /**
   * The simulation to draw. Passed in when something outside owns it — the
   * router does, because sailing away and coming back must not restart the
   * island's economy. Left out, the scene makes its own, which is what every
   * screenshot and every direct boot still does.
   */
  game?: Game;
  /** Called when ¡Zarpar! is tapped and the shipyard has actually given the
   *  player a boat. Without it the tile falls back to saying "soon". */
  onSail?: () => void;
}

/** A screenshot must be byte-identical between runs, so under `?shot=1` the
 *  sim clock is frozen here instead of reading the wall clock. */
const SHOT_EPOCH = Date.UTC(2026, 0, 5, 12, 0, 0);

export async function createIslandScene(
  stage: Stage,
  seed = 'la-leyenda',
  opts: IslandSceneOptions = {}
): Promise<IslandScene> {
  // Everything the scene puts on the stage is removed on dispose, and the only
  // reliable way to know what that is, is to remember what was already there.
  const preexisting = new Set(stage.scene.children);
  // One signal for every canvas listener, so none can outlive the scene and
  // start driving a scene that has been replaced.
  const listeners = new AbortController();
  const params = new URLSearchParams(location.search);
  const shot = params.get('shot') === '1';

  const shape = generateIsland(seed, 26);
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
  const game: Game = opts.game ?? await createGame({
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

    // The model's own node carries its normalization — a scale of about 0.08 on
    // the Ayuntamiento — so nothing else may write to it. The celebration
    // squash used to, and reset it to 1 when it finished, which restored the
    // model's native 126 units and put a building the size of the island in the
    // corner of the screen. Placement and animation get their own node, so the
    // two never share a transform.
    const anim = new THREE.Group();
    anim.name = `bldg_${b.id}`;
    anim.position.set(pos.x, pos.y, pos.z);
    anim.rotation.y = bldgRng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    anim.userData.buildingId = b.id;
    // What the oversize guard in main.ts measures this node against.
    anim.userData.footprint = spec.footprint * CELL;
    anim.add(inst.object);

    stage.scene.add(anim);
    pickable.push(anim);
    if (inst.mixer) mixers.push(inst.mixer);
    anchorFor.set(b.id, new THREE.Vector3(pos.x, pos.y, pos.z));

    const size = new THREE.Box3().setFromObject(anim).getSize(new THREE.Vector3());
    console.log(
      `[place] ${spec.model.padEnd(18)} size ${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)}` +
      ` at ${anim.position.x.toFixed(1)},${anim.position.y.toFixed(1)},${anim.position.z.toFixed(1)}` +
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

  /* --- the dressing -------------------------------------------------------
   *
   * The composition lives in decor.ts, which asks the SIM which ground a future
   * building could claim and plants only on what is left. It comes back as a
   * flat list of props, and every one of them is static, so the whole island's
   * dressing is drawn as one InstancedMesh per distinct model rather than one
   * scene node per prop — see render/scatter.ts for why that distinction is the
   * difference between a packed island and a draw-call budget. */
  if (parts.has('decor')) {
    const props = [
      ...planDecor(shape, game.state(), seed),
      ...planIslets(shape, seed),
    ];
    const scatter = await buildScatter(props);
    stage.scene.add(scatter);
    // Ground cover is flat and belongs to the terrain rather than the prop list
    // — it is what lets an EMPTY buildable plot read as prepared ground without
    // putting an object on ground a building could claim. See decor.ts.
    const cover = buildGroundCover(shape, seed);
    stage.scene.add(cover);
    console.log(`[decor] ${props.length} props in ${scatter.children.length} draw calls, +1 ground cover`);
  }

  // The player's ship, moored off the dock.
  //
  // Kept so the update loop can float it. A swell nothing sits on is a texture
  // that happens to move; a hull rising and tilting with it is what tells the
  // player the sea is a surface. It is also the cheapest possible check that
  // the shader and the CPU agree about where the water is — if they drift, the
  // boat visibly saws through it.
  let ship: THREE.Object3D | null = null;
  const shipY = STEP * 0.85;
  if (parts.has('ship')) {
    const skiff = await instantiate('ship_skiff', { fit: 5, clip: 'Idle' });
    skiff.object.position.set(-17, shipY, 9);
    skiff.object.rotation.y = -0.5;
    stage.scene.add(skiff.object);
    if (skiff.mixer) mixers.push(skiff.mixer);
    ship = skiff.object;
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

  // One finger pans, two pinch. A phone shows a fraction of the island, so
  // without this half of what the player owns is unreachable.
  //
  // Built in shot mode too. It takes `target` and so reproduces the framing
  // above exactly, which means an untouched capture is unchanged — and a
  // capture the harness DRAGS is the only way this gesture gets reviewed at
  // all. Leaving it out of shot mode would make it the one part of the game no
  // test can see, which is how it came to be missing in the first place.
  const rig: CameraRig = createCameraRig({
    camera: stage.camera,
    element: stage.renderer.domElement,
    target,
    // The plateau the buildings stand on, so the ground stays pinned to the
    // thumb rather than sliding by the plateau's height over the camera's.
    panPlaneY: STEP * 2,
    // Far enough to see the whole coast from the middle, not so far that the
    // island can leave the frame entirely.
    bounds: (shape.size * CELL) / 2,
    minDistance: 18,
    maxDistance: 72,
  });

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

  /**
   * §3.11 — buildings that have finished and are waiting to be inaugurated.
   *
   * The sim has no concept of this: as far as it is concerned the job is done
   * and the XP is banked. It is a purely presentational beat, so it is owned
   * here and merged into the anchor list on the way to the HUD — which is what
   * keeps `toWorldItems` a pure function of sim state.
   */
  const awaiting = new Map<number, number>();   // buildingId → lift

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
      onInaugurate(worldItemId) {
        const id = buildingIdOf(worldItemId);
        if (id === null) return;
        awaiting.delete(id);
        // §3.11's dust ring leaves the ground as the scaffolding comes off.
        const at = hud?.screenPos(worldItemId) ?? lastAt.get(id);
        if (at) { celebrate.flash(at.x, at.y, 170); celebrate.dust(at.x, at.y + 26, 210); }
        squash(id);
        syncHud();
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
    for (const [buildingId, lift] of [...awaiting]) {
      // A building the player started upgrading again has moved on: its ✓ would
      // sit next to the new job's timer bar arguing about the same roof.
      const building = game.state().buildings.find((b) => b.id === buildingId);
      if (!building || building.work) { awaiting.delete(buildingId); continue; }
      anchors.push({ buildingId, lift, item: { id: `done-${buildingId}`, kind: 'done' } });
    }
    hud.setState(toHudState(game.state(), game.now()));
    hud.setWorldItems(anchors.map((a) => a.item));
  }

  // An action must repaint the world-anchored layer immediately, not on the
  // next 250ms sim step: a timer bar that outlives the job it belongs to, or a
  // bubble that survives its own collect, is a quarter second of the HUD
  // telling the player something untrue.
  game.onChange(() => syncHud());

  /* --- the payoff layer (§3.11, §3.22, §5) --------------------------------
   *
   * Every event the sim emits used to be discarded here — `if (game.tick())`
   * threw away the SimEvent[] and every action result's events went unread.
   * Finishing a building, levelling up, a chest going ready and a chest being
   * opened all produced exactly nothing: no flash, no squash, no dust, no
   * reward moment, and not one element had ever been mounted at --z-celebrate.
   *
   * This is the one place they fan out. Everything downstream of it is a
   * presentational decision; nothing here changes what the sim did.
   */
  const celebrate = createCelebrate();
  uiRoot?.append(celebrate.el);

  /**
   * Where each building's world-anchored label was last drawn.
   *
   * A completion effect has to land ON the building, and by the time the event
   * is read the timer bar it hung off has already been reconciled out of the
   * DOM — so asking the HUD for its position then returns nothing. The
   * projection pass writes here every frame instead, which costs one Map set
   * per visible label and is always one frame fresh.
   */
  const lastAt = new Map<number, { x: number; y: number }>();

  /** §3.11's squash-and-stretch, on the actual model. */
  const squashing = new Map<number, number>();   // buildingId → scene time it started

  function squash(buildingId: number): void {
    if (shot) return;                    // a capture must stay byte-identical
    squashing.set(buildingId, sceneElapsed);
  }

  function objectFor(buildingId: number): THREE.Object3D | null {
    for (const node of pickable) if (node.userData.buildingId === buildingId) return node;
    return null;
  }

  /** Drives every running squash from the SCENE clock, never the wall clock, so
   *  shot mode stays deterministic. */
  function stepSquash(elapsed: number): void {
    for (const [id, startedAt] of [...squashing]) {
      const k = (elapsed - startedAt) / 0.4;         // §5: 400ms
      const node = objectFor(id);
      if (!node) { squashing.delete(id); continue; }
      if (k >= 1) {
        node.scale.setScalar(1);
        squashing.delete(id);
        continue;
      }
      // .9 → 1.08 → 1 on cubic-bezier(.3,1.6,.4,1), approximated with the
      // overshoot the curve is there to produce. Volume is conserved: the
      // building squats and spreads, then springs.
      const s = 1 + (Math.sin(k * Math.PI * 1.5) * 0.14) * (1 - k) - (k < 0.14 ? 0.1 * (1 - k / 0.14) : 0);
      node.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    }
  }

  /**
   * One switch over `SimEvent['type']`. Adding a beat means adding a case.
   */
  function celebrateEvents(events: SimEvent[]): void {
    let touched = false;
    for (const event of events) {
      switch (event.type) {
        case 'work-finished': {
          // The building is done — but the loop must never leave a gap where it
          // shows nothing (§3.11), so the timer bar is replaced by a ✓ the
          // player has to claim, and the XP is withheld until they do.
          const spec = buildingSpec(event.building);
          awaiting.set(event.buildingId, spec.footprint * 1.3);
          hud?.holdXp();
          const at = lastAt.get(event.buildingId);
          if (at) { celebrate.flash(at.x, at.y, 200); celebrate.dust(at.x, at.y + 30, 230); }
          sfx('pop');
          navigator.vibrate?.(12);
          touched = true;
          break;
        }
        case 'level-up':
          // Held with the XP: the badge pops when the ✓ is claimed, so the two
          // halves of the same reward do not arrive a minute apart.
          break;
        case 'chest-ready':
          sfx('pop');
          hud?.say(COPY['toast.chestReady']);
          break;
        case 'chest-opened':
          void showChestReward(event.loot);
          break;
        case 'quest-complete':
          sfx('levelup');
          hud?.say(COPY['toast.questDone']);
          break;
        case 'daily-claimed':
          sfx('levelup');
          break;
        case 'builder-expired':
          hud?.say(COPY['toast.builderGone']);
          break;
        default:
          break;
      }
    }
    // A ✓ bubble is HUD-owned, so the layer has to be re-reconciled after the
    // fan-out — `game.onChange` already fired, before `awaiting` was written.
    if (touched) syncHud();
  }

  /** §3.22B — the chest reveal, over a scrim, with the tiles dealt one at a
   *  time. This used to be `console.log('[route] cofre abierto', loot)`. */
  async function showChestReward(loot: Record<string, number>): Promise<void> {
    const named: Array<[string, string, string | undefined]> = [
      ['oro', 'Oro', iconSet.oro],
      ['madera', 'Madera', iconSet.madera],
      ['gemas', 'Gemas', iconSet.gema],
      ['fragmentos', 'Fragmentos', iconSet.rango],
    ];
    const items: RewardItem[] = named
      .filter(([key]) => (loot[key] ?? 0) > 0)
      .map(([key, label, icon]) => ({ icon, amount: loot[key] ?? 0, label }));
    if (items.length === 0) return;
    await celebrate.reward({
      title: COPY['banner.victory'],
      label: COPY['label.gotIt'],
      items,
      cta: COPY['cta.returnHome'],
    });
  }

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
    onSuggestion: (id) => openSheetFor(id),
  }) : null;

  const sheet = uiRoot ? createUpgradeSheet({
    icons: iconSet,
    onUpgrade: (id) => {
      const result = game.dispatch((s) => startUpgrade(s, id, game.now()));
      if (result.ok) { sheet!.close(); void syncBuildings(); }
      else { refused(result.refusal); refreshSheet(); }
    },
    onFinishNow: (id) => {
      const result = game.dispatch((s) => finishNow(s, id, game.now()));
      // finishNow runs the tick itself, so this is where a gem-bought
      // completion earns exactly the same celebration as a waited-out one.
      if (result.ok) { sheet!.close(); void syncBuildings(); celebrateEvents(result.events); }
      else { refused(result.refusal); refreshSheet(); }
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
    // While a ghost is on the grid the finger belongs to it, not to the camera.
    rig.setEnabled(false);
    // Start under the middle of the island rather than at 0,0, so the first
    // frame of the ghost is somewhere plausible even before a finger moves.
    moveGhost(Math.floor(shape.size / 2), Math.floor(shape.size / 2));
    ghost.show(true);
    uiRoot?.classList.add('is-placing');
    bar?.show({ label: spec.label, cost: levelSpec(type, 1).cost, timeMs: levelSpec(type, 1).timeMs });
    await ghost.setModel(spec.model, spec.footprint);
    refreshPlacement();
  }

  function endPlacement(): void {
    placing = null;
    rig.setEnabled(true);
    ghost.show(false);
    uiRoot?.classList.remove('is-placing');
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
  /** Where the current gesture started, so a swipe is not read as a tap. */
  let down: { x: number; y: number } | null = null;

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
    down = { x: event.clientX, y: event.clientY };
    if (!placing) return;
    const cell = cellUnder(event);
    if (cell) { moveGhost(cell.x, cell.z); refreshPlacement(); }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!placing) return;
    // §3.15 — "a translucent ghost of the real model follows the finger". On a
    // phone that means while the finger is DOWN; with a mouse there is no such
    // state, so hovering moves it too.
    if (!down && event.pointerType === 'touch') return;
    const cell = cellUnder(event);
    if (cell) { moveGhost(cell.x, cell.z); refreshPlacement(); }
  });

  const release = (event: PointerEvent) => {
    const start = down;
    down = null;
    if (!start || placing) return;
    // A tap, not a drag: a swipe that panned the island must never also be read
    // as "open this building". The rig uses the same 10px threshold, so the two
    // agree on where a tap stops being a tap.
    if (rig.panning) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
    const id = buildingUnder(event);
    if (id !== null) openSheetFor(id);
  };
  canvas.addEventListener('pointerup', release, { signal: listeners.signal });
  canvas.addEventListener('pointercancel', () => { down = null; }, { signal: listeners.signal });

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
          // §3.22B — the reward moment, not a console line.
          celebrateEvents(game.dispatch((s) => openChest(s, ready)).events);
          return;
        }
        if (state.freeChestsBanked > 0) { game.dispatch((s) => claimFreeChest(s)); return; }
        const waiting = state.chests.findIndex((c) => c.state === 'waiting');
        if (waiting >= 0) {
          const result = game.dispatch((s) => startChest(s, waiting, now));
          if (!result.ok) refused(result.refusal);
          return;
        }
        hud?.say(COPY['chip.oneChest']);
        return;
      }
      case 'Diario de a Bordo': {
        const quest = state.quests.daily.findIndex(questComplete);
        if (quest >= 0) {
          celebrateEvents(game.dispatch((s) => claimQuest(s, quest)).events);
          return;
        }
        const result = game.dispatch((s) => claimDaily(s, now));
        if (result.ok) celebrateEvents(result.events);
        else refused(result.refusal);
        return;
      }
      case 'Construir': {
        // §3.15 — the picker, carrying the whole catalogue with its refusals.
        picker?.show(
          toBuildOptions(state, now, modelIcons),
          townHallLevel(state),
          suggestedUpgrade(state, now)
        );
        return;
      }
      case 'Terminar Ya': {
        // §3.11's timer bar is a route into §3.16's sheet, not an instant
        // purchase: spending gems must always be a decision with the price on
        // screen first. The sheet's gold CTA is where §4.4 actually happens.
        const running = state.buildings.find((b) => b.work);
        if (running) openSheetFor(running.id);
        return;
      }
      case 'Mejorar almacén': {
        // §3.10 / §10.11 — `¡Lleno!` keeps its dashed informational border but
        // opens the storage upgrade sheet in one tap. The resource travels with
        // the chip: without it, a metal producer's chip would open whichever
        // store happened to be listed first, which is a different building.
        //
        // It used to dispatch the upgrade blind, from the first store it could
        // afford — the only upgrade route in the game, and one that spent the
        // player's wood without ever showing them a price.
        const resource = detail as ResourceId | undefined;
        const store = state.buildings.find((b) => {
          const spec = buildingSpec(b.type);
          return spec.kind === 'store' && (!resource || spec.resource === resource);
        });
        if (store) openSheetFor(store.id);
        return;
      }
      /* §3.5 — the destinations that do not exist yet still ANSWER. A tap that
       * changes nothing and says nothing is the one thing the spec forbids
       * twice, and `console.log` is not an answer on a phone. */
      case 'Construye el Muelle':
        hud?.say(COPY['toast.sailLocked'], { tone: 'refuse' });
        return;
      case 'Zarpar':
        // The shipyard has given the player a boat, so this is the one route
        // that leaves the island entirely. Without a router listening it falls
        // through to the default and says "soon", which is what it did before
        // there was a sea to go to.
        if (opts.onSail) { opts.onSail(); return; }
        hud?.say(`${what} · ${COPY['toast.soon']}`);
        return;
      default:
        hud?.say(`${what} · ${COPY['toast.soon']}`);
    }
  }

  /** One place a sim refusal becomes a sentence (§3.5). */
  function refused(refusal: Refusal | undefined): void {
    hud?.say(refusalText((refusal ?? 'unknown-building') as RefusalKey), { tone: 'refuse' });
  }

  // PLAN.md promises the player a manual backup. Until Ajustes has a panel this
  // is the route to it, and it is a real one.
  (window as unknown as Record<string, unknown>).laLeyenda = {
    state: () => game.state(),
    export: () => game.exportSave(),
    import: (file: Blob) => game.importSave(file),
    save: () => game.saveNow(),
    reset: () => game.reset(),
    /** The draw-call budget is 100 on a mid-range phone. `tools/perf.mjs` reads
     *  this after a real frame, so the figure is what the GPU was asked for
     *  rather than what a count of scene nodes suggests. */
    stats: () => ({
      calls: stage.renderer.info.render.calls,
      triangles: stage.renderer.info.render.triangles,
      programs: stage.renderer.info.programs?.length ?? 0,
      geometries: stage.renderer.info.memory.geometries,
      textures: stage.renderer.info.memory.textures,
      objects: stage.scene.children.length,
    }),
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

      if (ship) {
        const sea = water.surfaceAt(ship.position.x, ship.position.z, elapsed);
        ship.position.y = shipY + sea.height;
        // Pitch and roll off the surface slope. The gain is well above 1:1 —
        // the swell is deliberately shallow, and a hull that tilted by the true
        // surface angle would move about two degrees and read as rigid.
        ship.rotation.x = -sea.dz * 2.4;
        ship.rotation.z = sea.dx * 2.4;
      }

      stepSquash(elapsed);
      rig.update(dt);

      if (elapsed >= nextSimAt) {
        nextSimAt = elapsed + SIM_STEP;
        // The events were being thrown away here. They are the whole reward
        // channel: work-finished, chest-ready, level-up, builder-expired.
        const stepped = game.tick();
        if (stepped) { void syncBuildings(); celebrateEvents(stepped.events); }
        syncHud();
        // A sheet left open while a timer finishes must not keep offering an
        // upgrade that already started, or a gem price that has moved.
        refreshSheet();
        if (placing) refreshPlacement();
      }

      ghost.update(elapsed);
      sheet?.tick(elapsed);

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
        const sx = (ndc.x * 0.5 + 0.5) * width;
        const sy = (-ndc.y * 0.5 + 0.5) * height;
        hud.place(anchor.item.id, sx, sy, ndc.z < 1);
        if (ndc.z < 1) lastAt.set(anchor.buildingId, { x: sx, y: sy });
      }

      // §10.2 — in landscape the ✗/✓ pair follows the ghost in world space.
      // In portrait the CSS pins it to the bottom bar and this is ignored.
      if (placing && bar?.isOpen) {
        const at = cellToWorld(shape, ghost.cell.x, ghost.cell.z);
        ndc.set(at.x, at.y + placing.footprint * 0.9, at.z).project(stage.camera);
        bar.place((ndc.x * 0.5 + 0.5) * width, (-ndc.y * 0.5 + 0.5) * height);
      }

      hud.tick(elapsed);
    },

    dispose() {
      // The canvas listeners go first: a tap landing after this point would
      // drive a scene that is being taken apart.
      listeners.abort();
      rig.dispose();
      water.dispose();
      ghost.dispose?.();
      hud?.dispose();
      // The picker, the sheet, the build bar and the celebration layer all
      // live under #ui and hold no listeners outside their own subtree, so
      // emptying it takes all four. The HUD is the exception — it listens for
      // resize on the window — which is why it has a dispose of its own.
      uiRoot?.replaceChildren();

      // Everything this scene put on the stage, and nothing that was already
      // there — the lights belong to the Stage and outlive every scene.
      for (const child of [...stage.scene.children]) {
        if (preexisting.has(child)) continue;
        stage.scene.remove(child);
      }
      mixers.length = 0;
      // The game is deliberately NOT stopped: the router hands the same one to
      // the sea and back, and stopping it here would end the autosave on a
      // voyage the player has not finished.
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
