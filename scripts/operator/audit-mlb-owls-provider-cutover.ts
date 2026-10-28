import { loadEnvConfig } from "@next/env";
import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { buildMlbCoherentMarketPriceMap } from "../../lib/automodel/mlbCoherentMarketPriceMap";
import { runMlbAutoModelV1 } from "../../lib/automodel/mlbAutoModelV1";
import { runMlbAutoModelV2_2 } from "../../lib/automodel/mlbAutoModelV2_2";
import type { GameSnapshot, MarketSnapshot, SharpSnapshot } from "../../lib/automodel/types";
import { BOOK_PRIORITY } from "../../lib/config/bookPriority";
import { OwlsOddsProvider } from "../../lib/providers/real_api/OwlsOddsProvider";
import { OwlsSignalProvider } from "../../lib/providers/real_api/OwlsSignalProvider";
import type { LineRecord } from "../../lib/providers/interfaces/IOddsProvider";
import { normalizeMlbTeamName } from "../../lib/providers/real_api/_teamNameNormalizer";

loadEnvConfig(process.cwd());

const requestedDate = process.argv.find((value) => value.startsWith("--date="))?.slice(7);
if (!requestedDate) throw new Error("Usage: --date=YYYY-MM-DD");
const date: string = requestedDate;
const configuredApiKey = process.env.OWLS_INSIGHT_API_KEY;
if (!configuredApiKey) throw new Error("OWLS_INSIGHT_API_KEY missing");
const apiKey: string = configuredApiKey;

function price(rows: readonly LineRecord[], market: "moneyline" | "total", side: string, line: number | null): number | null {
  for (const book of BOOK_PRIORITY) {
    const row = rows.find((candidate) =>
      candidate.market_type === market
      && candidate.side === side
      && candidate.sportsbook === book
      && (line === null || candidate.line_value === line)
      && candidate.odds_american !== null,
    );
    if (row?.odds_american !== null && row?.odds_american !== undefined) return row.odds_american;
  }
  return null;
}

function candidateMarket(rows: readonly LineRecord[], asOf: string): MarketSnapshot {
  const totalPairs = new Map<number, Set<string>>();
  for (const row of rows.filter((candidate) => candidate.market_type === "total" && candidate.line_value !== null)) {
    const same = rows.filter((candidate) =>
      candidate.market_type === "total"
      && candidate.sportsbook === row.sportsbook
      && candidate.line_value === row.line_value,
    );
    if (!same.some((candidate) => candidate.side === "over") || !same.some((candidate) => candidate.side === "under")) continue;
    const books = totalPairs.get(row.line_value!) ?? new Set<string>();
    books.add(row.sportsbook);
    totalPairs.set(row.line_value!, books);
  }
  const selected = [...totalPairs.entries()].sort((left, right) =>
    right[1].size - left[1].size
    || Math.min(...[...left[1]].map((book) => BOOK_PRIORITY.indexOf(book as typeof BOOK_PRIORITY[number])))
      - Math.min(...[...right[1]].map((book) => BOOK_PRIORITY.indexOf(book as typeof BOOK_PRIORITY[number]))),
  )[0] ?? null;
  const listedTotal = selected?.[0] ?? null;
  const selectedBooks = selected?.[1] ?? new Set<string>();
  const selectedBook = [...selectedBooks].sort((left, right) =>
    BOOK_PRIORITY.indexOf(left as typeof BOOK_PRIORITY[number])
    - BOOK_PRIORITY.indexOf(right as typeof BOOK_PRIORITY[number]),
  )[0] ?? null;
  return {
    listed_total: listedTotal,
    home_ml_odds_american: price(rows, "moneyline", "home", null),
    away_ml_odds_american: price(rows, "moneyline", "away", null),
    over_odds_american: price(rows, "total", "over", listedTotal),
    under_odds_american: price(rows, "total", "under", listedTotal),
    has_pinnacle_total: selectedBooks.has("pinnacle"),
    total_line_source: listedTotal === null ? "unavailable" : "real_book",
    total_line_book: selectedBook,
    total_line_agreement_count: selectedBooks.size,
    total_line_consensus_at_same_line: false,
    coherent_price_map: buildMlbCoherentMarketPriceMap({ rows, listedTotal, asOf }),
  };
}

