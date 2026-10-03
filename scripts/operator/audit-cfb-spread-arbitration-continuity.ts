#!/usr/bin/env tsx

/** SELECT-only replay of hysteresis for the validated CFB Playbook spread signal. */

import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import type { CfbForwardPlaybookSplit, CfbForwardStoredEvidence } from "../../lib/services/football/cfbForwardEvidence";

loadEnvConfig(process.cwd());

type Prediction = {
  gameId: string;
  week: number;
  gameDate: string;
  awayTeam: string;
  homeTeam: string;
  expectedAway: number;
  expectedHome: number;
  actualAway: number;
  actualHome: number;
};
type Side = "home" | "away";
type Result = "win" | "loss" | "push";
type ReplayRow = {
  gameId: string;
  game: string;
  week: number;
  startsAt: string;
  homeSpread: number;
  currentSignal: Side | null;
  retainedSignal: Side | null;
  retainedFrom: string | null;
  retained: boolean;
  baselineHome: number;
  baselineAway: number;
  candidateHome: number;
  candidateAway: number;
  actualHome: number;
  actualAway: number;
  baselineSpread: Result;
  candidateSpread: Result;
};

const MAX_RETENTION_MS = 24 * 60 * 60_000;

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const predictionPath = process.argv.find((value) => value.startsWith("--predictions="))?.slice(14) ??
    "/private/tmp/cfb-cross-family-domain-arbitration-r7.json";
  const artifact = JSON.parse((await readFile(predictionPath, "utf8")).replace(/\bNaN\b/g, "null")) as { currentPredictions?: Prediction[]; current2026?: { predictions?: Prediction[] } };
  const predictions = (artifact.currentPredictions ?? artifact.current2026?.predictions ?? []).filter((row) =>
    [row.expectedAway, row.expectedHome, row.actualAway, row.actualHome].every(Number.isFinite));
  const evidence = await readCfbForwardEvidence({
    client: createClient(url, key, { auth: { persistSession: false } }),
    season: 2026,
  });
  const byGame = new Map<string, CfbForwardStoredEvidence[]>();
  for (const row of evidence) byGame.set(row.providerGameId, [...(byGame.get(row.providerGameId) ?? []), row]);
  const rows = predictions.flatMap((prediction): ReplayRow[] => {
    const start = Date.parse(prediction.gameDate);
    const matched = [...byGame.values()].find((candidate) => {
      const game = candidate[0]?.payload.game;
      return game && Math.abs(Date.parse(game.scheduledStart) - start) <= 4 * 60 * 60_000 &&
        normalized(game.away.name) === normalized(prediction.awayTeam) &&
        normalized(game.home.name) === normalized(prediction.homeTeam);
    }) ?? [];
    const history = matched
      .filter((row) => Date.parse(row.capturedAt) < start)
      .filter((row) => row.payload.market.playbookLine?.homeSpread != null && row.payload.market.playbookSplits?.spread)
      .sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt));
    const latest = history.at(-1);
    const homeSpread = latest?.payload.market.playbookLine?.homeSpread;
    if (!latest || homeSpread == null) return [];
    const independentMargin = prediction.expectedHome - prediction.expectedAway;
    const currentSignal = qualifyingSignal(latest.payload.market.playbookSplits?.spread ?? null);
    const currentDirection = signalDirection(latest.payload.market.playbookSplits?.spread ?? null);
    const retainedRow = currentSignal ? latest : [...history].reverse().find((row) => {
      const age = Date.parse(latest.capturedAt) - Date.parse(row.capturedAt);
      const prior = qualifyingSignal(row.payload.market.playbookSplits?.spread ?? null);
      return age >= 0 && age <= MAX_RETENTION_MS && prior !== null && prior === currentDirection &&
        isFavoriteSide(prior, homeSpread) && Math.abs(independentMargin + homeSpread) >= 5;
    }) ?? null;
    const retainedSignal = currentSignal ?? qualifyingSignal(retainedRow?.payload.market.playbookSplits?.spread ?? null);
    const total = prediction.expectedHome + prediction.expectedAway;
    const baselineMargin = arbitratedMargin(independentMargin, homeSpread, currentSignal);
    const candidateMargin = arbitratedMargin(independentMargin, homeSpread, retainedSignal);
    const baselineHome = (total + baselineMargin) / 2;
    const baselineAway = (total - baselineMargin) / 2;
    const candidateHome = (total + candidateMargin) / 2;
    const candidateAway = (total - candidateMargin) / 2;
    return [{
      gameId: String(prediction.gameId),
      game: `${prediction.awayTeam}@${prediction.homeTeam}`,
      week: prediction.week,
      startsAt: prediction.gameDate,
      homeSpread,
      currentSignal,
      retainedSignal,
      retainedFrom: retainedRow && retainedRow !== latest ? retainedRow.capturedAt : null,
      retained: currentSignal === null && retainedSignal !== null,
      baselineHome,
      baselineAway,
      candidateHome,
      candidateAway,
      actualHome: prediction.actualHome,
      actualAway: prediction.actualAway,
      baselineSpread: settleSpread(baselineMargin, prediction.actualHome - prediction.actualAway, homeSpread),
      candidateSpread: settleSpread(candidateMargin, prediction.actualHome - prediction.actualAway, homeSpread),
    }];
  });
  const selection = rows.filter((row) => row.week <= 2);
  const confirmation = rows.filter((row) => row.week >= 3);
  console.log(JSON.stringify({
    release: "cfb_spread_arbitration_continuity_select_audit_2026_10_03_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    rule: { entryBooks: 8, entryDivergencePp: 5, retentionHours: 24, oppositeQualifiedSignalReplaces: true },
    coverage: { predictions: predictions.length, evidenceRows: evidence.length, matchedGames: rows.length },
    selectionWeeks1to2: summarize(selection),
    confirmationWeek3Plus: summarize(confirmation),
    all: summarize(rows),
    changedRows: rows.filter((row) => Math.abs(row.baselineHome - row.candidateHome) > 1e-9),
  }, null, 2));
}

