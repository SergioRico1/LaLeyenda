import * as THREE from 'three';
import { Stage } from '../render/stage';
import { Water } from '../render/water';
import { instantiate, preload, type ModelInstance } from '../render/assets';
import { Rng } from '../core/rng';
import { createStick, type Stick } from '../ui/stick';
import { createSeaHud, type SeaHud } from '../ui/seaHud';
import { sfx } from '../ui/sfx';
import {
  HARBOUR, MOBS, SEA_CELL, SEA_RANGE, SEA_STEP, SHIPS, sitesNear, startVoyage, steer, stepVoyage,
  type Mob, type MobKind, type SeaEvent, type Site, type Voyage,
} from '../sim/sea';

declare global {
  interface Window {
    /**
     * Shot mode only: the helm, driven the way a thumb drives it.
     *
     * `src/ui/stick.ts` deliberately stops listening under `?shot=1` so a
     * capture's scripted pointer events cannot fight a real gesture — which
     * also means a captured voyage never moves, and a fight can only ever be
     * photographed by sitting still and waiting to be bitten. This hook feeds
     * the SAME conversion a thumb feeds (a direction on the glass becomes a
     * helm angle), so `--act fight` is playing the game rather than posing it.
     */
    __sail?: (mode: string) => void;
  }
}

/**
 * The open sea — PLAN.md's Fase 2, and the half of the game the island has been
 * pointing at since the ¡Zarpar! tile was drawn.
 *
 * Everything here only DRAWS. The voyage is advanced by sim/sea.ts on a fixed
 * step and this file reads the result, which is the same split the island scene
 * has and the reason a voyage can be tested without a screen.
 *
 * Two things are worth stating because they are what makes an endless sea
 * cheap enough for a phone:
 *
 * - **Nothing is generated ahead of time.** The scene asks `sitesNear` for what
 *   is around the ship, exactly as the simulation does, and keeps a pool of
 *   objects keyed by site id. Sail away and the objects are recycled; sail back
 *   and the same seed rebuilds the same reef in the same place.
 *
 * - **The fight is drawn from the simulation's own numbers.** The firing arcs,
 *   the reload gauges, the lock under a chosen target and the ring under one
 *   that is about to bite all come out of `spec.arc`, `reloadPort`, the
 *   broadside's own target search and a mob's `cooldown`. Nothing here decides
 *   anything; it says out loud what sim/sea.ts already decided, because a game
 *   about positioning that shows no positions is a game about nothing. See
 *   READING A FIGHT, below.
 *
 * - **The water does not move with the ship, it is REDRAWN under it.** The
 *   shader colours a fragment from its world position, so sliding the mesh
 *   changes nothing about the pattern — it is anchored to the world, not to the
 *   geometry. The mesh is snapped to its own vertex spacing so the tessellation
 *   does not swim under the swell.
 */

/** Every model a voyage can need. */
export const SEA_MODELS = [
  'ship_skiff', 'mob_blowfish', 'mob_kelpling', 'mob_shark', 'mob_squid',
  'harv_oak', 'harv_pine', 'harv_ironore', 'harv_copperore',
  'chest_bandit', 'deco_rock_lg', 'deco_rock_sm', 'tree_palm',
];

const MOB_MODEL: Record<MobKind, string> = {
  blowfish: 'mob_blowfish',
  kelpling: 'mob_kelpling',
  hammerdead: 'mob_shark',
  squid: 'mob_squid',
};

/** The models ship with inconsistent capitalisation, so every clip is tried. */
const CLIP: Record<MobKind, string[]> = {
  blowfish: ['idle', 'Idle'],
  kelpling: ['Idle', 'idle'],
  hammerdead: ['idle', 'Idle'],
  squid: ['idle', 'Idle'],
};

/** Sea level. Sites stand on it, the ship floats on it. */
const SEA_Y = 0;

export interface SeaScene {
  update(dt: number, elapsed: number): void;
  /**
   * Resolves once every site and mob the ship can currently see has finished
   * loading its models.
   *
   * Sites and mobs are built asynchronously as the ship reaches them, which is
   * right for play — a frame must never block on a loader. It is wrong for a
   * capture: shot mode advances the whole voyage synchronously and then draws,
   * so nothing pending ever gets a turn and the sea photographs completely
   * empty. This is the harness's way of saying "now let the loaders finish".
   */
  settle(): Promise<void>;
  /** The live voyage, for the HUD and for handing cargo back to the island. */
  voyage(): Voyage;
  dispose(): void;
}

export interface SeaSceneOptions {
  seed?: string;
  /** Fired for every simulation event, so the HUD can react without polling. */
  onEvent?: (event: SeaEvent) => void;
  /**
   * The voyage is over. Called once, with the hold as it stands — half of it
   * already gone if the reason is 'sunk'. The router lands it in the island's
   * stores; this scene never touches the economy itself.
   */
  onEnd?: (voyage: Voyage, reason: 'home' | 'sunk' | 'left') => void;
}

