/* eslint-disable @typescript-eslint/no-explicit-any -- immutable snapshots span legacy DTO releases */
/**
 * Exhaustive, read-only soccer loss ledger.
 *
 * Reads immutable prediction locks and their stored forward-evidence captures.
 * It never calls a provider and never writes to Supabase. Postgame box-score
 * facts are used only for settlement/error measurement, never as candidate
 * inputs.
 */
import { createClient } from "@supabase/supabase-js";

type Competition = "world_cup" | "epl" | "ucl" | "unknown";
type Market = "match_result" | "double_chance" | "total" | "btts";
type Result = "win" | "loss" | "push" | "void";
type Block = "development" | "confirmation" | "holdout";
type ProbabilityVector = Record<string, number>;

const MARKETS = new Set<Market>(["match_result", "double_chance", "total", "btts"]);
const ACTIONABLE = new Set(["Best Angle", "Lean"]);

function object(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function array(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.map(object) : [];
}

function first(value: unknown): Record<string, any> {
  return Array.isArray(value) ? object(value[0]) : object(value);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoMillis(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number | null, places = 5): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function correlation(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left)!;
  const rightMean = mean(right)!;
  const covariance = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index]! - rightMean), 0);
  const leftVariance = left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0);
  const rightVariance = right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0);
  return leftVariance > 0 && rightVariance > 0 ? covariance / Math.sqrt(leftVariance * rightVariance) : null;
}

function competition(row: Record<string, any>): Competition {
  const stored = object(row.snapshot_json).competition;
  if (stored === "fifa_world_cup" || row.model_version === "soccer_dixon_coles_v1") return "world_cup";
  if (stored === "english_premier_league" || String(row.model_version).startsWith("epl_")) return "epl";
  if (stored === "uefa_champions_league" || String(row.model_version).startsWith("ucl_")) return "ucl";
  return "unknown";
}

function actualSide(row: Record<string, any>, grade: Record<string, any>): string | null {
  const home = finite(grade.actual_home_score);
  const away = finite(grade.actual_away_score);
  if (home === null || away === null) return null;
  if (row.market === "match_result") return home > away ? "home" : away > home ? "away" : "draw";
  if (row.market === "double_chance") {
    if (row.side === "home_or_draw") return home >= away ? "home_or_draw" : "away";
    if (row.side === "away_or_draw") return away >= home ? "away_or_draw" : "home";
    if (row.side === "home_or_away") return home !== away ? "home_or_away" : "draw";
    return null;
  }
  if (row.market === "total") {
    const line = finite(row.line_value);
    if (line === null) return null;
    return home + away > line ? "over" : home + away < line ? "under" : "push";
  }
  if (row.market === "btts") return home > 0 && away > 0 ? "yes" : "no";
  return null;
}

function finalProbabilityVector(snapshot: Record<string, any>): ProbabilityVector {
  const stored = object(object(snapshot.member_projection_at_capture).goalOutlookProbabilities);
  const output: ProbabilityVector = {};
  for (const [key, value] of Object.entries(stored)) {
    const parsed = finite(value);
    if (parsed !== null) output[key] = parsed;
  }
  if (Object.keys(output).length === 0) {
    const raw = object(object(snapshot.model).raw_probabilities);
    const result = object(raw.match_result);
    const total = object(raw.total_at_canonical);
    const btts = object(raw.btts);
    for (const [key, value] of Object.entries({
      home: result.home,
      draw: result.draw,
      away: result.away,
      over25: total.over,
      under25: total.under,
      bttsYes: btts.yes,
      bttsNo: btts.no,
    })) {
      const parsed = finite(value);
      if (parsed !== null) output[key] = parsed;
    }
  }
  return output;
}

function finalVectorForMarket(snapshot: Record<string, any>, market: Market): ProbabilityVector {
  const all = finalProbabilityVector(snapshot);
  if (market === "match_result") return { home: all.home!, draw: all.draw!, away: all.away! };
  if (market === "total") return { over: all.over25!, under: all.under25! };
  if (market === "btts") return { yes: all.bttsYes!, no: all.bttsNo! };
  return {
    home_or_draw: (all.home ?? 0) + (all.draw ?? 0),
    home_or_away: (all.home ?? 0) + (all.away ?? 0),
    away_or_draw: (all.away ?? 0) + (all.draw ?? 0),
  };
}

function independentCapture(snapshot: Record<string, any>, lockedAt: unknown): Record<string, any> {
  const history = object(snapshot.epl_forward_evidence_history ?? snapshot.ucl_forward_evidence_history);
  const captures = array(history.captures);
  if (captures.length === 0) return {};
  const lockMs = isoMillis(lockedAt) ?? Number.POSITIVE_INFINITY;
  return captures
    .filter((capture) => (isoMillis(capture.capturedAt) ?? Number.POSITIVE_INFINITY) <= lockMs)
    .sort((left, right) => (isoMillis(left.capturedAt) ?? 0) - (isoMillis(right.capturedAt) ?? 0))
    .at(-1) ?? {};
}

