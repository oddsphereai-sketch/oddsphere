/**
 * READ ONLY. Extracts compact, historically frozen feature context from the
 * exact MLB props board snapshot referenced by each settled tracking row.
 *
 * The source snapshots are large, so this operator caches only the numeric
 * fields needed by retrospective model tournaments. It never writes to the
 * production database.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { supabase } from "../../lib/db/supabase";
import { decodeMlbPropsBoardSnapshot } from "../../lib/mlb/props/boardSnapshotStore";

type TrackingRef = {
  slate_date: string;
  board_snapshot_id: string;
  external_game_id: string;
  mlb_player_id: number;
  market_key: string;
  line: number;
};

type FrozenContext = {
  lineupStatus: string | null;
  battingOrder: number | null;
  homeAway: string | null;
  opponentStrikeoutRate: number | null;
  opponentStrikeoutRateDelta: number | null;
  opponentWalkRate: number | null;
  opponentWalkRateDelta: number | null;
  opponentBattingAverage: number | null;
  opponentBattingAverageDelta: number | null;
  opponentOps: number | null;
  opponentOpsDelta: number | null;
  opponentHomeRunRate: number | null;
  opponentHomeRunRateDelta: number | null;
  arsenalPitchesTrackedLog: number | null;
  arsenalWhiffPercent: number | null;
  arsenalChasePercent: number | null;
  arsenalZonePercent: number | null;
  arsenalBattingAverageAllowed: number | null;
  arsenalXwobaAllowed: number | null;
  pitchMatchupCoverage: number | null;
  pitchMatchupPitchesSeenLog: number | null;
  pitchMatchupBattingAverage: number | null;
  pitchMatchupSlugging: number | null;
  pitchMatchupXwoba: number | null;
  pitchMatchupWhiffPercent: number | null;
  matchupPlateAppearancesLog: number | null;
  matchupBattingAverage: number | null;
  matchupOnBasePercentage: number | null;
  matchupSluggingPercentage: number | null;
  matchupOps: number | null;
  matchupStrikeoutRate: number | null;
  matchupWalkRate: number | null;
  matchupHomeRunRate: number | null;
  parkRunFactor: number | null;
  parkHomeRunFactor: number | null;
  parkStrikeoutFactor: number | null;
  temperatureF: number | null;
  windSpeedMph: number | null;
  precipitationProbability: number | null;
  roofStatus: string | null;
};

const CACHE_PATH = "/private/tmp/oddsphere-mlb-props-locked-feature-context.json";

async function loadTrackingRefs(): Promise<TrackingRef[]> {
  const output: TrackingRef[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("mlb_prop_tracking_entries")
      .select("slate_date,board_snapshot_id,external_game_id,mlb_player_id,market_key,line")
      .in("result_status", ["win", "loss"])
      .not("board_snapshot_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    output.push(...((data ?? []) as TrackingRef[]));
    if ((data ?? []).length < 1000) return output;
  }
}

async function loadSnapshotRunIds(targets: Set<string>): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  for (let from = 0; output.size < targets.size; from += 1000) {
    const { data, error } = await supabase.from("admin_audit_log")
      .select("target_id,after_state")
      .eq("action_type", "mlb_props.board_snapshot_published")
      .eq("target_table", "prop_scoring_runs")
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) {
      const state = record(row.after_state);
      const date = string(state?.slate_date);
      const snapshotId = string(state?.snapshot_id);
      if (date && snapshotId && targets.has(`${date}|${snapshotId}`)) {
        output.set(`${date}|${snapshotId}`, String(row.target_id));
      }
    }
    if ((data ?? []).length < 1000) break;
  }
  return output;
}

async function main() {
  const refs = await loadTrackingRefs();
  const bySnapshot = new Map<string, TrackingRef[]>();
  for (const ref of refs) {
    const key = `${ref.slate_date}|${ref.board_snapshot_id}`;
    bySnapshot.set(key, [...(bySnapshot.get(key) ?? []), ref]);
  }
  const cached = existsSync(CACHE_PATH)
    ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Record<string, FrozenContext>
    : {};
  const targets = new Set([...bySnapshot].filter(([, rows]) => rows.some((row) => !cached[observationKey(row)])).map(([key]) => key));
  const runIds = await loadSnapshotRunIds(targets);
  let processed = 0;
  let matched = 0;
  for (const snapshotKey of targets) {
    const runId = runIds.get(snapshotKey);
    if (!runId) continue;
    const { data, error } = await supabase.from("prop_scoring_runs").select("metadata_json").eq("id", runId).maybeSingle();
    if (error) throw error;
    const snapshot = decodeMlbPropsBoardSnapshot(data?.metadata_json);
    const board = record(snapshot?.data);
    const props = Array.isArray(board?.props) ? board.props.map(record).filter(Boolean) as Record<string, unknown>[] : [];
    const research = record(board?.research) ?? {};
    const requested = bySnapshot.get(snapshotKey) ?? [];
    const unique = new Map(requested.map((row) => [observationKey(row), row]));
    for (const [key, ref] of unique) {
      if (cached[key]) continue;
      const prop = props.find((candidate) => matches(candidate, ref));
      if (!prop) continue;
      const evidence = record(research[string(prop.researchKey) ?? ""]);
      cached[key] = extract(prop, evidence);
      matched++;
    }
    processed++;
    if (processed % 5 === 0) {
      writeFileSync(CACHE_PATH, JSON.stringify(cached));
      console.log(JSON.stringify({ processed, targets: targets.size, matched, cached: Object.keys(cached).length }));
    }
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cached));
  console.log(JSON.stringify({ cachePath: CACHE_PATH, trackingRows: refs.length, snapshots: bySnapshot.size, targets: targets.size, resolved: runIds.size, processed, matched, cached: Object.keys(cached).length }, null, 2));
}

function matches(prop: Record<string, unknown>, ref: TrackingRef) {
  const ids = record(prop.providerIds);
  const mlbId = String(ids?.mlbStatsPlayerId ?? "").match(/(\d+)$/)?.[1];
  return ids?.gameId === ref.external_game_id
    && Number(mlbId) === Number(ref.mlb_player_id)
    && prop.market === ref.market_key
    && Number(prop.line) === Number(ref.line);
}

function extract(prop: Record<string, unknown>, evidenceValue: Record<string, unknown> | null): FrozenContext {
  const evidence = evidenceValue ?? {};
  const lineup = record(prop.lineupStatus);
  const opponent = record(evidence.opponentProfile);
  const strikeout = record(opponent?.strikeoutRate);
  const walk = record(opponent?.walkRate);
  const average = record(opponent?.battingAverage);
  const ops = record(opponent?.ops);
  const homeRun = record(opponent?.homeRunRate);
  const arsenal = record(evidence.pitchArsenal);
  const arsenalPitches = Array.isArray(arsenal?.pitches) ? arsenal.pitches.map(record).filter(Boolean) as Record<string, unknown>[] : [];
  const pitchMatchup = record(evidence.pitchMatchup);
  const weighted = record(pitchMatchup?.weighted);
  const matchup = record(evidence.matchupHistory);
  const environment = record(evidence.environment);
  const park = record(environment?.park);
  const weather = record(environment?.weather);
  const plateAppearances = number(matchup?.plateAppearances);
  return {
    lineupStatus: string(lineup?.status), battingOrder: number(lineup?.battingOrder), homeAway: string(prop.homeAway),
    opponentStrikeoutRate: number(strikeout?.value), opponentStrikeoutRateDelta: delta(strikeout),
    opponentWalkRate: number(walk?.value), opponentWalkRateDelta: delta(walk),
    opponentBattingAverage: number(average?.value), opponentBattingAverageDelta: delta(average),
    opponentOps: number(ops?.value), opponentOpsDelta: delta(ops),
    opponentHomeRunRate: number(homeRun?.value), opponentHomeRunRateDelta: delta(homeRun),
    arsenalPitchesTrackedLog: logCount(arsenal?.pitchesTracked),
    arsenalWhiffPercent: weightedPitchMetric(arsenalPitches, "whiffPercent"),
    arsenalChasePercent: weightedPitchMetric(arsenalPitches, "chasePercent"),
    arsenalZonePercent: weightedPitchMetric(arsenalPitches, "zonePercent"),
    arsenalBattingAverageAllowed: weightedPitchMetric(arsenalPitches, "battingAverageAllowed"),
    arsenalXwobaAllowed: weightedPitchMetric(arsenalPitches, "xwobaAllowed"),
    pitchMatchupCoverage: number(pitchMatchup?.pitchMixCoveragePercent),
    pitchMatchupPitchesSeenLog: logCount(pitchMatchup?.hitterPitchesSeen),
    pitchMatchupBattingAverage: number(weighted?.battingAverage), pitchMatchupSlugging: number(weighted?.slugging),
    pitchMatchupXwoba: number(weighted?.xwoba), pitchMatchupWhiffPercent: number(weighted?.whiffPercent),
    matchupPlateAppearancesLog: plateAppearances === null ? null : Math.log1p(plateAppearances),
    matchupBattingAverage: number(matchup?.battingAverage), matchupOnBasePercentage: number(matchup?.onBasePercentage),
    matchupSluggingPercentage: number(matchup?.sluggingPercentage), matchupOps: number(matchup?.ops),
    matchupStrikeoutRate: rate(matchup?.strikeouts, plateAppearances), matchupWalkRate: rate(matchup?.walks, plateAppearances),
    matchupHomeRunRate: rate(matchup?.homeRuns, plateAppearances),
    parkRunFactor: centeredFactor(park?.runFactor), parkHomeRunFactor: centeredFactor(park?.homeRunFactor),
    parkStrikeoutFactor: centeredFactor(park?.strikeoutFactor), temperatureF: number(weather?.temperatureF),
    windSpeedMph: number(weather?.windSpeedMph), precipitationProbability: number(weather?.precipitationProbability),
    roofStatus: string(environment?.roofStatus),
  };
}

function observationKey(row: TrackingRef) { return `${row.slate_date}|${row.external_game_id}|${row.mlb_player_id}|${row.market_key}|${Number(row.line)}`; }
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function string(value: unknown): string | null { return typeof value === "string" ? value : null; }
function number(value: unknown): number | null { const parsed = Number(value); return value !== null && value !== "" && Number.isFinite(parsed) ? parsed : null; }
function delta(value: Record<string, unknown> | null) { const actual = number(value?.value); const league = number(value?.leagueAverage); return actual === null || league === null ? null : actual - league; }
function logCount(value: unknown) { const parsed = number(value); return parsed === null ? null : Math.log1p(parsed); }
function centeredFactor(value: unknown) { const parsed = number(value); return parsed === null ? null : (parsed - 100) / 100; }
function rate(value: unknown, denominator: number | null) { const parsed = number(value); return parsed === null || !denominator ? null : parsed / denominator; }
function weightedPitchMetric(pitches: Record<string, unknown>[], key: string) {
  const rows = pitches.map((pitch) => ({ weight: number(pitch.usagePercent), value: number(pitch[key]) }))
    .filter((row): row is { weight: number; value: number } => row.weight !== null && row.value !== null && row.weight > 0);
  const weight = rows.reduce((sum, row) => sum + row.weight, 0);
  return weight ? rows.reduce((sum, row) => sum + row.weight * row.value, 0) / weight : null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
