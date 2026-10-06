/** Exact read-only replay of the r27 NFL cohort through the current candidate runtime. */

import { supabase } from "@/lib/db/supabase";
import {
  buildNflPaidTeamScoreBaseForecast,
  buildNflMarketEvidenceOutcomeForecast,
  getNflV1WeekOneOutcomeForecast,
} from "@/lib/services/football/nflV1WeekOneOutcome";
import { buildNflR6ShadowMoneylineDecision } from "@/lib/services/football/nflR6MoneylineShadow";
import { resolveNflTargetExcludedProduction } from "@/lib/services/football/nflTargetExcludedMarketOutcome";
import {
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
} from "@/lib/services/football/nflForwardEvidence";

type Market = "moneyline" | "spread" | "total";
type Result = "win" | "loss" | "push";
type SettledGrade = { result: string; actual_home_score: number; actual_away_score: number };
type RecordRow = {
  id: number;
  game_id: string;
  matchup: string;
  market: string;
  model_version: string;
  snapshot_json: { evidence_payload_sha256?: string } | null;
  prediction_grades: SettledGrade | SettledGrade[] | null;
};
type MarketAuditRow = {
  game: string;
  market: Market;
  incumbentSide: string;
  candidateSide: string;
  incumbentGrade: string;
  candidateGrade: string;
  incumbentProbability: number;
  candidateProbability: number;
  candidateMarketFairProbability: number;
  candidateExpectedValue: number;
  candidateEdgePercentagePoints: number;
  candidateLine: number | null;
  candidatePrice: number;
  incumbentResult: Result;
  candidateResult: Result;
  winnerCoherence: unknown;
};
type GameAuditRow = {
  game: string;
  actualAway: number;
  actualHome: number;
  incumbentAway: number;
  incumbentHome: number;
  candidateAway: number;
  candidateHome: number;
  totalUnchanged: boolean;
};

const INCUMBENT_RELEASE = "nfl_v1_daily_edge_decision_2026_10_02_r27_spread_grade_calibration";
const ACTIONABLE = new Set(["Best Angle", "Lean"]);

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function result(args: {
  market: Market;
  side: string;
  line: number | null;
  awayTeam: string;
  homeTeam: string;
  awayScore: number;
  homeScore: number;
}): Result {
  if (args.market === "moneyline") {
    return args.side === args.homeTeam
      ? args.homeScore > args.awayScore ? "win" : "loss"
      : args.awayScore > args.homeScore ? "win" : "loss";
  }
  if (args.line === null) throw new Error(`Missing ${args.market} line.`);
  const score = args.market === "spread"
    ? args.side === args.homeTeam
      ? args.homeScore - args.awayScore + args.line
      : args.awayScore - args.homeScore + args.line
    : args.side.startsWith("Over")
      ? args.homeScore + args.awayScore - args.line
      : args.line - args.homeScore - args.awayScore;
  return score > 0 ? "win" : score < 0 ? "loss" : "push";
}

function summarize(rows: MarketAuditRow[], prefix: "incumbent" | "candidate") {
  const rowResult = (row: MarketAuditRow) => prefix === "incumbent" ? row.incumbentResult : row.candidateResult;
  const rowGrade = (row: MarketAuditRow) => prefix === "incumbent" ? row.incumbentGrade : row.candidateGrade;
  const rowProbability = (row: MarketAuditRow) => prefix === "incumbent" ? row.incumbentProbability : row.candidateProbability;
  const settled = rows.filter((row) => rowResult(row) !== "push");
  const wins = settled.filter((row) => rowResult(row) === "win").length;
  const actionables = settled.filter((row) => ACTIONABLE.has(rowGrade(row)));
  const actionableWins = actionables.filter((row) => rowResult(row) === "win").length;
  const brier = settled.reduce((sum, row) => {
    const probability = rowProbability(row);
    const observed = rowResult(row) === "win" ? 1 : 0;
    return sum + (probability - observed) ** 2;
  }, 0) / Math.max(settled.length, 1);
  return {
    rows: rows.length,
    settled: settled.length,
    wins,
    losses: settled.length - wins,
    pushes: rows.length - settled.length,
    accuracy: settled.length ? wins / settled.length : null,
    brier,
    actionables: actionables.length,
    actionableWins,
    actionableLosses: actionables.length - actionableWins,
    actionableAccuracy: actionables.length ? actionableWins / actionables.length : null,
    grades: Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play"].map((grade) => [
      grade,
      rows.filter((row) => rowGrade(row) === grade).length,
    ])),
  };
}

