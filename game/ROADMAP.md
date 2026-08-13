# The road to a release — rounds 8 to 11

`PRODUCTION.md` says when to stop. This says in what ORDER, and why that order
and not another. Written down because this build has already lost a whole
workflow to a container restart, and a plan that lives only in a conversation is
a plan that dies with it.

Every round is: builders on **disjoint files**, then a gate that repairs rather
than reverts, then a **blind critic who never reads code** — it runs the game,
puts our frame against the shipped one unlabelled, and says cold which is
better. Agents commit and push. **Promotion to production is human-driven** —
see the fourth trap in `DEPLOY.md`.

---

## Round 8 · Invert the ground

**The one that unblocks the others.** Round 6's blind judge found it and nobody
had seen it before, including me:

> Ours is a bare sand slab with rectangular green rugs dropped on it. The
> reference is a **grass island with sand paths cut through it** — green is the
> field, sand is the route. And placing a building scrubs grass to sand, so the
> day-one island is greener than the 27-building one. **Playing the game makes
> the island uglier.**

That inversion is why round 4's "the eye lands nowhere" survived a round aimed
squarely at it. Fix the ground and the focal-hierarchy complaint largely fixes
itself; fix the focus without the ground and the hero still stands in a car park.

- Grass becomes the plateau's default surface. Sand is the path network and the
  beach ring, nothing else.
- Placing a building stamps a compacted-dirt pad the size of its footprint plus
  a path stub joining the network — it must not bleach the island.
- Kill the per-pixel grass noise: two greens, a contact-shadow rim where grass
  meets sand, and a visible riser so the lawn has thickness. This is the single
  change that stops us looking cheap at 6×.
- Sea sparkle as a function of depth, not a uniform noise field. Drop every grey
  chip — specular is white or it is absent.

**Settle the contested measurement first.** The judge says the shore is still
three stacked terraces; the terrain builder reports collapsing the ladder to
`[sea, BEACH, PLATEAU]` with zero one-cell spikes verified. Two observers of the
same pixels disagree, and this project has been wrong about a measurement four
separate times. An agent that changes no code resolves it before anyone builds.

## Round 9 · Close the first run

Nothing here was judged and cut — the container restarted and their builders
never started. **Without a tutorial there is no release.**

- **Tutorial director**, pure in `src/sim/`, testable with no browser. Since
  `OPENING.md` its first instruction is finally physical: clear that tree, then
  put your first Aserradero on the ground it freed. Skippable from step one,
  resumable across a quit, and it must never block on a timer a real player
  would simply wait out.
- **Settings.** Save export/import is reachable only from the JS console, which
  cannot ship. Plus audio, haptics, reset, and the asset attributions we owe —
  a wrong licence attribution is a store rejection.
- **The captain in the world**: on the island and at the helm at sea. He exists
  only on his own creation screen today.
- **The island seed becomes the captain's**, rolled or chosen at creation.
  Everyone currently gets the same island.

## Round 10 · The meta, and the reasons to come back

- **Shipyard**: Skiff → Sloop → Galleon → Frigate → Marauder. All five hulls are
  already in `public/assets/models/` and nothing uses them.
- **Gem store.** A real release needs StoreKit. Built here as a local ledger
  with the shelf, the prices and the confirmation flow real, and the payment
  call stubbed behind **one named seam**.
- **Leaderboard.** A real one needs a server, which contradicts PLAN.md's
  offline scope. Built over seeded rival captains so the surface, the ranking
  and the season reset are real and playable, with the fetch behind one named
  seam a backend can replace.
- **The Giant Squid.** Spawned and tethered today with no fight of its own — no
  phases, no tell, no reward moment.
- **Harvesting and boarding.** A site is taken by sailing over it, which is the
  placeholder, not the design.

---

## Round 11 · The last pass — everything at AAA

Not a feature round. Rounds 8 to 10 each judge one piece against one reference;
this one judges **the whole game as one product**, the way a player meets it and
the way a store reviewer will. The bar: somebody downloads it, is taught it,
plays it, spends in it, and comes back tomorrow — and nothing along that path
feels like a prototype.

**1. Every screen re-judged blind, in one sitting.** Judged piece by piece a
screen can pass while the game fails, because consistency is invisible from
inside a single round. One critic sees title, captain, island, build, upgrade,
chest, voyage, store, leaderboard, settings, defeat and victory together, and
answers one question: do these look like one game made by one team?

**2. The whole path, on a cold install.** Title → captain → tutorial → first
build → first timer → first chest → first voyage → cargo landed → store →
leaderboard → quit → come back the next day and get the offline catch-up.
Driven end to end in a real browser, with the save cleared, both endings.

