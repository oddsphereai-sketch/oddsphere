/**
 * SELECT-only, release-pure NFL Daily Edge loss ledger.
 *
 * The ledger keeps immutable published results separate from counterfactual
 * score layers. It never writes predictions, grades, evidence, or locks.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

import {
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
} from "../../lib/services/football/nflForwardEvidence";
import {
  buildNflIndependentScoreBaseForecast,
  nflV1WeekOneLineProbabilities,
} from "../../lib/services/football/nflV1WeekOneOutcome";
import { readNflPlayerPropsCurrentSeasonState } from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";

type Market = "moneyline" | "spread" | "total";
type Side = "home" | "away" | "over" | "under";
type Result = "win" | "loss" | "push" | "void" | "pending";

type Grade = {
  result: Result;
  win: boolean | null;
  loss: boolean | null;
  push: boolean | null;
  actual_home_score: number | null;
  actual_away_score: number | null;
};

type RecordRow = {
  id: number;
  slate_date: string;
  matchup: string;
  market: Market;
  pick: string | null;
  side: Side;
  line_value: number | null;
  odds_american: number | null;
  model_probability: number | null;
  market_probability: number | null;
  play_grade: string | null;
  no_bet: boolean;
  held: boolean;
  locked_at: string;
  model_version: string;
  calibration_version: string | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: Grade | Grade[] | null;
};

type EvidenceRow = {
  payload_sha256: string;
  payload: NflForwardEvidencePayload;
};

type Score = {
  away: number;
  home: number;
};

type ChallengerScoreRow = {
  date: string;
  home: string;
  away: string;
  expectedHomeScore: number;
  expectedAwayScore: number;
};

type ChallengerReplay = {
  replayRelease: string;
  candidates: Record<string, { scores: ChallengerScoreRow[] }>;
};

const MARKETS: Market[] = ["moneyline", "spread", "total"];

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function gradeKey(value: string | null): string {
  return String(value ?? "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isActionable(row: RecordRow): boolean {
  return !row.no_bet && ["best_angle", "lean"].includes(gradeKey(row.play_grade));
}

function actualResult(score: Score, market: Market, side: Side, line: number | null, cushion = 0): Result {
  const homeMargin = score.home - score.away;
  if (market === "moneyline") {
    if (score.home === score.away) return "push";
    return (side === "home" ? homeMargin > 0 : homeMargin < 0) ? "win" : "loss";
  }
  if (line === null) return "void";
  if (market === "spread") {
    const selectedMargin = side === "home" ? homeMargin : -homeMargin;
    const value = selectedMargin + line + cushion;
    return value > 0 ? "win" : value < 0 ? "loss" : "push";
  }
  const actualTotal = score.home + score.away;
  const adjustedLine = side === "over" ? line - cushion : line + cushion;
  if (actualTotal === adjustedLine) return "push";
  return (side === "over" ? actualTotal > adjustedLine : actualTotal < adjustedLine) ? "win" : "loss";
}

function scoreSide(score: Score, market: Market, line: number | null): Side | null {
  const margin = score.home - score.away;
  if (market === "moneyline") return margin === 0 ? null : margin > 0 ? "home" : "away";
  if (line === null) return null;
  if (market === "spread") {
    const value = margin + line;
    return value === 0 ? null : value > 0 ? "home" : "away";
  }
  const value = score.home + score.away - line;
  return value === 0 ? null : value > 0 ? "over" : "under";
}

function scoreResult(
  score: Score | null,
  market: Market,
  canonicalLine: number | null,
  actual: Score,
  cushion = 0,
): Result | null {
  if (!score) return null;
  const side = scoreSide(score, market, canonicalLine);
  if (!side) return "push";
  const selectedLine = market === "spread" && canonicalLine !== null && side === "away"
    ? -canonicalLine
    : canonicalLine;
  return actualResult(actual, market, side, selectedLine, cushion);
}

function publishedForecastSide(payload: NflForwardEvidencePayload, record: RecordRow): Side {
  const forecast = payload.outcomeForecast;
  if (record.market === "moneyline") {
    return forecast.homeWinProbability >= forecast.awayWinProbability ? "home" : "away";
  }
  if (record.line_value === null) throw new Error(`NFL record ${record.id} has no line.`);
  if (record.market === "total") {
    const probabilities = nflV1WeekOneLineProbabilities({
      forecast,
      homeSpread: 0,
      totalLine: record.line_value,
    }).total;
    return probabilities.overProbability >= probabilities.underProbability ? "over" : "under";
  }
  const homeLine = record.side === "home" ? record.line_value : -record.line_value;
  const probabilities = nflV1WeekOneLineProbabilities({
    forecast,
    homeSpread: homeLine,
    totalLine: 0,
  }).spread;
  return probabilities.homeCoverProbability >= probabilities.awayCoverProbability ? "home" : "away";
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function correlation(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left)!;
  const rightMean = mean(right)!;
  const numerator = left.reduce((sum, value, index) =>
    sum + (value - leftMean) * (right[index]! - rightMean), 0);
  const leftScale = Math.sqrt(left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0));
  const rightScale = Math.sqrt(right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0));
  return leftScale > 0 && rightScale > 0 ? numerator / (leftScale * rightScale) : null;
}

function impliedProbability(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function properScores(rows: Array<{ probability: number | null; outcome: number | null }>) {
  const values = rows.filter((row): row is { probability: number; outcome: number } =>
    row.probability !== null && row.outcome !== null && row.probability > 0 && row.probability < 1);
  return {
    rows: values.length,
    brier: mean(values.map((row) => (row.probability - row.outcome) ** 2)),
    logLoss: mean(values.map((row) => -(row.outcome * Math.log(row.probability) + (1 - row.outcome) * Math.log(1 - row.probability)))),
    calibrationGap: values.length
      ? mean(values.map((row) => row.probability))! - mean(values.map((row) => row.outcome))!
      : null,
  };
}

function summary(rows: Array<{ result: Result }>) {
  const resolved = rows.filter((row) => row.result === "win" || row.result === "loss");
  const wins = resolved.filter((row) => row.result === "win").length;
  return {
    rows: rows.length,
    resolved: resolved.length,
    wins,
    losses: resolved.length - wins,
    pushes: rows.filter((row) => row.result === "push").length,
    accuracy: resolved.length ? wins / resolved.length : null,
  };
}

function byKey<T>(rows: T[], key: (row: T) => string, value: (rows: T[]) => unknown) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const name = key(row);
    groups.set(name, [...(groups.get(name) ?? []), row]);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
    ([name, values]) => [name, value(values)],
  ));
}

async function main(): Promise<void> {
  const challengerPath = process.argv.find((value) => value.startsWith("--challenger="))?.slice("--challenger=".length);
  const challenger = challengerPath
    ? JSON.parse(readFileSync(challengerPath, "utf8")) as ChallengerReplay
    : null;
  const normalizeReplayTeam = (team: string) => ({ LAR: "LA", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" }[team] ?? team);
  const challengerScores = challenger
    ? Object.fromEntries(Object.entries(challenger.candidates).map(([name, candidate]) => [
        name,
        new Map(candidate.scores.map((score) => [
          `${score.date}:${normalizeReplayTeam(score.away)}@${normalizeReplayTeam(score.home)}`,
          { away: score.expectedAwayScore, home: score.expectedHomeScore },
        ])),
      ])) as Record<string, Map<string, Score>>
    : {};
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const currentSeasonState = await readNflPlayerPropsCurrentSeasonState({ client, season: 2026 });
  const { data, error } = await client
    .from("prediction_records")
    .select([
      "id", "slate_date", "matchup", "market", "pick", "side", "line_value", "odds_american",
      "model_probability", "market_probability", "play_grade", "no_bet", "held", "locked_at",
      "model_version", "calibration_version", "snapshot_json",
      "prediction_grades(result,win,loss,push,actual_home_score,actual_away_score)",
    ].join(","))
    .eq("sport", "nfl")
    .not("locked_at", "is", null)
    .in("market", MARKETS)
    .order("slate_date", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`NFL tracking read failed: ${error.message}`);
  const allRecords = (data ?? []) as unknown as RecordRow[];
  const records = allRecords.filter((record) =>
    typeof record.snapshot_json?.supersedes_prediction_record_id !== "number");
  const hashes = [...new Set(records.flatMap((record) => {
    const hash = record.snapshot_json?.evidence_payload_sha256;
    return typeof hash === "string" ? [hash] : [];
  }))];
  const evidence: EvidenceRow[] = [];
  for (let index = 0; index < hashes.length; index += 100) {
    const read = await client.from("nfl_forward_evidence_snapshots")
      .select("payload_sha256,payload")
      .in("payload_sha256", hashes.slice(index, index + 100));
    if (read.error) throw new Error(`NFL evidence read failed: ${read.error.message}`);
    evidence.push(...((read.data ?? []) as unknown as EvidenceRow[]));
  }
  const byHash = new Map(evidence.map((row) => {
    if (hashNflForwardEvidencePayload(row.payload) !== row.payload_sha256) {
      throw new Error(`NFL evidence checksum mismatch: ${row.payload_sha256}`);
    }
    return [row.payload_sha256, row.payload] as const;
  }));

  const rows = records.map((record) => {
    const hash = record.snapshot_json?.evidence_payload_sha256;
    const payload = typeof hash === "string" ? byHash.get(hash) : undefined;
    const grade = one(record.prediction_grades);
    if (!payload || !grade || grade.actual_home_score === null || grade.actual_away_score === null) {
      throw new Error(`NFL record ${record.id} lacks checksum-verified evidence or a final score.`);
    }
    const actual = { away: grade.actual_away_score, home: grade.actual_home_score };
    const challengerKey = `${record.slate_date}:${normalizeReplayTeam(payload.game.away.abbreviation)}@${normalizeReplayTeam(payload.game.home.abbreviation)}`;
    const finalScore = {
      away: payload.outcomeForecast.expectedAwayScore,
      home: payload.outcomeForecast.expectedHomeScore,
    };
    const independentScore = payload.paidProjectionShadow ? {
      away: payload.paidProjectionShadow.expectedAwayScore,
      home: payload.paidProjectionShadow.expectedHomeScore,
    } : null;
    const providerComponentScore = payload.paidProjectionShadow ? {
      away: payload.paidProjectionShadow.awayComponentScore,
      home: payload.paidProjectionShadow.homeComponentScore,
    } : null;
    const core = payload.outcomeForecast.marketEvidence?.calibratedCore;
    const calibratedCoreScore = core ? {
      away: (core.calibratedTotal - core.calibratedHomeMargin) / 2,
      home: (core.calibratedTotal + core.calibratedHomeMargin) / 2,
    } : null;
    const current = payload.market.current;
    const marketAnchorScore = current.spread && current.total ? {
      away: (current.total.line + current.spread.homeLine) / 2,
      home: (current.total.line - current.spread.homeLine) / 2,
    } : null;
    const canonicalLine = record.market === "spread" && record.line_value !== null && record.side === "away"
      ? -record.line_value
      : record.line_value;
    const independentSide = independentScore ? scoreSide(independentScore, record.market, canonicalLine) : null;
    const finalSide = publishedForecastSide(payload, record);
    const independentResult = scoreResult(independentScore, record.market, canonicalLine, actual);
    const providerComponentResult = scoreResult(providerComponentScore, record.market, canonicalLine, actual);
    const finalResult = actualResult(actual, record.market, finalSide, record.line_value);
    const marketChangedSide = independentSide !== null && independentSide !== finalSide;
    const category = independentResult === null
      ? "independent_evidence_unavailable"
      : marketChangedSide && finalResult === "win" && independentResult === "loss"
        ? "market_reader_correction"
        : marketChangedSide && finalResult === "loss" && independentResult === "win"
          ? "market_reader_harm"
          : marketChangedSide
            ? "market_reader_neutral_change"
            : finalResult === "loss"
              ? "independent_and_final_same_side_loss"
              : "independent_and_final_same_side_win";
    const injuryPlayers = payload.injuries?.teams.reduce((sum, team) => sum + team.players.length, 0) ?? null;
    const teamStats = currentSeasonState?.teamStats.filter((row) => row.gameId === payload.game.providerGameId) ?? [];
    const homeStats = teamStats.find((row) => row.team === payload.game.home.abbreviation) ?? null;
    const awayStats = teamStats.find((row) => row.team === payload.game.away.abbreviation) ?? null;
    const selectedStats = finalSide === "home" ? homeStats : finalSide === "away" ? awayStats : null;
    const opposingStats = finalSide === "home" ? awayStats : finalSide === "away" ? homeStats : null;
    const selectedTurnoverSwing = selectedStats && opposingStats ? selectedStats.turnovers - opposingStats.turnovers : null;
    const selectedYardsPerPlayGap = selectedStats && opposingStats ? selectedStats.yardsPerPlay - opposingStats.yardsPerPlay : null;
    const combinedPlays = homeStats && awayStats ? homeStats.totalOffensivePlays + awayStats.totalOffensivePlays : null;
    const selectedSackGap = selectedStats && opposingStats ? selectedStats.sacksAllowed - opposingStats.sacksAllowed : null;
    const finalAxisError = record.market === "total"
      ? finalScore.home + finalScore.away - actual.home - actual.away
      : finalScore.home - finalScore.away - (actual.home - actual.away);
    const currentMoneyline = current.moneyline;
    const homeMarketProbability = currentMoneyline
      ? impliedProbability(currentMoneyline.homePrice) /
        (impliedProbability(currentMoneyline.homePrice) + impliedProbability(currentMoneyline.awayPrice))
      : null;
    const marketFavoriteSide = currentMoneyline
      ? currentMoneyline.homePrice <= currentMoneyline.awayPrice ? "home" : "away"
      : null;
    const actualWinnerSide = actual.home === actual.away ? null : actual.home > actual.away ? "home" : "away";
    const marketAnchorSide = marketAnchorScore ? scoreSide(marketAnchorScore, record.market, canonicalLine) : null;
    const marketAnchorResult = scoreResult(marketAnchorScore, record.market, canonicalLine, actual);
    const explanationFlags = [
      !payload.coverage.injuries ? "personnel_evidence_missing" : null,
      marketChangedSide && finalResult === "loss" && independentResult === "win" ? "market_reader_harm" : null,
      finalResult === "loss" && marketAnchorResult === "win" ? "missed_market_anchor" : null,
      finalResult === "loss" && isActionable(record) ? "grade_miscalibration" : null,
      finalResult === "loss" && Math.abs(finalAxisError) >= 14 ? "distribution_tail_or_scale_error" : null,
      finalResult === "loss" && selectedTurnoverSwing !== null && selectedTurnoverSwing >= 2 ? "adverse_turnover_swing" : null,
      finalResult === "loss" && selectedYardsPerPlayGap !== null && selectedYardsPerPlayGap <= -1 ? "matchup_efficiency_miss" : null,
      finalResult === "loss" && selectedYardsPerPlayGap !== null && selectedYardsPerPlayGap >= 0.75 ? "finishing_or_scoreboard_variance" : null,
      finalResult === "loss" && selectedSackGap !== null && selectedSackGap >= 3 ? "pass_protection_pressure_miss" : null,
      finalResult === "loss" && record.market === "total" && combinedPlays !== null && combinedPlays >= 130 ? "high_pace_volume_miss" : null,
      finalResult === "loss" && record.market === "total" && combinedPlays !== null && combinedPlays <= 115 ? "low_pace_volume_miss" : null,
    ].filter((value): value is string => value !== null);
    return {
      id: record.id,
      date: record.slate_date,
      matchup: record.matchup,
      game: {
        providerGameId: payload.game.providerGameId,
        home: payload.game.home.abbreviation,
        away: payload.game.away.abbreviation,
      },
      market: record.market,
      published: {
        pick: record.pick,
        storedSide: record.side,
        side: finalSide,
        appendOnlySideCorrectionApplied: record.side !== finalSide,
        line: record.line_value,
        canonicalLine,
        price: record.odds_american,
        probability: record.model_probability,
        marketProbability: record.market_probability,
        grade: gradeKey(record.play_grade),
        actionable: isActionable(record),
        result: finalResult,
        plus3Result: record.market === "moneyline" ? null : actualResult(actual, record.market, finalSide, record.line_value, 3),
        plus6Result: record.market === "moneyline" ? null : actualResult(actual, record.market, finalSide, record.line_value, 6),
      },
      releases: {
        decision: record.model_version,
        calibration: record.calibration_version,
        evidence: payload.schemaRelease,
        member: payload.decisions.modelPromotionStatus,
      },
      actual,
      scores: {
        independent: independentScore,
        providerComponent: providerComponentScore,
        calibratedCore: calibratedCoreScore,
        final: finalScore,
        marketAnchor: marketAnchorScore,
        challengers: Object.fromEntries(Object.entries(challengerScores).map(([name, scores]) => [
          name,
          scores.get(challengerKey) ?? null,
        ])),
      },
      errors: {
        independentMargin: independentScore ? independentScore.home - independentScore.away - (actual.home - actual.away) : null,
        independentTotal: independentScore ? independentScore.home + independentScore.away - actual.home - actual.away : null,
        providerComponentMargin: providerComponentScore
          ? providerComponentScore.home - providerComponentScore.away - (actual.home - actual.away)
          : null,
        providerComponentTotal: providerComponentScore
          ? providerComponentScore.home + providerComponentScore.away - actual.home - actual.away
          : null,
        finalMargin: finalScore.home - finalScore.away - (actual.home - actual.away),
        finalTotal: finalScore.home + finalScore.away - actual.home - actual.away,
        marketMargin: marketAnchorScore ? marketAnchorScore.home - marketAnchorScore.away - (actual.home - actual.away) : null,
        marketTotal: marketAnchorScore ? marketAnchorScore.home + marketAnchorScore.away - actual.home - actual.away : null,
      },
      postgameExplanation: {
        available: Boolean(homeStats && awayStats),
        selectedTurnoverSwing,
        selectedYardsPerPlayGap,
        selectedSackGap,
        combinedPlays,
        flags: explanationFlags.length ? explanationFlags : finalResult === "loss" ? ["unresolved_or_irreducible"] : [],
        warning: "Postgame box-score fields explain outcomes only; they are not pregame candidate features.",
      },
      component: {
        independentSide,
        independentResult,
        providerComponentResult,
        finalSide,
        finalResult,
        marketChangedSide,
        category,
        appliedMarginShift: payload.outcomeForecast.marketEvidence?.appliedHomeMarginShiftPoints ?? null,
        appliedTotalShift: payload.outcomeForecast.marketEvidence?.appliedTotalShiftPoints ?? null,
        spreadAuthority: payload.outcomeForecast.marketEvidence?.spreadDirection?.reason ?? null,
        spreadAuthorityStatus: payload.outcomeForecast.marketEvidence?.spreadDirection?.status ?? null,
        totalAuthority: payload.outcomeForecast.marketEvidence?.totalDirection?.reason ?? null,
        totalAuthorityStatus: payload.outcomeForecast.marketEvidence?.totalDirection?.status ?? null,
        winnerCoherenceStatus: payload.outcomeForecast.marketEvidence?.winnerCoherence?.status ?? null,
        professionalMoneylineSide: payload.outcomeForecast.marketEvidence?.professionalMarketAuthority?.reads.moneyline.side ?? null,
        targetExclusion: payload.outcomeForecast.targetExclusion?.status ?? null,
        marketAnchorSide,
        marketAnchorResult,
      },
      moneylineEvaluation: record.market === "moneyline" ? {
        modelHomeProbability: finalSide === "home" ? record.model_probability : record.model_probability === null ? null : 1 - record.model_probability,
        marketHomeProbability: homeMarketProbability,
        marketFavoriteSide,
        actualWinnerSide,
        predictedUnderdog: marketFavoriteSide !== null && finalSide !== marketFavoriteSide,
        actualUpset: marketFavoriteSide !== null && actualWinnerSide !== null && actualWinnerSide !== marketFavoriteSide,
      } : null,
      evidence: {
        healthHolds: payload.coverage.healthHolds,
        injuriesAvailable: payload.coverage.injuries,
        injuryPlayers,
        expectedQuarterbacks: payload.coverage.expectedQuarterbacks,
        playbookSplits: payload.coverage.playbookSplits,
        sharpSplits: payload.coverage.sharpApiSplits,
        multibookConsensus: payload.coverage.multibookConsensusReady,
        paidProjection: Boolean(payload.paidProjectionShadow),
      },
    };
  });
  const payloadByRecordId = new Map(records.flatMap((record) => {
    const hash = record.snapshot_json?.evidence_payload_sha256;
    const payload = typeof hash === "string" ? byHash.get(hash) : undefined;
    return payload ? [[record.id, payload] as const] : [];
  }));

  const gameRows = [...new Map(rows.map((row) => [`${row.date}:${row.matchup}`, row])).values()];
  const metric = (values: Array<number | null>) => mean(values.filter((value): value is number => value !== null));
  const absolute = (values: Array<number | null>) => metric(values.map((value) => value === null ? null : Math.abs(value)));
  const marketRows = (market: Market) => rows.filter((row) => row.market === market);
  const plus = (market: "spread" | "total", key: "plus3Result" | "plus6Result") => summary(
    marketRows(market).flatMap((row) => row.published[key] ? [{ result: row.published[key] }] : []),
  );
  const componentRows = rows.filter((row) => row.evidence.paidProjection);
  const paidScoreGames = gameRows.filter((row) => row.evidence.paidProjection);
  const losses = rows.filter((row) => row.published.result === "loss");
  const moneylines = marketRows("moneyline");
  const resolvedMoneylines = moneylines.filter((row) => row.moneylineEvaluation?.actualWinnerSide !== null);
  const predictedUpsets = resolvedMoneylines.filter((row) => row.moneylineEvaluation?.predictedUnderdog);
  const actualUpsets = resolvedMoneylines.filter((row) => row.moneylineEvaluation?.actualUpset);
  const correctUpsets = predictedUpsets.filter((row) => row.moneylineEvaluation?.actualWinnerSide === row.published.side);
  const directMargins = paidScoreGames.map((row) => row.scores.independent!.home - row.scores.independent!.away);
  const componentMargins = paidScoreGames.map((row) =>
    row.scores.providerComponent!.home - row.scores.providerComponent!.away);
  const actualMargins = paidScoreGames.map((row) => row.actual.home - row.actual.away);
  const directTotals = paidScoreGames.map((row) => row.scores.independent!.home + row.scores.independent!.away);
  const componentTotals = paidScoreGames.map((row) =>
    row.scores.providerComponent!.home + row.scores.providerComponent!.away);
  const actualTotals = paidScoreGames.map((row) => row.actual.home + row.actual.away);
  const challengerReplay = challenger ? {
    release: challenger.replayRelease,
    gamesMatched: paidScoreGames.filter((row) => Object.values(row.scores.challengers).every(Boolean)).length,
    unmatchedGames: paidScoreGames.filter((row) => Object.values(row.scores.challengers).some((score) => !score))
      .map((row) => ({ date: row.date, matchup: row.matchup, game: row.game })),
    candidates: Object.fromEntries(Object.keys(challengerScores).map((name) => {
      const scoreRows = paidScoreGames.flatMap((row) => {
        const score = row.scores.challengers[name];
        return score ? [{ row, score }] : [];
      });
      const marketRecords = (market: Market) => componentRows.filter((row) => row.market === market).flatMap((row) => {
        const score = row.scores.challengers[name];
        const result = score ? scoreResult(score, market, row.published.canonicalLine, row.actual) : null;
        return result ? [{ result }] : [];
      });
      const marriage = (market: Market) => {
        const values = componentRows.filter((row) => row.market === market).flatMap((row) => {
          const score = row.scores.challengers[name];
          if (!score) return [];
          const candidateSide = scoreSide(score, market, row.published.canonicalLine);
          const candidateResult = scoreResult(score, market, row.published.canonicalLine, row.actual);
          return candidateSide && candidateResult ? [{
            changed: candidateSide !== row.component.finalSide,
            candidateResult,
            finalResult: row.component.finalResult,
          }] : [];
        });
        return {
          changedSides: values.filter((value) => value.changed).length,
          corrections: values.filter((value) => value.changed && value.candidateResult === "loss" && value.finalResult === "win").length,
          harms: values.filter((value) => value.changed && value.candidateResult === "win" && value.finalResult === "loss").length,
          neutralChanges: values.filter((value) => value.changed && value.candidateResult === value.finalResult).length,
          unchanged: values.filter((value) => !value.changed).length,
          candidate: summary(values.map((value) => ({ result: value.candidateResult }))),
          existingFinal: summary(values.map((value) => ({ result: value.finalResult }))),
        };
      };
      const selectiveMarriage = (market: Market, policy: "qualified_direction" | "professional_only") => {
        const values = componentRows.filter((row) => row.market === market).flatMap((row) => {
          const score = row.scores.challengers[name];
          if (!score) return [];
          const candidateSide = scoreSide(score, market, row.published.canonicalLine);
          const candidateResult = scoreResult(score, market, row.published.canonicalLine, row.actual);
          if (!candidateSide || !candidateResult) return [];
          const qualified = market === "moneyline"
            ? row.component.winnerCoherenceStatus === "authorized"
            : market === "spread"
              ? row.component.spreadAuthorityStatus === "available"
              : row.component.totalAuthorityStatus === "available";
          const professional = market === "moneyline"
            ? qualified && row.component.professionalMoneylineSide !== null
            : market === "spread"
              ? String(row.component.spreadAuthority ?? "").startsWith("professional_market_")
              : String(row.component.totalAuthority ?? "").startsWith("professional_market_");
          const applies = policy === "professional_only" ? professional : qualified;
          const selectedResult = applies ? row.component.finalResult : candidateResult;
          const changed = applies && candidateSide !== row.component.finalSide;
          return [{ applies, changed, candidateResult, selectedResult }];
        });
        return {
          policy,
          authoritativeReads: values.filter((value) => value.applies).length,
          changedSides: values.filter((value) => value.changed).length,
          corrections: values.filter((value) => value.changed && value.candidateResult === "loss" && value.selectedResult === "win").length,
          harms: values.filter((value) => value.changed && value.candidateResult === "win" && value.selectedResult === "loss").length,
          result: summary(values.map((value) => ({ result: value.selectedResult }))),
        };
      };
      const margins = scoreRows.map(({ score }) => score.home - score.away);
      const totals = scoreRows.map(({ score }) => score.home + score.away);
      const marryScore = ({ row, score }: (typeof scoreRows)[number], requireTargetFree: boolean) => {
        let margin = score.home - score.away;
        let total = score.home + score.away;
        const marketMargin = row.scores.marketAnchor
          ? row.scores.marketAnchor.home - row.scores.marketAnchor.away
          : null;
        const marketTotal = row.scores.marketAnchor
          ? row.scores.marketAnchor.home + row.scores.marketAnchor.away
          : null;
        let moneylineApplied = false;
        let spreadApplied = false;
        let totalApplied = false;
        const eligible = !requireTargetFree || row.component.targetExclusion === "target_excluded_market";
        if (eligible && row.component.winnerCoherenceStatus === "authorized") {
          const desired = Math.sign(row.scores.final.home - row.scores.final.away);
          if (desired !== 0 && Math.sign(margin) !== desired) {
            margin = -margin;
            moneylineApplied = true;
          }
        }
        if (eligible && marketMargin !== null && String(row.component.spreadAuthority ?? "").startsWith("professional_market_")) {
          const desired = String(row.component.spreadAuthority).endsWith("_home") ? 1 : -1;
          if (Math.sign(margin - marketMargin) !== desired) {
            margin = 2 * marketMargin - margin;
            spreadApplied = true;
          }
        }
        if (eligible && marketTotal !== null && row.component.totalAuthorityStatus === "available") {
          const desired = String(row.component.totalAuthority).endsWith("_over") ? 1 : -1;
          if (Math.sign(total - marketTotal) !== desired) {
            total = 2 * marketTotal - total;
            totalApplied = true;
          }
        }
        return {
          row,
          score: { home: (total + margin) / 2, away: (total - margin) / 2 },
          actions: { moneylineApplied, spreadApplied, totalApplied },
        };
      };
      const marriedScoreRows = scoreRows.map((value) => marryScore(value, false));
      const targetFreeMarriedScoreRows = scoreRows.map((value) => marryScore(value, true));
      const marriedByGame = new Map(marriedScoreRows.map(({ row, score }) => [`${row.date}:${row.matchup}`, score]));
      const targetFreeMarriedByGame = new Map(
        targetFreeMarriedScoreRows.map(({ row, score }) => [`${row.date}:${row.matchup}`, score]),
      );
      const marriedMarketRecords = (
        market: Market,
        cushion = 0,
        scoresByGame = marriedByGame,
      ) => componentRows
        .filter((row) => row.market === market)
        .flatMap((row) => {
          const score = scoresByGame.get(`${row.date}:${row.matchup}`);
          const result = score ? scoreResult(score, market, row.published.canonicalLine, row.actual, cushion) : null;
          return result ? [{ result }] : [];
        });
      const probabilityQuality = (scoresByGame: Map<string, Score>) => Object.fromEntries(
        MARKETS.map((market) => [market, properScores(componentRows
          .filter((row) => row.market === market)
          .map((row) => {
            const score = scoresByGame.get(`${row.date}:${row.matchup}`);
            const payload = payloadByRecordId.get(row.id);
            if (!score || !payload) return { probability: null, outcome: null };
            const forecast = buildNflIndependentScoreBaseForecast({
              baseForecast: payload.outcomeForecast,
              independentScore: {
                expectedHomeMargin: score.home - score.away,
                expectedTotal: score.home + score.away,
                marketInputPolicy: "prohibited_from_independent_score",
              },
            });
            if (market === "moneyline") {
              return {
                probability: forecast.homeWinProbability,
                outcome: row.actual.home === row.actual.away ? null : row.actual.home > row.actual.away ? 1 : 0,
              };
            }
            if (row.published.canonicalLine === null) return { probability: null, outcome: null };
            const probabilities = nflV1WeekOneLineProbabilities({
              forecast,
              homeSpread: market === "spread" ? row.published.canonicalLine : 0,
              totalLine: market === "total" ? row.published.canonicalLine : 0,
            });
            const actualAxis = market === "spread"
              ? row.actual.home - row.actual.away + row.published.canonicalLine
              : row.actual.home + row.actual.away - row.published.canonicalLine;
            return {
              probability: market === "spread"
                ? probabilities.spread.homeCoverProbability
                : probabilities.total.overProbability,
              outcome: actualAxis === 0 ? null : actualAxis > 0 ? 1 : 0,
            };
          }))]),
      );
      const independentByGame = new Map(scoreRows.map(({ row, score }) => [`${row.date}:${row.matchup}`, score]));
      const moneylineSegments = (scoresByGame: Map<string, Score>) => {
        const values = componentRows.filter((row) => row.market === "moneyline").flatMap((row) => {
          const score = scoresByGame.get(`${row.date}:${row.matchup}`);
          const candidateSide = score ? scoreSide(score, "moneyline", null) : null;
          const result = score ? scoreResult(score, "moneyline", null, row.actual) : null;
          const favorite = row.moneylineEvaluation?.marketFavoriteSide ?? null;
          return candidateSide && result && favorite ? [{ candidateSide, favorite, result }] : [];
        });
        return {
          predictedFavorite: summary(values.filter((value) => value.candidateSide === value.favorite)),
          predictedUnderdog: summary(values.filter((value) => value.candidateSide !== value.favorite)),
        };
      };
      return [name, {
        games: scoreRows.length,
        pointForecast: {
          marginMae: absolute(scoreRows.map(({ row, score }) =>
            score.home - score.away - (row.actual.home - row.actual.away))),
          totalMae: absolute(scoreRows.map(({ row, score }) =>
            score.home + score.away - row.actual.home - row.actual.away)),
          marginBias: metric(scoreRows.map(({ row, score }) =>
            score.home - score.away - (row.actual.home - row.actual.away))),
          totalBias: metric(scoreRows.map(({ row, score }) =>
            score.home + score.away - row.actual.home - row.actual.away)),
          marginCorrelation: correlation(margins, scoreRows.map(({ row }) => row.actual.home - row.actual.away)),
          totalCorrelation: correlation(totals, scoreRows.map(({ row }) => row.actual.home + row.actual.away)),
        },
        directions: Object.fromEntries(MARKETS.map((market) => [market, {
          direct: summary(marketRecords(market)),
          ...(market === "moneyline" ? {} : {
            plus3: summary(componentRows.filter((row) => row.market === market).flatMap((row) => {
              const score = row.scores.challengers[name];
              const result = score ? scoreResult(score, market, row.published.canonicalLine, row.actual, 3) : null;
              return result ? [{ result }] : [];
            })),
            plus6: summary(componentRows.filter((row) => row.market === market).flatMap((row) => {
              const score = row.scores.challengers[name];
              const result = score ? scoreResult(score, market, row.published.canonicalLine, row.actual, 6) : null;
              return result ? [{ result }] : [];
            })),
          }),
        }])),
        probabilityQuality: probabilityQuality(independentByGame),
        moneylineSegments: moneylineSegments(independentByGame),
        existingMarketReaderMarriage: Object.fromEntries(MARKETS.map((market) => [market, marriage(market)])),
        selectiveMarketReaderMarriage: Object.fromEntries(MARKETS.map((market) => [market, {
          qualifiedDirection: selectiveMarriage(market, "qualified_direction"),
          professionalOnly: selectiveMarriage(market, "professional_only"),
        }])),
        noWeightCoherentMarketMarriage: {
          actions: {
            moneylineWinnerCorrections: marriedScoreRows.filter((value) => value.actions.moneylineApplied).length,
            professionalSpreadCorrections: marriedScoreRows.filter((value) => value.actions.spreadApplied).length,
            qualifiedTotalCorrections: marriedScoreRows.filter((value) => value.actions.totalApplied).length,
          },
          pointForecast: {
            marginMae: absolute(marriedScoreRows.map(({ row, score }) =>
              score.home - score.away - (row.actual.home - row.actual.away))),
            totalMae: absolute(marriedScoreRows.map(({ row, score }) =>
              score.home + score.away - row.actual.home - row.actual.away)),
            marginBias: metric(marriedScoreRows.map(({ row, score }) =>
              score.home - score.away - (row.actual.home - row.actual.away))),
            totalBias: metric(marriedScoreRows.map(({ row, score }) =>
              score.home + score.away - row.actual.home - row.actual.away)),
          },
          directions: Object.fromEntries(MARKETS.map((market) => [market, {
            direct: summary(marriedMarketRecords(market)),
            ...(market === "moneyline" ? {} : {
              plus3: summary(marriedMarketRecords(market, 3)),
              plus6: summary(marriedMarketRecords(market, 6)),
            }),
          }])),
        },
        targetFreeNoWeightCoherentMarketMarriage: {
          actions: {
            eligibleGames: targetFreeMarriedScoreRows.filter(
              ({ row }) => row.component.targetExclusion === "target_excluded_market",
            ).length,
            fallbackGames: targetFreeMarriedScoreRows.filter(
              ({ row }) => row.component.targetExclusion !== "target_excluded_market",
            ).length,
            moneylineWinnerCorrections: targetFreeMarriedScoreRows.filter(
              (value) => value.actions.moneylineApplied,
            ).length,
            professionalSpreadCorrections: targetFreeMarriedScoreRows.filter(
              (value) => value.actions.spreadApplied,
            ).length,
            qualifiedTotalCorrections: targetFreeMarriedScoreRows.filter(
              (value) => value.actions.totalApplied,
            ).length,
          },
          pointForecast: {
            marginMae: absolute(targetFreeMarriedScoreRows.map(({ row, score }) =>
              score.home - score.away - (row.actual.home - row.actual.away))),
            totalMae: absolute(targetFreeMarriedScoreRows.map(({ row, score }) =>
              score.home + score.away - row.actual.home - row.actual.away)),
            marginBias: metric(targetFreeMarriedScoreRows.map(({ row, score }) =>
              score.home - score.away - (row.actual.home - row.actual.away))),
            totalBias: metric(targetFreeMarriedScoreRows.map(({ row, score }) =>
              score.home + score.away - row.actual.home - row.actual.away)),
          },
          directions: Object.fromEntries(MARKETS.map((market) => [market, {
            direct: summary(marriedMarketRecords(market, 0, targetFreeMarriedByGame)),
            ...(market === "moneyline" ? {} : {
              plus3: summary(marriedMarketRecords(market, 3, targetFreeMarriedByGame)),
              plus6: summary(marriedMarketRecords(market, 6, targetFreeMarriedByGame)),
            }),
          }])),
          probabilityQuality: probabilityQuality(targetFreeMarriedByGame),
          moneylineSegments: moneylineSegments(targetFreeMarriedByGame),
        },
      }];
    })),
  } : null;
  const report = {
    release: "nfl_2026_loss_ledger_2026_10_15_r1",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    writes: 0,
    population: {
      originalLockedRecords: rows.length,
      correctionRecordsExcluded: allRecords.length - records.length,
      games: gameRows.length,
      dateRange: [rows[0]?.date ?? null, rows.at(-1)?.date ?? null],
      releases: [...new Set(rows.map((row) => `${row.releases.decision}|${row.releases.calibration ?? ""}`))],
    },
    published: {
      moneyline: summary(marketRows("moneyline").map((row) => ({ result: row.published.result }))),
      spread: summary(marketRows("spread").map((row) => ({ result: row.published.result }))),
      spreadPlus3: plus("spread", "plus3Result"),
      spreadPlus6: plus("spread", "plus6Result"),
      total: summary(marketRows("total").map((row) => ({ result: row.published.result }))),
      totalPlus3: plus("total", "plus3Result"),
      totalPlus6: plus("total", "plus6Result"),
      actionable: summary(rows.filter((row) => row.published.actionable).map((row) => ({ result: row.published.result }))),
      byGrade: byKey(rows, (row) => row.published.grade, (values) => summary(values.map((row) => ({ result: row.published.result })))),
      byRelease: byKey(rows, (row) => row.releases.decision, (values) => Object.fromEntries(MARKETS.map((market) => [
        market,
        summary(values.filter((row) => row.market === market).map((row) => ({ result: row.published.result }))),
      ]))),
      probabilityQuality: {
        modelMoneyline: properScores(resolvedMoneylines.map((row) => ({
          probability: row.moneylineEvaluation?.modelHomeProbability ?? null,
          outcome: row.moneylineEvaluation?.actualWinnerSide === "home" ? 1 : 0,
        }))),
        marketConsensusMoneyline: properScores(resolvedMoneylines.map((row) => ({
          probability: row.moneylineEvaluation?.marketHomeProbability ?? null,
          outcome: row.moneylineEvaluation?.actualWinnerSide === "home" ? 1 : 0,
        }))),
        marketFavoriteBaseline: {
          correct: resolvedMoneylines.filter((row) =>
            row.moneylineEvaluation?.marketFavoriteSide === row.moneylineEvaluation?.actualWinnerSide).length,
          games: resolvedMoneylines.length,
        },
        upsetDetection: {
          predicted: predictedUpsets.length,
          actual: actualUpsets.length,
          correct: correctUpsets.length,
          precision: predictedUpsets.length ? correctUpsets.length / predictedUpsets.length : null,
          recall: actualUpsets.length ? correctUpsets.length / actualUpsets.length : null,
        },
      },
    },
    alternateLineMethod: "Selected Spread receives +3/+6 points; Over line is lowered and Under line raised by 3/6. Pushes excluded from accuracy.",
    componentPopulation: {
      games: [...new Set(componentRows.map((row) => `${row.date}:${row.matchup}`))].length,
      records: componentRows.length,
      note: "Pure paid-score comparisons are limited to locks that stored the paid projection before the market-informed final score.",
      byMarket: Object.fromEntries(MARKETS.map((market) => {
        const values = componentRows.filter((row) => row.market === market);
        return [market, {
          independent: summary(values.flatMap((row) => row.component.independentResult ? [{ result: row.component.independentResult }] : [])),
          final: summary(values.map((row) => ({ result: row.component.finalResult }))),
          categories: byKey(values, (row) => row.component.category, (group) => group.length),
        }];
      })),
    },
    independentAutopsy: {
      games: paidScoreGames.length,
      source: {
        currentIndependent: "opponent DST fantasy-projection points_allowed field",
        providerComponent: "sum of projected touchdowns, kicks, returns, and safeties",
        warning: "Both are provider fantasy projections, not an independently trained OddSphere game model.",
      },
      directions: Object.fromEntries(MARKETS.map((market) => {
        const values = componentRows.filter((row) => row.market === market);
        return [market, {
          currentIndependent: summary(values.flatMap((row) =>
            row.component.independentResult ? [{ result: row.component.independentResult }] : [])),
          providerComponent: summary(values.flatMap((row) =>
            row.component.providerComponentResult ? [{ result: row.component.providerComponentResult }] : [])),
          sideDisagreements: values.filter((row) =>
            scoreSide(row.scores.independent!, market, row.published.canonicalLine) !==
            scoreSide(row.scores.providerComponent!, market, row.published.canonicalLine)).length,
        }];
      })),
      pointForecast: {
        currentIndependent: {
          marginMae: absolute(paidScoreGames.map((row) => row.errors.independentMargin)),
          totalMae: absolute(paidScoreGames.map((row) => row.errors.independentTotal)),
          marginBias: metric(paidScoreGames.map((row) => row.errors.independentMargin)),
          totalBias: metric(paidScoreGames.map((row) => row.errors.independentTotal)),
          marginCorrelation: correlation(directMargins, actualMargins),
          totalCorrelation: correlation(directTotals, actualTotals),
        },
        providerComponent: {
          marginMae: absolute(paidScoreGames.map((row) => row.errors.providerComponentMargin)),
          totalMae: absolute(paidScoreGames.map((row) => row.errors.providerComponentTotal)),
          marginBias: metric(paidScoreGames.map((row) => row.errors.providerComponentMargin)),
          totalBias: metric(paidScoreGames.map((row) => row.errors.providerComponentTotal)),
          marginCorrelation: correlation(componentMargins, actualMargins),
          totalCorrelation: correlation(componentTotals, actualTotals),
        },
      },
    },
    ...(challengerReplay ? { challengerReplay } : {}),
    scoreError: {
      allFinalGames: {
        marginMae: absolute(gameRows.map((row) => row.errors.finalMargin)),
        totalMae: absolute(gameRows.map((row) => row.errors.finalTotal)),
        marginBias: metric(gameRows.map((row) => row.errors.finalMargin)),
        totalBias: metric(gameRows.map((row) => row.errors.finalTotal)),
      },
      paidScoreGames: {
        independentMarginMae: absolute(gameRows.map((row) => row.errors.independentMargin)),
        finalMarginMae: absolute(gameRows.filter((row) => row.evidence.paidProjection).map((row) => row.errors.finalMargin)),
        marketMarginMae: absolute(gameRows.filter((row) => row.evidence.paidProjection).map((row) => row.errors.marketMargin)),
        independentTotalMae: absolute(gameRows.map((row) => row.errors.independentTotal)),
        finalTotalMae: absolute(gameRows.filter((row) => row.evidence.paidProjection).map((row) => row.errors.finalTotal)),
        marketTotalMae: absolute(gameRows.filter((row) => row.evidence.paidProjection).map((row) => row.errors.marketTotal)),
      },
    },
    lossThemes: {
      totalLosses: losses.length,
      byMarket: byKey(losses, (row) => row.market, (values) => values.length),
      byComponent: byKey(losses, (row) => row.component.category, (values) => values.length),
      missingInjuryEvidence: losses.filter((row) => !row.evidence.injuriesAvailable).length,
      missingExpectedQuarterback: losses.filter((row) => !row.evidence.expectedQuarterbacks).length,
      missingPaidProjection: losses.filter((row) => !row.evidence.paidProjection).length,
      targetExclusionFallback: losses.filter((row) => row.component.targetExclusion === "incumbent_fallback").length,
      appliedMarketMeanShift: losses.filter((row) =>
        Math.abs(row.component.appliedMarginShift ?? 0) > 0 || Math.abs(row.component.appliedTotalShift ?? 0) > 0).length,
      postgameExplanationFlags: byKey(
        losses.flatMap((row) => row.postgameExplanation.flags.map((flag) => ({ flag }))),
        (row) => row.flag,
        (values) => values.length,
      ),
    },
    losses,
  };
  if (process.argv.includes("--independent-autopsy")) {
    process.stdout.write(`${JSON.stringify(report.independentAutopsy, null, 2)}\n`);
    return;
  }
  if (process.argv.includes("--paid-score-games")) {
    process.stdout.write(`${JSON.stringify(paidScoreGames.map((row) => ({
      date: row.date,
      matchup: row.matchup,
      game: row.game,
      actual: row.actual,
      independent: row.scores.independent,
      final: row.scores.final,
      marketAnchor: row.scores.marketAnchor,
    })), null, 2)}\n`);
    return;
  }
  if (process.argv.includes("--challenger-replay")) {
    const candidateName = process.argv.find((value) => value.startsWith("--challenger-candidate="))
      ?.slice("--challenger-candidate=".length);
    const candidate = candidateName && challengerReplay
      ? challengerReplay.candidates[candidateName]
      : null;
    process.stdout.write(`${JSON.stringify(candidateName ? {
      release: challengerReplay?.release ?? null,
      candidateName,
      candidate,
    } : challengerReplay, null, 2)}\n`);
    return;
  }
  const challengerAuditName = process.argv.find((value) => value.startsWith("--challenger-audit="))
    ?.slice("--challenger-audit=".length);
  if (challengerAuditName) {
    process.stdout.write(`${JSON.stringify({
      release: challengerReplay?.release ?? null,
      candidateName: challengerAuditName,
      audit: challengerReplay?.candidates?.[challengerAuditName] ?? null,
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
