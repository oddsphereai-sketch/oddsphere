/**
 * Chronological NBA score-state audit.
 *
 * This is an audit-only, read-only replay. It deliberately uses only rows
 * that occurred before the game being predicted. The external CSV supplies
 * final scores and closing market benchmarks; it is never a production model
 * input. Candidate selection uses 2024-25 and the report is then frozen on
 * the later 2025-26 confirmation block.
 *
 * Usage:
 *   npx tsx scripts/audit/nba/replay-nba-independent-score-state.ts \
 *     /private/tmp/oddsphere-nba-odds-clean.csv
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

type Game = {
  date: string;
  season: number;
  home: string;
  away: string;
  actualHome: number;
  actualAway: number;
  marketTotal: number;
  marketHomeMargin: number;
  marketHomeProbability: number;
  restHome: number;
  restAway: number;
};

type Parameters = {
  learningRate: number;
  carry: number;
  homeAdvantage: number;
  restPoint: number;
  residualCap: number;
  offenseShare: number;
  leagueRate: number;
};

type TeamState = { offense: number; defense: number };

type Metric = {
  games: number;
  teamScoreAbsoluteError: number;
  marginAbsoluteError: number;
  totalAbsoluteError: number;
  winnerCorrect: number;
  spreadCorrect: number;
  totalCorrect: number;
  spreadDecisions: number;
  totalDecisions: number;
};

type Report = {
  independent: Metric;
  marketGrounded65: Metric;
  marketBenchmark: Metric;
  crossing: Record<string, Metric>;
};

type PredictionLedgerRow = {
  date: string;
  season: number;
  home: string;
  away: string;
  actualHome: number;
  actualAway: number;
  predictedHome: number;
  predictedAway: number;
  actualMargin: number;
  predictedMargin: number;
  actualTotal: number;
  predictedTotal: number;
  homeScoreSignedError: number;
  awayScoreSignedError: number;
  marginSignedError: number;
  totalSignedError: number;
  teamScoreAbsoluteError: number;
  marginAbsoluteError: number;
  totalAbsoluteError: number;
  winnerCorrect: boolean;
  spreadDirectionCorrect: boolean | null;
  totalDirectionCorrect: boolean | null;
  marketHomeMargin: number;
  marketTotal: number;
  marketHomeProbability: number;
  errorContext: "winner_correct" | "model_and_market_favorite_lost" | "model_upset_call_failed" | "market_pickem";
  causeAttribution: "not_attributed_requires_postgame_component_evidence";
};

const CROSSING_THRESHOLDS = [0.52, 0.55, 0.58, 0.6, 0.62, 0.65] as const;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function number(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function seasonForDate(date: string): number {
  const year = Number.parseInt(date.slice(0, 4), 10);
  const month = Number.parseInt(date.slice(5, 7), 10);
  return month >= 7 ? year : year - 1;
}

function parseCsv(path: string): Game[] {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const header = lines.shift()?.split(",") ?? [];
  const index = (name: string): number => {
    const found = header.indexOf(name);
    if (found < 0) throw new Error(`missing CSV column ${name}`);
    return found;
  };
  const col = {
    date: index("Date"), home: index("Home"), away: index("Away"),
    total: index("OU"), spread: index("Spread"), mlHome: index("ML_Home"),
    points: index("Points"), margin: index("Win_Margin"),
    restHome: index("Days_Rest_Home"), restAway: index("Days_Rest_Away"),
    marketHomeProbability: index("market_home_prob"),
  };
  const games: Game[] = [];
  for (const line of lines) {
    const row = line.split(",");
    const total = number(row[col.total] ?? "");
    const spreadMagnitude = number(row[col.spread] ?? "");
    const mlHome = number(row[col.mlHome] ?? "");
    const points = number(row[col.points] ?? "");
    const margin = number(row[col.margin] ?? "");
    const restHome = number(row[col.restHome] ?? "");
    const restAway = number(row[col.restAway] ?? "");
    const marketHomeProbability = number(row[col.marketHomeProbability] ?? "");
    const date = row[col.date] ?? "";
    if (
      !date || !finite(total) || !finite(spreadMagnitude) || !finite(mlHome) ||
      !finite(points) || !finite(margin) || !finite(restHome) ||
      !finite(restAway) || !finite(marketHomeProbability)
    ) continue;
    const actualHome = (points + margin) / 2;
    const actualAway = (points - margin) / 2;
    if (!Number.isInteger(actualHome) || !Number.isInteger(actualAway)) continue;
    games.push({
      date,
      season: seasonForDate(date),
      home: row[col.home]!,
      away: row[col.away]!,
      actualHome,
      actualAway,
      marketTotal: total,
      // The modern-season rows store the market's expected HOME margin:
      // positive when the home team is favored, negative when it is the dog.
      marketHomeMargin: spreadMagnitude,
      marketHomeProbability,
      restHome,
      restAway,
    });
  }
  return games.sort((left, right) => left.date.localeCompare(right.date));
}

function blankMetric(): Metric {
  return {
    games: 0,
    teamScoreAbsoluteError: 0,
    marginAbsoluteError: 0,
    totalAbsoluteError: 0,
    winnerCorrect: 0,
    spreadCorrect: 0,
    totalCorrect: 0,
    spreadDecisions: 0,
    totalDecisions: 0,
  };
}

function addMetric(
  metric: Metric,
  game: Game,
  projectedHome: number,
  projectedAway: number,
): void {
  const projectedMargin = projectedHome - projectedAway;
  const projectedTotal = projectedHome + projectedAway;
  const actualMargin = game.actualHome - game.actualAway;
  const actualTotal = game.actualHome + game.actualAway;
  metric.games += 1;
  metric.teamScoreAbsoluteError +=
    (Math.abs(projectedHome - game.actualHome) + Math.abs(projectedAway - game.actualAway)) / 2;
  metric.marginAbsoluteError += Math.abs(projectedMargin - actualMargin);
  metric.totalAbsoluteError += Math.abs(projectedTotal - actualTotal);
  metric.winnerCorrect += Math.sign(projectedMargin) === Math.sign(actualMargin) ? 1 : 0;
  const projectedSpreadResult = projectedMargin - game.marketHomeMargin;
  const actualSpreadResult = actualMargin - game.marketHomeMargin;
  if (projectedSpreadResult !== 0 && actualSpreadResult !== 0) {
    metric.spreadDecisions += 1;
    metric.spreadCorrect += Math.sign(projectedSpreadResult) === Math.sign(actualSpreadResult) ? 1 : 0;
  }
  const projectedTotalResult = projectedTotal - game.marketTotal;
  const actualTotalResult = actualTotal - game.marketTotal;
  if (projectedTotalResult !== 0 && actualTotalResult !== 0) {
    metric.totalDecisions += 1;
    metric.totalCorrect += Math.sign(projectedTotalResult) === Math.sign(actualTotalResult) ? 1 : 0;
  }
}

function clip(value: number, maximum: number): number {
  return Math.max(-maximum, Math.min(maximum, value));
}

function replay(
  games: readonly Game[],
  parameters: Parameters,
  ledger?: PredictionLedgerRow[],
): Map<number, Report> {
  const states = new Map<string, TeamState>();
  const reports = new Map<number, Report>();
  let leagueMean = 114.5;
  let activeSeason: number | null = null;
  const state = (team: string): TeamState => {
    const existing = states.get(team);
    if (existing) return existing;
    const created = { offense: 0, defense: 0 };
    states.set(team, created);
    return created;
  };

  for (const game of games) {
    if (activeSeason !== game.season) {
      if (activeSeason !== null) {
        for (const value of states.values()) {
          value.offense *= parameters.carry;
          value.defense *= parameters.carry;
        }
      }
      activeSeason = game.season;
    }
    const home = state(game.home);
    const away = state(game.away);
    const restDelta = Math.max(-2, Math.min(2, game.restHome - game.restAway));
    const restAdjustment = restDelta * parameters.restPoint;
    const projectedHome =
      leagueMean + home.offense + away.defense + parameters.homeAdvantage / 2 + restAdjustment / 2;
    const projectedAway =
      leagueMean + away.offense + home.defense - parameters.homeAdvantage / 2 - restAdjustment / 2;

    if (ledger) {
      const predictedMargin = projectedHome - projectedAway;
      const predictedTotal = projectedHome + projectedAway;
      const actualMargin = game.actualHome - game.actualAway;
      const actualTotal = game.actualHome + game.actualAway;
      const predictedHomeWin = predictedMargin > 0;
      const actualHomeWin = actualMargin > 0;
      const winnerCorrect = predictedHomeWin === actualHomeWin;
      const spreadPrediction = predictedMargin - game.marketHomeMargin;
      const spreadResult = actualMargin - game.marketHomeMargin;
      const totalPrediction = predictedTotal - game.marketTotal;
      const totalResult = actualTotal - game.marketTotal;
      const marketPickem = game.marketHomeProbability === 0.5 || game.marketHomeMargin === 0;
      const marketHomeFavorite = game.marketHomeProbability > 0.5;
      ledger.push({
        date: game.date,
        season: game.season,
        home: game.home,
        away: game.away,
        actualHome: game.actualHome,
        actualAway: game.actualAway,
        predictedHome: projectedHome,
        predictedAway: projectedAway,
        actualMargin,
        predictedMargin,
        actualTotal,
        predictedTotal,
        homeScoreSignedError: projectedHome - game.actualHome,
        awayScoreSignedError: projectedAway - game.actualAway,
        marginSignedError: predictedMargin - actualMargin,
        totalSignedError: predictedTotal - actualTotal,
        teamScoreAbsoluteError:
          (Math.abs(projectedHome - game.actualHome) + Math.abs(projectedAway - game.actualAway)) / 2,
        marginAbsoluteError: Math.abs(predictedMargin - actualMargin),
        totalAbsoluteError: Math.abs(predictedTotal - actualTotal),
        winnerCorrect,
        spreadDirectionCorrect:
          spreadPrediction === 0 || spreadResult === 0 ? null : Math.sign(spreadPrediction) === Math.sign(spreadResult),
        totalDirectionCorrect:
          totalPrediction === 0 || totalResult === 0 ? null : Math.sign(totalPrediction) === Math.sign(totalResult),
        marketHomeMargin: game.marketHomeMargin,
        marketTotal: game.marketTotal,
        marketHomeProbability: game.marketHomeProbability,
        errorContext: winnerCorrect
          ? "winner_correct"
          : marketPickem
            ? "market_pickem"
            : predictedHomeWin === marketHomeFavorite
              ? "model_and_market_favorite_lost"
              : "model_upset_call_failed",
        causeAttribution: "not_attributed_requires_postgame_component_evidence",
      });
    }

    const report = reports.get(game.season) ?? {
      independent: blankMetric(),
      marketGrounded65: blankMetric(),
      marketBenchmark: blankMetric(),
      crossing: Object.fromEntries(CROSSING_THRESHOLDS.map((threshold) => [String(threshold), blankMetric()])),
    };
    reports.set(game.season, report);
    addMetric(report.independent, game, projectedHome, projectedAway);

    const independentMargin = projectedHome - projectedAway;
    const independentTotal = projectedHome + projectedAway;
    const groundedMargin = 0.65 * independentMargin + 0.35 * game.marketHomeMargin;
    const groundedTotal = 0.65 * independentTotal + 0.35 * game.marketTotal;
    addMetric(
      report.marketGrounded65,
      game,
      (groundedTotal + groundedMargin) / 2,
      (groundedTotal - groundedMargin) / 2,
    );
    addMetric(
      report.marketBenchmark,
      game,
      (game.marketTotal + game.marketHomeMargin) / 2,
      (game.marketTotal - game.marketHomeMargin) / 2,
    );
    for (const threshold of CROSSING_THRESHOLDS) {
      const marketFavoriteProbability = Math.max(
        game.marketHomeProbability,
        1 - game.marketHomeProbability,
      );
      const winnerDisagrees = Math.sign(independentMargin) !== Math.sign(game.marketHomeMargin);
      const finalMargin = winnerDisagrees && marketFavoriteProbability >= threshold
        ? game.marketHomeMargin
        : independentMargin;
      addMetric(
        report.crossing[String(threshold)]!,
        game,
        (independentTotal + finalMargin) / 2,
        (independentTotal - finalMargin) / 2,
      );
    }

    const homeResidual = clip(game.actualHome - projectedHome, parameters.residualCap);
    const awayResidual = clip(game.actualAway - projectedAway, parameters.residualCap);
    const offenseRate = parameters.learningRate * parameters.offenseShare;
    const defenseRate = parameters.learningRate * (1 - parameters.offenseShare);
    home.offense += offenseRate * homeResidual;
    away.defense += defenseRate * homeResidual;
    away.offense += offenseRate * awayResidual;
    home.defense += defenseRate * awayResidual;
    leagueMean += parameters.leagueRate * ((game.actualHome + game.actualAway) / 2 - leagueMean);
  }
  return reports;
}

function finalize(metric: Metric): Record<string, number> {
  return {
    games: metric.games,
    teamScoreMae: metric.teamScoreAbsoluteError / metric.games,
    marginMae: metric.marginAbsoluteError / metric.games,
    totalMae: metric.totalAbsoluteError / metric.games,
    winnerAccuracy: metric.winnerCorrect / metric.games,
    spreadAccuracy: metric.spreadCorrect / metric.spreadDecisions,
    totalAccuracy: metric.totalCorrect / metric.totalDecisions,
    spreadDecisions: metric.spreadDecisions,
    totalDecisions: metric.totalDecisions,
  };
}

function parameterGrid(): Parameters[] {
  const out: Parameters[] = [];
  for (const learningRate of [0.04, 0.06, 0.08, 0.1, 0.12])
    for (const carry of [0.4, 0.6, 0.8])
      for (const homeAdvantage of [1.5, 2, 2.5, 3])
        for (const restPoint of [0, 0.25, 0.5])
          for (const residualCap of [15, 20, 25])
            for (const offenseShare of [0.5, 0.6])
              for (const leagueRate of [0.01, 0.02, 0.04])
                out.push({ learningRate, carry, homeAdvantage, restPoint, residualCap, offenseShare, leagueRate });
  return out;
}

const path = process.argv[2];
if (!path) throw new Error("CSV path required");
const outputDirectory = process.argv[3] ?? null;
const games = parseCsv(path).filter((game) => game.season >= 2023 && game.season <= 2025);
const candidates = parameterGrid().map((parameters) => {
  const reports = replay(games, parameters);
  const selection = reports.get(2024)?.independent;
  if (!selection) throw new Error("2024-25 selection block missing");
  return { parameters, selection, reports };
}).sort((left, right) => {
  const leftScore = left.selection.teamScoreAbsoluteError / left.selection.games;
  const rightScore = right.selection.teamScoreAbsoluteError / right.selection.games;
  if (leftScore !== rightScore) return leftScore - rightScore;
  const leftMargin = left.selection.marginAbsoluteError / left.selection.games;
  const rightMargin = right.selection.marginAbsoluteError / right.selection.games;
  return leftMargin - rightMargin;
});

const selected = candidates[0]!;
const predictionLedger: PredictionLedgerRow[] = [];
const selectedReports = replay(games, selected.parameters, predictionLedger);
const selectionReport = selectedReports.get(2024);
if (!selectionReport) throw new Error("selected candidate missing selection report");
const selectedCrossingThreshold = CROSSING_THRESHOLDS.map((threshold) => ({
  threshold,
  metric: selectionReport.crossing[String(threshold)]!,
})).sort((left, right) => {
  const leftScore = left.metric.teamScoreAbsoluteError / left.metric.games;
  const rightScore = right.metric.teamScoreAbsoluteError / right.metric.games;
  if (leftScore !== rightScore) return leftScore - rightScore;
  return right.metric.winnerCorrect / right.metric.games - left.metric.winnerCorrect / left.metric.games;
})[0]!.threshold;
const selectedReport = Object.fromEntries(
  [...selectedReports].map(([season, report]) => [
    String(season),
    {
      independent: finalize(report.independent),
      selectedDecisionCrossing: finalize(report.crossing[String(selectedCrossingThreshold)]!),
      incumbentMarketGrounded65: finalize(report.marketGrounded65),
      closingMarketBenchmark: finalize(report.marketBenchmark),
    },
  ]),
);
const report = {
  audit: "chronological_score_state",
  games: games.length,
  selectionSeason: 2024,
  confirmationSeason: 2025,
  candidates: candidates.length,
  selectedParameters: selected.parameters,
  selectedCrossingThreshold,
  report: selectedReport,
  topFiveSelection: candidates.slice(0, 5).map((candidate) => ({
    parameters: candidate.parameters,
    metrics: finalize(candidate.selection),
  })),
};

if (outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const confirmation = predictionLedger.filter((row) => row.season === 2025);
  const winnerErrors = confirmation.filter((row) => !row.winnerCorrect);
  const spreadErrors = confirmation.filter((row) => row.spreadDirectionCorrect === false);
  const totalErrors = confirmation.filter((row) => row.totalDirectionCorrect === false);
  const mean = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const cohort = (rows: PredictionLedgerRow[]) => ({
    games: rows.length,
    teamScoreSignedBias: mean(rows.flatMap((row) => [row.homeScoreSignedError, row.awayScoreSignedError])),
    teamScoreMae: mean(rows.map((row) => row.teamScoreAbsoluteError)),
    marginSignedBias: mean(rows.map((row) => row.marginSignedError)),
    marginMae: mean(rows.map((row) => row.marginAbsoluteError)),
    totalSignedBias: mean(rows.map((row) => row.totalSignedError)),
    totalMae: mean(rows.map((row) => row.totalAbsoluteError)),
    winnerAccuracy: mean(rows.map((row) => row.winnerCorrect ? 1 : 0)),
  });
  const grouped = <T extends string | number>(key: (row: PredictionLedgerRow) => T) => {
    const groups = new Map<string, PredictionLedgerRow[]>();
    for (const row of confirmation) {
      const label = String(key(row));
      groups.set(label, [...(groups.get(label) ?? []), row]);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, rows]) => ({ cohort: label, ...cohort(rows) }));
  };
  const diagnostics = {
    audit: "chronological_score_state_error_diagnostics",
    season: 2025,
    overall: cohort(confirmation),
    cohorts: {
      calendarMonth: grouped((row) => row.date.slice(5, 7)),
      predictedMarginBand: grouped((row) => {
        const margin = Math.abs(row.predictedMargin);
        return margin < 3 ? "00-02.99" : margin < 7 ? "03-06.99" : margin < 12 ? "07-11.99" : "12-plus";
      }),
      errorContext: grouped((row) => row.errorContext),
      homeTeam: grouped((row) => row.home),
      awayTeam: grouped((row) => row.away),
    },
    worstMisses: {
      margin: confirmation.toSorted((left, right) => right.marginAbsoluteError - left.marginAbsoluteError).slice(0, 25),
      total: confirmation.toSorted((left, right) => right.totalAbsoluteError - left.totalAbsoluteError).slice(0, 25),
      teamScore: confirmation.toSorted((left, right) => right.teamScoreAbsoluteError - left.teamScoreAbsoluteError).slice(0, 25),
    },
    attributionWarning:
      "Descriptive error concentration is not causal attribution. No result is labeled luck without timestamp-valid postgame component evidence.",
  };
  const writeJsonl = (name: string, rows: PredictionLedgerRow[]) => writeFileSync(
    `${outputDirectory}/${name}`,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  writeJsonl("confirmation-predictions.jsonl", confirmation);
  writeJsonl("confirmation-winner-errors.jsonl", winnerErrors);
  writeJsonl("confirmation-spread-errors.jsonl", spreadErrors);
  writeJsonl("confirmation-total-errors.jsonl", totalErrors);
  writeFileSync(`${outputDirectory}/diagnostics.json`, `${JSON.stringify(diagnostics, null, 2)}\n`);
  writeFileSync(`${outputDirectory}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));
