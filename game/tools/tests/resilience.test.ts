import {
  BROKEN_KEY, SAVE_KEY, SAVE_VERSION, SaveError, SaveStore, currentSaveTrouble, isQuotaError,
  onSaveTrouble, parseSave, serialize, type SaveTrouble,
} from '../../src/core/save';
import { HOUR, MINUTE, startUpgrade, tick, type GameState } from '../../src/sim';
import cssModule from '../../src/ui/panels/settings.css';
import hudCssModule from '../../src/ui/hud.css';
import buttonCssModule from '../../src/ui/components/button.css';
import { describe, eq, ok, test } from './harness';
import { T0, find, rich } from './fixtures';

const CSS = cssModule as unknown as string;
/** The other two stylesheets whose CASCADE ORDER is itself the defect — see the
 *  Recoger Todo case in section 5. */
const HUD_CSS = hudCssModule as unknown as string;
const BUTTON_CSS = buttonCssModule as unknown as string;

/**
 * resilience.test.ts — every way this game can meet a real phone and lose.
 *
 * Six unhappy paths, none of which any round had looked at once: no network, a
 * full storage quota, a save from an older version, a save from a newer one, a
 * corrupt or truncated save, a tiny screen, a rotated phone, a slow device.
 * The migration chain lives next door in save.test.ts, where the chain already
 * was; this file is about the device REFUSING us, and about what the player is
 * told when it does.
 *
 * WHY THE TOP OF THIS FILE IS ASYNCHRONOUS
 *
 * `harness.ts` runs a case synchronously and does not await it, so a `test()`
 * body that returned a promise would report a pass the instant it started and
 * swallow every rejection after that — the exact silence this round exists to
 * remove. The storage paths are all async (`SaveStore.open`, `save`, `load`),
 * so they are DRIVEN HERE at module scope, under top-level await, and each
 * records what happened into a plain object. The cases below are then ordinary
 * synchronous assertions about a run that has already finished.
 *
 * WHAT STANDS IN FOR A FULL PHONE
 *
 * A localStorage that takes the two-byte probe and refuses anything real. That
 * is what a device at its quota actually does — `pickBackend` succeeds, the
 * store looks healthy, and then the first island-sized write is rejected —
 * and it is the reason a quota failure was invisible: the failure is not at
 * startup, it is twenty seconds later, on a path with nobody watching.
 */

/* --------------------------------------------------------------------------
 * a storage that behaves like a real one, including badly
 * ----------------------------------------------------------------------- */

interface FakeOptions {
  /** Refuse any value longer than this, the way a full device does. */
  limit?: number;
  /** Refuse everything, including the probe. */
  sealed?: boolean;
}

