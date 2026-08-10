import { BALANCE, buildingSpec, levelSpec } from './balance';
import { buildersFree, gemSpeedupCost, placeRefusal } from './build';
import { isFull, isProducer, producerRate, producerResource } from './economy';
import { clearRefusal } from './obstacles';
import { dailyAvailable, questComplete } from './progression';
import type { GameState, Obstacle } from './types';

/**
 * tutorial.ts — the director for the first ninety seconds. PURE.
 *
 * Given a state and an instant it answers one question: **what should the
 * contramaestre be saying right now, and what should the player be looking at.**
 * It reads state and returns a description; it never mutates, never reads a
 * clock, never touches the DOM. `src/ui/tutorial.ts` draws whatever comes out.
 *
 * ─── why it is a resolver rather than a cursor ──────────────────────────────
 *
 * The obvious shape is an index into an array, advanced by a tap. That shape
 * breaks on two of PRODUCTION.md §1's own requirements and it breaks silently:
 *
 *  · **Resumable.** A cursor has to be stored, and a stored cursor drifts out of
 *    step with the island the moment anything happens that the tutorial did not
 *    drive — a clear finishing while the app was shut, a building placed from
 *    the picker before the card asked for it, a save imported. Here the step is
 *    DERIVED from the save, so quitting at step 3 and reopening lands on step 3
 *    because step 3 is what the island still needs, not because a number said so.
 *  · **It never lies.** Every step states the condition under which its
 *    instruction is TRUE — `ready` — and a step that is not ready is never
 *    emitted. "Toca aquí" is only ever printed when that tap would actually be
 *    accepted by the sim, which is checked against the same refusal functions
 *    the action itself runs.
 *
 * ─── and why nothing here ever waits ────────────────────────────────────────
 *
 * The hard rule: never block on a timer a real player would simply wait out.
 * The resolver gets this for free. `tutorialStep` walks the beats IN ORDER and
 * returns the first that is undone AND ready — so when the next beat is waiting
 * on a carpenter, a later beat that IS performable is hoisted into the gap
 * instead. On a day-one island that is `diario`: the daily is claimable from the
 * first frame, and it lands exactly in the thirty seconds the first palm takes.
 * Only `diario` may jump the queue (`hoist`), because it is the one beat whose
 * place in the story is "something to do while the island works".
 *
 * ─── where it lives in the save ─────────────────────────────────────────────
 *
 * `GameState.flags`, which has existed since version 1 and whose doc comment
 * already reads "tutorial beats seen". **No new field, so no migration**: a
 * version-1 island loaded through src/core/save.ts arrives with `flags` intact
 * and the director reads it without knowing which version it came from. Only
 * the beats that have nothing in the world to watch store a flag at all
 * (`tut.bienvenida`, `tut.temporizador`, `tut.zarpar`); the rest are answered by
 * the island itself — an obstacle being cleared, an Aserradero standing, a
 * collect counted — so most of the walk cannot desynchronise from the save even
 * in principle.
 *
 * ─── the copy ──────────────────────────────────────────────────────────────
 *
 * The lines are here rather than in the UI module because the LINE IS THE
 * DECISION: which sentence is true depends on which obstacle was picked, on
 * whether the player has a ship, on whether the daily or a chest is the thing
 * waiting. Splitting the sentence from the state that chooses it would put half
 * the director in a file no test can reach. src/ui/copy.ts is untouched — this
 * is the tutorial's own module, and both of the tutorial's own modules are its
 * own.
 */

/* --------------------------------------------------------------------------
 * what a step is
 * ----------------------------------------------------------------------- */

export type TutorialStepId =
  | 'bienvenida'
  | 'despejar'
  | 'construir'
  | 'temporizador'
  | 'recoger'
  | 'diario'
  | 'zarpar'
  /** Not a beat. The card while the island is working and the next beat is not
   *  yet performable — see `tutorialStep`. */
  | 'mientras'
  | 'esperando';

