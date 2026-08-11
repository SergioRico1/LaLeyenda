import {
  BALANCE, MINUTE, buildersFree, claimDaily, clearObstacle, clearRefusal, collect, createDemoIsland,
  createNewGame, finishNowCost, levelSpec, nextAction, place, placeRefusal, plotHalf, setFlag,
  spotRefusalNow, tick,
  type GameState,
} from '../../src/sim';
import {
  NAV, TUTORIAL_BEATS, TUTORIAL_DONE_FLAG, TUTORIAL_ORDER, TUTORIAL_SKIPPED_FLAG, ackFlag,
  firstClearCoversFirstBuild, tutorialActive, tutorialFinished, tutorialObstacle, tutorialProgress,
  tutorialStep, type TutorialStep, type TutorialStepId,
} from '../../src/sim/tutorial';
import { flagship } from '../../src/sim/shipyard';
import { COPY } from '../../src/ui/copy';
import { serialize, parseSave, type SaveEnvelope } from '../../src/core/save';
import { describe, eq, ok, test } from './harness';
import { T0, TZ } from './fixtures';

/**
 * tutorial.test.ts — the whole opening, played headlessly.
 *
 * PRODUCTION.md §1 gives the tutorial four properties and every one of them
 * fails silently: it must never block on a timer, it must be skippable and
 * leave a coherent game, it must resume across a quit, and it must never say
 * "toca aquí" about a tap the sim would refuse.
 *
 * So the centre of this file is a PLAYTHROUGH — a fake player who does exactly
 * what the card says, one instruction at a time, on a real day-one island,
 * through the same public sim actions the UI dispatches, with a clock that only
 * moves when the card has nothing left to ask. If the walk finishes that way it
 * finishes for a person; and the seconds the clock had to be pushed are the
 * honest measure of how much of the opening is waiting.
 */

const fresh = (seed = 'la-leyenda'): GameState => createNewGame(seed, T0, TZ);

/* --------------------------------------------------------------------------
 * a player who does what they are told
 * ----------------------------------------------------------------------- */

interface Session {
  state: GameState;
  now: number;
  /** Every card that was shown, in the order it was shown. */
  seen: TutorialStepId[];
  /** Milliseconds the clock had to be pushed forward with nothing to do. */
  waited: number;
  /** The longest single push — the number the no-blocking rule is about. */
  longestWait: number;
  /** Seconds spent waiting with an IDLE CARPENTER and nothing on offer for it.
   *  The number that has to be zero — see `idleHands`. */
  stuck: number;
}

const newSession = (state: GameState, now = T0): Session =>
  ({ state, now, seen: [], waited: 0, longestWait: 0, stuck: 0 });

/**
 * Performs one card the way a finger would: through the same public sim action
 * the UI dispatches, never by writing state. A card this cannot perform is a
 * card a player cannot perform.
 */
