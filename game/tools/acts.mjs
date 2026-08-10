/**
 * tools/acts.mjs — scripted interactions the screenshot harness can run before
 * it captures.
 *
 *   npm run shoot -- island --mobile --act picker --out shots/picker.png
 *
 * A static frame cannot show a panel, a ghost, or a bottom sheet, so a feature
 * that only exists after a tap is a feature nobody can review. These are real
 * pointer events on real elements — not test hooks — so a broken selector or a
 * dead button fails the shot instead of quietly capturing the island behind it.
 *
 * Every act ends by calling `window.__step()`, which advances the frozen scene
 * by one frame so whatever the tap changed is actually drawn.
 *
 * WHICH ISLAND AN ACT NEEDS, because half of them need one that is not the
 * default and nothing said so. OPENING.md's day-one island is the Ayuntamiento
 * and nothing else — no second building, no timer running, no chest in the
 * tray — so an act that photographs a timer, a reward grid or a finished job
 * has to be pointed at the mid-game fixture. Round 9's gate ran all nineteen
 * and these are the invocations that reach the feature:
 *
 *   island (default)  picker · pickerOpen · place · placed · blocked · refused
 *                     · upgrade · pan · pinch
 *   island --save demo            working · chest · finished · inaugurate
 *   island --tutorial 1           teach
 *   island --t 35 --motion 1      guide   (§3.4's tooltip is suppressed under a
 *                                          deterministic capture on purpose —
 *                                          see CAPTURE in src/ui/env.ts — and it
 *                                          is a THIRTY-SECOND idle timer, so a
 *                                          two-second capture can never see it)
 *   title                         create · settings
 *   captain                       surprise
 *   sea                           fight
 */

const step = (page, frames = 2) => page.evaluate((n) => window.__step?.(n), frames);

/** Waits for a selector and fails loudly with the act's name if it never comes. */
async function need(page, selector, what) {
  try {
    await page.waitForSelector(selector, { timeout: 4000, state: 'visible' });
  } catch {
    throw new Error(`act: ${what} — nothing matched ${selector}`);
  }
  return page.locator(selector).first();
}

/** Opens §3.15's build picker from the nav bar's Isla slot (LAYOUT_SPEC §1:
 *  slot 1 is the island, and on this island the thing you do is build). */
async function openPicker(page) {
  await (await need(page, 'button[aria-label="Isla"]', 'the Isla nav slot')).click();
  await need(page, '.sheet.is-open .pick-row', 'the picker list');
  await step(page);
}

/**
 * Finishes a running Ayuntamiento upgrade with gems, IF one is running.
 *
 * It used to insist on one, and the insistence is what broke twelve of these
 * acts. The premise was §4.10's old opening: an island that booted at
 * Ayuntamiento 1 already owning one of every building the hall allows, with
 * 8m 12s left on a hall upgrade the five starting gems exactly paid for — so
 * nothing was placeable until the hall reached Nv2, and finishing it was the
 * only way to reach build mode from a cold boot.
 *
 * OPENING.md replaced that island. A player now starts with the Ayuntamiento
 * and NOTHING else, no timer running anywhere, and hall Nv1 already unlocks
 * five buildings — so there is nothing to raise and nothing to wait for. On
 * that island this is correctly a no-op, and the acts that follow it go
 * straight to the picker. Left as a hard requirement it failed on a selector
 * (`.world-item .timerbar`) that describes a world that no longer exists, and
 * took `pickerOpen`, `place`, `placed`, `blocked`, `refused` and the rest with
 * it — every one of them reporting a missing timer bar rather than the missing
 * feature they were written to photograph.
 */
async function raiseTownHall(page) {
  const bar = page.locator('.world-item .timerbar');
  if (!(await bar.count())) return;
  await bar.first().click();
  const cta = await need(page, '.sheet.is-open .sheet__cta', 'the finish-now CTA');
  await cta.click();
  await page.waitForTimeout(900);   // the Nv2 model loads and swaps in
  await step(page, 3);
}