/**
 * What the arrow is pointing at, named in the sim's own vocabulary.
 *
 * Deliberately not a CSS selector. The architecture is one-way — sim decides,
 * render draws — so the director says "the bubble over building 4" and the UI
 * is the only thing that knows a bubble is `.bubble` inside `.world-item`. It
 * also means a step's target can be asserted headlessly: the tests check that
 * the obstacle named by `despejar` is a real, clearable, SMALL obstacle without
 * a browser anywhere in sight.
 */
export type TutorialTarget =
  /** Nothing to point at: the line stands on its own. */
  | { kind: 'none' }
  /**
   * A bottom-bar destination, by the accessible name the HUD gives it.
   *
   * `building` names what the player is being sent there to place, when that is
   * the point of the trip. The bar is only the FIRST tap — the picker opens
   * over it and the real tap is a row inside — so a target that could only say
   * "the Isla slot" would go on pointing at a button the picker has covered.
   * Which row that is remains a sim fact; where the row is drawn is not.
   */
  | { kind: 'nav'; label: string; building?: string }
  /** The raised primary CTA — ¡Zarpar!. */
  | { kind: 'sail'; label: string }
  /** Something hanging over a building: its timer bar, its collect bubble, or
   *  the building itself. */
  | { kind: 'building'; buildingId: number; want: 'timer' | 'bubble' | 'body' }
  /** A palm, a rock or a wreck standing on the grid. */
  | { kind: 'obstacle'; obstacleId: number; x: number; z: number; label: string };

export interface TutorialStep {
  id: TutorialStepId;
  /** The contramaestre's line, es-ES. One sentence. */
  text: string;
  target: TutorialTarget;
  /**
   * True when the only way past this beat is the player saying "vale" — there
   * is nothing in the world for it to watch, so the UI shows a button and the
   * flag it sets is the whole record of it.
   *
   * False beats have no button at all: the island itself ends them.
   */
  ack: boolean;
  /** The flag an `ack` beat writes. Empty for the rest. */
  flag: string;
  /** 1-based position in the walk — what the dots draw. */
  index: number;
  /** How many beats there are in total. `esperando` is not one of them. */
  total: number;
}

/** The flag main.ts already reads and writes. Kept here so both ends agree. */
export const TUTORIAL_DONE_FLAG = 'tutorialDone';
/** Set alongside it when the player pressed Saltar, so a later round can tell
 *  "taught" from "declined" without a second walk. */
export const TUTORIAL_SKIPPED_FLAG = 'tutorialSkipped';

/** The flag an acknowledged beat writes into `state.flags`. */
export const ackFlag = (id: TutorialStepId): string => `tut.${id}`;

/** `flags` is a plain record on a JSON save; a hand-edited or ancient one may
 *  simply not have it. Read through here and it is a missing key, not a crash. */
const flagSet = (state: GameState, key: string): boolean => state.flags?.[key] === true;

/* --------------------------------------------------------------------------
 * the wilderness, named in Spanish
 * ----------------------------------------------------------------------- */

/**
 * `Obstacle.kind` is a model family id ('palmera', 'roca', 'pecio', 'penasco').
 * The line has to say the right noun or the arrow points at a palm while the
 * card talks about a rock, which is the smallest possible version of lying.
 */
const OBSTACLE_NOUN: Record<string, string> = {
  palmera: 'palmera',
  roca: 'roca',
  pecio: 'pecio',
  penasco: 'peñasco',
};

const nounFor = (o: Obstacle): string => OBSTACLE_NOUN[o.kind] ?? 'maleza';

/* --------------------------------------------------------------------------
 * the things the beats ask about
 * ----------------------------------------------------------------------- */

const townHall = (state: GameState) =>
  state.buildings.find((b) => buildingSpec(b.type).kind === 'townhall') ?? null;

/** The building the whole opening is about. */
const FIRST_PRODUCER = 'aserradero';

const firstProducer = (state: GameState) =>
  state.buildings.find((b) => b.type === FIRST_PRODUCER) ?? null;