function summarizeByGrade(rows: MarketAuditRow[], prefix: "incumbent" | "candidate") {
  const rowResult = (row: MarketAuditRow) => prefix === "incumbent" ? row.incumbentResult : row.candidateResult;
  const rowGrade = (row: MarketAuditRow) => prefix === "incumbent" ? row.incumbentGrade : row.candidateGrade;
  return Object.fromEntries(["Best Angle", "Lean", "Watchlist", "No Play"].map((grade) => {
    const selected = rows.filter((row) => rowGrade(row) === grade && rowResult(row) !== "push");
    const wins = selected.filter((row) => rowResult(row) === "win").length;
    return [grade, {
      settled: selected.length,
      wins,
      losses: selected.length - wins,
      accuracy: selected.length ? wins / selected.length : null,
      byMarket: Object.fromEntries((["moneyline", "spread", "total"] as Market[]).map((market) => {
        const marketRows = selected.filter((row) => row.market === market);
        const marketWins = marketRows.filter((row) => rowResult(row) === "win").length;
        return [market, {
          settled: marketRows.length,
          wins: marketWins,
          losses: marketRows.length - marketWins,
          accuracy: marketRows.length ? marketWins / marketRows.length : null,
        }];
      })),
    }];
  }));
}

function scoreSummary(games: GameAuditRow[], prefix: "incumbent" | "candidate") {
  const away = (row: GameAuditRow) => prefix === "incumbent" ? row.incumbentAway : row.candidateAway;
  const home = (row: GameAuditRow) => prefix === "incumbent" ? row.incumbentHome : row.candidateHome;
  const teamMae = games.reduce((sum, row) => sum + (
    Math.abs(away(row) - row.actualAway) +
    Math.abs(home(row) - row.actualHome)
  ) / 2, 0) / games.length;
  const marginMae = games.reduce((sum, row) => sum + Math.abs(
    home(row) - away(row) - (row.actualHome - row.actualAway)
  ), 0) / games.length;
  const totalMae = games.reduce((sum, row) => sum + Math.abs(
    home(row) + away(row) - row.actualHome - row.actualAway
  ), 0) / games.length;
  return { teamMae, marginMae, totalMae };
}

