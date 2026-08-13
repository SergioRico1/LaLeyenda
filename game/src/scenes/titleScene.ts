import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Stage } from '../render/stage';
import { Water } from '../render/water';
import { instantiate, type ModelInstance } from '../render/assets';
import { REDUCED, SHOT } from '../ui/env';
import { peekSavedGame } from '../core/save';
import {
  buildersFree, claimableQuests, dailyAvailable, isProducer, readyCount, tick, type GameState,
} from '../sim';
import { createTitlePanel, type TitlePanel } from '../ui/panels/title';

/**
 * titleScene.ts — the main menu, standing on real water.
 *
 * PRODUCTION.md §1 asks for "an animated sea behind it rather than a static
 * plate — we already have the water and it is the best thing we own", and that
 * is the whole reason the title is a SCENE at all rather than a panel the
 * router mounts on its own: it owns something on the stage, so it has to be
 * disposed like the island and the sea are.
 *
 * WHAT IS BEHIND THE MENU, and why in this order.
 *
 * The screen boots before anything else in the game, so the rule that decides
 * every choice here is: nothing a player waits for. The frame is interactive
 * with the water alone — a shader and one plane — and everything else arrives
 * without being awaited:
 *
 *   · the sky, the clouds, four landfalls with their palms, two sea stacks, the
 *     gulls and the flotsam are all BUILT, not loaded — boxes merged per
 *     colour, so the whole world outside the hull costs about nine draw calls
 *     and zero bytes over the wire. A horizon assembled from tree_palm.glb
 *     would have been half a megabyte to draw forty pixels of frond.
 *   · the sloop is the ONLY model, 167 KB, fetched after the panel is up and
 *     added whenever it lands. Nothing on screen waits for it.
 *
 * `settle()` is what the screenshot harness waits on, so a capture photographs
 * the finished frame rather than the first 200ms of it.
 *
 * EVERYTHING MOVES OFF `elapsed`, NEVER OFF AN ACCUMULATOR. The shot path
 * advances the scene to a fixed simulated time and renders twice; a drift that
 * integrated dt would land somewhere slightly different on every run and no
 * capture in this project would be comparable to the last.
 */

export interface TitleScene {
  update(dt: number, elapsed: number): void;
  settle(): Promise<void>;
  dispose(): void;
}

export interface TitleSceneOptions {
  returning: boolean;
  captainName?: string | null;
  onPlay(): void;
  onSettings(): void;
}

/* --------------------------------------------------------------------------
 * the shared backdrop
 * ----------------------------------------------------------------------- */

/**
 * Open water and nothing else, for a screen that is mostly menu.
 *
 * Shared with the captain screen, which needs the same thing for the same
 * reason — a creation screen floating on a flat colour reads as a form. It
 * lives here rather than in a fourth module because it is twenty lines and one
 * of the two callers owns it; the day a third screen wants it, it moves to
 * render/.
 */
export interface SeaBackdrop {
  /** The live surface, so a caller can float something on it. Anything riding
   *  this sea must ask `surfaceAt`, never the bare `swellAt` — that function
   *  defaults to the ISLAND's amplitude and a hull on a 0.16 sea under a shader
   *  drawing a 0.95 one was a real bug here. */
  readonly water: Water;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

export function createSeaBackdrop(
  stage: Stage,
  opts: { look?: 'wide' | 'near'; size?: number } = {}
): SeaBackdrop {
  // Everything this puts on the stage comes off again on dispose, and the only
  // reliable way to know what that is, is to remember what was already there.
  const preexisting = new Set(stage.scene.children);

  // The open-sea settings, matched to seaScene so the menu and the voyage are
  // recognisably the same ocean: no shore SDF (there is no island to break
  // against), crest foam rather than surf, and a swell with real height.
  const water = new Water({
    size: opts.size ?? 620, palette: 'ocean', glitter: 0.42, caps: 0.5, lane: 0, reef: 1,
    wave: 0.95, waveStep: 0.95 / 4,
  });
  stage.scene.add(water.mesh);

  // The same fog and the same horizon colour the voyage uses, so the sky meets
  // the water at the same seam rather than at a hard line.
  const priorFog = stage.scene.fog;
  stage.scene.fog = new THREE.Fog(0x6fbcd6, 150, 340);

  // Low and level, unlike the island's three-quarter view: this camera is
  // composing a HORIZON, and it wants the sky the wordmark sits against.
  const near = opts.look === 'near';
  const at = new THREE.Vector3(0, 0, near ? -34 : -60);
  stage.camera.position.set(0, near ? 9 : 12, near ? 26 : 34);
  stage.camera.lookAt(at);
  stage.aimSun(new THREE.Vector3(0, 0, 0));

  return {
    water,
    update(_dt, elapsed) {
      water.update(elapsed, stage.camera);
    },
    dispose() {
      water.dispose();
      stage.scene.fog = priorFog;
      for (const child of [...stage.scene.children]) {
        if (preexisting.has(child)) continue;
        stage.scene.remove(child);
      }
    },
  };
}

/* --------------------------------------------------------------------------
 * the frame
 *
 * Every number below was solved against a 430x932 portrait frame at the
 * stage's 38-degree vertical FOV, then checked in a capture. A point on the
 * water at horizontal distance D lands at
 *     y = 0.5 + tan(atan(CAM_Y / D) - PITCH) / tan(19deg) / 2
 * of the frame height, which is what fixes the horizon at 37% and puts the
 * hull at just over half height, clear of both the wordmark and the CTA.
 * ----------------------------------------------------------------------- */

/** Camera height above the still waterline. Low: this is a sea-level shot. */
const CAM_Y = 9.4;
const CAM_Z = 26;
/** Degrees below horizontal. Sets where the horizon sits and nothing else. */
const PITCH = 5.0;
/**
 * Horizontal distance to the hero.
 *
 * Close enough that the hull is the second-biggest object in the frame after
 * the wordmark, and that its mast breaks the horizon — a boat entirely below
 * the waterline reads as scenery, and this one is the subject.
 */
const SHIP_D = 60;

/**
 * The hero is the SLOOP, not the player's starting skiff.
 *
 * The skiff is a rowing boat with a flagpole. Photographed at title size it is
 * a raft with a stick on it, and "a drifting ship silhouette" is carried
 * entirely by a sail — which is why the reference's own dock and combat frames
 * both put the sloop's skull canvas in the middle of the picture. 167 KB and
 * one fetch, for the only asset this screen downloads.
 *
 * fit normalises the FOOTPRINT (max of x and z), and this hull is 33.8 x 82.2
 * in plan under a 97-unit rig, so 11 units of length draws about 13 units of
 * mast — the number that puts the topmast above the horizon line.
 */
const HERO_MODEL = 'ship_sloop';
const HERO_FIT = 11;
/** How far the hull sits into the water. The model's origin is its keel, so
 *  without this the whole ship rides on the surface like a paper boat. */
const HERO_DRAFT = 0.72;
/** Big enough that the far edge of the plane is lost in the haze rather than
 *  drawn as a line across the sky. 1000 keeps its far corners inside the
 *  stage camera's 800-unit far plane. */
const SEA_SIZE = 1000;

/* --------------------------------------------------------------------------
 * built scenery
 * ----------------------------------------------------------------------- */

/** A box in world space, ready to be merged into a colour batch. */
function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Batches of geometry, keyed by the material they will be drawn with. */
type Batches = Map<string, THREE.BufferGeometry[]>;

const push = (batches: Batches, key: string, geometry: THREE.BufferGeometry): void => {
  const list = batches.get(key);
  if (list) list.push(geometry);
  else batches.set(key, [geometry]);
};

/**
 * A palm, as a silhouette.
 *
 * Forty pixels tall through half a kilometre of haze, so what matters is the
 * bent trunk and the star of fronds — the shape that says "Pirate Nation" from
 * across a room. The real tree_palm.glb would be 63 KB to draw exactly this.
 */
function palm(batches: Batches, x: number, y: number, z: number, h: number, lean: number): void {
  const segments = 4;
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const w = 0.62 - t * 0.2;
    push(batches, 'trunk', box(
      w, h / segments + 0.1, w,
      x + lean * t * t * h * 0.34, y + h * (t + 0.5 / segments), z
    ));
  }
  const top = new THREE.Vector3(x + lean * h * 0.34, y + h, z);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const frond = new THREE.BoxGeometry(h * 0.52, 0.34, 1.5);
    frond.rotateZ(-0.34);
    frond.translate(h * 0.26, -h * 0.03, 0);
    frond.rotateY(a);
    frond.translate(top.x, top.y, top.z);
    push(batches, 'leaf', frond);
  }
}

