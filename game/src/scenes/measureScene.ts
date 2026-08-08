import * as THREE from 'three';
import { Stage } from '../render/stage';
import { instantiate, loadManifest } from '../render/assets';

/**
 * Renders one model as a flat white silhouette on black, under an orthographic
 * camera covering a known world extent. tools/calibrate.mjs reads the silhouette
 * out of the resulting pixels to get the model's true rendered size.
 *
 * Why measure from pixels at all: these models disagree with every analytical
 * method. three.js reports the pre-armature extent for skinned meshes, and
 * reading the file's node transforms double-counts the armature scale on models
 * where the skinned node's own transform is also applied (glTF says to ignore
 * it, three.js does not). The foundry lands 23x off one way or 23x off the other.
 * Rendering is the only description of the model both agree to obey.
 *
 *   ?scene=measure&id=bldg_foundry&extent=4000&axis=front
 */
export async function createMeasureScene(
  stage: Stage,
  id: string,
  extent: number,
  axis: 'front' | 'top',
  /** When set, the model is normalized to this footprint before measuring, so
   *  the shot verifies what the game will actually draw rather than the raw
   *  asset. Leave unset for pipeline calibration. */
  fit?: number,
  clip?: string
) {
  stage.scene.background = new THREE.Color(0x000000);
  // Silhouette only: unlit white so any covered pixel is unambiguous.
  stage.scene.remove(stage.sun);

  // The clip must be honoured whether or not a fit was asked for: calibration
  // measures each clip at scale 1, and these clips move parts far enough apart
  // to change the model's extent several times over.
  const inst = await instantiate(id, { ...(fit !== undefined ? { fit } : {}), ...(clip ? { clip } : {}) });
  inst.object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
    }
  });
  stage.scene.add(inst.object);

  // Orthographic so pixel distance maps linearly to world distance.
  const aspect = stage.camera.aspect;
  const half = extent / 2;
  const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, -extent * 4, extent * 4);
  if (axis === 'top') {
    cam.position.set(0, extent, 0);
    cam.up.set(0, 0, -1);
  } else {
    cam.position.set(0, 0, extent);
  }
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();

  // Stage.render() uses stage.camera, so swap the projection in place.
  Object.assign(stage.camera, {
    isOrthographicCamera: true,
    projectionMatrix: cam.projectionMatrix,
    projectionMatrixInverse: cam.projectionMatrixInverse,
  });
  stage.camera.position.copy(cam.position);
  stage.camera.up.copy(cam.up);
  stage.camera.lookAt(0, 0, 0);
  stage.camera.updateMatrixWorld(true);

  const dims = (await loadManifest())[id];
  console.log(
    `[measure] id=${id} extent=${extent} axis=${axis} fit=${fit ?? 'none'}` +
    ` appliedScale=${inst.object.scale.x.toFixed(5)}` +
    ` manifestSize=${dims?.size ? dims.size.map((v) => v.toFixed(1)).join('x') : 'MISSING'}`
  );

  return {
    update(dt: number) {
      inst.mixer?.update(dt);
    },
  };
}
