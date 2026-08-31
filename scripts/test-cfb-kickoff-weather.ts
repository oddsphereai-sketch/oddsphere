#!/usr/bin/env tsx

import assert from "node:assert/strict";
import type { IWeatherProvider, WeatherForecastRecord } from "../lib/providers/interfaces/IWeatherProvider";
import type { NcaafBookOdds, NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";
import {
  cfbWeatherTotalAdjustment,
  collectCfbKickoffWeather,
  resolveCfbKickoffVenue,
} from "../lib/services/football/cfbKickoffWeather";
import { applyCfbKickoffWeatherToIndependentForecast } from "../lib/services/football/cfbMarketSharpAwareShadow";
import { buildCfbV1DecisionBundle, cfbV1LineProbabilities, type CfbV1Forecast } from "../lib/services/football/cfbV1Decision";

const capturedAt = "2026-08-31T16:00:00.000Z";
const kickoff = "2026-09-03T23:00:00.000Z";
const game = sampleGame();
const venueRows = [venueRow()];
const forecast = sampleWeather();

class TestWeatherProvider implements IWeatherProvider {
  calls = 0;
  constructor(private readonly value: WeatherForecastRecord | null, private readonly fails = false) {}
  async getForecast(): Promise<WeatherForecastRecord | null> {
    this.calls += 1;
    if (this.fails) throw new Error("synthetic provider failure");
    return this.value;
  }
}

async function main(): Promise<void> {
assert.equal(resolveCfbKickoffVenue({ game, rows: venueRows })?.name, "Test Stadium");
assert.equal(resolveCfbKickoffVenue({ game: { ...game, home: { ...game.home, abbreviation: "ALT" } }, rows: venueRows })?.name, "Test Stadium", "exact full-name fallback resolves provider abbreviation variants");
assert.equal(resolveCfbKickoffVenue({ game, rows: [...venueRows, { ...venueRow(), teamId: "OTHER", venue: { ...venueRow().venue, park: "Conflicting Stadium", location: { lat: 41, lon: -75 } } }] }), null, "ambiguous full-team matches fail closed");
assert.equal(resolveCfbKickoffVenue({ game: { ...game, neutralSite: true }, rows: venueRows }), null, "neutral sites never inherit the nominal home venue");

const provider = new TestWeatherProvider(forecast);
const available = await collectCfbKickoffWeather({ game, stage: "opening", capturedAt, venueRows, provider });
assert.equal(available.requests, 1);
assert.equal(provider.calls, 1);
assert.equal(available.snapshot.status, "forecast_available");
assert.equal(available.snapshot.independentTotalAdjustmentPoints, -3, "wind plus precipitation remains capped at -3");
assert.deepEqual(available.snapshot.adjustmentReasons, ["wind_20_to_24_mph", "adverse_precipitation_at_least_60_pct", "temperature_at_or_below_25_f"]);

const reusedProvider = new TestWeatherProvider(forecast);
const reused = await collectCfbKickoffWeather({ game, stage: "unlocked", capturedAt: "2026-08-31T17:00:00.000Z", venueRows, provider: reusedProvider, previous: available.snapshot });
assert.equal(reused.requests, 0);
assert.equal(reusedProvider.calls, 0);
assert.equal(reused.snapshot.reused, true);

const t60Provider = new TestWeatherProvider({ ...forecast, fetched_at: "2026-09-03T21:59:00.000Z" });
const t60 = await collectCfbKickoffWeather({ game, stage: "t60", capturedAt: "2026-09-03T22:00:00.000Z", venueRows, provider: t60Provider, previous: available.snapshot });
assert.equal(t60.requests, 1, "T-60 always refreshes instead of reusing a prior forecast");
assert.equal(t60Provider.calls, 1);

const indoorProvider = new TestWeatherProvider(forecast);
const indoor = await collectCfbKickoffWeather({ game, stage: "opening", capturedAt, venueRows: [{ ...venueRow(), venue: { ...venueRow().venue, roof: "FIXED" } }], provider: indoorProvider });
assert.equal(indoor.snapshot.status, "controlled_indoor");
assert.equal(indoor.requests, 0);
assert.equal(indoorProvider.calls, 0);

const neutral = await collectCfbKickoffWeather({ game: { ...game, neutralSite: true }, stage: "opening", capturedAt, venueRows, provider });
assert.equal(neutral.snapshot.status, "neutral_site");
assert.equal(neutral.requests, 0);

const farProvider = new TestWeatherProvider(forecast);
const far = await collectCfbKickoffWeather({ game: { ...game, scheduledStart: "2026-09-07T23:00:00.000Z" }, stage: "opening", capturedAt, venueRows, provider: farProvider });
assert.equal(far.snapshot.status, "outside_forecast_window");
assert.equal(far.requests, 0);
assert.equal(farProvider.calls, 0);

const failed = await collectCfbKickoffWeather({ game, stage: "opening", capturedAt, venueRows, provider: new TestWeatherProvider(null, true) });
assert.equal(failed.snapshot.status, "provider_unavailable");
assert.equal(failed.requests, 1);
assert.equal(failed.snapshot.independentTotalAdjustmentPoints, 0);

assert.deepEqual(cfbWeatherTotalAdjustment({ ...forecast, wind_speed_mph: 15, precipitation_probability: 0, temperature_f: 60, conditions: "Clear" }), { points: -1, reasons: ["wind_15_to_19_mph"] });
assert.deepEqual(cfbWeatherTotalAdjustment({ ...forecast, wind_speed_mph: 19.9, precipitation_probability: 0, temperature_f: 60, conditions: "Clear" }), { points: -1, reasons: ["wind_15_to_19_mph"] });
assert.deepEqual(cfbWeatherTotalAdjustment({ ...forecast, wind_speed_mph: 14.9, precipitation_probability: 100, temperature_f: 60, conditions: "Cloudy" }), { points: 0, reasons: [] }, "precipitation probability alone does not imply adverse football weather");

const baseForecast = sampleForecast();
const adjusted = applyCfbKickoffWeatherToIndependentForecast(baseForecast, available.snapshot);
assert.ok(adjusted.expectedTotal < baseForecast.expectedTotal);
assert.ok(baseForecast.expectedTotal - adjusted.expectedTotal <= 3.000001);
assert.ok(Math.abs(adjusted.pmf.reduce((sum, cell) => sum + cell.probability, 0) - 1) < 1e-12);
assert.deepEqual(marginMasses(adjusted), marginMasses(baseForecast), "weather adjustment preserves the complete independent margin distribution");
assert.equal(adjusted.homeWinProbability, baseForecast.homeWinProbability, "winner probability is unchanged when margin-group mass is exact");
assert.equal(applyCfbKickoffWeatherToIndependentForecast(baseForecast, null), baseForecast, "unavailable weather leaves the forecast byte path unchanged");
const baseProbabilities = cfbV1LineProbabilities({ forecast: baseForecast, homeSpread: -3.5, totalLine: 54 });
const adjustedProbabilities = cfbV1LineProbabilities({ forecast: adjusted, homeSpread: -3.5, totalLine: 54 });
assert.ok(adjustedProbabilities.total.under > baseProbabilities.total.under, "adverse weather has a symmetric tested path to improve the Under prediction");
assert.ok(adjustedProbabilities.total.over < baseProbabilities.total.over, "adverse weather reduces the Over prediction");
const books = sampleBooks();
const baseTotal = buildCfbV1DecisionBundle({
  providerGameId: game.providerGameId, awayTeam: game.away.abbreviation, homeTeam: game.home.abbreviation,
  gameStartsAt: kickoff, comparableCurrentBooks: books, forecast: baseForecast,
  evaluatedAt: capturedAt, stage: "unlocked", calibrationContract: "authoritative_pmf_identity",
}).evaluatedBets.find((decision) => decision.market === "total");
const weatherTotal = buildCfbV1DecisionBundle({
  providerGameId: game.providerGameId, awayTeam: game.away.abbreviation, homeTeam: game.home.abbreviation,
  gameStartsAt: kickoff, comparableCurrentBooks: books, forecast: adjusted,
  evaluatedAt: capturedAt, stage: "unlocked", calibrationContract: "authoritative_pmf_identity",
}).evaluatedBets.find((decision) => decision.market === "total");
assert.ok(baseTotal && weatherTotal);
assert.ok(baseTotal.grade === "No Play" || baseTotal.grade === "Watchlist", "synthetic neutral total starts non-actionable");
assert.match(weatherTotal.side, /^Under\b/);
assert.ok(weatherTotal.grade === "Lean" || weatherTotal.grade === "Best Angle", "the same symmetric rule can promote a weather-supported Under");

console.log("✅ CFB kickoff weather tests passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function sampleGame(): NcaafGame {
  return {
    providerGameId: "weather-game", providerWeek: 1, season: 2026, scheduledStart: kickoff,
    status: "scheduled", neutralSite: false, awayScore: null, homeScore: null,
    away: { id: 1, conferenceId: 1, abbreviation: "AWY", name: "Away State Wolves", fbs: true },
    home: { id: 2, conferenceId: 2, abbreviation: "HME", name: "Home State Bears", fbs: true },
  };
}

function venueRow() {
  return { teamId: "HME", teamName: "Home State Bears", venue: { park: "Test Stadium", roof: "OPEN_AIR", location: { lat: 40, lon: -74 } } };
}

function sampleWeather(): WeatherForecastRecord {
  return {
    forecast_for: kickoff, fetched_at: capturedAt, temperature_f: 20, feels_like_f: 12,
    humidity_pct: 80, precipitation_mm: 2, precipitation_probability: 70,
    wind_speed_mph: 22, wind_direction_degrees: 270, conditions: "Rain and snow",
  };
}

function sampleForecast(): CfbV1Forecast {
  const pmf = [
    { home: 28, away: 21, probability: 0.25 }, { home: 35, away: 28, probability: 0.25 },
    { home: 21, away: 24, probability: 0.25 }, { home: 28, away: 31, probability: 0.25 },
  ];
  return {
    providerGameId: game.providerGameId, awayTeam: game.away.abbreviation, homeTeam: game.home.abbreviation,
    gameStartsAt: kickoff, expectedAwayPoints: 26, expectedHomePoints: 28, expectedMarginHome: 2,
    expectedTotal: 54, homeWinProbability: 0.5, representativeScore: { away: 21, home: 28 },
    interval80: { away: [21, 31], home: [21, 35], marginHome: [-3, 7], total: [45, 63] }, pmf,
  };
}

function marginMasses(value: CfbV1Forecast): Array<[number, number]> {
  const masses = new Map<number, number>();
  for (const cell of value.pmf) masses.set(cell.home - cell.away, (masses.get(cell.home - cell.away) ?? 0) + cell.probability);
  return [...masses.entries()].sort((a, b) => a[0] - b[0]).map(([margin, mass]) => [margin, Math.round(mass * 1e12) / 1e12]);
}

function sampleBooks(): NcaafBookOdds[] {
  return ["draftkings", "fanduel", "caesars", "betmgm"].map((sportsbook) => ({
    providerGameId: game.providerGameId,
    sportsbook,
    observedAt: capturedAt,
    provider: "balldontlie",
    targetEligible: true,
    moneyline: null,
    spread: null,
    total: { line: 54, overPrice: -110, underPrice: -110 },
  }));
}
