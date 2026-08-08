import raw from '../data/balance.json';
import { parseDuration } from './duration';

/**
 * balance.ts — the typed, duration-resolved view of src/data/balance.json.
 *
 * balance.json is the source of truth for every number in UI_SPEC §4. This
 * module does two things and nothing else:
 *   1. gives it types, so a missing field is a compile error rather than a
 *      NaN that reaches the HUD;
 *   2. resolves the "1d 12h" duration strings to ms exactly once, at load.
 *
 * It invents no numbers. If a value is not in the JSON it is not available.
 */

export type ResourceId = 'oro' | 'madera' | 'ron' | 'metal';
export const RESOURCE_IDS: readonly ResourceId[] = ['oro', 'madera', 'ron', 'metal'];

export type Cost = Partial<Record<ResourceId, number>>;

export interface LevelSpec {
  /** Producers only: units per hour. */
  rate?: number;
  /** Producers: the building's OWN internal capacity (§4.2's first cap).
   *  Stores: the resource cap of the store (§4.2's second cap). */
  capacity?: number;
  cost: Cost;
  /** Resolved from the JSON's duration string. */
  timeMs: number;
  ship?: string;
}

export type BuildingKind = 'townhall' | 'producer' | 'store' | 'support';

export interface BuildingSpec {
  id: string;
  label: string;
  kind: BuildingKind;
  resource?: ResourceId;
  model: string;
  footprint: number;
  unlockAtTownHall: number;
  /** Index 0 = Ayuntamiento 1. How many of this building may exist. */
  countByTownHall: number[];
  /** Index 0 = Ayuntamiento 1. The highest level this building may reach.
   *  Per building, because one global "no building outranks the hall" rule
   *  either walls the early game or lets a Ayto-3 island reach a Fundición
   *  upgrade costing ten times any bank it can build (see invariant.ts). */
  maxLevelByTownHall?: number[];
  levels: LevelSpec[];
  unlocksAction?: string;
  /** Sits on the shoreline rather than on the buildable plateau (the Muelle). */
  waterfront?: boolean;
}

export interface TownHallLevel {
  level: number;
  cost: Cost;
  timeMs: number;
  /** The Clash rule: no building outranks the Town Hall. */
  maxBuildingLevel: number;
  unlocks: string[];
}

export interface ChestSpec {
  id: string;
  label: string;
  rarity: string;
  timeMs: number;
  loot: Record<string, [number, number]>;
  guaranteedSkin?: boolean;
}

export interface DailyDay {
  day: number;
  resources?: Cost;
  gems?: number;
  chest?: string;
  tempBuilderMs?: number;
  featured?: boolean;
}

export interface QuestSpec {
  id: string;
  text: string;
  metric: string;
  target: number;
  minTownHall: number;
  resources: Cost;
}

interface RawLevel {
  rate?: number;
  capacity?: number;
  cost?: Record<string, number>;
  time: string;
  ship?: string;
}

interface RawBuilding {
  label: string;
  kind: string;
  resource?: string;
  model: string;
  footprint: number;
  unlockAtTownHall: number;
  countByTownHall: number[];
  maxLevelByTownHall?: number[];
  levels?: RawLevel[];
  levelsFrom?: string;
  unlocksAction?: string;
  waterfront?: boolean;
}

const data = raw as unknown as {
  version: number;
  resources: Record<string, { label: string; store: string; revealAtTownHall: number; pillRow: number }>;
  townHall: { building: string; levels: Array<{ level: number; cost?: Record<string, number>; time: string; maxBuildingLevel: number; unlocks: string[] }> };
  buildings: Record<string, RawBuilding>;
  builders: {
    start: number; max: number;
    unlock: Array<{ n: number; gems: number; free: string }>;
    tempBuilder: { duration: string };
  };
  gemSpeedup: {
    goldenRuleUnder: string; goldenRuleCost: number;
    tiers: Array<{ under: string | null; base: number; perMinuteOver?: number; overMinutes?: number; perHourOver?: number; overHours?: number }>;
  };
  chests: {
    slots: number; concurrentUnlocks: number;
    types: Record<string, { label: string; rarity: string; time: string; loot: Record<string, [number, number]>; guaranteedSkin?: boolean }>;
    freeChest: { every: string; stack: number; type: string };
    crownChest: { at: number; type: string };
  };
  daily: {
    pauseOnMiss: boolean; stormPassesPerMonth: number; weeklyMultiplier: number[];
    days: Array<{ day: number; resources?: Record<string, number>; gems?: number; chest?: string; tempBuilder?: string; featured?: boolean }>;
  };
  quests: {
    dailyCount: number; refreshHour: number;
    reward: { coronas: number; gemas: number };
    pool: Array<{ id: string; text: string; metric: string; target: number; minTownHall: number; resources: Record<string, number> }>;
    targetScalePerTownHall: number;
  };
  obstacles: {
    maxOnIsland: number; respawnEvery: string;
    small: { time: string; madera: [number, number]; gemChance: number; gems: [number, number] };
    large: { time: string; madera: [number, number]; gemChance: number; gems: [number, number] };
  };
  ranks: {
    perDivisionOfflineBonus: number; divisionsPerRank: number;
    tiers: Array<{ id: string; label: string; at: number }>;
    decayPerDay: number;
  };
  xp: { perBuildSecondsSqrt: number; perObstacle: number; perQuest: number; levelCurve: { base: number; growth: number } };
  offline: { graceDays: number; beyondGraceMultiplier: number; longAbsence: string; longAbsenceGiftChest: string };
  invariant: { storageHeadroom: number };
  placement: { plotFactor: number };
};

