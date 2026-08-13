# UI_SPEC — La Leyenda Pirata

**The single document the HUD is implemented from.** Everything here is measured against
`reference/clash/*.jpg` (UI, HUD, retention) and `reference/island_hero.png` (world, art).
The two references never mix: the 3D world is Pirate Nation, every pixel of chrome is Clash.

Companion docs: [`PLAN.md`](../../PLAN.md) (what we build), [`RETENTION.md`](../../RETENTION.md)
(why the player returns). Where this document contradicts `RETENTION.md`, **this document
wins** — the contradictions are deliberate and each one is flagged in
[§9 Corrections to RETENTION.md](#9-corrections-to-retentionmd).

Target device: **phone, portrait first, one-handed.** Clash is landscape and two-handed;
we copy its *intent*, not its coordinates.

---

## 0. Scope, files, and how to read this

### 0.1 Files this spec produces

```
src/ui/
  UI_SPEC.md          ← this document
  tokens.css          ← §1 verbatim, no additions
  base.css            ← reset, font-face, .t / .num mixins, layer stack
  components/         ← one .css + one .ts per component in §3
  hud.ts              ← assembles §2 layout, subscribes to sim state
  format.ts           ← §1.9 number and timer formatters
public/fonts/         ← self-hosted woff2 (§1.8) — PWA must work offline
src/data/balance.json ← §4 tables, machine-readable
```

### 0.2 The one rule that generates all the others

Every UI object is **a physical thing lit from directly overhead**, drawn with four layers
that never vary:

| # | Layer | Token |
|---|---|---|
| 1 | Constant-weight near-black contour | `--ui-ink` at `--ui-ink-w` |
| 2 | **Hard gloss STEP** at ~50% of height (never a smooth ramp) | `--brk` |
| 3 | 1–2px warm-white rim on the **top inner** edge | `--ui-rim` |
| 4 | Dark lip inside the bottom + **zero-x-offset** extrusion shadow | `--ui-lip`, `--ui-drop` |

Apply all four to any shape at any size and it is Clash. Omit any one and it collapses into
a flat web UI. Everything in §6 (anti-goals) is a way of omitting one of these four.

### 0.3 Conventions in this document

- Sizes are CSS px at a 390×844 portrait baseline unless a table says otherwise.
- `S` = the responsive scale token (§1.7). Portrait uses compact sizes; landscape uses the
  reference sizes.
- Copy strings are Spanish (the game is `lang="es"`); see [§8 Copy](#8-copy-strings).
- ✎ marks a decision taken by the UI architect where the two studies disagreed or were
  silent. Every ✎ is restated in [§10 Decisions log](#10-decisions-log).

---

## 1. Tokens — `src/ui/tokens.css`

Paste as-is. **Do not add a token that does not do a job.** An extra "brand" hue, a second
font, or a decorative accent is the thing that makes a clone look like a clone.

### 1.1 Ink, light and shadow — the four layers

```css
:root {
  /* --- 1. CONTOUR --- */
  --ui-ink:        #17130E;   /* warm near-black. NEVER #000 — that reads as a hole. */
  --ui-ink-w:      3px;       /* constant at every size: 24px badge and 340px card alike */
  --ui-ink-w-sm:   2px;       /* elements under ~28px only */

  /* --- 2. GLOSS STEP (set --brk per element, see table below) --- */
  --brk:           52%;

  /* --- 3. RIM --- */
  --ui-rim:        rgba(255,255,250,.62);  /* top inner edge, every raised surface */
  --ui-rim-low:    rgba(255,255,240,.30);  /* bottom inner edge, large buttons only */

  /* --- 4. LIP + EXTRUSION --- */
  --ui-lip:        rgba(0,0,0,.32);
  --ui-drop:       0 6px 0 rgba(0,0,0,.30);    /* hard, zero blur, ZERO x-offset */
  --ui-cast:       0 10px 16px rgba(0,0,0,.38);/* soft ground shadow, always paired */
}
```

**`--brk` is a function of height, not a constant.** Measured from the references:

| Element height | `--brk` | Measured on |
|---|---|---|
| > 80px | `47%` | Attack tile (118px), ¡Zarpar! |
| 52–80px | `52%` | Confirm ✓ (56px), close X (63px → 59%) |
| < 52px | `60%` | Brew pill (47px), status chips |

### 1.2 Surfaces — panels, pages, wells

```css
:root {
  --ui-panel:      #EAEAE2;   /* cream panel body — warm off-white, never pure white */
  --ui-panel-2:    #F4F4F0;   /* raised cream: active tab face, callout strips */
  --ui-well:       #3A3635;   /* dark charcoal content well INSIDE a cream panel */
  --ui-frame:      #6E645C;   /* warm taupe stone band of the modal border */
  --ui-frame-w:    5px;
  --ui-frame-dark: #211E19;   /* outermost 3px near-black stroke of the frame */
  --ui-page:       #352933;   /* full-screen page body — desaturated aubergine, not black */
  --ui-letterbox:  #050505;
  --ui-scrim:      rgba(0,0,0,.48);  /* celebration dim — sits ABOVE the HUD */
  --ui-tab-off:    #827E70;
  --ui-navy-a:     #061C2E;   /* chest scene background top */
  --ui-navy-b:     #0E3557;   /* chest scene background bottom (radial, behind chest) */
}
```

> **Cream frames, charcoal holds.** A modal is cream on the outside with a `--ui-well` inset
> panel containing the actual list. The contrast flip is what stops a large panel from
> looking like a blank sheet.

### 1.3 Button hues — five families, one recipe

Each family is five stops: gloss-top, gloss-bottom, base-top, base-bottom, lip.

```css
:root {
  /* GREEN = go / confirm / claim */
  --ui-green-gloss-a:#DCF782; --ui-green-gloss-b:#A5DC4D;
  --ui-green-a:#85C82D;       --ui-green-b:#6BAB33;      --ui-green-lip:#46761F;
  /* GREEN-CONFIRM (build placement ✓, slightly cooler & deeper) */
  --ui-ok-gloss-a:#E1F852;    --ui-ok-gloss-b:#CFF041;
  --ui-ok-a:#4ABA14;          --ui-ok-b:#45B316;         --ui-ok-lip:#2E7A0C;
  /* RED = close / stop */
  --ui-red-gloss-a:#FF9A98;   --ui-red-gloss-b:#F0706F;
  --ui-red-a:#D4141A;         --ui-red-b:#B60D10;        --ui-red-lip:#7C0A0C;
  /* ORANGE = the primary world action (¡Zarpar!, Construir) */
  --ui-orange-gloss-a:#FFAD39;--ui-orange-gloss-b:#E29C2C;
  --ui-orange-a:#CE7016;      --ui-orange-b:#C86A15;     --ui-orange-lip:#9A4E0E;
  /* GOLD/AMBER = premium surface (Cofres — our featured tile) */
  --ui-gold-a:#F0B722;        --ui-gold-b:#D89412;
  --ui-gold-deep:#A06E15;     --ui-gold-text:#F5E27A;    --ui-gold-lip:#8A5B0F;
  /* LIGHT UTILITY GREY = settings, log, missions. CREAM-warm, not neutral. */
  --ui-grey-gloss-a:#FFFFF4;  --ui-grey-gloss-b:#E4E2CE;
  --ui-grey-a:#EFEDDC;        --ui-grey-b:#C9C7B0;       --ui-grey-lip:#8F8D78;
  /* MID-STONE SECONDARY = passive, "quizá luego", inactive tab, DISABLED */
  --ui-grey2-gloss-a:#D6D6CE; --ui-grey2-gloss-b:#B9B9B2;
  --ui-grey2-a:#A3A399;       --ui-grey2-b:#8E8E84;      --ui-grey-lip-2:#6A675E;
  /* BLUE = information and item tiles (cards, info "i") */
  --ui-blue-a:#4ECBE6;        --ui-blue-b:#3E9FC0;
  --ui-blue-rim:#8FE0F5;      --ui-blue-stroke:#1B3F4E;
  --ui-info-a:#52C0F0;        --ui-info-b:#2E86C4;
  /* IVORY = the one featured frame. Reserve it. */
  --ui-ivory:#FFF9E4;
}
```

**Colour is strictly functional.** Green = go, red = close, orange = primary world action,
gold/ivory = premium, blue = information, taupe/grey = passive. There is no decorative
colour anywhere in this UI.

### 1.4 Resource identity

Clash ships two currencies at minute one. We ship two and reveal the rest (§4.1). ✎ Wood and
gold are adjacent warm hues; they are separated by **icon silhouette** (stacked logs vs. the
stacked-coin motif) and by chroma, not by hue alone. Rum keeps Clash's elixir slot — a
saturated magenta — because at 32px over bright turquoise water the bar colour is pure
wayfinding, and the amber bottle icon carries the identity.

| Resource | Fill | Icon body | Producer → Store | Revealed at |
|---|---|---|---|---|
| Oro | `--ui-res-gold` `#F5D546` | `#FFD029` | Mercado → Banco | start |
| Madera | `--ui-res-wood` `#C57C2A` | `#D9913F` | Aserradero → Almacén | start |
| Ron | `--ui-res-rum` `#CE3FD6` | `#E7863A` (bottle) | Destilería → Bodega | Ayto 2 |
| Metal | `--ui-res-metal` `#7C8DA0` | `#A9BACB` | Fundición → Depósito | Ayto 4 |
| Gemas | `--ui-res-gem` `#B7E33A` | `#D2E97D` hi-face | — (no cap, no bar) | start |

```css
:root {
  --ui-res-gold:#F5D546;  --ui-res-wood:#C57C2A;
  --ui-res-rum: #CE3FD6;  --ui-res-metal:#7C8DA0;  --ui-res-gem:#B7E33A;

  /* pill internals */
  --ui-track-empty: rgba(255,255,255,.34);  /* translucent WHITE over the live 3D scene */
  --ui-track-well:  rgba(0,0,0,.42);        /* translucent BLACK — pills with no fill bar */
  --ui-fill-gloss: linear-gradient(180deg,
      rgba(255,255,255,.36) 0%,   rgba(255,255,255,.36) 56%,
      rgba(0,0,0,.10)      56.01%,rgba(0,0,0,.10)      100%);

  /* build/craft timer */
  --ui-timer-a:#A6E04B;   --ui-timer-b:#7CC423;

  /* badge */
  --ui-badge-red:#E02A22; --ui-badge-ring:#FFF4DE;

  /* build mode */
  --ui-grid-ok: rgba(20,220,10,.55);
  --ui-grid-bad:rgba(220,30,20,.55);
  --ui-arrow:   #92CA27;

  /* rarity — frame colour ONLY, never the art */
  --ui-rarity-common:#C8D2DC;  --ui-rarity-rare:#7FD0E8;
  --ui-rarity-hot:   #D79352;  --ui-rarity-legend:#F0B722;
}
```

> **HUD chrome is never opaque.** The empty part of a storage bar is translucent white over
> the live scene; a pill with no fill bar is translucent black. Only modals are solid. Our
> world is brighter and bluer than Clash's grass — verify contrast against the turquoise sea
> of `island_hero.png`, not only against green.

### 1.5 Radii

```css
:root {
  --ui-r-pill:  999px;  /* resource pills, timer bars, XP bars */
  --ui-r-btn:   14px;   /* text button   ≈ 0.22 × height */
  --ui-r-icon:  16px;   /* square icon button ≈ 0.19 × side */
  --ui-r-card:  18px;   /* shop/offer card ≈ 0.08 × width */
  --ui-r-panel: 20px;   /* modal. Rounded RECTANGLE, not a squircle. Do not raise. */
  --ui-r-badge: 8px;    /* ≈ 0.30 × size — a rounded SQUARE, not a circle */
  --ui-r-tile:  10px;   /* reward tile ≈ 0.11 × width */
  --ui-r-chip:  7px;    /* status chip */
}
```

### 1.6 Type

```css
:root {
  --ui-font-display:'Lilita One','Baloo 2',system-ui,sans-serif;  /* headings, labels */
  --ui-font-num:    'Fredoka','Baloo 2',system-ui,sans-serif;     /* all numerals, w600 */

  --ui-txt-stroke-h:0.14em;  /* HEADINGS  → ~0.07em visual → ~10% of cap height */
  --ui-txt-stroke-n:0.20em;  /* NUMERALS  → ~0.10em visual → ~14% of cap height */
  --ui-txt-stroke-x:0.16em;  /* GLYPHS (X, ✓, +) */
  --ui-txt-drop:    0 0.07em 0 rgba(0,0,0,.82);  /* hard, zero blur, down only */
}
```

Size ladder (portrait; ×1.12 in landscape):

| Role | Size | Stroke | Drop | Notes |
|---|---|---|---|---|
| Modal title | 30px | `--ui-txt-stroke-h` | `0 3px 0` | Title Case, centred |
| Section header | 20px | `0.13em` | `0 2px 0` | |
| Button label | 20px | `0.13em` | `0 2px 0` | |
| CTA tile caption | 19px | `0.13em` | `0 2px 0` | baked into the tile |
| Body on cream | 15px | **none** | none | `color:#3A3430` |
| Body on colour | 15px | `0.10em` | `0 1px 0` | white |
| Micro label | 13px | `0.10em` | `0 1px 0` | "Botín:", "Construido:" |
| Numeral, HUD | 22px | `--ui-txt-stroke-n` | `0 3px 0` | tabular |
| Numeral, world timer | 18px | `--ui-txt-stroke-n` | `0 2px 0` | |
| Numeral, reward tile | 22px | `0.20em` | `0 3px 0` | bottom-centre |
| Numeral, victory row | 30px | `0.18em` | `0 3px 0` | left of the icon |
| Badge numeral | 15px | `--ui-txt-stroke-x` | `0 2px 0` | |

### 1.7 Metrics — responsive scale

Portrait uses **compact** sizes so the five-row pill stack still clears the island.
Landscape reverts to the reference metrics exactly.

```css
:root {                       /* PORTRAIT (default, mobile-first) */
  --ui-pill-h:32px;  --ui-pill-w:150px; --ui-pill-icon:50px; --ui-pill-gap:8px;
  --ui-icon-btn:56px; --ui-cta:88px;    --ui-cta-sub:56px;
  --ui-badge-size:24px; --ui-tap-min:48px;
  --ui-edge:12px;                /* no HUD element inside 12px of an edge, pre-safe-area */
  --ui-cluster-x:20px; --ui-cluster-y:20px;
  --ui-safe-t:env(safe-area-inset-top,0px);
  --ui-safe-b:env(safe-area-inset-bottom,0px);
  --ui-safe-l:env(safe-area-inset-left,0px);
  --ui-safe-r:env(safe-area-inset-right,0px);
}
@media (orientation:landscape) {
  :root {
    --ui-pill-h:34px; --ui-pill-w:clamp(150px,15vw,220px);
    --ui-pill-icon:54px; --ui-pill-gap:12px;
    --ui-cta:96px;  --ui-cta-sub:60px;
  }
}
@media (max-width:359px) {     /* iPhone SE and below */
  :root { --ui-pill-w:132px; --ui-cta:80px; --ui-cta-sub:52px; --ui-cluster-x:14px; }
}
```

`--ui-tap-min: 48px` is absolute. Anything drawn smaller (the pill `+`, the info `i`, a
close X) carries an invisible padded `::after` hit area up to 48px.

### 1.8 Fonts — self-hosted, offline-safe

Lilita One and Fredoka are SIL OFL and must be **bundled**, not fetched — this is a PWA and
`RETENTION.md` assumes it opens offline.

```
public/fonts/LilitaOne-Regular.woff2      (latin + latin-ext, U+0000-00FF,0100-024F,2000-206F)
public/fonts/Fredoka-SemiBold.woff2       (subset to digits, letters, ¡ ¿ € ×)
```

```css
@font-face{font-family:'Lilita One';src:url('/fonts/LilitaOne-Regular.woff2')format('woff2');
  font-weight:400;font-display:block;}
@font-face{font-family:'Fredoka';src:url('/fonts/Fredoka-SemiBold.woff2')format('woff2');
  font-weight:600;font-display:block;}
```

`font-display:block` — a fallback system font flashing in outlined heavy text looks broken.
Preload both in `index.html`.

### 1.9 The two text mixins

```css
/* Every label in the game is a size variant of this. */
.t{
  font-family:var(--ui-font-display); font-weight:400;
  color:#fff; letter-spacing:-.01em; line-height:1.05;
  paint-order:stroke fill;                          /* REQUIRED */
  -webkit-text-stroke:var(--ui-txt-stroke-h) var(--ui-ink);
  text-shadow:var(--ui-txt-drop);
}
/* Every number and timer. */
.num{
  font-family:var(--ui-font-num); font-weight:600;
  font-variant-numeric:tabular-nums;                /* counters must not jitter */
  font-size:22px; letter-spacing:-.02em; color:#fff;
  paint-order:stroke fill;
  -webkit-text-stroke:var(--ui-txt-stroke-n) var(--ui-ink);
  text-shadow:0 3px 0 rgba(0,0,0,.85);
}
.num u{ font-variant-caps:small-caps; font-size:.88em; text-decoration:none; } /* unit suffix */
```

**Mechanics that are not optional:**
- `-webkit-text-stroke` centres the stroke on the glyph outline, so half is repainted by the
  fill *only if* `paint-order:stroke fill` is set. Declared width is **double** the visual
  outline. Both properties always ship together.
- Fallback for engines without `paint-order` (`@supports not (paint-order:stroke)`): an
  8-direction `text-shadow` ring at the visual width plus the drop.
- The drop is `0 Npx 0`. **Zero blur, zero x-offset.** Blurring it is the single fastest way
  to look like a generic mobile game.

**Formatters — `src/ui/format.ts`:**

```ts
const THIN = ' ';                         // thousands separator is a THIN SPACE
export const n = (v:number) => String(Math.floor(v)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
//  1556 → "1 556"   2000000 → "2 000 000"     NEVER a comma, never a dot.

export function dur(ms:number){                // "7m 17s" · "2d 16h" · "45s"
  const s=Math.max(0,Math.ceil(ms/1000));
  const d=s/86400|0, h=s%86400/3600|0, m=s%3600/60|0, sec=s%60;
  if(d) return `${d}<u>d</u> ${h}<u>h</u>`;
  if(h) return `${h}<u>h</u> ${m}<u>m</u>`;
  if(m) return `${m}<u>m</u> ${sec}<u>s</u>`;
  return `${sec}<u>s</u>`;
}
```

Casing: **Title Case everywhere.** Clash's small-cap look ("BuilDeRS", "VictoRY") is a
property of the proprietary Supercell Magic font. Do **not** fake it with hand-typed
capitals — it reads as a typo. Genuine `small-caps` is used only on timer unit suffixes,
where it is a faithful match.

### 1.10 Layer stack

```css
:root{
  --z-world-ui:100;   /* bubbles, timer bars, ¡Lleno! chips, drag arrows — projected */
  --z-hud:200;        /* pills, clusters, top chips */
  --z-buildbar:250;   /* build-mode bottom bar (portrait) */
  --z-panel:400;      /* tier-1 floating panel */
  --z-page:500;       /* tier-2 full-screen page */
  --z-celebrate:600;  /* tier-3 scrim — ABOVE the HUD, dims the pills too */
  --z-celebrate-fg:610;
  --z-guide:900;      /* contramaestre + orange arrow + tutorial dim */
  --z-guide-target:901;/* the one element promoted above the tutorial dim */
  --z-toast:950;
}
```

`#ui` is `pointer-events:none`; only leaf interactive elements set `pointer-events:auto`.
The island must stay pannable through every gap in the HUD.

---

## 2. Layout

### 2.1 Portrait — 390 × 844 baseline

```
╔═══════════════════════════════════════════════════════════════╗ 0
║ ░░░░░░░░░░░░░░░ env(safe-area-inset-top) ░░░░░░░░░░░░░░░░░░░░ ║
║ ┌────┬───────────┐                          ┌──────────────┐  ║   ZONE A
║ │ 12 │ XP ▓▓▓▓░░ │                          │ 815      (◉) │  ║   READ-ONLY
║ └────┴───────────┘                          ├──────────────┤  ║   0 → 26 %
║ ┌──────────────┐                            │ 2 436    (▤) │  ║   out of reach,
║ │ (👤) 1/2   ⓘ │  builder chip              ├──────────────┤  ║   and that is
║ └──────────────┘                            │ 1 556    (🍾)│  ║   deliberate
║ ┌──────────────┐                            ├──────────────┤  ║
║ │ (🏆) 1 240   │  status chip (§2.4)        │ 480      (⬛)│  ║
║ └──────────────┘                            ├──────────────┤  ║
║                                             │[+] 256   (◆) │  ║
║                                             └──────────────┘  ║
╟───────────────────────────────────────────────────────────────╢ 26 %
║                                                               ║
║                  ⌂ collect bubble                             ║   ZONE B
║              ▁▁▁▁▁▁▁▁                                         ║   THE ISLAND
║   ┌ ─ ─ ─ ┐   7m 17s                    ┌ ─ ─ ─ ─ ┐          ║   26 → 68 %
║   ┆¡Lleno!┆  ▓▓▓▓▓░░░░  timer bar       ┆ ¡Lleno! ┆          ║
║   └ ─ ─ ─ ┘                             └ ─ ─ ─ ─ ┘          ║   no chrome —
║                                                               ║   only world-
║        town centre sits at ~45 % height  ────────────►        ║   anchored UI
║                                                               ║
╟───────────────────────────────────────────────────────────────╢ 68 %
║  ┌──────┐                                                     ║   ZONE C
║  │ ⚙    │ 56  Ajustes                                         ║   THUMB ZONE
║  └──────┘                          ← 174px clear channel →    ║   68 → 100 %
║  ┌──────┐                                    ┌──────┐         ║
║  │ 📖 ③ │ 56  Diario  (badge)                │ 🔨   │ 56      ║   EVERYTHING
║  └──────┘                                    └──────┘  Constr ║   ACTIONABLE
║  ┌────────┐                                ┌────────┐         ║
║  │ ╔════╗ │                                │        │         ║
║  │ ║COFR║ │ 88  ivory frame                │¡ZARPAR!│ 88      ║
║  │ ║ 3h ║ │     + badge                    │        │         ║
║  │ ╚════╝ │                                └────────┘         ║
║  └────────┘                                                   ║
║ ░░░░░░░░░░░ env(safe-area-inset-bottom) ░░░░░░░░░░░░░░░░░░░░░ ║
╚═══════════════════════════════════════════════════════════════╝ 844
   ↑20px                                                  20px↑
```

**Zone A — read-only, out of reach (0 → 26%).**

| Slot | Contents | Anchor |
|---|---|---|
| Top-left column | R1 level badge 44px + XP capsule 92×20 · R2 builder chip 140×32 · R3 status chip (§2.4) | `left: 12 + safe-l`, `top: 10 + safe-t`, row pitch 40px |
| Top-right stack | resource pills, bottom-up priority: Oro, Madera, Ron, Metal, Gemas | right-aligned `right: 12 + safe-r`, first pill `top: 10 + safe-t`, pitch `--ui-pill-h + --ui-pill-gap` = 40px |
| Top-centre | **empty in portrait** | — |

Stack height: 3 rows early (2 resources + gems) = 120px ≈ 14%; 5 rows at Ayto 4 = 200px ≈ 24%.
Left column max width 144px, right stack begins at x≈211 → no collision on a 390pt screen.

✎ **Clash's top-centre chips move to the left column in portrait.** Centring them on a 390pt
screen puts the builder chip under the pill stack. The left column is the only place they fit
without shrinking the pills below legibility.

✎ **The mailbox/diario moves out of Zone A into the bottom cluster.** It is tappable, and the
governing rule is *everything actionable lives in the bottom 40%*. Clash can keep it top-left
because landscape puts it within a left thumb's arc; portrait does not.

Only two things in Zone A are tappable: the **gem `+`** and the **builder chip**. Both must
have a duplicate route from Zone C (gem `+` → Cofres tile; builder chip → Construir tile).
Everything else is display only — which is exactly why it is allowed to live up there.

**Zone B — the island (26 → 68%).** No screen-anchored chrome. Only world-anchored objects:
collect bubbles, build timer bars, ¡Lleno! chips, placement footprint and drag arrows. Bias
the camera so the town centre sits at ~45% of viewport height, clear of the bottom clusters.
All world-anchored UI **clamps** to the viewport minus a 16px margin so a bubble at the
island's edge never renders half off-screen.

**Zone C — thumb zone (68 → 100%). Every action lives here.**

| Cluster | Anchor | Stack (bottom → top) | Total height |
|---|---|---|---|
| Right (primary) | `right: 20 + safe-r`, `bottom: 20 + safe-b` | ¡Zarpar! 88 · gap 14 · Construir 56 | 158px |
| Left | `left: 20 + safe-l`, `bottom: 20 + safe-b` | Cofres 88 (ivory) · gap 14 · Diario 56 · gap 14 · Ajustes 56 | 228px |

Clear centre channel: `390 − 2×(20+88) = 174px` (minimum 120px on any device).
Tallest cluster tops out 248px from the bottom = y 70.6% — comfortably below the hard rule
that **no primary action sits above 55% of viewport height**.

✎ **The primary CTA is bottom-RIGHT in portrait.** Clash puts Attack bottom-left because
landscape hands it to a left thumb. In portrait one-handed, the comfortable arc is a ~150px
radius centred near (300, 800) for a right thumb. Copy the intent, not the coordinate.
Settings exposes **Zurdo / Diestro** which mirrors the two clusters (and only them).

### 2.2 Landscape — 844 × 390 baseline

Revert to the reference layout exactly; two-handed play makes bottom-left the natural
primary again.

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║┌──┬────────┐        ┌────────────┐  ┌────────────┐            ┌────────────────┐ ║
║│LV│XP ▓▓░░░│        │(👤) 1/2 [+]│  │(⚒) 42m [ⓘ] │            │ 815        (◉) │ ║
║└──┴────────┘        └────────────┘  └────────────┘            ├────────────────┤ ║
║┌──┐                    builder          repairs /             │ 2 436      (▤) │ ║
║│🏆│ 1 240                               event countdown       ├────────────────┤ ║
║└──┘                                                           │ 1 556      (🍾)│ ║
║┌──┐                                                           ├────────────────┤ ║
║│✉③│                                                           │[+] 256     (◆) │ ║
║└──┘                                                           └────────────────┘ ║
║                                                                                  ║
║                          ⌂ bubble        ▓▓▓▓░░ 7m 17s                           ║
║                                                                                  ║
║ ┌──────┐          ┌────┬────┬────┬────┐                             ┌──┐  ┌──┐   ║
║ │ 🔨   │56        │ 🎁 │ 🔒 │ 🔒 │ 🔒 │  chest tray, 4×62 inline    │⚙ │  │📖│   ║
║ └──────┘          │3h51│    │    │    │                             └──┘  └──┘   ║
║ ┌────────┐        └────┴────┴────┴────┘                            ┌────────┐    ║
║ │¡ZARPAR!│96                                                       │ COFRES │96  ║
║ └────────┘                                                         │ ivory  │    ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

| Slot | Contents |
|---|---|
| Top-left | level badge + XP · trophies/rank · mailbox (48px cream tiles, pitch 56) |
| Top-centre | builder chip · status chip (§2.4), 14px gap, centred as a pair |
| Top-right | pill stack, `--ui-pill-w` = `clamp(150px,15vw,220px)` |
| Bottom-left | ¡Zarpar! 96 + Construir 56 above |
| Bottom-centre | chest tray, 4 slots × 62px inline (portrait collapses this into the Cofres tile) |
| Bottom-right | Cofres 96 (ivory) + Ajustes / Diario 56 above |

Honour `safe-area-inset-left/right` — the notch is on one side in landscape and the pill
stack or the CTA will sit under it otherwise.

### 2.3 Orientation handling

- Both orientations are first-class. There is no "please rotate" screen.
- Re-layout on `orientationchange` and on `resize` (debounced 120ms); re-project every
  world-anchored element on the next frame.
- Panels reflow: tier-1 goes from 78vw (landscape) to `100% − 24px` (portrait); card rows go
  from a horizontal scroller to a 2-column grid.
- `index.html` already carries `viewport-fit=cover` — required for `env(safe-area-inset-*)`
  to be non-zero. Do not remove it.

### 2.4 The status chip slot (top-centre / left R3)

One slot, one occupant, resolved by priority. ✎ This replaces Clash's shield pill, which is
an anti-retention object here (see §9).

| Priority | State | Content | Tap |
|---|---|---|---|
| 1 | Repairs running after a raid | `⚒ 42m` | opens the raid report |
| 2 | Weekly event ending in < 24h | `⏳ 6h 10m` | opens Diario → Eventos |
| 3 | Default | `🏆 1 240` rank / notoriety | opens Rangos de Capitán |

---

## 3. Components

Every component below is **one physical object**. If a spec omits the contour, the gloss
step, the rim or the extrusion, that omission is a bug, not a style choice.

### 3.0 The button base — one class, five families

```css
.btn{
  --a:var(--ui-green-gloss-a); --b:var(--ui-green-gloss-b);
  --c:var(--ui-green-a);       --d:var(--ui-green-b);
  --lip:var(--ui-green-lip);   --brk:52%;

  position:relative; display:inline-flex; align-items:center; justify-content:center;
  border:var(--ui-ink-w) solid var(--ui-ink);
  border-radius:var(--ui-r-btn);
  padding:12px 26px; min-height:52px;
  background:linear-gradient(180deg,
    var(--a) 0%,  var(--b) var(--brk),
    var(--c) calc(var(--brk) + .01%), var(--d) 92%,
    var(--lip) 92.01%, var(--lip) 100%);
  box-shadow:
    inset 0 2px 0 var(--ui-rim),
    inset 0 -2px 0 var(--ui-rim-low),      /* large buttons only; omit under 52px */
    var(--ui-drop), var(--ui-cast);
  transition:transform .06s ease-out, box-shadow .06s ease-out, filter .06s ease-out;
}
.btn:active{
  transform:translateY(4px);
  box-shadow:inset 0 2px 0 rgba(255,255,255,.35),
             0 2px 0 rgba(0,0,0,.30), 0 4px 8px rgba(0,0,0,.35);
  filter:brightness(.94);
}
.btn[disabled]{
  --a:var(--ui-grey2-gloss-a); --b:var(--ui-grey2-gloss-b);
  --c:var(--ui-grey2-a); --d:var(--ui-grey2-b); --lip:var(--ui-grey-lip-2);
  filter:saturate(.25); box-shadow:inset 0 2px 0 var(--ui-rim),0 3px 0 rgba(0,0,0,.30);
  pointer-events:none;
}
```

**The gloss break is a hard stop.** `var(--brk)` then `calc(var(--brk) + .01%)`. A smooth
gradient across the face is the number-one tell and is instantly recognisable as wrong.

**Pressed = travels down into its own shadow** (6px → 2px) and dims. Nothing scales, nothing
changes hue, there is no ripple. Pair with `navigator.vibrate(8)`.

**Disabled = the same object in a duller hue.** Do not remove the border, the gloss or the
shadow to signal "secondary" or "disabled" — that breaks the world's internal logic.

### 3.1 Resource pill — storage variant (HUD)

The anatomy most implementations get wrong. Measured from `coc_hud_collect.jpg` and
re-verified by pixel sample (elixir track is `#C9D4A0`-ish light over `#8B9C36` grass on the
left, saturated magenta from ~45% to the right cap).

```
        ┌─────────────────────────────────────────┐
        │ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │ ← 1px white top rim, full width
        │ ░░░░░░░░░░░░│████████████ 1 556       ╭─────╮
        │  EMPTY      │  FILL  →→→ right-anchored│ ICON│ ← overhangs 55% out
        │  translucent│  drains LEFTWARD         ╰─────╯
        │  WHITE over │  + --ui-fill-gloss @56%  │
        │  the world  │  hard vertical left edge │
        └─────────────────────────────────────────┘
          32px tall (portrait) · 150px wide · icon 50px · numeral right:46px
```

| # | Part | Spec |
|---|---|---|
| 1 | Capsule | `height:var(--ui-pill-h); border-radius:999px; border:3px solid var(--ui-ink);` **No box-shadow** — HUD pills sit *on* the world, they do not float above it |
| 2 | Track | inset 3px, `overflow:hidden; border-radius:999px`; empty = `--ui-track-empty` |
| 3 | Fill | `position:absolute; right:0; top:0; bottom:0; width:calc(var(--pct)*100%)` — **anchored right, grows leftward**, hard vertical left edge, no feather, no rounded left cap |
| 4 | Fill lighting | `--ui-fill-gloss` over the fill colour (top-lit split at 56%) |
| 5 | Top rim | 1px `rgba(255,255,255,.5)` along the top inside, across empty *and* filled |
| 6 | Numeral | `.num` 22px (20px portrait), **right-aligned** at `right:46px`, sits **on top of** the fill |
| 7 | Icon | `--ui-pill-icon` = 1.6 × capsule height, `right:-18px` so ~55% hangs outside; own 3px contour + specular dot at 10 o'clock. Gold gets a second coin peeking 6px behind at 85% opacity |

**Never tappable.** That is exactly why it can live at the top out of thumb reach.

States: `--pct ≥ 1` → the pill gets the `.is-full` class: the fill colour shifts up 6%
brightness and the pill pulses amber (`filter:brightness(1.12)`) for 240ms every 3s while
**two or more** producers of that resource are at their cap. One full producer does not pulse.

Landscape: identical, at 34px/54px/`clamp(150px,15vw,220px)`.
**Never exceed 50% of viewport width in portrait** or the island loses its frame.

### 3.2 Resource pill — wallet variant (inside panels/pages)

Used in the footer strip of any purchase-capable page.

- Same capsule, contour and overhanging icon.
- Interior is `--ui-track-well` (translucent black), **no fill bar** — this variant shows what
  you have, not how full you are.
- 1px `rgba(255,255,255,.45)` rim on the top inside edge.
- Three pills in a row, evenly spaced, in a footer strip spanning the full page width:
  solid `linear-gradient(180deg,#8CC552,#A9D588)`, 1px light top edge, height
  `62px + var(--ui-safe-b)`, pinned to the bottom.

This footer is why a Clash shop never makes you close a panel to check your balance. It
appears on **every page that can spend a resource**.

### 3.3 Gem pill

Differs from a resource pill in exactly three ways.

1. **No fill bar** — premium currency is uncapped. Interior is `--ui-track-well` end to end,
   1px light rim on *both* top and bottom inside edges.
2. **A `+` button overhangs the LEFT end.** The rule: *the `+` sits on the end opposite the
   icon.* Gem pill = icon right, plus left. Builder chip = icon left, plus right.
3. **The `+`**: 38×38 (34 portrait), `border-radius:10px` (0.26 × side), 3px `--ui-ink`,
   green hues `#8FD13C / #79BE2A / #5C910F / #4E7D0E`, lip `#33570A`. Fat white plus, 20px,
   `--ui-txt-stroke-x`, `0 2px 0` drop. `left:-10px` so it overlaps the cap by a third.
   Hit area padded to 48×48.

Gem icon: a **hexagonal prism**, not a round gem. Flat top-left facet `#D2E97D`, body
`#B7E33A`, darker bottom-right facet, 3px contour, one hard white specular streak across the
upper-left facet.

The gem `+` opens **Gemas** (how to earn them: obstacles, missions, daily, chests) — we have
no IAP, so it is an *earn* screen, not a shop. It must also be reachable from the Cofres tile
in Zone C.

### 3.4 Builder chip

```
┌──────────────────────────┐
│ ╭────╮                   │   portrait 140×32 · landscape 150×34
│ │(👤)│  1/2         [+]  │   portrait: no [+], chip itself is the tap target
│ ╰────╯                   │   landscape: [+] on the right (opposite the portrait)
└──────────────────────────┘
```

- Capsule, `--ui-r-pill`, 3px `--ui-ink`, interior `--ui-track-well`.
- **Portrait icon left** (voxel carpenter portrait, 44px, overhangs the left cap by ~40%),
  numeral `1/2` centred-right in `.num` 20px.
- Landscape adds the green `+` overhanging the **right** cap (38×38, gem-`+` spec) and a blue
  info `i` (30×30, `--ui-info-a/-b`) floating above the chip's left, per `coc_hud_collect.jpg`.
- A **free builder must annoy visually** (`RETENTION.md` §1): portrait carpenter portrait
  tilts ±8° every 2.5s with a pulsing gold halo; the whole chip gets a 1px gold outer glow.
- After **30s idle with a free builder in this session**, a tooltip slides out of the chip:
  *"Carpintero sin trabajo"* with an arrow pointing down to the **Construir** tile, which
  simultaneously gains a badge.

✎ The chip stays in Zone A (matching Clash's silhouette) and **is** tappable (48px hit area,
opens the Builders panel), but the *actionable* free-builder signal is mirrored onto the
Construir tile in Zone C. This satisfies both studies: the top row keeps its read-only
character, and no required action lives out of thumb reach.

### 3.5 Primary CTA — orange action tile (`¡Zarpar!`)

The largest, warmest, most permanently visible button. It is a **square icon tile with a
caption baked in**, never a text pill.

| Property | Portrait | Landscape |
|---|---|---|
| Size | 88×88 | 96×96 |
| Radius | 18px | 18px |
| `--brk` | 47% | 47% |
| Caption | 19px `.t`, white, full outline + drop | 20px |

- Hues: orange family. **Both** inner rims: `inset 0 2px 0 rgba(255,255,250,.62)` and
  `inset 0 -2px 0 rgba(255,205,162,.45)` (a bright `#FECDA2` line just inside the bottom).
- Contents: illustrated icon in the top ~62% at ~64% of tile width, with its own
  `drop-shadow(0 3px 3px rgba(0,0,0,.35))`; caption pinned at the bottom.
- Sibling tile above (`--ui-cta-sub` 56px, radius 14px, same hues, icon only, no caption) =
  **Construir**, 14px gap.
- Locked state (Zarpar before the Muelle exists): grey2 family, `filter:saturate(.25)`, and
  a small padlock overhanging the top-right. Tapping tells you the key: *"Construye el
  Muelle"* — never a dead tap.

**Green primary CTA** (Mejorar, Reclamar, Volver a la Isla, Terminar Ya) uses the green family
in two footprints:

| Footprint | Height | Radius | Label | Width | `--brk` |
|---|---|---|---|---|---|
| Wide pill (in-panel) | 52px | 12px | 20px | min 160px, pad 34px | 60% |
| Big bottom CTA | 64px | 16px | 24px | 62% of panel or 260px, centred, `24px + safe-b` from bottom | 52% |

**"Terminar Ya" variant** is a vertical stack, not a row: gem icon on top (28px, overhanging
the button's top edge by ~30% of its own height, cost numeral badged on its upper-left), then
a two-line label at 17px. Total 92×86. This shape is used **wherever a button spends gems**.

### 3.6 Icon button (utility)

- 56×56, `--ui-r-icon` 16px, 3px `--ui-ink`, `--brk` 52%.
- **Light utility** (Ajustes, Diario, Misiones): cream-warm grey family. Recedes against
  grass and sea without looking dead.
- **Mid-stone secondary** (inactive tab, "Quizá luego"): grey2 family.
- Icon at 60% of the tile, `drop-shadow(0 3px 3px rgba(0,0,0,.38))`.
- Badge anchors to the top-right (§3.8).

### 3.7 Featured tile — the ivory frame (`Cofres`)

✎ **Exactly one button on the HUD gets this treatment.** Clash uses it to mark the
monetisation entry without a badge. We have no IAP, so it marks our **premium-currency sink
and reward surface**: the chest tray, where gems buy time and chests pay out. If a shop is
ever added, the ivory moves there and Cofres loses it. It is never on two things at once.

```css
.tile--featured{
  --a:#FFD966; --b:var(--ui-gold-a); --c:var(--ui-gold-b); --d:#C3830E;
  --lip:var(--ui-gold-lip); --brk:47%;
  border:3px solid var(--ui-ink);
  background-clip:padding-box;
  box-shadow:
    inset 0 0 0 4px var(--ui-ivory),        /* the ivory frame — black outside, ivory in */
    inset 0 6px 0 rgba(255,255,250,.55),
    var(--ui-drop), var(--ui-cast);
}
```

Contents: chest art in the top 62%, caption `Cofres` at the bottom, plus a **mini timer
caption** (`3h 51m`, 13px `.num`) when a chest is unlocking, and a badge when one is ready.

Reuse the ivory frame on the **day-7 daily-reward tile** and nowhere else.

### 3.8 Notification badge

*"El badge rojo es media batalla de la retención"* — build it exactly.

```css
.badge{
  position:absolute; top:0; right:0; transform:translate(40%,-40%);
  min-width:24px; height:24px; padding:0 6px; border-radius:var(--ui-r-badge);
  display:grid; place-items:center;
  background:linear-gradient(180deg,#F0463C 0%,#F0463C 48%,#DD2016 48.01%,#C81A12 100%);
  box-shadow:0 0 0 2.5px var(--ui-badge-ring),   /* warm-white ring — the distinctive part */
             0 0 0 4px rgba(0,0,0,.55),
             0 3px 5px rgba(0,0,0,.4);
}
```

- **Rounded SQUARE** (radius 0.30 × height), widening to a stadium for 2+ digits. Never a circle.
- Numeral 15px `.num`, `--ui-txt-stroke-x`, `0 2px 0` drop, optically centred.
- **Breaks the host's silhouette** — ~40% hangs outside the top-right corner. Never tucked in.
- Entrance: scale 0 → 1.25 overshoot over 260ms, then **one** 6% pulse. Do not loop it.
- Cap at `9+` / `99+`.

**Strict rule:** a badge appears **only** for something *claimable in 1–2 taps*. Never for
"there is new content". Degrade it to a novelty marker and the player learns to ignore red
inside a week; the channel is then gone permanently.

Hosts: Diario (missions/events), Cofres (chest ready), mailbox, daily reward available,
Construir (free builder).

### 3.9 Collection bubble

The 1-second payoff for opening the app. Offline production is applied **before the first
frame**, so the bubble is already there in frame 1 — the island is never visually dead.

```
       ╭─────────╮      46×46, radius 11px (0.24 × side)
       │  ╭───╮  │      fill rgba(236,238,228,.78) — translucent, world reads through
       │  │ ◉ │  │      resource icon at ~70% of bubble width, own contour + specular
       │  ╰───╯  │      3px --ui-ink contour around square AND tail as ONE silhouette
       ╰───╮ ╭───╯      → build as a single SVG path or clip-path.
           ╲╱           14px tail, offset ~30% LEFT of centre (the reference offsets it)
```

- Appears as soon as the producer holds **≥1 unit**, not when it fills.
- Anchored in world space ~1.5 cells above the roof, screen-projected every frame, clamped
  to the viewport.
- Idle: bob ±4px on a 1.6s ease-in-out loop, **phase-offset per bubble** so they never sync.
- Tap → bubble `scale(1) → 1.25 → 0` over 160ms, bursts into 6 particles; a copy of the
  numeral (`+320`, `.num` 22px) flies along a quadratic bezier to the matching pill in 450ms
  ease-out, scaling 1.0 → 0.6 on the way; the pill flashes white at 30% opacity, the fill
  grows, and the counter **counts up over 300ms — it never jumps**.
- SFX: coin `chink`, pitch randomised ±2 semitones so five collections in a row do not sound
  identical.
- Min 48px tap target. When 4+ bubbles are pending, offer **Recoger Todo** (a green wide pill
  in the centre channel just above the clusters); below 4, never.

### 3.10 `¡Lleno!` label — the status chip

A deliberately quieter register. In a world where every actionable thing has a **solid**
contour, a **dashed** edge reads instantly as "information".

```css
.chip{
  height:30px; padding:0 12px; border-radius:var(--ui-r-chip);
  border:2px dashed rgba(20,16,12,.85);      /* ≈3px on / 3px off */
  background:rgba(255,255,255,.22);
  /* no shadow, no gloss, no animation */
}
```

Label 17px `.t`. Anchored in world space slightly right of and below the building's peak so
it never collides with a collect bubble on the same structure.

✎ **Our one departure: this chip is a button.** Tapping `¡Lleno!` opens the upgrade sheet for
the corresponding **storage** with the cost already visible and the green CTA at thumb
height. Clash wastes this slot on pure information and it is one of its most-complained-about
frictions; a 1-tap funnel to the upgrade that fixes it turns a scolding into a conversion.
The dashed border stays — the affordance is taught by the tooltip on first sight, once.

Reuse the same chip (non-interactive) for `Sin constructores`, `Almacén al máximo`,
`Reparando`.

### 3.11 Build/craft timer bar (world-anchored)

Direction encodes meaning: **stock drains leftward, progress grows rightward.**

```
              7m 17s          ← 18px .num, CENTRED, overlapping the bar's top edge by ~40%
        ┌──────────────────┐
        │████████░░░░░░░░░░│  20px tall, 130px wide, radius 999px, 3px --ui-ink
        └──────────────────┘  track --ui-track-well; fill grows LEFT→RIGHT
          rounded left cap ↑    flat right edge at the growing end ↑
```

- Fill: `linear-gradient(180deg, var(--ui-timer-a) 0 55%, var(--ui-timer-b) 55.01% 100%)`.
- The building wears wooden scaffolding + intermittent dust particles; a low-volume carpenter
  hammer every ~4s when the camera is close.
- Tap the bar → the **Terminar Ya** gem stack (§3.5) appears anchored below it.
- **On completion:** white flash, scaffolding disassembles over 400ms, the building does a
  squash-and-stretch (0.9 → 1.08 → 1.0), a dust ring expands, and a **green ✓ bubble** appears
  that must be tapped to "inaugurate" the building (that tap grants XP).
  The loop must never leave a gap where the building shows nothing.

### 3.12 Timer row (inside a panel)

The list form, used in the Builders panel and the Cofres tray.

```
┌──────────────────────────────────────────────────────────────┐
│ ╭────╮  Ayuntamiento  Nv 2                        ╭─────────╮│
│ │ 🏠 │  ▓▓▓▓▓▓▓▓▓░░░░░░░░░  7m 17s                │ ◆ 12    ││  ← Terminar Ya
│ ╰────╯                                            │Terminar ││     (gem stack)
│                                                   ╰─────────╯│
└──────────────────────────────────────────────────────────────┘
   64px art tile          progress bar, left→right       92×86 green
```

- Row height 96px, sits inside a `--ui-well` inset panel, separated by 1px `rgba(255,255,255,.10)`.
- Art tile 64×64, radius 12px, blue face, 2px dark stroke, 1px cyan rim, white radial halo behind.
- Title 20px `.t`; the bar is the §3.11 fill treatment at 16px height, full row width minus the CTA.
- An idle builder row shows the `Sin constructores`-style chip and a green **Asignar** pill.

### 3.13 Chest slot & tray

Four slots from the start, **but only one unlocks at a time** — that Clash Royale restriction
is what creates the pressure.

| State | Presentation |
|---|---|
| Empty | Dashed 2px `rgba(255,255,255,.35)` square, radius 12px, translucent black interior, faint anchor glyph at 30% |
| Waiting | Chest art at rest, plus a green **Empezar** wide pill under it. Disabled (grey2) while another chest is unlocking, with the chip `Solo un cofre a la vez` |
| Unlocking | Chest art, §3.11 timer bar under it, remaining time above; the slot border gains a 1px warm glow |
| Ready | Chest art bobs ±4px @0.9s, gold radial glow behind it, red badge `1`, and the slot pulses once every 2.5s |

- Slot 62×78 (landscape inline tray) / 76×96 (portrait tray panel, 2×2 grid).
- **Portrait collapses the tray into the Cofres tile** (§3.7) carrying the badge and the
  shortest running timer as a caption; tapping opens the tray as a tier-1 panel.
  ✎ Four 62px slots plus gutters do not fit the 174px centre channel on a 390pt screen, and
  shrinking them below 48px breaks the tap-target floor.
- Landscape shows the four slots inline bottom-centre.

### 3.14 Close button — red X

The most repeated element in the game.

- **48×48, radius 11px** (0.23 × side) — a rounded square, never a circle. `--brk` 59%.
- Red family. The gloss is visibly an **inset panel**: it stops ~4px short of the left and
  right contour so a sliver of deep base red frames it.
  ```css
  .btn-x::before{ content:''; position:absolute; inset:3px 4px auto 4px; height:52%;
    border-radius:8px 8px 4px 4px;
    background:linear-gradient(180deg,var(--ui-red-gloss-a),var(--ui-red-gloss-b)); }
  ```
- Glyph: heavy white `X`, 26px, `--ui-txt-stroke-x`, `0 2px 0` drop, nudged up 1px.
- **Floating panel:** top-right corner, `transform:translate(40%,-40%)` so it **overlaps and
  breaks** the panel's corner. Never sitting politely inside the header.
- **Full-screen page:** pinned top-right at `12px + var(--ui-safe-t)`, on the letterbox strip.
- Hit area padded to 56×56.

### 3.15 Confirm / cancel pair (build placement)

Two 56×56 rounded squares (radius 13px), 22px gap. Left = red X, right = green ✓
(`--ui-ok-*` family, `--brk` 48%, fat white check 30px, `--ui-txt-stroke-x`, tilted so the
long arm rises steeply).

| Orientation | Placement |
|---|---|
| Landscape | Float above the ghost, anchored in **world space** (Clash exactly) |
| **Portrait** | ✎ **Anchored to a bottom bar**, never to the object |

**Portrait build bar** (replaces the Zone C clusters while placing):

```
╔═══════════════════════════════════════════════════════════════╗
║   Aserradero · 400 madera · 5m                                ║  ← 15px body on colour
║  ┌──────┐                                        ┌──────┐     ║
║  │  ✗   │ 64                                     │  ✓   │ 64  ║
║  └──────┘                                        └──────┘     ║
║ ░░░░░░░░░ env(safe-area-inset-bottom) ░░░░░░░░░░░░░░░░░░░░░░░ ║
╚═══════════════════════════════════════════════════════════════╝
   full width · height 96 + safe-b · bg rgba(23,19,14,.72) · 1px light top rim
   ✗ at left:24  ·  ✓ at right:24  ·  both 64×64 (up from 56 — they are the whole bar)
```

A confirm button in the top third of a portrait phone is unreachable one-handed; the player
drops the phone or abandons the placement. **Hard rule: no primary action above 55% of
viewport height, ever.**

Supporting elements, both orientations:
- Valid footprint: translucent bright-green quad on the ground, `--ui-grid-ok`, additively
  blended, 2px lighter-green edge. Blocked: `--ui-grid-bad`.
- Four chunky chevrons in `--ui-arrow` with a 2px `--ui-ink` contour, one per diagonal, just
  outside the footprint corners, pulsing outward on a 1.2s loop.
- A soft white radial vignette brightens the placement area and darkens the rest of the
  island by ~12% — an elliptical spotlight, clearly visible in `coc_build_mode.jpg`.
- Haptic: short tick (`vibrate(6)`) on crossing each cell; a distinct double tick
  (`vibrate([12,40,12])`) plus the red footprint on entering an invalid cell.

### 3.16 Modal tier 1 — floating panel

For events, rank ladder, building info, chest tray, builders.
**The game stays fully visible and UNDIMMED around it.** No scrim. No backdrop blur. The
reference shows the village at full brightness and sharpness on both sides of the panel.

```css
.panel{
  background:var(--ui-panel);
  border-radius:var(--ui-r-panel);
  border:var(--ui-frame-w) solid var(--ui-frame);
  box-shadow:
    0 0 0 3px var(--ui-frame-dark),         /* outer near-black stroke */
    inset 0 0 0 1px rgba(255,255,255,.55),  /* light rim inside the frame */
    0 10px 0 rgba(0,0,0,.22),
    0 20px 44px rgba(0,0,0,.55);
}
```

That three-layer edge — near-black outside, taupe band, light inner rim, then cream — **is**
the "thick ornamental border". It is not one fat stroke.

| | Portrait | Landscape |
|---|---|---|
| Width | `100% − 24px` | 78vw |
| Anchor | top-anchored under the tab rail | centred |
| Max height | `84vh`, body scrolls internally | `86vh` |

Entrance: `scale(.88) → 1` with a 1.03 overshoot, 220ms `cubic-bezier(.2,1.3,.4,1)`;
opacity 0 → 1 over the first 120ms only.

### 3.17 Panel header

**There is no separate header bar.** The title sits directly on the cream.

```
┌──────────────────────────────────────────────────────────┐
│  ░╭───╮░                                      ░╭───╮░  ╔═╗│ ← close X overlaps
│  ░│art│░        Constructores                 ░│art│░  ║X║│    the corner
│  ░╰───╯░                                      ░╰───╯░  ╚═╝│
│ ──────────────────────────────────────────────────────── │ ← 1px rgba(0,0,0,.12)
│  ┌────────────────────────────────────────────────────┐  │
│  │  --ui-well content, radius 12px, margin 0 10px      │  │
```

- Title block height ≈ 96px (portrait 84px). Title 30px `.t`, centred.
- **Illustrated props bleed in from each side at ~30% opacity**, behind the title (a cannon
  and a tower in `coc_builders.jpg`). Use our voxel renders — a barrel and a capstan.
- A 1px `rgba(0,0,0,.12)` hairline separates the header from the body. Nothing else.
- Body list content goes in a `--ui-well` inset panel:
  `border-radius:12px; margin:0 10px; box-shadow:inset 0 2px 6px rgba(0,0,0,.5);`

### 3.18 Modal tier 2 — full-screen page

For Gemas, Diario, Rangos. This is a **page**, not a dialog. **No border, no radius, no
shadow** — a full-screen page has no edges to ornament. Applying the tier-1 frame here
produces a panel-inside-a-panel that looks nothing like the reference.

Vertical anatomy, top to bottom:

| Band | Spec |
|---|---|
| 1. Letterbox | `--ui-letterbox`, `62px + var(--ui-safe-t)`, carries the tab rail; close X floats at its top-right |
| 2. Tab rail | 64×58 rounded-top tiles. **Portrait: `overflow-x:auto; scroll-snap-type:x mandatory`**, no visible scrollbar, min tab width 84px, active tab auto-scrolls into view. Never wraps |
| 3. Title band | `--ui-panel` cream, 90px (portrait 78px), centred 30px title, art bleeding from the sides |
| 4. Body | `--ui-page`. Landscape: horizontally scrolling card row. **Portrait: 2-column grid** |
| 5. Wallet footer | §3.2, pinned, `62px + var(--ui-safe-b)` |

### 3.19 Tab strip

| | Inactive | Active |
|---|---|---|
| Fill | `--ui-tab-off` | `--ui-panel` (identical to the panel body) |
| Height | 50px | 58px |
| Radius | `14px 14px 0 0` | `16px 16px 0 0` |
| Top edge | sits **8px lower** than active | — |
| Contour | 3px `--ui-ink` top + sides | 3px top + sides, **no bottom border** |
| Rim | 1px `rgba(255,255,255,.45)` top inside | 2px `#FFFFF8` top inside |
| Gloss | subtle, over the top 25% only | subtle |
| Overlap | — | overlaps the panel by 2px so the two shapes **merge into one silhouette** |

Labels 19px `.t`, white with full outline on **both** states — the reference does not switch
the active label to dark. An inactive tab is not a flattened active tab; it is the same
object in taupe, sitting lower.

Sub-filters use a segmented control: one dark stadium track holding two pills, active filled
green, inactive `#5A5A57`, both with 2px contours.

### 3.20 Card (reward pack / building option / offer)

- Portrait: 2-up grid, `aspect-ratio:3/4`, 10px gutter. Landscape: horizontal scroller, 230px wide.
- Shell: `--ui-r-card`, **3px hue-matched dark stroke** (`--ui-blue-stroke` on blue, deep
  amber on gold) — cards get a tinted contour, not the universal `--ui-ink`. Plus
  `inset 0 0 0 1px var(--ui-blue-rim)` and `0 6px 0 rgba(0,0,0,.22), 0 12px 20px rgba(0,0,0,.4)`.
- Face: vertical gradient of the family, **plus a white radial starburst behind the product
  art**: `radial-gradient(circle at 50% 52%, rgba(255,255,255,.55) 0%, transparent 58%)` with
  12 faint conic rays over it. Every valuable card in Clash has this halo.
- **Header band**: darker band of the same hue (`--ui-gold-deep` on gold), 18% of card height,
  rounded top corners only, title 20px, 1px light hairline below it.
- **Title colour follows the card hue**: lime `#A6F02B` with a dark green outline on a blue
  card; white on gold. Body numerals never change colour.
- Contents tiles: rounded squares, radius 12px, blue face, 2px dark stroke, 1px cyan rim, one
  item render on its own radial glow, quantity as a small pill lower-left.
- Cost footer: inset `rgba(0,0,0,.30)` panel, radius 10px, inset 8px from sides and bottom,
  cost at 24px `.num`. **Red `#D93A2B` when it is a price you pay; white when it is a quantity
  you receive.**
- Info `i`: 30×30 blue rounded square, radius 8px, 2px `--ui-ink`, white outlined `i`,
  bottom-right of the card (or top-right of a list row).

### 3.21 Reward tile (chest / claim grid)

From `cr_chest_reward.jpg` — the canonical reward object.

- `aspect-ratio:4/5`, `--ui-r-tile` 10px, 3-column grid, 12px gutter.
- **Frame: a 3px bevelled border whose COLOUR encodes rarity**, lighter along the top edge and
  darker along the bottom (`::before` ring with `linear-gradient(180deg,#EAF0F5,#8E9AA6)`
  tinted by the rarity token). Outside it: 1px `#0A1830`, then
  `0 4px 0 rgba(0,0,0,.3), 0 8px 12px rgba(0,0,0,.45)`.
- **The art bleeds to the frame.** No padding, no background swatch behind the item. The art
  *is* the tile.
- Count label: **bottom-centre, overlapping the art**, `x1` / `x4` / `+120`, 22px `.num`,
  0.20em stroke, `0 3px 0` drop. Always bottom-centre, never a corner.
- **Rarity is expressed only by frame colour and reveal intensity.** Never tint the art or the
  background. This scales to any number of tiers for free.

### 3.22 Modal tier 3 — celebration (the reward moment)

**Clash's biggest reward moments have no panel at all.** Victory and the chest opening place
their content directly on a dimmed or plain background with zero card, border or radius. That
absence is what makes them feel like an event rather than a dialog. Wrapping a reward screen
in panel chrome is the single biggest way to kill the moment the whole retention loop is
built around.

**A. Post-expedition victory** (`coc_victory.jpg`):
1. `--ui-scrim` over the **entire view including the HUD** — the pills darken with everything
   else. The scrim is at `--z-celebrate`, above `--z-hud`.
2. **Three anchors** (our stars) arc across the top, centre one larger and higher. Chunky, 3px
   contour, steel-white gloss, hard drop. They pop in one at a time, 180ms apart, each with a
   scale overshoot to 1.3 and a white radial flash.
   Criteria: carga al 100% · sin hundirte · bajo tiempo.
3. **Gold ribbon banner** beneath: horizontal band `--ui-gold-a → --ui-gold-b`, folded notched
   tails hanging past both ends, 3px contour, headline `¡Botín!` in **`--ui-gold-text` (gold
   fill, not white)** at 34px with full outline + drop.
4. `Botín:` micro-label, then a **plain unboxed list**: `[numeral] [icon]` rows, 30px numerals
   **left of the icon**, separated by 1px `rgba(255,255,255,.28)` hairlines spanning the
   content width. No card, no background. Rows count up, staggered 200ms, one chime each.
   Last row: Notoriedad ganada.
5. One green big-bottom CTA: **Volver a la Isla**.
6. ✎ **The loot does not go straight into storage — it lands on the island as collect
   bubbles.** This chains the sea loop back into the island loop instead of terminating it:
   you come back from the sea and there is already work waiting.

**B. Chest opening** — its own scene, no game visible:
- Background `radial-gradient(ellipse at 50% 32%, var(--ui-navy-b), var(--ui-navy-a))`, a faint
  44px diamond lattice at `rgba(255,255,255,.03)`, and a vignette.
- Chest at ~30% height, oversized, hard elliptical contact shadow, rocking ±4° on a 900ms
  ease-in-out loop.
- Tap → 3 shakes of increasing amplitude, light escaping the seams → lid bursts, full-screen
  white flash 80ms, radial rays, 6px screen shake for 0.2s.
- `¡Botín!` fades in, then `Lo has conseguido:` micro-label in muted light blue `#7FB2E0`, 14px.
- 3-column reward-tile grid, tiles dealt **one at a time, 220ms apart**, each `scale .4 → 1.15
  → 1` over 180ms with a white radial flash, chime one semitone higher than the last.
- **A rare tile breaks the cadence**: 700ms pause, the tile spins on its axis, colour burst by
  rarity, low bass hit, particles. The break is what makes the memory stick.
- Tap anywhere = skip to the end; the rest land at once. **Never block the player.** No close X
  until every tile has landed.

**C. `La isla resistió`** — return after ≥72h absence. ✎ Our own piece; the highest-return gap
in `RETENTION.md`.
- Before the HUD: aerial shot of the island in dawn light, gold ribbon `La Isla Resistió`.
- One count-up list of everything accumulated (all producers, ready chests, expired missions
  converted to resources), a gift **Cofre de Plata** that places itself in a free slot, and one
  green CTA: **Recoger Todo**.
- On tap, **every bubble on the island bursts in a 60ms cascade** with the number rain. This is
  the most spectacular moment the game can stage for free, with resources that were already
  generated.
- The streak is shown **frozen, not lost**: `Racha en pausa · día 4`.

### 3.23 NPC guide (el contramaestre)

- Half-body portrait entering from the **left edge** in landscape, from **bottom-left** in
  portrait (never covering the Zone C clusters).
- Speech bubble: ship's-sail shape with a rope border, cream fill, 3px `--ui-ink`, body 15px
  on cream.
- **One thick orange arrow** with a hard shadow, pointing at the single valid target, pulsing
  at 1Hz with ±10% scale.
- Everything except the target is non-interactive and dimmed at `--z-guide`; the target is
  promoted to `--z-guide-target`.
- Reused reactively: after **>20s without a clear objective**, the contramaestre surfaces the
  top entry from the next-action resolver (§4.8).

---

## 4. Hooks and balance

Every number below belongs in `src/data/balance.json`. This document is the source of truth
until that file exists. The UI never hard-codes a number that appears here.

### 4.1 Staged resource reveal

Clash starts with two currencies, not four. Four full bars on the first screen is noise a new
player cannot read, and in portrait it eats the width.

| Stage | Pills visible | Rows |
|---|---|---|
| Start | Madera, Oro, Gemas | 3 (14% of height) |
| Ayuntamiento 2 | + Ron | 4 |
| Ayuntamiento 4 | + Metal | 5 (24% of height) |

A new pill **slides in from the right and settles** with a 1.06 overshoot, and the
contramaestre names it once.

### 4.2 Two separate caps — the mechanic `RETENTION.md` fuses by mistake

Each producer accumulates to **its own internal capacity** and stops (`¡Lleno!`). Collecting
moves the resource to the **store**, which has a different cap. Two independent upgrade
decisions; that tension is half the economy. Fill time = internal capacity ÷ rate, and it is
what sets the session cadence: **3h early → 4–6h mid → 12h late** (3 sessions/day → 2 → 1).

**Producers**

| Aserradero (madera) | /h | Cap | Cost | Time |
|---|---|---|---|---|
| Nv1 | 200 | 600 (3h) | free (tutorial) | — |
| Nv2 | 320 | 960 | 400 madera | 5m |
| Nv3 | 500 | 1 500 | 1 200 madera | 30m |
| Nv4 | 750 | 3 000 (4h) | 3 000 madera | 2h |
| Nv5 | 1 100 | 4 400 | 8 000 madera | 6h |
| Nv6 | 1 600 | 9 600 (6h) | 20 000 madera | 12h |
| Nv7 | 2 300 | 13 800 | 50 000 madera | 1d |
| Nv8 | 3 200 | 38 400 (12h) | 120 000 madera + 20 000 oro | 2d |

Allowed count: 1 (Ayto 1) · 2 (Ayto 2) · 3 (Ayto 3) · 4 (Ayto 4) · 5 (Ayto 6).

| Mercado (oro) | /h | Cap | Cost | Time |
|---|---|---|---|---|
| Nv1 | 150 | 450 (3h) | 250 madera | 1m |
| Nv2 | 240 | 720 | 750 madera | 15m |
| Nv3 | 380 | 1 140 | 2 000 madera | 1h |
| Nv4 | 560 | 2 240 (4h) | 5 000 madera | 3h |
| Nv5 | 850 | 3 400 | 12 000 madera | 8h |
| Nv6 | 1 250 | 7 500 (6h) | 30 000 madera | 16h |
| Nv7 | 1 800 | 10 800 | 70 000 madera | 1d 12h |
| Nv8 | 2 500 | 30 000 (12h) | 150 000 madera + 30 000 oro | 2d 12h |

Count: 1 · 2 (Ayto 2) · 3 (Ayto 4) · 4 (Ayto 6).

| Destilería (ron, Ayto 2) | /h | Cap | Cost | Time |
|---|---|---|---|---|
| Nv1 | 120 | 480 (4h) | 1 000 madera | 15m |
| Nv2 | 200 | 800 | 2 500 madera | 1h |
| Nv3 | 320 | 1 280 | 6 000 oro | 4h |
| Nv4 | 480 | 2 880 (6h) | 15 000 oro | 10h |
| Nv5 | 700 | 4 200 | 35 000 oro | 20h |
| Nv6 | 1 000 | 12 000 (12h) | 80 000 oro | 2d |

| Fundición (metal, Ayto 4) | /h | Cap | Cost | Time |
|---|---|---|---|---|
| Nv1 | 40 | 480 (12h) | 25 000 madera | 8h |
| Nv2 | 65 | 780 | 60 000 oro | 18h |
| Nv3 | 100 | 1 200 | 120 000 oro | 2d |
| Nv4 | 150 | 1 800 | 250 000 oro | 3d |

Metal is for defences and hulls only — **never on the Ayuntamiento critical path.**

**Stores**

| Level | Almacén (madera) | Banco (oro) | Bodega (ron) | Depósito (metal) |
|---|---|---|---|---|
| 1 | 2 000 (free) | 1 500 (free) | 1 000 | 1 000 |
| 2 | 6 000 · 1 000 mad · 20m | 5 000 · 1 200 mad · 20m | 4 000 | 3 000 |
| 3 | 15 000 · 3 500 · 2h | 12 000 · 4 000 · 2h | 10 000 | 8 000 |
| 4 | 40 000 · 9 000 · 6h | 32 000 · 10 000 · 6h | 25 000 | — |
| 5 | 100 000 · 25 000 · 16h | 80 000 · 28 000 oro · 16h | 60 000 | — |
| 6 | 250 000 · 60 000 oro · 1d 12h | 200 000 · 70 000 oro · 1d 12h | — | — |

> **STORE INVARIANT — must be a build-failing test.** For every Ayuntamiento level *N*, the
> total reachable capacity of each resource must exceed the most expensive cost the player can
> need at that level **by ≥25%**. If Ayto 4 costs 45 000 madera and the reachable cap is
> 40 000, the player is sealed in with no exit and no shop to sell them one. Write a test that
> walks the cost tables and fails the build if the invariant breaks.

**Ayuntamiento**

| Nv | Cost | Time | Unlocks |
|---|---|---|---|
| 1 | — | — | Aserradero, Mercado, Almacén, Banco, Muelle |
| 2 | 1 000 madera | 10m | Destilería, Tablón de Misiones, 2º Aserradero/Mercado |
| 3 | 4 000 madera | 1h | Astillero, cañón costero, 4º hueco de cofre |
| 4 | 18 000 oro | 4h | Fundición, Metal, defensas, Recoger Todo |
| 5 | 60 000 oro | 12h | mortero, Sloop, sistema de amenaza |
| 6 | 180 000 oro | 1d | 4º constructor comprable, temporadas |
| 7 | 450 000 oro | 2d | — |
| 8 | 1 000 000 oro | 3d 12h | — |

Ayto 3 is 1h where Clash charges 3h — we have no shop selling the shortcut, so we do not
manufacture the pain.

### 4.3 Builders — start with TWO

| Builder | Gem price | Free route |
|---|---|---|
| 1–2 | — | from the start |
| 3 | 500 💎 | complete the "Isla Habitada" mission chain (hito 20) |
| 4 | 1 200 💎 | Ayto 6 + "Bahía Fortificada" chain |
| 5 | 2 500 💎 | Ayto 8 + achievement |

**Design guarantee: every gem price has a playable route.** A steady player reaches 4 builders
in ~3 weeks. Plus a **24h "carpintero de guardia"** granted at 2:25 of the first session,
which makes day one abundant and expires without the player ever noticing it was a crutch.

### 4.4 Gem speed-up formula

| Remaining | Cost |
|---|---|
| ≤ 1 min | **1 💎** |
| ≤ 1 h | `1 + ceil(min × 0.35)` → 1h ≈ 22 💎 |
| ≤ 1 d | `20 + ceil((min − 60) × 0.10)` → 12h ≈ 86 💎, 1d ≈ 155 💎 |
| > 1 d | `150 + ceil((h − 24) × 3.5)` → 3d ≈ 318 💎 |

Round to a pretty number when displaying.

> **GOLDEN RULE: the last 5 minutes of ANY timer cost 1 gem. Always, everywhere.** It is the
> most habit-forming number in Clash and it is free for us. It teaches gems→time at a price
> that cannot hurt, at the moment it makes the player happy rather than frustrated.

### 4.5 Chests

Four slots from the start; **only one unlocks at a time.**

| Chest | Timer | Oro | Madera | 💎 | Fragmentos |
|---|---|---|---|---|---|
| Madera | 15m | 120–200 | 200–320 | 0 | 0–1 |
| Bronce | 1h | 400–650 | 600–900 | 0–2 | 1–2 |
| Plata | 3h | 1 200–1 800 | 1 800–2 600 | 2–4 | 2–4 |
| Oro | 8h | 4 000–6 000 | 5 000–7 500 | 6–10 | 5–9 |
| Capitán | 12h | 12 000–16 000 | 14 000–20 000 | 15–25 | 12–20 |
| Leyenda | 24h | 40 000–55 000 | 45 000–65 000 | 40–70 | 30–50 + 1 skin guaranteed |

Sources: **Cofre Libre** one every 4h at the Muelle, stacking to 2 (you can be away 8h with no
loss, but not 24h — that gap *is* the return pressure), contents ≈ Bronce · **Cofre de la
Corona** at 10 coronas, 3/day from daily missions → ~3.3 days, contents ≈ Oro · expeditions:
Madera/Bronce in ring 1, Plata/Oro in ring 2, Capitán on bosses · defended raid: Plata
guaranteed, Oro if you take no losses · progression chain: Capitán at hito 20.

### 4.6 Daily reward — 7 days, chained

| Day | Reward |
|---|---|
| 1 | 500 madera |
| 2 | 400 oro |
| 3 | 10 💎 |
| 4 | Cofre de Plata *(places itself in a slot — chains into the chest loop)* |
| 5 | 1 500 madera + 1 200 oro |
| 6 | 25 💎 |
| 7 | **Cofre de Capitán + 1h de constructor instantáneo** |

Weekly multiplier ×1 / ×1.4 / ×1.9 / ×2.5 (capped at week 4).

UI: a thumb-scrollable horizontal row of 7 wooden cards. Current day gold-framed and glowing;
past days carry a burned check stamp; future days dimmed **but legible**. **Day 7 is always
drawn with the ivory frame, its Cofre de Capitán art and its contents written out — visible
from day 1.** That turns six mediocre rewards into six rungs toward a good one (goal-gradient).

The panel **auto-opens before anything else** on the first launch of each calendar day: the
player is paid before they work. Claiming spins the card and flies the prize to its bar. On
close, a fixed line: **`Vuelve mañana: 400 oro`** — the concrete prize, named.

> **The streak PAUSES, it does not reset.** Missing a day freezes progress. Plus one free
> "pase de tormenta" per month that retroactively saves one missed day. Punishing a solo
> player with a reset on the exact day they are deciding whether the game treats them well
> produces one thing: a reason to uninstall.

### 4.7 Other taps

| Hook | Numbers |
|---|---|
| **Daily missions** | 3 active, refresh at **04:00 local** (not midnight — midnight punishes the 23:55 player, who is the most engaged one). Each: 1 corona + 8 💎 + a pile of resource. Pool weighted by Ayto level |
| **Obstacles** | Cost 0, 1 builder, 30s (small) → 15m (large). Yield 5–40 madera + 0–6 💎 (~25% gem chance). One respawns every 8h, max 12 on the island. Their real job is forcing the player to *look at their island* every session |
| **Gem budget** | Sustained target **35–50 💎/day**: daily 5–50 · 3 missions × 8 = 24 · obstacles ≈ 9/day · achievements 10–500 one-off · season pass ≈ 250 per 4-week season. **First week ≈ 600 💎** — generous speed-ups without reaching builder 3, which must stay a goal |
| **Weekly event** | Always exactly one active, 7 days. Objective ~15 units (2–3/day). Rewards: 400 resource + 20 💎 + 1 themed item, **all three visible before starting**. Rotates the ship families we already have: Vikingos, No-muertos, Anubis |
| **Rangos de Capitán** | Grumete 0 · Marinero 400 · Contramaestre 800 · Navegante 1 400 · Capitán 2 000 · Corsario 2 600 · Leyenda 3 400. 3 divisions each; **each division = +2% permanent offline production (+42% at cap)**. Notoriety decays 2%/day if you do not sail, never below the floor of the rank already reached. Season-end chest scaled to rank |
| **XP** | `sqrt(build_seconds)` per completed build, +10 per obstacle, + per mission. **Unlocks nothing** — it is the free "you progressed" signal for sessions where nothing else finished |
| **Offline grace** | The limit is the producer's own cap (3–12h), never an artificial rule. For the first **14 days** of absence, 100% of every producer's cap is paid. Scarcity comes from the machine, never from punishing the player for living |
| **Raid loss cap** | Never more than **10% of the current stock of ONE resource**, with a floor below which nothing is taken. Never building levels, never gems. Afterwards: a 30–60 min **repairs** timer (not a shield) plus a war-loot chest **win or lose** — both outcomes leave a timer running and something to collect |

### 4.8 The next-action resolver — a mechanism, not a good intention

`RETENTION.md`'s closing test is a question. Make it code. On every session start and after
every state change, evaluate in order and surface the first hit:

| # | Condition | Surfaced as |
|---|---|---|
| 1 | free builder > 0 | badge + blink on **Construir**; tooltip from the builder chip after 30s |
| 2 | no chest unlocking and a chest is waiting | badge on **Cofres** |
| 3 | claimable mission / daily reward | badge on **Diario** |
| 4 | ≥2 producers at cap | amber pulse on that resource pill; `¡Lleno!` chips are already up |
| 5 | all producers < 20% and nothing building | contramaestre suggests an expedition; **¡Zarpar!** pulses |

**The solution must always be reachable in ≤2 taps.** If the resolver returns nothing, the
loop is broken and that is a bug — log it.

### 4.9 Local notifications (PWA, no server)

The delivery channel for every hook above, and completely absent from `RETENTION.md`.
**Hard cap: 2 per day. Never 3.** Past that the app is silenced and the channel is gone
permanently. Settings exposes a master toggle plus per-type switches.

| # | Trigger | Condition |
|---|---|---|
| 1 | Build finished | only if the player has been away > 1h |
| 2 | Producers full | fires when the **last** one fills; max 1/day |
| 3 | Free chest ready | only if no session in 6h |
| 4 | Daily reward | 1/day at the **modal play hour learned from the last 7 sessions** — never a fixed 09:00 |
| 5 | ≥72h absent | one `La isla resistió` notification, then total silence |

### 4.10 First session — the beat sheet the HUD must support

Every tap is pre-financed; the tutorial is **resumable at the exact beat** if the player closes
at 0:45. The first producer is **pre-seeded** so no bubble is ever empty.

| t | Beat | HUD requirement |
|---|---|---|
| 0:00 | Camera flies over the sea, 3s, skippable | first possible tap **before second 4** |
| 0:03 | Island lands; contramaestre enters bottom-left | guide layer + dim |
| 0:08 | Orange arrow on a green ghost cell → Aserradero, cost waived | build ghost + footprint |
| 0:20 | Bubble already there, **pre-seeded with 60 madera** | §3.9 |
| 0:32 | Mercado placed free; +250 oro | mission banner from the top |
| 0:45 | Upgrade sheet slides **from the bottom**; player has 950 of 1 000 madera — **50 short on purpose** | bottom sheet, green CTA at thumb height |
| 1:05 | Upgrade starts; builder chip goes 1/2 with the **second builder blinking** | §3.4 |
| 1:15 | Muelle placed, 1m timer — two timers on screen at once | §3.11 ×2 |
| 1:25 | A Cofre de Madera drops onto the dock | badge `1` on Cofres |
| 1:32 | Chest is **pre-aged to 4 min left** so "Abrir ahora" costs exactly **1 💎** of the starting 5 | §3.5 gem stack + orange arrow |
| 1:40 | Full chest-opening scene — **the emotional peak lands at 1:40** | §3.22B |
| 1:50 | Daily reward auto-opens; day 7 drawn with its contents | §4.6 |
| 2:05 | Badge `3` on Misiones; two already complete | §3.8 |
| 2:25 | The builder wall is **exposed on purpose**, then a 24h temp builder is gifted | `Sin constructores` chip |
| 2:40 | Obstacle cleared → 3 💎 with sparkles | teaches free gems forever |
| 2:50 | ¡Zarpar! shown dimmed with the key named aloud | locked CTA state |

**Exit state at 3:00 — the real deliverable of the session.** Six reasons to return across
three time scales: (1) Ayuntamiento building, 8m 12s; (2) Muelle finished with an untouched ✓
bubble; (3) Aserradero bubble at 35% and visibly rising; (4) chest slot 2 brewing at 3h 51m;
(5) tomorrow's reward named with its figure; (6) one closed door (Zarpar) with the key said
out loud.

---

## 5. Motion

Chunky physicality is as much motion as it is pixels. Every rule follows from the drawn light
and weight.

| Object | From → To | Duration | Easing |
|---|---|---|---|
| Tier-1 panel in | `scale(.88) → 1`, overshoot 1.03 | 220ms | `cubic-bezier(.2,1.3,.4,1)` |
| Tier-1 panel out | `scale(1) → .92`, opacity → 0 | 140ms | `ease-in` |
| Tier-2 page in | slide up 24px + opacity | 200ms | `cubic-bezier(.2,.9,.3,1)` |
| Badge in | `scale(0) → 1.25 → 1` | 260ms | `cubic-bezier(.2,1.5,.4,1)` |
| Badge idle | one 6% pulse, then hold | 300ms | — |
| Button press | `translateY(4px)`, shadow 6px → 2px | 60ms | `ease-out` |
| Counter change | `scale(1) → 1.15 → 1` | 120ms | `ease-out` |
| Counter count-up | ticks over the value | 400–600ms | `ease-out`, **never linear** |
| Bubble idle | ±4px bob, phase-offset per bubble | 1.6s loop | `ease-in-out` |
| Bubble tap | `scale → 1.25 → 0` + 6 particles | 160ms | `ease-in` |
| Number flight | quadratic bezier to the pill, `scale 1 → .6` | 450ms | `ease-out` |
| Reward tile reveal | `scale(.4) → 1.2 → 1` + white radial flash | 180ms, **220ms apart** | `cubic-bezier(.2,1.4,.4,1)` |
| Victory anchor pop | `scale → 1.3 → 1` + flash | 200ms, **180ms apart** | `cubic-bezier(.2,1.5,.4,1)` |
| Free-builder blink | ±8° tilt + gold halo | every **2.5s** | `ease-in-out` |
| Chest ready bob | ±4px | 0.9s loop | `ease-in-out` |
| Chest pre-open | 3 shakes, increasing amplitude | 600ms total | — |
| Chest burst | white flash 80ms + 6px screen shake 200ms | — | — |
| Drag chevrons | pulse outward 6px | 1.2s loop | `ease-in-out` |
| Build complete | squash-stretch `.9 → 1.08 → 1`, dust ring | 400ms | `cubic-bezier(.3,1.6,.4,1)` |
| New pill reveal | slide in from right, overshoot 1.06 | 280ms | `cubic-bezier(.2,1.3,.4,1)` |

**Laws:**

1. **Nothing fades in.** Things arrive by scaling with an overshoot. Opacity moves only during
   the first ~50% of the scale.
2. **Buttons travel down, not in.** Press = translateY into the object's own extrusion shadow.
   No scale, no hue shift, no ripple.
3. **Numbers punch.** Any counter that changes does a 1.15 scale and settles. Count-ups ease
   out. A silently mutated counter is a bug.
4. **Collection is a flight.** Value moves along a visible arc from source to destination and
   the destination reacts on arrival. This is what makes it feel physical.
5. **One thing moves at a time.** Sequence reward reveals 140–220ms apart rather than
   animating a grid together. Tension between tiles is where the dopamine lives.
6. **Idle attention loops are slow and sparse.** Free builder every 2.5s; a ready chest bobs;
   a badge pulses once on arrival and then holds. Continuous fast animation reads as broken,
   not urgent, and stops being read within a session.
7. **Haptics pair with weight**: `vibrate(8)` on a button press, `vibrate(6)` per cell crossed
   in build mode, `vibrate([12,40,12])` on an invalid cell, `vibrate(20)` on a chest burst.

**`prefers-reduced-motion: reduce`** — keep every state change and every sound; replace travel
and overshoot with 100ms cross-fades; hold bubbles, chests and badges still; drop the screen
shake entirely. The reward moments must still *happen*, just without the travel.

**Performance:** animate only `transform`, `opacity` and `filter`. World-anchored elements are
positioned with a single `transform: translate3d()` written once per frame from the projection
pass — never with `left`/`top`. Cap simultaneous number-flights at 8; beyond that, batch.

---

## 6. Anti-goals — what makes this a web page instead of Clash

Each of these is a real failure mode, ordered by how quickly it gives the game away.

| # | Do not | Why |
|---|---|---|
| 1 | Use a **smooth top-to-bottom gradient** on buttons instead of the hard gloss step at ~50% | The number-one tell. The reference shows a discrete jump (Brew: `#96D23F` at y271 → `#85C82D` at y272). A smooth ramp is a 2010 web button |
| 2 | Fill **resource bars left-to-right** | They are right-anchored and drain leftward — verified by pixel sample across three screenshots. Build **timers** do grow left-to-right; direction encodes stock vs. progress |
| 3 | Make the empty track an **opaque grey** | It is translucent white over the live 3D scene. Opaque tracks sever the HUD from the world and are why most clones look like a website pasted over a game |
| 4 | **Blur the text drop shadow** | It is `0 Npx 0` — zero blur, zero x-offset. An extrusion, not a shadow |
| 5 | Use `-webkit-text-stroke` **without `paint-order: stroke fill`** | The stroke is centred on the outline; without paint-order it eats half the letterform and heavy text turns to mush. Declared width is double the visual |
| 6 | Keep **icons neatly inside** their containers | Clash icons overhang pills, buttons and cards by design. Tidy, evenly padded icons are the fastest route to an admin dashboard |
| 7 | Make the **badge a circle** | It is a rounded square that widens into a stadium, with a warm-white ring plus a dark edge outside the red. A plain red circle is the generic-app version |
| 8 | **Tuck the badge or the close X inside** the parent's bounds | Both deliberately break the silhouette (~40% outside). Politely inset versions look timid |
| 9 | **Scale the contour** with the element | Constant 3px (2px under ~28px) on a 24px badge and a 340px card alike. Proportional borders destroy the inked-cartoon read |
| 10 | Signal "secondary" by **removing** the border, gloss or shadow | A Clash secondary is the same physical object in a duller hue, all four layers intact |
| 11 | Put a **scrim or backdrop blur behind every modal** | Tier-1 panels sit over a fully visible, undimmed, unblurred island. Only tier 3 dims — and it dims everything, HUD included |
| 12 | **Wrap the reward moment in a card** | Victory and the chest opening have no panel, no border, no radius. Boxing them kills the payoff the whole retention loop exists to deliver |
| 13 | Render the primary CTA as a **text pill** | It is a large square icon tile with the caption baked in. A rounded rectangle saying "¡Zarpar!" carries none of the weight |
| 14 | Use **pure `#000`** for contours or **pure `#FFF`** for panels | Every neutral here is warm: ink `#17130E`, panel `#EAEAE2`, utility grey `#EFEDDC`, badge ring `#FFF4DE`. Cold greys look cheap next to saturated game art |
| 15 | Format numbers with **commas**, or set them in a system/monospace font | Thin-space separators and a heavy flat-terminal display numeral with tabular figures are load-bearing |
| 16 | **Fake the small-caps** look by typing capitals ("BuilDeRS") | That comes from a proprietary font. Hand-cased text reads as a typo. Title Case only; real `small-caps` on timer units only |
| 17 | Port the **landscape layout to portrait unchanged** | Full-width pills eat the island, a bottom-left CTA is awkward for a right thumb, a non-scrolling tab rail overflows |
| 18 | Ignore **safe-area insets** | Pills collide with the notch; the CTA cluster lands under the home indicator. Every edge-anchored element needs `env()` **on top of** its 12px margin |
| 19 | Animate badges and attention cues **continuously** | One overshoot on arrival, then hold. Permanent motion reads as a bug |
| 20 | Add a **decorative accent colour, a second font, or a neutral brand hue** | Every colour here does a job. A palette entry with no function is what makes a clone look like a clone |
| 21 | Place a **primary action above 55%** of viewport height in portrait | Unreachable one-handed. The player drops the phone or abandons the action |
| 22 | Put a **badge on "new content"** | It burns the channel in a week and it never comes back. Claimable-in-2-taps only |

---

## 7. Acceptance checklist

A build is not done until every line passes.

**Visual**
- [ ] Blind A/B of the HUD against `coc_hud_collect.jpg`: a Clash player cannot name what is different besides the art.
- [ ] Every button, pill, chip, badge and card has all four layers (contour, hard gloss step, top rim, lip + zero-x extrusion).
- [ ] No gradient on any button face is smooth across the break.
- [ ] Storage bars drain leftward; timer bars grow rightward.
- [ ] Every empty track shows the 3D scene through it.
- [ ] Every icon in a pill, button or card breaks its container's edge.
- [ ] Every numeral uses thin-space separators and tabular figures.
- [ ] No `#000` and no `#FFF` anywhere in `tokens.css` except the letterbox.

**Layout**
- [ ] Portrait and landscape both correct on: 390×844, 360×780, 430×932, and their rotations.
- [ ] With the notch simulated, nothing collides with it in either orientation.
- [ ] Nothing tappable sits above 55% of viewport height in portrait.
- [ ] The centre channel is ≥120px in portrait at every supported width.
- [ ] The island is pannable through every gap in the HUD (`pointer-events` discipline).
- [ ] World-anchored UI clamps to the viewport minus 16px; no half-off-screen bubbles.
- [ ] Tab rails scroll with snap points in portrait; the active tab auto-scrolls into view.

**Loop**
- [ ] A collect bubble is visible in **frame 1** of a cold start after any offline period.
- [ ] The next-action resolver (§4.8) always returns a hit, always reachable in ≤2 taps.
- [ ] `¡Lleno!` opens the storage upgrade sheet in one tap.
- [ ] The gem `+` and the builder chip each have a duplicate route from Zone C.
- [ ] The store invariant test (§4.2) runs in CI and fails the build when broken.
- [ ] Play 3 min, close, return next day: accumulated production, a ready chest, a claimable mission.
- [ ] At every session close there is a timer running **and** something to collect.

**Motion & a11y**
- [ ] `prefers-reduced-motion` keeps every state change and sound, drops travel and shake.
- [ ] All animation is `transform`/`opacity`/`filter` only; 60fps on a mid-range phone.
- [ ] Every tap target measures ≥48px including invisible padding.
- [ ] Fonts are self-hosted and the game renders correctly with the network disabled.

---

## 8. Copy strings

The game is Spanish (`lang="es"`). Keep strings in one module for a future i18n pass.

| Key | String |
|---|---|
| `cta.sail` | `¡Zarpar!` |
| `cta.build` | `Construir` |
| `cta.chests` | `Cofres` |
| `cta.log` | `Diario` |
| `cta.settings` | `Ajustes` |
| `cta.upgrade` | `Mejorar` |
| `cta.claim` | `Reclamar` |
| `cta.collectAll` | `Recoger Todo` |
| `cta.finishNow` | `Terminar\nYa` |
| `cta.returnHome` | `Volver a la Isla` |
| `cta.start` | `Empezar` |
| `chip.full` | `¡Lleno!` |
| `chip.noBuilders` | `Sin constructores` |
| `chip.storageMax` | `Almacén al máximo` |
| `chip.repairing` | `Reparando` |
| `chip.oneChest` | `Solo un cofre a la vez` |
| `label.gotIt` | `Lo has conseguido:` |
| `label.loot` | `Botín:` |
| `banner.victory` | `¡Botín!` |
| `banner.returned` | `La Isla Resistió` |
| `daily.tomorrow` | `Vuelve mañana: {reward}` |
| `daily.paused` | `Racha en pausa · día {n}` |
| `guide.idleBuilder` | `Carpintero sin trabajo` |
| `panel.builders` | `Constructores` |
| `panel.ranks` | `Rangos de Capitán` |
| `panel.log` | `Diario de a Bordo` |
| `panel.gems` | `Gemas` |
| `tab.news` / `tab.events` | `Noticias` / `Eventos` |
| `rank.*` | `Grumete` · `Marinero` · `Contramaestre` · `Navegante` · `Capitán` · `Corsario` · `Leyenda` |

---

## 9. Corrections to `RETENTION.md`

These are deliberate. Do not "fix" the code back toward the older document.

| § | `RETENTION.md` says | This spec says | Why |
|---|---|---|---|
| §1 | Start with **1 builder** | Start with **2** | With one, every timer is a hard stop, the tutorial has nothing to do while it runs, and the document's own star hook — the blinking free builder — can never exist. Clash starts with 2 for exactly this reason |
| §2 | "Each producer accumulates up to its store" | **Two separate caps** (producer internal + store) | They are two independent upgrade decisions and that tension is half the economy. Fused, upgrading stores becomes meaningless |
| §5 | Streak **resets** if you miss a day | Streak **pauses**, + 1 free monthly "pase de tormenta" | In a solo, offline, shopless game a reset does not create pressure; it creates a reason to uninstall on the exact day the player is judging whether the game treats them well |
| §6 | Dailies refresh at **midnight** | **04:00 local** | Midnight punishes the 23:55 player, who is the most engaged one |
| §7 | Threat meter → raid; **temporary shield** afterwards | Raid brings a **loaded fleet**; ≤10% of one resource at risk; **30–60 min repairs timer** + a war-loot chest win or lose; plus a "Tocar la Campana" button that summons the raid early for a bonus | A meter that rises with your wealth and ends in a robbery is a fine for playing well. And a `2d 16h` shield sign literally says "nothing will happen for two days" — an explicit argument not to open the app |
| §9 | Gems "are earned by playing", no figures | **35–50 💎/day sustained, ~600 in week one**, and a written guarantee that every gem price has a playable route | Without a shop, the gem tap *is* the economy |
| §"tres relojes" | Three clocks | **Four** — the **weekly** clock was missing | Between "a reason to return today" and "a reason to keep going this month" there is a large gap. Weekly events with a half-full progress bar are what make someone open the game on a Tuesday |
| §HUD | Spec written in **landscape** | Portrait-first, with landscape reverting to the reference | The game is played in portrait one-handed |
| — | Obstacle clearing absent | Added (§4.7) | The cheapest free-gem tap in Clash, and its real job is making the player *inspect their island* every session |
| — | Local notifications absent | Added (§4.9), hard cap 2/day | A PWA whose whole loop is "come back tomorrow" needs the channel that delivers the message |
| — | Long-absence return absent | Added: `La Isla Resistió` (§3.22C) | Reactivating an installed player is far cheaper than acquiring a new one |
| — | Closing test is a **question** | Turned into the **next-action resolver** (§4.8) | "Is there a timer running and something to collect?" must be a priority list the HUD queries, not a good intention |

---

## 10. Decisions log

Choices made by the UI architect where the two studies disagreed or were silent.

1. **Primary CTA is bottom-RIGHT in portrait, bottom-LEFT in landscape.** The visual study and
   the retention study both argue for the right thumb in portrait; `RETENTION.md` copies
   Clash's landscape position. Resolved by orientation, with a Zurdo/Diestro toggle. Landscape
   keeps Clash's exact layout, where a left thumb makes bottom-left correct.
2. **Build-mode ✗/✓ are anchored to a bottom bar in portrait, world-anchored in landscape.**
   The visual study wanted world-anchored with a flip rule; the retention study demanded a
   fixed bottom bar. Reachability is a hard constraint, so portrait takes the bar; landscape,
   where the whole screen is in reach, keeps the Clash behaviour.
3. **The builder chip stays in Zone A but the free-builder signal is mirrored to Construir in
   Zone C.** The retention study wanted the chip moved to the bottom row in portrait; the
   visual study wanted the top row read-only with duplicate routes. This satisfies both and
   keeps Clash's silhouette.
4. **Top-centre is empty in portrait; the builder and status chips move to the left column.**
   Centred chips collide with the pill stack at 390pt. The mailbox moves to the bottom cluster
   because it is tappable.
5. **The shield pill is replaced by a priority-resolved status chip** (repairs → event
   countdown → rank). The shield is anti-retention here, and the slot is a good home for the
   weekly clock the studies identified as missing.
6. **Portrait uses compact pill metrics** (32/150/50 instead of 34/168/54). Five rows at
   reference sizes push the read-only zone past 26% of the viewport. Even compact, the top
   zone is 0–26% rather than the study's 22% — a deliberate, stated deviation, mitigated by
   the staged reveal that keeps it at 14% for the whole early game.
7. **The ivory featured frame goes to Cofres.** Clash reserves it for the monetisation entry;
   we have no IAP, so it marks our premium-currency sink and reward surface. It moves to a
   shop if one is ever built, and it is never on two things at once.
8. **The chest tray collapses into the Cofres tile in portrait** and shows four inline slots
   only in landscape. Four 62px slots do not fit the 174px centre channel, and shrinking them
   breaks the 48px tap floor.
9. **Rum keeps Clash's elixir slot (saturated magenta); wood is a warm orange-brown.** At 32px
   over bright turquoise water the bar colour is pure wayfinding; realism belongs to the icon,
   which is an amber bottle. Gold and wood are separated by icon silhouette and chroma.
10. **Expedition loot lands as collect bubbles on the island, not directly into storage.**
    This chains the sea loop back into the island loop instead of terminating it.
11. **`¡Lleno!` is a button**, keeping the dashed "informational" border but opening the
    storage upgrade sheet in one tap.
12. **Fonts are self-hosted with `font-display: block`.** The PWA must render correctly
    offline, and a system-font flash in heavy outlined text looks broken.
13. **Rarity gains two tiers** (`--ui-rarity-rare`, `--ui-rarity-legend`) beyond the two
    measured, since our chest table has six tiers. Frame colour only — the art never changes.
