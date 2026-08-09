import * as THREE from 'three';
import { fitToFootprint, loadManifest, loadModel, measureRendered, instantiate, type ModelInstance } from './assets';
import type { AvatarSlot, CaptainLook } from '../sim';

/**
 * avatar.ts — PLAN.md Fase 4's modular captain, assembled from part ids.
 *
 * The sim holds seven strings (`src/sim/captain.ts`); this turns them into one
 * THREE.Group that can be dropped into any scene. Nothing here decides what a
 * captain looks like — it only draws the decision.
 *
 *
 * WHAT THE ART ACTUALLY IS, because every number below comes out of it
 * ===================================================================
 *
 * The three bodies (`Avatar/Naked Pirate/…`) are SKINNED: 17 bones — Root,
 * Body, Chest, Head, Arm/ForeArm/Hand L+R, Barrel, Leg/LowerLeg/Foot L+R — and
 * four clips (`01_Idle_1`, `04_Walk`, `15_Waving_Right`, `18_Success_Celebration`).
 *
 * The other forty parts are NOT. Every hat, hair, beard, eyewear, top and
 * bottom is a single static mesh with an identity node transform, exported from
 * its own voxel volume: each one has `min.y == 0`, i.e. it stands on its own
 * floor with no idea where a head is. There is no attachment point in the file,
 * no skin, no bone. Assembling a captain therefore means answering two
 * questions ourselves, and both answers are measured rather than guessed.
 *
 * WHERE does a part go? Measured off the body's own meshes, in the bind pose,
 * by taking every vertex to its dominant joint:
 *
 *      Head      geometry y 0.36 → 0.60   x -0.07 → 0.09   z ±0.15
 *      Chest     geometry y 0.21 → 0.36   x  ±0.06         z ±0.12
 *      hips      geometry y 0.13 → 0.22   x  ±0.05         z ±0.10
 *      thigh     geometry y 0.09 → 0.16                    z 0.02 → 0.09
 *      shin      geometry y 0.05 → 0.10
 *      eyes      geometry y 0.46 → 0.52   at x 0.085  (so the face is +X)
 *      mouth     geometry y 0.41 → 0.42   at x 0.085
 *      built-in hair    y 0.319 → 0.690   — hair rises ~0.09 above the skull
 *      built-in outfit  sleeves out to z ±0.24
 *
 * Every part's own bounding box then falls into place against that: the six
 * bottoms are all exactly 0.11 tall by 0.18 wide, which is the leg from ankle
 * (0.05) to hip (0.16) to the millimetre; the tops are 0.21–0.23 tall and reach
 * z ±0.24, which is the torso from hip (0.13) to neck (0.36) plus the sleeve
 * the built-in outfit runs to. Those two coincidences are what fix the
 * alignment mode per family in MOUNTS below — the parts are not arbitrary, they
 * were authored against this skeleton, and the trim to `min.y == 0` is the only
 * thing the export threw away.
 *
 * HOW does a part follow the animation? By being skinned to the body's own
 * skeleton, one bone per vertex, chosen as the nearest bone in the bind pose
 * out of a per-family candidate list. Rigid bone-parenting would have done for
 * a hat, but a coat whose sleeves do not follow the forearms and trousers that
 * ignore the knees are exactly the kind of cheapness the brief is about, and
 * the candidate lists (BIND_BONES) are what keep a trouser leg off the Head.
 *
 * The reason it works at all is `SkinnedMesh.bind(skeleton, IDENTITY)`: three
 * draws a skinned vertex at
 *
 *      matrixWorld · bindMatrixInverse · Σ w (bone.matrixWorld · boneInverse) · bindMatrix · v
 *
 * and in the default AttachedBindMode it recomputes `bindMatrixInverse` as
 * `inverse(matrixWorld)` every frame. With an identity bindMatrix the mesh's
 * own world matrix cancels out completely, so the part is drawn purely by the
 * bones — which is precisely what "wear this on that skeleton" means, and it is
 * the same mechanism that made a naive `clone()` render the bodies 13x too
 * small (see the note in render/assets.ts). We are using the sharp edge on
 * purpose here, and `window.__checkSizes` still watches it.
 */

