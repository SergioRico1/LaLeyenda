import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneRebindingSkeletons } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** Loads the optimized .glb models and hands out clones with their animations. */

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<LoadedModel>>();

/** Per-model dimensions measured by the asset pipeline. See measureRendered. */
export interface ModelDims {
  kb: number;
  clips: string[];
  size?: [number, number, number];
  min?: [number, number, number];
}

let manifestPromise: Promise<Record<string, ModelDims>> | null = null;

export function loadManifest(): Promise<Record<string, ModelDims>> {
  manifestPromise ??= fetch('assets/models/manifest.json').then((r) => r.json());
  return manifestPromise;
}

export function loadModel(id: string): Promise<LoadedModel> {
  let entry = cache.get(id);
  if (!entry) {
    entry = new Promise<LoadedModel>((resolve, reject) => {
      loader.load(
        `assets/models/${id}.glb`,
        (gltf) => {
          gltf.scene.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              // VoxEdit exports ship with smooth-shaded normals and shiny PBR
              // defaults; voxel art needs flat facets and no specular sheen.
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const mat of mats) {
                const m = mat as THREE.MeshStandardMaterial;
                if (m.isMeshStandardMaterial) {
                  m.roughness = 1;
                  m.metalness = 0;
                  m.flatShading = true;
                  if (m.map) m.map.magFilter = THREE.NearestFilter;
                  m.needsUpdate = true;
                }
              }
            }
          });
          resolve({ scene: gltf.scene, animations: gltf.animations });
        },
        undefined,
        reject
      );
    });
    cache.set(id, entry);
  }
  return entry;
}

export async function preload(ids: readonly string[]): Promise<void> {
  await Promise.all([loadManifest(), ...ids.map((id) => loadModel(id))]);
}

/** An independent copy that can be positioned and animated on its own. */
export interface ModelInstance {
  object: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  play(clipName?: string, opts?: { loop?: boolean; fade?: number }): THREE.AnimationAction | null;
}

export interface InstantiateOptions {
  /** Normalize the model so its footprint is this many world units wide. */
  fit?: number;
  /** Clip to start playing. Applied before fitting — see below. */
  clip?: string;
}

export async function instantiate(id: string, opts: InstantiateOptions = {}): Promise<ModelInstance> {
  const model = await loadModel(id);

  // Skeleton-aware clone, and this is load-bearing for every skinned model.
  //
  // Object3D.clone() does NOT clone a skeleton: SkinnedMesh.copy assigns
  // `this.skeleton = source.skeleton`, so a plain clone keeps drawing through
  // the ORIGINAL bones — the ones inside the cached gltf.scene, which is never
  // added to any scene and never scaled. Two things follow, and both bit us:
  //
  //  - Nothing this instance is scaled by can reach the geometry. A skinned
  //    vertex is drawn at `matrixWorld * bindMatrixInverse * boneWorld * v`,
  //    and in the default AttachedBindMode three keeps
  //    `bindMatrixInverse = inverse(matrixWorld)`. The mesh's own world matrix
  //    therefore cancels out exactly, and the size on screen is decided purely
  //    by where the BONES are. Bones outside this subtree meant fitToFootprint
  //    was a no-op: the avatar bodies drew at their native 0.58 units against a
  //    target of 10, and bldg_foundry "stayed roughly 20 units across whatever
  //    footprint it was normalized to" (see balance.json) for the same reason.
  //  - The mixer below animates this clone's bones, which nothing was bound to,
  //    so the clips silently did nothing.
  //
  // SkeletonUtils.clone rebinds each cloned SkinnedMesh to the cloned bones, so
  // the bones ride along inside the wrapper and both problems go away.
  const inner = cloneRebindingSkeletons(model.scene) as THREE.Group;

  // The clips animate the model's own nodes, root included, so anything written
  // directly onto that root is overwritten the moment the mixer ticks. These
  // exports carry a large normalizing scale (23x on the foundry) on the very
  // node the idle clip drives, so a naively scaled model snaps back to native
  // size on the first frame. Normalization therefore goes on a wrapper the
  // animation cannot reach, and it is measured only after the clip's first
  // frame has been applied, so what we measure is what actually renders.
  const object = new THREE.Group();
  object.name = `${id}_root`;
  object.add(inner);

  const mixer = model.animations.length ? new THREE.AnimationMixer(inner) : null;
  let current: THREE.AnimationAction | null = null;

  const instance: ModelInstance = {
    object,
    mixer,
    play(clipName, opts = {}) {
      if (!mixer) return null;
      // Clip names are inconsistent across the asset library ("idle" vs "Idle"
      // vs "More Movement"), so match case-insensitively and fall back to first.
      const clips = model.animations;
      const clip = clipName
        ? clips.find((c) => c.name.toLowerCase() === clipName.toLowerCase()) ??
          clips.find((c) => c.name.toLowerCase().includes(clipName.toLowerCase())) ??
          clips[0]
        : clips[0];
      if (!clip) return null;
      const action = mixer.clipAction(clip);
      action.loop = opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat;
      if (opts.loop === false) action.clampWhenFinished = true;
      if (current && current !== action) {
        current.fadeOut(opts.fade ?? 0.2);
        action.reset().fadeIn(opts.fade ?? 0.2).play();
      } else {
        action.reset().play();
      }
      current = action;
      return action;
    },
  };

  if (opts.clip !== undefined || mixer) instance.play(opts.clip, { loop: true });
  mixer?.update(0);
  if (opts.fit !== undefined) {
    const dims = (await loadManifest())[id];
    fitToFootprint(object, opts.fit, dims);
  }
  return instance;
}

