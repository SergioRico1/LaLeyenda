import * as THREE from 'three';

/**
 * The island camera: one finger pans, two fingers pinch to zoom.
 *
 * This is the base interaction of a builder — a phone screen shows a fraction
 * of the island, and everything the player owns has to be reachable by dragging
 * to it. It was deferred once and the note left behind ("pannable in a later
 * slice") is why a tap already distinguishes itself from a drag.
 *
 * Two decisions worth stating, because both are what makes it feel right rather
 * than merely work:
 *
 * - Panning is 1:1 WITH THE GROUND, not with a fixed pixels-per-unit factor.
 *   The finger's start and current positions are each projected onto the ground
 *   plane and the camera moves by the difference, so the piece of island under
 *   the thumb stays under the thumb at any zoom or tilt. A constant factor
 *   drifts as soon as the camera changes height, and the drift is what reads as
 *   "the map is sliding away from me".
 *
 * - Release carries momentum with exponential decay, and the same clamp applies
 *   while gliding. Stopping dead on release feels broken on touch; every map on
 *   a phone glides.
 */

export interface CameraRigOptions {
  camera: THREE.PerspectiveCamera;
  element: HTMLElement;
  /** Half-extent of the area the focus point may reach, in world units. */
  bounds: number;
  /** Camera-to-target distance limits. */
  minDistance?: number;
  maxDistance?: number;
  /** Starting distance; defaults to the camera's current offset length. */
  distance?: number;
  /** The point the camera looks at. The rig only ever slides it in x/z, so
   *  passing the scene's own target leaves the opening frame untouched. */
  target?: THREE.Vector3;
  /** Height of the surface a drag tracks. This is the island's build plateau,
   *  not sea level, and not the same thing as the look-at height: getting them
   *  confused is a few percent of drift between thumb and ground. */
  panPlaneY?: number;
}

export interface CameraRig {
  /** Advances momentum. Call once per frame with the frame's delta seconds. */
  update(dt: number): void;
  /** True while a drag has travelled far enough to be a pan rather than a tap. */
  readonly panning: boolean;
  /** Suspends input — used while a building is being placed, where the finger
   *  belongs to the ghost. */
  setEnabled(on: boolean): void;
  focusOn(x: number, z: number): void;
  dispose(): void;
}

/** Past this many pixels a gesture is a pan, and the tap handler stands down. */
const PAN_SLOP = 10;

