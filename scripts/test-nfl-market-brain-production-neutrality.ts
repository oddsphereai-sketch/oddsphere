import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BALLDONTLIE_NFL_REGULAR_SLATE_RELEASE,
  fetchBalldontlieNflRegularSlate,
} from "../lib/services/football/balldontlieNflPreviewSlate";
import {
  fetchSharpApiNflSharpOdds,
  FOOTBALL_SHARP_PRICE_CAPTURE_RELEASE,
} from "../lib/services/football/sharpApiFootballSharpOdds";
import {
  fetchSharpApiNflSplits,
  NFL_SHARP_API_SPLITS_RELEASE,
  type SharpApiNflSplitRow,
} from "../lib/services/football/sharpApiNflSplits";

const capturedAt = "2026-09-01T12:00:00.000Z";
const startsAt = "2026-09-10T00:20:00.000Z";
const hugePadding = "x".repeat(2 * 1024 * 1024);
const scheduleRow = {
  id: 1001, season: 2026, week: 1, date: startsAt, status_state: "scheduled",
  visitor_team: { id: 1, abbreviation: "NE", full_name: "New England Patriots" },
  home_team: { id: 2, abbreviation: "SEA", full_name: "Seattle Seahawks" },
};
const oddsRow = {
  game_id: 1001, vendor: "DraftKings", updated_at: capturedAt, opened_at: "2026-08-31T12:00:00.000Z",
  moneyline_away_odds: 120, moneyline_home_odds: -140,
  spread_away_value: 2.5, spread_away_odds: -110, spread_home_value: -2.5, spread_home_odds: -110,
  total_value: 44.5, total_over_odds: -110, total_under_odds: -110,
};

function withoutRawManifests<T extends { rawPriceResponseManifests?: unknown }>(value: T) {
  const { rawPriceResponseManifests: _rawPriceResponseManifests, ...production } = value;
  return production;
}

