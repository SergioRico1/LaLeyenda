import * as THREE from 'three';
import { instantiate } from './assets';

/**
 * scatter.ts — hundreds of static props for a handful of draw calls.
 *
 * WHY THIS EXISTS
 *
 * The reference island is PACKED: palms crowding the rims, bushes banked against
 * every wall, crates and barrels in the gaps. Ours was six buildings on bare
 * ground, and the naive fix — call `instantiate` once per prop — is the reason
 * it stayed that way. These are VoxEdit exports with one material per voxel
 * part: a single bush is 26 materials, a palm 9. Fifteen props already cost 40
 * draw calls, so the hundred-odd the composition wants would have cost ~800 on
 * their own, against a budget of 100 for the whole frame.
 *
 * So a prop is not a model here. Each distinct model is loaded ONCE, flattened
 * into a single geometry whose per-part colours are baked into a vertex colour
 * attribute, and then drawn as one InstancedMesh however many times it appears.
 * Cost is one draw call per DISTINCT model, not per prop.
 *
 * The technique is the one the terrain already uses (island.ts merges its cells
 * into one vertex-coloured geometry per material) and it works here for the same
 * reason: these palette textures are flat colour per voxel face, so sampling the
 * texel a face points at loses nothing a player could see.
 *
 * The trade is that scattered props are STATIC — the palm sway clips are baked
 * at their first frame. That is the right trade at this budget, and it is why
 * this is called `scatter` and not `instantiate`: anything that has to animate,
 * be tapped, or be moved stays a real model.
 */

export interface ScatterItem {
  /** Model id in public/assets/models. */
  model: string;
  /** World position of the prop's base. */
  position: THREE.Vector3;
  /** Yaw, radians. */
  rotationY: number;
  /** Footprint in world units — the model is normalized to 1 and scaled by this. */
  scale: number;
  /** Extra vertical squash/stretch, so a cluster is not obviously one model. */
  scaleY?: number;
  /** Multiplies the baked albedo, for per-instance variation. */
  tint?: THREE.Color;
}

/**
 * Reads a texture's pixels once so vertices can be coloured from it.
 *
 * GLTFLoader hands back an ImageBitmap (or an HTMLImageElement); both can be
 * drawn to a canvas, and the palettes are 256px at most after the asset
 * pipeline's resize, so this is a few hundred KB of ImageData per model.
 */
interface Pixels { data: Uint8ClampedArray; w: number; h: number; flipY: boolean }

const pixelCache = new WeakMap<THREE.Texture, Pixels | null>();

function readPixels(texture: THREE.Texture | null): Pixels | null {
  if (!texture) return null;
  const cached = pixelCache.get(texture);
  if (cached !== undefined) return cached;

  const image = texture.image as (ImageBitmap | HTMLImageElement | HTMLCanvasElement | undefined);
  const w = (image as ImageBitmap | undefined)?.width ?? 0;
  const h = (image as ImageBitmap | undefined)?.height ?? 0;
  let result: Pixels | null = null;
  if (image && w && h) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(image as CanvasImageSource, 0, 0);
        result = { data: ctx.getImageData(0, 0, w, h).data, w, h, flipY: texture.flipY };
      }
    } catch {
      result = null;   // a tainted or unreadable texture falls back to material.color
    }
  }
  pixelCache.set(texture, result);
  return result;
}

/** Wraps a UV coordinate into [0,1) the way RepeatWrapping does. */
const wrap = (v: number): number => v - Math.floor(v);

/** One model, flattened to a single vertex-coloured geometry with a unit footprint. */
type Baked = THREE.BufferGeometry;

const bakeCache = new Map<string, Promise<Baked | null>>();

