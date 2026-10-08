/**
 * Phase 7B v0c-DE — NBA per-market intelligence assembly.
 *
 * Pure function. Takes raw lines (per-book), splits (consensus only),
 * opportunities (sharp/cross-ref EV), the NBA model snapshot, the
 * model output, and per-game provenance — and produces a per-market
 * intelligence block ready for UI consumption.
 *
 * Honest about missing data:
 *   • No fake openers. No fake RLM. No fake steam.
 *   • "first_observed_at" comes from the lines table's `fetched_at`
 *     (earliest snapshot we hold).
 *   • Per-book public splits → null (SharpAPI gives consensus only).
 *   • Book coverage flagged when only 1-2 books present.
 *
 * No DB writes. Pure transform.
 */

import type {
  NbaAutoModelOutput,
  NbaGameSnapshot,
} from "../../automodel/nba/types";
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
import type {
  NbaSplitsRow,
  NbaSplitsMl,
  NbaSplitsSpread,
  NbaSplitsTotal,
} from "./nbaSplitsClient";
import type { NbaOpportunity } from "./nbaOpportunitiesClient";
import {
  buildNbaMarketConsensus,
  type NbaMarketConsensus,
} from "../../automodel/nba/nbaMarketConsensus";
import { computeNbaMarketProbabilities } from "../../automodel/nba/nbaDistribution";

// ─── Raw per-book line row (subset of `lines` table columns) ───────

export type NbaLineRow = {
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  fetched_at: string | null;
};

// ─── Splits divergence ─────────────────────────────────────────────

export type SplitsDivergence =
  | "none"           // |handle - bets| < 5pp
  | "mild_sharp"     // legacy identifier: 5–10pp; money outpaces bets
  | "strong_sharp"   // legacy identifier: ≥10pp; bettor identity unverified
  | "mild_square"    // 5–10pp; bets outpace money — public-heavy
  | "strong_square"; // ≥10pp; clearly public-heavy

function classifyDivergence(
  betsPct: number | undefined,
  handlePct: number | undefined,
): SplitsDivergence {
  if (betsPct === undefined || handlePct === undefined) return "none";
  const delta = (handlePct - betsPct) * 100; // pp
  const abs = Math.abs(delta);
  if (abs < 5) return "none";
  if (delta > 0) return abs >= 10 ? "strong_sharp" : "mild_sharp";
  return abs >= 10 ? "strong_square" : "mild_square";
}

// ─── Per-market block shape returned by this service ───────────────

export type SplitsSide = {
  bets_pct: number | null;
  handle_pct: number | null;
  divergence: SplitsDivergence;
};

export type PerBookOdds = {
  sportsbook: string;
  side: "home" | "away" | "over" | "under";
  line_value: number | null;
  odds_american: number | null;
  fetched_at: string | null;
};

export type SourceBadges = {
  /** "/odds?league=nba" had at least 1 row matched to this game. */
  has_lines: boolean;
  /** "/splits?league=nba" matched this game (1 consensus row). */
  has_splits: boolean;
  /** "/opportunities/ev?league=nba" matched at least 1 row for this game. */
  has_opportunities: boolean;
  /** Number of unique sportsbooks present in the lines table. */
  book_count: number;
  /** True when book_count <= 2; the UI surfaces a warning. */
  limited_book_coverage: boolean;
  /** Books that supplied at least one row. */
  books: string[];
  /** ESPN injuries fetched (true) vs not enabled. */
  injuries_source: "espn" | "none";
  /** "consensus" when /splits returned a row; null when missing. */
  splits_source: "consensus" | null;
  /** When the consensus splits row was last refreshed (per SharpAPI). */
  splits_fetched_at: string | null;
};

