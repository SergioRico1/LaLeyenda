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

/** Press feedback that is not a CSS transition: §5.7 pairs weight with haptics. */
export function pressable(node: HTMLElement, onTap?: () => void): void {
  node.classList.add('tap');
  node.addEventListener('pointerdown', () => {
    navigator.vibrate?.(8);
  });
  if (onTap) node.addEventListener('click', onTap);
}
