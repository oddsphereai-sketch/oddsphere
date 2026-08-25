import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isPublicallyTracked } from "../lib/config/officialTrackingStart";
import { buildCfbMemberFixture } from "../lib/services/football/cfbMemberFixture";
import {
  CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MEMBER_RELEASE,
  determineCfbForwardCollectionNeed,
  hashCfbForwardEvidencePayload,
  planCfbForwardEvidenceCaptures,
  type CfbForwardEvidencePayload,
  type CfbForwardStoredEvidence,
} from "../lib/services/football/cfbForwardEvidence";
import { normalizeCfbPlaybookLine, normalizeCfbPlaybookSplits } from "../lib/services/football/cfbPlaybookEvidence";
import { fetchBalldontlieNcaafQuarterbacks } from "../lib/services/football/balldontlieNcaafQuarterbacks";
import { ingestCfbFinalScores } from "../lib/services/football/cfbScoreIngestService";
import { buildCfbOfficialTrackingRecords } from "../lib/services/football/cfbOfficialTrackingRecord";
import {
  CFB_T60_MAX_CAPTURE_LAG_MINUTES,
  CFB_V1_DECISION_RELEASE,
  buildCfbV1DecisionBundle,
  cfbV1LineProbabilities,
  getCfbV1Forecast,
  getCfbV1Forecasts,
} from "../lib/services/football/cfbV1Decision";
import type { NcaafBookOdds, NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";
import type { SupabaseClient } from "@supabase/supabase-js";

async function main(): Promise<void> {
const observedAt = "2026-08-25T15:50:05.583Z";
const lockedAt = "2026-08-29T15:10:00.000Z";
const gameStartAt = "2026-08-29T16:00:00.000Z";
const game: NcaafGame = {
  providerGameId: "457157",
  providerWeek: 1,
  season: 2026,
  scheduledStart: gameStartAt,
  status: "scheduled",
  awayScore: null,
  homeScore: null,
  away: { id: 10, conferenceId: 1, abbreviation: "UNC", name: "North Carolina Tar Heels", fbs: true },
  home: { id: 43, conferenceId: 3, abbreviation: "TCU", name: "TCU Horned Frogs", fbs: true },
};

const currentBooks: NcaafBookOdds[] = [
  book("fanduel", -330, 260, -7.5, -112, -108, 47.5, -105, -115),
  book("draftkings", -310, 250, -7.5, -112, -108, 47.5, -110, -110),
  book("caesars", -325, 255, -7.5, -114, -106, 47.5, -108, -112),
  book("betmgm", -325, 260, -7.5, -115, -105, 47.5, -110, -110),
];

const forecasts = getCfbV1Forecasts();
assert.equal(forecasts.length, 8, "launch artifact must contain the exact eight-game opening slate");
for (const forecast of forecasts) {
  const mass = forecast.pmf.reduce((sum, cell) => sum + cell.probability, 0);
  const expectedAway = forecast.pmf.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
  const expectedHome = forecast.pmf.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
  assert.ok(Math.abs(mass - 1) < 1e-9, `${forecast.providerGameId} PMF must sum to one`);
  assert.ok(Math.abs(expectedAway - forecast.expectedAwayPoints) < 1e-9, `${forecast.providerGameId} away mean must come from the PMF`);
  assert.ok(Math.abs(expectedHome - forecast.expectedHomePoints) < 1e-9, `${forecast.providerGameId} home mean must come from the PMF`);
  assert.ok(Math.abs(forecast.representativeScore.away - forecast.expectedAwayPoints) <= 2, `${forecast.providerGameId} representative away score is not central`);
  assert.ok(Math.abs(forecast.representativeScore.home - forecast.expectedHomePoints) <= 2, `${forecast.providerGameId} representative home score is not central`);
  if (Math.abs(forecast.homeWinProbability - 0.5) > 0.005) {
    assert.notEqual(forecast.representativeScore.away, forecast.representativeScore.home, `${forecast.providerGameId} representative score cannot contradict a non-tie winner`);
    assert.equal(forecast.representativeScore.home > forecast.representativeScore.away, forecast.homeWinProbability > 0.5, `${forecast.providerGameId} representative winner must match the PMF winner`);
  }
}

const forecast = getCfbV1Forecast(game.providerGameId);
const probabilities = cfbV1LineProbabilities({ forecast, homeSpread: -7.5, totalLine: 47.5 });
const independentlySummedHomeWin = forecast.pmf.reduce((sum, cell) => sum + (cell.home > cell.away ? cell.probability : cell.home === cell.away ? 0.5 * cell.probability : 0), 0);
assert.ok(Math.abs(probabilities.moneyline.home - independentlySummedHomeWin) < 1e-12);
assert.ok(Math.abs(probabilities.moneyline.home + probabilities.moneyline.away - 1) < 1e-9);
assert.ok(Math.abs(probabilities.spread.home + probabilities.spread.away - 1) < 1e-9);
assert.ok(Math.abs(probabilities.total.over + probabilities.total.under - 1) < 1e-9);

const fullBundle = buildCfbV1DecisionBundle({
  providerGameId: game.providerGameId,
  awayTeam: game.away.abbreviation,
  homeTeam: game.home.abbreviation,
  gameStartsAt: game.scheduledStart,
  comparableCurrentBooks: currentBooks,
  stage: "t60_locked",
  evaluatedAt: lockedAt,
  lockedAt,
});
assert.equal(fullBundle.evaluatedBets.length, 3);
assert.equal(fullBundle.heldMarkets.length, 0);
assert.equal(fullBundle.trackingEnabled, true);
assert.equal(fullBundle.evaluatedBets.every((decision) => decision.decisionRelease === CFB_V1_DECISION_RELEASE), true);
assert.equal(new Set(fullBundle.evaluatedBets.map((decision) => decision.market)).size, 3);
assert.equal(fullBundle.evaluatedBets.every((decision) => decision.consensus.books.every((bookName) => bookName !== decision.evaluatedQuote.sportsbook)), true, "consensus must exclude the evaluated sportsbook");

const { pmf: _pmf, ...publishedForecast } = fullBundle.forecast;
const payload: CfbForwardEvidencePayload = {
  schemaRelease: CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  collectorRelease: CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  memberRelease: CFB_FORWARD_MEMBER_RELEASE,
  runId: "00000000-0000-4000-8000-000000000001",
  season: 2026,
  week: 1,
  slateGameCount: 1,
  stage: "t60",
  captureTiming: "on_time",
  capturedAt: lockedAt,
  cutoffAt: "2026-08-29T15:00:00.000Z",
  t60LagMinutes: 10,
  game,
  market: {
    current: currentBooks[0]!,
    currentBooks,
    providerOpening: null,
    operationalOpening: { provenance: "first_observed", capturedAt: observedAt, quote: currentBooks[0]! },
    playbookLine: { provider: "playbook", capturedAt: observedAt, sourceTier: "tier1", homeMoneyline: -330, awayMoneyline: 260, homeSpread: -7.5, awaySpread: 7.5, total: 47.5 },
    playbookSplits: splitSet(),
    sharpApiSplits: null,
  },
  quarterbacks: {
    away: quarterback(10, "UNC", "Projected UNC QB"),
    home: quarterback(43, "TCU", "Projected TCU QB"),
  },
  availability: { injuryStatus: "provider_unavailable", weatherStatus: "venue_weather_unavailable", note: "Unavailable and not fabricated." },
  decisions: { ...fullBundle, forecast: publishedForecast },
  coverage: { currentOdds: true, comparableCurrentBookCount: 4, targetExcludedConsensusReady: true, operationalOpening: true, playbookLine: true, playbookSplits: true, sharpApiSplits: false, activeQuarterbacks: true, injuries: false, weather: false, healthHolds: [], availabilityWarnings: ["quarterback_starter_projected_not_confirmed", "injury_feed_unavailable", "venue_weather_unavailable", "sharpapi_splits_unavailable"] },
  requestBudget: { balldontlieSlate: 3, balldontlieQuarterbacks: 2, playbook: 2, totalMaximum: 7 },
};

assert.equal("pmf" in payload.decisions.forecast, false, "recurring evidence rows must not duplicate the large PMF artifact");
assert.equal(hashCfbForwardEvidencePayload(payload).length, 64);
assert.equal(CFB_T60_MAX_CAPTURE_LAG_MINUTES, 20);
assert.equal(isPublicallyTracked("cfb", "2026-08-28"), false);
assert.equal(isPublicallyTracked("cfb", "2026-08-29"), true);

const evidence: CfbForwardStoredEvidence = {
  id: "test-row",
  providerGameId: game.providerGameId,
  stage: "t60",
  capturedAt: lockedAt,
  gameStartAt,
  payloadSha256: hashCfbForwardEvidencePayload(payload),
  payload,
};
const member = buildCfbMemberFixture([evidence]);
assert.equal(member.snapshot.games.length, 1);
assert.equal(member.snapshot.games[0]!.footballProjection?.expectedAwayPoints, forecast.expectedAwayPoints);
assert.equal(member.snapshot.games[0]!.footballProjection?.expectedHomePoints, forecast.expectedHomePoints);
assert.deepEqual(member.snapshot.games[0]!.projected, forecast.representativeScore);
assert.equal(member.snapshot.games[0]!.markets.moneyline.held, false);
assert.equal(member.snapshot.games[0]!.markets.total.publicSplits.length, 2);
assert.equal(member.tracking.trackingEligible, true);

const tracking = buildCfbOfficialTrackingRecords({ payload, gameId: 9001 });
assert.equal(tracking.length, 3);
assert.deepEqual(tracking.map((row) => row.market), ["moneyline", "spread", "total"]);
assert.equal(tracking.every((row) => row.locked_at === lockedAt), true);
assert.equal(tracking.every((row) => row.model_version === CFB_V1_DECISION_RELEASE), true);
assert.equal(tracking.every((row) => row.snapshot_json && !("pmf" in (row.snapshot_json.forecast as Record<string, unknown>))), true);

const openingPlan = planCfbForwardEvidenceCaptures({ games: [game], existing: [], capturedAt: "2026-08-25T16:00:00.000Z", unlockedCadenceMinutes: 360 });
assert.deepEqual(openingPlan.map((row) => row.stage), ["opening"]);
assert.equal(determineCfbForwardCollectionNeed({ existing: [], now: observedAt }).reason, "opening_seed");
const lateT60 = planCfbForwardEvidenceCaptures({ games: [game], existing: [evidenceAt("opening", "2026-08-25T16:00:00.000Z")], capturedAt: "2026-08-29T15:21:00.000Z", unlockedCadenceMinutes: 60 });
assert.equal(lateT60[0]?.stage, "t60");
assert.equal(lateT60[0]?.t60LagMinutes, 21);
assert.ok((lateT60[0]?.t60LagMinutes ?? 0) > CFB_T60_MAX_CAPTURE_LAG_MINUTES);

const playbookLine = normalizeCfbPlaybookLine({ lineSourceTier: "tier1", lines: { spread: { home: -7.5, away: 7.5 }, total: 47.5, moneyline: { home: -330, away: 260 } } }, observedAt);
assert.deepEqual(playbookLine && { home: playbookLine.homeSpread, away: playbookLine.awaySpread, total: playbookLine.total }, { home: -7.5, away: 7.5, total: 47.5 });
const playbookSplits = normalizeCfbPlaybookSplits(playbookRaw(), observedAt);
assert.equal(playbookSplits?.moneyline.homeMoneyPct, 90);
assert.equal(playbookSplits?.spread.awayBetsPct, 29);
assert.equal(playbookSplits?.total.overMoneyPct, 27);
assert.equal(playbookSplits?.total.underBetsPct, 65);

const requestedUrls: string[] = [];
const qbResult = await fetchBalldontlieNcaafQuarterbacks({
  teams: [{ id: 10, abbreviation: "UNC" }],
  previousSeason: 2025,
  capturedAt: observedAt,
  apiKey: "test",
  fetchImpl: (async (input: URL | RequestInfo) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("/players/active")) return Response.json({ data: [
      { id: 101, first_name: "Experienced", last_name: "QB", position_abbreviation: "QB", jersey_number: "7", team: { id: 10 } },
      { id: 102, first_name: "Backup", last_name: "QB", position_abbreviation: "QB", jersey_number: "12", team: { id: 10 } },
    ], meta: { next_cursor: null } });
    return Response.json({ data: [
      { player: { id: 101 }, passing_attempts: 310, passing_yards: 2600 },
      { player: { id: 102 }, passing_attempts: 22, passing_yards: 150 },
    ], meta: { next_cursor: null } });
  }) as typeof fetch,
});
assert.equal(qbResult.providerRequests, 2);
assert.equal(qbResult.byTeamId.get(10)?.expectedStartingQuarterback?.name, "Experienced QB");
assert.equal(qbResult.byTeamId.get(10)?.starterStatus, "projected");
assert.equal(requestedUrls.every((url) => url.startsWith("https://api.balldontlie.io/ncaaf/v1/")), true);

