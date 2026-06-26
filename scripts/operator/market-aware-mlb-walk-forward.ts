import { supabase } from "../../lib/db/supabase";
import { homeWinProbabilityPoisson, overProbabilityPoisson, poissonPmf } from "../../lib/automodel/runDistribution";
import {
  directionalSplitFeatures,
  expectedValuePerDollar,
  fitRidgeLogistic,
  logit,
  logLoss,
  brierScore,
  normalizeProviderSplit,
  predictRidgeLogistic,
  timeToStartBucket,
  type LogisticModel,
  type MarketAwareMarket,
  type ProviderSplitSample,
} from "../../lib/services/marketAwareEngine/core";
import {
  derivePlaybookTemporalFeatures,
  deriveSharpRetailPriceFeatures,
  type MarketPriceFeatureRow,
  type MarketSplitFeatureRow,
  type PlaybookTemporalFeatures,
  type SharpRetailPriceFeatures,
} from "../../lib/services/marketAwareEngine/marketIntelligenceFeatures";

type GradeJoin = {
  result: string | null;
  push: boolean | null;
  win: boolean | null;
  loss: boolean | null;
  void: boolean | null;
  pending: boolean | null;
  actual_total: number | null;
  winning_team: string | null;
};

type PredictionRow = {
  id: number;
  game_id: number;
  external_id: number;
  slate_date: string;
  game_date: string | null;
  matchup: string | null;
  market: MarketAwareMarket;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  confidence: number | null;
  model_probability: number | null;
  market_probability: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  locked_at: string | null;
  published_at: string | null;
  created_at: string | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades?: GradeJoin[] | GradeJoin | null;
};

type PublicSplitRow = {
  provider: string | null;
  sport: string | null;
  game_id: number;
  market_type: string | null;
  side: string | null;
  public_betting_pct: number | null;
  public_money_pct: number | null;
  books_used: number | null;
  observed_at: string | null;
  created_at: string | null;
};

type V2SplitRow = {
  canonical_event_id: string;
  league: string | null;
  market_type: string | null;
  selection_key: string | null;
  provider: string | null;
  source_book: string | null;
  source_type: string | null;
  bets_pct: number | null;
  money_pct: number | null;
  market_line: number | null;
  market_price: number | null;
  books_used: number | null;
  source_observed_at: string | null;
  fetched_at: string | null;
  minutes_to_start: number | null;
};

type V2PriceRow = {
  canonical_event_id: string;
  league: string | null;
  sportsbook: string | null;
  sharp_book: boolean | null;
  market_type: string | null;
  selection_key: string | null;
  line: number | null;
  american_price: number | null;
  no_vig_probability: number | null;
  provider_timestamp: string | null;
  fetched_at: string | null;
  minutes_to_start: number | null;
};

type DatasetRow = {
  id: number;
  eventId: number;
  externalId: number;
  slateDate: string;
  eventStart: string | null;
  asOf: string;
  matchup: string;
  market: MarketAwareMarket;
  candidateSelection: string;
  recommendedLine: number | null;
  recommendedPrice: number | null;
  outcome: 0 | 1;
  push: boolean;
  productionProbability: number;
  independentProbability: number | null;
  marketProbability: number | null;
  independentProjectedTotal: number | null;
  independentProjectedMargin: number | null;
  movementImpliedDelta: number;
  movementToward: number;
  movementAgainst: number;
  movementLineDelta: number;
  steamMove: number;
  reverseLineMove: number;
  freshnessScore: number;
  completenessScore: number;
  splitSamples: ProviderSplitSample[];
  playbookTemporal: PlaybookTemporalFeatures;
  sharpRetailPrice: SharpRetailPriceFeatures;
  sourceCoverage: {
    playbook: boolean;
    draftkings: boolean;
    circa: boolean;
    betmgmTickets: boolean;
    priceAction: boolean;
    publicSplitsObservation: boolean;
    v2SplitObservation: boolean;
  };
  currentGrade: string | null;
  currentBestAngle: boolean;
  currentNoBet: boolean;
};

type ModelId =
  | "A_production"
  | "B_independent_market"
  | "C_price_action"
  | "D_playbook_levels"
  | "E_playbook_temporal"
  | "F_betmgm_tickets"
  | "G_real_dk_circa";

type FoldPrediction = {
  modelId: ModelId;
  row: DatasetRow;
  probability: number;
  ev: number | null;
  foldDate: string;
  coefficients?: Record<string, number>;
};