function summarize(snapshot: GameSnapshot) {
  const v1 = runMlbAutoModelV1(snapshot, "morning_draft");
  const output = runMlbAutoModelV2_2(snapshot, v1, "morning_draft");
  return {
    mlSide: output.predicted_ml_winner,
    mlProbability: output.v22Audit.ml_model_prob,
    mlGrade: output.v22Audit.ml_play_grade,
    totalSide: output.predicted_ou_side,
    totalProbability: output.v22Audit.ou_model_prob,
    totalGrade: output.v22Audit.ou_play_grade,
    projectedTotal: output.predicted_total,
  };
}

async function main(): Promise<void> {
  const snapshots = await buildFeatureSnapshots("mlb", date);
  const byPair = new Map(snapshots.map((snapshot) => [
    `${snapshot.away_team.abbreviation}|${snapshot.home_team.abbreviation}`,
    snapshot.game_external_id,
  ]));
  const resolve = async (_sport: unknown, _date: string, home: string, away: string): Promise<number | null> =>
    byPair.get(`${away}|${home}`) ?? null;
  const odds = await new OwlsOddsProvider(apiKey, resolve).getGameLinesV2(date, "mlb", {
    externalIdsFilter: snapshots.map((snapshot) => snapshot.game_external_id),
    slateGames: snapshots.flatMap((snapshot) => {
      const home = normalizeMlbTeamName(snapshot.home_team.abbreviation);
      const away = normalizeMlbTeamName(snapshot.away_team.abbreviation);
      return home && away ? [{
        externalId: snapshot.game_external_id,
        home,
        away,
        gameDate: snapshot.game_date,
      }] : [];
    }),
  });
  const signals = await new OwlsSignalProvider(apiKey, resolve).getSharpSignals(date);
  const rows = snapshots.map((snapshot) => {
    const gameLines = odds.records.filter((row) => row.game_external_id === snapshot.game_external_id);
    const gameSignals = signals.filter((row) => row.game_external_id === snapshot.game_external_id);
    const mlHome = gameSignals.find((row) => row.market_type === "moneyline" && row.side === "home");
    const totalOver = gameSignals.find((row) => row.market_type === "total" && row.side === "over");
    const candidateSharp: SharpSnapshot | null = gameSignals.length === 0 ? null : {
      pinnacle_ml_fair_prob_home: null,
      pinnacle_ml_fair_prob_away: null,
      pinnacle_total_ev_pct: null,
      pinnacle_ml_ev_pct: null,
      public_betting_pct_home: mlHome?.public_betting_pct ?? null,
      public_money_pct_home: mlHome?.public_money_pct ?? null,
      public_betting_pct_over: totalOver?.public_betting_pct ?? null,
      public_money_pct_over: totalOver?.public_money_pct ?? null,
      ml_plus_ev_side: null,
      total_plus_ev_side: null,
    };
    const observedAt = gameLines.map((row) => row.fetched_at).sort().at(-1) ?? new Date().toISOString();
    const candidateSnapshot: GameSnapshot = {
      ...snapshot,
      market: candidateMarket(gameLines, observedAt),
      sharp: candidateSharp,
    };
    const incumbent = summarize(snapshot);
    const candidate = summarize(candidateSnapshot);
    return {
      externalId: snapshot.game_external_id,
      matchup: `${snapshot.away_team.abbreviation}@${snapshot.home_team.abbreviation}`,
      owlsLineRows: gameLines.length,
      owlsSignalRows: gameSignals.length,
      incumbent,
      candidate,
      mlSideChanged: incumbent.mlSide !== candidate.mlSide,
      totalSideChanged: incumbent.totalSide !== candidate.totalSide,
      mlGradeChanged: incumbent.mlGrade !== candidate.mlGrade,
      totalGradeChanged: incumbent.totalGrade !== candidate.totalGrade,
    };
  });
  console.log(JSON.stringify({
    readOnly: true,
    date,
    games: rows.length,
    impact: {
      mlSideChanges: rows.filter((row) => row.mlSideChanged).length,
      totalSideChanges: rows.filter((row) => row.totalSideChanged).length,
      mlGradeChanges: rows.filter((row) => row.mlGradeChanged).length,
      totalGradeChanges: rows.filter((row) => row.totalGradeChanged).length,
    },
    rows,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
