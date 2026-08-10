import { Stage } from './render/stage';
import { measureRendered } from './render/assets';
import { createIslandScene, type IslandScene } from './scenes/islandScene';
import { createTitleScene } from './scenes/titleScene';
import { createCaptainScene } from './scenes/captainScene';
import { createGame, type Game } from './core/game';
import { adoptSave, importSaveFile, peekSavedGame } from './core/save';
import { createSettingsPanel, type SettingsPanel } from './ui/panels/settings';
import { createStorePanel, type StorePanel } from './ui/panels/store';
import { createLeaderboardPanel, fetchStandings, type LeaderboardPanel } from './ui/panels/leaderboard';
import { createTutorial, type Tutorial } from './ui/tutorial';
import { bakeIcons } from './ui/icons';
import { creditPack } from './sim/gems';
import {
  createCaptain, landCargoInPlace, setCaptain, setFlag, townHallLevel,
  type Captain, type GameState,
} from './sim';

/**
 * main.ts — the screen router.
 *
 * PRODUCTION.md §1: the first run does not exist, and "for a store release this
 * is the first ninety seconds, and it decides everything else". So the game no
 * longer boots onto the island; it boots onto a NAMED SCREEN, and the graph is:
 *
 *     title ──▶ captain ──▶ island ◀──▶ sea
 *       └──────────────────────┴──▶ ajustes (overlay, from either end)
 *
 * Four rules the whole file exists to keep:
 *
 *  1. **One screen at a time.** Leaving a screen disposes it before the next one
 *     is built. Two live scenes on one camera has been a real bug in this repo
 *     and it reads as the game having a seizure; `tools/roundtrip.mjs` asserts
 *     the island is GONE rather than merely covered, and that assertion is the
 *     only thing standing between us and it coming back.
 *  2. **The GAME outlives the screens.** It is created here, not inside a
 *     scene: a voyage that restarted the island's economy would lose the timers
 *     running while the player was away, and cargo would have nowhere to land.
 *     Scenes are views of a simulation that outlives them.
 *  3. **Every screen is photographable.** `?screen=` boots straight to one, and
 *     under `?shot=1` the world is advanced to a fixed simulated time and then
 *     frozen before `window.__ready` goes up. A screen that never sets __ready
 *     cannot be captured, and a screen nobody can capture is a screen nobody
 *     reviews.
 *  4. **A returning player never loses an island by accident.** The only route
 *     that destroys a save is Ajustes → Empezar de nuevo, behind two taps.
 */

declare global {
  interface Window {
    __ready?: boolean;
    __error?: string;
    /** Shot mode only — see the note where it is assigned. */
    __step?: (frames?: number) => void;
    /** Set when something in the scene draws at a wildly different size from
     *  the one it was normalized to — in either direction. The harness fails
     *  the capture on it. See __checkSizes. */
    __oversized?: string;
    /** Re-runs that check. The harness calls it after an act, because the bug
     *  it guards against arrived through an interaction. */
    __checkSizes?: () => string | undefined;
    /** Shot mode only — where the camera ended up. A drag act needs to assert
     *  the island actually moved, and "the picture changed" is not that: a
     *  running timer changes the picture too. */
    __camera?: () => [number, number, number];
    /** Shot mode only — which screen the router is on, so an act can wait for
     *  a navigation to land instead of sleeping and hoping. */
    __screen?: string;
  }
}

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
const shotTime = Number(params.get('t') ?? '2.0'); // simulated seconds for the frame
const seedParam = params.get('seed');
const seed = seedParam ?? 'la-leyenda';

/**
 * The seed a BRAND-NEW captain's island is rolled from.
 *
 * PRODUCTION.md §2: "Every player currently gets the same seeded island. The
 * seed should be the captain's, rolled or chosen at creation." So it is rolled
 * here, at creation, and stored on the captain — unless the URL pinned one,
 * which is what keeps every capture and every harness run deterministic.
 *
 * Rolled at the boundary, not in the sim: this is the one moment in the game
 * that is allowed to be genuinely unrepeatable, and after it the seed is a
 * stored string like any other.
 */
