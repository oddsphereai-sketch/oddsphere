/**
 * Read-only inventory of SharpAPI's current split coverage.
 *
 * Reports counts only. It does not print credentials, raw percentages, team
 * names, or event ids, and it performs no database/cache writes.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/operator/audit-current-sharpapi-splits-catalog.ts
 */

import { SharpApiClient } from "../../lib/providers/real_api/_sharpApiClient";

type Json = Record<string, unknown>;
type Market = "moneyline" | "spread" | "total";

const LEAGUES = ["mlb", "nfl", "ncaaf", "nba", "ncaab", "nhl", "wnba"] as const;
const MARKETS: readonly Market[] = ["moneyline", "spread", "total"];

function record(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Json
    : {};
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function complementary(values: unknown[]): boolean {
  const parsed = values.map(finite);
  if (parsed.some((value) => value === null)) return false;
  const sum = parsed[0]! + parsed[1]!;
  return Math.abs(sum - 1) <= 0.01 || Math.abs(sum - 100) <= 1;
}

function marketMetrics(row: Json, market: Market) {
  const value = record(row[market]);
  const first = market === "total" ? "over" : "away";
  const second = market === "total" ? "under" : "home";
  const bets = record(value.bets_pct);
  const handle = record(value.handle_pct);
  const completeBets = complementary([bets[first], bets[second]]);
  const completeHandle = complementary([handle[first], handle[second]]);
  return {
    complete: completeBets && completeHandle,
    ticketsOnly: completeBets && !completeHandle,
    handleOnly: !completeBets && completeHandle,
    empty: !completeBets && !completeHandle,
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.SHARPAPI_KEY;
  if (!apiKey) throw new Error("SHARPAPI_KEY is required.");
  const client = new SharpApiClient(apiKey);
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    mode: "read_only_counts_only",
    endpoint: "/splits",
  };
  for (const league of LEAGUES) {
    const rows = await client.fetchAll<Json>({
      path: "/splits",
      query: { league, limit: 200 },
      maxPages: 2,
      retryRateLimitInternally: false,
    });
    const books = [...new Set(rows.map((row) => String(row.sportsbook ?? "unknown")))].sort();
    const byBook: Record<string, unknown> = {};
    for (const book of books) {
      const bookRows = rows.filter((row) => String(row.sportsbook ?? "unknown") === book);
      byBook[book] = Object.fromEntries(MARKETS.map((market) => {
        const states = bookRows.map((row) => marketMetrics(row, market));
        return [market, {
          complete: states.filter((state) => state.complete).length,
          ticketsOnly: states.filter((state) => state.ticketsOnly).length,
          handleOnly: states.filter((state) => state.handleOnly).length,
          empty: states.filter((state) => state.empty).length,
        }];
      }));
    }
    report[league] = {
      rows: rows.length,
      events: new Set(rows.map((row) => row.event_id).filter(Boolean)).size,
      books: byBook,
    };
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