function independentVector(snapshot: Record<string, any>, capture: Record<string, any>, market: Market): ProbabilityVector {
  const probabilities = object(object(capture.independent).probabilities);
  const fallback = finalVectorForMarket(snapshot, market);
  const home = finite(probabilities.home);
  const draw = finite(probabilities.draw);
  const away = finite(probabilities.away);
  const over = finite(probabilities.over25);
  const under = finite(probabilities.under25);
  const yes = finite(probabilities.bttsYes);
  const no = finite(probabilities.bttsNo);
  if (market === "match_result" && home !== null && draw !== null && away !== null) return { home, draw, away };
  if (market === "total" && over !== null && under !== null) return { over, under };
  if (market === "btts" && yes !== null && no !== null) return { yes, no };
  if (market === "double_chance" && home !== null && draw !== null && away !== null) {
    return { home_or_draw: home + draw, home_or_away: home + away, away_or_draw: away + draw };
  }
  return fallback;
}

function leader(vector: ProbabilityVector): string | null {
  const entries = Object.entries(vector).filter((entry): entry is [string, number] => Number.isFinite(entry[1]));
  return entries.length > 0
    ? entries.reduce((best, current) => current[1] > best[1] ? current : best)[0]
    : null;
}

function normalizedMedian(vectors: Record<string, any>[]): ProbabilityVector {
  const sides = [...new Set(vectors.flatMap((vector) => array(vector.outcomes).map((outcome) => String(outcome.side))))];
  const medians = Object.fromEntries(sides.flatMap((side) => {
    const values = vectors.flatMap((vector) => array(vector.outcomes)
      .filter((outcome) => outcome.side === side)
      .flatMap((outcome) => finite(outcome.noVigProbability) ?? finite(outcome.no_vig_probability) ?? []));
    const value = median(values);
    return value === null ? [] : [[side, value]];
  }));
  const total = Object.values(medians).reduce((sum, value) => sum + value, 0);
  return total > 0 ? Object.fromEntries(Object.entries(medians).map(([side, value]) => [side, value / total])) : {};
}

function storedPriceBoardVector(snapshot: Record<string, any>): ProbabilityVector {
  const direct = array(object(snapshot.complete_price_board).rows);
  const nested = array(object(object(snapshot.member_market_at_capture).soccerPriceBoard).rows);
  const rows = direct.length > 0 ? direct : nested;
  const output: ProbabilityVector = {};
  for (const row of rows) {
    const side = typeof row.side === "string" ? row.side : null;
    const probability = finite(row.market_probability ?? row.marketProbability);
    if (side && probability !== null) output[side] = probability;
  }
  return output;
}

function americanProbability(american: number): number {
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}

function storedMovementLeader(snapshot: Record<string, any>): { side: string | null; votes: number; opposition: number } {
  const direct = array(object(snapshot.complete_price_board).rows);
  const nested = array(object(object(snapshot.member_market_at_capture).soccerPriceBoard).rows);
  const rows = direct.length > 0 ? direct : nested;
  if (rows.length < 2) return { side: null, votes: 0, opposition: 0 };
  const deltas = rows.flatMap((row) => {
    const side = typeof row.side === "string" ? row.side : null;
    const trail = array(row.odds_trail ?? row.oddsTrail);
    const currentBook = String(snapshot.current_sportsbook ?? object(snapshot.complete_price_board).sportsbook ?? "").toLowerCase();
    const sameBook = currentBook
      ? trail.filter((stop) => String(stop.sportsbook ?? "").toLowerCase() === currentBook)
      : trail;
    const opening = sameBook.find((stop) => stop.label === "first") ?? sameBook.find((stop) => stop.label === "open") ?? sameBook[0];
    const current = [...sameBook].reverse().find((stop) => stop.label === "current") ?? sameBook.at(-1);
    const openingPrice = finite(opening?.american);
    const currentPrice = finite(current?.american) ?? finite(row.price_american ?? row.priceAmerican);
    return side && openingPrice !== null && currentPrice !== null
      ? [{ side, opening: americanProbability(openingPrice), current: americanProbability(currentPrice) }]
      : [];
  });
  if (deltas.length !== rows.length) return { side: null, votes: 0, opposition: 0 };
  const openingTotal = deltas.reduce((sum, row) => sum + row.opening, 0);
  const currentTotal = deltas.reduce((sum, row) => sum + row.current, 0);
  if (openingTotal <= 0 || currentTotal <= 0) return { side: null, votes: 0, opposition: 0 };
  const ordered = deltas.map((row) => ({ side: row.side, delta: row.current / currentTotal - row.opening / openingTotal }))
    .sort((left, right) => right.delta - left.delta);
  return ordered[0] && ordered[0].delta >= 0.005
    ? { side: ordered[0].side, votes: 1, opposition: 0 }
    : { side: null, votes: 0, opposition: 0 };
}

