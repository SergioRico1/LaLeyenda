# Production checklist

What "finished" means, as conditions that can be checked rather than judged.
PLAN.md says what to build; this says when to stop. Every line is either a
command that passes or a fact somebody can verify on a phone in under a minute.

Status legend: `[x]` done and verified · `[~]` partly there, gap named · `[ ]` not started.

## 0 · Gates that must stay green

These run on every change. A red gate is a blocker, not a finding.

- [x] `npx tsc --noEmit` clean (strict, `noUnusedLocals`)
- [x] `npm test` — the pure-sim suite, 92 cases
- [x] `npm run build` produces a bundle
- [x] `npm run shoot -- island --mobile` captures without console errors
- [x] `npm run shoot -- island --mobile --act <every act>` — each scripted
      interaction still reaches its feature
- [~] `npm run audit:layers` — the tool is repaired; five real findings remain.
      It was red before this loop started with 7 of 11 selectors matching
      nothing, AND its central test was wrong: the ink-contour check searched
      the clip's padding rather than the component, so it was measuring the
      BACKGROUND behind each object. Every past "missing ink contour" verdict
      was false, and anything changed to satisfy one was chasing wrong pixels.
      Now: 10 components measured, 4 clean, and these five to settle —
      timer capsule (no lip: a deliberate LAYOUT_SPEC item 3 dark capsule, so
      a spec conflict to resolve rather than a bug to fix), objective row,
      picker row CTA and close button (no warm rim), sheet CTA (gloss ratio
      0.83 against ≤0.62 — a flat face on the most-pressed button in the game).
      Three more (builder chip, badge, chest slot) need a save state that shows
      them before they can be measured at all.
- [x] `npm run audit:sea` — sea texture against the reference, HUD excluded

## 1 · Your island — PLAN.md Fase 1

- [x] Grid island, voxel terrain, sea around it
- [x] Camera: one finger pans, two pinch, clamped to the island
- [x] Build: picker → ghost → green/red cells → confirm, and moving what exists
- [x] Economy: four resources, two caps, timers, builder limit, offline catch-up
- [x] HUD to the Clash/Kingshot bar, four-layer rule enforced by an audit
- [x] Session hooks: collection bubbles, ¡Lleno!, daily chain, quests, chests

**Done when:** a ten-minute session places and upgrades buildings, survives a
close and reopen, and pays out accumulated production the next day. — *met*

## 2 · Open sea — PLAN.md Fase 2  ← the missing half

Without this, ¡Zarpar! is a dead button and the loop the plan is built around
never closes. This is the single largest gap between here and a finished game.

- [x] `sim/sea.ts`: pure, deterministic voyage — ship kinematics, seeded world,
      mobs, broadsides, loot, sinking. No three.js, no clock, no `Math.random`.
- [x] Tests: same seed ⇒ same voyage; a mob that patrols, chases and attacks;
      loot that survives being sunk only in part; rings that get harder outward
      (27 cases in `tools/tests/sea.test.ts`)
- [x] Sea scene: streams sites and mobs around the ship from the same `sitesNear`
      the sim uses, distance fog, blob shadows, wake. Measured against
      reference/sea_combat.png: mean 88.3 vs 96.9, sd 46.6 vs 52.7,
      detail 17.5% vs 18.1%.
- [x] Control: `ui/stick.ts` — the stick appears under the thumb wherever it
      presses, and reports a WORLD DIRECTION rather than a turn rate
- [x] Automatic broadsides — the player plays positioning, not a fire button
- [ ] Mob scale: a kelpling still reads larger than the ship. `fit` normalises
      the largest axis, which flatters a wide creature over a masted hull.
- [ ] PvE islands: harvestables, chests, and the Giant Squid holding a rich one
- [x] Return home: cargo lands in the island economy through `landCargoInPlace`,
      capped like any other income, with the overflow reported not dropped
- [x] ¡Zarpar! actually sails, still gated on the shipyard's boat
- [x] Voyage HUD: hull bar, hold, ring, and a compass to the harbour
- [ ] PvE islands: harvestables and chests are placed, but a site is taken by
      sailing over it — there is no boarding or harvesting beat yet
- [ ] The Giant Squid is spawned and tethered, but has no fight of its own

**Done when:** island → sail → fight/loot → return → build works end to end and
is worth repeating.

## 3 · Island defence — PLAN.md Fase 3

- [ ] Threat meter that fills with wealth, resolved only while playing
- [ ] Defensive buildings placed on the same grid
- [ ] Undead raid waves through the deterministic sim
- [ ] Cheap repairs — losing costs loot, never progress

## 4 · Long progression — PLAN.md Fase 4

- [ ] Shipwright unlocks hull classes with shards
- [ ] Achievements as trophies standing on the island
- [ ] Bulletin board quests

## 5 · Production quality, independent of features

- [ ] **Draw calls < 100.** Currently **436** against the PLAN.md budget of 100
      (`node tools/perf.mjs`). Ships to a phone, so this is a blocker not a
      nice-to-have.
- [ ] Initial download < 10 MB. Currently ~870 KB JS + models — check the total.
- [ ] 60 fps on a mid-range phone. The harness runs SwiftShader and cannot
      answer this; it needs a real device.
- [ ] Settings panel: export/import save reachable without the JS console.
      Today `window.laLeyenda.export()` is the only route, which is not shipping.
- [ ] First-run director: the game currently explains itself through one idle
      tooltip. A player who has never seen it should be building inside a minute.
- [~] Audio. I wrote "not a single sound exists" here and that was wrong —
      `src/ui/sfx.ts` is a 206-line synthesised bus with a compressor, pitch
      randomisation and an iOS-safe lazy context. What is missing is the SEA:
      no cannon, no hit, no hull groan, no wave. The island is covered.
- [ ] PWA installable, offline boot verified on a device
- [ ] An error a player can hit does something other than a blank canvas

## 6 · Known deferred, with the reason

- The unfinished terrain-lighting work in `unfinished-terrain-lighting.patch`
  (a background round left it half-wired; it broke `tsc`, so it was set aside).
- No multiplayer. PLAN.md's three rules keep the door open; nothing is built.
