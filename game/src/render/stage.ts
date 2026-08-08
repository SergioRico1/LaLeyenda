import * as THREE from 'three';

/** Renderer, camera rig and lighting shared by every scene. */

export interface StageOptions {
  canvas: HTMLCanvasElement;
  /** Fixed size for deterministic screenshots; otherwise tracks the window. */
  fixedSize?: { width: number; height: number } | null;
}

/*
 * THE LIGHT, MEASURED OFF reference/island_hero.png
 * =================================================
 *
 * Everything below is a number read out of their frame, not a taste call. The
 * terrain's albedos in render/island.ts were calibrated against a rig, so this
 * one is solved BACKWARDS from the pixels that rig has to produce rather than
 * dialled by eye — move a knob here and the sand stops being their sand.
 *
 * DIRECTION. Their flag on the south beach is the cleanest gnomon in the
 * frame: a thin vertical pole on flat open sand. Its shadow leaves the base
 * up-and-left across the screen, which on this camera's diagonal means the sun
 * is over the viewer's right shoulder — behind the camera, not in front of it,
 * so almost every face we can see is a lit face and the shadows run away from
 * us. That is also the assumption render/island.ts already bakes into its wall
 * skins ("+x is lit, +z is shaded"), so the two agree by construction.
 *
 * HEIGHT. Their shadows run roughly one and a half to twice the height of the
 * thing casting them, and the tip travels away from the camera rather than
 * toward it — which on this projection only happens for a sun under about 33
 * degrees. Ours was at 53, and a high sun is most of why our light read as
 * flat: a shadow two-thirds of its caster's height barely clears the caster's
 * own footprint, so nothing in the frame ever laid a shape down on the ground
 * beside it. At 31 degrees a shadow's tip lands half a caster-height clear to
 * the left, and it is that clearance, not the darkness, that makes a shadow
 * readable at a phone's size.
 *
 * BALANCE. Sampled off their sand: lit #e1d3b4, the same sand under the flag's
 * shadow #aeab93. That is 55-62% of the lit value in linear light, and the
 * drop is bigger in red than in blue — the warm half of the light is what the
 * shadow loses, the cool sky half is what stays. So the sun is warm and the
 * ambient is cool, and the two are balanced so a lit top face still lands on
 * exactly the albedo the terrain was painted for.
 *
 * The numbers this produces, against theirs:
 *
 *                  ours              theirs
 *   sand top   lit 225,211,180       225,211,180
 *             cast 170,170,152       174,171,147
 *   grass top  lit 149,183,67        151,186,75
 *             cast 112,147,55        118,159,55
 *   sand wall   +x 242,191,143       224,176,130
 *               +z 156,124,95        160,131,104
 *
 * The one place we run brighter than they do is the sunlit wall, and that is
 * not this file's to fix: render/island.ts paints its sunny and shady terrace
 * skins as two different albedos, so a wall square to a low sun gets the skin's
 * contrast AND the geometry's on top of it. Pulling the sun down to hide that
 * would cost every shadow in the frame. The shoulder below keeps it off the
 * ceiling instead.
 *
 * The share of open sand that ends up in shadow, measured on the capture: 8.5%
 * in their frame, 8.3% in ours before this, 15.7% after. Not short of theirs.
 */

/** Degrees above the horizon. Low, and that is the point: at this camera the
 *  tip of a shadow lands 0.51 of the caster's height to the LEFT of its own
 *  foot and 0.04 further UP the screen, so it steps out from behind the thing
 *  casting it and lies down on the ground as its own readable shape. Both
 *  numbers go the wrong way above about 33 degrees. */
const SUN_ELEVATION = 31;
/** Degrees from +z toward +x. Puts the sun over the camera's right shoulder,
 *  which lays every shadow up-and-left exactly as theirs fall — and keeps +x
 *  the lit wall and +z the shaded one, which render/island.ts has already
 *  painted its terrace skins for. */
const SUN_AZIMUTH = 57;
/** How far out the sun is parked. Only sets where the shadow frustum's near
 *  and far planes have to sit; a directional light has no falloff. */
const SUN_DISTANCE = 120;

/**
 * Half-width of the shadow frustum, in world units.
 *
 * The island is 26 units across and the outlying islets reach about 28, and a
 * 31-degree sun throws each palm's shadow another 6 or so past whatever casts
 * it. 32 covers all of that with room to spare, and at a 2048 map that is one
 * shadow texel every 0.031 units — about one screen pixel at the island
 * camera's reach. Measured on the capture, the sharpest shadow edges in the
 * frame resolve in 2 pixels, so the voxels keep their corners.
 */
const SHADOW_EXTENT = 32;

