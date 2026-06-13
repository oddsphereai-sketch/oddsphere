/**
 * NBA-P0 — Overlay V2 + consensus + grounding onto the Daily Edge game DTO.
 *
 * The legacy pipeline runs V1 (market-free-ish) and builds market intel from a
 * SINGLE book. This overlay replaces the DTO's member-facing projection +
 * ML/total intel with the grounded, consensus-clean values, and returns the
 * full audit substrate (raw V2 → clean baseline → grounded → regularized).
 *
 * It MUTATES the passed game DTO (projection + intelligence.ml/total) so both
 * the member card and the prediction writer consume the grounded values. When
 * the market is too corrupted to form a clean baseline it returns a HOLD with
 * an exact reason (no silent single-book trust, no silent V1 fallback).
 */

import { runNbaAutoModelV2 } from "../../automodel/nba/nbaAutoModelV2";
import {
  buildNbaMarketConsensus,
  type NbaBookLine,
  type NbaMarketConsensus,
} from "../../automodel/nba/nbaMarketConsensus";
import { groundNbaPrediction } from "../../automodel/nba/nbaGrounding";
import type { NbaGameSnapshot, NbaModelStage } from "../../automodel/nba/types";
import type { NbaLineRow } from "./nbaMarketIntelligence";
import type { NbaSplitsRow } from "./nbaSplitsClient";
import type { NbaDailyEdgeGameDto } from "./buildNbaDailyEdgeDto";

export interface NbaGroundingAudit {
  raw_v2_projection: { home_score: number; away_score: number; total: number; margin_home: number };
  raw_v2_ml_probability: number; // home win prob, pre-grounding
  raw_v2_total: number;
  market_consensus_ml: { home_no_vig: number | null; away_no_vig: number | null; source: string | null };
  market_consensus_spread: number | null;
  market_consensus_total: number | null;
  accepted_books: { ml: string[]; spread: string[]; total: string[] };
  rejected_books: { book: string; reason: string }[];
  rejection_reasons: string[];
  consensus_strength: NbaMarketConsensus["consensusStrength"];
  spread_confirmation: boolean;
  injury_context_state: string;
  injury_adjustment: { home_pts: number; away_pts: number };
  grounded_projection: { home_score: number; away_score: number; total: number; margin_home: number; moved_from_market: number; moved_from_raw_total: number };
  regularized_probability: { ml_home: number; ml_pick: "home" | "away"; ml_pick_prob: number; ml_edge_pp: number | null };
  final_confidence: number;
  final_play_grade: string;
  final_pick_rationale: string;
  held: boolean;
  hold_reason: string | null;
}