function legacyMarketVector(snapshot: Record<string, any>, market: Market, line: number | null): ProbabilityVector {
  const probabilities = object(object(snapshot.market).devigged_probabilities);
  const sideKeys = market === "match_result"
    ? ["home", "draw", "away"]
    : market === "double_chance"
      ? ["home_or_draw", "home_or_away", "away_or_draw"]
      : market === "total"
        ? ["over", "under"]
        : ["yes", "no"];
  return Object.fromEntries(sideKeys.flatMap((side) => {
    const key = market === "total" ? `total|${side}|${line}` : `${market}|${side}`;
    const value = finite(probabilities[key]);
    return value === null ? [] : [[side, value]];
  }));
}

function marketState(snapshot: Record<string, any>, capture: Record<string, any>, market: Market, line: number | null): Record<string, any> {
  const state = object(object(capture.markets)[market]);
  const hasCapture = Object.keys(capture).length > 0;
  const targetExcluded = array(state.targetExcluded);
  const evaluated = object(state.evaluated);
  const vectors = targetExcluded;
  const legacy = legacyMarketVector(snapshot, market, line);
  const storedBoard = storedPriceBoardVector(snapshot);
  const vector = hasCapture
    ? normalizedMedian(vectors)
    : vectors.length > 0
      ? normalizedMedian(vectors)
      : Object.keys(legacy).length > 0
        ? legacy
        : storedBoard;
  const evaluatedBook = String(evaluated.sportsbook ?? "").toLowerCase();
  const movements = array(state.movements).filter((movement) => !evaluatedBook
    || String(movement.sportsbook ?? "").toLowerCase() !== evaluatedBook);
  const movementVotes = new Map<string, number>();
  for (const movement of movements) {
    const outcomes = array(movement.outcomes);
    const strongest = outcomes
      .flatMap((outcome) => {
        const delta = finite(outcome.noVigProbabilityDelta);
        return delta === null ? [] : [{ side: String(outcome.side), delta }];
      })
      .sort((left, right) => right.delta - left.delta)[0];
    if (strongest && strongest.delta > 0) movementVotes.set(strongest.side, (movementVotes.get(strongest.side) ?? 0) + 1);
  }
  const movementLeader = [...movementVotes.entries()].sort((left, right) => right[1] - left[1])[0] ?? null;
  const storedMovement = movementLeader || hasCapture ? null : storedMovementLeader(snapshot);
  const publicEvidence = object(state.publicEvidence);
  return {
    leader: leader(vector),
    probabilities: vector,
    vectorCount: vectors.length,
    targetExcludedCount: targetExcluded.length,
    completeVectorCount: finite(state.completeVectorCount),
    namedCompleteBookCount: finite(state.namedCompleteBookCount),
    sourceClassCounts: object(state.sourceClassCounts),
    movementBooks: movements.length || storedMovement?.votes || 0,
    movementLeader: movementLeader?.[0] ?? storedMovement?.side ?? null,
    movementLeaderVotes: movementLeader?.[1] ?? storedMovement?.votes ?? 0,
    movementOppositionVotes: movementLeader
      ? [...movementVotes.entries()].filter(([side]) => side !== movementLeader[0]).reduce((sum, [, votes]) => sum + votes, 0)
      : storedMovement?.opposition ?? 0,
    publicEvidenceAvailable: Object.keys(publicEvidence).length > 0,
    unavailableReasons: object(state.unavailableReasons),
  };
}

function expectedGoals(snapshot: Record<string, any>, capture: Record<string, any>): Record<string, number | null> {
  const final = object(object(snapshot.member_projection_at_capture).expectedGoals);
  const independent = object(capture.independent);
  const legacy = object(snapshot.model);
  return {
    finalHome: finite(final.home) ?? finite(legacy.lambda_home),
    finalAway: finite(final.away) ?? finite(legacy.lambda_away),
    independentHome: finite(independent.lambdaHome) ?? finite(legacy.lambda_home),
    independentAway: finite(independent.lambdaAway) ?? finite(legacy.lambda_away),
  };
}

function blockFor(index: number, total: number): Block {
  if (index < Math.floor(total * 0.5)) return "development";
  if (index < Math.floor(total * 0.75)) return "confirmation";
  return "holdout";
}

