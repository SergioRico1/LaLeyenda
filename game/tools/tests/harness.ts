/**
 * harness.ts — forty lines of test framework.
 *
 * Enough to say what is being asserted and to print a readable diff when it is
 * not true. Anything more would be a dependency the game does not need.
 */

type Fn = () => void;

interface Case {
  group: string;
  name: string;
  fn: Fn;
}

const cases: Case[] = [];
let group = '';

export function describe(name: string, body: () => void): void {
  const previous = group;
  group = name;
  body();
  group = previous;
}

export function test(name: string, fn: Fn): void {
  cases.push({ group, name, fn });
}

export class AssertionError extends Error {}

export function ok(value: unknown, message: string): void {
  if (!value) throw new AssertionError(message);
}

export function eq<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new AssertionError(`${message}\n    expected: ${fmt(expected)}\n    actual:   ${fmt(actual)}`);
  }
}

export function near(actual: number, expected: number, tolerance: number, message: string): void {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new AssertionError(`${message}\n    expected: ${fmt(expected)} ±${tolerance}\n    actual:   ${fmt(actual)}`);
  }
}

export function deepEq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new AssertionError(`${message}\n    expected: ${b}\n    actual:   ${a}`);
}

const fmt = (v: unknown): string =>
  typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : JSON.stringify(v);

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const OFF = '\u001b[0m';

export function runCases(): number {
  let failures = 0;
  let lastGroup = '';
  const started = Date.now();

  for (const c of cases) {
    if (c.group !== lastGroup) {
      lastGroup = c.group;
      console.log(`\n${c.group}`);
    }
    try {
      c.fn();
      console.log(`  ${GREEN}✓${OFF} ${c.name}`);
    } catch (err) {
      failures++;
      const message = err instanceof AssertionError ? err.message : String(err instanceof Error ? err.stack : err);
      console.log(`  ${RED}✗ ${c.name}${OFF}\n    ${message.split('\n').join('\n    ')}`);
    }
  }

  const total = cases.length;
  const ms = Date.now() - started;
  console.log(
    failures === 0
      ? `\n${GREEN}${total} passed${OFF} ${DIM}(${ms}ms)${OFF}\n`
      : `\n${RED}${failures} failed${OFF}, ${total - failures} passed ${DIM}(${ms}ms)${OFF}\n`
  );
  return failures;
}
