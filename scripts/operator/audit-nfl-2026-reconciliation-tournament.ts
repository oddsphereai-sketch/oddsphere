/** SELECT-only component ablation for the current paid NFL model/market reconciliation. */

import { supabase } from "@/lib/db/supabase";
import {
  buildNflMarketEvidenceOutcomeForecast,
  buildNflPaidTeamScoreBaseForecast,
  getNflV1WeekOneOutcomeForecast,
  type NflV1WeekOneOutcomeForecast,
} from "@/lib/services/football/nflV1WeekOneOutcome";
import { buildNflR6ShadowMoneylineDecision } from "@/lib/services/football/nflR6MoneylineShadow";
import { resolveNflTargetExcludedProduction } from "@/lib/services/football/nflTargetExcludedMarketOutcome";
import {
  hashNflForwardEvidencePayload,
  type NflForwardEvidencePayload,
  type NflForwardOperationalOpening,
  type NflForwardStoredEvidence,
} from "@/lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "@/lib/services/football/nflForwardEvidenceStore";
import {
  buildNflNamedMarketSequenceAuthority,
  type NflNamedMarketSequenceAuthority,
} from "@/lib/services/football/nflNamedMarketSequence";
import { buildNflMarketState } from "@/lib/services/football/nflMarketState";
import {
  buildNflProfessionalMarketAuthority,
  type NflProfessionalMarketAuthority,
} from "@/lib/services/football/nflProfessionalMarketAuthority";

type Market = "moneyline" | "spread" | "total";
type Result = "win" | "loss" | "push";
type Grade = { result: string; actual_home_score: number; actual_away_score: number };
type RecordRow = {
  id: number;
  market: Market;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: Grade | Grade[] | null;
};
type Variant = {
  publicSplits: boolean;
  sharpSplits: boolean;
  direction: boolean;
  tieredCenterWeights?: readonly [isolated: number, corroborated: number, strong: number];
  namedSequenceAuthority?: boolean;
  exactSequenceExclusion?: boolean;
  professionalMarketAuthority?: boolean;
};
type Side = -1 | 1;
type AuthorityRead = { side: Side | null; tier: 0 | 1 | 2 | 3; families: string[]; conflicts: string[] };
type Game = {
  payload: NflForwardEvidencePayload;
  actualHome: number;
  actualAway: number;
  histories: NflForwardStoredEvidence[];
};
type Replay = {
  game: Game;
  forecast: NflV1WeekOneOutcomeForecast;
  decisions: NflForwardEvidencePayload["decisions"]["evaluatedBets"];
};

const MARKETS: Market[] = ["moneyline", "spread", "total"];
const ACTIONABLE = new Set(["Best Angle", "Lean"]);
const VARIANTS: Record<string, Variant> = {
  current: { publicSplits: true, sharpSplits: true, direction: true },
  movementOnly: { publicSplits: false, sharpSplits: false, direction: true },
  noPublicSplits: { publicSplits: false, sharpSplits: true, direction: true },
  noSharpSplits: { publicSplits: true, sharpSplits: false, direction: true },
  splitsOnlyNoDirection: { publicSplits: true, sharpSplits: true, direction: false },
  publicOnlyNoDirection: { publicSplits: true, sharpSplits: false, direction: false },
  sharpOnlyNoDirection: { publicSplits: false, sharpSplits: true, direction: false },
  independentOnly: { publicSplits: false, sharpSplits: false, direction: false },
  tieredCenterConservative: { publicSplits: false, sharpSplits: false, direction: true, tieredCenterWeights: [0.1, 0.3, 0.6] },
  tieredCenterBalanced: { publicSplits: false, sharpSplits: false, direction: true, tieredCenterWeights: [0.15, 0.45, 0.8] },
  tieredCenterAggressive: { publicSplits: false, sharpSplits: false, direction: true, tieredCenterWeights: [0.25, 0.6, 1] },
  namedSequenceOverride: { publicSplits: true, sharpSplits: true, direction: true, namedSequenceAuthority: true },
  marketStateIdentityOnly: { publicSplits: true, sharpSplits: true, direction: true, namedSequenceAuthority: true,
    exactSequenceExclusion: true },
  professionalMarketReader: { publicSplits: true, sharpSplits: true, direction: true, professionalMarketAuthority: true },
};

function namedSequenceAuthority(game: Game): NflNamedMarketSequenceAuthority {
  return buildNflNamedMarketSequenceAuthority({
    evaluatedAt: game.payload.capturedAt,
    snapshots: game.histories.flatMap((row) => row.payload.contextualEvidenceCapture
      ? [{ capturedAt: row.capturedAt, markets: row.payload.contextualEvidenceCapture.markets }]
      : []),
    current: game.payload.market.current,
    playbookLine: game.payload.market.playbookLine,
    playbookSplits: game.payload.market.playbookSplits,
    sharpSplits: game.payload.market.sharpApiSplits,
  });
}

function targetExcludedNamedSequenceAuthority(
  game: Game,
  excludedFamiliesByMarket: Record<Market, string[]>,
): NflNamedMarketSequenceAuthority {
  return buildNflNamedMarketSequenceAuthority({
    evaluatedAt: game.payload.capturedAt,
    snapshots: game.histories.flatMap((row) => row.payload.contextualEvidenceCapture
      ? [{ capturedAt: row.capturedAt, markets: row.payload.contextualEvidenceCapture.markets }]
      : []),
    current: game.payload.market.current,
    playbookLine: game.payload.market.playbookLine,
    playbookSplits: game.payload.market.playbookSplits,
    sharpSplits: game.payload.market.sharpApiSplits,
    excludedFamiliesByMarket,
    minimumFollowerSources: 2,
  });
}

