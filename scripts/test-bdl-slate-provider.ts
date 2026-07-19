/**
 * Phase 4.1.9.C-1c.iv — Tests for BallDontLieSlateProvider.getGames.
 *
 * Asserts the ET sports-day correction behaves as designed:
 *   1. dates[]=D + dates[]=D+1 fetch widens the window
 *   2. dedupe by BDL game id
 *   3. filter via computeSlateDate(sport, game_date) === D
 *   4. all 9 canonical 2026-06-01 MLB games are returned
 *   5. late West Coast games (COL@LAA, LAD@ARI, NYM@SEA) are included
 *   6. true 2026-06-02 games are excluded
 *
 * Deterministic — uses saved fixtures from tests/fixtures/bdl/. Re-savable
 * by hitting the live API and replaying. No network calls in this test.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/test-bdl-slate-provider.ts
 *
 * The --env-file gate is for the BALLDONTLIE_API_KEY env var, which the
 * provider constructor requires even though the test path never hits
 * the network (we exercise __testOnly_filterToSportsDay).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BallDontLieSlateProvider,
  suppressDuplicateDoubleheaderStarters,
} from "../lib/providers/real_api/BallDontLieSlateProvider";

const FIXTURES_DIR = resolve(__dirname, "..", "tests", "fixtures", "bdl");

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

type RawGame = {
  id: number;
  date?: string | null;
  game_date?: string | null;
  home_team?: { id?: number; abbreviation?: string; name?: string } | null;
  away_team?: { id?: number; abbreviation?: string; name?: string } | null;
};

async function loadFixture(name: string): Promise<RawGame[]> {
  const path = resolve(FIXTURES_DIR, name);
  const body = JSON.parse(await readFile(path, "utf8")) as { data?: RawGame[] };
  return body.data ?? [];
}

function pair(g: RawGame): string {
  return `${g.away_team?.abbreviation ?? "?"}@${g.home_team?.abbreviation ?? "?"}`;
}

async function main() {
  const SLATE_DATE = "2026-06-01";

  // Load fixtures
  const rowsD = await loadFixture("games-2026-06-01.json");
  const rowsD1 = await loadFixture("games-2026-06-02.json");

  // Sanity on fixture sizes — guards against accidental over-write of fixtures
  section("Fixture sanity");
  check("dates[]=2026-06-01 fixture has 6 games (as captured)", rowsD.length === 6, `got ${rowsD.length}`);
  check("dates[]=2026-06-02 fixture has 13 games (as captured)", rowsD1.length === 13, `got ${rowsD1.length}`);

  // Provider does not need to hit the network for the filter — we use the
  // test-only seam to feed already-fetched rows through the same dedupe +
  // filter pipeline the production code uses.
  const provider = new BallDontLieSlateProvider("test-key-not-used-in-this-path");
  const filtered = provider.__testOnly_filterToSportsDay(rowsD, rowsD1, SLATE_DATE, "mlb") as RawGame[];

  section(`ET sports-day filter for ${SLATE_DATE}`);
  check(
    `returns exactly 9 games (the canonical MLB slate)`,
    filtered.length === 9,
    `got ${filtered.length}: ${filtered.map(pair).join(", ")}`
  );

  const matchupPairs = new Set(filtered.map(pair));

  // Canonical 9 games per ESPN/DraftKings (verified by Daniel)
  const CANONICAL: string[] = [
    "DET@TB",
    "MIA@WSH",
    "KC@CIN",
    "CWS@MIN",  // BDL returns "CHW" for White Sox — depending on fixture, may need alias
    "SF@MIL",
    "TEX@STL",
    "COL@LAA",
    "LAD@ARI",
    "NYM@SEA",
  ];
  for (const m of CANONICAL) {
    // CWS / CHW alias check — BDL response uses CHW abbreviation directly
    const alt = m === "CWS@MIN" ? "CHW@MIN" : m;
    const found = matchupPairs.has(m) || matchupPairs.has(alt);
    check(`canonical matchup present: ${m}`, found);
  }

  section("Late West Coast games (must come from dates[]=D+1)");
  const lateWestCoast = ["COL@LAA", "LAD@ARI", "NYM@SEA"];
  for (const m of lateWestCoast) {
    const game = filtered.find((g) => pair(g) === m);
    check(`${m} is in the filtered slate`, game !== undefined);
    if (game !== undefined) {
      // Verify the game's UTC date is actually 2026-06-02 — proving it
      // came from the D+1 fetch and was rescued by the sports-day filter
      const utcDate = (game.date ?? game.game_date ?? "").slice(0, 10);
      check(`${m} has UTC date 2026-06-02 (so it came from the D+1 query)`, utcDate === "2026-06-02", `utc=${utcDate}`);
    }
  }

  section("True June 2 games must NOT be in the June 1 slate");
  // The D+1 fixture has 13 games; 3 belong to D's ET sports day (those above)
  // and the rest are genuine June 2 ET games. Sample a few that should be
  // excluded by their UTC time of day (~22:40+ on 2026-06-02).
  const trueJune2 = rowsD1.filter((g) => {
    const utc = g.date ?? g.game_date ?? "";
    return utc.startsWith("2026-06-02T2"); // 22:40+ UTC on 2026-06-02
  });
  check(`fixture contains true June 2 games (>= 8)`, trueJune2.length >= 8, `got ${trueJune2.length}`);
  for (const g of trueJune2) {
    const isInFiltered = filtered.some((f) => f.id === g.id);
    check(
      `true June 2 game id=${g.id} ${pair(g)} is excluded`,
      !isInFiltered,
      isInFiltered ? "leaked into slate" : undefined
    );
  }

  section("Dedupe behavior");
  // Feed the same fixture into both slots to verify dedupe.
  const fedTwice = provider.__testOnly_filterToSportsDay(rowsD, rowsD, SLATE_DATE, "mlb") as RawGame[];
  check(
    `duplicate input rows are deduped by id (6 → 6, not 12)`,
    fedTwice.length === 6,
    `got ${fedTwice.length}`
  );

  section("Empty input handling");
  const emptyResult = provider.__testOnly_filterToSportsDay([], [], SLATE_DATE, "mlb") as RawGame[];
  check("empty inputs return []", emptyResult.length === 0);

  section("Doubleheader starter safety");
  const doubleheader = suppressDuplicateDoubleheaderStarters([
    {
      external_id: 1,
      game_date: "2026-07-19T16:35:00Z",
      home_team_external_id: 147,
      away_team_external_id: 119,
      home_pitcher_external_id: 10,
      away_pitcher_external_id: 20,
      provider_ids: { balldontlie: 1 } as Record<string, string | number>,
    },
    {
      external_id: 2,
      game_date: "2026-07-19T23:20:00Z",
      home_team_external_id: 147,
      away_team_external_id: 119,
      home_pitcher_external_id: 10,
      away_pitcher_external_id: 20,
      provider_ids: { balldontlie: 2 } as Record<string, string | number>,
    },
  ]);
  check(
    "keeps game-one starter assignments",
    doubleheader[0]?.home_pitcher_external_id === 10 && doubleheader[0]?.away_pitcher_external_id === 20,
  );
  check(
    "clears copied game-two starter assignments",
    doubleheader[1]?.home_pitcher_external_id === null && doubleheader[1]?.away_pitcher_external_id === null,
  );
  check(
    "marks copied game-two starter assignments as intentional clears",
    doubleheader[1]?.provider_ids?.oddsphere_suppress_duplicate_home_pitcher === 1
      && doubleheader[1]?.provider_ids?.oddsphere_suppress_duplicate_away_pitcher === 1,
  );

  section("Different slate date filters differently");
  const june2Filtered = provider.__testOnly_filterToSportsDay(rowsD, rowsD1, "2026-06-02", "mlb") as RawGame[];
  // Expected: 10 true June 2 games (the 13 D+1 rows minus the 3 that
  // actually belong to June 1 ET sports day)
  check(`getting slate for 2026-06-02 returns 10 games (not 13)`, june2Filtered.length === 10, `got ${june2Filtered.length}`);
  check(
    `2026-06-02 slate does NOT include LAD@ARI (which is June 1 ET)`,
    !june2Filtered.some((g) => pair(g) === "LAD@ARI")
  );

  // Summary
  console.log();
  console.log("━━━ Test summary ━━━");
  console.log(`  Passed: ${pass}`);
  console.log(`  Failed: ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
