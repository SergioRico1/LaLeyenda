import { Rng } from '../core/rng';
import type { AvatarSlot, Captain, CaptainLook } from './types';

/**
 * captain.ts — who the player IS, as pure data.
 *
 * PRODUCTION.md §1: the first run needs a named save, an avatar that appears on
 * the island and at the helm, and the captain's own island seed. All three are
 * decisions, so all three live here rather than in a screen: a name that can be
 * put on a leaderboard, a look that can be replayed from a seed, and the seed
 * itself.
 *
 * **A part is JUST A STRING.** The sim knows `av_hat_captain`; it does not know
 * that behind it there is a .glb, a texture or a bone. The renderer maps the id
 * to `assets/models/<id>.glb` (see render/assets.ts, which already loads every
 * model by exactly that rule), so nothing about the file format can ever reach
 * this file — which is what keeps the whole module testable under node.
 *
 * The tables below are the seven families we have art for, counted off
 * `public/assets/models/av_*` — 43 models. They are written out rather than
 * globbed because the sim cannot read a directory, and because a save holds
 * these strings forever: a part that disappears from the folder has to be
 * caught by `sanitizeLook` rather than silently drawn as nothing.
 */

/** The seven families, in the order the creation screen should stack them. */
export const AVATAR_SLOTS: readonly AvatarSlot[] = [
  'body', 'hair', 'beard', 'eyes', 'hat', 'top', 'bottom',
];

/**
 * The slots a captain may simply not have. Clean-shaven, bare-headed and
 * clear-eyed are all valid pirates; a body, a shirt and a pair of trousers are
 * not optional, because the alternative is a floating head.
 */
export const OPTIONAL_SLOTS: readonly AvatarSlot[] = ['beard', 'eyes', 'hat'];

export const AVATAR_PARTS: Record<AvatarSlot, readonly string[]> = {
  body: ['av_body_pale', 'av_body_tan', 'av_body_dark'],
  hair: [
    'av_hair_short', 'av_hair_long', 'av_hair_blonde', 'av_hair_ginger',
    'av_hair_grey', 'av_hair_dreads', 'av_hair_blue', 'av_hair_kelp',
  ],
  beard: [
    'av_beard_goatee', 'av_beard_full', 'av_beard_braided',
    'av_beard_fumanchu', 'av_beard_ginger', 'av_beard_grey',
  ],
  eyes: ['av_eyes_patch', 'av_eyes_shades', 'av_eyes_monocle', 'av_eyes_goggles'],
  hat: [
    'av_hat_bandana', 'av_hat_captain', 'av_hat_straw', 'av_hat_tophat',
    'av_hat_skull', 'av_hat_crown', 'av_hat_voodoo', 'av_hat_wizard',
  ],
  top: [
    'av_top_coat_red', 'av_top_coat_green', 'av_top_vest', 'av_top_tee',
    'av_top_ruffle', 'av_top_strap', 'av_top_armor', 'av_top_bones',
  ],
  bottom: [
    'av_bottom_brown', 'av_bottom_black', 'av_bottom_striped',
    'av_bottom_royal', 'av_bottom_tiger', 'av_bottom_bones',
  ],
};

export const slotOptional = (slot: AvatarSlot): boolean => OPTIONAL_SLOTS.includes(slot);

/** Every id a slot can hold. An optional slot carries `null` first — "none" is
 *  a choice the player scrolls to, not a state they fall out of. */
export function slotOptions(slot: AvatarSlot): readonly (string | null)[] {
  return slotOptional(slot) ? [null, ...AVATAR_PARTS[slot]] : AVATAR_PARTS[slot];
}

/**
 * Every part actually on a captain, in draw order and with the empty slots
 * dropped. The renderer wants exactly this list and nothing else.
 */
export function looksParts(look: CaptainLook): string[] {
  const parts: string[] = [];
  for (const slot of AVATAR_SLOTS) {
    const id = look[slot];
    if (id) parts.push(id);
  }
  return parts;
}

