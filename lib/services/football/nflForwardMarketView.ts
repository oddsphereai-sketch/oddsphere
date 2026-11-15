import type { NflForwardStoredEvidence } from "./nflForwardEvidence";
type Market = NflForwardStoredEvidence["payload"]["market"];

/** Request-local memo for the compact reader's repeated market-only access.
 * Other lazy source groups still use their original verified getters. Retain
 * at most one game's market values, bounded by their serialized byte size;
 * clearing or eviction changes work only, never the value or source selection.
 */
export function nflForwardMarketView(
  rows: readonly NflForwardStoredEvidence[],
  maximumBytes = 8_000_000,
): NflForwardStoredEvidence[] {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new Error("Invalid NFL market memo bound");
  let game: string | undefined, bytes = 0;
  const cache = new Map<object, { value: Market; bytes: number }>();
  return rows.map(row => {
    const original = row.payload, descriptors = Object.getOwnPropertyDescriptors(original);
    const descriptor = descriptors.market;
    if (!descriptor?.get) return row;
    const read = descriptor.get;
    descriptors.market = { ...descriptor, get() {
      if (game !== row.providerGameId) { cache.clear(); bytes = 0; game = row.providerGameId; }
      const hit = cache.get(original);
      if (hit) { cache.delete(original); cache.set(original, hit); return hit.value; }
      const value = read.call(original);
      const size = Buffer.byteLength(JSON.stringify(value) ?? "");
      if (size <= maximumBytes) {
        while (bytes + size > maximumBytes && cache.size) {
          const oldest = cache.keys().next().value!;
          bytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
        }
        cache.set(original, { value, bytes: size }); bytes += size;
      }
      return value;
    } };
    return { ...row, payload: Object.defineProperties(Object.create(Object.getPrototypeOf(original)), descriptors) };
  });
}
