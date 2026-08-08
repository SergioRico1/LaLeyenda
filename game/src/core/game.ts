import {
  advanceInPlace, applyLongAbsenceGiftInPlace, createDemoIsland, createNewGame, nextAction,
  type ActionResult, type GameState, type OfflineSummary, type SimEvent,
} from '../sim';
import { SaveStore, exportSaveFile, importSaveFile } from './save';

/**
 * game.ts — the runtime that owns the state, and the ONLY place a clock is read.
 *
 * PLAN.md's golden rule keeps `Date.now()` out of src/sim/: the simulation is
 * handed a time and integrates to it. This is the boundary where that time
 * comes from — the wall clock in the browser, a frozen one under the
 * screenshot harness — plus the save store, autosave, and the dispatch the UI
 * calls actions through.
 */

export interface GameOptions {
  seed: string;
  /** Defaults to the wall clock. The shot harness injects a frozen one so a
   *  capture is byte-identical between runs. */
  clock?: () => number;
  /** false under the harness: a screenshot must never overwrite a real save. */
  persist?: boolean;
  /** Start from §4.10's first-session island instead of whatever is stored. */
  fresh?: boolean;
}

export interface Game {
  state(): GameState;
  now(): number;
  /** What happened while the player was away — staged once, at boot. */
  readonly welcome: OfflineSummary;
  /** Integrates to the current instant. Returns null if no time has passed. */
  tick(): { events: SimEvent[]; summary: OfflineSummary } | null;
  /** Runs a sim action and adopts its result. */
  dispatch<T extends ActionResult>(run: (state: GameState, now: number) => T): T;
  onChange(fn: (state: GameState) => void): () => void;
  saveNow(): Promise<void>;
  exportSave(): void;
  importSave(file: Blob): Promise<void>;
  reset(): Promise<void>;
  stop(): void;
}

export async function createGame(options: GameOptions): Promise<Game> {
  const clock = options.clock ?? (() => Date.now());
  const persist = options.persist !== false;
  const store = persist ? await SaveStore.open() : null;

  // getTimezoneOffset is read HERE and stored, so day boundaries inside the sim
  // stay pure. It is re-read on every load: the player may have flown.
  const tz = new Date().getTimezoneOffset();

  let state =
    (!options.fresh && store ? await store.load() : null) ??
    (options.fresh ? createNewGame(options.seed, clock(), tz) : createDemoIsland(options.seed, clock(), tz));
  state = { ...state, tzOffsetMinutes: tz };

  if (store) console.log(`[save] backend: ${store.backendName}`);

  // Offline progress is applied BEFORE the first frame, which is what lets §7
  // demand a collect bubble in frame 1 of a cold start.
  const welcome = advanceInPlace(state, Math.max(state.now, clock())).summary;
  // §3.22C — after ≥72h away the return ships with a gift chest, so the tray is
  // never the thing that is empty when someone comes back.
  if (welcome.longAbsence) applyLongAbsenceGiftInPlace(state);
  if (welcome.elapsedMs > 0) {
    console.log(
      `[sim] welcome back after ${Math.round(welcome.elapsedMs / 60000)}m — ` +
      `madera +${welcome.produced.madera}, oro +${welcome.produced.oro}, ` +
      `${welcome.finished.length} obra(s) terminadas, ${welcome.chestsReady} cofre(s) listo(s)`
    );
  }

  const listeners = new Set<(s: GameState) => void>();
  const notify = () => { for (const fn of listeners) fn(state); };

  const stopAutosave = store
    ? store.startAutosave({ getState: () => state, intervalMs: 20_000 })
    : () => undefined;

  const game: Game = {
    welcome,
    state: () => state,
    now: clock,

    tick() {
      const now = clock();
      if (now <= state.now) return null;
      const next = structuredClone(state);
      const result = advanceInPlace(next, now);
      state = next;
      notify();
      return result;
    },

    dispatch(run) {
      const result = run(state, clock());
      if (result.ok) {
        state = result.state;
        notify();
        // §4.8: the resolver must always have an answer. If it does not, the
        // session loop is broken and that is a bug worth seeing in the console.
        if (nextAction(state, clock()) === 'none') {
          console.warn('[sim] next-action resolver returned nothing — the loop is broken');
        }
      } else if (result.refusal) {
        console.log(`[sim] refused: ${result.refusal}`);
      }
      return result;
    },

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async saveNow() {
      await store?.save(state, Date.now());
    },

    exportSave() {
      exportSaveFile(state, Date.now());
    },

    async importSave(file) {
      state = { ...(await importSaveFile(file)), tzOffsetMinutes: new Date().getTimezoneOffset() };
      advanceInPlace(state, Math.max(state.now, clock()));
      await store?.save(state, Date.now());
      notify();
    },

    async reset() {
      await store?.clear();
      state = createNewGame(options.seed, clock(), new Date().getTimezoneOffset());
      notify();
    },

    stop() {
      stopAutosave();
      listeners.clear();
    },
  };

  return game;
}
