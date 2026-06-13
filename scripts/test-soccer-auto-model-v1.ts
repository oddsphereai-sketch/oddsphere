/**
 * End-to-end test for the WC-3 soccer auto-model. Covers the binding
 * contracts from project-wc-model-standard:
 *
 *   • Raw model probabilities derived without ANY market input.
 *   • Market cannot flip a pick.
 *   • DC derives from match_result; total + BTTS from joint distribution.
 *   • Best Angle locked off under external_priors_only.
 *   • Snapshot carries all provenance fields.
 *   • Pre-calibration whitelist holds match_result + DC.
 *
 * Uses Mexico vs South Africa as the headline fixture.
 */

import { buildEloPriorFromCsv } from "../lib/services/soccer/eloPrior";
import { runSoccerAutoModelV1 } from "../lib/services/soccer/soccerAutoModelV1";
import type { NormalizedSoccerOddsRecord } from "../lib/providers/real_api/_soccerMarketNormalizer";
import type { NormalizedBdlMatch } from "../lib/providers/real_api/BallDontLieFifaProvider";
import type { SoccerSplitsStatus } from "../lib/providers/real_api/SharpApiSoccerOddsProvider";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void { if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`); }
function close(a: number, b: number, eps = 1e-6): boolean { return Math.abs(a - b) < eps; }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-soccer-auto-model-v1.ts");
console.log("─".repeat(60));

const eloCsv = `team_name,country_code,elo_rating,confederation,source_url,retrieval_date,notes
Mexico,MEX,1880,CONCACAF,test,2026-06-11,host
South Africa,RSA,1640,CAF,test,2026-06-11,
Argentina,ARG,2150,CONMEBOL,test,2026-06-11,
Brazil,BRA,2100,CONMEBOL,test,2026-06-11,
USA,USA,1860,CONCACAF,test,2026-06-11,host
Canada,CAN,1755,CONCACAF,test,2026-06-11,host
`;
const eloTable = buildEloPriorFromCsv(eloCsv);

function mexVsSouthAfricaMatch(): NormalizedBdlMatch {
  return {
    provider_match_id: 1,
    match_number: 1,
    datetime: "2026-06-11T19:00:00.000Z",
    status: "scheduled",
    stage_name: "Group Stage",
    group_name: "Group A",
    stadium_name: "Estadio Azteca",
    stadium_city: "Mexico City",
    stadium_country: "MEX",
    home_team_id: 1, home_team_name: "Mexico", home_team_abbr: "MEX", home_team_country_code: "MEX",
    away_team_id: 2, away_team_name: "South Africa", away_team_abbr: "RSA", away_team_country_code: "RSA",
    ft_home_score: null, ft_away_score: null,
    has_extra_time: false, has_penalty_shootout: false,
    raw_row: {} as never,
  };
}

function emptySplits(): SoccerSplitsStatus {
  return {
    classification: "SPLITS_ENDPOINT_EXISTS_EMPTY",
    status: "empty_as_of_probe",
    last_checked_at: "2026-06-11T01:00:00Z",
    row_count: 0,
    endpoint: "/splits?league=fifa_world_cup_matches",
    error: null,
  };
}

function mkOdds(): NormalizedSoccerOddsRecord[] {
  const base = { line: null, odds_decimal: null, sportsbook: "fanduel", provider: "bdl" as const, provider_endpoint: "/fifa/worldcup/v1/odds", fetched_at: "2026-06-11T18:30:00Z", provider_event_id: "bdl_match_1" };
  return [
    // match_result main lines
    { ...base, market: "match_result", selection: "home", odds_american: 120 },
    { ...base, market: "match_result", selection: "draw", odds_american: 280 },
    { ...base, market: "match_result", selection: "away", odds_american: 260 },
    // double_chance
    { ...base, market: "double_chance", selection: "home_or_draw", odds_american: -180 },
    { ...base, market: "double_chance", selection: "away_or_draw", odds_american: 130 },
    { ...base, market: "double_chance", selection: "home_or_away", odds_american: -110 },
    // total 2.5
    { ...base, market: "total", selection: "over", line: 2.5, odds_american: -110 },
    { ...base, market: "total", selection: "under", line: 2.5, odds_american: -110 },
    // btts
    { ...base, market: "btts", selection: "yes", odds_american: 110 },
    { ...base, market: "btts", selection: "no", odds_american: -130 },
    // SharpAPI overlay (to satisfy multi-provider check)
    { ...base, provider: "sharpapi", provider_endpoint: "/odds?league=fifa_world_cup_matches", market: "match_result", selection: "home", odds_american: 130, sportsbook: "bovada" },
  ];
}

// ─── Binding rule tests ─────────────────────────────────────────────

test("CORE: model raw probabilities derived without any market input", () => {
  const m = mexVsSouthAfricaMatch();
  const oddsRows: NormalizedSoccerOddsRecord[] = []; // intentionally NO market rows
  // Run with empty odds — model still produces raw probabilities + λs.
  // (Markets WILL be held with MARKET_ODDS_MISSING, but the upstream raw
  // model output exists regardless.)
  const out = runSoccerAutoModelV1({
    eloTable, match: m, oddsRows, splitsStatus: emptySplits(), reconciliation: "BDL_ONLY",
  });
  assert(out.marketProbs.match_result.home + out.marketProbs.match_result.draw + out.marketProbs.match_result.away > 0.999, "raw match_result probabilities exist without market");
  assert(out.marketProbs.btts.yes + out.marketProbs.btts.no > 0.999, "raw btts probabilities exist without market");
  assert(out.lambdaHome > 0 && out.lambdaAway > 0, "λs exist without market");
});

// WC Tier-0 contract CHANGE: the market-implied λ is now BLENDED into the
// model (grounded but autonomous), so model probabilities DO respond to market
// input. The old "market never changes the model" contract is intentionally
// retired. Here we assert the new contract: both paths produce valid
// projections, and a market that differs from the Elo-only read shifts λ/probs
// toward the market (grounded), while the no-market path remains Elo-only.
test("CORE: model is GROUNDED — market input shifts λ/probs (blend active)", () => {
  const m = mexVsSouthAfricaMatch();
  const outNoMarket = runSoccerAutoModelV1({ eloTable, match: m, oddsRows: [], splitsStatus: emptySplits(), reconciliation: "BDL_ONLY" });
  const outWithMarket = runSoccerAutoModelV1({ eloTable, match: m, oddsRows: mkOdds(), splitsStatus: emptySplits(), reconciliation: "MATCHED" });
  // No-market path is a valid Elo-only projection (autonomous when no market).
  assert(outNoMarket.lambdaHome > 0 && outNoMarket.marketProbs.match_result.home > 0, "no-market Elo-only path valid");
  // With-market path is a valid grounded projection.
  assert(outWithMarket.lambdaHome > 0 && outWithMarket.marketProbs.match_result.home > 0, "with-market blended path valid");
  // The blend is ACTIVE: with a real market present, λ is no longer identical
  // to the pure-Elo read (the market pulled it). If they were identical the
  // 60/40 market blend would not be wired.
  assert(
    !close(outNoMarket.lambdaHome, outWithMarket.lambdaHome) ||
      !close(outNoMarket.lambdaAway, outWithMarket.lambdaAway),
    "market input must shift λ (grounded blend active)",
  );
});

test("CORE: market cannot flip the model pick (pick = argmax model_p)", () => {
  const m = mexVsSouthAfricaMatch();
  const out = runSoccerAutoModelV1({ eloTable, match: m, oddsRows: mkOdds(), splitsStatus: emptySplits(), reconciliation: "MATCHED" });
  for (const dec of out.perMarket) {
    const mr = out.marketProbs.match_result;
    if (dec.market === "match_result") {
      const argmax = mr.home > mr.draw && mr.home > mr.away ? "home" : mr.draw > mr.away ? "draw" : "away";
      assert(dec.pick === argmax, `match_result pick must be argmax model_p; got ${dec.pick}, argmax=${argmax}`);
    }
  }
});

test("CORE: DC pick chosen from DC probabilities, derived from match_result", () => {
  const m = mexVsSouthAfricaMatch();
  const out = runSoccerAutoModelV1({ eloTable, match: m, oddsRows: mkOdds(), splitsStatus: emptySplits(), reconciliation: "MATCHED" });
  const mr = out.marketProbs.match_result;
  const dc = out.marketProbs.double_chance;
  assert(close(dc.home_or_draw, mr.home + mr.draw));
  assert(close(dc.away_or_draw, mr.away + mr.draw));
  assert(close(dc.home_or_away, mr.home + mr.away));
});

test("LOCK: Best Angle cannot emit under external_priors_only", () => {
  const m = mexVsSouthAfricaMatch();
  const out = runSoccerAutoModelV1({ eloTable, match: m, oddsRows: mkOdds(), splitsStatus: emptySplits(), reconciliation: "MATCHED" });
  for (const dec of out.perMarket) {
    assert(dec.grade.best_angle === false, `Best Angle must be false at launch (market=${dec.market})`);
    assert(dec.grade.grade !== "Best Angle", `Grade must not be Best Angle at launch (market=${dec.market}, got ${dec.grade.grade})`);
  }
});

test("LOCK: pre-calibration whitelist holds match_result + DC (regardless of which valid hold code fires)", () => {
  const m = mexVsSouthAfricaMatch();
  const out = runSoccerAutoModelV1({
    eloTable, match: m, oddsRows: mkOdds(), splitsStatus: emptySplits(), reconciliation: "MATCHED",
    preCalibrationPublishWhitelist: ["total", "btts"],
  });
  const mr = out.perMarket.find((d) => d.market === "match_result");
  const dc = out.perMarket.find((d) => d.market === "double_chance");
  const t = out.perMarket.find((d) => d.market === "total");
  const b = out.perMarket.find((d) => d.market === "btts");
  // match_result + DC must be held under launch whitelist. The specific
  // hold code may be AWAITING_IN_TOURNAMENT_CALIBRATION, or it may be
  // a stricter hold (FAR_FROM_MARKET_NO_CALIBRATION, etc.) that fires
  // earlier in the deriveHold cascade. Either way, the contract test is
  // "the market is held when the whitelist excludes it."
  assert(mr?.hold.hold === true, `match_result must be held under whitelist (got hold=${JSON.stringify(mr?.hold)})`);
  assert(dc?.hold.hold === true, `DC must be held under whitelist (got hold=${JSON.stringify(dc?.hold)})`);
  // total + btts can still be held by other valid reasons (e.g., push
  // risk or far-from-market), but at minimum they aren't held by the
  // whitelist code AWAITING_IN_TOURNAMENT_CALIBRATION.
  if (t?.hold.hold) assert(t.hold.code !== "AWAITING_IN_TOURNAMENT_CALIBRATION", "total never held by whitelist when whitelisted");
  if (b?.hold.hold) assert(b.hold.code !== "AWAITING_IN_TOURNAMENT_CALIBRATION", "btts never held by whitelist when whitelisted");
});

test("PROVENANCE: snapshot contains all required fields", () => {
  const m = mexVsSouthAfricaMatch();
  const out = runSoccerAutoModelV1({ eloTable, match: m, oddsRows: mkOdds(), splitsStatus: emptySplits(), reconciliation: "MATCHED" });
  for (const dec of out.perMarket) {
    const s = dec.snapshot;
    assert(s.model_version === "soccer_dixon_coles_v1");
    assert(s.calibration_version === "external_priors_v1");
    assert(s.calibration_source.startsWith("wc_aggregate"));
    assert(s.calibration_evidence_level === "external_priors_only");
    assert(s.regulation_window === "regulation_90");
    assert(typeof s.locked_at === "string" && s.locked_at.length > 10);
    assert(s.model.elo_snapshot.team_count > 0);
    assert((s.model.team_strength.home?.elo ?? 0) > 0 && (s.model.team_strength.away?.elo ?? 0) > 0);
    assert(s.model.lambda_home > 0 && s.model.lambda_away > 0);
    assert(s.model.raw_probabilities.match_result.home > 0);
    assert(s.model.raw_probabilities.btts.yes > 0);
    assert(s.market.bdl_input_count >= 0 && s.market.sharpapi_input_count >= 0);
    assert(s.splits.classification === "SPLITS_ENDPOINT_EXISTS_EMPTY");
    assert(s.decision.market === dec.market);
    assert(typeof s.decision.confidence === "number");
    assert(typeof s.decision.no_bet === "boolean");
  }
});

test("HOST: Mexico at Estadio Azteca gets host + altitude bonus on home λ", () => {
  const m = mexVsSouthAfricaMatch();
  const outNoVenue = runSoccerAutoModelV1({ eloTable, match: m, oddsRows: [], splitsStatus: emptySplits(), reconciliation: "BDL_ONLY", venueAltitudeMeters: null });
  const outAltitude = runSoccerAutoModelV1({ eloTable, match: m, oddsRows: [], splitsStatus: emptySplits(), reconciliation: "BDL_ONLY", venueAltitudeMeters: 2240 });
  assert(outAltitude.lambdaHome > outNoVenue.lambdaHome, "altitude bonus must raise home λ");
});

test("MISSING STRENGTH: fixture is held with reason when a team is missing from Elo", () => {
  const m: NormalizedBdlMatch = { ...mexVsSouthAfricaMatch(), home_team_name: "Nowhereia", home_team_country_code: "XXX" };
  const out = runSoccerAutoModelV1({ eloTable, match: m, oddsRows: [], splitsStatus: emptySplits(), reconciliation: "BDL_ONLY" });
  assert(out.fixtureHoldReason !== null, "fixture must be held when team missing");
  assert(out.perMarket.length === 0, "no per-market decisions emitted on hold");
});

test("MISSING ODDS: market held with MARKET_ODDS_MISSING when no rows for that market", () => {
  const m = mexVsSouthAfricaMatch();
  const out = runSoccerAutoModelV1({ eloTable, match: m, oddsRows: [], splitsStatus: emptySplits(), reconciliation: "BDL_ONLY" });
  for (const dec of out.perMarket) {
    assert(dec.hold.hold === true && dec.hold.code === "MARKET_ODDS_MISSING", `${dec.market} should be held when odds missing`);
  }
});

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("❌ auto-model-v1 tests FAILED"); process.exit(1); }
console.log(`✅ All ${pass} tests passed.`);
