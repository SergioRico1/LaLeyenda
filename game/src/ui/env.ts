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

/** Skip travel and overshoot, keep every state change (§5). */
export const FROZEN = SHOT || REDUCED;

if (SHOT) document.documentElement.classList.add('shot');
