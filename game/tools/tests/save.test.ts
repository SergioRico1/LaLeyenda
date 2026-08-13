import {
  MIGRATIONS, SAVE_VERSION, SaveError, exportFilename, migrate, parseSave, serialize,
  type SaveEnvelope,
} from '../../src/core/save';
import { HOUR, MINUTE, collect, isValidLook, startUpgrade, tick, type GameState } from '../../src/sim';
import { describe, eq, ok, test } from './harness';
import { T0, find, game, rich } from './fixtures';

/* --------------------------------------------------------------------------
 * every version this game has ever written
 *
 * A migration chain is only worth what its OLDEST link is worth, and up to now
 * each link was tested alone: version 1 got its obstacles, version 2 got its
 * captain, and nobody ever walked a save the whole way. That is the case a
 * real player is in — someone who installed this in week one and opens it
 * today goes 1 → 2 → 3 in one load — and it is the case where a migration that
 * quietly rebuilds state instead of adding to it does its damage.
 *
 * The fixtures are derived from what the migrations THEMSELVES declare they
 * add, because that is the actual contract: `MIGRATIONS[1]` says a version-1
 * state has no `obstacles` and no `nextObstacleId`, and `MIGRATIONS[2]` says a
 * version-2 state has no `captain`. Deriving them from the table rather than
 * hand-copying an old JSON means a fourth version cannot be added without this
 * file noticing.
 * ----------------------------------------------------------------------- */

/** The fields each version bump introduced — the inverse of the migrations. */
const ADDED_AT: Record<number, readonly string[]> = {
  2: ['obstacles', 'nextObstacleId'],
  3: ['captain'],
};

/** A played island as version `v` would have stored it: today's state with
 *  every field a later version introduced taken back off. */
function asVersion(state: GameState, v: number): SaveEnvelope {
  const envelope = JSON.parse(serialize(state, T0)) as SaveEnvelope;
  const stripped = JSON.parse(JSON.stringify(envelope.state)) as Record<string, unknown>;
  for (let later = v + 1; later <= SAVE_VERSION; later++) {
    for (const field of ADDED_AT[later] ?? []) delete stripped[field];
  }
  stripped.version = v;
  return { ...envelope, version: v, state: stripped as unknown as GameState };
}

/** A real island in mid-flight: stores full, a builder out on a job that has
 *  not finished, and five hours on the clock. Everything a migration could
 *  drop is something a player would notice missing. */
function played(): GameState {
  let state = tick(rich(), T0 + 5 * HOUR).state;
  state = startUpgrade(state, find(state, 'almacen').id, state.now).state;
  return tick(state, state.now + 5 * MINUTE).state;
}