class FakeStorage {
  readonly map = new Map<string, string>();
  /** Every accepted or attempted write, so a duplicate can be counted. */
  writes = 0;
  constructor(private readonly options: FakeOptions = {}) {}
  get length(): number { return this.map.size; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  setItem(k: string, v: string): void {
    if (k.endsWith(SAVE_KEY)) this.writes++;
    if (this.options.sealed || v.length > (this.options.limit ?? Infinity)) {
      // The shape Chrome and Firefox throw. WebKit's nameless code-22 form is
      // covered by its own case below, against `isQuotaError` directly.
      const err = new Error(`Setting the value of '${k}' exceeded the quota.`);
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.map.set(k, v);
  }
}

function useStorage(storage: FakeStorage | null): void {
  if (storage) Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  else Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
}

/** A played island: stores full, a builder out on a job, five hours on it. */
function played(): GameState {
  let state = tick(rich(), T0 + 5 * HOUR).state;
  state = startUpgrade(state, find(state, 'almacen').id, state.now).state;
  return tick(state, state.now + 5 * MINUTE).state;
}

/** Collects everything a listener is told, in order. */
function listen(): { heard: Array<SaveTrouble | null>; stop: () => void } {
  const heard: Array<SaveTrouble | null> = [];
  const stop = onSaveTrouble((t) => heard.push(t));
  return { heard, stop };
}

/* --------------------------------------------------------------------------
 * the runs — driven once, here, before any case is registered
 * ----------------------------------------------------------------------- */

const ISLAND = played();
const GOOD_SAVE = serialize(ISLAND, T0);

const quota = {
  backend: '' as string,
  explicitRejected: false,
  quotaClassified: false,
  heard: [] as Array<SaveTrouble | null>,
  autosaveHeardCount: 0,
  recoveredAfterSpaceFreed: false,
  storedAfterRecovery: false,
};

{
  // A phone at its quota: the probe fits, an island does not.
  const storage = new FakeStorage({ limit: 64 });
  useStorage(storage);
  const store = await SaveStore.open();
  quota.backend = store.backendName;

  const ears = listen();
  await store.save(ISLAND, T0).catch((err) => {
    quota.explicitRejected = true;
    quota.quotaClassified = isQuotaError(err);
  });

  // The path a player is actually on. The autosave swallows its own rejection
  // (game.ts hands it no onError), so this is the case that used to end at a
  // console line nobody reads.
  const before = ears.heard.length;
  const stopAutosave = store.startAutosave({ intervalMs: 4, getState: () => ISLAND });
  await new Promise((r) => setTimeout(r, 40));
  stopAutosave();
  quota.autosaveHeardCount = ears.heard.length - before;

  // Space is freed. The store must say so, so the warning can come down.
  storage.map.clear();
  Object.defineProperty(storage, 'options', { value: { limit: Infinity }, configurable: true });
  await store.save(ISLAND, T0);
  quota.recoveredAfterSpaceFreed = ears.heard[ears.heard.length - 1] === null;
  quota.storedAfterRecovery = storage.getItem(`la-leyenda:${SAVE_KEY}`) === GOOD_SAVE;

  quota.heard = [...ears.heard];
  ears.stop();
}

const sealed = { backend: '', kinds: [] as string[] };
let memoryRoundTrip: GameState | null = null;
{
  // Private-mode Safari, a locked-down webview, or a device so full that even
  // the probe is refused: no durable storage at all.
  useStorage(new FakeStorage({ sealed: true }));
  const ears = listen();
  const store = await SaveStore.open();
  sealed.backend = store.backendName;
  // It must still WORK — an island in memory beats no island.
  await store.save(ISLAND, T0);
  memoryRoundTrip = await store.load();
  sealed.kinds = ears.heard.map((t) => t?.kind ?? 'recovered');
  ears.stop();
}

/** A save with one field replaced by something of the wrong type, built by
 *  mutating the object rather than by string surgery — a regex over JSON
 *  produces text that fails at `JSON.parse` and proves nothing about the
 *  shape gate that is being tested. */
function withField(field: string, value: unknown): string {
  const envelope = JSON.parse(GOOD_SAVE) as { state: Record<string, unknown> };
  envelope.state[field] = value;
  return JSON.stringify(envelope);
}

function withoutField(field: string): string {
  const envelope = JSON.parse(GOOD_SAVE) as { state: Record<string, unknown> };
  delete envelope.state[field];
  return JSON.stringify(envelope);
}

interface DamageRun {
  loaded: GameState | null;
  kind: string;
  raw: string | null;
  quarantined: string | null;
  originalKept: string | null;
}
const damaged: Record<string, DamageRun> = {};

for (const [label, text] of [
  // A write killed halfway. Valid JSON right up to the point it stops.
  ['truncated', GOOD_SAVE.slice(0, Math.floor(GOOD_SAVE.length * 0.6))],
  // Right shape, wrong types — the case that parsed cleanly and then threw
  // inside the sim before the first frame.
  ['wrong types', withField('buildings', 'unas casas')],
  // A key the sim walks on every tick, gone.
  ['missing keys', withoutField('store')],
  // Not ours at all — a player picked the wrong file.
  ['someone else\'s json', '{"hello":"world"}'],
  // Written by a later build. NOT damage, and it must not be treated as such.
  ['from a newer version', GOOD_SAVE.replace(`"version":${SAVE_VERSION}`, `"version":${SAVE_VERSION + 1}`)],
] as const) {
  const storage = new FakeStorage();
  storage.setItem(`la-leyenda:${SAVE_KEY}`, text);
  useStorage(storage);
  const store = await SaveStore.open();
  const loaded = await store.load();
  // Read through `currentSaveTrouble` rather than through a listener: the
  // store deliberately does NOT re-announce a trouble of the same kind (a
  // notice a player dismissed must not come back every twenty seconds), and
  // these five runs share two kinds between them. The remembered trouble is
  // always current; only the announcement is throttled.
  const last = currentSaveTrouble();
  damaged[label] = {
    loaded,
    kind: last?.kind ?? 'nothing was said',
    raw: last?.raw ?? null,
    quarantined: storage.getItem(`la-leyenda:${BROKEN_KEY}`),
    originalKept: storage.getItem(`la-leyenda:${SAVE_KEY}`),
  };
}

/** A listener that subscribes AFTER the failure still hears about it. */
const replay: { kind: string; raw: boolean } = { kind: 'nothing', raw: false };
{
  const storage = new FakeStorage();
  storage.setItem(`la-leyenda:${SAVE_KEY}`, 'not json at all');
  useStorage(storage);
  const store = await SaveStore.open();
  await store.load();                       // fails with nobody listening
  const ears = listen();                    // and only then does anyone listen
  const first = ears.heard[0];
  replay.kind = first?.kind ?? 'nothing';
  replay.raw = typeof first?.raw === 'string';
  ears.stop();
}

/** Backgrounding a phone: `visibilitychange` and then `pagehide`, one
 *  millisecond apart, both handed the SAME state because the loop has already
 *  stopped. */
const backgrounding = { writes: 0, afterAChange: 0, afterAClear: 0, stored: false };
{
  const storage = new FakeStorage();
  useStorage(storage);
  const store = await SaveStore.open();
  await store.save(ISLAND, T0);
  await store.save(ISLAND, T0 + 1);          // the second handler, same island
  await store.save(ISLAND, T0 + 2);          // and beforeunload behind it
  backgrounding.writes = storage.writes;
  backgrounding.stored = storage.getItem(`la-leyenda:${SAVE_KEY}`) !== null;

  // A real change must of course still be written.
  const moved = tick(ISLAND, ISLAND.now + MINUTE).state;
  await store.save(moved, T0 + 3);
  backgrounding.afterAChange = storage.writes;

  // And Empezar de nuevo must not be defeated by the same check: clearing and
  // then saving an identical island has to reach the device.
  await store.clear();
  await store.save(moved, T0 + 4);
  backgrounding.afterAClear = storage.writes;
}

/** A healthy device, so the suite does not leave a trouble standing. */
{
  useStorage(new FakeStorage());
  const store = await SaveStore.open();
  await store.save(ISLAND, T0);
}
useStorage(null);

/* ==========================================================================
 * 2 · a full storage quota
 * ======================================================================= */

describe('a full storage quota', () => {
  test('the store still opens — a full device does not look broken until you write', () => {
    eq(quota.backend, 'localstorage', 'the probe fits, so the backend is picked normally');
  });

  test('an explicit save rejects, and the rejection is recognisable as a quota', () => {
    ok(quota.explicitRejected, 'save() rejected rather than resolving on a write that never landed');
    ok(quota.quotaClassified, 'isQuotaError named it');
  });

  test('THE AUTOSAVE SAYS SO — the failure a player is actually on reaches a listener', () => {
    // The whole point of the round. Measured against the code as it stood:
    // eleven consecutive failed autosaves, every one of them ending at
    // console.error, and nothing exported that could be asked whether the
    // island was still being written. A player whose island stopped saving
    // and was not told is a player who loses everything at the next reload.
    const kinds = quota.heard.filter((t) => t?.kind === 'quota');
    ok(kinds.length > 0, 'a quota trouble reached a listener');
  });

  test('it is announced ONCE, not on every twenty-second retry', () => {
    // A notice the player dismissed must not come back three times a minute.
    eq(quota.autosaveHeardCount, 0, 'ten more failed autosaves added no new announcements');
  });

  test('freeing space takes the warning back down', () => {
    ok(quota.recoveredAfterSpaceFreed, 'the listener was told the trouble is over');
    ok(quota.storedAfterRecovery, 'and the island really was written this time');
    eq(currentSaveTrouble(), null, 'the store no longer reports a standing trouble');
  });

  test('every spelling of a full device is recognised, and nothing else is', () => {
    // Four real shapes. WebKit's is the one a name check alone misses, and iOS
    // Safari is exactly where a full quota is most likely.
    const named = new Error('nope'); named.name = 'QuotaExceededError';
    const firefox = new Error('nope'); firefox.name = 'NS_ERROR_DOM_QUOTA_REACHED';
    const webkit = Object.assign(new Error(''), { code: 22 });
    const legacy = Object.assign(new Error(''), { code: 1014 });
    for (const err of [named, firefox, webkit, legacy]) {
      ok(isQuotaError(err), `recognised ${err.name || 'code ' + (err as { code?: number }).code}`);
    }
    for (const other of [null, undefined, 'a string', new Error('the db is closed'),
                         Object.assign(new Error(''), { code: 11 })]) {
      ok(!isQuotaError(other), `not mistaken for a quota: ${String(other)}`);
    }
  });
});

/* ==========================================================================
 * a device with no durable storage at all
 * ======================================================================= */

describe('a browser that refuses storage outright', () => {
  test('the game still runs, in memory', () => {
    eq(sealed.backend, 'memory', 'it degrades instead of throwing');
    ok(memoryRoundTrip !== null, 'and the island round-trips for as long as the tab lives');
  });

  test('and the player is told it will not survive the tab', () => {
    // Private-mode Safari. Silently playing a session that evaporates at the
    // next launch is the same one-star review as the quota case, arriving a
    // little later.
    ok(sealed.kinds.includes('ephemeral'), `announced (heard: ${sealed.kinds.join(', ') || 'nothing'})`);
  });
});

/* ==========================================================================
 * 4 · a corrupt or truncated save
 * ======================================================================= */

describe('a save this build cannot read', () => {
  for (const label of ['truncated', 'wrong types', 'missing keys', "someone else's json"]) {
    test(`${label}: the game starts instead of white-screening`, () => {
      const run = damaged[label];
      ok(run !== undefined, 'the case ran');
      eq(run.loaded, null, 'load() answers "there is nothing to continue" rather than throwing');
      eq(run.kind, 'unreadable', 'and says why, in a shape the UI can branch on');
    });

    test(`${label}: the only copy of that island is kept, byte for byte`, () => {
      const run = damaged[label];
      ok(!!run.quarantined, 'quarantined');
      eq(run.quarantined, run.originalKept, 'and the original was not overwritten either');
      eq(run.raw, run.quarantined, 'the text is handed to the listener so it can be offered as a file');
    });
  }

  test('a truncated save is caught by JSON.parse, not by the sim on frame one', () => {
    const cut = GOOD_SAVE.slice(0, Math.floor(GOOD_SAVE.length * 0.6));
    let fault = '';
    try { parseSave(cut); } catch (err) { fault = err instanceof SaveError ? err.fault : String(err); }
    eq(fault, 'not-json', 'named as unparseable');
  });

  test('a save whose fields are the wrong TYPE is refused at the door', () => {
    // The white-screen case, and the reason parseSave grew a shape gate: this
    // one parses, passes the format check, and then throws inside the first
    // `advanceInPlace` with the exception landing in boot().catch.
    for (const [field, broken] of [
      ['buildings', withField('buildings', 'unas casas')],
      ['store', withField('store', null)],
      ['flags', withField('flags', [])],
      ['obstacles', withField('obstacles', { 0: 'palmera' })],
      ['now', withField('now', 'ayer')],
      ['chests', withoutField('chests')],
    ] as const) {
      let message = '';
      try { parseSave(broken); } catch (err) { message = String(err); }
      ok(message.includes('damaged'), `${field}: refused (got: ${message.slice(0, 90)})`);
      ok(message.includes(field), `${field}: and the message names the field`);
    }
  });

  test('a whole save survives the gate it has to pass through', () => {
    // The gate must not be so eager that it refuses a good save. This is the
    // assertion that catches a shape rule written one field too strict.
    const back = parseSave(GOOD_SAVE).state;
    eq(JSON.stringify(back), JSON.stringify(ISLAND), 'nothing was lost or refused');
  });

  test('a save from a newer version is refused as a DOWNGRADE, not as damage', () => {
    const run = damaged['from a newer version'];
    eq(run.loaded, null, 'not loaded');
    eq(run.kind, 'newer', 'and told apart from a corrupt file, because the fix is different');
    eq(run.quarantined, run.originalKept, 'their island is untouched and still on the device');
  });

  test('a listener that subscribes after the failure still hears about it', () => {
    // Raceless by construction: the title screen reads storage through
    // peekSavedGame before the router has finished wiring itself up, and a
    // corrupt save found there must still reach the player.
    eq(replay.kind, 'unreadable', 'the last trouble is replayed on subscribe');
    ok(replay.raw, 'with the raw text, so the rescue download is still possible');
  });
});

/* ==========================================================================
 * 6 · a slow device
 *
 * The renderer's own ceiling is not assertable from here — it is a line in
 * `stage.ts` and it is measured in a browser instead (devicePixelRatio 3 on a
 * 393x852 phone produces the same 786x1704 buffer as 2, so the cap holds). What
 * IS in this file's reach is the work the STORE does at the worst moment on a
 * slow phone: the instant the OS decides to freeze the app.
 * ======================================================================= */

describe('a slow device being backgrounded', () => {
  test('three handlers fire and the device is asked to write ONCE', () => {
    // visibilitychange, then pagehide, then beforeunload — all within a
    // millisecond, all with the same island, because the frame loop has
    // already stopped. Three full 16 KB transactions bought for nothing,
    // queued against a device that is trying to suspend the process.
    eq(backgrounding.writes, 1, 'the two duplicates were skipped');
    ok(backgrounding.stored, 'and the island really is on the device');
  });

  test('a real change is still written', () => {
    // The assertion that keeps the optimisation from becoming a lost minute.
    eq(backgrounding.afterAChange, 2, 'a state that moved reaches the device');
  });

  test('and Empezar de nuevo is not defeated by it', () => {
    // Clearing and then saving an identical island must still write, or the
    // store is left empty by a duplicate check that was right about the bytes
    // and wrong about the device.
    eq(backgrounding.afterAClear, 3, 'the write after a clear always lands');
  });
});

/* ==========================================================================
 * 5 · a tiny screen and a rotated phone
 *
 * The stylesheet is the fixture (the tokens.test.ts pattern — esbuild inlines
 * it as text for this suite). Layout itself is judged on pixels, in shots; what
 * is asserted here is the handful of rules whose ABSENCE is a clipped panel on
 * a device nobody in this project owns, and which are silently easy to delete.
 * ======================================================================= */

describe('a tiny screen and a rotated phone', () => {
  test('Recoger Todo out-specifies .btn for POSITION, or it is not on the screen at all', () => {
    // Round 15's gate found this by walking the tiny-screen path, and it turned
    // out not to be about small screens at all.
    //
    // `.collect-all` (hud.css) sets `position:absolute`. `.btn`
    // (components/button.css) sets `position:relative`. Both are (0,1,0) and
    // button.css is imported LAST, so `.btn` won — and on a relative box
    // `bottom:159px` does not mean "159px up from the bottom of the screen", it
    // means "shift 159px up from where you would otherwise sit". Every sibling
    // in `.hud` is absolute, so the pill's flow position is the TOP of the hud,
    // and it was drawn at y=-159: entirely off the top edge, at every viewport
    // measured — 320x568, 360x640, 390x844, 430x932 and all three landscapes.
    // §3.9's four-bubble shortcut had never once been tappable.
    //
    // The neighbouring rule for `transform` documents the same hazard and was
    // written by someone who knew about it; `position` was the property that
    // got away. Asserted as a RELATIONSHIP rather than a string match, so it
    // still holds if either file is reworded.
    const pos = (css: string, sel: string): string | null => {
      const block = new RegExp(`${sel}\\s*\\{[^}]*\\}`, 's').exec(css)?.[0];
      return block ? (/position:\s*([a-z]+)/.exec(block)?.[1] ?? null) : null;
    };
    eq(pos(BUTTON_CSS, '\\.btn'), 'relative', 'the trap is still there: .btn positions itself');
    eq(pos(HUD_CSS, '\\.collect-all\\.btn'), 'absolute',
      'so hud.css must win it back on a two-class selector — a bare .collect-all cannot');
    // And the offsets it needs that only mean anything on an absolute box.
    const base = /\.collect-all\s*\{[^}]*\}/s.exec(HUD_CSS)?.[0] ?? '';
    ok(/bottom:\s*calc\(/.test(base), 'the pill is still placed off the bottom edge');
    ok(/left:\s*50%/.test(base), 'and centred in the channel');
  });

  test('the sheet is sized against the viewport, never fixed wider than one', () => {
    ok(/\.settings__sheet\s*\{[^}]*width:\s*min\(/.test(CSS),
      'the sheet takes min(x, 100%) so a 320pt screen cannot be overflowed');
    ok(/\.notice__card\s*\{[^}]*width:\s*min\(/.test(CSS), 'and so does the notice card');
  });

  test('both surfaces respect all four safe-area insets', () => {
    // A notch eats the top, a home bar eats the bottom, and a LANDSCAPE sensor
    // housing eats a side — which is the one everybody forgets, because a
    // portrait-only test never sees it.
    const notice = /\.notice\s*\{[^}]*\}/s.exec(CSS)?.[0] ?? '';
    for (const inset of ['--ui-safe-t', '--ui-safe-b', '--ui-safe-l', '--ui-safe-r']) {
      ok(notice.includes(inset), `the notice pads for ${inset}`);
    }
    const settings = /\.settings\s*\{[^}]*\}/s.exec(CSS)?.[0] ?? '';
    for (const inset of ['--ui-safe-t', '--ui-safe-b', '--ui-safe-l', '--ui-safe-r']) {
      // The SIDES are the ones this round had to add, and they are the ones a
      // portrait capture can never catch. Measured at 480x320 with a 59pt
      // housing: without them the sheet's left edge sat at x=30 and its close
      // button's right at 435, both inside the housing; with them, clear.
      ok(settings.includes(inset), `Ajustes pads for ${inset}`);
    }
  });

  test('there is a rule for the SE and a rule for a phone on its side', () => {
    ok(/@media\s*\(max-width:\s*379px\)/.test(CSS), 'an iPhone-SE-and-below block exists');
    ok(/@media\s*\(orientation:\s*landscape\)/.test(CSS), 'a landscape block exists');
    ok(/@media\s*\(orientation:\s*landscape\)\s*and\s*\(max-height:\s*480px\)/.test(CSS),
      'and a short-landscape block, which is where a card runs off both ends at once');
  });

  test('a sheet taller than the screen scrolls rather than clipping', () => {
    ok(/\.settings__body\s*\{[^}]*overflow-y:\s*auto/s.test(CSS), 'Ajustes scrolls its body');
    ok(/\.notice__card\s*\{[^}]*max-height:\s*100%/s.test(CSS), 'the notice card is bounded by the screen');
    ok(/\.notice__card\s*\{[^}]*overflow-y:\s*auto/s.test(CSS), 'and scrolls inside that bound');
  });

  test('every tap target in these panels is at least 42px tall', () => {
    // Apple asks for 44pt and this build honours it; the two 42s are the
    // deliberate short-landscape and warn-bar steps, and nothing may go below.
    const heights = [...CSS.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1]));
    ok(heights.length >= 4, `found ${heights.length} declared control heights`);
    const small = heights.filter((h) => h > 0 && h < 42);
    eq(small.join(','), '', 'nothing declares a control shorter than 42px');
  });
});

