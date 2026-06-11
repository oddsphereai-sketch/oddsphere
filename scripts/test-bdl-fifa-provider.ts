/**
 * Tests for BdlFifaClient + BallDontLieFifaProvider (WC-2).
 *
 * Uses a stub fetch impl so the tests are deterministic and offline.
 * Fixtures mirror the live BDL response shapes observed during the
 * 2026-06-10 inventory probe.
 */

import {
  BdlFifaClient,
  type FetchLike,
  BDL_FIFA_PATHS,
} from "../lib/providers/real_api/_bdlFifaClient";
import {
  BallDontLieFifaProvider,
  type BdlFifaMatch,
  type BdlFifaOddsRow,
} from "../lib/providers/real_api/BallDontLieFifaProvider";

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}
function test(name: string, fn: () => void | Promise<void>): void {
  const run = async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      pass++;
    } catch (e) {
      console.log(`  ✗ ${name}`);
      console.log(`      ${e instanceof Error ? e.message : String(e)}`);
      fail++;
    }
  };
  // Run synchronously by awaiting in the loop.
  // Tests below are mostly sync; the awaiter handles either case.
  pendingTests.push(run);
}

const pendingTests: Array<() => Promise<void>> = [];

console.log("\nscripts/test-bdl-fifa-provider.ts");
console.log("─".repeat(60));

// ─── Fixtures ─────────────────────────────────────────────────────────

const mexicoVsSouthAfrica: BdlFifaMatch = {
  id: 1,
  match_number: 1,
  datetime: "2026-06-11T19:00:00.000Z",
  status: "scheduled",
  season: { id: 1, year: 2026 },
  stage: { id: 1, name: "Group Stage", order: 1 },
  group: { id: 1, name: "Group A" },
  stadium: { id: 15, name: "Estadio Azteca", city: "Mexico City", country: "MEX", capacity: 87523 },
  home_team: { id: 1, name: "Mexico", abbreviation: "MEX", country_code: "MEX", confederation: "CONCACAF" },
  away_team: { id: 2, name: "South Africa", abbreviation: "RSA", country_code: "RSA", confederation: "CAF" },
  home_score: null,
  away_score: null,
  home_score_penalties: null,
  away_score_penalties: null,
  first_half_home_score: null,
  first_half_away_score: null,
  second_half_home_score: null,
  second_half_away_score: null,
  extra_time_home_score: null,
  extra_time_away_score: null,
  has_extra_time: false,
  has_penalty_shootout: false,
};