/**
 * A soft shoulder on the top end, and nothing else.
 *
 * With the sun this low, a wall square to it takes MORE light than a flat roof
 * does, so the brightest sand in the frame is now a vertical face rather than
 * the ground. That is right — it is right in their frame too — but it puts the
 * top of the range within reach of a white sail or a foam chip, and a channel
 * that clips at 255 takes the texture with it. This rolls everything above
 * KNEE into the last stop asymptotically, so nothing can reach 1.0 however
 * hard it is lit, while everything below KNEE — which is all of the sand, all
 * of the grass and every shadow — passes through completely untouched.
 *
 * Deliberately NOT a filmic curve: ACES and friends buy their highlight
 * rolloff with a saturation loss across the whole image, and our greens and
 * sands already measure at their reference's saturation. There is nothing here
 * to spend.
 */
const TONE_SHOULDER = /* glsl */ `
vec3 CustomToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	const float KNEE = 0.82;
	const float ROOM = 1.0 - KNEE;
	vec3 over = max( color - KNEE, 0.0 );
	return min( color, KNEE + ROOM * ( 1.0 - exp( - over / ROOM ) ) );
}
`;

let toneInstalled = false;
function installToneCurve(): void {
  if (toneInstalled) return;
  toneInstalled = true;
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    TONE_SHOULDER
  );
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  /** Sun position relative to whatever it is lighting. A scene that moves the
   *  sun (the sea follows the boat with it) should offset by THIS rather than
   *  by a triple of its own, or its shadows fall a different way to the
   *  island's. */
  readonly sunOffset: THREE.Vector3;
  private fixedSize: { width: number; height: number } | null;

  constructor(opts: StageOptions) {
    this.fixedSize = opts.fixedSize ?? null;

    installToneCurve();

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    // Mobile GPUs choke above 2x; the voxel art gains nothing from more.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.CustomToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8fd8ec');

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 800);

    const elevation = THREE.MathUtils.degToRad(SUN_ELEVATION);
    const azimuth = THREE.MathUtils.degToRad(SUN_AZIMUTH);
    this.sunOffset = new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth)
    ).multiplyScalar(SUN_DISTANCE);

    // Warm, and strong enough that losing it is the difference between a lit
    // face and a shadowed one rather than a slight dimming.
    this.sun = new THREE.DirectionalLight(0xfff4e2, 2.28);
    this.sun.position.copy(this.sunOffset);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);

    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -SHADOW_EXTENT;
    shadowCamera.right = SHADOW_EXTENT;
    shadowCamera.top = SHADOW_EXTENT;
    shadowCamera.bottom = -SHADOW_EXTENT;
    // Bracketed around the sun's own distance rather than left at 0.5..500, so
    // the depth range is spent on the slab the island occupies. Wide enough
    // either side to tolerate a scene that parks the sun on a shorter arm than
    // SUN_DISTANCE — the sea does — because a caster in front of the near plane
    // silently stops casting, and an ortho depth buffer is linear so the slack
    // costs nothing.
    shadowCamera.near = SUN_DISTANCE - SHADOW_EXTENT * 2.5;
    shadowCamera.far = SUN_DISTANCE + SHADOW_EXTENT * 2.5;
    // THE line this file was missing. LightShadow.updateMatrices copies the
    // light's position and re-derives the view matrix every frame, but it
    // never touches the shadow camera's PROJECTION — so an ortho frustum
    // assigned after construction is stored on the object and never compiled.
    // Without this the whole island was being shadow-mapped through the
    // DirectionalLightShadow default, a 10x10 box around the origin, which is
    // why the frame had no readable shadows in it at all: not a lighting
    // balance problem, a stale matrix.
    shadowCamera.updateProjectionMatrix();

    // Slope acne on a 0.031-unit texel is a fraction of a voxel, so almost all
    // of the correction is normalBias — it walks the lookup along the surface
    // normal instead of pushing depth, which is what keeps a shadow's edge
    // welded to the foot of the thing casting it.
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    // A hair over one texel of PCF: enough that a long shadow's edge is not a
    // staircase, not so much that it turns to fog.
    this.sun.shadow.radius = 1.2;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Cool sky above, warm sand bounce below. The sky half is what a cast
    // shadow is lit by, so its colour IS the shadow's colour, and its strength
    // is what stops the shadow going to ink; the ground half is deliberately
    // much dimmer than the sky so an underside or a wall turned away from the
    // sun still falls off and the blocks read as carved.
    this.scene.add(new THREE.HemisphereLight(0xd8f0ff, 0xc1ae8a, 1.96));

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Parks the sun so it lights `at` from the measured angle, keeping every
   *  shadow in the game parallel to every other one. */
  aimSun(at: THREE.Vector3): void {
    this.sun.position.copy(at).add(this.sunOffset);
    this.sun.target.position.copy(at);
    this.sun.target.updateMatrixWorld();
  }

  resize(): void {
    const width = this.fixedSize?.width ?? window.innerWidth;
    const height = this.fixedSize?.height ?? window.innerHeight;
    this.renderer.setSize(width, height, !this.fixedSize);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
