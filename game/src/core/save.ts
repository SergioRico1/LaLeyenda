import { createCaptain, isValidLook, sanitizeCaptain } from '../sim/captain';
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
/** Where an unreadable save is quarantined. It is never overwritten and never
 *  deleted: it is the only copy of that island there will ever be. */
export const BROKEN_KEY = `${SAVE_KEY}:broken`;

const DB_NAME = 'la-leyenda';
const DB_STORE = 'game';

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: number;
  state: GameState;
}

/* --------------------------------------------------------------------------
 * when the device will not keep the island
 *
 * Every failure below used to end at `console.error`, which is a place no
 * player looks. A phone at its storage quota refuses the write, the autosave
 * logs it twenty seconds later and again twenty seconds after that, and the
 * player finds out at the next reload — by which point a whole session is
 * gone. That is the single most expensive silence in the build, so the store
 * now SAYS so, once, to whoever is listening.
 * ----------------------------------------------------------------------- */

export type SaveTroubleKind =
  /** The device is full. The write was refused and nothing was stored. */
  | 'quota'
  /** The write failed for some other reason — a locked db, a dead webview. */
  | 'write'
  /** The stored save could not be parsed: half-written, wrong types, garbage. */
  | 'unreadable'
  /** The stored save was written by a LATER build than this one. */
  | 'newer'
  /** There is no durable backend at all — this session and no further. */
  | 'ephemeral';

export interface SaveTrouble {
  kind: SaveTroubleKind;
  /**
   * The stored text we could not read, when there is one.
   *
   * Carried rather than merely quarantined because it is the player's only
   * remaining copy: whatever surface reports this can offer to download it,
   * which is the difference between "your island is gone" and "your island is
   * in this file, hold on to it".
   */
  raw?: string;
  error?: unknown;
}

type TroubleListener = (trouble: SaveTrouble | null) => void;

const troubleListeners = new Set<TroubleListener>();
let lastTrouble: SaveTrouble | null = null;

/**
 * Listen for the store failing to keep the player's island.
 *
 * `null` means the opposite: a write has just landed after a run of failures,
 * so anything shown about the previous trouble can come down. The last trouble
 * is REPLAYED to a new listener, which is what makes this raceless — the title
 * screen's `peekSavedGame()` runs before the router has finished booting, and a
 * corrupt save found there must still reach the player.
 */
export function onSaveTrouble(fn: TroubleListener): () => void {
  troubleListeners.add(fn);
  if (lastTrouble) fn(lastTrouble);
  return () => troubleListeners.delete(fn);
}

/** For tests, and for a caller that subscribes late on purpose. */
export function currentSaveTrouble(): SaveTrouble | null {
  return lastTrouble;
}

function reportTrouble(trouble: SaveTrouble): void {
  // The autosave retries every twenty seconds, so an unchanged trouble is
  // remembered but not re-announced: a notice a player dismissed must not
  // reappear three times a minute.
  const repeat = lastTrouble?.kind === trouble.kind;
  lastTrouble = trouble;
  console.error(`[save] ${trouble.kind}`, trouble.error ?? '');
  if (repeat) return;
  for (const fn of troubleListeners) fn(trouble);
}

function reportRecovered(): void {
  if (!lastTrouble || lastTrouble.kind === 'ephemeral') return;
  lastTrouble = null;
  for (const fn of troubleListeners) fn(null);
}

/**
 * Is this the device telling us it is full?
 *
 * Four spellings, all real. Chrome and Firefox raise a DOMException named
 * `QuotaExceededError`; Firefox's localStorage additionally uses
 * `NS_ERROR_DOM_QUOTA_REACHED`; older WebKit throws code 22 with an EMPTY name,
 * which is the one a name check alone misses — and iOS Safari is precisely the
 * platform where a full quota is most likely.
 */
