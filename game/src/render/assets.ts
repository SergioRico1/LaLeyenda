import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
  const inner = model.scene.clone(true);

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
 * Runtime bounds of a model, for cases where no pipeline dimensions exist.
 *
 * Prefer the manifest: almost every model here is a SkinnedMesh whose armature
 * carries a large scale (23x on the foundry), and three.js reports the
 * pre-armature extent — Box3.setFromObject and SkinnedMesh.computeBoundingBox
 * both come back short by exactly that factor. Only the file itself, read
 * through the node scales, gives the size the GPU actually draws.
 */
export function measureRendered(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
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

  // The offsets are in the model's own units, so they scale along with it.
  object.position.x = -(min.x + size.x / 2) * scale;
  object.position.z = -(min.z + size.z / 2) * scale;
  object.position.y = -min.y * scale;
}
