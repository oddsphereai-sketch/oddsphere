import { strict as assert } from "node:assert";
import {
  coherentNoVigReference,
  formatNbaSpreadSelection,
  resolveNbaFairReference,
  selectBestNbaExecutableOffer,
  type NbaLineRow,
} from "../lib/services/nba/nbaMarketIntelligence";

const rows: NbaLineRow[] = [
  { market_type: "moneyline", sportsbook: "circa", side: "home", line_value: null, odds_american: -150, fetched_at: null },
  { market_type: "moneyline", sportsbook: "circa", side: "away", line_value: null, odds_american: 130, fetched_at: null },
  { market_type: "moneyline", sportsbook: "pinnacle", side: "home", line_value: null, odds_american: -145, fetched_at: null },
  { market_type: "moneyline", sportsbook: "pinnacle", side: "away", line_value: null, odds_american: 125, fetched_at: null },
  { market_type: "spread", sportsbook: "circa", side: "home", line_value: -3.5, odds_american: -108, fetched_at: null },
  { market_type: "spread", sportsbook: "circa", side: "away", line_value: 3.5, odds_american: -112, fetched_at: null },
  { market_type: "spread", sportsbook: "pinnacle", side: "home", line_value: -4.5, odds_american: 105, fetched_at: null },
  { market_type: "spread", sportsbook: "pinnacle", side: "away", line_value: 4.5, odds_american: -125, fetched_at: null },
  { market_type: "total", sportsbook: "circa", side: "over", line_value: 224.5, odds_american: -110, fetched_at: null },
  { market_type: "total", sportsbook: "circa", side: "under", line_value: 224.5, odds_american: -110, fetched_at: null },
  { market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 225.5, odds_american: 100, fetched_at: null },
  { market_type: "total", sportsbook: "pinnacle", side: "under", line_value: 225.5, odds_american: -120, fetched_at: null },
];

const moneyline = coherentNoVigReference({
  lines: rows,
  market: "moneyline",
  pickSide: "home",
  pickLine: null,
});
assert.equal(moneyline.books.length, 2);
assert(moneyline.probability !== null && moneyline.probability > 0.56 && moneyline.probability < 0.59);
const targetExcludedMoneyline = coherentNoVigReference({
  lines: rows,
  market: "moneyline",
  pickSide: "home",
  pickLine: null,
  excludedSportsbooks: ["CIRCA"],
});
assert.deepEqual(targetExcludedMoneyline.books, ["pinnacle"]);
assert.notEqual(targetExcludedMoneyline.probability, moneyline.probability);

const targetExcludedFairReference = resolveNbaFairReference({
  lines: rows,
  market: "moneyline",
  pickSide: "home",
  pickLine: null,
  selectedSportsbook: "circa",
});
assert.equal(targetExcludedFairReference.mode, "target_excluded");
assert.deepEqual(targetExcludedFairReference.books, ["pinnacle"]);

const selectedBookFallback = resolveNbaFairReference({
  lines: rows.filter((row) => row.sportsbook === "circa"),
  market: "moneyline",
  pickSide: "home",
  pickLine: null,
  selectedSportsbook: "circa",
});
assert.equal(selectedBookFallback.mode, "selected_book_fallback");
assert.deepEqual(selectedBookFallback.books, ["circa"]);
assert(selectedBookFallback.probability !== null);

const unavailableFallback = resolveNbaFairReference({
  lines: rows.filter((row) => row.sportsbook === "circa" && row.side === "home"),
  market: "moneyline",
  pickSide: "home",
  pickLine: null,
  selectedSportsbook: "circa",
});
assert.equal(unavailableFallback.mode, "unavailable");
assert.equal(unavailableFallback.probability, null);

const spread = coherentNoVigReference({
  lines: rows,
  market: "spread",
  pickSide: "home",
  pickLine: -3.5,
});
assert.deepEqual(spread.books, ["circa"]);
assert(spread.probability !== null && spread.probability > 0.49 && spread.probability < 0.51);

const total = coherentNoVigReference({
  lines: rows,
  market: "total",
  pickSide: "over",
  pickLine: 224.5,
});
assert.deepEqual(total.books, ["circa"]);
assert.equal(total.probability, 0.5);

const fabricatedCrossBookPair = coherentNoVigReference({
  lines: [
    { market_type: "spread", sportsbook: "a", side: "home", line_value: -3.5, odds_american: -105, fetched_at: null },
    { market_type: "spread", sportsbook: "b", side: "away", line_value: 3.5, odds_american: -105, fetched_at: null },
  ],
  market: "spread",
  pickSide: "home",
  pickLine: -3.5,
});
assert.equal(fabricatedCrossBookPair.probability, null);
assert.deepEqual(fabricatedCrossBookPair.books, []);

const atlSpreadOffers: NbaLineRow[] = [
  { market_type: "spread", sportsbook: "circa", side: "home", line_value: 0, odds_american: -110, fetched_at: "2026-10-29T11:00:00Z" },
  { market_type: "spread", sportsbook: "circa", side: "away", line_value: 0, odds_american: -110, fetched_at: "2026-10-29T11:00:00Z" },
  { market_type: "spread", sportsbook: "pinnacle", side: "home", line_value: -1, odds_american: -106, fetched_at: "2026-10-29T11:00:00Z" },
  { market_type: "spread", sportsbook: "pinnacle", side: "away", line_value: 1, odds_american: -106, fetched_at: "2026-10-29T11:00:00Z" },
];
const bestSpreadOffer = selectBestNbaExecutableOffer({
  lines: atlSpreadOffers,
  market: "spread",
  pickSide: "home",
  acceptedBooks: ["circa", "pinnacle"],
  consensusPickLine: 0,
  modelProbabilityAtPickLine: (line) => line === 0 ? 0.676 : line === -1 ? 0.65 : null,
});
assert.equal(bestSpreadOffer?.pick.sportsbook, "circa");
assert.equal(bestSpreadOffer?.pick.line_value, 0);
assert.equal(formatNbaSpreadSelection("ATL", 0), "ATL PK");
assert.equal(formatNbaSpreadSelection("ATL", -1), "ATL -1");

const atlTotalOffers: NbaLineRow[] = [
  { market_type: "total", sportsbook: "circa", side: "over", line_value: 238, odds_american: -110, fetched_at: "2026-10-29T11:00:00Z" },
  { market_type: "total", sportsbook: "circa", side: "under", line_value: 238, odds_american: -110, fetched_at: "2026-10-29T11:00:00Z" },
  { market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 238.5, odds_american: -104, fetched_at: "2026-10-29T11:00:00Z" },
  { market_type: "total", sportsbook: "pinnacle", side: "under", line_value: 238.5, odds_american: -110, fetched_at: "2026-10-29T11:00:00Z" },
];
const bestTotalOffer = selectBestNbaExecutableOffer({
  lines: atlTotalOffers,
  market: "total",
  pickSide: "over",
  acceptedBooks: ["circa", "pinnacle"],
  consensusPickLine: 238,
  modelProbabilityAtPickLine: (line) => line === 238 ? 0.5895 : line === 238.5 ? 0.58 : null,
});
assert.equal(bestTotalOffer?.pick.sportsbook, "pinnacle");
assert.equal(bestTotalOffer?.pick.line_value, 238.5);

console.log("NBA coherent price-reference tests passed");