const scoreReadClient = {
  from(table: string) {
    assert.equal(table, "games");
    const query = {
      select() { return query; },
      eq() { return query; },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(resolve({ data: [{ id: 9001, external_id: 457157, status: "scheduled", home_score: null, away_score: null }], error: null }));
      },
    };
    return query;
  },
} as unknown as SupabaseClient;
const scoreIngest = await ingestCfbFinalScores({
  supabase: scoreReadClient,
  slateDate: "2026-08-29",
  apply: false,
  apiKey: "test",
  fetchImpl: (async () => Response.json({ data: [{
    id: 457157,
    season: 2026,
    week: 1,
    date: gameStartAt,
    status_state: "final",
    home_team_score: 34,
    visitor_team_score: 17,
    home_team: { id: 43, conference: 3, abbreviation: "TCU", full_name: "TCU Horned Frogs" },
    visitor_team: { id: 10, conference: 1, abbreviation: "UNC", full_name: "North Carolina Tar Heels" },
  }], meta: { next_cursor: null } })) as typeof fetch,
});
assert.equal(scoreIngest.providerRequests, 1);
assert.equal(scoreIngest.updatedCount, 1);
assert.equal(scoreIngest.errors.length, 0);

const route = readFileSync(path.resolve("app/api/cron/cfb-forward-evidence/route.ts"), "utf8");
assert.match(route, /leaseGroup: "prediction_pipeline"/);
assert.match(route, /requireLease: true/);
assert.match(route, /runCfbForwardEvidenceWriter/);
const writer = readFileSync(path.resolve("lib/services/football/cfbForwardEvidenceWriter.ts"), "utf8");
assert.match(writer, /buildCfbV1DecisionBundle/);
assert.match(writer, /compactDecisionBundle/);
assert.match(writer, /buildCfbOfficialTrackingRecords/);
assert.doesNotMatch(writer, /create.*writer|second.*writer/i);
const migration = readFileSync(path.resolve("lib/db/schema-migration-v40-cfb-forward-evidence.sql"), "utf8");
const executableMigration = migration.replace(/--.*$/gm, "");
assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.cfb_forward_evidence_snapshots TO service_role/);
assert.match(migration, /REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/);
assert.doesNotMatch(executableMigration, /GRANT[^;]*(UPDATE|DELETE)[^;]*cfb_forward_evidence_snapshots/i);
const vercel = JSON.parse(readFileSync(path.resolve("vercel.json"), "utf8")) as { crons: Array<{ path: string }> };
assert.equal(vercel.crons.filter((cron) => cron.path === "/api/cron/cfb-forward-evidence").length, 1);
const reader = readFileSync(path.resolve("app/dev/experience-preview/ActualDailyEdgePreview.tsx"), "utf8");
assert.match(reader, /sport === "nfl" \|\| sport === "cfb" \? "Expected score"/);
assert.match(reader, /Reachable representative final/);
assert.match(reader, /footballExpectedAway\.toFixed\(1\)/);
const trackingRefresh = readFileSync(path.resolve("lib/services/trackingRefreshService.ts"), "utf8");
assert.match(trackingRefresh, /sport === "cfb"/);
assert.match(trackingRefresh, /ingestCfbFinalScores/);
const trackingRoute = readFileSync(path.resolve("app/api/cron/tracking-refresh/route.ts"), "utf8");
assert.match(trackingRoute, /"nfl", "cfb"/);

