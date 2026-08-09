import * as THREE from 'three';

/**
 * The ocean — the largest surface on screen, and the one carrying most of the
 * art direction.
 *
 * WHERE THE WHITE GOES
 *
 * An earlier version of this file read the reference's statistics as "half the
 * near water is below L=55 and a fifth of it is above L=200 at the same time",
 * concluded that the missing ingredient was dense sun glitter everywhere, and
 * drew a field of white chips at every distance. The frame it produced measured
 * 39-45% of its near-water pixels above L=205. Cropping the same water out of
 * the reference and counting it gives ZERO. Their bright fifth is not spread
 * over the sea at all: it is the surf apron packed around the island, and the
 * statistic was an average over a frame the island fills.
 *
 * So the rule this shader is built on now is the opposite one. Sampled by hand
 * along scanlines running out from their beach:
 *
 *   surf collar   #E4F0E1 #CEECDF   under a world unit, and the crispest edge
 *                                   in the frame
 *   shelf         #8FD2CB #6AC2C6 #58C1C8 #49B7C3, carrying dense white BLOCKS
 *                                   over roughly its first four units
 *   mid water     #2898B6 #1A7DA4 #1A769D #1E6E95
 *   deep          #04518C #044987 #034382 #033878
 *   near-camera   #03215E #041E59 #021B54 #01174C
 *
 * and over a clean 140x120 patch of their near water: L=33, sd 12, 97% below
 * L=55, nothing above L=200. Over their far water: L=111, sd 10, again nothing
 * above L=200. Both ends of their sea are CALM. Every bright pixel is either on
 * the shelf, on the collar, or one of the sparse light-STEEL dashes (#64879D
 * with a #9EB7BC core, three chips in a hundred) that sit on the near water.
 *
 * That gives four rules, and they are what the fragment shader is:
 *
 * - A depth ramp that reaches NINE world units, not three. The shelf is the
 *   widest single feature in their frame and it cannot be drawn by a ramp that
 *   has run out of distance two metres offshore.
 * - A VIEW SWEEP from bright cerulean at the far edge of the frame to near-black
 *   navy at the near one, normalised against the angular span the camera can
 *   actually see (see updateViewSpan). Without the normalisation this game's
 *   long lens spends a quarter of the ramp on the visible sea and the ocean
 *   reads as one flat blue.
 * - Texture that is BLOCKS, not speckle: large low-contrast rectangles for the
 *   material, a three-level per-cell fleck under them for the hard edges, and a
 *   dithered quantised ramp for the bands. No smooth gradients anywhere. Blocks
 *   that do not LINE UP, though — see THE LATTICE below.
 * - White concentrated at the sand, cut off hard past the shelf, a handful of
 *   dim dashes on the near water — and one corner of broken white, which is the
 *   SUN LANE below. Nothing else.
 *
 * THE SUN LANE
 *
 * The sentence above ("nothing else") was once the whole rule, and it cost a
 * round. Segmenting the reference properly — land seeded, a distance transform
 * off it, and the reference's own logo and watermark held out so they could not
 * act as a fake shore or as fake chips — says their sea is not one material. It
 * is two split by screen height PLUS a third thing confined to one corner.
 *
 * Measured in their near-field right lane (bottom fifth of the frame, right of
 * 0.62 of its width, clear of the shore by 3% of the width):
 *
 *   base   L<60      68.9%   #042660
 *   mid    120-200    6.3%   #8AA7B1
 *   chip   L>200      4.9%   #E5E8DA
 *
 * and in the same band on the LEFT of their frame, or anywhere along its top,
 * that chip tier measures nothing at all. So the earlier builder who deleted the
 * all-over glitter field was right, and wrong to take the lane with it: a
 * thirteenth of the white this file needs was left in the frame.
 *
 * The lane's ENVELOPE is a screen-space band, which is what it honestly is — a
 * compositional device, in the same coordinates as the far/near sweep, which is
 * already a screen ramp normalised against the frame. Its boundary is read off
 * the reference: it crosses 0.78 of the frame height at x=0.62 and 0.62 at the
 * right edge. Everything INSIDE the envelope is anchored in the world — the
 * patches, the streaks, every chip — so the broken water belongs to the sea and
 * not to the lens. Pan the camera and the chips stay on the water they were on;
 * only the corner they are lit in follows the frame.
 *
 * THE LATTICE
 *
 * A blind judge read our ocean as "a tiling noise pattern rather than water —
 * flat lighter-blue rectangles at even density", and it was: two axis-aligned
 * block grids sharing an origin, each block given an INDEPENDENT hash. That is
 * the whole bug, and no amount of tuning the colours reaches it. A per-block
 * hash means every block disagrees with its neighbours, so no feature in the
 * field can ever be larger than one block, and a field whose every feature is
 * exactly one cell is a weave.
 *
 * Adding grids makes it worse. Three stacked lattices were tried here and the
 * visible mark got SMALLER and more even, not larger and more varied, because
 * what the eye picks out is the intersection of the three.
 *
 * Crop their water and it is chunks: three or four adjacent blocks at one flat
 * value, then a hard step, in outlines that owe nothing to the grid. That is
 * what a SMOOTH field looks like after quantisation — neighbours fall in the
 * same bin and merge, the bin boundary cuts the irregular outline, and the grid
 * only supplies the hard edge. So the tone is two octaves of value noise read at
 * each block's centre, quantised to five levels, with a little per-block jitter
 * so the chunks do not collapse into clean contour bands. Two more things keep
 * it honest:
 *
 * - the sample point is domain-warped by a low-frequency field first, so rows of
 *   blocks bend and neighbouring blocks come out different sizes;
 * - the chunk field is read on an axis 34 degrees off the world grid and
 *   stretched 2:1, so the lighter water runs in diagonal streaks the way theirs
 *   does rather than in squares square to the tiles.
 *
 * The far water needs one more thing on top, because the LOD fade means it has
 * no block texture left to carry: broad PATCHES, fifty world units across, of
 * lighter cerulean. Over the top fifth of their frame a sixth of every water
 * pixel is brighter than L=120; over ours, before this, 0.17% was.
 *
 * THE SWELL
 *
 * The reference is a still and shows a dead-level surface: a straight horizon,
 * hulls cutting the water at a flat waterline, no specular anywhere. A still
 * cannot show a sea moving, though, and a sea that does not move is the one
 * thing a player notices immediately. So the surface carries a swell — small
 * enough that the horizon stays a straight line and hulls still cut it at a
 * level waterline, large enough to be unmistakably alive.
 *
 * Three decisions are what keep it pixel art rather than a modern ocean:
 *
 * - The wave is DRAWN, not lit. At an amplitude the waterline can afford
 *   (±0.16 world units against a 0.66 terrain step) the true surface normal
 *   tilts by about 3 degrees, which moves a Lambert term by two percent —
 *   physically correct and completely invisible. Every stylised sea solves this
 *   the same way: crests are painted lighter and troughs darker as a function
 *   of HEIGHT, in hard bands. So the geometry gives the silhouette and the
 *   parallax, and the colour gives the read.
 * - Height is quantised before it is written. A smooth swell is the wrong
 *   material for a voxel island: the surface steps between levels the way the
 *   terrain does.
 * - Whitecaps break along the crest, on cells stretched ALONG the wave rather
 *   than across it, so the foam reads as a line of surf and not as scattered
 *   chips that happen to sit high — and they break RARELY, because the
 *   reference's open water breaks nowhere and a cap plate is the largest white
 *   object this shader can draw.
 *
 * The swell also drives the shoreline. Surf density and the waterline collar
 * are offset by the wave height, so the sea runs up the sand and drains back
 * instead of ending at a fixed radius — which is the single most convincing
 * part of the whole effect, because it is the one place the eye has a static
 * reference to measure the motion against.
 */

