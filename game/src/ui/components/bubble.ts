import { el, iconImg } from './dom';

/**
 * §3.9 — the collection bubble.
 *
 * Contour wraps the square AND the tail as ONE silhouette, so the shape is a
 * single SVG path: a div with a rotated pseudo-element leaves a seam exactly
 * where the reference has none.
 *
 * The tail is 14px long and offset ~30% LEFT of centre — the reference offsets
 * it, and centring it is one of those small wrongnesses that add up.
 */

const W = 46, H = 62, R = 9.5;
/** Where inside the drawn box the tail tip is, as a fraction — the world
 *  anchor lines up with this point, not with the middle of the bubble. */
export const BUBBLE_TIP = { x: 15 / W, y: 60.5 / H };

const PATH = [
  'M 11,1.5',
  'H 35', `A ${R},${R} 0 0 1 44.5,11`,
  'V 36.5', `A ${R},${R} 0 0 1 35,46`,
  'H 21.5', 'L 15,60.5', 'L 11,46',
  `A ${R},${R} 0 0 1 1.5,36.5`,
  'V 11', `A ${R},${R} 0 0 1 11,1.5`,
  'Z',
].join(' ');

export interface Bubble {
  readonly el: HTMLElement;
  readonly amount: number;
  /** scale 1 → 1.25 → 0 over 160ms; resolves when the shape is gone. */
  burst(): Promise<void>;
}

export function createBubble(opts: {
  icon?: string;
  amount: number;
  /** 0–1: staggers the bob so a row of bubbles never syncs. */
  phase?: number;
  onTap?: (bubble: Bubble) => void;
}): Bubble {
  const root = el('div', 'bubble');
  root.setAttribute('role', 'button');
  root.setAttribute('aria-label', `Recoger ${opts.amount}`);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PATH);
  // Translucent — the world reads through the bubble (§3.9).
  path.setAttribute('fill', 'rgba(236,238,228,.78)');
  path.setAttribute('stroke', '#17130E');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);

  root.append(svg, el('span', 'bubble__icon', iconImg(opts.icon, '')));

  // Phase-offset per bubble, applied as a negative delay so every bubble is
  // already mid-loop rather than all starting from the same pose.
  root.style.animationDelay = `${-(opts.phase ?? 0) * 1.6}s`;
  root.classList.add('bubble__bob');

  const bubble: Bubble = {
    el: root,
    amount: opts.amount,
    burst() {
      return new Promise<void>((resolve) => {
        root.classList.add('is-bursting');
        setTimeout(() => { root.remove(); resolve(); }, 170);
      });
    },
  };

  if (opts.onTap) root.addEventListener('click', () => opts.onTap!(bubble));
  return bubble;
}
