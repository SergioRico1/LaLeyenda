import './captain.css';
import { Rng } from '../../core/rng';
import {
  AVATAR_SLOTS, NAME_MAX, rollLook, rollName, sanitizeName, slotOptions,
  type AvatarSlot, type Captain, type CaptainLook,
} from '../../sim';
import { el, pressable } from '../components/dom';

/**
 * captain.ts — PLAN.md Fase 4's modular avatar, as the screen that builds one.
 *
 * The panel edits a `Captain` and hands the finished one back. It never learns
 * what a part IS: the option lists come from the sim, the values they hold are
 * model ids, and the only thing this file adds is a Spanish word for each and a
 * picture of it (baked by render/avatar.ts and handed in through `setSwatches`).
 *
 * The shape is Clash's, not a form's:
 *
 *   · seven CATEGORIES on a rail, one open at a time, so the screen never shows
 *     more than one decision;
 *   · that category's options as a row of SWATCHES, each drawn as itself, so
 *     choosing is looking rather than reading;
 *   · one tap swaps the part on the live captain — no confirm, no reload;
 *   · the name is a nameplate under the captain, filled in with a rolled name so
 *     nobody is ever stopped by an empty field;
 *   · two decisions at the bottom, in the thumb zone, and the green one is the
 *     bigger of the two.
 *
 * `‹ value ›` arrow rows were the first version and are gone deliberately:
 * seven rows of Spanish adjectives make the player tap 43 times to find out
 * what any of the options are, which is the exact opposite of a creator.
 */

