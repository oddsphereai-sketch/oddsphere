import { strict as assert } from "node:assert";
import {
  coherentNoVigReference,
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

console.log("NBA coherent price-reference tests passed");
