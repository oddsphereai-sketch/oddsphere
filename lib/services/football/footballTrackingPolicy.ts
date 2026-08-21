import type { FootballSeasonPhase } from "./footballModelContract";

export const FOOTBALL_TRACKING_POLICY_RELEASE =
  "football_tracking_policy_2026_08_19_r1" as const;

export type FootballTrackingEligibility = {
  eligible: boolean;
  reason:
    | "preseason_excluded"
    | "model_not_approved"
    | "official_registry_not_launched"
    | "prediction_not_locked"
    | "eligible_regular_or_postseason";
  appendToExistingLifetime: boolean;
};

/**
 * Lifecycle gate shared by the future NFL writer and grader.
 *
 * This does not launch tracking. NFL remains absent from the official market
 * registry until a validated model release is deliberately promoted. Once it
 * is promoted, eligible locked regular/postseason plays append to the existing
 * NFL lifetime baseline instead of replacing it.
 */
export function footballTrackingEligibility(args: {
  seasonPhase: FootballSeasonPhase;
  modelApproved: boolean;
  officialRegistryLaunched: boolean;
  predictionLocked: boolean;
}): FootballTrackingEligibility {
  if (args.seasonPhase === "preseason") {
    return { eligible: false, reason: "preseason_excluded", appendToExistingLifetime: false };
  }
  if (!args.modelApproved) {
    return { eligible: false, reason: "model_not_approved", appendToExistingLifetime: false };
  }
  if (!args.officialRegistryLaunched) {
    return { eligible: false, reason: "official_registry_not_launched", appendToExistingLifetime: false };
  }
  if (!args.predictionLocked) {
    return { eligible: false, reason: "prediction_not_locked", appendToExistingLifetime: false };
  }
  return { eligible: true, reason: "eligible_regular_or_postseason", appendToExistingLifetime: true };
}
