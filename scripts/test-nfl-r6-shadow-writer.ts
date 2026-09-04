import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DailyEdgeGameAvailability } from "../lib/services/dailyEdge/gameAvailability";
import type { NflPreviewBookOdds, NflPreviewGame } from "../lib/services/football/balldontlieNflPreviewSlate";
import type { NflForwardTeamDepthSnapshot } from "../lib/services/football/nflForwardEvidence";
import {
  __NFL_R6_MONEYLINE_SHADOW_TEST__,
  buildNflR6ShadowMoneylineDecision,
  NFL_R6_MONEYLINE_DECISION_RELEASE,
  NFL_R6_MONEYLINE_MODEL_RELEASE,
  NFL_R6_RUNTIME_ARTIFACT_RELEASE,
} from "../lib/services/football/nflR6MoneylineShadow";
import { NFL_T60_MAX_CAPTURE_LAG_MINUTES } from "../lib/services/football/nflRegularDecisionEvidence";

const { artifact } = __NFL_R6_MONEYLINE_SHADOW_TEST__;
assert.equal(artifact.artifactRelease, NFL_R6_RUNTIME_ARTIFACT_RELEASE);
assert.equal(artifact.modelRelease, NFL_R6_MONEYLINE_MODEL_RELEASE);
assert.equal(artifact.decisionRelease, NFL_R6_MONEYLINE_DECISION_RELEASE);
assert.equal(artifact.shadowOnly, true);
assert.equal(artifact.policy.maximumActionsPerWeek, null);
assert.equal(artifact.policy.bestAngleAuthorized, false);
assert.equal(artifact.policy.minimumAmericanPrice, -300);
assert.equal(artifact.policy.maximumAmericanPrice, 300);
assert.equal(Object.keys(artifact.teamStates).length, 32);
assert.equal(artifact.marginModel.trees.length, 220);

for (const parity of artifact.parityCases.margin) {
  const values = Object.fromEntries(artifact.marginModel.featureNames.map((name, index) => [name, parity.features[index]]));
  assert.ok(Math.abs(__NFL_R6_MONEYLINE_SHADOW_TEST__.predictMargin(values) - parity.expected) < 1e-12);
}
for (const parity of artifact.parityCases.probability) {
  assert.ok(Math.abs(__NFL_R6_MONEYLINE_SHADOW_TEST__.predictHomeProbability(
    parity.consensusHome,
    parity.projectedHomeMargin,
  ) - parity.expected) < 1e-12);
}

const game: NflPreviewGame = {
  providerGameId: "r6-shadow-test",
  providerWeek: 1,
  season: 2026,
  scheduledStart: "2026-09-11T00:20:00.000Z",
  status: "scheduled",
  away: { id: 1, abbreviation: "BUF", name: "Buffalo Bills" },
  home: { id: 2, abbreviation: "KC", name: "Kansas City Chiefs" },
};

function player(name: string, team: string, rank: number) {
  return {
    playerId: `${team}-${rank}`,
    name,
    position: "QB",
    depth: `QB${rank}`,
    depthRank: rank,
    injuryStatus: null,
    explicitStarter: rank === 1,
  };
}

function depth(team: string, quarterback: string): NflForwardTeamDepthSnapshot {
  const starter = player(quarterback, team, 1);
  return {
    provider: "balldontlie",
    team,
    capturedAt: "2026-09-01T12:00:00.000Z",
    sourceSnapshotId: null,
    starterStatus: "projected",
    expectedStartingQuarterback: starter,
    quarterbackDepth: [starter],
    roster: [starter],
  };
}

function book(sportsbook: string, homePrice: number, awayPrice: number, observedAt: string): NflPreviewBookOdds {
  return {
    providerGameId: game.providerGameId,
    sportsbook,
    observedAt,
    moneyline: { homePrice, awayPrice },
    spread: null,
    total: null,
  };
}

