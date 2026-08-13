import {
  RIVAL_COUNT, SEASON_EPOCH, SEASON_LENGTH_DAYS, playerScore, season, standings,
} from '../../src/sim/rivals';
import { NAME_MAX, createDemoIsland, tick, clearObstacle, DAY, HOUR } from '../../src/sim';
import { describe, eq, near, ok, test } from './harness';
import { T0, TZ, game, rich } from './fixtures';

/**
 * rivals.test.ts — the leaderboard's pure core (src/sim/rivals.ts).
 *
 * Everything a server would normally vouch for has to be vouched for here
 * instead: the season calendar is a fixed rule, the ghosts advance while the
 * app is shut and never run backwards inside a season, the player is ranked
 * mid-pack on a played island and bottom-of-table on day one, and the whole
 * board replays byte-identically — which is what will let a real backend
 * replace the ✎ SEAM in the panel without changing a pixel above it.
 */

const demo = () => createDemoIsland('test', T0, TZ);

describe('the season calendar', () => {
  test('seasons are four fixed UTC weeks from the epoch', () => {
    const first = season(SEASON_EPOCH);
    eq(first.index, 0, 'the epoch opens season 1');
    eq(first.day, 0, 'on its first day');
    eq(first.endsAt - first.startsAt, SEASON_LENGTH_DAYS * DAY, 'four weeks long');
    eq(season(SEASON_EPOCH + SEASON_LENGTH_DAYS * DAY).index, 1, 'and the next follows immediately');
    eq(season(SEASON_EPOCH + SEASON_LENGTH_DAYS * DAY - 1).index, 0, 'with no gap at the boundary');
  });

  test('the fixture instant lands mid-season, which is what the captures show', () => {
    // T0 is 2026-01-05 12:00 UTC; the epoch is Monday 2025-12-22. Fourteen
    // days in — the middle of season 1, so every leaderboard shot photographs
    // a live race rather than a flag drop or a finish line.
    const s = season(T0);
    eq(s.index, 0, 'season 1');
    eq(s.day, 14, 'day 15 of 28');
    ok(s.endsAt - T0 > 13 * DAY && s.endsAt - T0 < 14 * DAY, 'about two weeks on the countdown');
  });
});

describe('the player score', () => {
  test('is derived from the save, and playing raises it', () => {
    const fresh = playerScore(game());
    ok(fresh >= 0, 'day one scores something non-negative');
    ok(playerScore(demo()) > fresh + 1000, 'a played island scores far above day one');

    // Any counted deed moves it — here, clearing the wilderness.
    let state = game();
    const target = state.obstacles[0];
    state = clearObstacle(state, target.id, T0).state;
    state = tick(state, T0 + 12 * HOUR).state; // the clear finishes in the tick
    ok(state.stats.obstacles > 0, 'the clear was counted');
    ok(playerScore(state) > fresh, 'and the score rose with it');
  });

  test('adds no field to the save', () => {
    // Derived means derived: scoring a state twice changes nothing in it.
    const state = demo();
    const before = JSON.stringify(state);
    playerScore(state);
    standings(state, T0);
    eq(JSON.stringify(state), before, 'the save is read, never written');
  });
});

