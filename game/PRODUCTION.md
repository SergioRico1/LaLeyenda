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
- [x] `npm test` — the pure-sim suite, 194 cases
- [x] `npm run test:roundtrip` — island → sea → island driven as a player
- [x] `npm run build` produces a bundle
- [x] `npm run shoot -- island --mobile --act <each act>` — every scripted
      interaction still reaches its feature
- [~] `npm run audit:layers` — 9/10 components clean; `.pick-row__go` has no rim
- [x] `npm run audit:sea` — sea texture against the reference, HUD excluded
- [ ] `node tools/blind.mjs` — our frame beats the shipped game's, judged blind

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
- [ ] **Tutorial director.** RETENTION.md's session loop taught by doing —
      collect, build, start a timer, open a chest, sail. Gated, skippable, and
      it must never block on a timer a real player would simply wait out.
      Since OPENING.md its first instruction is finally physical: clear that
      tree, then place your first Aserradero on the ground it freed.
      **Not started** — its builder never ran.
- [ ] **Settings.** Save export/import is still reachable only from the JS
      console, which cannot ship. **Not started** — its builder never ran.

## 2 · The island — PLAN.md Fase 1

- [x] Grid island, voxel terrain, sea around it
- [x] Camera: one finger pans, two pinch, clamped
- [x] Build: picker → ghost → green/red cells → confirm
- [x] Economy: four resources, two caps, timers, builder limit, offline catch-up
- [x] Session hooks: bubbles, ¡Lleno!, daily chain, quests, chests
- [ ] **Island creation.** Every player currently gets the same seeded island.
      The seed should be the captain's, rolled or chosen at creation.
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
- [ ] **The Giant Squid boss.** Spawned and tethered, but it has no fight of its
      own — no phases, no tell, no reward moment.
- [ ] Harvesting and boarding beats. A site is taken by sailing over it, which
      is the placeholder, not the design.
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
      saw could end the voyage two seconds after leaving.
      *Weak:* home is a point on empty water. It has a light over it now, but
      the last thirty units of an approach are still steered on a needle.

## 4 · Island defence — PLAN.md Fase 3

- [ ] Threat meter that fills with wealth, resolved only while playing
- [ ] Defensive buildings on the same grid
- [ ] Undead raid waves through the deterministic sim
- [ ] Cheap repairs — losing costs loot, never progress

## 5 · Meta, economy and the store

- [ ] **Shipyard progression.** Skiff → Sloop → Galleon → Frigate → Marauder.
      All four hulls are already in `public/assets/models/`; nothing uses them.
- [ ] **Gem store.** RETENTION.md §9's gems with a real purchase surface.
      **A real release needs StoreKit.** Built here as a local ledger with the
      shelf, the prices and the confirmation flow real, and the payment call
      stubbed behind one named seam.
- [ ] **Leaderboard.** **This contradicts PLAN.md's offline scope** — a real one
      needs a server. Built here over seeded rival captains so the surface, the
      ranking and the season reset are real and playable, with the fetch behind
      one named seam a backend can replace.
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
- [ ] Settings — **export/import is reachable only from the JS console**, which
      cannot ship
- [ ] Store
- [ ] Leaderboard
- [ ] Season / battle pass
- [ ] Defeat and victory screens

## 7 · Ship quality, independent of features

- [ ] **Draw calls < 100.** Measured with `node tools/perf.mjs`, which reads
      `renderer.info.render.calls` after a real frame. The 436 recorded here was
      stale by several rounds; round 8's gate re-measured both island states:

      | `--parts` | day one (1 building) | `?save=demo` (11 buildings) |
      |---|---|---|
      | terrain | 7 | 7 |
      | terrain,decor | 50 | 45 |
      | terrain,decor,buildings | 110 | 1255 |
      | everything (+ ship) | **132** | **1279** |

      (`tools/perf.mjs` only drives the island; the sea has never been measured.)

      Read down the columns rather than at the totals, because they say something
      the totals hide. **Terrain is 7 calls and decor is under 45** — both are
      merged and instanced and neither is the problem. **The buildings are the
      whole of it**: 60 calls for one Ayuntamiento, 1210 for eleven, which is
      about 110 draw calls per building. Each optimised `.glb` still arrives as a
      mesh per material and nothing merges or instances them, so the budget is
      blown by the fourth building a player places. Not a regression — HEAD
      measured 132 and 1277 — and not fixable in the island renderer. The lever
      is `tools/optimize.mjs` and the model loader.
- [ ] Initial download < 10 MB
- [ ] 60 fps on a mid-range phone — needs a real device; SwiftShader cannot
      answer it
- [ ] PWA installable, offline boot verified on a device
- [ ] Capacitor shell, icons, splash, App Store metadata
- [ ] An error a player can hit shows something other than a blank canvas
- [x] Audio: synthesised bus, island and sea both covered

## 8 · Known deferred, with the reason

- `unfinished-terrain-lighting.patch` — a background round left it half-wired
- No real multiplayer. PLAN.md's three rules keep the door open; the leaderboard
  above is the first place that door gets used.