/**
 * World-space bounds of a model AS DRAWN — the number to check anything against.
 *
 * The default Box3.setFromObject takes each mesh's geometry bounding box through
 * its world matrix. For a SkinnedMesh that is not what the GPU draws: the shader
 * puts every vertex through the bones, and the mesh's own world matrix cancels
 * out on the way (see instantiate). A skinned model can therefore report a
 * perfect 10 units while drawing at 0.58 — which is exactly how the avatar
 * bodies shipped 17x too small without a single size check noticing.
 *
 * So: when the subtree contains a SkinnedMesh, measure in Box3's `precise` mode,
 * which routes through SkinnedMesh.getVertexPosition and applies the same bone
 * transform the shader does. It costs one pass over the vertices, which is worth
 * it for the handful of skinned models in the library.
 */
export function measureRendered(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);

  let skinned = false;
  object.traverse((node) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });

  // updateWorldMatrix refreshes matrixWorld but never calls updateMatrixWorld,
  // and only the latter recomputes a SkinnedMesh's bindMatrixInverse. Measuring
  // without this reads a stale inverse and double-counts the model's own scale.
  if (skinned) object.updateMatrixWorld(true);

  return new THREE.Box3().setFromObject(object, skinned);
}

/**
 * Normalizes a model so its footprint matches a target world size, centred on
 * the origin with its base at y = 0. Source models range from 8 to 2685 units
 * across, so nothing can be placed sensibly without this.
 *
 * Pass the pipeline dimensions whenever they exist — runtime measurement is
 * wrong for the skinned models (see measureRendered).
 */
export function fitToFootprint(
  object: THREE.Object3D,
  targetWidth: number,
  dims?: ModelDims
): void {
  const size = new THREE.Vector3();
  const min = new THREE.Vector3();

  if (dims?.size && dims.min) {
    size.fromArray(dims.size);
    min.fromArray(dims.min);
  } else {
    const box = measureRendered(object);
    box.getSize(size);
    min.copy(box.min);
  }

  const scale = targetWidth / Math.max(size.x, size.z || 1);
  object.scale.setScalar(scale);

  // What this model was asked to be, left where a check can find it. main.ts's
  // __checkSizes reads it and compares against what actually draws, so a model
  // that ignores its normalization — in either direction — fails a capture
  // instead of reaching a player. Nothing else reads this.
  object.userData.fitTarget = targetWidth;

  // The offsets are in the model's own units, so they scale along with it.
  object.position.x = -(min.x + size.x / 2) * scale;
  object.position.z = -(min.z + size.z / 2) * scale;
  object.position.y = -min.y * scale;
}