function qualifyingSignal(split: CfbForwardPlaybookSplit | null): Side | null {
  if (!split || (split.booksUsed ?? 0) < 8) return null;
  if ([split.homeMoneyPct, split.homeBetsPct, split.awayMoneyPct, split.awayBetsPct].some((value) => value == null)) return null;
  const homeGap = split.homeMoneyPct! - split.homeBetsPct!;
  const awayGap = split.awayMoneyPct! - split.awayBetsPct!;
  const side = homeGap >= awayGap ? "home" : "away";
  return Math.abs(side === "home" ? homeGap : awayGap) >= 5 ? side : null;
}

function signalDirection(split: CfbForwardPlaybookSplit | null): Side | null {
  if (!split || (split.booksUsed ?? 0) < 8) return null;
  if ([split.homeMoneyPct, split.homeBetsPct, split.awayMoneyPct, split.awayBetsPct].some((value) => value == null)) return null;
  const homeGap = split.homeMoneyPct! - split.homeBetsPct!;
  const awayGap = split.awayMoneyPct! - split.awayBetsPct!;
  if (Math.abs(homeGap - awayGap) < 1e-9) return null;
  return homeGap > awayGap ? "home" : "away";
}

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/[^a-z0-9]/gi, "").toLowerCase()
    .replace(/^connecticut/, "uconn");
}

function arbitratedMargin(independentMargin: number, homeSpread: number, signal: Side | null): number {
  if (!signal) return independentMargin;
  const independentSide: Side = independentMargin + homeSpread >= 0 ? "home" : "away";
  return signal === independentSide ? independentMargin : -2 * homeSpread - independentMargin;
}

function isFavoriteSide(side: Side, homeSpread: number): boolean {
  return side === "home" ? homeSpread < 0 : homeSpread > 0;
}

function settleSpread(predictedMargin: number, actualMargin: number, homeSpread: number): Result {
  const selected: Side = predictedMargin + homeSpread >= 0 ? "home" : "away";
  const result = actualMargin + homeSpread;
  if (Math.abs(result) < 1e-9) return "push";
  return (selected === "home") === (result > 0) ? "win" : "loss";
}

function summarize(rows: ReplayRow[]) {
  const result = (prefix: "baseline" | "candidate") => {
    const resolved = rows.filter((row) => row[`${prefix}Spread`] !== "push");
    const spreadWins = resolved.filter((row) => row[`${prefix}Spread`] === "win").length;
    const mlWins = rows.filter((row) =>
      (row[`${prefix}Home`] >= row[`${prefix}Away`]) === (row.actualHome > row.actualAway)).length;
    return {
      moneyline: { wins: mlWins, games: rows.length, accuracy: rows.length ? mlWins / rows.length : null },
      spread: { wins: spreadWins, decided: resolved.length, accuracy: resolved.length ? spreadWins / resolved.length : null },
      marginMae: mean(rows.map((row) => Math.abs((row[`${prefix}Home`] - row[`${prefix}Away`]) - (row.actualHome - row.actualAway)))),
      teamScoreMae: mean(rows.flatMap((row) => [Math.abs(row[`${prefix}Home`] - row.actualHome), Math.abs(row[`${prefix}Away`] - row.actualAway)])),
    };
  };
  return {
    games: rows.length,
    retainedSignals: rows.filter((row) => row.retained).length,
    scoreChanges: rows.filter((row) => Math.abs(row.baselineHome - row.candidateHome) > 1e-9).length,
    baseline: result("baseline"),
    candidate: result("candidate"),
  };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