function professionalMarketAuthority(
  game: Game,
  excludedFamiliesByMarket?: Record<Market, string[]>,
): NflProfessionalMarketAuthority {
  return buildNflProfessionalMarketAuthority({
    evaluatedAt: game.payload.capturedAt,
    snapshots: game.histories.flatMap((row) => row.payload.contextualEvidenceCapture
      ? [{ capturedAt: row.capturedAt, markets: row.payload.contextualEvidenceCapture.markets }]
      : []),
    current: game.payload.market.current,
    playbookLine: game.payload.market.playbookLine,
    playbookSplits: game.payload.market.playbookSplits,
    sharpSplits: game.payload.market.sharpApiSplits,
    excludedFamiliesByMarket,
  });
}

function marketState(game: Game, market: Market) {
  return buildNflMarketState({
    market,
    evaluatedAt: game.payload.capturedAt,
    snapshots: game.histories.flatMap((row) => row.payload.contextualEvidenceCapture
      ? [{ capturedAt: row.capturedAt, markets: row.payload.contextualEvidenceCapture.markets }]
      : []),
    current: game.payload.market.current,
    playbookLine: game.payload.market.playbookLine,
    playbookSplits: game.payload.market.playbookSplits,
    sharpSplits: game.payload.market.sharpApiSplits,
  });
}