/**
 * A landfall — and the shape is the whole decision.
 *
 * The first pass built rocky mesas and they photographed as concrete blocks:
 * terracing is invisible at forty pixels and grey is grey. Our own world is
 * a LOW SAND PAD with a green cap and palms standing off it, which is the
 * Pirate Nation silhouette, and it is legible at any size because the height
 * comes from the palms rather than from the land. So the land is two slabs and
 * the trees do the drawing.
 */
function landfall(
  batches: Batches,
  opts: { x: number; z: number; width: number; palms: number; rocks?: number; seed: number }
): void {
  const { x, z, width } = opts;
  const depth = width * 0.66;

  // Wet shelf, then beach, then the grass plot standing proud of it. Three
  // bands is what makes a pad read as a shore instead of as a plinth.
  push(batches, 'shelf', box(width * 1.26, 0.9, depth * 1.3, x, -0.35, z));
  push(batches, 'sand', box(width, 2.4, depth, x, 0.9, z));
  push(batches, 'grass', box(width * 0.74, 1.5, depth * 0.66, x, 2.6, z));

  for (let i = 0; i < (opts.rocks ?? 0); i++) {
    const a = opts.seed * 1.3 + i * 2.7;
    const s = 2.6 + 2.4 * Math.abs(Math.sin(a * 1.9));
    push(batches, 'rock', box(
      s, s * (0.7 + 0.5 * Math.abs(Math.cos(a))), s * 0.9,
      x + Math.sin(a) * width * 0.56, 1.4 + s * 0.4, z + Math.cos(a * 2.1) * depth * 0.4
    ));
  }

  for (let i = 0; i < opts.palms; i++) {
    const a = opts.seed + i * 1.9;
    palm(
      batches,
      x + Math.sin(a * 1.7) * width * 0.34,
      3.2,
      z + Math.cos(a * 2.3) * depth * 0.26,
      width * (0.27 + 0.06 * Math.sin(a * 3.1)),
      Math.sin(a * 2.7) * 0.5
    );
  }
}

/**
 * A sea stack: a slender rock column standing in open water.
 *
 * Four low pads across the horizon draw one flat band, and a flat band is a
 * backdrop. One vertical breaks it and gives the eye a landmark to measure the
 * ship against — and the reference's own open-sea frame is full of them.
 */
function seaStack(
  batches: Batches,
  opts: { x: number; z: number; height: number; width: number; seed: number }
): void {
  const { x, z, height, width } = opts;
  push(batches, 'shelf', box(width * 2.0, 0.8, width * 1.7, x, -0.3, z));
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const w = width * (1 - t * 0.44);
    const lean = Math.sin(opts.seed + i * 1.6) * width * 0.16;
    push(batches, 'rock', box(
      w, height / tiers + 0.5, w * 0.86,
      x + lean, 0.2 + (height / tiers) * (i + 0.5), z
    ));
  }
  // A green scalp, because every rock in this world has one.
  push(batches, 'grass', box(width * 0.62, 0.8, width * 0.54, x, height + 0.4, z));
}

/**
 * A cloud, drawn the way the voxel world draws one: flat white caps over a
 * cooler underside, with no shading in between.
 *
 * Lit clouds were the first attempt and they came back grey, because the sun is
 * behind and above so every camera-facing face is the unlit one. A cloud is
 * a light source in a frame like this, not a lit object — so the material is
 * unlit and the form comes from two tones stacked, which is also exactly what
 * the reference paints.
 */
function cloud(batches: Batches, x: number, y: number, z: number, s: number): void {
  const base: [number, number, number, number, number, number][] = [
    [1.00, 0.30, 0.72, 0.00, 0.00, 0.00],
    [0.60, 0.24, 0.54, -0.46, -0.02, 0.10],
    [0.48, 0.20, 0.46, 0.56, -0.03, -0.08],
  ];
  const caps: [number, number, number, number, number, number][] = [
    [0.66, 0.30, 0.56, -0.10, 0.24, 0.02],
    [0.42, 0.22, 0.40, 0.30, 0.16, -0.06],
    [0.34, 0.34, 0.34, -0.02, 0.42, 0.04],
    [0.30, 0.16, 0.30, -0.50, 0.14, 0.06],
  ];
  for (const [w, h, d, dx, dy, dz] of base) {
    push(batches, 'cloudBase', box(w * s, h * s, d * s, x + dx * s, y + dy * s, z + dz * s));
  }
  for (const [w, h, d, dx, dy, dz] of caps) {
    push(batches, 'cloudTop', box(w * s, h * s, d * s, x + dx * s, y + dy * s, z + dz * s));
  }
}

/** Merges a colour batch into one mesh, or nothing if the batch is empty. */
function batchMesh(
  batches: Batches, key: string, material: THREE.Material
): THREE.Mesh | null {
  const list = batches.get(key);
  if (!list?.length) return null;
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = `title_${key}`;
  return mesh;
}

/**
 * The sky, as a gradient rather than the stage's flat clear colour.
 *
 * Written as vertex colours on a dome instead of a shader, because a gradient
 * is four numbers and a custom material here would be four hundred lines of
 * risk for the same pixels. `toneMapped:false` matters: the water writes its
 * colours straight out (its shader carries no tonemapping chunk), so the sky
 * has to as well or the two disagree by exactly one tone curve at the seam
 * where they meet.
 */
