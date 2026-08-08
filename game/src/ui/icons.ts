import * as THREE from 'three';
import { loadModel, loadManifest } from '../render/assets';

/**
 * icons.ts — HUD icons, baked from voxel props through the game's own renderer.
 *
 * Why not CSS shapes: §0.2 says every UI object is a physical thing lit from
 * directly overhead, and §6.6 says its icon must overhang the container. A
 * flat CSS coin next to a flat-shaded voxel island is the single loudest way
 * to say "HTML pasted over a game". Baking the props through the same
 * WebGLRenderer, with the same warm sun + cool hemisphere rig as
 * render/stage.ts, means the icons are lit by the same light as the world.
 *
 * Why not the .glb library for everything: it has buildings, ships, harvest
 * nodes and sea mobs — no coin, no log stack, no bottle, no ingot, no gem.
 * A 90-unit-tall Mercado shrunk to 50px is mud. So the five resource props are
 * modelled here from primitives in the same visual language (flat-shaded, few
 * facets, saturated albedo), and the two icons the library DOES have at the
 * right subject and scale — the chest and the skiff — come straight from the
 * .glb files (see GLB_PROPS).
 *
 * Each bake ends with an ink dilation pass on a 2D canvas, which is what gives
 * the icon layer 1 of the four layers: a constant-weight contour that does not
 * scale with the element (§6.9).
 */

export type IconId =
  | 'oro' | 'madera' | 'ron' | 'metal' | 'gema'
  | 'carpintero' | 'rango'
  | 'zarpar' | 'construir' | 'cofres' | 'diario' | 'ajustes'
  | 'candado';

export type IconSet = Partial<Record<IconId, string>>;

/** Intended display size in CSS px. Drives the bake resolution and the ink
 *  width, so a 24px icon and a 96px icon both end up with a 3px contour. */
const DISPLAY_PX: Record<IconId, number> = {
  oro: 54, madera: 54, ron: 54, metal: 54, gema: 54,
  carpintero: 44, rango: 36,
  zarpar: 58, construir: 36, cofres: 56, diario: 36, ajustes: 36,
  candado: 38,
};

/**
 * Icons that are a real model from public/assets/models.
 *
 * Empty, deliberately. `cofres` used to take `chest_bandit`, on the grounds
 * that it was the one library asset whose subject and proportions survived
 * being drawn at 56px. Proportions were never the problem: the bandit chest is
 * near-black oak with dark iron, and once the art was normalised to fill its
 * tile the way the reference does, it went from a small dark token to a large
 * dark mass sitting on the one GOLD button in the game. The library has no
 * other chest. So the chest joins the five resource props and is modelled here,
 * where its value can be chosen — which is the same reason those five are
 * hand-modelled rather than shrunk from a 90-unit building.
 */
const GLB_PROPS: Partial<Record<IconId, string>> = {};

const INK = '#17130E';          // --ui-ink. Never #000 (§6.14).
const SUPERSAMPLE = 2;          // render at 2× and downscale — free antialiasing
const INK_SCALE = 3;            // bake at 3× display, so 9px of ink reads as 3px

/* ---------------------------------------------------------------------------
 * primitives
 * ------------------------------------------------------------------------ */

type Vec3 = [number, number, number];

const materials = new Map<string, THREE.MeshPhongMaterial>();

/**
 * Icon props are lit, not flat.
 *
 * A Clash resource icon is a rendered object with a visible rim light and a
 * specular arc — that highlight is most of what separates a coin from a yellow
 * polygon at 40px. Lambert cannot produce one, so icons use Phong with a tight
 * warm specular. `gloss` raises it for metals and gems.
 */
