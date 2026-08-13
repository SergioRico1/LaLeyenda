import * as THREE from 'three';
import { instantiate } from './assets';
import { BALANCE } from '../sim/balance';
import { CELL, STEP, cellToWorld, isBuildable, type IslandShape } from './island';

/**
 * ghost.ts — §3.15's placement preview, in the world.
 *
 *   > Valid footprint: translucent bright-green quad on the ground,
 *   > `--ui-grid-ok`, additively blended, 2px lighter-green edge. Blocked:
 *   > `--ui-grid-bad`.
 *   > Four chunky chevrons in `--ui-arrow` with a 2px `--ui-ink` contour, one
 *   > per diagonal, just outside the footprint corners, pulsing outward on a
 *   > 1.2s loop.
 *
 * The tokens are read out of the stylesheet rather than re-typed here, so the
 * green on the ground and the green in the CSS can never drift apart.
 *
 * The ghost is the REAL model, not a box: a placement preview whose silhouette
 * differs from what lands is a preview that lied. It is drawn translucent, with
 * depth writing off so it never occludes the terrain it is hovering over, and
 * tinted by an emissive wash rather than a colour swap — a green Aserradero is
 * still recognisably an Aserradero.
 */

const token = (name: string, fallback: string): THREE.Color => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // The tokens are rgba(); THREE.Color reads the rgb and ignores the alpha,
  // which is what we want — the alpha is applied by the material.
  try {
    return new THREE.Color(raw || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
};

export interface Ghost {
  readonly object: THREE.Group;
  /** Swaps in the model for `type`. Awaited before the first placement frame. */
  setModel(model: string, footprint: number): Promise<void>;
  /**
   * Moves the ghost to a cell and repaints the grid under it. `blocked` is the
   * sim's answer (another building's plot); terrain buildability is decided
   * here, because the shape is generated per seed and the sim never sees it.
   */
  setCell(x: number, z: number, blocked: boolean): void;
  /** True when every cell under the footprint is green. */
  readonly valid: boolean;
  readonly cell: { x: number; z: number };
  show(visible: boolean): void;
  update(elapsed: number): void;
  dispose(): void;
}

export function createGhost(shape: IslandShape): Ghost {
  const root = new THREE.Group();
  root.name = 'build_ghost';
  root.visible = false;
  root.renderOrder = 20;

  const OK = token('--ui-grid-ok', 'rgb(20,220,10)');
  const BAD = token('--ui-grid-bad', 'rgb(220,30,20)');
  const ARROW = token('--ui-arrow', '#92CA27');

  /* --- the grid of cells under the footprint ----------------------------- */
  const cells = new THREE.Group();
  const chevrons = new THREE.Group();
  root.add(cells, chevrons);

  const cellGeometry = new THREE.PlaneGeometry(CELL * 0.94, CELL * 0.94).rotateX(-Math.PI / 2);
  const cellPool: THREE.Mesh[] = [];
  const cellMaterial = (colour: THREE.Color) =>
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
  const okMat = cellMaterial(OK);
  const badMat = cellMaterial(BAD);

  // The 2px lighter edge, as a wireframe ring one hair inside the quad.
  const edgeGeometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(CELL * 0.94, CELL * 0.94).rotateX(-Math.PI / 2));
  const okEdge = new THREE.LineBasicMaterial({ color: OK.clone().lerp(new THREE.Color(0xffffff), 0.55), transparent: true, opacity: 0.9, depthWrite: false });
  const badEdge = new THREE.LineBasicMaterial({ color: BAD.clone().lerp(new THREE.Color(0xffffff), 0.45), transparent: true, opacity: 0.9, depthWrite: false });

  /* --- the four chevrons ------------------------------------------------- */
  // A chunky arrowhead: a flat cone with three facets, contoured by a slightly
  // larger black copy sitting a hair underneath it.
  const chevronMeshes: THREE.Group[] = [];
  {
    const head = new THREE.ConeGeometry(0.42, 0.7, 3).rotateX(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const ink = new THREE.Mesh(head, new THREE.MeshBasicMaterial({ color: 0x17130e, depthWrite: false }));
      ink.scale.setScalar(1.3);
      ink.position.y = -0.02;
      const fill = new THREE.Mesh(head, new THREE.MeshBasicMaterial({ color: ARROW, depthWrite: false }));
      g.add(ink, fill);
      g.renderOrder = 21;
      chevrons.add(g);
      chevronMeshes.push(g);
    }
  }

  /* --- the model --------------------------------------------------------- */
  let model: THREE.Object3D | null = null;
  /**
   * The centring offset `fitToFootprint` wrote onto the model's own position.
   *
   * It has to be kept and re-added rather than overwritten: the source models
   * range from 8 to 2685 units across and are not modelled about their own
   * origin, so that offset IS what puts the building on the cell. Assigning
   * `position.set(cell)` instead threw it away and parked the ghost somewhere
   * off in the sea, which looks exactly like the ghost failing to load.
   */
  const fitOffset = new THREE.Vector3();
  let half = 1.5;
  let cell = { x: 0, z: 0 };
  let valid = false;
  let modelToken = 0;

  /**
   * Washes the ghost red when it cannot land there.
   *
   * Only red. The reference leaves the building being placed in its own
   * colours and lets the GROUND carry the answer — a green-washed building
   * looks ill rather than legal, and §3.15 puts the green on the cells, not on
   * the model. But the cells are laid on the terrain, so a footprint dropped
   * over an existing building is hidden behind it exactly when the player most
   * needs to be told no. The model, drawn on top, is what still reads.
   *
   * The wash multiplies the stored base colour rather than the live one: these
   * materials carry a texture, so `color` is a multiplier, and repainting from
   * the current value would drift a little further red on every pointer move.
   */
  const BAD_WASH = new THREE.Color(1.0, 0.3, 0.24);

  function tint(object: THREE.Object3D, ok: boolean): void {
    object.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        const base = std.userData?.baseColor as THREE.Color | undefined;
        if (!std.color || !base) continue;
        std.color.copy(base);
        if (!ok) std.color.multiply(BAD_WASH);
        if (std.emissive) {
          std.emissive.setRGB(ok ? 0 : 0.22, 0, 0);
          std.emissiveIntensity = 1;
        }
      }
    });
  }

  function ensureCells(count: number): void {
    while (cellPool.length < count) {
      const mesh = new THREE.Mesh(cellGeometry, okMat);
      mesh.renderOrder = 20;
      const edge = new THREE.LineSegments(edgeGeometry, okEdge);
      edge.renderOrder = 22;
      mesh.add(edge);
      cellPool.push(mesh);
      cells.add(mesh);
    }
    cellPool.forEach((mesh, i) => { mesh.visible = i < count; });
  }

    const plotHalfFor = (footprint: number) => (footprint * BALANCE.placement.plotFactor) / 2;

  const api: Ghost = {
    object: root,
    get valid() { return valid; },
    get cell() { return cell; },

    async setModel(modelId, footprint) {
      const mine = ++modelToken;
      // The pad must match the plot the sim actually reserves, which is
      // narrower than the model fitted onto it (BALANCE.placement.plotFactor).
      // Showing footprint/2 drew a 5x5 pad for a 3x3 plot and judged the player
      // against it, refusing roughly half the ground the sim would accept — the
      // feature worked and felt broken, which is worse than not working.
      half = plotHalfFor(footprint);
      if (model) {
        // The clones below are per-ghost, so they are ours to free; the
        // geometry and textures belong to the shared cached model and are not.
        model.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
        });
        root.remove(model);
        model = null;
      }

      const instance = await instantiate(modelId, { fit: footprint * CELL, clip: 'idle' });
      if (mine !== modelToken) return;   // a faster tap already replaced it

      instance.object.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        // The footprint quads are additively blended, and three.js sorts the
        // transparent pass by renderOrder first — so a mesh left at 0 is drawn
        // BEFORE the green and washed out by it almost to nothing. The ghost
        // has to sit on top of its own footprint, not under it.
        mesh.renderOrder = 30;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.material = mats.map((m) => {
          const copy = m.clone() as THREE.MeshStandardMaterial;
          copy.transparent = true;
          copy.opacity = 0.78;
          copy.depthWrite = false;
          if (copy.color) copy.userData.baseColor = copy.color.clone();
          return copy;
        });
        if (!Array.isArray(mesh.material)) mesh.material = (mesh.material as THREE.Material[])[0];
        else if (mesh.material.length === 1) mesh.material = mesh.material[0];
      });
      instance.object.renderOrder = 23;
      fitOffset.copy(instance.object.position);
      model = instance.object;
      root.add(model);
      api.setCell(cell.x, cell.z, false);
    },

    setCell(x, z, blocked) {
      cell = { x, z };

      // Every cell the footprint covers, in grid space. The ceiling is what
      // makes an odd footprint (5 wide) light 5 cells rather than 4.
      const lo = -Math.floor(half - 0.001);
      const hi = Math.floor(half - 0.001);
      const span: Array<{ dx: number; dz: number; ok: boolean }> = [];
      let allOk = !blocked;
      for (let dz = lo; dz <= hi; dz++) {
        for (let dx = lo; dx <= hi; dx++) {
          const ok = isBuildable(shape, x + dx, z + dz);
          if (!ok) allOk = false;
          span.push({ dx, dz, ok: ok && !blocked });
        }
      }
      valid = allOk;

      ensureCells(span.length);
      span.forEach((s, i) => {
        const mesh = cellPool[i];
        const at = cellToWorld(shape, clamp(x + s.dx, shape.size), clamp(z + s.dz, shape.size));
        mesh.position.set(at.x, at.y + 0.06, at.z);
        mesh.material = s.ok ? okMat : badMat;
        (mesh.children[0] as THREE.LineSegments).material = s.ok ? okEdge : badEdge;
      });

      const centre = cellToWorld(shape, clamp(x, shape.size), clamp(z, shape.size));
      if (model) {
        model.position.set(
          fitOffset.x + centre.x,
          fitOffset.y + centre.y,
          fitOffset.z + centre.z
        );
        tint(model, valid);
      }
      chevrons.position.set(centre.x, centre.y + 0.12, centre.z);
      chevrons.visible = valid;

    },

    show(visible) {
      root.visible = visible;
    },

    update(elapsed) {
      if (!root.visible) return;
      // §3.15 — pulsing outward on a 1.2s loop.
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / 1.2) * Math.PI * 2);
      const reach = half * CELL + 0.5 + pulse * 0.35;
      const diagonals: Array<[number, number]> = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      chevronMeshes.forEach((g, i) => {
        const [sx, sz] = diagonals[i];
        g.position.set(sx * reach, 0, sz * reach);
        g.rotation.set(0, Math.atan2(sx, sz), 0);
        g.scale.setScalar(0.9 + pulse * 0.18);
      });
    },

    dispose() {
      root.removeFromParent();
      cellGeometry.dispose();
      edgeGeometry.dispose();
      okMat.dispose(); badMat.dispose(); okEdge.dispose(); badEdge.dispose();
    },
  };

  // The waterline sits at STEP * 0.82; a footprint quad below that would be
  // under the sea, so keep the group at ground level and let each cell lift
  // itself to its own terrain height.
  root.position.y = 0;
  void STEP;

  return api;
}

const clamp = (v: number, size: number): number => Math.max(0, Math.min(size - 1, v));
