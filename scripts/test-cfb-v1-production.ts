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

const earlierAt = "2026-08-25T14:50:05.583Z";
const unchangedMiddleAt = "2026-08-25T15:20:05.583Z";
const decisionBooksByMarket = new Map(fullBundle.evaluatedBets.map((decision) => [decision.market, normalizeSportsbook(decision.evaluatedQuote.sportsbook)]));
const earlierBooks = currentBooks.map((currentBook) => {
  const normalized = normalizeSportsbook(currentBook.sportsbook);
  return {
    ...currentBook,
    observedAt: earlierAt,
    moneyline: currentBook.moneyline && decisionBooksByMarket.get("moneyline") === normalized
      ? { homePrice: currentBook.moneyline.homePrice - 15, awayPrice: currentBook.moneyline.awayPrice - 10 }
      : currentBook.moneyline,
    spread: currentBook.spread && decisionBooksByMarket.get("spread") === normalized
      ? { homeLine: currentBook.spread.homeLine + 0.5, awayLine: currentBook.spread.awayLine - 0.5, homePrice: currentBook.spread.homePrice - 5, awayPrice: currentBook.spread.awayPrice + 5 }
      : currentBook.spread,
    total: currentBook.total && decisionBooksByMarket.get("total") === normalized
      ? { line: currentBook.total.line - 0.5, overPrice: currentBook.total.overPrice - 5, underPrice: currentBook.total.underPrice + 5 }
      : currentBook.total,
  } satisfies NcaafBookOdds;
});
const earlierPayload: CfbForwardEvidencePayload = {
  ...payload,
  memberRelease: "cfb_v1_member_release_2026_08_25_r1" as typeof CFB_FORWARD_MEMBER_RELEASE,
  runId: "00000000-0000-4000-8000-000000000002",
  stage: "opening",
  captureTiming: "on_time",
  capturedAt: earlierAt,
  cutoffAt: earlierAt,
  t60LagMinutes: null,
  market: {
    ...payload.market,
    current: earlierBooks[0]!,
    currentBooks: earlierBooks,
    operationalOpening: { provenance: "first_observed", capturedAt: earlierAt, quote: earlierBooks[0]! },
    playbookSplits: splitSetAt(earlierAt),
  },
  decisions: { ...payload.decisions, trackingEnabled: false },
};
const earlierEvidence: CfbForwardStoredEvidence = {
  ...evidence,
  id: "test-row-earlier",
  stage: "opening",
  capturedAt: earlierAt,
  payloadSha256: hashCfbForwardEvidencePayload(earlierPayload),
  payload: earlierPayload,
};
const unchangedMiddlePayload: CfbForwardEvidencePayload = {
  ...earlierPayload,
  runId: "00000000-0000-4000-8000-000000000003",
  stage: "unlocked",
  capturedAt: unchangedMiddleAt,
  cutoffAt: unchangedMiddleAt,
  market: {
    ...earlierPayload.market,
    current: { ...earlierBooks[0]!, observedAt: unchangedMiddleAt },
    currentBooks: earlierBooks.map((historicalBook) => ({ ...historicalBook, observedAt: unchangedMiddleAt })),
  },
};
const unchangedMiddleEvidence: CfbForwardStoredEvidence = {
  ...earlierEvidence,
  id: "test-row-unchanged-middle",
  stage: "unlocked",
  capturedAt: unchangedMiddleAt,
  payloadSha256: hashCfbForwardEvidencePayload(unchangedMiddlePayload),
  payload: unchangedMiddlePayload,
};
const movementMember = buildCfbMemberFixture([earlierEvidence, unchangedMiddleEvidence, evidence]);
const movementGame = movementMember.snapshot.games[0]!;
for (const decision of fullBundle.evaluatedBets) {
  const market = decision.market === "spread" ? movementGame.markets.first_inning : movementGame.markets[decision.market];
  const selectedSide = decision.market === "total"
    ? /^over\b/i.test(decision.side) ? "over" : "under"
    : decision.side.startsWith(game.home.abbreviation) ? "home" : "away";
  const opposingSide = selectedSide === "home" ? "away" : selectedSide === "away" ? "home" : selectedSide === "over" ? "under" : "over";
  const earlierBook = earlierBooks.find((candidate) => normalizeSportsbook(candidate.sportsbook) === normalizeSportsbook(decision.evaluatedQuote.sportsbook));
  const currentBook = currentBooks.find((candidate) => normalizeSportsbook(candidate.sportsbook) === normalizeSportsbook(decision.evaluatedQuote.sportsbook));
  assert.ok(earlierBook && currentBook, `${decision.market} must retain its exact evaluated sportsbook`);
  const expectedFirst = selectedQuote(earlierBook, decision.market, selectedSide);
  const expectedCurrent = selectedQuote(currentBook, decision.market, selectedSide);
  const expectedOpposingFirst = selectedQuote(earlierBook, decision.market, opposingSide);
  const expectedOpposingCurrent = selectedQuote(currentBook, decision.market, opposingSide);
  const oddsTrail = market.oddsTrail;
  const opposingTrail = market.opposingOddsTrail?.stops;
  assert.ok(oddsTrail, `${decision.market} must expose its selected-side movement trail`);
  assert.ok(opposingTrail, `${decision.market} must expose its opposing-side movement trail`);
  assert.deepEqual(
    oddsTrail.map((stop) => ({ price: stop.american, line: stop.line, at: stop.observedAt, book: normalizeSportsbook(stop.sportsbook ?? "") })),
    [
      { price: expectedFirst.price, line: expectedFirst.line, at: earlierAt, book: normalizeSportsbook(decision.evaluatedQuote.sportsbook) },
      { price: expectedCurrent.price, line: expectedCurrent.line, at: decision.evaluatedQuote.observedAt, book: normalizeSportsbook(decision.evaluatedQuote.sportsbook) },
    ],
    `${decision.market} must compact the unchanged middle capture while preserving exact earlier and current tuples`,
  );
  assert.deepEqual(
    opposingTrail.map((stop) => ({ price: stop.american, line: stop.line, at: stop.observedAt, book: normalizeSportsbook(stop.sportsbook ?? "") })),
    [
      { price: expectedOpposingFirst.price, line: expectedOpposingFirst.line, at: earlierAt, book: normalizeSportsbook(decision.evaluatedQuote.sportsbook) },
      { price: expectedOpposingCurrent.price, line: expectedOpposingCurrent.line, at: decision.evaluatedQuote.observedAt, book: normalizeSportsbook(decision.evaluatedQuote.sportsbook) },
    ],
    `${decision.market} opposing trail must never mix sportsbooks`,
  );
  assert.equal(market.pick, decision.side, `${decision.market} movement display cannot alter the evaluated pick`);
  assert.equal(market.actionabilityLabel, decision.grade, `${decision.market} movement display cannot alter the grade`);
  assert.ok(Date.parse(oddsTrail[0]!.observedAt!) < Date.parse(oddsTrail.at(-1)!.observedAt!), `${decision.market} trail must be chronological`);
}
assert.notEqual(member.provenance.sourceChecksum, movementMember.provenance.sourceChecksum, "historical evidence must contribute to the member checksum");
assert.equal(movementGame.markets.moneyline.moneyPctObservedAt, payload.market.playbookSplits?.moneyline.capturedAt, "split freshness must come from the authoritative latest row");
assert.equal(movementGame.markets.total.moneyPctObservedAt, payload.market.playbookSplits?.total.capturedAt, "Total split freshness must remain market-specific");
assert.equal(movementGame.markets.first_inning.moneyPctObservedAt, payload.market.playbookSplits?.spread.capturedAt, "Spread split freshness must remain market-specific");

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

