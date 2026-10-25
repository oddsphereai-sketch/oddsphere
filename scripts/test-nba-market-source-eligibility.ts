import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isNbaAuthoritativeSportsbook,
} from "../lib/services/nba/nbaMarketSourceEligibility";
import { selectNbaCurrentLineBoard } from "../lib/services/nba/nbaCurrentLineBoard";

for (const source of ["kalshi", "Polymarket", "ROBINHOOD", "fliff"]) {
  assert.equal(isNbaAuthoritativeSportsbook(source), false, `${source} must not author an NBA market`);
}
for (const book of ["circa", "pinnacle", "fanduel", "novig"]) {
  assert.equal(isNbaAuthoritativeSportsbook(book), true, `${book} must remain eligible`);
}

const current = selectNbaCurrentLineBoard([
  { market_type: "spread", sportsbook: "polymarket", side: "home", fetched_at: "2026-10-25T12:00:00Z", odds: -1649 },
  { market_type: "spread", sportsbook: "polymarket", side: "away", fetched_at: "2026-10-25T12:00:00Z", odds: 464 },
  { market_type: "spread", sportsbook: "circa", side: "home", fetched_at: "2026-10-25T11:59:00Z", odds: -110 },
  { market_type: "spread", sportsbook: "circa", side: "away", fetched_at: "2026-10-25T11:59:00Z", odds: -110 },
]);
assert.deepEqual(current.map((row) => row.sportsbook), ["circa", "circa"]);

const pipelineSource = readFileSync(
  new URL("../lib/services/nba/buildNbaDailyEdgeAdapted.ts", import.meta.url),
  "utf8",
);
assert.match(pipelineSource, /!isNbaAuthoritativeSportsbook\(row\.sportsbook\)/);
assert.match(pipelineSource, /!isNbaAuthoritativeSportsbook\(l\.sportsbook\)/);

console.log("NBA market-source eligibility tests passed");
