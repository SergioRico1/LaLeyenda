/**
 * marks.ts — the ✗, the ✓ and the clock, drawn.
 *
 * These three shipped as typed characters: `U+2717`, `U+2713` and the system
 * emoji `⏱`. Set beside the baked voxel props they sit next to, that reads
 * exactly like what it is — text pasted into a game. Measured against
 * `coc_build_mode.jpg`, a font dingbat also gets the geometry wrong in two
 * ways that matter at arm's length:
 *
 *   · **Weight.** The reference's ✗ carries a 10–11px arm inside a 63px button
 *     (17% of the side) and its ink measures 30×30 — 47% of the button. Ours
 *     was a 28px glyph with ~4px arms covering about 28%. A mark that thin
 *     stops being a symbol and becomes a character.
 *   · **Centring.** A glyph is centred on its FONT box, which for ✓ is nothing
 *     like its ink box — it floated up and to the right, leaving the lower-left
 *     quadrant of a 64px button empty.
 *
 * So they are drawn: constant-weight ink contour (`vector-effect` keeps it at a
 * fixed pixel weight at every size — §6.9 forbids a contour that scales with
 * its element), white body, hard zero-blur drop, and a viewBox trimmed to the
 * ink so `place-items:center` centres the DRAWN SHAPE and not a box around it.
 *
 * They are marks, not props. §3.14 and §3.15 both describe them as glyphs —
 * "heavy white X", "fat white check" — and the reference draws them flat, in
 * two dimensions, unlike every object in the world behind them. Baking them
 * through the renderer (icons.ts) would give a lit, shaded, three-quarter solid
 * where the bar needs a flat symbol.
 */

const NS = 'http://www.w3.org/2000/svg';

function svg(viewBox: string, className: string): SVGSVGElement {
  const node = document.createElementNS(NS, 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.setAttribute('class', className);
  return node;
}

function inked(d: string): SVGPathElement {
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('class', 'mark__ink');
  // Stroke first, fill over it: half the stroke is covered, so the visible
  // contour lies entirely OUTSIDE the shape at a predictable weight.
  path.setAttribute('paint-order', 'stroke');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  return path;
}

/**
 * §3.15's cancel. A symmetric twelve-point X whose arms are cut square across
 * the ends, matching the reference's letterform: arm 25% of the mark's width,
 * ink filling the box edge to edge so the viewBox IS the ink box.
 */
export function markX(className = ''): SVGSVGElement {
  const node = svg('0 0 100 100', `mark mark--x ${className}`.trim());
  node.append(inked(
    'M50,30 L17.5,0 L0,17.5 L30,50 L0,82.5 L17.5,100 L50,70 ' +
    'L82.5,100 L100,82.5 L70,50 L100,17.5 L82.5,0 Z'
  ));
  return node;
}

/**
 * §3.15's confirm. Two fat strokes with a mitred elbow and flat, perpendicular
 * ends — the outline is the offset polygon of the polyline, computed once at
 * 100 × 72 so its 1.40 aspect matches the reference's 48×34 ink exactly.
 * Deliberately wider than the ✗: the reference's ✓ spans 84% of its button and
 * breaks the right-hand contour on its way out (§6.8).
 */
export function markCheck(className = ''): SVGSVGElement {
  const node = svg('0 0 100 72', `mark mark--check ${className}`.trim());
  node.append(inked(
    'M0,37.7 L31.3,71.4 L100,15.6 L87.3,0 L33.3,43.9 L14.8,24 Z'
  ));
  return node;
}

/**
 * The build-time dial in a cost row (§3.20's footer). The reference draws one
 * beside "None" in `coc_builders.jpg`: a round face with a heavy contour, a
 * bright rim across the top and two hands — the same physical object as
 * everything else, at 22px.
 */
export function markClock(className = ''): SVGSVGElement {
  const node = svg('0 0 100 100', `mark mark--clock ${className}`.trim());
  const face = document.createElementNS(NS, 'circle');
  face.setAttribute('cx', '50');
  face.setAttribute('cy', '50');
  face.setAttribute('r', '46');
  face.setAttribute('class', 'mark__face');
  face.setAttribute('paint-order', 'stroke');
  face.setAttribute('vector-effect', 'non-scaling-stroke');

  // Layer 3: the warm rim on the top inner edge, as an arc rather than a ring —
  // light from directly overhead never wraps the bottom of a dial.
  const rim = document.createElementNS(NS, 'path');
  rim.setAttribute('d', 'M12,38 A40,40 0 0 1 88,38');
  rim.setAttribute('class', 'mark__rim');
  rim.setAttribute('vector-effect', 'non-scaling-stroke');

  const hands = document.createElementNS(NS, 'path');
  hands.setAttribute('d', 'M50,22 L50,52 L74,64');
  hands.setAttribute('class', 'mark__hands');
  hands.setAttribute('vector-effect', 'non-scaling-stroke');

  node.append(face, rim, hands);
  return node;
}
