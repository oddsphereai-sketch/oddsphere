/** SELECT-only component ablation for the current paid NFL model/market reconciliation. */

import { readFileSync } from "node:fs";

import { supabase } from "@/lib/db/supabase";
import {
  buildNflIndependentScoreBaseForecast,
  buildNflMarketEvidenceOutcomeForecast,
  buildNflNoWeightMarketEvidenceOutcomeForecast,
  buildNflPaidTeamScoreBaseForecast,
  getNflV1WeekOneOutcomeForecast,
  type NflV1WeekOneOutcomeForecast,
} from "@/lib/services/football/nflV1WeekOneOutcome";
import { buildNflR6ShadowMoneylineDecision } from "@/lib/services/football/nflR6MoneylineShadow";
import { buildNflV1ActionableGradeBundle } from "@/lib/services/football/nflV1ActionableGradeCandidate";
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
import { buildNflThreeStateMarketAuthority } from "@/lib/services/football/nflThreeStateMarketReader";

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
  exactProviderScore?: boolean;
  preferExactProviderScore?: boolean;
  noWeightMarketReader?: boolean;
  corroboratedMoneylineAuthority?: boolean;
  moneylineOutcomeBoundary?: boolean;
  moneylineValueSpreadBoundary?: boolean;
  threeStateSpreadPromotion?: boolean;
  productionThreeStateReader?: boolean;
  legacyProductionThreeStateReader?: boolean;
  currentProductionThreeStateReader?: boolean;
};
type Side = -1 | 1;
type AuthorityRead = { side: Side | null; tier: 0 | 1 | 2 | 3; families: string[]; conflicts: string[] };
type Game = {
  payload: NflForwardEvidencePayload;
  actualHome: number;
  actualAway: number;
  histories: NflForwardStoredEvidence[];
  exactProviderScore: { margin: number; total: number } | null;
};
type Replay = {
  game: Game;
  forecast: NflV1WeekOneOutcomeForecast;
  decisions: NflForwardEvidencePayload["decisions"]["evaluatedBets"];
};

function preserveNonActionableMoneylineGradeOnFlip(
  incumbentRows: Replay[],
  candidateRows: Replay[],
): Replay[] {
  const incumbentByGame = new Map(incumbentRows.map((row) => [row.game.payload.game.providerGameId, row]));
  return candidateRows.map((row) => {
    const incumbent = incumbentByGame.get(row.game.payload.game.providerGameId);
    if (!incumbent) return row;
    const incumbentMoneyline = incumbent.decisions.find((decision) => decision.market === "moneyline");
    const candidateMoneyline = row.decisions.find((decision) => decision.market === "moneyline");
    if (!incumbentMoneyline || !candidateMoneyline) return row;
    if (incumbentMoneyline.side === candidateMoneyline.side) return row;
    if (ACTIONABLE.has(incumbentMoneyline.grade) || !ACTIONABLE.has(candidateMoneyline.grade)) return row;
    return {
      ...row,
      decisions: row.decisions.map((decision) => decision.market === "moneyline"
        ? { ...decision, grade: incumbentMoneyline.grade }
        : decision),
    };
  });
}

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
  exactIndependent: {
    publicSplits: false, sharpSplits: false, direction: false,
    exactProviderScore: true, noWeightMarketReader: true,
  },
  exactProfessionalNoWeight: {
    publicSplits: true, sharpSplits: true, direction: true,
    professionalMarketAuthority: true, exactProviderScore: true, noWeightMarketReader: true,
  },
  exactCorroboratedMoneylineNoWeight: {
    publicSplits: true, sharpSplits: true, direction: true,
    professionalMarketAuthority: true, exactProviderScore: true, noWeightMarketReader: true,
    corroboratedMoneylineAuthority: true,
  },
  exactCorroboratedMoneylineOutcomeBoundaryNoWeight: {
    publicSplits: true, sharpSplits: true, direction: true,
    professionalMarketAuthority: true, exactProviderScore: true, noWeightMarketReader: true,
    corroboratedMoneylineAuthority: true, moneylineOutcomeBoundary: true,
  },
  exactCorroboratedMoneylineThreeStateNoWeight: {
    publicSplits: true, sharpSplits: true, direction: true,
    professionalMarketAuthority: true, exactProviderScore: true, noWeightMarketReader: true,
    corroboratedMoneylineAuthority: true, moneylineOutcomeBoundary: true,
    moneylineValueSpreadBoundary: true,
  },
  exactCorroboratedMoneylineThreeStatePromotedNoWeight: {
    publicSplits: true, sharpSplits: true, direction: true,
    professionalMarketAuthority: true, exactProviderScore: true, noWeightMarketReader: true,
    corroboratedMoneylineAuthority: true, moneylineOutcomeBoundary: true,
    moneylineValueSpreadBoundary: true, threeStateSpreadPromotion: true,
  },
  exactProductionThreeStateNoWeight: {
    publicSplits: true, sharpSplits: true, direction: true,
    professionalMarketAuthority: true, exactProviderScore: true, noWeightMarketReader: true,
    productionThreeStateReader: true,
  },
  exactLegacyProductionThreeStateNoWeight: {
    publicSplits: true, sharpSplits: true, direction: true,
    professionalMarketAuthority: true, exactProviderScore: true, noWeightMarketReader: true,
    productionThreeStateReader: true, legacyProductionThreeStateReader: true,
  },
  settledProductionThreeStateNoWeight: {
    publicSplits: true, sharpSplits: true, direction: true,
    professionalMarketAuthority: true, noWeightMarketReader: true, preferExactProviderScore: true,
    productionThreeStateReader: true,
  },
  settledCurrentProductionThreeStateNoWeight: {
    publicSplits: true, sharpSplits: true, direction: true,
    professionalMarketAuthority: true, noWeightMarketReader: true, preferExactProviderScore: true,
    productionThreeStateReader: true, currentProductionThreeStateReader: true,
  },
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

function targetExcludedCorroboratedSide(game: Game, market: "moneyline" | "spread"): Side | null {
  const state = buildNflMarketState({
    market,
    evaluatedAt: game.payload.capturedAt,
    snapshots: game.histories.flatMap((row) => row.payload.contextualEvidenceCapture
      ? [{ capturedAt: row.capturedAt, markets: row.payload.contextualEvidenceCapture.markets }]
      : []),
    excludedFamilies: exactAuthorityExclusions(game)[market],
    current: game.payload.market.current,
    playbookLine: game.payload.market.playbookLine,
    playbookSplits: game.payload.market.playbookSplits,
    sharpSplits: game.payload.market.sharpApiSplits,
  });
  const stableNamed = state.trails.filter((trail) => trail.sourceClass === "named" &&
    trail.direction !== null && trail.persistenceTimeShare >= 2 / 3 &&
    trail.reversalMagnitude === 0 && !trail.buybackToOpening &&
    (market === "moneyline" || trail.numberDirection !== null && trail.priceDirection === trail.numberDirection));
  if (stableNamed.length === 0 || new Set(stableNamed.map((trail) => trail.direction)).size !== 1) return null;
  const direction = stableNamed[0]!.direction!;
  if (state.splits.some((split) => split.direction === -direction)) return null;
  const namedSources = new Set(stableNamed.map((trail) => normalizeSportsbook(trail.source)));
  const independentlyConfirmed = state.splits.some((split) => split.direction === direction &&
    (split.sportsbook === null || !namedSources.has(normalizeSportsbook(split.sportsbook))));
  return independentlyConfirmed ? direction : null;
}