/* --------------------------------------------------------------------------
 * anatomy — every number in the body model's own units (a voxel is 0.01)
 * ----------------------------------------------------------------------- */

/** The idle the captain stands in. Named rather than "first clip": the walk is
 *  in the same file and picking it by index is a coin toss. */
const BODY_CLIP = '01_Idle_1';

/** How tall a captain stands, in world units, before any scene scales it. */
export const CAPTAIN_HEIGHT = 2.6;

/** Bones an accessory of each family may bind a vertex to. A short list is not
 *  an optimisation — it is what stops a trouser cuff being welded to a hand. */
const BIND_BONES: Record<Exclude<AvatarSlot, 'body'>, readonly string[]> = {
  hair: ['Head'],
  hat: ['Head'],
  beard: ['Head'],
  eyes: ['Head'],
  top: ['Chest', 'Body', 'Arm.L', 'Arm.R', 'ForeArm.L', 'ForeArm.R', 'Hand.L', 'Hand.R'],
  bottom: ['Body', 'Leg.L', 'Leg.R', 'LowerLeg.L', 'LowerLeg.R'],
};

interface Mount {
  /** `base` pins the part's own floor at `y`; `top` pins its ceiling there. */
  align: 'base' | 'top';
  y: number;
  /**
   * Where the part's FRONT face goes, along +x — the direction the head looks.
   *
   * Left off, a part keeps the x it was authored with, and that is right for
   * almost everything: the tops span x -0.06 → 0.07 against a chest of ±0.06,
   * the bottoms ±0.04 against a thigh of ±0.04, and an eyepatch's strap ±0.09
   * around a head of -0.07 → 0.09. Those are not coincidences — the parts were
   * modelled on this body and only their HEIGHT was trimmed on export.
   *
   * Facial hair is the exception, because it is authored around x 0 while the
   * face is a plane at x 0.09. Pinning the front rather than shifting by a
   * constant is what keeps a 0.02-deep goatee and a 0.19-deep walrus moustache
   * on the same face: both end at the same plane, and the long one lies back
   * along the cheeks instead of sticking out like a bowsprit.
   */
  front?: number;
  /** Radians about z, for the handful of parts exported lying down. */
  spin?: number;
}

/**
 * Where each family sits, in bind-pose body units.
 *
 * - **hair** hangs from its TOP, at the height the body's own hair mesh reaches
 *   (0.690). Aligning the base instead puts a 0.25-tall crop 0.03 short of the
 *   skull and leaves a bald crown; aligning the top means a short cut caps the
 *   skull and a long one falls to the shoulders, which is what the two lengths
 *   are for.
 * - **hat** sits on its BASE, two voxels into the skull (0.60 → 0.58) so the
 *   brim bites rather than floats.
 * - **beard** hangs from the mouth line, pushed forward to the face plane: the
 *   beards are authored around x 0, and the face is at x 0.09.
 * - **eyes** hang from just above the eyes (0.52 + a voxel).
 * - **top** is pinned by its TOP at the neck (0.36) — its height then lands its
 *   hem on the hip line, which is where the six of them were cut.
 * - **bottom** stands on its BASE at the ankle (0.05); all six are 0.11 tall,
 *   which reaches the hip joint exactly.
 */
const MOUNTS: Record<Exclude<AvatarSlot, 'body'>, Mount> = {
  hair: { align: 'top', y: 0.685 },
  hat: { align: 'base', y: 0.575 },
  beard: { align: 'top', y: 0.45, front: 0.11 },
  eyes: { align: 'top', y: 0.55 },
  top: { align: 'top', y: 0.36 },
  bottom: { align: 'base', y: 0.05 },
};

