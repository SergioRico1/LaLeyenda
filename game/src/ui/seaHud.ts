import './seaHud.css';
import type { ResourceId } from '../sim';
import { HARBOUR, MOBS, SHIPS, bearingHome, holdUsed, ringOf, SEA_CELL, type Voyage } from '../sim/sea';
import { CAPTURE } from './env';
import { HELM_STEER } from './stick';

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
 *
 * WHAT THIS ROUND ADDED, AND WHY
 *
 * The owner played the deployed build and the screenshot came back with four
 * readouts and NO CONTROL ON IT. The steering was there and it was invisible
 * (see `stick.ts`), so the screen said what the player HAS and never once said
 * what the player DOES. Three things answer that, and they are the only three:
 *
 *   THE HELM SIGN     A resting instrument in the lower right, sitting where a
 *                     thumb already rests, drawn as a ship's wheel with the four
 *                     chevrons that say "any direction, not left-and-right". It
 *                     is a SIGN, not a button: it takes no pointer events, so
 *                     pressing it summons the real stick underneath it and the
 *                     sign becomes the control with no seam. It stands down
 *                     while a stick is live somewhere else.
 *
 *   THE COACH MARK    One Spanish line and a hand that drags out of the wheel,
 *                     shown on a first-ever voyage and never again. It listens
 *                     for `HELM_STEER` and leaves the moment a thumb goes down,
 *                     because a hint that outlives its lesson is nagging.
 *
 *   A HIERARCHY       The three readouts were three chips of equal weight, and
 *                     they are not equally urgent: a hull at 20% is the only
 *                     thing on the screen that matters at that moment. They now
 *                     share one Kingshot capsule, and whichever one is shouting
 *                     takes the light while the other two step back.
 *
 * The compass is the other half of the same complaint. "50 m" beside a 22px
 * triangle is a debug readout; it is now a brass instrument with a face, a
 * needle and a legible distance, because it is the object that decides whether
 * a loaded player banks their cargo or loses it.
 */

const RESOURCE_LABEL: Record<string, string> = {
  oro: 'Oro', madera: 'Madera', metal: 'Metal', ron: 'Ron',
};

/** The hulls, named for the player. Lives here because this HUD is the screen
 *  that says them; the sim speaks only ids. */
const SHIP_LABEL: Record<string, string> = {
  skiff: 'Esquife', sloop: 'Balandra', galleon: 'Galeón',
  frigate: 'Fragata', marauder: 'Merodeador',
};

/** The two lines the sea can shout. Keyed, so the scene never carries copy. */
const BANNER_TEXT = {
  'deep-chest': '¡El Cofre de las Profundidades!',
  frenzy: '¡El kraken se enfurece!',
} as const;

export type SeaBanner = keyof typeof BANNER_TEXT;

/**
 * The hull fractions the presentation changes at.
 *
 * PRODUCTION.md §3 says nobody has played this balance and that a capture at
 * ring 3 lost most of a hull in six seconds. Until that is tuned in `sim/`, the
 * least this screen can do is stop treating the death of the ship as one of
 * three equal chips: at LOW the bar takes the light, at CRITICAL the whole
 * capsule turns and the screen names the remedy out loud.
 */
const HULL_LOW = 0.34;
const HULL_CRITICAL = 0.18;
/** Above this the hold is worth sailing home for, and the HUD says so. */
const HOLD_HEAVY = 0.85;

/**
 * Whether this player has ever steered.
 *
 * Deliberately NOT in the save file. It is a fact about the person holding the
 * phone, not about the captain they are playing, it must survive a save being
 * deleted or a second captain being rolled, and a coach mark that comes back
 * after a migration is worse than one that never appeared. `localStorage`
 * throws outright in private-mode Safari, so both sides swallow.
 */
const TAUGHT_KEY = 'la-leyenda:helm-taught';