/** Map grounding grade → the DTO's internal grade enum (watch renders as market_aligned publicly). */
function toIntelGrade(g: string): "best_angle" | "lean" | "watch" | "caution" | "no_market" | "held" {
  switch (g) {
    case "best_angle": return "best_angle";
    case "lean": return "lean";
    case "caution": return "caution";
    case "hold": return "held";
    case "market_aligned": return "watch"; // informational; public play_grade = market_aligned
    default: return "watch";
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function round1(n: number): number { return Math.round(n * 10) / 10; }

/**
 * Odds (american) for a given market+side from ACCEPTED books only.
 * Never include rejected/corrupted books (e.g. the flipped fliff ML), and
 * never mix sign — take the median across accepted books (same-sign by
 * construction once outliers/contradictions are removed).
 */
function pickedOdds(
  lines: ReadonlyArray<NbaLineRow>,
  market: string,
  side: string,
  acceptedBooks: ReadonlyArray<string>,
): number | null {
  const xs = lines
    .filter((l) => l.market_type === market && l.side === side && l.odds_american !== null && acceptedBooks.includes(l.sportsbook))
    .map((l) => l.odds_american!);
  return xs.length ? Math.round(median(xs)) : null;
}

export function applyNbaGroundingOverlay(
  game: NbaDailyEdgeGameDto,
  snapshot: NbaGameSnapshot,
  lines: ReadonlyArray<NbaLineRow>,
  stage: NbaModelStage,
  splitsRow: NbaSplitsRow | null = null,
): NbaGroundingAudit {
  // 1 — raw V2.
  const v2 = runNbaAutoModelV2(snapshot, stage, { isPlayoffs: true });
  const rawMargin = v2.predicted_home_score - v2.predicted_away_score;

  // 2 — clean consensus from ALL books.
  const bookLines: NbaBookLine[] = lines
    .filter((l) => l.side !== null && (l.market_type === "moneyline" || l.market_type === "spread" || l.market_type === "total"))
    .map((l) => ({ sportsbook: l.sportsbook, market_type: l.market_type as NbaBookLine["market_type"], side: l.side as string, line_value: l.line_value, odds_american: l.odds_american }));
  const cons = buildNbaMarketConsensus(bookLines);

  // 3 — injury/context state (no feed today → no point impact, capped).
  const injuriesKnown = snapshot.data_quality.home_injuries_known && snapshot.data_quality.away_injuries_known;
  const injuryHomePts = 0;
  const injuryAwayPts = 0;

  // 4 — ground.
  const ground = groundNbaPrediction({
    rawHomeScore: v2.predicted_home_score,
    rawAwayScore: v2.predicted_away_score,
    consensusSpreadHome: cons.spreadHome,
    consensusTotal: cons.totalLine,
    consensusHomeMlNoVig: cons.mlHomeNoVig,
    mlIsSpreadImpliedFallback: cons.mlSource === "spread_implied_fallback",
    consensusStrength: cons.consensusStrength,
    tier: v2.audit.data_quality_tier,
    injuryHomePts,
    injuryAwayPts,
    injuriesKnown,
    splitsMl: splitsRow?.ml
      ? {
          betsHome: splitsRow.ml.bets_pct?.home ?? null,
          handleHome: splitsRow.ml.handle_pct?.home ?? null,
          betsAway: splitsRow.ml.bets_pct?.away ?? null,
          handleAway: splitsRow.ml.handle_pct?.away ?? null,
        }
      : null,
  });

  const held = !cons.clean;
  const holdReason = cons.holdReason;

  if (held) {
    // Market too corrupted to form a clean baseline → hold the card with
    // an exact reason (no silent single-book trust, no silent V1 fallback).
    game.intelligence.ml.pick_side = null;
    game.intelligence.ml.grade = "held";
    game.intelligence.ml.effective_confidence = 0;
    game.intelligence.total.pick_side = null;
    game.intelligence.total.grade = "held";
    game.intelligence.total.effective_confidence = 0;
  }

  // 5 — overlay the DTO (projection + ml + total) when NOT held.
  if (!held) {
    game.projection = {
      ...game.projection,
      home_score: ground.groundedHomeScore,
      away_score: ground.groundedAwayScore,
      total: ground.groundedTotal,
    };

    // ML intel overlay.
    const ml = game.intelligence.ml;
    ml.pick_side = ground.mlPick;
    ml.pick_label = ground.mlPick === "home" ? game.home_abbr : game.away_abbr;
    ml.model_prob_on_pick = ground.mlPickProb;
    ml.market_no_vig_prob_pick = ground.mlPick === "home" ? cons.mlHomeNoVig : cons.mlAwayNoVig;
    ml.edge_prob_pp = ground.mlEdgePct;
    ml.effective_confidence = ground.confidence;
    ml.grade = toIntelGrade(ground.playGrade);
    const mlOdds = pickedOdds(lines, "moneyline", ground.mlPick, cons.mlAcceptedBooks);
    if (mlOdds !== null) {
      // Attribute the price to the ACCEPTED source, not whatever book the DTO
      // happened to carry — otherwise a price taken from ballybet gets labeled
      // "fliff" (the rejected/corrupted book). Single accepted book → its name;
      // multiple → "consensus".
      const mlSrc =
        cons.mlAcceptedBooks.length === 1 ? cons.mlAcceptedBooks[0]!
        : cons.mlAcceptedBooks.length > 1 ? "consensus"
        : ml.current_price.sportsbook;
      ml.current_price = { ...ml.current_price, odds_american: mlOdds, sportsbook: mlSrc };
    }

    // Total intel overlay.
    const tot = game.intelligence.total;
    tot.pick_side = ground.totalPick;
    tot.pick_label = ground.totalPick === "over" ? `Over ${cons.totalLine ?? ""}`.trim() : `Under ${cons.totalLine ?? ""}`.trim();
    tot.consensus_line = cons.totalLine;
    // Total no-vig ≈ 0.5 at the main line (priced ~-108/-109); edge = model - 0.5.
    tot.market_no_vig_prob_pick = 0.5;
    // Coherence (2026-06-13): NBA totals are uncalibrated, so confidence is
    // capped to the limited-consensus ceiling. The DISPLAYED probability + edge
    // MUST track that capped confidence — never the raw bivariate over-prob —
    // or the card shows "Model Prob 58%" next to "Edge +16.6%" (the raw
    // 66.6% over-prob), which reads as broken. The model's POINT projection
    // (game.projection.total) still carries the full raw lean for the Model
    // Edge "points" row; the probability/edge are our confidence-capped claim.
    const rawTotEdge = Math.abs(ground.totalPickProb - 0.5) * 100;
    tot.effective_confidence = Math.min(ground.confidence, round1(50 + rawTotEdge));
    tot.model_prob_on_pick = round1(tot.effective_confidence) / 100;
    tot.edge_prob_pp = round1(tot.effective_confidence - tot.market_no_vig_prob_pick * 100);
    tot.grade = "watch"; // informational only while uncalibrated (no lean/BA)
    const totOdds = pickedOdds(lines, "total", ground.totalPick, cons.totalAcceptedBooks);
    if (totOdds !== null) tot.current_price = { ...tot.current_price, odds_american: totOdds };
  }

  // 6 — audit substrate.
  return {
    raw_v2_projection: {
      home_score: round1(v2.predicted_home_score),
      away_score: round1(v2.predicted_away_score),
      total: round1(v2.predicted_total),
      margin_home: round1(rawMargin),
    },
    raw_v2_ml_probability: ground.mlHomeProbGrounded, // grounded-margin home prob (pre-regularization view)
    raw_v2_total: round1(v2.predicted_total),
    market_consensus_ml: { home_no_vig: cons.mlHomeNoVig, away_no_vig: cons.mlAwayNoVig, source: cons.mlSource },
    market_consensus_spread: cons.spreadHome,
    market_consensus_total: cons.totalLine,
    accepted_books: { ml: cons.mlAcceptedBooks, spread: cons.spreadAcceptedBooks, total: cons.totalAcceptedBooks },
    rejected_books: cons.mlRejectedBooks.map((r) => ({ book: r.book, reason: r.reason })),
    rejection_reasons: [...cons.mlRejectedBooks.map((r) => `ML ${r.book}: ${r.reason}`), ...cons.notes],
    consensus_strength: cons.consensusStrength,
    spread_confirmation: cons.spreadConfirmation,
    injury_context_state: injuriesKnown ? "known" : "unknown — no point impact applied, confidence capped",
    injury_adjustment: { home_pts: injuryHomePts, away_pts: injuryAwayPts },
    grounded_projection: {
      home_score: ground.groundedHomeScore,
      away_score: ground.groundedAwayScore,
      total: ground.groundedTotal,
      margin_home: ground.groundedMargin,
      moved_from_market: ground.groundedMovedFromMarket,
      moved_from_raw_total: round1(Math.abs(ground.groundedTotal - v2.predicted_total)),
    },
    regularized_probability: {
      ml_home: ground.mlHomeProbRegularized,
      ml_pick: ground.mlPick,
      ml_pick_prob: ground.mlPickProb,
      ml_edge_pp: ground.mlEdgePct,
    },
    final_confidence: ground.confidence,
    final_play_grade: ground.playGrade,
    final_pick_rationale: ground.gradeRationale,
    held,
    hold_reason: holdReason,
  };
}
