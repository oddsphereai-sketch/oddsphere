/**
 * Push 4 — tests for the legacy tracking CSV parser.
 *
 * Pure / fixture-only — uses inline CSV strings, no FS, no DB.
 */

import {
  parseTrackingBaselineCsv,
  __TEST__ as helpers,
} from "../lib/services/trackingBaselineImport";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── parseTally ─────────────────────────────────────────────────────
console.log("━━━ parseTally ━━━");
check('"1705/3027" → wins=1705 total=3027', JSON.stringify(helpers.parseTally("1705/3027")) === '{"wins":1705,"total":3027}');
check('"  181/284  " (whitespace) → ok', JSON.stringify(helpers.parseTally("  181/284  ")) === '{"wins":181,"total":284}');
check('"" → null', helpers.parseTally("") === null);
check('"abc" → null', helpers.parseTally("abc") === null);
check('"5/3" (wins > total) → null', helpers.parseTally("5/3") === null);
check('"100" (no slash) → null', helpers.parseTally("100") === null);

// ── parsePct ───────────────────────────────────────────────────────
console.log("\n━━━ parsePct ━━━");
check('"63.7%" → 63.7', helpers.parsePct("63.7%") === 63.7);
check('"56.3%" → 56.3', helpers.parsePct("56.3%") === 56.3);
check('"100%" → 100', helpers.parsePct("100%") === 100);
check('"54.4 %" (space) → 54.4', helpers.parsePct("54.4 %") === 54.4);
check('"" → null', helpers.parsePct("") === null);

// ── normalizeLabel ─────────────────────────────────────────────────
console.log("\n━━━ normalizeLabel (strip trailing emoji) ━━━");
check('"MLB (ML) ⚾" → "MLB (ML)"', helpers.normalizeLabel("MLB (ML) ⚾") === "MLB (ML)");
check('"NFL (O/U) 🏈" → "NFL (O/U)"', helpers.normalizeLabel("NFL (O/U) 🏈") === "NFL (O/U)");
check('"UCL (Double Chance) ⚽" → "UCL (Double Chance)"', helpers.normalizeLabel("UCL (Double Chance) ⚽") === "UCL (Double Chance)");

// ── full parse with launch fixtures ────────────────────────────────
console.log("\n━━━ Full CSV parse — launch CSV ━━━");
const csv = `Model Tracking,Lifetime Tally,Lifetime %,Current Season,Weekly Tally,%
NFL (ML) 🏈,181/284,63.7%,,,
NFL (O/U) 🏈,155/285,54.4%,,,
CFB (ML) 🏈,708/923,76.7%,,,
CFB (O/U) 🏈,493/923,53.4%,,,
NBA (ML) 🏀,1402/2021,69.4%,927/1351,1/4,
NBA (O/U's) 🏀,714/1337,53.4%,714/1337,3/4,
CBB (ML) 🏀,4624/6444,71.8%,3962/5480,,
CBB (O/U's) 🏀,2884/5404,53.4%,2925/5480,,
MLB (ML) ⚾,1705/3027,56.3%,502/949,73/144,
MLB (NRFI/YRFI) ⚾,1392/2480,56.1%,382/729,44/94,
MLB (NRFI*) ⚾,608/1105,55.0%,214/417,21/56,
MLB (YRFI*) ⚾,472/831,56.8%,168/312,23/38,
MLB (O/U*) ⚾,1270/2332,54.5%,498/949,66/144,
UCL (ML) ⚽,100/174,57.5%,5/8,,
UCL (Double Chance) ⚽,129/174,74.1%,6/8,,
NHL (ML) 🏒,32/62,51.6%,32/62,4/5,
NHL (O/U) 🏒,34/62,54.8%,34/62,1/5,`;
const { rows, errors } = parseTrackingBaselineCsv(csv, "fixture.csv");
check("17 rows parsed", rows.length === 17, `got ${rows.length}`);
check("0 errors", errors.length === 0, `got ${errors.length}: ${JSON.stringify(errors.slice(0, 2))}`);