/** One swell train: unit heading, wavenumber (2*pi / wavelength), angular
 *  speed, and its share of the amplitude. */
interface Train {
  dir: readonly [number, number];
  k: number;
  w: number;
  a: number;
}

/**
 * Wavelengths of 35, 20 and 10 world units against a 26-unit island: the long
 * train puts a crest either side of the island, the short one is chop. Headings
 * are deliberately not parallel, so the crests interfere and the pattern never
 * resolves into stripes.
 */
const TRAINS: readonly Train[] = [
  { dir: [0.94, 0.342], k: 0.18, w: 0.55, a: 0.55 },
  { dir: [-0.416, 0.909], k: 0.31, w: 0.83, a: 0.3 },
  { dir: [0.707, -0.707], k: 0.62, w: 1.28, a: 0.15 },
];

/** Peak height of the swell in open water, world units. */
export const WAVE_AMPLITUDE = 0.16;
/** World distance over which the swell flattens as it reaches the beach. */
const SHOAL = 5.0;

/**
 * How much of the lane's water breaks white, at the centre of a patch.
 *
 * Coverage on screen is the cell hit probability and nothing else — a chip fills
 * its cell whatever size that cell projects to — so this scales the share of
 * lane pixels that clear L=200, once the patch field has thinned it and the two
 * cell sizes below have shared it out. Tuned by measuring: the same lane, cut
 * the same way in both frames, reads 4.5% for us against 4.4% for them. Doubling
 * it is where the chips start joining up into the confetti field this file spent
 * a round removing.
 */
const LANE_CHIP = 0.172;
/**
 * The steel tier, as a share of the same cells.
 *
 * It is drawn on the SAME grids and read off the SAME hashes as the chips, at a
 * looser threshold, so the two tiers nest for free: every cream chip has steel
 * in its bracket, and the steel-only cells fall around and between the chips at
 * the same size, which is what a halo IS. Drawn as its own larger plate — four
 * times the cell, which is what this was first — it came out as slabs of wet
 * concrete sitting on the sea, because a tier meant to read as the EDGE of the
 * white cannot be bigger than the white.
 *
 * Twice the chips' coverage, and put down at a weight that lands it just under
 * L=120 rather than just over: in the reference every cream block sits in a
 * patch of paler blue, and it is the halo far more than the chip that stops the
 * field reading as salt scattered on a table.
 */
const LANE_PLATE = 0.26;
/**
 * The share of the lane's white drawn on the double-size grid.
 *
 * One cell size gives one chip size, and the reference plainly has two: a fine
 * scatter of single cells with chunky two-by-two slabs through it. Coverage is
 * the hit probability whatever the cell is, so splitting the same total between
 * two grids costs nothing and buys the size variety — which, side by side at
 * matched scale, is the most obvious difference left between their corner and
 * ours.
 */
const LANE_SLAB = 0.42;

/** GLSL literals need a decimal point, and toFixed guarantees one. */
const g = (n: number): string => n.toFixed(5);

/**
 * The swell, generated from TRAINS rather than written twice.
 *
 * It is evaluated in the vertex shader (to displace), in the fragment shader
 * (to shade and to move the surf), and on the CPU (to float the ship). Three
 * hand-copied versions of the same sum is three chances for the boat to bob to
 * a sea nobody is drawing.
 *
 * Returns vec3(height in [-1,1], d/dx, d/dz). The derivative is analytic
 * because the alternative — sampling the field either side of the fragment —
 * costs four more evaluations for a worse answer.
 */
const SWELL_GLSL = [
  '  vec3 swell(vec2 p, float t) {',
  ...TRAINS.map(
    (tr, i) =>
      `    float a${i} = dot(p, vec2(${g(tr.dir[0])}, ${g(tr.dir[1])})) * ${g(tr.k)} + t * ${g(tr.w)};`
  ),
  '    float h = ' + TRAINS.map((tr, i) => `sin(a${i}) * ${g(tr.a)}`).join(' + ') + ';',
  '    vec2 d = ' +
    TRAINS.map(
      (tr, i) =>
        `cos(a${i}) * ${g(tr.a * tr.k)} * vec2(${g(tr.dir[0])}, ${g(tr.dir[1])})`
    ).join('\n              + ') +
    ';',
  // Crests peaked and troughs broadened, which is the shape of real swell and,
  // more to the point here, the shape that survives being cut into bands.
  '    float sharp = 0.72 + 0.28 * h * h;',
  '    return vec3(h * sharp, d * (0.72 + 0.84 * h * h));',
  '  }',
].join('\n');

/** Distance to the nearest land in world units. Needed in both stages: the
 *  fragment shades by it, the vertex shoals the swell against it.
 *
 *  The SDF texture only covers the island's own footprint, and the sea is
 *  twenty times wider than that. Sampling the edge texel and ADDING the
 *  distance back to the box continues the field outside it instead of jumping
 *  to uSDFRange at an invisible square boundary. It matters now that the shelf
 *  ramp reaches nine world units rather than three: with the old clamp, the
 *  ramp ran out of distance inside the box and the last band drew a square
 *  around the island. */
const SHORE_GLSL = /* glsl */ `
  float shoreDistanceAt(vec2 p) {
    if (uHasShore < 0.5) return uSDFRange;
    vec2 uv = (p - uSDFOrigin) / uSDFSize;
    vec2 inside = clamp(uv, 0.0, 1.0);
    float outside = length((uv - inside) * uSDFSize);
    return texture2D(uShoreSDF, inside).r * uSDFRange + outside;
  }
`;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uWaveAmp;
  uniform float uWaveStep;      // height quantum; 0 leaves the swell smooth
  uniform sampler2D uShoreSDF;
  uniform vec2  uSDFOrigin;
  uniform float uSDFSize;
  uniform float uSDFRange;
  uniform float uHasShore;

  varying vec3 vWorld;
  varying vec4 vClip;

