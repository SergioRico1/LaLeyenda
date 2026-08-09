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
 * HEIGHT, and this is the number two rounds kept being told to move. It does
 * not move, and here is the arithmetic that settles it.
 *
 * A shadow's length is not a free parameter — for a caster of world height h it
 * is h/tan(elevation) on the ground, and what reaches the screen depends on the
 * CAMERA as well. Project both through a camera at pitch phi, with the shadow
 * running at a bearing beta off the camera's own azimuth, and a caster H pixels
 * tall on screen throws its tip
 *
 *     sin(beta) / (tan(elevation) * cos(phi))   pixels sideways, and
 *     tan(phi) * cos(beta) / tan(elevation)     pixels up
 *
 * per pixel of H. Two measurements, two unknowns, so a screenshot alone is
 * enough — the old note here was wrong to say elevation could not be solved off
 * one. Feeding their flag's 0.693H left / 0.921H up into that pair, with the
 * 35-degree pitch their own camera prefab states, gives beta 23.35 degrees and
 * an elevation of 34.9 degrees.
 *
 * Their client says 34.696. Two independent sources, 0.2 degrees apart — which
 * is about what one pixel of slop on a 101-pixel gnomon is worth. There is
 * nothing here to correct.
 *
 * The other half of the check is our own frame, and it is the one worth
 * repeating whenever this is questioned again: park a 6-unit pole on a clean
 * slab out over open water, capture, and measure the shadow the same way. Ours
 * lands 0.582H left and 0.898H up. Solved back through the same pair with
 * nothing assumed, that is a camera pitch of 33.5 degrees and a sun elevation
 * of 34.76 — the two numbers this file and islandScene.ts are configured with,
 * recovered from pixels. The rig does exactly what it says.
 *
 * So the length is right and the direction is right, and neither is where the
 * "their shadows are long, ours are not" complaint actually comes from. Per
 * unit of caster height ours reaches 1.07 of H against their 1.15, and the
 * whole of that 7 percent is our camera sitting 1.5 degrees shallower than
 * theirs — a shallower camera foreshortens the ground, which shortens every
 * shadow on it. Lowering the sun to hide a camera difference would put a wrong
 * time of day into the game and break the "+x is lit, +z is shaded" assumption
 * render/island.ts bakes into its wall skins. What was actually wrong was the
 * EDGE; see SHADOW_BILINEAR below.
 *
 * BALANCE. Sampled off their sand: lit #e1d3b4, the same sand under the flag's
 * shadow #aeab93 — the drop is bigger in red than in blue because the warm half
 * of the light is what the shadow loses and the cool sky half is what stays. So
 * the sun is warm and the ambient is cool, and the two are balanced so a lit top
 * face still lands on exactly the albedo the terrain was painted for.
 *
 * Audited by rendering the island twice, once with the sun's castShadow off,
 * and differencing the two frames, over the 14.5k pixels of flat sand the
 * shadow fully covers. Against their own sand either side of the noticeboard's
 * shadow on the south plaza:
 *
 *              red     green   blue    luminance
 *   ours      x0.739  x0.790  x0.830    x0.783
 *   theirs    x0.770  x0.795  x0.799    x0.788
 *
 * The DARKNESS is a bullseye — half a percent of luminance apart, which is
 * inside the noise of picking which sand to sample. (An earlier pass here
 * quoted their multiply as x0.74/0.77/0.79; that was an arithmetic slip on its
 * own quoted hex pair, which divides out to x0.773/0.810/0.817. The two
 * corrected measurements above agree with each other.)
 *
 * What is left is a HUE residual: our shadow keeps 3 percent more blue and 3
 * percent less red than theirs, so it reads a shade cooler. It is deliberately
 * not chased here. The only way to warm a cast shadow without moving the lit
 * frame with it is to add red to the hemisphere and take the same red back out
 * of the sun, and at this ratio that is a 12 percent change to the sun's
 * colour — every roof, wall and sail in the frame, to buy 3 points on one
 * channel of one surface. render/island.ts's albedos are calibrated against
 * this rig; that trade is not worth their recalibration.
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
 *  X is 34.696 — and independently the 34.9 their flag's own shadow solves to,
 *  and the 34.76 a probe pole recovers from our render. Three sources inside a
 *  quarter of a degree; see HEIGHT above before touching this. */
