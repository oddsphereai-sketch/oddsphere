import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import { readNflPlayerPropsSnapshotRecord } from "../../lib/services/football/nflPlayerPropsSnapshotStore";
import {
  gradeNflPlayerPropsCrossMarketCandidate,
  nflPlayerPropsExpectedValue,
  nflPlayerPropsProductionMarketLane,
  nflPlayerPropsRawMarketDivergenceImplausible,
  nflPlayerPropsResidualProbability,
  nflPlayerPropsRuntimeMarketPolicy,
  nflPlayerPropsRuntimePolicy,
  type NflPlayerPropsRuntimeDecision,
} from "../../lib/services/football/nflPlayerPropsRuntime";
import {
  selectNflPlayerPropsOverForecasts,
  selectNflPlayerPropsTouchdownScorers,
  nflPlayerPropsOverUnderMarketKey,
  nflPlayerPropsTouchdownPlayerKey,
} from "../../lib/services/football/nflPlayerPropsPrediction";
import { NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE, type NflForwardStoredEvidence } from "../../lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";

loadEnvConfig(process.cwd());

const season = numberArg("--season", 2026);
const week = numberArg("--week", 2);
const includeResults = process.argv.includes("--results");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bdlKey = process.env.BALLDONTLIE_API_KEY;
if (!url || !key) throw new Error("Supabase read credentials are required.");
if (includeResults && !bdlKey) throw new Error("BALLDONTLIE_API_KEY is required for result scoring.");

type Stat = Record<string, unknown>;
type Scored = {
  market: string;
  side: "over" | "under" | "yes" | "no";
  probability: number;
  result: "win" | "loss" | "push";
  actual: number;
  row: NflPlayerPropsRuntimeDecision;
};
type ProbabilityScore = {
  market: string;
  actual: 0 | 1;
  raw: number;
  marketProbability: number;
  final: number;
  independentMarket: boolean;
};

