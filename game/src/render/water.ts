import * as THREE from 'three';

/**
 * The ocean. This is the single largest thing on screen in both the island and
 * the sea scenes, so it carries most of the art direction.
 *
 * The reference look is not a smooth wave sim: it is a voxel grid of flat colour
 * cells that steps through a few blue bands by depth, with hard-edged white foam
 * chips scattered over it and a bright shallow ring hugging the shoreline. So the
 * shader quantises everything to a world-space cell grid and never interpolates —
 * any smooth gradient reads as the wrong game instantly.
 */

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uCell;
  varying vec3 vWorld;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    // Snap to the cell grid before displacing so whole cells rise together and
    // the surface stays blocky instead of turning into a smooth sheet.
    vec2 cell = floor(world.xz / uCell);
    float wave =
      sin(cell.x * 0.55 + uTime * 0.9) * 0.6 +
      sin(cell.y * 0.42 - uTime * 0.7) * 0.5 +
      sin((cell.x + cell.y) * 0.28 + uTime * 1.3) * 0.35;
    world.y += wave * uWaveHeight;
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uCell;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uShallow;
  uniform vec3 uShore;
  uniform vec3 uFoam;
  uniform sampler2D uDepthMap;   // island mask: r = land coverage 0..1
  uniform vec2 uDepthOrigin;     // world-space min corner of the mask
  uniform float uDepthSize;      // world-space size the mask covers
  uniform float uFoamAmount;
  varying vec3 vWorld;

  // Cheap value noise, quantised inputs only — keeps everything on the grid.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec2 cell = floor(vWorld.xz / uCell);

    // How close is land? The mask is blurred island coverage, so this doubles as
    // a depth proxy: 1 at the shoreline, 0 out in open water.
    vec2 uv = (vWorld.xz - uDepthOrigin) / uDepthSize;
    float land = 0.0;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      land = texture2D(uDepthMap, uv).r;
    }

    // Hard-stepped depth bands. No smoothstep: the reference has visible edges
    // between the blue rings, and softening them loses the whole look.
    vec3 col = uDeep;
    float band = land + hash(cell) * 0.06;          // dither breaks up band edges
    if (band > 0.12) col = uMid;
    if (band > 0.30) col = uShallow;
    if (band > 0.52) col = uShore;

    // Foam chips: sparse white cells that pop on and off, denser near the shore.
    float t = floor(uTime * 3.0);
    float n = hash(cell + t * 13.37);
    float density = uFoamAmount + land * 0.35;
    if (n > 1.0 - density) col = mix(col, uFoam, 0.85);

    // A brighter, near-solid foam ring right where the water meets the sand.
    if (land > 0.62 && land < 0.86) {
      float ring = hash(cell * 1.7 + t * 3.1);
      if (ring > 0.25) col = uFoam;
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface WaterOptions {
  size?: number;
  cell?: number;
  waveHeight?: number;
  foamAmount?: number;
  depthMap?: THREE.Texture | null;
  depthOrigin?: THREE.Vector2;
  depthSize?: number;
}

export class Water {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(opts: WaterOptions = {}) {
    const size = opts.size ?? 400;
    const cell = opts.cell ?? 1.0;
    // One vertex per cell: any coarser and the blocky wave motion disappears.
    const segments = Math.min(512, Math.round(size / cell));

    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uCell: { value: cell },
        uWaveHeight: { value: opts.waveHeight ?? 0.06 },
        uFoamAmount: { value: opts.foamAmount ?? 0.05 },
        uDeep: { value: new THREE.Color('#0f5c9c') },
        uMid: { value: new THREE.Color('#1a86c4') },
        uShallow: { value: new THREE.Color('#35b3d8') },
        uShore: { value: new THREE.Color('#7fe0e6') },
        uFoam: { value: new THREE.Color('#f2fbff') },
        uDepthMap: { value: opts.depthMap ?? new THREE.Texture() },
        uDepthOrigin: { value: opts.depthOrigin ?? new THREE.Vector2(-size / 2, -size / 2) },
        uDepthSize: { value: opts.depthSize ?? size },
      },
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'water';
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = -1;
  }

  setDepthMap(texture: THREE.Texture, origin: THREE.Vector2, size: number): void {
    this.material.uniforms.uDepthMap.value = texture;
    this.material.uniforms.uDepthOrigin.value = origin;
    this.material.uniforms.uDepthSize.value = size;
  }

  update(elapsed: number): void {
    this.material.uniforms.uTime.value = elapsed;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
