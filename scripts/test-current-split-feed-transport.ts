import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { encodeCurrentSplitFeedTransport, decodeCurrentSplitFeedTransport } from "../lib/providers/real_api/currentSplitFeedTransport";
import { validateSharpApiCurrentSplitFeed, refreshOwlsCurrentSplitFallback, readStoredSharpApiCurrentSplits, __TEST__ } from "../lib/providers/real_api/sharpApiCurrentSplits";
import { readCbbCapturedNamedSplits } from "../lib/services/cbb/cbbCapturedMarketHistory";
import type { supabase } from "../lib/db/supabase";

async function main() {
  const feed = {
    source: "owls_current_splits", release: "owls_current_splits_2026_10_27_r1_complete_named_book",
    sport: "cbb", fetchedAt: "2026-11-05T12:00:00.000Z",
    rows: Array.from({ length: 500 }, (_, i) => ({
      event_id: `ncaab:Away@Home-${i < 250 ? "20261027" : "20261105"}`,
      sportsbook: i % 2 ? "circa" : "betmgm", fetched_at: new Date(i * 300_000).toISOString(),
      moneyline: { handle_pct: { away: i % 100, home: 100 - i % 100 }, bets_pct: { away: null, home: null } },
      unknownProviderEvidence: "do not remove 🏀 ".repeat(20), nullable: null,
    })),
  };
  const before = JSON.stringify(feed);
  const encoded = encodeCurrentSplitFeedTransport(feed);
  assert.equal(encoded.encoding, "gzip-base64");
  assert.equal(JSON.stringify(feed), before, "encoding cannot mutate any retained observation");
  assert.equal(JSON.stringify(decodeCurrentSplitFeedTransport(encoded)), before, "all fields/order/clocks/past events survive exactly");
  assert.ok(JSON.stringify(encoded).length < before.length / 5);
  const raw = validateSharpApiCurrentSplitFeed(feed, "cbb");
  const decoded = validateSharpApiCurrentSplitFeed(encoded, "cbb");
  assert.strictEqual(raw, feed, "legacy raw reader retains its original object");
  assert.deepEqual(decoded, raw);
  assert.equal(validateSharpApiCurrentSplitFeed(encoded, "cfb"), null);
  const conflicting = { ...feed, ...encoded };
  assert.strictEqual(validateSharpApiCurrentSplitFeed(conflicting, "cbb"), conflicting, "valid stored raw fields outrank a competing envelope");
  const next = { ...raw!, fetchedAt: "2026-11-05T12:05:00.000Z", rows: [feed.rows[0]!] };
  assert.deepEqual(__TEST__.mergeCurrentSplitFeeds(decoded, next), __TEST__.mergeCurrentSplitFeeds(raw, next), "same-input history merge remains exact");
  for (const payload of [feed, encoded]) {
    const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { payload }, error: null }) }) }) }) };
    assert.deepEqual(await readCbbCapturedNamedSplits(db as unknown as typeof supabase), feed, "the direct CBB reader accepts both formats unchanged");
  }
  process.env.OWLS_INSIGHT_API_KEY = "offline-test";
  process.env.OWLS_INSIGHT_BASE_URL = "https://owls.invalid";
  const originalFetch = globalThis.fetch;
  let stored: Record<string, unknown> = feed;
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "owls.invalid" && url.pathname === "/api/v1/ncaab/splits") {
      return Response.json({ sport: "ncaab", data: [{ event_id: "ncaab:New@Game-20261106", away_team: "New", home_team: "Game", splits: [{ book: "circa", as_of: feed.fetchedAt, moneyline: { away_handle_pct: 61, home_handle_pct: 39 } }] }] });
    }
    assert.equal(url.hostname, "127.0.0.1", "the test cannot access any live database");
    if (url.pathname === "/rest/v1/lab_response_snapshots") return Response.json([{ payload: stored, generated_at: feed.fetchedAt, expires_at: feed.fetchedAt, stale_until: feed.fetchedAt }]);
    assert.equal(url.pathname, "/rest/v1/rpc/upsert_lab_response_snapshot");
    const row = JSON.parse(String(init?.body));
    assert.equal(row.payload.encoding, "gzip-base64", "the sole existing RPC writer transmits the envelope");
    assert.equal(row.snapshot_key, `daily-edge::named-book-current-splits::cbb::${feed.release}`);
    stored = row.payload;
    writes++;
    return Response.json(null);
  };
  try {
    await refreshOwlsCurrentSplitFallback("cbb");
    assert.equal(writes, 1);
    const written = validateSharpApiCurrentSplitFeed(stored, "cbb")!;
    const freshRows = written.rows.filter((row) => row.event_id === "ncaab:New@Game-20261106");
    assert.equal(freshRows.length, 1);
    assert.deepEqual(written, __TEST__.mergeCurrentSplitFeeds(raw, { ...written, rows: freshRows }), "writer preserves the exact existing merge and every retained historical field");
    assert.deepEqual(await readStoredSharpApiCurrentSplits("cbb"), written, "the normal durable reader decodes newly written receipts");
    assert.equal(JSON.stringify(feed), before, "the writer cannot mutate its legacy source receipt");
  } finally {
    globalThis.fetch = originalFetch;
  }
  for (const malformed of [{ encoding: "gzip-base64", payload: "invalid" }, { encoding: "gzip-base64", payload: 42 }]) {
    assert.equal(validateSharpApiCurrentSplitFeed(malformed, "cbb"), null);
  }
  const oversized = { ...feed, padding: "x".repeat(32_000_001) };
  assert.strictEqual(encodeCurrentSplitFeedTransport(oversized), oversized, "the size ceiling cannot truncate or suppress a legacy feed");
  assert.equal(decodeCurrentSplitFeedTransport({ encoding: "gzip-base64", payload: gzipSync(JSON.stringify(oversized)).toString("base64") }), null, "compressed input has a bounded decode");
  console.log("PASS exact current-split transport, raw precedence, all history, merge parity, direct CBB reads and bounded corrupt-input handling");
}
void main();
