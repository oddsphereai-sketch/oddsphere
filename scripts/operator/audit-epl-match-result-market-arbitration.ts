/**
 * SELECT-only EPL Match Result market-arbitration tournament. The earlier
 * chronological block selects a fixed rule; the final block is opened once.
 * Evaluated-book quotes are excluded and no provider or writer is called.
 */
import { supabase } from "../../lib/db/supabase";
import { selectEplMatchResultSide } from "../../lib/services/epl/eplShadowModel";
import {
  EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE,
  type EplForwardBookVector,
  type EplForwardEvidenceCapture,
  type EplForwardEvidenceHistory,
} from "../../lib/services/epl/eplForwardEvidenceCapture";

type Row = Record<string, unknown>;
type Side = "home" | "draw" | "away";

type Settled = {
  slateDate: string;
  release: string;
  capture: EplForwardEvidenceCapture;
  actualHome: number;
  actualAway: number;
};

type Rule = {
  minimumBooks: number;
  minimumMarketProbability: number;
  minimumProbabilityGap: number;
  requireOriginator: boolean;
  requireMovement: boolean;
};

type Evaluation = {
  games: number;
  correct: number;
  changes: number;
  corrections: number;
  harms: number;
  drawsSelected: number;
};

function object(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function finite(value: unknown): number | null {
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
  const kickoffMs = evidence.captures.length ? Date.parse(evidence.captures[0]!.kickoff) : Number.NaN;
  const boundary = Number.isFinite(lockedMs) ? lockedMs : kickoffMs;
  return evidence.captures
    .filter((capture) => Date.parse(capture.capturedAt) <= boundary && Date.parse(capture.capturedAt) < Date.parse(capture.kickoff))
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0] ?? null;
}

function actualSide(row: Settled): Side {
  return row.actualHome > row.actualAway ? "home" : row.actualHome < row.actualAway ? "away" : "draw";
}

