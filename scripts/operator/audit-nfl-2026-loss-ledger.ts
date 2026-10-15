/**
 * SELECT-only, release-pure NFL Daily Edge loss ledger.
 *
 * The ledger keeps immutable published results separate from counterfactual
 * score layers. It never writes predictions, grades, evidence, or locks.
 */

import { createClient } from "@supabase/supabase-js";

import {
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
} from "../../lib/services/football/nflForwardEvidence";
import { nflV1WeekOneLineProbabilities } from "../../lib/services/football/nflV1WeekOneOutcome";
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

function scoreResult(score: Score | null, market: Market, line: number | null, actual: Score): Result | null {
  if (!score) return null;
  const side = scoreSide(score, market, line);
  return side ? actualResult(actual, market, side, line) : "push";
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
    const finalScore = {
      away: payload.outcomeForecast.expectedAwayScore,
      home: payload.outcomeForecast.expectedHomeScore,
    };
    const independentScore = payload.paidProjectionShadow ? {
      away: payload.paidProjectionShadow.expectedAwayScore,
      home: payload.paidProjectionShadow.expectedHomeScore,
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
    const independentSide = independentScore ? scoreSide(independentScore, record.market, record.line_value) : null;
    const finalSide = publishedForecastSide(payload, record);
    const independentResult = scoreResult(independentScore, record.market, record.line_value, actual);
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
    const marketAnchorSide = marketAnchorScore ? scoreSide(marketAnchorScore, record.market, record.line_value) : null;
    const marketAnchorResult = marketAnchorSide ? actualResult(actual, record.market, marketAnchorSide, record.line_value) : null;
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
      market: record.market,
      published: {
        pick: record.pick,
        storedSide: record.side,
        side: finalSide,
        appendOnlySideCorrectionApplied: record.side !== finalSide,
        line: record.line_value,
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
      scores: { independent: independentScore, calibratedCore: calibratedCoreScore, final: finalScore, marketAnchor: marketAnchorScore },
      errors: {
        independentMargin: independentScore ? independentScore.home - independentScore.away - (actual.home - actual.away) : null,
        independentTotal: independentScore ? independentScore.home + independentScore.away - actual.home - actual.away : null,
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
        finalSide,
        finalResult,
        marketChangedSide,
        category,
        appliedMarginShift: payload.outcomeForecast.marketEvidence?.appliedHomeMarginShiftPoints ?? null,
        appliedTotalShift: payload.outcomeForecast.marketEvidence?.appliedTotalShiftPoints ?? null,
        spreadAuthority: payload.outcomeForecast.marketEvidence?.spreadDirection?.reason ?? null,
        totalAuthority: payload.outcomeForecast.marketEvidence?.totalDirection?.reason ?? null,
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

  const gameRows = [...new Map(rows.map((row) => [`${row.date}:${row.matchup}`, row])).values()];
  const metric = (values: Array<number | null>) => mean(values.filter((value): value is number => value !== null));
  const absolute = (values: Array<number | null>) => metric(values.map((value) => value === null ? null : Math.abs(value)));
  const marketRows = (market: Market) => rows.filter((row) => row.market === market);
  const plus = (market: "spread" | "total", key: "plus3Result" | "plus6Result") => summary(
    marketRows(market).flatMap((row) => row.published[key] ? [{ result: row.published[key] }] : []),
  );
  const componentRows = rows.filter((row) => row.evidence.paidProjection);
  const losses = rows.filter((row) => row.published.result === "loss");
  const moneylines = marketRows("moneyline");
  const resolvedMoneylines = moneylines.filter((row) => row.moneylineEvaluation?.actualWinnerSide !== null);
  const predictedUpsets = resolvedMoneylines.filter((row) => row.moneylineEvaluation?.predictedUnderdog);
  const actualUpsets = resolvedMoneylines.filter((row) => row.moneylineEvaluation?.actualUpset);
  const correctUpsets = predictedUpsets.filter((row) => row.moneylineEvaluation?.actualWinnerSide === row.published.side);
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
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
