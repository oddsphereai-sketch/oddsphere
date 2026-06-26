import { mkdirSync, writeFileSync } from "node:fs";
import { supabase } from "../../lib/db/supabase";
import {
  brierScore,
  deVigTwoWayProbability,
  expectedValuePerDollar,
  fitRidgeLogistic,
  logLoss,
  logit,
  predictRidgeLogistic,
} from "../../lib/services/marketAwareEngine/core";
import {
  homeWinProbabilityPoisson,
  overProbabilityPoisson,
  poissonPmf,
} from "../../lib/automodel/runDistribution";

type Sport = "mlb" | "wnba";
type Market = "moneyline" | "spread" | "total";
type Result = "win" | "loss" | "push" | "void" | "pending" | "";
type Confidence = "high" | "medium" | "low";

type GradeJoin = {
  result: string | null;
  push: boolean | null;
  win: boolean | null;
  loss: boolean | null;
  void: boolean | null;
  pending: boolean | null;
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_total: number | null;
  winning_team: string | null;
};

type PredictionRow = {
  id: number;
  game_id: number;
  external_id: number;
  sport: Sport;
  slate_date: string;
  game_date: string | null;
  matchup: string | null;
  market: Market;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  confidence: number | null;
  model_probability: number | null;
  market_probability: number | null;
  expected_value: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  held: boolean | null;
  locked_at: string | null;
  published_at: string | null;
  created_at: string | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades?: GradeJoin[] | GradeJoin | null;
  games?: {
    home_score: number | null;
    away_score: number | null;
    total_runs: number | null;
  }[] | {
    home_score: number | null;
    away_score: number | null;
    total_runs: number | null;
  } | null;
};

type SnapshotRow = {
  canonical_event_id: string;
  market_type: Market;
  selection_key: string;
  score: number;
  label: string;
  evidence_json: Record<string, unknown> | null;
  generated_at: string;
  evidence_as_of: string | null;
  recommendation_locked_at: string | null;
  selected_side: string | null;
  selected_line: number | null;
  selected_price: number | null;
  validity_status: string | null;
};