/**
 * Per-part corrections, for the handful the family rule cannot cover.
 *
 * A monocle is a disc in the Y-Z plane authored at x 0 while an eyepatch is a
 * strap that genuinely wraps the skull, so one family offset cannot be right
 * for both: the strap is centred and the lens has to come forward to the face.
 */
const PART_MOUNT: Record<string, Partial<Mount>> = {
  // A lens on a chain, modelled as a disc in the y-z plane at x 0 — dead centre
  // of the skull unless it is pushed out to the face.
  av_eyes_monocle: { front: 0.115, y: 0.585 },
  // Same, for sunglasses: ±0.065 deep around x 0 leaves them inside a head that
  // runs -0.07 → 0.09, with only the arms poking out at the temples.
  av_eyes_shades: { front: 0.105, y: 0.545 },
  // Goggles carry a strap the full depth of the head, so the box is right where
  // it is — but the LENSES sit at the bottom of that box, so the box has to
  // stand on the cheekbone rather than hang from the brow.
  av_eyes_goggles: { align: 'base', y: 0.43 },
  // Exported lying on its back: 0.19 along x and 0.07 up, where every other
  // beard is the other way round. Turned upright it is a long straight beard,
  // which is what "canosa" is meant to be.
  av_beard_grey: { spin: -Math.PI / 2, front: 0.105, align: 'top', y: 0.44 },
};

/**
 * The four meshes of a body template we actually draw. Everything else on it
 * comes off.
 *
 * The templates are not naked. Each ships wearing a haircut, a bodysuit and —
 * on the dark one — a full beard, and every one of those fights what the player
 * picks: the built-in outfit's sleeves run to z ±0.24, exactly where every
 * top's sleeves are.
 *
 * It is a KEEP list rather than a hide list because the names are not
 * consistent enough to hide by: the three bodies call their hair "hair 12",
 * "hair 20" and "Untitled.001", and only one of them has a "facialhair 5". The
 * four things we want are named the same on all three, so the reliable question
 * is "is this the face" rather than "is this a wig". Matched on the sanitized
 * names GLTFLoader produces, on the mesh or on the group above it — a mesh with
 * several primitives arrives as a Group holding the node's name.
 */
const BODY_MESH_KEPT = ['species', 'eyes', 'eyebrow', 'mouth'];

/**
 * With a hat on, the hair is hidden.
 *
 * Every hat in the library encloses the skull — the bandana and the crown as
 * much as the tricorn — because Pirate Nation's own avatar system swaps
 * headwear FOR hair rather than stacking them. Voxel hair pushing through a
 * voxel crown is the single most obvious cheapness a character creator can
 * have, so the pair is never drawn. The screen makes the swap visible instead
 * of hiding it: choosing a hair takes the hat off.
 */
export const hairHiddenBy = (hat: string | null): boolean => hat !== null;

/* --------------------------------------------------------------------------
 * building a part
 * ----------------------------------------------------------------------- */

/** Bone names differ by exporter ("Arm.L" in the file, "ArmL" once GLTFLoader
 *  has sanitized it), so every lookup goes through the same flattening. */
const boneKey = (name: string): string => name.replace(/[^a-z0-9]/gi, '').toLowerCase();

interface PreparedPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

/**
 * Cache of skinned geometry, keyed by part AND by the skeleton it was bound to.
 *
 * Never disposed, exactly like the model cache it is derived from: the
 * geometry outlives any one avatar, and a second creation screen (or the
 * captain standing on the island) reuses it instead of re-welding it.
 */
const preparedCache = new Map<string, PreparedPart[]>();

/** Rest-pose world position of each bone, read back out of its bind inverse. */
function bonePositions(skeleton: THREE.Skeleton): THREE.Vector3[] {
  const bind = new THREE.Matrix4();
  return skeleton.bones.map((_, i) => {
    bind.copy(skeleton.boneInverses[i]).invert();
    return new THREE.Vector3().setFromMatrixPosition(bind);
  });
}

