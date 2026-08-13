import { Rng } from '../core/rng';
import { NAME_MAX, nameAgrees, rollName } from './captain';
import { townHallLevel } from './economy';
import { DAY } from './duration';
import type { GameState } from './types';

/**
 * rivals.ts — the leaderboard's pure core. ROADMAP.md round 10:
 *
 *   > "Leaderboard. A real one needs a server, which contradicts PLAN.md's
 *   > offline scope. Built over seeded rival captains so the surface, the
 *   > ranking and the season reset are real and playable, with the fetch
 *   > behind one named seam a backend can replace."
 *
 * So the rivals are GHOSTS in the racing-game sense: deterministic captains
 * rolled from the player's own seed, whose scores advance as a pure function
 * of time — they "play" while the app is shut — and who are re-dealt every
 * season. Everything here is arithmetic over (state, now): no clock, no
 * randomness outside the seeded Rng, no network. The one network-shaped hole
 * is `fetchStandings` in src/ui/panels/leaderboard.ts (the ✎ SEAM), whose
 * body today is a call into this file and whose replacement is a real API.
 *
 * HOW A RIVAL SCORES, and why it is anchored rather than absolute.
 *
 * Each rival carries a per-season multiplier `m` (0.12–1.55) and a season
 * target of `m × anchor`, where the anchor is the PLAYER'S own score (floored
 * at 2 400 so a day-one island still meets a populated board). The rival walks
 * toward that target through the season — 0.70 of it at the flag drop, 1.30 by
 * the final day, in uneven daily steps drawn from its own stream, monotonic
 * within a season, reset at the boundary.
 *
 * Anchoring is the honest choice for a board with no server behind it. With
 * absolute targets, a six-month save sits at rank 1 forever and the surface is
 * exposed as furniture in a minute; anchored, the board stays a live race at
 * every save age — play and you pass rivals mid-pack, stop and the pack's
 * season curve rolls over you. The multipliers are fixed per season, so WHO is
 * ahead of you is stable and beatable, not a rubber band snapping shut. A real
 * backend replaces all of this at the seam and nothing above it changes.
 */

/* --------------------------------------------------------------------------
 * the season — RETENTION.md §8's four-week calendar, as a fixed UTC rule
 * ----------------------------------------------------------------------- */

export const SEASON_LENGTH_DAYS = 28;

/**
 * Season 1 opened on Monday 2025-12-22 at 00:00 UTC, and every season is
 * exactly four weeks from there — a fixed calendar rule, not a per-player one,
 * so two captains comparing phones are always in the same season. UTC rather
 * than local: a boundary that moved with the device timezone would let a
 * flight extend a season, and the backend that one day owns this line (see the
 * seam) would run on UTC anyway.
 */
export const SEASON_EPOCH = Date.UTC(2025, 11, 22);

export interface Season {
  /** 0-based internally; the panel prints `index + 1`. */
  index: number;
  startsAt: number;
  endsAt: number;
  /** 0-based day within the season, 0..27. */
  day: number;
  lengthDays: number;
}

export function season(now: number): Season {
  const lengthMs = SEASON_LENGTH_DAYS * DAY;
  const index = Math.max(0, Math.floor((now - SEASON_EPOCH) / lengthMs));
  const startsAt = SEASON_EPOCH + index * lengthMs;
  return {
    index,
    startsAt,
    endsAt: startsAt + lengthMs,
    day: Math.min(SEASON_LENGTH_DAYS - 1, Math.max(0, Math.floor((now - startsAt) / DAY))),
    lengthDays: SEASON_LENGTH_DAYS,
  };
}

/* --------------------------------------------------------------------------
 * the player's score — derived, never stored
 * ----------------------------------------------------------------------- */

/**
 * One number from what the save already proves, so no field is added and no
 * migration is owed: the hall, every standing level, the counted deeds (the
 * same `stats` the quests trust) and the notoriety the rank ladder already
 * tracks. Monotone in play — every weight is on a thing that only grows — with
 * the one exception the ladder itself has: notoriety decays, so a long absence
 * costs a few points, which is exactly what a season table wants absence to do.
 */
const SCORE = {
  perHallLevel: 300, // per hall level above 1 — the backbone of progression
  perBuildingLevel: 40, // every standing level of every building, hall included
  perUpgrade: 20,
  perObstacle: 12,
  perChest: 30,
  perCaptainLevel: 120, // per XP level above 1
} as const;

export function playerScore(state: GameState): number {
  let levels = 0;
  for (const b of state.buildings) levels += Math.max(0, b.level);
  return Math.max(
    0,
    Math.round(
      SCORE.perHallLevel * (townHallLevel(state) - 1) +
        SCORE.perBuildingLevel * levels +
        SCORE.perUpgrade * state.stats.upgrades +
        SCORE.perObstacle * state.stats.obstacles +
        SCORE.perChest * state.stats.chestsOpened +
        SCORE.perCaptainLevel * (state.level - 1) +
        Math.floor(state.notoriety)
    )
  );
}

/* --------------------------------------------------------------------------
 * the rivals
 * ----------------------------------------------------------------------- */

