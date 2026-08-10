export type FirstInningSupportTone = "support" | "neutral" | "challenge";

/**
 * Presentation-only context threshold. Each team/starter is judged against
 * the displayed NRFI/YRFI thesis independently; this is not a side-vs-side
 * comparison and never changes a prediction or grade.
 */
export function firstInningSupportTone(
  supportingResults: number,
  sampleSize: number,
): FirstInningSupportTone {
  if (sampleSize <= 0) return "neutral";
  const rate = supportingResults / sampleSize;
  if (rate >= 0.6) return "support";
  if (rate <= 0.4) return "challenge";
  return "neutral";
}
