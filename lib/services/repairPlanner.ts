/**
 * Repair planner — Daily Edge integrity fixer dry-run v1.
 *
 * Pure transformation: takes a current-site auditor report and emits
 * a structured repair plan. This module is intentionally dry-run only.
 * It has no Supabase imports, no file I/O, and no apply path.
 *
 * The CLI wrapper at scripts/operator/fix-current-site-stability.ts
 * shells out to the auditor, loads its JSON report, and calls
 * planRepairs() here. Tests in scripts/test-fix-current-site-
 * stability.ts call planRepairs() directly with synthetic reports —
 * no DB access, no auditor subprocess, no real bad rows required.
 *
 * Design contract:
 *   1. Never mutates input.
 *   2. Never plans a repair that mutates locked picks, confidence,
 *      line, odds, play_grade, model_probability, edge, or rationale.
 *   3. Never plans a DELETE on prediction_records (would erase tracking
 *      history).
 *   4. Never plans the addition of NBA spread or NHL puck-line to the
 *      public prediction_records substrate.
 *   5. "No safe repair candidate exists" is a valid, expected output.
 *   6. apply_supported: false everywhere. v1 is observation-only.
 */

export type Severity = "HIGH" | "WARN" | "INFO";
export type ActiveSport = "mlb" | "nba" | "nhl";

/** Shape of a single auditor Issue (subset of fields we read). */
export type AuditorIssue = {
  code: string;
  severity: Severity;
  sport: ActiveSport | null;
  affected: {
    game_id?: number;
    market?: string;
    details?: string;
  };
  user_facing_impact: string;
  recommended_fix: string;
  auto_fixable: boolean;
  operator_approval_required: boolean;
};

/** Shape of the auditor's full report (subset of fields we read). */
export type AuditorReport = {
  generated_at: string;
  slate_date: string;
  sport_status: Record<ActiveSport, "TRUSTED" | "PARTIAL" | "BLOCKED">;
  cross_sport_issues: AuditorIssue[];
  per_sport_issues: Record<ActiveSport, AuditorIssue[]>;
  summary: { high: number; warn: number; info: number };
};

/**
 * A single planned repair. Every field is required so the planner
 * cannot omit safety-critical context (locked_record_impact,
 * tracking_grading_impact, refusal_reason).
 */
export type RepairPlan = {
  issue_code: string;
  severity: Severity;
  sport: ActiveSport | null;
  affected: {
    game_id?: number;
    market?: string;
    details?: string;
  };
  current_state: string;
  proposed_state: string;
  why_safe: string;
  source_evidence: string;
  exact_repair_function: string;
  rows_that_would_change: string;
  columns_that_would_change: string;
  locked_record_impact: string;
  tracking_grading_impact: string;
  operator_approval_required: boolean;
  auto_fixable: boolean;
  apply_supported: false;
  refusal_reason: string | null;
};

export type FixerReport = {
  generated_at: string;
  audit_generated_at: string;
  slate_date: string;
  sport_status: Record<ActiveSport, "TRUSTED" | "PARTIAL" | "BLOCKED">;
  audit_summary: { high: number; warn: number; info: number };
  fixer_summary: {
    repair_candidates: number;
    refused_repairs: number;
    unrepaired_high: number;
  };
  repair_candidates: RepairPlan[];
  refused_repairs: RepairPlan[];
  notes: string[];
};

// ─── Planners — one per issue code we know how to repair safely ─────

/**
 * FI_UNTRACKED_DISPLAY — game_predictions shows actionable FI but
 * no prediction_records row exists for first_inning. Safe repair:
 * re-run createPredictionRecords which is idempotent + locked-row-aware.
 */