function targetExcludedMoneylineOutcomeSide(game: Game): Side | null {
  const evaluatedAt = Date.parse(game.payload.capturedAt);
  const freshnessMs = 120 * 60_000;
  const excluded = new Set(exactAuthorityExclusions(game).moneyline.map(normalizeSportsbook));
  const latestByFamily = new Map<string, NflForwardEvidencePayload["market"]["comparableCurrentBooks"][number]>();
  for (const book of game.payload.market.comparableCurrentBooks) {
    const family = normalizeSportsbook(book.sportsbook);
    const observedAt = Date.parse(book.observedAt);
    if (excluded.has(family) || !book.moneyline || !Number.isFinite(observedAt) ||
        Math.abs(evaluatedAt - observedAt) > freshnessMs) continue;
    const incumbent = latestByFamily.get(family);
    if (!incumbent || incumbent.observedAt < book.observedAt) latestByFamily.set(family, book);
  }
  if (latestByFamily.size < 3) return null;
  const probabilities = [...latestByFamily.values()].map((book) => {
    const home = implied(book.moneyline!.homePrice);
    const away = implied(book.moneyline!.awayPrice);
    return home / (home + away);
  }).sort((a, b) => a - b);
  const middle = Math.floor(probabilities.length / 2);
  const probability = probabilities.length % 2 === 1
    ? probabilities[middle]!
    : (probabilities[middle - 1]! + probabilities[middle]!) / 2;
  return Math.abs(probability - 0.5) < 1e-9 ? null : sign(probability - 0.5);
}

