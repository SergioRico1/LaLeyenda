import './tutorial.css';
import { el, pressable } from './components/dom';
import {
  TUTORIAL_DONE_FLAG, TUTORIAL_SKIPPED_FLAG, ackFlag, tutorialFinished, tutorialStep,
  type TutorialStep, type TutorialTarget,
} from '../sim/tutorial';
import { BALANCE, setFlag, type ActionResult, type GameState } from '../sim';

/**
 * tutorial.ts — the contramaestre on screen.
 *
 * The DECISION is not here. `src/sim/tutorial.ts` is a pure state machine that
 * answers "what should be said and what should be pointed at", and this file
 * does exactly three things with the answer: dim everything except the target,
 * put an arrow on it, and say one sentence in a plate that carries all four
 * layers. sim decides → render draws → ui dispatches, like everything else.
 *
 * ─── the three properties that shaped the markup ────────────────────────────
 *
 *  1. **It never traps a tap.** The layer is `pointer-events: none` from top to
 *     bottom and only the plate's own buttons take a finger. Clash's mask does
 *     block, and blocking is exactly how a tutorial ends up printing "toca
 *     aquí" over a tap it has itself made impossible. The dim is a spotlight.
 *  2. **It never covers what it points at.** The plate has two homes, top and
 *     bottom, and the one it takes is decided per beat from where the target
 *     actually landed on screen.
 *  3. **An action beat has no button.** The island is the button. A "Vale"
 *     beside "toca la burbuja" is a second thing to press that does not do what
 *     the sentence asked, and a player who presses it has been taught the wrong
 *     lesson. Only the beats that genuinely are acknowledgements get one.
 *
 * ─── two seams, both named ─────────────────────────────────────────────────
 *
 * ✎ SEAM 1 — THE GAME. `opts.game` is the live simulation. `src/main.ts` does
 * not pass it yet (it builds this with `{root, onDone}`), so the fallback reads
 * `window.laLeyenda.state()`, which `src/scenes/islandScene.ts` publishes for
 * the export/import console route. That is enough to DRIVE the whole director —
 * every beat is derived from state — but not to persist an acknowledgement, so
 * without a game the acks live for the session only and `onDone` is still what
 * writes `tutorialDone`. One line in main.ts closes it:
 *
 *     createTutorial({ root: overlayRoot, game: live ?? undefined, onDone: … })
 *
 * ✎ SEAM 2 — THE PROJECTOR. An obstacle is a grid cell, and nothing in the DOM
 * stands over it: `src/scenes/islandScene.ts` draws the wilderness as instanced
 * geometry with no picking and no world-anchored HUD element. So a beat that
 * points at a palm cannot be given a ring today, and rather than draw one at a
 * guess the layer falls back to a soft, holeless dim and no arrow. `opts.project`
 * takes a cell and returns a screen point the moment the scene can supply one.
 */

/* --------------------------------------------------------------------------
 * the seam the director is driven through
 * ----------------------------------------------------------------------- */

/** Structurally satisfied by `Game` from src/core/game.ts. */
export interface TutorialGame {
  state(): GameState;
  now(): number;
  dispatch<T extends ActionResult>(run: (state: GameState, now: number) => T): T;
  onChange?(fn: (state: GameState) => void): () => void;
}

export interface TutorialOptions {
  /** Where the plate mounts. The router owns a layer that outlives the island
   *  scene, because islandScene.dispose() empties #ui wholesale. */
  root: HTMLElement;
  /** The live simulation. Omitted, the layer reads the island scene's own
   *  `window.laLeyenda` seam — see SEAM 1 above. */
  game?: TutorialGame;
  /** Grid cell → screen point, for the beats that point at the ground. */
  project?(x: number, z: number): { x: number; y: number } | null;
  /** Every beat, as it becomes current. */
  onBeat?(step: TutorialStep): void;
  /** Walked to the end, or skipped. Either way the flag gets set once. */
  onDone(skipped: boolean): void;
}

