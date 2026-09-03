/**
 * WNBA Phase 2 — Stage 2: prediction_records writer (2026-06-23).
 *
 * Creates FIRST-CLASS records for WNBA ML / O-U / Spread from the DB-backed
 * game_predictions + lines. Each record freezes the EXACT displayed recommendation
 * (side / market / line / price / confidence / grade / projected score + full audit
 * in snapshot_json). The price is derived from the DB lines AT THE DISPLAYED
 * (modal-consensus) line, so displayed line === record line === (later) graded line.
 *
 * WITHHELD ≠ SKIPPED: ambiguous duplicate-pair games (and games without a
 * confirmed real tip) are temporarily WITHHELD with a reason and queued for
 * resolution — never permanently dropped. Every real game must eventually record.
 *
 * Spread is a real `market='spread'` row (gradeable as WNBA Spread), NOT buried
 * in a context-only field. locked_at stays null here; pregame-sweep sets it at T-60.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToSlate, currentSlateDate } from "../../dates/slateDate";
import { isPublicallyTracked } from "../../config/officialTrackingStart";
import {
  buildWnbaCoreModelCalibrationAudit,
  readWnbaCoreModelCalibrationFlagsFromEnv,
  type WnbaCoreModelCalibrationAudit,
} from "../../automodel/wnbaCoreModelCalibration";
import {
  assertWnbaChampionRuntime,
  EXPECTED_WNBA_DISTRIBUTION_VERSION,
  EXPECTED_WNBA_GRADE_POLICY_VERSION,
  EXPECTED_WNBA_MODEL_VERSION,
  wnbaPredictionReleaseMismatches,
} from "../../automodel/wnbaChampionRuntime";
import { resolveWnbaMoneylineSide } from "./wnbaTeams";
import {
  isWnbaDecisionTuple,
  WNBA_DECISION_TUPLE_CONTRACT_VERSION,
  type WnbaDecisionTuple,
} from "./wnbaDecisionTuple";
import {
  WNBA_FORWARD_EVIDENCE_CAPTURE_KEY,
  wnbaForwardEvidenceMarketSlice,
} from "./wnbaForwardEvidenceCapture";

const PLAY_GRADE: Record<string, string> = { "Best Angle": "best_angle", "Lean": "lean", "Watchlist": "watchlist", "Caution": "caution" };
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : null);
const toDecimal = (o: number | null) => (o == null ? null : o > 0 ? o / 100 + 1 : 100 / Math.abs(o) + 1);
const HISTORY_PAGE_SIZE = 1000;
const LOCK_WINDOW_MS = 60 * 60 * 1000;
export const WNBA_PREDICTION_RECORD_CONTRACT_VERSION =
  "wnba_prediction_record_contract_v6_single_market_entry_2026_09_03";
export const WNBA_ACTION_PROMOTION_EVIDENCE_CONTRACT_VERSION =
  "wnba_action_promotion_evidence_v3_single_market_entry_2026_09_03" as const;
export const WNBA_ACTION_PROMOTION_EVIDENCE_KEY = "wnba_action_promotion_evidence_v3" as const;
export const WNBA_ACTION_PROMOTION_EVIDENCE_MAX_OBSERVATIONS = 32;
export const WNBA_ACTION_PROMOTION_EVIDENCE_MAX_BYTES = 32 * 1024;
export const WNBA_ACTION_PROMOTION_EVIDENCE_CADENCE_MINUTES = 30;
export const WNBA_ACTION_PROMOTION_EVIDENCE_ANCHOR_MINUTE_UTC = 23;

type WnbaActionPromotionObservation = {
  cycle_id: string;
  source_computed_at: string;
  captured_at: string;
  game_id: number;
  external_id: string | number | null;
  market: string;
  side: string;
  normalized_line: number | null;
  grade: string | null;
  actionable: boolean;
  evaluated_sportsbook: string | null;
  evaluated_price_american: number | null;
  evaluated_at: string | null;
  model_probability: number | null;
  market_fair_probability: number | null;
  outcome_confidence: number | null;
  edge_pp: number | null;
  offered_price_ev: number | null;
  model_version: string | null;
  distribution_version: string | null;
  grade_policy_version: string | null;
  decision_tuple_contract_version: string | null;
  prediction_record_contract_version: string | null;
  economic_equivalence_key: string;
  evidence_identity: string;
};

type WnbaActionPromotionEvidence = {
  contract_version: typeof WNBA_ACTION_PROMOTION_EVIDENCE_CONTRACT_VERSION;
  mode: "shadow_only";
  production_gate_enabled: false;
  canonical_cycle_source: "game_predictions.computed_at";
  cadence_interval_minutes: typeof WNBA_ACTION_PROMOTION_EVIDENCE_CADENCE_MINUTES;
  cadence_anchor_minute_utc: typeof WNBA_ACTION_PROMOTION_EVIDENCE_ANCHOR_MINUTE_UTC;
  observations: WnbaActionPromotionObservation[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 160) : null;
}

function externalIdentity(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return boundedText(value);
}

export function normalizeWnbaActionPromotionCycle(sourceComputedAt: string): string | null {
  const computedMs = Date.parse(sourceComputedAt);
  if (!Number.isFinite(computedMs)) return null;
  const intervalMs = WNBA_ACTION_PROMOTION_EVIDENCE_CADENCE_MINUTES * 60 * 1000;
  const anchorMs = WNBA_ACTION_PROMOTION_EVIDENCE_ANCHOR_MINUTE_UTC * 60 * 1000;
  return new Date(Math.floor((computedMs - anchorMs) / intervalMs) * intervalMs + anchorMs).toISOString();
}

function normalizedLine(value: unknown): number | null {
  const line = finiteNumber(value);
  return line === null ? null : Math.round(line * 100) / 100;
}

function americanDecimal(price: number | null): number | null {
  if (price === null || price === 0) return null;
  return price > 0 ? price / 100 + 1 : 100 / Math.abs(price) + 1;
}

function isActionableGrade(grade: string | null): boolean {
  return grade === "Best Angle" || grade === "Lean" || grade === "best_angle" || grade === "lean";
}

function makeWnbaActionPromotionObservation(args: {
  candidateRecord: Record<string, unknown>;
  sourceComputedAt: string;
  capturedAt: string;
}): WnbaActionPromotionObservation | null {
  const cycleId = normalizeWnbaActionPromotionCycle(args.sourceComputedAt);
  if (cycleId === null || !Number.isFinite(Date.parse(args.capturedAt))) return null;
  const candidate = args.candidateRecord;
  const snapshot = record(candidate.snapshot_json);
  const tuple = record(snapshot.decision_tuple);
  const gameId = finiteNumber(candidate.game_id);
  const market = boundedText(candidate.market);
  const side = boundedText(candidate.side);
  if (gameId === null || market === null || side === null) return null;
  const line = normalizedLine(tuple.line ?? candidate.line_value);
  const grade = boundedText(tuple.bet_grade ?? snapshot.grade ?? candidate.play_grade);
  const price = finiteNumber(tuple.evaluated_price_american ?? candidate.odds_american);
  const modelProbability = finiteNumber(tuple.model_probability ?? candidate.model_probability);
  const marketProbability = finiteNumber(tuple.market_fair_probability ?? candidate.market_probability);
  const outcomeConfidence = finiteNumber(tuple.outcome_confidence ?? candidate.confidence);
  const edgePp = finiteNumber(candidate.edge);
  const decimal = americanDecimal(price);
  const offeredPriceEv = modelProbability !== null && decimal !== null
    ? Math.round((modelProbability * decimal - 1) * 1_000_000) / 1_000_000
    : null;
  const modelVersion = boundedText(tuple.model_version ?? snapshot.model_version ?? candidate.model_version);
  const distributionVersion = boundedText(tuple.distribution_version ?? snapshot.distribution_version);
  const gradePolicyVersion = boundedText(tuple.grade_policy_version ?? snapshot.grade_policy_version);
  const tupleContractVersion = boundedText(tuple.contract_version ?? snapshot.decision_tuple_contract_version);
  const recordContractVersion = boundedText(snapshot.prediction_record_contract_version);
  const sportsbook = boundedText(tuple.evaluated_sportsbook);
  const evaluatedAt = boundedText(tuple.evaluated_at);
  const economicEquivalenceKey = JSON.stringify([
    gameId, market, side, line, price, modelProbability, marketProbability,
    outcomeConfidence, edgePp, offeredPriceEv, modelVersion, distributionVersion, gradePolicyVersion,
    tupleContractVersion, recordContractVersion,
  ]);
  return {
    cycle_id: cycleId,
    source_computed_at: args.sourceComputedAt,
    captured_at: args.capturedAt,
    game_id: gameId,
    external_id: externalIdentity(candidate.external_id),
    market,
    side,
    normalized_line: line,
    grade,
    actionable: isActionableGrade(grade),
    evaluated_sportsbook: sportsbook,
    evaluated_price_american: price,
    evaluated_at: evaluatedAt,
    model_probability: modelProbability,
    market_fair_probability: marketProbability,
    outcome_confidence: outcomeConfidence,
    edge_pp: edgePp,
    offered_price_ev: offeredPriceEv,
    model_version: modelVersion,
    distribution_version: distributionVersion,
    grade_policy_version: gradePolicyVersion,
    decision_tuple_contract_version: tupleContractVersion,
    prediction_record_contract_version: recordContractVersion,
    economic_equivalence_key: economicEquivalenceKey,
    evidence_identity: JSON.stringify([
      cycleId, args.sourceComputedAt, grade, isActionableGrade(grade), sportsbook, evaluatedAt,
      economicEquivalenceKey,
    ]),
  };
}

function readWnbaActionPromotionEvidence(snapshot: Record<string, unknown>): WnbaActionPromotionEvidence | null {
  const raw = record(snapshot[WNBA_ACTION_PROMOTION_EVIDENCE_KEY]);
  if (
    raw.contract_version !== WNBA_ACTION_PROMOTION_EVIDENCE_CONTRACT_VERSION ||
    raw.mode !== "shadow_only" ||
    raw.production_gate_enabled !== false ||
    raw.canonical_cycle_source !== "game_predictions.computed_at" ||
    raw.cadence_interval_minutes !== WNBA_ACTION_PROMOTION_EVIDENCE_CADENCE_MINUTES ||
    raw.cadence_anchor_minute_utc !== WNBA_ACTION_PROMOTION_EVIDENCE_ANCHOR_MINUTE_UTC ||
    !Array.isArray(raw.observations)
  ) return null;
  return raw as WnbaActionPromotionEvidence;
}

function boundedEvidence(observations: WnbaActionPromotionObservation[]): WnbaActionPromotionEvidence {
  const kept = observations.slice(-WNBA_ACTION_PROMOTION_EVIDENCE_MAX_OBSERVATIONS);
  const evidence: WnbaActionPromotionEvidence = {
    contract_version: WNBA_ACTION_PROMOTION_EVIDENCE_CONTRACT_VERSION,
    mode: "shadow_only",
    production_gate_enabled: false,
    canonical_cycle_source: "game_predictions.computed_at",
    cadence_interval_minutes: WNBA_ACTION_PROMOTION_EVIDENCE_CADENCE_MINUTES,
    cadence_anchor_minute_utc: WNBA_ACTION_PROMOTION_EVIDENCE_ANCHOR_MINUTE_UTC,
    observations: kept,
  };
  while (
    evidence.observations.length > 1 &&
    Buffer.byteLength(JSON.stringify(evidence), "utf8") > WNBA_ACTION_PROMOTION_EVIDENCE_MAX_BYTES
  ) evidence.observations.shift();
  return evidence;
}

export function appendWnbaActionPromotionEvidence(args: {
  existingSnapshot: Record<string, unknown>;
  candidateRecord: Record<string, unknown>;
  sourceComputedAt: string;
  capturedAt: string;
}): Record<string, unknown> {
  const candidateSnapshot = record(args.candidateRecord.snapshot_json);
  const prior = readWnbaActionPromotionEvidence(args.existingSnapshot);
  const observations = prior?.observations ?? [];
  const newest = observations.at(-1);
  const cycleId = normalizeWnbaActionPromotionCycle(args.sourceComputedAt);
  const cycleMs = cycleId === null ? Number.NaN : Date.parse(cycleId);
  const newestCycleMs = newest ? Date.parse(newest.cycle_id) : Number.NEGATIVE_INFINITY;
  const isDuplicateOrOutOfOrder =
    observations.some((observation) => observation.cycle_id === cycleId) ||
    !Number.isFinite(cycleMs) ||
    cycleMs <= newestCycleMs;
  const observation = isDuplicateOrOutOfOrder ? null : makeWnbaActionPromotionObservation(args);
  const evidence = observation ? boundedEvidence([...observations, observation]) : prior;
  return {
    ...args.existingSnapshot,
    ...candidateSnapshot,
    ...(evidence ? { [WNBA_ACTION_PROMOTION_EVIDENCE_KEY]: evidence } : {}),
  };
}

export const __WNBA_ACTION_PROMOTION_EVIDENCE_TEST__ = {
  readWnbaActionPromotionEvidence,
  makeWnbaActionPromotionObservation,
};

export function resolveWnbaPickedMoneylineProbabilities(input: {
  pickedHome: boolean;
  independentHomeProbability: number;
  finalHomeProbability?: number;
}): {
  publishedPickedProbability: number;
  independentPickedProbability: number;
  finalPickedProbability: number;
} {
  const finalHomeProbability = Number.isFinite(input.finalHomeProbability)
    ? input.finalHomeProbability!
    : input.independentHomeProbability;
  return {
    publishedPickedProbability: input.pickedHome ? finalHomeProbability : 1 - finalHomeProbability,
    independentPickedProbability: input.pickedHome
      ? input.independentHomeProbability
      : 1 - input.independentHomeProbability,
    finalPickedProbability: input.pickedHome ? finalHomeProbability : 1 - finalHomeProbability,
  };
}

function isBeforeLockWindow(gameDate: unknown, nowMs: number): boolean {
  if (typeof gameDate !== "string") return false;
  const startMs = Date.parse(gameDate);
  return Number.isFinite(startMs) && startMs - nowMs > LOCK_WINDOW_MS;
}

export type WnbaRecordsResult = {
  apply: boolean;
  eligibleGames: number;
  withheld: Array<{ matchup: string; slate: string; reason: string }>;
  counts: { moneyline: number; total: number; spread: number };
  missingTip: string[];
  missingLinePrice: string[];
  ambiguous: string[];
  written: number;
  lockedSkipped: number;
  records: Record<string, unknown>[];
  errors: string[];
};

export async function buildWnbaPredictionRecords(opts: {
  supabase: SupabaseClient;
  apply: boolean;
  slateDate?: string;
  windowDays?: number;
  logger?: (m: string) => void;
}): Promise<WnbaRecordsResult> {
  const { supabase, apply, slateDate, windowDays = 0, logger = () => {} } = opts;
  if (apply) assertWnbaChampionRuntime();
  const errors: string[] = [];
  const today = slateDate ?? currentSlateDate("wnba");
  const end = addDaysToSlate(today, windowDays);
  const nowIso = new Date().toISOString();
  const result: WnbaRecordsResult = { apply, eligibleGames: 0, withheld: [], counts: { moneyline: 0, total: 0, spread: 0 }, missingTip: [], missingLinePrice: [], ambiguous: [], written: 0, lockedSkipped: 0, records: [], errors };

  if (!isPublicallyTracked("wnba", today)) {
    logger(`wnba records ${today}: before official public-tracking start — no records written`);
    return result;
  }

  const { data: games } = await supabase
    .from("games").select("id, external_id, slate_date, game_date, home_team_id, away_team_id")
    .eq("sport", "wnba").eq("status", "scheduled").gte("slate_date", today).lte("slate_date", end);
  const nowMs = Date.now();
  const allGames = (games ?? []).filter((g) => isBeforeLockWindow(g.game_date, nowMs));
  const { data: teams } = await supabase.from("teams").select("id, abbreviation, name").eq("sport", "wnba");
  const tById = new Map((teams ?? []).map((t) => [t.id as number, t]));
  const ab = (id: number) => (tById.get(id)?.abbreviation as string) ?? "?";

  const ids = allGames.map((g) => g.id as number);
  const { data: gps } = ids.length ? await supabase.from("game_predictions").select("id, game_id, locked_at, computed_at, sport_specific").in("game_id", ids) : { data: [] as Record<string, unknown>[] };
  const gpByGame = new Map((gps ?? []).map((r) => [r.game_id as number, r]));
  const { data: lineRows } = ids.length ? await supabase.from("lines").select("game_id, market_type, side, line_value, odds_american").in("game_id", ids).is("player_id", null) : { data: [] as Record<string, unknown>[] };
  const historyRows: Record<string, unknown>[] = [];
  if (ids.length) {
    for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
      const { data: page, error } = await supabase
        .from("line_history")
        .select("game_id, market_type, side, line_value, odds_american, recorded_at")
        .in("game_id", ids)
        .in("market_type", ["moneyline", "total", "spread"])
        .not("odds_american", "is", null)
        .order("recorded_at", { ascending: false })
        .range(from, from + HISTORY_PAGE_SIZE - 1);
      if (error) {
        errors.push(`line_history read: ${error.message}`);
        break;
      }
      historyRows.push(...(page ?? []));
      if ((page ?? []).length < HISTORY_PAGE_SIZE) break;
    }
  }
  const linesByGame = new Map<number, Record<string, unknown>[]>();
  for (const l of lineRows ?? []) { const gid = l.game_id as number; if (!linesByGame.has(gid)) linesByGame.set(gid, []); linesByGame.get(gid)!.push(l); }
  const historyByGame = new Map<number, Record<string, unknown>[]>();
  const seenHistory = new Set<string>();
  for (const h of historyRows ?? []) {
    const gid = h.game_id as number;
    const key = `${gid}::${h.market_type}::${h.side}::${h.line_value ?? ""}::${h.recorded_at}`;
    if (seenHistory.has(key)) continue;
    seenHistory.add(key);
    if (!historyByGame.has(gid)) historyByGame.set(gid, []);
    historyByGame.get(gid)!.push(h);
  }

  // Duplicate detection: a team-pair with >1 scheduled meeting in the window.
  const pairCount = new Map<string, number>();
  for (const g of allGames) { const k = [g.home_team_id, g.away_team_id].sort((a, b) => (a as number) - (b as number)).join("|"); pairCount.set(k, (pairCount.get(k) ?? 0) + 1); }
  const isDupPair = (g: { home_team_id: number; away_team_id: number }) => (pairCount.get([g.home_team_id, g.away_team_id].sort((a, b) => a - b).join("|")) ?? 0) > 1;

  const priceAt = (gid: number, market: string, side: string, line: number | null) => {
    const sideRows = (linesByGame.get(gid) ?? []).filter((r) => r.market_type === market && r.side === side && r.odds_american != null);
    const rows = line === null
      ? sideRows
      : (() => {
          const exact = sideRows.filter((r) => r.line_value === line);
          if (exact.length > 0) return exact;
          const nearest = sideRows
            .filter((r) => r.line_value != null)
            .sort((a, b) => Math.abs((a.line_value as number) - line) - Math.abs((b.line_value as number) - line))[0];
          return nearest ? sideRows.filter((r) => r.line_value === nearest.line_value) : [];
        })();
    const currentPrice = median(rows.map((r) => r.odds_american as number));
    if (currentPrice !== null) return currentPrice;

    const historySideRows = (historyByGame.get(gid) ?? []).filter((r) => r.market_type === market && r.side === side && r.odds_american != null);
    const historyMatches = line === null
      ? historySideRows
      : (() => {
          const exact = historySideRows.filter((r) => r.line_value === line);
          if (exact.length > 0) return exact;
          const nearest = historySideRows
            .filter((r) => r.line_value != null)
            .sort((a, b) => Math.abs((a.line_value as number) - line) - Math.abs((b.line_value as number) - line))[0];
          return nearest ? historySideRows.filter((r) => r.line_value === nearest.line_value) : [];
        })();
    const latestAt = historyMatches
      .map((r) => new Date(r.recorded_at as string).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    if (latestAt === undefined) return null;
    return median(historyMatches
      .filter((r) => new Date(r.recorded_at as string).getTime() === latestAt)
      .map((r) => r.odds_american as number));
  };

  for (const g of allGames) {
    const matchup = `${ab(g.away_team_id as number)}@${ab(g.home_team_id as number)}`;
    const gp = gpByGame.get(g.id as number) as { id: number; locked_at: string | null; computed_at?: string | null; sport_specific?: Record<string, unknown> } | undefined;
    const slate = g.slate_date as string;

    // ── eligibility (WITHHOLD, not skip) ──
    if (!gp || !gp.sport_specific?.moneyline) {
      const reason = isDupPair(g as { home_team_id: number; away_team_id: number }) ? "ambiguous duplicate pairing (awaiting clean match)" : "no DB prediction yet (will retry next refresh)";
      if (isDupPair(g as { home_team_id: number; away_team_id: number })) result.ambiguous.push(matchup);
      result.withheld.push({ matchup, slate, reason });
      continue;
    }
    // Real-tip / clean-match signal: a matched game HAS current lines (written
    // by refreshWnbaLines along with its real SharpAPI tip). A prediction with
    // no current lines is stale → withhold. (A value-based midnight-placeholder
    // check false-positives on real 8 PM ET tips that land at T00:00:00Z.)
    if ((linesByGame.get(g.id as number) ?? []).length === 0) {
      result.missingTip.push(matchup);
      result.withheld.push({ matchup, slate, reason: "no current market/odds (stale) — withheld" });
      continue;
    }
    // A duplicate-pair game that reaches here HAS a clean prediction + current
    // lines → it is the cleanly-matched meeting, so INCLUDE it. Only the
    // unmatched twin (no prediction) was withheld above.

    const ss = gp.sport_specific as Record<string, unknown>;
    const releaseMismatches = wnbaPredictionReleaseMismatches(ss);
    if (releaseMismatches.length > 0) {
      result.withheld.push({
        matchup,
        slate,
        reason: `prediction release mismatch (${releaseMismatches.join("; ")}) — withheld`,
      });
      continue;
    }
    const ml = ss.moneyline as { side: string; confidence: number; grade: string; price: number | null };
    const tot = ss.total as { side: string | null; line: number | null; confidence: number | null; grade: string | null };
    const spr = ss.spread as { side: string | null; line: number | null; confidence: number | null; grade: string | null };
    const model = ss.model as {
      home_win_prob: number;
      final_home_win_prob?: number;
      margin: number;
      total: number;
      components?: {
        blended_precalibration_margin?: number;
        raw_projected_total?: number;
      };
    };
    const market = ss.market as { home_win_prob: number | null };
    const trusted = ss.trusted as { home_win_prob: number | null };
    const dq = ss.data_quality as { flags: string[]; ml_books: number };
    const tupleContractCurrent = ss.decision_tuple_contract_version === WNBA_DECISION_TUPLE_CONTRACT_VERSION;
    const storedTuples = ss.decision_tuples && typeof ss.decision_tuples === "object"
      ? ss.decision_tuples as Record<string, unknown>
      : {};
    const tupleFor = (
      marketName: "moneyline" | "total" | "spread",
      side: "home" | "away" | "over" | "under",
      line: number | null,
      grade: string | null,
    ): WnbaDecisionTuple | null => {
      const candidate = storedTuples[marketName];
      if (!isWnbaDecisionTuple(candidate)) return null;
      const lineMatches = candidate.line === null && line === null ||
        candidate.line !== null && line !== null && Math.abs(candidate.line - line) < 0.01;
      return candidate.market === marketName && candidate.side === side && lineMatches && candidate.bet_grade === grade
        ? candidate
        : null;
    };
    const homeName = tById.get(g.home_team_id as number)?.name as string;
    const homeAbbr = ab(g.home_team_id as number);
    const awayAbbr = ab(g.away_team_id as number);
    const mlSelection = resolveWnbaMoneylineSide(ml.side, homeAbbr, awayAbbr);
    if (mlSelection === null) {
      result.withheld.push({ matchup, slate, reason: `unresolved ML team identity (${ml.side}) — withheld` });
      continue;
    }
    const mlSideHome = mlSelection === "home";
    const mlTuple = tupleFor("moneyline", mlSideHome ? "home" : "away", null, ml.grade);
    const mlPrice = mlTuple?.evaluated_price_american ?? ml.price ?? priceAt(g.id as number, "moneyline", mlSideHome ? "home" : "away", null);

    // ML must have side + price to be eligible.
    if (!ml.side || mlPrice == null || (tupleContractCurrent && mlTuple === null)) {
      result.missingLinePrice.push(`${matchup} (ML price)`);
      result.withheld.push({ matchup, slate, reason: tupleContractCurrent ? "incoherent ML decision tuple — withheld" : "no ML price — withheld" });
      continue;
    }
    result.eligibleGames++;

    const storedCalibrationAudit =
      ss.wnba_core_model_calibration &&
      typeof ss.wnba_core_model_calibration === "object"
        ? ss.wnba_core_model_calibration as WnbaCoreModelCalibrationAudit
        : null;
    const wnbaCalibrationAudit = storedCalibrationAudit ?? buildWnbaCoreModelCalibrationAudit({
      rawProjectedAwayScore: Number.isFinite(Number((ss.projected_score as { away?: unknown } | undefined)?.away))
        ? Number((ss.projected_score as { away?: unknown }).away)
        : null,
      rawProjectedHomeScore: Number.isFinite(Number((ss.projected_score as { home?: unknown } | undefined)?.home))
        ? Number((ss.projected_score as { home?: unknown }).home)
        : null,
      rawProjectedTotal:
        typeof model.components?.raw_projected_total === "number"
          ? model.components.raw_projected_total
          : typeof model.total === "number"
            ? model.total
            : null,
      rawProjectedHomeMargin:
        typeof model.components?.blended_precalibration_margin === "number"
          ? model.components.blended_precalibration_margin
          : typeof model.margin === "number"
            ? model.margin
            : null,
      marketTotal: typeof (ss.market as { total?: unknown } | undefined)?.total === "number"
        ? (ss.market as { total: number }).total
        : typeof tot.line === "number"
          ? tot.line
          : null,
      marketSpreadForHome: typeof (ss.market as { spread?: unknown } | undefined)?.spread === "number"
        ? (ss.market as { spread: number }).spread
        : typeof spr.line === "number"
          ? spr.line
          : null,
      ...readWnbaCoreModelCalibrationFlagsFromEnv(),
    });

    const baseRec = (market_type: string, side: string, pick: string, line_value: number | null, odds: number | null, confidence: number | null, gradeStr: string | null, modelProb: number | null, mktProb: number | null, decisionTuple: WnbaDecisionTuple | null) => {
      const forwardEvidence = wnbaForwardEvidenceMarketSlice(
        ss[WNBA_FORWARD_EVIDENCE_CAPTURE_KEY],
        market_type,
      );
      return {
        game_prediction_id: gp.id, game_id: g.id, external_id: g.external_id, sport: "wnba",
        slate_date: slate, game_date: g.game_date, matchup, market: market_type, pick, side,
        line_value, odds_american: odds, odds_decimal: toDecimal(odds),
        model_used: EXPECTED_WNBA_MODEL_VERSION, model_version: EXPECTED_WNBA_MODEL_VERSION, prediction_source: "auto_v1_wnba",
        confidence, model_probability: modelProb, market_probability: mktProb,
        edge: modelProb != null && mktProb != null ? Math.round((modelProb - mktProb) * 1000) / 10 : null,
        play_grade: gradeStr ? PLAY_GRADE[gradeStr] ?? "watchlist" : null,
        best_angle: gradeStr === "Best Angle", no_bet: false,
        market_aligned: gradeStr === "Watchlist" || gradeStr === "Caution",
        data_quality_tier: (dq.flags ?? []).length === 0 ? "high" : "standard", source_quality: null,
        provisional: false, held: false, launch_day: false, locked_at: null, published_at: nowIso,
        snapshot_json: {
          market: market_type, side, line: line_value, price: odds, confidence, grade: gradeStr,
          projected_score: ss.projected_score, model, market_consensus: market, trusted_consensus: trusted,
          model_version: EXPECTED_WNBA_MODEL_VERSION,
          distribution_version: EXPECTED_WNBA_DISTRIBUTION_VERSION,
          grade_policy_version: EXPECTED_WNBA_GRADE_POLICY_VERSION,
          spread_grade_policy: ss.spread_grade_policy ?? null,
          prediction_record_contract_version: WNBA_PREDICTION_RECORD_CONTRACT_VERSION,
          decision_tuple_contract_version: decisionTuple?.contract_version ?? null,
          decision_tuple: decisionTuple,
          moneyline_probability_contract: null as null | {
            published_picked_probability: number;
            independent_picked_probability: number;
            final_picked_probability: number;
          },
          sharp_consensus: ss.sharp, consensus_source: ss.consensus_source, dynamic_market_weight: ss.dynamic_market_weight,
          public_market_context: ss.public_market_context ?? null,
          target_excluded_market_decision: ss.target_excluded_market_decision ?? null,
          data_quality: ss.data_quality, cold_start: ss.cold_start,
          wnba_core_model_calibration: wnbaCalibrationAudit,
          ...(forwardEvidence === null
            ? {}
            : { [WNBA_FORWARD_EVIDENCE_CAPTURE_KEY]: forwardEvidence }),
        },
      };
    };

    // ── ML record ──
    const mlProbabilities = resolveWnbaPickedMoneylineProbabilities({
      pickedHome: mlSideHome,
      independentHomeProbability: model.home_win_prob,
      finalHomeProbability: model.final_home_win_prob,
    });
    const mlModelProb = mlProbabilities.publishedPickedProbability;
    const mlMktProb = (trusted.home_win_prob ?? market.home_win_prob) != null ? (mlSideHome ? (trusted.home_win_prob ?? market.home_win_prob)! : 1 - (trusted.home_win_prob ?? market.home_win_prob)!) : null;
    const mlRecord = baseRec(
      "moneyline",
      mlSideHome ? "home" : "away",
      ab(mlSideHome ? (g.home_team_id as number) : (g.away_team_id as number)),
      null,
      mlPrice,
      ml.confidence,
      ml.grade,
      mlTuple?.model_probability ?? mlModelProb,
      mlTuple?.market_fair_probability ?? mlMktProb,
      mlTuple,
    );
    mlRecord.snapshot_json = {
      ...mlRecord.snapshot_json,
      moneyline_probability_contract: {
        published_picked_probability: mlProbabilities.publishedPickedProbability,
        independent_picked_probability: mlProbabilities.independentPickedProbability,
        final_picked_probability: mlProbabilities.finalPickedProbability,
      },
    };
    result.records.push(mlRecord);
    result.counts.moneyline++;

    // ── O/U record (if available) ──
    if (tot.side && tot.line != null) {
      const ouSide = tot.side.startsWith("Over") ? "over" : "under";
      const totalTuple = tupleFor("total", ouSide, tot.line, tot.grade);
      const ouPrice = totalTuple?.evaluated_price_american ?? priceAt(g.id as number, "total", ouSide, tot.line);
      if (ouPrice == null) result.missingLinePrice.push(`${matchup} (O/U price@${tot.line})`);
      if (!tupleContractCurrent || totalTuple !== null) {
        result.records.push(baseRec("total", ouSide, tot.side, tot.line, ouPrice, tot.confidence, tot.grade, totalTuple?.model_probability ?? (tot.confidence != null ? tot.confidence / 100 : null), totalTuple?.market_fair_probability ?? null, totalTuple));
        result.counts.total++;
      } else {
        result.missingLinePrice.push(`${matchup} (incoherent Total decision tuple@${tot.line})`);
      }
    }

    // ── Spread record (if available) — first-class market='spread' ──
    if (spr.side && spr.line != null) {
      const awayName = tById.get(g.away_team_id as number)?.name as string;
      const sprSideHome = spr.side.startsWith(homeName) || spr.side.startsWith(homeAbbr);
      const sprSideAway = spr.side.startsWith(awayName) || spr.side.startsWith(awayAbbr);
      const sprSide = sprSideHome ? "home" : sprSideAway ? "away" : null;
      const sprLine = sprSide === "home" ? spr.line : sprSide === "away" ? -spr.line : null;
      const spreadTuple = sprLine === null || sprSide === null ? null : tupleFor("spread", sprSide, sprLine, spr.grade);
      const sprPrice = spreadTuple?.evaluated_price_american ?? (sprLine === null || sprSide === null ? null : priceAt(g.id as number, "spread", sprSide, sprLine));
      if (sprPrice == null) result.missingLinePrice.push(`${matchup} (Spread price@${sprLine})`);
      if (sprSide !== null && sprLine !== null && (!tupleContractCurrent || spreadTuple !== null)) {
        result.records.push(baseRec("spread", sprSide, spr.side, sprLine, sprPrice, spr.confidence, spr.grade, spreadTuple?.model_probability ?? (spr.confidence != null ? spr.confidence / 100 : null), spreadTuple?.market_fair_probability ?? null, spreadTuple));
        result.counts.spread++;
      } else if (sprSide !== null && sprLine !== null && tupleContractCurrent) {
        result.missingLinePrice.push(`${matchup} (incoherent Spread decision tuple@${sprLine})`);
      }
    }
  }

  if (!apply) {
    logger(`wnba records DRY-RUN: ${result.eligibleGames} eligible, ${result.withheld.length} withheld, records ML ${result.counts.moneyline}/OU ${result.counts.total}/SPR ${result.counts.spread}`);
    return result;
  }

  // Apply: one public WNBA record per (game_id, market, slate_date). NEVER
  // overwrite a locked record (locked_at != null), and do not create duplicate
  // rows if model_version changes.
  const { data: existing } = ids.length
    ? await supabase.from("prediction_records").select("id, game_id, market, locked_at, snapshot_json").eq("sport", "wnba").in("game_id", ids)
    : { data: [] as Record<string, unknown>[] };
  const lockedRec = new Set((existing ?? []).filter((r) => r.locked_at != null).map((r) => `${r.game_id}::${r.market}`));
  const unlockedIdByKey = new Map(
    (existing ?? [])
      .filter((r) => r.locked_at == null)
      .map((r) => [`${r.game_id}::${r.market}`, r.id as number]),
  );
  const unlockedSnapshotByKey = new Map(
    (existing ?? [])
      .filter((r) => r.locked_at == null)
      .map((r) => [`${r.game_id}::${r.market}`, record(r.snapshot_json)]),
  );
  const cycleIdByGame = new Map(
    (gps ?? [])
      .filter((r) => typeof r.computed_at === "string" && Number.isFinite(Date.parse(r.computed_at as string)))
      .map((r) => [r.game_id as number, r.computed_at as string]),
  );
  const toWrite = result.records.filter((r) => !lockedRec.has(`${r.game_id}::${r.market}`));
  result.lockedSkipped = result.records.length - toWrite.length;
  for (const rec of toWrite) {
    const key = `${rec.game_id}::${rec.market}`;
    const existingId = unlockedIdByKey.get(key);
    const cycleId = cycleIdByGame.get(rec.game_id as number);
    if (cycleId) {
      rec.snapshot_json = appendWnbaActionPromotionEvidence({
        existingSnapshot: unlockedSnapshotByKey.get(key) ?? {},
        candidateRecord: rec,
        sourceComputedAt: cycleId,
        capturedAt: nowIso,
      });
    }
    if (existingId !== undefined) {
      const { error } = await supabase.from("prediction_records").update(rec).eq("id", existingId);
      if (error) errors.push(`prediction_records update ${rec.game_id}/${rec.market}: ${error.message}`);
      else result.written++;
      continue;
    }
    const { error } = await supabase.from("prediction_records").insert(rec);
    if (error) errors.push(`prediction_records insert ${rec.game_id}/${rec.market}: ${error.message}`);
    else result.written++;
  }
  logger(`wnba records APPLY: ${result.written} written, ${result.lockedSkipped} locked-skipped`);
  return result;
}
