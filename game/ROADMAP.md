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