function sign(value: number): Side {
  return value >= 0 ? 1 : -1;
}

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function units(result: Result, price: number): number {
  if (result === "push") return 0;
  if (result === "loss") return -1;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

function logLoss(probability: number, won: boolean): number {
  const bounded = Math.min(1 - 1e-9, Math.max(1e-9, probability));
  return -(won ? Math.log(bounded) : Math.log(1 - bounded));
}

function splitSide(payload: NflForwardEvidencePayload, market: Market, source: "public" | "sharp"): Side | null {
  const split = source === "public" ? payload.market.playbookSplits?.[market] : payload.market.sharpApiSplits?.[market];
  if (!split) return null;
  const money = market === "total" ? split.overMoneyPct : split.homeMoneyPct;
  const bets = market === "total" ? split.overBetsPct : split.homeBetsPct;
  if (!Number.isFinite(money) || !Number.isFinite(bets)) return null;
  const gap = (money as number) - (bets as number);
  return Math.abs(gap) >= (source === "sharp" ? 10 : 8) ? sign(gap) : null;
}

function selectedMovementSide(payload: NflForwardEvidencePayload, market: Market): Side | null {
  const opening = payload.market.operationalOpening?.quote;
  const current = payload.market.current;
  if (!opening) return null;
  if (market === "moneyline" && opening.moneyline && current.moneyline) {
    const openAway = implied(opening.moneyline.awayPrice);
    const openHome = implied(opening.moneyline.homePrice);
    const currentAway = implied(current.moneyline.awayPrice);
    const currentHome = implied(current.moneyline.homePrice);
    const delta = currentHome / (currentHome + currentAway) - openHome / (openHome + openAway);
    return Math.abs(delta) >= 0.01 ? sign(delta) : null;
  }
  if (market === "spread" && opening.spread && current.spread) {
    const delta = opening.spread.homeLine - current.spread.homeLine;
    return Math.abs(delta) >= 0.5 ? sign(delta) : null;
  }
  if (market === "total" && opening.total && current.total) {
    const delta = current.total.line - opening.total.line;
    return Math.abs(delta) >= 0.5 ? sign(delta) : null;
  }
  return null;
}

function contextAxis(market: Market, value: readonly [string, number, string, number | null, number, number]): number | null {
  if (market === "moneyline") {
    const first = implied(value[4]);
    const second = implied(value[5]);
    return second / (first + second);
  }
  if (value[3] === null) return null;
  return market === "spread" ? -value[3] : value[3];
}

function bookConsensusSide(payload: NflForwardEvidencePayload, market: Market, namedOnly: boolean): Side | null {
  const families = payload.contextualEvidenceCapture?.markets[market].families ?? [];
  const directions = families.flatMap((family): Side[] => {
    const sourceClass = family[2];
    if (namedOnly && sourceClass !== "c" && sourceClass !== "p") return [];
    if (!family[4]) return [];
    const opening = contextAxis(market, family[4]);
    const current = contextAxis(market, family[5]);
    if (opening === null || current === null) return [];
    const delta = current - opening;
    const minimum = market === "moneyline" ? 0.01 : 0.5;
    return Math.abs(delta) >= minimum ? [sign(delta)] : [];
  });
  const minimumSources = namedOnly ? 2 : 4;
  if (directions.length < minimumSources) return null;
  const total = directions.reduce<number>((sum, value) => sum + value, 0);
  const agreement = Math.max(directions.filter((value) => value === 1).length, directions.filter((value) => value === -1).length) /
    directions.length;
  return agreement >= (namedOnly ? 1 : 0.75) ? sign(total) : null;
}

function authorityRead(payload: NflForwardEvidencePayload, market: Market): AuthorityRead {
  const inputs = [
    { family: "selected_movement", weight: 2, side: selectedMovementSide(payload, market) },
    { family: "named_book_consensus", weight: 2, side: bookConsensusSide(payload, market, true) },
    { family: "all_book_consensus", weight: 1, side: bookConsensusSide(payload, market, false) },
    { family: "named_split", weight: 1, side: splitSide(payload, market, "sharp") },
    { family: "public_split", weight: 0.5, side: splitSide(payload, market, "public") },
  ].filter((value): value is { family: string; weight: number; side: Side } => value.side !== null);
  if (inputs.length === 0) return { side: null, tier: 0, families: [], conflicts: [] };
  const score = inputs.reduce((sum, value) => sum + value.weight * value.side, 0);
  const side = sign(score === 0 ? inputs[0]!.side : score);
  const aligned = inputs.filter((value) => value.side === side).map((value) => value.family);
  const conflicts = inputs.filter((value) => value.side !== side).map((value) => value.family);
  const prices = aligned.includes("selected_movement") || aligned.includes("named_book_consensus");
  const splits = aligned.includes("named_split") || aligned.includes("public_split");
  const twoPriceFamilies = aligned.includes("selected_movement") && aligned.includes("named_book_consensus");
  const tier: AuthorityRead["tier"] = twoPriceFamilies && splits && conflicts.length === 0
    ? 3
    : (twoPriceFamilies || prices && splits) && conflicts.length <= 1
      ? 2
      : 1;
  return { side, tier, families: aligned, conflicts };
}

function tieredPaidProjection(game: Game, weights: NonNullable<Variant["tieredCenterWeights"]>) {
  const paid = game.payload.paidProjectionShadow!;
  const spread = authorityRead(game.payload, "spread");
  const moneyline = authorityRead(game.payload, "moneyline");
  const total = authorityRead(game.payload, "total");
  let margin = paid.projectedHomeMargin;
  let points = paid.projectedTotal;
  if (spread.side !== null && spread.tier > 0) {
    const target = -game.payload.market.current.spread!.homeLine + spread.side * 0.5;
    margin += weights[spread.tier - 1]! * (target - margin);
  }
  if (moneyline.side !== null && moneyline.tier > 0) {
    const target = moneyline.side * Math.max(1, Math.min(7, Math.abs(game.payload.market.current.spread!.homeLine)));
    margin += 0.5 * weights[moneyline.tier - 1]! * (target - margin);
  }
  const independentWinner = sign(paid.projectedHomeMargin);
  const proposedWinner = sign(margin);
  if (proposedWinner !== independentWinner) {
    const authorized = moneyline.side === proposedWinner && (
      moneyline.tier === 3 || moneyline.tier >= 2 && spread.tier >= 2 && spread.side === proposedWinner
    );
    if (!authorized) margin = independentWinner * 0.25;
  }
  if (total.side !== null && total.tier > 0) {
    const target = game.payload.market.current.total!.line + total.side * 0.5;
    points += weights[total.tier - 1]! * (target - points);
  }
  points = Math.max(points, Math.abs(margin) + 1);
  return { ...paid, projectedHomeMargin: margin, projectedTotal: points };
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function decisionResult(game: Game, market: Market, side: string, line: number | null): Result {
  const payload = game.payload;
  if (market === "moneyline") {
    const home = side === payload.game.home.abbreviation;
    return (home ? game.actualHome > game.actualAway : game.actualAway > game.actualHome) ? "win" : "loss";
  }
  if (line === null) throw new Error(`Missing ${market} line.`);
  const value = market === "spread"
    ? side === payload.game.home.abbreviation
      ? game.actualHome - game.actualAway + line
      : game.actualAway - game.actualHome + line
    : side.startsWith("Over")
      ? game.actualHome + game.actualAway - line
      : line - game.actualHome - game.actualAway;
  return value > 0 ? "win" : value < 0 ? "loss" : "push";
}

function projectionResult(replay: Replay, market: Market): Result {
  const { game, forecast } = replay;
  const margin = forecast.expectedHomeScore - forecast.expectedAwayScore;
  const total = forecast.expectedHomeScore + forecast.expectedAwayScore;
  const line = game.payload.market.current;
  const side = market === "moneyline"
    ? margin >= 0 ? 1 : -1
    : market === "spread"
      ? margin + line.spread!.homeLine >= 0 ? 1 : -1
      : total - line.total!.line >= 0 ? 1 : -1;
  const actual = market === "moneyline"
    ? game.actualHome - game.actualAway
    : market === "spread"
      ? game.actualHome - game.actualAway + line.spread!.homeLine
      : game.actualHome + game.actualAway - line.total!.line;
  return Math.abs(actual) < 1e-9 ? "push" : (actual >= 0 ? 1 : -1) === side ? "win" : "loss";
}

function replay(game: Game, variant: Variant): Replay {
  const payload = game.payload;
  if (!payload.paidProjectionShadow) throw new Error(`Missing paid projection ${payload.game.providerGameId}.`);
  const paidTeamScore = variant.tieredCenterWeights
    ? tieredPaidProjection(game, variant.tieredCenterWeights)
    : payload.paidProjectionShadow;
  const sequenceAuthority = variant.namedSequenceAuthority ? namedSequenceAuthority(game) : undefined;
  const professionalAuthority = variant.professionalMarketAuthority ? professionalMarketAuthority(game) : undefined;
  const opening: NflForwardOperationalOpening | null = variant.direction ? payload.market.operationalOpening : null;
  const publicSplits = variant.publicSplits ? payload.market.playbookSplits : null;
  const sharpSplits = variant.sharpSplits ? payload.market.sharpApiSplits : null;
  const shadowMoneyline = buildNflR6ShadowMoneylineDecision({
    game: payload.game,
    opening: payload.market.operationalOpening,
    comparableCurrentBooks: payload.market.comparableCurrentBooks,
    startersAndDepth: payload.startersAndDepth,
    injuries: payload.injuries,
    stage: payload.stage,
    capturedAt: payload.capturedAt,
    t60LagMinutes: payload.t60LagMinutes,
    coverageHealthHolds: payload.coverage.healthHolds,
  });
  const legacy = getNflV1WeekOneOutcomeForecast({
    providerGameId: payload.game.providerGameId,
    awayTeam: payload.game.away.abbreviation,
    homeTeam: payload.game.home.abbreviation,
    weeklyFallback: shadowMoneyline.footballProjection && payload.market.current.total
      ? { projectedHomeMargin: shadowMoneyline.footballProjection.projectedHomeMargin, marketTotal: payload.market.current.total.line }
      : undefined,
  });
  const base = buildNflPaidTeamScoreBaseForecast({ baseForecast: legacy, paidTeamScore });
  const incumbent = shadowMoneyline.footballProjection
    ? buildNflMarketEvidenceOutcomeForecast({
        baseForecast: base,
        footballHomeMargin: shadowMoneyline.footballProjection.projectedHomeMargin,
        current: payload.market.current,
        operationalOpening: opening,
        playbookLine: payload.market.playbookLine,
        playbookSplits: publicSplits,
        sharpSplits,
        spreadDirectionCandidate: variant.direction,
        totalDirectionCandidate: variant.direction,
        movementCurrent: variant.direction ? payload.market.current : null,
        paidTeamScore,
        namedSequenceAuthority: sequenceAuthority,
        professionalMarketAuthority: professionalAuthority,
        evaluatedAt: payload.capturedAt,
      })
    : base;
  const resolved = resolveNflTargetExcludedProduction({
    providerGameId: payload.game.providerGameId,
    awayTeam: payload.game.away.abbreviation,
    homeTeam: payload.game.home.abbreviation,
    gameStartsAt: payload.game.scheduledStart,
    evaluatedAt: payload.capturedAt,
    baseOutcome: base,
    incumbentOutcome: incumbent,
    current: payload.market.current,
    comparableCurrentBooks: payload.market.comparableCurrentBooks,
    operationalOpening: opening,
    shadowMoneyline,
    playbookLine: payload.market.playbookLine,
    playbookSplits: publicSplits,
    sharpSplits,
    pricedNeutralTotalCandidate: true,
    totalDirectionCandidate: variant.direction,
    paidTeamScore,
    namedSequenceAuthority: sequenceAuthority,
    namedSequenceAuthorityFactory: variant.exactSequenceExclusion
      ? (excludedFamiliesByMarket) => targetExcludedNamedSequenceAuthority(game, excludedFamiliesByMarket)
      : undefined,
    professionalMarketAuthority: professionalAuthority,
    professionalMarketAuthorityFactory: variant.professionalMarketAuthority
      ? (excludedFamiliesByMarket) => professionalMarketAuthority(game, excludedFamiliesByMarket)
      : undefined,
  });
  return { game, forecast: resolved.outcome, decisions: resolved.production.evaluatedBets };
}

function summarize(rows: Replay[]) {
  const score = rows.map((row) => {
    const margin = row.forecast.expectedHomeScore - row.forecast.expectedAwayScore;
    const total = row.forecast.expectedHomeScore + row.forecast.expectedAwayScore;
    return {
      teamError: (Math.abs(row.forecast.expectedHomeScore - row.game.actualHome) + Math.abs(row.forecast.expectedAwayScore - row.game.actualAway)) / 2,
      marginError: Math.abs(margin - (row.game.actualHome - row.game.actualAway)),
      totalError: Math.abs(total - (row.game.actualHome + row.game.actualAway)),
    };
  });
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const projection = Object.fromEntries(MARKETS.map((market) => {
    const results = rows.map((row) => projectionResult(row, market));
    const resolved = results.filter((value) => value !== "push");
    const wins = resolved.filter((value) => value === "win").length;
    return [market, { wins, losses: resolved.length - wins, pushes: results.length - resolved.length, accuracy: resolved.length ? wins / resolved.length : null }];
  }));
  const betting = Object.fromEntries(MARKETS.map((market) => {
    const decisions = rows.flatMap((row) => {
      const decision = row.decisions.find((candidate) => candidate.market === market);
      if (!decision) return [];
      return [{
        grade: decision.grade,
        result: decisionResult(row.game, market, decision.side, decision.evaluatedQuote.line),
        probability: decision.modelProbability,
        price: decision.evaluatedQuote.price,
      }];
    });
    const resolved = decisions.filter((value) => value.result !== "push");
    const wins = resolved.filter((value) => value.result === "win").length;
    const actionable = resolved.filter((value) => ACTIONABLE.has(value.grade));
    const actionableWins = actionable.filter((value) => value.result === "win").length;
    const brier = mean(resolved.map((value) => (value.probability - (value.result === "win" ? 1 : 0)) ** 2));
    const probabilityLogLoss = mean(resolved.map((value) => logLoss(value.probability, value.result === "win")));
    const exactPriceUnits = decisions.reduce((sum, value) => sum + units(value.result, value.price), 0);
    const actionableExactPriceUnits = actionable.reduce((sum, value) => sum + units(value.result, value.price), 0);
    return [market, {
      wins,
      losses: resolved.length - wins,
      pushes: decisions.length - resolved.length,
      accuracy: resolved.length ? wins / resolved.length : null,
      brier,
      logLoss: probabilityLogLoss,
      exactPriceUnits,
      actionable: actionable.length,
      actionableWins,
      actionableLosses: actionable.length - actionableWins,
      actionableAccuracy: actionable.length ? actionableWins / actionable.length : null,
      actionableExactPriceUnits,
      held: rows.length - decisions.length,
    }];
  }));
  const upsetRows = rows.map((row) => {
    const quote = row.game.payload.market.current.moneyline!;
    const homeImplied = quote.homePrice < 0 ? -quote.homePrice / (-quote.homePrice + 100) : 100 / (quote.homePrice + 100);
    const awayImplied = quote.awayPrice < 0 ? -quote.awayPrice / (-quote.awayPrice + 100) : 100 / (quote.awayPrice + 100);
    const marketFavorite = homeImplied >= awayImplied ? "home" : "away";
    const actualWinner = row.game.actualHome > row.game.actualAway ? "home" : "away";
    const projectedWinner = row.forecast.expectedHomeScore >= row.forecast.expectedAwayScore ? "home" : "away";
    const decision = row.decisions.find((value) => value.market === "moneyline") ?? null;
    const decisionSide = decision?.side === row.game.payload.game.home.abbreviation ? "home" : decision ? "away" : null;
    return {
      marketFavorite,
      actualWinner,
      projectedWinner,
      actualUpset: actualWinner !== marketFavorite,
      projectedUpset: projectedWinner !== marketFavorite,
      actionableUnderdog: decisionSide !== null && decisionSide !== marketFavorite && ACTIONABLE.has(decision!.grade),
      actionableUnderdogWon: decisionSide !== null && decisionSide !== marketFavorite && ACTIONABLE.has(decision!.grade) && decisionSide === actualWinner,
    };
  });
  const actualUpsets = upsetRows.filter((row) => row.actualUpset).length;
  const predictedUpsets = upsetRows.filter((row) => row.projectedUpset).length;
  const caughtUpsets = upsetRows.filter((row) => row.actualUpset && row.projectedUpset && row.actualWinner === row.projectedWinner).length;
  return {
    games: rows.length,
    projection,
    betting,
    score: {
      teamMae: mean(score.map((row) => row.teamError)),
      marginMae: mean(score.map((row) => row.marginError)),
      totalMae: mean(score.map((row) => row.totalError)),
    },
    upsetAwareness: {
      actualUpsets,
      predictedUpsets,
      caughtUpsets,
      missedUpsets: actualUpsets - caughtUpsets,
      falseUpsetCalls: predictedUpsets - caughtUpsets,
      precision: predictedUpsets ? caughtUpsets / predictedUpsets : null,
      recall: actualUpsets ? caughtUpsets / actualUpsets : null,
      marketFavoriteAccuracy: upsetRows.length ? (upsetRows.length - actualUpsets) / upsetRows.length : null,
      actionableUnderdogs: upsetRows.filter((row) => row.actionableUnderdog).length,
      actionableUnderdogWins: upsetRows.filter((row) => row.actionableUnderdogWon).length,
    },
    board: {
      decisions: Object.values(betting).reduce((sum, market) => sum + market.wins + market.losses + market.pushes, 0),
      actionables: Object.values(betting).reduce((sum, market) => sum + market.actionable, 0),
      actionableWins: Object.values(betting).reduce((sum, market) => sum + market.actionableWins, 0),
      actionableLosses: Object.values(betting).reduce((sum, market) => sum + market.actionableLosses, 0),
      exactPriceUnits: Object.values(betting).reduce((sum, market) => sum + market.exactPriceUnits, 0),
      actionableExactPriceUnits: Object.values(betting).reduce((sum, market) => sum + market.actionableExactPriceUnits, 0),
    },
  };
}

function compare(baseline: Replay[], candidate: Replay[]) {
  const baselineByGame = new Map(baseline.map((row) => [row.game.payload.game.providerGameId, row]));
  return Object.fromEntries(MARKETS.map((market) => {
    const changes = candidate.flatMap((row) => {
      const prior = baselineByGame.get(row.game.payload.game.providerGameId)!;
      const oldDecision = prior.decisions.find((value) => value.market === market);
      const newDecision = row.decisions.find((value) => value.market === market);
      if (!oldDecision || !newDecision) return [];
      const oldActionable = ACTIONABLE.has(oldDecision.grade);
      const newActionable = ACTIONABLE.has(newDecision.grade);
      const oldResult = decisionResult(row.game, market, oldDecision.side, oldDecision.evaluatedQuote.line);
      const newResult = decisionResult(row.game, market, newDecision.side, newDecision.evaluatedQuote.line);
      const sideChanged = oldDecision.side !== newDecision.side;
      return sideChanged || oldDecision.grade !== newDecision.grade ? [{
        game: `${row.game.payload.game.away.abbreviation}@${row.game.payload.game.home.abbreviation}`,
        fromSide: oldDecision.side,
        toSide: newDecision.side,
        fromGrade: oldDecision.grade,
        toGrade: newDecision.grade,
        oldResult,
        newResult,
        correction: sideChanged && oldResult === "loss" && newResult === "win",
        harm: sideChanged && oldResult === "win" && newResult === "loss",
        promotion: !oldActionable && newActionable,
        demotion: oldActionable && !newActionable,
      }] : [];
    });
    return [market, {
      changedRows: changes.length,
      sideChanges: changes.filter((row) => row.fromSide !== row.toSide).length,
      corrections: changes.filter((row) => row.correction).length,
      harms: changes.filter((row) => row.harm).length,
      promotions: changes.filter((row) => row.promotion).length,
      demotions: changes.filter((row) => row.demotion).length,
      rows: changes,
    }];
  }));
}

function forecastSide(row: Replay, market: Market): Side {
  const margin = row.forecast.expectedHomeScore - row.forecast.expectedAwayScore;
  if (market === "moneyline") return margin >= 0 ? 1 : -1;
  if (market === "spread") {
    return margin + row.game.payload.market.current.spread!.homeLine >= 0 ? 1 : -1;
  }
  const total = row.forecast.expectedHomeScore + row.forecast.expectedAwayScore;
  return total - row.game.payload.market.current.total!.line >= 0 ? 1 : -1;
}

function compareForecasts(baseline: Replay[], candidate: Replay[]) {
  const baselineByGame = new Map(baseline.map((row) => [row.game.payload.game.providerGameId, row]));
  return candidate.flatMap((row) => {
    const prior = baselineByGame.get(row.game.payload.game.providerGameId)!;
    const oldMargin = prior.forecast.expectedHomeScore - prior.forecast.expectedAwayScore;
    const newMargin = row.forecast.expectedHomeScore - row.forecast.expectedAwayScore;
    const oldTotal = prior.forecast.expectedHomeScore + prior.forecast.expectedAwayScore;
    const newTotal = row.forecast.expectedHomeScore + row.forecast.expectedAwayScore;
    const changedMarkets = MARKETS.filter((market) => forecastSide(prior, market) !== forecastSide(row, market));
    if (Math.abs(oldMargin - newMargin) < 1e-9 && Math.abs(oldTotal - newTotal) < 1e-9) return [];
    return [{
      game: `${row.game.payload.game.away.abbreviation}@${row.game.payload.game.home.abbreviation}`,
      actual: `${row.game.actualAway}-${row.game.actualHome}`,
      authority: namedSequenceAuthority(row.game),
      oldScore: `${prior.forecast.expectedAwayScore.toFixed(3)}-${prior.forecast.expectedHomeScore.toFixed(3)}`,
      newScore: `${row.forecast.expectedAwayScore.toFixed(3)}-${row.forecast.expectedHomeScore.toFixed(3)}`,
      oldMargin,
      newMargin,
      oldTotal,
      newTotal,
      changedMarkets,
      marketResults: Object.fromEntries(changedMarkets.map((market) => [market, {
        old: projectionResult(prior, market),
        next: projectionResult(row, market),
        oldDecision: prior.decisions.find((decision) => decision.market === market) ?? null,
        nextDecision: row.decisions.find((decision) => decision.market === market) ?? null,
      }])),
    }];
  });
}

function decisionSide(game: Game, market: Market, side: string): Side {
  if (market === "total") return side.startsWith("Over") ? 1 : -1;
  return side === game.payload.game.home.abbreviation ? 1 : -1;
}

function exactAuthorityExclusions(game: Game): Record<Market, string[]> {
  const evaluatedBook = (market: Market) => game.payload.decisions.evaluatedBets
    .find((decision) => decision.market === market)?.evaluatedQuote.sportsbook ?? game.payload.market.current.sportsbook;
  const margin = [...new Set([evaluatedBook("moneyline"), evaluatedBook("spread")])];
  return { moneyline: margin, spread: margin, total: [evaluatedBook("total")] };
}

function lossReview(independent: Replay[], final: Replay[]) {
  const independentByGame = new Map(independent.map((row) => [row.game.payload.game.providerGameId, row]));
  const rows = final.flatMap((row) => MARKETS.flatMap((market) => {
    const finalDecision = row.decisions.find((decision) => decision.market === market);
    if (!finalDecision) return [];
    const finalResult = decisionResult(row.game, market, finalDecision.side, finalDecision.evaluatedQuote.line);
    if (finalResult !== "loss") return [];
    const baseline = independentByGame.get(row.game.payload.game.providerGameId)!;
    const independentDecision = baseline.decisions.find((decision) => decision.market === market) ?? null;
    const independentResult = independentDecision
      ? decisionResult(row.game, market, independentDecision.side, independentDecision.evaluatedQuote.line)
      : null;
    const finalSide = decisionSide(row.game, market, finalDecision.side);
    const independentSide = independentDecision ? decisionSide(row.game, market, independentDecision.side) : null;
    const authority = professionalMarketAuthority(row.game, exactAuthorityExclusions(row.game));
    const authorityName = authority.reads[market].side;
    const authoritySide = authorityName === "home" || authorityName === "over" ? 1
      : authorityName === "away" || authorityName === "under" ? -1 : null;
    const signals = [
      { family: "selected_same_book_movement", side: selectedMovementSide(row.game.payload, market) },
      { family: "named_book_consensus", side: bookConsensusSide(row.game.payload, market, true) },
      { family: "all_book_consensus", side: bookConsensusSide(row.game.payload, market, false) },
      { family: "named_money_ticket_gap", side: splitSide(row.game.payload, market, "sharp") },
      { family: "public_money_ticket_gap", side: splitSide(row.game.payload, market, "public") },
      { family: "qualified_professional_authority", side: authoritySide },
    ].filter((signal): signal is { family: string; side: Side } => signal.side !== null);
    const confirming = signals.filter((signal) => signal.side === finalSide).map((signal) => signal.family);
    const contrary = signals.filter((signal) => signal.side === -finalSide).map((signal) => signal.family);
    const sideChanged = independentSide !== null && independentSide !== finalSide;
    const marketCausedHarm = sideChanged && independentResult === "win";
    const independentActionable = independentDecision ? ACTIONABLE.has(independentDecision.grade) : false;
    const finalActionable = ACTIONABLE.has(finalDecision.grade);
    const promotionLoss = !sideChanged && !independentActionable && finalActionable;
    const category = marketCausedHarm
      ? "market_induced_side_harm"
      : promotionLoss
        ? "market_promotion_loss"
        : authoritySide === finalSide
          ? "qualified_market_signal_lost"
          : contrary.includes("qualified_professional_authority")
            ? "qualified_signal_not_reflected"
            : contrary.length > 0
              ? "unqualified_contrary_signal_available"
              : confirming.length > 0
                ? "lower_tier_market_confirmation_lost"
                : "no_usable_market_correction";
    return [{
      game: `${row.game.payload.game.away.abbreviation}@${row.game.payload.game.home.abbreviation}`,
      market,
      category,
      finalSide: finalDecision.side,
      finalGrade: finalDecision.grade,
      finalPrice: finalDecision.evaluatedQuote.price,
      independentSide: independentDecision?.side ?? null,
      independentGrade: independentDecision?.grade ?? null,
      independentResult,
      sideChanged,
      marketCausedHarm,
      promotionLoss,
      confirmingSignals: confirming,
      contrarySignals: contrary,
      authority: authority.reads[market],
    }];
  }));
  return {
    losses: rows.length,
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, rows.filter((row) => row.market === market).length])),
    byCategory: Object.fromEntries([...new Set(rows.map((row) => row.category))].sort().map((category) => [
      category,
      rows.filter((row) => row.category === category).length,
    ])),
    rows,
  };
}

