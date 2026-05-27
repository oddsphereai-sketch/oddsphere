/**
 * Pre-refactor regression anchor for `deriveMarketSignalsForSlate`.
 *
 * Fix 2.1 (Gap-9) refactors marketSignalDerivationService internally to
 * share tier-classification helpers with the new signalEvidenceClassifier
 * module. The structural refactor must NOT alter the per-pick verdicts
 * persisted to the database — Layer 3 is the permissive market-detection
 * layer, and its output is consumed by the grade engine, written to DB
 * columns, and surfaced to members.
 *
 * This test pins the seed-slate verdicts captured BEFORE the refactor
 * began. If any verdict drifts post-refactor, this test fires with a
 * specific (game, market, expected, actual) diff and the commit blocks
 * until the cause is identified.
 *
 *   "When framework and code conflict, the framework is correct and the
 *    code must be updated." — SHARP_SIGNAL_FRAMEWORK.md
 *
 * That principle applies to behavioral changes. Structural refactors
 * are zero-drift by contract. This file is that contract.
 *
 * STABLE IDENTITY DESIGN
 *   Prediction-row ids (game_predictions.id, prop_predictions.id) are NOT
 *   stable across reseeds — other test suites (test-admin-upload, etc.)
 *   may delete-and-recreate rows, causing the integer ids to drift even
 *   when the underlying game data is unchanged. The original capture used
 *   prediction-ids and failed under this churn.
 *
 *   The current design keys per-game verdicts by `games.external_id` (the
 *   TheOdds API identifier — stable across reseeds) + market.
 *
 *   For props the seed slate's full set is market_neutral with no further
 *   information content; the test asserts "all derived props are
 *   market_neutral, count > 0" rather than pinning individual prop rows.
 *   When the seed introduces a non-trivial prop signal, recapture with
 *   richer per-(external_id, player_id, prop_market) assertions.
 *
 * Captured: 2026-05-26 against marketSignalDerivationService at commit
 * 788a88a (post Fix 1.3). 12 MLB games on seed slate 2026-05-22:
 *   ML:    1 steam_alert + 1 market_confirmed + 10 market_neutral
 *   OU:    2 market_resistance + 10 market_neutral
 *   NRFI:  12 market_neutral
 *   Props: 39 market_neutral
 *
 * Run with: npm run test:derive-market-signal-regression
 */

import { deriveMarketSignalsForSlate } from "../lib/services/marketSignalDerivationService";
import { supabase } from "../lib/db/supabase";

/**
 * Expected per-game verdicts keyed by games.external_id. Captured from the
 * V1 MLB seed slate (2026-05-22) at commit 788a88a. Stable identity rule:
 * external_id is the TheOdds API game identifier and stays constant across
 * reseeds; integer game.id may drift.
 */
const EXPECTED_GAMES: Array<{
  external_id: number;
  awayHome: string;
  ml: string;
  ou: string;
  nrfi: string;
}> = [
  { external_id: 18599100, awayHome: "BOS @ NYY", ml: "market_neutral", ou: "market_neutral", nrfi: "market_neutral" },
  { external_id: 18599101, awayHome: "BAL @ TB", ml: "market_neutral", ou: "market_neutral", nrfi: "market_neutral" },
  { external_id: 18599102, awayHome: "DET @ TOR", ml: "market_neutral", ou: "market_neutral", nrfi: "market_neutral" },
  { external_id: 18599103, awayHome: "CLE @ CWS", ml: "market_neutral", ou: "market_neutral", nrfi: "market_neutral" },
  { external_id: 18599104, awayHome: "MIN @ KC", ml: "market_neutral", ou: "market_neutral", nrfi: "market_neutral" },
  { external_id: 18599105, awayHome: "SEA @ HOU", ml: "steam_alert", ou: "market_neutral", nrfi: "market_neutral" },
  { external_id: 18599106, awayHome: "LAA @ TEX", ml: "market_neutral", ou: "market_neutral", nrfi: "market_neutral" },
  { external_id: 18599107, awayHome: "WSH @ ATL", ml: "market_neutral", ou: "market_resistance", nrfi: "market_neutral" },
  { external_id: 18599108, awayHome: "NYM @ PHI", ml: "market_confirmed", ou: "market_neutral", nrfi: "market_neutral" },
  { external_id: 18599109, awayHome: "MIL @ CHC", ml: "market_neutral", ou: "market_resistance", nrfi: "market_neutral" },
  { external_id: 18599110, awayHome: "CIN @ STL", ml: "market_neutral", ou: "market_neutral", nrfi: "market_neutral" },
  { external_id: 18599111, awayHome: "SD @ LAD", ml: "market_neutral", ou: "market_neutral", nrfi: "market_neutral" },
];

/**
 * Expected aggregate stats for the prop_predictions side. Pinning a count
 * (39 props, all market_neutral) is sufficient — the seed slate has no
 * non-neutral prop signals, so per-prop assertions don't add information.
 * Drift here means either props got new signal shapes or deriveMarketSignal
 * started firing on props. Either is worth catching.
 */
const EXPECTED_PROPS_COUNT = 39;
const EXPECTED_PROPS_VERDICT = "market_neutral";

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

