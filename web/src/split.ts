/**
 * Same rule as the API (api/src/lib/split.ts), used only to PREVIEW a split before the
 * bill is saved. The API does the real split; the page always shows what the API returns.
 */
export function previewSplit(totalCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || count <= 0) return []
  const base = Math.floor(totalCents / count)
  const remainder = totalCents % count
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0))
}