**3. One voice for the copy.** Every Spanish string read in one pass by one
reader. Today they were written a round at a time by different agents; tone
drift is invisible per-screen and obvious end to end.

**4. One mix for the audio.** Every sound in the game levelled against every
other, with the island bed and the sea bed as one score rather than two.

**5. Motion.** Every transition and ease curve. A screen that snaps where its
neighbour glides is the cheapest tell there is.

**6. Ship quality, measured on the numbers PRODUCTION.md §7 already names.**
Draw calls under 100 — the figure recorded there is stale at 436 and round 6
measured 132, so re-measure before optimising. Download under 10 MB. 60 fps on
a real mid-range phone, which needs a real device: SwiftShader cannot answer it
and no agent should claim it has.

**7. The unhappy paths**, which no round has looked at once: offline, a tiny
screen, a slow device, a rotated phone, a save from an older version, a
storage quota that is full, and a first launch with no network at all.

**8. Store submission**: icon, screenshots, description, age rating, privacy
answers, and the attributions. The `dobo-ui` Vector UI Pack may be used and
reworked but **not redistributed**, so `tools/uipack/` and
`public/assets/ui/` stay gitignored; `proofofplay/piratenation-game` is MIT and
its notice travels with anything adapted from it, while the commercial Asset
Store packages bundled inside it are off limits.

**Round 11 is done when a blind critic, shown our frames beside the shipped
game's with no labels, picks ours — and when the whole path above has been
walked by a person on a phone without hitting anything that reads as unfinished.**

---

# Round 16 — the voyage gets an arc and a build, and both are measured

SEA_PLAY.md's diagnosis was that the sea has one verb, no arc, nothing that
compounds and no trade-off. Four systems answer it, and this round landed
three of them plus the surface that makes them legible.

## What shipped

**LA MAREA.** A tide level read off the voyage clock, flat for 40 seconds and
then climbing to full flood over 180. It multiplies what a cell posts, how
tough it is, and how close the sea puts it — and, through `swell`, it puts
creatures on the water near a ship that will not come to it, so the clock
cannot be waited out by stopping.

**THE HOLD HAS WEIGHT.** Cargo takes speed, helm and acceleration, and adds
turn drag. Measured against the same seeds and the same water below.

**PERTRECHOS.** Kills and sites pay into a ladder; at each rung the voyage
stops and offers one of three upgrades that die at the dock. Ten in the pool,
seeded, drawn without repeats, stacking where it makes sense.

**THE TWO CLOCKS, ON SCREEN.** A strip under the readout capsule carrying the
tide as a bar with the sim's own stage ticks, its name (Calma · Creciente ·
Alta · Pleamar) and the countdown to the next one, beside the pertrechos
ladder. Each crossing announces itself once.

## What the harness says — 60 seeded voyages a row, autopilot on the real stick

SEA_PLAY.md set the test itself: *"the tide producing a survival curve that
falls with time at sea, and the weight showing up as a measurable difference
between running home loaded and running home empty."* Both hold, and the
control is the same sea with the clock stopped.

    LA MAREA — the same voyage, staying out longer
    ring · pilot        out   tide  returns  no tide   difference
    1 · novato          60s   0.16     100%     100%        0 pp
    1 · novato         240s   0.95     100%     100%        0 pp
    2 · novato         120s   0.38      62%      82%      −20 pp
    2 · novato         180s   0.51      25%      78%      −53 pp
    3 · veterano       180s   0.29      63%      80%      −17 pp

Ring 1 is untouched at every level, which is the promise `grace` was written
for: a first voyage, and every efficient trip to the near sea, sails the water
the fleet table measured. From ring 2 out, staying is a real decision — three
minutes of loitering turns a four-in-five return into a one-in-four.

    THE WEIGHT — home empty against home full, same seeds, same hull
    ring  hull   empty: home  secs    full: home  secs   cost
    3     100%          100%  23.6          100%  26.6  +3.0s
    4     100%           93%  42.5           83%  47.0  +4.5s
    4      40%           77%  42.0           63%  46.3  +4.3s
    5      40%           25%  64.4           18%  73.5  +9.1s

A full hold is three seconds slower home from ring 3 and nine from ring 5, and
those seconds are paid in hulls: ten points of return at ring 4 and seven at
ring 5. Running home rich is a harder job than running home empty, which is
what makes the last site a question.

    THE LADDER — hunting, day-one skiff
    first choice at 7.3s · second at ~21s · third at ~37s · three picks a run

## What round 16 did NOT do

**Zafarrancho** — SEA_PLAY.md item 4, the one active verb — is not built. The
voyage still has one thing to press and it is the helm. It is the first thing
round 18 should take.

