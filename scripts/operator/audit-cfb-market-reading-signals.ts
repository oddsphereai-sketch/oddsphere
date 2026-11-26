#!/usr/bin/env tsx

/**
 * SELECT-only, release-separated CFB market-reading audit. Outcomes come from
 * the existing settled games table; no provider call or database write occurs.
 */

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NcaafGame } from "../../lib/services/football/balldontlieNcaafSlate";
import type { CfbForwardPlaybookSplit, CfbForwardPlaybookSplitSet } from "../../lib/services/football/cfbForwardEvidence";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { buildCfbMarketInformedOutcomeForecast, resolveCfbCanonicalMarketAnchor } from "../../lib/services/football/cfbMarketInformedOutcome";
import { buildCfbMarketSharpAwareForecast } from "../../lib/services/football/cfbMarketSharpAwareShadow";
import type { CfbSharpApiSplitRecord } from "../../lib/services/football/cfbSharpApiSplits";
import { getCfbV1ForecastForGame, type CfbV1Forecast } from "../../lib/services/football/cfbV1Decision";
import { activeCfbWeeklyWindow } from "../../lib/services/football/cfbWeeklyWindow";
import { combineFootballOutcomeEvidenceShift, readFootballOutcomeMarketMovement } from "../../lib/services/football/footballOutcomeMarketMovement";

loadEnvConfig(process.cwd());