const rollIslandSeed = (): string =>
  seedParam ?? `isla-${Math.random().toString(36).slice(2, 10)}`;

/** `?save=` is a FIXTURE switch, not a screen: it names which island to boot
 *  and is how the roundtrip harness and every island capture get there without
 *  walking the menu. Its presence therefore also means "skip the title". */
const saveParam = params.get('save');
const saveStart = saveParam === 'demo' ? 'demo' : saveParam === 'new' ? 'new' : 'stored';

/** The frozen instant a capture's sim clock reads. It must stay equal to
 *  islandScene's own SHOT_EPOCH: the two never run at the same time, but a shot
 *  of Ajustes over the title and a shot of the island should not be describing
 *  two different days. */
const SHOT_EPOCH = Date.UTC(2026, 0, 5, 12, 0, 0);

const canvas = document.getElementById('scene') as HTMLCanvasElement;

/* --------------------------------------------------------------------------
 * screens
 * ----------------------------------------------------------------------- */

export type ScreenName = 'title' | 'captain' | 'island' | 'sea';

/**
 * Anything the frame loop and the shot path can drive. The two development
 * scenes are this and no more — nothing navigates to or from them, so they owe
 * nobody a dispose.
 */
interface Frameable {
  update(dt: number, elapsed: number): void;
  /** Only the sea implements it — see the note in the shot path. */
  settle?(): Promise<void>;
}

/** What every screen in the flow owes the router on top of that. */
interface Screen extends Frameable {
  dispose(): void;
}

const SCREENS: readonly string[] = ['title', 'captain', 'island', 'sea'];
const isScreen = (name: string | null): name is ScreenName => !!name && SCREENS.includes(name);

/**
 * Where to boot.
 *
 * `?screen=` is the name this router speaks; `?scene=` is the older one the
 * screenshot harness has always used and every act in tools/acts.mjs still
 * passes, so both are honoured and `screen` wins. Anything unrecognised falls
 * through to the save-driven default, which is the only path a player takes.
 */
const requested = params.get('screen') ?? params.get('scene');

async function boot(): Promise<void> {
  const stage = new Stage({
    canvas,
    fixedSize: shotMode
      ? { width: Number(params.get('w') ?? 1280), height: Number(params.get('h') ?? 720) }
      : null,
  });

  // The two development scenes are not part of the flow and never were: they
  // are a model viewer and a measuring rig, they take their own query params,
  // and nothing navigates to or from them.
  if (requested === 'model' || requested === 'measure') {
    await showDevScene(stage, requested);
    return;
  }

  await runRouter(stage);
}

/* --------------------------------------------------------------------------
 * the router
 * ----------------------------------------------------------------------- */