describe('the board', () => {
  test('50 rows, ranked 1..50, sorted, with the player exactly once', () => {
    const board = standings(demo(), T0);
    eq(board.rows.length, RIVAL_COUNT + 1, '49 rivals plus the captain');
    for (let i = 0; i < board.rows.length; i++) {
      eq(board.rows[i].rank, i + 1, `row ${i} carries rank ${i + 1}`);
      if (i > 0) ok(board.rows[i - 1].score >= board.rows[i].score, 'scores descend');
    }
    const you = board.rows.filter((r) => r.you);
    eq(you.length, 1, 'the player appears once');
    eq(board.you.rank, you[0].rank, 'and the pinned row is that same row');
    eq(you[0].name, demo().captain.name, 'under the captain\'s saved name');
  });

  test('rival names are real names: unique, bounded, never the captain\'s', () => {
    const board = standings(demo(), T0);
    const names = board.rows.filter((r) => !r.you).map((r) => r.name);
    eq(new Set(names).size, RIVAL_COUNT, 'no two rivals share a name');
    for (const name of names) {
      ok(name.length > 0 && name.length <= NAME_MAX + 3, `"${name}" fits a row`);
      ok(name !== board.you.name, 'and none impersonates the captain');
    }
  });

  test('the board is deterministic, and another seed deals another pack', () => {
    eq(
      JSON.stringify(standings(demo(), T0)),
      JSON.stringify(standings(demo(), T0)),
      'same save, same instant, same board — byte for byte'
    );
    const a = standings(rich('one'), T0).rows.map((r) => r.name).join('|');
    const b = standings(rich('two'), T0).rows.map((r) => r.name).join('|');
    ok(a !== b, 'a different island meets different rivals');
  });

  test('a played island ranks mid-pack — the race is live at the capture', () => {
    const { you } = standings(demo(), T0);
    ok(you.rank >= 8 && you.rank <= 44, `demo island ranks ${you.rank}, in the middle of 50`);
  });

  test('a day-one island starts at the bottom and climbs by playing', () => {
    const fresh = standings(game(), T0);
    ok(fresh.you.rank > 45, `day one ranks ${fresh.you.rank} — the only way is up`);
    ok(fresh.rows[0].score >= 1000, 'yet the board above is populated, not zeros');

    // The demo island is the same seed with a month of play on it, and it
    // ranks strictly better: the ladder rewards the thing the game is about.
    ok(standings(demo(), T0).you.rank < fresh.you.rank, 'progress climbs the table');
  });
});

describe('the ghosts play while you are away', () => {
  test('every rival\'s score rises with time inside a season, never falls', () => {
    const state = demo();
    const at = (t: number) =>
      new Map(standings(state, t).rows.filter((r) => !r.you).map((r) => [r.name, r.score]));
    let previous = at(T0);
    for (const hours of [6, 24, 72, 7 * 24]) {
      const later = at(T0 + hours * HOUR);
      for (const [name, score] of later) {
        ok((previous.get(name) ?? 0) <= score, `${name} did not lose ground at +${hours}h`);
      }
      previous = later;
    }
  });

  test('an idle player is overtaken as the season runs', () => {
    const state = demo();
    const early = standings(state, T0).you.rank;
    const late = standings(state, T0 + 12 * DAY).you.rank;
    ok(late > early, `idle from rank ${early} to ${late}: the pack kept sailing`);
  });

  test('the season boundary re-deals the race', () => {
    const state = demo();
    const s = season(T0);
    const closing = standings(state, s.endsAt - HOUR);
    const opening = standings(state, s.endsAt + HOUR);
    eq(opening.season.index, closing.season.index + 1, 'a new season began');

    // The pack restarts its curve: the board's total score visibly drops…
    const total = (rows: typeof closing.rows) =>
      rows.filter((r) => !r.you).reduce((sum, r) => sum + r.score, 0);
    ok(total(opening.rows) < total(closing.rows) * 0.85, 'the ghosts reset to a fresh run');

    // …but the same faces return — the roster is the island's, not the season's.
    const names = (rows: typeof closing.rows) => rows.filter((r) => !r.you).map((r) => r.name).sort().join('|');
    eq(names(opening.rows), names(closing.rows), 'against the same 49 rivals');
  });

  test('mid-season, half the plan is roughly half realised', () => {
    // The growth curve is normalised per rival, so at the season midpoint the
    // pack as a whole sits near the middle of its 0.70 → 1.30 run. This pins
    // the curve's SHAPE, not one rival's dice.
    const state = rich('curva');
    const s = season(T0);
    const mid = s.startsAt + (SEASON_LENGTH_DAYS / 2) * DAY;
    const sum = standings(state, mid).rows.filter((r) => !r.you).reduce((a, r) => a + r.score, 0);
    const start = standings(state, s.startsAt).rows.filter((r) => !r.you).reduce((a, r) => a + r.score, 0);
    const end = standings(state, s.endsAt - 1).rows.filter((r) => !r.you).reduce((a, r) => a + r.score, 0);
    near(sum, (start + end) / 2, (end - start) * 0.12, 'the pack is near halfway at half time');
  });
});