type Direction = "home" | "away" | "over" | "under";
type Market = "moneyline" | "spread" | "total";
type Signal = {
  release: string;
  week: number;
  gameId: string;
  capturedAt: string;
  channel: string;
  market: Market;
  direction: Direction;
  line: number | null;
  result: "win" | "loss" | "push";
};
type ForecastEvaluation = {
  release: string;
  week: number;
  gameId: string;
  actualAway: number;
  actualHome: number;
  independentAway: number;
  independentHome: number;
  publishedAway: number;
  publishedHome: number;
  homeLine: number | null;
  totalLine: number | null;
};
type ReplayEntry = {
  providerGameId: string;
  gameStartAt: string;
  game: NcaafGame;
  result: { awayScore: number; homeScore: number; status: string };
};
type TotalPublicCounterfactual = {
  release: string;
  capturedAt: string;
  gameId: string;
  actualAway: number;
  actualHome: number;
  incumbentAway: number;
  incumbentHome: number;
  candidateAway: number;
  candidateHome: number;
  totalLine: number | null;
  publicTotalShift: number;
};

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const evidence = await readCfbForwardEvidence({ client, season: 2026 });
  const gameIds = await cfbDatabaseGameIds(client);
  const scores = await settledScores(client, [...new Set(gameIds.values())]);
  const locked = new Map<string, (typeof evidence)[number]>();
  for (const row of evidence) {
    const cutoff = Date.parse(row.gameStartAt) - 60 * 60_000;
    if (Date.parse(row.capturedAt) > cutoff || !scores.has(gameIds.get(row.providerGameId) ?? -1)) continue;
    const prior = locked.get(row.providerGameId);
    if (!prior || Date.parse(row.capturedAt) > Date.parse(prior.capturedAt)) locked.set(row.providerGameId, row);
  }

  const signals: Signal[] = [];
  const forecasts: ForecastEvaluation[] = [];
  const replayEntries = loadReplayEntries();
  const counterfactuals: TotalPublicCounterfactual[] = [];
  const counterfactualSkips = new Map<string, number>();
  const storedCounterfactuals: TotalPublicCounterfactual[] = [];
  const storedCounterfactualSkips = new Map<string, number>();
  for (const row of locked.values()) {
    const score = scores.get(gameIds.get(row.providerGameId)!)!;
    const payload = row.payload;
    const release = payload.authoritativeForecast?.release ?? payload.decisions.modelRelease;
    const decisions = new Map(payload.decisions.evaluatedBets.map((decision) => [decision.market, decision]));
    const homeLine = homeSpreadLine(payload.market.playbookLine?.homeSpread ?? null, decisions.get("spread") ?? null, payload.game.home.abbreviation);
    const totalLine = decisions.get("total")?.evaluatedQuote.line ?? payload.market.playbookLine?.total ?? null;
    const independent = payload.contextualEvidenceCapture?.prior.outcome.expected ?? (payload.independentForecast
      ? [payload.independentForecast.expectedAwayPoints, payload.independentForecast.expectedHomePoints] as const
      : null);
    if (independent) forecasts.push({
      release,
      week: payload.week,
      gameId: row.providerGameId,
      actualAway: score.away,
      actualHome: score.home,
      independentAway: independent[0],
      independentHome: independent[1],
      publishedAway: payload.decisions.forecast.expectedAwayPoints,
      publishedHome: payload.decisions.forecast.expectedHomePoints,
      homeLine,
      totalLine,
    });
    const counterfactual = evaluateTotalPublicCounterfactual({ row, score, replayEntries, homeLine, totalLine });
    if (counterfactual.status === "evaluated") counterfactuals.push(counterfactual.value);
    else counterfactualSkips.set(counterfactual.reason, (counterfactualSkips.get(counterfactual.reason) ?? 0) + 1);
    const storedCounterfactual = evaluateStoredTotalPublicCounterfactual({ row, score, totalLine });
    if (storedCounterfactual.status === "evaluated") storedCounterfactuals.push(storedCounterfactual.value);
    else storedCounterfactualSkips.set(storedCounterfactual.reason, (storedCounterfactualSkips.get(storedCounterfactual.reason) ?? 0) + 1);
    const movement = readFootballOutcomeMarketMovement({
      opening: payload.market.operationalOpening?.quote ?? null,
      current: payload.market.current,
      evaluatedAt: row.capturedAt,
    });

    const marginMove = strongMarginMovement(movement);
    if (marginMove !== 0) {
      add(signals, row, release, "ordinary_same_book_movement", "moneyline", marginMove > 0 ? "home" : "away", null, score);
      if (homeLine !== null) add(signals, row, release, "ordinary_same_book_movement", "spread", marginMove > 0 ? "home" : "away", homeLine, score);
    }
    const totalMove = strongTotalMovement(movement);
    if (totalMove !== 0 && totalLine !== null) {
      add(signals, row, release, "ordinary_same_book_movement", "total", totalMove > 0 ? "over" : "under", totalLine, score);
    }

    const circa = latestCirca(payload.market.sharpApiSplits ?? [], row.capturedAt);
    if (circa) {
      const mlGap = circa.moneyline ? circa.moneyline.home.moneyPct - circa.moneyline.home.ticketsPct : null;
      if (mlGap !== null && Math.abs(mlGap) >= 10) add(signals, row, release, "circa_money_ticket", "moneyline", mlGap > 0 ? "home" : "away", null, score);
      const spreadGap = circa.spread && homeLine !== null && Math.abs(circa.spread.homeLine - homeLine) <= 0.5
        ? circa.spread.home.moneyPct - circa.spread.home.ticketsPct
        : null;
      if (spreadGap !== null && Math.abs(spreadGap) >= 10) add(signals, row, release, "circa_money_ticket", "spread", spreadGap > 0 ? "home" : "away", homeLine, score);
      const totalGap = circa.total && totalLine !== null && Math.abs(circa.total.line - totalLine) <= 0.5
        ? circa.total.over.moneyPct - circa.total.over.ticketsPct
        : null;
      if (totalGap !== null && Math.abs(totalGap) >= 10) add(signals, row, release, "circa_money_ticket", "total", totalGap > 0 ? "over" : "under", totalLine, score);
    }

    for (const market of ["moneyline", "spread", "total"] as const) {
      const split = payload.market.playbookSplits?.[market] ?? null;
      const line = market === "spread" ? homeLine : market === "total" ? totalLine : null;
      const divergence = publicMoneyTicketGap(split, market);
      if (divergence !== null && Math.abs(divergence) >= 8 && (market === "moneyline" || line !== null)) {
        add(signals, row, release, "public_money_ticket_divergence", market, divergence > 0
          ? market === "total" ? "over" : "home"
          : market === "total" ? "under" : "away", line, score);
      }
      const tickets = publicTicketDirection(split, market);
      const move = market === "total" ? totalMove : marginMove;
      if (tickets !== 0 && move !== 0 && Math.sign(tickets) !== Math.sign(move) && (market === "moneyline" || line !== null)) {
        add(signals, row, release, "explicit_rlm", market, move > 0
          ? market === "total" ? "over" : "home"
          : market === "total" ? "under" : "away", line, score);
      }
    }

    for (const sportsbook of ["circa", "pinnacle"] as const) {
      for (const market of ["moneyline", "spread", "total"] as const) {
        const family = payload.contextualEvidenceCapture?.markets[market].families.find((entry) => entry[0] === sportsbook) ?? null;
        if (!family?.[4] || family[4][0] >= family[5][0]) continue;
        const direction = sharpTrailDirection(market, family[4], family[5]);
        const line = market === "spread" ? homeLine : market === "total" ? totalLine : null;
        if (direction && (market === "moneyline" || line !== null)) {
          add(signals, row, release, `${sportsbook}_price_trail`, market, direction, line, score);
        }
      }
    }
  }

  const dates = [...new Set(signals.map((signal) => signal.capturedAt.slice(0, 10)))].sort();
  const confirmationStart = dates[Math.floor(dates.length * 0.7)] ?? null;
  const report = {
    release: "cfb_market_reading_signal_audit_2026_09_26_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    evidenceRows: evidence.length,
    settledLockedGames: locked.size,
    signalRows: signals.length,
    confirmationStart,
    overall: summarize(signals),
    selection: summarize(signals.filter((row) => confirmationStart === null || row.capturedAt.slice(0, 10) < confirmationStart)),
    confirmation: summarize(signals.filter((row) => confirmationStart !== null && row.capturedAt.slice(0, 10) >= confirmationStart)),
    byRelease: Object.fromEntries([...new Set(signals.map((row) => row.release))].sort().map((release) => [release, summarize(signals.filter((row) => row.release === release))])),
    byWeek: Object.fromEntries([...new Set(signals.map((row) => row.week))].sort((a, b) => a - b).map((week) => [week, summarize(signals.filter((row) => row.week === week))])),
    forecastMarriage: compareForecasts(forecasts),
    forecastMarriageByEvidence: Object.fromEntries([...new Set(signals.map((row) => `${row.channel}|${row.market}`))].sort().map((key) => {
      const gameSet = new Set(signals.filter((row) => `${row.channel}|${row.market}` === key).map((row) => row.gameId));
      return [key, compareForecasts(forecasts.filter((row) => gameSet.has(row.gameId)))];
    })),
    forecastMarriageByRelease: Object.fromEntries([...new Set(forecasts.map((row) => row.release))].sort().map((release) => [release, compareForecasts(forecasts.filter((row) => row.release === release))])),
    publicTotalCounterfactual: summarizeTotalPublicCounterfactual(counterfactuals),
    publicTotalCounterfactualSelection: summarizeTotalPublicCounterfactual(counterfactuals.filter((row) => confirmationStart === null || row.capturedAt.slice(0, 10) < confirmationStart)),
    publicTotalCounterfactualConfirmation: summarizeTotalPublicCounterfactual(counterfactuals.filter((row) => confirmationStart !== null && row.capturedAt.slice(0, 10) >= confirmationStart)),
    publicTotalCounterfactualByRelease: Object.fromEntries([...new Set(counterfactuals.map((row) => row.release))].sort().map((release) => [release, summarizeTotalPublicCounterfactual(counterfactuals.filter((row) => row.release === release))])),
    publicTotalCounterfactualSkips: Object.fromEntries([...counterfactualSkips].sort(([a], [b]) => a.localeCompare(b))),
    storedPublicTotalCounterfactual: summarizeTotalPublicCounterfactual(storedCounterfactuals),
    storedPublicTotalCounterfactualSelection: summarizeTotalPublicCounterfactual(storedCounterfactuals.filter((row) => confirmationStart === null || row.capturedAt.slice(0, 10) < confirmationStart)),
    storedPublicTotalCounterfactualConfirmation: summarizeTotalPublicCounterfactual(storedCounterfactuals.filter((row) => confirmationStart !== null && row.capturedAt.slice(0, 10) >= confirmationStart)),
    storedPublicTotalCounterfactualByRelease: Object.fromEntries([...new Set(storedCounterfactuals.map((row) => row.release))].sort().map((release) => [release, summarizeTotalPublicCounterfactual(storedCounterfactuals.filter((row) => row.release === release))])),
    storedPublicTotalCounterfactualSkips: Object.fromEntries([...storedCounterfactualSkips].sort(([a], [b]) => a.localeCompare(b))),
  };
  const output = process.argv.includes("--counterfactual-only")
    ? {
        release: report.release,
        mode: report.mode,
        settledLockedGames: report.settledLockedGames,
        confirmationStart: report.confirmationStart,
        forecastMarriage: report.forecastMarriage,
        forecastMarriageByRelease: report.forecastMarriageByRelease,
        publicTotalCounterfactual: report.publicTotalCounterfactual,
        publicTotalCounterfactualSkips: report.publicTotalCounterfactualSkips,
        storedPublicTotalCounterfactual: report.storedPublicTotalCounterfactual,
        storedPublicTotalCounterfactualSelection: report.storedPublicTotalCounterfactualSelection,
        storedPublicTotalCounterfactualConfirmation: report.storedPublicTotalCounterfactualConfirmation,
        storedPublicTotalCounterfactualByRelease: report.storedPublicTotalCounterfactualByRelease,
        storedPublicTotalCounterfactualSkips: report.storedPublicTotalCounterfactualSkips,
      }
    : report;
  console.log(JSON.stringify(output, null, 2));
}