async function runRouter(stage: Stage): Promise<void> {
  let current: Screen | null = null;
  let currentName: ScreenName | null = null;
  let game: Game | null = null;
  let elapsed = 0;
  let looping = false;

  // An overlay layer of the router's own, OUTSIDE #ui. islandScene.dispose()
  // empties #ui wholesale — that is how it takes its picker, its sheets and its
  // celebration layer with it — so anything that has to outlive a screen, or be
  // torn down by hand, cannot live there.
  const overlayRoot = document.createElement('div');
  overlayRoot.id = 'overlay';
  (document.getElementById('app') ?? document.body).append(overlayRoot);

  let settings: SettingsPanel | null = null;
  let tutorial: Tutorial | null = null;
  // The two meta overlays (PRODUCTION.md §5): the Tienda and the Clasificación.
  // Same lifecycle as Ajustes — owned here, mounted in overlayRoot, closed by
  // every navigation — because both need the GAME, which only the router has.
  let store: StorePanel | null = null;
  let board: LeaderboardPanel | null = null;

  /**
   * Every navigation started by a tap goes through here.
   *
   * A screen is built asynchronously — models, a save, a dynamic import — so a
   * failure inside one is a rejected promise with nobody holding it. Without
   * this it disappears into the console as an unhandled rejection and the
   * player is left on a screen whose button does nothing, which is PRODUCTION.md
   * §7's "an error a player can hit shows something other than a blank canvas".
   */
  const nav = (run: () => Promise<void>): void => {
    void run().catch((err) => {
      window.__error = String(err?.stack || err);
      console.error('[router] navigation failed', err);
    });
  };

  /* --- the frame --------------------------------------------------------- */

  function startLoop(): void {
    if (looping || shotMode) return;
    looping = true;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      elapsed += dt;
      current?.update(dt, elapsed);
      stage.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    window.__ready = true;
  }

  /**
   * The one place a screen changes.
   *
   * `after` runs with the new screen built and mounted but BEFORE the shot path
   * freezes the frame, which is what lets `?screen=settings` photograph an
   * overlay: anything mounted after __ready goes up is a race the harness loses.
   */
  async function show(
    name: ScreenName,
    build: () => Promise<Screen>,
    after?: () => void | Promise<void>
  ): Promise<void> {
    closeSettings();
    closeStore();
    closeBoard();
    tutorial?.dispose();
    tutorial = null;

    current?.dispose();
    current = null;
    currentName = null;

    const screen = await build();
    current = screen;
    currentName = name;
    window.__screen = name;

    // Awaited: the shot path freezes the frame the moment this returns, and
    // anything mounted after that is a race the harness loses.
    await after?.();

    if (shotMode) await freeze(stage, () => current, screen);
    else startLoop();
  }

  /* --- the game ---------------------------------------------------------- */

  async function ensureGame(): Promise<Game> {
    game ??= await createGame({
      seed,
      start: saveStart,
      // A capture must never overwrite a real save, and must not depend on when
      // it was taken. `persist:false` also means no IndexedDB is opened at all.
      persist: !shotMode,
      clock: shotMode ? () => SHOT_EPOCH : undefined,
    });
    return game;
  }

  /* --- destinations ------------------------------------------------------ */

  async function toTitle(opts: { settings?: boolean } = {}): Promise<void> {
    // A capture must never depend on what is in this browser's IndexedDB, so
    // shot mode is told which face to wear instead of asking.
    const saved = shotMode ? null : await peekSavedGame();
    const returning = shotMode
      ? saveParam === 'demo' || params.get('returning') === '1'
      : saved !== null;
    const captainName = shotMode ? createCaptain(seed).name : saved?.captain?.name ?? null;

    await show(
      'title',
      () => createTitleScene(stage, {
        returning,
        captainName,
        onPlay: () => nav(() => (returning ? toIsland() : toCaptain())),
        onSettings: () => nav(openSettings),
      }),
      opts.settings ? () => openSettings() : undefined
    );
  }

  async function toCaptain(): Promise<void> {
    // Rolled once, HERE, so the captain the screen opens on and the island they
    // confirm are the same one — re-rolling on confirm would hand the player a
    // different pirate than the one they were looking at.
    const island = rollIslandSeed();
    await show('captain', () => createCaptainScene(stage, {
      seed: island,
      onBack: () => nav(toTitle),
      onConfirm: (captain) => nav(() => startNewGame(captain)),
    }));
  }

  /**
   * Creation confirmed: this is the moment a player's island comes into being.
   *
   * The game is built from the CAPTAIN'S SEED, which is what makes the island
   * theirs (PRODUCTION.md §2 — "the seed should be the captain's, rolled or
   * chosen at creation"), and the captain is written onto the fresh state
   * through the sim like every other change. It is saved before the island is
   * built so that a player who closes the app during the first load still has a
   * captain and an island when they come back.
   */
  async function startNewGame(captain: Captain): Promise<void> {
    game?.stop();
    game = await createGame({ seed: captain.seed, start: 'new' });
    game.dispatch((state) => setCaptain(state, captain));
    await game.saveNow();
    await toIsland();
  }

  async function toIsland(opts: { panel?: 'store' | 'leaderboard' } = {}): Promise<void> {
    // `?screen=store` / `?screen=leaderboard` boot the island with that overlay
    // already up, exactly as `?screen=settings` boots the title with Ajustes up
    // — the awaited `after` is what lets the shot path photograph an overlay.
    const openPanel = async (): Promise<void> => {
      if (opts.panel === 'store') await openStore();
      else if (opts.panel === 'leaderboard') await openBoard();
    };

    // Shot mode boots exactly one scene and never switches, so the island keeps
    // making its own game exactly as it always has — persistence off AND the sim
    // clock frozen inside the scene, which is what makes an island capture
    // byte-identical between runs. Handing it the router's would change every
    // island shot in the project, so it does not.
    if (shotMode) {
      await show('island', () => createIslandScene(stage, seed), async () => {
        watchNavSettings();
        watchNavMeta();
        maybeTeach(null);
        await openPanel();
      });
      return;
    }

    const live = await ensureGame();
    await show(
      'island',
      () => createIslandScene(stage, live.state().seed, {
        game: live,
        onSail: () => nav(toSea),
      }),
      async () => {
        watchNavSettings();
        watchNavMeta();
        maybeTeach(live);
        await openPanel();
      }
    );
  }

  async function toSea(): Promise<void> {
    const { createSeaScene } = await import('./scenes/seaScene');

    // As above: a sea capture is one scene with no way home, exactly as it has
    // always been photographed.
    if (shotMode) {
      await show('sea', () => createSeaScene(stage, { seed }));
      return;
    }

    const live = await ensureGame();
    // Flush BEFORE the sea builds: the scene reads the STORED save to decide
    // which hull is at the helm (src/scenes/seaScene.ts), and the autosave runs
    // on a 20-second interval — so without this line a player who finishes the
    // Astillero and taps ¡Zarpar! inside that window sails the hull they just
    // paid to replace. The gate's round-10 walk hit exactly that: 20 000 oro
    // for the Balandra, and the dock card said Esquife.
    await live.saveNow();
    await show('sea', () => createSeaScene(stage, {
      seed: live.state().seed,
      onEnd: (voyage) => {
        // The one place the sea touches the island's economy, and it goes
        // through the sim like every other change: caps apply, and what will
        // not fit is reported rather than silently dropped.
        live.dispatch((state) => {
          const { spilled } = landCargoInPlace(state, voyage.cargo);
          const over = Object.values(spilled).reduce((a, b) => a + (b ?? 0), 0);
          if (over > 0) console.log(`[voyage] ${Math.round(over)} units would not fit in the stores`);
          return { ok: true, state, events: [] };
        });
        nav(() => live.saveNow().then(() => toIsland()));
      },
    }));
  }

  /* --- the tutorial ------------------------------------------------------ */

  /**
   * AN ISLAND THAT IS PAST ITS OPENING IS NOT TAUGHT.
   *
   * `flags.tutorialDone` answers this for anyone who has met the tutorial. It
   * cannot answer it for a save written BEFORE the tutorial existed, and those
   * are real: `src/core/save.ts`'s 1 → 2 migration turns down the wilderness for
   * exactly this reason — *"to hand them a tutorial they are five hours past"* —
   * and then the tutorial was handed to them anyway, because nothing set the
   * flag. A player with a built-out island being walked through "despeja esa
   * palmera" is the most obvious possible sign of a game that does not know who
   * is playing it.
   *
   * The test is what the tutorial TEACHES, not how much of it has been done: a
   * second building, a hall above Nv1, or a single recorded collect or clear all
   * mean the lesson has already been had.
   *
   * ...unless the player is IN the walk. Any `tut.` flag means they have met the
   * contramaestre and quit partway, and the whole point of a resolver rather than
   * a cursor is that they come back to the beat the island still needs — which
   * is usually one they have just done the work for. So a walk in progress
   * always outranks this.
   */
  function alreadyPlayed(state: GameState): boolean {
    if (Object.keys(state.flags).some((flag) => flag.startsWith('tut.'))) return false;
    return state.buildings.length > 1
      || townHallLevel(state) > 1
      || state.stats.collects > 0
      || state.stats.obstacles > 0;
  }

  /**
   * Mounted over the island, once, for a player who has not been through it.
   *
   * It is the router's rather than the island's because it survives the island
   * being disposed and rebuilt (a voyage in the middle of the opening), and
   * because "has this player been taught" is a save-level fact.
   */
  function maybeTeach(live: Game | null): void {
    // In a capture the tutorial is off unless it is the thing being
    // photographed: it would otherwise cover the island in every island shot
    // taken from a cold boot, which is every island shot there is.
    if (shotMode && params.get('tutorial') !== '1') return;
    if (live && live.state().flags.tutorialDone) return;
    if (live && alreadyPlayed(live.state())) {
      // Marked rather than merely skipped, so the question is asked once and
      // the answer travels with the save.
      live.dispatch((state) => setFlag(state, 'tutorialDone'));
      void live.saveNow();
      return;
    }
    // The island on the stage right now, for the two seams src/ui/tutorial.ts
    // names. It is read at call time rather than captured, because a voyage in
    // the middle of the opening replaces the scene under a tutorial that
    // deliberately outlives it.
    const island = (): IslandScene | null =>
      currentName === 'island' ? (current as IslandScene) : null;
    tutorial = createTutorial({
      root: overlayRoot,
      // SEAM 1: with the live game the three acknowledgement beats write their
      // flags into the SAVE through the sim, which is what makes the walk
      // resumable across a quit rather than only across a scene change.
      game: live ?? undefined,
      // SEAM 2: a cell becomes a point on screen, so "despeja esa palmera" gets
      // a ring round the actual palm instead of a dim over the whole island.
      project: (x, z) => island()?.project(x, z) ?? null,
      onDone: () => {
        tutorial = null;
        // No game under a capture — the island made its own — so the flag has
        // nowhere to go and nothing to be remembered for.
        if (!live) return;
        live.dispatch((state) => setFlag(state, 'tutorialDone'));
        void live.saveNow();
      },
    });
  }

  /* --- ajustes ----------------------------------------------------------- */

  async function openSettings(): Promise<void> {
    if (settings) return;

    // A returning player tapping Ajustes on the title expects to be able to
    // export the island they already have, so the game is created on demand
    // here rather than only on Continuar. A player with no save gets no game
    // and therefore no export — which is the truth, and the row says so.
    if (!game && (shotMode || (await peekSavedGame()) !== null)) await ensureGame();

    const live = game;
    settings = createSettingsPanel({
      captainName: live?.state().captain.name ?? null,
      onClose: () => closeSettings(),
      onSave: live ? () => live.saveNow() : null,
      onExport: live ? () => live.exportSave() : null,
      // From the title there is no game to import INTO, so the file is written
      // straight to the store and the island is booted from it. That is the
      // recovery path a player with a backup and a wiped phone needs, and it is
      // the reason import is offered from the title at all.
      onImport: live
        ? (file) => live.importSave(file)
        : async (file) => {
            await adoptSave(await importSaveFile(file));
            closeSettings();
            await toIsland();
          },
      onReset: live
        ? async () => {
            await live.reset();
            // Stop the autosave BEFORE dropping the reference, or the fresh
            // island it just made is written back over the save we cleared.
            live.stop();
            game = null;
            closeSettings();
            await toTitle();
          }
        : null,
    });
    overlayRoot.append(settings.el);
  }

  function closeSettings(): void {
    settings?.dispose();
    settings = null;
  }

  /* --- la tienda y la clasificación (PRODUCTION.md §5) -------------------- */

  /**
   * Both overlays need a live game — the store credits ITS gems, the board
   * ranks ITS island — so each ensures one exists. On the island there always
   * is one; under a capture this is the same on-demand creation Ajustes uses,
   * with the frozen clock, so the panels photograph deterministically.
   */
  async function openStore(): Promise<void> {
    if (store) return;
    const live = await ensureGame();
    // Cached after the HUD's own bake, so this is free on the island; it only
    // actually renders when a capture opens the store before any HUD exists.
    const icons = await bakeIcons(stage.renderer);
    store = createStorePanel({
      gems: () => live.state().gems,
      // The ledger credit (src/sim/gems.ts), dispatched like every action so
      // autosave, onChange and the HUD's gem counter see it the ordinary way.
      // The payment has ALREADY happened behind the panel's ✎ SEAM by the time
      // this runs; saveNow follows immediately because a paid-for credit must
      // not be sitting in memory when the app is backgrounded.
      onBuy: (packId) => {
        const result = live.dispatch((state) => creditPack(state, packId));
        if (result.ok) void live.saveNow();
        return { ok: result.ok, gems: result.gems };
      },
      onClose: () => closeStore(),
      gemIcon: icons.gema,
    });
    overlayRoot.append(store.el);
  }

  function closeStore(): void {
    store?.dispose();
    store = null;
  }

  async function openBoard(): Promise<void> {
    if (board) return;
    const live = await ensureGame();
    // Through the ✎ SEAM (src/ui/panels/leaderboard.ts), which is async and
    // fallible like the real fetch it stands in for: a rejection renders the
    // panel's offline face rather than a blank sheet or a dead tap.
    const now = live.now();
    const data = await fetchStandings(live.state(), now).catch(() => null);
    board = createLeaderboardPanel({
      standings: data,
      now,
      onClose: () => closeBoard(),
    });
    overlayRoot.append(board.el);
  }

  function closeBoard(): void {
    board?.dispose();
    board = null;
  }

  /**
   * ✎ SEAM — the island HUD's two meta doors, caught the same way Ajustes is
   * (see watchNavSettings above, which documents why: the HUD's routes land in
   * islandScene, and both of those files belong to other builders' rounds).
   * The gem pill's `+` has carried aria-label "Gemas" since the HUD was built,
   * and the rank cell carries "Clasificación" (hud.ts); this listens for those
   * taps and opens the panels before the HUD's own handler toasts "soon". The
   * moment islandScene grows onOpenStore/onOpenLeaderboard options this goes,
   * and the flow does not change.
   */
  function watchNavMeta(): void {
    if (metaWatchInstalled) return;
    metaWatchInstalled = true;
    document.addEventListener(
      'click',
      (event) => {
        if (currentName !== 'island' || settings || store || board) return;
        const target = event.target as HTMLElement | null;
        const hit = target?.closest?.('[aria-label="Gemas"], [aria-label="Clasificación"]');
        if (!hit) return;
        event.stopPropagation();
        event.preventDefault();
        nav(hit.getAttribute('aria-label') === 'Gemas' ? openStore : openBoard);
      },
      { capture: true }
    );
  }
  let metaWatchInstalled = false;

  /**
   * ✎ SEAM — the island HUD's Ajustes slot, until it has a route of its own.
   *
   * LAYOUT_SPEC §1 gives the nav bar five slots and the fifth is Ajustes.
   * `hud.ts` turns it into `onOpen('Ajustes')` and `islandScene.ts` routes
   * every unknown destination to a "soon" toast — and both of those files
   * belong to other builders this round, so the router cannot reach in and add
   * a case.
   *
   * What it CAN do is listen for the tap itself. The nav slot is a real button
   * with a stable accessible name, so this catches it in the capture phase and
   * stops it before the HUD's own handler turns it into a toast.
   *
   * The moment islandScene grows an `onSettings` option this goes, and the flow
   * does not change with it.
   */
  function watchNavSettings(): void {
    // Installed once and left: the listener no-ops unless the island is the
    // current screen, which is cheaper and safer than adding and removing it
    // around every transition.
    if (navWatchInstalled) return;
    navWatchInstalled = true;
    document.addEventListener(
      'click',
      (event) => {
        if (currentName !== 'island' || settings) return;
        const target = event.target as HTMLElement | null;
        if (!target?.closest?.('button[aria-label="Ajustes"]')) return;
        event.stopPropagation();
        event.preventDefault();
        nav(openSettings);
      },
      { capture: true }
    );
  }
  let navWatchInstalled = false;

  /* --- where we came in -------------------------------------------------- */

  // An explicit `?screen=`/`?scene=` wins; `?save=` names an island and
  // therefore skips the menu (it is what roundtrip.mjs and every island capture
  // use); otherwise a player always lands on the title, whether or not they
  // have an island waiting.
  if (requested === 'settings') {
    // Ajustes is an overlay rather than a screen, so it boots OVER the title.
    // Under a capture the game is made first, so the panel photographs with its
    // rows live instead of with every one of them correctly disabled.
    if (shotMode) await ensureGame();
    await toTitle({ settings: true });
  } else if (requested === 'store' || requested === 'leaderboard') {
    // The Tienda and the Clasificación are overlays too, but they are island
    // doors, so they boot OVER the island — same pattern, other end of it.
    await toIsland({ panel: requested });
  } else if (isScreen(requested)) {
    if (requested === 'title') await toTitle();
    else if (requested === 'captain') await toCaptain();
    else if (requested === 'sea') await toSea();
    else await toIsland();
  } else if (saveParam) await toIsland();
  else await toTitle();
}

