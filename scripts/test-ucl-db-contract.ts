import assert from "node:assert/strict";
import { preserveLockedEplGames } from "../lib/services/epl/eplLockedSnapshot";
import { verifyUclRefreshAllMarketLocks, writeUclPredictionRecords, verifyUclAllMarketLocks } from "../lib/services/ucl/uclProductionPipeline";
import { UCL_EXTERNAL_ID_OFFSET } from "../lib/services/ucl/uclCompetitionContext";
import { UCL_CALIBRATION_RELEASE, UCL_MODEL_RELEASE } from "../lib/services/ucl/uclModel";
import { supabase } from "../lib/db/supabase";
import { ingestUclFinalScores } from "../lib/services/ucl/uclScoreIngestService";
import { gradePrediction } from "../lib/services/predictionGrader";
import { isTrackingRecordEligible } from "../lib/services/trackingAggregateService";
import { gradePredictionsForSlate } from "../lib/services/predictionGradingService";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";
import type { DailyEdgeResponse } from "../app/lab/lib/labTypes";

type Operation = { table: string; kind: string; payload?: Record<string, unknown>; filters: Record<string, unknown> };

function writerClient(operations: Operation[]) {
  return {
    from(table: string) {
      const operation: Operation = { table, kind: "", filters: {} };
      operations.push(operation);
      const chain = {
        select() { operation.kind = "select"; return chain; },
        update(payload: Record<string, unknown>) { operation.kind = "update"; operation.payload = payload; return chain; },
        upsert(payload: Record<string, unknown>) { operation.kind = "upsert"; operation.payload = payload; return chain; },
        eq(key: string, value: unknown) { operation.filters[key] = value; return chain; },
        in(key: string, value: unknown) { operation.filters[key] = value; return chain; },
        is(key: string, value: unknown) { operation.filters[key] = value; return chain; },
        then(resolve: (value: unknown) => void) {
          if (table === "games") return Promise.resolve(resolve({ data: [{ id: 501, external_id: UCL_EXTERNAL_ID_OFFSET + 34 }], error: null }));
          if (operation.kind === "select") {
            const prior = operation.filters.market === "total"
              ? [{ id: 77, model_version: UCL_MODEL_RELEASE, calibration_version: UCL_CALIBRATION_RELEASE, locked_at: null, held: false, snapshot_json: { immutable: "prior", current_price: -115 } }]
              : [];
            return Promise.resolve(resolve({ data: prior, error: null }));
          }
          return Promise.resolve(resolve({ data: null, error: null }));
        },
      };
      return chain;
    },
  } as unknown as typeof supabase;
}

function market(side: string, price: number | null) {
  const marketFairProb = price === null ? null : 0.52;
  const expectedValue = price === null ? null : 0.6 * (price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price)) - 1;
  return {
    pick: side, modelProb: 0.6, marketFairProb,
    priceAmerican: price, modelMarketGapPct: marketFairProb === null ? null : 8,
    pinnacleEvPct: expectedValue === null ? null : expectedValue * 100,
    currentPriceAmerican: price, currentPriceSportsbook: "Test Book", lineOpenAmerican: price,
    line: side === "over" ? 2.5 : null, held: price === null,
    verdict: { key: "no_play", label: "No Play" }, riskLine: "UCL validation hold",
    soccerPriceBoard: price === null ? null : { rows: [{ side, selected: true }] },
    publicSplits: [], oddsTrail: [], status: {},
  };
}

