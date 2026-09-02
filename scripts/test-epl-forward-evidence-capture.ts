import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto } from "../app/lab/lib/labTypes";
import { normalizeEplSplits, type EplSharpFixtureMarket, type EplSharpOddsRecord } from "../lib/providers/real_api/SharpApiEplMarketProvider";
import type { EplShadowSlate, EplShadowSlateMatch } from "../lib/services/epl/buildEplShadowSlate";
import {
  EPL_FORWARD_EVIDENCE_MAX_GAME_BYTES,
  EPL_FORWARD_EVIDENCE_MAX_LANDMARKS,
  EPL_FORWARD_EVIDENCE_MAX_MARKET_BYTES,
  EPL_FORWARD_EVIDENCE_MAX_VECTORS_PER_MARKET,
  buildEplForwardEvidenceCaptures,
  eplForwardEvidenceByteLength,
  mergeEplForwardEvidenceHistory,
  type EplForwardEvidenceCapture,
  type EplForwardMarket,
  type EplForwardStoredPriceObservation,
} from "../lib/services/epl/eplForwardEvidenceCapture";

const kickoff = "2026-09-12T14:00:00.000Z";
const capturedAt = "2026-09-10T14:00:00.000Z";
const books = ["pinnacle", "circa", "draftkings", "fanduel", "betmgm", "caesars", "bovada", "betonline", "betfred"];
const selections: Record<EplForwardMarket, string[]> = {
  match_result: ["home", "draw", "away"],
  double_chance: ["home_or_draw", "away_or_draw", "home_or_away"],
  total: ["over", "under"],
  btts: ["yes", "no"],
};
const basePrices: Record<EplForwardMarket, number[]> = {
  match_result: [120, 240, 210],
  double_chance: [-180, -150, -260],
  total: [-105, -115],
  btts: [-125, 105],
};

function oddsRows(): EplSharpOddsRecord[] {
  return books.flatMap((sportsbook, bookIndex) => (Object.keys(selections) as EplForwardMarket[]).flatMap((market) =>
    selections[market].map((selection, sideIndex) => ({
      market,
      selection: selection as EplSharpOddsRecord["selection"],
      line: market === "total" ? 2.5 : null,
      odds_american: basePrices[market][sideIndex]! + bookIndex * 2,
      odds_decimal: null,
      sportsbook,
      provider: "sharpapi" as const,
      provider_endpoint: `/odds?event_id=event-${market}`,
      fetched_at: new Date(Date.parse(capturedAt) + sideIndex * 1_000).toISOString(),
      provider_event_id: `event-${market}`,
      fetched_at_source: "provider" as const,
    }))));
}

function marketDto(market: EplForwardMarket): MarketEdgeDto {
  const sideList = selections[market];
  const prices = basePrices[market];
  return {
    pick: sideList[0]!,
    modelProb: market === "double_chance" ? 0.72 : 0.56,
    marketFairProb: market === "double_chance" ? 0.68 : 0.52,
    currentPriceAmerican: prices[0]!,
    currentPriceSportsbook: "pinnacle",
    currentPriceObservedAt: capturedAt,
    marketSource: "sharpapi",
    line: market === "total" ? 2.5 : null,
    grade: "Lean",
    verdict: { key: "lean", label: "Lean" },
    soccerPriceBoard: {
      sportsbook: "pinnacle",
      observed_at: capturedAt,
      rows: sideList.map((side, index) => ({
        side,
        label: side,
        price_american: prices[index]!,
        model_probability: 0.5,
        market_probability: 0.5,
        edge_pp: 0,
        selected: index === 0,
        odds_trail: [],
        earliest_market_quote: null,
      })),
    },
  } as unknown as MarketEdgeDto;
}

const evidenceSide = {
  priorSeasonRank: 4,
  priorSeasonRecord: "20-8-10",
  priorSeasonGoalDifference: 24,
  providerPosition: 3,
  providerRating: 7.2,
  recentForm: ["W", "D", "W"] as Array<"W" | "D" | "L">,
  recentPoints: 7,
  sampleMatches: 10,
  statMatches: 10,
  xgMatches: 9,
  avgGoalsFor: 1.8,
  avgGoalsAgainst: 1.1,
  avgXgFor: 1.72,
  avgXgAgainst: 1.13,
  avgShots: 14,
  avgShotsOnTarget: 5,
  avgPossession: 54,
  avgBigChances: 2.1,
  injuryCount: 1,
  injuries: [{ name: "Player", status: "out", injury: "ankle", updatedAt: "2026-09-09T12:00:00.000Z" }],
  startersPosted: 11,
};

