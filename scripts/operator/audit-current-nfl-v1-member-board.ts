import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardPreviousEvidencePayload,
  type NflForwardStoredEvidence,
} from "../../lib/services/football/nflForwardEvidence";
import { buildNflV1ProductionDecisionBundle } from "../../lib/services/football/nflV1ProductionDecision";
import { buildNflWeekOneHeldMemberFixture } from "../../lib/services/football/nflWeekOneHeldMemberFixture";
import { getNflV1WeekOneOutcomeForecast } from "../../lib/services/football/nflV1WeekOneOutcome";

type ExportFile = {
  readOnly: true;
  season: number;
  week: number;
  latestRows: Array<{
    id: string;
    payloadSha256: string;
    payload: NflForwardPreviousEvidencePayload;
  }>;
};

const { values } = parseArgs({
  options: { input: { type: "string" } },
});
if (!values.input) throw new Error("--input is required.");
const source = JSON.parse(readFileSync(values.input, "utf8")) as ExportFile;
if (!source.readOnly || source.season !== 2026 || source.week !== 1 || source.latestRows.length !== 16) {
  throw new Error("NFL v1 audit requires the exact read-only 16-game 2026 Week 1 export.");
}

const rows: NflForwardStoredEvidence[] = source.latestRows.map((row) => {
  const previous = row.payload;
  const shadow = previous.decisions.shadowEvaluatedBets?.[0];
  if (!shadow) throw new Error(`NFL r6 shadow tuple is missing for ${previous.game.providerGameId}.`);
  const production = buildNflV1ProductionDecisionBundle({
    providerGameId: previous.game.providerGameId,
    awayTeam: previous.game.away.abbreviation,
    homeTeam: previous.game.home.abbreviation,
    gameStartsAt: previous.game.scheduledStart,
    current: previous.market.current,
    comparableCurrentBooks: previous.market.comparableCurrentBooks,
    shadowMoneyline: shadow,
  });
  const payload: NflForwardEvidencePayload = {
    ...previous,
    schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
    collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
    outcomeForecast: getNflV1WeekOneOutcomeForecast({
      providerGameId: previous.game.providerGameId,
      awayTeam: previous.game.away.abbreviation,
      homeTeam: previous.game.home.abbreviation,
    }),
    decisions: {
      ...production,
      shadowEvaluatedBets: [shadow],
    },
  };
  return {
    id: row.id,
    providerGameId: payload.game.providerGameId,
    stage: payload.stage,
    capturedAt: payload.capturedAt,
    gameStartAt: payload.game.scheduledStart,
    payloadSha256: row.payloadSha256,
    payload,
  };
});

const fixture = buildNflWeekOneHeldMemberFixture(rows);
const markets = fixture.snapshot.games.flatMap((game) => [
  [game, "moneyline", game.markets.moneyline] as const,
  [game, "spread", game.markets.first_inning] as const,
  [game, "total", game.markets.total] as const,
]);
const grades = markets.reduce<Record<string, number>>((counts, [, , market]) => {
  counts[market.verdict.label] = (counts[market.verdict.label] ?? 0) + 1;
  return counts;
}, {});
const scorePairs = fixture.snapshot.games.map((game) => ({
  game: `${game.awayTeam}@${game.homeTeam}`,
  score: `${game.projected.away}-${game.projected.home}`,
  moneyline: game.markets.moneyline.pick,
  moneylineGrade: game.markets.moneyline.verdict.label,
  evaluatedBook: game.markets.moneyline.marketSource,
  evaluatedPrice: game.markets.moneyline.priceAmerican,
  expectedValuePct: game.markets.moneyline.pinnacleEvPct,
  valueSideOpposesProjectedWinner: game.markets.moneyline.verdict.label === "Lean" &&
    game.markets.moneyline.pick !== (game.projected.home > game.projected.away ? game.homeTeam : game.awayTeam),
  spread: game.markets.first_inning.pick,
  spreadProbability: game.markets.first_inning.modelProb,
  total: game.markets.total.pick,
  totalProbability: game.markets.total.modelProb,
}));

if (markets.length !== 48 || markets.some(([, , market]) => market.held || !market.pick || market.modelProb === null)) {
  throw new Error("NFL v1 current board is missing a published prediction or contains an unexpected Hold.");
}
if (grades.Lean !== 8 || (grades.Watchlist ?? 0) < 1 || grades["No Play"] !== 40 - grades.Watchlist || Object.keys(grades).length !== 3) {
  throw new Error(`NFL v1 current board count mismatch: ${JSON.stringify(grades)}.`);
}
if (markets.some(([, , market]) => market.verdict.label === "Lean" && (market.pinnacleEvPct ?? 0) <= 0)) {
  throw new Error("NFL v1 contains a Lean without positive expected value at its exact evaluated quote.");
}

console.log(JSON.stringify({
  release: fixture.heldMemberFixtureRelease,
  capturedAt: fixture.capturedAt,
  games: fixture.snapshot.games.length,
  predictions: markets.length,
  grades,
  valueSideLeansOpposingProjectedWinner: scorePairs.filter((row) => row.valueSideOpposesProjectedWinner).length,
  scorePairs,
}, null, 2));
