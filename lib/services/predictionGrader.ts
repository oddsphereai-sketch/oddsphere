/**
 * Push 4 — Pure-logic prediction grader.
 *
 * Takes a (prediction_records row, game outcome) pair and produces the
 * grade row that should be inserted. Pure function: no DB, no network,
 * no side effects. The operator script and the auto-ingest service
 * both call this so the rules are identical regardless of trigger.
 *
 * Market rules:
 *   - moneyline:
 *       pick="home" wins if winning_team="home"
 *       pick="away" wins if winning_team="away"
 *       push only on canceled/no-contest games (rare; signal via grade_notes)
 *   - total:
 *       over wins when actual_total > line_value
 *       under wins when actual_total < line_value
 *       push when actual_total === line_value
 *       (line_value of .5 means no possible push — handled by inequality)
 *   - first_inning / nrfi / yrfi:
 *       NRFI wins when actual_first_inning_runs === 0
 *       YRFI wins when actual_first_inning_runs >= 1
 *       PENDING if first_inning_runs is null (NEVER inferred from full-game total)
 *   - postponed/canceled games:
 *       result = "void", win/loss/push all false
 *   - games still in progress / not final:
 *       result = "pending"
 *
 * The grader is intentionally light on policy. It doesn't know about
 * sportsbook-specific rules (5-inning minimums, etc.) — those belong
 * in a future per-book grading layer if/when we surface book-specific
 * picks. For V1 launch all picks are model picks, so these rules apply.
 */

import type {
  PredictionRecordRow,
  PredictionGradeRow,
  GradeResult,
  TrackedMarketV17,
} from "../types/domain/Tracking";

/**
 * Outcome inputs from the games table + (for FI) operator manual entry
 * since BDL doesn't expose first-inning splits in the same call as
 * final scores.
 */
export type GameOutcome = {
  /** "scheduled" / "in_progress" / "final" / "postponed" / "canceled" / "suspended". */
  status: string;
  home_score: number | null;
  away_score: number | null;
  /**
   * Combined runs scored in the bottom AND top of the first inning.
   * null when unavailable; pending grade for FI markets until populated.
   */
  first_inning_runs: number | null;
};

export type GradeInputs = {
  record: PredictionRecordRow;
  game: GameOutcome;
  /** Either "auto_score_ingest" or "manual_operator" or "csv_import". */
  source: PredictionGradeRow["grade_source"];
  /** Optional free-text annotation, used for void / postponed clarifications. */
  notes?: string | null;
};

const VOID_STATUSES = new Set(["postponed", "canceled", "cancelled"]);
const IN_PROGRESS_STATUSES = new Set(["scheduled", "STATUS_SCHEDULED", "in_progress", "live", "suspended"]);

function isFinalStatus(s: string): boolean {
  return s === "final" || s === "STATUS_FINAL";
}

function isVoidStatus(s: string): boolean {
  return VOID_STATUSES.has(s.toLowerCase());
}

function isPendingStatus(s: string): boolean {
  return IN_PROGRESS_STATUSES.has(s) || IN_PROGRESS_STATUSES.has(s.toLowerCase());
}

function emptyGrade(
  record: PredictionRecordRow,
  result: GradeResult,
  source: PredictionGradeRow["grade_source"],
  notes: string | null,
): PredictionGradeRow {
  return {
    prediction_record_id: record.id!,
    game_id: record.game_id,
    market: record.market,
    result,
    push: result === "push",
    win: result === "win",
    loss: result === "loss",
    void: result === "void",
    pending: result === "pending",
    actual_home_score: null,
    actual_away_score: null,
    actual_total: null,
    actual_first_inning_runs: null,
    winning_team: null,
    grade_source: source,
    grade_notes: notes,
  };
}

