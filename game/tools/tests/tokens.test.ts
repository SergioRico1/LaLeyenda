// The stylesheet itself is the fixture: esbuild inlines it as text for this
// suite (see tools/test.mjs's `.css` loader). The cast is because vite/client
// types `*.css` for the APP, where importing one is a side effect with no
// default export — it has no way to know this one build treats it as a string.
import cssModule from '../../src/ui/tokens.css';
import { describe, ok, test } from './harness';

const CSS = cssModule as unknown as string;

/**
 * tokens.test.ts — the four layers, asserted.
 *
 * UI_SPEC §0.2 says every UI object is a physical thing lit from directly
 * overhead, and that omitting any one of its four layers collapses it into a
 * flat web UI. Three of the four are structure — an element either has an ink
 * border or it does not — but layer 2, the gloss STEP, is five colour stops in
 * a token file, and colour stops are exactly the kind of thing that can be
 * transposed without anyone noticing.
 *
 * They were. The cream utility family shipped with `gloss-b` DARKER than
 * `base-a`, so the light ran uphill: Ajustes and Diario stepped from L=224 to
 * L=236 across their break and read as flat cream squares with a seam. Nothing
 * in the build could tell, because a backwards gradient is still a gradient.
 *
 * So the invariants below are the ones a human eye applies and a compiler
 * cannot. The numbers come from scanning the reference screenshots in
 * reference/clash (Rec.601 luma, the measure whose values reproduce the ones
 * quoted in the studies):
 *
 *   · Attack tile, coc_build_mode x=28 — plate #FEBA4B→#E59532, hard step to
 *     #CF701E, body settling #C7651A. Face span 124/194 = 0.64, step 0.81.
 *   · Confirm ✓, x=506 — 208 → 132 over the face. Span 0.63.
 *   · Close ✗, x=412 — plate ≈165, body ≈70. Span 0.42: saturated red is the
 *     one family Rec.601 pushes far down, so the band has to hold it.
 *
 * This does not freeze the palette. It asserts that light falls DOWNWARD, that
 * a break exists, and that a family is neither washed out nor black.
 */

/** Every `--name:#RRGGBB` in the token file. */
const VARS = new Map<string, string>(
  [...CSS.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]])
);

/** Rec.601 luma, 0–255. The measure the reference scans were taken in. */
function luma(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
}

/** gloss-top, gloss-bottom, body-top, body-bottom, lip — §1.3's five stops. */
const FAMILIES: Record<string, [string, string, string, string, string]> = {
  green:  ['--ui-green-gloss-a', '--ui-green-gloss-b', '--ui-green-a', '--ui-green-b', '--ui-green-lip'],
  ok:     ['--ui-ok-gloss-a', '--ui-ok-gloss-b', '--ui-ok-a', '--ui-ok-b', '--ui-ok-lip'],
  red:    ['--ui-red-gloss-a', '--ui-red-gloss-b', '--ui-red-a', '--ui-red-b', '--ui-red-lip'],
  orange: ['--ui-orange-gloss-a', '--ui-orange-gloss-b', '--ui-orange-a', '--ui-orange-b', '--ui-orange-lip'],
  cream:  ['--ui-grey-gloss-a', '--ui-grey-gloss-b', '--ui-grey-a', '--ui-grey-b', '--ui-grey-lip'],
  stone:  ['--ui-grey2-gloss-a', '--ui-grey2-gloss-b', '--ui-grey2-a', '--ui-grey2-b', '--ui-grey-lip-2'],
};

const stops = (family: string): number[] =>
  FAMILIES[family].map((name) => {
    const hex = VARS.get(name);
    if (!hex) throw new Error(`tokens.css is missing ${name}`);
    return luma(hex);
  });

