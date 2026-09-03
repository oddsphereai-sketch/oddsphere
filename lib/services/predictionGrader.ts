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

import {
  gradeMatchResult,
  gradeDoubleChance,
  gradeBtts,
  gradeTotalGoals,
  type MatchResultPick,
  type DoubleChancePick,
  type BttsPick,
  type TotalGoalsPick,
} from "./soccer/soccerGrading";
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
// Phase 7L Step 5 — extend in-progress/pending recognition so NHL
// pre-puck ("FUT"/"PRE") and live mid-game ("LIVE"/"CRIT") don't fall
// through to the "unknown status" branch. Additive only; MLB
// ("scheduled"/"in_progress") and NBA ("STATUS_*") behavior unchanged.
const IN_PROGRESS_STATUSES = new Set([
  "scheduled", "STATUS_SCHEDULED", "in_progress", "live", "suspended",
  "FUT", "PRE", "LIVE", "CRIT",
]);

// Recognize the terminal vocabulary emitted by every authoritative score
// ingester. EPL normalizes BallDontLie's final state to "completed" in the
// games table, while MLB, NBA, and NHL use their provider-native final tokens.
function isFinalStatus(s: string): boolean {
  const normalized = s.trim().toLowerCase().replace(/^status_/, "");
  return normalized === "final" || normalized === "completed" || normalized === "off";
}

function isVoidStatus(s: string): boolean {
  const normalized = s.trim().toLowerCase().replace(/^status_/, "");
  return VOID_STATUSES.has(normalized);
}

function isPendingStatus(s: string): boolean {
  return IN_PROGRESS_STATUSES.has(s) || IN_PROGRESS_STATUSES.has(s.toLowerCase());
}

/**
 * Canonical side tokens used by grading logic. Markets only resolve when
 * the comparison value is one of these strings.
 */
const VALID_TOTAL_TOKENS = new Set(["over", "under"]);
const VALID_ML_TOKENS = new Set(["home", "away"]);

/**
 * Resolve a comparable side token from a prediction_records row. Prefers
 * `pick` when it is already a canonical token (MLB/NBA store canonical
 * tokens in pick); falls back to `side` when `pick` is a display label
 * (NHL stores team-label picks like "CAR ML" / "OVER 5.5" while side
 * carries the canonical token).
 */
