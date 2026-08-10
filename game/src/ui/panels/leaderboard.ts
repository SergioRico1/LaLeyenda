import './leaderboard.css';
import { el, pressable } from '../components/dom';
import { markClock, markX } from './marks';
import { dur, durText, n } from '../format';
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
  row: (r: StandingRow) =>
    `Puesto ${r.rank}: ${r.name}, ${n(r.score)} puntos, ${leagueOf(r.rank).label}`,
  plate: (index: number, remaining: string) =>
    `${COPY.season(index)}, termina en ${remaining}`,
} as const;

/* ==========================================================================
 * the regalia — leagues, shields, the trophy and the crown
 *
 * The round-10 judge: the board needs "league badge art..., a trophy mark by
 * the score, and the player's own pinned row visibly heavier than the rest".
 * Clash's league panel (coc_league.jpg) is a LADDER of material badges —
 * bronze up to titan — so the fifty ranks are cut into four leagues in rising
 * material: madera, bronce, plata, oro. RETENTION.md's ladders all climb by
 * material the same way (the §4.7 rank tiers, the chest rarities), and wood →
 * gold is the reading every player already has.
 *
 * The bands are presentation over the rank rivals.ts deals — a fixed carve of
 * the 50-row board, not a new sim concept: rank IS the standing, the league
 * names the neighbourhood so a glance up the well reads as promotion. When a
 * real backend replaces the seam it will own the cut the same way it owns the
 * season boundary.
 *
 * Every badge is drawn inline in this module (icons.ts is HUD iconography and
 * closed; these are the board's own heraldry): flat facets, §0.2's four layers
 * at badge scale — ink contour, hard gloss step, top rim, dark lip.
 * ======================================================================= */

interface League {
  id: 'oro' | 'plata' | 'bronce' | 'madera';
  label: string;
  from: number;
}

/** Rank bands, top first: podium neighbourhood, then thirds of the pack. */
const LEAGUES: readonly League[] = [
  { id: 'oro', label: 'Liga de Oro', from: 1 },
  { id: 'plata', label: 'Liga de Plata', from: 11 },
  { id: 'bronce', label: 'Liga de Bronce', from: 26 },
  { id: 'madera', label: 'Liga de Madera', from: 41 },
];

function leagueOf(rank: number): League {
  let found = LEAGUES[0];
  for (const l of LEAGUES) if (rank >= l.from) found = l;
  return found;
}

/** Shield materials: gloss, base, lip — §0.2's step rendered in SVG bands. */
const SHIELD: Record<League['id'], [string, string, string]> = {
  oro: ['#FFE083', '#F3BB26', '#8A5B0F'],
  plata: ['#F4F6F8', '#C9CDD3', '#6E7681'],
  bronce: ['#EBAD6E', '#C57C2A', '#6E4213'],
  madera: ['#C89B66', '#A97C46', '#5E4222'],
};

const NS = 'http://www.w3.org/2000/svg';

function shape(d: string, fill: string, ink = false): SVGPathElement {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', fill);
  if (ink) {
    p.setAttribute('class', 'board__ink');
    p.setAttribute('vector-effect', 'non-scaling-stroke');
  }
  return p;
}

function badgeSvg(viewBox: string, cls: string, ...kids: SVGElement[]): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.setAttribute('class', cls);
  s.append(...kids);
  return s;
}

/** The league shield: full silhouette in the lip colour, a shorter one in the
 *  base over it (the visible sliver at the foot is layer 4), a hard gloss
 *  plate across the top (layer 2) and a warm rim inside it (layer 3). */
function shieldSvg(league: League): SVGSVGElement {
  const [gloss, base, lip] = SHIELD[league.id];
  return badgeSvg('0 0 72 84', `board__shield board__shield--${league.id}`,
    shape('M8,4 L64,4 L64,40 C64,61 51,73 36,80 C21,73 8,61 8,40 Z', lip, true),
    shape('M8,4 L64,4 L64,38 C64,56 50,67 36,73 C22,67 8,56 8,38 Z', base),
    shape('M8,4 L64,4 L64,34 L8,34 Z', gloss),
    shape('M11,7 L61,7 L61,10 L11,10 Z', 'rgba(255, 255, 250, 0.6)'));
}