export type MarketIntelligence = {
  market: "moneyline" | "spread" | "total";
  /** Pick label, e.g. "NYK ML", "NYK -1.5", "OVER 216.5". */
  pick_label: string;
  pick_side: "home" | "away" | "over" | "under" | null;

  // ── Current consensus price (from /splits + best per-book juice) ──
  /** Spread line or total line (null for ML). */
  consensus_line: number | null;
  /** Best per-book price for the pick side, with provenance. */
  current_price: {
    odds_american: number | null;
    odds_decimal: number | null;
    sportsbook: string | null;
    fetched_at: string | null;
  };
  /** Other side current price (for context). */
  other_side_price: {
    odds_american: number | null;
    sportsbook: string | null;
  };
  /** Per-book breakdown of the pick side. */
  per_book_pick_side: PerBookOdds[];
  /** Per-book breakdown of the other side. */
  per_book_other_side: PerBookOdds[];

  // ── Implied / fair / EV ──
  /** Raw implied probability (with vig) on the pick side. */
  market_implied_prob_pick: number | null;
  /** No-vig (de-vigged) probability on the pick side. */
  market_no_vig_prob_pick: number | null;
  /** Fair probability from SharpAPI opportunities (sharp-book cross-ref). */
  opp_fair_probability_pick: number | null;
  /** EV % from opportunities row (null when no matching opportunity). */
  opp_ev_percentage_pick: number | null;
  /** Market width from opportunities (proxy for cross-book agreement). */
  opp_market_width: number | null;
  /** Opportunity warnings (e.g. "stale", "thin book coverage"). */
  opp_warnings: string[];
  /** True when the matched opportunity is flagged possibly stale. */
  opp_possibly_stale: boolean;

  // ── Model ──
  model_confidence: number;
  model_prob_on_pick: number | null;
  /** For ML: probability edge (pp). For spread/total: also computed where available. */
  edge_prob_pp: number | null;
  /** For spread/total: edge in POINTS (signed for the pick). */
  edge_points: number | null;

  // ── Conflict + grade ──
  conflict_band: MarketConflictBand;
  grade: GradeOutput["grade"];
  effective_confidence: number;
  best_angle_eligible: boolean;
  rationale: string[];

  // ── Splits ──
  splits: {
    pick_side: SplitsSide | null;
    other_side: SplitsSide | null;
    /** Whichever side carries the stronger sharp signal. */
    sharp_signal_side: "pick" | "other" | "none";
  };

  // ── Caveats ──
  first_observed_at: string | null;
  /** Honest label set by route layer; "No opener available" when applicable. */
  movement_note: string;
};

export type NbaGameIntelligence = {
  game_external_id: number;
  ml: MarketIntelligence;
  spread: MarketIntelligence;
  total: MarketIntelligence;
  /** Per-game sources/badges. */
  sources: SourceBadges;
  /** Best market grade (used by Quick Read). */
  top_grade: GradeOutput["grade"];
  /** Top market that earned the best grade ("ml" | "spread" | "total"). */
  top_market: "moneyline" | "spread" | "total" | null;
};

// ─── Helpers ────────────────────────────────────────────────────────

function bestPriceFor(
  lines: NbaLineRow[],
  market: "moneyline" | "spread" | "total",
  side: "home" | "away" | "over" | "under",
  targetLine: number | null = null,
): { row: NbaLineRow | null; perBook: PerBookOdds[] } {
  const matches = lines
    .filter((l) =>
      l.market_type === market &&
      l.side === side &&
      (targetLine === null || (l.line_value !== null && Math.abs(l.line_value - targetLine) < 0.01))
    )
    .map((l) => ({
      sportsbook: l.sportsbook,
      side: side,
      line_value: l.line_value,
      odds_american: l.odds_american,
      fetched_at: l.fetched_at,
    }));
  if (matches.length === 0) return { row: null, perBook: [] };
  // Best price = highest American (most positive = best for bettor).
  let best: NbaLineRow | null = null;
  for (const l of lines) {
    if (l.market_type !== market || l.side !== side) continue;
    if (targetLine !== null && (l.line_value === null || Math.abs(l.line_value - targetLine) >= 0.01)) continue;
    if (l.odds_american === null) continue;
    if (best === null || (l.odds_american > (best.odds_american ?? -Infinity))) {
      best = l;
    }
  }
  return { row: best, perBook: matches };
}

