import './pertrechos.css';
import { el, pressable } from '../components/dom';
import { CAPTURE } from '../env';
import { sfx } from '../sfx';
import { pertrechoById, type Offer, type OfferCard, type PertrechoId } from '../../sim/pertrechos';

/**
 * pertrechos.ts — the choice of three, in the middle of a fight.
 *
 * SEA_PLAY.md item 3's surface. The sim (src/sim/pertrechos.ts) decides WHAT is
 * offered and what taking it does; this module's whole job is to put three
 * objects on a phone in a way a person can answer in about a second and a half
 * while something is shooting at them. It holds no rules, keeps no state beyond
 * "is a card up", and reports one thing back: which id was tapped.
 *
 * ── DOES THE GAME PAUSE FOR THIS? YES, AND THE ARGUMENT IS WORTH WRITING DOWN
 *
 * SEA_PLAY.md says "the voyage pauses", and having built it both ways in my head
 * I think it is right, for a reason specific to THIS game rather than to the
 * genre. The player has ONE VERB — steering — and it lives under the same thumb
 * that would have to answer this. A live choice is therefore not "choose while
 * playing", it is "stop playing, or do not read the cards": there is no third
 * option, because the hand cannot be in two places. Everything else follows.
 *
 * What a pause costs is tension, and that cost is real: the sea's whole appeal
 * is that it does not wait for you. So the pause is made as cheap as it can be
 * made, and the cost is paid down in four ways rather than waved away:
 *
 *   · THE SEA STAYS ON SCREEN. The tray takes the bottom third of a 430x932
 *     phone and the dim above it is nearly nothing. The player can see the
 *     hull bar, the compass, the thing that was chasing them and where they
 *     were pointing — so the choice is made in context, and "which of these
 *     helps me RIGHT NOW" is a question the screen still answers.
 *   · THERE IS NO WAY OUT BUT A DECISION. No dismiss, no "later", no confirm
 *     step. One tap ends the pause, so it can never be used as a rest.
 *   · IT CANNOT BE SUMMONED. Nothing on the HUD opens this. It appears when a
 *     threshold is crossed and at no other time, which is what stops it from
 *     becoming a pause button with an upgrade attached.
 *   · IT IS RARE ON PURPOSE. The measured ladder gives a day-one voyage three
 *     of these in about seventy seconds (see the calibration table in
 *     src/sim/pertrechos.ts) and they thin out from there.
 *
 * THE HONEST RESIDUAL: a frozen sea is a free look at the board. A player being
 * chased gets a beat to think that a player who was not being chased does not
 * need. I would take that over the alternative, which is a player mashing
 * whichever card their thumb is nearest and never learning that the choice
 * existed — but it IS a cost and it is not zero. Two things bound it: the pause
 * arrives at a moment the player did not choose, and the fastest way out of it
 * is to decide.
 *
 * Nothing in this file requires the freeze. The layout, the hit targets and the
 * settle beat all work over a running sea, so whoever owns the seam can flip
 * it with no change here — see `createPertrechosPanel`'s contract.
 */

/* ==========================================================================
 * copy — es-ES, tú-form, one warm first-mate voice. Stays in this module.
 * ======================================================================= */

const COPY = {
  title: 'PERTRECHOS',
  /** The line that stops a player believing they have bought something
   *  permanent. RETENTION.md keeps the long arc in the hulls and the island;
   *  a card that looked permanent and was not would be the meanest object on
   *  the screen, so it is said every single time. */
  sub: 'Elige uno.\nSolo por esta travesía.',
};

/* ==========================================================================
 * the marks
 *
 * One drawn object per pertrecho, in the flat faceted language of icons.ts and
 * the store's props: solid facets, a warm lit face, a darker shaded one, and
 * §0.2's constant-weight ink contour on every silhouette. They are the fast
 * half of the card — a player who has sailed a few voyages answers on the
 * silhouette and never reads the line again — so each one is drawn as the
 * OBJECT it names where the object is recognisable (bar shot, harpoon, mallet,
 * crates) and as the EFFECT where it is not: the bosun is an hourglass, because
 * "the tide rises more slowly" is a thing about time and nobody recognises a
 * bosun's call at fifty pixels.
 * ======================================================================= */