const asCost = (cost: Record<string, number> | undefined): Cost => (cost ?? {}) as Cost;

const townHallLevels: TownHallLevel[] = data.townHall.levels.map((l) => ({
  level: l.level,
  cost: asCost(l.cost),
  timeMs: parseDuration(l.time),
  maxBuildingLevel: l.maxBuildingLevel,
  unlocks: l.unlocks,
}));

const buildings: Record<string, BuildingSpec> = {};
for (const [id, b] of Object.entries(data.buildings)) {
  const levels: LevelSpec[] = b.levelsFrom === 'townHall'
    ? townHallLevels.map((l) => ({ cost: l.cost, timeMs: l.timeMs }))
    : (b.levels ?? []).map((l) => ({
        rate: l.rate,
        capacity: l.capacity,
        cost: asCost(l.cost),
        timeMs: parseDuration(l.time),
        ship: l.ship,
      }));
  buildings[id] = {
    id,
    label: b.label,
    kind: b.kind as BuildingKind,
    resource: b.resource as ResourceId | undefined,
    model: b.model,
    footprint: b.footprint,
    unlockAtTownHall: b.unlockAtTownHall,
    countByTownHall: b.countByTownHall,
    maxLevelByTownHall: b.maxLevelByTownHall,
    levels,
    unlocksAction: b.unlocksAction,
    waterfront: b.waterfront,
  };
}

const chests: Record<string, ChestSpec> = {};
for (const [id, c] of Object.entries(data.chests.types)) {
  chests[id] = {
    id, label: c.label, rarity: c.rarity,
    timeMs: parseDuration(c.time),
    loot: c.loot,
    guaranteedSkin: c.guaranteedSkin,
  };
}

export const BALANCE = {
  version: data.version,

  resources: data.resources as Record<ResourceId, { label: string; store: string; revealAtTownHall: number; pillRow: number }>,

  townHall: {
    building: data.townHall.building,
    levels: townHallLevels,
    maxLevel: townHallLevels.length,
  },

  buildings,

  builders: {
    start: data.builders.start,
    max: data.builders.max,
    unlock: data.builders.unlock,
    tempBuilderMs: parseDuration(data.builders.tempBuilder.duration),
  },

  gemSpeedup: {
    goldenRuleUnderMs: parseDuration(data.gemSpeedup.goldenRuleUnder),
    goldenRuleCost: data.gemSpeedup.goldenRuleCost,
    tiers: data.gemSpeedup.tiers.map((t) => ({
      underMs: t.under === null ? Infinity : parseDuration(t.under),
      base: t.base,
      perMinuteOver: t.perMinuteOver ?? 0,
      overMinutes: t.overMinutes ?? 0,
      perHourOver: t.perHourOver ?? 0,
      overHours: t.overHours ?? 0,
    })),
  },

  chests: {
    slots: data.chests.slots,
    concurrentUnlocks: data.chests.concurrentUnlocks,
    types: chests,
    freeChest: {
      everyMs: parseDuration(data.chests.freeChest.every),
      stack: data.chests.freeChest.stack,
      type: data.chests.freeChest.type,
    },
    crownChest: data.chests.crownChest,
  },

  daily: {
    pauseOnMiss: data.daily.pauseOnMiss,
    stormPassesPerMonth: data.daily.stormPassesPerMonth,
    weeklyMultiplier: data.daily.weeklyMultiplier,
    days: data.daily.days.map<DailyDay>((d) => ({
      day: d.day,
      resources: asCost(d.resources),
      gems: d.gems,
      chest: d.chest,
      tempBuilderMs: d.tempBuilder ? parseDuration(d.tempBuilder) : undefined,
      featured: d.featured,
    })),
  },

  quests: {
    dailyCount: data.quests.dailyCount,
    refreshHour: data.quests.refreshHour,
    reward: data.quests.reward,
    targetScalePerTownHall: data.quests.targetScalePerTownHall,
    pool: data.quests.pool.map<QuestSpec>((q) => ({
      id: q.id, text: q.text, metric: q.metric, target: q.target,
      minTownHall: q.minTownHall, resources: asCost(q.resources),
    })),
  },

  obstacles: {
    maxOnIsland: data.obstacles.maxOnIsland,
    respawnEveryMs: parseDuration(data.obstacles.respawnEvery),
    small: { ...data.obstacles.small, timeMs: parseDuration(data.obstacles.small.time) },
    large: { ...data.obstacles.large, timeMs: parseDuration(data.obstacles.large.time) },
  },

  ranks: data.ranks,
  xp: data.xp,

  offline: {
    graceDays: data.offline.graceDays,
    beyondGraceMultiplier: data.offline.beyondGraceMultiplier,
    longAbsenceMs: parseDuration(data.offline.longAbsence),
    longAbsenceGiftChest: data.offline.longAbsenceGiftChest,
  },

  invariant: data.invariant,
  placement: data.placement,
} as const;

