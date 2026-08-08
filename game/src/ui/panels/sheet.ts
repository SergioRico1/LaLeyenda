import { el, pressable } from '../components/dom';
import { FROZEN } from '../env';

/**
 * sheet.ts — the bottom sheet both §3.15's picker and §3.16's upgrade panel
 * live in.
 *
 * §3.16 describes the floating panel as top-anchored under the tab rail, and
 * that is right for a rank ladder you read. It is wrong for a panel whose whole
 * job is a green CTA, because of §3.15's hard rule:
 *
 *   > **no primary action above 55% of viewport height, ever.**
 *
 * §4.10 beat 0:45 settles it out loud — the upgrade sheet "slides **from the
 * bottom**", "green CTA at thumb height". So the panel keeps the three-layer
 * edge of §3.16 (near-black stroke, taupe band, light inner rim, cream) and
 * loses its bottom corners, because it is hinged on the bottom edge of the
 * screen rather than floating in the middle of it.
 *
 * The game stays UNDIMMED behind it (§3.16: no scrim, no backdrop blur) — a
 * scrim would hide the island the player is deciding about. A transparent
 * catcher above the world takes the outside tap that closes it, so the sheet
 * is dismissible without a scrim being visible.
 */

export interface Sheet {
  readonly el: HTMLElement;
  /** Where callers put their content. Scrolls internally when it overflows. */
  readonly body: HTMLElement;
  setTitle(text: string): void;
  /** Pinned under the body, outside the scroll area — the thumb-height CTA. */
  readonly footer: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  onClosed(fn: () => void): void;
}

export function createSheet(options: { title?: string; onClose?: () => void } = {}): Sheet {
  const closers: Array<() => void> = [];
  if (options.onClose) closers.push(options.onClose);

  const title = el('h2', 't sheet__title', options.title ?? '');

  // §3.14 — the red X overlaps and BREAKS the corner rather than sitting
  // politely inside the header. Hit area padded to 56×56 by the CSS.
  const close = el('button', 'btn btn--red btn-x sheet__x', el('span', 't', '✕'));
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar');

  const body = el('div', 'sheet__body');
  const footer = el('div', 'sheet__footer');
  const panel = el('div', 'sheet__panel',
    el('div', 'sheet__grab'),
    el('header', 'sheet__head', title, close),
    body, footer);

  // No scrim (§3.16). This is a transparent catcher so an outside tap closes
  // the sheet — the affordance every bottom sheet on a phone has — without
  // darkening the island the player is deciding about.
  const catcher = el('div', 'sheet__catcher');
  const root = el('div', 'sheet', catcher, panel);
  root.hidden = true;

  const api: Sheet = {
    el: root,
    body,
    footer,
    isOpen: false,
    setTitle(text) { title.textContent = text; },
    open() {
      if (api.isOpen) return;
      (api as { isOpen: boolean }).isOpen = true;
      root.hidden = false;
      body.scrollTop = 0;
      // Force a reflow so the entrance transition runs from its start state
      // instead of being coalesced away with the `hidden` flip.
      if (!FROZEN) void root.offsetHeight;
      root.classList.add('is-open');
    },
    close() {
      if (!api.isOpen) return;
      (api as { isOpen: boolean }).isOpen = false;
      root.classList.remove('is-open');
      const finish = () => { if (!api.isOpen) root.hidden = true; };
      if (FROZEN) finish();
      else window.setTimeout(finish, 200);
      for (const fn of closers) fn();
    },
    onClosed(fn) { closers.push(fn); },
  };

  pressable(close, () => api.close());
  catcher.addEventListener('pointerdown', (e) => { e.stopPropagation(); api.close(); });

  return api;
}