function evaluateStoredTotalPublicCounterfactual(args: {
  row: Awaited<ReturnType<typeof readCfbForwardEvidence>>[number];
  score: { home: number; away: number };
  totalLine: number | null;
}): { status: "evaluated"; value: TotalPublicCounterfactual } | { status: "skipped"; reason: string } {
  const payload = args.row.payload;
  const forecast = payload.decisions.forecast as typeof payload.decisions.forecast & {
    marketWeight?: number;
    sharpAdjustment?: {
      totalShiftPoints?: number;
      adjustedAnchor?: { homeSpread: number; totalLine: number; namedBookCount: number; source: "named_book_median" | "exact_target_book" | "playbook_context" };
    };
    publicConsensusAdjustment?: { totalShiftPoints?: number };
    marketMovementAdjustment?: { totalShiftPoints?: number };
  };
  const publicShift = forecast.publicConsensusAdjustment?.totalShiftPoints;
  if (typeof publicShift !== "number" || Math.abs(publicShift) < 1e-10) return { status: "skipped", reason: "no_stored_public_total_shift" };
  const adjustedAnchor = forecast.sharpAdjustment?.adjustedAnchor;
  if (!adjustedAnchor) return { status: "skipped", reason: "missing_stored_adjusted_anchor" };
  const sharpShift = forecast.sharpAdjustment?.totalShiftPoints;
  const movementShift = forecast.marketMovementAdjustment?.totalShiftPoints;
  if (typeof sharpShift !== "number" || typeof movementShift !== "number") return { status: "skipped", reason: "missing_stored_component_shift" };
  const incumbentCombinedShift = combineFootballOutcomeEvidenceShift({
    sharpShift,
    movementShift,
    publicShift,
    maximum: 1.5,
  });
  const candidateCombinedShift = combineFootballOutcomeEvidenceShift({
    sharpShift,
    movementShift,
    publicShift: 0,
    maximum: 1.5,
  });
  const candidateAnchor = {
    ...adjustedAnchor,
    totalLine: adjustedAnchor.totalLine - incumbentCombinedShift + candidateCombinedShift,
  };
  const independentShell = forecast as unknown as CfbV1Forecast;
  const incumbentMarket = buildCfbMarketInformedOutcomeForecast({ independentForecast: independentShell, anchor: adjustedAnchor });
  const candidateMarket = buildCfbMarketInformedOutcomeForecast({ independentForecast: independentShell, anchor: candidateAnchor });
  const weight = typeof forecast.marketWeight === "number" ? forecast.marketWeight : 0.75;
  return {
    status: "evaluated",
    value: {
      release: payload.authoritativeForecast?.release ?? payload.decisions.modelRelease,
      capturedAt: args.row.capturedAt,
      gameId: args.row.providerGameId,
      actualAway: args.score.away,
      actualHome: args.score.home,
      incumbentAway: forecast.expectedAwayPoints,
      incumbentHome: forecast.expectedHomePoints,
      candidateAway: forecast.expectedAwayPoints + weight * (candidateMarket.expectedAwayPoints - incumbentMarket.expectedAwayPoints),
      candidateHome: forecast.expectedHomePoints + weight * (candidateMarket.expectedHomePoints - incumbentMarket.expectedHomePoints),
      totalLine: args.totalLine,
      publicTotalShift: publicShift,
    },
  };
}