function obey(session: Session, step: TutorialStep): void {
  const { state, now } = session;
  switch (step.id) {
    case 'bienvenida':
    case 'temporizador':
    case 'zarpar': {
      ok(step.ack, `${step.id} is an acknowledgement`);
      const result = setFlag(state, step.flag);
      ok(result.ok, `${step.id}: the flag was set`);
      session.state = result.state;
      return;
    }
    case 'despejar':
    case 'mientras': {
      ok(step.target.kind === 'obstacle', `${step.id} points at an obstacle`);
      if (step.target.kind !== 'obstacle') return;
      const result = clearObstacle(state, step.target.obstacleId, now);
      ok(result.ok, `${step.id}: the tap was accepted (${result.refusal ?? 'ok'})`);
      session.state = result.state;
      return;
    }
    case 'construir': {
      // The card sends the player to the Isla slot, which opens the picker; the
      // action at the end of it is `place`. Somewhere legal is found the way the
      // ghost finds it — by asking the sim, cell by cell.
      const spot = firstLegalSpot(state, 'aserradero');
      ok(spot !== null, 'construir: there is somewhere the Aserradero may stand');
      if (!spot) return;
      const result = place(state, 'aserradero', spot.x, spot.z, now);
      ok(result.ok, `construir: the placement was accepted (${result.refusal ?? 'ok'})`);
      session.state = result.state;
      return;
    }
    case 'muelle': {
      // Round 12's beat: the dock whose level row carries the free skiff. Same
      // route as construir — the picker, then `place` on ground the sim accepts.
      const spot = firstLegalSpot(state, 'muelle');
      ok(spot !== null, 'muelle: there is somewhere the dock may stand');
      if (!spot) return;
      const result = place(state, 'muelle', spot.x, spot.z, now);
      ok(result.ok, `muelle: the placement was accepted (${result.refusal ?? 'ok'})`);
      session.state = result.state;
      return;
    }
    case 'recoger': {
      ok(step.target.kind === 'building', 'recoger points at a building');
      if (step.target.kind !== 'building') return;
      const result = collect(state, step.target.buildingId);
      ok(result.ok, `recoger: the bubble gave something (${result.refusal ?? 'ok'})`);
      session.state = result.state;
      return;
    }
    case 'diario': {
      const result = claimDaily(state, now);
      ok(result.ok, `diario: the daily was claimable (${result.refusal ?? 'ok'})`);
      session.state = result.state;
      return;
    }
    case 'esperando':
      // Not an instruction. The only honest response is to let time pass.
      return;
    default:
      ok(false, `no player behaviour for card ${step.id}`);
  }
}

/** The first cell the sim would accept for `type`, scanned the way the ghost
 *  sweeps. Terrain is the renderer's business, so this asks the sim only. */
function firstLegalSpot(state: GameState, type: string): { x: number; z: number } | null {
  const grid = BALANCE.island.grid;
  const half = plotHalf(type);
  for (let z = 0; z < grid; z++) {
    for (let x = 0; x < grid; x++) {
      // Kept off the rim of the grid so the plot itself is on the island.
      if (x - half < 2 || z - half < 2 || x + half > grid - 3 || z + half > grid - 3) continue;
      if (spotRefusalNow(state, type, x, z) === null) return { x, z };
    }
  }
  return null;
}

/**
 * One second of waiting: was the player left with an IDLE CARPENTER and nothing
 * to point it at?
 *
 * This is the hard rule made checkable, and the wording matters. Waiting while
 * every carpenter you own is out is not the failure the rule names — the
 * builder is the scarce resource (RETENTION.md §1), and a player who has spent
 * all of them has spent everything the game lets them spend. The failure is an
 * idle carpenter with no work on offer, which is dead air the tutorial produced.
 *
 * A gem finish counts as work on offer: §4.4's golden rule prices the last five
 * minutes of any timer at exactly one gem and the island opens with five, so a
 * player who does not want to wait genuinely does not have to.
 */
function idleHands(session: Session): void {
  const { state, now } = session;
  if (buildersFree(state, now) <= 0) return;                 // every hand is out

  const spare = tutorialObstacle(state);
  if (spare !== null && clearRefusal(state, spare.id, buildersFree(state, now)) === null) return;

  const job = state.buildings.find((b) => b.work);
  const price = job ? finishNowCost(job, now) : null;
  if (price !== null && price <= state.gems) return;

  session.stuck += 1;
}

/**
 * Walks the whole tutorial. Time only moves when the director has nothing to
 * ask, and it moves in one-second slices so the wait is measured rather than
 * assumed. `visit` sees every card in the state it was produced from.
 */
