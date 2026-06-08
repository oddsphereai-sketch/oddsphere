/**
 * Phase 7B v0c — Per-market review rows for the admin preview.
 *
 * Pure function. Takes the snapshot + model prediction + per-game
 * provenance and produces 3 review rows (ML, spread, total) with all
 * the columns the operator needs to judge pick quality:
 *
 *   - line / odds / book / fetched_at (from provenance)
 *   - model probability on the pick side
 *   - market no-vig probability on the same side
 *   - edge (model_prob - market_no_vig)
 *   - conflict band (support / neutral / mild / strong / unavailable)
 *   - grade (best_angle / lean / watch / caution / no_market / held)
 *   - effective confidence (capped per grade rules)
 *   - rationale strings
 *   - per-source provenance booleans
 */

import type {
  NbaAutoModelOutput,
  NbaGameSnapshot,
  NbaMarketSnapshot,
} from "../../automodel/nba/types";
import type { NbaSnapshotProvenance } from "./featureSnapshot";
import {
  americanToDecimal,
  americanToImpliedProb,
  classifyMlConflict,
  classifySpreadConflict,
  classifyTotalConflict,
  gradeNbaMarket,
  noVigPair,
  type GradeOutput,
  type MarketConflictBand,
} from "./nbaMarketReview";

export type MarketReviewRow = {
  market: "moneyline" | "spread" | "total";
  pick_side: "home" | "away" | "over" | "under" | null;
  pick_label: string;            // e.g. "NY ML", "NY -2.5", "OVER 224.5"
  model_confidence: number;      // 0-100 from the model
  // ── Market columns ──
  market_book: string | null;
  market_line: number | null;    // spread line or total points; null for ML
  market_odds_american: number | null;
  market_odds_decimal: number | null;
  market_implied_prob: number | null;        // raw implied (with vig)
  market_no_vig_prob: number | null;          // de-vigged
  market_other_side_odds_american: number | null;
  // ── Model vs market ──
  model_prob_on_pick_side: number | null;
  edge_prob_pp: number | null;   // (model_prob - market_no_vig) × 100 (pp)
  edge_points: number | null;    // for spread/total: model line − market line, signed for pick
  conflict_band: MarketConflictBand;
  // ── Grading ──
  grade: GradeOutput["grade"];
  effective_confidence: number;
  best_angle_eligible: boolean;
  rationale: string[];
};

export type GameReview = {
  game_external_id: number;
  matchup: string;
  home_abbr: string;
  away_abbr: string;
  tip_iso_utc: string | null;
  tip_iso_et: string | null;    // formatted for display
  series_line: string;          // "Game 3 · NY leads 2-0"
  data_quality_tier: NbaAutoModelOutput["audit"]["data_quality_tier"];
  projected_home_score: number | null;
  projected_away_score: number | null;
  projected_total: number | null;
  projected_home_spread: number | null;
  injuries_summary: string;     // "NY: 0 out, 0 unknown · SA: 0 out, 0 unknown · ESPN ✓"
  provenance: NbaSnapshotProvenance;
  market_review_rows: MarketReviewRow[];
};

