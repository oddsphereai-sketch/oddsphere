/**
 * Pure-ish tests for extractMatchResultThreeWayProbs.
 *
 * The helper lives inside buildSoccerDailyEdgeAdapted; the production
 * code calls it on the snapshot_json of a soccer match_result row.
 * We exercise the same logic here by recreating the extractor inline
 * so the test stays pure (no DB import).
 */

export {};

type Probs = { home: number; draw: number; away: number };

function extractMatchResultThreeWayProbs(
  snapshot: Record<string, unknown> | null,
): Probs | null {
  if (snapshot === null) return null;
  const model = (snapshot as { model?: unknown }).model;
  if (model === null || typeof model !== "object") return null;
  const raw = (model as { raw_probabilities?: unknown }).raw_probabilities;
  if (raw === null || typeof raw !== "object") return null;
  const mr = (raw as { match_result?: unknown }).match_result;
  if (mr === null || typeof mr !== "object") return null;
  const home = (mr as { home?: unknown }).home;
  const draw = (mr as { draw?: unknown }).draw;
  const away = (mr as { away?: unknown }).away;
  if (typeof home !== "number" || typeof draw !== "number" || typeof away !== "number") return null;
  return {
    home: Math.max(0, Math.min(1, home)),
    draw: Math.max(0, Math.min(1, draw)),
    away: Math.max(0, Math.min(1, away)),
  };
}

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

async function main() {
  section("happy path — full Dixon-Coles snapshot shape");
  {
    const snap = {
      model: {
        raw_probabilities: {
          match_result: { home: 0.6754, draw: 0.2085, away: 0.1161 },
        },
      },
    };
    const r = extractMatchResultThreeWayProbs(snap);
    check("[WDL] returns probs object", r !== null);
    if (r) {
      check("[WDL] home ≈ 0.675", Math.abs(r.home - 0.6754) < 1e-6);
      check("[WDL] draw ≈ 0.209", Math.abs(r.draw - 0.2085) < 1e-6);
      check("[WDL] away ≈ 0.116", Math.abs(r.away - 0.1161) < 1e-6);
      check("[WDL] sum ≈ 1.0", Math.abs(r.home + r.draw + r.away - 1.0) < 1e-3);
    }
  }

  section("null snapshot → null");
  {
    check("[WDL] returns null when snapshot is null", extractMatchResultThreeWayProbs(null) === null);
  }

  section("missing model branch → null");
  {
    check("[WDL] no model key", extractMatchResultThreeWayProbs({}) === null);
    check("[WDL] model is null", extractMatchResultThreeWayProbs({ model: null }) === null);
    check("[WDL] model is a string", extractMatchResultThreeWayProbs({ model: "oops" }) === null);
  }

  section("missing raw_probabilities → null");
  {
    check("[WDL] no raw_probabilities", extractMatchResultThreeWayProbs({ model: {} }) === null);
    check(
      "[WDL] raw_probabilities is null",
      extractMatchResultThreeWayProbs({ model: { raw_probabilities: null } }) === null,
    );
  }

  section("missing match_result key → null");
  {
    const r = extractMatchResultThreeWayProbs({ model: { raw_probabilities: {} } });
    check("[WDL] no match_result", r === null);
  }

  section("partial probs (missing a key) → null (no fabrication)");
  {
    const r = extractMatchResultThreeWayProbs({
      model: { raw_probabilities: { match_result: { home: 0.5, draw: 0.3 } } },
    });
    check("[WDL] missing away → null", r === null);
  }

  section("wrong types → null");
  {
    const r = extractMatchResultThreeWayProbs({
      model: { raw_probabilities: { match_result: { home: "0.5", draw: 0.3, away: 0.2 } } },
    });
    check("[WDL] string instead of number → null", r === null);
  }

  section("clamp defensively to [0,1] if snapshot writes out-of-range");
  {
    const r = extractMatchResultThreeWayProbs({
      model: { raw_probabilities: { match_result: { home: 1.05, draw: -0.01, away: 0.5 } } },
    });
    if (r) {
      check("[WDL] home clamped to 1.0", r.home === 1.0);
      check("[WDL] draw clamped to 0.0", r.draw === 0.0);
      check("[WDL] away passes through", r.away === 0.5);
    } else {
      check("[WDL] clamp returned probs (not null)", false, "extractor should not reject valid number inputs");
    }
  }

  // Summary
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All W/D/L extractor tests passed.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("FATAL:", e); process.exit(1); }
);