function play(
  seed = 'la-leyenda',
  visit?: (state: GameState, now: number, step: TutorialStep) => void,
  budgetMs = 30 * MINUTE
): Session {
  const session = newSession(fresh(seed));
  const SLICE = 1000;
  let guard = 0;

  while (guard++ < 8000) {
    const step = tutorialStep(session.state, session.now);
    if (!step && tutorialFinished(session.state, session.now)) break;
    if (step) {
      session.seen.push(step.id);
      visit?.(session.state, session.now, step);
    }

    // Silence with beats still outstanding is a wait too, and `esperando` is
    // the same thing said out loud. Both are measured the same way.
    if (!step || step.id === 'esperando') {
      let pushed = 0;
      while (pushed < budgetMs) {
        idleHands(session);
        session.now += SLICE;
        pushed += SLICE;
        session.state = tick(session.state, session.now).state;
        const next = tutorialStep(session.state, session.now);
        if (next && next.id !== 'esperando') break;
        if (!next && tutorialFinished(session.state, session.now)) break;
      }
      session.waited += pushed;
      session.longestWait = Math.max(session.longestWait, pushed);
      ok(pushed < budgetMs, `waited ${pushed / 1000}s at card ${step?.id ?? 'silence'} and nothing moved on`);
      continue;
    }

    obey(session, step);
    // Actions land through the tick exactly as they do in the game.
    session.state = tick(session.state, session.now).state;
  }

  ok(guard < 8000, 'the walk terminated');
  return session;
}

/* --------------------------------------------------------------------------
 * the playthrough
 * ----------------------------------------------------------------------- */

describe('the whole tutorial, played through', () => {
  test('a fresh island can be taught end to end, doing exactly what it says', () => {
    const session = play();
    ok(
      tutorialFinished(session.state, session.now),
      `every beat done (saw: ${session.seen.join(' → ')})`
    );
    eq(tutorialStep(session.state, session.now), null, 'and the card goes quiet');
    eq(tutorialProgress(session.state, session.now).done, TUTORIAL_BEATS, 'the dots are all filled');

    // The island it leaves behind is the one OPENING.md describes: the hall,
    // the Aserradero the player placed, a field with a hole in it — and, since
    // round 12, a dock with a boat tied to it. The zarpar beat is no longer a
    // promise about hall 3: the tile it points at is genuinely open.
    ok(session.state.buildings.some((b) => b.type === 'aserradero'), 'the Aserradero was built');
    ok(
      session.state.buildings.some((b) => b.type === 'muelle' && b.level >= 1),
      'the Muelle was built, and finished'
    );
    eq(flagship(session.state), 'skiff', 'the skiff is at the helm — ¡Zarpar! is unlocked, in session one');
    ok(session.state.stats.obstacles >= 1, 'at least one obstacle was cleared');
    ok(session.state.stats.collects >= 1, 'and something was collected');
    ok(session.state.daily.lastClaimedDay !== null, 'and the daily was taken');

    console.log(
      `      taught in ${Math.round((session.now - T0) / 1000)}s of island time; ` +
      `longest stretch with no card asking anything: ${Math.round(session.longestWait / 1000)}s; ` +
      `seconds with an idle carpenter and nothing to do: ${session.stuck}`
    );
    const beats: TutorialStepId[] = [];
    for (const id of session.seen) if (beats[beats.length - 1] !== id) beats.push(id);
    console.log(`      cards: ${beats.join(' → ')}`);
  });

  test('the whole taught opening fits a first session, first sail included', () => {
    // Round 12's production bar: the walk — first sail reachable AND taken —
    // inside ten minutes of island time. The island half is bounded at seven
    // minutes here so a two-to-three-minute first voyage (the fleet table's
    // ring-1 median is 14s sailing; the sea scene's coach marks and the trip
    // itself round it to minutes) still fits inside the ten with room.
    for (const seed of ['la-leyenda', 'tortuga', 'bahia', 'q7', 'pirata']) {
      const session = play(seed);
      const taught = session.now - T0;
      ok(
        taught <= 7 * MINUTE,
        `${seed}: taught in ${Math.round(taught / 1000)}s — the sail beat is a session-one beat`
      );
      eq(flagship(session.state), 'skiff', `${seed}: and it ends with a boat at the helm`);
    }
  });

  test('it never parks the player in front of a timer with nothing to do', () => {
    // THE hard rule: "NEVER block on a timer a real player would simply wait
    // out." Stated as three conditions rather than as one arbitrary number of
    // seconds, because the honest question is not how long a bar runs — the
    // player started that bar themselves and it keeps running while the app is
    // shut — but whether there is anything else to do while it does.
    //
    //  1. the tutorial adds no wait of its own: the longest one is never longer
    //     than the single job the card asked the player to start;
    //  2. no second of a wait leaves a carpenter idle with nothing on offer —
    //     see `idleHands` for why that is the honest form of the rule;
    //  3. and the opening does not become a waiting room in aggregate.
    const own = levelSpec('aserradero', 1).timeMs;
    for (const seed of ['la-leyenda', 'tortuga', 'bahia', 'q7', 'pirata']) {
      const session = play(seed);
      ok(
        session.longestWait <= own + 2000,
        `${seed}: waited ${Math.round(session.longestWait / 1000)}s against the ` +
        `${Math.round(own / 1000)}s job the player started`
      );
      eq(session.stuck, 0, `${seed}: ${session.stuck}s of the opening left a carpenter idle with nothing to do`);
      ok(
        session.waited <= 5 * MINUTE,
        `${seed}: ${Math.round(session.waited / 1000)}s of the opening is waiting`
      );
    }
  });

  test('the beats come in the order the design tells them, bar the one that may not', () => {
    const session = play();
    // Each card is shown until it is obeyed, so the sequence repeats ids; what
    // matters is the sequence of DISTINCT beats. `esperando` and `mientras` are
    // gap cards rather than beats and take no place in the order.
    const distinct: TutorialStepId[] = [];
    for (const id of session.seen) {
      if (id === 'esperando' || id === 'mientras') continue;
      if (distinct[distinct.length - 1] !== id) distinct.push(id);
    }

    // With `diario` taken out, what is left must be the design's own order.
    let cursor = -1;
    for (const id of distinct.filter((x) => x !== 'diario')) {
      const at = TUTORIAL_ORDER.indexOf(id);
      ok(at > cursor, `'${id}' came out of order (after '${TUTORIAL_ORDER[cursor] ?? 'nothing'}')`);
      cursor = at;
    }
    ok(distinct.includes('diario'), 'and the daily was taught');
    eq(distinct[0], 'bienvenida', 'it opens on the island itself');
    eq(distinct[distinct.length - 1], 'zarpar', 'and it closes on the sea');
  });

  test("the first clear still pays for the first Aserradero — OPENING.md's whole opening", () => {
    // Beat 3 is unreachable the moment this stops being true, and it would stop
    // being true through a balance edit rather than a code change.
    const start = fresh().store.madera;
    ok(
      firstClearCoversFirstBuild(start),
      `${start} madera + the worst payout (${BALANCE.obstacles.small.madera[0]}) ` +
      'does not reach the Aserradero'
    );
  });
});