function loadReplayEntries(): ReplayEntry[] {
  const path = process.argv.find((value) => value.startsWith("--replay="))?.slice("--replay=".length) ??
    "/private/tmp/oddsphere-cfb-professional-score-engine-20260926/football-research/cache/cfb-model/current/cfb_2026_forward_replay_r3.json";
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { games?: ReplayEntry[] };
  if (!Array.isArray(parsed.games)) throw new Error(`CFB replay export has no games array: ${path}`);
  return parsed.games;
}

function evaluateTotalPublicCounterfactual(args: {
  row: Awaited<ReturnType<typeof readCfbForwardEvidence>>[number];
  score: { home: number; away: number };
  replayEntries: ReplayEntry[];
  homeLine: number | null;
  totalLine: number | null;
}): { status: "evaluated"; value: TotalPublicCounterfactual } | { status: "skipped"; reason: string } {
  const payload = args.row.payload;
  const expectedHash = payload.contextualEvidenceCapture?.prior.outcome.pmf.sha256 ?? null;
  if (!expectedHash) return { status: "skipped", reason: "missing_independent_pmf_hash" };
  const before = activeCfbWeeklyWindow(payload.capturedAt).boardStartDate;
  const priorGames = args.replayEntries
    .filter((entry) => entry.gameStartAt.slice(0, 10) < before)
    .map((entry) => ({
      ...entry.game,
      status: "final",
      awayScore: entry.result.awayScore,
      homeScore: entry.result.homeScore,
    }));
  const independent = getCfbV1ForecastForGame({ game: payload.game, completedGames: priorGames }).forecast;
  const actualHash = createHash("sha256").update(JSON.stringify(independent.pmf)).digest("hex");
  if (actualHash !== expectedHash) return { status: "skipped", reason: "independent_pmf_hash_mismatch" };
  const anchor = resolveCfbCanonicalMarketAnchor({
    books: payload.market.currentBooks,
    contextLines: {
      homeSpread: payload.market.playbookLine?.homeSpread ?? null,
      totalLine: payload.market.playbookLine?.total ?? null,
    },
  });
  if (!anchor) return { status: "skipped", reason: "market_anchor_unavailable" };
  const common = {
    independentForecast: independent,
    anchor,
    current: payload.market.current,
    operationalOpening: payload.market.operationalOpening,
    sharpSplits: payload.market.sharpApiSplits ?? [],
    playbookLine: payload.market.playbookLine,
    kickoffWeather: payload.availability.weather,
    evaluatedAt: payload.capturedAt,
  };
  const incumbent = buildCfbMarketSharpAwareForecast({ ...common, publicSplits: payload.market.playbookSplits });
  const published = payload.decisions.forecast;
  if (Math.abs(incumbent.expectedAwayPoints - published.expectedAwayPoints) > 1e-8 ||
      Math.abs(incumbent.expectedHomePoints - published.expectedHomePoints) > 1e-8) {
    return { status: "skipped", reason: "incumbent_replay_mismatch" };
  }
  const neutralPublicSplits = neutralizePublicTotalGap(payload.market.playbookSplits);
  const candidate = buildCfbMarketSharpAwareForecast({ ...common, publicSplits: neutralPublicSplits });
  if (Math.abs(candidate.expectedTotal - incumbent.expectedTotal) < 1e-10) {
    return { status: "skipped", reason: "no_public_total_forecast_shift" };
  }
  return {
    status: "evaluated",
    value: {
      release: payload.authoritativeForecast?.release ?? payload.decisions.modelRelease,
      capturedAt: args.row.capturedAt,
      gameId: args.row.providerGameId,
      actualAway: args.score.away,
      actualHome: args.score.home,
      incumbentAway: incumbent.expectedAwayPoints,
      incumbentHome: incumbent.expectedHomePoints,
      candidateAway: candidate.expectedAwayPoints,
      candidateHome: candidate.expectedHomePoints,
      totalLine: args.totalLine,
      publicTotalShift: incumbent.publicConsensusAdjustment.totalShiftPoints,
    },
  };
}

