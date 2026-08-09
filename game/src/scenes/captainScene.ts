import * as THREE from 'three';
import { Stage } from '../render/stage';
import { createSeaBackdrop, type SeaBackdrop } from './titleScene';
import { createAvatar, bakeSwatches, swatchKey, type Avatar, type SwatchSheet } from '../render/avatar';
import { createCaptainPanel, type CaptainPanel } from '../ui/panels/captain';
import {
  AVATAR_SLOTS, createCaptain, sanitizeLook, slotOptions,
  type AvatarSlot, type Captain, type CaptainLook,
} from '../sim';

/**
 * captainScene.ts — PRODUCTION.md §1's captain creation, with the captain in it.
 *
 * A scene rather than a panel because the avatar is a 3D object: this screen
 * owns something on the stage, so it owns a dispose. What it owns is a raft on
 * open water, a captain standing on it, and the swatch bake behind the panel's
 * options.
 *
 * The turntable is the reason the raft exists. A character you can spin has to
 * be standing on something that spins with them, or the rotation reads as the
 * camera moving rather than the captain turning; the planks are the only cue in
 * the frame that says which way round they are.
 *
 * Two capture-only knobs, both used to calibrate the mount table in
 * render/avatar.ts and both harmless in a player's build:
 *
 *     ?look=av_body_tan,av_hat_wizard,…   dress the captain from the URL
 *     ?parade=hat                          every option in that family, in a row
 *
 * `npm run shoot -- captain --mobile --parade hat` is how the hat-through-hair
 * question was answered with pixels instead of an opinion.
 */

