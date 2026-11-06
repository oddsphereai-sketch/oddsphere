import type { NflPaidProjectionShadow } from "./balldontlieNflWeeklyProjectionShadow";
import type { NflExactProviderIndependentScore } from "./nflExactProviderScoreRuntime";
import type { NflForwardEvidencePayload } from "./nflForwardEvidence";
import {
  buildNflIndependentScoreBaseForecast,
  buildNflPaidTeamScoreBaseForecast,
  type NflV1WeekOneOutcomeForecast,
} from "./nflV1WeekOneOutcome";

export const NFL_OUTCOME_BASE_AUTHORITY_RELEASE =
  "nfl_outcome_base_authority_2026_11_06_r2_quarterback_regime_continuity" as const;

type Quarterback = { playerId: string | null; name: string } | null;
type Depth = { capturedAt: string; expectedStartingQuarterback: Quarterback };
type QuarterbackRegime = {
  displaced: NonNullable<Quarterback>;
  replacement: NonNullable<Quarterback>;
  observedAt: string;
};
type PreviousState = {
  game: NflForwardEvidencePayload["game"];
  capturedAt: string;
  providerStartersAndDepth?: { away: Depth; home: Depth };
  startersAndDepth: {
    away: Pick<Depth, "expectedStartingQuarterback">;
    home: Pick<Depth, "expectedStartingQuarterback">;
  };
  outcomeBaseAuthority?: NflOutcomeBaseAuthorityReceipt;
};

export type NflOutcomeBaseAuthorityReceipt = {
  release: typeof NFL_OUTCOME_BASE_AUTHORITY_RELEASE |
    "nfl_outcome_base_authority_2026_11_05_r1_player_state_value_separation";
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
  /** Exact-game player identity, not a remembered score, side, grade or price. */
  quarterbackRegime?: { away: QuarterbackRegime | null; home: QuarterbackRegime | null };
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
  capturedAt: string;
  gameStartAt: string;
  previousStates?: readonly PreviousState[];
}): { outcome: NflV1WeekOneOutcomeForecast; receipt: NflOutcomeBaseAuthorityReceipt } {
  const quarterbackRegime = {
    away: currentRegime(args, "away"),
    home: currentRegime(args, "home"),
  };
  const replacement = { away: quarterbackRegime.away !== null, home: quarterbackRegime.home !== null };
  const requiredStateObservedAt = Object.values(quarterbackRegime)
    .flatMap((regime) => regime ? [regime.observedAt] : [])
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const playerAwareCollectedAt = validTimestamp(args.playerAwareScore?.providerCollectedAt ?? null);
  const playerAwareRepresentsReplacement = args.exactProviderScore !== null &&
    args.playerAwareScore !== null &&
    requiredStateObservedAt !== null &&
    playerAwareCollectedAt !== null &&
    Date.parse(playerAwareCollectedAt) >= Date.parse(requiredStateObservedAt) &&
    Date.parse(playerAwareCollectedAt) <= Date.parse(args.capturedAt) &&
    (["away", "home"] as const).every((side) => !quarterbackRegime[side] ||
      quarterbackKey(args.availabilityAdjustedDepth[side].expectedStartingQuarterback) ===
        quarterbackKey(quarterbackRegime[side]!.replacement));

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
        quarterbackRegime,
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
        quarterbackRegime,
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
        quarterbackRegime,
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
      quarterbackRegime,
    },
  };
}

function currentRegime(args: Parameters<typeof selectNflOutcomeBaseAuthority>[0], side: "away" | "home"): QuarterbackRegime | null {
  const current = args.availabilityAdjustedDepth[side].expectedStartingQuarterback;
  let regime: QuarterbackRegime | null = null;
  const previous = (args.previousStates ?? []).filter((prior) =>
    prior.game.providerGameId === args.fallbackForecast.providerGameId &&
    prior.game.away.abbreviation === args.fallbackForecast.awayTeam &&
    prior.game.home.abbreviation === args.fallbackForecast.homeTeam &&
    Date.parse(prior.game.scheduledStart) === Date.parse(args.gameStartAt) &&
    Date.parse(prior.capturedAt) < Date.parse(args.capturedAt))
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  // R1 saved the verified replacement in the two depth inputs, before an
  // explicit continuity receipt existed. Never infer it from a winning pick.
  for (const prior of previous) {
    const priorStarter = prior.startersAndDepth[side].expectedStartingQuarterback;
    if (prior.outcomeBaseAuthority?.quarterbackRegime) {
      regime = prior.outcomeBaseAuthority.quarterbackRegime[side];
      break;
    }
    if (priorStarter && prior.outcomeBaseAuthority?.source === "player_aware_availability_regime") {
      const displaced = prior.providerStartersAndDepth?.[side].expectedStartingQuarterback;
      const observedAt = validTimestamp(prior.outcomeBaseAuthority.requiredStateObservedAt);
      if (displaced && observedAt && Date.parse(observedAt) <= Date.parse(prior.capturedAt) &&
        quarterbackChanged(displaced, priorStarter)) {
        regime = { displaced, replacement: priorStarter, observedAt };
      }
      break;
    }
    if (!priorStarter || current && quarterbackKey(priorStarter) !== quarterbackKey(current)) break;
  }
  if (regime && validTimestamp(regime.observedAt) &&
    Date.parse(regime.observedAt) <= Date.parse(args.capturedAt)) {
    if (!current || quarterbackKey(current) === quarterbackKey(regime.replacement)) return regime;
    // A real return of the displaced starter releases the prior regime.
    if (quarterbackKey(current) === quarterbackKey(regime.displaced)) return null;
  }
  const displaced = args.providerDepth[side].expectedStartingQuarterback;
  const observedAt = validTimestamp(args.providerDepth[side].capturedAt);
  return displaced && current && observedAt && Date.parse(observedAt) <= Date.parse(args.capturedAt) &&
    quarterbackChanged(displaced, current) ? { displaced, replacement: current, observedAt } : null;
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
