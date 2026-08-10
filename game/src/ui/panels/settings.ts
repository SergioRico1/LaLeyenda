import './settings.css';
import { el, pressable } from '../components/dom';
import { markX } from './marks';
import { SHOT } from '../env';

/**
 * settings.ts — Ajustes, a full-height sheet over a dimmed backdrop.
 *
 * PRODUCTION.md §1 and §6 name the gap this closes out loud: "Save
 * export/import is still reachable only from the JS console, which cannot
 * ship." PLAN.md Fase 0 promises the player a manual backup, and without a
 * server that backup is the ONLY copy of their island there will ever be. So
 * the precious-or-destructive operations get the most room, the most words and
 * the most friction; the switches and the credits are quiet by comparison.
 *
 * ✎ SEAM. It takes handlers rather than a Game: it is opened from the title,
 * where there may be no game at all, and from the island HUD, where there is
 * one. A handler that is null becomes a disabled row rather than a missing one
 * — §3.5, a control that cannot act still says why.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * **A música switch.** There is no music in this game. `src/ui/sfx.ts` is a
 * synthesised EFFECTS bank — 19 entries, each a short stack of oscillators —
 * and nothing anywhere in `src/` starts a loop, a bed or a score. A row
 * labelled Música would be a switch wired to nothing, which is worse than no
 * switch at all. The hook for it is small and named: add a channel to `prefs`,
 * give it its own gain off the master in `tapAudio`, and add a row to the
 * Sonido group beside Efectos.
 *
 * **Vibración, on a platform without it.** `navigator.vibrate` does not exist
 * on iOS Safari, so on roughly half the target devices the row is not drawn at
 * all rather than drawn and dead. See `tapHaptics`.
 */

/* ==========================================================================
 * device preferences
 *
 * NOT part of the save. Whether this phone makes noise is a fact about the
 * phone, not about the island: it must survive Empezar de nuevo, and it must
 * NOT travel inside an exported .json to somebody else's device. So it lives in
 * localStorage beside the save rather than in GameState.
 * ======================================================================= */

interface Prefs {
  /** The whole synthesised bus in sfx.ts. */
  sfx: boolean;
  /** navigator.vibrate, where the platform has it. */
  haptics: boolean;
}

const PREFS_KEY = 'la-leyenda:prefs';

function loadPrefs(): Prefs {
  const fallback: Prefs = { sfx: true, haptics: true };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      sfx: typeof parsed.sfx === 'boolean' ? parsed.sfx : true,
      haptics: typeof parsed.haptics === 'boolean' ? parsed.haptics : true,
    };
  } catch {
    // A browser that refuses storage still gets a working game with sound on.
    return fallback;
  }
}

const prefs: Prefs = loadPrefs();

function storePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.warn('[settings] could not store preferences', err);
  }
}

/* ==========================================================================
 * making the switches REAL
 *
 * ✎ SEAM, and the one piece of this file that should not live here forever.
 *
 * `sfx.ts` exports `sfx()` and `unlockAudio()` and nothing else: its context,
 * its bus and its `muted` flag are module-private, so there is no exported way
 * to silence it. `navigator.vibrate` is likewise called directly from seven
 * modules (dom, pill, toast, celebrate, buildBar, hud, islandScene). A switch
 * that flipped a boolean nobody reads is exactly the dead control this panel
 * exists to avoid, so both channels are tapped at their one shared choke point
 * instead.
 *
 * Audio: every AudioContext the page constructs gets a master gain spliced in
 * front of its destination, and `destination` is shadowed so the bus in sfx.ts
 * connects to the gain without knowing it. Installed at module scope because it
 * has to beat the first pointerdown — sfx.ts creates its context lazily from
 * that event, and a context made before the tap would never be routed.
 *
 * When sfx.ts grows a `setMuted(on: boolean)`, delete `tapAudio` and
 * `applyAudio`, import it, and nothing else in this file changes.
 * ======================================================================= */

/** Every master gain spliced in front of a real destination. */
const audioOutputs = new Set<GainNode>();

