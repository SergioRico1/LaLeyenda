import { Rng } from '../core/rng';
import type { SeaEvent, ShipSpec } from './sea';

/**
 * pertrechos.ts — the build inside the voyage. SEA_PLAY.md item 3.
 *
 * The diagnosis this file answers, in the owner's words: *"es ir con el barco,
 * matar mobs automáticamente y acercarte a islas. Nada más."* SEA_PLAY.md
 * sharpens it — a voyage at minute nine plays identically to minute one, so
 * NOTHING COMPOUNDS, and a survivors game without an in-run build is a survivors
 * game with one of its four legs missing. Kills produce loot numbers and nothing
 * else, which is why killing has never felt like getting anywhere.
 *
 * So: sinking things and taking sites earns *pertrechos*, and at thresholds the
 * voyage offers ONE OF THREE upgrades that last until the ship comes home.
 * Three from a pool, off the seeded stream, so a run has a shape the player
 * chose and the same voyage always offers the same choices.
 *
 * FOUR RULES, and each one is a decision rather than an implementation detail.
 *
 * 1. PURE AND SEEDED, like everything in sim/. No clock, no Math.random, no
 *    DOM. Every draw comes off `Rng` keyed on the voyage seed and the index of
 *    the offer, so offer #1 of seed "abc" is the same three cards on any device,
 *    in a test, and in a replay — and the harness can play a thousand voyages
 *    and count the picks (it does; see the calibration note on THRESHOLDS).
 *
 * 2. NOTHING SURVIVES DOCKING. A pertrecho lives on the voyage's own state and
 *    dies with it. RETENTION.md puts the long arc in the hulls, the island and
 *    the shipyard, and SEA_PLAY.md says so out loud: "No permanent power creep
 *    at sea." Which is also why this module has no `GameState` in it anywhere —
 *    there is no field it could persist into even by accident.
 *
 * 3. EVERY EFFECT LANDS ON A NUMBER THE SEA ALREADY READS. See `Loadout` below.
 *    Eight of the fourteen are multipliers on `ShipSpec` members `stepVoyage`
 *    reads today, and `riggedShip` applies all eight in one call; the other six
 *    are the named seams for the behaviours SEA_PLAY.md's other three items own.
 *    An upgrade whose effect nothing reads is a lie printed on a card.
 *
 * 4. ONE DECISION ON THE TABLE AT A TIME. Crossing a threshold while a choice is
 *    already up does not stack a second card on top of it; the offers queue and
 *    come one after the other. A player under fire can answer one question.
 */

/* ==========================================================================
 * THE SEAM — what a pertrecho is allowed to change
 * ======================================================================= */

/**
 * The loadout: every number a pertrecho can move, and nothing else.
 *
 * This is the contract between this module and the sea. It is deliberately
 * FLAT and deliberately DUMB — no functions, no behaviour, just numbers — so
 * that the voyage can carry one of these, `stepVoyage` can read it, and a save
 * or a replay can serialise it without knowing what any of it means.
 *
 * The neutral loadout is `emptyLoadout()`: multipliers at 1, additives at 0. A
 * voyage with no pertrechos taken sails EXACTLY the ship balance.json describes,
 * which is the property that lets this whole system be added without moving a
 * single number in the fleet table.
 *
 * The first eight are multipliers on fields of `ShipSpec` that `stepVoyage`
 * reads today, and `riggedShip()` below applies them all in one line. They need
 * no new code in the sea at all:
 *
 *   damage  the ball's bite            reload  seconds between broadsides
 *   range   how far a side reaches     speed   top speed under full throttle
 *   hold    units of cargo             repair  hull a second the crew patch back
 *
 * ...and note the DIRECTION of two of them: `reload` and `ballast` multiply a
 * cost, so BELOW 1 is the improvement. A pertrecho that made reload 1.2 would be
 * a downgrade printed as an upgrade.
 *
 * The rest are the named fields for behaviour the sea does not have yet. Each
 * one belongs to a specific SEA_PLAY.md item, is stated here in the units its
 * owner needs, and is inert until that owner reads it — a `chainSlow` of 0.24
 * changes nothing at all until the mob step multiplies a speed by it.
 */
