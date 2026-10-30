/** Zero-write, same-runtime comparison for the CFB paired-price fallback. */
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { OpenWeatherProvider } from "../../lib/providers/real_api/OpenWeatherProvider";
import type { CfbForwardEvidencePayload } from "../../lib/services/football/cfbForwardEvidence";
import { runCfbForwardEvidenceWriter } from "../../lib/services/football/cfbForwardEvidenceWriter";
import type { CfbV1DecisionBundle, CfbV1ExactPriceDecision } from "../../lib/services/football/cfbV1Decision";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bdl = process.env.BALLDONTLIE_API_KEY;
  const owls = process.env.OWLS_INSIGHT_API_KEY;
  const output = process.argv.find((argument) => argument.startsWith("--output="))?.slice(9);
  if (!url || !key || !bdl || !owls || !output) {
    throw new Error("Configured read/provider credentials and explicit --output are required.");
  }

  const comparisons: Array<{ providerGameId: string; before: CfbV1DecisionBundle; after: CfbV1DecisionBundle }> = [];
  const payloads: CfbForwardEvidencePayload[] = [];
  const now = new Date().toISOString();
  const result = await runCfbForwardEvidenceWriter({
    client: createClient(url, key, { auth: { persistSession: false } }),
    season: 2026,
    runId: `audit-${randomUUID()}`,
    now,
    apply: false,
    balldontlieApiKey: bdl,
    playbookApiKey: process.env.PLAYBOOK_API_KEY ?? "audit-provider-unavailable",
    owlsApiKey: owls,
    collegeFootballDataApiKey: process.env.CFBD_API_KEY ?? null,
    theOddsApiKey: process.env.THE_ODDS_API_KEY ?? null,
    sportsDataIoApiKey: process.env.SPORTSDATAIO_CFB_API_KEY ?? null,
    weatherProvider: process.env.OPENWEATHER_API_KEY ? new OpenWeatherProvider(process.env.OPENWEATHER_API_KEY) : null,
    auditForceUnlocked: true,
    auditPriceContextComparison: (comparison) => comparisons.push(comparison),
    auditPayloads: (captured) => payloads.push(...captured),
  });
  if (!comparisons.length) throw new Error("No same-input comparisons generated.");

  const grades = (bundles: CfbV1DecisionBundle[]) => Object.fromEntries(
    ["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map((grade) => [
      grade,
      bundles.reduce((sum, bundle) => sum + (grade === "Held"
        ? bundle.heldMarkets.length
        : bundle.evaluatedBets.filter((decision) => decision.grade === grade).length), 0),
    ]),
  );
  const economics = (decision: CfbV1ExactPriceDecision) => JSON.stringify({
    side: decision.side,
    grade: decision.grade,
    probability: decision.modelProbability,
    push: decision.pushProbability,
    quote: decision.evaluatedQuote,
    expectedValue: decision.expectedValue,
    fair: decision.marketFairProbability,
    edge: decision.edgePercentagePoints,
  });
  const actionable = (decision: CfbV1ExactPriceDecision | undefined) =>
    decision?.grade === "Lean" || decision?.grade === "Best Angle";

  let promotions = 0;
  let demotions = 0;
  let preserved = 0;
  const recoveries: unknown[] = [];
  for (const comparison of comparisons) {
    const beforeForecast = createHash("sha256").update(JSON.stringify(comparison.before.forecast)).digest("hex");
    const afterForecast = createHash("sha256").update(JSON.stringify(comparison.after.forecast)).digest("hex");
    if (beforeForecast !== afterForecast) throw new Error("Forecast changed between price-context policies.");
    for (const market of ["moneyline", "spread", "total"] as const) {
      const oldDecision = comparison.before.evaluatedBets.find((decision) => decision.market === market);
      const newDecision = comparison.after.evaluatedBets.find((decision) => decision.market === market);
      if (oldDecision) {
        if (!newDecision || economics(oldDecision) !== economics(newDecision)) {
          throw new Error(`Incumbent ${comparison.providerGameId}:${market} changed.`);
        }
        preserved += 1;
      }
      if (!actionable(oldDecision) && actionable(newDecision)) promotions += 1;
      if (actionable(oldDecision) && !actionable(newDecision)) demotions += 1;
      if (!oldDecision && newDecision) {
        const held = comparison.before.heldMarkets.find((value) => value.market === market);
        if (!held?.reasonCodes?.includes("target_excluded_same_line_consensus_insufficient")) {
          throw new Error("Recovered a non-comparison health hold.");
        }
        recoveries.push({
          event: comparison.providerGameId,
          market,
          side: newDecision.side,
          grade: newDecision.grade,
          modelProbability: newDecision.modelProbability,
          expectedValue: newDecision.expectedValue,
          quote: newDecision.evaluatedQuote,
          context: newDecision.consensus,
          gradeReasons: newDecision.gradeAdjustment?.reasonCodes ?? [],
        });
      }
    }
  }
  if (demotions > 0) throw new Error("Unexpected actionable demotion.");

  const report = {
    audit: "cfb_price_context_same_runtime_rollout_2026_10_30_r1",
    now,
    apply: false,
    writes: 0,
    providerApiCallUpperBound: result.apiCallsMaximum,
    theOddsApiEnabled: Boolean(process.env.THE_ODDS_API_KEY),
    theOddsApiPaidCalls: process.env.THE_ODDS_API_KEY ? "not_measured_by_this_audit" : 0,
    games: comparisons.length,
    before: grades(comparisons.map((value) => value.before)),
    after: grades(comparisons.map((value) => value.after)),
    forecastChanges: 0,
    preservedExistingMarkets: preserved,
    promotions,
    demotions,
    netActionables: promotions - demotions,
    recoveries,
    payloadCoverage: payloads.map((payload) => ({
      event: payload.game.providerGameId,
      decisions: payload.decisions.evaluatedBets.length,
      held: payload.decisions.heldMarkets.map((market) => ({ market: market.market, reasons: market.reasonCodes })),
    })),
    writerResult: result,
    limitations: [
      "Same-input current-board correctness rehearsal, not historical profitability qualification.",
      "The paired-price fallback changes only markets held solely by the comparison-count rule; all other caps remain.",
      "THE_ODDS_API_KEY may be unset explicitly so this audit consumes no paid Odds API credits.",
    ],
  };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