export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; code?: unknown; message?: unknown };
  if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (e.code === 22 || e.code === 1014) return true;
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return message.includes('quota') || message.includes('storage is full');
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
  /**
   * 1 → 2: OPENING.md's obstacles.
   *
   * The field arrives EMPTY rather than seeded, and that is the whole decision
   * here. A version-1 island is a six-building 26-grid layout with a running
   * economy; growing a 44-grid wilderness across it would drop palms through
   * roofs the player already paid for, to hand them a tutorial they are five
   * hours past. The wilderness is what a NEW island opens on, and an old save
   * has already had its opening.
   */
  1: (state) => ({ ...state, obstacles: [], nextObstacleId: 1 }),

  /**
   * 2 → 3: PRODUCTION.md §1's captain.
   *
   * **This migration must not cost anyone an island.** A version-2 save is a
   * played island — buildings mid-upgrade, producers part full, a daily chain
   * six days in — and the only thing it lacks is an identity. Sending that
   * player to captain creation would be the single most destructive thing this
   * file could do, so it does the opposite: it rolls them one from THEIR OWN
   * SEED and touches nothing else.
   *
   * Spread rather than rebuilt, deliberately. Every key that was in the object
   * is still in the object, in the same order, with the same values; the only
   * difference between the state that went in and the one that comes out is a
   * field that did not exist before.
   *
   * The seed is read from the save because it IS the captain's island — a
   * default here would hand two different players the same captain. A save with
   * no seed at all is not one this game wrote, but it still gets a name rather
   * than a crash.
   */
  2: (state) => ({
    ...state,
    captain: createCaptain(typeof state.seed === 'string' ? state.seed : 'la-leyenda'),
  }),
};

/**
 * Why a save could not be read, as something a caller can BRANCH on.
 *
 * The messages are unchanged and still the thing a human reads; the `reason`
 * is what lets the surface above tell a player whose file is corrupt from a
 * player who has just installed an older build over a newer save. Those two
 * need different words and different offers, and matching on message text is
 * how that goes wrong the first time somebody rewords a string.
 */
export type SaveFault = 'not-json' | 'not-ours' | 'incomplete' | 'newer' | 'no-migration';

export class SaveError extends Error {
  constructor(readonly fault: SaveFault, message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

export function migrate(envelope: SaveEnvelope): SaveEnvelope {
  let version = envelope.version;
  let state = envelope.state as unknown as Record<string, unknown>;

  if (version > SAVE_VERSION) {
    // A DOWNGRADE, and the one case where refusing is the whole job. Running
    // today's migrations over a state written by a later build would drop the
    // fields this build has never heard of and then write the result back —
    // turning "we cannot read this yet" into "your island is now damaged".
    // Nothing is stored, nothing is repaired, and load() quarantines the text.
    throw new SaveError(
      'newer',
      `[save] this save is from a newer version of the game (${version} > ${SAVE_VERSION})`
    );
  }
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new SaveError('no-migration', `[save] no migration from version ${version}`);
    state = step(state);
    version++;
  }
  state = repairCaptain(state);
  return { ...envelope, version, state: { ...(state as unknown as GameState), version } };
}

/**
 * The load path's one integrity check, and it exists because of `importSave`:
 * that file came off a player's disk, and a part id that is no longer in the
 * library would reach the renderer as a request for a model that is not there.
 *
 * A sound captain is returned UNTOUCHED — same object, same key order — so a
 * save that round-trips through here is byte-identical to the one that went in.
 * Only a broken one is rebuilt, and rebuilt per slot, so a captain who has lost
 * one hat does not also lose their name.
 */
function repairCaptain(state: Record<string, unknown>): Record<string, unknown> {
  const seed = typeof state.seed === 'string' ? state.seed : 'la-leyenda';
  const captain = state.captain as Partial<GameState['captain']> | undefined;
  const sound =
    !!captain &&
    typeof captain.name === 'string' &&
    captain.name.length > 0 &&
    captain.seed === seed &&
    isValidLook(captain.look);
  if (sound) return state;
  console.warn('[save] the captain on this save was incomplete — rebuilt from the island seed');
  return { ...state, captain: sanitizeCaptain(captain, seed) };
}

/* --------------------------------------------------------------------------
 * (de)serialization — pure
 * ----------------------------------------------------------------------- */

export function serialize(state: GameState, savedAt: number): string {
  const envelope: SaveEnvelope = { format: SAVE_FORMAT, version: SAVE_VERSION, savedAt, state };
  return JSON.stringify(envelope);
}

/**
 * The fields the sim reads on the FIRST tick, and therefore the ones whose
 * absence is a white screen rather than a bug report.
 *
 * `parseSave` used to check three things — the format tag, a numeric version
 * and a truthy state — and hand anything past that straight to the game. A
 * half-written file that happens to close its braces, a state whose
 * `buildings` came back as a string, a `store` that is null: all three parsed
 * cleanly and then threw inside `advanceInPlace` before the first frame, with
 * the exception landing in `boot().catch` and the player looking at an empty
 * canvas. Checked HERE instead, where a failure is a message and a quarantined
 * file rather than a dead app.
 *
 * Deliberately shallow. This is a triage gate, not a schema validator: it asks
 * whether each field is the right SHAPE for the code that is about to walk it,
 * and leaves the contents to `repairCaptain` and to the sim's own tolerance.
 */
const SHAPE: ReadonlyArray<[keyof GameState, 'number' | 'string' | 'object' | 'array']> = [
  ['version', 'number'], ['seed', 'string'], ['now', 'number'],
  ['buildings', 'array'], ['obstacles', 'array'], ['chests', 'array'],
  ['store', 'object'], ['builders', 'object'], ['daily', 'object'],
  ['quests', 'object'], ['stats', 'object'], ['flags', 'object'],
];

function faultsIn(state: unknown): string[] {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return ['the state is not an object'];
  const record = state as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, kind] of SHAPE) {
    const value = record[key as string];
    const ok =
      kind === 'array' ? Array.isArray(value)
      : kind === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value)
      : typeof value === kind && (kind !== 'number' || Number.isFinite(value));
    if (!ok) bad.push(`${String(key)} should be ${kind === 'array' ? 'an array' : `a ${kind}`}`);
  }
  return bad;
}