export interface Loadout {
  /** × `ShipSpec.damage` — per BALL, not per broadside. Metralla trades this
   *  down for three of them. */
  damage: number;
  /** × `ShipSpec.reload`. Below 1 is faster. */
  reload: number;
  /** × `ShipSpec.range`. */
  range: number;
  /** × `ShipSpec.speed`. */
  speed: number;
  /** × `ShipSpec.hold`. Round it where you apply it; `riggedShip` does. */
  hold: number;
  /** × `ShipSpec.repair` — the carpenter's rate, not the calm before them. */
  repair: number;

  /** Balls per broadside, 1 at stock. The broadside block fires this many
   *  shots instead of one, each doing the (already reduced) `damage`. */
  balls: number;
  /** Half-angle in radians the extra balls are fanned across, 0 at stock. With
   *  `balls` at 1 this is meaningless and must be ignored. */
  spread: number;

  /** Fraction a struck creature's speed is taken down by, 0 at stock. The mob
   *  step should CLAMP the product — a slow of 1 is a stopped sea. */
  chainSlow: number;
  /** How long that slow lasts, seconds. 0 at stock, and 0 means never. */
  chainSeconds: number;

  /** World units a second a target inside the firing arc is dragged toward the
   *  beam, 0 at stock. The arpón: it pulls things INTO the guns rather than
   *  pulling the ship, so it can never be used to swim. */
  harpoon: number;

  /** × whatever rate SEA_PLAY.md item 1's tide climbs at. Below 1 is slower.
   *  Inert — and harmless — until la marea exists. */
  tideRate: number;

  /** ADDED to `sea.landfall.sunk` (0.5 today): the share of the hold that comes
   *  up with the crew when she goes down. Clamp the sum at 1 where it is read. */
  strongbox: number;

  /** × however much SEA_PLAY.md item 2's full hold slows and widens the ship.
   *  Below 1 is a lighter-feeling ship. Inert until the weight exists. */
  ballast: number;
}

export function emptyLoadout(): Loadout {
  return {
    damage: 1, reload: 1, range: 1, speed: 1, hold: 1, repair: 1,
    balls: 1, spread: 0,
    chainSlow: 0, chainSeconds: 0,
    harpoon: 0,
    tideRate: 1,
    strongbox: 0,
    ballast: 1,
  };
}

/**
 * The ship this loadout actually sails, from the ship balance.json describes.
 *
 * THE ONE-LINE SEAM. `stepVoyage` reads its `spec` exactly once at the top of
 * the step; swapping that read for
 *
 *     const spec = riggedShip(SHIPS[v.shipType], v.loadout);
 *
 * gives metralla's weaker balls, the gunners' faster reload, the fine powder's
 * reach, the copper bottom's speed, the shipwright's patching and the master
 * stowage's hold — six of the ten pertrechos — with no other change to the sea
 * at all, because every one of those fields is already read where it matters.
 *
 * Returns a NEW spec; `SHIPS` is a shared table and writing to it would change
 * the ship for every voyage in the process, which in a test runner is every
 * voyage in the suite.
 *
 * `hold` is rounded because it is counted in whole units of cargo by `stow`.
 * Nothing else is: a reload of 1.428 seconds is a perfectly good reload.
 */
export function riggedShip(spec: ShipSpec, loadout: Loadout): ShipSpec {
  return {
    ...spec,
    damage: spec.damage * loadout.damage,
    reload: spec.reload * loadout.reload,
    range: spec.range * loadout.range,
    speed: spec.speed * loadout.speed,
    hold: Math.round(spec.hold * loadout.hold),
    repair: spec.repair * loadout.repair,
  };
}

/* ==========================================================================
 * THE POOL
 * ======================================================================= */

export type PertrechoId =
  | 'metralla' | 'palanqueta' | 'polvora' | 'cobre' | 'artilleros'
  | 'arpon' | 'contramaestre' | 'bodega' | 'carpintero' | 'estiba';

export interface PertrechoSpec {
  id: PertrechoId;
  /** The name on the card, es-ES.
   *
   *  Copy lives in the sim here for the same reason `gems.ts` keeps a pack's
   *  label: the pertrecho IS the name. A card, a toast, an end-of-voyage list
   *  and a test all have to call it one thing, and a second table of strings
   *  somewhere in ui/ is how they stop agreeing. */
  name: string;
  /** One short line of what it does — one clause, present tense, tú-form. It
   *  has to be read in a second and a half while something is shooting at you,
   *  so it says the EFFECT, never the arithmetic. */
  line: string;
  /** How many times it can be taken. 1 means it is never offered again. */
  stacks: number;
  /** Fields multiplied once per level taken. */
  mul?: Partial<Loadout>;
  /** Fields added once per level taken. */
  add?: Partial<Loadout>;
}