/* --------------------------------------------------------------------------
 * it never lies
 * ----------------------------------------------------------------------- */

describe('it never lies', () => {
  test('every instruction it prints is one the sim would actually accept', () => {
    // The rule: "If it says 'tap here', that tap must work." Checked against
    // the same refusal functions the actions themselves run, on every card of a
    // whole walk.
    play('promesas', (state, now, step) => {
      const target = step.target;
      switch (step.id) {
        case 'despejar':
        case 'mientras':
          ok(target.kind === 'obstacle', `${step.id} points at an obstacle`);
          if (target.kind !== 'obstacle') return;
          eq(
            clearRefusal(state, target.obstacleId, buildersFree(state, now)),
            null,
            'and clearing that one would be accepted'
          );
          return;
        case 'construir':
          eq(placeRefusal(state, 'aserradero', now), null, 'construir is affordable, allowed, and has a carpenter');
          ok(firstLegalSpot(state, 'aserradero') !== null, 'and there is ground it may stand on');
          return;
        case 'muelle':
          eq(placeRefusal(state, 'muelle', now), null, 'the dock is affordable, allowed, and has a carpenter');
          ok(firstLegalSpot(state, 'muelle') !== null, 'and there is ground it may stand on');
          return;
        case 'recoger': {
          ok(target.kind === 'building', 'recoger points at a building');
          if (target.kind !== 'building') return;
          const result = collect(state, target.buildingId);
          ok(result.ok && result.amount > 0, `and that bubble pays (${result.refusal ?? 'ok'})`);
          return;
        }
        case 'diario': {
          ok(target.kind === 'nav', 'diario points at a destination');
          const claimable =
            state.chests.some((c) => c.state === 'ready') ||
            claimDaily(state, now).ok ||
            state.quests.daily.some((q) => !q.claimed && q.progress >= q.target);
          ok(claimable, 'and there is something claimable behind it');
          return;
        }
        case 'zarpar':
          // "Toca ¡Zarpar!" may only ever be said over an unlocked tile — the
          // rows the HUD locks on (`sailLocked`) must already say boat.
          if (step.text.includes('toca ¡Zarpar!')) {
            ok(flagship(state) !== null, 'the tap it asks for is genuinely open');
          }
          return;
        default:
          return;
      }
    });
  });

  test('every target it names exists in the state it named it from', () => {
    play('objetivos', (state, _now, step) => {
      const target = step.target;
      switch (target.kind) {
        case 'obstacle':
          ok(
            state.obstacles.some((o) => o.id === target.obstacleId && o.x === target.x && o.z === target.z),
            `${step.id}: obstacle ${target.obstacleId} is standing where the card says`
          );
          break;
        case 'building':
          ok(
            state.buildings.some((b) => b.id === target.buildingId),
            `${step.id}: building ${target.buildingId} exists`
          );
          break;
        case 'nav':
        case 'sail':
          ok(target.label.length > 0, `${step.id}: the destination is named`);
          break;
        default:
          break;
      }
      ok(step.text.trim().length > 0, `${step.id} says something`);
      ok(step.index >= 1 && step.index <= step.total, `${step.id} knows where it is in the walk`);
      eq(step.total, TUTORIAL_BEATS, `${step.id} agrees how long the walk is`);
    });
  });

  test('a timer card is only ever shown while that timer is actually running', () => {
    // The failure it guards: pointing at a bar the HUD has already removed. The
    // world-anchored layer is reconciled out of the DOM the moment a job lands,
    // so an arrow aimed at it would sit over bare grass.
    play('barras', (state, _now, step) => {
      if (step.target.kind !== 'building' || step.target.want !== 'timer') return;
      const building = state.buildings.find((b) => b.id === (step.target as { buildingId: number }).buildingId);
      ok(building?.work != null, `${step.id}: building ${building?.id} really is mid-job`);
    });
  });

  test('a bubble card is only ever shown while there is something in the bubble', () => {
    play('burbujas', (state, _now, step) => {
      if (step.target.kind !== 'building' || step.target.want !== 'bubble') return;
      const building = state.buildings.find((b) => b.id === (step.target as { buildingId: number }).buildingId);
      ok((building?.stock ?? 0) >= 1, `${step.id}: building ${building?.id} has stock to collect`);
    });
  });

  test('the first palm it points at is a THIRTY-SECOND job, never a fifteen-minute one', () => {
    // The no-waiting rule as a line of code: a `large` obstacle is a 15m timer,
    // and a first instruction that started one would strand a new player behind
    // a wait nobody sits through.
    ok(BALANCE.obstacles.small.timeMs <= 60_000, 'a small clear is under a minute');
    ok(BALANCE.obstacles.large.timeMs > BALANCE.obstacles.small.timeMs, 'and a large one is not');

    for (const seed of ['la-leyenda', 'tortuga', 'bahia', 'q7', 'zz', 'mm', 'hola', 'pirata']) {
      const state = fresh(seed);
      const target = tutorialObstacle(state);
      ok(target !== null, `${seed}: there is a palm to point at`);
      eq(target!.tier, 'small', `${seed}: and it is a short job`);

      eq(tutorialStep(state, T0)!.id, 'bienvenida', `${seed}: it opens on the island`);
      const after = setFlag(state, ackFlag('bienvenida')).state;
      const clear = tutorialStep(after, T0)!;
      eq(clear.id, 'despejar', `${seed}: then the first clear`);
      eq(
        clear.target.kind === 'obstacle' ? clear.target.obstacleId : -1,
        target!.id,
        `${seed}: and it is the one nearest the hall`
      );
    }
  });

  test('the destinations it names are the ones the HUD actually labels', () => {
    // The arrow finds its target by accessible name, so a renamed nav slot must
    // fail here rather than leave the arrow pointing at nothing.
    eq(NAV.island, COPY['cta.island'], 'Isla');
    eq(NAV.chests, COPY['cta.chests'], 'Cofres');
    eq(NAV.log, COPY['cta.log'], 'Diario');
    eq(NAV.settings, COPY['cta.settings'], 'Ajustes');
    eq(NAV.sail, COPY['cta.sail'], '¡Zarpar!');
  });

  test('every line is Spanish, short, and written by the same mouth', () => {
    const lines = new Set<string>();
    play('copia', (_state, _now, step) => void lines.add(step.text));

    ok(lines.size >= TUTORIAL_BEATS, `${lines.size} distinct lines for ${TUTORIAL_BEATS} beats`);
    for (const line of lines) {
      ok(line.length <= 92, `"${line}" is ${line.length} chars — a speech plate holds one sentence`);
      ok(/[a-záéíóúñü]/i.test(line), `"${line}" is words`);
      ok(!/[<>{}]/.test(line), `"${line}" carries no markup`);
      eq(line, line.trim(), 'no stray whitespace');
      // es-ES, and the tell is that the game is Spanish end to end: no English
      // articles have ever slipped into a Spanish string in this build and this
      // is where the tutorial's would show.
      ok(!/\b(the|you|your|tap|build|collect)\b/i.test(line), `"${line}" is not English`);
    }
  });
});