function neutralizePublicTotalGap(splits: CfbForwardPlaybookSplitSet | null): CfbForwardPlaybookSplitSet | null {
  if (!splits) return null;
  return {
    ...splits,
    total: {
      ...splits.total,
      overMoneyPct: splits.total.overBetsPct,
      underMoneyPct: splits.total.underBetsPct,
    },
  };
}

function summarizeTotalPublicCounterfactual(rows: TotalPublicCounterfactual[]) {
  const totals = rows.filter((row) => row.totalLine !== null && row.actualAway + row.actualHome !== row.totalLine);
  const metric = (kind: "incumbent" | "candidate") => {
    const away = (row: TotalPublicCounterfactual) => kind === "incumbent" ? row.incumbentAway : row.candidateAway;
    const home = (row: TotalPublicCounterfactual) => kind === "incumbent" ? row.incumbentHome : row.candidateHome;
    return {
      games: rows.length,
      teamScoreMae: mean(rows.flatMap((row) => [Math.abs(away(row) - row.actualAway), Math.abs(home(row) - row.actualHome)])),
      totalMae: mean(rows.map((row) => Math.abs(away(row) + home(row) - row.actualAway - row.actualHome))),
      totalAccuracy: accuracy(totals.map((row) => ((away(row) + home(row) - row.totalLine!) > 0) === (row.actualAway + row.actualHome - row.totalLine! > 0))),
    };
  };
  return {
    shiftedGames: rows.length,
    overShiftGames: rows.filter((row) => row.publicTotalShift > 0).length,
    underShiftGames: rows.filter((row) => row.publicTotalShift < 0).length,
    incumbent: metric("incumbent"),
    candidateWithoutPublicTotalGap: metric("candidate"),
  };
}