function buildSky(): THREE.Mesh {
  // 64 height segments, and they are all needed. Vertex colours are only
  // evaluated AT vertices, and a default 18-segment dome puts one row every ten
  // degrees — so the whole visible band, which is fourteen degrees tall, held
  // two rows and every stop below was interpolated away into one straight line.
  const geometry = new THREE.SphereGeometry(640, 32, 64);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);

  // Bottom to top, and the RANGE is the whole trick. The camera sits 5 degrees
  // below level with a 19-degree half-angle, so the top of a portrait frame is
  // only 14 degrees above the horizon — sin(14) = 0.24. A ramp spread over the
  // full dome spends four fifths of itself on sky this screen never shows, and
  // the first pass did exactly that: measured across the visible band it moved
  // by nine units of luminance, which is a flat plate with extra steps.
  //
  // Compressed into 0 → 0.26 it sweeps pale haze at the waterline to a real
  // blue at the top of the frame, which is also what gives a GOLD wordmark
  // something to sit against. The lowest stop is near the ocean palette's own
  // horizon colour so the far water resolves into the sky instead of ending at
  // a line.
  const stops: [number, string][] = [
    [-0.25, '#79C6DD'],
    [0.005, '#B3E6F1'],
    [0.05, '#8FD8EC'],
    [0.13, '#63B4E2'],
    [0.26, '#3D8DCD'],
    [1.00, '#2C6FB8'],
  ];
  const ramp = stops.map(([at, hex]) => ({ at, color: new THREE.Color(hex) }));
  const c = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp(position.getY(i) / 640, -1, 1);
    let lo = ramp[0];
    let hi = ramp[ramp.length - 1];
    for (let s = 0; s < ramp.length - 1; s++) {
      if (t >= ramp[s].at && t <= ramp[s + 1].at) { lo = ramp[s]; hi = ramp[s + 1]; break; }
    }
    const span = hi.at - lo.at;
    c.copy(lo.color).lerp(hi.color, span > 0 ? THREE.MathUtils.clamp((t - lo.at) / span, 0, 1) : 0);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false,
  }));
  mesh.name = 'title_sky';
  mesh.renderOrder = -3;          // before the water, which is at -1
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * A soft round smudge, for the two things that seat a hull in water: the dark
 * contact under it and the pale foam collar around it.
 *
 * A hard-edged disc reads as a plastic washer at any size, and a hull with
 * nothing under it reads as a sticker laid on the sea — the same note the
 * voyage scene left about its own blob. 32x32 is plenty: it is only ever seen
 * as a thin ellipse at this camera angle.
 */
function smudgeTexture(): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Paints a whole geometry one colour, so a batch can carry several. */
function tint(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const count = geometry.attributes.position.count;
  const c = new THREE.Color(hex);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Flotsam: a crate and a barrel, adrift near the camera.
 *
 * They exist for depth. Everything else in the frame lives between 60 and 500
 * units out, which flattens the water into a painted floor — the strip between
 * the hero and the thumb zone was simply empty blue in four captures running.
 * Two small objects at forty units give the eye a near plane to measure the
 * rest against, and a pirate sea with wreckage on it is also just a better
 * story than a pirate sea without.
 */
function buildCrate(): THREE.BufferGeometry {
  return mergeGeometries([
    tint(box(1.5, 1.15, 1.5, 0, 0, 0), 0xa8783f),
    tint(box(1.58, 0.20, 1.58, 0, 0.34, 0), 0x7a5127),
    tint(box(1.58, 0.20, 1.58, 0, -0.34, 0), 0x7a5127),
  ], false) ?? box(1.5, 1.15, 1.5, 0, 0, 0);
}

function buildBarrel(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.62, 0.56, 1.5, 8);
  const hoopA = new THREE.CylinderGeometry(0.66, 0.66, 0.16, 8);
  hoopA.translate(0, 0.42, 0);
  const hoopB = new THREE.CylinderGeometry(0.66, 0.66, 0.16, 8);
  hoopB.translate(0, -0.42, 0);
  return mergeGeometries(
    [tint(body, 0xb08447), tint(hoopA, 0x4d3d2a), tint(hoopB, 0x4d3d2a)],
    false
  ) ?? body;
}

/* --------------------------------------------------------------------------
 * the dock — what fills the lower third
 *
 * Round 11's audit: "the title's lower third is empty navy with two stray
 * planks floating in it". The fix is a FOREGROUND, not more flotsam: a
 * weathered pier enters at the bottom-right corner and recedes toward the
 * hero, so the player is standing somewhere — on the dock their captain
 * sails from — instead of treading water in the open sea. It also gives the
 * empty band its three missing planes: near timber, mid posts, far lantern.
 *
 * Built like the rest of the scene: tinted boxes merged into ONE mesh on the
 * flotsam's vertex-coloured lambert, zero bytes over the wire, one draw call.
 * Only the lantern core, its halo and the foam collars are separate, because
 * they are unlit or they move.
 * ----------------------------------------------------------------------- */

/** Near end of the pier, in world x/z. Off the bottom-right corner: the first
 *  bay bleeds out of frame, which is what makes it a place the camera stands
 *  rather than an object placed in shot. */
const PIER_START = { x: 4.4, z: CAM_Z - 12.5 };
/** Far tip. Right of the hero's wake — the first pass ended at x 0.9 and the
 *  lantern hung over the sloop's stern with the glow kissing the hull. */
const PIER_END = { x: 2.0, z: CAM_Z - 30 };
/** Deck height over the still waterline. The swell is 0.95, so the boards sit
 *  clear of the crests but the piles visibly wade. */
const PIER_DECK = 1.55;
const PIER_HALF_W = 1.32;

/** Timber palette. Warm, sun-bleached top, dark wet feet — the values every
 *  harbour in the reference reads as. */
const WOOD_DECK = 0xb9894d;
const WOOD_BEAM = 0x8a6234;
const WOOD_PILE = 0x74512b;
const WOOD_WET = 0x46331d;
const WOOD_DARK = 0x5d4023;
const ROPE_HEMP = 0xc9a15e;
const IRON_DARK = 0x38322c;

/** Nudges a hex colour's channels by a factor — the per-plank value jitter
 *  that keeps a merged deck from reading as one extruded slab. */
function shade(hex: number, factor: number): number {
  const c = new THREE.Color(hex).multiplyScalar(factor);
  return c.getHex();
}

interface DockBuild {
  /** All the timber, merged: goes on the shared vertex-colour lambert. */
  geometry: THREE.BufferGeometry;
  /** Where the lantern hangs, world space. */
  lantern: THREE.Vector3;
  /** Deck-top of the mooring bollard the gull perches on. */
  perch: THREE.Vector3;
  /** Piles standing in open water, for the foam collars. */
  collars: { x: number; z: number }[];
}

/**
 * The pier, plank by plank.
 *
 * Everything is authored in pier space — s along the deck from the near end,
 * w across it — and rotated into place, so the whole structure can be re-aimed
 * by moving two constants when a capture says the diagonal is wrong.
 */
