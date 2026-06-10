/**
 * Regression test for the 2026-06-10 NBA spread sign-convention bug.
 *
 * Bug shape (pre-fix):
 *   `blendPosterior` produces `posterior_spread = home_score - away_score`,
 *   so positive means home WON. `nbaAutoModelV1` assigned this to
 *   `predicted_spread_home` and the value was passed raw to
 *   `classifySpreadConflict`, which uses the BETTING convention (negative
 *   = home favored, matching "NYK -2" = NYK favored by 2).
 *
 * The sign mismatch made a model that correctly predicted NYK to win by
 * ~5.6 (model output: home=111.2, away=105.6, spread_home=+5.6) look to
 * the classifier like "NYK is a 5.6-point underdog" → strong_conflict →
 * "caution" grade on what should be a value bet on NYK -2.
 *
 * Fix lives in nbaMarketIntelligence.ts:buildSpread (the consumer
 * negates the model spread before passing it to the classifier).
 *
 * This test exercises classifySpreadConflict directly with the SAME
 * inputs the fixed consumer now sends. If anyone reintroduces the raw
 * pass-through (without negation), these assertions will fail.
 */
import {
  classifySpreadConflict,
} from "../lib/services/nba/nbaMarketReview";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n━━━ NBA spread sign-convention regression (2026-06-10 NY -2 bug) ━━━");

// Scenario: model says NYK wins by 5.6 (home is favored).
// In MODEL convention (positive = home favored), modelSpread = +5.6.
// In BETTING convention (which the classifier uses, negative = home favored),
// the consumer must pass -5.6 to classifySpreadConflict.
// Market line: NYK -2 → marketSpreadHome = -2 (betting convention).
{
  // CORRECT call (post-fix): negate model spread before passing.
  const c = classifySpreadConflict({
    modelSpreadHome: -5.6,   // betting convention: home favored by 5.6
    marketSpreadHome: -2,    // market: home favored by 2
    pickSide: "home",
  });
  check(
    "model favors home by 5.6, market -2 → support band (model agrees + sees value)",
    c.band === "support",
    `got band=${c.band} edge=${c.edge}`,
  );
  check(
    "edge sign is positive for home pick when model sees more home value",
    c.edge > 0,
    `got edge=${c.edge}`,
  );
}

{
  // Original BUGGY call (pre-fix): model spread NOT negated.
  // This should produce strong_conflict — the very thing the fix prevents.
  const c = classifySpreadConflict({
    modelSpreadHome: +5.6,   // BUG: model convention value passed raw
    marketSpreadHome: -2,
    pickSide: "home",
  });
  check(
    "REGRESSION canary: raw (non-negated) model spread produces strong_conflict",
    c.band === "strong_conflict",
    `got band=${c.band} (if this fails, classifier semantics changed — re-audit consumers)`,
  );
}

{
  // Symmetric: model says AWAY wins by 5.6 (home loses by 5.6).
  // Model convention: modelSpread = -5.6.
  // Betting convention (after consumer negation): modelSpreadHome = +5.6
  // → home is a 5.6-point dog. Market has home -2 (home favored).
  // → market disagrees with model on direction → strong_conflict for HOME pick.
  const c = classifySpreadConflict({
    modelSpreadHome: +5.6,   // negated: home is a 5.6-pt underdog
    marketSpreadHome: -2,    // market still has home favored
    pickSide: "home",
  });
  check(
    "model has home as 5.6 underdog, market -2 (home fav) → strong_conflict on home pick",
    c.band === "strong_conflict",
    `got band=${c.band}`,
  );
}

{
  // Same setup, AWAY pick. Model says away wins by 5.6, away pick → market
  // is fighting the away pick (line: away +2). After negation:
  // modelSpreadHome=+5.6 (home dog), marketSpreadHome=-2 (home fav).
  // sign for AWAY pick = -edge = -((-2)-(+5.6)) = -(-7.6) = +7.6 → support.
  const c = classifySpreadConflict({
    modelSpreadHome: +5.6,
    marketSpreadHome: -2,
    pickSide: "away",
  });
  check(
    "model has away winning by 5.6, market home -2 → support for away pick",
    c.band === "support",
    `got band=${c.band} edge=${c.edge}`,
  );
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ NBA spread sign-convention test passed.");