/**
 * Fair-price reference built only from complete two-sided quotes at one book
 * and one exact line. This prevents a favorable execution price at one book
 * from being de-vigged against the opposing price or a different handicap at
 * another book.
 */
export function coherentNoVigReference(opts: {
  lines: ReadonlyArray<NbaLineRow>;
  market: "moneyline" | "spread" | "total";
  pickSide: "home" | "away" | "over" | "under";
  pickLine: number | null;
}): { probability: number | null; books: string[] } {
  const otherSide = opts.pickSide === "home" ? "away"
    : opts.pickSide === "away" ? "home"
    : opts.pickSide === "over" ? "under" : "over";
  const byBook = new Map<string, { pick: NbaLineRow | null; other: NbaLineRow | null }>();
  for (const line of opts.lines) {
    if (line.market_type !== opts.market || line.odds_american === null) continue;
    const expectedLine = opts.market === "moneyline" ? null
      : opts.market === "spread" && opts.pickLine !== null && line.side === otherSide ? -opts.pickLine
      : opts.pickLine;
    if (
      opts.market !== "moneyline" &&
      (expectedLine === null || line.line_value === null || Math.abs(line.line_value - expectedLine) >= 0.01)
    ) continue;
    const pair = byBook.get(line.sportsbook) ?? { pick: null, other: null };
    if (line.side === opts.pickSide) pair.pick = line;
    if (line.side === otherSide) pair.other = line;
    byBook.set(line.sportsbook, pair);
  }
  const probabilities: Array<{ book: string; probability: number }> = [];
  for (const [book, pair] of byBook) {
    if (pair.pick?.odds_american === null || pair.pick?.odds_american === undefined) continue;
    if (pair.other?.odds_american === null || pair.other?.odds_american === undefined) continue;
    const noVig = noVigPair({
      sideAAmerican: pair.pick.odds_american,
      sideBAmerican: pair.other.odds_american,
    });
    if (noVig) probabilities.push({ book, probability: noVig.sideA });
  }
  if (probabilities.length === 0) return { probability: null, books: [] };
  const sorted = probabilities.map((row) => row.probability).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const probability = sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return { probability, books: probabilities.map((row) => row.book).sort() };
}

function earliestFetchedAt(lines: NbaLineRow[]): string | null {
  let earliest: string | null = null;
  for (const l of lines) {
    if (l.fetched_at === null) continue;
    if (earliest === null || l.fetched_at < earliest) earliest = l.fetched_at;
  }
  return earliest;
}

function exactLineProbability(opts: {
  prediction: NbaAutoModelOutput;
  spreadHome: number | null;
  total: number | null;
}): {
  mlHome: number;
  spreadHome: number | null;
  totalOver: number | null;
  cap: number;
} | null {
  const candidate = opts.prediction as NbaAutoModelOutput & {
    v1_probabilities?: { margin_sd_used: number; total_sd_used: number };
    v1_breakdown?: { applied_caps: Array<{ cap: number }> };
  };
  if (!candidate.v1_probabilities) return null;
  const probabilities = computeNbaMarketProbabilities({
    projected_home_margin: opts.prediction.predicted_home_score - opts.prediction.predicted_away_score,
    projected_total: opts.prediction.predicted_total,
    market_spread_home: opts.spreadHome,
    market_total: opts.total,
    margin_sd_base: candidate.v1_probabilities.margin_sd_used,
    total_sd_base: candidate.v1_probabilities.total_sd_used,
  });
  const caps = [
    opts.prediction.audit.confidence_ceiling,
    ...(candidate.v1_breakdown?.applied_caps.map((entry) => entry.cap) ?? []),
  ];
  return {
    mlHome: probabilities.ml_home_win_prob,
    spreadHome: probabilities.spread_home_cover_prob,
    totalOver: probabilities.total_over_prob,
    cap: Math.min(...caps),
  };
}

function confidenceFromProbability(probability: number, cap: number): number {
  return Math.round(Math.max(50, Math.min(cap, Math.max(probability, 1 - probability) * 100)) * 10) / 10;
}

