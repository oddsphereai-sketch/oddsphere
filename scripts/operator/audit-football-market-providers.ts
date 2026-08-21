/**
 * Bounded, read-only football market provider audit.
 *
 * Four Playbook calls (lines + splits for NFL/NCAAF) and four SharpAPI calls
 * (main odds + splits for NFL/NCAAF). No DB/cache/model/grade writes and no
 * raw payload or credential logging.
 */

import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import type { PlaybookLineGame, PlaybookSplitGame } from "../../lib/providers/playbook/types";
import { SharpApiClient } from "../../lib/providers/real_api/_sharpApiClient";

type League = "nfl" | "ncaaf";
type Json = Record<string, unknown>;
const AUDIT_TIME = new Date();

function object(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function validTimestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function complementary(first: unknown, second: unknown): boolean {
  const a = number(first);
  const b = number(second);
  return a !== null && b !== null && Math.abs(a + b - 100) <= 1;
}

function timeRange(values: unknown[]) {
  const timestamps = values
    .filter(validTimestamp)
    .map((value) => new Date(value as string).getTime())
    .sort((a, b) => a - b);
  return {
    earliest: timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : null,
    latest: timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]).toISOString() : null,
    next7Days: timestamps.filter((value) => value >= AUDIT_TIME.getTime() && value <= AUDIT_TIME.getTime() + 7 * 86_400_000).length,
    next14Days: timestamps.filter((value) => value >= AUDIT_TIME.getTime() && value <= AUDIT_TIME.getTime() + 14 * 86_400_000).length,
  };
}

function summarizePlaybookLines(rows: PlaybookLineGame[]) {
  return {
    rows: rows.length,
    validStarts: rows.filter((row) => validTimestamp(row.startTime ?? row.startTimeEst)).length,
    startRange: timeRange(rows.map((row) => row.startTime ?? row.startTimeEst)),
    completeMoneyline: rows.filter((row) => number(row.lines?.moneyline?.home) !== null && number(row.lines?.moneyline?.away) !== null).length,
    completeSpread: rows.filter((row) => number(row.lines?.spread?.home) !== null && number(row.lines?.spread?.away) !== null).length,
    completeTotal: rows.filter((row) => number(row.lines?.total) !== null).length,
    sourceTiers: [...new Set(rows.map((row) => row.lineSourceTier).filter((value): value is string => typeof value === "string"))].sort(),
    semantics: "consensus_not_named_sportsbook",
  };
}

function completePlaybookMarket(row: PlaybookSplitGame, market: "spread" | "moneyline" | "total"): boolean {
  const value = row.splits?.[market];
  if (!value) return false;
  if (market === "total") {
    return complementary(value.bets?.overPercent, value.bets?.underPercent) && complementary(value.money?.overPercent, value.money?.underPercent);
  }
  return complementary(value.bets?.homePercent, value.bets?.awayPercent) && complementary(value.money?.homePercent, value.money?.awayPercent);
}

function summarizePlaybookSplits(rows: PlaybookSplitGame[]) {
  const booksUsed = rows.flatMap((row) => [
    number(row.splits?.moneyline?.source?.booksUsed),
    number(row.splits?.spread?.source?.booksUsed),
    number(row.splits?.total?.source?.booksUsed),
  ]).filter((value): value is number => value !== null);
  return {
    rows: rows.length,
    validStarts: rows.filter((row) => validTimestamp(row.startTime ?? row.startTimeEst)).length,
    startRange: timeRange(rows.map((row) => row.startTime ?? row.startTimeEst)),
    completeMoneyline: rows.filter((row) => completePlaybookMarket(row, "moneyline")).length,
    completeSpread: rows.filter((row) => completePlaybookMarket(row, "spread")).length,
    completeTotal: rows.filter((row) => completePlaybookMarket(row, "total")).length,
    booksUsed: booksUsed.length === 0 ? null : { minimum: Math.min(...booksUsed), maximum: Math.max(...booksUsed) },
    semantics: "multi_book_public_consensus_bets_and_money",
  };
}