console.log("CFB v1 production contract: PMF coherence, representative score, exact-price grades, compact evidence, T-60 tracking, provider normalization, one writer, and normal reader passed.");

function book(sportsbook: string, homeMl: number, awayMl: number, homeLine: number, homeSpreadPrice: number, awaySpreadPrice: number, totalLine: number, overPrice: number, underPrice: number): NcaafBookOdds {
  return { providerGameId: game.providerGameId, sportsbook, observedAt, moneyline: { homePrice: homeMl, awayPrice: awayMl }, spread: { homeLine, homePrice: homeSpreadPrice, awayLine: -homeLine, awayPrice: awaySpreadPrice }, total: { line: totalLine, overPrice, underPrice } };
}

function quarterback(teamId: number, team: string, name: string) {
  const player = { playerId: String(teamId * 100), name, position: "QB" as const, jerseyNumber: null, previousSeasonPassingAttempts: 200, previousSeasonPassingYards: 1800 };
  return { provider: "balldontlie" as const, teamId, team, capturedAt: lockedAt, starterStatus: "projected" as const, projectionMethod: "active_roster_previous_season_attempts" as const, expectedStartingQuarterback: player, activeQuarterbacks: [player] };
}

function splitSet() {
  const result = normalizeCfbPlaybookSplits(playbookRaw(), observedAt);
  assert.ok(result);
  return result;
}

function playbookRaw() {
  return { splits: {
    moneyline: { bets: { homePercent: 85, awayPercent: 15 }, money: { homePercent: 90, awayPercent: 10 }, source: { booksUsed: 11 } },
    spread: { bets: { homePercent: 71, awayPercent: 29 }, money: { homePercent: 75, awayPercent: 25 }, source: { booksUsed: 11 } },
    total: { bets: { overPercent: 35, underPercent: 65 }, money: { overPercent: 27, underPercent: 73 }, source: { booksUsed: 11 } },
  } };
}

function evidenceAt(stage: "opening" | "unlocked" | "t60", capturedAt: string): CfbForwardStoredEvidence {
  return { ...evidence, id: `${stage}-${capturedAt}`, stage, capturedAt, payload: { ...payload, stage, capturedAt, decisions: { ...payload.decisions, trackingEnabled: stage === "t60" } } };
}
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