/**
 * A part's meshes, moved into body space and weighted onto the body's bones.
 *
 * Two passes: the first measures the whole part (a part may be several meshes,
 * and one offset has to serve all of them), the second bakes the offset into a
 * geometry clone and writes the skin attributes.
 */
async function preparePart(
  id: string,
  slot: Exclude<AvatarSlot, 'body'>,
  skeleton: THREE.Skeleton
): Promise<PreparedPart[]> {
  const signature = skeleton.bones.map((b) => b.name).join(',');
  const key = `${id}|${slot}|${signature}`;
  const cached = preparedCache.get(key);
  if (cached) return cached;

  const model = await loadModel(id);
  model.scene.updateMatrixWorld(true);
  const mount: Mount = { ...MOUNTS[slot], ...PART_MOUNT[id] };
  const spin = mount.spin ? new THREE.Matrix4().makeRotationZ(mount.spin) : null;

  const sources: Array<{ mesh: THREE.Mesh; matrix: THREE.Matrix4 }> = [];
  const box = new THREE.Box3();
  const scratch = new THREE.Box3();
  model.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const matrix = mesh.matrixWorld.clone();
    if (spin) matrix.premultiply(spin);
    sources.push({ mesh, matrix });
    scratch.copy(mesh.geometry.boundingBox ?? computeBox(mesh.geometry)).applyMatrix4(matrix);
    box.union(scratch);
  });
  if (!sources.length) {
    preparedCache.set(key, []);
    return [];
  }

  const size = box.getSize(new THREE.Vector3());
  const offset = new THREE.Vector3(
    mount.front === undefined ? 0 : mount.front - box.max.x,
    (mount.align === 'top' ? mount.y - size.y : mount.y) - box.min.y,
    0
  );

  // The candidate bones, as indices into the skeleton, with their rest
  // positions. A family whose named bones are all missing (a body rigged some
  // other way) falls back to the whole skeleton rather than drawing nothing.
  const positions = bonePositions(skeleton);
  const wanted = new Set(BIND_BONES[slot].map(boneKey));
  let candidates = skeleton.bones
    .map((_, index) => ({ index, at: positions[index] }))
    .filter(({ index }) => wanted.has(boneKey(skeleton.bones[index].name)));
  if (!candidates.length) candidates = skeleton.bones.map((_, index) => ({ index, at: positions[index] }));

  const prepared: PreparedPart[] = [];
  const vertex = new THREE.Vector3();
  for (const { mesh, matrix } of sources) {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(matrix);
    geometry.translate(offset.x, offset.y, offset.z);

    const position = geometry.getAttribute('position');
    const count = position.count;
    const index = new Uint16Array(count * 4);
    const weight = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      vertex.fromBufferAttribute(position, i);
      let best = candidates[0].index;
      let bestDistance = Infinity;
      for (const candidate of candidates) {
        const distance = vertex.distanceToSquared(candidate.at);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate.index;
        }
      }
      index[i * 4] = best;
      weight[i * 4] = 1;
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
    prepared.push({ geometry, material: mesh.material });
  }

  preparedCache.set(key, prepared);
  return prepared;
}

function computeBox(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox ?? new THREE.Box3();
}

/* --------------------------------------------------------------------------
 * the avatar
 * ----------------------------------------------------------------------- */

export interface Avatar {
  /** Parent this, move this, rotate this. Everything else is internal. */
  readonly object: THREE.Group;
  /** World height the captain was built to, so a scene can frame a camera. */
  readonly height: number;
  /** The look currently drawn. */
  look(): CaptainLook;
  /** Swap any number of parts. Resolves once the new look is on screen. */
  setLook(look: CaptainLook): Promise<void>;
  update(dt: number): void;
  dispose(): void;
}

