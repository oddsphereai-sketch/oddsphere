/**
 * SELECT-only EPL replay of same-book Total movement as sport-specific
 * forecast arbitration. No providers or writers are called.
 */
import { supabase } from "../../lib/db/supabase";
import { deriveEplCoherentMarketOutcome } from "../../lib/services/epl/eplCoherentMarketOutcome";
import {
  EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE,
  type EplForwardBookVector,
  type EplForwardEvidenceCapture,
  type EplForwardEvidenceHistory,
} from "../../lib/services/epl/eplForwardEvidenceCapture";

type Row = Record<string, unknown>;
type Candidate = "incumbent" | "independent" | "movement_gated" | "movement_resistance_veto";

type Settled = {
  slateDate: string;
  release: string;
  capture: EplForwardEvidenceCapture;
  actualHome: number;
  actualAway: number;
};

function object(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function grade(row: Row): Row | null {
  return Array.isArray(row.prediction_grades) ? object(row.prediction_grades[0]) : object(row.prediction_grades);
}

function history(row: Row): EplForwardEvidenceHistory | null {
  const value = object(row.snapshot_json)?.epl_forward_evidence_history;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<EplForwardEvidenceHistory>;
  return candidate.captureRelease === EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE && Array.isArray(candidate.captures)
    ? candidate as EplForwardEvidenceHistory
    : null;
}

function captureAtLock(row: Row, evidence: EplForwardEvidenceHistory): EplForwardEvidenceCapture | null {
  const lockedMs = typeof row.locked_at === "string" ? Date.parse(row.locked_at) : Number.NaN;
  const kickoffMs = evidence.captures.length > 0 ? Date.parse(evidence.captures[0]!.kickoff) : Number.NaN;
  const boundary = Number.isFinite(lockedMs) ? lockedMs : kickoffMs;
  return evidence.captures
    .filter((capture) => Date.parse(capture.capturedAt) <= boundary && Date.parse(capture.capturedAt) < Date.parse(capture.kickoff))
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0] ?? null;
}

function outcome(input: Settled, vectors: EplForwardBookVector[]) {
  const capture = input.capture;
  return deriveEplCoherentMarketOutcome({
    independentLambdaHome: capture.independent.lambdaHome,
    independentLambdaAway: capture.independent.lambdaAway,
    totalVectors: vectors,
    evaluatedMatchResultCanonicalBook: capture.markets.match_result.evaluated?.canonicalBook ?? null,
    evaluatedTotalCanonicalBook: capture.markets.total.evaluated?.canonicalBook ?? null,
    evaluatedBttsCanonicalBook: capture.markets.btts.evaluated?.canonicalBook ?? null,
    providerEventId: capture.markets.total.targetExcluded.find((vector) => vector.providerEventId)?.providerEventId
      ?? capture.markets.total.evaluated?.providerEventId
      ?? null,
    decisionAt: capture.capturedAt,
    kickoff: capture.kickoff,
  });
}

function movementGate(input: Settled, incumbent: ReturnType<typeof outcome>): {
  qualified: boolean;
  strong: boolean;
  targetDirection: "over" | "under" | null;
  direction: "over" | "under" | null;
  supportingBooks: string[];
  originatorBooks: string[];
} {
  const evaluated = input.capture.markets.total.evaluated?.canonicalBook ?? null;
  const alternatives = new Map(input.capture.markets.total.targetExcluded.map((vector) => [vector.identity, vector]));
  const directions = input.capture.markets.total.movements.flatMap((movement) => {
    if (movement.vectorIdentity === input.capture.markets.total.evaluated?.identity) return [];
    const vector = alternatives.get(movement.vectorIdentity);
    if (!vector || vector.canonicalBook === evaluated) return [];
    const over = movement.outcomes.find((row) => row.side === "over");
    if (!over || Math.abs(over.noVigProbabilityDelta) < 0.01) return [];
    return [{
      book: vector.canonicalBook,
      sourceClass: vector.sourceClass,
      direction: over.noVigProbabilityDelta > 0 ? "over" as const : "under" as const,
    }];
  });
  const over = directions.filter((row) => row.direction === "over");
  const under = directions.filter((row) => row.direction === "under");
  const winners = over.length > under.length ? over : under.length > over.length ? under : [];
  const direction = winners[0]?.direction ?? null;
  const targetDirection = incumbent.audit.targetOverProbability === null
    ? null
    : incumbent.audit.targetOverProbability >= 0.5 ? "over" : "under";
  const originators = winners.filter((row) => row.sourceClass === "named_originator");
  const distinctBooks = [...new Set(winners.map((row) => row.book))];
  return {
    qualified: direction !== null && direction === targetDirection &&
      (originators.length >= 1 || distinctBooks.length >= 2),
    strong: direction !== null && (originators.length >= 1 || distinctBooks.length >= 2),
    targetDirection,
    direction,
    supportingBooks: distinctBooks,
    originatorBooks: [...new Set(originators.map((row) => row.book))],
  };
}

