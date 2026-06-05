/**
 * Phase 4.2.C.1.R-17 Step 2B — pure unit tests for
 * `_opportunitiesDiscovery.buildDiscoveryFromOpportunitiesRows`.
 *
 * Fixtures only. No network, no DB. Covers the filter, dedupe, date,
 * team-normalization, player-prop/alternate-line drops, and stats
 * accounting paths.
 *
 * Run: npx tsx scripts/test-opportunities-discovery.ts
 */

import {
  buildDiscoveryFromOpportunitiesRows,
  stripEventBucketSuffix,
  extractSlateDateFromEventId,
  type RawOpportunityRow,
} from "../lib/providers/real_api/_opportunitiesDiscovery";

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

function row(overrides: Partial<RawOpportunityRow>): RawOpportunityRow {
  return {
    event_id: "mlb_royals_twins_2026-06-05_b0",
    sport: "baseball",
    league: "mlb",
    home_team: "Minnesota Twins",
    away_team: "Kansas City Royals",
    is_player_prop: false,
    is_alternate_line: false,
    ...overrides,
  };
}

const DATE = "2026-06-05";

function main() {
  section("Helper — stripEventBucketSuffix");
  check(
    "strips _b0 suffix",
    stripEventBucketSuffix("mlb_royals_twins_2026-06-05_b0") ===
      "mlb_royals_twins_2026-06-05"
  );
  check(
    "strips _b3 suffix",
    stripEventBucketSuffix("mlb_redsox_yankees_2026-06-05_b3") ===
      "mlb_redsox_yankees_2026-06-05"
  );
  check(
    "idempotent on already-stripped",
    stripEventBucketSuffix("mlb_royals_twins_2026-06-05") ===
      "mlb_royals_twins_2026-06-05"
  );

  section("Helper — extractSlateDateFromEventId");
  check(
    "parses date from stripped id",
    extractSlateDateFromEventId("mlb_royals_twins_2026-06-05") === "2026-06-05"
  );
  check(
    "parses date from suffixed id",
    extractSlateDateFromEventId("mlb_royals_twins_2026-06-05_b3") === "2026-06-05"
  );
  check(
    "returns null on garbage",
    extractSlateDateFromEventId("garbage_no_date") === null
  );
  check(
    "returns null on null input",
    extractSlateDateFromEventId(null) === null
  );

  section("Build — happy path: 1 row, 1 event");
  {
    const res = buildDiscoveryFromOpportunitiesRows(
      [row({ event_id: "mlb_royals_twins_2026-06-05_b0" })],
      DATE
    );
    check("totalRows = 1", res.stats.totalRows === 1);
    check("keptEvents = 1", res.stats.keptEvents === 1);
    check("events.length = 1", res.events.length === 1);
    check(
      "sharpEventId is stripped",
      res.events[0]?.sharpEventId === "mlb_royals_twins_2026-06-05"
    );
    check(
      "suffixedEventId preserves bucket",
      res.events[0]?.suffixedEventId === "mlb_royals_twins_2026-06-05_b0"
    );
    check("home normalizes to MIN", res.events[0]?.home === "MIN");
    check("away normalizes to KC", res.events[0]?.away === "KC");
    check(
      "dateSuffix matches expected",
      res.events[0]?.dateSuffix === "2026-06-05"
    );
  }

  section("Build — dedupe across buckets");
  {
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ event_id: "mlb_royals_twins_2026-06-05_b0" }),
        row({ event_id: "mlb_royals_twins_2026-06-05_b1" }),
        row({ event_id: "mlb_royals_twins_2026-06-05_b2" }),
        row({ event_id: "mlb_royals_twins_2026-06-05_b3" }),
      ],
      DATE
    );
    check("totalRows = 4", res.stats.totalRows === 4);
    check("keptEvents = 1 (deduped)", res.stats.keptEvents === 1);
    check("dedupedRows = 3", res.stats.dedupedRows === 3);
    check(
      "suffixedEventId = first seen (_b0)",
      res.events[0]?.suffixedEventId === "mlb_royals_twins_2026-06-05_b0"
    );
  }

  section("Build — drop non-mlb league");
  {
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ league: "nba", event_id: "nba_lakers_celtics_2026-06-05_b0" }),
        row({ event_id: "mlb_royals_twins_2026-06-05_b0" }),
      ],
      DATE
    );
    check("skippedNonMlb = 1", res.stats.skippedNonMlb === 1);
    check("keptEvents = 1", res.stats.keptEvents === 1);
  }

  section("Build — drop player props");
  {
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ is_player_prop: true }),
        row({ event_id: "mlb_redsox_yankees_2026-06-05_b3", is_player_prop: false }),
      ],
      DATE
    );
    check("skippedPlayerProp = 1", res.stats.skippedPlayerProp === 1);
    check("keptEvents = 1", res.stats.keptEvents === 1);
  }

  section("Build — drop alternate lines");
  {
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ is_alternate_line: true }),
        row({ event_id: "mlb_redsox_yankees_2026-06-05_b3", is_alternate_line: false }),
      ],
      DATE
    );
    check("skippedAlternateLine = 1", res.stats.skippedAlternateLine === 1);
    check("keptEvents = 1", res.stats.keptEvents === 1);
  }

  section("Build — drop missing event_id");
  {
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ event_id: null }),
        row({ event_id: "" }),
        row({ event_id: "mlb_royals_twins_2026-06-05_b0" }),
      ],
      DATE
    );
    check("skippedMissingEventId = 2", res.stats.skippedMissingEventId === 2);
    check("keptEvents = 1", res.stats.keptEvents === 1);
  }

  section("Build — drop date-unparseable");
  {
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ event_id: "mlb_no_date_suffix_b0" }),
        row({ event_id: "mlb_royals_twins_2026-06-05_b0" }),
      ],
      DATE
    );
    check("skippedDateUnparseable = 1", res.stats.skippedDateUnparseable === 1);
    check("keptEvents = 1", res.stats.keptEvents === 1);
  }

  section("Build — drop wrong-date");
  {
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ event_id: "mlb_royals_twins_2026-06-04_b0" }),
        row({ event_id: "mlb_royals_twins_2026-06-06_b0" }),
        row({ event_id: "mlb_redsox_yankees_2026-06-05_b3" }),
      ],
      DATE
    );
    check("skippedWrongDate = 2", res.stats.skippedWrongDate === 2);
    check("keptEvents = 1", res.stats.keptEvents === 1);
  }

  section("Build — drop team-unresolved");
  {
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ home_team: "Made Up Team", away_team: "Royals" }),
        row({ event_id: "mlb_redsox_yankees_2026-06-05_b3" }),
      ],
      DATE
    );
    check("skippedTeamUnresolved = 1", res.stats.skippedTeamUnresolved === 1);
    check("keptEvents = 1", res.stats.keptEvents === 1);
  }

  section("Build — team normalization (the tricky cases)");
  {
    // Athletics today play as ATH (post-Oakland) per the BDL normalizer.
    // Probe the names SharpAPI actually emits.
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({
          event_id: "mlb_athletics_cubs_2026-06-05_b0",
          home_team: "Chicago Cubs",
          away_team: "Athletics",
        }),
        row({
          event_id: "mlb_oakland_houston_2026-06-05_b0",
          home_team: "Houston Astros",
          away_team: "Oakland Athletics",
        }),
        row({
          event_id: "mlb_sf_cubs_2026-06-05_b0",
          home_team: "Chicago Cubs",
          away_team: "San Francisco Giants",
        }),
        row({
          event_id: "mlb_whitesox_phillies_2026-06-05_b0",
          home_team: "Philadelphia Phillies",
          away_team: "Chicago White Sox",
        }),
        row({
          event_id: "mlb_bluejays_braves_2026-06-05_b0",
          home_team: "Atlanta Braves",
          away_team: "Toronto Blue Jays",
        }),
      ],
      DATE
    );
    check(
      "Athletics (no Oakland) resolves",
      res.events.find((e) => e.sharpEventId.includes("athletics_cubs"))?.away ===
        "ATH" ||
        res.events.find((e) => e.sharpEventId.includes("athletics_cubs"))?.away ===
        "OAK"
    );
    check(
      "Oakland Athletics resolves",
      res.events.find((e) => e.sharpEventId.includes("oakland_houston"))
        ?.away === "ATH" ||
        res.events.find((e) => e.sharpEventId.includes("oakland_houston"))
          ?.away === "OAK"
    );
    check(
      "San Francisco Giants resolves to SF",
      res.events.find((e) => e.sharpEventId.includes("sf_cubs"))?.away === "SF"
    );
    check(
      "Chicago White Sox resolves",
      res.events.find((e) => e.sharpEventId.includes("whitesox"))?.away === "CWS"
    );
    check(
      "Toronto Blue Jays resolves to TOR",
      res.events.find((e) => e.sharpEventId.includes("bluejays"))?.away === "TOR"
    );
  }

  section("Build — stats accounting (kept + skipped + deduped = total)");
  {
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ event_id: "mlb_royals_twins_2026-06-05_b0" }), // kept
        row({ event_id: "mlb_royals_twins_2026-06-05_b1" }), // deduped
        row({ league: "nba" }), // non-mlb
        row({ is_player_prop: true }), // player prop
        row({ is_alternate_line: true }), // alt line
        row({ event_id: null }), // missing event_id
        row({ event_id: "mlb_no_date_b0" }), // date unparseable
        row({ event_id: "mlb_royals_twins_2026-06-04_b0" }), // wrong date
        row({ home_team: "Made Up", away_team: "Royals" }), // team unresolved
      ],
      DATE
    );
    const s = res.stats;
    const sum =
      s.keptEvents +
      s.dedupedRows +
      s.skippedNonMlb +
      s.skippedPlayerProp +
      s.skippedAlternateLine +
      s.skippedMissingEventId +
      s.skippedDateUnparseable +
      s.skippedWrongDate +
      s.skippedTeamUnresolved;
    check(`total = ${s.totalRows}, sum = ${sum}`, sum === s.totalRows);
  }

  section("Build — empty input");
  {
    const res = buildDiscoveryFromOpportunitiesRows([], DATE);
    check("totalRows = 0", res.stats.totalRows === 0);
    check("keptEvents = 0", res.stats.keptEvents === 0);
    check("events empty", res.events.length === 0);
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All opportunities-discovery tests passed.`);
}

main();