function planFiUntrackedDisplay(issue: AuditorIssue, slateDate: string): RepairPlan {
  const gid = issue.affected.game_id;
  const sport: ActiveSport = (issue.sport ?? "mlb") as ActiveSport;
  return {
    issue_code: issue.code,
    severity: issue.severity,
    sport,
    affected: issue.affected,
    current_state:
      `prediction_records has no first_inning row for game_id=${gid ?? "?"}; ` +
      "game_predictions shows actionable FI play_grade (best_angle or lean)",
    proposed_state:
      "Insert a first_inning prediction_records row mirroring game_predictions.sport_specific.fi_v2_audit (writer-canonical payload).",
    why_safe:
      "createPredictionRecords is idempotent, locked-row-aware (skips locked rows), and writes only the canonical writer payload. " +
      "It does NOT mutate picks, confidence, model outputs, or grading rules — it propagates them from game_predictions, the live writer state.",
    source_evidence:
      "Issue.affected.details + game_predictions.sport_specific.fi_v2_audit for the same game_id (read-only verification by the writer).",
    exact_repair_function:
      `await createPredictionRecords({ sport: "mlb", slateDate: "${slateDate}", launchDay: false, apply: true, supabase })`,
    rows_that_would_change:
      `prediction_records (INSERT) — 1 row for game_id=${gid ?? "?"}, market="first_inning"`,
    columns_that_would_change:
      "All columns of the new row (pick, side, confidence, snapshot_json, etc.); zero UPDATEs to existing rows",
    locked_record_impact:
      "None — INSERT only; createPredictionRecords' upsert is locked-row-aware and would skip any locked row in this slate",
    tracking_grading_impact:
      "Adds a tracked FI row; predictionGrader.gradeFirstInning will grade it once first_inning_runs is set (no_bet=true → void per existing rule).",
    operator_approval_required: issue.operator_approval_required,
    auto_fixable: issue.auto_fixable,
    apply_supported: false,
    refusal_reason: null,
  };
}

/**
 * FI_STATE_DIVERGENCE — unlocked prediction_records.fi_play_grade
 * disagrees with game_predictions.fi_play_grade. Safe repair: re-run
 * createPredictionRecords; unlocked rows are upserted in place.
 */
function planFiStateDivergence(issue: AuditorIssue, slateDate: string): RepairPlan {
  const gid = issue.affected.game_id;
  return {
    issue_code: issue.code,
    severity: issue.severity,
    sport: (issue.sport ?? "mlb") as ActiveSport,
    affected: issue.affected,
    current_state:
      `Unlocked prediction_records.snapshot_json.fi_v2_audit.fi_play_grade for game_id=${gid ?? "?"} ` +
      "disagrees with game_predictions.sport_specific.fi_v2_audit.fi_play_grade (live writer state)",
    proposed_state:
      "Re-upsert the unlocked prediction_records row from game_predictions (the writer's live canonical payload).",
    why_safe:
      "Issue fires only on unlocked rows by design. createPredictionRecords upserts unlocked rows in place with the writer's canonical payload from game_predictions. " +
      "Locked rows are skipped — lock contract preserved.",
    source_evidence:
      "Issue.affected.details + game_predictions (live writer state, already the source of truth for the displayed verdict).",
    exact_repair_function:
      `await createPredictionRecords({ sport: "mlb", slateDate: "${slateDate}", launchDay: false, apply: true, supabase })`,
    rows_that_would_change:
      `prediction_records (UPDATE) — 1 row for game_id=${gid ?? "?"}, market="first_inning"`,
    columns_that_would_change:
      "snapshot_json (fi_v2_audit refreshed), pick / side / confidence (only if they actually changed in the source), no_bet, no_bet_reason",
    locked_record_impact:
      "None — only unlocked rows are matched; locked rows are skipped by the writer.",
    tracking_grading_impact:
      "Tracking will lock the writer's authoritative verdict at T-60; grading rules unchanged.",
    operator_approval_required: issue.operator_approval_required,
    auto_fixable: issue.auto_fixable,
    apply_supported: false,
    refusal_reason: null,
  };
}

/**
 * CONTEXT_SNAPSHOT_MISSING — post-rollout NBA/NHL prediction_record
 * is missing snapshot_json.displayed_context_markets.spread. Safe
 * repair: re-run the sport's writer; lock contract enforces skip.
 */
