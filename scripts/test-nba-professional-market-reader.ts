import assert from "node:assert/strict";
import {
  buildNbaProfessionalMarketReader,
  NBA_PROFESSIONAL_MARKET_READER_RELEASE,
  type NbaReaderPriceRow,
  type NbaReaderSplitRow,
} from "../lib/services/nba/nbaProfessionalMarketReader";
import { selectNbaQualifiedSpreadRead } from "../lib/services/nba/nbaProfessionalCandidate";

const game = 401909088;
const evaluatedAt = "2026-10-20T22:00:00.000Z";

function pair(args: {
  market: "moneyline" | "spread" | "total";
  book: string;
  at: string;
  firstLine: number | null;
  firstPrice: number;
  secondPrice: number;
}): NbaReaderPriceRow[] {
  const sides = args.market === "total" ? ["over", "under"] : ["home", "away"];
  return [
    {
      market: args.market,
      sportsbook: args.book,
      sharpBook: ["pinnacle", "circa", "bookmaker"].includes(args.book),
      selectionKey: `${game}:${args.market}:${sides[0]}`,
      line: args.firstLine,
      americanPrice: args.firstPrice,
      providerTimestamp: args.at,
      fetchedAt: args.at,
    },
    {
      market: args.market,
      sportsbook: args.book,
      sharpBook: ["pinnacle", "circa", "bookmaker"].includes(args.book),
      selectionKey: `${game}:${args.market}:${sides[1]}`,
      line: args.market === "spread" && args.firstLine !== null ? -args.firstLine : args.firstLine,
      americanPrice: args.secondPrice,
      providerTimestamp: args.at,
      fetchedAt: args.at,
    },
  ];
}

function split(args: {
  market: "moneyline" | "spread" | "total";
  side: "home" | "over";
  bets: number;
  money: number;
  line: number | null;
}): NbaReaderSplitRow {
  return {
    provider: "sharpapi",
    sourceBook: "draftkings",
    sourceType: "retail_book",
    market: args.market,
    selectionKey: `${game}:${args.market}:${args.side}`,
    betsPct: args.bets,
    moneyPct: args.money,
    marketLine: args.line,
    sourceObservedAt: "2026-10-20T21:45:00.000Z",
    fetchedAt: "2026-10-20T21:46:00.000Z",
  };
}

const twoNamedMl = ["pinnacle", "circa"].flatMap((book) => [
  ...pair({ market: "moneyline", book, at: "2026-10-20T20:00:00.000Z", firstLine: null, firstPrice: -110, secondPrice: -110 }),
  ...pair({ market: "moneyline", book, at: "2026-10-20T21:00:00.000Z", firstLine: null, firstPrice: -130, secondPrice: 110 }),
]);
const ml = buildNbaProfessionalMarketReader({
  evaluatedAt,
  priceRows: twoNamedMl,
  splitRows: [],
  selectedLines: { spreadHome: null, total: null },
});
assert.equal(ml.release, NBA_PROFESSIONAL_MARKET_READER_RELEASE);
assert.equal(ml.policy, "categorical_evidence_no_consensus_weight");
assert.equal(ml.authority, "conditional_spread_only");
assert.equal(ml.evidenceStatus, "complete");
assert.equal(ml.reads.moneyline.status, "qualified");
assert.equal(ml.reads.moneyline.side, "home");
assert.equal(ml.reads.moneyline.reason, "stable_two_named_moneyline_prices");