function summarizeSharpOdds(rows: unknown[]) {
  const records = rows.map(object);
  const eventIds = new Set(records.map((row) => string(row.event_id)).filter((value): value is string => value !== null));
  const pairBuckets = new Map<string, Set<string>>();
  for (const row of records) {
    const event = string(row.event_id);
    const book = string(row.sportsbook);
    const market = string(row.market_type);
    const side = string(row.selection_type ?? row.side);
    const line = number(row.line);
    if (!event || !book || !market || !side) continue;
    const normalizedLine = market.includes("spread") && line !== null ? Math.abs(line) : line;
    const key = [event, book, market, normalizedLine].join("|");
    pairBuckets.set(key, new Set([...(pairBuckets.get(key) ?? []), side]));
  }
  return {
    rows: records.length,
    events: eventIds.size,
    sportsbooks: [...new Set(records.map((row) => string(row.sportsbook)).filter((value): value is string => value !== null))].sort(),
    marketTypes: [...new Set(records.map((row) => string(row.market_type)).filter((value): value is string => value !== null))].sort(),
    completeTwoWayPriceBuckets: [...pairBuckets.values()].filter((sides) => sides.size >= 2).length,
    validFreshnessTimestamps: records.filter((row) => validTimestamp(row.timestamp ?? row.last_seen_at ?? row.wire_received_at)).length,
    startRange: timeRange(records.map((row) => row.event_start_time ?? row.commence_time ?? row.start_time ?? object(row.event).start_time)),
    topLevelFields: [...new Set(records.flatMap((row) => Object.keys(row)))].sort(),
    semantics: "named_sportsbook_current_prices",
  };
}

function completeSharpMarket(row: Json, market: "spread" | "moneyline" | "total"): boolean {
  const value = object(row[market]);
  const bets = object(value.bets_pct);
  const handle = object(value.handle_pct);
  const sides = market === "total" ? ["over", "under"] : ["home", "away"];
  const betValues = sides.map((side) => number(bets[side]));
  const handleValues = sides.map((side) => number(handle[side]));
  const complementaryAtKnownScale = (values: Array<number | null>) => {
    if (!values.every((value) => value !== null)) return false;
    const sum = values[0]! + values[1]!;
    return Math.abs(sum - 1) <= 0.01 || Math.abs(sum - 100) <= 1;
  };
  return complementaryAtKnownScale(betValues) && complementaryAtKnownScale(handleValues);
}

function summarizeSharpSplits(rows: unknown[]) {
  const records = rows.map(object);
  const marketFields = (market: "moneyline" | "spread" | "total") => [...new Set(records.flatMap((row) => Object.keys(object(row[market]))))].sort();
  const percentageFields = (market: "moneyline" | "spread" | "total", field: "bets_pct" | "handle_pct") =>
    [...new Set(records.flatMap((row) => Object.keys(object(object(row[market])[field]))))].sort();
  const percentagePairStats = (market: "moneyline" | "spread" | "total", field: "bets_pct" | "handle_pct") => {
    const sides = market === "total" ? ["over", "under"] : ["home", "away"];
    const sums = records.map((row) => {
      const values = object(object(row[market])[field]);
      const first = number(values[sides[0]]);
      const second = number(values[sides[1]]);
      return first === null || second === null ? null : first + second;
    }).filter((value): value is number => value !== null);
    return {
      presentPairs: sums.length,
      missingPairs: records.length - sums.length,
      minimumSum: sums.length > 0 ? Math.min(...sums) : null,
      maximumSum: sums.length > 0 ? Math.max(...sums) : null,
    };
  };
  return {
    rows: records.length,
    events: new Set(records.map((row) => string(row.event_id)).filter((value): value is string => value !== null)).size,
    sportsbooks: [...new Set(records.map((row) => string(row.sportsbook ?? row.book)).filter((value): value is string => value !== null))].sort(),
    completeMoneyline: records.filter((row) => completeSharpMarket(row, "moneyline")).length,
    completeSpread: records.filter((row) => completeSharpMarket(row, "spread")).length,
    completeTotal: records.filter((row) => completeSharpMarket(row, "total")).length,
    validFreshnessTimestamps: records.filter((row) => validTimestamp(row.fetched_at ?? row.ts)).length,
    topLevelFields: [...new Set(records.flatMap((row) => Object.keys(row)))].sort(),
    marketFields: {
      moneyline: { fields: marketFields("moneyline"), betsSides: percentageFields("moneyline", "bets_pct"), handleSides: percentageFields("moneyline", "handle_pct"), bets: percentagePairStats("moneyline", "bets_pct"), handle: percentagePairStats("moneyline", "handle_pct") },
      spread: { fields: marketFields("spread"), betsSides: percentageFields("spread", "bets_pct"), handleSides: percentageFields("spread", "handle_pct"), bets: percentagePairStats("spread", "bets_pct"), handle: percentagePairStats("spread", "handle_pct") },
      total: { fields: marketFields("total"), betsSides: percentageFields("total", "bets_pct"), handleSides: percentageFields("total", "handle_pct"), bets: percentagePairStats("total", "bets_pct"), handle: percentagePairStats("total", "handle_pct") },
    },
    semantics: "source_book_bets_and_handle_not_a_verified_sharp_bettor_label",
  };
}