function add(signals: Signal[], row: { providerGameId: string; capturedAt: string; payload: { week: number } }, release: string, channel: string, market: Market, direction: Direction, line: number | null, score: { home: number; away: number }) {
  const result = settle(direction, line, score);
  if (result) signals.push({ release, week: row.payload.week, gameId: row.providerGameId, capturedAt: row.capturedAt, channel, market, direction, line, result });
}

function settle(direction: Direction, line: number | null, score: { home: number; away: number }): Signal["result"] | null {
  if (direction === "home" || direction === "away") {
    const value = score.home - score.away + (line ?? 0);
    if (value === 0) return "push";
    return (direction === "home") === (value > 0) ? "win" : "loss";
  }
  if (line === null) return null;
  const value = score.home + score.away - line;
  if (value === 0) return "push";
  return (direction === "over") === (value > 0) ? "win" : "loss";
}

function summarize(rows: Signal[]) {
  const keys = [...new Set(rows.map((row) => `${row.channel}|${row.market}`))].sort();
  return Object.fromEntries(keys.map((key) => {
    const cohort = rows.filter((row) => `${row.channel}|${row.market}` === key);
    const wins = cohort.filter((row) => row.result === "win").length;
    const losses = cohort.filter((row) => row.result === "loss").length;
    const pushes = cohort.length - wins - losses;
    return [key, { rows: cohort.length, wins, losses, pushes, accuracy: wins + losses > 0 ? round(wins / (wins + losses)) : null }];
  }));
}

