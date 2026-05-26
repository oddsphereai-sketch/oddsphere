/**
 * Grade attribution copy — verbatim from V2.1 spec Part 6 (Signal Source
 * Attribution). Single source of truth shared by the Daily Edge card and
 * the Daily Edge legend so the same grade always reads the same way.
 *
 * V2.1 Part 6 uses [pick] as an explicit placeholder for best_signal —
 * the actual primary pick name (e.g. "NYY ML", "Over 9.5") is interpolated
 * at the call site. Other grades carry generic copy; the placeholder is
 * ignored for those.
 *
 * The legend displays the literal "[pick]" placeholder so members see the
 * variable position; the card replaces it with the row's primary pick
 * derived via the ML → OU → NRFI precedence (matches the precedence
 * marketSignalDerivationService + gradeDerivationService use to pick
 * the row's headline market in 6.3c/6.3d).
 */

import type { Grade } from "@/lib/types/domain/Grade";

/**
 * Token the legend passes in place of an actual pick so members see the
 * variable's position in the best_signal sentence ("Model + sharps agree
 * on [pick].") rather than a real-card example.
 */
export const PICK_PLACEHOLDER = "[pick]" as const;

/**
 * Verbatim from V2.1 Part 6 lines 184-190. Periods included.
 *
 * Fix 1.3 (Gap-21/26/27): accepts `Grade | null`. When grade is null the
 * model didn't generate a pick for this market — copy is the honest
 * "No Pick" attribution per SHARP_SIGNAL_FRAMEWORK.md §"Edge Case
 * Handling — Model didn't pick the market".
 */
export function getAttribution(
  grade: Grade | null,
  primaryPick: string
): string {
  if (grade === null) {
    return "Model didn't generate a pick for this market.";
  }
  switch (grade) {
    case "best_signal":
      return `Model + sharps agree on ${primaryPick}.`;
    case "sharp_confirmed":
      return "Market supports the model pick.";
    case "market_led":
      return "Sharp money is driving this read, even though model edge is light.";
    case "model_only":
      return "Strong model edge with no major market signal.";
    case "market_watch":
      return "Movement exists, but signal is mixed.";
    case "public_smoke":
      return "Public is heavy on this side, but sharp confirmation is weak.";
    case "sharp_conflict":
      return "Market is moving against the model.";
  }
}
