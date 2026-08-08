import { el, iconImg, pressable } from '../components/dom';
import { createSheet, type Sheet } from './sheet';
import { createCostRow, type CostLike } from './cost';
import { COPY, refusalText, type RefusalKey } from '../copy';
import type { IconSet } from '../icons';

/**
 * buildPicker.ts — §3.15, the half that happens before the ghost.
 *
 *   > Tapping Construir opens a picker of what placeable() allows, showing cost
 *   > and build time and greying what is unaffordable with the reason.
 *
 * One decision worth stating: the list is the whole catalogue, not only what is
 * placeable this second. At Ayuntamiento 1 the island already owns one of every
 * type the hall unlocks, so a picker built strictly on `placeable()` opens onto
 * an empty sheet — the dead tap §3.5 forbids, arrived at by following the
 * game's own blinking Construir badge. The greyed rows are also the only place
 * the player is ever told what the Ayuntamiento is FOR, which makes them the
 * most valuable rows in the panel rather than filler.
 */

export interface BuildOption {
  type: string;
  label: string;
  icon?: string;
  cost: CostLike;
  timeMs: number;
  refusal: RefusalKey | null;
  owned: number;
  allowed: number;
  unlockAtTownHall: number;
  unlocked: boolean;
}

export interface BuildPicker {
  readonly el: HTMLElement;
  /** Rebuilds the list. Cheap enough to call on every open. */
  show(options: BuildOption[], townHall: number): void;
  close(): void;
  readonly isOpen: boolean;
}

export function createBuildPicker(opts: {
  icons: IconSet;
  onPick(type: string): void;
  onClose?(): void;
}): BuildPicker {
  const sheet: Sheet = createSheet({ title: COPY['panel.build'], onClose: opts.onClose });
  const list = el('div', 'well picker__list');
  sheet.body.append(list);

  function row(option: BuildOption, townHall: number): HTMLElement {
    const blocked = option.refusal !== null;
    const node = el('button', `pick-row${blocked ? ' is-blocked' : ''}`);
    node.type = 'button';

    const art = el('span', 'pick-row__art', iconImg(option.icon, ''));
    const head = el('div', 'pick-row__head',
      el('span', 't pick-row__name', option.label),
      el('span', 'num pick-row__count', `${option.owned}/${option.allowed}`)
    );

    const meta = el('div', 'pick-row__meta');
    // A row you cannot take does not need its price shouted; it needs the one
    // sentence that says what to do instead. A row you CAN take shows the two
    // numbers the decision is made on: what it costs and how long it takes.
    if (blocked) {
      meta.append(el('span', 't pick-row__why',
        refusalText(option.refusal!, option.refusal === 'town-hall-too-low' ? option.unlockAtTownHall : undefined)));
      // The price still appears, greyed, so the player can plan for it.
      meta.append(createCostRow({ icons: opts.icons, cost: option.cost, timeMs: option.timeMs }));
    } else {
      meta.append(createCostRow({ icons: opts.icons, cost: option.cost, timeMs: option.timeMs }));
    }

    node.append(art, el('div', 'pick-row__text', head, meta));
    if (!blocked) {
      node.append(el('span', 'btn btn--green pick-row__go', el('span', 't t-btn', COPY['build.place'])));
      pressable(node, () => { sheet.close(); opts.onPick(option.type); });
    } else {
      node.setAttribute('aria-disabled', 'true');
      // Never a dead tap: a blocked row still answers, with a shake and the
      // reason it already carries.
      node.addEventListener('click', () => {
        node.classList.remove('is-refused');
        void node.offsetWidth;
        node.classList.add('is-refused');
        navigator.vibrate?.([12, 40, 12]);
      });
    }
    // Ayuntamiento level ordering puts the reachable rows first without hiding
    // anything, so the ladder still reads top to bottom.
    node.dataset.rank = String((blocked ? 100 : 0) + option.unlockAtTownHall);
    void townHall;
    return node;
  }

  return {
    el: sheet.el,
    get isOpen() { return sheet.isOpen; },
    close: () => sheet.close(),
    show(options, townHall) {
      list.replaceChildren();
      const rows = options.map((o) => row(o, townHall));
      rows.sort((a, b) => Number(a.dataset.rank) - Number(b.dataset.rank));
      list.append(...rows);
      if (rows.length === 0) {
        list.append(el('p', 't picker__empty', 'Nada que construir todavía.'));
      }
      sheet.open();
    },
  };
}
