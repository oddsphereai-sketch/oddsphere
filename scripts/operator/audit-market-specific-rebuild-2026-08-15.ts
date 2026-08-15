/**
 * READ ONLY. Fresh market-specific rebuild audit pre-registered in
 * docs/model-audits/2026-08-15-raw-side-champion-contract.md.
 *
 * This program intentionally does not import prior research candidates or
 * thresholds. It reads immutable locked prediction records, reconstructs only
 * point-in-time features retained on those rows, fits a small predeclared set
 * of regularized candidates, and reports evidence. It never writes to the DB.
 */

import { supabase } from "../../lib/db/supabase";

type Json = Record<string, unknown>;
type Sport = "mlb" | "wnba";
type Market = "moneyline" | "total" | "first_inning" | "spread";
type Partition = "development" | "calibration" | "validation" | "final";

type RawRecord = Json & {
  id: number;
  sport: Sport;
  slate_date: string;
  game_id: number;
  market: Market;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  model_probability: number | null;
  market_probability: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  held: boolean | null;
  launch_day: boolean | null;
  locked_at: string | null;
  model_version: string | null;
  calibration_version: string | null;
  snapshot_json: Json | null;
  prediction_grades: Json | Json[] | null;
};

type Observation = {
  id: number;
  sport: Sport;
  market: Market;
  date: string;
  gameId: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
  actualHomeScore: number | null;
  actualAwayScore: number | null;
  actualTotal: number | null;
  side: string;
  result: "win" | "loss";
  outcome: number;
  odds: number | null;
  oppositeOdds: number | null;
  breakEven: number | null;
  pCurrent: number | null;
  pIndependent: number | null;
  pMarket: number | null;
  signedProjectionEdge: number | null;
  pairedMovement: number | null;
  tickets: number | null;
  moneyTicketGap: number | null;
  bookCount: number | null;
  currentActionable: boolean;
  noBet: boolean;
  modelVersion: string;
  calibrationVersion: string;
  decisionRelease: string;
  oppositeLockedPriceAvailable: boolean;
  modelInputs: Record<string, number | null>;
  partition: Partition;
};

type FittedLogistic = {
  means: number[];
  scales: number[];
  weights: number[];
  lambda: number;
};

type FittedLinear = { means: number[]; scales: number[]; weights: number[]; lambda: number };
type ScoreProjectionModel = {
  market: "moneyline" | "total";
  home: FittedLinear | null;
  away: FittedLinear | null;
  total: FittedLinear | null;
  calibration: { intercept: number; slope: number };
  lambda: number;
};
type ResidualProjectionModel = {
  market: "moneyline" | "total";
  residual: FittedLinear;
  calibration: { intercept: number; slope: number };
  lambda: number;
};
type MarketAnchoredMarginModel = {
  marketIntercept: number;
  marketSlope: number;
  residual: FittedLinear;
  calibration: { intercept: number; slope: number };
  lambda: number;
};
type RuntimeTotalResidualModel = {
  residual: FittedLinear;
  calibration: { intercept: number; slope: number };
  lambda: number;
};

type Prediction = { row: Observation; probability: number };

type Metrics = {
  rows: number;
  dates: number;
  games: number;
  record: string;
  accuracyPct: number | null;
  meanProbabilityPct: number | null;
  calibrationGapPp: number | null;
  brier: number | null;
  logLoss: number | null;
  priced: number;
  units: number;
  roiPct: number | null;
};

const PAGE = 500;
const EPS = 1e-6;
const LAMBDAS = [0.01, 0.1, 1, 10] as const;
const ACTION_MARGINS = [0, 0.01, 0.02, 0.03, 0.05] as const;
const BOOTSTRAP_DRAWS = 5000;
const PROBABILITY_FAMILIES = [
  "market_consensus",
  "recalibrated_incumbent",
  "symmetric_recalibration",
  "adaptive_symmetric_recalibration",
  "model_market_stack",
  "current_market_stack",
  "projection_edge",
  "symmetric_projection_edge",
  "projection_market_stack",
  "price_calibration_stack",
  "price_calibration_stack_side_floor",
  "market_context_stack",
  "production_stack",
  "mlb_canonical_market_model_stack",
  "mlb_moneyline_baseball_stack",
  "mlb_total_baseball_stack",
  "mlb_moneyline_guarded_regime",
  "mlb_total_guarded_regime",
  "mlb_revert_final_side_change",
  "mlb_market_opposition_flip",
  "mlb_strong_market_opposition_flip",
  "mlb_very_strong_market_opposition_flip",
  "mlb_extreme_market_opposition_flip",
  "mlb_away_market_40_45_flip",
  "mlb_market_projection_opposition_flip",
  "mlb_structural_flip_selector",
  "mlb_moneyline_form_stack",
  "mlb_total_form_stack",
  "mlb_total_always_under",
  "mlb_total_always_over",
  "mlb_score_projection_rebuild",
  "mlb_direct_residual_projection",
  "mlb_moneyline_projection_market_guard",
  "mlb_market_anchored_margin_projection",
  "mlb_moneyline_market_disagreement_resolver",
  "mlb_runtime_total_residual_projection",
] as const;