async function main(): Promise<void> {
  const client = createClient(url!, key!, { auth: { persistSession: false } });
  if (process.argv.includes("--forward-depth-only")) {
    const evidence = await readNflForwardEvidence({ client, season, week });
    const latest = new Map<string, NflForwardStoredEvidence>();
    for (const row of evidence) {
      const previous = latest.get(row.providerGameId);
      if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) latest.set(row.providerGameId, row);
    }
    const payload = {
      readOnly: true,
      season,
      week,
      storedRows: evidence.length,
      games: [...latest.values()].map((row) => ({
        gameId: row.providerGameId,
        capturedAt: row.capturedAt,
        away: row.payload.startersAndDepth.away,
        home: row.payload.startersAndDepth.home,
      })),
    };
    const outputPath = stringArg("--output");
    if (outputPath) await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(outputPath
      ? { readOnly: true, season, week, outputPath, storedRows: evidence.length, games: latest.size }
      : payload, null, 2));
    return;
  }
  const record = await readNflPlayerPropsSnapshotRecord({ client, season, week });
  if (!record) throw new Error(`NFL props snapshot is unavailable for ${season} Week ${week}.`);
  const rows = record.snapshot.board.decisions;
  const grouped = groupPredictions(rows);
  const report: Record<string, unknown> = {
    readOnly: true,
    season,
    week,
    generatedAt: record.generatedAt,
    release: record.snapshot.release,
    boardRelease: record.snapshot.board.release,
    diagnostics: record.snapshot.board.diagnostics,
    rows: rows.length,
    memberRows: record.snapshot.memberDecisions.length,
    games: new Set(rows.map((row) => row.gameId)).size,
    players: new Set(rows.map((row) => `${row.gameId}|${normalize(row.playerName)}`)).size,
    lockedRows: rows.filter((row) => row.state === "locked").length,
    byMarket: summarizeMarkets(rows, grouped),
    touchdowns: summarizeTouchdowns(rows),
  };
  if (includeResults) {
    const locked = rows.filter((row) => row.state === "locked");
    const stats = await readStats(rows);
    const scored = score(groupPredictions(rows), stats);
    const lockedScored = score(groupPredictions(locked), stats);
    const probabilityScores = scoreProbabilities(groupPredictions(rows), stats);
    report.results = summarizeResults(scored, lockedScored, probabilityScores, rows, stats);
  }
  if (process.argv.includes("--touchdown-candidate-context")) {
    const stats = includeResults ? await readStats(rows) : new Map<string, Map<string, Stat>>();
    const forwardEvidence = await readNflForwardEvidence({ client, season, week });
    const players = new Map<string, NflPlayerPropsRuntimeDecision>();
    for (const row of rows) {
      const key = `${row.gameId}|${normalize(row.playerName)}`;
      const previous = players.get(key);
      if (!previous || (row.market === "anytime_td" && previous.market !== "anytime_td")) players.set(key, row);
    }
    const candidatePayload = {
      readOnly: true,
      season,
      week,
      candidates: [...players.values()].map((row) => {
        const stat = row.providerPlayerId ? stats.get(row.gameId)?.get(row.providerPlayerId) : undefined;
        const depth = depthPlayerForDecision(forwardEvidence, row);
        return {
          gameId: row.gameId,
          playerName: row.playerName,
          providerPlayerId: row.providerPlayerId,
          team: row.team,
          opponent: row.opponent,
          position: row.forecastContext.position,
          depth: depth?.player.depth ?? null,
          depthRank: depth?.player.depthRank ?? null,
          explicitStarter: depth?.player.explicitStarter ?? null,
          rosterInjuryStatus: depth?.player.injuryStatus ?? null,
          rosterCapturedAt: depth?.capturedAt ?? null,
          teamImpliedTouchdowns: row.forecastContext.teamImpliedTouchdowns,
          offeredAnytimeTouchdown: row.market === "anytime_td",
          incumbentRawProbability: row.market === "anytime_td" ? row.rawModelProbability : null,
          marketProbability: row.market === "anytime_td" ? row.marketProbability : null,
          incumbentFinalProbability: row.market === "anytime_td" ? row.finalProbability : null,
          independentMarket: row.market === "anytime_td"
            ? !row.healthHolds.includes("independent_same_line_confirmation_missing")
            : null,
          actualTouchdowns: stat ? actualValue("anytime_td", stat) : null,
        };
      }),
    };
    const outputPath = stringArg("--output");
    if (outputPath) await writeFile(outputPath, `${JSON.stringify(candidatePayload, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(outputPath
      ? { readOnly: true, season, week, outputPath, candidates: candidatePayload.candidates.length }
      : candidatePayload, null, 2));
  } else if (process.argv.includes("--confidence-candidate-summary")) {
    const compactResults = report.results as { confidenceCandidateActionability?: unknown } | undefined;
    console.log(JSON.stringify({
      readOnly: true,
      season,
      week,
      confidenceCandidateActionability: compactResults?.confidenceCandidateActionability,
    }, null, 2));
  } else if (process.argv.includes("--actionability-evidence-summary")) {
    const compactResults = report.results as { rankedActionability?: unknown; gradeMarketSide?: unknown; weightCandidateActionability?: unknown; confidenceCandidateActionability?: unknown } | undefined;
    console.log(JSON.stringify({
      readOnly: true,
      season,
      week,
      gradeMarketSide: compactResults?.gradeMarketSide,
      weightCandidateActionability: compactResults?.weightCandidateActionability,
      confidenceCandidateActionability: compactResults?.confidenceCandidateActionability,
      rankedActionability: compactResults?.rankedActionability,
    }, null, 2));
  } else if (process.argv.includes("--ranked-summary")) {
    const compactResults = report.results as { rankedTouchdownCohort?: unknown; probabilityQuality?: { byMarket?: Record<string, Record<string, { rankedExpectedPrevalence?: unknown; sideAccuracy?: unknown }>> } } | undefined;
    const byMarket = compactResults?.probabilityQuality?.byMarket ?? {};
    console.log(JSON.stringify({
      readOnly: true,
      season,
      week,
      rankedTouchdownCohort: compactResults?.rankedTouchdownCohort,
      rankedExpectedPrevalenceByMarket: Object.fromEntries(Object.entries(byMarket).map(([market, values]) => [market, Object.fromEntries(
        ["raw", "market", "final", "marketResidualWeight0.00", "marketResidualWeight0.05", "marketResidualWeight0.10", "marketResidualWeight0.20"]
          .filter((name) => values[name])
          .map((name) => [name, { sideAccuracy: values[name]!.sideAccuracy, ranked: values[name]!.rankedExpectedPrevalence }]),
      )])),
    }, null, 2));
  } else console.log(JSON.stringify(report, null, 2));
}

function depthPlayerForDecision(evidence: NflForwardStoredEvidence[], row: NflPlayerPropsRuntimeDecision) {
  const featureAsOf = Date.parse(row.forecastContext.featureAsOf);
  const latest = evidence
    .filter((candidate) => candidate.providerGameId === row.gameId
      && candidate.payload.schemaRelease === NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE
      && Date.parse(candidate.capturedAt) <= featureAsOf)
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
  if (!latest || latest.payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE) return null;
  const teams = [latest.payload.startersAndDepth.away, latest.payload.startersAndDepth.home];
  const normalizedName = normalize(row.playerName);
  for (const team of teams) {
    if (team.team !== row.team) continue;
    const player = team.roster.find((candidate) => normalize(candidate.name) === normalizedName);
    if (player) return { player, capturedAt: team.capturedAt };
  }
  return null;
}

function groupPredictions(rows: NflPlayerPropsRuntimeDecision[]): NflPlayerPropsRuntimeDecision[][] {
  const grouped = new Map<string, NflPlayerPropsRuntimeDecision[]>();
  for (const row of rows) {
    const key = [row.gameId, normalize(row.playerName), row.market, row.line].join("|");
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.values()];
}

function summarizeMarkets(rows: NflPlayerPropsRuntimeDecision[], grouped: NflPlayerPropsRuntimeDecision[][]) {
  const rankedOvers = selectNflPlayerPropsOverForecasts(rows);
  return Object.fromEntries([...new Set(rows.map((row) => row.market))].sort().map((market) => {
    const marketRows = rows.filter((row) => row.market === market);
    const pairs = grouped.filter((values) => values[0]?.market === market);
    const predictions = pairs.map(resolvePrediction).filter((value): value is NonNullable<typeof value> => value !== null);
    return [market, {
      rows: marketRows.length,
      markets: pairs.length,
      games: new Set(marketRows.map((row) => row.gameId)).size,
      players: new Set(marketRows.map((row) => `${row.gameId}|${normalize(row.playerName)}`)).size,
      sides: counts(marketRows.map((row) => row.side)),
      forecastSides: counts(predictions.map((row) => row.side)),
      rankedForecastSides: market === "anytime_td" ? null : {
        over: pairs.filter((values) => values[0] && rankedOvers.has(nflPlayerPropsOverUnderMarketKey(values[0]))).length,
        under: pairs.filter((values) => values[0] && !rankedOvers.has(nflPlayerPropsOverUnderMarketKey(values[0]))).length,
      },
      grades: counts(marketRows.map((row) => row.grade)),
      probability: quantiles(predictions.map((row) => row.probability)),
    }];
  }));
}

function summarizeTouchdowns(rows: NflPlayerPropsRuntimeDecision[]) {
  const values = rows.filter((row) => row.market === "anytime_td" && row.side === "yes");
  const byTeam = new Map<string, NflPlayerPropsRuntimeDecision[]>();
  for (const row of values) {
    const key = `${row.gameId}|${row.team}`;
    byTeam.set(key, [...(byTeam.get(key) ?? []), row]);
  }
  for (const teamRows of byTeam.values()) teamRows.sort((a, b) => b.finalProbability - a.finalProbability);
  return {
    offeredPlayers: values.length,
    teams: byTeam.size,
    probability: quantiles(values.map((row) => row.finalProbability)),
    expectedScorers: round(values.reduce((sum, row) => sum + row.finalProbability, 0)),
    teamsWithAtLeastOnePlayerAt: Object.fromEntries([0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5].map((threshold) => [
      threshold.toFixed(2),
      [...byTeam.values()].filter((teamRows) => teamRows.some((row) => row.finalProbability >= threshold)).length,
    ])),
    topTwoPerTeam: [...byTeam.entries()].map(([team, teamRows]) => ({
      team,
      players: teamRows.slice(0, 2).map((row) => ({ name: row.playerName, probability: round(row.finalProbability), grade: row.grade })),
    })),
  };
}

async function readStats(rows: NflPlayerPropsRuntimeDecision[]): Promise<Map<string, Map<string, Stat>>> {
  const gameIds = [...new Set(rows.map((row) => row.gameId))];
  const output = new Map<string, Map<string, Stat>>();
  for (let index = 0; index < gameIds.length; index += 3) {
    await Promise.all(gameIds.slice(index, index + 3).map(async (gameId) => {
      const request = new URL("https://api.balldontlie.io/nfl/v1/stats");
      request.searchParams.append("game_ids[]", gameId);
      request.searchParams.set("per_page", "100");
      const response = await fetch(request, {
        headers: { Authorization: bdlKey!, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`BALLDONTLIE stats ${gameId} failed with HTTP ${response.status}.`);
      const body = await response.json() as { data?: unknown[]; meta?: { next_cursor?: unknown } };
      if (!Array.isArray(body.data) || body.meta?.next_cursor) throw new Error(`BALLDONTLIE stats ${gameId} exceeded its exact-game contract.`);
      const byPlayer = new Map<string, Stat>();
      for (const stat of body.data) {
        if (!stat || typeof stat !== "object") continue;
        const player = (stat as Stat).player;
        if (!player || typeof player !== "object") continue;
        const id = (player as Stat).id;
        if (typeof id === "number" || typeof id === "string") byPlayer.set(String(id), stat as Stat);
      }
      output.set(gameId, byPlayer);
    }));
  }
  return output;
}

function score(groups: NflPlayerPropsRuntimeDecision[][], stats: Map<string, Map<string, Stat>>): Scored[] {
  const output: Scored[] = [];
  for (const group of groups) {
    const prediction = resolvePrediction(group);
    if (!prediction || !prediction.row.providerPlayerId) continue;
    const stat = stats.get(prediction.row.gameId)?.get(prediction.row.providerPlayerId);
    if (!stat) continue;
    const actual = actualValue(prediction.row.market, stat);
    if (actual === null) continue;
    const result = prediction.side === "yes"
      ? actual >= 1 ? "win" : "loss"
      : prediction.side === "no"
        ? actual < 1 ? "win" : "loss"
        : actual === prediction.row.line ? "push"
          : prediction.side === "over" ? actual > prediction.row.line ? "win" : "loss"
            : actual < prediction.row.line ? "win" : "loss";
    output.push({ ...prediction, market: prediction.row.market, result, actual });
  }
  return output;
}

function scoreProbabilities(groups: NflPlayerPropsRuntimeDecision[][], stats: Map<string, Map<string, Stat>>): ProbabilityScore[] {
  const output: ProbabilityScore[] = [];
  for (const group of groups) {
    const yes = group.find((row) => row.side === "yes");
    const over = group.find((row) => row.side === "over");
    const row = yes ?? over ?? group[0];
    if (!row?.providerPlayerId) continue;
    const stat = stats.get(row.gameId)?.get(row.providerPlayerId);
    if (!stat) continue;
    const actualValueForMarket = actualValue(row.market, stat);
    if (actualValueForMarket === null || (!yes && actualValueForMarket === row.line)) continue;
    output.push({
      market: row.market,
      actual: yes ? Number(actualValueForMarket >= 1) as 0 | 1 : Number(actualValueForMarket > row.line) as 0 | 1,
      raw: row.rawModelProbability,
      marketProbability: row.marketProbability,
      final: row.finalProbability,
      independentMarket: !row.healthHolds.includes("independent_same_line_confirmation_missing"),
    });
  }
  return output;
}

function summarizeResults(scored: Scored[], lockedScored: Scored[], probabilityScores: ProbabilityScore[], rows: NflPlayerPropsRuntimeDecision[], stats: Map<string, Map<string, Stat>>) {
  const td = scored.filter((row) => row.market === "anytime_td");
  const positiveTd = td.map((row) => ({
    ...row,
    side: "yes" as const,
    probability: row.row.finalProbability,
    result: row.actual >= 1 ? "win" as const : "loss" as const,
  }));
  const touchdownScorers = selectNflPlayerPropsTouchdownScorers(rows);
  const touchdownCandidates = rows.filter((row) => row.market === "anytime_td" && row.side === "yes" && row.providerPlayerId)
    .flatMap((row) => {
      const stat = stats.get(row.gameId)?.get(row.providerPlayerId!);
      return stat ? [{ selected: touchdownScorers.has(nflPlayerPropsTouchdownPlayerKey(row)), scored: (actualValue("anytime_td", stat) ?? 0) >= 1 }] : [];
    });
  const touchdownTruePositives = touchdownCandidates.filter((row) => row.selected && row.scored).length;
  const touchdownSelected = touchdownCandidates.filter((row) => row.selected).length;
  const touchdownActual = touchdownCandidates.filter((row) => row.scored).length;
  return {
    scoredPredictions: scored.length,
    locked: resultLine(lockedScored),
    unscoredPlayers: new Set(rows.filter((row) => row.providerPlayerId && !stats.get(row.gameId)?.has(row.providerPlayerId)).map((row) => `${row.gameId}|${row.providerPlayerId}`)).size,
    overall: resultLine(scored),
    rankedTouchdownCohort: {
      selected: touchdownSelected,
      truePositives: touchdownTruePositives,
      observedScorers: touchdownActual,
      precision: touchdownSelected ? round(touchdownTruePositives / touchdownSelected) : null,
      recall: touchdownActual ? round(touchdownTruePositives / touchdownActual) : null,
      accuracy: touchdownCandidates.length ? round(touchdownCandidates.filter((row) => row.selected === row.scored).length / touchdownCandidates.length) : null,
    },
    byMarket: Object.fromEntries([...new Set(scored.map((row) => row.market))].sort().map((market) => [market, resultLine(scored.filter((row) => row.market === market))])),
    byForecastSide: Object.fromEntries([...new Set(scored.map((row) => row.side))].sort().map((side) => [side, resultLine(scored.filter((row) => row.side === side))])),
    gradeMarketSide: summarizeGradeMarketSide(rows, stats),
    weightCandidateActionability: summarizeWeightCandidateActionability(rows, stats),
    confidenceCandidateActionability: summarizeConfidenceCandidateActionability(rows, stats),
    rankedActionability: summarizeRankedActionability(rows, stats),
    probabilityQuality: {
      all: probabilityComparison(probabilityScores),
      independentMarketOnly: probabilityComparison(probabilityScores.filter((row) => row.independentMarket)),
      byMarket: Object.fromEntries([...new Set(probabilityScores.map((row) => row.market))].sort().map((market) => [
        market,
        probabilityComparison(probabilityScores.filter((row) => row.market === market)),
      ])),
    },
    touchdownPositiveThresholds: Object.fromEntries([0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5].map((threshold) => [
      threshold.toFixed(2),
      resultLine(positiveTd.filter((row) => row.probability >= threshold)),
    ])),
    touchdownScorers: positiveTd.filter((row) => row.result === "win").map((row) => ({
      player: row.row.playerName,
      team: row.row.team,
      probability: round(row.probability),
      grade: row.row.grade,
    })).sort((a, b) => b.probability - a.probability),
  };
}

function summarizeGradeMarketSide(
  rows: NflPlayerPropsRuntimeDecision[],
  stats: Map<string, Map<string, Stat>>,
) {
  const values = rows.flatMap((row) => {
    if (!row.providerPlayerId) return [];
    const stat = stats.get(row.gameId)?.get(row.providerPlayerId);
    if (!stat) return [];
    const actual = actualValue(row.market, stat);
    if (actual === null) return [];
    const result = actual === row.line ? "push" as const
      : row.side === "over" || row.side === "yes"
        ? actual > row.line ? "win" as const : "loss" as const
        : actual < row.line ? "win" as const : "loss" as const;
    return [{ market: row.market, side: row.side, probability: row.finalProbability, result, actual, row }];
  });
  const keys = [...new Set(values.map(({ row }) => `${row.grade}|${row.market}|${row.side}`))].sort();
  return Object.fromEntries(keys.map((key) => [key, resultLine(values.filter(({ row }) =>
    `${row.grade}|${row.market}|${row.side}` === key))]));
}

function summarizeWeightCandidateActionability(
  rows: NflPlayerPropsRuntimeDecision[],
  stats: Map<string, Map<string, Stat>>,
) {
  const candidateRows = rows.map((row) => replayWeightCandidate(row));
  const baseline = rows.filter((row) => actionable(row.grade));
  const candidate = candidateRows.filter((row) => actionable(row.grade));
  const key = (row: NflPlayerPropsRuntimeDecision) => [row.gameId, normalize(row.playerName), row.market, row.line, row.side].join("|");
  const baselineKeys = new Set(baseline.map(key));
  const candidateKeys = new Set(candidate.map(key));
  const scoreRows = (values: NflPlayerPropsRuntimeDecision[]) => resultLine(values.flatMap((row) => {
    if (!row.providerPlayerId) return [];
    const stat = stats.get(row.gameId)?.get(row.providerPlayerId);
    if (!stat) return [];
    const actual = actualValue(row.market, stat);
    if (actual === null) return [];
    const result = actual === row.line ? "push" as const
      : row.side === "over" ? actual > row.line ? "win" as const : "loss" as const
        : actual < row.line ? "win" as const : "loss" as const;
    return [{ market: row.market, side: row.side, probability: row.finalProbability, result, actual, row }];
  }));
  return {
    policy: { receiving_yards: 0.1 },
    baseline: { actions: baseline.length, results: scoreRows(baseline) },
    candidate: { actions: candidate.length, results: scoreRows(candidate) },
    promotions: candidate.filter((row) => !baselineKeys.has(key(row))).map(compactDecision),
    demotions: baseline.filter((row) => !candidateKeys.has(key(row))).map(compactDecision),
    retained: candidate.filter((row) => baselineKeys.has(key(row))).length,
  };
}

function summarizeConfidenceCandidateActionability(
  rows: NflPlayerPropsRuntimeDecision[],
  stats: Map<string, Map<string, Stat>>,
) {
  const candidateRows = rows.map((row) => {
    if (row.market === "anytime_td" || row.side === "yes") return row;
    if (actionable(row.grade) && row.finalProbability < 0.55) return { ...row, grade: "Watchlist" as const };
    if (row.grade !== "Watchlist" || row.finalProbability < 0.55 || row.expectedValue < 0.03
      || row.probabilityEdge < 0.015 || row.participationProbability < 0.7 || row.marketMovement === "adverse") return row;
    const lane = nflPlayerPropsProductionMarketLane(row.market);
    const independentBooks = new Set(row.bookEvidence.map((book) => normalize(book.sportsbook))
      .filter((book) => book !== normalize(row.sportsbook))).size;
    const blockingHolds = row.healthHolds.filter((reason) => ![
      "independent_same_line_confirmation_missing", "model_market_divergence_implausible",
    ].includes(reason));
    return lane?.lean && lane.eligibleSides.includes(row.side as "over" | "under")
      && independentBooks >= 1 && blockingHolds.length === 0
      ? { ...row, grade: "Lean" as const }
      : row;
  });
  const baseline = rows.filter((row) => actionable(row.grade));
  const candidate = candidateRows.filter((row) => actionable(row.grade));
  const key = (row: NflPlayerPropsRuntimeDecision) => [row.gameId, normalize(row.playerName), row.market, row.line, row.side].join("|");
  const baselineKeys = new Set(baseline.map(key));
  const candidateKeys = new Set(candidate.map(key));
  const scoreRows = (values: NflPlayerPropsRuntimeDecision[]) => resultLine(values.flatMap((row) => {
    if (!row.providerPlayerId) return [];
    const stat = stats.get(row.gameId)?.get(row.providerPlayerId);
    if (!stat) return [];
    const actual = actualValue(row.market, stat);
    if (actual === null) return [];
    const result = actual === row.line ? "push" as const
      : row.side === "over" ? actual > row.line ? "win" as const : "loss" as const
        : actual < row.line ? "win" as const : "loss" as const;
    return [{ market: row.market, side: row.side, probability: row.finalProbability, result, actual, row }];
  }));
  return {
    policy: { minimumActionProbability: 0.55, promotionMinimumEv: 0.03, promotionMinimumEdge: 0.015 },
    baseline: { actions: baseline.length, results: scoreRows(baseline) },
    candidate: { actions: candidate.length, results: scoreRows(candidate) },
    promotions: candidate.filter((row) => !baselineKeys.has(key(row))).map(compactDecision),
    demotions: baseline.filter((row) => !candidateKeys.has(key(row))).map(compactDecision),
    retained: candidate.filter((row) => baselineKeys.has(key(row))).length,
  };
}

function replayWeightCandidate(row: NflPlayerPropsRuntimeDecision): NflPlayerPropsRuntimeDecision {
  if (row.market !== "receiving_yards") return row;
  const finalProbability = nflPlayerPropsResidualProbability(row.rawModelProbability, row.marketProbability, 0.1);
  const probabilityEdge = finalProbability - row.marketProbability;
  const expectedValue = nflPlayerPropsExpectedValue(finalProbability, row.americanPrice);
  const policy = nflPlayerPropsRuntimeMarketPolicy(row.market);
  const lane = nflPlayerPropsProductionMarketLane(row.market);
  if (!policy || !lane) return row;
  const independentBooks = new Set(row.bookEvidence.map((book) => normalize(book.sportsbook))
    .filter((book) => book !== normalize(row.sportsbook))).size;
  const commonHolds = row.healthHolds.filter((reason) => ![
    "independent_same_line_confirmation_missing", "model_market_divergence_implausible",
  ].includes(reason));
  const divergenceImplausible = nflPlayerPropsRawMarketDivergenceImplausible(
    row.rawModelProbability, row.marketProbability,
  );
  const runtime = nflPlayerPropsRuntimePolicy();
  const leanThresholds = row.marketMovement === "support"
    ? runtime.volumeAndYardage.movementSupportedLean
    : lane.leanThresholds ?? runtime.volumeAndYardage.lean;
  const bestAngleThresholds = row.marketMovement === "support"
    ? runtime.volumeAndYardage.movementSupportedBestAngle
    : runtime.volumeAndYardage.bestAngle;
  const baseGrade = gradeNflPlayerPropsCrossMarketCandidate({
    commonHolds,
    independentBooks,
    divergenceImplausible,
    eligibleSide: lane.eligibleSides.includes(row.side as "over" | "under"),
    marketResidualQualified: policy.qualified || runtime.releaseEvidence.ownerApprovedForwardException === true,
    bestAngleEnabled: lane.bestAngle,
    leanEnabled: lane.lean,
    watchlistEnabled: lane.watchlist,
    expectedValue,
    probabilityEdge,
    participationProbability: row.participationProbability,
    movement: row.marketMovement,
    leanThresholds,
    bestAngleThresholds,
  });
  const finalOver = row.side === "over" ? finalProbability : 1 - finalProbability;
  const forecastSide = finalOver >= 0.5 ? "over" : "under";
  const grade = actionable(baseGrade) && row.side !== forecastSide ? "Watchlist" : baseGrade;
  return { ...row, finalProbability, probabilityEdge, expectedValue, grade };
}

function compactDecision(row: NflPlayerPropsRuntimeDecision) {
  return {
    player: row.playerName,
    gameId: row.gameId,
    market: row.market,
    line: row.line,
    side: row.side,
    grade: row.grade,
    probability: round(row.finalProbability),
    edge: round(row.probabilityEdge),
    ev: round(row.expectedValue),
    movement: row.marketMovement,
  };
}

function actionable(grade: NflPlayerPropsRuntimeDecision["grade"]): boolean {
  return grade === "Best Angle" || grade === "Lean";
}

function summarizeRankedActionability(
  rows: NflPlayerPropsRuntimeDecision[],
  stats: Map<string, Map<string, Stat>>,
) {
  const overForecasts = selectNflPlayerPropsOverForecasts(rows);
  const baseline = rows.filter((row) => row.grade === "Best Angle" || row.grade === "Lean");
  const candidateGrades = new Map<NflPlayerPropsRuntimeDecision, NflPlayerPropsRuntimeDecision["grade"]>();
  for (const row of rows) {
    if (row.market === "anytime_td" || row.side === "yes") {
      candidateGrades.set(row, row.grade);
      continue;
    }
    const rankedSide = overForecasts.has(nflPlayerPropsOverUnderMarketKey(row)) ? "over" : "under";
    const thresholdGrade = reconstructThresholdGrade(row);
    candidateGrades.set(row, row.side === rankedSide ? thresholdGrade : capActionAtWatchlist(thresholdGrade));
  }
  const candidate = rows.filter((row) => {
    const grade = candidateGrades.get(row);
    return grade === "Best Angle" || grade === "Lean";
  });
  const key = (row: NflPlayerPropsRuntimeDecision) => [row.gameId, normalize(row.playerName), row.market, row.line, row.side].join("|");
  const baselineKeys = new Set(baseline.map(key));
  const candidateKeys = new Set(candidate.map(key));
  const scoreRows = (values: NflPlayerPropsRuntimeDecision[]) => resultLine(values.flatMap((row) => {
    if (!row.providerPlayerId) return [];
    const stat = stats.get(row.gameId)?.get(row.providerPlayerId);
    if (!stat) return [];
    const actual = actualValue(row.market, stat);
    if (actual === null) return [];
    const result = actual === row.line ? "push" as const
      : row.side === "over" ? actual > row.line ? "win" as const : "loss" as const
        : actual < row.line ? "win" as const : "loss" as const;
    return [{ market: row.market, side: row.side, probability: row.finalProbability, result, actual, row }];
  }));
  const transition = (row: NflPlayerPropsRuntimeDecision) => ({
    player: row.playerName,
    gameId: row.gameId,
    market: row.market,
    line: row.line,
    side: row.side,
    from: row.grade,
    to: candidateGrades.get(row),
    probability: round(row.finalProbability),
    edge: round(row.probabilityEdge),
    ev: round(row.expectedValue),
    movement: row.marketMovement,
  });
  return {
    policy: "ranked_expected_prevalence_side_plus_existing_exact_economics_thresholds",
    baseline: { actions: baseline.length, results: scoreRows(baseline) },
    candidate: { actions: candidate.length, results: scoreRows(candidate) },
    promotions: candidate.filter((row) => !baselineKeys.has(key(row))).map(transition),
    demotions: baseline.filter((row) => !candidateKeys.has(key(row))).map(transition),
    retained: candidate.filter((row) => baselineKeys.has(key(row))).length,
    byMarketSide: Object.fromEntries([...new Set(candidate.map((row) => `${row.market}:${row.side}`))].sort().map((value) => [
      value,
      scoreRows(candidate.filter((row) => `${row.market}:${row.side}` === value)),
    ])),
  };
}

function reconstructThresholdGrade(row: NflPlayerPropsRuntimeDecision): NflPlayerPropsRuntimeDecision["grade"] {
  if (row.healthHolds.some((reason) => [
    "identity_ambiguous",
    "role_ambiguous",
    "player_listed_out",
    "lock_observation_missing",
    "model_market_divergence_implausible",
  ].includes(reason))) return row.grade === "Held" ? "Held" : "No Play";
  if (row.healthHolds.includes("independent_same_line_confirmation_missing")) return "No Play";
  const independentBooks = Math.max(0, new Set(row.bookEvidence.map((value) => normalize(value.sportsbook))).size - 1);
  if (independentBooks < 1 || row.marketMovement === "adverse") {
    return row.expectedValue >= 0 && row.probabilityEdge >= 0 ? "Watchlist" : "No Play";
  }
  const supported = row.marketMovement === "support";
  const best = supported
    ? { ev: 0.07, edge: 0.03, participation: 0.85 }
    : { ev: 0.08, edge: 0.035, participation: 0.85 };
  const lean = supported
    ? { ev: 0.03, edge: 0.015, participation: 0.7 }
    : { ev: 0.04, edge: 0.02, participation: 0.7 };
  if (row.expectedValue >= best.ev && row.probabilityEdge >= best.edge
    && row.participationProbability >= best.participation) return "Best Angle";
  if (row.expectedValue >= lean.ev && row.probabilityEdge >= lean.edge
    && row.participationProbability >= lean.participation) return "Lean";
  return row.expectedValue >= 0 && row.probabilityEdge >= 0 ? "Watchlist" : "No Play";
}

function capActionAtWatchlist(grade: NflPlayerPropsRuntimeDecision["grade"]): NflPlayerPropsRuntimeDecision["grade"] {
  return grade === "Best Angle" || grade === "Lean" ? "Watchlist" : grade;
}

function probabilityComparison(rows: ProbabilityScore[]) {
  const sources = (["raw", "marketProbability", "final"] as const).map((source) => ({
    name: source === "marketProbability" ? "market" : source,
    probability: (row: ProbabilityScore) => row[source],
  }));
  const candidates = [0, 0.05, 0.1, 0.15, 0.2].map((weight) => ({
    name: `marketResidualWeight${weight.toFixed(2)}`,
    probability: (row: ProbabilityScore) => residual(row.raw, row.marketProbability, weight),
  }));
  return Object.fromEntries([...sources, ...candidates].map((source) => {
    const values = rows.map((row) => ({ probability: clamp(source.probability(row)), actual: row.actual }));
    const brier = values.length ? values.reduce((sum, row) => sum + (row.probability - row.actual) ** 2, 0) / values.length : null;
    const logLoss = values.length ? -values.reduce((sum, row) => sum + row.actual * Math.log(row.probability) + (1 - row.actual) * Math.log(1 - row.probability), 0) / values.length : null;
    const correct = values.filter((row) => (row.probability >= 0.5) === (row.actual === 1)).length;
    const ranked = [...values].sort((a, b) => b.probability - a.probability);
    const positiveCount = Math.max(0, Math.min(ranked.length, Math.round(values.reduce((sum, row) => sum + row.probability, 0))));
    const rankedCorrect = ranked.filter((row, index) => (index < positiveCount) === (row.actual === 1)).length;
    const rankedTruePositives = ranked.slice(0, positiveCount).filter((row) => row.actual === 1).length;
    const actualPositives = ranked.filter((row) => row.actual === 1).length;
    return [source.name, {
      rows: values.length,
      brier: brier === null ? null : round(brier),
      logLoss: logLoss === null ? null : round(logLoss),
      sideAccuracy: values.length ? round(correct / values.length) : null,
      predictedOverOrYesShare: values.length ? round(values.filter((row) => row.probability >= 0.5).length / values.length) : null,
      rankedExpectedPrevalence: {
        predictedPositive: positiveCount,
        accuracy: values.length ? round(rankedCorrect / values.length) : null,
        precision: positiveCount ? round(rankedTruePositives / positiveCount) : null,
        recall: actualPositives ? round(rankedTruePositives / actualPositives) : null,
      },
    }];
  }));
}

function resolvePrediction(rows: NflPlayerPropsRuntimeDecision[]): { side: Scored["side"]; probability: number; row: NflPlayerPropsRuntimeDecision } | null {
  const yes = rows.find((row) => row.side === "yes");
  if (yes) return yes.finalProbability >= 0.5
    ? { side: "yes", probability: yes.finalProbability, row: yes }
    : { side: "no", probability: 1 - yes.finalProbability, row: yes };
  const over = rows.find((row) => row.side === "over");
  const under = rows.find((row) => row.side === "under");
  if (!over && !under) return null;
  const overProbability = over?.finalProbability ?? 1 - under!.finalProbability;
  const underProbability = under?.finalProbability ?? 1 - over!.finalProbability;
  return overProbability >= underProbability
    ? { side: "over", probability: overProbability, row: over ?? under! }
    : { side: "under", probability: underProbability, row: under ?? over! };
}

function actualValue(market: string, stat: Stat): number | null {
  if (market === "anytime_td") return sum(stat, ["rushing_touchdowns", "receiving_touchdowns", "kick_return_touchdowns", "punt_return_touchdowns", "fumbles_touchdowns"]);
  const value = stat[market];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resultLine(rows: Scored[]) {
  const wins = rows.filter((row) => row.result === "win").length;
  const losses = rows.filter((row) => row.result === "loss").length;
  const pushes = rows.filter((row) => row.result === "push").length;
  return { rows: rows.length, wins, losses, pushes, accuracy: wins + losses === 0 ? null : round(wins / (wins + losses)) };
}

function counts(values: string[]): Record<string, number> {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]));
}

function quantiles(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const q = (probability: number) => ordered.length ? round(ordered[Math.min(ordered.length - 1, Math.floor(probability * ordered.length))]!) : null;
  return { minimum: q(0), p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), maximum: q(1) };
}

function numberArg(name: string, fallback: number): number {
  const value = process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
  return value ? Number(value) : fallback;
}

function stringArg(name: string): string | null {
  return process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }
function clamp(value: number): number { return Math.min(1 - 1e-6, Math.max(1e-6, value)); }
function residual(model: number, market: number, weight: number): number {
  const modelProbability = clamp(model);
  const marketValue = clamp(market);
  const logit = (value: number) => Math.log(value / (1 - value));
  const value = logit(marketValue) + weight * (logit(modelProbability) - logit(marketValue));
  return 1 / (1 + Math.exp(-value));
}
function sum(row: Stat, fields: string[]): number { return fields.reduce((total, field) => total + (typeof row[field] === "number" ? Number(row[field]) : 0), 0); }

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
