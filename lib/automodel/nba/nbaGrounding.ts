/**
 * NBA-P0 — Market grounding + regularization layer for the V2 engine.
 *
 * V2 produces a strong basketball read (Four Factors + playoff/recency
 * shrinkage) but is market-FREE (trust=1.0) — its score/total/margin can sit
 * well off the line (G5: 228 total vs 215.5 market). This layer makes it
 * "grounded but autonomous", mirroring the MLB architecture:
 *
 *   raw V2 projection
 *     → injury/context point-adjustment
 *     → blend toward the CLEAN consensus baseline (trust by data tier)
 *     → grounded projection (distance-capped from market)
 *     → probability, then regularize toward the no-vig market prob
 *     → confidence + play grade (bounded; no Best Angle while uncalibrated)
 *
 * The market is a PRIOR that grounds the model, not an anchor that replaces it.
 * Pure module. Probability regularization reuses the MLB helper.
 */

import { regularizeProbability } from "../mlbProbabilityRegularization";

export type NbaTier = "high" | "medium" | "low" | "fallback";

export interface NbaGroundingInput {
  rawHomeScore: number;
  rawAwayScore: number;
  /** Clean consensus baseline (from nbaMarketConsensus). */
  consensusSpreadHome: number | null; // negative = home favored
  consensusTotal: number | null;
  consensusHomeMlNoVig: number | null;
  mlIsSpreadImpliedFallback: boolean;
  /** Honest consensus strength from nbaMarketConsensus — caps confidence/grade. */
  consensusStrength: "multi_book" | "limited_spread_confirmed" | "spread_implied_fallback" | "insufficient";
  tier: NbaTier;
  /** Point impact of injuries/context (negative = points removed from team). */
  injuryHomePts: number;
  injuryAwayPts: number;
  injuriesKnown: boolean;
  marginSd?: number;
  totalSd?: number;
}

export interface NbaGroundingResult {
  // raw (V2)
  rawHomeScore: number;
  rawAwayScore: number;
  rawMargin: number;
  rawTotal: number;
  // injury-adjusted
  adjHomeScore: number;
  adjAwayScore: number;
  // grounded (blended toward market)
  trustIndependent: number;
  groundedHomeScore: number;
  groundedAwayScore: number;
  groundedMargin: number;
  groundedTotal: number;
  groundedMovedFromMarket: number;
  distanceCapApplied: boolean;
  // probabilities
  mlHomeProbGrounded: number; // from grounded margin, pre-regularization
  mlHomeProbRegularized: number; // after shrink toward market no-vig
  regularizationCapApplied: boolean;
  mlPick: "home" | "away";
  mlPickProb: number;
  mlEdgePct: number | null; // regularized pick prob - market pick prob
  totalLineUsed: number | null;
  totalPick: "over" | "under";
  totalOverProb: number;
  totalPickProb: number;
  // grade
  confidence: number;
  playGrade: "lean" | "watch" | "caution" | "market_aligned" | "hold";
  gradeRationale: string;
  notes: string[];
}

const TRUST_BY_TIER: Record<NbaTier, number> = { high: 0.65, medium: 0.45, low: 0.25, fallback: 0.1 };
const MARGIN_DISTANCE_CAP = 8.0; // grounded margin may sit ≤8pt from market-implied
const TOTAL_DISTANCE_CAP = 10.0;
const DEFAULT_MARGIN_SD = 12.0;
const DEFAULT_TOTAL_SD = 18.0;
const ML_REG_K = 0.6; // shrink factor toward market no-vig (same family as MLB)
const ML_REG_MAX_DIST_PP = 10.0;
const CONF_CEILING: Record<NbaTier, number> = { high: 70, medium: 62, low: 56, fallback: 53 };
const LEAN_MIN_EDGE_PP = 2.0;
const MARKET_ALIGNED_EDGE_PP = 1.0;

function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}
function round1(n: number): number { return Math.round(n * 10) / 10; }
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

