/**
 * READ ONLY. Evaluates prospectively stamped shadow pitcher predictions from
 * immutable T-60 tracking rows. Results are separated by exact shadow release.
 */
import { supabase } from "../../lib/db/supabase";
import type { MlbPropsShadowPitcherPrediction } from "../../lib/mlb/props/shadowPitcherModel";

type TrackingRow = {
  id: number;
  slate_date: string;
  external_game_id: string;
  mlb_player_id: number;
  market_key: string;
  side: "over" | "under";
  sportsbook: string;
  locked_american_odds: number | null;
  result_status: string;
  metadata_json: Record<string, unknown> | null;
};

type Observation = {
  release: string;
  featureVersion: string;
  date: string;
  gameId: string;
  playerId: number;
  market: string;
  shadowSide: "over" | "under";
  shadowProbability: number;
  shadowWon: boolean;
  priceComparable: boolean;
  odds: number | null;
};

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function loadRows(startDate: string): Promise<TrackingRow[]> {
  const output: TrackingRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("mlb_prop_tracking_entries")
      .select("id,slate_date,external_game_id,mlb_player_id,market_key,side,sportsbook,locked_american_odds,result_status,metadata_json")
      .gte("slate_date", startDate)
      .in("result_status", ["win", "loss"])
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    output.push(...((data ?? []) as TrackingRow[]));
    if ((data ?? []).length < 1000) return output;
  }
}

function shadowPrediction(row: TrackingRow): MlbPropsShadowPitcherPrediction | null {
  const value = row.metadata_json?.shadowPitcherPrediction;
  if (!value || typeof value !== "object") return null;
  const prediction = value as Partial<MlbPropsShadowPitcherPrediction>;
  if (
    typeof prediction.releaseId !== "string"
    || typeof prediction.featureVersion !== "string"
    || (prediction.selectedSide !== "over" && prediction.selectedSide !== "under")
    || typeof prediction.selectedProbability !== "number"
    || !Number.isFinite(prediction.selectedProbability)
  ) return null;
  return prediction as MlbPropsShadowPitcherPrediction;
}

function summarize(rows: Observation[]) {
  const confidenceRows = rows.filter((row) => row.shadowProbability >= 0.55);
  const priced = confidenceRows.filter((row) => row.priceComparable && row.odds !== null);
  const units = priced.reduce((sum, row) => sum + profit(row.shadowWon, row.odds!), 0);
  return {
    settledObservations: rows.length,
    dates: new Set(rows.map((row) => row.date)).size,
    games: new Set(rows.map((row) => row.gameId)).size,
    players: new Set(rows.map((row) => row.playerId)).size,
    brier: average(rows.map((row) => (row.shadowProbability - Number(row.shadowWon)) ** 2)),
    logLoss: average(rows.map((row) => {
      const probability = Math.min(0.999999, Math.max(0.000001, row.shadowProbability));
      return row.shadowWon ? -Math.log(probability) : -Math.log(1 - probability);
    })),
    accuracyAt55: confidenceRows.length
      ? round(confidenceRows.filter((row) => row.shadowWon).length / confidenceRows.length)
      : null,
    observationsAt55: confidenceRows.length,
    priceComparableAt55: priced.length,
    flatUnitsAtLockedPrice: round(units),
    roiAtLockedPrice: priced.length ? round(units / priced.length) : null,
    roiCoverageNote: "ROI includes only rows where the shadow side equals the tracked side; the ledger does not preserve a counter-side locked price.",
  };
}

function grouped(rows: Observation[], key: (row: Observation) => string) {
  return Object.fromEntries(
    [...new Set(rows.map(key))].sort().map((name) => [
      name,
      summarize(rows.filter((row) => key(row) === name)),
    ]),
  );
}

async function main() {
  const startDate = argument("from") ?? "2026-08-12";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("--from must use YYYY-MM-DD");
  const source = await loadRows(startDate);
  const observations: Observation[] = [];
  for (const row of source) {
    const prediction = shadowPrediction(row);
    if (!prediction || prediction.status === "insufficient_features") continue;
    const trackedWon = row.result_status === "win";
    const shadowWon = prediction.selectedSide === row.side ? trackedWon : !trackedWon;
    observations.push({
      release: prediction.releaseId,
      featureVersion: prediction.featureVersion,
      date: row.slate_date,
      gameId: row.external_game_id,
      playerId: row.mlb_player_id,
      market: row.market_key,
      shadowSide: prediction.selectedSide!,
      shadowProbability: prediction.selectedProbability!,
      shadowWon,
      priceComparable: prediction.selectedSide === row.side,
      odds: row.locked_american_odds,
    });
  }

  console.log(JSON.stringify({
    method: "prospective T-60 evidence only; exact shadow release; no reconstructed features",
    startDate,
    trackingRowsRead: source.length,
    stampedSettledRows: observations.length,
    evidenceReady: observations.length > 0,
    byRelease: grouped(observations, (row) => row.release),
    byReleaseFeatureMarketSide: grouped(
      observations,
      (row) => `${row.release}|${row.featureVersion}|${row.market}|${row.shadowSide}`,
    ),
  }, null, 2));
}

function profit(won: boolean, americanOdds: number): number {
  if (!won) return -1;
  return americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
}

function average(values: number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
