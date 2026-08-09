import './captain.css';
import { Rng } from '../../core/rng';
import {
  AVATAR_SLOTS, NAME_MAX, cycleSlot, rollLook, rollName, sanitizeName,
  type AvatarSlot, type Captain, type CaptainLook,
} from '../../sim';
import { el, pressable } from '../components/dom';

/**
 * captain.ts — PLAN.md Fase 4's modular avatar, as the screen that builds one.
 *
 * The panel edits a `Captain` and hands the finished one back. It never learns
 * what a part IS: `cycleSlot` comes from the sim, the value it produces is a
 * model id, and the only thing this file adds is a Spanish word for it.
 *
 * ✎ SEAM. This is a working editor, not a beautiful one. What is settled:
 *
 *   · the panel owns the draft and reports every change through `onChange`, so
 *     the 3D preview can follow the arrows without owning the state;
 *   · `.captain__stage` is an EMPTY, transparent box reserved at the top of the
 *     screen — the avatar stands there, and the layout already leaves room for
 *     it, so adding the model does not move a single control;
 *   · the copy is here, in es-ES, and every part in the library has a word.
 *
 * What is deliberately not here: the avatar itself. Rendering seven rigged GLBs
 * as one body is the next builder's whole job, and a placeholder that draws at
 * the wrong scale would fail the shot harness's size guard for everyone.
 */

const COPY = {
  heading: 'Tu capitán',
  sub: 'Así te conocerán en los siete mares.',
  namePlaceholder: 'Nombre de capitán',
  nameLabel: 'Nombre',
  surprise: 'Sorpréndeme',
  confirm: '¡A navegar!',
  back: 'Volver',
  prev: 'Anterior',
  next: 'Siguiente',
} as const;

const SLOT_LABEL: Record<AvatarSlot, string> = {
  body: 'Piel',
  hair: 'Pelo',
  beard: 'Barba',
  eyes: 'Ojos',
  hat: 'Sombrero',
  top: 'Torso',
  bottom: 'Piernas',
};

/** What an empty optional slot is called, per slot, so the gender agrees. */
const NONE_LABEL: Partial<Record<AvatarSlot, string>> = {
  beard: 'Sin barba',
  eyes: 'Sin nada',
  hat: 'Sin sombrero',
};

/** Every id in the library, in Spanish. A part with no entry here falls back to
 *  its own suffix, so a new model shows up as something readable rather than
 *  as a blank row. */
const PART_LABEL: Record<string, string> = {
  av_body_pale: 'Pálida', av_body_tan: 'Morena', av_body_dark: 'Oscura',

  av_hair_short: 'Corto', av_hair_long: 'Largo', av_hair_blonde: 'Rubio',
  av_hair_ginger: 'Pelirrojo', av_hair_grey: 'Canoso', av_hair_dreads: 'Rastas',
  av_hair_blue: 'Azul', av_hair_kelp: 'Alga',

  av_beard_goatee: 'Perilla', av_beard_full: 'Poblada', av_beard_braided: 'Trenzada',
  av_beard_fumanchu: 'Fumanchú', av_beard_ginger: 'Pelirroja', av_beard_grey: 'Canosa',

  av_eyes_patch: 'Parche', av_eyes_shades: 'Gafas de sol',
  av_eyes_monocle: 'Monóculo', av_eyes_goggles: 'Antiparras',

  av_hat_bandana: 'Bandana', av_hat_captain: 'Bicornio', av_hat_straw: 'Paja',
  av_hat_tophat: 'Chistera', av_hat_skull: 'Calavera', av_hat_crown: 'Corona',
  av_hat_voodoo: 'Vudú', av_hat_wizard: 'Brujo',

  av_top_coat_red: 'Casaca roja', av_top_coat_green: 'Casaca verde', av_top_vest: 'Chaleco',
  av_top_tee: 'Camiseta', av_top_ruffle: 'Chorreras', av_top_strap: 'Bandolera',
  av_top_armor: 'Coraza', av_top_bones: 'Huesos',

  av_bottom_brown: 'Marrón', av_bottom_black: 'Negro', av_bottom_striped: 'Rayas',
  av_bottom_royal: 'Bombachos', av_bottom_tiger: 'Tigre', av_bottom_bones: 'Huesos',
};

function partLabel(slot: AvatarSlot, id: string | null): string {
  if (!id) return NONE_LABEL[slot] ?? 'Ninguno';
  return PART_LABEL[id] ?? id.replace(`av_${slot}_`, '').replace(/_/g, ' ');
}