function uniqueBooks(lines: NbaLineRow[]): string[] {
  const set = new Set<string>();
  for (const l of lines) set.add(l.sportsbook);
  return Array.from(set).sort();
}

function findOppFor(
  opps: NbaOpportunity[],
  market: "moneyline" | "spread" | "total",
  side: "home" | "away" | "over" | "under",
  line: number | null,
): NbaOpportunity | null {
  const matching = opps.filter(
    (o) => o.market_type === market && o.side === side,
  );
  if (matching.length === 0) return null;
  // Prefer the opportunity whose line matches the consensus (for spread/total).
  if (line !== null && (market === "spread" || market === "total")) {
    const lineMatch = matching.find((o) => o.line !== null && Math.abs(o.line - line) < 0.6);
    if (lineMatch) return lineMatch;
  }
  // Otherwise: highest EV.
  return matching.reduce((acc, cur) => {
    if (acc === null) return cur;
    const a = acc.ev_percentage ?? 0;
    const c = cur.ev_percentage ?? 0;
    return c > a ? cur : acc;
  }, null as NbaOpportunity | null);
}

function splitsSideOf(
  data: { bets: number | undefined; handle: number | undefined },
): SplitsSide | null {
  if (data.bets === undefined && data.handle === undefined) return null;
  return {
    bets_pct: data.bets ?? null,
    handle_pct: data.handle ?? null,
    divergence: classifyDivergence(data.bets, data.handle),
  };
}

// ─── Per-market builders ────────────────────────────────────────────

function buildMl(
  snapshot: NbaGameSnapshot,
  prediction: NbaAutoModelOutput,
  lines: NbaLineRow[],
  consensus: NbaMarketConsensus,
  splitsRow: NbaSplitsRow | null,
  opps: NbaOpportunity[],
): MarketIntelligence {
  const pickSide = prediction.predicted_ml_winner;
  const pickLabel =
    pickSide === "home"
      ? `${snapshot.home_team.abbreviation} ML`
      : `${snapshot.away_team.abbreviation} ML`;

  const pickBest = bestPriceFor(lines, "moneyline", pickSide);
  const otherSide = pickSide === "home" ? "away" : "home";
  const otherBest = bestPriceFor(lines, "moneyline", otherSide);
  const pickOdds = pickBest.row?.odds_american ?? null;
  const otherOdds = otherBest.row?.odds_american ?? null;

  const noVigPick = pickSide === "home" ? consensus.mlHomeNoVig : consensus.mlAwayNoVig;

  const exact = exactLineProbability({ prediction, spreadHome: null, total: null });
  const modelHomeProb = exact?.mlHome ?? (
    prediction.predicted_ml_winner === "home"
      ? prediction.ml_confidence / 100
      : 1 - prediction.ml_confidence / 100
  );
  const modelProbOnPick = pickSide === "home" ? modelHomeProb : 1 - modelHomeProb;
  const modelConf = exact === null
    ? prediction.ml_confidence
    : confidenceFromProbability(modelProbOnPick, exact.cap);

  let band: MarketConflictBand;
  let edgePp: number | null;
  if (noVigPick === null) {
    band = "market_unavailable";
    edgePp = null;
  } else {
    const c = classifyMlConflict({ modelProb: modelProbOnPick, marketNoVigProb: noVigPick });
    band = c.band;
    edgePp = c.edge * 100;
  }

  const grade = gradeNbaMarket({
    pick: pickSide,
    confidence: modelConf,
    band: pickOdds === null || noVigPick === null ? "market_unavailable" : band,
    edge: edgePp === null ? 0 : edgePp / 100,
    dataQualityTier: prediction.audit.data_quality_tier,
    injuriesKnown:
      snapshot.data_quality.home_injuries_known && snapshot.data_quality.away_injuries_known,
  });

  const opp = findOppFor(opps, "moneyline", pickSide, null);

  const sm: NbaSplitsMl | null = splitsRow?.ml ?? null;
  const pickSplits = splitsSideOf({
    bets: pickSide === "home" ? sm?.bets_pct?.home : sm?.bets_pct?.away,
    handle: pickSide === "home" ? sm?.handle_pct?.home : sm?.handle_pct?.away,
  });
  const otherSplits = splitsSideOf({
    bets: otherSide === "home" ? sm?.bets_pct?.home : sm?.bets_pct?.away,
    handle: otherSide === "home" ? sm?.handle_pct?.home : sm?.handle_pct?.away,
  });
  const sharpSide: "pick" | "other" | "none" =
    pickSplits?.divergence === "strong_sharp" || pickSplits?.divergence === "mild_sharp"
      ? "pick"
      : otherSplits?.divergence === "strong_sharp" || otherSplits?.divergence === "mild_sharp"
        ? "other"
        : "none";

  return {
    market: "moneyline",
    pick_label: pickLabel,
    pick_side: pickSide,
    consensus_line: null,
    current_price: {
      odds_american: pickOdds,
      odds_decimal: americanToDecimal(pickOdds),
      sportsbook: pickBest.row?.sportsbook ?? null,
      fetched_at: pickBest.row?.fetched_at ?? null,
    },
    other_side_price: {
      odds_american: otherOdds,
      sportsbook: otherBest.row?.sportsbook ?? null,
    },
    per_book_pick_side: pickBest.perBook,
    per_book_other_side: otherBest.perBook,
    market_implied_prob_pick: americanToImpliedProb(pickOdds),
    market_no_vig_prob_pick: noVigPick,
    opp_fair_probability_pick: opp?.fair_probability ?? null,
    opp_ev_percentage_pick: opp?.ev_percentage ?? null,
    opp_market_width: opp?.market_width ?? null,
    opp_warnings: opp?.warnings ?? [],
    opp_possibly_stale: opp?.possibly_stale ?? false,
    model_confidence: modelConf,
    model_prob_on_pick: modelProbOnPick,
    edge_prob_pp: edgePp,
    edge_points: null,
    conflict_band: band,
    grade: grade.grade,
    effective_confidence: grade.effectiveConfidence,
    best_angle_eligible: grade.bestAngleEligible,
    rationale: grade.rationale,
    splits: {
      pick_side: pickSplits,
      other_side: otherSplits,
      sharp_signal_side: sharpSide,
    },
    first_observed_at: earliestFetchedAt(lines.filter((l) => l.market_type === "moneyline")),
    movement_note: "First observed tracking only — no opener available",
  };
}

