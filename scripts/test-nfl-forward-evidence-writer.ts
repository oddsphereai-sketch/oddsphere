import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  determineNflForwardCollectionNeed,
  planNflForwardEvidenceCaptures,
  type NflForwardEvidencePayload,
  type NflForwardLegacyEvidencePayload,
  type NflForwardStoredEvidence,
} from "../lib/services/football/nflForwardEvidence";
import { buildTeamDepthSnapshot } from "../lib/services/football/balldontlieNflRoster";
import {
  __BALLDONTLIE_NFL_PREVIEW_SLATE_TEST__,
  isComparableNflSportsbook,
  type NflPreviewBookOdds,
  type NflPreviewGame,
} from "../lib/services/football/balldontlieNflPreviewSlate";
import { __NFL_VENUE_WEATHER_TEST__ } from "../lib/services/football/nflVenueWeather";
import { NFL_T60_MAX_CAPTURE_LAG_MINUTES } from "../lib/services/football/nflRegularDecisionEvidence";
import {
  NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
  NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
} from "../lib/services/football/nflV1ActionableGradeCandidate";
import {
  NFL_WEEK_ONE_EVIDENCE_BOARD_RELEASE,
  buildNflWeekOneEvidenceBoard,
} from "../lib/services/football/nflWeekOneEvidenceBoard";

const game: NflPreviewGame = {
  providerGameId: "1001",
  providerWeek: 1,
  season: 2026,
  scheduledStart: "2026-09-10T00:20:00.000Z",
  status: "scheduled",
  away: { id: 1, abbreviation: "NE", name: "New England Patriots" },
  home: { id: 2, abbreviation: "SEA", name: "Seattle Seahawks" },
};
const finalGame = __BALLDONTLIE_NFL_PREVIEW_SLATE_TEST__.normalizeGame({
  id: 1001,
  season: 2026,
  week: 1,
  date: game.scheduledStart,
  status_state: "final",
  home_team_score: 27,
  visitor_team_score: 20,
  home_team: { id: 2, abbreviation: "SEA", full_name: "Seattle Seahawks" },
  visitor_team: { id: 1, abbreviation: "NE", full_name: "New England Patriots" },
});
assert.equal(finalGame?.status, "final");
assert.equal(finalGame?.homeScore, 27);
assert.equal(finalGame?.awayScore, 20);

function stored(stage: "opening" | "unlocked" | "t60", capturedAt: string): NflForwardStoredEvidence {
  return {
    id: `${stage}-${capturedAt}`,
    providerGameId: game.providerGameId,
    stage,
    capturedAt,
    gameStartAt: game.scheduledStart,
    payloadSha256: "a".repeat(64),
    payload: {
      slateGameCount: 1,
      collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
      market: { comparableCurrentBooks: [{}, {}] },
    } as NflForwardEvidencePayload,
  };
}

const early = "2026-09-01T12:00:00.000Z";
assert.deepEqual(
  planNflForwardEvidenceCaptures({ games: [game], existing: [], capturedAt: early, unlockedCadenceMinutes: 360 })
    .map((plan) => plan.stage),
  ["opening"],
);
assert.equal(determineNflForwardCollectionNeed({ existing: [], now: early }).reason, "opening_seed");

const opening = stored("opening", early);
assert.equal(determineNflForwardCollectionNeed({ existing: [opening], now: "2026-09-01T18:00:00.000Z" }).reason, "unlocked_refresh_due");
assert.deepEqual(
  planNflForwardEvidenceCaptures({
    games: [game], existing: [opening], capturedAt: "2026-09-01T18:00:00.000Z", unlockedCadenceMinutes: 360,
  }).map((plan) => plan.stage),
  ["unlocked"],
);

const beforeCadence = "2026-09-01T13:00:00.000Z";
assert.equal(
  determineNflForwardCollectionNeed({ existing: [opening], now: beforeCadence }).reason,
  "cadence_not_due",
);
const stalePublicReleaseOpening: NflForwardStoredEvidence = {
  ...opening,
  payload: {
    ...opening.payload,
    decisions: {
      evaluatedBets: [{ decisionRelease: "nfl_v1_daily_edge_decision_2026_08_24_r3_grading_tiers" }],
      outcomeConfidence: [],
      modelPromotionStatus: "nfl_v1_member_release_2026_08_24_r3_grading_tiers",
      publicationEnabled: true,
      trackingEnabled: false,
    },
  } as unknown as NflForwardEvidencePayload,
};
assert.deepEqual(
  determineNflForwardCollectionNeed({
    existing: [stalePublicReleaseOpening],
    now: beforeCadence,
    requiredPublicRelease: {
      memberRelease: NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
      decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
      evaluatedBetCount: 3,
    },
  }),
  { collect: true, reason: "public_release_refresh_due", cadenceMinutes: 0 },
);
assert.deepEqual(
  planNflForwardEvidenceCaptures({
    games: [game], existing: [stalePublicReleaseOpening], capturedAt: beforeCadence, unlockedCadenceMinutes: 0,
  }).map((plan) => plan.stage),
  ["unlocked"],
);

