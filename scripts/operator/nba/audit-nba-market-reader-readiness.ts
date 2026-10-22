#!/usr/bin/env npx tsx
/** Read-only NBA market-reader readiness report. No refresh or write occurs. */

import { writeFileSync } from "node:fs";
import { supabase } from "../../../lib/db/supabase";
import { currentSlateDate } from "../../../lib/dates/slateDate";
import {
  evaluateNbaMarketCandidates,
  summarizeNbaMarketEvidence,
  type NbaMarketAuditCandidate,
  type NbaMarketAuditEvent,
  type NbaMarketAuditPriceRow,
  type NbaMarketAuditSplitRow,
} from "../../../lib/services/nba/nbaMarketReaderAudit";
import type { MarketIntelligenceMarketType } from "../../../lib/types/domain/MarketIntelligenceV2";
import { readStringFlag } from "../_cliCommon";

type Row = Record<string, unknown>;

const EVIDENCE_PAGE_SIZE = 1_000;

async function readEvidenceRows(args: {
  table: "market_split_observations_v2" | "market_price_observations_v2";
  select: string;
  eventIds: string[];
}): Promise<Row[]> {
  if (args.eventIds.length === 0) return [];
  const highWater = await supabase
    .from(args.table)
    .select("id")
    .eq("league", "nba")
    .in("canonical_event_id", args.eventIds)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (highWater.error) throw new Error(`${args.table} high water: ${highWater.error.message}`);
  const highWaterId = Number(highWater.data?.id ?? 0);
  const rows: Row[] = [];
  let lastId = 0;
  while (lastId < highWaterId) {
    const page = await supabase
      .from(args.table)
      .select(`id, ${args.select}`)
      .eq("league", "nba")
      .in("canonical_event_id", args.eventIds)
      .gt("id", lastId)
      .lte("id", highWaterId)
      .order("id", { ascending: true })
      .limit(EVIDENCE_PAGE_SIZE);
    if (page.error) throw new Error(`${args.table}: ${page.error.message}`);
    const data = (page.data ?? []) as unknown as Row[];
    if (data.some((row, index) => {
      const id = Number(row.id);
      const priorId = index === 0 ? lastId : Number(data[index - 1]!.id);
      return !Number.isInteger(id) || id <= priorId;
    })) throw new Error(`${args.table}: invalid id ordering`);
    rows.push(...data);
    if (data.length < EVIDENCE_PAGE_SIZE) break;
    lastId = Number(data.at(-1)!.id);
  }
  return rows;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const date = readStringFlag(argv, "--date") ?? currentSlateDate("nba");
  const output = readStringFlag(argv, "--output");
  const detail = argv.includes("--detail");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pass --date YYYY-MM-DD.");

  const { data: gamesData, error: gamesError } = await supabase
    .from("games")
    .select("id, external_id, game_date, home_team_id, away_team_id")
    .eq("sport", "nba")
    .eq("slate_date", date)
    .order("game_date", { ascending: true });
  if (gamesError) throw new Error(`games: ${gamesError.message}`);
  const games = (gamesData ?? []) as Row[];
  const eventIds = games.map((game) => String(game.external_id));
  const gameIds = games.map((game) => Number(game.id));
  const eventByGame = new Map(games.map((game) => [Number(game.id), game]));
  const events: NbaMarketAuditEvent[] = games.map((game) => ({
    canonicalEventId: String(game.external_id),
    startTime: typeof game.game_date === "string" ? game.game_date : null,
  }));

  const splitRows = await readEvidenceRows({
    table: "market_split_observations_v2",
    select: "canonical_event_id, provider, source_book, source_type, market_type, selection_key, bets_pct, money_pct, market_line, market_price, split_line_basis, books_used, source_observed_at, fetched_at",
    eventIds,
  }) as NbaMarketAuditSplitRow[];
  const priceRows = await readEvidenceRows({
    table: "market_price_observations_v2",
    select: "canonical_event_id, sportsbook, sharp_book, market_type, selection_key, american_price, no_vig_probability, line, provider_timestamp, fetched_at",
    eventIds,
  }) as NbaMarketAuditPriceRow[];

  const recordQuery = gameIds.length === 0
    ? { data: [] as Row[], error: null }
    : await supabase
        .from("prediction_records")
        .select("game_id, market, side, line_value, odds_american, locked_at, play_grade, best_angle, model_version")
        .eq("sport", "nba")
        .eq("slate_date", date)
        .in("game_id", gameIds)
        .in("market", ["moneyline", "total"]);
  if (recordQuery.error) throw new Error(`prediction_records: ${recordQuery.error.message}`);

  const candidates: NbaMarketAuditCandidate[] = ((recordQuery.data ?? []) as Row[]).flatMap((row) => {
    const game = eventByGame.get(Number(row.game_id));
    const market = row.market as MarketIntelligenceMarketType;
    if (!game || (market !== "moneyline" && market !== "total")) return [];
    const selection = String(row.side ?? "");
    if (!["home", "away", "over", "under"].includes(selection)) return [];
    return [{
      canonicalEventId: String(game.external_id),
      marketType: market,
      selectionKey: `${game.external_id}:${market}:${selection}`,
      selectedLine: typeof row.line_value === "number" ? row.line_value : null,
      selectedPrice: typeof row.odds_american === "number" ? row.odds_american : null,
      recommendationLockedAt: typeof row.locked_at === "string" ? row.locked_at : null,
      eventStartTime: typeof game.game_date === "string" ? game.game_date : null,
    }];
  });

  const asOf = new Date().toISOString();
  const resolved = evaluateNbaMarketCandidates({ candidates, splitRows, priceRows, asOf });
  const payload = {
    sport: "nba",
    date,
    generatedAt: asOf,
    games: games.length,
    officialCandidates: candidates.length,
    evidence: summarizeNbaMarketEvidence({ events, splitRows, priceRows, asOf }),
    candidateReads: resolved.map((candidate) => ({
      eventId: candidate.canonicalEventId,
      market: candidate.marketType,
      selectionKey: candidate.selectionKey,
      selectedLine: candidate.selectedLine,
      selectedPrice: candidate.selectedPrice,
      validityStatus: candidate.resolved.validityStatus,
      score: candidate.resolved.score,
      label: candidate.resolved.label,
      explanation: candidate.resolved.explanation,
      evidenceAsOf: candidate.resolved.evidenceAsOf,
      exactLinePriceEvidence: candidate.resolved.evidence.exactLinePriceEvidence,
      movement: candidate.resolved.evidence.marketMovementEvidence,
      playbookConsensus: candidate.resolved.evidence.playbookConsensus,
      sharpApiSourceSpecific: candidate.resolved.evidence.sharpApiSourceSpecific,
      sharpRetailPriceMap: candidate.resolved.evidence.sharpRetailPriceMap,
      qualityGates: candidate.resolved.evidence.trace.qualityGates,
      evidenceRejected: detail
        ? candidate.resolved.evidence.trace.evidenceRejected
        : Object.entries(candidate.resolved.evidence.trace.evidenceRejected.reduce<Record<string, number>>((counts, reason) => {
            counts[reason] = (counts[reason] ?? 0) + 1;
            return counts;
          }, {})).map(([reason, count]) => ({ reason, count })),
    })),
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  if (output) writeFileSync(output, body);
  process.stdout.write(body);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