/**
 * The obstacle the tutorial sends the first carpenter to.
 *
 * SMALL only, and that is the no-waiting rule showing up as a line of code: a
 * `large` tier is a fifteen-minute timer and a first instruction that starts one
 * would strand the player at beat two behind a wait nobody sits through. A
 * `small` is thirty seconds, which is a real timer and no wait at all.
 *
 * Nearest to the hall — Chebyshev, the same metric the field is thinned with —
 * then lowest id, so the choice is deterministic and the same island always
 * teaches on the same palm.
 */
export function tutorialObstacle(state: GameState): Obstacle | null {
  const hall = townHall(state);
  if (!hall) return null;
  let best: Obstacle | null = null;
  let bestReach = Infinity;
  for (const o of state.obstacles) {
    if (o.tier !== 'small' || o.work) continue;
    const reach = Math.max(Math.abs(o.x - hall.x), Math.abs(o.z - hall.z));
    if (reach < bestReach || (reach === bestReach && best !== null && o.id < best.id)) {
      best = o;
      bestReach = reach;
    }
  }
  return best;
}

/** A producer with something in it, preferring the one the tutorial built. */
function fullestProducer(state: GameState) {
  let best: GameState['buildings'][number] | null = null;
  for (const b of state.buildings) {
    if (!isProducer(b) || b.stock < 1 || !producerResource(b)) continue;
    if (b.type === FIRST_PRODUCER) return b;
    if (!best || b.stock > best.stock) best = b;
  }
  return best;
}

/** The same test the HUD greys ¡Zarpar! with (`sailLocked` in ui/present.ts):
 *  a dock is a dock, the door to the sea is the shipyard's. */
const hasShip = (state: GameState): boolean =>
  state.buildings.some(
    (b) => buildingSpec(b.type).kind === 'support' && b.level > 0 && levelSpec(b.type, b.level).ship
  );

const readyChest = (state: GameState): boolean => state.chests.some((c) => c.state === 'ready');

/** Anything with a builder on it, for the one card that narrates a wait. */
const runningWork = (state: GameState) => state.buildings.find((b) => b.work) ?? null;

/**
 * Is the island moving toward the next beat on its own?
 *
 * Three ways, and the third is the one that is easy to forget: a carpenter on a
 * building, a carpenter on an obstacle, **or a producer quietly filling**. The
 * gap between an Aserradero finishing and its first bubble is eighteen seconds
 * of the last kind, and without it the card would blink out and back in — which
 * reads as a bug rather than as patience.
 */
function islandIsWorking(state: GameState): boolean {
  if (state.buildings.some((b) => b.work)) return true;
  if (state.obstacles.some((o) => o.work)) return true;
  return state.buildings.some((b) => isProducer(b) && producerRate(b) > 0 && !isFull(b));
}

/* --------------------------------------------------------------------------
 * the walk
 * ----------------------------------------------------------------------- */

interface Beat {
  id: TutorialStepId;
  ack: boolean;
  /**
   * May this beat be pulled forward past a beat that is not yet performable?
   *
   * Only `diario`, and only because that is its job: RETENTION.md's session loop
   * says the player always has something waiting, and the daily is what fills
   * the thirty seconds the first carpenter is out. Everything else keeps its
   * place, so the story is told in order whenever the island allows it.
   */
  hoist?: boolean;
  /** Finished, or no longer applicable. Both, because a beat whose premise has
   *  gone (an island with no obstacles at all) must not wedge the walk. */
  done(state: GameState, now: number): boolean;
  /** Everything the line promises is true RIGHT NOW, target included. Returns
   *  the target so existence and readiness cannot be checked in two places and
   *  disagree. */
  aim(state: GameState, now: number): TutorialTarget | null;
  text(state: GameState, now: number, target: TutorialTarget): string;
}