function dataHealth(snapshot: Record<string, any>, capture: Record<string, any>): Record<string, any> {
  const independent = object(capture.independent);
  const evidence = object(independent.evidence);
  const home = object(evidence.home);
  const away = object(evidence.away);
  const captureAvailable = Object.keys(capture).length > 0;
  const samples = [finite(home.sampleMatches), finite(away.sampleMatches)].filter((value): value is number => value !== null);
  const xgSamples = [finite(home.xgMatches), finite(away.xgMatches)].filter((value): value is number => value !== null);
  const storedProjection = Object.keys(object(snapshot.member_projection_at_capture)).length > 0
    || (finite(object(snapshot.model).lambda_home) !== null && finite(object(snapshot.model).lambda_away) !== null);
  const status = !storedProjection || !captureAvailable || samples.length < 2 ? "degraded" : "healthy";
  return {
    status,
    forwardCapture: captureAvailable,
    lineupsPosted: evidence.lineupsPosted === true,
    starterCounts: [finite(home.startersPosted), finite(away.startersPosted)],
    sampleMatches: samples,
    xgMatches: xgSamples,
    injuryCounts: [finite(home.injuryCount), finite(away.injuryCount)],
    unavailableReasons: Array.isArray(independent.unavailableReasons) ? independent.unavailableReasons : [],
  };
}

function featureEvidence(capture: Record<string, any>): Record<string, any> {
  const evidence = object(object(capture.independent).evidence);
  const home = object(evidence.home);
  const away = object(evidence.away);
  const difference = (key: string) => {
    const homeValue = finite(home[key]);
    const awayValue = finite(away[key]);
    return homeValue !== null && awayValue !== null ? homeValue - awayValue : null;
  };
  const reverseDifference = (key: string) => {
    const homeValue = finite(home[key]);
    const awayValue = finite(away[key]);
    return homeValue !== null && awayValue !== null ? awayValue - homeValue : null;
  };
  const sum = (key: string) => {
    const homeValue = finite(home[key]);
    const awayValue = finite(away[key]);
    return homeValue !== null && awayValue !== null ? homeValue + awayValue : null;
  };
  return {
    home: {
      recentPoints: finite(home.recentPoints),
      avgGoalsFor: finite(home.avgGoalsFor),
      avgGoalsAgainst: finite(home.avgGoalsAgainst),
      avgXgFor: finite(home.avgXgFor),
      avgXgAgainst: finite(home.avgXgAgainst),
      avgShots: finite(home.avgShots),
      avgShotsOnTarget: finite(home.avgShotsOnTarget),
      avgBigChances: finite(home.avgBigChances),
      avgPossession: finite(home.avgPossession),
      injuryCount: finite(home.injuryCount),
      priorSeasonRank: finite(home.priorSeasonRank),
      priorSeasonGoalDifference: finite(home.priorSeasonGoalDifference),
    },
    away: {
      recentPoints: finite(away.recentPoints),
      avgGoalsFor: finite(away.avgGoalsFor),
      avgGoalsAgainst: finite(away.avgGoalsAgainst),
      avgXgFor: finite(away.avgXgFor),
      avgXgAgainst: finite(away.avgXgAgainst),
      avgShots: finite(away.avgShots),
      avgShotsOnTarget: finite(away.avgShotsOnTarget),
      avgBigChances: finite(away.avgBigChances),
      avgPossession: finite(away.avgPossession),
      injuryCount: finite(away.injuryCount),
      priorSeasonRank: finite(away.priorSeasonRank),
      priorSeasonGoalDifference: finite(away.priorSeasonGoalDifference),
    },
    homeMinusAway: {
      recentPoints: difference("recentPoints"),
      goalsFor: difference("avgGoalsFor"),
      goalsAgainst: difference("avgGoalsAgainst"),
      xgFor: difference("avgXgFor"),
      xgAgainst: difference("avgXgAgainst"),
      shots: difference("avgShots"),
      shotsOnTarget: difference("avgShotsOnTarget"),
      bigChances: difference("avgBigChances"),
      possession: difference("avgPossession"),
      priorGoalDifference: difference("priorSeasonGoalDifference"),
      // A lower prior-season rank is stronger, so reverse the subtraction.
      priorRankStrength: reverseDifference("priorSeasonRank"),
      // More listed injuries on the away side is directionally favorable to home.
      injuryAvailability: reverseDifference("injuryCount"),
    },
    totalEnvironment: {
      recentPoints: sum("recentPoints"),
      goalsFor: sum("avgGoalsFor"),
      goalsAgainst: sum("avgGoalsAgainst"),
      xgFor: sum("avgXgFor"),
      xgAgainst: sum("avgXgAgainst"),
      shots: sum("avgShots"),
      shotsOnTarget: sum("avgShotsOnTarget"),
      bigChances: sum("avgBigChances"),
      possession: sum("avgPossession"),
    },
  };
}

