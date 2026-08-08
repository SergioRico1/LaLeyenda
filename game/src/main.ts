import { Stage } from './render/stage';
import { measureRendered } from './render/assets';
import { createIslandScene } from './scenes/islandScene';
import { createGame, type Game } from './core/game';
import { landCargoInPlace } from './sim';

/** Entry point. `?scene=` picks the scene, `?shot=1` freezes time and reports
 *  readiness so the screenshot harness can capture a deterministic frame. */

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
  }
}

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') ?? 'island';
const shotMode = params.get('shot') === '1';
const shotTime = Number(params.get('t') ?? '2.0'); // simulated seconds for the frame
const seed = params.get('seed') ?? 'la-leyenda';

const canvas = document.getElementById('scene') as HTMLCanvasElement;

async function boot() {
  const stage = new Stage({
    canvas,
    fixedSize: shotMode
      ? { width: Number(params.get('w') ?? 1280), height: Number(params.get('h') ?? 720) }
      : null,
  });

  // Outside shot mode the island and the sea take turns on the same stage, and
  // runGame owns the handover. It has to be decided BEFORE the switch below:
  // building a scene here and then letting the router build another one gives
  // the player two islands, two HUDs and two update loops on one camera.
  //
  // In shot mode there is exactly one scene and no switching, so captures
  // behave exactly as they always have.
  if (!shotMode && (sceneName === 'island' || sceneName === 'sea')) {
    return runGame(stage, sceneName);
  }

  let scene;
  switch (sceneName) {
    case 'model': {
      const { createModelScene } = await import('./scenes/modelScene');
      const ids = (params.get('id') ?? 'ship_skiff').split(',').filter(Boolean);
      scene = await createModelScene(stage, ids, params.get('clip') ?? undefined);
      break;
    }
    case 'measure': {
      const { createMeasureScene } = await import('./scenes/measureScene');
      scene = await createMeasureScene(
        stage,
        params.get('id') ?? 'ship_skiff',
        Number(params.get('extent') ?? 4000),
        (params.get('axis') as 'front' | 'top') ?? 'front',
        params.get('fit') ? Number(params.get('fit')) : undefined,
        params.get('clip') ?? undefined
      );
      break;
    }
    case 'sea': {
      const { createSeaScene } = await import('./scenes/seaScene');
      scene = await createSeaScene(stage, { seed });
      break;
    }
    case 'island':
    default:
      scene = await createIslandScene(stage, seed);
      break;
  }

  if (shotMode) {
    // Advance the world to a fixed point in time in even steps, so animated
    // models and the water land in exactly the same pose on every capture.
    const step = 1 / 30;
    for (let t = 0; t < shotTime; t += step) scene.update(step, t);
    scene.update(0, shotTime);

    // A scene that streams its contents in — the sea builds each reef and each
    // enemy as the ship reaches it — has nothing loaded at this point, because
    // the loop above ran synchronously and never yielded to a loader. Without
    // this the open sea photographs as empty water, which is exactly what it
    // did the first three times.
    if ('settle' in scene && typeof scene.settle === 'function') {
      await scene.settle();
      scene.update(0, shotTime);
    }

    // Animation clips can drive the transform of the node a model was normalized
    // against, so a model that measured correctly at load can be a different size
    // by the time it is drawn. Report the biggest thing actually on screen.
    {
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
     */
    window.__step = (frames = 1) => {
      for (let i = 0; i < frames; i++) {
        scene.update(1 / 30, shotTime);
        stage.render();
      }
    };

    window.__camera = () => stage.camera.position.toArray() as [number, number, number];

    // Two frames: the first can land before textures finish uploading.
    requestAnimationFrame(() => {
      stage.render();
      window.__ready = true;
    });
    return;
  }

  let last = performance.now();
  let elapsed = 0;
  const frame = (now: number) => {
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


/**
 * The island and the sea, taking turns.
 *
 * The GAME is created here rather than inside a scene, and that is the whole
 * point: a voyage that restarted the island's economy every time the player
 * sailed would lose the timers running while they were away, and cargo would
 * have nowhere to land. Scenes are views of a simulation that outlives them.
 *
 * Each switch disposes the outgoing scene before building the incoming one, so
 * two scenes never share the stage — the alternative is two update loops
 * fighting over the same camera, which reads as the game having a seizure.
 */
async function runGame(stage: Stage, start: 'island' | 'sea'): Promise<void> {
  const game: Game = await createGame({
    seed,
    start: params.get('save') === 'demo' ? 'demo' : params.get('save') === 'new' ? 'new' : 'stored',
  });

  let current: { update(dt: number, elapsed: number): void; dispose(): void } | null = null;
  let elapsed = 0;

  async function toIsland(): Promise<void> {
    current?.dispose();
    current = await createIslandScene(stage, seed, { game, onSail: () => void toSea() });
  }

  async function toSea(): Promise<void> {
    current?.dispose();
    const { createSeaScene } = await import('./scenes/seaScene');
    current = await createSeaScene(stage, {
      seed,
      onEnd: (voyage) => {
        // The one place the sea touches the island's economy, and it goes
        // through the sim like every other change: caps apply, and what will
        // not fit is reported rather than silently dropped.
        game.dispatch((state) => {
          const { spilled } = landCargoInPlace(state, voyage.cargo);
          const over = Object.values(spilled).reduce((a, b) => a + (b ?? 0), 0);
          if (over > 0) console.log(`[voyage] ${Math.round(over)} units would not fit in the stores`);
          return { ok: true, state, events: [] };
        });
        void game.saveNow().then(() => toIsland());
      },
    });
  }

  // `?scene=sea` drops straight into a voyage, which is how the sea gets
  // played without building a shipyard first.
  if (start === 'sea') await toSea();
  else await toIsland();

  let last = performance.now();
  const frame = (now: number) => {
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

boot().catch((err) => {
  window.__error = String(err?.stack || err);
  console.error(err);
});