describe('the save envelope', () => {
  test('a game state survives a JSON round trip byte for byte', () => {
    const state = tick(game(), T0 + 5 * HOUR).state;
    const text = serialize(state, T0);
    const back = parseSave(text).state;
    eq(JSON.stringify(back), JSON.stringify(state), 'nothing is lost in the envelope');
  });

  test('the state holds no Map, Set, Date, class or undefined', () => {
    // PLAN.md rule 2: one serializable versioned object. A Map here would
    // silently become {} on the way to IndexedDB.
    const state = tick(rich(), T0 + HOUR).state;
    const walk = (value: unknown, path: string): void => {
      if (value === null) return;
      if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
      switch (typeof value) {
        case 'number': case 'string': case 'boolean': return;
        case 'object': {
          ok(Object.getPrototypeOf(value) === Object.prototype, `${path} is a plain object`);
          for (const [k, v] of Object.entries(value as object)) {
            ok(v !== undefined, `${path}.${k} is not undefined`);
            walk(v, `${path}.${k}`);
          }
          return;
        }
        default:
          ok(false, `${path} is a ${typeof value}`);
      }
    };
    walk(state, 'state');
  });

  test('garbage is refused with a message a human can read', () => {
    const cases: Array<[string, string]> = [
      ['not json at all', 'not JSON'],
      ['{"hello":1}', 'not a La Leyenda save'],
      ['{"format":"la-leyenda-save"}', 'missing its version'],
    ];
    for (const [text, fragment] of cases) {
      let message = '';
      try { parseSave(text); } catch (err) { message = String(err); }
      ok(message.includes(fragment), `"${text.slice(0, 20)}…" → ${fragment} (got: ${message})`);
    }
  });

  test('a save from the future is refused rather than half-loaded', () => {
    const envelope = JSON.parse(serialize(game(), T0)) as SaveEnvelope;
    envelope.version = SAVE_VERSION + 5;
    let message = '';
    try { migrate(envelope); } catch (err) { message = String(err); }
    ok(message.includes('newer version'), `named the problem (got: ${message})`);
  });

  test('the migration hook runs every step between the two versions', () => {
    // Exercised with a temporary chain, so the mechanism is proven before the
    // first real migration exists rather than the day it is needed.
    const envelope = JSON.parse(serialize(game(), T0)) as SaveEnvelope;
    const older = { ...envelope, version: SAVE_VERSION - 2, state: { ...envelope.state, marks: [] as string[] } };
    // Saved and restored rather than deleted: MIGRATIONS[SAVE_VERSION - 1] is a
    // REAL step now, and a `finally` that deletes it left the suite running
    // against a table with a hole in it — which the next test then read as a
    // missing migration.
    const shadowed = { ...MIGRATIONS };
    MIGRATIONS[SAVE_VERSION - 2] = (s) => ({ ...s, marks: [...((s.marks as string[]) ?? []), 'a'] });
    MIGRATIONS[SAVE_VERSION - 1] = (s) => ({ ...s, marks: [...((s.marks as string[]) ?? []), 'b'] });
    try {
      const out = migrate(older as unknown as SaveEnvelope);
      eq(out.version, SAVE_VERSION, 'ends at the current version');
      eq(JSON.stringify((out.state as unknown as { marks: string[] }).marks), '["a","b"]', 'both steps ran, in order');
    } finally {
      for (const key of Object.keys(MIGRATIONS)) delete MIGRATIONS[Number(key)];
      Object.assign(MIGRATIONS, shadowed);
    }
  });

  test('a version-1 save loads, and does not grow a wilderness through its roofs', () => {
    // The first real migration. A v1 island has no `obstacles` at all, and the
    // sim reads that array on every tick — so without this the save does not
    // fail to load, it loads and then throws on frame 1.
    const envelope = JSON.parse(serialize(game(), T0)) as SaveEnvelope;
    const { obstacles, nextObstacleId, ...withoutTheField } =
      JSON.parse(JSON.stringify(envelope.state)) as Record<string, unknown>;
    ok(obstacles !== undefined && nextObstacleId !== undefined, 'the current save does carry them');
    const v1 = { ...envelope, version: 1, state: withoutTheField };

    const out = migrate(v1 as unknown as SaveEnvelope);
    eq(out.version, SAVE_VERSION, 'brought up to date');
    eq(out.state.obstacles.length, 0, 'with an EMPTY field — an old island has already had its opening');
    eq(out.state.nextObstacleId, 1, 'and a usable id counter');
    // The real proof: it survives a tick, which is what actually broke.
    ok(tick(out.state, T0 + HOUR).state.now === T0 + HOUR, 'and it ticks');
  });

  test('a captain-less save keeps its island, its timers and every resource', () => {
    // THE migration that could cost someone their game. A version-2 save is a
    // played island — this one has a store full of wood, a builder on the
    // Almacén and five hours on the clock — and the only thing it lacks is an
    // identity. It must come back with the identity ADDED and nothing else
    // touched; a player who already has an island must never be sent to
    // captain creation, and must not lose one plank on the way through here.
    let played = tick(rich(), T0 + 5 * HOUR).state;
    played = startUpgrade(played, find(played, 'almacen').id, played.now).state;
    // Five minutes into a twenty-minute job, so the save is caught with a
    // builder actually out on it rather than after it finished.
    played = tick(played, played.now + 5 * MINUTE).state;

    const envelope = JSON.parse(serialize(played, T0)) as SaveEnvelope;
    const { captain, ...withoutTheField } =
      JSON.parse(JSON.stringify(envelope.state)) as Record<string, unknown>;
    ok(captain !== undefined, 'the current save does carry a captain');
    const v2 = { ...envelope, version: 2, state: withoutTheField };

    const out = migrate(v2 as unknown as SaveEnvelope);
    eq(out.version, SAVE_VERSION, 'brought up to date');

    // The island, item for item.
    eq(out.state.buildings.length, played.buildings.length, 'every building survived');
    eq(
      JSON.stringify(out.state.buildings),
      JSON.stringify(played.buildings),
      'with their levels, their stock and their running work untouched'
    );
    eq(JSON.stringify(out.state.store), JSON.stringify(played.store), 'the stores are intact');
    eq(out.state.gems, played.gems, 'the gems are intact');
    eq(out.state.now, played.now, 'the clock did not move');
    eq(JSON.stringify(out.state.chests), JSON.stringify(played.chests), 'the tray is intact');
    eq(JSON.stringify(out.state.quests), JSON.stringify(played.quests), 'the quests are intact');
    ok(out.state.buildings.some((b) => b.work), 'and the builder is still on the job');

    // Everything the old save had is still there, key for key. This is the
    // assertion that catches a migration which rebuilds the state instead of
    // adding to it.
    for (const key of Object.keys(withoutTheField)) {
      eq(
        JSON.stringify((out.state as unknown as Record<string, unknown>)[key]),
        JSON.stringify(withoutTheField[key]),
        `${key} came through unchanged`
      );
    }

    // And the one thing that IS new.
    ok(out.state.captain.name.length > 0, 'it arrives with a named captain');
    eq(out.state.captain.seed, played.seed, 'whose island is the one they were already on');
    ok(isValidLook(out.state.captain.look), 'wearing parts we actually ship');
    ok(tick(out.state, out.state.now + HOUR).state.now > played.now, 'and it ticks');
  });

  test('a save whose captain is wearing a part we no longer ship is repaired, not refused', () => {
    const envelope = JSON.parse(serialize(game(), T0)) as SaveEnvelope;
    const state = JSON.parse(JSON.stringify(envelope.state)) as GameState;
    state.captain.look.body = 'av_body_from_a_mod';
    state.captain.name = '';

    const out = migrate({ ...envelope, state });
    ok(isValidLook(out.state.captain.look), 'the look is drawable again');
    ok(out.state.captain.name.length > 0, 'and the captain has a name');
    eq(out.state.buildings.length, envelope.state.buildings.length, 'the island was not touched');
  });

  test('a version with no migration fails loudly instead of loading a broken state', () => {
    const envelope = JSON.parse(serialize(game(), T0)) as SaveEnvelope;
    // The lowest version below the current one that has no step. It used to be
    // written as SAVE_VERSION - 1, which stopped being a gap the day the first
    // real migration was written.
    let gap = SAVE_VERSION - 1;
    while (gap >= 0 && MIGRATIONS[gap]) gap--;
    ok(gap >= 0, 'there is a version with no migration to test with');
    let message = '';
    try { migrate({ ...envelope, version: gap }); } catch (err) { message = String(err); }
    ok(message.includes('no migration'), `named the gap (got: ${message})`);
  });

  test('the export filename is a file a person can find again', () => {
    ok(/^la-leyenda-\d{8}-\d{4}\.json$/.test(exportFilename(T0)), exportFilename(T0));
  });
});