const launchTeams = [
  { id: 10, abbreviation: "UNC" },
  { id: 43, abbreviation: "TCU" },
  { id: 101, abbreviation: "SJSU" },
  { id: 63, abbreviation: "USC" },
  { id: 9, abbreviation: "NCSU" },
  { id: 15, abbreviation: "UVA" },
  { id: 68, abbreviation: "JXST" },
  { id: 183, abbreviation: "NDSU" },
  { id: 146, abbreviation: "SAC" },
  { id: 85, abbreviation: "EMU" },
  { id: 97, abbreviation: "HAW" },
  { id: 13, abbreviation: "STAN" },
  { id: 74, abbreviation: "NMSU" },
  { id: 5, abbreviation: "FSU" },
  { id: 22, abbreviation: "MEM" },
  { id: 102, abbreviation: "UNLV" },
];
const launchRosterUrls: string[] = [];
const launchQbs = await fetchBalldontlieNcaafQuarterbacks({
  teams: launchTeams,
  previousSeason: 2025,
  capturedAt: observedAt,
  apiKey: "test",
  fetchImpl: (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    launchRosterUrls.push(url.toString());
    if (url.pathname.endsWith("/players/active")) {
      const requestedTeamIds = url.searchParams.getAll("team_ids[]");
      assert.equal(requestedTeamIds.length, 1, "active roster requests must be scoped to one exact slate team");
      const teamId = Number(requestedTeamIds[0]);
      assert.ok(launchTeams.some((team) => team.id === teamId));
      return Response.json({ data: [{ id: teamId * 100, first_name: `QB${teamId}`, last_name: "Starter", position_abbreviation: "QB", team: { id: teamId } }], meta: { next_cursor: null } });
    }
    const requestedPlayerIds = url.searchParams.getAll("player_ids[]").map(Number);
    assert.equal(requestedPlayerIds.length, launchTeams.length);
    return Response.json({ data: requestedPlayerIds.map((playerId) => ({ player: { id: playerId }, passing_attempts: playerId, passing_yards: playerId * 8 })), meta: { next_cursor: null } });
  }) as typeof fetch,
});
assert.equal(launchQbs.byTeamId.size, 16);
assert.equal(launchQbs.providerRequests, 17, "the exact eight-game launch slate must use 16 team-scoped roster calls plus one QB-stat call when each fits one page");
assert.equal(launchRosterUrls.filter((url) => url.includes("/players/active")).length, 16);
assert.ok(launchQbs.providerRequests <= 34, "the launch slate must remain inside the hard 34-call QB-context budget");

