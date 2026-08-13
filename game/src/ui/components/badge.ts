import { el } from './dom';
import { badgeCount } from '../format';
import { FROZEN } from '../env';

/** §3.8 — the notification badge. Claimable in 1–2 taps, or it does not exist. */

export interface Badge {
  readonly el: HTMLElement;
  /** 0 hides it. Going 0 → n plays the entrance once and then holds. */
  set(count: number): void;
}

export function createBadge(count = 0): Badge {
  const root = el('div', 'badge');
  const label = el('span', 'num num-badge');
  root.append(label);

  let shown = -1;

  const set = (next: number) => {
    if (next === shown) return;
    const appearing = shown <= 0 && next > 0;
    shown = next;
    if (next <= 0) {
      root.hidden = true;
      return;
    }
    label.textContent = badgeCount(next);
    root.hidden = false;
    if (appearing && !FROZEN) {
      root.classList.remove('is-entering');
      void root.offsetWidth;
      root.classList.add('is-entering');
    }
  };

  set(count);
  return { el: root, set };
}
