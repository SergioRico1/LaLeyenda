import type { Rng } from '../core/rng';
import { BALANCE, RESOURCE_IDS, type Cost } from './balance';
import { DAY, HOUR, MINUTE } from './duration';
import { grantInPlace, townHallLevel } from './economy';
import { awardChestInPlace } from './chests';
import type { GameState, Quest } from './types';

/**
 * progression.ts — the day-scale hooks: the daily chain, the three dailies,
 * and XP.
 *
 * Calendar days are computed from an epoch and a stored timezone offset, never
 * from `Date`. PLAN.md's golden rule is that nothing in src/sim/ reads a clock;
 * `tzOffsetMinutes` is captured by src/core/ and travels in the save.
 */

/**
 * The local day number, optionally shifted so the boundary is not midnight.
 * `tzOffsetMinutes` is `Date#getTimezoneOffset` — minutes WEST of UTC.
 */
export function localDayIndex(now: number, tzOffsetMinutes: number, boundaryHour = 0): number {
  return Math.floor((now - tzOffsetMinutes * MINUTE - boundaryHour * HOUR) / DAY);
}

/* --------------------------------------------------------------------------
 * §4.6 — the seven-day chain
 * ----------------------------------------------------------------------- */

export function dailyAvailable(state: GameState, now: number): boolean {
  return localDayIndex(now, state.tzOffsetMinutes) !== state.daily.lastClaimedDay;
}

/** What tomorrow pays, named — the fixed closing line of the daily panel. */
export function dailyReward(state: GameState, offset = 0) {
  const days = BALANCE.daily.days;
  const index = (state.daily.day - 1 + offset) % days.length;
  const week = Math.min(BALANCE.daily.weeklyMultiplier.length - 1, state.daily.week);
  return { day: days[index], multiplier: BALANCE.daily.weeklyMultiplier[week] };
}

export function claimDailyInPlace(state: GameState, now: number): { day: number; gems: number; resources: Cost; chest: string | null } {
  const { day, multiplier } = dailyReward(state);
  const resources: Cost = {};
  for (const r of RESOURCE_IDS) {
    const amount = day.resources?.[r] ?? 0;
    if (amount > 0) resources[r] = Math.round(amount * multiplier);
  }
  grantInPlace(state, resources);

  const gems = Math.round((day.gems ?? 0) * multiplier);
  state.gems += gems;

  if (day.chest) awardChestInPlace(state, day.chest);
  if (day.tempBuilderMs) {
    state.builders.tempUntil = Math.max(state.builders.tempUntil ?? now, now) + day.tempBuilderMs;
  }

  state.daily.lastClaimedDay = localDayIndex(now, state.tzOffsetMinutes);
  state.daily.day = day.day >= BALANCE.daily.days.length ? 1 : day.day + 1;
  if (state.daily.day === 1) state.daily.week++;

  return { day: day.day, gems, resources, chest: day.chest ?? null };
}

/* --------------------------------------------------------------------------
 * §4.7 — three dailies, refreshed at 04:00 LOCAL
 * ----------------------------------------------------------------------- */

export function questDayIndex(state: GameState, now: number): number {
  return localDayIndex(now, state.tzOffsetMinutes, BALANCE.quests.refreshHour);
}

export function rollQuestsInPlace(state: GameState, now: number, rng: Rng): void {
  const hall = townHallLevel(state);
  const pool = BALANCE.quests.pool.filter((q) => q.minTownHall <= hall);
  const picked: Quest[] = [];
  const taken = new Set<string>();

  // Weighted by Ayuntamiento level only through the pool filter and the target
  // scale — a level-8 island is not asked to collect 500 wood.
  const scale = 1 + (hall - 1) * BALANCE.quests.targetScalePerTownHall;

  while (picked.length < Math.min(BALANCE.quests.dailyCount, pool.length)) {
    const spec = rng.pick(pool);
    if (taken.has(spec.id)) continue;
    taken.add(spec.id);
    const target = Math.max(1, Math.round(spec.target * (spec.metric === 'upgrades' || spec.metric === 'chestsOpened' ? 1 : scale)));
    picked.push({
      id: spec.id,
      text: spec.text.replace('{target}', String(target)),
      metric: spec.metric,
      target,
      progress: 0,
      claimed: false,
      resources: Object.fromEntries(
        Object.entries(spec.resources).map(([r, v]) => [r, Math.round((v ?? 0) * scale)])
      ) as Cost,
    });
  }

  state.quests.daily = picked;
  state.quests.rolledDay = questDayIndex(state, now);
}

/** Bumps a counter and every unclaimed quest watching it. */
export function noteInPlace(state: GameState, metric: keyof GameState['stats'], amount = 1): void {
  state.stats[metric] = (state.stats[metric] ?? 0) + amount;
  for (const quest of state.quests.daily) {
    if (quest.claimed || quest.metric !== metric) continue;
    quest.progress = Math.min(quest.target, quest.progress + amount);
  }
}

export const questComplete = (quest: Quest): boolean => !quest.claimed && quest.progress >= quest.target;

export function claimableQuests(state: GameState): number {
  return state.quests.daily.filter(questComplete).length;
}

export function claimQuestInPlace(state: GameState, index: number): boolean {
  const quest = state.quests.daily[index];
  if (!quest || !questComplete(quest)) return false;
  quest.claimed = true;
  state.gems += BALANCE.quests.reward.gemas;
  state.quests.coronas += BALANCE.quests.reward.coronas;
  grantInPlace(state, quest.resources);
  addXpInPlace(state, BALANCE.xp.perQuest);

  // §4.5 — 10 coronas is a Cofre de la Corona, ~3.3 days of dailies.
  if (state.quests.coronas >= BALANCE.chests.crownChest.at) {
    state.quests.coronas -= BALANCE.chests.crownChest.at;
    awardChestInPlace(state, BALANCE.chests.crownChest.type);
  }
  return true;
}

/* --------------------------------------------------------------------------
 * XP — §4.7: it unlocks NOTHING. It is the free "you progressed" signal for
 * the sessions where nothing else finished.
 * ----------------------------------------------------------------------- */

export function xpForLevel(level: number): number {
  const { base, growth } = BALANCE.xp.levelCurve;
  return Math.round(base * Math.pow(growth, Math.max(0, level - 1)));
}

/** Returns the new level if the player levelled up, else null. */
export function addXpInPlace(state: GameState, amount: number): number | null {
  if (amount <= 0) return null;
  state.xp += amount;
  let levelled: number | null = null;
  let need = xpForLevel(state.level);
  while (state.xp >= need) {
    state.xp -= need;
    state.level++;
    levelled = state.level;
    need = xpForLevel(state.level);
  }
  return levelled;
}
