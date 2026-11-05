import assert from "node:assert/strict";
import type { NflPaidProjectionShadow } from "../lib/services/football/balldontlieNflWeeklyProjectionShadow";
import type { NflExactProviderIndependentScore } from "../lib/services/football/nflExactProviderScoreRuntime";
import {
  NFL_OUTCOME_BASE_AUTHORITY_RELEASE,
  selectNflOutcomeBaseAuthority,
} from "../lib/services/football/nflOutcomeBaseAuthority";
import { getNflV1WeekOneOutcomeForecast } from "../lib/services/football/nflV1WeekOneOutcome";

const fallback = getNflV1WeekOneOutcomeForecast({
  providerGameId: "authority-test",
  awayTeam: "JAX",
  homeTeam: "BAL",
  weeklyFallback: { projectedHomeMargin: -2, marketTotal: 44 },
});
const exact = {
  release: "nfl_exact_provider_score_runtime_2026_10_15_r1",
  artifactRelease: "nfl_exact_provider_score_artifact_2026_10_15_r11",
  modelRelease: "nfl_exact_provider_independent_score_2026_10_15_r11",
  marginRelease: "nfl_exact_provider_margin_2026_10_15_r7",
  totalRelease: "nfl_exact_provider_state_residual_total_2026_10_15_r10",
  marketInputPolicy: "prohibited_from_independent_score",
  homeTeam: "BAL", awayTeam: "JAX", expectedHomeScore: 22, expectedAwayScore: 24,
  expectedHomeMargin: -2, expectedTotal: 46, completeThroughWeek: 8,
} satisfies NflExactProviderIndependentScore;
const paid = {
  release: "nfl_paid_projection_shadow_2026_09_28_r2_direct_score",
  source: "balldontlie_weekly_projections",
  fetchedAt: "2026-11-04T04:06:09.631Z",
  providerCollectedAt: "2026-11-04T03:15:00.702Z",
  providerGameId: "authority-test", awayTeam: "JAX", homeTeam: "BAL",
  awayComponentScore: 27.7, homeComponentScore: 14,
  awayOpponentDstScore: 27.3, homeOpponentDstScore: 13.4,
  expectedAwayScore: 27.3, expectedHomeScore: 13.4,
  projectedHomeMargin: -13.9, projectedTotal: 40.7,
  rowCount: 28, awayRowCount: 14, homeRowCount: 14,
  positions: ["DST", "K", "QB", "RB", "TE", "WR"],
} satisfies NflPaidProjectionShadow;
const qb = (playerId: string, name: string) => ({ playerId, name });
const providerDepth = {
  away: { capturedAt: "2026-11-03T05:06:09.462Z", expectedStartingQuarterback: qb("42", "Trevor Lawrence") },
  home: { capturedAt: "2026-11-03T05:06:09.462Z", expectedStartingQuarterback: qb("80", "Tyler Huntley") },
};
const adjustedDepth = {
  away: providerDepth.away,
  home: { ...providerDepth.home, expectedStartingQuarterback: qb("33936794", "Joe Fagnano") },
};

const replacement = selectNflOutcomeBaseAuthority({
  fallbackForecast: fallback, exactProviderScore: exact, playerAwareScore: paid,
  providerDepth, availabilityAdjustedDepth: adjustedDepth,
});
assert.equal(replacement.receipt.release, NFL_OUTCOME_BASE_AUTHORITY_RELEASE);
assert.equal(replacement.receipt.source, "player_aware_availability_regime");
assert.equal(replacement.receipt.marketInputPolicy, "prohibited_from_outcome_base");
assert.ok(Math.abs((replacement.outcome.expectedHomeScore - replacement.outcome.expectedAwayScore) + 13.9) < 0.02);
assert.ok(Math.abs((replacement.outcome.expectedHomeScore + replacement.outcome.expectedAwayScore) - 40.7) < 0.02);

const noReplacement = selectNflOutcomeBaseAuthority({
  fallbackForecast: fallback, exactProviderScore: exact, playerAwareScore: paid,
  providerDepth, availabilityAdjustedDepth: providerDepth,
});
assert.equal(noReplacement.receipt.source, "exact_provider_state");
assert.ok(Math.abs((noReplacement.outcome.expectedHomeScore - noReplacement.outcome.expectedAwayScore) + 2) < 0.02);

const stalePaid = selectNflOutcomeBaseAuthority({
  fallbackForecast: fallback, exactProviderScore: exact,
  playerAwareScore: { ...paid, providerCollectedAt: "2026-11-02T03:15:00.702Z" },
  providerDepth, availabilityAdjustedDepth: adjustedDepth,
});
assert.equal(stalePaid.receipt.source, "exact_provider_state");

for (const [providerQuarterback, adjustedQuarterback] of [
  [null, adjustedDepth.home.expectedStartingQuarterback],
  [providerDepth.home.expectedStartingQuarterback, null],
] as const) {
  const incompleteIdentity = selectNflOutcomeBaseAuthority({
    fallbackForecast: fallback,
    exactProviderScore: exact,
    playerAwareScore: paid,
    providerDepth: {
      ...providerDepth,
      home: { ...providerDepth.home, expectedStartingQuarterback: providerQuarterback },
    },
    availabilityAdjustedDepth: {
      ...adjustedDepth,
      home: { ...adjustedDepth.home, expectedStartingQuarterback: adjustedQuarterback },
    },
  });
  assert.equal(incompleteIdentity.receipt.source, "exact_provider_state",
    "missing quarterback identity cannot prove a replacement regime");
}

const playerAwareFallback = selectNflOutcomeBaseAuthority({
  fallbackForecast: fallback, exactProviderScore: null, playerAwareScore: paid,
  providerDepth, availabilityAdjustedDepth: providerDepth,
});
assert.equal(playerAwareFallback.receipt.source, "paid_player_aware");
assert.equal(playerAwareFallback.receipt.marketInputPolicy, "prohibited_from_outcome_base");

assert.equal("price" in replacement.receipt, false);
assert.equal("expectedValue" in replacement.receipt, false);
assert.equal("line" in replacement.receipt, false);

console.log("NFL outcome-base authority: price-blind player-state selection passed.");
