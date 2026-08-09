import './title.css';
import { el, pressable } from '../components/dom';

/**
 * title.ts — the first screen of the game.
 *
 * PRODUCTION.md §1: "Logo, Jugar, Ajustes, and the returning-player state
 * (continue, and what is waiting)." This is the DOM half of that; the animated
 * sea behind it belongs to `scenes/titleScene.ts`, which is the only reason
 * these are two files — a menu that has to be beautiful and a backdrop that has
 * to be a scene are different jobs and should not share a module.
 *
 * ✎ SEAM. This is deliberately a small, correct, navigable screen rather than a
 * finished one. What is settled here and should not move: the panel takes its
 * callbacks and returns `{ el, dispose }`, the copy lives in THIS file (es-ES,
 * never in copy.ts), and the primary button carries the whole decision — Jugar
 * against Continuar — so the router never has to know which words are on it.
 * Everything else is for the builder who makes this screen the thing a player
 * meets first: the wordmark is type where it wants to be art, and there is no
 * "what is waiting" summary yet beyond the captain's own name.
 */

const COPY = {
  wordmarkTop: 'La Leyenda',
  wordmarkBottom: 'Pirata',
  play: 'Jugar',
  continue: 'Continuar',
  settings: 'Ajustes',
  /** A cold player has no island yet, so the line is a promise, not a report. */
  tagFresh: 'Un mar sin ley. Una isla por reclamar.',
  tagReturning: 'Tu isla te espera',
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
  dispose(): void;
}

export function createTitlePanel(opts: TitlePanelOptions): TitlePanel {
  const wordmark = el('h1', 'title__mark',
    el('span', 't title__mark-a', COPY.wordmarkTop),
    el('span', 't title__mark-b', COPY.wordmarkBottom));

  const tagline = el('p', 't t-body title__tag',
    opts.returning
      ? `${COPY.tagReturning}${opts.captainName ? `, ${opts.captainName}` : ''}`
      : COPY.tagFresh);

  const play = el('button', 'btn btn--orange title__play',
    el('span', 't t-btn', opts.returning ? COPY.continue : COPY.play));
  play.type = 'button';
  play.setAttribute('aria-label', opts.returning ? COPY.continue : COPY.play);
  pressable(play, opts.onPlay);

  const settings = el('button', 'btn btn--grey title__settings',
    el('span', 't t-btn', COPY.settings));
  settings.type = 'button';
  settings.setAttribute('aria-label', COPY.settings);
  pressable(settings, opts.onSettings);

  const root = el('div', 'title layer-page',
    el('div', 'title__crest', wordmark, tagline),
    el('div', 'title__actions', play, settings));

  return {
    el: root,
    dispose() {
      root.remove();
    },
  };
}
