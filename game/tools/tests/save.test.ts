import {
  MIGRATIONS, SAVE_VERSION, exportFilename, migrate, parseSave, serialize, type SaveEnvelope,
} from '../../src/core/save';
import { HOUR, MINUTE, collect, isValidLook, startUpgrade, tick, type GameState } from '../../src/sim';
import { describe, eq, ok, test } from './harness';
import { T0, find, game, rich } from './fixtures';

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