function tapAudio(): void {
  if (typeof window === 'undefined') return;
  const globals = window as unknown as Record<string, unknown>;
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Native = globals[name];
    if (typeof Native !== 'function') continue;
    const Ctor = Native as new (...args: unknown[]) => AudioContext;

    const Tapped = function (this: unknown, ...args: unknown[]): AudioContext {
      const ctx = new Ctor(...args);
      try {
        const master = ctx.createGain();
        master.gain.value = prefs.sfx ? 1 : 0;
        // Read the REAL destination before shadowing it, or the gain connects
        // to itself and the game goes silent for good.
        master.connect(ctx.destination);
        Object.defineProperty(ctx, 'destination', { value: master, configurable: true });
        audioOutputs.add(master);
      } catch (err) {
        // Worst case the tap is absent and the switch cannot silence this
        // context. The game still plays; it says so in the console rather than
        // taking the audio down with it.
        console.warn('[settings] could not tap the audio bus', err);
      }
      return ctx;
    };
    Tapped.prototype = Ctor.prototype;
    globals[name] = Tapped;
  }
}

function applyAudio(): void {
  for (const master of audioOutputs) {
    // A hard jump to zero mid-note is an audible click. A 10ms time constant
    // settles in about 30ms — heard as the sound ending, not as a fade.
    try {
      master.gain.setTargetAtTime(prefs.sfx ? 1 : 0, master.context.currentTime, 0.01);
    } catch {
      master.gain.value = prefs.sfx ? 1 : 0;
    }
  }
}

/**
 * True only where the platform actually vibrates.
 *
 * `navigator.vibrate` is undefined on iOS Safari and in every iOS webview, so
 * the row is not drawn there at all rather than drawn and dead. Where it does
 * exist, the real function is wrapped so every `navigator.vibrate?.(…)` in the
 * game obeys the switch without knowing there is one.
 */
function tapHaptics(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
  const native = nav.vibrate;
  if (typeof native !== 'function') return false;
  try {
    const bound = native.bind(nav);
    Object.defineProperty(nav, 'vibrate', {
      configurable: true,
      writable: true,
      value: (pattern: number | number[]) => (prefs.haptics ? bound(pattern) : true),
    });
    return true;
  } catch (err) {
    console.warn('[settings] could not tap navigator.vibrate', err);
    return false;
  }
}

tapAudio();
const HAPTICS = tapHaptics();

/* ==========================================================================
 * copy — es-ES, and it stays in this module (house rule: never copy.ts)
 * ======================================================================= */

