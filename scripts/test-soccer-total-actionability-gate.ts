/**
 * Regression guard for the soccer totals actionability gate.
 *
 * The 2026-06-24 replay audit showed soccer totals with model probability
 * below 55% were materially negative ROI, while 55%+ totals were positive.
 * The writer should keep the market read visible but mark those weak total
 * rows no_bet so tracking and play promotion do not treat them as actionable.
 */

import { buildSoccerPredictionRows } from "../lib/services/soccer/soccerPredictionWriter";

let failures = 0;
function check(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.error(`x ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

function marketDecision(market: "total" | "match_result", modelProbabilityPct: number) {
  const pick = market === "total" ? "over" : "home";
  const key = market === "total" ? `${market}|${pick}|2.5` : `${market}|${pick}`;
  return {
    market,
    pick,
    line: market === "total" ? 2.5 : null,
    grade: {
      market,
      selection: pick,
      model_p_pct: modelProbabilityPct,
      confidence: modelProbabilityPct,
      confidence_cap_default: 62,
      confidence_cap_effective: 62,
      confidence_reductions: [],
      grade: "Lean",
      best_angle: false,
      edge_pp: 4,
      model_market_agreement: false,
      miscalibration_flag: false,
      soft_caps_applied: [],
    },
    hold: { hold: false, code: null, reason: null, soft_caps: [] },
    snapshot: {
      calibration_version: "test",
      market: {
        implied_probabilities: { [key]: 0.52 },
        devigged_probabilities: { [key]: 0.51 },
      },
      locked_at: "2026-06-24T12:00:00.000Z",
    },
  };
}

const match = {
  provider_match_id: 12345,
  datetime: "2026-06-24T20:00:00.000Z",
  away_team_abbr: "AAA",
  home_team_abbr: "BBB",
};

const rows = buildSoccerPredictionRows({
  match: match as Parameters<typeof buildSoccerPredictionRows>[0]["match"],
  modelOutput: ({
    bdlMatchId: 12345,
    sharpEventId: "sharp-12345",
    marketProbs: {},
    lambdaHome: 1.2,
    lambdaAway: 1.1,
    perMarket: [
      marketDecision("total", 54.9),
      marketDecision("total", 55),
      marketDecision("match_result", 54.9),
    ],
    fixtureHoldReason: null,
  } as unknown) as Parameters<typeof buildSoccerPredictionRows>[0]["modelOutput"],
});

const weakTotal = rows[0];
const thresholdTotal = rows[1];
const matchResult = rows[2];

check("weak total remains emitted", rows.length, 3);
check("weak total is no_bet", weakTotal.no_bet, true);
check("weak total reason", weakTotal.no_bet_reason, "soccer_total_low_model_probability");
check("weak total is not held", weakTotal.held, false);
check("weak total keeps pick visible", weakTotal.pick, "over");
check(
  "weak total stamps snapshot actionability gate",
  (weakTotal.snapshot_json?.actionability_gate as { rule_id?: string } | undefined)?.rule_id,
  "soccer_total_low_model_probability",
);
check("threshold total remains actionable", thresholdTotal.no_bet, false);
check("non-total below threshold remains actionable", matchResult.no_bet, false);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll soccer total actionability gate assertions passed.");