/**
 * Picks a takeable row and enters placement.
 *
 * `prefer` names a building so a shot can choose one whose silhouette differs
 * from whatever it will be dropped on top of — an Aserradero ghost sitting on
 * an Aserradero is impossible to read in a screenshot.
 */
async function enterPlacement(page, prefer) {
  await openPicker(page);
  const open = page.locator('.pick-row:not(.is-blocked)');
  if ((await open.count()) === 0) throw new Error('act: every row in the picker is blocked');
  let row = open.first();
  if (prefer) {
    const named = open.filter({ has: page.locator(`.pick-row__name:text-is("${prefer}")`) });
    if (await named.count()) row = named.first();
  }
  await row.click();
  await need(page, '.buildbar', 'the build bar');
  // The ghost model is fetched on pick; give it a beat, then a few frames so
  // the translucent model and the green cells are actually on the canvas.
  await page.waitForTimeout(700);
  await step(page, 4);
}

/**
 * Sweeps the island until the ghost lands somewhere the ✓ will accept.
 *
 * Sweeping rather than aiming is the point: the green/red cells and the bar's
 * refusal line are the only things saying whether a spot is legal, so a script
 * that reads them is exercising exactly the feedback a thumb relies on.
 */
async function dropGhostSomewhereValid(page) {
  const canvas = await page.locator('#scene').boundingBox();
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height * 0.42;

  for (let i = 0; i < 48; i++) {
    const dx = ((i % 8) - 3.5) * (canvas.width / 10);
    const dy = (Math.floor(i / 8) - 2.5) * (canvas.height / 14);
    const x = cx + dx;
    const y = cy + dy;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 1, y + 1);
    await page.mouse.up();
    await step(page, 2);
    const blocked = await page.locator('.buildbar__ok').evaluate((n) => n.classList.contains('is-blocked'));
    if (!blocked) return { x, y };
  }
  throw new Error('act: swept the island and every cell refused the ghost');
}

/** Where the camera is right now, as a vector we can subtract. */
const cameraAt = (page) => page.evaluate(() => window.__camera?.() ?? [0, 0, 0]);
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Waits for the router to land on a screen.
 *
 * `window.__screen` is set by main.ts on every transition, so an act can wait
 * for the destination instead of sleeping and hoping. It is checked BEFORE the
 * selector because a screen builds its DOM after it is current, and a selector
 * that never comes should blame the navigation rather than the markup.
 */
async function reachedScreen(page, name, selector, what) {
  try {
    await page.waitForFunction((n) => window.__screen === n, name, { timeout: 15000 });
  } catch {
    const on = await page.evaluate(() => window.__screen ?? 'nothing');
    throw new Error(`act: ${what} — the router never reached ${name}; it is on ${on}`);
  }
  await need(page, selector, what);
  await step(page, 2);
}

