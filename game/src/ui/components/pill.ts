import { el, iconImg, punch } from './dom';
import { alignInk } from '../icons';
import { n, ratio } from '../format';
import { FROZEN } from '../env';

/** §3.1 / §3.2 / §3.3 — the resource, wallet and gem pills. */

export interface PillOptions {
  /** Fill-bar colour. Omit for the wallet/gem variant, which has no bar. */
  fill?: string;
  /** Baked voxel icon (icons.ts). */
  icon?: string;
  /** Gem pill only: the `+` overhangs the end OPPOSITE the icon. */
  onPlus?: () => void;
}

export interface Pill {
  readonly el: HTMLElement;
  /** Sets the displayed value. Counts up over ~450ms — it never jumps (§3.9). */
  set(value: number, cap?: number): void;
  /** `¡Lleno!` pressure: pulse only while 2+ producers are capped (§3.1). */
  setPressing(on: boolean): void;
  /** White flash when a collected value lands here (§3.9). */
  hit(): void;
  /** Where a number-flight should land. */
  target(): { x: number; y: number };
}

export function createPill(opts: PillOptions = {}): Pill {
  const root = el('div', opts.fill ? 'pill' : 'pill pill--well');
  if (opts.fill) root.style.setProperty('--fill', opts.fill);

  const track = el('div', 'pill__track');
  const fill = el('div', 'pill__fill');
  if (opts.fill) track.append(fill);
  const num = el('span', 'num pill__num');
  const icon = el('span', 'pill__icon', iconImg(opts.icon, ''));
  alignInk(icon, opts.icon);      // §1.7 — the stack aligns on ink, not on boxes

  root.append(track, el('i', 'pill__rim'), num, icon);
  if (!opts.fill) root.append(el('i', 'pill__rim pill__rim--low'));

  if (opts.onPlus) {
    const plus = el('button', 'plus tap', el('span', 't t-glyph', '+'));
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Gemas');
    plus.addEventListener('click', () => {
      navigator.vibrate?.(8);
      opts.onPlus!();
    });
    root.append(plus);
  }

  let shown = 0;
  let first = true;
  let raf = 0;

  const paint = (v: number) => { num.textContent = n(v); };

  const set = (value: number, cap?: number) => {
    if (cap !== undefined && opts.fill) {
      const pct = ratio(value, cap);
      root.style.setProperty('--pct', String(pct));
      root.classList.toggle('is-full', pct >= 1);
    }
    if (first || FROZEN || Math.abs(value - shown) < 1) {
      first = false;
      shown = value;
      paint(value);
      return;
    }
    // Count-ups ease out — never linear (§5), and the counter punches on land.
    const from = shown;
    const start = performance.now();
    cancelAnimationFrame(raf);
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 450);
      const eased = 1 - Math.pow(1 - k, 3);
      shown = from + (value - from) * eased;
      paint(shown);
      if (k < 1) raf = requestAnimationFrame(step);
      else {
        shown = value;
        paint(value);
        punch(num);
      }
    };
    raf = requestAnimationFrame(step);
  };

  return {
    el: root,
    set,
    setPressing: (on) => root.classList.toggle('is-pressing', on),
    hit() {
      root.classList.add('is-hit');
      setTimeout(() => root.classList.remove('is-hit'), 120);
    },
    target() {
      const r = icon.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
  };
}
