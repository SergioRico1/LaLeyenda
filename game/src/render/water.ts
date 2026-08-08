import * as THREE from 'three';

/**
 * The ocean — the largest surface on screen, and the one carrying most of the
 * art direction.
 *
 * Everything here is driven by measurements taken off the reference frames:
 *
 * - The surface is provably FLAT. The reference horizon is a straight line, hulls
 *   cut the water at a dead-level waterline, and there is no specular anywhere.
 *   The foam chips are the only highlights the art direction uses.
 * - Colour is a finely quantised ramp with per-cell dither (~12 steps, 2-3 tones
 *   co-existing at any given distance), not a few hard bands. Hard bands read as
 *   contour lines on a map.
 * - The single most important effect is the VIEW RAMP: water seen steeply from
 *   above is near-navy, water seen at a grazing angle brightens and desaturates
 *   into the sky colour, with no hard horizon. Without it the ocean reads as a
 *   painted floor rather than a surface.
 * - Foam is a SHORE phenomenon. It covers ~44% of the water at the sand edge and
 *   decays exponentially to under 1% in open water. It is also clustered, so most
 *   of the open ocean carries none at all; spreading it evenly gives confetti.
 * - Foam chips are elongated rectangles aligned to one world axis, drawn in two
 *   tiers (a dim plate with a bright core), and they are fogged by the same view
 *   ramp as the water.
 *
 * All of that was measured, and all of it is still here. What it did NOT account
 * for is where the reference actually keeps its texture. Sampling both frames in
 * eighths from the far edge to the near one:
 *
 *   island_hero far → near   sd 20 · 28 · 37 · 40 · 55 · 59 · 69 · 74
 *                            L>200   1% ·  2% ·  5% ·  5% · 10% ·  9% · 17% · 20%
 *                            L<55    0% ·  1% ·  0% ·  0% ·  3% · 39% · 52% · 40%
 *   sea_combat far → near    sd 26 · 18 · 23 · 21 · 17 · 23 · 53 · 43
 *
 * Two things fall out of that and neither was in the shader. First, water seen
 * steeply from above is not one colour with a whisper of grain on it: half of it
 * is darker than L=55 and a fifth of it is brighter than L=200 AT THE SAME TIME.
 * That is sun glitter — a dense population of near-white chips over a navy base,
 * clustered into patches, and it is by far the largest source of texture in both
 * frames. Second, even the calm far water carries sd 20, where ours carried 3:
 * the per-cell tone spread is a quarter of the cell's own value, not the 5%
 * wobble a multiply gives you.
 *
 * Both are keyed to the same view angle the ramp already computes: the glitter
 * lives where the surface is seen steeply and fades out toward the horizon, so
 * it is the near-camera water that sparkles and the far water that stays flat.
 */