function object(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Json
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function nested(root: Json | null, ...path: string[]): unknown {
  let value: unknown = root;
  for (const key of path) {
    const current = object(value);
    if (current === null) return null;
    value = current[key];
  }
  return value;
}

function clampProbability(value: number): number {
  return Math.max(EPS, Math.min(1 - EPS, value));
}

function normalizePercentage(value: number | null): number | null {
  if (value === null) return null;
  if (value >= 0 && value <= 1) return value;
  if (value > 1 && value <= 100) return value / 100;
  return null;
}

function logit(value: number): number {
  const p = clampProbability(value);
  return Math.log(p / (1 - p));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function breakEvenProbability(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function profit(result: Observation["result"], odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  if (result === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function gradeRelation(row: RawRecord): Json | null {
  if (Array.isArray(row.prediction_grades)) return object(row.prediction_grades[0]);
  return object(row.prediction_grades);
}

function canonicalSide(row: RawRecord): string | null {
  const side = text(row.side)?.toLowerCase();
  if (side) return side;
  const pick = text(row.pick)?.toLowerCase() ?? "";
  if (pick.startsWith("nrfi")) return "nrfi";
  if (pick.startsWith("yrfi")) return "yrfi";
  if (pick.startsWith("over")) return "over";
  if (pick.startsWith("under")) return "under";
  return null;
}

function selectedProbabilityForSide(
  side: string,
  homeOrFirst: number | null,
  awayOrSecond: number | null,
): number | null {
  if (homeOrFirst === null || awayOrSecond === null) return null;
  if (side === "home" || side === "nrfi" || side === "under") return homeOrFirst;
  if (side === "away" || side === "yrfi" || side === "over") return awayOrSecond;
  return null;
}

function decisionRelease(snapshot: Json | null): string {
  return text(nested(snapshot, "decision_pipeline", "release_id"))
    ?? text(nested(snapshot, "decision_pipeline", "decision_release_id"))
    ?? text(nested(snapshot, "model_layer_versions", "decision_release_id"))
    ?? "missing";
}

function sameOutcome(rawSide: unknown, selectedSide: string): boolean {
  const value = text(rawSide)?.toLowerCase();
  if (!value) return false;
  if (selectedSide === "nrfi") return value === "under" || value === "nrfi";
  if (selectedSide === "yrfi") return value === "over" || value === "yrfi";
  return value === selectedSide;
}

function oppositeSide(side: string): string | null {
  if (side === "home") return "away";
  if (side === "away") return "home";
  if (side === "over") return "under";
  if (side === "under") return "over";
  if (side === "yrfi") return "nrfi";
  if (side === "nrfi") return "yrfi";
  return null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

type LinePoint = {
  sportsbook: string;
  at: string;
  line: number | null;
  side: string;
  odds: number;
};

function linePoints(snapshot: Json | null, market: Market): LinePoint[] {
  const expectedMarket = market === "first_inning" ? "first_inning_total" : market;
  return array(snapshot?.lines_at_lock).flatMap((value) => {
    const row = object(value);
    const odds = finite(row?.odds_american);
    const sportsbook = text(row?.sportsbook)?.toLowerCase();
    const at = text(row?.fetched_at);
    const side = text(row?.side)?.toLowerCase();
    if (row?.market_type !== expectedMarket || odds === null || !sportsbook || !at || !side) return [];
    return [{ sportsbook, at, line: finite(row.line_value), side, odds }];
  });
}

function pairedMarketEvidence(
  snapshot: Json | null,
  market: Market,
  selectedSide: string,
): { marketProbability: number | null; movement: number | null; oppositeOdds: number | null } {
  const points = linePoints(snapshot, market);
  const wanted = selectedSide === "nrfi" ? "under" : selectedSide === "yrfi" ? "over" : selectedSide;
  const opposite = oppositeSide(selectedSide);
  if (!opposite) return { marketProbability: null, movement: null, oppositeOdds: null };
  const wantedOpposite = opposite === "nrfi" ? "under" : opposite === "yrfi" ? "over" : opposite;
  const buckets = new Map<string, LinePoint[]>();
  for (const point of points) {
    const lineKey = point.line === null ? "null" : String(Math.abs(point.line));
    const key = `${point.sportsbook}|${point.at}|${lineKey}`;
    const current = buckets.get(key) ?? [];
    current.push(point);
    buckets.set(key, current);
  }
  const paths = new Map<string, Array<{ at: string; probability: number; oppositeOdds: number }>>();
  for (const bucket of buckets.values()) {
    const selected = bucket.find((point) => point.side === wanted);
    const other = bucket.find((point) => point.side === wantedOpposite);
    if (!selected || !other) continue;
    const rawSelected = breakEvenProbability(selected.odds);
    const rawOther = breakEvenProbability(other.odds);
    if (rawSelected === null || rawOther === null) continue;
    const probability = rawSelected / (rawSelected + rawOther);
    const path = paths.get(selected.sportsbook) ?? [];
    path.push({ at: selected.at, probability, oppositeOdds: other.odds });
    paths.set(selected.sportsbook, path);
  }
  const currentProbabilities: number[] = [];
  const currentOppositeOdds: number[] = [];
  const movements: number[] = [];
  for (const path of paths.values()) {
    path.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    currentProbabilities.push(path[path.length - 1].probability);
    currentOppositeOdds.push(path[path.length - 1].oppositeOdds);
    if (path.length > 1) movements.push(path[path.length - 1].probability - path[0].probability);
  }
  const pairedSnapshot = object(snapshot?.paired_market_snapshot);
  const snapshotSide = text(pairedSnapshot?.selected_side)?.toLowerCase();
  const snapshotMatches = snapshotSide !== null && sameOutcome(snapshotSide, selectedSide);
  const snapshotProbability = snapshotMatches
    ? normalizePercentage(finite(pairedSnapshot?.selected_no_vig_probability))
    : null;
  const snapshotOppositeOdds = snapshotMatches ? finite(pairedSnapshot?.opposite_odds_american) : null;
  const fi = object(snapshot?.fi_v2_audit);
  const autoFactors = object(snapshot?.auto_factors);
  const fiOppositeOdds = market !== "first_inning" ? null
    : selectedSide === "under" || selectedSide === "nrfi"
      ? finite(fi?.market_yrfi_odds_american) ?? finite(autoFactors?.market_yrfi_odds_american)
      : finite(fi?.market_nrfi_odds_american) ?? finite(autoFactors?.market_nrfi_odds_american);
  const lockedMovement = object(snapshot?.line_movement);
  const movementMarketMatches = text(lockedMovement?.market)?.toLowerCase() === market;
  const movementSideMatches = sameOutcome(lockedMovement?.picked_side, selectedSide);
  const currentImplied = finite(lockedMovement?.current_implied_prob);
  const openImplied = finite(lockedMovement?.open_implied_prob);
  const frozenMovement = movementMarketMatches && movementSideMatches
    && currentImplied !== null && openImplied !== null
    ? currentImplied - openImplied
    : null;
  return {
    marketProbability: median(currentProbabilities) ?? snapshotProbability,
    movement: median(movements) ?? frozenMovement,
    oppositeOdds: median(currentOppositeOdds) ?? snapshotOppositeOdds ?? fiOppositeOdds,
  };
}

function latestSplitContext(snapshot: Json | null, market: Market, selectedSide: string): {
  tickets: number | null;
  gap: number | null;
} {
  const candidates: Array<{ at: number; tickets: number; money: number }> = [];
  for (const value of array(snapshot?.source_aware_split_rows_at_lock)) {
    const row = object(value);
    if (!row) continue;
    if (text(row.market_type)?.toLowerCase() !== market) continue;
    const rawSide = row.side ?? row.selection ?? row.selection_key ?? row.pick;
    const selection = text(rawSide);
    const side = selection?.includes(":") ? selection.split(":").at(-1) : selection;
    if (!sameOutcome(side, selectedSide)) continue;
    const tickets = normalizePercentage(
      finite(row.tickets_pct) ?? finite(row.bets_pct) ?? finite(row.public_bet_pct) ?? finite(row.bet_percentage),
    );
    const money = normalizePercentage(
      finite(row.money_pct) ?? finite(row.handle_pct) ?? finite(row.public_money_pct) ?? finite(row.money_percentage),
    );
    const atText = text(row.recorded_at) ?? text(row.source_observed_at) ?? text(row.fetched_at);
    const at = atText ? Date.parse(atText) : Number.NaN;
    if (tickets !== null && money !== null && Number.isFinite(at)) candidates.push({ at, tickets, money });
  }
  candidates.sort((a, b) => b.at - a.at);
  const latest = candidates[0];
  return latest
    ? { tickets: latest.tickets, gap: latest.money - latest.tickets }
    : { tickets: null, gap: null };
}

function wnbaPublicContext(snapshot: Json | null, market: Market): {
  tickets: number | null;
  gap: number | null;
} {
  const context = object(nested(snapshot, "public_market_context", market));
  const tickets = normalizePercentage(finite(context?.pickedBetsPct));
  const money = normalizePercentage(finite(context?.pickedMoneyPct));
  return { tickets, gap: tickets !== null && money !== null ? money - tickets : null };
}

function extractProbabilities(row: RawRecord, side: string): {
  current: number | null;
  independent: number | null;
  market: number | null;
  projectionEdge: number | null;
  bookCount: number | null;
} {
  const snapshot = row.snapshot_json;
  const v22 = object(snapshot?.v2_2_audit);
  const fi = object(snapshot?.fi_v2_audit);
  const wnbaCalibration = object(snapshot?.wnba_core_model_calibration);
  const wnbaModel = object(snapshot?.model);
  const wnbaComponents = object(wnbaModel?.components);
  const marketConsensus = object(snapshot?.market_consensus);
  if (row.sport === "mlb" && row.market === "moneyline") {
    return {
      current: finite(row.model_probability) ?? finite(v22?.ml_model_prob),
      independent: finite(v22?.ml_raw_model_prob),
      market: finite(row.market_probability) ?? finite(v22?.ml_market_prob),
      projectionEdge: finite(v22?.independent_home_diff) !== null
        ? (side === "home" ? 1 : -1) * finite(v22?.independent_home_diff)!
        : null,
      bookCount: null,
    };
  }
  if (row.sport === "mlb" && row.market === "total") {
    const independentTotal = finite(v22?.independent_total);
    const line = finite(row.line_value) ?? finite(v22?.market_total);
    return {
      current: finite(row.model_probability) ?? finite(v22?.ou_model_prob),
      independent: finite(v22?.ou_raw_model_prob),
      market: finite(row.market_probability) ?? finite(v22?.ou_market_prob),
      projectionEdge: independentTotal !== null && line !== null
        ? (side === "over" ? 1 : -1) * (independentTotal - line)
        : null,
      bookCount: finite(v22?.total_line_agreement_count),
    };
  }
  if (row.sport === "mlb" && row.market === "first_inning") {
    const independent = selectedProbabilityForSide(
      side,
      finite(fi?.independent_p_nrfi),
      finite(fi?.independent_p_yrfi),
    );
    const market = selectedProbabilityForSide(
      side,
      finite(fi?.market_nrfi_no_vig),
      finite(fi?.market_yrfi_no_vig),
    );
    return {
      current: finite(row.model_probability) ?? selectedProbabilityForSide(
        side,
        finite(fi?.posterior_p_nrfi),
        finite(fi?.posterior_p_yrfi),
      ),
      independent,
      market,
      projectionEdge: independent !== null && market !== null ? independent - market : null,
      bookCount: null,
    };
  }
  if (row.sport === "wnba" && row.market === "moneyline") {
    return {
      current: finite(row.model_probability)
        ?? finite(nested(snapshot, "moneyline_probability_contract", "final_picked_probability"))
        ?? finite(wnbaComponents?.moneyline_final_picked_probability),
      independent: finite(nested(snapshot, "moneyline_probability_contract", "independent_picked_probability")),
      market: finite(wnbaComponents?.moneyline_market_picked_probability),
      projectionEdge: finite(wnbaComponents?.moneyline_final_edge_pp) !== null
        ? finite(wnbaComponents?.moneyline_final_edge_pp)! / 100
        : null,
      bookCount: finite(marketConsensus?.book_count),
    };
  }
  if (row.sport === "wnba" && row.market === "total") {
    const rawTotal = finite(wnbaCalibration?.raw_projected_total) ?? finite(wnbaModel?.total);
    const line = finite(row.line_value) ?? finite(wnbaCalibration?.market_total);
    return {
      current: finite(row.model_probability),
      independent: null,
      market: null,
      projectionEdge: rawTotal !== null && line !== null
        ? (side === "over" ? 1 : -1) * (rawTotal - line)
        : null,
      bookCount: finite(nested(snapshot, "data_quality", "total_books")),
    };
  }
  const homeMargin = finite(wnbaCalibration?.recommendation_home_margin_used)
    ?? finite(wnbaModel?.margin);
  const selectedProjectedMargin = homeMargin === null ? null : (side === "home" ? homeMargin : -homeMargin);
  return {
    current: finite(row.model_probability),
    independent: null,
    market: null,
    projectionEdge: selectedProjectedMargin !== null && finite(row.line_value) !== null
      ? selectedProjectedMargin + finite(row.line_value)!
      : null,
    bookCount: finite(nested(snapshot, "data_quality", "spread_books")),
  };
}

function partitionDates(dates: string[]): Map<string, Partition> {
  const unique = [...new Set(dates)].sort();
  const n = unique.length;
  const developmentEnd = Math.max(1, Math.floor(n * 0.55));
  const calibrationEnd = Math.max(developmentEnd + 1, Math.floor(n * 0.70));
  const validationEnd = Math.max(calibrationEnd + 1, Math.floor(n * 0.85));
  return new Map(unique.map((date, index) => [
    date,
    index < developmentEnd ? "development"
      : index < calibrationEnd ? "calibration"
      : index < validationEnd ? "validation"
      : "final",
  ]));
}

function retainedModelInputs(snapshot: Json | null): Record<string, number | null> {
  const v22 = object(snapshot?.v2_2_audit);
  const auto = object(snapshot?.auto_factors);
  const decision = object(snapshot?.decision_pipeline);
  return {
    independentHomeDiff: finite(v22?.independent_home_diff),
    posteriorHomeDiff: finite(v22?.posterior_home_diff),
    independentHomeRuns: finite(v22?.independent_home_runs),
    independentAwayRuns: finite(v22?.independent_away_runs),
    posteriorHomeRuns: finite(v22?.posterior_home_runs),
    posteriorAwayRuns: finite(v22?.posterior_away_runs),
    independentTotal: finite(v22?.independent_total),
    posteriorTotal: finite(v22?.posterior_total),
    marketTotal: finite(v22?.market_total),
    homeStarterEra: finite(auto?.home_starter_era),
    awayStarterEra: finite(auto?.away_starter_era),
    homeStarterWorkload: finite(v22?.home_starter_workload),
    awayStarterWorkload: finite(v22?.away_starter_workload),
    homeBullpenFactor: finite(auto?.home_bullpen_factor),
    awayBullpenFactor: finite(auto?.away_bullpen_factor),
    homeTopOrderOps: finite(auto?.home_top_order_ops),
    awayTopOrderOps: finite(auto?.away_top_order_ops),
    homeLineupWeightedOps: finite(auto?.home_lineup_weighted_ops),
    awayLineupWeightedOps: finite(auto?.away_lineup_weighted_ops),
    parkFactorRuns: finite(auto?.park_factor_runs),
    weatherTotalAdjust: finite(auto?.weather_total_adjust),
    leagueAverageEra: finite(auto?.league_avg_era_used),
    leagueAverageOps: finite(auto?.league_avg_ops_used),
    featurePresentCount: finite(v22?.feature_present_count),
    featureMissingCount: finite(v22?.feature_missing_count),
    finalSideChanged: decision?.final_side_changed === true ? 1 : 0,
    inversionTriggered: decision?.inversion_triggered === true ? 1 : 0,
    marketAwareCorrectionApplied: decision?.market_aware_correction_applied === true ? 1 : 0,
    correctionTriggered: decision?.correction_triggered === true ? 1 : 0,
  };
}

type GameContext = {
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  totalRuns: number | null;
};

function toObservation(
  row: RawRecord,
  partition: Partition,
  gameContext: GameContext | null,
): Observation | null {
  const grade = gradeRelation(row);
  const result = text(grade?.result)?.toLowerCase();
  if (result !== "win" && result !== "loss") return null;
  const side = canonicalSide(row);
  if (!side || row.locked_at === null || row.launch_day === true || row.held === true) return null;
  const extracted = extractProbabilities(row, side);
  const paired = pairedMarketEvidence(row.snapshot_json, row.market, side);
  const splits = row.sport === "wnba"
    ? wnbaPublicContext(row.snapshot_json, row.market)
    : latestSplitContext(row.snapshot_json, row.market, side);
  const gradeName = row.best_angle === true
    ? "best_angle"
    : (text(row.play_grade)?.toLowerCase().replaceAll(" ", "_") ?? "");
  return {
    id: row.id,
    sport: row.sport,
    market: row.market,
    date: row.slate_date,
    gameId: row.game_id,
    homeTeamId: gameContext?.homeTeamId ?? null,
    awayTeamId: gameContext?.awayTeamId ?? null,
    actualHomeScore: gameContext?.homeScore ?? null,
    actualAwayScore: gameContext?.awayScore ?? null,
    actualTotal: gameContext?.totalRuns
      ?? (gameContext?.homeScore !== null && gameContext?.homeScore !== undefined
        && gameContext.awayScore !== null && gameContext.awayScore !== undefined
        ? gameContext.homeScore + gameContext.awayScore
        : null),
    side,
    result,
    outcome: result === "win" ? 1 : 0,
    odds: finite(row.odds_american),
    oppositeOdds: paired.oppositeOdds,
    breakEven: breakEvenProbability(finite(row.odds_american)),
    pCurrent: extracted.current,
    pIndependent: extracted.independent,
    pMarket: extracted.market ?? paired.marketProbability,
    signedProjectionEdge: extracted.projectionEdge,
    pairedMovement: paired.movement,
    tickets: splits.tickets,
    moneyTicketGap: splits.gap,
    bookCount: extracted.bookCount,
    currentActionable: row.no_bet !== true && (gradeName === "lean" || gradeName === "best_angle"),
    noBet: row.no_bet === true,
    modelVersion: row.model_version ?? "missing",
    calibrationVersion: row.calibration_version ?? "missing",
    decisionRelease: decisionRelease(row.snapshot_json),
    oppositeLockedPriceAvailable: paired.oppositeOdds !== null,
    modelInputs: retainedModelInputs(row.snapshot_json),
    partition,
  };
}

async function loadRaw(sport: Sport, market: Market): Promise<RawRecord[]> {
  const rows: RawRecord[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select([
        "id", "sport", "slate_date", "game_id", "market", "pick", "side",
        "line_value", "odds_american", "model_probability", "market_probability",
        "play_grade", "best_angle", "no_bet", "held", "launch_day", "locked_at",
        "model_version", "calibration_version", "snapshot_json", "prediction_grades(result)",
      ].join(","))
      .eq("sport", sport)
      .eq("market", market)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${sport}:${market}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as RawRecord[]));
    if ((data ?? []).length < PAGE) return rows;
  }
}

async function loadGameContexts(gameIds: number[]): Promise<Map<number, GameContext>> {
  const contexts = new Map<number, GameContext>();
  const unique = [...new Set(gameIds)];
  for (let index = 0; index < unique.length; index += 200) {
    const ids = unique.slice(index, index + 200);
    const { data, error } = await supabase
      .from("games")
      .select("id,home_team_id,away_team_id,home_score,away_score,total_runs")
      .in("id", ids);
    if (error) throw new Error(`games: ${error.message}`);
    for (const raw of data ?? []) {
      const row = raw as {
        id: number;
        home_team_id: number | null;
        away_team_id: number | null;
        home_score: number | null;
        away_score: number | null;
        total_runs: number | null;
      };
      contexts.set(row.id, {
        homeTeamId: row.home_team_id,
        awayTeamId: row.away_team_id,
        homeScore: row.home_score,
        awayScore: row.away_score,
        totalRuns: row.total_runs,
      });
    }
  }
  return contexts;
}

function addPointInTimeTeamForm(rows: Observation[]): void {
  const elo = new Map<number, number>();
  const teamWins = new Map<number, { wins: number; games: number }>();
  const teamOvers = new Map<number, { overs: number; games: number; recent: number }>();
  let leagueOvers = 0;
  let leagueTotalGames = 0;
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  for (const date of dates) {
    const games = rows.filter((row) => row.date === date);
    for (const row of games) {
      const homeId = row.homeTeamId;
      const awayId = row.awayTeamId;
      if (homeId === null || awayId === null) continue;
      if (row.market === "moneyline") {
        const homeElo = elo.get(homeId) ?? 1500;
        const awayElo = elo.get(awayId) ?? 1500;
        const homeRecord = teamWins.get(homeId) ?? { wins: 0, games: 0 };
        const awayRecord = teamWins.get(awayId) ?? { wins: 0, games: 0 };
        row.modelInputs.eloHomeDiff = homeElo - awayElo;
        row.modelInputs.eloHomeProbability = 1 / (1 + 10 ** (-(homeElo - awayElo + 35) / 400));
        row.modelInputs.homePriorWinRate = (homeRecord.wins + 5) / (homeRecord.games + 10);
        row.modelInputs.awayPriorWinRate = (awayRecord.wins + 5) / (awayRecord.games + 10);
      } else if (row.market === "total") {
        const homeRecord = teamOvers.get(homeId) ?? { overs: 0, games: 0, recent: 0.5 };
        const awayRecord = teamOvers.get(awayId) ?? { overs: 0, games: 0, recent: 0.5 };
        row.modelInputs.homePriorOverRate = (homeRecord.overs + 5) / (homeRecord.games + 10);
        row.modelInputs.awayPriorOverRate = (awayRecord.overs + 5) / (awayRecord.games + 10);
        row.modelInputs.homeRecentOverRate = homeRecord.recent;
        row.modelInputs.awayRecentOverRate = awayRecord.recent;
        row.modelInputs.leaguePriorOverRate = (leagueOvers + 10) / (leagueTotalGames + 20);
      }
    }
    for (const row of games) {
      const homeId = row.homeTeamId;
      const awayId = row.awayTeamId;
      if (homeId === null || awayId === null) continue;
      if (row.market === "moneyline") {
        const yHome = canonicalOutcome(row);
        const homeElo = elo.get(homeId) ?? 1500;
        const awayElo = elo.get(awayId) ?? 1500;
        const expected = 1 / (1 + 10 ** (-(homeElo - awayElo + 35) / 400));
        const change = 20 * (yHome - expected);
        elo.set(homeId, homeElo + change);
        elo.set(awayId, awayElo - change);
        const homeRecord = teamWins.get(homeId) ?? { wins: 0, games: 0 };
        const awayRecord = teamWins.get(awayId) ?? { wins: 0, games: 0 };
        teamWins.set(homeId, { wins: homeRecord.wins + yHome, games: homeRecord.games + 1 });
        teamWins.set(awayId, { wins: awayRecord.wins + (1 - yHome), games: awayRecord.games + 1 });
      } else if (row.market === "total") {
        const yOver = canonicalOutcome(row);
        for (const teamId of [homeId, awayId]) {
          const record = teamOvers.get(teamId) ?? { overs: 0, games: 0, recent: 0.5 };
          teamOvers.set(teamId, {
            overs: record.overs + yOver,
            games: record.games + 1,
            recent: 0.85 * record.recent + 0.15 * yOver,
          });
        }
        leagueOvers += yOver;
        leagueTotalGames++;
      }
    }
  }
}

function canonicalProbability(row: Observation, selectedSideProbability: number | null): number | null {
  if (selectedSideProbability === null) return null;
  const canonicalSide = row.market === "moneyline" ? "home" : "over";
  return row.side === canonicalSide ? selectedSideProbability : 1 - selectedSideProbability;
}

function canonicalOutcome(row: Observation): number {
  const canonicalSide = row.market === "moneyline" ? "home" : "over";
  return row.side === canonicalSide ? row.outcome : 1 - row.outcome;
}

function input(row: Observation, key: string): number | null {
  return row.modelInputs[key] ?? null;
}

function completePairDifference(row: Observation, left: string, right: string): number {
  const leftValue = input(row, left);
  const rightValue = input(row, right);
  return leftValue !== null && rightValue !== null ? leftValue - rightValue : 0;
}

function completePairSumCentered(row: Observation, left: string, right: string, center: number): number {
  const leftValue = input(row, left);
  const rightValue = input(row, right);
  return leftValue !== null && rightValue !== null ? leftValue + rightValue - center : 0;
}

function scoreProjectionFeatures(row: Observation, target: "home" | "away" | "total"): number[] | null {
  const marketHome = row.market === "moneyline" ? canonicalProbability(row, row.pMarket) : null;
  const marketTotal = input(row, "marketTotal");
  if (target === "home") {
    const independent = input(row, "independentHomeRuns");
    const posterior = input(row, "posteriorHomeRuns");
    if (independent === null || posterior === null || marketTotal === null || marketHome === null) return null;
    return [
      independent, posterior, marketTotal, logit(marketHome),
      input(row, "awayStarterEra") ?? 4.2, input(row, "awayBullpenFactor") ?? 1,
      input(row, "homeLineupWeightedOps") ?? input(row, "homeTopOrderOps") ?? 0.72,
      input(row, "parkFactorRuns") ?? 1, input(row, "weatherTotalAdjust") ?? 0,
    ];
  }
  if (target === "away") {
    const independent = input(row, "independentAwayRuns");
    const posterior = input(row, "posteriorAwayRuns");
    if (independent === null || posterior === null || marketTotal === null || marketHome === null) return null;
    return [
      independent, posterior, marketTotal, logit(1 - marketHome),
      input(row, "homeStarterEra") ?? 4.2, input(row, "homeBullpenFactor") ?? 1,
      input(row, "awayLineupWeightedOps") ?? input(row, "awayTopOrderOps") ?? 0.72,
      input(row, "parkFactorRuns") ?? 1, input(row, "weatherTotalAdjust") ?? 0,
    ];
  }
  const independent = input(row, "independentTotal");
  const posterior = input(row, "posteriorTotal");
  if (independent === null || posterior === null || marketTotal === null) return null;
  return [
    independent, posterior, marketTotal,
    completePairSumCentered(row, "homeStarterEra", "awayStarterEra", 0),
    completePairSumCentered(row, "homeBullpenFactor", "awayBullpenFactor", 0),
    completePairSumCentered(row, "homeLineupWeightedOps", "awayLineupWeightedOps", 0),
    completePairSumCentered(row, "homeTopOrderOps", "awayTopOrderOps", 0),
    input(row, "parkFactorRuns") ?? 1, input(row, "weatherTotalAdjust") ?? 0,
  ];
}

function fitLinearProjection(
  rows: Observation[],
  target: "home" | "away" | "total",
  lambda: number,
): FittedLinear | null {
  const examples = rows.flatMap((row) => {
    const x = scoreProjectionFeatures(row, target);
    const y = target === "home" ? row.actualHomeScore : target === "away" ? row.actualAwayScore : row.actualTotal;
    return x && y !== null ? [{ x, y }] : [];
  });
  if (examples.length < 30) return null;
  const width = examples[0].x.length;
  const means = Array.from({ length: width }, (_, index) =>
    examples.reduce((sum, example) => sum + example.x[index], 0) / examples.length);
  const scales = Array.from({ length: width }, (_, index) => {
    const variance = examples.reduce((sum, example) => sum + (example.x[index] - means[index]) ** 2, 0) / examples.length;
    return Math.sqrt(variance) || 1;
  });
  const standardized = examples.map((example) => ({
    x: [1, ...example.x.map((value, index) => (value - means[index]) / scales[index])],
    y: example.y,
  }));
  const meanY = examples.reduce((sum, example) => sum + example.y, 0) / examples.length;
  const weights = [meanY, ...Array(width).fill(0)];
  for (let iteration = 0; iteration < 4000; iteration++) {
    const gradient = Array(width + 1).fill(0);
    for (const example of standardized) {
      const predicted = weights.reduce((sum, weight, index) => sum + weight * example.x[index], 0);
      for (let index = 0; index < gradient.length; index++) {
        gradient[index] += 2 * (predicted - example.y) * example.x[index];
      }
    }
    for (let index = 0; index < weights.length; index++) {
      const penalty = index === 0 ? 0 : lambda * weights[index];
      weights[index] -= 0.025 * (gradient[index] / standardized.length + penalty / standardized.length);
    }
  }
  return { means, scales, weights, lambda };
}

function predictLinear(model: FittedLinear, row: Observation, target: "home" | "away" | "total"): number | null {
  const raw = scoreProjectionFeatures(row, target);
  if (!raw) return null;
  const x = [1, ...raw.map((value, index) => (value - model.means[index]) / model.scales[index])];
  return Math.max(0, model.weights.reduce((sum, weight, index) => sum + weight * x[index], 0));
}

function fitEdgeCalibration(examples: Array<{ edge: number; outcome: number }>): { intercept: number; slope: number } {
  let intercept = 0;
  let slope = 0.35;
  for (let iteration = 0; iteration < 3000; iteration++) {
    let interceptGradient = 0;
    let slopeGradient = 0;
    for (const example of examples) {
      const probability = sigmoid(intercept + slope * example.edge);
      interceptGradient += probability - example.outcome;
      slopeGradient += (probability - example.outcome) * example.edge;
    }
    intercept -= 0.05 * interceptGradient / Math.max(1, examples.length);
    slope = Math.max(0, slope - 0.05 * (slopeGradient / Math.max(1, examples.length) + 0.001 * slope));
  }
  return { intercept, slope };
}

function rawProjectionEdge(
  row: Observation,
  market: "moneyline" | "total",
  home: FittedLinear | null,
  away: FittedLinear | null,
  total: FittedLinear | null,
): number | null {
  if (market === "moneyline") {
    if (!home || !away) return null;
    const projectedHome = predictLinear(home, row, "home");
    const projectedAway = predictLinear(away, row, "away");
    return projectedHome === null || projectedAway === null ? null : projectedHome - projectedAway;
  }
  if (!total) return null;
  const projectedTotal = predictLinear(total, row, "total");
  const line = input(row, "marketTotal");
  return projectedTotal === null || line === null ? null : projectedTotal - line;
}

function fitScoreProjectionModel(
  rows: Observation[],
  market: "moneyline" | "total",
  lambda: number,
): ScoreProjectionModel | null {
  const home = market === "moneyline" ? fitLinearProjection(rows, "home", lambda) : null;
  const away = market === "moneyline" ? fitLinearProjection(rows, "away", lambda) : null;
  const total = market === "total" ? fitLinearProjection(rows, "total", lambda) : null;
  if (market === "moneyline" ? (!home || !away) : !total) return null;
  const edgeExamples = rows.flatMap((row) => {
    const edge = rawProjectionEdge(row, market, home, away, total);
    return edge === null ? [] : [{ edge, outcome: canonicalOutcome(row) }];
  });
  if (edgeExamples.length < 30) return null;
  return { market, home, away, total, calibration: fitEdgeCalibration(edgeExamples), lambda };
}

function predictionsForScoreProjection(rows: Observation[], model: ScoreProjectionModel): Prediction[] {
  return rows.flatMap((row) => {
    const edge = rawProjectionEdge(row, model.market, model.home, model.away, model.total);
    if (edge === null) return [];
    const canonical = clampProbability(sigmoid(model.calibration.intercept + model.calibration.slope * edge));
    const canonicalSide = model.market === "moneyline" ? "home" : "over";
    return [{ row, probability: row.side === canonicalSide ? canonical : 1 - canonical }];
  });
}

function predictionsForMoneylineProjectionMarketGuard(
  rows: Observation[],
  model: ScoreProjectionModel,
): Prediction[] {
  const projected = new Map(predictionsForScoreProjection(rows, model).map((prediction) => [prediction.row.id, prediction]));
  return rows.flatMap((row) => {
    const candidate = projected.get(row.id);
    if (!candidate || row.pCurrent === null) return [];
    return [{
      row,
      probability: row.pMarket !== null && row.pMarket < 0.45
        ? candidate.probability
        : row.pCurrent,
    }];
  });
}

function projectionErrorMetrics(rows: Observation[], model: ScoreProjectionModel) {
  let squared = 0;
  let absolute = 0;
  let count = 0;
  for (const row of rows) {
    if (model.market === "moneyline" && model.home && model.away && row.actualHomeScore !== null && row.actualAwayScore !== null) {
      const home = predictLinear(model.home, row, "home");
      const away = predictLinear(model.away, row, "away");
      if (home === null || away === null) continue;
      const error = (home - away) - (row.actualHomeScore - row.actualAwayScore);
      squared += error ** 2;
      absolute += Math.abs(error);
      count++;
    } else if (model.market === "total" && model.total && row.actualTotal !== null) {
      const total = predictLinear(model.total, row, "total");
      if (total === null) continue;
      const error = total - row.actualTotal;
      squared += error ** 2;
      absolute += Math.abs(error);
      count++;
    }
  }
  return {
    rows: count,
    rmse: count ? round(Math.sqrt(squared / count), 4) : null,
    mae: count ? round(absolute / count, 4) : null,
  };
}

function incumbentProjectionErrorMetrics(rows: Observation[], market: "moneyline" | "total") {
  let squared = 0;
  let absolute = 0;
  let count = 0;
  for (const row of rows) {
    let error: number | null = null;
    if (market === "moneyline" && row.actualHomeScore !== null && row.actualAwayScore !== null) {
      const home = input(row, "posteriorHomeRuns");
      const away = input(row, "posteriorAwayRuns");
      if (home !== null && away !== null) error = (home - away) - (row.actualHomeScore - row.actualAwayScore);
    } else if (market === "total" && row.actualTotal !== null) {
      const total = input(row, "posteriorTotal");
      if (total !== null) error = total - row.actualTotal;
    }
    if (error === null) continue;
    squared += error ** 2;
    absolute += Math.abs(error);
    count++;
  }
  return {
    rows: count,
    rmse: count ? round(Math.sqrt(squared / count), 4) : null,
    mae: count ? round(absolute / count, 4) : null,
  };
}

function residualProjectionFeatures(row: Observation, market: "moneyline" | "total"): number[] | null {
  if (market === "moneyline") {
    const marketHome = canonicalProbability(row, row.pMarket);
    const independentDiff = input(row, "independentHomeDiff");
    const posteriorDiff = input(row, "posteriorHomeDiff");
    if (marketHome === null || independentDiff === null || posteriorDiff === null) return null;
    return [
      independentDiff, posteriorDiff, logit(marketHome),
      completePairDifference(row, "awayStarterEra", "homeStarterEra"),
      completePairDifference(row, "awayBullpenFactor", "homeBullpenFactor"),
      completePairDifference(row, "homeLineupWeightedOps", "awayLineupWeightedOps"),
      input(row, "eloHomeDiff") ?? 0,
      input(row, "weatherTotalAdjust") ?? 0,
    ];
  }
  const independentTotal = input(row, "independentTotal");
  const posteriorTotal = input(row, "posteriorTotal");
  const marketTotal = input(row, "marketTotal");
  if (independentTotal === null || posteriorTotal === null || marketTotal === null) return null;
  const leagueEra = input(row, "leagueAverageEra") ?? 4.2;
  const leagueOps = input(row, "leagueAverageOps") ?? 0.72;
  return [
    independentTotal - marketTotal, posteriorTotal - marketTotal,
    completePairSumCentered(row, "homeStarterEra", "awayStarterEra", 2 * leagueEra),
    completePairSumCentered(row, "homeBullpenFactor", "awayBullpenFactor", 2),
    completePairSumCentered(row, "homeLineupWeightedOps", "awayLineupWeightedOps", 2 * leagueOps),
    completePairSumCentered(row, "homeTopOrderOps", "awayTopOrderOps", 2 * leagueOps),
    (input(row, "parkFactorRuns") ?? 1) - 1, input(row, "weatherTotalAdjust") ?? 0,
    ((input(row, "homePriorOverRate") ?? 0.5) + (input(row, "awayPriorOverRate") ?? 0.5)) / 2
      - (input(row, "leaguePriorOverRate") ?? 0.5),
    ((input(row, "homeRecentOverRate") ?? 0.5) + (input(row, "awayRecentOverRate") ?? 0.5)) / 2
      - (input(row, "leaguePriorOverRate") ?? 0.5),
    marketTotal - 8.5,
  ];
}

function actualResidual(row: Observation, market: "moneyline" | "total"): number | null {
  if (market === "moneyline") {
    return row.actualHomeScore !== null && row.actualAwayScore !== null
      ? row.actualHomeScore - row.actualAwayScore
      : null;
  }
  const line = input(row, "marketTotal");
  return row.actualTotal !== null && line !== null ? row.actualTotal - line : null;
}

function fitResidualLinear(
  rows: Observation[],
  market: "moneyline" | "total",
  lambda: number,
): FittedLinear | null {
  const examples = rows.flatMap((row) => {
    const x = residualProjectionFeatures(row, market);
    const y = actualResidual(row, market);
    return x && y !== null ? [{ x, y }] : [];
  });
  if (examples.length < 30) return null;
  const width = examples[0].x.length;
  const means = Array.from({ length: width }, (_, index) => examples.reduce((sum, example) => sum + example.x[index], 0) / examples.length);
  const scales = Array.from({ length: width }, (_, index) => {
    const variance = examples.reduce((sum, example) => sum + (example.x[index] - means[index]) ** 2, 0) / examples.length;
    return Math.sqrt(variance) || 1;
  });
  const standardized = examples.map((example) => ({
    x: [1, ...example.x.map((value, index) => (value - means[index]) / scales[index])],
    y: example.y,
  }));
  const weights = [examples.reduce((sum, example) => sum + example.y, 0) / examples.length, ...Array(width).fill(0)];
  for (let iteration = 0; iteration < 4000; iteration++) {
    const gradient = Array(width + 1).fill(0);
    for (const example of standardized) {
      const predicted = weights.reduce((sum, weight, index) => sum + weight * example.x[index], 0);
      for (let index = 0; index < gradient.length; index++) gradient[index] += 2 * (predicted - example.y) * example.x[index];
    }
    for (let index = 0; index < weights.length; index++) {
      const penalty = index === 0 ? 0 : lambda * weights[index];
      weights[index] -= 0.025 * (gradient[index] / standardized.length + penalty / standardized.length);
    }
  }
  return { means, scales, weights, lambda };
}

function predictResidual(model: FittedLinear, row: Observation, market: "moneyline" | "total"): number | null {
  const raw = residualProjectionFeatures(row, market);
  if (!raw) return null;
  const x = [1, ...raw.map((value, index) => (value - model.means[index]) / model.scales[index])];
  return model.weights.reduce((sum, weight, index) => sum + weight * x[index], 0);
}

function fitResidualProjectionModel(
  rows: Observation[],
  market: "moneyline" | "total",
  lambda: number,
): ResidualProjectionModel | null {
  const residual = fitResidualLinear(rows, market, lambda);
  if (!residual) return null;
  const examples = rows.flatMap((row) => {
    const edge = predictResidual(residual, row, market);
    return edge === null ? [] : [{ edge, outcome: canonicalOutcome(row) }];
  });
  return examples.length < 30 ? null : {
    market,
    residual,
    calibration: fitEdgeCalibration(examples),
    lambda,
  };
}

function predictionsForResidualProjection(rows: Observation[], model: ResidualProjectionModel): Prediction[] {
  return rows.flatMap((row) => {
    const residual = predictResidual(model.residual, row, model.market);
    if (residual === null) return [];
    const canonical = clampProbability(sigmoid(model.calibration.intercept + model.calibration.slope * residual));
    const canonicalSide = model.market === "moneyline" ? "home" : "over";
    return [{ row, probability: row.side === canonicalSide ? canonical : 1 - canonical }];
  });
}

function residualProjectionErrorMetrics(rows: Observation[], model: ResidualProjectionModel) {
  const errors = rows.flatMap((row) => {
    const predicted = predictResidual(model.residual, row, model.market);
    const actual = actualResidual(row, model.market);
    return predicted === null || actual === null ? [] : [predicted - actual];
  });
  return {
    rows: errors.length,
    rmse: errors.length ? round(Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length), 4) : null,
    mae: errors.length ? round(errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length, 4) : null,
  };
}

function residualProjectionFormula(model: ResidualProjectionModel, rows: Observation[]) {
  const names = model.market === "moneyline"
    ? ["independent_home_diff", "posterior_home_diff", "market_home_logit", "starter_era_advantage", "bullpen_advantage", "lineup_ops_advantage", "elo_home_diff", "weather_total_adjust"]
    : ["independent_total_edge", "posterior_total_edge", "starter_era_sum_centered", "bullpen_sum_centered", "lineup_ops_sum_centered", "top_order_ops_sum_centered", "park_factor_centered", "weather_total_adjust", "team_prior_over_rate", "team_recent_over_rate", "market_total_centered"];
  return {
    source: "direct_actual_residual_projection",
    lambda: model.lambda,
    residual: linearFormula(model.residual, names),
    probabilityCalibration: {
      intercept: round(model.calibration.intercept, 8),
      slope: round(model.calibration.slope, 8),
    },
    projectionError: residualProjectionErrorMetrics(rows, model),
    incumbentProjectionError: incumbentProjectionErrorMetrics(rows, model.market),
  };
}

function runtimeTotalResidualFeatures(row: Observation): number[] | null {
  const independentTotal = input(row, "independentTotal");
  const posteriorTotal = input(row, "posteriorTotal");
  const marketTotal = input(row, "marketTotal");
  if (independentTotal === null || posteriorTotal === null || marketTotal === null) return null;
  const leagueEra = input(row, "leagueAverageEra") ?? 4.2;
  const leagueOps = input(row, "leagueAverageOps") ?? 0.72;
  return [
    independentTotal - marketTotal,
    posteriorTotal - marketTotal,
    completePairSumCentered(row, "homeStarterEra", "awayStarterEra", 2 * leagueEra),
    completePairSumCentered(row, "homeBullpenFactor", "awayBullpenFactor", 2),
    completePairSumCentered(row, "homeLineupWeightedOps", "awayLineupWeightedOps", 2 * leagueOps),
    completePairSumCentered(row, "homeTopOrderOps", "awayTopOrderOps", 2 * leagueOps),
    (input(row, "parkFactorRuns") ?? 1) - 1,
    input(row, "weatherTotalAdjust") ?? 0,
    marketTotal - 8.5,
  ];
}

function fitRuntimeTotalResidualLinear(rows: Observation[], lambda: number): FittedLinear | null {
  const examples = rows.flatMap((row) => {
    const x = runtimeTotalResidualFeatures(row);
    const y = actualResidual(row, "total");
    return x && y !== null ? [{ x, y }] : [];
  });
  if (examples.length < 30) return null;
  const width = examples[0].x.length;
  const means = Array.from({ length: width }, (_, index) =>
    examples.reduce((sum, example) => sum + example.x[index], 0) / examples.length);
  const scales = Array.from({ length: width }, (_, index) => {
    const variance = examples.reduce(
      (sum, example) => sum + (example.x[index] - means[index]) ** 2,
      0,
    ) / examples.length;
    return Math.sqrt(variance) || 1;
  });
  const standardized = examples.map((example) => ({
    x: [1, ...example.x.map((value, index) => (value - means[index]) / scales[index])],
    y: example.y,
  }));
  const weights = [
    examples.reduce((sum, example) => sum + example.y, 0) / examples.length,
    ...Array(width).fill(0),
  ];
  for (let iteration = 0; iteration < 4000; iteration++) {
    const gradient = Array(width + 1).fill(0);
    for (const example of standardized) {
      const predicted = weights.reduce((sum, weight, index) => sum + weight * example.x[index], 0);
      for (let index = 0; index < gradient.length; index++) {
        gradient[index] += 2 * (predicted - example.y) * example.x[index];
      }
    }
    for (let index = 0; index < weights.length; index++) {
      const penalty = index === 0 ? 0 : lambda * weights[index];
      weights[index] -= 0.025 * (gradient[index] / standardized.length + penalty / standardized.length);
    }
  }
  return { means, scales, weights, lambda };
}

function predictRuntimeTotalResidual(model: FittedLinear, row: Observation): number | null {
  const raw = runtimeTotalResidualFeatures(row);
  if (!raw) return null;
  const x = [1, ...raw.map((value, index) => (value - model.means[index]) / model.scales[index])];
  return model.weights.reduce((sum, weight, index) => sum + weight * x[index], 0);
}

function fitRuntimeTotalResidualModel(
  rows: Observation[],
  lambda: number,
): RuntimeTotalResidualModel | null {
  const residual = fitRuntimeTotalResidualLinear(rows, lambda);
  if (!residual) return null;
  const examples = rows.flatMap((row) => {
    const edge = predictRuntimeTotalResidual(residual, row);
    return edge === null ? [] : [{ edge, outcome: canonicalOutcome(row) }];
  });
  return examples.length < 30 ? null : {
    residual,
    calibration: fitEdgeCalibration(examples),
    lambda,
  };
}

function predictionsForRuntimeTotalResidual(
  rows: Observation[],
  model: RuntimeTotalResidualModel,
): Prediction[] {
  return rows.flatMap((row) => {
    const edge = predictRuntimeTotalResidual(model.residual, row);
    if (edge === null) return [];
    const over = clampProbability(sigmoid(model.calibration.intercept + model.calibration.slope * edge));
    return [{ row, probability: row.side === "over" ? over : 1 - over }];
  });
}

function runtimeTotalResidualErrorMetrics(rows: Observation[], model: RuntimeTotalResidualModel) {
  const errors = rows.flatMap((row) => {
    const predicted = predictRuntimeTotalResidual(model.residual, row);
    const actual = actualResidual(row, "total");
    return predicted === null || actual === null ? [] : [predicted - actual];
  });
  return {
    rows: errors.length,
    rmse: errors.length
      ? round(Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length), 4)
      : null,
    mae: errors.length
      ? round(errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length, 4)
      : null,
  };
}

function runtimeTotalResidualFormula(model: RuntimeTotalResidualModel, rows: Observation[]) {
  return {
    source: "runtime_locked_actual_total_minus_market_line_residual",
    lambda: model.lambda,
    residual: linearFormula(model.residual, [
      "independent_total_edge", "posterior_total_edge", "starter_era_sum_centered",
      "bullpen_sum_centered", "lineup_ops_sum_centered", "top_order_ops_sum_centered",
      "park_factor_centered", "weather_total_adjust", "market_total_centered",
    ]),
    probabilityCalibration: {
      intercept: round(model.calibration.intercept, 8),
      slope: round(model.calibration.slope, 8),
    },
    projectionError: runtimeTotalResidualErrorMetrics(rows, model),
    incumbentProjectionError: incumbentProjectionErrorMetrics(rows, "total"),
    runtimeInputsOnly: true,
  };
}

function fitMarketMarginAnchor(rows: Observation[]): { intercept: number; slope: number } | null {
  const examples = rows.flatMap((row) => {
    const marketHome = canonicalProbability(row, row.pMarket);
    const actualMargin = row.actualHomeScore !== null && row.actualAwayScore !== null
      ? row.actualHomeScore - row.actualAwayScore
      : null;
    return marketHome === null || actualMargin === null
      ? []
      : [{ x: logit(marketHome), y: actualMargin }];
  });
  if (examples.length < 30) return null;
  const meanX = examples.reduce((sum, example) => sum + example.x, 0) / examples.length;
  const meanY = examples.reduce((sum, example) => sum + example.y, 0) / examples.length;
  const variance = examples.reduce((sum, example) => sum + (example.x - meanX) ** 2, 0);
  if (variance <= EPS) return null;
  const covariance = examples.reduce(
    (sum, example) => sum + (example.x - meanX) * (example.y - meanY),
    0,
  );
  const slope = Math.max(0, covariance / variance);
  return { intercept: meanY - slope * meanX, slope };
}

function marketImpliedMargin(
  row: Observation,
  anchor: Pick<MarketAnchoredMarginModel, "marketIntercept" | "marketSlope">,
): number | null {
  const marketHome = canonicalProbability(row, row.pMarket);
  return marketHome === null ? null : anchor.marketIntercept + anchor.marketSlope * logit(marketHome);
}

function marketAnchoredResidualFeatures(
  row: Observation,
  anchor: Pick<MarketAnchoredMarginModel, "marketIntercept" | "marketSlope">,
): number[] | null {
  const marketMargin = marketImpliedMargin(row, anchor);
  const independentDiff = input(row, "independentHomeDiff");
  if (marketMargin === null || independentDiff === null) return null;
  return [
    independentDiff - marketMargin,
    completePairDifference(row, "awayStarterEra", "homeStarterEra"),
    completePairDifference(row, "awayBullpenFactor", "homeBullpenFactor"),
    completePairDifference(row, "homeLineupWeightedOps", "awayLineupWeightedOps"),
    completePairDifference(row, "homeTopOrderOps", "awayTopOrderOps"),
    input(row, "eloHomeDiff") ?? 0,
    (input(row, "homePriorWinRate") ?? 0.5) - (input(row, "awayPriorWinRate") ?? 0.5),
  ];
}

function fitMarketAnchoredResidualLinear(
  rows: Observation[],
  anchor: Pick<MarketAnchoredMarginModel, "marketIntercept" | "marketSlope">,
  lambda: number,
): FittedLinear | null {
  const examples = rows.flatMap((row) => {
    const x = marketAnchoredResidualFeatures(row, anchor);
    const marketMargin = marketImpliedMargin(row, anchor);
    const actualMargin = row.actualHomeScore !== null && row.actualAwayScore !== null
      ? row.actualHomeScore - row.actualAwayScore
      : null;
    return x === null || marketMargin === null || actualMargin === null
      ? []
      : [{ x, y: actualMargin - marketMargin }];
  });
  if (examples.length < 30) return null;
  const width = examples[0].x.length;
  const means = Array.from({ length: width }, (_, index) =>
    examples.reduce((sum, example) => sum + example.x[index], 0) / examples.length);
  const scales = Array.from({ length: width }, (_, index) => {
    const variance = examples.reduce(
      (sum, example) => sum + (example.x[index] - means[index]) ** 2,
      0,
    ) / examples.length;
    return Math.sqrt(variance) || 1;
  });
  const standardized = examples.map((example) => ({
    x: [1, ...example.x.map((value, index) => (value - means[index]) / scales[index])],
    y: example.y,
  }));
  const meanY = examples.reduce((sum, example) => sum + example.y, 0) / examples.length;
  const weights = [meanY, ...Array(width).fill(0)];
  for (let iteration = 0; iteration < 4000; iteration++) {
    const gradient = Array(width + 1).fill(0);
    for (const example of standardized) {
      const predicted = weights.reduce((sum, weight, index) => sum + weight * example.x[index], 0);
      for (let index = 0; index < gradient.length; index++) {
        gradient[index] += 2 * (predicted - example.y) * example.x[index];
      }
    }
    for (let index = 0; index < weights.length; index++) {
      const penalty = index === 0 ? 0 : lambda * weights[index];
      weights[index] -= 0.025 * (gradient[index] / standardized.length + penalty / standardized.length);
    }
  }
  return { means, scales, weights, lambda };
}

function predictMarketAnchoredMargin(row: Observation, model: MarketAnchoredMarginModel): number | null {
  const marketMargin = marketImpliedMargin(row, model);
  const raw = marketAnchoredResidualFeatures(row, model);
  if (marketMargin === null || raw === null) return null;
  const x = [1, ...raw.map((value, index) =>
    (value - model.residual.means[index]) / model.residual.scales[index])];
  const residual = model.residual.weights.reduce(
    (sum, weight, index) => sum + weight * x[index],
    0,
  );
  return marketMargin + residual;
}

function fitMarketAnchoredMarginModel(
  rows: Observation[],
  lambda: number,
): MarketAnchoredMarginModel | null {
  const anchor = fitMarketMarginAnchor(rows);
  if (!anchor) return null;
  const residual = fitMarketAnchoredResidualLinear(rows, {
    marketIntercept: anchor.intercept,
    marketSlope: anchor.slope,
  }, lambda);
  if (!residual) return null;
  const provisional: MarketAnchoredMarginModel = {
    marketIntercept: anchor.intercept,
    marketSlope: anchor.slope,
    residual,
    calibration: { intercept: 0, slope: 0.35 },
    lambda,
  };
  const examples = rows.flatMap((row) => {
    const margin = predictMarketAnchoredMargin(row, provisional);
    return margin === null ? [] : [{ edge: margin, outcome: canonicalOutcome(row) }];
  });
  return examples.length < 30 ? null : {
    ...provisional,
    calibration: fitEdgeCalibration(examples),
  };
}

function predictionsForMarketAnchoredMargin(
  rows: Observation[],
  model: MarketAnchoredMarginModel,
): Prediction[] {
  return rows.flatMap((row) => {
    const margin = predictMarketAnchoredMargin(row, model);
    if (margin === null) return [];
    const homeProbability = clampProbability(sigmoid(
      model.calibration.intercept + model.calibration.slope * margin,
    ));
    return [{ row, probability: row.side === "home" ? homeProbability : 1 - homeProbability }];
  });
}

function marginErrorMetrics(
  rows: Observation[],
  projection: (row: Observation) => number | null,
) {
  const errors = rows.flatMap((row) => {
    const predicted = projection(row);
    const actual = row.actualHomeScore !== null && row.actualAwayScore !== null
      ? row.actualHomeScore - row.actualAwayScore
      : null;
    return predicted === null || actual === null ? [] : [predicted - actual];
  });
  return {
    rows: errors.length,
    rmse: errors.length
      ? round(Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length), 4)
      : null,
    mae: errors.length
      ? round(errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length, 4)
      : null,
  };
}

function marketAnchoredMarginFormula(model: MarketAnchoredMarginModel, rows: Observation[]) {
  return {
    source: "locked_market_margin_anchor_plus_independent_baseball_residual",
    marketAnchor: {
      intercept: round(model.marketIntercept, 8),
      slopeOnLockedMarketHomeLogit: round(model.marketSlope, 8),
    },
    residual: linearFormula(model.residual, [
      "independent_margin_minus_market_margin", "starter_era_advantage",
      "bullpen_advantage", "lineup_ops_advantage", "top_order_ops_advantage",
      "elo_home_diff", "prior_win_rate_advantage",
    ]),
    probabilityCalibration: {
      intercept: round(model.calibration.intercept, 8),
      slope: round(model.calibration.slope, 8),
    },
    projectionError: marginErrorMetrics(rows, (row) => predictMarketAnchoredMargin(row, model)),
    marketOnlyProjectionError: marginErrorMetrics(rows, (row) => marketImpliedMargin(row, model)),
    independentProjectionError: marginErrorMetrics(rows, (row) => input(row, "independentHomeDiff")),
    incumbentProjectionError: incumbentProjectionErrorMetrics(rows, "moneyline"),
    decomposition: {
      marketIsPrior: true,
      posteriorExcludedFromResidualFeatures: true,
      rationale: "avoid_double_counting_market_information_already_embedded_in_posterior",
    },
  };
}

function features(row: Observation, family: string): number[] | null {
  if (family === "mlb_moneyline_market_disagreement_resolver") {
    if (
      row.sport !== "mlb"
      || row.market !== "moneyline"
      || row.pCurrent === null
      || row.pMarket === null
      || row.pMarket >= 0.5
    ) return null;
    const sideSign = row.side === "home" ? 1 : -1;
    const eloHome = input(row, "eloHomeProbability") ?? 0.5;
    const selectedElo = row.side === "home" ? eloHome : 1 - eloHome;
    return [
      logit(row.pCurrent), logit(row.pMarket), row.pCurrent - row.pMarket,
      logit(row.pIndependent ?? row.pCurrent), row.signedProjectionEdge ?? 0,
      logit(selectedElo),
      completePairDifference(row, "awayStarterEra", "homeStarterEra") * sideSign,
      completePairDifference(row, "awayBullpenFactor", "homeBullpenFactor") * sideSign,
      completePairDifference(row, "homeLineupWeightedOps", "awayLineupWeightedOps") * sideSign,
      ((input(row, "homePriorWinRate") ?? 0.5) - (input(row, "awayPriorWinRate") ?? 0.5)) * sideSign,
      row.side === "home" ? 1 : 0,
    ];
  }
  if (family === "mlb_moneyline_form_stack") {
    if (row.sport !== "mlb" || row.market !== "moneyline") return null;
    const current = canonicalProbability(row, row.pCurrent);
    const market = canonicalProbability(row, row.pMarket);
    const independentDiff = input(row, "independentHomeDiff");
    const eloProbability = input(row, "eloHomeProbability");
    const homeWinRate = input(row, "homePriorWinRate");
    const awayWinRate = input(row, "awayPriorWinRate");
    if (current === null || market === null || independentDiff === null || eloProbability === null || homeWinRate === null || awayWinRate === null) return null;
    return [
      logit(current), logit(market), independentDiff, logit(eloProbability),
      homeWinRate - awayWinRate,
      independentDiff * logit(eloProbability),
      logit(market) * logit(eloProbability),
    ];
  }
  if (family === "mlb_total_form_stack") {
    if (row.sport !== "mlb" || row.market !== "total") return null;
    const current = canonicalProbability(row, row.pCurrent);
    const market = canonicalProbability(row, row.pMarket);
    const independentTotal = input(row, "independentTotal");
    const marketTotal = input(row, "marketTotal");
    const homeOver = input(row, "homePriorOverRate");
    const awayOver = input(row, "awayPriorOverRate");
    const homeRecent = input(row, "homeRecentOverRate");
    const awayRecent = input(row, "awayRecentOverRate");
    const leagueOver = input(row, "leaguePriorOverRate");
    if (current === null || market === null || independentTotal === null || marketTotal === null
      || homeOver === null || awayOver === null || homeRecent === null || awayRecent === null || leagueOver === null) return null;
    return [
      logit(current), logit(market), independentTotal - marketTotal,
      (homeOver + awayOver) / 2 - leagueOver,
      (homeRecent + awayRecent) / 2 - leagueOver,
      leagueOver - 0.5,
      ((homeRecent + awayRecent) / 2 - leagueOver) * (independentTotal - marketTotal),
      marketTotal - 8.5,
    ];
  }
  if (family === "mlb_moneyline_guarded_regime") {
    if (row.sport !== "mlb" || row.market !== "moneyline" || row.pCurrent === null || row.pMarket === null || row.signedProjectionEdge === null) return null;
    const selectedSign = row.side === "home" ? 1 : -1;
    const starterAdvantage = selectedSign * completePairDifference(row, "awayStarterEra", "homeStarterEra");
    const bullpenAdvantage = selectedSign * completePairDifference(row, "awayBullpenFactor", "homeBullpenFactor");
    const lineupAdvantage = selectedSign * completePairDifference(row, "homeLineupWeightedOps", "awayLineupWeightedOps");
    const marketOpposes = row.pMarket < 0.5 ? 1 : 0;
    const projectionOpposes = row.signedProjectionEdge < 0 ? 1 : 0;
    const movementAgainst = row.pairedMovement !== null && row.pairedMovement < -0.01 ? 1 : 0;
    return [
      logit(row.pCurrent), logit(row.pMarket), row.pCurrent - row.pMarket, row.signedProjectionEdge,
      marketOpposes, row.pMarket < 0.475 ? 1 : 0, row.pMarket < 0.45 ? 1 : 0,
      projectionOpposes, marketOpposes * projectionOpposes,
      row.pairedMovement ?? 0, movementAgainst, marketOpposes * movementAgainst,
      row.tickets === null ? 0 : row.tickets - 0.5, row.moneyTicketGap ?? 0,
      row.breakEven ?? 0.5, (row.breakEven ?? 0.5) >= 0.6 ? 1 : 0,
      starterAdvantage, bullpenAdvantage, lineupAdvantage,
      row.side === "home" ? 1 : -1,
      row.pairedMovement === null ? 1 : 0,
      row.tickets === null || row.moneyTicketGap === null ? 1 : 0,
    ];
  }
  if (family === "mlb_total_guarded_regime") {
    if (row.sport !== "mlb" || row.market !== "total" || row.pCurrent === null || row.pMarket === null || row.signedProjectionEdge === null) return null;
    const marketOpposes = row.pMarket < 0.5 ? 1 : 0;
    const projectionOpposes = row.signedProjectionEdge < 0 ? 1 : 0;
    const movementAgainst = row.pairedMovement !== null && row.pairedMovement < -0.01 ? 1 : 0;
    const line = input(row, "marketTotal") ?? 8.5;
    return [
      logit(row.pCurrent), logit(row.pMarket), row.pCurrent - row.pMarket, row.signedProjectionEdge,
      marketOpposes, row.pMarket < 0.475 ? 1 : 0, row.pMarket < 0.45 ? 1 : 0,
      projectionOpposes, marketOpposes * projectionOpposes,
      Math.abs(row.signedProjectionEdge) >= 0.5 ? 1 : 0,
      Math.abs(row.signedProjectionEdge) >= 1 ? 1 : 0,
      row.pairedMovement ?? 0, movementAgainst, marketOpposes * movementAgainst,
      row.tickets === null ? 0 : row.tickets - 0.5, row.moneyTicketGap ?? 0,
      row.breakEven ?? 0.5, row.side === "over" ? 1 : -1,
      line - 8.5, line <= 8 ? 1 : 0, line >= 9 ? 1 : 0,
      input(row, "weatherTotalAdjust") ?? 0, (input(row, "parkFactorRuns") ?? 1) - 1,
      row.pairedMovement === null ? 1 : 0,
      row.tickets === null || row.moneyTicketGap === null ? 1 : 0,
    ];
  }
  if (family === "mlb_canonical_market_model_stack") {
    if (row.sport !== "mlb" || (row.market !== "moneyline" && row.market !== "total")) return null;
    const current = canonicalProbability(row, row.pCurrent);
    const market = canonicalProbability(row, row.pMarket);
    if (current === null || market === null) return null;
    const projection = row.market === "moneyline"
      ? input(row, "independentHomeDiff")
      : input(row, "independentTotal") !== null && input(row, "marketTotal") !== null
        ? input(row, "independentTotal")! - input(row, "marketTotal")!
        : null;
    if (projection === null) return null;
    return [logit(current), logit(market), projection, logit(current) - logit(market)];
  }
  if (family === "mlb_moneyline_baseball_stack") {
    if (row.sport !== "mlb" || row.market !== "moneyline") return null;
    const current = canonicalProbability(row, row.pCurrent);
    const market = canonicalProbability(row, row.pMarket);
    const independentDiff = input(row, "independentHomeDiff");
    const posteriorDiff = input(row, "posteriorHomeDiff");
    if (current === null || market === null || independentDiff === null || posteriorDiff === null) return null;
    const starterEraAdvantage = completePairDifference(row, "awayStarterEra", "homeStarterEra");
    const workloadAdvantage = completePairDifference(row, "homeStarterWorkload", "awayStarterWorkload");
    const bullpenAdvantage = completePairDifference(row, "awayBullpenFactor", "homeBullpenFactor");
    const topOrderAdvantage = completePairDifference(row, "homeTopOrderOps", "awayTopOrderOps");
    const lineupAdvantage = completePairDifference(row, "homeLineupWeightedOps", "awayLineupWeightedOps");
    return [
      logit(current), logit(market), independentDiff, posteriorDiff,
      starterEraAdvantage, workloadAdvantage, bullpenAdvantage,
      topOrderAdvantage, lineupAdvantage,
      independentDiff * logit(market),
      input(row, "featureMissingCount") ?? 0,
    ];
  }
  if (family === "mlb_total_baseball_stack") {
    if (row.sport !== "mlb" || row.market !== "total") return null;
    const current = canonicalProbability(row, row.pCurrent);
    const market = canonicalProbability(row, row.pMarket);
    const independentTotal = input(row, "independentTotal");
    const posteriorTotal = input(row, "posteriorTotal");
    const marketTotal = input(row, "marketTotal");
    if (current === null || market === null || independentTotal === null || posteriorTotal === null || marketTotal === null) return null;
    const leagueEra = input(row, "leagueAverageEra") ?? 4.2;
    const leagueOps = input(row, "leagueAverageOps") ?? 0.72;
    return [
      logit(current), logit(market), independentTotal - marketTotal, posteriorTotal - marketTotal,
      input(row, "weatherTotalAdjust") ?? 0,
      (input(row, "parkFactorRuns") ?? 1) - 1,
      completePairSumCentered(row, "homeStarterEra", "awayStarterEra", 2 * leagueEra),
      completePairSumCentered(row, "homeBullpenFactor", "awayBullpenFactor", 2),
      completePairSumCentered(row, "homeTopOrderOps", "awayTopOrderOps", 2 * leagueOps),
      completePairSumCentered(row, "homeLineupWeightedOps", "awayLineupWeightedOps", 2 * leagueOps),
      marketTotal - 8.5,
      (independentTotal - marketTotal) * (marketTotal - 8.5),
      input(row, "featureMissingCount") ?? 0,
    ];
  }
  if (
    family === "recalibrated_incumbent"
    || family === "symmetric_recalibration"
    || family === "adaptive_symmetric_recalibration"
  ) {
    return row.pCurrent === null ? null : [logit(row.pCurrent)];
  }
  if (family === "model_market_stack") {
    const model = row.pIndependent ?? row.pCurrent;
    return model === null || row.pMarket === null ? null : [logit(model), logit(row.pMarket)];
  }
  if (family === "current_market_stack") {
    return row.pCurrent === null || row.pMarket === null
      ? null
      : [logit(row.pCurrent), logit(row.pMarket)];
  }
  if (family === "projection_edge" || family === "symmetric_projection_edge") {
    return row.signedProjectionEdge === null ? null : [row.signedProjectionEdge];
  }
  if (family === "projection_market_stack") {
    return row.pCurrent === null || row.pMarket === null || row.signedProjectionEdge === null
      ? null
      : [logit(row.pCurrent), logit(row.pMarket), row.signedProjectionEdge];
  }
  if (family === "price_calibration_stack" || family === "price_calibration_stack_side_floor") {
    if (row.pCurrent === null || row.breakEven === null) return null;
    const side = row.side === "home" || row.side === "over" || row.side === "yrfi" ? 1 : -1;
    const current = logit(row.pCurrent);
    return [current, logit(row.breakEven), row.pCurrent - row.breakEven, side, current * side];
  }
  if (family === "market_context_stack") {
    const model = row.pIndependent ?? row.pCurrent;
    if (
      model === null || row.pMarket === null || row.pairedMovement === null ||
      row.tickets === null || row.moneyTicketGap === null
    ) return null;
    return [
      logit(model),
      logit(row.pMarket),
      row.pairedMovement,
      row.tickets - 0.5,
      row.moneyTicketGap,
      row.bookCount === null ? 0 : Math.log1p(row.bookCount),
    ];
  }
  if (family === "production_stack") {
    if (row.pCurrent === null) return null;
    const side = row.side === "home" || row.side === "over" || row.side === "yrfi" ? 1 : -1;
    const current = logit(row.pCurrent);
    const market = row.pMarket ?? row.breakEven ?? 0.5;
    const independent = row.pIndependent ?? row.pCurrent;
    return [
      current,
      logit(market),
      logit(independent),
      row.signedProjectionEdge ?? 0,
      row.pairedMovement ?? 0,
      (row.tickets ?? 0.5) - 0.5,
      row.moneyTicketGap ?? 0,
      row.bookCount === null ? 0 : Math.log1p(row.bookCount),
      side,
      current * side,
      row.pMarket === null ? 1 : 0,
      row.pIndependent === null ? 1 : 0,
      row.signedProjectionEdge === null ? 1 : 0,
      row.pairedMovement === null ? 1 : 0,
      row.tickets === null || row.moneyTicketGap === null ? 1 : 0,
    ];
  }
  return null;
}

function featureNames(family: string): string[] {
  if (family === "mlb_moneyline_market_disagreement_resolver") {
    return [
      "logit_selected_current", "logit_selected_market", "current_minus_market",
      "logit_selected_independent", "signed_projection_edge", "logit_selected_elo",
      "starter_era_advantage", "bullpen_advantage", "lineup_ops_advantage",
      "prior_win_rate_advantage", "selected_side_is_home",
    ];
  }
  if (family === "mlb_moneyline_form_stack") {
    return [
      "logit_home_current", "logit_home_market", "independent_home_diff", "logit_home_elo",
      "prior_win_rate_advantage", "independent_diff_x_elo", "market_logit_x_elo",
    ];
  }
  if (family === "mlb_total_form_stack") {
    return [
      "logit_over_current", "logit_over_market", "independent_total_edge",
      "team_prior_over_rate_vs_league", "team_recent_over_rate_vs_league",
      "league_over_rate_centered", "recent_rate_x_projection_edge", "market_total_centered",
    ];
  }
  if (family === "mlb_moneyline_guarded_regime") {
    return [
      "logit_current", "logit_market", "current_minus_market", "signed_projection_edge",
      "market_opposes", "market_below_47_5", "market_below_45", "projection_opposes",
      "market_x_projection_opposition", "movement", "movement_against",
      "market_x_movement_opposition", "tickets_centered", "money_ticket_gap",
      "break_even", "break_even_at_least_60", "starter_advantage", "bullpen_advantage",
      "lineup_advantage", "home_side", "movement_missing", "splits_missing",
    ];
  }
  if (family === "mlb_total_guarded_regime") {
    return [
      "logit_current", "logit_market", "current_minus_market", "signed_projection_edge",
      "market_opposes", "market_below_47_5", "market_below_45", "projection_opposes",
      "market_x_projection_opposition", "projection_abs_at_least_half", "projection_abs_at_least_one",
      "movement", "movement_against", "market_x_movement_opposition", "tickets_centered",
      "money_ticket_gap", "break_even", "over_side", "market_total_centered",
      "line_at_most_8", "line_at_least_9", "weather_total_adjust", "park_factor_centered",
      "movement_missing", "splits_missing",
    ];
  }
  if (family === "mlb_canonical_market_model_stack") {
    return ["logit_canonical_current", "logit_canonical_market", "canonical_projection_edge", "current_minus_market_logit"];
  }
  if (family === "mlb_moneyline_baseball_stack") {
    return [
      "logit_home_current", "logit_home_market", "independent_home_diff", "posterior_home_diff",
      "starter_era_advantage", "starter_workload_advantage", "bullpen_advantage",
      "top_order_ops_advantage", "lineup_ops_advantage", "independent_diff_x_market_logit",
      "feature_missing_count",
    ];
  }
  if (family === "mlb_total_baseball_stack") {
    return [
      "logit_over_current", "logit_over_market", "independent_total_edge", "posterior_total_edge",
      "weather_total_adjust", "park_factor_centered", "starter_era_sum_centered",
      "bullpen_factor_sum_centered", "top_order_ops_sum_centered", "lineup_ops_sum_centered",
      "market_total_centered", "independent_edge_x_market_total", "feature_missing_count",
    ];
  }
  if (
    family === "recalibrated_incumbent"
    || family === "symmetric_recalibration"
    || family === "adaptive_symmetric_recalibration"
  ) return ["logit_current"];
  if (family === "model_market_stack") return ["logit_independent_or_current", "logit_market"];
  if (family === "current_market_stack") return ["logit_current", "logit_market"];
  if (family === "projection_edge" || family === "symmetric_projection_edge") return ["signed_projection_edge"];
  if (family === "projection_market_stack") return ["logit_current", "logit_market", "signed_projection_edge"];
  if (family === "price_calibration_stack" || family === "price_calibration_stack_side_floor") return ["logit_current", "logit_break_even", "current_minus_break_even", "side", "logit_current_x_side"];
  if (family === "market_context_stack") return ["logit_independent_or_current", "logit_market", "movement", "tickets_centered", "money_ticket_gap", "log_book_count"];
  if (family === "production_stack") return [
    "logit_current", "logit_market_or_break_even", "logit_independent_or_current",
    "signed_projection_edge", "movement", "tickets_centered", "money_ticket_gap",
    "log_book_count", "side", "logit_current_x_side", "market_missing",
    "independent_missing", "projection_missing", "movement_missing", "splits_missing",
  ];
  return [];
}

function rawFormula(model: FittedLogistic, family: string) {
  const coefficients = model.weights.slice(1).map((weight, index) => weight / model.scales[index]);
  const intercept = model.weights[0]
    - coefficients.reduce((sum, coefficient, index) => sum + coefficient * model.means[index], 0);
  return {
    intercept: round(intercept, 8),
    coefficients: Object.fromEntries(featureNames(family).map((name, index) => [name, round(coefficients[index], 8)])),
  };
}

function fitLogistic(rows: Observation[], family: string, lambda: number): FittedLogistic | null {
  const canonicalFamily = family === "mlb_canonical_market_model_stack"
    || family === "mlb_moneyline_baseball_stack"
    || family === "mlb_total_baseball_stack"
    || family === "mlb_moneyline_form_stack"
    || family === "mlb_total_form_stack";
  const examples = rows.flatMap((row) => {
    const x = features(row, family);
    return x ? [{ x, y: canonicalFamily ? canonicalOutcome(row) : row.outcome }] : [];
  });
  if (examples.length < 20) return null;
  const width = examples[0].x.length;
  const zeroIntercept =
    family === "symmetric_recalibration"
    || family === "adaptive_symmetric_recalibration"
    || family === "symmetric_projection_edge";
  const means = zeroIntercept
    ? Array(width).fill(0)
    : Array.from({ length: width }, (_, index) =>
        examples.reduce((sum, row) => sum + row.x[index], 0) / examples.length);
  const scales = Array.from({ length: width }, (_, index) => {
    const variance = examples.reduce((sum, row) => sum + (row.x[index] - means[index]) ** 2, 0) / examples.length;
    return Math.sqrt(variance) || 1;
  });
  const standardized = examples.map((row) => ({
    x: [1, ...row.x.map((value, index) => (value - means[index]) / scales[index])],
    y: row.y,
  }));
  const weights = Array(width + 1).fill(0);
  const rate = 0.08;
  for (let iteration = 0; iteration < 2500; iteration++) {
    const gradient = Array(width + 1).fill(0);
    for (const row of standardized) {
      const p = sigmoid(weights.reduce((sum, weight, index) => sum + weight * row.x[index], 0));
      for (let index = 0; index < gradient.length; index++) gradient[index] += (p - row.y) * row.x[index];
    }
    const firstWeight = zeroIntercept ? 1 : 0;
    for (let index = firstWeight; index < weights.length; index++) {
      const penalty = index === 0 ? 0 : lambda * weights[index];
      weights[index] -= rate * (gradient[index] / standardized.length + penalty / standardized.length);
      if (family === "symmetric_projection_edge" && index === 1) weights[index] = Math.max(0, weights[index]);
    }
  }
  return { means, scales, weights, lambda };
}

function predict(model: FittedLogistic, row: Observation, family: string): number | null {
  const raw = features(row, family);
  if (!raw) return null;
  const x = [1, ...raw.map((value, index) => (value - model.means[index]) / model.scales[index])];
  const fittedProbability = clampProbability(sigmoid(model.weights.reduce((sum, weight, index) => sum + weight * x[index], 0)));
  const canonicalFamily = family === "mlb_canonical_market_model_stack"
    || family === "mlb_moneyline_baseball_stack"
    || family === "mlb_total_baseball_stack"
    || family === "mlb_moneyline_form_stack"
    || family === "mlb_total_form_stack";
  const probability = canonicalFamily
    ? (row.side === (row.market === "moneyline" ? "home" : "over") ? fittedProbability : 1 - fittedProbability)
    : fittedProbability;
  return family === "price_calibration_stack_side_floor"
    ? Math.max(0.5, probability)
    : probability;
}

function predictionsForBaseline(rows: Observation[], family: "incumbent" | "market"): Prediction[] {
  return rows.flatMap((row) => {
    const probability = family === "incumbent" ? row.pCurrent : row.pMarket;
    return probability === null ? [] : [{ row, probability: clampProbability(probability) }];
  });
}

function predictionsForModel(rows: Observation[], family: string, model: FittedLogistic): Prediction[] {
  return rows.flatMap((row) => {
    const probability = predict(model, row, family);
    return probability === null ? [] : [{ row, probability }];
  });
}

function predictionsForMoneylineDisagreementResolver(
  rows: Observation[],
  model: FittedLogistic,
): Prediction[] {
  return rows.flatMap((row) => {
    if (row.pCurrent === null) return [];
    const resolved = predict(model, row, "mlb_moneyline_market_disagreement_resolver");
    return [{ row, probability: resolved ?? row.pCurrent }];
  });
}

function metrics(predictions: Prediction[]): Metrics {
  let wins = 0;
  let losses = 0;
  let brier = 0;
  let logLoss = 0;
  let probabilitySum = 0;
  let units = 0;
  let priced = 0;
  for (const prediction of predictions) {
    if (prediction.row.outcome === 1) wins++; else losses++;
    probabilitySum += prediction.probability;
    brier += (prediction.probability - prediction.row.outcome) ** 2;
    logLoss -= prediction.row.outcome * Math.log(clampProbability(prediction.probability))
      + (1 - prediction.row.outcome) * Math.log(clampProbability(1 - prediction.probability));
    const value = profit(prediction.row.result, prediction.row.odds);
    if (value !== null) { units += value; priced++; }
  }
  const n = predictions.length;
  const observed = n ? wins / n : 0;
  return {
    rows: n,
    dates: new Set(predictions.map((prediction) => prediction.row.date)).size,
    games: new Set(predictions.map((prediction) => prediction.row.gameId)).size,
    record: `${wins}-${losses}`,
    accuracyPct: n ? round(observed * 100, 1) : null,
    meanProbabilityPct: n ? round(probabilitySum / n * 100, 1) : null,
    calibrationGapPp: n ? round((observed - probabilitySum / n) * 100, 1) : null,
    brier: n ? round(brier / n, 4) : null,
    logLoss: n ? round(logLoss / n, 4) : null,
    priced,
    units: round(units, 3),
    roiPct: priced ? round(units / priced * 100, 1) : null,
  };
}

function chooseLambda(
  development: Observation[],
  calibration: Observation[],
  family: string,
): { model: FittedLogistic; calibration: Metrics } | null {
  const candidates = LAMBDAS.flatMap((lambda) => {
    const model = fitLogistic(development, family, lambda);
    return model ? [{ model, calibration: metrics(predictionsForModel(calibration, family, model)) }] : [];
  }).filter((candidate) => candidate.calibration.rows >= 10 && candidate.calibration.logLoss !== null);
  candidates.sort((left, right) =>
    (left.calibration.logLoss! - right.calibration.logLoss!)
    || (left.calibration.brier! - right.calibration.brier!));
  return candidates[0] ?? null;
}

function adaptiveModelForTraining(
  training: Observation[],
  family: string,
  lambda: number,
): { applied: boolean; model: FittedLogistic | null; gateCandidate: Metrics; gateIncumbent: Metrics } {
  const dates = [...new Set(training.map((row) => row.date))].sort();
  const gateStart = Math.max(1, Math.floor(dates.length * 0.75));
  const fitDates = new Set(dates.slice(0, gateStart));
  const gateDates = new Set(dates.slice(gateStart));
  const fitRows = training.filter((row) => fitDates.has(row.date));
  const gateRows = training.filter((row) => gateDates.has(row.date));
  const gateModel = fitLogistic(fitRows, family, lambda);
  const gateCandidate = gateModel
    ? metrics(predictionsForModel(gateRows, family, gateModel))
    : metrics([]);
  const gateIncumbent = metrics(predictionsForBaseline(gateRows, "incumbent"));
  const applied =
    gateCandidate.rows >= 10
    && gateCandidate.rows === gateIncumbent.rows
    && gateCandidate.brier !== null
    && gateCandidate.logLoss !== null
    && gateIncumbent.brier !== null
    && gateIncumbent.logLoss !== null
    && gateCandidate.brier < gateIncumbent.brier
    && gateCandidate.logLoss < gateIncumbent.logLoss;
  return {
    applied,
    model: applied ? fitLogistic(training, family, lambda) : null,
    gateCandidate,
    gateIncumbent,
  };
}

function chronologicalPredictions(
  training: Observation[],
  test: Observation[],
  family: string,
  lambda: number,
) {
  if (family !== "adaptive_symmetric_recalibration") {
    const model = fitLogistic(training, family, lambda);
    return model ? { predictions: predictionsForModel(test, family, model), model, applied: true } : null;
  }
  const adaptive = adaptiveModelForTraining(training, family, lambda);
  return {
    predictions: adaptive.model
      ? predictionsForModel(test, family, adaptive.model)
      : predictionsForBaseline(test, "incumbent"),
    model: adaptive.model,
    applied: adaptive.applied,
    gateCandidate: adaptive.gateCandidate,
    gateIncumbent: adaptive.gateIncumbent,
  };
}

function isRuleBasedSideFamily(family: string): boolean {
  return family === "mlb_revert_final_side_change"
    || family === "mlb_market_opposition_flip"
    || family === "mlb_strong_market_opposition_flip"
    || family === "mlb_very_strong_market_opposition_flip"
    || family === "mlb_extreme_market_opposition_flip"
    || family === "mlb_away_market_40_45_flip"
    || family === "mlb_total_always_under"
    || family === "mlb_total_always_over"
    || family === "mlb_market_projection_opposition_flip";
}

function predictionsForRuleBasedSideFamily(rows: Observation[], family: string): Prediction[] {
  return rows.flatMap((row) => {
    if (row.sport !== "mlb" || row.pCurrent === null) return [];
    const shouldFlip = family === "mlb_total_always_under"
      ? row.market === "total" && row.side === "over"
      : family === "mlb_total_always_over"
        ? row.market === "total" && row.side === "under"
      : family === "mlb_revert_final_side_change"
      ? input(row, "finalSideChanged") === 1
      : family === "mlb_away_market_40_45_flip"
        ? row.market === "moneyline" && row.side === "away"
          && row.pMarket !== null && row.pMarket >= 0.4 && row.pMarket < 0.45
      : family === "mlb_market_opposition_flip"
        ? row.pMarket !== null && row.pMarket < 0.5
        : family === "mlb_strong_market_opposition_flip"
          ? row.pMarket !== null && row.pMarket < 0.475
          : family === "mlb_very_strong_market_opposition_flip"
            ? row.pMarket !== null && row.pMarket < 0.45
            : family === "mlb_extreme_market_opposition_flip"
              ? row.pMarket !== null && row.pMarket < 0.425
              : row.pMarket !== null && row.pMarket < 0.5
            && row.signedProjectionEdge !== null && row.signedProjectionEdge < 0;
    const probability = shouldFlip
      ? family === "mlb_away_market_40_45_flip" && row.pMarket !== null
        ? row.pMarket
        : 1 - row.pCurrent
      : row.pCurrent;
    return [{ row, probability: clampProbability(probability) }];
  });
}

type StructuralFlipRule = { label: string; matches: (row: Observation) => boolean };

function structuralFlipRules(market: Market): StructuralFlipRule[] {
  const marketThresholds = [0.5, 0.475, 0.45, 0.425] as const;
  const bases: StructuralFlipRule[] = [
    ...marketThresholds.map((threshold) => ({
      label: `market_below_${threshold}`,
      matches: (row: Observation) => row.pMarket !== null && row.pMarket < threshold,
    })),
    ...marketThresholds.map((threshold) => ({
      label: `market_below_${threshold}_projection_opposes`,
      matches: (row: Observation) => row.pMarket !== null && row.pMarket < threshold
        && row.signedProjectionEdge !== null && row.signedProjectionEdge < 0,
    })),
    ...marketThresholds.map((threshold) => ({
      label: `market_below_${threshold}_movement_against`,
      matches: (row: Observation) => row.pMarket !== null && row.pMarket < threshold
        && row.pairedMovement !== null && row.pairedMovement < -0.01,
    })),
    {
      label: "revert_final_side_change",
      matches: (row) => input(row, "finalSideChanged") === 1,
    },
    {
      label: "revert_changed_side_when_market_opposes",
      matches: (row) => input(row, "finalSideChanged") === 1 && row.pMarket !== null && row.pMarket < 0.5,
    },
  ];
  const sideValues = market === "moneyline" ? ["home", "away"] : ["over", "under"];
  const modifiers: Array<{ label: string; matches: (row: Observation) => boolean }> = [
    ...sideValues.map((side) => ({
      label: `side_${side}`,
      matches: (row: Observation) => row.side === side,
    })),
    { label: "underdog_price", matches: (row) => row.breakEven !== null && row.breakEven < 0.5 },
    { label: "moderate_favorite", matches: (row) => row.breakEven !== null && row.breakEven >= 0.5 && row.breakEven < 0.6 },
    { label: "strong_favorite", matches: (row) => row.breakEven !== null && row.breakEven >= 0.6 },
    { label: "projection_opposes", matches: (row) => row.signedProjectionEdge !== null && row.signedProjectionEdge < 0 },
    { label: "movement_against", matches: (row) => row.pairedMovement !== null && row.pairedMovement < -0.01 },
    { label: "money_lags_tickets", matches: (row) => row.moneyTicketGap !== null && row.moneyTicketGap < 0 },
    { label: "money_leads_tickets", matches: (row) => row.moneyTicketGap !== null && row.moneyTicketGap >= 0 },
    { label: "public_minority", matches: (row) => row.tickets !== null && row.tickets < 0.5 },
    { label: "public_majority", matches: (row) => row.tickets !== null && row.tickets >= 0.5 },
    { label: "currently_actionable", matches: (row) => row.currentActionable },
    { label: "currently_non_actionable", matches: (row) => !row.currentActionable },
  ];
  return [
    ...bases,
    ...bases.flatMap((base) => modifiers.map((modifier) => ({
      label: `${base.label}__${modifier.label}`,
      matches: (row: Observation) => base.matches(row) && modifier.matches(row),
    }))),
  ];
}

function predictionsForStructuralRule(rows: Observation[], rule: StructuralFlipRule): Prediction[] {
  return rows.flatMap((row) => row.pCurrent === null ? [] : [{
    row,
    probability: clampProbability(rule.matches(row) ? 1 - row.pCurrent : row.pCurrent),
  }]);
}

function selectStructuralFlipRule(
  development: Observation[],
  calibration: Observation[],
  market: Market,
): { rule: StructuralFlipRule; developmentGain: number; calibrationGain: number; hypotheses: number } | null {
  const scored = structuralFlipRules(market).flatMap((rule) => {
    const score = (rows: Observation[]) => {
      const changed = rows.filter(rule.matches);
      const incumbentWins = changed.reduce((sum, row) => sum + row.outcome, 0);
      return { flips: changed.length, gain: changed.length - 2 * incumbentWins };
    };
    const developmentScore = score(development);
    const calibrationScore = score(calibration);
    if (developmentScore.flips < 5 || calibrationScore.flips < 5) return [];
    return [{ rule, developmentGain: developmentScore.gain, calibrationGain: calibrationScore.gain }];
  });
  const eligible = scored.filter((candidate) => candidate.developmentGain > 0 && candidate.calibrationGain > 0);
  eligible.sort((left, right) =>
    (right.calibrationGain - left.calibrationGain)
    || (right.developmentGain - left.developmentGain));
  const selected = eligible[0];
  return selected ? { ...selected, hypotheses: scored.length } : null;
}

function structuralPredictionsForTraining(training: Observation[], test: Observation[]): Prediction[] | null {
  const dates = [...new Set(training.map((row) => row.date))].sort();
  const split = Math.max(1, Math.floor(dates.length * 0.7));
  const developmentDates = new Set(dates.slice(0, split));
  const calibrationDates = new Set(dates.slice(split));
  const market = training[0]?.market;
  if (training[0]?.sport !== "mlb" || (market !== "moneyline" && market !== "total")) return null;
  const selected = selectStructuralFlipRule(
    training.filter((row) => developmentDates.has(row.date)),
    training.filter((row) => calibrationDates.has(row.date)),
    market,
  );
  return selected ? predictionsForStructuralRule(test, selected.rule) : null;
}

function linearFormula(model: FittedLinear | null, names: string[]) {
  if (!model) return null;
  const coefficients = model.weights.slice(1).map((weight, index) => weight / model.scales[index]);
  const intercept = model.weights[0]
    - coefficients.reduce((sum, coefficient, index) => sum + coefficient * model.means[index], 0);
  return {
    intercept: round(intercept, 8),
    coefficients: Object.fromEntries(names.map((name, index) => [name, round(coefficients[index], 8)])),
  };
}

function scoreProjectionFormula(model: ScoreProjectionModel, validation: Observation[]) {
  const scoreNames = [
    "independent_runs", "posterior_runs", "market_total", "market_side_logit",
    "opposing_starter_era", "opposing_bullpen_factor", "batting_lineup_ops",
    "park_factor_runs", "weather_total_adjust",
  ];
  const totalNames = [
    "independent_total", "posterior_total", "market_total", "starter_era_sum",
    "bullpen_factor_sum", "lineup_ops_sum", "top_order_ops_sum", "park_factor_runs",
    "weather_total_adjust",
  ];
  return {
    source: "point_in_time_score_projection_residual_rebuild",
    lambda: model.lambda,
    homeRuns: linearFormula(model.home, scoreNames),
    awayRuns: linearFormula(model.away, scoreNames),
    totalRuns: linearFormula(model.total, totalNames),
    probabilityCalibration: {
      intercept: round(model.calibration.intercept, 8),
      slope: round(model.calibration.slope, 8),
    },
    projectionError: projectionErrorMetrics(validation, model),
    incumbentProjectionError: incumbentProjectionErrorMetrics(validation, model.market),
  };
}

function familyEvaluation(rows: Observation[], family: string) {
  const development = rows.filter((row) => row.partition === "development");
  const calibration = rows.filter((row) => row.partition === "calibration");
  const validation = rows.filter((row) => row.partition === "validation");
  const final = rows.filter((row) => row.partition === "final");
  if (family === "mlb_runtime_total_residual_projection") {
    if (rows[0]?.sport !== "mlb" || rows[0]?.market !== "total") return null;
    const candidates = LAMBDAS.flatMap((lambda) => {
      const model = fitRuntimeTotalResidualModel(development, lambda);
      if (!model) return [];
      const error = runtimeTotalResidualErrorMetrics(calibration, model);
      const predictionMetrics = metrics(predictionsForRuntimeTotalResidual(calibration, model));
      return error.rmse === null ? [] : [{ model, error, predictionMetrics }];
    }).sort((left, right) =>
      (left.error.rmse! - right.error.rmse!)
      || ((left.predictionMetrics.logLoss ?? Infinity) - (right.predictionMetrics.logLoss ?? Infinity)));
    const selected = candidates[0];
    if (!selected) return null;
    const validationModel = fitRuntimeTotalResidualModel(
      [...development, ...calibration],
      selected.model.lambda,
    );
    const finalModel = fitRuntimeTotalResidualModel(
      [...development, ...calibration, ...validation],
      selected.model.lambda,
    );
    if (!validationModel || !finalModel) return null;
    const validationPredictions = predictionsForRuntimeTotalResidual(validation, validationModel);
    const finalPredictions = predictionsForRuntimeTotalResidual(final, finalModel);
    return {
      family,
      searchedLambdas: LAMBDAS.length,
      selectedLambda: selected.model.lambda,
      calibration: selected.predictionMetrics,
      validation: metrics(validationPredictions),
      final: metrics(finalPredictions),
      validationFormula: runtimeTotalResidualFormula(validationModel, validation),
      finalFormula: runtimeTotalResidualFormula(finalModel, final),
      validationAdaptiveApplied: false,
      finalAdaptiveApplied: false,
      validationPredictions,
      finalPredictions,
    };
  }
  if (family === "mlb_moneyline_market_disagreement_resolver") {
    if (rows[0]?.sport !== "mlb" || rows[0]?.market !== "moneyline") return null;
    const candidates = LAMBDAS.flatMap((lambda) => {
      const model = fitLogistic(development, family, lambda);
      if (!model) return [];
      const predictionMetrics = metrics(predictionsForMoneylineDisagreementResolver(calibration, model));
      return predictionMetrics.logLoss === null ? [] : [{ model, predictionMetrics }];
    }).sort((left, right) =>
      (left.predictionMetrics.logLoss! - right.predictionMetrics.logLoss!)
      || ((left.predictionMetrics.brier ?? Infinity) - (right.predictionMetrics.brier ?? Infinity)));
    const selected = candidates[0];
    if (!selected) return null;
    const validationModel = fitLogistic([...development, ...calibration], family, selected.model.lambda);
    const finalModel = fitLogistic(
      [...development, ...calibration, ...validation],
      family,
      selected.model.lambda,
    );
    if (!validationModel || !finalModel) return null;
    const validationPredictions = predictionsForMoneylineDisagreementResolver(validation, validationModel);
    const finalPredictions = predictionsForMoneylineDisagreementResolver(final, finalModel);
    const formula = (model: FittedLogistic) => ({
      source: "locked_model_market_disagreement_classifier",
      formula: rawFormula(model, family),
      agreementTreatment: "retain_incumbent_probability",
      predictionTarget: "incumbent_selected_side_wins_when_locked_market_opposes",
    });
    return {
      family,
      searchedLambdas: LAMBDAS.length,
      selectedLambda: selected.model.lambda,
      calibration: selected.predictionMetrics,
      validation: metrics(validationPredictions),
      final: metrics(finalPredictions),
      validationFormula: formula(validationModel),
      finalFormula: formula(finalModel),
      validationAdaptiveApplied: false,
      finalAdaptiveApplied: false,
      validationPredictions,
      finalPredictions,
    };
  }
  if (family === "mlb_market_anchored_margin_projection") {
    if (rows[0]?.sport !== "mlb" || rows[0]?.market !== "moneyline") return null;
    const candidates = LAMBDAS.flatMap((lambda) => {
      const model = fitMarketAnchoredMarginModel(development, lambda);
      if (!model) return [];
      const error = marginErrorMetrics(calibration, (row) => predictMarketAnchoredMargin(row, model));
      const predictionMetrics = metrics(predictionsForMarketAnchoredMargin(calibration, model));
      return error.rmse === null ? [] : [{ model, error, predictionMetrics }];
    }).sort((left, right) =>
      (left.error.rmse! - right.error.rmse!)
      || ((left.predictionMetrics.logLoss ?? Infinity) - (right.predictionMetrics.logLoss ?? Infinity)));
    const selected = candidates[0];
    if (!selected) return null;
    const validationModel = fitMarketAnchoredMarginModel(
      [...development, ...calibration],
      selected.model.lambda,
    );
    const finalModel = fitMarketAnchoredMarginModel(
      [...development, ...calibration, ...validation],
      selected.model.lambda,
    );
    if (!validationModel || !finalModel) return null;
    const validationPredictions = predictionsForMarketAnchoredMargin(validation, validationModel);
    const finalPredictions = predictionsForMarketAnchoredMargin(final, finalModel);
    return {
      family,
      searchedLambdas: LAMBDAS.length,
      selectedLambda: selected.model.lambda,
      calibration: selected.predictionMetrics,
      validation: metrics(validationPredictions),
      final: metrics(finalPredictions),
      validationFormula: marketAnchoredMarginFormula(validationModel, validation),
      finalFormula: marketAnchoredMarginFormula(finalModel, final),
      validationAdaptiveApplied: false,
      finalAdaptiveApplied: false,
      validationPredictions,
      finalPredictions,
    };
  }
  if (family === "mlb_direct_residual_projection") {
    const market = rows[0]?.market;
    if (rows[0]?.sport !== "mlb" || (market !== "moneyline" && market !== "total")) return null;
    const candidates = LAMBDAS.flatMap((lambda) => {
      const model = fitResidualProjectionModel(development, market, lambda);
      if (!model) return [];
      const error = residualProjectionErrorMetrics(calibration, model);
      const predictionMetrics = metrics(predictionsForResidualProjection(calibration, model));
      return error.rmse === null ? [] : [{ model, error, predictionMetrics }];
    }).sort((left, right) =>
      (left.error.rmse! - right.error.rmse!)
      || ((left.predictionMetrics.logLoss ?? Infinity) - (right.predictionMetrics.logLoss ?? Infinity)));
    const selected = candidates[0];
    if (!selected) return null;
    const validationModel = fitResidualProjectionModel([...development, ...calibration], market, selected.model.lambda);
    const finalModel = fitResidualProjectionModel([...development, ...calibration, ...validation], market, selected.model.lambda);
    if (!validationModel || !finalModel) return null;
    const validationPredictions = predictionsForResidualProjection(validation, validationModel);
    const finalPredictions = predictionsForResidualProjection(final, finalModel);
    return {
      family,
      searchedLambdas: LAMBDAS.length,
      selectedLambda: selected.model.lambda,
      calibration: selected.predictionMetrics,
      validation: metrics(validationPredictions),
      final: metrics(finalPredictions),
      validationFormula: residualProjectionFormula(validationModel, validation),
      finalFormula: residualProjectionFormula(finalModel, final),
      validationAdaptiveApplied: false,
      finalAdaptiveApplied: false,
      validationPredictions,
      finalPredictions,
    };
  }
  if (family === "mlb_moneyline_projection_market_guard") {
    if (rows[0]?.sport !== "mlb" || rows[0]?.market !== "moneyline") return null;
    const candidates = LAMBDAS.flatMap((lambda) => {
      const model = fitScoreProjectionModel(development, "moneyline", lambda);
      if (!model) return [];
      const error = projectionErrorMetrics(calibration, model);
      const predictionMetrics = metrics(predictionsForMoneylineProjectionMarketGuard(calibration, model));
      return error.rmse === null ? [] : [{ model, error, predictionMetrics }];
    }).sort((left, right) =>
      (left.error.rmse! - right.error.rmse!)
      || ((left.predictionMetrics.logLoss ?? Infinity) - (right.predictionMetrics.logLoss ?? Infinity)));
    const selected = candidates[0];
    if (!selected) return null;
    const validationModel = fitScoreProjectionModel([...development, ...calibration], "moneyline", selected.model.lambda);
    const finalModel = fitScoreProjectionModel([...development, ...calibration, ...validation], "moneyline", selected.model.lambda);
    if (!validationModel || !finalModel) return null;
    const validationPredictions = predictionsForMoneylineProjectionMarketGuard(validation, validationModel);
    const finalPredictions = predictionsForMoneylineProjectionMarketGuard(final, finalModel);
    const formula = (model: ScoreProjectionModel, target: Observation[]) => ({
      ...scoreProjectionFormula(model, target),
      sideChangeGuard: "locked_selected_side_market_probability_below_0.45_and_projection_opposes",
    });
    return {
      family,
      searchedLambdas: LAMBDAS.length,
      selectedLambda: selected.model.lambda,
      calibration: selected.predictionMetrics,
      validation: metrics(validationPredictions),
      final: metrics(finalPredictions),
      validationFormula: formula(validationModel, validation),
      finalFormula: formula(finalModel, final),
      validationAdaptiveApplied: false,
      finalAdaptiveApplied: false,
      validationPredictions,
      finalPredictions,
    };
  }
  if (family === "mlb_score_projection_rebuild") {
    const market = rows[0]?.market;
    if (rows[0]?.sport !== "mlb" || (market !== "moneyline" && market !== "total")) return null;
    const lambdaCandidates = LAMBDAS.flatMap((lambda) => {
      const model = fitScoreProjectionModel(development, market, lambda);
      if (!model) return [];
      const error = projectionErrorMetrics(calibration, model);
      const predictionMetrics = metrics(predictionsForScoreProjection(calibration, model));
      return error.rmse === null ? [] : [{ model, error, predictionMetrics }];
    }).sort((left, right) =>
      (left.error.rmse! - right.error.rmse!)
      || ((left.predictionMetrics.logLoss ?? Infinity) - (right.predictionMetrics.logLoss ?? Infinity)));
    const selected = lambdaCandidates[0];
    if (!selected) return null;
    const validationModel = fitScoreProjectionModel([...development, ...calibration], market, selected.model.lambda);
    const finalModel = fitScoreProjectionModel([...development, ...calibration, ...validation], market, selected.model.lambda);
    if (!validationModel || !finalModel) return null;
    const validationPredictions = predictionsForScoreProjection(validation, validationModel);
    const finalPredictions = predictionsForScoreProjection(final, finalModel);
    return {
      family,
      searchedLambdas: LAMBDAS.length,
      selectedLambda: selected.model.lambda,
      calibration: selected.predictionMetrics,
      validation: metrics(validationPredictions),
      final: metrics(finalPredictions),
      validationFormula: scoreProjectionFormula(validationModel, validation),
      finalFormula: scoreProjectionFormula(finalModel, final),
      validationAdaptiveApplied: false,
      finalAdaptiveApplied: false,
      validationPredictions,
      finalPredictions,
    };
  }
  if (family === "mlb_structural_flip_selector") {
    const market = rows[0]?.market;
    if (rows[0]?.sport !== "mlb" || (market !== "moneyline" && market !== "total")) return null;
    const selected = selectStructuralFlipRule(development, calibration, market);
    if (!selected) return null;
    const calibrationPredictions = predictionsForStructuralRule(calibration, selected.rule);
    const validationPredictions = predictionsForStructuralRule(validation, selected.rule);
    const finalPredictions = predictionsForStructuralRule(final, selected.rule);
    const formula = {
      source: family,
      rule: selected.rule.label,
      hypotheses: selected.hypotheses,
      developmentNetCorrectGain: selected.developmentGain,
      calibrationNetCorrectGain: selected.calibrationGain,
    };
    return {
      family,
      searchedLambdas: 0,
      selectedLambda: 0,
      calibration: metrics(calibrationPredictions),
      validation: metrics(validationPredictions),
      final: metrics(finalPredictions),
      validationFormula: formula,
      finalFormula: formula,
      validationAdaptiveApplied: false,
      finalAdaptiveApplied: false,
      validationPredictions,
      finalPredictions,
    };
  }
  if (isRuleBasedSideFamily(family)) {
    const calibrationPredictions = predictionsForRuleBasedSideFamily(calibration, family);
    const validationPredictions = predictionsForRuleBasedSideFamily(validation, family);
    const finalPredictions = predictionsForRuleBasedSideFamily(final, family);
    if (validationPredictions.length < 10 || finalPredictions.length < 10) return null;
    return {
      family,
      searchedLambdas: 0,
      selectedLambda: 0,
      calibration: metrics(calibrationPredictions),
      validation: metrics(validationPredictions),
      final: metrics(finalPredictions),
      validationFormula: { source: family },
      finalFormula: { source: family },
      validationAdaptiveApplied: false,
      finalAdaptiveApplied: false,
      validationPredictions,
      finalPredictions,
    };
  }
  if (family === "market_consensus") {
    const calibrationPredictions = predictionsForBaseline(calibration, "market");
    const validationPredictions = predictionsForBaseline(validation, "market");
    const finalPredictions = predictionsForBaseline(final, "market");
    if (validationPredictions.length < 10 || finalPredictions.length < 10) return null;
    return {
      family,
      searchedLambdas: 0,
      selectedLambda: 0,
      calibration: metrics(calibrationPredictions),
      validation: metrics(validationPredictions),
      final: metrics(finalPredictions),
      validationFormula: { source: "locked_devigged_market_consensus" },
      finalFormula: { source: "locked_devigged_market_consensus" },
      validationAdaptiveApplied: false,
      finalAdaptiveApplied: false,
      validationPredictions,
      finalPredictions,
    };
  }
  const selected = chooseLambda(development, calibration, family);
  if (!selected) return null;
  const validationFit = chronologicalPredictions(
    [...development, ...calibration], validation, family, selected.model.lambda,
  );
  if (!validationFit) return null;
  const validationPredictions = validationFit.predictions;
  const finalFit = chronologicalPredictions(
    [...development, ...calibration, ...validation], final, family, selected.model.lambda,
  );
  if (!finalFit) return null;
  const finalPredictions = finalFit.predictions;
  const formula = (fit: typeof validationFit) => fit.model ? rawFormula(fit.model, family) : {
    intercept: 0,
    coefficients: { logit_current: 1 },
  };
  return {
    family,
    searchedLambdas: LAMBDAS.length,
    selectedLambda: selected.model.lambda,
    calibration: selected.calibration,
    validation: metrics(validationPredictions),
    final: metrics(finalPredictions),
    validationFormula: formula(validationFit),
    finalFormula: formula(finalFit),
    validationAdaptiveApplied: validationFit.applied,
    finalAdaptiveApplied: finalFit.applied,
    validationPredictions,
    finalPredictions,
  };
}

function commonMetrics(left: Prediction[], right: Prediction[]) {
  const rightIds = new Set(right.map((prediction) => prediction.row.id));
  const leftCommon = left.filter((prediction) => rightIds.has(prediction.row.id));
  const leftIds = new Set(leftCommon.map((prediction) => prediction.row.id));
  const rightCommon = right.filter((prediction) => leftIds.has(prediction.row.id));
  return { left: metrics(leftCommon), right: metrics(rightCommon) };
}

type SideSelectionMode = "all_rows" | "non_actionable_only" | "guarded_45" | "guarded_40";

function changesSelectedSide(prediction: Prediction, mode: SideSelectionMode): boolean {
  if (mode === "non_actionable_only" && prediction.row.currentActionable) return false;
  const threshold = mode === "guarded_45" ? 0.45 : mode === "guarded_40" ? 0.4 : 0.5;
  return prediction.probability < threshold;
}

function sideSelectedPredictions(
  predictions: Prediction[],
  mode: SideSelectionMode = "all_rows",
): Prediction[] {
  return predictions.map((prediction) => {
    if (!changesSelectedSide(prediction, mode)) {
      return {
        ...prediction,
        probability: mode === "guarded_45" || mode === "guarded_40"
          ? Math.max(0.5, prediction.row.pCurrent ?? prediction.probability)
          : Math.max(0.5, prediction.probability),
        row: { ...prediction.row, odds: null },
      };
    }
    return {
      probability: Math.max(0.5, 1 - prediction.probability),
      row: {
        ...prediction.row,
        side: oppositeSide(prediction.row.side) ?? prediction.row.side,
        outcome: 1 - prediction.row.outcome,
        result: prediction.row.result === "win" ? "loss" : "win",
        odds: null,
      },
    };
  });
}

function pricedSideSelectedPredictions(
  predictions: Prediction[],
  mode: SideSelectionMode = "all_rows",
): Prediction[] {
  return predictions.flatMap((prediction) => {
    if (!changesSelectedSide(prediction, mode)) {
      return [{
        ...prediction,
        probability: mode === "guarded_45" || mode === "guarded_40"
          ? Math.max(0.5, prediction.row.pCurrent ?? prediction.probability)
          : Math.max(0.5, prediction.probability),
      }];
    }
    const side = oppositeSide(prediction.row.side);
    if (!side) return [];
    const odds = prediction.row.oppositeOdds;
    const outcome = 1 - prediction.row.outcome;
    return [{
      probability: Math.max(0.5, 1 - prediction.probability),
      row: {
        ...prediction.row,
        side,
        outcome,
        result: outcome === 1 ? "win" as const : "loss" as const,
        odds,
        oppositeOdds: prediction.row.odds,
        breakEven: odds === null ? null : breakEvenProbability(odds),
        oppositeLockedPriceAvailable: prediction.row.odds !== null,
      },
    }];
  });
}

function sideSelectionSummary(predictions: Prediction[], mode: SideSelectionMode = "all_rows") {
  const selected = sideSelectedPredictions(predictions, mode);
  const changed = predictions.filter((prediction) => changesSelectedSide(prediction, mode));
  return {
    metrics: metrics(selected),
    sideChanges: changed.length,
    sideChangePct: predictions.length
      ? round(changed.length / predictions.length * 100, 1)
      : 0,
  };
}

function rollingSideSelectionEvaluation(
  rows: Observation[],
  family: string,
  lambda: number,
  mode: SideSelectionMode,
) {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const origins = [0.4, 0.55, 0.7, 0.85];
  return origins.flatMap((fraction, index) => {
    const trainEnd = Math.max(1, Math.floor(dates.length * fraction));
    const testEnd = index === origins.length - 1
      ? dates.length
      : Math.max(trainEnd + 1, Math.floor(dates.length * origins[index + 1]));
    const trainDates = new Set(dates.slice(0, trainEnd));
    const testDates = new Set(dates.slice(trainEnd, testEnd));
    const training = rows.filter((row) => trainDates.has(row.date));
    const test = rows.filter((row) => testDates.has(row.date));
    const fitted = family === "market_consensus"
      ? { predictions: predictionsForBaseline(test, "market") }
      : family === "mlb_runtime_total_residual_projection"
        ? (() => {
          const model = fitRuntimeTotalResidualModel(training, lambda);
          return model ? {
            predictions: predictionsForRuntimeTotalResidual(test, model),
            projectionError: runtimeTotalResidualErrorMetrics(test, model),
            incumbentProjectionError: incumbentProjectionErrorMetrics(test, "total"),
          } : null;
        })()
      : family === "mlb_moneyline_market_disagreement_resolver"
        ? (() => {
          const model = fitLogistic(training, family, lambda);
          return model ? { predictions: predictionsForMoneylineDisagreementResolver(test, model) } : null;
        })()
      : family === "mlb_market_anchored_margin_projection"
        ? (() => {
          const model = fitMarketAnchoredMarginModel(training, lambda);
          return model ? {
            predictions: predictionsForMarketAnchoredMargin(test, model),
            projectionError: marginErrorMetrics(test, (row) => predictMarketAnchoredMargin(row, model)),
            incumbentProjectionError: incumbentProjectionErrorMetrics(test, "moneyline"),
          } : null;
        })()
      : family === "mlb_direct_residual_projection"
        ? (() => {
          const market = training[0]?.market;
          if (market !== "moneyline" && market !== "total") return null;
          const model = fitResidualProjectionModel(training, market, lambda);
          return model ? {
            predictions: predictionsForResidualProjection(test, model),
            projectionError: residualProjectionErrorMetrics(test, model),
            incumbentProjectionError: incumbentProjectionErrorMetrics(test, market),
          } : null;
        })()
      : family === "mlb_moneyline_projection_market_guard"
        ? (() => {
          const model = fitScoreProjectionModel(training, "moneyline", lambda);
          return model ? {
            predictions: predictionsForMoneylineProjectionMarketGuard(test, model),
            projectionError: projectionErrorMetrics(test, model),
            incumbentProjectionError: incumbentProjectionErrorMetrics(test, "moneyline"),
          } : null;
        })()
      : family === "mlb_score_projection_rebuild"
        ? (() => {
          const market = training[0]?.market;
          if (market !== "moneyline" && market !== "total") return null;
          const model = fitScoreProjectionModel(training, market, lambda);
          return model ? {
            predictions: predictionsForScoreProjection(test, model),
            projectionError: projectionErrorMetrics(test, model),
            incumbentProjectionError: incumbentProjectionErrorMetrics(test, market),
          } : null;
        })()
      : family === "mlb_structural_flip_selector"
        ? (() => {
          const predictions = structuralPredictionsForTraining(training, test);
          return predictions ? { predictions } : null;
        })()
      : isRuleBasedSideFamily(family)
        ? { predictions: predictionsForRuleBasedSideFamily(test, family) }
      : chronologicalPredictions(training, test, family, lambda);
    if (!fitted) return [];
    const incumbent = predictionsForBaseline(test, "incumbent");
    const candidateIds = new Set(fitted.predictions.map((prediction) => prediction.row.id));
    const incumbentCommon = incumbent.filter((prediction) => candidateIds.has(prediction.row.id));
    const incumbentIds = new Set(incumbentCommon.map((prediction) => prediction.row.id));
    const candidateCommon = fitted.predictions.filter((prediction) => incumbentIds.has(prediction.row.id));
    const candidate = sideSelectionSummary(candidateCommon, mode);
    const incumbentMetrics = metrics(incumbentCommon);
    const accuracyDelta = candidate.metrics.accuracyPct === null || incumbentMetrics.accuracyPct === null
      ? null
      : round(candidate.metrics.accuracyPct - incumbentMetrics.accuracyPct, 1);
    return [{
      testFrom: dates[trainEnd],
      testThrough: dates[testEnd - 1],
      candidate: candidate.metrics,
      incumbent: incumbentMetrics,
      sideChanges: candidate.sideChanges,
      accuracyDelta,
      improvesAccuracy: accuracyDelta !== null && accuracyDelta > 0,
      candidateProjectionError: "projectionError" in fitted ? fitted.projectionError : null,
      incumbentProjectionError: "incumbentProjectionError" in fitted ? fitted.incumbentProjectionError : null,
    }];
  });
}

function rawSideSelectionTournament(
  evaluations: NonNullable<ReturnType<typeof familyEvaluation>>[],
  rows: Observation[],
) {
  const validationIncumbent = predictionsForBaseline(
    rows.filter((row) => row.partition === "validation"), "incumbent",
  );
  const finalIncumbent = predictionsForBaseline(
    rows.filter((row) => row.partition === "final"), "incumbent",
  );
  const candidates = evaluations.flatMap((evaluation) => (["all_rows", "non_actionable_only", "guarded_45", "guarded_40"] as const).flatMap((selectionMode) => {
    const common = (candidateRaw: Prediction[], incumbentRaw: Prediction[]) => {
      const candidateIds = new Set(candidateRaw.map((prediction) => prediction.row.id));
      const incumbent = incumbentRaw.filter((prediction) => candidateIds.has(prediction.row.id));
      const incumbentIds = new Set(incumbent.map((prediction) => prediction.row.id));
      const candidate = candidateRaw.filter((prediction) => incumbentIds.has(prediction.row.id));
      return { candidate: sideSelectionSummary(candidate, selectionMode), incumbent: metrics(incumbent) };
    };
    const validation = common(evaluation.validationPredictions, validationIncumbent);
    const final = common(evaluation.finalPredictions, finalIncumbent);
    const rolling = rollingSideSelectionEvaluation(rows, evaluation.family, evaluation.selectedLambda, selectionMode);
    if (
      validation.candidate.metrics.rows < 20
      || final.candidate.metrics.rows < 10
      || validation.candidate.metrics.accuracyPct === null
      || validation.incumbent.accuracyPct === null
      || final.candidate.metrics.accuracyPct === null
      || final.incumbent.accuracyPct === null
    ) return [];
    const validationAccuracyDelta = round(
      validation.candidate.metrics.accuracyPct - validation.incumbent.accuracyPct, 1,
    );
    const finalAccuracyDelta = round(
      final.candidate.metrics.accuracyPct - final.incumbent.accuracyPct, 1,
    );
    const combinedCandidateWins = Number(validation.candidate.metrics.record.split("-")[0])
      + Number(final.candidate.metrics.record.split("-")[0]);
    const combinedIncumbentWins = Number(validation.incumbent.record.split("-")[0])
      + Number(final.incumbent.record.split("-")[0]);
    const combinedRows = validation.candidate.metrics.rows + final.candidate.metrics.rows;
    const combinedAccuracyDelta = round(
      (combinedCandidateWins - combinedIncumbentWins) / combinedRows * 100, 1,
    );
    const rollingAccuracyWins = rolling.filter((fold) => fold.improvesAccuracy).length;
    const rollingProjectionFolds = rolling.filter((fold) =>
      finite(object(fold.candidateProjectionError)?.rmse) !== null
      && finite(object(fold.incumbentProjectionError)?.rmse) !== null);
    const rollingProjectionWins = rollingProjectionFolds.filter((fold) =>
      finite(object(fold.candidateProjectionError)?.rmse)! < finite(object(fold.incumbentProjectionError)?.rmse)!).length;
    const validationProjectionRmse = finite(nested(evaluation.validationFormula, "projectionError", "rmse"));
    const validationIncumbentProjectionRmse = finite(nested(evaluation.validationFormula, "incumbentProjectionError", "rmse"));
    const finalProjectionRmse = finite(nested(evaluation.finalFormula, "projectionError", "rmse"));
    const finalIncumbentProjectionRmse = finite(nested(evaluation.finalFormula, "incumbentProjectionError", "rmse"));
    const projectionGate =
      validationProjectionRmse !== null
      && validationIncumbentProjectionRmse !== null
      && finalProjectionRmse !== null
      && finalIncumbentProjectionRmse !== null
      && validationProjectionRmse <= validationIncumbentProjectionRmse
      && finalProjectionRmse < finalIncumbentProjectionRmse
      && rollingProjectionFolds.length > 0
      && rollingProjectionWins >= Math.ceil(rollingProjectionFolds.length / 2);
    const properScoreSafe =
      validation.candidate.metrics.brier !== null
      && validation.incumbent.brier !== null
      && final.candidate.metrics.brier !== null
      && final.incumbent.brier !== null
      && validation.candidate.metrics.logLoss !== null
      && validation.incumbent.logLoss !== null
      && final.candidate.metrics.logLoss !== null
      && final.incumbent.logLoss !== null
      && validation.candidate.metrics.brier <= validation.incumbent.brier + 0.005
      && validation.candidate.metrics.logLoss <= validation.incumbent.logLoss + 0.01
      && final.candidate.metrics.brier <= final.incumbent.brier + 0.005
      && final.candidate.metrics.logLoss <= final.incumbent.logLoss + 0.01;
    return [{
      family: evaluation.family,
      selectionMode,
      selectedLambda: evaluation.selectedLambda,
      validation,
      final,
      validationAccuracyDelta,
      finalAccuracyDelta,
      combinedAccuracyDelta,
      combinedSideChanges: validation.candidate.sideChanges + final.candidate.sideChanges,
      rolling,
      rollingAccuracyWins,
      rollingRequired: Math.ceil(rolling.length / 2),
      rollingProjectionWins,
      rollingProjectionRequired: Math.ceil(rollingProjectionFolds.length / 2),
      projectionGate,
      properScoreSafe,
      validationFormula: evaluation.validationFormula,
      finalFormula: evaluation.finalFormula,
      qualifies:
        (
          validationAccuracyDelta >= 0
          && finalAccuracyDelta > 0
          && combinedAccuracyDelta >= 1
          && rolling.length > 0
          && rollingAccuracyWins >= Math.ceil(rolling.length / 2)
          || projectionGate
          && validationAccuracyDelta >= -2
          && finalAccuracyDelta > 0
          && combinedAccuracyDelta > 0
          && rollingAccuracyWins >= 1
        )
        && validation.candidate.sideChanges > 0
        && final.candidate.sideChanges > 0
        && properScoreSafe,
    }];
  }));
  const eligible = candidates.filter((candidate) => candidate.qualifies).sort((left, right) =>
    (right.combinedAccuracyDelta - left.combinedAccuracyDelta)
    || (right.finalAccuracyDelta - left.finalAccuracyDelta)
    || (left.final.candidate.metrics.logLoss! - right.final.candidate.metrics.logLoss!));
  return {
    objective: "improve_raw_selected_side_accuracy_before_action_filtering",
    candidatesTested: candidates.length,
    eligibleCandidates: eligible.length,
    selected: eligible[0] ?? null,
    eligible: eligible.slice(0, 10),
    ranking: candidates.sort((left, right) =>
      (right.combinedAccuracyDelta - left.combinedAccuracyDelta)
      || (right.finalAccuracyDelta - left.finalAccuracyDelta)),
  };
}

function marketDisagreementDiagnostics(rows: Observation[]) {
  const eligible = rows.filter((row) =>
    row.sport === "mlb"
    && row.market === "moneyline"
    && row.pCurrent !== null
    && row.pMarket !== null
    && row.pMarket < 0.45);
  const labels = (row: Observation) => {
    const oddsBand = row.odds === null
      ? "odds_missing"
      : row.odds > 0 ? "plus_money" : row.odds >= -140 ? "minus_100_to_139" : "minus_140_or_shorter";
    const marketBand = row.pMarket! < 0.35
      ? "market_below_35"
      : row.pMarket! < 0.4 ? "market_35_to_40" : "market_40_to_45";
    const confidenceBand = row.pCurrent! < 0.55
      ? "current_below_55"
      : row.pCurrent! < 0.6 ? "current_55_to_60" : "current_60_plus";
    const independent = row.pIndependent === null
      ? "independent_missing"
      : row.pIndependent >= 0.5 ? "independent_supports_incumbent" : "independent_opposes_incumbent";
    const projection = row.signedProjectionEdge === null
      ? "projection_missing"
      : row.signedProjectionEdge >= 0 ? "projection_supports_incumbent" : "projection_opposes_incumbent";
    const base = [
      "all", `side_${row.side}`, oddsBand, marketBand, confidenceBand, independent, projection,
    ];
    return [...base, `side_${row.side}__${marketBand}`, `${oddsBand}__${marketBand}`];
  };
  const cohorts = [...new Set(eligible.flatMap(labels))].sort();
  const summarize = (partition: Partition, cohort: string) => {
    const target = eligible.filter((row) => row.partition === partition && labels(row).includes(cohort));
    const incumbent = predictionsForBaseline(target, "incumbent");
    const flipped = oppositePredictions(incumbent);
    const incumbentMetrics = metrics(incumbent);
    const flippedMetrics = metrics(flipped);
    return {
      rows: target.length,
      incumbentAccuracyPct: incumbentMetrics.accuracyPct,
      flippedAccuracyPct: flippedMetrics.accuracyPct,
      flipAccuracyDeltaPp: incumbentMetrics.accuracyPct === null || flippedMetrics.accuracyPct === null
        ? null
        : round(flippedMetrics.accuracyPct - incumbentMetrics.accuracyPct, 1),
    };
  };
  return cohorts.map((cohort) => ({
    cohort,
    development: summarize("development", cohort),
    calibration: summarize("calibration", cohort),
    validation: summarize("validation", cohort),
    final: summarize("final", cohort),
  })).filter((cohort) => cohort.validation.rows > 0 || cohort.final.rows > 0);
}

function rankingLift(predictions: Prediction[]) {
  const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
  const buckets = Array.from({ length: 5 }, (_, index) => {
    const start = Math.floor(index * sorted.length / 5);
    const end = Math.floor((index + 1) * sorted.length / 5);
    return metrics(sorted.slice(start, end));
  });
  return { quintilesHighToLow: buckets, monotonicAccuracy: buckets.every((bucket, index) =>
    index === 0 || bucket.accuracyPct === null || buckets[index - 1].accuracyPct === null
      || buckets[index - 1].accuracyPct! >= bucket.accuracyPct!),
  };
}

function rollingOriginEvaluation(rows: Observation[], family: string, lambda: number) {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const origins = [0.4, 0.55, 0.7, 0.85];
  return origins.flatMap((fraction, index) => {
    const trainEnd = Math.max(1, Math.floor(dates.length * fraction));
    const testEnd = index === origins.length - 1
      ? dates.length
      : Math.max(trainEnd + 1, Math.floor(dates.length * origins[index + 1]));
    const trainDates = new Set(dates.slice(0, trainEnd));
    const testDates = new Set(dates.slice(trainEnd, testEnd));
    const training = rows.filter((row) => trainDates.has(row.date));
    const test = rows.filter((row) => testDates.has(row.date));
    const fitted = family === "market_consensus"
      ? { predictions: predictionsForBaseline(test, "market") }
      : chronologicalPredictions(training, test, family, lambda);
    if (!fitted) return [];
    const candidate = fitted.predictions;
    const incumbent = predictionsForBaseline(test, "incumbent");
    const common = commonMetrics(candidate, incumbent);
    const improvesBoth =
      common.left.rows >= 10
      && common.left.brier !== null
      && common.right.brier !== null
      && common.left.logLoss !== null
      && common.right.logLoss !== null
      && common.left.brier <= common.right.brier
      && common.left.logLoss <= common.right.logLoss;
    return [{
      trainThrough: dates[trainEnd - 1],
      testFrom: dates[trainEnd],
      testThrough: dates[testEnd - 1],
      candidate: common.left,
      incumbent: common.right,
      improvesBoth,
    }];
  });
}

function probabilityChampionTournament(
  evaluations: NonNullable<ReturnType<typeof familyEvaluation>>[],
  rows: Observation[],
) {
  const validationRows = rows.filter((row) => row.partition === "validation");
  const finalRows = rows.filter((row) => row.partition === "final");
  const incumbentValidation = predictionsForBaseline(validationRows, "incumbent");
  const incumbentFinal = predictionsForBaseline(finalRows, "incumbent");
  const marketValidation = predictionsForBaseline(validationRows, "market");
  const marketFinal = predictionsForBaseline(finalRows, "market");
  const candidates = evaluations.flatMap((evaluation) => {
    const validationVsIncumbent = commonMetrics(evaluation.validationPredictions, incumbentValidation);
    const finalVsIncumbent = commonMetrics(evaluation.finalPredictions, incumbentFinal);
    const combinedVsIncumbent = commonMetrics(
      [...evaluation.validationPredictions, ...evaluation.finalPredictions],
      [...incumbentValidation, ...incumbentFinal],
    );
    const combinedVsMarket = commonMetrics(
      [...evaluation.validationPredictions, ...evaluation.finalPredictions],
      [...marketValidation, ...marketFinal],
    );
    const rolling = rollingOriginEvaluation(rows, evaluation.family, evaluation.selectedLambda);
    const selectedSideCoherent = [
      ...evaluation.validationPredictions,
      ...evaluation.finalPredictions,
    ].every((prediction) => prediction.probability >= 0.5);
    const combinedProbabilities = [
      ...evaluation.validationPredictions,
      ...evaluation.finalPredictions,
    ].map((prediction) => prediction.probability);
    const probabilityMean = combinedProbabilities.reduce((sum, probability) => sum + probability, 0)
      / combinedProbabilities.length;
    const probabilityStandardDeviation = Math.sqrt(
      combinedProbabilities.reduce((sum, probability) => sum + (probability - probabilityMean) ** 2, 0)
      / combinedProbabilities.length,
    );
    const informativeProbability = probabilityStandardDeviation >= 0.002;
    const candidateCombined = combinedVsIncumbent.left;
    const incumbentCombined = combinedVsIncumbent.right;
    const candidateFinal = finalVsIncumbent.left;
    const incumbentFinalCommon = finalVsIncumbent.right;
    if (
      candidateCombined.rows < 20
      || candidateFinal.rows < 10
      || candidateCombined.brier === null
      || candidateCombined.logLoss === null
      || incumbentCombined.brier === null
      || incumbentCombined.logLoss === null
      || candidateFinal.brier === null
      || candidateFinal.logLoss === null
      || incumbentFinalCommon.brier === null
      || incumbentFinalCommon.logLoss === null
    ) return [];
    const combinedBrierDelta = round(incumbentCombined.brier - candidateCombined.brier, 4);
    const combinedLogLossDelta = round(incumbentCombined.logLoss - candidateCombined.logLoss, 4);
    const finalBrierRegression = round(candidateFinal.brier - incumbentFinalCommon.brier, 4);
    const finalLogLossRegression = round(candidateFinal.logLoss - incumbentFinalCommon.logLoss, 4);
    const rollingWins = rolling.filter((fold) => fold.improvesBoth).length;
    return [{
      family: evaluation.family,
      selectedLambda: evaluation.selectedLambda,
      validationVsIncumbent,
      finalVsIncumbent,
      combinedVsIncumbent,
      combinedVsMarket,
      combinedBrierDelta,
      combinedLogLossDelta,
      finalBrierRegression,
      finalLogLossRegression,
      rolling: {
        folds: rolling,
        improvesBoth: rollingWins,
        required: Math.ceil(rolling.length / 2),
      },
      selectedSideCoherent,
      informativeProbability,
      probabilityStandardDeviation: round(probabilityStandardDeviation, 4),
      formula: evaluation.finalFormula,
      qualifies:
        combinedBrierDelta > 0
        && combinedLogLossDelta > 0
        && rolling.length > 0
        && rollingWins >= Math.ceil(rolling.length / 2)
        && finalBrierRegression <= 0.002
        && finalLogLossRegression <= 0.005
        && !(finalBrierRegression > 0 && finalLogLossRegression > 0)
        && selectedSideCoherent
        && informativeProbability,
    }];
  });
  const eligible = candidates.filter((candidate) => candidate.qualifies).sort((left, right) =>
    (left.combinedVsIncumbent.left.logLoss! - right.combinedVsIncumbent.left.logLoss!)
    || (left.combinedVsIncumbent.left.brier! - right.combinedVsIncumbent.left.brier!));
  return {
    objective: "best_chronological_probability_model_before_action_optimization",
    candidatesTested: candidates.length,
    eligibleCandidates: eligible.length,
    selected: eligible[0] ?? null,
    ranking: candidates.sort((left, right) =>
      (left.combinedVsIncumbent.left.logLoss! - right.combinedVsIncumbent.left.logLoss!)
      || (left.combinedVsIncumbent.left.brier! - right.combinedVsIncumbent.left.brier!)),
  };
}

function actionPredictions(predictions: Prediction[], margin: number): Prediction[] {
  return predictions.filter((prediction) =>
    !prediction.row.noBet
    && prediction.row.breakEven !== null
    && prediction.probability >= prediction.row.breakEven + margin);
}

function oppositePredictions(predictions: Prediction[]): Prediction[] {
  return predictions.flatMap((prediction) => {
    const side = oppositeSide(prediction.row.side);
    if (!side || prediction.row.oppositeOdds === null) return [];
    const outcome = prediction.row.outcome === 1 ? 0 : 1;
    return [{
      probability: clampProbability(1 - prediction.probability),
      row: {
        ...prediction.row,
        side,
        outcome,
        result: outcome === 1 ? "win" as const : "loss" as const,
        odds: prediction.row.oppositeOdds,
        breakEven: breakEvenProbability(prediction.row.oppositeOdds),
      },
    }];
  });
}

function currentActionPredictions(rows: Prediction[]): Prediction[] {
  return rows.filter((prediction) => prediction.row.currentActionable);
}

function composeActionPolicy(
  current: Prediction[],
  proposed: Prediction[],
  policy: "replace" | "union" | "intersection",
): Prediction[] {
  const key = (prediction: Prediction) => `${prediction.row.id}|${prediction.row.side}`;
  if (policy === "replace") return proposed;
  const proposedByKey = new Map(proposed.map((prediction) => [key(prediction), prediction]));
  if (policy === "intersection") {
    return current.flatMap((prediction) => {
      const matched = proposedByKey.get(key(prediction));
      return matched ? [matched] : [];
    });
  }
  return [...new Map([...current, ...proposed].map((prediction) => [key(prediction), prediction])).values()];
}

type PriceScope = "all" | "favorite" | "-150_-101" | "-120_+129" | "+100_+129" | "gte_+130";

function inPriceScope(prediction: Prediction, scope: PriceScope): boolean {
  const odds = prediction.row.odds;
  if (scope === "all") return true;
  if (odds === null) return false;
  if (scope === "favorite") return odds < 100;
  if (scope === "-150_-101") return odds >= -150 && odds <= -101;
  if (scope === "-120_+129") return odds >= -120 && odds <= 129;
  if (scope === "+100_+129") return odds >= 100 && odds <= 129;
  return odds >= 130;
}

function composeScopedActionPolicy(
  current: Prediction[],
  proposed: Prediction[],
  policy: "replace" | "union" | "intersection",
  scope: PriceScope,
): Prediction[] {
  if (scope === "all") return composeActionPolicy(current, proposed, policy);
  const currentOutside = current.filter((prediction) => !inPriceScope(prediction, scope));
  const currentInside = current.filter((prediction) => inPriceScope(prediction, scope));
  const proposedInside = proposed.filter((prediction) => inPriceScope(prediction, scope));
  return [...currentOutside, ...composeActionPolicy(currentInside, proposedInside, policy)];
}

function actionDeltaStrata(current: Prediction[], candidate: Prediction[]) {
  const summarize = (label: (prediction: Prediction) => string) => {
    const keys = [...new Set([...current, ...candidate].map(label))].sort();
    return Object.fromEntries(keys.map((key) => {
      const currentRows = current.filter((prediction) => label(prediction) === key);
      const candidateRows = candidate.filter((prediction) => label(prediction) === key);
      return [key, {
        current: metrics(currentRows),
        candidate: metrics(candidateRows),
        deltaUnits: round(metrics(candidateRows).units - metrics(currentRows).units, 3),
      }];
    }));
  };
  const oddsBand = (prediction: Prediction) => {
    const odds = prediction.row.odds;
    if (odds === null) return "missing";
    if (odds <= -151) return "lte_-151";
    if (odds <= -121) return "-150_-121";
    if (odds < 100) return "-120_-101";
    if (odds <= 129) return "+100_+129";
    return "gte_+130";
  };
  return {
    side: summarize((prediction) => prediction.row.side),
    oddsBand: summarize(oddsBand),
    release: summarize((prediction) => prediction.row.decisionRelease),
  };
}

function hasMaterialCombinedStratumLoss(
  validationRaw: unknown,
  finalRaw: unknown,
  dimension: "side" | "oddsBand",
): boolean {
  const validation = object(object(validationRaw)?.[dimension]) ?? {};
  const final = object(object(finalRaw)?.[dimension]) ?? {};
  const keys = new Set([...Object.keys(validation), ...Object.keys(final)]);
  return [...keys].some((key) => {
    const validationStratum = object(validation[key]);
    const finalStratum = object(final[key]);
    const exposure =
      Math.max(
        finite(nested(validationStratum, "current", "rows")) ?? 0,
        finite(nested(validationStratum, "candidate", "rows")) ?? 0,
      )
      + Math.max(
        finite(nested(finalStratum, "current", "rows")) ?? 0,
        finite(nested(finalStratum, "candidate", "rows")) ?? 0,
      );
    const delta =
      (finite(validationStratum?.deltaUnits) ?? 0)
      + (finite(finalStratum?.deltaUnits) ?? 0);
    return exposure >= 5 && delta < -2;
  });
}

function byDateUnits(predictions: Prediction[]): Map<string, number> {
  const values = new Map<string, number>();
  for (const prediction of predictions) {
    const unit = profit(prediction.row.result, prediction.row.odds);
    if (unit === null) continue;
    values.set(prediction.row.date, (values.get(prediction.row.date) ?? 0) + unit);
  }
  return values;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function actionRobustness(predictions: Prediction[]) {
  const dateUnits = [...byDateUnits(predictions).entries()];
  if (dateUnits.length === 0) {
    return { bootstrapPositiveProbability: null, unitsWithoutBestDate: null, dates: 0 };
  }
  const random = seededRandom(20260815);
  let positive = 0;
  for (let draw = 0; draw < BOOTSTRAP_DRAWS; draw++) {
    let units = 0;
    for (let index = 0; index < dateUnits.length; index++) {
      units += dateUnits[Math.floor(random() * dateUnits.length)][1];
    }
    if (units > 0) positive++;
  }
  const best = [...dateUnits].sort((a, b) => b[1] - a[1])[0];
  return {
    bootstrapPositiveProbability: round(positive / BOOTSTRAP_DRAWS, 4),
    unitsWithoutBestDate: round(dateUnits.filter(([date]) => date !== best[0]).reduce((sum, [, value]) => sum + value, 0), 3),
    dates: dateUnits.length,
  };
}

function pairedDeltaRobustness(current: Prediction[], candidate: Prediction[]) {
  const currentByDate = byDateUnits(current);
  const candidateByDate = byDateUnits(candidate);
  const dates = [...new Set([...currentByDate.keys(), ...candidateByDate.keys()])].sort();
  if (dates.length === 0) {
    return { bootstrapPositiveProbability: null, deltaWithoutBestDate: null, dates: 0 };
  }
  const deltas = dates.map((date) => (candidateByDate.get(date) ?? 0) - (currentByDate.get(date) ?? 0));
  const random = seededRandom(20260816);
  let positive = 0;
  for (let draw = 0; draw < BOOTSTRAP_DRAWS; draw++) {
    let delta = 0;
    for (let index = 0; index < deltas.length; index++) delta += deltas[Math.floor(random() * deltas.length)];
    if (delta > 0) positive++;
  }
  const bestIndex = deltas.reduce((best, value, index) => value > deltas[best] ? index : best, 0);
  return {
    bootstrapPositiveProbability: round(positive / BOOTSTRAP_DRAWS, 4),
    deltaWithoutBestDate: round(deltas.reduce((sum, value, index) => index === bestIndex ? sum : sum + value, 0), 3),
    dates: dates.length,
  };
}

function chooseActionPolicy(validation: Prediction[]) {
  const directions = [
    { direction: "original", predictions: validation },
    { direction: "opposite", predictions: oppositePredictions(validation) },
  ] as const;
  const candidates = directions.flatMap(({ direction, predictions }) => ACTION_MARGINS.map((margin) => {
    const selected = actionPredictions(predictions, margin);
    return { direction, margin, metrics: metrics(selected), robustness: actionRobustness(selected) };
  }));
  const eligible = candidates.filter((candidate) =>
    candidate.metrics.rows >= 20
    && candidate.metrics.dates >= 10);
  eligible.sort((left, right) =>
    (right.metrics.units - left.metrics.units)
    || (right.metrics.roiPct ?? -Infinity) - (left.metrics.roiPct ?? -Infinity));
  return { selected: eligible[0] ?? null, candidates };
}

function mechanicalCohortLabels(prediction: Prediction): string[] {
  const row = prediction.row;
  const oddsBand = row.odds === null ? null
    : row.odds <= -151 ? "lte_-151"
      : row.odds <= -121 ? "-150_-121"
        : row.odds < 100 ? "-120_-101"
          : row.odds <= 129 ? "+100_+129" : "gte_+130";
  const modelMarketGap = row.pMarket === null ? null : prediction.probability - row.pMarket;
  const modelGapBand = modelMarketGap === null ? null
    : modelMarketGap <= -0.05 ? "lte_-5pp"
      : modelMarketGap <= -0.02 ? "-5pp_-2pp"
        : modelMarketGap < 0.02 ? "within_2pp"
          : modelMarketGap < 0.05 ? "+2pp_+5pp" : "gte_+5pp";
  const ticketBand = row.tickets === null ? null
    : row.tickets < 0.35 ? "lt_35pct"
      : row.tickets < 0.5 ? "35_49pct"
        : row.tickets < 0.65 ? "50_64pct" : "gte_65pct";
  const splitBand = row.moneyTicketGap === null ? null
    : row.moneyTicketGap <= -0.1 ? "money_lags_10pp"
      : row.moneyTicketGap >= 0.1 ? "money_leads_10pp" : "gap_within_10pp";
  const movementBand = row.pairedMovement === null ? null
    : row.pairedMovement <= -0.02 ? "against_2pp"
      : row.pairedMovement >= 0.02 ? "toward_2pp" : "within_2pp";
  const dimensions = [
    ["side", row.side],
    ["odds", oddsBand],
    ["model_market_gap", modelGapBand],
    ["tickets", ticketBand],
    ["money_ticket_gap", splitBand],
    ["movement", movementBand],
    ["diagnosis", marketDiagnosis(row)],
  ].filter((entry): entry is [string, string] => entry[1] !== null);
  const singles = dimensions.map(([name, value]) => `${name}=${value}`);
  const byName = new Map(dimensions);
  const pairs = [
    ["side", "odds"],
    ["odds", "model_market_gap"],
    ["odds", "money_ticket_gap"],
    ["diagnosis", "odds"],
    ["diagnosis", "money_ticket_gap"],
    ["diagnosis", "movement"],
  ].flatMap(([left, right]) => {
    const leftValue = byName.get(left);
    const rightValue = byName.get(right);
    return leftValue && rightValue ? [`${left}=${leftValue}&${right}=${rightValue}`] : [];
  });
  return [...singles, ...pairs];
}

function evaluateSpecificFlipCohorts(validation: Prediction[], final: Prediction[]) {
  const labels = [...new Set(validation.flatMap(mechanicalCohortLabels))].sort();
  const candidates = labels.flatMap((cohort) => ACTION_MARGINS.map((margin) => {
    const validationOriginal = validation.filter((prediction) => mechanicalCohortLabels(prediction).includes(cohort));
    const finalOriginal = final.filter((prediction) => mechanicalCohortLabels(prediction).includes(cohort));
    const validationActions = actionPredictions(oppositePredictions(validationOriginal), margin);
    const finalActions = actionPredictions(oppositePredictions(finalOriginal), margin);
    return {
      cohort,
      margin,
      validation: metrics(validationActions),
      validationRobustness: actionRobustness(validationActions),
      final: metrics(finalActions),
      finalRobustness: actionRobustness(finalActions),
    };
  }));
  const eligible = candidates.filter((candidate) =>
    candidate.validation.rows >= 20
    && candidate.validation.dates >= 10);
  const ranked = [...eligible].sort((left, right) =>
    (right.validation.units - left.validation.units)
    || (right.validation.roiPct ?? -Infinity) - (left.validation.roiPct ?? -Infinity));
  const selected = ranked[0] ?? null;
  const passesHistoricalGate = selected !== null
    && selected.validation.units > 0
    && (selected.validationRobustness.bootstrapPositiveProbability ?? 0) >= 0.99
    && (selected.validationRobustness.unitsWithoutBestDate ?? -Infinity) > 0
    && selected.final.rows > 0
    && selected.final.units > 0
    && (selected.finalRobustness.bootstrapPositiveProbability ?? 0) >= 0.95
    && (selected.finalRobustness.unitsWithoutBestDate ?? -Infinity) > 0;
  return {
    dimensions: ["side", "odds", "model_market_gap", "tickets", "money_ticket_gap", "movement", "diagnosis"],
    combinationFamilies: ["side_x_odds", "odds_x_model_market_gap", "odds_x_money_ticket_gap", "diagnosis_x_odds", "diagnosis_x_money_ticket_gap", "diagnosis_x_movement"],
    margins: ACTION_MARGINS,
    hypothesesTested: candidates.length,
    eligibleHypotheses: eligible.length,
    selected,
    passesHistoricalGate,
    productionChangeAuthorized: false,
  };
}

function pairedBoardImpact(current: Prediction[], candidate: Prediction[]) {
  const key = (prediction: Prediction) => `${prediction.row.id}|${prediction.row.side}`;
  const currentIds = new Set(current.map(key));
  const candidateIds = new Set(candidate.map(key));
  const retained = current.filter((prediction) => candidateIds.has(key(prediction)));
  const demoted = current.filter((prediction) => !candidateIds.has(key(prediction)));
  const promoted = candidate.filter((prediction) => !currentIds.has(key(prediction)));
  return {
    current: metrics(current),
    candidate: metrics(candidate),
    retained: metrics(retained),
    demoted: metrics(demoted),
    promoted: metrics(promoted),
    netBoardChange: candidate.length - current.length,
  };
}

function buildRollingActionFolds(
  rows: Observation[],
  family: string,
  lambda: number,
  sideSelectionMode: SideSelectionMode | null = null,
) {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const origins = [0.4, 0.55, 0.7, 0.85];
  const folds = origins.flatMap((fraction, index) => {
    const trainEnd = Math.max(1, Math.floor(dates.length * fraction));
    const testEnd = index === origins.length - 1
      ? dates.length
      : Math.max(trainEnd + 1, Math.floor(dates.length * origins[index + 1]));
    const trainDates = new Set(dates.slice(0, trainEnd));
    const testDates = new Set(dates.slice(trainEnd, testEnd));
    const training = rows.filter((row) => trainDates.has(row.date));
    const test = rows.filter((row) => testDates.has(row.date));
    const fitted = family === "market_consensus"
      ? { predictions: predictionsForBaseline(test, "market") }
      : family === "incumbent_champion"
        ? { predictions: predictionsForBaseline(test, "incumbent") }
        : family === "mlb_runtime_total_residual_projection"
          ? (() => {
            const model = fitRuntimeTotalResidualModel(training, lambda);
            return model ? { predictions: predictionsForRuntimeTotalResidual(test, model) } : null;
          })()
        : family === "mlb_moneyline_market_disagreement_resolver"
          ? (() => {
            const model = fitLogistic(training, family, lambda);
            return model ? { predictions: predictionsForMoneylineDisagreementResolver(test, model) } : null;
          })()
        : family === "mlb_market_anchored_margin_projection"
          ? (() => {
            const model = fitMarketAnchoredMarginModel(training, lambda);
            return model ? { predictions: predictionsForMarketAnchoredMargin(test, model) } : null;
          })()
        : family === "mlb_direct_residual_projection"
          ? (() => {
            const market = training[0]?.market;
            if (market !== "moneyline" && market !== "total") return null;
            const model = fitResidualProjectionModel(training, market, lambda);
            return model ? { predictions: predictionsForResidualProjection(test, model) } : null;
          })()
        : family === "mlb_moneyline_projection_market_guard"
          ? (() => {
            const model = fitScoreProjectionModel(training, "moneyline", lambda);
            return model ? { predictions: predictionsForMoneylineProjectionMarketGuard(test, model) } : null;
          })()
        : family === "mlb_score_projection_rebuild"
          ? (() => {
            const market = training[0]?.market;
            if (market !== "moneyline" && market !== "total") return null;
            const model = fitScoreProjectionModel(training, market, lambda);
            return model ? { predictions: predictionsForScoreProjection(test, model) } : null;
          })()
        : family === "mlb_structural_flip_selector"
          ? (() => {
            const predictions = structuralPredictionsForTraining(training, test);
            return predictions ? { predictions } : null;
          })()
        : isRuleBasedSideFamily(family)
          ? { predictions: predictionsForRuleBasedSideFamily(test, family) }
      : chronologicalPredictions(training, test, family, lambda);
    if (!fitted) return [];
    return [{
      testFrom: dates[trainEnd],
      testThrough: dates[testEnd - 1],
      original: sideSelectionMode
        ? pricedSideSelectedPredictions(fitted.predictions, sideSelectionMode)
        : fitted.predictions,
      incumbent: predictionsForBaseline(test, "incumbent"),
    }];
  });
  return folds;
}

function rollingActionDeltaEvaluation(
  folds: ReturnType<typeof buildRollingActionFolds>,
  direction: "original" | "opposite",
  margin: number,
  policy: "replace" | "union" | "intersection",
  scope: PriceScope,
) {
  const scored = folds.map((fold) => {
    const directional = direction === "opposite" ? oppositePredictions(fold.original) : fold.original;
    const ids = new Set(directional.map((prediction) => prediction.row.id));
    const current = currentActionPredictions(fold.incumbent.filter((prediction) => ids.has(prediction.row.id)));
    const proposed = actionPredictions(directional, margin);
    const candidate = composeScopedActionPolicy(current, proposed, policy, scope);
    return {
      testFrom: fold.testFrom,
      testThrough: fold.testThrough,
      current: metrics(current),
      candidate: metrics(candidate),
      deltaUnits: round(metrics(candidate).units - metrics(current).units, 3),
      boardRatio: current.length > 0 ? round(candidate.length / current.length, 3) : 1,
      deltaRobustness: pairedDeltaRobustness(current, candidate),
    };
  });
  return {
    folds: scored,
    positiveFolds: scored.filter((fold) => fold.deltaUnits > 0).length,
    totalDeltaUnits: round(scored.reduce((sum, fold) => sum + fold.deltaUnits, 0), 3),
  };
}

function relativeRebuildTournament(
  evaluations: Array<{
    family: string;
    selectedLambda: number;
    validationPredictions: Prediction[];
    finalPredictions: Prediction[];
    finalFormula: Json;
    sideSelectionMode?: SideSelectionMode;
  }>,
  rows: Observation[],
) {
  const validationRows = rows.filter((row) => row.partition === "validation");
  const finalRows = rows.filter((row) => row.partition === "final");
  const incumbentValidation = predictionsForBaseline(validationRows, "incumbent");
  const incumbentFinal = predictionsForBaseline(finalRows, "incumbent");
  const rollingByFamily = new Map(evaluations.map((evaluation) => [
    evaluation.family,
    buildRollingActionFolds(rows, evaluation.family, evaluation.selectedLambda, evaluation.sideSelectionMode),
  ]));
  const priceScopes: PriceScope[] = ["all", "favorite", "-150_-101", "-120_+129", "+100_+129", "gte_+130"];
  const candidates = evaluations.flatMap((evaluation) => [
    ...priceScopes.flatMap((scope) => [
      { direction: "original" as const, policy: "replace" as const, scope, validation: evaluation.validationPredictions, final: evaluation.finalPredictions },
      { direction: "original" as const, policy: "union" as const, scope, validation: evaluation.validationPredictions, final: evaluation.finalPredictions },
      { direction: "original" as const, policy: "intersection" as const, scope, validation: evaluation.validationPredictions, final: evaluation.finalPredictions },
    ]),
    { direction: "opposite" as const, policy: "replace" as const, scope: "all" as const, validation: oppositePredictions(evaluation.validationPredictions), final: oppositePredictions(evaluation.finalPredictions) },
  ].flatMap(({ direction, policy, scope, validation, final }) => ACTION_MARGINS.map((margin) => {
    const validationIds = new Set(validation.map((prediction) => prediction.row.id));
    const finalIds = new Set(final.map((prediction) => prediction.row.id));
    const currentValidation = currentActionPredictions(incumbentValidation.filter((prediction) => validationIds.has(prediction.row.id)));
    const currentFinal = currentActionPredictions(incumbentFinal.filter((prediction) => finalIds.has(prediction.row.id)));
    const proposedValidation = actionPredictions(validation, margin);
    const proposedFinal = actionPredictions(final, margin);
    const candidateValidation = composeScopedActionPolicy(currentValidation, proposedValidation, policy, scope);
    const candidateFinal = composeScopedActionPolicy(currentFinal, proposedFinal, policy, scope);
    const validationImpact = pairedBoardImpact(currentValidation, candidateValidation);
    const finalImpact = pairedBoardImpact(currentFinal, candidateFinal);
    const validationDelta = round(validationImpact.candidate.units - validationImpact.current.units, 3);
    const finalDelta = round(finalImpact.candidate.units - finalImpact.current.units, 3);
    const validationBoardRatio = validationImpact.current.rows > 0
      ? validationImpact.candidate.rows / validationImpact.current.rows
      : 1;
    const finalBoardRatio = finalImpact.current.rows > 0
      ? finalImpact.candidate.rows / finalImpact.current.rows
      : 1;
    const validationDeltaRobustness = pairedDeltaRobustness(currentValidation, candidateValidation);
    const finalDeltaRobustness = pairedDeltaRobustness(currentFinal, candidateFinal);
    const rollingActionDelta = rollingActionDeltaEvaluation(rollingByFamily.get(evaluation.family) ?? [], direction, margin, policy, scope);
    const validationStrata = actionDeltaStrata(currentValidation, candidateValidation);
    const finalStrata = actionDeltaStrata(currentFinal, candidateFinal);
    const worstRollingDelta = rollingActionDelta.folds.reduce(
      (worst, fold) => Math.min(worst, fold.deltaUnits),
      Infinity,
    );
    const stableAcrossPredeclaredStrata =
      !hasMaterialCombinedStratumLoss(validationStrata, finalStrata, "side")
      && !hasMaterialCombinedStratumLoss(validationStrata, finalStrata, "oddsBand");
    return {
      family: evaluation.family,
      direction,
      policy,
      scope,
      margin,
      validationImpact,
      finalImpact,
      validationDelta,
      finalDelta,
      combinedDelta: round(validationDelta + finalDelta, 3),
      validationBoardRatio: round(validationBoardRatio, 3),
      finalBoardRatio: round(finalBoardRatio, 3),
      validationDeltaRobustness,
      finalDeltaRobustness,
      rollingActionDelta,
      validationStrata,
      finalStrata,
      worstRollingDelta,
      stableAcrossPredeclaredStrata,
      formula: evaluation.finalFormula,
      qualifiesRelativeGate:
        validationDelta > 0
        && finalDelta >= 0
        && validationBoardRatio >= 0.75
        && finalBoardRatio >= 0.75
        && (validationImpact.demoted.rows === 0 || validationImpact.promoted.rows > 0)
        && (finalImpact.demoted.rows === 0 || finalImpact.promoted.rows > 0)
        && (validationDeltaRobustness.deltaWithoutBestDate ?? -Infinity) > 0
        && (finalDeltaRobustness.deltaWithoutBestDate ?? -Infinity) >= 0
        && rollingActionDelta.positiveFolds >= Math.ceil(rollingActionDelta.folds.length / 2)
        && rollingActionDelta.totalDeltaUnits > 0
        && worstRollingDelta >= -5
        && stableAcrossPredeclaredStrata,
    };
  })));
  const eligible = candidates.filter((candidate) => candidate.qualifiesRelativeGate).sort((left, right) =>
    (right.combinedDelta - left.combinedDelta)
    || (right.finalDelta - left.finalDelta));
  const topCandidates = [...candidates].sort((left, right) =>
    (right.combinedDelta - left.combinedDelta)
    || (right.finalDelta - left.finalDelta)).slice(0, 10);
  return {
    objective: "maximize_stable_paired_unit_delta_vs_current_board",
    candidatesTested: candidates.length,
    eligibleCandidates: eligible.length,
    selected: eligible[0] ?? null,
    topEligible: eligible.slice(0, 10),
    topCandidates,
  };
}

function eraMetrics(rows: Observation[]) {
  const groups = new Map<string, Observation[]>();
  for (const row of rows) {
    const key = `${row.modelVersion}|${row.calibrationVersion}|${row.decisionRelease}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Object.fromEntries([...groups.entries()].map(([key, group]) => [
    key,
    metrics(group.flatMap((row) => row.pCurrent === null ? [] : [{ row, probability: row.pCurrent }])),
  ]));
}

function coverage(rows: Observation[]) {
  const count = (predicate: (row: Observation) => boolean) => rows.filter(predicate).length;
  return {
    rows: rows.length,
    currentProbability: count((row) => row.pCurrent !== null),
    independentProbability: count((row) => row.pIndependent !== null),
    pairedMarketProbability: count((row) => row.pMarket !== null),
    pairedMovement: count((row) => row.pairedMovement !== null),
    completePublicSplits: count((row) => row.tickets !== null && row.moneyTicketGap !== null),
    projectionEdge: count((row) => row.signedProjectionEdge !== null),
    pricedSelectedSide: count((row) => row.odds !== null),
    pairedOppositePrice: count((row) => row.oppositeLockedPriceAvailable),
  };
}

function marketDiagnosis(row: Observation): string {
  const model = row.pIndependent ?? row.pCurrent;
  if (
    model === null || row.pMarket === null || row.pairedMovement === null
    || row.tickets === null || row.moneyTicketGap === null
  ) return "stale_or_incomplete_evidence";
  if (row.breakEven === null || row.pCurrent === null || row.pCurrent < row.breakEven) {
    return "no_price_adjusted_edge";
  }
  const marketSupports = row.pMarket >= 0.5;
  const movementSupports = row.pairedMovement >= 0;
  const moneySupports = row.moneyTicketGap >= 0;
  const supportCount = Number(marketSupports) + Number(movementSupports) + Number(moneySupports);
  if (supportCount === 3) return "model_market_confirmed";
  if (supportCount === 0) return "market_resistance_stand_down_candidate";
  if (row.tickets < 0.5 && marketSupports && movementSupports) return "public_fade_candidate";
  if (model >= 0.5 && supportCount <= 1) return "model_led_contrarian_candidate";
  return "mixed_or_noisy_market";
}

function marketStateMetrics(rows: Observation[]) {
  const groups = new Map<string, Observation[]>();
  for (const row of rows) {
    const diagnosis = marketDiagnosis(row);
    const group = groups.get(diagnosis) ?? [];
    group.push(row);
    groups.set(diagnosis, group);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, group]) => {
    const predictions = predictionsForBaseline(group, "incumbent");
    return [key, {
      overall: metrics(predictions),
      final: metrics(predictions.filter((prediction) => prediction.row.partition === "final")),
      currentActionable: metrics(currentActionPredictions(predictions)),
    }];
  }));
}

function marketReport(rows: Observation[]) {
  const finalRows = rows.filter((row) => row.partition === "final");
  const incumbentFinal = predictionsForBaseline(finalRows, "incumbent");
  const marketFinal = predictionsForBaseline(finalRows, "market");
  const neutralFinal = finalRows.map((row) => ({ row, probability: 0.5 }));
  const incumbentOverall = predictionsForBaseline(rows, "incumbent");
  const neutralOverall = rows.map((row) => ({ row, probability: 0.5 }));
  const requestedFamily = text(process.env.MODEL_FAMILY);
  const evaluations = PROBABILITY_FAMILIES.filter((family) => !requestedFamily || family === requestedFamily).flatMap((family) => {
    const evaluation = familyEvaluation(rows, family);
    return evaluation ? [evaluation] : [];
  });
  const probabilityTournament = probabilityChampionTournament(evaluations, rows);
  const rawSideTournament = rawSideSelectionTournament(evaluations, rows);
  const rawSideSelected = object(rawSideTournament.selected);
  const rawSideFamily = text(rawSideSelected?.family);
  const rawSideSelectionMode = text(rawSideSelected?.selectionMode) as SideSelectionMode | null;
  const rawSideEvaluation = evaluations.find((evaluation) => evaluation.family === rawSideFamily) ?? null;
  const rawSideActionTournament = rawSideEvaluation && rawSideSelectionMode
    ? relativeRebuildTournament([{
      family: rawSideEvaluation.family,
      selectedLambda: rawSideEvaluation.selectedLambda,
      validationPredictions: pricedSideSelectedPredictions(
        rawSideEvaluation.validationPredictions,
        rawSideSelectionMode,
      ),
      finalPredictions: pricedSideSelectedPredictions(
        rawSideEvaluation.finalPredictions,
        rawSideSelectionMode,
      ),
      finalFormula: rawSideEvaluation.finalFormula,
      sideSelectionMode: rawSideSelectionMode,
    }], rows)
    : null;
  const championFamily = text(object(probabilityTournament.selected)?.family);
  const selected = evaluations.find((evaluation) => evaluation.family === championFamily) ?? null;
  const incumbentChampion = {
    family: "incumbent_champion",
    selectedLambda: 0,
    validationPredictions: predictionsForBaseline(
      rows.filter((row) => row.partition === "validation"), "incumbent",
    ),
    finalPredictions: incumbentFinal,
    finalFormula: { source: "current_production_probability_champion" },
  };
  const relativeTournament = relativeRebuildTournament(
    [selected ?? incumbentChampion],
    rows,
  );
  const marketContextEvaluation = evaluations.find((evaluation) => evaluation.family === "market_context_stack") ?? null;
  const modelMarketEvaluation = evaluations.find((evaluation) => evaluation.family === "model_market_stack") ?? null;
  const selectedFinal = selected?.finalPredictions ?? incumbentFinal;
  const selectedValidation = selected?.validationPredictions ?? predictionsForBaseline(
    rows.filter((row) => row.partition === "validation"),
    "incumbent",
  );
  const actionChoice = chooseActionPolicy(selectedValidation);
  const selectedMargin = actionChoice.selected?.margin ?? 1;
  const selectedDirection = actionChoice.selected?.direction ?? "original";
  const directionalFinal = selectedDirection === "opposite"
    ? oppositePredictions(selectedFinal)
    : selectedFinal;
  const directionalValidation = selectedDirection === "opposite"
    ? oppositePredictions(selectedValidation)
    : selectedValidation;
  const candidateFinalActions = actionPredictions(directionalFinal, selectedMargin);
  const currentFinalActions = currentActionPredictions(incumbentFinal);
  const boardImpact = pairedBoardImpact(currentFinalActions, candidateFinalActions);
  const actionRobust = actionRobustness(candidateFinalActions);
  const validationActions = actionChoice.selected
    ? actionPredictions(directionalValidation, actionChoice.selected.margin)
    : [];
  const validationActionMetrics = metrics(validationActions);
  const validationActionRobustness = actionRobustness(validationActions);
  const finalActionCandidates = actionChoice.candidates.map((candidate) => {
    const direction = candidate.direction === "opposite"
      ? oppositePredictions(selectedFinal)
      : selectedFinal;
    const predictions = actionPredictions(direction, candidate.margin);
    return {
      direction: candidate.direction,
      margin: candidate.margin,
      metrics: metrics(predictions),
      robustness: actionRobustness(predictions),
    };
  });
  const specificFlipCohorts = evaluateSpecificFlipCohorts(selectedValidation, selectedFinal);
  const incumbentComparison = commonMetrics(selectedFinal, incumbentFinal);
  const marketComparison = commonMetrics(selectedFinal, marketFinal);
  const rollingOrigin = selected
    ? rollingOriginEvaluation(rows, selected.family, selected.selectedLambda)
    : [];
  const rollingWins = rollingOrigin.filter((fold) => fold.improvesBoth).length;
  const marketContextComparison = marketContextEvaluation && modelMarketEvaluation
    ? commonMetrics(marketContextEvaluation.finalPredictions, modelMarketEvaluation.finalPredictions)
    : { left: metrics([]), right: metrics([]) };
  const marketContextRolling = marketContextEvaluation
    ? rollingOriginEvaluation(rows, marketContextEvaluation.family, marketContextEvaluation.selectedLambda)
    : [];
  const marketContextRollingWins = marketContextRolling.filter((fold) => fold.improvesBoth).length;
  const marketContextPass =
    marketContextComparison.left.rows >= 10
    && marketContextComparison.left.brier !== null
    && marketContextComparison.right.brier !== null
    && marketContextComparison.left.logLoss !== null
    && marketContextComparison.right.logLoss !== null
    && marketContextComparison.left.brier <= marketContextComparison.right.brier
    && marketContextComparison.left.logLoss <= marketContextComparison.right.logLoss
    && marketContextRolling.length > 0
    && marketContextRollingWins >= Math.ceil(marketContextRolling.length / 2);
  const properScorePass =
    selected !== null
    && incumbentComparison.left.rows >= 10
    && incumbentComparison.left.brier !== null
    && incumbentComparison.right.brier !== null
    && incumbentComparison.left.logLoss !== null
    && incumbentComparison.right.logLoss !== null
    && incumbentComparison.left.brier <= incumbentComparison.right.brier
    && incumbentComparison.left.logLoss <= incumbentComparison.right.logLoss
    && (
      marketComparison.right.rows < 10
      || (
        marketComparison.left.brier! <= marketComparison.right.brier!
        && marketComparison.left.logLoss! <= marketComparison.right.logLoss!
      )
    )
    && rollingOrigin.length > 0
    && rollingWins >= Math.ceil(rollingOrigin.length / 2);
  const actionPass =
    validationActionMetrics.rows > 0
    && validationActionMetrics.dates >= 10
    && validationActionMetrics.units > 0
    && (validationActionRobustness.bootstrapPositiveProbability ?? 0) >= 0.95
    && (validationActionRobustness.unitsWithoutBestDate ?? -Infinity) > 0
    && boardImpact.candidate.rows > 0
    && (boardImpact.candidate.units > 0)
    && (actionRobust.bootstrapPositiveProbability ?? 0) >= 0.95
    && (actionRobust.unitsWithoutBestDate ?? -Infinity) > 0;
  const incumbentVsNeutral = commonMetrics(incumbentFinal, neutralFinal);
  const incumbentOverallVsNeutral = commonMetrics(incumbentOverall, neutralOverall);
  const incumbentVsMarket = commonMetrics(incumbentFinal, marketFinal);
  const incumbentHasSkill =
    incumbentOverallVsNeutral.left.rows >= 20
    && incumbentOverallVsNeutral.left.brier !== null
    && incumbentOverallVsNeutral.right.brier !== null
    && incumbentOverallVsNeutral.left.logLoss !== null
    && incumbentOverallVsNeutral.right.logLoss !== null
    && incumbentOverallVsNeutral.left.brier <= incumbentOverallVsNeutral.right.brier
    && incumbentOverallVsNeutral.left.logLoss <= incumbentOverallVsNeutral.right.logLoss
    && incumbentVsNeutral.left.rows >= 10
    && incumbentVsNeutral.left.brier !== null
    && incumbentVsNeutral.right.brier !== null
    && incumbentVsNeutral.left.logLoss !== null
    && incumbentVsNeutral.right.logLoss !== null
    && incumbentVsNeutral.left.brier <= incumbentVsNeutral.right.brier
    && incumbentVsNeutral.left.logLoss <= incumbentVsNeutral.right.logLoss;
  return {
    coverage: coverage(rows),
    partitionDates: Object.fromEntries((["development", "calibration", "validation", "final"] as Partition[]).map((partition) => [
      partition,
      [...new Set(rows.filter((row) => row.partition === partition).map((row) => row.date))],
    ])),
    incumbent: {
      overall: metrics(predictionsForBaseline(rows, "incumbent")),
      final: metrics(incumbentFinal),
      finalRankingLift: rankingLift(incumbentFinal),
      actionableOverall: metrics(currentActionPredictions(predictionsForBaseline(rows, "incumbent"))),
      bySide: Object.fromEntries([...new Set(rows.map((row) => row.side))].sort().map((side) => [side, {
        overall: metrics(predictionsForBaseline(rows.filter((row) => row.side === side), "incumbent")),
        final: metrics(predictionsForBaseline(finalRows.filter((row) => row.side === side), "incumbent")),
        actionable: metrics(currentActionPredictions(predictionsForBaseline(
          rows.filter((row) => row.side === side),
          "incumbent",
        ))),
      }])),
    },
    pairedMarketBaseline: {
      overall: metrics(predictionsForBaseline(rows, "market")),
      final: metrics(marketFinal),
    },
    incumbentVsNeutralOnCommonFinalRows: incumbentVsNeutral,
    incumbentVsNeutralOnCommonOverallRows: incumbentOverallVsNeutral,
    incumbentVsMarketOnCommonFinalRows: incumbentVsMarket,
    candidateFamilies: Object.fromEntries(evaluations.map((evaluation) => [evaluation.family, {
      searchedLambdas: evaluation.searchedLambdas,
      selectedLambda: evaluation.selectedLambda,
      calibration: evaluation.calibration,
      validation: evaluation.validation,
      final: evaluation.final,
      validationFormula: evaluation.validationFormula,
      finalFormula: evaluation.finalFormula,
      finalRankingLift: rankingLift(evaluation.finalPredictions),
    }])),
    probabilityChampionTournament: probabilityTournament,
    rawSideSelectionTournament: rawSideTournament,
    rawSideActionTournament,
    marketDisagreementDiagnostics: marketDisagreementDiagnostics(rows),
    selectedProbabilityCandidate: selected?.family ?? null,
    selectedVsIncumbentOnCommonFinalRows: incumbentComparison,
    selectedVsMarketOnCommonFinalRows: marketComparison,
    rollingOrigin: {
      folds: rollingOrigin,
      improvesBoth: rollingWins,
      required: Math.ceil(rollingOrigin.length / 2),
    },
    marketDiagnosisEvaluation: {
      contextVsModelMarketOnCommonFinalRows: marketContextComparison,
      rollingOrigin: marketContextRolling,
      improvesBoth: marketContextRollingWins,
      required: Math.ceil(marketContextRolling.length / 2),
      passesHistoricalGate: marketContextPass,
    },
    descriptiveMarketStates: marketStateMetrics(rows),
    actionability: {
      searchedMargins: ACTION_MARGINS,
      validationCandidates: actionChoice.candidates,
      finalCandidates: finalActionCandidates,
      selectedMargin: actionChoice.selected?.margin ?? null,
      selectedDirection: actionChoice.selected?.direction ?? null,
      selectedValidation: validationActionMetrics,
      selectedValidationRobustness: validationActionRobustness,
      finalBoardImpact: boardImpact,
      finalRobustness: actionRobust,
      specificFlipCohorts,
      relativeRebuildTournament: relativeTournament,
    },
    eraDescriptiveOnly: eraMetrics(rows),
    disposition: {
      probability: selected === null
        ? "rebuild_required"
        : properScorePass ? "historically_qualified_challenger"
          : incumbentHasSkill ? "retain_current_champion" : "rebuild_required",
      marketDiagnosis: coverage(rows).pairedMovement >= 30 && coverage(rows).completePublicSplits >= 30
        ? (marketContextPass ? "historically_qualified_challenger" : "rebuild_required")
        : "insufficient_locked_evidence",
      actionability: actionPass ? "historically_qualified_challenger" : "rebuild_required",
      productionChangeAuthorized: false,
      reason: "Legacy disposition only; production authorization is decided by the pre-registered chronological champion and exact board-impact gates.",
    },
  };
}

function compactMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  const incumbent = object(report.incumbent) ?? {};
  const pairedMarket = object(report.pairedMarketBaseline) ?? {};
  const candidates = object(report.candidateFamilies) ?? {};
  const actionability = object(report.actionability) ?? {};
  const finalBoard = object(actionability.finalBoardImpact) ?? {};
  return {
    coverage: report.coverage,
    incumbent: {
      overall: incumbent.overall,
      final: incumbent.final,
      actionableOverall: incumbent.actionableOverall,
      bySide: incumbent.bySide,
    },
    pairedMarketFinal: pairedMarket.final,
    candidates: Object.fromEntries(Object.entries(candidates).map(([family, raw]) => {
      const candidate = object(raw) ?? {};
      return [family, {
        selectedLambda: candidate.selectedLambda,
        validation: candidate.validation,
        final: candidate.final,
        validationFormula: candidate.validationFormula,
        finalFormula: candidate.finalFormula,
        finalRankingLift: candidate.finalRankingLift,
      }];
    })),
    selectedProbabilityCandidate: report.selectedProbabilityCandidate,
    selectedVsIncumbentOnCommonFinalRows: report.selectedVsIncumbentOnCommonFinalRows,
    selectedVsMarketOnCommonFinalRows: report.selectedVsMarketOnCommonFinalRows,
    rollingOrigin: report.rollingOrigin,
    actionability: {
      selectedMargin: actionability.selectedMargin,
      selectedDirection: actionability.selectedDirection,
      selectedValidation: actionability.selectedValidation,
      selectedValidationRobustness: actionability.selectedValidationRobustness,
      finalBoardImpact: finalBoard,
      finalRobustness: actionability.finalRobustness,
      flipEvaluation: {
        validation: array(actionability.validationCandidates).filter((value) => object(value)?.direction === "opposite"),
        final: array(actionability.finalCandidates).filter((value) => object(value)?.direction === "opposite"),
      },
      specificFlipCohorts: actionability.specificFlipCohorts,
    },
    disposition: report.disposition,
  };
}

function summaryMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  const incumbent = object(report.incumbent) ?? {};
  const pairedMarket = object(report.pairedMarketBaseline) ?? {};
  const rolling = object(report.rollingOrigin) ?? {};
  const actionability = object(report.actionability) ?? {};
  const summarizeCandidates = (raw: unknown) => array(raw).map((value) => {
    const candidate = object(value) ?? {};
    return {
      direction: candidate.direction,
      margin: candidate.margin,
      metrics: candidate.metrics,
      robustness: candidate.robustness,
    };
  });
  return {
    coverage: report.coverage,
    incumbent: {
      overall: incumbent.overall,
      final: incumbent.final,
      actionableOverall: incumbent.actionableOverall,
      bySide: incumbent.bySide,
    },
    pairedMarketFinal: pairedMarket.final,
    incumbentVsNeutralOnCommonFinalRows: report.incumbentVsNeutralOnCommonFinalRows,
    incumbentVsMarketOnCommonFinalRows: report.incumbentVsMarketOnCommonFinalRows,
    selectedProbabilityCandidate: report.selectedProbabilityCandidate,
    selectedVsIncumbentOnCommonFinalRows: report.selectedVsIncumbentOnCommonFinalRows,
    selectedVsMarketOnCommonFinalRows: report.selectedVsMarketOnCommonFinalRows,
    rollingOrigin: { improvesBoth: rolling.improvesBoth, required: rolling.required },
    marketDiagnosisEvaluation: {
      context: nested(report, "marketDiagnosisEvaluation", "contextVsModelMarketOnCommonFinalRows", "left"),
      modelMarket: nested(report, "marketDiagnosisEvaluation", "contextVsModelMarketOnCommonFinalRows", "right"),
      improvesBoth: nested(report, "marketDiagnosisEvaluation", "improvesBoth"),
      required: nested(report, "marketDiagnosisEvaluation", "required"),
      passesHistoricalGate: nested(report, "marketDiagnosisEvaluation", "passesHistoricalGate"),
    },
    actionability: {
      selectedDirection: actionability.selectedDirection,
      selectedMargin: actionability.selectedMargin,
      selectedValidation: actionability.selectedValidation,
      selectedValidationRobustness: actionability.selectedValidationRobustness,
      finalBoardImpact: actionability.finalBoardImpact,
      finalRobustness: actionability.finalRobustness,
      validationCandidates: summarizeCandidates(actionability.validationCandidates),
      finalCandidates: summarizeCandidates(actionability.finalCandidates),
      specificFlipCohorts: actionability.specificFlipCohorts,
    },
    disposition: report.disposition,
  };
}

function miniMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  const incumbent = object(report.incumbent) ?? {};
  const actionability = object(report.actionability) ?? {};
  const rolling = object(report.rollingOrigin) ?? {};
  const metric = (raw: unknown) => {
    const value = object(raw) ?? {};
    return Object.fromEntries([
      "rows", "dates", "record", "accuracyPct", "meanProbabilityPct", "calibrationGapPp",
      "brier", "logLoss", "units", "roiPct",
    ].map((key) => [key, value[key]]));
  };
  const sides = object(incumbent.bySide) ?? {};
  const validationFlips = array(actionability.validationCandidates)
    .map(object)
    .filter((candidate): candidate is Json => candidate !== null && candidate.direction === "opposite");
  const bestValidationFlip = [...validationFlips].sort((left, right) =>
    (finite(nested(right, "metrics", "units")) ?? -Infinity)
    - (finite(nested(left, "metrics", "units")) ?? -Infinity))[0] ?? null;
  const matchingFinalFlip = bestValidationFlip === null ? null : array(actionability.finalCandidates)
    .map(object)
    .find((candidate) => candidate?.direction === "opposite" && candidate.margin === bestValidationFlip.margin) ?? null;
  return {
    coverage: report.coverage,
    incumbent: {
      overall: metric(incumbent.overall),
      final: metric(incumbent.final),
      actionableOverall: metric(incumbent.actionableOverall),
      bySide: Object.fromEntries(Object.entries(sides).map(([side, raw]) => {
        const value = object(raw) ?? {};
        return [side, { overall: metric(value.overall), final: metric(value.final), actionable: metric(value.actionable) }];
      })),
    },
    pairedMarketFinal: metric(nested(report, "pairedMarketBaseline", "final")),
    incumbentVsNeutralFinal: {
      incumbent: metric(nested(report, "incumbentVsNeutralOnCommonFinalRows", "left")),
      neutral: metric(nested(report, "incumbentVsNeutralOnCommonFinalRows", "right")),
    },
    selectedProbabilityCandidate: report.selectedProbabilityCandidate,
    selectedVsIncumbentFinal: {
      candidate: metric(nested(report, "selectedVsIncumbentOnCommonFinalRows", "left")),
      incumbent: metric(nested(report, "selectedVsIncumbentOnCommonFinalRows", "right")),
    },
    selectedVsMarketFinal: {
      candidate: metric(nested(report, "selectedVsMarketOnCommonFinalRows", "left")),
      market: metric(nested(report, "selectedVsMarketOnCommonFinalRows", "right")),
    },
    rollingOrigin: { improvesBoth: rolling.improvesBoth, required: rolling.required },
    marketDiagnosisEvaluation: {
      context: metric(nested(report, "marketDiagnosisEvaluation", "contextVsModelMarketOnCommonFinalRows", "left")),
      modelMarket: metric(nested(report, "marketDiagnosisEvaluation", "contextVsModelMarketOnCommonFinalRows", "right")),
      improvesBoth: nested(report, "marketDiagnosisEvaluation", "improvesBoth"),
      required: nested(report, "marketDiagnosisEvaluation", "required"),
      passesHistoricalGate: nested(report, "marketDiagnosisEvaluation", "passesHistoricalGate"),
    },
    descriptiveMarketStates: Object.fromEntries(Object.entries(object(report.descriptiveMarketStates) ?? {}).map(([state, raw]) => {
      const value = object(raw) ?? {};
      return [state, { overall: metric(value.overall), final: metric(value.final), actionable: metric(value.currentActionable) }];
    })),
    selectedAction: {
      direction: actionability.selectedDirection,
      margin: actionability.selectedMargin,
      validation: metric(actionability.selectedValidation),
      validationRobustness: actionability.selectedValidationRobustness,
      final: metric(nested(actionability, "finalBoardImpact", "candidate")),
      finalRobustness: actionability.finalRobustness,
      boardImpact: {
        current: metric(nested(actionability, "finalBoardImpact", "current")),
        retained: metric(nested(actionability, "finalBoardImpact", "retained")),
        demoted: metric(nested(actionability, "finalBoardImpact", "demoted")),
        promoted: metric(nested(actionability, "finalBoardImpact", "promoted")),
        netBoardChange: nested(actionability, "finalBoardImpact", "netBoardChange"),
      },
    },
    bestValidationFlip: bestValidationFlip && {
      margin: bestValidationFlip.margin,
      validation: metric(bestValidationFlip.metrics),
      validationRobustness: bestValidationFlip.robustness,
      final: metric(matchingFinalFlip?.metrics),
      finalRobustness: matchingFinalFlip?.robustness,
    },
    specificFlipCohorts: actionability.specificFlipCohorts,
    disposition: report.disposition,
  };
}

function statesMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  return {
    coverage: report.coverage,
    descriptiveMarketStates: report.descriptiveMarketStates,
    marketDiagnosisEvaluation: report.marketDiagnosisEvaluation,
    disposition: report.disposition,
  };
}

function flipCohortsMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  return {
    coverage: report.coverage,
    specificFlipCohorts: nested(report, "actionability", "specificFlipCohorts"),
    disposition: report.disposition,
  };
}

function immediateRebuildMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  return {
    coverage: report.coverage,
    incumbent: report.incumbent,
    candidateFamilies: report.candidateFamilies,
    relativeRebuildTournament: nested(report, "actionability", "relativeRebuildTournament"),
    disposition: report.disposition,
  };
}

function championMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  const tournament = object(report.probabilityChampionTournament) ?? {};
  const compactProbabilityCandidate = (raw: unknown) => {
    const candidate = object(raw) ?? {};
    return {
      family: candidate.family,
      qualifies: candidate.qualifies,
      selectedSideCoherent: candidate.selectedSideCoherent,
      combinedCandidate: nested(candidate, "combinedVsIncumbent", "left"),
      combinedIncumbent: nested(candidate, "combinedVsIncumbent", "right"),
      finalCandidate: nested(candidate, "finalVsIncumbent", "left"),
      finalIncumbent: nested(candidate, "finalVsIncumbent", "right"),
      combinedMarket: nested(candidate, "combinedVsMarket", "right"),
      combinedBrierDelta: candidate.combinedBrierDelta,
      combinedLogLossDelta: candidate.combinedLogLossDelta,
      finalBrierRegression: candidate.finalBrierRegression,
      finalLogLossRegression: candidate.finalLogLossRegression,
      rollingImprovesBoth: nested(candidate, "rolling", "improvesBoth"),
      rollingRequired: nested(candidate, "rolling", "required"),
      formula: candidate.formula,
    };
  };
  const actionTournament = object(nested(report, "actionability", "relativeRebuildTournament")) ?? {};
  const actionSelected = object(actionTournament.selected);
  return {
    coverage: report.coverage,
    probabilityChampion: tournament.selected ? compactProbabilityCandidate(tournament.selected) : null,
    probabilityRanking: array(tournament.ranking).map(compactProbabilityCandidate),
    championActionPolicy: actionSelected ? {
      family: actionSelected.family,
      direction: actionSelected.direction,
      policy: actionSelected.policy,
      scope: actionSelected.scope,
      margin: actionSelected.margin,
      validationImpact: actionSelected.validationImpact,
      finalImpact: actionSelected.finalImpact,
      validationDelta: actionSelected.validationDelta,
      finalDelta: actionSelected.finalDelta,
      combinedDelta: actionSelected.combinedDelta,
      validationBoardRatio: actionSelected.validationBoardRatio,
      finalBoardRatio: actionSelected.finalBoardRatio,
      validationDeltaRobustness: actionSelected.validationDeltaRobustness,
      finalDeltaRobustness: actionSelected.finalDeltaRobustness,
      rollingActionDelta: actionSelected.rollingActionDelta,
      formula: actionSelected.formula,
    } : null,
  };
}

function championMiniMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  const tournament = object(report.probabilityChampionTournament) ?? {};
  const compactProbabilityCandidate = (raw: unknown) => {
    const candidate = object(raw) ?? {};
    return {
      family: candidate.family,
      qualifies: candidate.qualifies,
      selectedSideCoherent: candidate.selectedSideCoherent,
      combined: {
        candidateBrier: nested(candidate, "combinedVsIncumbent", "left", "brier"),
        incumbentBrier: nested(candidate, "combinedVsIncumbent", "right", "brier"),
        marketBrier: nested(candidate, "combinedVsMarket", "right", "brier"),
        candidateLogLoss: nested(candidate, "combinedVsIncumbent", "left", "logLoss"),
        incumbentLogLoss: nested(candidate, "combinedVsIncumbent", "right", "logLoss"),
        marketLogLoss: nested(candidate, "combinedVsMarket", "right", "logLoss"),
      },
      final: {
        candidateBrier: nested(candidate, "finalVsIncumbent", "left", "brier"),
        incumbentBrier: nested(candidate, "finalVsIncumbent", "right", "brier"),
        candidateLogLoss: nested(candidate, "finalVsIncumbent", "left", "logLoss"),
        incumbentLogLoss: nested(candidate, "finalVsIncumbent", "right", "logLoss"),
      },
      rollingImprovesBoth: nested(candidate, "rolling", "improvesBoth"),
      rollingRequired: nested(candidate, "rolling", "required"),
      formula: candidate.formula,
    };
  };
  const action = object(nested(report, "actionability", "relativeRebuildTournament", "selected"));
  const compactImpact = (raw: unknown) => {
    const impact = object(raw);
    return {
      currentRows: nested(impact, "current", "rows"),
      currentUnits: nested(impact, "current", "units"),
      candidateRows: nested(impact, "candidate", "rows"),
      candidateUnits: nested(impact, "candidate", "units"),
      retainedRows: nested(impact, "retained", "rows"),
      demotedRows: nested(impact, "demoted", "rows"),
      promotedRows: nested(impact, "promoted", "rows"),
      netBoardChange: nested(impact, "netBoardChange"),
    };
  };
  return {
    coverage: report.coverage,
    probabilityChampion: tournament.selected ? compactProbabilityCandidate(tournament.selected) : null,
    topProbabilityCandidates: array(tournament.ranking).slice(0, 3).map(compactProbabilityCandidate),
    championActionPolicy: action ? {
      family: action.family,
      direction: action.direction,
      policy: action.policy,
      scope: action.scope,
      margin: action.margin,
      validation: compactImpact(action.validationImpact),
      final: compactImpact(action.finalImpact),
      validationDelta: action.validationDelta,
      finalDelta: action.finalDelta,
      combinedDelta: action.combinedDelta,
      validationDeltaWithoutBestDate: nested(action, "validationDeltaRobustness", "deltaWithoutBestDate"),
      finalDeltaWithoutBestDate: nested(action, "finalDeltaRobustness", "deltaWithoutBestDate"),
      rollingPositiveFolds: nested(action, "rollingActionDelta", "positiveFolds"),
      rollingTotalDeltaUnits: nested(action, "rollingActionDelta", "totalDeltaUnits"),
    } : null,
  };
}

function relativeTournamentMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  const families = object(report.candidateFamilies) ?? {};
  return {
    probabilityFamilies: Object.fromEntries(Object.entries(families).map(([family, raw]) => {
      const candidate = object(raw) ?? {};
      return [family, {
        validation: candidate.validation,
        final: candidate.final,
        formula: candidate.finalFormula,
      }];
    })),
    relativeRebuildTournament: nested(report, "actionability", "relativeRebuildTournament"),
  };
}

function actionPolicyMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  return {
    relativeRebuildTournament: nested(report, "actionability", "relativeRebuildTournament"),
  };
}

function selectedPolicyMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  return {
    selected: nested(report, "actionability", "relativeRebuildTournament", "selected"),
  };
}

function selectedPolicyMiniMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  const tournament = object(nested(report, "actionability", "relativeRebuildTournament")) ?? {};
  const selected = object(tournament.selected);
  const compactCandidate = (raw: unknown) => {
    const candidate = object(raw) ?? {};
    return {
      family: candidate.family,
      direction: candidate.direction,
      policy: candidate.policy,
      scope: candidate.scope,
      margin: candidate.margin,
      validationDelta: candidate.validationDelta,
      finalDelta: candidate.finalDelta,
      combinedDelta: candidate.combinedDelta,
      validationBoardRatio: candidate.validationBoardRatio,
      finalBoardRatio: candidate.finalBoardRatio,
      rollingPositiveFolds: nested(candidate, "rollingActionDelta", "positiveFolds"),
      rollingTotalDeltaUnits: nested(candidate, "rollingActionDelta", "totalDeltaUnits"),
    };
  };
  if (!selected) return {
    candidatesTested: tournament.candidatesTested,
    eligibleCandidates: tournament.eligibleCandidates,
    selected: null,
  };
  const rolling = object(selected.rollingActionDelta) ?? {};
  return {
    candidatesTested: tournament.candidatesTested,
    eligibleCandidates: tournament.eligibleCandidates,
    topEligible: array(tournament.topEligible).map(compactCandidate),
    selected: {
      family: selected.family,
      direction: selected.direction,
      policy: selected.policy,
      scope: selected.scope,
      margin: selected.margin,
      validationImpact: selected.validationImpact,
      finalImpact: selected.finalImpact,
      validationDelta: selected.validationDelta,
      finalDelta: selected.finalDelta,
      combinedDelta: selected.combinedDelta,
      validationBoardRatio: selected.validationBoardRatio,
      finalBoardRatio: selected.finalBoardRatio,
      validationDeltaRobustness: selected.validationDeltaRobustness,
      finalDeltaRobustness: selected.finalDeltaRobustness,
      rollingActionDelta: {
        positiveFolds: rolling.positiveFolds,
        totalDeltaUnits: rolling.totalDeltaUnits,
        folds: array(rolling.folds).map((raw) => {
          const fold = object(raw) ?? {};
          return {
            testFrom: fold.testFrom,
            testThrough: fold.testThrough,
            deltaUnits: fold.deltaUnits,
            boardRatio: fold.boardRatio,
          };
        }),
      },
      validationStrata: selected.validationStrata,
      finalStrata: selected.finalStrata,
      formula: selected.formula,
      qualifiesRelativeGate: selected.qualifiesRelativeGate,
    },
  };
}

function actionStressMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  const selected = object(nested(report, "actionability", "relativeRebuildTournament", "selected"));
  if (!selected) return { selected: null };
  const compactStrata = (raw: unknown) => {
    const groups = object(raw) ?? {};
    return Object.fromEntries(Object.entries(groups).map(([dimension, dimensionRaw]) => {
      const strata = object(dimensionRaw) ?? {};
      return [dimension, Object.fromEntries(Object.entries(strata).map(([key, stratumRaw]) => {
        const stratum = object(stratumRaw);
        return [key, {
          currentRows: nested(stratum, "current", "rows"),
          currentUnits: nested(stratum, "current", "units"),
          candidateRows: nested(stratum, "candidate", "rows"),
          candidateUnits: nested(stratum, "candidate", "units"),
          deltaUnits: nested(stratum, "deltaUnits"),
        }];
      }))];
    }));
  };
  return {
    selected: {
      family: selected.family,
      direction: selected.direction,
      policy: selected.policy,
      scope: selected.scope,
      margin: selected.margin,
      validationImpact: selected.validationImpact,
      finalImpact: selected.finalImpact,
      validationDeltaRobustness: selected.validationDeltaRobustness,
      finalDeltaRobustness: selected.finalDeltaRobustness,
      rollingActionDelta: selected.rollingActionDelta,
      validationStrata: compactStrata(selected.validationStrata),
      finalStrata: compactStrata(selected.finalStrata),
    },
  };
}

function rawAccuracyMarketReport(value: unknown): Json {
  const report = object(value) ?? {};
  const tournament = object(report.rawSideSelectionTournament) ?? {};
  const compact = (raw: unknown) => {
    const candidate = object(raw);
    if (!candidate) return null;
    return {
      family: candidate.family,
      selectionMode: candidate.selectionMode,
      qualifies: candidate.qualifies,
      validation: candidate.validation,
      final: candidate.final,
      validationAccuracyDelta: candidate.validationAccuracyDelta,
      finalAccuracyDelta: candidate.finalAccuracyDelta,
      combinedAccuracyDelta: candidate.combinedAccuracyDelta,
      combinedSideChanges: candidate.combinedSideChanges,
      rollingAccuracyWins: candidate.rollingAccuracyWins,
      rollingRequired: candidate.rollingRequired,
      rollingProjectionWins: candidate.rollingProjectionWins,
      rollingProjectionRequired: candidate.rollingProjectionRequired,
      projectionGate: candidate.projectionGate,
      properScoreSafe: candidate.properScoreSafe,
      finalFormula: candidate.finalFormula,
    };
  };
  const actionTournament = object(report.rawSideActionTournament);
  const requestedFamily = text(process.env.MODEL_FAMILY);
  const rankedCandidates = array(tournament.ranking).filter((raw) =>
    !requestedFamily || text(object(raw)?.family) === requestedFamily);
  const compactAction = (raw: unknown) => {
    const candidate = object(raw);
    if (!candidate) return null;
    return {
      family: candidate.family,
      direction: candidate.direction,
      policy: candidate.policy,
      scope: candidate.scope,
      margin: candidate.margin,
      validationDelta: candidate.validationDelta,
      finalDelta: candidate.finalDelta,
      combinedDelta: candidate.combinedDelta,
      validationBoardRatio: candidate.validationBoardRatio,
      finalBoardRatio: candidate.finalBoardRatio,
      validationImpact: candidate.validationImpact,
      finalImpact: candidate.finalImpact,
      validationDeltaRobustness: candidate.validationDeltaRobustness,
      finalDeltaRobustness: candidate.finalDeltaRobustness,
      rollingActionDelta: candidate.rollingActionDelta,
      worstRollingDelta: candidate.worstRollingDelta,
      stableAcrossPredeclaredStrata: candidate.stableAcrossPredeclaredStrata,
      qualifiesRelativeGate: candidate.qualifiesRelativeGate,
    };
  };
  return {
    coverage: report.coverage,
    ...(process.env.DISAGREEMENT_DIAGNOSTICS === "1"
      ? { marketDisagreementDiagnostics: report.marketDisagreementDiagnostics }
      : {}),
    selected: compact(tournament.selected),
    eligible: array(tournament.eligible).map(compact),
    topCandidates: rankedCandidates.slice(0, 60).map(compact),
    downstreamActionTournament: actionTournament ? {
      eligibleCandidates: actionTournament.eligibleCandidates,
      selected: compactAction(actionTournament.selected),
      topCandidates: array(actionTournament.topCandidates).slice(0, 5).map(compactAction),
    } : null,
  };
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

async function main() {
  const allDefinitions: Array<[Sport, Market]> = [
    ["mlb", "moneyline"],
    ["mlb", "total"],
    ["mlb", "first_inning"],
    ["wnba", "moneyline"],
    ["wnba", "total"],
    ["wnba", "spread"],
  ];
  const requestedSport = text(process.env.SPORT)?.toLowerCase();
  const requestedMarket = text(process.env.MARKET)?.toLowerCase();
  const definitions = allDefinitions.filter(([sport, market]) =>
    (!requestedSport || sport === requestedSport)
    && (!requestedMarket || market === requestedMarket));
  if (definitions.length === 0) throw new Error("No market matched SPORT/MARKET filters.");
  const result: Json = {
    mode: "fresh_market_specific_rebuild_audit",
    generatedAt: new Date().toISOString(),
    databaseWrites: false,
    priorResearchCandidatesImported: false,
    preRegisteredContract: "docs/model-audits/2026-08-15-raw-side-champion-contract.md",
    searchCountPerFittedFamily: LAMBDAS.length,
    actionMarginVariants: ACTION_MARGINS.length,
    markets: {},
  };
  const markets = result.markets as Json;
  for (const [sport, market] of definitions) {
    const raw = await loadRaw(sport, market);
    const gameContexts = sport === "mlb"
      ? await loadGameContexts(raw.map((row) => row.game_id))
      : new Map<number, GameContext>();
    const eligibleDates = raw.flatMap((row) => {
      const grade = gradeRelation(row);
      const value = text(grade?.result)?.toLowerCase();
      return value === "win" || value === "loss" ? [row.slate_date] : [];
    });
    const partitions = partitionDates(eligibleDates);
    const observations = raw.flatMap((row) => {
      const partition = partitions.get(row.slate_date);
      if (!partition) return [];
      const observation = toObservation(row, partition, gameContexts.get(row.game_id) ?? null);
      return observation ? [observation] : [];
    });
    if (sport === "mlb") addPointInTimeTeamForm(observations);
    markets[`${sport}:${market}`] = marketReport(observations);
  }
  if (process.env.ACTION_STRESS === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      actionStressMarketReport(value),
    ]));
  } else if (process.env.RAW_ACCURACY === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      rawAccuracyMarketReport(value),
    ]));
  } else if (process.env.CHAMPIONS_MINI === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      championMiniMarketReport(value),
    ]));
  } else if (process.env.CHAMPIONS === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      championMarketReport(value),
    ]));
  } else if (process.env.SELECTED_MINI === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      selectedPolicyMiniMarketReport(value),
    ]));
  } else if (process.env.SELECTED_POLICY === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      selectedPolicyMarketReport(value),
    ]));
  } else if (process.env.POLICY === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      actionPolicyMarketReport(value),
    ]));
  } else if (process.env.TOURNAMENT === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      relativeTournamentMarketReport(value),
    ]));
  } else if (process.env.REBUILD === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      immediateRebuildMarketReport(value),
    ]));
  } else if (process.env.FLIP_COHORTS === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      flipCohortsMarketReport(value),
    ]));
  } else if (process.env.STATES === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      statesMarketReport(value),
    ]));
  } else if (process.env.MINI === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      miniMarketReport(value),
    ]));
  } else if (process.env.COMPACT === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      compactMarketReport(value),
    ]));
  } else if (process.env.SUMMARY === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      summaryMarketReport(value),
    ]));
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
