# Production checklist

What "finished" means, as conditions that can be checked rather than judged.
PLAN.md says what to build; this says when to stop. Every line is either a
command that passes or a fact somebody can verify on a phone in under a minute.

Status legend: `[x]` done and verified · `[~]` partly there, gap named · `[ ]` not started.

## 0 · Gates that must stay green

These run on every change. A red gate is a blocker, not a finding.

- [x] `npx tsc --noEmit` clean (strict, `noUnusedLocals`)
- [x] `npm test` — the pure-sim suite, 125 cases
- [x] `npm run test:roundtrip` — island → sea → island driven as a player,
      with no shot mode and no test hooks. The screenshot harness cannot cover
      this: every act runs under `?shot=1`, which boots one scene and never
      switches, so the router was shipping unwatched.
- [x] `npm run build` produces a bundle
- [x] `npm run shoot -- island --mobile` captures without console errors
- [x] `npm run shoot -- island --mobile --act <every act>` — each scripted
      interaction still reaches its feature
- [~] `npm run audit:layers` — 9 of 10 components clean, one real finding.
      This tool was wrong in four different ways and every one of them pointed
      at innocent code: stale selectors (7 of 11 matched nothing); an ink test
      that searched the clip's padding and so measured the BACKGROUND; a gloss
      test demanding a depth the reference itself fails (Clash's own CTA steps
      0.84, same as ours — the cited 0.47 came from columns crossing its text);
      and a single centre column that ran through each component's artwork, so
      a white close-cross or a label became the "face" it compared the rim
      against. It now samples across the width and credits a layer if any
      column shows it, because art can hide a layer but never invent one.
      Remaining: `.pick-row__go` has no warm rim. Three components (builder
      chip, badge, chest slot) still need a save state that shows them.
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
- [ ] Balance is UNTESTED. A capture at ring 3 with the throttle at zero had the
      hull nearly gone in six seconds — arguably correct (keep moving) but
      nobody has played it.

**Done when:** island → sail → fight/loot → return → build works end to end and
is worth repeating. — *the transition is proven by `npm run test:roundtrip`;
the "worth repeating" half still needs the fight and the harvest beats.*

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
- [x] Audio. `src/ui/sfx.ts` is a synthesised bus with a compressor, pitch
      randomisation and an iOS-safe lazy context. The sea now has its half:
      cannon, hit-on-mob, hit-on-hull, kill, loot and sinking, all pitched
      below the island bank so a broadside has room under a hull groan.
- [ ] PWA installable, offline boot verified on a device
- [ ] An error a player can hit does something other than a blank canvas

## 6 · Known deferred, with the reason

- The unfinished terrain-lighting work in `unfinished-terrain-lighting.patch`
  (a background round left it half-wired; it broke `tsc`, so it was set aside).
- No multiplayer. PLAN.md's three rules keep the door open; nothing is built.