function baselineSide(capture: EplForwardEvidenceCapture): Side {
  return selectEplMatchResultSide({
    lambdaHome: capture.independent.lambdaHome,
    lambdaAway: capture.independent.lambdaAway,
    likelyScore: {
      home: capture.champion.soccerProjection?.likelyScore?.home ?? Math.round(capture.independent.lambdaHome),
      away: capture.champion.soccerProjection?.likelyScore?.away ?? Math.round(capture.independent.lambdaAway),
      probability: capture.champion.soccerProjection?.likelyScoreProbability ?? 0,
    },
    probabilities: capture.independent.probabilities,
  }).side;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function vectorProbability(vector: EplForwardBookVector, side: Side): number | null {
  return finite(vector.outcomes.find((outcome) => outcome.side === side)?.noVigProbability);
}

function marketRead(capture: EplForwardEvidenceCapture) {
  const slice = capture.markets.match_result;
  const vectors = slice.targetExcluded;
  const probabilities = Object.fromEntries((["home", "draw", "away"] as const).map((side) => [
    side,
    median(vectors.flatMap((vector) => {
      const value = vectorProbability(vector, side);
      return value === null ? [] : [value];
    })),
  ])) as Record<Side, number | null>;
  const eligibleSides = (["home", "draw", "away"] as const).filter((side) => probabilities[side] !== null);
  const side = eligibleSides.reduce<Side | null>((best, candidate) =>
    best === null || probabilities[candidate]! > probabilities[best]! ? candidate : best, null);
  const originatorSupport = side !== null && vectors.some((vector) =>
    vector.sourceClass === "named_originator" && vectorProbability(vector, side) !== null &&
    vectorProbability(vector, side)! >= Math.max(...(["home", "draw", "away"] as const).map((candidate) => vectorProbability(vector, candidate) ?? 0))
  );
  const movementDirections = slice.movements.flatMap((movement): Side[] => {
    const deltas = movement.outcomes
      .filter((outcome) => Math.abs(outcome.noVigProbabilityDelta) >= 0.01)
      .sort((left, right) => Math.abs(right.noVigProbabilityDelta) - Math.abs(left.noVigProbabilityDelta));
    if (!deltas.length || deltas[0]!.noVigProbabilityDelta <= 0) return [];
    const movementSide = deltas[0]!.side;
    return movementSide === "home" || movementSide === "draw" || movementSide === "away" ? [movementSide] : [];
  });
  return {
    side,
    probabilities,
    books: vectors.length,
    originatorSupport,
    movementSupport: side !== null && movementDirections.includes(side),
  };
}

function candidateSide(row: Settled, rule: Rule): Side {
  const baseline = baselineSide(row.capture);
  const market = marketRead(row.capture);
  if (market.side === null || market.side === baseline || market.books < rule.minimumBooks) return baseline;
  const marketProbability = market.probabilities[market.side];
  const baselineProbability = market.probabilities[baseline];
  if (marketProbability === null || baselineProbability === null) return baseline;
  if (marketProbability < rule.minimumMarketProbability || marketProbability - baselineProbability < rule.minimumProbabilityGap) return baseline;
  if (rule.requireOriginator && !market.originatorSupport) return baseline;
  if (rule.requireMovement && !market.movementSupport) return baseline;
  return market.side;
}

function evaluate(rows: readonly Settled[], rule: Rule | null): Evaluation {
  let correct = 0;
  let changes = 0;
  let corrections = 0;
  let harms = 0;
  let drawsSelected = 0;
  for (const row of rows) {
    const baseline = baselineSide(row.capture);
    const candidate = rule === null ? baseline : candidateSide(row, rule);
    const actual = actualSide(row);
    if (candidate === actual) correct++;
    if (candidate === "draw") drawsSelected++;
    if (candidate !== baseline) {
      changes++;
      if (candidate === actual && baseline !== actual) corrections++;
      if (candidate !== actual && baseline === actual) harms++;
    }
  }
  return { games: rows.length, correct, changes, corrections, harms, drawsSelected };
}

function ruleKey(rule: Rule): string {
  return [
    `books${rule.minimumBooks}`,
    `p${Math.round(rule.minimumMarketProbability * 100)}`,
    `gap${Math.round(rule.minimumProbabilityGap * 100)}`,
    rule.requireOriginator ? "originator" : "breadth",
    rule.requireMovement ? "movement" : "snapshot",
  ].join("_");
}

async function main(): Promise<void> {
  const { data, error } = await supabase.from("prediction_records")
    .select("slate_date,locked_at,model_version,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
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
    const actualHome = finite(result?.actual_home_score);
    const actualAway = finite(result?.actual_away_score);
    return capture && actualHome !== null && actualAway !== null
      ? [{ slateDate: String(row.slate_date), release: String(row.model_version), capture, actualHome, actualAway }]
      : [];
  });
  const finalSize = Math.min(10, settled.length);
  const selection = settled.slice(0, settled.length - finalSize);
  const holdout = settled.slice(settled.length - finalSize);
  const rules: Rule[] = [2, 3, 4].flatMap((minimumBooks) =>
    [0.4, 0.45, 0.5, 0.55].flatMap((minimumMarketProbability) =>
      [0.03, 0.05, 0.08, 0.1].flatMap((minimumProbabilityGap) =>
        [false, true].flatMap((requireOriginator) => [false, true].map((requireMovement) => ({
          minimumBooks,
          minimumMarketProbability,
          minimumProbabilityGap,
          requireOriginator,
          requireMovement,
        })))
      )
    )
  );
  const ranked = rules.map((rule) => ({ rule, selection: evaluate(selection, rule) }))
    .filter((candidate) => candidate.selection.changes >= 2)
    .sort((left, right) =>
      right.selection.correct - left.selection.correct
      || (right.selection.corrections - right.selection.harms) - (left.selection.corrections - left.selection.harms)
      || left.selection.changes - right.selection.changes
      || ruleKey(left.rule).localeCompare(ruleKey(right.rule))
    );
  const selected = ranked[0] ?? null;
  const baseline = {
    selection: evaluate(selection, null),
    holdout: evaluate(holdout, null),
    all: evaluate(settled, null),
  };
  console.log(JSON.stringify({
    mode: "select_only",
    writes: 0,
    provider_calls: 0,
    releases: {
      capture: EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE,
      active_model: "epl_goals_coherent_2026_10_01_r19_draw_arbitration",
    },
    rows: { all: settled.length, selection: selection.length, holdout: holdout.length },
    baseline,
    selected: selected ? {
      key: ruleKey(selected.rule),
      rule: selected.rule,
      selection: selected.selection,
      holdout: evaluate(holdout, selected.rule),
      all: evaluate(settled, selected.rule),
    } : null,
    top_selection_candidates: ranked.slice(0, 10).map((candidate) => ({
      key: ruleKey(candidate.rule),
      selection: candidate.selection,
    })),
    market_coverage: {
      two_plus_target_excluded: settled.filter((row) => marketRead(row.capture).books >= 2).length,
      originator_available: settled.filter((row) => marketRead(row.capture).originatorSupport).length,
      movement_available: settled.filter((row) => marketRead(row.capture).movementSupport).length,
      model_market_disagreements: settled.filter((row) => {
        const market = marketRead(row.capture);
        return market.side !== null && market.side !== baselineSide(row.capture);
      }).length,
    },
  }, null, 2));
}

void main();