type SplitRow = {
  canonical_event_id: string;
  league: string | null;
  market_type: Market;
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

type PriceRow = {
  canonical_event_id: string;
  league: string | null;
  sportsbook: string | null;
  sharp_book: boolean | null;
  market_type: Market;
  selection_key: string | null;
  line: number | null;
  american_price: number | null;
  no_vig_probability: number | null;
  provider_timestamp: string | null;
  fetched_at: string | null;
  minutes_to_start: number | null;
};

type PublicSplitRow = {
  provider: string | null;
  sport: string | null;
  game_id: number;
  market_type: Market;
  side: string | null;
  public_betting_pct: number | null;
  public_money_pct: number | null;
  books_used: number | null;
  observed_at: string | null;
  created_at: string | null;
};

type LineRow = {
  game_id: number;
  market_type: Market;
  sportsbook: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  recorded_at?: string | null;
  fetched_at?: string | null;
  created_at?: string | null;
};

type EvidenceGroups = {
  A_v2_snapshot_usable: boolean;
  B_v2_snapshot_missing_raw_market_observations_exist: boolean;
  C_legacy_prelock_odds_exist: boolean;
  D_locked_record_price_exists: boolean;
  E_playbook_pregame_consensus_exists: boolean;
  F_dk_circa_timestamped_history_exists: boolean;
  G_only_post_lock_or_post_start_evidence_exists: boolean;
  H_unrecoverable_safely: boolean;
};

type ReconstructedRow = {
  id: number;
  sport: Sport;
  market: Market;
  date: string;
  matchup: string;
  gameId: number;
  externalId: number;
  side: string;
  line: number | null;
  price: number | null;
  asOf: string;
  eventStart: string | null;
  grade: string | null;
  tier: "best_angle" | "lean" | "no_play" | "other";
  result: Result;
  outcome: 0 | 1;
  oppositeSide: string;
  oppositeLine: number | null;
  oppositePrice: number | null;
  oppositeOutcome: 0 | 1 | null;
  actualTotal: number | null;
  actualMarginHome: number | null;
  pCurrentProduction: number;
  pIndependentModel: number | null;
  pMarketNoVigAtLock: number | null;
  pMarketSource: string | null;
  sharpMarketNoVigAtLock: number | null;
  retailMarketNoVigAtLock: number | null;
  sharpVsRetailGapAtLock: number | null;
  firstTrackedPriceBeforeLock: number | null;
  lastPriceBeforeLock: number | null;
  priceMovementBeforeLock: number | null;
  firstTrackedLineBeforeLock: number | null;
  lastLineBeforeLock: number | null;
  lineMovementBeforeLock: number | null;
  movementDirectionRelativeToPick: "support" | "resistance" | "neutral" | null;
  playbookFinalPregameConsensus: {
    betsPct: number | null;
    moneyPct: number | null;
    booksUsed: number | null;
    lineBasis: number | null;
  } | null;
  playbookMoneyBetsGap: number | null;
  dkSplit: { betsPct: number | null; moneyPct: number | null; observedAt: string | null } | null;
  circaSplit: { betsPct: number | null; moneyPct: number | null; observedAt: string | null } | null;
  v2SnapshotLabel: string | null;
  v2LabelReconstructed: string;
  evidenceCompletenessScore: number;
  reconstructionConfidence: Confidence;
  evidenceGroups: EvidenceGroups;
  unrecoverableReason: string | null;
  closingPrice: number | null;
  closingLine: number | null;
  bestAvailablePriceAtLock: number | null;
  bestAvailableBookAtLock: string | null;
  selectedToBestPriceEvDelta: number | null;
  clvPriceMovement: number | null;
  beatClosingLine: boolean | null;
  projectedTotal: number | null;
  projectedMarginHome: number | null;
};

type Prediction = {
  row: ReconstructedRow;
  id: string;
  side: string | null;
  probability: number;
  price: number | null;
  outcome: 0 | 1 | null;
  result: Result;
  tier: ReconstructedRow["tier"];
  reason: string;
};

const SHARP_BOOKS = new Set(["pinnacle", "circa", "bookmaker"]);
const RETAIL_BOOKS = new Set(["draftkings", "fanduel", "betmgm", "caesars"]);

function one<T>(v: T[] | T | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function bool(v: unknown): boolean {
  return v === true || v === "true";
}

function time(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function notAfter(raw: string | null | undefined, cutoff: string | null | undefined): boolean {
  const a = time(raw);
  const b = time(cutoff);
  return a !== null && b !== null && a <= b;
}

function beforeLockAndStart(raw: string | null | undefined, row: PredictionRow | ReconstructedRow): boolean {
  const asOf = "asOf" in row ? row.asOf : asOfFor(row);
  const start = "eventStart" in row ? row.eventStart : row.game_date;
  if (!raw || !asOf) return false;
  if (!notAfter(raw, asOf)) return false;
  return start ? notAfter(raw, start) : true;
}

function afterLockBeforeStart(raw: string | null | undefined, row: ReconstructedRow): boolean {
  const t = time(raw);
  const lock = time(row.asOf);
  const start = time(row.eventStart);
  if (t === null || lock === null) return false;
  if (t <= lock) return false;
  return start === null || t <= start;
}

function asOfFor(row: PredictionRow): string | null {
  return row.locked_at ?? row.published_at ?? row.created_at;
}

function lineTime(row: LineRow): string | null {
  return row.recorded_at ?? row.fetched_at ?? row.created_at ?? null;
}

function selectionKey(eventId: number, market: Market, side: string): string {
  return `${eventId}:${market}:${side}`;
}

function mapKey(eventId: number | string, market: Market, side: string): string {
  return `${eventId}:${market}:${side}`;
}

function resultFromGrade(row: PredictionRow): Result {
  const g = one(row.prediction_grades);
  if (!g) return "";
  const r = String(g.result ?? "").toLowerCase();
  if (g.pending || r === "pending") return "pending";
  if (g.void || r === "void") return "void";
  if (g.push || r === "push") return "push";
  if (g.win || r === "win") return "win";
  if (g.loss || r === "loss") return "loss";
  return "";
}

function score(row: PredictionRow): { home: number | null; away: number | null; total: number | null } {
  const g = one(row.games);
  const gr = one(row.prediction_grades);
  const home = g?.home_score ?? gr?.actual_home_score ?? null;
  const away = g?.away_score ?? gr?.actual_away_score ?? null;
  return {
    home,
    away,
    total: g?.total_runs ?? gr?.actual_total ?? (home !== null && away !== null ? home + away : null),
  };
}

function profit(odds: number | null, result: Result): number | null {
  if (result !== "win" && result !== "loss") return null;
  if (odds === null || !Number.isFinite(odds) || odds === 0) return null;
  if (result === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function implied(odds: number | null): number | null {
  if (odds === null || odds === 0 || !Number.isFinite(odds)) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function decimalOdds(odds: number | null): number | null {
  if (odds === null || odds === 0 || !Number.isFinite(odds)) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function oppositeSide(market: Market, side: string): string | null {
  if (market === "moneyline" || market === "spread") {
    if (side === "home") return "away";
    if (side === "away") return "home";
    return null;
  }
  if (side === "over") return "under";
  if (side === "under") return "over";
  return null;
}

function oppositeLine(market: Market, line: number | null): number | null {
  return market === "spread" && line !== null ? -line : line;
}

function resultFor(row: PredictionRow, side: string, line: number | null): Result {
  const s = score(row);
  if (row.market === "moneyline") {
    if (s.home === null || s.away === null) return "";
    if (s.home === s.away) return "push";
    const homeWon = s.home > s.away;
    return side === "home" ? (homeWon ? "win" : "loss") : (!homeWon ? "win" : "loss");
  }
  if (row.market === "total") {
    if (s.total === null || line === null) return "";
    if (s.total === line) return "push";
    const overWon = s.total > line;
    return side === "over" ? (overWon ? "win" : "loss") : (!overWon ? "win" : "loss");
  }
  if (s.home === null || s.away === null || line === null) return "";
  const margin = side === "home" ? s.home + line - s.away : s.away + line - s.home;
  if (margin === 0) return "push";
  return margin > 0 ? "win" : "loss";
}

function tier(row: PredictionRow): ReconstructedRow["tier"] {
  const g = String(row.play_grade ?? "").toLowerCase();
  if (row.best_angle || g === "best_angle" || g === "best_signal") return "best_angle";
  if (g === "lean") return "lean";
  if (row.no_bet || g === "no_play" || g === "toss_up" || g === "held") return "no_play";
  return "other";
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

function independent(row: PredictionRow): {
  probability: number | null;
  projectedTotal: number | null;
  projectedMarginHome: number | null;
} {
  const snap = rec(row.snapshot_json);
  const v22 = rec(snap.v2_2_audit);
  const v21 = rec(snap.v2_1_audit);
  const homeRuns = num(v22.independent_home_runs) ?? num(v21.independent_home_runs);
  const awayRuns = num(v22.independent_away_runs) ?? num(v21.independent_away_runs);
  if (homeRuns === null || awayRuns === null) {
    const projectedTotal =
      num(snap.projected_total) ??
      num(snap.predicted_total) ??
      num(rec(snap.projection).total) ??
      null;
    const projectedMarginHome =
      num(snap.projected_margin_home) ??
      num(snap.predicted_margin_home) ??
      num(rec(snap.projection).home_margin) ??
      null;
    return { probability: null, projectedTotal, projectedMarginHome };
  }
  if (row.market === "moneyline") {
    const homeProb = homeWinProbabilityPoisson(homeRuns, awayRuns);
    return {
      probability: row.side === "away" ? 1 - homeProb : homeProb,
      projectedTotal: homeRuns + awayRuns,
      projectedMarginHome: homeRuns - awayRuns,
    };
  }
  if (row.market === "total") {
    if (row.line_value === null) {
      return { probability: null, projectedTotal: homeRuns + awayRuns, projectedMarginHome: homeRuns - awayRuns };
    }
    const pOver = overProbabilityPoisson(homeRuns, awayRuns, row.line_value);
    return {
      probability: row.side === "under" ? 1 - pOver : pOver,
      projectedTotal: homeRuns + awayRuns,
      projectedMarginHome: homeRuns - awayRuns,
    };
  }
  if (row.line_value === null || (row.side !== "home" && row.side !== "away")) {
    return { probability: null, projectedTotal: homeRuns + awayRuns, projectedMarginHome: homeRuns - awayRuns };
  }
  return {
    probability: spreadCoverProbabilityPoisson(homeRuns, awayRuns, row.side, row.line_value),
    projectedTotal: homeRuns + awayRuns,
    projectedMarginHome: homeRuns - awayRuns,
  };
}

function median(xs: number[]): number | null {
  const vals = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

function lineMatches(market: Market, candidateLine: number | null, rowLine: number | null): boolean {
  if (market === "moneyline") return true;
  if (candidateLine === null || rowLine === null) return false;
  return Math.abs(candidateLine - rowLine) < 0.001;
}

function latestLinePairProbability(
  rows: LineRow[],
  row: PredictionRow,
  side: string,
  opp: string,
  oppLine: number | null,
): { probability: number | null; source: string | null } {
  const byBook = new Map<string, { side?: LineRow; opp?: LineRow }>();
  const eligible = rows
    .filter((r) => r.game_id === row.game_id && r.market_type === row.market)
    .filter((r) => beforeLockAndStart(lineTime(r), row));
  for (const r of eligible) {
    const book = (r.sportsbook ?? "unknown").toLowerCase();
    const bucket = byBook.get(book) ?? {};
    if (r.side === side && lineMatches(row.market, r.line_value, row.line_value)) {
      if (!bucket.side || (time(lineTime(r)) ?? 0) > (time(lineTime(bucket.side)) ?? 0)) bucket.side = r;
    }
    if (r.side === opp && lineMatches(row.market, r.line_value, oppLine)) {
      if (!bucket.opp || (time(lineTime(r)) ?? 0) > (time(lineTime(bucket.opp)) ?? 0)) bucket.opp = r;
    }
    byBook.set(book, bucket);
  }
  const pairs = [...byBook.entries()]
    .filter(([, p]) => p.side?.odds_american != null && p.opp?.odds_american != null)
    .sort((a, b) => (time(lineTime(b[1].side!)) ?? 0) - (time(lineTime(a[1].side!)) ?? 0));
  const best = pairs[0];
  if (!best) return { probability: null, source: null };
  return {
    probability: deVigTwoWayProbability(best[1].side!.odds_american, best[1].opp!.odds_american),
    source: `legacy_lines:${best[0]}`,
  };
}

function latestV2NoVig(rows: PriceRow[], row: PredictionRow): { probability: number | null; source: string | null } {
  const vals = rows
    .filter((r) => beforeLockAndStart(r.provider_timestamp ?? r.fetched_at, row))
    .filter((r) => lineMatches(row.market, r.line, row.line_value))
    .sort((a, b) => (time(b.provider_timestamp ?? b.fetched_at) ?? 0) - (time(a.provider_timestamp ?? a.fetched_at) ?? 0));
  const p = median(vals.slice(0, 8).map((r) => r.no_vig_probability).filter((v): v is number => typeof v === "number"));
  return { probability: p, source: p === null ? null : "market_price_observations_v2" };
}

function sharpRetail(rows: PriceRow[], row: PredictionRow): {
  sharp: number | null;
  retail: number | null;
  gap: number | null;
} {
  const eligible = rows
    .filter((r) => beforeLockAndStart(r.provider_timestamp ?? r.fetched_at, row))
    .filter((r) => lineMatches(row.market, r.line, row.line_value));
  const sharp = median(eligible
    .filter((r) => r.sharp_book || SHARP_BOOKS.has((r.sportsbook ?? "").toLowerCase()))
    .map((r) => r.no_vig_probability)
    .filter((v): v is number => typeof v === "number"));
  const retail = median(eligible
    .filter((r) => !r.sharp_book && RETAIL_BOOKS.has((r.sportsbook ?? "").toLowerCase()))
    .map((r) => r.no_vig_probability)
    .filter((v): v is number => typeof v === "number"));
  return { sharp, retail, gap: sharp !== null && retail !== null ? sharp - retail : null };
}

function lineMovementFromLines(rows: LineRow[], row: PredictionRow): {
  firstPrice: number | null;
  lastPrice: number | null;
  priceMove: number | null;
  firstLine: number | null;
  lastLine: number | null;
  lineMove: number | null;
} {
  const eligible = rows
    .filter((r) => r.game_id === row.game_id && r.market_type === row.market && r.side === row.side)
    .filter((r) => beforeLockAndStart(lineTime(r), row))
    .sort((a, b) => (time(lineTime(a)) ?? 0) - (time(lineTime(b)) ?? 0));
  if (eligible.length === 0) {
    return { firstPrice: null, lastPrice: null, priceMove: null, firstLine: null, lastLine: null, lineMove: null };
  }
  const first = eligible[0];
  const last = eligible[eligible.length - 1];
  const firstImp = implied(first.odds_american);
  const lastImp = implied(last.odds_american);
  return {
    firstPrice: first.odds_american,
    lastPrice: last.odds_american,
    priceMove: firstImp !== null && lastImp !== null ? lastImp - firstImp : null,
    firstLine: first.line_value,
    lastLine: last.line_value,
    lineMove: first.line_value !== null && last.line_value !== null ? last.line_value - first.line_value : null,
  };
}

function movementDirection(market: Market, side: string, lineMove: number | null, priceMove: number | null): ReconstructedRow["movementDirectionRelativeToPick"] {
  if (lineMove !== null && Math.abs(lineMove) > 0.001) {
    if (market === "total") {
      if (side === "over") return lineMove > 0 ? "support" : "resistance";
      if (side === "under") return lineMove < 0 ? "support" : "resistance";
    }
    if (market === "spread") {
      if (side === "home" || side === "away") {
        return lineMove < 0 ? "support" : "resistance";
      }
    }
  }
  if (priceMove !== null && Math.abs(priceMove) >= 0.005) return priceMove > 0 ? "support" : "resistance";
  return priceMove !== null || lineMove !== null ? "neutral" : null;
}

function latestSplit(rows: SplitRow[], row: PredictionRow, provider: string, book: string): SplitRow | null {
  return rows
    .filter((r) => (r.provider ?? "").toLowerCase() === provider && (r.source_book ?? "").toLowerCase() === book)
    .filter((r) => beforeLockAndStart(r.source_observed_at ?? r.fetched_at, row))
    .sort((a, b) => (time(b.source_observed_at ?? b.fetched_at) ?? 0) - (time(a.source_observed_at ?? a.fetched_at) ?? 0))[0] ?? null;
}

function latestPublicPlaybook(rows: PublicSplitRow[], row: PredictionRow): PublicSplitRow | null {
  return rows
    .filter((r) => (r.provider ?? "").toLowerCase() === "playbook" && r.market_type === row.market && r.side === row.side)
    .filter((r) => beforeLockAndStart(r.observed_at ?? r.created_at, row))
    .sort((a, b) => (time(b.observed_at ?? b.created_at) ?? 0) - (time(a.observed_at ?? a.created_at) ?? 0))[0] ?? null;
}

function selectSnapshot(rows: SnapshotRow[], row: PredictionRow): SnapshotRow | null {
  return rows
    .filter((s) => s.market_type === row.market && s.selection_key === selectionKey(row.external_id, row.market, row.side ?? ""))
    .filter((s) => s.validity_status === "valid_directional" || s.validity_status === "valid_nondirectional")
    .filter((s) => beforeLockAndStart(s.evidence_as_of ?? s.generated_at, row))
    .sort((a, b) => (time(b.generated_at) ?? 0) - (time(a.generated_at) ?? 0))[0] ?? null;
}

function reconstructedLabel(direction: ReconstructedRow["movementDirectionRelativeToPick"], scoreHint: number): string {
  if (direction === "support") {
    if (scoreHint >= 2) return "Market Support";
    return "Slight Market Support";
  }
  if (direction === "resistance") {
    if (scoreHint <= -2) return "Market Resistance";
    return "Slight Market Resistance";
  }
  return "Projection-Led";
}

function closingLine(rows: LineRow[], row: ReconstructedRow): { price: number | null; line: number | null } {
  const eligible = rows
    .filter((r) => r.game_id === row.gameId && r.market_type === row.market && r.side === row.side)
    .filter((r) => afterLockBeforeStart(lineTime(r), row))
    .sort((a, b) => (time(lineTime(b)) ?? 0) - (time(lineTime(a)) ?? 0));
  return { price: eligible[0]?.odds_american ?? null, line: eligible[0]?.line_value ?? null };
}

function bestAvailableAtLock(rows: LineRow[], row: PredictionRow): { price: number | null; book: string | null } {
  const eligible = rows
    .filter((r) => r.game_id === row.game_id && r.market_type === row.market && r.side === row.side)
    .filter((r) => lineMatches(row.market, r.line_value, row.line_value))
    .filter((r) => beforeLockAndStart(lineTime(r), row));
  const latestByBook = new Map<string, LineRow>();
  for (const r of eligible) {
    const book = (r.sportsbook ?? "unknown").toLowerCase();
    const prev = latestByBook.get(book);
    if (!prev || (time(lineTime(r)) ?? 0) > (time(lineTime(prev)) ?? 0)) latestByBook.set(book, r);
  }
  const best = [...latestByBook.values()]
    .filter((r) => decimalOdds(r.odds_american) !== null)
    .sort((a, b) => (decimalOdds(b.odds_american) ?? 0) - (decimalOdds(a.odds_american) ?? 0))[0];
  return { price: best?.odds_american ?? null, book: best?.sportsbook ?? null };
}

function beatClose(row: ReconstructedRow): boolean | null {
  if (row.closingLine === null && row.closingPrice === null) return null;
  if (row.market === "total" && row.closingLine !== null && row.line !== null) {
    if (row.side === "over") return row.line < row.closingLine;
    if (row.side === "under") return row.line > row.closingLine;
  }
  if (row.market === "spread" && row.closingLine !== null && row.line !== null) {
    return row.line > row.closingLine;
  }
  const lock = implied(row.price);
  const close = implied(row.closingPrice);
  if (lock === null || close === null) return null;
  return close > lock;
}

async function pagedPredictions(): Promise<PredictionRow[]> {
  const out: PredictionRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select("id,game_id,external_id,sport,slate_date,game_date,matchup,market,pick,side,line_value,odds_american,confidence,model_probability,market_probability,expected_value,play_grade,best_angle,no_bet,held,locked_at,published_at,created_at,snapshot_json,prediction_grades(result,push,win,loss,void,pending,actual_home_score,actual_away_score,actual_total,winning_team),games(home_score,away_score,total_runs)")
      .in("sport", ["mlb", "wnba"])
      .in("market", ["moneyline", "spread", "total"])
      .order("slate_date", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`prediction_records fetch failed: ${error.message}`);
    out.push(...((data ?? []) as PredictionRow[]));
    if ((data ?? []).length < page) break;
  }
  return out;
}

async function loadSnapshots(ids: number[]): Promise<Map<number, SnapshotRow[]>> {
  const out = new Map<number, SnapshotRow[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("market_intelligence_snapshots_v2")
      .select("canonical_event_id,market_type,selection_key,score,label,evidence_json,generated_at,evidence_as_of,recommendation_locked_at,selected_side,selected_line,selected_price,validity_status")
      .in("canonical_event_id", ids.slice(i, i + 200).map(String));
    if (error) throw new Error(`snapshots fetch failed: ${error.message}`);
    for (const r of (data ?? []) as SnapshotRow[]) {
      const id = Number(r.canonical_event_id);
      const arr = out.get(id) ?? [];
      arr.push(r);
      out.set(id, arr);
    }
  }
  return out;
}

async function loadSplits(ids: number[]): Promise<Map<string, SplitRow[]>> {
  const out = new Map<string, SplitRow[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("market_split_observations_v2")
      .select("canonical_event_id,league,market_type,selection_key,provider,source_book,source_type,bets_pct,money_pct,market_line,market_price,books_used,source_observed_at,fetched_at,minutes_to_start")
      .in("canonical_event_id", ids.slice(i, i + 200).map(String));
    if (error) throw new Error(`market_split_observations_v2 fetch failed: ${error.message}`);
    for (const r of (data ?? []) as SplitRow[]) {
      const side = r.selection_key?.split(":").pop() ?? "";
      const k = mapKey(r.canonical_event_id, r.market_type, side);
      const arr = out.get(k) ?? [];
      arr.push(r);
      out.set(k, arr);
    }
  }
  return out;
}

async function loadPrices(ids: number[]): Promise<Map<string, PriceRow[]>> {
  const out = new Map<string, PriceRow[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("market_price_observations_v2")
      .select("canonical_event_id,league,sportsbook,sharp_book,market_type,selection_key,line,american_price,no_vig_probability,provider_timestamp,fetched_at,minutes_to_start")
      .in("canonical_event_id", ids.slice(i, i + 200).map(String));
    if (error) throw new Error(`market_price_observations_v2 fetch failed: ${error.message}`);
    for (const r of (data ?? []) as PriceRow[]) {
      const side = r.selection_key?.split(":").pop() ?? "";
      const k = mapKey(r.canonical_event_id, r.market_type, side);
      const arr = out.get(k) ?? [];
      arr.push(r);
      out.set(k, arr);
    }
  }
  return out;
}

async function loadLines(gameIds: number[]): Promise<Map<number, LineRow[]>> {
  const out = new Map<number, LineRow[]>();
  for (let i = 0; i < gameIds.length; i += 200) {
    const ids = gameIds.slice(i, i + 200);
    const history = await supabase
      .from("line_history")
      .select("game_id,market_type,sportsbook,side,line_value,odds_american,recorded_at,created_at")
      .in("game_id", ids)
      .in("market_type", ["moneyline", "spread", "total"]);
    if (history.error) throw new Error(`line_history fetch failed: ${history.error.message}`);
    const current = await supabase
      .from("lines")
      .select("game_id,market_type,sportsbook,side,line_value,odds_american,fetched_at,created_at")
      .in("game_id", ids)
      .in("market_type", ["moneyline", "spread", "total"]);
    if (current.error) throw new Error(`lines fetch failed: ${current.error.message}`);
    for (const r of [...((history.data ?? []) as LineRow[]), ...((current.data ?? []) as LineRow[])]) {
      const arr = out.get(r.game_id) ?? [];
      arr.push(r);
      out.set(r.game_id, arr);
    }
  }
  return out;
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
    for (const r of (data ?? []) as PublicSplitRow[]) {
      const k = `${r.game_id}:${r.market_type}:${r.side ?? ""}`;
      const arr = out.get(k) ?? [];
      arr.push(r);
      out.set(k, arr);
    }
  }
  return out;
}

function dedupe(rows: PredictionRow[]): PredictionRow[] {
  const byKey = new Map<string, PredictionRow>();
  for (const r of rows) {
    if (r.held || !r.pick || !r.side || r.model_probability === null) continue;
    const res = resultFromGrade(r);
    if (res !== "win" && res !== "loss" && res !== "push") continue;
    const k = `${r.sport}:${r.game_id}:${r.market}`;
    const prev = byKey.get(k);
    const rt = time(asOfFor(r)) ?? 0;
    const pt = prev ? time(asOfFor(prev)) ?? 0 : -1;
    if (!prev || rt > pt || (rt === pt && r.id > prev.id)) byKey.set(k, r);
  }
  return [...byKey.values()].sort((a, b) => a.slate_date.localeCompare(b.slate_date) || a.id - b.id);
}

function reconstructRow(
  row: PredictionRow,
  snapshots: SnapshotRow[],
  splitRows: SplitRow[],
  priceRows: PriceRow[],
  lineRows: LineRow[],
  publicRows: PublicSplitRow[],
): ReconstructedRow | null {
  const res = resultFromGrade(row);
  if (res !== "win" && res !== "loss") return null;
  const asOf = asOfFor(row);
  if (!asOf || !row.side || row.model_probability === null) return null;
  const opp = oppositeSide(row.market, row.side);
  if (!opp) return null;
  const oppLine = oppositeLine(row.market, row.line_value);
  const oppRes = resultFor(row, opp, oppLine);
  const snap = selectSnapshot(snapshots, row);
  const sideSplits = splitRows;
  const sidePrices = priceRows;
  const rawPrelock = [...sideSplits.map((r) => r.source_observed_at ?? r.fetched_at), ...sidePrices.map((r) => r.provider_timestamp ?? r.fetched_at)]
    .some((t) => beforeLockAndStart(t, row));
  const rawPostOnly = (sideSplits.length + sidePrices.length > 0) && !rawPrelock;
  const legacyPrelock = lineRows
    .filter((r) => r.game_id === row.game_id && r.market_type === row.market && r.side === row.side)
    .some((r) => beforeLockAndStart(lineTime(r), row));
  const playbookV2 = latestSplit(sideSplits, row, "playbook", "consensus");
  const playbookPublic = latestPublicPlaybook(publicRows, row);
  const dk = latestSplit(sideSplits, row, "sharpapi", "draftkings");
  const circa = latestSplit(sideSplits, row, "sharpapi", "circa");
  const v2Prob = latestV2NoVig(sidePrices, row);
  const legacyProb = latestLinePairProbability(lineRows, row, row.side, opp, oppLine);
  const sr = sharpRetail(sidePrices, row);
  const lm = lineMovementFromLines(lineRows, row);
  const direction = movementDirection(row.market, row.side, lm.lineMove, lm.priceMove);
  const scoreHint = snap?.score ?? (direction === "support" ? 1 : direction === "resistance" ? -1 : 0);
  const ind = independent(row);
  const s = score(row);

  const pMarket =
    v2Prob.probability ??
    legacyProb.probability ??
    row.market_probability ??
    null;
  const pSource =
    v2Prob.probability !== null ? v2Prob.source :
    legacyProb.probability !== null ? legacyProb.source :
    row.market_probability !== null ? "prediction_records.market_probability" :
    null;

  const groups: EvidenceGroups = {
    A_v2_snapshot_usable: snap !== null,
    B_v2_snapshot_missing_raw_market_observations_exist: snap === null && rawPrelock,
    C_legacy_prelock_odds_exist: legacyPrelock,
    D_locked_record_price_exists: (
      (row.odds_american !== null && (row.market === "moneyline" || row.line_value !== null)) ||
      row.market_probability !== null
    ),
    E_playbook_pregame_consensus_exists: playbookV2 !== null || playbookPublic !== null,
    F_dk_circa_timestamped_history_exists:
      (dk !== null && dk.source_observed_at !== null && beforeLockAndStart(dk.source_observed_at, row)) ||
      (circa !== null && circa.source_observed_at !== null && beforeLockAndStart(circa.source_observed_at, row)),
    G_only_post_lock_or_post_start_evidence_exists: rawPostOnly,
    H_unrecoverable_safely: false,
  };
  const recoverable =
    groups.A_v2_snapshot_usable ||
    groups.B_v2_snapshot_missing_raw_market_observations_exist ||
    groups.C_legacy_prelock_odds_exist ||
    groups.D_locked_record_price_exists ||
    groups.E_playbook_pregame_consensus_exists ||
    groups.F_dk_circa_timestamped_history_exists;
  groups.H_unrecoverable_safely = !recoverable;
  const completeness =
    (groups.A_v2_snapshot_usable ? 0.2 : 0) +
    (rawPrelock ? 0.25 : 0) +
    (groups.C_legacy_prelock_odds_exist ? 0.2 : 0) +
    (groups.E_playbook_pregame_consensus_exists ? 0.15 : 0) +
    (groups.F_dk_circa_timestamped_history_exists ? 0.1 : 0) +
    (sr.gap !== null ? 0.1 : 0);
  const confidence: Confidence = rawPrelock && (legacyPrelock || snap) ? "high" : legacyPrelock || pMarket !== null ? "medium" : "low";

  const provisional: ReconstructedRow = {
    id: row.id,
    sport: row.sport,
    market: row.market,
    date: row.slate_date,
    matchup: row.matchup ?? "",
    gameId: row.game_id,
    externalId: row.external_id,
    side: row.side,
    line: row.line_value,
    price: row.odds_american,
    asOf,
    eventStart: row.game_date,
    grade: row.play_grade,
    tier: tier(row),
    result: res,
    outcome: res === "win" ? 1 : 0,
    oppositeSide: opp,
    oppositeLine: oppLine,
    oppositePrice: null,
    oppositeOutcome: oppRes === "win" ? 1 : oppRes === "loss" ? 0 : null,
    actualTotal: s.total,
    actualMarginHome: s.home !== null && s.away !== null ? s.home - s.away : null,
    pCurrentProduction: row.model_probability,
    pIndependentModel: ind.probability,
    pMarketNoVigAtLock: pMarket,
    pMarketSource: pSource,
    sharpMarketNoVigAtLock: sr.sharp,
    retailMarketNoVigAtLock: sr.retail,
    sharpVsRetailGapAtLock: sr.gap,
    firstTrackedPriceBeforeLock: lm.firstPrice,
    lastPriceBeforeLock: lm.lastPrice,
    priceMovementBeforeLock: lm.priceMove,
    firstTrackedLineBeforeLock: lm.firstLine,
    lastLineBeforeLock: lm.lastLine,
    lineMovementBeforeLock: lm.lineMove,
    movementDirectionRelativeToPick: direction,
    playbookFinalPregameConsensus: playbookV2 ? {
      betsPct: playbookV2.bets_pct,
      moneyPct: playbookV2.money_pct,
      booksUsed: playbookV2.books_used,
      lineBasis: playbookV2.market_line,
    } : playbookPublic ? {
      betsPct: playbookPublic.public_betting_pct,
      moneyPct: playbookPublic.public_money_pct,
      booksUsed: playbookPublic.books_used,
      lineBasis: null,
    } : null,
    playbookMoneyBetsGap:
      playbookV2?.money_pct != null && playbookV2?.bets_pct != null ? (playbookV2.money_pct - playbookV2.bets_pct) :
      playbookPublic?.public_money_pct != null && playbookPublic?.public_betting_pct != null ? (playbookPublic.public_money_pct - playbookPublic.public_betting_pct) :
      null,
    dkSplit: dk ? { betsPct: dk.bets_pct, moneyPct: dk.money_pct, observedAt: dk.source_observed_at } : null,
    circaSplit: circa ? { betsPct: circa.bets_pct, moneyPct: circa.money_pct, observedAt: circa.source_observed_at } : null,
    v2SnapshotLabel: snap?.label ?? null,
    v2LabelReconstructed: snap?.label ?? reconstructedLabel(direction, scoreHint),
    evidenceCompletenessScore: Math.min(1, completeness),
    reconstructionConfidence: confidence,
    evidenceGroups: groups,
    unrecoverableReason: groups.H_unrecoverable_safely ? "No usable pre-lock v2, legacy line, locked price, or timestamped consensus/split evidence." : null,
    closingPrice: null,
    closingLine: null,
    bestAvailablePriceAtLock: null,
    bestAvailableBookAtLock: null,
    selectedToBestPriceEvDelta: null,
    clvPriceMovement: null,
    beatClosingLine: null,
    projectedTotal: ind.projectedTotal,
    projectedMarginHome: ind.projectedMarginHome,
  };
  const close = closingLine(lineRows, provisional);
  const best = bestAvailableAtLock(lineRows, row);
  const lockImp = implied(row.odds_american);
  const closeImp = implied(close.price);
  provisional.closingPrice = close.price;
  provisional.closingLine = close.line;
  provisional.bestAvailablePriceAtLock = best.price;
  provisional.bestAvailableBookAtLock = best.book;
  const selectedEv = expectedValuePerDollar(row.model_probability, row.odds_american);
  const bestEv = expectedValuePerDollar(row.model_probability, best.price);
  provisional.selectedToBestPriceEvDelta = selectedEv !== null && bestEv !== null ? bestEv - selectedEv : null;
  provisional.clvPriceMovement = lockImp !== null && closeImp !== null ? closeImp - lockImp : null;
  provisional.beatClosingLine = beatClose(provisional);
  provisional.oppositePrice = latestLinePairProbability(lineRows, row, opp, row.side, row.line_value).source ? null : null;
  const oppRows = lineRows
    .filter((r) => r.game_id === row.game_id && r.market_type === row.market && r.side === opp)
    .filter((r) => lineMatches(row.market, r.line_value, oppLine))
    .filter((r) => beforeLockAndStart(lineTime(r), row))
    .sort((a, b) => (time(lineTime(b)) ?? 0) - (time(lineTime(a)) ?? 0));
  provisional.oppositePrice = oppRows[0]?.odds_american ?? null;
  return provisional;
}

async function buildRows(): Promise<{ rows: ReconstructedRow[]; rawRows: number; officialRows: number }> {
  const raw = await pagedPredictions();
  const official = dedupe(raw);
  const ids = [...new Set(official.map((r) => r.external_id))];
  const gameIds = [...new Set(official.map((r) => r.game_id))];
  const [snapshots, splits, prices, lines, publicSplits] = await Promise.all([
    loadSnapshots(ids),
    loadSplits(ids),
    loadPrices(ids),
    loadLines(gameIds),
    loadPublicSplits(gameIds),
  ]);
  const rows: ReconstructedRow[] = [];
  for (const r of official) {
    const side = r.side ?? "";
    const reconstructed = reconstructRow(
      r,
      snapshots.get(r.external_id) ?? [],
      splits.get(mapKey(r.external_id, r.market, side)) ?? [],
      prices.get(mapKey(r.external_id, r.market, side)) ?? [],
      lines.get(r.game_id) ?? [],
      publicSplits.get(`${r.game_id}:${r.market}:${side}`) ?? [],
    );
    if (reconstructed) rows.push(reconstructed);
  }
  return { rows, rawRows: raw.length, officialRows: official.length };
}

function groupName(row: ReconstructedRow): string {
  const g = row.evidenceGroups;
  if (g.A_v2_snapshot_usable) return "A";
  if (g.B_v2_snapshot_missing_raw_market_observations_exist) return "B";
  if (g.C_legacy_prelock_odds_exist) return "C";
  if (g.D_locked_record_price_exists) return "D";
  if (g.E_playbook_pregame_consensus_exists) return "E";
  if (g.F_dk_circa_timestamped_history_exists) return "F";
  if (g.G_only_post_lock_or_post_start_evidence_exists) return "G";
  return "H";
}

function bucket(row: ReconstructedRow): string {
  return `${row.sport}_${row.market}`;
}

function summarizeRows(rows: ReconstructedRow[]) {
  const by = <T extends string>(keys: T[], fn: (row: ReconstructedRow) => T | null) =>
    Object.fromEntries(keys.map((k) => [k, rows.filter((r) => fn(r) === k).length]));
  const groupKeys = [
    "A_v2_snapshot_usable",
    "B_v2_snapshot_missing_raw_market_observations_exist",
    "C_legacy_prelock_odds_exist",
    "D_locked_record_price_exists",
    "E_playbook_pregame_consensus_exists",
    "F_dk_circa_timestamped_history_exists",
    "G_only_post_lock_or_post_start_evidence_exists",
    "H_unrecoverable_safely",
  ] as const;
  return {
    rows: rows.length,
    events: new Set(rows.map((r) => `${r.sport}:${r.gameId}`)).size,
    eventMarkets: new Set(rows.map((r) => `${r.sport}:${r.gameId}:${r.market}`)).size,
    dateRange: [rows.map((r) => r.date).sort()[0] ?? null, rows.map((r) => r.date).sort().at(-1) ?? null],
    marketCoverage: by(["mlb_moneyline", "mlb_total", "wnba_moneyline", "wnba_total", "wnba_spread"], (r) => {
      if (r.sport === "mlb" && r.market === "moneyline") return "mlb_moneyline";
      if (r.sport === "mlb" && r.market === "total") return "mlb_total";
      if (r.sport === "wnba" && r.market === "moneyline") return "wnba_moneyline";
      if (r.sport === "wnba" && r.market === "total") return "wnba_total";
      if (r.sport === "wnba" && r.market === "spread") return "wnba_spread";
      return null;
    }),
    evidenceGroupMembership: Object.fromEntries(groupKeys.map((k) => [k, rows.filter((r) => r.evidenceGroups[k]).length])),
    primaryGroupCounts: Object.fromEntries(["A", "B", "C", "D", "E", "F", "G", "H"].map((g) => [g, rows.filter((r) => groupName(r) === g).length])),
    recoverableRows: rows.filter((r) => !r.evidenceGroups.H_unrecoverable_safely).length,
    unrecoverableRows: rows.filter((r) => r.evidenceGroups.H_unrecoverable_safely).length,
    recoverableBySportMarket: Object.fromEntries(["mlb_moneyline", "mlb_total", "wnba_moneyline", "wnba_total", "wnba_spread"].map((k) => [
      k,
      rows.filter((r) => `${r.sport}_${r.market}` === k && !r.evidenceGroups.H_unrecoverable_safely).length,
    ])),
    evidenceFamilies: {
      v2Snapshot: rows.filter((r) => r.v2SnapshotLabel !== null).length,
      reconstructedV2Label: rows.filter((r) => r.v2LabelReconstructed !== "Projection-Led").length,
      marketNoVigAtLock: rows.filter((r) => r.pMarketNoVigAtLock !== null).length,
      sharpNoVigAtLock: rows.filter((r) => r.sharpMarketNoVigAtLock !== null).length,
      retailNoVigAtLock: rows.filter((r) => r.retailMarketNoVigAtLock !== null).length,
      sharpRetailGap: rows.filter((r) => r.sharpVsRetailGapAtLock !== null).length,
      legacyPrelockLineMovement: rows.filter((r) => r.firstTrackedPriceBeforeLock !== null && r.lastPriceBeforeLock !== null).length,
      playbookConsensus: rows.filter((r) => r.playbookFinalPregameConsensus !== null).length,
      draftKingsSplit: rows.filter((r) => r.dkSplit !== null).length,
      circaSplit: rows.filter((r) => r.circaSplit !== null).length,
      closingPrice: rows.filter((r) => r.closingPrice !== null).length,
      beatClosingLine: rows.filter((r) => r.beatClosingLine !== null).length,
    },
    reconstructionConfidence: by(["high", "medium", "low"], (r) => r.reconstructionConfidence),
  };
}

function predictionSummary(preds: Prediction[]) {
  const evaluated = preds.filter((p) => p.outcome !== null);
  const actionable = evaluated.filter((p) => p.side !== null && p.tier !== "no_play");
  const wins = evaluated.filter((p) => p.outcome === 1).length;
  const losses = evaluated.filter((p) => p.outcome === 0).length;
  const profits = actionable.map((p) => profit(p.price, p.result)).filter((v): v is number => v !== null);
  const evPositive = actionable.filter((p) => (expectedValuePerDollar(p.probability, p.price) ?? -1) > 0);
  const evPositiveProfits = evPositive.map((p) => profit(p.price, p.result)).filter((v): v is number => v !== null);
  return {
    n: evaluated.length,
    actionablePlays: actionable.length,
    noPlays: preds.filter((p) => p.tier === "no_play" || p.side === null).length,
    wl: `${wins}-${losses}-0`,
    hitRate: wins / Math.max(1, wins + losses),
    actionableUnits: profits.reduce((s, v) => s + v, 0),
    actionableRoi: profits.reduce((s, v) => s + v, 0) / Math.max(1, profits.length),
    positiveEvBets: {
      n: evPositive.length,
      wl: `${evPositive.filter((p) => p.outcome === 1).length}-${evPositive.filter((p) => p.outcome === 0).length}-0`,
      roi: evPositiveProfits.length ? evPositiveProfits.reduce((s, v) => s + v, 0) / evPositiveProfits.length : null,
    },
    logLoss: evaluated.reduce((s, p) => s + logLoss(p.probability, p.outcome as 0 | 1), 0) / Math.max(1, evaluated.length),
    brier: evaluated.reduce((s, p) => s + brierScore(p.probability, p.outcome as 0 | 1), 0) / Math.max(1, evaluated.length),
    changedPicks: evaluated.filter((p) => p.side !== null && p.side !== p.row.side).length,
    bestAngle: subset(evaluated.filter((p) => p.tier === "best_angle")),
    lean: subset(evaluated.filter((p) => p.tier === "lean")),
    noPlayResults: subset(evaluated.filter((p) => p.tier === "no_play" || p.side === null)),
    bySportMarket: Object.fromEntries(["mlb_moneyline", "mlb_total", "wnba_moneyline", "wnba_total", "wnba_spread"].map((k) => [
      k,
      subset(evaluated.filter((p) => bucket(p.row) === k)),
    ])),
  };
}

function subset(preds: Prediction[]) {
  const wins = preds.filter((p) => p.outcome === 1).length;
  const losses = preds.filter((p) => p.outcome === 0).length;
  const profits = preds.map((p) => profit(p.price, p.result)).filter((v): v is number => v !== null);
  return {
    n: preds.length,
    wl: `${wins}-${losses}-0`,
    roi: profits.length ? profits.reduce((s, v) => s + v, 0) / profits.length : null,
  };
}

function basePrediction(row: ReconstructedRow, id: string, probability: number, reason: string): Prediction {
  return {
    row,
    id,
    side: row.side,
    probability: Math.min(0.99, Math.max(0.01, probability)),
    price: row.price,
    outcome: row.outcome,
    result: row.result,
    tier: row.tier,
    reason,
  };
}

function blend(pModel: number, pMarket: number | null, w: number): number {
  if (pMarket === null) return pModel;
  return pModel * (1 - w) + pMarket * w;
}

function chronologicalBlendPredictions(rows: ReconstructedRow[], feature: "market" | "independent"): Prediction[] {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const out: Prediction[] = [];
  const weights = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  for (const d of dates) {
    const train = rows.filter((r) => r.date < d);
    const test = rows.filter((r) => r.date === d);
    const bestW = weights
      .map((w) => {
        const eligible = train.filter((r) => (feature === "market" ? r.pMarketNoVigAtLock : r.pIndependentModel) !== null);
        const score = eligible.length < 40 ? Number.POSITIVE_INFINITY : eligible.reduce((s, r) => {
          const p = blend(r.pCurrentProduction, feature === "market" ? r.pMarketNoVigAtLock : r.pIndependentModel, w);
          return s + logLoss(p, r.outcome);
        }, 0) / Math.max(1, eligible.length);
        return { w, score };
      })
      .sort((a, b) => a.score - b.score)[0]?.w ?? 0;
    for (const r of test) {
      out.push(basePrediction(r, feature === "market" ? "D_production_market_blend" : "C_independent_blend", blend(r.pCurrentProduction, feature === "market" ? r.pMarketNoVigAtLock : r.pIndependentModel, bestW), `chronological weight ${bestW}`));
    }
  }
  return out;
}

function marketOnlyPredictions(rows: ReconstructedRow[]): Prediction[] {
  return rows.map((r) => basePrediction(r, "B_market_only", r.pMarketNoVigAtLock ?? implied(r.price) ?? r.pCurrentProduction, r.pMarketSource ?? "locked price implied fallback"));
}

function productionPredictions(rows: ReconstructedRow[]): Prediction[] {
  return rows.map((r) => basePrediction(r, "A_current_production", r.pCurrentProduction, "current production"));
}

function selectorPredictions(rows: ReconstructedRow[], kind: "market" | "blend" | "v2" | "hybrid"): Prediction[] {
  const out: Prediction[] = [];
  for (const r of rows) {
    let p = kind === "market" ? (r.pMarketNoVigAtLock ?? r.pCurrentProduction) : blend(r.pCurrentProduction, r.pMarketNoVigAtLock, 0.25);
    let side: string | null = r.side;
    let price = r.price;
    let outcome: 0 | 1 | null = r.outcome;
    let result = r.result;
    let reason: string = kind;
    const currentEv = expectedValuePerDollar(p, r.price) ?? -1;
    const oppP = 1 - p;
    const oppEv = expectedValuePerDollar(oppP, r.oppositePrice) ?? -1;
    const canFlip = r.oppositeOutcome !== null && r.oppositePrice !== null;
    if ((kind === "market" || kind === "blend") && canFlip && oppEv > currentEv + 0.01) {
      side = r.oppositeSide;
      price = r.oppositePrice;
      outcome = r.oppositeOutcome;
      result = r.oppositeOutcome === 1 ? "win" : "loss";
      p = oppP;
      reason = `${kind} selector flipped on higher EV`;
    }
    if (kind === "v2" && canFlip && r.movementDirectionRelativeToPick === "resistance" && oppEv > currentEv) {
      side = r.oppositeSide;
      price = r.oppositePrice;
      outcome = r.oppositeOutcome;
      result = r.oppositeOutcome === 1 ? "win" : "loss";
      p = oppP;
      reason = "v2 resistance plus opposite EV";
    }
    if (kind === "hybrid") {
      const hist = out
        .map((x) => x.row)
        .filter((h) => h.sport === r.sport && h.market === r.market && h.v2LabelReconstructed === r.v2LabelReconstructed && h.oppositeOutcome !== null);
      const prodHit = hist.length ? hist.reduce((s, h) => s + h.outcome, 0) / hist.length : 0;
      const oppHit = hist.length ? hist.reduce((s, h) => s + (h.oppositeOutcome ?? 0), 0) / hist.length : 0;
      if (hist.length >= 10 && canFlip && oppHit > prodHit + 0.08) {
        side = r.oppositeSide;
        price = r.oppositePrice;
        outcome = r.oppositeOutcome;
        result = r.oppositeOutcome === 1 ? "win" : "loss";
        p = oppP;
        reason = `hybrid bucket flip n=${hist.length}`;
      }
    }
    out.push({ row: r, id: `selector_${kind}`, side, probability: p, price, outcome, result, tier: r.tier, reason });
  }
  return out;
}

function reliability(preds: Prediction[]) {
  const bins = [
    [0, 0.45],
    [0.45, 0.5],
    [0.5, 0.55],
    [0.55, 0.6],
    [0.6, 0.65],
    [0.65, 1],
  ];
  return bins.map(([lo, hi]) => {
    const xs = preds.filter((p) => p.outcome !== null && p.probability >= lo && p.probability < hi);
    return {
      bucket: `${lo.toFixed(2)}-${hi.toFixed(2)}`,
      n: xs.length,
      avgP: xs.reduce((s, p) => s + p.probability, 0) / Math.max(1, xs.length),
      hit: xs.reduce((s, p) => s + (p.outcome ?? 0), 0) / Math.max(1, xs.length),
    };
  });
}

function calibrationSlope(preds: Prediction[]) {
  const xs = preds.filter((p) => p.outcome !== null);
  const meanP = xs.reduce((s, p) => s + p.probability, 0) / Math.max(1, xs.length);
  const meanY = xs.reduce((s, p) => s + (p.outcome ?? 0), 0) / Math.max(1, xs.length);
  const cov = xs.reduce((s, p) => s + (p.probability - meanP) * ((p.outcome ?? 0) - meanY), 0);
  const varP = xs.reduce((s, p) => s + Math.pow(p.probability - meanP, 2), 0);
  const slope = varP > 0 ? cov / varP : null;
  return { slope, intercept: slope === null ? null : meanY - slope * meanP };
}

function platt(rows: ReconstructedRow[], mode: "model" | "beta" | "marketBlend" | "sportMarket") {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const out: Prediction[] = [];
  for (const d of dates) {
    const train = rows.filter((r) => r.date < d);
    const test = rows.filter((r) => r.date === d);
    for (const r of test) {
      let p = r.pCurrentProduction;
      let reason = "insufficient chronological training";
      const groupTrain = mode === "sportMarket" ? train.filter((x) => x.sport === r.sport && x.market === r.market) : train;
      if (groupTrain.length >= 40) {
        const names = mode === "beta"
          ? ["log_p", "log_1mp"]
          : mode === "marketBlend" || mode === "sportMarket"
            ? ["logit_model", "logit_market", "market_missing"]
            : ["logit_model"];
        const feat = (x: ReconstructedRow): Record<string, number> => ({
          logit_model: logit(x.pCurrentProduction),
          logit_market: x.pMarketNoVigAtLock === null ? 0 : logit(x.pMarketNoVigAtLock),
          market_missing: x.pMarketNoVigAtLock === null ? 1 : 0,
          log_p: Math.log(Math.max(1e-6, x.pCurrentProduction)),
          log_1mp: Math.log(Math.max(1e-6, 1 - x.pCurrentProduction)),
        });
        const model = fitRidgeLogistic({
          rows: groupTrain.map(feat),
          outcomes: groupTrain.map((x) => x.outcome),
          featureNames: names,
          lambda: 2,
          iterations: 1000,
          learningRate: 0.04,
        });
        p = predictRidgeLogistic(model, feat(r));
        reason = `${mode} chronological calibration`;
      }
      out.push(basePrediction(r, `calibration_${mode}`, p, reason));
    }
  }
  return out;
}

function isotonic(rows: ReconstructedRow[]) {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const out: Prediction[] = [];
  for (const d of dates) {
    const train = rows.filter((r) => r.date < d).sort((a, b) => a.pCurrentProduction - b.pCurrentProduction);
    const test = rows.filter((r) => r.date === d);
    if (train.length < 100) {
      out.push(...test.map((r) => basePrediction(r, "calibration_isotonic", r.pCurrentProduction, "insufficient chronological training")));
      continue;
    }
    const blocks: Array<{ lo: number; hi: number; sum: number; n: number }> = train.map((r) => ({ lo: r.pCurrentProduction, hi: r.pCurrentProduction, sum: r.outcome, n: 1 }));
    for (let i = 0; i < blocks.length - 1; i++) {
      if (blocks[i].sum / blocks[i].n > blocks[i + 1].sum / blocks[i + 1].n) {
        blocks[i] = {
          lo: blocks[i].lo,
          hi: blocks[i + 1].hi,
          sum: blocks[i].sum + blocks[i + 1].sum,
          n: blocks[i].n + blocks[i + 1].n,
        };
        blocks.splice(i + 1, 1);
        i = Math.max(-1, i - 2);
      }
    }
    for (const r of test) {
      const block = blocks.find((b) => r.pCurrentProduction >= b.lo && r.pCurrentProduction <= b.hi) ??
        blocks.reduce((best, b) => Math.abs(r.pCurrentProduction - (b.lo + b.hi) / 2) < Math.abs(r.pCurrentProduction - (best.lo + best.hi) / 2) ? b : best, blocks[0]);
      out.push(basePrediction(r, "calibration_isotonic", Math.min(0.99, Math.max(0.01, block.sum / block.n)), "isotonic chronological calibration"));
    }
  }
  return out;
}

function projectionAdjustment(rows: ReconstructedRow[]) {
  const totals = rows.filter((r) => r.market === "total" && r.actualTotal !== null && r.projectedTotal !== null && r.line !== null);
  const bySport = Object.fromEntries(["mlb", "wnba"].map((sport) => {
    const xs = totals.filter((r) => r.sport === sport);
    const rawMae = xs.reduce((s, r) => s + Math.abs((r.projectedTotal ?? 0) - (r.actualTotal ?? 0)), 0) / Math.max(1, xs.length);
    const marketMae = xs.reduce((s, r) => s + Math.abs((r.line ?? 0) - (r.actualTotal ?? 0)), 0) / Math.max(1, xs.length);
    const dates = [...new Set(xs.map((r) => r.date))].sort();
    const evals: Array<{ row: ReconstructedRow; blended: number; w: number }> = [];
    for (const d of dates) {
      const train = xs.filter((r) => r.date < d);
      const test = xs.filter((r) => r.date === d);
      const weights = [0, 0.1, 0.25, 0.4, 0.5, 0.65, 0.8, 1];
      const best = weights.map((w) => ({
        w,
        mae: train.length < 20 ? Number.POSITIVE_INFINITY : train.reduce((s, r) => s + Math.abs(((r.projectedTotal ?? 0) * (1 - w) + (r.line ?? 0) * w) - (r.actualTotal ?? 0)), 0) / train.length,
      })).sort((a, b) => a.mae - b.mae)[0]?.w ?? 0;
      for (const r of test) evals.push({ row: r, blended: (r.projectedTotal ?? 0) * (1 - best) + (r.line ?? 0) * best, w: best });
    }
    const blendMae = evals.reduce((s, e) => s + Math.abs(e.blended - (e.row.actualTotal ?? 0)), 0) / Math.max(1, evals.length);
    return [sport, { n: xs.length, rawProjectionMae: rawMae, marketLineMae: marketMae, chronologicalBlendMae: blendMae, avgBlendWeight: evals.reduce((s, e) => s + e.w, 0) / Math.max(1, evals.length) }];
  }));
  return { totals: bySport };
}

function gradeEngine(rows: ReconstructedRow[], policy: string): Prediction[] {
  return rows.map((r) => {
    let t = r.tier;
    let reason = "current grade";
    const p = blend(r.pCurrentProduction, r.pMarketNoVigAtLock, 0.25);
    const ev = expectedValuePerDollar(p, r.price) ?? 0;
    if (policy === "ev") {
      t = ev >= 0.035 && p >= 0.54 ? "best_angle" : ev >= 0.012 ? "lean" : "no_play";
      reason = "EV grade engine";
    }
    if (policy === "market_read") {
      if (r.movementDirectionRelativeToPick === "resistance") t = "no_play";
      else if (r.movementDirectionRelativeToPick === "support" && ev > 0.02) t = p >= 0.57 ? "best_angle" : "lean";
      reason = "market read grade engine";
    }
    if (policy === "clv") {
      if (r.beatClosingLine === false && r.tier === "best_angle") t = "lean";
      if (r.beatClosingLine === true && ev > 0.015 && r.tier === "other") t = "lean";
      reason = "CLV-aware grade engine";
    }
    if (policy === "hybrid") {
      if (ev <= 0 && r.movementDirectionRelativeToPick === "resistance") t = "no_play";
      if (ev > 0.03 && r.movementDirectionRelativeToPick !== "resistance" && p >= 0.56) t = "best_angle";
      reason = "hybrid grade engine";
    }
    return { row: r, id: `grade_${policy}`, side: r.side, probability: p, price: r.price, outcome: r.outcome, result: r.result, tier: t, reason };
  });
}

function changedCards(base: Prediction[], candidate: Prediction[]) {
  const byId = new Map(base.map((p) => [p.row.id, p]));
  return candidate
    .filter((p) => {
      const b = byId.get(p.row.id);
      return b && (b.side !== p.side || b.tier !== p.tier);
    })
    .slice(0, 50)
    .map((p) => ({
      id: p.row.id,
      date: p.row.date,
      sport: p.row.sport,
      matchup: p.row.matchup,
      market: p.row.market,
      productionSide: p.row.side,
      candidateSide: p.side,
      productionTier: p.row.tier,
      candidateTier: p.tier,
      result: p.row.result,
      reason: p.reason,
    }));
}

function clvReport(rows: ReconstructedRow[]) {
  const labels = [...new Set(rows.map((r) => r.v2LabelReconstructed))].sort();
  const byLabel = Object.fromEntries(labels.map((label) => {
    const xs = rows.filter((r) => r.v2LabelReconstructed === label && r.beatClosingLine !== null);
    return [label, {
      n: xs.length,
      beatCloseRate: xs.reduce((s, r) => s + (r.beatClosingLine ? 1 : 0), 0) / Math.max(1, xs.length),
      avgClvPriceMovement: xs.map((r) => r.clvPriceMovement).filter((v): v is number => v !== null).reduce((s, v) => s + v, 0) / Math.max(1, xs.filter((r) => r.clvPriceMovement !== null).length),
    }];
  }));
  const byGrade = Object.fromEntries(["best_angle", "lean", "other", "no_play"].map((grade) => {
    const xs = rows.filter((r) => r.tier === grade && r.beatClosingLine !== null);
    return [grade, { n: xs.length, beatCloseRate: xs.reduce((s, r) => s + (r.beatClosingLine ? 1 : 0), 0) / Math.max(1, xs.length) }];
  }));
  return { byLabel, byGrade };
}

function bySportMarketSummaries(preds: Prediction[]) {
  const groups = ["mlb_moneyline", "mlb_total", "wnba_moneyline", "wnba_total", "wnba_spread", "all"];
  return Object.fromEntries(groups.map((g) => {
    const xs = g === "all" ? preds : preds.filter((p) => bucket(p.row) === g);
    return [g, {
      summary: predictionSummary(xs),
      calibration: calibrationSlope(xs),
      reliability: reliability(xs),
    }];
  }));
}

function predictionsWithProbability(
  rows: ReconstructedRow[],
  id: string,
  fn: (row: ReconstructedRow) => number,
): Prediction[] {
  return rows.map((r) => basePrediction(r, id, fn(r), id));
}

function chronologicalMarketBlend(rows: ReconstructedRow[], scoped: boolean): Prediction[] {
  const weights = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const out: Prediction[] = [];
  for (const d of dates) {
    const test = rows.filter((r) => r.date === d);
    for (const row of test) {
      const train = rows.filter((r) => r.date < d && (!scoped || bucket(r) === bucket(row)) && r.pMarketNoVigAtLock !== null);
      const globalTrain = rows.filter((r) => r.date < d && r.pMarketNoVigAtLock !== null);
      const usableTrain = train.length >= 35 ? train : globalTrain;
      const bestW = weights.map((w) => ({
        w,
        ll: usableTrain.length < 40 ? Number.POSITIVE_INFINITY : usableTrain.reduce((s, r) => s + logLoss(blend(r.pCurrentProduction, r.pMarketNoVigAtLock, w), r.outcome), 0) / usableTrain.length,
      })).sort((a, b) => a.ll - b.ll)[0]?.w ?? 0;
      out.push(basePrediction(row, scoped ? "D_learned_chronological_blend_scoped" : "D_learned_chronological_blend", blend(row.pCurrentProduction, row.pMarketNoVigAtLock, bestW), `chronological market weight ${bestW}`));
    }
  }
  return out;
}

function betaCalibrationOnBase(rows: ReconstructedRow[], id: string, base: (r: ReconstructedRow) => number): Prediction[] {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const out: Prediction[] = [];
  for (const d of dates) {
    const train = rows.filter((r) => r.date < d);
    const test = rows.filter((r) => r.date === d);
    if (train.length < 40) {
      out.push(...test.map((r) => basePrediction(r, id, base(r), "insufficient chronological training")));
      continue;
    }
    const feat = (r: ReconstructedRow): Record<string, number> => {
      const p = Math.min(0.99, Math.max(0.01, base(r)));
      return { log_p: Math.log(p), log_1mp: Math.log(1 - p) };
    };
    const model = fitRidgeLogistic({
      rows: train.map(feat),
      outcomes: train.map((r) => r.outcome),
      featureNames: ["log_p", "log_1mp"],
      lambda: 2,
      iterations: 1000,
      learningRate: 0.04,
    });
    for (const r of test) {
      out.push(basePrediction(r, id, predictRidgeLogistic(model, feat(r)), "beta calibration on base probability"));
    }
  }
  return out;
}

function probabilityCalibrationSprint(rows: ReconstructedRow[]) {
  const candidates: Record<string, Prediction[]> = {
    A_currentProduction: productionPredictions(rows),
    B_marketOnlyNoVig: predictionsWithProbability(rows, "B_marketOnlyNoVig", (r) => r.pMarketNoVigAtLock ?? r.pCurrentProduction),
    C_static70Model30Market: predictionsWithProbability(rows, "C_static70Model30Market", (r) => blend(r.pCurrentProduction, r.pMarketNoVigAtLock, 0.3)),
    D_learnedChronologicalBlend: chronologicalMarketBlend(rows, false),
    D2_learnedChronologicalBlendScoped: chronologicalMarketBlend(rows, true),
    E_logisticStackModelMarket: platt(rows, "marketBlend"),
    F_betaProduction: betaCalibrationOnBase(rows, "F_betaProduction", (r) => r.pCurrentProduction),
    G_betaStaticBlend: betaCalibrationOnBase(rows, "G_betaStaticBlend", (r) => blend(r.pCurrentProduction, r.pMarketNoVigAtLock, 0.3)),
  };
  return Object.fromEntries(Object.entries(candidates).map(([name, preds]) => [name, bySportMarketSummaries(preds)]));
}

function totalResultFor(row: ReconstructedRow, side: string): { outcome: 0 | 1 | null; result: Result; price: number | null } {
  if (side === row.side) return { outcome: row.outcome, result: row.result, price: row.price };
  if (side === row.oppositeSide && row.oppositeOutcome !== null) {
    return { outcome: row.oppositeOutcome, result: row.oppositeOutcome === 1 ? "win" : "loss", price: row.oppositePrice };
  }
  return { outcome: null, result: "", price: null };
}

function projectionSide(projection: number, line: number, fallback: string): string {
  if (projection > line) return "over";
  if (projection < line) return "under";
  return fallback;
}

function projectionCandidateSummary(rows: ReconstructedRow[], name: string, projections: Map<number, number>) {
  const preds: Prediction[] = [];
  const errors: number[] = [];
  for (const r of rows) {
    const projection = projections.get(r.id);
    if (projection === undefined || r.actualTotal === null || r.line === null) continue;
    errors.push(projection - r.actualTotal);
    const side = projectionSide(projection, r.line, r.side);
    const resolved = totalResultFor(r, side);
    preds.push({
      row: r,
      id: name,
      side,
      probability: r.pCurrentProduction,
      price: resolved.price,
      outcome: resolved.outcome,
      result: resolved.result,
      tier: r.tier,
      reason: name,
    });
  }
  const abs = errors.map(Math.abs);
  return {
    n: preds.length,
    totalMae: abs.reduce((s, v) => s + v, 0) / Math.max(1, abs.length),
    totalRmse: Math.sqrt(errors.reduce((s, v) => s + v * v, 0) / Math.max(1, errors.length)),
    bias: errors.reduce((s, v) => s + v, 0) / Math.max(1, errors.length),
    sidePerformance: predictionSummary(preds),
    bestAnglePerformance: subset(preds.filter((p) => p.tier === "best_angle")),
    leanPerformance: subset(preds.filter((p) => p.tier === "lean")),
    changedSides: preds.filter((p) => p.side !== p.row.side).length,
    byTotalBucket: Object.fromEntries(["le_7_5", "eq_8", "eq_8_5", "ge_9"].map((bucketName) => {
      const xs = preds.filter((p) => {
        const line = p.row.line;
        if (line === null) return false;
        if (bucketName === "le_7_5") return line <= 7.5;
        if (bucketName === "eq_8") return line === 8;
        if (bucketName === "eq_8_5") return line === 8.5;
        return line >= 9;
      });
      return [bucketName, subset(xs)];
    })),
    byGrade: Object.fromEntries(["best_angle", "lean", "other", "no_play"].map((grade) => [
      grade,
      subset(preds.filter((p) => p.tier === grade)),
    ])),
  };
}

function mlbTotalsProjectionAnchoring(rows: ReconstructedRow[]) {
  const totals = rows.filter((r) => r.sport === "mlb" && r.market === "total" && r.projectedTotal !== null && r.actualTotal !== null && r.line !== null);
  const mapFor = (fn: (r: ReconstructedRow) => number | null) => new Map(totals.map((r) => [r.id, fn(r)]).filter((x): x is [number, number] => x[1] !== null));
  const learned = new Map<number, number>();
  const bias = new Map<number, number>();
  const dates = [...new Set(totals.map((r) => r.date))].sort();
  for (const d of dates) {
    const train = totals.filter((r) => r.date < d);
    const test = totals.filter((r) => r.date === d);
    const weights = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const bestW = weights.map((w) => ({
      w,
      mae: train.length < 30 ? Number.POSITIVE_INFINITY : train.reduce((s, r) => s + Math.abs(((r.projectedTotal ?? 0) * (1 - w) + (r.line ?? 0) * w) - (r.actualTotal ?? 0)), 0) / train.length,
    })).sort((a, b) => a.mae - b.mae)[0]?.w ?? 0;
    const meanBias = train.length < 30 ? 0 : train.reduce((s, r) => s + ((r.actualTotal ?? 0) - (r.projectedTotal ?? 0)), 0) / train.length;
    for (const r of test) {
      learned.set(r.id, (r.projectedTotal ?? 0) * (1 - bestW) + (r.line ?? 0) * bestW);
      bias.set(r.id, (r.projectedTotal ?? 0) + meanBias);
    }
  }
  return {
    A_rawOddSphereProjection: projectionCandidateSummary(totals, "A_rawOddSphereProjection", mapFor((r) => r.projectedTotal)),
    B_marketTotalLineAtLock: projectionCandidateSummary(totals, "B_marketTotalLineAtLock", mapFor((r) => r.line)),
    C_80Model20Market: projectionCandidateSummary(totals, "C_80Model20Market", mapFor((r) => (r.projectedTotal ?? 0) * 0.8 + (r.line ?? 0) * 0.2)),
    D_60Model40Market: projectionCandidateSummary(totals, "D_60Model40Market", mapFor((r) => (r.projectedTotal ?? 0) * 0.6 + (r.line ?? 0) * 0.4)),
    E_40Model60Market: projectionCandidateSummary(totals, "E_40Model60Market", mapFor((r) => (r.projectedTotal ?? 0) * 0.4 + (r.line ?? 0) * 0.6)),
    F_learnedChronologicalBlend: projectionCandidateSummary(totals, "F_learnedChronologicalBlend", learned),
    G_biasCorrectedModelProjection: projectionCandidateSummary(totals, "G_biasCorrectedModelProjection", bias),
    H_pitcherWeatherLineupAdjustedPlusMarket: {
      status: "not_separately_available_in_reconstructed_rows",
      note: "snapshot independent projected total already includes the recovered model projection; separate pitcher/weather/lineup adjusted sub-projection was not consistently recoverable as its own field.",
    },
  };
}

function noPlayFilterPredictions(rows: ReconstructedRow[], policy: string): Prediction[] {
  return rows.map((r) => {
    const p = blend(r.pCurrentProduction, r.pMarketNoVigAtLock, 0.3);
    const ev = expectedValuePerDollar(p, r.price);
    const hasPrice = r.price !== null;
    const fresh = r.pMarketNoVigAtLock !== null || r.bestAvailablePriceAtLock !== null;
    let keep = true;
    if (policy === "ev_gt_0") keep = (ev ?? -1) > 0;
    if (policy === "ev_gt_2") keep = (ev ?? -1) > 0.02;
    if (policy === "ev_gt_4") keep = (ev ?? -1) > 0.04;
    if (policy === "ev_gt_0_no_resistance") keep = (ev ?? -1) > 0 && r.movementDirectionRelativeToPick !== "resistance";
    if (policy === "ev_gt_0_fresh_line") keep = (ev ?? -1) > 0 && fresh;
    if (policy === "ev_gt_0_price_at_lock") keep = (ev ?? -1) > 0 && hasPrice;
    return { row: r, id: `no_play_${policy}`, side: r.side, probability: p, price: r.price, outcome: r.outcome, result: r.result, tier: keep ? r.tier : "no_play", reason: keep ? "kept" : policy };
  });
}

function noPlayFilterResearch(rows: ReconstructedRow[]) {
  const policies = ["current", "ev_gt_0", "ev_gt_2", "ev_gt_4", "ev_gt_0_no_resistance", "ev_gt_0_fresh_line", "ev_gt_0_price_at_lock"];
  const prod = productionPredictions(rows);
  return Object.fromEntries(policies.map((policy) => {
    const preds = policy === "current" ? prod : noPlayFilterPredictions(rows, policy);
    const removed = preds.filter((p) => p.tier === "no_play" && p.row.tier !== "no_play");
    const kept = preds.filter((p) => p.tier !== "no_play");
    return [policy, {
      summary: predictionSummary(preds),
      playsRemoved: removed.length,
      removedPerformance: subset(removed),
      keptPerformance: subset(kept),
      bestAngle: subset(kept.filter((p) => p.tier === "best_angle")),
      lean: subset(kept.filter((p) => p.tier === "lean")),
      recentMlb3Day: recentWindowSummary(preds, 3, "mlb"),
      recentMlb7Day: recentWindowSummary(preds, 7, "mlb"),
      examples: removed.slice(0, 30).map((p) => ({
        id: p.row.id,
        date: p.row.date,
        matchup: p.row.matchup,
        market: p.row.market,
        side: p.row.side,
        result: p.row.result,
        grade: p.row.tier,
        probability: p.probability,
        ev: expectedValuePerDollar(p.probability, p.price),
        reason: p.reason,
      })),
    }];
  }));
}

function byIdProbability(preds: Prediction[]): Map<number, number> {
  return new Map(preds.map((p) => [p.row.id, p.probability]));
}

function evFor(row: ReconstructedRow, p: number): number | null {
  return expectedValuePerDollar(p, row.price);
}

function learnedEvThresholdByDate(rows: ReconstructedRow[], pMap: Map<number, number>, requireProbFloor: boolean): Map<string, number> {
  const thresholds = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06];
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const out = new Map<string, number>();
  for (const d of dates) {
    const train = rows.filter((r) => r.date < d && r.sport === "mlb" && (r.market === "moneyline" || r.market === "total"));
    if (train.length < 80) {
      out.set(d, 0.04);
      continue;
    }
    const scored = thresholds.map((x) => {
      const ba = train.filter((r) => {
        const p = pMap.get(r.id) ?? r.pCurrentProduction;
        const ev = evFor(r, p) ?? -1;
        return ev >= x && (!requireProbFloor || p >= 0.55);
      });
      const profits = ba.map((r) => profit(r.price, r.result)).filter((v): v is number => v !== null);
      return {
        x,
        n: ba.length,
        roi: profits.length ? profits.reduce((s, v) => s + v, 0) / profits.length : -999,
      };
    })
      .filter((s) => s.n >= 20)
      .sort((a, b) => b.roi - a.roi || b.n - a.n);
    out.set(d, scored[0]?.x ?? 0.04);
  }
  return out;
}

function candidateHEvDecisionResearch(rows: ReconstructedRow[], calibrated: Prediction[]) {
  const pMap = byIdProbability(calibrated);
  const scoped = rows.filter((r) => r.sport === "mlb" && (r.market === "moneyline" || r.market === "total"));
  const threshold5 = learnedEvThresholdByDate(scoped, pMap, false);
  const threshold6 = learnedEvThresholdByDate(scoped, pMap, true);
  const threshold7 = learnedEvThresholdByDate(scoped, pMap, true);
  const make = (rule: string): Prediction[] => scoped.map((r) => {
    const p = pMap.get(r.id) ?? r.pCurrentProduction;
    const ev = evFor(r, p) ?? -999;
    let tier = r.tier;
    let reason = "current production";
    if (rule === "rule_1_ev_gt_0") {
      tier = ev > 0 ? r.tier : "no_play";
      reason = ev > 0 ? "calibrated EV positive" : "calibrated EV <= 0";
    }
    if (rule === "rule_2_ev_gt_1") {
      tier = ev > 0.01 ? r.tier : "no_play";
      reason = ev > 0.01 ? "calibrated EV > 1%" : "calibrated EV <= 1%";
    }
    if (rule === "rule_3_ev_gt_2") {
      tier = ev > 0.02 ? r.tier : "no_play";
      reason = ev > 0.02 ? "calibrated EV > 2%" : "calibrated EV <= 2%";
    }
    if (rule === "rule_4_ev_gt_3") {
      tier = ev > 0.03 ? r.tier : "no_play";
      reason = ev > 0.03 ? "calibrated EV > 3%" : "calibrated EV <= 3%";
    }
    if (rule === "rule_5_learned_ev_grade") {
      const x = threshold5.get(r.date) ?? 0.04;
      tier = ev >= x ? "best_angle" : ev > 0 ? "lean" : "no_play";
      reason = `learned EV grade threshold ${(x * 100).toFixed(1)}%`;
    }
    if (rule === "rule_6_learned_ev_prob55_grade") {
      const x = threshold6.get(r.date) ?? 0.04;
      tier = ev >= x && p >= 0.55 ? "best_angle" : ev > 0 ? "lean" : "no_play";
      reason = `learned EV threshold ${(x * 100).toFixed(1)}% plus p>=55%`;
    }
    if (rule === "rule_7_learned_ev_no_resistance") {
      const x = threshold7.get(r.date) ?? 0.04;
      tier = ev >= x && p >= 0.55 && r.movementDirectionRelativeToPick !== "resistance" ? "best_angle" : ev > 0 ? "lean" : "no_play";
      reason = `learned EV threshold ${(x * 100).toFixed(1)}%, p>=55%, no resistance`;
    }
    return { row: r, id: rule, side: r.side, probability: p, price: r.price, outcome: r.outcome, result: r.result, tier, reason };
  });
  const current = scoped.map((r) => basePrediction(r, "rule_0_current", pMap.get(r.id) ?? r.pCurrentProduction, "current production action"));
  const all = {
    rule_0_current: current,
    rule_1_ev_gt_0: make("rule_1_ev_gt_0"),
    rule_2_ev_gt_1: make("rule_2_ev_gt_1"),
    rule_3_ev_gt_2: make("rule_3_ev_gt_2"),
    rule_4_ev_gt_3: make("rule_4_ev_gt_3"),
    rule_5_learned_ev_grade: make("rule_5_learned_ev_grade"),
    rule_6_learned_ev_prob55_grade: make("rule_6_learned_ev_prob55_grade"),
    rule_7_learned_ev_no_resistance: make("rule_7_learned_ev_no_resistance"),
  };
  return Object.fromEntries(Object.entries(all).map(([name, preds]) => {
    const removed = preds.filter((p) => p.tier === "no_play" && p.row.tier !== "no_play");
    const kept = preds.filter((p) => p.tier !== "no_play");
    return [name, {
      summary: predictionSummary(preds),
      playsKept: kept.length,
      playsRemoved: removed.length,
      removedPerformance: subset(removed),
      keptPerformance: subset(kept),
      bestAngle: subset(kept.filter((p) => p.tier === "best_angle")),
      lean: subset(kept.filter((p) => p.tier === "lean")),
      noPlayAvoidedWinsLosses: subset(preds.filter((p) => p.tier === "no_play")),
      recentMlb3Day: recentWindowSummary(preds, 3, "mlb"),
      recentMlb7Day: recentWindowSummary(preds, 7, "mlb"),
      exactCardsChanged: changedCards(current, preds),
    }];
  }));
}

function candidateHSideSwitchResearch(rows: ReconstructedRow[], calibrated: Prediction[]) {
  const pMap = byIdProbability(calibrated);
  const scoped = rows.filter((r) => r.sport === "mlb" && (r.market === "moneyline" || r.market === "total"));
  const make = (rule: string): Prediction[] => scoped.map((r) => {
    const p = pMap.get(r.id) ?? r.pCurrentProduction;
    const currentEv = expectedValuePerDollar(p, r.price) ?? -999;
    const oppP = 1 - p;
    const oppEv = expectedValuePerDollar(oppP, r.oppositePrice) ?? -999;
    const canSwitch = r.oppositeOutcome !== null && r.oppositePrice !== null;
    let side = r.side;
    let probability = p;
    let price = r.price;
    let outcome: 0 | 1 | null = r.outcome;
    let result = r.result;
    let reason = "current side";
    const shouldSwitch =
      canSwitch && (
        (rule === "B_higher_ev" && oppEv > currentEv) ||
        (rule === "C_opp_ev_plus_2" && oppEv > currentEv + 0.02) ||
        (rule === "D_opp_ev_plus_4" && oppEv > currentEv + 0.04) ||
        (rule === "E_current_nonpositive_opp_gt_2" && currentEv <= 0 && oppEv > 0.02)
      );
    if (shouldSwitch) {
      side = r.oppositeSide;
      probability = oppP;
      price = r.oppositePrice;
      outcome = r.oppositeOutcome;
      result = r.oppositeOutcome === 1 ? "win" : "loss";
      reason = `${rule}: opposite EV ${oppEv.toFixed(4)} vs current ${currentEv.toFixed(4)}`;
    }
    return { row: r, id: rule, side, probability, price, outcome, result, tier: r.tier, reason };
  });
  const current = scoped.map((r) => basePrediction(r, "A_current_side", pMap.get(r.id) ?? r.pCurrentProduction, "current side"));
  const rules = {
    A_current_side: current,
    B_higher_ev: make("B_higher_ev"),
    C_opp_ev_plus_2: make("C_opp_ev_plus_2"),
    D_opp_ev_plus_4: make("D_opp_ev_plus_4"),
    E_current_nonpositive_opp_gt_2: make("E_current_nonpositive_opp_gt_2"),
  };
  return Object.fromEntries(Object.entries(rules).map(([name, preds]) => {
    const switched = preds.filter((p) => p.side !== p.row.side);
    const notSwitched = preds.filter((p) => p.side === p.row.side);
    return [name, {
      summary: predictionSummary(preds),
      sideSwitches: switched.length,
      switchedPerformance: subset(switched),
      nonSwitchedPerformance: subset(notSwitched),
      recentMlb3Day: recentWindowSummary(preds, 3, "mlb"),
      recentMlb7Day: recentWindowSummary(preds, 7, "mlb"),
      exactCardChanges: changedCards(current, preds),
    }];
  }));
}

function chooseGlobalEvThreshold(rows: ReconstructedRow[], pMap: Map<number, number>, requireProbFloor: boolean): number {
  const thresholds = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06];
  return thresholds.map((x) => {
    const ba = rows.filter((r) => {
      const p = pMap.get(r.id) ?? r.pCurrentProduction;
      const ev = evFor(r, p) ?? -1;
      return r.sport === "mlb" && (r.market === "moneyline" || r.market === "total") && ev >= x && (!requireProbFloor || p >= 0.55);
    });
    const profits = ba.map((r) => profit(r.price, r.result)).filter((v): v is number => v !== null);
    return { x, n: ba.length, roi: profits.length ? profits.reduce((s, v) => s + v, 0) / profits.length : -999 };
  })
    .filter((r) => r.n >= 30)
    .sort((a, b) => b.roi - a.roi || b.n - a.n)[0]?.x ?? 0.04;
}

function chooseGlobalBlendWeight(rows: ReconstructedRow[]): number {
  const weights = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  return weights.map((w) => {
    const eligible = rows.filter((r) => r.sport === "mlb" && (r.market === "moneyline" || r.market === "total") && r.pMarketNoVigAtLock !== null);
    const ll = eligible.reduce((s, r) => s + logLoss(blend(r.pCurrentProduction, r.pMarketNoVigAtLock, w), r.outcome), 0) / Math.max(1, eligible.length);
    return { w, ll };
  }).sort((a, b) => a.ll - b.ll)[0]?.w ?? 0.3;
}

async function loadTodayMlbPredictionRows(): Promise<PredictionRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id,game_id,external_id,sport,slate_date,game_date,matchup,market,pick,side,line_value,odds_american,confidence,model_probability,market_probability,expected_value,play_grade,best_angle,no_bet,held,locked_at,published_at,created_at,snapshot_json")
    .eq("sport", "mlb")
    .eq("slate_date", today)
    .in("market", ["moneyline", "total"])
    .order("game_date", { ascending: true });
  if (error) throw new Error(`today prediction_records fetch failed: ${error.message}`);
  return ((data ?? []) as PredictionRow[]).filter((r) => !r.held && r.side && r.model_probability !== null);
}

async function todaySlateBeforeAfter(rows: ReconstructedRow[], calibrated: Prediction[]) {
  const todayRaw = await loadTodayMlbPredictionRows();
  const byKey = new Map<string, PredictionRow>();
  for (const r of todayRaw) {
    const k = `${r.sport}:${r.game_id}:${r.market}`;
    const prev = byKey.get(k);
    if (!prev || (time(asOfFor(r)) ?? 0) > (time(asOfFor(prev)) ?? 0) || ((time(asOfFor(r)) ?? 0) === (time(asOfFor(prev)) ?? 0) && r.id > prev.id)) {
      byKey.set(k, r);
    }
  }
  const todayRows = [...byKey.values()].filter((r) => r.sport === "mlb" && (r.market === "moneyline" || r.market === "total"));
  const todaySnapshots = await loadSnapshots([...new Set(todayRows.map((r) => r.external_id))]);
  const w = chooseGlobalBlendWeight(rows);
  const pMap = byIdProbability(calibrated);
  const evThreshold = chooseGlobalEvThreshold(rows, pMap, true);
  const cards = todayRows.map((r) => {
    const snap = selectSnapshot(todaySnapshots.get(r.external_id) ?? [], r);
    const pModel = r.model_probability ?? 0.5;
    const pMarket = r.market_probability;
    const pCal = blend(pModel, pMarket, w);
    const currentEv = expectedValuePerDollar(pModel, r.odds_american);
    const calibratedEv = expectedValuePerDollar(pCal, r.odds_american);
    const currentGrade = tier(r);
    const candidateGrade =
      (calibratedEv ?? -999) >= evThreshold && pCal >= 0.55 ? "best_angle" :
      (calibratedEv ?? -999) > 0 ? "lean" :
      "no_play";
    const probabilityChanged = Math.abs(pCal - pModel) >= 0.005;
    return {
      id: r.id,
      matchup: r.matchup,
      gameDate: r.game_date,
      market: r.market,
      currentPick: r.side,
      currentLine: r.line_value,
      currentPrice: r.odds_american,
      currentProbability: pModel,
      currentGrade,
      currentEv,
      v2MarketReadLabel: snap?.label ?? null,
      marketProbability: pMarket,
      calibratedProbability: pCal,
      calibratedEv,
      recommendedPickUnderCandidate: r.side,
      recommendedGradeUnderCandidate: candidateGrade,
      changed: probabilityChanged || candidateGrade !== currentGrade,
      probabilityChanged,
      pickChanged: false,
      gradeChanged: candidateGrade !== currentGrade,
      reasonCode: candidateGrade === "no_play"
        ? "calibrated_ev_not_positive"
        : candidateGrade === "best_angle"
          ? `calibrated_ev_above_${(evThreshold * 100).toFixed(1)}pct_and_probability_55plus`
          : "calibrated_ev_positive_below_best_angle_threshold",
    };
  });
  return {
    blendWeight: w,
    evBestAngleThreshold: evThreshold,
    cards,
    summary: {
      totalCards: cards.length,
      picksChanged: cards.filter((c) => c.pickChanged).length,
      probabilitiesChanged: cards.filter((c) => c.probabilityChanged).length,
      gradesChanged: cards.filter((c) => c.gradeChanged).length,
      bestAnglesChanged: cards.filter((c) => c.currentGrade !== "best_angle" && c.recommendedGradeUnderCandidate === "best_angle").length +
        cards.filter((c) => c.currentGrade === "best_angle" && c.recommendedGradeUnderCandidate !== "best_angle").length,
      leansChanged: cards.filter((c) => c.currentGrade !== "lean" && c.recommendedGradeUnderCandidate === "lean").length +
        cards.filter((c) => c.currentGrade === "lean" && c.recommendedGradeUnderCandidate !== "lean").length,
      noPlaysAdded: cards.filter((c) => c.currentGrade !== "no_play" && c.recommendedGradeUnderCandidate === "no_play").length,
      cardsImprovedByEv: cards.filter((c) => (c.calibratedEv ?? -999) > (c.currentEv ?? -999)).length,
      cardsDowngraded: cards.filter((c) => c.recommendedGradeUnderCandidate === "no_play" && c.currentGrade !== "no_play").length,
    },
  };
}

function averageOdds(rows: ReconstructedRow[]): number | null {
  const xs = rows.map((r) => r.price).filter((v): v is number => v !== null);
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
}

function oddsBucket(price: number | null): string {
  if (price === null) return "unknown";
  if (price < -180) return "favorite_worse_than_-180";
  if (price >= -180 && price <= -150) return "-180_to_-150";
  if (price >= -149 && price <= -130) return "-149_to_-130";
  if (price >= -129 && price <= -110) return "-129_to_-110";
  if (price >= -109 && price <= 109) return "-109_to_+109";
  if (price >= 110 && price <= 140) return "+110_to_+140";
  return "+141_or_longer";
}

function evBucket(ev: number | null): string {
  if (ev === null) return "unknown";
  if (ev < 0.01) return "0_to_1pct";
  if (ev < 0.02) return "1_to_2pct";
  if (ev < 0.03) return "2_to_3pct";
  if (ev < 0.05) return "3_to_5pct";
  return "5pct_plus";
}

function probabilityBucket(p: number): string {
  if (p < 0.52) return "50_to_52pct";
  if (p < 0.54) return "52_to_54pct";
  if (p < 0.56) return "54_to_56pct";
  if (p < 0.58) return "56_to_58pct";
  if (p < 0.6) return "58_to_60pct";
  return "60pct_plus";
}

function sideTypeBuckets(row: ReconstructedRow): string[] {
  const out: string[] = [];
  if (row.market === "total") {
    if (row.side === "over" || row.side === "under") out.push(row.side);
  } else {
    if (row.price !== null) out.push(row.price < 0 ? "favorite" : "dog");
    if (row.side === "home" || row.side === "away") out.push(row.side);
  }
  return out.length ? out : ["unknown"];
}

function normalizeMarketReadLabel(label: string | null): string {
  const raw = String(label ?? "Projection-Led").toLowerCase();
  if (raw.includes("strong") && raw.includes("support")) return "Strong Market Support";
  if (raw.includes("slight") && raw.includes("support")) return "Slight Market Support";
  if (raw.includes("support")) return "Market Support";
  if (raw.includes("strong") && raw.includes("resistance")) return "Strong Market Resistance";
  if (raw.includes("slight") && raw.includes("resistance")) return "Slight Market Resistance";
  if (raw.includes("resistance")) return "Market Resistance";
  return "Projection-Led";
}

function rowPredictions(rows: ReconstructedRow[], pMap: Map<number, number>, id: string): Prediction[] {
  return rows.map((r) => basePrediction(r, id, pMap.get(r.id) ?? r.pCurrentProduction, id));
}

function lossCards(rows: ReconstructedRow[], pMap: Map<number, number>, max = 25) {
  return rows
    .filter((r) => r.result === "loss")
    .slice(0, max)
    .map((r) => {
      const p = pMap.get(r.id) ?? r.pCurrentProduction;
      return {
        id: r.id,
        date: r.date,
        matchup: r.matchup,
        market: r.market,
        side: r.side,
        line: r.line,
        price: r.price,
        grade: r.tier,
        probability: p,
        ev: evFor(r, p),
        marketRead: normalizeMarketReadLabel(r.v2LabelReconstructed),
        lineMovement: r.movementDirectionRelativeToPick,
        beatClose: r.beatClosingLine,
      };
    });
}

function currentScopedPredictions(rows: ReconstructedRow[], pMap: Map<number, number>): Prediction[] {
  return rowPredictions(rows, pMap, "current_scoped");
}

function bucketStats(rows: ReconstructedRow[], pMap: Map<number, number>) {
  const preds = rowPredictions(rows, pMap, "bucket");
  const profits = preds.map((p) => profit(p.price, p.result)).filter((v): v is number => v !== null);
  const wins = rows.filter((r) => r.result === "win").length;
  const losses = rows.filter((r) => r.result === "loss").length;
  return {
    plays: rows.length,
    wlPush: `${wins}-${losses}-0`,
    hitRate: wins / Math.max(1, wins + losses),
    roi: profits.length ? profits.reduce((s, v) => s + v, 0) / profits.length : null,
    units: profits.reduce((s, v) => s + v, 0),
    averageOdds: averageOdds(rows),
    bestAngleRoi: subset(preds.filter((p) => p.row.tier === "best_angle")).roi,
    leanRoi: subset(preds.filter((p) => p.row.tier === "lean")).roi,
    recent14DayRoi: recentWindowSummary(preds, 14, undefined)?.actionableRoi ?? null,
    recent7DayRoi: recentWindowSummary(preds, 7, undefined)?.actionableRoi ?? null,
    recent3DayRoi: recentWindowSummary(preds, 3, undefined)?.actionableRoi ?? null,
    losingCards: lossCards(rows, pMap, 20),
  };
}

function maxDateForRows(rows: ReconstructedRow[]): string | null {
  return rows.map((r) => r.date).sort().at(-1) ?? null;
}

function minDateForWindow(rows: ReconstructedRow[], days: number): string | null {
  const maxDate = maxDateForRows(rows);
  if (!maxDate) return null;
  const d = new Date(`${maxDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

function candidateHFailureAutopsy(rows: ReconstructedRow[], calibrated: Prediction[]) {
  const pMap = byIdProbability(calibrated);
  const evPositive = rows.filter((r) => (evFor(r, pMap.get(r.id) ?? r.pCurrentProduction) ?? -999) > 0);
  const maxDate = maxDateForRows(rows);
  const timeWindows = [
    ["all_sample", null],
    ["since_june_1", "2026-06-01"],
    ["last_14_days", minDateForWindow(rows, 14)],
    ["last_10_days", minDateForWindow(rows, 10)],
    ["last_7_days", minDateForWindow(rows, 7)],
    ["last_5_days", minDateForWindow(rows, 5)],
    ["last_3_days", minDateForWindow(rows, 3)],
  ] as const;
  const reportFor = (name: string, groups: Array<[string, ReconstructedRow[]]>) => ({
    name,
    buckets: Object.fromEntries(groups.map(([k, xs]) => [k, bucketStats(xs, pMap)])),
  });
  const onePer = (values: string[], fn: (row: ReconstructedRow) => string) =>
    values.map((v) => [v, evPositive.filter((r) => fn(r) === v)] as [string, ReconstructedRow[]]);
  const multi = (values: string[], fn: (row: ReconstructedRow) => string[]) =>
    values.map((v) => [v, evPositive.filter((r) => fn(r).includes(v))] as [string, ReconstructedRow[]]);
  const byTime = reportFor("time_window", timeWindows.map(([name, since]) => [
    name,
    evPositive.filter((r) => since === null || r.date >= since),
  ]));
  const marketValues = ["mlb_moneyline", "mlb_total", "wnba_moneyline", "wnba_total", "wnba_spread"];
  const sideValues = ["favorite", "dog", "over", "under", "home", "away", "unknown"];
  const oddsValues = ["favorite_worse_than_-180", "-180_to_-150", "-149_to_-130", "-129_to_-110", "-109_to_+109", "+110_to_+140", "+141_or_longer", "unknown"];
  const evValues = ["0_to_1pct", "1_to_2pct", "2_to_3pct", "3_to_5pct", "5pct_plus", "unknown"];
  const probValues = ["50_to_52pct", "52_to_54pct", "54_to_56pct", "56_to_58pct", "58_to_60pct", "60pct_plus"];
  const labelValues = [
    "Strong Market Support",
    "Market Support",
    "Slight Market Support",
    "Projection-Led",
    "Slight Market Resistance",
    "Market Resistance",
    "Strong Market Resistance",
  ];
  const movementValues = ["moved_toward_pick", "neutral", "moved_against_pick", "unknown"];
  const pricingValues = [
    "best_available_price_existed",
    "bad_selected_price",
    "stale_price_risk",
    "missing_clv",
    "closing_line_beat_us",
    "we_beat_closing_line",
  ];
  const movementBucket = (r: ReconstructedRow) => {
    if (r.movementDirectionRelativeToPick === "support") return "moved_toward_pick";
    if (r.movementDirectionRelativeToPick === "resistance") return "moved_against_pick";
    if (r.movementDirectionRelativeToPick === "neutral") return "neutral";
    return "unknown";
  };
  const pricingBuckets = (r: ReconstructedRow) => {
    const out: string[] = [];
    if (r.bestAvailablePriceAtLock !== null) out.push("best_available_price_existed");
    if ((r.selectedToBestPriceEvDelta ?? 0) >= 0.01) out.push("bad_selected_price");
    if (r.reconstructionConfidence === "low" || r.evidenceGroups.G_only_post_lock_or_post_start_evidence_exists) out.push("stale_price_risk");
    if (r.beatClosingLine === null) out.push("missing_clv");
    if (r.beatClosingLine === false) out.push("closing_line_beat_us");
    if (r.beatClosingLine === true) out.push("we_beat_closing_line");
    return out.length ? out : ["no_pricing_flag"];
  };
  const last7 = minDateForWindow(rows, 7);
  const last3 = minDateForWindow(rows, 3);
  const damageGroups = [
    ...onePer(marketValues, (r) => bucket(r)).map(([k, xs]) => [`market:${k}`, xs] as [string, ReconstructedRow[]]),
    ...multi(sideValues, sideTypeBuckets).map(([k, xs]) => [`side:${k}`, xs] as [string, ReconstructedRow[]]),
    ...onePer(oddsValues, (r) => oddsBucket(r.price)).map(([k, xs]) => [`odds:${k}`, xs] as [string, ReconstructedRow[]]),
    ...onePer(evValues, (r) => evBucket(evFor(r, pMap.get(r.id) ?? r.pCurrentProduction))).map(([k, xs]) => [`ev:${k}`, xs] as [string, ReconstructedRow[]]),
    ...onePer(probValues, (r) => probabilityBucket(pMap.get(r.id) ?? r.pCurrentProduction)).map(([k, xs]) => [`prob:${k}`, xs] as [string, ReconstructedRow[]]),
    ...onePer(labelValues, (r) => normalizeMarketReadLabel(r.v2LabelReconstructed)).map(([k, xs]) => [`read:${k}`, xs] as [string, ReconstructedRow[]]),
    ...onePer(movementValues, movementBucket).map(([k, xs]) => [`movement:${k}`, xs] as [string, ReconstructedRow[]]),
    ...multi(pricingValues, pricingBuckets).map(([k, xs]) => [`pricing:${k}`, xs] as [string, ReconstructedRow[]]),
  ];
  const recentDamage = damageGroups
    .map(([name, xs]) => {
      const xs7 = xs.filter((r) => last7 === null || r.date >= last7);
      const xs3 = xs.filter((r) => last3 === null || r.date >= last3);
      return {
        bucket: name,
        all: bucketStats(xs, pMap),
        last7: bucketStats(xs7, pMap),
        last3: bucketStats(xs3, pMap),
      };
    })
    .filter((x) => x.last7.plays >= 5 || x.last3.plays >= 3)
    .sort((a, b) => (a.last7.units - b.last7.units) || (a.last3.units - b.last3.units))
    .slice(0, 20);
  return {
    maxDate,
    candidate: "Candidate H EV > 0",
    totalPositiveEvRows: evPositive.length,
    byTimeWindow: byTime,
    byMarket: reportFor("market", onePer(marketValues, (r) => bucket(r))),
    bySideType: reportFor("side_type", multi(sideValues, sideTypeBuckets)),
    byOddsBucket: reportFor("odds_bucket", onePer(oddsValues, (r) => oddsBucket(r.price))),
    byEvBucket: reportFor("ev_bucket", onePer(evValues, (r) => evBucket(evFor(r, pMap.get(r.id) ?? r.pCurrentProduction)))),
    byProbabilityBucket: reportFor("probability_bucket", onePer(probValues, (r) => probabilityBucket(pMap.get(r.id) ?? r.pCurrentProduction))),
    byMarketRead: reportFor("market_read", onePer(labelValues, (r) => normalizeMarketReadLabel(r.v2LabelReconstructed))),
    byLineMovement: reportFor("line_movement", onePer(movementValues, movementBucket)),
    byPricing: reportFor("pricing", multi(pricingValues, pricingBuckets)),
    recentCollapseBuckets: recentDamage,
  };
}

type SearchRule = {
  id: string;
  family: string;
  description: string;
  flag?: string;
  scope: (row: ReconstructedRow) => boolean;
  transform: (row: ReconstructedRow, p: number, ev: number | null) => { tier: ReconstructedRow["tier"]; probability?: number; reason: string };
};

function modelEdgeForRule(row: ReconstructedRow, p: number): number | null {
  const market = row.pMarketNoVigAtLock ?? implied(row.price);
  return market === null ? null : p - market;
}

function hasResistance(row: ReconstructedRow, includeSlight: boolean): boolean {
  const label = normalizeMarketReadLabel(row.v2LabelReconstructed);
  if (includeSlight) return label.includes("Resistance");
  return label === "Market Resistance" || label === "Strong Market Resistance";
}

function rulePredictions(rows: ReconstructedRow[], pMap: Map<number, number>, rule: SearchRule): Prediction[] {
  return rows.filter(rule.scope).map((r) => {
    const p = pMap.get(r.id) ?? r.pCurrentProduction;
    const ev = evFor(r, p);
    const t = rule.transform(r, p, ev);
    return {
      row: r,
      id: rule.id,
      side: r.side,
      probability: Math.min(0.99, Math.max(0.01, t.probability ?? p)),
      price: r.price,
      outcome: r.outcome,
      result: r.result,
      tier: t.tier,
      reason: t.reason,
    };
  });
}

function deployabilityVerdict(candidate: Prediction[], baseline: Prediction[]) {
  const c = predictionSummary(candidate);
  const b = predictionSummary(baseline);
  const c14 = recentWindowSummary(candidate, 14, "mlb");
  const c7 = recentWindowSummary(candidate, 7, "mlb");
  const c3 = recentWindowSummary(candidate, 3, "mlb");
  const b14 = recentWindowSummary(baseline, 14, "mlb");
  const b7 = recentWindowSummary(baseline, 7, "mlb");
  const cBa = subset(candidate.filter((p) => p.tier === "best_angle"));
  const bBa = subset(baseline.filter((p) => p.tier === "best_angle"));
  const cLean = subset(candidate.filter((p) => p.tier === "lean"));
  const removed = candidate.filter((p) => p.tier === "no_play" && p.row.tier !== "no_play").length;
  const kept = candidate.filter((p) => p.tier !== "no_play").length;
  const blockers: string[] = [];
  if (c.actionableRoi <= b.actionableRoi) blockers.push("all_sample_roi_not_improved");
  if ((c14?.actionablePlays ?? 0) >= 15 && (c14?.actionableRoi ?? -999) < 0) blockers.push("last_14_day_roi_not_positive");
  if ((c7?.actionablePlays ?? 0) >= 10 && (c7?.actionableRoi ?? -999) < -0.05) blockers.push("last_7_day_roi_materially_negative");
  if ((c3?.actionablePlays ?? 0) >= 10 && (c3?.actionableRoi ?? -999) < -0.10) blockers.push("last_3_day_roi_materially_negative");
  if (cBa.roi !== null && bBa.roi !== null && cBa.roi < bBa.roi - 0.01) blockers.push("best_angle_roi_worsens");
  if (cLean.n >= 15 && (cLean.roi ?? -999) < -0.20) blockers.push("lean_roi_collapses");
  if (kept < Math.max(25, Math.floor(b.actionablePlays * 0.35))) blockers.push("wins_by_deleting_too_many_plays");
  if (c.logLoss > b.logLoss + 0.003) blockers.push("log_loss_worsens");
  if (c.brier > b.brier + 0.002) blockers.push("brier_worsens");
  return {
    deployable: blockers.length === 0,
    blockers,
    baselineActionableRoi: b.actionableRoi,
    candidateActionableRoi: c.actionableRoi,
    baselineRecent14DayRoi: b14?.actionableRoi ?? null,
    candidateRecent14DayRoi: c14?.actionableRoi ?? null,
    baselineRecent7DayRoi: b7?.actionableRoi ?? null,
    candidateRecent7DayRoi: c7?.actionableRoi ?? null,
    candidateRecent3DayRoi: c3?.actionableRoi ?? null,
    playsKept: kept,
    playsRemoved: removed,
  };
}

function todayImpactForSearchRule(today: Awaited<ReturnType<typeof todaySlateBeforeAfter>>, rule: SearchRule) {
  const cards = today.cards.map((card) => {
    const rowLike = {
      sport: "mlb",
      market: card.market,
      side: card.currentPick ?? "",
      price: card.currentPrice,
      tier: card.currentGrade,
      v2LabelReconstructed: card.v2MarketReadLabel ?? "Projection-Led",
      pMarketNoVigAtLock: card.marketProbability,
      movementDirectionRelativeToPick: null,
      reconstructionConfidence: card.marketProbability !== null ? "medium" : "low",
      bestAvailablePriceAtLock: null,
    } as ReconstructedRow;
    if (!rule.scope(rowLike)) {
      return { ...card, proposedGrade: card.currentGrade, proposedAction: "unchanged", changedByRule: false, ruleReason: "outside_scope" };
    }
    const t = rule.transform(rowLike, card.calibratedProbability, card.calibratedEv);
    return {
      ...card,
      proposedGrade: t.tier,
      proposedAction: t.tier === "no_play" ? "no_play" : "keep",
      changedByRule: t.tier !== card.currentGrade,
      ruleReason: t.reason,
    };
  });
  return {
    totalCards: cards.length,
    picksChanged: 0,
    probabilitiesChanged: cards.filter((c) => c.probabilityChanged).length,
    gradesChanged: cards.filter((c) => c.changedByRule).length,
    bestAnglesChanged: cards.filter((c) => c.currentGrade === "best_angle" || c.proposedGrade === "best_angle").filter((c) => c.changedByRule).length,
    leansChanged: cards.filter((c) => c.currentGrade === "lean" || c.proposedGrade === "lean").filter((c) => c.changedByRule).length,
    noPlaysAdded: cards.filter((c) => c.currentGrade !== "no_play" && c.proposedGrade === "no_play").length,
    playsRemoved: cards.filter((c) => c.proposedGrade === "no_play" && c.currentGrade !== "no_play").length,
    exactRiskReduction: {
      removedNegativeEvCards: cards.filter((c) => c.proposedGrade === "no_play" && c.currentGrade !== "no_play" && (c.calibratedEv ?? 0) < 0).length,
      removedCalibratedEvSum: cards
        .filter((c) => c.proposedGrade === "no_play" && c.currentGrade !== "no_play")
        .reduce((s, c) => s + (c.calibratedEv ?? 0), 0),
    },
    changedCards: cards.filter((c) => c.changedByRule).slice(0, 50),
  };
}

function sideClass(row: ReconstructedRow): string {
  if (row.market === "total") return row.side;
  if (row.price === null) return row.side;
  return row.price < 0 ? "favorite" : "dog";
}

function performanceBucketKey(row: ReconstructedRow): string {
  return `${row.sport}:${row.market}:${row.tier}:${sideClass(row)}:${oddsBucket(row.price)}:${normalizeMarketReadLabel(row.v2LabelReconstructed)}`;
}

function chronologicalBucketGradeRecalibration(rows: ReconstructedRow[], pMap: Map<number, number>, mode: "all" | "best_angle" | "lean"): Prediction[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return sorted.map((r) => {
    const p = pMap.get(r.id) ?? r.pCurrentProduction;
    const train = sorted.filter((x) => x.date < r.date && performanceBucketKey(x) === performanceBucketKey(r));
    const profits = train.map((x) => profit(x.price, x.result)).filter((v): v is number => v !== null);
    const bucketRoi = profits.length ? profits.reduce((s, v) => s + v, 0) / profits.length : null;
    let tier = r.tier;
    let reason = "insufficient_bucket_history";
    if (profits.length >= 12 && bucketRoi !== null) {
      reason = `bucket_roi_${(bucketRoi * 100).toFixed(1)}pct_n_${profits.length}`;
      if ((mode === "all" || mode === "best_angle") && r.tier === "best_angle" && bucketRoi < -0.03) tier = "lean";
      if ((mode === "all" || mode === "lean") && r.tier === "lean" && bucketRoi < -0.05) tier = "no_play";
      if (mode === "all" && (r.tier === "other" || r.tier === "no_play") && bucketRoi > 0.08 && p >= 0.54) tier = "lean";
    }
    return { row: r, id: `chronological_bucket_grade_${mode}`, side: r.side, probability: p, price: r.price, outcome: r.outcome, result: r.result, tier, reason };
  });
}

function bucketKillSwitches(rows: ReconstructedRow[], pMap: Map<number, number>) {
  const categories: Array<[string, (r: ReconstructedRow) => string]> = [
    ["sport_market", (r) => bucket(r)],
    ["market_grade", (r) => `${bucket(r)}:${r.tier}`],
    ["market_side", (r) => `${bucket(r)}:${sideClass(r)}`],
    ["odds", (r) => oddsBucket(r.price)],
    ["probability", (r) => probabilityBucket(pMap.get(r.id) ?? r.pCurrentProduction)],
    ["market_read", (r) => normalizeMarketReadLabel(r.v2LabelReconstructed)],
    ["line_movement", (r) => r.movementDirectionRelativeToPick ?? "unknown"],
    ["ev_bucket", (r) => evBucket(evFor(r, pMap.get(r.id) ?? r.pCurrentProduction))],
  ];
  const out: Array<Record<string, unknown>> = [];
  for (const [family, fn] of categories) {
    const keys = [...new Set(rows.map(fn))];
    for (const key of keys) {
      const xs = rows.filter((r) => fn(r) === key && r.tier !== "no_play");
      if (xs.length < 15) continue;
      const preds = rowPredictions(xs, pMap, "bucket_kill_switch");
      const all = predictionSummary(preds);
      const r14 = recentWindowSummary(preds, 14, "mlb");
      const r7 = recentWindowSummary(preds, 7, "mlb");
      const harmful =
        all.actionableRoi < -0.08 &&
        (r14?.actionablePlays ?? 0) >= 5 &&
        (r14?.actionableRoi ?? 0) < -0.05 &&
        ((r7?.actionablePlays ?? 0) < 5 || (r7?.actionableRoi ?? 0) < 0);
      if (harmful) {
        out.push({
          family,
          bucket: key,
          plays: xs.length,
          allSampleRoi: all.actionableRoi,
          last14DayRoi: r14?.actionableRoi ?? null,
          last7DayRoi: r7?.actionableRoi ?? null,
          bestAngle: subset(preds.filter((p) => p.tier === "best_angle")),
          lean: subset(preds.filter((p) => p.tier === "lean")),
          sampleLossCards: lossCards(xs, pMap, 10),
          recommendation: "candidate_scoped_disable_or_demote",
        });
      }
    }
  }
  return out.sort((a, b) => Number(a.allSampleRoi) - Number(b.allSampleRoi));
}

function rollingRecentFormCorrection(rows: ReconstructedRow[]) {
  const mlb = rows.filter((r) => r.sport === "mlb" && (r.market === "moneyline" || r.market === "total"));
  const dates = [...new Set(mlb.map((r) => r.date))].sort();
  const byDate = dates.map((date) => {
    const xs = mlb.filter((r) => r.date === date);
    const preds = productionPredictions(xs);
    return {
      date,
      n: xs.length,
      avgProbability: xs.reduce((s, r) => s + r.pCurrentProduction, 0) / Math.max(1, xs.length),
      hitRate: xs.reduce((s, r) => s + r.outcome, 0) / Math.max(1, xs.length),
      logLoss: predictionSummary(preds).logLoss,
      brier: predictionSummary(preds).brier,
      roi: predictionSummary(preds).actionableRoi,
    };
  });
  const shrink = [0.05, 0.1, 0.15, 0.2, 0.3].map((factor) => {
    const preds = mlb.map((r) => basePrediction(
      r,
      `recent_shrink_${factor}`,
      0.5 + (r.pCurrentProduction - 0.5) * (1 - factor),
      `shrink_toward_50_by_${factor}`,
    ));
    return {
      factor,
      summary: predictionSummary(preds),
      recent14Day: recentWindowSummary(preds, 14, "mlb"),
      recent7Day: recentWindowSummary(preds, 7, "mlb"),
      recent3Day: recentWindowSummary(preds, 3, "mlb"),
    };
  });
  return {
    byDate,
    shrinkageTests: shrink,
    note: "Shrinkage changes probability quality only; W-L and ROI remain unchanged unless a grade or no-play rule consumes the shrunken probability.",
  };
}

function constrainedRuleSearch(rows: ReconstructedRow[], calibrated: Prediction[], today: Awaited<ReturnType<typeof todaySlateBeforeAfter>>) {
  const pMap = byIdProbability(calibrated);
  const mlbMlTotal = (r: ReconstructedRow) => r.sport === "mlb" && (r.market === "moneyline" || r.market === "total");
  const allSportMarkets = (r: ReconstructedRow) =>
    (r.sport === "mlb" && (r.market === "moneyline" || r.market === "total")) ||
    (r.sport === "wnba" && (r.market === "moneyline" || r.market === "total" || r.market === "spread"));
  const evGate = (threshold: number): SearchRule["transform"] => (r, _p, ev) => ({
    tier: (ev ?? -999) > threshold ? r.tier : "no_play",
    reason: (ev ?? -999) > threshold ? `ev_gt_${(threshold * 100).toFixed(0)}pct` : `ev_not_gt_${(threshold * 100).toFixed(0)}pct`,
  });
  const rules: SearchRule[] = [
    ...[0.01, 0.02, 0.03, 0.04, 0.05, 0.06].map((x) => ({
      id: `A_ev_gt_${Math.round(x * 100)}pct`,
      family: "A_EV_threshold",
      description: `Keep only MLB ML/total plays with calibrated EV > ${(x * 100).toFixed(0)}%.`,
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: evGate(x),
    })),
    ...[
      [0.01, 0.53],
      [0.02, 0.53],
      [0.03, 0.53],
      [0.02, 0.55],
      [0.03, 0.55],
      [0.04, 0.55],
    ].map(([evMin, pMin]) => ({
      id: `B_ev_gt_${Math.round(evMin * 100)}pct_p_${Math.round(pMin * 100)}plus`,
      family: "B_probability_plus_EV",
      description: `Keep only MLB ML/total plays with EV > ${(evMin * 100).toFixed(0)}% and probability >= ${(pMin * 100).toFixed(0)}%.`,
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r: ReconstructedRow, p: number, ev: number | null) => ({
        tier: (ev ?? -999) > evMin && p >= pMin ? r.tier : "no_play",
        reason: (ev ?? -999) > evMin && p >= pMin ? "ev_probability_gate_passed" : "ev_probability_gate_failed",
      }),
    })),
    {
      id: "C_ev_gt_0_no_market_resistance",
      family: "C_market_read_filter",
      description: "Keep EV-positive MLB ML/total plays unless v2 read is Market Resistance or Strong Market Resistance.",
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => ({ tier: (ev ?? -999) > 0 && !hasResistance(r, false) ? r.tier : "no_play", reason: "ev_positive_and_no_market_resistance" }),
    },
    {
      id: "C_ev_gt_0_no_any_resistance",
      family: "C_market_read_filter",
      description: "Keep EV-positive MLB ML/total plays only when there is no slight/market/strong resistance.",
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => ({ tier: (ev ?? -999) > 0 && !hasResistance(r, true) ? r.tier : "no_play", reason: "ev_positive_and_no_resistance" }),
    },
    {
      id: "C_ev_gt_0_market_support_only",
      family: "C_market_read_filter",
      description: "Keep EV-positive MLB ML/total plays only with Market Support labels.",
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => ({ tier: (ev ?? -999) > 0 && normalizeMarketReadLabel(r.v2LabelReconstructed).includes("Support") ? r.tier : "no_play", reason: "ev_positive_market_support_only" }),
    },
    {
      id: "C_ev_gt_0_support_or_projection_led_only",
      family: "C_market_read_filter",
      description: "Keep EV-positive MLB ML/total plays only with support or Projection-Led labels.",
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => {
        const label = normalizeMarketReadLabel(r.v2LabelReconstructed);
        const okLabel = label.includes("Support") || label === "Projection-Led";
        return { tier: (ev ?? -999) > 0 && okLabel ? r.tier : "no_play", reason: "ev_positive_support_or_projection_led" };
      },
    },
    {
      id: "C_projection_led_requires_3pp_model_edge",
      family: "C_market_read_filter",
      description: "Projection-Led plays require 3pp model edge; non-Projection-Led still require positive EV.",
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, p, ev) => {
        const label = normalizeMarketReadLabel(r.v2LabelReconstructed);
        const edge = modelEdgeForRule(r, p);
        const ok = (ev ?? -999) > 0 && (label !== "Projection-Led" || (edge !== null && edge >= 0.03));
        return { tier: ok ? r.tier : "no_play", reason: ok ? "projection_led_edge_gate_passed" : "projection_led_edge_gate_failed" };
      },
    },
    {
      id: "C_demote_projection_led_best_angles_edge_lt_4pp",
      family: "C_market_read_filter",
      description: "Only demote Projection-Led Best Angles to Lean when model edge is below 4pp.",
      flag: "MARKET_AWARE_BEST_ANGLE_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, p) => {
        const edge = modelEdgeForRule(r, p);
        const demote = r.tier === "best_angle" && normalizeMarketReadLabel(r.v2LabelReconstructed) === "Projection-Led" && (edge === null || edge < 0.04);
        return { tier: demote ? "lean" : r.tier, reason: demote ? "projection_led_best_angle_edge_lt_4pp" : "unchanged" };
      },
    },
    {
      id: "C_exclude_projection_led_favorites",
      family: "C_market_read_filter",
      description: "EV > 0 but exclude Projection-Led favorites.",
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => {
        const poison = normalizeMarketReadLabel(r.v2LabelReconstructed) === "Projection-Led" && r.price !== null && r.price < 0;
        return { tier: (ev ?? -999) > 0 && !poison ? r.tier : "no_play", reason: poison ? "projection_led_favorite_excluded" : "ev_gate" };
      },
    },
    {
      id: "C_exclude_projection_led_totals",
      family: "C_market_read_filter",
      description: "EV > 0 but exclude Projection-Led MLB totals.",
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => {
        const poison = normalizeMarketReadLabel(r.v2LabelReconstructed) === "Projection-Led" && r.market === "total";
        return { tier: (ev ?? -999) > 0 && !poison ? r.tier : "no_play", reason: poison ? "projection_led_total_excluded" : "ev_gate" };
      },
    },
    {
      id: "C_exclude_line_movement_against",
      family: "C_market_read_filter",
      description: "EV > 0 and exclude any pick with line movement against us.",
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => ({ tier: (ev ?? -999) > 0 && r.movementDirectionRelativeToPick !== "resistance" ? r.tier : "no_play", reason: "ev_positive_no_against_move" }),
    },
    {
      id: "D_mlb_ml_only_ev_gt_0",
      family: "D_sport_market_scope",
      description: "MLB moneyline only, EV > 0.",
      flag: "MARKET_AWARE_MLB_ML_ENABLED",
      scope: (r) => r.sport === "mlb" && r.market === "moneyline",
      transform: evGate(0),
    },
    {
      id: "D_mlb_totals_only_ev_gt_0",
      family: "D_sport_market_scope",
      description: "MLB totals only, EV > 0.",
      flag: "MARKET_AWARE_MLB_TOTAL_ENABLED",
      scope: (r) => r.sport === "mlb" && r.market === "total",
      transform: evGate(0),
    },
    {
      id: "D_mlb_totals_unders_only_ev_gt_0",
      family: "D_sport_market_scope",
      description: "MLB totals unders only, EV > 0.",
      flag: "MARKET_AWARE_MLB_TOTAL_ENABLED",
      scope: (r) => r.sport === "mlb" && r.market === "total" && r.side === "under",
      transform: evGate(0),
    },
    {
      id: "D_mlb_totals_overs_only_ev_gt_0",
      family: "D_sport_market_scope",
      description: "MLB totals overs only, EV > 0.",
      flag: "MARKET_AWARE_MLB_TOTAL_ENABLED",
      scope: (r) => r.sport === "mlb" && r.market === "total" && r.side === "over",
      transform: evGate(0),
    },
    {
      id: "D_mlb_ml_favorites_only_ev_gt_0",
      family: "D_sport_market_scope",
      description: "MLB moneyline favorites only, EV > 0.",
      flag: "MARKET_AWARE_MLB_ML_ENABLED",
      scope: (r) => r.sport === "mlb" && r.market === "moneyline" && r.price !== null && r.price < 0,
      transform: evGate(0),
    },
    {
      id: "D_mlb_ml_dogs_only_ev_gt_0",
      family: "D_sport_market_scope",
      description: "MLB moneyline dogs only, EV > 0.",
      flag: "MARKET_AWARE_MLB_ML_ENABLED",
      scope: (r) => r.sport === "mlb" && r.market === "moneyline" && r.price !== null && r.price > 0,
      transform: evGate(0),
    },
    {
      id: "D_mlb_totals_line_8plus_ev_gt_0",
      family: "D_sport_market_scope",
      description: "MLB totals with line >= 8 only, EV > 0.",
      flag: "MARKET_AWARE_MLB_TOTAL_ENABLED",
      scope: (r) => r.sport === "mlb" && r.market === "total" && r.line !== null && r.line >= 8,
      transform: evGate(0),
    },
    {
      id: "D_mlb_totals_line_8_5plus_ev_gt_0",
      family: "D_sport_market_scope",
      description: "MLB totals with line >= 8.5 only, EV > 0.",
      flag: "MARKET_AWARE_MLB_TOTAL_ENABLED",
      scope: (r) => r.sport === "mlb" && r.market === "total" && r.line !== null && r.line >= 8.5,
      transform: evGate(0),
    },
    {
      id: "D_mlb_totals_line_7_5_or_lower_ev_gt_0",
      family: "D_sport_market_scope",
      description: "MLB totals with line <= 7.5 only, EV > 0.",
      flag: "MARKET_AWARE_MLB_TOTAL_ENABLED",
      scope: (r) => r.sport === "mlb" && r.market === "total" && r.line !== null && r.line <= 7.5,
      transform: evGate(0),
    },
    {
      id: "D_favorites_only_ev_gt_0",
      family: "D_sport_market_scope",
      description: "Favorites only, EV > 0.",
      scope: (r) => mlbMlTotal(r) && r.price !== null && r.price < 0,
      transform: evGate(0),
    },
    {
      id: "D_dogs_only_ev_gt_0",
      family: "D_sport_market_scope",
      description: "Dogs only, EV > 0.",
      scope: (r) => mlbMlTotal(r) && r.price !== null && r.price > 0,
      transform: evGate(0),
    },
    {
      id: "D_overs_only_ev_gt_0",
      family: "D_sport_market_scope",
      description: "Overs only, EV > 0.",
      scope: (r) => mlbMlTotal(r) && r.side === "over",
      transform: evGate(0),
    },
    {
      id: "D_unders_only_ev_gt_0",
      family: "D_sport_market_scope",
      description: "Unders only, EV > 0.",
      scope: (r) => mlbMlTotal(r) && r.side === "under",
      transform: evGate(0),
    },
    {
      id: "E_fresh_line_evidence_ev_gt_0",
      family: "E_timing_quality",
      description: "EV > 0 and reconstructed market probability or best price exists.",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => ({ tier: (ev ?? -999) > 0 && (r.pMarketNoVigAtLock !== null || r.bestAvailablePriceAtLock !== null) ? r.tier : "no_play", reason: "fresh_line_evidence_ev_gate" }),
    },
    {
      id: "E_positive_or_neutral_movement_ev_gt_0",
      family: "E_timing_quality",
      description: "EV > 0 and line movement is support or neutral.",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => ({ tier: (ev ?? -999) > 0 && r.movementDirectionRelativeToPick !== "resistance" ? r.tier : "no_play", reason: "positive_or_neutral_movement_ev_gate" }),
    },
    {
      id: "E_no_stale_risk_high_medium_confidence_ev_gt_0",
      family: "E_timing_quality",
      description: "EV > 0 and reconstruction confidence is not low.",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => ({ tier: (ev ?? -999) > 0 && r.reconstructionConfidence !== "low" ? r.tier : "no_play", reason: "no_low_confidence_ev_gate" }),
    },
    {
      id: "E_locked_price_exists_ev_gt_0",
      family: "E_timing_quality",
      description: "EV > 0 and locked price exists.",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => ({ tier: (ev ?? -999) > 0 && r.price !== null ? r.tier : "no_play", reason: "locked_price_ev_gate" }),
    },
    {
      id: "E_best_available_price_confirms_ev",
      family: "E_timing_quality",
      description: "Best available price at lock also confirms positive EV.",
      flag: "BEST_AVAILABLE_PRICE_GRADING_ENABLED",
      scope: mlbMlTotal,
      transform: (r, p) => {
        const bestEv = expectedValuePerDollar(p, r.bestAvailablePriceAtLock ?? r.price);
        return { tier: (bestEv ?? -999) > 0 ? r.tier : "no_play", reason: "best_available_price_ev_gate" };
      },
    },
    {
      id: "F_demote_negative_ev_best_angles_only",
      family: "F_grade_only",
      description: "Demote only negative-EV Best Angles to Lean.",
      flag: "MARKET_AWARE_BEST_ANGLE_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => ({ tier: r.tier === "best_angle" && (ev ?? 0) < 0 ? "lean" : r.tier, reason: "negative_ev_best_angle_demotion_only" }),
    },
    {
      id: "F_best_angles_only_ev_gt_0",
      family: "F_grade_only",
      description: "Evaluate Best Angles only; demote negative-EV Best Angles to Lean.",
      flag: "MARKET_AWARE_BEST_ANGLE_FILTER_ENABLED",
      scope: (r) => mlbMlTotal(r) && r.tier === "best_angle",
      transform: (r, _p, ev) => ({ tier: (ev ?? 0) > 0 ? r.tier : "lean", reason: "best_angle_ev_gate" }),
    },
    {
      id: "F_demote_negative_ev_leans_only",
      family: "F_grade_only",
      description: "Demote only negative-EV Leans to No Play.",
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => ({ tier: r.tier === "lean" && (ev ?? 0) < 0 ? "no_play" : r.tier, reason: "negative_ev_lean_demotion_only" }),
    },
    {
      id: "F_leans_only_ev_gt_0",
      family: "F_grade_only",
      description: "Evaluate Leans only; convert negative-EV Leans to No Play.",
      flag: "MARKET_AWARE_LEAN_FILTER_ENABLED",
      scope: (r) => mlbMlTotal(r) && r.tier === "lean",
      transform: (r, _p, ev) => ({ tier: (ev ?? 0) > 0 ? r.tier : "no_play", reason: "lean_ev_gate" }),
    },
    {
      id: "F_no_upgrades_demotions_only_ev",
      family: "F_grade_only",
      description: "No upgrades; demote Best Angle to Lean on EV <= 0 and Lean to No Play on EV <= 0.",
      flag: "MARKET_AWARE_EV_GRADE_ENGINE_ENABLED",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => {
        if ((ev ?? 0) > 0) return { tier: r.tier, reason: "positive_ev_unchanged" };
        if (r.tier === "best_angle") return { tier: "lean", reason: "negative_ev_best_angle_to_lean" };
        if (r.tier === "lean") return { tier: "no_play", reason: "negative_ev_lean_to_no_play" };
        return { tier: r.tier, reason: "unchanged" };
      },
    },
    {
      id: "F_no_play_filter_only_ev_lt_0",
      family: "F_grade_only",
      description: "No upgrades; non-positive EV actionable plays become No Play.",
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => ({ tier: (ev ?? 0) > 0 ? r.tier : "no_play", reason: "no_play_filter_only_ev_lt_0" }),
    },
    {
      id: "F_grade_boost_support_positive_ev",
      family: "F_grade_only",
      description: "Boost only when Market Support and EV positive; no side changes.",
      flag: "MARKET_AWARE_EV_GRADE_ENGINE_ENABLED",
      scope: mlbMlTotal,
      transform: (r, p, ev) => {
        const support = normalizeMarketReadLabel(r.v2LabelReconstructed).includes("Support");
        if (!support || (ev ?? -999) <= 0) return { tier: r.tier, reason: "no_support_boost" };
        if ((ev ?? 0) >= 0.03 && p >= 0.55) return { tier: "best_angle", reason: "support_ev_best_angle_boost" };
        if (r.tier === "other" || r.tier === "no_play") return { tier: "lean", reason: "support_ev_lean_boost" };
        return { tier: r.tier, reason: "support_ev_unchanged" };
      },
    },
    {
      id: "F_suppress_ev_lt_minus_2pct",
      family: "F_grade_only",
      description: "Suppress any play with calibrated EV < -2%.",
      flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED",
      scope: mlbMlTotal,
      transform: (r, _p, ev) => ({ tier: (ev ?? 0) < -0.02 ? "no_play" : r.tier, reason: "suppress_ev_lt_minus_2pct" }),
    },
    {
      id: "F_promote_ev_gt_4pct_only_if_recent_bucket_positive",
      family: "F_grade_only",
      description: "Promote EV > 4% only in buckets with positive all-sample market-read ROI; otherwise leave unchanged.",
      flag: "MARKET_AWARE_EV_GRADE_ENGINE_ENABLED",
      scope: mlbMlTotal,
      transform: (r, p, ev) => {
        const label = normalizeMarketReadLabel(r.v2LabelReconstructed);
        const historical = rows.filter((x) => mlbMlTotal(x) && normalizeMarketReadLabel(x.v2LabelReconstructed) === label);
        const stats = bucketStats(historical, pMap);
        const promote = (ev ?? -999) > 0.04 && (stats.roi ?? -999) > 0 && p >= 0.55;
        return { tier: promote ? "best_angle" : r.tier, reason: promote ? "ev_gt_4_recent_positive_bucket" : "unchanged" };
      },
    },
    {
      id: "WNBA_research_only_ev_gt_0",
      family: "D_sport_market_scope",
      description: "WNBA sample check only; not deployable until sample grows.",
      scope: (r) => allSportMarkets(r) && r.sport === "wnba",
      transform: evGate(0),
    },
  ];
  return Object.fromEntries(rules.map((rule) => {
    const scopedRows = rows.filter(rule.scope);
    const baseline = currentScopedPredictions(scopedRows, pMap);
    const preds = rulePredictions(rows, pMap, rule);
    const removed = preds.filter((p) => p.tier === "no_play" && p.row.tier !== "no_play");
    const kept = preds.filter((p) => p.tier !== "no_play");
    return [rule.id, {
      family: rule.family,
      description: rule.description,
      potentialFlag: rule.flag ?? null,
      scopedRows: scopedRows.length,
      playsKept: kept.length,
      playsRemoved: removed.length,
      keptPerformance: subset(kept),
      removedPerformance: subset(removed),
      bestAngle: subset(kept.filter((p) => p.tier === "best_angle")),
      lean: subset(kept.filter((p) => p.tier === "lean")),
      fullSummary: predictionSummary(preds),
      baselineSummary: predictionSummary(baseline),
      recent14Day: recentWindowSummary(preds, 14, "mlb"),
      recent7Day: recentWindowSummary(preds, 7, "mlb"),
      recent3Day: recentWindowSummary(preds, 3, "mlb"),
      logLossBrier: {
        logLoss: predictionSummary(preds).logLoss,
        brier: predictionSummary(preds).brier,
        baselineLogLoss: predictionSummary(baseline).logLoss,
        baselineBrier: predictionSummary(baseline).brier,
      },
      todaySlateImpact: todayImpactForSearchRule(today, rule),
      deployability: rule.id.startsWith("WNBA")
        ? { deployable: false, blockers: ["wnba_sample_too_small"], note: "Research only until WNBA settled market sample grows." }
        : deployabilityVerdict(preds, baseline),
    }];
  }));
}

function alternativeCreativePaths(rows: ReconstructedRow[], calibrated: Prediction[], today: Awaited<ReturnType<typeof todaySlateBeforeAfter>>) {
  const pMap = byIdProbability(calibrated);
  const mlb = rows.filter((r) => r.sport === "mlb" && (r.market === "moneyline" || r.market === "total"));
  const baseline = productionPredictions(mlb);
  const probabilityOnly = rowPredictions(mlb, pMap, "probability_only_calibration");
  const noPlay = noPlayFilterPredictions(mlb, "ev_gt_0");
  const baFilter = rulePredictions(mlb, pMap, {
    id: "best_angle_quality_filter",
    family: "creative_best_angle_filter",
    description: "Demote negative-EV Best Angles only.",
    scope: () => true,
    transform: (r, _p, ev) => ({ tier: r.tier === "best_angle" && (ev ?? 0) < 0 ? "lean" : r.tier, reason: "negative_ev_best_angle_demotion_only" }),
  });
  const gradeRecalibration = chronologicalBucketGradeRecalibration(mlb, pMap, "all");
  const bestAngleChronological = chronologicalBucketGradeRecalibration(mlb, pMap, "best_angle");
  const leanChronological = chronologicalBucketGradeRecalibration(mlb, pMap, "lean");
  const probabilitySummary = predictionSummary(probabilityOnly);
  const baselineSummary = predictionSummary(baseline);
  return {
    probabilityOnlyCalibration: {
      summary: probabilitySummary,
      baseline: baselineSummary,
      calibrationImprovement: {
        logLossDelta: probabilitySummary.logLoss - baselineSummary.logLoss,
        brierDelta: probabilitySummary.brier - baselineSummary.brier,
        improvedLogLoss: probabilitySummary.logLoss < baselineSummary.logLoss,
        improvedBrier: probabilitySummary.brier < baselineSummary.brier,
      },
      deployability: {
        deployableForProbabilityDisplayOnly: probabilitySummary.logLoss <= baselineSummary.logLoss && probabilitySummary.brier <= baselineSummary.brier,
        deployableForPicksOrGrades: false,
        blockersForPicksOrGrades: ["probability_only_does_not_improve_wl_or_roi_without_a_grade_or_no_play_rule"],
      },
      todaySlateImpact: {
        probabilitiesChanged: today.summary.probabilitiesChanged,
        picksChanged: 0,
        gradesChanged: 0,
      },
    },
    evGradeEngine: reportGradeResearch({
      ev_grade_engine_current_candidate: gradeEngine(mlb, "ev"),
    }, baseline),
    noPlayFilter: {
      summary: predictionSummary(noPlay),
      baseline: predictionSummary(baseline),
      deployability: deployabilityVerdict(noPlay, baseline),
    },
    bestAngleQualityFilter: {
      summary: predictionSummary(baFilter),
      baseline: predictionSummary(baseline),
      deployability: deployabilityVerdict(baFilter, baseline),
      changedCards: changedCards(baseline, baFilter),
    },
    chronologicalGradeRecalibrationOnly: {
      summary: predictionSummary(gradeRecalibration),
      baseline: predictionSummary(baseline),
      deployability: deployabilityVerdict(gradeRecalibration, baseline),
      changedCards: changedCards(baseline, gradeRecalibration),
    },
    chronologicalBestAngleQualityFilter: {
      summary: predictionSummary(bestAngleChronological),
      baseline: predictionSummary(baseline),
      deployability: deployabilityVerdict(bestAngleChronological, baseline),
      changedCards: changedCards(baseline, bestAngleChronological),
    },
    chronologicalLeanQualityFilter: {
      summary: predictionSummary(leanChronological),
      baseline: predictionSummary(baseline),
      deployability: deployabilityVerdict(leanChronological, baseline),
      changedCards: changedCards(baseline, leanChronological),
    },
    mlbTotalsProjectionAnchoring: mlbTotalsProjectionAnchoring(rows),
    bestAvailablePriceGrading: bestPriceResearch(rows),
    clvPredictor: clvReport(rows),
    bucketKillSwitches: bucketKillSwitches(mlb, pMap),
    separateTotalsAndMlEngines: {
      mlbMoneyline: predictionSummary(rowPredictions(mlb.filter((r) => r.market === "moneyline"), pMap, "mlb_ml_probability")),
      mlbTotals: predictionSummary(rowPredictions(mlb.filter((r) => r.market === "total"), pMap, "mlb_total_probability")),
      note: "Separate scoped rule results live in part2ConstrainedRuleSearch under D_mlb_ml_* and D_mlb_totals_*.",
    },
    recentFormCorrection: rollingRecentFormCorrection(rows),
  };
}

function boundedSearchPromotionDecision(search: Record<string, any>, alternatives: ReturnType<typeof alternativeCreativePaths>, autopsy: ReturnType<typeof candidateHFailureAutopsy>) {
  const deployable = Object.entries(search)
    .filter(([, v]) => v.deployability?.deployable)
    .map(([id, v]) => ({
      id,
      family: v.family,
      roi: v.fullSummary?.actionableRoi,
      recent14: v.recent14Day?.actionableRoi,
      recent7: v.recent7Day?.actionableRoi,
      recent3: v.recent3Day?.actionableRoi,
      playsKept: v.playsKept,
      playsRemoved: v.playsRemoved,
      flag: v.potentialFlag,
    }))
    .sort((a, b) => (b.roi ?? -999) - (a.roi ?? -999));
  const topBlockers = Object.entries(search)
    .flatMap(([id, v]) => (v.deployability?.blockers ?? []).map((blocker: string) => ({ id, blocker })))
    .reduce<Record<string, number>>((acc, x) => {
      acc[x.blocker] = (acc[x.blocker] ?? 0) + 1;
      return acc;
    }, {});
  const worstRecentBuckets = autopsy.recentCollapseBuckets.slice(0, 8).map((x) => ({
    bucket: x.bucket,
    last7Plays: x.last7.plays,
    last7Roi: x.last7.roi,
    last7Units: x.last7.units,
    last3Plays: x.last3.plays,
    last3Roi: x.last3.roi,
    last3Units: x.last3.units,
  }));
  const probabilityDeployable = alternatives.probabilityOnlyCalibration.deployability.deployableForProbabilityDisplayOnly;
  const recommended = deployable[0] ?? null;
  const isTotalsSpecific = recommended?.id?.includes("mlb_totals") || recommended?.flag === "MARKET_AWARE_MLB_TOTAL_ENABLED";
  const isBestAngleOnly = recommended?.flag === "MARKET_AWARE_BEST_ANGLE_FILTER_ENABLED";
  const isLeanOrNoPlay = recommended?.flag === "MARKET_AWARE_LEAN_FILTER_ENABLED" || recommended?.flag === "MARKET_AWARE_NO_PLAY_FILTER_ENABLED";
  return {
    finalAnswer: deployable.length > 0
      ? isTotalsSpecific
        ? "E_Deploy_MLB_totals_specific_rule_only"
        : isBestAngleOnly
          ? "C_Deploy_Best_Angle_filter_only"
          : isLeanOrNoPlay
            ? "D_Deploy_Lean_or_No_Play_filter_only"
            : "A_Deploy_safe_scoped_rule_today"
      : probabilityDeployable
        ? "B_Deploy_probability_calibration_only"
        : "F_Deploy_no_production_change",
    deployableRules: deployable,
    recommendedRule: recommended,
    enableNow: false,
    requiresReviewBeforeAnyFlagChange: true,
    keepProductionFlags: {
      MARKET_INTELLIGENCE_V2_ENABLED: true,
      MARKET_INTELLIGENCE_V2_UI_ENABLED: true,
      MARKET_AWARE_ENGINE_ENABLED: false,
      LEGACY_MARKET_SIGNAL_GRADE_INFLUENCE_ENABLED: false,
    },
    exactBlockerIfNoRule: deployable.length > 0 ? null : {
      blockerCounts: topBlockers,
      recentCollapseBuckets: worstRecentBuckets,
      note: "The bounded search did not find a rule that clears all deployment safety gates without review.",
    },
    shortestPathToSafeDeployableRule: {
      dataMissing: [
        "More post-v2 settled MLB rows with live Market Read labels, especially totals.",
        "More WNBA settled rows before any WNBA pick/grade engine scope.",
        "Consistent best-available-price at lock across historical cards if price grading is desired.",
      ],
      rowsNeeded: "At least 150-200 additional settled MLB ML/total rows with v2 snapshots, plus 50+ WNBA rows per market before WNBA engine use.",
      promoteFirstMarket: "MLB moneyline before MLB totals if a filter passes, because recent totals are the clearest damage bucket.",
      acceleration: [
        "Keep v2 collection running for every slate cycle/pregame sweep.",
        "Backfill Playbook/odds history where timestamps are available.",
        "Add/export historical odds with book-level prices if possible; this helps CLV and best-price validation fastest.",
      ],
    },
  };
}

function erfApprox(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erfApprox(x / Math.SQRT2));
}

function totalProbabilityFromProjection(projection: number, line: number, side: string): number {
  const over = normalCdf((projection - line) / 4.5);
  const p = side === "under" ? 1 - over : over;
  return Math.min(0.99, Math.max(0.01, p));
}

function lineBucket(line: number | null): string {
  if (line === null) return "unknown";
  if (line <= 7.5) return "le_7_5";
  if (line === 8) return "eq_8";
  if (line === 8.5) return "eq_8_5";
  return "ge_9";
}

function recentSummarySet(preds: Prediction[]) {
  return {
    last14: recentWindowSummary(preds, 14, "mlb"),
    last7: recentWindowSummary(preds, 7, "mlb"),
    last3: recentWindowSummary(preds, 3, "mlb"),
  };
}

function predictionByFavoriteDog(preds: Prediction[]) {
  return {
    favorite: subset(preds.filter((p) => p.price !== null && p.price < 0)),
    dog: subset(preds.filter((p) => p.price !== null && p.price > 0)),
  };
}

function modelDataset(rows: ReconstructedRow[]) {
  const markets = ["mlb_moneyline", "mlb_total", "wnba_moneyline", "wnba_total", "wnba_spread"];
  return Object.fromEntries(markets.map((k) => {
    const xs = rows.filter((r) => bucket(r) === k);
    return [k, {
      rows: xs.length,
      eligibleForModelTraining: xs.filter((r) => !r.evidenceGroups.H_unrecoverable_safely && r.result !== "push").length,
      dateRange: [xs.map((r) => r.date).sort()[0] ?? null, xs.map((r) => r.date).sort().at(-1) ?? null],
      withProjectedTotal: xs.filter((r) => r.projectedTotal !== null).length,
      withProjectedMargin: xs.filter((r) => r.projectedMarginHome !== null).length,
      withMarketNoVig: xs.filter((r) => r.pMarketNoVigAtLock !== null).length,
      withMovement: xs.filter((r) => r.movementDirectionRelativeToPick !== null).length,
      withPlaybook: xs.filter((r) => r.playbookFinalPregameConsensus !== null).length,
      withDk: xs.filter((r) => r.dkSplit !== null).length,
      withCirca: xs.filter((r) => r.circaSplit !== null).length,
      withClv: xs.filter((r) => r.beatClosingLine !== null).length,
      gradeCounts: Object.fromEntries(["best_angle", "lean", "other", "no_play"].map((g) => [g, xs.filter((r) => r.tier === g).length])),
      sampleRows: xs.slice(0, 5).map((r) => ({
        id: r.id,
        date: r.date,
        matchup: r.matchup,
        officialPick: r.side,
        officialProbability: r.pCurrentProduction,
        projectedTotal: r.projectedTotal,
        projectedMarginHome: r.projectedMarginHome,
        lockedLine: r.line,
        lockedPrice: r.price,
        marketNoVigAtLock: r.pMarketNoVigAtLock,
        firstTrackedLine: r.firstTrackedLineBeforeLock,
        lastTrackedLine: r.lastLineBeforeLock,
        movement: r.movementDirectionRelativeToPick,
        v2MarketRead: normalizeMarketReadLabel(r.v2LabelReconstructed),
        playbookConsensus: r.playbookFinalPregameConsensus,
        result: r.result,
        grade: r.tier,
        lockTimestamp: r.asOf,
      })),
    }];
  }));
}

function projectionCandidateSummaryV2(rows: ReconstructedRow[], name: string, projections: Map<number, number>) {
  const preds: Prediction[] = [];
  const errors: number[] = [];
  for (const r of rows) {
    const projection = projections.get(r.id);
    if (projection === undefined || r.actualTotal === null || r.line === null) continue;
    errors.push(projection - r.actualTotal);
    const side = projectionSide(projection, r.line, r.side);
    const resolved = totalResultFor(r, side);
    const probability = totalProbabilityFromProjection(projection, r.line, side);
    preds.push({
      row: r,
      id: name,
      side,
      probability,
      price: resolved.price,
      outcome: resolved.outcome,
      result: resolved.result,
      tier: r.tier,
      reason: name,
    });
  }
  const abs = errors.map(Math.abs);
  return {
    n: preds.length,
    totalMae: abs.reduce((s, v) => s + v, 0) / Math.max(1, abs.length),
    totalRmse: Math.sqrt(errors.reduce((s, v) => s + v * v, 0) / Math.max(1, errors.length)),
    bias: errors.reduce((s, v) => s + v, 0) / Math.max(1, errors.length),
    sidePerformance: predictionSummary(preds),
    logLoss: predictionSummary(preds).logLoss,
    brier: predictionSummary(preds).brier,
    bestAnglePerformance: subset(preds.filter((p) => p.tier === "best_angle")),
    leanPerformance: subset(preds.filter((p) => p.tier === "lean")),
    changedSides: preds.filter((p) => p.side !== p.row.side).length,
    changedSidePerformance: subset(preds.filter((p) => p.side !== p.row.side)),
    unchangedSidePerformance: subset(preds.filter((p) => p.side === p.row.side)),
    recent: recentSummarySet(preds),
    exactCardsChanged: changedCards(productionPredictions(rows), preds),
  };
}

function mlbTotalProjectionModelImprovement(rows: ReconstructedRow[]) {
  const totals = rows.filter((r) => r.sport === "mlb" && r.market === "total" && r.projectedTotal !== null && r.actualTotal !== null && r.line !== null);
  const mapFor = (fn: (r: ReconstructedRow) => number | null) => new Map(totals.map((r) => [r.id, fn(r)]).filter((x): x is [number, number] => x[1] !== null));
  const learned = new Map<number, number>();
  const bias = new Map<number, number>();
  const bucketLine = new Map<number, number>();
  const bucketPick = new Map<number, number>();
  const recentShrink = new Map<number, number>();
  const dates = [...new Set(totals.map((r) => r.date))].sort();
  for (const d of dates) {
    const train = totals.filter((r) => r.date < d);
    const test = totals.filter((r) => r.date === d);
    const weights = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1];
    const bestW = weights.map((w) => ({
      w,
      mae: train.length < 30 ? Number.POSITIVE_INFINITY : train.reduce((s, r) => s + Math.abs(((r.projectedTotal ?? 0) * (1 - w) + (r.line ?? 0) * w) - (r.actualTotal ?? 0)), 0) / train.length,
    })).sort((a, b) => a.mae - b.mae)[0]?.w ?? 0;
    const globalBias = train.length < 30 ? 0 : train.reduce((s, r) => s + ((r.actualTotal ?? 0) - (r.projectedTotal ?? 0)), 0) / train.length;
    for (const r of test) {
      const lb = lineBucket(r.line);
      const byLine = train.filter((x) => lineBucket(x.line) === lb);
      const byPick = train.filter((x) => x.side === r.side);
      const lineBias = byLine.length >= 15 ? byLine.reduce((s, x) => s + ((x.actualTotal ?? 0) - (x.projectedTotal ?? 0)), 0) / byLine.length : globalBias;
      const pickBias = byPick.length >= 25 ? byPick.reduce((s, x) => s + ((x.actualTotal ?? 0) - (x.projectedTotal ?? 0)), 0) / byPick.length : globalBias;
      const recent = train.filter((x) => x.date >= (() => {
        const dt = new Date(`${d}T12:00:00Z`);
        dt.setUTCDate(dt.getUTCDate() - 6);
        return dt.toISOString().slice(0, 10);
      })());
      const recentBias = recent.length >= 20 ? recent.reduce((s, x) => s + ((x.actualTotal ?? 0) - (x.projectedTotal ?? 0)), 0) / recent.length : globalBias;
      learned.set(r.id, (r.projectedTotal ?? 0) * (1 - bestW) + (r.line ?? 0) * bestW);
      bias.set(r.id, (r.projectedTotal ?? 0) + globalBias);
      bucketLine.set(r.id, (r.projectedTotal ?? 0) + lineBias);
      bucketPick.set(r.id, (r.projectedTotal ?? 0) + pickBias);
      recentShrink.set(r.id, ((r.projectedTotal ?? 0) + recentBias) * 0.7 + (r.line ?? 0) * 0.3);
    }
  }
  const candidates = {
    rawOddSphereProjection: mapFor((r) => r.projectedTotal),
    marketTotalAtLock: mapFor((r) => r.line),
    model90Market10: mapFor((r) => (r.projectedTotal ?? 0) * 0.9 + (r.line ?? 0) * 0.1),
    model80Market20: mapFor((r) => (r.projectedTotal ?? 0) * 0.8 + (r.line ?? 0) * 0.2),
    model70Market30: mapFor((r) => (r.projectedTotal ?? 0) * 0.7 + (r.line ?? 0) * 0.3),
    model60Market40: mapFor((r) => (r.projectedTotal ?? 0) * 0.6 + (r.line ?? 0) * 0.4),
    model50Market50: mapFor((r) => (r.projectedTotal ?? 0) * 0.5 + (r.line ?? 0) * 0.5),
    learnedChronologicalBlend: learned,
    biasCorrectedProjection: bias,
    bucketCorrectionByMarketTotal: bucketLine,
    bucketCorrectionByOverUnderPick: bucketPick,
    recentFormShrinkageCorrection: recentShrink,
  };
  const results = Object.fromEntries(Object.entries(candidates).map(([name, projections]) => [name, projectionCandidateSummaryV2(totals, name, projections)]));
  return {
    candidates: results,
    bestByMae: Object.entries(results).sort((a, b) => a[1].totalMae - b[1].totalMae)[0],
    bestBySideRoi: Object.entries(results).sort((a, b) => b[1].sidePerformance.actionableRoi - a[1].sidePerformance.actionableRoi)[0],
    interpretation: "Market anchoring can improve projected-total MAE while still hurting side ROI when it pulls projections toward the betting line and reduces the model/line separation used to choose Over/Under.",
  };
}

function chronologicalSegmentProbability(rows: ReconstructedRow[], id: string, segment: (r: ReconstructedRow) => string, mode: "model" | "model_market"): Prediction[] {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const out: Prediction[] = [];
  for (const d of dates) {
    for (const r of rows.filter((x) => x.date === d)) {
      const prior = rows.filter((x) => x.date < d);
      const trainSeg = prior.filter((x) => segment(x) === segment(r));
      const train = trainSeg.length >= 35 ? trainSeg : prior;
      let p = r.pCurrentProduction;
      let reason = "insufficient training";
      if (train.length >= 45) {
        const names = mode === "model_market" ? ["logit_model", "logit_market", "market_missing"] : ["logit_model"];
        const feat = (x: ReconstructedRow): Record<string, number> => ({
          logit_model: logit(x.pCurrentProduction),
          logit_market: x.pMarketNoVigAtLock === null ? 0 : logit(x.pMarketNoVigAtLock),
          market_missing: x.pMarketNoVigAtLock === null ? 1 : 0,
        });
        const model = fitRidgeLogistic({
          rows: train.map(feat),
          outcomes: train.map((x) => x.outcome),
          featureNames: names,
          lambda: 2,
          iterations: 1000,
          learningRate: 0.04,
        });
        p = predictRidgeLogistic(model, feat(r));
        reason = `${id} chronological`;
      }
      out.push(basePrediction(r, id, p, reason));
    }
  }
  return out;
}

function mlProbabilityReport(preds: Prediction[], baseline: Prediction[]) {
  const summary = predictionSummary(preds);
  return {
    summary,
    calibration: calibrationSlope(preds),
    reliability: reliability(preds),
    favoriteDog: predictionByFavoriteDog(preds),
    bestAngle: subset(preds.filter((p) => p.tier === "best_angle")),
    lean: subset(preds.filter((p) => p.tier === "lean")),
    recent: recentSummarySet(preds),
    deltasVsProduction: {
      logLoss: summary.logLoss - predictionSummary(baseline).logLoss,
      brier: summary.brier - predictionSummary(baseline).brier,
      roi: summary.actionableRoi - predictionSummary(baseline).actionableRoi,
    },
  };
}

function mlbMoneylineProbabilityImprovement(rows: ReconstructedRow[]) {
  const ml = rows.filter((r) => r.sport === "mlb" && r.market === "moneyline");
  const baseline = productionPredictions(ml);
  const candidates: Record<string, Prediction[]> = {
    currentProductionProbability: baseline,
    marketOnlyNoVigProbability: predictionsWithProbability(ml, "ml_market_only", (r) => r.pMarketNoVigAtLock ?? implied(r.price) ?? r.pCurrentProduction),
    model90Market10: predictionsWithProbability(ml, "ml_90_10", (r) => blend(r.pCurrentProduction, r.pMarketNoVigAtLock, 0.1)),
    model80Market20: predictionsWithProbability(ml, "ml_80_20", (r) => blend(r.pCurrentProduction, r.pMarketNoVigAtLock, 0.2)),
    model70Market30: predictionsWithProbability(ml, "ml_70_30", (r) => blend(r.pCurrentProduction, r.pMarketNoVigAtLock, 0.3)),
    model60Market40: predictionsWithProbability(ml, "ml_60_40", (r) => blend(r.pCurrentProduction, r.pMarketNoVigAtLock, 0.4)),
    model50Market50: predictionsWithProbability(ml, "ml_50_50", (r) => blend(r.pCurrentProduction, r.pMarketNoVigAtLock, 0.5)),
    learnedChronologicalBlend: chronologicalMarketBlend(ml, false),
    logisticStackModelMarket: platt(ml, "marketBlend"),
    betaCalibration: betaCalibrationOnBase(ml, "ml_beta", (r) => r.pCurrentProduction),
    favoriteDogCalibration: chronologicalSegmentProbability(ml, "ml_favorite_dog_calibration", (r) => r.price !== null && r.price < 0 ? "favorite" : "dog", "model_market"),
    homeAwayCalibration: chronologicalSegmentProbability(ml, "ml_home_away_calibration", (r) => r.side, "model_market"),
    oddsBucketCalibration: chronologicalSegmentProbability(ml, "ml_odds_bucket_calibration", (r) => oddsBucket(r.price), "model_market"),
  };
  const results = Object.fromEntries(Object.entries(candidates).map(([name, preds]) => [name, mlProbabilityReport(preds, baseline)]));
  return {
    candidates: results,
    bestByLogLoss: Object.entries(results).sort((a, b) => a[1].summary.logLoss - b[1].summary.logLoss)[0],
    bestByBrier: Object.entries(results).sort((a, b) => a[1].summary.brier - b[1].summary.brier)[0],
  };
}

function sidePredictionCandidateSummary(name: string, baseline: Prediction[], preds: Prediction[]) {
  const switched = preds.filter((p) => p.side !== p.row.side);
  const unchanged = preds.filter((p) => p.side === p.row.side);
  return {
    name,
    summary: predictionSummary(preds),
    sideChanges: switched.length,
    changedSidePerformance: subset(switched),
    unchangedSidePerformance: subset(unchanged),
    recent: recentSummarySet(preds),
    exactCardsChanged: changedCards(baseline, preds),
    deployable: switched.length >= 20 && (subset(switched).roi ?? -999) > (subset(unchanged).roi ?? 999) && (recentWindowSummary(preds, 7, "mlb")?.actionableRoi ?? -999) > -0.05,
  };
}

function sidePredictionImprovement(rows: ReconstructedRow[], mlCalibrated: Prediction[], totalProjection: ReturnType<typeof mlbTotalProjectionModelImprovement>) {
  const ml = rows.filter((r) => r.sport === "mlb" && r.market === "moneyline");
  const totals = rows.filter((r) => r.sport === "mlb" && r.market === "total" && r.line !== null);
  const mlP = byIdProbability(mlCalibrated);
  const mlBaseline = productionPredictions(ml);
  const totalBaseline = productionPredictions(totals);
  const mlSide = (rule: string): Prediction[] => ml.map((r) => {
    const p = mlP.get(r.id) ?? r.pCurrentProduction;
    const marketP = r.pMarketNoVigAtLock ?? implied(r.price) ?? p;
    let useP = p;
    if (rule === "market_only_side") useP = marketP;
    const currentEv = expectedValuePerDollar(useP, r.price) ?? -999;
    const oppEv = expectedValuePerDollar(1 - useP, r.oppositePrice) ?? -999;
    const switchSide = r.oppositeOutcome !== null && r.oppositePrice !== null && (
      (rule === "calibrated_probability_side" && useP < 0.5) ||
      (rule === "market_only_side" && useP < 0.5) ||
      (rule === "calibrated_ev_side" && oppEv > currentEv + 0.01)
    );
    if (!switchSide) return basePrediction(r, rule, useP, "current side");
    return {
      row: r,
      id: rule,
      side: r.oppositeSide,
      probability: 1 - useP,
      price: r.oppositePrice,
      outcome: r.oppositeOutcome,
      result: r.oppositeOutcome === 1 ? "win" : "loss",
      tier: r.tier,
      reason: rule,
    };
  });
  const projectionMaps = totalProjection.candidates;
  const totalSide = (name: string): Prediction[] => {
    const candidate = projectionMaps[name];
    const changed = new Map<number, string>((candidate?.exactCardsChanged ?? []).map((c: any) => [c.id, c.candidateSide]));
    return totals.map((r) => {
      const side = changed.get(r.id) ?? r.side;
      const resolved = totalResultFor(r, side);
      return {
        row: r,
        id: name,
        side,
        probability: r.pCurrentProduction,
        price: resolved.price,
        outcome: resolved.outcome,
        result: resolved.result,
        tier: r.tier,
        reason: name,
      };
    });
  };
  const totalCalibratedProjection = totalSide("bucketCorrectionByMarketTotal");
  const totalMarketOnly = totalSide("marketTotalAtLock");
  return {
    mlbMoneyline: {
      currentSide: sidePredictionCandidateSummary("currentSide", mlBaseline, mlBaseline),
      calibratedProbabilitySide: sidePredictionCandidateSummary("calibratedProbabilitySide", mlBaseline, mlSide("calibrated_probability_side")),
      marketOnlySide: sidePredictionCandidateSummary("marketOnlySide", mlBaseline, mlSide("market_only_side")),
      calibratedEvSide: sidePredictionCandidateSummary("calibratedEvSide", mlBaseline, mlSide("calibrated_ev_side")),
    },
    mlbTotals: {
      currentSide: sidePredictionCandidateSummary("currentSide", totalBaseline, totalBaseline),
      calibratedProjectionSide: sidePredictionCandidateSummary("calibratedProjectionSide", totalBaseline, totalCalibratedProjection),
      marketOnlySide: sidePredictionCandidateSummary("marketOnlySide", totalBaseline, totalMarketOnly),
    },
  };
}

function recentMlbLossAutopsy(rows: ReconstructedRow[], calibrated: Prediction[], totalProjection: ReturnType<typeof mlbTotalProjectionModelImprovement>) {
  const pMap = byIdProbability(calibrated);
  const mlb = rows.filter((r) => r.sport === "mlb" && (r.market === "moneyline" || r.market === "total"));
  const maxDate = maxDateForRows(mlb);
  const since = (days: number) => {
    if (!maxDate) return "";
    const d = new Date(`${maxDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (days - 1));
    return d.toISOString().slice(0, 10);
  };
  const bestTotalProjection = totalProjection.candidates.bucketCorrectionByMarketTotal;
  const explain = (r: ReconstructedRow) => {
    const p = pMap.get(r.id) ?? r.pCurrentProduction;
    const calibratedProjectionChanged = r.market === "total"
      ? (bestTotalProjection.exactCardsChanged as any[]).find((c) => c.id === r.id)
      : null;
    const gradeWouldChange = r.market === "total" && (evFor(r, p) ?? 0) <= 0 && r.tier !== "no_play";
    const sideWouldChange = Boolean(calibratedProjectionChanged);
    return {
      id: r.id,
      date: r.date,
      matchup: r.matchup,
      market: r.market,
      pick: r.side,
      line: r.line,
      price: r.price,
      result: r.result,
      productionProbability: r.pCurrentProduction,
      projectedTotal: r.projectedTotal,
      projectedMarginHome: r.projectedMarginHome,
      calibratedProbability: p,
      calibratedProjection: r.market === "total" && r.projectedTotal !== null && r.line !== null
        ? (r.projectedTotal + r.line) / 2
        : null,
      marketNoVig: r.pMarketNoVigAtLock,
      marketRead: normalizeMarketReadLabel(r.v2LabelReconstructed),
      lineMovement: r.movementDirectionRelativeToPick,
      grade: r.tier,
      candidateWouldChange: {
        projection: r.market === "total" && r.projectedTotal !== null,
        probability: Math.abs(p - r.pCurrentProduction) >= 0.005,
        side: sideWouldChange,
        grade: gradeWouldChange,
        action: gradeWouldChange,
      },
    };
  };
  const losses3 = mlb.filter((r) => r.date >= since(3) && r.result === "loss").map(explain);
  const losses7 = mlb.filter((r) => r.date >= since(7) && r.result === "loss").map(explain);
  const summarize = (xs: ReturnType<typeof explain>[]) => ({
    losses: xs.length,
    badSideSelectionLikely: xs.filter((x) => x.candidateWouldChange.side).length,
    badTotalProjectionLikely: xs.filter((x) => x.market === "total" && x.candidateWouldChange.projection).length,
    overconfidenceLikely: xs.filter((x) => x.productionProbability >= 0.58).length,
    badPricingOrMissingClv: xs.filter((x) => x.marketRead === "Projection-Led" && x.lineMovement === null).length,
    gradeInflationLikely: xs.filter((x) => x.grade === "best_angle" || x.grade === "lean").length,
  });
  return { last3Days: { losses: losses3, summary: summarize(losses3) }, last7Days: { losses: losses7, summary: summarize(losses7) } };
}

function modelImprovementPromotionDecision(args: {
  totalProjection: ReturnType<typeof mlbTotalProjectionModelImprovement>;
  mlProbability: ReturnType<typeof mlbMoneylineProbabilityImprovement>;
  side: ReturnType<typeof sidePredictionImprovement>;
}) {
  const totalRaw = args.totalProjection.candidates.rawOddSphereProjection;
  const totalBestMae = args.totalProjection.bestByMae;
  const mlBase = args.mlProbability.candidates.currentProductionProbability;
  const mlBest = args.mlProbability.bestByLogLoss;
  const mlImprovesProb = mlBest[1].summary.logLoss < mlBase.summary.logLoss && mlBest[1].summary.brier <= mlBase.summary.brier;
  const totalProjectionDeployable =
    totalBestMae[1].totalMae < totalRaw.totalMae &&
    totalBestMae[1].sidePerformance.actionableRoi >= totalRaw.sidePerformance.actionableRoi - 0.02 &&
    (totalBestMae[1].recent.last7?.actionableRoi ?? -999) > -0.1;
  const mlSideDeployable = Object.values(args.side.mlbMoneyline).some((v) => v.deployable);
  const totalSideDeployable = Object.values(args.side.mlbTotals).some((v) => v.deployable);
  if (totalProjectionDeployable) {
    return {
      finalAnswer: "A_Deploy_MLB_total_projection_calibration",
      recommendedCandidate: totalBestMae[0],
      enableNow: false,
      flag: "MARKET_AWARE_MLB_TOTAL_PROJECTION_ANCHOR_ENABLED",
      reason: "Best total projection candidate improves MAE without materially harming betting side ROI in the safety check.",
    };
  }
  if (mlImprovesProb) {
    return {
      finalAnswer: "D_Deploy_MLB_ML_probability_calibration",
      recommendedCandidate: mlBest[0],
      enableNow: false,
      flag: "MARKET_AWARE_MLB_ML_PROBABILITY_BLEND_ENABLED",
      reason: "ML probability calibration improves log loss and Brier without changing sides, locked rows, or grades.",
    };
  }
  if (totalSideDeployable) {
    return {
      finalAnswer: "C_Deploy_MLB_total_side_calibration",
      recommendedCandidate: Object.entries(args.side.mlbTotals).find(([, v]) => v.deployable)?.[0] ?? null,
      enableNow: false,
      flag: "MARKET_AWARE_MLB_TOTAL_SIDE_CALIBRATION_ENABLED",
      reason: "A total side candidate passed changed-side performance checks.",
    };
  }
  if (mlSideDeployable) {
    return {
      finalAnswer: "E_Deploy_MLB_ML_side_calibration",
      recommendedCandidate: Object.entries(args.side.mlbMoneyline).find(([, v]) => v.deployable)?.[0] ?? null,
      enableNow: false,
      flag: "MARKET_AWARE_MLB_ML_SIDE_CALIBRATION_ENABLED",
      reason: "A moneyline side candidate passed changed-side performance checks.",
    };
  }
  return {
    finalAnswer: "G_Deploy_narrow_safety_filter_only_because_model_improvement_paths_failed",
    recommendedCandidate: "D_mlb_totals_only_ev_gt_0",
    enableNow: false,
    flag: "MARKET_AWARE_NO_PLAY_FILTER_ENABLED + MARKET_AWARE_MLB_TOTAL_ENABLED",
    reason: "Projection and side-change candidates did not beat safety criteria; the only deployable improvement from current data remains MLB totals EV action selection.",
  };
}

function todayMlProbabilityCalibrationImpact(today: Awaited<ReturnType<typeof todaySlateBeforeAfter>>, weight = 0.5) {
  const cards = today.cards
    .filter((c) => c.market === "moneyline")
    .map((c) => {
      const market = c.marketProbability;
      const calibrated = market === null ? c.currentProbability : blend(c.currentProbability, market, weight);
      return {
        id: c.id,
        matchup: c.matchup,
        market: c.market,
        pick: c.currentPick,
        line: c.currentLine,
        price: c.currentPrice,
        currentProbability: c.currentProbability,
        marketProbability: market,
        calibratedProbability: calibrated,
        probabilityDelta: calibrated - c.currentProbability,
        currentGrade: c.currentGrade,
        proposedGrade: c.currentGrade,
        pickChanged: false,
        gradeChanged: false,
        reason: market === null ? "market_probability_unavailable_keep_current" : `50_50_model_market_probability_blend`,
      };
    });
  return {
    candidate: "MLB moneyline 50% model / 50% market probability calibration",
    totalMlbMoneylineCards: cards.length,
    probabilitiesChanged: cards.filter((c) => Math.abs(c.probabilityDelta) >= 0.005).length,
    picksChanged: 0,
    gradesChanged: 0,
    bestAnglesChanged: 0,
    leansChanged: 0,
    noPlaysAdded: 0,
    examples: cards.filter((c) => Math.abs(c.probabilityDelta) >= 0.005).slice(0, 20),
  };
}

type MlDisagreementTreatment = {
  id: string;
  description: string;
  flag: string | null;
  apply: (row: ReconstructedRow, ctx: {
    pCal: number;
    oppP: number;
    prodEv: number | null;
    oppEv: number | null;
    crossUnder50: boolean;
  }) => {
    side: string | null;
    probability: number;
    price: number | null;
    outcome: 0 | 1 | null;
    result: Result;
    tier: ReconstructedRow["tier"];
    action: "keep" | "warn" | "demote" | "no_play" | "flip";
    reason: string;
  };
};

function mlbMlDisagreementRows(rows: ReconstructedRow[]) {
  return rows
    .filter((r) => r.sport === "mlb" && r.market === "moneyline")
    .map((r) => {
      const market = r.pMarketNoVigAtLock ?? implied(r.price) ?? r.pCurrentProduction;
      const pCal = blend(r.pCurrentProduction, market, 0.5);
      const oppP = 1 - pCal;
      const prodEv = expectedValuePerDollar(pCal, r.price);
      const oppEv = expectedValuePerDollar(oppP, r.oppositePrice);
      return {
        id: r.id,
        date: r.date,
        matchup: r.matchup,
        productionPick: r.side,
        productionProbability: r.pCurrentProduction,
        productionGrade: r.tier,
        productionPrice: r.price,
        oppositeSide: r.oppositeSide,
        oppositePrice: r.oppositePrice,
        marketNoVigProductionSide: market,
        marketNoVigOppositeSide: 1 - market,
        calibratedProbability: pCal,
        calibratedOppositeProbability: oppP,
        productionEv: prodEv,
        oppositeEv: oppEv,
        v2MarketReadLabel: normalizeMarketReadLabel(r.v2LabelReconstructed),
        lineMovement: r.movementDirectionRelativeToPick,
        favoriteDog: r.price !== null && r.price < 0 ? "favorite" : r.price !== null && r.price > 0 ? "dog" : "unknown",
        homeAway: r.side,
        oddsBucket: oddsBucket(r.price),
        result: r.result,
        productionOutcome: r.outcome,
        oppositeOutcome: r.oppositeOutcome,
        productionProfit: profit(r.price, r.result),
        oppositeProfit: r.oppositeOutcome === null ? null : profit(r.oppositePrice, r.oppositeOutcome === 1 ? "win" : "loss"),
        lockTimestamp: r.asOf,
        beatClosingLine: r.beatClosingLine,
        row: r,
      };
    });
}

function mlbMlTreatmentPredictions(rows: ReconstructedRow[], treatment: MlDisagreementTreatment): Prediction[] {
  return rows.filter((r) => r.sport === "mlb" && r.market === "moneyline").map((r) => {
    const market = r.pMarketNoVigAtLock ?? implied(r.price) ?? r.pCurrentProduction;
    const pCal = blend(r.pCurrentProduction, market, 0.5);
    const oppP = 1 - pCal;
    const prodEv = expectedValuePerDollar(pCal, r.price);
    const oppEv = expectedValuePerDollar(oppP, r.oppositePrice);
    const applied = treatment.apply(r, { pCal, oppP, prodEv, oppEv, crossUnder50: pCal < 0.5 });
    return {
      row: r,
      id: treatment.id,
      side: applied.side,
      probability: applied.probability,
      price: applied.price,
      outcome: applied.outcome,
      result: applied.result,
      tier: applied.tier,
      reason: `${applied.action}:${applied.reason}`,
    };
  });
}

function mlbMlDisagreementTreatments(): MlDisagreementTreatment[] {
  const keep = (id: string, description: string, probability: (r: ReconstructedRow, pCal: number) => number): MlDisagreementTreatment => ({
    id,
    description,
    flag: id === "A_baseline" ? null : "MARKET_AWARE_MLB_ML_PROBABILITY_BLEND_ENABLED",
    apply: (r, { pCal }) => ({
      side: r.side,
      probability: probability(r, pCal),
      price: r.price,
      outcome: r.outcome,
      result: r.result,
      tier: r.tier,
      action: pCal < 0.5 ? "warn" : "keep",
      reason: pCal < 0.5 ? "cross_under_50_warning_only" : "keep",
    }),
  });
  const noPlayWhen = (id: string, description: string, pred: (r: ReconstructedRow, pCal: number) => boolean): MlDisagreementTreatment => ({
    id,
    description,
    flag: "MARKET_AWARE_MLB_ML_DISAGREEMENT_NO_PLAY_ENABLED",
    apply: (r, { pCal }) => {
      const suppress = pred(r, pCal);
      return {
        side: r.side,
        probability: pCal,
        price: r.price,
        outcome: r.outcome,
        result: r.result,
        tier: suppress ? "no_play" : r.tier,
        action: suppress ? "no_play" : "keep",
        reason: suppress ? "cross_under_50_suppressed" : "keep",
      };
    },
  });
  const demoteWhen = (id: string, description: string, pred: (r: ReconstructedRow, pCal: number) => boolean): MlDisagreementTreatment => ({
    id,
    description,
    flag: "MARKET_AWARE_MLB_ML_DISAGREEMENT_DEMOTE_ENABLED",
    apply: (r, { pCal }) => {
      const demote = pred(r, pCal);
      const tier = !demote ? r.tier : r.tier === "best_angle" ? "lean" : r.tier === "lean" ? "no_play" : r.tier;
      return {
        side: r.side,
        probability: pCal,
        price: r.price,
        outcome: r.outcome,
        result: r.result,
        tier,
        action: demote && tier !== r.tier ? "demote" : "keep",
        reason: demote ? "cross_under_50_demote" : "keep",
      };
    },
  });
  const flipWhen = (id: string, description: string, pred: (r: ReconstructedRow, pCal: number, prodEv: number | null, oppEv: number | null) => boolean): MlDisagreementTreatment => ({
    id,
    description,
    flag: "MARKET_AWARE_MLB_ML_DISAGREEMENT_FLIP_ENABLED",
    apply: (r, { pCal, oppP, prodEv, oppEv }) => {
      const flip = pred(r, pCal, prodEv, oppEv) && r.oppositeOutcome !== null && r.oppositePrice !== null;
      return flip ? {
        side: r.oppositeSide,
        probability: oppP,
        price: r.oppositePrice,
        outcome: r.oppositeOutcome,
        result: r.oppositeOutcome === 1 ? "win" : "loss",
        tier: r.tier,
        action: "flip",
        reason: "cross_under_50_flip",
      } : {
        side: r.side,
        probability: pCal,
        price: r.price,
        outcome: r.outcome,
        result: r.result,
        tier: r.tier,
        action: "keep",
        reason: "keep",
      };
    },
  });
  const resistance = (r: ReconstructedRow) => normalizeMarketReadLabel(r.v2LabelReconstructed).includes("Resistance");
  const projectionOrResistance = (r: ReconstructedRow) => {
    const label = normalizeMarketReadLabel(r.v2LabelReconstructed);
    return label === "Projection-Led" || label.includes("Resistance");
  };
  return [
    keep("A_baseline", "Keep production pick and production probability.", (r) => r.pCurrentProduction),
    keep("B_display_calibrated_only_if_50plus", "Keep production pick; display calibrated probability only when it remains >= 50%.", (r, pCal) => pCal >= 0.5 ? pCal : r.pCurrentProduction),
    noPlayWhen("C_no_play_cross_under_50", "Suppress to No Play when calibrated probability falls below 50%.", (_r, pCal) => pCal < 0.5),
    demoteWhen("D_demote_cross_under_50", "Demote when calibrated probability falls below 50%.", (_r, pCal) => pCal < 0.5),
    flipWhen("E_flip_cross_under_50", "Flip when calibrated probability falls below 50%.", (_r, pCal) => pCal < 0.5),
    flipWhen("F_flip_cross_under_49", "Flip when calibrated probability falls below 49%.", (_r, pCal) => pCal < 0.49),
    flipWhen("G_flip_cross_under_48", "Flip when calibrated probability falls below 48%.", (_r, pCal) => pCal < 0.48),
    flipWhen("H_flip_cross_under_50_opp_ev_positive", "Flip when calibrated probability < 50% and opposite EV > 0.", (_r, pCal, _prodEv, oppEv) => pCal < 0.5 && (oppEv ?? -999) > 0),
    flipWhen("I_flip_cross_under_50_favorites", "Flip only cross-under-50 favorites.", (r, pCal) => pCal < 0.5 && r.price !== null && r.price < 0),
    flipWhen("J_flip_cross_under_50_dogs", "Flip only cross-under-50 dogs.", (r, pCal) => pCal < 0.5 && r.price !== null && r.price > 0),
    flipWhen("K_flip_cross_under_50_resistance", "Flip cross-under-50 only when v2 read is resistance.", (r, pCal) => pCal < 0.5 && resistance(r)),
    noPlayWhen("L_suppress_projection_or_resistance_cross_under_50", "Suppress cross-under-50 when v2 read is Projection-Led or Resistance.", (r, pCal) => pCal < 0.5 && projectionOrResistance(r)),
    demoteWhen("M_demote_cross_under_50_line_against", "Demote cross-under-50 only when line movement is against the production pick.", (r, pCal) => pCal < 0.5 && r.movementDirectionRelativeToPick === "resistance"),
    {
      id: "N_calibrated_ev_selector",
      description: "Choose production side if production EV > opposite EV; choose opposite if opposite EV is higher; No Play if neither EV > 0.",
      flag: "MARKET_AWARE_MLB_ML_EV_SELECTOR_ENABLED",
      apply: (r, { pCal, oppP, prodEv, oppEv }) => {
        if ((prodEv ?? -999) > (oppEv ?? -999) && (prodEv ?? -999) > 0) {
          return { side: r.side, probability: pCal, price: r.price, outcome: r.outcome, result: r.result, tier: r.tier, action: "keep", reason: "production_ev_best_positive" };
        }
        if (r.oppositeOutcome !== null && r.oppositePrice !== null && (oppEv ?? -999) > (prodEv ?? -999) && (oppEv ?? -999) > 0) {
          return { side: r.oppositeSide, probability: oppP, price: r.oppositePrice, outcome: r.oppositeOutcome, result: r.oppositeOutcome === 1 ? "win" : "loss", tier: r.tier, action: "flip", reason: "opposite_ev_best_positive" };
        }
        return { side: r.side, probability: pCal, price: r.price, outcome: r.outcome, result: r.result, tier: "no_play", action: "no_play", reason: "neither_side_positive_ev" };
      },
    },
    flipWhen("O1_flip_opp_ev_plus_2pct", "Flip when opposite EV exceeds production EV by 2%+.", (_r, _pCal, prodEv, oppEv) => (oppEv ?? -999) > (prodEv ?? 999) + 0.02),
    flipWhen("O2_flip_opp_ev_plus_4pct", "Flip when opposite EV exceeds production EV by 4%+.", (_r, _pCal, prodEv, oppEv) => (oppEv ?? -999) > (prodEv ?? 999) + 0.04),
  ];
}

function treatmentReport(preds: Prediction[], baseline: Prediction[]) {
  const changed = preds.filter((p) => p.side !== p.row.side && p.side !== null);
  const suppressed = preds.filter((p) => p.tier === "no_play" && p.row.tier !== "no_play");
  const gradesChanged = preds.filter((p) => p.tier !== p.row.tier).length;
  const unchanged = preds.filter((p) => p.side === p.row.side && !(p.tier === "no_play" && p.row.tier !== "no_play"));
  const summary = predictionSummary(preds);
  const base = predictionSummary(baseline);
  const deployBlockers: string[] = [];
  if (summary.actionableRoi <= base.actionableRoi && changed.length + suppressed.length > 0) deployBlockers.push("roi_not_improved");
  if (summary.logLoss > base.logLoss + 0.003) deployBlockers.push("log_loss_worsens");
  if (summary.brier > base.brier + 0.002) deployBlockers.push("brier_worsens");
  if ((recentWindowSummary(preds, 7, "mlb")?.actionableRoi ?? -999) < -0.05) deployBlockers.push("last_7_day_robustness_fails");
  if (changed.length > 0 && changed.length < 10) deployBlockers.push("changed_pick_sample_too_small");
  if (subset(preds.filter((p) => p.tier === "best_angle")).roi !== null && subset(baseline.filter((p) => p.tier === "best_angle")).roi !== null &&
      (subset(preds.filter((p) => p.tier === "best_angle")).roi ?? 0) < (subset(baseline.filter((p) => p.tier === "best_angle")).roi ?? 0) - 0.01) {
    deployBlockers.push("best_angle_roi_worsens");
  }
  return {
    totalRows: preds.length,
    totalPlays: preds.filter((p) => p.tier !== "no_play").length,
    picksChanged: changed.length,
    playsSuppressed: suppressed.length,
    gradesChanged,
    total: summary,
    changedPickPerformance: subset(changed),
    unchangedPickPerformance: subset(unchanged),
    suppressedPlayOriginalPerformance: subset(suppressed),
    bestAngle: subset(preds.filter((p) => p.tier === "best_angle")),
    lean: subset(preds.filter((p) => p.tier === "lean")),
    logLoss: summary.logLoss,
    brier: summary.brier,
    recent14: recentWindowSummary(preds, 14, "mlb"),
    recent7: recentWindowSummary(preds, 7, "mlb"),
    recent3: recentWindowSummary(preds, 3, "mlb"),
    exactHistoricalCardsChanged: changedCards(baseline, preds),
    deployability: {
      deployable: deployBlockers.length === 0,
      blockers: deployBlockers,
    },
  };
}

async function todayMlbMlDisagreementBeforeAfter() {
  const todayRaw = await loadTodayMlbPredictionRows();
  const byKey = new Map<string, PredictionRow>();
  for (const r of todayRaw.filter((x) => x.market === "moneyline")) {
    const k = `${r.sport}:${r.game_id}:${r.market}`;
    const prev = byKey.get(k);
    if (!prev || (time(asOfFor(r)) ?? 0) > (time(asOfFor(prev)) ?? 0) || ((time(asOfFor(r)) ?? 0) === (time(asOfFor(prev)) ?? 0) && r.id > prev.id)) byKey.set(k, r);
  }
  const rows = [...byKey.values()];
  const [lines, snapshots] = await Promise.all([
    loadLines([...new Set(rows.map((r) => r.game_id))]),
    loadSnapshots([...new Set(rows.map((r) => r.external_id))]),
  ]);
  return rows.map((r) => {
    const opp = oppositeSide(r.market, r.side ?? "");
    const oppRows = opp ? (lines.get(r.game_id) ?? [])
      .filter((l) => l.market_type === "moneyline" && l.side === opp)
      .filter((l) => beforeLockAndStart(lineTime(l), r))
      .sort((a, b) => (time(lineTime(b)) ?? 0) - (time(lineTime(a)) ?? 0)) : [];
    const oppPrice = oppRows[0]?.odds_american ?? null;
    const market = r.market_probability ?? implied(r.odds_american) ?? r.model_probability ?? 0.5;
    const pCal = blend(r.model_probability ?? 0.5, market, 0.5);
    const oppP = 1 - pCal;
    const prodEv = expectedValuePerDollar(pCal, r.odds_american);
    const oppEv = expectedValuePerDollar(oppP, oppPrice);
    const snap = selectSnapshot(snapshots.get(r.external_id) ?? [], r);
    const currentGrade = tier(r);
    const treatments = Object.fromEntries(mlbMlDisagreementTreatments().map((t) => {
      const fake = {
        ...({} as ReconstructedRow),
        side: r.side ?? "",
        price: r.odds_american,
        oppositeSide: opp ?? "",
        oppositePrice: oppPrice,
        oppositeOutcome: null,
        outcome: null,
        result: "pending" as Result,
        tier: currentGrade,
        pCurrentProduction: r.model_probability ?? 0.5,
        pMarketNoVigAtLock: market,
        v2LabelReconstructed: snap?.label ?? "Projection-Led",
        movementDirectionRelativeToPick: null,
      };
      const applied = t.apply(fake as unknown as ReconstructedRow, { pCal, oppP, prodEv, oppEv, crossUnder50: pCal < 0.5 });
      return [t.id, { action: applied.action, proposedSide: applied.side, proposedGrade: applied.tier, reason: applied.reason }];
    }));
    return {
      matchup: r.matchup,
      productionPick: r.side,
      productionProbability: r.model_probability,
      marketCalibratedProbability: pCal,
      oppositeCalibratedProbability: oppP,
      productionPrice: r.odds_american,
      oppositePrice: oppPrice,
      productionEv: prodEv,
      oppositeEv: oppEv,
      currentGrade,
      v2MarketReadLabel: snap?.label ?? null,
      crossUnder50: pCal < 0.5,
      treatmentRecommendations: treatments,
    };
  });
}

function mlbMlDisagreementBacktest(rows: ReconstructedRow[], today: Awaited<ReturnType<typeof todayMlbMlDisagreementBeforeAfter>>) {
  const ml = rows.filter((r) => r.sport === "mlb" && r.market === "moneyline");
  const dataset = mlbMlDisagreementRows(rows);
  const cross = dataset.filter((d) => d.calibratedProbability < 0.5);
  const baseline = mlbMlTreatmentPredictions(rows, mlbMlDisagreementTreatments()[0]);
  const by = (name: string, values: string[], fn: (d: ReturnType<typeof mlbMlDisagreementRows>[number]) => string | null) =>
    Object.fromEntries(values.map((v) => {
      const xs = cross.filter((d) => fn(d) === v);
      const preds = xs.map((d) => basePrediction(d.row, name, d.calibratedProbability, name));
      return [v, { n: xs.length, production: subset(preds), opposite: subset(xs.map((d) => ({
        row: d.row,
        id: name,
        side: d.oppositeSide,
        probability: d.calibratedOppositeProbability,
        price: d.oppositePrice,
        outcome: d.oppositeOutcome,
        result: d.oppositeOutcome === 1 ? "win" : d.oppositeOutcome === 0 ? "loss" : "",
        tier: d.row.tier,
        reason: name,
      } as Prediction))) }];
    }));
  const crossPreds = cross.map((d) => basePrediction(d.row, "cross_under_50_production", d.calibratedProbability, "cross"));
  const crossOppPreds: Prediction[] = cross.map((d) => ({
    row: d.row,
    id: "cross_under_50_opposite",
    side: d.oppositeSide,
    probability: d.calibratedOppositeProbability,
    price: d.oppositePrice,
    outcome: d.oppositeOutcome,
    result: d.oppositeOutcome === 1 ? "win" : d.oppositeOutcome === 0 ? "loss" : "",
    tier: d.row.tier,
    reason: "opposite",
  }));
  const treatments = Object.fromEntries(mlbMlDisagreementTreatments().map((t) => {
    const preds = mlbMlTreatmentPredictions(rows, t);
    const report = treatmentReport(preds, baseline);
    return [t.id, { description: t.description, flag: t.flag, ...report }];
  }));
  const deployable = Object.entries(treatments)
    .filter(([, v]) => v.deployability.deployable)
    .map(([id, v]) => ({ id, roi: v.total.actionableRoi, logLoss: v.logLoss, brier: v.brier, picksChanged: v.picksChanged, playsSuppressed: v.playsSuppressed }))
    .sort((a, b) => b.roi - a.roi);
  return {
    task1DisagreementDataset: {
      totalMlbMlRows: ml.length,
      rows: dataset,
    },
    task2CrossUnder50Audit: {
      totalMlbMlRows: ml.length,
      crossUnder50Rows: cross.length,
      crossUnder50Pct: cross.length / Math.max(1, ml.length),
      productionPickPerformance: subset(crossPreds),
      oppositeSidePerformance: subset(crossOppPreds),
      noPlayAvoidedWinsLosses: subset(crossPreds),
      bestAngleRowsAffected: cross.filter((d) => d.productionGrade === "best_angle").length,
      leanRowsAffected: cross.filter((d) => d.productionGrade === "lean").length,
      favoriteDogBreakdown: by("favorite_dog", ["favorite", "dog", "unknown"], (d) => d.favoriteDog),
      oddsBucketBreakdown: by("odds", ["favorite_worse_than_-180", "-180_to_-150", "-149_to_-130", "-129_to_-110", "-109_to_+109", "+110_to_+140", "+141_or_longer", "unknown"], (d) => d.oddsBucket),
      marketReadBreakdown: by("read", ["Strong Market Support", "Market Support", "Slight Market Support", "Projection-Led", "Slight Market Resistance", "Market Resistance", "Strong Market Resistance"], (d) => d.v2MarketReadLabel),
      lineMovementBreakdown: by("movement", ["support", "neutral", "resistance", "unknown"], (d) => d.lineMovement ?? "unknown"),
      recent14: recentWindowSummary(crossPreds, 14, "mlb"),
      recent7: recentWindowSummary(crossPreds, 7, "mlb"),
      recent3: recentWindowSummary(crossPreds, 3, "mlb"),
    },
    task3TreatmentFamilies: treatments,
    task4TodaySlateBeforeAfter: today,
    task5PromotionCriteria: {
      deployableTreatments: deployable,
      criteria: [
        "improves MLB ML W-L or ROI",
        "does not materially worsen log loss/Brier",
        "does not fail recent 7-day robustness",
        "does not rely on one or two lucky flips",
        "Best Angle ROI does not worsen",
        "rollback flag exists",
        "no locked/finished games rewritten",
      ],
    },
    task6FinalAnswer: deployable.length > 0 ? {
      answer: "review_required",
      bestTreatment: deployable[0],
      note: "At least one treatment passed mechanical gates; review exact cards before implementation.",
    } : {
      answer: "H_Do_not_use_this_signal_yet",
      reason: "No cross-under-50 treatment satisfied promotion criteria across ROI, probability quality, recent robustness, and sample-size safety.",
      blockers: Object.fromEntries(Object.entries(treatments).map(([id, v]) => [id, v.deployability.blockers])),
      closestSafeUse: "G_keep_production_picks_but_use_cross_under_50_as_internal_warning_only",
    },
  };
}


function modelImprovementSprint(rows: ReconstructedRow[], today: Awaited<ReturnType<typeof todaySlateBeforeAfter>>) {
  const dataset = modelDataset(rows);
  const totalProjection = mlbTotalProjectionModelImprovement(rows);
  const mlProbability = mlbMoneylineProbabilityImprovement(rows);
  const mlBestPreds = chronologicalMarketBlend(rows.filter((r) => r.sport === "mlb" && r.market === "moneyline"), false);
  const side = sidePredictionImprovement(rows, mlBestPreds, totalProjection);
  const recentLosses = recentMlbLossAutopsy(rows, mlBestPreds, totalProjection);
  const familyBest = {
    A_projectionAdjustment: {
      bestRule: totalProjection.bestByMae[0],
      result: totalProjection.bestByMae[1],
      deployable: modelImprovementPromotionDecision({ totalProjection, mlProbability, side }).finalAnswer === "A_Deploy_MLB_total_projection_calibration",
    },
    B_probabilityAdjustment: {
      bestRule: mlProbability.bestByLogLoss[0],
      result: mlProbability.bestByLogLoss[1],
      deployable: mlProbability.bestByLogLoss[1].summary.logLoss < mlProbability.candidates.currentProductionProbability.summary.logLoss,
    },
    C_sidePredictionAdjustment: {
      bestRule: "see sidePredictionImprovement",
      result: side,
      deployable: Object.values(side.mlbMoneyline).some((v) => v.deployable) || Object.values(side.mlbTotals).some((v) => v.deployable),
    },
    D_gradeRecalibration: {
      bestRule: "see boundedMarketAwareImprovementSearch.part3AlternativeCreativePaths",
      deployable: false,
      reason: "Grade recalibration is secondary and did not beat model-improvement candidates.",
    },
    E_evActionSelection: {
      bestRule: "D_mlb_totals_only_ev_gt_0",
      deployable: true,
      reason: "Useful as a safety layer, not the main model-improvement answer.",
    },
    F_bestAvailablePriceGrading: {
      bestRule: "best_available_price",
      deployable: false,
      reason: "Recoverable historical best-price sample is too small for a primary model improvement.",
    },
    G_recentFormShrinkage: {
      bestRule: "see probability/projection shrinkage candidates",
      deployable: false,
      reason: "Shrinkage improves probability quality in places but does not change W-L/ROI without a downstream rule.",
    },
    H_marketReadModifier: {
      bestRule: "v2 label as context",
      deployable: false,
      reason: "Current historical v2 label coverage is too small for pick/side changes.",
    },
    I_noPlaySafetyFilter: {
      bestRule: "D_mlb_totals_only_ev_gt_0",
      deployable: true,
      reason: "Narrow deployable safety layer if model-improvement flags are not approved.",
    },
  };
  const decision = modelImprovementPromotionDecision({ totalProjection, mlProbability, side });
  return {
    task1ModelingDatasets: dataset,
    task2MlbTotalProjectionImprovement: totalProjection,
    task3MlbMoneylineProbabilityImprovement: mlProbability,
    task4PredictionSideImprovement: side,
    task5GradeImprovementReference: {
      note: "Grade candidates are intentionally secondary in this sprint; see bounded search section for full grade and No Play filters.",
    },
    task6RecentMlbDamageAutopsy: recentLosses,
    task7DeployableCandidateFamilies: familyBest,
    task8FinalAnswer: {
      ...decision,
      currentSlateBeforeAfter: decision.finalAnswer === "D_Deploy_MLB_ML_probability_calibration"
        ? todayMlProbabilityCalibrationImpact(today, 0.5)
        : today.summary,
      implementationIfApproved: {
        featureFlag: decision.flag,
        rollback: `Set ${decision.flag}=false and redeploy; do not rewrite locked rows.`,
        lockedRowSafety: "Apply only during future prediction/card generation when locked_at is null; never mutate settled prediction_records.",
        tests: [
          "Unit test candidate probability/projection transform.",
          "Replay historical MLB ML/total rows and assert no post-lock evidence is used.",
          "Snapshot today's slate before/after and assert only approved fields change.",
        ],
        memberChanges: decision.finalAnswer.includes("probability")
          ? "MLB moneyline displayed/model confidence can be calibrated; picks and grades can remain unchanged for first rollout."
          : "Depends on approved flag; report recommends review before member-facing changes.",
        unchanged: ["tracking", "finished games", "locked rows", "WNBA", "FI", "World Cup", "NBA/NFL/NCAAF/NCAAB/NHL"],
      },
    },
  };
}

function clampProbability(p: number): number {
  return Math.min(0.99, Math.max(0.01, p));
}

function shrinkProbability(row: ReconstructedRow, k: number): number {
  const market = row.pMarketNoVigAtLock ?? implied(row.price);
  if (market === null) return row.pCurrentProduction;
  return clampProbability(market + k * (row.pCurrentProduction - market));
}

function logisticResidualProbability(row: ReconstructedRow, k: number): number {
  const market = row.pMarketNoVigAtLock ?? implied(row.price);
  if (market === null) return row.pCurrentProduction;
  return clampProbability(1 / (1 + Math.exp(-(logit(market) + k * (logit(row.pCurrentProduction) - logit(market))))));
}

function totalShrinkProjection(row: ReconstructedRow, k: number): number | null {
  if (row.projectedTotal === null || row.line === null) return null;
  return row.line + k * (row.projectedTotal - row.line);
}

function marketEdgeBucketMl(edge: number | null): string {
  if (edge === null) return "unknown";
  const pp = edge * 100;
  if (pp < 0) return "negative";
  if (pp < 2) return "market_plus_0_to_2pp";
  if (pp < 4) return "plus_2_to_4pp";
  if (pp < 6) return "plus_4_to_6pp";
  if (pp < 8) return "plus_6_to_8pp";
  return "plus_8pp_plus";
}

function totalEdgeBucket(edge: number | null): string {
  if (edge === null) return "unknown";
  const a = Math.abs(edge);
  if (a < 0.25) return "within_0_25";
  if (a < 0.5) return "0_25_to_0_5";
  if (a < 0.75) return "0_5_to_0_75";
  if (a < 1) return "0_75_to_1_0";
  return "1_0_plus";
}

function interpretation(actual: number | null, expected: number | null, n: number): string {
  if (actual === null || expected === null || n < 12) return "noise_or_too_small";
  const delta = actual - expected;
  if (Math.abs(delta) < 0.025) return "real";
  return delta > 0 ? "understated" : "overstated";
}

function mlCoreBucket(rows: ReconstructedRow[], label: string) {
  const preds = productionPredictions(rows);
  const actual = rows.length ? rows.reduce((s, r) => s + r.outcome, 0) / rows.length : null;
  const expected = rows.length ? rows.reduce((s, r) => s + r.pCurrentProduction, 0) / rows.length : null;
  const marketExpected = rows
    .map((r) => r.pMarketNoVigAtLock ?? implied(r.price))
    .filter((v): v is number => v !== null);
  const marketWinRate = marketExpected.length ? marketExpected.reduce((s, v) => s + v, 0) / marketExpected.length : null;
  const marketExpectedRoi = rows.length
    ? rows.reduce((s, r) => {
      const p = r.pMarketNoVigAtLock ?? implied(r.price);
      const ev = p === null ? 0 : expectedValuePerDollar(p, r.price) ?? 0;
      return s + ev;
    }, 0) / rows.length
    : null;
  const ll = rows.length ? rows.reduce((s, r) => s + logLoss(r.pCurrentProduction, r.outcome), 0) / rows.length : null;
  const br = rows.length ? rows.reduce((s, r) => s + brierScore(r.pCurrentProduction, r.outcome), 0) / rows.length : null;
  return {
    bucket: label,
    sampleSize: rows.length,
    production: subset(preds),
    marketImpliedBaseline: {
      expectedWinRate: marketWinRate,
      expectedRoiAtLockedPrice: marketExpectedRoi,
    },
    actualWinRate: actual,
    expectedWinRate: expected,
    calibrationError: actual !== null && expected !== null ? actual - expected : null,
    logLoss: ll,
    brier: br,
    edgeAssessment: interpretation(actual, expected, rows.length),
  };
}

function totalCoreBucket(rows: ReconstructedRow[], label: string) {
  const eligible = rows.filter((r) => r.actualTotal !== null && r.projectedTotal !== null && r.line !== null);
  const preds = productionPredictions(eligible);
  const rawErrors = eligible.map((r) => (r.projectedTotal ?? 0) - (r.actualTotal ?? 0));
  const marketErrors = eligible.map((r) => (r.line ?? 0) - (r.actualTotal ?? 0));
  const avgProjectionEdge = eligible.length
    ? eligible.reduce((s, r) => s + Math.abs((r.projectedTotal ?? 0) - (r.line ?? 0)), 0) / eligible.length
    : null;
  const modelAdvantage = rawErrors.length
    ? (marketErrors.reduce((s, v) => s + Math.abs(v), 0) - rawErrors.reduce((s, v) => s + Math.abs(v), 0)) / rawErrors.length
    : null;
  return {
    bucket: label,
    sampleSize: eligible.length,
    rawProjectedTotalMae: rawErrors.length ? rawErrors.reduce((s, v) => s + Math.abs(v), 0) / rawErrors.length : null,
    marketTotalMae: marketErrors.length ? marketErrors.reduce((s, v) => s + Math.abs(v), 0) / marketErrors.length : null,
    actualTotalBias: rawErrors.length ? rawErrors.reduce((s, v) => s + v, 0) / rawErrors.length : null,
    overUnderPerformance: subset(preds),
    avgProjectionEdgeRuns: avgProjectionEdge,
    modelMaeAdvantageVsMarket: modelAdvantage,
    edgeAssessment: eligible.length < 12 ? "noise_or_too_small" : modelAdvantage !== null && modelAdvantage > 0.15 ? "real" : modelAdvantage !== null && modelAdvantage < -0.15 ? "overstated" : "noise_or_too_small",
  };
}

function mlCoreFormulaPredictions(
  rows: ReconstructedRow[],
  id: string,
  probabilityFor: (row: ReconstructedRow) => number,
  changeSide: boolean,
): Prediction[] {
  return rows.map((r) => {
    const p = probabilityFor(r);
    if (!changeSide || p >= 0.5 || r.oppositeOutcome === null || r.oppositePrice === null) {
      return basePrediction(r, id, p, id);
    }
    return {
      row: r,
      id,
      side: r.oppositeSide,
      probability: 1 - p,
      price: r.oppositePrice,
      outcome: r.oppositeOutcome,
      result: r.oppositeOutcome === 1 ? "win" : "loss",
      tier: r.tier,
      reason: `${id}: side = p_final > 50`,
    };
  });
}

function learnedMlShrinkageMaps(rows: ReconstructedRow[]) {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const weights = [0, 0.1, 0.25, 0.5, 0.75, 1];
  const global = new Map<number, number>();
  const bucketed = new Map<number, number>();
  const logistic = new Map<number, number>();
  const logisticBucketed = new Map<number, number>();
  const bucketKey = (r: ReconstructedRow) => `${r.price !== null && r.price < 0 ? "favorite" : "dog"}:${oddsBucket(r.price)}:${r.side}:${normalizeMarketReadLabel(r.v2LabelReconstructed)}`;
  const chooseK = (train: ReconstructedRow[], fn: (r: ReconstructedRow, k: number) => number) => weights
    .map((k) => ({
      k,
      ll: train.length < 40 ? Number.POSITIVE_INFINITY : train.reduce((s, r) => s + logLoss(fn(r, k), r.outcome), 0) / train.length,
    }))
    .sort((a, b) => a.ll - b.ll)[0]?.k ?? 0;
  for (const d of dates) {
    const test = rows.filter((r) => r.date === d);
    const trainAll = rows.filter((r) => r.date < d && (r.pMarketNoVigAtLock !== null || implied(r.price) !== null));
    const gk = chooseK(trainAll, shrinkProbability);
    const lk = chooseK(trainAll, logisticResidualProbability);
    for (const r of test) {
      const trainBucket = trainAll.filter((x) => bucketKey(x) === bucketKey(r));
      const usable = trainBucket.length >= 25 ? trainBucket : trainAll;
      const bk = chooseK(usable, shrinkProbability);
      const lbk = chooseK(usable, logisticResidualProbability);
      global.set(r.id, shrinkProbability(r, gk));
      bucketed.set(r.id, shrinkProbability(r, bk));
      logistic.set(r.id, logisticResidualProbability(r, lk));
      logisticBucketed.set(r.id, logisticResidualProbability(r, lbk));
    }
  }
  return { global, bucketed, logistic, logisticBucketed };
}

function totalCoreFormulaMaps(rows: ReconstructedRow[]) {
  const weights = [0, 0.1, 0.25, 0.5, 0.75, 1];
  const fixed = (k: number) => new Map(rows.map((r) => [r.id, totalShrinkProjection(r, k)]).filter((x): x is [number, number] => x[1] !== null));
  const learned = new Map<number, number>();
  const bucketed = new Map<number, number>();
  const residual = new Map<number, number>();
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const bucketKey = (r: ReconstructedRow) => `${lineBucket(r.line)}:${r.side}:${normalizeMarketReadLabel(r.v2LabelReconstructed)}`;
  const chooseK = (train: ReconstructedRow[]) => weights
    .map((k) => ({
      k,
      mae: train.length < 30 ? Number.POSITIVE_INFINITY : train.reduce((s, r) => {
        const p = totalShrinkProjection(r, k);
        return s + (p === null || r.actualTotal === null ? 0 : Math.abs(p - r.actualTotal));
      }, 0) / train.length,
    }))
    .sort((a, b) => a.mae - b.mae)[0]?.k ?? 1;
  for (const d of dates) {
    const trainAll = rows.filter((r) => r.date < d && r.actualTotal !== null && r.projectedTotal !== null && r.line !== null);
    const test = rows.filter((r) => r.date === d);
    const gk = chooseK(trainAll);
    for (const r of test) {
      const trainBucket = trainAll.filter((x) => bucketKey(x) === bucketKey(r));
      const usable = trainBucket.length >= 15 ? trainBucket : trainAll;
      const bk = chooseK(usable);
      const gp = totalShrinkProjection(r, gk);
      const bp = totalShrinkProjection(r, bk);
      if (gp !== null) {
        learned.set(r.id, gp);
        residual.set(r.id, gp);
      }
      if (bp !== null) bucketed.set(r.id, bp);
    }
  }
  return {
    A_rawProjectedTotal: fixed(1),
    B_marketTotal: fixed(0),
    C_marketPlus25PctModelEdge: fixed(0.25),
    D_marketPlus50PctModelEdge: fixed(0.5),
    E_marketPlus75PctModelEdge: fixed(0.75),
    F_learnedGlobalShrinkage: learned,
    G_learnedBucketShrinkage: bucketed,
    H_residualModel: residual,
  };
}

function mlCoreCandidateReport(predsNoSideChange: Prediction[], predsSide: Prediction[], baseline: Prediction[]) {
  const noSide = predictionSummary(predsNoSideChange);
  const side = predictionSummary(predsSide);
  const changed = predsSide.filter((p) => p.side !== p.row.side);
  const unchanged = predsSide.filter((p) => p.side === p.row.side);
  return {
    probabilityOnly: {
      summary: noSide,
      calibrationBuckets: reliability(predsNoSideChange),
      favoriteRoi: subset(predsNoSideChange.filter((p) => p.price !== null && p.price < 0)).roi,
      dogRoi: subset(predsNoSideChange.filter((p) => p.price !== null && p.price > 0)).roi,
      bestAngleRoi: subset(predsNoSideChange.filter((p) => p.tier === "best_angle")).roi,
      leanRoi: subset(predsNoSideChange.filter((p) => p.tier === "lean")).roi,
      recent: recentSummarySet(predsNoSideChange),
      deltasVsProduction: {
        logLoss: noSide.logLoss - predictionSummary(baseline).logLoss,
        brier: noSide.brier - predictionSummary(baseline).brier,
        roi: noSide.actionableRoi - predictionSummary(baseline).actionableRoi,
      },
    },
    sideSelection: {
      summary: side,
      picksChanged: changed.length,
      changedPickPerformance: subset(changed),
      unchangedPickPerformance: subset(unchanged),
      exactChangedCards: changedCards(baseline, predsSide),
      recent: recentSummarySet(predsSide),
    },
  };
}

function gradeFromProbability(row: ReconstructedRow, p: number): ReconstructedRow["tier"] {
  const ev = expectedValuePerDollar(p, row.price) ?? -999;
  if (ev >= 0.04 && p >= 0.56) return "best_angle";
  if (ev > 0 && p >= 0.52) return "lean";
  return "no_play";
}

function gradeAfterModelReport(basePreds: Prediction[], finalPreds: Prediction[]) {
  const graded: Prediction[] = finalPreds.map((p) => ({
    ...p,
    tier: gradeFromProbability(p.row, p.probability),
    reason: `${p.reason}: downstream grade recalculation`,
  }));
  const changed = changedCards(basePreds, graded);
  return {
    summary: predictionSummary(graded),
    bestAngle: subset(graded.filter((p) => p.tier === "best_angle")),
    lean: subset(graded.filter((p) => p.tier === "lean")),
    gradeChangesHelped: changed.filter((c) => c.result === "loss" && (c.candidateTier === "no_play" || c.candidateTier === "lean")).length,
    gradeChangesHarmed: changed.filter((c) => c.result === "win" && (c.candidateTier === "no_play" || c.candidateTier === "lean")).length,
    exactCardsChanged: changed,
  };
}

type DecisionLayerRow = {
  row: ReconstructedRow;
  calibratedProbability: number;
  calibratedProjection: number | null;
  calibratedEdge: number | null;
  breakEvenProbability: number | null;
  calibratedEv: number | null;
};

type DecisionLayerRule = {
  id: string;
  market: "moneyline" | "total";
  evThreshold: number;
  probabilityThreshold?: number;
  edgeThreshold?: number;
};

const DECISION_EV_GRID = [0, 0.01, 0.02, 0.03, 0.04, 0.05];
const DECISION_PROBABILITY_GRID = [0.52, 0.53, 0.54, 0.55, 0.56, 0.57];
const DECISION_TOTAL_EDGE_GRID = [0.1, 0.25, 0.5, 0.75, 1.0];

function calibratedDecisionRows(rows: ReconstructedRow[]): DecisionLayerRow[] {
  return rows
    .filter((r) => r.sport === "mlb" && (r.market === "moneyline" || r.market === "total"))
    .map((r) => {
      const calibratedProjection = r.market === "total" ? totalShrinkProjection(r, 0.25) : null;
      const calibratedProbability = r.market === "moneyline"
        ? shrinkProbability(r, 0.25)
        : calibratedProjection !== null && r.line !== null
          ? totalProbabilityFromProjection(calibratedProjection, r.line, r.side)
          : r.pCurrentProduction;
      const calibratedEdge = r.market === "moneyline"
        ? (r.pMarketNoVigAtLock ?? implied(r.price)) !== null ? calibratedProbability - ((r.pMarketNoVigAtLock ?? implied(r.price)) as number) : null
        : calibratedProjection !== null && r.line !== null
          ? (r.side === "over" ? calibratedProjection - r.line : r.line - calibratedProjection)
          : null;
      return {
        row: r,
        calibratedProbability,
        calibratedProjection,
        calibratedEdge,
        breakEvenProbability: implied(r.price),
        calibratedEv: expectedValuePerDollar(calibratedProbability, r.price),
      };
    });
}

function applyDecisionRule(item: DecisionLayerRow, rule: DecisionLayerRule): Prediction {
  const r = item.row;
  let tier: ReconstructedRow["tier"] = "no_play";
  let reason = "calibrated_ev_not_positive";
  if ((item.calibratedEv ?? -999) > 0) {
    tier = "lean";
    reason = "calibrated_ev_positive";
  }
  if (rule.market === "moneyline") {
    const evOk = (item.calibratedEv ?? -999) >= rule.evThreshold;
    const pOk = item.calibratedProbability >= (rule.probabilityThreshold ?? 0.55);
    if (evOk && pOk) {
      tier = "best_angle";
      reason = `calibrated_ev_${rule.evThreshold}_prob_${rule.probabilityThreshold}`;
    }
  } else {
    const evOk = (item.calibratedEv ?? -999) >= rule.evThreshold;
    const edgeOk = (item.calibratedEdge ?? -999) >= (rule.edgeThreshold ?? 0.5);
    if (evOk && edgeOk) {
      tier = "best_angle";
      reason = `calibrated_edge_${rule.edgeThreshold}_ev_${rule.evThreshold}`;
    }
  }
  return {
    row: r,
    id: rule.id,
    side: r.side,
    probability: item.calibratedProbability,
    price: r.price,
    outcome: r.outcome,
    result: r.result,
    tier,
    reason,
  };
}

function decisionLayerReport(preds: Prediction[], baseline: Prediction[]) {
  const byId = new Map(baseline.map((p) => [p.row.id, p]));
  const changed = preds.filter((p) => byId.get(p.row.id)?.tier !== p.tier);
  const upgradedNoPlay = changed.filter((p) => byId.get(p.row.id)?.tier === "no_play" && p.tier !== "no_play");
  const leanToBest = changed.filter((p) => byId.get(p.row.id)?.tier === "lean" && p.tier === "best_angle");
  const bestAngleDemoted = changed.filter((p) => byId.get(p.row.id)?.tier === "best_angle" && p.tier !== "best_angle");
  const leanDemotedRemoved = changed.filter((p) => byId.get(p.row.id)?.tier === "lean" && (p.tier === "no_play" || p.tier === "other"));
  const productionActionable = baseline.filter((p) => p.tier !== "no_play").length;
  const candidateActionable = preds.filter((p) => p.tier !== "no_play").length;
  const summary = predictionSummary(preds);
  const baseSummary = predictionSummary(baseline);
  return {
    summary,
    baseline: baseSummary,
    currentNoPlaysUpgraded: upgradedNoPlay.length,
    currentLeansUpgradedToBestAngle: leanToBest.length,
    currentBestAnglesDemoted: bestAngleDemoted.length,
    currentLeansDemotedOrRemoved: leanDemotedRemoved.length,
    netPicksAddedRemoved: candidateActionable - productionActionable,
    bestAngle: subset(preds.filter((p) => p.tier === "best_angle")),
    lean: subset(preds.filter((p) => p.tier === "lean")),
    recent14: recentWindowSummary(preds, 14, "mlb"),
    recent7: recentWindowSummary(preds, 7, "mlb"),
    recent3: recentWindowSummary(preds, 3, "mlb"),
    exactCardsChanged: changedCards(baseline, preds),
    changedTierPerformance: subset(changed),
    deployability: {
      roiImproved: summary.actionableRoi > baseSummary.actionableRoi,
      recent7NotMateriallyBad: (recentWindowSummary(preds, 7, "mlb")?.actionableRoi ?? -999) > -0.05,
      bestAnglePositive: (subset(preds.filter((p) => p.tier === "best_angle")).roi ?? -999) > 0,
      leanNotCollapsed: (subset(preds.filter((p) => p.tier === "lean")).roi ?? 0) > -0.15,
    },
  };
}

function mlDecisionRules(): DecisionLayerRule[] {
  return DECISION_EV_GRID.flatMap((evThreshold) => DECISION_PROBABILITY_GRID.map((probabilityThreshold) => ({
    id: `ML_ev_${Math.round(evThreshold * 100)}pct_p_${Math.round(probabilityThreshold * 100)}plus`,
    market: "moneyline" as const,
    evThreshold,
    probabilityThreshold,
  })));
}

function totalDecisionRules(): DecisionLayerRule[] {
  return DECISION_TOTAL_EDGE_GRID.flatMap((edgeThreshold) => DECISION_EV_GRID.map((evThreshold) => ({
    id: `TOTAL_edge_${String(edgeThreshold).replace(".", "_")}_ev_${Math.round(evThreshold * 100)}pct`,
    market: "total" as const,
    evThreshold,
    edgeThreshold,
  })));
}

function evaluateDecisionRule(items: DecisionLayerRow[], rule: DecisionLayerRule): Prediction[] {
  return items.filter((x) => x.row.market === rule.market).map((x) => applyDecisionRule(x, rule));
}

function fixedDecisionGrid(items: DecisionLayerRow[], rules: DecisionLayerRule[]) {
  const baseline = productionPredictions(items.filter((x) => x.row.market === rules[0]?.market).map((x) => x.row));
  return Object.fromEntries(rules.map((rule) => {
    const preds = evaluateDecisionRule(items, rule);
    return [rule.id, {
      rule,
      ...decisionLayerReport(preds, baseline),
    }];
  }));
}

function pickBestDecisionRule(trainItems: DecisionLayerRow[], rules: DecisionLayerRule[]): DecisionLayerRule {
  const fallback = rules[0];
  const baseline = productionPredictions(trainItems.filter((x) => x.row.market === fallback.market).map((x) => x.row));
  if (trainItems.length < 40) return fallback;
  return rules
    .map((rule) => {
      const preds = evaluateDecisionRule(trainItems, rule);
      const report = decisionLayerReport(preds, baseline);
      const ba = report.bestAngle;
      const score =
        report.summary.actionableRoi +
        Math.min(0.05, Math.max(-0.05, report.summary.actionableRoi - report.baseline.actionableRoi)) +
        ((ba.roi ?? -1) > 0 ? 0.01 : -0.03) -
        (report.summary.actionablePlays < Math.max(15, baseline.length * 0.25) ? 0.1 : 0);
      return { rule, score, report };
    })
    .filter((x) => x.report.summary.actionablePlays >= 12)
    .sort((a, b) => b.score - a.score)[0]?.rule ?? fallback;
}

function chronologicalDecisionLayer(items: DecisionLayerRow[], rules: DecisionLayerRule[], id: string) {
  const market = rules[0]?.market;
  const scoped = items.filter((x) => x.row.market === market).sort((a, b) => a.row.date.localeCompare(b.row.date) || a.row.id - b.row.id);
  const baseline = productionPredictions(scoped.map((x) => x.row));
  const dates = [...new Set(scoped.map((x) => x.row.date))].sort();
  const preds: Prediction[] = [];
  const selectedRules: Array<{ date: string; rule: string; trainRows: number }> = [];
  for (const d of dates) {
    const train = scoped.filter((x) => x.row.date < d);
    const test = scoped.filter((x) => x.row.date === d);
    const rule = pickBestDecisionRule(train, rules);
    selectedRules.push({ date: d, rule: rule.id, trainRows: train.length });
    preds.push(...test.map((x) => ({ ...applyDecisionRule(x, rule), id })));
  }
  return {
    id,
    selectedRules,
    ...decisionLayerReport(preds, baseline),
  };
}

function sideChangePredictionsFromCalibrated(items: DecisionLayerRow[], market: "moneyline" | "total", threshold: number): Prediction[] {
  return items.filter((x) => x.row.market === market).map((x) => {
    const r = x.row;
    let side = r.side;
    let probability = x.calibratedProbability;
    let price = r.price;
    let outcome: 0 | 1 | null = r.outcome;
    let result = r.result;
    let reason = "current_side";
    if (market === "moneyline") {
      const oppP = 1 - x.calibratedProbability;
      const shouldSwitch = r.oppositeOutcome !== null && r.oppositePrice !== null && oppP - x.calibratedProbability >= threshold;
      if (shouldSwitch) {
        side = r.oppositeSide;
        probability = oppP;
        price = r.oppositePrice;
        outcome = r.oppositeOutcome;
        result = r.oppositeOutcome === 1 ? "win" : "loss";
        reason = `opposite_probability_exceeds_current_by_${threshold}`;
      }
    } else if (x.calibratedProjection !== null && r.line !== null) {
      const switchToOver = r.side === "under" && x.calibratedProjection - r.line >= threshold;
      const switchToUnder = r.side === "over" && r.line - x.calibratedProjection >= threshold;
      const shouldSwitch = r.oppositeOutcome !== null && r.oppositePrice !== null && (switchToOver || switchToUnder);
      if (shouldSwitch) {
        side = r.oppositeSide;
        probability = totalProbabilityFromProjection(x.calibratedProjection, r.line, side);
        price = r.oppositePrice;
        outcome = r.oppositeOutcome;
        result = r.oppositeOutcome === 1 ? "win" : "loss";
        reason = `calibrated_projection_crosses_line_by_${threshold}`;
      }
    }
    return { row: r, id: `${market}_side_margin_${threshold}`, side, probability, price, outcome, result, tier: r.tier, reason };
  });
}

function sideChangeGrid(items: DecisionLayerRow[]) {
  const mlItems = items.filter((x) => x.row.market === "moneyline");
  const totalItems = items.filter((x) => x.row.market === "total");
  const mlBaseline = productionPredictions(mlItems.map((x) => x.row));
  const totalBaseline = productionPredictions(totalItems.map((x) => x.row));
  const report = (preds: Prediction[], baseline: Prediction[]) => {
    const changed = preds.filter((p) => p.side !== p.row.side);
    const unchanged = preds.filter((p) => p.side === p.row.side);
    return {
      summary: predictionSummary(preds),
      sideChanges: changed.length,
      changedSidePerformance: subset(changed),
      unchangedPerformance: subset(unchanged),
      exactChangedCards: changedCards(baseline, preds),
      recent14: recentWindowSummary(preds, 14, "mlb"),
      recent7: recentWindowSummary(preds, 7, "mlb"),
      recent3: recentWindowSummary(preds, 3, "mlb"),
      deployable: changed.length >= 10 &&
        (subset(changed).roi ?? -999) > 0 &&
        predictionSummary(preds).actionableRoi > predictionSummary(baseline).actionableRoi &&
        (recentWindowSummary(preds, 7, "mlb")?.actionableRoi ?? -999) > -0.05,
    };
  };
  return {
    moneyline: Object.fromEntries([0.01, 0.02, 0.03, 0.04, 0.05].map((threshold) => {
      const preds = sideChangePredictionsFromCalibrated(items, "moneyline", threshold);
      return [`opp_prob_margin_${Math.round(threshold * 100)}pp`, report(preds, mlBaseline)];
    })),
    totals: Object.fromEntries([0.25, 0.5, 0.75, 1.0].map((threshold) => {
      const preds = sideChangePredictionsFromCalibrated(items, "total", threshold);
      return [`cross_line_${threshold}_runs`, report(preds, totalBaseline)];
    })),
  };
}

async function todayDecisionLayerBeforeAfter(
  mlRule: DecisionLayerRule | null,
  totalRule: DecisionLayerRule | null,
) {
  const todayRows = await loadTodayMlbPredictionRows();
  const byKey = new Map<string, PredictionRow>();
  for (const r of todayRows.filter((x) => x.market === "moneyline" || x.market === "total")) {
    const k = `${r.game_id}:${r.market}`;
    const prev = byKey.get(k);
    if (!prev || (time(asOfFor(r)) ?? 0) > (time(asOfFor(prev)) ?? 0) || ((time(asOfFor(r)) ?? 0) === (time(asOfFor(prev)) ?? 0) && r.id > prev.id)) byKey.set(k, r);
  }
  const cards = [...byKey.values()].map((r) => {
    const ind = independent(r);
    const market = r.market_probability ?? implied(r.odds_american);
    const row = {
      ...({} as ReconstructedRow),
      id: r.id,
      sport: "mlb" as Sport,
      market: r.market,
      date: r.slate_date,
      matchup: r.matchup ?? "",
      side: r.side ?? "",
      line: r.line_value,
      price: r.odds_american,
      tier: tier(r),
      result: "pending" as Result,
      outcome: 0 as 0 | 1,
      pCurrentProduction: r.model_probability ?? 0.5,
      pMarketNoVigAtLock: market,
      projectedTotal: ind.projectedTotal,
      oppositeSide: oppositeSide(r.market, r.side ?? "") ?? "",
      oppositeLine: oppositeLine(r.market, r.line_value),
      oppositePrice: null,
      oppositeOutcome: null,
      v2LabelReconstructed: "Projection-Led",
    };
    const calibratedProjection = r.market === "total" && ind.projectedTotal !== null && r.line_value !== null
      ? r.line_value + 0.25 * (ind.projectedTotal - r.line_value)
      : null;
    const calibratedProbability = r.market === "moneyline"
      ? market === null || r.model_probability === null ? r.model_probability ?? 0.5 : market + 0.25 * (r.model_probability - market)
      : calibratedProjection !== null && r.line_value !== null ? totalProbabilityFromProjection(calibratedProjection, r.line_value, r.side ?? "") : r.model_probability ?? 0.5;
    const item: DecisionLayerRow = {
      row,
      calibratedProbability,
      calibratedProjection,
      calibratedEdge: r.market === "moneyline" && market !== null ? calibratedProbability - market :
        r.market === "total" && calibratedProjection !== null && r.line_value !== null ? ((r.side === "over" ? calibratedProjection - r.line_value : r.line_value - calibratedProjection)) : null,
      breakEvenProbability: implied(r.odds_american),
      calibratedEv: expectedValuePerDollar(calibratedProbability, r.odds_american),
    };
    const rule = r.market === "moneyline" ? mlRule : totalRule;
    const pred = rule ? applyDecisionRule(item, rule) : basePrediction(row, "no_rule", calibratedProbability, "no_rule");
    return {
      id: r.id,
      matchup: r.matchup,
      market: r.market,
      productionPick: r.side,
      productionGrade: tier(r),
      productionProbability: r.model_probability,
      productionProjection: ind.projectedTotal,
      calibratedProbability,
      calibratedProjection,
      breakEvenProbability: implied(r.odds_american),
      calibratedEv: item.calibratedEv,
      candidateGrade: pred.tier,
      pickChanged: false,
      gradeChanged: pred.tier !== tier(r),
      reason: pred.reason,
    };
  });
  return {
    cards,
    summary: {
      cards: cards.length,
      picksChanged: 0,
      gradesChanged: cards.filter((c) => c.gradeChanged).length,
      noPlaysUpgraded: cards.filter((c) => c.productionGrade === "no_play" && c.candidateGrade !== "no_play").length,
      leansUpgradedToBest: cards.filter((c) => c.productionGrade === "lean" && c.candidateGrade === "best_angle").length,
      bestAnglesDemoted: cards.filter((c) => c.productionGrade === "best_angle" && c.candidateGrade !== "best_angle").length,
      leansRemoved: cards.filter((c) => c.productionGrade === "lean" && c.candidateGrade === "no_play").length,
    },
  };
}

async function calibratedDecisionLayerBacktest(rows: ReconstructedRow[]) {
  const items = calibratedDecisionRows(rows);
  const mlItems = items.filter((x) => x.row.market === "moneyline");
  const totalItems = items.filter((x) => x.row.market === "total");
  const mlRules = mlDecisionRules();
  const totalRules = totalDecisionRules();
  const mlFixed = fixedDecisionGrid(mlItems, mlRules);
  const totalFixed = fixedDecisionGrid(totalItems, totalRules);
  const mlChrono = chronologicalDecisionLayer(mlItems, mlRules, "ML_chronological_calibrated_thresholds");
  const totalChrono = chronologicalDecisionLayer(totalItems, totalRules, "TOTAL_chronological_calibrated_thresholds");
  const sideChanges = sideChangeGrid(items);
  const topFixed = (grid: Record<string, any>) => Object.entries(grid)
    .map(([id, value]) => ({ id, roi: value.summary.actionableRoi, plays: value.summary.actionablePlays, bestAngleRoi: value.bestAngle.roi, leanRoi: value.lean.roi, recent7: value.recent7?.actionableRoi, report: value }))
    .sort((a, b) => (b.roi ?? -999) - (a.roi ?? -999))
    .slice(0, 12);
  const mlPass = mlChrono.summary.actionableRoi > mlChrono.baseline.actionableRoi &&
    (mlChrono.recent7?.actionableRoi ?? -999) > -0.05 &&
    (mlChrono.bestAngle.roi ?? -999) > 0;
  const totalPass = totalChrono.summary.actionableRoi > totalChrono.baseline.actionableRoi &&
    (totalChrono.recent7?.actionableRoi ?? -999) > -0.05 &&
    (totalChrono.bestAngle.roi ?? -999) > 0;
  const mlSidePass = Object.values(sideChanges.moneyline).some((x: any) => x.deployable);
  const totalSidePass = Object.values(sideChanges.totals).some((x: any) => x.deployable);
  const selectedMlRule = mlRules.find((r) => r.id === mlChrono.selectedRules.at(-1)?.rule) ?? null;
  const selectedTotalRule = totalRules.find((r) => r.id === totalChrono.selectedRules.at(-1)?.rule) ?? null;
  const today = await todayDecisionLayerBeforeAfter(mlPass ? selectedMlRule : null, totalPass ? selectedTotalRule : null);
  const finalAnswer =
    mlSidePass || totalSidePass ? "C_Deploy_calibrated_probability_projection_plus_side_changes" :
    mlPass && totalPass ? "A_B_Deploy_calibrated_ML_and_total_grade_thresholds" :
    mlPass ? "A_Deploy_calibrated_probability_plus_new_ML_grade_thresholds" :
    totalPass ? "B_Deploy_calibrated_totals_projection_plus_new_total_thresholds" :
    "E_No_safe_decision_layer_exists_yet";
  return {
    productionUnchanged: true,
    task1RecomputedEvRows: items.map((x) => ({
      id: x.row.id,
      date: x.row.date,
      matchup: x.row.matchup,
      market: x.row.market,
      productionPick: x.row.side,
      productionProbability: x.row.pCurrentProduction,
      calibratedProbability: x.calibratedProbability,
      calibratedProjection: x.calibratedProjection,
      lockedPrice: x.row.price,
      breakEvenProbability: x.breakEvenProbability,
      calibratedEv: x.calibratedEv,
      productionGrade: x.row.tier,
      result: x.row.result,
      outcome: x.row.outcome,
      roi: profit(x.row.price, x.row.result),
    })),
    task2ThresholdGrids: {
      moneylineTopFixedRules: topFixed(mlFixed),
      totalsTopFixedRules: topFixed(totalFixed),
      moneylineChronological: mlChrono,
      totalsChronological: totalChrono,
    },
    task3UpgradeDemotionReport: {
      moneylineChronological: mlChrono,
      totalsChronological: totalChrono,
    },
    task4SideChanges: sideChanges,
    task5BestDeployableDecisionLayer: {
      finalAnswer,
      passes: {
        mlGradeThresholds: mlPass,
        totalGradeThresholds: totalPass,
        mlSideChanges: mlSidePass,
        totalSideChanges: totalSidePass,
      },
      featureFlagsIfApproved: {
        MLB_MARKET_AWARE_CORE_MODEL_ENABLED: finalAnswer !== "E_No_safe_decision_layer_exists_yet",
        MLB_MARKET_AWARE_ML_PROBABILITY_ENABLED: mlPass || mlSidePass,
        MLB_MARKET_AWARE_TOTAL_PROJECTION_ENABLED: totalPass || totalSidePass,
        MLB_MARKET_AWARE_ML_DECISION_THRESHOLDS_ENABLED: mlPass,
        MLB_MARKET_AWARE_TOTAL_DECISION_THRESHOLDS_ENABLED: totalPass,
        MLB_MARKET_AWARE_ML_SIDE_SELECTION_ENABLED: mlSidePass,
        MLB_MARKET_AWARE_TOTAL_SIDE_SELECTION_ENABLED: totalSidePass,
      },
      todayBeforeAfter: today,
      rollbackPlan: "Set MLB_MARKET_AWARE_CORE_MODEL_ENABLED=false and redeploy. Do not rewrite locked or settled rows.",
      tests: [
        "Replay calibrated decision thresholds chronologically with no post-lock features.",
        "Assert locked/settled prediction_records are not mutated.",
        "Snapshot today's MLB Daily Edge before/after and assert only approved pick/grade fields change.",
        "Unit test ML calibrated EV and total calibrated edge grade rules.",
      ],
    },
  };
}

function recentCoreModelLossAutopsy(
  rows: ReconstructedRow[],
  mlProbabilityMap: Map<number, number>,
  totalProjectionMap: Map<number, number>,
) {
  const mlb = rows.filter((r) => r.sport === "mlb" && (r.market === "moneyline" || r.market === "total"));
  const maxDate = maxDateForRows(mlb);
  const since = (days: number) => {
    if (!maxDate) return "";
    const d = new Date(`${maxDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (days - 1));
    return d.toISOString().slice(0, 10);
  };
  const explain = (r: ReconstructedRow) => {
    const marketBaseline = r.market === "moneyline" ? r.pMarketNoVigAtLock : r.line;
    const marketAwareProbability = r.market === "moneyline" ? mlProbabilityMap.get(r.id) ?? r.pCurrentProduction : null;
    const marketAwareProjection = r.market === "total" ? totalProjectionMap.get(r.id) ?? null : null;
    const marketAwareSide = r.market === "moneyline"
      ? ((marketAwareProbability ?? r.pCurrentProduction) < 0.5 ? r.oppositeSide : r.side)
      : marketAwareProjection !== null && r.line !== null ? projectionSide(marketAwareProjection, r.line, r.side) : r.side;
    const fixesLoss = marketAwareSide !== r.side && r.oppositeOutcome === 1;
    const wouldHurtWinnerElsewhere = false;
    const edge = r.market === "moneyline" && r.pMarketNoVigAtLock !== null
      ? r.pCurrentProduction - r.pMarketNoVigAtLock
      : r.market === "total" && r.projectedTotal !== null && r.line !== null
        ? r.projectedTotal - r.line
        : null;
    const reason =
      fixesLoss ? "wrong_side_core_model_would_fix" :
      r.price === null ? "bad_price" :
      r.market === "total" && r.projectedTotal !== null && r.actualTotal !== null && Math.abs(r.projectedTotal - r.actualTotal) > Math.abs((r.line ?? r.projectedTotal) - r.actualTotal) + 0.5 ? "bad_projection" :
      r.market === "moneyline" && marketAwareProbability !== null && Math.abs(marketAwareProbability - r.pCurrentProduction) >= 0.03 ? "model_edge_over_market_overstated" :
      r.tier === "best_angle" || r.tier === "lean" ? "bad_grade_or_variance" :
      "variance";
    return {
      id: r.id,
      date: r.date,
      matchup: r.matchup,
      market: r.market,
      productionPick: r.side,
      productionProbability: r.pCurrentProduction,
      productionProjection: r.projectedTotal,
      marketBaseline,
      modelEdgeOverMarket: edge,
      marketAwareProbability,
      marketAwareProjection,
      productionSide: r.side,
      marketAwareSide,
      result: r.result,
      marketAwareFormulaFixesIt: fixesLoss,
      wouldHaveHurtWinnerElsewhere: wouldHurtWinnerElsewhere,
      category: reason,
    };
  };
  const losses3 = mlb.filter((r) => r.date >= since(3) && r.result === "loss").map(explain);
  const losses7 = mlb.filter((r) => r.date >= since(7) && r.result === "loss").map(explain);
  const summarize = (xs: ReturnType<typeof explain>[]) => {
    const cats = ["bad_projection", "bad_probability", "model_edge_over_market_overstated", "wrong_side_core_model_would_fix", "bad_grade_or_variance", "bad_price", "variance"];
    return Object.fromEntries(cats.map((cat) => [cat, xs.filter((x) => x.category === cat).length]));
  };
  return {
    last3Days: { losses: losses3, summary: summarize(losses3) },
    last7Days: { losses: losses7, summary: summarize(losses7) },
  };
}

async function todayMlbCoreBeforeAfter(
  historicalRows: ReconstructedRow[],
  mlFormula: (row: PredictionRow) => number,
  totalFormula: (row: PredictionRow) => number | null,
) {
  const todayRows = await loadTodayMlbPredictionRows();
  const byKey = new Map<string, PredictionRow>();
  for (const r of todayRows.filter((x) => x.market === "moneyline" || x.market === "total")) {
    const k = `${r.game_id}:${r.market}`;
    const prev = byKey.get(k);
    if (!prev || (time(asOfFor(r)) ?? 0) > (time(asOfFor(prev)) ?? 0) || ((time(asOfFor(r)) ?? 0) === (time(asOfFor(prev)) ?? 0) && r.id > prev.id)) byKey.set(k, r);
  }
  const cards = [...byKey.values()].map((r) => {
    const ind = independent(r);
    const market = r.market_probability ?? implied(r.odds_american);
    const pFinal = r.market === "moneyline" ? mlFormula(r) : r.model_probability;
    const finalProjection = r.market === "total" ? totalFormula(r) : null;
    const finalSide = r.market === "moneyline"
      ? (pFinal !== null && pFinal < 0.5 ? oppositeSide(r.market, r.side ?? "") : r.side)
      : (finalProjection !== null && r.line_value !== null ? projectionSide(finalProjection, r.line_value, r.side ?? "") : r.side);
    return {
      id: r.id,
      matchup: r.matchup,
      market: r.market,
      productionPick: r.side,
      productionProbability: r.model_probability,
      productionProjection: ind.projectedTotal,
      marketBaseline: r.market === "moneyline" ? market : r.line_value,
      modelEdgeOverMarket: r.market === "moneyline" && market !== null && r.model_probability !== null ? r.model_probability - market : null,
      modelTotalEdgeOverMarket: r.market === "total" && ind.projectedTotal !== null && r.line_value !== null ? ind.projectedTotal - r.line_value : null,
      marketAwareProbability: r.market === "moneyline" ? pFinal : null,
      marketAwareProjection: finalProjection,
      productionGrade: tier(r),
      marketAwareSide: finalSide,
      pickChanges: finalSide !== r.side,
      probabilityChanges: r.market === "moneyline" && r.model_probability !== null && Math.abs((pFinal ?? r.model_probability) - r.model_probability) >= 0.005,
      projectionChanges: r.market === "total" && finalProjection !== null && ind.projectedTotal !== null && Math.abs(finalProjection - ind.projectedTotal) >= 0.05,
      reasonCode: r.market === "moneyline" ? "market_baseline_plus_model_residual" : "market_total_plus_model_residual",
    };
  });
  return {
    cards,
    summary: {
      cards: cards.length,
      picksChanged: cards.filter((c) => c.pickChanges).length,
      probabilitiesChanged: cards.filter((c) => c.probabilityChanges).length,
      projectedTotalsChanged: cards.filter((c) => c.projectionChanges).length,
      gradesChanged: 0,
      historicalRowsUsed: historicalRows.filter((r) => r.sport === "mlb" && (r.market === "moneyline" || r.market === "total")).length,
    },
    recommendedProbabilityProjectionOnlyImpact: {
      picksChanged: 0,
      gradesChanged: 0,
      bestAngleLeanNoPlayChanged: 0,
      probabilitiesChanged: cards.filter((c) => c.probabilityChanges).length,
      projectedTotalsChanged: cards.filter((c) => c.projectionChanges).length,
      simulatedSideChangesNotRecommended: cards.filter((c) => c.pickChanges).length,
    },
  };
}

async function mlbCoreMarketAwareModelBacktest(rows: ReconstructedRow[]) {
  const ml = rows.filter((r) => r.sport === "mlb" && r.market === "moneyline" && r.pMarketNoVigAtLock !== null);
  const totals = rows.filter((r) => r.sport === "mlb" && r.market === "total" && r.projectedTotal !== null && r.actualTotal !== null && r.line !== null);
  const mlBaseline = productionPredictions(ml);
  const totalBaseline = productionPredictions(totals);
  const mlMaps = learnedMlShrinkageMaps(ml);
  const mlCandidates: Record<string, (row: ReconstructedRow) => number> = {
    A_currentProductionProbability: (r) => r.pCurrentProduction,
    B_marketOnlyNoVigProbability: (r) => r.pMarketNoVigAtLock ?? r.pCurrentProduction,
    C_marketPlus25PctModelEdge: (r) => shrinkProbability(r, 0.25),
    D_marketPlus50PctModelEdge: (r) => shrinkProbability(r, 0.5),
    E_marketPlus75PctModelEdge: (r) => shrinkProbability(r, 0.75),
    F_learnedGlobalShrinkage: (r) => mlMaps.global.get(r.id) ?? r.pCurrentProduction,
    G_learnedBucketShrinkage: (r) => mlMaps.bucketed.get(r.id) ?? r.pCurrentProduction,
    H_logisticResidualModel: (r) => mlMaps.logistic.get(r.id) ?? r.pCurrentProduction,
    I_bucketSpecificLogisticResidualModel: (r) => mlMaps.logisticBucketed.get(r.id) ?? r.pCurrentProduction,
  };
  const mlFormulaReports = Object.fromEntries(Object.entries(mlCandidates).map(([id, fn]) => {
    const noSide = mlCoreFormulaPredictions(ml, id, fn, false);
    const withSide = mlCoreFormulaPredictions(ml, `${id}_side_selection`, fn, true);
    return [id, mlCoreCandidateReport(noSide, withSide, mlBaseline)];
  }));
  const totalMaps = totalCoreFormulaMaps(totals);
  const totalFormulaReports = Object.fromEntries(Object.entries(totalMaps).map(([id, projections]) => [
    id,
    projectionCandidateSummaryV2(totals, id, projections),
  ]));
  const bestMlByLogLoss = Object.entries(mlFormulaReports).sort((a, b) => a[1].probabilityOnly.summary.logLoss - b[1].probabilityOnly.summary.logLoss)[0];
  const bestMlByRoi = Object.entries(mlFormulaReports).sort((a, b) => b[1].sideSelection.summary.actionableRoi - a[1].sideSelection.summary.actionableRoi)[0];
  const bestTotalByMae = Object.entries(totalFormulaReports).sort((a, b) => a[1].totalMae - b[1].totalMae)[0];
  const bestTotalByRoi = Object.entries(totalFormulaReports).sort((a, b) => b[1].sidePerformance.actionableRoi - a[1].sidePerformance.actionableRoi)[0];
  const mlBestPreds = mlCoreFormulaPredictions(ml, bestMlByLogLoss[0], mlCandidates[bestMlByLogLoss[0]], false);
  const mlBestSidePreds = mlCoreFormulaPredictions(ml, `${bestMlByLogLoss[0]}_side`, mlCandidates[bestMlByLogLoss[0]], true);
  const totalBestProjection = totalMaps[bestTotalByMae[0] as keyof typeof totalMaps];
  const totalBestPreds = (() => {
    const changed = new Map<number, string>((bestTotalByMae[1].exactCardsChanged as any[]).map((c) => [c.id, c.candidateSide]));
    return totals.map((r) => {
      const side = changed.get(r.id) ?? r.side;
      const resolved = totalResultFor(r, side);
      const projection = totalBestProjection.get(r.id) ?? r.projectedTotal ?? r.line ?? 0;
      return { row: r, id: bestTotalByMae[0], side, probability: totalProbabilityFromProjection(projection, r.line ?? projection, side), price: resolved.price, outcome: resolved.outcome, result: resolved.result, tier: r.tier, reason: bestTotalByMae[0] } as Prediction;
    });
  })();
  const mlProbSafe =
    bestMlByLogLoss[1].probabilityOnly.summary.logLoss < mlFormulaReports.A_currentProductionProbability.probabilityOnly.summary.logLoss &&
    bestMlByLogLoss[1].probabilityOnly.summary.brier <= mlFormulaReports.A_currentProductionProbability.probabilityOnly.summary.brier &&
    bestMlByLogLoss[1].sideSelection.picksChanged === 0;
  const mlSideSafe =
    bestMlByRoi[1].sideSelection.picksChanged >= 10 &&
    (bestMlByRoi[1].sideSelection.changedPickPerformance.roi ?? -999) > 0 &&
    bestMlByRoi[1].sideSelection.summary.actionableRoi > mlFormulaReports.A_currentProductionProbability.sideSelection.summary.actionableRoi;
  const totalProjectionSafe =
    bestTotalByMae[1].totalMae < totalFormulaReports.A_rawProjectedTotal.totalMae &&
    bestTotalByMae[1].sidePerformance.actionableRoi >= totalFormulaReports.A_rawProjectedTotal.sidePerformance.actionableRoi - 0.02 &&
    (bestTotalByMae[1].recent.last7?.actionableRoi ?? -999) > -0.1;
  const totalSideSafe =
    bestTotalByRoi[1].changedSides >= 10 &&
    (bestTotalByRoi[1].changedSidePerformance.roi ?? -999) > 0 &&
    bestTotalByRoi[1].sidePerformance.actionableRoi > totalFormulaReports.A_rawProjectedTotal.sidePerformance.actionableRoi;
  const today = await todayMlbCoreBeforeAfter(
    rows,
    (r) => {
      const market = r.market_probability ?? implied(r.odds_american);
      return market === null || r.model_probability === null ? r.model_probability ?? 0.5 : market + 0.5 * (r.model_probability - market);
    },
    (r) => {
      const ind = independent(r);
      if (ind.projectedTotal === null || r.line_value === null) return null;
      return r.line_value + 0.5 * (ind.projectedTotal - r.line_value);
    },
  );
  const finalAnswer =
    mlProbSafe && totalProjectionSafe ? "C_Deploy_both_ML_probability_and_total_projection_models" :
    mlProbSafe ? "A_Deploy_market_aware_MLB_ML_probability_model" :
    totalProjectionSafe ? "B_Deploy_market_aware_MLB_total_projection_model" :
    mlSideSafe || totalSideSafe ? "D_Deploy_side_selection_for_one_market" :
    (bestMlByLogLoss[1].probabilityOnly.summary.logLoss < mlFormulaReports.A_currentProductionProbability.probabilityOnly.summary.logLoss ||
      bestTotalByMae[1].totalMae < totalFormulaReports.A_rawProjectedTotal.totalMae) ? "E_Deploy_probability_projection_only_no_side_or_grade_changes_yet" :
    "F_No_safe_market_aware_core_model_improvement_exists_with_current_data";
  return {
    productionUnchanged: true,
    scope: {
      included: ["MLB moneyline", "MLB totals"],
      excluded: ["first inning", "WNBA", "World Cup", "NBA", "NFL", "NCAAF", "NCAAB", "NHL"],
    },
    part1RecoveredModelEdge: {
      moneylineRows: ml.map((r) => ({
        id: r.id,
        date: r.date,
        matchup: r.matchup,
        productionPick: r.side,
        productionProbability: r.pCurrentProduction,
        marketNoVigProbabilityAtLock: r.pMarketNoVigAtLock,
        modelEdgeVsMarket: r.pMarketNoVigAtLock === null ? null : r.pCurrentProduction - r.pMarketNoVigAtLock,
        lockedPrice: r.price,
        result: r.result,
        roi: profit(r.price, r.result),
        grade: r.tier,
        favoriteDog: r.price !== null && r.price < 0 ? "favorite" : "dog",
        homeAway: r.side,
        oddsBucket: oddsBucket(r.price),
        v2MarketReadLabel: normalizeMarketReadLabel(r.v2LabelReconstructed),
      })),
      totalRows: totals.map((r) => ({
        id: r.id,
        date: r.date,
        matchup: r.matchup,
        productionPick: r.side,
        rawProjectedTotal: r.projectedTotal,
        marketTotalAtLock: r.line,
        modelTotalEdgeVsMarket: r.projectedTotal !== null && r.line !== null ? r.projectedTotal - r.line : null,
        lockedLine: r.line,
        lockedPrice: r.price,
        actualTotal: r.actualTotal,
        result: r.result,
        roi: profit(r.price, r.result),
        grade: r.tier,
        overUnder: r.side,
        totalLineBucket: lineBucket(r.line),
        v2MarketReadLabel: normalizeMarketReadLabel(r.v2LabelReconstructed),
      })),
    },
    part2EdgeReality: {
      moneyline: {
        byModelEdgeVsMarket: Object.fromEntries(["negative", "market_plus_0_to_2pp", "plus_2_to_4pp", "plus_4_to_6pp", "plus_6_to_8pp", "plus_8pp_plus", "unknown"].map((b) => [b, mlCoreBucket(ml.filter((r) => marketEdgeBucketMl(r.pMarketNoVigAtLock === null ? null : r.pCurrentProduction - r.pMarketNoVigAtLock) === b), b)])),
        byFavoriteDog: Object.fromEntries(["favorite", "dog"].map((b) => [b, mlCoreBucket(ml.filter((r) => (r.price !== null && r.price < 0 ? "favorite" : "dog") === b), b)])),
        byOddsBucket: Object.fromEntries(["favorite_worse_than_-180", "-180_to_-150", "-149_to_-130", "-129_to_-110", "-109_to_+109", "+110_to_+140", "+141_or_longer", "unknown"].map((b) => [b, mlCoreBucket(ml.filter((r) => oddsBucket(r.price) === b), b)])),
        byHomeAway: Object.fromEntries(["home", "away"].map((b) => [b, mlCoreBucket(ml.filter((r) => r.side === b), b)])),
        byProductionProbability: Object.fromEntries(["50_to_52pct", "52_to_54pct", "54_to_56pct", "56_to_58pct", "58_to_60pct", "60pct_plus"].map((b) => [b, mlCoreBucket(ml.filter((r) => probabilityBucket(r.pCurrentProduction) === b), b)])),
        byMarketReadLabel: Object.fromEntries(["Strong Market Support", "Market Support", "Slight Market Support", "Projection-Led", "Slight Market Resistance", "Market Resistance", "Strong Market Resistance"].map((b) => [b, mlCoreBucket(ml.filter((r) => normalizeMarketReadLabel(r.v2LabelReconstructed) === b), b)])),
        byMovement: Object.fromEntries(["support", "neutral", "resistance", "unknown"].map((b) => [b, mlCoreBucket(ml.filter((r) => (r.movementDirectionRelativeToPick ?? "unknown") === b), b)])),
      },
      totals: {
        byTotalEdgeVsMarket: Object.fromEntries(["within_0_25", "0_25_to_0_5", "0_5_to_0_75", "0_75_to_1_0", "1_0_plus", "unknown"].map((b) => [b, totalCoreBucket(totals.filter((r) => totalEdgeBucket(r.projectedTotal !== null && r.line !== null ? r.projectedTotal - r.line : null) === b), b)])),
        byLineBucket: Object.fromEntries(["le_7_5", "eq_8", "eq_8_5", "ge_9", "unknown"].map((b) => [b, totalCoreBucket(totals.filter((r) => lineBucket(r.line) === b), b)])),
        byOverUnder: Object.fromEntries(["over", "under"].map((b) => [b, totalCoreBucket(totals.filter((r) => r.side === b), b)])),
        byMarketReadLabel: Object.fromEntries(["Strong Market Support", "Market Support", "Slight Market Support", "Projection-Led", "Slight Market Resistance", "Market Resistance", "Strong Market Resistance"].map((b) => [b, totalCoreBucket(totals.filter((r) => normalizeMarketReadLabel(r.v2LabelReconstructed) === b), b)])),
      },
    },
    part3And4CandidateFormulaResults: {
      moneyline: mlFormulaReports,
      totals: totalFormulaReports,
      bestMoneylineByLogLoss: bestMlByLogLoss,
      bestMoneylineBySideRoi: bestMlByRoi,
      bestTotalByMae,
      bestTotalBySideRoi: bestTotalByRoi,
    },
    part5SideSelection: {
      moneyline: Object.fromEntries(Object.entries(mlFormulaReports).map(([id, r]) => [id, r.sideSelection])),
      totals: Object.fromEntries(Object.entries(totalFormulaReports).map(([id, r]) => [id, {
        sidePerformance: r.sidePerformance,
        sidesChanged: r.changedSides,
        changedSidePerformance: r.changedSidePerformance,
        unchangedSidePerformance: r.unchangedSidePerformance,
        exactChangedCards: r.exactCardsChanged,
      }])),
    },
    part6DeploymentOptions: {
      finalAnswer,
      enableNow: false,
      flagsIfApproved: {
        MLB_MARKET_AWARE_CORE_MODEL_ENABLED: false,
        MLB_MARKET_AWARE_ML_PROBABILITY_ENABLED: finalAnswer.includes("MLB_ML_probability"),
        MLB_MARKET_AWARE_TOTAL_PROJECTION_ENABLED: finalAnswer.includes("total_projection"),
        MLB_MARKET_AWARE_ML_SIDE_SELECTION_ENABLED: mlSideSafe,
        MLB_MARKET_AWARE_TOTAL_SIDE_SELECTION_ENABLED: totalSideSafe,
        MLB_MARKET_AWARE_GRADE_CALIBRATION_ENABLED: false,
      },
      proofIfNotDeployingSideSelection: {
        moneylineSideSafe: mlSideSafe,
        totalSideSafe,
        mlSideBest: bestMlByRoi,
        totalSideBest: bestTotalByRoi,
      },
    },
    part7GradesAfterModelImprovement: {
      moneylineBestProbabilityThenGrade: gradeAfterModelReport(mlBaseline, mlBestPreds),
      moneylineBestSideThenGrade: gradeAfterModelReport(mlBaseline, mlBestSidePreds),
      totalBestProjectionThenGrade: gradeAfterModelReport(totalBaseline, totalBestPreds),
    },
    part8RecentDamageAutopsy: recentCoreModelLossAutopsy(
      rows,
      byIdProbability(mlBestPreds),
      totalBestProjection,
    ),
    part9CurrentSlateBeforeAfter: today,
    part10FinalAnswer: finalAnswer,
  };
}


function reportGradeResearch(grades: Record<string, Prediction[]>, production: Prediction[]) {
  return Object.fromEntries(Object.entries(grades).map(([name, preds]) => {
    const changed = changedCards(production, preds);
    const noPlay = preds.filter((p) => p.tier === "no_play");
    const actionable = preds.filter((p) => p.tier !== "no_play");
    return [name, {
      summary: predictionSummary(preds),
      bestAngle: subset(actionable.filter((p) => p.tier === "best_angle")),
      lean: subset(actionable.filter((p) => p.tier === "lean")),
      noPlayAvoidedWinsLosses: subset(noPlay),
      gradeChangesHelped: changed.filter((c) => c.result === "loss" && c.candidateTier === "no_play").length,
      gradeChangesHarmed: changed.filter((c) => c.result === "win" && c.candidateTier === "no_play").length,
      changedCards: changed,
    }];
  }));
}

function recentWindowSummary(preds: Prediction[], days: number, sport?: Sport) {
  const maxDate = preds.map((p) => p.row.date).sort().at(-1);
  if (!maxDate) return null;
  const d = new Date(`${maxDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  const min = d.toISOString().slice(0, 10);
  return predictionSummary(preds.filter((p) => p.row.date >= min && (!sport || p.row.sport === sport)));
}

function bestPriceResearch(rows: ReconstructedRow[]) {
  const actionable = rows.filter((r) => r.tier !== "no_play");
  const selectedPreds = actionable.map((r) => basePrediction(r, "selected_price", r.pCurrentProduction, "selected locked price"));
  const bestPreds: Prediction[] = actionable.map((r) => ({
    row: r,
    id: "best_available_price",
    side: r.side,
    probability: r.pCurrentProduction,
    price: r.bestAvailablePriceAtLock ?? r.price,
    outcome: r.outcome,
    result: r.result,
    tier: r.tier,
    reason: r.bestAvailableBookAtLock ? `best at ${r.bestAvailableBookAtLock}` : "selected price fallback",
  }));
  const materiallyBetter = actionable.filter((r) => {
    const selected = decimalOdds(r.price);
    const best = decimalOdds(r.bestAvailablePriceAtLock);
    return selected !== null && best !== null && best - selected >= 0.03;
  });
  return {
    actionableRows: actionable.length,
    rowsWithBestAvailablePrice: actionable.filter((r) => r.bestAvailablePriceAtLock !== null).length,
    materiallyBetterPriceRows: materiallyBetter.length,
    selectedPricePerformance: predictionSummary(selectedPreds),
    bestAvailablePricePerformance: predictionSummary(bestPreds),
    bestAngleSelected: subset(selectedPreds.filter((p) => p.tier === "best_angle")),
    bestAngleBestAvailable: subset(bestPreds.filter((p) => p.tier === "best_angle")),
    leanSelected: subset(selectedPreds.filter((p) => p.tier === "lean")),
    leanBestAvailable: subset(bestPreds.filter((p) => p.tier === "lean")),
    examples: materiallyBetter.slice(0, 30).map((r) => ({
      id: r.id,
      date: r.date,
      sport: r.sport,
      matchup: r.matchup,
      market: r.market,
      side: r.side,
      selectedPrice: r.price,
      bestAvailablePrice: r.bestAvailablePriceAtLock,
      bestAvailableBook: r.bestAvailableBookAtLock,
      evDelta: r.selectedToBestPriceEvDelta,
      result: r.result,
      grade: r.tier,
    })),
  };
}

function recentMlbDamageDeepDive(rows: ReconstructedRow[]) {
  const maxDate = rows.map((r) => r.date).sort().at(-1);
  if (!maxDate) return { last3: [], last7: [], summary: null };
  const since = (days: number) => {
    const d = new Date(`${maxDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (days - 1));
    return d.toISOString().slice(0, 10);
  };
  const explain = (r: ReconstructedRow) => {
    const calibratedProbability = blend(r.pCurrentProduction, r.pMarketNoVigAtLock, 0.3);
    const calibratedEv = expectedValuePerDollar(calibratedProbability, r.price);
    const anchoredProjection = r.market === "total" && r.projectedTotal !== null && r.line !== null
      ? r.projectedTotal * 0.4 + r.line * 0.6
      : null;
    const anchoredSide = anchoredProjection !== null && r.line !== null ? projectionSide(anchoredProjection, r.line, r.side) : null;
    const bestPriceEv = expectedValuePerDollar(calibratedProbability, r.bestAvailablePriceAtLock ?? r.price);
    return {
      id: r.id,
      date: r.date,
      matchup: r.matchup,
      market: r.market,
      productionPick: r.side,
      lockedLine: r.line,
      lockedPrice: r.price,
      probability: r.pCurrentProduction,
      grade: r.tier,
      result: r.result,
      calibratedProbability,
      calibratedEv,
      marketTotalOrProbability: r.market === "total" ? r.line : r.pMarketNoVigAtLock,
      v2MarketReadLabel: r.v2LabelReconstructed,
      lineMovement: r.lineMovementBeforeLock,
      probabilityCalibrationWouldChangeConfidence: Math.abs(calibratedProbability - r.pCurrentProduction) >= 0.015,
      projectionAnchoringWouldChangeSide: anchoredSide !== null && anchoredSide !== r.side,
      gradeRecalibrationWouldDemote: (calibratedEv ?? 0) <= 0 && r.tier !== "no_play",
      noPlayFilterWouldRemove: (calibratedEv ?? -1) <= 0,
      bestPriceWouldChangeEv: bestPriceEv !== null && calibratedEv !== null && Math.abs(bestPriceEv - calibratedEv) >= 0.01,
      bestAvailablePrice: r.bestAvailablePriceAtLock,
      bestAvailableBook: r.bestAvailableBookAtLock,
    };
  };
  const last3 = rows.filter((r) => r.sport === "mlb" && r.date >= since(3) && r.result === "loss").map(explain);
  const last7 = rows.filter((r) => r.sport === "mlb" && r.date >= since(7) && r.result === "loss").map(explain);
  const summarize = (xs: ReturnType<typeof explain>[]) => ({
    losses: xs.length,
    calibrationConfidenceChanges: xs.filter((x) => x.probabilityCalibrationWouldChangeConfidence).length,
    projectionSideChanges: xs.filter((x) => x.projectionAnchoringWouldChangeSide).length,
    gradeDemotions: xs.filter((x) => x.gradeRecalibrationWouldDemote).length,
    noPlayRemovals: xs.filter((x) => x.noPlayFilterWouldRemove).length,
    bestPriceEvChanges: xs.filter((x) => x.bestPriceWouldChangeEv).length,
  });
  return { last3, last7, summary: { last3: summarize(last3), last7: summarize(last7) } };
}

function dataExpansionOptions(rows: ReconstructedRow[]) {
  const missingV2 = rows.filter((r) => !r.evidenceGroups.A_v2_snapshot_usable).length;
  const legacyRecoverable = rows.filter((r) => !r.evidenceGroups.A_v2_snapshot_usable && r.evidenceGroups.C_legacy_prelock_odds_exist).length;
  const lockedRecoverable = rows.filter((r) => !r.evidenceGroups.A_v2_snapshot_usable && !r.evidenceGroups.C_legacy_prelock_odds_exist && r.evidenceGroups.D_locked_record_price_exists).length;
  return [
    { option: "Reconstruct from older line_history/lines tables", expectedRowsGained: legacyRecoverable, costTime: "same day", difficulty: "medium", helps: ["probabilities", "picks", "grades", "CLV"] },
    { option: "Use locked recommendation price as low-confidence market anchor", expectedRowsGained: lockedRecoverable, costTime: "same day", difficulty: "low", helps: ["calibration only"] },
    { option: "Use Playbook splits-history as final-pregame consensus only", expectedRowsGained: Math.max(0, missingV2 - legacyRecoverable), costTime: "1-2 days if endpoint/date coverage cooperates", difficulty: "medium", helps: ["grades", "UI", "CLV"] },
    { option: "Continue SharpAPI DK/Circa history accumulation", expectedRowsGained: "all future rows where source_observed_at is returned", costTime: "ongoing", difficulty: "low", helps: ["grades", "CLV"] },
    { option: "Ask Playbook for deeper historical splits export", expectedRowsGained: "potentially all June MLB/WNBA rows", costTime: "vendor-dependent", difficulty: "low engineering", helps: ["calibration", "grades", "UI"] },
    { option: "Ask SharpAPI why current DK/Circa endpoint returns zero rows", expectedRowsGained: "future current splits if fixed", costTime: "vendor-dependent", difficulty: "low engineering", helps: ["UI", "grades"] },
    { option: "Add low-cost historical odds provider", expectedRowsGained: "hundreds to thousands of historical rows", costTime: "2-5 days", difficulty: "medium/high", helps: ["projections", "probabilities", "picks", "grades", "CLV"] },
    { option: "Use market-only/no-vig baseline for calibration now", expectedRowsGained: rows.filter((r) => r.pMarketNoVigAtLock !== null).length, costTime: "same day", difficulty: "medium", helps: ["probabilities", "projection anchoring"] },
    { option: "Use CLV as intermediate validation target", expectedRowsGained: rows.filter((r) => r.beatClosingLine !== null).length, costTime: "same day", difficulty: "medium", helps: ["grades", "guardrails"] },
    { option: "Sport/market-specific promotion instead of global engine", expectedRowsGained: "n/a", costTime: "same day after a candidate passes", difficulty: "low", helps: ["risk control"] },
  ];
}

function promotionDecision(report: {
  marketBaseline: Record<string, unknown>;
  calibration: Record<string, unknown>;
  selectors: Record<string, { summary: unknown; changedCards: unknown[] }>;
  grades: Record<string, { summary: unknown; changedCards: unknown[] }>;
  coverage: ReturnType<typeof summarizeRows>;
}) {
  const coverageEnough = report.coverage.evidenceFamilies.marketNoVigAtLock >= 100;
  const selectorChanges = Object.values(report.selectors).some((v) => v.changedCards.length > 0);
  return {
    recommendation: "G_UI_only_for_now",
    enableFlags: {
      MARKET_AWARE_ENGINE_ENABLED: false,
      MARKET_AWARE_PROBABILITY_BLEND_ENABLED: false,
      MARKET_AWARE_PROJECTION_ADJUSTMENT_ENABLED: false,
      MARKET_AWARE_PICK_SELECTOR_ENABLED: false,
      MARKET_AWARE_GRADE_ENGINE_ENABLED: false,
      MARKET_AWARE_CLV_GUARDRAILS_ENABLED: false,
    },
    reason: coverageEnough
      ? "Reconstruction expanded market evidence, but no selector/grade candidate cleared a same-day promotion bar without risky/noisy changes."
      : "Safe market-aware validation coverage is still below the promotion bar after reconstruction.",
    guardrailNotes: [
      `marketNoVigAtLock rows=${report.coverage.evidenceFamilies.marketNoVigAtLock}`,
      `selector candidate produced changes=${selectorChanges}`,
      "No production picks/probabilities/grades were changed by this research script.",
    ],
  };
}

function targetedPromotionDecision() {
  return {
    recommendation: "A_probability_calibration_only_for_review",
    enableNow: false,
    exactFlag: "MARKET_AWARE_PROBABILITY_BLEND_ENABLED",
    keepDisabledUntilReviewed: {
      MARKET_AWARE_ENGINE_ENABLED: false,
      MARKET_AWARE_PROBABILITY_BLEND_ENABLED: false,
      MARKET_AWARE_PROJECTION_ADJUSTMENT_ENABLED: false,
      MARKET_AWARE_PICK_SELECTOR_ENABLED: false,
      MARKET_AWARE_GRADE_ENGINE_ENABLED: false,
      MARKET_AWARE_CLV_GUARDRAILS_ENABLED: false,
      MARKET_AWARE_NO_PLAY_FILTER_ENABLED: false,
      BEST_AVAILABLE_PRICE_GRADING_ENABLED: false,
    },
    whyThisIsTheBestDeployableLayer: [
      "Learned chronological model/market blend improved log loss and Brier without changing pick side.",
      "Positive-EV subset using the learned blend was profitable in the reconstructed sample.",
      "MLB moneyline and MLB total both gained probability quality; WNBA samples are too small for sport-specific promotion.",
    ],
    whyNotTheOthersYet: {
      projectionAnchoring: "Market line improves MLB total MAE, but side/ROI improvement requires changing total side or bias correction; not safe for immediate promotion.",
      gradeRecalibration: "EV and market-read grade engines either delete too many plays or harm more wins than losses.",
      noPlayFilter: "EV>4% improves all-sample ROI but collapses badly in the recent MLB 3-day/7-day windows, so it is not robust enough.",
      bestPrice: "Best available price improves ROI modestly but only 30/514 historical plays had recoverable best-price evidence.",
      sideSelector: "Side flipping remains thin/noisy; only v2 label selector improved by one changed card.",
    },
    implementationShapeIfApproved: [
      "Add probability blend service behind MARKET_AWARE_PROBABILITY_BLEND_ENABLED.",
      "Scope initially to MLB moneyline and MLB total only.",
      "Use current production pick side; do not flip sides.",
      "Write before/after probability, EV, and confidence deltas to logs for every future unlocked card.",
      "Do not rewrite locked rows; only affect future card generation while flag is enabled.",
      "Rollback by setting MARKET_AWARE_PROBABILITY_BLEND_ENABLED=false.",
    ],
  };
}

async function main() {
  const { rows, rawRows, officialRows } = await buildRows();
  const production = productionPredictions(rows);
  const marketOnly = marketOnlyPredictions(rows);
  const independentBlend = chronologicalBlendPredictions(rows, "independent");
  const marketBlend = chronologicalBlendPredictions(rows, "market");
  const selectors = {
    B_market_only_side: selectorPredictions(rows, "market"),
    C_production_market_probability_selector: selectorPredictions(rows, "blend"),
    D_v2_label_selector: selectorPredictions(rows, "v2"),
    E_hybrid_selector: selectorPredictions(rows, "hybrid"),
  };
  const grades = {
    B_ev_grade_engine: gradeEngine(rows, "ev"),
    C_market_read_grade_engine: gradeEngine(rows, "market_read"),
    D_clv_aware_grade_engine: gradeEngine(rows, "clv"),
    E_hybrid_grade_engine: gradeEngine(rows, "hybrid"),
  };
  const calibrations = {
    currentProduction: production,
    platt: platt(rows, "model"),
    beta: platt(rows, "beta"),
    isotonic: isotonic(rows),
    marketBlendedCalibration: platt(rows, "marketBlend"),
    sportMarketSpecificCalibration: platt(rows, "sportMarket"),
  };
  const targetedProbabilityCalibration = probabilityCalibrationSprint(rows);
  const targetedMlbTotalsProjection = mlbTotalsProjectionAnchoring(rows);
  const targetedNoPlayFilters = noPlayFilterResearch(rows);
  const targetedBestPrice = bestPriceResearch(rows);
  const targetedRecentMlbDamage = recentMlbDamageDeepDive(rows);
  const candidateHCalibrated = chronologicalMarketBlend(rows, false);
  const candidateHEvDecisions = candidateHEvDecisionResearch(rows, candidateHCalibrated);
  const candidateHSideSwitch = candidateHSideSwitchResearch(rows, candidateHCalibrated);
  const todayBeforeAfter = await todaySlateBeforeAfter(rows, candidateHCalibrated);
  const todayMlDisagreement = await todayMlbMlDisagreementBeforeAfter();
  const boundedCandidateHAutopsy = candidateHFailureAutopsy(rows, candidateHCalibrated);
  const boundedConstrainedRuleSearch = constrainedRuleSearch(rows, candidateHCalibrated, todayBeforeAfter);
  const boundedAlternativeCreativePaths = alternativeCreativePaths(rows, candidateHCalibrated, todayBeforeAfter);
  const boundedPromotionDecision = boundedSearchPromotionDecision(
    boundedConstrainedRuleSearch,
    boundedAlternativeCreativePaths,
    boundedCandidateHAutopsy,
  );
  const modelImprovement = modelImprovementSprint(rows, todayBeforeAfter);
  const mlbCoreMarketAwareBacktest = await mlbCoreMarketAwareModelBacktest(rows);
  const calibratedDecisionLayer = await calibratedDecisionLayerBacktest(rows);
  const mlbMlDisagreement = mlbMlDisagreementBacktest(rows, todayMlDisagreement);
  const report = {
    generatedAt: new Date().toISOString(),
    scope: {
      sports: ["mlb", "wnba"],
      markets: ["moneyline", "spread", "total"],
      note: "Read-only research report. No production picks, probabilities, grades, locked rows, or tracking rows are changed.",
    },
    inputRows: { rawPredictionRows: rawRows, settledOfficialEventMarkets: officialRows, reconstructedRows: rows.length },
    phase1CoverageGapForensics: summarizeRows(rows),
    phase2HistoricalMarketStateReconstruction: {
      rowsReconstructed: rows.length,
      examples: rows.slice(0, 12).map((r) => ({
        id: r.id,
        date: r.date,
        sport: r.sport,
        matchup: r.matchup,
        market: r.market,
        side: r.side,
        pProduction: r.pCurrentProduction,
        pMarket: r.pMarketNoVigAtLock,
        marketSource: r.pMarketSource,
        v2Label: r.v2LabelReconstructed,
        confidence: r.reconstructionConfidence,
        groups: r.evidenceGroups,
      })),
      unrecoverableRows: rows.filter((r) => r.evidenceGroups.H_unrecoverable_safely).slice(0, 50).map((r) => ({
        id: r.id,
        date: r.date,
        sport: r.sport,
        matchup: r.matchup,
        market: r.market,
        reason: r.unrecoverableReason,
      })),
    },
    phase3MarketAsForecastBaseline: {
      A_currentProduction: predictionSummary(production),
      B_marketOnly: predictionSummary(marketOnly),
      C_independentBlend: predictionSummary(independentBlend),
      D_productionMarketBlend: predictionSummary(marketBlend),
    },
    phase4ProbabilityCalibrationResearch: Object.fromEntries(Object.entries(calibrations).map(([name, preds]) => [name, {
      summary: predictionSummary(preds),
      calibration: calibrationSlope(preds),
      reliability: reliability(preds),
    }])),
    phase5ProjectionAdjustment: projectionAdjustment(rows),
    phase6PickSideSelectorTest: Object.fromEntries(Object.entries(selectors).map(([name, preds]) => [name, {
      summary: predictionSummary(preds),
      changedCards: changedCards(production, preds),
    }])),
    phase7GradeEngineTest: Object.fromEntries(Object.entries(grades).map(([name, preds]) => [name, {
      summary: predictionSummary(preds),
      changedCards: changedCards(production, preds),
    }])),
    phase8ClvFutureLineMovement: clvReport(rows),
    phase9CreativeDataExpansionOptions: dataExpansionOptions(rows),
    phase10PromotionDecision: {} as unknown,
    targetedDeployableLayerSprint: {
      phase1MarketProbabilityCalibration: targetedProbabilityCalibration,
      phase1bCandidateHCalibrationModel: {
        model: "learned_chronological_market_blend",
        historicalSummary: predictionSummary(candidateHCalibrated),
      },
      phase2MlbTotalsProjectionAnchoring: targetedMlbTotalsProjection,
      phase3EvBasedGradeRecalibration: reportGradeResearch(grades, production),
      phase3bCandidateHExactEvDecisionTest: candidateHEvDecisions,
      phase4BetNoBetSelector: targetedNoPlayFilters,
      phase5PriceShoppingBestAvailableOdds: targetedBestPrice,
      phase6PickSideFlipTest: Object.fromEntries(Object.entries(selectors).map(([name, preds]) => [name, {
        summary: predictionSummary(preds),
        changedCards: changedCards(production, preds),
      }])),
      phase6bCandidateHSideSwitchTest: candidateHSideSwitch,
      phase7RecentMlbDamageDeepDive: targetedRecentMlbDamage,
      phase8TodayMlbSlateBeforeAfter: todayBeforeAfter,
      phase9PromotionDecision: targetedPromotionDecision(),
    },
    boundedMarketAwareImprovementSearch: {
      part1CandidateHFailureAutopsy: boundedCandidateHAutopsy,
      part2ConstrainedRuleSearch: boundedConstrainedRuleSearch,
      part3AlternativeCreativePaths: boundedAlternativeCreativePaths,
      part4SafetyDecision: boundedPromotionDecision,
      part5TodaySlateBeforeAfter: todayBeforeAfter,
      part6FinalAnswer: boundedPromotionDecision,
    },
    modelImprovementSprint: modelImprovement,
    mlbCoreMarketAwareModelBacktest: mlbCoreMarketAwareBacktest,
    calibratedDecisionLayerBacktest: calibratedDecisionLayer,
    mlbMlDisagreementBacktest: mlbMlDisagreement,
    reconstructedRowsSample: rows.slice(0, 20),
  };
  report.phase10PromotionDecision = promotionDecision({
    marketBaseline: report.phase3MarketAsForecastBaseline,
    calibration: report.phase4ProbabilityCalibrationResearch,
    selectors: report.phase6PickSideSelectorTest as Record<string, { summary: unknown; changedCards: unknown[] }>,
    grades: report.phase7GradeEngineTest as Record<string, { summary: unknown; changedCards: unknown[] }>,
    coverage: report.phase1CoverageGapForensics,
  });
  mkdirSync("ops-local", { recursive: true });
  writeFileSync("ops-local/market-aware-reconstruct-history-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    written: "ops-local/market-aware-reconstruct-history-report.json",
    rows: report.inputRows,
    coverage: report.phase1CoverageGapForensics,
    marketBaseline: report.phase3MarketAsForecastBaseline,
    promotionDecision: report.phase10PromotionDecision,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
