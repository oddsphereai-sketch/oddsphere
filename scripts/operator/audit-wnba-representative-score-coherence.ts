/**
 * Read-only audit of the WNBA representative-score coherence release.
 *
 * Compares the previously displayed expectation margin with the median of the
 * exact stored margin distribution. No forecast is recomputed and no row is
 * written.
 */
import { supabase } from "../../lib/db/supabase";
import {
  standardNormalCdf,
  wnbaMarginDistributionMedian,
  type WnbaMarginDistribution,
} from "../../lib/services/wnba/wnbaTargetExcludedMarketDecision";

type Row = Record<string, unknown>;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nested(value: unknown, ...keys: string[]): unknown {
  let cursor: unknown = value;
  for (const key of keys) {
    const current = object(cursor);
    if (current === null) return null;
    cursor = current[key];
  }
  return cursor;
}

function n(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null, places = 4): number | null {
  if (value === null) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function standardNormalQuantile(probability: number): number {
  let lower = -8;
  let upper = 8;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (standardNormalCdf(midpoint) < probability) lower = midpoint;
    else upper = midpoint;
  }
  return (lower + upper) / 2;
}

function distributionFrom(row: Row): WnbaMarginDistribution | null {
  const candidate = object(nested(row.snapshot_json, "target_excluded_market_decision", "spread", "margin_distribution"));
  if (candidate === null) return null;
  if (
    candidate.kind !== "coherent_normal" &&
    candidate.kind !== "maximum_entropy_sign_tilt" &&
    candidate.kind !== "independent_normal_fallback"
  ) return null;
  return candidate as WnbaMarginDistribution;
}

function gradeFrom(row: Row): Row | null {
  const grades = row.prediction_grades;
  if (Array.isArray(grades)) return object(grades[0]);
  return object(grades);
}

