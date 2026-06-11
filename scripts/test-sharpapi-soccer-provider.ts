/**
 * Tests for SharpApiSoccerOddsProvider (WC-2).
 *
 * Pure normalization tests + splits-status contract tests. Network is
 * stubbed via the SharpApiClient's option to inject a fetch impl.
 */

import { SharpApiClient } from "../lib/providers/real_api/_sharpApiClient";
import {
  SharpApiSoccerOddsProvider,
  type SharpApiOddsRow,
  type SharpApiOpportunityRow,
  SHARP_WC_PRIMARY_LEAGUE,
} from "../lib/providers/real_api/SharpApiSoccerOddsProvider";

let pass = 0;
let fail = 0;
const pending: Array<() => Promise<void>> = [];

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}
function test(name: string, fn: () => void | Promise<void>): void {
  pending.push(async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      pass++;
    } catch (e) {
      console.log(`  ✗ ${name}`);
      console.log(`      ${e instanceof Error ? e.message : String(e)}`);
      fail++;
    }
  });
}

console.log("\nscripts/test-sharpapi-soccer-provider.ts");
console.log("─".repeat(60));

// ─── Sample SharpAPI odds rows mirroring the live shape probed 2026-06-10.

const sharpApiMexicoVsRsaRows: SharpApiOddsRow[] = [
  // match_result: home
  {
    id: "row_ml_home",
    sportsbook: "bovada",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    sport: "soccer",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "moneyline",
    selection: "Mexico",
    odds_american: 250,
    odds_decimal: 3.5,
    timestamp: "2026-06-11T01:10:29Z",
  },
  // match_result: away
  {
    id: "row_ml_away",
    sportsbook: "bovada",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "moneyline",
    selection: "South Africa",
    odds_american: 145,
    timestamp: "2026-06-11T01:10:29Z",
  },
  // match_result: draw
  {
    id: "row_ml_draw",
    sportsbook: "bovada",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "moneyline",
    selection: "Draw",
    odds_american: 180,
    timestamp: "2026-06-11T01:10:29Z",
  },
  // total: over 2.5
  {
    id: "row_total_over",
    sportsbook: "fanduel",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "total_goals",
    selection: "Over",
    line: 2.5,
    odds_american: -110,
    timestamp: "2026-06-11T01:10:29Z",
  },
  // total: under 2.5
  {
    id: "row_total_under",
    sportsbook: "fanduel",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "total_goals",
    selection: "Under",
    line: 2.5,
    odds_american: -110,
    timestamp: "2026-06-11T01:10:29Z",
  },
  // BTTS yes
  {
    id: "row_btts_yes",
    sportsbook: "bovada",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "both_teams_to_score",
    selection: "Yes",
    odds_american: 110,
    timestamp: "2026-06-11T01:10:29Z",
  },
  // BTTS no
  {
    id: "row_btts_no",
    sportsbook: "bovada",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "both_teams_to_score",
    selection: "No",
    odds_american: -130,
    timestamp: "2026-06-11T01:10:29Z",
  },
  // double_chance Mexico/Draw
  {
    id: "row_dc_homedraw",
    sportsbook: "bovada",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "double_chance",
    selection: "Mexico / Draw",
    odds_american: -150,
    timestamp: "2026-06-11T01:10:29Z",
  },
  // NON-TRACKED markets that should be DROPPED:
  {
    id: "row_spread",
    sportsbook: "bovada",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "point_spread",
    selection: "Mexico",
    line: 0.5,
    odds_american: -110,
    timestamp: "2026-06-11T01:10:29Z",
  },
  {
    id: "row_team_total",
    sportsbook: "bovada",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "team_total_goals",
    selection: "Mexico Over",
    line: 1.5,
    odds_american: -110,
    timestamp: "2026-06-11T01:10:29Z",
  },
  {
    id: "row_dnb",
    sportsbook: "bovada",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "draw_no_bet",
    selection: "Mexico",
    odds_american: -110,
    timestamp: "2026-06-11T01:10:29Z",
  },
  {
    id: "row_1h_total",
    sportsbook: "bovada",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "1st_half_total_goals",
    selection: "Over",
    line: 1,
    odds_american: 110,
    timestamp: "2026-06-11T01:10:29Z",
  },
  {
    id: "row_card_player_prop",
    sportsbook: "bovada",
    event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3",
    league: "fifa_world_cup_matches",
    home_team: "Mexico",
    away_team: "South Africa",
    market_type: "anytime_goal_scorer",
    selection: "Edson Álvarez (MEX)",
    odds_american: 500,
    timestamp: "2026-06-11T01:10:29Z",
  },
];

