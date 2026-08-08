/**
 * duration.ts — the one parser for the duration strings in balance.json.
 *
 * balance.json writes times the way UI_SPEC §4 writes them ("5m", "1d 12h",
 * "3d 12h") so the file can be diffed against the spec tables by eye. Nothing
 * else in the codebase is allowed to know what "1d 12h" means.
 *
 * Pure: no Date, no locale, no clock.
 */

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const UNIT: Record<string, number> = { s: SECOND, m: MINUTE, h: HOUR, d: DAY };

const TOKEN = /(\d+(?:\.\d+)?)\s*([smhd])/g;

/**
 * "0" → 0 · "45s" → 45000 · "1d 12h" → 129600000.
 * Throws on anything it cannot read: a typo in balance.json must fail loudly at
 * load, not silently become a zero-second timer.
 */
export function parseDuration(text: string | number): number {
  if (typeof text === 'number') return text;
  const trimmed = text.trim();
  if (trimmed === '0' || trimmed === '') return 0;

  let ms = 0;
  let hits = 0;
  TOKEN.lastIndex = 0;
  const leftover = trimmed.replace(TOKEN, (_all, value: string, unit: string) => {
    ms += Number(value) * UNIT[unit];
    hits++;
    return '';
  });
  // Every non-space character must have been consumed by a token.
  if (hits === 0 || leftover.trim() !== '') {
    throw new Error(`[balance] unreadable duration: ${JSON.stringify(text)}`);
  }
  return ms;
}