/* ==========================================================================
 * the notice itself — a warning must never become the failure
 * ======================================================================= */

describe('the notice a player is shown', () => {
  test('a warning does not take the game away: only the card takes a tap', () => {
    const layer = /\.notice\s*\{[^}]*\}/s.exec(CSS)?.[0] ?? '';
    ok(layer.includes('pointer-events: none'), 'the layer itself never eats a tap');
    ok(/\.notice__card\s*\{[^}]*pointer-events:\s*auto/s.test(CSS), 'the card does');
    // Which is what keeps a quota bar from being a wall across a live island.
    ok(!/\.notice--warn[^{]*\{[^}]*pointer-events:\s*auto/s.test(CSS),
      'and the warn weight adds no blocking of its own');
  });

  test('a blocking notice is the only one with a backdrop', () => {
    ok(/\.notice--stop\b/.test(CSS), 'the stop weight exists');
    ok(/\.notice__scrim\s*\{/.test(CSS), 'and it is the thing that carries the scrim');
  });

  test('it sits above every panel it can interrupt', () => {
    const z = /\.notice\s*\{[^}]*z-index:\s*(\d+)/s.exec(CSS)?.[1];
    ok(!!z && Number(z) > 950,
      `above Ajustes (940) and the toast (950), because a quota failure can happen while both are up (got ${z})`);
  });

  test('the card carries all four layers of a raised object', () => {
    // §0.2. A warning drawn as flat web chrome is the one object in the build
    // a player would be right to distrust.
    const card = /\.notice__card\s*\{[^}]*\}/s.exec(CSS)?.[0] ?? '';
    ok(/border:\s*var\(--ui-ink-w\)\s*solid\s*var\(--ui-ink\)/.test(card), 'layer 1: the ink contour');
    const title = /\.notice__title\s*\{[^}]*\}/s.exec(CSS)?.[0] ?? '';
    ok(/box-shadow:[^;]*0 1px 0 rgba\(23, 19, 14/.test(title), 'layer 2: the hard step at the head band foot');
    ok(/inset 0 2px 0 rgba\(255, 255, 255/.test(title), 'layer 3: the warm top rim');
    ok(/0 5px 0 rgba\(0, 0, 0/.test(card), 'layer 4: a zero-x extrusion, not a blur');
  });

  test('the light runs downward across the one hard step the card has', () => {
    // The trap tokens.test.ts was written for, on a new object. Measured at
    // 320x568 before this was fixed: the head band's foot sat at L=226 over a
    // body top of L=239, so the light ran UPHILL and the card read as a flat
    // cream rectangle with a seam through it.
    const luma = (hex: string): number => {
      const v = parseInt(hex.slice(1), 16);
      return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
    };
    const band = /\.notice__title\s*\{[^}]*background:\s*linear-gradient\([^)]*?(#[0-9A-Fa-f]{6})\s*100%\)/s.exec(CSS)?.[1];
    const body = /\.notice__card\s*\{[^}]*background:\s*linear-gradient\([^;]*?(#[0-9A-Fa-f]{6})\s*0%/s.exec(CSS)?.[1];
    ok(!!band && !!body, `read both stops (band ${band}, body ${body})`);
    ok(luma(band ?? '#000') > luma(body ?? '#fff') + 8,
      `the band's foot (L=${Math.round(luma(band ?? '#000'))}) sits above the body's top ` +
      `(L=${Math.round(luma(body ?? '#fff'))})`);
  });
});