/* --------------------------------------------------------------------------
 * shot mode
 * ----------------------------------------------------------------------- */

/**
 * Advance to a fixed point in time, in even steps, and stop.
 *
 * That is what makes a capture byte-identical between runs: animated models and
 * the water land in exactly the same pose every time, and no frame follows
 * unless the harness asks for one through `__step`.
 */
async function freeze(stage: Stage, live: () => Frameable | null, screen: Frameable): Promise<void> {
  const step = 1 / 30;
  for (let t = 0; t < shotTime; t += step) screen.update(step, t);
  screen.update(0, shotTime);

  // A scene that streams its contents in — the sea builds each reef and each
  // enemy as the ship reaches it — has nothing loaded at this point, because
  // the loop above ran synchronously and never yielded to a loader. Without
  // this the open sea photographs as empty water, which is exactly what it
  // did the first three times.
  if (screen.settle) {
    await screen.settle();
    screen.update(0, shotTime);
  }

  await installSizeGuard(stage);

  stage.render();

  /**
   * Shot mode renders twice and stops, which is what makes a capture
   * byte-identical between runs. That also means anything a harness DOES to
   * the page after boot — opening §3.15's picker, dropping a ghost on a cell
   * — is never drawn, because no frame follows the tap.
   *
   * `__step` is the way back in: it advances the scene at the SAME frozen
   * `shotTime`, so the world clock does not move and the capture stays
   * deterministic, while giving the interaction a frame to appear in.
   *
   * It reads the router's CURRENT screen rather than closing over this one, so
   * an act that navigates (title → captain) keeps a working step.
   */
  window.__step = (frames = 1) => {
    for (let i = 0; i < frames; i++) {
      live()?.update(1 / 30, shotTime);
      stage.render();
    }
  };

  window.__camera = () => stage.camera.position.toArray() as [number, number, number];

  // Two frames: the first can land before textures finish uploading.
  requestAnimationFrame(() => {
    stage.render();
    window.__ready = true;
  });
}