async function main() {
  console.log(
    "Loading seed slate (mlb / 2026-05-22) and re-running deriveMarketSignalsForSlate..."
  );

  // Pull external_id mapping so we can compare verdicts by stable identity.
  const { data: gamesRaw } = await supabase
    .from("games")
    .select("id, external_id")
    .eq("sport", "mlb")
    .eq("slate_date", "2026-05-22");
  const games = (gamesRaw ?? []) as Array<{ id: number; external_id: number }>;
  const externalByPredictionId = new Map<number, number>();

  const { data: gamePredsRaw } = await supabase
    .from("game_predictions")
    .select("id, game_id")
    .in("game_id", games.map((g) => g.id));
  const gameIdToExternal = new Map<number, number>(
    games.map((g) => [g.id, g.external_id])
  );
  for (const p of (gamePredsRaw ?? []) as Array<{
    id: number;
    game_id: number;
  }>) {
    const ext = gameIdToExternal.get(p.game_id);
    if (ext !== undefined) externalByPredictionId.set(p.id, ext);
  }

  const slate = await deriveMarketSignalsForSlate("mlb", "2026-05-22");

  section("games — per-(external_id, market) verdicts");
  check(
    `games.ml.size === EXPECTED_GAMES.length (${EXPECTED_GAMES.length})`,
    slate.games.ml.size === EXPECTED_GAMES.length,
    `actual=${slate.games.ml.size}`
  );
  check(
    `games.ou.size === EXPECTED_GAMES.length`,
    slate.games.ou.size === EXPECTED_GAMES.length,
    `actual=${slate.games.ou.size}`
  );
  check(
    `games.nrfi.size === EXPECTED_GAMES.length`,
    slate.games.nrfi.size === EXPECTED_GAMES.length,
    `actual=${slate.games.nrfi.size}`
  );

  // For each expected game, find the prediction.id with matching external_id
  // and check each market's verdict against the snapshot.
  let mlDrift = 0;
  let ouDrift = 0;
  let nrfiDrift = 0;
  for (const expected of EXPECTED_GAMES) {
    const matchingPredIds = Array.from(externalByPredictionId.entries())
      .filter(([, ext]) => ext === expected.external_id)
      .map(([id]) => id);
    if (matchingPredIds.length === 0) {
      // No prediction row for this game — count as drift across all markets.
      mlDrift++;
      ouDrift++;
      nrfiDrift++;
      failures.push(
        `  ✗ external_id=${expected.external_id} (${expected.awayHome}): no game_predictions row found`
      );
      continue;
    }
    // The slate has exactly one game_prediction per game (UNIQUE constraint),
    // so matchingPredIds is a singleton. Use the first.
    const predId = matchingPredIds[0]!;
    const actualMl = slate.games.ml.get(predId);
    const actualOu = slate.games.ou.get(predId);
    const actualNrfi = slate.games.nrfi.get(predId);
    if (actualMl !== expected.ml) {
      mlDrift++;
      failures.push(
        `  ✗ ML[${expected.awayHome}]: expected "${expected.ml}", got "${actualMl ?? "MISSING"}"`
      );
    }
    if (actualOu !== expected.ou) {
      ouDrift++;
      failures.push(
        `  ✗ OU[${expected.awayHome}]: expected "${expected.ou}", got "${actualOu ?? "MISSING"}"`
      );
    }
    if (actualNrfi !== expected.nrfi) {
      nrfiDrift++;
      failures.push(
        `  ✗ NRFI[${expected.awayHome}]: expected "${expected.nrfi}", got "${actualNrfi ?? "MISSING"}"`
      );
    }
  }
  check(
    `every ML verdict matches pre-refactor snapshot (12 games)`,
    mlDrift === 0,
    mlDrift > 0 ? `${mlDrift} drift(s)` : undefined
  );
  check(
    `every OU verdict matches pre-refactor snapshot (12 games — includes WSH @ ATL + MIL @ CHC market_resistance)`,
    ouDrift === 0,
    ouDrift > 0 ? `${ouDrift} drift(s)` : undefined
  );
  check(
    `every NRFI verdict matches pre-refactor snapshot (12 games)`,
    nrfiDrift === 0,
    nrfiDrift > 0 ? `${nrfiDrift} drift(s)` : undefined
  );

  section("props — aggregate count + verdict distribution");
  check(
    `props.size === EXPECTED_PROPS_COUNT (${EXPECTED_PROPS_COUNT})`,
    slate.props.size === EXPECTED_PROPS_COUNT,
    `actual=${slate.props.size}`
  );
  let badProp = 0;
  for (const v of slate.props.values()) {
    if (v !== EXPECTED_PROPS_VERDICT) badProp++;
  }
  check(
    `every prop verdict === "${EXPECTED_PROPS_VERDICT}" (seed slate has no non-neutral prop signals)`,
    badProp === 0,
    badProp > 0 ? `${badProp} non-neutral` : undefined
  );

  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    console.log(
      "\nDRIFT DETECTED. deriveMarketSignalsForSlate output changed from the\n" +
        "pre-refactor snapshot captured at commit 788a88a. If the change is\n" +
        "INTENTIONAL (e.g., Gap-8 sharp_money_divergence signal added), recapture\n" +
        "the snapshot via a one-shot diagnostic and update this file. NEVER\n" +
        "loosen the assertions to match post-change code without an explicit\n" +
        "behavioral-change commit."
    );
    process.exit(1);
  }
  console.log(
    `\n✅ deriveMarketSignalsForSlate output matches pre-refactor snapshot — zero drift.`
  );
}

main().catch((e) => {
  console.error(
    "\n❌ test-derive-market-signal-regression crashed:",
    (e as Error).message
  );
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