export interface AvatarOptions {
  /** World height, feet to crown. Defaults to CAPTAIN_HEIGHT. */
  height?: number;
  /** Clip to loop. Defaults to the idle. */
  clip?: string;
  /** Off for a swatch bake, where a moving pose would blur the comparison. */
  animate?: boolean;
}

export async function createAvatar(look: CaptainLook, opts: AvatarOptions = {}): Promise<Avatar> {
  const height = opts.height ?? CAPTAIN_HEIGHT;
  const animate = opts.animate !== false;

  const object = new THREE.Group();
  object.name = 'captain';

  let current: CaptainLook | null = null;
  let wanted: CaptainLook = look;
  let body: ModelInstance | null = null;
  let skeleton: THREE.Skeleton | null = null;
  let attachPoint: THREE.Object3D | null = null;
  const worn = new Map<AvatarSlot, THREE.SkinnedMesh[]>();
  let disposed = false;

  async function buildBody(id: string): Promise<void> {
    for (const meshes of worn.values()) for (const mesh of meshes) mesh.removeFromParent();
    worn.clear();
    if (body) object.remove(body.object);

    // No `fit` here: instantiate would normalize the FOOTPRINT, and a captain
    // is specified by height. fitToFootprint is then called by hand with the
    // width that same scale produces, so `userData.fitTarget` still states a
    // true promise for main.ts's __checkSizes to hold us to.
    const instance = await instantiate(id, { clip: BODY_CLIP });
    const dims = (await loadManifest())[id];
    const native = dims?.size ?? [1, 1, 1];
    const scale = height / (native[1] || 1);
    fitToFootprint(instance.object, Math.max(native[0], native[2]) * scale, dims);

    const kept = (name: string): boolean => {
      const key = boneKey(name);
      return BODY_MESH_KEPT.some((prefix) => key.startsWith(prefix));
    };
    const skinned: THREE.SkinnedMesh[] = [];
    instance.object.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      if (mesh.isSkinnedMesh) skinned.push(mesh);
      // The node's own name for a single-primitive mesh, the parent group's for
      // a multi-primitive one — the built-in beard is three primitives under
      // "facialhair 5", and its meshes are called "model.004".
      if (!kept(mesh.name) && !kept(mesh.parent?.name ?? '')) mesh.visible = false;
    });

    // Any of the body's own skinned meshes will do — SkeletonUtils.clone gives
    // each one its own Skeleton object, but all of them over the same cloned
    // bones, so binding a part to one binds it to the body.
    body = instance;
    skeleton = skinned[0]?.skeleton ?? null;
    attachPoint = skinned[0]?.parent ?? instance.object;
    object.add(instance.object);
  }

  async function wear(slot: Exclude<AvatarSlot, 'body'>, id: string | null): Promise<void> {
    for (const mesh of worn.get(slot) ?? []) mesh.removeFromParent();
    worn.delete(slot);
    if (!id || !skeleton || !attachPoint) return;

    const parts = await preparePart(id, slot, skeleton);
    if (disposed) return;
    const meshes = parts.map(({ geometry, material }) => {
      const mesh = new THREE.SkinnedMesh(geometry, material);
      mesh.name = id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // The bones decide where every vertex lands, so the culler's own idea of
      // where this mesh is (its rest box through matrixWorld) is not worth
      // trusting on a screen that draws one character.
      mesh.frustumCulled = false;
      // IDENTITY, and this is the whole trick — see the header note.
      mesh.bind(skeleton!, new THREE.Matrix4());
      return mesh;
    });
    for (const mesh of meshes) attachPoint.add(mesh);
    worn.set(slot, meshes);
  }

  /** Rules that make every combination legal, applied after each change. */
  function applyRules(next: CaptainLook): void {
    const hidden = hairHiddenBy(next.hat);
    for (const mesh of worn.get('hair') ?? []) mesh.visible = !hidden;
  }

  async function apply(next: CaptainLook): Promise<void> {
    if (disposed) return;
    const previous = current;
    if (!previous || previous.body !== next.body) {
      await buildBody(next.body);
      if (disposed) return;
      for (const slot of ['hair', 'beard', 'eyes', 'hat', 'top', 'bottom'] as const) {
        await wear(slot, next[slot]);
      }
    } else {
      for (const slot of ['hair', 'beard', 'eyes', 'hat', 'top', 'bottom'] as const) {
        if (previous[slot] === next[slot]) continue;
        await wear(slot, next[slot]);
      }
    }
    current = next;
    applyRules(next);
  }

  let queue: Promise<void> = apply(look);
  await queue;

  return {
    object,
    height,
    look: () => current ?? wanted,
    setLook(next) {
      wanted = next;
      queue = queue.then(() => apply(wanted)).catch((err) => {
        console.error('[avatar] could not dress the captain', err);
      });
      return queue;
    },
    update(dt) {
      if (animate) body?.mixer?.update(dt);
    },
    dispose() {
      disposed = true;
      for (const meshes of worn.values()) for (const mesh of meshes) mesh.removeFromParent();
      worn.clear();
      if (body) object.remove(body.object);
      object.removeFromParent();
      body = null;
      skeleton = null;
      attachPoint = null;
    },
  };
}

