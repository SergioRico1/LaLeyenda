import { el, iconImg, pressable } from '../components/dom';
import { createSheet, type Sheet } from './sheet';
import { createCostRow, type CostLike } from './cost';
import { COPY, refusalText, type RefusalKey } from '../copy';
import { createTimerBar } from '../components/timerBar';
import { dur, n } from '../format';
import type { IconSet } from '../icons';

/**
 * upgradeSheet.ts — §3.16, from the bottom of the screen (§4.10 beat 0:45).
 *
 * The panel a building opens. It has exactly two faces, because a building has
 * exactly two states:
 *
 *   IDLE     level · what the next level gives · cost · time · green CTA.
 *   WORKING  the timer it is already running, and §4.4's gem price to end it.
 *
 * The refusal rule (§3.5) is what most of this file is for. A CTA that cannot
 * fire is never removed and never left inert: it goes grey, keeps its place,
 * and the line under it names the missing key. "Recursos insuficientes" and
 * "Sin constructores libres" are different problems with different answers, and
 * a player who is told which one they have can act on it.
 */

export interface GainLine {
  metric: 'rate' | 'capacity' | 'storage';
  from: number;
  to: number;
}

export interface UpgradeView {
  buildingId: number;
  label: string;
  icon?: string;
  level: number;
  /** Absent at max level, or while a build job is running. */
  plan?: { toLevel: number; cost: CostLike; timeMs: number };
  gains: GainLine[];
  /** The Ayuntamiento's real payload: what its next level opens. */
  unlocks?: readonly string[];
  refusal: RefusalKey | null;
  /** Present only while a builder is on it. */
  work?: { toLevel: number; remainingMs: number; totalMs: number; gems: number };
  gems: number;
  store: Record<string, number>;
  /** For "Requiere Ayuntamiento N" when the ceiling is the hall. */
  townHallNeeded?: number;
}

export interface UpgradeSheet {
  readonly el: HTMLElement;
  show(view: UpgradeView): void;
  /** Re-renders in place if this building is the one on screen. */
  refresh(view: UpgradeView): void;
  close(): void;
  readonly isOpen: boolean;
  readonly buildingId: number | null;
  /** Runs the visible countdown between sim ticks. */
  tick(elapsed: number): void;
}

const GAIN_LABEL: Record<GainLine['metric'], string> = {
  rate: COPY['sheet.rate'],
  capacity: COPY['sheet.capacity'],
  storage: COPY['sheet.storage'],
};