describe('tokens.css — §0.2 layer 2, the hard gloss step', () => {
  test('every family is lit from ABOVE: no stop is brighter than the one over it', () => {
    for (const family of Object.keys(FAMILIES)) {
      const [ga, gb, ba, bb, lip] = stops(family);
      // The cream family failed exactly here, between gb and ba.
      ok(ga >= gb - 0.5, `${family}: the gloss plate brightens downward (${ga.toFixed(0)} → ${gb.toFixed(0)})`);
      ok(gb > ba, `${family}: the step runs UPHILL — gloss-b ${gb.toFixed(0)} → base-a ${ba.toFixed(0)}`);
      ok(ba >= bb - 0.5, `${family}: the body brightens downward (${ba.toFixed(0)} → ${bb.toFixed(0)})`);
      ok(bb > lip, `${family}: the lip is not darker than the body it sits inside`);
    }
  });

  test('the step is a STEP, not a continuous surface', () => {
    for (const family of Object.keys(FAMILIES)) {
      const [, gb, ba] = stops(family);
      // The reference's Attack tile breaks by 19%. Anything above 0.92 is a
      // seam the eye cannot find, which is a gradient pretending to be moulded.
      ok(ba / gb <= 0.92, `${family}: the break is only ${(100 - (ba / gb) * 100).toFixed(0)}% — too shallow to read`);
      ok(ba / gb >= 0.35, `${family}: the break is ${(100 - (ba / gb) * 100).toFixed(0)}% — that is a hole, not a step`);
    }
  });

  test('a family spans as much of the value range as the reference does', () => {
    for (const family of Object.keys(FAMILIES)) {
      const [ga, , , bb] = stops(family);
      const span = bb / ga;
      // Reference: 0.64 (Attack), 0.63 (✓), 0.42 (✗ — saturated red sits low in
      // Rec.601 whatever you do with it).
      ok(span <= 0.78, `${family}: face spans only ${span.toFixed(2)} of its top — the object reads tinted, not lit`);
      ok(span >= 0.30, `${family}: face spans ${span.toFixed(2)} — the bottom has gone to mud`);
    }
  });
});

describe('tokens.css — §1.9 the text contour is constant weight', () => {
  test('numeral and label strokes are declared in px, not em', () => {
    for (const name of ['--ui-txt-stroke-h', '--ui-txt-stroke-n', '--ui-txt-stroke-x', '--ui-txt-stroke-lg']) {
      const raw = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(CSS)?.[1]?.trim();
      ok(!!raw && raw.endsWith('px'), `${name} must be px: an em stroke scales the contour with the element (§6.9)`);
    }
  });

  test('the HUD strokes stay inside what the shipped faces can carry', () => {
    // Measured by rasterising "1 000" in Fredoka SemiBold at 20px and flood
    // filling for enclosed counters: 4.0px declared closes every bowl, 3.0px
    // leaves 1px, 2.2px leaves 2px. Above ~2.4px the numerals lose their form.
    const px = (name: string) => Number(new RegExp(`${name}\\s*:\\s*([\\d.]+)px`).exec(CSS)?.[1]);
    ok(px('--ui-txt-stroke-n') <= 2.4, 'numeral stroke over 2.4px closes Fredoka\'s counters below 26px');
    ok(px('--ui-txt-stroke-h') <= 2.6, 'label stroke over 2.6px closes Lilita One\'s counters below 26px');
    ok(px('--ui-txt-stroke-n') >= 1.6, 'under 1.6px the outline stops reading as a contour at all');
  });
});

describe('tokens.css — §6 no blurred shadows', () => {
  test('the extrusion ladder is hard, zero blur and zero x-offset', () => {
    for (const name of ['--ui-drop-xs', '--ui-drop-sm', '--ui-drop', '--ui-drop-lg']) {
      const raw = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(CSS)?.[1]?.trim();
      ok(!!raw, `${name} is missing`);
      const [x, , blur] = raw!.split(/\s+/);
      ok(x === '0', `${name} must have zero x-offset — the light is directly overhead (§1.1)`);
      ok(blur === '0', `${name} must have zero blur — a soft extrusion is §6's generic-mobile tell`);
    }
  });

  test('the ground shadow is a hard offset with a 1-2px edge, not a haze', () => {
    // Scanned under the reference's Attack tile: contour, then L=35 → 91 → 92
    // → 109 → full grass. Four rows. The build shipped 16px of blur.
    for (const name of ['--ui-cast', '--ui-cast-lg']) {
      const raw = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(CSS)?.[1]?.trim();
      const blur = Number(raw!.split(/\s+/)[2].replace('px', ''));
      ok(blur <= 3, `${name} blurs ${blur}px — over 3px it stops being an object on the ground`);
    }
  });
});
