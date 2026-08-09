import { Stage } from '../render/stage';
import { createSeaBackdrop, type SeaBackdrop } from './titleScene';
import { createCaptainPanel, type CaptainPanel } from '../ui/panels/captain';
import { createCaptain, type Captain } from '../sim';

/**
 * captainScene.ts — PRODUCTION.md §1's captain creation.
 *
 * A scene rather than a panel for one reason: the avatar is a 3D object, so
 * this screen owns something on the stage and therefore owns a dispose. Today
 * what it owns is the sea behind the panel; tomorrow it is the captain standing
 * on it.
 *
 * ✎ SEAM — where the avatar goes.
 *
 * `panel.stage` is a transparent, already-sized box in the layout. The next
 * builder loads `looksParts(captain.look)` through `render/assets.ts`
 * (`instantiate(id, { fit })` — the id IS the file name), parents them into one
 * group, parks it in front of this camera, and re-parents on `onChange`. The
 * sim side of that is finished and tested: seven slots, 43 ids, `cycleSlot`
 * already produces valid looks and `onChange` already fires on every arrow.
 *
 * It is not stubbed with a placeholder mesh on purpose. `main.ts`'s size guard
 * fails ANY capture where a model draws under a third of the width it was
 * fitted to, and unrigged avatar parts have hit exactly that before (see the
 * note in main.ts about bodies drawing 0.58 against a target of 10). A wrong
 * placeholder would take every other builder's screenshots down with it.
 */

export interface CaptainScene {
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

export interface CaptainSceneOptions {
  /** The island seed this captain is being made for. Fixed here, because the
   *  island is generated from it the moment creation is confirmed. */
  seed: string;
  /** Confirmed. The router builds the game and goes to the island. */
  onConfirm(captain: Captain): void;
  /** Back to the title. */
  onBack?(): void;
}

export async function createCaptainScene(
  stage: Stage,
  opts: CaptainSceneOptions
): Promise<CaptainScene> {
  const backdrop: SeaBackdrop = createSeaBackdrop(stage, { look: 'near' });

  const uiRoot = document.getElementById('ui');
  let panel: CaptainPanel | null = null;
  if (uiRoot) {
    panel = createCaptainPanel({
      // Opening on a rolled captain rather than on an empty form is the whole
      // difference between "fill this in" and "make this yours": a player who
      // taps straight through still leaves with a real pirate, which is what
      // makes the screen skippable without being pointless.
      captain: createCaptain(opts.seed),
      onConfirm: opts.onConfirm,
      onBack: opts.onBack,
    });
    uiRoot.append(panel.el);
  }

  return {
    update(dt, elapsed) {
      backdrop.update(dt, elapsed);
    },
    dispose() {
      panel?.dispose();
      backdrop.dispose();
    },
  };
}