const fanduelOddsForMexicoVsSouthAfrica: BdlFifaOddsRow = {
  id: 236503329,
  match_id: 1,
  vendor: "fanduel",
  moneyline_home_odds: 250,
  moneyline_away_odds: 145,
  moneyline_draw_odds: 180,
  total_value: 2.5,
  total_over_odds: -110,
  total_under_odds: -110,
  updated_at: "2026-06-11T01:01:03.633Z",
  markets: [
    {
      id: 1,
      key: "btts_match_match_yes_no",
      name: "Both Teams To Score",
      type: "both_teams_to_score",
      period: "match",
      scope: "match",
      team_side: null,
      line_value: null,
      updated_at: "2026-06-10T16:00:49.731Z",
      outcomes: [
        { id: 1, key: "yes", name: "Yes", type: "yes", side: null, line_value: null, handicap: null, american_odds: 110, decimal_odds: 2.1 },
        { id: 2, key: "no", name: "No", type: "no", side: null, line_value: null, handicap: null, american_odds: -130, decimal_odds: 1.769 },
      ],
    },
    {
      // 2026-06-11 — live BDL DC shape captured via /fifa/worldcup/v1/odds
      // probe. BDL labels the market `Double Chance` and emits outcomes
      // whose `name` uses the " And " separator (NOT "/") like
      // "Mexico And Draw", "South Africa And Draw", "Mexico And South Africa".
      // Outcome.type for all three is "other". side/line_value/handicap are
      // all null. The market key is `double_chance_match_match_double_chance`.
      id: 2,
      key: "double_chance_match_match_double_chance",
      name: "Double Chance",
      type: "double_chance",
      period: "match",
      scope: "match",
      team_side: null,
      line_value: null,
      updated_at: "2026-06-10T16:00:49.731Z",
      outcomes: [
        { id: 3, key: "other_mexico_and_draw",         name: "Mexico And Draw",          type: "other", side: null, line_value: null, handicap: null, american_odds:  100, decimal_odds: 2.0,  updated_at: "2026-06-10T16:00:49.731Z" },
        { id: 4, key: "other_south_africa_and_draw",   name: "South Africa And Draw",    type: "other", side: null, line_value: null, handicap: null, american_odds: -250, decimal_odds: 1.4,  updated_at: "2026-06-10T16:00:49.731Z" },
        { id: 5, key: "other_mexico_and_south_africa", name: "Mexico And South Africa",  type: "other", side: null, line_value: null, handicap: null, american_odds: -400, decimal_odds: 1.25, updated_at: "2026-06-10T16:00:49.731Z" },
      ],
    },
    // Alternate total line — should produce a normalized row (different line value).
    {
      id: 3,
      key: "total_match_match_over_under_1.5_goals_1.5",
      name: "Over/Under 1.5 Goals",
      type: "total",
      period: "match",
      scope: "match",
      team_side: null,
      line_value: "1.5",
      updated_at: "2026-06-10T16:00:49.731Z",
      outcomes: [
        { id: 6, name: "Over 1.5 Goals", type: "over", side: null, line_value: "1.5", handicap: null, american_odds: -186, decimal_odds: 1.537 },
        { id: 7, name: "Under 1.5 Goals", type: "under", side: null, line_value: "1.5", handicap: null, american_odds: 144, decimal_odds: 2.44 },
      ],
    },
    // Team total — should be DROPPED.
    {
      id: 4,
      key: "team_total_mexico_goals_1.5",
      name: "Mexico: Team Total Goals 1.5",
      type: "team_total",
      period: "match",
      scope: "home_team",
      team_side: "home",
      line_value: "1.5",
      outcomes: [
        { id: 8, name: "Over 1.5", type: "over", side: null, line_value: "1.5", handicap: null, american_odds: 140, decimal_odds: 2.4 },
      ],
    },
    // 1st-half BTTS — should be DROPPED.
    {
      id: 5,
      key: "btts_1st_half",
      name: "Both Teams to Score - 1st Half",
      type: "both_teams_to_score",
      period: "1st_half",
      scope: "match",
      team_side: null,
      outcomes: [
        { id: 9, name: "Yes", type: "yes", american_odds: 575, decimal_odds: 6.75 },
        { id: 10, name: "No", type: "no", american_odds: -800, decimal_odds: 1.125 },
      ],
    },
    // Correct score — should be DROPPED.
    {
      id: 6,
      key: "correct_score_1_0",
      name: "Correct Score 1-0",
      type: "correct_score",
      period: "match",
      scope: "match",
      outcomes: [
        { id: 11, name: "Mexico 1-0", type: "other", american_odds: 600, decimal_odds: 7.0 },
      ],
    },
  ],
};

// ─── Stub fetch builder ───────────────────────────────────────────────

type StubResponse = {
  status: number;
  body: unknown;
};

