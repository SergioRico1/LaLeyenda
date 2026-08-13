import { sfx } from '../sfx';

/** Tiny DOM helper. The HUD is built imperatively so it can be driven from
 *  sim state without a framework; this keeps the construction readable. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

/** An <img> for a baked voxel icon (icons.ts). `src` may be undefined when a
 *  bake failed — the element still reserves its slot rather than collapsing
 *  the layout around it. */
export function iconImg(src: string | undefined, className: string): HTMLElement {
  const node = document.createElement('img');
  node.className = className;
  node.alt = '';
  node.decoding = 'sync';
  if (src) node.src = src;
  return node;
}

/**
 * §5.3 — "numbers punch". Any counter that changes does a 1.15 scale and
 * settles; a silently mutated counter is a bug. One implementation, because
 * every counter in the game has to agree on what a change looks like.
 *
 * The class drives `scale`, not `transform`, so it composes with whatever the
 * element already uses to place itself (see base.css).
 */
export function punch(node: HTMLElement): void {
  node.classList.remove('is-punching');
  void node.offsetWidth;                 // restart on a repeat within 120ms
  node.classList.add('is-punching');
}

/**
 * Press feedback (§3.0, §5 law 2 and §5.7).
 *
 * The press state is a CLASS, not `:active`. Two reasons, both load-bearing on
 * the target device:
 *
 *   · iOS Safari only fires `:active` on a non-anchor element if the document
 *     has a `touchstart` listener somewhere. Nothing here registered one, so on
 *     iPhone every `:active` rule in the build was dead;
 *   · `:active` is released the moment the finger slides off the element, which
 *     on a 48px target during a scroll leaves the button visibly stuck down.
 *
 * `pointerdown` / `pointerup` / `pointercancel` is the only combination that
 * behaves the same on both platforms. The `:active` rules stay in the CSS
 * beside `.is-pressed` so a mouse and a keyboard still get the travel.
 */
export function pressable(node: HTMLElement, onTap?: () => void): void {
  node.classList.add('tap');
  const release = () => node.classList.remove('is-pressed');
  node.addEventListener('pointerdown', () => {
    node.classList.add('is-pressed');
    navigator.vibrate?.(8);
    sfx('press');
  });
  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);
  node.addEventListener('pointerleave', release);
  if (onTap) node.addEventListener('click', onTap);
}