const COPY = {
  heading: 'Ajustes',
  close: 'Cerrar',
  captain: (name: string) => `Capitán ${name}`,
  noCaptain: 'Sin partida empezada',
  /** §3.5 — a control that cannot act still says why. */
  noGame: 'Disponible cuando tengas una isla empezada.',

  /* --- sonido --- */
  audio: 'Sonido',
  sfxLabel: 'Efectos',
  sfxHint: 'Cañonazos, monedas, obras terminadas y el toque de cada botón.',
  hapticsLabel: 'Vibración',
  hapticsHint: 'Un pulso corto al tocar y uno doble cuando algo se rechaza.',

  /* --- partida --- */
  game: 'Partida',
  saveNow: 'Guardar ahora',
  saveNowHint: 'Escribe la partida en este dispositivo. El juego ya guarda solo cada poco.',
  saveNowGo: 'Guardar',
  saveDone: 'Guardado en este dispositivo.',
  saveFailed: 'No se pudo guardar.',

  exportLabel: 'Exportar copia',
  exportHint: 'Descarga tu isla como archivo. Es la única copia que existe: aquí no hay servidor.',
  exportGo: 'Exportar',
  exportDone: 'Archivo descargado.',

  importLabel: 'Importar copia',
  importHint: 'Carga una isla desde un archivo exportado.',
  importGo: 'Importar',
  importDone: 'Isla cargada.',
  importFailed: 'Ese archivo no es una partida de La Leyenda.',

  /* Two steps, and the first one is a wall of text on purpose. */
  importWarn: 'Importar sustituye tu isla',
  importWarnBody: (who: string | null) =>
    who
      ? `Todo lo que tiene ${who} — edificios, niveles, recursos y mejoras en marcha — se borra, y en su lugar queda lo que traiga el archivo.`
      : 'La isla del archivo pasará a ser tu partida en este dispositivo.',
  importWarnTip: 'Exporta antes una copia si quieres conservar esta isla.',
  importPick: 'Elegir archivo',

  importReady: 'Confirma la sustitución',
  importReadyBody: (file: string) => `Se cargará ${file} y tu isla actual desaparecerá.`,
  importGoNow: 'Sustituir mi isla',

  /* --- zona de peligro --- */
  danger: 'Zona de peligro',
  reset: 'Empezar de nuevo',
  resetHint: 'Borra esta isla y empieza una partida desde cero.',
  resetGo: 'Borrar',
  resetDone: 'Isla borrada.',
  resetFailed: 'No se pudo borrar.',
  resetWarn: (who: string | null) =>
    who ? `Vas a borrar la isla de ${who}` : 'Vas a borrar tu isla',
  resetLoses: [
    'Todos los edificios y todos sus niveles.',
    'El oro, la madera, el metal y el ron guardados.',
    'Las mejoras, los cofres y los temporizadores en marcha.',
    'Las misiones, la racha diaria y tu capitán.',
  ],
  resetFinal: 'No hay copia en ningún servidor. Esto no se puede deshacer.',
  resetYes: 'Sí, borrar todo',
  cancel: 'Cancelar',

  /* --- créditos --- */
  credits: 'Créditos',
  gameName: 'La Leyenda Pirata',
  /** Stores want it and it costs nothing. `title.ts` carries its own copy of
   *  this string — a screen's copy lives in that screen's module. */
  version: 'v0.1.0',
  madeWith: 'Un juego de piratas para el móvil, hecho con arte de dominio público.',
  licenceOpen: 'Ver el aviso de licencia MIT',
  licenceClose: 'Ocultar el aviso de licencia',
  licenceNote: 'Texto original en inglés, como exige la licencia.',
} as const;

/**
 * The attributions we owe, and they are checked rather than remembered — a
 * wrong licence line is a store rejection (ROADMAP.md round 11 §8).
 *
 *  · The ART is CC0-1.0 — public domain, no attribution REQUIRED, credited
 *    anyway because it is the right thing and it costs four lines. It must
 *    never be described as MIT: that is a different repository.
 *  · The CLIENT is MIT, and ROADMAP.md is explicit that "its notice travels
 *    with anything adapted from it". `reference/CLIENT_NOTES.md` records the
 *    copyright line to carry. Nothing here is a port — camera, light and water
 *    values were measured off it — but the notice is carried regardless,
 *    because carrying one you did not need costs nothing and omitting one you
 *    did is the rejection.
 *  · The commercial Asset Store packages bundled inside that client are off
 *    limits and none of them is here, so none of them is credited.
 *  · The dobo_ui pack may be USED and REWORKED but NOT REDISTRIBUTED, which is
 *    why `tools/uipack/` and `public/assets/ui/` are gitignored. The line below
 *    states the licence we hold rather than claiming what is in this build,
 *    because the artwork is optional and may be absent (see `src/ui/pack.ts`).
 */