export interface CaptainScene {
  update(dt: number, elapsed: number): void;
  /** Shot mode: nothing is captured until the swatches have been drawn. */
  settle(): Promise<void>;
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

/** Top of the raft, in world units. The captain's feet stand here. */
const DECK_Y = 1.0;
/**
 * How much taller than the captain the frame has to be.
 *
 * Measured, not padded: a wizard hat adds 0.21 of body-model height and a
 * tricorn 0.24, which at the captain's scale is nearly 0.9 world units on top
 * of a 2.6-unit pirate. Framing on the bare body is what put the first capture's
 * hat brim through the top edge of the phone.
 */
const HAT_ROOM = 1.38;
/** Where the camera sits, and what it aims at. Solved in the note below. */
const CAMERA_DISTANCE = 8.4;

/**
 * The captain is framed HIGH on purpose.
 *
 * The control sheet takes the bottom ~38% of a 430x932 phone, so a subject
 * centred in the viewport would be half behind it. The camera therefore aims
 * BELOW the captain's middle — a lookAt point is what lands on the centre of
 * the frame, so lowering it raises the subject — by this fraction of the
 * visible height at the captain's distance.
 */
const RAISE = 0.19;

export async function createCaptainScene(
  stage: Stage,
  opts: CaptainSceneOptions
): Promise<CaptainScene> {
  const params = new URLSearchParams(location.search);
  const backdrop: SeaBackdrop = createSeaBackdrop(stage, { look: 'near' });

  // Opening on a rolled captain rather than on an empty form is the whole
  // difference between "fill this in" and "make this yours": a player who taps
  // straight through still leaves with a real pirate, which is what makes the
  // screen skippable without being pointless.
  const opening = createCaptain(opts.seed);
  const look = readLook(params, opening.look);

  const group = new THREE.Group();
  group.name = 'captain_rig';
  group.position.y = DECK_Y;
  stage.scene.add(group);

  // The raft and the captain turn together. A character spinning on a fixed
  // deck reads as the camera orbiting; the planks turning under their feet are
  // the only thing in an open-sea frame that says otherwise.
  const spin = new THREE.Group();
  spin.name = 'captain_turntable';
  group.add(spin);

  const raft = createRaft();
  spin.add(raft.object);

  const parade = params.get('parade');
  const paradeSlot = AVATAR_SLOTS.find((slot) => slot === parade) ?? null;

  const avatars: Avatar[] = [];
  if (paradeSlot) {
    const options = slotOptions(paradeSlot);
    for (let i = 0; i < options.length; i++) {
      const avatar = await createAvatar({ ...look, [paradeSlot]: options[i] });
      avatar.object.position.x = (i - (options.length - 1) / 2) * PARADE_PITCH;
      // Dead front for a calibration sheet: the three-quarter view is the right
      // way to PRESENT a captain and the wrong way to check whether a brim is
      // centred on a skull.
      avatar.object.rotation.y = -Math.PI / 2;
      group.add(avatar.object);
      avatars.push(avatar);
    }
    raft.object.visible = false;
  } else {
    const avatar = await createAvatar(look);
    // The body faces +x; the camera stands on +z. A quarter turn brings the
    // face round, and the extra 0.3rad is the three-quarter view every voxel
    // character in the references is presented at — dead-on front reads as a
    // mugshot and hides the silhouette a hat is chosen for.
    avatar.object.rotation.y = -Math.PI / 2;
    spin.rotation.y = 0.34;
    spin.add(avatar.object);
    avatars.push(avatar);
  }

  frame(stage, avatars, paradeSlot);
  stage.aimSun(new THREE.Vector3(0, DECK_Y + 1.3, 0));

  // §2.3: both orientations are first class, and the framing differs between
  // them — so it is re-solved when the phone turns rather than fixed at build.
  const reframe = (): void => frame(stage, avatars, paradeSlot);
  window.addEventListener('resize', reframe);
  window.addEventListener('orientationchange', reframe);

  /* --- the panel --------------------------------------------------------- */

  const uiRoot = document.getElementById('ui');
  let panel: CaptainPanel | null = null;
  let swatches: SwatchSheet = new Map();
  let stopSpin: (() => void) | null = null;

  // Kicked off now, awaited by settle(). A player sees the panel immediately
  // with its silhouettes still filling in; a capture waits, because a swatch
  // row photographed mid-bake is a row of empty tiles.
  const baking = paradeSlot
    ? Promise.resolve(new Map<string, string>())
    : bakeSwatches(
        look.body,
        AVATAR_SLOTS.flatMap((slot) => slotOptions(slot).map((id) => ({ slot, id })))
      ).catch((err) => {
        console.warn('[captain] swatch bake failed', err);
        return new Map<string, string>();
      });

  if (uiRoot && !paradeSlot) {
    panel = createCaptainPanel({
      captain: { ...opening, look },
      onChange: (captain) => { void avatars[0]?.setLook(captain.look); },
      onConfirm: opts.onConfirm,
      onBack: opts.onBack,
    });
    uiRoot.append(panel.el);
    stopSpin = turntable(panel.stage, spin);
    void baking.then((sheet) => {
      swatches = sheet;
      panel?.setSwatches((slot: AvatarSlot, id: string | null) => swatches.get(swatchKey(slot, id)));
    });
  }

  return {
    update(dt, elapsed) {
      backdrop.update(dt, elapsed);
      raft.update(elapsed);
      for (const avatar of avatars) avatar.update(dt);
    },
    async settle() {
      await baking;
    },
    dispose() {
      window.removeEventListener('resize', reframe);
      window.removeEventListener('orientationchange', reframe);
      stopSpin?.();
      panel?.dispose();
      for (const avatar of avatars) avatar.dispose();
      raft.dispose();
      stage.scene.remove(group);
      backdrop.dispose();
    },
  };
}

/* --------------------------------------------------------------------------
 * framing
 * ----------------------------------------------------------------------- */

/** Spacing between the captains in a parade capture. */
const PARADE_PITCH = 1.25;
/** Families whose parade is worth cropping to the head. */
const HEAD_SLOTS: readonly AvatarSlot[] = ['hair', 'beard', 'eyes', 'hat'];

function frame(stage: Stage, avatars: readonly Avatar[], parade: AvatarSlot | null): void {
  const body = avatars[0]?.height ?? 2.6;
  const height = body * HAT_ROOM;
  const perUnit = 2 * Math.tan(THREE.MathUtils.degToRad(stage.camera.fov) / 2);

  if (parade) {
    // A contact sheet, not a portrait: back off until the whole row fits the
    // capture, and for the four families worn on the head, crop to the heads —
    // a beard judged at 60 screen pixels is a beard nobody judged.
    const head = HEAD_SLOTS.includes(parade);
    const row = (avatars.length - 1) * PARADE_PITCH + 1.5;
    const visible = Math.max(head ? 2.3 : height * 1.1, row / stage.camera.aspect);
    const distance = visible / perUnit;
    const aim = DECK_Y + (head ? body * 0.74 : height * 0.5);
    stage.camera.position.set(0, aim + distance * 0.06, distance);
    stage.camera.lookAt(0, aim, 0);
    return;
  }

  // Landscape is not a wider portrait. The control sheet keeps roughly the
  // height it has on a phone while the viewport loses half of its own, so the
  // captain has to give some size back or their boots end up behind the
  // nameplate — which is exactly what the first landscape capture did.
  const distance = stage.camera.aspect > 1 ? CAMERA_DISTANCE * 1.3 : CAMERA_DISTANCE;
  const visible = distance * perUnit;
  const aim = DECK_Y + height * 0.5 - visible * RAISE;
  stage.camera.position.set(0, aim + distance * 0.135, distance);
  stage.camera.lookAt(0, aim, 0);
}

/* --------------------------------------------------------------------------
 * the raft
 * ----------------------------------------------------------------------- */

interface Raft {
  object: THREE.Group;
  update(elapsed: number): void;
  dispose(): void;
}

/**
 * Six boxes: five planks and the beam under them.
 *
 * Built rather than loaded because nothing in the library is a bare deck, and
 * because a cylinder pedestal would be the one smooth object in a game made of
 * cubes. It bobs on the same period as the swell so it reads as floating rather
 * than as a plinth someone dropped in the sea.
 */
function createRaft(): Raft {
  const object = new THREE.Group();
  object.name = 'raft';

  const plank = new THREE.MeshStandardMaterial({ color: 0xb57c43, roughness: 1, metalness: 0, flatShading: true });
  const beam = new THREE.MeshStandardMaterial({ color: 0x53321b, roughness: 1, metalness: 0, flatShading: true });

  // Just wider than the captain's stance and a good deal narrower than the
  // frame: at the framing distance only ~3.2 world units of width are visible
  // in portrait, and a raft that reaches both edges stops being a raft and
  // becomes a floor.
  const WIDTH = 1.9;
  const COUNT = 5;
  const gap = 0.03;
  const each = (WIDTH - gap * (COUNT - 1)) / COUNT;
  // Split along DEPTH, not width: the camera looks almost along the deck, so
  // the only face of the planks the player really sees is the front edge — and
  // splitting the other way chopped that edge into six pieces with daylight
  // between them, which read as flotsam rather than as a deck.
  const plankGeometry = new THREE.BoxGeometry(WIDTH, 0.22, each);
  for (let i = 0; i < COUNT; i++) {
    const mesh = new THREE.Mesh(plankGeometry, plank);
    mesh.position.set(0, -0.11, (i - (COUNT - 1) / 2) * (each + gap));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    object.add(mesh);
  }

  // The hull, and it is TALL on purpose. A camera pitched 8 degrees down sees
  // almost none of a deck's top face, so the side is the only part of the raft
  // that can carry it — at 0.6 units it reads as a hull sitting in the water
  // rather than as a plank awash in it.
  const beamGeometry = new THREE.BoxGeometry(WIDTH + 0.2, 0.6, WIDTH + 0.2);
  const base = new THREE.Mesh(beamGeometry, beam);
  base.position.y = -0.52;
  base.castShadow = true;
  base.receiveShadow = true;
  object.add(base);

  return {
    object,
    update(elapsed) {
      // Slow, small, and out of phase with the wave crests behind it.
      object.position.y = Math.sin(elapsed * 0.62) * 0.075;
      object.rotation.z = Math.sin(elapsed * 0.44 + 1.1) * 0.012;
      object.rotation.x = Math.sin(elapsed * 0.52) * 0.01;
    },
    dispose() {
      plankGeometry.dispose();
      beamGeometry.dispose();
      plank.dispose();
      beam.dispose();
      object.removeFromParent();
    },
  };
}

/* --------------------------------------------------------------------------
 * the turntable
 * ----------------------------------------------------------------------- */

/**
 * Drag anywhere over the captain to spin them, with the flick carried on.
 *
 * The handle is the panel's own transparent stage box, so the gesture belongs
 * to the DOM layer that is already there rather than to a raycast, and the
 * controls underneath keep every one of their taps.
 */
function turntable(handle: HTMLElement, object: THREE.Object3D): () => void {
  let dragging = false;
  let last = 0;
  let spin = 0;

  handle.style.touchAction = 'none';
  handle.addEventListener('pointerdown', (event) => {
    dragging = true;
    last = event.clientX;
    spin = 0;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const delta = (event.clientX - last) * 0.011;
    last = event.clientX;
    object.rotation.y += delta;
    spin = delta;
  });
  const release = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture?.(event.pointerId);
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);

