/**
 * env.ts — the two runtime facts every component needs before it animates.
 *
 * Imported (directly or transitively) by every component, so it is evaluated
 * before any of them: ES module evaluation is depth-first, which is what
 * guarantees `html.shot` is on the element before a component reads it.
 */

const params = new URLSearchParams(location.search);

/** The screenshot harness captures two frames after boot, so a 260ms entrance
 *  animation would be caught at t≈0 — a badge at scale 0 is an invisible
 *  badge. In shot mode every element is drawn at its resting state. */
export const SHOT = params.get('shot') === '1';

export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * `?motion=1` — shot mode WITHOUT the freeze.
 *
 * A frozen capture is what makes a screenshot byte-identical, and it is also
 * what makes every animation in the game unreviewable: a celebration that is
 * skipped in shot mode cannot be checked against the pixels, only described.
 * This flag exists so the harness can drive a real interaction and photograph
 * the motion it produces. It is never on in a deterministic capture — the
 * default is still frozen — and nothing in the product reads it.
 */
export const MOTION = SHOT && params.get('motion') === '1';

/** Skip travel and overshoot, keep every state change (§5). */
export const FROZEN = (SHOT && !MOTION) || REDUCED;

/**
 * True ONLY for a deterministic capture — reduced motion is deliberately not
 * included. Use this to suppress something because the harness must not see it;
 * use FROZEN to suppress travel. §5 keeps every state change when motion is cut,
 * so anything that carries INFORMATION has to survive REDUCED and gate on this
 * instead.
 */
export const CAPTURE = SHOT && !MOTION;

if (SHOT) document.documentElement.classList.add('shot');
if (MOTION) document.documentElement.classList.add('motion');
