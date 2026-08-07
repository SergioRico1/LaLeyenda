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
  const root = el('div', 'timerbar');
  const fill = el('div', 'timerbar__fill');
  const label = el('span', 'num num-world timerbar__label');
  root.append(el('div', 'timerbar__track', fill), el('i', 'timerbar__rim'), label);
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