function resolveSideToken(
  record: PredictionRecordRow,
  validTokens: Set<string>,
): string {
  const rawPick = (record.pick ?? "").toString().trim().toLowerCase();
  if (validTokens.has(rawPick)) return rawPick;
  const rawSide = (record.side ?? "").toString().trim().toLowerCase();
  if (validTokens.has(rawSide)) return rawSide;
  // Return the (lowercased) pick string even if non-canonical so the
  // comparison falls through to "loss" rather than crashing.
  return rawPick;
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
  const pickToken = resolveSideToken(record, VALID_ML_TOKENS);
  let result: GradeResult;
  if (winningTeam === null) {
    // Tie — only possible in canceled/no-contest scenarios for MLB.
    // Mark void; caller can re-grade if rule changes.
    result = "void";
  } else if (pickToken === winningTeam) {
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
  const pickToken = resolveSideToken(record, VALID_TOTAL_TOKENS);
  let result: GradeResult;
  if (total > record.line_value) {
    result = pickToken === "over" ? "win" : "loss";
  } else if (total < record.line_value) {
    result = pickToken === "under" ? "win" : "loss";
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

function gradeSpread(inputs: GradeInputs): PredictionGradeRow {
  const { record, game, source } = inputs;
  if (game.home_score === null || game.away_score === null) {
    return emptyGrade(record, "pending", source, "missing final scores");
  }
  if (record.line_value === null) {
    return emptyGrade(record, "pending", source, "missing line_value");
  }
  const sideToken = resolveSideToken(record, VALID_ML_TOKENS); // home | away
  if (sideToken !== "home" && sideToken !== "away") {
    return emptyGrade(record, "void", source, `invalid spread side: ${record.side ?? record.pick}`);
  }
  // line_value is the spread FOR THE PICKED SIDE (home −2.5 / away +7.5). The
  // pick covers when (pickMargin + line_value) > 0; exactly 0 is a push;
  // < 0 is a loss. Half-point lines can never push.
  const pickMargin =
    sideToken === "home" ? game.home_score - game.away_score : game.away_score - game.home_score;
  const cover = pickMargin + record.line_value;
  const result: GradeResult = cover > 0 ? "win" : cover < 0 ? "loss" : "push";
  return {
    ...emptyGrade(record, result, source, inputs.notes ?? null),
    actual_home_score: game.home_score,
    actual_away_score: game.away_score,
    actual_total: game.home_score + game.away_score,
    winning_team:
      game.home_score > game.away_score ? "home" : game.away_score > game.home_score ? "away" : null,
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

  // A UCL Held row is an atomic-lock manifest entry, not a scored forecast.
  // It remains immutable/auditable but can never become a synthetic W/L when
  // an exact price (and therefore canonical evaluated side) was unavailable.
  if (
    record.held === true
    && (record.competition ?? record.snapshot_json?.competition) === "uefa_champions_league"
  ) {
    return emptyGrade(record, "void", source, "UCL market held at lock: excluded from accuracy and ROI");
  }

  // Phase 6B.20 — non-actionable rows (no_bet=true) never count as
  // win/loss. Returns void with a clear note so the row is auditable
  // but excluded from public W/L tallies. Covers Toss-Up FI rows
  // (locked pill was "Toss-Up", not NRFI/YRFI) and any future ML/OU
  // no_bet flagging.
  if (record.no_bet === true) {
    // Soccer DOUBLE_CHANCE held SOLELY for missing odds (MARKET_ODDS_MISSING)
    // still has a fully score-determined outcome — grade win/loss from the
    // final regulation score so accuracy tracking counts it. Missing odds only
    // makes it ROI-INELIGIBLE (odds_american is null → downstream ROI/profit
    // naturally excludes it); it must NOT be voided. Scoped to double_chance to
    // leave match_result / total / btts / FI behavior unchanged, and only when
    // a final score exists. Other no_bet reasons (e.g. MODEL_WRONG_SIDE_OF_MARKET,
    // Toss-Up) stay void.
    const soccer = record.sport === "soccer" || record.sport === "ucl";
    const oddsMissingHold = record.no_bet_reason === "MARKET_ODDS_MISSING";
    const finalScore =
      isFinalStatus(game.status) && game.home_score !== null && game.away_score !== null;
    if (soccer && record.market === "double_chance" && oddsMissingHold && finalScore) {
      const graded = gradeSoccer(inputs);
      return {
        ...graded,
        grade_notes: `${graded.grade_notes ?? ""} | ROI-ineligible: double_chance odds missing at lock (graded from final score)`,
      };
    }
    // No Bet / No Play is a GUIDANCE signal ("we don't advise betting this"),
    // NOT a tracking exclusion. A no_bet pick with a real side IS graded and
    // COUNTS toward the W-L record (Daniel, repeatedly). The ONLY thing withheld
    // is a Toss-Up (no real side) — and Toss-Ups are First Inning only. (ROI in
    // HQ can still drop null-odds rows; that's separate from accuracy W-L.)
    const isTossUp =
      record.prediction_type === "toss_up" ||
      String(record.pick ?? "").trim().toLowerCase() === "toss-up";
    if (isTossUp) {
      return emptyGrade(record, "void", source, "non-actionable: toss-up (no side) — FI-only, not tracked");
    }
    // else: fall through to normal market grading below — win/loss/push count.
  }

  // Phase 6B.19 — FI markets grade as soon as first_inning_runs is
  // available (mid-game), not at full final. The linescore ingester
  // populates `games.first_inning_runs` once inning 1 closes; FI
  // grading should not have to wait for the full game to finalize.
  // ML / OU still gate on status=final below.
  const m: TrackedMarketV17 = record.market;
  if (m === "first_inning" || m === "nrfi" || m === "yrfi") {
    // gradeFirstInning's own guard returns pending when
    // first_inning_runs is null, so we can route here regardless of
    // status and the function will do the right thing.
    return gradeFirstInning(inputs);
  }

  // Pending game — return pending without inferring (ML/OU only).
  if (!isFinalStatus(game.status)) {
    if (isPendingStatus(game.status)) {
      return emptyGrade(record, "pending", source, `game status=${game.status}`);
    }
    // Unknown status — fail safe to pending. Operator can re-grade.
    return emptyGrade(record, "pending", source, `unknown game status=${game.status}`);
  }

  // Soccer markets grade via the soccer-native grader on the 90'
  // regulation score: 3-way Match Result, Double Chance, Total goals (with
  // push handling), and BTTS. Routed by sport so the shared `total` market
  // doesn't fall into the MLB runs-total path.
  if (record.sport === "soccer" || record.sport === "ucl") {
    return gradeSoccer(inputs);
  }

  // Final game — grade per market.
  if (m === "moneyline") return gradeMoneyline(inputs);
  if (m === "total") return gradeTotal(inputs);
  if (m === "spread") return gradeSpread(inputs);
  // Markets we don't yet grade (prop). Return pending so they're
  // visible but not falsely counted.
  return emptyGrade(record, "pending", source, `unsupported market for V1 grader: ${m}`);
}

/**
 * Grade a soccer prediction_record using the soccer-native grader. Final
 * 90' regulation score comes from games.home_score/away_score. Picks are
 * canonical tokens stored per market (match_result→home/draw/away,
 * double_chance→home_or_draw/..., total→over/under, btts→yes/no).
 */
function gradeSoccer(inputs: GradeInputs): PredictionGradeRow {
  const { record, game, source } = inputs;
  if (game.home_score === null || game.away_score === null) {
    return emptyGrade(record, "pending", source, "missing final regulation score");
  }
  const ft = { home_goals_ft: game.home_score, away_goals_ft: game.away_score };
  const token = (record.pick ?? record.side ?? "").toString().trim().toLowerCase();
  let res;
  switch (record.market) {
    case "match_result":
      res = gradeMatchResult(token as MatchResultPick, ft);
      break;
    case "double_chance":
      res = gradeDoubleChance(token as DoubleChancePick, ft);
      break;
    case "btts":
      res = gradeBtts(token as BttsPick, ft);
      break;
    case "total":
      if (record.line_value === null) {
        return emptyGrade(record, "pending", source, "missing line_value for soccer total");
      }
      res = gradeTotalGoals(token as TotalGoalsPick, record.line_value, ft);
      break;
    default:
      return emptyGrade(record, "pending", source, `unsupported soccer market: ${record.market}`);
  }
  return {
    ...emptyGrade(record, res.result, source, res.notes),
    actual_home_score: game.home_score,
    actual_away_score: game.away_score,
    actual_total: game.home_score + game.away_score,
  };
}

// ─── small helpers re-exported for tests ───────────────────────────

export const __TEST__ = {
  isFinalStatus,
  isVoidStatus,
  isPendingStatus,
};