const SUN_ELEVATION = 34.7;
/**
 * Degrees from +z toward +x, for where the sun IS (shadows travel the other
 * way). Solved, not picked: it is the only azimuth that lays a shadow on the
 * screen bearing their flag measures, given the elevation above and the island
 * camera's own 33.5-degree pitch on the atan2(26,32) diagonal.
 *
 * What it buys, per unit of caster screen-height H:
 *
 *              left     up      |tip|    camera-to-sun
 *   was 57     0.61H   1.05H    1.21H       15.3 deg
 *   now 62.2   0.58H   0.90H    1.07H       19.6 deg
 *   theirs     0.69H   0.92H    1.15H       23.3 deg (their camera sits 6 deg
 *                                                     further round the
 *                                                     diagonal than ours)
 *
 * Ours is the measured row, not the predicted one: a probe pole rendered on a
 * clean slab and read off the capture, so it carries the island lens's slight
 * off-axis skew rather than an idealised parallel projection. The old note here
 * quoted 0.68H/0.88H, which is what the ortho arithmetic predicts and about a
 * tenth of H away from what the frame actually draws.
 *
 * The gap in the LEFT column is a camera difference, not a sun one: our bearing
 * off the camera axis is 19.6 degrees where theirs is 23.3, because their rig
 * sits further round the diagonal. Winding this azimuth on to close it would
 * start inventing a side light their client does not have, and would fight the
 * "+x is lit, +z is shaded" skins in render/island.ts. What matters is that the
 * shadow steps clear of its caster, and at 0.58H it does.
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
 * against their 4MB for a frame nobody could tell apart.
 *
 * It is also, to within a few percent, the same TEXEL as theirs on screen, and
 * that is the number that matters for the edge below. Theirs: a 1-cascade URP
 * shadow covers a sphere of shadowDistance/2, so 1024 texels over roughly 150
 * units is 0.146 units a texel; at their scene-start orthoSize of 39 on a
 * 1600-wide capture that is 11.5 pixels a unit, so a texel lands between 1.7
 * screen pixels across the light and 2.9 along it. Ours: 1024 over a 64-unit
 * frustum is 0.0625 units, which at 1280 wide with the island held at their
 * share of the frame measures 2.07 pixels across the light and 2.48 along it.
 * Both scale with their own camera's zoom, so the two track each other as long
 * as the island is framed the size theirs is. Same order, same look — for a
 * quarter of the memory and a quarter of the shadow pass's fill.
 */
const SHADOW_MAP = 1024;
/** World units per shadow texel — what the depth biases below are sized in. */
const SHADOW_TEXEL = (SHADOW_EXTENT * 2) / SHADOW_MAP;

/**
 * THE EDGE. One texel of linear ramp, which is what "hard shadows" means.
 * ======================================================================
 *
 * Measured off reference/island_hero.png, by sampling perpendicular profiles
 * across four separate shadow boundaries on flat sand (the noticeboard's cast
 * on the south plaza at (713,630), (724,640), (736,620), (744,630), and the
 * flag's at (569,726)). Every one of them falls from lit sand to full shadow
 * over 2.0 to 2.5 pixels, through four or five distinct intermediate values —
 * e.g. 175, 182, 190, 202, 210, 214. Not one is a step. The width does not
 * grow with distance from the caster either, near contact or out at the tip,
 * so it is not a penumbra: it is a fixed-width filter on the lookup.
 *
 * That is exactly one shadow texel, and it is what their config already says.
 * `m_SoftShadowsSupported: 0` turns off URP's multi-tap blur; it does NOT turn
 * off the comparison sampler underneath. URP binds its shadow map through a
 * LINEAR compare sampler, and hardware resolves a linear SampleCmp as a 2x2
 * bilinear blend of four depth tests. So a Unity "hard" shadow arrives with one
 * texel of linear ramp on its edge, always. The screenshot and the client
 * config never disagreed at all — the 2-and-a-bit pixels of ramp measured on
 * their frame ARE their 1024 map read through hardware PCF, and the brief's
 * "the screenshot may be a higher tier than the shipped default" turns out not
 * to be needed: shipped Medium produces exactly this.
 *
 * Round two read "hard shadows" as three's BasicShadowMap, which is a single
 * NEAREST depth test: a binary edge with no ramp at all, HARDER than anything
 * Unity can produce. Measured on our own frame it fell 167 to 215 across one
 * pixel — a staircase, quantised to the shadow texel, which at this size is
 * the crawling-jaggy look the critics kept reading as a smudge rather than a
 * shape. Nothing about the darkness or the direction was wrong; the boundary
 * was two levels where theirs has six.
 *
 * So: keep three's cheapest branch selected and replace its body with the 2x2
 * bilinear compare the hardware would have done. Four fetches, not the
 * seventeen of three's PCF path (which would also spread the edge over two
 * texels, twice the reference's) and not the nine of PCF_SOFT (three texels).
 * The interior of the shadow is untouched by construction — only pixels within
 * half a texel of a boundary see a value other than 0 or 1 — so the multiply
 * the BALANCE note above audits cannot move.
 */