function compareForecasts(rows: ForecastEvaluation[]) {
  const metrics = (kind: "independent" | "published") => {
    const away = (row: ForecastEvaluation) => kind === "independent" ? row.independentAway : row.publishedAway;
    const home = (row: ForecastEvaluation) => kind === "independent" ? row.independentHome : row.publishedHome;
    const spread = rows.filter((row) => row.homeLine !== null && row.actualHome - row.actualAway + row.homeLine !== 0);
    const totals = rows.filter((row) => row.totalLine !== null && row.actualHome + row.actualAway - row.totalLine !== 0);
    const winners = rows.filter((row) => row.actualHome !== row.actualAway);
    return {
      games: rows.length,
      teamScoreMae: mean(rows.flatMap((row) => [Math.abs(away(row) - row.actualAway), Math.abs(home(row) - row.actualHome)])),
      marginMae: mean(rows.map((row) => Math.abs((home(row) - away(row)) - (row.actualHome - row.actualAway)))),
      totalMae: mean(rows.map((row) => Math.abs((home(row) + away(row)) - (row.actualHome + row.actualAway)))),
      winnerAccuracy: accuracy(winners.map((row) => ((home(row) - away(row)) >= 0) === (row.actualHome > row.actualAway))),
      spreadAccuracy: accuracy(spread.map((row) => ((home(row) - away(row) + row.homeLine!) > 0) === (row.actualHome - row.actualAway + row.homeLine! > 0))),
      totalAccuracy: accuracy(totals.map((row) => ((home(row) + away(row) - row.totalLine!) > 0) === (row.actualHome + row.actualAway - row.totalLine! > 0))),
    };
  };
  return { independent: metrics("independent"), published: metrics("published") };
}

function mean(values: number[]): number | null { return values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null; }
function accuracy(values: boolean[]): number | null { return values.length > 0 ? round(values.filter(Boolean).length / values.length) : null; }

function strongMarginMovement(value: ReturnType<typeof readFootballOutcomeMarketMovement>): number {
  if (value.status !== "available") return 0;
  if (value.homeMarginLineDelta !== null && Math.abs(value.homeMarginLineDelta) >= 0.5) return value.homeMarginLineDelta;
  if (value.homeMarginFairProbabilityDeltaPp !== null && Math.abs(value.homeMarginFairProbabilityDeltaPp) >= 1.5) return value.homeMarginFairProbabilityDeltaPp;
  return 0;
}

function strongTotalMovement(value: ReturnType<typeof readFootballOutcomeMarketMovement>): number {
  if (value.status !== "available") return 0;
  if (value.totalLineDelta !== null && Math.abs(value.totalLineDelta) >= 0.5) return value.totalLineDelta;
  if (value.overFairProbabilityDeltaPp !== null && Math.abs(value.overFairProbabilityDeltaPp) >= 1.5) return value.overFairProbabilityDeltaPp;
  return 0;
}