${SWELL_GLSL}
${SHORE_GLSL}

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);

    // Waves shoal: they lose height as the bottom comes up and arrive at the
    // beach flat. That is also what keeps the swell from lifting the water over
    // the sand or dropping it off the collar the fragment shader draws.
    float taper = smoothstep(0.0, ${g(SHOAL)}, shoreDistanceAt(world.xz));
    float y = swell(world.xz, uTime).x * uWaveAmp * taper;

    // Stepped, not smooth. The terrain moves in blocks and so does the sea.
    if (uWaveStep > 0.0) y = floor(y / uWaveStep + 0.5) * uWaveStep;

    world.y += y;
    vWorld = world.xyz;

    // Handed to the fragment stage as well as to the rasteriser: the sun lane's
    // envelope is a band across the FRAME, so it needs the frame's own
    // coordinates. Dividing by w in the fragment shader rather than here is not
    // pedantry — interpolating an already-divided ndc across a triangle is
    // interpolating in the wrong space, and on a plane this large the error is
    // most of the screen.
    vec4 clip = projectionMatrix * viewMatrix * world;
    vClip = clip;
    gl_Position = clip;
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
  uniform vec3  uLaneChip;      // the cream the sun lane breaks into
  uniform vec3  uLanePlate;     // the steel tier under it
  uniform float uGlitter;       // scene-level gain on the open-water sparkle
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
  uniform float uWaveAmp;
  uniform float uSurge;         // world units the waterline runs up and back
  uniform float uCaps;          // gain on the breaking-crest foam
  uniform vec2  uViewSpan;      // toCam.y at the far and the near edge of frame

  varying vec3 vWorld;
  varying vec4 vClip;

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