const currentReleaseOpening: NflForwardStoredEvidence = {
  ...opening,
  payload: {
    ...opening.payload,
    decisions: {
      evaluatedBets: [],
      outcomeConfidence: [],
      modelPromotionStatus: NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
      publicationEnabled: true,
      trackingEnabled: false,
    },
  } as NflForwardEvidencePayload,
};
assert.equal(
  determineNflForwardCollectionNeed({
    existing: [currentReleaseOpening],
    now: beforeCadence,
    requiredPublicRelease: {
      memberRelease: NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
      decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
      evaluatedBetCount: 3,
    },
  }).reason,
  "public_release_refresh_due",
);

const completeCurrentReleaseOpening: NflForwardStoredEvidence = {
  ...currentReleaseOpening,
  payload: {
    ...currentReleaseOpening.payload,
    decisions: {
      ...currentReleaseOpening.payload.decisions,
      evaluatedBets: [1, 2, 3].map(() => ({
        decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
      })) as NflForwardEvidencePayload["decisions"]["evaluatedBets"],
    },
  } as NflForwardEvidencePayload,
};
assert.equal(
  determineNflForwardCollectionNeed({
    existing: [completeCurrentReleaseOpening],
    now: beforeCadence,
    requiredPublicRelease: {
      memberRelease: NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
      decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
      evaluatedBetCount: 3,
    },
  }).reason,
  "cadence_not_due",
);

const t60Time = "2026-09-09T23:30:00.000Z";
assert.equal(
  determineNflForwardCollectionNeed({
    existing: [stalePublicReleaseOpening],
    now: t60Time,
    requiredPublicRelease: {
      memberRelease: NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
      decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
      evaluatedBetCount: 3,
    },
  }).reason,
  "t60_due",
);
assert.deepEqual(
  planNflForwardEvidenceCaptures({ games: [game], existing: [], capturedAt: t60Time, unlockedCadenceMinutes: 60 })
    .map((plan) => [plan.stage, plan.captureTiming]),
  [["opening", "late_first_observation"], ["t60", "on_time"]],
);
assert.deepEqual(
  planNflForwardEvidenceCaptures({ games: [game], existing: [opening], capturedAt: t60Time, unlockedCadenceMinutes: 60 })
    .map((plan) => plan.stage),
  ["t60"],
);
assert.deepEqual(
  planNflForwardEvidenceCaptures({ games: [game], existing: [opening], capturedAt: game.scheduledStart, unlockedCadenceMinutes: 60 }),
  [],
);
assert.equal(
  determineNflForwardCollectionNeed({
    existing: [stalePublicReleaseOpening],
    now: game.scheduledStart,
    requiredPublicRelease: {
      memberRelease: NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
      decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
      evaluatedBetCount: 3,
    },
  }).reason,
  "no_unlocked_games_due",
);

const depth = buildTeamDepthSnapshot({
  team: "SEA",
  capturedAt: early,
  sourceSnapshotId: null,
  rows: [
    { player: { id: 10, first_name: "Starter", last_name: "Quarterback", position_abbreviation: "QB" }, depth: "QB1" },
    { player: { id: 11, first_name: "Backup", last_name: "Quarterback", position_abbreviation: "QB" }, depth: "QB2" },
  ],
});
assert.equal(depth.starterStatus, "projected");
assert.equal(depth.expectedStartingQuarterback?.name, "Starter Quarterback");
assert.equal(depth.quarterbackDepth.length, 2);

for (const abbreviation of [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
]) assert.ok(__NFL_VENUE_WEATHER_TEST__.NFL_VENUES[abbreviation], `missing NFL venue ${abbreviation}`);