/* --------------------------------------------------------------------------
 * skipping
 * ----------------------------------------------------------------------- */

describe('skipping', () => {
  test('it can be skipped from the very first card', () => {
    const state = fresh();
    ok(tutorialActive(state), 'a new island has one to see');
    eq(tutorialStep(state, T0)!.id, 'bienvenida', 'and it opens on beat 1');

    const skipped = setFlag(setFlag(state, TUTORIAL_DONE_FLAG).state, TUTORIAL_SKIPPED_FLAG).state;
    ok(!tutorialActive(skipped), 'skipped');
    eq(tutorialStep(skipped, T0), null, 'and it never speaks again');
    ok(skipped.flags[TUTORIAL_SKIPPED_FLAG], 'with "declined" told apart from "taught"');
  });

  test('what it leaves behind is a coherent game', () => {
    // "Skipping must leave a coherent game." The director never mutates the
    // island, so the proof is that a skipped island is byte-identical to the one
    // that was never taught, and that §4.8 still has an answer on it — which is
    // this project's own definition of an unbroken loop.
    const state = fresh('saltar');
    const skipped = setFlag(state, TUTORIAL_DONE_FLAG).state;

    const { flags: a, ...islandBefore } = state as unknown as Record<string, unknown>;
    const { flags: b, ...islandAfter } = skipped as unknown as Record<string, unknown>;
    ok(a !== undefined && b !== undefined, 'both carry flags');
    eq(JSON.stringify(islandAfter), JSON.stringify(islandBefore), 'nothing but the flag moved');

    ok(nextAction(skipped, T0) !== 'none', 'and the session loop still has an answer');

    // And it is still playable with no tutorial in the way: the first clear pays
    // for the first building, exactly as OPENING.md sizes it.
    let played = skipped;
    const target = tutorialObstacle(played)!;
    played = clearObstacle(played, target.id, T0).state;
    played = tick(played, T0 + BALANCE.obstacles.small.timeMs).state;
    eq(played.stats.obstacles, 1, 'the clear landed');
    eq(placeRefusal(played, 'aserradero', played.now), null, 'and the Aserradero is affordable');
  });

  test('skipping halfway leaves the progress that was actually made', () => {
    const session = newSession(fresh('mitad'));
    // Two cards in, then walk out.
    for (let i = 0; i < 2; i++) {
      obey(session, tutorialStep(session.state, session.now)!);
      session.state = tick(session.state, session.now).state;
    }
    const before = tutorialProgress(session.state, session.now);
    ok(before.done >= 1 && before.done < before.total, `part way (${before.done}/${before.total})`);

    const skipped = setFlag(session.state, TUTORIAL_DONE_FLAG).state;
    eq(tutorialStep(skipped, session.now), null, 'silent');
    ok(
      skipped.obstacles.some((o) => o.work) || skipped.stats.obstacles > 0,
      'the clear it started is still running'
    );
    ok(nextAction(skipped, session.now) !== 'none', 'and the loop is unbroken');
  });
});