const SHADOW_BILINEAR = /* glsl */ `
float texture2DBilinearCompare( sampler2D depths, vec2 size, vec2 uv, float compare ) {
	vec2 texel = 1.0 / size;
	vec2 grid = uv * size - 0.5;
	vec2 base = ( floor( grid ) + 0.5 ) * texel;
	vec2 blend = fract( grid );
	float s00 = texture2DCompare( depths, base, compare );
	float s10 = texture2DCompare( depths, base + vec2( texel.x, 0.0 ), compare );
	float s01 = texture2DCompare( depths, base + vec2( 0.0, texel.y ), compare );
	float s11 = texture2DCompare( depths, base + texel, compare );
	return mix( mix( s00, s10, blend.x ), mix( s01, s11, blend.x ), blend.y );
}
`;

/** Anchors in three's shadow chunk. Both verified unique at r171; if either
 *  stops matching, the caller falls back to three's own PCF rather than
 *  silently shipping the binary edge again. */
const BASIC_TAP = 'shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );';
const GET_SHADOW =
  'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, ' +
  'float shadowBias, float shadowRadius, vec4 shadowCoord ) {';

let shadowFilterInstalled: boolean | null = null;
/**
 * Swaps the single NEAREST depth test in three's unfiltered shadow branch for
 * a 2x2 bilinear one. Returns false if three's source has moved on, so the
 * renderer can pick a filtered type instead of quietly reverting to a step.
 */
function installShadowFilter(): boolean {
  if (shadowFilterInstalled !== null) return shadowFilterInstalled;
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (!chunk.includes(BASIC_TAP) || !chunk.includes(GET_SHADOW)) {
    shadowFilterInstalled = false;
    return false;
  }
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk
    .replace(GET_SHADOW, SHADOW_BILINEAR + GET_SHADOW)
    .replace(
      BASIC_TAP,
      'shadow = texture2DBilinearCompare( shadowMap, shadowMapSize, shadowCoord.xy, shadowCoord.z );'
    );
  shadowFilterInstalled = true;
  return true;
}

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
    // Must happen before the renderer compiles anything.
    const bilinear = installShadowFilter();

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
    // HARD — meaning one texel of ramp, not none. See the SHADOW_BILINEAR note
    // above for the four profiles off their frame that set the width, and for
    // why a Unity "hard" shadow already carries that ramp.
    //
    // BasicShadowMap selects three's cheapest branch, whose body the patch has
    // replaced with the 2x2 compare. If the patch could not find its anchors,
    // PCF is the right fallback: twice the reference's edge width is a far
    // smaller error than the binary step, which reads as aliasing rather than
    // as a shadow at all.
    this.renderer.shadowMap.type = bilinear ? THREE.BasicShadowMap : THREE.PCFShadowMap;

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
    //
    // Both survive the bilinear filter unchanged, and that is worth stating
    // because widening a shadow kernel usually costs bias. It does not here:
    // the four taps sit on the texel centres BRACKETING the sample, so the
    // furthest one is a texel away where the single nearest tap was already
    // half a texel away. Confirmed by capture — no acne appeared on the plaza,
    // the grass plots or any roof, and full shadow still measures the same
    // 169,169,151 on sand it did before the filter changed.
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = SHADOW_TEXEL * 0.8;
    // Unread by the branch above — the 2x2 kernel is exactly one texel by
    // construction, which IS the reference's edge, so there is no width to
    // dial. It only reaches three's own PCF path, which is the fallback if the
    // shader patch cannot find its anchors; 1 is that path's tightest setting.
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