export const ACTS = {
  /* --- the first run (PRODUCTION.md §1) ---------------------------------- */

  /**
   * Title → captain, through the real button.
   *
   *   npm run shoot -- title --mobile --act create
   *
   * This is the act that proves the seam: a fresh player taps Jugar and the
   * router disposes the title, builds creation and photographs it. If the two
   * screens ever end up on the stage together, this is where it shows.
   */
  async create(page) {
    await (await need(page, 'button[aria-label="Jugar"]', 'the Jugar button')).click();
    await reachedScreen(page, 'captain', '.captain__sheet', 'create');
  },

  /** Creation, re-rolled — "sorpréndeme" driving the sim's own roll. */
  async surprise(page) {
    await (await need(page, 'button[aria-label="Sorpréndeme"]', 'the Sorpréndeme button')).click();
    await step(page, 2);
  },

  /** Ajustes, opened from the title the way a player opens it. */
  async settings(page) {
    await (await need(page, 'button[aria-label="Ajustes"]', 'the Ajustes button')).click();
    // `.settings__sheet` is the panel. It was written as `.settings__panel`,
    // which has never existed in src/ui/panels/settings.ts — so this act failed
    // on every run since it was added, and failed by NOT writing its shot, which
    // is a way of failing that a green-looking log can hide.
    await need(page, '.settings__sheet', 'the Ajustes panel');
    await step(page, 2);
  },

  /**
   * The tutorial card over the island.
   *
   *   npm run shoot -- island --mobile --tutorial 1 --act teach
   *
   * The flag is required: a capture suppresses the tutorial by default, because
   * otherwise it would cover the island in every island shot taken from a cold
   * boot — which is every island shot there is.
   */
  async teach(page) {
    if (!(await page.locator('.tut__card').count())) {
      throw new Error('act: teach — no tutorial card. Pass --tutorial 1 (a capture hides it by default).');
    }
    await need(page, '.tut__card', 'the tutorial card');
    await step(page, 2);
  },

  /* --- the island -------------------------------------------------------- */

  /** §3.15 — the picker, open, with its costs and its greyed reasons. */
  async picker(page) {
    await openPicker(page);
  },

  /**
   * Dragging the island around — the thing a phone cannot do without.
   *
   * This shipped broken: there was no camera control at all, and the comment
   * left in its place said the island was "pannable in a later slice". A player
   * found it before any test did, which is the argument for this act existing.
   *
   * Three things have to hold, and only the first is the feature:
   *   - the camera actually moves, by roughly the distance dragged;
   *   - the drag does not also count as a tap, so no sheet opens behind it;
   *   - the ✗ never leaves the island — the focus is clamped, so a fling into
   *     open water still leaves something to look at.
   */
  async pan(page) {
    const canvas = await page.locator('#scene').boundingBox();
    const cx = canvas.x + canvas.width / 2;
    const cy = canvas.y + canvas.height / 2;
    const before = await cameraAt(page);

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // In steps, like a thumb: one jump would clear PAN_SLOP and land in the
    // same place, and would not prove the island tracks the finger on the way.
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(cx - (canvas.width * 0.3 * i) / 12, cy - (canvas.height * 0.12 * i) / 12);
      await step(page, 1);
    }
    // Held still for a beat before letting go, which is how a player parks the
    // view rather than throwing it — and it decays the momentum, so the frame
    // this captures is the frame the drag ended on.
    for (let i = 0; i < 4; i++) await page.mouse.move(cx - canvas.width * 0.3, cy - canvas.height * 0.12);
    await page.mouse.up();
    await step(page, 3);

    const after = await cameraAt(page);
    const moved = apart(before, after);
    if (moved < 1) {
      throw new Error(`act: pan — dragged across the screen and the camera moved ${moved.toFixed(2)} units`);
    }
    if (await page.locator('.sheet.is-open').count()) {
      throw new Error('act: pan — the drag opened a building sheet; a swipe is being read as a tap');
    }
  },

  /**
   * Pinch to zoom, driven as two real touch points through CDP — Playwright's
   * mouse only has one, and a gesture that needs two fingers cannot be faked
   * with one and still exercise the code that reads the gap between them.
   */
  async pinch(page) {
    const canvas = await page.locator('#scene').boundingBox();
    const cx = canvas.x + canvas.width / 2;
    const cy = canvas.y + canvas.height / 2;
    const before = await cameraAt(page);

    const cdp = await page.context().newCDPSession(page);
    const touch = (type, spread) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints:
          type === 'touchEnd'
            ? []
            : [
                { x: cx - spread, y: cy, id: 1 },
                { x: cx + spread, y: cy, id: 2 },
              ],
      });

    await touch('touchStart', 40);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', 40 + i * 14);
      await step(page, 1);
    }
    await touch('touchEnd');
    await step(page, 2);

    const after = await cameraAt(page);
    // Fingers spreading pulls the camera in, so it must end up nearer the
    // island's middle than it started, not merely somewhere else.
    const reach = (v) => Math.hypot(v[0], v[1], v[2]);
    if (reach(after) >= reach(before) - 1) {
      throw new Error(
        `act: pinch — spread two fingers and the camera went from ${reach(before).toFixed(1)} to ${reach(after).toFixed(1)} units out`
      );
    }
  },

  /**
   * §3.11 — the inauguration bubble.
   *
   * Finishing a building used to produce nothing at all: the timer bar was
   * deleted from the DOM and the new model popped in. Now the bar is replaced
   * by a green ✓ that has to be claimed, and this is the act that photographs
   * it. Run with `--motion 1` to see the flash and the dust that land with it.
   */
  async finished(page) {
    await raiseTownHall(page);
    await need(page, '.ok-bubble', 'the inauguration ✓ bubble');
    await step(page, 2);
  },

  /**
   * §3.11 — claiming it: the burst, the dust ring, the XP flying to the
   * capsule, and the level badge popping if it rolled over.
   */
  async inaugurate(page) {
    await raiseTownHall(page);
    await need(page, '.ok-bubble', 'the inauguration ✓ bubble');
    // The world-anchored layer is only positioned by the projection pass, and
    // in shot mode that only runs on __step — without this the ✓ is still at
    // the origin and the tap lands in the corner of the screen.
    await step(page, 2);
    // `force` because the ✓ is bobbing — §5.6 lets a claimable thing keep
    // asking, and Playwright's stability check would wait for it forever.
    await page.locator('.ok-bubble').click({ force: true });
    // Caught mid-flight on purpose — §5.4's arc is the thing being reviewed.
    await page.waitForTimeout(260);
    await step(page, 2);
  },

  /**
   * §3.22B — the reward moment. `--save demo` boots the fixture whose tray has
   * a chest ready, which is the only cold-boot route to a chest that opens.
   */
  async chest(page) {
    await (await need(page, 'button[aria-label="Cofres"]', 'the Cofres tile')).click();
    await need(page, '.reward__grid .reward__tile', 'the reward grid');
    await page.waitForTimeout(1200);   // let the tiles deal, 220ms apart
    await step(page, 2);
  },

  /**
   * §3.5 — a locked CTA names the key instead of dead-tapping. Tapping
   * ¡Zarpar! before the Astillero exists shakes the tile and says why.
   */
  async refused(page) {
    await (await need(page, 'button[aria-label="¡Zarpar!"]', 'the ¡Zarpar! tile')).click();
    await need(page, '.toast', 'the refusal toast');
    await step(page, 2);
  },

  /** §3.4 — the 30s idle-builder tooltip, pointing down at Construir. */
  async guide(page) {
    await page.waitForSelector('.guide-tip', { timeout: 8000, state: 'visible' })
      .catch(() => { throw new Error('act: guide — the idle-builder tooltip never appeared'); });
    await step(page, 2);
  },

  /** §3.15 — the picker once the hall is Nv2 and rows are actually takeable. */
  async pickerOpen(page) {
    await raiseTownHall(page);
    await openPicker(page);
  },

  /** §3.15 — placement: ghost, green/red cells, chevrons, the ✗/✓ pair. */
  async place(page) {
    await raiseTownHall(page);
    await enterPlacement(page);
    await dropGhostSomewhereValid(page);
  },

  /** §3.15 — the confirm actually spending a builder and starting a timer. */
  async placed(page) {
    await raiseTownHall(page);
    await enterPlacement(page);
    await dropGhostSomewhereValid(page);
    await page.locator('.buildbar__ok').click();
    await page.waitForTimeout(900);   // the new model loads and is added
    await step(page, 4);
    if (await page.locator('.buildbar').isVisible()) {
      throw new Error('act: the build bar is still up — the confirm did not take');
    }
  },

  /** §3.15 — the refusal face: a ghost sitting on ground it cannot have. */
  async blocked(page) {
    await raiseTownHall(page);
    await enterPlacement(page, 'Mercado');
    // Straight onto the Aserradero, whose silhouette the Mercado shares nothing
    // with, so the red ghost is unmistakably the ghost.
    // A day-one island has no timer bar to aim beside (OPENING.md), so the
    // locator is COUNTED before it is measured — `boundingBox()` on a locator
    // that matches nothing waits thirty seconds and then throws, which reported
    // this act as broken when all that was missing was the aiming aid.
    const bars = page.locator('.world-item .timerbar');
    const box = (await bars.count()) ? await bars.first().boundingBox() : null;
    const canvas = await page.locator('#scene').boundingBox();
    const x = box ? box.x + box.width / 2 : canvas.x + canvas.width / 2;
    const y = box ? box.y + box.height + 80 : canvas.y + canvas.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 1, y + 1);
    await page.mouse.up();
    await step(page, 3);
  },

  /**
   * §3.16 — the upgrade sheet, reached the way §3.11 says a timer bar behaves:
   * tapping it raises the finish-now decision rather than spending gems.
   */
  async working(page) {
    await (await need(page, '.world-item .timerbar', 'a running timer bar')).click();
    await need(page, '.sheet.is-open .sheet__cta', 'the sheet CTA');
    await step(page);
  },

  /**
   * §3.16 — the IDLE face: level, what the next level gives, cost, green CTA.
   *
   * Taps the island itself, sweeping until it lands on a building with no
   * builder on it. `.sheet__stats` — LAYOUT_SPEC item 5's 2×2 grid — only
   * exists on the idle face of a building that still has a level to go, so it
   * is the signal that the right building was hit rather than the timer face
   * or a maxed one. (It replaced `.sheet__price`, which was the same signal
   * before the cost moved onto the CTA.)
   */
  async upgrade(page) {
    const canvas = await page.locator('#scene').boundingBox();
    const cx = canvas.x + canvas.width / 2;
    const cy = canvas.y + canvas.height / 2;

    // A FINER SWEEP THAN IT USED TO BE, because the island it sweeps changed.
    // At 8 by 5 the steps were 47 by 103 screen pixels on a phone, which was
    // ample when §4.10 put six buildings on the island and hopeless once
    // OPENING.md left one: the Ayuntamiento is about 60 pixels across at this
    // framing, so a 103-pixel row spacing could step straight over the only
    // building there is. 14 by 10 puts the step inside the target.
    for (let i = 0; i < 140; i++) {
      const dx = ((i % 14) - 6.5) * (canvas.width / 17);
      const dy = (Math.floor(i / 14) - 4.5) * (canvas.height / 22);
      await page.mouse.click(cx + dx, cy + dy);
      await page.waitForTimeout(90);
      if (await page.locator('.sheet.is-open .sheet__stats').count()) {
        await step(page);
        return;
      }
      if (await page.locator('.sheet.is-open').count()) {
        await page.locator('.sheet.is-open .sheet__x').first().click();
        await page.waitForTimeout(220);
      }
    }
    throw new Error('act: never hit a building that was not already building');
  },

  /* --- the open sea ------------------------------------------------------ */

  /**
   * A fight, sailed rather than posed.
   *
   *   npm run shoot -- sea --mobile --act fight --at 170,20 --t 8
   *
   * Nothing in the sea moves in a capture unless something steers it: the
   * stick stops listening under `?shot=1` (src/ui/stick.ts) so a scripted
   * pointer cannot fight a real gesture, and a voyage nobody steers sits at the
   * spawn with the throttle shut. So the sea exposes `window.__sail`, which
   * feeds the same screen-direction-to-helm conversion a thumb feeds, and this
   * act holds the helm the way the design asks a player to: close, then turn a
   * beam to the thing and keep it there while the guns come back.
   *
   * `--at` is worth passing. Home water is empty by design — there is nothing
   * to fight within a cell of the harbour — and `--t` sails for that many
   * simulated seconds before the act even starts.
   */
  async fight(page) {
    const helm = await page.evaluate(() => {
      window.__sail?.('hunt');
      return typeof window.__sail === 'function';
    });
    if (!helm) {
      throw new Error('act: fight — no helm to drive (window.__sail). Is this a sea capture?');
    }
    // Real steps at the sim's own rate, so the broadsides, the reload and
    // everything they light up land where they would land in play.
    for (let i = 0; i < 16; i++) await step(page, 5);
  },
};