/* --------------------------------------------------------------------------
 * resuming
 * ----------------------------------------------------------------------- */

describe('resuming across a quit', () => {
  test('quit at beat 3, reopen, and it is still beat 3 — through the real save', () => {
    // Not a hand-built state: serialized, parsed and MIGRATED by src/core/save.ts
    // exactly as a returning player's island is, because that is the path the
    // property has to hold on.
    const session = newSession(fresh('volver'));
    let guard = 0;
    while (guard++ < 800) {
      const step = tutorialStep(session.state, session.now);
      if (step?.id === 'construir') break;
      if (!step || step.id === 'esperando') {
        session.now += 1000;
        session.state = tick(session.state, session.now).state;
        continue;
      }
      obey(session, step);
      session.state = tick(session.state, session.now).state;
    }
    const here = tutorialStep(session.state, session.now)!;
    eq(here.id, 'construir', 'standing on beat 3');

    const reopened = parseSave(serialize(session.state, session.now)).state;
    const there = tutorialStep(reopened, session.now)!;
    eq(there.id, 'construir', 'still beat 3 after a full save round trip');
    eq(there.text, here.text, 'saying exactly the same thing');
    eq(JSON.stringify(there.target), JSON.stringify(here.target), 'pointing at exactly the same thing');
    eq(there.index, here.index, 'with the dots in the same place');
  });

  test('a card whose moment passed while the app was shut is not replayed', () => {
    // Place the Aserradero, walk away for ten minutes, come back. The build is
    // finished, so the "watch the timer" card has nothing left to point at — and
    // a director that pointed at a timer bar which is no longer in the DOM would
    // be the exact lie this file exists to prevent.
    const session = newSession(fresh('ausente'));
    let guard = 0;
    while (guard++ < 800) {
      const step = tutorialStep(session.state, session.now);
      if (!step || step.id === 'esperando') {
        session.now += 1000;
        session.state = tick(session.state, session.now).state;
        continue;
      }
      obey(session, step);
      session.state = tick(session.state, session.now).state;
      if (step.id === 'construir') break;
    }
    ok(session.state.buildings.some((b) => b.type === 'aserradero'), 'the plot is down');
    eq(tutorialStep(session.state, session.now)!.id, 'temporizador', 'and the timer card is up');

    // Away, and back.
    const away = session.now + 10 * MINUTE;
    const back = tick(parseSave(serialize(session.state, session.now)).state, away).state;
    eq(back.buildings.find((b) => b.type === 'aserradero')!.work, null, 'the build finished while the app was shut');

    const step = tutorialStep(back, away)!;
    ok(step.id !== 'temporizador', `the timer card is not replayed (got ${step.id})`);
  });

  test('a version-1 save — no obstacles, no captain — is taught without crashing', () => {
    // The oldest schema still loadable. It has no wilderness at all, so beat 2
    // has nothing to point at and must read as PAST rather than wedging the walk
    // behind it forever.
    const envelope = JSON.parse(serialize(fresh('antigua'), T0)) as SaveEnvelope;
    const { obstacles, nextObstacleId, captain, ...older } =
      JSON.parse(JSON.stringify(envelope.state)) as Record<string, unknown>;
    ok(
      obstacles !== undefined && nextObstacleId !== undefined && captain !== undefined,
      'the current save carries all three'
    );

    const loaded = parseSave(JSON.stringify({ ...envelope, version: 1, state: older })).state;
    eq(loaded.obstacles.length, 0, 'an old island keeps its cleared ground');

    const step = tutorialStep(loaded, T0);
    ok(step !== null, 'it still has something to say');
    ok(step!.id !== 'despejar', `and it is not "clear that palm" (got ${step!.id})`);
    eq(tutorialProgress(loaded, T0).total, TUTORIAL_BEATS, 'the walk is the same length');
  });

  test('a save with no flags object at all is read as "nothing seen yet"', () => {
    // Defensive, and cheap: `flags` has existed since version 1, but an imported
    // file came off a player's disk and a missing key must be a missing key
    // rather than a crash on the first frame. This is also why the tutorial
    // needed NO new save field and therefore no migration.
    const state = fresh('sin-flags');
    const stripped = JSON.parse(JSON.stringify({ ...state, flags: undefined })) as GameState;
    ok(stripped.flags === undefined, 'the object really is gone');
    eq(tutorialStep(stripped, T0)!.id, 'bienvenida', 'and the walk starts at the beginning');
    ok(tutorialActive(stripped), 'with the tutorial live');
  });
});

