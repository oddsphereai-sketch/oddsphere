/**
 * Phase 7A — NBA Finals v0a — feature snapshot tests.
 *
 * Covers the pure transform `buildMarketFromLines` plus the ESPN injury
 * payload parser + normalizer. Does NOT hit the DB or the network.
 *
 * The full `buildNbaFeatureSnapshots` integration is exercised via the
 * operator script + admin route at runtime; the pure pieces tested here
 * are the ones that have a measurable contract independent of supabase
 * state.
 *
 * Run: npx tsx scripts/test-nba-feature-snapshot.ts
 */

import {
  __NBA_FEATURE_SNAPSHOT_TEST__,
  blendNbaRegularSeasonRatings,
  nbaRatingsSeasonForSlateDate,
  type NbaTeamRatingsRow,
} from "../lib/services/nba/featureSnapshot";
import {
  __NBA_INJURIES_TEST__,
  parseEspnInjuriesPayload,
} from "../lib/services/nba/espnNbaInjuries";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

// ─── buildMarketFromLines ─────────────────────────────────────────

section("buildMarketFromLines · pure transform");

const { buildMarketFromLines } = __NBA_FEATURE_SNAPSHOT_TEST__;

{
  const empty = buildMarketFromLines([]);
  check("empty lines → all null ML", empty.ml.home_odds_american === null && empty.ml.away_odds_american === null);
  check("empty lines → all null spread", empty.spread.home_line === null);
  check("empty lines → all null total", empty.total.line === null);
}

{
  const lines = [
    { game_id: 1, market_type: "moneyline", sportsbook: "pinnacle", side: "home", line_value: null, odds_american: -180 },
    { game_id: 1, market_type: "moneyline", sportsbook: "pinnacle", side: "away", line_value: null, odds_american: +150 },
    { game_id: 1, market_type: "moneyline", sportsbook: "fanduel", side: "home", line_value: null, odds_american: -200 },
    { game_id: 1, market_type: "spread", sportsbook: "pinnacle", side: "home", line_value: -4.5, odds_american: -110 },
    { game_id: 1, market_type: "spread", sportsbook: "pinnacle", side: "away", line_value: 4.5, odds_american: -110 },
    { game_id: 1, market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 220.5, odds_american: -110 },
    { game_id: 1, market_type: "total", sportsbook: "pinnacle", side: "under", line_value: 220.5, odds_american: -110 },
  ];
  const m = buildMarketFromLines(lines);
  check("pinnacle ML home picked (priority order)", m.ml.home_odds_american === -180);
  check("pinnacle ML away picked", m.ml.away_odds_american === +150);
  check("spread.home_line = -4.5 (book-listed home spread)", m.spread.home_line === -4.5);
  check("total line = 220.5", m.total.line === 220.5);
  check("total over odds = -110", m.total.over_odds_american === -110);
  check("total under odds = -110", m.total.under_odds_american === -110);
}

{
  // No Pinnacle → falls back to fanduel
  const lines = [
    { game_id: 1, market_type: "moneyline", sportsbook: "fanduel", side: "home", line_value: null, odds_american: -200 },
    { game_id: 1, market_type: "moneyline", sportsbook: "fanduel", side: "away", line_value: null, odds_american: +170 },
  ];
  const m = buildMarketFromLines(lines);
  check("no Pinnacle → fanduel picked", m.ml.home_odds_american === -200);
}

{
  // Spread only on one side → other side null
  const lines = [
    { game_id: 1, market_type: "spread", sportsbook: "pinnacle", side: "home", line_value: -3.0, odds_american: -110 },
  ];
  const m = buildMarketFromLines(lines);
  check("partial spread → home_line populated", m.spread.home_line === -3.0);
  check("partial spread → away odds null", m.spread.away_odds_american === null);
}

// ─── season identity + early-season ratings handoff ──────────────

section("season identity + early-season ratings handoff");

check("October 2026 maps to BBR season 2027", nbaRatingsSeasonForSlateDate("2026-10-20") === 2027);
check("June 2027 remains BBR season 2027", nbaRatingsSeasonForSlateDate("2027-06-10") === 2027);