/* --------------------------------------------------------------------------
 * lookups — the sim never indexes BALANCE.buildings directly
 * ----------------------------------------------------------------------- */

export function buildingSpec(type: string): BuildingSpec {
  const spec = BALANCE.buildings[type];
  if (!spec) throw new Error(`[balance] unknown building type: ${type}`);
  return spec;
}

/** The level row for a 1-based building level, clamped to the ladder. */
export function levelSpec(type: string, level: number): LevelSpec {
  const spec = buildingSpec(type);
  const index = Math.max(1, Math.min(spec.levels.length, level)) - 1;
  return spec.levels[index];
}

export function maxLevel(type: string): number {
  return buildingSpec(type).levels.length;
}

/** §4.2's Clash rule, read out of the town hall table rather than hard-coded. */
export function maxBuildingLevelAt(townHall: number): number {
  const rows = BALANCE.townHall.levels;
  const row = rows[Math.max(1, Math.min(rows.length, townHall)) - 1];
  return row.maxBuildingLevel;
}

/** How many of `type` the island may hold at this Ayuntamiento level. */
export function allowedCount(type: string, townHall: number): number {
  const spec = buildingSpec(type);
  const i = Math.max(1, Math.min(spec.countByTownHall.length, townHall)) - 1;
  return spec.countByTownHall[i];
}

/**
 * The highest level `type` may hold at this Ayuntamiento level.
 *
 * Per-building, from `maxLevelByTownHall`, falling back to the town hall's own
 * blanket rule. This one number is what keeps §4.2's storage invariant
 * satisfiable: it is the gate that stops a Ayto-3 island from being offered a
 * 250 000-oro Fundición upgrade its banks could never hold.
 */
export function maxLevelAt(type: string, townHall: number): number {
  const spec = buildingSpec(type);
  if (spec.kind === 'townhall') return Math.min(spec.levels.length, BALANCE.townHall.maxLevel);
  const hall = Math.max(1, Math.min(BALANCE.townHall.maxLevel, townHall));
  const ladder = spec.maxLevelByTownHall;
  const cap = ladder ? (ladder[hall - 1] ?? 0) : maxBuildingLevelAt(hall);
  return Math.min(spec.levels.length, cap);
}

/** The highest level `type` can reach at this Ayuntamiento level, or 0 if it
 *  is not unlocked yet at all. */
export function reachableLevel(type: string, townHall: number): number {
  const spec = buildingSpec(type);
  if (townHall < spec.unlockAtTownHall) return 0;
  if (spec.kind === 'townhall') return townHall;
  return maxLevelAt(type, townHall);
}

export function storeTypeFor(resource: ResourceId): string {
  return BALANCE.resources[resource].store;
}

export const chestSpec = (type: string): ChestSpec => {
  const spec = BALANCE.chests.types[type];
  if (!spec) throw new Error(`[balance] unknown chest type: ${type}`);
  return spec;
};