function helmTaught(): boolean {
  try {
    return localStorage.getItem(TAUGHT_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberHelmTaught(): void {
  try {
    localStorage.setItem(TAUGHT_KEY, '1');
  } catch {
    /* Private mode. The hint shows again next voyage, which is the safe way
       to be wrong: a lesson repeated beats a lesson never given. */
  }
}

/**
 * Distance to the harbour, rounded so the numeral stops flickering.
 *
 * At 30 simulated steps a second an unrounded metre count changes every frame,
 * and a counter that never settles reads as noise rather than as information.
 */
function distanceText(metres: number): string {
  if (metres >= 950) return `${(metres / 1000).toFixed(1)}<u> km</u>`;
  return `${Math.round(metres / 5) * 5}<u> m</u>`;
}

/**
 * The sea camera's fixed offset from the ship — seaScene.ts's `CAM_OFFSET`.
 *
 * If that vector is ever changed, change this one. It is the only number here
 * that belongs to another file, and it is copied rather than imported because
 * a HUD may not reach into a scene.
 */
const CAM_OFFSET = { x: 26, y: 34, z: 32 };

/**
 * The camera's ground axes, so a bearing IN THE WORLD can be drawn ON GLASS.
 *
 * The needle was rotating by `bearingHome`, which is a world angle, on a screen
 * whose axes the camera has turned. The offset above puts the camera over the
 * ship's shoulder at about 39° off the world grid, so sim +x runs down-and-right
 * across the display rather than straight right — and the needle was pointing up
 * to 52° away from the harbour. A compass that is confidently wrong is worse
 * than no compass, because a player trusts it and keeps sailing.
 *
 * three.js builds `lookAt` with up = (0,1,0): the camera's local +Z is the offset
 * itself, +X is normalize(up × Z) and +Y is Z × X. Projecting a ground vector
 * onto X and Y gives its direction on the glass. Only the ground (x, z)
 * components of each axis are needed, since every bearing lies flat on the sea.
 */
const CAM = (() => {
  const { x, y, z } = CAM_OFFSET;
  const length = Math.hypot(x, y, z);
  const zx = x / length;
  const zy = y / length;
  const zz = z / length;
  const wide = Math.hypot(zz, zx);
  const rightX = zz / wide;
  const rightZ = -zx / wide;
  return { rightX, rightZ, upX: zy * rightZ, upZ: -zy * rightX };
})();

/**
 * A world bearing as a CSS rotation for a needle drawn pointing up.
 *
 * `bearingHome` returns `atan2(-x, y)`, so the unit vector it stands for is
 * (sin b, -cos b) in simulation coordinates. Project that onto the camera's two
 * ground axes and the result is where "towards home" actually is on the display.
 */
function needleDegrees(worldBearing: number): number {
  const hx = Math.sin(worldBearing);
  const hy = -Math.cos(worldBearing);
  const across = hx * CAM.rightX + hy * CAM.rightZ;
  const up = hx * CAM.upX + hy * CAM.upZ;
  return (Math.atan2(across, up) * 180) / Math.PI;
}

export interface SeaHud {
  update(voyage: Voyage): void;
  /**
   * Takes a hit, as a fading red vignette round the edge of the screen.
   *
   * At the edge rather than over the middle deliberately: the player is
   * steering and reading the water, so the one place damage can be shown
   * without hiding what they need is the border they are not looking at.
   */
  setHurt(seconds: number): void;
  /**
   * One of the sea's two shouted lines — the boss's phase turn and the chest
   * of the deep. A moment either announces itself or it did not happen; the
   * scene raises the key and this screen owns the Spanish.
   */
  banner(kind: SeaBanner): void;
  /**
   * The sim says the water its hull is not rated for is HERE, or one cell
   * ahead on the current heading ('zone-warning', once per ring). A plate
   * names both numbers — the zone's and the hull's — because round 11's
   * playtest lost most of a skiff to ring-3 tritons with nothing on screen
   * saying zones outrank the starter boat. The scene raises the event; this
   * screen owns the Spanish, and the tense: the sim's look-ahead (round 13)
   * means the plate usually lands while the ship is still in rated water, so
   * the line has to say *por delante* rather than pretend it has arrived.
   */
  warnZone(ring: number, rated: number): void;
  /**
   * Shows the end-of-voyage card. Resolves when the player dismisses it.
   *
   * `preview` is what the island will actually BANK and REFUSE — the scene
   * computes it with the sim's own `previewLanding` over the stored save.
   * Round 11's finding 1 was this card reciting the manifest ("Ron 180 ·
   * Metal 99") while a capless island spilled every drop of it; with the
   * preview the card prints the landing, loss and all, BEFORE the tap that
   * performs it. Null (no save to read — captures, storage refusals) falls
   * back to listing the hold.
   */
  finish(voyage: Voyage, reason: 'home' | 'sunk' | 'left', preview?: LandingPreview | null): Promise<void>;
  dispose(): void;
}

/** The landing's two halves, exactly as `previewLanding` hands them over. */
export interface LandingPreview {
  landed: Partial<Record<ResourceId, number>>;
  spilled: Partial<Record<ResourceId, number>>;
}

export interface SeaHudOptions {
  /** Called when the player abandons the voyage from the button. */
  onLeave(): void;
}

/** The ship's wheel, drawn twice: ink underneath, brass on top (UI_SPEC §0.2). */
const WHEEL_SVG = `
  <svg class="sea__wheel" viewBox="0 0 48 48" aria-hidden="true">
    <g fill="none" stroke="#17130E" stroke-width="7.5" stroke-linecap="round">
      <circle cx="24" cy="24" r="12.6"/>
      <path d="M24 7.5v33M7.5 24h33M12.3 12.3l23.4 23.4M35.7 12.3L12.3 35.7"/>
    </g>
    <g fill="none" stroke="#F5D546" stroke-width="3.6" stroke-linecap="round">
      <circle cx="24" cy="24" r="12.6"/>
      <path d="M24 7.5v33M7.5 24h33M12.3 12.3l23.4 23.4M35.7 12.3L12.3 35.7"/>
    </g>
    <circle cx="24" cy="24" r="4.6" fill="#C57C2A" stroke="#17130E" stroke-width="2.6"/>
  </svg>
`;

/** Four chevrons round the wheel: the gesture is a DIRECTION, not a turn rate. */
const CHEVRONS_SVG = `
  <svg class="sea__chevrons" viewBox="0 0 100 100" aria-hidden="true">
    <g fill="#FFE9A8" stroke="#17130E" stroke-width="3.4" stroke-linejoin="round">
      <path d="M50 3 L57 15 L43 15 Z"/>
      <path d="M97 50 L85 57 L85 43 Z"/>
      <path d="M50 97 L43 85 L57 85 Z"/>
      <path d="M3 50 L15 43 L15 57 Z"/>
    </g>
  </svg>
`;

export function createSeaHud(host: HTMLElement, opts: SeaHudOptions): SeaHud {
  const root = document.createElement('div');
  root.className = 'sea';
  root.innerHTML = `
    <!-- First, so every readout paints ON TOP of it. The one moment a player
         must be able to read the hull bar is the moment they are being hit, and
         a red wash over the numbers is the opposite of that. -->
    <div class="sea__hurt"></div>

    <div class="sea__bar" data-focus="none">
      <div class="sea__cell sea__cell--hull">
        <span class="sea__cellLabel">Casco</span>
        <span class="sea__hullRow">
          <span class="sea__hull"><span class="sea__hullFill" style="width:100%"></span></span>
          <span class="sea__hullPct num" data-hullpct>100<u>%</u></span>
        </span>
      </div>
      <span class="sea__sep"></span>
      <div class="sea__cell sea__cell--hold">
        <span class="sea__cellLabel" data-holdlabel>Bodega</span>
        <span class="sea__cellValue num" data-hold>0/0</span>
      </div>
      <span class="sea__sep"></span>
      <div class="sea__cell sea__cell--ring">
        <span class="sea__cellLabel">Zona</span>
        <span class="sea__cellValue num" data-ring>1</span>
      </div>
    </div>

    <div class="sea__alert" data-alert hidden></div>

    <!-- The boss bar. One creature in this sea has phases, and a fight whose
         health lives in a 5-unit strip over the water is a fight the player
         cannot pace. Name, phase pips, health — up while the kraken is met,
         gone with it. -->
    <div class="sea__boss" data-boss hidden>
      <div class="sea__bossHead">
        <span class="sea__bossName">El Kraken</span>
        <span class="sea__bossPips" aria-hidden="true">
          <span class="sea__bossPip is-on" data-pip1></span>
          <span class="sea__bossPip" data-pip2></span>
        </span>
      </div>
      <div class="sea__bossTrack">
        <div class="sea__bossFill" data-bossfill style="width:100%"></div>
      </div>
    </div>

    <!-- The shipyard's product, named at the dock. Stands while the ship is
         still in home water and steps aside the moment the voyage is really
         on, so it teaches the hull without ever costing fighting screen. -->
    <div class="sea__dock" data-dock>
      <span class="sea__dockName" data-dockname></span>
      <span class="sea__dockStats num" data-dockstats></span>
    </div>

    <!-- The sea's two shouted lines (boss phase, chest of the deep). -->
    <div class="sea__banner" data-banner hidden></div>

    <button class="sea__leave tap" type="button">Volver</button>

    <div class="sea__compass" data-compass="port">
      <span class="sea__compassCap">A casa</span>
      <span class="sea__dial">
        <span class="sea__face"></span>
        <svg class="sea__arrow" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2 L20 20 L12 15.5 L4 20 Z" fill="#FFD75E" stroke="#17130E" stroke-width="2"
                stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="sea__dist num" data-home>Puerto</span>
    </div>

    <div class="sea__helm">
      <span class="sea__halo"></span>
      <span class="sea__helmRing">${WHEEL_SVG}</span>
      ${CHEVRONS_SVG}
      <span class="sea__helmCap">Timón</span>
    </div>
  `;
  host.append(root);

  const bar = root.querySelector('.sea__bar') as HTMLElement;
  const hullFill = root.querySelector('.sea__hullFill') as HTMLElement;
  const hullLabel = root.querySelector('.sea__cell--hull .sea__cellLabel') as HTMLElement;
  const hullPct = root.querySelector('[data-hullpct]') as HTMLElement;
  const holdOut = root.querySelector('[data-hold]') as HTMLElement;
  const holdLabel = root.querySelector('[data-holdlabel]') as HTMLElement;
  const ringOut = root.querySelector('[data-ring]') as HTMLElement;
  const alertOut = root.querySelector('[data-alert]') as HTMLElement;
  const bossEl = root.querySelector('[data-boss]') as HTMLElement;
  const bossFill = root.querySelector('[data-bossfill]') as HTMLElement;
  const bossPip2 = root.querySelector('[data-pip2]') as HTMLElement;
  const dockName = root.querySelector('[data-dockname]') as HTMLElement;
  const dockStats = root.querySelector('[data-dockstats]') as HTMLElement;
  const bannerOut = root.querySelector('[data-banner]') as HTMLElement;
  const compass = root.querySelector('.sea__compass') as HTMLElement;
  const homeOut = root.querySelector('[data-home]') as HTMLElement;
  const arrow = root.querySelector('.sea__arrow') as HTMLElement;
  const hurtVeil = root.querySelector('.sea__hurt') as HTMLElement;
  const leave = root.querySelector('.sea__leave') as HTMLButtonElement;
  leave.addEventListener('click', () => opts.onLeave());
  let bannerTimer: ReturnType<typeof setTimeout> | null = null;

  // `update` runs once per rendered frame. Writing an attribute, a textContent
  // or a custom property invalidates style for that element whether or not the
  // value changed, and there are a dozen of them here — on a mid-range phone
  // that is a style recalculation sixty times a second for readouts that change
  // once a minute. Every write below goes through one of these.
  const setText = (node: HTMLElement, value: string): void => {
    if (node.textContent !== value) node.textContent = value;
  };
  const setHtml = (node: HTMLElement, value: string): void => {
    if (node.innerHTML !== value) node.innerHTML = value;
  };
  const setData = (node: HTMLElement, key: string, value: string): void => {
    if (node.dataset[key] !== value) node.dataset[key] = value;
  };

  /**
   * One mechanism for everything the sea shouts: the fixed lines (banner) and
   * the composed zone warning share the element, the pop and the capture rule.
   *
   * `holdMs` is per line, because they are not the same kind of thing. The
   * boss's phase turn and the chest of the deep are announcements: they name
   * something that has already happened, and 3.4s is plenty. The zone plate is
   * a DECISION — turn back, or take the hit — and a decision needs long enough
   * to be made. It gets the whole cell of water the sim's look-ahead bought.
   */
  function shout(text: string, kind: string, holdMs = 3400): void {
    setText(bannerOut, text);
    setData(bannerOut, 'kind', kind);
    bannerOut.hidden = false;
    // Restart the entrance even if one line lands on another's heels.
    bannerOut.classList.remove('is-live');
    void bannerOut.offsetWidth;
    bannerOut.classList.add('is-live');
    if (bannerTimer !== null) clearTimeout(bannerTimer);
    // The moment outlives its timeout in a capture: the harness advances the
    // SIM synchronously but this timer runs on the wall clock, so the one
    // frame a critic can inspect had already dropped the line by the time it
    // was taken. A frozen frame keeps its banner.
    if (!CAPTURE) bannerTimer = setTimeout(() => { bannerOut.hidden = true; }, holdMs);
  }

  /* --- the outranked zone, held on the chip -------------------------------
   *
   * A plate is a moment and the danger is a CONDITION: round 13's blind
   * playtest crossed into zone 3 in a skiff and read the plate as scenery,
   * because three seconds later the screen looked exactly like it had at zone
   * 1. So the zone chip itself now carries the state — red while the water
   * outranks the hull, plain the moment the ship is back inside its rating —
   * and the plate goes back to being the thing that gets the player to LOOK at
   * the chip.
   *
   * Painted from here rather than from seaHud.css because the stylesheet is
   * not this round's file; inline wins over the class rules either way, which
   * matters for the one rule it has to beat: `[data-focus='hull']` dims the
   * ring cell to 44% exactly when the hull is going, which is exactly when the
   * water that is doing it must not fade out.
   */
  const ringCell = root.querySelector('.sea__cell--ring') as HTMLElement;
  let zonePainted: boolean | null = null;
  let zonePulse: Animation | null = null;

  function paintZone(outranked: boolean): void {
    if (zonePainted === outranked) return;
    zonePainted = outranked;
    setData(ringCell, 'zone', outranked ? 'over' : 'ok');
    const style = ringCell.style;
    if (!outranked) {
      zonePulse?.cancel();
      zonePulse = null;
      for (const property of ['color', 'opacity', 'border-radius', 'background', 'box-shadow', 'margin']) {
        style.removeProperty(property);
      }
      return;
    }
    // The alarm register the hull and the kraken's frenzy already share, so
    // the sea has one colour for "this is what is killing you" (§ the frenzy
    // banner in seaHud.css).
    style.color = '#FFD9D6';
    style.opacity = '1';
    style.borderRadius = '10px';
    style.margin = '-1px 0';
    style.background =
      'linear-gradient(180deg, rgba(255,255,255,.20) 0 50%, rgba(0,0,0,.16) 50% 100%),'
      + 'linear-gradient(180deg, #C0261C, #8E1410)';
    style.boxShadow =
      'inset 0 2px 0 rgba(255,190,180,.55), inset 0 -3px 0 rgba(64,6,6,.9), 0 1px 0 rgba(0,0,0,.35)';
    // A slow breath, so it keeps asking without ever becoming a strobe. Web
    // Animations rather than a keyframe, for the same reason as above — and
    // never under a capture, which has to stay byte-identical.
    if (!CAPTURE && typeof ringCell.animate === 'function') {
      zonePulse = ringCell.animate(
        [{ filter: 'brightness(1)' }, { filter: 'brightness(1.22)' }, { filter: 'brightness(1)' }],
        { duration: 1400, iterations: Infinity, easing: 'ease-in-out' }
      );
    }
  }

  /** The ring the chip is painting, so `warnZone` knows whether the water it
   *  is naming is under the ship or one cell ahead of it. -1 until the first
   *  frame: the scene drains its events BEFORE it updates the HUD, so a voyage
   *  that starts in outranked water (a capture dropped at a lair) would warn
   *  with nothing painted yet, and must not be told the water is ahead of it. */
  let shownRing = -1;

  // --- the first-voyage coach mark ----------------------------------------
  // `?coach=1` / `?coach=0` forces it either way. The screenshot harness gets a
  // fresh profile on every run, so without the override the only frame it could
  // ever capture is a first voyage — and the veteran's screen, which is the one
  // a player spends every other voyage looking at, would go unreviewed.
  const coachParam = new URLSearchParams(location.search).get('coach');
  // `?zone=0` mutes the zone plate for a capture. Under CAPTURE a shouted line
  // is held for the frame (see shout), which is right for photographing the
  // warning itself and wrong for photographing anything else that happens in
  // rated water — every fight capture starts by dropping the ship there.
  const zoneMuted = new URLSearchParams(location.search).get('zone') === '0';
  const wantCoach = coachParam === null ? !helmTaught() : coachParam === '1';

  let coach: HTMLElement | null = null;
  let coachTimer: ReturnType<typeof setTimeout> | null = null;

  function dismissCoach(learned: boolean): void {
    if (coachTimer !== null) {
      clearTimeout(coachTimer);
      coachTimer = null;
    }
    window.removeEventListener(HELM_STEER, onSteer);
    if (!coach) return;
    coach.classList.add('is-gone');
    const node = coach;
    coach = null;
    setTimeout(() => node.remove(), 240);
    // Only a thumb that actually steered proves the lesson landed. The timeout
    // below takes the hint off a player who is watching the sea, and leaves the
    // flag unset so the next voyage teaches them properly.
    if (learned) rememberHelmTaught();
  }

  function onSteer(): void {
    dismissCoach(true);
  }

  if (wantCoach) {
    coach = document.createElement('div');
    coach.className = 'sea__coach';
    coach.innerHTML = `
      <span class="sea__coachLine">Mantén y arrastra para navegar</span>
      <svg class="sea__coachTrail" viewBox="0 0 160 130" aria-hidden="true">
        <path d="M140 112 C 122 104, 84 88, 44 42" fill="none" stroke="#17130E" stroke-width="11"
              stroke-linecap="round" stroke-dasharray="2 12"/>
        <path d="M140 112 C 122 104, 84 88, 44 42" fill="none" stroke="#FFF3DA" stroke-width="5.4"
              stroke-linecap="round" stroke-dasharray="2 12"/>
      </svg>
      <svg class="sea__hand" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11.5 3.2c1 0 1.7.8 1.7 1.7v7.6h1.9c2.6 0 4.7 2.1 4.7 4.7v2.2c0 1.7-1.4 3.1-3.1
                 3.1h-5.4c-1.3 0-2.5-.6-3.3-1.6l-3.1-4c-.6-.8-.5-1.9.3-2.5.7-.6 1.7-.5 2.3.2l1.3
                 1.5V4.9c0-.9.8-1.7 1.7-1.7z"
              fill="#FFF3DA" stroke="#17130E" stroke-width="1.9" stroke-linejoin="round"/>
      </svg>
    `;
    (root.querySelector('.sea__helm') as HTMLElement).append(coach);
    window.addEventListener(HELM_STEER, onSteer);
    // A player who never touches the glass still gets their sea back. No flag
    // is written, so the lesson is simply owed again next time.
    coachTimer = setTimeout(() => dismissCoach(false), 22000);
  }

  return {
    update(voyage) {
      const spec = SHIPS[voyage.shipType];
      const shipName = SHIP_LABEL[voyage.shipType] ?? 'Casco';

      // --- the ship itself ---------------------------------------------------
      // The hull cell is captioned with the hull's NAME — a bar under a name is
      // that thing's health, and the name is how five otherwise similar decks
      // stay tellable apart. The dock card carries the numbers and stands only
      // in home water; the moment the voyage is truly on it steps aside.
      setText(hullLabel, shipName);
      setText(dockName, shipName);
      setText(dockStats, `Casco ${spec.hull} · Cañones ${spec.damage} · Bodega ${spec.hold}`);
      const departed = voyage.departed || voyage.sunk;
      if (root.classList.contains('is-departed') !== departed) {
        root.classList.toggle('is-departed', departed);
      }

      // --- hull ------------------------------------------------------------
      const fraction = Math.max(0, voyage.hull / spec.hull);
      const width = `${(fraction * 100).toFixed(1)}%`;
      if (hullFill.style.width !== width) hullFill.style.width = width;
      setHtml(hullPct, `${Math.round(fraction * 100)}<u>%</u>`);
      const hullState = fraction <= HULL_CRITICAL ? 'crit' : fraction <= HULL_LOW ? 'low' : 'ok';

      // --- hold ------------------------------------------------------------
      const used = holdUsed(voyage);
      const holdFraction = spec.hold > 0 ? used / spec.hold : 0;
      setText(holdOut, `${Math.round(used)}/${spec.hold}`);
      const holdFull = holdFraction >= 0.999;
      const holdHeavy = holdFraction >= HOLD_HEAVY;
      setText(holdLabel, holdFull ? '¡Llena!' : 'Bodega');

      shownRing = ringOf(Math.round(voyage.x / SEA_CELL), Math.round(voyage.y / SEA_CELL));
      setText(ringOut, String(shownRing));
      // The condition, not the moment: red for as long as the water is deeper
      // than the hull is rated for, and only while there is still a ship.
      paintZone(shownRing > spec.rated && !voyage.sunk);

      // --- the boss bar ------------------------------------------------------
      // Up while a kraken is met — inside its tether's reach, or already hurt —
      // and gone with it. Health and phase come straight off the sim's own mob
      // fields; nothing here decides anything. The bar stays up through a dive
      // (the fight is still on, that is the point of a bar), dimmed so the
      // untouchable state reads.
      const squid = voyage.mobs.find((m) => m.kind === 'squid');
      const bossOn = !!squid && !voyage.sunk
        && (squid.hp < MOBS.squid.hp
          || Math.hypot(squid.x - voyage.x, squid.y - voyage.y) < 80);
      if (bossEl.hidden !== !bossOn) bossEl.hidden = !bossOn;
      if (root.classList.contains('has-boss') !== bossOn) {
        root.classList.toggle('has-boss', bossOn);
      }
      if (squid && bossOn) {
        const bossFraction = Math.max(0, Math.min(1, squid.hp / MOBS.squid.hp));
        const bossWidth = `${(bossFraction * 100).toFixed(1)}%`;
        if (bossFill.style.width !== bossWidth) bossFill.style.width = bossWidth;
        const frenzy = squid.frenzied === true;
        if (bossPip2.classList.contains('is-on') !== frenzy) {
          bossPip2.classList.toggle('is-on', frenzy);
        }
        setData(bossEl, 'phase', frenzy ? 'frenzy' : 'calm');
        setData(bossEl, 'dived', squid.dive ? '1' : '0');
      }

      // --- the hierarchy ----------------------------------------------------
      // One thing at a time takes the light, and a hull that is going wins over
      // a hold that is full, because one of them ends the voyage for you.
      setData(bar, 'focus', hullState !== 'ok' ? 'hull' : holdHeavy ? 'hold' : 'none');
      setData(bar, 'hull', hullState);

      // --- the one line that names the remedy -------------------------------
      // A dying hull outranks everything; the boarding wait outranks the full
      // hold, because it is the one state where "stay right here" is the
      // remedy and the compass, the mobs and every instinct say leave.
      const alert = hullState === 'crit'
        ? 'Casco crítico · vuelve a puerto'
        : voyage.boarding
          ? `Abordando el pecio… ${Math.ceil(voyage.boarding.left)}s`
          : holdFull
            ? 'Bodega llena · vuelve a puerto'
            : '';
      if (alert) {
        setText(alertOut, alert);
        setData(alertOut, 'kind', hullState === 'crit' ? 'hull' : voyage.boarding ? 'board' : 'hold');
        if (alertOut.hidden) alertOut.hidden = false;
      } else if (!alertOut.hidden) {
        alertOut.hidden = true;
      }

      // --- the compass -------------------------------------------------------
      const heading = `${needleDegrees(bearingHome(voyage.x, voyage.y)).toFixed(1)}deg`;
      if (arrow.style.getPropertyValue('--sea-bearing') !== heading) {
        arrow.style.setProperty('--sea-bearing', heading);
      }
      const distance = Math.hypot(voyage.x, voyage.y);
      // The SIMULATION'S harbour, not a number that looked about right.
      //
      // This read `SEA_CELL * 0.5` while sim/sea.ts banks the hold at
      // `SEA_CELL * HARBOUR`, which is 0.45 — so there was a ring of water two
      // and a half units wide where the compass said EN CASA and the voyage did
      // not end. Played end to end that is what it looks like: the instrument
      // announces the arrival, nothing happens, and the player sails on past the
      // harbour with a full hold looking for the bit that counts. An instrument
      // that is right about the direction and wrong about the arrival is worse
      // than one that says nothing, because it is believed.
      const inHomeWater = distance < SEA_CELL * HARBOUR;
      if (!voyage.departed) {
        setData(compass, 'compass', 'port');
        setText(homeOut, 'Puerto');
      } else if (inHomeWater) {
        setData(compass, 'compass', 'arrived');
        setText(homeOut, 'En casa');
      } else {
        setData(compass, 'compass', holdHeavy ? 'laden' : 'sailing');
        setHtml(homeOut, distanceText(distance));
      }
    },

    setHurt(seconds) {
      // 0.42s is the scene's full hit; anything longer is the sinking cue.
      hurtVeil.style.opacity = String(Math.min(1, seconds / 0.42));
    },

    banner(kind) {
      shout(BANNER_TEXT[kind], kind);
    },

    warnZone(ring, rated) {
      if (zoneMuted) return;
      // The sim warns one cell before the boundary (sim/sea.ts, round 13), so
      // most of the time this plate is about water the ship has not reached.
      // Saying "aguas de zona 3" while the chip still reads 2 is the small
      // kind of lying this project keeps refusing to do — and the tense is
      // also the whole usefulness of the warning, because *por delante* is an
      // instruction and *aguas de* is a caption.
      const ahead = shownRing >= 0 && ring > shownRing;
      shout(
        ahead
          ? `Zona ${ring} por delante — tu casco es de zona ${rated}`
          : `Aguas de zona ${ring} — tu casco es de zona ${rated}`,
        'zone',
        // Long enough to turn the ship with. At full throttle a skiff needs
        // about 3.2s to cross the cell the look-ahead bought, and the plate
        // has to outlast the decision rather than the crossing.
        5200
      );
    },

    finish(voyage, reason, preview) {
      // A card on top of a coach mark is two things asking to be read at once,
      // so the hint goes — but it is NOT marked as taught. A voyage can end
      // without a thumb ever going down (the abandon button, or a mob sinking a
      // ship that never moved), and only steering proves the lesson landed.
      dismissCoach(false);
      return new Promise((resolve) => {
        const chips = (entries: Partial<Record<string, number>>): string =>
          Object.entries(entries)
            .filter(([, amount]) => (amount ?? 0) > 0)
            .map(([res, amount]) =>
              `<span class="sea__endItem">${RESOURCE_LABEL[res] ?? res} ${Math.round(amount ?? 0)}</span>`)
            .join('');

        // What the card lists is what will LAND — the preview is the landing's
        // own arithmetic, run for us by the scene. Only a card with no save to
        // read (captures) falls back to reciting the hold.
        const landed = chips(preview ? preview.landed : voyage.cargo);
        const spilled = preview ? chips(preview.spilled) : '';

        const title = reason === 'sunk' ? '¡Nos hunden!' : 'De vuelta a puerto';
        const note = reason === 'sunk'
          ? 'La tripulación se salva y llega a nado con la mitad de la carga.'
          : landed
            ? 'La carga pasa a tus almacenes.'
            : spilled
              ? 'Esta vez no desembarca nada.'
              : 'Sin carga esta vez.';
        // The loss is said AT THE DOCK, before the tap that performs it. The
        // arrival toast on the island repeats it with the missing store named
        // — same numbers, because it is the same arithmetic.
        const spill = spilled
          ? `<div class="sea__endSpillNote">Sin almacén donde guardarlo, esto se va al agua:</div>
            <div class="sea__endList sea__endList--spill">${spilled}</div>`
          : '';

        const end = document.createElement('div');
        end.className = 'sea__end';
        end.innerHTML = `
          <div class="sea__endCard">
            <div class="sea__endTitle">${title}</div>
            <div class="sea__endNote">${note}</div>
            <div class="sea__endList">${landed}</div>
            ${spill}
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
      if (coachTimer !== null) clearTimeout(coachTimer);
      if (bannerTimer !== null) clearTimeout(bannerTimer);
      // An infinite animation keeps its element alive and keeps the compositor
      // ticking for a HUD nobody is looking at.
      zonePulse?.cancel();
      zonePulse = null;
      window.removeEventListener(HELM_STEER, onSteer);
      root.remove();
    },
  };
}

export type { ResourceId };