const route = readFileSync(path.resolve("app/api/cron/nfl-forward-evidence/route.ts"), "utf8");
assert.match(route, /leaseGroup: "prediction_pipeline"/);
assert.match(route, /requireLease: true/);
assert.match(route, /publication_attempted/);
assert.match(route, /tracking_attempted: result\.trackingAttempted/);
const writer = readFileSync(path.resolve("lib/services/football/nflForwardEvidenceWriter.ts"), "utf8");
const evidenceRuntime = readFileSync(path.resolve("lib/services/football/nflForwardEvidence.ts"), "utf8");
const coherenceIndex = writer.indexOf("assertFootballCrossMarketCoherence({");
const appendIndex = writer.lastIndexOf("appendNflForwardEvidence({");
assert.ok(coherenceIndex >= 0 && appendIndex > coherenceIndex, "the sole NFL writer must pass coherence before its append boundary");
assert.equal((writer.match(/assertFootballCrossMarketCoherence\(\{/g) ?? []).length, 1, "the NFL writer must use one shared per-payload coherence gate");
assert.doesNotMatch(writer, /writeCurrentNflPublishedMemberSnapshot|buildNflTrackingProposals\(/);
assert.match(writer, /buildNflV1ActionableGradeBundle/);
assert.match(writer, /resolveNflTargetExcludedProduction/);
assert.match(writer, /forecastTargetExclusion: resolved\.targetExclusion/);
assert.match(writer, /outcomeForecast: outcome/);
assert.match(writer, /evaluatedBets: production\.evaluatedBets/);
assert.match(writer, /writeOfficialTrackingFromPayloads/);
assert.match(writer, /buildNflOfficialTrackingRecords/);
assert.match(writer, /\.from\("prediction_records"\)/);
assert.match(writer, /isPublicallyTracked/);
assert.match(writer, /currentBooks/);
assert.match(writer, /comparableCurrentBooks/);
assert.match(writer, /multibook_consensus_unavailable/);
assert.match(writer, /readLegacyNflForwardEvidence/);
assert.match(writer, /nfl_forward_evidence_writer_2026_09_03_r21_target_excluded_forecast/);
assert.doesNotMatch(
  writer,
  /const \[existing, previousExisting, priorExisting, legacyExisting\] = await Promise\.all/,
  "large cross-release evidence reads must remain serialized to avoid self-induced statement timeouts",
);
assert.match(writer, /const existing = await readNflForwardEvidence[\s\S]*const previousExisting = await readPreviousNflForwardEvidence[\s\S]*const priorExisting = await readPriorNflForwardEvidence[\s\S]*const legacyExisting = await readLegacyNflForwardEvidence/);
assert.match(evidenceRuntime, /public_release_refresh_due/);
assert.equal(NFL_T60_MAX_CAPTURE_LAG_MINUTES, 20);
assert.match(writer, /NFL_T60_MAX_CAPTURE_LAG_MINUTES/);
assert.doesNotMatch(writer, /t60LagMinutes[^\n]*> 20/);
const migration = readFileSync(path.resolve("lib/db/schema-migration-v38-nfl-forward-evidence.sql"), "utf8");
const executableMigration = migration.replace(/--.*$/gm, "");
assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.nfl_forward_evidence_snapshots TO service_role/);
assert.match(
  migration,
  /REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.nfl_forward_evidence_snapshots FROM service_role/,
);
assert.doesNotMatch(executableMigration, /GRANT[^;]*(UPDATE|DELETE)[^;]*nfl_forward_evidence_snapshots/i);
const vercel = JSON.parse(readFileSync(path.resolve("vercel.json"), "utf8")) as { crons: Array<{ path: string }> };
assert.equal(vercel.crons.filter((cron) => cron.path === "/api/cron/nfl-forward-evidence").length, 1);

const completePayload = (capturedAt: string, homePrice: number): NflForwardLegacyEvidencePayload => ({
  schemaRelease: "nfl_forward_evidence_snapshot_2026_08_22_r2_multibook",
  collectorRelease: "nfl_forward_evidence_collector_2026_08_22_r2_multibook",
  runId: `run-${capturedAt}`,
  season: 2026,
  week: 1,
  slateGameCount: 1,
  stage: capturedAt === early ? "opening" : "unlocked",
  captureTiming: "on_time",
  capturedAt,
  cutoffAt: null,
  t60LagMinutes: null,
  game,
  market: {
    current: {
      providerGameId: game.providerGameId,
      sportsbook: "fanduel",
      observedAt: capturedAt,
      moneyline: { awayPrice: 120, homePrice },
      spread: { awayLine: 2.5, homeLine: -2.5, awayPrice: -110, homePrice: -110 },
      total: { line: 44.5, overPrice: -110, underPrice: -110 },
    },
    currentBooks: [
      {
        providerGameId: game.providerGameId,
        sportsbook: "fanduel",
        observedAt: capturedAt,
        moneyline: { awayPrice: 120, homePrice },
        spread: { awayLine: 2.5, homeLine: -2.5, awayPrice: -110, homePrice: -110 },
        total: { line: 44.5, overPrice: -110, underPrice: -110 },
      },
      {
        providerGameId: game.providerGameId,
        sportsbook: "draftkings",
        observedAt: capturedAt,
        moneyline: { awayPrice: 122, homePrice: homePrice - 2 },
        spread: { awayLine: 2.5, homeLine: -2.5, awayPrice: -108, homePrice: -112 },
        total: { line: 44.5, overPrice: -108, underPrice: -112 },
      },
      {
        providerGameId: game.providerGameId,
        sportsbook: "kalshi",
        observedAt: capturedAt,
        moneyline: { awayPrice: 118, homePrice: homePrice + 2 },
        spread: { awayLine: 2.5, homeLine: -2.5, awayPrice: -110, homePrice: -110 },
        total: { line: 44.5, overPrice: -110, underPrice: -110 },
      },
    ],
    comparableCurrentBooks: [
      {
        providerGameId: game.providerGameId,
        sportsbook: "fanduel",
        observedAt: capturedAt,
        moneyline: { awayPrice: 120, homePrice },
        spread: { awayLine: 2.5, homeLine: -2.5, awayPrice: -110, homePrice: -110 },
        total: { line: 44.5, overPrice: -110, underPrice: -110 },
      },
      {
        providerGameId: game.providerGameId,
        sportsbook: "draftkings",
        observedAt: capturedAt,
        moneyline: { awayPrice: 122, homePrice: homePrice - 2 },
        spread: { awayLine: 2.5, homeLine: -2.5, awayPrice: -108, homePrice: -112 },
        total: { line: 44.5, overPrice: -108, underPrice: -112 },
      },
    ],
    providerOpening: null,
    providerOpeningBooks: [],
    comparableProviderOpeningBooks: [],
    operationalOpening: {
      provenance: "first_observed",
      capturedAt: early,
      quote: {
        providerGameId: game.providerGameId,
        sportsbook: "fanduel",
        observedAt: early,
        moneyline: { awayPrice: 125, homePrice: -145 },
        spread: { awayLine: 3, homeLine: -3, awayPrice: -110, homePrice: -110 },
        total: { line: 45, overPrice: -110, underPrice: -110 },
      },
    },
    playbookLine: null,
    playbookSplits: {
      moneyline: { provider: "playbook", capturedAt, booksUsed: 9, homeMoneyPct: 55, awayMoneyPct: 45, homeBetsPct: 52, awayBetsPct: 48, overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null },
      spread: { provider: "playbook", capturedAt, booksUsed: 9, homeMoneyPct: 54, awayMoneyPct: 46, homeBetsPct: 51, awayBetsPct: 49, overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null },
      total: { provider: "playbook", capturedAt, booksUsed: 10, homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null, overMoneyPct: 57, underMoneyPct: 43, overBetsPct: 53, underBetsPct: 47 },
    },
    sharpApiSplits: null,
  },
  startersAndDepth: {
    away: { ...depth, team: "NE" },
    home: { ...depth, team: "SEA" },
  },
  injuries: {
    eventId: game.providerGameId,
    awayTeam: "NE",
    homeTeam: "SEA",
    source: "BALLDONTLIE",
    sourceLabel: "BALLDONTLIE NFL injuries",
    sourceUrl: null,
    reportUpdatedAt: capturedAt,
    teams: [
      { abbreviation: "NE", teamName: "New England Patriots", players: [] },
      { abbreviation: "SEA", teamName: "Seattle Seahawks", players: [] },
    ],
  },
  weather: { venueTeam: "SEA", venueName: "Lumen Field", roofType: "outdoor", status: "outside_forecast_window", capturedAt, forecast: null },
  decisions: { evaluatedBets: [], outcomeConfidence: [], modelPromotionStatus: "blocked_pending_independent_validation", publicationEnabled: false, trackingEnabled: false },
  coverage: { currentOdds: true, currentBookCount: 3, comparableCurrentBookCount: 2, multibookConsensusReady: true, operationalOpening: true, rosterAndDepth: true, expectedQuarterbacks: true, injuries: true, playbookSplits: true, sharpApiSplits: false, weather: true, healthHolds: ["sharpapi_splits_unavailable"] },
  requestBudget: { balldontlieSlate: 1, balldontlieRoster: 2, balldontlieInjuriesMaximum: 4, playbook: 2, sharpApi: 1, weather: 0, totalMaximum: 10 },
});
const evidenceRows: NflForwardStoredEvidence[] = [
  { ...stored("opening", early), payload: completePayload(early, -140) },
  { ...stored("unlocked", "2026-09-01T18:00:00.000Z"), payload: completePayload("2026-09-01T18:00:00.000Z", -150) },
];
const board = buildNflWeekOneEvidenceBoard(evidenceRows);
assert.equal(board.release, NFL_WEEK_ONE_EVIDENCE_BOARD_RELEASE);
assert.equal(board.games.length, 1);
assert.equal(board.games[0]?.current.moneyline.homePrice, -150);
assert.equal(board.games[0]?.opening.moneyline.homePrice, -145);
assert.equal(board.coverage.playbookSplitGames, 1);
assert.equal(board.coverage.sharpSplitGames, 0);
assert.equal(board.publicationEnabled, false);
assert.equal(board.trackingEnabled, false);

assert.equal(isComparableNflSportsbook("FanDuel"), true);
assert.equal(isComparableNflSportsbook("fanatics"), true);
assert.equal(isComparableNflSportsbook("kalshi"), false);
assert.equal(isComparableNflSportsbook("polymarket"), false);
const rawOdds = (vendor: string, observedAt: string): Record<string, unknown> => ({
  game_id: game.providerGameId,
  vendor,
  updated_at: observedAt,
  moneyline_home_odds: -140,
  moneyline_away_odds: 120,
  spread_home_value: -2.5,
  spread_home_odds: -110,
  spread_away_value: 2.5,
  spread_away_odds: -110,
  total_value: 44.5,
  total_over_odds: -110,
  total_under_odds: -110,
});
const allBooks = __BALLDONTLIE_NFL_PREVIEW_SLATE_TEST__.groupBooksByGame([
  rawOdds("FanDuel", "2026-08-22T12:00:00.000Z"),
  rawOdds("FanDuel", "2026-08-22T13:00:00.000Z"),
  rawOdds("DraftKings", "2026-08-22T13:00:00.000Z"),
  rawOdds("Kalshi", "2026-08-22T13:00:00.000Z"),
], new Set([game.providerGameId]));
assert.equal(allBooks[game.providerGameId]?.length, 3);
assert.equal(allBooks[game.providerGameId]?.find((row: NflPreviewBookOdds) => row.sportsbook === "FanDuel")?.observedAt, "2026-08-22T13:00:00.000Z");
const comparableBooks = __BALLDONTLIE_NFL_PREVIEW_SLATE_TEST__.comparableBooksByGame(allBooks);
assert.deepEqual(comparableBooks[game.providerGameId]?.map((row: NflPreviewBookOdds) => row.sportsbook), ["FanDuel", "DraftKings"]);

const candidatePage = readFileSync(path.resolve("app/lab/daily-edge/CandidateDailyEdgePage.tsx"), "utf8");
assert.match(candidatePage, /isNflWeekOneEvidenceBoardEnabled/);
assert.match(candidatePage, /readCurrentNflWeekOneHeldMemberFixture/);
assert.match(candidatePage, /readCachedNflForwardMemberSnapshot/);
assert.match(candidatePage, /readNflForwardMemberSnapshot/);
assert.match(candidatePage, /revalidate: 15/);
assert.match(candidatePage, /initialAvailability=\{visibleNflAvailability\}/);
assert.match(candidatePage, /readCurrentNflWeekOneHeldMemberFixture/);
assert.doesNotMatch(candidatePage, /nflWeekOneEvidenceBoard=\{/);
assert.doesNotMatch(candidatePage, /nflPublishedMemberSnapshotStore|readCurrentNflPublishedMemberSnapshot/);
const reader = readFileSync(path.resolve("app/dev/experience-preview/ActualDailyEdgePreview.tsx"), "utf8");
assert.match(reader, /No score forecast is being published yet/);
assert.match(reader, /Counts show games containing at least one market with each grade/);
assert.match(reader, /Missing validation keeps the Bet grade at No Play with its reason while preserving the model forecast\./);
assert.doesNotMatch(reader, /Week 1 market is live[^\n]*Best Angle/);

const heldFixture = readFileSync(path.resolve("lib/services/football/nflWeekOneHeldMemberFixture.ts"), "utf8");
assert.match(heldFixture, /readNflForwardEvidence/);
assert.match(heldFixture, /applyPublishedDecision/);
assert.match(heldFixture, /nfl_r9_exact_price_moneyline_best_angle/);
assert.doesNotMatch(heldFixture, /client\.from|supabase\.from|\.insert\(|\.upsert\(/);

console.log("NFL forward evidence planner, cadence, roster/QB, immutable DB, member decisions, lease, and result normalization passed.");
