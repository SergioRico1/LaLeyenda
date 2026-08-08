import './seaHud.css';
import type { ResourceId } from '../sim';
import { SHIPS, bearingHome, holdUsed, ringOf, SEA_CELL, type Voyage } from '../sim/sea';

/**
 * seaHud.ts — what a voyage needs on screen, and nothing else.
 *
 * The island HUD is dense because a builder is a spreadsheet with a view. This
 * is the opposite: at sea the player is steering with one thumb while things
 * shoot at them, so every readout here had to earn its place.
 *
 * Four did.
 *
 *   hull     A BAR, not a number. Somebody under fire has no attention for
 *            arithmetic, and the rate it empties is the actual information.
 *   hold     Because filling it is the point of leaving, and finding out it was
 *            full only when a chest pays nothing is the version that reads as a
 *            bug.
 *   ring     One number that says both how rich and how dangerous it is here.
 *   home     An arrow. Home is invisible from two cells out, and a player who
 *            cannot find it cannot bank anything they are carrying — this is
 *            not decoration, it is the return mechanism.
 */

const RESOURCE_LABEL: Record<string, string> = {
  oro: 'Oro', madera: 'Madera', metal: 'Metal', ron: 'Ron',
};

export interface SeaHud {
  update(voyage: Voyage): void;
  /** Shows the end-of-voyage card. Resolves when the player dismisses it. */
  finish(voyage: Voyage, reason: 'home' | 'sunk' | 'left'): Promise<void>;
  dispose(): void;
}

export interface SeaHudOptions {
  /** Called when the player abandons the voyage from the button. */
  onLeave(): void;
}

export function createSeaHud(host: HTMLElement, opts: SeaHudOptions): SeaHud {
  const root = document.createElement('div');
  root.className = 'sea';
  root.innerHTML = `
    <div class="sea__bar">
      <div class="sea__cap sea__cap--grow">
        <span class="sea__label">Casco</span>
        <span class="sea__hull"><span class="sea__hullFill" style="width:100%"></span></span>
      </div>
      <div class="sea__cap"><span class="sea__label">Bodega</span><span data-hold>0</span></div>
      <div class="sea__cap"><span class="sea__label">Zona</span><span data-ring>1</span></div>
    </div>
    <button class="sea__leave tap" type="button">Volver</button>
    <div class="sea__home">
      <svg class="sea__arrow" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2 L20 20 L12 15.5 L4 20 Z" fill="#FFD75E" stroke="#17130E" stroke-width="2"
              stroke-linejoin="round"/>
      </svg>
      <span data-home>Casa</span>
    </div>
  `;
  host.append(root);

  const hull = root.querySelector('.sea__hull') as HTMLElement;
  const hullFill = root.querySelector('.sea__hullFill') as HTMLElement;
  const holdOut = root.querySelector('[data-hold]') as HTMLElement;
  const ringOut = root.querySelector('[data-ring]') as HTMLElement;
  const homeOut = root.querySelector('[data-home]') as HTMLElement;
  const arrow = root.querySelector('.sea__arrow') as HTMLElement;
  const leave = root.querySelector('.sea__leave') as HTMLButtonElement;
  leave.addEventListener('click', () => opts.onLeave());

  return {
    update(voyage) {
      const spec = SHIPS[voyage.shipType];
      const fraction = Math.max(0, voyage.hull / spec.hull);
      hullFill.style.width = `${(fraction * 100).toFixed(1)}%`;
      hull.classList.toggle('is-hurt', fraction <= 0.34);

      holdOut.textContent = `${Math.round(holdUsed(voyage))}/${spec.hold}`;
      ringOut.textContent = String(
        ringOf(Math.round(voyage.x / SEA_CELL), Math.round(voyage.y / SEA_CELL))
      );

      const bearing = bearingHome(voyage.x, voyage.y);
      arrow.style.setProperty('--sea-bearing', `${(bearing * 180) / Math.PI}deg`);
      const distance = Math.hypot(voyage.x, voyage.y);
      homeOut.textContent = distance < SEA_CELL * 0.5 ? 'En casa' : `${Math.round(distance)} m`;
    },

    finish(voyage, reason) {
      return new Promise((resolve) => {
        const landed = Object.entries(voyage.cargo)
          .filter(([, amount]) => (amount ?? 0) > 0)
          .map(([res, amount]) =>
            `<span class="sea__endItem">${RESOURCE_LABEL[res] ?? res} ${Math.round(amount ?? 0)}</span>`)
          .join('');

        const title = reason === 'sunk' ? '¡Nos hunden!' : 'De vuelta a puerto';
        const note = reason === 'sunk'
          ? 'La tripulación se salva y llega a nado con la mitad de la carga.'
          : landed
            ? 'La carga pasa a tus almacenes.'
            : 'Sin carga esta vez.';

        const end = document.createElement('div');
        end.className = 'sea__end';
        end.innerHTML = `
          <div class="sea__endCard">
            <div class="sea__endTitle">${title}</div>
            <div class="sea__endNote">${note}</div>
            <div class="sea__endList">${landed}</div>
            <button class="sea__endCta tap" type="button">A la isla</button>
          </div>
        `;
        root.append(end);
        (end.querySelector('.sea__endCta') as HTMLButtonElement).addEventListener('click', () => {
          end.remove();
          resolve();
        });
      });
    },

    dispose() {
      root.remove();
    },
  };
}

export type { ResourceId };