const sharpApiOpportunityRows: SharpApiOpportunityRow[] = [
  {
    id: "opp_total_under",
    sportsbook: "sx_bet",
    event_id: "fifa_-_world_cup_curacao_germany_2026-06-14_b2",
    league: "fifa_-_world_cup",
    market_type: "total_goals",
    selection: "Under",
    line: 4,
    odds_american: 126,
    odds_decimal: 2.26,
    odds_probability: 0.4425,
    fair_probability: 0.4538,
    no_vig_odds: 120,
    ev_percentage: 2.57,
    kelly_percent: 2.03,
    book_count: 2,
    cross_ref_count: 1,
    is_player_prop: false,
    sharp_book: "pinnacle",
    is_main_line: false,
    is_alternate_line: false,
    warnings: ["SINGLE_SHARP_REF"],
    start_time: "2026-06-14T17:00:00Z",
    detected_at: "2026-06-11T01:00:22Z",
    home_team: "Germany",
    away_team: "Curacao",
  },
  // Player prop — must be dropped.
  {
    id: "opp_player_prop",
    sportsbook: "fanduel",
    market_type: "anytime_goal_scorer",
    selection: "Mbappe",
    is_player_prop: true,
    odds_american: 100,
    odds_decimal: 2.0,
  },
  // Non-tracked market — must be dropped.
  {
    id: "opp_spread",
    sportsbook: "bovada",
    market_type: "point_spread",
    selection: "Germany",
    line: -1.5,
    odds_american: -110,
    is_player_prop: false,
  },
];

// ─── Stub SharpApiClient (no live HTTP) ───────────────────────────────

/** Build a SharpApiClient whose internal fetch is replaced; returns a
 *  thin shim that overrides only the methods we use. */
class StubSharpApiClient {
  public lastQuery: Record<string, unknown> | null = null;
  constructor(private readonly responses: Map<string, unknown[]>) {}
  async fetchAll<T>(opts: { path: string; query?: Record<string, unknown> }): Promise<T[]> {
    this.lastQuery = opts.query ?? null;
    const rows = this.responses.get(opts.path) ?? [];
    return rows as T[];
  }
  fetch(): Promise<{ data: unknown[]; pagination?: { has_more: boolean; next_offset: number | null } | null }> {
    return Promise.resolve({ data: [], pagination: null });
  }
}

// Type-assert StubSharpApiClient to SharpApiClient for the provider. The
// provider only calls fetchAll, so the surface area is small.
function asClient(stub: StubSharpApiClient): SharpApiClient {
  return stub as unknown as SharpApiClient;
}

// ─── Tests ────────────────────────────────────────────────────────────

test("normalizeOdds: emits 8 tracked-market rows for Mexico vs RSA sample", () => {
  const provider = new SharpApiSoccerOddsProvider(asClient(new StubSharpApiClient(new Map())));
  const rows = provider.normalizeOdds(sharpApiMexicoVsRsaRows);
  assert(rows.length === 8, `expected 8 normalized rows, got ${rows.length}`);
  const markets = new Set(rows.map((r) => r.market));
  assert(markets.has("match_result"), "match_result present");
  assert(markets.has("total"), "total present");
  assert(markets.has("btts"), "btts present");
  assert(markets.has("double_chance"), "double_chance present");
});

test("normalizeOdds: every non-tracked market dropped (spread/team_total/dnb/1H/anytime_scorer)", () => {
  const provider = new SharpApiSoccerOddsProvider(asClient(new StubSharpApiClient(new Map())));
  const rows = provider.normalizeOdds(sharpApiMexicoVsRsaRows);
  const droppedMarkets = ["spread", "team_total_goals", "draw_no_bet", "1st_half_total_goals", "anytime_goal_scorer"];
  for (const r of rows) {
    for (const dropped of droppedMarkets) {
      assert(r.market !== (dropped as never), `non-tracked ${dropped} leaked: ${JSON.stringify(r)}`);
    }
  }
});

