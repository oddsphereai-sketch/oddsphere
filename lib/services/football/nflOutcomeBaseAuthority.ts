import type { NflPaidProjectionShadow } from "./balldontlieNflWeeklyProjectionShadow";
import type { NflExactProviderIndependentScore } from "./nflExactProviderScoreRuntime";
import {
  buildNflIndependentScoreBaseForecast,
  buildNflPaidTeamScoreBaseForecast,
  type NflV1WeekOneOutcomeForecast,
} from "./nflV1WeekOneOutcome";

export const NFL_OUTCOME_BASE_AUTHORITY_RELEASE =
  "nfl_outcome_base_authority_2026_11_05_r1_player_state_value_separation" as const;

type Quarterback = { playerId: string | null; name: string } | null;
type Depth = { capturedAt: string; expectedStartingQuarterback: Quarterback };

export type NflOutcomeBaseAuthorityReceipt = {
  release: typeof NFL_OUTCOME_BASE_AUTHORITY_RELEASE;
  source: "exact_provider_state" | "player_aware_availability_regime" | "paid_player_aware" | "legacy_fallback";
  reason:
    | "exact_provider_state_is_complete"
    | "verified_quarterback_replacement_requires_player_aware_state"
    | "exact_provider_state_unavailable"
    | "market_free_runtime_unavailable";
  marketInputPolicy: "prohibited_from_outcome_base" | "legacy_not_attested";
  availabilityReplacement: { away: boolean; home: boolean };
  playerAwareCollectedAt: string | null;
  requiredStateObservedAt: string | null;
};

/**
 * Select exactly one target-free game-state law. This function deliberately
 * accepts no line, price, probability edge, EV, split or sportsbook input.
 */
export function selectNflOutcomeBaseAuthority(args: {
  fallbackForecast: NflV1WeekOneOutcomeForecast;
  exactProviderScore: NflExactProviderIndependentScore | null;
  playerAwareScore: NflPaidProjectionShadow | null;
  providerDepth: { away: Depth; home: Depth };
  availabilityAdjustedDepth: { away: Depth; home: Depth };
}): { outcome: NflV1WeekOneOutcomeForecast; receipt: NflOutcomeBaseAuthorityReceipt } {
  const replacement = {
    away: quarterbackChanged(args.providerDepth.away.expectedStartingQuarterback,
      args.availabilityAdjustedDepth.away.expectedStartingQuarterback),
    home: quarterbackChanged(args.providerDepth.home.expectedStartingQuarterback,
      args.availabilityAdjustedDepth.home.expectedStartingQuarterback),
  };
  const requiredStateObservedAt = latestChangedDepthTimestamp({
    replacement,
    providerDepth: args.providerDepth,
  });
  const playerAwareCollectedAt = validTimestamp(args.playerAwareScore?.providerCollectedAt ?? null);
  const playerAwareRepresentsReplacement = args.exactProviderScore !== null &&
    args.playerAwareScore !== null &&
    requiredStateObservedAt !== null &&
    playerAwareCollectedAt !== null &&
    Date.parse(playerAwareCollectedAt) >= Date.parse(requiredStateObservedAt);

  if (playerAwareRepresentsReplacement) {
    return {
      outcome: buildNflPaidTeamScoreBaseForecast({
        baseForecast: args.fallbackForecast,
        paidTeamScore: args.playerAwareScore!,
      }),
      receipt: {
        release: NFL_OUTCOME_BASE_AUTHORITY_RELEASE,
        source: "player_aware_availability_regime",
        reason: "verified_quarterback_replacement_requires_player_aware_state",
        marketInputPolicy: "prohibited_from_outcome_base",
        availabilityReplacement: replacement,
        playerAwareCollectedAt,
        requiredStateObservedAt,
      },
    };
  }

  if (args.exactProviderScore) {
    return {
      outcome: buildNflIndependentScoreBaseForecast({
        baseForecast: args.fallbackForecast,
        independentScore: args.exactProviderScore,
      }),
      receipt: {
        release: NFL_OUTCOME_BASE_AUTHORITY_RELEASE,
        source: "exact_provider_state",
        reason: "exact_provider_state_is_complete",
        marketInputPolicy: "prohibited_from_outcome_base",
        availabilityReplacement: replacement,
        playerAwareCollectedAt,
        requiredStateObservedAt,
      },
    };
  }

  if (args.playerAwareScore) {
    return {
      outcome: buildNflPaidTeamScoreBaseForecast({
        baseForecast: args.fallbackForecast,
        paidTeamScore: args.playerAwareScore,
      }),
      receipt: {
        release: NFL_OUTCOME_BASE_AUTHORITY_RELEASE,
        source: "paid_player_aware",
        reason: "exact_provider_state_unavailable",
        marketInputPolicy: "prohibited_from_outcome_base",
        availabilityReplacement: replacement,
        playerAwareCollectedAt,
        requiredStateObservedAt,
      },
    };
  }

  return {
    outcome: args.fallbackForecast,
    receipt: {
      release: NFL_OUTCOME_BASE_AUTHORITY_RELEASE,
      source: "legacy_fallback",
      reason: "market_free_runtime_unavailable",
      marketInputPolicy: "legacy_not_attested",
      availabilityReplacement: replacement,
      playerAwareCollectedAt: null,
      requiredStateObservedAt,
    },
  };
}

function latestChangedDepthTimestamp(args: {
  replacement: { away: boolean; home: boolean };
  providerDepth: { away: Depth; home: Depth };
}): string | null {
  const timestamps = (["away", "home"] as const)
    .filter((side) => args.replacement[side])
    .map((side) => validTimestamp(args.providerDepth[side].capturedAt))
    .filter((value): value is string => value !== null)
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  return timestamps[0] ?? null;
}

function quarterbackKey(player: Quarterback): string | null {
  if (!player) return null;
  return player.playerId?.trim() || player.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || null;
}

function quarterbackChanged(provider: Quarterback, adjusted: Quarterback): boolean {
  const providerKey = quarterbackKey(provider);
  const adjustedKey = quarterbackKey(adjusted);
  return providerKey !== null && adjustedKey !== null && providerKey !== adjustedKey;
}

function validTimestamp(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
