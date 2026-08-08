import * as THREE from 'three';
import { Stage } from '../render/stage';
import { Water, swellAt } from '../render/water';
import { instantiate, preload, type ModelInstance } from '../render/assets';
import { Rng } from '../core/rng';
import { createStick, type Stick } from '../ui/stick';
import { createSeaHud, type SeaHud } from '../ui/seaHud';
import { sfx } from '../ui/sfx';
import {
  MOBS, SEA_CELL, SEA_RANGE, SEA_STEP, SHIPS, sitesNear, startVoyage, steer, stepVoyage,
  type MobKind, type SeaEvent, type Site, type Voyage,
} from '../sim/sea';

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
  // Measured against reference/sea_combat.png, which is the open-sea frame and
  // a completely different animal from the island one: it runs mean 97 with 18%
  // of its pixels carrying any gradient and almost NO white at all (L>200 under
  // 7% in every band, dark navy below). At the island's gains this scene came
  // out at mean 129, 47% detail and up to 36% white — a bright flecked field
  // where the reference has deep water. Foam out here is weather, not surf.
  const water = new Water({ size: 620, palette: 'ocean', glitter: 0.2, caps: 0.22 });
  water.mesh.position.y = SEA_Y;
  stage.scene.add(water.mesh);

  stage.scene.fog = new THREE.Fog(0x82b0a7, 150, 340);

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
  ship.add(blobShadow(5.2));

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
  const CAM_OFFSET = new THREE.Vector3(26, 34, 32);
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
  function blobShadow(radius: number): THREE.Object3D {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 12),
      new THREE.MeshBasicMaterial({
        color: 0x04203f, transparent: true, opacity: 0.34, depthWrite: false,
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.05;
    disc.renderOrder = 0;
    return disc;
  }

  function buildWake(): THREE.Object3D {
    const group = new THREE.Group();
    const geometry = new THREE.PlaneGeometry(1.6, 16, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -9);
    for (const side of [-1, 1]) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xdff2ef, transparent: true, opacity: 0.34, depthWrite: false,
      });
      const quad = new THREE.Mesh(geometry, material);
      quad.position.set(side * 1.5, 0.06, 0);
      quad.renderOrder = 1;
      group.add(quad);
    }
    return group;
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
    const shelf = new THREE.Mesh(
      new THREE.CylinderGeometry(site.radius * 1.5, site.radius * 1.6, 0.3, 9),
      new THREE.MeshLambertMaterial({ color: 0x3fa8c4 })
    );
    shelf.position.y = -0.24;
    group.add(shelf);

    const sand = new THREE.Mesh(
      new THREE.CylinderGeometry(site.radius, site.radius * 1.12, 1.5, 9),
      new THREE.MeshLambertMaterial({ color: 0xe8d9b4 })
    );
    sand.position.y = 0.4;
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

  /** Creates and recycles the site objects around the ship. */
  function syncSites(): void {
    const near = sitesNear(seed, voyage.x, voyage.y, SEA_RANGE * 1.3);
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
      const sea = swellAt(mob.x, mob.y, carry);
      entry.node.position.copy(toWorld(mob.x, mob.y, at));
      entry.node.position.y += sea.height;
      entry.node.rotation.y = facing(mob.heading);
      entry.node.rotation.x = -sea.dz * 1.4;
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

  /** Turns the thumb's direction into a helm the simulation understands. */
  function applyStick(): void {
    if (!stick) return;
    if (!stick.held || stick.force < 0.08) {
      voyage = steer(voyage, { turn: 0, throttle: 0 });
      return;
    }
    // Screen up is world -z, so the stick's y maps to -z and its x to +x.
    const wanted = Math.atan2(-stick.y, stick.x);
    let delta = (wanted - voyage.heading) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    voyage = steer(voyage, {
      // Proportional, so a small correction is a small correction. Saturates
      // well before a right angle, which is what makes hard turns feel decisive.
      turn: Math.max(-1, Math.min(1, delta * 2.2)),
      throttle: stick.force,
    });
  }

  /**
   * What a hit LOOKS like.
   *
   * The simulation already said everything that happens out here; none of it
   * was visible. A cannon fired with no flash, a mob took damage with no
   * reaction, and the hull lost a third of itself with nothing on screen but a
   * bar quietly shortening in a corner. A fight the player cannot read is a
   * fight they cannot play.
   *
   * Three cues, each attached to the thing it is about rather than floating in
   * the middle of the screen: powder smoke at the gun that fired, a white flash
   * on the creature that was struck, and a red vignette when it is the player.
   */
  const flashes = new Map<number, number>();   // mob id -> seconds of flash left
  let hurt = 0;                                 // seconds of hull vignette left
  const puffs: { x: number; y: number; life: number; node: THREE.Mesh }[] = [];

  const puffGeometry = new THREE.PlaneGeometry(3.4, 3.4);
  const puffMaterial = new THREE.MeshBasicMaterial({
    color: 0xf2f6f4, transparent: true, opacity: 0.8, depthWrite: false,
  });

  function puffAt(x: number, y: number): void {
    if (puffs.length > 14) return;
    const node = new THREE.Mesh(puffGeometry, puffMaterial.clone());
    node.rotation.x = -Math.PI / 2;
    node.position.set(x, SEA_Y + 1.2, y);
    node.renderOrder = 2;
    stage.scene.add(node);
    puffs.push({ x, y, life: 0.42, node });
  }

  /** Translates one simulation event into something a player can perceive. */
  function feedback(event: SeaEvent): void {
    switch (event.kind) {
      case 'fired':
        sfx('cannon');
        puffAt(event.x, event.y);
        break;
      case 'hit':
        if (event.target === 'ship') {
          sfx('hitHull');
          hurt = 0.42;
        } else {
          sfx('hitMob');
          // The mob nearest the impact is the one that took it; the event
          // carries the shot's position rather than an id, and picking the
          // closest is both correct and cheaper than threading one through.
          let best: number | null = null;
          let near = 9;
          for (const mob of voyage.mobs) {
            const d = Math.hypot(mob.x - event.x, mob.y - event.y);
            if (d < near) { near = d; best = mob.id; }
          }
          if (best !== null) flashes.set(best, 0.16);
        }
        break;
      case 'mob-killed':
        sfx('mobDown');
        puffAt(event.x, event.y);
        break;
      case 'looted':
        sfx('loot');
        break;
      case 'sunk':
        sfx('sinking');
        hurt = 1.2;
        break;
      default:
        break;
    }
  }

  // The sim runs on a fixed step and the frame does not, so time is banked and
  // spent in whole steps. Same pattern as the island's economy tick, and the
  // reason a slow frame cannot change how a fight plays out.
  let owed = 0;

  return {
    update(dt, elapsed) {
      carry = elapsed;
      applyStick();

      owed += Math.min(dt, 0.25);
      let guard = 0;
      while (owed >= SEA_STEP && guard++ < 8) {
        owed -= SEA_STEP;
        const out = stepVoyage(voyage);
        voyage = out.voyage;
        for (const event of out.events) {
          opts.onEvent?.(event);
          // Run in shot mode too. sfx() gates itself on SHOT, and the puffs
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
      const sea = swellAt(voyage.x, voyage.y, elapsed);
      ship.position.set(voyage.x, SEA_Y + sea.height, voyage.y);
      ship.rotation.y = facing(voyage.heading);
      ship.rotation.z = -voyage.helm.turn * 0.13 - sea.dx * 1.2;
      ship.rotation.x = -sea.dz * 1.2;
      const way = voyage.speed / SHIPS[voyage.shipType].speed;
      for (const quad of wake.children) {
        (quad as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = 0.34 * way;
      }

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

      for (let i = puffs.length - 1; i >= 0; i--) {
        const puff = puffs[i];
        puff.life -= dt;
        const t = Math.max(0, puff.life / 0.42);
        const material = puff.node.material as THREE.MeshBasicMaterial;
        material.opacity = t * 0.8;
        puff.node.scale.setScalar(1 + (1 - t) * 1.5);
        puff.node.position.y = SEA_Y + 1.2 + (1 - t) * 1.4;
        if (puff.life <= 0) {
          stage.scene.remove(puff.node);
          material.dispose();
          puffs.splice(i, 1);
        }
      }

      if (hurt > 0) {
        hurt = Math.max(0, hurt - dt);
        hud?.setHurt(hurt);
      }
      for (const mixer of mixers) mixer.update(dt);
      syncSites();
      syncMobs();
      syncShots();

      // The camera lags the ship a little, which reads as weight and stops a
      // hard turn from whipping the whole frame.
      follow.lerp(new THREE.Vector3(voyage.x, SEA_Y, voyage.y), Math.min(1, dt * 4));
      stage.camera.position.copy(follow).add(CAM_OFFSET);
      stage.camera.lookAt(follow);
      stage.sun.position.copy(follow).add(new THREE.Vector3(49, 80, 35));
      stage.sun.target.position.copy(follow);
      stage.sun.target.updateMatrixWorld();
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
      stage.scene.fog = null;
      for (const child of [...stage.scene.children]) {
        if (preexisting.has(child)) continue;
        stage.scene.remove(child);
      }
    },
  };
}

/** The sim's cell size, re-exported so the HUD can say how far out you are. */
export { SEA_CELL };
