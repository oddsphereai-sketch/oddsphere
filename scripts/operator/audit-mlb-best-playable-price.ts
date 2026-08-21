/**
 * Read-only audit of MLB Moneyline recommendation-price coherence.
 *
 * Reconstructs the freshest same-book, two-sided market available in the
 * 60 minutes before each lock, then applies the shared multi-book coherence
 * selector. It never writes, relabels, or changes a prediction.
 */
import { createClient } from "@supabase/supabase-js";

import { selectBestCoherentPlayablePrice } from "../../lib/services/dailyEdge/bestPlayablePrice";

type Json = {
  model_layer_versions?: { active_probability_head?: string | null };
  decision_pipeline?: { release_id?: string | null };
  [key: string]: unknown;
};
type Row = {
  id: number;
  game_id: number;
  slate_date: string;
  matchup: string;
  side: "home" | "away";
  odds_american: number | null;
  model_probability: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  locked_at: string;
  snapshot_json: Json | null;
};
type History = {
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  recorded_at: string;
};
type Game = { id: number; home_score: number | null; away_score: number | null };

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function implied(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

function profit(won: boolean, odds: number): number {
  return won ? (odds > 0 ? odds / 100 : 100 / Math.abs(odds)) : -1;
}

function summary(rows: Array<{ won: boolean; units: number; probability: number }>) {
  const wins = rows.filter((row) => row.won).length;
  const units = rows.reduce((sum, row) => sum + row.units, 0);
  const avgProbability = rows.length
    ? rows.reduce((sum, row) => sum + row.probability, 0) / rows.length
    : null;
  const winRate = rows.length ? wins / rows.length : null;
  return {
    settled: rows.length,
    record: `${wins}-${rows.length - wins}`,
    units: Number(units.toFixed(3)),
    roiPct: rows.length ? Number((units / rows.length * 100).toFixed(2)) : null,
    calibrationGapPp:
      avgProbability === null || winRate === null
        ? null
        : Number(((avgProbability - winRate) * 100).toFixed(2)),
  };
}

async function main() {
  const { data, error } = await sb
    .from("prediction_records")
    .select("id,game_id,slate_date,matchup,side,odds_american,model_probability,play_grade,best_angle,no_bet,locked_at,snapshot_json")
    .eq("sport", "mlb")
    .eq("market", "moneyline")
    .not("locked_at", "is", null)
    .gte("slate_date", "2026-08-15")
    .lte("slate_date", "2026-08-20")
    .order("locked_at", { ascending: true });
  if (error) throw error;
  const rows = ((data ?? []) as Row[]).filter((row) =>
    row.snapshot_json?.model_layer_versions?.active_probability_head ===
      "mlb_moneyline_away_market_40_45_raw_side_champion_v1_2026_08_15" &&
    (row.side === "home" || row.side === "away")
  );
  const gameIds = [...new Set(rows.map((row) => row.game_id))];
  const { data: gameData, error: gameError } = await sb
    .from("games")
    .select("id,home_score,away_score")
    .in("id", gameIds);
  if (gameError) throw gameError;
  const games = new Map(((gameData ?? []) as Game[]).map((game) => [game.id, game]));

  const analyzed: Array<{
    row: Row;
    candidateOdds: number;
    breakEvenImprovementPp: number;
    won: boolean;
    units: number;
  }> = [];
  for (let offset = 0; offset < rows.length; offset += 8) {
    const batch = rows.slice(offset, offset + 8);
    const batchResults = await Promise.all(batch.map(async (row) => {
      const lockMs = Date.parse(row.locked_at);
      const from = new Date(lockMs - 60 * 60_000).toISOString();
      const { data: history, error: historyError } = await sb
        .from("line_history")
        .select("sportsbook,side,line_value,odds_american,recorded_at")
        .eq("game_id", row.game_id)
        .eq("market_type", "moneyline")
        .is("player_id", null)
        .gte("recorded_at", from)
        .lte("recorded_at", row.locked_at)
        .order("recorded_at", { ascending: false })
        .limit(300);
      if (historyError) throw historyError;
      const candidate = selectBestCoherentPlayablePrice({
        rows: ((history ?? []) as History[]).map((line) => ({
          ...line,
          fetched_at: line.recorded_at,
        })),
        preferredSide: row.side,
        expectedLine: null,
        nowMs: lockMs,
        maxAgeMinutes: 60,
      });
      const game = games.get(row.game_id);
      if (
        candidate?.odds_american === null || candidate?.odds_american === undefined ||
        row.odds_american === null || row.model_probability === null ||
        !game || game.home_score === null || game.away_score === null ||
        game.home_score === game.away_score
      ) return null;
      const baselineBreakEven = implied(row.odds_american);
      const candidateBreakEven = implied(candidate.odds_american);
      if (baselineBreakEven === null || candidateBreakEven === null) return null;
      const won = row.side === "home"
        ? game.home_score > game.away_score
        : game.away_score > game.home_score;
      return {
        row,
        candidateOdds: candidate.odds_american,
        breakEvenImprovementPp: (baselineBreakEven - candidateBreakEven) * 100,
        won,
        units: profit(won, candidate.odds_american),
      };
    }));
    analyzed.push(...batchResults.filter((row): row is NonNullable<typeof row> => row !== null));
  }

  const uniqueKeys = new Set(rows.map((row) => `${row.game_id}|${row.locked_at}`));
  const material = analyzed.filter((row) => row.breakEvenImprovementPp >= 1);
  const nonactionableMaterial = material.filter((row) =>
    row.row.no_bet === true || (row.row.play_grade !== "lean" && row.row.best_angle !== true)
  );
  const byRelease = Object.fromEntries(
    [...new Set(analyzed.map((row) => row.row.snapshot_json?.decision_pipeline?.release_id ?? "unknown"))]
      .map((release) => [release, {
        observations: analyzed.filter((row) => (row.row.snapshot_json?.decision_pipeline?.release_id ?? "unknown") === release).length,
        materialPriceChanges: material.filter((row) => (row.row.snapshot_json?.decision_pipeline?.release_id ?? "unknown") === release).length,
      }]),
  );
  console.log(JSON.stringify({
    audit: "mlb_best_playable_price_lock_reconstruction_v1_2026_08_21",
    range: { start: "2026-08-15", end: "2026-08-20" },
    probabilityHead: "mlb_moneyline_away_market_40_45_raw_side_champion_v1_2026_08_15",
    sourceRows: rows.length,
    uniqueGameLockObservations: uniqueKeys.size,
    duplicateGameLockObservations: rows.length - uniqueKeys.size,
    reconstructedCoherentPrices: analyzed.length,
    materialPriceChanges: material.length,
    materialPriceChangeSettled: summary(material.map((row) => ({ won: row.won, units: row.units, probability: row.row.model_probability! }))),
    nonactionableMaterialCohort: summary(nonactionableMaterial.map((row) => ({ won: row.won, units: row.units, probability: row.row.model_probability! }))),
    byRelease,
    policyDecision: {
      predictionProbabilityChanged: false,
      priceTupleCorrected: true,
      priceOnlyPromotionAuthorized: false,
      rationale: "The reconstruction validates quote coherence and price availability, not a new action sleeve.",
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
