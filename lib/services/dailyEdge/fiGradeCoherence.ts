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
  const snapFi = record(args.snapshot?.fi_v2_audit);
  if (text(snapFi?.fi_play_grade) !== args.liveBaseGrade) return false;
  return expectedFinalFiGradeFromResolution({
    baseGrade: args.liveBaseGrade,
    snapshot: args.snapshot,
  }) === args.recordGrade;
}
