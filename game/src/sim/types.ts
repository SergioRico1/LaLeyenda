import type { Cost, ResourceId } from './balance';

/**
 * types.ts — the game state.
 *
 * PLAN.md's second multiplayer rule: **the whole save is ONE serializable
 * versioned object**. What goes to IndexedDB today could go to a row in a
 * database tomorrow by changing only SaveStore. So: no class instances, no
 * Map/Set, no Date, no functions, no undefined-as-a-value. Everything here
 * survives JSON.stringify → JSON.parse unchanged.
 *
 * Time is always an epoch-ms number that was passed IN from core/. Nothing in
 * src/sim/ ever reads a clock.
 */

/**
 * 2 — OPENING.md added `obstacles` / `nextObstacleId`. A version-1 save has
 * neither, and `state.obstacles.some(…)` on `undefined` throws before the first
 * frame, so this is a bump rather than a defensive default in ten call sites.
 */
export const SIM_VERSION = 2;

export type BuildingId = number;

export interface Work {
  /** 'build' places a new building, 'upgrade' raises an existing one. */
  kind: 'build' | 'upgrade';
  toLevel: number;
  startedAt: number;
  endsAt: number;
}

export interface Building {
  id: BuildingId;
  type: string;
  x: number;
  z: number;
  /** 0 while a 'build' job is running — the plot exists, the building does not. */
  level: number;
  /** PRODUCERS ONLY — the resource sitting in the building's own internal
   *  capacity, waiting to be collected. This is §4.2's first cap; the store is
   *  the second. RETENTION.md fuses them, §9 says that is a mistake. */
  stock: number;
  /** Non-null while this building occupies a builder. */
  work: Work | null;
}

/**
 * OPENING.md part 3: the empty land is covered in things you clear.
 *
 * An obstacle is A CELL PROPERTY, not a scene object — it lives in the save
 * next to the buildings, it occupies buildable ground on purpose, and it is
 * removed by the player rather than by a seed. That is the whole difference
 * from `src/scenes/decor.ts`, which scatters props for looks on ground no
 * building could ever claim.
 *
 * The payout is rolled ONCE, when the field is seeded, and stored. Two reasons:
 * the tick path stays free of randomness (`advanceInPlace` runs several times a
 * second on a clone), and the UI can promise the number before the player
 * spends a builder on it, which is what Clash does.
 */
export interface Obstacle {
  id: number;
  /** Which balance row times and prices it. */
  tier: 'small' | 'large';
  /** The model family the renderer draws — 'palmera', 'roca', 'pecio', … */
  kind: string;
  x: number;
  z: number;
  /** What clearing it pays, rolled at seed time. */
  pays: { madera: number; gems: number };
  /** Non-null while a builder is clearing it. Occupies that builder. */
  work: { startedAt: number; endsAt: number } | null;
}

export interface ChestSlot {
  /** null = the slot is empty. */
  type: string | null;
  state: 'empty' | 'waiting' | 'unlocking' | 'ready';
  /** Epoch ms the unlock finishes; null unless unlocking. */
  endsAt: number | null;
  /** The full unlock duration, so a progress bar has a denominator. */
  totalMs: number;
}

export interface DailyState {
  /** 1..7, the day of the chain that will be claimed next. */
  day: number;
  /** Local day index of the last claim, or null if never claimed. */
  lastClaimedDay: number | null;
  /** Weeks completed, index into balance.daily.weeklyMultiplier. */
  week: number;
  stormPasses: number;
}

export interface Quest {
  id: string;
  text: string;
  metric: string;
  target: number;
  progress: number;
  claimed: boolean;
  resources: Cost;
}

export interface QuestState {
  daily: Quest[];
  /** The 04:00-shifted local day the current three were rolled for (§4.7). */
  rolledDay: number | null;
  coronas: number;
}

/** Everything the quests and the Diario count. Plain numbers so it serializes. */
export interface Stats {
  collects: number;
  upgrades: number;
  chestsOpened: number;
  obstacles: number;
  'collected.oro': number;
  'collected.madera': number;
  'collected.ron': number;
  'collected.metal': number;
}

