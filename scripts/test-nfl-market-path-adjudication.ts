import assert from "node:assert/strict";
import { readNflMarketPathAdjudication } from "@/lib/services/football/nflMarketPathAdjudication";
import { buildNflIndependentScoreBaseForecast, getNflV1WeekOneOutcomeForecast } from "@/lib/services/football/nflV1WeekOneOutcome";
import type { NflEpisodeHistoryBook } from "@/lib/services/football/nflMoneylineEpisodeTransport";

type Market = "moneyline" | "spread" | "total";
const raw = getNflV1WeekOneOutcomeForecast({ providerGameId: "1392224", awayTeam: "CLE", homeTeam: "JAX" });
const forecast = buildNflIndependentScoreBaseForecast({ baseForecast: raw,
  independentScore: { expectedHomeMargin: 8.9, expectedTotal: 47, marketInputPolicy: "prohibited_from_independent_score" } });
const open = "2026-11-02T12:00:00.000Z";
const mid = "2026-11-02T13:00:00.000Z";
const last = "2026-11-02T14:00:00.000Z";
const evaluatedAt = "2026-11-02T14:30:00.000Z";
const gameStartsAt = "2026-11-02T18:00:00.000Z";
const american = (p: number) => p >= .5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
const quote = (market: Market, at: string, value: number, book = "circa", firstPrice = -110,
  secondPrice = -110): NflEpisodeHistoryBook => ({
  providerGameId: raw.providerGameId, providerEventId: "exact-event", provider: "owls", sportsbook: book,
  observedAt: at, moneyline: market === "moneyline" ? { homePrice: american(value), awayPrice: american(1 - value) } : null,
  spread: market === "spread" ? { homeLine: -value, awayLine: value, homePrice: firstPrice, awayPrice: secondPrice } : null,
  total: market === "total" ? { line: value, overPrice: firstPrice, underPrice: secondPrice } : null,
});
const read = (market: Market, history: NflEpisodeHistoryBook[], book = "circa") =>
  readNflMarketPathAdjudication({ independentForecast: forecast, history, book, market, evaluatedAt, gameStartsAt });

for (const market of ["moneyline", "spread", "total"] as const) {
  const [a, b, peak, c] = market === "moneyline" ? [.5, .55, .7, .6]
    : market === "spread" ? [3, 4, 7, 5] : [45, 46, 49, 47];
  const steadyHistory = [quote(market, open, a!), quote(market, mid, b!), quote(market, last, c!)];
  const buybackHistory = [quote(market, open, a!), quote(market, mid, peak!), quote(market, last, c!)];
  const steady = read(market, steadyHistory);
  const buyback = read(market, buybackHistory);
  assert.equal(steady.pathStatus, "steady");
  assert.equal(steady.sourcePosture, "supports_net");
  assert.equal(steady.netDirection, 1);
  assert.equal(steady.latestEconomicDirection, 1);
  assert.equal(buyback.pathStatus, "partial_buyback");
  assert.equal(buyback.sourcePosture, "resists_net");
  assert.equal(buyback.netDirection, 1);
  assert.equal(buyback.latestEconomicDirection, -1);
  assert.equal(buyback.latestEconomicMoveAt, last);
  assert.equal(buyback.hasUnresolvedAdverseLeg, true);
  assert.ok(buyback.retracementMagnitude > 0);
  assert.ok(Math.abs(buyback.netMagnitude - steady.netMagnitude) < 1e-9,
    `${market}: endpoints still define the same net displacement, while path conviction differs`);
  const full = read(market, [quote(market, open, a!), quote(market, mid, peak!), quote(market, last, a!)]);
  assert.equal(full.pathStatus, "full_buyback");
  assert.equal(full.sourcePosture, "fully_bought_back");
  assert.equal(full.netDirection, null);
  assert.equal(full.latestEconomicDirection, -1);
  const resumed = read(market, [...buybackHistory, quote(market, "2026-11-02T14:15:00.000Z", (c! + peak!) / 2)]);
  assert.equal(resumed.sourcePosture, "supports_net",
    "a later genuine same-direction economic leg resolves the previous contrary leg");
  assert.equal(resumed.hasUnresolvedAdverseLeg, false);
  const held = read(market, [...steadyHistory, quote(market, "2026-11-02T14:15:00.000Z", c!)]);
  assert.equal(held.latestEconomicMoveAt, last, "a held quote refresh cannot fake a new economic move");
  assert.equal(held.currentAt, "2026-11-02T14:15:00.000Z");
  const excluded = readNflMarketPathAdjudication({ independentForecast: forecast,
    history: steadyHistory, book: "circa", market, evaluatedAt, gameStartsAt, excludedFamilies: ["Circa"] });
  assert.equal(excluded.reason, "evaluated_family_excluded");
}
for (const market of ["moneyline", "spread", "total"] as const) {
  const value = market === "moneyline" ? .5 : market === "spread" ? 3 : 45;
  const a = quote(market, open, value);
  const b = quote(market, last, value, "circa", -120, -120);
  if (market === "moneyline") b.moneyline = { homePrice: -120, awayPrice: -120 };
  assert.equal(read(market, [a, b]).pathStatus, "unchanged", `${market}: pure vig is not an economic leg`);
}
const compensation = read("spread", [quote("spread", open, 3.5, "circa", 100, -120),
  quote("spread", last, 3, "circa", -115, -105)]);
assert.equal(compensation.netDirection, 1);
assert.equal(compensation.latestEconomicDirection, 1,
  "number-plus-juice economics, rather than the raw handicap sign, governs a compensated spread leg");
const reverse = read("total", [quote("total", open, 45), quote("total", mid, 49), quote("total", last, 44)]);
assert.equal(reverse.pathStatus, "reversal");
assert.equal(reverse.netDirection, -1);
assert.equal(reverse.sourcePosture, "supports_net",
  "a completed economic reversal can establish a new direction; an old wrong-side tick is not a permanent veto");
const tiny = read("moneyline", [quote("moneyline", open, .5), quote("moneyline", last, .50000001)]);
assert.equal(tiny.netDirection, 1);
assert.ok(tiny.netMagnitude > 0 && tiny.netMagnitude < .000001);
const leader = read("total", [quote("total", open, 45), quote("total", mid, 46), quote("total", last, 47)]);
const follower = read("total", [quote("total", open, 45, "pinnacle"), quote("total", "2026-11-02T13:30:00.000Z", 46, "pinnacle"),
  quote("total", last, 47, "pinnacle")], "pinnacle");
assert.ok(Date.parse(leader.coordinates[1]!.observedAt) < Date.parse(follower.coordinates[1]!.observedAt));
const malformed = quote("total", "2026-11-02T13:30:00.000Z", 60);
malformed.provider = "other" as NflEpisodeHistoryBook["provider"];
assert.deepEqual(read("total", [quote("total", open, 45), malformed, quote("total", last, 47)]).coordinates,
  [leader.coordinates[0], leader.coordinates.at(-1)], "unverified rows cannot inject a false peak or buyback");
const serialized = JSON.stringify(forecast);
read("total", [quote("total", open, 45), quote("total", last, 47)]);
assert.equal(JSON.stringify(forecast), serialized);
console.log("NFL economic path adjudication: all markets, late buybacks, compensation, pure vig, source chronology passed.");