  handle.addEventListener('lostpointercapture', () => { dragging = false; });

  // The flick carries on and decays. It runs on its own frame rather than the
  // scene's update, because in a capture the scene is frozen and a released
  // drag must still come to rest rather than stopping mid-spin.
  const step = (): void => {
    if (!dragging && Math.abs(spin) > 0.0002) {
      object.rotation.y += spin;
      spin *= 0.92;
    }
    frameHandle = requestAnimationFrame(step);
  };
  let frameHandle = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frameHandle);
}

/* --------------------------------------------------------------------------
 * ?look= — dressing the captain from the URL
 * ----------------------------------------------------------------------- */

/** Any subset of part ids, comma separated, in any order. Each one is filed by
 *  the slot its own id names, so `?look=av_hat_wizard` changes only the hat. */
function readLook(params: URLSearchParams, fallback: CaptainLook): CaptainLook {
  const raw = params.get('look');
  if (!raw) return fallback;
  const draft: Record<string, string | null> = { ...fallback };
  for (const token of raw.split(',').map((t) => t.trim()).filter(Boolean)) {
    if (token === 'none') continue;
    const slot = AVATAR_SLOTS.find((name) => token.startsWith(`av_${name}_`));
    if (slot) draft[slot] = token;
  }
  for (const token of raw.split(',')) {
    const [slot, value] = token.split(':');
    if (value === 'none' && (AVATAR_SLOTS as readonly string[]).includes(slot)) draft[slot as AvatarSlot] = null;
  }
  return sanitizeLook(draft, fallback);
}