export function createCameraRig(opts: CameraRigOptions): CameraRig {
  const { camera, element } = opts;
  const minDistance = opts.minDistance ?? 18;
  const maxDistance = opts.maxDistance ?? 70;

  // The rig owns a focus point and a fixed offset direction; the camera is
  // always placed along that direction at `distance`. Keeping the direction
  // constant is what preserves the reference's isometric read no matter where
  // the player has dragged to.
  const focus = (opts.target ?? new THREE.Vector3()).clone();
  const focusY = focus.y;
  const direction = camera.position.clone().sub(focus).normalize();
  let distance = opts.distance ?? camera.position.distanceTo(focus);

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(opts.panPlaneY ?? 0));
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const hit = new THREE.Vector3();

  const active = new Map<number, { x: number; y: number }>();
  let panning = false;
  let enabled = true;
  let startedAt: { x: number; y: number } | null = null;
  /** Where on the ground the gesture grabbed, held for the whole drag. */
  const grabbed = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const instant = new THREE.Vector3();
  /** Event time of the last move, to turn a step into a speed. */
  let movedAt = 0;
  let pinchStart: { gap: number; distance: number } | null = null;

  /** Screen point → the ground plane, or null when the ray misses it. */
  function groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = element.getBoundingClientRect();
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointerNdc, camera);
    return raycaster.ray.intersectPlane(plane, hit) ? hit.clone() : null;
  }

  function applyCamera(): void {
    // Clamped every time rather than only on input, so momentum cannot carry
    // the player past the edge and strand them looking at empty ocean.
    focus.x = THREE.MathUtils.clamp(focus.x, -opts.bounds, opts.bounds);
    focus.z = THREE.MathUtils.clamp(focus.z, -opts.bounds, opts.bounds);
    focus.y = focusY;
    distance = THREE.MathUtils.clamp(distance, minDistance, maxDistance);
    camera.position.copy(focus).addScaledVector(direction, distance);
    camera.lookAt(focus);
  }

  const gap = (): number => {
    const [a, b] = [...active.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  function onDown(event: PointerEvent): void {
    if (!enabled) return;
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });
    velocity.set(0, 0, 0);

    if (active.size === 1) {
      startedAt = { x: event.clientX, y: event.clientY };
      movedAt = event.timeStamp;
      const at = groundAt(event.clientX, event.clientY);
      if (at) grabbed.copy(at);
      // Without capture the drag dies the moment the thumb crosses the nav bar
      // or leaves the screen edge — both of which happen constantly on a phone,
      // and both of which read as the island sticking.
      if (element.setPointerCapture) element.setPointerCapture(event.pointerId);
    } else if (active.size === 2) {
      // A second finger converts the gesture; the pan must not also fire.
      panning = false;
      startedAt = null;
      pinchStart = { gap: gap(), distance };
    }
  }

  function onMove(event: PointerEvent): void {
    if (!enabled || !active.has(event.pointerId)) return;
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (active.size >= 2 && pinchStart) {
      const ratio = pinchStart.gap / Math.max(gap(), 1);
      distance = pinchStart.distance * ratio;
      applyCamera();
      return;
    }

    if (!startedAt) return;
    if (!panning) {
      const travelled = Math.hypot(event.clientX - startedAt.x, event.clientY - startedAt.y);
      if (travelled < PAN_SLOP) return;
      panning = true;
    }

    // The ground point under the finger now, against the one it grabbed: the
    // camera moves by exactly their difference, so the island tracks the thumb.
    const now = groundAt(event.clientX, event.clientY);
    if (!now) return;
    const before = focus.clone();
    focus.x -= now.x - grabbed.x;
    focus.z -= now.z - grabbed.z;
    applyCamera();

    // Speed, not step size: pointermove fires anywhere between 60Hz and 240Hz,
    // so the same flick produces steps that differ fourfold between devices.
    // Dividing by the event's own elapsed time is what makes the glide the same
    // length on all of them. Clamped because a stalled main thread would
    // otherwise turn one catch-up event into a launch.
    const dt = Math.min(0.05, Math.max(0.004, (event.timeStamp - movedAt) / 1000));
    movedAt = event.timeStamp;
    // Measured after clamping, so a fling into the edge does not store speed
    // the player would then have to wait out.
    instant.set(focus.x - before.x, 0, focus.z - before.z).divideScalar(dt);
    // Weighted to the newest sample: enough smoothing that one jittery event
    // cannot define the throw, little enough that holding still before letting
    // go decays to a stop — which is how a player cancels a fling.
    velocity.lerp(instant, 0.6);
  }

  function onUp(event: PointerEvent): void {
    active.delete(event.pointerId);
    if (active.size < 2) pinchStart = null;
    if (active.size === 0) {
      panning = false;
      startedAt = null;
    }
  }

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onUp);

  // Trackpad and mouse wheel, so the game is workable on a desktop too.
  const onWheel = (event: WheelEvent) => {
    if (!enabled) return;
    event.preventDefault();
    distance *= 1 + Math.sign(event.deltaY) * 0.12;
    applyCamera();
  };
  element.addEventListener('wheel', onWheel, { passive: false });

  applyCamera();

  return {
    get panning() { return panning; },

    update(dt) {
      if (velocity.lengthSq() < 1e-4 || active.size > 0) return;
      focus.addScaledVector(velocity, dt);
      // ~8% of the speed survives each second: a flick glides about a second.
      velocity.multiplyScalar(Math.pow(0.08, dt));
      applyCamera();
    },

    setEnabled(on) {
      enabled = on;
      if (!on) {
        active.clear();
        panning = false;
        startedAt = null;
        pinchStart = null;
        velocity.set(0, 0, 0);
      }
    },

    focusOn(x, z) {
      focus.set(x, focusY, z);
      velocity.set(0, 0, 0);
      applyCamera();
    },

    dispose() {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      element.removeEventListener('wheel', onWheel);
    },
  };
}
