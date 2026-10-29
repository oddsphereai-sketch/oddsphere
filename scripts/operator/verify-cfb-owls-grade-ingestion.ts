/** One provider bundle, one authoritative PMF per game, zero-write comparison. */
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { runCfbForwardEvidenceWriter } from "../../lib/services/football/cfbForwardEvidenceWriter";
import { OpenWeatherProvider } from "../../lib/providers/real_api/OpenWeatherProvider";
import type { CfbV1DecisionBundle, CfbV1ExactPriceDecision } from "../../lib/services/football/cfbV1Decision";
import type { CfbForwardEvidencePayload } from "../../lib/services/football/cfbForwardEvidence";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bdl = process.env.BALLDONTLIE_API_KEY, owls = process.env.OWLS_INSIGHT_API_KEY;
  const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
  if (!url || !key || !bdl || !owls || !output) throw Error("Configured read/provider credentials and explicit --output are required");
  const comparisons: Array<{ providerGameId: string; before: CfbV1DecisionBundle; after: CfbV1DecisionBundle }> = [];
  let focus: CfbForwardEvidencePayload | undefined;
  let coverage: unknown;
  const now = new Date().toISOString();
  const result = await runCfbForwardEvidenceWriter({
    client: createClient(url, key, { auth: { persistSession: false } }), season: 2026,
    runId: `audit-${randomUUID()}`, now, apply: false, balldontlieApiKey: bdl,
    playbookApiKey: process.env.PLAYBOOK_API_KEY ?? "audit-provider-unavailable", owlsApiKey: owls,
    collegeFootballDataApiKey: process.env.CFBD_API_KEY ?? null,
    theOddsApiKey: process.env.THE_ODDS_API_KEY ?? null,
    sportsDataIoApiKey: process.env.SPORTSDATAIO_CFB_API_KEY ?? null,
    weatherProvider: process.env.OPENWEATHER_API_KEY ? new OpenWeatherProvider(process.env.OPENWEATHER_API_KEY) : null,
    auditForceUnlocked: true,
    auditOwlsGradeComparison: value => comparisons.push(value),
    auditPayloads: payloads => {
      focus = payloads.find(payload => payload.game.providerGameId === "458441");
      coverage = {
        gamesWithOwlsGradeBooks: payloads.filter(payload => payload.market.supplementalGradingBooks?.length).length,
        distinctBooks: [...new Set(payloads.flatMap(payload => payload.market.supplementalGradingBooks?.map(book => book.sportsbook) ?? []))].sort(),
        maxBooksPerGame: Math.max(0, ...payloads.map(payload => payload.market.supplementalGradingBooks?.length ?? 0)),
        maxAddedEvidenceBytes: Math.max(0, ...payloads.map(payload => Buffer.byteLength(JSON.stringify(payload.market.supplementalGradingBooks ?? [])))),
      };
    },
  });
  if (!comparisons.length) throw Error("No same-input comparisons generated");
  const grades = (bundles: CfbV1DecisionBundle[]) => Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play", "Held"].map(grade => [grade,
    bundles.reduce((sum, bundle) => sum + (grade === "Held" ? bundle.heldMarkets.length : bundle.evaluatedBets.filter(decision => decision.grade === grade).length), 0)]));
  const economics = (decision: CfbV1ExactPriceDecision) => JSON.stringify({ side: decision.side, grade: decision.grade,
    probability: decision.modelProbability, push: decision.pushProbability, quote: decision.evaluatedQuote,
    expectedValue: decision.expectedValue, fair: decision.marketFairProbability, edge: decision.edgePercentagePoints });
  const actionable = (decision: CfbV1ExactPriceDecision | undefined) => decision?.grade === "Lean" || decision?.grade === "Best Angle";
  let promotions = 0, demotions = 0, preserved = 0;
  const recoveries: unknown[] = [];
  for (const comparison of comparisons) {
    if (createHash("sha256").update(JSON.stringify(comparison.before.forecast)).digest("hex") !== createHash("sha256").update(JSON.stringify(comparison.after.forecast)).digest("hex")) throw Error("Forecast changed between ingestion lanes");
    for (const market of ["moneyline", "spread", "total"] as const) {
      const old = comparison.before.evaluatedBets.find(decision => decision.market === market);
      const next = comparison.after.evaluatedBets.find(decision => decision.market === market);
      if (old) {
        if (!next || economics(old) !== economics(next)) throw Error(`Incumbent ${comparison.providerGameId}:${market} changed`);
        preserved++;
      }
      if (!actionable(old) && actionable(next)) promotions++;
      if (actionable(old) && !actionable(next)) demotions++;
      if (!old && next) {
        const held = comparison.before.heldMarkets.find(value => value.market === market);
        if (!held?.reasonCodes?.some(reason => ["target_excluded_same_line_consensus_insufficient", "named_target_quote_unavailable", "quote_stale_at_evaluation", "quote_observed_after_evaluation"].includes(reason))) throw Error("Recovered a non-comparison health hold");
        recoveries.push({ event: comparison.providerGameId, market, side: next.side, grade: next.grade,
          modelProbability: next.modelProbability, expectedValue: next.expectedValue, quote: next.evaluatedQuote,
          context: next.consensus, gradeReasons: next.gradeAdjustment?.reasonCodes ?? [] });
      }
    }
  }
  if (demotions) throw Error("Unexpected actionable demotion");
  const report = { audit: "cfb_owls_ingestion_same_runtime_rollout_2026_10_29_r1", now, apply: false, writes: 0,
    games: comparisons.length, before: grades(comparisons.map(value => value.before)), after: grades(comparisons.map(value => value.after)),
    forecastChanges: 0, preservedExistingMarkets: preserved, promotions, demotions, netActionables: promotions - demotions,
    coverage,
    captureFailureComparisons: result.captureFailures.map(failure => {
      const comparison = comparisons.find(value => value.providerGameId === failure.providerGameId);
      return { ...failure, baselineAndCandidateForecastsIdentical: Boolean(comparison &&
        JSON.stringify(comparison.before.forecast) === JSON.stringify(comparison.after.forecast)) };
    }),
    recoveries, focus: focus ? { capturedAt: focus.capturedAt, held: focus.decisions.heldMarkets,
      prices: [...focus.market.currentBooks, ...(focus.market.supplementalGradingBooks ?? [])].map(book => ({ providerGameId: book.providerGameId, sportsbook: book.sportsbook, observedAt: book.marketObservedAt?.spread ?? book.observedAt, spread: book.spread })),
      decisions: focus.decisions.evaluatedBets.map(decision => ({ market: decision.market, grade: decision.grade, quote: decision.evaluatedQuote, context: decision.consensus })) } : null,
    writerResult: result,
    limitations: ["Same-input current-board correctness rehearsal, not historical profitability qualification.",
      "Ingestion-only repair; exact-line minimum-book count and all production grade caps remain unchanged.",
      "Missing local Playbook credential may produce a provider error; retained stored evidence is reported by the sole writer."] };
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
