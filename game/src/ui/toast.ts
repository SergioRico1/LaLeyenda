import { el } from './components/dom';
import { FROZEN } from './env';
import { sfx } from './sfx';

/**
 * toast.ts — §3.5's "never a dead tap", made into one mechanism.
 *
 * Every refusal in the game routes through here, so the answer to "why did
 * nothing happen" is always the same shape wherever it is asked.
 *
 * `refuse(node)` is the other half: the object that said no also SHAKES, so the
 * message and the thing it is about are visibly connected. That pairing already
 * existed on the picker's blocked rows and nowhere else.
 */

export interface Toasts {
  readonly el: HTMLElement;
  /** Names the key. Repeating the same message re-times it instead of stacking. */
  say(text: string, opts?: { tone?: 'info' | 'refuse' }): void;
}

/** §5: the refused object shakes. One implementation, used everywhere. */
export function refuse(node: HTMLElement | null | undefined): void {
  navigator.vibrate?.([12, 40, 12]);
  if (!node || FROZEN) return;
  node.classList.remove('is-refused');
  void node.offsetWidth;               // restart the animation on a repeat tap
  node.classList.add('is-refused');
  window.setTimeout(() => node.classList.remove('is-refused'), 260);
}

export function createToasts(): Toasts {
  const root = el('div', 'layer-toast');
  /** At most two on screen: a third is a log, and nobody reads a log. */
  const live: Array<{ node: HTMLElement; timer: number; text: string }> = [];

  const drop = (entry: { node: HTMLElement; timer: number }) => {
    window.clearTimeout(entry.timer);
    const index = live.findIndex((e) => e === entry);
    if (index >= 0) live.splice(index, 1);
    if (FROZEN) { entry.node.remove(); return; }
    entry.node.classList.add('is-leaving');
    window.setTimeout(() => entry.node.remove(), 180);
  };

  return {
    el: root,
    say(text, opts = {}) {
      sfx(opts.tone === 'refuse' ? 'refuse' : 'pop');

      // Tapping a locked button four times should re-time one message, not
      // stack four copies of it down the screen.
      const same = live.find((e) => e.text === text);
      if (same) {
        window.clearTimeout(same.timer);
        same.timer = window.setTimeout(() => drop(same), 2200);
        return;
      }
      while (live.length >= 2) drop(live[0]);

      const node = el('div', 'toast', el('span', 't', text));
      root.append(node);
      const entry = { node, text, timer: 0 };
      entry.timer = window.setTimeout(() => drop(entry), 2200);
      live.push(entry);
    },
  };
}