function planContextSnapshotMissing(issue: AuditorIssue, slateDate: string): RepairPlan {
  const sport: ActiveSport = (issue.sport ?? "nba") as ActiveSport;
  const gid = issue.affected.game_id;
  const market = issue.affected.market ?? "moneyline";
  const writer =
    sport === "nba"
      ? `await createNbaPredictionRecords({ slateDate: "${slateDate}", apply: true })`
      : `await writeNhlPredictionRecords({ slateDate: "${slateDate}", season: <year>, apply: true })`;
  return {
    issue_code: issue.code,
    severity: issue.severity,
    sport,
    affected: issue.affected,
    current_state:
      `prediction_records row for game_id=${gid ?? "?"} market=${market} is post-Commit-A rollout ` +
      "but missing snapshot_json.displayed_context_markets.spread (the auditable record of the Sprd*/PL* chip).",
    proposed_state:
      "Re-run the sport's writer to repopulate the context-only substrate on the existing row. Substrate is additive metadata; no public tracking market changes.",
    why_safe:
      "Substrate is purely additive context (Sprd*/PL* chip metadata). " +
      "The writer is locked-row-aware (skips locked rows). " +
      "No public tracking markets change. No picks/confidence/model outputs change. " +
      "official_tracked is hard-set to false in the substrate type — cannot leak.",
    source_evidence:
      "Live NBA market intelligence / NHL puck-line lines (already read by the writer when building the substrate).",
    exact_repair_function: writer,
    rows_that_would_change:
      `prediction_records (UPDATE) — 1 row for game_id=${gid ?? "?"} market=${market}`,
    columns_that_would_change:
      "snapshot_json (displayed_context_markets.spread added/refreshed). No other columns change.",
    locked_record_impact:
      "None for unlocked rows. Writers skip locked rows by contract; refused for locked rows below.",
    tracking_grading_impact:
      "None — substrate is context-only, never enters tracking/grading (official_tracked=false by type).",
    operator_approval_required: issue.operator_approval_required,
    auto_fixable: issue.auto_fixable,
    apply_supported: false,
    refusal_reason: null,
  };
}

/**
 * SCORE_FINAL_MISSING_SCORE — game final but home_score / away_score
 * null. Safe repair: re-fetch from sport's final-score ingester.
 */
function planScoreFinalMissing(issue: AuditorIssue, slateDate: string): RepairPlan {
  const sport: ActiveSport = (issue.sport ?? "mlb") as ActiveSport;
  const gid = issue.affected.game_id;
  const repair =
    sport === "mlb"
      ? `await ingestMlbLinescores({ date: "${slateDate}", apply: true })`
      : sport === "nba"
      ? `await ingestNbaFinalScores({ slateDate: "${slateDate}", apply: true })`
      : `await ingestNhlFinalScores({ slateDate: "${slateDate}", apply: true })`;
  return {
    issue_code: issue.code,
    severity: issue.severity,
    sport,
    affected: issue.affected,
    current_state:
      `Game ${gid ?? "?"} has terminal status but home_score and/or away_score is null in games table`,
    proposed_state:
      "Re-fetch the game's final scores from the trusted source and update games.{home_score,away_score,first_inning_runs}.",
    why_safe:
      "Final-score backfill replaces nulls with values from the trusted sport-specific source. " +
      "Existing non-null scores are not overwritten by the ingester's upsert. " +
      "Does not touch prediction_records, model outputs, or grades — grading fires downstream once scores are present.",
    source_evidence:
      sport === "mlb"
        ? "MLB Stats API linescore feed"
        : sport === "nba"
        ? "ESPN scoreboard / BDL"
        : "NHL public API",
    exact_repair_function: repair,
    rows_that_would_change: `games (UPDATE) — 1 row for id=${gid ?? "?"}`,
    columns_that_would_change:
      "home_score, away_score, status, first_inning_runs (MLB only)",
    locked_record_impact:
      "None — games table is independent of prediction_records lock state",
    tracking_grading_impact:
      "Downstream grading will fire automatically via predictionGrader once scores are populated",
    operator_approval_required: issue.operator_approval_required,
    auto_fixable: issue.auto_fixable,
    apply_supported: false,
    refusal_reason: null,
  };
}