function targetExcludedSpreadBoundary(game: Game): number | null {
  const evaluatedAt = Date.parse(game.payload.capturedAt);
  const freshnessMs = 120 * 60_000;
  const excluded = new Set(exactAuthorityExclusions(game).spread.map(normalizeSportsbook));
  const latestByFamily = new Map<string, NflForwardEvidencePayload["market"]["comparableCurrentBooks"][number]>();
  for (const book of game.payload.market.comparableCurrentBooks) {
    const family = normalizeSportsbook(book.sportsbook);
    const observedAt = Date.parse(book.observedAt);
    if (excluded.has(family) || !book.spread || !Number.isFinite(observedAt) ||
        Math.abs(evaluatedAt - observedAt) > freshnessMs) continue;
    const incumbent = latestByFamily.get(family);
    if (!incumbent || incumbent.observedAt < book.observedAt) latestByFamily.set(family, book);
  }
  if (latestByFamily.size < 3) return null;
  const boundaries = [...latestByFamily.values()].map((book) => -book.spread!.homeLine).sort((a, b) => a - b);
  const middle = Math.floor(boundaries.length / 2);
  return boundaries.length % 2 === 1
    ? boundaries[middle]!
    : (boundaries[middle - 1]! + boundaries[middle]!) / 2;
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

function projectionResult(replay: Replay, market: Market, cushion = 0): Result {
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
  const sideAdjusted = side * actual + cushion;
  return Math.abs(sideAdjusted) < 1e-9 ? "push" : sideAdjusted > 0 ? "win" : "loss";
}

function replay(game: Game, variant: Variant): Replay {
  const payload = game.payload;
  const exactProvider = variant.exactProviderScore || variant.preferExactProviderScore
    ? game.exactProviderScore
    : null;
  if (variant.exactProviderScore && !exactProvider) {
    throw new Error(`Missing exact-provider parity score ${payload.game.providerGameId}.`);
  }
  if (!variant.exactProviderScore && !payload.paidProjectionShadow) {
    throw new Error(`Missing paid projection ${payload.game.providerGameId}.`);
  }
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
  const base = exactProvider
    ? buildNflIndependentScoreBaseForecast({
        baseForecast: legacy,
        independentScore: {
          expectedHomeMargin: exactProvider.margin,
          expectedTotal: exactProvider.total,
          marketInputPolicy: "prohibited_from_independent_score",
        },
      })
    : buildNflPaidTeamScoreBaseForecast({ baseForecast: legacy, paidTeamScore: paidTeamScore! });
  const marketOutcomeBuilder = variant.noWeightMarketReader
    ? buildNflNoWeightMarketEvidenceOutcomeForecast
    : buildNflMarketEvidenceOutcomeForecast;
  const incumbent = shadowMoneyline.footballProjection
    ? marketOutcomeBuilder({
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
        ...(paidTeamScore ? { paidTeamScore } : {}),
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
    ...(paidTeamScore ? { paidTeamScore } : {}),
    namedSequenceAuthority: sequenceAuthority,
    namedSequenceAuthorityFactory: variant.exactSequenceExclusion
      ? (excludedFamiliesByMarket) => targetExcludedNamedSequenceAuthority(game, excludedFamiliesByMarket)
      : undefined,
    professionalMarketAuthority: professionalAuthority,
    professionalMarketAuthorityFactory: variant.professionalMarketAuthority
      ? (excludedFamiliesByMarket) => professionalMarketAuthority(game, excludedFamiliesByMarket)
      : undefined,
    threeStateMarketAuthorityFactory: variant.productionThreeStateReader
      ? (excludedFamiliesByMarket) => {
        const authority = buildNflThreeStateMarketAuthority({
          evaluatedAt: payload.capturedAt,
          snapshots: game.histories.flatMap((row) => row.payload.contextualEvidenceCapture
            ? [{ capturedAt: row.capturedAt, markets: row.payload.contextualEvidenceCapture.markets }]
            : []),
          current: payload.market.current,
          comparableCurrentBooks: payload.market.comparableCurrentBooks,
          playbookLine: payload.market.playbookLine,
          playbookSplits: payload.market.playbookSplits,
          sharpSplits: payload.market.sharpApiSplits,
          excludedFamilies: excludedFamiliesByMarket.moneyline,
        });
        return (variant.legacyProductionThreeStateReader &&
          authority.reason === "qualified_named_price_and_two_source_flow") ||
          (variant.currentProductionThreeStateReader &&
            authority.reason === "qualified_named_price_flow_and_cross_market_consensus")
          ? { ...authority, status: "unavailable" as const, reason: "no_independent_flow_confirmation" as const,
              side: null, outcomeBoundarySide: null, spreadBoundary: null,
              namedSources: [], confirmingSplitSources: [] }
          : authority;
      }
      : undefined,
    ...(variant.noWeightMarketReader ? {
      marketOutcomeBuilder: buildNflNoWeightMarketEvidenceOutcomeForecast,
      fallbackOutcome: base,
    } : {}),
    suppressNuancedMarginOverlay: variant.currentProductionThreeStateReader,
  });
  if (!variant.corroboratedMoneylineAuthority) {
    return { game, forecast: resolved.outcome, decisions: resolved.production.evaluatedBets };
  }
  const authoritySide = targetExcludedCorroboratedSide(game, "moneyline");
  const outcomeAuthoritySide = variant.moneylineOutcomeBoundary
    ? targetExcludedMoneylineOutcomeSide(game)
    : authoritySide;
  const qualifiedAuthoritySide = authoritySide !== null && outcomeAuthoritySide === authoritySide
    ? authoritySide
    : null;
  const resolvedMargin = resolved.outcome.expectedHomeScore - resolved.outcome.expectedAwayScore;
  const resolvedTotal = resolved.outcome.expectedHomeScore + resolved.outcome.expectedAwayScore;
  let correctedMargin = qualifiedAuthoritySide !== null && qualifiedAuthoritySide !== sign(resolvedMargin)
    ? -resolvedMargin
    : resolvedMargin;
  const valueResistance = variant.moneylineValueSpreadBoundary && authoritySide !== null &&
    authoritySide !== sign(resolvedMargin) && qualifiedAuthoritySide === null;
  if (valueResistance) {
    const boundary = targetExcludedSpreadBoundary(game);
    if (boundary !== null && authoritySide !== sign(resolvedMargin - boundary)) {
      const spreadCorrectedMargin = 2 * boundary - resolvedMargin;
      if (sign(spreadCorrectedMargin) === sign(resolvedMargin)) correctedMargin = spreadCorrectedMargin;
    }
  }
  const correctedBase = buildNflIndependentScoreBaseForecast({
    baseForecast: resolved.outcome,
    independentScore: {
      expectedHomeMargin: correctedMargin,
      expectedTotal: resolvedTotal,
      marketInputPolicy: "prohibited_from_independent_score",
    },
  });
  const forecast: NflV1WeekOneOutcomeForecast = {
    ...resolved.outcome,
    ...correctedBase,
    marketEvidence: resolved.outcome.marketEvidence,
    targetExclusion: resolved.outcome.targetExclusion,
    noWeightMarketReader: resolved.outcome.noWeightMarketReader,
  };
  const production = buildNflV1ActionableGradeBundle({
    providerGameId: payload.game.providerGameId,
    awayTeam: payload.game.away.abbreviation,
    homeTeam: payload.game.home.abbreviation,
    gameStartsAt: payload.game.scheduledStart,
    current: payload.market.current,
    comparableCurrentBooks: payload.market.comparableCurrentBooks,
    shadowMoneyline,
    outcomeForecast: forecast,
  });
  const decisions = production.evaluatedBets.map((decision) => {
    if (!valueResistance || decision.market !== "moneyline" || !ACTIONABLE.has(decision.grade)) return decision;
    return { ...decision, grade: "Watchlist" as const };
  }).map((decision) => {
    const spreadChanged = Math.abs(correctedMargin - resolvedMargin) > 1e-9;
    if (!variant.threeStateSpreadPromotion || !valueResistance || !spreadChanged || decision.market !== "spread" ||
        decision.grade !== "Watchlist" || decisionSide(game, "spread", decision.side) !== authoritySide ||
        decision.expectedValue < 0 || decision.modelProbability < decision.marketFairProbability) return decision;
    return { ...decision, grade: "Lean" as const };
  });
  return { game, forecast, decisions };
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
    const alternateLines = market === "moneyline" ? null : Object.fromEntries([3, 6].map((cushion) => {
      const alternateResults = rows.map((row) => projectionResult(row, market, cushion));
      const alternateResolved = alternateResults.filter((value) => value !== "push");
      const alternateWins = alternateResolved.filter((value) => value === "win").length;
      return [`plus${cushion}`, {
        wins: alternateWins,
        losses: alternateResolved.length - alternateWins,
        pushes: alternateResults.length - alternateResolved.length,
        accuracy: alternateResolved.length ? alternateWins / alternateResolved.length : null,
      }];
    }));
    return [market, {
      wins,
      losses: resolved.length - wins,
      pushes: results.length - resolved.length,
      accuracy: resolved.length ? wins / resolved.length : null,
      alternateLines,
    }];
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
        fromProbability: oldDecision.modelProbability,
        toProbability: newDecision.modelProbability,
        fromPrice: oldDecision.evaluatedQuote.price,
        toPrice: newDecision.evaluatedQuote.price,
        fromExpectedValue: oldDecision.expectedValue,
        toExpectedValue: newDecision.expectedValue,
        fromEdgePercentagePoints: 100 * (oldDecision.modelProbability - oldDecision.marketFairProbability),
        toEdgePercentagePoints: 100 * (newDecision.modelProbability - newDecision.marketFairProbability),
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

function compareCurrentBoard(baseline: Replay[], candidate: Replay[]) {
  const baselineByGame = new Map(baseline.map((row) => [row.game.payload.game.providerGameId, row]));
  return Object.fromEntries(MARKETS.map((market) => {
    const rows = candidate.flatMap((row) => {
      const prior = baselineByGame.get(row.game.payload.game.providerGameId);
      const before = prior?.decisions.find((decision) => decision.market === market);
      const after = row.decisions.find((decision) => decision.market === market);
      if (!before || !after || before.side === after.side && before.grade === after.grade) return [];
      return [{
        game: `${row.game.payload.game.away.abbreviation}@${row.game.payload.game.home.abbreviation}`,
        scheduledStart: row.game.payload.game.scheduledStart,
        fromSide: before.side,
        toSide: after.side,
        fromGrade: before.grade,
        toGrade: after.grade,
        fromProbability: before.modelProbability,
        toProbability: after.modelProbability,
        fromPrice: before.evaluatedQuote.price,
        toPrice: after.evaluatedQuote.price,
      }];
    });
    return [market, {
      sideChanges: rows.filter((row) => row.fromSide !== row.toSide).length,
      promotions: rows.filter((row) => !ACTIONABLE.has(row.fromGrade) && ACTIONABLE.has(row.toGrade)).length,
      demotions: rows.filter((row) => ACTIONABLE.has(row.fromGrade) && !ACTIONABLE.has(row.toGrade)).length,
      rows,
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

function chronologicalProductAudit(baseline: Replay[], candidate: Replay[]) {
  const eligibleGameIds = [...new Set(calibrationRows(baseline, "moneyline")
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart) || a.gameId.localeCompare(b.gameId))
    .map((row) => row.gameId))];
  const selectionCount = Math.max(1, Math.floor(eligibleGameIds.length * 0.70));
  const selectionIds = new Set(eligibleGameIds.slice(0, selectionCount));
  const confirmationIds = new Set(eligibleGameIds.slice(selectionCount));
  const cohort = (ids: Set<string>) => ({
    baseline: baseline.filter((row) => ids.has(row.game.payload.game.providerGameId)),
    candidate: candidate.filter((row) => ids.has(row.game.payload.game.providerGameId)),
  });
  const summarizeCohort = (rows: ReturnType<typeof cohort>) => ({
    games: rows.baseline.length,
    baseline: summarize(rows.baseline),
    candidate: summarize(rows.candidate),
    impact: compare(rows.baseline, rows.candidate),
  });
  return {
    selection: summarizeCohort(cohort(selectionIds)),
    confirmation: summarizeCohort(cohort(confirmationIds)),
  };
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
    const targetExcludedSequence = targetExcludedNamedSequenceAuthority(
      row.game,
      exactAuthorityExclusions(row.game),
    );
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
      targetExcludedSequence: targetExcludedSequence.reads[market],
      targetExcludedCorroboratedSide: market === "total"
        ? null
        : targetExcludedCorroboratedSide(row.game, market),
    };
  }));
}

type CalibrationMarket = "moneyline" | "spread";
type CalibrationGrade = "Best Angle" | "Lean" | "Watchlist" | "No Play";
type CalibrationRow = {
  gameId: string;
  game: string;
  scheduledStart: string;
  weekKey: string;
  market: CalibrationMarket;
  side: string;
  probability: number;
  fairProbability: number;
  expectedValue: number;
  edgePercentagePoints: number;
  price: number;
  line: number | null;
  cushion: number;
  penalty: number;
  exactPriceReliability: boolean;
  result: Result;
  baselineGrade: CalibrationGrade;
  authorityAgreement: boolean;
  authorityOpposition: boolean;
};
type CalibrationThresholds = {
  market: CalibrationMarket;
  leanProbability: number;
  leanExpectedValue: number;
  leanEdgePercentagePoints: number;
  bestProbability: number;
  bestExpectedValue: number;
  bestEdgePercentagePoints: number;
  authorityModifier: boolean;
};

function normalizeSportsbook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function calendarWeekKey(value: string): string {
  const date = new Date(value);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

function calibrationRows(rows: Replay[], market: CalibrationMarket): CalibrationRow[] {
  return rows.flatMap((row): CalibrationRow[] => {
    const decision = row.decisions.find((candidate) => candidate.market === market);
    if (!decision) return [];
    const books = row.game.payload.market.comparableCurrentBooks;
    const selectedBook = normalizeSportsbook(decision.evaluatedQuote.sportsbook);
    const homeSelected = decision.side === row.game.payload.game.home.abbreviation;
    const otherBookCount = books.filter((book) => {
      if (normalizeSportsbook(book.sportsbook) === selectedBook) return false;
      if (market === "moneyline") return book.moneyline !== null;
      if (!book.spread || decision.evaluatedQuote.line === null) return false;
      const selectedLine = homeSelected ? book.spread.homeLine : book.spread.awayLine;
      return selectedLine === decision.evaluatedQuote.line;
    }).length;
    const targetExcludedReliability = market === "spread" &&
      row.forecast.targetExclusion?.status === "target_excluded_market" &&
      (row.forecast.targetExclusion.marginFamilyCount ?? 0) >= 3;
    const exactPriceReliability = market === "moneyline"
      ? otherBookCount >= 2
      : otherBookCount >= 2 || targetExcludedReliability;
    const margin = row.forecast.expectedHomeScore - row.forecast.expectedAwayScore;
    const selectedMargin = homeSelected ? margin : -margin;
    const line = decision.evaluatedQuote.line;
    const cushion = market === "spread" && line !== null ? selectedMargin + line : 0;
    const penalty = market === "spread" && line !== null &&
      [3, 7, 10, 14].some((key) => Math.abs(Math.abs(line) - key) <= 0.25) ? 0.5 : 0;
    const authority = professionalMarketAuthority(row.game, exactAuthorityExclusions(row.game)).reads[market];
    const authoritySide = authority.side === "home"
      ? row.game.payload.game.home.abbreviation
      : authority.side === "away"
        ? row.game.payload.game.away.abbreviation
        : null;
    const authorityQualified = authority.status === "qualified" && authoritySide !== null;
    return [{
      gameId: row.game.payload.game.providerGameId,
      game: `${row.game.payload.game.away.abbreviation}@${row.game.payload.game.home.abbreviation}`,
      scheduledStart: row.game.payload.game.scheduledStart,
      weekKey: calendarWeekKey(row.game.payload.game.scheduledStart),
      market,
      side: decision.side,
      probability: decision.modelProbability,
      fairProbability: decision.marketFairProbability,
      expectedValue: decision.expectedValue,
      edgePercentagePoints: 100 * (decision.modelProbability - decision.marketFairProbability),
      price: decision.evaluatedQuote.price,
      line,
      cushion,
      penalty,
      exactPriceReliability,
      result: decisionResult(row.game, market, decision.side, line),
      baselineGrade: decision.grade as CalibrationGrade,
      authorityAgreement: authorityQualified && authoritySide === decision.side,
      authorityOpposition: authorityQualified && authoritySide !== decision.side,
    }];
  });
}

function calibrationGrade(row: CalibrationRow, thresholds: CalibrationThresholds): CalibrationGrade {
  const priceEligible = row.market === "moneyline"
    ? row.price >= -300 && row.price <= 300
    : row.price >= -200 && row.price <= 200;
  const lean = priceEligible && row.exactPriceReliability &&
    row.probability >= thresholds.leanProbability &&
    row.expectedValue >= thresholds.leanExpectedValue &&
    row.edgePercentagePoints >= thresholds.leanEdgePercentagePoints &&
    (row.market !== "spread" || row.cushion >= row.penalty);
  const bestPriceEligible = row.market !== "moneyline" || row.price >= -200;
  const best = lean && bestPriceEligible &&
    row.probability >= thresholds.bestProbability &&
    row.expectedValue >= thresholds.bestExpectedValue &&
    row.edgePercentagePoints >= thresholds.bestEdgePercentagePoints;
  const grade: CalibrationGrade = best ? "Best Angle" : lean ? "Lean" : calibrationWatchlist(row);
  if (!thresholds.authorityModifier) return grade;
  if (row.authorityOpposition && grade === "Best Angle") return "Lean";
  if (row.authorityOpposition && grade === "Lean") return "Watchlist";
  if (row.authorityAgreement && grade === "Watchlist" && priceEligible && row.exactPriceReliability &&
      row.probability >= thresholds.leanProbability) {
    return "Lean";
  }
  return grade;
}

function calibrationWatchlist(row: CalibrationRow): CalibrationGrade {
  const qualified = row.market === "moneyline"
    ? row.price >= -300 && row.price <= 300 &&
      row.expectedValue >= -0.01 && row.edgePercentagePoints >= -1
    : row.price >= -200 && row.price <= 200 &&
      row.probability >= 0.50 && row.expectedValue >= -0.02 &&
      row.edgePercentagePoints >= -1 && row.cushion >= -0.5 + row.penalty;
  return qualified ? "Watchlist" : "No Play";
}

function calibrationGradeRank(grade: CalibrationGrade): number {
  return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0;
}

function calibrationMetrics(rows: CalibrationRow[], thresholds?: CalibrationThresholds) {
  const graded = rows.map((row) => ({
    ...row,
    grade: thresholds ? calibrationGrade(row, thresholds) : row.baselineGrade,
  }));
  const resolved = graded.filter((row) => row.result !== "push");
  const actionable = resolved.filter((row) => ACTIONABLE.has(row.grade));
  const nonActionable = resolved.filter((row) => !ACTIONABLE.has(row.grade));
  const wins = actionable.filter((row) => row.result === "win").length;
  const brier = actionable.length
    ? actionable.reduce((sum, row) => sum + (row.probability - (row.result === "win" ? 1 : 0)) ** 2, 0) / actionable.length
    : null;
  const probabilityLogLoss = actionable.length
    ? actionable.reduce((sum, row) => sum + logLoss(row.probability, row.result === "win"), 0) / actionable.length
    : null;
  const tier = (grade: CalibrationGrade) => {
    const values = resolved.filter((row) => row.grade === grade);
    const tierWins = values.filter((row) => row.result === "win").length;
    return {
      rows: values.length,
      wins: tierWins,
      losses: values.length - tierWins,
      accuracy: values.length ? tierWins / values.length : null,
      units: values.reduce((sum, row) => sum + units(row.result, row.price), 0),
    };
  };
  return {
    rows: graded.length,
    actionable: actionable.length,
    wins,
    losses: actionable.length - wins,
    accuracy: actionable.length ? wins / actionable.length : null,
    units: actionable.reduce((sum, row) => sum + units(row.result, row.price), 0),
    brier,
    logLoss: probabilityLogLoss,
    nonActionableAccuracy: nonActionable.length
      ? nonActionable.filter((row) => row.result === "win").length / nonActionable.length
      : null,
    grades: {
      bestAngle: tier("Best Angle"),
      lean: tier("Lean"),
      watchlist: tier("Watchlist"),
      noPlay: tier("No Play"),
    },
    promotions: graded.filter((row) => calibrationGradeRank(row.grade) > calibrationGradeRank(row.baselineGrade)).length,
    demotions: graded.filter((row) => calibrationGradeRank(row.grade) < calibrationGradeRank(row.baselineGrade)).length,
  };
}

function calibrationOrdering(metrics: ReturnType<typeof calibrationMetrics>): boolean {
  const best = metrics.grades.bestAngle;
  const lean = metrics.grades.lean;
  const tierOrdered = best.rows === 0 || lean.rows === 0 || (best.accuracy ?? 0) >= (lean.accuracy ?? 0);
  return tierOrdered && (metrics.nonActionableAccuracy === null || metrics.accuracy === null ||
    metrics.accuracy >= metrics.nonActionableAccuracy);
}

function calibrationCandidates(market: CalibrationMarket): CalibrationThresholds[] {
  const values = market === "moneyline" ? {
    leanProbability: [0.55, 0.575, 0.60],
    leanExpectedValue: [0, 0.02],
    leanEdgePercentagePoints: [0, 2],
    bestProbability: [0.575, 0.60, 0.625],
    bestExpectedValue: [0.03, 0.04, 0.06],
    bestEdgePercentagePoints: [4, 6],
  } : {
    leanProbability: [0.54, 0.555, 0.565, 0.58],
    leanExpectedValue: [0, 0.02, 0.04],
    leanEdgePercentagePoints: [0, 2],
    bestProbability: [0.58, 0.59, 0.60, 0.62],
    bestExpectedValue: [0.04, 0.06],
    bestEdgePercentagePoints: [4, 6],
  };
  const candidates: CalibrationThresholds[] = [];
  for (const leanProbability of values.leanProbability)
    for (const leanExpectedValue of values.leanExpectedValue)
      for (const leanEdgePercentagePoints of values.leanEdgePercentagePoints)
        for (const bestProbability of values.bestProbability)
          for (const bestExpectedValue of values.bestExpectedValue)
            for (const bestEdgePercentagePoints of values.bestEdgePercentagePoints)
              for (const authorityModifier of [false, true]) candidates.push({
                market, leanProbability, leanExpectedValue, leanEdgePercentagePoints,
                bestProbability, bestExpectedValue, bestEdgePercentagePoints, authorityModifier,
              });
  return candidates;
}

function leaveOneWeekOut(rows: CalibrationRow[], thresholds: CalibrationThresholds) {
  const weeks = [...new Set(rows.map((row) => row.weekKey))];
  const deltas = weeks.map((weekKey) => {
    const subset = rows.filter((row) => row.weekKey !== weekKey);
    const baseline = calibrationMetrics(subset);
    const candidate = calibrationMetrics(subset, thresholds);
    return {
      weekKey,
      unitsDelta: candidate.units - baseline.units,
      accuracyDelta: (candidate.accuracy ?? 0) - (baseline.accuracy ?? 0),
    };
  });
  return {
    weeks: deltas.length,
    minimumUnitsDelta: deltas.length ? Math.min(...deltas.map((row) => row.unitsDelta)) : 0,
    minimumAccuracyDelta: deltas.length ? Math.min(...deltas.map((row) => row.accuracyDelta)) : 0,
    reversals: deltas.filter((row) => row.unitsDelta < -1e-9).length,
    rows: deltas,
  };
}

function candidateDeparture(thresholds: CalibrationThresholds): number {
  const baseline = thresholds.market === "moneyline"
    ? { leanProbability: 0.50, leanExpectedValue: 0, leanEdgePercentagePoints: 0,
        bestProbability: 0.50, bestExpectedValue: 0.02, bestEdgePercentagePoints: 4 }
    : { leanProbability: 0.565, leanExpectedValue: 0, leanEdgePercentagePoints: 0,
        bestProbability: 0.59, bestExpectedValue: 0.04, bestEdgePercentagePoints: 4 };
  return Math.abs(thresholds.leanProbability - baseline.leanProbability) * 100 +
    Math.abs(thresholds.leanExpectedValue - baseline.leanExpectedValue) * 100 +
    Math.abs(thresholds.leanEdgePercentagePoints - baseline.leanEdgePercentagePoints) +
    Math.abs(thresholds.bestProbability - baseline.bestProbability) * 100 +
    Math.abs(thresholds.bestExpectedValue - baseline.bestExpectedValue) * 100 +
    Math.abs(thresholds.bestEdgePercentagePoints - baseline.bestEdgePercentagePoints) +
    (thresholds.authorityModifier ? 1 : 0);
}

function gradeCalibrationAudit(rows: Replay[]) {
  return Object.fromEntries((["moneyline", "spread"] as const).map((market) => {
    const all = calibrationRows(rows, market).sort((a, b) =>
      a.scheduledStart.localeCompare(b.scheduledStart) || a.gameId.localeCompare(b.gameId));
    const gameIds = [...new Set(all.map((row) => row.gameId))];
    const selectionGameCount = Math.max(1, Math.floor(gameIds.length * 0.70));
    const selectionIds = new Set(gameIds.slice(0, selectionGameCount));
    const selection = all.filter((row) => selectionIds.has(row.gameId));
    const confirmation = all.filter((row) => !selectionIds.has(row.gameId));
    const selectionBaseline = calibrationMetrics(selection);
    const evaluated = calibrationCandidates(market).map((thresholds) => {
      const metrics = calibrationMetrics(selection, thresholds);
      const sensitivity = leaveOneWeekOut(selection, thresholds);
      return {
        thresholds,
        metrics,
        sensitivity,
        unitsDelta: metrics.units - selectionBaseline.units,
        accuracyDelta: (metrics.accuracy ?? 0) - (selectionBaseline.accuracy ?? 0),
        ordering: calibrationOrdering(metrics),
        departure: candidateDeparture(thresholds),
      };
    });
    const eligible = evaluated.filter((candidate) =>
      candidate.metrics.actionable > 0 && candidate.unitsDelta > 0 && candidate.accuracyDelta > 0 &&
      candidate.ordering && candidate.sensitivity.reversals === 0);
    eligible.sort((a, b) =>
      b.unitsDelta - a.unitsDelta || b.accuracyDelta - a.accuracyDelta ||
      b.sensitivity.minimumUnitsDelta - a.sensitivity.minimumUnitsDelta ||
      a.departure - b.departure || Number(a.thresholds.authorityModifier) - Number(b.thresholds.authorityModifier));
    const selected = eligible[0] ?? null;
    const confirmationBaseline = calibrationMetrics(confirmation);
    const confirmationCandidate = selected ? calibrationMetrics(confirmation, selected.thresholds) : null;
    const confirmationPass = selected && confirmationCandidate ? {
      unitsNonDegrading: confirmationCandidate.units >= confirmationBaseline.units - 1e-9,
      accuracyNonDegrading: (confirmationCandidate.accuracy ?? 0) >= (confirmationBaseline.accuracy ?? 0) - 1e-9,
      oneMateriallyImproved: confirmationCandidate.units > confirmationBaseline.units + 1e-9 ||
        (confirmationCandidate.accuracy ?? 0) > (confirmationBaseline.accuracy ?? 0) + 1e-9,
      brierNonDegrading: confirmationCandidate.brier !== null && confirmationBaseline.brier !== null &&
        confirmationCandidate.brier <= confirmationBaseline.brier + 1e-9,
      logLossNonDegrading: confirmationCandidate.logLoss !== null && confirmationBaseline.logLoss !== null &&
        confirmationCandidate.logLoss <= confirmationBaseline.logLoss + 1e-9,
      ordering: calibrationOrdering(confirmationCandidate),
    } : null;
    const qualified = confirmationPass !== null && Object.values(confirmationPass).every(Boolean) &&
      selected !== null && selected.metrics.promotions + (confirmationCandidate?.promotions ?? 0) > 0 &&
      selected.metrics.demotions + (confirmationCandidate?.demotions ?? 0) > 0;
    return [market, {
      eligibleGames: gameIds.length,
      selectionGames: selectionGameCount,
      confirmationGames: gameIds.length - selectionGameCount,
      candidateCount: evaluated.length,
      selectionEligibleCandidateCount: eligible.length,
      selectionBaseline,
      selectedCandidate: selected,
      confirmationBaseline,
      confirmationCandidate,
      confirmationPass,
      qualified,
      selectionLedger: selection,
      confirmationLedger: confirmation,
      leadingCandidates: evaluated.sort((a, b) =>
        b.unitsDelta - a.unitsDelta || b.accuracyDelta - a.accuracyDelta || a.departure - b.departure).slice(0, 10),
    }];
  }));
}

function weeklyProjectionBreakdown(rows: Replay[]) {
  return Object.fromEntries([...new Set(rows.map((row) => calendarWeekKey(row.game.payload.game.scheduledStart)))].map((weekKey) => {
    const weekly = rows.filter((row) => calendarWeekKey(row.game.payload.game.scheduledStart) === weekKey);
    const market = (name: Market) => {
      const results = weekly.map((row) => projectionResult(row, name));
      const resolved = results.filter((result) => result !== "push");
      const wins = resolved.filter((result) => result === "win").length;
      return {
        wins,
        losses: resolved.length - wins,
        pushes: results.length - resolved.length,
        accuracy: resolved.length ? wins / resolved.length : null,
        plus3: name === "moneyline" ? null : (() => {
          const alternate = weekly.map((row) => projectionResult(row, name, 3));
          const alternateResolved = alternate.filter((result) => result !== "push");
          const alternateWins = alternateResolved.filter((result) => result === "win").length;
          return { wins: alternateWins, losses: alternateResolved.length - alternateWins,
            pushes: alternate.length - alternateResolved.length };
        })(),
        plus6: name === "moneyline" ? null : (() => {
          const alternate = weekly.map((row) => projectionResult(row, name, 6));
          const alternateResolved = alternate.filter((result) => result !== "push");
          const alternateWins = alternateResolved.filter((result) => result === "win").length;
          return { wins: alternateWins, losses: alternateResolved.length - alternateWins,
            pushes: alternate.length - alternateResolved.length };
        })(),
      };
    };
    return [weekKey, {
      games: weekly.length,
      moneyline: market("moneyline"),
      spread: market("spread"),
      total: market("total"),
    }];
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
  const gradeCalibration = process.argv.includes("--grade-calibration");
  const normalizeReplayTeam = (team: string) => ({
    LAR: "LA", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA",
  }[team] ?? team);
  const exactReplayPath = process.argv.find((value) => value.startsWith("--exact-replay="))
    ?.slice("--exact-replay=".length) ??
    "football-research/reports/nfl-independent-score-rebuild-2026-replay/replay.json";
  const exactReplay = gradeCalibration
    ? JSON.parse(readFileSync(exactReplayPath, "utf8")) as {
        replayRelease: string;
        candidates: Record<string, { scores: Array<{
          date: string; home: string; away: string; expectedHomeScore: number; expectedAwayScore: number;
        }> }>;
      }
    : null;
  const exactReplayCandidate = exactReplay?.candidates.exactProviderTotalR10R11;
  if (gradeCalibration && !exactReplayCandidate) {
    throw new Error("Exact replay is missing exactProviderTotalR10R11.");
  }
  const exactReplayByGame = new Map<string, { margin: number; total: number }>((exactReplayCandidate?.scores ?? []).map((score) => [
    `${score.date}:${normalizeReplayTeam(score.away)}@${normalizeReplayTeam(score.home)}`,
    {
      margin: score.expectedHomeScore - score.expectedAwayScore,
      total: score.expectedHomeScore + score.expectedAwayScore,
    },
  ] as const));
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
  const history: NflForwardStoredEvidence[] = [];
  for (const week of [1, 2, 3, 4, 5, 6, 7]) {
    history.push(...await readNflForwardEvidence({ client: supabase, season: 2026, week }));
  }
  const latestPregameEvidenceByReplayKey = new Map<string, NflForwardStoredEvidence>();
  for (const row of history) {
    const payload = row.payload as NflForwardEvidencePayload;
    if (row.capturedAt > payload.game.scheduledStart || payload.decisions.evaluatedBets.length === 0) continue;
    const replayKey = `${payload.game.scheduledStart.slice(0, 10)}:${normalizeReplayTeam(payload.game.away.abbreviation)}@${normalizeReplayTeam(payload.game.home.abbreviation)}`;
    if (!exactReplayByGame.has(replayKey)) continue;
    const incumbent = latestPregameEvidenceByReplayKey.get(replayKey);
    if (!incumbent || incumbent.capturedAt < row.capturedAt) latestPregameEvidenceByReplayKey.set(replayKey, row);
  }
  const providerGameIds = [...new Set([...latestPregameEvidenceByReplayKey.values()]
    .map((row) => Number(row.providerGameId)).filter(Number.isFinite))];
  const finalScoreRead = gradeCalibration && providerGameIds.length > 0
    ? await supabase.from("games").select("external_id,status,home_score,away_score")
      .eq("sport", "nfl").in("external_id", providerGameIds)
    : { data: [], error: null };
  if (finalScoreRead.error) throw new Error(finalScoreRead.error.message);
  const finalScoreByProviderGameId = new Map((finalScoreRead.data ?? []).flatMap((row): Array<[
    string,
    { home: number; away: number },
  ]> => row.status === "final" && typeof row.home_score === "number" && typeof row.away_score === "number"
    ? [[String(row.external_id), { home: row.home_score, away: row.away_score }]]
    : []));
  const expandedExactGames = [...latestPregameEvidenceByReplayKey.entries()].flatMap(([replayKey, row]): Game[] => {
    const exactProviderScore = exactReplayByGame.get(replayKey);
    const actual = finalScoreByProviderGameId.get(String(Number(row.providerGameId)));
    if (!exactProviderScore || !actual) return [];
    return [{
      payload: row.payload as NflForwardEvidencePayload,
      actualHome: actual.home,
      actualAway: actual.away,
      histories: history.filter((candidate) =>
        candidate.providerGameId === row.providerGameId && candidate.capturedAt <= row.capturedAt),
      exactProviderScore,
    }];
  }).sort((a, b) => a.payload.game.scheduledStart.localeCompare(b.payload.game.scheduledStart));
  const latestUpcomingByGame = history.filter((row) =>
    row.gameStartAt > new Date().toISOString() && Boolean((row.payload as NflForwardEvidencePayload).exactProviderScoreShadow))
    .reduce<Map<string, NflForwardStoredEvidence>>((rows, row) => {
      const incumbent = rows.get(row.providerGameId);
      if (!incumbent || incumbent.capturedAt < row.capturedAt) rows.set(row.providerGameId, row);
      return rows;
    }, new Map());
  const currentExactGames = [...latestUpcomingByGame.values()].map((row): Game => {
    const payload = row.payload as NflForwardEvidencePayload;
    const exact = payload.exactProviderScoreShadow!;
    return {
      payload,
      actualHome: 0,
      actualAway: 0,
      histories: history.filter((candidate) =>
        candidate.providerGameId === row.providerGameId && candidate.capturedAt <= row.capturedAt),
      exactProviderScore: { margin: exact.expectedHomeMargin, total: exact.expectedTotal },
    };
  }).sort((a, b) => a.payload.game.scheduledStart.localeCompare(b.payload.game.scheduledStart));
  const evidenceRead = await supabase.from("nfl_forward_evidence_snapshots").select("payload_sha256,payload").in("payload_sha256", hashes);
  if (evidenceRead.error) throw new Error(evidenceRead.error.message);
  const games = (evidenceRead.data ?? []).flatMap((row): Game[] => {
    const payload = row.payload as NflForwardEvidencePayload;
    const replayKey = `${payload.game.scheduledStart.slice(0, 10)}:${normalizeReplayTeam(payload.game.away.abbreviation)}@${normalizeReplayTeam(payload.game.home.abbreviation)}`;
    const storedExact = payload.exactProviderScoreShadow;
    const exactProviderScore = exactReplayByGame.get(replayKey) ?? (storedExact ? {
      margin: storedExact.expectedHomeMargin,
      total: storedExact.expectedTotal,
    } : null);
    if (!exactProviderScore && !payload.paidProjectionShadow) return [];
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
      exactProviderScore,
    }];
  }).sort((a, b) => a.payload.game.scheduledStart.localeCompare(b.payload.game.scheduledStart));
  if (games.length < 18) throw new Error(`Expected at least 18 paid-projection games; got ${games.length}.`);
  if (process.argv.includes("--settled-production-summary")) {
    const baseline = games.map((game) => replay(game, VARIANTS.settledCurrentProductionThreeStateNoWeight!));
    const candidate = games.map((game) => replay(game, VARIANTS.settledProductionThreeStateNoWeight!));
    console.log(JSON.stringify({
      release: "nfl_2026_settled_production_reader_audit_2026_10_26_r1",
      readOnly: true,
      writes: 0,
      games: games.length,
      baseline: summarize(baseline),
      candidate: summarize(candidate),
      impact: compare(baseline, candidate),
      chronology: chronologicalProductAudit(baseline, candidate),
      forecastImpact: compareForecasts(baseline, candidate),
    }, null, 2));
    return;
  }
  if (gradeCalibration) {
    const exactGames = games.filter((game) => game.exactProviderScore !== null);
    if (exactGames.length < 18) {
      throw new Error(`Expected at least 18 exact-provider parity games; got ${exactGames.length}.`);
    }
    const exactIndependent = exactGames.map((game) => replay(game, VARIANTS.exactIndependent!));
    const exactProfessional = exactGames.map((game) => replay(game, VARIANTS.exactProfessionalNoWeight!));
    const exactCorroboratedMoneyline = exactGames.map((game) =>
      replay(game, VARIANTS.exactCorroboratedMoneylineNoWeight!));
    const exactCorroboratedMoneylineOutcomeBoundary = exactGames.map((game) =>
      replay(game, VARIANTS.exactCorroboratedMoneylineOutcomeBoundaryNoWeight!));
    const exactCorroboratedMoneylineOutcomeBoundaryGradeIndependent =
      preserveNonActionableMoneylineGradeOnFlip(
        exactProfessional,
        exactCorroboratedMoneylineOutcomeBoundary,
      );
    const exactCorroboratedMoneylineThreeState = exactGames.map((game) =>
      replay(game, VARIANTS.exactCorroboratedMoneylineThreeStateNoWeight!));
    const exactCorroboratedMoneylineThreeStateGradeIndependent = preserveNonActionableMoneylineGradeOnFlip(
      exactProfessional,
      exactCorroboratedMoneylineThreeState,
    );
    const exactCorroboratedMoneylineThreeStatePromoted = exactGames.map((game) =>
      replay(game, VARIANTS.exactCorroboratedMoneylineThreeStatePromotedNoWeight!));
    const exactCorroboratedMoneylineThreeStatePromotedGradeIndependent =
      preserveNonActionableMoneylineGradeOnFlip(
        exactProfessional,
        exactCorroboratedMoneylineThreeStatePromoted,
      );
    const exactProductionThreeState = exactGames.map((game) =>
      replay(game, VARIANTS.exactProductionThreeStateNoWeight!));
    const exactLegacyProductionThreeState = exactGames.map((game) =>
      replay(game, VARIANTS.exactLegacyProductionThreeStateNoWeight!));
    const exactCorroboratedMoneylineGradeIndependent = preserveNonActionableMoneylineGradeOnFlip(
      exactProfessional,
      exactCorroboratedMoneyline,
    );
    const expandedProfessional = expandedExactGames.map((game) => replay(game, VARIANTS.exactProfessionalNoWeight!));
    const expandedCorroboratedMoneyline = expandedExactGames.map((game) =>
      replay(game, VARIANTS.exactCorroboratedMoneylineNoWeight!));
    const expandedCorroboratedMoneylineGradeIndependent = preserveNonActionableMoneylineGradeOnFlip(
      expandedProfessional,
      expandedCorroboratedMoneyline,
    );
    const currentProfessional = currentExactGames.map((game) => replay(game, VARIANTS.exactProfessionalNoWeight!));
    const currentThreeStatePromoted = preserveNonActionableMoneylineGradeOnFlip(
      currentProfessional,
      currentExactGames.map((game) => replay(game, VARIANTS.exactCorroboratedMoneylineThreeStatePromotedNoWeight!)),
    );
    const currentProductionThreeState = currentExactGames.map((game) =>
      replay(game, VARIANTS.exactProductionThreeStateNoWeight!));
    const report = {
      release: "nfl_exact_no_weight_market_specific_grade_calibration_audit_2026_10_25_r2",
      readOnly: true,
      writes: 0,
      exactReplayRelease: exactReplay?.replayRelease ?? null,
      activeReplay: "exactProfessionalNoWeight",
      games: exactGames.length,
      exactIndependentSummary: summarize(exactIndependent),
      exactProfessionalSummary: summarize(exactProfessional),
      exactCorroboratedMoneylineSummary: summarize(exactCorroboratedMoneyline),
      exactCorroboratedMoneylineGradeIndependentSummary: summarize(exactCorroboratedMoneylineGradeIndependent),
      exactCorroboratedMoneylineOutcomeBoundarySummary: summarize(
        exactCorroboratedMoneylineOutcomeBoundaryGradeIndependent,
      ),
      exactCorroboratedMoneylineThreeStateSummary: summarize(
        exactCorroboratedMoneylineThreeStateGradeIndependent,
      ),
      exactCorroboratedMoneylineThreeStatePromotedSummary: summarize(
        exactCorroboratedMoneylineThreeStatePromotedGradeIndependent,
      ),
      exactProductionThreeStateSummary: summarize(exactProductionThreeState),
      exactLegacyProductionThreeStateSummary: summarize(exactLegacyProductionThreeState),
      readerImpact: compare(exactIndependent, exactProfessional),
      corroboratedMoneylineImpact: compare(exactProfessional, exactCorroboratedMoneyline),
      corroboratedMoneylineGradeIndependentImpact: compare(
        exactProfessional,
        exactCorroboratedMoneylineGradeIndependent,
      ),
      corroboratedMoneylineOutcomeBoundaryImpact: compare(
        exactProfessional,
        exactCorroboratedMoneylineOutcomeBoundaryGradeIndependent,
      ),
      corroboratedMoneylineThreeStateImpact: compare(
        exactProfessional,
        exactCorroboratedMoneylineThreeStateGradeIndependent,
      ),
      corroboratedMoneylineThreeStatePromotedImpact: compare(
        exactProfessional,
        exactCorroboratedMoneylineThreeStatePromotedGradeIndependent,
      ),
      productionThreeStateImpact: compare(exactProfessional, exactProductionThreeState),
      productionThreeStateVsLegacyImpact: compare(exactLegacyProductionThreeState, exactProductionThreeState),
      decisionLedger: decisionLedger(exactIndependent, exactIndependent, exactProfessional),
      lossReview: lossReview(exactIndependent, exactProfessional),
      weeklyProjection: {
        independent: weeklyProjectionBreakdown(exactIndependent),
        professional: weeklyProjectionBreakdown(exactProfessional),
      },
      audit: gradeCalibrationAudit(exactProfessional),
      corroboratedMoneylineAudit: gradeCalibrationAudit(exactCorroboratedMoneyline),
      corroboratedMoneylineGradeIndependentAudit: gradeCalibrationAudit(
        exactCorroboratedMoneylineGradeIndependent,
      ),
      corroboratedMoneylineGradeIndependentChronology: chronologicalProductAudit(
        exactProfessional,
        exactCorroboratedMoneylineGradeIndependent,
      ),
      corroboratedMoneylineOutcomeBoundaryChronology: chronologicalProductAudit(
        exactProfessional,
        exactCorroboratedMoneylineOutcomeBoundaryGradeIndependent,
      ),
      corroboratedMoneylineThreeStateChronology: chronologicalProductAudit(
        exactProfessional,
        exactCorroboratedMoneylineThreeStateGradeIndependent,
      ),
      corroboratedMoneylineThreeStatePromotedChronology: chronologicalProductAudit(
        exactProfessional,
        exactCorroboratedMoneylineThreeStatePromotedGradeIndependent,
      ),
      productionThreeStateChronology: chronologicalProductAudit(
        exactProfessional,
        exactProductionThreeState,
      ),
      expandedPregameEvidenceSensitivity: {
        games: expandedExactGames.length,
        baseline: summarize(expandedProfessional),
        candidate: summarize(expandedCorroboratedMoneylineGradeIndependent),
        impact: compare(expandedProfessional, expandedCorroboratedMoneylineGradeIndependent),
        chronology: chronologicalProductAudit(
          expandedProfessional,
          expandedCorroboratedMoneylineGradeIndependent,
        ),
      },
      currentBoardSensitivity: {
        games: currentExactGames.length,
        baselineDecisions: currentProfessional.reduce((sum, row) => sum + row.decisions.length, 0),
        candidateDecisions: currentThreeStatePromoted.reduce((sum, row) => sum + row.decisions.length, 0),
        impact: compareCurrentBoard(currentProfessional, currentThreeStatePromoted),
        productionCandidateDecisions: currentProductionThreeState.reduce((sum, row) => sum + row.decisions.length, 0),
        productionImpact: compareCurrentBoard(currentProfessional, currentProductionThreeState),
      },
    };
    if (process.argv.includes("--grade-summary")) {
      console.log(JSON.stringify({
        release: report.release,
        games: report.games,
        baseline: report.exactProfessionalSummary,
        candidate: report.exactCorroboratedMoneylineGradeIndependentSummary,
        impact: report.corroboratedMoneylineGradeIndependentImpact,
        chronology: report.corroboratedMoneylineGradeIndependentChronology,
        outcomeBoundary: {
          candidate: report.exactCorroboratedMoneylineOutcomeBoundarySummary,
          impact: report.corroboratedMoneylineOutcomeBoundaryImpact,
          chronology: report.corroboratedMoneylineOutcomeBoundaryChronology,
        },
        threeState: {
          candidate: report.exactCorroboratedMoneylineThreeStateSummary,
          impact: report.corroboratedMoneylineThreeStateImpact,
          chronology: report.corroboratedMoneylineThreeStateChronology,
        },
        threeStatePromoted: {
          candidate: report.exactCorroboratedMoneylineThreeStatePromotedSummary,
          impact: report.corroboratedMoneylineThreeStatePromotedImpact,
          chronology: report.corroboratedMoneylineThreeStatePromotedChronology,
        },
        productionThreeState: {
          candidate: report.exactProductionThreeStateSummary,
          impact: report.productionThreeStateImpact,
          chronology: report.productionThreeStateChronology,
        },
        legacyProductionThreeState: {
          candidate: report.exactLegacyProductionThreeStateSummary,
          impactToNew: report.productionThreeStateVsLegacyImpact,
        },
        expandedPregameEvidenceSensitivity: report.expandedPregameEvidenceSensitivity,
        currentBoardSensitivity: report.currentBoardSensitivity,
      }, null, 2));
      return;
    }
    console.log(JSON.stringify(report, null, 2));
    return;
  }
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
  if (process.argv.includes("--scorecard")) {
    const names = ["independentOnly", "current", "professionalMarketReader"];
    console.log(JSON.stringify({
      games: report.games,
      sharpSplitGames: report.sharpSplitGames,
      variants: Object.fromEntries(names.map((name) => {
        const value = report.variants[name]!;
        return [name, {
          summary: value.summary,
          impactVersusCurrent: value.versusCurrent && Object.fromEntries(
            Object.entries(value.versusCurrent).map(([market, impact]) => [market, {
              sideChanges: impact.sideChanges,
              corrections: impact.corrections,
              harms: impact.harms,
              promotions: impact.promotions,
              demotions: impact.demotions,
            }]),
          ),
          impactVersusIndependent: value.versusIndependent && Object.fromEntries(
            Object.entries(value.versusIndependent).map(([market, impact]) => [market, {
              sideChanges: impact.sideChanges,
              corrections: impact.corrections,
              harms: impact.harms,
              promotions: impact.promotions,
              demotions: impact.demotions,
            }]),
          ),
        }];
      })),
      professionalLossClasses: report.professionalLossReview.byCategory,
    }, null, 2));
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
