import './tutorial.css';
import { el, pressable } from './components/dom';

/**
 * tutorial.ts — the director for the first ninety seconds.
 *
 * OPENING.md gave the tutorial its job: the island starts with the Ayuntamiento
 * and nothing else, the ground is covered in obstacles, and the player is 50
 * madera short of their first Aserradero. So the first instruction is obvious
 * and physical — clear that palm, then build on the ground it freed — and the
 * beats below say exactly that.
 *
 * Two rules from PRODUCTION.md §1, both structural rather than cosmetic:
 *
 *   · **Skippable.** `Saltar` is on every beat, not buried on the first.
 *   · **It must never block on a timer a real player would simply wait out.**
 *     Nothing here waits: the card advances on a TAP. A beat that gated on the
 *     sim reaching a state would sooner or later gate on a five-minute build,
 *     and a tutorial that makes a player stare at a countdown is a tutorial
 *     they close the app during.
 *
 * ✎ SEAM. This is the director and the card. What it does NOT do yet is point:
 * `onBeat` fires with the beat, and a beat carries an optional `target`
 * selector, so the next builder can raise that element above the dim
 * (--z-guide-target already exists for it) and hang §3.23's contramaestre and
 * the orange arrow off it without touching the flow below.
 */

export interface TutorialBeat {
  id: string;
  /** The bosun's line, es-ES. */
  text: string;
  /** What the player is being sent to press, for the arrow that does not exist
   *  yet. A selector rather than an element: the HUD rebuilds its own nodes on
   *  every sim step, so a captured element would be stale within 250ms. */
  target?: string;
}

/** The opening, as beats. Copy lives here, in the screen's own module. */
export const BEATS: readonly TutorialBeat[] = [
  {
    id: 'welcome',
    text: 'Bienvenido a casa, capitán. Esta isla es tuya… en cuanto la domes.',
  },
  {
    id: 'clear',
    text: 'Ese matorral ocupa buen suelo. Toca una palmera y manda a un carpintero a despejarla.',
    target: '.world-item',
  },
  {
    id: 'build',
    text: 'Con esa madera levanta tu primer Aserradero en el hueco que has abierto.',
    target: 'button[aria-label="Isla"]',
  },
  {
    id: 'wait',
    text: 'Las obras tardan. Mientras trabajan, pásate por el Diario de a Bordo.',
    target: 'button[aria-label="Diario"]',
  },
];

const COPY = {
  next: 'Vale',
  last: '¡A ello!',
  skip: 'Saltar',
  who: 'El contramaestre',
} as const;

export interface TutorialOptions {
  /** Where the card mounts. The router owns a layer that outlives the island
   *  scene, because islandScene.dispose() empties #ui wholesale. */
  root: HTMLElement;
  /** Every beat, as it becomes current. */
  onBeat?(beat: TutorialBeat): void;
  /** Walked to the end, or skipped. Either way the flag gets set once. */
  onDone(skipped: boolean): void;
  beats?: readonly TutorialBeat[];
}

export interface Tutorial {
  readonly el: HTMLElement;
  /** The beat on screen. */
  beat(): TutorialBeat;
  next(): void;
  skip(): void;
  dispose(): void;
}

export function createTutorial(opts: TutorialOptions): Tutorial {
  const beats = opts.beats ?? BEATS;
  let at = 0;
  let finished = false;

  const line = el('p', 't t-body tut__line', beats[0].text);
  const who = el('span', 't t-micro tut__who', COPY.who);
  const dots = el('div', 'tut__dots', ...beats.map(() => el('span', 'tut__dot')));

  const go = el('button', 'btn btn--green tut__go', el('span', 't t-btn', COPY.next));
  go.type = 'button';
  go.setAttribute('aria-label', COPY.next);

  const skip = el('button', 'tut__skip tap', el('span', 't t-micro', COPY.skip));
  skip.type = 'button';
  skip.setAttribute('aria-label', COPY.skip);

  const card = el('div', 'tut__card',
    el('div', 'tut__head', who, skip),
    line,
    el('div', 'tut__foot', dots, go));

  // No scrim and no pointer trap: the island stays fully playable underneath,
  // which is what "taught by doing" requires and what a modal would forbid.
  const root = el('div', 'tut layer-guide', card);
  opts.root.append(root);

  function paint(): void {
    const beat = beats[at];
    line.textContent = beat.text;
    go.replaceChildren(el('span', 't t-btn', at === beats.length - 1 ? COPY.last : COPY.next));
    dots.childNodes.forEach((node, i) => {
      (node as HTMLElement).classList.toggle('is-on', i === at);
      (node as HTMLElement).classList.toggle('is-done', i < at);
    });
    opts.onBeat?.(beat);
  }

  function finish(skipped: boolean): void {
    if (finished) return;
    finished = true;
    root.remove();
    opts.onDone(skipped);
  }

  const api: Tutorial = {
    el: root,
    beat: () => beats[at],
    next() {
      if (finished) return;
      if (at >= beats.length - 1) { finish(false); return; }
      at++;
      paint();
    },
    skip() { finish(true); },
    dispose() {
      finished = true;
      root.remove();
    },
  };

  pressable(go, () => api.next());
  pressable(skip, () => api.skip());
  paint();

  return api;
}