export interface CaptainPanelOptions {
  /** The captain the screen opens on — normally one rolled from a seed, so a
   *  player who taps straight through still leaves with a real pirate. */
  captain: Captain;
  /** Fired on every arrow, every roll and every keystroke. */
  onChange?(captain: Captain): void;
  onConfirm(captain: Captain): void;
  onBack?(): void;
}

export interface CaptainPanel {
  readonly el: HTMLElement;
  /** The transparent box the 3D avatar stands in. Reserved, empty, and the
   *  reason the controls do not have to move when the model arrives. */
  readonly stage: HTMLElement;
  /** The draft as it stands. */
  captain(): Captain;
  dispose(): void;
}

export function createCaptainPanel(opts: CaptainPanelOptions): CaptainPanel {
  let look: CaptainLook = opts.captain.look;
  let name = opts.captain.name;

  const draft = (): Captain => ({ name: sanitizeName(name), seed: opts.captain.seed, look });
  const changed = (): void => opts.onChange?.(draft());

  /* --- the avatar's box, empty on purpose ------------------------------- */
  const stage = el('div', 'captain__stage');

  /* --- the name --------------------------------------------------------- */
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 't t-btn captain__name';
  field.value = name;
  field.maxLength = NAME_MAX;
  field.placeholder = COPY.namePlaceholder;
  field.setAttribute('aria-label', COPY.nameLabel);
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.addEventListener('input', () => { name = field.value; changed(); });

  /* --- one row per slot -------------------------------------------------- */
  const values = new Map<AvatarSlot, HTMLElement>();

  const arrow = (slot: AvatarSlot, delta: number, label: string, glyph: string): HTMLElement => {
    const button = el('button', `btn btn--grey2 captain__arrow captain__arrow--${delta < 0 ? 'l' : 'r'}`,
      el('span', 't t-glyph', glyph));
    button.type = 'button';
    button.setAttribute('aria-label', `${label} · ${SLOT_LABEL[slot]}`);
    pressable(button, () => {
      look = cycleSlot(look, slot, delta);
      paint();
      changed();
    });
    return button;
  };

  const rows = AVATAR_SLOTS.map((slot) => {
    const value = el('span', 't t-body captain__value', partLabel(slot, look[slot]));
    values.set(slot, value);
    return el('div', 'captain__row',
      el('span', 't t-micro captain__slot', SLOT_LABEL[slot]),
      arrow(slot, -1, COPY.prev, '‹'),
      value,
      arrow(slot, +1, COPY.next, '›'));
  });

  function paint(): void {
    for (const slot of AVATAR_SLOTS) {
      const node = values.get(slot);
      if (node) node.textContent = partLabel(slot, look[slot]);
    }
  }

  /* --- the two decisions ------------------------------------------------- */
  const surprise = el('button', 'btn btn--grey captain__surprise',
    el('span', 't t-btn', COPY.surprise));
  surprise.type = 'button';
  surprise.setAttribute('aria-label', COPY.surprise);
  pressable(surprise, () => {
    // The UI is allowed a clock; the SIM is not. So the seed is made here and
    // the roll itself is the sim's, which is what keeps "sorpréndeme" and the
    // captain a new save is born with the same function.
    const rng = new Rng(`surprise:${Date.now()}`);
    look = rollLook(rng);
    if (!field.value.trim()) { name = rollName(rng); field.value = name; }
    paint();
    changed();
  });

  const confirm = el('button', 'btn btn--green captain__confirm',
    el('span', 't t-btn', COPY.confirm));
  confirm.type = 'button';
  confirm.setAttribute('aria-label', COPY.confirm);
  pressable(confirm, () => opts.onConfirm(draft()));

  const back = el('button', 'btn btn--grey2 captain__back', el('span', 't t-micro', COPY.back));
  back.type = 'button';
  back.setAttribute('aria-label', COPY.back);
  if (opts.onBack) pressable(back, opts.onBack);
  else back.hidden = true;

  const root = el('div', 'captain layer-page',
    el('header', 'captain__head',
      back,
      el('h1', 't t-section captain__title', COPY.heading),
      el('p', 't t-micro captain__sub', COPY.sub)),
    stage,
    el('div', 'captain__sheet',
      field,
      el('div', 'captain__rows', ...rows),
      el('div', 'captain__cta', surprise, confirm)));

  return {
    el: root,
    stage,
    captain: draft,
    dispose() { root.remove(); },
  };
}
