/**
 * SELECT-only NHL professional market-reader audit.
 *
 * This script never calls a provider and never writes to the database. It
 * reconstructs the official transition-release locks, their independent and
 * final score distributions, and every append-only line observation captured
 * no later than the immutable lock.
 */

import { supabase } from "../../lib/db/supabase";
import { NHL_REGULAR_TRANSITION_MODEL_RELEASES } from "../../lib/automodel/nhlRegularModelV1";

type Market = "moneyline" | "spread" | "total";
type Side = -1 | 1;
type Result = "win" | "loss" | "push";

type Grade = {
  result: string | null;
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_total: number | null;
};

type StoredSnapshot = {
  model_output?: {
    independent_goal_diff?: number;
    independent_total_goals?: number;
    expected_goal_diff?: number;
    expected_total_goals?: number;
    projected_home_goals?: number;
    projected_away_goals?: number;
    layers?: { market_decision?: string };
  };
  feature_inputs?: {
    home?: { abbreviation?: string };
    away?: { abbreviation?: string };
    market?: {
      market_home_prob?: number | null;
      market_open_home_prob?: number | null;
      market_total_line?: number | null;
      market_open_total_line?: number | null;
      market_home_puck_line?: number | null;
      market_away_puck_line?: number | null;
      same_book_home_prob_move?: number | null;
      same_book_total_move?: number | null;
      ml_home_bets_pct?: number | null;
      ml_home_money_pct?: number | null;
      total_over_bets_pct?: number | null;
      total_over_money_pct?: number | null;
      ml_split_source?: string | null;
      total_split_source?: string | null;
      ml_split_confidence?: string | null;
      total_split_confidence?: string | null;
    };
  };
  market_at_lock?: {
    lines_snapshot?: Array<{
      market_type?: string;
      sportsbook?: string;
      side?: string;
      line_value?: number | null;
      odds_american?: number | null;
    }>;
  };
  evaluated_quotes?: Partial<Record<Market, { sportsbook?: string | null }>>;
};

type RecordRow = {
  id: number;
  game_id: number;
  slate_date: string;
  game_date: string;
  matchup: string;
  market: Market;
  pick: string;
  side: "home" | "away" | "over" | "under";
  line_value: number | null;
  odds_american: number | null;
  model_probability: number | null;
  play_grade: string | null;
  no_bet: boolean | null;
  locked_at: string | null;
  model_version: string;
  snapshot_json: StoredSnapshot | null;
  prediction_grades: Grade | Grade[] | null;
};

type LineRow = {
  id: number;
  game_id: number;
  market_type: Market;
  sportsbook: string;
  side: "home" | "away" | "over" | "under";
  line_value: number | null;
  odds_american: number | null;
  recorded_at: string;
};

type SplitRow = {
  id: number;
  provider: "playbook" | "sharpapi";
  game_id: number;
  market_type: Market;
  side: "home" | "away" | "over" | "under";
  public_betting_pct: number | null;
  public_money_pct: number | null;
  books_used: number | null;
  observed_at: string;
};

type SplitAtLock = {
  provider: "playbook" | "sharpapi";
  observedAt: string;
  ageMinutes: number;
  firstSideBets: number;
  firstSideMoney: number;
  booksUsed: number | null;
};

type LockedLine = {
  market_type: Market;
  sportsbook: string;
  side: "home" | "away" | "over" | "under";
  line_value: number | null;
  odds_american: number;
};

type LockedPair = {
  market: Market;
  book: string;
  sourceClass: "named" | "retail";
  line: number | null;
  firstProbability: number;
  firstOdds: number;
  secondOdds: number;
};

type QuotePoint = {
  at: string;
  axis: number;
  line: number | null;
  selectedProbability: number;
};

type Trail = {
  source: string;
  sourceClass: "named" | "retail";
  observations: number;
  openingAxis: number;
  currentAxis: number;
  movement: number;
  direction: Side | null;
  firstMoveAt: string | null;
  persistence: number;
  reversed: boolean;
  maximumExcursion: number;
  buyback: number;
};

type Signal = {
  side: Side | null;
  reason: string;
  sources: string[];
};

type Distribution = {
  homeWin: number;
  margin: Map<number, number>;
  total: Map<number, number>;
};

type MarketBoard = {
  probability: number;
  books: number;
  namedProbability: number | null;
  namedBooks: number;
  dispersion: number;
};

type ReconciledForecast = {
  margin: number;
  total: number;
  homeWin: number;
  homeCover: number;
  over: number;
  sides: Record<Market, Side>;
  marginAuthority: number;
  totalAuthority: number;
  marketMargin: number | null;
  marketTotal: number | null;
  mlPuckAgreement: boolean | null;
};

type Candidate = {
  name: string;
  base: "independent" | "incumbent";
  marginWeight: number;
  totalWeight: number;
  sequenceBoost: number;
  splitBoost: number;
  disagreementMultiplier: number;
  totalBreadthMode: "scaled" | "full";
  minimumTotalBooks: number;
  preserveHomeWinOnTotal: boolean;
};

type ReconciliationInputs = {
  ml: MarketBoard | null;
  puck: MarketBoard | null;
  totalBoard: MarketBoard | null;
  mlMargin: number | null;
  puckMargin: number | null;
  marketMargin: number | null;
  marketTotal: number | null;
};

type Game = {
  id: number;
  slateDate: string;
  startsAt: string;
  lockedAt: string;
  matchup: string;
  away: string;
  home: string;
  release: string;
  actualAway: number;
  actualHome: number;
  independentMargin: number;
  independentTotal: number;
  finalMargin: number;
  finalTotal: number;
  totalLine: number;
  homePuckLine: number;
  marketHomeProbability: number | null;
  marketOpenHomeProbability: number | null;
  marketOpenTotalLine: number | null;
  storedHomeProbabilityMove: number | null;
  storedTotalMove: number | null;
  marketDecision: string;
  splits: {
    mlHomeBets: number | null;
    mlHomeMoney: number | null;
    totalOverBets: number | null;
    totalOverMoney: number | null;
    mlSource: string | null;
    totalSource: string | null;
    mlConfidence: string | null;
    totalConfidence: string | null;
  };
  splitAtLock: Record<Market, SplitAtLock | null>;
  lockedLines: LockedLine[];
  evaluatedBooks: Partial<Record<Market, string>>;
  records: Record<Market, RecordRow>;
  trails: Record<Market, Trail[]>;
};

const MARKETS: Market[] = ["moneyline", "spread", "total"];
const NAMED_BOOKS = new Set(["circa", "pinnacle", "bookmaker"]);

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function poissonPmf(lambda: number, maximum = 12): number[] {
  const values = [Math.exp(-lambda)];
  for (let goals = 1; goals <= maximum; goals += 1) values.push(values[goals - 1]! * lambda / goals);
  values[maximum] = values[maximum]! + Math.max(0, 1 - values.reduce((sum, value) => sum + value, 0));
  return values;
}

function jointDistribution(homeGoals: number, awayGoals: number): Distribution {
  const homePmf = poissonPmf(homeGoals);
  const awayPmf = poissonPmf(awayGoals);
  const margin = new Map<number, number>();
  const total = new Map<number, number>();
  let homeRegulation = 0;
  let tie = 0;
  for (let home = 0; home < homePmf.length; home += 1) {
    for (let away = 0; away < awayPmf.length; away += 1) {
      const probability = homePmf[home]! * awayPmf[away]!;
      margin.set(home - away, (margin.get(home - away) ?? 0) + probability);
      total.set(home + away, (total.get(home + away) ?? 0) + probability);
      if (home > away) homeRegulation += probability;
      else if (home === away) tie += probability;
    }
  }
  return { homeWin: homeRegulation + tie * logistic(0.42 * (homeGoals - awayGoals)), margin, total };
}

function probabilityAbove(distribution: ReadonlyMap<number, number>, line: number): number {
  let probability = 0;
  for (const [value, mass] of distribution) if (value > line) probability += mass;
  return probability;
}

function probabilityBelow(distribution: ReadonlyMap<number, number>, line: number): number {
  let probability = 0;
  for (const [value, mass] of distribution) if (value < line) probability += mass;
  return probability;
}

function homeCoverProbability(distribution: Distribution, homeLine: number): number {
  let probability = 0;
  for (const [margin, mass] of distribution.margin) if (margin + homeLine > 0) probability += mass;
  return probability;
}

function conditionalOverProbability(distribution: Distribution, line: number): number {
  const over = probabilityAbove(distribution.total, line);
  const under = probabilityBelow(distribution.total, line);
  return over + under <= 0 ? 0.5 : over / (over + under);
}