/**
 * The ten. SEA_PLAY.md lists eight; the last two fill holes the eight leave.
 *
 * The eight are deliberately unchanged in intent — grape, chain, powder, copper,
 * gunners, harpoon, bosun, false hold — and every one lands on a `Loadout` field
 * above, which is the rule that stops this being a list of adjectives.
 *
 * WHAT WAS ADDED, AND WHY EACH SLOT WAS OBVIOUSLY MISSING:
 *
 *   `carpintero` — the eight contain NO way to survive better. Seven of them
 *     are guns and reach and one is a hull-speed bonus; a build that has drawn
 *     three offers has no answer at all to "the hull is going". `repair` is the
 *     rule sea.ts says makes sinking a decision rather than a countdown, so
 *     making it choosable is making that decision sharper, and it costs the sea
 *     nothing because `stepVoyage` already multiplies by `spec.repair`.
 *
 *   `estiba` — the hold is the entire point of leaving the harbour, and nothing
 *     in the eight lets you carry more. It also earns its place by being the one
 *     pertrecho that ARGUES with another item of the same design: SEA_PLAY.md
 *     item 2 makes a full hold slow the ship, so more capacity is more weight.
 *     A choice that is good for one system and bad for another is worth more
 *     than a choice that is simply good.
 *
 * The numbers are sized so that no single pick is the obvious one and no two
 * picks make an unanswerable ship. Reference points, on the day-one skiff
 * (damage 17, reload 1.7, range 54, speed 17, hold 900, repair 2.2):
 *
 *   metralla     3 balls at 8 damage — 24 if all three land, 8 if one does.
 *   artilleros   1.7s → 1.43s → 1.20s → 1.01s. The classic three-stack.
 *   polvora      54 → 64 → 75. A guard's leash is 28 + its site's radius, so
 *                the second level genuinely buys a standoff the sea refuses.
 *   cobre        17 → 18.7 → 20.6, against a hammerdead's 12.5.
 *   carpintero   2.2 → 3.2 → 4.6 hull a second, which is a skiff healed from
 *                half in sixteen seconds of not being bitten.
 *   estiba       900 → 1098 → 1340, about one deep site more per level.
 */
export const PERTRECHOS: readonly PertrechoSpec[] = [
  {
    id: 'metralla',
    name: 'Metralla',
    line: 'La andanada se abre en tres. Cada bola muerde menos.',
    stacks: 1,
    mul: { damage: 0.46 },
    add: { balls: 2, spread: 0.17 },
  },
  {
    id: 'palanqueta',
    name: 'Palanqueta',
    line: 'Bala encadenada: lo que tocas se queda atrás.',
    stacks: 2,
    add: { chainSlow: 0.24, chainSeconds: 1.8 },
  },
  {
    id: 'polvora',
    name: 'Pólvora fina',
    line: 'Tus cañones alcanzan más lejos por las dos bandas.',
    stacks: 2,
    mul: { range: 1.18 },
  },
  {
    id: 'cobre',
    name: 'Fondo de cobre',
    line: 'Casco limpio: más velocidad y menos lastre.',
    stacks: 2,
    mul: { speed: 1.1, ballast: 0.78 },
  },
  {
    id: 'artilleros',
    name: 'Brigada de artilleros',
    line: 'Recargan antes de que se lo pidas.',
    stacks: 3,
    mul: { reload: 0.84 },
  },
  {
    id: 'arpon',
    name: 'Arpón',
    line: 'Engancha y arrastra al arco lo que intenta huir.',
    stacks: 1,
    add: { harpoon: 9 },
  },
  {
    id: 'contramaestre',
    name: 'Contramaestre',
    line: 'Lleva la cuenta del mar: la marea sube más despacio.',
    stacks: 2,
    mul: { tideRate: 0.8 },
  },
  {
    id: 'bodega',
    name: 'Bodega falsa',
    line: 'Si te hunden, parte de la carga sube contigo.',
    stacks: 1,
    add: { strongbox: 0.2 },
  },
  {
    id: 'carpintero',
    name: 'Carpintero de ribera',
    line: 'Los tuyos remiendan el casco mucho más rápido.',
    stacks: 2,
    mul: { repair: 1.45 },
  },
  {
    id: 'estiba',
    name: 'Estiba maestra',
    line: 'Bien estibada, en la bodega cabe más.',
    stacks: 2,
    mul: { hold: 1.22 },
  },
];

