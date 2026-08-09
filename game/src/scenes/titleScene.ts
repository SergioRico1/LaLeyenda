import * as THREE from 'three';
import { Stage } from '../render/stage';
import { Water } from '../render/water';
import { createTitlePanel, type TitlePanel } from '../ui/panels/title';

/**
 * titleScene.ts — the main menu, standing on real water.
 *
 * PRODUCTION.md §1 asks for "an animated sea behind it rather than a static
 * plate — we already have the water and it is the best thing we own", and that
 * is the whole reason the title is a SCENE at all rather than a panel the
 * router mounts on its own: it owns something on the stage, so it has to be
 * disposed like the island and the sea are.
 *
 * ✎ SEAM. The backdrop is one Water plane and a parked camera. What the next
 * builder gets for free is the disposal contract and a live surface to compose
 * against; what they will want to add — a skiff standing off the shore, the
 * island itself on the horizon, a slow camera drift — all goes in `update`.
 */

export interface TitleScene {
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

export interface TitleSceneOptions {
  returning: boolean;
  captainName?: string | null;
  onPlay(): void;
  onSettings(): void;
}

/**
 * Open water and nothing else, for a screen that is mostly menu.
 *
 * Shared with the captain screen, which needs the same thing for the same
 * reason — a creation screen floating on a flat colour reads as a form. It
 * lives here rather than in a fourth module because it is twenty lines and one
 * of the two callers owns it; the day a third screen wants it, it moves to
 * render/.
 */
export interface SeaBackdrop {
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

export function createSeaBackdrop(stage: Stage, opts: { look?: 'wide' | 'near' } = {}): SeaBackdrop {
  // Everything this puts on the stage comes off again on dispose, and the only
  // reliable way to know what that is, is to remember what was already there.
  const preexisting = new Set(stage.scene.children);

  // The open-sea settings, matched to seaScene so the menu and the voyage are
  // recognisably the same ocean: no shore SDF (there is no island to break
  // against), crest foam rather than surf, and a swell with real height.
  const water = new Water({
    size: 620, palette: 'ocean', glitter: 0.42, caps: 0.5, lane: 0, reef: 1,
    wave: 0.95, waveStep: 0.95 / 4,
  });
  stage.scene.add(water.mesh);

  // The same fog and the same horizon colour the voyage uses, so the sky meets
  // the water at the same seam rather than at a hard line.
  const priorFog = stage.scene.fog;
  stage.scene.fog = new THREE.Fog(0x6fbcd6, 150, 340);

  // Low and level, unlike the island's three-quarter view: this camera is
  // composing a HORIZON, and it wants the sky the wordmark sits against.
  const near = opts.look === 'near';
  const at = new THREE.Vector3(0, 0, near ? -34 : -60);
  stage.camera.position.set(0, near ? 9 : 12, near ? 26 : 34);
  stage.camera.lookAt(at);
  stage.aimSun(new THREE.Vector3(0, 0, 0));

  return {
    update(_dt, elapsed) {
      water.update(elapsed, stage.camera);
    },
    dispose() {
      water.dispose();
      stage.scene.fog = priorFog;
      for (const child of [...stage.scene.children]) {
        if (preexisting.has(child)) continue;
        stage.scene.remove(child);
      }
    },
  };
}

export async function createTitleScene(stage: Stage, opts: TitleSceneOptions): Promise<TitleScene> {
  const backdrop = createSeaBackdrop(stage);

  const uiRoot = document.getElementById('ui');
  let panel: TitlePanel | null = null;
  if (uiRoot) {
    panel = createTitlePanel({
      returning: opts.returning,
      captainName: opts.captainName,
      onPlay: opts.onPlay,
      onSettings: opts.onSettings,
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
