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

import { readFileSync } from "node:fs";

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

type TransitionMetric = {
  winnerSideChanges: number;
  winnerCorrections: number;
  winnerHarms: number;
  spreadSideChanges: number;
  spreadCorrections: number;
  spreadHarms: number;
  totalSideChanges: number;
  totalCorrections: number;
  totalHarms: number;
};

type Report = {
  independent: Metric;
  marketGrounded65: Metric;
  marketGrounded65Transitions: TransitionMetric;
  marketBenchmark: Metric;
  crossing: Record<string, Metric>;
  crossingTransitions: Record<string, TransitionMetric>;
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

function blankTransitionMetric(): TransitionMetric {
  return {
    winnerSideChanges: 0,
    winnerCorrections: 0,
    winnerHarms: 0,
    spreadSideChanges: 0,
    spreadCorrections: 0,
    spreadHarms: 0,
    totalSideChanges: 0,
    totalCorrections: 0,
    totalHarms: 0,
  };
}

function addTransition(
  metric: TransitionMetric,
  game: Game,
  independentHome: number,
  independentAway: number,
  candidateHome: number,
  candidateAway: number,
): void {
  const actualMargin = game.actualHome - game.actualAway;
  const actualTotal = game.actualHome + game.actualAway;
  const independentMargin = independentHome - independentAway;
  const candidateMargin = candidateHome - candidateAway;
  const independentTotal = independentHome + independentAway;
  const candidateTotal = candidateHome + candidateAway;
  const observe = (
    independentSignal: number,
    candidateSignal: number,
    actualSignal: number,
    keys: readonly [keyof TransitionMetric, keyof TransitionMetric, keyof TransitionMetric],
  ) => {
    const independentSide = Math.sign(independentSignal);
    const candidateSide = Math.sign(candidateSignal);
    const actualSide = Math.sign(actualSignal);
    if (independentSide === 0 || candidateSide === 0 || actualSide === 0 || independentSide === candidateSide) return;
    metric[keys[0]] += 1;
    if (independentSide !== actualSide && candidateSide === actualSide) metric[keys[1]] += 1;
    if (independentSide === actualSide && candidateSide !== actualSide) metric[keys[2]] += 1;
  };
  observe(independentMargin, candidateMargin, actualMargin, [
    "winnerSideChanges", "winnerCorrections", "winnerHarms",
  ]);
  observe(
    independentMargin - game.marketHomeMargin,
    candidateMargin - game.marketHomeMargin,
    actualMargin - game.marketHomeMargin,
    ["spreadSideChanges", "spreadCorrections", "spreadHarms"],
  );
  observe(
    independentTotal - game.marketTotal,
    candidateTotal - game.marketTotal,
    actualTotal - game.marketTotal,
    ["totalSideChanges", "totalCorrections", "totalHarms"],
  );
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

function replay(games: readonly Game[], parameters: Parameters): Map<number, Report> {
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

    const report = reports.get(game.season) ?? {
      independent: blankMetric(),
      marketGrounded65: blankMetric(),
      marketGrounded65Transitions: blankTransitionMetric(),
      marketBenchmark: blankMetric(),
      crossing: Object.fromEntries(CROSSING_THRESHOLDS.map((threshold) => [String(threshold), blankMetric()])),
      crossingTransitions: Object.fromEntries(
        CROSSING_THRESHOLDS.map((threshold) => [String(threshold), blankTransitionMetric()]),
      ),
    };
    reports.set(game.season, report);
    addMetric(report.independent, game, projectedHome, projectedAway);

    const independentMargin = projectedHome - projectedAway;
    const independentTotal = projectedHome + projectedAway;
    const groundedMargin = 0.65 * independentMargin + 0.35 * game.marketHomeMargin;
    const groundedTotal = 0.65 * independentTotal + 0.35 * game.marketTotal;
    const groundedHome = (groundedTotal + groundedMargin) / 2;
    const groundedAway = (groundedTotal - groundedMargin) / 2;
    addMetric(
      report.marketGrounded65,
      game,
      groundedHome,
      groundedAway,
    );
    addTransition(
      report.marketGrounded65Transitions,
      game,
      projectedHome,
      projectedAway,
      groundedHome,
      groundedAway,
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
      const crossingHome = (independentTotal + finalMargin) / 2;
      const crossingAway = (independentTotal - finalMargin) / 2;
      addMetric(
        report.crossing[String(threshold)]!,
        game,
        crossingHome,
        crossingAway,
      );
      addTransition(
        report.crossingTransitions[String(threshold)]!,
        game,
        projectedHome,
        projectedAway,
        crossingHome,
        crossingAway,
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
const selectionReport = selected.reports.get(2024);
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
  [...selected.reports].map(([season, report]) => [
    String(season),
    {
      independent: finalize(report.independent),
      selectedDecisionCrossing: finalize(report.crossing[String(selectedCrossingThreshold)]!),
      selectedDecisionCrossingTransitions: report.crossingTransitions[String(selectedCrossingThreshold)]!,
      incumbentMarketGrounded65: finalize(report.marketGrounded65),
      incumbentMarketGrounded65Transitions: report.marketGrounded65Transitions,
      closingMarketBenchmark: finalize(report.marketBenchmark),
    },
  ]),
);
console.log(JSON.stringify({
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
}, null, 2));
