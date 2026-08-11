import { el, iconImg, pressable, punch } from './dom';
import { alignInk } from '../icons';

/**
 * §3.4 — the builder chip.
 *
 * NOT MOUNTED ON THE PERSISTENT HUD any more. LAYOUT_SPEC §2 moves the builder
 * COUNTER into the grouped top capsule (`readout.ts`) as a read-only cell,
 * which it can only be because §2.1 already required the chip's route to be
 * duplicated in the thumb zone — it is the nav bar's Isla slot now. The
 * capsule's cell carries the tilt, the warm face and the escalation.
 *
 * What this object still has that the cell does not is the `+` and the blue
 * info `i`, which belong to the Carpinteros panel — a screen about builders,
 * where a control for buying one is in the right place. Kept for it rather than
 * deleted, because §3.4 specifies this object and the panel is the slice that
 * will want it.
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
  root.setAttribute('aria-label', 'Carpinteros');

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
    plus.setAttribute('aria-label', 'Más carpinteros');
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
