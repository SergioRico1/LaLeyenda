# Inkwell's grass — MIT, excellent, and not for this game

The owner pointed at **siliconjungle/inkwell-webgpu-grass** on 11 Aug, the
companion to the water repo. **MIT, Copyright (c) 2026 James Addison**, read
from the LICENSE file directly. So we *may* use it. We should not, and the
reasons are worth recording so this is decided once.

## What it is

Raw WebGPU. Reconstructs each blade procedurally from a four-byte candidate ID
in WGSL instead of a 64-byte transform, hierarchically culls 16.77M candidates
down to ~234k drawn blades, and renders them at 60 fps in ~9.1 ms of GPU per
pass at 1440×900 **on Apple Metal**. Wind, camera interaction, distance fading,
density profiles, a four-way atlas blend for painted terrain. It is a genuinely
impressive piece of work.

## Why it is the wrong tool here, on three independent counts

**1. It is the opposite of our art direction, and we already removed this by
hand.** Individual blades are exactly what round 11 took OUT. The round-11
blind judge's words: our grass was *"the highest-frequency surface in the whole
frame — diagonal hatch streaks plus a dense sprinkle of near-white speckles
that reads as static and dust at 1:1"*, against a reference whose grass is
*"near-flat colour with a faint noise floor"* that spends its detail on
discrete objects. The fix cut a grass cell from ~28 cover quads to ~11 and
retired the per-cell furrow hash. Adding 234k blades would re-create, at
enormous cost, the precise defect we spent a round deleting.

**2. The budget is not close.** 9.1 ms of GPU per pass on desktop Metal, for
grass alone, against a mobile target of 60 fps for the whole frame — a 16.6 ms
budget that must also carry terrain, buildings, props, water, shadows and UI —
and PLAN.md's hundred-draw-call ceiling. This is not a tuning gap.

**3. The techniques solve problems we do not have.** The four-byte candidate ID
is a memory win at 16.77M candidates; our decor scatter is in the hundreds, so
there is nothing to save. Hierarchical culling at 0.075 ms is impressive at
that scale and pointless at ours. Distance fading and density profiles we
already have, in `decor.ts` and in the water's view-depth fade.

## What the ground actually needs, per the judges

Recorded here because "the owner sent a grass shader" should not become "the
grass is the problem". It is not, and has not been since round 11. The open
items on the ground, from the round-12 and round-13 verdicts:

- **Relief that READS.** The terraces have existed since round 9, had their
  value polarity fixed in round 10, and were measured twice — and the blind
  judge still reports *"a single flat plateau"* against the reference's
  *"stepped cliffs, three elevation plates, a hill"*. Round 13's relief builder
  was briefed to measure before changing anything, for exactly this reason.
- **Discrete objects, not texture.** The reference spends its ground detail on
  bush clumps, flower beds, crop rows planted in lines, post-and-rail fence,
  hedging. Round 11 started this; the judge's *"flower-clumped turf"* and
  *"plot borders"* notes say it is not finished.
- **Plot borders.** *"Every green area in A is bounded by post-and-rail fence
  or hedging — that is what makes the sand read as road and the green read as
  owned plot. B has zero plot boundaries; its green just stops."*

Every one of those is placement and modelling work in `decor.ts` and
`island.ts`. None of them is a shader, and none of them is blades.

## If it is ever revisited

Only under a different art direction, or on a desktop build with a real GPU
budget. Then it is MIT and adaptable, and the notice travels with anything
adapted — the same rule as the water repo and the Pirate Nation client.