async function main() {
const kickoff = "2026-09-08T17:45:00Z";
const slate = {
  season: 2026, round: 1, modelRelease: UCL_MODEL_RELEASE, calibrationRelease: UCL_CALIBRATION_RELEASE,
  competitionContexts: { 34: { stage: "league_phase", regulationTime: true } },
  matches: [{ id: 34, kickoff, homeTeam: { id: 1 }, awayTeam: { id: 2 } }],
} as never;
const response = {
  games: [{
    external_id: 34, awayTeam: "AWY", homeTeam: "HOM", gameStartAt: kickoff,
    status: { lineupConfirmed: null }, soccerProjection: { expectedHomeGoals: 1.4, expectedAwayGoals: 1.1 }, soccerModelProvenance: { release: UCL_MODEL_RELEASE },
    markets: { moneyline: market("home", -110), total: market("over", null), first_inning: market("yes", null) },
    soccerDoubleChanceMarket: market("home_or_draw", -120),
  }],
} as never;

const operations: Operation[] = [];
const write = await writeUclPredictionRecords({
  slate, response, apply: true, now: new Date("2026-09-08T16:45:00Z"), client: writerClient(operations),
});
assert.deepEqual(write.errors, []);
const priorLock = operations.find((operation) => operation.kind === "update");
assert.deepEqual(Object.keys(priorLock?.payload ?? {}), ["locked_at"], "disappearing quote may only add the lock timestamp");
assert.equal(priorLock?.filters.id, 77);
assert.equal(write.priorTuplesLocked, 1);
assert.deepEqual(write.lockedRecordIds, [77]);
assert.equal(operations.some((operation) => operation.kind === "upsert" && operation.payload?.market === "total"), false);
const missingBtts = operations.find((operation) => operation.kind === "upsert" && operation.payload?.market === "btts");
assert.equal(missingBtts?.payload?.held, true, "always-missing market locks as an explicit held row");
assert.equal(typeof missingBtts?.payload?.locked_at, "string");

function lockVerificationClient(rows: Array<{ external_id: number; market: string; locked_at: string | null }>) {
  return { from() { const chain = { select() { return chain; }, in() { return chain; }, not() { return chain; }, then(resolve: (value: unknown) => void) { return Promise.resolve(resolve({ data: rows, error: null })); } }; return chain; } } as unknown as typeof supabase;
}
const four = write.proposed.map((row, index) => ({ ...row, id: row.market === "total" ? 77 : 100 + index, locked_at: "2026-09-08T16:45:00Z" }));
const priorTotal = four.find((row) => row.market === "total")!;
const priorTotalMarket = market("over", -115);
priorTotal.pick = "over";
priorTotal.side = "over";
priorTotal.odds_american = -115;
priorTotal.market_probability = 0.52;
priorTotal.edge = 8;
priorTotal.expected_value = 0.6 * (1 + 100 / 115) - 1;
priorTotal.held = false;
priorTotal.hold_reason = null;
priorTotal.snapshot_json = { ...(priorTotal.snapshot_json ?? {}), selected_display_pick: priorTotalMarket.pick, complete_price_board: priorTotalMarket.soccerPriceBoard, current_price: -115, member_market_at_capture: priorTotalMarket };
const lockInput = { providerIds: [34], modelRelease: UCL_MODEL_RELEASE, calibrationRelease: UCL_CALIBRATION_RELEASE, expectedRows: write.proposed, writerLockedRecordIds: write.lockedRecordIds, response };
const verified = await verifyUclAllMarketLocks(lockInput, lockVerificationClient(four));
assert.deepEqual({ completeProviderIds: verified.completeProviderIds, incompleteProviderIds: verified.incompleteProviderIds }, { completeProviderIds: [34], incompleteProviderIds: [] }, "writer-returned prior tuple ID closes disappearing-price identity");
assert.equal(verified.lockedResponse.games[0]?.markets.total.currentPriceAmerican, -115, "locked member card reconstructs the prior immutable DB tuple instead of the fresh held tuple");
assert.equal(verified.lockedResponse.games[0]?.markets.total.held, false);
assert.deepEqual(verified.lockedResponse.games[0]?.soccerProjection, { expectedHomeGoals: 1.4, expectedAwayGoals: 1.1 }, "locked projected score/probability payload is reconstructed from the common DB capture");
const incomplete = await verifyUclAllMarketLocks(lockInput, lockVerificationClient(four.slice(0, 3)));
assert.deepEqual({ completeProviderIds: incomplete.completeProviderIds, incompleteProviderIds: incomplete.incompleteProviderIds }, { completeProviderIds: [], incompleteProviderIds: [34] });
const partialRefreshLock = await verifyUclRefreshAllMarketLocks({
  response, now: new Date("2026-09-08T16:45:00Z"), modelRelease: UCL_MODEL_RELEASE,
  calibrationRelease: UCL_CALIBRATION_RELEASE, expectedRows: write.proposed,
  writerLockedRecordIds: write.lockedRecordIds,
}, lockVerificationClient(four.slice(0, 3)));
assert.deepEqual(partialRefreshLock.incompleteProviderIds, [34], "the general refresh fails closed on a partial T60 manifest");
assert.deepEqual(partialRefreshLock.lockedResponse, response, "partial refresh verification cannot manufacture a locked member tuple");
const completeRefreshLock = await verifyUclRefreshAllMarketLocks({
  response, now: new Date("2026-09-08T16:45:00Z"), modelRelease: UCL_MODEL_RELEASE,
  calibrationRelease: UCL_CALIBRATION_RELEASE, expectedRows: write.proposed,
  writerLockedRecordIds: write.lockedRecordIds,
}, lockVerificationClient(four));
assert.deepEqual(completeRefreshLock.completeProviderIds, [34], "the refresh verifies the same four-market T60 authority as the targeted lock route");
assert.equal(completeRefreshLock.lockedResponse.games[0]?.markets.total.currentPriceAmerican, -115, "refresh reconstructs the disappearing quote from the immutable DB tuple");
const wrongRelease = four.map((row) => row.market === "btts" ? { ...row, model_version: "ucl_wrong_release" } : row);
assert.deepEqual((await verifyUclAllMarketLocks(lockInput, lockVerificationClient(wrongRelease))).incompleteProviderIds, [34]);
const wrongCompetition = four.map((row) => row.market === "btts" ? { ...row, snapshot_json: { ...(row.snapshot_json ?? {}), competition: "english_premier_league" } } : row);
assert.deepEqual((await verifyUclAllMarketLocks(lockInput, lockVerificationClient(wrongCompetition))).incompleteProviderIds, [34]);
const wrongTuple = four.map((row) => row.market === "btts" ? { ...row, odds_american: -999 } : row);
assert.deepEqual((await verifyUclAllMarketLocks(lockInput, lockVerificationClient(wrongTuple))).incompleteProviderIds, [34]);
for (const [field, value] of [
  ["pick", "under"],
  ["best_angle", true],
  ["no_bet", false],
  ["hold_reason", "fresh_missing_quote"],
  ["line_value", 3.5],
] as const) {
  const corrupted = four.map((row) => row.market === "total" ? { ...row, [field]: value } : row);
  assert.deepEqual(
    (await verifyUclAllMarketLocks(lockInput, lockVerificationClient(corrupted))).incompleteProviderIds,
    [34],
    `${field} mismatch cannot pass via the writer-returned prior record ID`,
  );
}

function alreadyLockedWriterClient(rows: typeof four, operations: Operation[]) {
  return {
    from(table: string) {
      const operation: Operation = { table, kind: "", filters: {} };
      operations.push(operation);
      const chain = {
        select() { operation.kind = "select"; return chain; },
        update(payload: Record<string, unknown>) { operation.kind = "update"; operation.payload = payload; return chain; },
        upsert(payload: Record<string, unknown>) { operation.kind = "upsert"; operation.payload = payload; return chain; },
        eq(key: string, value: unknown) { operation.filters[key] = value; return chain; },
        in(key: string, value: unknown) { operation.filters[key] = value; return chain; },
        is(key: string, value: unknown) { operation.filters[key] = value; return chain; },
        then(resolve: (value: unknown) => void) {
          if (table === "games") return Promise.resolve(resolve({ data: [{ id: 501, external_id: UCL_EXTERNAL_ID_OFFSET + 34 }], error: null }));
          if (operation.kind === "select") {
            return Promise.resolve(resolve({ data: rows.filter((row) => row.market === operation.filters.market), error: null }));
          }
          return Promise.resolve(resolve({ data: null, error: null }));
        },
      };
      return chain;
    },
  } as unknown as typeof supabase;
}
const repairOperations: Operation[] = [];
const repairWrite = await writeUclPredictionRecords({
  slate,
  response,
  apply: true,
  now: new Date("2026-09-08T16:55:00Z"),
  client: alreadyLockedWriterClient(four, repairOperations),
});
assert.deepEqual([...repairWrite.lockedRecordIds].sort((a, b) => a - b), four.map((row) => row.id).sort((a, b) => a - b), "snapshot repair returns exact already-locked current-authority IDs");
assert.equal(repairOperations.some((operation) => operation.kind === "update" || operation.kind === "upsert"), false, "snapshot repair never mutates an existing lock");
const repaired = await verifyUclAllMarketLocks({ ...lockInput, expectedRows: repairWrite.proposed, writerLockedRecordIds: repairWrite.lockedRecordIds }, lockVerificationClient(four));
assert.deepEqual(repaired.completeProviderIds, [34], "a T1 DB lock can reconstruct the member snapshot during a T2 repair cycle");
assert.equal(repaired.lockedResponse.games[0]?.markets.total.currentPriceAmerican, -115);

for (const trackedMarket of ["match_result", "double_chance", "total", "btts"] as const) {
  const heldRecord = {
    ...write.proposed[0], id: 900 + ["match_result", "double_chance", "total", "btts"].indexOf(trackedMarket),
    market: trackedMarket, pick: null, side: null, held: true, no_bet: true, locked_at: "2026-09-08T16:45:00Z",
    snapshot_json: { competition: "uefa_champions_league" },
  } as PredictionRecordRow;
  const grade = gradePrediction({ record: heldRecord, game: { status: "final", home_score: 2, away_score: 1, first_inning_runs: null }, source: "auto_score_ingest" });
  assert.equal(grade.result, "void", `${trackedMarket} held lock-manifest row settles void`);
  assert.equal(isTrackingRecordEligible(heldRecord), false, `${trackedMarket} held row contributes zero public W/L`);
}

function uclGradingClient(rows: PredictionRecordRow[]) {
  return {
    from(table: string) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        contains() { return chain; },
        not() { return chain; },
        in() { return chain; },
        then(resolve: (value: unknown) => void) {
          const data = table === "prediction_records"
            ? rows
            : table === "games"
              ? [{ id: 501, status: "final", home_score: 2, away_score: 1, first_inning_runs: null, game_date: kickoff }]
              : [];
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return chain;
    },
  } as unknown as typeof supabase;
}

const gradingSides = {
  match_result: { pick: "home", side: "home", line_value: null },
  double_chance: { pick: "home_or_draw", side: "home_or_draw", line_value: null },
  total: { pick: "over", side: "over", line_value: 2.5 },
  btts: { pick: "yes", side: "yes", line_value: null },
} as const;
const completeGradingManifest = four.map((row) => ({
  ...row,
  ...gradingSides[row.market as keyof typeof gradingSides],
  held: false,
  no_bet: true,
  locked_at: "2026-09-08T16:45:00Z",
  snapshot_json: { ...(row.snapshot_json ?? {}), competition: "uefa_champions_league" },
})) as PredictionRecordRow[];
const partialGrade = await gradePredictionsForSlate({
  sport: "soccer", slateDate: "2026-09-08", apply: false,
  supabase: uclGradingClient(completeGradingManifest.slice(0, 3)),
  source: "auto_score_ingest", competition: "uefa_champions_league",
});
assert.equal(partialGrade.recordsLoaded, 0, "a partial three-market UCL lock manifest is settlement-ineligible");
assert.equal(partialGrade.upsertedCount, 0, "a partial UCL manifest produces zero grade upserts");
const completeGrade = await gradePredictionsForSlate({
  sport: "soccer", slateDate: "2026-09-08", apply: false,
  supabase: uclGradingClient(completeGradingManifest),
  source: "auto_score_ingest", competition: "uefa_champions_league",
});
assert.equal(completeGrade.recordsLoaded, 4, "the exact four-market UCL lock manifest is settlement-eligible");
assert.equal(completeGrade.upsertedCount, 4, "the complete UCL manifest reaches the grader");

const lockedMarket = { immutable: "locked-price-probability-grade-evidence" };
const previous = { date: "2026-09-08", games: [{ external_id: 34, id: "old", sport: "soccer", lockState: "locked", lockedAt: "2026-09-08T16:45:00Z", gameStartAt: kickoff, markets: lockedMarket, soccerProjection: { home: 1.2 } }] } as unknown as DailyEdgeResponse;
const incoming = { date: "2026-09-08", games: [{ external_id: 34, id: "fresh", sport: "soccer", lockState: "locking", lockedAt: null, gameStartAt: kickoff, markets: { replaced: true }, soccerProjection: { home: 9 }, result: { final: true } }] } as unknown as DailyEdgeResponse;
const preserved = preserveLockedEplGames(previous, incoming, new Date("2026-09-08T17:00:00Z"), { boardDate: "2026-09-08" });
assert.equal(preserved.games[0]?.markets, lockedMarket);
assert.deepEqual(preserved.games[0]?.soccerProjection, { home: 1.2 });
assert.deepEqual(preserved.games[0]?.result, { final: true });

const priorDayLocked = { ...previous.games[0]!, external_id: 35, gameStartAt: "2026-09-09T19:00:00Z" };
const nextRoundOpen = { ...incoming.games[0]!, external_id: 44, gameStartAt: "2026-09-29T19:00:00Z" };
const beforeEtMidnight = preserveLockedEplGames(
  { ...previous, date: "2026-09-09", games: [priorDayLocked] },
  { ...incoming, date: "2026-09-29", games: [nextRoundOpen] },
  new Date("2026-09-10T03:59:59Z"),
  { boardDate: "2026-09-09" },
);
assert.deepEqual(beforeEtMidnight.games.map((game) => game.external_id), [35, 44], "a missing locked UCL final remains through the last second of its ET day");
assert.equal(beforeEtMidnight.date, "2026-09-09", "same-day locked UCL carryover keeps the frozen board date");
const atEtMidnight = preserveLockedEplGames(
  { ...previous, date: "2026-09-09", games: [priorDayLocked] },
  { ...incoming, date: "2026-09-10", games: [nextRoundOpen] },
  new Date("2026-09-10T04:00:00Z"),
  { boardDate: "2026-09-10" },
);
assert.deepEqual(atEtMidnight.games.map((game) => game.external_id), [44], "a missing prior-day locked UCL final rolls off exactly at ET midnight");
assert.equal(atEtMidnight.date, "2026-09-10", "the incoming UCL board retains the frozen post-midnight date");

const settlementPayloads: Array<Record<string, unknown>> = [];
const settlementClient = {
  from() {
    const chain = {
      select() { return chain; }, eq() { return chain; }, gte() { return chain; }, lt() { return chain; },
      update(payload: Record<string, unknown>) { settlementPayloads.push(payload); return chain; },
      then(resolve: (value: unknown) => void) {
        const data = settlementPayloads.length ? null : [{ id: 501, external_id: UCL_EXTERNAL_ID_OFFSET + 34, status: "scheduled", home_score: null, away_score: null, inning_scores: null }];
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    return chain;
  },
} as unknown as typeof supabase;
const settled = await ingestUclFinalScores({
  slateDate: "2026-09-08", apply: true, client: settlementClient,
  featureEnv: { UCL_PIPELINE_ENABLED: "true", UCL_DB_WRITES_ENABLED: "true" },
  provider: { listMatches: async () => [{
    id: 34, season: 2026, home_team_id: 1, away_team_id: 2, date: kickoff,
    name: "AWY at HOM", short_name: "AWY @ HOM", status: "STATUS_FINAL_PEN", status_state: "final", status_detail: "FT-Pens",
    home_score: 5, away_score: 4, first_half_home_score: 0, first_half_away_score: 1,
    second_half_home_score: 1, second_half_away_score: 0, venue_name: null, venue_city: null, round_number: null,
  }] },
});
assert.equal(settled.updated, 1);
const settlementPayload = settlementPayloads.at(-1)!;
assert.equal(settlementPayload.home_score, 1);
assert.equal(settlementPayload.away_score, 1);
assert.deepEqual((settlementPayload.inning_scores as { regulationScore: unknown }).regulationScore, { home: 1, away: 1 });

const disabledSettlement = await ingestUclFinalScores({
  slateDate: "2026-09-08", apply: true, client: settlementClient, featureEnv: {},
  provider: { listMatches: async () => { throw new Error("disabled settlement must not call provider"); } },
});
assert.equal(disabledSettlement.apiEventsFetched, 0);

console.log("UCL DB lock and immutable reader contracts passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
