import './diario.css';
import { el, iconImg, pressable } from '../components/dom';
import { markClock, markX } from './marks';
import { dur, durText, n } from '../format';
import { sfx } from '../sfx';
import {
  BALANCE, dailyAvailable, dailyReward, questComplete,
  type DailyDay, type GameState, type Quest,
} from '../../sim';
import { season } from '../../sim/rivals';
import type { IconSet } from '../icons';

/**
 * diario.ts — el Diario de a Bordo. Round 11's playtest, finding 5: the nav
 * slot "auto-claims quest rewards as bare toasts without ever showing the
 * quest list that exists in the save". This is the panel that list lives in.
 *
 * One screen, Kingshot's chrome budget: a single cream sheet (the family
 * Ajustes → Tienda → Clasificación established), the seven-day chain as a row
 * of small raised cells, the three dailies in ONE dark well with progress
 * bars, the corona line that explains why quests are worth doing daily, and
 * the season plate under the title — RETENTION.md's three clocks, on one page,
 * top to bottom: today (quests), this week (the chain), this month (the
 * season).
 *
 * CLAIMING STAYS EXPLICIT. The panel never claims anything by being opened;
 * every reward leaves through a button with the reward printed on it. The two
 * hooks dispatch into the sim and hand back the new state through `refresh`.
 */

/* ==========================================================================
 * copy — es-ES, and it stays in this module (house rule: never copy.ts)
 * ======================================================================= */

const COPY = {
  heading: 'Diario de a Bordo',
  close: 'Cerrar',
  daily: 'Recompensa Diaria',
  day: (d: number) => `Día ${d}`,
  claimDay: (d: number) => `Reclamar Día ${d}`,
  claimedToday: 'Hoy ya está reclamado: mañana te espera el siguiente',
  quests: 'Misiones de Hoy',
  claim: 'Reclamar',
  done: 'Hecho',
  crown: (have: number, at: number) => `Coronas ${have}/${at}`,
  crownChest: 'Cofre de la Corona',
  season: (index: number) => `Temporada ${index + 1}`,
  endsIn: 'Termina en',
  refresh: 'Misiones nuevas cada día a las 04:00',
  questRow: (q: Quest) => `${q.text} — ${q.progress} de ${q.target}` +
    (q.claimed ? ', reclamada' : q.progress >= q.target ? ', lista para reclamar' : ''),
  builderLoan: 'Carpintero 24h',
} as const;

/* ==========================================================================
 * the corona — the Diario's own heraldry, drawn (never a dingbat)
 * ======================================================================= */

const NS = 'http://www.w3.org/2000/svg';

function shape(d: string, fill: string, ink = false): SVGPathElement {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', fill);
  if (ink) {
    p.setAttribute('class', 'diario__ink');
    p.setAttribute('vector-effect', 'non-scaling-stroke');
  }
  return p;
}

/** The corona quests pay — same crown the leaderboard's rank 1 wears, at coin
 *  scale: gold body over a dark lip, one ruby, ink contour outside. */
function crownSvg(cls = 'diario__crown-mark'): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 60 34');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', cls);
  svg.append(
    shape('M6,30 L3,8 L18,17 L30,2 L42,17 L57,8 L54,30 Z', '#F3BB26', true),
    shape('M6.8,24 L53.2,24 L54,30 L6,30 Z', '#D08C10'),
    shape('M26,22 L30,18 L34,22 L30,26 Z', '#D4141A')
  );
  return svg;
}

/** The drawn check a claimed cell wears — marks.ts's letterform at chip size. */
function checkSvg(cls: string): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 72');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', cls);
  svg.append(shape('M0,37.7 L31.3,71.4 L100,15.6 L87.3,0 L33.3,43.9 L14.8,24 Z', '#FFFFFF', true));
  return svg;
}

/* ==========================================================================
 * options
 * ======================================================================= */

export interface DiarioPanelOptions {
  state: GameState;
  /** The game's clock, never Date — a capture must stay deterministic. */
  now: number;
  icons: IconSet;
  /** Claim the daily-chain day on screen. The panel re-renders via refresh. */
  onClaimDaily(): void;
  /** Claim one finished quest, by its index in `state.quests.daily`. */
  onClaimQuest(index: number): void;
  onClose(): void;
}

