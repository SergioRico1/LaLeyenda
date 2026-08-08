import { el, pressable } from '../components/dom';
import { markCheck, markX } from './marks';
import { createCostRow, type CostLike } from './cost';
import { refusalText, type RefusalKey } from '../copy';
import type { IconSet } from '../icons';

/**
 * buildBar.ts — §3.15's confirm / cancel pair.
 *
 * §10.2 resolves the two studies by orientation, and both halves are here:
 *
 *   | Landscape | Float above the ghost, anchored in **world space**       |
 *   | Portrait  | Anchored to a **bottom bar**, never to the object        |
 *
 * The portrait rule is not a preference. §3.15: *"A confirm button in the top
 * third of a portrait phone is unreachable one-handed; the player drops the
 * phone or abandons the placement."* So in portrait the pair is pinned to a
 * 96px bar carrying the caption `Aserradero · 400 madera · 5m`, and `place()`
 * is a no-op. In landscape the whole screen is in reach and the pair follows
 * the ghost, exactly as the reference does it.
 */

export interface BuildBar {
  readonly el: HTMLElement;
  show(what: { label: string; cost: CostLike; timeMs: number }): void;
  hide(): void;
  /** Valid placement or not — drives the ✓ and the reason line. */
  setValid(valid: boolean, refusal: RefusalKey | null, townHall?: number): void;
  /** Landscape only: screen position of the ghost, projected by the scene. */
  place(x: number, y: number): void;
  readonly isOpen: boolean;
}

export function createBuildBar(opts: {
  icons: IconSet;
  onConfirm(): void;
  onCancel(): void;
}): BuildBar {
  const caption = el('div', 't buildbar__caption');
  const costs = el('div', 'buildbar__costs');
  const why = el('div', 't buildbar__why');

  // §3.15: two 56×56 rounded squares — 64×64 in portrait, "up from 56 because
  // they are the whole bar". Left = red X, right = green ✓ (--ui-ok-*).
  //
  // The marks are DRAWN (marks.ts), not typed. A font dingbat is centred on its
  // glyph box rather than its ink, which left the ✓ floating up and to the
  // right of a 64px button, and its ~4px arms are a third of the weight the
  // reference gives the same mark.
  const cancel = el('button', 'btn btn--red buildbar__btn buildbar__x', markX('buildbar__mark'));
  cancel.type = 'button';
  cancel.setAttribute('aria-label', 'Cancelar');

  const confirm = el('button', 'btn btn--ok buildbar__btn buildbar__ok', markCheck('buildbar__mark'));
  confirm.type = 'button';
  confirm.setAttribute('aria-label', 'Confirmar');

  const pair = el('div', 'buildbar__pair', cancel, confirm);
  const root = el('div', 'buildbar', el('div', 'buildbar__text', caption, costs, why), pair);
  root.hidden = true;

  pressable(cancel, () => opts.onCancel());
  pressable(confirm, () => {
    if (confirm.classList.contains('is-blocked')) {
      navigator.vibrate?.([12, 40, 12]);
      root.classList.remove('is-refused');
      void root.offsetWidth;
      root.classList.add('is-refused');
      return;
    }
    opts.onConfirm();
  });

  let open = false;

  return {
    el: root,
    get isOpen() { return open; },
    show(what) {
      open = true;
      root.hidden = false;
      caption.textContent = what.label;
      costs.replaceChildren(createCostRow({ icons: opts.icons, cost: what.cost, timeMs: what.timeMs }));
      root.classList.add('is-open');
    },
    hide() {
      open = false;
      root.hidden = true;
      root.classList.remove('is-open');
    },
    setValid(valid, refusal, townHall) {
      confirm.classList.toggle('is-blocked', !valid);
      confirm.className = confirm.className.replace(/btn--(ok|grey2)/, valid ? 'btn--ok' : 'btn--grey2');
      why.textContent = valid || !refusal
        ? ''
        : refusalText(refusal, refusal === 'town-hall-too-low' ? townHall : undefined);
      why.hidden = valid;
    },
    place(x, y) {
      // Portrait ignores this entirely: the CSS pins the bar to the bottom and
      // the transform is never read.
      root.style.setProperty('--gx', `${x.toFixed(1)}px`);
      root.style.setProperty('--gy', `${y.toFixed(1)}px`);
    },
  };
}