// Spot-check specific rows
const mlbMl = rows.find((r) => r.sport === "mlb" && r.market === "moneyline");
check("MLB ML found", mlbMl !== undefined);
check("MLB ML lifetime 1705/3027 (56.3%)", mlbMl !== undefined && mlbMl.lifetime_wins === 1705 && mlbMl.lifetime_total === 3027 && mlbMl.lifetime_pct === 56.3);
check("MLB ML current season 502/949", mlbMl !== undefined && mlbMl.current_season_wins === 502 && mlbMl.current_season_total === 949);
check("MLB ML current season % derived (≈ 52.9%)", mlbMl !== undefined && mlbMl.current_season_pct !== null && Math.abs(mlbMl.current_season_pct - 52.9) < 0.5);
check("MLB ML weekly 73/144", mlbMl !== undefined && mlbMl.weekly_wins === 73 && mlbMl.weekly_total === 144);

const mlbFi = rows.find((r) => r.sport === "mlb" && r.market === "first_inning");
check("MLB first_inning (NRFI/YRFI) found", mlbFi !== undefined);
check("MLB first_inning lifetime 1392/2480 (56.1%)", mlbFi !== undefined && mlbFi.lifetime_wins === 1392 && mlbFi.lifetime_total === 2480);

const mlbNrfi = rows.find((r) => r.sport === "mlb" && r.market === "nrfi");
check("MLB NRFI* found", mlbNrfi !== undefined);
check("MLB NRFI lifetime 608/1105", mlbNrfi !== undefined && mlbNrfi.lifetime_wins === 608 && mlbNrfi.lifetime_total === 1105);

const uclDc = rows.find((r) => r.sport === "ucl" && r.market === "double_chance");
check("UCL Double Chance found", uclDc !== undefined);
check("UCL Double Chance 129/174 (74.1%)", uclDc !== undefined && uclDc.lifetime_wins === 129 && uclDc.lifetime_pct === 74.1);

// NFL has no current season / weekly → confirm null
const nflMl = rows.find((r) => r.sport === "nfl" && r.market === "moneyline");
check("NFL ML current_season is null (blank in CSV)", nflMl !== undefined && nflMl.current_season_wins === null && nflMl.current_season_total === null);
check("NFL ML weekly is null", nflMl !== undefined && nflMl.weekly_wins === null);

// ── error cases ────────────────────────────────────────────────────
console.log("\n━━━ Error handling ━━━");
{
  const bad = `Model Tracking,Lifetime Tally,Lifetime %,Current Season,Weekly Tally,%
UnknownSport (??) 🤷,1/2,50.0%,,,
MLB (ML) ⚾,abc/def,99%,,,`;
  const { errors: badErrors } = parseTrackingBaselineCsv(bad, "fixture.csv");
  check("unknown label → error", badErrors.some((e) => /unknown label/.test(e.reason)));
  check("bad tally → error", badErrors.some((e) => /bad lifetime tally/.test(e.reason)));
}

// ── label mapping coverage ─────────────────────────────────────────
console.log("\n━━━ Label mapping coverage ━━━");
check("17 mappings present", Object.keys(helpers.LABEL_MAP).length === 17);
check("MLB (ML) → mlb/moneyline", helpers.LABEL_MAP["MLB (ML)"]?.sport === "mlb" && helpers.LABEL_MAP["MLB (ML)"]?.market === "moneyline");
check("MLB (NRFI/YRFI) → mlb/first_inning", helpers.LABEL_MAP["MLB (NRFI/YRFI)"]?.market === "first_inning");
check("MLB (NRFI*) → mlb/nrfi", helpers.LABEL_MAP["MLB (NRFI*)"]?.market === "nrfi");
check("MLB (YRFI*) → mlb/yrfi", helpers.LABEL_MAP["MLB (YRFI*)"]?.market === "yrfi");
check("UCL (Double Chance) → ucl/double_chance", helpers.LABEL_MAP["UCL (Double Chance)"]?.market === "double_chance");

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All tracking baseline import tests passed.");