export interface Tutorial {
  readonly el: HTMLElement;
  /** The beat on screen, or null while it is silent. */
  step(): TutorialStep | null;
  /** Acknowledge the current beat. No-op on a beat the island has to end. */
  next(): void;
  skip(): void;
  dispose(): void;
}

/** Copy lives in the screen's own module; the SENTENCES live in the director,
 *  because which sentence is true is part of the decision it makes. */
const COPY = {
  who: 'El contramaestre',
  next: 'Vale',
  last: '¡A ello!',
  skip: 'Saltar',
} as const;

/* --------------------------------------------------------------------------
 * finding the thing on screen
 * ----------------------------------------------------------------------- */

/**
 * The director names targets in the sim's vocabulary; this is the only place
 * that knows what they look like in the DOM.
 *
 * ✎ The two world-anchored cases select the FIRST matching element rather than
 * the one belonging to `buildingId`. `src/ui/hud.ts` builds its world layer
 * without an id or a data attribute on the wrapper, so there is nothing to
 * match on. It is correct on every island the director actually points at one
 * — a day-one island has a single producer and a single running job — and it is
 * wrong on `?save=demo`, which is a framing fixture rather than a played
 * island. The fix is one attribute in hud.ts, which is not this slice's file.
 */
interface Spot {
  rect: DOMRect;
  /** A tight object gets a circular spotlight and an arrow; the island band
   *  gets a wide frame and none, because there is no one point to jab at. */
  wide: boolean;
}

function locate(target: TutorialTarget, project: TutorialOptions['project']): Spot | null {
  switch (target.kind) {
    case 'nav': {
      // The bar is only the first tap. Once the picker is open over it, the row
      // the player is actually being sent to is the honest target — and the nav
      // slot behind the sheet is no longer visible to point at.
      const row = target.building ? pickerRow(target.building) : null;
      const rect = row ?? rectOf(`button[aria-label="${cssEscape(target.label)}"]`);
      return rect ? { rect, wide: false } : null;
    }
    case 'sail': {
      const rect = rectOf(`button[aria-label="${cssEscape(target.label)}"]`);
      return rect ? { rect, wide: false } : null;
    }
    case 'building': {
      if (target.want === 'timer') {
        const rect = rectOf('.world-item .timerbar');
        if (rect) return { rect, wide: false };
      }
      if (target.want === 'bubble') {
        const rect = rectOf('.world-item .bubble');
        if (rect) return { rect, wide: false };
      }
      // The model itself has no DOM element, and neither does an
      // un-projected bubble. Fall back to the ground it stands on.
      return islandBand();
    }
    case 'obstacle': {
      const at = project?.(target.x, target.z) ?? null;
      if (at) {
        const r = 46;
        return { rect: new DOMRect(at.x - r, at.y - r, r * 2, r * 2), wide: false };
      }
      return islandBand();
    }
    default:
      return null;
  }
}

/**
 * The island's own share of the screen: everything between the HUD's top
 * cluster and its bottom furniture.
 *
 * This is what a beat pointing AT THE GROUND gets until something can project a
 * grid cell (SEAM 2). It is a spotlight rather than a guess — the palm really is
 * somewhere inside it, and the chrome really is what is being dimmed away — and
 * it is measured off the HUD's own elements rather than off fractions typed
 * here, so it stays right when the HUD moves.
 */
function islandBand(): Spot | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bottomOf = (selector: string): number | null => {
    const node = document.querySelector(selector) as HTMLElement | null;
    const rect = node?.getBoundingClientRect();
    return rect && rect.height > 0 ? rect.bottom : null;
  };
  const topOf = (selector: string): number | null => {
    const node = document.querySelector(selector) as HTMLElement | null;
    const rect = node?.getBoundingClientRect();
    return rect && rect.height > 0 ? rect.top : null;
  };

  const top = (bottomOf('.zone-a') ?? vh * 0.12) + 10;
  const floor = Math.min(topOf('.objective-row') ?? vh, topOf('.navbar') ?? vh, vh);
  const bottom = floor - 10;
  if (bottom - top < 120) return null;              // no room to frame anything

  return { rect: new DOMRect(8, top, vw - 16, bottom - top), wide: true };
}

