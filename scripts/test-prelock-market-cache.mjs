import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// Exercise the installed Next cache and its real 2 MB admission limit.
globalThis.AsyncLocalStorage = AsyncLocalStorage;
const { IncrementalCache } = await import("next/dist/server/lib/incremental-cache/index.js");
const { unstable_cache } = await import("next/cache.js");
const cacheModule = await import("../lib/providers/owls/prelockMarketCache.ts");
const { encodePrelockMarketCache, decodePrelockMarketCache } = cacheModule.default ?? cacheModule;
const store = await import("../lib/providers/owls/predictionMarketPrelock.ts");
const { readPredictionMarketPrelock, PREDICTION_MARKET_PRELOCK_RELEASE } = store.default ?? store;
const tag = `prelock-proof-${randomBytes(8).toString("hex")}`;
const directory = await fs.mkdtemp(join(tmpdir(), "oddsphere-prelock-cache-"));
const previousCache = globalThis.__incrementalCache;
try {
  const cache = new IncrementalCache({
    dev: true, fs, serverDistDir: directory, flushToDisk: false,
    requestHeaders: {}, maxMemoryCacheSize: 20_000_000,
    getPrerenderManifest: () => ({ version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [],
      preview: { previewModeId: tag, previewModeSigningKey: "test", previewModeEncryptionKey: "test" } }),
  });
  assert.equal(cache.hasCustomCacheHandler, false, "Do not bypass Next's size guard");
  globalThis.__incrementalCache = cache;
  const lock = Date.parse("2026-11-05T18:00:00Z");
  const rows = ["moneyline", "spread", "total", "btts"].map((kind, i) => ({
    event: 42, start: "2026-11-05T19:00:00Z", away: "AWY", home: "HOM",
    key: kind === "moneyline" ? "moneyline" : kind === "total" ? "total" : "first_inning",
    pick: kind, kind, side: "home", line: kind === "moneyline" ? null : i,
    capturedAt: lock - 10_000, market: null, book: { locked: true, sourceClock: lock - 30_000 },
    checkpoints: [{ capturedAt: lock - 20_000, originalUnknownField: "preserve me" }],
    evidence: randomBytes(550_000).toString("hex"),
  }));
  const feed = { release: PREDICTION_MARKET_PRELOCK_RELEASE, sport: "cfb", rows,
    unknownMetadata: { original: true }, retentionRelease: "original" };
  const frozen = JSON.stringify(feed);
  const oversized = gzipSync(frozen).toString("base64");
  await assert.rejects(unstable_cache(async () => oversized, [tag, "legacy"], { revalidate: 30 })(), /over 2MB/);

  let sourceReads = 0;
  const read = unstable_cache(async kind => {
    sourceReads++;
    return encodePrelockMarketCache(feed, kind);
  }, [tag, "partition"], { revalidate: 30, tags: [tag] });
  for (const [i, kind] of ["moneyline", "spread", "total", "btts"].entries()) {
    const first = await read(kind), second = await read(kind);
    assert.equal(sourceReads, i + 1, "A repeated chart must reuse the actual Next cache");
    assert.equal(first, second);
    const selected = decodePrelockMarketCache(first);
    assert.deepEqual(selected, { ...feed, rows: rows.filter(row => row.kind === kind) });
    const row = rows[i];
    const game = { external_id: 42, gameStartAt: row.start, awayTeam: "AWY", homeTeam: "HOM",
      lockedAt: new Date(lock).toISOString(), lockState: "locked", markets: { [row.key]: { pick: kind } } };
    assert.deepEqual(readPredictionMarketPrelock(selected, game, kind, "home", row.line, lock + 100),
      readPredictionMarketPrelock(feed, game, kind, "home", row.line, lock + 100));
  }
  assert.equal(JSON.stringify(feed), frozen, "Original locked receipts and source feed must remain byte-identical");
  assert.deepEqual(decodePrelockMarketCache(encodePrelockMarketCache(feed, "unsupported")), { ...feed, rows: [] });
  assert.equal(decodePrelockMarketCache(encodePrelockMarketCache(null, "total")), null);
  await cache.revalidateTag([tag], { expire: 0 });
  await read("total");
  assert.equal(sourceReads, 5, "The existing capture tag still invalidates every market partition");
  console.log("prelock market cache: real Next rejection/reuse/invalidation, complete evidence and locked-reader parity PASS");
} finally {
  globalThis.__incrementalCache = previousCache;
  await fs.rm(directory, { recursive: true, force: true });
}
