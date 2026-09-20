type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function expectedFinalFiGradeFromResolution(args: {
  baseGrade: string | null;
  snapshot: JsonRecord | null;
}): string | null {
  const resolution = record(args.snapshot?.fi_final_grade_resolution);
  if (resolution === null) return args.baseGrade;
  if (text(resolution.original_play_grade) !== args.baseGrade) return null;

  switch (text(resolution.action)) {
    case "promote_to_best_angle":
    case "keep_as_best_angle":
      return "best_angle";
    case "demote_to_lean":
    case "keep_as_lean":
      return "lean";
    case "block_to_no_bet":
      return "no_bet";
    default:
      return null;
  }
}

export function isFinalFiGradeCoherent(args: {
  liveBaseGrade: string | null;
  recordGrade: string | null;
  snapshot: JsonRecord | null;
}): boolean {
  if (args.liveBaseGrade === null || args.recordGrade === null) return false;
  const staleCleanup = record(args.snapshot?.stale_unlocked_fi_cleanup);
  const memberFacing = record(args.snapshot?.member_facing_at_lock);
  if (
    args.liveBaseGrade === "held" &&
    args.recordGrade === "held" &&
    text(staleCleanup?.action) === "neutralize_to_toss_up" &&
    text(staleCleanup?.reason) === "fi_fresh_data_gate_no_current_actionable_prediction" &&
    text(memberFacing?.play_grade) === "held" &&
    memberFacing?.held === true
  ) {
    // The current writer deliberately preserves the prior forecast audit while
    // neutralizing only the unlocked member/tracking tuple after its market
    // evidence becomes stale. That explicit transition is coherent even though
    // fi_v2_audit describes the preceding non-Held model state.
    return true;
  }
  const snapFi = record(args.snapshot?.fi_v2_audit);
  if (text(snapFi?.fi_play_grade) !== args.liveBaseGrade) return false;
  return expectedFinalFiGradeFromResolution({
    baseGrade: args.liveBaseGrade,
    snapshot: args.snapshot,
  }) === args.recordGrade;
}
