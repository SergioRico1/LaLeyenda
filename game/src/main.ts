import { Stage } from './render/stage';
import { createIslandScene } from './scenes/islandScene';

/** Entry point. `?scene=` picks the scene, `?shot=1` freezes time and reports
 *  readiness so the screenshot harness can capture a deterministic frame. */

declare global {
  interface Window {
    __ready?: boolean;
    __error?: string;
    /** Shot mode only — see the note where it is assigned. */
    __step?: (frames?: number) => void;
    /** Set when something in the scene is impossibly large; the harness fails
     *  the capture on it. See the OVERSIZED check. */
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

      // A placed building is never more than a few cells across, and each one
      // knows its own footprint. Anything several times that means something
      // wrote over the model's normalization — the failure that has come back
      // four times, most recently when the upgrade celebration reset the scale
      // it was animating to 1 and restored the Ayuntamiento's native 126 units.
      //
      // Checked per building rather than against the whole scene: the terrain,
      // the water and the single InstancedMesh holding every decoration all
      // legitimately span the island.
      //
      // Exposed rather than run once, because the failure it exists to catch
      // arrived through an INTERACTION — the harness re-runs it after each act.
      window.__checkSizes = () => {
        const bad: string[] = [];
        stage.scene.traverse((node) => {
          const footprint = node.userData?.footprint as number | undefined;
          if (!footprint) return;
          const size = new THREE_.Box3().setFromObject(node).getSize(new THREE_.Vector3());
          const span = Math.max(size.x, size.z);
          if (Number.isFinite(span) && span > footprint * 3) {
            bad.push(`${node.name} spans ${span.toFixed(1)} for a footprint of ${footprint}`);
          }
        });
        window.__oversized = bad.length ? bad.join('; ') : undefined;
        if (bad.length) console.error(`[frame] OVERSIZED: ${window.__oversized}`);
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

boot().catch((err) => {
  window.__error = String(err?.stack || err);
  console.error(err);
});