function featureDiagnostics(rows: Record<string, any>[]): Record<string, any> {
  const games = [...new Map(rows.filter((row) => row.market === "match_result"
      && row.actualHome !== null && row.actualAway !== null && row.captureCount > 0)
    .map((row) => [`${row.release}|${row.gameId}`, row])).values()];
  const keys = [
    "recentPoints", "goalsFor", "goalsAgainst", "xgFor", "xgAgainst", "shots",
    "shotsOnTarget", "bigChances", "possession", "priorGoalDifference",
    "priorRankStrength", "injuryAvailability",
  ];
  return {
    games: games.length,
    note: "Descriptive pre-lock feature diagnostics only; injury counts may include duplicate provider/source entries and are not a production candidate.",
    actualHomeMarginMean: round(mean(games.map((row) => row.actualHome - row.actualAway))),
    correlationsWithActualHomeMargin: Object.fromEntries(keys.map((key) => {
      const pairs = games.flatMap((row) => {
        const feature = finite(object(row.featureEvidence.homeMinusAway)[key]);
        return feature === null ? [] : [{ feature, outcome: row.actualHome - row.actualAway }];
      });
      return [key, {
        rows: pairs.length,
        correlation: round(correlation(pairs.map((pair) => pair.feature), pairs.map((pair) => pair.outcome))),
      }];
    })),
    correlationsWithActualTotal: Object.fromEntries([
      "recentPoints", "goalsFor", "goalsAgainst", "xgFor", "xgAgainst", "shots",
      "shotsOnTarget", "bigChances", "possession",
    ].map((key) => {
      const pairs = games.flatMap((row) => {
        const feature = finite(object(row.featureEvidence.totalEnvironment)[key]);
        return feature === null ? [] : [{ feature, outcome: row.actualHome + row.actualAway }];
      });
      return [key, {
        rows: pairs.length,
        correlation: round(correlation(pairs.map((pair) => pair.feature), pairs.map((pair) => pair.outcome))),
      }];
    })),
  };
}

function gradeActual(row: Record<string, any>): { home: number | null; away: number | null } {
  const grade = first(row.prediction_grades);
  return { home: finite(grade.actual_home_score), away: finite(grade.actual_away_score) };
}

function disposition(row: Record<string, any>): Record<string, any> {
  if (row.dataHealth.status === "failed") {
    return { primary: "identity_or_coverage_defect", confidence: "high", followUp: "data_repair" };
  }
  if (row.result !== "loss") return { primary: null, confidence: null, followUp: "no_change" };
  if (row.independentSide === row.actualSide && row.finalSide !== row.actualSide) {
    return { primary: "market_reader_created_harm", confidence: "high", followUp: "candidate_reader" };
  }
  if (row.marketSide === row.actualSide && row.finalSide !== row.actualSide) {
    return { primary: "market_reader_missed_opportunity", confidence: "medium", followUp: "candidate_reader" };
  }
  if (row.market === "match_result" && row.actualSide === "draw") {
    return { primary: "projection_scale_or_distribution_miss", confidence: "medium", followUp: "candidate_distribution" };
  }
  if (row.market === "total" && row.projectionErrors?.absoluteTotal !== null && row.projectionErrors.absoluteTotal >= 2) {
    return { primary: "projection_scale_or_distribution_miss", confidence: "medium", followUp: "candidate_distribution" };
  }
  if (row.market === "btts" && row.projectionErrors?.absoluteTotal !== null && row.projectionErrors.absoluteTotal >= 2) {
    return { primary: "independent_scoring_or_finishing_miss", confidence: "low", followUp: "candidate_feature" };
  }
  return { primary: "insufficient_evidence", confidence: "low", followUp: "monitor" };
}