/**
 * Animation clips can drive the transform of the node a model was normalized
 * against, so a model that measured correctly at load can be a different size
 * by the time it is drawn. Report the biggest thing actually on screen, and
 * expose the per-model check the harness re-runs after an interaction.
 */
async function installSizeGuard(stage: Stage): Promise<void> {
  const THREE_ = await import('three');
  let worst = { name: '', span: 0 };
  for (const child of stage.scene.children) {
    if (child.name === 'water') continue;
    const size = new THREE_.Box3().setFromObject(child).getSize(new THREE_.Vector3());
    const span = Math.max(size.x, size.y, size.z);
    if (Number.isFinite(span) && span > worst.span) worst = { name: child.name || child.type, span };
  }
  console.log(`[frame] largest non-water object at capture: ${worst.name} span ${worst.span.toFixed(1)}`);

  // Every model that has been normalized states the size it is meant to be:
  // a placed building carries the footprint it was built for, and anything
  // through instantiate({fit}) carries the width it asked fitToFootprint
  // for. This compares that promise against what is actually drawn, and
  // fails the capture in EITHER direction.
  //
  // Too large has come back four times, most recently when the upgrade
  // celebration reset the scale it was animating to 1 and restored the
  // Ayuntamiento's native 126 units.
  //
  // Too small had nothing watching it at all, which is how the avatar
  // bodies reached the captain screen drawing at 0.58 units against a
  // target of 10. Note what that failure needed to be caught: a plain
  // Box3 reported those bodies at a perfect 10 the whole time, because it
  // never asks the bones where the vertices went. measureRendered does —
  // a guard built on the cheap box would have missed it again.
  //
  // The band is deliberately wide. A clip legitimately moves a model's
  // extent around: the widest sample in the library draws 2.2x its fitted
  // width (an anglerfish mid-lunge) and the narrowest 0.57x (a dancing
  // body), so 3x either way flags real breakage and nothing else.
  //
  // Checked per model rather than against the whole scene: the terrain,
  // the water and the single InstancedMesh holding every decoration all
  // legitimately span the island.
  //
  // Exposed rather than run once, because the failure it exists to catch
  // arrived through an INTERACTION — the harness re-runs it after each act.
  window.__checkSizes = () => {
    const bad: string[] = [];
    const size = new THREE_.Vector3();
    stage.scene.traverse((node) => {
      const target =
        (node.userData?.footprint as number | undefined) ??
        (node.userData?.fitTarget as number | undefined);
      if (!target) return;
      measureRendered(node).getSize(size);
      const span = Math.max(size.x, size.z);
      // An empty box means the model has not loaded into this node yet.
      if (!Number.isFinite(span) || span === 0) return;
      if (span > target * 3) {
        bad.push(`${node.name || node.type} draws ${span.toFixed(2)} across, over 3x its target of ${target}`);
      } else if (span < target / 3) {
        bad.push(`${node.name || node.type} draws ${span.toFixed(2)} across, under a third of its target of ${target}`);
      }
    });
    window.__oversized = bad.length ? bad.join('; ') : undefined;
    if (bad.length) console.error(`[frame] BAD SIZE: ${window.__oversized}`);
    return window.__oversized;
  };
  window.__checkSizes();
}

/* --------------------------------------------------------------------------
 * the development scenes — a model viewer and a measuring rig
 * ----------------------------------------------------------------------- */

async function showDevScene(stage: Stage, which: 'model' | 'measure'): Promise<void> {
  let scene: Frameable;
  if (which === 'model') {
    const { createModelScene } = await import('./scenes/modelScene');
    const ids = (params.get('id') ?? 'ship_skiff').split(',').filter(Boolean);
    scene = await createModelScene(stage, ids, params.get('clip') ?? undefined);
  } else {
    const { createMeasureScene } = await import('./scenes/measureScene');
    scene = await createMeasureScene(
      stage,
      params.get('id') ?? 'ship_skiff',
      Number(params.get('extent') ?? 4000),
      (params.get('axis') as 'front' | 'top') ?? 'front',
      params.get('fit') ? Number(params.get('fit')) : undefined,
      params.get('clip') ?? undefined
    );
  }

  if (shotMode) {
    await freeze(stage, () => scene, scene);
    return;
  }

  let last = performance.now();
  let elapsed = 0;
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    elapsed += dt;
    scene.update(dt, elapsed);
    stage.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__ready = true;
}

boot().catch((err) => {
  window.__error = String(err?.stack || err);
  console.error(err);
});
