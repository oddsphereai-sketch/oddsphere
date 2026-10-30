import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __TEST__ as sharpApiCurrentTest } from "../lib/providers/real_api/sharpApiCurrentSplits";

type Json = Record<string, unknown>;

const complete = (fetchedAt: string): Json => ({
  event_id: "nba_2026-10-28_lal_gsw",
  sportsbook: "circa",
  fetched_at: fetchedAt,
  moneyline: { handle_pct: { away: 61, home: 39 }, bets_pct: { away: 53, home: 47 } },
  spread: { handle_pct: { away: 58, home: 42 }, bets_pct: { away: 48, home: 52 } },
  total: { handle_pct: { over: 44, under: 56 }, bets_pct: { over: 49, under: 51 } },
});

const partial = (index: number): Json => {
  const fetchedAt = new Date(Date.parse("2026-10-28T12:00:00.000Z") + index * 5 * 60_000).toISOString();
  const row = complete(fetchedAt);
  for (const market of ["moneyline", "spread", "total"] as const) {
    (row[market] as { handle_pct: unknown }).handle_pct = { away: null, home: null, over: null, under: null };
  }
  return row;
};

const previous = {
  source: "owls_current_splits" as const,
  release: "owls_current_splits_2026_10_27_r1_complete_named_book" as const,
  sport: "nba" as const,
  fetchedAt: "2026-10-28T11:55:00.000Z",
  rows: [complete("2026-10-28T11:55:00.000Z")],
};
const current = {
  ...previous,
  fetchedAt: "2026-10-28T20:00:00.000Z",
  rows: Array.from({ length: 96 }, (_, index) => partial(index)),
};
const merged = sharpApiCurrentTest.mergeCurrentSplitFeeds(previous, current);
assert.equal(merged.rows.length, 97, "the bounded history retains one older complete pair through a long partial outage");
assert.ok(
  merged.rows.some((row) => row.fetched_at === previous.fetchedAt),
  "the last timestamp-honest money+ticket observation cannot be evicted by ticket-only updates",
);

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  crons?: Array<{ path?: string; schedule?: string }>;
};
assert.ok(
  vercel.crons?.some((cron) => cron.path === "/api/cron/sharp-book-splits-refresh" && cron.schedule === "*/5 * * * *"),
  "the lightweight Owls display feed is captured every five minutes",
);

const route = readFileSync("app/api/cron/sharp-book-splits-refresh/route.ts", "utf8");
assert.match(route, /refreshOwlsCurrentSplitFallback/, "the capture calls Owl's directly instead of the canceled SharpAPI");
const capturedSports = /const SPORTS: readonly Sport\[\] = \[([^\]]+)\]/.exec(route)?.[1].match(/"([a-z]+)"/g)?.map(value => value.slice(1,-1));
assert.deepEqual(capturedSports, ["mlb", "wnba", "nhl", "nba", "nfl", "cfb", "cbb", "soccer", "ucl"], "split leagues remain captured alongside both new soccer display feeds");
assert.match(route, /sport === "soccer" \|\| sport === "ucl" \? Promise.resolve\(0\) : refreshOwlsCurrentSplitFallback\(sport\)/, "soccer has prediction markets, not fabricated sportsbook splits");
assert.match(route, /refreshPredictionMarketDisplayFeed\(sport as PredictionMarketSport\)/, "CBB Kalshi display capture remains active");
assert.match(route, /namedSplitError = sport === "cbb" && retainedRows === 0/, "Kalshi rows cannot mask zero CBB named-book split rows");
assert.match(route, /partial: errors.length > 0/, "a zero-row CBB named-book capture is not logged as fully healthy");
assert.match(route, /Promise.allSettled/, "prediction-market capture cannot cancel the split capture");
assert.match(route, /if \(splitResult.status === "rejected"\) throw splitResult.reason/, "a failed split capture still reports failure");
assert.doesNotMatch(route, /leaseGroup:\s*["']prediction_pipeline["']/, "display capture does not claim prediction authority");

const provider = readFileSync("lib/providers/real_api/sharpApiCurrentSplits.ts", "utf8");
assert.match(provider, /requireProviderSuccess:\s*true/, "scheduled capture reports Owl's auth or transport failures instead of silently claiming success");
assert.doesNotMatch(
  provider,
  /zero current split rows/,
  "an authenticated empty off-season slate is valid and must not fail the all-sport cron",
);

console.log("PASS Sharp Book Splits capture persists complete pairs through temporary upstream gaps");