function summarize(rows: Record<string, any>[]): Record<string, any> {
  const binary = rows.filter((row) => row.result === "win" || row.result === "loss");
  const losses = binary.filter((row) => row.result === "loss");
  const actionables = binary.filter((row) => row.actionable);
  const games = [...new Map(binary.filter((row) => row.actualHome !== null && row.actualAway !== null && row.finalHome !== null && row.finalAway !== null)
    .map((row) => [`${row.release}|${row.gameId}`, row])).values()];
  const teamErrors = games.flatMap((row) => [Math.abs(row.finalHome - row.actualHome), Math.abs(row.finalAway - row.actualAway)]);
  const totalErrors = games.map((row) => Math.abs(row.finalHome + row.finalAway - row.actualHome - row.actualAway));
  const marginErrors = games.map((row) => Math.abs(row.finalHome - row.finalAway - row.actualHome + row.actualAway));
  const predictedTeams = games.flatMap((row) => [row.finalHome, row.finalAway]);
  const actualTeams = games.flatMap((row) => [row.actualHome, row.actualAway]);
  const predictedTotals = games.map((row) => row.finalHome + row.finalAway);
  const actualTotals = games.map((row) => row.actualHome + row.actualAway);
  const predictedMargins = games.map((row) => row.finalHome - row.finalAway);
  const actualMargins = games.map((row) => row.actualHome - row.actualAway);
  return {
    rows: binary.length,
    record: `${binary.filter((row) => row.result === "win").length}-${losses.length}`,
    accuracy: round(binary.length > 0 ? (binary.length - losses.length) / binary.length : null),
    actionable: {
      rows: actionables.length,
      record: `${actionables.filter((row) => row.result === "win").length}-${actionables.filter((row) => row.result === "loss").length}`,
      accuracy: round(actionables.length > 0 ? actionables.filter((row) => row.result === "win").length / actionables.length : null),
    },
    losses: losses.length,
    dispositions: Object.fromEntries([...new Set(losses.map((row) => row.disposition.primary))].sort().map((key) => [key, losses.filter((row) => row.disposition.primary === key).length])),
    threeLayer: {
      independentCorrectFinalWrong: losses.filter((row) => row.market !== "double_chance" && row.independentSide === row.actualSide && row.finalSide !== row.actualSide).length,
      marketCorrectFinalWrong: losses.filter((row) => row.market !== "double_chance" && row.marketSide === row.actualSide && row.finalSide !== row.actualSide).length,
      movementCorrectFinalWrong: losses.filter((row) => row.market !== "double_chance" && row.marketEvidence.movementLeader === row.actualSide && row.finalSide !== row.actualSide).length,
      finalCorrectIndependentWrong: binary.filter((row) => row.market !== "double_chance" && row.finalSide === row.actualSide && row.independentSide !== row.actualSide).length,
    },
    dataHealth: Object.fromEntries(["healthy", "degraded", "failed"].map((status) => [status, binary.filter((row) => row.dataHealth.status === status).length])),
    score: {
      games: games.length,
      teamMae: round(mean(teamErrors)),
      totalMae: round(mean(totalErrors)),
      marginMae: round(mean(marginErrors)),
      teamMedianAbsoluteError: round(median(teamErrors)),
      teamP90AbsoluteError: round(percentile(teamErrors, 0.9)),
      totalP90AbsoluteError: round(percentile(totalErrors, 0.9)),
      marginP90AbsoluteError: round(percentile(marginErrors, 0.9)),
      teamCorrelation: round(correlation(predictedTeams, actualTeams)),
      totalCorrelation: round(correlation(predictedTotals, actualTotals)),
      marginCorrelation: round(correlation(predictedMargins, actualMargins)),
    },
  };
}

function blendVectors(independent: ProbabilityVector, market: ProbabilityVector, marketWeight: number): ProbabilityVector {
  const sides = Object.keys(independent).filter((side) => Number.isFinite(market[side]));
  if (sides.length === 0) return independent;
  const raw = Object.fromEntries(sides.map((side) => [
    side,
    Math.exp((1 - marketWeight) * Math.log(Math.max(1e-8, independent[side]!))
      + marketWeight * Math.log(Math.max(1e-8, market[side]!))),
  ]));
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(raw).map(([side, value]) => [side, value / total]));
}

function candidateSide(row: Record<string, any>, candidate: string): string | null {
  if (row.market === "double_chance") return row.finalSide;
  if (candidate === "incumbent") return row.finalSide;
  if (candidate === "independent_only") return row.independentSide ?? row.finalSide;
  if (candidate === "stored_market_only") return row.marketSide ?? row.finalSide;
  if (candidate === "stored_movement_only") return row.marketEvidence.movementLeader ?? row.finalSide;
  if (candidate.startsWith("log_pool_")) {
    const weight = Number(candidate.replace("log_pool_", "")) / 100;
    return leader(blendVectors(row.independentProbabilities, row.marketEvidence.probabilities, weight)) ?? row.finalSide;
  }
  if (candidate === "corroborated_market_sequence") {
    const qualified = row.marketSide !== null
      && row.marketSide === row.marketEvidence.movementLeader
      && row.marketEvidence.vectorCount >= 2
      && row.marketEvidence.movementLeaderVotes >= 2
      && row.marketEvidence.movementOppositionVotes === 0;
    return qualified ? row.marketSide : row.independentSide ?? row.finalSide;
  }
  return row.finalSide;
}

function candidateMetrics(rows: Record<string, any>[], candidate: string): Record<string, any> {
  const eligible = rows.filter((row) => row.market !== "double_chance"
    && (row.result === "win" || row.result === "loss")
    && row.actualSide !== null);
  const evaluated: Array<Record<string, any> & {
    candidateSide: string | null;
    incumbentCorrect: boolean;
  }> = eligible.map((row) => ({
    ...row,
    candidateSide: candidateSide(row, candidate),
    incumbentCorrect: row.finalSide === row.actualSide,
  }));
  const candidateCorrect = evaluated.filter((row) => row.candidateSide === row.actualSide).length;
  return {
    rows: evaluated.length,
    record: `${candidateCorrect}-${evaluated.length - candidateCorrect}`,
    accuracy: round(evaluated.length > 0 ? candidateCorrect / evaluated.length : null),
    sideChanges: evaluated.filter((row) => row.candidateSide !== row.finalSide).length,
    corrections: evaluated.filter((row) => !row.incumbentCorrect && row.candidateSide === row.actualSide).length,
    harms: evaluated.filter((row) => row.incumbentCorrect && row.candidateSide !== row.actualSide).length,
    netCorrections: evaluated.filter((row) => !row.incumbentCorrect && row.candidateSide === row.actualSide).length
      - evaluated.filter((row) => row.incumbentCorrect && row.candidateSide !== row.actualSide).length,
  };
}

