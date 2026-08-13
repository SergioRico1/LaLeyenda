# Production checklist — the whole game

What "finished" means, as conditions that can be checked rather than judged.
`PLAN.md` says what to build, `RETENTION.md` says why anyone comes back, and
this says when to stop. Every line is a command that passes or something a
person can verify on a phone in under a minute.

The bar is **an App Store release**. Not a demo, not a vertical slice: a player
downloads it, is taught it, plays it, spends in it and comes back to it.

Status: `[x]` done and verified · `[~]` partly there, gap named · `[ ]` not started.

---

## 0 · Gates that must stay green

- [x] `npx tsc --noEmit` clean (strict, `noUnusedLocals`)
- [x] `npm test` — 360 cases. Round 15 added 59: `resilience.test.ts` is a new
      file covering a full storage quota, a browser that refuses storage
      outright, a save this build cannot read (truncated, wrong types, missing
      keys, not ours, from a later version), the duplicate write two
      backgrounding handlers make a millisecond apart, and the stylesheet rules
      whose absence is a clipped panel on a device nobody here owns — plus the
      gate's guard on the Recoger Todo cascade bug (§7.1). It is the first
      suite in this build that is not about the sim. (Round 13 added 7: the three
      sources the empty chest tray names and the one it must not, the zone
      warning's new look-ahead over a live fleet, and the pairing of a
      tutorial card's noun with the obstacle its ring is on. Round 12 added
      33: the landing report, the chest tray's honest answers, rushable clear
      jobs, the Diario's explicit claims, the dock-owned skiff, the zone
      warning)
- [x] `npm run test:roundtrip` — island → sea → island driven as a player
- [x] `npm run build` produces a bundle
- [x] `npm run shoot -- island --mobile --act <each act>` — every scripted
      interaction still reaches its feature. `teach` also ASSERTS now: on the
      opening beat, which draws the wide island band and circles nothing, the
      tap resolver must answer with whatever is under the finger. Round 13's
      gate measured 62 of 563 deliberate taps being answered with the palm the
      NEXT beat names, and the act fails on any of them.
- [x] `npm run audit:layers` — every component it can find passes all four
      layers, `.pick-row__go` included (step 503.6, the round-11 rim fix).
      Round 12's gate: 9/9 measured again, same roster as round 11 — builder
      chip, badge, chest slot and timer capsule not on the day-one boot.
      Round 11's gate: 9/9 measured; builder chip, chest slot and timer capsule
      are not on the day-one boot (as before), and `.badge` fell out of the
      measured set because `.first()` lands on a hidden slot badge while the
      visible Diario badge sits beside it — quirk of the roster, not a defect;
      the visible badge is confirmed in the same frame's shot. On a container
      whose browser will not survive 13 sequential boots, run it sliced:
      `npm run audit:layers -- --only <name>`.
      **Slice it with a plain file redirect, never through a pipe.** The tool
      prints its table and then does not exit — it leaves the browser and the
      dev server up — so a slice has to be run under `timeout`, and `timeout`
      kills the node process while its vite CHILD still holds the write end of
      the pipe. `grep` therefore never sees EOF and never flushes, and a slice
      that passed reports nothing at all. Round 13's gate lost four components
      to that before spotting it: `node tools/audit-layers.mjs --only <name>
      > out.log 2>&1` is the form that keeps the result.
      Round 13's gate measured four and confirmed four absences on the day-one
      boot: primary CTA ✓✓✓✓ (step ratio 477.6), nav slot ✓✓✓✓ (282), resource
      pill ✓✓✓✓ (348.1), sheet CTA ✓✓✓✓ (503.6), and builder chip / badge /
      chest slot / timer capsule correctly "not on screen" — the same roster
      round 12 recorded. *Not re-measured this round, on a container that gave
      each slice about four minutes:* readout cell, objective row, picker row
      CTA, close button, confirm button. None is touched by the round's diff.
      The round added no new component either — the Cofres tray is built from
      `.sheet__cta` (measured above), `.sheet__x` and `.slot`, all already rows
      in this roster.
- [x] `npm run audit:sea` — sea texture against the reference, HUD excluded.
      `?hud=0` was ISLAND-ONLY until round 13: the sea scene took the same
      query param and never read it, so `tools/blind.mjs`'s `sea` piece — which
      passes `--hud 0` — had been putting our frame, chrome and all, against a
      shipped still that has none. Identifiable as ours on content alone, no
      metadata needed; the same family of fault as the `--save demo` flag that
      harness silently dropped for nine rounds, and the one its unknown-flag
      error cannot catch, because the flag WAS known — by the other scene.
      Fixed in `seaScene.ts`; `shots/r13g_fight_nohud.png` is the first sea
      capture that actually honours it.