/** Throws a SaveError with a readable message on anything that is not one of
 *  our saves, or is one of ours and is damaged. */
export function parseSave(text: string): SaveEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Includes the truncated case: a write killed halfway leaves valid JSON
    // right up to the point it stops, and JSON.parse is what notices.
    throw new SaveError('not-json', '[save] that file is not JSON');
  }
  const envelope = parsed as Partial<SaveEnvelope>;
  if (!envelope || typeof envelope !== 'object' || envelope.format !== SAVE_FORMAT) {
    throw new SaveError('not-ours', '[save] that file is not a La Leyenda save');
  }
  if (typeof envelope.version !== 'number' || !envelope.state) {
    throw new SaveError('incomplete', '[save] that save is missing its version or its state');
  }

  // The version gate runs BEFORE the shape gate on purpose: a save from a
  // later build may legitimately have fields this one does not recognise, and
  // "we cannot read this yet" is a different sentence from "this is damaged".
  const migrated = migrate(envelope as SaveEnvelope);

  const bad = faultsIn(migrated.state);
  if (bad.length) {
    throw new SaveError('incomplete', `[save] that save is damaged: ${bad.join(', ')}`);
  }
  return migrated;
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
  // Both doors shut. The game still runs — an island in memory is better than
  // no island — but every hour of it dies at the next reload, and that is not
  // something to discover afterwards. Private-mode Safari and locked-down
  // webviews land here, and so does a device so full that even the two-byte
  // probe is refused.
  reportTrouble({ kind: 'ephemeral' });
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
      // A save we cannot read is KEPT, never overwritten: it is the only copy
      // the player has, and a file we cannot parse today is still a file a
      // later build — or a hand-edited rescue — may be able to. Quarantining is
      // half the job; the other half is that somebody is told, with the text in
      // hand, so it can be offered as a download.
      const newer = err instanceof SaveError && err.fault === 'newer';
      try {
        await this.backend.set(BROKEN_KEY, text);
      } catch (quarantineErr) {
        console.warn('[save] could not quarantine the unreadable save', quarantineErr);
      }
      reportTrouble({ kind: newer ? 'newer' : 'unreadable', raw: text, error: err });
      return null;
    }
  }

  /** The quarantined text, if this device is holding one. Offered in Ajustes
   *  as a download, because it may be the only copy of that island left. */
  async quarantined(): Promise<string | null> {
    try {
      return await this.backend.get(BROKEN_KEY);
    } catch {
      return null;
    }
  }

  /** What the last successful write actually stored, so an identical one can
   *  be skipped. See the note in `save`. */
  private lastWritten: string | null = null;

  async save(state: GameState, savedAt: number): Promise<void> {
    const body = JSON.stringify(state);
    // AN IDENTICAL WRITE IS SKIPPED, and the moment it matters is the worst
    // moment there is. Backgrounding a game on a phone fires `visibilitychange`
    // and then `pagehide` within a millisecond of each other, and the loop has
    // already stopped, so both handlers serialize the SAME state and both ask
    // the device to store 16 KB — while the OS is trying to freeze the app. On
    // a slow device that is two full IndexedDB transactions bought for nothing.
    //
    // Compared on the state alone rather than on the envelope, because
    // `savedAt` differs on every call by construction and would defeat the
    // check entirely. Nothing reads the stored `savedAt`: `load` takes only
    // `.state`, and an export stamps its own.
    if (body === this.lastWritten) return;
    const text = serialize(state, savedAt);
    try {
      await this.enqueue(() => this.backend.set(SAVE_KEY, text));
      this.lastWritten = body;
      reportRecovered();
    } catch (err) {
      // Announced AND rethrown. The throw is what the Guardar row in Ajustes
      // already reports on; the announcement is for the autosave, which is the
      // path a player is actually on and which had nowhere to put this but the
      // console. A player whose island stopped saving and was not told is a
      // player who loses everything at the next reload.
      reportTrouble({ kind: isQuotaError(err) ? 'quota' : 'write', error: err });
      throw err;
    }
  }

  async clear(): Promise<void> {
    // The remembered text goes with it, or Empezar de nuevo followed by a save
    // of the identical fresh island would be skipped as a duplicate and the
    // store would be left empty.
    this.lastWritten = null;
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

/**
 * Is there an island to come back to, and whose is it?
 *
 * The title screen asks this before it decides whether its primary button says
 * `Jugar` or `Continuar`, and it is deliberately the FULL load rather than a
 * key probe: a save that cannot be parsed is not one anybody can continue, and
 * `load()` is also what quarantines it. Returning null is always safe — the
 * worst case is a returning player being offered a fresh start, and nothing is
 * written until they confirm one.
 *
 * The state is READ-ONLY here. `createGame` loads it again for real; this is
 * the title asking a question, not the game taking ownership.
 */
export async function peekSavedGame(): Promise<GameState | null> {
  try {
    const store = await SaveStore.open();
    return await store.load();
  } catch (err) {
    console.warn('[save] could not check for a stored game', err);
    return null;
  }
}

/** Writes a state straight to the store, for the one caller that has a save
 *  but no game: importing a backup from the title screen, before there is
 *  anything to import INTO. */
export async function adoptSave(state: GameState, savedAt = Date.now()): Promise<void> {
  const store = await SaveStore.open();
  await store.save(state, savedAt);
}

/* --------------------------------------------------------------------------
 * the player's manual backup
 * ----------------------------------------------------------------------- */

/** Downloads the save as a JSON file. */
export function exportSaveFile(state: GameState, savedAt = Date.now()): void {
  downloadText(serialize(state, savedAt), exportFilename(savedAt));
}

/**
 * Downloads a save we could NOT read, exactly as it is stored.
 *
 * The recovery half of quarantine. A file this build refuses — damaged, or
 * written by a later one — is still the player's island, and a byte-for-byte
 * copy on their disk is the difference between a bad afternoon and a lost
 * account. Deliberately not re-serialized: whatever is wrong with it, it goes
 * out untouched, because the version that can read it is not this one.
 */
export function exportBrokenSaveFile(raw: string, savedAt = Date.now()): void {
  downloadText(raw, exportFilename(savedAt).replace('.json', '-dañada.json'));
}

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on the next turn: Safari cancels the download if the URL dies first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Whatever unreadable save this device is holding, if any. Read at boot so
 *  Ajustes can offer it for as long as it exists, not only in the one session
 *  where the failure happened. */
export async function readQuarantinedSave(): Promise<string | null> {
  try {
    const store = await SaveStore.open();
    return await store.quarantined();
  } catch {
    return null;
  }
}

/** Reads a save the player picked from an `<input type="file">`. */
export async function importSaveFile(file: Blob): Promise<GameState> {
  return parseSave(await file.text()).state;
}
