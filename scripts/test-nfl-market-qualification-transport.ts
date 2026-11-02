import assert from "node:assert/strict";
import { buildNflMarketQualification, nflMarketQualificationMatches } from "@/lib/services/football/nflMarketQualification";
import { getNflV1WeekOneOutcomeForecast } from "@/lib/services/football/nflV1WeekOneOutcome";

const forecast = getNflV1WeekOneOutcomeForecast({ providerGameId: "1392224", awayTeam: "CLE", homeTeam: "JAX" });
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)])) : value;
const transported = JSON.parse(JSON.stringify(sorted(forecast))) as typeof forecast;
for (const market of ["moneyline", "spread", "total"] as const) {
  const args = { market, providerGameId: forecast.providerGameId, evaluatedAt: "2026-11-01T12:00:00.000Z",
    gameStartsAt: "2026-11-01T18:00:00.000Z", forecast };
  const receipt = buildNflMarketQualification({ ...args, basis: "source_bound_joint_innovation",
    independentInputPolicy: "market_inputs_prohibited", sourceMarketId: `${forecast.providerGameId}:${market}`,
    sourceReceipt: "exact-source-episode", evidenceQualified: true });
  assert.ok(nflMarketQualificationMatches({ ...args, receipt, forecast: transported }),
    "JSON/database key reordering cannot invalidate the identical qualified law");
  assert.equal(buildNflMarketQualification({ ...args, forecast: transported, basis: receipt.basis,
    independentInputPolicy: "market_inputs_prohibited", sourceMarketId: receipt.sourceMarketId,
    sourceReceipt: receipt.sourceReceipt, evidenceQualified: true }).forecastSha256, receipt.forecastSha256);
  assert.equal(nflMarketQualificationMatches({ ...args, receipt,
    forecast: { ...transported, expectedHomeScore: transported.expectedHomeScore + .01 } }), false);
  assert.equal(nflMarketQualificationMatches({ ...args, receipt: { ...receipt, market: market === "total" ? "moneyline" : "total" } }), false);
}
console.log("NFL qualified-law transport: exact numeric law survives JSON key order; changed score/market remains rejected");