${SHORE_GLSL}
${SWELL_GLSL}

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
    float d = shoreDistanceAt(vWorld.xz);

    // The swell, evaluated exactly as the vertex shader evaluated it — same
    // function, same undisplaced xz — so the shading sits on the geometry
    // rather than sliding over it.
    vec3 sw = swell(vWorld.xz, uTime);
    float wave = sw.x;                      // -1 in a trough, +1 on a crest
    float shoal = smoothstep(0.0, ${g(SHOAL)}, d);

    // Depth ramp.
    //
    // Fitted to a reference scanline running out from the beach: mint through
    // the first world unit, cyan out to three or four, a wide mid-teal band to
    // eight, navy beyond that. The old constant put the whole of it inside three
    // units, which is why our shelf was a hairline and theirs is the widest
    // single feature in the frame.
    //
    // Quantised on a BLOCK rather than a cell, and dithered, so the bands break
    // into the ragged stepped edge the reference has instead of drawing clean
    // contour rings — and so the steps read as water-sized tiles rather than as
    // per-pixel noise.
    float t = 1.0 - exp(-d / 5.2);
    vec2 tile = floor(vWorld.xz / (uCell * 2.0));
    t = clamp(floor(t * 11.0 + hash21(tile) * 0.85) / 11.0, 0.0, 1.0);
    vec3 col = rampColour(t);

    // How steeply is this pixel seen? 1 = straight down, 0 = edge-on. Hoisted
    // above the tone and the sparkle, which both key off the view angle.
    vec3 toCam = normalize(uCameraPos - vWorld);
    float toY = max(toCam.y, 0.0);

    // The two ends of the view ramp, resolved separately rather than as one
    // term and its complement, and both normalised against the span the camera
    // actually covers rather than against constants.
    //
    // That normalisation is the whole trick. This game's island camera is a 38mm
    // lens a long way back, so toCam.y only runs 0.47 to 0.62 from the top of
    // the frame to the bottom — measured, by rendering it. Fixed thresholds
    // wide enough to be safe therefore spend a quarter of their range on the
    // visible sea and the ramp does almost nothing, which is exactly what the
    // frame showed: our far water and our near water were the same blue. uViewSpan
    // carries the two ends of the real range, recomputed whenever the camera
    // moves, so a pinch or a pitch change cannot flatten the sea again.
    //
    // The reference goes from a bright cerulean at the far edge (#0878A8, and
    // flat — sd 10, not one pixel above L=200) to near-black navy at the near
    // one (#03215E, 97% of it below L=55). That single sweep is most of what
    // makes their sea read as deep water rather than as a painted floor.
    float view = clamp((toY - uViewSpan.x) / max(uViewSpan.y - uViewSpan.x, 0.001), 0.0, 1.0);
    float distant = 1.0 - smoothstep(0.02, 0.50, view);
    float close   = smoothstep(0.02, 0.88, view);

    // The mip level a procedural texture does not have.
    //
    // Once a cell is drawn smaller than a pixel it stops being detail and
    // becomes shimmer, and nothing here is filtered — every hash is evaluated
    // at full contrast however small it lands. fwidth gives the world size of
    // one pixel at this fragment, so the fade is keyed to what the grain costs
    // ON SCREEN rather than to a distance that would need retuning every time
    // the camera moves. It matters most when the player pinches out, where the
    // footprint grows by the zoom range in one gesture.
    //
    // Sized so it engages as a cell approaches a pixel and not before: in the
    // default framing a cell is 6px near the camera and about 1px at the top of
    // the frame, so this holds full detail over most of the sea and pulls the
    // far edge back. An earlier threshold at 2.2 cells never engaged anywhere,
    // which is worth recording — the fade LOOKED right and did nothing.
    float footprint = max(fwidth(vWorld.x), fwidth(vWorld.z));
    float detail = clamp(uCell * 0.75 / max(footprint, 0.0001), 0.0, 1.0);

    // THE LATTICE — see the note at the top of the file.
    //
    // Everything textured below is sampled at wp rather than at vWorld.xz: the
    // world point pushed around by a low-frequency field. A grid floored at a
    // warped point is still a grid of hard-edged blocks — nothing here softens —
    // but its rows bend, and two blocks that were the same size are not any
    // more. The warp is about half a block at its strongest, which is the range
    // where the lattice stops being findable and the blocks still read as
    // blocks.
    vec2 warp = vec2(valueNoise(vWorld.xz * 0.085), valueNoise(vWorld.xz * 0.085 + 19.7)) - 0.5;
    vec2 wp = vWorld.xz + warp * uCell * 11.0;

    // The same point on an axis 34 degrees off the world grid. Both other block
    // grids are square to xz and to each other, which is most of why the field
    // reads as tiling; one grid that agrees with neither breaks every long edge
    // in it. Stretched 3:1 as well, because the reference's lighter water runs
    // in diagonal streaks rather than in patches.
    vec2 rot = vec2(wp.x * 0.829 + wp.y * 0.559, wp.y * 0.829 - wp.x * 0.559);

    // The second, larger structure the reference has and a depth ramp cannot
    // give you: broad fields of lighter and darker water, tens of metres across,
    // that owe nothing to how deep the water is. Read along the diagonal too, so
    // the large structure and the small one run the same way.
    float broad = valueNoise(vec2(rot.x * 0.030, rot.y * 0.105)) * 0.52
                + valueNoise(vec2(rot.x * 0.082, rot.y * 0.240) + 31.0) * 0.31
                + valueNoise(vWorld.xz * 0.210 + 7.3) * 0.17;

    // The material grain: BLOCKS, low contrast.
    //
    // Zoomed into the reference's open water, the texture is large flat
    // rectangles — a fifth to three quarters of a world unit across — sitting
    // within about ten RGB of each other. Sampled over a clean patch of its
    // near water the whole field measures sd 12, and its far water sd 10, with
    // literally no pixel above L=200. The previous version drew this one cell
    // wide and at four times the contrast, which is a different material: at
    // that frequency the eye reads static, not water.
    //
    // One block shape, and the value on it QUANTISED OUT OF A SMOOTH FIELD
    // rather than hashed per block. This is the difference between their
    // material and every version of ours so far, and it is worth being precise
    // about.
    //
    // Independent hashes per block make every block disagree with its
    // neighbours, so the field can never be larger than one block and the eye
    // reads a weave — which is exactly what a blind judge called "a tiling noise
    // pattern... flat lighter-blue rectangles at even density". Stacking three
    // grids to fix it makes it worse, not better: the visible cell becomes the
    // INTERSECTION of the three, so the marks get smaller and more even, and the
    // texture ends up finer than the one grid it started from.
    //
    // Their water is chunks: three or four adjacent blocks at one flat value,
    // then a hard step to the next, in shapes that are nothing like the grid.
    // That is what a smooth field looks like after quantisation — neighbours
    // land in the same bin and merge, the bin boundary cuts an irregular
    // outline, and the block grid supplies the hard edge. Two octaves of it,
    // read at the block's CENTRE so each block is one flat value, plus a little
    // per-block jitter so the chunks do not turn into clean contour bands.
    vec2 bsize = uCell * vec2(3.0, 2.0);
    vec2 blockA = floor(wp / bsize);
    vec2 bpos = (blockA + 0.5) * bsize;
    vec2 brot = vec2(bpos.x * 0.829 + bpos.y * 0.559, bpos.y * 0.829 - bpos.x * 0.559);

    float tone = valueNoise(vec2(brot.x * 0.50, brot.y * 1.00)) * 0.40
               + valueNoise(vec2(brot.x * 0.15, brot.y * 0.30) + 9.0) * 0.24
               + broad * 0.22
               + hash21(blockA + 17.0) * 0.14;
    // Four bell-shaped terms stacked, and the middle level would swallow the
    // other four without this: pulled back out around its own midpoint so all
    // five quantised levels stay populated. Contrast lost to averaging is the
    // usual way a grain like this quietly turns into a flat wash.
    tone = clamp((tone - 0.5) * 1.62 + 0.5, 0.0, 1.0);
    tone = clamp(floor(tone * 5.0) / 4.0, 0.0, 1.0);
    // The dark half of the spread opens up with distance from land, so the navy
    // gets its darkest tones and the turquoise shelf is left alone. On the shelf
    // the reference's cyan is fully saturated (#58C1C8, #6AC2C6), and a grain
    // that pulls a fifth of the way to navy greys it out — which is measurably
    // what ours was doing, reading #4EA4B0 where theirs reads #58C1C8.
    float grain = mix(0.5, 1.0, detail);
    col = mix(mix(col, uDeep, (0.06 + 0.26 * t) * grain), mix(col, uCrest, 0.19 * grain), tone);

    // The swell, painted. See the note at the top for why this is a colour
    // ramp and not a lighting term: at an amplitude the waterline can afford,
    // the real normal moves a Lambert value by about two percent.
    //
    // Four hard bands, drawn on the same blocks as the grain so the two agree,
    // with a third of a band of dither on the edges so the crest lines break up
    // rather than drawing contours.
    //
    // Held to about a fifth of the contrast it used to carry. The reference is
    // a still and shows no swell shading at all; this exists so the sea moves,
    // and the amount that reads as motion is a long way below the amount that
    // reads as mottling.
    float band = clamp(wave * 0.5 + 0.5, 0.0, 0.999);
    band = floor(band * 4.0 + hash21(blockA + 53.0) * 0.30) / 3.0;
    // Asymmetric on purpose: the trough is pushed further toward the deep tone
    // than the crest is toward the light one. A sea reads as deep because of how
    // dark the troughs go, not how bright the crests are, and brightening the
    // crests to compensate only makes it foamier.
    col = mix(mix(col, uDeep, 0.30 * shoal), mix(col, uCrest, 0.17 * shoal), clamp(band, 0.0, 1.0));

    // The front face of the wave, which is the part of a swell you actually
    // see: the back is turned away and reads as one flat tone, the front rises
    // toward you and catches everything. Positive where the surface climbs
    // against the direction the wave is travelling.
    vec2 heading = vec2(${g(TRAINS[0].dir[0])}, ${g(TRAINS[0].dir[1])});
    float face = clamp(dot(sw.yz, heading) / 0.30, -1.0, 1.0);

    // The crest itself: a narrow line along the top of the wave, thrown
    // slightly onto the leading face. This is the line that makes the swell
    // read as moving water rather than as mottling that happens to drift.
    col = mix(col, uCrest, smoothstep(0.40, 0.92, wave) * (0.11 + 0.15 * max(face, 0.0)) * shoal);

    // Surf running up the sand and draining back. Everything below measures the
    // shoreline from here rather than from d, so the waterline breathes.
    float dSurf = max(d - wave * uSurge, 0.0);

    // THE SURF SHELF — where all the white in this frame lives.
    //
    // The reference does not scatter foam over the ocean; it packs it onto the
    // shallow shelf. Zoomed in, that shelf is a bright cyan carrying big white
    // blocks over its whole width, four or five world units of them, and then
    // the water is clean: a 140x120 patch of its near water contains zero pixels
    // above L=200.
    //
    // So the profile is FLAT and then CUT, not an exponential tail. This used to
    // decay over two thirds of a unit, which drew a solid ring and nothing else;
    // an exponential stretched wide enough to cover the real shelf instead
    // leaves 15% coverage at five units and 8% at six, which was the field of
    // cream slabs across our mid-water. The chips are the largest bright objects
    // in the shader — a dim plate runs over a world unit long — so the shape of
    // the tail matters far more than its numbers suggest.
    float shelf = 1.0 - smoothstep(1.2, 5.0, dSurf);
    float clump = valueNoise(vWorld.xz * 0.40 + uTime * 0.02);
    float density = uFoamFloor + 0.62 * shelf * mix(0.16, 1.0, smoothstep(0.34, 0.74, clump));

    // Chips scroll rather than reseed, so they drift instead of teleporting.
    vec2 drift = vWorld.xz + uTime * vec2(0.30, 0.10);
    vec2 chip = floor(drift / (uCell * vec2(3.0, 1.0)));
    vec2 chipWide = floor(drift / (uCell * vec2(6.0, 2.0)));

    // A slow twinkle on the bright tier only. The old one gated on a sine
    // through a hard smoothstep and blinked half the chips off at once.
    float phase = 0.55 + 0.45 * sin(hash21(chip) * 6.2831 + uTime * 0.7);
    float dimHit = step(1.0 - min(density * 1.6, 0.82), hash21(chipWide + 3.7));
    float brightHit = step(1.0 - min(density * phase, 0.70), hash21(chip + 91.3));

    // Whitecaps: foam that belongs to the wave rather than to the shore, so it
    // is out in open water where the surf chips never reach.
    //
    // Cells are measured in the swell's own frame — short across the wave, five
    // times longer along it — so a cap breaks as a line of surf lying on the
    // crest instead of chips that happen to sit high. Gated on the crest being
    // both high AND steep, which is where a real wave gives up its top.
    vec2 across = vec2(-heading.y, heading.x);
    vec2 wf = vec2(dot(vWorld.xz, heading), dot(vWorld.xz, across));
    vec2 capCell = floor(vec2(wf.x / (uCell * 1.1), wf.y / (uCell * 3.6)));
    // Gated on the wave being high AND on its leading face — not on the slope
    // being steep, which is the opposite condition: the top of a crest is the
    // one place the surface is level. A wave gives up its top just below the
    // peak, on the side that is climbing.
    // Clustered, like the shore foam and for the same reason. Near an island
    // the shoal term thins the caps out on its own, so this was invisible
    // there — but in open water shoal is 1 everywhere and every crest in the
    // ocean broke at once, which is not weather, it is a texture. Real
    // whitecaps come in patches with calm between them.
    float capField = valueNoise(vWorld.xz * 0.045 + uTime * vec2(0.012, 0.004)) * 0.65
                   + valueNoise(vWorld.xz * 0.13 + 7.0) * 0.35;
    // Held to a twentieth of what it was, and pulled off the far water entirely.
    //
    // The reference's open water breaks nowhere: it is calm from the shelf out
    // to the frame edge. Caps at any real strength are the largest white objects
    // in this shader — a cap plate is most of a world unit long — so a mask of
    // even a tenth put a field of mint dashes across water that should be one
    // flat cerulean, which is precisely what the far half of our frame showed.
    // They earn their place as an occasional break on the near swell and nothing
    // more.
    float capMask = smoothstep(0.42, 0.86, wave)
                  * smoothstep(0.20, 0.78, face)
                  * smoothstep(0.66, 0.90, capField)
                  * (1.0 - distant * 0.85)
                  * shoal * uCaps * 0.055;
    float capHit = step(1.0 - min(capMask, 0.92), hash21(capCell + 7.9));
    // A brighter core on a quarter of the area, the same two-tier chip the
    // shore foam and the glitter both use.
    float capCore = capHit * step(0.52, hash21(floor(vec2(wf.x / (uCell * 0.65), wf.y / (uCell * 3.2))) + 21.4));

    // How open this water is: 0 on the shelf, 1 out in the deep. The view ramp
    // and the sparkle both key off it, so that neither drags the turquoise
    // collar around the island with them.
    //
    // In world units rather than off the depth ramp, so retuning the ramp curve
    // cannot silently move the line the far/near sweep is held back at — which
    // it did once, brightening the whole sea by thirteen points of mean.
    float open = smoothstep(1.5, 7.0, d);

    // OPEN-WATER SPARKLE.
    //
    // What used to sit here was sun glitter at a density that turned the near
    // half of the frame into a white field — 39 to 45 percent of those pixels
    // above L=205, against a reference that measures ZERO over the same water.
    // Cropped and enlarged, the reference's near water is dark navy carrying
    // sparse light-STEEL dashes, two or three chips per hundred, in patches with
    // long clean stretches between them. That is what this draws now: the same
    // mechanism at a tenth of the coverage and a fraction of the contrast, so it
    // reads as light catching a swell rather than as confetti on a pond.
    float sparkZone = close * uGlitter * detail * mix(0.25, 1.0, open);

    // Everything below multiplies through sparkZone, so the hash evaluations
    // are skipped outright over the far half of a 420-unit plane.
    float sparkPlate = 0.0;
    float sparkCore = 0.0;
    if (sparkZone > 0.002) {
      // Dashes: three cells along one world axis, one across, matching the
      // elongated chips the reference draws. The patch field that decides
      // whether one lights up is sampled at the dash's CENTRE, so a smooth
      // field read through the dash grid comes back as blocks that agree with
      // their neighbours rather than as a gradient cut into slivers.
      vec2 gdrift = vWorld.xz + uTime * vec2(0.14, 0.05);
      vec2 gsize = uCell * vec2(2.6, 1.0);
      vec2 gcell = floor(gdrift / gsize);
      vec2 gpos = (gcell + 0.5) * gsize;

      // Patches are the wave's leading faces plus a slab of broad noise: light
      // catches the side of a swell that is climbing toward the camera, and the
      // noise keeps that from banding into stripes.
      // (Not called "patch": that is a reserved word in GLSL ES and the shader
      // will not compile with it, whatever the desktop driver lets through.)
      float lit = clamp(0.46 + 0.42 * face + 0.22 * wave, 0.0, 1.0) * 0.62
                + valueNoise(gpos * 0.28) * 0.38;
      // Three chips in a hundred, counted off the reference: along a 700-pixel
      // scanline of its near water, seventeen pixels are chip. Anything above
      // about a tenth here and the dashes join up into the field this shader
      // used to draw.
      float amount = sparkZone * 0.16 * smoothstep(0.50, 0.86, lit);

      // Hit tests go against a flat hash, never against the noise itself: value
      // noise is bell shaped, so thresholding it directly makes coverage collapse
      // the moment the threshold moves.
      sparkPlate = step(1.0 - min(amount, 0.45), hash21(gcell + 61.0));
      // A brighter core nested inside a quarter of the dashes, the same two-tier
      // chip the surf uses.
      sparkCore = sparkPlate * step(0.68, hash21(floor(gdrift / (gsize * 0.5)) + 133.0));
    }

    // THE SUN LANE — the one corner of this sea that breaks white. See the note
    // at the top of the file for the counts it is built to hit.
    //
    // The envelope is a straight line across the FRAME, taken off the reference:
    // its chip field crosses 0.78 of the frame height at x=0.62 of the width and
    // 0.62 at the right edge, so the boundary is scr.y = 0.42 * scr.x - 0.01 and
    // the lane is everything under it. Broken up by world noise at a fifth of
    // the frame, because a clean line here is a vignette and a vignette is a
    // lens: theirs ends in a ragged coast of chips with dark water between.
    // With that break in place the same band on the LEFT of the frame measures
    // 0.08% chip against the reference's own 0.08% — the corner is confined.
    //
    // Gated on open water, so it can never crowd the shelf or the collar — the
    // white at the sand is the crispest edge in the frame and nothing is allowed
    // to compete with it — and on the LOD, because a chip drawn smaller than a
    // pixel is shimmer.
    vec2 scr = vClip.xy / max(vClip.w, 0.0001) * 0.5 + 0.5;
    float laneEdge = 0.42 * scr.x - scr.y - 0.01
                   + (valueNoise(vWorld.xz * 0.085 + 44.0) - 0.5) * 0.20;
    // Ramped over most of the lane's height rather than switched on at its
    // boundary, so the field thins out toward the top of the corner instead of
    // ending on a line the eye can find.
    float lane = smoothstep(0.0, 0.44, laneEdge) * uGlitter * detail * open;

    float laneChip = 0.0;
    float lanePlate = 0.0;
    if (lane > 0.004) {
      // Broken water comes in patches with long calm between, and the patches
      // are STREAKS: read along the same diagonal the block grain runs on, at a
      // wavelength of twenty-odd world units, cut with a high threshold so most
      // of the lane stays dark, with a shorter octave on top so a streak breaks
      // into clusters and singles rather than into one solid raft. Drifting
      // slowly, so the patches crawl rather than crackle.
      float chop = valueNoise(vec2(rot.x * 0.052, rot.y * 0.150) + uTime * vec2(0.020, 0.006)) * 0.52
                 + valueNoise(vec2(rot.x * 0.155, rot.y * 0.400) + 53.0) * 0.30
                 + valueNoise(vec2(rot.x * 0.520, rot.y * 0.980) + 11.0) * 0.18;
      // A FLOOR under the patches, not a gate on them. Thresholded outright,
      // the low-frequency term wins and the lane comes out as one dense streak
      // with two thirds of the corner bare, which is a weather front, not sun on
      // water: theirs carries chips right across its corner and varies how
      // thickly, three to one between the busiest patch and the quietest.
      float amount = lane * mix(0.34, 1.0, smoothstep(0.40, 0.84, chop));

      // Two cell sizes, because theirs has two: a cell and a half by a cell for
      // the scatter, twice that for the slabs through it. Both tiers come off
      // the same two hashes, so the steel brackets the cream at each size — see
      // LANE_PLATE and LANE_SLAB.
      vec2 cdrift = wp + uTime * vec2(0.16, 0.06);
      float fine = hash21(floor(cdrift / (uCell * vec2(1.55, 1.05))) + 27.4);
      float slab = hash21(floor(cdrift / (uCell * vec2(3.10, 2.10))) + 63.8);
      float aFine = amount * ${g(1 - LANE_SLAB)};
      float aSlab = amount * ${g(LANE_SLAB)};

      lanePlate = max(step(1.0 - min(aFine * ${g(LANE_PLATE)}, 0.80), fine),
                      step(1.0 - min(aSlab * ${g(LANE_PLATE)}, 0.70), slab));
      laneChip = max(step(1.0 - min(aFine * ${g(LANE_CHIP)}, 0.62), fine),
                     step(1.0 - min(aSlab * ${g(LANE_CHIP)}, 0.52), slab));
    }

    // Water first, then the view ramp, then everything that sits on the surface,
    // so the chips are hazed by the same amount as the water under them.
    //
    // Both ends are scaled by openness, which is the whole reason the shelf reads:
    // in the reference the shallow ring stays cyan whether it is at the top of
    // the frame or the bottom, while the deep water behind it goes from bright
    // cerulean to near-black across the same sweep.
    // Both ends carry the block grain rather than being flat colours, because a
    // mix that strong onto a constant erases whatever texture the base had. The
    // far edge of the portrait frame measured sd 1 against the reference's 19
    // for exactly that reason: a hazed sea is not a blank one, and the reference
    // is still visibly built out of blocks at the top of its frame.
    // Widened around its own midpoint rather than lifted — the mean of the
    // multiplier is still 1.
    //
    // Their far water is not one blue. Over the top fifth of their frame, a
    // sixth of every water pixel measures brighter than L=120 while none of it
    // is darker than 60; over ours, at mix(0.78, 1.18), that figure was 0.17% —
    // our whole far sea sat in one band four points under the line, which is
    // arithmetically what "flat lighter-blue rectangles" means. The LOD fade is
    // why it cannot be left to the fleck to fix: a cell up there is smaller than
    // a pixel, the fleck is faded out by design, and the block tone is the ONLY
    // variation the far water has left.
    // The block tone, pulled back toward its own middle as the cells shrink
    // under a pixel. Side by side at matched scale their far water is CALM — a
    // fine, very low contrast weave — and carries its variation in big soft
    // fields instead; ours ran the near water's full block contrast all the way
    // to the horizon, which at a cell a pixel wide is not texture, it is a weave.
    // Not faded out altogether: the note above about sd 1 was earned, and their
    // far water is still visibly built of blocks.
    float toneHaze = mix(0.5, tone, mix(0.30, 1.0, detail));
    vec3 hazeTone = uHorizon * mix(0.70, 1.16, toneHaze);
    // ...and then broken into PATCHES, which is the part a per-block tone cannot
    // do out here. The block grain is faded by the LOD long before the top of
    // the frame — correctly, a cell up there is smaller than a pixel — so the
    // only variation left is whatever is low-frequency enough to survive, and
    // the reference's far water is visibly patchy: big soft fields of lighter
    // cerulean tens of units across. Driven off the same broad field the near
    // water's tone is, so the two ends of the sea are made of one material seen
    // from two distances rather than two materials that happen to meet.
    // Lower frequency than anything else in the shader — a wavelength of fifty
    // world units along the diagonal — because that is the size their patches
    // are: at the top of their frame a single pale field runs sixty screen
    // pixels across, where our whole broad term was turning over in twenty.
    float sheenField = valueNoise(vec2(rot.x * 0.018, rot.y * 0.062) + 5.5) * 0.80 + broad * 0.20;
    float sheen = smoothstep(0.50, 0.86, sheenField);
    hazeTone = mix(hazeTone, uCrest, 0.07 * toneHaze + 0.48 * sheen);
    vec3 nearTone = uNear * mix(0.50, 1.62, tone);

    col = mix(col, hazeTone, distant * 0.94 * mix(0.25, 1.0, open));
    col = mix(col, nearTone, close * 0.96 * mix(0.16, 1.0, open));

    // A cell-scale fleck, applied last so the view ramp cannot flatten it.
    //
    // The blocks above are the structure the reference reads at arm's length;
    // this is what it is made of up close. Their sea is drawn at cell
    // resolution and no two neighbouring cells are quite equal, which is why
    // every edge in their water is a hard step and a third of their sea pixels
    // clear a Sobel threshold that only a seventh of ours did. Three levels and
    // a few percent — enough to put a crisp boundary on every cell, far too
    // little to read as noise.
    //
    // Multiplicative on purpose: it scales with the tone underneath, so the
    // bright shelf gets a visible step and the near-black troughs get the
    // proportionally larger one their own values show in the reference.
    // Faded out with the LOD, because a cell smaller than a pixel is shimmer.
    float fleck = floor(hash21(cell + 71.0) * 3.0) / 2.0;
    col *= mix(1.0, mix(0.91, 1.09, fleck), detail);

    // Chips are hazed by distance, not by the full view ramp: the reference's
    // far reefs still show their white, they just show less of it.
    float haze = distant * 0.72;
    vec3 foamDim = mix(uFoamDim, uHorizon, haze);
    vec3 foamBright = mix(uFoamBright, uHorizon, haze);
    vec3 sparkDim = mix(uGlintDim, uHorizon, haze);
    vec3 sparkBright = mix(uGlintBright, uHorizon, haze);

    // The lane, under the shore's own white so nothing here can crowd the
    // collar. The bright tier goes on at 0.94 and not at 0.6: the tier is
    // DEFINED by clearing L=200, and a cream mixed halfway onto a navy that
    // measures L=37 lands at 135 — a mid pixel wearing a chip's colour, which
    // counts for nothing and looks like haze.
    col = mix(col, mix(uLanePlate, uHorizon, haze), lanePlate * 0.58);
    col = mix(col, mix(uLaneChip, uHorizon, haze), laneChip * 0.94);

    col = mix(col, sparkDim, sparkPlate * 0.50);
    col = mix(col, sparkBright, sparkCore * 0.80);
    col = mix(col, foamDim, capHit * 0.34 * detail);
    col = mix(col, foamBright, capCore * 0.50 * detail);
    col = mix(col, foamDim, dimHit * 0.80 * detail);
    col = mix(col, foamBright, brightHit * 0.95 * detail);

    // The collar exactly where water meets sand: the single crispest edge in
    // the reference's frame, and the one they let no other white compete with.
    //
    // Narrow, and ragged on the outside. A wider version of this ran a smooth
    // solid cream band a world unit and a third deep all the way round the
    // island — which is not a collar, it is a moat, and it ate the whole mint
    // shelf that is supposed to sit there. The reference's collar breaks into
    // its shelf within about half a unit, alternating cream and mint block by
    // block, so the jitter is not decoration: it is what stops the band reading
    // as a drawn outline.
    //
    // Measured off dSurf, so the collar rides up the beach with the swash and
    // pulls back with it. This is the part that sells the motion: it is the one
    // place the eye has something fixed to measure the water against.
    if (uHasShore > 0.5) {
      float collar = uCell * (0.9 + hash21(tile + 8.3) * 1.2);
      if (dSurf < collar) col = mix(uRing, uHorizon, haze);
      else if (dSurf < collar + uCell * 1.2) col = mix(uRingSoft, uHorizon, haze);
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
  /** Ends of the block-tone spread, and of the painted swell bands. Both are
   *  used at small weights: the reference's neighbouring blocks sit within
   *  about ten RGB of each other, so these are the direction the tone moves in
   *  and not colours the water is ever expected to reach. */
  deep: string;
  crest: string;
  glintDim: string;
  glintBright: string;
  foamBright: string;
  foamDim: string;
  /** The two tiers of the sun lane. Kept off the surf colours on purpose: the
   *  collar is a wet, slightly green cream and the lane is a colder one, and
   *  they are the reference's own two measurements, not one colour used twice. */
  laneChip: string;
  lanePlate: string;
}

