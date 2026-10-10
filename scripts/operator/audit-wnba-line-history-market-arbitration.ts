/**
 * SELECT-only WNBA replay that reconstructs same-book spread movement from the
 * append-only line_history table before each immutable decision. It evaluates
 * independent-first, real decision-boundary arbitration without provider calls
 * or writes.
 */
import { supabase } from "../../lib/db/supabase";
import { EXPECTED_WNBA_MODEL_VERSION } from "../../lib/automodel/wnbaChampionRuntime";
import {
  readWnbaForwardEvidenceCapture,
  WNBA_FORWARD_EVIDENCE_CAPTURE_KEY,
  type WnbaForwardEvidenceCapture,
} from "../../lib/services/wnba/wnbaForwardEvidenceCapture";

type Row = Record<string, unknown>;
type Side = "home" | "away";
type Candidate =
  | "incumbent"
  | "independent"
  | "cross_qualified_decision"
  | "cross_originator"
  | "cross_two_books"
  | "cross_originator_or_two"
  | "cross_originator_or_two_no_resistance"
  | "cross_originator_or_two_split_confirmed";

type HistoryRow = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  recorded_at: string;
};

type Movement = {
  sportsbook: string;
  sourceClass: "originator" | "retail";
  direction: Side;
  openingAt: string;
  currentAt: string;
  homeLineDelta: number;
  homeProbabilityDelta: number;
};

type Game = {
  gameId: number;
  externalId: string;
  slateDate: string;
  decisionAt: string;
  release: string;
  actualHome: number;
  actualAway: number;
  projectedTotal: number;
  independentMargin: number;
  incumbentMargin: number;
  independentHomeProbability: number;
  incumbentHomeProbability: number;
  dynamicMarketWeight: number;
  marketAudit: Record<string, unknown>;
  homeLine: number | null;
  evaluatedBook: string | null;
  targetExcludedBooks: number;
  splitSide: Side | null;
  movements: Movement[];
};

const ORIGINATORS = new Set(["circa", "pinnacle", "bookmaker"]);

function object(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function canonicalBook(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function grade(row: Row): Row | null {
  return Array.isArray(row.prediction_grades) ? object(row.prediction_grades[0]) : object(row.prediction_grades);
}

function implied(american: number): number {
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}

function majority(values: readonly Side[]): Side | null {
  const home = values.filter((value) => value === "home").length;
  const away = values.length - home;
  return home === away ? null : home > away ? "home" : "away";
}

function splitSide(capture: WnbaForwardEvidenceCapture): Side | null {
  const directions = capture.markets.spread.source_aware_public_pairs.flatMap((pair): Side[] => {
    const qualified = pair.sides.flatMap((side): Side[] => {
      if ((side.side !== "home" && side.side !== "away") || side.money_pct === null || side.bets_pct === null) return [];
      return side.money_pct - side.bets_pct >= 0.1 ? [side.side] : [];
    });
    return qualified.length === 1 ? qualified : [];
  });
  return majority(directions);
}

function completePairs(rows: readonly HistoryRow[], decisionAt: string): Array<{
  at: string;
  homeLine: number;
  homeProbability: number;
}> {
  const decisionMs = Date.parse(decisionAt);
  const byCapture = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const at = Date.parse(row.recorded_at);
    if (!Number.isFinite(at) || at > decisionMs || row.market_type !== "spread") continue;
    byCapture.set(row.recorded_at, [...(byCapture.get(row.recorded_at) ?? []), row]);
  }
  return [...byCapture.entries()].flatMap(([at, capture]) => {
    const home = capture.find((row) => row.side === "home");
    const away = capture.find((row) => row.side === "away");
    const homeLine = finite(home?.line_value);
    const homePrice = finite(home?.odds_american);
    const awayPrice = finite(away?.odds_american);
    if (homeLine === null || homePrice === null || awayPrice === null) return [];
    const homeRaw = implied(homePrice);
    const awayRaw = implied(awayPrice);
    return [{ at, homeLine, homeProbability: homeRaw / (homeRaw + awayRaw) }];
  }).sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

function movementsForGame(rows: readonly HistoryRow[], decisionAt: string, evaluatedBook: string | null): Movement[] {
  const byBook = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const book = canonicalBook(row.sportsbook);
    if (!book || book === evaluatedBook) continue;
    byBook.set(book, [...(byBook.get(book) ?? []), row]);
  }
  return [...byBook.entries()].flatMap(([sportsbook, bookRows]): Movement[] => {
    const pairs = completePairs(bookRows, decisionAt);
    if (pairs.length < 2) return [];
    const opening = pairs[0]!;
    const current = pairs.at(-1)!;
    const homeLineDelta = current.homeLine - opening.homeLine;
    const homeProbabilityDelta = current.homeProbability - opening.homeProbability;
    const lineDirection = Math.abs(homeLineDelta) >= 0.5 ? (homeLineDelta < 0 ? "home" : "away") : null;
    const priceDirection = Math.abs(homeProbabilityDelta) >= 0.01 ? (homeProbabilityDelta > 0 ? "home" : "away") : null;
    if (lineDirection !== null && priceDirection !== null && lineDirection !== priceDirection) return [];
    const direction = lineDirection ?? priceDirection;
    if (direction === null) return [];
    return [{
      sportsbook,
      sourceClass: ORIGINATORS.has(sportsbook) ? "originator" : "retail",
      direction,
      openingAt: opening.at,
      currentAt: current.at,
      homeLineDelta,
      homeProbabilityDelta,
    }];
  });
}

function decisionSide(margin: number, homeLine: number | null): Side | null {
  if (homeLine === null) return null;
  return margin + homeLine >= 0 ? "home" : "away";
}

function qualifies(game: Game, candidate: Candidate): boolean {
  if (candidate === "incumbent") return true;
  if (candidate === "independent" || game.homeLine === null || game.targetExcludedBooks < 2) return false;
  const independentSpread = decisionSide(game.independentMargin, game.homeLine);
  const incumbentSpread = decisionSide(game.incumbentMargin, game.homeLine);
  const crossesSpread = independentSpread !== null && incumbentSpread !== independentSpread;
  const crossesWinner = (game.incumbentMargin >= 0) !== (game.independentMargin >= 0);
  if (!crossesSpread && !crossesWinner) return false;
  if (candidate === "cross_qualified_decision") return true;
  const marketSide = crossesWinner ? (game.incumbentMargin >= 0 ? "home" : "away") : incumbentSpread;
  if (marketSide === null) return false;
  const support = game.movements.filter((move) => move.direction === marketSide);
  const resistance = game.movements.filter((move) => move.direction !== marketSide);
  const originator = support.some((move) => move.sourceClass === "originator");
  const twoBooks = new Set(support.map((move) => move.sportsbook)).size >= 2;
  if (candidate === "cross_originator") return originator;
  if (candidate === "cross_two_books") return twoBooks;
  if (candidate === "cross_originator_or_two") return originator || twoBooks;
  if (candidate === "cross_originator_or_two_no_resistance") return (originator || twoBooks) && resistance.length === 0;
  return (originator || twoBooks) && resistance.length === 0 && game.splitSide === marketSide;
}

function candidateMargin(game: Game, candidate: Candidate): number {
  return qualifies(game, candidate) ? game.incumbentMargin : game.independentMargin;
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10_000) / 10_000;
}