- [ ] `node tools/blind.mjs` — our frame beats the shipped game's, judged blind.
      Round 13's gate measured the two things the round-12 judge named, on the
      blind's OWN framing (`island --save demo --hud 0 --w 1280 --h 720`,
      `shots/r13g_blind_island.png`), against `reference/island_hero.png`:

      **Terraces.** Counted as a judge counts them — down a screen column, how
      many times a lawn ends at a wall and another lawn starts below it, with
      candidates linked across columns so a shrub stem (2-4 columns) cannot
      pose as a riser (tens). Ours: 124 columns cross a wall, 206 walls, 48.4%
      of those columns cross two or more and 17.7% cross three. The reference:
      185 columns, 264 walls, 39.5% and 3.2%. The judge's *"A is a single flat
      plateau"* is no longer true of the pixels — our eyelines are DEEPER than
      the reference's. What still differs is where they sit: our walls are
      185/21/0 by third of the island far→near, the reference's are 58/206/0.
      Both keep the near third a flat plaza on purpose; the reference terraces
      the middle of its frame, where the eye lands, and we terrace the top.
      That is the next composition question, and it is a question about
      placement rather than about relief.

      **The deep.** Splitting the water into quartiles by the blueness of the
      NEIGHBOURHOOD each pixel sits in — so a white chip is scored against the
      water it is on, not against its own colourlessness — the share above
      L=200, deepest quartile to shallowest, runs 2.9% / 7.1% / 11.7% / 7.3%
      for ours against 6.3% / 7.2% / 7.2% / 12.1% for the reference. Our deep
      carries less than half the reference's white and our glitter peaks on the
      shelf. *"The lower third dissolves into noise"* is answered, with a
      little room left on the other side.

---

## 1 · First run: menu, captain, tutorial

Half of this exists now. The router, the captain and two of the four screens
landed in round 5; the tutorial and settings did not, because the container
restarted mid-round and killed the workflow with two builders unstarted.

- [x] **Title / main menu.** Logo carved with the four-layer rule, Jugar (or
      Continuar for a returning player), Ajustes, version. The game's own Water
      runs behind it with a ship, gulls and islets — not a plate.
      *Weak:* the lower third is empty navy with two stray planks floating in it.
- [x] **Captain creation.** Seven slots over the 43 `av_*.glb` parts, live
      swapping, a seeded Sorpréndeme and a rolled name already in the field. The
      avatar renders at the right size because `src/render/avatar.ts` clones
      through `SkeletonUtils` — a plain clone shares the skeleton and comes out
      13× too small, which cost six rounds earlier in this build.
      *Weak:* several swatch thumbnails are too dark to read as what they select.
- [x] A named captain in the save, with a migration proving an older save keeps
      its island, resources and running timers.
- [ ] The captain appears in the world: on the island, and at the helm at sea.
- [x] **Tutorial director.** Pure in `src/sim/tutorial.ts`, step DERIVED from
      the save (quitting mid-beat resumes on the same beat because the island
      still needs it), skippable from beat one. Round 11's gate walked all
      seven beats on the real clock in a real browser: the palm cleared, the
      Aserradero placed, its two minutes waited out, the bubble collected, the
      Diario claimed, the zarpar promise acknowledged. Zero console errors.
      Round 12 made it EIGHT beats and changed the ending: a `muelle` beat has
      the player build the 300-madera dock whose level row carries the free
      skiff, so the zarpar beat now points at a door that is genuinely open —
      the first sail is a session-one beat, not a hall-3 promise. The suite
      plays five seeds through and holds the island half under seven minutes.
      Round 13 made the taught tap LAND. The blind playtest needed 3-16 probe
      taps inside a highlighted circle and twice got a job it had not asked
      for; the tap is now resolved on the glass rather than on the grid, and
      the taught obstacle owns its whole spotlight. Measured by this gate at
      the phone framing: 203 of 203 sample points inside the drawn 72px circle
      start the taught job, the ring sits 0.0px off the obstacle it is about,
      and the first real tap commits it. The suite holds the other half — every
      card that points at an obstacle names THAT obstacle's noun and no other,
      across eight seeds.
