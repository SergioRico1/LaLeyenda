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
 *
 * THE SWELL
 *
 * The note above says the surface is provably flat, and against the reference
 * stills it is. A still cannot show a sea moving, though, and a sea that does
 * not move is the one thing a player notices immediately. So the surface now
 * carries a swell — small enough that the horizon stays a straight line and
 * hulls still cut it at a level waterline, large enough to be unmistakably
 * alive.
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
 *   chips that happen to sit high.
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

/** Distance to the nearest land in world units, or uSDFRange where there is
 *  none. Needed in both stages: the fragment shades by it, the vertex shoals
 *  the swell against it. */
const SHORE_GLSL = /* glsl */ `
  float shoreDistanceAt(vec2 p) {
    if (uHasShore < 0.5) return uSDFRange;
    vec2 uv = (p - uSDFOrigin) / uSDFSize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return uSDFRange;
    return texture2D(uShoreSDF, uv).r * uSDFRange;
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
  uniform float uWaveAmp;
  uniform float uSurge;         // world units the waterline runs up and back
  uniform float uCaps;          // gain on the breaking-crest foam

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

    // Depth ramp, quantised with per-cell dither so band edges break into
    // speckle instead of drawing clean contour rings.
    float t = 1.0 - exp(-d / 1.1);
    float dither = hash21(cell) * 0.9;
    t = floor(t * 12.0 + dither) / 12.0;
    vec3 col = rampColour(t);

    // How grazing is this pixel? 0 = looking straight down, 1 = edge-on.
    // Hoisted above the tone and the glitter, which both key off the view angle.
    vec3 toCam = normalize(uCameraPos - vWorld);
    float graze = pow(1.0 - max(toCam.y, 0.0), 2.2);

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

    // The second, larger structure the reference has and a depth ramp cannot
    // give you: broad fields of lighter and darker water, tens of metres across,
    // that owe nothing to how deep the water is. Two octaves is enough — the
    // point is the low frequency, not the detail.
    float broad = valueNoise(vWorld.xz * 0.052) * 0.62
                + valueNoise(vWorld.xz * 0.157 + 31.0) * 0.38;

    // Per-cell tone. The reference's calm water runs #103068 -> #205880 between
    // NEIGHBOURING cells — a quarter of the cell's own value, not a 5% wobble —
    // and it is drawn on two cell shapes at once so the field breaks into
    // elongated streaks rather than a checkerboard. Quantised to six steps,
    // because this is voxel water and a smooth gradient is the wrong material.
    //
    // Left at the contrast it was measured at. It was pulled back once, on the
    // theory that it competed with the swell — and the measurement that seemed
    // to support that had the HUD counted as sea. The two do not compete: this
    // grain is one cell across and the swell is ten to thirty-five units, so
    // they occupy different frequencies. The grain is the material and the
    // swell is the form, and the way to make the form lead is to give the swell
    // more contrast, never to take the material away.
    vec2 streak = floor(vec2(vWorld.x / (uCell * 3.0), vWorld.z / uCell));
    float tone = hash21(cell + 17.0) * 0.52 + hash21(streak + 4.2) * 0.48;
    tone = tone * 0.70 + broad * 0.30;
    tone = clamp(floor(tone * 6.0) / 5.0, 0.0, 1.0);
    // The low end of the spread deepens with distance from land. In the
    // reference the near-shore shelf is cyan (#0070A0) but the open water it sits
    // in is navy (#001858..#102050) — a hue swing the depth ramp cannot cover,
    // because the shore SDF saturates a few metres out and everything beyond it
    // is one colour. Scaling by t puts the navy where the water is deep and
    // leaves the turquoise shelf alone.
    float grain = mix(0.55, 1.0, detail);
    col = mix(mix(col, uDeep, (0.40 + 0.30 * t) * grain), mix(col, uCrest, 0.56 * grain), tone);

    // The swell, painted. See the note at the top for why this is a colour
    // ramp and not a lighting term: at an amplitude the waterline can afford,
    // the real normal moves a Lambert value by about two percent.
    //
    // Four hard bands, because the shape has to survive being read at cell
    // size, and a fifth of a band of dither on the edges so the crest lines
    // break up the way the depth ramp does rather than drawing contours.
    float band = clamp(wave * 0.5 + 0.5, 0.0, 0.999);
    band = floor(band * 4.0 + hash21(cell + 53.0) * 0.28) / 3.0;
    // Asymmetric on purpose: the trough is pushed further toward the deep tone
    // than the crest is toward the light one. The reference's near water spends
    // 40-50% of its pixels below L=55 and almost none of ours did — a sea reads
    // as deep because of how dark the troughs go, not how bright the crests are,
    // and brightening the crests to compensate only makes it foamier.
    col = mix(mix(col, uDeep, 0.76 * shoal), mix(col, uCrest, 0.58 * shoal), clamp(band, 0.0, 1.0));

    // The front face of the wave, which is the part of a swell you actually
    // see: the back is turned away and reads as one flat tone, the front rises
    // toward you and catches everything. Positive where the surface climbs
    // against the direction the wave is travelling.
    vec2 heading = vec2(${g(TRAINS[0].dir[0])}, ${g(TRAINS[0].dir[1])});
    float face = clamp(dot(sw.yz, heading) / 0.30, -1.0, 1.0);

    // The crest itself: a narrow bright line along the top of the wave, thrown
    // slightly onto the leading face. This is the line that makes the swell
    // read as moving water rather than as mottling that happens to drift.
    col = mix(col, uCrest, smoothstep(0.30, 0.85, wave) * (0.30 + 0.34 * max(face, 0.0)) * shoal);

    // Surf running up the sand and draining back. Everything below measures the
    // shoreline from here rather than from d, so the waterline breathes.
    float dSurf = max(d - wave * uSurge, 0.0);

    // Foam. Density decays exponentially from the shoreline, and a low-frequency
    // mask keeps most of the open ocean clear so the chips read as surf clusters.
    float density = uFoamFloor + 0.44 * exp(-dSurf / 0.60);
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

    // Whitecaps: foam that belongs to the wave rather than to the shore, so it
    // is out in open water where the surf chips never reach.
    //
    // Cells are measured in the swell's own frame — short across the wave, five
    // times longer along it — so a cap breaks as a line of surf lying on the
    // crest instead of chips that happen to sit high. Gated on the crest being
    // both high AND steep, which is where a real wave gives up its top.
    vec2 across = vec2(-heading.y, heading.x);
    vec2 wf = vec2(dot(vWorld.xz, heading), dot(vWorld.xz, across));
    vec2 capCell = floor(vec2(wf.x / (uCell * 1.3), wf.y / (uCell * 6.5)));
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
    float capMask = smoothstep(0.24, 0.78, wave)
                  * smoothstep(0.10, 0.70, face)
                  * smoothstep(0.54, 0.82, capField)
                  * shoal * uCaps;
    float capHit = step(1.0 - min(capMask, 0.92), hash21(capCell + 7.9));
    // A brighter core on a quarter of the area, the same two-tier chip the
    // shore foam and the glitter both use.
    float capCore = capHit * step(0.52, hash21(floor(vec2(wf.x / (uCell * 0.65), wf.y / (uCell * 3.2))) + 21.4));

    // Sun glitter — the effect carrying most of the reference's texture, and the
    // one that was missing outright. It is NOT foam: it does not care where the
    // shore is, it lives wherever the surface is seen steeply enough to throw the
    // sun back at the camera, which is why both frames go from sd 20 at the far
    // edge to sd 74 at the near one.
    //
    // Keyed on toCam.y rather than on graze, because graze is squashed by its own
    // exponent into 0.65..0.99 across this camera's frame and would spread the
    // glitter evenly over all of it. toCam.y runs 0.28 at the top of the frame to
    // 0.81 at the bottom, which is the range that actually needs resolving.
    float glintZone = smoothstep(0.24, 0.70, max(toCam.y, 0.0)) * uGlitter * detail;

    // Everything below multiplies through glintZone, so ten hash evaluations are
    // skipped outright once the surface is too grazing to throw any light back.
    // The whole 420-unit plane is drawn, and in an open-sea view most of it is
    // past that angle.
    float dimGlint = 0.0;
    float brightGlint = 0.0;
    if (glintZone > 0.002) {
      // Chips sit on their own elongated grid, and the density that decides
      // whether one lights up is sampled at the chip's CENTRE — so a smooth field
      // read through the chip grid comes back as blocks that agree with their
      // neighbours. Two scales of it: coarse patches saying which stretches of
      // water sparkle at all, and a crest field a few chips wide saying which
      // cells inside a patch catch the light. Without the second one the chips
      // spread evenly and read as static rather than as broken wave crests.
      vec2 gdrift = vWorld.xz + uTime * vec2(0.16, 0.05);
      vec2 gsize = vec2(uCell * 1.9, uCell * 1.05);
      vec2 gcell = floor(gdrift / gsize);
      vec2 gpos = (gcell + 0.5) * gsize;

      // What the glitter is FOR is the surface tilting into the sun, so the
      // patches are the wave's leading faces — that is the whole mechanism, and
      // keying them off drifting noise instead was the reason the chips read as
      // confetti sprinkled over the sea rather than as light on it. A third of
      // broad noise stays in so the lines break up instead of banding.
      // Centred on 0.5 so the SHARE of water that sparkles is what it was
      // measured to be — an earlier version of this line sat at a mean of 0.37,
      // which is below the threshold it feeds and quietly cut the glitter to a
      // third. Structure, not amount: face swings it either way from there.
      float glintPatch = clamp(0.50 + 0.55 * face + 0.20 * wave, 0.0, 1.0) * 0.70
                       + broad * 0.30;
      float crest = valueNoise(gpos * 0.85);
      float glint = glintZone
                  * mix(0.14, 1.22, smoothstep(0.30, 0.64, glintPatch))
                  * mix(0.18, 1.75, smoothstep(0.30, 0.72, crest));

      // Hit tests go against a flat hash, never against the noise itself: value
      // noise is bell shaped, so thresholding it directly makes coverage collapse
      // the moment the threshold moves.
      dimGlint = step(1.0 - min(glint * 0.95, 0.94), hash21(gcell + 61.0));
      // The bright core is nested inside a dim plate, on a grid one quarter the
      // area — a two-tier chip, exactly like the foam.
      vec2 gfine = floor(gdrift / (gsize * 0.5));
      brightGlint = dimGlint * step(0.44, hash21(gfine + 133.0));
    }

    vec3 foamDim = mix(uFoamDim, uHorizon, clamp(graze, 0.0, 0.93));
    vec3 foamBright = mix(uFoamBright, uHorizon, clamp(graze, 0.0, 0.93));
    vec3 glintDim = mix(uGlintDim, uHorizon, clamp(graze, 0.0, 0.93));
    vec3 glintBright = mix(uGlintBright, uHorizon, clamp(graze, 0.0, 0.93));

    // Water first, then the view ramp, then everything that sits on the surface,
    // so the chips are fogged by exactly the same amount as the water is.
    col = mix(col, uHorizon, clamp(graze, 0.0, 0.93));
    // The near-camera darkening had the right shape and not enough of it. The
    // reference's two nearest eighths sit at mean 90-96 with 40-52% of their
    // pixels below L=55; at 0.55 ours sat at mean 123-130 with 0.2% below 55 —
    // a bright blue field with white chips on it instead of a navy one. Scaled
    // by depth, so the turquoise shelf inshore is not dragged down with it.
    col = mix(col, uNear, pow(1.0 - graze, 3.0) * 0.90 * mix(0.30, 1.0, t));

    col = mix(col, glintDim, dimGlint * 0.72);
    col = mix(col, glintBright, brightGlint);
    col = mix(col, foamDim, capHit * 0.55 * detail);
    col = mix(col, foamBright, capCore * 0.80 * detail);
    col = mix(col, foamDim, dimHit * 0.85 * detail);
    col = mix(col, foamBright, brightHit * detail);

    // A solid collar exactly where water meets sand — one cell wide, no dither.
    // Measured off dSurf, so the collar rides up the beach with the swash and
    // pulls back with it. This is the part that sells the motion: it is the one
    // place the eye has something fixed to measure the water against.
    if (uHasShore > 0.5) {
      if (dSurf < uCell) col = mix(uRing, uHorizon, clamp(graze, 0.0, 0.93));
      else if (dSurf < uCell * 1.4) col = mix(uRingSoft, uHorizon, clamp(graze, 0.0, 0.93));
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
    deep: '#001439',
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
        uWaveAmp: { value: opts.wave ?? WAVE_AMPLITUDE },
        // Four steps either side of level. Fewer reads as a flag rippling;
        // more and the quantisation stops being visible at all, which loses the
        // whole point of stepping it.
        uWaveStep: { value: opts.waveStep ?? (opts.wave ?? WAVE_AMPLITUDE) / 4 },
        uSurge: { value: 0.55 },
        uCaps: { value: opts.caps ?? 1 },
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
    if (ux < 0 || ux > 1 || uz < 0 || uz > 1) return range;

    const res = tex.image.width;
    const px = Math.min(res - 1, Math.max(0, Math.floor(ux * res)));
    const pz = Math.min(res - 1, Math.max(0, Math.floor(uz * res)));
    return (data[(pz * res + px) * 4] / 255) * range;
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