function toEtIso(utcIso: string | null): string | null {
  if (utcIso === null) return null;
  try {
    const d = new Date(utcIso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return null;
  }
}

function seriesLine(snapshot: NbaGameSnapshot): string {
  const s = snapshot.series;
  if (s === null) return "Regular game";
  const homeAbbr = snapshot.home_team.abbreviation;
  const awayAbbr = snapshot.away_team.abbreviation;
  const leader =
    s.series_score_home > s.series_score_away
      ? `${homeAbbr} leads ${s.series_score_home}-${s.series_score_away}`
      : s.series_score_away > s.series_score_home
        ? `${awayAbbr} leads ${s.series_score_away}-${s.series_score_home}`
        : `tied ${s.series_score_home}-${s.series_score_away}`;
  const venue = s.venue_shift ? ` · venue shift` : "";
  const elim = s.is_elimination_for_home
    ? ` · ${homeAbbr} elim`
    : s.is_elimination_for_away
      ? ` · ${awayAbbr} elim`
      : "";
  return `Game ${s.game_number} · ${leader}${venue}${elim}`;
}

function injuriesSummary(
  snapshot: NbaGameSnapshot,
  provenance: NbaSnapshotProvenance,
): string {
  const homeOut = snapshot.home_injuries.filter((i) => i.status === "out").length;
  const homeUnknown = snapshot.home_injuries.filter((i) => i.status === "unknown").length;
  const awayOut = snapshot.away_injuries.filter((i) => i.status === "out").length;
  const awayUnknown = snapshot.away_injuries.filter((i) => i.status === "unknown").length;
  const homeAbbr = snapshot.home_team.abbreviation;
  const awayAbbr = snapshot.away_team.abbreviation;
  if (provenance.injuries_source === "none") {
    return `${homeAbbr}: ? · ${awayAbbr}: ? · injuries source not enabled (NBA_INJURY_INGEST_ENABLED)`;
  }
  return (
    `${homeAbbr}: ${homeOut} out, ${homeUnknown} unknown · ` +
    `${awayAbbr}: ${awayOut} out, ${awayUnknown} unknown · ` +
    `ESPN ${provenance.injuries_known_home && provenance.injuries_known_away ? "✓" : "partial"}`
  );
}

// ─── Per-market row builders ──────────────────────────────────────

function buildMlRow(
  snapshot: NbaGameSnapshot,
  prediction: NbaAutoModelOutput,
): MarketReviewRow {
  const m: NbaMarketSnapshot = snapshot.market;
  const pickSide = prediction.predicted_ml_winner;
  const pickLabel =
    pickSide === "home"
      ? `${snapshot.home_team.abbreviation} ML`
      : pickSide === "away"
        ? `${snapshot.away_team.abbreviation} ML`
        : "Held";
  const modelConf = prediction.ml_confidence;
  // Model probability on the pick side. v0a stored prob_home only; derive.
  const modelHomeProb =
    prediction.predicted_ml_winner === "home"
      ? modelConf / 100
      : prediction.predicted_ml_winner === "away"
        ? 1 - modelConf / 100
        : 0.5;
  const modelProbOnPick =
    pickSide === "home"
      ? modelHomeProb
      : pickSide === "away"
        ? 1 - modelHomeProb
        : null;
  const noVig = noVigPair({
    sideAAmerican: m.ml.home_odds_american,
    sideBAmerican: m.ml.away_odds_american,
  });
  const pickOdds =
    pickSide === "home"
      ? m.ml.home_odds_american
      : pickSide === "away"
        ? m.ml.away_odds_american
        : null;
  const otherOdds =
    pickSide === "home"
      ? m.ml.away_odds_american
      : pickSide === "away"
        ? m.ml.home_odds_american
        : null;
  const noVigOnPick =
    noVig === null
      ? null
      : pickSide === "home"
        ? noVig.sideA
        : pickSide === "away"
          ? noVig.sideB
          : null;
  let band: MarketConflictBand;
  let edgePp: number | null;
  if (modelProbOnPick === null || noVigOnPick === null) {
    band = "market_unavailable";
    edgePp = null;
  } else {
    const c = classifyMlConflict({ modelProb: modelProbOnPick, marketNoVigProb: noVigOnPick });
    band = c.band;
    edgePp = c.edge * 100;
  }
  const grade = gradeNbaMarket({
    pick: pickSide,
    confidence: modelConf,
    band,
    edge: edgePp === null ? 0 : edgePp / 100,
    dataQualityTier: prediction.audit.data_quality_tier,
    injuriesKnown:
      snapshot.data_quality.home_injuries_known && snapshot.data_quality.away_injuries_known,
  });
  return {
    market: "moneyline",
    pick_side: pickSide,
    pick_label: pickLabel,
    model_confidence: modelConf,
    market_book: m.ml.home_odds_american !== null || m.ml.away_odds_american !== null ? "see lines table" : null,
    market_line: null,
    market_odds_american: pickOdds,
    market_odds_decimal: americanToDecimal(pickOdds),
    market_implied_prob: americanToImpliedProb(pickOdds),
    market_no_vig_prob: noVigOnPick,
    market_other_side_odds_american: otherOdds,
    model_prob_on_pick_side: modelProbOnPick,
    edge_prob_pp: edgePp,
    edge_points: null,
    conflict_band: band,
    grade: grade.grade,
    effective_confidence: grade.effectiveConfidence,
    best_angle_eligible: grade.bestAngleEligible,
    rationale: grade.rationale,
  };
}

function buildSpreadRow(
  snapshot: NbaGameSnapshot,
  prediction: NbaAutoModelOutput,
): MarketReviewRow {
  const m = snapshot.market;
  const pickSide = prediction.predicted_spread_side;
  const lineHome = m.spread.home_line;
  const pickLabel =
    pickSide === "home"
      ? `${snapshot.home_team.abbreviation} ${lineHome !== null ? formatSpread(lineHome) : ""}`.trim()
      : pickSide === "away"
        ? `${snapshot.away_team.abbreviation} ${lineHome !== null ? formatSpread(-lineHome) : ""}`.trim()
        : "Held";
  const modelConf = prediction.spread_confidence;
  const modelHomeSpread = prediction.predicted_spread_home; // negative = home favored
  const pickOdds =
    pickSide === "home"
      ? m.spread.home_odds_american
      : pickSide === "away"
        ? m.spread.away_odds_american
        : null;
  const otherOdds =
    pickSide === "home"
      ? m.spread.away_odds_american
      : pickSide === "away"
        ? m.spread.home_odds_american
        : null;
  const noVig = noVigPair({
    sideAAmerican: m.spread.home_odds_american,
    sideBAmerican: m.spread.away_odds_american,
  });
  const noVigOnPick =
    noVig === null
      ? null
      : pickSide === "home"
        ? noVig.sideA
        : pickSide === "away"
          ? noVig.sideB
          : null;
  let band: MarketConflictBand;
  let edgePoints: number | null;
  if (lineHome === null || pickSide === null) {
    band = "market_unavailable";
    edgePoints = null;
  } else {
    const c = classifySpreadConflict({
      modelSpreadHome: modelHomeSpread,
      marketSpreadHome: lineHome,
      pickSide: pickSide as "home" | "away",
    });
    band = c.band;
    edgePoints = c.edge;
  }
  // For spread, "model prob on pick side" is the spread cover prob,
  // approximated from confidence.
  const modelProbOnPick = pickSide !== null ? modelConf / 100 : null;
  const grade = gradeNbaMarket({
    pick: pickSide,
    confidence: modelConf,
    band,
    edge: edgePoints === null ? 0 : edgePoints / 10, // approximate edge as fraction of 10-pt scale
    dataQualityTier: prediction.audit.data_quality_tier,
    injuriesKnown:
      snapshot.data_quality.home_injuries_known && snapshot.data_quality.away_injuries_known,
  });
  return {
    market: "spread",
    pick_side: pickSide,
    pick_label: pickLabel,
    model_confidence: modelConf,
    market_book: lineHome !== null ? "see lines table" : null,
    market_line: pickSide === "home" ? lineHome : pickSide === "away" && lineHome !== null ? -lineHome : null,
    market_odds_american: pickOdds,
    market_odds_decimal: americanToDecimal(pickOdds),
    market_implied_prob: americanToImpliedProb(pickOdds),
    market_no_vig_prob: noVigOnPick,
    market_other_side_odds_american: otherOdds,
    model_prob_on_pick_side: modelProbOnPick,
    edge_prob_pp: noVigOnPick !== null && modelProbOnPick !== null ? (modelProbOnPick - noVigOnPick) * 100 : null,
    edge_points: edgePoints,
    conflict_band: band,
    grade: grade.grade,
    effective_confidence: grade.effectiveConfidence,
    best_angle_eligible: grade.bestAngleEligible,
    rationale: grade.rationale,
  };
}

function buildTotalRow(
  snapshot: NbaGameSnapshot,
  prediction: NbaAutoModelOutput,
): MarketReviewRow {
  const m = snapshot.market;
  const pickSide = prediction.predicted_total_side;
  const line = m.total.line;
  const pickLabel =
    pickSide === "over"
      ? `OVER ${line !== null ? line : ""}`.trim()
      : pickSide === "under"
        ? `UNDER ${line !== null ? line : ""}`.trim()
        : "Held";
  const modelConf = prediction.total_confidence;
  const modelTotal = prediction.predicted_total;
  const pickOdds =
    pickSide === "over"
      ? m.total.over_odds_american
      : pickSide === "under"
        ? m.total.under_odds_american
        : null;
  const otherOdds =
    pickSide === "over"
      ? m.total.under_odds_american
      : pickSide === "under"
        ? m.total.over_odds_american
        : null;
  const noVig = noVigPair({
    sideAAmerican: m.total.over_odds_american,
    sideBAmerican: m.total.under_odds_american,
  });
  const noVigOnPick =
    noVig === null
      ? null
      : pickSide === "over"
        ? noVig.sideA
        : pickSide === "under"
          ? noVig.sideB
          : null;
  let band: MarketConflictBand;
  let edgePoints: number | null;
  if (line === null || pickSide === null) {
    band = "market_unavailable";
    edgePoints = null;
  } else {
    const c = classifyTotalConflict({
      modelTotal,
      marketTotal: line,
      pickSide: pickSide as "over" | "under",
    });
    band = c.band;
    edgePoints = c.edge;
  }
  const modelProbOnPick = pickSide !== null ? modelConf / 100 : null;
  const grade = gradeNbaMarket({
    pick: pickSide,
    confidence: modelConf,
    band,
    edge: edgePoints === null ? 0 : edgePoints / 15, // approximate edge as fraction of 15-pt scale
    dataQualityTier: prediction.audit.data_quality_tier,
    injuriesKnown:
      snapshot.data_quality.home_injuries_known && snapshot.data_quality.away_injuries_known,
  });
  return {
    market: "total",
    pick_side: pickSide,
    pick_label: pickLabel,
    model_confidence: modelConf,
    market_book: line !== null ? "see lines table" : null,
    market_line: line,
    market_odds_american: pickOdds,
    market_odds_decimal: americanToDecimal(pickOdds),
    market_implied_prob: americanToImpliedProb(pickOdds),
    market_no_vig_prob: noVigOnPick,
    market_other_side_odds_american: otherOdds,
    model_prob_on_pick_side: modelProbOnPick,
    edge_prob_pp: noVigOnPick !== null && modelProbOnPick !== null ? (modelProbOnPick - noVigOnPick) * 100 : null,
    edge_points: edgePoints,
    conflict_band: band,
    grade: grade.grade,
    effective_confidence: grade.effectiveConfidence,
    best_angle_eligible: grade.bestAngleEligible,
    rationale: grade.rationale,
  };
}

function formatSpread(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

// ─── Composite per-game review ─────────────────────────────────────

export function buildGameReview(
  snapshot: NbaGameSnapshot,
  prediction: NbaAutoModelOutput,
  provenance: NbaSnapshotProvenance,
): GameReview {
  const matchup = `${snapshot.away_team.abbreviation} @ ${snapshot.home_team.abbreviation}`;
  return {
    game_external_id: snapshot.game_external_id,
    matchup,
    home_abbr: snapshot.home_team.abbreviation,
    away_abbr: snapshot.away_team.abbreviation,
    tip_iso_utc: snapshot.game_time_iso,
    tip_iso_et: toEtIso(snapshot.game_time_iso),
    series_line: seriesLine(snapshot),
    data_quality_tier: prediction.audit.data_quality_tier,
    projected_home_score: prediction.predicted_home_score,
    projected_away_score: prediction.predicted_away_score,
    projected_total: prediction.predicted_total,
    projected_home_spread: prediction.predicted_spread_home,
    injuries_summary: injuriesSummary(snapshot, provenance),
    provenance,
    market_review_rows: [
      buildMlRow(snapshot, prediction),
      buildSpreadRow(snapshot, prediction),
      buildTotalRow(snapshot, prediction),
    ],
  };
}