describe('every version this game has ever written', () => {
  test('the chain has no holes: every version below this one has a step', () => {
    // The invariant that makes the rest of this group possible. A hole means a
    // player at that version is stranded — `migrate` throws, `load` quarantines
    // their island, and they are handed a blank one.
    const missing: number[] = [];
    for (let v = 1; v < SAVE_VERSION; v++) if (!MIGRATIONS[v]) missing.push(v);
    eq(missing.join(','), '', `no version between 1 and ${SAVE_VERSION - 1} is stranded`);
  });

  test('the fixtures really are older saves — each lacks what its version lacked', () => {
    // Guards the test, not the code. If a later round adds a field and forgets
    // ADDED_AT, `asVersion(state, 1)` silently starts producing a modern save
    // and every assertion below passes for the wrong reason.
    const now = played();
    for (const [version, fields] of Object.entries(ADDED_AT)) {
      const older = asVersion(now, Number(version) - 1).state as unknown as Record<string, unknown>;
      for (const field of fields) {
        ok(!(field in older), `a version-${Number(version) - 1} save has no ${field}`);
      }
    }
    eq(Object.keys(asVersion(now, SAVE_VERSION).state).length,
       Object.keys(now).length, 'and the current version strips nothing');
  });

  for (let version = 1; version <= SAVE_VERSION; version++) {
    test(`a version-${version} save keeps its island, its resources, its timers and its captain`, () => {
      const before = played();
      const out = migrate(asVersion(before, version));

      eq(out.version, SAVE_VERSION, 'arrives at the current version');
      eq(out.state.version, SAVE_VERSION, 'and says so on the state itself');

      // THE ISLAND. Every building, at its level, with its stock and its work.
      eq(JSON.stringify(out.state.buildings), JSON.stringify(before.buildings),
        'every building, level, stock and running job came through untouched');

      // THE RESOURCES.
      eq(JSON.stringify(out.state.store), JSON.stringify(before.store), 'the stores are intact');
      eq(out.state.gems, before.gems, 'the gems are intact');
      eq(out.state.xp, before.xp, 'the xp is intact');

      // THE TIMERS. Not merely present — still RUNNING, with the same end.
      const job = out.state.buildings.find((b) => b.work);
      const was = before.buildings.find((b) => b.work);
      ok(!!job && !!was, 'the builder is still out on a job');
      eq(job?.work?.endsAt, was?.work?.endsAt, 'ending at the same instant it always would have');
      ok((job?.work?.endsAt ?? 0) > out.state.now, 'which is still in the future');
      eq(out.state.now, before.now, 'and the clock did not move');
      eq(JSON.stringify(out.state.chests), JSON.stringify(before.chests), 'the chest timers are intact');
      eq(out.state.freeChestAt, before.freeChestAt, 'the Muelle timer is intact');

      // THE CAPTAIN. Rolled from their own seed when the save predates them.
      ok(out.state.captain.name.length > 0, 'there is a named captain');
      eq(out.state.captain.seed, before.seed, 'whose island is the one they were on');
      ok(isValidLook(out.state.captain.look), 'wearing parts we actually ship');

      // And the whole point of all of it: it runs.
      const ticked = tick(out.state, out.state.now + HOUR).state;
      eq(ticked.now, out.state.now + HOUR, 'and an hour passes on it without throwing');
    });
  }

  test('a save from the future is refused WITHOUT being touched', () => {
    // "Refuse gracefully rather than corrupting itself." The refusal is only
    // half of it: the dangerous version of this bug is one that runs today's
    // migrations over a state written by a later build, drops the fields this
    // build has never heard of, and writes the result back. So the input is
    // compared byte for byte after the throw.
    const envelope = JSON.parse(serialize(played(), T0)) as SaveEnvelope;
    const fromTheFuture = { ...envelope, version: SAVE_VERSION + 1 };
    const before = JSON.stringify(fromTheFuture);

    let caught: unknown = null;
    try { migrate(fromTheFuture); } catch (err) { caught = err; }

    ok(caught instanceof SaveError, 'it throws a SaveError a caller can branch on');
    eq((caught as SaveError).fault, 'newer', 'named as a downgrade, not as damage');
    ok(String(caught).includes('newer version'), `and readable (got: ${String(caught)})`);
    eq(JSON.stringify(fromTheFuture), before, 'and the save it refused is byte-identical');
  });

  test('one version ahead is refused as firmly as ten', () => {
    for (const ahead of [1, 2, 10, 999]) {
      const envelope = JSON.parse(serialize(game(), T0)) as SaveEnvelope;
      let fault = '';
      try { migrate({ ...envelope, version: SAVE_VERSION + ahead }); }
      catch (err) { fault = err instanceof SaveError ? err.fault : 'not-a-SaveError'; }
      eq(fault, 'newer', `version ${SAVE_VERSION + ahead} refused`);
    }
  });
});

describe('determinism', () => {
  test('the same seed and the same taps produce the same save', () => {
    const play = (seed: string) => {
      let state = rich(seed);
      state = tick(state, T0 + 2 * HOUR).state;
      state = collect(state, find(state, 'aserradero').id).state;
      state = startUpgrade(state, find(state, 'almacen').id, state.now).state;
      state = tick(state, state.now + 6 * HOUR).state;
      return serialize(state, 0);
    };
    eq(play('same'), play('same'), 'byte-identical replays');
    ok(play('same') !== play('other'), 'and a different seed really is different');
  });
});
