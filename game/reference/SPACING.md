# Spacing — how Pirate Nation lays out a starter island

Measured off two official screenshots the user supplied on 9 Aug: a close-up of
a Pirate Nation island at Nv1 and a wider three-quarter view of the same
starter island. They are better reference than `island_hero.png` for this
question, because they show the island in the state ours is actually in — early,
with few buildings — rather than a dressed hero shot.

The blind judge's round-2 complaint was *"packed wall-to-wall with no negative
space; the right third collapses into an unreadable brown-and-orange mass where
you cannot separate one structure from another."* These screenshots are the
answer to that, and the answer is not "add more props" — it is the opposite.

## What their starter island actually does

**Most of the island is empty.** Eyeballing the wider shot, buildings cover
roughly a quarter to a third of the land. The rest is open sand plaza and bare
grass. Empty ground is not unfinished space in their layout; it is what makes
the built space legible.

**Every building has clearance on all sides.** No two structures touch, and
none shares a silhouette edge with another. The gap between neighbours is on
the order of a building's own width — enough that each reads as a separate
object at a glance, and enough for its cast shadow to land on open ground
rather than on the next roof.

**Grass plots are framed and mostly empty.** Each is a clean rectangle with a
low hedge border, holding at most one feature — a totem, a small crop bed — and
often nothing at all. They are not filled with scatter.

**Palms cluster; they never form a hedge.** Groups of two to four, at corners
and along one or two edges, with long stretches of bare coast between them.
Ours currently welds a continuous palm wall around the entire shore, which is
what eats the visual budget and leaves the interior bare.

**Sand paths do the connecting.** Wide, plain, unbroken bands of sand run
between buildings. They are the negative space, and they are what the eye uses
to separate one structure from the next.

**Props punctuate, they do not fill.** Crates, barrels, a signpost, a few
bollards, a fence run — placed singly along a path edge or beside a door, with
bare ground between them.

## What this means for us

Three changes, and only the first is about art:

1. **Thin the dressing, do not add to it.** Break the coastal palm hedge into
   clusters. Leave grass plots largely empty. Let sand plazas be plain.

2. **Enforce clearance between buildings.** Placement should keep at least one
   empty cell — ideally more — between a new building and its neighbours, so
   nothing ever abuts. This belongs in the placement rules in `src/sim/build.ts`,
   not in the renderer, because it is a rule about the layout and the layout is
   data.

3. **Size the island against what it must hold.** If the grid cannot fit every
   building the Ayuntamiento unlocks WITH that clearance, the island is too
   small and the buildings will crowd no matter how the props are tuned. Count
   the footprints the balance table allows at each hall level, add the clearance,
   and check the plateau has room. Growing the buildable area as the hall levels
   is the Clash answer and fits our progression.

## The trap

Round 2's shadow agent measured our shadowed-sand share at 18.2% against the
reference's 8.3% — we already have more than twice their shadow area. It still
looks worse, because ours lands on palm canopies shadowing other palm canopies.
More stuff will not fix that. Space will.

## The measurement that settles it

Our island physically cannot hold its own catalogue. Measured, not estimated:

| grid | buildable cells | footprints cover |
|---|---|---|
| **26 (current)** | 255 | **111%** |
| 40 | 717 | 39% |
| 44 | 911 | 31% |
| 48 | 1103 | 26% |
| 52 | 1335 | 21% |

The eleven buildings in `balance.json` need **283 cells for their footprints
alone** — before a single path, gap or prop. The island offers 255. They do not
fit even packed edge to edge with zero space between them.

So the crowding was never an art-direction problem, and no amount of thinning
props or re-lighting would have fixed it. Every round that treated it as one was
treating a symptom. **The island is too small for the game we designed.**

To reach the reference's roughly 25–30% coverage the grid wants to be about
**44–48 cells**, against today's 26 — a little under twice the linear size.

Two ways to spend that, and they are not exclusive:

- **Grow the island with the Ayuntamiento.** The Clash answer, and it fits our
  progression: the buildable plateau expands as the hall levels, so a starter
  island stays intimate and legible while the endgame one has room. This is the
  better answer if it can be done without invalidating stored saves.
- **Grow it once, now.** Simpler, and it makes every current frame legible
  immediately. The cost is that a brand-new player sees a lot of empty land.

Either way the placement rule from the section above still applies: buildings
need a clearance gap, and the grid has to be sized to afford it.