function balldontlieFetch(counter: { calls: number }): typeof fetch {
  return (async (input: string | URL | Request) => {
    counter.calls += 1;
    const pathname = new URL(typeof input === "string" || input instanceof URL ? input : input.url).pathname;
    const data = pathname.endsWith("/games") ? [scheduleRow]
      : pathname.endsWith("/odds/opening") ? [oddsRow]
      : [{ ...oddsRow, padding: hugePadding }];
    return new Response(JSON.stringify({ data, meta: { next_cursor: null } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const sharpBase = {
  event_id: "sharp-1001", event_start_time: startsAt,
  home_team: "Seattle Seahawks", away_team: "New England Patriots", timestamp: capturedAt,
  is_live: false, is_active: true, is_stale_pregame_price: false,
  is_player_prop: false, is_main_line: true, is_alternate_line: false,
};
function sharpRows(sportsbook: string) {
  return [
    { ...sharpBase, sportsbook, market_type: "moneyline", selection_type: "away", odds_american: 120,
      padding: sportsbook === "circa" ? hugePadding : undefined },
    { ...sharpBase, sportsbook, market_type: "moneyline", selection_type: "home", odds_american: -140 },
    { ...sharpBase, sportsbook, market_type: "point_spread", selection_type: "away", line: 2.5, odds_american: -110 },
    { ...sharpBase, sportsbook, market_type: "point_spread", selection_type: "home", line: -2.5, odds_american: -110 },
    { ...sharpBase, sportsbook, market_type: "total_points", selection_type: "over", line: 44.5, odds_american: -110 },
    { ...sharpBase, sportsbook, market_type: "total_points", selection_type: "under", line: 44.5, odds_american: -110 },
  ];
}

function sharpClient(counter: { calls: number }) {
  return {
    async fetch<T>(request: { query?: Record<string, unknown> }) {
      counter.calls += 1;
      return {
        data: sharpRows(String(request.query?.sportsbook)) as T,
        pagination: { has_more: false, offset: 0, count: 6, total: 6 },
      };
    },
  };
}

async function main(): Promise<void> {
  assert.equal(BALLDONTLIE_NFL_REGULAR_SLATE_RELEASE,
    "balldontlie_nfl_regular_slate_2026_09_28_r4_opening_timestamp_capture");
  assert.equal(FOOTBALL_SHARP_PRICE_CAPTURE_RELEASE,
    "football_sharp_price_capture_2026_10_12_r2_cfb_central_team_identity");
  assert.equal(NFL_SHARP_API_SPLITS_RELEASE,
    "nfl_sharpapi_splits_2026_10_09_r2_provider_team_prefix_identity");

  const bdlOffCalls = { calls: 0 };
  const bdlOff = await fetchBalldontlieNflRegularSlate({
    season: 2026, week: 1, apiKey: "test", fetchImpl: balldontlieFetch(bdlOffCalls), clock: () => capturedAt,
  });
  const bdlOnCalls = { calls: 0 };
  const bdlOn = await fetchBalldontlieNflRegularSlate({
    season: 2026, week: 1, apiKey: "test", fetchImpl: balldontlieFetch(bdlOnCalls),
    clock: () => capturedAt, captureRawPriceManifest: true,
  });
  assert.equal("rawPriceResponseManifests" in bdlOff, false);
  assert.deepEqual(withoutRawManifests(bdlOn), bdlOff);
  assert.equal(bdlOffCalls.calls, 3);
  assert.equal(bdlOnCalls.calls, 3, "research capture must not add provider requests");
  assert.equal(bdlOn.rawPriceResponseManifests?.current.rawParserInput, null);
  assert.equal(bdlOn.rawPriceResponseManifests?.current.rawParserInputFailureReason,
    "football_raw_price_parser_input_exceeds_2_mib_research_archive_limit");

  const game = bdlOff.games[0]!;
  const sharpOffCalls = { calls: 0 };
  const sharpOff = await fetchSharpApiNflSharpOdds({ games: [game], client: sharpClient(sharpOffCalls) as never });
  const sharpOnCalls = { calls: 0 };
  const sharpOn = await fetchSharpApiNflSharpOdds({
    games: [game], client: sharpClient(sharpOnCalls) as never,
    capturedAt, captureRawPriceManifest: true,
  });
  assert.equal("rawPriceResponseManifests" in sharpOff, false);
  assert.deepEqual(withoutRawManifests(sharpOn), sharpOff);
  assert.equal(sharpOffCalls.calls, 2);
  assert.equal(sharpOnCalls.calls, 2, "research archival must reuse the same SharpAPI responses");
  assert.equal(sharpOn.rawPriceResponseManifests?.find((row) => row.participant === "circa")?.rawParserInput, null);

  const splitRow: SharpApiNflSplitRow = {
    event_id: "nfl_patriots_seahawks", event_start_time: null, league: "nfl",
    away_team: "New England Patriots", home_team: "Seattle Seahawks", sportsbook: "circa", fetched_at: capturedAt,
    moneyline: { bets_pct: { home: 40, away: 60 }, handle_pct: { home: 55, away: 45 } },
    spread: { bets_pct: { home: 45, away: 55 }, handle_pct: { home: 52, away: 48 } },
    total: { bets_pct: { over: 49, under: 51 }, handle_pct: { over: 47, under: 53 } },
  };
  const splitCalls = { fetchAll: 0, fetch: 0 };
  const splitClient = {
    async fetchAll<T>() { splitCalls.fetchAll += 1; return [splitRow] as T[]; },
    async fetch<T>() {
      splitCalls.fetch += 1;
      return { data: [splitRow] as T, pagination: { total: 1, count: 1, offset: 0, has_more: false } };
    },
  };
  const splitsOff = await fetchSharpApiNflSplits({ apiKey: "test", games: [game], capturedAt, client: splitClient });
  const splitsOn = await fetchSharpApiNflSplits({
    apiKey: "test", games: [game], capturedAt, client: splitClient,
    clock: () => capturedAt, captureResearchManifest: true,
  });
  assert.deepEqual(splitsOn.splitsByGame, splitsOff.splitsByGame,
    "research strictness must not alter incumbent split semantics");
  assert.equal(splitsOff.sourcesByGame, undefined);
  assert.equal(splitsOn.sourcesByGame?.[game.providerGameId]?.every((row) => row.status === "unavailable"), true);
  assert.deepEqual(splitCalls, { fetchAll: 1, fetch: 1 });

  const route = readFileSync("app/api/cron/nfl-forward-evidence/route.ts", "utf8");
  assert.ok(route.indexOf("writeNflPlayerPropsCurrentSeasonState") <
    route.indexOf("resolveNflMarketBrainCaptureConfiguration(process.env)"),
  "research configuration is resolved only after the authoritative state-refresh boundary");
  assert.match(route, /const marketBrainDetails = marketBrainCaptureRequested[\s\S]*?: \{\};/,
    "feature-off route responses must omit research-only detail fields");

  console.log("NFL Market Brain feature-off provider, split, request-count, oversized-payload, and route isolation passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
