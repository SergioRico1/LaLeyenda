import { el, iconImg, pressable } from './dom';

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
 */
export interface StatusChip {
  readonly el: HTMLElement;
  set(text: string): void;
}

export function createStatusChip(opts: { icon?: string; onTap?: () => void }): StatusChip {
  const root = el('div', 'cap status-chip');
  root.setAttribute('role', 'button');
  const num = el('span', 'num status-chip__num');
  root.append(el('i', 'cap__rim'), el('span', 'cap__icon', iconImg(opts.icon, '')), num);
  pressable(root, opts.onTap);
  return {
    el: root,
    set(text) { num.innerHTML = text; },
  };
}