const BY_ID = new Map<string, PertrechoSpec>(PERTRECHOS.map((p) => [p.id, p]));

export function pertrechoById(id: string): PertrechoSpec | null {
  return BY_ID.get(id) ?? null;
}

/** Every level of every pertrecho, taken. The ceiling on one voyage's picks,
 *  and what the offer runs out of if a player somehow reaches it. */
export const POOL_LEVELS: number = PERTRECHOS.reduce((n, p) => n + p.stacks, 0);

/* ==========================================================================
 * EARNING — what a kill and a site are worth
 * ======================================================================= */

/**
 * What sinking one of these is worth in pertrechos.
 *
 * Sized off the mob table in balance.json rather than invented: a blowfish is
 * two broadsides from a skiff, a kelpling three, a hammerdead four, and the
 * squid is 340 hull and a two-phase fight. So the ladder here is roughly what
 * the guns have to spend to get it, which is the only definition of "worth"
 * this system can honestly use.
 *
 * DELIBERATELY FLAT ACROSS RINGS. Deep water already pays more — `sea.loot`
 * multiplies every payout by `1 + ring` — and paying pertrechos by ring as well
 * would mean the build only happens where the player is already winning. The
 * whole point of the first threshold is that a day-one skiff in ring 1 meets
 * this system on its first voyage.
 */
export const KILL_VALUE: Record<string, number> = {
  blowfish: 1,
  kelpling: 2,
  hammerdead: 3,
  squid: 12,
};

/** What taking a site is worth. A reef is not a site and pays nothing; the rest
 *  follow how much trouble it is to get at, which is also the order they pay
 *  cargo in — a wreck is the boarding beat and the gold-richest thing afloat. */
export const SITE_VALUE: Record<string, number> = {
  harvest: 2,
  islet: 3,
  wreck: 4,
  lair: 6,
  reef: 0,
  none: 0,
};

/**
 * What one thing that happened at sea is worth.
 *
 * Takes the sea's OWN event union, so wiring this up is a fold over the events
 * `stepVoyage` already returns and there is no second vocabulary to keep in
 * step. Everything that is not a kill or a taking is worth nothing, including
 * the deep chest — that is a reward for a kill this already paid for.
 */
export function earnedBy(event: SeaEvent): number {
  if (event.kind === 'mob-killed') return KILL_VALUE[event.mob] ?? 0;
  if (event.kind === 'looted') return SITE_VALUE[event.site] ?? 0;
  return 0;
}

/* ==========================================================================
 * THE LADDER
 * ======================================================================= */

/**
 * What the nth choice costs, cumulatively. `FIRST` for the first, `STEP` more
 * for each one after it — so the offers come quickly at the start of a voyage
 * and slow down as it goes, which is the shape a run wants: a build that is
 * mostly decided by the time the water gets bad.
 *
 * CALIBRATED, NOT GUESSED. The sea is pure, so the question "how many choices
 * does a voyage actually give?" has a measured answer. Playing 120 seeded
 * voyages per row with the fleet autopilot (the same helm conversion
 * src/ui/stick.ts feeds, the model tools/tests/voyages.ts uses):
 *
 *   hull      plan         voyage     kills  sites  pertrechos   picks (med)
 *   skiff     ring 1        76s        5.5    7.0      26            3
 *   skiff     ring 2        52s        5.1    6.5      24            3
 *   skiff     ring 3        50s        5.5    6.4      25            3
 *   sloop     ring 3        66s        7.5    8.5      35            3
 *   galleon   ring 4        81s       16.5   11.6      56            5
 *
 * — and the first choice lands 8 to 9 seconds in on every one of those rows,
 * the second at ~21s, the third at ~37s. Three properties fall out of that and
 * all three are wanted:
 *
 *   · a brand-new player meets the system on their FIRST voyage, in the first
 *     ten seconds, which is how survivors games teach;
 *   · a day-one skiff run is a three-decision run, so the build is a shape the
 *     player chose rather than a single lucky card;
 *   · a better hull sails longer and richer and therefore builds FURTHER —
 *     the in-run build and RETENTION.md's long arc pull the same way instead of
 *     competing.
 *
 * A voyage would have to take every level in the pool — `POOL_LEVELS`, 18 — to
 * run the table out; the deepest measured run took 6.
 */
