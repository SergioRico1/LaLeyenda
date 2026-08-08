import { el, iconImg } from '../components/dom';
import { dur, n } from '../format';
import type { IconSet } from '../icons';

/** A resource cost, drawn as one wallet-style row (§3.2) per resource. */
export type CostLike = Partial<Record<'oro' | 'madera' | 'ron' | 'metal', number>>;

export interface CostRowOptions {
  icons: IconSet;
  cost: CostLike;
  /** What the player actually holds, so a shortfall can be shown in red. */
  store?: Record<string, number>;
  timeMs?: number;
}

/**
 * §3.20's cost footer, reduced to the one rule that carries it:
 *
 *   > **Red `#D93A2B` when it is a price you pay; white when it is a quantity
 *   > you receive.**
 *
 * With one addition the spec implies but does not write: a price the player
 * cannot currently meet is the price that matters, and it is drawn in red while
 * the rest stay white. The row is therefore readable at a glance as "which of
 * these four numbers is the one stopping me".
 */
export function createCostRow(opts: CostRowOptions): HTMLElement {
  const row = el('div', 'cost-row');
  const entries = Object.entries(opts.cost).filter(([, v]) => (v ?? 0) > 0);

  if (entries.length === 0) row.append(el('span', 't cost-row__free', 'Gratis'));

  for (const [resource, amount] of entries) {
    const short = opts.store ? (opts.store[resource] ?? 0) + 1e-6 < (amount ?? 0) : false;
    const item = el('span', `cost-item${short ? ' is-short' : ''}`);
    item.append(
      iconImg(opts.icons[resource as keyof IconSet], 'cost-item__icon'),
      el('span', 'num cost-item__n', n(amount ?? 0))
    );
    row.append(item);
  }

  if (opts.timeMs !== undefined) {
    const time = el('span', 'cost-item cost-item--time');
    time.append(el('span', 'cost-item__clock', '⏱'), el('span', 'num cost-item__n'));
    (time.lastElementChild as HTMLElement).innerHTML = dur(opts.timeMs);
    row.append(time);
  }
  return row;
}
