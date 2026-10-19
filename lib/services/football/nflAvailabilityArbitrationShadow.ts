import type { NflPaidProjectionShadow } from "./balldontlieNflWeeklyProjectionShadow";
import type { NflForwardTeamDepthSnapshot } from "./nflForwardEvidence";
import type { NflExactProviderIndependentScore } from "./nflExactProviderScoreRuntime";
import type { NflProfessionalMarketAuthority } from "./nflProfessionalMarketAuthority";

export const NFL_AVAILABILITY_ARBITRATION_SHADOW_RELEASE =
  "nfl_availability_arbitration_shadow_2026_10_19_r1" as const;

type Winner = "home" | "away";

export type NflAvailabilityArbitrationShadow = {
  release: typeof NFL_AVAILABILITY_ARBITRATION_SHADOW_RELEASE;
  shadowOnly: true;
  productionDecisionEffect: false;
  availabilityReplacement: { away: boolean; home: boolean };
  exactProviderWinner: Winner | null;
  playerAwareWinner: Winner | null;
  targetExcludedProfessionalMoneylineWinner: Winner | null;
  candidateWinner: Winner | null;
  status:
    | "not_applicable"
    | "insufficient_corroboration"
    | "already_aligned"
    | "qualified_agreement";
  professionalReason: string | null;
  professionalSources: string[];
  targetExclusionStatus: "target_excluded_market" | "incumbent_fallback";
  qualificationScope: "last_target_exclusion_iteration";
};

export function buildNflAvailabilityArbitrationShadow(args: {
  providerDepth: { away: NflForwardTeamDepthSnapshot; home: NflForwardTeamDepthSnapshot };
  availabilityAdjustedDepth: { away: NflForwardTeamDepthSnapshot; home: NflForwardTeamDepthSnapshot };
  exactProviderScore: NflExactProviderIndependentScore;
  playerAwareScore: NflPaidProjectionShadow;
  targetExcludedProfessionalAuthority: NflProfessionalMarketAuthority | null;
  targetExclusionStatus: "target_excluded_market" | "incumbent_fallback";
}): NflAvailabilityArbitrationShadow {
  const replacement = {
    away: changedStarter(args.providerDepth.away, args.availabilityAdjustedDepth.away),
    home: changedStarter(args.providerDepth.home, args.availabilityAdjustedDepth.home),
  };
  const exactProviderWinner = winner(args.exactProviderScore.expectedHomeMargin);
  const playerAwareWinner = winner(args.playerAwareScore.projectedHomeMargin);
  const professional = args.targetExcludedProfessionalAuthority?.reads.moneyline ?? null;
  const targetExcludedProfessionalMoneylineWinner = professional?.status === "qualified" &&
    (professional.side === "home" || professional.side === "away")
    ? professional.side
    : null;
  let status: NflAvailabilityArbitrationShadow["status"] = "insufficient_corroboration";
  let candidateWinner: Winner | null = null;
  if (!replacement.away && !replacement.home) {
    status = "not_applicable";
  } else if (playerAwareWinner !== null && playerAwareWinner === targetExcludedProfessionalMoneylineWinner) {
    candidateWinner = playerAwareWinner;
    status = candidateWinner === exactProviderWinner ? "already_aligned" : "qualified_agreement";
  }
  return {
    release: NFL_AVAILABILITY_ARBITRATION_SHADOW_RELEASE,
    shadowOnly: true,
    productionDecisionEffect: false,
    availabilityReplacement: replacement,
    exactProviderWinner,
    playerAwareWinner,
    targetExcludedProfessionalMoneylineWinner,
    candidateWinner,
    status,
    professionalReason: professional?.reason ?? null,
    professionalSources: professional?.sources ?? [],
    targetExclusionStatus: args.targetExclusionStatus,
    qualificationScope: "last_target_exclusion_iteration",
  };
}

function changedStarter(provider: NflForwardTeamDepthSnapshot, adjusted: NflForwardTeamDepthSnapshot): boolean {
  return playerKey(provider.expectedStartingQuarterback) !== playerKey(adjusted.expectedStartingQuarterback);
}

function playerKey(player: NflForwardTeamDepthSnapshot["expectedStartingQuarterback"]): string | null {
  if (!player) return null;
  return player.playerId?.trim() || player.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || null;
}

function winner(homeMargin: number): Winner | null {
  return !Number.isFinite(homeMargin) || homeMargin === 0 ? null : homeMargin > 0 ? "home" : "away";
}
