import { el, iconImg, pressable, punch } from './dom';
import { alignInk } from '../icons';

/**
 * §3.4 — the builder chip.
 *
 * It stays in Zone A (matching Clash's silhouette) and IS tappable, but the
 * actionable free-builder signal is mirrored onto the Construir tile in Zone C
 * (§10.3): the top row keeps its read-only character and no required action
 * lives out of thumb reach.
 */

export interface BuilderChip {
  readonly el: HTMLElement;
  set(free: number, total: number): void;
}

export function createBuilderChip(opts: {
  icon?: string;
  onTap?: () => void;
  onPlus?: () => void;
}): BuilderChip {
  const root = el('div', 'cap builder-chip');
  root.setAttribute('role', 'button');
  root.setAttribute('aria-label', 'Constructores');

  const num = el('span', 'num builder-chip__num');
  const info = el('button', 'builder-chip__info t t-glyph', 'i');
  info.type = 'button';
  info.setAttribute('aria-label', 'Información');

  const icon = el('span', 'cap__icon', iconImg(opts.icon, ''));
  alignInk(icon, opts.icon);      // §1.7 — the column aligns on ink, not on boxes
  root.append(el('i', 'cap__gloss'), el('i', 'cap__rim'), icon, num, info);

  if (opts.onPlus) {
    const plus = el('button', 'plus tap', el('span', 't t-glyph', '+'));
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Más constructores');
    plus.addEventListener('click', (e) => { e.stopPropagation(); opts.onPlus!(); });
    root.append(plus);
  }

  pressable(root, opts.onTap);

  let shown = '';
  return {
    el: root,
    set(free, total) {
      // Clash shows FREE / TOTAL, so 1/2 means one carpenter is idle.
      const next = `${free}/${total}`;
      if (next !== shown) {
        // §5.3 — a carpenter coming free is a state change the player has to
        // catch, and this counter used to mutate silently.
        if (shown) punch(num);
        shown = next;
        num.textContent = next;
      }
      root.classList.toggle('is-free', free > 0);
    },
  };
}