const match = {
  id: 501,
  round: 4,
  kickoff,
  homeTeam: { id: 1, abbreviation: "ARS" },
  awayTeam: { id: 2, abbreviation: "CHE" },
  prediction: {
    lambdaHome: 1.734567891,
    lambdaAway: 1.123456789,
    expectedTotal: 2.85802468,
    probabilities: { home: 0.51, draw: 0.25, away: 0.24, over25: 0.56, under25: 0.44, bttsYes: 0.57, bttsNo: 0.43 },
    rawDerivedProbabilities: { over25: 0.57321, bttsYes: 0.60234 },
    confidence: "standard",
    homeStrengthSource: "club_history",
    awayStrengthSource: "club_history",
  },
  currentMoneylineOdds: [],
  openingOdds: [],
  modelUncertainty: { homeEffectiveMatches: 31.25, awayEffectiveMatches: 29.75 },
  evidence: { home: evidenceSide, away: { ...evidenceSide, injuries: [] }, lineupsPosted: true },
} as unknown as EplShadowSlateMatch;

const game = {
  external_id: 501,
  gameStartAt: kickoff,
  projected: { away: 1.223344556, home: 1.776655443 },
  soccerProjection: {
    expectedGoals: { away: 1.223344556, home: 1.776655443 },
    likelyScore: { away: 1, home: 2 },
    likelyScoreProbability: 0.123456789,
    representativeScore: { away: 1, home: 2 },
    representativeScoreProbability: 0.123456789,
    medianTotal: 3,
    mostLikelyTotal: 2,
  },
  markets: { moneyline: marketDto("match_result"), total: marketDto("total"), first_inning: marketDto("btts") },
  soccerDoubleChanceMarket: marketDto("double_chance"),
} as unknown as DailyEdgeGameDto;

const slate = {
  matches: [match],
  trainedThrough: "2026-08-30T00:00:00.000Z",
  trainingMatches: 1000,
  modelRelease: "epl_goals_coherent_2026_08_20_r16",
  calibrationRelease: "epl_grade_policy_2026_08_20_v21",
} as unknown as EplShadowSlate;
const response = { games: [game] } as unknown as DailyEdgeResponse;
const fixture: EplSharpFixtureMarket = {
  eventId: "event-match_result",
  odds: oddsRows(),
  splitsState: "present",
  splits: normalizeEplSplits([{
    event_id: "event-match_result",
    sportsbook: "action-network",
    timestamp: "2026-09-10T13:59:00.000Z",
    markets: [{ key: "moneyline", outcomes: [
      { selection: "home", bet_percent: 61, money_percent: 54 },
      { selection: "draw", bet_percent: 18, money_percent: 21 },
      { selection: "away", bet_percent: 21, money_percent: 25 },
    ] }],
  } as never], { home: "ARS", away: "CHE" }),
};

const stored: EplForwardStoredPriceObservation[] = (Object.keys(selections) as EplForwardMarket[]).flatMap((market) =>
  selections[market].map((side, index) => ({
    providerId: 501,
    market,
    side,
    line: market === "total" ? 2.5 : null,
    american: basePrices[market][index]! - 10,
    sportsbook: "pinnacle",
    recordedAt: "2026-09-08T14:00:00.000Z",
    isOpener: true,
  })));

const responseBefore = JSON.stringify(response);
const capture = buildEplForwardEvidenceCaptures({ slate, response, fixtureMarkets: [fixture], storedPriceHistory: stored, capturedAt })[0]!;
assert.equal(JSON.stringify(response), responseBefore, "capture must not mutate the member/champion response");
assert.deepEqual(capture.champion.projected, game.projected);
assert.deepEqual(capture.champion.soccerProjection, game.soccerProjection);
assert.equal(capture.champion.projected.home, game.projected.home, "champion decimal output must remain number-identical");
assert.equal(capture.independent.lambdaHome, match.prediction.lambdaHome, "independent xG must retain full precision");
assert.equal(capture.independent.homeEffectiveMatches, 31.25);

for (const market of Object.keys(selections) as EplForwardMarket[]) {
  const slice = capture.markets[market];
  assert.deepEqual(slice.requiredOutcomes, selections[market]);
  assert.equal(slice.evaluated?.canonicalBook, "pinnacle");
  assert.ok(slice.targetExcluded.every((vector) => vector.canonicalBook !== "pinnacle"), "evaluated quote must be target-excluded");
  assert.ok(slice.targetExcluded.length + Number(Boolean(slice.evaluated)) <= EPL_FORWARD_EVIDENCE_MAX_VECTORS_PER_MARKET);
  assert.ok(eplForwardEvidenceByteLength(slice) <= EPL_FORWARD_EVIDENCE_MAX_MARKET_BYTES);
  assert.equal(slice.evaluated?.vectorSkewMs, (selections[market].length - 1) * 1_000);
  assert.ok(slice.movements.every((movement) => movement.sportsbook === "pinnacle"), "movement must remain exact same-book");
}
assert.equal(capture.markets.match_result.evaluated?.outcomes.find((row) => row.side === "draw")?.american, 240, "three-way draw must be preserved");
assert.equal(capture.markets.double_chance.evaluated?.probabilityTotal, 2, "DC overlapping probabilities must retain sum-two semantics");
assert.equal(capture.markets.total.line, 2.5, "Total capture must retain exact line identity");
assert.ok(capture.markets.match_result.circaVectorIdentity, "Circa provenance exists only because a real Circa vector was supplied");
assert.equal(capture.markets.match_result.publicEvidence?.betsPct.home, 61);
assert.equal(capture.markets.match_result.publicEvidence?.handlePct.home, 54);
assert.equal(capture.markets.match_result.publicEvidence?.providerEventId, "event-match_result");
assert.equal(capture.markets.match_result.publicEvidence?.sportsbook, "action-network");
assert.equal(capture.markets.double_chance.publicEvidence, null, "unsupported public class must remain absent");

