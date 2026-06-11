/**
 * Tests for the soccer reconciler + provider-status composer (WC-2).
 *
 * Pure-function tests only. No HTTP, no DB.
 */

import {
  reconcileSoccerEvents,
  extractSharpEventCandidates,
} from "../lib/providers/real_api/_soccerReconciler";
import {
  composeSoccerProviderStatus,
  deriveSlateSeverity,
} from "../lib/providers/real_api/_soccerProviderStatus";
import type { NormalizedBdlMatch } from "../lib/providers/real_api/BallDontLieFifaProvider";
import type { SoccerSplitsStatus } from "../lib/providers/real_api/SharpApiSoccerOddsProvider";

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`);
}
function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }
}

console.log("\nscripts/test-soccer-reconciler-and-status.ts");
console.log("─".repeat(60));

// ─── Fixtures ─────────────────────────────────────────────────────────

function bdlMatch(overrides: Partial<NormalizedBdlMatch> & {
  provider_match_id: number;
  home_team_name: string;
  away_team_name: string;
  datetime: string;
}): NormalizedBdlMatch {
  return {
    provider_match_id: overrides.provider_match_id,
    match_number: null,
    datetime: overrides.datetime,
    status: "scheduled",
    stage_name: null,
    group_name: null,
    stadium_name: null,
    stadium_city: null,
    stadium_country: null,
    home_team_id: 0,
    home_team_name: overrides.home_team_name,
    home_team_abbr: "",
    home_team_country_code: "",
    away_team_id: 0,
    away_team_name: overrides.away_team_name,
    away_team_abbr: "",
    away_team_country_code: "",
    ft_home_score: null,
    ft_away_score: null,
    has_extra_time: false,
    has_penalty_shootout: false,
    raw_row: {} as never,
  };
}

const bdlMatches: NormalizedBdlMatch[] = [
  bdlMatch({
    provider_match_id: 1,
    home_team_name: "Mexico",
    away_team_name: "South Africa",
    datetime: "2026-06-11T19:00:00Z",
  }),
  bdlMatch({
    provider_match_id: 2,
    home_team_name: "Germany",
    away_team_name: "Curacao",
    datetime: "2026-06-14T17:00:00Z",
  }),
  bdlMatch({
    provider_match_id: 3,
    home_team_name: "Argentina",
    away_team_name: "Brazil",
    datetime: "2026-06-15T22:00:00Z",
  }),
];

const sharpCandidates = [
  // matches BDL 1 by team pair + same UTC date
  { event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b3", home_team: "Mexico", away_team: "South Africa", event_start_time: "2026-06-11T19:00:00Z" },
  // duplicate of the above with a different bucket suffix — should dedup
  { event_id: "fifa_world_cup_matches_mexico_southafrica_2026-06-11_b2", home_team: "Mexico", away_team: "South Africa", event_start_time: "2026-06-11T19:00:00Z" },
  // matches BDL 2 with start_time 30 minutes off (well within 6h)
  { event_id: "fifa_world_cup_matches_germany_curacao_2026-06-14_b3", home_team: "Germany", away_team: "Curacao", event_start_time: "2026-06-14T17:30:00Z" },
  // a SHARP_ONLY event — no BDL counterpart (Polymarket novelty pattern)
  { event_id: "fifa_-_world_cup__2446852willronaldocr_2026-06-05_b3", home_team: "2446852 Will Ronaldo Cry at the World Cup", away_team: "", event_start_time: "2026-06-05T20:05:34Z" },
];

// ─── Reconciler tests ──────────────────────────────────────────────────

test("reconcile: 3 BDL × 4 SharpAPI rows → 2 MATCHED, 1 BDL_ONLY (Argentina/Brazil), 0–1 SHARP_ONLY depending on dedup", () => {
  // Filter out the malformed empty-away SharpAPI row first (extractSharpEventCandidates would drop it
  // because away_team is empty). For the reconciler we feed the raw list to verify dedup works
  // when the bucket suffix differs but team pair matches.
  const recs = reconcileSoccerEvents(bdlMatches, sharpCandidates);
  const matched = recs.filter((r) => r.kind === "MATCHED");
  const bdlOnly = recs.filter((r) => r.kind === "BDL_ONLY");
  const sharpOnly = recs.filter((r) => r.kind === "SHARP_ONLY");
  assert(matched.length === 2, `expected 2 MATCHED, got ${matched.length}`);
  assert(bdlOnly.length === 1, `expected 1 BDL_ONLY (Argentina/Brazil), got ${bdlOnly.length}`);
  assert(bdlOnly[0].bdl_match?.home_team_name === "Argentina", "BDL_ONLY is Argentina/Brazil");
  assert(sharpOnly.length === 1, `expected 1 SHARP_ONLY (Will Ronaldo Cry), got ${sharpOnly.length}`);
});

test("reconcile: same team pair across buckets dedups to a single MATCHED record", () => {
  const recs = reconcileSoccerEvents(bdlMatches, sharpCandidates);
  const mexRsaMatched = recs.filter(
    (r) => r.kind === "MATCHED" && r.bdl_match?.home_team_name === "Mexico",
  );
  assert(mexRsaMatched.length === 1, `Mexico vs RSA should match exactly once across bucket variants, got ${mexRsaMatched.length}`);
});

test("reconcile: team pair order doesn't matter (home/away flipped on one side still matches)", () => {
  const bdl = [bdlMatch({
    provider_match_id: 99, home_team_name: "Spain", away_team_name: "Italy",
    datetime: "2026-06-20T19:00:00Z",
  })];
  const sharp = [{
    event_id: "x",
    home_team: "Italy",
    away_team: "Spain",
    event_start_time: "2026-06-20T19:00:00Z",
  }];
  const recs = reconcileSoccerEvents(bdl, sharp);
  assert(recs.length === 1 && recs[0].kind === "MATCHED", "home/away flip should still match by pair key");
});

test("reconcile: start time off by >6h AND different UTC date → SHARP_ONLY", () => {
  const bdl = [bdlMatch({
    provider_match_id: 1, home_team_name: "France", away_team_name: "Portugal",
    datetime: "2026-06-25T18:00:00Z",
  })];
  const sharp = [{
    event_id: "x",
    home_team: "France",
    away_team: "Portugal",
    event_start_time: "2026-06-27T12:00:00Z",
  }];
  const recs = reconcileSoccerEvents(bdl, sharp);
  const sharpOnly = recs.filter((r) => r.kind === "SHARP_ONLY");
  const bdlOnly = recs.filter((r) => r.kind === "BDL_ONLY");
  assert(sharpOnly.length === 1, "must flag as SHARP_ONLY (date mismatch)");
  assert(bdlOnly.length === 1, "BDL match still reported as BDL_ONLY");
});

test("reconcile: BDL with no SharpAPI → BDL_ONLY", () => {
  const recs = reconcileSoccerEvents(bdlMatches, []);
  assert(recs.length === 3, "3 BDL_ONLY records");
  assert(recs.every((r) => r.kind === "BDL_ONLY"));
});

test("reconcile: SharpAPI with no BDL → SHARP_ONLY", () => {
  const sharp = [{ event_id: "x", home_team: "A", away_team: "B", event_start_time: "2026-06-11T00:00:00Z" }];
  const recs = reconcileSoccerEvents([], sharp);
  assert(recs.length === 1 && recs[0].kind === "SHARP_ONLY", "single SHARP_ONLY record");
});

test("extractSharpEventCandidates: drops rows missing event_id / team names + dedups by (event_id, teams)", () => {
  const raw = [
    { event_id: "a", home_team: "X", away_team: "Y", event_start_time: "2026-06-11T00:00:00Z" },
    { event_id: "a", home_team: "X", away_team: "Y", event_start_time: "2026-06-11T00:00:00Z" }, // dup
    { event_id: undefined, home_team: "X", away_team: "Y" } as never, // missing event_id
    { event_id: "c", home_team: "X" } as never, // missing away_team
    { event_id: "b", home_team: "Z", away_team: "W", event_start_time: "2026-06-12T00:00:00Z" },
  ];
  const out = extractSharpEventCandidates(raw);
  assert(out.length === 2, `expected 2 after dedup + dropping, got ${out.length}`);
});

// ─── Provider status tests ────────────────────────────────────────────

function emptySplitsStatus(): SoccerSplitsStatus {
  return {
    classification: "SPLITS_ENDPOINT_EXISTS_EMPTY",
    status: "empty_as_of_probe",
    last_checked_at: "2026-06-11T01:00:00Z",
    row_count: 0,
    endpoint: "/splits?league=fifa_world_cup_matches",
    error: null,
  };
}

function presentSplitsStatus(): SoccerSplitsStatus {
  return {
    classification: "SPLITS_PRESENT",
    status: "present",
    last_checked_at: "2026-06-11T01:00:00Z",
    row_count: 5,
    endpoint: "/splits?league=fifa_world_cup_matches",
    error: null,
  };
}

function errorSplitsStatus(msg: string): SoccerSplitsStatus {
  return {
    classification: "SPLITS_PROVIDER_ERROR",
    status: "error",
    last_checked_at: "2026-06-11T01:00:00Z",
    row_count: 0,
    endpoint: "/splits?league=fifa_world_cup_matches",
    error: msg,
  };
}

test("provider status: both odds sources + splits empty_as_of_probe → severity=INFO", () => {
  const s = composeSoccerProviderStatus({
    bdlNormalizedCount: 50,
    sharpapiNormalizedCount: 40,
    sharpapiOpportunitiesCount: 10,
    sharpapiOpportunitiesError: false,
    splits: emptySplitsStatus(),
  });
  assert(s.bdl_odds_available === true, "BDL available");
  assert(s.sharpapi_odds_available === true, "SharpAPI available");
  assert(s.splits.status === "empty_as_of_probe", "splits status carried through");
  assert(deriveSlateSeverity(s) === "INFO", "severity = INFO (healthy + splits empty is fine)");
});

test("provider status: only BDL available → severity=WARN (single source)", () => {
  const s = composeSoccerProviderStatus({
    bdlNormalizedCount: 50,
    sharpapiNormalizedCount: 0,
    sharpapiOpportunitiesCount: 0,
    sharpapiOpportunitiesError: false,
    splits: emptySplitsStatus(),
  });
  assert(deriveSlateSeverity(s) === "WARN", "single source = WARN");
});

test("provider status: neither odds source → severity=HIGH (block)", () => {
  const s = composeSoccerProviderStatus({
    bdlNormalizedCount: 0,
    sharpapiNormalizedCount: 0,
    sharpapiOpportunitiesCount: 0,
    sharpapiOpportunitiesError: false,
    splits: emptySplitsStatus(),
  });
  assert(deriveSlateSeverity(s) === "HIGH", "no source = HIGH");
});

test("provider status: splits PROVIDER_ERROR → severity=WARN (transient flag)", () => {
  const s = composeSoccerProviderStatus({
    bdlNormalizedCount: 50,
    sharpapiNormalizedCount: 40,
    sharpapiOpportunitiesCount: 10,
    sharpapiOpportunitiesError: false,
    splits: errorSplitsStatus("network timeout"),
  });
  assert(deriveSlateSeverity(s) === "WARN", "splits error = WARN");
});

test("provider status: splits PRESENT + both odds healthy → INFO", () => {
  const s = composeSoccerProviderStatus({
    bdlNormalizedCount: 50,
    sharpapiNormalizedCount: 40,
    sharpapiOpportunitiesCount: 10,
    sharpapiOpportunitiesError: false,
    splits: presentSplitsStatus(),
  });
  assert(deriveSlateSeverity(s) === "INFO", "all good = INFO");
});

test("provider status: counts preserved", () => {
  const s = composeSoccerProviderStatus({
    bdlNormalizedCount: 7,
    sharpapiNormalizedCount: 5,
    sharpapiOpportunitiesCount: 2,
    sharpapiOpportunitiesError: false,
    splits: emptySplitsStatus(),
  });
  assert(s.counts.bdl_normalized_odds_records === 7);
  assert(s.counts.sharpapi_normalized_odds_records === 5);
  assert(s.counts.sharpapi_normalized_opportunities === 2);
});

console.log("\n" + "━".repeat(60));
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("❌ soccer-reconciler-and-status tests FAILED");
  process.exit(1);
}
console.log(`✅ All ${pass} tests passed.`);