/**
 * §3.15's picker row for a building type, if the picker happens to be open.
 *
 * Matched on the row's printed NAME against the same label the sim carries, so
 * there is one source of truth for what an Aserradero is called. The `Colocar`
 * button is what is pointed at rather than the whole row, because that is the
 * tap: a spotlight over a 300px row says "somewhere in here".
 */
function pickerRow(type: string): DOMRect | null {
  const label = BALANCE.buildings[type]?.label;
  if (!label) return null;
  for (const row of document.querySelectorAll('.sheet.is-open .pick-row')) {
    const name = row.querySelector('.pick-row__name')?.textContent?.trim();
    if (name !== label) continue;
    const go = (row.querySelector('.pick-row__go') ?? row) as HTMLElement;
    const rect = go.getBoundingClientRect();
    return rect.width > 4 && rect.height > 4 ? rect : null;
  }
  return null;
}

function rectOf(selector: string): DOMRect | null {
  const node = document.querySelector(selector) as HTMLElement | null;
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  // A world-anchored element that has not been projected yet sits at the origin
  // with no size; pointing at it would put the ring in the top-left corner.
  if (rect.width < 4 || rect.height < 4) return null;
  if (rect.bottom < 0 || rect.right < 0) return null;
  if (rect.left > window.innerWidth || rect.top > window.innerHeight) return null;
  return rect;
}