/**
 * SCORE_STUCK_SCHEDULED — game_date >6h in past but status still
 * scheduled. Safe repair: re-fetch from trusted source.
 */
function planScoreStuckScheduled(issue: AuditorIssue, slateDate: string): RepairPlan {
  const sport: ActiveSport = (issue.sport ?? "mlb") as ActiveSport;
  const gid = issue.affected.game_id;
  const repair =
    sport === "mlb"
      ? `await ingestMlbLinescores({ date: "${slateDate}", apply: true })`
      : sport === "nba"
      ? `await ingestNbaFinalScores({ slateDate: "${slateDate}", apply: true })`
      : `await ingestNhlFinalScores({ slateDate: "${slateDate}", apply: true })`;
  return {
    issue_code: issue.code,
    severity: issue.severity,
    sport,
    affected: issue.affected,
    current_state:
      `Game ${gid ?? "?"} game_date is >6h in the past but status still SCHEDULED — ingester missed the terminal-status transition`,
    proposed_state:
      "Re-fetch the game's status + scores from trusted source so the terminal status propagates.",
    why_safe:
      "Status update propagates the trusted source's terminal status. Picks, lines, model outputs untouched.",
    source_evidence:
      sport === "mlb"
        ? "MLB Stats API"
        : sport === "nba"
        ? "ESPN / BDL"
        : "NHL public API",
    exact_repair_function: repair,
    rows_that_would_change: `games (UPDATE) — 1 row for id=${gid ?? "?"}`,
    columns_that_would_change:
      "status, home_score, away_score, first_inning_runs (if applicable)",
    locked_record_impact: "None",
    tracking_grading_impact:
      "Downstream grading fires automatically once status flips final",
    operator_approval_required: issue.operator_approval_required,
    auto_fixable: issue.auto_fixable,
    apply_supported: false,
    refusal_reason: null,
  };
}

/**
 * FI_GRADING_GAP — games.first_inning_runs != null but
 * prediction_grades.result missing/pending. Safe repair: run the
 * shared grader for the slate.
 */
function planFiGradingGap(issue: AuditorIssue, slateDate: string): RepairPlan {
  const gid = issue.affected.game_id;
  return {
    issue_code: issue.code,
    severity: issue.severity,
    sport: (issue.sport ?? "mlb") as ActiveSport,
    affected: issue.affected,
    current_state:
      `prediction_grades.result for the FI prediction_record on game_id=${gid ?? "?"} is missing or pending despite games.first_inning_runs being set`,
    proposed_state:
      "Run the shared grader for the slate to produce the FI grade row (predictionGrader.gradeFirstInning is deterministic).",
    why_safe:
      "predictionGrader.gradeFirstInning is deterministic: NRFI wins iff first_inning_runs===0; YRFI iff >=1; Toss-Up/no_bet → void per Phase 6B.20. " +
      "Uses the locked snapshot's pick only. Does not mutate prediction_records or any model output. " +
      "shouldUpsertGrade prevents regression: a settled result never gets downgraded to pending.",
    source_evidence:
      "games.first_inning_runs + prediction_records.pick (locked snapshot is authoritative)",
    exact_repair_function:
      `await gradePredictionsForSlate({ sport: "mlb", slateDate: "${slateDate}", apply: true, supabase, source: "auto_score_ingest" })`,
    rows_that_would_change:
      `prediction_grades (UPSERT) — up to 1 row per affected prediction_record (1 in this case)`,
    columns_that_would_change:
      "result, win/loss/push/void/pending flags, actual_first_inning_runs, graded_at, grade_source",
    locked_record_impact:
      "None — grader reads locked snapshot but does not mutate prediction_records",
    tracking_grading_impact:
      "Public W/L tally updates to reflect the resolved FI outcome (or void for Toss-Up/no_bet)",
    operator_approval_required: issue.operator_approval_required,
    auto_fixable: issue.auto_fixable,
    apply_supported: false,
    refusal_reason: null,
  };
}