const CREDITS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Modelos y arte 3D',
    body:
      'Pirate Nation Art, de Proof of Play, Inc. (proofofplay/piratenation-art). ' +
      // "CC0" alone is a trap in this typeface: photographed at 8x, Lilita
      // One's zero is indistinguishable from its O, so the line read "CCO 1.0".
      // A licence name nobody can read is not an attribution, hence the gloss.
      'Publicado bajo CC0 1.0 Universal (Creative Commons Zero): dominio público.',
  },
  {
    title: 'Cámara, luz y agua',
    body:
      'Calibradas a partir del cliente de Pirate Nation (proofofplay/piratenation-game), ' +
      'publicado bajo licencia MIT. Copyright (c) 2026 Proof of Play, Inc.',
  },
  {
    title: 'Motor 3D',
    body: 'three.js, bajo licencia MIT. Copyright © 2010-2024 three.js authors.',
  },
  {
    title: 'Tipografías',
    body: 'Lilita One y Fredoka, bajo SIL Open Font License 1.1 (openfontlicense.org).',
  },
  {
    title: 'Adornos de interfaz',
    body:
      'Vector UI Pack, de Duplo (itch.io · dobo_ui). Con licencia para usarlo y ' +
      'reelaborarlo; el paquete original no se redistribuye.',
  },
];

/**
 * The MIT permission notice, verbatim and in English.
 *
 * Deliberately NOT translated. Every other string in this file is es-ES, but a
 * licence is satisfied by the text it names, and a Spanish paraphrase of the
 * MIT notice satisfies nothing. It is labelled in Spanish and reproduced in
 * English, which is what a store reviewer expects to find.
 */
const MIT_NOTICE = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this ' +
    'software and associated documentation files (the "Software"), to deal in the Software ' +
    'without restriction, including without limitation the rights to use, copy, modify, merge, ' +
    'publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons ' +
    'to whom the Software is furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all copies or ' +
    'substantial portions of the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, ' +
    'INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR ' +
    'PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE ' +
    'FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR ' +
    'OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER ' +
    'DEALINGS IN THE SOFTWARE.',
] as const;

/* ==========================================================================
 * options
 * ======================================================================= */

export interface SettingsPanelOptions {
  onClose(): void;
  /** Null when Ajustes was opened from the title and there is no game yet. */
  onSave?: (() => Promise<void> | void) | null;
  onExport?: (() => void) | null;
  onImport?: ((file: Blob) => Promise<void> | void) | null;
  onReset?: (() => Promise<void> | void) | null;
  /** Shown under the heading so a player can see whose island this is. */
  captainName?: string | null;
}

export interface SettingsPanel {
  readonly el: HTMLElement;
  dispose(): void;
}

/* ==========================================================================
 * pieces
 * ======================================================================= */

/**
 * The switch, carrying §0.2's four layers like every other raised object: an
 * ink contour on the track, a hard gloss STEP across it, a warm rim on the top
 * inner edge, and a lip plus a zero-x extrusion. The knob is a second such
 * object riding on the first — which is what makes it read as a physical
 * latch rather than as a web toggle.
 */
function makeSwitch(label: string, initial: boolean, onChange: (on: boolean) => void): HTMLElement {
  const knob = el('span', 'swt__knob');
  const node = el('button', 'swt', knob);
  node.type = 'button';
  node.setAttribute('role', 'switch');
  node.setAttribute('aria-label', label);

  let on = initial;
  const paint = (): void => {
    node.classList.toggle('is-on', on);
    node.setAttribute('aria-checked', on ? 'true' : 'false');
  };
  paint();

  pressable(node, () => {
    on = !on;
    paint();
    onChange(on);
  });
  return node;
}

/* ==========================================================================
 * the panel
 * ======================================================================= */

