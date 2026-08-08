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
- [x] `npm test` — the pure-sim suite, 125 cases
- [x] `npm run test:roundtrip` — island → sea → island driven as a player
- [x] `npm run build` produces a bundle
- [x] `npm run shoot -- island --mobile --act <each act>` — every scripted
      interaction still reaches its feature
- [~] `npm run audit:layers` — 9/10 components clean; `.pick-row__go` has no rim
- [x] `npm run audit:sea` — sea texture against the reference, HUD excluded
- [ ] `node tools/blind.mjs` — our frame beats the shipped game's, judged blind

---

## 1 · First run: menu, captain, tutorial

None of this exists. The game currently drops a cold player straight onto an
island with one idle tooltip. For a store release this is the first ninety
seconds, and it decides everything else.

- [ ] **Title / main menu.** Logo, Jugar, Ajustes, and the returning-player
      state (continue, and what is waiting). Animated sea behind it rather than
      a static plate — we already have the water and it is the best thing we own.
- [ ] **Captain creation.** PLAN.md Fase 4 promises the modular Avatar system.
      **Blocked on assets**: all 54 models we have are buildings, mobs, ships
      and props. The Pirate Nation Avatar library (body, hair, hats, coats) has
      never been fetched — `tools/assets-manifest.json` needs the entries and
      the fetch/optimize pipeline needs a run.
- [ ] The captain appears in the world: on the island, and at the helm at sea.
- [ ] **Tutorial director.** RETENTION.md's session loop taught by doing —
      collect, build, start a timer, open a chest, sail. Gated, skippable, and
      it must never block on a timer a real player would simply wait out.
- [ ] A named save, so the captain has an identity to put on a leaderboard.

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
      direction, not a turn rate
- [x] Automatic broadsides; the player plays positioning
- [x] Cargo lands in the island economy, capped, overflow reported
- [x] Cannon, hit, kill, loot and sinking audible; smoke, flash, hurt veil
- [ ] **The Giant Squid boss.** Spawned and tethered, but it has no fight of its
      own — no phases, no tell, no reward moment.
- [ ] Harvesting and boarding beats. A site is taken by sailing over it, which
      is the placeholder, not the design.
- [ ] Balance. A capture at ring 3 with the throttle at zero had the hull nearly
      gone in six seconds. Nobody has played this.

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

- [ ] **Draw calls < 100.** Currently **436** against PLAN.md's budget.
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