/* --------------------------------------------------------------------------
 * names
 * ----------------------------------------------------------------------- */

/** Long enough for "Bartolomé el Tuerto", short enough for a leaderboard row. */
export const NAME_MAX = 18;

const GIVEN = [
  'Rafa', 'Bartolomé', 'Inés', 'Malva', 'Diego', 'Lucía', 'Nuno', 'Chispa',
  'Esteban', 'Marina', 'Cuervo', 'Salomé', 'Tobías', 'Rocío', 'Alonso', 'Perla',
];

const EPITHET = [
  'el Tuerto', 'la Roja', 'el Sereno', 'la Sirena', 'el Cañón', 'la Tempestad',
  'el Sin Barba', 'la Corsaria', 'el Salado', 'la Gaviota', 'el Ancla', 'la Brújula',
];

/**
 * The one name a captain always has. Empty, blank or absurd input becomes a
 * real name rather than a refusal: this is the first thing a player types and
 * a validation error there is a wall in the first thirty seconds.
 */
export function sanitizeName(raw: unknown, fallback = 'Capitán'): string {
  if (typeof raw !== 'string') return fallback;
  // Collapse whitespace (a pasted name arrives with newlines) and drop the
  // control characters a leaderboard row cannot draw.
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  return cleaned.length > NAME_MAX ? cleaned.slice(0, NAME_MAX).trim() : cleaned;
}

/** The given names whose epithet takes `la`. Cuervo and the male names take
 *  `el`; Chispa reads as she does on the shipped leaderboard captures. */
const FEMININE = new Set(['Inés', 'Malva', 'Lucía', 'Chispa', 'Marina', 'Salomé', 'Rocío', 'Perla']);

/** Whether a rolled name's article agrees with its given name. A player typing
 *  their own name may do as they please; a name WE deal gets its Spanish
 *  right. Shared with rivals.ts, whose roster rejects on the same rule. */
export function nameAgrees(name: string): boolean {
  const [given, article] = name.split(' ');
  if (article !== 'el' && article !== 'la') return true;   // no article, no clash
  return (article === 'la') === FEMININE.has(given);
}

export function rollName(rng: Rng): string {
  // Redrawn until the article agrees and the draw fits the box whole. This
  // used to pick the two halves independently, which dealt "Marina el Tuerto"
  // to the first field a player ever reads — the rival roster (rivals.ts) was
  // already rejecting exactly these draws, and the captain deserves no less.
  // Terminates deterministically: agreeing, untruncated combinations abound
  // and every draw advances the stream.
  for (;;) {
    const draw = `${rng.pick(GIVEN)} ${rng.pick(EPITHET)}`;
    if (draw.length > NAME_MAX || !nameAgrees(draw)) continue;
    return sanitizeName(draw);
  }
}

/* --------------------------------------------------------------------------
 * rolling a captain
 * ----------------------------------------------------------------------- */

/**
 * "Sorpréndeme", and also the tutorial's default: a complete, valid look.
 *
 * The optional slots are weighted rather than coin-flipped. A crew where four
 * in five wear a hat reads as a crew; one where half of them do reads as a
 * random generator, which is what it is and what it must not look like.
 */
export function rollLook(rng: Rng): CaptainLook {
  const maybe = (slot: AvatarSlot, chance: number): string | null =>
    rng.chance(chance) ? rng.pick(AVATAR_PARTS[slot]) : null;

  return {
    body: rng.pick(AVATAR_PARTS.body),
    hair: rng.pick(AVATAR_PARTS.hair),
    beard: maybe('beard', 0.55),
    eyes: maybe('eyes', 0.42),
    hat: maybe('hat', 0.78),
    top: rng.pick(AVATAR_PARTS.top),
    bottom: rng.pick(AVATAR_PARTS.bottom),
  };
}