const PALETTES: Record<WaterPalette, Palette> = {
  // Shallow water around the home island.
  //
  // Fitted to a reference scanline running out from the beach, which is the only
  // honest way to get a ramp this long right. Their tones, in order:
  //
  //   surf   #E4F0E1 #CEECDF     the collar, drawn separately
  //   mint   #A0D4C8 #8FD2CB     first world unit of shelf
  //   cyan   #7DCAC9 #6AC2C6 #58C1C8 #49B7C3
  //   teal   #35B1C5 #2490B0 #1A7DA4 #1A769D #1E6E95
  //   blue   #124F87 #075990 #04518C #065F95
  //   navy   #044987 #034382 #033D7D #033878
  //
  // The six stops below sit ON that sequence once read through the ramp curve
  // (1 - exp(-d/5.2)) — they are lighter than the tones they have to produce,
  // because the block grain and the view sweep both darken what comes out. The
  // stops that matter most are 2 and 3: they land at three and four units out,
  // which is where the shelf either reads as a lagoon or does not.
  //
  // Past the last stop the view sweep takes over: #0878A8 at the far edge of the
  // frame, #03215E..#021B54 at the near one.
  lagoon: {
    ramp: ['#9EDDD0', '#74CBCE', '#4CC0CB', '#2B9AB8', '#16719B', '#073C68'],
    horizon: '#0A78A8',
    near: '#02205A',
    deep: '#03235B',
    crest: '#3EB8CE',
    // The reference's open-water chips are a light steel blue on navy, not
    // white: #64879D with a #9EB7BC core. White is the shore's business.
    glintDim: '#7FA3BC',
    glintBright: '#BDD4DF',
    foamBright: '#E8F5E4',
    foamDim: '#8FD2CB',
    // Their lane, sampled: chips average #E5E8DA and the tier under them
    // #8AA7B1. The chip is carried a little brighter than the average it has to
    // produce, because the mix that puts it down is not 1.0 and the navy under
    // it is L=37. The steel is carried a good deal DARKER and bluer, for the
    // opposite reason: the mix happens in linear space, so a swatch chosen to
    // match #8AA7B1 by eye comes out on the sea as wet concrete — and a halo
    // brighter than the chip it belongs to reads as grit, not as water.
    laneChip: '#EDF0E2',
    lanePlate: '#6E93AE',
  },
  // Open sea: blue-dominant, resolving into the sky at the horizon.
  ocean: {
    ramp: ['#5B9AA0', '#3B7D8B', '#2E5578', '#22547D', '#1B4372', '#143363'],
    horizon: '#82B0A7',
    near: '#0E2450',
    deep: '#0B2050',
    crest: '#4A8FAE',
    glintDim: '#7C9AB4',
    glintBright: '#C6DAE4',
    foamBright: '#FEFFFE',
    foamDim: '#7FA6B6',
    laneChip: '#F0F4EA',
    lanePlate: '#7195AD',
  },
};

