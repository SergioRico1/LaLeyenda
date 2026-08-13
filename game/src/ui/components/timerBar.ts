import { el, pressable } from './dom';
import { dur } from '../format';

/**
 * The world-anchored build/craft timer — §3.11 as revised by LAYOUT_SPEC item 3.
 *
 * A dark translucent capsule with white numerals inside it and a thin progress
 * line along its bottom edge, in place of the green fill bar with the numeral
 * floating above. The reasoning is in timer.css; the consequence here is that
 * the ROOT ELEMENT IS THE DRAWN OBJECT.
 *
 * That matters to more than tidiness. The world layer spaces these by the
 * anchor's offsetHeight, and while the label was absolutely positioned outside
 * the bar's box the resolver believed a 20px bar was the whole object — so a
 * label routinely landed on the bar above it, and the old wrapper had to
 * reserve a phantom 20px band to compensate. With the numeral inside the
 * capsule there is nothing to reserve: what hud.ts measures is what is painted.
 *
 * Progress GROWS RIGHTWARD (stock, on a resource pill, drains leftward).
 * Tapping it raises the "Terminar Ya" gem stack (§3.5).
 */

export interface TimerBar {
  readonly el: HTMLElement;
  set(remainingMs: number, totalMs: number): void;
}

export function createTimerBar(onTap?: () => void): TimerBar {
  const root = el('div', 'timerbar');
  const label = el('span', 'num num-world timerbar__label');
  const line = el('i', 'timerbar__line');
  root.append(label, el('i', 'timerbar__rim'), el('div', 'timerbar__rail', line));
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