function buildSpread(
  snapshot: NbaGameSnapshot,
  prediction: NbaAutoModelOutput,
  lines: NbaLineRow[],
  consensus: NbaMarketConsensus,
  splitsRow: NbaSplitsRow | null,
  opps: NbaOpportunity[],
): MarketIntelligence {
  const lineHomeFromMarket = consensus.spreadHome;
  const exact = exactLineProbability({ prediction, spreadHome: lineHomeFromMarket, total: null });
  const pickSide: "home" | "away" = exact?.spreadHome === null || exact?.spreadHome === undefined
    ? prediction.predicted_spread_side
    : exact.spreadHome >= 0.5 ? "home" : "away";
  const pickTargetLine = lineHomeFromMarket === null
    ? null
    : pickSide === "home" ? lineHomeFromMarket : -lineHomeFromMarket;
  const pickBest = bestPriceFor(lines, "spread", pickSide, pickTargetLine);
  const otherSide = pickSide === "home" ? "away" : "home";
  const otherBest = bestPriceFor(lines, "spread", otherSide, pickTargetLine === null ? null : -pickTargetLine);
  const pickOdds = pickBest.row?.odds_american ?? null;
  const otherOdds = otherBest.row?.odds_american ?? null;
  const pickLine = pickTargetLine;

  const noVigPick = coherentNoVigReference({ lines, market: "spread", pickSide, pickLine }).probability;

  const modelProb = exact?.spreadHome === null || exact?.spreadHome === undefined
    ? prediction.spread_confidence / 100
    : pickSide === "home" ? exact.spreadHome : 1 - exact.spreadHome;
  const modelConf = exact === null
    ? prediction.spread_confidence
    : confidenceFromProbability(modelProb, exact.cap);
  // CONVENTION BOUNDARY (2026-06-10 bug fix):
  // `blendPosterior` produces `posterior_spread = home_score - away_score`
  // so its `predicted_spread_home` is POSITIVE when home wins (model convention).
  // `classifySpreadConflict` expects the BETTING convention where NEGATIVE means
  // home favored (matches the line "NYK -2" = NYK favored by 2). Negate here.
  //
  // Pre-fix bug surfaced when model predicted NYK +5.6 (home wins by ~6) but the
  // classifier interpreted +5.6 as "NYK is a 5.6-pt underdog", producing a
  // strong_conflict / caution grade despite the model agreeing with the line
  // direction. ML pick remained correctly "home" because that path uses
  // probability, not the spread sign — the spread market was the only one
  // affected. Confirmed via projection={home:111.2, away:105.6, spread_home:+5.6}.
  const modelHomeSpread = -prediction.predicted_spread_home;

  let band: MarketConflictBand;
  let edgePoints: number | null;
  if (lineHomeFromMarket === null) {
    band = "market_unavailable";
    edgePoints = null;
  } else {
    const c = classifySpreadConflict({
      modelSpreadHome: modelHomeSpread,
      marketSpreadHome: lineHomeFromMarket,
      pickSide,
    });
    band = c.band;
    edgePoints = c.edge;
  }

  const grade = gradeNbaMarket({
    pick: pickSide,
    confidence: modelConf,
    band: pickOdds === null || noVigPick === null ? "market_unavailable" : band,
    edge: edgePoints === null ? 0 : edgePoints / 10,
    dataQualityTier: prediction.audit.data_quality_tier,
    injuriesKnown:
      snapshot.data_quality.home_injuries_known && snapshot.data_quality.away_injuries_known,
  });

  const opp = findOppFor(opps, "spread", pickSide, pickLine);

  const ss: NbaSplitsSpread | null = splitsRow?.spread ?? null;
  const pickSplits = splitsSideOf({
    bets: pickSide === "home" ? ss?.bets_pct?.home : ss?.bets_pct?.away,
    handle: pickSide === "home" ? ss?.handle_pct?.home : ss?.handle_pct?.away,
  });
  const otherSplits = splitsSideOf({
    bets: otherSide === "home" ? ss?.bets_pct?.home : ss?.bets_pct?.away,
    handle: otherSide === "home" ? ss?.handle_pct?.home : ss?.handle_pct?.away,
  });
  const sharpSide: "pick" | "other" | "none" =
    pickSplits?.divergence === "strong_sharp" || pickSplits?.divergence === "mild_sharp"
      ? "pick"
      : otherSplits?.divergence === "strong_sharp" || otherSplits?.divergence === "mild_sharp"
        ? "other"
        : "none";

  const sideLineDisplay = pickLine;
  const pickAbbr =
    pickSide === "home" ? snapshot.home_team.abbreviation : snapshot.away_team.abbreviation;
  const pickLabel =
    sideLineDisplay !== null
      ? `${pickAbbr} ${sideLineDisplay > 0 ? "+" : ""}${sideLineDisplay}`
      : `${pickAbbr} (line tbd)`;

  return {
    market: "spread",
    pick_label: pickLabel,
    pick_side: pickSide,
    consensus_line: sideLineDisplay,
    current_price: {
      odds_american: pickOdds,
      odds_decimal: americanToDecimal(pickOdds),
      sportsbook: pickBest.row?.sportsbook ?? null,
      fetched_at: pickBest.row?.fetched_at ?? null,
    },
    other_side_price: {
      odds_american: otherOdds,
      sportsbook: otherBest.row?.sportsbook ?? null,
    },
    per_book_pick_side: pickBest.perBook,
    per_book_other_side: otherBest.perBook,
    market_implied_prob_pick: americanToImpliedProb(pickOdds),
    market_no_vig_prob_pick: noVigPick,
    opp_fair_probability_pick: opp?.fair_probability ?? null,
    opp_ev_percentage_pick: opp?.ev_percentage ?? null,
    opp_market_width: opp?.market_width ?? null,
    opp_warnings: opp?.warnings ?? [],
    opp_possibly_stale: opp?.possibly_stale ?? false,
    model_confidence: modelConf,
    model_prob_on_pick: modelProb,
    edge_prob_pp: null,
    edge_points: edgePoints,
    conflict_band: band,
    grade: grade.grade,
    effective_confidence: grade.effectiveConfidence,
    best_angle_eligible: grade.bestAngleEligible,
    rationale: grade.rationale,
    splits: {
      pick_side: pickSplits,
      other_side: otherSplits,
      sharp_signal_side: sharpSide,
    },
    first_observed_at: earliestFetchedAt(lines.filter((l) => l.market_type === "spread")),
    movement_note: "First observed tracking only — no opener available",
  };
}