/** 49 ghosts + the player = a 50-row board, Clash's own page size. */
export const RIVAL_COUNT = 49;

/** A brand-new island still meets a real pack — this is the smallest anchor
 *  the pack is ever built on, roughly an Ayuntamiento-3 island's score. */
const ANCHOR_FLOOR = 2400;

/** Season progress the pack has realised at the flag drop / the final bell.
 *  0.70 → 1.30 of target keeps a season opening from being a board of zeros
 *  and a season close from being a runaway. */
const START_FACTOR = 0.7;
const END_FACTOR = 1.3;

export interface StandingRow {
  rank: number;
  name: string;
  score: number;
  you: boolean;
}

export interface Standings {
  season: Season;
  /** All 50 rows, rank 1 first. */
  rows: StandingRow[];
  /** The player's own row again, for the pinned strip. */
  you: StandingRow;
}

/**
 * The rival names, rolled once from the player's seed — NOT per season — so
 * the same faces return month after month and beating "Cuervo el Salado"
 * again means something. They come from the captain's own name roller
 * (captain.ts) so the two can never drift apart in flavour, but a draw is
 * REJECTED and re-drawn when:
 *
 *   · it already sits on the roster (192 combinations, 49 unique draws — the
 *     loop always terminates, and deterministically);
 *   · it filled the NAME_MAX box, because rollName truncates and one player
 *     meeting "Bartolomé la Gavio" on a scoreboard reads it as a bug — which
 *     is exactly how it was found;
 *   · its article disagrees with its given name ("Diego la Sirena"). A player
 *     typing their own name may do as they please; a table of 49 names WE
 *     wrote gets its Spanish right. Round 11's gate moved that rule INTO
 *     rollName itself — the captain's own field was still dealing "Tobías la
 *     Corsaria" — so the checks below are now the roster's belt and braces
 *     over a roller that already refuses those draws, kept because this
 *     roster must stay right even if the roller loosens.
 */
const agrees = nameAgrees;

function rosterNames(seed: string): string[] {
  const rng = new Rng(seed).fork('rivales');
  const names: string[] = [];
  const taken = new Set<string>();
  while (names.length < RIVAL_COUNT) {
    const name = rollName(rng);
    if (taken.has(name) || name.length >= NAME_MAX || !agrees(name)) continue;
    taken.add(name);
    names.push(name);
  }
  return names;
}

/**
 * How far through its season plan rival `i` is at `now`, as a 0..1 fraction.
 *
 * The plan is 28 uneven daily efforts drawn from the rival's own per-season
 * stream — some days it grinds, some days it barely sails — accumulated and
 * normalised. Within a season this only rises, which is the property the suite
 * pins: a score that went DOWN overnight would read as the game losing count.
 */
function seasonProgress(seed: string, seasonIndex: number, i: number, now: number, s: Season): number {
  const rng = new Rng(seed).fork(`rivales:s${seasonIndex}:r${i}`);
  const weights: number[] = [];
  let total = 0;
  for (let d = 0; d < SEASON_LENGTH_DAYS; d++) {
    const w = 0.5 + rng.next();
    weights.push(w);
    total += w;
  }
  const dayFrac = Math.min(1, Math.max(0, (now - s.startsAt - s.day * DAY) / DAY));
  let done = 0;
  for (let d = 0; d < s.day; d++) done += weights[d];
  done += weights[s.day] * dayFrac;
  return Math.min(1, done / total);
}

/** The rival's fixed per-season multiplier against the anchor, 0.12–1.55. */
function multiplier(seed: string, seasonIndex: number, i: number): number {
  const rng = new Rng(seed).fork(`rivales:s${seasonIndex}:m${i}`);
  return 0.12 + 1.43 * rng.next();
}

/**
 * The whole board at one instant. Pure: same state, same now, same rows.
 *
 * Ties go to the player — on a board of ghosts, "you drew level" should read
 * as a pass — and between rivals to the earlier name, so the order is total
 * and replays byte-identically.
 */
export function standings(state: GameState, now: number): Standings {
  const s = season(now);
  const mine = playerScore(state);
  const anchor = Math.max(ANCHOR_FLOOR, mine);
  const names = rosterNames(state.seed);

  const entries: Array<{ name: string; score: number; you: boolean; order: number }> = [
    { name: state.captain.name, score: mine, you: true, order: -1 },
  ];
  for (let i = 0; i < RIVAL_COUNT; i++) {
    const grown = START_FACTOR + (END_FACTOR - START_FACTOR) * seasonProgress(state.seed, s.index, i, now, s);
    // A ghost wearing the captain's own name would read as the game mocking
    // them; the suffix keeps the roster deterministic and the row distinct.
    const name = names[i] === state.captain.name ? `${names[i]} II` : names[i];
    entries.push({ name, score: Math.round(multiplier(state.seed, s.index, i) * anchor * grown), you: false, order: i });
  }

  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.you !== b.you) return a.you ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.order - b.order;
  });

  const rows: StandingRow[] = entries.map((e, at) => ({
    rank: at + 1,
    name: e.name,
    score: e.score,
    you: e.you,
  }));
  return { season: s, rows, you: rows.find((r) => r.you)! };
}