// ─── Refusal handlers — issues we explicitly refuse to auto-fix ─────

function refuseContextLeakedTracked(issue: AuditorIssue): RepairPlan {
  return {
    issue_code: issue.code,
    severity: issue.severity,
    sport: issue.sport,
    affected: issue.affected,
    current_state:
      "snapshot_json.displayed_context_markets.spread.official_tracked === true (context-only contract violation)",
    proposed_state:
      "(refused) Operator must inspect the writer that produced this row.",
    why_safe: "(refused)",
    source_evidence: issue.affected.details ?? issue.recommended_fix,
    exact_repair_function: "(refused — operator-only path)",
    rows_that_would_change: "(refused)",
    columns_that_would_change: "(refused)",
    locked_record_impact: "Unknown — needs operator inspection",
    tracking_grading_impact:
      "Risk of polluting public tracking aggregations — must not auto-repair",
    operator_approval_required: true,
    auto_fixable: false,
    apply_supported: false,
    refusal_reason:
      "Substrate has official_tracked=true. This is a routing bug, not a writer-state divergence; " +
      "requires operator code inspection and explicit approval to delete/repair.",
  };
}

function refuseContextPublicTrackingPollution(issue: AuditorIssue): RepairPlan {
  return {
    issue_code: issue.code,
    severity: issue.severity,
    sport: issue.sport,
    affected: issue.affected,
    current_state:
      `prediction_records has rows with sport=${issue.sport}, market="spread" — context-only market in public tracking`,
    proposed_state:
      "(refused) Removing prediction_records rows is destructive; requires operator approval.",
    why_safe: "(refused)",
    source_evidence: issue.affected.details ?? issue.recommended_fix,
    exact_repair_function: "(refused — destructive DELETE)",
    rows_that_would_change:
      "(refused — would require DELETE on prediction_records, destroys tracking history)",
    columns_that_would_change: "(refused)",
    locked_record_impact:
      "Could touch locked tracking rows — destructive operation",
    tracking_grading_impact:
      "Would remove tracking history; requires explicit operator approval",
    operator_approval_required: true,
    auto_fixable: false,
    apply_supported: false,
    refusal_reason:
      "Removing prediction_records rows is destructive. Requires explicit operator approval AND investigation of the upstream " +
      "writer that inserted them. Dry-run fixer must never plan destructive ops.",
  };
}

function refuseContextBadLabel(issue: AuditorIssue): RepairPlan {
  return {
    issue_code: issue.code,
    severity: issue.severity,
    sport: issue.sport,
    affected: issue.affected,
    current_state:
      `snapshot_json.displayed_context_markets.spread.display_label is not the expected "Sprd*" (NBA) or "PL*" (NHL)`,
    proposed_state:
      "(refused) Operator should investigate code drift in the writer.",
    why_safe: "(refused)",
    source_evidence: issue.affected.details ?? issue.recommended_fix,
    exact_repair_function: "(refused — investigate writer)",
    rows_that_would_change: "(refused)",
    columns_that_would_change: "(refused)",
    locked_record_impact:
      "Unknown — label drift may indicate a code regression",
    tracking_grading_impact:
      "Label drift implies contract regression; auto-rewriting without fixing the writer would mask the bug",
    operator_approval_required: true,
    auto_fixable: false,
    apply_supported: false,
    refusal_reason:
      "Label drift is a code regression, not a writer-state divergence. Auto-rewriting would mask the upstream bug. " +
      "Operator must inspect the writer and decide.",
  };
}