const COPY = {
  heading: 'Tu capitán',
  sub: 'Así te conocerán en los siete mares.',
  namePlaceholder: 'Nombre de capitán',
  nameLabel: 'Nombre del capitán',
  reroll: 'Otro nombre',
  surprise: 'Sorpréndeme',
  confirm: '¡A navegar!',
  back: 'Volver',
  hatCoversHair: 'El sombrero lo tapa',
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

/** A picture of one option, once render/avatar.ts has drawn them. */
export type SwatchLookup = (slot: AvatarSlot, id: string | null) => string | undefined;

export interface CaptainPanelOptions {
  /** The captain the screen opens on — normally one rolled from a seed, so a
   *  player who taps straight through still leaves with a real pirate. */
  captain: Captain;
  /** Fired on every swatch, every roll and every keystroke. */
  onChange?(captain: Captain): void;
  onConfirm(captain: Captain): void;
  onBack?(): void;
  /** Which category the rail opens on. Capture-only knob (`?tab=`), so every
   *  row can be reviewed as pixels; the player always lands on the hat. */
  openSlot?: AvatarSlot;
}

export interface CaptainPanel {
  readonly el: HTMLElement;
  /** The transparent box the 3D avatar stands in — also the turntable's handle. */
  readonly stage: HTMLElement;
  /** The draft as it stands. */
  captain(): Captain;
  /** Hands over the baked option pictures; the open row redraws itself. */
  setSwatches(lookup: SwatchLookup): void;
  dispose(): void;
}

export function createCaptainPanel(opts: CaptainPanelOptions): CaptainPanel {
  let look: CaptainLook = opts.captain.look;
  let name = opts.captain.name;
  let open: AvatarSlot = opts.openSlot ?? 'hat';
  let swatchArt: SwatchLookup = () => undefined;

  const draft = (): Captain => ({ name: sanitizeName(name), seed: opts.captain.seed, look });
  const changed = (): void => opts.onChange?.(draft());

  // The UI is allowed a clock; the SIM is not. So the seed is made here and the
  // roll itself is the sim's, which is what keeps "sorpréndeme" and the captain
  // a new save is born with the same function.
  const freshRng = (): Rng => new Rng(`surprise:${Date.now()}:${Math.random()}`);

  /* --- where the captain stands ----------------------------------------- */
  // Transparent and empty: the 3D captain is behind it. It carries the
  // turntable's pointer handlers (captainScene) and nothing else.
  const stage = el('div', 'captain__stage');

  /* --- the nameplate ----------------------------------------------------- */

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
  // Nobody leaves this screen nameless, and nobody is told off for it either:
  // an empty field refills itself with a real name the moment it loses focus.
  field.addEventListener('blur', () => {
    if (field.value.trim()) return;
    name = rollName(freshRng());
    field.value = name;
    changed();
  });

  const dice = el('button', 'captain__dice', el('span', 't t-glyph', '⟳'));
  dice.type = 'button';
  dice.setAttribute('aria-label', COPY.reroll);
  pressable(dice, () => {
    name = rollName(freshRng());
    field.value = name;
    changed();
  });

  const nameplate = el('div', 'captain__plate', field, dice);

  /* --- the category rail ------------------------------------------------- */

  const tabs = new Map<AvatarSlot, HTMLElement>();
  const rail = el('div', 'captain__rail');
  rail.setAttribute('role', 'tablist');
  for (const slot of AVATAR_SLOTS) {
    const tab = el('button', 'captain__tab', el('span', 't captain__tabtext', SLOT_LABEL[slot]));
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-label', SLOT_LABEL[slot]);
    pressable(tab, () => {
      if (open === slot) return;
      open = slot;
      paint();
    });
    tabs.set(slot, tab);
    rail.append(tab);
  }

  /* --- the swatch row ---------------------------------------------------- */

  const caption = el('span', 't t-body captain__caption');
  const hint = el('span', 't t-micro captain__hint');
  const row = el('div', 'captain__row');
  const tray = el('div', 'captain__tray', el('div', 'captain__now', caption, hint), row);

  /**
   * One tap, one visible change.
   *
   * Choosing a hair with a hat on takes the hat off. Every hat in the library
   * encloses the skull, so the pair is never drawn (render/avatar.ts) — and a
   * tap that changes something the player cannot see is a tap they will assume
   * is broken. Taking the hat off is the honest reading of "I want this hair".
   */
  function choose(slot: AvatarSlot, id: string | null): void {
    const next: CaptainLook = { ...look, [slot]: id };
    if (slot === 'hair' && next.hat) next.hat = null;
    look = next;
    paint();
    changed();
  }

  function paintRow(): void {
    row.replaceChildren();
    const options = slotOptions(open);
    for (const id of options) {
      const selected = look[open] === id;
      const swatch = el('button', `captain__sw${selected ? ' is-on' : ''}`);
      swatch.type = 'button';
      swatch.setAttribute('aria-label', `${SLOT_LABEL[open]} · ${partLabel(open, id)}`);
      swatch.setAttribute('aria-pressed', String(selected));

      const art = id ? swatchArt(open, id) : undefined;
      if (!id) {
        // "None" is a choice the player scrolls to, and it earns a shape of its
        // own: a picture of a face with no beard on it looks like every other
        // beard swatch at 74px.
        swatch.classList.add('captain__sw--none');
        swatch.append(el('span', 't t-glyph captain__novalue', '✕'));
      } else if (art) {
        const image = document.createElement('img');
        image.className = 'captain__art';
        image.alt = '';
        image.decoding = 'sync';
        image.src = art;
        swatch.append(image);
      } else {
        // The bake has not landed yet (or could not run at all). A short word
        // is a worse swatch than a picture, but it is still a choice the player
        // can make, which an empty tile is not.
        swatch.append(el('span', 't t-micro captain__fallback', partLabel(open, id)));
      }
      if (selected) swatch.append(el('span', 't t-glyph captain__tick', '✓'));

      pressable(swatch, () => choose(open, id));
      row.append(swatch);
    }

    // Keep the current choice on screen when a row is longer than the phone.
    const selectedNode = row.querySelector('.is-on') as HTMLElement | null;
    if (selectedNode) {
      row.scrollLeft = Math.max(0, selectedNode.offsetLeft - row.clientWidth / 2 + selectedNode.offsetWidth / 2);
    }
  }

  function paint(): void {
    for (const [slot, tab] of tabs) tab.classList.toggle('is-on', slot === open);
    caption.textContent = `${SLOT_LABEL[open]} · ${partLabel(open, look[open])}`;
    hint.textContent = open === 'hair' && look.hat ? COPY.hatCoversHair : '';
    // §3.19: the active tab scrolls itself into view. Done by hand rather than
    // with scrollIntoView, which walks up and scrolls every ancestor it can —
    // including a full-screen page that is not supposed to move at all.
    const active = tabs.get(open);
    if (active) {
      rail.scrollLeft = Math.max(0, active.offsetLeft - rail.clientWidth / 2 + active.offsetWidth / 2);
    }
    paintRow();
  }

  /* --- the two decisions ------------------------------------------------- */

  const surprise = el('button', 'btn btn--grey captain__surprise',
    el('span', 't t-btn', COPY.surprise));
  surprise.type = 'button';
  surprise.setAttribute('aria-label', COPY.surprise);
  pressable(surprise, () => {
    const rng = freshRng();
    look = rollLook(rng);
    if (!field.value.trim()) { name = rollName(rng); field.value = name; }
    paint();
    changed();
  });

  const confirm = el('button', 'btn btn--green captain__confirm',
    el('span', 't t-btn', COPY.confirm));
  confirm.type = 'button';
  confirm.setAttribute('aria-label', COPY.confirm);
  pressable(confirm, () => {
    if (!field.value.trim()) { name = rollName(freshRng()); field.value = name; }
    opts.onConfirm(draft());
  });

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
    nameplate,
    el('div', 'captain__sheet',
      rail,
      tray,
      el('div', 'captain__cta', surprise, confirm)));

  paint();

  return {
    el: root,
    stage,
    captain: draft,
    setSwatches(lookup) {
      swatchArt = lookup;
      paintRow();
    },
    dispose() { root.remove(); },
  };
}
