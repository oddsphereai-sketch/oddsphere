/** Historical-only audit for the predeclared NFL generalized Total priced-neutral anchor. */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities,
} from "../../lib/services/football/nflV1WeekOneOutcome";

const AUDIT_RELEASE = "nfl_total_priced_neutral_anchor_audit_2026_09_20_r1" as const;
const SELECTION = [2022, 2023] as const;
const CONFIRMATION = [2024, 2025] as const;

type Row = Record<string, string>;
type Game = {
  id: string;
  season: number;
  week: number;
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  line: number;
  overPrice: number;
  underPrice: number;
};
type Forecast = Game & { overProbability: number; center: number };

function parseLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { values.push(value); value = ""; }
    else value += character;
  }
  values.push(value);
  return values;
}

function parseCsv(text: string): Row[] {
  const lines = text.trimEnd().split(/\r?\n/);
  const header = parseLine(lines[0]!);
  return lines.slice(1).map((line, index) => {
    const values = parseLine(line);
    if (values.length !== header.length) throw new Error(`Malformed CSV row ${index + 2}.`);
    return Object.fromEntries(header.map((key, column) => [key, values[column]!])) as Row;
  });
}

function finite(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function games(rows: Row[]): Game[] {
  return rows.flatMap((row): Game[] => {
    const season = finite(row.season);
    const week = finite(row.week);
    const awayScore = finite(row.away_score);
    const homeScore = finite(row.home_score);
    const line = finite(row.total_line);
    const overPrice = finite(row.over_odds);
    const underPrice = finite(row.under_odds);
    if (row.game_type !== "REG" || season === null || week === null || awayScore === null ||
        homeScore === null || line === null || overPrice === null || underPrice === null ||
        overPrice === 0 || underPrice === 0 || season < 2016 || season > 2025 ||
        !row.game_id || !row.away_team || !row.home_team) return [];
    return [{
      id: row.game_id, season, week, away: row.away_team, home: row.home_team,
      awayScore, homeScore, line, overPrice, underPrice,
    }];
  });
}

function implied(price: number): number {
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

function marketOverProbability(game: Game): number {
  const over = implied(game.overPrice);
  const under = implied(game.underPrice);
  return over / (over + under);
}

function runtimeOverProbability(game: Game, center: number): number {
  const forecast = getNflV1WeekOneOutcomeForecast({
    providerGameId: `historical-${game.id}`,
    awayTeam: game.away,
    homeTeam: game.home,
    weeklyFallback: { projectedHomeMargin: 0.01, marketTotal: center },
  });
  return nflV1WeekOneLineProbabilities({ forecast, homeSpread: 0, totalLine: game.line }).total.overProbability;
}

const centerOffsetCache = new Map<string, number>();

function centerForProbability(game: Game, target: number): number {
  const lineFraction = game.line - Math.floor(game.line);
  const key = `${lineFraction}:${game.overPrice}:${game.underPrice}`;
  const cached = centerOffsetCache.get(key);
  if (cached !== undefined) return game.line + cached;
  let low = game.line - 8;
  let high = game.line + 8;
  for (let iteration = 0; iteration < 36; iteration++) {
    const midpoint = (low + high) / 2;
    if (runtimeOverProbability(game, midpoint) < target) low = midpoint;
    else high = midpoint;
  }
  const center = (low + high) / 2;
  centerOffsetCache.set(key, center - game.line);
  return center;
}

function forecasts(source: Game[], priced: boolean): Forecast[] {
  return source.map((game) => {
    const target = priced ? marketOverProbability(game) : runtimeOverProbability(game, game.line);
    return {
      ...game,
      overProbability: target,
      center: priced ? centerForProbability(game, target) : game.line,
    };
  });
}

function metrics(rows: Forecast[], seasons: readonly number[]) {
  const selected = rows.filter((row) => seasons.includes(row.season));
  const resolved = selected.filter((row) => row.awayScore + row.homeScore !== row.line);
  const outcomes = resolved.map((row) => Number(row.awayScore + row.homeScore > row.line));
  const probabilities = resolved.map((row) => row.overProbability);
  const directions = probabilities.map((probability) => Number(probability >= 0.5));
  const errors = selected.map((row) => row.center - row.awayScore - row.homeScore);
  const overRate = mean(outcomes);
  const meanProbability = mean(probabilities);
  return {
    games: selected.length,
    resolved: resolved.length,
    pushes: selected.length - resolved.length,
    brier: mean(probabilities.map((probability, index) => (probability - outcomes[index]!) ** 2)),
    absoluteCalibrationGap: Math.abs(meanProbability - overRate),
    meanOverProbability: meanProbability,
    actualOverRate: overRate,
    directionalAccuracy: mean(directions.map((direction, index) => Number(direction === outcomes[index]))),
    forecastOver: directions.filter(Boolean).length,
    forecastUnder: directions.filter((direction) => !direction).length,
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(mean(errors.map((error) => error * error))),
    bias: mean(errors),
    meanCenterShift: mean(selected.map((row) => row.center - row.line)),
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main(): Promise<void> {
  const root = process.env.NFL_GAMES_CACHE_ROOT ?? path.resolve("football-research/cache/nflverse");
  const manifest = JSON.parse(await readFile(path.join(root, "games.latest.json"), "utf8")) as {
    filename: string; sha256: string;
  };
  const bytes = await readFile(path.join(root, manifest.filename));
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== manifest.sha256) throw new Error("nflverse games checksum mismatch");
  const source = games(parseCsv(bytes.toString("utf8")));
  const incumbent = forecasts(source, false);
  const candidate = forecasts(source, true);
  console.log(JSON.stringify({
    auditRelease: AUDIT_RELEASE,
    readOnly: true,
    source: { ...manifest, verifiedSha256: checksum },
    sourceGames: source.length,
    chronology: { selection: SELECTION, confirmation: CONFIRMATION },
    incumbent: {
      selection: metrics(incumbent, SELECTION),
      confirmation: metrics(incumbent, CONFIRMATION),
      byConfirmationSeason: Object.fromEntries(CONFIRMATION.map((season) => [season, metrics(incumbent, [season])])),
    },
    pricedNeutralCandidate: {
      selection: metrics(candidate, SELECTION),
      confirmation: metrics(candidate, CONFIRMATION),
      byConfirmationSeason: Object.fromEntries(CONFIRMATION.map((season) => [season, metrics(candidate, [season])])),
    },
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