const spreadAway = ["pinnacle", "bookmaker"].flatMap((book) => [
  ...pair({ market: "spread", book, at: "2026-10-20T20:00:00.000Z", firstLine: -3, firstPrice: -110, secondPrice: -110 }),
  ...pair({ market: "spread", book, at: "2026-10-20T21:00:00.000Z", firstLine: -2, firstPrice: 105, secondPrice: -125 }),
]);
const reverseFlow = buildNbaProfessionalMarketReader({
  evaluatedAt,
  priceRows: spreadAway,
  splitRows: [split({ market: "spread", side: "home", bets: 42, money: 62, line: -2 })],
  selectedLines: { spreadHome: -2, total: null },
});
assert.equal(reverseFlow.reads.spread.status, "qualified");
assert.equal(reverseFlow.reads.spread.side, "away");
assert.equal(reverseFlow.reads.spread.reason, "reverse_flow_resistance");
assert.equal(reverseFlow.reads.spread.resistance, "reverse_flow");
assert.equal(selectNbaQualifiedSpreadRead(reverseFlow), null, "one-point movement remains observation-only");

const strongSpreadAway = ["pinnacle", "bookmaker"].flatMap((book) => [
  ...pair({ market: "spread", book, at: "2026-10-20T20:00:00.000Z", firstLine: -4, firstPrice: -110, secondPrice: -110 }),
  ...pair({ market: "spread", book, at: "2026-10-20T21:00:00.000Z", firstLine: -2, firstPrice: 105, secondPrice: -125 }),
]);
const qualifiedSpread = buildNbaProfessionalMarketReader({
  evaluatedAt,
  priceRows: strongSpreadAway,
  splitRows: [split({ market: "spread", side: "home", bets: 42, money: 62, line: -2 })],
  selectedLines: { spreadHome: -2, total: null },
});
assert.deepEqual(selectNbaQualifiedSpreadRead(qualifiedSpread), {
  side: "away",
  magnitudePoints: 2,
});

const targetExcluded = buildNbaProfessionalMarketReader({
  evaluatedAt,
  priceRows: spreadAway,
  splitRows: [split({ market: "spread", side: "home", bets: 42, money: 62, line: -2 })],
  selectedLines: { spreadHome: -2, total: null },
  excludedSportsbooksByMarket: { spread: ["pinnacle"] },
});
assert.equal(targetExcluded.reads.spread.status, "unavailable");
assert.deepEqual(targetExcluded.reads.spread.excludedSportsbooks, ["pinnacle"]);

const buyback = ["pinnacle", "circa"].flatMap((book) => [
  ...pair({ market: "moneyline", book, at: "2026-10-20T19:00:00.000Z", firstLine: null, firstPrice: -110, secondPrice: -110 }),
  ...pair({ market: "moneyline", book, at: "2026-10-20T20:00:00.000Z", firstLine: null, firstPrice: -130, secondPrice: 110 }),
  ...pair({ market: "moneyline", book, at: "2026-10-20T21:00:00.000Z", firstLine: null, firstPrice: -110, secondPrice: -110 }),
]);
const boughtBack = buildNbaProfessionalMarketReader({
  evaluatedAt,
  priceRows: buyback,
  splitRows: [],
  selectedLines: { spreadHome: null, total: null },
});
assert.equal(boughtBack.reads.moneyline.status, "unavailable");
assert.equal(boughtBack.reads.moneyline.reason, "reversal_or_buyback");

const noEvidence = buildNbaProfessionalMarketReader({
  evaluatedAt,
  priceRows: [],
  splitRows: [],
  selectedLines: { spreadHome: -4, total: 225.5 },
});
assert.equal(noEvidence.reads.moneyline.status, "unavailable");
assert.equal(noEvidence.reads.spread.status, "unavailable");
assert.equal(noEvidence.reads.total.status, "unavailable");

const failedEvidence = buildNbaProfessionalMarketReader({
  evaluatedAt,
  priceRows: twoNamedMl,
  splitRows: [],
  evidenceErrors: ["price_observation_page_truncated"],
  selectedLines: { spreadHome: null, total: null },
});
assert.equal(failedEvidence.evidenceStatus, "unavailable");
assert.equal(failedEvidence.reads.moneyline.status, "unavailable");
assert.equal(failedEvidence.reads.moneyline.reason, "evidence_unavailable");

console.log("nba-professional-market-reader: all assertions passed");
