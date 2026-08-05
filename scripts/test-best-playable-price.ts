import assert from "node:assert/strict";
import { selectBestCoherentPlayablePrice } from "../lib/services/dailyEdge/bestPlayablePrice";

const now = Date.parse("2026-08-05T18:15:00.000Z");
const fresh = "2026-08-05T18:10:00.000Z";

const tbMoneyline = [
  { sportsbook: "ballybet", side: "away", line_value: null, odds_american: -182, fetched_at: fresh },
  { sportsbook: "ballybet", side: "home", line_value: null, odds_american: 148, fetched_at: fresh },
  { sportsbook: "saba", side: "away", line_value: null, odds_american: -164, fetched_at: fresh },
  { sportsbook: "saba", side: "home", line_value: null, odds_american: 132, fetched_at: fresh },
];

assert.equal(
  selectBestCoherentPlayablePrice({ rows: tbMoneyline, preferredSide: "away", expectedLine: null, nowMs: now })?.odds_american,
  -164,
  "selects the better coherent TB moneyline price",
);

const flippedOutlier = [
  ...tbMoneyline,
  { sportsbook: "circa", side: "away", line_value: null, odds_american: 545, fetched_at: fresh },
  { sportsbook: "circa", side: "home", line_value: null, odds_american: -800, fetched_at: fresh },
];
assert.equal(
  selectBestCoherentPlayablePrice({ rows: flippedOutlier, preferredSide: "away", expectedLine: null, nowMs: now })?.odds_american,
  -164,
  "rejects a side-flipped outlier even when its raw price is numerically largest",
);

const staleBest = [
  ...tbMoneyline,
  { sportsbook: "betmgm", side: "away", line_value: null, odds_american: -150, fetched_at: "2026-08-05T16:00:00.000Z" },
  { sportsbook: "betmgm", side: "home", line_value: null, odds_american: 125, fetched_at: "2026-08-05T16:00:00.000Z" },
];
assert.equal(
  selectBestCoherentPlayablePrice({ rows: staleBest, preferredSide: "away", expectedLine: null, nowMs: now })?.odds_american,
  -164,
  "rejects a stale better price",
);

assert.equal(
  selectBestCoherentPlayablePrice({ rows: tbMoneyline.slice(0, 2), preferredSide: "away", expectedLine: null, nowMs: now }),
  null,
  "one book cannot establish its own outlier-resistant market center",
);

assert.equal(
  selectBestCoherentPlayablePrice({
    rows: [...tbMoneyline.slice(0, 2), ...tbMoneyline.slice(0, 2)],
    preferredSide: "away",
    expectedLine: null,
    nowMs: now,
  }),
  null,
  "duplicate rows from one book do not satisfy the two-book requirement",
);

const missingTimestamp = tbMoneyline.map(({ fetched_at: _fetchedAt, ...row }) => row);
assert.equal(
  selectBestCoherentPlayablePrice({ rows: missingTimestamp, preferredSide: "away", expectedLine: null, nowMs: now }),
  null,
  "a quote without an observation timestamp cannot be called fresh",
);

const totals = [
  { sportsbook: "fanduel", side: "over", line_value: 8.5, odds_american: -110, fetched_at: fresh },
  { sportsbook: "fanduel", side: "under", line_value: 8.5, odds_american: -110, fetched_at: fresh },
  { sportsbook: "hardrock", side: "over", line_value: 8.5, odds_american: 100, fetched_at: fresh },
  { sportsbook: "hardrock", side: "under", line_value: 8.5, odds_american: -120, fetched_at: fresh },
  { sportsbook: "circa", side: "over", line_value: 9.5, odds_american: 130, fetched_at: fresh },
  { sportsbook: "circa", side: "under", line_value: 9.5, odds_american: -150, fetched_at: fresh },
];
assert.equal(
  selectBestCoherentPlayablePrice({ rows: totals, preferredSide: "over", expectedLine: 8.5, nowMs: now })?.odds_american,
  100,
  "price shopping never crosses to a different total line",
);

console.log("PASS coherent best-playable price selection");