export async function createSeaScene(stage: Stage, opts: SeaSceneOptions = {}): Promise<SeaScene> {
  const params = new URLSearchParams(location.search);
  const shot = params.get('shot') === '1';
  const seed = opts.seed ?? params.get('seed') ?? 'la-leyenda';

  // What the stage already had is what the stage keeps: the lights belong to
  // it and outlive every scene that borrows the stage.
  const preexisting = new Set(stage.scene.children);

  await preload(SEA_MODELS);

  // --- the sea -------------------------------------------------------------
  // No shore SDF: out here there is no island to break against, so the shader's
  // whole shoreline branch is switched off and the foam is all crest foam.
  //
  // THE SWELL, at the height it always wanted to be.
  //
  // WAVE_AMPLITUDE is 0.16 because the ISLAND needs a flat waterline: a beach, a
  // surf collar and a shoreline SDF all assume the sea meets the sand at a known
  // height. None of that exists in open water, and this scene had been
  // inheriting the constraint anyway — rocking an eight-unit hull by a sixth of
  // a unit, which is why the high seas read as a painted floor that drifts.
  //
  // It then sat at 0.55 for a round, and the note left here recorded why: at 0.9
  // the hull rocked beautifully and the SURFACE went smooth, because water.ts
  // sized a pixel with fwidth(worldPos) and a steeper sea puts more world under
  // every pixel — so the detail fade read the swell as distance and dissolved
  // the texture of the water that had the most going on. That fade now keys on
  // the projection and the view depth and cannot see the surface slope at all,
  // so the trade is gone and this is simply the amplitude the scene wants: a
  // 0.95-unit swell under an 8-unit hull, which is weather you can feel from the
  // deck and still a straight horizon.
  //
  // WHAT THE OPEN SEA GETS INSTEAD OF THE ISLAND'S CORNER.
  //
  // lane: 0. The sun lane is the island shot's composition — a wedge in the
  // bottom-right of a 16:9 frame — and it was implemented in the shader, so this
  // portrait frame inherited a corner of broken white and a flat wash over the
  // other four fifths. Out here the same glare is spread over the whole frame
  // and clumps on its own.
  //
  // reef: 1. With no island there is no shore distance to ramp against, so
  // without the seabed field every pixel of this ocean takes the same stop of
  // the same ramp. It is the only depth cue the open sea has.
  //
  // glitter: 0.42, and the number is a framing decision rather than a taste one.
  // The shader's glare is weighted toward the near half of the frame, where the
  // reference island shot puts nearly all of its white — and that shot is 16:9,
  // so its near half is a strip. This one is a phone held upright: the bottom
  // HALF of a 430x932 frame is all near water, and at the island's gain the same
  // weighting laid a raft of chip over a third of the picture. Same sea, twice
  // as much of it in the part of the ramp that breaks white.
  const water = new Water({
    size: 620, palette: 'ocean', glitter: 0.42, caps: 0.5, lane: 0, reef: 1,
    wave: 0.95, waveStep: 0.95 / 4,
  });
  water.mesh.position.y = SEA_Y;
  stage.scene.add(water.mesh);

  // Matched to the ocean palette's horizon and to the stage's #8FD8EC sky. The
  // old 0x82b0a7 agreed with neither: it pulled every distant islet, and the far
  // water with them, toward sage.
  stage.scene.fog = new THREE.Fog(0x6fbcd6, 150, 340);

  // --- the ship ------------------------------------------------------------
  // The hero object, so it is drawn a size larger than its collision radius
  // would suggest. fit normalises the LARGEST axis and the skiff is near
  // cubic once the mast is counted, so this is about the size of its hull.
  const skiff = await instantiate('ship_skiff', { fit: 8, clip: 'Idle' });
  const ship = new THREE.Group();
  ship.add(skiff.object);
  stage.scene.add(ship);
  const mixers: THREE.AnimationMixer[] = [];
  if (skiff.mixer) mixers.push(skiff.mixer);

  // A wake, so the ship is visibly making way rather than sliding. Two long
  // quads either side of the stern, faded out at the far end.
  const wake = buildWake();
  ship.add(wake);
  const hullShadow = blobShadow(5.2);
  ship.add(hullShadow);
  /** Everything flat that has to lie ON the swell rather than on a plane through
   *  the ship. See followSea. */
  const afloat: { mesh: THREE.Mesh; lift: number }[] = [
    ...wake.children.map((quad) => ({ mesh: quad as THREE.Mesh, lift: 0.10 })),
    { mesh: hullShadow, lift: 0.05 },
  ];

  // --- pools ---------------------------------------------------------------
  // Sites and mobs come and go as the ship moves. Both are keyed by the id the
  // simulation uses, so a group is created once and recycled, never rebuilt
  // every frame.
  const siteNodes = new Map<string, THREE.Object3D>();
  const sitePending = new Set<string>();
  const mobNodes = new Map<number, { node: THREE.Object3D; instance: ModelInstance }>();
  const mobPending = new Set<number>();
  /** Every load in flight, so settle() can wait for the lot. */
  let inFlight: Promise<unknown>[] = [];

  // Shots are small, numerous and identical: one InstancedMesh for all of them.
  const SHOT_CAP = 48;
  const shotMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.7, 0.7, 0.7),
    new THREE.MeshLambertMaterial({ color: 0x2b2b33 }),
    SHOT_CAP
  );
  shotMesh.frustumCulled = false;
  shotMesh.count = 0;
  stage.scene.add(shotMesh);

  // --- camera --------------------------------------------------------------
  // Fixed world orientation, following the ship. A chase camera that rotates
  // with the hull makes a thumb-steered boat nauseating and, worse, breaks the
  // contract the stick relies on: a direction on the glass is a direction in
  // the world.
  //
  // HOW FAR BACK, and the measurement that moved it.
  //
  // The offset used to be (26, 34, 32) — 53 units out, which at the stage's 38°
  // lens puts about TWENTY WORLD UNITS across a portrait phone. The skiff is
  // eight of them. A hammerdead notices the ship from sixty units away, a
  // kelpling bites at six, and the guns reach fifty: at that framing every
  // single one of those numbers happens off the edge of the glass, and the
  // player's whole experience of a fight is a hull bar going down for reasons
  // that never appear on screen. Positioning cannot be played on a screen that
  // shows no positions.
  //
  // Scaled by 1.62 and NOT re-aimed: the direction is untouched, so the sun,
  // the shadows and — the one that matters outside this file — seaHud.ts's
  // compass all still solve. That needle projects a world bearing onto the
  // camera's ground axes, which are a function of the offset's DIRECTION only,
  // so a uniform scale leaves it exact. Turn this vector and that copy has to
  // turn with it; lengthen it and nothing else moves.
  //
  // The frame is now about thirty-three units across: a creature closing at 14
  // units a second is on screen for well over a second before it can reach the
  // hull, the near half of a broadside's reach is visible, and the skiff still
  // draws a quarter of the width — a hero, not a speck.
  const CAM_OFFSET = new THREE.Vector3(26, 34, 32).multiplyScalar(1.62);
  const follow = new THREE.Vector3(0, SEA_Y, 0);
  stage.camera.position.copy(CAM_OFFSET);
  stage.camera.lookAt(follow);

  const stick: Stick | null = shot ? null : createStick(document.body);

  const uiRoot = document.getElementById('ui');
  let ended: 'home' | 'sunk' | 'left' | null = null;
  const hud: SeaHud | null = uiRoot
    ? createSeaHud(uiRoot, { onLeave: () => end('left') })
    : null;

  /**
   * Ends the voyage exactly once.
   *
   * Three ways out and they must not race: the hull reaching zero, the ship
   * reaching home water, and the player pressing Volver. Whichever lands first
   * wins and the rest are ignored, because handing the same cargo to the island
   * twice would be a duplication bug the player would learn to trigger.
   */
  function end(reason: 'home' | 'sunk' | 'left'): void {
    if (ended) return;
    ended = reason;
    void hud?.finish(voyage, reason).then(() => opts.onEnd?.(voyage, reason));
  }

  let voyage = startVoyage(seed);
  // `?at=x,y` drops the ship somewhere specific. A capture of the open sea is
  // otherwise a capture of home water, which is empty by design — there is
  // nothing out there to photograph until you have sailed for a minute.
  const at = params.get('at');
  if (at) {
    const [ax, ay] = at.split(',').map(Number);
    voyage.x = ax;
    voyage.y = ay;
  }
  let carry = 0;

  // --- helpers -------------------------------------------------------------

  /** Sim (x, y) is world (x, z). One place, so nothing has to remember it. */
  const toWorld = (x: number, y: number, out = new THREE.Vector3()) => out.set(x, SEA_Y, y);

  /** The model's nose is +Z, so a sim heading of 0 (+x) is a quarter turn. */
  const facing = (heading: number) => Math.PI / 2 - heading;

  /**
   * A dark disc on the water under a floating thing.
   *
   * Without it every hull and every creature reads as a sticker laid on the
   * sea: there is one directional light and nothing out here to catch its
   * shadow, so the only cue that an object sits ON the water rather than above
   * it is the one drawn deliberately. Cheaper than a shadow map and, at this
   * art scale, more legible than one.
   */
  function blobShadow(radius: number): THREE.Mesh {
    // The rotation is baked into the geometry rather than set on the object, so
    // local +y is world up and followSea can lift a vertex by writing one
    // number. A disc rotated by its object transform has its normal along local
    // z and "up" is not an axis of its own vertex data.
    const geometry = new THREE.CircleGeometry(radius, 12);
    geometry.rotateX(-Math.PI / 2);
    const disc = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x04203f, transparent: true, opacity: 0.34, depthWrite: false,
      })
    );
    disc.position.y = 0.05;
    disc.renderOrder = 0;
    return disc;
  }

  function buildWake(): THREE.Object3D {
    const group = new THREE.Group();
    for (const side of [-1, 1]) {
      // Its own geometry per quad, and segmented along its length: followSea
      // rewrites these vertices every frame, so they cannot be shared, and a
      // sixteen-unit strip needs joints to bend over a twenty-unit swell.
      const geometry = new THREE.PlaneGeometry(1.5, 13, 1, 10);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, 0, -7.6);
      const material = new THREE.MeshBasicMaterial({
        color: 0xdff2ef, transparent: true, opacity: 0.26, depthWrite: false,
      });
      const quad = new THREE.Mesh(geometry, material);
      quad.position.set(side * 1.5, 0.06, 0);
      quad.renderOrder = 1;
      group.add(quad);
    }
    return group;
  }

  /**
   * Lays a flat mesh ON the swell instead of on a plane through the ship.
   *
   * At an amplitude of a sixth of a unit nothing needed this. At 0.95 everything
   * does: a sixteen-unit wake drawn flat across a twenty-unit swell spends half
   * its length buried in the water behind the ship — where the opaque sea
   * simply occludes it — and the other half hovering over a trough. Same for a
   * five-unit shadow disc under a hull that is riding one crest while its own
   * shadow covers the next.
   *
   * Each vertex is lifted to the height of the water it lands on. The mesh's
   * world matrix maps its local xz into the world for the lookup, and the answer
   * comes back through the same offset — exact under the yaw and translation
   * that dominate here, and a fraction of a degree out under the ship's heel,
   * which is a fraction of a degree of a shadow.
   */
  const AFLOAT_PT = new THREE.Vector3();
  function followSea(mesh: THREE.Mesh, lift: number, time: number): void {
    const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    mesh.updateWorldMatrix(true, false);
    // Where the mesh's own origin plane sits in the world, so a world height can
    // be written back as a local one.
    const originY = AFLOAT_PT.set(0, 0, 0).applyMatrix4(mesh.matrixWorld).y;
    for (let i = 0; i < attr.count; i++) {
      AFLOAT_PT.set(attr.getX(i), 0, attr.getZ(i)).applyMatrix4(mesh.matrixWorld);
      const sea = water.surfaceAt(AFLOAT_PT.x, AFLOAT_PT.z, time);
      attr.setY(i, SEA_Y + sea.height + lift - originY);
    }
    attr.needsUpdate = true;
  }

  /**
   * The visible body of a site.
   *
   * Built rather than loaded: an islet is a couple of stacked discs, which is
   * both cheaper than a model and the only way to make the radius the
   * simulation collides against the radius the player can see.
   */
  async function buildSite(site: Site): Promise<THREE.Object3D> {
    const group = new THREE.Group();
    const rng = new Rng(`${seed}:site:${site.id}`);

    if (site.kind === 'reef') {
      // Rocks breaking the surface, and nothing else: a reef is a hazard, and
      // it has to read as one from far enough away to turn.
      for (let i = 0; i < 3; i++) {
        const rock = await instantiate(rng.chance(0.5) ? 'deco_rock_lg' : 'deco_rock_sm', {
          fit: site.radius * rng.range(0.5, 0.9),
        });
        rock.object.position.set(
          rng.range(-site.radius, site.radius) * 0.6, -0.6, rng.range(-site.radius, site.radius) * 0.6
        );
        rock.object.rotation.y = rng.range(0, Math.PI * 2);
        group.add(rock.object);
      }
      group.position.copy(toWorld(site.x, site.y));
      return group;
    }

    // A shallow shelf, then the sand, then whatever the site is for. The shelf
    // is what stops an islet reading as a coin dropped on the water.
    //
    // Both are sunk far enough to survive a trough. The sea now drops most of a
    // unit below its own level twice a second, and these were sized for a flat
    // one: the shelf's top face sat at −0.09, so every trough lifted a bright
    // cyan slab out of the water beside each islet, and the sand ended at −0.35,
    // so anything that cleared the shelf showed daylight under the island. The
    // shelf goes below the deepest trough and the sand runs down past it.
    const shelf = new THREE.Mesh(
      new THREE.CylinderGeometry(site.radius * 1.5, site.radius * 1.6, 3.0, 9),
      new THREE.MeshLambertMaterial({ color: 0x3fa8c4 })
    );
    shelf.position.y = -2.7;
    group.add(shelf);

    const sand = new THREE.Mesh(
      new THREE.CylinderGeometry(site.radius, site.radius * 1.12, 5.0, 9),
      new THREE.MeshLambertMaterial({ color: 0xe8d9b4 })
    );
    sand.position.y = -1.35;
    sand.castShadow = true;
    group.add(sand);

    const top = 1.15;
    const scatter = async (id: string, count: number, fit: number) => {
      for (let i = 0; i < count; i++) {
        const model = await instantiate(id, { fit: fit * rng.range(0.85, 1.15) });
        const angle = rng.range(0, Math.PI * 2);
        const reach = site.radius * rng.range(0, 0.62);
        model.object.position.set(Math.cos(angle) * reach, top, Math.sin(angle) * reach);
        model.object.rotation.y = rng.range(0, Math.PI * 2);
        group.add(model.object);
      }
    };

    switch (site.kind) {
      case 'harvest':
        await scatter(rng.chance(0.5) ? 'harv_oak' : 'harv_pine', 3, 4.5);
        await scatter(rng.chance(0.5) ? 'harv_ironore' : 'harv_copperore', 2, 3);
        break;
      case 'islet':
        await scatter('tree_palm', 3, 7);
        break;
      case 'wreck':
        await scatter('chest_bandit', 2, 3.4);
        break;
      case 'lair':
        await scatter('deco_rock_lg', 4, 6);
        await scatter('chest_bandit', 3, 3.4);
        break;
      default:
        break;
    }

    group.position.copy(toWorld(site.x, site.y));
    return group;
  }

  /**
   * Every site within the plume radius, which is wider than the streaming one.
   *
   * Asked once a frame and shared: the objects built out of it stop at
   * `SEA_RANGE * 1.3`, and everything past that is a plume on the horizon and
   * nothing else. `sitesNear` memoises per cell, so the wider question costs
   * about what the narrow one did.
   */
  let horizon: Site[] = [];

  /** Creates and recycles the site objects around the ship. */
  function syncSites(): void {
    horizon = sitesNear(seed, voyage.x, voyage.y, HORIZON);
    const near = horizon.filter(
      (s) => Math.hypot(s.x - voyage.x, s.y - voyage.y) <= SEA_RANGE * 1.3);
    const wanted = new Set(near.map((s) => s.id));

    for (const site of near) {
      if (siteNodes.has(site.id) || sitePending.has(site.id)) continue;
      sitePending.add(site.id);
      inFlight.push(buildSite(site).then((node) => {
        sitePending.delete(site.id);
        // The ship may have left while the models loaded.
        if (!wanted.has(site.id) && Math.hypot(site.x - voyage.x, site.y - voyage.y) > SEA_RANGE * 1.5) return;
        siteNodes.set(site.id, node);
        stage.scene.add(node);
      }));
    }

    for (const [id, node] of siteNodes) {
      if (wanted.has(id)) continue;
      stage.scene.remove(node);
      siteNodes.delete(id);
    }
  }

  function syncMobs(): void {
    const alive = new Set(voyage.mobs.map((m) => m.id));

    for (const mob of voyage.mobs) {
      if (mobNodes.has(mob.id) || mobPending.has(mob.id)) continue;
      mobPending.add(mob.id);
      const spec = MOBS[mob.kind];
      inFlight.push(instantiate(MOB_MODEL[mob.kind], { fit: spec.radius * 2.1 }).then((instance) => {
        mobPending.delete(mob.id);
        if (!alive.has(mob.id)) return;
        for (const name of CLIP[mob.kind]) if (instance.play(name, { loop: true })) break;
        if (instance.mixer) mixers.push(instance.mixer);
        const node = new THREE.Group();
        node.add(instance.object);
        node.add(blobShadow(spec.radius * 0.95));
        mobNodes.set(mob.id, { node, instance });
        stage.scene.add(node);
      }));
    }

    for (const [id, entry] of mobNodes) {
      if (alive.has(id)) continue;
      stage.scene.remove(entry.node);
      const index = entry.instance.mixer ? mixers.indexOf(entry.instance.mixer) : -1;
      if (index >= 0) mixers.splice(index, 1);
      mobNodes.delete(id);
    }

    // Position every live mob, riding the same swell the ship does.
    const at = new THREE.Vector3();
    for (const mob of voyage.mobs) {
      const entry = mobNodes.get(mob.id);
      if (!entry) continue;
      const sea = water.surfaceAt(mob.x, mob.y, carry);
      entry.node.position.copy(toWorld(mob.x, mob.y, at));
      entry.node.position.y += sea.height;
      entry.node.rotation.y = facing(mob.heading);
      entry.node.rotation.x = -sea.dz * 0.5;

      // The strike itself: a creature that just bit rears and throws itself a
      // yard at the hull, and is back where it was a fifth of a second later.
      // The simulation moves nothing when it deals damage — it holds station
      // and takes a bite out of the hull number — so without this the most
      // violent event in the game has no picture at all.
      const lunge = lunges.get(mob.id);
      if (lunge !== undefined) {
        const punch = Math.sin((lunge / 0.22) * Math.PI);
        const bearing = Math.atan2(voyage.y - mob.y, voyage.x - mob.x);
        entry.node.position.x += Math.cos(bearing) * punch * 2.2;
        entry.node.position.z += Math.sin(bearing) * punch * 2.2;
        entry.node.position.y += punch * 0.8;
        entry.node.scale.setScalar(1 + punch * 0.16);
      } else if (entry.node.scale.x !== 1) {
        entry.node.scale.setScalar(1);
      }
    }
  }

  function syncShots(): void {
    const matrix = new THREE.Matrix4();
    const count = Math.min(voyage.shots.length, SHOT_CAP);
    for (let i = 0; i < count; i++) {
      const shot = voyage.shots[i];
      // Lobbed, not flat: the arc is what makes a cannonball read as heavy.
      const flight = 1 - Math.max(0, Math.min(1, shot.life / 0.9));
      matrix.makeTranslation(shot.x, SEA_Y + 1.4 + Math.sin(flight * Math.PI) * 2.2, shot.y);
      shotMesh.setMatrixAt(i, matrix);
    }
    shotMesh.count = count;
    shotMesh.instanceMatrix.needsUpdate = true;
  }

  /** Shortest signed angle from a to b, in (-pi, pi]. The sim's own helper,
   *  by another name — a renderer may not import one. */
  function angleDelta(a: number, b: number): number {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /**
   * A thumb the harness is holding — see `window.__sail`.
   *
   * Written by `sail()` below and read by `applyStick` exactly where a real
   * stick would be read, so a capture and a player go through the same helm.
   */
  let scripted: { x: number; y: number; force: number } | null = null;

  /** Turns the thumb's direction into a helm the simulation understands. */
  function applyStick(): void {
    const thumb = stick?.held ? { x: stick.x, y: stick.y, force: stick.force } : scripted;
    if (!thumb || thumb.force < 0.08) {
      voyage = steer(voyage, { turn: 0, throttle: 0 });
      return;
    }
    // Screen up is world -z, so the stick's y maps to -z and its x to +x.
    const wanted = Math.atan2(-thumb.y, thumb.x);
    voyage = steer(voyage, {
      // Proportional, so a small correction is a small correction. Saturates
      // well before a right angle, which is what makes hard turns feel decisive.
      turn: Math.max(-1, Math.min(1, angleDelta(voyage.heading, wanted) * 2.2)),
      throttle: thumb.force,
    });
  }

  // ==========================================================================
  // READING A FIGHT
  //
  // sim/sea.ts fires the guns itself: a side shoots when a target is inside its
  // arc and that side has reloaded, so the player plays POSITIONING rather than
  // a fire button. None of that was on screen. A player being shot at could not
  // see where their own guns bore, could not see that a broadside was spent,
  // and was bitten by things that never announced themselves. A positioning
  // game that hides the position is a game about nothing.
  //
  // Five objects answer it, and every one is drawn from a number the simulation
  // already owns rather than from a number invented here:
  //
  //   THE ARCS   `spec.arc`, laid on the sea off each beam. The angle is
  //              exactly the one sim/sea.ts fires through; see FAN_FAR for why
  //              the length drawn is not.
  //   THE GAUGE  `reloadPort` / `reloadStarboard`, as a band hugging the hull
  //              that empties on the shot and fills back up. That one piece of
  //              feedback is what turns circling from random into rhythm.
  //   THE LOCK   the same "nearest mob inside the arc, inside range" test the
  //              broadside runs, as a ring under the mob the guns have chosen.
  //              The arc says where; the lock says who.
  //   THE TELL   a creature winding up to bite, as a ring closing on it. Every
  //              bite in the sim has a `cooldown` to telegraph with, and being
  //              hit from nowhere is the least fair thing a game can do.
  //   THE PULL   a plume over every unclaimed site out to three cells, so the
  //              horizon always has somewhere worth pointing at.
  //
  // All of it is pooled or instanced. What was here before cloned a material
  // per puff of smoke — a draw call and an allocation per cannon shot, on a
  // phone, in the middle of the only fight in the game.
  // ==========================================================================

  const spec = SHIPS[voyage.shipType];

  const SIDES = ['port', 'starboard'] as const;
  type Side = (typeof SIDES)[number];

  /** The bearing a side's guns look down — the simulation's own expression. */
  const beamOf = (side: Side, heading: number): number =>
    heading + (side === 'port' ? -Math.PI / 2 : Math.PI / 2);

  /**
   * A grid of (u, v) over a ring sector: u out along the bearing, v across the
   * arc.
   *
   * Both the positions and the alpha are written every frame by `layArc`. The
   * positions have to be, because anything flat out here sits ON the swell — a
   * thirty-unit wedge drawn across a 0.95-unit sea spends half its length
   * inside the water. The alpha has to be for the reason given there. What is
   * kept here is the SHAPE, split into the outline and the fill, so a frame can
   * weigh the two against each other without recomputing either.
   */
  interface Lattice {
    geometry: THREE.BufferGeometry;
    u: Float32Array;
    v: Float32Array;
    /** The two parts of the shape, kept apart so a frame can weigh them
     *  separately — see `layArc`. */
    outline: Float32Array;
    fill: Float32Array;
  }

  function lattice(
    rings: number, cols: number,
    outlineAt: (u: number, v: number) => number,
    fillAt: (u: number, v: number) => number = () => 0
  ): Lattice {
    const count = (rings + 1) * (cols + 1);
    const u = new Float32Array(count);
    const v = new Float32Array(count);
    const outline = new Float32Array(count);
    const fill = new Float32Array(count);
    const colour = new Float32Array(count * 4);
    const index: number[] = [];
    for (let r = 0, i = 0; r <= rings; r++) {
      for (let c = 0; c <= cols; c++, i++) {
        u[i] = r / rings;
        v[i] = (c / cols) * 2 - 1;
        outline[i] = outlineAt(u[i], v[i]);
        fill[i] = fillAt(u[i], v[i]);
        colour[i * 4] = 1;
        colour[i * 4 + 1] = 1;
        colour[i * 4 + 2] = 1;
        colour[i * 4 + 3] = outline[i];
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c;
        index.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colour, 4));
    geometry.setIndex(index);
    return { geometry, u, v, outline, fill };
  }

  /**
   * Lays one lattice on the water as a ring sector around the ship, and says
   * how loud each half of the shape is.
   *
   * The gains are not a convenience. A LINE dimmed by dropping the material's
   * opacity does not go quiet, it goes GREY: forty percent of a warm orange
   * over this blue is a blend that has left the orange behind, which is what
   * the arcs photographed as for three passes of this round. The material now
   * holds full opacity and the alpha is written per vertex per frame, so the
   * boundary keeps its colour all the way down and it is the FILL that comes
   * and goes with the fight.
   */
  function layArc(
    mesh: THREE.Mesh, grid: Lattice, bearing: number, half: number,
    near: number, far: number, lift: number, time: number,
    outlineGain = 1, fillGain = 0
  ): void {
    const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colour = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < grid.u.length; i++) {
      const radius = near + (far - near) * grid.u[i];
      const angle = bearing + grid.v[i] * half;
      const lx = Math.cos(angle) * radius;
      const lz = Math.sin(angle) * radius;
      attr.setXYZ(i, lx, water.surfaceAt(voyage.x + lx, voyage.y + lz, time).height + lift, lz);
      colour.setW(i, Math.min(1, grid.outline[i] * outlineGain + grid.fill[i] * fillGain));
    }
    attr.needsUpdate = true;
    colour.needsUpdate = true;
  }

  /** Where the wedge starts — clear of the hull, which draws eight units long. */
  const FAN_NEAR = 11;
  /**
   * And where it is drawn to, which is NOT how far the guns reach.
   *
   * The frame is thirty-three units across. A wedge drawn to full range is
   * three quarters of it on each side, and what a player saw was a pale haze
   * with no shape — the two things a firing arc has to have are a boundary and
   * a side, and at that size neither survived.
   *
   * The guns do shoot past it, and the shape is deliberately honest about that:
   * its two SIDES are hard lines, because crossing one really does change
   * whether you are shot, and its far mouth is barely drawn at all, because
   * nothing happens there. What is being drawn is where the guns BEAR. How far
   * they carry is said by the shots.
   */
  const FAN_FAR = 21;
  /**
   * How wide the boundary is drawn ON THE WATER, in world units.
   *
   * The number that had to exist. The limit lines were a fixed fraction of the
   * ARC — a gaussian in `v` — so their width on the sea grew with the radius:
   * one and a bit units at the muzzle and nearly four at the far end. Four
   * units is a third of the ship's length, and four units of flat sandy orange
   * laid on blue water is not a line, it is a beach. Read back off the frame,
   * that is exactly what it was: I saw two sandbars either side of the ship and
   * only then read them as gun arcs, which means every player would have steered
   * to avoid their own broadside.
   *
   * Holding the width in world units instead makes it an instrument mark: the
   * same line at the muzzle and at thirty units, about a foot of sea wide.
   */
  const EDGE_WIDTH = 1.15;
  /** The gauge is a band along the rail, where the guns are, and it is DELIBERATELY
   *  small: at 5.4 to 8.6 it drew a white collar the size of the ship and read
   *  as foam rather than as an instrument. */
  const GAUGE_NEAR = 5.7;
  const GAUGE_FAR = 7.1;
  /**
   * And how far round the hull a full charge reaches.
   *
   * It used to be the firing arc itself — eighty degrees a side — so a loaded
   * ship wore two amber crescents that between them went most of the way round
   * it. On the spawn frame they were the brightest objects in the picture, on an
   * empty sea, and dimming them only turned them brown: a big shape cannot be
   * made quiet, it can only be made muddy. Half the arc is a BAR on the rail,
   * about three units of sea long, which is a gauge rather than a garland.
   */
  const GAUGE_SPAN = 0.5;

  interface Broadside {
    fan: THREE.Mesh;
    fanMaterial: THREE.MeshBasicMaterial;
    /** The empty groove the charge fills. */
    track: THREE.Mesh;
    gauge: THREE.Mesh;
    gaugeMaterial: THREE.MeshBasicMaterial;
    /** Seconds of muzzle flash left; also drives the recoil. */
    flash: number;
    /** Eased, so the arc lifts into a fight instead of blinking into one. */
    heat: number;
    /** Whether this side had reloaded last frame, so the chime fires once. */
    wasReady: boolean;
  }

  const arcs = new THREE.Group();
  stage.scene.add(arcs);

  // THE WEDGE, and why it is mostly its own outline.
  //
  // The first build filled the sector with additive white. Over water this
  // bright it came out as a pale wash with no boundary — the frame looked like
  // it had fog in one corner, and a boundary is the entire content of "inside
  // this and you get shot". So the alpha carries two things at once: a thin
  // BRIGHT LINE down each limit of the arc, which is the edge a player reads
  // and steers against, and a weak fill between them that says which side of
  // the line is the dangerous one.
  //
  // It also has to DECAY with range, and the comment that used to sit here said
  // so while the code did nothing of the kind. The arc runs off the side of a
  // thirty-three-unit frame long before it ends, so a limit line at full
  // strength all the way out is a stripe from one edge of the glass to the
  // other with no shape in it. Fading it out over the last third puts the whole
  // read in the near water, where the player is looking anyway, and lets the
  // shape end instead of hitting the frame.
  //
  // The columns went from 24 to 44 for one reason: a line held at a constant
  // WIDTH ON THE WATER is about a unit across, and at the far end of the sector
  // one column of a 24-wide lattice is a unit and a half. There was nothing to
  // draw the line on.
  const fanGrid = lattice(
    6, 44,
    (u, v) => {
      const radius = FAN_NEAR + (FAN_FAR - FAN_NEAR) * u;
      // How far off the limit this vertex sits, ON THE SEA rather than in the
      // sector's own coordinates. This is the whole fix for the sandbars.
      const off = (1 - Math.abs(v)) * spec.arc * radius;
      const limit = Math.exp(-Math.pow(off / EDGE_WIDTH, 2));
      // The mouth that closes the far end, at a fifth: it says the shape stops,
      // it does not claim anything happens there.
      const mouth = Math.exp(-Math.pow(((1 - u) * (FAN_FAR - FAN_NEAR)) / EDGE_WIDTH, 2)) * 0.22;
      return Math.max(limit, mouth) * (0.18 + 0.82 * Math.pow(1 - u, 1.1));
    },
    // And the fill hugs the muzzle. It was a sector twenty-six units deep at a
    // few percent of an orange, which sounds like nothing and is not: a wash
    // that faint still has a HARD BOUNDARY, and a hard boundary over that much
    // water is a shape whatever its alpha. Read off a nine-hundred-pixel frame
    // it was a pale fog bank filling the bottom-left quarter of the picture.
    (u, v) => Math.pow(Math.max(0, 1 - v * v), 1.4) * Math.pow(1 - u, 2.6)
  );
  // The gauge is solid across its width and softened only at its two ends, so
  // the charge sweeping into it has a clean leading edge to read.
  const gaugeGrid = lattice(1, 18, (_u, v) => Math.min(1, (1 - Math.abs(v)) * 7));
  const trackGrid = lattice(1, 18, (_u, v) => Math.min(1, (1 - Math.abs(v)) * 7));

  const broadsides: Record<Side, Broadside> = {
    port: makeBroadside(),
    starboard: makeBroadside(),
  };

  function makeBroadside(): Broadside {
    // Plain alpha, not additive: additive over a sea this bright is white on
    // white. A warm tint LAID on the blue is what keeps an edge an edge.
    const fanMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd98a, transparent: true, opacity: 1, depthWrite: false,
      side: THREE.DoubleSide, vertexColors: true, fog: false,
    });
    const fan = new THREE.Mesh(fanGrid.geometry.clone(), fanMaterial);
    fan.frustumCulled = false;
    fan.renderOrder = 2;

    const track = new THREE.Mesh(trackGrid.geometry.clone(), new THREE.MeshBasicMaterial({
      color: 0x02060c, transparent: true, opacity: 0.62, depthWrite: false,
      side: THREE.DoubleSide, vertexColors: true, fog: false,
    }));
    track.frustumCulled = false;
    track.renderOrder = 3;

    // Also plain alpha. Additive amber over this sea comes out white, and a
    // white gauge on white foam beside a white wake is three things nobody can
    // tell apart at arm's length.
    const gaugeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc65a, transparent: true, opacity: 1, depthWrite: false,
      side: THREE.DoubleSide, vertexColors: true, fog: false,
    });
    const gauge = new THREE.Mesh(gaugeGrid.geometry.clone(), gaugeMaterial);
    gauge.frustumCulled = false;
    gauge.renderOrder = 4;

    arcs.add(fan, track, gauge);
    return { fan, fanMaterial, track, gauge, gaugeMaterial, flash: 0, heat: 0, wasReady: true };
  }

  /**
   * Who this side's guns have chosen — the simulation's own rule.
   *
   * Mirrored rather than imported: the sim answers this inside a step and keeps
   * no record of it. A lock drawn on a different creature from the one that
   * gets shot is worse than no lock at all, so this is a copy of the search in
   * sim/sea.ts's broadside block and it has to stay one.
   */
  function lockedOn(side: Side): Mob | null {
    const bearing = beamOf(side, voyage.heading);
    let best: Mob | null = null;
    let bestDistance = Infinity;
    for (const mob of voyage.mobs) {
      const distance = Math.hypot(mob.x - voyage.x, mob.y - voyage.y);
      if (distance > spec.range || distance >= bestDistance) continue;
      const bearingTo = Math.atan2(mob.y - voyage.y, mob.x - voyage.x);
      if (Math.abs(angleDelta(bearing, bearingTo)) > spec.arc) continue;
      best = mob;
      bestDistance = distance;
    }
    return best;
  }

  // --- rings on the water ---------------------------------------------------
  // Two instanced meshes, and the split is a blending problem rather than a
  // taste one. Instancing has no per-instance alpha — only a per-instance
  // COLOUR — so a thing that has to fade out must fade to black, and fading to
  // black is only invisible under additive blending. A shockwave therefore has
  // to be additive.
  //
  // But additive cannot draw red. Full red laid on this water comes back as
  // pale pink, because the blue is already bright and the sum clips to white:
  // measured, the first build's "about to bite" ring photographed as a wide
  // rose-coloured halo that read as spray. A tell that must be unmistakably
  // RED therefore has to be painted ON the water, not added to it — and it
  // never fades, it appears and it goes, which is exactly what a warning
  // should do.
  const RING_CAP = 20;
  const ringGeometry = new THREE.RingGeometry(0.76, 1, 22).rotateX(-Math.PI / 2);

  /** Locks and tells: paint, so red stays red. */
  const markMesh = new THREE.InstancedMesh(
    ringGeometry,
    new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.88, depthWrite: false,
      side: THREE.DoubleSide, fog: false,
    }),
    RING_CAP
  );
  /** Shockwaves: light, so they can die away to nothing. */
  const shockMesh = new THREE.InstancedMesh(
    ringGeometry,
    new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.95, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    }),
    RING_CAP
  );
  for (const mesh of [markMesh, shockMesh]) {
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 5;
    stage.scene.add(mesh);
  }

  /** A ring thrown by an impact: it expands and fades and is gone. */
  interface Shock { x: number; y: number; life: number; span: number; from: number; to: number; r: number; g: number; b: number }
  const shocks: Shock[] = [];

  function shockAt(x: number, y: number, from: number, to: number, span: number, r: number, g: number, b: number): void {
    if (shocks.length > 12) shocks.shift();
    shocks.push({ x, y, life: span, span, from, to, r, g, b });
  }

  // --- particles ------------------------------------------------------------
  // Powder smoke, splinters, spray and the gold of a claimed site, all in one
  // instanced pool. Additive, so a particle fades by losing colour and the
  // whole system needs no per-instance alpha, which instancing does not have.
  const PARTICLE_CAP = 96;
  interface Particle {
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    life: number; span: number;
    size: number; grow: number; drag: number; gravity: number;
    r: number; g: number; b: number;
  }
  const particles: Particle[] = [];
  const particleMesh = new THREE.InstancedMesh(
    softDisc(),
    new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.95, depthWrite: false,
      blending: THREE.AdditiveBlending, vertexColors: true, fog: false,
    }),
    PARTICLE_CAP
  );
  particleMesh.frustumCulled = false;
  particleMesh.count = 0;
  particleMesh.renderOrder = 6;
  stage.scene.add(particleMesh);

  /**
   * A disc that fades to nothing at its rim.
   *
   * Particles were flat quads, and a flat quad with no texture on it is a
   * SQUARE — every puff of powder smoke in the first four captures of this
   * round photographed as a pale grey rectangle sitting over the creature it
   * was meant to be obscuring. There is no texture to reach for here and none
   * is wanted: a triangle fan from an opaque centre to a transparent rim is the
   * same soft blob for eleven vertices and no image to load.
   */
  function softDisc(): THREE.BufferGeometry {
    const SEGMENTS = 10;
    const position: number[] = [0, 0, 0];
    const colour: number[] = [1, 1, 1, 1];
    const index: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      position.push(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0);
      colour.push(1, 1, 1, 0);
      if (i > 0) index.push(0, i, i + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colour, 4));
    geometry.setIndex(index);
    return geometry;
  }

  /**
   * Randomness with a seed, because a capture must be repeatable.
   *
   * `Math.random` in here would make every screenshot of a broadside a
   * different screenshot, and the harness's whole claim is that the same commit
   * produces the same image.
   */
  const fxRng = new Rng(`${seed}:fx`);

  function emit(p: Partial<Particle> & { x: number; y: number; z: number }): void {
    if (particles.length >= PARTICLE_CAP) particles.shift();
    particles.push({
      vx: 0, vy: 0, vz: 0, life: 0.4, span: 0.4, size: 1, grow: 1, drag: 2.5, gravity: 0,
      r: 1, g: 1, b: 1, ...p,
    });
  }

  /**
   * Powder smoke: slow, growing, and it lifts.
   *
   * SIZED AGAINST THE FRAME, which is the mistake worth writing down. A puff
   * two and a half units across that grows by three and a half ends up eleven
   * units wide, and eleven units is a third of everything the player can see —
   * one cannon shot whited out the creature it was aimed at and both health
   * bars over it. The whole fight lives inside about thirty units, so nothing
   * that decorates it may be more than a few.
   */
  function smoke(x: number, y: number, away: number, force = 1): void {
    for (let i = 0; i < 2; i++) {
      const spread = away + fxRng.range(-0.5, 0.5);
      emit({
        x: x + Math.cos(spread) * i * 1.2, y: SEA_Y + 1.1 + i * 0.4, z: y + Math.sin(spread) * i * 1.2,
        vx: Math.cos(spread) * 5 * force, vy: fxRng.range(1.2, 2.2), vz: Math.sin(spread) * 5 * force,
        life: 0.42 + i * 0.1, span: 0.42 + i * 0.1,
        size: 1.5 * force, grow: 1.9, drag: 3.4,
        r: 0.86, g: 0.84, b: 0.76,
      });
    }
  }

  /** Splinters and sparks: fast, small, and they fall. */
  function sparks(x: number, y: number, count: number, speed: number, r: number, g: number, b: number): void {
    for (let i = 0; i < count; i++) {
      const angle = fxRng.range(0, Math.PI * 2);
      const out = fxRng.range(0.35, 1) * speed;
      emit({
        x, y: SEA_Y + fxRng.range(0.6, 2.2), z: y,
        vx: Math.cos(angle) * out, vy: fxRng.range(3, 9), vz: Math.sin(angle) * out,
        life: fxRng.range(0.22, 0.44), span: 0.44,
        size: fxRng.range(0.3, 0.7), grow: 0.4, drag: 1.2, gravity: 22,
        r, g, b,
      });
    }
  }

  // --- what a creature is worth knowing -------------------------------------
  // A health bar over anything that has been hit, exactly as Pirate Nation's
  // own combat screen does it (reference/sea_combat.png): nothing over a
  // creature at full health, so the bars appearing IS the fight starting.
  const BAR_CAP = 14;
  const BAR_WIDTH = 5.2;
  const BAR_HEIGHT = 0.72;
  const barBack = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x17130e, transparent: true, opacity: 0.9, depthTest: false, fog: false }),
    BAR_CAP
  );
  // Origin at the left edge, so a scale on x empties the bar from the right.
  const barFill = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, depthTest: false, fog: false }),
    BAR_CAP
  );
  for (const mesh of [barBack, barFill]) {
    mesh.frustumCulled = false;
    mesh.count = 0;
    stage.scene.add(mesh);
  }
  // The fill draws AFTER its own plate, and the renderOrder is what says so.
  // Both are transparent and sit at the same place, and three sorts equal
  // renderOrders by view depth — which for two quads a couple of units apart in
  // camera space is a coin toss that changes with the heading. Half the frames
  // came back with every bar painted over its own contents: dark, empty, and
  // indistinguishable from a creature at nought hull.
  barBack.renderOrder = 8;
  barFill.renderOrder = 9;

  // --- the horizon ----------------------------------------------------------
  // A site the player could go and take, seen from three cells out.
  //
  // The streaming radius is about two and a half cells and the fog closes at
  // 150 units, so anything worth sailing to is invisible until it is nearly
  // underneath the ship — which leaves the open sea with nothing to point at
  // and a voyage with no reason to choose one direction over another. Each
  // unclaimed site gets a plume standing over it, coloured by what it is:
  // green for timber and ore, cream for an islet, gold for a wreck, red for a
  // lair. The plumes ignore the fog on purpose. They are the horizon.
  const HORIZON = SEA_CELL * 3.4;
  const BEACON_CAP = 18;
  const beaconMesh = new THREE.InstancedMesh(
    crossedQuads(),
    new THREE.MeshBasicMaterial({
      transparent: true, opacity: 1, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexColors: true, fog: false,
    }),
    BEACON_CAP
  );
  beaconMesh.frustumCulled = false;
  beaconMesh.count = 0;
  beaconMesh.renderOrder = 7;
  stage.scene.add(beaconMesh);

  /**
   * A plume: two tapered vertical sheets crossed through each other.
   *
   * The first attempt was two rectangles, and a rectangle has CORNERS — over
   * the water it read as a pale slab standing beside the island rather than as
   * anything rising off it. This one narrows as it climbs, carries no alpha at
   * all at its sides or its top, and is subdivided up its length so the fade is
   * a gradient instead of two triangles' worth of one.
   */
  function crossedQuads(): THREE.BufferGeometry {
    const position: number[] = [];
    const colour: number[] = [];
    const index: number[] = [];
    const STEPS = 5;
    for (const across of [0, 1]) {
      const base = across * (STEPS + 1) * 2;
      for (let s = 0; s <= STEPS; s++) {
        const t = s / STEPS;
        const halfWidth = 0.5 * (1 - t * 0.62);
        // Nothing at the waterline (a plume has no hard foot), a peak a fifth
        // of the way up, then a long fade into nothing at the top.
        const body = Math.min(1, t * 5) * Math.pow(1 - t, 1.3);
        for (const sx of [-halfWidth, halfWidth]) {
          position.push(across ? 0 : sx, t, across ? sx : 0);
          colour.push(1, 1, 1, body);
        }
      }
      for (let s = 0; s < STEPS; s++) {
        const a = base + s * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colour, 4));
    geometry.setIndex(index);
    return geometry;
  }

  /** What each kind of site burns like. Reef is absent: it pays nothing, and a
   *  marker over one would be an invitation to sail into a rock. */
  const BEACON_TINT: Partial<Record<Site['kind'], [number, number, number]>> = {
    harvest: [0.12, 1.0, 0.28],
    islet: [0.9, 0.82, 0.42],
    wreck: [1.0, 0.62, 0.06],
    lair: [1.0, 0.08, 0.05],
  };

  // --- what is coming, from off the edge of the glass ------------------------
  // The frame is about thirty units across and a hammerdead sees the ship from
  // sixty, so the thing that kills a player is very often not on screen when it
  // decides to. A chevron on the water between the ship and each unseen hunter
  // is the least the sea can say about it.
  const CHEVRON_CAP = 8;
  const chevronMesh = new THREE.InstancedMesh(
    chevronGeometry(),
    // Painted, not added, for the same reason the tell rings are: red added to
    // this blue comes back pink, and pink is not a warning.
    new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.85, depthWrite: false,
      side: THREE.DoubleSide, fog: false,
    }),
    CHEVRON_CAP
  );
  chevronMesh.frustumCulled = false;
  chevronMesh.count = 0;
  chevronMesh.renderOrder = 5;
  stage.scene.add(chevronMesh);

  /** A flat arrowhead pointing along +x, lying on the water. */
  function chevronGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      1, 0, 0, -0.55, 0, 0.85, -0.15, 0, 0, -0.55, 0, -0.85,
    ], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    return geometry;
  }

  // --- shared scratch -------------------------------------------------------
  const pose = new THREE.Object3D();
  const tint = new THREE.Color();

  /**
   * How hard the frame is shaking, and for how long.
   *
   * A hit that only turns the border red is a hit the player reads AFTER it
   * happened. The camera moving is the part that lands in the body.
   */
  let shake = 0;
  let shakePeak = 0;
  let shakePhase = 0;
  function kick(power: number): void {
    shakePeak = Math.max(shakePeak, power);
    shake = 1;
  }

  /** Seconds of white flash left on each struck creature. */
  const flashes = new Map<number, number>();
  /** Seconds of LUNGE left on each creature that just bit — see syncMobs. */
  const lunges = new Map<number, number>();
  let hurt = 0;   // seconds of hull vignette left

  /**
   * Translates one simulation event into something a player can perceive.
   *
   * Every cue is attached to the thing it is about — smoke at the gun that
   * fired, a flash on the creature that was struck, spray and a shaken camera
   * where the hull was bitten — rather than floating in the middle of the
   * screen where none of it says anything about position.
   */
  function feedback(event: SeaEvent): void {
    switch (event.kind) {
      case 'fired': {
        sfx('cannon');
        const side = broadsides[event.side];
        side.flash = 0.16;
        const bearing = beamOf(event.side, voyage.heading);
        const gunX = event.x + Math.cos(bearing) * 3.4;
        const gunY = event.y + Math.sin(bearing) * 3.4;
        smoke(gunX, gunY, bearing, 1);
        sparks(gunX, gunY, 5, 9, 1, 0.82, 0.4);
        shockAt(gunX, gunY, 1.2, 4.4, 0.26, 1, 0.6, 0.16);
        kick(0.22);
        break;
      }
      case 'hit':
        if (event.target === 'ship') {
          sfx('hitHull');
          hurt = 0.42;
          // Spray and a shockwave ON THE SIDE THE BITE CAME FROM, so being hit
          // says where from as well as how much. The event carries the ship's
          // own position, so the direction has to come from whatever is close
          // enough to have done it.
          const from = nearestThreat();
          // And the thing that did it throws itself at the hull, because a bite
          // that costs eleven hull and moves nothing on screen is a number in a
          // corner. See syncMobs for what the lunge does.
          if (from) lunges.set(from.id, 0.22);
          const bearing = from ? Math.atan2(from.y - voyage.y, from.x - voyage.x) : voyage.heading;
          const at = { x: voyage.x + Math.cos(bearing) * 3.2, y: voyage.y + Math.sin(bearing) * 3.2 };
          sparks(at.x, at.y, 9, 11, 1, 0.36, 0.24);
          shockAt(at.x, at.y, 1.4, 5.6, 0.32, 1, 0.16, 0.1);
          kick(0.3 + Math.min(0.55, event.damage / 26));
        } else {
          sfx('hitMob');
          // The creature nearest the impact is the one that took it; the event
          // carries the shot's position rather than an id, and picking the
          // closest is both correct and cheaper than threading one through.
          let best: number | null = null;
          let near = 9;
          for (const mob of voyage.mobs) {
            const d = Math.hypot(mob.x - event.x, mob.y - event.y);
            if (d < near) { near = d; best = mob.id; }
          }
          if (best !== null) flashes.set(best, 0.18);
          sparks(event.x, event.y, 7, 10, 1, 0.94, 0.72);
          shockAt(event.x, event.y, 0.8, 4, 0.24, 1, 0.82, 0.4);
          kick(0.12);
        }
        break;
      case 'mob-killed':
        sfx('mobDown');
        smoke(event.x, event.y, fxRng.range(0, Math.PI * 2), 1.3);
        sparks(event.x, event.y, 14, 13, 1, 0.86, 0.5);
        shockAt(event.x, event.y, 1.4, 7.5, 0.42, 1, 0.66, 0.22);
        kick(0.24);
        break;
      case 'looted':
        sfx('loot');
        shockAt(event.x, event.y, 2.5, 15, 0.6, 1, 0.72, 0.22);
        for (let i = 0; i < 10; i++) {
          const angle = fxRng.range(0, Math.PI * 2);
          const out = fxRng.range(2, 9);
          emit({
            x: event.x + Math.cos(angle) * out, y: SEA_Y + 1, z: event.y + Math.sin(angle) * out,
            vy: fxRng.range(5, 11), life: fxRng.range(0.5, 0.9), span: 0.9,
            size: 0.9, grow: 0.7, drag: 1.4, r: 1, g: 0.82, b: 0.32,
          });
        }
        break;
      case 'sunk':
        sfx('sinking');
        hurt = 1.2;
        kick(0.9);
        smoke(voyage.x, voyage.y, fxRng.range(0, Math.PI * 2), 1.6);
        break;
      default:
        break;
    }
  }

  /** Whatever is closest and hostile — who just bit us, near enough. */
  function nearestThreat(): Mob | null {
    let best: Mob | null = null;
    let near = 26;
    for (const mob of voyage.mobs) {
      const d = Math.hypot(mob.x - voyage.x, mob.y - voyage.y);
      if (d < near) { near = d; best = mob; }
    }
    return best;
  }

  /* --- drawing the fight, once a frame ----------------------------------- */

  /**
   * The arcs and the two gauges.
   *
   * `heat` is the whole legibility argument in one number, and it now goes all
   * the way to ZERO. The version before this one kept a floor under it so the
   * arcs were always faintly on, and the frame said what was wrong with that: a
   * quiet arc is still two lines twenty-six units long lying on open water, and
   * nothing on open water reads as an instrument — it reads as flotsam. There is
   * no alpha at which a long line is unobtrusive; there is only an alpha at
   * which it is dirty.
   *
   * So the sea is empty until something is in reach of the guns, and the arcs
   * COMING UP is the announcement that a fight has started. It is also what
   * frees the shape to be loud when it is drawn, which is the only way a warm
   * line survives being laid on water this bright.
   */
  function drawBroadsides(elapsed: number, dt: number): void {
    arcs.position.set(voyage.x, SEA_Y, voyage.y);

    // How close the nearest creature is, as a fraction of gun range: the arcs
    // fade up over the last half of it.
    let closest = Infinity;
    for (const mob of voyage.mobs) {
      closest = Math.min(closest, Math.hypot(mob.x - voyage.x, mob.y - voyage.y));
    }
    // Measured off the frame rather than off the gun: it used to rise from a
    // third PAST gun range, so a blowfish forty-five units away — twelve units
    // further than the whole width of the picture, invisible, doing nothing —
    // lit both wedges to full. The player's first sight of the sea was two
    // burning arcs with nothing in them.
    //
    // It now starts at the edge of the guns' reach and is SQUARED, which is what
    // keeps the far half of that reach honest: a creature at forty-five units is
    // off the screen and contributes a tenth, one at twenty-five is in the
    // picture and coming for you and contributes nearly all of it.
    const reach = Math.max(0, Math.min(1, (spec.range - closest) / (spec.range * 0.55)));
    const engaged = reach * reach;

    for (const side of SIDES) {
      const gun = broadsides[side];
      const bearing = beamOf(side, voyage.heading);
      const left = side === 'port' ? voyage.reloadPort : voyage.reloadStarboard;
      const charge = spec.reload > 0 ? 1 - Math.min(1, left / spec.reload) : 1;
      const ready = charge >= 1;
      const locked = lockedOn(side) !== null;

      // A side that has nothing to shoot at draws NOTHING. A side with something
      // in the water draws its boundary; a side that has actually chosen a
      // target draws it hot, because it is about to go off and the player should
      // learn to expect it.
      const want = engaged * (locked ? 1 : 0.46) + gun.flash * 1.4;
      gun.heat += (want - gun.heat) * Math.min(1, dt * 9);

      // COLOUR says WHO, alpha says WHETHER. That split is the fix for the thing
      // that defeated three earlier passes: a warm line dimmed by its alpha does
      // not go quiet over this blue, it goes tan, and tan on water is sand. With
      // the resting state gone the line is only ever drawn at a strength where
      // its hue survives, so the colour is free to carry the one distinction
      // that matters — a beam with a target on it is scarlet, a beam that is
      // merely bearing on open water is amber.
      //
      // Both are SATURATED, and that is the lesson of the sandbars: this world
      // has cream sand and blue water in it, so any warm colour that lands
      // between them is read as a beach. There is no pale end of this ramp.
      gun.fanMaterial.color.setRGB(1, locked ? 0.05 : 0.34, locked ? 0.01 : 0.05);
      const lit = Math.min(1, gun.heat * 1.9);
      // Nothing in reach is nothing drawn — four fewer draw calls on an empty
      // sea as well, which on a phone is not nothing either.
      gun.fan.visible = lit > 0.015;
      gun.track.visible = lit > 0.015;
      gun.gauge.visible = lit > 0.015;
      layArc(gun.fan, fanGrid, bearing, spec.arc, FAN_NEAR, FAN_FAR, 0.14, elapsed,
        lit, 0.12 * gun.heat);

      // The gauge: an empty groove off the rail and a charge sweeping out from
      // the beam to fill it. A broadside that just went off reads as spent
      // because its groove is empty, and circling back onto a target while it
      // fills is the rhythm the whole fight is played on.
      //
      // On the same switch as the arcs, and for the same reason: a reload gauge
      // on an empty sea is an instrument reading out a fight that is not
      // happening. Both come up together the moment one does start, which is
      // also how a player learns they are two halves of one idea.
      const span = spec.arc * GAUGE_SPAN;
      layArc(gun.track, trackGrid, bearing, span, GAUGE_NEAR, GAUGE_FAR, 0.16, elapsed, lit);
      layArc(gun.gauge, gaugeGrid, bearing, span * Math.max(0.02, charge),
        GAUGE_NEAR, GAUGE_FAR, 0.2, elapsed, lit);
      const pulse = ready ? 0.93 + 0.07 * Math.sin(elapsed * 5.5) : 0.82;
      gun.gaugeMaterial.opacity = Math.min(1, pulse + gun.flash * 3);
      gun.gaugeMaterial.color.setRGB(1, ready ? 0.34 : 0.14, ready ? 0.04 : 0.015);

      // One dry tick the moment a side comes back. It is the only sound in the
      // game that says "you may fire again", and it is what lets a player keep
      // the rhythm without looking down at the water.
      if (ready && !gun.wasReady) sfx('tick', 4);
      gun.wasReady = ready;
      gun.flash = Math.max(0, gun.flash - dt);
    }
  }

  /**
   * How close a creature is to biting, from 0 to 1.
   *
   * The simulation gives every attack a `cooldown` counting down to the next
   * bite and a `reach` it has to be inside — so the tell is not invented, it is
   * the sim's own timer drawn on the water. A creature still closing gets a
   * weaker version of the same ring, because the first bite of an attack lands
   * with the cooldown already at zero and the approach is the only warning
   * there can be.
   */
  function menaceOf(mob: Mob): number {
    const ms = MOBS[mob.kind];
    const distance = Math.hypot(mob.x - voyage.x, mob.y - voyage.y);
    if (mob.state === 'attack') {
      return Math.max(0.45, 1 - Math.min(1, mob.cooldown / 0.7));
    }
    if (mob.state === 'chase' && distance < ms.reach * 3.4) {
      return Math.max(0, Math.min(0.5, (ms.reach * 3.4 - distance) / (ms.reach * 3)));
    }
    return 0;
  }

  /** Locks, tells and shockwaves. */
  function drawRings(elapsed: number, dt: number): void {
    let marks = 0;
    let waves = 0;
    const place = (
      mesh: THREE.InstancedMesh, index: number,
      x: number, y: number, radius: number, r: number, g: number, b: number
    ): void => {
      pose.position.set(x, SEA_Y + water.surfaceAt(x, y, elapsed).height + 0.22, y);
      pose.rotation.set(0, 0, 0);
      pose.scale.setScalar(radius);
      pose.updateMatrix();
      mesh.setMatrixAt(index, pose.matrix);
      mesh.setColorAt(index, tint.setRGB(r, g, b));
    };

    // Who the guns have chosen, on both sides.
    for (const side of SIDES) {
      const mob = lockedOn(side);
      if (!mob || marks >= RING_CAP) continue;
      const beat = 0.94 + 0.06 * Math.sin(elapsed * 7);
      place(markMesh, marks++, mob.x, mob.y, MOBS[mob.kind].radius * 1.6 * beat, 1, 0.74, 0.2);
    }

    // What is about to bite. Drawn second so a creature that is both locked and
    // lunging shows the red over the gold — the guns can wait, the teeth cannot.
    for (const mob of voyage.mobs) {
      const menace = menaceOf(mob);
      if (menace <= 0.02 || marks >= RING_CAP) continue;
      const radius = MOBS[mob.kind].radius * (1.75 - 0.6 * menace);
      place(markMesh, marks++, mob.x, mob.y, radius, 1, 0.04 + 0.1 * menace, 0.03);
    }

    for (let i = shocks.length - 1; i >= 0; i--) {
      const shock = shocks[i];
      shock.life -= dt;
      if (shock.life <= 0) { shocks.splice(i, 1); continue; }
      if (waves >= RING_CAP) continue;
      const t = 1 - shock.life / shock.span;
      const fade = 1 - t;
      place(shockMesh, waves++, shock.x, shock.y, shock.from + (shock.to - shock.from) * t,
        shock.r * fade, shock.g * fade, shock.b * fade);
    }

    // `visible` as well as `count`: three does not skip an instanced mesh with
    // nothing in it, it issues the draw call anyway, and PLAN.md's budget is a
    // hundred calls for the whole frame. Seven of these were spending seven of
    // them on empty water.
    markMesh.count = marks;
    markMesh.visible = marks > 0;
    shockMesh.count = waves;
    shockMesh.visible = waves > 0;
    markMesh.instanceMatrix.needsUpdate = true;
    shockMesh.instanceMatrix.needsUpdate = true;
    if (markMesh.instanceColor) markMesh.instanceColor.needsUpdate = true;
    if (shockMesh.instanceColor) shockMesh.instanceColor.needsUpdate = true;
  }

  function drawParticles(dt: number): void {
    let n = 0;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      const drag = Math.max(0, 1 - p.drag * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag - p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (n >= PARTICLE_CAP) continue;

      const t = Math.max(0, p.life / p.span);
      pose.position.set(p.x, Math.max(SEA_Y + 0.3, p.y), p.z);
      // Facing the camera, which never turns, so one quaternion does the lot.
      pose.quaternion.copy(stage.camera.quaternion);
      pose.scale.setScalar(p.size * (1 + (1 - t) * p.grow));
      pose.updateMatrix();
      particleMesh.setMatrixAt(n, pose.matrix);
      particleMesh.setColorAt(n, tint.setRGB(p.r * t, p.g * t, p.b * t));
      n++;
    }
    particleMesh.count = n;
    particleMesh.visible = n > 0;
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
  }

  /** A health bar over anything that has been hurt, and over nothing else. */
  function drawBars(elapsed: number): void {
    let n = 0;
    for (const mob of voyage.mobs) {
      const ms = MOBS[mob.kind];
      const fraction = Math.max(0, Math.min(1, mob.hp / ms.hp));
      if (fraction >= 0.999 || n >= BAR_CAP) continue;
      const height = SEA_Y + water.surfaceAt(mob.x, mob.y, elapsed).height + ms.radius * 1.7 + 1.1;

      pose.position.set(mob.x, height, mob.y);
      pose.quaternion.copy(stage.camera.quaternion);
      pose.scale.set(BAR_WIDTH + 0.34, BAR_HEIGHT + 0.34, 1);
      pose.updateMatrix();
      barBack.setMatrixAt(n, pose.matrix);

      // The fill hangs off the bar's left edge, in the camera's own frame, so
      // it empties the way a bar is read whatever the ship is doing.
      pose.translateX(-BAR_WIDTH / 2);
      pose.scale.set(BAR_WIDTH * fraction, BAR_HEIGHT, 1);
      pose.updateMatrix();
      barFill.setMatrixAt(n, pose.matrix);
      barFill.setColorAt(n, fraction > 0.45
        ? tint.setRGB(0.42, 0.88, 0.36)
        : fraction > 0.2 ? tint.setRGB(1, 0.74, 0.2) : tint.setRGB(1, 0.34, 0.26));
      n++;
    }
    barBack.count = n;
    barFill.count = n;
    barBack.visible = n > 0;
    barFill.visible = n > 0;
    barBack.instanceMatrix.needsUpdate = true;
    barFill.instanceMatrix.needsUpdate = true;
    if (barFill.instanceColor) barFill.instanceColor.needsUpdate = true;
  }

  /** Plumes over what is worth sailing to, and chevrons at what is hunting. */
  function drawHorizon(elapsed: number): void {
    let n = 0;

    // HOME GETS A PLUME, and it is the one that was missing.
    //
    // Every place worth sailing to on this sea stands under a column of light,
    // and the most important destination in the game — the only one that turns a
    // hold into resources — had none. The compass says which way and how far and
    // then goes quiet: played end to end, the last beat of a voyage was thirty
    // seconds of circling an INVISIBLE POINT with a needle spinning through a
    // hundred and eighty degrees, hull at four percent, hold full. That is the
    // moment a run is won or lost and the screen was showing nothing at all.
    //
    // Taller and colder than any site, because it must be told apart from them
    // at a glance and because it is a harbour light rather than a prize.
    const homeDistance = Math.hypot(voyage.x, voyage.y);
    // It holds its light right down to the harbour mouth. A site's plume steps
    // aside once the player is on top of the island, because the island is then
    // the thing they can see; home has nothing standing on it, so the light IS
    // the harbour and it has to last until the ship is inside it.
    const homeRise = Math.min(1, Math.max(0, (homeDistance - SEA_CELL * HARBOUR * 0.55) / 14));
    const homeFall = Math.min(1, Math.max(0, (HORIZON * 1.6 - homeDistance) / (SEA_CELL * 0.9)));
    const homeLight = homeRise * homeFall * (0.8 + 0.2 * Math.sin(elapsed * 2.2));
    if (homeLight > 0.02) {
      pose.position.set(0, SEA_Y + 0.4, 0);
      pose.rotation.set(0, 0.4, 0);
      pose.scale.set(6, 30, 6);
      pose.updateMatrix();
      beaconMesh.setMatrixAt(n, pose.matrix);
      beaconMesh.setColorAt(n, tint.setRGB(0.62 * homeLight, 0.95 * homeLight, 1.0 * homeLight));
      n++;
    }

    for (const site of horizon) {
      if (n >= BEACON_CAP) break;
      const colour = BEACON_TINT[site.kind];
      if (!colour || voyage.taken.includes(site.id)) continue;
      const distance = Math.hypot(site.x - voyage.x, site.y - voyage.y);
      // Brightest at the range where the island itself is still a rumour, and
      // out of the way once the player is on top of it.
      const rise = Math.min(1, Math.max(0, (distance - site.radius - 12) / 26));
      const fall = Math.min(1, Math.max(0, (HORIZON - distance) / (SEA_CELL * 0.9)));
      const strength = rise * fall * (0.76 + 0.24 * Math.sin(elapsed * 1.6 + site.x));
      if (strength <= 0.02) continue;

      pose.position.set(site.x, SEA_Y + 0.4, site.y);
      pose.rotation.set(0, site.x * 0.7, 0);
      pose.scale.set(site.radius * 0.3 + 3, 12 + site.radius * 0.7, site.radius * 0.3 + 3);
      pose.updateMatrix();
      beaconMesh.setMatrixAt(n, pose.matrix);
      beaconMesh.setColorAt(n, tint.setRGB(
        colour[0] * strength, colour[1] * strength, colour[2] * strength));
      n++;
    }
    beaconMesh.count = n;
    beaconMesh.visible = n > 0;
    beaconMesh.instanceMatrix.needsUpdate = true;
    if (beaconMesh.instanceColor) beaconMesh.instanceColor.needsUpdate = true;

    let c = 0;
    for (const mob of voyage.mobs) {
      if (c >= CHEVRON_CAP) break;
      if (mob.state === 'patrol') continue;
      // Only for what the player cannot already see. The projection is the
      // honest test — a margin in world units would be wrong the moment the
      // frame changes shape.
      pose.position.set(mob.x, SEA_Y + 1, mob.y).project(stage.camera);
      if (Math.abs(pose.position.x) < 0.92 && Math.abs(pose.position.y) < 0.92) continue;
      const bearing = Math.atan2(mob.y - voyage.y, mob.x - voyage.x);
      const at = { x: voyage.x + Math.cos(bearing) * 21, y: voyage.y + Math.sin(bearing) * 21 };
      // The pulse is in the SIZE rather than the brightness: instancing has no
      // per-instance alpha, and a red that fades by losing colour goes grey.
      const beat = 2.9 + 0.55 * Math.sin(elapsed * 6 + mob.id);
      pose.position.set(at.x, SEA_Y + water.surfaceAt(at.x, at.y, elapsed).height + 0.24, at.y);
      pose.rotation.set(0, -bearing, 0);
      pose.scale.setScalar(beat);
      pose.updateMatrix();
      chevronMesh.setMatrixAt(c, pose.matrix);
      chevronMesh.setColorAt(c, tint.setRGB(1, 0.04, 0.03));
      c++;
    }
    chevronMesh.count = c;
    chevronMesh.visible = c > 0;
    chevronMesh.instanceMatrix.needsUpdate = true;
    if (chevronMesh.instanceColor) chevronMesh.instanceColor.needsUpdate = true;
  }

  /* --- a thumb the harness can hold -------------------------------------- */

  /**
   * How a capture sails.
   *
   * `?sail=hunt` circles whatever is nearest with a beam presented to it, which
   * is the game as designed and therefore the only honest way to photograph a
   * broadside; `?sail=circle` holds the helm over; `?sail=<degrees>` runs a
   * course. `window.__sail` takes the same words, so `--act fight` can start
   * one after the boot has settled.
   *
   * It goes through `applyStick`, which is the point: the capture is steering
   * with the same conversion a thumb steers with, so if that conversion breaks
   * the shot breaks with it.
   */
  let sailing: string | null = shot ? params.get('sail') : null;
  if (shot) window.__sail = (mode: string) => { sailing = mode; };

  function sail(elapsed: number): void {
    if (!sailing) return;
    let course: number;
    if (sailing === 'hunt') {
      // Close until the guns can reach, then turn the beam to it and hold —
      // the manoeuvre the whole design is asking a player to find.
      const mob = voyage.mobs.reduce<Mob | null>((best, mob) => {
        const d = Math.hypot(mob.x - voyage.x, mob.y - voyage.y);
        return !best || d < Math.hypot(best.x - voyage.x, best.y - voyage.y) ? mob : best;
      }, null);
      if (!mob) {
        course = voyage.heading;
      } else {
        const bearing = Math.atan2(mob.y - voyage.y, mob.x - voyage.x);
        const distance = Math.hypot(mob.x - voyage.x, mob.y - voyage.y);
        const circling = distance < spec.range * 0.62;
        // Whichever beam is already closer to bearing, so she does not swap
        // sides every time the creature crosses the bow.
        const side = angleDelta(voyage.heading, bearing) >= 0 ? 1 : -1;
        course = circling ? bearing - side * (Math.PI / 2 - 0.25) : bearing;
      }
    } else if (sailing === 'circle') {
      course = elapsed * 0.6;
    } else {
      course = (Number(sailing) * Math.PI) / 180;
    }
    scripted = { x: Math.cos(course), y: -Math.sin(course), force: 1 };
  }

  // The sim runs on a fixed step and the frame does not, so time is banked and
  // spent in whole steps. Same pattern as the island's economy tick, and the
  // reason a slow frame cannot change how a fight plays out.
  let owed = 0;

  return {
    update(dt, elapsed) {
      carry = elapsed;
      sail(elapsed);
      applyStick();

      owed += Math.min(dt, 0.25);
      let guard = 0;
      while (owed >= SEA_STEP && guard++ < 8) {
        owed -= SEA_STEP;
        const out = stepVoyage(voyage);
        voyage = out.voyage;
        for (const event of out.events) {
          opts.onEvent?.(event);
          // Run in shot mode too. sfx() gates itself on SHOT, and the smoke
          // and flashes advance on the same fixed dt the sim does, so a
          // capture stays deterministic — while a broadside becomes something
          // a critic can actually look at. Hiding it from the harness is how
          // the panning gesture went a whole project without being seen.
          feedback(event);
          if (event.kind === 'sunk') end('sunk');
          if (event.kind === 'home') end('home');
        }
      }

      // The hull rides the swell, and heels into its turn.
      // surfaceAt, not swellAt: the bare function defaults to the ISLAND's
      // amplitude, so the hull was riding a 0.16 sea while the shader drew a
      // different one. water.ts warns about exactly this — a boat bobbing to a
      // sea nobody is drawing — and the scene was doing it.
      const sea = water.surfaceAt(voyage.x, voyage.y, elapsed);
      ship.position.set(voyage.x, SEA_Y + sea.height, voyage.y);
      ship.rotation.y = facing(voyage.heading);
      // Heel is the surface slope, not a fraction of it chosen by eye: a hull
      // that rides a 0.95-unit swell without leaning into it reads as a lift,
      // and the slope is the one number that is already right. Held back to
      // about two thirds, because a real hull's mass lags the water it is on and
      // because the mast is eight units long — at the full slope the topsail
      // sweeps a quarter of the frame.
      ship.rotation.z = -voyage.helm.turn * 0.13 - sea.dx * 0.68;
      ship.rotation.x = -sea.dz * 0.68;
      // Recoil, on the hull's OWN long axis rather than the group's world one:
      // a broadside shoves the ship away from the side that fired, and rolling
      // the model inside the group is the only place that stays true whatever
      // heading she is on. Small on purpose — it is a shove, not a capsize.
      skiff.object.rotation.z =
        (broadsides.port.flash - broadsides.starboard.flash) * 0.55;
      const way = voyage.speed / SHIPS[voyage.shipType].speed;
      for (const quad of wake.children) {
        (quad as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = 0.26 * way;
      }
      // The wake and the hull's shadow are laid on the water itself. Without
      // this they are flat planes through a ship on a 0.95-unit sea, and the
      // sea eats whichever half of them is behind a crest.
      for (const item of afloat) followSea(item.mesh, item.lift, elapsed);

      water.mesh.position.x = Math.round(voyage.x / 2) * 2;
      water.mesh.position.z = Math.round(voyage.y / 2) * 2;
      water.update(elapsed, stage.camera);

      hud?.update(voyage);

      // Advance the cues. Emissive rather than a colour swap, so a struck mob
      // reads as lit up rather than as a different creature.
      for (const [id, left] of flashes) {
        const next = left - dt;
        const entry = mobNodes.get(id);
        if (entry) {
          entry.node.traverse((node) => {
            const mesh = node as THREE.Mesh;
            const material = mesh.material as THREE.MeshStandardMaterial | undefined;
            if (!material?.isMaterial || !('emissive' in material)) return;
            material.emissive?.setScalar(Math.max(0, next) * 4);
          });
        }
        if (next <= 0) flashes.delete(id); else flashes.set(id, next);
      }
      for (const [id, left] of lunges) {
        const next = left - dt;
        if (next <= 0) lunges.delete(id); else lunges.set(id, next);
      }

      if (hurt > 0) {
        hurt = Math.max(0, hurt - dt);
        hud?.setHurt(hurt);
      }
      for (const mixer of mixers) mixer.update(dt);
      syncSites();
      syncMobs();
      syncShots();

      // Everything that says what the fight is doing. After syncMobs, so a
      // creature that appeared this frame already has a place to be marked.
      drawBroadsides(elapsed, dt);
      drawRings(elapsed, dt);
      drawParticles(dt);
      drawBars(elapsed);
      drawHorizon(elapsed);

      // The camera lags the ship a little, which reads as weight and stops a
      // hard turn from whipping the whole frame.
      follow.lerp(new THREE.Vector3(voyage.x, SEA_Y, voyage.y), Math.min(1, dt * 4));
      stage.camera.position.copy(follow).add(CAM_OFFSET);
      // The shake, on top of the follow and never inside it: a hit throws the
      // CAMERA, not the ship, so the frame recovers to exactly where it was.
      // The phase is banked from dt rather than read off the clock, so a frozen
      // capture holds still instead of buzzing at whatever the epoch says.
      if (shake > 0) {
        shakePhase += dt;
        shake = Math.max(0, shake - dt * 3.4);
        const amount = shakePeak * shake * shake;
        stage.camera.position.x += Math.sin(shakePhase * 63) * amount;
        stage.camera.position.y += Math.sin(shakePhase * 47 + 1.7) * amount * 0.7;
        stage.camera.position.z += Math.sin(shakePhase * 55 + 3.1) * amount;
        if (shake <= 0) shakePeak = 0;
      }
      stage.camera.lookAt(follow);
      // Via the stage's own offset, not a triple of this file's. The island's
      // sun was re-solved off the reference (a low, warm 31 degrees) and its
      // shadow frustum's near and far planes are now bracketed around the arm
      // that offset is parked on; a private (49, 80, 35) here put the sea under
      // a different sun from the island it sails out of, and hung the ship's
      // shadow at a different angle from every shadow on the beach it just left.
      stage.aimSun(follow);
    },

    async settle() {
      // A resolved build can queue more work (a site's props load after its
      // sand), so this drains rather than awaiting one batch.
      for (let pass = 0; pass < 12 && inFlight.length; pass++) {
        const batch = inFlight;
        inFlight = [];
        await Promise.all(batch);
        syncSites();
        syncMobs();
      }
    },

    voyage: () => voyage,

    dispose() {
      stick?.dispose();
      hud?.dispose();
      water.dispose();
      delete window.__sail;
      stage.scene.fog = null;
      // The fight layer owns real GPU buffers — six instanced meshes and six
      // lattices — and a voyage can be left and started again all evening.
      // Through a set: the lock ring and the shockwave are the same geometry
      // drawn by two materials, and disposing it twice is a bug waiting for a
      // three.js release that starts caring.
      const spent = new Set<THREE.BufferGeometry>();
      for (const mesh of [markMesh, shockMesh, particleMesh, barBack, barFill, beaconMesh, chevronMesh]) {
        if (!spent.has(mesh.geometry)) {
          spent.add(mesh.geometry);
          mesh.geometry.dispose();
        }
        (mesh.material as THREE.Material).dispose();
      }
      for (const side of SIDES) {
        for (const part of [broadsides[side].fan, broadsides[side].track, broadsides[side].gauge]) {
          part.geometry.dispose();
          (part.material as THREE.Material).dispose();
        }
      }
      for (const grid of [fanGrid, gaugeGrid, trackGrid]) grid.geometry.dispose();
      for (const child of [...stage.scene.children]) {
        if (preexisting.has(child)) continue;
        stage.scene.remove(child);
      }
    },
  };
}

/** The sim's cell size, re-exported so the HUD can say how far out you are. */
export { SEA_CELL };