async function main() {
  const leagueArgument = process.argv.find((value) => value.startsWith("--league="))?.slice("--league=".length) ?? "both";
  const providerArgument = process.argv.find((value) => value.startsWith("--provider="))?.slice("--provider=".length) ?? "both";
  if (!["nfl", "ncaaf", "both"].includes(leagueArgument)) throw new Error("--league must be nfl, ncaaf, or both.");
  if (!["playbook", "sharpapi", "both"].includes(providerArgument)) throw new Error("--provider must be playbook, sharpapi, or both.");
  const leagues: League[] = leagueArgument === "both" ? ["nfl", "ncaaf"] : [leagueArgument as League];
  const usePlaybook = providerArgument === "both" || providerArgument === "playbook";
  const useSharp = providerArgument === "both" || providerArgument === "sharpapi";
  const playbookKey = process.env.PLAYBOOK_API_KEY;
  const sharpKey = process.env.SHARPAPI_KEY;
  if (usePlaybook && !playbookKey) throw new Error("PLAYBOOK_API_KEY is required.");
  if (useSharp && !sharpKey) throw new Error("SHARPAPI_KEY is required.");
  const playbook = usePlaybook ? new PlaybookClient(playbookKey!) : null;
  const sharp = useSharp ? new SharpApiClient(sharpKey!) : null;
  const report: Json = {
    mode: "read_only",
    generatedAt: new Date().toISOString(),
    requestBudget: {
      playbook: usePlaybook ? leagues.length * 2 : 0,
      sharpapi: useSharp ? leagues.length * 2 : 0,
      total: (usePlaybook ? leagues.length * 2 : 0) + (useSharp ? leagues.length * 2 : 0),
    },
  };
  for (const league of leagues) {
    const leagueReport: Json = {};
    if (playbook) {
      const pbLines = await playbook.lines(league);
      const pbSplits = await playbook.splits(league);
      leagueReport.playbook = {
        lines: summarizePlaybookLines(array(pbLines.body.data) as PlaybookLineGame[]),
        splits: summarizePlaybookSplits(array(pbSplits.body.data) as PlaybookSplitGame[]),
        requestsRemaining: playbook.getQuotaState().requestsRemaining,
      };
    }
    if (sharp) {
      const sharpOdds = await sharp.fetch<unknown[]>({ path: "/odds", query: { league, market: "main", is_live: false, limit: 200 } });
      const sharpSplits = await sharp.fetch<unknown[]>({ path: "/splits", query: { league, limit: 200 } });
      leagueReport.sharpapi = {
        odds: { ...summarizeSharpOdds(array(sharpOdds.data)), pagination: sharpOdds.pagination ?? null },
        splits: { ...summarizeSharpSplits(array(sharpSplits.data)), pagination: sharpSplits.pagination ?? null },
        quota: sharp.getQuotaState(),
      };
    }
    report[league] = leagueReport;
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
