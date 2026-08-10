import './leaderboard.css';
import { el, pressable } from '../components/dom';
import { markX } from './marks';
import { dur, n } from '../format';
import { SHOT } from '../env';
import { standings, type Standings, type StandingRow } from '../../sim/rivals';
import type { GameState } from '../../sim/types';

/**
 * leaderboard.ts — la Clasificación. PRODUCTION.md §5's leaderboard: rank,
 * name, score, the player's own row pinned and visible even when ranked 40th,
 * and the season countdown. Fifty rows — the captain and the 49 seeded rival
 * captains src/sim/rivals.ts deals — inside the cream sheet Ajustes
 * established, with the list in one dark well at Kingshot's density.
 *
 * The panel is dumb on purpose: it draws whatever `Standings` it is handed
 * and never computes a score itself, so the day the fetch below returns real
 * players instead of ghosts, nothing here changes.
 */

/* ==========================================================================
 * ✎ SEAM — the backend fetch goes here, and ONLY here.
 *
 * A real leaderboard needs a server, which PLAN.md's offline scope forbids;
 * this function is the whole of that contradiction, resolved locally. Its
 * body today is one call into the pure sim (src/sim/rivals.ts), which ranks
 * the player against seeded rivals whose scores advance as a function of
 * time. To ship a real one: replace the body with the API call —
 *
 *   GET /seasons/current/standings?around=<playerId>  →  Standings
 *
 * keeping the same shape (a season with an end time, 50 ranked rows, the
 * player's row flagged `you`), submit `playerScore(state)` on the same
 * request, and let the server own the season boundary that SEASON_EPOCH pins
 * locally today. The caller already treats this as async and fallible — a
 * rejection renders the panel's offline face rather than a blank sheet — so
 * nothing above this line changes.
 * ======================================================================= */
export async function fetchStandings(state: GameState, now: number): Promise<Standings> {
  return standings(state, now);
}

/* ==========================================================================
 * copy — es-ES, and it stays in this module (house rule: never copy.ts)
 * ======================================================================= */

const COPY = {
  heading: 'Clasificación',
  close: 'Cerrar',
  season: (index: number) => `Temporada ${index + 1}`,
  endsIn: 'Termina en',
  you: 'Tú',
  /** How the score moves — the one line that turns a table into a goal. */
  hint: 'Ganas puntos construyendo, mejorando edificios y despejando tu isla.',
  offline: 'No se pudo cargar la clasificación.',
  offlineTip: 'Vuelve a intentarlo en un rato.',
  row: (r: StandingRow) => `Puesto ${r.rank}: ${r.name}, ${n(r.score)} puntos`,
} as const;

/* ==========================================================================
 * options
 * ======================================================================= */

export interface LeaderboardPanelOptions {
  /** Whatever the seam produced, or null when it failed — the offline face. */
  standings: Standings | null;
  /** The instant the countdown is measured from (the game's clock, not Date). */
  now: number;
  onClose(): void;
}

export interface LeaderboardPanel {
  readonly el: HTMLElement;
  dispose(): void;
}

/* ==========================================================================
 * the panel
 * ======================================================================= */

export function createLeaderboardPanel(opts: LeaderboardPanelOptions): LeaderboardPanel {
  /**
   * ✎ A capture knob, not a product feature — read ONLY under `?shot=1`.
   * The list auto-centres on the player's row (that is the product), which
   * makes the podium the one state a capture cannot otherwise reach:
   *
   *   npm run shoot -- island --mobile --act leaderboard --panel top
   */
  const knob = SHOT ? new URLSearchParams(location.search).get('panel') : null;

  /* --- a row ---------------------------------------------------------------
   * Rank, name, score. The top three wear medal plates; the player's row is
   * the one gold-framed object in the well. */
  const row = (r: StandingRow): HTMLElement => {
    const medal = r.rank <= 3 ? ` board__rank--m${r.rank}` : '';
    const node = el('div', `board__row${r.you ? ' board__row--you' : ''}`,
      el('span', `num board__rank${medal}`, String(r.rank)),
      el('span', 't board__name', r.name),
      r.you ? el('span', 't board__you-chip', COPY.you) : null,
      el('span', 'num board__score', n(r.score)));
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', COPY.row(r));
    return node;
  };

  /* --- the body ------------------------------------------------------------ */

  const body = el('div', 'board__body');
  let yourRow: HTMLElement | null = null;
  let pinned: HTMLElement | null = null;

  const data = opts.standings;
  if (data) {
    const rows = data.rows.map((r) => {
      const node = row(r);
      if (r.you) yourRow = node;
      return node;
    });
    body.append(
      el('div', 'board__well', ...rows),
      el('p', 't t-micro board__hint', COPY.hint)
    );
    // The pinned strip: the player's row again, OUTSIDE the scroll, so rank
    // 40 is readable without hunting for yourself. It is the same object the
    // in-list row is, deliberately — one thing, seen twice.
    pinned = el('div', 'board__me', row(data.you));
  } else {
    body.append(
      el('div', 'board__offline',
        el('p', 't t-caption board__offline-title', COPY.offline),
        el('p', 't t-body board__offline-tip', COPY.offlineTip))
    );
  }

  /* --- the shell ----------------------------------------------------------- */

  const close = el('button', 'btn btn--red btn-x board__x', markX('board__x-mark'));
  close.type = 'button';
  close.setAttribute('aria-label', COPY.close);
  pressable(close, opts.onClose);

  const scrim = el('div', 'board__scrim');
  scrim.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    opts.onClose();
  });

  const seasonLine = el('p', 't t-micro board__season');
  if (data) {
    const remaining = Math.max(0, data.season.endsAt - opts.now);
    const clock = el('span', 'num board__season-clock');
    clock.innerHTML = dur(remaining);      // formatter output only, never input
    seasonLine.append(
      el('span', 'board__season-name', COPY.season(data.season.index)),
      el('i', 'board__season-dot'),
      el('span', 'board__season-ends', `${COPY.endsIn} `),
      clock
    );
  }

  const sheet = el('div', 'board__sheet',
    el('header', 'board__head',
      el('h2', 't t-title board__title', COPY.heading),
      seasonLine),
    body,
    pinned,
    close);

  const root = el('div', 'board layer-page', scrim, sheet);

  // The product behaviour: open ON yourself, mid-pack, the way Clash lands
  // you on your own row — the podium is one flick up. After layout, or there
  // is no scroll extent to centre within yet.
  if (yourRow && knob !== 'top') {
    const target = yourRow as HTMLElement;
    requestAnimationFrame(() => {
      const want = target.offsetTop - body.clientHeight / 2 + target.offsetHeight / 2;
      body.scrollTop = Math.max(0, want);
    });
  }

  /**
   * The pin earns its place only while the real row is off screen. With the
   * list opening centred on the player, leaving it up meant every open showed
   * the same gold row TWICE — at rank 50 stacked within a thumb's width of
   * each other, which photographs as a rendering bug. Synchronous on scroll
   * rather than an IntersectionObserver, because a frozen capture has no spare
   * frame for an async callback to land in.
   */
  const syncPinned = (): void => {
    if (!pinned || !yourRow) return;
    const top = yourRow.offsetTop - body.scrollTop;
    const visible = top > -8 && top + yourRow.offsetHeight < body.clientHeight + 8;
    pinned.hidden = visible;
  };
  body.addEventListener('scroll', syncPinned, { passive: true });
  requestAnimationFrame(syncPinned);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') opts.onClose();
  };
  document.addEventListener('keydown', onKey);

  return {
    el: root,
    dispose() {
      document.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
