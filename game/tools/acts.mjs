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

/** Opens §3.15's build picker from the Construir tile in the thumb zone. */
async function openPicker(page) {
  await (await need(page, 'button[aria-label="Construir"]', 'the Construir tile')).click();
  await need(page, '.sheet.is-open .pick-row', 'the picker list');
  await step(page);
}

/**
 * Finishes the Ayuntamiento with gems, so the picker has something to offer.
 *
 * §4.10's island sits at Ayuntamiento 1 already owning one of every building
 * the hall allows, so nothing is placeable until it reaches Nv2 — which is the
 * design, and which makes this the only honest way to reach build mode from a
 * cold boot without waiting eight minutes. It is also the beat sheet paying
 * for itself: the five starting gems are exactly the price of the 8m 12s left
 * on the hall, and every step below is a real tap.
 */
async function raiseTownHall(page) {
  await (await need(page, '.world-item .timerbar', 'a running timer bar')).click();
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

export const ACTS = {
  /** §3.15 — the picker, open, with its costs and its greyed reasons. */
  async picker(page) {
    await openPicker(page);
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
    // `force` because the ✓ is bobbing — §5.6 lets a claimable thing keep
    // asking, and Playwright's stability check would wait for it forever.
    await (await need(page, '.ok-bubble', 'the inauguration ✓ bubble')).click({ force: true });
    // Caught mid-flight on purpose — §5.4's arc is the thing being reviewed.
    await page.waitForTimeout(150);
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
    const box = await page.locator('.world-item .timerbar').first().boundingBox();
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
   * builder on it. `.sheet__price` only exists on the idle face, so it is the
   * signal that the right building was hit rather than the timer face again.
   */
  async upgrade(page) {
    const canvas = await page.locator('#scene').boundingBox();
    const cx = canvas.x + canvas.width / 2;
    const cy = canvas.y + canvas.height / 2;

    for (let i = 0; i < 40; i++) {
      const dx = ((i % 8) - 3.5) * (canvas.width / 9);
      const dy = (Math.floor(i / 8) - 1.5) * (canvas.height / 9);
      await page.mouse.click(cx + dx, cy + dy);
      await page.waitForTimeout(90);
      if (await page.locator('.sheet.is-open .sheet__price').count()) {
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
};