function buildTotal(
  snapshot: NbaGameSnapshot,
  prediction: NbaAutoModelOutput,
  lines: NbaLineRow[],
  consensus: NbaMarketConsensus,
  splitsRow: NbaSplitsRow | null,
  opps: NbaOpportunity[],
): MarketIntelligence {
  const line = consensus.totalLine;
  const exact = exactLineProbability({ prediction, spreadHome: null, total: line });
  const pickSide: "over" | "under" = exact?.totalOver === null || exact?.totalOver === undefined
    ? prediction.predicted_total_side
    : exact.totalOver >= 0.5 ? "over" : "under";
  const pickBest = bestPriceFor(lines, "total", pickSide, line);
  const otherSide = pickSide === "over" ? "under" : "over";
  const otherBest = bestPriceFor(lines, "total", otherSide, line);
  const pickOdds = pickBest.row?.odds_american ?? null;
  const otherOdds = otherBest.row?.odds_american ?? null;
  const noVigPick = coherentNoVigReference({ lines, market: "total", pickSide, pickLine: line }).probability;

  const modelProb = exact?.totalOver === null || exact?.totalOver === undefined
    ? prediction.total_confidence / 100
    : pickSide === "over" ? exact.totalOver : 1 - exact.totalOver;
  const modelConf = exact === null
    ? prediction.total_confidence
    : confidenceFromProbability(modelProb, exact.cap);
  const modelTotal = prediction.predicted_total;
  let band: MarketConflictBand;
  let edgePoints: number | null;
  if (line === null) {
    band = "market_unavailable";
    edgePoints = null;
  } else {
    const c = classifyTotalConflict({ modelTotal, marketTotal: line, pickSide });
    band = c.band;
    edgePoints = c.edge;
  }

  const grade = gradeNbaMarket({
    pick: pickSide,
    confidence: modelConf,
    band: pickOdds === null || noVigPick === null ? "market_unavailable" : band,
    edge: edgePoints === null ? 0 : edgePoints / 15,
    dataQualityTier: prediction.audit.data_quality_tier,
    injuriesKnown:
      snapshot.data_quality.home_injuries_known && snapshot.data_quality.away_injuries_known,
  });

  const opp = findOppFor(opps, "total", pickSide, line);

  const st: NbaSplitsTotal | null = splitsRow?.total ?? null;
  const pickSplits = splitsSideOf({
    bets: pickSide === "over" ? st?.bets_pct?.over : st?.bets_pct?.under,
    handle: pickSide === "over" ? st?.handle_pct?.over : st?.handle_pct?.under,
  });
  const otherSplits = splitsSideOf({
    bets: otherSide === "over" ? st?.bets_pct?.over : st?.bets_pct?.under,
    handle: otherSide === "over" ? st?.handle_pct?.over : st?.handle_pct?.under,
  });
  const sharpSide: "pick" | "other" | "none" =
    pickSplits?.divergence === "strong_sharp" || pickSplits?.divergence === "mild_sharp"
      ? "pick"
      : otherSplits?.divergence === "strong_sharp" || otherSplits?.divergence === "mild_sharp"
        ? "other"
        : "none";

  const pickLabel = line !== null ? `${pickSide.toUpperCase()} ${line}` : pickSide.toUpperCase();

  return {
    market: "total",
    pick_label: pickLabel,
    pick_side: pickSide,
    consensus_line: line,
    current_price: {
      odds_american: pickOdds,
      odds_decimal: americanToDecimal(pickOdds),
      sportsbook: pickBest.row?.sportsbook ?? null,
      fetched_at: pickBest.row?.fetched_at ?? null,
    },
    other_side_price: {
      odds_american: otherOdds,
      sportsbook: otherBest.row?.sportsbook ?? null,
    },
    per_book_pick_side: pickBest.perBook,
    per_book_other_side: otherBest.perBook,
    market_implied_prob_pick: americanToImpliedProb(pickOdds),
    market_no_vig_prob_pick: noVigPick,
    opp_fair_probability_pick: opp?.fair_probability ?? null,
    opp_ev_percentage_pick: opp?.ev_percentage ?? null,
    opp_market_width: opp?.market_width ?? null,
    opp_warnings: opp?.warnings ?? [],
    opp_possibly_stale: opp?.possibly_stale ?? false,
    model_confidence: modelConf,
    model_prob_on_pick: modelProb,
    edge_prob_pp: null,
    edge_points: edgePoints,
    conflict_band: band,
    grade: grade.grade,
    effective_confidence: grade.effectiveConfidence,
    best_angle_eligible: grade.bestAngleEligible,
    rationale: grade.rationale,
    splits: {
      pick_side: pickSplits,
      other_side: otherSplits,
      sharp_signal_side: sharpSide,
    },
    first_observed_at: earliestFetchedAt(lines.filter((l) => l.market_type === "total")),
    movement_note: "First observed tracking only — no opener available",
  };
}

