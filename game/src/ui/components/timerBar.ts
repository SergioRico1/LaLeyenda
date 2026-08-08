import { el, pressable } from './dom';
import { dur } from '../format';

/**
 * §3.11 — the world-anchored build/craft timer bar.
 *
 * Progress GROWS RIGHTWARD (stock, on a resource pill, drains leftward).
 * Tapping it raises the "Terminar Ya" gem stack (§3.5) anchored below.
 */

export interface TimerBar {
  readonly el: HTMLElement;
  set(remainingMs: number, totalMs: number): void;
}

export function createTimerBar(onTap?: () => void): TimerBar {
  // The root is a WRAPPER whose height includes the label's band, not the bar
  // itself: the world layer spaces these by offsetHeight, and while the label
  // was absolutely positioned outside the bar's box the resolver believed a
  // 20px bar was the whole object — so a label routinely landed on the bar
  // above it. Reserving the band is what makes the existing de-collision pass
  // see the drawn extent.
  const root = el('div', 'timerbar');
  const fill = el('div', 'timerbar__fill');
  const label = el('span', 'num num-world timerbar__label');
  root.append(el('div', 'timerbar__track', fill, el('i', 'timerbar__rim')), label);
  if (onTap) {
    root.setAttribute('role', 'button');
    pressable(root, onTap);
  }
  return {
    el: root,
    set(remainingMs, totalMs) {
      const done = totalMs > 0 ? 1 - Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
      root.style.setProperty('--pct', String(done));
      label.innerHTML = dur(remainingMs);
    },
  };
}
