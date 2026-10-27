#!/usr/bin/env tsx

/**
 * Read-only, release-pure confirmation of the NFL Passing Yards direction rule.
 * Inputs are immutable operator exports; this script performs no provider or
 * database calls and never writes member or tracking state.
 */
import { readFileSync } from "node:fs";

type Forecast = Readonly<{
  gameId: string;
  market: string;
  line: number;
  prediction: "over" | "under" | "yes" | "no";
  actual: number;
  result: "win" | "loss" | "push";
  canonicalMainLine: boolean;
  rawProbability: number;
  marketProbability: number;
  grade: string;
  decisionRelease: string;
}>;
type TrackingReport = Readonly<{ forecasts: Forecast[] }>;
type PrivateHistory = Readonly<{ history: { rows: Array<{ gameId: string }> } }>;
type CanonicalForecast = Readonly<{
  game: string;
  market: string;
  line: number;
  actual: number;
  raw: number;
  marketp: number;
  final: number;
  pred: Side;
  grade: string;
}>;
type Side = "over" | "under";
type AuditRow = Readonly<{
  week: number;
  incumbentSide: Side;
  candidateSide: Side;
  actualSide: Side;
  actionable: boolean;
}>;

const RELEASE = "nfl_player_props_passing_yards_direction_audit_2026_10_27_r1" as const;
const DECISION_RELEASE = "nfl_player_props_decision_2026_10_15_r32_independent_rushing_yards" as const;
const MINIMUM_MARKET_DISTANCE = 0.01 as const;

function main(): void {
  const report = read<TrackingReport>(required("report"));
  const weekGames = [6, 7].map((week) => ({
    week,
    games: new Set(read<PrivateHistory>(required(`week${week}`)).history.rows.map((row) => String(row.gameId))),
  }));
  const week6Games = weekGames.find((item) => item.week === 6)!.games;
  const week7Games = weekGames.find((item) => item.week === 7)!.games;
  const week6Rows: AuditRow[] = report.forecasts.flatMap((row) => {
    if (!week6Games.has(String(row.gameId)) || row.decisionRelease !== DECISION_RELEASE || !row.canonicalMainLine
      || row.market !== "passing_yards" || row.prediction === "yes" || row.prediction === "no"
      || row.result === "push") return [];
    const rawOver = row.prediction === "over" ? row.rawProbability : 1 - row.rawProbability;
    const marketOver = row.prediction === "over" ? row.marketProbability : 1 - row.marketProbability;
    // The immutable tracking export stores the incumbent direction directly.
    // Direction accuracy does not require reconstructing a missing final
    // probability, so keep the audit release-pure and use that stored side.
    const finalOver = row.prediction === "over" ? 1 : 0;
    return [auditRow(6, rawOver, marketOver, finalOver, row.actual > row.line, row.grade)];
  });
  const week7Rows: AuditRow[] = read<CanonicalForecast[]>(required("week7-canonical")).flatMap((row) => {
    if (!week7Games.has(String(row.game)) || row.market !== "passing_yards") return [];
    return [auditRow(7, row.raw, row.marketp, row.final, row.actual > row.line, row.grade)];
  });
  const rows = [...week6Rows, ...week7Rows];
  const summarize = (selected: AuditRow[]) => {
    const changes = selected.filter((row) => row.incumbentSide !== row.candidateSide);
    const actionable = selected.filter((row) => row.actionable);
    return {
      rows: selected.length,
      incumbent: record(selected.filter((row) => row.incumbentSide === row.actualSide).length, selected.length),
      candidate: record(selected.filter((row) => row.candidateSide === row.actualSide).length, selected.length),
      changes: changes.length,
      corrections: changes.filter((row) => row.candidateSide === row.actualSide).length,
      harms: changes.filter((row) => row.incumbentSide === row.actualSide).length,
      actionables: {
        rows: actionable.length,
        incumbent: record(actionable.filter((row) => row.incumbentSide === row.actualSide).length, actionable.length),
        candidate: record(actionable.filter((row) => row.candidateSide === row.actualSide).length, actionable.length),
        changes: actionable.filter((row) => row.incumbentSide !== row.candidateSide).length,
      },
    };
  };
  process.stdout.write(`${JSON.stringify({
    release: RELEASE,
    readOnly: true,
    databaseWrites: 0,
    providerCalls: 0,
    decisionRelease: DECISION_RELEASE,
    minimumTargetExcludedMarketDistance: MINIMUM_MARKET_DISTANCE,
    inputProbabilityContracts: {
      week6TrackingReport: "probability of prediction side; normalized to Over by this audit",
      week7CanonicalReport: "raw, marketp, and final are already normalized Over probabilities",
    },
    combined: summarize(rows),
    byWeek: weekGames.map(({ week }) => ({ week, ...summarize(rows.filter((row) => row.week === week)) })),
  }, null, 2)}\n`);
}

function auditRow(
  week: number,
  rawOver: number,
  marketOver: number,
  finalOver: number,
  actualOver: boolean,
  grade: string,
): AuditRow {
  const rawSide: Side = rawOver >= 0.5 ? "over" : "under";
  const marketSide: Side = marketOver >= 0.5 ? "over" : "under";
  const incumbentSide: Side = finalOver >= 0.5 ? "over" : "under";
  const candidateSide = rawSide !== marketSide
    && Math.abs(marketOver - 0.5) >= MINIMUM_MARKET_DISTANCE
    ? marketSide
    : incumbentSide;
  return {
    week,
    incumbentSide,
    candidateSide,
    actualSide: actualOver ? "over" : "under",
    actionable: grade === "Best Angle" || grade === "Lean",
  };
}

function record(wins: number, rows: number) {
  return { wins, losses: rows - wins, hitRate: rows ? wins / rows : null };
}
function required(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`--${name}=... is required.`);
  return value;
}
function read<T>(file: string): T { return JSON.parse(readFileSync(file, "utf8")) as T; }

main();