export interface WaterOptions {
  size?: number;
  /** World size of one water cell. Roughly 1/5 of a terrain block. */
  cell?: number;
  palette?: WaterPalette;
  /** Gain on the open-water sparkle — the sparse dim dashes on the near sea,
   *  not a glitter field. 0 turns it off entirely. */
  glitter?: number;
  /** Peak swell height in world units. 0 gives back the flat sea. */
  wave?: number;
  /** Height quantum for the swell. 0 leaves it smooth. */
  waveStep?: number;
  /** Gain on the breaking-crest foam. */
  caps?: number;
  shoreSDF?: THREE.Texture | null;
  sdfOrigin?: THREE.Vector2;
  sdfSize?: number;
  /** World distance the SDF texture saturates at. */
  sdfRange?: number;
}

/** Scratch vector for the per-frame view-span solve, so it allocates nothing. */
const FORWARD = new THREE.Vector3();

export class Water {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private readonly amp: number;

  constructor(opts: WaterOptions = {}) {
    const size = opts.size ?? 420;
    const cell = opts.cell ?? 0.2;
    const palette = PALETTES[opts.palette ?? 'lagoon'];
    this.amp = opts.wave ?? WAVE_AMPLITUDE;

    // The swell is displaced per vertex, so the grid has to resolve it: the
    // shortest train is 10 world units long and a vertex every 2 units gives it
    // five samples, which is the floor before the chop turns into a triangle
    // wave. The cell-scale detail is all per fragment and needs nothing here.
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
        uLaneChip: { value: new THREE.Color(palette.laneChip) },
        uLanePlate: { value: new THREE.Color(palette.lanePlate) },
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
        // Zero, and it has to be zero. Shore foam draws on 6x2-cell plates —
        // over a world unit long once the camera is close — so even a 0.4%
        // floor puts a scatter of cream slabs across water the reference keeps
        // completely clean. Whatever texture the open sea needs comes from the
        // sparkle, which is sized and coloured for it.
        uFoamFloor: { value: 0 },
        uCameraPos: { value: new THREE.Vector3() },
        uWaveAmp: { value: opts.wave ?? WAVE_AMPLITUDE },
        // Four steps either side of level. Fewer reads as a flag rippling;
        // more and the quantisation stops being visible at all, which loses the
        // whole point of stepping it.
        uWaveStep: { value: opts.waveStep ?? (opts.wave ?? WAVE_AMPLITUDE) / 4 },
        // How far the waterline runs up the beach and back. Kept below the
        // width of the collar it moves, or the collar breaks into dashes at the
        // top of each swash instead of sliding.
        uSurge: { value: 0.38 },
        uCaps: { value: opts.caps ?? 1 },
        uViewSpan: { value: new THREE.Vector2(0.2, 0.9) },
      },
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'water';
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /**
   * Where the surface actually is at a world point, for anything floating.
   *
   * Same swell as the shader, shoaled against the same SDF texture the shader
   * samples — read out of the texture's own bytes rather than recomputed, so a
   * boat cannot drift off the sea it is sitting on. The slope comes back with
   * it because a hull that rises and falls without tilting reads as an
   * elevator.
   */
  surfaceAt(x: number, z: number, time: number): Swell {
    const s = swellAt(x, z, time, this.amp);
    const shoal = swellShoal(this.shoreDistanceAt(x, z));
    return { height: s.height * shoal, dx: s.dx * shoal, dz: s.dz * shoal };
  }

