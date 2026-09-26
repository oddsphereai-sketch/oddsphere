/**
 * Read-only, release-pure MLB score-projection audit.
 *
 * Compares the exact active projection core's immutable locked score with the
 * independent score, stored target-excluded market-aware shadow, and market
 * total. Games are deduplicated before scoring and historical model releases
 * are excluded rather than blended into the current projection claim.
 */
import { supabase } from "../../lib/db/supabase";
import { MLB_MODEL_LAYER_VERSION_IDS } from "../../lib/automodel/mlbModelLayerVersions";

// The audit traverses versioned historical JSON whose schema intentionally varies by release.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Scores = { home: number; away: number };
type Candidate = {
  id: string;
  scores: (row: Row) => Scores | null;
};

const FROM = process.argv[2] ?? "2026-09-02";
const TO = process.argv[3] ?? new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const AUDIT_PROJECTION_CORE = process.argv[4] ?? MLB_MODEL_LAYER_VERSION_IDS.projection_core;

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function scores(home: unknown, away: unknown): Scores | null {
  const parsedHome = finite(home);
  const parsedAway = finite(away);
  return parsedHome === null || parsedAway === null
    ? null
    : { home: parsedHome, away: parsedAway };
}

function actual(row: Row): Scores | null {
  const grade = one(row.prediction_grades);
  return scores(grade?.actual_home_score, grade?.actual_away_score);
}

function published(row: Row): Scores | null {
  const value = row.snapshot_json?.predicted_scores_at_lock ?? {};
  return scores(value.home, value.away);
}

function independent(row: Row): Scores | null {
  const value = row.snapshot_json?.v2_2_audit ?? {};
  return scores(value.independent_home_runs, value.independent_away_runs);
}

function marketAware(row: Row): Scores | null {
  const value = row.snapshot_json?.mlb_core_model_calibration ?? {};
  return scores(
    value.market_aware_projected_home_score_if_enabled,
    value.market_aware_projected_away_score_if_enabled,
  );
}

function marketAwareTotalPublishedMargin(row: Row): Scores | null {
  const baseline = published(row);
  const calibrated = marketAware(row);
  if (!baseline || !calibrated) return null;
  const total = calibrated.home + calibrated.away;
  const margin = baseline.home - baseline.away;
  return {
    home: (total + margin) / 2,
    away: (total - margin) / 2,
  };
}

function coherentMarketAwareTotalPublishedMargin(row: Row): Scores | null {
  const baseline = published(row);
  const candidate = marketAwareTotalPublishedMargin(row);
  const line = marketTotal(row);
  if (!baseline || !candidate || line === null) return baseline;
  const selectedSide = String(row.side ?? row.pick ?? "").toLowerCase();
  const candidateTotal = candidate.home + candidate.away;
  const candidateSide = candidateTotal > line
    ? "over"
    : candidateTotal < line
      ? "under"
      : "on_line";
  return selectedSide === candidateSide ? candidate : baseline;
}