const FIRST = 5;
const STEP = 3;

export function threshold(n: number): number {
  if (n <= 0) return 0;
  // Closed form of the running sum of FIRST + STEP*(k-1). A loop here would be
  // walked on every step of every voyage by `progress`.
  return n * FIRST + STEP * ((n * (n - 1)) / 2);
}

/* ==========================================================================
 * THE OFFER
 * ======================================================================= */

/** One card on the table. */
export interface OfferCard {
  id: PertrechoId;
  /** What taking it would bring it to: 1 for a new one, 2+ for a stack. */
  level: number;
  /** The most it can ever reach, so the card can say "II de III". */
  stacks: number;
}

export interface Offer {
  /** Which choice of the voyage this is, 1-based. */
  index: number;
  /** The running total that opened it — the threshold that was crossed. */
  at: number;
  /** Three of them, unless the pool has less than three left to give. */
  cards: OfferCard[];
}

/**
 * A voyage's pertrechos, start to finish.
 *
 * Serialisable on purpose (no functions, no Maps): whatever ends up carrying
 * this — a field on `Voyage`, a field on a scene — can save it, log it and diff
 * it. `loadout` is DERIVED from `taken` and cached here only so the sea can read
 * it thirty times a second without rebuilding it; `loadoutOf(state.taken)` is
 * the definition and the test asserts the two never disagree.
 */
export interface PertrechosState {
  /** The voyage's seed. The offers are drawn off it. */
  seed: string;
  /** Pertrechos earned so far this voyage. */
  earned: number;
  /** Ids taken, ONE ENTRY PER LEVEL, in the order they were chosen. A stack
   *  taken twice appears twice, so `taken.length` is the number of choices the
   *  player has actually made. */
  taken: PertrechoId[];
  /** How many offers have been raised, which is the index into the seeded
   *  stream. Advanced even when the pool had nothing to give, so a spent pool
   *  cannot make the ladder retry forever. */
  offers: number;
  /** The choice on the table, or null when there is none. */
  offer: Offer | null;
  /** Derived from `taken`. See above. */
  loadout: Loadout;
}

export function startPertrechos(seed: string): PertrechosState {
  return { seed, earned: 0, taken: [], offers: 0, offer: null, loadout: emptyLoadout() };
}

/** How many levels of `id` are already taken. */
export function levelOf(taken: readonly PertrechoId[], id: PertrechoId): number {
  let n = 0;
  for (const t of taken) if (t === id) n++;
  return n;
}

/** The loadout a list of taken pertrechos adds up to. THE definition — the
 *  cached copy on the state is only ever this function's answer. */
export function loadoutOf(taken: readonly PertrechoId[]): Loadout {
  const loadout = emptyLoadout();
  for (const id of taken) {
    const spec = BY_ID.get(id);
    if (!spec) continue;   // an id this build does not carry changes nothing
    for (const [field, factor] of Object.entries(spec.mul ?? {}) as [keyof Loadout, number][]) {
      loadout[field] *= factor;
    }
    for (const [field, amount] of Object.entries(spec.add ?? {}) as [keyof Loadout, number][]) {
      loadout[field] += amount;
    }
  }
  return loadout;
}

/**
 * The three cards for choice `index`, given what is already taken.
 *
 * Deterministic in the strong sense: a pure function of the seed, the index and
 * the taken list, drawn from a stream forked on all of the first two. Nothing
 * about WHEN the threshold was crossed, how long the voyage has run, or what the
 * player was doing at the time reaches it — so the same voyage played the same
 * way always offers the same choices, and offer #1 is a function of the seed
 * alone, because nothing has been taken yet.
 *
 * A maxed pertrecho is not eligible, which is what makes the pool drain. Below
 * three eligible it offers what is left rather than padding with a repeat: two
 * real choices are a choice and a duplicate card is a bug on a screen.
 */
