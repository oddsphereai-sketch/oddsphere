import { CBB_ACTIVATION, CBB_MODEL_RELEASE } from "./releases";

export const CBB_LAUNCH_REQUIREMENTS = [
  "owner_approval", "independent_confirmation", "current_roster_impact_validation", "verified_availability",
  "exact_game_prices", "professional_book_chronology", "public_split_coverage", "cbb_market_reader_qualification",
  "exact_price_grade_calibration", "leased_single_writer", "lock_writer_immutability", "lock_reader_precedence",
  "tracking_w_l_push", "member_snapshot_parity", "load_and_freshness", "model_change_gate", "current_main_integration",
] as const;
export type CbbLaunchRequirement = typeof CBB_LAUNCH_REQUIREMENTS[number];

/** No env switch can bypass qualification. The prelaunch package cannot publish. */
export function cbbLaunchReadiness(proofs: Partial<Record<CbbLaunchRequirement, { passed: boolean; evidence: string }>>) {
  const requirements = CBB_LAUNCH_REQUIREMENTS.map(name => ({ name, passed: proofs[name]?.passed === true && Boolean(proofs[name]?.evidence?.trim()), evidence: proofs[name]?.evidence ?? null }));
  return { release: CBB_MODEL_RELEASE, activation: CBB_ACTIVATION, ready: false as const,
    requirements, remaining: requirements.filter(row => !row.passed).map(row => row.name),
    reason: "Owner requested a private prelaunch build; publication is unavailable in this package." };
}