function mat(colour: number, gloss = 0.35): THREE.MeshPhongMaterial {
  const key = `${colour}:${gloss}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshPhongMaterial({
      color: colour,
      flatShading: true,
      specular: new THREE.Color(0xfff2d0).multiplyScalar(gloss),
      shininess: 12 + gloss * 60,
    });
    materials.set(key, m);
  }
  return m;
}

function place(mesh: THREE.Mesh, pos: Vec3, rot?: Vec3): THREE.Mesh {
  mesh.position.set(pos[0], pos[1], pos[2]);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  return mesh;
}

const box = (w: number, h: number, d: number, colour: number, pos: Vec3, rot?: Vec3, gloss?: number) =>
  place(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(colour, gloss)), pos, rot);

/** A prism. `seg` low enough that the facets read: 4 = tapered block,
 *  6 = gem, 8 = log, 12 = coin. */
const prism = (
  rTop: number, rBottom: number, h: number, seg: number,
  colour: number, pos: Vec3, rot?: Vec3, gloss?: number
) => place(new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat(colour, gloss)), pos, rot);

function group(children: THREE.Object3D[], rot?: Vec3, pos?: Vec3): THREE.Group {
  const g = new THREE.Group();
  for (const c of children) g.add(c);
  if (rot) g.rotation.set(rot[0], rot[1], rot[2]);
  if (pos) g.position.set(pos[0], pos[1], pos[2]);
  return g;
}

/* ---------------------------------------------------------------------------
 * the props
 *
 * Each is modelled inside roughly a unit box centred on the origin. §1.4 fixes
 * the icon-body colours; wood and gold are adjacent warm hues and are
 * separated by SILHOUETTE — stacked logs vs. the stacked-coin motif — which is
 * why the shapes matter more than the palette here.
 * ------------------------------------------------------------------------ */

const PROPS: Partial<Record<IconId, () => THREE.Object3D>> = {
  /* Oro — the stacked-coin motif, plus one coin standing on edge so the
   * silhouette can never be confused with the log stack. */
  oro: () => {
    // 18 sides, not 12: below about 48px a 12-gon reads as a pentagon rather
    // than a coin. The top disc is a brighter, thinner cap so the stack catches
    // a rim light instead of ending in a flat plate.
    const coin = (y: number, yaw: number, c = 0xffd029) =>
      prism(0.5, 0.5, 0.15, 18, c, [0, y, 0], [0, yaw, 0], 0.85);
    return group([
      prism(0.46, 0.46, 0.13, 18, 0xe0a814, [-0.2, -0.3, -0.34], [0, 0.3, 0], 0.7),
      coin(-0.36, 0), coin(-0.21, 0.24), coin(-0.06, -0.18), coin(0.09, 0.1),
      prism(0.5, 0.5, 0.045, 18, 0xfff0a0, [0, 0.17, 0], [0, 0.1, 0], 1.0),
      prism(0.44, 0.44, 0.13, 18, 0xffd029, [0.5, -0.16, 0.3], [0, 0, 1.42], 0.9),
    ]);
  },

  /* Madera — three logs, end grain toward the camera. */
  madera: () => {
    const log = (pos: Vec3) => {
      const bark = prism(0.28, 0.28, 1.0, 8, 0xd9913f, [0, 0, 0], [0, 0, Math.PI / 2]);
      const capA = prism(0.29, 0.29, 0.07, 8, 0xf0ce9b, [0.5, 0, 0], [0, 0, Math.PI / 2]);
      const capB = prism(0.29, 0.29, 0.07, 8, 0xc98a4c, [-0.5, 0, 0], [0, 0, Math.PI / 2]);
      const ring = prism(0.15, 0.15, 0.09, 8, 0xd8ae74, [0.51, 0, 0], [0, 0, Math.PI / 2]);
      return group([bark, capA, capB, ring], undefined, pos);
    };
    return group([log([0, -0.3, -0.28]), log([0, -0.3, 0.28]), log([0, 0.12, 0])], [0, -0.25, 0]);
  },

  /* Ron — an amber bottle. §10.9: the magenta lives in the BAR, the identity
   * lives in this icon, so the bottle must be unmistakably a bottle. */
  ron: () => group([
    prism(0.33, 0.35, 0.74, 8, 0xe7863a, [0, -0.22, 0]),
    prism(0.16, 0.33, 0.2, 8, 0xe7863a, [0, 0.25, 0]),
    prism(0.13, 0.14, 0.3, 8, 0xd4762e, [0, 0.5, 0]),
    prism(0.15, 0.15, 0.13, 8, 0x8a5a2e, [0, 0.71, 0]),
    box(0.4, 0.28, 0.06, 0xede6d2, [0, -0.22, 0.33]),
    box(0.4, 0.05, 0.07, 0x8a5a2e, [0, -0.09, 0.335]),
  ], [0, 0, 0.06]),

  /* Metal — tapered ingots. Four segments give the trapezoid section. */
  metal: () => {
    const ingot = (pos: Vec3, yaw: number) =>
      prism(0.3, 0.44, 0.28, 4, 0xa9bacb, pos, [0, Math.PI / 4 + yaw, 0]);
    return group([
      ingot([-0.26, -0.3, 0.14], 0.06),
      ingot([0.26, -0.3, -0.12], -0.1),
      ingot([0.0, 0.0, 0.0], 0.3),
    ]);
  },

  /* Gemas — a hexagonal PRISM, not a round gem (§3.3), with a lighter
   * top-left facet and a hard specular streak across it. */
  gema: () => group([
    prism(0.52, 0.52, 0.36, 6, 0xb7e33a, [0, 0, 0], [Math.PI / 2, 0, 0]),
    prism(0.52, 0.52, 0.04, 6, 0xd2e97d, [0, 0, 0.2], [Math.PI / 2, 0, 0]),
    box(0.34, 0.07, 0.03, 0xf2fbc8, [-0.08, 0.16, 0.235], [0, 0, 0.62]),
  ], [0.16, -0.38, 0.1]),

  /* The carpenter portrait for the builder chip (§3.4). */
  carpintero: () => group([
    box(0.88, 0.3, 0.46, 0x2e5f8a, [0, -0.5, 0]),
    box(0.5, 0.1, 0.4, 0xf0ece0, [0, -0.36, 0.04]),
    box(0.24, 0.14, 0.22, 0xe8b183, [0, -0.3, 0]),
    box(0.58, 0.52, 0.48, 0xe8b183, [0, 0.02, 0]),
    box(0.52, 0.2, 0.44, 0x8a5a34, [0, -0.2, 0.03]),
    box(0.62, 0.2, 0.52, 0xc0392b, [0, 0.32, 0]),
    box(0.18, 0.16, 0.16, 0xc0392b, [-0.36, 0.27, -0.12]),
    box(0.08, 0.1, 0.04, 0x241c16, [-0.14, 0.07, 0.245]),
    box(0.08, 0.1, 0.04, 0x241c16, [0.14, 0.07, 0.245]),
  ], [0.06, -0.3, 0]),

  /* Notoriety / rank — our anchors are the game's stars (§3.22A). Drawn fat:
   * at 30px a scale-accurate anchor is a squiggle, and the chip has to be
   * readable at a glance from the top of the screen. */
  rango: () => group([
    box(0.26, 0.86, 0.22, 0xf0b722, [0, -0.06, 0]),
    box(0.92, 0.2, 0.22, 0xf0b722, [0, 0.26, 0]),
    place(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.085, 5, 12), mat(0xf0b722)), [0, 0.56, 0]),
    box(0.6, 0.22, 0.22, 0xf0b722, [-0.27, -0.4, 0], [0, 0, 0.62]),
    box(0.6, 0.22, 0.22, 0xf0b722, [0.27, -0.4, 0], [0, 0, -0.62]),
    box(0.28, 0.3, 0.23, 0xf0b722, [-0.46, -0.2, 0], [0, 0, 0.5]),
    box(0.28, 0.3, 0.23, 0xf0b722, [0.46, -0.2, 0], [0, 0, -0.5]),
  ], [0.12, -0.2, 0]),

  /* ¡Zarpar! — a sloop under sail.
   *
   * The .glb ships lost this slot: brown hulls read as a smear on the orange
   * CTA at 58px, and the primary action's icon is the one that must never be
   * ambiguous. Cream triangular sails carry the silhouette AND the contrast. */
  zarpar: () => group([
    box(1.0, 0.16, 0.36, 0x7a4a28, [0, -0.5, 0]),
    box(1.16, 0.2, 0.44, 0x9a6136, [0, -0.33, 0]),
    box(1.16, 0.06, 0.46, 0xc08a4a, [0, -0.21, 0]),
    box(0.1, 1.1, 0.1, 0x5e3a1e, [0.06, 0.32, 0]),
    prism(0.02, 0.44, 0.86, 3, 0xf2efe2, [0.3, 0.3, 0], [0, 0.52, 0]),
    prism(0.02, 0.3, 0.6, 3, 0xe4dfcc, [-0.28, 0.14, 0], [0, 0.52, 0]),
    box(0.22, 0.11, 0.03, 0xc0392b, [0.2, 0.84, 0]),
  ], [0.06, -0.34, 0]),

  /* Construir — a mallet. */
  construir: () => group([
    box(0.16, 1.0, 0.16, 0x8b5e34, [0, -0.22, 0]),
    box(0.62, 0.34, 0.34, 0xa9bacb, [0, 0.42, 0]),
    box(0.66, 0.1, 0.36, 0x7c8da0, [0, 0.28, 0]),
    box(0.2, 0.36, 0.36, 0xc4d1de, [-0.3, 0.42, 0]),
  ], [0.05, -0.5, -0.36]),

  /* Diario — the ship's log. */
  diario: () => group([
    box(0.96, 0.12, 0.72, 0x7e2b22, [0, -0.26, 0]),
    box(0.9, 0.2, 0.66, 0xede6d2, [0, -0.1, 0]),
    box(0.96, 0.12, 0.72, 0x9a3a2a, [0, 0.05, 0.02], [-0.1, 0, 0]),
    box(0.14, 0.42, 0.74, 0x5e1f18, [-0.45, -0.12, 0]),
    box(0.1, 0.06, 0.56, 0xf0b722, [0.24, 0.14, 0.14]),
  ], [0.12, -0.42, 0.06]),

  /* Cofres — a banded treasure chest.
   *
   * Warm oak and brass, chosen to sit on the gold featured tile: the icon has
   * to separate from its face by HUE and by silhouette, since it cannot
   * separate by value without going darker than the tile can carry. The lid is
   * a low faceted cylinder so the chest reads as domed from the 3/4 view rather
   * than as a plain box. */
  cofres: () => group([
    box(1.02, 0.1, 0.7, 0x8a5a22, [0, -0.56, 0]),                       // plinth
    box(0.98, 0.5, 0.64, 0xb5782f, [0, -0.3, 0]),                       // body
    box(1.0, 0.12, 0.66, 0xf0b722, [0, -0.22, 0], undefined, 0.95),     // waist band
    prism(0.33, 0.33, 0.98, 10, 0xc4883a, [0, 0.04, 0], [0, 0, Math.PI / 2]),
    prism(0.35, 0.35, 0.12, 10, 0xf0b722, [-0.33, 0.04, 0], [0, 0, Math.PI / 2], 0.95),
    prism(0.35, 0.35, 0.12, 10, 0xf0b722, [0.33, 0.04, 0], [0, 0, Math.PI / 2], 0.95),
    box(0.22, 0.26, 0.09, 0xffd75e, [0, -0.2, 0.34], undefined, 1.0),   // lock plate
    box(0.09, 0.1, 0.06, 0x6b4a10, [0, -0.24, 0.39]),                   // keyhole
  ], [0.1, -0.34, 0]),

  /* Candado — the padlock that overhangs a locked CTA (§3.5).
   *
   * §6.10: a locked primary stays the SAME OBJECT in its own hue; what tells
   * you it is locked is this prop sitting on its corner, not the colour being
   * drained out of the button underneath. Brass body, dark steel shackle, so it
   * reads against both the orange CTA and the cream utility family. */
  candado: () => {
    const shackle: THREE.Object3D[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (i / 8);
      shackle.push(box(0.15, 0.15, 0.15, 0x8d99a6, [-Math.cos(a) * 0.3, 0.34 + Math.sin(a) * 0.3, 0], [0, 0, a]));
    }
    return group([
      ...shackle,
      box(0.16, 0.2, 0.16, 0x8d99a6, [-0.3, 0.22, 0]),
      box(0.16, 0.2, 0.16, 0x8d99a6, [0.3, 0.22, 0]),
      box(0.92, 0.72, 0.42, 0xe0a418, [0, -0.18, 0], undefined, 0.7),
      box(0.92, 0.14, 0.44, 0xf5c94a, [0, 0.08, 0], undefined, 0.8),
      box(0.16, 0.22, 0.06, 0x6b4a10, [0, -0.14, 0.22]),
      prism(0.11, 0.11, 0.07, 10, 0x6b4a10, [0, 0.02, 0.22], [Math.PI / 2, 0, 0]),
    ], [0.12, -0.26, 0]);
  },

  /* Ajustes — a capstan gear.
   *
   * Steel, not cream. It was modelled in #C9C7B0 / #EFEDDC, which are the
   * utility family's own face colours — a cream gear on a cream button, with
   * the ink contour left doing all the work of telling them apart. Cool grey
   * separates it by hue as well as by value and suits a capstan besides. */
  ajustes: () => {
    const teeth: THREE.Object3D[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      teeth.push(box(0.24, 0.24, 0.32, 0x8e99a6, [Math.cos(a) * 0.46, Math.sin(a) * 0.46, 0], [0, 0, a], 0.5));
    }
    return group([
      ...teeth,
      prism(0.4, 0.4, 0.3, 12, 0xb9c3cd, [0, 0, 0], [Math.PI / 2, 0, 0], 0.6),
      prism(0.17, 0.17, 0.34, 10, 0x5b636d, [0, 0, 0], [Math.PI / 2, 0, 0], 0.4),
    ], [0.12, -0.2, 0.22]);
  },
};

/* ---------------------------------------------------------------------------
 * the bake
 * ------------------------------------------------------------------------ */

/** Camera direction — a 3/4 view that shows the top face, like every icon in
 *  the reference. The light comes from the upper LEFT front, which is what
 *  puts the specular at 10 o'clock (§3.1.7). */
const VIEW_DIR = new THREE.Vector3(0.5, 0.66, 1).normalize();
const LIGHT_DIR = new THREE.Vector3(-0.42, 1.0, 0.72).normalize();

function iconScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.9);
  sun.position.copy(LIGHT_DIR).multiplyScalar(40);
  sun.castShadow = false;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xcfe9ff, 0xe8d9b4, 1.9));
  return scene;
}

/**
 * How much of the finished PNG the drawn ink must span.
 *
 * A Clash button's art crosses its gloss boundary and nearly touches the frame:
 * measured on the reference, the Shop tile's art is 62% of the tile, the Attack
 * map ~74%, the small army tile ~83%. That fullness is the whole reason a Clash
 * button reads as an OBJECT rather than as a container with a token in it.
 *
 * Fitting the frustum to the world-space AABB's projected corners cannot
 * deliver that: a 3/4 orthographic view of a box circumscribes the silhouette,
 * so a diagonal prop (the mallet, the sloop) keeps up to 50% of its canvas as
 * transparent margin while a blocky one (the log stack) keeps 14%. The props
 * then arrive at CSS at wildly different visual sizes and every attempt to fix
 * it in CSS trades one icon's fullness for another's.
 *
 * So the bake measures the rendered ALPHA and re-frames to it, then pads back
 * out to this constant. Every icon leaves the oven at the same ink fill, and
 * the CSS percentage finally means what it says.
 */
const INK_FILL = 0.9;

/** Points the camera at `box` and tightens the frustum around its projected
 *  corners, so every prop fills the same share of its canvas no matter how it
 *  was modelled. */
function frame(camera: THREE.OrthographicCamera, target: THREE.Box3, pad: number): void {
  const centre = target.getCenter(new THREE.Vector3());
  const radius = target.getSize(new THREE.Vector3()).length() * 0.5 || 1;
  camera.position.copy(centre).addScaledVector(VIEW_DIR, radius * 3 + 2);
  camera.up.set(0, 1, 0);
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);

  const toCamera = camera.matrixWorld.clone().invert();
  const corner = new THREE.Vector3();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? target.max.x : target.min.x,
      i & 2 ? target.max.y : target.min.y,
      i & 4 ? target.max.z : target.min.z
    ).applyMatrix4(toCamera);
    minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const half = Math.max(maxX - minX, maxY - minY) * 0.5 * pad;
  camera.left = cx - half; camera.right = cx + half;
  camera.top = cy + half; camera.bottom = cy - half;
  camera.near = 0.01;
  camera.far = radius * 8 + 8;
  camera.updateProjectionMatrix();
}

/** One render pass into an offscreen target, read back as RGBA. */
function draw(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  size: number
): Uint8Array {
  const target = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });
  // Without this the read-back is linear-light and the icons come out dark.
  target.texture.colorSpace = THREE.SRGBColorSpace;

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  // The bake borrows the game's renderer, so it has to borrow it in a known
  // state — the same reason the target and the clear colour are saved above.
  // render/stage.ts now installs a highlight shoulder for the island frame, and
  // that curve is solved for the ISLAND's light rig; these icons have their own
  // rig and their palettes were measured against the reference with no curve on
  // the output at all (§3.1.7). Letting the stage's setting leak in here would
  // re-grade every icon in the HUD whenever the island's exposure is retuned.
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;

  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);

  const pixels = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);

  renderer.toneMapping = prevTone;
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  target.dispose();
  return pixels;
}

/** Bounding box of everything the render actually drew, in buffer pixels.
 *  Null when the prop rendered empty. WebGL reads bottom-up, so y grows
 *  upward here — the caller maps it back through the frustum, not the canvas. */
function alphaBounds(
  pixels: Uint8Array,
  size: number
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = size, y0 = size, x1 = -1, y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 8/255 rejects the antialiasing fringe without eating a real thin edge.
      if (pixels[(y * size + x) * 4 + 3] <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Renders `object` to an RGBA buffer, framed on its SILHOUETTE rather than on
 * its bounding box.
 *
 * The first pass is a cheap probe whose only job is to tell us where the prop
 * actually put ink; the second re-frames the frustum onto exactly that and
 * renders for real. Two renders of a dozen tiny props is nothing next to
 * shipping icons that are half margin.
 */
function renderProp(
  renderer: THREE.WebGLRenderer,
  object: THREE.Object3D,
  size: number,
  fill: number
): { pixels: Uint8Array; size: number } {
  const scene = iconScene();
  scene.add(object);

  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(object);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  // Loose enough that the probe cannot clip a prop whose AABB under-reports.
  frame(camera, bounds, 1.25);

  const PROBE = 128;
  const hit = alphaBounds(draw(renderer, scene, camera, PROBE), PROBE);
  if (hit) {
    const { left, right, top, bottom } = camera;
    const u = (right - left) / PROBE;
    const v = (top - bottom) / PROBE;
    const minX = left + hit.x0 * u, maxX = left + (hit.x1 + 1) * u;
    const minY = bottom + hit.y0 * v, maxY = bottom + (hit.y1 + 1) * v;
    // Square, centred on the ink, then padded back out to the target fill so
    // every icon leaves the bake occupying the same share of its canvas.
    const half = (Math.max(maxX - minX, maxY - minY) * 0.5) / fill;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    camera.left = cx - half; camera.right = cx + half;
    camera.top = cy + half; camera.bottom = cy - half;
    camera.updateProjectionMatrix();
  }

  const pixels = draw(renderer, scene, camera, size);
  scene.clear();
  return { pixels, size };
}

/** WebGL reads bottom-up; canvases are top-down. */
function toCanvas(pixels: Uint8Array, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const row = size * 4;
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * row;
    image.data.set(pixels.subarray(src, src + row), y * row);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Layer 1 of the four layers: a constant-weight near-black contour.
 *
 * Stamps the alpha silhouette in ink around the render and draws the colour
 * pass back on top. `ink` is a fixed number of BAKE pixels, so a 24px icon and
 * a 96px icon end up with the same 3px contour on screen (§6.9).
 */
function inkOutline(source: HTMLCanvasElement, out: number, ink: number): HTMLCanvasElement {
  const silhouette = document.createElement('canvas');
  silhouette.width = out;
  silhouette.height = out;
  const sctx = silhouette.getContext('2d')!;
  sctx.drawImage(source, 0, 0, out, out);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = INK;
  sctx.fillRect(0, 0, out, out);

  const canvas = document.createElement('canvas');
  canvas.width = out + ink * 2;
  canvas.height = out + ink * 2;
  const ctx = canvas.getContext('2d')!;
  const STEPS = 16;
  for (let i = 0; i < STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2;
    ctx.drawImage(silhouette, ink + Math.cos(a) * ink, ink + Math.sin(a) * ink);
  }
  // A second, tighter ring fills the gaps the outer one leaves on concave edges.
  for (let i = 0; i < STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2 + Math.PI / STEPS;
    ctx.drawImage(silhouette, ink + Math.cos(a) * ink * 0.55, ink + Math.sin(a) * ink * 0.55);
  }
  ctx.drawImage(source, ink, ink, out, out);
  return canvas;
}

/** The share of `out` the silhouette must span for the finished PNG — which is
 *  `out` plus an `ink` ring on every side — to carry INK_FILL of drawn ink. */
const silhouetteFill = (out: number, ink: number) =>
  (INK_FILL * (out + ink * 2) - ink * 2) / out;

/**
 * Where the drawn ink sits inside a finished icon, as fractions of the canvas.
 *
 * Normalising the bake equalises how BIG each icon is, but not where its ink
 * lands: a tall prop centred in a square canvas leaves more transparent margin
 * left and right than a wide one does. §1.7's edge rule is about drawn extent,
 * so a column of HUD rows can only share a left margin if each row knows where
 * its own ink starts. That is this.
 */
export interface InkBox { x0: number; y0: number; x1: number; y1: number }

const inkBoxes = new Map<string, InkBox>();
/** Keyed by data URL too, so a component holding only `opts.icon` can align on
 *  drawn ink without every signature growing an id parameter. */
const inkByUrl = new Map<string, InkBox>();

/** Alpha bbox of a finished icon canvas, top-down, as 0–1 fractions. */
function measureInk(canvas: HTMLCanvasElement): InkBox {
  const size = canvas.width;
  const data = canvas.getContext('2d')!.getImageData(0, 0, size, size).data;
  let x0 = size, y0 = size, x1 = -1, y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * 4 + 3] <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0: x0 / size, y0: y0 / size, x1: (x1 + 1) / size, y1: (y1 + 1) / size };
}

/** Ink extent of a baked icon, for callers that must align on drawn edges. */
export const inkBox = (id: IconId): InkBox =>
  inkBoxes.get(id) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };

/**
 * Publishes an icon's ink bbox onto its host element as CSS custom properties.
 *
 * §1.7's edge rule is about DRAWN extent, and an overhanging icon's drawn extent
 * is not its box: the props are normalised to a fixed ink fill on their major
 * axis, so a tall one leaves more transparent margin left and right than a wide
 * one. Left unaccounted for, a three-row Zone A column lands its ink at three
 * different margins (measured 12 / 22 / 19) and the right-hand pills terminate
 * on a ragged edge. The CSS offsets each icon by these fractions so every row
 * begins — or ends — on the same pixel.
 */
export function alignInk(host: HTMLElement, url: string | undefined): void {
  const box = url ? inkByUrl.get(url) : undefined;
  if (!box) return;
  host.style.setProperty('--ink-x0', String(box.x0));
  host.style.setProperty('--ink-x1', String(box.x1));
}

/** Normalizes a .glb into the same unit box the hand-modelled props use. */
async function glbProp(id: string): Promise<THREE.Object3D> {
  const [model, manifest] = await Promise.all([loadModel(id), loadManifest()]);
  const dims = manifest[id];
  const inner = model.scene.clone(true);
  const wrapper = new THREE.Group();
  wrapper.add(inner);

  // Almost every model here is a SkinnedMesh whose armature carries a large
  // scale, and Box3 reports the pre-armature extent — so the pipeline
  // dimensions are the only trustworthy size (see assets.ts/measureRendered).
  const size = new THREE.Vector3().fromArray(dims?.size ?? [1, 1, 1]);
  const min = new THREE.Vector3().fromArray(dims?.min ?? [-0.5, 0, -0.5]);
  const scale = 1 / Math.max(size.x, size.y, size.z || 1);
  wrapper.scale.setScalar(scale);
  wrapper.position.set(
    -(min.x + size.x / 2) * scale,
    -(min.y + size.y / 2) * scale,
    -(min.z + size.z / 2) * scale
  );

  // The wrapper's own transform is what normalizes it, so hand the framing
  // pass a parent it can measure without the skinning under-report.
  const holder = new THREE.Group();
  holder.add(wrapper);
  holder.userData.bounds = new THREE.Box3(
    new THREE.Vector3(-size.x * scale / 2, -size.y * scale / 2, -size.z * scale / 2),
    new THREE.Vector3(size.x * scale / 2, size.y * scale / 2, size.z * scale / 2)
  );
  return holder;
}

const modelIcons = new Map<string, string>();

/**
 * Bakes arbitrary .glb models into icons, for §3.15's picker and §3.16's sheet.
 *
 * The picker's rows and the upgrade sheet's header have to show the building
 * being discussed, and the only honest portrait of a building is the building:
 * a drawn substitute would be the one place in the game where the icon and the
 * thing it names were modelled by different hands. This is the same bake the
 * HUD icons go through — same rig, same ink dilation — so a row in the picker
 * is lit by the same sun as the island behind it.
 *
 * Results are memoized across calls; a failed bake yields no entry rather than
 * a broken image, and the row falls back to its label.
 */
export async function bakeModelIcons(
  renderer: THREE.WebGLRenderer,
  ids: readonly string[],
  px = 56
): Promise<Record<string, string>> {
  for (const id of ids) {
    if (modelIcons.has(id)) continue;
    try {
      const object = await glbProp(id);
      const out = px * INK_SCALE;
      const bounds = object.userData.bounds as THREE.Box3 | undefined;
      if (bounds) {
        const proxy = new THREE.Mesh(
          new THREE.BoxGeometry(
            bounds.max.x - bounds.min.x,
            bounds.max.y - bounds.min.y,
            bounds.max.z - bounds.min.z
          ),
          new THREE.MeshBasicMaterial({ visible: false })
        );
        object.add(proxy);
      }
      const ink = 3 * INK_SCALE;
      const { pixels, size } = renderProp(renderer, object, out * SUPERSAMPLE, silhouetteFill(out, ink));
      modelIcons.set(id, inkOutline(toCanvas(pixels, size), out, ink).toDataURL('image/png'));
    } catch (err) {
      console.warn(`[icons] model ${id} failed to bake`, err);
    }
  }
  return Object.fromEntries(ids.map((id) => [id, modelIcons.get(id)]).filter(([, v]) => v)) as Record<string, string>;
}

let cached: Promise<IconSet> | null = null;

/**
 * Bakes every HUD icon once and hands back data URLs. Awaited during scene
 * construction so the icons exist before the first frame — the screenshot
 * harness captures two frames after boot and would otherwise catch empty
 * pills.
 */
export function bakeIcons(renderer: THREE.WebGLRenderer): Promise<IconSet> {
  cached ??= (async () => {
    const set: IconSet = {};
    const ids = Object.keys(DISPLAY_PX) as IconId[];

    for (const id of ids) {
      try {
        const glb = GLB_PROPS[id];
        const object = glb ? await glbProp(glb) : PROPS[id]?.();
        if (!object) continue;

        const out = DISPLAY_PX[id] * INK_SCALE;
        const bounds = object.userData.bounds as THREE.Box3 | undefined;
        if (bounds) {
          // A stand-in box the framing pass can measure (see glbProp).
          const proxy = new THREE.Mesh(
            new THREE.BoxGeometry(
              bounds.max.x - bounds.min.x,
              bounds.max.y - bounds.min.y,
              bounds.max.z - bounds.min.z
            ),
            new THREE.MeshBasicMaterial({ visible: false })
          );
          object.add(proxy);
        }

        const ink = 3 * INK_SCALE;
        const { pixels, size } = renderProp(renderer, object, out * SUPERSAMPLE, silhouetteFill(out, ink));
        const baked = inkOutline(toCanvas(pixels, size), out, ink);
        const box = measureInk(baked);
        const url = baked.toDataURL('image/png');
        inkBoxes.set(id, box);
        inkByUrl.set(url, box);
        set[id] = url;
      } catch (err) {
        console.warn(`[icons] ${id} failed to bake`, err);
      }
    }
    return set;
  })();
  return cached;
}
