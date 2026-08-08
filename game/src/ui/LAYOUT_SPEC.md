# LAYOUT_SPEC — the HUD's structure

Companion to [`UI_SPEC.md`](UI_SPEC.md). That document settles what an **object** looks like — the
ink contour, the hard gloss step, the warm rim, the extrusion lip. This one settles **how many
objects there are, where they sit, and how much of the world stays visible**.

The split exists because the two questions have different best answers, and both references are
right about their half:

| Question | Authority |
|---|---|
| How does a control feel under a thumb? | Clash of Clans (`reference/clash/`) |
| How much chrome should a phone show at once, and how is it grouped? | Kingshot (`reference/kingshot/`) |
| What does the 3D world look like? | Pirate Nation (`reference/*.png`) |

Where they disagree: **Clash wins on the object, Kingshot wins on the layout.**

---

## What Kingshot does that we do not

Observed from real gameplay captures, not marketing art.

### 1. A bottom navigation bar — the biggest structural gap

Kingshot anchors six destinations along the bottom edge: icon, label underneath, red badge when
something is claimable. It is always present, it never moves, and it is the only place a
destination lives.

We scatter the same destinations into four corner buttons, which costs us three ways: the corners
are the worst part of a phone screen for a thumb, nothing tells the player how many destinations
exist, and each button needs its own framing so the chrome multiplies.

**Adopt.** One bar along the bottom, five slots:

| Slot | Destination | Badge |
|---|---|---|
| 1 | Isla (the builder — the default) | — |
| 2 | Cofres | ready count |
| 3 | Zarpar (the primary action; visually raised above the others) | — |
| 4 | Diario (quests, daily streak) | claimable count |
| 5 | Ajustes | — |

Slot 3 sits proud of the bar and is the one element allowed Clash's full four-layer treatment; the
rest are flat icon+label so the bar reads as one object rather than five.

### 2. Grouped top capsule instead of stacked pills

Kingshot runs **one dark translucent capsule** across the top with thin vertical dividers between
values, and the world shows through it. Heavy framing is spent only on the avatar portrait and the
premium currency.

We stack three to five separately-framed pills, each with its own contour, gloss, rim and shadow.
At five resources that is five heavy objects competing along the top edge.

**Adopt, partly.** Resources group into one translucent capsule with dividers. Gems keep their own
framed pill, because premium currency earning emphasis is correct in both references. The builder
counter joins the capsule rather than floating separately.

The tension with `UI_SPEC.md` §0.2 is real and resolved this way: the four-layer rule governs
anything the player can **press**. A read-only readout is a label, and labels may be translucent.

### 3. Timers as dark capsules, not progress bars

Kingshot floats a dark translucent capsule with white numerals over each working building. Ours is
a green bar with the time above it.

Over a busy, saturated world a green bar competes with the world; a dark capsule recedes and its
white numerals stay legible at any zoom. Kingshot's world is as colourful as ours and it reaches
for the dark capsule, which is the tell.

**Adopt.** Dark translucent capsule, white numerals, no fill bar. Keep a thin progress line along
the capsule's bottom edge so elapsed time is still readable at a glance.

### 4. A persistent objective line

Above the nav bar Kingshot keeps one line naming the current goal with its progress — *"Aprimorar a
Serraria para o Nv. 27 (26/27)"*. It is the next-action resolver made visible.

We already resolve the next action in the sim (`nextAction`, §4.8) and spend it only on a glow and
a pointer. Saying it in words costs one line and removes all ambiguity about what the game wants.

**Adopt.** One line, tappable, routing to whatever it names.

### 5. Dense stat grids in sheets

Kingshot's building sheet packs level, a progress bar with a percentage, a description, and a 2×2
grid of label/value pairs (production, consumption, attributes, time) above the CTA — and the CTA
carries its cost inline with a currency icon.

Ours shows one before→after row. The information is there in the sim and withholding it makes the
decision harder, not simpler.

**Adopt.** A 2×2 stat grid, and the cost on the CTA itself.

---

## What we do NOT take from Kingshot

- **Its palette and rendering.** Painted semi-realism over a warm voxel world would fight the art.
  Colour stays where `UI_SPEC.md` §1 puts it.
- **Its density at the extremes.** The captures show a right-hand rail of eight event tiles with
  independent countdowns, plus a chat line. That density serves a live-ops game with daily events
  and a social layer; ours is single-player and offline, and copying it would be chrome with
  nothing behind it.
- **Its flat controls.** Kingshot's buttons are flatter than Clash's. Anything pressable keeps the
  four-layer treatment.

---

## The rule this all serves

**Chrome earns its place or it goes.** A phone screen is mostly world; every object on top of it
has to justify the pixels it hides. Kingshot's restraint comes from grouping what is merely read
and framing only what is pressed — that is the principle worth taking, more than any specific
measurement.
