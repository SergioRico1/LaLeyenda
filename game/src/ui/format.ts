/**
 * format.ts — UI_SPEC §1.9.
 *
 * Two formatters, and they are load-bearing (§6.15): a comma separator or a
 * system/monospace numeral is one of the fastest ways to give the game away.
 * The thin space and `.num`'s tabular figures are the whole trick.
 */

/** Thousands separator is a THIN SPACE (U+2009). Never a comma, never a dot. */
const THIN = ' ';

/** 1556 → "1 556" · 2000000 → "2 000 000" */
export const n = (v: number): string =>
  String(Math.floor(v)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN);

/**
 * "7m 17s" · "2d 16h" · "45s", with the unit suffix in `<u>` so `.num u`
 * can set it in genuine small-caps — the one place §1.9 allows the Clash
 * small-cap look, because there it is a faithful match rather than a fake.
 *
 * Returns markup, so it goes through innerHTML. Only ever fed a number.
 */
export function dur(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = (s / 86400) | 0, h = ((s % 86400) / 3600) | 0, m = ((s % 3600) / 60) | 0, sec = s % 60;
  if (d) return `${d}<u>d</u> ${h}<u>h</u>`;
  if (h) return `${h}<u>h</u> ${m}<u>m</u>`;
  if (m) return `${m}<u>m</u> ${sec}<u>s</u>`;
  return `${sec}<u>s</u>`;
}

/** The same value without markup — for aria-label, title and logs. */
export const durText = (ms: number): string => dur(ms).replace(/<\/?u>/g, '');

/** Badge counts cap at 9+ / 99+ (§3.8). */
export const badgeCount = (v: number): string => (v > 99 ? '99+' : v > 9 ? '9+' : String(v));

/** Storage fill as a 0–1 ratio, clamped. Drives `--pct` on a resource pill. */
export const ratio = (value: number, cap: number): number =>
  cap <= 0 ? 0 : Math.max(0, Math.min(1, value / cap));