const BEATS: readonly Beat[] = [
  /* 1 — look at your island. One building, wilderness everywhere. */
  {
    id: 'bienvenida',
    ack: true,
    done: (state) => flagSet(state, ackFlag('bienvenida')),
    aim: (state) => {
      const hall = townHall(state);
      return hall ? { kind: 'building', buildingId: hall.id, want: 'body' } : null;
    },
    text: () => 'Esta isla es tuya, capitán: un ayuntamiento y maleza hasta la orilla.',
  },

  /* 2 — the first tap. Costs nothing, takes a carpenter and a short timer,
   *     pays the madera the Aserradero is deliberately short of. */
  {
    id: 'despejar',
    ack: false,
    done: (state) =>
      state.stats.obstacles > 0 ||
      state.obstacles.some((o) => o.work) ||
      // An island with nothing left to clear has nothing to teach here. Without
      // this the beat would never finish on a cleared or fixture island and the
      // whole walk would wedge behind it.
      state.obstacles.length === 0,
    aim: (state, now) => {
      const target = tutorialObstacle(state);
      if (!target) return null;
      // The same refusal the tap itself runs. If a carpenter is not free the
      // instruction is not true, so it is not printed.
      if (clearRefusal(state, target.id, buildersFree(state, now)) !== null) return null;
      return { kind: 'obstacle', obstacleId: target.id, x: target.x, z: target.z, label: nounFor(target) };
    },
    text: (_state, _now, target) =>
      target.kind === 'obstacle'
        ? `Manda un carpintero a despejar esa ${target.label}: es gratis y paga madera.`
        : 'Manda un carpintero a despejar la maleza: es gratis y paga madera.',
  },

  /* 3 — the first placement, on the ground the clear just freed. */
  {
    id: 'construir',
    ack: false,
    done: (state) => firstProducer(state) !== null,
    aim: (state, now) =>
      // Affordable, a carpenter free, and allowed at this Ayuntamiento — the
      // exact same question `place()` asks. Short of 300 madera the beat simply
      // is not shown, which is what turns the thirty-second clear into a gap the
      // daily fills instead of a wait.
      placeRefusal(state, FIRST_PRODUCER, now) === null
        ? { kind: 'nav', label: NAV.island, building: FIRST_PRODUCER }
        : null,
    text: () => `Ese hueco ya es tuyo: levanta ahí tu primer ${buildingSpec(FIRST_PRODUCER).label}.`,
  },

  /* 4 — start something that takes real time, and SEE the timer.
   *
   * The Aserradero's own two minutes is that timer, so the beat is a look
   * rather than a second purchase. The alternative was to send the player at
   * the Ayuntamiento's ten-minute upgrade — but that costs 1000 madera, which
   * is a good quarter of an hour of clearing away on day one, and a tutorial
   * that cannot finish until then is the wait this whole file is written to
   * avoid. */
  {
    id: 'temporizador',
    ack: true,
    done: (state) => {
      if (flagSet(state, ackFlag('temporizador'))) return true;
      // Came back to a finished building: the timer this beat is about is gone,
      // so the beat is over. Pointing at something that no longer exists is the
      // failure mode, not a missed lesson.
      const producer = firstProducer(state);
      return producer !== null && producer.level >= 1;
    },
    aim: (state) => {
      const producer = firstProducer(state);
      return producer?.work ? { kind: 'building', buildingId: producer.id, want: 'timer' } : null;
    },
    // Two lines, because only one of them is true at a time.
    //
    // §4.4's GOLDEN RULE — the last five minutes of any timer cost exactly one
    // gem — is the most habit-forming number Clash has, and this is the moment
    // it costs nothing to learn: a two-minute build against the five gems the
    // island opens with. Offering it is also the cleanest possible answer to
    // "never block on a timer", because it hands the player the way out rather
    // than describing one. But it is only offered while it is AFFORDABLE, or
    // the card would be advertising a purchase the sim would refuse.
    text: (state, now) => {
      const producer = firstProducer(state);
      const remaining = producer?.work ? producer.work.endsAt - now : 0;
      return remaining > 0 && gemSpeedupCost(remaining) <= state.gems
        ? 'La obra tarda: vuelve luego, o toca la barra y acábala con gemas.'
        : 'El tiempo corre aunque cierres el juego: vuelve y estará en pie.';
    },
  },

  /* 5 — the first income. */
  {
    id: 'recoger',
    ack: false,
    done: (state) => state.stats.collects > 0,
    aim: (state) => {
      const producer = fullestProducer(state);
      return producer ? { kind: 'building', buildingId: producer.id, want: 'bubble' } : null;
    },
    text: () => 'Toca la burbuja y llévate la madera al almacén.',
  },

  /* 6 — the return hook, and the one beat allowed to jump the queue. */
  {
    id: 'diario',
    ack: false,
    hoist: true,
    done: (state) =>
      state.daily.lastClaimedDay !== null ||
      state.stats.chestsOpened > 0 ||
      state.quests.daily.some((q) => q.claimed),
    aim: (state, now) => {
      if (readyChest(state)) return { kind: 'nav', label: NAV.chests };
      if (dailyAvailable(state, now) || state.quests.daily.some(questComplete)) {
        return { kind: 'nav', label: NAV.log };
      }
      return null;
    },
    text: (_state, _now, target) =>
      target.kind === 'nav' && target.label === NAV.chests
        ? 'Tienes un cofre listo. Ábrelo antes de seguir.'
        : 'Pasa por el Diario: tu recompensa de hoy te está esperando.',
  },

  /* 7 — the other half of the game exists. Never "toca aquí" while the tile is
   *     shut: a locked ¡Zarpar! names its key rather than sailing, so the line
   *     promises a road instead of a tap. */
  {
    id: 'zarpar',
    ack: true,
    done: (state) => flagSet(state, ackFlag('zarpar')),
    aim: () => ({ kind: 'sail', label: NAV.sail }),
    text: (state) =>
      hasShip(state)
        ? 'Ya tienes barco: toca ¡Zarpar! y sal a buscar botín.'
        : 'Ahí fuera está el mar. Levanta el Muelle y el Astillero y será tuyo.',
  },
];