function buildStubFetch(routes: Map<string, StubResponse | StubResponse[]>): FetchLike {
  const pageState = new Map<string, number>();
  return async (input) => {
    const url = String(input);
    // Match by path+query without origin.
    const urlObj = new URL(url);
    const pathKey = `${urlObj.pathname}${urlObj.search}`;
    let route = routes.get(pathKey);
    if (route === undefined) {
      // Match by pathname only (page-agnostic).
      route = routes.get(urlObj.pathname);
    }
    if (route === undefined) {
      return new Response(JSON.stringify({ error: "no_stub_route" }), { status: 404 });
    }
    let stub: StubResponse;
    if (Array.isArray(route)) {
      const idx = pageState.get(urlObj.pathname) ?? 0;
      stub = route[Math.min(idx, route.length - 1)];
      pageState.set(urlObj.pathname, idx + 1);
    } else {
      stub = route;
    }
    return new Response(JSON.stringify(stub.body), {
      status: stub.status,
      headers: { "content-type": "application/json" },
    });
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

test("BdlFifaClient.fetch returns parsed data + meta from stub", async () => {
  const stub = buildStubFetch(
    new Map([
      [BDL_FIFA_PATHS.teams, { status: 200, body: { data: [{ id: 1, name: "Mexico" }], meta: { next_cursor: null } } }],
    ]),
  );
  const client = new BdlFifaClient("test-key", { fetchImpl: stub });
  const res = await client.fetch<unknown[]>({ path: BDL_FIFA_PATHS.teams });
  assert(Array.isArray(res.data) && res.data.length === 1, "data should be the 1-row array");
  assert(res.meta?.next_cursor === null, "meta.next_cursor preserved");
});

test("BdlFifaClient.fetchAll walks cursor pages until next_cursor is null", async () => {
  const stub = buildStubFetch(
    new Map([
      [
        BDL_FIFA_PATHS.teams,
        [
          { status: 200, body: { data: [{ id: 1 }, { id: 2 }], meta: { next_cursor: 100 } } },
          { status: 200, body: { data: [{ id: 3 }, { id: 4 }], meta: { next_cursor: 200 } } },
          { status: 200, body: { data: [{ id: 5 }], meta: { next_cursor: null } } },
        ],
      ],
    ]),
  );
  const client = new BdlFifaClient("test-key", { fetchImpl: stub });
  const out = await client.fetchAll<{ id: number }>({ path: BDL_FIFA_PATHS.teams, maxPages: 10 });
  assert(out.length === 5, `expected 5 rows, got ${out.length}`);
  assert(out[0].id === 1 && out[4].id === 5, "rows aggregated in order");
});

test("BdlFifaClient.fetchAll respects maxPages cap", async () => {
  const stub = buildStubFetch(
    new Map([
      [
        BDL_FIFA_PATHS.matches,
        [
          { status: 200, body: { data: [{ id: 1 }], meta: { next_cursor: 1 } } },
          { status: 200, body: { data: [{ id: 2 }], meta: { next_cursor: 2 } } },
          { status: 200, body: { data: [{ id: 3 }], meta: { next_cursor: 3 } } },
        ],
      ],
    ]),
  );
  const client = new BdlFifaClient("test-key", { fetchImpl: stub });
  const out = await client.fetchAll<{ id: number }>({ path: BDL_FIFA_PATHS.matches, maxPages: 2 });
  assert(out.length === 2, "maxPages=2 should cap output");
});

test("BdlFifaClient: 404 throws BdlFifaNotFoundError", async () => {
  const stub = buildStubFetch(new Map([[BDL_FIFA_PATHS.teams, { status: 404, body: { error: "not found" } }]]));
  const client = new BdlFifaClient("test-key", { fetchImpl: stub });
  let threw = false;
  try {
    await client.fetch({ path: BDL_FIFA_PATHS.teams });
  } catch (e) {
    threw = true;
    assert((e as Error).name === "BdlFifaNotFoundError", "must be BdlFifaNotFoundError");
  }
  assert(threw, "404 must throw");
});

test("BallDontLieFifaProvider.normalizeMatch produces canonical match shape", () => {
  const stub = buildStubFetch(new Map());
  const provider = new BallDontLieFifaProvider(new BdlFifaClient("test-key", { fetchImpl: stub }));
  const out = provider.normalizeMatch(mexicoVsSouthAfrica);
  assert(out.provider_match_id === 1, "provider_match_id");
  assert(out.home_team_name === "Mexico", "home name");
  assert(out.away_team_name === "South Africa", "away name");
  assert(out.stage_name === "Group Stage", "stage");
  assert(out.group_name === "Group A", "group");
  assert(out.stadium_name === "Estadio Azteca", "stadium");
  assert(out.has_extra_time === false, "ET flag");
  assert(out.has_penalty_shootout === false, "pens flag");
  assert(out.raw_row.id === 1, "raw_row preserved for audit");
});

test("BallDontLieFifaProvider.normalizeOdds emits 3 match_result rows + 2 total(2.5) + 2 total(1.5) + 2 BTTS + 3 DC, drops team_total/1H/correct_score", () => {
  const stub = buildStubFetch(new Map());
  const provider = new BallDontLieFifaProvider(new BdlFifaClient("test-key", { fetchImpl: stub }));
  const rows = provider.normalizeOdds(fanduelOddsForMexicoVsSouthAfrica, {
    home_team: "Mexico",
    away_team: "South Africa",
  });
  // Top-level: 3 ML + 2 total(2.5) = 5
  // Markets[]: 2 BTTS + 3 DC + 2 total(1.5) = 7
  // Dropped: team_total (home), 1st-half BTTS, correct_score
  assert(rows.length === 12, `expected 12 normalized rows, got ${rows.length}`);
  const markets = new Set(rows.map((r) => r.market));
  assert(markets.has("match_result") && markets.has("total") && markets.has("btts") && markets.has("double_chance"),
    `expected all four markets; got ${[...markets].join(",")}`);
  for (const r of rows) {
    assert(r.provider === "bdl", "provider tag");
    assert(r.provider_endpoint === BDL_FIFA_PATHS.odds, "endpoint tag");
    assert(r.provider_event_id === "bdl_match_1", "event_id tag");
  }
});

test("BallDontLieFifaProvider.normalizeOdds: total rows carry the right line values", () => {
  const stub = buildStubFetch(new Map());
  const provider = new BallDontLieFifaProvider(new BdlFifaClient("test-key", { fetchImpl: stub }));
  const rows = provider.normalizeOdds(fanduelOddsForMexicoVsSouthAfrica, {
    home_team: "Mexico",
    away_team: "South Africa",
  });
  const totalRows = rows.filter((r) => r.market === "total");
  const lines = new Set(totalRows.map((r) => r.line));
  assert(lines.has(2.5) && lines.has(1.5), `expected lines 2.5 and 1.5, got ${[...lines].join(",")}`);
});

test("BallDontLieFifaProvider.normalizeOdds: DC selections map correctly via team names", () => {
  const stub = buildStubFetch(new Map());
  const provider = new BallDontLieFifaProvider(new BdlFifaClient("test-key", { fetchImpl: stub }));
  const rows = provider.normalizeOdds(fanduelOddsForMexicoVsSouthAfrica, {
    home_team: "Mexico",
    away_team: "South Africa",
  });
  const dcRows = rows.filter((r) => r.market === "double_chance");
  const selections = new Set(dcRows.map((r) => r.selection));
  assert(selections.has("home_or_draw") && selections.has("away_or_draw") && selections.has("home_or_away"),
    `expected all 3 DC selections; got ${[...selections].join(",")}`);
});

test("BallDontLieFifaProvider.normalizeOdds: zero non-tracked markets leak", () => {
  const stub = buildStubFetch(new Map());
  const provider = new BallDontLieFifaProvider(new BdlFifaClient("test-key", { fetchImpl: stub }));
  const rows = provider.normalizeOdds(fanduelOddsForMexicoVsSouthAfrica, {
    home_team: "Mexico",
    away_team: "South Africa",
  });
  for (const r of rows) {
    assert(
      r.market === "match_result" || r.market === "total" || r.market === "btts" || r.market === "double_chance",
      `non-tracked market leaked: ${r.market}`,
    );
  }
});

// ─── Drive the test queue ─────────────────────────────────────────────

async function main() {
  for (const t of pendingTests) await t();
  console.log("\n" + "━".repeat(60));
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log("❌ bdl-fifa-provider tests FAILED");
    process.exit(1);
  }
  console.log(`✅ All ${pass} tests passed.`);
}
main();
