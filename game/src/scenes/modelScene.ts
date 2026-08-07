import * as THREE from 'three';
import { Stage } from '../render/stage';
import { instantiate, measureRendered, loadManifest } from '../render/assets';

/**
 * Asset QA scene: renders one model (or a contact sheet of several) at a known
 * size on a neutral ground. Used to check that a model normalizes correctly and
 * that its animation clips actually play, without the rest of the game in the way.
 *
 *   ?scene=model&id=bldg_foundry
 *   ?scene=model&id=ship_skiff,ship_sloop,mob_squid
 */
export async function createModelScene(stage: Stage, ids: string[], clip?: string) {
  const mixers: THREE.AnimationMixer[] = [];
  stage.scene.background = new THREE.Color('#5b7a8c');

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: 0x8a9aa5 })
  );
  ground.rotateX(-Math.PI / 2);
  ground.receiveShadow = true;
  stage.scene.add(ground);

  const manifest = await loadManifest().catch((e) => {
    console.log('[model] MANIFEST LOAD FAILED: ' + e);
    return {} as Record<string, { size?: number[] }>;
  });
  console.log(`[model] manifest entries: ${Object.keys(manifest).length}`);

  const cols = Math.ceil(Math.sqrt(ids.length));
  const spacing = 14;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const probe = await instantiate(id);
    const beforeSize = measureRendered(probe.object).getSize(new THREE.Vector3());
    const beforeNaive = new THREE.Box3().setFromObject(probe.object).getSize(new THREE.Vector3());

    if (new URLSearchParams(location.search).get('dump') === '1') {
      probe.object.updateWorldMatrix(true, true);
      const ws = new THREE.Vector3();
      probe.object.traverse((n) => {
        const depth = (() => { let d = 0, p: THREE.Object3D | null = n; while (p && p !== probe.object) { d++; p = p.parent; } return d; })();
        n.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), ws);
        const isSkinned = (n as THREE.SkinnedMesh).isSkinnedMesh ? ' SKINNED' : '';
        const isMesh = (n as THREE.Mesh).isMesh ? ' MESH' : '';
        console.log(`[dump] ${'  '.repeat(depth)}${n.type}:${n.name || '-'} localScale=${n.scale.x.toFixed(3)} worldScale=${ws.x.toFixed(3)}${isMesh}${isSkinned}`);
      });
    }
    const inst = await instantiate(id, { fit: 10, clip });
    const afterSize = measureRendered(inst.object).getSize(new THREE.Vector3());

    console.log(
      `[model] ${id} native ${beforeSize.x.toFixed(1)}x${beforeSize.y.toFixed(1)}x${beforeSize.z.toFixed(1)}` +
      ` (naive ${beforeNaive.x.toFixed(1)})` +
      ` -> fitted ${afterSize.x.toFixed(1)}x${afterSize.y.toFixed(1)}x${afterSize.z.toFixed(1)}` +
      ` scale ${inst.object.scale.x.toFixed(5)} manifestSize=${manifest[id]?.size?.[0] ?? 'MISSING'}`
    );

    const col = i % cols;
    const row = Math.floor(i / cols);
    inst.object.position.x += (col - (cols - 1) / 2) * spacing;
    inst.object.position.z += (row - (Math.ceil(ids.length / cols) - 1) / 2) * spacing;
    stage.scene.add(inst.object);
    if (inst.mixer) mixers.push(inst.mixer);
  }

  const span = Math.max(cols * spacing, 18);
  stage.camera.position.set(span * 0.75, span * 0.7, span * 0.95);
  stage.camera.lookAt(0, 4, 0);
  stage.sun.target.position.set(0, 0, 0);
  stage.sun.target.updateMatrixWorld();

  return {
    update(dt: number) {
      for (const m of mixers) m.update(dt);
    },
  };
}
