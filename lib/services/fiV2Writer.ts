/**
 * Phase 6B.1.7 — FI V2 writer overlay.
 *
 * Runs FI V2 against a GameSnapshot + FI line rows and returns the
 * fields that should override the prediction's first-inning surface:
 *
 *   • predicted_nrfi (boolean | null)
 *   • nrfi_confidence (number | null)
 *   • sport_specific overrides:
 *       - fi_model_used = "fi_v2"
 *       - nrfi_decision_kind = "nrfi" | "yrfi" | "toss_up" | "held"
 *       - hold_picks (FI-scoped — "nrfi" added/removed)
 *       - auto_factors FI expected runs + NRFI/YRFI probabilities aligned to
 *         the authoritative FI V2 posterior
 *       - fi_v2_audit (full FiV2Audit + generated_at + model_version)
 *
 * Pure overlay — the caller merges these into the existing prediction
 * sport_specific blob. Never touches ML / OU / score / locked_at /
 * computed_at / tracking grades.
 *
 * Toss-Up display contract preserved (matches the Push 3B-7 cutover):
 *   • nrfi_decision_kind = "toss_up"
 *   • predicted_nrfi is null: Toss-Up has no hidden directional side
 *   • nrfi_confidence = 52 (the legacy sentinel)
 *
 * Held contract preserved:
 *   • predicted_nrfi = null
 *   • nrfi_confidence = null
 *   • "nrfi" added to hold_picks
 *   • nrfi_decision_kind = "held"
 */

import { runMlbFirstInningModelV2 } from "../automodel/mlbFirstInningModelV2";
import type { FiLineRow } from "../automodel/mlbFirstInningMarketBaseline";
import type { GameSnapshot } from "../automodel/types";

export type FiV2WriterOverride = {
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  sport_specific_overrides: Record<string, unknown>;
};

export function applyFiV2WriterOverride(
  snap: GameSnapshot,
  fiLineRows: FiLineRow[],
  existingSportSpecific: Record<string, unknown>,
  generatedAtIso: string = new Date().toISOString(),
): FiV2WriterOverride {
  const out = runMlbFirstInningModelV2(snap, fiLineRows, generatedAtIso);
  const a = out.fiV2Audit;

  const existingHoldPicksRaw = existingSportSpecific.hold_picks;
  const existingHoldPicks = Array.isArray(existingHoldPicksRaw)
    ? (existingHoldPicksRaw as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const existingAutoFactors =
    existingSportSpecific.auto_factors && typeof existingSportSpecific.auto_factors === "object"
      ? existingSportSpecific.auto_factors as Record<string, unknown>
      : {};

  let predictedNrfi: boolean | null;
  let nrfiConfidence: number | null;
  let decisionKind: "nrfi" | "yrfi" | "toss_up" | "held";
  let newHoldPicks = existingHoldPicks.filter((x) => x !== "nrfi");

  if (a.fi_pick === "NRFI") {
    predictedNrfi = true;
    nrfiConfidence = Math.round(a.posterior_p_nrfi * 100);
    decisionKind = "nrfi";
  } else if (a.fi_pick === "YRFI") {
    predictedNrfi = false;
    nrfiConfidence = Math.round((1 - a.posterior_p_nrfi) * 100);
    decisionKind = "yrfi";
  } else if (a.fi_pick === "Toss-Up") {
    predictedNrfi = null;
    nrfiConfidence = 52;
    decisionKind = "toss_up";
  } else {
    // Held — null pick, push "nrfi" into hold_picks, do NOT fake NRFI.
    predictedNrfi = null;
    nrfiConfidence = null;
    decisionKind = "held";
    newHoldPicks = Array.from(new Set([...newHoldPicks, "nrfi"]));
  }

  return {
    predicted_nrfi: predictedNrfi,
    nrfi_confidence: nrfiConfidence,
    sport_specific_overrides: {
      fi_model_used: "fi_v2",
      nrfi_decision_kind: decisionKind,
      hold_picks: newHoldPicks,
      auto_factors: {
        ...existingAutoFactors,
        nrfi_expected_runs: a.posterior_expected_first_inning_runs,
        nrfi_probability: a.posterior_p_nrfi,
        yrfi_probability: a.posterior_p_yrfi,
      },
      fi_v2_audit: {
        ...a,
        model_version: "fi_v2",
        generated_at: generatedAtIso,
      },
    },
  };
}