const missing = buildEplForwardEvidenceCaptures({
  slate,
  response,
  fixtureMarkets: [{ eventId: null, odds: [], splits: [], splitsState: "unavailable" }],
  storedPriceHistory: [],
  capturedAt,
})[0]!;
assert.equal(missing.markets.total.evaluated, null);
assert.equal(missing.markets.total.targetExcluded.length, 0);
assert.equal(missing.markets.total.publicEvidence, null);
assert.equal(missing.markets.total.circaVectorIdentity, null);
assert.equal(missing.markets.total.unavailableReasons.circa, "authentic_circa_vector_absent_from_incumbent_payload");
assert.equal(missing.markets.total.unavailableReasons.publicEvidence, "authentic_market_split_absent_from_incumbent_payload");
assert.equal(missing.champion.markets.total.modelProbability, game.markets.total.modelProb, "missing evidence must not flatten champion output");

let snapshot: Record<string, unknown> | null = null;
for (let index = 0; index < 10; index++) {
  const next = structuredClone(capture) as EplForwardEvidenceCapture;
  next.capturedAt = new Date(Date.parse(capturedAt) + index * 60 * 60_000).toISOString();
  next.champion.markets.match_result.currentPriceAmerican = 120 + index;
  const history = mergeEplForwardEvidenceHistory(snapshot, next);
  snapshot = { epl_forward_evidence_history: history };
}
const history = snapshot!.epl_forward_evidence_history as ReturnType<typeof mergeEplForwardEvidenceHistory>;
assert.ok(history.captures.length <= EPL_FORWARD_EVIDENCE_MAX_LANDMARKS);
assert.ok(history.omittedCaptureCount > 0);
assert.ok(eplForwardEvidenceByteLength(history) <= EPL_FORWARD_EVIDENCE_MAX_GAME_BYTES);
assert.equal(history.captures[0]?.capturedAt, capturedAt, "first landmark must survive deterministic pruning");
assert.equal(history.captures.at(-1)?.capturedAt, new Date(Date.parse(capturedAt) + 9 * 60 * 60_000).toISOString(), "latest landmark must survive deterministic pruning");

const directSplit = normalizeEplSplits([{
  event_id: "split-2",
  sportsbook: "circa",
  fetched_at: "2026-09-10T12:00:00.000Z",
  moneyline: { bets_pct: { home: 50 }, handle_pct: { home: 49 } },
} as never], { home: "ARS", away: "CHE" })[0]!;
assert.equal(directSplit.provider_endpoint, "/splits");
assert.equal(directSplit.provider_event_id, "split-2");
assert.equal(directSplit.fetched_at_source, "provider");

const writer = readFileSync("lib/services/epl/eplProductionPipeline.ts", "utf8");
const captureSource = readFileSync("lib/services/epl/eplForwardEvidenceCapture.ts", "utf8");
assert.ok(writer.indexOf("if (prior?.locked_at)") < writer.indexOf("attachCapture(row, prior?.snapshot_json"), "locked snapshot precedence must occur before capture merge");
assert.equal((writer.match(/\.upsert\(/g) ?? []).length, 3, "capture must not add a writer/upsert");
assert.match(writer, /if \(row\.market !== "match_result"\) return/);
assert.doesNotMatch(captureSource, /supabase|SharpApiClient|fetch\(/, "capture serializer must consume only incumbent cached inputs");
const dailyRoute = readFileSync("app/api/cron/epl-daily-refresh/route.ts", "utf8");
const lockRoute = readFileSync("app/api/cron/epl-pregame-lock/route.ts", "utf8");
for (const route of [dailyRoute, lockRoute]) {
  assert.equal((route.match(/readEplStoredPriceHistory\(/g) ?? []).length, 1, "route must reuse its one existing price-history read");
  assert.match(route, /leaseGroup: "prediction_pipeline"/);
  assert.match(route, /sport: "soccer"/);
  assert.match(route, /captureForwardEvidence/);
}

console.log("EPL bounded forward evidence, provenance, missing identity, same-book movement, lock precedence, and champion identity passed.");