function summarize(games: readonly Game[], candidate: Candidate) {
  const rows = games.map((game) => {
    const margin = candidateMargin(game, candidate);
    const actualMargin = game.actualHome - game.actualAway;
    const actualTotal = game.actualHome + game.actualAway;
    const home = (game.projectedTotal + margin) / 2;
    const away = (game.projectedTotal - margin) / 2;
    const spread = game.homeLine === null || actualMargin + game.homeLine === 0
      ? null
      : (margin + game.homeLine > 0) === (actualMargin + game.homeLine > 0);
    return {
      marginAbs: Math.abs(margin - actualMargin),
      teamAbs: (Math.abs(home - game.actualHome) + Math.abs(away - game.actualAway)) / 2,
      totalAbs: Math.abs(game.projectedTotal - actualTotal),
      winner: (margin > 0) === (actualMargin > 0),
      spread,
      changed: Math.abs(margin - game.independentMargin) > 1e-9,
    };
  });
  const spreads = rows.flatMap((row) => row.spread === null ? [] : [row.spread]);
  return {
    games: rows.length,
    margin_mae: round(mean(rows.map((row) => row.marginAbs))),
    team_score_mae: round(mean(rows.map((row) => row.teamAbs))),
    total_mae: round(mean(rows.map((row) => row.totalAbs))),
    winner_accuracy: `${rows.filter((row) => row.winner).length}/${rows.length}`,
    spread_accuracy: `${spreads.filter(Boolean).length}/${spreads.length}`,
    market_arbitrations: rows.filter((row) => row.changed).length,
  };
}

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select("game_id,slate_date,model_version,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
    .eq("sport", "wnba")
    .eq("market", "spread")
    .not(`snapshot_json->${WNBA_FORWARD_EVIDENCE_CAPTURE_KEY}`, "is", null)
    .order("slate_date", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);

  const opened = ((data ?? []) as Row[]).flatMap((row): Omit<Game, "movements">[] => {
    const snapshot = object(row.snapshot_json);
    const capture = readWnbaForwardEvidenceCapture(snapshot?.[WNBA_FORWARD_EVIDENCE_CAPTURE_KEY]);
    const result = grade(row);
    const gameId = finite(row.game_id);
    const actualHome = finite(result?.actual_home_score);
    const actualAway = finite(result?.actual_away_score);
    const projectedTotal = finite(capture?.independent_model.projected_total);
    const independentMargin = finite(capture?.independent_model.projected_home_margin);
    const incumbentHome = finite(capture?.champion_output.projected_score.home);
    const incumbentAway = finite(capture?.champion_output.projected_score.away);
    const incumbentHomeProbability = finite(capture?.champion_output.model.final_home_win_prob);
    const independentHomeProbability = finite(capture?.independent_model.home_win_probability);
    if (!capture || gameId === null || actualHome === null || actualAway === null || result?.result === "pending" || projectedTotal === null || independentMargin === null || incumbentHome === null || incumbentAway === null || incumbentHomeProbability === null || independentHomeProbability === null) return [];
    const targetLine = finite(capture.markets.spread.champion_target.line);
    const targetSide = capture.markets.spread.champion_target.side;
    const homeLine = targetLine === null ? null : targetSide === "away" ? -targetLine : targetLine;
    return [{
      gameId,
      externalId: String(capture.game.external_id),
      slateDate: String(row.slate_date),
      decisionAt: capture.decision_at,
      release: capture.releases.model_version,
      actualHome,
      actualAway,
      projectedTotal,
      independentMargin,
      incumbentMargin: incumbentHome - incumbentAway,
      independentHomeProbability,
      incumbentHomeProbability,
      dynamicMarketWeight: capture.champion_output.dynamic_market_weight,
      marketAudit: capture.champion_output.market,
      homeLine,
      evaluatedBook: canonicalBook(capture.markets.spread.evaluation.evaluated_sportsbook) || null,
      targetExcludedBooks: capture.markets.spread.evaluation.target_excluded_complete_pair_count,
      splitSide: splitSide(capture),
    }];
  });

  const gameIds = [...new Set(opened.map((game) => game.gameId))];
  const historyRows: HistoryRow[] = [];
  for (let from = 0; gameIds.length && from < 20_000; from += 1000) {
    const query = await supabase.from("line_history")
      .select("game_id,market_type,sportsbook,side,line_value,odds_american,recorded_at")
      .in("game_id", gameIds)
      .eq("market_type", "spread")
      .order("recorded_at", { ascending: true })
      .range(from, from + 999);
    if (query.error) throw new Error(query.error.message);
    historyRows.push(...((query.data ?? []) as HistoryRow[]));
    if ((query.data ?? []).length < 1000) break;
  }
  const byGame = new Map<number, HistoryRow[]>();
  for (const row of historyRows) byGame.set(row.game_id, [...(byGame.get(row.game_id) ?? []), row]);
  const games: Game[] = opened.map((game) => ({
    ...game,
    movements: movementsForGame(byGame.get(game.gameId) ?? [], game.decisionAt, game.evaluatedBook),
  }));

  const finalSize = Math.min(14, games.length);
  const cohorts = {
    earlier_block: games.slice(0, games.length - finalSize),
    final_chronological_block: games.slice(games.length - finalSize),
    all_opened_forward: games,
    active_release_only: games.filter((game) => game.release === EXPECTED_WNBA_MODEL_VERSION),
  };
  const candidates: Candidate[] = [
    "incumbent",
    "independent",
    "cross_qualified_decision",
    "cross_originator",
    "cross_two_books",
    "cross_originator_or_two",
    "cross_originator_or_two_no_resistance",
    "cross_originator_or_two_split_confirmed",
  ];
  const crossingGames = games.filter((game) => {
    if (game.homeLine === null) return false;
    return decisionSide(game.independentMargin, game.homeLine) !== decisionSide(game.incumbentMargin, game.homeLine)
      || (game.independentMargin >= 0) !== (game.incumbentMargin >= 0);
  });

  console.log(JSON.stringify({
    mode: "select_only",
    writes: 0,
    provider_calls: 0,
    evidence: {
      games: games.length,
      line_history_rows: historyRows.length,
      games_with_qualified_movement: games.filter((game) => game.movements.length > 0).length,
      games_with_originator_movement: games.filter((game) => game.movements.some((move) => move.sourceClass === "originator")).length,
      decision_boundary_crossings: crossingGames.length,
    },
    crossing_games: crossingGames.map((game) => ({
      slate_date: game.slateDate,
      external_id: game.externalId,
      independent_margin: round(game.independentMargin),
      incumbent_margin: round(game.incumbentMargin),
      independent_home_probability: round(game.independentHomeProbability),
      incumbent_home_probability: round(game.incumbentHomeProbability),
      dynamic_market_weight: round(game.dynamicMarketWeight),
      market_audit: game.marketAudit,
      home_line: game.homeLine,
      split_side: game.splitSide,
      movements: game.movements,
      actual_margin: game.actualHome - game.actualAway,
    })),
    cohorts: Object.fromEntries(Object.entries(cohorts).map(([name, rows]) => [
      name,
      Object.fromEntries(candidates.map((candidate) => [candidate, summarize(rows, candidate)])),
    ])),
  }, null, 2));
}

void main();