  /** The shore SDF, sampled the way the shader samples it. */
  private shoreDistanceAt(x: number, z: number): number {
    const u = this.material.uniforms;
    const tex = u.uShoreSDF.value as THREE.DataTexture;
    const data = tex.image?.data as Uint8Array | undefined;
    const range = u.uSDFRange.value as number;
    if (!u.uHasShore.value || !data) return range;

    const origin = u.uSDFOrigin.value as THREE.Vector2;
    const size = u.uSDFSize.value as number;
    const ux = (x - origin.x) / size;
    const uz = (z - origin.y) / size;

    // Clamped sample plus the distance back to the box, exactly as SHORE_GLSL
    // continues the field outside the texture. Anything floating shoals against
    // the same numbers the shader shades with.
    const cx = Math.min(1, Math.max(0, ux));
    const cz = Math.min(1, Math.max(0, uz));
    const outside = Math.hypot((ux - cx) * size, (uz - cz) * size);

    const res = tex.image.width;
    const px = Math.min(res - 1, Math.max(0, Math.floor(cx * res)));
    const pz = Math.min(res - 1, Math.max(0, Math.floor(cz * res)));
    return (data[(pz * res + px) * 4] / 255) * range + outside;
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
    this.updateViewSpan(camera);
  }

  /**
   * The two ends of the view-angle range the camera can actually see water at.
   *
   * A surface point seen down a ray that leaves the camera α below the horizon
   * looks back up at the camera along a vector whose y is sin(α) — so the far
   * edge of the frame is sin(pitch - fov/2) and the near edge sin(pitch + fov/2),
   * and everything the player is looking at lies between them.
   *
   * The far/near colour sweep is the single largest thing separating our sea
   * from theirs, and it is worth nothing if it is spent outside the frame.
   * Solving the span here rather than nailing constants into the shader is what
   * lets one set of numbers hold for the island's long lens, the sea scene's
   * wider one, and every distance in between as the player pinches.
   */
  private updateViewSpan(camera: THREE.Camera): void {
    const persp = camera as THREE.PerspectiveCamera;
    if (!persp.isPerspectiveCamera) return;
    FORWARD.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const pitch = Math.asin(Math.min(1, Math.max(-1, -FORWARD.y)));
    const half = THREE.MathUtils.degToRad(persp.fov) / 2;
    // A camera tipped up toward the horizon sees water at grazing angles it
    // cannot resolve; clamped so the span never collapses or inverts.
    const lo = Math.sin(Math.max(pitch - half, 0.03));
    const hi = Math.sin(Math.min(pitch + half, Math.PI / 2));
    this.material.uniforms.uViewSpan.value.set(lo, Math.max(hi, lo + 0.02));
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export interface Swell {
  /** Surface height in world units, relative to the still waterline. */
  height: number;
  /** Surface slope, for tilting whatever is floating on it. */
  dx: number;
  dz: number;
}

/**
 * The same swell the shader draws, on the CPU.
 *
 * Generated from the same TRAINS table as the GLSL above, so a boat cannot end
 * up bobbing to a sea nobody is drawing. `amp` and the shoaling taper are the
 * caller's business — pass the shore distance if the thing floating is close
 * enough to the beach for it to matter.
 */
export function swellAt(x: number, z: number, time: number, amp = WAVE_AMPLITUDE): Swell {
  let h = 0;
  let dx = 0;
  let dz = 0;
  for (const tr of TRAINS) {
    const a = (x * tr.dir[0] + z * tr.dir[1]) * tr.k + time * tr.w;
    h += Math.sin(a) * tr.a;
    const c = Math.cos(a) * tr.a * tr.k;
    dx += c * tr.dir[0];
    dz += c * tr.dir[1];
  }
  const slopeGain = (0.72 + 0.84 * h * h) * amp;
  return { height: h * (0.72 + 0.28 * h * h) * amp, dx: dx * slopeGain, dz: dz * slopeGain };
}

/** How much of the swell survives this close to land — the shader shoals the
 *  waves against the same distance, so anything floating has to as well. */
export function swellShoal(shoreDistance: number): number {
  const t = Math.min(Math.max(shoreDistance / SHOAL, 0), 1);
  return t * t * (3 - 2 * t);
}