/** A silhouette. Carries the contour; `non-scaling-stroke` holds it at 3px
 *  whatever size the mark renders at (§6.9 forbids a contour that scales). */
const inked = (tag: string, attrs: string, fill: string): string =>
  `<${tag} ${attrs} fill="${fill}" class="pertrechos__ink" vector-effect="non-scaling-stroke"/>`;

/** An interior facet — already inside a silhouette, so no contour of its own. */
const facet = (tag: string, attrs: string, fill: string): string =>
  `<${tag} ${attrs} fill="${fill}"/>`;

/** A drawn line: a crate's brace, a coil of rope. Also constant-weight, so a
 *  brace does not thin out when the mark is drawn smaller on a 320px screen. */
const stroked = (d: string, colour: string, width = 3): string =>
  `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}"`
  + ` stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;

const IRON = '#5C6A78';
const IRON_D = '#3E4A56';
const IRON_L = '#8B9AA8';
const WOOD = '#A9702F';
const WOOD_L = '#C89250';
const WOOD_D = '#71481B';
const ROPE = '#D6BB86';
const BRASS = '#E8B93C';
const COPPER = '#D08A3E';
const GLINT = 'rgba(255,255,255,0.55)';

const MARKS: Record<PertrechoId, string> = {
  // Grape: a burst of small shot, back rank first so the front reads on top.
  metralla:
    inked('circle', 'cx="13" cy="24" r="8"', IRON_D) +
    inked('circle', 'cx="52" cy="23" r="8"', IRON_D) +
    inked('circle', 'cx="20" cy="45" r="12"', IRON) +
    inked('circle', 'cx="45" cy="46" r="10"', IRON_D) +
    inked('circle', 'cx="33" cy="27" r="13"', IRON_L) +
    facet('circle', 'cx="28" cy="21" r="4"', GLINT) +
    facet('circle', 'cx="16" cy="40" r="3"', GLINT),

  // Bar shot: two balls and the bar between them, which is the whole object.
  palanqueta:
    inked('rect', 'x="14" y="27" width="36" height="10" rx="3"', IRON_L) +
    inked('circle', 'cx="16" cy="32" r="13"', IRON) +
    inked('circle', 'cx="48" cy="32" r="13"', IRON) +
    facet('rect', 'x="18" y="29" width="28" height="3" rx="1.5"', GLINT) +
    facet('circle', 'cx="11" cy="27" r="3.5"', GLINT) +
    facet('circle', 'cx="43" cy="27" r="3.5"', GLINT),

  // A powder flask, its brass spout, and three grains going in.
  polvora:
    inked('path', 'd="M32,16 C45,22 50,34 46,45 C43,54 21,54 18,45 C14,34 19,22 32,16 Z"', WOOD) +
    inked('rect', 'x="26" y="5" width="12" height="13" rx="3"', BRASS) +
    facet('path', 'd="M32,16 C24,22 21,32 22,45 C20,45 18,45 18,45 C14,34 19,22 32,16 Z"', WOOD_L) +
    facet('rect', 'x="19" y="33" width="26" height="5" rx="2.5"', WOOD_D) +
    facet('rect', 'x="28" y="7" width="4" height="8" rx="2"', GLINT) +
    facet('circle', 'cx="52" cy="14" r="2.6"', IRON_D) +
    facet('circle', 'cx="57" cy="21" r="2"', IRON_D) +
    facet('circle', 'cx="53" cy="27" r="1.6"', IRON_D),

  // A hull section: oak above the waterline, new copper below it.
  cobre:
    inked('path', 'd="M8,14 H56 L53,30 H11 Z"', '#774C1F') +
    facet('path', 'd="M8,14 H21 L19,30 H11 Z"', '#9A6427') +
    facet('rect', 'x="11" y="26" width="42" height="4"', '#553511') +
    inked('path', 'd="M11,30 H53 L48,46 C42,55 22,55 16,46 Z"', COPPER) +
    facet('path', 'd="M11,30 H23 L21,50 C19,49 17,48 16,46 Z"', '#FFC97A') +
    facet('circle', 'cx="26" cy="36" r="2.3"', '#8A5218') +
    facet('circle', 'cx="36" cy="36" r="2.3"', '#8A5218') +
    facet('circle', 'cx="46" cy="36" r="2.3"', '#8A5218') +
    facet('circle', 'cx="31" cy="44" r="2.3"', '#8A5218') +
    facet('circle', 'cx="41" cy="44" r="2.3"', '#8A5218'),

  // A gun on its carriage, going off again. The two warm bows off the muzzle
  // are the only geometric mark in the set and they carry the whole difference
  // between this card and the three other gun cards: pólvora is a flask,
  // metralla is loose shot, palanqueta is a bar, and THIS one is speed.
  artilleros:
    stroked('M54,17 Q62,32 54,47', 'rgba(255,216,106,0.45)', 3) +
    stroked('M48,21 Q54,32 48,43', '#FFD86A', 4) +
    inked('path', 'd="M9,34 H41 L37,48 H13 Z"', WOOD_D) +
    inked('circle', 'cx="16" cy="47" r="9"', WOOD) +
    inked('circle', 'cx="34" cy="48" r="6.5"', WOOD_D) +
    facet('circle', 'cx="16" cy="47" r="3"', WOOD_L) +
    inked('path', 'd="M7,17 H37 L44,20 V30 L37,33 H7 Z"', IRON) +
    inked('circle', 'cx="8" cy="25" r="7"', IRON_D) +
    facet('rect', 'x="12" y="19" width="21" height="4" rx="2"', GLINT),

  // A harpoon: barbed head, shaft, and the line coiled at its foot.
  arpon:
    stroked('M31,50 C21,53 19,61 28,59', ROPE, 3.5) +
    inked('rect', 'x="28" y="14" width="8" height="37" rx="3"', '#8A5A2A') +
    inked('path', 'd="M32,2 L46,25 H37 V31 H27 V25 H18 Z"', '#C3D2DE') +
    facet('path', 'd="M32,2 L32,31 H27 V25 H18 Z"', '#EBF3FA') +
    facet('rect', 'x="27" y="32" width="10" height="4" rx="2"', IRON_D),

  // The bosun keeps the reckoning: an hourglass, because the effect is TIME.
  contramaestre:
    inked('path', 'd="M20,15 H44 L34,32 L44,49 H20 L30,32 Z"', '#BFE6F2') +
    inked('rect', 'x="12" y="7" width="40" height="9" rx="3"', WOOD) +
    inked('rect', 'x="12" y="48" width="40" height="9" rx="3"', WOOD) +
    facet('path', 'd="M23,18 H41 L32,30 Z"', BRASS) +
    facet('path', 'd="M25,46 H39 L32,37 Z"', BRASS) +
    facet('rect', 'x="15" y="9" width="12" height="3" rx="1.5"', WOOD_L) +
    facet('path', 'd="M22,18 L28,26 L24,26 Z"', 'rgba(255,255,255,0.5)'),

  // A false hold: the chest, and the drawer under it nobody is meant to find.
  bodega:
    inked('rect', 'x="18" y="42" width="42" height="15" rx="3"', '#774C1F') +
    facet('circle', 'cx="51" cy="49" r="4.5"', '#F5D546') +
    facet('circle', 'cx="42" cy="50" r="3.4"', '#F5D546') +
    facet('rect', 'x="21" y="45" width="9" height="3" rx="1.5"', '#9A6427') +
    inked('path', 'd="M5,22 H47 V44 H5 Z"', WOOD) +
    inked('path', 'd="M5,22 C5,10 47,10 47,22 Z"', WOOD_L) +
    facet('rect', 'x="22" y="11" width="8" height="33"', IRON) +
    inked('rect', 'x="21" y="26" width="10" height="9" rx="2"', BRASS) +
    facet('rect', 'x="25" y="29" width="3" height="4" rx="1.5"', WOOD_D),

  // The shipwright: a mallet coming down on a fresh plank.
  carpintero:
    inked('rect', 'x="4" y="40" width="56" height="14" rx="3"', WOOD_L) +
    facet('rect', 'x="8" y="44" width="48" height="2.5" rx="1.2"', '#8A5A2A') +
    facet('circle', 'cx="14" cy="50" r="2.4"', IRON_D) +
    facet('circle', 'cx="50" cy="50" r="2.4"', IRON_D) +
    inked('rect', 'x="27" y="18" width="8" height="24" rx="3" transform="rotate(20 31 30)"', ROPE) +
    inked('rect', 'x="17" y="5" width="31" height="17" rx="4" transform="rotate(20 32 13)"', WOOD) +
    facet('rect', 'x="20" y="8" width="25" height="4" rx="2" transform="rotate(20 32 13)"', WOOD_L),

  // Master stowage: three crates where two would have gone.
  estiba:
    inked('rect', 'x="5" y="33" width="26" height="25" rx="3"', WOOD) +
    inked('rect', 'x="33" y="33" width="26" height="25" rx="3"', WOOD_D) +
    inked('rect', 'x="19" y="7" width="26" height="25" rx="3"', WOOD_L) +
    stroked('M8,36 L28,55 M28,36 L8,55', WOOD_D, 3) +
    facet('rect', 'x="5" y="42" width="26" height="4"', WOOD_D) +
    facet('rect', 'x="33" y="42" width="26" height="4"', '#5B3812') +
    facet('rect', 'x="19" y="16" width="26" height="4"', WOOD) +
    stroked('M22,10 L42,29 M42,10 L22,29', WOOD, 3) +
    stroked('M36,36 L56,55 M56,36 L36,55', '#5B3812', 3) +
    facet('rect', 'x="21" y="9" width="22" height="3" rx="1.5"', 'rgba(255,255,255,0.35)'),
};

function markSvg(id: PertrechoId): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 64 64');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.setAttribute('class', 'pertrechos__mark');
  node.innerHTML = MARKS[id];
  return node;
}

/* ==========================================================================
 * the panel
 * ======================================================================= */

export interface PertrechosPanelOptions {
  /**
   * The player chose. Hand `id` to `takeOffer` in the sim, apply the loadout,
   * and let the voyage run again.
   *
   * Called ONCE per offer and never with an id that was not on the table — the
   * panel disarms itself on the first tap. The sim refuses an unoffered id
   * anyway (`takeOffer` returns `taken: null`), which is the belt to this
   * module's braces.
   */
  onTake: (id: PertrechoId) => void;
  /**
   * How long the chosen card stays lit before the panel leaves, ms.
   *
   * §5.3: a state that changes silently is a bug. The tap has to have a visible
   * result BEFORE the sea comes back, or the player cannot tell which of the
   * three they actually hit. Zero under a deterministic capture.
   */
  settleMs?: number;
}

export interface PertrechosPanel {
  /** Put a choice on the table. Replaces whatever was up. */
  show(offer: Offer): void;
  /** Take it down with nothing chosen — the ship sank, the voyage ended, the
   *  player left. Never calls `onTake`. */
  hide(): void;
  readonly open: boolean;
  destroy(): void;
}

const ROMAN = ['', 'I', 'II', 'III'];

/**
 * Builds one card. The card IS the button: there is no select-then-confirm,
 * because a second tap to find in the middle of a fight is a second chance to
 * get it wrong.
 */
function cardFor(card: OfferCard, onTap: (id: PertrechoId) => void): HTMLElement {
  const spec = pertrechoById(card.id);
  const art = el('span', 'pertrechos__art', el('span', 'pertrechos__burst'), markSvg(card.id));

  // One pip per level it can reach, lit up to where this tap would take it.
  if (card.stacks > 1) {
    const pips = el('span', 'pertrechos__pips');
    for (let i = 1; i <= card.stacks; i++) {
      pips.append(el('span', `pertrechos__pip${i <= card.level ? ' is-on' : ''}`));
    }
    // Read out for anyone who is not looking at dots.
    pips.setAttribute('aria-label', `Nivel ${ROMAN[card.level] ?? card.level} de ${ROMAN[card.stacks] ?? card.stacks}`);
    art.append(pips);
  }

  const node = el(
    'button', 'pertrechos__card',
    art,
    el('span', 't pertrechos__name', spec?.name ?? card.id),
    el('span', 't pertrechos__line', spec?.line ?? '')
  );
  node.type = 'button';
  node.dataset.id = card.id;
  pressable(node, () => onTap(card.id));
  return node;
}

/**
 * Mounts the choice. Nothing is on screen until `show` is called.
 *
 * ── THE SEAM, for whoever wires this into the voyage
 *
 *   const choice = createPertrechosPanel(uiHost, {
 *     onTake: (id) => {
 *       const { pertrechos } = takeOffer(state.pertrechos, id);
 *       state.pertrechos = pertrechos;          // loadout is already applied
 *       frozen = false;                          // let the sim step again
 *       if (pertrechos.offer) choice.show(pertrechos.offer);   // the queue
 *     },
 *   });
 *
 * ...and on every step, after folding the events in with `noteEvents`, show
 * `state.pertrechos.offer` if one is up and the panel is not already open, and
 * stop stepping `stepVoyage` while `choice.open` is true. That freeze is the
 * pause argued for at the top of this file, and it is ONE conditional in the
 * scene rather than anything in here — a scene that keeps stepping gets a live
 * choice and this module neither knows nor minds.
 *
 * `hide()` on `sunk`, `home` and `abandoned`, because a voyage that has ended
 * must not leave a card on the screen for the end-of-voyage card to sit under.
 */
export function createPertrechosPanel(
  host: HTMLElement, opts: PertrechosPanelOptions
): PertrechosPanel {
  const settleMs = opts.settleMs ?? (CAPTURE ? 0 : 420);
  let root: HTMLElement | null = null;
  let timer = 0;
  let armed = false;

  const clear = (): void => {
    if (timer) { clearTimeout(timer); timer = 0; }
    root?.remove();
    root = null;
    armed = false;
  };

  const answer = (id: PertrechoId): void => {
    // The first tap wins. A second one — a double tap, a stray finger from the
    // hand that was steering — must not spend the next offer as well.
    if (!armed || !root) return;
    armed = false;
    sfx('levelup');
    navigator.vibrate?.([12, 40, 18]);
    for (const card of Array.from(root.querySelectorAll('.pertrechos__card'))) {
      card.classList.add((card as HTMLElement).dataset.id === id ? 'is-taken' : 'is-spent');
      (card as HTMLElement).style.pointerEvents = 'none';
    }
    const finish = (): void => { clear(); opts.onTake(id); };
    if (settleMs <= 0) finish();
    else timer = window.setTimeout(finish, settleMs);
  };

  return {
    get open(): boolean {
      return root !== null;
    },

    show(offer: Offer): void {
      clear();
      const row = el('div', `pertrechos__row${offer.cards.length < 3 ? ' is-short' : ''}`);
      for (const card of offer.cards) row.append(cardFor(card, answer));

      const tray = el(
        'div', 'pertrechos__tray',
        el(
          'div', 'pertrechos__head',
          el('span', 't pertrechos__title', COPY.title),
          el('span', 't pertrechos__sub', COPY.sub)
        ),
        row
      );

      root = el('div', 'pertrechos', el('div', 'pertrechos__scrim'), tray);
      // The tray is a live surface; the scrim swallows everything else so a tap
      // meant for a card that lands beside one cannot reach the helm behind it.
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', 'Pertrechos: elige uno');
      armed = true;
      host.append(root);
      sfx('reward');
    },

    hide(): void {
      clear();
    },

    destroy(): void {
      clear();
    },
  };
}
