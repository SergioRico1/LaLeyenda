import { Stage } from './render/stage';
import { createIslandScene } from './scenes/islandScene';

/** Entry point. `?scene=` picks the scene, `?shot=1` freezes time and reports
 *  readiness so the screenshot harness can capture a deterministic frame. */

declare global {
  interface Window {
    __ready?: boolean;
    __error?: string;
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
    }

    stage.render();
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
