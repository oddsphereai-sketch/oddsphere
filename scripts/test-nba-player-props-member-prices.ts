import assert from "node:assert/strict";
import { buildNbaPlayerPropsMemberPrices } from "../lib/services/nba/nbaPlayerPropsMemberPrices";
import type { NbaPlayerPropPriceObservation } from "../lib/services/nba/nbaPlayerPropsContract";

const target = { provider: "balldontlie", canonicalGameId: "game:1", canonicalPlayerId: "player:1",
  sportsbook: "betmgm", market: "assists", side: "under", line: 2.5, americanPrice: -165,
  observedAt: "2026-11-04T12:12:14Z", isOpening: false, isLive: false } as NbaPlayerPropPriceObservation;
const secondary = { ...target, provider: "owls", americanPrice: -190, observedAt: "2026-11-04T12:12:45Z" } as NbaPlayerPropPriceObservation;
const rows = [target, secondary, { ...target, sportsbook: "pinnacle", provider: "owls", americanPrice: -180 },
  { ...target, sportsbook: "opening-only", isOpening: true },
  { ...target, sportsbook: "live-only", isLive: true },
  { ...target, sportsbook: "wrong-line", line: 3.5 },
  { ...target, sportsbook: "other-player", canonicalPlayerId: "player:2" },
  { ...target, sportsbook: "one-way", side: "yes" },
] as NbaPlayerPropPriceObservation[];
const before = JSON.stringify(rows);
const prices = buildNbaPlayerPropsMemberPrices({ current: rows, target });
assert.deepEqual(prices.map(row => [row.sportsbook, row.americanPrice]), [["betmgm", -165], ["pinnacle", -180]]);
assert.equal(JSON.stringify(rows), before, "display selection cannot change source observations");
assert.equal(buildNbaPlayerPropsMemberPrices({ current: [secondary], target: secondary })[0]?.americanPrice, -190,
  "a genuinely Owls-only quote remains visible");
assert.equal(buildNbaPlayerPropsMemberPrices({ current: [], target }).length, 0,
  "historical target data cannot create a current offer when that provider returned no quote");
const secondaryFirst = buildNbaPlayerPropsMemberPrices({ current: [secondary, target], target });
assert.equal(secondaryFirst[0]?.americanPrice, -165, "source authority must not depend on arrival order");
assert.deepEqual(buildNbaPlayerPropsMemberPrices({ current: rows, target: { ...target, canonicalPlayerId: null } }), [],
  "unresolved player identity cannot match other unresolved observations");
console.log("NBA props member-price provenance tests passed.");