/* --------------------------------------------------------------------------
 * islands the tutorial did not build
 * ----------------------------------------------------------------------- */

describe('islands the tutorial did not build', () => {
  test('the demo island — mid-game, no wilderness — can still finish the walk', () => {
    // `?save=demo` boots an Ayuntamiento-4 fixture with every producer standing
    // and no obstacles on it. Half the beats are already true there, and the two
    // that can never become true must read as PAST rather than as pending —
    // otherwise the card sits on that island forever telling a player who owns
    // eleven buildings to go and clear a palm.
    const session = newSession(createDemoIsland('demo', T0, TZ));
    const seen: TutorialStepId[] = [];
    let guard = 0;

    while (guard++ < 800) {
      const step = tutorialStep(session.state, session.now);
      if (!step) break;
      seen.push(step.id);
      ok(step.id !== 'despejar', 'it never asks for a clear on an island with nothing to clear');
      if (step.id === 'esperando') {
        session.now += 30_000;
        session.state = tick(session.state, session.now).state;
        continue;
      }
      obey(session, step);
      session.state = tick(session.state, session.now).state;
    }
    ok(guard < 800, `the walk terminated (saw: ${[...new Set(seen)].join(' → ')})`);
    ok(tutorialFinished(session.state, session.now), 'and every beat is behind it');
  });

  test('a player who builds ahead of the card is never told to do it twice', () => {
    // Someone who ignores the tutorial and places the Aserradero themselves must
    // find beats 2 and 3 already behind them.
    let state = fresh('adelantado');
    const target = tutorialObstacle(state)!;
    state = clearObstacle(state, target.id, T0).state;
    state = tick(state, T0 + BALANCE.obstacles.small.timeMs).state;
    const spot = firstLegalSpot(state, 'aserradero')!;
    state = place(state, 'aserradero', spot.x, spot.z, state.now).state;

    const ids: TutorialStepId[] = [];
    const session = newSession(state, state.now);
    let guard = 0;
    while (guard++ < 60) {
      const step = tutorialStep(session.state, session.now);
      if (!step || step.id === 'esperando' || step.id === 'mientras') break;
      ids.push(step.id);
      obey(session, step);
      session.state = tick(session.state, session.now).state;
    }
    ok(!ids.includes('despejar'), 'the clear it already did is not asked for');
    ok(!ids.includes('construir'), 'nor the building it already placed');
  });

  test('with every carpenter out, it does not tell anyone to spend one', () => {
    // `no-builders` is a real refusal, and a card that said "manda un carpintero"
    // while both are busy would be printing an instruction the sim would reject.
    let state = fresh('sin-carpinteros');
    state = setFlag(state, ackFlag('bienvenida')).state;
    const first = tutorialObstacle(state)!;
    state = clearObstacle(state, first.id, T0).state;
    const second = tutorialObstacle(state)!;
    state = clearObstacle(state, second.id, T0).state;
    eq(buildersFree(state, T0), 0, 'both carpenters are out');

    const step = tutorialStep(state, T0);
    ok(step !== null, 'it still says something');
    ok(
      step!.id !== 'despejar' && step!.id !== 'mientras',
      `and it is not another clear (got ${step!.id})`
    );
  });
});