function candidateOutcome(input: Settled, candidate: Candidate) {
  const vectors = [
    ...(input.capture.markets.total.evaluated ? [input.capture.markets.total.evaluated] : []),
    ...input.capture.markets.total.targetExcluded,
  ];
  if (candidate === "independent") return { result: outcome(input, []), marketQualified: false, movement: null };
  const incumbent = outcome(input, vectors);
  if (candidate === "incumbent") return {
    result: incumbent,
    marketQualified: incumbent.source === "target_excluded_total_tilt",
    movement: movementGate(input, incumbent),
  };
  const movement = movementGate(input, incumbent);
  if (candidate === "movement_resistance_veto") {
    const resisted = incumbent.source === "target_excluded_total_tilt" &&
      movement.strong && movement.direction !== movement.targetDirection;
    return {
      result: resisted ? outcome(input, []) : incumbent,
      marketQualified: incumbent.source === "target_excluded_total_tilt" && !resisted,
      movement,
    };
  }
  const marketQualified = incumbent.source === "target_excluded_total_tilt" && movement.qualified;
  return { result: marketQualified ? incumbent : outcome(input, []), marketQualified, movement };
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100_000) / 100_000;
}

function summarize(rows: readonly Settled[], candidate: Candidate) {
  const evaluated = rows.map((row) => {
    const { result, marketQualified, movement } = candidateOutcome(row, candidate);
    const independent = outcome(row, []);
    const actualTotal = row.actualHome + row.actualAway;
    const actualOver = actualTotal > 2.5;
    const actualBtts = row.actualHome > 0 && row.actualAway > 0;
    const actualResult = row.actualHome > row.actualAway ? "home" : row.actualHome < row.actualAway ? "away" : "draw";
    const predictedResult = (["home", "draw", "away"] as const).reduce((best, side) =>
      result.markets.match_result[side] > result.markets.match_result[best] ? side : best, "home");
    const predictedOver = result.markets.total.over >= 0.5;
    const independentOver = independent.markets.total.over >= 0.5;
    const predictedBtts = result.markets.btts.yes >= 0.5;
    return {
      totalAbs: Math.abs(result.expectedGoals.home + result.expectedGoals.away - actualTotal),
      teamAbs: (Math.abs(result.expectedGoals.home - row.actualHome) + Math.abs(result.expectedGoals.away - row.actualAway)) / 2,
      totalCorrect: predictedOver === actualOver,
      independentTotalCorrect: independentOver === actualOver,
      totalSideChanged: predictedOver !== independentOver,
      bttsCorrect: predictedBtts === actualBtts,
      resultCorrect: predictedResult === actualResult,
      totalBrier: (result.markets.total.over - Number(actualOver)) ** 2,
      bttsBrier: (result.markets.btts.yes - Number(actualBtts)) ** 2,
      marketQualified,
      movementQualified: movement?.qualified ?? false,
    };
  });
  return {
    games: evaluated.length,
    target_excluded_tilts: evaluated.filter((row) => row.marketQualified).length,
    movement_qualified_tilts: evaluated.filter((row) => row.movementQualified).length,
    team_score_mae: round(mean(evaluated.map((row) => row.teamAbs))),
    total_mae: round(mean(evaluated.map((row) => row.totalAbs))),
    match_result_accuracy: `${evaluated.filter((row) => row.resultCorrect).length}/${evaluated.length}`,
    total_accuracy: `${evaluated.filter((row) => row.totalCorrect).length}/${evaluated.length}`,
    total_side_changes: evaluated.filter((row) => row.totalSideChanged).length,
    total_corrections: evaluated.filter((row) =>
      row.totalSideChanged && row.totalCorrect && !row.independentTotalCorrect).length,
    total_harms: evaluated.filter((row) =>
      row.totalSideChanged && !row.totalCorrect && row.independentTotalCorrect).length,
    total_brier: round(mean(evaluated.map((row) => row.totalBrier))),
    btts_accuracy: `${evaluated.filter((row) => row.bttsCorrect).length}/${evaluated.length}`,
    btts_brier: round(mean(evaluated.map((row) => row.bttsBrier))),
  };
}

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select("game_id,slate_date,locked_at,model_version,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
    .eq("sport", "soccer")
    .eq("market", "match_result")
    .like("model_version", "epl_%")
    .not("locked_at", "is", null)
    .order("slate_date", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  const settled = ((data ?? []) as Row[]).flatMap((row): Settled[] => {
    const evidence = history(row);
    const capture = evidence ? captureAtLock(row, evidence) : null;
    const result = grade(row);
    const actualHome = number(result?.actual_home_score);
    const actualAway = number(result?.actual_away_score);
    return capture && actualHome !== null && actualAway !== null
      ? [{ slateDate: String(row.slate_date), release: String(row.model_version), capture, actualHome, actualAway }]
      : [];
  });
  const finalSize = Math.min(10, settled.length);
  const cohorts = {
    all_forward_captures: settled,
    earlier_block: settled.slice(0, settled.length - finalSize),
    final_chronological_block: settled.slice(settled.length - finalSize),
    r19_only: settled.filter((row) => row.release === "epl_goals_coherent_2026_10_01_r19_draw_arbitration"),
  };
  const candidates: Candidate[] = ["incumbent", "independent", "movement_gated", "movement_resistance_veto"];
  console.log(JSON.stringify({
    mode: "select_only",
    provider_calls: 0,
    writes: 0,
    fixed_movement_gate: {
      minimum_no_vig_probability_move: 0.01,
      corroboration: "at least one target-excluded named originator or two target-excluded named books moving in the current target direction",
      evaluated_book_excluded: true,
    },
    cohorts: Object.fromEntries(Object.entries(cohorts).map(([name, rows]) => [
      name,
      Object.fromEntries(candidates.map((candidate) => [candidate, summarize(rows, candidate)])),
    ])),
  }, null, 2));
}

void main();
