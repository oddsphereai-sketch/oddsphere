import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import type { NflForwardEvidencePayload, NflForwardStoredEvidence } from "../lib/services/football/nflForwardEvidence";
import { buildNflWeekOneHeldMemberFixture } from "../lib/services/football/nflWeekOneHeldMemberFixture";
import { buildNflOfficialTrackingRecords } from "../lib/services/football/nflOfficialTrackingRecord";
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
  capturedAt: "2026-11-05T23:36:41.650Z", gameStartAt: "2026-11-06T01:15:00.000Z",
  fallbackForecast: fallback, exactProviderScore: exact, playerAwareScore: paid,
  providerDepth, availabilityAdjustedDepth: adjustedDepth,
});
assert.equal(replacement.receipt.release, NFL_OUTCOME_BASE_AUTHORITY_RELEASE);
assert.equal(replacement.receipt.source, "player_aware_availability_regime");
assert.equal(replacement.receipt.marketInputPolicy, "prohibited_from_outcome_base");
assert.ok(Math.abs((replacement.outcome.expectedHomeScore - replacement.outcome.expectedAwayScore) + 13.9) < 0.02);
assert.ok(Math.abs((replacement.outcome.expectedHomeScore + replacement.outcome.expectedAwayScore) - 40.7) < 0.02);

const noReplacement = selectNflOutcomeBaseAuthority({
  capturedAt: "2026-11-05T23:36:41.650Z", gameStartAt: "2026-11-06T01:15:00.000Z",
  fallbackForecast: fallback, exactProviderScore: exact, playerAwareScore: paid,
  providerDepth, availabilityAdjustedDepth: providerDepth,
});
assert.equal(noReplacement.receipt.source, "exact_provider_state");
assert.ok(Math.abs((noReplacement.outcome.expectedHomeScore - noReplacement.outcome.expectedAwayScore) + 2) < 0.02);

const stalePaid = selectNflOutcomeBaseAuthority({
  capturedAt: "2026-11-05T23:36:41.650Z", gameStartAt: "2026-11-06T01:15:00.000Z",
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
    capturedAt: "2026-11-05T23:36:41.650Z", gameStartAt: "2026-11-06T01:15:00.000Z",
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
  capturedAt: "2026-11-05T23:36:41.650Z", gameStartAt: "2026-11-06T01:15:00.000Z",
  fallbackForecast: fallback, exactProviderScore: null, playerAwareScore: paid,
  providerDepth, availabilityAdjustedDepth: providerDepth,
});
assert.equal(playerAwareFallback.receipt.source, "paid_player_aware");
assert.equal(playerAwareFallback.receipt.marketInputPolicy, "prohibited_from_outcome_base");

assert.equal("price" in replacement.receipt, false);
assert.equal("expectedValue" in replacement.receipt, false);
assert.equal("line" in replacement.receipt, false);

console.log("NFL outcome-base authority: price-blind player-state selection passed.");

// Actual pregame source packets. The known final result is not used by any assertion.
const packets = JSON.parse(gunzipSync(readFileSync("scripts/fixtures/nfl-qb-regime-jax-bal-20261105.json.gz")).toString()) as
  Array<{ id: string; captured_at: string; payload_sha256: string; payload: NflForwardEvidencePayload }>;
const [locked, prior] = packets.map((row) => row.payload);
const bytesBefore = JSON.stringify(packets);
const actualArgs = {
  fallbackForecast: getNflV1WeekOneOutcomeForecast({ providerGameId: locked.game.providerGameId,
    awayTeam: "JAX", homeTeam: "BAL", weeklyFallback: { projectedHomeMargin: -2, marketTotal: 46 } }),
  exactProviderScore: locked.exactProviderScoreShadow!, playerAwareScore: locked.paidProjectionShadow!,
  providerDepth: locked.providerStartersAndDepth!, availabilityAdjustedDepth: locked.startersAndDepth,
  capturedAt: locked.capturedAt, gameStartAt: locked.game.scheduledStart, previousStates: [prior],
};
const caughtUp = selectNflOutcomeBaseAuthority(actualArgs);
assert.equal(prior.startersAndDepth.home.expectedStartingQuarterback!.playerId,
  locked.startersAndDepth.home.expectedStartingQuarterback!.playerId, "the actual starter did not change");
assert.equal(locked.outcomeBaseAuthority!.source, "exact_provider_state", "original packet reproduces the defect");
assert.equal(caughtUp.receipt.source, "player_aware_availability_regime");
assert.equal(caughtUp.receipt.availabilityReplacement.home, true);
assert.equal(caughtUp.receipt.requiredStateObservedAt, prior.outcomeBaseAuthority!.requiredStateObservedAt);
assert.ok(Math.abs(caughtUp.outcome.expectedHomeScore - locked.paidProjectionShadow!.expectedHomeScore) < 0.02);
assert.ok(Math.abs(caughtUp.outcome.expectedAwayScore - locked.paidProjectionShadow!.expectedAwayScore) < 0.02);

