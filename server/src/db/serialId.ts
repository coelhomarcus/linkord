// messages.id is a 4-byte `serial`. A value outside 1..PG_INT4_MAX never names
// a row, and passing it to Postgres fails the whole query ("out of range for
// type integer") instead of finding nothing, so every client-supplied id is
// checked here first.
export const PG_INT4_MAX = 2_147_483_647;

/** A client-supplied serial id (a number, or a string of digits from a URL or
 * a JSON body) as a number, or null when it cannot name a row. */
export function parseSerialId(value: unknown): number | null {
  const n = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value)
      : NaN;
  return Number.isInteger(n) && n >= 1 && n <= PG_INT4_MAX ? n : null;
}