/**
 * A whole captain from one seed, and nothing else.
 *
 * The stream is forked off `:captain` rather than drawn from the state's own
 * cursor on purpose: `createNewGame` seeds an obstacle field and rolls three
 * quests from that cursor, and a captain taking draws before them would move
 * every palm on the island the day this function changed by one roll.
 */
export function createCaptain(seed: string, name?: string): Captain {
  const rng = new Rng(`${seed}:captain`);
  return {
    name: sanitizeName(name, rollName(rng)),
    seed,
    look: rollLook(rng),
  };
}

/* --------------------------------------------------------------------------
 * validation — the load path
 * ----------------------------------------------------------------------- */

/** True only if every id is one we still ship art for and no required slot is
 *  empty. What a migration and an imported save both have to ask. */
export function isValidLook(look: unknown): look is CaptainLook {
  if (!look || typeof look !== 'object') return false;
  const candidate = look as Record<string, unknown>;
  for (const slot of AVATAR_SLOTS) {
    // A MISSING key is not the same as an empty slot. An empty slot is a
    // decision the player made and it is written down as `null`; a missing one
    // is a half-written save, and it should be repaired rather than drawn.
    if (!(slot in candidate)) return false;
    const value = candidate[slot];
    if (value === null) {
      if (!slotOptional(slot)) return false;
      continue;
    }
    if (typeof value !== 'string' || !AVATAR_PARTS[slot].includes(value)) return false;
  }
  return true;
}

/**
 * Whatever came in, made drawable.
 *
 * A part id that is no longer in the library falls back to the same slot's
 * first entry rather than to nothing: losing a hat is a haircut, losing a body
 * is an invisible captain, and a save is the one input we cannot re-roll.
 */
export function sanitizeLook(look: unknown, fallback: CaptainLook): CaptainLook {
  const candidate = (look ?? {}) as Record<string, unknown>;
  const pick = (slot: AvatarSlot): string | null => {
    const value = candidate[slot];
    if (typeof value === 'string' && AVATAR_PARTS[slot].includes(value)) return value;
    if (value === null && slotOptional(slot)) return null;
    // The fallback is checked against the same table rather than trusted: it is
    // usually a freshly rolled look, but nothing stops a caller passing one
    // that came off the same broken save.
    const back = fallback[slot];
    if (typeof back === 'string' && AVATAR_PARTS[slot].includes(back)) return back;
    return slotOptional(slot) ? null : AVATAR_PARTS[slot][0];
  };
  return {
    body: pick('body') ?? AVATAR_PARTS.body[0],
    hair: pick('hair') ?? AVATAR_PARTS.hair[0],
    beard: pick('beard'),
    eyes: pick('eyes'),
    hat: pick('hat'),
    top: pick('top') ?? AVATAR_PARTS.top[0],
    bottom: pick('bottom') ?? AVATAR_PARTS.bottom[0],
  };
}

/** The same, for a whole captain. `seed` is never taken from the input: the
 *  island has already been generated, so the caller states which seed it was. */
export function sanitizeCaptain(captain: unknown, seed: string): Captain {
  const candidate = (captain ?? {}) as Record<string, unknown>;
  const rolled = createCaptain(seed);
  return {
    name: sanitizeName(candidate.name, rolled.name),
    seed,
    look: sanitizeLook(candidate.look, rolled.look),
  };
}

/* --------------------------------------------------------------------------
 * editing — what the creation screen's arrows do
 * ----------------------------------------------------------------------- */

/**
 * Steps one slot forwards or backwards, wrapping, with `null` sitting in the
 * ring for the optional slots. Pure, so the screen can drive it from an arrow
 * and the test can drive it from a loop.
 */
export function cycleSlot(look: CaptainLook, slot: AvatarSlot, delta: number): CaptainLook {
  const options = slotOptions(slot);
  const at = options.indexOf(look[slot]);
  const size = options.length;
  const next = options[(((at + delta) % size) + size) % size];
  return { ...look, [slot]: next };
}