function buildDock(): DockBuild {
  const dir = new THREE.Vector2(PIER_END.x - PIER_START.x, PIER_END.z - PIER_START.z);
  const length = dir.length();
  dir.divideScalar(length);
  const side = new THREE.Vector2(-dir.y, dir.x);
  const yaw = Math.atan2(dir.x, dir.y);

  const parts: THREE.BufferGeometry[] = [];
  /** A box `along` long (pier s), `across` wide (pier w), centred at (s, y, w). */
  const timber = (
    across: number, h: number, along: number,
    s: number, y: number, w: number, color: number,
    pitch = 0
  ): void => {
    const g = new THREE.BoxGeometry(across, h, along);
    if (pitch) g.rotateX(pitch);
    g.rotateY(yaw);
    g.translate(
      PIER_START.x + dir.x * s + side.x * w,
      y,
      PIER_START.z + dir.y * s + side.y * w
    );
    parts.push(tint(g, color));
  };

  // Deck boards, laid across. The jitter is the whole trick: a half-voxel of
  // lift and a few points of value per board is what reads as carpentry
  // rather than as one extruded slab with stripes painted on.
  const step = 1.06;
  for (let i = 0, s = 0.55; s < length - 0.3; s += step, i++) {
    const j = Math.sin(i * 12.9898) * 43758.5453;
    const r = j - Math.floor(j);
    timber(
      PIER_HALF_W * 2 + 0.22 + r * 0.1, 0.16, 0.92,
      s + (r - 0.5) * 0.06, PIER_DECK - 0.08 + (r - 0.5) * 0.045, (r - 0.5) * 0.1,
      shade(WOOD_DECK, 0.88 + 0.24 * ((i * 5) % 7) / 7)
    );
  }

  // Stringers the boards rest on, running the pier's length.
  for (const w of [-0.98, 0.98]) {
    timber(0.26, 0.3, length + 0.4, length / 2, PIER_DECK - 0.31, w, WOOD_BEAM);
  }

  // Pile pairs, every bay. Two stacked boxes each: dry above the waterline,
  // a darker, slightly fatter wet foot below — the island's own "stands IN
  // its water" note, applied to furniture.
  const collars: { x: number; z: number }[] = [];
  const pileAt = (s: number, w: number): void => {
    timber(0.42, 1.3, 0.42, s, 0.78, w, WOOD_PILE);
    timber(0.46, 1.7, 0.46, s, -0.72, w, WOOD_WET);
    collars.push({
      x: PIER_START.x + dir.x * s + side.x * w,
      z: PIER_START.z + dir.y * s + side.y * w,
    });
  };
  const bays: number[] = [];
  for (let s = 1.1; s < length; s += 4.3) bays.push(s);
  for (const s of bays) {
    // At ±1.08 the heads photographed as loose cubes sitting ON the deck;
    // at ±1.22 they stand flush with the plank ends, where pier legs live.
    for (const w of [-1.22, 1.22]) {
      pileAt(s, w);
      // Pile heads standing proud of the boards: the rhythm every drawn pier
      // has, and the only part of the legs this camera reliably sees.
      timber(0.4, 0.34, 0.4, s, PIER_DECK + 0.12, w, WOOD_PILE);
    }
    // Cross beam tying the pair under the stringers.
    timber(PIER_HALF_W * 2 + 0.5, 0.24, 0.34, s, PIER_DECK - 0.55, 0, WOOD_DARK);
  }
  // One diagonal brace on the camera side of the near bays: the X-ray of
  // every pirate dock ever drawn, spent only where the frame can read it.
  // (With this pier's heading, the face the camera sees is the w-NEGATIVE
  // side — solved from the dot of the side vector against the camera ray.)
  timber(0.16, 0.16, 4.1, bays[0] + 2.15, 0.62, -1.28, WOOD_DARK, 0.24);
  timber(0.16, 0.16, 4.1, bays[1] + 2.15, 0.62, -1.28, WOOD_DARK, -0.24);

  // The mooring bollard the gull owns, on the camera side of the THIRD bay —
  // solved against the frame: the second bay's bollard stood at 97% of the
  // width, which is a bird nobody sees. Here it rises at the CTA's right
  // shoulder, proud of the deck, with a cap and a rope collar.
  const PERCH_S = bays[2] ?? length / 2;
  timber(0.36, 1.9, 0.36, PERCH_S, PIER_DECK + 0.85, -1.12, WOOD_DARK);
  timber(0.52, 0.2, 0.52, PERCH_S, PIER_DECK + 1.86, -1.12, WOOD_PILE);
  timber(0.44, 0.18, 0.44, PERCH_S, PIER_DECK + 1.32, -1.12, ROPE_HEMP);

  // The lantern post at the tip — the warm point the whole diagonal walks to.
  // The arm reaches ACROSS the pier to the far (w+) side: along-pier is all
  // depth from this camera and the first arm put the lamp visually ON its own
  // post; across-pier is nearly horizontal on screen, so the lamp hangs clear
  // of the post and over the swell beyond the far plank ends.
  const TIP_S = length - 0.7;
  timber(0.3, 2.9, 0.3, TIP_S, PIER_DECK + 1.35, -0.1, WOOD_DARK);
  timber(1.5, 0.14, 0.14, TIP_S, PIER_DECK + 2.72, 0.7, WOOD_DARK);
  const lantern = new THREE.Vector3(
    PIER_START.x + dir.x * TIP_S + side.x * 1.42,
    PIER_DECK + 2.42,
    PIER_START.z + dir.y * TIP_S + side.y * 1.42
  );
  // The gull stands ON the lamp arm — the third bollard was tried first and
  // the bird photographed straight against the lantern post, seven units of
  // pier being pure depth from this camera. On the arm it is silhouetted
  // against open water, at the halo's edge.
  const perch = new THREE.Vector3(
    PIER_START.x + dir.x * TIP_S + side.x * 0.42,
    PIER_DECK + 2.79,
    PIER_START.z + dir.y * TIP_S + side.y * 0.42
  );
  // The cage: two iron plates and a little roof. The glowing core between
  // them is a separate unlit mesh, added by the scene.
  const cage = (across: number, h: number, along: number, y: number): void => {
    const g = new THREE.BoxGeometry(across, h, along);
    g.rotateY(yaw);
    g.translate(lantern.x, y, lantern.z);
    parts.push(tint(g, IRON_DARK));
  };
  cage(0.46, 0.1, 0.46, lantern.y - 0.3);
  cage(0.5, 0.1, 0.5, lantern.y + 0.26);
  cage(0.34, 0.12, 0.34, lantern.y + 0.37);

  // Harbour clutter on the near boards: two crates and a barrel on its side,
  // plus a coiled line. Reuses the flotsam builders, so the cargo on the dock
  // and the cargo in the water are visibly the same goods.
  const place = (g: THREE.BufferGeometry, s: number, w: number, y: number, turn: number, scale: number): void => {
    g.scale(scale, scale, scale);
    g.rotateY(turn);
    g.translate(
      PIER_START.x + dir.x * s + side.x * w,
      y,
      PIER_START.z + dir.y * s + side.y * w
    );
    parts.push(g);
  };
  place(buildCrate(), 2.1, -0.55, PIER_DECK + 0.62, 0.5, 1.05);
  place(buildCrate(), 3.25, -0.72, PIER_DECK + 0.5, -0.25, 0.85);
  const lying = buildBarrel();
  lying.rotateZ(Math.PI / 2);
  place(lying, 4.9, 0.62, PIER_DECK + 0.42, 0.35, 0.9);
  // The coil: eight hemp segments in a ring. A torus would be the one smooth
  // object in a cubic world. On the camera edge just short of the bollard,
  // where the band between the two buttons can actually see it.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const seg = new THREE.BoxGeometry(0.42, 0.14, 0.2);
    seg.rotateY(a + Math.PI / 2);
    seg.translate(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
    place(tint(seg, shade(ROPE_HEMP, 0.9 + (i % 3) * 0.08)), 8.4, -0.52, PIER_DECK + 0.15, 0, 1);
  }

  const geometry = mergeGeometries(parts, false) ?? new THREE.BoxGeometry(1, 1, 1);
  for (const g of parts) g.dispose();
  return { geometry, lantern, perch, collars };
}