export function offerFor(seed: string, index: number, taken: readonly PertrechoId[]): OfferCard[] {
  const eligible = PERTRECHOS.filter((p) => levelOf(taken, p.id) < p.stacks);
  const rng = new Rng(`${seed}:pertrechos:${index}`);
  const cards: OfferCard[] = [];
  // Draw without replacement, so the three are always distinct.
  const bag = [...eligible];
  const want = Math.min(3, bag.length);
  for (let i = 0; i < want; i++) {
    const spec = bag.splice(rng.int(0, bag.length - 1), 1)[0];
    cards.push({ id: spec.id, level: levelOf(taken, spec.id) + 1, stacks: spec.stacks });
  }
  return cards;
}

/**
 * Earn `amount` pertrechos, and raise a choice if that crossed a threshold.
 *
 * Returns a NEW state like the rest of sim/. At most one offer is raised per
 * call and never while one is already up — the offers queue instead, which is
 * the "one decision on the table" rule and the reason a player who kills three
 * things in one broadside is asked one question rather than three.
 */
export function earn(state: PertrechosState, amount: number): PertrechosState {
  if (!(amount > 0)) return state;
  const next: PertrechosState = { ...state, earned: state.earned + amount, taken: [...state.taken] };
  return raise(next);
}

/** Folds a step's events into the state. The whole wiring on the sea's side. */
export function noteEvents(state: PertrechosState, events: readonly SeaEvent[]): PertrechosState {
  let total = 0;
  for (const event of events) total += earnedBy(event);
  return earn(state, total);
}

/** Raises the next offer if one is due and none is up. In place on a state the
 *  caller has already copied. */
function raise(state: PertrechosState): PertrechosState {
  if (state.offer) return state;
  const index = state.offers + 1;
  if (state.earned < threshold(index)) return state;
  const cards = offerFor(state.seed, index, state.taken);
  // The pool is spent. The threshold is still consumed — otherwise every later
  // earn would rebuild an empty offer for the rest of the voyage.
  if (cards.length === 0) return { ...state, offers: index };
  return { ...state, offers: index, offer: { index, at: threshold(index), cards } };
}

/** Whether `id` is one of the cards actually on the table. */
export function canTake(state: PertrechosState, id: string): boolean {
  return state.offer?.cards.some((c) => c.id === id) ?? false;
}

/**
 * Take one of the three. Applies it to the loadout FOR THIS VOYAGE and clears
 * the table, then raises the next offer if the player had already earned past
 * its threshold while deciding.
 *
 * An id that is not on the table is REFUSED rather than applied — `taken` is
 * null and the state comes back untouched. The panel can only tap what it drew,
 * but the sim is the thing that decides, and an action that trusts its caller is
 * an action that can be raced.
 */
export function takeOffer(
  state: PertrechosState, id: string
): { pertrechos: PertrechosState; taken: { spec: PertrechoSpec; level: number } | null } {
  const card = state.offer?.cards.find((c) => c.id === id);
  const spec = card ? BY_ID.get(card.id) : undefined;
  if (!card || !spec) return { pertrechos: state, taken: null };
  const taken = [...state.taken, card.id];
  return {
    pertrechos: raise({ ...state, taken, offer: null, loadout: loadoutOf(taken) }),
    taken: { spec, level: card.level },
  };
}

/* ==========================================================================
 * READOUTS — what a HUD needs, so it never has to do this arithmetic itself
 * ======================================================================= */

export interface PertrechoProgress {
  /** Pertrechos earned this voyage. */
  earned: number;
  /** The threshold already passed — the bottom of the current bar. */
  from: number;
  /** The threshold the next choice needs. */
  to: number;
  /** 0..1 across the bar. */
  fraction: number;
  /** Choices made so far — `taken.length`, named for the screen. */
  picks: number;
}

export function progress(state: PertrechosState): PertrechoProgress {
  const from = threshold(state.offers);
  const to = threshold(state.offers + 1);
  const span = Math.max(1, to - from);
  return {
    earned: state.earned,
    from,
    to,
    fraction: Math.max(0, Math.min(1, (state.earned - from) / span)),
    picks: state.taken.length,
  };
}

/** What was taken, grouped and in pick order — the end-of-voyage list, and the
 *  one place anything needs to read a build back rather than apply it. */
export function taken(state: PertrechosState): { spec: PertrechoSpec; level: number }[] {
  const out: { spec: PertrechoSpec; level: number }[] = [];
  for (const id of state.taken) {
    const spec = BY_ID.get(id);
    if (!spec) continue;
    const already = out.find((e) => e.spec.id === id);
    if (already) already.level++;
    else out.push({ spec, level: 1 });
  }
  return out;
}