function decisionLedger(independent: Replay[], current: Replay[], final: Replay[]) {
  const independentByGame = new Map(independent.map((row) => [row.game.payload.game.providerGameId, row]));
  const currentByGame = new Map(current.map((row) => [row.game.payload.game.providerGameId, row]));
  const serialize = (row: Replay, market: Market) => {
    const decision = row.decisions.find((candidate) => candidate.market === market);
    if (!decision) return null;
    return {
      side: decision.side,
      grade: decision.grade,
      probability: decision.modelProbability,
      price: decision.evaluatedQuote.price,
      line: decision.evaluatedQuote.line,
      result: decisionResult(row.game, market, decision.side, decision.evaluatedQuote.line),
      actionable: ACTIONABLE.has(decision.grade),
    };
  };
  return final.flatMap((row) => MARKETS.map((market) => {
    const gameId = row.game.payload.game.providerGameId;
    const authority = professionalMarketAuthority(row.game, exactAuthorityExclusions(row.game));
    return {
      game: `${row.game.payload.game.away.abbreviation}@${row.game.payload.game.home.abbreviation}`,
      market,
      independent: serialize(independentByGame.get(gameId)!, market),
      incumbent: serialize(currentByGame.get(gameId)!, market),
      final: serialize(row, market),
      selectedMovementSide: selectedMovementSide(row.game.payload, market),
      namedBookConsensusSide: bookConsensusSide(row.game.payload, market, true),
      allBookConsensusSide: bookConsensusSide(row.game.payload, market, false),
      namedSplitSide: splitSide(row.game.payload, market, "sharp"),
      publicSplitSide: splitSide(row.game.payload, market, "public"),
      authority: authority.reads[market],
    };
  }));
}