export interface DiarioPanel {
  readonly el: HTMLElement;
  /** Redraws from a fresh state — the owner calls it after every claim. */
  refresh(state: GameState, now: number): void;
  dispose(): void;
}

/* ==========================================================================
 * the panel
 * ======================================================================= */

export function createDiarioPanel(opts: DiarioPanelOptions): DiarioPanel {
  let state = opts.state;
  let now = opts.now;

  /* --- one day cell of the chain -----------------------------------------
   * Each is a small §0.2 object: ink contour, gloss step, warm rim, dark lip
   * (diario.css). The reward is the cell's face — icon + figure — because a
   * chain the player cannot read is a row of mystery boxes. */
  const dayCell = (day: DailyDay, status: 'claimed' | 'today' | 'ahead'): HTMLElement => {
    // ONE icon and ITS OWN figure — a cell that shows the oro icon with the
    // madera amount (day 5 pays both) is a small lie at a glance. The face is
    // the day's headline reward: a chest beats gems beats the bigger resource.
    const face = ((): { icon: string | undefined; figure: string } => {
      if (day.chest) return { icon: opts.icons.cofres, figure: '' };
      if (day.gems) return { icon: opts.icons.gema, figure: n(day.gems) };
      const oro = day.resources?.oro ?? 0;
      const madera = day.resources?.madera ?? 0;
      return oro > madera
        ? { icon: opts.icons.oro, figure: n(oro) }
        : { icon: opts.icons.madera, figure: madera > 0 ? n(madera) : '' };
    })();

    const cell = el('div', `diario__day is-${status}${day.featured ? ' is-featured' : ''}`,
      el('span', 't t-micro diario__day-num', COPY.day(day.day)),
      iconImg(face.icon, 'diario__day-icon'),
      face.figure ? el('span', 'num diario__day-amount', face.figure) : null,
      status === 'claimed' ? el('span', 'diario__day-check', checkSvg('diario__check')) : null
    );
    cell.setAttribute('role', 'img');
    cell.setAttribute('aria-label', `${COPY.day(day.day)}${status === 'claimed' ? ', reclamado' : status === 'today' ? ', hoy' : ''}`);
    return cell;
  };

  /* --- one quest row ------------------------------------------------------ */
  const questRow = (quest: Quest, index: number): HTMLElement => {
    const pct = Math.max(0, Math.min(1, quest.target > 0 ? quest.progress / quest.target : 0));
    const bar = el('div', 'diario__bar',
      el('i', 'diario__bar-fill'),
      el('span', 'num diario__bar-count', `${n(quest.progress)}/${n(quest.target)}`));
    bar.style.setProperty('--pct', String(pct));

    const reward = el('span', 'diario__quest-pay',
      iconImg(opts.icons.gema, 'diario__pay-gem'),
      el('span', 'num diario__pay-num', n(BALANCE.quests.reward.gemas)),
      crownSvg('diario__pay-crown'),
      el('span', 'num diario__pay-num', n(BALANCE.quests.reward.coronas)));

    let action: HTMLElement;
    if (quest.claimed) {
      action = el('span', 'diario__quest-done', checkSvg('diario__check'), el('span', 't t-micro', COPY.done));
    } else if (questComplete(quest)) {
      const btn = el('button', 'btn btn--green diario__claim', el('span', 't t-btn', COPY.claim)) as HTMLButtonElement;
      btn.type = 'button';
      btn.setAttribute('aria-label', `${COPY.claim}: ${quest.text}`);
      pressable(btn, () => { sfx('pop'); opts.onClaimQuest(index); });
      action = btn;
    } else {
      action = reward;
    }

    const row = el('div', `diario__quest${quest.claimed ? ' is-claimed' : ''}`,
      el('div', 'diario__quest-main',
        el('p', 't diario__quest-text', quest.text),
        bar),
      el('div', 'diario__quest-side', quest.claimed || !questComplete(quest) ? action : el('div', 'diario__quest-stack', reward, action))
    );
    if (!(action instanceof HTMLButtonElement)) {
      row.setAttribute('role', 'img');
      row.setAttribute('aria-label', COPY.questRow(quest));
    }
    return row;
  };

  /* --- the body, rebuilt on every refresh --------------------------------- */
  const body = el('div', 'diario__body');

  function render(): void {
    const today = dailyReward(state);
    const claimable = dailyAvailable(state, now);
    const crownAt = BALANCE.chests.crownChest.at;
    const coronas = state.quests.coronas;

    /* the seven-day chain */
    const days = el('div', 'diario__days');
    for (const day of BALANCE.daily.days) {
      const status = day.day < state.daily.day ? 'claimed' : day.day === state.daily.day && claimable ? 'today' : 'ahead';
      days.append(dayCell(day, status));
    }

    let claimRow: HTMLElement;
    if (claimable) {
      const btn = el('button', 'btn btn--green diario__claim diario__claim--daily',
        el('span', 't t-btn', COPY.claimDay(today.day.day))) as HTMLButtonElement;
      btn.type = 'button';
      pressable(btn, () => { sfx('pop'); opts.onClaimDaily(); });
      claimRow = el('div', 'diario__claim-row', btn);
    } else {
      claimRow = el('p', 't t-micro diario__wait', COPY.claimedToday);
    }

    /* the quests, in one dark well */
    const well = el('div', 'diario__well',
      ...state.quests.daily.map((quest, index) => questRow(quest, index)));

    /* the corona line: why dailies compound */
    const crownPct = Math.max(0, Math.min(1, crownAt > 0 ? coronas / crownAt : 0));
    const crownBar = el('div', 'diario__bar diario__bar--crown',
      el('i', 'diario__bar-fill'),
      el('span', 'num diario__bar-count', `${n(coronas)}/${n(crownAt)}`));
    crownBar.style.setProperty('--pct', String(crownPct));
    const crown = el('div', 'diario__crown',
      crownSvg(),
      el('div', 'diario__crown-main',
        el('span', 't t-micro diario__crown-label', COPY.crown(coronas, crownAt)),
        crownBar),
      iconImg(opts.icons.cofres, 'diario__crown-chest'));
    crown.setAttribute('role', 'img');
    crown.setAttribute('aria-label', `${COPY.crown(coronas, crownAt)} — ${COPY.crownChest}`);

    body.replaceChildren(
      el('div', 'diario__caption', el('span', 't t-micro diario__caption-text', COPY.daily)),
      days,
      claimRow,
      el('div', 'diario__caption', el('span', 't t-micro diario__caption-text', COPY.quests)),
      well,
      crown,
      el('p', 't t-micro diario__hint', COPY.refresh)
    );
  }

  /* --- the shell ----------------------------------------------------------- */

  const close = el('button', 'btn btn--red btn-x diario__x', markX('diario__x-mark')) as HTMLButtonElement;
  close.type = 'button';
  close.setAttribute('aria-label', COPY.close);
  pressable(close, opts.onClose);

  const scrim = el('div', 'diario__scrim');
  scrim.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    opts.onClose();
  });

  // The season plate — the month-scale clock, same object the Clasificación
  // wears, because the two panels are naming the same season.
  const s = season(now);
  const clock = el('span', 'num diario__plate-clock');
  clock.innerHTML = dur(Math.max(0, s.endsAt - now));   // formatter output only
  const plate = el('div', 'diario__plate',
    el('span', 't diario__plate-season', COPY.season(s.index)),
    el('i', 'diario__plate-sep'),
    markClock('diario__plate-dial'),
    el('span', 't diario__plate-ends', COPY.endsIn),
    clock);
  plate.setAttribute('role', 'img');
  plate.setAttribute('aria-label', `${COPY.season(s.index)}, termina en ${durText(Math.max(0, s.endsAt - now))}`);

  const sheet = el('div', 'diario__sheet',
    el('header', 'diario__head',
      el('h2', 't t-title diario__title', COPY.heading),
      plate),
    body,
    close);

  const root = el('div', 'diario layer-page', scrim, sheet);
  render();

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') opts.onClose();
  };
  document.addEventListener('keydown', onKey);

  return {
    el: root,
    refresh(nextState, nextNow) {
      state = nextState;
      now = nextNow;
      render();
    },
    dispose() {
      document.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