test("normalizeOdds: every row tagged with provider=sharpapi + event_id preserved", () => {
  const provider = new SharpApiSoccerOddsProvider(asClient(new StubSharpApiClient(new Map())));
  const rows = provider.normalizeOdds(sharpApiMexicoVsRsaRows);
  for (const r of rows) {
    assert(r.provider === "sharpapi", "provider tag");
    assert(r.provider_event_id === "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3", "event_id preserved");
    assert(r.provider_endpoint === `/odds?league=${SHARP_WC_PRIMARY_LEAGUE}`, "endpoint tag includes primary league");
  }
});

test("normalizeOdds: total rows have line=2.5", () => {
  const provider = new SharpApiSoccerOddsProvider(asClient(new StubSharpApiClient(new Map())));
  const rows = provider.normalizeOdds(sharpApiMexicoVsRsaRows);
  const totals = rows.filter((r) => r.market === "total");
  assert(totals.length === 2, "expected 2 total rows");
  for (const t of totals) assert(t.line === 2.5, `expected line=2.5, got ${t.line}`);
});

test("normalizeOdds: match_result mapping: 'Mexico' → home, 'South Africa' → away, 'Draw' → draw", () => {
  const provider = new SharpApiSoccerOddsProvider(asClient(new StubSharpApiClient(new Map())));
  const rows = provider.normalizeOdds(sharpApiMexicoVsRsaRows);
  const mr = rows.filter((r) => r.market === "match_result");
  const selections = new Set(mr.map((r) => r.selection));
  assert(selections.has("home"), "home present");
  assert(selections.has("away"), "away present");
  assert(selections.has("draw"), "draw present");
});

test("normalizeOdds: double_chance 'Mexico / Draw' → home_or_draw", () => {
  const provider = new SharpApiSoccerOddsProvider(asClient(new StubSharpApiClient(new Map())));
  const rows = provider.normalizeOdds(sharpApiMexicoVsRsaRows);
  const dc = rows.find((r) => r.market === "double_chance");
  assert(dc?.selection === "home_or_draw", `expected home_or_draw, got ${dc?.selection}`);
});

test("normalizeOpportunities: drops player props, drops non-tracked markets, keeps tracked", () => {
  const provider = new SharpApiSoccerOddsProvider(asClient(new StubSharpApiClient(new Map())));
  const rows = provider.normalizeOpportunities(sharpApiOpportunityRows);
  assert(rows.length === 1, `expected 1 opportunity (only the total_goals one); got ${rows.length}`);
  assert(rows[0].market === "total", "opportunity market");
  assert(rows[0].ev_percentage === 2.57, "EV preserved");
  assert(rows[0].kelly_percent === 2.03, "Kelly preserved");
});

test("probeSplits: empty rows → SPLITS_ENDPOINT_EXISTS_EMPTY + status='empty_as_of_probe'", async () => {
  const stub = new StubSharpApiClient(new Map([["/splits", []]]));
  const provider = new SharpApiSoccerOddsProvider(asClient(stub));
  const { status, rows } = await provider.probeSplits();
  assert(status.classification === "SPLITS_ENDPOINT_EXISTS_EMPTY", "classification");
  assert(status.status === "empty_as_of_probe", "status");
  assert(status.row_count === 0, "row count");
  assert(rows.length === 0, "no rows");
});

test("probeSplits: present rows → SPLITS_PRESENT + status='present'", async () => {
  const stub = new StubSharpApiClient(new Map([["/splits", [{ event_id: "x" }, { event_id: "y" }]]]));
  const provider = new SharpApiSoccerOddsProvider(asClient(stub));
  const { status, rows } = await provider.probeSplits();
  assert(status.classification === "SPLITS_PRESENT", "classification");
  assert(status.status === "present", "status");
  assert(status.row_count === 2, "row count");
  assert(rows.length === 2, "rows propagated");
});

test("probeSplits: queries the primary WC league", async () => {
  const stub = new StubSharpApiClient(new Map([["/splits", []]]));
  const provider = new SharpApiSoccerOddsProvider(asClient(stub));
  await provider.probeSplits();
  assert(stub.lastQuery !== null && stub.lastQuery.league === SHARP_WC_PRIMARY_LEAGUE,
    `expected league=${SHARP_WC_PRIMARY_LEAGUE} in probe query`);
});

async function main() {
  for (const t of pending) await t();
  console.log("\n" + "━".repeat(60));
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log("❌ sharpapi-soccer-provider tests FAILED");
    process.exit(1);
  }
  console.log(`✅ All ${pass} tests passed.`);
}
main();