function gradeMoneyline(inputs: GradeInputs): PredictionGradeRow {
  const { record, game, source } = inputs;
  if (game.home_score === null || game.away_score === null) {
    return emptyGrade(record, "pending", source, "missing final scores");
  }
  const total = game.home_score + game.away_score;
  const winningTeam: "home" | "away" | null =
    game.home_score > game.away_score
      ? "home"
      : game.away_score > game.home_score
      ? "away"
      : null;
  const pick = (record.pick ?? "").toLowerCase();
  let result: GradeResult;
  if (winningTeam === null) {
    // Tie — only possible in canceled/no-contest scenarios for MLB.
    // Mark void; caller can re-grade if rule changes.
    result = "void";
  } else if (pick === winningTeam) {
    result = "win";
  } else {
    result = "loss";
  }
  return {
    ...emptyGrade(record, result, source, inputs.notes ?? null),
    actual_home_score: game.home_score,
    actual_away_score: game.away_score,
    actual_total: total,
    winning_team: winningTeam,
  };
}

function gradeTotal(inputs: GradeInputs): PredictionGradeRow {
  const { record, game, source } = inputs;
  if (game.home_score === null || game.away_score === null) {
    return emptyGrade(record, "pending", source, "missing final scores");
  }
  if (record.line_value === null) {
    return emptyGrade(record, "pending", source, "missing line_value");
  }
  const total = game.home_score + game.away_score;
  const pick = (record.pick ?? record.side ?? "").toLowerCase();
  let result: GradeResult;
  if (total > record.line_value) {
    result = pick === "over" ? "win" : "loss";
  } else if (total < record.line_value) {
    result = pick === "under" ? "win" : "loss";
  } else {
    // Exact push (total === line_value)
    result = "push";
  }
  return {
    ...emptyGrade(record, result, source, inputs.notes ?? null),
    actual_home_score: game.home_score,
    actual_away_score: game.away_score,
    actual_total: total,
  };
}

function gradeFirstInning(inputs: GradeInputs): PredictionGradeRow {
  const { record, game, source } = inputs;
  if (game.first_inning_runs === null || game.first_inning_runs === undefined) {
    return emptyGrade(record, "pending", source, "first-inning score unavailable");
  }
  const pick = (record.pick ?? "").toUpperCase();
  // NRFI wins when 1st-inning runs total === 0; YRFI when >= 1.
  // Never inferred from full-game total; if first_inning_runs is set
  // we trust it.
  const isNRFI = pick.startsWith("NRFI");
  const isYRFI = pick.startsWith("YRFI");
  let result: GradeResult;
  if (game.first_inning_runs === 0) {
    result = isNRFI ? "win" : isYRFI ? "loss" : "void";
  } else {
    result = isYRFI ? "win" : isNRFI ? "loss" : "void";
  }
  return {
    ...emptyGrade(record, result, source, inputs.notes ?? null),
    actual_home_score: game.home_score,
    actual_away_score: game.away_score,
    actual_total:
      game.home_score !== null && game.away_score !== null
        ? game.home_score + game.away_score
        : null,
    actual_first_inning_runs: game.first_inning_runs,
  };
}

/**
 * Compute the grade row for a single prediction_records snapshot.
 *
 * Returns a fully-populated PredictionGradeRow ready for insert. The
 * caller is responsible for the actual INSERT; the grader stays pure.
 */
export function gradePrediction(inputs: GradeInputs): PredictionGradeRow {
  const { record, game, source } = inputs;

  // Void / postponed handling — surfaces before any market-specific check.
  if (isVoidStatus(game.status)) {
    return emptyGrade(record, "void", source, `game status=${game.status}`);
  }
  // Pending game — return pending without inferring.
  if (!isFinalStatus(game.status)) {
    if (isPendingStatus(game.status)) {
      return emptyGrade(record, "pending", source, `game status=${game.status}`);
    }
    // Unknown status — fail safe to pending. Operator can re-grade.
    return emptyGrade(record, "pending", source, `unknown game status=${game.status}`);
  }

  // Final game — grade per market.
  const m: TrackedMarketV17 = record.market;
  if (m === "moneyline") return gradeMoneyline(inputs);
  if (m === "total") return gradeTotal(inputs);
  if (m === "first_inning" || m === "nrfi" || m === "yrfi") {
    return gradeFirstInning(inputs);
  }
  // Markets we don't yet grade (spread, double_chance, prop). Return pending
  // so they're visible but not falsely counted.
  return emptyGrade(record, "pending", source, `unsupported market for V1 grader: ${m}`);
}

// ─── small helpers re-exported for tests ───────────────────────────

export const __TEST__ = {
  isFinalStatus,
  isVoidStatus,
  isPendingStatus,
};
