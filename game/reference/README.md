# The bar

Three references, each governing a different part of the game. They are never mixed.

## `*.png` — Pirate Nation → the 3D world

The shipped game built from **these exact CC0 assets**, so any difference between their frame and
ours is our execution, never the art. Governs water, terrain, lighting, scale and composition.

| File | What it settles |
|---|---|
| `island_hero.png` | The island: stepped beach and plateaus, plot layout, the lagoon, the waterline collar |
| `sea_combat.png` | Open sea: the ocean ramp toward the horizon, foam, rock arches, voxel clouds |
| `ui_*.png` | Their own UI — kept for reference only. It is desktop-oriented and is **not** our UI bar |

## `clash/*.jpg` — Clash of Clans / Royale → the UI language and the hooks

The standard for a chunky, physical, touch-first builder HUD, and for the loops that bring a player
back. `src/ui/UI_SPEC.md` §0.2 distils it to the rule that generates everything: every UI object is a
physical thing lit from directly overhead, drawn with an ink contour, a hard gloss step at ~50%
height, a warm rim on the top inner edge, and a dark lip plus a zero-offset extrusion shadow.

Also the source of the retention design in `RETENTION.md`: collection bubbles, `¡Lleno!` labels, the
builder limit, timed chests, the daily streak and red badges.

## `kingshot/*.jpg` — Kingshot → the modern mobile HUD

A 2024 mobile builder, and a deliberate counterweight to Clash. Where Clash frames every value in its
own ornamented wooden pill, Kingshot runs **one dark translucent capsule** across the top with thin
dividers between values, keeps the world visible through the chrome, and reserves heavy framing for
the few things that deserve emphasis — the avatar portrait and the premium currency.

Look at `ks_02.jpg` for the canonical HUD. Several files in this folder are marketing key art rather
than gameplay; judge only the ones showing a real interface.

Take from Kingshot: restraint, the single grouped top bar, thin dividers, translucency over the
world, and the confidence to leave space empty. Do not take its palette or its rendering style — the
world underneath ours is warm voxel, not painted realism.

## Why three and not one

Clash is the better guide for how a control should feel under a thumb; Kingshot is the better guide
for how much chrome a modern phone game should show at once. Where they disagree, Clash wins on the
*object* (a button, a pill, a badge) and Kingshot wins on the *layout* (how many objects, how they
group, how much of the world stays visible).

## Provenance

Pirate Nation frames come from the official docs; Clash and Kingshot frames come from published
marketing and store listings. They are reference material for calibration — nothing here is shipped
in the game, and no asset from any of them appears in the build.