## Round 17 — el sondeo

The owner's own idea and the best decision-per-second the sea can buy;
SEA_PLAY.md §5 has the design and the three properties that make it a game
rather than a timer. It waits for the tide deliberately, because *"looting
raises the tide"* is the sentence that makes it a cost rather than a free wait.

---

# Round 17 — el sondeo, and the two verbs the sea now has

The owner's own idea, 12 Aug: *"al acercarte a una isla vas descubriendo por
tiempo el botín y dices si cogerlo o no, así en ese tiempo tienes la intriga de
si te vienen a atacar."* SEA_PLAY.md §5 is the design; this is what it measured.

## What shipped

**EL SONDEO.** Come inside a site's reach and a survey begins. The haul is
revealed in three tiers — 30% at 1.5s, 65% at 4s, all of it at 8s — and it only
BANKS when the ship breaks off. Bailing is always allowed, so the question is
never "loot or not", it is *"is the next tier worth another few seconds"*, asked
again every few seconds. It replaces both taking a site by touching it and the
wreck-only boarding beat: one mechanic for every prize.

**THE NOISE.** A survey is loud. Every six seconds it puts one creature in the
water at 0.8 of its own sight — inside it, so the thing turns and comes on the
step it arrives and the player has seconds to spend on the answer. At most three
alive at once, counted live, so clearing what came buys the right to be sent
more. The danger is CAUSED by the choice to stay, never rolled while the player
happens to be standing there.

**IT SPENDS THE TIDE.** A second on station ages the tide by two, so looting is
never free even when nothing attacks.

**ZAFARRANCHO**, round 16's missing fourth leg: three seconds of a ship handled
harder than she can be handled for long, on a twelve-second cycle. Speed and
helm up, and turn-drag DOWN — which is what makes it a manoeuvre rather than a
straight-line boost.

## What the harness says — 40 seeded voyages a row, `greed` = tiers held for

`tools/tests/voyages.ts` gained a `greed` dial, because since round 17 "how much
of a site to take" is a strategy rather than a fact, and without it every row
measures the single greediest way to play.

    home% / cargo landed        tier 1        tier 2        tier 3
    ring 3 · novato            100% / 359     98% / 703     75% / 884
    ring 3 · veterano          100% / 418     93% / 644     95% / 839
    ring 4 · novato             50% / 649     33% / 900     10% / 900
    ring 4 · veterano           85% / 578     68% / 757     73% / 553
    ring 5 · novato              8% / 900     23% / 900     10% / 900
    ring 5 · veterano           38% / 434     48% / 616     43% / 523

Ring 3 is the round in one line: the same water, the same seeds, and holding for
the last rung buys two and a half times the cargo for twenty-five points of
return. That is a decision.

## WHAT ROUND 17 CHANGED THAT WAS NOT ASKED FOR, said plainly

**The far sea is no longer a gamble anybody can take.** Before el sondeo a
beginner stripping ring 5 came home 57% of the time; now it is 10%. Eight
seconds on station per prize, six prizes, in water a starter hull is three zones
under-rated for — with the tide making the whole time and the survey calling
things in. A *veteran* still gets home from ring 5 at 38–48%, so it is a gamble
for somebody who can sail rather than a wall, and the tests now say exactly
that. It is the better game, and it is what the zone warning has been saying
since round 12 and what the shipyard exists to sell the answer to.

**A first voyage is no longer at a hard tide of zero.** Two prizes stripped to
the last rung push it to about 0.035. It never leaves SLACK WATER — the stage
the HUD prints and the plate announces is still Calma, with the first named
stage three tenths away — so the promise the player can be told is unchanged.
The promise that a beginner sails the fleet table's sea roll-for-roll is not.

## What round 17 did NOT do

- **No captain at sea, no island defence, no store submission package.** All
  three are still ahead of everything else in this file.
- ~~**The sondeo has no sound of its own** beyond the borrowed cues, and the
  tier bloom is a shock ring rather than a treasure moment.~~ **Done.** A rung
  is now a snap ring and a column of gold off the water, both scaled to how far
  up the ladder it is — the last one is unmistakably the site giving up
  everything, and it kicks the camera. Deliberately NOT the burst `looted`
  uses: nothing is aboard at a rung, so the run of gold toward the ship belongs
  to the bank at the end. Two moments, two pictures. `--act tier` photographs it
  by watching the panel's own pips rather than a clock, so it stays true if the
  ladder is ever retimed.
- **The hold is a manifest now**, not a total: a stacked strip under the numeral
  in the island rail's four colours, shares of the CARGO rather than of the
  hold, so the mix reads at full width on a quarter-full ship — which is when
  the sondeo's question is actually being asked.