function refuseUnknownIssue(issue: AuditorIssue): RepairPlan {
  return {
    issue_code: issue.code,
    severity: issue.severity,
    sport: issue.sport,
    affected: issue.affected,
    current_state: issue.affected.details ?? "(see auditor)",
    proposed_state: "(no planner registered)",
    why_safe: "(refused)",
    source_evidence: issue.recommended_fix,
    exact_repair_function: "(refused — operator-only path)",
    rows_that_would_change: "(unknown)",
    columns_that_would_change: "(unknown)",
    locked_record_impact: "Unknown",
    tracking_grading_impact: "Unknown",
    operator_approval_required: issue.operator_approval_required,
    auto_fixable: issue.auto_fixable,
    apply_supported: false,
    refusal_reason:
      `No repair planner registered for issue code "${issue.code}". ` +
      "Operator must follow the auditor's recommended_fix manually.",
  };
}

// ─── Dispatch tables ──────────────────────────────────────────────

const PLANNERS: Record<string, (i: AuditorIssue, slateDate: string) => RepairPlan> = {
  FI_UNTRACKED_DISPLAY: planFiUntrackedDisplay,
  FI_STATE_DIVERGENCE: planFiStateDivergence,
  CONTEXT_SNAPSHOT_MISSING: planContextSnapshotMissing,
  SCORE_FINAL_MISSING_SCORE: planScoreFinalMissing,
  SCORE_STUCK_SCHEDULED: planScoreStuckScheduled,
  FI_GRADING_GAP: planFiGradingGap,
};

const REFUSERS: Record<string, (i: AuditorIssue) => RepairPlan> = {
  CONTEXT_SNAPSHOT_LEAKED_TRACKED: refuseContextLeakedTracked,
  CONTEXT_PUBLIC_TRACKING_POLLUTION: refuseContextPublicTrackingPollution,
  CONTEXT_SNAPSHOT_BAD_LABEL: refuseContextBadLabel,
};

// ─── Main planner ─────────────────────────────────────────────────

export function planRepairs(report: AuditorReport): FixerReport {
  const allIssues: AuditorIssue[] = [
    ...report.cross_sport_issues,
    ...report.per_sport_issues.mlb,
    ...report.per_sport_issues.nba,
    ...report.per_sport_issues.nhl,
  ];

  const actionable = allIssues.filter(
    (i) => i.severity === "HIGH" || i.severity === "WARN",
  );

  const candidates: RepairPlan[] = [];
  const refused: RepairPlan[] = [];
  const notes: string[] = [];

  let unrepairedHigh = 0;

  for (const issue of actionable) {
    const refuser = REFUSERS[issue.code];
    if (refuser !== undefined) {
      refused.push(refuser(issue));
      if (issue.severity === "HIGH") unrepairedHigh++;
      continue;
    }

    const planner = PLANNERS[issue.code];
    if (planner !== undefined && issue.auto_fixable === true) {
      candidates.push(planner(issue, report.slate_date));
      continue;
    }

    // Either no planner registered OR not auto_fixable
    refused.push(refuseUnknownIssue(issue));
    if (issue.severity === "HIGH") unrepairedHigh++;
  }

  if (actionable.length === 0) {
    notes.push(
      "No actionable issues — current site fully TRUSTED. Zero repair candidates, zero refusals.",
    );
  } else if (candidates.length === 0 && refused.length === 0) {
    notes.push(
      "All actionable issues lack a known planner. Operator should consult auditor recommended_fix on each.",
    );
  } else if (unrepairedHigh > 0) {
    notes.push(
      `${unrepairedHigh} HIGH issue(s) have no safe automated repair candidate — operator action required.`,
    );
  }

  // Always note that this is dry-run only
  notes.push(
    "Dry-run only. apply_supported=false on every plan. No DB mutations performed by this script.",
  );

  return {
    generated_at: new Date().toISOString(),
    audit_generated_at: report.generated_at,
    slate_date: report.slate_date,
    sport_status: report.sport_status,
    audit_summary: report.summary,
    fixer_summary: {
      repair_candidates: candidates.length,
      refused_repairs: refused.length,
      unrepaired_high: unrepairedHigh,
    },
    repair_candidates: candidates,
    refused_repairs: refused,
    notes,
  };
}