async function main() {
  const recordRead = await supabase.from("prediction_records")
    .select("id,game_id,matchup,market,model_version,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
    .eq("sport", "nfl")
    .eq("model_version", INCUMBENT_RELEASE)
    .not("locked_at", "is", null)
    .order("id", { ascending: true });
  if (recordRead.error) throw recordRead.error;
  const records = (recordRead.data ?? []) as unknown as RecordRow[];
  const hashes = [...new Set(records.map((row) => row.snapshot_json?.evidence_payload_sha256)
    .filter((value): value is string => typeof value === "string"))];
  const evidenceRead = await supabase.from("nfl_forward_evidence_snapshots")
    .select("payload_sha256,payload")
    .in("payload_sha256", hashes);
  if (evidenceRead.error) throw evidenceRead.error;
  const payloads = new Map<string, NflForwardEvidencePayload>();
  for (const row of evidenceRead.data ?? []) {
    const payload = row.payload as NflForwardEvidencePayload;
    if (hashNflForwardEvidencePayload(payload) !== row.payload_sha256) {
      throw new Error(`Evidence checksum mismatch for ${row.payload_sha256}.`);
    }
    payloads.set(row.payload_sha256, payload);
  }

  const games: GameAuditRow[] = [];
  const marketRows: MarketAuditRow[] = [];
  for (const hash of hashes) {
    const payload = payloads.get(hash);
    if (!payload) throw new Error(`Missing evidence ${hash}.`);
    const gameRecords = records.filter((row) => row.snapshot_json?.evidence_payload_sha256 === hash);
    if (gameRecords.length !== 3) throw new Error(`Expected three records for ${payload.game.providerGameId}.`);
    const grade = one(gameRecords[0]!.prediction_grades);
    if (!grade) throw new Error(`Missing settled result for ${payload.game.providerGameId}.`);
    if (!payload.paidProjectionShadow) {
      throw new Error(`Missing paid projection for exact r27 replay ${payload.game.providerGameId}.`);
    }
    const actualAway = Number(grade.actual_away_score);
    const actualHome = Number(grade.actual_home_score);
    const opening = payload.market.operationalOpening;
    const shadowMoneyline = buildNflR6ShadowMoneylineDecision({
      game: payload.game,
      opening,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      startersAndDepth: payload.startersAndDepth,
      injuries: payload.injuries,
      stage: payload.stage,
      capturedAt: payload.capturedAt,
      t60LagMinutes: payload.t60LagMinutes,
      coverageHealthHolds: payload.coverage.healthHolds,
    });
    const legacyBase = getNflV1WeekOneOutcomeForecast({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      weeklyFallback: shadowMoneyline.footballProjection && payload.market.current.total
        ? {
            projectedHomeMargin: shadowMoneyline.footballProjection.projectedHomeMargin,
            marketTotal: payload.market.current.total.line,
          }
        : undefined,
    });
    const baseOutcome = buildNflPaidTeamScoreBaseForecast({
      baseForecast: legacyBase,
      paidTeamScore: payload.paidProjectionShadow,
    });
    const incumbentCandidate = shadowMoneyline.footballProjection
      ? buildNflMarketEvidenceOutcomeForecast({
          baseForecast: baseOutcome,
          footballHomeMargin: shadowMoneyline.footballProjection.projectedHomeMargin,
          current: payload.market.current,
          operationalOpening: opening,
          playbookLine: payload.market.playbookLine,
          playbookSplits: payload.market.playbookSplits,
          sharpSplits: payload.market.sharpApiSplits,
          spreadDirectionCandidate: true,
          totalDirectionCandidate: true,
          movementCurrent: payload.market.current,
          paidTeamScore: payload.paidProjectionShadow,
          evaluatedAt: payload.capturedAt,
        })
      : baseOutcome;
    const resolved = resolveNflTargetExcludedProduction({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      evaluatedAt: payload.capturedAt,
      baseOutcome,
      incumbentOutcome: incumbentCandidate,
      current: payload.market.current,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      operationalOpening: opening,
      shadowMoneyline,
      playbookLine: payload.market.playbookLine,
      playbookSplits: payload.market.playbookSplits,
      sharpSplits: payload.market.sharpApiSplits,
      pricedNeutralTotalCandidate: true,
      totalDirectionCandidate: true,
      paidTeamScore: payload.paidProjectionShadow,
    });
    const incumbentDecisions = new Map(payload.decisions.evaluatedBets.map((decision) => [decision.market, decision]));
    const candidateDecisions = new Map(resolved.production.evaluatedBets.map((decision) => [decision.market, decision]));
    for (const market of ["moneyline", "spread", "total"] as Market[]) {
      const incumbent = incumbentDecisions.get(market);
      const candidate = candidateDecisions.get(market);
      if (!incumbent || !candidate) throw new Error(`Incomplete ${market} decision for ${payload.game.providerGameId}.`);
      const incumbentResult = result({
        market,
        side: incumbent.side,
        line: incumbent.evaluatedQuote.line,
        awayTeam: payload.game.away.abbreviation,
        homeTeam: payload.game.home.abbreviation,
        awayScore: actualAway,
        homeScore: actualHome,
      });
      const candidateResult = result({
        market,
        side: candidate.side,
        line: candidate.evaluatedQuote.line,
        awayTeam: payload.game.away.abbreviation,
        homeTeam: payload.game.home.abbreviation,
        awayScore: actualAway,
        homeScore: actualHome,
      });
      marketRows.push({
        game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
        market,
        incumbentSide: incumbent.side,
        candidateSide: candidate.side,
        incumbentGrade: incumbent.grade,
        candidateGrade: candidate.grade,
        incumbentProbability: incumbent.modelProbability,
        candidateProbability: candidate.modelProbability,
        candidateMarketFairProbability: candidate.marketFairProbability,
        candidateExpectedValue: candidate.expectedValue,
        candidateEdgePercentagePoints: 100 * (candidate.modelProbability - candidate.marketFairProbability),
        candidateLine: candidate.evaluatedQuote.line,
        candidatePrice: candidate.evaluatedQuote.price,
        incumbentResult,
        candidateResult,
        winnerCoherence: resolved.outcome.marketEvidence?.winnerCoherence ?? null,
      });
    }
    games.push({
      game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      actualAway,
      actualHome,
      incumbentAway: payload.outcomeForecast.expectedAwayScore,
      incumbentHome: payload.outcomeForecast.expectedHomeScore,
      candidateAway: resolved.outcome.expectedAwayScore,
      candidateHome: resolved.outcome.expectedHomeScore,
      totalUnchanged: Math.abs(
        payload.outcomeForecast.expectedAwayScore + payload.outcomeForecast.expectedHomeScore -
        resolved.outcome.expectedAwayScore - resolved.outcome.expectedHomeScore
      ) < 1e-9,
    });
  }

  const byMarket = Object.fromEntries((["moneyline", "spread", "total"] as Market[]).map((market) => {
    const rows = marketRows.filter((row) => row.market === market);
    return [market, {
      incumbent: summarize(rows, "incumbent"),
      candidate: summarize(rows, "candidate"),
      sideChanges: rows.filter((row) => row.incumbentSide !== row.candidateSide),
      promotions: rows.filter((row) => !ACTIONABLE.has(row.incumbentGrade) && ACTIONABLE.has(row.candidateGrade)),
      demotions: rows.filter((row) => ACTIONABLE.has(row.incumbentGrade) && !ACTIONABLE.has(row.candidateGrade)),
    }];
  }));
  const report = {
    release: "nfl_cross_market_winner_coherence_audit_2026_10_05_r28",
    readOnly: true,
    writes: 0,
    games: games.length,
    markets: marketRows.length,
    score: {
      incumbent: scoreSummary(games, "incumbent"),
      candidate: scoreSummary(games, "candidate"),
    },
    byMarket,
    byGrade: {
      incumbent: summarizeByGrade(marketRows, "incumbent"),
      candidate: summarizeByGrade(marketRows, "candidate"),
    },
    totalInvariant: games.every((row) => row.totalUnchanged),
    changedGames: games.filter((row) =>
      Math.abs(row.incumbentAway - row.candidateAway) > 1e-9 ||
      Math.abs(row.incumbentHome - row.candidateHome) > 1e-9),
    marketRows,
  };
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
