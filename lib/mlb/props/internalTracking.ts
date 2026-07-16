import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { PlayerPropPreviewRow } from "@/app/mlb/props/components/PlayerPropsDashboard";
import {
  getHitterGameLogs,
  getPitcherGameLogs,
  type HitterGameLogRecord,
  type PitcherGameLogRecord,
} from "@/lib/providers/real_api/_mlbStatsApiClient";
import type { MlbPropsBoardSnapshot } from "./boardSnapshotStore";
import { isPaperTradingMarketAllowed } from "./paperTrading";
import { assessPropPrice } from "./pricePolicy";
import { MLBStatsAPIClient } from "./providerClients";
import { settlePropPick, type PropSettlementInput } from "./settlement";

const TRACKABLE_GRADES = new Set(["BEST_ANGLE", "LEAN", "WATCHLIST"]);
const ACTIONABLE_GRADES = new Set(["BEST_ANGLE", "LEAN"]);
const DEFAULT_LOCK_MINUTES = 60;
const DEFAULT_LOCK_GRACE_MINUTES = 15;
const DEFAULT_SETTLEMENT_LOOKBACK_DAYS = 4;
const DEFAULT_MAX_PENDING_SETTLEMENTS = 500;

export type MlbPropsTrackingSyncResult = {
  status: "disabled" | "completed" | "failed";
  tableAvailable: boolean;
  candidatesSeen: number;
  candidatesDue: number;
  entriesLocked: number;
  closingPricesUpdated: number;
  error: string | null;
};

export type MlbPropsTrackingHealth = {
  enabled: boolean;
  settlementEnabled: boolean;
  tableAvailable: boolean;
  totalEntries: number;
  pendingEntries: number;
  settledEntries: number;
  actionableEntries: number;
  latestLockedAt: string | null;
  latestSettlementRun: Record<string, unknown> | null;
  error: string | null;
};