/** The crown rank 1 wears on its shield — the board's single summit mark. */
const crownSvg = (): SVGSVGElement =>
  badgeSvg('0 0 60 34', 'board__crown',
    shape('M6,30 L3,8 L18,17 L30,2 L42,17 L57,8 L54,30 Z', '#F3BB26', true),
    shape('M6.8,24 L53.2,24 L54,30 L6,30 Z', '#D08C10'),
    shape('M26,22 L30,18 L34,22 L30,26 Z', '#D4141A'));

/** The trophy that sits by every score — Clash's trophy column, at 15px. */
const trophySvg = (): SVGSVGElement =>
  badgeSvg('0 0 72 74', 'board__trophy',
    shape('M18,14 C6,14 3,28 14,35 C17,37 20,36 19,32 C12,28 12,20 19,19 Z', '#D08C10', true),
    shape('M54,14 C66,14 69,28 58,35 C55,37 52,36 53,32 C60,28 60,20 53,19 Z', '#D08C10', true),
    shape('M17,6 L55,6 L55,24 C55,38 47,46 36,46 C25,46 17,38 17,24 Z', '#F3BB26', true),
    shape('M17,6 L55,6 L55,15 L17,15 Z', '#FFE083'),
    shape('M23,19 L28,19 L26,34 L22,31 Z', 'rgba(255, 255, 255, 0.5)'),
    shape('M31,46 L41,46 L41,54 L31,54 Z', '#D08C10', true),
    shape('M24,54 L48,54 L48,60 L24,60 Z', '#F3BB26', true),
    shape('M20,60 L52,60 L52,68 L20,68 Z', '#A06E15', true));

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
   * League shield carrying the rank, name, then trophy + score. The player's
   * row is the one gold-banded object in the well; rank 1 wears the crown. */
  const row = (r: StandingRow): HTMLElement => {
    const league = leagueOf(r.rank);
    const node = el('div', `board__row${r.you ? ' board__row--you' : ''}`,
      el('span', 'board__rank',
        shieldSvg(league),
        r.rank === 1 ? crownSvg() : null,
        el('span', 'num board__rank-num', String(r.rank))),
      el('span', 't board__name', r.name),
      r.you ? el('span', 't board__you-chip', COPY.you) : null,
      el('span', 'board__pts',
        trophySvg(),
        el('span', 'num board__score', n(r.score))));
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', COPY.row(r));
    return node;
  };

  /** The quiet caption where the material changes — the ladder made legible:
   *  a small shield of the league and its name, cut into the well. */
  const leagueHead = (league: League): HTMLElement =>
    el('div', `board__league board__league--${league.id}`,
      shieldSvg(league),
      el('span', 't t-micro board__league-name', league.label));

  /* --- the body ------------------------------------------------------------ */

  const body = el('div', 'board__body');
  let yourRow: HTMLElement | null = null;
  let pinned: HTMLElement | null = null;

  const data = opts.standings;
  if (data) {
    const rows: HTMLElement[] = [];
    let currentLeague = '';
    for (const r of data.rows) {
      const league = leagueOf(r.rank);
      if (league.id !== currentLeague) {
        rows.push(leagueHead(league));
        currentLeague = league.id;
      }
      const node = row(r);
      if (r.you) yourRow = node;
      rows.push(node);
    }
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

  // The season is signage, not a sentence: a raised charcoal plate under the
  // title — §0.2's four layers at plate scale — carrying the season's name on
  // one side and the dial + countdown on the other.
  const seasonPlate = el('div', 'board__plate');
  if (data) {
    const remaining = Math.max(0, data.season.endsAt - opts.now);
    const clock = el('span', 'num board__plate-clock');
    clock.innerHTML = dur(remaining);      // formatter output only, never input
    seasonPlate.append(
      el('span', 't board__plate-season', COPY.season(data.season.index)),
      el('i', 'board__plate-sep'),
      markClock('board__plate-dial'),
      el('span', 't board__plate-ends', COPY.endsIn),
      clock
    );
    seasonPlate.setAttribute('role', 'img');
    seasonPlate.setAttribute('aria-label', COPY.plate(data.season.index, durText(remaining)));
  }

  const sheet = el('div', 'board__sheet',
    el('header', 'board__head',
      el('h2', 't t-title board__title', COPY.heading),
      seasonPlate),
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
