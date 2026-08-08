import { SIM_VERSION, type GameState } from '../sim/types';

/**
 * save.ts — persistence, and the player's own copy of it.
 *
 * PLAN.md, Fase 0: "Módulo de guardado: SaveStore (IndexedDB), esquema
 * versionado, autosave (intervalo + visibilitychange), export/import JSON."
 * And the second multiplayer rule: the save is ONE serializable versioned
 * object, so the day this moves to a server only this file changes.
 *
 * Three deliberate properties:
 *
 *  · **IndexedDB with a localStorage fallback.** Private-mode Safari and some
 *    embedded webviews expose `indexedDB` and then throw on open. So the store
 *    probes at startup by actually writing, and quietly degrades. A game that
 *    loses a week of progress because a browser lied about its storage is not
 *    a game anyone opens again.
 *  · **A versioned envelope with a migration hook**, so a save written by
 *    today's build is still loadable by next month's.
 *  · **Export / import as a JSON file** — PLAN.md promises the player a manual
 *    backup, and without a server that promise is the only backup they have.
 *
 * Everything that touches a browser global does so inside a function, so the
 * pure parts (migrate / serialize / parseSave) are testable under node.
 */

export const SAVE_VERSION = SIM_VERSION;
export const SAVE_KEY = 'save';
export const SAVE_FORMAT = 'la-leyenda-save';

const DB_NAME = 'la-leyenda';
const DB_STORE = 'game';

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: number;
  state: GameState;
}

/* --------------------------------------------------------------------------
 * schema versioning
 * ----------------------------------------------------------------------- */

/**
 * One entry per version bump: `MIGRATIONS[n]` upgrades a save at version `n`
 * to version `n + 1`. Add to the map, never edit an old entry — someone's save
 * is still at that version.
 *
 * There is nothing here yet because version 1 is the first shipped schema.
 * The hook exists now precisely so the first migration is a five-line change
 * rather than an archaeology project.
 */
export const MIGRATIONS: Record<number, (state: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (state) => ({ ...state, newField: 0 }),
};

export function migrate(envelope: SaveEnvelope): SaveEnvelope {
  let version = envelope.version;
  let state = envelope.state as unknown as Record<string, unknown>;

  if (version > SAVE_VERSION) {
    throw new Error(
      `[save] this save is from a newer version of the game (${version} > ${SAVE_VERSION})`
    );
  }
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`[save] no migration from version ${version}`);
    state = step(state);
    version++;
  }
  return { ...envelope, version, state: { ...(state as unknown as GameState), version } };
}

/* --------------------------------------------------------------------------
 * (de)serialization — pure
 * ----------------------------------------------------------------------- */

export function serialize(state: GameState, savedAt: number): string {
  const envelope: SaveEnvelope = { format: SAVE_FORMAT, version: SAVE_VERSION, savedAt, state };
  return JSON.stringify(envelope);
}

/** Throws with a readable message on anything that is not one of our saves. */
export function parseSave(text: string): SaveEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('[save] that file is not JSON');
  }
  const envelope = parsed as Partial<SaveEnvelope>;
  if (!envelope || envelope.format !== SAVE_FORMAT) {
    throw new Error('[save] that file is not a La Leyenda save');
  }
  if (typeof envelope.version !== 'number' || !envelope.state) {
    throw new Error('[save] that save is missing its version or its state');
  }
  return migrate(envelope as SaveEnvelope);
}