// R1 migration can cross only consecutive packets with the same actual starter.
assert.equal(selectNflOutcomeBaseAuthority({ ...actualArgs, previousStates: [prior, {
  ...locked, capturedAt: "2026-11-06T00:20:00Z",
}] }).receipt.source, "player_aware_availability_regime");
const continued = { ...locked, capturedAt: "2026-11-06T00:22:00Z", outcomeBaseAuthority: caughtUp.receipt };
const newer = { ...actualArgs, capturedAt: "2026-11-06T00:23:00Z", previousStates: [continued],
  playerAwareScore: { ...actualArgs.playerAwareScore, expectedAwayScore: 26, expectedHomeScore: 15,
    projectedHomeMargin: -11, projectedTotal: 41, providerCollectedAt: "2026-11-06T00:22:30Z" } };
const updated = selectNflOutcomeBaseAuthority(newer);
assert.equal(updated.receipt.source, "player_aware_availability_regime");
assert.ok(Math.abs(updated.outcome.expectedHomeScore - 15) < 0.02, "new inputs are consumed; scores are not pinned");
const originalQuarterback = prior.providerStartersAndDepth!.home.expectedStartingQuarterback!;
const returned = selectNflOutcomeBaseAuthority({ ...newer, availabilityAdjustedDepth: {
  ...newer.availabilityAdjustedDepth, home: { ...newer.availabilityAdjustedDepth.home,
    expectedStartingQuarterback: originalQuarterback },
} });
assert.equal(returned.receipt.source, "exact_provider_state", "a genuine starter return releases continuity");
assert.equal(returned.receipt.quarterbackRegime!.home, null);
const cleared = { ...continued, outcomeBaseAuthority: returned.receipt,
  startersAndDepth: { ...continued.startersAndDepth, home: { ...continued.startersAndDepth.home,
    expectedStartingQuarterback: originalQuarterback } } };
assert.equal(selectNflOutcomeBaseAuthority({ ...actualArgs, capturedAt: "2026-11-06T00:23:00Z",
  previousStates: [prior, cleared], providerDepth: prior.providerStartersAndDepth!,
  availabilityAdjustedDepth: prior.providerStartersAndDepth! }).receipt.source, "exact_provider_state");

const thirdQuarterback = { ...originalQuarterback, playerId: "third-qb", name: "Third Quarterback" };
const thirdDepth = { ...locked.startersAndDepth, home: { ...locked.startersAndDepth.home,
  capturedAt: "2026-11-06T00:22:00Z", expectedStartingQuarterback: thirdQuarterback } };
assert.equal(selectNflOutcomeBaseAuthority({ ...newer, providerDepth: thirdDepth,
  availabilityAdjustedDepth: thirdDepth }).receipt.source, "exact_provider_state",
  "a different starter cannot inherit the prior replacement proof");
for (const previousStates of [[], [{ ...prior, game: { ...prior.game, providerGameId: "another-game" } }],
  [{ ...prior, capturedAt: "2026-11-06T00:30:00Z" }],
  [{ ...prior, game: { ...prior.game, scheduledStart: "2026-11-07T01:15:00Z" } }],
  [{ ...prior, game: { ...prior.game, away: { ...prior.game.away, abbreviation: "NE" } } }],
  [{ ...prior, capturedAt: "2026-11-06T00:20:00Z", startersAndDepth: thirdDepth }, prior],
]) {
  assert.equal(selectNflOutcomeBaseAuthority({ ...actualArgs, previousStates }).receipt.source, "exact_provider_state",
    "cross-game, future, changed-clock, interrupted or absent proof cannot carry a regime");
}
assert.equal(selectNflOutcomeBaseAuthority({ ...actualArgs, playerAwareScore: {
  ...actualArgs.playerAwareScore, providerCollectedAt: "2026-11-02T00:00:00Z",
} }).receipt.source, "exact_provider_state", "stale player-state input is not made fresh by continuity");
assert.equal(selectNflOutcomeBaseAuthority({ ...actualArgs, playerAwareScore: {
  ...actualArgs.playerAwareScore, providerCollectedAt: "2026-11-06T00:30:00Z",
} }).receipt.source, "exact_provider_state", "future information is inadmissible");

// Historical locks are never passed back through this new selector by readers or tracking.
const storedRows: NflForwardStoredEvidence[] = packets.map((row) => ({ id: row.id,
  providerGameId: row.payload.game.providerGameId, stage: row.payload.stage,
  capturedAt: row.payload.capturedAt, gameStartAt: row.payload.game.scheduledStart,
  payloadSha256: row.payload_sha256, payload: row.payload }));