function goalDiffForProbability(
  totalGoals: number,
  targetProbability: number,
  probabilityAt: (distribution: Distribution) => number,
): number | null {
  const at = (goalDiff: number) => probabilityAt(jointDistribution(
    Math.max(0.01, (totalGoals + goalDiff) / 2),
    Math.max(0.01, (totalGoals - goalDiff) / 2),
  ));
  let low = -Math.max(4.5, totalGoals);
  let high = Math.max(4.5, totalGoals);
  if (targetProbability < at(low) || targetProbability > at(high)) return null;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if (at(middle) < targetProbability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function totalForOverProbability(line: number, targetProbability: number): number | null {
  const at = (totalGoals: number) => conditionalOverProbability(
    jointDistribution(totalGoals / 2, totalGoals / 2),
    line,
  );
  let low = 3.5;
  let high = 9;
  if (targetProbability < at(low) || targetProbability > at(high)) return null;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if (at(middle) < targetProbability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function sign(value: number): Side {
  return value >= 0 ? 1 : -1;
}

function threshold(market: Market): number {
  // ML and puck-line axes are de-vigged probability; Total axis is an
  // approximate goal coordinate combining the number and two-sided price.
  return market === "total" ? 0.12 : 0.01;
}

function groupBy<T, K>(values: readonly T[], key: (value: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const value of values) grouped.set(key(value), [...(grouped.get(key(value)) ?? []), value]);
  return grouped;
}

function completeLockedPairs(game: Game, market: Market): LockedPair[] {
  const result: LockedPair[] = [];
  const byBook = groupBy(game.lockedLines.filter((line) => line.market_type === market), (line) => line.sportsbook);
  for (const [book, rows] of byBook) {
    const candidates: Array<{ first: LockedLine; second: LockedLine }> = [];
    if (market === "moneyline") {
      const home = rows.find((row) => row.side === "home");
      const away = rows.find((row) => row.side === "away");
      if (home && away) candidates.push({ first: home, second: away });
    } else if (market === "total") {
      for (const over of rows.filter((row) => row.side === "over" && row.line_value !== null)) {
        const under = rows.find((row) => row.side === "under" && row.line_value === over.line_value);
        if (under) candidates.push({ first: over, second: under });
      }
    } else {
      for (const home of rows.filter((row) => row.side === "home" && row.line_value !== null)) {
        const away = rows.find((row) => row.side === "away"
          && row.line_value !== null
          && Math.abs(row.line_value + home.line_value!) < 0.01);
        if (away) candidates.push({ first: home, second: away });
      }
    }
    for (const { first, second } of candidates) {
      const firstImplied = implied(first.odds_american);
      const secondImplied = implied(second.odds_american);
      const hold = firstImplied + secondImplied;
      if (hold < 0.94 || hold > 1.20) continue;
      result.push({
        market,
        book,
        sourceClass: NAMED_BOOKS.has(book) ? "named" : "retail",
        line: first.line_value,
        firstProbability: firstImplied / hold,
        firstOdds: first.odds_american,
        secondOdds: second.odds_american,
      });
    }
  }
  return [...new Map(result.map((pair) => [`${pair.book}|${pair.line ?? "ml"}`, pair])).values()];
}

function targetExcludedLockedPairs(game: Game, market: Market): LockedPair[] {
  const evaluated = game.evaluatedBooks[market];
  return completeLockedPairs(game, market).filter((pair) => !evaluated || pair.book !== evaluated);
}

function lockedBoard(game: Game, market: Market): MarketBoard | null {
  const targetLine = market === "spread" ? game.homePuckLine : market === "total" ? game.totalLine : null;
  const pairs = targetExcludedLockedPairs(game, market).filter((pair) => (
    targetLine === null || (pair.line !== null && Math.abs(pair.line - targetLine) < 0.01)
  ));
  const probability = median(pairs.map((pair) => pair.firstProbability));
  if (probability === null) return null;
  const named = pairs.filter((pair) => pair.sourceClass === "named");
  const namedProbability = median(named.map((pair) => pair.firstProbability));
  return {
    probability,
    books: pairs.length,
    namedProbability,
    namedBooks: named.length,
    dispersion: Math.max(...pairs.map((pair) => pair.firstProbability))
      - Math.min(...pairs.map((pair) => pair.firstProbability)),
  };
}

function exclusionStability(game: Game, market: Market) {
  const targetLine = market === "spread" ? game.homePuckLine : market === "total" ? game.totalLine : null;
  const pairs = completeLockedPairs(game, market).filter((pair) => (
    targetLine === null || (pair.line !== null && Math.abs(pair.line - targetLine) < 0.01)
  ));
  const values = [...new Set(pairs.map((pair) => pair.book))].flatMap((excluded) => {
    const probability = median(pairs.filter((pair) => pair.book !== excluded).map((pair) => pair.firstProbability));
    return probability === null ? [] : [probability];
  });
  if (values.length === 0) return null;
  return {
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    sameSideAcrossEveryExclusion: values.every((value) => value >= 0.5) || values.every((value) => value < 0.5),
  };
}

function stableSequenceDirection(game: Game, market: Market): Side | null {
  const named = namedSequence(game, market);
  if (named.side !== null) return named.side;
  return broadSequence(game, market).side;
}

function splitSupport(game: Game, market: "moneyline" | "total", direction: Side): number {
  const tickets = market === "moneyline" ? game.splits.mlHomeBets : game.splits.totalOverBets;
  const money = market === "moneyline" ? game.splits.mlHomeMoney : game.splits.totalOverMoney;
  if (tickets === null || money === null) return 0;
  const ticketLean = Math.abs(tickets - 50) < 5 ? 0 : sign(tickets - 50);
  const moneyLean = Math.abs(money - 50) < 5 ? 0 : sign(money - 50);
  if (ticketLean === direction && moneyLean === direction) return 1;
  if (moneyLean === direction && Math.abs(money - tickets) >= 10) return 0.5;
  if (ticketLean === -direction && moneyLean === -direction) return -1;
  return 0;
}

const reconciliationInputCache = new Map<number, ReconciliationInputs>();

function reconciliationInputs(game: Game): ReconciliationInputs {
  const cached = reconciliationInputCache.get(game.id);
  if (cached) return cached;
  const ml = lockedBoard(game, "moneyline");
  const puck = lockedBoard(game, "spread");
  const totalBoard = lockedBoard(game, "total");
  const mlMargin = ml === null ? null : goalDiffForProbability(
    game.independentTotal,
    ml.probability,
    (distribution) => distribution.homeWin,
  );
  const puckMargin = puck === null ? null : goalDiffForProbability(
    game.independentTotal,
    puck.probability,
    (distribution) => homeCoverProbability(distribution, game.homePuckLine),
  );
  const marginTargets = [mlMargin, puckMargin].filter((value): value is number => value !== null);
  const value = {
    ml,
    puck,
    totalBoard,
    mlMargin,
    puckMargin,
    marketMargin: marginTargets.length === 0 ? null
      : marginTargets.reduce((sum, target) => sum + target, 0) / marginTargets.length,
    marketTotal: totalBoard === null ? null : totalForOverProbability(game.totalLine, totalBoard.probability),
  };
  reconciliationInputCache.set(game.id, value);
  return value;
}

function reconcile(game: Game, candidate: Candidate): ReconciledForecast {
  const { ml, puck, totalBoard, mlMargin, puckMargin, marketMargin, marketTotal } = reconciliationInputs(game);
  const baseMargin = candidate.base === "incumbent" ? game.finalMargin : game.independentMargin;
  const baseTotal = candidate.base === "incumbent" ? game.finalTotal : game.independentTotal;

  const mlShift = mlMargin === null ? null : mlMargin - baseMargin;
  const puckShift = puckMargin === null ? null : puckMargin - baseMargin;
  const crossAgreement = mlShift === null || puckShift === null || Math.abs(mlShift) < 0.03 || Math.abs(puckShift) < 0.03
    ? null
    : sign(mlShift) === sign(puckShift);
  const marginDirection = marketMargin === null || Math.abs(marketMargin - baseMargin) < 0.03
    ? null
    : sign(marketMargin - baseMargin);
  const totalDirection = marketTotal === null || Math.abs(marketTotal - baseTotal) < 0.03
    ? null
    : sign(marketTotal - baseTotal);

  const marginBreadth = ml && puck ? clamp(Math.min(ml.books, puck.books) / 6, 0.35, 1) : 0.35;
  const marginNamed = ml && puck && ml.namedBooks > 0 && puck.namedBooks > 0 ? 1 : 0.8;
  let marginAuthority = marketMargin === null ? 0 : candidate.marginWeight * marginBreadth * marginNamed;
  if (crossAgreement === false) marginAuthority *= candidate.disagreementMultiplier;
  if (marginDirection !== null) {
    const mlSequence = stableSequenceDirection(game, "moneyline");
    const puckSequence = stableSequenceDirection(game, "spread");
    const sequenceVotes = [mlSequence, puckSequence].filter((value): value is Side => value !== null);
    if (sequenceVotes.some((value) => value === marginDirection)) marginAuthority += candidate.sequenceBoost;
    if (sequenceVotes.some((value) => value === -marginDirection)) marginAuthority *= 0.65;
    marginAuthority += candidate.splitBoost * Math.max(0, splitSupport(game, "moneyline", marginDirection));
    if (splitSupport(game, "moneyline", marginDirection) < 0) marginAuthority *= 0.8;
  }
  marginAuthority = clamp(marginAuthority, 0, 1);

  const totalBreadth = totalBoard && totalBoard.books >= candidate.minimumTotalBooks
    ? candidate.totalBreadthMode === "full" ? 1 : clamp(totalBoard.books / 6, 0.35, 1)
    : 0;
  const totalNamed = totalBoard?.namedBooks ? 1 : 0.8;
  let totalAuthority = marketTotal === null ? 0 : candidate.totalWeight * totalBreadth * totalNamed;
  if (totalDirection !== null) {
    const sequence = stableSequenceDirection(game, "total");
    if (sequence === totalDirection) totalAuthority += candidate.sequenceBoost;
    if (sequence === -totalDirection) totalAuthority *= 0.65;
    totalAuthority += candidate.splitBoost * Math.max(0, splitSupport(game, "total", totalDirection));
    if (splitSupport(game, "total", totalDirection) < 0) totalAuthority *= 0.8;
  }
  totalAuthority = clamp(totalAuthority, 0, 1);

  const rawMargin = marketMargin === null
    ? baseMargin
    : baseMargin + marginAuthority * (marketMargin - baseMargin);
  const total = marketTotal === null
    ? baseTotal
    : clamp(baseTotal + totalAuthority * (marketTotal - baseTotal), 4.5, 8);
  const baseDistribution = jointDistribution(
    Math.max(0.01, (baseTotal + baseMargin) / 2),
    Math.max(0.01, (baseTotal - baseMargin) / 2),
  );
  const margin = candidate.preserveHomeWinOnTotal && marginAuthority === 0
    ? goalDiffForProbability(total, baseDistribution.homeWin, (distribution) => distribution.homeWin) ?? rawMargin
    : rawMargin;
  const distribution = jointDistribution(
    Math.max(0.01, (total + margin) / 2),
    Math.max(0.01, (total - margin) / 2),
  );
  const homeCover = homeCoverProbability(distribution, game.homePuckLine);
  const over = conditionalOverProbability(distribution, game.totalLine);
  const incumbentTotalSide: Side = game.records.total.side === "over" ? 1 : -1;
  return {
    margin,
    total,
    homeWin: distribution.homeWin,
    homeCover,
    over,
    sides: {
      moneyline: distribution.homeWin >= 0.5 ? 1 : -1,
      spread: homeCover >= 0.5 ? 1 : -1,
      total: Math.abs(over - 0.5) < 1e-9 ? incumbentTotalSide : over >= 0.5 ? 1 : -1,
    },
    marginAuthority,
    totalAuthority,
    marketMargin,
    marketTotal,
    mlPuckAgreement: crossAgreement,
  };
}

function completePoints(rows: readonly LineRow[], market: Market): Map<string, QuotePoint[]> {
  const result = new Map<string, QuotePoint[]>();
  const snapshots = groupBy(rows.filter((row) => row.market_type === market), (row) => (
    `${canonical(row.sportsbook)}|${row.recorded_at}`
  ));
  for (const [key, snapshot] of snapshots) {
    const [book, at] = key.split("|");
    if (!book || !at) continue;
    let first: LineRow | undefined;
    let second: LineRow | undefined;
    if (market === "moneyline") {
      first = snapshot.find((row) => row.side === "home" && row.odds_american !== null);
      second = snapshot.find((row) => row.side === "away" && row.odds_american !== null);
    } else if (market === "total") {
      const pairs = snapshot.flatMap((over) => over.side !== "over" || over.line_value === null ? [] : snapshot
        .filter((under) => under.side === "under" && under.line_value === over.line_value)
        .map((under) => ({ first: over, second: under })));
      const selected = [...pairs].sort((left, right) => (
        Math.abs((left.first.line_value ?? 0) - 6) - Math.abs((right.first.line_value ?? 0) - 6)
      ))[0];
      first = selected?.first;
      second = selected?.second;
    } else {
      const pairs = snapshot.flatMap((home) => home.side !== "home" || home.line_value === null ? [] : snapshot
        .filter((away) => away.side === "away" && away.line_value !== null && Math.abs(away.line_value + home.line_value!) < 0.01)
        .map((away) => ({ first: home, second: away })));
      const selected = [...pairs].sort((left, right) => (
        Math.abs(Math.abs(left.first.line_value ?? 0) - 1.5) - Math.abs(Math.abs(right.first.line_value ?? 0) - 1.5)
      ))[0];
      first = selected?.first;
      second = selected?.second;
    }
    if (!first || !second || first.odds_american === null || second.odds_american === null) continue;
    const firstImplied = implied(first.odds_american);
    const secondImplied = implied(second.odds_american);
    const hold = firstImplied + secondImplied;
    if (hold < 0.94 || hold > 1.20) continue;
    const selectedProbability = firstImplied / hold;
    // A 10pp two-sided price migration is treated as roughly half a goal for
    // the Total audit axis. Candidate fitting evaluates the line and price
    // components separately as well; this coordinate is for sequence shape.
    const axis = market === "total"
      ? (first.line_value ?? 0) + 5 * (selectedProbability - 0.5)
      : selectedProbability;
    const point = { at, axis, line: first.line_value, selectedProbability };
    result.set(book, [...(result.get(book) ?? []), point]);
  }
  for (const [book, points] of result) {
    const unique = [...new Map(points.map((point) => [`${point.at}|${point.axis}`, point])).values()]
      .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
    result.set(book, unique);
  }
  return result;
}

function buildTrails(rows: readonly LineRow[], market: Market): Trail[] {
  return [...completePoints(rows, market).entries()].flatMap(([source, points]) => {
    if (points.length === 0) return [];
    const opening = points[0]!;
    const current = points.at(-1)!;
    const movement = current.axis - opening.axis;
    const minimum = threshold(market);
    const direction = Math.abs(movement) >= minimum ? sign(movement) : null;
    const excursions = points.slice(1).map((point) => point.axis - opening.axis);
    const moved = excursions.filter((value) => Math.abs(value) >= minimum);
    const aligned = direction === null ? [] : moved.filter((value) => sign(value) === direction);
    const maximumExcursion = excursions.reduce((best, value) => (
      Math.abs(value) > Math.abs(best) ? value : best
    ), 0);
    const firstMove = points.find((point) => Math.abs(point.axis - opening.axis) >= minimum) ?? null;
    return [{
      source,
      sourceClass: NAMED_BOOKS.has(source) ? "named" : "retail",
      observations: points.length,
      openingAxis: opening.axis,
      currentAxis: current.axis,
      movement,
      direction,
      firstMoveAt: firstMove?.at ?? null,
      persistence: moved.length === 0 ? 0 : aligned.length / moved.length,
      reversed: direction !== null && moved.some((value) => sign(value) !== direction),
      maximumExcursion,
      buyback: Math.max(0, Math.abs(maximumExcursion) - Math.abs(movement)),
    }];
  });
}

function consensus(
  trails: readonly Trail[],
  minimumSources: number,
  minimumAgreement: number,
  requireStable: boolean,
): Signal {
  const eligible = trails.filter((trail): trail is Trail & { direction: Side } => (
    trail.direction !== null
    && (!requireStable || (!trail.reversed && trail.persistence >= 0.67))
  ));
  if (eligible.length < minimumSources) {
    return { side: null, reason: "insufficient_sources", sources: eligible.map((trail) => trail.source) };
  }
  const positive = eligible.filter((trail) => trail.direction === 1);
  const negative = eligible.filter((trail) => trail.direction === -1);
  const selected = positive.length >= negative.length ? positive : negative;
  if (selected.length / eligible.length < minimumAgreement) {
    return { side: null, reason: "book_disagreement", sources: eligible.map((trail) => trail.source) };
  }
  return {
    side: selected[0]!.direction,
    reason: requireStable ? "stable_consensus" : "endpoint_consensus",
    sources: selected.map((trail) => trail.source),
  };
}

function namedSequence(game: Game, market: Market): Signal {
  return consensus(
    game.trails[market].filter((trail) => trail.sourceClass === "named"),
    2,
    1,
    true,
  );
}

function broadSequence(game: Game, market: Market): Signal {
  return consensus(game.trails[market], 4, 0.75, true);
}

function storedSameBookMove(game: Game, market: Market): Signal {
  const movement = market === "moneyline" ? game.storedHomeProbabilityMove : market === "total" ? game.storedTotalMove : null;
  const minimum = market === "moneyline" ? 0.01 : market === "total" ? 0.5 : Number.POSITIVE_INFINITY;
  return movement !== null && Math.abs(movement) >= minimum
    ? { side: sign(movement), reason: "stored_same_book_endpoint", sources: ["stored_selected_book"] }
    : { side: null, reason: "unavailable_or_trivial", sources: [] };
}

function splitAlignedFlow(game: Game, market: Market): Signal {
  if (market === "spread") return { side: null, reason: "not_frozen_at_lock", sources: [] };
  const tickets = market === "moneyline" ? game.splits.mlHomeBets : game.splits.totalOverBets;
  const money = market === "moneyline" ? game.splits.mlHomeMoney : game.splits.totalOverMoney;
  if (tickets === null || money === null) return { side: null, reason: "unavailable", sources: [] };
  if (tickets >= 55 && money >= 55) return { side: 1, reason: "tickets_and_money_aligned", sources: ["public_splits"] };
  if (tickets <= 45 && money <= 45) return { side: -1, reason: "tickets_and_money_aligned", sources: ["public_splits"] };
  return { side: null, reason: "not_aligned", sources: ["public_splits"] };
}

function splitMoneyTicketGap(game: Game, market: Market, minimum = 10): Signal {
  if (market === "spread") return { side: null, reason: "not_frozen_at_lock", sources: [] };
  const tickets = market === "moneyline" ? game.splits.mlHomeBets : game.splits.totalOverBets;
  const money = market === "moneyline" ? game.splits.mlHomeMoney : game.splits.totalOverMoney;
  if (tickets === null || money === null || Math.abs(money - tickets) < minimum) {
    return { side: null, reason: "unavailable_or_small_gap", sources: [] };
  }
  return { side: sign(money - tickets), reason: "money_ticket_divergence", sources: ["public_splits"] };
}

function sequenceResistance(game: Game, market: Market): Signal {
  if (market === "spread") return { side: null, reason: "spread_split_not_frozen_at_lock", sources: [] };
  const movement = namedSequence(game, market).side !== null
    ? namedSequence(game, market)
    : broadSequence(game, market);
  const tickets = market === "moneyline" ? game.splits.mlHomeBets : game.splits.totalOverBets;
  if (movement.side === null || tickets === null || (tickets > 45 && tickets < 55)) {
    return { side: null, reason: "unavailable", sources: movement.sources };
  }
  const ticketSide = tickets >= 55 ? 1 : -1;
  return movement.side !== ticketSide
    ? { side: movement.side, reason: "stable_move_against_ticket_majority", sources: [...movement.sources, "public_splits"] }
    : { side: null, reason: "not_resistance", sources: movement.sources };
}

function mlPuckAgreement(game: Game): Signal {
  const ml = namedSequence(game, "moneyline").side !== null ? namedSequence(game, "moneyline") : broadSequence(game, "moneyline");
  const puck = namedSequence(game, "spread").side !== null ? namedSequence(game, "spread") : broadSequence(game, "spread");
  return ml.side !== null && ml.side === puck.side
    ? { side: ml.side, reason: "moneyline_puck_sequence_agreement", sources: [...new Set([...ml.sources, ...puck.sources])] }
    : { side: null, reason: "not_aligned", sources: [...new Set([...ml.sources, ...puck.sources])] };
}

function lockedPriceSide(game: Game, market: Market, minimumDistance = 0): Signal {
  const board = lockedBoard(game, market);
  if (!board || Math.abs(board.probability - 0.5) < minimumDistance) {
    return { side: null, reason: "unavailable_or_too_close", sources: [] };
  }
  return {
    side: board.probability >= 0.5 ? 1 : -1,
    reason: "target_excluded_locked_price",
    sources: [`${board.books}_books`, `${board.namedBooks}_named`],
  };
}

function crossMarketMarginSide(game: Game): Signal {
  const inputs = reconciliationInputs(game);
  if (inputs.marketMargin === null || Math.abs(inputs.marketMargin) < 0.01) {
    return { side: null, reason: "unavailable_or_coinflip", sources: [] };
  }
  return {
    side: sign(inputs.marketMargin),
    reason: "moneyline_puck_price_distribution",
    sources: [
      ...(inputs.ml ? [`ml_${inputs.ml.books}_books`] : []),
      ...(inputs.puck ? [`puck_${inputs.puck.books}_books`] : []),
    ],
  };
}

function summarizeSignal(games: readonly Game[], market: Market, signal: (game: Game, market: Market) => Signal) {
  const rows = games.flatMap((game) => {
    const read = signal(game, market);
    return read.side === null ? [] : [{ game, read, result: outcome(game, market, read.side) }];
  });
  const resolved = rows.filter((row) => row.result !== "push");
  const wins = resolved.filter((row) => row.result === "win").length;
  const disagreements = rows.filter((row) => forecastSide(row.game, market, "final") !== row.read.side);
  const corrections = disagreements.filter((row) => (
    outcome(row.game, market, forecastSide(row.game, market, "final")) === "loss" && row.result === "win"
  )).length;
  const harms = disagreements.filter((row) => (
    outcome(row.game, market, forecastSide(row.game, market, "final")) === "win" && row.result === "loss"
  )).length;
  return {
    coverage: rows.length,
    wins,
    losses: resolved.length - wins,
    pushes: rows.length - resolved.length,
    accuracy: resolved.length ? wins / resolved.length : null,
    disagreements: disagreements.length,
    corrections,
    harms,
    netCorrections: corrections - harms,
    rows: rows.map(({ game, read, result }) => ({
      date: game.slateDate,
      game: game.matchup,
      side: read.side === 1 ? market === "total" ? "over" : "home" : market === "total" ? "under" : "away",
      reason: read.reason,
      sources: read.sources,
      result,
    })),
  };
}

async function fetchAllLineHistory(gameIds: number[], maximumLock: string): Promise<LineRow[]> {
  const rows: LineRow[] = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("line_history")
      .select("id,game_id,market_type,sportsbook,side,line_value,odds_american,recorded_at")
      .in("game_id", gameIds)
      .in("market_type", MARKETS)
      .lte("recorded_at", maximumLock)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`line_history: ${error.message}`);
    const page = (data ?? []) as LineRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function fetchAllSplits(gameIds: number[], maximumLock: string): Promise<SplitRow[]> {
  const rows: SplitRow[] = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("public_splits_observations")
      .select("id,provider,game_id,market_type,side,public_betting_pct,public_money_pct,books_used,observed_at")
      .eq("sport", "nhl")
      .in("game_id", gameIds)
      .in("market_type", MARKETS)
      .lte("observed_at", maximumLock)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`public_splits_observations: ${error.message}`);
    const page = (data ?? []) as SplitRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function resolveSplitAtLock(rows: readonly SplitRow[], game: Game, market: Market): SplitAtLock | null {
  const firstSide = market === "total" ? "over" : "home";
  const secondSide = market === "total" ? "under" : "away";
  for (const provider of ["playbook", "sharpapi"] as const) {
    const snapshots = [...groupBy(rows.filter((row) => (
      row.game_id === game.id
      && row.market_type === market
      && row.provider === provider
      && row.observed_at <= game.lockedAt
    )), (row) => row.observed_at).entries()].sort((left, right) => Date.parse(right[0]) - Date.parse(left[0]));
    for (const [observedAt, snapshot] of snapshots) {
      const first = snapshot.find((row) => row.side === firstSide);
      const second = snapshot.find((row) => row.side === secondSide);
      if (!first || !second || first.public_betting_pct === null || first.public_money_pct === null
        || second.public_betting_pct === null || second.public_money_pct === null) continue;
      return {
        provider,
        observedAt,
        ageMinutes: (Date.parse(game.lockedAt) - Date.parse(observedAt)) / 60_000,
        firstSideBets: first.public_betting_pct,
        firstSideMoney: first.public_money_pct,
        booksUsed: first.books_used,
      };
    }
  }
  return null;
}

function outcome(game: Game, market: Market, side: Side): Result {
  const actualMargin = game.actualHome - game.actualAway;
  const axis = market === "moneyline"
    ? actualMargin
    : market === "spread"
      ? actualMargin + game.homePuckLine
      : game.actualHome + game.actualAway - game.totalLine;
  if (Math.abs(axis) < 1e-9) return "push";
  return sign(axis) === side ? "win" : "loss";
}

function distributionSide(game: Game, market: Market, margin: number, total: number): Side {
  const distribution = jointDistribution(
    Math.max(0.01, (total + margin) / 2),
    Math.max(0.01, (total - margin) / 2),
  );
  if (market === "moneyline") return distribution.homeWin >= 0.5 ? 1 : -1;
  if (market === "spread") return homeCoverProbability(distribution, game.homePuckLine) >= 0.5 ? 1 : -1;
  return conditionalOverProbability(distribution, game.totalLine) >= 0.5 ? 1 : -1;
}

function forecastSide(game: Game, market: Market, source: "independent" | "final"): Side {
  if (source === "final") {
    return ["home", "over"].includes(game.records[market].side) ? 1 : -1;
  }
  return distributionSide(game, market, game.independentMargin, game.independentTotal);
}

function forecastSummary(games: readonly Game[], source: "independent" | "final") {
  const markets = Object.fromEntries(MARKETS.map((market) => {
    const rows = games.map((game) => outcome(game, market, forecastSide(game, market, source)));
    const resolved = rows.filter((result) => result !== "push");
    const wins = resolved.filter((result) => result === "win").length;
    return [market, {
      rows: rows.length,
      wins,
      losses: resolved.length - wins,
      pushes: rows.length - resolved.length,
      accuracy: resolved.length ? wins / resolved.length : null,
    }];
  }));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return {
    games: games.length,
    markets,
    score: {
      teamMae: mean(games.map((game) => {
        const margin = source === "independent" ? game.independentMargin : game.finalMargin;
        const total = source === "independent" ? game.independentTotal : game.finalTotal;
        return (Math.abs((total + margin) / 2 - game.actualHome) + Math.abs((total - margin) / 2 - game.actualAway)) / 2;
      })),
      marginMae: mean(games.map((game) => Math.abs(
        (source === "independent" ? game.independentMargin : game.finalMargin) - (game.actualHome - game.actualAway),
      ))),
      totalMae: mean(games.map((game) => Math.abs(
        (source === "independent" ? game.independentTotal : game.finalTotal) - (game.actualHome + game.actualAway),
      ))),
    },
  };
}

function bestLockedPrice(game: Game, market: Market, side: Side): number | null {
  const targetLine = market === "spread" ? game.homePuckLine : market === "total" ? game.totalLine : null;
  const prices = completeLockedPairs(game, market)
    .filter((pair) => targetLine === null || (pair.line !== null && Math.abs(pair.line - targetLine) < 0.01))
    .map((pair) => side === 1 ? pair.firstOdds : pair.secondOdds);
  return prices.length === 0 ? null : Math.max(...prices);
}

function settledUnit(result: Result, price: number | null): number | null {
  if (price === null) return null;
  if (result === "push") return 0;
  if (result === "loss") return -1;
  return price > 0 ? price / 100 : 100 / -price;
}

function calibrateTotalProbability(rawProbability: number): number {
  const probability = clamp(rawProbability, 0.001, 0.999);
  const logit = Math.log(probability / (1 - probability));
  return logistic(0.05706714956351745 + 0.514946128177911 * logit);
}

function priceAwareVerdict(
  market: Market,
  verdict: "best_angle" | "lean" | "watchlist" | "pass",
  price: number | null,
  probability: number,
): "best_angle" | "lean" | "watchlist" | "pass" {
  if (price === null || price <= -900) return "pass";
  if (price <= -200 && verdict === "best_angle") return "lean";
  const edge = probability - implied(price);
  if (market === "moneyline" && verdict === "best_angle" && (probability < 0.70 || edge < 0.05)) return "lean";
  if (market === "total" && verdict === "best_angle" && (probability < 0.65 || edge < 0.05)) return "lean";
  if (market === "spread" && verdict === "watchlist" && probability >= 0.58 && edge >= 0.05) return "lean";
  return verdict;
}

function candidateDecision(game: Game, market: Market, forecast: ReconciledForecast) {
  const side = forecast.sides[market];
  const firstProbability = market === "moneyline" ? forecast.homeWin : market === "spread" ? forecast.homeCover : forecast.over;
  const rawProbability = side === 1 ? firstProbability : 1 - firstProbability;
  const probability = market === "total" ? calibrateTotalProbability(rawProbability) : rawProbability;
  const board = lockedBoard(game, market);
  const marketProbability = board ? side === 1 ? board.probability : 1 - board.probability : null;
  const currentSide = forecastSide(game, market, "final");
  const price = currentSide === side ? game.records[market].odds_american : bestLockedPrice(game, market, side);
  let verdict: "best_angle" | "lean" | "watchlist" | "pass";
  if (market === "moneyline") {
    const conviction = Math.abs(probability - 0.5);
    const edge = marketProbability === null ? 0 : probability - marketProbability;
    verdict = conviction >= 0.12 && edge >= 0.018 ? "best_angle" : conviction >= 0.08 || edge >= 0.025 ? "lean" : "watchlist";
  } else if (market === "total") {
    const gap = forecast.total - game.totalLine;
    verdict = Math.abs(gap) >= 0.5 ? "best_angle" : Math.abs(gap) >= 0.15 ? "lean" : "watchlist";
  } else {
    const edge = marketProbability === null ? 0 : probability - marketProbability;
    verdict = probability >= 0.70 && edge >= 0.05
      ? "best_angle"
      : (probability >= 0.58 && edge >= 0.015) || edge >= 0.05 ? "lean" : "watchlist";
  }
  return {
    side,
    probability,
    price,
    verdict: priceAwareVerdict(market, verdict, price, probability),
  };
}

function sideLabel(game: Game, market: Market, side: Side): string {
  if (market === "moneyline") return `${side === 1 ? game.home : game.away} ML`;
  if (market === "total") return `${side === 1 ? "OVER" : "UNDER"} ${game.totalLine.toFixed(1)}`;
  const line = side === 1 ? game.homePuckLine : -game.homePuckLine;
  return `${side === 1 ? game.home : game.away} ${line > 0 ? "+" : ""}${line.toFixed(1)}`;
}

function normalizedRecordGrade(record: RecordRow): "best_angle" | "lean" | "watchlist" | "pass" | "unknown" {
  if (record.play_grade === "best_signal") return "best_angle";
  if (record.play_grade === "market_watch") return "watchlist";
  if (record.play_grade === "model_only") return record.no_bet ? "pass" : "lean";
  if (["best_angle", "lean", "watchlist", "pass"].includes(record.play_grade ?? "")) {
    return record.play_grade as "best_angle" | "lean" | "watchlist" | "pass";
  }
  return "unknown";
}

function currentBoardPreview(games: readonly Game[], candidate: Candidate) {
  const rows = games.map((game) => {
    const forecast = reconcile(game, candidate);
    return {
      date: game.slateDate,
      startsAt: game.startsAt,
      game: game.matchup,
      release: game.release,
      incumbentScore: { away: (game.finalTotal - game.finalMargin) / 2, home: (game.finalTotal + game.finalMargin) / 2 },
      candidateScore: { away: (forecast.total - forecast.margin) / 2, home: (forecast.total + forecast.margin) / 2 },
      authority: { margin: forecast.marginAuthority, total: forecast.totalAuthority },
      markets: Object.fromEntries(MARKETS.map((market) => {
        const decision = candidateDecision(game, market, forecast);
        const record = game.records[market];
        const beforeGrade = normalizedRecordGrade(record);
        return [market, {
          before: {
            pick: record.pick,
            side: record.side,
            probability: record.model_probability,
            grade: beforeGrade,
            storedGrade: record.play_grade,
            price: record.odds_american,
          },
          after: {
            pick: sideLabel(game, market, decision.side),
            side: decision.side === 1 ? market === "total" ? "over" : "home" : market === "total" ? "under" : "away",
            probability: decision.probability,
            grade: decision.verdict,
            price: decision.price,
          },
          sideChanged: forecastSide(game, market, "final") !== decision.side,
          gradeChanged: beforeGrade !== decision.verdict,
          evidence: {
            targetExcludedProbability: lockedBoard(game, market)?.probability ?? null,
            books: lockedBoard(game, market)?.books ?? 0,
            namedBooks: lockedBoard(game, market)?.namedBooks ?? 0,
            exclusionStability: exclusionStability(game, market),
          },
        }];
      })),
    };
  });
  const flattened = rows.flatMap((row) => MARKETS.map((market) => row.markets[market] as {
    before: { grade: string | null };
    after: { grade: string };
    sideChanged: boolean;
    gradeChanged: boolean;
  }));
  const gradeCounts = (source: "before" | "after") => Object.fromEntries(
    [...groupBy(flattened, (row) => row[source].grade ?? "unknown")].map(([grade, values]) => [grade, values.length]),
  );
  return {
    games: games.length,
    markets: flattened.length,
    sideChanges: flattened.filter((row) => row.sideChanged).length,
    gradeChanges: flattened.filter((row) => row.gradeChanged).length,
    actionableBefore: flattened.filter((row) => ["best_angle", "lean"].includes(row.before.grade ?? "")).length,
    actionableAfter: flattened.filter((row) => ["best_angle", "lean"].includes(row.after.grade)).length,
    gradeCounts: { before: gradeCounts("before"), after: gradeCounts("after") },
    rows,
  };
}

function historicalGradeImpact(games: readonly Game[], candidate: Candidate) {
  const rank = { unknown: -1, pass: 0, watchlist: 1, lean: 2, best_angle: 3 } as const;
  const baseline: Candidate = {
    ...candidate,
    name: "incumbent_current_policy_baseline",
    marginWeight: 0,
    totalWeight: 0,
    sequenceBoost: 0,
    splitBoost: 0,
  };
  const rows = games.flatMap((game) => {
    const baselineForecast = reconcile(game, baseline);
    const forecast = reconcile(game, candidate);
    return MARKETS.map((market) => {
      const beforeDecision = candidateDecision(game, market, baselineForecast);
      const before = beforeDecision.verdict;
      const afterDecision = candidateDecision(game, market, forecast);
      const after = afterDecision.verdict;
      return {
        date: game.slateDate,
        game: game.matchup,
        market,
        before,
        after,
        promotion: rank[after] > rank[before],
        demotion: rank[after] < rank[before],
        beforeActionable: before === "best_angle" || before === "lean",
        afterActionable: after === "best_angle" || after === "lean",
        beforeResult: outcome(game, market, beforeDecision.side),
        afterResult: outcome(game, market, afterDecision.side),
        beforeUnit: settledUnit(outcome(game, market, beforeDecision.side), beforeDecision.price),
        afterUnit: settledUnit(outcome(game, market, afterDecision.side), afterDecision.price),
      };
    });
  });
  const hitRate = (selected: typeof rows, source: "beforeResult" | "afterResult") => {
    const resolved = selected.filter((row) => row[source] !== "push");
    return {
      rows: selected.length,
      wins: resolved.filter((row) => row[source] === "win").length,
      losses: resolved.filter((row) => row[source] === "loss").length,
      pushes: selected.length - resolved.length,
      accuracy: resolved.length ? resolved.filter((row) => row[source] === "win").length / resolved.length : null,
      units: selected.reduce((sum, row) => sum + (source === "beforeResult" ? row.beforeUnit ?? 0 : row.afterUnit ?? 0), 0),
    };
  };
  return {
    promotions: rows.filter((row) => row.promotion).length,
    demotions: rows.filter((row) => row.demotion).length,
    actionableBefore: rows.filter((row) => row.beforeActionable).length,
    actionableAfter: rows.filter((row) => row.afterActionable).length,
    actionableBeforePerformance: hitRate(rows.filter((row) => row.beforeActionable), "beforeResult"),
    actionableAfterPerformance: hitRate(rows.filter((row) => row.afterActionable), "afterResult"),
    changes: rows.filter((row) => row.promotion || row.demotion),
  };
}

function reviewIncumbentLosses(games: readonly Game[], candidate: Candidate) {
  const rows = games.flatMap((game) => {
    const forecast = reconcile(game, candidate);
    return MARKETS.flatMap((market) => {
      const incumbent = forecastSide(game, market, "final");
      if (outcome(game, market, incumbent) !== "loss") return [];
      const actualSide: Side = -incumbent as Side;
      const price = lockedPriceSide(game, market);
      const sequence = stableSequenceDirection(game, market);
      const split = market === "spread" ? null : splitAlignedFlow(game, market).side;
      const cross = market === "moneyline" ? crossMarketMarginSide(game).side : null;
      const corrected = forecast.sides[market] === actualSide;
      const category = corrected
        ? "qualified_candidate_correction"
        : price.side === incumbent && (sequence === null || sequence === incumbent)
          ? "market_and_model_both_missed"
          : price.side === actualSide
            ? "market_disagreement_did_not_cross_final_boundary"
            : price.side === null && sequence === null
              ? "insufficient_replayable_market_evidence"
              : "mixed_or_false_market_evidence";
      return [{
        date: game.slateDate,
        game: game.matchup,
        market,
        category,
        incumbentSide: incumbent,
        actualSide,
        candidateSide: forecast.sides[market],
        lockedPriceSide: price.side,
        stableSequenceSide: sequence,
        splitAlignedSide: split,
        crossMarketMarginSide: cross,
      }];
    });
  });
  return {
    losses: rows.length,
    byMarket: Object.fromEntries(MARKETS.map((market) => [market,
      Object.fromEntries([...groupBy(rows.filter((row) => row.market === market), (row) => row.category)]
        .map(([category, values]) => [category, values.length])),
    ])),
    rows,
  };
}

function firstSideActual(game: Game, market: Market): 0 | 1 | null {
  const result = outcome(game, market, 1);
  return result === "push" ? null : result === "win" ? 1 : 0;
}

function candidateSummary(games: readonly Game[], candidate: Candidate) {
  const forecasts = games.map((game) => ({ game, forecast: reconcile(game, candidate) }));
  const markets = Object.fromEntries(MARKETS.map((market) => {
    const rows = forecasts.map(({ game, forecast }) => {
      const side = forecast.sides[market];
      const result = outcome(game, market, side);
      const incumbent = forecastSide(game, market, "final");
      const changed = incumbent !== side;
      const firstProbability = market === "moneyline" ? forecast.homeWin : market === "spread" ? forecast.homeCover : forecast.over;
      const actual = firstSideActual(game, market);
      const probability = clamp(firstProbability, 0.001, 0.999);
      const unit = settledUnit(result, bestLockedPrice(game, market, side));
      return {
        game,
        side,
        result,
        changed,
        correction: changed && outcome(game, market, incumbent) === "loss" && result === "win",
        harm: changed && outcome(game, market, incumbent) === "win" && result === "loss",
        brier: actual === null ? null : (probability - actual) ** 2,
        logLoss: actual === null ? null : -(actual * Math.log(probability) + (1 - actual) * Math.log(1 - probability)),
        unit,
      };
    });
    const resolved = rows.filter((row) => row.result !== "push");
    const scored = rows.filter((row): row is typeof row & { brier: number; logLoss: number } => row.brier !== null && row.logLoss !== null);
    const priced = rows.filter((row): row is typeof row & { unit: number } => row.unit !== null);
    const corrections = rows.filter((row) => row.correction).length;
    const harms = rows.filter((row) => row.harm).length;
    return [market, {
      wins: resolved.filter((row) => row.result === "win").length,
      losses: resolved.filter((row) => row.result === "loss").length,
      pushes: rows.length - resolved.length,
      accuracy: resolved.length ? resolved.filter((row) => row.result === "win").length / resolved.length : null,
      brier: scored.length ? scored.reduce((sum, row) => sum + row.brier, 0) / scored.length : null,
      logLoss: scored.length ? scored.reduce((sum, row) => sum + row.logLoss, 0) / scored.length : null,
      pricedRows: priced.length,
      units: priced.reduce((sum, row) => sum + row.unit, 0),
      changed: rows.filter((row) => row.changed).length,
      corrections,
      harms,
      netCorrections: corrections - harms,
    }];
  }));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const score = {
    teamMae: mean(forecasts.map(({ game, forecast }) => (
      Math.abs((forecast.total + forecast.margin) / 2 - game.actualHome)
      + Math.abs((forecast.total - forecast.margin) / 2 - game.actualAway)
    ) / 2)),
    marginMae: mean(forecasts.map(({ game, forecast }) => Math.abs(forecast.margin - (game.actualHome - game.actualAway)))),
    totalMae: mean(forecasts.map(({ game, forecast }) => Math.abs(forecast.total - (game.actualHome + game.actualAway)))),
  };
  const upsetRows = forecasts.flatMap(({ game, forecast }) => {
    const board = lockedBoard(game, "moneyline");
    if (!board || Math.abs(board.probability - 0.5) < 0.001) return [];
    const underdog: Side = board.probability < 0.5 ? 1 : -1;
    const upset = outcome(game, "moneyline", underdog) === "win";
    return upset ? [{ called: forecast.sides.moneyline === underdog }] : [];
  });
  const netCorrections = MARKETS.reduce((sum, market) => (
    sum + (markets[market] as { netCorrections: number }).netCorrections
  ), 0);
  return {
    candidate,
    games: games.length,
    markets,
    score,
    netCorrections,
    changedSides: MARKETS.reduce((sum, market) => sum + (markets[market] as { changed: number }).changed, 0),
    upsetRecall: upsetRows.length ? upsetRows.filter((row) => row.called).length / upsetRows.length : null,
    upsets: upsetRows.length,
    averageAuthority: {
      margin: mean(forecasts.map(({ forecast }) => forecast.marginAuthority)),
      total: mean(forecasts.map(({ forecast }) => forecast.totalAuthority)),
    },
  };
}

function compactCandidateSummary(summary: ReturnType<typeof candidateSummary>) {
  return {
    candidate: summary.candidate,
    games: summary.games,
    netCorrections: summary.netCorrections,
    changedSides: summary.changedSides,
    markets: summary.markets,
    score: summary.score,
    upsetRecall: summary.upsetRecall,
    upsets: summary.upsets,
    averageAuthority: summary.averageAuthority,
  };
}

function candidateChangeRows(games: readonly Game[], candidate: Candidate) {
  return games.flatMap((game) => {
    const forecast = reconcile(game, candidate);
    return MARKETS.flatMap((market) => {
      const before = forecastSide(game, market, "final");
      const after = forecast.sides[market];
      if (before === after) return [];
      const board = lockedBoard(game, market);
      return [{
        date: game.slateDate,
        game: game.matchup,
        market,
        before: before === 1 ? market === "total" ? "over" : "home" : market === "total" ? "under" : "away",
        after: after === 1 ? market === "total" ? "over" : "home" : market === "total" ? "under" : "away",
        beforeResult: outcome(game, market, before),
        afterResult: outcome(game, market, after),
        actual: `${game.actualAway}-${game.actualHome}`,
        line: market === "total" ? game.totalLine : market === "spread" ? game.homePuckLine : null,
        independentScore: { away: (game.independentTotal - game.independentMargin) / 2, home: (game.independentTotal + game.independentMargin) / 2 },
        incumbentScore: { away: (game.finalTotal - game.finalMargin) / 2, home: (game.finalTotal + game.finalMargin) / 2 },
        candidateScore: { away: (forecast.total - forecast.margin) / 2, home: (forecast.total + forecast.margin) / 2 },
        marketProbability: board?.probability ?? null,
        books: board?.books ?? 0,
        namedBooks: board?.namedBooks ?? 0,
        exclusionStability: exclusionStability(game, market),
        authority: market === "total" ? forecast.totalAuthority : forecast.marginAuthority,
        stableSequence: stableSequenceDirection(game, market),
        splits: game.splits,
      }];
    });
  });
}

function buildGame(gameId: number, rows: RecordRow[], requireOfficialScore: boolean): Game | null {
  const byMarket = new Map(rows.map((row) => [row.market, row]));
  if (byMarket.size !== 3) return null;
  const first = rows[0]!;
  const grade = one(first.prediction_grades);
  if (requireOfficialScore && (!grade || ![grade.actual_home_score, grade.actual_away_score].every(Number.isFinite))) return null;
  const snapshot = first.snapshot_json;
  const model = snapshot?.model_output;
  const feature = snapshot?.feature_inputs;
  const market = feature?.market;
  if (!model || !feature || !market || (requireOfficialScore && !first.locked_at)) return null;
  const required = [
    model.independent_goal_diff,
    model.independent_total_goals,
    model.expected_goal_diff,
    model.expected_total_goals,
    market.market_total_line,
    market.market_home_puck_line,
  ];
  if (!required.every(Number.isFinite)) return null;
  return {
    id: gameId,
    slateDate: first.slate_date,
    startsAt: first.game_date,
    lockedAt: first.locked_at ?? new Date().toISOString(),
    matchup: first.matchup,
    away: feature.away?.abbreviation ?? first.matchup.split(" @ ")[0] ?? "away",
    home: feature.home?.abbreviation ?? first.matchup.split(" @ ")[1] ?? "home",
    release: first.model_version,
    actualAway: grade?.actual_away_score ?? 0,
    actualHome: grade?.actual_home_score ?? 0,
    independentMargin: model.independent_goal_diff!,
    independentTotal: model.independent_total_goals!,
    finalMargin: model.expected_goal_diff!,
    finalTotal: model.expected_total_goals!,
    totalLine: market.market_total_line!,
    homePuckLine: market.market_home_puck_line!,
    marketHomeProbability: market.market_home_prob ?? null,
    marketOpenHomeProbability: market.market_open_home_prob ?? null,
    marketOpenTotalLine: market.market_open_total_line ?? null,
    storedHomeProbabilityMove: market.same_book_home_prob_move ?? null,
    storedTotalMove: market.same_book_total_move ?? null,
    marketDecision: model.layers?.market_decision ?? "unknown",
    splits: {
      mlHomeBets: market.ml_home_bets_pct ?? null,
      mlHomeMoney: market.ml_home_money_pct ?? null,
      totalOverBets: market.total_over_bets_pct ?? null,
      totalOverMoney: market.total_over_money_pct ?? null,
      mlSource: market.ml_split_source ?? null,
      totalSource: market.total_split_source ?? null,
      mlConfidence: market.ml_split_confidence ?? null,
      totalConfidence: market.total_split_confidence ?? null,
    },
    splitAtLock: { moneyline: null, spread: null, total: null },
    lockedLines: (snapshot.market_at_lock?.lines_snapshot ?? []).flatMap((line): LockedLine[] => {
      if (!MARKETS.includes(line.market_type as Market)
        || !line.sportsbook
        || !["home", "away", "over", "under"].includes(line.side ?? "")
        || !Number.isFinite(line.odds_american)) return [];
      return [{
        market_type: line.market_type as Market,
        sportsbook: canonical(line.sportsbook),
        side: line.side as LockedLine["side"],
        line_value: Number.isFinite(line.line_value) ? line.line_value! : null,
        odds_american: line.odds_american!,
      }];
    }),
    evaluatedBooks: Object.fromEntries(MARKETS.flatMap((selected) => {
      const book = snapshot.evaluated_quotes?.[selected]?.sportsbook;
      return book ? [[selected, canonical(book)]] : [];
    })) as Partial<Record<Market, string>>,
    records: Object.fromEntries(MARKETS.map((selected) => [selected, byMarket.get(selected)!])) as Record<Market, RecordRow>,
    trails: { moneyline: [], spread: [], total: [] },
  };
}

async function main(): Promise<void> {
  const { data, error } = await supabase.from("prediction_records")
    .select("id,game_id,slate_date,game_date,matchup,market,pick,side,line_value,odds_american,model_probability,play_grade,no_bet,locked_at,model_version,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(result,actual_home_score,actual_away_score,actual_total)")
    .eq("sport", "nhl")
    .in("model_version", [...NHL_REGULAR_TRANSITION_MODEL_RELEASES])
    .not("locked_at", "is", null)
    .in("market", MARKETS)
    .order("game_date", { ascending: true });
  if (error) throw new Error(`prediction_records: ${error.message}`);
  const records = (data ?? []) as unknown as RecordRow[];
  const grouped = groupBy(records, (row) => row.game_id);
  const provisional = [...grouped.entries()].flatMap(([gameId, rows]): Game[] => {
    const game = buildGame(gameId, rows, true);
    return game ? [game] : [];
  }).sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  if (provisional.length === 0) throw new Error("No complete settled NHL transition-release locks.");
  const { data: currentData, error: currentError } = await supabase.from("prediction_records")
    .select("id,game_id,slate_date,game_date,matchup,market,pick,side,line_value,odds_american,model_probability,play_grade,no_bet,locked_at,model_version,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(result,actual_home_score,actual_away_score,actual_total)")
    .eq("sport", "nhl")
    .eq("model_version", NHL_REGULAR_TRANSITION_MODEL_RELEASES[0])
    .gte("slate_date", "2026-10-09")
    .in("market", MARKETS)
    .order("game_date", { ascending: true });
  if (currentError) throw new Error(`current prediction_records: ${currentError.message}`);
  const currentGames = [...groupBy((currentData ?? []) as unknown as RecordRow[], (row) => row.game_id).entries()]
    .flatMap(([gameId, rows]): Game[] => {
      const game = buildGame(gameId, rows, false);
      return game ? [game] : [];
    })
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const history = await fetchAllLineHistory(
    provisional.map((game) => game.id),
    provisional.reduce((latest, game) => game.lockedAt > latest ? game.lockedAt : latest, provisional[0]!.lockedAt),
  );
  const splitHistory = await fetchAllSplits(
    provisional.map((game) => game.id),
    provisional.reduce((latest, game) => game.lockedAt > latest ? game.lockedAt : latest, provisional[0]!.lockedAt),
  );
  for (const game of provisional) {
    const gameRows = history.filter((row) => row.game_id === game.id && row.recorded_at <= game.lockedAt);
    game.trails = Object.fromEntries(MARKETS.map((market) => [market, buildTrails(gameRows, market)])) as Record<Market, Trail[]>;
    game.splitAtLock = Object.fromEntries(MARKETS.map((market) => [market,
      resolveSplitAtLock(splitHistory, game, market),
    ])) as Record<Market, SplitAtLock | null>;
  }

  const lossRows = provisional.flatMap((game) => MARKETS.flatMap((market) => (
    outcome(game, market, forecastSide(game, market, "final")) === "loss"
      ? [{
          date: game.slateDate,
          game: game.matchup,
          market,
          independentSide: forecastSide(game, market, "independent") === 1 ? market === "total" ? "over" : "home" : market === "total" ? "under" : "away",
          finalSide: forecastSide(game, market, "final") === 1 ? market === "total" ? "over" : "home" : market === "total" ? "under" : "away",
          marketDecision: game.marketDecision,
          namedTrails: game.trails[market].filter((trail) => trail.sourceClass === "named"),
          retailMoved: game.trails[market].filter((trail) => trail.sourceClass === "retail" && trail.direction !== null).length,
          splits: game.splits,
        }]
      : []
  )));

  const selectionCut = Math.floor(provisional.length * 0.70);
  const selection = provisional.slice(0, selectionCut);
  const confirmation = provisional.slice(selectionCut);
  const signalCandidates: Record<string, (game: Game, market: Market) => Signal> = {
    storedSameBookMove,
    namedSequence,
    broadSequence,
    splitAlignedFlow,
    splitMoneyTicketGap: (game, market) => splitMoneyTicketGap(game, market),
    splitMoneyTicketGap20: (game, market) => splitMoneyTicketGap(game, market, 20),
    sequenceResistance,
    mlPuckAgreement: (game, market) => market === "moneyline"
      ? mlPuckAgreement(game)
      : { side: null, reason: "moneyline_only", sources: [] },
    lockedPriceSide: (game, market) => lockedPriceSide(game, market),
    lockedPriceSideFourPoints: (game, market) => lockedPriceSide(game, market, 0.04),
    crossMarketMarginSide: (game, market) => market === "moneyline"
      ? crossMarketMarginSide(game)
      : { side: null, reason: "moneyline_only", sources: [] },
  };
  const signalReport = (games: readonly Game[]) => Object.fromEntries(Object.entries(signalCandidates).map(([name, signal]) => [
    name,
    Object.fromEntries(MARKETS.map((market) => [market, summarizeSignal(games, market, signal)])),
  ]));
  const candidates: Candidate[] = [];
  for (const base of ["independent", "incumbent"] as const) {
    for (const marginWeight of [0, 0.15, 0.25, 0.35, 0.5, 0.65, 0.8, 1]) {
      for (const totalWeight of [0, 0.1, 0.2, 0.3, 0.4, 0.55, 0.7, 0.85, 1]) {
        for (const sequenceBoost of [0, 0.08]) {
          for (const splitBoost of [0, 0.04]) {
            for (const disagreementMultiplier of [0.4, 0.65]) {
              candidates.push({
                name: `${base === "incumbent" ? "i" : "d"}_m${marginWeight}_t${totalWeight}_q${sequenceBoost}_s${splitBoost}_d${disagreementMultiplier}`,
                base,
                marginWeight,
                totalWeight,
                sequenceBoost,
                splitBoost,
                disagreementMultiplier,
                totalBreadthMode: "scaled",
                minimumTotalBooks: 1,
                preserveHomeWinOnTotal: false,
              });
            }
          }
        }
      }
      }
    }
  for (const totalWeight of [0.25, 0.5, 0.75, 1]) {
    candidates.push({
      name: `i_m0_t${totalWeight}_q0_s0_d0.4_bfull`,
      base: "incumbent",
      marginWeight: 0,
      totalWeight,
      sequenceBoost: 0,
      splitBoost: 0,
      disagreementMultiplier: 0.4,
      totalBreadthMode: "full",
      minimumTotalBooks: 2,
      preserveHomeWinOnTotal: true,
    });
  }
  const tournament = candidates.map((candidate) => ({
    candidate,
    selection: candidateSummary(selection, candidate),
    confirmation: candidateSummary(confirmation, candidate),
    full: candidateSummary(provisional, candidate),
  }));
  const orderCandidates = (left: typeof tournament[number], right: typeof tournament[number]) => (
    right.confirmation.netCorrections - left.confirmation.netCorrections
    || right.selection.netCorrections - left.selection.netCorrections
    || right.full.netCorrections - left.full.netCorrections
    || left.full.score.teamMae - right.full.score.teamMae
  );
  const robustCandidates = tournament.filter((row) => (
    row.selection.netCorrections >= 0
    && row.confirmation.netCorrections >= 0
    && row.full.netCorrections > 0
  )).sort(orderCandidates);
  const selectionLeaders = [...tournament].sort((left, right) => (
    right.selection.netCorrections - left.selection.netCorrections
    || right.confirmation.netCorrections - left.confirmation.netCorrections
    || left.selection.score.teamMae - right.selection.score.teamMae
  ));
  const noSplitLeaders = tournament.filter((row) => row.candidate.splitBoost === 0).sort(orderCandidates);
  const noSequenceOrSplitLeaders = tournament.filter((row) => (
    row.candidate.splitBoost === 0 && row.candidate.sequenceBoost === 0
  )).sort(orderCandidates);
  const independentBaseline = candidates.find((candidate) => candidate.name === "d_m0_t0_q0_s0_d0.4")!;
  const incumbentBaseline = candidates.find((candidate) => candidate.name === "i_m0_t0_q0_s0_d0.4")!;
  const totalPriceCandidate = candidates.find((candidate) => candidate.name === "i_m0_t1_q0_s0_d0.4")!;
  const fullBreadthTotalCandidate = candidates.find((candidate) => candidate.name === "i_m0_t1_q0_s0_d0.4_bfull")!;
  const projectionPickContradictions = provisional.flatMap((game) => MARKETS.flatMap((market) => {
    const projected = distributionSide(game, market, game.finalMargin, game.finalTotal);
    const recorded = forecastSide(game, market, "final");
    return projected === recorded ? [] : [{
      date: game.slateDate,
      game: game.matchup,
      market,
      projected,
      recorded,
      release: game.release,
    }];
  }));

  const report = {
    release: "nhl_professional_market_reader_audit_2026_10_09_r1",
    readOnly: true,
    writes: 0,
    cohort: {
      games: provisional.length,
      dates: { first: provisional[0]!.slateDate, last: provisional.at(-1)!.slateDate },
      chronology: {
        selectionGames: selection.length,
        selectionThrough: selection.at(-1)?.slateDate ?? null,
        confirmationGames: confirmation.length,
        confirmationFrom: confirmation[0]?.slateDate ?? null,
      },
      releases: Object.fromEntries([...groupBy(provisional, (game) => game.release)].map(([release, games]) => [release, games.length])),
      historyRows: history.length,
      splitHistoryRows: splitHistory.length,
      fullSequenceCoverage: Object.fromEntries(MARKETS.map((market) => [market, {
        any: provisional.filter((game) => game.trails[market].length > 0).length,
        twoNamed: provisional.filter((game) => game.trails[market].filter((trail) => trail.sourceClass === "named").length >= 2).length,
        anyMovement: provisional.filter((game) => game.trails[market].some((trail) => trail.direction !== null)).length,
      }])),
      frozenSnapshotSplitCoverage: {
        moneyline: provisional.filter((game) => game.splits.mlHomeBets !== null && game.splits.mlHomeMoney !== null).length,
        spread: 0,
        total: provisional.filter((game) => game.splits.totalOverBets !== null && game.splits.totalOverMoney !== null).length,
      },
      timestampedSplitReplayCoverage: {
        moneyline: provisional.filter((game) => game.splitAtLock.moneyline !== null).length,
        spread: provisional.filter((game) => game.splitAtLock.spread !== null).length,
        total: provisional.filter((game) => game.splitAtLock.total !== null).length,
      },
      staleSplitCoverage: {
        over180Minutes: Object.fromEntries(MARKETS.map((market) => [market,
          provisional.filter((game) => (game.splitAtLock[market]?.ageMinutes ?? -1) > 180).length,
        ])),
        over720Minutes: Object.fromEntries(MARKETS.map((market) => [market,
          provisional.filter((game) => (game.splitAtLock[market]?.ageMinutes ?? -1) > 720).length,
        ])),
      },
      lockedQuoteCoverage: Object.fromEntries(MARKETS.map((market) => [market, {
        any: provisional.filter((game) => game.lockedLines.some((line) => line.market_type === market)).length,
        completeBooks: provisional.filter((game) => completeLockedPairs(game, market).length > 0).length,
        targetExcludedCompleteBooks: provisional.filter((game) => targetExcludedLockedPairs(game, market).length > 0).length,
      }])),
    },
    incumbent: {
      independent: forecastSummary(provisional, "independent"),
      final: forecastSummary(provisional, "final"),
      changedSides: Object.fromEntries(MARKETS.map((market) => [market,
        provisional.filter((game) => forecastSide(game, market, "independent") !== forecastSide(game, market, "final")).length,
      ])),
      changedScores: provisional.filter((game) => (
        Math.abs(game.independentMargin - game.finalMargin) > 1e-9
        || Math.abs(game.independentTotal - game.finalTotal) > 1e-9
      )).length,
      marketDecisions: Object.fromEntries([...groupBy(provisional, (game) => game.marketDecision)].map(([decision, games]) => [decision, games.length])),
      projectionPickContradictions,
    },
    signalPerformance: signalReport(provisional),
    signalPerformanceByChronology: {
      selection: signalReport(selection),
      confirmation: signalReport(confirmation),
    },
    candidateTournament: {
      candidates: candidates.length,
      robustCandidates: robustCandidates.length,
      selectionLeaders: selectionLeaders.slice(0, 12).map((row) => ({
        candidate: row.candidate,
        selection: compactCandidateSummary(row.selection),
        confirmation: compactCandidateSummary(row.confirmation),
        full: compactCandidateSummary(row.full),
      })),
      confirmationStableLeaders: robustCandidates.slice(0, 20).map((row) => ({
        candidate: row.candidate,
        selection: compactCandidateSummary(row.selection),
        confirmation: compactCandidateSummary(row.confirmation),
        full: compactCandidateSummary(row.full),
      })),
      noSplitLeaders: noSplitLeaders.slice(0, 12).map((row) => ({
        candidate: row.candidate,
        selection: compactCandidateSummary(row.selection),
        confirmation: compactCandidateSummary(row.confirmation),
        full: compactCandidateSummary(row.full),
      })),
      priceOnlyLeaders: noSequenceOrSplitLeaders.slice(0, 12).map((row) => ({
        candidate: row.candidate,
        selection: compactCandidateSummary(row.selection),
        confirmation: compactCandidateSummary(row.confirmation),
        full: compactCandidateSummary(row.full),
      })),
      explicitBaselines: {
        independent: {
          selection: compactCandidateSummary(candidateSummary(selection, independentBaseline)),
          confirmation: compactCandidateSummary(candidateSummary(confirmation, independentBaseline)),
          full: compactCandidateSummary(candidateSummary(provisional, independentBaseline)),
        },
        incumbent: {
          selection: compactCandidateSummary(candidateSummary(selection, incumbentBaseline)),
          confirmation: compactCandidateSummary(candidateSummary(confirmation, incumbentBaseline)),
          full: compactCandidateSummary(candidateSummary(provisional, incumbentBaseline)),
        },
      },
      totalPriceSpotlight: {
        selection: compactCandidateSummary(candidateSummary(selection, totalPriceCandidate)),
        confirmation: compactCandidateSummary(candidateSummary(confirmation, totalPriceCandidate)),
        full: compactCandidateSummary(candidateSummary(provisional, totalPriceCandidate)),
        changes: candidateChangeRows(provisional, totalPriceCandidate),
      },
      fullBreadthTotalSpotlight: {
        selection: compactCandidateSummary(candidateSummary(selection, fullBreadthTotalCandidate)),
        confirmation: compactCandidateSummary(candidateSummary(confirmation, fullBreadthTotalCandidate)),
        full: compactCandidateSummary(candidateSummary(provisional, fullBreadthTotalCandidate)),
        gradeImpact: {
          selection: historicalGradeImpact(selection, fullBreadthTotalCandidate),
          confirmation: historicalGradeImpact(confirmation, fullBreadthTotalCandidate),
          full: historicalGradeImpact(provisional, fullBreadthTotalCandidate),
        },
        incumbentLossReview: reviewIncumbentLosses(provisional, fullBreadthTotalCandidate),
        changes: candidateChangeRows(provisional, fullBreadthTotalCandidate),
      },
      incumbentPriceWeightSensitivity: candidates.filter((candidate) => (
        candidate.base === "incumbent"
        && candidate.sequenceBoost === 0
        && candidate.splitBoost === 0
        && candidate.disagreementMultiplier === 0.4
        && (candidate.marginWeight === 0 || candidate.totalWeight === 0)
      )).map((candidate) => ({
        candidate,
        selection: compactCandidateSummary(candidateSummary(selection, candidate)),
        confirmation: compactCandidateSummary(candidateSummary(confirmation, candidate)),
        full: compactCandidateSummary(candidateSummary(provisional, candidate)),
      })),
    },
    currentBoard: {
      incumbent: currentBoardPreview(currentGames, incumbentBaseline),
      totalPriceCandidate: currentBoardPreview(currentGames, totalPriceCandidate),
      fullBreadthTotalCandidate: currentBoardPreview(currentGames, fullBreadthTotalCandidate),
    },
    losses: lossRows,
  };
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