/** A stable, human-ish filename: one per day plus the clock, no collisions. */
export function exportFilename(savedAt: number): string {
  const d = new Date(savedAt);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `la-leyenda-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

/* --------------------------------------------------------------------------
 * backends
 * ----------------------------------------------------------------------- */

export type BackendName = 'indexeddb' | 'localstorage' | 'memory';

interface Backend {
  name: BackendName;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'));
    request.onblocked = () => reject(new Error('indexedDB.open blocked'));
  });
}

function idbBackend(db: IDBDatabase): Backend {
  const run = <T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest): Promise<T> =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const request = body(tx.objectStore(DB_STORE));
      request.onsuccess = () => resolve(request.result as T);
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
    });

  return {
    name: 'indexeddb',
    get: (key) => run<string | null>('readonly', (s) => s.get(key)).then((v) => v ?? null),
    set: (key, value) => run<void>('readwrite', (s) => s.put(value, key)).then(() => undefined),
    del: (key) => run<void>('readwrite', (s) => s.delete(key)).then(() => undefined),
  };
}

function localBackend(): Backend {
  return {
    name: 'localstorage',
    async get(key) { return localStorage.getItem(`${DB_NAME}:${key}`); },
    async set(key, value) { localStorage.setItem(`${DB_NAME}:${key}`, value); },
    async del(key) { localStorage.removeItem(`${DB_NAME}:${key}`); },
  };
}

function memoryBackend(): Backend {
  const map = new Map<string, string>();
  return {
    name: 'memory',
    async get(key) { return map.get(key) ?? null; },
    async set(key, value) { map.set(key, value); },
    async del(key) { map.delete(key); },
  };
}

/**
 * Probes by actually writing. `typeof indexedDB !== 'undefined'` is not a test:
 * private-mode Safari and several webviews expose the object and then throw or
 * hang on open, which is the exact case a fallback exists for.
 */
async function pickBackend(): Promise<Backend> {
  if (typeof indexedDB !== 'undefined') {
    try {
      const db = await withTimeout(openDb(), 2000);
      const backend = idbBackend(db);
      await backend.set('__probe', '1');
      await backend.del('__probe');
      return backend;
    } catch (err) {
      console.warn('[save] IndexedDB unavailable, falling back to localStorage', err);
    }
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(`${DB_NAME}:__probe`, '1');
      localStorage.removeItem(`${DB_NAME}:__probe`);
      return localBackend();
    } catch (err) {
      console.warn('[save] localStorage unavailable, the save will not survive this session', err);
    }
  }
  return memoryBackend();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/* --------------------------------------------------------------------------
 * the store
 * ----------------------------------------------------------------------- */

export interface AutosaveOptions {
  /** How often to write while the game is open. */
  intervalMs?: number;
  /** Supplies the state to write. Returning null skips that write. */
  getState: () => GameState | null;
  /** Called on every successful write, for the "Guardado" toast. */
  onSaved?: (savedAt: number) => void;
  onError?: (err: unknown) => void;
}

export class SaveStore {
  private constructor(private readonly backend: Backend) {}

  static async open(): Promise<SaveStore> {
    return new SaveStore(await pickBackend());
  }

  get backendName(): BackendName {
    return this.backend.name;
  }

  /** Writes are serialized: an autosave firing mid-write must not interleave. */
  private queue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async load(): Promise<GameState | null> {
    const text = await this.backend.get(SAVE_KEY);
    if (!text) return null;
    try {
      return parseSave(text).state;
    } catch (err) {
      // A corrupt save is kept, not overwritten: it is the only copy the player
      // has and they may still be able to export it by hand.
      console.error('[save] could not read the stored save', err);
      await this.backend.set(`${SAVE_KEY}:broken`, text);
      return null;
    }
  }

  async save(state: GameState, savedAt: number): Promise<void> {
    const text = serialize(state, savedAt);
    await this.enqueue(() => this.backend.set(SAVE_KEY, text));
  }

  async clear(): Promise<void> {
    await this.enqueue(() => this.backend.del(SAVE_KEY));
  }

  /**
   * Interval + `visibilitychange` + `pagehide`. The interval alone is not
   * enough: on mobile the app is almost never *closed*, it is backgrounded,
   * and `visibilitychange` is the last event guaranteed to fire before the tab
   * is frozen or discarded. Returns a stop function.
   */
  startAutosave(options: AutosaveOptions): () => void {
    const intervalMs = options.intervalMs ?? 20_000;
    let stopped = false;

    const write = (savedAt: number) => {
      if (stopped) return;
      const state = options.getState();
      if (!state) return;
      this.save(state, savedAt).then(
        () => options.onSaved?.(savedAt),
        (err) => (options.onError ?? console.error)(err)
      );
    };

    const timer = setInterval(() => write(Date.now()), intervalMs);
    // Only `visibilitychange` is conditional: it fires on the way IN as well.
    // `pagehide` and `beforeunload` are the last call, visible or not.
    const onVisibility = () => { if (document.visibilityState === 'hidden') write(Date.now()); };
    const onLeave = () => write(Date.now());

    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', onLeave);
      window.addEventListener('beforeunload', onLeave);
    }

    return () => {
      stopped = true;
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onLeave);
        window.removeEventListener('beforeunload', onLeave);
      }
    };
  }
}

/* --------------------------------------------------------------------------
 * the player's manual backup
 * ----------------------------------------------------------------------- */

/** Downloads the save as a JSON file. */
export function exportSaveFile(state: GameState, savedAt = Date.now()): void {
  const blob = new Blob([serialize(state, savedAt)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFilename(savedAt);
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on the next turn: Safari cancels the download if the URL dies first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Reads a save the player picked from an `<input type="file">`. */
export async function importSaveFile(file: Blob): Promise<GameState> {
  return parseSave(await file.text()).state;
}
