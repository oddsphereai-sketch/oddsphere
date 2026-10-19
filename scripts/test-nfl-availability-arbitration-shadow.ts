import assert from "node:assert/strict";
import {
  buildNflAvailabilityArbitrationShadow,
  NFL_AVAILABILITY_ARBITRATION_SHADOW_RELEASE,
} from "../lib/services/football/nflAvailabilityArbitrationShadow";
import type { NflForwardTeamDepthSnapshot } from "../lib/services/football/nflForwardEvidence";

function depth(team: string, playerId: string, name: string): NflForwardTeamDepthSnapshot {
  const player = {
    playerId, name, position: "QB", depth: "QB1", depthRank: 1,
    injuryStatus: null, explicitStarter: true,
  };
  return {
    provider: "balldontlie", team, capturedAt: "2026-10-18T16:00:00.000Z",
    sourceSnapshotId: null, starterStatus: "projected", expectedStartingQuarterback: player,
    quarterbackDepth: [player], roster: [player],
  };
}

const providerHome = depth("PHI", "hurts", "Jalen Hurts");
const adjustedHome = depth("PHI", "mckee", "Tanner McKee");
const away = depth("CAR", "young", "Bryce Young");
const exact = {
  release: "nfl_exact_provider_score_runtime_2026_10_15_r1",
  artifactRelease: "nfl_exact_provider_score_artifact_2026_10_15_r11",
  modelRelease: "nfl_exact_provider_independent_score_2026_10_15_r11",
  marginRelease: "nfl_exact_provider_margin_2026_10_15_r7",
  totalRelease: "nfl_exact_provider_state_residual_total_2026_10_15_r10",
  marketInputPolicy: "prohibited_from_independent_score" as const,
  homeTeam: "PHI", awayTeam: "CAR", expectedHomeScore: 23, expectedAwayScore: 20,
  expectedHomeMargin: 3, expectedTotal: 43, completeThroughWeek: 5,
} as const;
const paid = {
  release: "nfl_paid_projection_shadow_2026_09_28_r2_direct_score",
  providerCollectedAt: "2026-10-18T16:00:00.000Z",
  projectedHomeMargin: -3.5,
  projectedTotal: 43,
} as never;
const authority = {
  reads: { moneyline: { status: "qualified", side: "away", reason: "stable_two_named_moneyline_prices", sources: ["circa", "pinnacle"] } },
} as never;

const qualified = buildNflAvailabilityArbitrationShadow({
  providerDepth: { away, home: providerHome },
  availabilityAdjustedDepth: { away, home: adjustedHome },
  exactProviderScore: exact,
  playerAwareScore: paid,
  targetExcludedProfessionalAuthority: authority,
  targetExclusionStatus: "incumbent_fallback",
});
assert.equal(qualified.release, NFL_AVAILABILITY_ARBITRATION_SHADOW_RELEASE);
assert.equal(qualified.productionDecisionEffect, false);
assert.equal(qualified.status, "qualified_agreement");
assert.equal(qualified.candidateWinner, "away");
assert.deepEqual(qualified.availabilityReplacement, { away: false, home: true });

const disagreement = buildNflAvailabilityArbitrationShadow({
  providerDepth: { away, home: providerHome },
  availabilityAdjustedDepth: { away, home: adjustedHome },
  exactProviderScore: exact,
  playerAwareScore: paid,
  targetExcludedProfessionalAuthority: { reads: { moneyline: { status: "qualified", side: "home", reason: "stable_two_named_moneyline_prices", sources: ["circa", "pinnacle"] } } } as never,
  targetExclusionStatus: "incumbent_fallback",
});
assert.equal(disagreement.status, "insufficient_corroboration");
assert.equal(disagreement.candidateWinner, null);

const healthyStarter = buildNflAvailabilityArbitrationShadow({
  providerDepth: { away, home: providerHome },
  availabilityAdjustedDepth: { away, home: providerHome },
  exactProviderScore: exact,
  playerAwareScore: paid,
  targetExcludedProfessionalAuthority: authority,
  targetExclusionStatus: "target_excluded_market",
});
assert.equal(healthyStarter.status, "not_applicable");
assert.equal(healthyStarter.productionDecisionEffect, false);

console.log("NFL availability arbitration shadow tests passed.");