const vertexShader = /* glsl */ `
  varying vec3 vWorld;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uCell;          // world size of one water cell
  uniform vec3  uRamp[6];       // depth ramp stops, shallow -> deep
  uniform vec3  uHorizon;       // colour the water resolves to at grazing angles
  uniform vec3  uNear;          // colour the water darkens to when seen steeply
  uniform vec3  uDeep;          // darkest tone a single cell can take
  uniform vec3  uCrest;         // lightest tone a single cell can take
  uniform vec3  uGlintDim;
  uniform vec3  uGlintBright;
  uniform float uGlitter;       // scene-level gain on the sun glitter
  uniform vec3  uFoamBright;
  uniform vec3  uFoamDim;
  uniform vec3  uRing;          // solid waterline collar
  uniform vec3  uRingSoft;
  uniform sampler2D uShoreSDF;  // r = distance to land, world units / uSDFRange
  uniform vec2  uSDFOrigin;
  uniform float uSDFSize;
  uniform float uSDFRange;
  uniform float uHasShore;      // 0 in open sea scenes with no island
  uniform float uFoamFloor;     // open-water foam density
  uniform vec3  uCameraPos;

  varying vec3 vWorld;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  /** Distance from this point to the nearest land, in world units. */
  float shoreDistance() {
    if (uHasShore < 0.5) return uSDFRange;
    vec2 uv = (vWorld.xz - uSDFOrigin) / uSDFSize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return uSDFRange;
    return texture2D(uShoreSDF, uv).r * uSDFRange;
  }

  /** Colour at ramp position t in [0,1], linear between the six stops. */
  vec3 rampColour(float t) {
    float s = clamp(t, 0.0, 1.0) * 5.0;
    int i = int(floor(s));
    float f = fract(s);
    if (i >= 5) return uRamp[5];
    if (i == 4) return mix(uRamp[4], uRamp[5], f);
    if (i == 3) return mix(uRamp[3], uRamp[4], f);
    if (i == 2) return mix(uRamp[2], uRamp[3], f);
    if (i == 1) return mix(uRamp[1], uRamp[2], f);
    return mix(uRamp[0], uRamp[1], f);
  }

  void main() {
    vec2 cell = floor(vWorld.xz / uCell);
    float d = shoreDistance();

    // Depth ramp, quantised with per-cell dither so band edges break into
    // speckle instead of drawing clean contour rings.
    float t = 1.0 - exp(-d / 1.1);
    float dither = hash21(cell) * 0.9;
    t = floor(t * 12.0 + dither) / 12.0;
    vec3 col = rampColour(t);

    // How grazing is this pixel? 0 = looking straight down, 1 = edge-on.
    // Both the tone spread and the glitter hang off this, so it is computed
    // before either of them.
    vec3 toCam = normalize(uCameraPos - vWorld);
    float graze = pow(1.0 - max(toCam.y, 0.0), 2.2);
    float steep = 1.0 - graze;

    // The second, larger structure the reference has and a depth ramp cannot
    // give you: broad fields of lighter and darker water, tens of metres across,
    // that owe nothing to how deep the water is. Two octaves is enough — the
    // point is the low frequency, not the detail.
    float swell = valueNoise(vWorld.xz * 0.052) * 0.62
                + valueNoise(vWorld.xz * 0.157 + 31.0) * 0.38;

    // Per-cell tone. The reference's calm water runs #103068 -> #205880 between
    // NEIGHBOURING cells — a quarter of the cell's own value, not a 5% wobble —
    // and it is drawn on two cell shapes at once so the field breaks into
    // elongated streaks rather than a checkerboard. Quantised to six steps,
    // because this is voxel water and a smooth gradient is the wrong material.
    vec2 streak = floor(vec2(vWorld.x / (uCell * 3.0), vWorld.z / uCell));
    float tone = hash21(cell + 17.0) * 0.52 + hash21(streak + 4.2) * 0.48;
    tone = tone * 0.70 + swell * 0.30;
    tone = clamp(floor(tone * 6.0) / 5.0, 0.0, 1.0);
    col = mix(mix(col, uDeep, 0.44), mix(col, uCrest, 0.42), tone);

    // Foam. Density decays exponentially from the shoreline, and a low-frequency
    // mask keeps most of the open ocean clear so the chips read as surf clusters.
    float density = uFoamFloor + 0.44 * exp(-d / 0.60);
    float clump = valueNoise(vWorld.xz * 0.35 + uTime * 0.02);
    // Most of the open ocean carries no foam at all; without this gate the
    // chips spread evenly and read as confetti rather than surf.
    density *= mix(0.04, 1.0, smoothstep(0.55, 0.72, clump));

    // Chips scroll rather than reseed, so they drift instead of teleporting.
    vec2 drift = vWorld.xz + uTime * vec2(0.35, 0.12);
    vec2 chip = floor(vec2(drift.x / (uCell * 4.0), drift.y / uCell));
    vec2 chipWide = floor(vec2(drift.x / (uCell * 6.0), drift.y / (uCell * 2.0)));

    float phase = smoothstep(0.0, 0.15, sin(hash21(chip) * 6.2831 + uTime * 0.8) + 0.35);
    float dimHit = step(1.0 - min(density * 2.2, 0.75), hash21(chipWide + 3.7));
    float brightHit = step(1.0 - density, hash21(chip + 91.3)) * phase;

    // Sun glitter — the effect carrying most of the reference's texture, and the
    // one that was missing outright. It is NOT foam: it does not care where the
    // shore is, it lives wherever the surface is seen steeply enough to throw the
    // sun back at the camera, which is why both frames go from sd 20 at the far
    // edge to sd 74 at the near one.
    //
    // Keyed on toCam.y rather than on graze, because graze is squashed by its
    // own exponent into 0.65..0.99 across this camera's frame and would spread
    // the glitter evenly over all of it. toCam.y runs 0.35 at the top of the
    // frame to 0.88 at the bottom, which is the range that needs resolving.
    float glintZone = smoothstep(0.34, 0.86, max(toCam.y, 0.0)) * uGlitter;
    float glintPatch = valueNoise(vWorld.xz * 0.115 + uTime * vec2(0.012, 0.004));
    float glint = glintZone * smoothstep(0.26, 0.62, glintPatch);

    // Chips are sampled at their own CENTRE, so a smooth field read through the
    // chip grid comes back as blocks that agree with their neighbours. That is
    // what makes the reference's glitter read as broken wave crests three to six
    // cells across instead of the even static a per-cell hash gives you.
    vec2 gdrift = vWorld.xz + uTime * vec2(0.16, 0.05);
    vec2 gsize = vec2(uCell * 1.9, uCell * 1.05);
    vec2 gcell = floor(gdrift / gsize);
    vec2 gpos = (gcell + 0.5) * gsize;
    float crest = valueNoise(gpos * 1.30) * 0.66 + hash21(gcell + 61.0) * 0.34;
    float dimGlint = step(1.0 - glint * 0.60, crest);
    // The bright core is drawn from the same field, so it lands INSIDE a dim
    // plate rather than beside one — a two-tier chip, like the foam.
    float brightGlint = step(1.0 - glint * 0.27, crest * 0.62 + hash21(gcell + 133.0) * 0.38);

    vec3 foamDim = mix(uFoamDim, uHorizon, clamp(graze, 0.0, 0.93));
    vec3 foamBright = mix(uFoamBright, uHorizon, clamp(graze, 0.0, 0.93));
    vec3 glintDim = mix(uGlintDim, uHorizon, clamp(graze, 0.0, 0.93));
    vec3 glintBright = mix(uGlintBright, uHorizon, clamp(graze, 0.0, 0.93));

    // Water first, then the view ramp, then everything that sits on the surface,
    // so the chips are fogged by exactly the same amount as the water is.
    col = mix(col, uHorizon, clamp(graze, 0.0, 0.93));
    col = mix(col, uNear, pow(1.0 - graze, 3.0) * 0.55);

    col = mix(col, glintDim, dimGlint * 0.72);
    col = mix(col, glintBright, brightGlint);
    col = mix(col, foamDim, dimHit * 0.85);
    col = mix(col, foamBright, brightHit);

    // A solid collar exactly where water meets sand — one cell wide, no dither.
    if (uHasShore > 0.5) {
      if (d < uCell) col = mix(uRing, uHorizon, clamp(graze, 0.0, 0.93));
      else if (d < uCell * 1.4) col = mix(uRingSoft, uHorizon, clamp(graze, 0.0, 0.93));
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export type WaterPalette = 'lagoon' | 'ocean';

interface Palette {
  ramp: string[];
  horizon: string;
  near: string;
  /** Ends of the per-cell tone spread. Sampled off neighbouring cells in the
   *  reference: #103068 to #205880 in open water, #006098 to #1088B0 inshore. */
  deep: string;
  crest: string;
  glintDim: string;
  glintBright: string;
  foamBright: string;
  foamDim: string;
}

const PALETTES: Record<WaterPalette, Palette> = {
  // Shallow water around the home island: cyan-dominant, bright.
  lagoon: {
    ramp: ['#35B1C5', '#2DA7C2', '#2898B6', '#1D92B7', '#0E7AA9', '#066C9D'],
    horizon: '#0A74A2',
    near: '#02205A',
    deep: '#032F66',
    crest: '#5CCBDD',
    glintDim: '#A6E1EA',
    glintBright: '#F4FCFF',
    foamBright: '#DCF6E8',
    foamDim: '#8FD2CB',
  },
  // Open sea: blue-dominant, resolving into the sky at the horizon.
  ocean: {
    ramp: ['#2E7B90', '#20577E', '#1B4A74', '#163A6B', '#102F63', '#0C255F'],
    horizon: '#82B0A7',
    near: '#0C255F',
    deep: '#05173F',
    crest: '#4A97B4',
    glintDim: '#9DC4D6',
    glintBright: '#FFFFFF',
    foamBright: '#FEFFFE',
    foamDim: '#4E7E93',
  },
};

export interface WaterOptions {
  size?: number;
  /** World size of one water cell. Roughly 1/5 of a terrain block. */
  cell?: number;
  palette?: WaterPalette;
  /** Gain on the sun glitter. 0 turns it off entirely. */
  glitter?: number;
  shoreSDF?: THREE.Texture | null;
  sdfOrigin?: THREE.Vector2;
  sdfSize?: number;
  /** World distance the SDF texture saturates at. */
  sdfRange?: number;
}

export class Water {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(opts: WaterOptions = {}) {
    const size = opts.size ?? 420;
    const cell = opts.cell ?? 0.2;
    const palette = PALETTES[opts.palette ?? 'lagoon'];

    // The surface is flat, so the geometry only needs enough vertices to keep
    // the world position interpolation accurate — the cell quantisation happens
    // per fragment. One vertex per world unit is plenty.
    const segments = Math.min(256, Math.round(size / 2));
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uCell: { value: cell },
        uRamp: { value: palette.ramp.map((hex) => new THREE.Color(hex)) },
        uHorizon: { value: new THREE.Color(palette.horizon) },
        uNear: { value: new THREE.Color(palette.near) },
        uDeep: { value: new THREE.Color(palette.deep) },
        uCrest: { value: new THREE.Color(palette.crest) },
        uGlintDim: { value: new THREE.Color(palette.glintDim) },
        uGlintBright: { value: new THREE.Color(palette.glintBright) },
        uGlitter: { value: opts.glitter ?? 1 },
        uFoamBright: { value: new THREE.Color(palette.foamBright) },
        uFoamDim: { value: new THREE.Color(palette.foamDim) },
        uRing: { value: new THREE.Color('#E4F0E1') },
        uRingSoft: { value: new THREE.Color('#CEECDF') },
        uShoreSDF: { value: opts.shoreSDF ?? new THREE.Texture() },
        uSDFOrigin: { value: opts.sdfOrigin ?? new THREE.Vector2(-size / 2, -size / 2) },
        uSDFSize: { value: opts.sdfSize ?? size },
        uSDFRange: { value: opts.sdfRange ?? 8 },
        uHasShore: { value: opts.shoreSDF ? 1 : 0 },
        uFoamFloor: { value: 0.004 },
        uCameraPos: { value: new THREE.Vector3() },
      },
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'water';
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  setShoreSDF(texture: THREE.Texture, origin: THREE.Vector2, size: number, range: number): void {
    this.material.uniforms.uShoreSDF.value = texture;
    this.material.uniforms.uSDFOrigin.value = origin;
    this.material.uniforms.uSDFSize.value = size;
    this.material.uniforms.uSDFRange.value = range;
    this.material.uniforms.uHasShore.value = 1;
  }

  update(elapsed: number, camera: THREE.Camera): void {
    this.material.uniforms.uTime.value = elapsed;
    this.material.uniforms.uCameraPos.value.setFromMatrixPosition(camera.matrixWorld);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
