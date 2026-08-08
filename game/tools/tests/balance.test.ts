import {
  BALANCE, auditStorage, checkStorageInvariant, checkStoreLadder, gemSpeedupCost,
  parseDuration, HOUR, MINUTE, DAY,
} from '../../src/sim';
import { describe, eq, ok, test } from './harness';

const n = (v: number) => v.toLocaleString('en-US').replace(/,/g, ' ');

describe('balance.json — the tables load', () => {
  test('every duration string parses', () => {
    // parseDuration throws on anything it cannot read, and BALANCE resolves
    // every one at import, so simply reaching here proves the file is readable.
    eq(parseDuration('0'), 0, '"0" is zero');
    eq(parseDuration('45s'), 45_000, '"45s"');
    eq(parseDuration('7m'), 7 * MINUTE, '"7m"');
    eq(parseDuration('1d 12h'), DAY + 12 * HOUR, '"1d 12h"');
    eq(parseDuration('3d 12h'), 3 * DAY + 12 * HOUR, '"3d 12h"');
    let threw = false;
    try { parseDuration('soon'); } catch { threw = true; }
    ok(threw, 'an unreadable duration throws rather than becoming 0');
  });

  test('every producer level has a rate and its own capacity', () => {
    for (const spec of Object.values(BALANCE.buildings)) {
      if (spec.kind !== 'producer') continue;
      spec.levels.forEach((row, i) => {
        ok((row.rate ?? 0) > 0, `${spec.label} Nv${i + 1} has a rate`);
        ok((row.capacity ?? 0) > 0, `${spec.label} Nv${i + 1} has a capacity`);
      });
    }
  });

  test('every store level has a capacity, and they only go up', () => {
    for (const spec of Object.values(BALANCE.buildings)) {
      if (spec.kind !== 'store') continue;
      let previous = 0;
      spec.levels.forEach((row, i) => {
        const cap = row.capacity ?? 0;
        ok(cap > previous, `${spec.label} Nv${i + 1} capacity ${n(cap)} > Nv${i} ${n(previous)}`);
        previous = cap;
      });
    }
  });

  test('§4.2 fill time sets the session cadence: 3h early → 12h late', () => {
    const saw = BALANCE.buildings.aserradero.levels;
    const hours = (i: number) => (saw[i].capacity ?? 0) / (saw[i].rate ?? 1);
    eq(Math.round(hours(0)), 3, 'Aserradero Nv1 fills in 3h');
    eq(Math.round(hours(7)), 12, 'Aserradero Nv8 fills in 12h');
  });

  test('§4.3 / §9 — the game starts with TWO builders', () => {
    eq(BALANCE.builders.start, 2, 'balance.json says two');
  });
});

describe('§4.2 STORE INVARIANT — the build-failing one', () => {
  test('total reachable capacity clears the worst cost by ≥25%, at every Ayuntamiento level', () => {
    const rows = auditStorage();
    const width = Math.max(...rows.map((r) => r.source.length));
    for (const row of rows) {
      if (row.worst === 0) continue;
      const mark = row.ok ? ' ' : '!';
      console.log(
        `      ${mark} Ayto ${row.townHall}  ${row.resource.padEnd(6)}` +
        ` worst ${n(row.worst).padStart(9)} (${row.source.padEnd(width)})` +
        ` · cap ${n(row.reachable).padStart(9)}` +
        ` · ×${(row.reachable / row.worst).toFixed(2)}`
      );
    }
    const violations = checkStorageInvariant();
    ok(
      violations.length === 0,
      violations.map((v) =>
        `Ayto ${v.townHall} ${v.resource}: needs ${n(Math.ceil(v.required))} to clear ` +
        `${v.source} (${n(v.worst)}) but only ${n(v.reachable)} is reachable`
      ).join('\n')
    );
  });

  test('no store upgrade costs more of its own resource than it can hold', () => {
    const violations = checkStoreLadder();
    ok(violations.length === 0, violations.map((v) => v.source).join('\n'));
  });

  test('the invariant actually bites — a tighter headroom finds the same walls', () => {
    // Guards the guard: if auditStorage silently returned nothing for every
    // input, the test above would pass against a broken table forever.
    const absurd = auditStorage(50);
    ok(absurd.some((row) => !row.ok), 'a 50× headroom must fail somewhere');
  });
});

describe('§4.4 gem speed-up', () => {
  test('the GOLDEN RULE: the last five minutes of any timer cost exactly 1 gem', () => {
    eq(gemSpeedupCost(1), 1, '1ms left');
    eq(gemSpeedupCost(5 * MINUTE), 1, 'exactly 5m left');
    eq(gemSpeedupCost(4 * MINUTE + 59_000), 1, '4m 59s left');
    ok(gemSpeedupCost(5 * MINUTE + 1000) > 1, 'past five minutes it stops being free');
  });

  test('the published ladder', () => {
    eq(gemSpeedupCost(HOUR), 22, '1h ≈ 22 💎');
    eq(gemSpeedupCost(12 * HOUR), 86, '12h ≈ 86 💎');
    eq(gemSpeedupCost(3 * DAY), 318, '3d ≈ 318 💎');
  });

  test('cost never goes down as the wait gets longer', () => {
    let previous = 0;
    for (let ms = MINUTE; ms <= 4 * DAY; ms += 7 * MINUTE) {
      const cost = gemSpeedupCost(ms);
      ok(cost >= previous, `cost at ${Math.round(ms / MINUTE)}m (${cost}) ≥ previous (${previous})`);
      previous = cost;
    }
  });
});
