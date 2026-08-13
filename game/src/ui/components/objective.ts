import { el, pressable, punch } from './dom';
import { FROZEN } from '../env';

/**
 * objective.ts — LAYOUT_SPEC §4, the persistent objective line.
 *
 * Kingshot keeps one line above the nav bar naming the current goal with its
 * progress — "Aprimorar a Serraria para o Nv. 27 (26/27)". It is the
 * next-action resolver made visible.
 *
 * We already resolve the next action in the sim (§4.8 `nextAction`, handed to
 * the HUD as `HudState.cue`) and spent it only on a glow and a pointer, which
 * says "over there" without ever saying what or why. Saying it in words costs
 * one line and removes all ambiguity about what the game wants next. The text
 * is derived from that same `cue` — there is no second priority list here, and
 * the tap routes to whatever the line names.
 *
 * It is pressable, so it is a physical object with all four layers (§0.2) —
 * LAYOUT_SPEC is explicit that Kingshot's flat controls are the one thing we
 * do NOT take. It wears the light utility family, which recedes against grass
 * and sea: the line has to be the calmest actionable thing on screen or it
 * out-shouts the orange CTA sitting 40px below it.
 */

export interface Objective {
  readonly el: HTMLElement;
  /**
   * `null` hides the line — the resolver returning `none` means the loop is
   * genuinely empty, and a goal line naming nothing is worse than no line.
   */
  set(view: { text: string; count?: string | null } | null): void;
}

/** The chevron, drawn as a prop rather than typed as a dingbat (§6): a
 *  constant-weight stroke with its own contour under it, like every other mark
 *  in the game. A `›` from the system font is a different weight, a different
 *  colour and a different age than everything beside it. */
function chevron(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 24');
  svg.setAttribute('class', 'objective__chev');
  for (const [width, colour] of [[9, '#17130E'], [4.5, '#4A443C']] as const) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M4 5 L11 12 L4 19');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', colour);
    path.setAttribute('stroke-width', String(width));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

export function createObjective(onTap: () => void): Objective {
  const text = el('span', 't objective__text');
  const count = el('span', 'num objective__count');
  // Hidden until there is a figure: an empty span still spends the flex gap,
  // which on a goal with no progress reads as a typo before the chevron.
  count.hidden = true;
  const button = el('button', 'objective btn btn--grey', text, count, chevron());
  button.type = 'button';
  pressable(button, onTap);

  // The row, not the button, is what is positioned: `.btn`'s press travel owns
  // `transform`, so a centring transform on the button itself would be thrown
  // away on every press.
  const row = el('div', 'objective-row', button);

  let goal = '';
  let progress = '';

  return {
    el: row,
    set(view) {
      if (!view) {
        row.hidden = true;
        goal = '';
        progress = '';
        return;
      }
      row.hidden = false;
      const next = view.count ?? '';

      if (view.text !== goal) {
        // A NEW GOAL. §5.3 says a state change the player has to catch is never
        // silent, and §5 law 1 says a thing that was not there arrives by
        // travelling rather than by appearing in place. A `punch` is the wrong
        // beat here — that is a numeral's beat, and a 1.15 scale on a 280px
        // line is a lurch — so the line rises the 8px it came up from.
        const replaced = goal !== '';
        goal = view.text;
        text.textContent = view.text;
        if (replaced && !FROZEN) {
          button.classList.remove('is-new');
          void button.offsetWidth;             // restart on a repeat
          button.classList.add('is-new');
        }
      }

      if (next !== progress) {
        // The progress figure IS a counter, so it punches like every other one.
        const moved = progress !== '';
        progress = next;
        count.textContent = next;
        count.hidden = !next;
        if (moved && next) punch(count);
      }

      button.setAttribute('aria-label', view.text + (next ? ' ' + next : ''));
    },
  };
}
