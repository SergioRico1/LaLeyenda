# The opening — day one, the Clash way

Decided by the user on 9 Aug: **the player starts with the Ayuntamiento and
nothing else.** Everything on the island after that, they built.

This document exists because that one sentence changes four other things, and
getting those wrong would leave a game that starts beautifully and is empty by
minute two.

## What Clash actually does, and why it works

Three parts, and they only work together:

1. **The map is large and FIXED from day one.** It does not grow. A new player
   gets the same acreage a veteran has; what changes is how much of it they
   have earned the right to fill.
2. **You start with one building.** The Town Hall. Every other structure on a
   mature base was placed by the player, which is the entire source of the
   ownership Clash trades on.
3. **The empty land is covered in OBSTACLES** — trees, rocks, bushes — that you
   clear for a small resource payout and a short builder timer.

Part 3 is the one everybody forgets, and it is load-bearing. Without it a
Clash base on day one would be a vast green void with a single building in the
middle. The obstacles are what make a large empty map read as *wilderness you
are taming* rather than *content that is missing*. They also hand a brand-new
player something to do in their first thirty seconds that costs nothing and
teaches the builder-and-timer loop before any building is affordable.

## What this settles for us

**The island gets big, once, now.** `reference/SPACING.md` measured that our
eleven buildings need 283 buildable cells and the 26-grid offers 255 — they do
not fit at all. A grid of **44** gives 911 buildable cells, putting footprints
at 31% coverage, which is where the shipped game sits. Fixed from the start,
Clash-style, so no save migration and no plateau that grows under a player's
feet.

The objection to a big island was that day one would look barren. Obstacles
answer it, and answer it better than a small island did — because now the
emptiness is *earned space*, and it fills with the player's own choices instead
of ours.

**`createNewGame` drops from six buildings to one.** Today it seeds
Ayuntamiento, Aserradero, Mercado, Almacén, Banco and Muelle. All but the first
go. The player builds them, and the picker already exists to let them.

## The four things this drags with it

- **§4.10's beat sheet is now wrong.** It choreographs a first session that
  opens on a working economy — a timer already running, a producer already
  full. A player with one building and no income has a different first five
  minutes, and it has to be written before it can be built.
- **The retention test asserts the old opening.** `tools/tests/retention.test.ts`
  plays a greedy 24 hours and checks the player is never stranded. With one
  building and no producers that check becomes far more demanding, and it
  should — if a fresh player CAN strand themselves, that is the bug the test
  exists to catch.
- **The tutorial finally has a job.** Its first instruction is now obvious and
  physical: clear that tree, then place your first Aserradero on the ground it
  freed. RETENTION.md's session loop taught by doing, exactly as intended.
- **Obstacles are a new sim concept.** They occupy cells, they cost a builder
  and a short timer to clear, and they pay a little wood or gold. They belong
  in `src/sim/` with everything else, and the layout stays data — an obstacle
  is a cell property, not a scene object.

## The one thing to be careful about

Obstacles must not become a second decoration system. `src/scenes/decor.ts`
already scatters props for looks, and it has a test keeping them off ground a
building could claim. Obstacles are the opposite: they DO occupy buildable
ground, that is their whole point, and they are removed by the player rather
than by a seed. Two systems, one visual language, and they must not fight over
the same cells.
