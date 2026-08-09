import './settings.css';
import { el, pressable } from '../components/dom';
import { markX } from './marks';

/**
 * settings.ts — Ajustes, as an overlay over whatever is behind it.
 *
 * PRODUCTION.md §6 names the gap this closes out loud: "export/import is
 * reachable only from the JS console, which cannot ship". PLAN.md Fase 0
 * promises the player a manual backup, and without a server that backup is the
 * ONLY copy of their island there will ever be. So the three destructive-or-
 * precious operations are the ones that exist first, and the decorative ones
 * (audio, language, credits) are what the next builder adds.
 *
 * ✎ SEAM. It takes handlers rather than a Game: it is opened from the title,
 * where there may be no game at all, and from the island HUD, where there is
 * one. A handler that is null becomes a disabled row rather than a missing one
 * — §3.5, a control that cannot act still says why.
 */

const COPY = {
  heading: 'Ajustes',
  close: 'Cerrar',
  save: 'Guardar ahora',
  saveHint: 'Escribe la partida en este dispositivo.',
  export: 'Exportar copia',
  exportHint: 'Descarga tu isla como archivo.',
  import: 'Importar copia',
  importHint: 'Recupera una isla desde un archivo.',
  reset: 'Empezar de nuevo',
  resetHint: 'Borra esta isla para siempre.',
  resetConfirm: '¿Seguro? Toca otra vez',
  noGame: 'Disponible con una partida empezada.',
  done: 'Hecho',
  failed: 'No se pudo',
} as const;

export interface SettingsPanelOptions {
  onClose(): void;
  /** Null when Ajustes was opened from the title and there is no game yet. */
  onSave?: (() => Promise<void> | void) | null;
  onExport?: (() => void) | null;
  onImport?: ((file: Blob) => Promise<void> | void) | null;
  onReset?: (() => Promise<void> | void) | null;
  /** Shown in the footer so a player can see whose island this is. */
  captainName?: string | null;
}

export interface SettingsPanel {
  readonly el: HTMLElement;
  dispose(): void;
}

export function createSettingsPanel(opts: SettingsPanelOptions): SettingsPanel {
  const rows: HTMLElement[] = [];

  /** One row: a labelled action with a line of explanation under it. */
  const row = (
    label: string,
    hint: string,
    family: 'grey' | 'green' | 'red',
    action: (() => void) | null
  ): { el: HTMLElement; button: HTMLElement; note: HTMLElement } => {
    const button = el('button', `btn btn--${family} settings__go`, el('span', 't t-btn', label));
    button.type = 'button';
    button.setAttribute('aria-label', label);
    const note = el('p', 't t-micro settings__hint', action ? hint : COPY.noGame);
    if (action) pressable(button, action);
    else button.disabled = true;
    const node = el('div', 'settings__row', button, note);
    rows.push(node);
    return { el: node, button, note };
  };

  const say = (note: HTMLElement, text: string): void => {
    note.textContent = text;
  };

  const saveRow = row(COPY.save, COPY.saveHint, 'grey', opts.onSave
    ? () => { void Promise.resolve(opts.onSave?.()).then(() => say(saveRow.note, COPY.done)); }
    : null);

  row(COPY.export, COPY.exportHint, 'grey', opts.onExport ? () => opts.onExport?.() : null);

  // A file input is the only way a browser lets a page read a file the player
  // chose, so the button is a label over a hidden input rather than a fake one.
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.className = 'settings__file';
  const importRow = row(COPY.import, COPY.importHint, 'grey', opts.onImport ? () => file.click() : null);
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    void Promise.resolve(opts.onImport?.(chosen)).then(
      () => say(importRow.note, COPY.done),
      (err) => { console.error('[settings] import failed', err); say(importRow.note, COPY.failed); }
    );
  });
  importRow.el.append(file);

  // Two taps, because there is no undo and no server copy. The second tap is
  // the confirmation dialog, spent on the button itself rather than on a modal
  // over a modal.
  let armed = false;
  const resetRow = row(COPY.reset, COPY.resetHint, 'red', opts.onReset
    ? () => {
        if (!armed) {
          armed = true;
          resetRow.button.replaceChildren(el('span', 't t-btn', COPY.resetConfirm));
          return;
        }
        void opts.onReset?.();
      }
    : null);

  const close = el('button', 'btn btn--red btn-x settings__x', markX('settings__x-mark'));
  close.type = 'button';
  close.setAttribute('aria-label', COPY.close);
  pressable(close, opts.onClose);

  const scrim = el('div', 'settings__scrim');
  scrim.addEventListener('pointerdown', (event) => { event.stopPropagation(); opts.onClose(); });

  const panel = el('div', 'settings__panel',
    el('header', 'settings__head', el('h2', 't t-section settings__title', COPY.heading)),
    el('div', 'settings__rows', ...rows),
    el('p', 't t-micro settings__who', opts.captainName ? `Capitán ${opts.captainName}` : ''),
    close);

  const root = el('div', 'settings layer-page', scrim, panel);

  return {
    el: root,
    dispose() { root.remove(); },
  };
}
