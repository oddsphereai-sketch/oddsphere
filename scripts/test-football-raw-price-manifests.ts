import assert from "node:assert/strict";

// This provider-boundary test is already mandatory in verify:model-change;
// keep the canonical/configuration isolation contracts on the same gate.
import "./test-market-brain-canonical";
import "./test-nfl-market-brain-capture-config";

import { buildBalldontlieRawPriceManifest } from "../lib/services/football/balldontlieNflPreviewSlate";
import { buildSharpRawPriceManifest } from "../lib/services/football/sharpApiFootballSharpOdds";
import {
  FOOTBALL_RAW_PRICE_PARSER_INPUT_SCHEMA_RELEASE,
  footballRawPriceParserInput,
} from "../lib/services/football/footballRawPriceManifest";

const fetchedAt = "2026-10-26T20:00:00.000Z";
const startsAt = "2026-10-26T21:00:00.000Z";
const game = {
  providerGameId: "101",
  scheduledStart: startsAt,
  away: { id: 1, abbreviation: "NE", name: "New England Patriots" },
  home: { id: 2, abbreviation: "SEA", name: "Seattle Seahawks" },
};

const bdlRow = {
  game_id: 101,
  vendor: "DraftKings",
  updated_at: "2026-10-26T19:59:00.000Z",
  moneyline_away_odds: -105,
  moneyline_home_odds: null,
  spread_away_value: 3.5,
  spread_away_odds: -109,
  spread_home_value: -3.5,
  spread_home_odds: -111,
  total_value: 45.5,
  total_over_odds: -108,
  total_under_odds: -112,
};
const bdl = buildBalldontlieRawPriceManifest({
  values: [bdlRow, { ...bdlRow }, { game_id: 999, vendor: "FanDuel" }],
  requestedGameIds: new Set([game.providerGameId]),
  phase: "current",
  providerFetchedAt: fetchedAt,
});
assert.deepEqual(
  { returned: bdl.returnedRows, matched: bdl.matchedRows, unmatched: bdl.unmatchedRows, ambiguous: bdl.ambiguousRows },
  { returned: 3, matched: 2, unmatched: 1, ambiguous: 0 },
);
assert.equal(bdl.observationsByGame[game.providerGameId]?.length, 12,
  "all six sides from both duplicate provider rows must survive");
assert.equal(bdl.observationsByGame[game.providerGameId]?.filter((row) => row.status === "duplicate").length, 12,
  "duplicates must be labeled rather than collapsed");
const missingHome = bdl.observationsByGame[game.providerGameId]?.find((row) =>
  row.market === "moneyline" && row.selection === "home");
assert.equal(missingHome?.price, null);
assert.ok(missingHome?.notes.includes("price_unavailable"), "an incomplete individual side must remain explicit");
assert.equal(bdl.rawResponseSha256?.length, 64);
assert.equal(bdl.rows.length, bdl.returnedRows);
assert.equal(bdl.rawParserInput, null,
  "raw parser archival must be opt-in and absent from the shared parser path");
assert.equal(bdl.rows.find((row) => row.disposition === "unmatched")?.rawRowSha256.length, 64,
  "even an unmatched raw row must remain individually auditable");
const opening = buildBalldontlieRawPriceManifest({
  values: [{ ...bdlRow, opened_at: "2026-10-25T14:00:00.000Z" }],
  requestedGameIds: new Set([game.providerGameId]),
  phase: "provider_opening",
  providerFetchedAt: fetchedAt,
});
assert.equal(opening.observationsByGame[game.providerGameId]?.[0]?.providerObservedAt, "2026-10-25T14:00:00.000Z",
  "opening chronology must prefer the provider opening timestamp over a later row update time");

const sharpBase = {
  event_id: "sharp-101",
  sportsbook: "circa",
  event_start_time: startsAt,
  home_team: "Seattle Seahawks",
  away_team: "New England Patriots",
  timestamp: "2026-10-26T19:58:00.000Z",
  is_live: false,
  is_active: true,
  is_stale_pregame_price: false,
  is_player_prop: false,
  is_main_line: true,
  is_alternate_line: false,
};
const sharp = buildSharpRawPriceManifest({
  rows: [
    { ...sharpBase, market_type: "point_spread", selection_type: "away", line: 3.5, odds_american: -109 },
    { ...sharpBase, market_type: "point_spread", selection_type: "home", line: -3.5, odds_american: null },
    { ...sharpBase, market_type: "total_points", selection_type: "over", line: 44.5, odds_american: -105, is_alternate_line: true },
    { ...sharpBase, event_id: "wrong", home_team: "Dallas Cowboys", market_type: "moneyline", selection_type: "home", odds_american: -110 },
  ],
  games: [game],
  league: "nfl",
  sportsbook: "circa",
  providerFetchedAt: fetchedAt,
});
assert.deepEqual(
  { returned: sharp.returnedRows, matched: sharp.matchedRows, unmatched: sharp.unmatchedRows, ambiguous: sharp.ambiguousRows },
  { returned: 4, matched: 3, unmatched: 1, ambiguous: 0 },
);
assert.equal(sharp.observationsByGame[game.providerGameId]?.length, 3,
  "every recognized matched SharpAPI row must survive without complete-pair filtering");
assert.equal(sharp.observationsByGame[game.providerGameId]?.find((row) => row.selection === "home")?.status, "incomplete");
assert.equal(sharp.observationsByGame[game.providerGameId]?.find((row) => row.selection === "over")?.status, "unsupported");
assert.ok(sharp.observationsByGame[game.providerGameId]?.find((row) => row.selection === "over")?.notes.includes("alternate_line"));
assert.equal(sharp.rows.length, sharp.returnedRows);
assert.equal(sharp.rawParserInput, null,
  "SharpAPI parser archival must also be opt-in");

const archived = buildBalldontlieRawPriceManifest({
  values: [bdlRow],
  requestedGameIds: new Set([game.providerGameId]),
  phase: "current",
  providerFetchedAt: fetchedAt,
  includeRawParserInput: true,
});
assert.equal(archived.rawParserInput?.payload.length, 1);
assert.equal(archived.rawParserInput?.schema, FOOTBALL_RAW_PRICE_PARSER_INPUT_SCHEMA_RELEASE);
assert.equal(archived.rawParserInputFailureReason, null);

const oversized = footballRawPriceParserInput([{ padding: "x".repeat(2 * 1024 * 1024) }]);
assert.equal(oversized.input, null);
assert.equal(oversized.failureReason,
  "football_raw_price_parser_input_exceeds_2_mib_research_archive_limit");

const escapedOversized = footballRawPriceParserInput([{ padding: "\\".repeat(1024 * 1024 + 1) }]);
assert.equal(escapedOversized.input, null,
  "escaped strings must be rejected by serialized byte size without first allocating their JSON copy");
assert.equal(escapedOversized.failureReason,
  "football_raw_price_parser_input_exceeds_2_mib_research_archive_limit");

let accessorCalled = false;
const accessorRow = Object.defineProperty({}, "payload", {
  enumerable: true,
  get() { accessorCalled = true; return "must-not-run"; },
});
const accessor = footballRawPriceParserInput([accessorRow]);
assert.equal(accessor.input, null);
assert.equal(accessor.failureReason, "football_raw_price_parser_input_contains_accessor");
assert.equal(accessorCalled, false, "research archival preflight must never invoke caller accessors");

console.log("Football raw price manifests: response hashes, row accounting, duplicates, partial sides, and unsupported rows passed");
