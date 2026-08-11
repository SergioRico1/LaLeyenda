# Inkwell's water, and the three ideas worth taking from it

The owner pointed at **siliconjungle/inkwell-webgpu-water** on 11 Aug — a
standalone WebGPU renderer recreating Inkwell 3D's Tethys water: ocean,
shoreline and underwater sand, no engine.

## Licence — checked before anything else

**MIT, Copyright (c) 2026 James Addison**, verified by reading the LICENSE file
directly rather than trusting a summary. So its source **may** be adapted, and
if we adapt any, **the notice travels with it** — the same rule we already
carry for the Pirate Nation client. This is a different position from
`2600th/web-ocean-3d`, which had no licence and `"private": true`, and from
which we may therefore learn techniques but take no code.

## Why a port is the wrong instinct

Almost nothing in it can be lifted wholesale, and the reasons are worth writing
down so nobody spends a round discovering them:

- **Wrong API.** Raw WebGPU with compute shaders. We are Three.js on WebGL, on
  phones. Its FFT pipeline has no home here.
- **Wrong budget.** Three 128² spectral cascades with parallel FFTs plus a 256²
  shallow-water solver (Rusanov fluxes, wet/dry reconstruction) is a frame cost
  we do not have against PLAN.md's hundred-draw-call target.
- **Wrong direction.** It is high-key photoreal-adjacent. We are hard-stepped
  voxel water where a smooth gradient is a *worse* failure than a wrong colour,
  and `water.ts` has four rounds of decisions defending that — one TRAINS table
  feeding vertex shader, fragment shader and CPU mirror; view-depth detail fade;
  hard steps and dither everywhere.

Replacing our swell with a spectral ocean would also break the property that
makes the sea testable: `swellAt()` is mirrored on the CPU so the sim and the
renderer cannot disagree about where a wave is, and a hull rides the same sea
the shader draws.

## The three ideas that DO transfer — and the reframe

Our water has oscillated for five rounds. Round 12 added a caustic web that
fixed the near field and broke the deep; round 13 is reversing it. **That
oscillation is the signature of tuning numbers with no model behind them** —
each fix is a local correction that has no way to know what it costs elsewhere.

Inkwell's value to us is not its code. It is that it names the *models* the
reference frame is obeying, and a model tells you where the bands go:

1. **Cox-Munk sun-glitter.** Glitter is not a texture and not a painted lane:
   it is where the surface's slope distribution can bounce the sun into the
   eye. It concentrates near the sun's reflection and falls away with angle,
   *by itself*. That is why the reference's glitter sits on one region and the
   rest of the sea rests — and why our hand-placed `uLane` has always been a
   hack standing in for a physical fact. This is the single most relevant idea
   for the judge's standing complaint: *"the reference confines its dense
   glitter to the bright turquoise shelf and calms the deep; ours drags
   high-contrast white chip drifts across open navy."*

2. **Beer-Lambert RGB absorption.** The turquoise→navy ramp is not an art
   choice, it is `exp(-depth · absorption)` per channel, with red dying first,
   then green, leaving blue. Our depth ramp's stop positions and colours have
   been eyeballed against a screenshot; deriving them from absorption gives
   band placement a reason, and explains why a shallow shelf reads warm-cyan
   while two units deeper reads navy.

3. **Foam from the displacement Jacobian.** Foam appears where the surface is
   being *compressed or torn* — wave crests, and water piling against a shore.
   Not scattered by noise. This is the exact answer to *"foam is uniform white
   axis-aligned rectangles scattered at random, including out in open water"*:
   ask the swell where it is folding, and put the foam only there.

Fresnel is a fourth, smaller one: grazing angles reflect sky, steep angles show
the depth colour, which is why a horizon band brightens without any painting.

**THE REFRAME, and it is the whole point of this document: take these as the
CONTINUOUS function, then QUANTISE it into our hard bands.** We do not adopt
Inkwell's smoothness — we adopt its *reasons*, and then step them the way this
game steps everything. Physically-grounded band placement, voxel presentation.
That is how the oscillation ends: a builder tuning a band would be moving a
value that means something, instead of hunting a number that happened to look
right in one crop.

## What to do with it

Not a round of its own, and not a rewrite. One pass over `water.ts`'s existing
levers, re-deriving them:

- Replace the painted lane with a Cox-Munk-shaped glitter weight (sun direction
  × slope), quantised to the steps we already use.
- Re-derive the depth ramp's stops from an absorption curve rather than from
  eyeballed screenshot colours, then keep our own palette's hues.
- Gate foam on the swell's own folding rather than on noise, which the TRAINS
  table can already answer analytically.

All three sit inside contracts that must hold: one TRAINS table, the CPU
mirror, hard steps and dither, the OCEAN scene byte-identical unless the round
says otherwise, and lagoon changes via scene-owned defaults.

If any actual Inkwell source is copied in doing this — even a few lines of WGSL
translated to GLSL — say so at the site and carry the MIT notice. Learning the
model from a paper-level description and writing our own is not copying;
transliterating their function is.
