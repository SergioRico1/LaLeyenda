import { el, iconImg, pressable, punch } from './dom';
import { alignInk } from '../icons';

/**
 * §3.10 — the `¡Lleno!` label, and §2.4 — the status chip.
 *
 * `¡Lleno!` is deliberately a quieter register: a DASHED edge reads instantly
 * as "information" in a world where every actionable thing has a solid
 * contour. Our one departure (§10.11) is that it is nevertheless a button —
 * it opens the upgrade sheet for the corresponding storage with the cost
 * already visible. The dashed border stays; the affordance is taught once.
 */
export function createChip(text: string, onTap?: () => void): HTMLElement {
  const root = el('div', onTap ? 'chip chip--action' : 'chip', el('span', 't', text));
  if (onTap) {
    root.setAttribute('role', 'button');
    pressable(root, onTap);
  }
  return root;
}

/**
 * §2.4 — one slot, one occupant, resolved by priority:
 *   1 repairs running · 2 weekly event < 24h · 3 rank / notoriety.
 * This replaces Clash's shield pill, which is an anti-retention object here.
 *
 * NOT MOUNTED ON THE PERSISTENT HUD any more: LAYOUT_SPEC §2 groups the
 * standing figure into the top capsule (`readout.ts`) beside the builders and
 * the currencies, which is where Kingshot puts its own might/power readout.
 * Kept because the priority-1 and -2 occupants (a repair countdown, an event
 * countdown) are objects a raid report or an events page will want, and both
 * of those are somewhere to press from.
 */
export interface StatusChip {
  readonly el: HTMLElement;
  set(text: string): void;
}

export function createStatusChip(opts: { icon?: string; onTap?: () => void }): StatusChip {
  const root = el('div', 'cap status-chip');
  root.setAttribute('role', 'button');
  const num = el('span', 'num status-chip__num');
  const icon = el('span', 'cap__icon', iconImg(opts.icon, ''));
  alignInk(icon, opts.icon);      // §1.7 — the column aligns on ink, not on boxes
  root.append(el('i', 'cap__gloss'), el('i', 'cap__rim'), icon, num);
  pressable(root, opts.onTap);
  let shown = '';
  return {
    el: root,
    set(text) {
      if (text === shown) return;
      // §5.3 — notoriety moving is one of the few progress signals a session
      // with nothing finished can offer, so it must be seen moving.
      if (shown) punch(num);
      shown = text;
      num.innerHTML = text;
    },
  };
}
