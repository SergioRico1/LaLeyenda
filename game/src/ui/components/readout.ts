import { el, iconImg, punch } from './dom';
import { alignInk } from '../icons';
import { nc, ratio } from '../format';
import { createCounter } from './counter';
import { FROZEN } from '../env';

/**
 * readout.ts — LAYOUT_SPEC §2, the grouped top capsule.
 *
 * Kingshot runs ONE dark translucent capsule across the top with thin vertical
 * dividers between values, and the world shows through it. We used to stack
 * three to five separately-framed pills, each with its own contour, gloss, rim
 * and shadow: at five resources that is five heavy objects competing along the
 * top edge of a phone, for information the player only ever reads.
 *
 * The apparent conflict with UI_SPEC §0.2 resolves cleanly, and LAYOUT_SPEC
 * says how: the four-layer rule governs anything the player can PRESS. A
 * read-only readout is a label, and labels may be translucent. So this capsule
 * is not a flattened object — it is `.cap`, the same tube as the pills, with
 * the same four layers and the same translucent interior. What changed is that
 * there is one of it instead of five, and nothing inside it takes a tap.
 *
 * That last part is why the builder counter could move in here at all: §2.1
 * already requires the builder chip's route to be duplicated in the thumb zone
 * (it is the nav bar's Isla slot now), so the chip's own tap was the redundant
 * copy. The gem `+` keeps its framed pill — premium currency earning emphasis
 * is correct in both references, and the `+` is the one Zone A control that has
 * to stay pressable.
 */

export interface ReadoutCell {
  id: string;
  icon?: string;
  /** Fill colour. Present = this cell draws §3.1's storage state as a thin
   *  progress line along the capsule's bottom edge. Absent = a bare figure. */
  fill?: string;
  /** Accessible name — the cell itself is inert, so this is all a screen
   *  reader gets. */
  label: string;
}

export interface Cell {
  readonly el: HTMLElement;
  /** Numeric value, with §3.9's count-up. `cap` drives the progress line. */
  set(value: number, cap?: number): void;
  /** For the cells whose figure is not a quantity — `1/3`, a rank. */
  setText(text: string): void;
  /** §3.1: pulse only while 2+ producers of this resource are capped. */
  setPressing(on: boolean): void;
  /** §3.4: a free builder must annoy — the portrait tilts, the cell warms. */
  setFree(on: boolean): void;
  /** §3.9 — the white flash when a collected value lands here. */
  hit(): void;
  /** Where a number-flight should land. */
  target(): { x: number; y: number };
}

export interface Readout {
  readonly el: HTMLElement;
  /**
   * Declares the cells, in order. Rebuilds only when the SET changes, so
   * §4.1's staged reveal is a new cell arriving into a capsule the others stay
   * put in — not the whole row being torn down every frame.
   *
   * Returns true when the set actually changed, so the caller can play the
   * reveal beat exactly once.
   */
  sync(cells: ReadoutCell[]): boolean;
  cell(id: string): Cell | undefined;
}

export function createReadout(): Readout {
  // `.cap` is the shared tube (chip.css): ink contour, translucent black
  // interior, hard gloss step, top rim, lip and extrusion.
  const root = el('div', 'cap readout');
  root.append(el('i', 'cap__gloss'), el('i', 'cap__rim'));

  const cells = new Map<string, Cell>();
  let order = '';

  function build(spec: ReadoutCell): Cell {
    const node = el('div', 'readout__cell');
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', spec.label);

    const icon = el('span', 'readout__icon', iconImg(spec.icon, ''));
    alignInk(icon, spec.icon);          // §1.7 — cells align on ink, not on boxes
    const num = el('span', 'num readout__num');
    node.append(icon, num);

    if (spec.fill) {
      // LAYOUT_SPEC §3 settles this shape for the world timers — a dark capsule
      // with "a thin progress line along the capsule's bottom edge so elapsed
      // time is still readable at a glance". A store's fullness is the same
      // problem: the figure alone cannot say whether 1 000 madera is a full
      // Almacén, and §3.10's `¡Lleno!` chip has to have something up here to
      // agree with. The bar is gone; the information is not.
      node.style.setProperty('--fill', spec.fill);
      node.append(el('i', 'readout__bar'));
    }

    const counter = createCounter(num, nc);
    return {
      el: node,
      set(value, cap) {
        if (cap !== undefined && spec.fill) {
          const pct = ratio(value, cap);
          node.style.setProperty('--pct', String(pct));
          node.classList.toggle('is-full', pct >= 1);
        }
        counter.set(value);
      },
      setText(text) {
        if (num.textContent === text) return;
        // §5.3 — a silently mutated counter is a bug. A carpenter coming free
        // and notoriety moving are both changes the player has to catch, and
        // both used to punch on the chips these cells replaced. The first
        // paint is not a change, so it does not.
        const changed = num.textContent !== '';
        num.textContent = text;
        if (changed) punch(num);
      },
      setPressing: (on) => node.classList.toggle('is-pressing', on),
      setFree: (on) => node.classList.toggle('is-free', on),
      hit() {
        node.classList.add('is-hit');
        setTimeout(() => node.classList.remove('is-hit'), 120);
      },
      target() {
        const r = icon.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
    };
  }

  return {
    el: root,
    cell: (id) => cells.get(id),
    sync(spec) {
      const key = spec.map((c) => c.id).join(',');
      if (key === order) return false;
      // The FIRST build is a layout, not a reveal. Every one after it is §4.1's
      // staged reveal — the moment a brand-new currency enters the game.
      const staged = order !== '';
      order = key;

      for (const c of spec) {
        if (cells.has(c.id)) continue;
        const cell = build(c);
        if (staged && !FROZEN) {
          cell.el.classList.add('is-revealing');
          cell.el.addEventListener(
            'animationend',
            () => cell.el.classList.remove('is-revealing'),
            { once: true }
          );
        }
        cells.set(c.id, cell);
      }
      for (const [id, cell] of [...cells]) {
        if (spec.some((c) => c.id === id)) continue;
        cell.el.remove();
        cells.delete(id);
      }
      // Re-appending an element that is already in place is a no-op for the
      // DOM, so a reveal never restarts the other cells' animations.
      root.append(...spec.map((c) => cells.get(c.id)!.el));
      // The dense treatment is a function of how many figures share the width,
      // and it is set here rather than in a media query because the count is
      // the thing that changes — the screen is the same screen.
      root.classList.toggle('is-dense', spec.length >= 5);
      return true;
    },
  };
}
