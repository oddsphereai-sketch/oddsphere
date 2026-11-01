import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { RawOwlsSplitsResponse } from "../lib/providers/owls/owlsSharpBookSplits";
import type { NflPreviewGame } from "../lib/services/football/balldontlieNflPreviewSlate";
import { mapNflOwlsSplits, NFL_OWLS_SPLITS_RELEASE, qualifyNflOwlsSplitsForModel } from "../lib/services/football/nflOwlsSplits";
import { nflModelSharpSplits } from "../lib/services/football/sharpApiNflSplits";

const game: NflPreviewGame = {
  providerGameId: "424242",
  providerWeek: 8,
  season: 2026,
  scheduledStart: "2026-11-01T18:00:00.000Z",
  status: "Scheduled",
  away: { id: 1, abbreviation: "CAR", name: "Carolina Panthers" },
  home: { id: 2, abbreviation: "GB", name: "Green Bay Packers" },
};

function markets(handle = 62, bets = 43) {
  return {
    moneyline: {
      away_handle_pct: handle, home_handle_pct: 100 - handle,
      away_bets_pct: bets, home_bets_pct: 100 - bets,
      away_price: 130, home_price: -150,
    },
    spread: {
      away_handle_pct: 55, home_handle_pct: 45,
      away_bets_pct: 48, home_bets_pct: 52,
      away_line: 3.5, home_line: -3.5,
    },
    total: {
      over_handle_pct: 58, under_handle_pct: 42,
      over_bets_pct: 51, under_bets_pct: 49,
      line: 46.5,
    },
  };
}

const response: RawOwlsSplitsResponse = {
  sport: "nfl",
  data: [{
    event_id: "nfl:Carolina-Panthers@Green-Bay-Packers-20261101",
    away_team: "Carolina Panthers",
    home_team: "Green Bay Packers",
    splits: [
      { book: "circa", title: "Circa", as_of: "2026-10-27T23:45:00.000Z", ...markets() },
      { book: "betmgm", title: "BetMGM", as_of: "2026-10-27T23:46:00.000Z", ...markets(51, 50) },
    ],
  }],
  meta: { status: "partial", partial_reason: "book_unavailable", total_games: 1, books: ["circa", "betmgm"] },
};

const result = mapNflOwlsSplits({ games: [game], capturedAt: "2026-10-27T23:47:00.000Z", response });
assert.equal(result.release, NFL_OWLS_SPLITS_RELEASE);
assert.equal(result.matchedGames, 1);
assert.equal(result.feedStatus, "partial");
assert.equal(result.partialReason, "book_unavailable");
const split = result.splitsByGame[game.providerGameId]!;
assert.equal(split.moneyline.provider, "owls");
assert.equal(split.moneyline.sourceSportsbook, "circa", "Circa is the display-priority complete book");
assert.equal(split.moneyline.awayMoneyPct, 62);
assert.equal(split.moneyline.homeBetsPct, 57);
assert.equal(split.total.overMoneyPct, 58);
assert.equal(split.total.underBetsPct, 49);
assert.equal(split.moneyline.providerFetchedAt, "2026-10-27T23:45:00.000Z");
assert.equal(nflModelSharpSplits(split), null, "Owls capture cannot enter the separate predictive market reader");
assert.equal(split.spread.sourceLine, -3.5);
assert.equal(split.total.sourceLine, 46.5);
const qualified = qualifyNflOwlsSplitsForModel({
  splits: split, providerGameId: game.providerGameId,
  evaluatedAt: "2026-10-27T23:47:00.000Z", currentHomeSpread: -3.5, currentTotal: 46.5,
});
assert.deepEqual(qualified.qualifiedMarkets, ["moneyline", "spread", "total"]);
assert.equal(qualified.splits?.moneyline.provider, "owls");
const wrongLine = qualifyNflOwlsSplitsForModel({
  splits: split, providerGameId: game.providerGameId,
  evaluatedAt: "2026-10-27T23:47:00.000Z", currentHomeSpread: -4, currentTotal: 47,
});
assert.deepEqual(wrongLine.qualifiedMarkets, ["moneyline"]);
assert.equal(wrongLine.splits?.spread.homeMoneyPct, null);
assert.equal(wrongLine.splits?.total.overMoneyPct, null);
assert.equal(wrongLine.reasons.spread, "different_line");
assert.equal(wrongLine.reasons.total, "different_line");
assert.equal(qualifyNflOwlsSplitsForModel({
  splits: split, providerGameId: game.providerGameId,
  evaluatedAt: "2026-10-28T02:47:00.000Z", currentHomeSpread: -3.5, currentTotal: 46.5,
}).splits, null, "an old source timestamp cannot be refreshed by recapture");
assert.equal(qualifyNflOwlsSplitsForModel({
  splits: split, providerGameId: "different-game",
  evaluatedAt: "2026-10-27T23:47:00.000Z", currentHomeSpread: -3.5, currentTotal: 46.5,
}).splits, null, "Owls evidence cannot cross exact game IDs");

const wrongDate = structuredClone(response);
wrongDate.data![0]!.event_id = "nfl:Carolina-Panthers@Green-Bay-Packers-20261108";
const rejected = mapNflOwlsSplits({ games: [game], capturedAt: "2026-10-27T23:47:00.000Z", response: wrongDate });
assert.equal(rejected.matchedGames, 0, "the same teams on another NFL week must fail closed");

const routeSource = readFileSync("app/api/cron/nfl-forward-evidence/route.ts", "utf8");
const writerSource = readFileSync("lib/services/football/nflForwardEvidenceWriter.ts", "utf8");
assert.match(routeSource, /requiredEnv\("OWLS_INSIGHT_API_KEY"\)/);
assert.doesNotMatch(routeSource, /requiredEnv\("SHARPAPI_KEY"\)/,
  "the live NFL route must not require the cancelled SharpAPI subscription");
assert.doesNotMatch(routeSource, /sharpApiKey,/, "the live route must not pass SharpAPI to either NFL writer");
assert.doesNotMatch(writerSource, /fetchSharpApiNflSharpOdds\(/,
  "the sole full-game writer must use the shared Owls price-history lane instead of SharpAPI odds");

console.log("NFL Owls capture-only split adapter tests passed.");