function marketTotal(row: Row): number | null {
  return finite(row.snapshot_json?.mlb_core_model_calibration?.market_total)
    ?? finite(row.snapshot_json?.v2_2_audit?.market_total)
    ?? finite(row.line_value);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function metrics(rows: Row[], candidate: Candidate) {
  let n = 0;
  let teamAbs = 0;
  let totalAbs = 0;
  let marginAbs = 0;
  let totalBias = 0;
  let winnerDecisions = 0;
  let winnerCorrect = 0;
  let totalSideDecisions = 0;
  let totalSideCorrect = 0;
  for (const row of rows) {
    const target = actual(row);
    const forecast = candidate.scores(row);
    if (!target || !forecast) continue;
    n++;
    const targetTotal = target.home + target.away;
    const forecastTotal = forecast.home + forecast.away;
    const targetMargin = target.home - target.away;
    const forecastMargin = forecast.home - forecast.away;
    teamAbs += Math.abs(target.home - forecast.home) + Math.abs(target.away - forecast.away);
    totalAbs += Math.abs(targetTotal - forecastTotal);
    marginAbs += Math.abs(targetMargin - forecastMargin);
    totalBias += forecastTotal - targetTotal;
    if (targetMargin !== 0 && forecastMargin !== 0) {
      winnerDecisions++;
      if (Math.sign(targetMargin) === Math.sign(forecastMargin)) winnerCorrect++;
    }
    const line = marketTotal(row);
    if (line !== null && targetTotal !== line && forecastTotal !== line) {
      totalSideDecisions++;
      if (Math.sign(targetTotal - line) === Math.sign(forecastTotal - line)) totalSideCorrect++;
    }
  }
  return {
    games: n,
    teamScoreMae: n ? round(teamAbs / (2 * n)) : null,
    totalMae: n ? round(totalAbs / n) : null,
    marginMae: n ? round(marginAbs / n) : null,
    totalBias: n ? round(totalBias / n) : null,
    winnerAccuracy: winnerDecisions ? round(winnerCorrect / winnerDecisions) : null,
    winnerDecisions,
    totalSideAccuracy: totalSideDecisions ? round(totalSideCorrect / totalSideDecisions) : null,
    totalSideDecisions,
  };
}

function marketTotalMetrics(rows: Row[]) {
  let n = 0;
  let absoluteError = 0;
  let bias = 0;
  for (const row of rows) {
    const target = actual(row);
    const line = marketTotal(row);
    if (!target || line === null) continue;
    const error = line - target.home - target.away;
    n++;
    absoluteError += Math.abs(error);
    bias += error;
  }
  return {
    games: n,
    totalMae: n ? round(absoluteError / n) : null,
    totalBias: n ? round(bias / n) : null,
  };
}

function datePartition(date: string): string {
  if (date <= "2026-09-10") return "2026-09-02_to_2026-09-10";
  if (date <= "2026-09-18") return "2026-09-11_to_2026-09-18";
  return "2026-09-19_forward";
}

async function loadRows(): Promise<Row[]> {
  const output: Row[] = [];
  const pageSize = 250;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select([
        "id", "game_id", "slate_date", "market", "pick", "side", "line_value", "locked_at",
        "launch_day", "snapshot_json",
        "prediction_grades(actual_home_score,actual_away_score)",
      ].join(","))
      .eq("sport", "mlb")
      .gte("slate_date", FROM)
      .lte("slate_date", TO)
      .not("locked_at", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    output.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < pageSize) break;
  }
  return output;
}

async function main() {
  const source = (await loadRows()).filter((row) =>
    row.launch_day !== true
    && actual(row) !== null
    && row.snapshot_json?.model_layer_versions?.projection_core ===
      AUDIT_PROJECTION_CORE
  );
  const byGame = new Map<number, Row>();
  for (const row of source) {
    if (!Number.isInteger(row.game_id)) continue;
    const existing = byGame.get(row.game_id);
    if (!existing || row.market === "total") byGame.set(row.game_id, row);
  }
  const rows = [...byGame.values()];
  const candidates: Candidate[] = [
    { id: "independent", scores: independent },
    { id: "published", scores: published },
    { id: "stored_target_excluded_market_aware_shadow", scores: marketAware },
    {
      id: "market_aware_total_with_published_margin",
      scores: marketAwareTotalPublishedMargin,
    },
    {
      id: "market_aware_total_with_published_margin_when_forecast_coherent",
      scores: coherentMarketAwareTotalPublishedMargin,
    },
  ];
  const partitions = [...new Set(rows.map((row) => datePartition(String(row.slate_date))))];
  console.log(JSON.stringify({
    mode: "read_only_release_pure_mlb_score_projection_audit",
    noWrites: true,
    from: FROM,
    to: TO,
    projectionCore: AUDIT_PROJECTION_CORE,
    uniqueSettledGames: rows.length,
    pooled: {
      ...Object.fromEntries(candidates.map((candidate) => [candidate.id, metrics(rows, candidate)])),
      market_total: marketTotalMetrics(rows),
    },
    byChronologicalPartition: Object.fromEntries(partitions.map((partition) => {
      const partitionRows = rows.filter((row) => datePartition(String(row.slate_date)) === partition);
      return [partition, {
        ...Object.fromEntries(candidates.map((candidate) => [candidate.id, metrics(partitionRows, candidate)])),
        market_total: marketTotalMetrics(partitionRows),
      }];
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