/**
 * The accessible names the island HUD gives its destinations (ui/copy.ts's
 * `cta.*`, which this file may not import — it is shared).
 *
 * Repeated here on purpose and asserted in tools/tests/tutorial.test.ts against
 * the live COPY table, so the day someone renames a nav slot the test fails
 * rather than the arrow silently pointing at nothing.
 */
export const NAV = {
  island: 'Isla',
  chests: 'Cofres',
  log: 'Diario',
  settings: 'Ajustes',
  sail: '¡Zarpar!',
} as const;

/** How many beats the walk has. `esperando` is not one of them. */
export const TUTORIAL_BEATS = BEATS.length;

/** Every beat id, in order — for a test that wants to name them all. */
export const TUTORIAL_ORDER: readonly TutorialStepId[] = BEATS.map((b) => b.id);

/* --------------------------------------------------------------------------
 * the resolver
 * ----------------------------------------------------------------------- */

/** Has this player still got a tutorial to see? False once done or skipped. */
export const tutorialActive = (state: GameState): boolean => !flagSet(state, TUTORIAL_DONE_FLAG);

/** Every beat walked. The UI turns this into `onDone(false)`. */
export function tutorialFinished(state: GameState, now: number): boolean {
  return BEATS.every((beat) => beat.done(state, now));
}

/** How far along the walk is, for the dots and for a test that wants a number. */
export function tutorialProgress(state: GameState, now: number): { done: number; total: number } {
  return { done: BEATS.filter((b) => b.done(state, now)).length, total: BEATS.length };
}

/**
 * THE function. What the contramaestre says right now, or null for silence.
 *
 * Null has three distinct causes and all three are correct:
 *   · the tutorial is over or was skipped;
 *   · every beat is done;
 *   · nothing is performable and nothing is running, so there is genuinely
 *     nothing to say. The game's own §4.8 resolver owns the island at that
 *     point and a card repeating it would be chrome.
 */
