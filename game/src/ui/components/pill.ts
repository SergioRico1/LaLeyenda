import { el, iconImg } from './dom';
import { alignInk } from '../icons';
import { ratio } from '../format';
import { createCounter } from './counter';

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

  // §3.9's count-up, shared with the grouped capsule's cells (counter.ts) so
  // there is one easing curve in the HUD rather than one per numeral.
  const counter = createCounter(num);

  const set = (value: number, cap?: number) => {
    if (cap !== undefined && opts.fill) {
      const pct = ratio(value, cap);
      root.style.setProperty('--pct', String(pct));
      root.classList.toggle('is-full', pct >= 1);
    }
    counter.set(value);
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
