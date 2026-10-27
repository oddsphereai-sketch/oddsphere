import { readFile } from "node:fs/promises";

type Side = "over" | "under";

type Forecast = {
  gameId: string;
  playerName: string;
  market: string;
  line: number;
  prediction: Side | "yes" | "no";
  result: "win" | "loss" | "push";
  actual: number;
  projection: number | null;
  independentProjection: number | null;
  rawProbability: number;
  marketProbability: number;
  finalProbability: number;
  canonicalMainLine: boolean;
  decisionRelease: string;
};

type TrackingReport = { forecasts: Forecast[] };
type HistoryRow = {
  gameId: string;
  playerName: string;
  market: string;
  sportsbook: string;
  side: Side | "yes";
  marketMovement: "support" | "adverse" | "neutral";
};
type PrivateHistory = { history: { rows: HistoryRow[] } };

type Candidate = {
  probability: number;
  projection: number | null;
};

const reportPath = stringArg("--report") ?? "/private/tmp/nfl-props-week8.json";
const decisionRelease = stringArg("--decision-release")
  ?? "nfl_player_props_decision_2026_10_15_r32_independent_rushing_yards";
const weeks = [6, 7];

async function main(): Promise<void> {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as TrackingReport;
  const weekByGame = new Map<string, number>();
  const evidence = new Map<string, HistoryRow[]>();
  for (const week of weeks) {
    const history = JSON.parse(await readFile(`/private/tmp/nfl-props-week${week}-private-history.json`, "utf8")) as PrivateHistory;
    for (const row of history.history.rows) {
      weekByGame.set(String(row.gameId), week);
      const key = crossLineKey(row);
      evidence.set(key, [...(evidence.get(key) ?? []), row]);
    }
  }

  const rows = report.forecasts.filter((row): row is Forecast & { prediction: Side } => (
    row.decisionRelease === decisionRelease
    && row.canonicalMainLine
    && (row.prediction === "over" || row.prediction === "under")
    && row.result !== "push"
    && weeks.includes(weekByGame.get(String(row.gameId)) ?? -1)
  ));

  const candidates: Record<string, (row: Forecast & { prediction: Side }) => Candidate> = {
    incumbent: (row) => fromStored(row, "final"),
    independent: (row) => fromStored(row, "raw"),
    market: (row) => fromStored(row, "market"),
    independent_direction_incumbent_calibration: (row) => {
      const raw = overProbability(row, "rawProbability");
      const final = overProbability(row, "finalProbability");
      return sameDirection(raw, final) ? fromStored(row, "final") : fromStored(row, "raw");
    },
    independent_direction_mirrored_incumbent_confidence: (row) => {
      const raw = overProbability(row, "rawProbability");
      const final = overProbability(row, "finalProbability");
      return sameDirection(raw, final)
        ? fromStored(row, "final")
        : { probability: 1 - final, projection: null };
    },
    market_direction_incumbent_calibration: (row) => {
      const market = overProbability(row, "marketProbability");
      const final = overProbability(row, "finalProbability");
      return sameDirection(market, final) ? fromStored(row, "final") : fromStored(row, "market");
    },
    market_when_two_books_confirm: (row) => qualifiedMarket(row, evidence, { minimumBooks: 2, minimumSupportingBooks: 0, vetoAdverse: false }),
    market_when_two_books_and_one_move_confirm: (row) => qualifiedMarket(row, evidence, { minimumBooks: 2, minimumSupportingBooks: 1, vetoAdverse: false }),
    market_when_two_books_and_clean_move_confirm: (row) => qualifiedMarket(row, evidence, { minimumBooks: 2, minimumSupportingBooks: 1, vetoAdverse: true }),
    market_when_three_books_confirm: (row) => qualifiedMarket(row, evidence, { minimumBooks: 3, minimumSupportingBooks: 0, vetoAdverse: false }),
  };

  const markets = ["receptions", "rushing_yards", "passing_attempts", "passing_completions", "passing_yards"];
  const output = Object.fromEntries(markets.map((market) => {
    const marketRows = rows.filter((row) => row.market === market);
    return [market, {
      records: marketRows.length,
      weeks: Object.fromEntries(weeks.map((week) => [week, summarize(
        marketRows.filter((row) => weekByGame.get(String(row.gameId)) === week),
        candidates,
      )])),
      combined: summarize(marketRows, candidates),
    }];
  }));

  const disagreements = rows.filter((row) => ["receptions", "rushing_yards"].includes(row.market)
    && !sameDirection(overProbability(row, "rawProbability"), overProbability(row, "marketProbability")))
    .map((row) => {
      const independentOver = overProbability(row, "rawProbability");
      const marketOver = overProbability(row, "marketProbability");
      const incumbentOver = overProbability(row, "finalProbability");
      const marketSide: Side = marketOver >= 0.5 ? "over" : "under";
      const scopeEvidence = evidence.get(crossLineKey(row)) ?? [];
      const movementsForMarketSide = scopeEvidence.filter((value) => value.side === marketSide);
      return {
        week: weekByGame.get(String(row.gameId)),
        gameId: row.gameId,
        playerName: row.playerName,
        market: row.market,
        line: row.line,
        actual: row.actual,
        winningSide: row.actual > row.line ? "over" : "under",
        independentSide: independentOver >= 0.5 ? "over" : "under",
        marketSide,
        incumbentSide: incumbentOver >= 0.5 ? "over" : "under",
        independentOver,
        marketOver,
        incumbentOver,
        books: [...new Set(scopeEvidence.map((value) => normalize(value.sportsbook)))].sort(),
        supportingBooks: [...new Set(movementsForMarketSide.filter((value) => value.marketMovement === "support")
          .map((value) => normalize(value.sportsbook)))].sort(),
        adverseBooks: [...new Set(movementsForMarketSide.filter((value) => value.marketMovement === "adverse")
          .map((value) => normalize(value.sportsbook)))].sort(),
      };
    });

  console.log(JSON.stringify({ readOnly: true, reportPath, decisionRelease, markets: output, disagreements }, null, 2));
}

