#!/usr/bin/env npx tsx
/**
 * Reconstruct the score/rest portion of the NBA r1 replay input.
 *
 * The original temporary CSV was not retained. This builder combines the
 * public odds database used by that audit for 2023-24 and 2024-25 with the
 * immutable BDL final-game capture for the 2025-26 regular season. Market
 * columns are preserved where the public database has an exact game match;
 * otherwise they are explicitly neutral placeholders. The reconstructed file
 * is therefore eligible to reproduce and diagnose the independent score path,
 * but NOT to restate historical Spread/Total market accuracy.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

type OddsRow = {
  Date: string;
  Home: string;
  Away: string;
  OU: number;
  Spread: number;
  ML_Home: number;
  ML_Away: number;
  Points: number;
  Win_Margin: number;
  Days_Rest_Home: number;
  Days_Rest_Away: number;
  market_available?: boolean;
};

type BdlGame = {
  id: number;
  date: string;
  season: number;
  postseason: boolean;
  status_state: string;
  home_team_score: number;
  visitor_team_score: number;
  home_team: { full_name: string };
  visitor_team: { full_name: string };
};

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function noVigHome(home: number, away: number): number {
  const first = implied(home);
  const second = implied(away);
  return first / (first + second);
}

function sqliteRows(path: string, table: string): OddsRow[] {
  const body = execFileSync("sqlite3", ["-json", path, `select * from \"${table}\" order by Date, rowid`], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(body) as OddsRow[];
}

function csv(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const [sqlitePath, bdlGamesPath, outputPath] = process.argv.slice(2);
if (!sqlitePath || !bdlGamesPath || !outputPath) {
  throw new Error("usage: reconstruct-nba-r1-replay-input.ts ODDS.sqlite games.jsonl output.csv");
}

const historical = [
  ...sqliteRows(sqlitePath, "2023-24"),
  ...sqliteRows(sqlitePath, "2024-25"),
].map((row) => ({ ...row, market_available: true }));
const available2025 = sqliteRows(sqlitePath, "odds_2025-26");
const availableByGame = new Map(available2025.map((row) => [
  `${row.Date}::${row.Home}::${row.Away}`,
  row,
]));
const games = readFileSync(bdlGamesPath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as BdlGame)
  .filter((game) => game.season === 2025 && !game.postseason && game.status_state === "final")
  .sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id);

const lastPlayed = new Map<string, string>();
let exactMarketMatches = 0;
const reconstructed = games.map((game): OddsRow => {
  const home = game.home_team.full_name;
  const away = game.visitor_team.full_name;
  const rest = (team: string): number => {
    const prior = lastPlayed.get(team);
    if (!prior) return 7;
    const days = Math.round((Date.parse(`${game.date}T12:00:00Z`) - Date.parse(`${prior}T12:00:00Z`)) / 86_400_000);
    return Math.max(0, Math.min(7, days));
  };
  const matched = availableByGame.get(`${game.date}::${home}::${away}`) ?? null;
  if (matched) exactMarketMatches += 1;
  const points = game.home_team_score + game.visitor_team_score;
  const margin = game.home_team_score - game.visitor_team_score;
  const row: OddsRow = {
    Date: game.date,
    Home: home,
    Away: away,
    OU: matched?.OU ?? points,
    Spread: matched?.Spread ?? 0,
    ML_Home: matched?.ML_Home ?? -110,
    ML_Away: matched?.ML_Away ?? -110,
    Points: points,
    Win_Margin: margin,
    Days_Rest_Home: rest(home),
    Days_Rest_Away: rest(away),
    market_available: matched !== null,
  };
  lastPlayed.set(home, game.date);
  lastPlayed.set(away, game.date);
  return row;
});

const header = [
  "Date", "Home", "Away", "OU", "Spread", "ML_Home", "ML_Away",
  "Points", "Win_Margin", "Days_Rest_Home", "Days_Rest_Away", "market_home_prob",
  "market_available",
];
const rows = [...historical, ...reconstructed].map((row) => [
  row.Date,
  row.Home,
  row.Away,
  row.OU,
  row.Spread,
  row.ML_Home,
  row.ML_Away,
  row.Points,
  row.Win_Margin,
  row.Days_Rest_Home,
  row.Days_Rest_Away,
  noVigHome(row.ML_Home, row.ML_Away),
  row.market_available === true ? "true" : "false",
]);
writeFileSync(outputPath, `${[header, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`);
console.log(JSON.stringify({
  outputPath,
  historicalRows: historical.length,
  confirmationRows: reconstructed.length,
  exactMarketMatches,
  neutralMarketPlaceholders: reconstructed.length - exactMarketMatches,
  eligibility: {
    independentScoreReplay: reconstructed.length === 1230,
    spreadAndTotalReplay: false,
  },
}, null, 2));
