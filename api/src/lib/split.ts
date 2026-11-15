/**
 * Splits `totalCents` into `count` whole-cent parts that always add up to the total.
 * The remainder is handed out one cent at a time, starting with the first part,
 * so the parts never differ by more than one cent.
 *
 * splitCents(1000, 3) -> [334, 333, 333]
 */
export function splitCents(totalCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new RangeError('totalCents must be a positive whole number')
  }
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new RangeError('count must be a positive whole number')
  }

  const base = Math.floor(totalCents / count)
  const remainder = totalCents % count
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0))
}