const MODEL_FEATURES: Record<Exclude<ModelId, "A_production">, string[]> = {
  B_independent_market: [
    "logit_independent",
    "independent_missing",
    "logit_market",
    "market_missing",
  ],
  C_price_action: [
    "logit_independent",
    "independent_missing",
    "logit_market",
    "market_missing",
    "movement_implied_delta",
    "movement_toward",
    "movement_against",
    "movement_line_delta",
    "steam_move",
    "reverse_line_move",
    "sharp_retail_probability_gap",
    "sharp_retail_gap_missing",
    "sharp_move_15m",
    "retail_move_15m",
    "sharp_move_60m",
    "retail_move_60m",
    "book_movement_breadth",
    "sharp_book_agreement",
    "retail_book_agreement",
    "price_line_movement",
    "price_juice_movement",
    "price_movement_velocity",
    "current_price_freshness_minutes",
    "sharp_price_book_count",
    "retail_price_book_count",
  ],
  D_playbook_levels: [
    "logit_independent",
    "independent_missing",
    "logit_market",
    "market_missing",
    "movement_implied_delta",
    "movement_toward",
    "movement_against",
    "movement_line_delta",
    "steam_move",
    "reverse_line_move",
    "sharp_retail_probability_gap",
    "sharp_retail_gap_missing",
    "sharp_move_15m",
    "retail_move_15m",
    "sharp_move_60m",
    "retail_move_60m",
    "book_movement_breadth",
    "sharp_book_agreement",
    "retail_book_agreement",
    "price_line_movement",
    "price_juice_movement",
    "price_movement_velocity",
    "current_price_freshness_minutes",
    "sharp_price_book_count",
    "retail_price_book_count",
    "playbook_bets_z",
    "playbook_money_z",
    "playbook_gap_z",
    "playbook_sample_size",
    "playbook_missing",
  ],
  E_playbook_temporal: [
    "logit_independent",
    "independent_missing",
    "logit_market",
    "market_missing",
    "movement_implied_delta",
    "movement_toward",
    "movement_against",
    "movement_line_delta",
    "steam_move",
    "reverse_line_move",
    "sharp_retail_probability_gap",
    "sharp_retail_gap_missing",
    "sharp_move_15m",
    "retail_move_15m",
    "sharp_move_60m",
    "retail_move_60m",
    "book_movement_breadth",
    "sharp_book_agreement",
    "retail_book_agreement",
    "price_line_movement",
    "price_juice_movement",
    "price_movement_velocity",
    "current_price_freshness_minutes",
    "sharp_price_book_count",
    "retail_price_book_count",
    "playbook_bets_z",
    "playbook_money_z",
    "playbook_gap_z",
    "playbook_sample_size",
    "playbook_missing",
    "playbook_bets_delta_15m",
    "playbook_money_delta_15m",
    "playbook_bets_delta_60m",
    "playbook_money_delta_60m",
    "playbook_bets_delta_full_day",
    "playbook_money_delta_full_day",
    "playbook_gap_delta",
    "playbook_persistence_above_50",
    "playbook_persistence_below_50",
    "playbook_pregame_bets_range",
    "playbook_pregame_money_range",
    "playbook_temporal_sample_count",
    "playbook_temporal_missing",
  ],
  F_betmgm_tickets: [
    "logit_independent",
    "independent_missing",
    "logit_market",
    "market_missing",
    "movement_implied_delta",
    "movement_toward",
    "movement_against",
    "movement_line_delta",
    "steam_move",
    "reverse_line_move",
    "sharp_retail_probability_gap",
    "sharp_retail_gap_missing",
    "sharp_move_15m",
    "retail_move_15m",
    "sharp_move_60m",
    "retail_move_60m",
    "book_movement_breadth",
    "sharp_book_agreement",
    "retail_book_agreement",
    "price_line_movement",
    "price_juice_movement",
    "price_movement_velocity",
    "current_price_freshness_minutes",
    "sharp_price_book_count",
    "retail_price_book_count",
    "playbook_bets_z",
    "playbook_money_z",
    "playbook_gap_z",
    "playbook_sample_size",
    "playbook_missing",
    "playbook_bets_delta_15m",
    "playbook_money_delta_15m",
    "playbook_bets_delta_60m",
    "playbook_money_delta_60m",
    "playbook_bets_delta_full_day",
    "playbook_money_delta_full_day",
    "playbook_gap_delta",
    "playbook_persistence_above_50",
    "playbook_persistence_below_50",
    "playbook_pregame_bets_range",
    "playbook_pregame_money_range",
    "playbook_temporal_sample_count",
    "playbook_temporal_missing",
    "betmgm_bets_z",
    "betmgm_money_z",
    "betmgm_gap_z",
    "betmgm_sample_size",
    "betmgm_missing",
  ],
  G_real_dk_circa: [
    "logit_independent",
    "independent_missing",
    "logit_market",
    "market_missing",
    "movement_implied_delta",
    "movement_toward",
    "movement_against",
    "movement_line_delta",
    "steam_move",
    "reverse_line_move",
    "sharp_retail_probability_gap",
    "sharp_retail_gap_missing",
    "sharp_move_15m",
    "retail_move_15m",
    "sharp_move_60m",
    "retail_move_60m",
    "book_movement_breadth",
    "sharp_book_agreement",
    "retail_book_agreement",
    "price_line_movement",
    "price_juice_movement",
    "price_movement_velocity",
    "current_price_freshness_minutes",
    "sharp_price_book_count",
    "retail_price_book_count",
    "playbook_bets_z",
    "playbook_money_z",
    "playbook_gap_z",
    "playbook_sample_size",
    "playbook_missing",
    "playbook_bets_delta_15m",
    "playbook_money_delta_15m",
    "playbook_bets_delta_60m",
    "playbook_money_delta_60m",
    "playbook_bets_delta_full_day",
    "playbook_money_delta_full_day",
    "playbook_gap_delta",
    "playbook_persistence_above_50",
    "playbook_persistence_below_50",
    "playbook_pregame_bets_range",
    "playbook_pregame_money_range",
    "playbook_temporal_sample_count",
    "playbook_temporal_missing",
    "betmgm_bets_z",
    "betmgm_money_z",
    "betmgm_gap_z",
    "betmgm_sample_size",
    "betmgm_missing",
    "draftkings_bets_z",
    "draftkings_money_z",
    "draftkings_gap_z",
    "draftkings_sample_size",
    "draftkings_missing",
    "circa_bets_z",
    "circa_money_z",
    "circa_gap_z",
    "circa_sample_size",
    "circa_missing",
    "circa_money_x_movement",
    "playbook_money_x_movement",
    "dk_tickets_vs_circa_money",
  ],
};