export interface GameState {
  /** Bumped by src/core/save.ts migrations, not by gameplay. */
  version: number;
  seed: string;
  createdAt: number;
  /** The sim clock: epoch ms of the last integrated instant. */
  now: number;
  /** Minutes WEST of UTC, i.e. Date#getTimezoneOffset. Captured by core/ and
   *  stored so day boundaries stay pure inside the sim. */
  tzOffsetMinutes: number;
  /** Serialized Rng cursor, so a reload continues the same stream. */
  rngState: number;

  buildings: Building[];
  nextBuildingId: BuildingId;

  /** The uncleared wilderness. Seeded from `seed` so an island is the player's
   *  own, and shrinking only — nothing regrows it. */
  obstacles: Obstacle[];
  nextObstacleId: number;

  /** The STORE totals. Capped by the store buildings, not by the producers. */
  store: Record<ResourceId, number>;
  gems: number;

  xp: number;
  level: number;
  notoriety: number;

  builders: {
    /** Permanent builders. §4.3 / §9: the game starts with TWO. */
    owned: number;
    /** §4.10 beat 2:25 — a 24h loan. Epoch ms it expires, or null. */
    tempUntil: number | null;
  };

  chests: ChestSlot[];
  /** Epoch ms the next Cofre Libre becomes available at the Muelle. */
  freeChestAt: number;
  freeChestsBanked: number;

  daily: DailyState;
  quests: QuestState;
  stats: Stats;

  /** One-shot UI flags (tutorial beats seen, pills revealed…). */
  flags: Record<string, boolean>;
}

/* --------------------------------------------------------------------------
 * events — what a tick or an action DID, for the UI to celebrate
 * ----------------------------------------------------------------------- */

export type SimEvent =
  | { type: 'work-finished'; buildingId: BuildingId; building: string; toLevel: number; at: number }
  | { type: 'producer-full'; buildingId: BuildingId; resource: ResourceId; at: number }
  | { type: 'chest-ready'; slot: number; chest: string; at: number }
  | { type: 'chest-opened'; slot: number; chest: string; loot: Record<string, number> }
  | { type: 'collected'; buildingId: BuildingId; resource: ResourceId; amount: number; spilled: number }
  | { type: 'quest-complete'; questId: string }
  | { type: 'daily-claimed'; day: number }
  | { type: 'builder-expired'; at: number }
  | { type: 'obstacle-cleared'; obstacleId: number; kind: string; x: number; z: number; madera: number; gems: number; at: number }
  | { type: 'level-up'; level: number };

export interface SimResult {
  state: GameState;
  events: SimEvent[];
}

/** Actions that can fail return this instead of throwing: the UI needs the
 *  reason so it can name the key rather than dead-tap (§3.5). */
export type Refusal =
  | 'unknown-building'
  | 'busy'
  | 'no-builders'
  | 'max-level'
  /** The island already holds as many of this building as the hall allows. */
  | 'max-count'
  /** §3.15 — the footprint under the finger overlaps something already built. */
  | 'cell-occupied'
  /** reference/SPACING.md — it fits, but it would abut its neighbour. Buildings
   *  keep a gap on the order of their own width, because empty ground is what
   *  makes built ground legible. */
  | 'too-close'
  /** OPENING.md — there is a palm, a rock or a wreck standing on that ground.
   *  Clear it first; that is the tutorial's whole first instruction. */
  | 'obstacle'
  /** No obstacle by that id — it was already cleared, probably in another tab. */
  | 'unknown-obstacle'
  | 'town-hall-too-low'
  | 'not-enough-resources'
  | 'not-enough-gems'
  | 'store-full'
  | 'nothing-to-collect'
  | 'slot-busy'
  | 'another-chest-unlocking'
  | 'not-ready'
  | 'already-claimed';

export interface ActionResult extends SimResult {
  ok: boolean;
  refusal?: Refusal;
}