function publicMoneyTicketGap(split: CfbForwardPlaybookSplit | null, market: Market): number | null {
  if (!split) return null;
  if (market === "total") return split.overMoneyPct !== null && split.overBetsPct !== null ? split.overMoneyPct - split.overBetsPct : null;
  return split.homeMoneyPct !== null && split.homeBetsPct !== null ? split.homeMoneyPct - split.homeBetsPct : null;
}

function publicTicketDirection(split: CfbForwardPlaybookSplit | null, market: Market): number {
  if (!split) return 0;
  const first = market === "total" ? split.overBetsPct : split.homeBetsPct;
  const second = market === "total" ? split.underBetsPct : split.awayBetsPct;
  return first !== null && second !== null && Math.abs(first - second) >= 10 ? Math.sign(first - second) : 0;
}

function latestCirca(rows: CfbSharpApiSplitRecord[], evaluatedAt: string): CfbSharpApiSplitRecord | null {
  const evaluated = Date.parse(evaluatedAt);
  return rows.filter((row) => row.sportsbook === "circa" && row.sourceSemantics === "sharp_adjacent")
    .filter((row) => { const age = (evaluated - Date.parse(row.capturedAt)) / 60_000; return age >= 0 && age <= 120; })
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0] ?? null;
}

function homeSpreadLine(playbook: number | null, decision: { side: string; evaluatedQuote: { line: number | null } } | null, home: string): number | null {
  if (decision?.evaluatedQuote.line !== null && decision?.evaluatedQuote.line !== undefined) return decision.side.startsWith(home) ? decision.evaluatedQuote.line : -decision.evaluatedQuote.line;
  return playbook;
}

function sharpTrailDirection(market: Market, opening: readonly [string, number, string, number | null, number, number], current: readonly [string, number, string, number | null, number, number]): Direction | null {
  const lineMove = opening[3] !== null && current[3] !== null
    ? market === "spread" ? opening[3] - current[3] : current[3] - opening[3]
    : null;
  if (lineMove !== null && Math.abs(lineMove) >= 0.5) return lineMove > 0 ? market === "total" ? "over" : "home" : market === "total" ? "under" : "away";
  const fairMove = 100 * (fair(current[5], current[4]) - fair(opening[5], opening[4]));
  if (Math.abs(fairMove) < 1.5) return null;
  return fairMove > 0 ? market === "total" ? "under" : "home" : market === "total" ? "over" : "away";
}

function fair(selected: number, opposing: number): number { const a = implied(selected); const b = implied(opposing); return a / (a + b); }
function implied(price: number): number { return price > 0 ? 100 / (price + 100) : -price / (-price + 100); }
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }

async function cfbDatabaseGameIds(client: SupabaseClient): Promise<Map<string, number>> {
  const output = new Map<string, number>();
  for (let from = 0; from < 5_000; from += 1_000) {
    const { data, error } = await client.from("prediction_records").select("external_id,game_id").eq("sport", "cfb").not("locked_at", "is", null).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) if (row.external_id !== null && row.game_id !== null) output.set(String(row.external_id), Number(row.game_id));
    if ((data ?? []).length < 1_000) break;
  }
  return output;
}

async function settledScores(client: SupabaseClient, ids: number[]): Promise<Map<number, { home: number; away: number }>> {
  const output = new Map<number, { home: number; away: number }>();
  for (let index = 0; index < ids.length; index += 200) {
    const { data, error } = await client.from("games").select("id,home_score,away_score,status").in("id", ids.slice(index, index + 200));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) if (typeof row.home_score === "number" && typeof row.away_score === "number") output.set(Number(row.id), { home: row.home_score, away: row.away_score });
  }
  return output;
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