function candidateTournament(rows: Record<string, any>[]): Record<string, any> {
  const candidates = [
    "incumbent",
    "independent_only",
    "stored_market_only",
    "stored_movement_only",
    "log_pool_15",
    "log_pool_30",
    "log_pool_50",
    "corroborated_market_sequence",
  ];
  return Object.fromEntries(candidates.map((candidate) => [candidate, {
    pooled: candidateMetrics(rows, candidate),
    byBlock: Object.fromEntries((["development", "confirmation", "holdout"] as Block[])
      .map((block) => [block, candidateMetrics(rows.filter((row) => row.block === block), candidate)])),
    byMarket: Object.fromEntries((["match_result", "total", "btts"] as Market[])
      .map((market) => [market, candidateMetrics(rows.filter((row) => row.market === market), candidate)])),
  }]));
}

async function main(): Promise<void> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await client.from("prediction_records")
    .select("id,game_id,slate_date,matchup,market,pick,side,line_value,odds_american,model_probability,market_probability,edge,play_grade,no_bet,held,model_version,calibration_version,locked_at,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score,actual_total)")
    .eq("sport", "soccer")
    .not("locked_at", "is", null)
    .order("slate_date", { ascending: true })
    .limit(5_000);
  if (error) throw error;

  const captureByCohort = new Map<string, Record<string, any>>();
  for (const raw of data ?? []) {
    const snapshot = object(raw.snapshot_json);
    const capture = independentCapture(snapshot, raw.locked_at);
    if (Object.keys(capture).length > 0) {
      captureByCohort.set(`${raw.game_id}|${raw.model_version}|${raw.calibration_version}`, capture);
    }
  }
  const provisional = (data ?? []).flatMap((raw: Record<string, any>) => {
    if (!MARKETS.has(raw.market as Market)) return [];
    const grade = first(raw.prediction_grades);
    const result = String(grade.result ?? "").toLowerCase() as Result;
    if (!(result === "win" || result === "loss" || result === "push" || result === "void")) return [];
    const snapshot = object(raw.snapshot_json);
    const market = raw.market as Market;
    const ownCapture = independentCapture(snapshot, raw.locked_at);
    const capture = Object.keys(ownCapture).length > 0
      ? ownCapture
      : captureByCohort.get(`${raw.game_id}|${raw.model_version}|${raw.calibration_version}`) ?? {};
    const independent = independentVector(snapshot, capture, market);
    const final = finalVectorForMarket(snapshot, market);
    const marketEvidence = marketState(snapshot, capture, market, finite(raw.line_value));
    const scores = expectedGoals(snapshot, capture);
    const actual = gradeActual(raw);
    const actualMarketSide = actualSide(raw, grade);
    const data = dataHealth(snapshot, capture);
    const finalTotal = scores.finalHome !== null && scores.finalAway !== null ? scores.finalHome + scores.finalAway : null;
    const actualTotal = actual.home !== null && actual.away !== null ? actual.home + actual.away : null;
    const finalMargin = scores.finalHome !== null && scores.finalAway !== null ? scores.finalHome - scores.finalAway : null;
    const actualMargin = actual.home !== null && actual.away !== null ? actual.home - actual.away : null;
    return [{
      id: raw.id,
      gameId: raw.game_id,
      date: raw.slate_date,
      lockedAt: raw.locked_at,
      competition: competition(raw),
      matchup: raw.matchup,
      market,
      release: raw.model_version,
      calibration: raw.calibration_version,
      line: finite(raw.line_value),
      price: finite(raw.odds_american),
      grade: raw.play_grade,
      actionable: raw.no_bet !== true && raw.held !== true && ACTIONABLE.has(raw.play_grade),
      held: raw.held === true,
      noBet: raw.no_bet === true,
      result,
      actualSide: actualMarketSide,
      actualHome: actual.home,
      actualAway: actual.away,
      independentSide: leader(independent),
      independentProbabilities: independent,
      finalSide: raw.side ?? leader(final),
      finalProbabilities: final,
      marketSide: marketEvidence.leader,
      marketEvidence,
      readerSource: object(snapshot.model_provenance).source ?? null,
      readerTargetExcludedBooks: object(snapshot.model_provenance).targetExcludedBooks ?? [],
      finalHome: scores.finalHome,
      finalAway: scores.finalAway,
      independentHome: scores.independentHome,
      independentAway: scores.independentAway,
      projectionErrors: {
        signedTotal: finalTotal !== null && actualTotal !== null ? finalTotal - actualTotal : null,
        absoluteTotal: finalTotal !== null && actualTotal !== null ? Math.abs(finalTotal - actualTotal) : null,
        signedMargin: finalMargin !== null && actualMargin !== null ? finalMargin - actualMargin : null,
        absoluteMargin: finalMargin !== null && actualMargin !== null ? Math.abs(finalMargin - actualMargin) : null,
      },
      dataHealth: data,
      featureEvidence: featureEvidence(capture),
      captureAt: capture.capturedAt ?? null,
      captureCount: Object.keys(capture).length > 0
        ? Math.max(1, array(object(snapshot.epl_forward_evidence_history ?? snapshot.ucl_forward_evidence_history).captures).length)
        : 0,
    }];
  });

  const gameOrder = [...new Map(provisional.map((row) => [`${row.competition}|${row.gameId}`, row])).values()]
    .sort((left, right) => String(left.date).localeCompare(String(right.date)) || String(left.gameId).localeCompare(String(right.gameId)));
  const blocks = new Map<string, Block>();
  for (const name of ["world_cup", "epl", "ucl"] as Competition[]) {
    const games = gameOrder.filter((row) => row.competition === name);
    games.forEach((row, index) => blocks.set(`${name}|${row.gameId}`, blockFor(index, games.length)));
  }
  const rows = provisional.map((row) => ({
    ...row,
    block: blocks.get(`${row.competition}|${row.gameId}`) ?? "development",
    disposition: disposition(row),
  }));

  for (const row of rows) {
    if (row.result !== "loss") continue;
    const matchedWins = rows.filter((candidate) => candidate.result === "win"
      && candidate.competition === row.competition
      && candidate.market === row.market
      && candidate.release === row.release
      && candidate.grade === row.grade
      && candidate.dataHealth.status === row.dataHealth.status
      && candidate.marketEvidence.vectorCount === row.marketEvidence.vectorCount);
    (row as any).matchedWinCount = matchedWins.length;
    (row as any).matchedWinIds = matchedWins.map((candidate) => candidate.id);
  }

  const competitions = ["world_cup", "epl", "ucl"] as Competition[];
  const requestedRelease = process.env.SOCCER_LEDGER_RELEASE;
  const requestedCompetition = process.env.SOCCER_LEDGER_COMPETITION as Competition | undefined;
  const requestedRows = rows.filter((row) => (!requestedCompetition || row.competition === requestedCompetition)
    && (!requestedRelease || row.release === requestedRelease)
    && (process.env.SOCCER_LEDGER_FORWARD_ONLY !== "1" || row.captureCount > 0));
  const summary = Object.fromEntries(competitions.map((name) => {
    const scope = rows.filter((row) => row.competition === name
      && row.held !== true
      && row.result !== "void"
      && (!requestedRelease || row.release === requestedRelease)
      && (process.env.SOCCER_LEDGER_FORWARD_ONLY !== "1" || row.captureCount > 0));
    return [name, {
      overall: summarize(scope),
      byBlock: Object.fromEntries((["development", "confirmation", "holdout"] as Block[]).map((block) => [block, summarize(scope.filter((row) => row.block === block))])),
      byMarket: Object.fromEntries([...MARKETS].map((market) => [market, summarize(scope.filter((row) => row.market === market))])),
      byRelease: Object.fromEntries([...new Set(scope.map((row) => row.release))].sort().map((release) => [release, summarize(scope.filter((row) => row.release === release))])),
      featureDiagnostics: featureDiagnostics(scope),
      candidateTournament: candidateTournament(scope),
    }];
  }));

  const output = {
    mode: "read_only_zero_write_zero_provider_calls",
    contract: "soccer_exhaustive_loss_ledger_2026_10_13_r1",
    caveats: [
      "Postgame process statistics beyond the regulation score are not stored in every lock; those rows remain insufficient_evidence rather than being mislabeled variance.",
      "World Cup legacy locks do not contain the later EPL/UCL forward-evidence schema, so their independent/reader separation is degraded.",
      "The ledger is descriptive. A production candidate still requires a frozen chronological tournament and all model-change gates.",
    ],
    counts: {
      rows: rows.length,
      losses: rows.filter((row) => row.result === "loss").length,
      excluded: (data ?? []).length - rows.length,
    },
    summary,
    lossLedger: process.env.SOCCER_LEDGER_SUMMARY_ONLY === "1" ? undefined : requestedRows.filter((row) => row.result === "loss"),
  };
  if (process.env.SOCCER_LEDGER_TOURNAMENT_ONLY === "1") {
    const requested = process.env.SOCCER_LEDGER_COMPETITION as Competition | undefined;
    const selectedCompetitions = requested && competitions.includes(requested) ? [requested] : competitions;
    console.log(JSON.stringify({
      mode: output.mode,
      counts: output.counts,
      competitions: Object.fromEntries(selectedCompetitions.map((name) => [name, {
        overall: summary[name].overall,
        featureDiagnostics: summary[name].featureDiagnostics,
        candidateTournament: summary[name].candidateTournament,
      }])),
    }, null, 2));
    return;
  }
  console.log(JSON.stringify(output, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