function one<T>(value: T[] | T | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(v: unknown): boolean {
  return v === true;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function pctToUnit(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return v > 1 ? v / 100 : v;
}

function asOfFor(row: PredictionRow): string | null {
  return row.locked_at ?? row.published_at ?? row.created_at;
}

function minutesToStart(row: PredictionRow): number | null {
  const asOf = asOfFor(row);
  if (!asOf || !row.game_date) return null;
  const diff = Date.parse(row.game_date) - Date.parse(asOf);
  return Number.isFinite(diff) ? diff / 60_000 : null;
}

function dateLeq(a: string | null | undefined, b: string): boolean {
  if (!a) return true;
  const at = Date.parse(a);
  const bt = Date.parse(b);
  return !Number.isFinite(at) || !Number.isFinite(bt) ? true : at <= bt;
}

function notAfterStart(observedAt: string | null | undefined, eventStart: string | null): boolean {
  if (!observedAt || !eventStart) return true;
  const at = Date.parse(observedAt);
  const st = Date.parse(eventStart);
  return !Number.isFinite(at) || !Number.isFinite(st) ? true : at <= st;
}

function reconstructIndependentProbability(row: PredictionRow): {
  probability: number | null;
  projectedTotal: number | null;
  projectedMargin: number | null;
} {
  const snap = asRecord(row.snapshot_json);
  const v22 = asRecord(snap.v2_2_audit);
  const v21 = asRecord(snap.v2_1_audit);
  const homeRuns = num(v22.independent_home_runs) ?? num(v21.independent_home_runs);
  const awayRuns = num(v22.independent_away_runs) ?? num(v21.independent_away_runs);
  if (homeRuns === null || awayRuns === null) return { probability: null, projectedTotal: null, projectedMargin: null };
  if (row.market === "moneyline") {
    const homeProb = homeWinProbabilityPoisson(homeRuns, awayRuns);
    return {
      probability: row.side === "away" ? 1 - homeProb : homeProb,
      projectedTotal: homeRuns + awayRuns,
      projectedMargin: homeRuns - awayRuns,
    };
  }
  if (row.market === "spread") {
    if (row.line_value === null || (row.side !== "home" && row.side !== "away")) {
      return { probability: null, projectedTotal: homeRuns + awayRuns, projectedMargin: homeRuns - awayRuns };
    }
    return {
      probability: spreadCoverProbabilityPoisson(homeRuns, awayRuns, row.side, row.line_value),
      projectedTotal: homeRuns + awayRuns,
      projectedMargin: homeRuns - awayRuns,
    };
  }
  if (row.line_value === null) {
    return { probability: null, projectedTotal: homeRuns + awayRuns, projectedMargin: homeRuns - awayRuns };
  }
  const overProb = overProbabilityPoisson(homeRuns, awayRuns, row.line_value);
  return {
    probability: row.side === "under" ? 1 - overProb : overProb,
    projectedTotal: homeRuns + awayRuns,
    projectedMargin: homeRuns - awayRuns,
  };
}

function spreadCoverProbabilityPoisson(
  lambdaHome: number,
  lambdaAway: number,
  side: "home" | "away",
  line: number,
): number {
  const maxRuns = 20;
  let pCover = 0;
  for (let h = 0; h <= maxRuns; h++) {
    const ph = poissonPmf(h, lambdaHome);
    for (let a = 0; a <= maxRuns; a++) {
      const pa = poissonPmf(a, lambdaAway);
      const covers = side === "home" ? h + line > a : a + line > h;
      if (covers) pCover += ph * pa;
    }
  }
  return Math.max(0, Math.min(1, pCover));
}

function movementFeatures(row: PredictionRow): Pick<DatasetRow, "movementImpliedDelta" | "movementToward" | "movementAgainst" | "movementLineDelta" | "steamMove" | "reverseLineMove"> {
  const m = asRecord(asRecord(row.snapshot_json).line_movement);
  const openProb = num(m.open_implied_prob);
  const currentProb = num(m.current_implied_prob);
  const direction = str(m.direction);
  const totalOpen = num(m.total_open);
  const totalCurrent = num(m.total_current);
  return {
    movementImpliedDelta: openProb !== null && currentProb !== null ? currentProb - openProb : 0,
    movementToward: direction === "toward_pick" ? 1 : 0,
    movementAgainst: direction === "against_pick" ? 1 : 0,
    movementLineDelta: totalOpen !== null && totalCurrent !== null ? totalCurrent - totalOpen : 0,
    steamMove: bool(m.has_steam_move) ? 1 : 0,
    reverseLineMove: bool(m.has_reverse_line_movement) ? 1 : 0,
  };
}

function latestPublicSplit(row: PredictionRow, rowsByKey: Map<string, PublicSplitRow[]>): PublicSplitRow | null {
  const key = `${row.game_id}:${row.market}:${row.side ?? row.pick ?? ""}`;
  const asOf = asOfFor(row);
  if (!asOf) return null;
  const rows = (rowsByKey.get(key) ?? [])
    .filter((r) => dateLeq(r.observed_at ?? r.created_at, asOf) && notAfterStart(r.observed_at ?? r.created_at, row.game_date))
    .sort((a, b) => Date.parse(b.observed_at ?? b.created_at ?? "") - Date.parse(a.observed_at ?? a.created_at ?? ""));
  return rows[0] ?? null;
}

function latestV2Splits(row: PredictionRow, rowsByKey: Map<string, V2SplitRow[]>): V2SplitRow[] {
  const all = allV2Splits(row, rowsByKey);
  const grouped = new Map<string, V2SplitRow>();
  for (const r of all) {
    const sourceKey = `${(r.provider ?? "").toLowerCase()}:${(r.source_book ?? "").toLowerCase()}`;
    const prev = grouped.get(sourceKey);
    if (!prev || Date.parse(r.fetched_at ?? "") > Date.parse(prev.fetched_at ?? "")) grouped.set(sourceKey, r);
  }
  return [...grouped.values()];
}

function allV2Splits(row: PredictionRow, rowsByKey: Map<string, V2SplitRow[]>): V2SplitRow[] {
  const key = `${row.external_id}:${row.market}:${row.side ?? row.pick ?? ""}`;
  const asOf = asOfFor(row);
  if (!asOf) return [];
  const out: V2SplitRow[] = [];
  for (const r of rowsByKey.get(key) ?? []) {
    const observedAt = r.source_observed_at ?? r.fetched_at;
    if (!dateLeq(observedAt, asOf) || !notAfterStart(observedAt, row.game_date)) continue;
    out.push(r);
  }
  return out;
}

function allV2Prices(row: PredictionRow, rowsByKey: Map<string, V2PriceRow[]>): V2PriceRow[] {
  const key = `${row.external_id}:${row.market}:${row.side ?? row.pick ?? ""}`;
  const asOf = asOfFor(row);
  if (!asOf) return [];
  return (rowsByKey.get(key) ?? []).filter((r) => {
    const observedAt = r.provider_timestamp ?? r.fetched_at;
    return dateLeq(observedAt, asOf) && notAfterStart(observedAt, row.game_date);
  });
}

function splitSample(args: {
  provider: string;
  sourceBook: string;
  league?: string | null;
  market: MarketAwareMarket;
  minutesToStart: number | null;
  betsPct: number | null;
  moneyPct: number | null;
}): ProviderSplitSample {
  const directional = directionalSplitFeatures({
    betsPctForCandidate: pctToUnit(args.betsPct),
    moneyPctForCandidate: pctToUnit(args.moneyPct),
  });
  return {
    provider: args.provider.toLowerCase(),
    sourceBook: args.sourceBook.toLowerCase(),
    league: (args.league ?? "mlb").toLowerCase(),
    market: args.market,
    timeBucket: timeToStartBucket(args.minutesToStart),
    ...directional,
  };
}

function samplesForRow(
  row: PredictionRow,
  publicRows: Map<string, PublicSplitRow[]>,
  v2Rows: Map<string, V2SplitRow[]>,
  priceRows: Map<string, V2PriceRow[]>,
): {
  samples: ProviderSplitSample[];
  playbookTemporal: PlaybookTemporalFeatures;
  sharpRetailPrice: SharpRetailPriceFeatures;
  coverage: DatasetRow["sourceCoverage"];
} {
  const samples: ProviderSplitSample[] = [];
  const mins = minutesToStart(row);
  const coverage: DatasetRow["sourceCoverage"] = {
    playbook: false,
    draftkings: false,
    circa: false,
    betmgmTickets: false,
    priceAction: false,
    publicSplitsObservation: false,
    v2SplitObservation: false,
  };
  const pub = latestPublicSplit(row, publicRows);
  if (pub) {
    coverage.publicSplitsObservation = true;
    const provider = (pub.provider ?? "public_splits").toLowerCase();
    samples.push(splitSample({
      provider,
      sourceBook: provider === "playbook" ? "consensus" : provider,
      league: pub.sport,
      market: row.market,
      minutesToStart: mins,
      betsPct: pub.public_betting_pct,
      moneyPct: pub.public_money_pct,
    }));
    if (provider === "playbook") coverage.playbook = true;
  }
  const snapSplits = asRecord(asRecord(row.snapshot_json).public_splits);
  if (Object.keys(snapSplits).length > 0) {
    samples.push(splitSample({
      provider: "legacy_sharp_signals",
      sourceBook: "public_splits_snapshot",
      market: row.market,
      minutesToStart: mins,
      betsPct: num(snapSplits.picked_bets_pct),
      moneyPct: num(snapSplits.picked_money_pct),
    }));
  }
  for (const r of latestV2Splits(row, v2Rows)) {
    coverage.v2SplitObservation = true;
    const provider = (r.provider ?? "unknown").toLowerCase();
    const source = (r.source_book ?? "unknown").toLowerCase();
    samples.push(splitSample({
      provider,
      sourceBook: source,
      league: r.league,
      market: row.market,
      minutesToStart: r.minutes_to_start ?? mins,
      betsPct: r.bets_pct,
      moneyPct: r.money_pct,
    }));
    if (provider === "playbook") coverage.playbook = true;
    if (source.includes("draftkings")) coverage.draftkings = true;
    if (source.includes("circa")) coverage.circa = true;
    if (source.includes("betmgm")) coverage.betmgmTickets = true;
  }
  const allSplits = allV2Splits(row, v2Rows);
  const playbookTemporal = derivePlaybookTemporalFeatures(allSplits.map((r): MarketSplitFeatureRow => ({
    provider: r.provider,
    sourceBook: r.source_book,
    sourceType: r.source_type,
    league: r.league,
    marketType: row.market,
    selectionKey: r.selection_key,
    betsPct: r.bets_pct,
    moneyPct: r.money_pct,
    marketLine: r.market_line,
    marketPrice: r.market_price,
    booksUsed: r.books_used,
    sourceObservedAt: r.source_observed_at,
    fetchedAt: r.fetched_at,
    minutesToStart: r.minutes_to_start ?? mins,
  })), asOfFor(row));
  const priceObs = allV2Prices(row, priceRows);
  const sharpRetailPrice = deriveSharpRetailPriceFeatures(priceObs.map((r): MarketPriceFeatureRow => ({
    sportsbook: r.sportsbook,
    sharpBook: r.sharp_book,
    marketType: row.market,
    selectionKey: r.selection_key,
    line: r.line,
    americanPrice: r.american_price,
    noVigProbability: r.no_vig_probability,
    providerTimestamp: r.provider_timestamp,
    fetchedAt: r.fetched_at,
    minutesToStart: r.minutes_to_start ?? mins,
  })), asOfFor(row));
  coverage.priceAction = sharpRetailPrice.sharpBookCount + sharpRetailPrice.retailBookCount > 0;
  return { samples, playbookTemporal, sharpRetailPrice, coverage };
}

function gradeOutcome(row: PredictionRow): { outcome: 0 | 1; push: boolean } | null {
  const g = one(row.prediction_grades);
  if (!g || g.pending || g.void) return null;
  if (g.push || g.result === "push") return { outcome: 0, push: true };
  if (g.win || g.result === "win") return { outcome: 1, push: false };
  if (g.loss || g.result === "loss") return { outcome: 0, push: false };
  return null;
}

async function pagedPredictionRows(): Promise<PredictionRow[]> {
  const rows: PredictionRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select("id, game_id, external_id, slate_date, game_date, matchup, market, pick, side, line_value, odds_american, confidence, model_probability, market_probability, play_grade, best_angle, no_bet, locked_at, published_at, created_at, snapshot_json, prediction_grades(result,push,win,loss,void,pending,actual_total,winning_team)")
      .eq("sport", "mlb")
      .in("market", ["moneyline", "spread", "total"])
      .not("model_probability", "is", null)
      .order("slate_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`prediction_records fetch failed: ${error.message}`);
    rows.push(...((data ?? []) as PredictionRow[]));
    if ((data ?? []).length < pageSize) break;
  }
  return rows;
}

async function loadPublicSplits(gameIds: number[]): Promise<Map<string, PublicSplitRow[]>> {
  const out = new Map<string, PublicSplitRow[]>();
  for (let i = 0; i < gameIds.length; i += 200) {
    const { data, error } = await supabase
      .from("public_splits_observations")
      .select("provider,sport,game_id,market_type,side,public_betting_pct,public_money_pct,books_used,observed_at,created_at")
      .in("game_id", gameIds.slice(i, i + 200))
      .in("market_type", ["moneyline", "spread", "total"]);
    if (error) throw new Error(`public_splits_observations fetch failed: ${error.message}`);
    for (const row of (data ?? []) as PublicSplitRow[]) {
      const key = `${row.game_id}:${row.market_type}:${row.side ?? ""}`;
      const arr = out.get(key) ?? [];
      arr.push(row);
      out.set(key, arr);
    }
  }
  return out;
}

async function loadV2Splits(externalIds: number[]): Promise<Map<string, V2SplitRow[]>> {
  const out = new Map<string, V2SplitRow[]>();
  for (let i = 0; i < externalIds.length; i += 200) {
    const { data, error } = await supabase
      .from("market_split_observations_v2")
      .select("canonical_event_id,league,market_type,selection_key,provider,source_book,source_type,bets_pct,money_pct,market_line,market_price,books_used,source_observed_at,fetched_at,minutes_to_start")
      .in("canonical_event_id", externalIds.slice(i, i + 200).map(String))
      .in("market_type", ["moneyline", "spread", "total"]);
    if (error) throw new Error(`market_split_observations_v2 fetch failed: ${error.message}`);
    for (const row of (data ?? []) as V2SplitRow[]) {
      const side = row.selection_key?.split(":").pop() ?? "";
      const key = `${row.canonical_event_id}:${row.market_type}:${side}`;
      const arr = out.get(key) ?? [];
      arr.push(row);
      out.set(key, arr);
    }
  }
  return out;
}

async function loadV2Prices(externalIds: number[]): Promise<Map<string, V2PriceRow[]>> {
  const out = new Map<string, V2PriceRow[]>();
  for (let i = 0; i < externalIds.length; i += 200) {
    const { data, error } = await supabase
      .from("market_price_observations_v2")
      .select("canonical_event_id,league,sportsbook,sharp_book,market_type,selection_key,line,american_price,no_vig_probability,provider_timestamp,fetched_at,minutes_to_start")
      .in("canonical_event_id", externalIds.slice(i, i + 200).map(String))
      .in("market_type", ["moneyline", "spread", "total"]);
    if (error) throw new Error(`market_price_observations_v2 fetch failed: ${error.message}`);
    for (const row of (data ?? []) as V2PriceRow[]) {
      const side = row.selection_key?.split(":").pop() ?? "";
      const key = `${row.canonical_event_id}:${row.market_type}:${side}`;
      const arr = out.get(key) ?? [];
      arr.push(row);
      out.set(key, arr);
    }
  }
  return out;
}

function recencyTime(row: PredictionRow): number {
  return Date.parse(row.locked_at ?? row.published_at ?? row.created_at ?? "") || 0;
}

function dedupeSettledEventMarkets(rows: PredictionRow[]): PredictionRow[] {
  const byKey = new Map<string, PredictionRow>();
  for (const row of rows) {
    const outcome = gradeOutcome(row);
    if (!outcome || outcome.push) continue;
    const key = `${row.game_id}:${row.market}`;
    const prev = byKey.get(key);
    if (!prev || recencyTime(row) > recencyTime(prev) || (recencyTime(row) === recencyTime(prev) && row.id > prev.id)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const dateCmp = a.slate_date.localeCompare(b.slate_date);
    if (dateCmp !== 0) return dateCmp;
    return a.id - b.id;
  });
}

async function buildDataset(): Promise<{ rows: DatasetRow[]; rawRows: number; publicSplitRows: number; v2SplitRows: number; v2PriceRows: number }> {
  const raw = await pagedPredictionRows();
  const eventMarketRows = dedupeSettledEventMarkets(raw);
  const gameIds = [...new Set(eventMarketRows.map((r) => r.game_id))];
  const externalIds = [...new Set(eventMarketRows.map((r) => r.external_id))];
  const publicSplits = await loadPublicSplits(gameIds);
  const v2Splits = await loadV2Splits(externalIds);
  const v2Prices = await loadV2Prices(externalIds);
  const rows: DatasetRow[] = [];
  for (const row of eventMarketRows) {
    const asOf = asOfFor(row);
    const outcome = gradeOutcome(row);
    if (!asOf || !outcome || outcome.push) continue;
    if (row.model_probability === null) continue;
    const independent = reconstructIndependentProbability(row);
    const movement = movementFeatures(row);
    const split = samplesForRow(row, publicSplits, v2Splits, v2Prices);
    rows.push({
      id: row.id,
      eventId: row.game_id,
      externalId: row.external_id,
      slateDate: row.slate_date,
      eventStart: row.game_date,
      asOf,
      matchup: row.matchup ?? "",
      market: row.market,
      candidateSelection: row.side ?? row.pick ?? "",
      recommendedLine: row.line_value,
      recommendedPrice: row.odds_american,
      outcome: outcome.outcome,
      push: false,
      productionProbability: row.model_probability,
      independentProbability: independent.probability,
      marketProbability: row.market_probability,
      independentProjectedTotal: independent.projectedTotal,
      independentProjectedMargin: independent.projectedMargin,
      ...movement,
      freshnessScore: 1,
      completenessScore: (independent.probability !== null ? 0.35 : 0) + (row.market_probability !== null ? 0.35 : 0) + (split.samples.length > 0 ? 0.3 : 0),
      splitSamples: split.samples,
      playbookTemporal: split.playbookTemporal,
      sharpRetailPrice: split.sharpRetailPrice,
      sourceCoverage: split.coverage,
      currentGrade: row.play_grade,
      currentBestAngle: row.best_angle === true,
      currentNoBet: row.no_bet === true,
    });
  }
  return {
    rows,
    rawRows: raw.length,
    publicSplitRows: [...publicSplits.values()].reduce((n, arr) => n + arr.length, 0),
    v2SplitRows: [...v2Splits.values()].reduce((n, arr) => n + arr.length, 0),
    v2PriceRows: [...v2Prices.values()].reduce((n, arr) => n + arr.length, 0),
  };
}

function splitFor(row: DatasetRow, provider: string, sourceBook?: string): ProviderSplitSample | null {
  return row.splitSamples.find((s) =>
    s.provider === provider &&
    (sourceBook === undefined || s.sourceBook.includes(sourceBook))
  ) ?? null;
}

function normalizedFeatureBlock(
  prefix: "playbook" | "betmgm" | "draftkings" | "circa",
  sample: ProviderSplitSample | null,
  trainingSamples: ProviderSplitSample[],
): Record<string, number> {
  if (!sample) {
    return {
      [`${prefix}_bets_z`]: 0,
      [`${prefix}_money_z`]: 0,
      [`${prefix}_gap_z`]: 0,
      [`${prefix}_sample_size`]: 0,
      [`${prefix}_missing`]: 1,
    };
  }
  const n = normalizeProviderSplit(trainingSamples, sample);
  return {
    [`${prefix}_bets_z`]: n.betsLeanZ ?? 0,
    [`${prefix}_money_z`]: n.moneyLeanZ ?? 0,
    [`${prefix}_gap_z`]: n.moneyGapZ ?? 0,
    [`${prefix}_sample_size`]: Math.log1p(n.normalizationSampleSize),
    [`${prefix}_missing`]: n.normalizationFallbackLevel === "unavailable" ? 1 : 0,
  };
}

function featureRow(row: DatasetRow, trainingRows: DatasetRow[]): Record<string, number> {
  const trainingSamples = trainingRows.flatMap((r) => r.splitSamples);
  const playbook = splitFor(row, "playbook", "consensus");
  const betmgm = splitFor(row, "sharpapi", "betmgm");
  const dk = splitFor(row, "sharpapi", "draftkings");
  const circa = splitFor(row, "sharpapi", "circa");
  const price = row.sharpRetailPrice;
  const temporal = row.playbookTemporal;
  const base: Record<string, number> = {
    logit_independent: row.independentProbability === null ? 0 : logit(row.independentProbability),
    independent_missing: row.independentProbability === null ? 1 : 0,
    logit_market: row.marketProbability === null ? 0 : logit(row.marketProbability),
    market_missing: row.marketProbability === null ? 1 : 0,
    movement_implied_delta: row.movementImpliedDelta,
    movement_toward: row.movementToward,
    movement_against: row.movementAgainst,
    movement_line_delta: row.movementLineDelta,
    steam_move: row.steamMove,
    reverse_line_move: row.reverseLineMove,
    sharp_retail_probability_gap: price.sharpRetailProbabilityGap ?? 0,
    sharp_retail_gap_missing: price.sharpRetailProbabilityGap === null ? 1 : 0,
    sharp_move_15m: price.sharpMove15m ?? 0,
    retail_move_15m: price.retailMove15m ?? 0,
    sharp_move_60m: price.sharpMove60m ?? 0,
    retail_move_60m: price.retailMove60m ?? 0,
    book_movement_breadth: Math.log1p(price.bookMovementBreadth),
    sharp_book_agreement: price.sharpBookAgreement ?? 0,
    retail_book_agreement: price.retailBookAgreement ?? 0,
    price_line_movement: price.lineMovement ?? 0,
    price_juice_movement: price.juiceMovement ?? 0,
    price_movement_velocity: price.movementVelocityPerHour ?? 0,
    current_price_freshness_minutes: price.currentFreshnessMinutes === null ? 0 : Math.log1p(price.currentFreshnessMinutes),
    sharp_price_book_count: Math.log1p(price.sharpBookCount),
    retail_price_book_count: Math.log1p(price.retailBookCount),
    ...normalizedFeatureBlock("playbook", playbook, trainingSamples),
    ...normalizedFeatureBlock("betmgm", betmgm, trainingSamples),
    ...normalizedFeatureBlock("draftkings", dk, trainingSamples),
    ...normalizedFeatureBlock("circa", circa, trainingSamples),
    playbook_bets_delta_15m: temporal.betsDelta15m ?? 0,
    playbook_money_delta_15m: temporal.moneyDelta15m ?? 0,
    playbook_bets_delta_60m: temporal.betsDelta60m ?? 0,
    playbook_money_delta_60m: temporal.moneyDelta60m ?? 0,
    playbook_bets_delta_full_day: temporal.betsDeltaFullDay ?? 0,
    playbook_money_delta_full_day: temporal.moneyDeltaFullDay ?? 0,
    playbook_gap_delta: temporal.moneyMinusBetsGapDelta ?? 0,
    playbook_persistence_above_50: temporal.persistenceAbove50Pct ?? 0,
    playbook_persistence_below_50: temporal.persistenceBelow50Pct ?? 0,
    playbook_pregame_bets_range: temporal.maxPregameBetsPct !== null && temporal.minPregameBetsPct !== null
      ? temporal.maxPregameBetsPct - temporal.minPregameBetsPct
      : 0,
    playbook_pregame_money_range: temporal.maxPregameMoneyPct !== null && temporal.minPregameMoneyPct !== null
      ? temporal.maxPregameMoneyPct - temporal.minPregameMoneyPct
      : 0,
    playbook_temporal_sample_count: Math.log1p(temporal.sampleCount),
    playbook_temporal_missing: temporal.sampleCount === 0 ? 1 : 0,
  };
  base.circa_money_x_movement = base.circa_money_z * row.movementImpliedDelta;
  base.playbook_money_x_movement = base.playbook_money_z * row.movementImpliedDelta;
  base.dk_tickets_vs_circa_money = base.draftkings_bets_z - base.circa_money_z;
  return base;
}

function evaluateDirect(rows: DatasetRow[], modelId: "A_production"): FoldPrediction[] {
  const out: FoldPrediction[] = [];
  for (const row of rows) {
    const probability = row.productionProbability;
    out.push({
      modelId,
      row,
      probability,
      ev: expectedValuePerDollar(probability, row.recommendedPrice),
      foldDate: row.slateDate,
    });
  }
  return out;
}

function coefficientMap(model: LogisticModel): Record<string, number> {
  const out: Record<string, number> = { intercept: model.intercept };
  model.featureNames.forEach((name, i) => {
    out[name] = model.weights[i] / model.scales[i];
  });
  return out;
}

function evaluateStacker(rows: DatasetRow[], modelId: Exclude<ModelId, "A_production">): FoldPrediction[] {
  const dates = [...new Set(rows.map((r) => r.slateDate))].sort();
  const out: FoldPrediction[] = [];
  const features = MODEL_FEATURES[modelId];
  for (let i = 3; i < dates.length; i++) {
    const train = rows.filter((r) => r.slateDate < dates[i] && r.independentProbability !== null);
    const test = rows.filter((r) => r.slateDate === dates[i] && r.independentProbability !== null);
    if (train.length < 40 || test.length === 0) continue;
    const model = fitRidgeLogistic({
      rows: train.map((r) => featureRow(r, train)),
      outcomes: train.map((r) => r.outcome),
      featureNames: features,
      lambda: 1.5,
      iterations: 1400,
      learningRate: 0.04,
    });
    const coefs = coefficientMap(model);
    for (const row of test) {
      const p = predictRidgeLogistic(model, featureRow(row, train));
      out.push({
        modelId,
        row,
        probability: p,
        ev: expectedValuePerDollar(p, row.recommendedPrice),
        foldDate: dates[i],
        coefficients: coefs,
      });
    }
  }
  return out;
}

function summarize(predictions: FoldPrediction[]) {
  const settled = predictions.filter((p) => !p.row.push);
  const n = settled.length;
  const wins = settled.reduce((a, p) => a + p.row.outcome, 0);
  const logloss = settled.reduce((a, p) => a + logLoss(p.probability, p.row.outcome), 0) / Math.max(1, n);
  const brier = settled.reduce((a, p) => a + brierScore(p.probability, p.row.outcome), 0) / Math.max(1, n);
  const evPicks = settled.filter((p) => p.ev !== null && p.ev > 0);
  const roiNumerator = evPicks.reduce((sum, p) => {
    const odds = p.row.recommendedPrice;
    if (odds === null) return sum;
    if (p.row.outcome === 1) return sum + (odds > 0 ? odds / 100 : 100 / Math.abs(odds));
    return sum - 1;
  }, 0);
  const byMarket = (["moneyline", "spread", "total"] as const).map((market) => {
    const m = settled.filter((p) => p.row.market === market);
    return {
      market,
      n: m.length,
      logLoss: m.reduce((a, p) => a + logLoss(p.probability, p.row.outcome), 0) / Math.max(1, m.length),
      brier: m.reduce((a, p) => a + brierScore(p.probability, p.row.outcome), 0) / Math.max(1, m.length),
    };
  });
  return {
    n,
    wins,
    accuracy: wins / Math.max(1, n),
    logLoss: logloss,
    brier,
    avgProbability: settled.reduce((a, p) => a + p.probability, 0) / Math.max(1, n),
    evPositiveVolume: evPicks.length,
    evPositiveRoi: evPicks.length === 0 ? null : roiNumerator / evPicks.length,
    byMarket,
  };
}

function coefficientSummary(predictions: FoldPrediction[]) {
  const totals = new Map<string, { sum: number; n: number; nonzero: number }>();
  for (const p of predictions) {
    for (const [key, value] of Object.entries(p.coefficients ?? {})) {
      if (key === "intercept") continue;
      const prev = totals.get(key) ?? { sum: 0, n: 0, nonzero: 0 };
      prev.sum += value;
      prev.n++;
      if (Math.abs(value) > 1e-6) prev.nonzero++;
      totals.set(key, prev);
    }
  }
  return [...totals.entries()]
    .map(([feature, v]) => ({ feature, meanCoefficient: v.sum / Math.max(1, v.n), nonzeroFolds: v.nonzero, folds: v.n }))
    .sort((a, b) => Math.abs(b.meanCoefficient) - Math.abs(a.meanCoefficient));
}

function pickChangeReport(selected: FoldPrediction[], rows: DatasetRow[]) {
  const byId = new Map(selected.map((p) => [p.row.id, p]));
  const covered = rows.filter((r) => byId.has(r.id));
  const changed = covered.filter((r) => {
    const p = byId.get(r.id)!;
    const ev = expectedValuePerDollar(p.probability, r.recommendedPrice);
    return (ev ?? -1) <= 0 && !r.currentNoBet;
  });
  return {
    evaluatedRows: covered.length,
    convertedToNoPlay: changed.length,
    convertedToNoPlayPct: changed.length / Math.max(1, covered.length),
    changedPickOutcomeAccuracy: changed.reduce((a, r) => a + r.outcome, 0) / Math.max(1, changed.length),
    unchangedPickOutcomeAccuracy: covered.filter((r) => !changed.includes(r)).reduce((a, r) => a + r.outcome, 0) / Math.max(1, covered.length - changed.length),
  };
}

async function main() {
  const dataset = await buildDataset();
  const rows = dataset.rows;
  const dates = [...new Set(rows.map((r) => r.slateDate))].sort();
  const coverage = {
    rows: rows.length,
    rawPredictionRows: dataset.rawRows,
    uniqueSettledEvents: new Set(rows.map((r) => r.eventId)).size,
    uniqueSettledEventMarkets: new Set(rows.map((r) => `${r.eventId}:${r.market}`)).size,
    earliestDate: dates[0] ?? null,
    latestDate: dates[dates.length - 1] ?? null,
    uniqueDates: dates.length,
    markets: {
      moneyline: rows.filter((r) => r.market === "moneyline").length,
      spread: rows.filter((r) => r.market === "spread").length,
      total: rows.filter((r) => r.market === "total").length,
    },
    settledNonPushRows: rows.length,
    publicSplitRowsLoaded: dataset.publicSplitRows,
    v2SplitRowsLoaded: dataset.v2SplitRows,
    v2PriceRowsLoaded: dataset.v2PriceRows,
    sourceCoverage: {
      playbookRows: rows.filter((r) => r.sourceCoverage.playbook).length,
      draftkingsRows: rows.filter((r) => r.sourceCoverage.draftkings).length,
      circaRows: rows.filter((r) => r.sourceCoverage.circa).length,
      betmgmTicketRows: rows.filter((r) => r.sourceCoverage.betmgmTickets).length,
      priceActionRows: rows.filter((r) => r.sourceCoverage.priceAction).length,
      playbookDkCircaPriceRows: rows.filter((r) =>
        r.sourceCoverage.playbook &&
        r.sourceCoverage.draftkings &&
        r.sourceCoverage.circa &&
        r.sourceCoverage.priceAction
      ).length,
      allEvidenceFamilyRows: rows.filter((r) =>
        r.sourceCoverage.playbook &&
        r.sourceCoverage.draftkings &&
        r.sourceCoverage.circa &&
        r.sourceCoverage.priceAction &&
        r.sourceCoverage.betmgmTickets
      ).length,
      publicSplitsObservationRows: rows.filter((r) => r.sourceCoverage.publicSplitsObservation).length,
      v2SplitObservationRows: rows.filter((r) => r.sourceCoverage.v2SplitObservation).length,
    },
  };
  const candidateFeatureCoverage = {
    A_production: { rows: rows.length },
    B_independent_market: {
      rows: rows.length,
      independentRows: rows.filter((r) => r.independentProbability !== null).length,
      marketProbabilityRows: rows.filter((r) => r.marketProbability !== null).length,
    },
    C_price_action: {
      rows: rows.length,
      priceActionRows: rows.filter((r) => r.sourceCoverage.priceAction).length,
      sharpRetailGapRows: rows.filter((r) => r.sharpRetailPrice.sharpRetailProbabilityGap !== null).length,
    },
    D_playbook_levels: {
      rows: rows.length,
      playbookRows: rows.filter((r) => r.sourceCoverage.playbook).length,
    },
    E_playbook_temporal: {
      rows: rows.length,
      playbookTemporalRows: rows.filter((r) => r.playbookTemporal.sampleCount > 1).length,
    },
    F_betmgm_tickets: {
      rows: rows.length,
      betmgmTicketRows: rows.filter((r) => r.sourceCoverage.betmgmTickets).length,
    },
    G_real_dk_circa: {
      rows: rows.length,
      draftkingsRows: rows.filter((r) => r.sourceCoverage.draftkings).length,
      circaRows: rows.filter((r) => r.sourceCoverage.circa).length,
    },
  };
  const predictions: Record<ModelId, FoldPrediction[]> = {
    A_production: evaluateDirect(rows, "A_production"),
    B_independent_market: evaluateStacker(rows, "B_independent_market"),
    C_price_action: evaluateStacker(rows, "C_price_action"),
    D_playbook_levels: evaluateStacker(rows, "D_playbook_levels"),
    E_playbook_temporal: evaluateStacker(rows, "E_playbook_temporal"),
    F_betmgm_tickets: evaluateStacker(rows, "F_betmgm_tickets"),
    G_real_dk_circa: evaluateStacker(rows, "G_real_dk_circa"),
  };
  const summaries = Object.fromEntries(
    Object.entries(predictions).map(([id, preds]) => [id, summarize(preds)]),
  );
  const productionComparable = new Map(predictions.B_independent_market.map((p) => [p.row.id, p.row]));
  const comparableProduction = evaluateDirect([...productionComparable.values()], "A_production");
  const comparableProductionSummary = summarize(comparableProduction);
  const candidateIds: ModelId[] = [
    "B_independent_market",
    "C_price_action",
    "D_playbook_levels",
    "E_playbook_temporal",
    "F_betmgm_tickets",
    "G_real_dk_circa",
  ];
  const selected = candidateIds
    .map((id) => ({ id, summary: summaries[id] as ReturnType<typeof summarize> }))
    .filter((x) =>
      x.summary.n > 0 &&
      x.summary.logLoss < comparableProductionSummary.logLoss &&
      x.summary.brier <= comparableProductionSummary.brier + 0.002
    )
    .sort((a, b) => a.summary.logLoss - b.summary.logLoss)[0] ?? null;
  const selectedPredictions = selected ? predictions[selected.id] : [];

  const report = {
    generatedAt: new Date().toISOString(),
    leakageAudit: {
      chronologicalWalkForward: true,
      randomSplitsUsed: false,
      repeatedSnapshotsAsIndependentGames: false,
      postLockEvidenceAllowed: false,
      postStartEvidenceAllowed: false,
      closingDataUsedAsFeature: false,
      missingMarketConvertedToFiftyPercent: false,
      rawProviderPercentagesAveraged: false,
    },
    currentModelAudit: {
      productionModelProbabilityIsMarketBlended: true,
      pIndependentRecoveredFrom: "prediction_records.snapshot_json.v2_2_audit independent_home_runs/independent_away_runs, v2_1 fallback",
      legacyMarketInfluence: [
        "V2.2 computeMarketBaseline market prior",
        "posterior blend toward market",
        "probability-space regularization toward no-vig market",
        "Best Angle public-money and line-movement demotions in predictionRecordService",
        "ML inversion flip override",
        "totals mean-side flip/standdown override",
        "Lean EV/probability/rungap/total-market gate",
      ],
    },
    coverage,
    candidateFeatureCoverage,
    comparableProductionSummary,
    modelSummaries: summaries,
    selectedProductionCandidate: selected,
    coefficientSummary: selected ? coefficientSummary(selectedPredictions).slice(0, 30) : [],
    pickChangeReport: selected ? pickChangeReport(selectedPredictions, rows) : null,
    cutoverRecommendation: selected
      ? "Candidate clears the initial proper-score gate on comparable folds; review calibration/CLV before enabling MARKET_AWARE_ENGINE_ENABLED."
      : "No candidate cleared the proper-score gate versus current production on available historical rows; keep MARKET_AWARE_ENGINE_ENABLED=false.",
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