function constrainedProjectionSummary(current: Replay[], strength: number) {
  const buffer = 0.001;
  const rows = current.map((row) => {
    const paid = row.game.payload.paidProjectionShadow!;
    const currentMargin = row.forecast.expectedHomeScore - row.forecast.expectedAwayScore;
    const currentTotal = row.forecast.expectedHomeScore + row.forecast.expectedAwayScore;
    let margin = paid.projectedHomeMargin + strength * (currentMargin - paid.projectedHomeMargin);
    let total = paid.projectedTotal + strength * (currentTotal - paid.projectedTotal);
    const currentWinner = currentMargin >= 0 ? 1 : -1;
    const currentSpread = currentMargin + row.game.payload.market.current.spread!.homeLine >= 0 ? 1 : -1;
    const currentTotalSide = currentTotal - row.game.payload.market.current.total!.line >= 0 ? 1 : -1;
    const homeLine = row.game.payload.market.current.spread!.homeLine;
    const totalLine = row.game.payload.market.current.total!.line;
    const lower = Math.max(
      currentWinner === 1 ? buffer : -Infinity,
      currentSpread === 1 ? -homeLine + buffer : -Infinity,
    );
    const upper = Math.min(
      currentWinner === -1 ? -buffer : Infinity,
      currentSpread === -1 ? -homeLine - buffer : Infinity,
    );
    margin = Math.min(upper, Math.max(lower, margin));
    total = currentTotalSide === 1 ? Math.max(total, totalLine + buffer) : Math.min(total, totalLine - buffer);
    const expectedHome = (total + margin) / 2;
    const expectedAway = (total - margin) / 2;
    return { row, margin, total, expectedHome, expectedAway };
  });
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  return {
    strength,
    directionPreserved: Object.fromEntries(MARKETS.map((market) => [market, rows.every(({ row, margin, total }) => {
      const currentResult = market === "moneyline"
        ? (row.forecast.expectedHomeScore - row.forecast.expectedAwayScore >= 0 ? 1 : -1)
        : market === "spread"
          ? (row.forecast.expectedHomeScore - row.forecast.expectedAwayScore + row.game.payload.market.current.spread!.homeLine >= 0 ? 1 : -1)
          : (row.forecast.expectedHomeScore + row.forecast.expectedAwayScore - row.game.payload.market.current.total!.line >= 0 ? 1 : -1);
      const candidateResult = market === "moneyline" ? (margin >= 0 ? 1 : -1)
        : market === "spread" ? (margin + row.game.payload.market.current.spread!.homeLine >= 0 ? 1 : -1)
        : (total - row.game.payload.market.current.total!.line >= 0 ? 1 : -1);
      return currentResult === candidateResult;
    })])),
    score: {
      teamMae: mean(rows.map(({ row, expectedHome, expectedAway }) =>
        (Math.abs(expectedHome - row.game.actualHome) + Math.abs(expectedAway - row.game.actualAway)) / 2)),
      marginMae: mean(rows.map(({ row, margin }) => Math.abs(margin - (row.game.actualHome - row.game.actualAway)))),
      totalMae: mean(rows.map(({ row, total }) => Math.abs(total - (row.game.actualHome + row.game.actualAway)))),
    },
  };
}