/** World bounds of a built captain, measured through the bones (see assets.ts
 *  — a plain Box3 lies about a skinned mesh). */
export function measureAvatar(avatar: Avatar): THREE.Box3 {
  return measureRendered(avatar.object);
}

/* --------------------------------------------------------------------------
 * swatches — every option, drawn as itself
 * ----------------------------------------------------------------------- */

export interface SwatchRequest {
  slot: AvatarSlot;
  id: string | null;
}

/** `${slot}:${id ?? 'none'}` → a data: URL. The panel keys its swatches on it. */
export type SwatchSheet = Map<string, string>;

export const swatchKey = (slot: AvatarSlot, id: string | null): string => `${slot}:${id ?? 'none'}`;

/**
 * What the mannequin wears while a slot is being previewed.
 *
 * Fixed rather than "whatever the player currently has": a swatch row that
 * re-renders itself every time the captain changes would cost a bake per tap,
 * and a hat swatch that quietly shows yesterday's hair is worse than one that
 * always shows the same head. The body is the only part taken from the live
 * look, because a skin tone under a beard is information.
 */
const MANNEQUIN: Omit<CaptainLook, 'body'> = {
  hair: 'av_hair_short',
  beard: null,
  eyes: null,
  hat: null,
  top: 'av_top_tee',
  bottom: 'av_bottom_brown',
};

/** How much of the captain each family's swatch is cropped to, in body units. */
interface Triple { x: number; y: number; z: number }

const SWATCH_CROP: Record<AvatarSlot, { min: Triple; max: Triple }> = {
  // Skin is read off a FACE, not off a whole figure: at 74px three fully
  // dressed bodies differ only in the two inches of forearm between a sleeve
  // and a hand.
  body: { min: { x: -0.12, y: 0.36, z: -0.14 }, max: { x: 0.12, y: 0.64, z: 0.14 } },
  hair: { min: { x: -0.12, y: 0.37, z: -0.14 }, max: { x: 0.12, y: 0.66, z: 0.14 } },
  beard: { min: { x: -0.12, y: 0.33, z: -0.14 }, max: { x: 0.12, y: 0.6, z: 0.14 } },
  eyes: { min: { x: -0.12, y: 0.37, z: -0.14 }, max: { x: 0.12, y: 0.62, z: 0.14 } },
  hat: { min: { x: -0.12, y: 0.44, z: -0.14 }, max: { x: 0.12, y: 0.7, z: 0.14 } },
  top: { min: { x: -0.14, y: 0.12, z: -0.2 }, max: { x: 0.14, y: 0.38, z: 0.2 } },
  bottom: { min: { x: -0.12, y: 0.0, z: -0.12 }, max: { x: 0.12, y: 0.22, z: 0.12 } },
};

