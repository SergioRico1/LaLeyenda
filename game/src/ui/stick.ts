import { SHOT } from './env';

/**
 * stick.ts — steering the ship with one thumb.
 *
 * PLAN.md leaves the choice open ("joystick virtual o mantener-y-arrastrar,
 * probar ambos"). This is both at once, and the reason is that they are the
 * same gesture when the stick has no fixed home: press anywhere in the lower
 * two thirds of the screen and the stick appears UNDER the thumb, so the player
 * never has to look for it, and dragging from there is hold-and-drag.
 *
 * The vector it reports is a DIRECTION IN THE WORLD, not a turn rate. A phone
 * player pointing their thumb north-east means "sail north-east"; asking them
 * to hold left to rotate is a keyboard idea that feels awful on glass. The
 * scene converts the direction into helm angle, which keeps the simulation's
 * input the same helm a replay would use.
 *
 * The top third is left alone so the HUD keeps its taps, and the stick never
 * captures a gesture that started on a button.
 */

export interface Stick {
  /** -1..1 across, -1..1 up the screen. Zero length when nothing is held. */
  readonly x: number;
  readonly y: number;
  /** 0..1 — how far out the thumb is, which the scene uses as throttle. */
  readonly force: number;
  readonly held: boolean;
  dispose(): void;
}

/** Pixels from the centre at which the stick reads full deflection. */
const REACH = 64;

export function createStick(host: HTMLElement): Stick {
  const root = document.createElement('div');
  root.className = 'stick';
  const base = document.createElement('div');
  base.className = 'stick__base';
  const knob = document.createElement('div');
  knob.className = 'stick__knob';
  root.append(base, knob);
  host.append(root);

  let pointer: number | null = null;
  let originX = 0;
  let originY = 0;
  const state = { x: 0, y: 0, force: 0, held: false };

  function show(x: number, y: number): void {
    base.style.transform = `translate(${x}px, ${y}px)`;
    knob.style.transform = `translate(${x}px, ${y}px)`;
    root.classList.add('is-held');
  }

  function onDown(event: PointerEvent): void {
    if (pointer !== null) return;
    // The HUD owns the top of the screen. A steering gesture that starts on a
    // button would steal the button's tap, so it simply does not start there.
    if (event.clientY < window.innerHeight * 0.32) return;
    if ((event.target as HTMLElement)?.closest('.tap, button')) return;
    pointer = event.pointerId;
    originX = event.clientX;
    originY = event.clientY;
    state.held = true;
    show(originX, originY);
    host.setPointerCapture?.(event.pointerId);
  }

  function onMove(event: PointerEvent): void {
    if (event.pointerId !== pointer) return;
    const dx = event.clientX - originX;
    const dy = event.clientY - originY;
    const length = Math.hypot(dx, dy);
    const force = Math.min(1, length / REACH);
    state.force = force;
    if (length > 0.001) {
      state.x = (dx / length) * force;
      // Screen y grows downward; the world does not.
      state.y = (-dy / length) * force;
    }
    const clamped = Math.min(length, REACH);
    const kx = originX + (length ? (dx / length) * clamped : 0);
    const ky = originY + (length ? (dy / length) * clamped : 0);
    base.style.transform = `translate(${originX}px, ${originY}px)`;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
  }

  function onUp(event: PointerEvent): void {
    if (event.pointerId !== pointer) return;
    pointer = null;
    state.x = 0;
    state.y = 0;
    state.force = 0;
    state.held = false;
    root.classList.remove('is-held');
  }

  // Not in shot mode: a capture drives the stick through scripted events and a
  // real listener would fight them.
  if (!SHOT) {
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);
  }

  return {
    get x() { return state.x; },
    get y() { return state.y; },
    get force() { return state.force; },
    get held() { return state.held; },
    dispose() {
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onUp);
      root.remove();
    },
  };
}
