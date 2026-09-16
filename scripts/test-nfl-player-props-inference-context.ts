import assert from "node:assert/strict";
import {
  buildNflPlayerPropsInferenceContextFromForwardEvidence,
  NFL_PLAYER_PROPS_INFERENCE_CONTEXT_RELEASE,
} from "../lib/services/football/nflPlayerPropsInferenceContext";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardStoredEvidence,
} from "../lib/services/football/nflForwardEvidence";
import type { NflPlayerPropsObservationSnapshot } from "../lib/services/football/nflPlayerPropsContract";

const snapshot = {
  snapshotRelease: "nfl_player_props_observation_snapshot_2026_08_20_r4",
  generatedAt: "2026-08-25T12:00:00.000Z",
  season: 2026,
  week: 1,
  phase: "regular",
  games: [{
    providerGameId: "game",
    scheduledStart: "2026-09-10T20:00:00.000Z",
    season: 2026,
    week: 1,
    phase: "regular",
    awayTeam: "NE",
    homeTeam: "SEA",
    awayTeamName: "New England Patriots",
    homeTeamName: "Seattle Seahawks",
  }],
  observations: [],
  providerRequests: { balldontlie: 1 },
  providerComplete: { balldontlie: true },
  healthFindings: [],
} as unknown as NflPlayerPropsObservationSnapshot;

function evidence(
  capturedAt: string,
  stage: "opening" | "unlocked" | "t60",
  quarterback: string,
  game: { id: string; away: string; home: string; start: string; injuries?: boolean } = {
    id: "game", away: "NE", home: "SEA", start: "2026-09-10T20:00:00.000Z", injuries: true,
  },
): NflForwardStoredEvidence {
  const depth = (team: string, name: string) => ({
    provider: "balldontlie" as const,
    team,
    capturedAt,
    sourceSnapshotId: null,
    starterStatus: "confirmed" as const,
    expectedStartingQuarterback: { playerId: name, name, position: "QB", depth: "1", depthRank: 1, injuryStatus: null, explicitStarter: true },
    quarterbackDepth: [],
    roster: [{ playerId: name, name, position: "QB", depth: "1", depthRank: 1, injuryStatus: null, explicitStarter: true }],
  });
  return {
    id: `${game.id}-${stage}-${capturedAt}`,
    providerGameId: game.id,
    stage,
    capturedAt,
    gameStartAt: game.start,
    payloadSha256: `${stage}-sha`,
    payload: {
      schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
      collectorRelease: "nfl_forward_evidence_collector_2026_08_23_r3_member",
      runId: "run",
      season: 2026,
      week: 1,
      slateGameCount: 1,
      stage,
      captureTiming: "on_time",
      capturedAt,
      cutoffAt: null,
      t60LagMinutes: null,
      game: {
        providerGameId: game.id,
        scheduledStart: game.start,
        away: { id: 1, abbreviation: game.away, name: game.away },
        home: { id: 2, abbreviation: game.home, name: game.home },
      },
      market: {
        current: {} as never,
        currentBooks: [{ sportsbook: "DraftKings", total: { line: 43 }, spread: { homeLine: -2.5 } }] as never,
        comparableCurrentBooks: [] as never,
        providerOpening: null,
        providerOpeningBooks: [],
        comparableProviderOpeningBooks: [],
        operationalOpening: {} as never,
        playbookLine: null,
        playbookSplits: null,
        sharpApiSplits: null,
      },
      startersAndDepth: { away: depth(game.away, quarterback), home: depth(game.home, "Home QB") },
      injuries: game.injuries === false ? null : { eventId: game.id, reportUpdatedAt: capturedAt, teams: [] } as never,
      weather: {} as never,
      decisions: { evaluatedBets: [], outcomeConfidence: [], modelPromotionStatus: "nfl_v1_member_release_2026_08_25_r6_actionable_grades", publicationEnabled: true, trackingEnabled: false },
      coverage: {
        currentOdds: true, currentBookCount: 1, comparableCurrentBookCount: 0, multibookConsensusReady: false,
        operationalOpening: true, rosterAndDepth: true, expectedQuarterbacks: true, injuries: true,
        playbookSplits: false, sharpApiSplits: false, weather: true, healthHolds: [],
      },
      requestBudget: { balldontlieSlate: 1, balldontlieRoster: 2, balldontlieInjuriesMaximum: 1, playbook: 2, sharpApi: 1, weather: 0, totalMaximum: 7 },
    },
  } as unknown as NflForwardStoredEvidence;
}

assert.equal(NFL_PLAYER_PROPS_INFERENCE_CONTEXT_RELEASE, "nfl_player_props_inference_context_2026_09_16_r4_game_scoped_availability");
const context = buildNflPlayerPropsInferenceContextFromForwardEvidence({
  snapshot,
  capturedAt: "2026-08-25T12:00:00.000Z",
  evidence: [
    evidence("2026-08-25T10:00:00.000Z", "opening", "Old QB"),
    evidence("2026-08-25T11:00:00.000Z", "unlocked", "Current QB"),
    evidence("2026-08-25T13:00:00.000Z", "unlocked", "Future QB"),
  ],
});
assert.equal(context.source, "nfl_forward_evidence");
assert.equal(context.requestBudget.totalMaximum, 0, "production context reuses the stored slate bundle without provider calls");
assert.equal(context.games[0]?.awayDepth.expectedStartingQuarterback?.name, "Current QB", "latest evidence at or before the cycle timestamp wins");
assert.equal(context.games[0]?.mainMarket.capturedAt, "2026-08-25T11:00:00.000Z");
assert.throws(() => buildNflPlayerPropsInferenceContextFromForwardEvidence({ snapshot, capturedAt: "2026-08-25T12:00:00.000Z", evidence: [] }), /no games with complete forward evidence/);

const partialSnapshot = {
  ...snapshot,
  games: [
    ...snapshot.games,
    {
      ...snapshot.games[0]!,
      providerGameId: "game-two",
      awayTeam: "BUF",
      homeTeam: "DET",
      awayTeamName: "Buffalo Bills",
      homeTeamName: "Detroit Lions",
    },
  ],
} as NflPlayerPropsObservationSnapshot;
const partialContext = buildNflPlayerPropsInferenceContextFromForwardEvidence({
  snapshot: partialSnapshot,
  capturedAt: "2026-08-25T12:00:00.000Z",
  evidence: [
    evidence("2026-08-25T11:00:00.000Z", "unlocked", "Current QB"),
    evidence("2026-08-25T11:00:00.000Z", "unlocked", "Other QB", {
      id: "game-two", away: "BUF", home: "DET", start: "2026-09-10T20:00:00.000Z", injuries: false,
    }),
  ],
});
assert.deepEqual(partialContext.games.map((game) => game.canonicalGameId), ["game"]);
assert.deepEqual(partialContext.excludedGames, [{ canonicalGameId: "game-two", reason: "injury_evidence_missing" }]);
assert.ok(partialContext.healthHolds.includes("game_game-two_injury_evidence_missing"));

console.log("NFL player-props shared inference context: checksum-backed reuse, as-of selection, game-scoped exclusions, and zero provider-call budget passed.");