let boundedFailureRequests = 0;
await assert.rejects(
  fetchBalldontlieNcaafQuarterbacks({
    teams: [{ id: 10, abbreviation: "UNC" }],
    previousSeason: 2025,
    capturedAt: observedAt,
    apiKey: "test",
    activeRosterPagesPerTeam: 2,
    statsPageBudget: 1,
    maxProviderRequests: 3,
    fetchImpl: (async () => {
      boundedFailureRequests += 1;
      return Response.json({ data: [{ id: 101, first_name: "QB", last_name: "One", position_abbreviation: "QB", team: { id: 10 } }], meta: { next_cursor: boundedFailureRequests } });
    }) as typeof fetch,
  }),
  /\/players\/active exceeded its pagination budget/,
);
assert.equal(boundedFailureRequests, 2, "team-scoped pagination must fail closed at its declared per-team page limit");

await assert.rejects(
  fetchBalldontlieNcaafQuarterbacks({
    teams: [{ id: 10, abbreviation: "UNC" }],
    previousSeason: 2025,
    capturedAt: observedAt,
    apiKey: "test",
    fetchImpl: (async () => Response.json({ data: [{ id: 999, first_name: "Wrong", last_name: "Team", position_abbreviation: "QB", team: { id: 43 } }], meta: { next_cursor: null } })) as typeof fetch,
  }),
  /returned team 43 for team-scoped request 10/,
);

const writerSource = readFileSync(path.join(process.cwd(), "lib/services/football/cfbForwardEvidenceWriter.ts"), "utf8");
const quarterbackCollectionIndex = writerSource.indexOf("fetchBalldontlieNcaafQuarterbacks");
const evidenceAppendIndex = writerSource.lastIndexOf("appendCfbForwardEvidence(");
assert.ok(quarterbackCollectionIndex >= 0 && evidenceAppendIndex > quarterbackCollectionIndex, "the writer must finish bounded QB collection before its sole evidence append");
assert.equal((writerSource.match(/appendCfbForwardEvidence\(/g) ?? []).length, 1, "the writer must keep one all-payload append and never insert partial game evidence inside the collection loop");

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

function splitSetAt(capturedAt: string) {
  const result = normalizeCfbPlaybookSplits(playbookRaw(), capturedAt);
  assert.ok(result);
  return result;
}

function normalizeSportsbook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function selectedQuote(book: NcaafBookOdds, market: "moneyline" | "spread" | "total", side: "home" | "away" | "over" | "under"): { price: number; line: number | null } {
  if (market === "moneyline" && book.moneyline) return { price: side === "home" ? book.moneyline.homePrice : book.moneyline.awayPrice, line: null };
  if (market === "spread" && book.spread) return { price: side === "home" ? book.spread.homePrice : book.spread.awayPrice, line: side === "home" ? book.spread.homeLine : book.spread.awayLine };
  if (market === "total" && book.total) return { price: side === "over" ? book.total.overPrice : book.total.underPrice, line: book.total.line };
  throw new Error(`Missing ${market} quote for ${book.sportsbook}.`);
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