const currentRows = JSON.parse(gunzipSync(readFileSync("scripts/fixtures/nfl-qb-regime-current-20261106.json.gz")).toString()) as
  Array<{ id: string; provider_game_id: string; stage: "unlocked" | "t60"; captured_at: string;
    game_start_at: string; payload_sha256: string; payload: NflForwardEvidencePayload }>;
const siblings = currentRows.filter(row => row.provider_game_id !== "1392337").map(row => ({
  id: row.id, providerGameId: row.provider_game_id, stage: row.stage, capturedAt: row.captured_at,
  gameStartAt: row.game_start_at, payloadSha256: row.payload_sha256, payload: row.payload,
}));
const historicFixture = buildNflWeekOneHeldMemberFixture([...storedRows, ...siblings]);
const historicGame = historicFixture.snapshot.games.find((game) => game.id === "nfl-1392337")!;
assert.ok(historicGame, "R62 locked member remains readable after release transition");
assert.equal(historicGame.markets.first_inning.pick, "BAL +9.5");
assert.equal(historicGame.markets.first_inning.verdict.label, "Lean");
assert.equal(historicGame.projected.away, locked.outcomeForecast!.representativeAwayScore);
assert.equal(historicGame.projected.home, locked.outcomeForecast!.representativeHomeScore);
const historicTracking = buildNflOfficialTrackingRecords({ payload: locked, gameId: 214933 });
const historicSpread = historicTracking.find((row) => row.market === "spread")!;
assert.equal(historicSpread.pick, "BAL");
assert.equal(historicSpread.line_value, 9.5);
assert.equal(historicSpread.model_version, "nfl_v1_daily_edge_decision_2026_11_05_r64_outcome_value_separation");
assert.equal(JSON.stringify(packets), bytesBefore, "offline comparison, readers and writer serialization preserve every locked byte");
console.log("NFL actual JAX/BAL catch-up, source freshness, real starter changes, identity boundaries and R62 lock precedence passed; source packets SHA256=" +
  createHash("sha256").update(bytesBefore).digest("hex"));

const retained = JSON.parse(gunzipSync(readFileSync("scripts/fixtures/nfl-qb-regime-history-20261106.json.gz")).toString()) as
  Array<{ game: NflForwardEvidencePayload["game"]; capturedAt: string;
    authority: NflForwardEvidencePayload["outcomeBaseAuthority"];
    providerAwayAt: string; providerHomeAt: string;
    providerAway: NonNullable<NflForwardEvidencePayload["providerStartersAndDepth"]>["away"]["expectedStartingQuarterback"];
    providerHome: NonNullable<NflForwardEvidencePayload["providerStartersAndDepth"]>["home"]["expectedStartingQuarterback"];
    adjustedAway: NflForwardEvidencePayload["startersAndDepth"]["away"]["expectedStartingQuarterback"];
    adjustedHome: NflForwardEvidencePayload["startersAndDepth"]["home"]["expectedStartingQuarterback"] }>;
const priorIdentities = retained.map(row => ({game: row.game, capturedAt: row.capturedAt,
  outcomeBaseAuthority: row.authority,
  providerStartersAndDepth: {away: {capturedAt: row.providerAwayAt, expectedStartingQuarterback: row.providerAway},
    home: {capturedAt: row.providerHomeAt, expectedStartingQuarterback: row.providerHome}},
  startersAndDepth: {away: {expectedStartingQuarterback: row.adjustedAway},home: {expectedStartingQuarterback: row.adjustedHome}},
})) as Parameters<typeof selectNflOutcomeBaseAuthority>[0]["previousStates"];
for (const row of currentRows.filter(row => row.stage !== "t60")) {
  const p = row.payload, exact = p.exactProviderScoreShadow!;
  const input = { fallbackForecast: getNflV1WeekOneOutcomeForecast({ providerGameId: p.game.providerGameId,
    awayTeam: p.game.away.abbreviation, homeTeam: p.game.home.abbreviation,
    weeklyFallback: { projectedHomeMargin: exact.expectedHomeMargin, marketTotal: exact.expectedTotal } }),
    exactProviderScore: exact, playerAwareScore: p.paidProjectionShadow!, providerDepth: p.providerStartersAndDepth!,
    availabilityAdjustedDepth: p.startersAndDepth, capturedAt: p.capturedAt, gameStartAt: p.game.scheduledStart };
  const unchanged = selectNflOutcomeBaseAuthority(input), candidate = selectNflOutcomeBaseAuthority({ ...input,
    previousStates: priorIdentities });
  assert.deepEqual(candidate.outcome, unchanged.outcome, "current unaffected game's score law remains exact: " + p.game.providerGameId);
  assert.equal(candidate.receipt.source, p.outcomeBaseAuthority!.source);
}
console.log("NFL retained 231-receipt history: all14 current unlocked base laws remain exact;18 actionables unchanged.");