async function bake(model: string): Promise<Baked | null> {
  let entry = bakeCache.get(model);
  if (entry) return entry;

  entry = (async () => {
    // fit: 1 normalizes the footprint to one world unit and puts the base at
    // y = 0, so a ScatterItem's `scale` reads directly as "this many cells
    // wide". The clip is played and the mixer ticked inside instantiate, so
    // what gets baked is the pose the model would actually have rendered in.
    const source = await instantiate(model, { fit: 1 });
    source.object.updateWorldMatrix(false, true);

    const positions: number[] = [];
    const normals: number[] = [];
    const colours: number[] = [];

    const normalMatrix = new THREE.Matrix3();
    const vertex = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const colour = new THREE.Color();
    const albedo = new THREE.Color();

    source.object.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      if (!position) return;

      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      const pixels = readPixels(material.map ?? null);
      const uv = geometry.getAttribute('uv');
      const sourceNormal = geometry.getAttribute('normal');
      const index = geometry.getIndex();
      const count = index ? index.count : position.count;

      mesh.updateWorldMatrix(true, false);
      normalMatrix.getNormalMatrix(mesh.matrixWorld);

      for (let i = 0; i < count; i++) {
        const v = index ? index.getX(i) : i;
        vertex.fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld);
        positions.push(vertex.x, vertex.y, vertex.z);

        if (sourceNormal) {
          normal.fromBufferAttribute(sourceNormal, v).applyMatrix3(normalMatrix).normalize();
          normals.push(normal.x, normal.y, normal.z);
        } else {
          normals.push(0, 1, 0);
        }

        albedo.copy(material.color ?? new THREE.Color(0xffffff));
        let sampled = false;
        if (pixels && uv) {
          // Nearest sample: these are palette atlases where a bilinear tap
          // between two unrelated swatches invents a colour the artist never
          // used. NearestFilter is set on the live material for the same reason.
          //
          // glTF textures load with flipY = false, so v runs top-down and the
          // usual 1 - v is exactly wrong. Getting this backwards samples a row
          // of the atlas the face never referenced, which on these palettes is
          // transparent padding — every prop came out black.
          const u = wrap(uv.getX(v));
          const t = pixels.flipY ? wrap(1 - uv.getY(v)) : wrap(uv.getY(v));
          const px = Math.min(pixels.w - 1, Math.floor(u * pixels.w));
          const py = Math.min(pixels.h - 1, Math.floor(t * pixels.h));
          const at = (py * pixels.w + px) * 4;
          if (pixels.data[at + 3] > 8) {
            // The map is sRGB-encoded and vertex colours are consumed in the
            // renderer's working (linear) space, exactly as island.ts converts
            // its palette. Skipping this washes every prop out.
            colour.setRGB(pixels.data[at] / 255, pixels.data[at + 1] / 255, pixels.data[at + 2] / 255, THREE.SRGBColorSpace);
            colour.multiply(albedo);
            sampled = true;
          }
        }
        if (!sampled) colour.copy(albedo);
        colours.push(colour.r, colour.g, colour.b);
      }
    });

    if (!positions.length) return null;

    // A bake that silently sampled the wrong texels renders as a black
    // silhouette, which is easy to miss among two hundred props and impossible
    // to miss once it is a number. Anything this dark is a bug, not art.
    let luma = 0;
    for (let i = 0; i < colours.length; i += 3) {
      luma += 0.2126 * colours[i] + 0.7152 * colours[i + 1] + 0.0722 * colours[i + 2];
    }
    luma /= colours.length / 3;
    if (luma < 0.02) console.warn(`[scatter] ${model} baked near-black (luma ${luma.toFixed(3)}) — check the map's flipY`);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.computeBoundingSphere();
    return geometry;
  })();

  bakeCache.set(model, entry);
  return entry;
}

/**
 * Builds one InstancedMesh per distinct model. The returned group is static —
 * nothing in it animates, and nothing in it should be raycast against, so it is
 * left out of the scene's pickable list.
 */
export async function buildScatter(items: readonly ScatterItem[]): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'scatter';

  const byModel = new Map<string, ScatterItem[]>();
  for (const item of items) {
    let list = byModel.get(item.model);
    if (!list) byModel.set(item.model, (list = []));
    list.push(item);
  }

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (const [model, list] of byModel) {
    const geometry = await bake(model);
    if (!geometry) {
      console.warn(`[scatter] ${model} baked to nothing — skipped`);
      continue;
    }
    // Lambert, flat-shaded, matching the terrain it stands on. The source
    // materials are MeshStandardMaterial at roughness 1 / metalness 0, which is
    // diffuse-only anyway, so this renders the same and costs less.
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    mesh.name = `scatter_${model}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // The island is always fully in frame, and a per-instance bounding volume
    // would be the only way to cull usefully — not worth the per-frame cost.
    mesh.frustumCulled = false;

    let tinted = false;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      quaternion.setFromAxisAngle(up, item.rotationY);
      scale.set(item.scale, item.scale * (item.scaleY ?? 1), item.scale);
      matrix.compose(item.position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      if (item.tint) { mesh.setColorAt(i, item.tint); tinted = true; }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  return group;
}