const opening = {
  provenance: "first_observed" as const,
  capturedAt: "2026-08-22T13:50:56.934Z",
  quote: {
    ...book("FanDuel", -150, 130, "2026-08-22T13:50:56.934Z"),
    spread: { homeLine: -3, awayLine: 3, homePrice: -110, awayPrice: -110 },
    total: { line: 48, overPrice: -110, underPrice: -110 },
  },
};
const books = [
  book("FanDuel", -150, 130, "2026-09-01T11:59:00.000Z"),
  book("DraftKings", -145, 125, "2026-09-01T11:58:00.000Z"),
  book("Caesars", -155, 135, "2026-09-01T11:57:00.000Z"),
];
const availability: DailyEdgeGameAvailability = {
  eventId: game.providerGameId,
  awayTeam: "BUF",
  homeTeam: "KC",
  source: "BALLDONTLIE",
  sourceLabel: "BALLDONTLIE NFL injuries",
  sourceUrl: null,
  reportUpdatedAt: "2026-09-01T11:55:00.000Z",
  teams: [
    { abbreviation: "BUF", teamName: "Buffalo Bills", players: [] },
    { abbreviation: "KC", teamName: "Kansas City Chiefs", players: [] },
  ],
};

const unlocked = buildNflR6ShadowMoneylineDecision({
  game,
  opening,
  comparableCurrentBooks: books,
  startersAndDepth: { away: depth("BUF", "Josh Allen"), home: depth("KC", "Patrick Mahomes") },
  injuries: availability,
  stage: "unlocked",
  capturedAt: "2026-09-01T12:00:00.000Z",
  t60LagMinutes: null,
  coverageHealthHolds: ["sharpapi_splits_unavailable"],
});
assert.equal(unlocked.shadowOnly, true);
assert.equal(unlocked.publicationEligible, false);
assert.equal(unlocked.trackingEligible, false);
assert.equal(unlocked.decisionStage, "unlocked");
assert.ok(unlocked.evaluatedQuote);
assert.ok(unlocked.modelProbability && unlocked.modelProbability > 0 && unlocked.modelProbability < 1);
assert.ok(unlocked.otherBooksConsensusFairProbability && unlocked.otherBooksConsensusFairProbability > 0);
assert.equal(unlocked.otherBookCount, 2);
assert.deepEqual(unlocked.health.blockingReasons, []);
assert.ok(unlocked.health.quarterbackReasons.includes("away_quarterback_projected_not_confirmed"));
assert.ok(unlocked.health.quarterbackReasons.includes("home_quarterback_projected_not_confirmed"));
assert.ok(unlocked.health.contextReasons.includes("sharpapi_splits_unavailable"));

const injuredQuarterback = buildNflR6ShadowMoneylineDecision({
  game: { ...game, providerWeek: 2 },
  opening,
  comparableCurrentBooks: books,
  startersAndDepth: {
    away: {
      ...depth("BUF", "Josh Allen"),
      quarterbackDepth: [player("Josh Allen", "BUF", 1), player("Mitchell Trubisky", "BUF", 2)],
      roster: [player("Josh Allen", "BUF", 1), player("Mitchell Trubisky", "BUF", 2)],
    },
    home: depth("KC", "Patrick Mahomes"),
  },
  injuries: {
    ...availability,
    teams: [
      {
        abbreviation: "BUF",
        teamName: "Buffalo Bills",
        players: [{ name: "Josh Allen", status: "Out", detail: null, position: "QB", reportedAt: availability.reportUpdatedAt }],
      },
      availability.teams[1]!,
    ],
  },
  stage: "unlocked",
  capturedAt: "2026-09-01T12:00:00.000Z",
  t60LagMinutes: null,
  coverageHealthHolds: [],
});
assert.equal(injuredQuarterback.health.blockingReasons.length, 0);
assert.equal(injuredQuarterback.quarterbackContext.away.name, "Mitchell Trubisky");
assert.ok(injuredQuarterback.modelProbability !== null);
assert.equal(injuredQuarterback.health.blockingReasons.includes("r6_runtime_outside_2026_week1"), false);

const missingInjuryReport = buildNflR6ShadowMoneylineDecision({
  game: { ...game, providerWeek: 2 },
  opening,
  comparableCurrentBooks: books,
  startersAndDepth: { away: depth("BUF", "Josh Allen"), home: depth("KC", "Patrick Mahomes") },
  injuries: null,
  stage: "unlocked",
  capturedAt: "2026-09-01T12:00:00.000Z",
  t60LagMinutes: null,
  coverageHealthHolds: ["injury_report_unavailable"],
});
assert.equal(missingInjuryReport.health.blockingReasons.length, 0, "missing injury context preserves the football projection");
assert.ok(missingInjuryReport.health.contextReasons.includes("injury_report_unavailable"));
assert.ok(missingInjuryReport.modelProbability !== null);

