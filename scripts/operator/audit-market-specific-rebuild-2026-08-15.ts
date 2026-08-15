/**
 * READ ONLY. Fresh market-specific rebuild audit pre-registered in
 * docs/model-audits/2026-08-15-immediate-rebuild-release-contract.md.
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
  partition: Partition;
};

type FittedLogistic = {
  means: number[];
  scales: number[];
  weights: number[];
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

function toObservation(row: RawRecord, partition: Partition): Observation | null {
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

function features(row: Observation, family: string): number[] | null {
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
  const examples = rows.flatMap((row) => {
    const x = features(row, family);
    return x ? [{ x, y: row.outcome }] : [];
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
  const probability = clampProbability(sigmoid(model.weights.reduce((sum, weight, index) => sum + weight * x[index], 0)));
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

function familyEvaluation(rows: Observation[], family: string) {
  const development = rows.filter((row) => row.partition === "development");
  const calibration = rows.filter((row) => row.partition === "calibration");
  const validation = rows.filter((row) => row.partition === "validation");
  const final = rows.filter((row) => row.partition === "final");
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
      : chronologicalPredictions(training, test, family, lambda);
    if (!fitted) return [];
    return [{
      testFrom: dates[trainEnd],
      testThrough: dates[testEnd - 1],
      original: fitted.predictions,
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
  }>,
  rows: Observation[],
) {
  const validationRows = rows.filter((row) => row.partition === "validation");
  const finalRows = rows.filter((row) => row.partition === "final");
  const incumbentValidation = predictionsForBaseline(validationRows, "incumbent");
  const incumbentFinal = predictionsForBaseline(finalRows, "incumbent");
  const rollingByFamily = new Map(evaluations.map((evaluation) => [
    evaluation.family,
    buildRollingActionFolds(rows, evaluation.family, evaluation.selectedLambda),
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
  return {
    objective: "maximize_stable_paired_unit_delta_vs_current_board",
    candidatesTested: candidates.length,
    eligibleCandidates: eligible.length,
    selected: eligible[0] ?? null,
    topEligible: eligible.slice(0, 10),
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
  const evaluations = PROBABILITY_FAMILIES.flatMap((family) => {
    const evaluation = familyEvaluation(rows, family);
    return evaluation ? [evaluation] : [];
  });
  const probabilityTournament = probabilityChampionTournament(evaluations, rows);
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
    preRegisteredContract: "docs/model-audits/2026-08-15-immediate-rebuild-release-contract.md",
    searchCountPerFittedFamily: LAMBDAS.length,
    actionMarginVariants: ACTION_MARGINS.length,
    markets: {},
  };
  const markets = result.markets as Json;
  for (const [sport, market] of definitions) {
    const raw = await loadRaw(sport, market);
    const eligibleDates = raw.flatMap((row) => {
      const grade = gradeRelation(row);
      const value = text(grade?.result)?.toLowerCase();
      return value === "win" || value === "loss" ? [row.slate_date] : [];
    });
    const partitions = partitionDates(eligibleDates);
    const observations = raw.flatMap((row) => {
      const partition = partitions.get(row.slate_date);
      if (!partition) return [];
      const observation = toObservation(row, partition);
      return observation ? [observation] : [];
    });
    markets[`${sport}:${market}`] = marketReport(observations);
  }
  if (process.env.ACTION_STRESS === "1") {
    result.markets = Object.fromEntries(Object.entries(markets).map(([key, value]) => [
      key,
      actionStressMarketReport(value),
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
