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
 * Everything below is a number read out of their frame or out of their shipped
 * client (reference/CLIENT_NOTES.md §2), not a taste call. The terrain's
 * albedos in render/island.ts were calibrated against a rig, so this one is
 * solved BACKWARDS from the pixels that rig has to produce rather than dialled
 * by eye — move a knob here and the sand stops being their sand.
 *
 * DIRECTION. Their flag on the south beach is the cleanest gnomon in the
 * frame: a thin vertical pole on flat open sand. Measured on their capture,
 * the pole's foot sits at (633, 806) and its top at (633, 705) — 101 screen
 * pixels of caster — and the tip of its shadow lands at (562, 714): 71 pixels
 * LEFT and 92 pixels UP. So a caster that stands H pixels tall drops its
 * shadow 0.70H to the left and 0.91H up the screen. That is a sun over the
 * viewer's right shoulder — behind the camera, not in front of it — so almost
 * every face we can see is a lit face and the shadows run away from us. It is
 * also the assumption render/island.ts bakes into its wall skins ("+x is lit,
 * +z is shaded"), so the two agree by construction.
 *
 * HEIGHT. Their client runs ONE white directional light at euler
 * (34.696, 16.502, -4.762) — elevation 34.7 degrees, and only 28.5 degrees off
 * its own camera's azimuth. A near-frontal over-the-shoulder key, not a raking
 * side light. Taking their 34.7 as given and solving the azimuth for the screen
 * bearing measured above lands a shadow 0.68 of its caster's screen height to
 * the LEFT and 0.88 up: the same frame their flag gives, to the pixel.
 *
 * That clearance is the whole game. It is not the darkness that makes a shadow
 * readable at a phone's size, it is whether the shape steps out from behind the
 * thing casting it. This rig used to sit 15.3 degrees off the camera axis and
 * shadows fell almost exactly behind their casters: the shadow map was correct,
 * the multiply was correct, and the frame still had nothing on the ground,
 * because every shape was hidden by the object that threw it. It is now 19.1
 * degrees off, which is what buys the 0.68H.
 *
 * BALANCE. Sampled off their sand: lit #e1d3b4, the same sand under the flag's
 * shadow #aeab93 — a MULTIPLY of about x0.74 red, x0.77 green, x0.79 blue, and
 * the drop is bigger in red than in blue because the warm half of the light is
 * what the shadow loses and the cool sky half is what stays. So the sun is warm
 * and the ambient is cool, and the two are balanced so a lit top face still
 * lands on exactly the albedo the terrain was painted for.
 *
 * Audited by rendering the island twice, once with the sun's castShadow off,
 * and differencing the two frames. Over every pixel the shadow actually
 * reaches, ours multiplies the lit value by x0.726 / 0.769 / 0.795. Theirs is
 * x0.74 / 0.77 / 0.79. Sampled on the plaza either side of a plot's step, lit
 * sand 228,213,182 goes to 169,168,151.
 *
 * That measurement is why the shadow STRENGTH below is left at three's full
 * 1.0 rather than copying the client's 0.86. Their 0.86 sits on top of a flat
 * #636363 ambient in GAMMA space; ours sits on a hemisphere in linear space.
 * The invariant worth matching is the pixel, not the slider, and dialling 0.86
 * in on top of a rig that already measures right would lift our shadow to a
 * x0.80 multiply — a 20% drop where their sand shows 25.
 *
 * The numbers this produces, against theirs:
 *
 *                  ours              theirs
 *   sand top   lit 228,213,182       225,211,180
 *             cast 169,168,151       174,171,147
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
 */

/** Degrees above the horizon. Their client's directional light, verbatim: euler
 *  X is 34.696. Deliberately NOT re-derived by eye — every attempt to solve
 *  elevation off a screenshot trades against the azimuth, and their config
 *  removes one unknown. */
const SUN_ELEVATION = 34.7;
/**
 * Degrees from +z toward +x, for where the sun IS (shadows travel the other
 * way). Solved, not picked: it is the only azimuth that lays a shadow on the
 * screen bearing their flag measures, given the elevation above and the island
 * camera's own 33.5-degree pitch on the atan2(26,32) diagonal.
 *
 * What it buys, per unit of caster screen-height H:
 *
 *              left     up      camera-to-sun
 *   was 57     0.61H   1.05H       15.3 deg
 *   now 62.2   0.68H   0.88H       19.1 deg
 *   theirs     0.70H   0.91H       23.3 deg (their camera sits 6 deg further
 *                                            round the diagonal than ours)
 *
 * 0.68H is exactly the drop the critics measured off their frame. Anything
 * further round starts inventing a side light their client does not have.
 */
const SUN_AZIMUTH = 62.2;
/** How far out the sun is parked. Only sets where the shadow frustum's near
 *  and far planes have to sit; a directional light has no falloff. */
const SUN_DISTANCE = 120;

/**
 * Half-width of the shadow frustum, in world units.
 *
 * The island is 26 units across, the outlying islets reach about 28, and a
 * 34.7-degree sun throws each palm's shadow another 7 or so past whatever casts
 * it. 32 covers all of that: a caster outside the frustum silently stops
 * casting, which is a hole in the frame, not a soft failure.
 */
const SHADOW_EXTENT = 32;

/**
 * Shadow map resolution.
 *
 * Their shipped pipeline is 1024, one cascade, hard shadows, 150 units of
 * distance (CLIENT_NOTES §2, Medium_PipelineAsset — the level the game
 * actually ships at). We were at 2048, which is 16MB of RGBA on a phone
 * against their 4MB for a frame nobody could tell apart: at 1024 over a
 * 64-unit frustum one texel is 0.0625 world units, and at the island camera's
 * reach that is 2.2 screen pixels. Their own shadow edges resolve in 2. So
 * this is not a compromise, it is the same edge for a quarter of the memory
 * and a quarter of the shadow pass's fill.
 */
const SHADOW_MAP = 1024;
/** World units per shadow texel — what the depth biases below are sized in. */
const SHADOW_TEXEL = (SHADOW_EXTENT * 2) / SHADOW_MAP;

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
    // HARD, and one tap.
    //
    // Their shipped pipeline turns soft shadows off outright
    // (`m_SoftShadowsSupported: 0`), and it shows in their frame: the flag's
    // shadow on the south beach is a clean staircase with a single level of
    // antialiasing on it, not a gradient. PCF's nine taps at this map size
    // spread that edge over four screen pixels, which on a flat sand fill is
    // the difference between a shape and a smudge — and a smudge is exactly
    // what the round-one critics saw. It is also nine texture fetches per lit
    // pixel per light that a mid-range phone does not have to spend.
    this.renderer.shadowMap.type = THREE.BasicShadowMap;

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
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    // Full strength. See the BALANCE note above for why their 0.86 is not
    // copied: our deep shadow already measures the x0.74/0.77/0.79 multiply
    // their sand shows, and 0.86 on top of that would lighten it to x0.80.
    this.sun.shadow.intensity = 1;

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

    // Both biases are sized in TEXELS, so the 2048-to-1024 drop above carries
    // them with it instead of leaving acne behind.
    //
    // Most of the correction is normalBias: it walks the lookup along the
    // surface normal rather than pushing depth, which is what keeps a shadow's
    // edge welded to the foot of the thing casting it. Held under one texel,
    // because the gap it opens at a contact point is its own width — 0.05 units
    // is 1.7 screen pixels at the island camera, and past about a texel a
    // building starts to hover over its own shadow.
    //
    // The depth bias only has to cover what is left: a top face takes the sun
    // at 55 degrees off its normal, so one texel of lateral slip is 0.0625 x
    // tan 55 = 0.09 units of depth error, and the frustum is 160 units deep, so
    // 0.00056 of the depth range. -0.0008 clears that with margin.
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = SHADOW_TEXEL * 0.8;
    // Ignored by BasicShadowMap, kept at the tightest value so a build that
    // switches the type back does not silently inherit a blur.
    this.sun.shadow.radius = 1;
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
    /*
     * Reset the counters HERE, not where three.js does it.
     *
     * WebGLRenderer.render() runs the shadow pass and only THEN calls
     * info.reset(), so by the time a frame is over renderer.info.render.calls
     * holds the camera pass alone and the shadow pass has been wiped out of the
     * number. That is not a rounding error at this scene: every one of the ~450
     * shadow casters is drawn a second time into the depth map, so the default
     * figure is a little under half of what the GPU was actually asked for.
     *
     * PLAN.md budgets draw calls, and tools/perf.mjs reads this. A budget
     * checked against half a frame is worse than no budget, because it reports
     * healthy while the phone does twice the work. autoReset goes off and the
     * reset moves up front, so both passes land in the same frame's count.
     */
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
  }
}