export function createSettingsPanel(opts: SettingsPanelOptions): SettingsPanel {
  /**
   * ✎ A capture knob, not a product feature — `?panel=` is forwarded to the
   * page by `tools/shoot.mjs` ("any --key value pair the harness does not
   * consume itself is forwarded to the scene"), and it is read ONLY under
   * `shot=1`. Two states of this panel are otherwise unphotographable: a
   * confirmation that exists after two taps, and the no-island face, which the
   * router never produces under a capture because it makes a game first.
   *
   *   npm run shoot -- settings --mobile --panel reset
   */
  const knob = SHOT ? new URLSearchParams(location.search).get('panel') : null;

  /** The face Ajustes wears when it was opened from the title with no save. */
  const noGame = knob === 'nogame';
  const onSave = noGame ? null : opts.onSave;
  const onExport = noGame ? null : opts.onExport;
  const onReset = noGame ? null : opts.onReset;

  const who = noGame ? null : opts.captainName ? COPY.captain(opts.captainName) : null;

  /** A titled group: a label on the cream, then a charcoal well of rows. */
  const group = (
    title: string,
    kind: 'plain' | 'danger',
    ...rows: HTMLElement[]
  ): HTMLElement => {
    const well = el('div', 'settings__well', ...rows);
    return el('section', `settings__group settings__group--${kind}`,
      el('h3', 't settings__label', title),
      well);
  };

  /**
   * One row: a name, a line of explanation under it, and one control on the
   * right. The explanation doubles as the row's status line — "Guardado en
   * este dispositivo" replaces the hint rather than appearing beside it, so a
   * row never grows and pushes the rest of the sheet down.
   */
  const row = (
    label: string,
    hint: string,
    control: HTMLElement
  ): { el: HTMLElement; say: (text: string, tone?: 'ok' | 'bad') => void } => {
    const note = el('p', 't t-micro settings__hint',
      (control as HTMLButtonElement).disabled ? COPY.noGame : hint);
    const node = el('div', 'settings__row',
      el('div', 'settings__text', el('p', 't settings__name', label), note),
      control);
    return {
      el: node,
      say(text, tone) {
        note.textContent = text;
        note.classList.toggle('is-ok', tone === 'ok');
        note.classList.toggle('is-bad', tone === 'bad');
      },
    };
  };

  /** The right-hand control of an action row. Null handler → disabled. */
  const goButton = (
    text: string,
    family: 'grey' | 'grey2' | 'red',
    action: (() => void) | null
  ): HTMLElement => {
    const button = el('button', `btn btn--${family} settings__go`, el('span', 't t-btn', text));
    button.type = 'button';
    button.setAttribute('aria-label', text);
    if (action) pressable(button, action);
    else button.disabled = true;
    return button;
  };

  /* --- sonido ------------------------------------------------------------ */

  const audioRows: HTMLElement[] = [];

  audioRows.push(
    row(COPY.sfxLabel, COPY.sfxHint,
      makeSwitch(COPY.sfxLabel, prefs.sfx, (on) => {
        prefs.sfx = on;
        applyAudio();
        storePrefs();
      })).el
  );

  // Not drawn at all where the platform has no vibration motor to drive.
  if (HAPTICS) {
    audioRows.push(
      row(COPY.hapticsLabel, COPY.hapticsHint,
        makeSwitch(COPY.hapticsLabel, prefs.haptics, (on) => {
          prefs.haptics = on;
          storePrefs();
          // Confirm the switch with the thing it switches — the one honest
          // preview of a haptic there is.
          if (on) navigator.vibrate?.(12);
        })).el
    );
  }

  /* --- partida ----------------------------------------------------------- */

  const saveRow = row(COPY.saveNow, COPY.saveNowHint,
    goButton(COPY.saveNowGo, 'grey', onSave
      ? () => {
          void Promise.resolve(onSave()).then(
            () => saveRow.say(COPY.saveDone, 'ok'),
            (err) => { console.error('[settings] save failed', err); saveRow.say(COPY.saveFailed, 'bad'); }
          );
        }
      : null));

  const exportRow = row(COPY.exportLabel, COPY.exportHint,
    goButton(COPY.exportGo, 'grey', onExport
      ? () => { onExport(); exportRow.say(COPY.exportDone, 'ok'); }
      : null));

  /* Import — two deliberate steps, because it destroys an island.
   *
   * A file picker is not a confirmation: it is a system dialog the player can
   * reach by accident and dismiss without reading. So the warning comes FIRST,
   * naming whose island is about to go, and the picker only opens from a
   * button inside that warning. Choosing a file then raises a second block
   * naming the file, and only THAT button imports. */
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.className = 'settings__file';

  // Import stays live with no island: it is the recovery path a player with a
  // backup and a wiped phone takes, and main.ts adopts the file straight into
  // the store when there is nothing to import INTO.
  const importRow = row(COPY.importLabel, COPY.importHint,
    goButton(COPY.importGo, 'grey', opts.onImport ? () => openImportWarning() : null));

  const importConfirm = el('div', 'settings__confirm settings__confirm--warn');
  importConfirm.hidden = true;

  function closeConfirms(): void {
    importConfirm.hidden = true;
    resetConfirm.hidden = true;
    importConfirm.classList.remove('settings__confirm--danger');
    importConfirm.replaceChildren();
    resetConfirm.replaceChildren();
  }

  /**
   * A card raised at the bottom of a scrolled sheet is a card whose buttons are
   * below the fold — which is exactly where the reset confirmation landed the
   * first time it was photographed. Bring its FOOT into view, because the
   * buttons are the part that has to be reachable.
   */
  function reveal(card: HTMLElement): void {
    requestAnimationFrame(() => {
      card.scrollIntoView({ block: 'end', behavior: SHOT ? 'auto' : 'smooth' });
    });
  }

  /** Step one: what importing costs, before a picker is anywhere near. */
  function openImportWarning(): void {
    closeConfirms();
    importConfirm.hidden = false;
    importConfirm.replaceChildren(
      el('p', 't t-caption confirm__title', COPY.importWarn),
      el('p', 't t-body confirm__body', COPY.importWarnBody(who)),
      el('p', 't t-micro confirm__tip', COPY.importWarnTip),
      el('div', 'confirm__acts',
        goButton(COPY.cancel, 'grey2', () => closeConfirms()),
        goButton(COPY.importPick, 'red', () => file.click()))
    );
    reveal(importConfirm);
  }

  /** Step two: the file is chosen, named, and still not loaded. The hazard
   *  striping arrives with it — the escalation is visible, not only worded. */
  function openImportConfirm(chosen: File): void {
    importConfirm.hidden = false;
    importConfirm.classList.add('settings__confirm--danger');
    importConfirm.replaceChildren(
      el('p', 't t-caption confirm__title', COPY.importReady),
      el('p', 't t-body confirm__body', COPY.importReadyBody(chosen.name)),
      el('div', 'confirm__acts',
        goButton(COPY.cancel, 'grey2', () => { file.value = ''; closeConfirms(); }),
        goButton(COPY.importGoNow, 'red', () => {
          closeConfirms();
          void Promise.resolve(opts.onImport?.(chosen)).then(
            () => importRow.say(COPY.importDone, 'ok'),
            (err) => {
              console.error('[settings] import failed', err);
              importRow.say(COPY.importFailed, 'bad');
            }
          );
          file.value = '';
        }))
    );
    reveal(importConfirm);
  }

  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    openImportConfirm(chosen);
  });

  /* --- zona de peligro ---------------------------------------------------- */

  const resetConfirm = el('div', 'settings__confirm settings__confirm--danger');
  resetConfirm.hidden = true;

  const resetRow = row(COPY.reset, COPY.resetHint,
    goButton(COPY.resetGo, 'red', onReset ? () => openResetConfirm() : null));

  /**
   * Two steps, and the second one lists what is lost item by item.
   *
   * The stub spent the confirmation on the button's own label — "¿Seguro? Toca
   * otra vez" — which is one tap away from a destroyed island by a finger that
   * bounced. This is a separate object, in a separate place on the screen, with
   * the destructive verb on the RIGHT and Cancelar under the thumb that just
   * pressed Borrar.
   */
  function openResetConfirm(): void {
    closeConfirms();
    resetConfirm.hidden = false;
    resetConfirm.replaceChildren(
      el('p', 't t-caption confirm__title', COPY.resetWarn(who)),
      el('ul', 'confirm__list',
        ...COPY.resetLoses.map((line) => el('li', 't t-body confirm__item', line))),
      el('p', 't t-body confirm__final', COPY.resetFinal),
      el('div', 'confirm__acts',
        goButton(COPY.cancel, 'grey2', () => closeConfirms()),
        goButton(COPY.resetYes, 'red', () => {
          closeConfirms();
          void Promise.resolve(onReset?.()).then(
            () => resetRow.say(COPY.resetDone, 'ok'),
            (err) => { console.error('[settings] reset failed', err); resetRow.say(COPY.resetFailed, 'bad'); }
          );
        }))
    );
    reveal(resetConfirm);
  }

  /* --- créditos ----------------------------------------------------------- */

  const licenceBody = el('div', 'settings__licence',
    ...MIT_NOTICE.map((para) => el('p', 'settings__licence-p', para)),
    el('p', 't t-micro settings__licence-note', COPY.licenceNote));
  licenceBody.hidden = true;

  const licenceToggle = el('button', 'btn btn--grey2 settings__licence-btn',
    el('span', 't t-btn', COPY.licenceOpen));
  licenceToggle.type = 'button';
  pressable(licenceToggle, () => {
    const open = licenceBody.hidden;
    licenceBody.hidden = !open;
    licenceToggle.replaceChildren(
      el('span', 't t-btn', open ? COPY.licenceClose : COPY.licenceOpen));
  });

  const creditsGroup = el('section', 'settings__group settings__group--credits',
    el('h3', 't settings__label', COPY.credits),
    el('div', 'settings__well',
      el('div', 'settings__stamp',
        el('p', 't settings__stamp-name', COPY.gameName),
        el('p', 'num settings__stamp-version', COPY.version)),
      el('p', 't t-micro settings__stamp-line', COPY.madeWith),
      ...CREDITS.map((entry) =>
        el('div', 'settings__credit',
          el('p', 't settings__credit-title', entry.title),
          el('p', 't t-micro settings__credit-body', entry.body))),
      licenceToggle,
      licenceBody));

  /* --- the shell ---------------------------------------------------------- */

  const close = el('button', 'btn btn--red btn-x settings__x', markX('settings__x-mark'));
  close.type = 'button';
  close.setAttribute('aria-label', COPY.close);
  pressable(close, opts.onClose);

  const scrim = el('div', 'settings__scrim');
  // pointerdown rather than click: the island behind is listening for taps and
  // a click that started on the scrim must not also reach it.
  scrim.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    opts.onClose();
  });

  const body = el('div', 'settings__body',
    group(COPY.audio, 'plain', ...audioRows),
    group(COPY.game, 'plain', saveRow.el, exportRow.el, importRow.el, importConfirm, file),
    group(COPY.danger, 'danger', resetRow.el, resetConfirm),
    creditsGroup);

  // A list that continues past the fold has to say so, and only when it does:
  // the same cue the build sheet uses, driven off the real scroll extent rather
  // than left on permanently (which would fade the last row of a short list).
  const fade = el('div', 'settings__fade');

  const sheet = el('div', 'settings__sheet',
    el('header', 'settings__head',
      el('h2', 't t-title settings__title', COPY.heading),
      el('p', 't t-micro settings__who', who ?? COPY.noCaptain)),
    body,
    fade,
    close);

  const root = el('div', 'settings layer-page', scrim, sheet);

  const syncScroll = (): void => {
    const more = body.scrollTop + body.clientHeight < body.scrollHeight - 2;
    sheet.classList.toggle('can-scroll', more);
  };
  body.addEventListener('scroll', syncScroll, { passive: true });
  // After layout, or the body has no scrollHeight to compare against yet.
  requestAnimationFrame(syncScroll);

  // Desktop courtesy; the phone closes with the X or the backdrop.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') opts.onClose();
  };
  document.addEventListener('keydown', onKey);

  // The capture knob declared at the top of this function, applied once the
  // sheet exists. Each branch drives the SAME entry point a finger drives.
  if (knob === 'reset' && onReset) openResetConfirm();
  if (knob === 'import' && opts.onImport) openImportWarning();
  if (knob === 'credits') {
    licenceBody.hidden = false;
    licenceToggle.replaceChildren(el('span', 't t-btn', COPY.licenceClose));
    // Applied after layout, or the sheet has no scroll height yet.
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  }

  return {
    el: root,
    dispose() {
      document.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
