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
      "suffixedEventIds preserves bucket (single-bucket case)",
      res.events[0]?.suffixedEventIds.length === 1 &&
        res.events[0]?.suffixedEventIds[0] === "mlb_royals_twins_2026-06-05_b0"
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
      "[2E.1] suffixedEventIds collects ALL 4 buckets, sorted",
      res.events[0]?.suffixedEventIds.length === 4 &&
        res.events[0]?.suffixedEventIds.join(",") ===
          "mlb_royals_twins_2026-06-05_b0,mlb_royals_twins_2026-06-05_b1,mlb_royals_twins_2026-06-05_b2,mlb_royals_twins_2026-06-05_b3"
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
    check(
      "multiBucketEvents empty for empty input",
      res.stats.multiBucketEvents.length === 0
    );
  }

  section("Multi-bucket detector (R-17 Step 2D) — steady state");
  {
    // Single-bucket events (today's normal slate shape) should produce
    // an EMPTY multiBucketEvents array. The detector only fires when
    // SharpAPI starts publishing >1 _b\d+ per stripped event_id.
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ event_id: "mlb_royals_twins_2026-06-05_b0" }),
        row({ event_id: "mlb_royals_twins_2026-06-05_b0" }), // dedupe — same suffix
        row({ event_id: "mlb_redsox_yankees_2026-06-05_b3" }),
      ],
      DATE
    );
    check(
      "steady state — multiBucketEvents is empty",
      res.stats.multiBucketEvents.length === 0
    );
    check("dedupedRows counts the duplicate same-suffix row", res.stats.dedupedRows === 1);
  }

  section("Multi-bucket detector (R-17 Step 2D) — drift detected");
  {
    // Two distinct suffixes for the SAME stripped event_id → drift.
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ event_id: "mlb_royals_twins_2026-06-05_b0" }),
        row({ event_id: "mlb_royals_twins_2026-06-05_b3" }),
      ],
      DATE
    );
    check("drift — multiBucketEvents has 1 entry", res.stats.multiBucketEvents.length === 1);
    const entry = res.stats.multiBucketEvents[0];
    check(
      "drift — entry.sharpEventId is the stripped id",
      entry?.sharpEventId === "mlb_royals_twins_2026-06-05"
    );
    check(
      "drift — entry.suffixes sorted, contains both _b0 and _b3",
      entry?.suffixes.join(",") === "_b0,_b3"
    );
    check(
      "drift — keptEvents = 1 (single-suffix harvest behavior preserved)",
      res.stats.keptEvents === 1
    );
    check(
      "drift — dedupedRows = 1 (second suffix deduped under first)",
      res.stats.dedupedRows === 1
    );
  }

  section("Multi-bucket detector — multiple events, mixed drift");
  {
    // Three events: KC@MIN has 2 suffixes (drift), BOS@NYY has 1
    // (steady), SD@PHI has 3 suffixes (heavy drift).
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ event_id: "mlb_royals_twins_2026-06-05_b0" }),
        row({ event_id: "mlb_royals_twins_2026-06-05_b3" }),
        row({ event_id: "mlb_redsox_yankees_2026-06-05_b3" }),
        row({ event_id: "mlb_padres_phillies_2026-06-05_b0" }),
        row({ event_id: "mlb_padres_phillies_2026-06-05_b1" }),
        row({ event_id: "mlb_padres_phillies_2026-06-05_b3" }),
      ],
      DATE
    );
    check(
      "mixed drift — multiBucketEvents has 2 entries",
      res.stats.multiBucketEvents.length === 2
    );
    check(
      "mixed drift — sorted alphabetically by sharpEventId",
      res.stats.multiBucketEvents[0]?.sharpEventId === "mlb_padres_phillies_2026-06-05" &&
        res.stats.multiBucketEvents[1]?.sharpEventId === "mlb_royals_twins_2026-06-05"
    );
    check(
      "mixed drift — heavy drift entry lists all 3 suffixes",
      res.stats.multiBucketEvents[0]?.suffixes.join(",") === "_b0,_b1,_b3"
    );
    check(
      "mixed drift — single-bucket BOS@NYY NOT in multiBucketEvents",
      !res.stats.multiBucketEvents.some(
        (e) => e.sharpEventId === "mlb_redsox_yankees_2026-06-05"
      )
    );
  }

  section("Multi-bucket detector — wrong-date rows do NOT trigger");
  {
    // _b0 today + _b3 yesterday should NOT count as drift — the
    // yesterday row was dropped by the date filter before suffix
    // tracking. Defensive against false positives across slates.
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        row({ event_id: "mlb_royals_twins_2026-06-05_b0" }),
        row({ event_id: "mlb_royals_twins_2026-06-04_b3" }),
      ],
      DATE
    );
    check(
      "cross-slate — multiBucketEvents stays empty",
      res.stats.multiBucketEvents.length === 0
    );
    check(
      "cross-slate — wrong-date row counted in skippedWrongDate",
      res.stats.skippedWrongDate === 1
    );
  }

  section("R-17 Step 2E.0 — detector sees suffix from player-prop rows");
  {
    // Today's audit found SharpAPI publishes most /opportunities/ev
    // rows as is_player_prop=true / is_alternate_line=true. The old
    // detector ran AFTER those filters, so multi-bucket events with
    // an alt-line _b0 + main-line _b3 (or vice versa) appeared as
    // single-bucket. Step 2E.0 reordered the filters so suffix
    // tracking now runs BEFORE the prop / alt filters.
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        // _b0 is purely player props — the OLD code would have skipped
        // this and never recorded the _b0 suffix.
        row({
          event_id: "mlb_royals_twins_2026-06-05_b0",
          is_player_prop: true,
        }),
        // _b3 carries the main-line ML row that drives event ingest.
        row({ event_id: "mlb_royals_twins_2026-06-05_b3" }),
      ],
      DATE
    );
    check(
      "[2E.0] suffix from player-prop row registers — multi-bucket drift detected",
      res.stats.multiBucketEvents.length === 1 &&
        res.stats.multiBucketEvents[0]?.suffixes.join(",") === "_b0,_b3"
    );
    check(
      "[2E.0] player-prop row still drops from harvested events",
      res.events.length === 1 &&
        res.stats.skippedPlayerProp === 1
    );
  }

  section("R-17 Step 2E.0 — detector sees suffix from alternate-line rows");
  {
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        // _b0 has only alt-lines — OLD code would have skipped → no suffix recorded.
        row({
          event_id: "mlb_redsox_yankees_2026-06-05_b0",
          is_alternate_line: true,
        }),
        // _b3 carries the harvestable main line.
        row({ event_id: "mlb_redsox_yankees_2026-06-05_b3" }),
      ],
      DATE
    );
    check(
      "[2E.0] suffix from alt-line row registers — multi-bucket drift detected",
      res.stats.multiBucketEvents.length === 1 &&
        res.stats.multiBucketEvents[0]?.suffixes.join(",") === "_b0,_b3"
    );
    check(
      "[2E.0] alt-line row still drops from harvested events",
      res.events.length === 1 &&
        res.stats.skippedAlternateLine === 1
    );
  }

  section("R-17 Step 2E.0 — mixed scenario mirroring today's audit");
  {
    // Realistic shape: each event has many rows (most are props/alts),
    // both buckets present, only some rows survive harvest filters.
    const res = buildDiscoveryFromOpportunitiesRows(
      [
        // KC@MIN: _b0 all player-props, _b3 has 1 main line
        row({ event_id: "mlb_royals_twins_2026-06-05_b0", is_player_prop: true }),
        row({ event_id: "mlb_royals_twins_2026-06-05_b0", is_player_prop: true }),
        row({ event_id: "mlb_royals_twins_2026-06-05_b3" }),
        // BAL@TOR: _b0 main line, _b3 all alt-lines
        row({ event_id: "mlb_bluejays_orioles_2026-06-05_b0" }),
        row({ event_id: "mlb_bluejays_orioles_2026-06-05_b3", is_alternate_line: true }),
        // SF@CHC: single-bucket _b3 only — should NOT appear in drift list
        row({ event_id: "mlb_cubs_sanfranciscogiants_2026-06-05_b3" }),
      ],
      DATE
    );
    check(
      "[2E.0] mixed — 2 drift events (KC@MIN + BAL@TOR)",
      res.stats.multiBucketEvents.length === 2
    );
    check(
      "[2E.0] mixed — single-bucket SF@CHC NOT in drift list",
      !res.stats.multiBucketEvents.some(
        (e) => e.sharpEventId === "mlb_cubs_sanfranciscogiants_2026-06-05"
      )
    );
    check(
      "[2E.0] mixed — KC@MIN drift entry shows both buckets",
      res.stats.multiBucketEvents
        .find((e) => e.sharpEventId === "mlb_royals_twins_2026-06-05")
        ?.suffixes.join(",") === "_b0,_b3"
    );
    check(
      "[2E.0] mixed — keptEvents = 3 (one per stripped id)",
      res.stats.keptEvents === 3
    );
    check(
      "[2E.0] mixed — skippedPlayerProp = 2",
      res.stats.skippedPlayerProp === 2
    );
    check(
      "[2E.0] mixed — skippedAlternateLine = 1",
      res.stats.skippedAlternateLine === 1
    );
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