function qualifiedMarket(
  row: Forecast & { prediction: Side },
  evidence: Map<string, HistoryRow[]>,
  rule: { minimumBooks: number; minimumSupportingBooks: number; vetoAdverse: boolean },
): Candidate {
  const independent = overProbability(row, "rawProbability");
  const market = overProbability(row, "marketProbability");
  if (sameDirection(independent, market)) return fromStored(row, "final");
  const marketSide: Side = market >= 0.5 ? "over" : "under";
  const rows = evidence.get(crossLineKey(row)) ?? [];
  const books = new Set(rows.map((value) => normalize(value.sportsbook)));
  const supportingBooks = new Set(rows.filter((value) => value.side === marketSide && value.marketMovement === "support")
    .map((value) => normalize(value.sportsbook)));
  const adverseBooks = new Set(rows.filter((value) => value.side === marketSide && value.marketMovement === "adverse")
    .map((value) => normalize(value.sportsbook)));
  const qualifies = books.size >= rule.minimumBooks
    && supportingBooks.size >= rule.minimumSupportingBooks
    && (!rule.vetoAdverse || adverseBooks.size === 0);
  return qualifies ? fromStored(row, "market") : fromStored(row, "raw");
}

function summarize(
  rows: Array<Forecast & { prediction: Side }>,
  candidates: Record<string, (row: Forecast & { prediction: Side }) => Candidate>,
) {
  return Object.fromEntries(Object.entries(candidates).map(([name, candidate]) => [name, score(rows, candidate)]));
}

function score(rows: Array<Forecast & { prediction: Side }>, candidate: (row: Forecast & { prediction: Side }) => Candidate) {
  let wins = 0;
  let losses = 0;
  let over = 0;
  let under = 0;
  let brier = 0;
  let projectionAbsoluteError = 0;
  let projectionBias = 0;
  let projectionRows = 0;
  let sideChanges = 0;
  let corrections = 0;
  let harms = 0;
  for (const row of rows) {
    const evaluated = candidate(row);
    const incumbentOver = overProbability(row, "finalProbability");
    const side: Side = evaluated.probability >= 0.5 ? "over" : "under";
    const incumbentSide: Side = incumbentOver >= 0.5 ? "over" : "under";
    const actualSide: Side = row.actual > row.line ? "over" : "under";
    const won = side === actualSide;
    if (won) wins += 1;
    else losses += 1;
    if (side === "over") over += 1;
    else under += 1;
    brier += (evaluated.probability - Number(actualSide === "over")) ** 2;
    if (side !== incumbentSide) {
      sideChanges += 1;
      if (won) corrections += 1;
      else harms += 1;
    }
    if (evaluated.projection !== null) {
      projectionRows += 1;
      projectionAbsoluteError += Math.abs(evaluated.projection - row.actual);
      projectionBias += evaluated.projection - row.actual;
    }
  }
  return {
    wins,
    losses,
    hitRate: ratio(wins, rows.length),
    over,
    under,
    brier: ratio(brier, rows.length),
    projectionMae: ratio(projectionAbsoluteError, projectionRows),
    projectionBias: ratio(projectionBias, projectionRows),
    sideChanges,
    corrections,
    harms,
  };
}

function fromStored(row: Forecast & { prediction: Side }, source: "raw" | "market" | "final"): Candidate {
  if (source === "raw") return {
    probability: overProbability(row, "rawProbability"),
    projection: row.independentProjection,
  };
  if (source === "market") return {
    probability: overProbability(row, "marketProbability"),
    projection: null,
  };
  return {
    probability: overProbability(row, "finalProbability"),
    projection: row.projection,
  };
}

function overProbability(row: Forecast & { prediction: Side }, key: "rawProbability" | "marketProbability" | "finalProbability"): number {
  return row.prediction === "over" ? row[key] : 1 - row[key];
}

function sameDirection(left: number, right: number): boolean {
  return (left >= 0.5) === (right >= 0.5);
}

function crossLineKey(row: Pick<Forecast, "gameId" | "playerName" | "market">): string {
  return [row.gameId, normalize(row.playerName), row.market].join("|");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator ? Math.round((numerator / denominator) * 100_000) / 100_000 : null;
}

function stringArg(name: string): string | null {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