type TrackingEntry = {
  id: number;
  tracking_key: string;
  slate_date: string;
  external_game_id: string;
  mlb_game_pk: number;
  game_start_timestamp: string;
  external_player_id: string;
  mlb_player_id: number;
  bdl_player_id: number | null;
  player_name: string;
  team: string;
  opponent: string;
  market_key: string;
  side: "over" | "under";
  line: number;
  sportsbook: string;
  locked_american_odds: number;
  locked_model_probability: number | null;
  locked_market_probability: number | null;
  locked_final_probability: number;
  locked_edge: number | null;
  locked_expected_value: number | null;
  locked_fair_american_odds: number | null;
  play_grade: string;
  confidence_tier: string;
  confidence: number;
  stake_units: number;
  tracking_cohort: "actionable" | "model_observation";
  model_version: string;
  board_snapshot_id: string;
  locked_at: string;
  latest_line: number | null;
  latest_american_odds: number | null;
  latest_market_probability: number | null;
  latest_snapshot_id: string | null;
  latest_price_timestamp: string | null;
  closing_line: number | null;
  closing_american_odds: number | null;
  closing_market_probability: number | null;
  closing_timestamp: string | null;
  clv_status: string;
  clv_probability_delta: number | null;
  clv_american_delta: number | null;
  result_status: string;
  result_value: number | null;
  result_units: number | null;
  settled_at: string | null;
  settlement_provider: string | null;
  settlement_attempts: number;
  settlement_error: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type TrackingCandidate = {
  naturalKey: string;
  row: PlayerPropPreviewRow;
  mlbGamePk: number;
  mlbPlayerId: number;
  minutesToStart: number;
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Internal MLB props tracking requires Supabase service-role credentials.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function internalMlbPropsTrackingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED === "true";
}

export async function syncInternalMlbPropsTracking(
  snapshot: MlbPropsBoardSnapshot,
): Promise<MlbPropsTrackingSyncResult> {
  if (!internalMlbPropsTrackingEnabled()) return disabledSyncResult();
  const supabase = getSupabase();
  const tableCheck = await supabase.from("mlb_prop_tracking_entries").select("id", { head: true, count: "exact" });
  if (tableCheck.error) {
    throw new Error(`Internal MLB props tracking table unavailable. Apply schema migration v37. ${tableCheck.error.message}`);
  }

  const { data: currentRows, error: currentError } = await supabase
    .from("mlb_prop_tracking_entries")
    .select("*")
    .eq("slate_date", snapshot.slateDate)
    .eq("result_status", "pending")
    .limit(250);
  if (currentError) throw currentError;

  let closingPricesUpdated = 0;
  for (const entry of (currentRows ?? []) as TrackingEntry[]) {
    const quote = findClosingQuote(entry, snapshot.data.props);
    if (!quote) continue;
    const quoteTime = Date.parse(quote.lastUpdated);
    const previousTime = Date.parse(entry.closing_timestamp ?? "");
    if (Number.isFinite(previousTime) && quoteTime <= previousTime) continue;
    const sameLine = quote.line === entry.line;
    const comparable = sameLine && entry.locked_market_probability !== null && quote.marketProbability !== null;
    const { error } = await supabase
      .from("mlb_prop_tracking_entries")
      .update({
        latest_line: quote.line,
        latest_american_odds: quote.odds,
        latest_market_probability: quote.marketProbability,
        latest_snapshot_id: snapshot.snapshotId,
        latest_price_timestamp: quote.lastUpdated,
        closing_line: quote.line,
        closing_american_odds: quote.odds,
        closing_market_probability: quote.marketProbability,
        closing_timestamp: quote.lastUpdated,
        clv_status: comparable ? "comparable" : sameLine ? "market_pair_unavailable" : "line_moved_not_comparable",
        clv_probability_delta: comparable
          ? round((quote.marketProbability as number) - (entry.locked_market_probability as number), 6)
          : null,
        clv_american_delta: sameLine ? entry.locked_american_odds - quote.odds : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entry.id)
      .eq("result_status", "pending");
    if (error) throw error;
    closingPricesUpdated++;
  }

  const candidates = selectTrackingCandidates(snapshot);
  const lockMinutes = envPositiveInteger("ODDSPHERE_PROPS_TRACKING_LOCK_MINUTES", DEFAULT_LOCK_MINUTES);
  const graceMinutes = envPositiveInteger("ODDSPHERE_PROPS_TRACKING_LOCK_GRACE_MINUTES", DEFAULT_LOCK_GRACE_MINUTES);
  const due = candidates.filter((candidate) => candidate.minutesToStart > 0 && candidate.minutesToStart <= lockMinutes);
  let entriesLocked = 0;
  if (due.length > 0) {
    const rows = due.map((candidate) => trackingInsert(candidate, snapshot, lockMinutes, graceMinutes));
    const { data, error } = await supabase
      .from("mlb_prop_tracking_entries")
      .upsert(rows, { onConflict: "tracking_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    entriesLocked = data?.length ?? 0;
  }

  return {
    status: "completed",
    tableAvailable: true,
    candidatesSeen: candidates.length,
    candidatesDue: due.length,
    entriesLocked,
    closingPricesUpdated,
    error: null,
  };
}

export async function readMlbPropsTrackingHealth(): Promise<MlbPropsTrackingHealth> {
  const fallback: MlbPropsTrackingHealth = {
    enabled: internalMlbPropsTrackingEnabled(),
    settlementEnabled: process.env.MLB_PLAYER_PROPS_SETTLEMENT_CRON_ENABLED === "true",
    tableAvailable: false,
    totalEntries: 0,
    pendingEntries: 0,
    settledEntries: 0,
    actionableEntries: 0,
    latestLockedAt: null,
    latestSettlementRun: null,
    error: null,
  };
  let supabase: ReturnType<typeof getSupabase>;
  try {
    supabase = getSupabase();
  } catch (error) {
    return { ...fallback, error: errorMessage(error) };
  }
  const [all, pending, actionable, latest, settlement] = await Promise.all([
    supabase.from("mlb_prop_tracking_entries").select("id", { head: true, count: "exact" }),
    supabase.from("mlb_prop_tracking_entries").select("id", { head: true, count: "exact" }).eq("result_status", "pending"),
    supabase.from("mlb_prop_tracking_entries").select("id", { head: true, count: "exact" }).eq("tracking_cohort", "actionable"),
    supabase.from("mlb_prop_tracking_entries").select("locked_at").order("locked_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("prop_settlement_runs").select("id,slate_date,status,props_settled,pushes,unresolved,error_message,metadata_json,created_at,completed_at").eq("sport", "mlb").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const firstError = all.error ?? pending.error ?? actionable.error ?? latest.error ?? settlement.error;
  if (firstError) return { ...fallback, error: firstError.message };
  return {
    ...fallback,
    tableAvailable: true,
    totalEntries: all.count ?? 0,
    pendingEntries: pending.count ?? 0,
    settledEntries: Math.max(0, (all.count ?? 0) - (pending.count ?? 0)),
    actionableEntries: actionable.count ?? 0,
    latestLockedAt: latest.data?.locked_at ?? null,
    latestSettlementRun: settlement.data as Record<string, unknown> | null,
  };
}

export async function getInternalMlbPropsTrackingReport(args: { startDate?: string; limit?: number } = {}) {
  const supabase = getSupabase();
  const startDate = args.startDate ?? dateDaysAgo(DEFAULT_SETTLEMENT_LOOKBACK_DAYS * 30);
  const { data, error } = await supabase
    .from("mlb_prop_tracking_entries")
    .select("*")
    .gte("slate_date", startDate)
    .order("locked_at", { ascending: false })
    .limit(Math.min(args.limit ?? 2_500, 5_000));
  if (error) throw error;
  const rows = (data ?? []) as TrackingEntry[];
  const actionable = rows.filter((row) => row.tracking_cohort === "actionable");
  return {
    startDate,
    generatedAt: new Date().toISOString(),
    summary: performanceMetrics(actionable),
    calibration: performanceMetrics(rows),
    byMarket: groupMetrics(actionable, (row) => row.market_key),
    byGrade: groupMetrics(actionable, (row) => row.play_grade),
    recent: rows.slice(0, 250).map(publicTrackingRow),
  };
}

export async function settleInternalMlbProps(args: { dates?: string[] } = {}) {
  const supabase = getSupabase();
  const dates = args.dates?.filter(validDate) ?? [];
  let query = supabase
    .from("mlb_prop_tracking_entries")
    .select("*")
    .eq("result_status", "pending")
    .order("game_start_timestamp", { ascending: true })
    .limit(envPositiveInteger("ODDSPHERE_PROPS_MAX_PENDING_SETTLEMENTS", DEFAULT_MAX_PENDING_SETTLEMENTS));
  query = dates.length > 0 ? query.in("slate_date", dates) : query.gte("slate_date", dateDaysAgo(DEFAULT_SETTLEMENT_LOOKBACK_DAYS));
  const { data, error } = await query;
  if (error) throw error;
  const pending = (data ?? []) as TrackingEntry[];
  const runDate = dates[0] ?? easternDate();
  const { data: run, error: runError } = await supabase
    .from("prop_settlement_runs")
    .insert({
      sport: "mlb",
      slate_date: runDate,
      provider: "mlb_stats_api",
      status: "started",
      metadata_json: { requestedDates: dates, pendingLoaded: pending.length, internalLedger: true },
    })
    .select("id")
    .single();
  if (runError) throw runError;

  let propsSettled = 0;
  let pushes = 0;
  let unresolved = 0;
  let voided = 0;
  const gamesSettled = new Set<string>();
  try {
    const datesToLoad = [...new Set(pending.map((row) => row.slate_date))];
    const scheduleByDate = new Map<string, Awaited<ReturnType<MLBStatsAPIClient["getGames"]>>>();
    const scheduleClient = new MLBStatsAPIClient();
    await mapWithConcurrency(datesToLoad, 3, async (date) => {
      scheduleByDate.set(date, await scheduleClient.getGames({ date }));
    });
    const finalGameIds = new Set(
      datesToLoad.flatMap((date) => (scheduleByDate.get(date) ?? [])
        .filter((game) => game.gameStatus.toLowerCase() === "final")
        .map((game) => game.id)),
    );
    const finalRows = pending.filter((row) => finalGameIds.has(row.external_game_id));
    const logKeys = [...new Set(finalRows.map((row) => gameLogKey(row)))];
    const logsByKey = new Map<string, Array<PitcherGameLogRecord | HitterGameLogRecord> | null>();
    await mapWithConcurrency(logKeys, 4, async (key) => {
      const [family, playerIdRaw, seasonRaw] = key.split("|");
      const playerId = Number(playerIdRaw);
      const season = Number(seasonRaw);
      logsByKey.set(key, family === "hitter"
        ? await getHitterGameLogs(playerId, season, { quiet: true })
        : await getPitcherGameLogs(playerId, season, { quiet: true }));
    });

    for (const entry of finalRows) {
      const logs = logsByKey.get(gameLogKey(entry));
      if (logs === null || logs === undefined) {
        unresolved++;
        await markSettlementAttempt(supabase, entry, "MLB Stats game log unavailable");
        continue;
      }
      const gameLog = logs.find((log) => log.game_pk === entry.mlb_game_pk);
      if (!gameLog) {
        const nextAttempt = entry.settlement_attempts + 1;
        if (nextAttempt < 2) {
          unresolved++;
          await markSettlementAttempt(supabase, entry, "Final game found; pitcher log not available yet");
          continue;
        }
        const { error: updateError } = await supabase.from("mlb_prop_tracking_entries").update({
          result_status: "void",
          result_units: 0,
          settled_at: new Date().toISOString(),
          settlement_provider: "mlb_stats_api",
          settlement_attempts: nextAttempt,
          settlement_error: "Pitcher did not record a start in the final game",
          updated_at: new Date().toISOString(),
        }).eq("id", entry.id).eq("result_status", "pending");
        if (updateError) throw updateError;
        voided++;
        gamesSettled.add(entry.external_game_id);
        continue;
      }
      const pitcherLog = isPitcherGameLog(gameLog) ? gameLog : null;
      if (pitcherLog && !pitcherLog.is_start) {
        const { error: updateError } = await supabase.from("mlb_prop_tracking_entries").update({
          result_status: "void",
          result_units: 0,
          settled_at: new Date().toISOString(),
          settlement_provider: "mlb_stats_api",
          settlement_attempts: entry.settlement_attempts + 1,
          settlement_error: "Pitcher did not start",
          updated_at: new Date().toISOString(),
        }).eq("id", entry.id).eq("result_status", "pending");
        if (updateError) throw updateError;
        voided++;
        gamesSettled.add(entry.external_game_id);
        continue;
      }
      const decision = settlePropPick({
        marketKey: entry.market_key as PropSettlementInput["marketKey"],
        playerId: entry.external_player_id,
        gameId: entry.external_game_id,
        line: entry.line,
        side: entry.side,
        finalStats: finalStatsForEntry(entry, gameLog),
        playerStarted: true,
        stakeUnits: entry.stake_units,
        americanOdds: entry.locked_american_odds,
      });
      if (decision.status === "unresolved") {
        unresolved++;
        await markSettlementAttempt(supabase, entry, decision.reason);
        continue;
      }
      const { error: updateError } = await supabase.from("mlb_prop_tracking_entries").update({
        result_status: decision.result,
        result_value: decision.resultValue,
        result_units: decision.units,
        settled_at: new Date().toISOString(),
        settlement_provider: "mlb_stats_api",
        settlement_attempts: entry.settlement_attempts + 1,
        settlement_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", entry.id).eq("result_status", "pending");
      if (updateError) throw updateError;
      propsSettled++;
      if (decision.result === "push") pushes++;
      gamesSettled.add(entry.external_game_id);
    }

    const completedAt = new Date().toISOString();
    const { error: completeError } = await supabase.from("prop_settlement_runs").update({
      completed_at: completedAt,
      status: "completed",
      games_settled: gamesSettled.size,
      props_settled: propsSettled,
      pushes,
      unresolved,
      metadata_json: { requestedDates: dates, pendingLoaded: pending.length, finalRows: finalRows.length, voided, internalLedger: true },
    }).eq("id", run.id);
    if (completeError) throw completeError;
    return { runId: Number(run.id), pendingLoaded: pending.length, finalRows: finalRows.length, gamesSettled: gamesSettled.size, propsSettled, pushes, voided, unresolved };
  } catch (settlementError) {
    await supabase.from("prop_settlement_runs").update({
      completed_at: new Date().toISOString(),
      status: "failed",
      games_settled: gamesSettled.size,
      props_settled: propsSettled,
      pushes,
      unresolved,
      error_message: errorMessage(settlementError),
      metadata_json: { requestedDates: dates, pendingLoaded: pending.length, voided, internalLedger: true },
    }).eq("id", run.id);
    throw settlementError;
  }
}

function selectTrackingCandidates(snapshot: MlbPropsBoardSnapshot): TrackingCandidate[] {
  const asOf = Date.parse(snapshot.asOfTimestamp);
  const byNaturalKey = new Map<string, TrackingCandidate>();
  for (const row of snapshot.data.props) {
    const mlbGamePk = prefixedInteger(row.providerIds?.gameId, "mlbstats-game-");
    const mlbPlayerId = prefixedInteger(row.providerIds?.mlbStatsPlayerId, "mlbstats-player-");
    if (mlbGamePk === null || mlbPlayerId === null || row.finalProbability === null) continue;
    if (!isPaperTradingMarketAllowed(row.market) || !TRACKABLE_GRADES.has(row.playGrade)) continue;
    if (!assessPropPrice(row.odds).signalEligible || row.oddsSanity.includes("STALE_ODDS")) continue;
    const start = Date.parse(row.gameStartTime);
    if (!Number.isFinite(start) || !Number.isFinite(asOf)) continue;
    const minutesToStart = (start - asOf) / 60_000;
    const naturalKey = `${row.providerIds?.gameId}|${mlbPlayerId}|${row.market}`;
    const candidate = { naturalKey, row, mlbGamePk, mlbPlayerId, minutesToStart };
    const previous = byNaturalKey.get(naturalKey);
    if (!previous || candidateRank(candidate) > candidateRank(previous)) byNaturalKey.set(naturalKey, candidate);
  }
  return [...byNaturalKey.values()];
}

function gameLogKey(row: Pick<TrackingEntry, "market_key" | "mlb_player_id" | "slate_date">): string {
  return `${row.market_key.startsWith("batter_") ? "hitter" : "pitcher"}|${row.mlb_player_id}|${row.slate_date.slice(0, 4)}`;
}

function isPitcherGameLog(log: PitcherGameLogRecord | HitterGameLogRecord): log is PitcherGameLogRecord {
  return "is_start" in log;
}

function finalStatsForEntry(
  entry: Pick<TrackingEntry, "market_key">,
  log: PitcherGameLogRecord | HitterGameLogRecord,
): Record<string, number | string | boolean | null> {
  if (isPitcherGameLog(log)) {
    return {
      strikeouts: log.strikeouts,
      outs: log.outs,
      innings_pitched: log.innings_pitched,
      hits_allowed: log.hits_allowed,
      walks: log.walks,
      earned_runs: log.earned_runs,
    };
  }
  return {
    plate_appearances: log.plate_appearances,
    at_bats: log.at_bats,
    hits: log.hits,
    singles: log.singles,
    doubles: log.doubles,
    triples: log.triples,
    home_runs: log.home_runs,
    total_bases: log.total_bases,
    rbis: log.rbis,
    runs: log.runs,
    strikeouts: log.strikeouts,
    walks: log.walks,
    stolen_bases: log.stolen_bases,
    hits_runs_rbis: log.hits_runs_rbis,
    market_key: entry.market_key,
  };
}

function candidateRank(candidate: TrackingCandidate): number {
  const grade = candidate.row.playGrade === "BEST_ANGLE" ? 3 : candidate.row.playGrade === "LEAN" ? 2 : 1;
  return grade * 1_000_000 + (candidate.row.expectedValue ?? -1) * 10_000 + (candidate.row.modelEdge ?? -1) * 1_000 + candidate.row.odds / 10_000;
}

function trackingInsert(candidate: TrackingCandidate, snapshot: MlbPropsBoardSnapshot, targetLockMinutes: number, graceMinutes: number) {
  const row = candidate.row;
  const actionable = ACTIONABLE_GRADES.has(row.playGrade) && row.units > 0;
  const bdlPlayerId = row.providerIds?.bdlPlayerId ?? null;
  return {
    tracking_key: createHash("sha256").update(candidate.naturalKey).digest("hex"),
    slate_date: snapshot.slateDate,
    external_game_id: row.providerIds?.gameId,
    mlb_game_pk: candidate.mlbGamePk,
    game_start_timestamp: row.gameStartTime,
    external_player_id: `mlbstats-player-${candidate.mlbPlayerId}`,
    mlb_player_id: candidate.mlbPlayerId,
    bdl_player_id: bdlPlayerId,
    player_name: row.player,
    team: row.team,
    opponent: row.opponent,
    market_key: row.market,
    side: row.side,
    line: row.line,
    sportsbook: row.book,
    locked_american_odds: row.odds,
    locked_model_probability: row.modelProbability,
    locked_market_probability: row.marketProbability,
    locked_final_probability: row.finalProbability,
    locked_edge: row.modelEdge,
    locked_expected_value: row.expectedValue,
    locked_fair_american_odds: row.fairOdds,
    play_grade: row.playGrade,
    confidence_tier: row.confidenceBucket,
    confidence: row.confidence,
    stake_units: actionable ? row.units : 0,
    tracking_cohort: actionable ? "actionable" : "model_observation",
    model_version: process.env.ODDSPHERE_PROPS_MODEL_VERSION ?? "mlb_props_distribution_v1",
    board_snapshot_id: snapshot.snapshotId,
    locked_at: snapshot.asOfTimestamp,
    latest_line: row.line,
    latest_american_odds: row.odds,
    latest_market_probability: row.marketProbability,
    latest_snapshot_id: snapshot.snapshotId,
    latest_price_timestamp: row.lastUpdated,
    closing_line: row.line,
    closing_american_odds: row.odds,
    closing_market_probability: row.marketProbability,
    closing_timestamp: row.lastUpdated,
    clv_status: row.marketProbability === null ? "market_pair_unavailable" : "comparable",
    clv_probability_delta: row.marketProbability === null ? null : 0,
    clv_american_delta: 0,
    metadata_json: {
      private: true,
      lockPolicy: `T-${targetLockMinutes}`,
      minutesToStart: round(candidate.minutesToStart, 2),
      lateLock: candidate.minutesToStart < Math.max(1, targetLockMinutes - graceMinutes),
      reasonCodes: row.reasonCodes,
      source: row.source,
      publicDisplayEnabledAtLock: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
    },
  };
}

function findClosingQuote(entry: TrackingEntry, rows: PlayerPropPreviewRow[]): PlayerPropPreviewRow | null {
  const candidates = rows.filter((row) =>
    row.providerIds?.gameId === entry.external_game_id &&
    prefixedInteger(row.providerIds?.mlbStatsPlayerId, "mlbstats-player-") === entry.mlb_player_id &&
    row.market === entry.market_key &&
    row.side === entry.side &&
    row.book === entry.sportsbook &&
    !row.oddsSanity.includes("STALE_ODDS") &&
    Date.parse(row.lastUpdated) <= Date.parse(entry.game_start_timestamp),
  );
  return candidates.sort((a, b) => {
    const exactA = a.line === entry.line ? 1 : 0;
    const exactB = b.line === entry.line ? 1 : 0;
    if (exactA !== exactB) return exactB - exactA;
    const distance = Math.abs(a.line - entry.line) - Math.abs(b.line - entry.line);
    if (distance !== 0) return distance;
    return Date.parse(b.lastUpdated) - Date.parse(a.lastUpdated);
  })[0] ?? null;
}

async function markSettlementAttempt(supabase: ReturnType<typeof getSupabase>, entry: TrackingEntry, message: string) {
  const { error } = await supabase.from("mlb_prop_tracking_entries").update({
    settlement_attempts: entry.settlement_attempts + 1,
    settlement_error: message,
    updated_at: new Date().toISOString(),
  }).eq("id", entry.id).eq("result_status", "pending");
  if (error) throw error;
}

function performanceMetrics(rows: TrackingEntry[]) {
  const wins = rows.filter((row) => row.result_status === "win").length;
  const losses = rows.filter((row) => row.result_status === "loss").length;
  const pushes = rows.filter((row) => row.result_status === "push").length;
  const voids = rows.filter((row) => row.result_status === "void").length;
  const pending = rows.filter((row) => row.result_status === "pending").length;
  const decisions = wins + losses;
  const pricedDecisions = rows.filter((row) => row.result_status === "win" || row.result_status === "loss");
  const units = pricedDecisions.reduce((sum, row) => sum + (row.result_units ?? 0), 0);
  const riskedUnits = pricedDecisions.reduce((sum, row) => sum + row.stake_units, 0);
  const clvRows = rows.filter((row) => row.clv_status === "comparable" && row.clv_probability_delta !== null);
  const brierRows = rows.filter((row) => row.result_status === "win" || row.result_status === "loss");
  return {
    tracked: rows.length,
    wins,
    losses,
    pushes,
    voids,
    pending,
    hitRate: decisions ? round(wins / decisions, 4) : null,
    units: round(units, 3),
    riskedUnits: round(riskedUnits, 3),
    roi: riskedUnits ? round(units / riskedUnits, 4) : null,
    averageClvProbabilityDelta: clvRows.length ? round(clvRows.reduce((sum, row) => sum + (row.clv_probability_delta ?? 0), 0) / clvRows.length, 6) : null,
    brierScore: brierRows.length ? round(brierRows.reduce((sum, row) => {
      const outcome = row.result_status === "win" ? 1 : 0;
      return sum + (row.locked_final_probability - outcome) ** 2;
    }, 0) / brierRows.length, 6) : null,
  };
}

function groupMetrics(rows: TrackingEntry[], keyFor: (row: TrackingEntry) => string) {
  const groups = new Map<string, TrackingEntry[]>();
  for (const row of rows) groups.set(keyFor(row), [...(groups.get(keyFor(row)) ?? []), row]);
  return [...groups.entries()].map(([key, grouped]) => ({ key, ...performanceMetrics(grouped) })).sort((a, b) => b.tracked - a.tracked);
}

function publicTrackingRow(row: TrackingEntry) {
  return {
    id: row.id,
    slateDate: row.slate_date,
    gameStartTimestamp: row.game_start_timestamp,
    player: row.player_name,
    team: row.team,
    opponent: row.opponent,
    market: row.market_key,
    side: row.side,
    line: row.line,
    sportsbook: row.sportsbook,
    lockedOdds: row.locked_american_odds,
    finalProbability: row.locked_final_probability,
    marketProbability: row.locked_market_probability,
    edge: row.locked_edge,
    expectedValue: row.locked_expected_value,
    grade: row.play_grade,
    confidence: row.confidence,
    stakeUnits: row.stake_units,
    cohort: row.tracking_cohort,
    lockedAt: row.locked_at,
    closingLine: row.closing_line,
    closingOdds: row.closing_american_odds,
    clvStatus: row.clv_status,
    clvProbabilityDelta: row.clv_probability_delta,
    resultStatus: row.result_status,
    resultValue: row.result_value,
    resultUnits: row.result_units,
    settledAt: row.settled_at,
    settlementError: row.settlement_error,
  };
}

function disabledSyncResult(): MlbPropsTrackingSyncResult {
  return { status: "disabled", tableAvailable: false, candidatesSeen: 0, candidatesDue: 0, entriesLocked: 0, closingPricesUpdated: 0, error: null };
}

function prefixedInteger(value: string | null | undefined, prefix: string): number | null {
  if (!value?.startsWith(prefix)) return null;
  const parsed = Number(value.slice(prefix.length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function envPositiveInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function easternDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