function ratings(overrides: Partial<NbaTeamRatingsRow>): NbaTeamRatingsRow {
  return {
    team_id: 1,
    season: 2026,
    season_type: "regular",
    off_rating: 120,
    def_rating: 110,
    net_rating: 10,
    pace: 100,
    off_efg_pct: 0.57,
    off_tov_pct: 0.12,
    off_orb_pct: 0.28,
    off_ft_rate: 0.25,
    def_efg_pct: 0.52,
    def_tov_pct: 0.14,
    def_drb_pct: 0.74,
    def_ft_rate_allowed: 0.2,
    source: "test",
    source_url: "https://example.test",
    fetched_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

{
  const blended = blendNbaRegularSeasonRatings({
    current: undefined,
    previous: ratings({}),
    currentGames: 0,
    slateDate: "2026-10-20",
    ratingsSeason: 2027,
  });
  check("opening night carries regressed prior offense", blended?.off_rating === 117.8, `got ${blended?.off_rating}`);
  check("opening night carries regressed prior defense", blended?.def_rating === 111.8, `got ${blended?.def_rating}`);
  check("opening night relabels row to current season", blended?.season === 2027);
}

{
  const blended = blendNbaRegularSeasonRatings({
    current: ratings({ season: 2027, off_rating: 118, def_rating: 112 }),
    previous: ratings({}),
    currentGames: 8,
    slateDate: "2026-11-10",
    ratingsSeason: 2027,
  });
  check("eight games give current offense half weight", blended?.off_rating === 117.9, `got ${blended?.off_rating}`);
  check("eight games give current defense half weight", blended?.def_rating === 111.9, `got ${blended?.def_rating}`);
}

{
  const emptyCurrent = ratings({ season: 2027, off_rating: null, def_rating: null, net_rating: null, pace: null });
  const blended = blendNbaRegularSeasonRatings({
    current: emptyCurrent,
    previous: ratings({}),
    currentGames: 12,
    slateDate: "2026-12-05",
    ratingsSeason: 2027,
  });
  check("empty December scrape cannot erase valid prior", blended?.off_rating !== null);
}

// ─── normalizeStatus ──────────────────────────────────────────────

section("normalizeStatus · ESPN status mapping");

const { normalizeStatus } = __NBA_INJURIES_TEST__;

check("'Out' → out", normalizeStatus("Out") === "out");
check("'Questionable' → questionable", normalizeStatus("Questionable") === "questionable");
check("'Probable' → probable", normalizeStatus("Probable") === "probable");
check("'Available' → available", normalizeStatus("Available") === "available");
check("'Day-To-Day' → questionable", normalizeStatus("Day-To-Day") === "questionable");
check("'Doubtful' → questionable", normalizeStatus("Doubtful") === "questionable");
check("'Active' → available", normalizeStatus("Active") === "available");
check("null → unknown", normalizeStatus(null) === "unknown");
check("undefined → unknown", normalizeStatus(undefined) === "unknown");
check("'' → unknown", normalizeStatus("") === "unknown");
check("garbage string → unknown", normalizeStatus("Not A Real Status") === "unknown");
check("'Out For Season' → out", normalizeStatus("Out For Season") === "out");

// ─── parseEspnInjuriesPayload ─────────────────────────────────────

section("parseEspnInjuriesPayload · ESPN parser");

{
  const res = parseEspnInjuriesPayload({ injuries: [] });
  check("empty injuries array → empty players (known)", res !== null && res.players.length === 0);
}

{
  const res = parseEspnInjuriesPayload({});
  check("missing injuries key → empty (treated as known zero)", res !== null && res.players.length === 0);
}

{
  const res = parseEspnInjuriesPayload(null);
  check("null body → null result", res === null);
}

{
  const res = parseEspnInjuriesPayload({
    injuries: [
      { athlete: { id: 1, displayName: "Jayson Tatum" }, status: "Questionable" },
      { athlete: { id: 2, displayName: "Jaylen Brown" }, status: "Out" },
    ],
  });
  check("two flat athletes parsed", res !== null && res.players.length === 2);
  if (res !== null) {
    check("first player status normalized", res.players[0]!.status === "questionable");
    check("first player name preserved", res.players[0]!.name === "Jayson Tatum");
    check("second player out", res.players[1]!.status === "out");
  }
}

{
  // Nested shape (team-grouped)
  const res = parseEspnInjuriesPayload({
    injuries: [
      {
        type: "Out",
        athletes: [
          { id: 10, displayName: "LeBron James" },
          { id: 11, displayName: "Anthony Davis" },
        ],
      },
    ],
  });
  check("nested athletes parsed", res !== null && res.players.length === 2);
  if (res !== null) {
    check("nested athlete name", res.players[0]!.name === "LeBron James");
    check("nested status from group type", res.players[0]!.status === "out");
  }
}

{
  const res = parseEspnInjuriesPayload({
    injuries: [
      { athlete: { id: 1, displayName: "Test Player" } }, // no status
    ],
  });
  check("athlete without status → unknown", res !== null && res.players[0]!.status === "unknown");
}

// ─── Summary ──────────────────────────────────────────────────────

console.log(`\n━━━ Summary ━━━`);
console.log(`PASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  console.log(`\nFailures:`);
  for (const f of failures) console.log(f);
  process.exit(1);
}
process.exit(0);