/** Rest angle of a gull's wing above the horizontal — the dihedral. */
const GULL_DIHEDRAL = 0.34;

/**
 * One gull: a body and two wings that beat.
 *
 * Two details do all the work, and both were learned from a capture where the
 * birds came back looking like drones:
 *
 *   · the wings sit at a DIHEDRAL. Flat wings on a fuselage read as an
 *     aeroplane from any angle; a shallow V reads as a bird from every angle,
 *     which is why a gull is drawn as an M in every picture ever made.
 *   · the tips are a soft grey, not charcoal. Black tips at this size turned
 *     the whole bird into a dark cross; the grey only has to beat the cloud
 *     behind it, and pure white did not.
 *
 * Vertex colours rather than a second material, so it stays three meshes.
 */
function buildGull(material: THREE.Material): { node: THREE.Group; wings: THREE.Mesh[] } {
  // Small. A gull the size of the reference's own birds is about thirty pixels
  // on this frame, and every version of this that was legible as anatomy read
  // as an aircraft instead — at eye level the dihedral projects to a straight
  // bar, so the only thing that says "bird" is the size and the beat.
  const node = new THREE.Group();
  node.scale.setScalar(0.42);
  const body = new THREE.Mesh(
    mergeGeometries([
      tint(box(0.46, 0.34, 1.7, 0, 0, 0), 0xfbfdfa),
      tint(box(0.30, 0.22, 0.44, 0, 0.06, -1.02), 0xfbfdfa),   // head
      tint(box(0.22, 0.26, 0.62, 0, 0.02, 1.02), 0x8fa0a8),    // tail
    ], false) ?? new THREE.BoxGeometry(0.46, 0.34, 1.7),
    material
  );
  node.add(body);

  const wings: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const inner = tint(box(1.10, 0.11, 0.58, side * 0.55, 0, -0.05), 0xfbfdfa);
    const tip = tint(box(0.46, 0.11, 0.34, side * 1.32, 0, 0.04), 0x778b95);
    const wing = new THREE.Mesh(mergeGeometries([inner, tip], false) ?? inner, material);
    wing.rotation.z = side * -GULL_DIHEDRAL;
    wings.push(wing);
    node.add(wing);
  }
  return { node, wings };
}

/**
 * A gull STANDING, as its own rig — not the flying gull with its wings bent.
 *
 * The flying build's wings only pivot on z, so "folded" made a Λ under the
 * body and the perched bird photographed first as a white tube, then as a
 * pinwheel. A standing gull is a different silhouette: plump chest, head up
 * on a neck, tail cocked, wings lying flat along the flanks — and an ORANGE
 * BEAK, which at eighteen pixels is the single strongest "this is a bird"
 * cue the frame can carry. Eight tinted boxes on the shared gull material.
 */
function buildPerchedGull(material: THREE.Material): { node: THREE.Group; wings: THREE.Mesh[] } {
  const node = new THREE.Group();
  node.scale.setScalar(0.62);
  const body = new THREE.Mesh(
    mergeGeometries([
      tint(box(0.46, 0.38, 1.02, 0, 0, 0.05), 0xfbfdfa),          // body
      tint(box(0.34, 0.30, 0.42, 0, 0.28, -0.42), 0xfbfdfa),      // head
      tint(box(0.09, 0.09, 0.26, 0, 0.26, -0.72), 0xd98a2b),      // beak
      tint(box(0.20, 0.10, 0.52, 0, 0.10, 0.72), 0x8fa0a8),       // tail, cocked
      tint(box(0.06, 0.18, 0.06, 0.10, -0.27, -0.08), 0xd98a2b),  // legs
      tint(box(0.06, 0.18, 0.06, -0.10, -0.27, -0.08), 0xd98a2b),
    ], false) ?? new THREE.BoxGeometry(0.46, 0.38, 1.0),
    material
  );
  node.add(body);

  const wings: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(
      mergeGeometries([
        tint(box(0.10, 0.26, 0.92, side * 0.27, 0.04, 0.14), 0xe8efef),
        tint(box(0.10, 0.16, 0.30, side * 0.27, 0.02, 0.68), 0x778b95),  // folded tip
      ], false) ?? new THREE.BoxGeometry(0.1, 0.26, 0.9),
      material
    );
    wings.push(wing);
    node.add(wing);
  }
  return { node, wings };
}

/* --------------------------------------------------------------------------
 * what is waiting
 * ----------------------------------------------------------------------- */

/**
 * The returning player's one line, drawn from RETENTION.md's own hooks.
 *
 * Ordered by UI_SPEC §4.8's next-action resolver, because that is the priority
 * the rest of the game already answers with: a free builder outranks a ready
 * chest, which outranks a claimable reward, which outranks stock sitting in a
 * producer. The panel shows the first two and no more.
 *
 * This is a retention surface, so it names a CONCRETE thing with a number on
 * it. "Tienes tareas pendientes" would be the version of this line that nobody
 * ever comes back for.
 */
function waitingFor(state: GameState, now: number): string[] {
  const lines: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const free = buildersFree(state, now);
  if (free > 0) lines.push(plural(free, 'carpintero libre', 'carpinteros libres'));

  const chests = readyCount(state);
  if (chests > 0) lines.push(plural(chests, 'cofre listo', 'cofres listos'));

  if (dailyAvailable(state, now)) lines.push('recompensa diaria');

  const quests = claimableQuests(state);
  if (quests > 0) lines.push(plural(quests, 'misión lista', 'misiones listas'));

  const ready = state.buildings.filter((b) => isProducer(b) && b.stock >= 1).length;
  if (ready > 0) lines.push(plural(ready, 'edificio por recoger', 'edificios por recoger'));

  return lines;
}

/** The capture's fixed answer, so a shot of the returning title is the same
 *  picture every run and never touches this browser's IndexedDB. */
const SHOT_WAITING = ['1 carpintero libre', '2 cofres listos'];

/* --------------------------------------------------------------------------
 * the scene
 * ----------------------------------------------------------------------- */