// ─── Public composer ────────────────────────────────────────────────

export function buildNbaGameIntelligence(opts: {
  snapshot: NbaGameSnapshot;
  prediction: NbaAutoModelOutput;
  lines: NbaLineRow[];
  splitsRow: NbaSplitsRow | null;
  opportunities: NbaOpportunity[];
  injuriesSource: "espn" | "none";
}): NbaGameIntelligence {
  const consensus = buildNbaMarketConsensus(opts.lines
    .filter((line) => line.side !== null && (line.market_type === "moneyline" || line.market_type === "spread" || line.market_type === "total"))
    .map((line) => ({
      sportsbook: line.sportsbook,
      market_type: line.market_type as "moneyline" | "spread" | "total",
      side: line.side!,
      line_value: line.line_value,
      odds_american: line.odds_american,
    })));
  const ml = buildMl(opts.snapshot, opts.prediction, opts.lines, consensus, opts.splitsRow, opts.opportunities);
  const spread = buildSpread(opts.snapshot, opts.prediction, opts.lines, consensus, opts.splitsRow, opts.opportunities);
  const total = buildTotal(opts.snapshot, opts.prediction, opts.lines, consensus, opts.splitsRow, opts.opportunities);

  const books = uniqueBooks(opts.lines);
  const sources: SourceBadges = {
    has_lines: opts.lines.length > 0,
    has_splits: opts.splitsRow !== null,
    has_opportunities: opts.opportunities.length > 0,
    book_count: books.length,
    limited_book_coverage: books.length <= 2,
    books,
    injuries_source: opts.injuriesSource,
    splits_source: opts.splitsRow !== null ? "consensus" : null,
    splits_fetched_at: opts.splitsRow?.fetched_at ?? null,
  };

  // Top grade across the three markets — for Quick Read.
  const order: GradeOutput["grade"][] = ["best_angle", "lean", "watch", "caution", "no_market", "held"];
  const rankedMarkets = [ml, spread, total].sort((a, b) => order.indexOf(a.grade) - order.indexOf(b.grade));
  const topMarketIntel = rankedMarkets[0];
  return {
    game_external_id: opts.snapshot.game_external_id,
    ml,
    spread,
    total,
    sources,
    top_grade: topMarketIntel.grade,
    top_market: topMarketIntel.market,
  };
}
