/** Lossless ordered write partitioning; not retention, sampling or compaction.
 * Keep each PostgREST request small without discarding any observation. */
export const MARKET_OBSERVATION_WRITE_BATCH_RELEASE = "market_observation_write_batch_2026_11_06_r1_bounded_bytes" as const;
export const MARKET_OBSERVATION_WRITE_MAX_BYTES = 240_000;
export const MARKET_OBSERVATION_WRITE_MAX_ROWS = 500;

export function* observationWriteBatches<T>(rows: readonly T[]): Generator<T[]> {
  let batch: T[] = [], bytes = 2;
  for (const row of rows) {
    const json = JSON.stringify(row);
    if (json === undefined) throw Error("Market observation is not JSON serializable");
    const size = Buffer.byteLength(json);
    if (size + 2 > MARKET_OBSERVATION_WRITE_MAX_BYTES)
      throw Error("Market observation exceeds bounded write size; evidence was not truncated");
    if (batch.length && (batch.length >= MARKET_OBSERVATION_WRITE_MAX_ROWS || bytes + size + 1 > MARKET_OBSERVATION_WRITE_MAX_BYTES)) {
      yield batch; batch = []; bytes = 2;
    }
    bytes += size + (batch.length ? 1 : 0); batch.push(row);
  }
  if (batch.length) yield batch;
}
