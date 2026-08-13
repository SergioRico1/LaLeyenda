import './title.css';
import { el, pressable } from '../components/dom';

/**
 * title.ts — the first screen of the game.
 *
 * PRODUCTION.md §1: "Logo, Jugar, Ajustes, and the returning-player state
 * (continue, and what is waiting)." This is the DOM half of that; the living
 * sea behind it belongs to `scenes/titleScene.ts`, which is the only reason
 * these are two files — a menu that has to be beautiful and a backdrop that has
 * to be a scene are different jobs and should not share a module.
 *
 * THE WORDMARK IS THE POINT OF THIS FILE.
 *
 * UI_SPEC §0.2's four layers govern "every raised UI object", and a carved
 * logo is the most raised object the game ever draws, so it gets all four —
 * built out of four stacked copies of the same string rather than out of one
 * <h1> with a stroke on it:
 *
 *   1. contour   → `--ink`, a fat ink stroke around the whole silhouette
 *   2. gloss STEP→ `--face`, the same hard-stop gradient recipe `.btn` uses,
 *                  clipped to the glyphs with background-clip:text
 *   3. warm rim  → `--rim`, a solid warm-white copy nudged UP and painted under
 *                  the face, so all that shows of it is the sliver along the
 *                  top of every letterform
 *   4. lip + drop→ the last stop of the face gradient is the lip colour, and
 *                  `--drop` is a solid ink copy pushed straight down at ZERO
 *                  x-offset, carrying the one soft ground shadow under it
 *
 * The rim is a LAYER and not a `text-shadow` on the face, and that distinction
 * cost a round: a background-clip:text fill is painted in the background phase,
 * so any text-shadow on the same element lands ON TOP of it. The wordmark
 * photographed as flat cream in both lines because the 2px rim was covering
 * every pixel of the gold except the last two rows of each stroke.
 *
 * Type-with-a-stroke gets (1) and nothing else, which is what the seam left and
 * why the wordmark read as a browser heading over a screenshot.
 *
 * Copy lives HERE, in es-ES, never in copy.ts.
 */

const COPY = {
  /** Two lines, two metal families — the lockup device the reference logo uses:
   *  the smaller line in cream, the name itself in gold. */
  markTop: 'La Leyenda',
  markBottom: 'Pirata',
  markFull: 'La Leyenda Pirata',
  play: 'Jugar',
  continue: 'Continuar',
  settings: 'Ajustes',
  /** A cold player has no island yet, so the line is a promise, not a report. */
  tagFresh: 'Un mar sin ley. Una isla por reclamar.',
  tagReturning: 'Tu isla te espera',
  /** Stores want it and it costs nothing. */
  version: 'v0.1.0',
} as const;

export interface TitlePanelOptions {
  /** True when there is a save to come back to — it changes the primary verb
   *  and nothing else, which is exactly how much the difference is worth. */
  returning: boolean;
  /** Shown under the wordmark when returning. */
  captainName?: string | null;
  onPlay(): void;
  onSettings(): void;
}

export interface TitlePanel {
  readonly el: HTMLElement;
  /**
   * What is waiting, for a returning player. Resolved off the save after the
   * first frame, so a cold boot never blocks on IndexedDB.
   */
  setWaiting(items: readonly string[]): void;
  dispose(): void;
}

/**
 * One line of the wordmark, as the four stacked copies §0.2 needs.
 *
 * `--ink` is the only copy in flow, so it defines the box the other two are
 * pinned to; every layer carries an explicit z-index because an absolutely
 * positioned sibling would otherwise paint above the in-flow one whatever the
 * document order said.
 */
function carvedLine(text: string, variant: 'top' | 'bottom'): HTMLElement {
  const line = el('span', `title__line title__line--${variant}`);
  for (const layer of ['drop', 'ink', 'rim', 'face'] as const) {
    const copy = el('span', `title__glyphs title__glyphs--${layer}`, text);
    copy.setAttribute('aria-hidden', 'true');
    line.append(copy);
  }
  return line;
}

export function createTitlePanel(opts: TitlePanelOptions): TitlePanel {
  /**
   * The emblem rule.
   *
   * A logo needs a base or it is set type sitting on a photograph, and every
   * carved game wordmark in both reference sets has one — a plank, a ribbon, a
   * scroll. The full plank was rejected as chrome: an opaque board across the
   * top fifth of a phone hides the sea this screen exists to show. A slim gold
   * bar with a diamond on it does the same structural job for eight pixels of
   * height, and it is built from the same five stops as the gold letters above
   * it, with the same four layers.
   */
  const rule = el('div', 'title__rule',
    el('span', 'title__rule-bar'),
    el('span', 'title__rule-gem'),
    el('span', 'title__rule-bar'));
  rule.setAttribute('aria-hidden', 'true');

  const wordmark = el('h1', 'title__mark',
    carvedLine(COPY.markTop, 'top'),
    carvedLine(COPY.markBottom, 'bottom'),
    rule);
  wordmark.setAttribute('aria-label', COPY.markFull);

  const tagline = el('p', 't t-body title__tag',
    opts.returning
      ? `${COPY.tagReturning}${opts.captainName ? `, ${opts.captainName}` : ''}`
      : COPY.tagFresh);

  /* --- what is waiting -----------------------------------------------------
   * A READ-ONLY line, so LAYOUT_SPEC item 2 applies rather than §0.2: values
   * that are merely read group into one translucent capsule and the world shows
   * through it; only what the player presses is framed. It is deliberately the
   * quietest object on the screen and still the reason they came back. */
  const waitingText = el('span', 't t-body title__waiting-text');
  const waiting = el('p', 'title__waiting', waitingText);
  waiting.hidden = true;

  /**
   * ✎ The CTA carries NO prop, and that is a decision against §6.13's letter.
   *
   * A baked voxel boat was tried at three sizes over two captures. It always
   * lost: the skiff is dark wood on an orange face and needed an ivory pool
   * behind it to read at all, and that pool bleached the left third of the
   * heaviest object on the screen. It also put a second, smaller ship in a
   * frame whose whole subject is a ship.
   *
   * §6.13's target is a HUD tile with a verb printed on it and nothing else.
   * This button answers the same charge a different way: it is the tallest
   * object in the frame, it carries all four layers plus §3.14's inset gloss
   * PLATE rather than a face-wide ramp, and its label is set at display size.
   * It also removes the screen's second model fetch, on the one screen in the
   * game that boots before everything else.
   */
  const playLabel = el('span', 't title__play-label',
    opts.returning ? COPY.continue : COPY.play);
  const play = el('button', 'btn btn--orange title__play', playLabel);
  play.type = 'button';
  play.setAttribute('aria-label', opts.returning ? COPY.continue : COPY.play);
  pressable(play, opts.onPlay);

  const settings = el('button', 'btn btn--grey title__settings',
    el('span', 't t-btn', COPY.settings));
  settings.type = 'button';
  settings.setAttribute('aria-label', COPY.settings);
  pressable(settings, opts.onSettings);

  const version = el('p', 'title__version', COPY.version);

  const root = el('div', 'title layer-page',
    el('div', 'title__crest', wordmark, tagline),
    el('div', 'title__foot', waiting, play, settings, version));

  return {
    el: root,
    setWaiting(items) {
      // The middle dot is the separator the HUD's own readouts use, and two
      // items is the ceiling: a title screen that lists five things the player
      // could do has stopped being a title screen.
      const line = items.slice(0, 2).join(' · ');
      waitingText.textContent = line;
      waiting.hidden = line.length === 0;
    },
    dispose() {
      root.remove();
    },
  };
}