const onTimeT60 = buildNflR6ShadowMoneylineDecision({
  game,
  opening,
  comparableCurrentBooks: books.map((value) => ({ ...value, observedAt: "2026-09-10T23:39:00.000Z" })),
  startersAndDepth: { away: depth("BUF", "Josh Allen"), home: depth("KC", "Patrick Mahomes") },
  injuries: availability,
  stage: "t60",
  capturedAt: "2026-09-10T23:40:00.000Z",
  t60LagMinutes: NFL_T60_MAX_CAPTURE_LAG_MINUTES,
  coverageHealthHolds: [],
});
assert.equal(onTimeT60.decisionStage, "t60_locked");
assert.equal(onTimeT60.lockedAt, onTimeT60.evaluatedAt);

const lateT60 = buildNflR6ShadowMoneylineDecision({
  game,
  opening,
  comparableCurrentBooks: books.map((value) => ({ ...value, observedAt: "2026-09-10T23:49:00.000Z" })),
  startersAndDepth: { away: depth("BUF", "Josh Allen"), home: depth("KC", "Patrick Mahomes") },
  injuries: availability,
  stage: "t60",
  capturedAt: "2026-09-10T23:50:00.000Z",
  t60LagMinutes: 30,
  coverageHealthHolds: ["t60_capture_late"],
});
assert.equal(lateT60.grade, "Held");
assert.equal(lateT60.decisionStage, "t60_held");
assert.equal(lateT60.lockedAt, null);
assert.ok(lateT60.health.blockingReasons.includes("t60_capture_late"));

const falsifiedLagT60 = buildNflR6ShadowMoneylineDecision({
  game,
  opening,
  comparableCurrentBooks: books.map((value) => ({ ...value, observedAt: "2026-09-10T23:49:00.000Z" })),
  startersAndDepth: { away: depth("BUF", "Josh Allen"), home: depth("KC", "Patrick Mahomes") },
  injuries: availability,
  stage: "t60",
  capturedAt: "2026-09-10T23:50:00.000Z",
  t60LagMinutes: 20,
  coverageHealthHolds: [],
});
assert.equal(falsifiedLagT60.grade, "Held");
assert.equal(falsifiedLagT60.decisionStage, "t60_held");
assert.equal(falsifiedLagT60.lockedAt, null);
assert.ok(falsifiedLagT60.health.blockingReasons.includes("t60_capture_late"));

const writer = readFileSync(path.resolve("lib/services/football/nflForwardEvidenceWriter.ts"), "utf8");
assert.match(writer, /nfl_forward_evidence_writer_2026_09_04_r22_complete_tracking_denominators/);
assert.match(writer, /buildNflR6ShadowMoneylineDecision/);
assert.doesNotMatch(
  writer,
  /buildNflV1ActionableGradeBundle/,
  "the authoritative writer must route the shadow prior through target-excluded production resolution",
);
assert.match(writer, /resolveNflTargetExcludedProduction/);
assert.match(writer, /evaluatedBets: production\.evaluatedBets/);
assert.doesNotMatch(writer, /shadowEvaluatedBets: \[shadowMoneyline\]/);
assert.match(writer, /buildNflOfficialTrackingRecords/);
assert.match(writer, /writeNflForwardMemberSnapshot/);
assert.match(writer, /buildNflWeekOneHeldMemberFixture/);
assert.doesNotMatch(writer, /writeCurrentNflPublishedMemberSnapshot|buildNflTrackingProposals\(/);
const route = readFileSync(path.resolve("app/api/cron/nfl-forward-evidence/route.ts"), "utf8");
assert.match(route, /leaseGroup: "prediction_pipeline"/);
assert.match(route, /requireLease: true/);

console.log("NFL r6 portable parity, internal exact-price tuple, QB health, single-writer, and T-60 fail-closed boundaries passed.");