export function groundNbaPrediction(input: NbaGroundingInput): NbaGroundingResult {
  const marginSd = input.marginSd ?? DEFAULT_MARGIN_SD;
  const totalSd = input.totalSd ?? DEFAULT_TOTAL_SD;
  const notes: string[] = [];

  const rawMargin = input.rawHomeScore - input.rawAwayScore;
  const rawTotal = input.rawHomeScore + input.rawAwayScore;

  // 1 — injury/context point-adjustment (no-op + note when feed absent).
  const adjHomeScore = input.rawHomeScore + input.injuryHomePts;
  const adjAwayScore = input.rawAwayScore + input.injuryAwayPts;
  const adjMargin = adjHomeScore - adjAwayScore;
  const adjTotal = adjHomeScore + adjAwayScore;
  if (!input.injuriesKnown) notes.push("injuries unknown — no point impact applied; confidence will be capped");
  else if (input.injuryHomePts !== 0 || input.injuryAwayPts !== 0)
    notes.push(`injury adj: home ${input.injuryHomePts >= 0 ? "+" : ""}${input.injuryHomePts}, away ${input.injuryAwayPts >= 0 ? "+" : ""}${input.injuryAwayPts} pts`);

  // 2 — market-implied baseline.
  const hasMarket = input.consensusSpreadHome !== null || input.consensusTotal !== null;
  const marketMargin = input.consensusSpreadHome !== null ? -input.consensusSpreadHome : adjMargin;
  const marketTotal = input.consensusTotal ?? adjTotal;

  // 3 — blend toward market (grounded but autonomous).
  const trust = hasMarket ? TRUST_BY_TIER[input.tier] : 1.0;
  let groundedMargin = trust * adjMargin + (1 - trust) * marketMargin;
  let groundedTotal = trust * adjTotal + (1 - trust) * marketTotal;

  // 4 — distance caps (no runaway from market).
  let distanceCapApplied = false;
  if (input.consensusSpreadHome !== null && Math.abs(groundedMargin - marketMargin) > MARGIN_DISTANCE_CAP) {
    groundedMargin = marketMargin + Math.sign(groundedMargin - marketMargin) * MARGIN_DISTANCE_CAP;
    distanceCapApplied = true;
  }
  if (input.consensusTotal !== null && Math.abs(groundedTotal - marketTotal) > TOTAL_DISTANCE_CAP) {
    groundedTotal = marketTotal + Math.sign(groundedTotal - marketTotal) * TOTAL_DISTANCE_CAP;
    distanceCapApplied = true;
  }
  const groundedHomeScore = (groundedTotal + groundedMargin) / 2;
  const groundedAwayScore = (groundedTotal - groundedMargin) / 2;
  const groundedMovedFromMarket = input.consensusTotal !== null ? Math.abs(groundedTotal - marketTotal) : 0;

  // 5 — ML probability from grounded margin, then regularize toward market.
  const mlHomeProbGrounded = normCdf(groundedMargin / marginSd);
  const reg = regularizeProbability({
    rawProb: mlHomeProbGrounded,
    marketProb: input.consensusHomeMlNoVig,
    k: ML_REG_K,
    maxDistancePp: ML_REG_MAX_DIST_PP,
  });
  const mlHomeProbRegularized = reg.regularizedProb ?? mlHomeProbGrounded;
  const mlPick: "home" | "away" = mlHomeProbRegularized >= 0.5 ? "home" : "away";
  const mlPickProb = mlPick === "home" ? mlHomeProbRegularized : 1 - mlHomeProbRegularized;
  const marketPickProb =
    input.consensusHomeMlNoVig === null ? null : mlPick === "home" ? input.consensusHomeMlNoVig : 1 - input.consensusHomeMlNoVig;
  const mlEdgePct = marketPickProb === null ? null : round1((mlPickProb - marketPickProb) * 100);

  // 6 — total pick + prob.
  const totalLineUsed = input.consensusTotal;
  const totalRef = totalLineUsed ?? groundedTotal;
  const totalOverProb = normCdf((groundedTotal - totalRef) / totalSd);
  const totalPick: "over" | "under" = groundedTotal >= totalRef ? "over" : "under";
  const totalPickProb = totalPick === "over" ? totalOverProb : 1 - totalOverProb;

  // 7 — confidence + play grade (bounded; NO Best Angle while uncalibrated).
  const ceiling = CONF_CEILING[input.tier];
  const limited = input.consensusStrength !== "multi_book"; // 1-book / fallback / insufficient
  let confidence = clamp(mlPickProb * 100, 50, ceiling);
  if (!input.injuriesKnown) confidence = Math.min(confidence, ceiling - 4);
  if (input.mlIsSpreadImpliedFallback) confidence = Math.min(confidence, 56);
  if (input.consensusStrength === "limited_spread_confirmed") confidence = Math.min(confidence, 58);
  confidence = round1(confidence);

  let playGrade: NbaGroundingResult["playGrade"];
  let gradeRationale: string;
  const absEdge = mlEdgePct === null ? 0 : Math.abs(mlEdgePct);
  const consensusLabel =
    input.consensusStrength === "multi_book" ? "multi-book consensus" :
    input.consensusStrength === "limited_spread_confirmed" ? "limited ML consensus / spread-confirmed" :
    input.consensusStrength === "spread_implied_fallback" ? "spread-implied (book MLs corrupted)" : "insufficient market";
  if (!hasMarket || input.consensusStrength === "insufficient") {
    playGrade = "hold";
    gradeRationale = "no clean market baseline — held";
  } else if (input.mlIsSpreadImpliedFallback) {
    playGrade = "caution";
    gradeRationale = `${consensusLabel}; capped to Caution`;
  } else if (absEdge < MARKET_ALIGNED_EDGE_PP) {
    playGrade = "market_aligned";
    gradeRationale = `edge ${mlEdgePct}pp within ±${MARKET_ALIGNED_EDGE_PP}pp of market — informational (${consensusLabel})`;
  } else if (
    absEdge >= LEAN_MIN_EDGE_PP && input.tier === "high" && input.injuriesKnown &&
    input.consensusStrength === "multi_book"
  ) {
    playGrade = "lean";
    gradeRationale = `edge ${mlEdgePct}pp, high tier, ${consensusLabel} — Lean (Best Angle locked: model uncalibrated, 0 graded NBA games)`;
  } else {
    playGrade = "watch";
    const why = input.consensusStrength !== "multi_book" ? consensusLabel
      : input.tier !== "high" ? "tier=" + input.tier
      : !input.injuriesKnown ? "injuries unknown" : "below lean bar";
    gradeRationale = `edge ${mlEdgePct}pp but ${why} — Watch (no Lean/Best Angle)`;
  }

  return {
    rawHomeScore: round1(input.rawHomeScore),
    rawAwayScore: round1(input.rawAwayScore),
    rawMargin: round1(rawMargin),
    rawTotal: round1(rawTotal),
    adjHomeScore: round1(adjHomeScore),
    adjAwayScore: round1(adjAwayScore),
    trustIndependent: trust,
    groundedHomeScore: round1(groundedHomeScore),
    groundedAwayScore: round1(groundedAwayScore),
    groundedMargin: round1(groundedMargin),
    groundedTotal: round1(groundedTotal),
    groundedMovedFromMarket: round1(groundedMovedFromMarket),
    distanceCapApplied,
    mlHomeProbGrounded: round1(mlHomeProbGrounded * 1000) / 1000,
    mlHomeProbRegularized: round1(mlHomeProbRegularized * 1000) / 1000,
    regularizationCapApplied: reg.capApplied,
    mlPick,
    mlPickProb: round1(mlPickProb * 1000) / 1000,
    mlEdgePct,
    totalLineUsed,
    totalPick,
    totalOverProb: round1(totalOverProb * 1000) / 1000,
    totalPickProb: round1(totalPickProb * 1000) / 1000,
    confidence,
    playGrade,
    gradeRationale,
    notes,
  };
}
