import { el, iconImg, pressable } from './dom';
import { createBadge, type Badge } from './badge';

/**
 * navbar.ts — LAYOUT_SPEC §1, the bottom navigation bar.
 *
 * The biggest structural gap between us and a modern mobile builder. We
 * scattered five destinations into four corner clusters, which cost three
 * ways: the corners are the worst part of a phone screen for a thumb, nothing
 * told the player how many destinations exist, and each button needed its own
 * framing so the chrome multiplied.
 *
 * One bar along the bottom, five slots: Isla · Cofres · Zarpar · Diario ·
 * Ajustes. Slot 3 sits proud of the bar and is the one element allowed Clash's
 * full four-layer treatment (it is `createTile`, unchanged); the rest are flat
 * icon-over-label so THE BAR is the object and the slots are printed on its
 * face. Two objects along the bottom edge where there were five.
 *
 * "Flat" is not "unlit". The bar carries every one of the four layers — ink
 * contour, hard gloss step, warm top rim, dark lip and extrusion — because it
 * is what the player presses. A slot's press is a dent in that face plus 2px
 * of travel, which is §3.0's rule applied to a region of an object rather than
 * to an object of its own.
 */

export interface NavSlot {
  readonly el: HTMLElement;
  readonly badge: Badge;
  /** The next-action resolver's attention cue (§4.8). */
  setCued(cued: boolean): void;
  /** §5.6's one permitted idle loop on this bar: a ready chest bobs. */
  setReady(ready: boolean): void;
}

export interface NavSlotOptions {
  /** Baked voxel icon (icons.ts). */
  icon?: string;
  label: string;
  onTap?: () => void;
}

export function createNavSlot(opts: NavSlotOptions): NavSlot {
  const root = el('button', 'navslot');
  root.type = 'button';
  root.setAttribute('aria-label', opts.label);

  const art = iconImg(opts.icon, 'navslot__art');
  const badge = createBadge(0);
  // The badge anchors to the PROP, not to the slot box: a slot is a
  // transparent region of the bar, so a badge on its top-right corner would
  // float in the gap between two slots instead of breaking a silhouette (§3.8).
  const wrap = el('span', 'navslot__prop', art, badge.el);

  /**
   * The label never changes. §3.7 gave the featured Cofres tile a mini timer
   * caption, and the obvious port was to swap it in for this slot's label
   * while a chest unlocks — but a nav bar's whole virtue is that it is always
   * present and never moves (LAYOUT_SPEC §1), and one slot whose name turns
   * into a countdown is a bar that stops teaching how many destinations exist.
   *
   * The countdown also fails LAYOUT_SPEC's own test: chrome earns its place or
   * it goes, and a number you cannot act on is the definition of chrome that
   * does not. What the player needs from out here is "can I claim something",
   * which is exactly what the badge says — and the exact time is one tap away
   * inside the destination the badge is sitting on.
   */
  const label = el('span', 't navslot__label', opts.label);
  root.append(wrap, label);

  pressable(root, opts.onTap);

  return {
    el: root,
    badge,
    setCued: (cued) => root.classList.toggle('is-cued', cued),
    setReady: (ready) => root.classList.toggle('is-ready', ready),
  };
}

/**
 * The bar itself. `slots` are laid in order; `proud` is slot 3's raised tile,
 * which is handed in already built so the primary CTA stays exactly the object
 * §3.5 specifies rather than being re-implemented here.
 */
export function createNavbar(slots: HTMLElement[], proud: HTMLElement): HTMLElement {
  const raised = el('div', 'navslot navslot--proud', proud);
  const inner = el('div', 'navbar__inner', ...slots.slice(0, 2), raised, ...slots.slice(2));
  return el('nav', 'navbar', inner);
}
