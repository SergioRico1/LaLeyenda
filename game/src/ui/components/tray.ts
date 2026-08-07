import { el, iconImg, pressable } from './dom';
import { createBadge } from './badge';
import { createTimerBar } from './timerBar';

/** §3.13 — the chest tray. Landscape shows the four slots inline; portrait
 *  collapses them into the Cofres tile, so this is hidden by CSS there. */

export type SlotState =
  | { state: 'empty' }
  | { state: 'waiting' }
  | { state: 'unlocking'; remainingMs: number; totalMs: number }
  | { state: 'ready' };

export interface Tray {
  readonly el: HTMLElement;
  set(slots: SlotState[]): void;
}

export function createTray(icon: string | undefined, onTap?: (index: number) => void): Tray {
  const root = el('div', 'tray');
  const cells = [0, 1, 2, 3].map((i) => {
    const slot = el('div', 'slot slot--empty');
    const art = iconImg(icon, 'slot__art');
    const bar = createTimerBar();
    const badge = createBadge(0);
    slot.append(art, bar.el, badge.el);
    if (onTap) pressable(slot, () => onTap(i));
    root.append(slot);
    return { slot, art, bar, badge };
  });

  return {
    el: root,
    set(states) {
      states.slice(0, 4).forEach((s, i) => {
        const cell = cells[i];
        cell.slot.className = 'slot ' + (s.state === 'empty' ? 'slot--empty' : 'slot--live');
        if (s.state === 'unlocking') cell.slot.classList.add('slot--unlocking');
        if (s.state === 'ready') cell.slot.classList.add('slot--ready');
        cell.bar.el.hidden = s.state !== 'unlocking';
        if (s.state === 'unlocking') cell.bar.set(s.remainingMs, s.totalMs);
        cell.badge.set(s.state === 'ready' ? 1 : 0);
      });
    },
  };
}
