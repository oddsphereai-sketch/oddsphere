#!/usr/bin/env tsx

/**
 * SELECT-only, field-projected audit of the current CFB evidence wave.
 *
 * Do not replace this with readCfbForwardEvidence(): complete historical
 * payloads are intentionally large enough to make a full-season JSON
 * transport unreliable. This audit reads only the provenance and coverage
 * fields needed to identify actionable collection gaps.
 */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE } from "../../lib/services/football/cfbForwardEvidence";
import { readCfbForwardWriterEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { activeCfbWeeklyWindow, isGameInCfbWeeklyWindow } from "../../lib/services/football/cfbWeeklyWindow";

loadEnvConfig(process.cwd());

const PAGE_SIZE = 500;
const GAME_BATCH_SIZE = 10;
const MARKETS = ["moneyline", "spread", "total"] as const;

type ProjectedRow = {
  id: string;
  provider_game_id: string;
  away_team: string;
  home_team: string;
  stage: "opening" | "unlocked" | "t60";
  captured_at: string;
  game_start_at: string;
  payload_schema_release: string | null;
  payload_member_release: string | null;
  away_fbs: boolean | null;
  home_fbs: boolean | null;
  injury_status: string | null;
  injury_report: {
    source?: string;
    sourceLabel?: string;
    sourceUrl?: string | null;
    reportDate?: string | null;
    reportUpdatedAt?: string | null;
    teams?: Array<{ players?: unknown[] }>;
  } | null;
  authoritative_status: string | null;
  final_winner_coordinator_release: string | null;
  coordinator_reason: string | null;
  coordinator_features: Record<string, number | null> | null;
  current_books: Array<{
    provider?: string | null;
    sportsbook?: string | null;
    moneyline?: unknown | null;
    spread?: unknown | null;
    total?: unknown | null;
  }> | null;
  coverage: {
    currentOdds?: boolean;
    currentOddsProviders?: string[];
    targetExcludedConsensusReady?: boolean;
    operationalOpening?: boolean;
    activeQuarterbacks?: boolean;
    injuries?: boolean;
    healthHolds?: string[];
    availabilityWarnings?: string[];
  } | null;
  request_budget: {
    officialAvailability?: number;
    theOddsApi?: number;
    theOddsApiCurrent?: number;
    theOddsApiCurrentAttemptedAt?: string | null;
    theOddsApiCredits?: number;
    theOddsApiRemainingCredits?: number | null;
  } | null;
};

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");

  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error(`Invalid --now value: ${now}`);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const window = activeCfbWeeklyWindow(now);
  // Bound the database scan to the weekly provider envelope before projecting
  // JSON fields. Filtering a full season after transport eventually trips the
  // statement timeout even though this audit certifies only the visible board.
  // The extra day after providerQueryEndDate safely contains Monday-night ET
  // kickoffs that cross UTC midnight; the exact Eastern window is still
  // enforced below by isGameInCfbWeeklyWindow().
  const queryStart = `${window.providerQueryStartDate}T00:00:00.000Z`;
  const queryEndExclusive = new Date(`${window.providerQueryEndDate}T00:00:00.000Z`);
  queryEndExclusive.setUTCDate(queryEndExclusive.getUTCDate() + 1);
  const writerEvidence = await readCfbForwardWriterEvidence({
    client,
    season: Number(now.slice(0, 4)),
    now,
  });
  const currentGameIds = [...new Set(writerEvidence.evidence
    .filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window))
    .map((row) => row.providerGameId))].sort();
  const rows: ProjectedRow[] = [];
  for (let gameIndex = 0; gameIndex < currentGameIds.length; gameIndex += GAME_BATCH_SIZE) {
    const gameIds = currentGameIds.slice(gameIndex, gameIndex + GAME_BATCH_SIZE);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from("cfb_forward_evidence_snapshots")
        .select([
        "id",
        "provider_game_id",
        "away_team",
        "home_team",
        "stage",
        "captured_at",
        "game_start_at",
        "payload_schema_release:payload->>schemaRelease",
        "payload_member_release:payload->>memberRelease",
        "away_fbs:payload->game->away->fbs",
        "home_fbs:payload->game->home->fbs",
        "injury_status:payload->availability->>injuryStatus",
        "injury_report:payload->availability->report",
        "authoritative_status:payload->authoritativeForecast->>status",
        "final_winner_coordinator_release:payload->authoritativeForecast->>finalWinnerCoordinatorRelease",
        "coordinator_reason:payload->authoritativeForecast->>finalWinnerCoordinatorReason",
        "coordinator_features:payload->authoritativeForecast->finalWinnerCoordinatorFeatureSnapshot",
        "current_books:payload->market->currentBooks",
        "coverage:payload->coverage",
        "request_budget:payload->requestBudget",
        ].join(","))
        .eq("season", Number(now.slice(0, 4)))
        .eq("evidence_release", CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE)
        .in("provider_game_id", gameIds)
        .gte("game_start_at", queryStart)
        .lt("game_start_at", queryEndExclusive.toISOString())
        .order("captured_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`CFB projected evidence read failed: ${error.message}`);
      const page = (data ?? []) as unknown as ProjectedRow[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }

  const latest = new Map<string, ProjectedRow>();
  for (const row of rows) {
    if (!isGameInCfbWeeklyWindow({ scheduledStart: row.game_start_at }, window)) continue;
    const current = latest.get(row.provider_game_id);
    if (!current || compareRow(row, current) > 0) latest.set(row.provider_game_id, row);
  }
  const games = [...latest.values()].sort((a, b) => a.game_start_at.localeCompare(b.game_start_at));
  const detail = process.argv.includes("--detail");
  const deficiencies = games.flatMap((row) => {
    const books = row.current_books ?? [];
    const missingMarkets = MARKETS.filter((market) => !books.some((book) => book[market] !== null && book[market] !== undefined));
    const reasons = [
      row.injury_status !== "verified_report" ? "verified_injury_report_unavailable" : null,
      row.authoritative_status !== "market_sharp_applied" ? "reliable_market_anchor_unavailable" : null,
      row.coordinator_reason === "team_profile_unavailable" ? "rich_team_profile_unavailable" : null,
      row.coverage?.activeQuarterbacks !== true ? "active_quarterback_unavailable" : null,
      ...missingMarkets.map((market) => `current_${market}_quote_unavailable`),
    ].filter((value): value is string => value !== null);
    return reasons.length === 0 ? [] : [{
      gameId: row.provider_game_id,
      matchup: `${row.away_team}@${row.home_team}`,
      startsAt: row.game_start_at,
      stage: row.stage,
      reasons,
      injurySource: row.injury_report?.source ?? null,
      injuryReportUpdatedAt: row.injury_report?.reportUpdatedAt ?? null,
      marketProviders: [...new Set(books.map((book) => book.provider ?? "balldontlie"))].sort(),
      healthHolds: row.coverage?.healthHolds ?? [],
      availabilityWarnings: row.coverage?.availabilityWarnings ?? [],
    }];
  });

  const { data: refreshes, error: refreshError } = await client
    .from("data_refresh_log")
    .select("refresh_started_at,refresh_completed_at,refresh_status,records_updated,api_calls_made,error_message")
    .eq("data_source", "cfb_forward_evidence")
    .order("refresh_started_at", { ascending: false })
    .limit(12);
  if (refreshError) throw new Error(`CFB refresh-log read failed: ${refreshError.message}`);

  const captures = games.map((row) => row.captured_at).sort();
  const coordinatorFeatureNames = [...new Set(games.flatMap((row) => Object.keys(row.coordinator_features ?? {})))].sort();
  console.log(JSON.stringify({
    release: "cfb_current_evidence_coverage_audit_2026_10_21_r2_batched_current_window",
    readOnly: true,
    writes: 0,
    providerCalls: 0,
    now,
    window,
    evidenceRelease: CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
    projectedRowsRead: rows.length,
    games: games.length,
    latestGameCaptures: {
      oldest: captures.at(0) ?? null,
      newest: captures.at(-1) ?? null,
      capturedOnOrAfterOfficialInitialWindow: games.filter((row) => Date.parse(row.captured_at) >= Date.parse("2026-10-15T00:00:00.000Z")).length,
    },
    stages: counts(games.map((row) => row.stage)),
    injuryReports: {
      verified: games.filter((row) => row.injury_status === "verified_report").length,
      unavailable: games.filter((row) => row.injury_status !== "verified_report").length,
      sources: counts(games.map((row) => row.injury_report?.source ?? "none")),
      gamesWithListedPlayers: games.filter((row) => (row.injury_report?.teams ?? [])
        .some((team) => (team.players?.length ?? 0) > 0)).length,
    },
    marketAnchors: {
      applied: games.filter((row) => row.authoritative_status === "market_sharp_applied").length,
      unavailable: games.filter((row) => row.authoritative_status !== "market_sharp_applied").length,
      unavailableFbsInvolved: games.filter((row) => row.authoritative_status !== "market_sharp_applied" && (row.away_fbs === true || row.home_fbs === true)).length,
      unavailableFcsOnly: games.filter((row) => row.authoritative_status !== "market_sharp_applied" && row.away_fbs !== true && row.home_fbs !== true).length,
      currentOdds: games.filter((row) => row.coverage?.currentOdds === true).length,
      targetExcludedConsensusReady: games.filter((row) => row.coverage?.targetExcludedConsensusReady === true).length,
      operationalOpening: games.filter((row) => row.coverage?.operationalOpening === true).length,
      quoteCoverage: Object.fromEntries(MARKETS.map((market) => [market,
        games.filter((row) => (row.current_books ?? []).some((book) => book[market] !== null && book[market] !== undefined)).length,
      ])),
      providers: counts(games.flatMap((row) => row.coverage?.currentOddsProviders ?? [])),
    },
    richerStatistics: {
      finalWinnerCoordinatorReleases: counts(games.map((row) => row.final_winner_coordinator_release ?? "not_recorded")),
      coordinatorReasons: counts(games.map((row) => row.coordinator_reason ?? "not_recorded")),
      richTeamProfileUnavailable: games.filter((row) => row.coordinator_reason === "team_profile_unavailable").length,
      activeQuarterbacks: games.filter((row) => row.coverage?.activeQuarterbacks === true).length,
      coordinatorFeatureSnapshots: games.filter((row) => row.coordinator_features !== null).length,
      coordinatorFeatureAvailability: Object.fromEntries(coordinatorFeatureNames.map((feature) => {
        const available = games.filter((row) => {
          const value = row.coordinator_features?.[feature];
          return typeof value === "number" && Number.isFinite(value);
        }).length;
        return [feature, { available, missing: games.length - available }];
      })),
    },
    healthHolds: counts(games.flatMap((row) => row.coverage?.healthHolds ?? [])),
    availabilityWarnings: counts(games.flatMap((row) => row.coverage?.availabilityWarnings ?? [])),
    providerAttempts: {
      gamesMarkedWithOfficialAvailabilityAttempt: games.filter((row) => (row.request_budget?.officialAvailability ?? 0) > 0).length,
      gamesMarkedWithTheOddsApiAttempt: games.filter((row) => (row.request_budget?.theOddsApi ?? 0) > 0).length,
      latestTheOddsApiAttemptAt: games.map((row) => row.request_budget?.theOddsApiCurrentAttemptedAt ?? null).filter((value): value is string => value !== null).sort().at(-1) ?? null,
      latestTheOddsApiRemainingCredits: games
        .filter((row) => row.request_budget?.theOddsApiRemainingCredits !== null && row.request_budget?.theOddsApiRemainingCredits !== undefined)
        .sort((a, b) => Date.parse(b.request_budget?.theOddsApiCurrentAttemptedAt ?? b.captured_at) - Date.parse(a.request_budget?.theOddsApiCurrentAttemptedAt ?? a.captured_at))[0]
        ?.request_budget?.theOddsApiRemainingCredits ?? null,
    },
    deficientGames: deficiencies.length,
    ...(detail ? { deficiencies, refreshes: refreshes ?? [] } : {}),
  }, null, 2));
}

function compareRow(left: ProjectedRow, right: ProjectedRow): number {
  return Date.parse(left.captured_at) - Date.parse(right.captured_at) || left.id.localeCompare(right.id);
}

function counts(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