async function main() {
  const read = await supabase.from("prediction_records")
    .select("id,market,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
    .eq("sport", "nfl")
    .not("locked_at", "is", null)
    .in("market", MARKETS)
    .order("id", { ascending: true });
  if (read.error) throw new Error(read.error.message);
  const all = (read.data ?? []) as unknown as RecordRow[];
  const records = all.filter((row) => typeof row.snapshot_json?.supersedes_prediction_record_id !== "number");
  const byHash = new Map<string, RecordRow[]>();
  for (const record of records) {
    const hash = record.snapshot_json?.evidence_payload_sha256;
    if (typeof hash === "string") byHash.set(hash, [...(byHash.get(hash) ?? []), record]);
  }
  const hashes = [...byHash.keys()];
  const history = (await Promise.all([3, 4, 5].map((week) => readNflForwardEvidence({ client: supabase, season: 2026, week })))).flat();
  const evidenceRead = await supabase.from("nfl_forward_evidence_snapshots").select("payload_sha256,payload").in("payload_sha256", hashes);
  if (evidenceRead.error) throw new Error(evidenceRead.error.message);
  const games = (evidenceRead.data ?? []).flatMap((row): Game[] => {
    const payload = row.payload as NflForwardEvidencePayload;
    if (!payload.paidProjectionShadow) return [];
    if (hashNflForwardEvidencePayload(payload) !== row.payload_sha256) throw new Error(`Checksum mismatch ${row.payload_sha256}.`);
    const related = byHash.get(row.payload_sha256) ?? [];
    const grade = one(related[0]?.prediction_grades ?? null);
    if (!grade) return [];
    return [{
      payload,
      actualHome: grade.actual_home_score,
      actualAway: grade.actual_away_score,
      histories: history.filter((candidate) =>
        candidate.providerGameId === payload.game.providerGameId && candidate.capturedAt <= payload.capturedAt),
    }];
  }).sort((a, b) => a.payload.game.scheduledStart.localeCompare(b.payload.game.scheduledStart));
  if (games.length < 18) throw new Error(`Expected at least 18 paid-projection games; got ${games.length}.`);
  const replays = Object.fromEntries(Object.entries(VARIANTS).map(([name, variant]) => [name, games.map((game) => replay(game, variant))]));
  const current = replays.current!;
  const independent = replays.independentOnly!;
  const marketStateIdentity = replays.marketStateIdentityOnly!;
  const report = {
    release: "nfl_2026_paid_reconciliation_component_tournament_r1",
    readOnly: true,
    writes: 0,
    games: games.length,
    sharpSplitGames: games.filter((game) => game.payload.market.sharpApiSplits).length,
    variants: Object.fromEntries(Object.entries(replays).map(([name, rows]) => [name, {
      summary: summarize(rows),
      versusCurrent: name === "current" ? null : compare(current, rows),
      versusIndependent: name === "independentOnly" ? null : compare(independent, rows),
      forecastVersusCurrent: name === "current" ? null : compareForecasts(current, rows),
      versusMarketStateIdentity: name !== "professionalMarketReader" ? null : compare(marketStateIdentity, rows),
      forecastVersusMarketStateIdentity: name !== "professionalMarketReader"
        ? null
        : compareForecasts(marketStateIdentity, rows),
    }])),
    constrainedProjectionSensitivity: [0, 0.25, 0.5, 0.75].map((strength) =>
      constrainedProjectionSummary(current, strength)),
    professionalLossReview: lossReview(independent, replays.professionalMarketReader!),
    professionalDecisionLedger: decisionLedger(independent, current, replays.professionalMarketReader!),
  };
  if (process.env.NFL_MARKET_AUDIT_AUTHORITY_ONLY === "1") {
    console.log(JSON.stringify(games.map((game) => ({
      game: `${game.payload.game.away.abbreviation}@${game.payload.game.home.abbreviation}`,
      authority: namedSequenceAuthority(game),
    })), null, 2));
    return;
  }
  if (process.argv.includes("--professional-authority")) {
    console.log(JSON.stringify(games.map((game) => ({
      game: `${game.payload.game.away.abbreviation}@${game.payload.game.home.abbreviation}`,
      authority: professionalMarketAuthority(game, {
        moneyline: [game.payload.decisions.evaluatedBets.find((decision) => decision.market === "moneyline")?.evaluatedQuote.sportsbook ?? game.payload.market.current.sportsbook],
        spread: [game.payload.decisions.evaluatedBets.find((decision) => decision.market === "spread")?.evaluatedQuote.sportsbook ?? game.payload.market.current.sportsbook],
        total: [game.payload.decisions.evaluatedBets.find((decision) => decision.market === "total")?.evaluatedQuote.sportsbook ?? game.payload.market.current.sportsbook],
      }),
    })), null, 2));
    return;
  }
  if (process.env.NFL_MARKET_AUDIT_STATE_ONLY === "1") {
    console.log(JSON.stringify(games.map((game) => ({
      game: `${game.payload.game.away.abbreviation}@${game.payload.game.home.abbreviation}`,
      state: Object.fromEntries(MARKETS.map((market) => [market, marketState(game, market)])),
    })), null, 2));
    return;
  }
  if (process.env.NFL_MARKET_AUDIT_CANDIDATE_ONLY === "1") {
    console.log(JSON.stringify({
      current: report.variants.current,
      namedSequenceOverride: report.variants.namedSequenceOverride,
    }, null, 2));
    return;
  }
  if (process.env.NFL_MARKET_AUDIT_R29_ONLY === "1") {
    const names = [
      "current",
      "namedSequenceOverride",
      "marketStateIdentityOnly",
      "professionalMarketReader",
    ];
    console.log(JSON.stringify(Object.fromEntries(names.map((name) => [name, report.variants[name]])), null, 2));
    return;
  }
  if (process.argv.includes("--professional")) {
    const names = ["current", "marketStateIdentityOnly", "professionalMarketReader"];
    console.log(JSON.stringify(Object.fromEntries(names.map((name) => [name, report.variants[name]])), null, 2));
    return;
  }
  if (process.env.NFL_MARKET_AUDIT_SUMMARY_ONLY === "1") {
    console.log(JSON.stringify({
      games: report.games,
      sharpSplitGames: report.sharpSplitGames,
      professionalLossReview: report.professionalLossReview,
      professionalDecisionLedger: report.professionalDecisionLedger,
      variants: Object.fromEntries(Object.entries(report.variants).map(([name, value]) => [name, {
        summary: value.summary,
        impact: value.versusCurrent && Object.fromEntries(Object.entries(value.versusCurrent).map(([market, impact]) => [market, {
          changedRows: impact.changedRows,
          sideChanges: impact.sideChanges,
          corrections: impact.corrections,
          harms: impact.harms,
          promotions: impact.promotions,
          demotions: impact.demotions,
        }])),
        impactVersusIndependent: value.versusIndependent && Object.fromEntries(
          Object.entries(value.versusIndependent).map(([market, impact]) => [market, {
            changedRows: impact.changedRows,
            sideChanges: impact.sideChanges,
            corrections: impact.corrections,
            harms: impact.harms,
            netCorrections: impact.corrections - impact.harms,
            promotions: impact.promotions,
            demotions: impact.demotions,
          }]),
        ),
        forecastChanges: name === "namedSequenceOverride" ? value.forecastVersusCurrent : undefined,
      }])),
    }, null, 2));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
