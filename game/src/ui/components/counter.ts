import { punch } from './dom';
import { n } from '../format';
import { FROZEN } from '../env';

/**
 * counter.ts — §3.9's "the counter counts up over 300ms — it never jumps",
 * as one implementation.
 *
 * Every numeral in the HUD that can change owns one of these. It lived inside
 * `pill.ts` while the resource pills were the only counters on screen; the
 * grouped capsule (LAYOUT_SPEC §2) added five more, and two copies of an
 * easing curve is two curves that drift.
 *
 * The first paint is deliberately NOT animated: a cold boot would otherwise
 * spend 450ms counting up from zero to a figure the player has had all along,
 * which reads as the game loading rather than as a value arriving.
 */
export interface Counter {
  /** Animates towards `value`. Sub-unit changes land immediately — production
   *  ticks four times a second and a 450ms curve per tick would never settle. */
  set(value: number): void;
  /** The figure currently painted, which is not the target mid-count. */
  shown(): number;
}

export function createCounter(node: HTMLElement, format: (v: number) => string = n): Counter {
  let shown = 0;
  let first = true;
  let raf = 0;

  return {
    shown: () => shown,
    set(value) {
      if (first || FROZEN || Math.abs(value - shown) < 1) {
        first = false;
        shown = value;
        node.textContent = format(value);
        return;
      }
      // Count-ups ease out — never linear (§5) — and the counter punches when
      // it lands, because §5.3 says a silently mutated counter is a bug.
      const from = shown;
      const start = performance.now();
      cancelAnimationFrame(raf);
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / 450);
        const eased = 1 - Math.pow(1 - k, 3);
        shown = from + (value - from) * eased;
        node.textContent = format(shown);
        if (k < 1) {
          raf = requestAnimationFrame(step);
        } else {
          shown = value;
          node.textContent = format(value);
          punch(node);
        }
      };
      raf = requestAnimationFrame(step);
    },
  };
}