- [x] **Settings.** Sonido, vibración, Guardar/Exportar/Importar, the red
      Empezar-de-nuevo row, and the CC0/MIT attributions. The export walked:
      a real .json downloads, and after a reload Continuar resumes the same
      island from it.

## 2 · The island — PLAN.md Fase 1

- [x] Grid island, voxel terrain, sea around it
- [x] Camera: one finger pans, two pinch, clamped
- [x] Build: picker → ghost → green/red cells → confirm
- [x] Economy: four resources, two caps, timers, builder limit, offline catch-up
- [x] Session hooks: bubbles, ¡Lleno!, daily chain, quests, chests. Cofres is
      a DESTINATION as of round 13, not a toast: the nav slot opens a tray
      sheet in every state — four slots as objects, the state in a sentence,
      and one CTA that does the thing `chestTrayHint` named. Walked by this
      gate on three islands (day one, day one under the tutorial's dim, and
      the demo's running unlock): the FIRST tap answers every time, and the
      day-one empty state names the three sources that actually pay — the
      Muelle's Cofre de Bronce every 4h to a stack of two, the daily chain's
      days 4 and 7, and the Cofre de la Corona at 10 coronas. `?tray=1` boots
      with it open so a critic can review it.
- [x] **Island creation.** The seed is the captain's, rolled at creation
      (`isla-<random>` in main.ts since round 5 — this line was stale) and
      kept by save, export and reload; `?seed=` pins it for captures, which is
      why every capture shows the same island while every new player gets
      their own. Verified live by round 12's gate: the walked island's field
      differs from the `la-leyenda` capture island, and survives the reload.
- [ ] Moving a building after it is placed — PLAN.md Fase 1 promises it

## 3 · Open sea — PLAN.md Fase 2

- [x] `sim/sea.ts`: pure deterministic voyage — kinematics, seeded world, mobs,
      broadsides, loot, sinking (27 cases)
- [x] Sea scene streaming sites and mobs from the same `sitesNear` the sim uses
- [x] One-thumb steering; the stick appears under the thumb and reports a world
      direction, not a turn rate — and it can now be SEEN. It had no stylesheet
      at all, so the control was a zero-by-zero div: the owner's phone
      screenshot had no control on it because there was no control on it to
      show. There is a helm sign at rest, a first-voyage coach mark, and the
      stick itself is drawn.
- [x] Automatic broadsides; the player plays positioning
- [x] Cargo lands in the island economy, capped, overflow reported
- [x] Cannon, hit, kill, loot and sinking audible; smoke, flash, hurt veil
- [x] **The Giant Squid boss.** Round 10 gave it the fight (a telegraphed
      strike with a dodge window the stick can steer out of, a dive, two
      phases, the chest of the deep through the same loot path as everything
      else — all sim events, all in the suite) and round 12 gave it the
      presentation: "El Kraken" boss bar with phase pips and health, and the
      zone plate warning a hull below its water. Photographed by this gate at
      the lair (`shots/r12_boss.png`).
- [x] **The zone warning arrives before the water.** Round 12 fired it at the
      crossing and the playtest still reported no warning at all — "hull went
      100->15% before I saw any zone plate". Round 13 asks about the cell one
      step ahead on the current heading as well as the one underneath, which
      buys a whole cell, and the ZONA chip now carries the condition in red for
      as long as the hull is outranked rather than flashing a plate and going
      quiet. Measured over eight seeds at three headings, on the margin between
      the plate and the first hit taken in outranked water: round 12 gave a
      minimum of 0.3s with 11 of 24 runs under two seconds; round 13 gives a
      minimum of 3.6s and a median of 6.1s, none under two. Walked live at full
      throttle from spawn (`shots/r13g_zone_live.png`): plate at 11.7s, the
      ring-3 crossing at 15.0s, first damage at 16.6s, hull whole throughout.
- [~] Harvesting and boarding beats. Wrecks are boarded now — the party rows
      over for `sea.boarding` seconds and the loot only lands if the ship
      holds station, with the wait named on the HUD. Islets and harvest sites
      are still taken by touch, which for a fruit stop reads fine and for a
      quarry is still the placeholder.
- [x] Balance, measured rather than judged. `node tools/voyages.mjs` plays
      fleets of seeded voyages with two models of player and prints survival,
      time to sink, cargo landed and hull on arrival; the headline numbers are
      asserted in the suite, so `npm test` fails if the sea stops being
      playable. Ring 1 returns 100%, ring 3 99%, ring 4 85%, ring 5 48% — a
      curve rather than a drowning. Thirty seconds of open throttle straight out
      used to sink three ships in four; it now sinks one in a hundred.
      *Weak:* at ring 5 a pilot who fights still lands less than one who runs.
- [~] Played end to end by a person, not only by the harness: island → ¡Zarpar!
      → steer → take a site → fight → sail home → land the cargo, in a browser
      with the save cleared, both endings (arrival and sinking). Two things that
      only a playthrough could find are fixed — the compass said EN CASA two and
      a half units before the hold would bank, and taking the first island you
      saw could end the voyage two seconds after leaving. Round 12's gate walked
      the whole COLD path in a driven real browser: title → captain → all eight
      taught beats on the real clock (4.6 min) → ¡Zarpar! in session one → a
      site taken (hold 146) → Volver. The dock card previewed the landing (Oro
      12 · Madera 96, "Sin almacén donde guardarlo": Ron 38), the ledger took
      exactly those numbers (ron stayed 0 with the spill RECORDED in the save's
      landing report, seen=true — which only flips after the island says it),
      the export's ledger matched the live one, and Continuar resumed the same
      island. Zero console errors. The sinking ending is still voyages.mjs's
      only — nobody has drowned on purpose in a browser.
      *Weak:* home is a point on empty water. It has a light over it now, but
      the last thirty units of an approach are still steered on a needle.

## 4 · Island defence — PLAN.md Fase 3

- [ ] Threat meter that fills with wealth, resolved only while playing
- [ ] Defensive buildings on the same grid
- [ ] Undead raid waves through the deterministic sim
- [ ] Cheap repairs — losing costs loot, never progress

## 5 · Meta, economy and the store

- [x] **Shipyard progression.** Skiff → Sloop → Galleon → Frigate → Marauder,
      landed in round 10 and re-hung in round 12: ownership IS a level row —
      the Muelle's single level carries the free skiff (the sea is day one),
      the Astillero's rows 2-5 sell the deep four at 20k → 90k → 220k → 450k
      oro — and the next voyage sails the best hull owned. The suite buys the
      whole ladder through the real flow, and `rated` ties each hull to the
      ring the zone warning defends.
- [x] **Gem store.** RETENTION.md §9's gems with a real purchase surface,
      landed in round 10. **A real release still needs StoreKit.** Built as a
      local ledger with the shelf, prices and confirmation flow real, and the
      payment call stubbed behind one named seam (`creditPack`).
- [x] **Leaderboard.** **This contradicts PLAN.md's offline scope** — a real
      one needs a server. Landed in round 10 over seeded rival captains:
      surface, ranking, leagues and the four-week season are real and
      playable, with the data behind one named seam a backend can replace.
- [ ] Achievements as trophies standing on the island (PLAN.md Fase 4)
- [ ] Seasons (RETENTION.md §8)

## 6 · Every screen, at AAA

Each judged on rendered pixels against `reference/clash/` and
`reference/kingshot/`, never on the source.

- [x] Island HUD
- [x] Build picker, upgrade sheet, build bar
- [x] Chest / reward moment
- [x] Voyage HUD
- [ ] Title and menu
- [ ] Captain creation
- [ ] Settings — export/import ships in the panel now (§1); the AAA judgement
      of the screen itself is still the blind critic's to make
- [ ] Store
- [ ] Leaderboard
- [ ] Season / battle pass
- [ ] Defeat and victory screens

## 7 · Ship quality, independent of features

**Every number in this section is re-derivable in one command.** That is the
whole point of the rewrite: this section recorded 436 draw calls for several
rounds after a round had measured 132, and a stale number in a release
checklist is worse than no number, because it is believed. Nobody should ever
have to trust a figure typed in here by hand again.

| what | command | budget |
|---|---|---|
| draw calls | `npm run perf` | 100 |
| — just the counts, in seconds | `npm run perf:calls` | |
| — where the calls go, by material | `npm run perf:where` | |
| download | `npm run bundle` | 10 MB |
| — plus what a real browser fetches | `npm run bundle:boot` | |
| both | `npm run ship` | |

Re-measured by round 15's GATE at `aa75d7c`, in a clean worktree at that commit
rather than in a working tree carrying the next round's uncommitted edits.
Draw calls are deterministic *for a given tree* — repeated runs return the same
integers — so a number that has moved is a change somebody made, not noise.

**The sea row went stale twice while this section was being written, which is
the whole argument for the section.** It first went in measured at `18e7b1b`,
quoting **217**. The sea builder's `seaScene.ts` landed in the very commit that
published that table and took the sea to **51**. By the time the gate came to
verify, four more commits had taken it to **39**. Nobody was careless: the perf
builder measured a tree that did not yet contain the sea work, and no step in
this workflow compares two builders' trees. Two lessons, both cheap:

- *Run the command, do not read the table.* Every figure here is one command.
- **Measure the tree you are committing.** The gate's first pass measured the
  working tree and got 51, because a round-16 builder's `sim/sea.ts` was sitting
  in it uncommitted, changing what spawns. The number that belongs in a release
  checklist is the one a clean checkout produces.

- [ ] **Draw calls < 100.** Read after a real frame, by a counter wrapped
      around the WebGL context itself: every `drawElements`, `drawArrays` and
      their instanced forms, shadow pass included. It needs no cooperation from
      the scene, which is why the sea can be measured at all — only the island
      publishes `renderer.info` through `window.laLeyenda.stats()`. Where both
      exist they agree exactly: 137 and 137, 1110 and 1110.

      | scene | calls | triangles | over |
      |---|---|---|---|
      | island day one (1 building) | **137** | 94,432 | +37 |
      | island demo (11 buildings) | **1110** | 152,216 | +1010 |
      | sea | **39** | 137,520 | OK |

      Round 11 measured 136 / 1112 / 217. The two island figures have not moved.
      **The sea has: 217 → 39, and it is the first scene in this game ever to
      come in under the budget** — at better than a third of it. Round 15's sea
      builder cut the caster set to the hull alone while re-lighting the water,
      which is recommendation 1 below arriving from a different direction: the
      shadows went because the sun now draws the contact, not because anyone was
      chasing draw calls. The cheapest perf win in this build was a side effect
      of an art decision.

      **Where they go, by layer** (`--parts`, day one / demo):

      | `--parts` | day one | demo |
      |---|---|---|
      | terrain | 8 | 8 |
      | terrain,decor | 55 | 48 |
      | terrain,decor,buildings | 115 | 1088 |
      | everything (+ ship) | **137** | **1110** |

      Terrain is 8 calls and decor is under 50 — both merged and instanced,
      neither is the problem. Buildings are +60 for one and +1040 for eleven,
      about 95 calls a building: each optimised `.glb` still arrives as a mesh
      per material and nothing merges or instances them. The skiff parked at the
      dock costs +22 on its own, a fifth of the whole budget for one prop.

      **And a thing no round has looked at before — the shadow pass is half the
      frame.** Splitting the same frames by bound material:

      | scene | shadow pass | visible geometry |
      |---|---|---|
      | island day one | 66 (48%) | 71 |
      | island demo | 591 (53%) | 519 |
      | sea | 12 (31%) | 27 |

      Day one draws 71 visible calls — *inside* budget — and then draws 66 more
      into the shadow map, and that is what puts it at 137. **The sea was the
      loud one and is now the quiet one**: it used to be 185 casters against 32
      calls of visible geometry, and it is 12 against 27. Every caster is
      re-rendered every frame — `shadowMap.autoUpdate` is never set and three.js
      defaults it to true — so the 173 that went were a per-frame cost, not a
      boot cost.

      **Still recommended** (a big instancing refactor remains out of scope):
      1. *Merge or instance the buildings* — `tools/optimize.mjs` and the model
         loader. **The only route to the demo island's 1110**, and now the whole
         of the problem: with the sea inside budget, buildings are the sole
         reason this box is unticked. **492 of the demo's 1110 calls bind a
         SINGLE material** (`npm run perf:where`) — the models already share it
         and simply arrive as a mesh apiece, which is the easiest kind of merge
         there is. Read the count, not the name in that column: three.js labels
         a row from whichever material supplied its `SHADER_NAME`, and the same
         row came back `Base02-Material` on one tree and `RoofBoard03-Material`
         on the next with every integer identical.
      2. *The skiff's 22.* Small, but it is 22% of the budget for scenery.
      3. *The island's shadow pass*, now that the sea has shown what it is worth:
         66 of day one's 137 and 591 of the demo's 1110.

- [ ] **Initial download < 10 MB** — depends entirely on which download, and
      the honest answer is that we pass one budget and fail the other.

      | class | files | raw | gzip | brotli |
      |---|---|---|---|---|
      | js | 4 | 1177.9 KB | 357.5 KB | 296.2 KB |
      | css | 3 | 124.6 KB | 24.7 KB | 21.0 KB |
      | html | 1 | 1.2 KB | 0.7 KB | 0.5 KB |
      | models | 97 | 12900.9 KB | 2815.9 KB | 2073.0 KB |
      | fonts | 4 | 30.5 KB | 30.6 KB | 30.5 KB |
      | textures | 2 | 83.8 KB | 83.7 KB | 83.8 KB |
      | json | 2 | 17.3 KB | 3.0 KB | 2.3 KB |
      | **TOTAL** | **113** | **14.00 MB** | **3.24 MB** | **2.45 MB** |

      **A web player passes: 3.24 MB gzipped, 2.45 MB brotli, for every byte of
      the game.** Round 12's gate reported 3.05 MB for the same measurement; the
      0.18 MB since has not been attributed to anything in particular.

      **A Capacitor build fails: 14.00 MB raw, 4.00 MB over.** A native shell
      reads files off its own filesystem and negotiates `Content-Encoding` with
      nobody, so the raw column is what an `.ipa` carries, and the raw column is
      the one that has to come down before §7 can be ticked. **Every previous
      round measured only the gzip column, which is why this line has read as
      passing.** The gap between 14.00 and 3.24 is itself the measurement of the
      problem: the models compress by a factor of four and a half, which means
      those bytes are redundancy a general-purpose compressor can see and the
      asset pipeline cannot.

      **What a real browser actually fetches**, recorded off a served build with
      a cold cache per screen:

      | screen | requests | models | raw | gzip |
      |---|---|---|---|---|
      | title | 7 | 1 | 1419.7 KB | 417.4 KB |
      | captain | 48 | 43 | 3643.8 KB | 881.9 KB |
      | island day one | 43 | 36 | 6315.8 KB | 1534.6 KB |
      | island demo | 43 | 36 | 6315.8 KB | 1534.6 KB |
      | sea | 21 | 13 | 3719.8 KB | 955.7 KB |
      | **first session** (union) | **95** | **86** | **10780.5 KB** | **2529.3 KB** |

      Two things fall out of that table. **The island preloads its whole
      library**: day one and the eleven-building demo fetch the identical 36
      models, so a new player downloads ten building models to look at one
      Ayuntamiento — 3350 KB raw, 743 KB gzipped, of buildings they cannot
      build yet. And **the captain screen pulls all 43 `av_*` parts** to dress
      one pirate.

      Three routes down, none of them this round's files. **Neither of the
      first two is enough alone**: deleting every model nothing loads takes
      14.00 MB to 11.15 MB, still 1.15 MB over, so the pipeline change has to
      happen as well.
      1. *`quantize()` + `EXT_meshopt_compression` in `tools/optimize.mjs`.*
         The pipeline runs dedup, weld, join, flatten, resample, sparse and a
         256px webp texture pass — good work, and none of it touches vertex
         precision. **`meshoptimizer` is already in `devDependencies` and
         nothing imports it.** This is the one lever that moves the RAW number,
         because unlike gzip the result stays compressed on disk.
      2. *Delete nine models nothing loads* — **2918.8 KB raw, 579.1 KB gzip,
         20.4% of the whole bundle.** Six are named by no source file at all:
         `mob_jellyfish`, `mob_trilobite`, `mob_sealion`, `mob_anglerfish`,
         `deco_grove`, `bldg_wishingwell` — `seaScene.ts` maps four mob kinds to
         four models and the other four mobs were fetched and never wired.
         Three more are named ONLY in comments, which is how they survived every
         previous sweep: `bldg_foundry` (386 KB — `balance.json`'s own
         `$modelNote` records that the smithy replaced it), `deco_fishpoles`
         (`decor.ts`: *"deliberately NOT in that list"*) and `deco_sandmound`
         (*"these used to be one each"*). `npm run bundle` re-derives both lists
         — once over the source as written and once with comments and `$note`
         fields stripped — so neither can go stale, and it errs safe: an id
         assembled at runtime is listed for a human rather than dropped.
      3. *Load buildings when they unlock*, not at island boot — `islandScene.ts`.

- [ ] **60 fps on a mid-range phone — NOT MEASURED, and it cannot be measured
      here.** This container renders through SwiftShader, a CPU rasteriser. Its
      milliseconds describe a data-centre CPU pretending to be a GPU. No agent
      has run this game on a phone, no agent may write a frame rate into this
      line, and the box stays empty until somebody holds a device.

      What `npm run perf` *can* measure is the half of a frame that is not the
      GPU's, and that half does transfer — upward, because a phone's CPU is
      several times slower than this one:

      - **CPU per frame splits into a fixed cost of about 1-2 ms and about
        5-7 µs per draw call**, fitted by least squares across the three scenes
        above (residuals under 0.9 ms on a 1.3-9.1 ms range). That is the
        arithmetic behind the 100-call budget: draw calls are CPU cost before
        they are GPU cost. The demo island's 1110 calls are ~7 ms of CPU
        *here*, before the GPU has drawn anything.
      - **The sea allocates about 250 KB per frame** (measured 243 / 247 /
        270 KB across three runs); the island day one about 100 KB. At 60 fps
        the sea is making 15 MB of garbage a second, and a phone collects a
        nursery that size in a visible hitch. Flagged as pathological. This is
        one of the few things a CPU rasteriser reports faithfully, because
        allocation is the same JavaScript either way.
      - The absolute millisecond columns are **not** stable on this container —
        the same scene measured 526 ms and 1072 ms a frame in two runs an hour
        apart, because several agents share the machine. The counts are
        deterministic; the milliseconds are not. Read ratios, never absolutes.
- [ ] PWA installable, offline boot verified on a device
- [ ] Capacitor shell, icons, splash, App Store metadata
- [x] **An error a player can hit shows something other than a blank canvas.**
      Walked by round 15's gate in a real browser against the BUILT game in
      `dist/`, served over http, not against the dev server: the radio cut after
      the title had loaded, then Jugar. Before the round that showed nothing at
      all — `show()` had disposed the title, the captain screen's models failed
      to fetch, and the rejection went to `window.__error` and the console. Now
      it shows *"Falta algo por cargar"* over a scrim with **Reintentar** and
      **Volver al título**. Ditto a corrupt save: *"No hemos podido leer tu
      partida"*, the game still boots, and `save:broken` holds the original
      bytes with a Descargar archivo button on the card and a permanent row in
      Ajustes.
- [x] Audio: synthesised bus, island and sea both covered

### 7.1 · The unhappy paths, walked

Round 15's gate drove all seven in a real Chromium against `dist/`. What the
suite asserts is in `tools/tests/resilience.test.ts`; this is what a phone did.

| path | result |
|---|---|
| network cut mid-session, then Jugar | **ok** — the card, with two ways out |
| a corrupt / truncated save | **ok** — told, quarantined, still boots |
| a save from schema 1 (current is 3) | **ok** — 1 → 3, island, resources and seed intact, captain rolled from that seed, no notice |
| a full storage quota | **ok** — announced once, not per retry; recovers when space is freed |
| no durable storage at all | **ok** — plays in memory, and says it will not survive the tab |
| 320x568, 360x640, 390x844, 430x932 + three landscapes | **one real bug, fixed** — see below |
| **first launch with no network** | **BROKEN, and unfixable without a service worker** |

**The tiny-screen walk found a bug that was never about tiny screens.**
`.collect-all` (hud.css) sets `position:absolute`; `.btn`
(`components/button.css`) sets `position:relative`. Same specificity, and
`button.css` is imported later, so `.btn` won — and on a *relative* box
`bottom:159px` means "shift up 159px from where you would sit", not "159px off
the bottom edge". Every sibling in `.hud` is absolute, so the pill's flow
position is the top of the hud and it drew at **y = -159 at every one of the
seven viewports**: §3.9's four-bubble shortcut had never once been tappable.
The rule directly beneath it out-specifies `.btn` for `transform` and documents
exactly this hazard; `position` was the property that got away. Fixed with
`.collect-all.btn{position:absolute}` and guarded by a test that reads the
relationship between the two stylesheets rather than either string.

**First launch offline is the one that cannot be closed here.** There is no
service worker, so the document itself never arrives and the player gets the
browser's error page, not ours. That is the same box as "PWA installable"
above, and it stays open until a shell exists to close it.

## 8 · Known deferred, with the reason

- `unfinished-terrain-lighting.patch` — a background round left it half-wired
- No real multiplayer. PLAN.md's three rules keep the door open; the leaderboard
  above is the first place that door gets used.