async function main() {
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id,game_id,slate_date,market,side,line_value,model_version,snapshot_json,prediction_grades(actual_home_score,actual_away_score)")
    .eq("sport", "wnba")
    .in("market", ["moneyline", "spread"])
    .gte("slate_date", "2026-09-03")
    .order("slate_date", { ascending: true });
  if (error) throw new Error(error.message);

  const settledRows = ((data ?? []) as Row[]).flatMap((row) => {
    const distribution = distributionFrom(row);
    const grade = gradeFrom(row);
    const actualHome = n(grade?.actual_home_score);
    const actualAway = n(grade?.actual_away_score);
    const total = n(nested(row.snapshot_json, "model", "total"));
    if (!distribution || actualHome === null || actualAway === null || total === null) return [];
    const expectedMargin = distribution.mean;
    const representativeMargin = wnbaMarginDistributionMedian(distribution);
    const rawModelMargin = n(nested(row.snapshot_json, "model", "components", "raw_model_margin")) ?? expectedMargin;
    const actualMargin = actualHome - actualAway;
    const expectedHome = (total + expectedMargin) / 2;
    const expectedAway = (total - expectedMargin) / 2;
    const representativeHome = (total + representativeMargin) / 2;
    const representativeAway = (total - representativeMargin) / 2;
    const mlHome = distribution.positiveProbability >= 0.5;
    return [{
      market: row.market as "moneyline" | "spread",
      publishedSide: row.side as "home" | "away",
      selectedLine: n(row.line_value),
      expectedMargin,
      representativeMargin,
      probabilityImpliedMargin: distribution.standardDeviation * standardNormalQuantile(distribution.positiveProbability),
      rawModelMargin,
      standardDeviation: distribution.standardDeviation,
      actualMargin,
      expectedTeamAbs: (Math.abs(expectedHome - actualHome) + Math.abs(expectedAway - actualAway)) / 2,
      representativeTeamAbs: (Math.abs(representativeHome - actualHome) + Math.abs(representativeAway - actualAway)) / 2,
      expectedMlCoherent: (expectedMargin >= 0) === mlHome,
      representativeMlCoherent: (representativeMargin >= 0) === mlHome,
      expectedWinnerCorrect: (expectedMargin >= 0) === (actualMargin > 0),
      representativeWinnerCorrect: (representativeMargin >= 0) === (actualMargin > 0),
    }];
  });
  const samples = settledRows.filter((row) => row.market === "moneyline");
  const spreads = settledRows.flatMap((row) => {
    if (row.market !== "spread" || row.selectedLine === null) return [];
    const homeLine = row.publishedSide === "home" ? row.selectedLine : -row.selectedLine;
    const actualCover = row.actualMargin + homeLine;
    if (actualCover === 0) return [];
    const actualHomeCover = actualCover > 0;
    const publishedHome = row.publishedSide === "home";
    const expectationHome = row.expectedMargin + homeLine > 0;
    const representativeHome = row.representativeMargin + homeLine > 0;
    return [{
      publishedCorrect: publishedHome === actualHomeCover,
      expectationCorrect: expectationHome === actualHomeCover,
      representativeCorrect: representativeHome === actualHomeCover,
      publishedExpectationCoherent: publishedHome === expectationHome,
      publishedRepresentativeCoherent: publishedHome === representativeHome,
    }];
  });
  const blended = [0, 0.25, 0.5, 0.75, 1].map((expectationWeight) => {
    const mlRows = samples.map((row) => {
      const margin = expectationWeight * row.expectedMargin + (1 - expectationWeight) * row.probabilityImpliedMargin;
      return {
        error: Math.abs(margin - row.actualMargin),
        teamErrorDelta: Math.abs(margin - row.actualMargin) / 2,
        correct: (margin >= 0) === (row.actualMargin > 0),
      };
    });
    const spreadRows = settledRows.flatMap((row) => {
      if (row.market !== "spread" || row.selectedLine === null) return [];
      const homeLine = row.publishedSide === "home" ? row.selectedLine : -row.selectedLine;
      const actualCover = row.actualMargin + homeLine;
      if (actualCover === 0) return [];
      const margin = expectationWeight * row.expectedMargin + (1 - expectationWeight) * row.probabilityImpliedMargin;
      return [{ correct: (margin + homeLine > 0) === (actualCover > 0) }];
    });
    return {
      expectation_weight: expectationWeight,
      margin_mae: round(mean(mlRows.map((row) => row.error))),
      winner_accuracy: `${mlRows.filter((row) => row.correct).length}/${mlRows.length}`,
      spread_accuracy: `${spreadRows.filter((row) => row.correct).length}/${spreadRows.length}`,
    };
  });
  const conflictFallback = samples.map((row) => {
    const expectationSign = Math.sign(row.expectedMargin);
    const probabilitySign = Math.sign(row.probabilityImpliedMargin);
    const margin = expectationSign !== 0 && probabilitySign !== 0 && expectationSign !== probabilitySign
      ? row.rawModelMargin
      : row.expectedMargin;
    return {
      margin,
      actualMargin: row.actualMargin,
      correct: (margin >= 0) === (row.actualMargin > 0),
    };
  });
  const conflictFallbackSpread = settledRows.flatMap((row) => {
    if (row.market !== "spread" || row.selectedLine === null) return [];
    const homeLine = row.publishedSide === "home" ? row.selectedLine : -row.selectedLine;
    const actualCover = row.actualMargin + homeLine;
    if (actualCover === 0) return [];
    const expectationSign = Math.sign(row.expectedMargin);
    const probabilitySign = Math.sign(row.probabilityImpliedMargin);
    const margin = expectationSign !== 0 && probabilitySign !== 0 && expectationSign !== probabilitySign
      ? row.rawModelMargin
      : row.expectedMargin;
    return [{ correct: (margin + homeLine > 0) === (actualCover > 0) }];
  });

  const report = {
    generated_at: new Date().toISOString(),
    read_only: true,
    settled_distribution_games: samples.length,
    expectation_margin_mae: round(mean(samples.map((row) => Math.abs(row.expectedMargin - row.actualMargin)))),
    representative_margin_mae: round(mean(samples.map((row) => Math.abs(row.representativeMargin - row.actualMargin)))),
    expectation_team_score_mae: round(mean(samples.map((row) => row.expectedTeamAbs))),
    representative_team_score_mae: round(mean(samples.map((row) => row.representativeTeamAbs))),
    expectation_ml_coherence: `${samples.filter((row) => row.expectedMlCoherent).length}/${samples.length}`,
    representative_ml_coherence: `${samples.filter((row) => row.representativeMlCoherent).length}/${samples.length}`,
    expectation_winner_accuracy: `${samples.filter((row) => row.expectedWinnerCorrect).length}/${samples.length}`,
    representative_winner_accuracy: `${samples.filter((row) => row.representativeWinnerCorrect).length}/${samples.length}`,
    spread_non_push_games: spreads.length,
    published_spread_accuracy: `${spreads.filter((row) => row.publishedCorrect).length}/${spreads.length}`,
    expectation_implied_spread_accuracy: `${spreads.filter((row) => row.expectationCorrect).length}/${spreads.length}`,
    representative_implied_spread_accuracy: `${spreads.filter((row) => row.representativeCorrect).length}/${spreads.length}`,
    published_expectation_spread_coherence: `${spreads.filter((row) => row.publishedExpectationCoherent).length}/${spreads.length}`,
    published_representative_spread_coherence: `${spreads.filter((row) => row.publishedRepresentativeCoherent).length}/${spreads.length}`,
    coherent_normal_blend_replay: blended,
    final_probability_conflict_independent_fallback: {
      margin_mae: round(mean(conflictFallback.map((row) => Math.abs(row.margin - row.actualMargin)))),
      winner_accuracy: `${conflictFallback.filter((row) => row.correct).length}/${conflictFallback.length}`,
      spread_accuracy: `${conflictFallbackSpread.filter((row) => row.correct).length}/${conflictFallbackSpread.length}`,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