/** The labels carry `¡` and `!`; nothing exotic, but quote them properly. */
const cssEscape = (value: string): string => value.replace(/["\\]/g, '\\$&');

const ARROW = `
<svg viewBox="0 0 48 48" aria-hidden="true">
  <path d="M24 6 L24 30 M24 42 L10 25 L18 25 L18 8 L30 8 L30 25 L38 25 Z"
        fill="var(--ui-arrow)" stroke="var(--ui-ink)" stroke-width="3"
        stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M21 12 L21 25" stroke="rgba(255,255,255,.6)" stroke-width="3"
        stroke-linecap="round" fill="none"/>
</svg>`;

/* --------------------------------------------------------------------------
 * the layer
 * ----------------------------------------------------------------------- */

export function createTutorial(opts: TutorialOptions): Tutorial {
  const params = new URLSearchParams(location.search);

  /* --- reading the world ------------------------------------------------- */

  /**
   * Which lines this player has already heard.
   *
   * Three beats have nothing in the world to watch — the welcome, the look at
   * the timer, and the closing word about the sea — so an acknowledgement is
   * the only record that they happened. With a game they go into the save
   * through the sim, where `GameState.flags` exists for exactly this.
   *
   * ✎ WITHOUT ONE they go to localStorage instead, keyed by the island. That is
   * the SEAM 1 stopgap and it is deliberately NOT the save: writing sim state
   * from the UI would break the one-way rule, and splitting the save would
   * break PLAN.md's second multiplayer rule. What this key holds is a
   * PRESENTATION fact — which sentences have been read — and losing it costs a
   * repeated line and nothing else. It disappears the moment main.ts passes the
   * game, because `remember` then writes to the save as well.
   */
  const acks: Record<string, boolean> = {};

  /** Per island, not per browser: a reset mints a new `createdAt`, so the new
   *  island does not inherit the old one's read lines. */
  const memoryKey = (state: GameState): string =>
    `la-leyenda:tut:${state.seed}:${state.createdAt}`;

  let memoryLoaded = false;

  function loadAcks(state: GameState): void {
    if (memoryLoaded || opts.game) return;
    memoryLoaded = true;
    try {
      const raw = localStorage.getItem(memoryKey(state));
      if (!raw) return;
      for (const flag of JSON.parse(raw) as string[]) acks[flag] = true;
    } catch {
      // Private-mode Safari and some webviews throw on read. A replayed line is
      // the entire cost, so this stays silent.
    }
  }

  function saveAcks(state: GameState): void {
    if (opts.game) return;
    try {
      localStorage.setItem(memoryKey(state), JSON.stringify(Object.keys(acks)));
    } catch {
      /* as above */
    }
  }

  const readState = (): GameState | null => {
    if (opts.game) return opts.game.state();
    const seam = (window as unknown as { laLeyenda?: { state?: () => GameState } }).laLeyenda;
    try {
      return seam?.state?.() ?? null;
    } catch {
      return null;
    }
  };

  const readNow = (): number => opts.game?.now() ?? Date.now();

  /** The state the director sees: the real one, plus the lines already read. */
  function view(): GameState | null {
    const state = readState();
    if (!state) return null;
    loadAcks(state);
    if (Object.keys(acks).length === 0) return state;
    return { ...state, flags: { ...state.flags, ...acks } };
  }

  function remember(flag: string): void {
    if (!flag) return;
    acks[flag] = true;
    // A preview writes nothing. `?tut=` jumps to a beat the player has not
    // reached, so persisting its acknowledgement would mark a lesson taught
    // that nobody was given.
    if (forced) return;
    if (opts.game) {
      opts.game.dispatch((state) => setFlag(state, flag));
      return;
    }
    const state = readState();
    if (state) saveAcks(state);
  }

  /* --- the elements ------------------------------------------------------ */

  const hole = el('div', 'tut__hole');
  const ring = el('div', 'tut__ring');
  const hand = el('div', 'tut__hand', el('i'));
  (hand.firstChild as HTMLElement).innerHTML = ARROW;

  const who = el('span', 't t-micro tut__who', COPY.who);
  const skip = el('button', 'tut__skip tap', el('span', 't t-micro', COPY.skip));
  skip.type = 'button';
  skip.setAttribute('aria-label', COPY.skip);

  const line = el('p', 't t-body tut__line');
  const dots = el('div', 'tut__dots');
  const go = el('button', 'btn btn--green tut__go', el('span', 't t-btn', COPY.next));
  go.type = 'button';
  go.setAttribute('aria-label', COPY.next);
  const foot = el('div', 'tut__foot', dots, go);

  // `.tut__card` is the name tools/acts.mjs waits for, and the shape §3.23
  // specifies. It keeps it.
  const card = el('div', 'tut__card', el('div', 'tut__head', who, skip), line, foot);
  const stage = el('div', 'tut__stage tut__stage--bottom', card);

  const root = el('div', 'tut layer-guide', hole, ring, hand, stage);
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  // Hidden until the director has actually said something. The island scene
  // publishes the state it is read from as it finishes building, so on a cold
  // boot the first resolve can land a frame later — and a plate with no
  // sentence in it, even for one frame, is worse than no plate.
  root.style.visibility = 'hidden';
  opts.root.append(root);

  /* --- state ------------------------------------------------------------- */

  let current: TutorialStep | null = null;
  let finished = false;
  let frame = 0;
  let lastPoll = 0;
  let dotCount = 0;

  /**
   * ✎ CAPTURE KNOB. `?tut=<beat>` opens the layer on a named beat so a
   * screenshot can review a mask and an arrow that a cold boot would not reach
   * for two minutes. It never fabricates a target: it forces the DONE
   * conditions of the beats BEFORE the one asked for, on a copy of the state,
   * and lets the real director answer from there — so what is drawn is a card
   * the director genuinely produces, aimed at objects that genuinely exist.
   *
   * A debug parameter like `?parts=`, `?cam=` and `?hud=0`. It changes which
   * card is shown and nothing else; no state is written and no save is touched.
   */
  const PREVIEWABLE: readonly string[] = [
    'bienvenida', 'despejar', 'construir', 'temporizador', 'recoger', 'diario', 'zarpar',
  ];
  const asked = params.get('tut');
  const forced = asked && PREVIEWABLE.includes(asked) ? asked : null;
  if (asked && !forced) console.warn(`[tutorial] ?tut=${asked} is not a beat; ignoring`);

  /** Per beat, how to make the director consider it behind us. Preview only. */
  const PRETEND: Record<string, (state: GameState) => GameState> = {
    bienvenida: (s) => ({ ...s, flags: { ...s.flags, [ackFlag('bienvenida')]: true } }),
    despejar: (s) => ({ ...s, stats: { ...s.stats, obstacles: Math.max(1, s.stats.obstacles) } }),
    temporizador: (s) => ({ ...s, flags: { ...s.flags, [ackFlag('temporizador')]: true } }),
    recoger: (s) => ({ ...s, stats: { ...s.stats, collects: Math.max(1, s.stats.collects) } }),
    diario: (s) => ({ ...s, daily: { ...s.daily, lastClaimedDay: 0 } }),
    zarpar: (s) => ({ ...s, flags: { ...s.flags, [ackFlag('zarpar')]: true } }),
  };
  function preview(state: GameState, wanted: string): GameState {
    let out = state;
    for (const id of PREVIEWABLE) {
      if (id === wanted) break;
      out = PRETEND[id]?.(out) ?? out;
    }
    return out;
  }

  /* --- painting ---------------------------------------------------------- */

  function paintDots(step: TutorialStep): void {
    if (dotCount !== step.total) {
      dotCount = step.total;
      dots.replaceChildren(...Array.from({ length: step.total }, () => el('span', 'tut__dot')));
    }
    dots.childNodes.forEach((node, i) => {
      const dot = node as HTMLElement;
      dot.classList.toggle('is-on', i === step.index - 1);
      dot.classList.toggle('is-done', i < step.index - 1);
    });
  }

  function paint(step: TutorialStep): void {
    line.textContent = step.text;
    paintDots(step);
    foot.classList.toggle('is-quiet', !step.ack);
    if (step.ack) {
      const label = step.index >= step.total ? COPY.last : COPY.next;
      go.replaceChildren(el('span', 't t-btn', label));
      go.setAttribute('aria-label', label);
    }
    opts.onBeat?.(step);
  }

  /**
   * Places the mask, the arrow and the plate for the target as it is RIGHT NOW.
   *
   * Run every frame rather than once per beat, because the two things it
   * measures both move: the world-anchored layer is re-projected on the scene's
   * own frame, and the plate's home depends on where that projection landed.
   */
  function place(step: TutorialStep): void {
    const spot = locate(step.target, opts.project);
    if (!spot) {
      root.classList.add('tut--soft');
      // With nothing located the plate keeps the bottom, which is where a
      // sentence with no object belongs — UNLESS the bottom is spoken for. A
      // beat can lose its target precisely BECAUSE the furniture came up: enter
      // placement and the build bar replaces the whole nav bar, so a card
      // pointing at the Diario slot suddenly has nothing to point at and used to
      // fall back onto the bar it had just displaced.
      const taken = !!document.querySelector('.sheet.is-open, .buildbar.is-open');
      stage.classList.toggle('tut__stage--top', taken);
      stage.classList.toggle('tut__stage--bottom', !taken);
      return;
    }
    root.classList.remove('tut--soft');
    root.classList.toggle('tut--wide', spot.wide);

    let { rect } = spot;
    // "Never cover the thing it points at." A tight spotlight is dodged by
    // moving the plate; a band is too tall for that, so the BAND gives way
    // instead and stops above the plate. Measured rather than reserved, so it
    // is right at every screen size and with any length of sentence.
    if (spot.wide) {
      const plate = card.getBoundingClientRect();
      if (plate.height > 0 && plate.top > rect.top + 140) {
        rect = new DOMRect(rect.x, rect.y, rect.width, Math.min(rect.height, plate.top - 10 - rect.top));
      }
    }
    // A tight object gets a CIRCLE big enough to hold its diagonal — a
    // rectangle traced round a nav slot reads as a selection box, and a circle
    // clipped to the slot's own width cuts its corners off. The island band
    // gets a soft-cornered frame instead, because a circle over a landscape is
    // a porthole.
    const pad = spot.wide ? 0 : 14;
    const w = spot.wide ? rect.width : Math.hypot(rect.width, rect.height) + pad;
    const h = spot.wide ? rect.height : w;
    const radius = spot.wide ? 26 : 999;
    const left = rect.left + rect.width / 2 - w / 2;
    const top = rect.top + rect.height / 2 - h / 2;

    for (const node of [hole, ring]) {
      node.style.width = `${w}px`;
      node.style.height = `${h}px`;
      node.style.borderRadius = `${radius}px`;
      node.style.transform = `translate(${left}px, ${top}px)`;
    }

    // The arrow sits OUTSIDE the spotlight, on the side with room, so it can
    // never cover the thing it points at. A band has no single point worth
    // jabbing at, so it gets none.
    hand.style.display = spot.wide ? 'none' : '';
    const below = top < window.innerHeight * 0.24;
    const y = below ? top + h + 34 : top - 34;
    hand.style.transform =
      `translate(${rect.left + rect.width / 2}px, ${y}px) rotate(${below ? 180 : 0}deg)`;
    hand.classList.toggle('is-below', below);

    // ...and the plate takes the half of the screen the target is not in.
    const middle = rect.top + rect.height / 2;
    /*
     * ...OR THE HALF THE FURNITURE IS NOT IN, WHICHEVER IS MORE URGENT.
     *
     * Rule 2 at the top of this file is "it never covers what it points at",
     * and it was written about the TARGET. Watched end to end in a browser it
     * turned out to have a second half: a player who opens the picker while a
     * beat is pointing at the ground gets the build bar under the plate, and
     * the plate is opaque. The Mercado's name, its cost and the "Aquí no cabe"
     * that explains why the ✓ is grey were all behind the contramaestre.
     *
     * A sheet and the build bar own the bottom of the screen for as long as
     * they are open, so while either is up the plate goes to the top whatever
     * the target is doing. The target is never hidden by that: the top home
     * clears Zone A, and a beat whose target is genuinely up there is the one
     * case that already sends the plate down.
     */
    const bottomTaken = !!document.querySelector('.sheet.is-open, .buildbar.is-open');
    const targetLow = spot.wide ? false : middle > window.innerHeight * 0.5;
    const high = (targetLow || bottomTaken) && !(bottomTaken && middle < window.innerHeight * 0.32);
    stage.classList.toggle('tut__stage--top', high);
    stage.classList.toggle('tut__stage--bottom', !high);
  }

  /* --- the loop ---------------------------------------------------------- */

  function resolve(): void {
    const state = view();
    if (!state) return;                          // no island yet; try next frame
    const now = readNow();

    const step = forced
      ? tutorialStep(preview(state, forced), now)
      : tutorialStep(state, now);

    if (!step) {
      // Silence has two meanings and only one of them ends the tutorial.
      if (tutorialFinished(state, now) || state.flags?.[TUTORIAL_DONE_FLAG]) {
        finish(false);
        return;
      }
      current = null;
      root.style.visibility = 'hidden';
      return;
    }

    root.style.visibility = '';
    if (!current || current.id !== step.id || current.text !== step.text) paint(step);
    current = step;
  }

  function tick(t: number): void {
    frame = requestAnimationFrame(tick);
    // The director is cheap but it is not free, and nothing in the economy moves
    // fast enough to need it at 60Hz. Placement DOES: the world-anchored layer
    // is re-projected on the scene's own frame.
    if (t - lastPoll > 200) {
      lastPoll = t;
      resolve();
    }
    if (current) place(current);
  }

  function finish(skipped: boolean): void {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    root.remove();
    opts.onDone(skipped);
  }

  const api: Tutorial = {
    el: root,
    step: () => current,
    next() {
      if (finished || !current) return;
      if (!current.ack) return;                  // the island ends this one
      remember(current.flag);
      resolve();
      if (current) place(current);
    },
    skip() {
      if (finished) return;
      // Recorded as declined rather than taught, so a later round can tell the
      // two apart. `tutorialDone` itself is main.ts's to write on `onDone`.
      remember(TUTORIAL_SKIPPED_FLAG);
      finish(true);
    },
    dispose() {
      finished = true;
      cancelAnimationFrame(frame);
      root.remove();
    },
  };

  pressable(go, () => api.next());
  pressable(skip, () => api.skip());

  // Painted synchronously so a capture that freezes the frame immediately still
  // has a card in it; the loop takes over from the next frame.
  resolve();
  if (current) place(current);
  frame = requestAnimationFrame(tick);

  return api;
}