export function createUpgradeSheet(opts: {
  icons: IconSet;
  onUpgrade(buildingId: number): void;
  onFinishNow(buildingId: number): void;
  onClose?(): void;
}): UpgradeSheet {
  const sheet: Sheet = createSheet({ onClose: opts.onClose });

  const art = el('span', 'sheet__art', iconImg(undefined, ''));
  const level = el('span', 'num sheet__level');
  const identity = el('div', 'sheet__identity', art, level);
  const detail = el('div', 'well sheet__detail');
  sheet.body.append(identity, detail);

  const cta = el('button', 'btn btn--green sheet__cta', el('span', 't t-btn', COPY['cta.upgrade']));
  cta.type = 'button';
  const why = el('p', 't sheet__why');
  sheet.footer.append(why, cta);

  let current: UpgradeView | null = null;
  const bar = createTimerBar();
  /** Scene seconds at which `work.remainingMs` was last supplied by the sim. */
  let setAt = 0;
  let elapsedNow = 0;

  pressable(cta, () => {
    if (!current) return;
    if (current.work) opts.onFinishNow(current.buildingId);
    else opts.onUpgrade(current.buildingId);
  });

  function render(view: UpgradeView): void {
    current = view;
    sheet.setTitle(view.label);
    (art.firstElementChild as HTMLImageElement).src = view.icon ?? '';
    art.classList.toggle('is-blank', !view.icon);
    detail.replaceChildren();

    /* --- WORKING: the timer and §4.4's price to end it -------------------- */
    if (view.work) {
      level.textContent = `${COPY['sheet.level']} ${view.level} → ${view.work.toLevel}`;
      bar.set(view.work.remainingMs, view.work.totalMs);
      detail.append(
        el('div', 't sheet__row-label', COPY['sheet.working']),
        el('div', 'sheet__timer', bar.el)
      );

      const affordable = view.gems >= view.work.gems;
      cta.className = `btn ${affordable ? 'btn--gold' : 'btn--grey2'} sheet__cta`;
      cta.replaceChildren(
        el('span', 't t-btn', 'Terminar Ya'),
        el('span', 'sheet__cta-price',
          iconImg(opts.icons.gema, 'sheet__gem'),
          el('span', 'num', n(view.work.gems)))
      );
      cta.disabled = false;
      why.textContent = affordable ? '' : refusalText('not-enough-gems');
      why.hidden = affordable;
      return;
    }

    /* --- IDLE ------------------------------------------------------------- */
    level.textContent = `${COPY['sheet.level']} ${view.level}`;

    if (!view.plan) {
      detail.append(el('div', 't sheet__row-label', COPY['sheet.maxLevel']));
      cta.className = 'btn btn--grey2 sheet__cta';
      cta.replaceChildren(el('span', 't t-btn', COPY['cta.upgrade']));
      cta.disabled = true;
      why.textContent = refusalText('max-level');
      why.hidden = false;
      return;
    }

    detail.append(el('div', 't sheet__row-label', `${COPY['sheet.next']} · Nv${view.plan.toLevel}`));

    // The before → after table. Every figure comes from the same level row the
    // sim charges against, so the sheet cannot advertise a number the economy
    // will not then deliver.
    for (const gain of view.gains) {
      const suffix = gain.metric === 'rate' ? COPY['sheet.perHour'] : '';
      detail.append(el('div', 'gain',
        el('span', 't gain__label', GAIN_LABEL[gain.metric]),
        el('span', 'num gain__from', `${n(gain.from)}${suffix}`),
        el('span', 'gain__arrow', '→'),
        el('span', 'num gain__to', `${n(gain.to)}${suffix}`)
      ));
    }

    if (view.unlocks?.length) {
      detail.append(el('div', 'gain gain--unlocks',
        el('span', 't gain__label', COPY['sheet.unlocks']),
        el('span', 't gain__to', view.unlocks.join(' · '))
      ));
    }

    detail.append(el('div', 'sheet__price',
      createCostRow({
        icons: opts.icons,
        cost: view.plan.cost,
        store: view.store,
        timeMs: view.plan.timeMs,
      })
    ));

    const blocked = view.refusal !== null;
    cta.className = `btn ${blocked ? 'btn--grey2' : 'btn--green'} sheet__cta`;
    cta.replaceChildren(
      el('span', 't t-btn', COPY['cta.upgrade']),
      el('span', 'num sheet__cta-time')
    );
    (cta.lastElementChild as HTMLElement).innerHTML = dur(view.plan.timeMs);
    cta.disabled = false;   // never inert: it answers with the reason
    why.textContent = blocked
      ? refusalText(view.refusal!, view.refusal === 'town-hall-too-low' ? view.townHallNeeded : undefined)
      : '';
    why.hidden = !blocked;
    cta.classList.toggle('is-blocked', blocked);
  }

  return {
    el: sheet.el,
    get isOpen() { return sheet.isOpen; },
    get buildingId() { return sheet.isOpen && current ? current.buildingId : null; },
    close: () => sheet.close(),
    show(view) {
      setAt = elapsedNow;
      render(view);
      sheet.open();
    },
    refresh(view) {
      if (!sheet.isOpen || !current || current.buildingId !== view.buildingId) return;
      setAt = elapsedNow;
      render(view);
    },
    tick(elapsed) {
      elapsedNow = elapsed;
      if (!sheet.isOpen || !current?.work) return;
      const since = (elapsed - setAt) * 1000;
      bar.set(Math.max(0, current.work.remainingMs - since), current.work.totalMs);
    },
  };
}