/**
 * Renders one small picture per option, off-screen, once.
 *
 * A creation screen whose options are a list of Spanish adjectives is a form,
 * not a creator: the player has to tap all 43 to find out what any of them are.
 * So every option is drawn as itself, on the same mannequin, cropped to the
 * part of the body it changes.
 *
 * It runs on a renderer of its own and gives the context back afterwards.
 * Sharing the stage's would be cheaper by one context, but three disables tone
 * mapping when it renders into a target rather than a canvas, so every material
 * the captain and the swatches have in common would recompile twice a frame.
 */
export async function bakeSwatches(
  bodyId: string,
  requests: readonly SwatchRequest[],
  size = 112
): Promise<SwatchSheet> {
  const sheet: SwatchSheet = new Map();
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size * 2;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch (err) {
    // No second context available: the panel falls back to a labelled swatch,
    // which is worse but is not a blank screen.
    console.warn('[avatar] no context for the swatch bake', err);
    return sheet;
  }

  try {
    renderer.setPixelRatio(1);
    renderer.setSize(size * 2, size * 2, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    // Flatter and brighter than the island's rig on purpose: a swatch is read
    // at 56px on a cream tile, and the measured 34-degree sun would put half of
    // every hat in shadow at that size.
    const key = new THREE.DirectionalLight(0xfff6e6, 2.5);
    key.position.set(2.4, 3.2, 3.0);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0xe8f6ff, 0xbfae94, 2.5));

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -20, 40);
    const avatar = await createAvatar({ ...MANNEQUIN, body: bodyId }, { animate: false });
    scene.add(avatar.object);

    const box = new THREE.Box3();
    const centre = new THREE.Vector3();
    const span = new THREE.Vector3();
    const partBox = new THREE.Box3();
    const scale = avatar.height / 0.69;

    for (const request of requests) {
      const look: CaptainLook =
        request.slot === 'body'
          ? { ...MANNEQUIN, body: request.id ?? bodyId }
          : { ...MANNEQUIN, body: bodyId, [request.slot]: request.id };
      await avatar.setLook(look);
      avatar.object.updateMatrixWorld(true);

      // The crop is the region of the BODY this family changes, widened to
      // whatever the option itself actually occupies — a wizard hat is taller
      // than any head box, and cropping it in half would hide the only thing
      // the picture is for.
      const crop = SWATCH_CROP[request.slot];
      box.set(
        new THREE.Vector3(crop.min.x, crop.min.y, crop.min.z).multiplyScalar(scale),
        new THREE.Vector3(crop.max.x, crop.max.y, crop.max.z).multiplyScalar(scale)
      );
      if (request.id && request.slot !== 'body') {
        partBox.makeEmpty();
        avatar.object.traverse((node) => {
          if (node.name !== request.id) return;
          partBox.union(measureRendered(node));
        });
        if (!partBox.isEmpty()) box.union(partBox);
      }

      box.getCenter(centre);
      box.getSize(span);
      // 3/4 from the front: the face is +x, so the camera stands off the front
      // quarter and a little above, which is the angle every hat, patch and
      // coat was drawn to be read at.
      const half = Math.max(span.x, span.y, span.z) * 0.56;
      camera.left = -half;
      camera.right = half;
      camera.top = half;
      camera.bottom = -half;
      camera.position.set(centre.x + 6, centre.y + 2.1, centre.z + 3.4);
      camera.lookAt(centre);
      camera.updateProjectionMatrix();

      renderer.render(scene, camera);
      sheet.set(swatchKey(request.slot, request.id), canvas.toDataURL('image/png'));
    }

    avatar.dispose();
  } catch (err) {
    console.warn('[avatar] swatch bake failed', err);
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }

  return sheet;
}
