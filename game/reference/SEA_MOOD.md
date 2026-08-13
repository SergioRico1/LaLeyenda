# "In The Same Boat" — what our sea is missing, in three screenshots

The owner sent three frames from *In The Same Boat*, a mobile boat game, on
12 Aug. It is a shipped commercial game, so this is **art reference only** —
look and feel, the same footing as Pirate Nation. No assets, no code, nothing
copied. What follows is what I read in the frames and what I judge transfers.

## What the three frames show

1. **Sailing a channel.** Low camera behind the boat, horizon high in frame.
   Layered headlands receding into mist, each flatter and paler than the last.
   Water is stylised low-poly with chunky white caps and green lily-pad shapes
   floating on it. Palette desaturated blue-grey.
2. **Calm water at a ruin.** The island, its arch and its red trees are
   **mirrored in the water**. Discrete chunky foam puffs cluster around the
   hull. Almost no chop — the calm is the point, and it makes the reflection
   readable.
3. **A storm.** Rain streaks, real chop with the boat pitching, everything
   desaturated to grey, chromatic fringing at the frame edges, and a minimal
   white balance bar with an orange marker at the top of the screen.

## The one big idea: OUR SEA HAS NO WEATHER AND NO DISTANCE

Three frames of the same game look like three different places. Ours looks the
same on every voyage, in every ring, at every moment. That is the gap, and it
is worth more than any single shader fix — including the one round 15 is
currently making.

Two systems carry it, and both are cheap next to what they buy:

**ATMOSPHERIC LAYERING.** Their sea feels vast because distant land fades in
steps: each headland flatter, paler and lower-contrast than the one in front.
We have fog in the sea scene (`0x6fbcd6`) but it is doing one job — hiding the
streaming edge — rather than staging depth. Their horizon is a composition.
Ours is a cut-off. This is the cheapest big win available to the sea, and it is
the thing that makes a flat sea horizon stop reading as a flat plane.

**WEATHER AS A STATE OF THE VOYAGE.** Rain, chop, grey light, and calm as its
opposite. For us this is not only mood — it is the variety the voyage does not
have and a lever the sim already has the shape for:
- The sim is pure and seeded, so weather can be a **function of the cell and
  the voyage clock**, exactly like `siteAt`. Deterministic, testable, free.
- It can carry meaning: a squall on the outer rings raises the stakes the same
  way distance does, and calm near home reads as safety without a tutorial line.
- It gives the store listing a second frame that is not another blue-sky sea.
  The last judge called our fight frame "unshippable as a screenshot"; a storm
  is a *better* screenshot than a calm sea can ever be.

## The smaller ones, ranked by value per hour

- **Reflections on calm water.** Frame 2's mirrored island is the single most
  expensive-looking thing in the three shots and it is only readable because
  the water is calm there. A full planar reflection is too costly for us, but a
  vertical smear of the silhouette, quantised to our bands and confined to low
  swell, would land most of it. Gate it on calm so it never fights the chop.
- **Foam as discrete puffs around the hull**, not only a collar. Ours reads as
  an outline; theirs reads as objects sitting in water being pushed aside.
- **The minimal instrument.** Their storm HUD is one white bar and one orange
  marker. Ours is heavier. Worth holding next to `reference/kingshot/*.jpg`
  when the sea HUD is next touched — the chrome budget on a storm frame should
  go DOWN, not up.

## What must NOT be taken

- **Their camera.** Low, behind the boat, horizon high. It makes their sea
  vast — and it would break ours. Our broadsides fire on arcs the player must
  read and turn against; a near-horizon camera hides exactly the geometry the
  positioning game is about. Our camera is a design decision, not an oversight.
- **Their palette.** Desaturated grey-blue is their direction. Ours is Pirate
  Nation's warm, saturated voxel colour, and the last blind judge specifically
  credited our scheme as "more grown-up, more filmic" than the reference's. Do
  not trade a win for someone else's look.
- **The chromatic fringing and glitch.** That is a stylistic signature of
  theirs. On our hard-stepped voxel water it would read as a rendering fault —
  we have already had one blown bloom mistaken for a bug by a judge.

## Where this goes

Not into round 15 — its sea builder is already inside `seaScene.ts`,
`water.ts` and the sea HUD, and two hands in one file is the collision this
project has spent fifteen rounds avoiding. Round 16, as two pieces:

1. **Weather in the sim** — pure, seeded, a function of cell and voyage clock,
   with the renderer only drawing what the sim decided. Tested headlessly like
   everything else in `src/sim/`.
2. **Depth on the horizon** — staged atmospheric layering so the open sea reads
   as vast rather than as cut off, plus calm-gated reflections if the budget
   allows after measuring.