export async function createTitleScene(stage: Stage, opts: TitleSceneOptions): Promise<TitleScene> {
  const backdrop = createSeaBackdrop(stage, { size: SEA_SIZE });
  const { water } = backdrop;
  const disposables: Array<{ dispose(): void }> = [];
  let disposed = false;

  // Ours, not the backdrop's: the landfalls sit 340 units out and the voyage's
  // 150-340 fog would have erased them completely. Nothing else in this scene
  // is fogged, so the range exists purely to hold the horizon back.
  //
  // Restored by backdrop.dispose(), which puts back the fog it found — not the
  // one it set.
  stage.scene.fog = new THREE.Fog(0x8CCFE3, 200, 620);

  /* --- sky ---------------------------------------------------------------- */
  const sky = buildSky();
  stage.scene.add(sky);
  disposables.push({ dispose: () => { sky.geometry.dispose(); (sky.material as THREE.Material).dispose(); } });

  /* --- horizon, clouds, birds --------------------------------------------- */
  const batches: Batches = new Map();

  // Three landfalls, so the horizon has a near, a middle and a far — one flat
  // silhouette across the top of the water is a backdrop, three at different
  // hazes is a place. The right-hand pad is the subject; the far left one
  // leaves the frame, which is what stops the composition from listing.
  //
  // The x values are solved against the frame, not chosen: this camera sees
  // 9 degrees either side of its axis, so half the picture at distance D is
  // D x 0.159 units wide. A pad centred beyond that is a pad nobody sees, and
  // the first pass put three of the four almost entirely off the right edge.
  landfall(batches, { x: 27, z: CAM_Z - 200, width: 30, palms: 4, rocks: 1, seed: 1.7 });
  landfall(batches, { x: 52, z: CAM_Z - 380, width: 38, palms: 4, rocks: 2, seed: 5.3 });
  landfall(batches, { x: -46, z: CAM_Z - 340, width: 34, palms: 4, rocks: 1, seed: 4.1 });
  landfall(batches, { x: -14, z: CAM_Z - 520, width: 20, palms: 2, seed: 2.6 });
  seaStack(batches, { x: -30, z: CAM_Z - 250, height: 16, width: 4.6, seed: 0.8 });
  seaStack(batches, { x: -22.5, z: CAM_Z - 262, height: 9.5, width: 3.2, seed: 3.4 });

  // A broken bank hugging the horizon, sized and placed so it lands in the
  // 24-34% band of the frame: high enough to be sky, low enough to leave the
  // wordmark the top fifth to itself.
  //
  // BROKEN is the operative word. Seven at the first sizes merged into one
  // unbroken white wall across the frame, which is weather, not clouds — the
  // gaps between them are the only thing that says how far away they are.
  cloud(batches, -34, 18.4, CAM_Z - 190, 11);
  cloud(batches, 30, 20.0, CAM_Z - 225, 10);
  cloud(batches, -6, 24.2, CAM_Z - 300, 14);
  cloud(batches, 70, 25.4, CAM_Z - 315, 12);
  cloud(batches, -84, 27.6, CAM_Z - 355, 15);
  cloud(batches, 126, 29.0, CAM_Z - 400, 14);

  const materials: Record<string, THREE.Material> = {
    // Wet sand, dry sand, grass: the home island's own three, so the horizon is
    // made of the same place the player is about to stand on.
    shelf: new THREE.MeshLambertMaterial({ color: 0xe3c9a4 }),
    sand: new THREE.MeshLambertMaterial({ color: 0xf7e2be }),
    grass: new THREE.MeshLambertMaterial({ color: 0xa5c146 }),
    // Warmer than the island's own 0xa5a6a8. A cool grey at this distance, with
    // fog pulling it further toward blue, photographed as poured concrete;
    // the reference's cliffs are a grey-TAN and they sit with the sand.
    rock: new THREE.MeshLambertMaterial({ color: 0xa79e90 }),
    trunk: new THREE.MeshLambertMaterial({ color: 0xa9793f }),
    leaf: new THREE.MeshLambertMaterial({ color: 0x3f9a5c }),
    // Clouds and gulls are UNLIT and unfogged. The sun is behind and above, so
    // every camera-facing face of a lit cloud is the dark one — the first pass
    // came back as a row of grey slabs for exactly that reason. A cloud in this
    // frame is a light, and the form comes from the two tones, not the lambert.
    cloudBase: new THREE.MeshBasicMaterial({ color: 0xcfe6f2, fog: false }),
    cloudTop: new THREE.MeshBasicMaterial({ color: 0xfdffff, fog: false }),
    gull: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }),
  };
  for (const material of Object.values(materials)) disposables.push(material);

  const clouds: THREE.Mesh[] = [];
  for (const key of Object.keys(materials)) {
    const mesh = batchMesh(batches, key, materials[key]);
    if (!mesh) continue;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    stage.scene.add(mesh);
    if (key.startsWith('cloud')) clouds.push(mesh);
    disposables.push({ dispose: () => mesh.geometry.dispose() });
  }

  // Three gulls on slow, offset circles. Real birds, not sprites: they bank
  // into the turn, which is the half of "a gull" a still frame can show.
  //
  // The orbits are SMALL because the frame is: a portrait phone at this FOV
  // sees about 9 degrees either side of the axis, so at 70 units out the whole
  // picture is 22 units wide. The first pass flew them on 15-unit radii and
  // every one of them spent the capture off the right-hand edge.
  const gulls = [
    { ...buildGull(materials.gull), cx: 4, cy: 13.4, cz: CAM_Z - 62, rx: 6, rz: 5, sp: 0.115, ph: 0.0 },
    { ...buildGull(materials.gull), cx: -7, cy: 14.6, cz: CAM_Z - 80, rx: 8, rz: 6, sp: 0.088, ph: 2.4 },
    { ...buildGull(materials.gull), cx: 8, cy: 12.4, cz: CAM_Z - 52, rx: 5, rz: 4, sp: 0.142, ph: 4.3 },
  ];
  for (const gull of gulls) {
    stage.scene.add(gull.node);
    disposables.push({ dispose: () => { for (const w of gull.wings) w.geometry.dispose(); } });
    const body = gull.node.children[0] as THREE.Mesh;
    disposables.push({ dispose: () => body.geometry.dispose() });
  }

  /* --- the hero ----------------------------------------------------------- */
  // The two flat things that seat a hull: a foam collar at the waterline and a
  // contact shadow under it. Both are laid ON the swell every frame rather than
  // on a plane through the ship, because a 0.95-unit sea puts one crest under
  // the bow and the next under the stern.
  const smudge = smudgeTexture();
  disposables.push(smudge);
  const seat = new THREE.Group();
  seat.visible = false;
  seat.name = 'title_seat';
  const flats: THREE.Mesh[] = [];
  for (const spec of [
    { r: 4.4, color: 0x0d3350, opacity: 0.20, lift: 0.02 },
    { r: 6.4, color: 0xf2fbf8, opacity: 0.46, lift: 0.06 },
  ]) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.r * 2, spec.r * 2),
      new THREE.MeshBasicMaterial({
        map: smudge, color: spec.color, transparent: true, opacity: spec.opacity,
        depthWrite: false, fog: false,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = spec.lift;
    mesh.renderOrder = 1;
    flats.push(mesh);
    seat.add(mesh);
    disposables.push({
      dispose: () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); },
    });
  }
  // Both are elongated along the hull, not round: a circle around a boat is a
  // lily pad, and a round stain under one is a stain.
  flats[0].scale.set(1.25, 0.62, 1);
  flats[1].scale.set(1.30, 0.74, 1);
  stage.scene.add(seat);

  // Flotsam, on the near plane. Vertex-coloured so both pieces share one lit
  // material with the rest of the built world.
  const flotsamMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  disposables.push(flotsamMaterial);
  // Inside the frame, and that needs saying because the first placement was not:
  // half the picture at 45 units out is 7.2 units wide, and all three pieces
  // were parked at 6 to 9.
  // Both near pieces drift on the LEFT now: the dock owns the right, and a
  // piece of cargo peeking past the CTA's left shoulder is what keeps that
  // corner from going back to plain navy. Crates, not barrels — a floating
  // barrel at this camera's pitch photographs as a flat tan disc.
  const flotsam = [
    { mesh: new THREE.Mesh(buildCrate(), flotsamMaterial), x: -4.2, z: CAM_Z - 45, spin: 0.09, ph: 0.0, sink: 0.16 },
    { mesh: new THREE.Mesh(buildCrate(), flotsamMaterial), x: -5.1, z: CAM_Z - 30, spin: -0.07, ph: 1.9, sink: 0.22 },
    { mesh: new THREE.Mesh(buildCrate(), flotsamMaterial), x: 1.2, z: CAM_Z - 58, spin: 0.05, ph: 3.6, sink: 0.20 },
  ];
  for (const piece of flotsam) {
    piece.mesh.name = 'title_flotsam';
    // Big enough, and floating high enough, to read as a BOX. Sunk to a third
    // at this camera's twelve degrees of downward view they photographed as
    // flat tan quadrilaterals — driftwood, not cargo.
    piece.mesh.scale.setScalar(1.55);
    stage.scene.add(piece.mesh);
    disposables.push({ dispose: () => piece.mesh.geometry.dispose() });
  }

  /* --- the dock ----------------------------------------------------------- */
  const dock = buildDock();
  const dockMesh = new THREE.Mesh(dock.geometry, flotsamMaterial);
  dockMesh.name = 'title_dock';
  stage.scene.add(dockMesh);
  disposables.push({ dispose: () => dock.geometry.dispose() });

  // The lamp burns even in daylight — same rule as the island's brazier: the
  // one hot accent is an EMITTER, and it is what the Jugar → lantern → sloop
  // diagonal is walking toward. Core is unlit and untonemapped so it stays
  // hotter than anything the sun touches.
  const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false, fog: false });
  const flame = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.44, 0.28), flameMaterial);
  flame.name = 'title_lantern';
  flame.position.copy(dock.lantern);
  stage.scene.add(flame);
  disposables.push(flameMaterial, { dispose: () => flame.geometry.dispose() });

  // ADDITIVE, and that is the fix for a real capture bug: normal blending
  // composites mid-orange OVER a brighter sky, which darkens — the first halo
  // photographed as a puff of brown smoke. Additive can only add light.
  const haloMaterial = new THREE.SpriteMaterial({
    map: smudge, color: 0xff9a3d, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const halo = new THREE.Sprite(haloMaterial);
  halo.position.copy(dock.lantern);
  halo.scale.setScalar(2.7);
  stage.scene.add(halo);
  disposables.push(haloMaterial);

  // A small warm pool on the timber and the swell below the lamp. One light,
  // tight falloff: the sun still owns the frame, and at 13 units of reach the
  // first pass painted the sloop's stern orange from across the water.
  const glow = new THREE.PointLight(0xffb45e, 7, 8.5, 2);
  glow.position.copy(dock.lantern);
  stage.scene.add(glow);
  disposables.push({ dispose: () => glow.dispose() });

  // Foam collars where the piles wade — the "stands IN its water" note,
  // applied to furniture. Laid on the moving swell each frame, and only for
  // the pairs far enough out to be inside the frame at all.
  const collarMaterial = new THREE.MeshBasicMaterial({
    map: smudge, color: 0xeefaf6, transparent: true, opacity: 0.4, depthWrite: false, fog: false,
  });
  const collarGeometry = new THREE.PlaneGeometry(2.0, 2.0);
  disposables.push(collarMaterial, { dispose: () => collarGeometry.dispose() });
  const collars = dock.collars
    .filter((c) => c.z < PIER_START.z - 3.5)
    .map((c) => {
      const mesh = new THREE.Mesh(collarGeometry, collarMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 1;
      stage.scene.add(mesh);
      return { mesh, x: c.x, z: c.z };
    });

  // The harbourmaster: one gull STANDING on the lamp arm, with an occasional
  // wing-shuffle and a slow scan of the horizon. The cheapest "something
  // alive" the lower third can carry.
  const perched = buildPerchedGull(materials.gull);
  perched.node.position.copy(dock.perch);
  perched.node.position.y += 0.17;
  stage.scene.add(perched.node);
  disposables.push({ dispose: () => { for (const w of perched.wings) w.geometry.dispose(); } });
  disposables.push({ dispose: () => (perched.node.children[0] as THREE.Mesh).geometry.dispose() });

  let hero: ModelInstance | null = null;
  let mixer: THREE.AnimationMixer | null = null;

  /* --- the menu ----------------------------------------------------------- */
  const uiRoot = document.getElementById('ui');
  let panel: TitlePanel | null = null;
  if (uiRoot) {
    panel = createTitlePanel({
      returning: opts.returning,
      captainName: opts.captainName,
      onPlay: opts.onPlay,
      onSettings: opts.onSettings,
    });
    uiRoot.append(panel.el);
  }

  /**
   * The one thing that is fetched rather than built, awaited by nobody except
   * `settle`. 167 KB, and the frame is already a sea and a menu without it.
   */
  const loading = (async () => {
    try {
      const instance = await instantiate(HERO_MODEL, { fit: HERO_FIT, clip: 'Idle' });
      if (disposed) return;
      hero = instance;
      mixer = instance.mixer;
      instance.object.name = 'title_hero';
      stage.scene.add(instance.object);
      seat.visible = true;
    } catch (err) {
      console.warn('[title] the ship did not load; the sea carries on without it', err);
    }
  })();

  /**
   * What is waiting, off the save, after the frame is already up.
   *
   * A capture must never depend on what is in this browser's IndexedDB, so a
   * shot answers from a fixture exactly as the router does for `returning`.
   */
  const summary = (async () => {
    if (!opts.returning) return;
    if (SHOT) { panel?.setWaiting(SHOT_WAITING); return; }
    try {
      const saved = await peekSavedGame();
      if (disposed || !saved) return;
      // Advanced to now first: half of what is waiting — the producers that
      // filled and the chest that finished — only exists once the offline
      // catch-up has run. Reading the stored instant would under-report the
      // island on exactly the visit that matters most.
      const now = Date.now();
      panel?.setWaiting(waitingFor(tick(saved, now).state, now));
    } catch (err) {
      console.warn('[title] could not summarise the save', err);
    }
  })();

  /* --- the frame ---------------------------------------------------------- */

  const target = new THREE.Vector3();
  const shipAt = new THREE.Vector3();

  function frame(elapsed: number): void {
    // A camera adrift, not a camera on rails: three sines with unrelated
    // periods, so the motion never visibly repeats and never arrives anywhere.
    //
    // Held still under `prefers-reduced-motion`. §5 keeps every state change
    // when motion is cut and drops travel, and a drifting CAMERA is the one
    // thing in this scene that is pure travel — the swell, the birds and the
    // hull keep moving, because the sea is the content, not an animation.
    const roam = REDUCED ? 0 : 1;
    const sway = Math.sin(elapsed * 0.043) * 1.9 * roam;
    const rise = Math.sin(elapsed * 0.027) * 0.42 * roam;
    const yaw = THREE.MathUtils.degToRad(Math.sin(elapsed * 0.031) * 1.15 * roam);
    const pitch = THREE.MathUtils.degToRad(PITCH + Math.sin(elapsed * 0.019) * 0.3 * roam);

    const camera = stage.camera;
    camera.position.set(sway, CAM_Y + rise, CAM_Z);
    const reach = 100;
    target.set(
      camera.position.x + Math.sin(yaw) * reach,
      camera.position.y - Math.tan(pitch) * reach,
      camera.position.z - Math.cos(yaw) * reach
    );
    camera.lookAt(target);

    // The sloop makes no way — she lies to, rolling on the swell, which is the
    // only honest thing for a boat with nobody at the helm. It wanders across
    // about eight units on a two-minute period so the frame is never twice the
    // same and never composed differently.
    // Placed as a FRACTION of the frame rather than in world units, because the
    // menu moves and the hull has to stay out of its way: portrait stacks the
    // crest over the buttons and leaves the left third of the middle band free,
    // landscape puts the crest left and the buttons right and leaves the CENTRE
    // free. A fixed world x gave one of the two a boat behind the wordmark.
    // Landscape sits her a tenth LEFT of centre, not on it: the dock's lamp
    // stands near world x 2, which in landscape projects to mid-frame, and at
    // +0.02 the arm read as rigging bolted to her stern.
    const halfFrame = SHIP_D * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const shipX = (camera.aspect < 1 ? -0.30 : -0.10) * halfFrame
      + Math.sin(elapsed * 0.052) * 2.2;
    const shipZ = CAM_Z - SHIP_D + Math.sin(elapsed * 0.037) * 4;
    const sea = water.surfaceAt(shipX, shipZ, elapsed);
    shipAt.set(shipX, sea.height, shipZ);

    const heading = -0.62 + Math.sin(elapsed * 0.041) * 0.12;
    if (hero) {
      hero.object.position.set(shipAt.x, shipAt.y - HERO_DRAFT, shipAt.z);
      // Three-quarter on, bow to port, drifting through a few degrees of yaw.
      hero.object.rotation.y = heading;
      // Heel is the surface slope itself, damped the way a hull's mass damps
      // it — the same two thirds the voyage uses, for the same reason.
      hero.object.rotation.z = -sea.dx * 0.68;
      hero.object.rotation.x = -sea.dz * 0.68;
    }
    // Laid ON the swell rather than on a plane through the boat, and tilted
    // with it: a flat disc under a hull riding one crest while its own shadow
    // sits on the next is the artefact this avoids.
    seat.position.set(shipX, sea.height, shipZ);
    seat.rotation.set(sea.dz * 0.9, heading, -sea.dx * 0.9);

    // Flotsam rides the same swell the hull does, sunk to about a third of its
    // height and turning on the water. It wanders a couple of units so the near
    // plane is never twice the same either.
    for (const piece of flotsam) {
      const x = piece.x + Math.sin(elapsed * 0.031 + piece.ph) * 1.3;
      const z = piece.z + Math.cos(elapsed * 0.026 + piece.ph) * 1.1;
      const bob = water.surfaceAt(x, z, elapsed);
      piece.mesh.position.set(x, bob.height - piece.sink, z);
      piece.mesh.rotation.set(-bob.dz * 0.8, elapsed * piece.spin + piece.ph, bob.dx * 0.8);
    }

    // The pile collars ride the swell the piles stand in; without this they
    // hover at still-water height while a 0.95-unit sea heaves through them.
    for (const collar of collars) {
      const at = water.surfaceAt(collar.x, collar.z, elapsed);
      collar.mesh.position.set(collar.x, at.height + 0.05, collar.z);
    }

    // Lantern flicker: two unrelated sines, small — a lamp, not a strobe.
    const flick = Math.sin(elapsed * 7.3) * 0.5 + Math.sin(elapsed * 11.9 + 1.7) * 0.5;
    haloMaterial.opacity = 0.46 + flick * 0.06;
    glow.intensity = 7 + flick * 1.1;

    // The perched gull: folded wings, a slow scan of the horizon, and every
    // seven seconds or so a little flutter — enough life to catch the eye
    // without competing with the three in the air.
    const cycle = (elapsed + 2.6) % 7.3;
    const settle = cycle < 0.8 ? Math.sin((cycle / 0.8) * Math.PI) : 0;
    // Faced three-quarters toward the sloop, scanning a little: enough yaw
    // that the body never lines up with the arm and vanishes into it.
    perched.node.rotation.y = 0.85 + Math.sin(elapsed * 0.23) * 0.32;
    perched.node.position.y = dock.perch.y + 0.17 + settle * 0.09;
    // At rest the wings lie tucked on the flanks; the shuffle half-opens
    // them for a beat. Positive z on the −x wing swings its tip out-down.
    const open = settle * (0.75 + Math.sin(elapsed * 24) * 0.3);
    perched.wings[0].rotation.z = open;
    perched.wings[1].rotation.z = -open;

    // The whole bank is two merged meshes, so it drifts as one — a sine rather
    // than a wrap, because a wrap on a merged batch teleports every cloud in it
    // at the same instant.
    const drift = Math.sin(elapsed * 0.0125) * 26;
    for (const bank of clouds) bank.position.x = drift;

    for (const gull of gulls) {
      const a = elapsed * gull.sp + gull.ph;
      gull.node.position.set(
        gull.cx + Math.sin(a) * gull.rx,
        gull.cy + Math.sin(a * 2.1) * 0.7,
        gull.cz + Math.cos(a) * gull.rz
      );
      // Facing the tangent of its own circle, and banked into it.
      gull.node.rotation.y = Math.atan2(Math.cos(a) * gull.rx, -Math.sin(a) * gull.rz);
      gull.node.rotation.z = Math.cos(a) * 0.34;
      const beat = Math.sin(elapsed * 3.1 + gull.ph) * 0.55;
      gull.wings[0].rotation.z = GULL_DIHEDRAL - beat;
      gull.wings[1].rotation.z = -GULL_DIHEDRAL + beat;
    }

    stage.aimSun(shipAt);
  }

  return {
    update(dt, elapsed) {
      backdrop.update(dt, elapsed);
      mixer?.update(dt);
      frame(elapsed);
    },
    async settle() {
      await Promise.all([loading, summary]);
    },
    dispose() {
      disposed = true;
      panel?.dispose();
      if (hero) stage.scene.remove(hero.object);
      for (const item of disposables) item.dispose();
      // Last: it takes the water down and sweeps every child this scene added
      // off the stage, so nothing above may rely on the objects still existing.
      backdrop.dispose();
    },
  };
}