export function tutorialStep(state: GameState, now: number): TutorialStep | null {
  if (!tutorialActive(state)) return null;

  /** Where the dots sit: the first beat still outstanding. */
  let firstOpen = -1;
  let hoisted: { beat: Beat; target: TutorialTarget; index: number } | null = null;

  for (let i = 0; i < BEATS.length; i++) {
    const beat = BEATS[i];
    if (beat.done(state, now)) continue;
    if (firstOpen < 0) firstOpen = i;

    const target = beat.aim(state, now);
    if (!target) continue;

    // In order: the beat whose turn it is, and which can be performed.
    if (i === firstOpen) return build(beat, state, now, target, i);

    // Out of order: only the beats that exist to fill a wait.
    if (beat.hoist && !hoisted) hoisted = { beat, target, index: i };
  }

  if (hoisted) return build(hoisted.beat, state, now, hoisted.target, hoisted.index);
  if (firstOpen < 0) return null;                   // every beat done

  // ─── the gap ────────────────────────────────────────────────────────────
  //
  // The next beat is not performable and no later one may be pulled forward.
  // THE RULE — never block on a timer a real player would simply wait out — is
  // answered here, and it is answered with work rather than with patience:
  //
  //  · if a carpenter is free and there is anything left to clear, the card
  //    hands the player that instead. It is free, it is thirty seconds, and it
  //    teaches the lesson a Clash player already knows — a builder standing
  //    idle is the thing you fix while the other one works.
  //  · only when every carpenter is out does it narrate, and then it points at
  //    the bar rather than demanding a tap. The island stays fully playable
  //    under it, the tutorial is resumable, and the timers run while the app is
  //    shut, so "come back" is a real answer rather than a euphemism for wait.
  if (!islandIsWorking(state)) return null;

  const spare = tutorialObstacle(state);
  if (spare && clearRefusal(state, spare.id, buildersFree(state, now)) === null) {
    return {
      id: 'mientras',
      text: `Te queda un carpintero libre: despeja esa ${nounFor(spare)} mientras tanto.`,
      target: { kind: 'obstacle', obstacleId: spare.id, x: spare.x, z: spare.z, label: nounFor(spare) },
      ack: false,
      flag: '',
      index: firstOpen + 1,
      total: BEATS.length,
    };
  }

  const working = runningWork(state);
  return {
    id: 'esperando',
    text: 'Los carpinteros están en ello. Cierra si quieres: el tiempo corre igual.',
    target: working ? { kind: 'building', buildingId: working.id, want: 'timer' } : { kind: 'none' },
    ack: false,
    flag: '',
    index: firstOpen + 1,
    total: BEATS.length,
  };
}

function build(
  beat: Beat, state: GameState, now: number, target: TutorialTarget, index: number
): TutorialStep {
  return {
    id: beat.id,
    text: beat.text(state, now, target),
    target,
    ack: beat.ack,
    flag: beat.ack ? ackFlag(beat.id) : '',
    index: index + 1,
    total: BEATS.length,
  };
}

/* --------------------------------------------------------------------------
 * what the first madera is worth — used by the tests, and worth stating once
 * ----------------------------------------------------------------------- */

/**
 * Does clearing ONE obstacle still pay for the first Aserradero?
 *
 * OPENING.md sizes the whole opening on this: a fresh island is handed 250
 * madera against a 300-madera Aserradero, and the smallest possible payout is
 * 50, so the very worst roll on the very first palm closes the gap exactly.
 * Beat 3 is unreachable the moment that stops being true — and it would stop
 * being true silently, through a balance edit rather than a code change. So the
 * arithmetic is exported and asserted rather than trusted.
 *
 * `startingMadera` is passed in rather than read from `createNewGame`, so this
 * file stays a leaf of the sim and the test supplies the real island.
 */
export function firstClearCoversFirstBuild(startingMadera: number): boolean {
  const cost = levelSpec(FIRST_PRODUCER, 1).cost.madera ?? 0;
  return startingMadera + BALANCE.obstacles.small.madera[0] >= cost;
}
