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

export interface TrayIcons {
  /** The chest, for a slot that holds one. */
  chest?: string;
  /** The padlock an EMPTY slot shows. §3.13's empty slot is a recessed well
   *  with a real prop in it, not a 30%-opacity ghost of a full slot. */
  lock?: string;
}

export function createTray(icons: TrayIcons, onTap?: (index: number) => void): Tray {
  const root = el('div', 'tray');
  const cells = [0, 1, 2, 3].map((i) => {
    const slot = el('div', 'slot slot--empty');
    const art = iconImg(icons.lock, 'slot__art');
    const bar = createTimerBar();
    const badge = createBadge(0);
    slot.append(art, bar.el, badge.el);
    if (onTap) pressable(slot, () => onTap(i));
    root.append(slot);
    return { slot, art: art as HTMLImageElement, bar, badge };
  });

  return {
    el: root,
    set(states) {
      states.slice(0, 4).forEach((s, i) => {
        const cell = cells[i];
        const empty = s.state === 'empty';
        cell.slot.className = 'slot ' + (empty ? 'slot--empty' : 'slot--live');
        if (s.state === 'unlocking') cell.slot.classList.add('slot--unlocking');
        if (s.state === 'ready') cell.slot.classList.add('slot--ready');
        const want = (empty ? icons.lock : icons.chest) ?? '';
        if (cell.art.getAttribute('src') !== want) cell.art.src = want;
        cell.bar.el.hidden = s.state !== 'unlocking';
        if (s.state === 'unlocking') cell.bar.set(s.remainingMs, s.totalMs);
        cell.badge.set(s.state === 'ready' ? 1 : 0);
      });
    },
  };
}
