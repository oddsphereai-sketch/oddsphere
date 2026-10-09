/**
 * SELECT-only NFL professional market-reader certification.
 *
 * Reads immutable forward evidence and prediction outcomes. It performs no
 * provider calls and no writes. The report deliberately keeps market-only
 * performance separate from historical model-release interactions.
 */

import { createClient } from "@supabase/supabase-js";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
} from "@/lib/services/football/nflForwardEvidence";
import {
  buildNflMarketState,
  type NflMarketState,
  type NflMarketStateMarket,
  type NflMarketStateSide,
  type NflMarketStateTrail,
} from "@/lib/services/football/nflMarketState";
import { buildNflNamedMarketSequenceAuthority } from "@/lib/services/football/nflNamedMarketSequence";
import { buildNflProfessionalMarketAuthority } from "@/lib/services/football/nflProfessionalMarketAuthority";

type Market = NflMarketStateMarket;
type Side = NflMarketStateSide;
type Result = "win" | "loss" | "push";
type EvidenceRow = {
  id: string;
  provider_game_id: string;
  stage: "opening" | "unlocked" | "t60";
  captured_at: string;
  game_start_at: string;
  payload_sha256: string;
  payload: NflForwardEvidencePayload;
};
type Grade = {
  result: Result | "void" | "pending";
  actual_home_score: number | null;
  actual_away_score: number | null;
};
type PredictionRecord = {
  id: number;
  market: Market;
  pick: string | null;
  line_value: number | null;
  odds_american: number | null;
  play_grade: string | null;
  no_bet: boolean;
  best_angle: boolean;
  model_version: string | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: Grade | Grade[] | null;
};
type Signal = {
  family: string;
  side: Side | null;
  reason: string;
  sources: string[];
};
type Game = {
  providerGameId: string;
  week: number;
  away: string;
  home: string;
  lockedAt: string;
  kickoffAt: string;
  payloadSha256: string;
  payload: NflForwardEvidencePayload;
  history: EvidenceRow[];
  records: PredictionRecord[];
  actualHome: number | null;
  actualAway: number | null;
  states: Record<Market, NflMarketState>;
  targetExcludedStates: Record<Market, NflMarketState>;
  signals: Record<Market, Signal[]>;
};

const MARKETS: Market[] = ["moneyline", "spread", "total"];
// Payloads contain full multi-book history; keep each SELECT below the gateway's
// response-size/time envelope used by the production evidence reader.
const PAGE_SIZE = 250;

function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sign(value: number): Side {
  return value >= 0 ? 1 : -1;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function sideLabel(market: Market, side: Side): string {
  return market === "total" ? (side === 1 ? "over" : "under") : side === 1 ? "home" : "away";
}

function consensus(
  family: string,
  rows: NflMarketStateTrail[],
  direction: (trail: NflMarketStateTrail) => Side | null = (trail) => trail.direction,
  minimumSources = 2,
  minimumAgreement = 2 / 3,
): Signal {
  const moved = rows.flatMap((trail) => {
    const side = direction(trail);
    return side === null ? [] : [{ trail, side }];
  });
  if (moved.length < minimumSources) {
    return { family, side: null, reason: "insufficient_sources", sources: moved.map(({ trail }) => trail.source) };
  }
  const score = moved.reduce((sum, value) => sum + value.side, 0);
  const selected = sign(score === 0 ? moved[0]!.side : score);
  const aligned = moved.filter((value) => value.side === selected);
  if (aligned.length / moved.length < minimumAgreement) {
    return { family, side: null, reason: "book_disagreement", sources: moved.map(({ trail }) => trail.source) };
  }
  return { family, side: selected, reason: "consensus", sources: aligned.map(({ trail }) => trail.source) };
}

function splitSignal(state: NflMarketState, source: NflMarketState["splits"][number]["source"]): Signal {
  const rows = state.splits.filter((split) => split.source === source);
  if (rows.length === 0) return { family: `${source}_money_ticket_gap`, side: null, reason: "unavailable", sources: [] };
  const strongest = [...rows].sort((a, b) => Math.abs(b.gapPp) - Math.abs(a.gapPp))[0]!;
  return {
    family: `${source}_money_ticket_gap`,
    side: strongest.direction,
    reason: `${Math.abs(strongest.gapPp).toFixed(1)}pp_gap`,
    sources: [strongest.sportsbook ?? source],
  };
}

function publicTicketMajority(payload: NflForwardEvidencePayload, market: Market): Signal {
  const split = payload.market.playbookSplits?.[market];
  if (!split) return { family: "public_ticket_majority", side: null, reason: "unavailable", sources: [] };
  const first = market === "total" ? split.overBetsPct : split.homeBetsPct;
  const second = market === "total" ? split.underBetsPct : split.awayBetsPct;
  if (!Number.isFinite(first) || !Number.isFinite(second) || Math.abs((first as number) - (second as number)) < 10) {
    return { family: "public_ticket_majority", side: null, reason: "below_10pp", sources: ["public_consensus"] };
  }
  return {
    family: "public_ticket_majority",
    side: (first as number) > (second as number) ? 1 : -1,
    reason: `${Math.abs((first as number) - (second as number)).toFixed(1)}pp_majority`,
    sources: ["public_consensus"],
  };
}

function signalsForGame(game: Omit<Game, "signals">, market: Market): Signal[] {
  const state = game.states[market];
  const targetExcluded = game.targetExcludedStates[market];
  const named = consensus("named_book_direction", state.trails.filter((trail) => trail.sourceClass === "named"), undefined, 2, 1);
  const allBooks = consensus("all_book_direction", state.trails, undefined, 3, 2 / 3);
  const selectedBook = consensus(
    "selected_book_direction",
    state.trails.filter((trail) => canonical(trail.source) === canonical(game.payload.market.current.sportsbook)),
    undefined,
    1,
    1,
  );
  const number = consensus("number_movement", state.trails, (trail) => trail.numberDirection, 2, 2 / 3);
  const priceOnly = consensus(
    "price_only_movement",
    state.trails.filter((trail) => trail.numberDirection === null),
    (trail) => trail.priceDirection,
    2,
    2 / 3,
  );
  const numberAndPrice = consensus(
    "number_and_price_alignment",
    state.trails.filter((trail) => trail.numberDirection !== null && trail.priceDirection === trail.numberDirection),
    (trail) => trail.numberDirection,
    2,
    2 / 3,
  );
  const persistent = consensus(
    "persistent_movement",
    state.trails.filter((trail) => trail.persistenceTimeShare >= 2 / 3 && !trail.buybackToOpening),
    undefined,
    2,
    2 / 3,
  );
  const keyCrossing = consensus(
    "key_number_crossing",
    state.trails.filter((trail) => trail.crossedKeyNumbers.length > 0),
    (trail) => trail.numberDirection,
    1,
    1,
  );
  const publicGap = splitSignal(state, "public_consensus");
  const namedGap = splitSignal(state, "named_book");
  const retailGap = splitSignal(state, "retail_book");
  const unknownGap = splitSignal(state, "unknown_book");
  const tickets = publicTicketMajority(game.payload, market);
  const reverseLine = named.side !== null && tickets.side !== null && named.side !== tickets.side
    ? { family: "reverse_line_movement", side: named.side, reason: "named_price_against_public_tickets", sources: named.sources }
    : { family: "reverse_line_movement", side: null, reason: "not_observed", sources: named.sources };
  const flow = [namedGap, publicGap, retailGap, unknownGap].find((read) => read.side !== null) ?? null;
  const resistanceFollow = state.resistance !== "none" && flow?.side
    ? { family: "resistance_follow_flow", side: flow.side, reason: state.resistance, sources: flow.sources }
    : { family: "resistance_follow_flow", side: null, reason: state.resistance, sources: [] };
  const resistanceFade = state.resistance !== "none" && flow?.side
    ? { family: "resistance_fade_flow", side: -flow.side as Side, reason: state.resistance, sources: flow.sources }
    : { family: "resistance_fade_flow", side: null, reason: state.resistance, sources: [] };
  const targetBook = game.payload.decisions.evaluatedBets.find((decision) => decision.market === market)
    ?.evaluatedQuote.sportsbook ?? game.payload.market.current.sportsbook;
  const authority = buildNflNamedMarketSequenceAuthority({
    evaluatedAt: game.lockedAt,
    snapshots: game.history.flatMap((row) => row.payload.contextualEvidenceCapture
      ? [{ capturedAt: row.captured_at, markets: row.payload.contextualEvidenceCapture.markets }]
      : []),
    current: game.payload.market.current,
    playbookLine: game.payload.market.playbookLine,
    playbookSplits: game.payload.market.playbookSplits,
    sharpSplits: game.payload.market.sharpApiSplits,
    excludedFamiliesByMarket: { [market]: [targetBook] },
    minimumFollowerSources: 2,
  });
  const released = authority.reads[market];
  const releaseSide = released.side === "home" || released.side === "over" ? 1
    : released.side === "away" || released.side === "under" ? -1 : null;
  const sequence: Signal = {
    family: "qualified_named_sequence",
    side: releaseSide,
    reason: released.reason,
    sources: [...released.namedSources, ...released.followerSources],
  };
  const evaluatedSportsbook = (evaluatedMarket: Market) => game.payload.decisions.evaluatedBets
    .find((decision) => decision.market === evaluatedMarket)?.evaluatedQuote.sportsbook ??
    game.payload.market.current.sportsbook;
  const marginExcluded = [...new Set([evaluatedSportsbook("moneyline"), evaluatedSportsbook("spread")])];
  const professionalAuthority = buildNflProfessionalMarketAuthority({
    evaluatedAt: game.lockedAt,
    snapshots: game.history.flatMap((row) => row.payload.contextualEvidenceCapture
      ? [{ capturedAt: row.captured_at, markets: row.payload.contextualEvidenceCapture.markets }]
      : []),
    current: game.payload.market.current,
    playbookLine: game.payload.market.playbookLine,
    playbookSplits: game.payload.market.playbookSplits,
    sharpSplits: game.payload.market.sharpApiSplits,
    excludedFamiliesByMarket: {
      moneyline: marginExcluded,
      spread: marginExcluded,
      total: [evaluatedSportsbook("total")],
    },
  });
  const professionalRead = professionalAuthority.reads[market];
  const professionalSide = professionalRead.side === "home" || professionalRead.side === "over" ? 1
    : professionalRead.side === "away" || professionalRead.side === "under" ? -1 : null;
  const professionalSignal: Signal = {
    family: "professional_market_authority",
    side: professionalSide,
    reason: professionalRead.reason,
    sources: professionalRead.sources,
  };
  const targetExcludedNamed = consensus(
    "target_excluded_named_direction",
    targetExcluded.trails.filter((trail) => trail.sourceClass === "named"),
    undefined,
    2,
    1,
  );
  const targetExcludedAllBooks = consensus(
    "target_excluded_all_book_direction",
    targetExcluded.trails,
    undefined,
    3,
    2 / 3,
  );
  const targetExcludedNumber = consensus(
    "target_excluded_number_movement",
    targetExcluded.trails,
    (trail) => trail.numberDirection,
    2,
    2 / 3,
  );
  const targetExcludedNumberPrice = consensus(
    "target_excluded_number_and_price_alignment",
    targetExcluded.trails.filter((trail) => trail.numberDirection !== null && trail.priceDirection === trail.numberDirection),
    (trail) => trail.numberDirection,
    2,
    2 / 3,
  );
  const targetExcludedNumberSide = targetExcludedNumber.side;
  const targetExcludedAligned = targetExcludedNumberSide === null
    ? []
    : targetExcluded.trails.filter((trail) => trail.numberDirection === targetExcludedNumberSide);
  const targetExcludedOpposed = targetExcludedNumberSide === null
    ? []
    : targetExcluded.trails.filter((trail) => trail.numberDirection === -targetExcludedNumberSide);
  const targetExcludedNamedAligned = targetExcludedAligned.filter((trail) => trail.sourceClass === "named");
  const targetExcludedNamedOpposed = targetExcludedOpposed.filter((trail) => trail.sourceClass === "named");
  const namedNumberAuthority = targetExcludedNamedAligned.length >= 2;
  const broadStableRetailAuthority = targetExcludedNumberSide !== null &&
    targetExcludedAligned.length >= 5 &&
    targetExcludedOpposed.length === 0 &&
    targetExcludedNamedOpposed.length === 0 &&
    selectedBook.side === targetExcludedNumberSide &&
    targetExcludedAllBooks.side === targetExcludedNumberSide &&
    targetExcludedAligned.every((trail) => trail.persistenceTimeShare >= 2 / 3 &&
      trail.reversalMagnitude === 0 && !trail.buybackToOpening);
  const qualifiedTargetExcludedTotalNumber: Signal = market === "total" && targetExcludedNumberSide !== null &&
    (namedNumberAuthority || broadStableRetailAuthority)
    ? {
        family: "qualified_target_excluded_total_number",
        side: targetExcludedNumberSide,
        reason: namedNumberAuthority ? "two_named_number_moves" : "broad_stable_retail_number_move",
        sources: targetExcludedAligned.map((trail) => trail.source),
      }
    : {
        family: "qualified_target_excluded_total_number",
        side: null,
        reason: "insufficient_number_authority",
        sources: targetExcludedAligned.map((trail) => trail.source),
      };
  const continuousMagnitude = market === "moneyline"
    ? [0.5, 1, 1.5, 2, 3].map((minimum) => consensus(
        `price_consensus_ge_${String(minimum).replace(".", "p")}pp`,
        state.trails,
        (trail) => Math.abs(trail.fairProbabilityDeltaPp) >= minimum ? sign(trail.fairProbabilityDeltaPp) : null,
        2,
        2 / 3,
      ))
    : [0.5, 1, 1.5, 2, 3].map((minimum) => consensus(
        `number_consensus_ge_${String(minimum).replace(".", "p")}`,
        state.trails,
        (trail) => trail.numberDelta !== null && Math.abs(trail.numberDelta) >= minimum ? sign(trail.numberDelta) : null,
        2,
        2 / 3,
      ));
  const splitThresholds = [10, 15, 20, 25].flatMap((minimum): Signal[] => state.splits.flatMap((split) => {
    if (Math.abs(split.gapPp) < minimum) return [];
    return [{
      family: `${split.source}_gap_ge_${minimum}pp`,
      side: split.direction,
      reason: `${Math.abs(split.gapPp).toFixed(1)}pp_gap`,
      sources: [split.sportsbook ?? split.source],
    }];
  }));
  const firstMoveMinutes = (trail: NflMarketStateTrail) => {
    const first = [trail.firstNumberMoveAt, trail.firstPriceMoveAt]
      .filter((value): value is string => value !== null).sort()[0] ?? null;
    return first === null ? null : (Date.parse(game.lockedAt) - Date.parse(first)) / 60_000;
  };
  const timingSignals = [
    { family: "movement_under_1h", accepts: (minutes: number) => minutes < 60 },
    { family: "movement_1h_to_6h", accepts: (minutes: number) => minutes >= 60 && minutes < 360 },
    { family: "movement_6h_to_24h", accepts: (minutes: number) => minutes >= 360 && minutes < 1_440 },
    { family: "movement_over_24h", accepts: (minutes: number) => minutes >= 1_440 },
  ].map(({ family, accepts }) => consensus(
    family,
    state.trails.filter((trail) => {
      const minutes = firstMoveMinutes(trail);
      return minutes !== null && accepts(minutes);
    }),
    undefined,
    2,
    2 / 3,
  ));
  const resistanceByType = ["flow_resistance", "reverse_flow", "book_disagreement"] as const;
  const resistanceSignals = resistanceByType.flatMap((kind): Signal[] => {
    if (state.resistance !== kind || flow?.side === null || flow === null) return [];
    return [
      { family: `${kind}_follow_flow`, side: flow.side, reason: kind, sources: flow.sources },
      { family: `${kind}_fade_flow`, side: -flow.side as Side, reason: kind, sources: flow.sources },
    ];
  });
  const keySignals = market === "spread" ? [0, 3, 7].flatMap((key): Signal[] => {
    const rows = state.trails.filter((trail) => trail.crossedKeyNumbers.some((value) => Math.abs(value) === key));
    return [consensus(`crossed_${key}`, rows, (trail) => trail.numberDirection, 1, 1)];
  }) : [];
  return [
    selectedBook,
    named,
    allBooks,
    number,
    priceOnly,
    numberAndPrice,
    persistent,
    keyCrossing,
    publicGap,
    namedGap,
    retailGap,
    unknownGap,
    tickets,
    reverseLine,
    resistanceFollow,
    resistanceFade,
    sequence,
    professionalSignal,
    targetExcludedNamed,
    targetExcludedAllBooks,
    targetExcludedNumber,
    targetExcludedNumberPrice,
    qualifiedTargetExcludedTotalNumber,
    ...continuousMagnitude,
    ...splitThresholds,
    ...timingSignals,
    ...resistanceSignals,
    ...keySignals,
  ];
}

function marketLine(game: Game, market: Market): number | null {
  const decision = game.payload.decisions.evaluatedBets.find((value) => value.market === market);
  if (decision?.evaluatedQuote.line !== undefined) return decision.evaluatedQuote.line;
  return market === "spread" ? game.payload.market.current.spread?.homeLine ?? null
    : market === "total" ? game.payload.market.current.total?.line ?? null : null;
}

function settle(game: Game, market: Market, side: Side): Result | null {
  if (game.actualHome === null || game.actualAway === null) return null;
  const actualMargin = game.actualHome - game.actualAway;
  const line = marketLine(game, market);
  const value = market === "moneyline" ? actualMargin
    : market === "spread" && line !== null ? actualMargin + line
      : market === "total" && line !== null ? game.actualHome + game.actualAway - line : null;
  if (value === null) return null;
  if (Math.abs(value) < 1e-9) return "push";
  return sign(value) === side ? "win" : "loss";
}

function authoritativeSide(game: Game, market: Market): Side | null {
  const margin = game.payload.outcomeForecast.expectedHomeScore - game.payload.outcomeForecast.expectedAwayScore;
  const total = game.payload.outcomeForecast.expectedHomeScore + game.payload.outcomeForecast.expectedAwayScore;
  const line = marketLine(game, market);
  const value = market === "moneyline" ? margin
    : market === "spread" && line !== null ? margin + line
      : market === "total" && line !== null ? total - line : null;
  return value === null || Math.abs(value) < 1e-9 ? null : sign(value);
}

function exactPrice(game: Game, market: Market, side: Side): number | null {
  const decision = game.payload.decisions.evaluatedBets.find((value) => value.market === market);
  const targetBook = canonical(decision?.evaluatedQuote.sportsbook ?? game.payload.market.current.sportsbook);
  const targetLine = decision?.evaluatedQuote.line ?? marketLine(game, market);
  const books = [game.payload.market.current, ...game.payload.market.currentBooks];
  const quote = books.find((book) => {
    if (canonical(book.sportsbook) !== targetBook) return false;
    if (market === "spread") return book.spread && targetLine !== null && Math.abs(book.spread.homeLine - targetLine) < 0.001;
    if (market === "total") return book.total && targetLine !== null && Math.abs(book.total.line - targetLine) < 0.001;
    return book.moneyline !== null;
  }) ?? game.payload.market.current;
  if (market === "moneyline") return side === 1 ? quote.moneyline?.homePrice ?? null : quote.moneyline?.awayPrice ?? null;
  if (market === "spread") return side === 1 ? quote.spread?.homePrice ?? null : quote.spread?.awayPrice ?? null;
  return side === 1 ? quote.total?.overPrice ?? null : quote.total?.underPrice ?? null;
}

function units(result: Result, price: number | null): number | null {
  if (price === null) return null;
  if (result === "push") return 0;
  if (result === "loss") return -1;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function wilson95(wins: number, losses: number): [number, number] | null {
  const n = wins + losses;
  if (n === 0) return null;
  const z = 1.959963984540054;
  const p = wins / n;
  const denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denominator;
  return [center - half, center + half];
}

function timingBin(minutes: number): string {
  if (minutes < 60) return "under_1h";
  if (minutes < 360) return "1h_to_6h";
  if (minutes < 1_440) return "6h_to_24h";
  return "over_24h";
}

function magnitudeBin(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude < 0.5) return "under_0.5";
  if (magnitude < 1) return "0.5_to_1";
  if (magnitude < 2) return "1_to_2";
  if (magnitude < 3) return "2_to_3";
  return "3_plus";
}

function summarizeSignal(games: Game[], market: Market, family: string) {
  const rows = games.flatMap((game) => {
    const signal = game.signals[market].find((value) => value.family === family);
    if (!signal || signal.side === null) return [];
    const result = settle(game, market, signal.side);
    const official = authoritativeSide(game, market);
    const officialResult = official === null ? null : settle(game, market, official);
    const price = result === null ? null : exactPrice(game, market, signal.side);
    return [{ game, signal, result, official, officialResult, price }];
  });
  const settledRows = rows.filter((row): row is typeof row & { result: Result } => row.result !== null);
  const resolved = settledRows.filter((row) => row.result !== "push");
  const wins = resolved.filter((row) => row.result === "win").length;
  const disagreements = settledRows.filter((row) => row.official !== null && row.official !== row.signal.side);
  const corrections = disagreements.filter((row) => row.result === "win" && row.officialResult === "loss");
  const harms = disagreements.filter((row) => row.result === "loss" && row.officialResult === "win");
  const unitRows = settledRows.flatMap((row) => {
    const value = units(row.result, row.price);
    return value === null ? [] : [value];
  });
  return {
    coverage: rows.length,
    settled: settledRows.length,
    wins,
    losses: resolved.length - wins,
    pushes: settledRows.length - resolved.length,
    accuracy: resolved.length ? wins / resolved.length : null,
    accuracyWilson95: wilson95(wins, resolved.length - wins),
    exactPriceUnits: unitRows.length === settledRows.length ? unitRows.reduce((sum, value) => sum + value, 0) : null,
    exactPriceCoverage: unitRows.length,
    disagreements: disagreements.length,
    corrections: corrections.length,
    harms: harms.length,
    byWeek: Object.fromEntries([...new Set(games.map((game) => game.week))].map((week) => {
      const selected = settledRows.filter((row) => row.game.week === week);
      const selectedResolved = selected.filter((row) => row.result !== "push");
      const selectedWins = selectedResolved.filter((row) => row.result === "win").length;
      return [week, { coverage: selected.length, wins: selectedWins, losses: selectedResolved.length - selectedWins, pushes: selected.length - selectedResolved.length }];
    })),
    byIndependentRelease: Object.fromEntries([...new Set(rows.map((row) => row.game.payload.decisions.modelPromotionStatus))]
      .map((release) => {
        const selected = settledRows.filter((row) => row.game.payload.decisions.modelPromotionStatus === release);
        const selectedResolved = selected.filter((row) => row.result !== "push");
        const selectedWins = selectedResolved.filter((row) => row.result === "win").length;
        return [release, { coverage: selected.length, wins: selectedWins, losses: selectedResolved.length - selectedWins, pushes: selected.length - selectedResolved.length }];
      })),
    correctionHarmLedger: disagreements.map((row) => ({
      week: row.game.week,
      game: `${row.game.away}@${row.game.home}`,
      independentRelease: row.game.payload.decisions.modelPromotionStatus,
      signalSide: sideLabel(market, row.signal.side!),
      authoritativeSide: sideLabel(market, row.official!),
      signalResult: row.result,
      authoritativeResult: row.officialResult,
      reason: row.signal.reason,
      sources: row.signal.sources,
      exactLine: marketLine(row.game, market),
      exactPrice: row.price,
    })),
  };
}

type CandidatePolicy = "incumbent" | "strict_sequence" | "number_price" | "total_selected" |
  "total_number" | "total_all_book" | "two_of_three" | "professional_composite" |
  "target_excluded_number_price" | "target_excluded_total_number" | "target_excluded_composite" |
  "qualified_professional_composite";

function signal(game: Game, market: Market, family: string): Signal | null {
  return game.signals[market].find((value) => value.family === family) ?? null;
}

function twoOfThree(game: Game, market: Market): Signal {
  const reads = [
    signal(game, market, "selected_book_direction"),
    signal(game, market, "all_book_direction"),
    signal(game, market, market === "moneyline" ? "price_consensus_ge_1pp" : "number_movement"),
  ].filter((value): value is Signal & { side: Side } => value?.side !== null && value?.side !== undefined);
  const positive = reads.filter((value) => value.side === 1);
  const negative = reads.filter((value) => value.side === -1);
  const aligned = positive.length >= 2 ? positive : negative.length >= 2 ? negative : [];
  return aligned.length >= 2
    ? { family: "two_of_three", side: aligned[0]!.side, reason: "two_independent_price_families", sources: [...new Set(aligned.flatMap((value) => value.sources))] }
    : { family: "two_of_three", side: null, reason: "no_two_family_agreement", sources: [] };
}

function candidateRead(game: Game, market: Market, policy: CandidatePolicy): Signal | null {
  if (policy === "incumbent") return null;
  if (policy === "strict_sequence") return signal(game, market, "qualified_named_sequence");
  if (policy === "number_price") return signal(game, market, "number_and_price_alignment");
  if (policy === "total_selected") return market === "total" ? signal(game, market, "selected_book_direction") : null;
  if (policy === "total_number") return market === "total" ? signal(game, market, "number_movement") : null;
  if (policy === "total_all_book") return market === "total" ? signal(game, market, "all_book_direction") : null;
  if (policy === "two_of_three") return twoOfThree(game, market);
  if (policy === "target_excluded_number_price") {
    return signal(game, market, "target_excluded_number_and_price_alignment");
  }
  if (policy === "target_excluded_total_number") {
    return market === "total" ? signal(game, market, "target_excluded_number_movement") : null;
  }
  if (policy === "target_excluded_composite") {
    if (market === "total") return signal(game, market, "target_excluded_number_movement");
    if (market === "spread") return signal(game, market, "target_excluded_number_and_price_alignment");
    const named = signal(game, market, "target_excluded_named_direction");
    const spread = candidateRead(game, "spread", "target_excluded_composite");
    const homeLine = marketLine(game, "spread");
    return named?.side !== null && named?.side !== undefined && spread?.side === named.side &&
      homeLine !== null && Math.abs(homeLine) <= 3
      ? { ...named, family: "target_excluded_joint_short_spread_named_winner" }
      : null;
  }
  if (policy === "qualified_professional_composite") {
    return signal(game, market, "professional_market_authority");
  }
  if (market === "total") return twoOfThree(game, market);
  if (market === "spread") {
    const sequence = signal(game, market, "qualified_named_sequence");
    return sequence?.side !== null ? sequence : signal(game, market, "number_and_price_alignment");
  }
  const named = signal(game, market, "named_book_direction");
  const spread = candidateRead(game, "spread", "professional_composite");
  const homeLine = marketLine(game, "spread");
  return named?.side !== null && named?.side !== undefined && spread?.side === named.side && homeLine !== null && Math.abs(homeLine) <= 3
    ? { ...named, family: "joint_short_spread_named_winner" }
    : null;
}

function candidateProjection(game: Game, policy: CandidatePolicy) {
  const incumbentMargin = game.payload.outcomeForecast.expectedHomeScore - game.payload.outcomeForecast.expectedAwayScore;
  const incumbentTotal = game.payload.outcomeForecast.expectedHomeScore + game.payload.outcomeForecast.expectedAwayScore;
  let margin = incumbentMargin;
  let total = incumbentTotal;
  const spreadLine = marketLine(game, "spread");
  const totalLine = marketLine(game, "total");
  const spread = candidateRead(game, "spread", policy);
  if (spread?.side !== null && spread?.side !== undefined && spreadLine !== null && sign(margin + spreadLine) !== spread.side) {
    margin = 2 * -spreadLine - margin;
  }
  const incumbentWinner = sign(incumbentMargin);
  if (sign(margin) !== incumbentWinner) {
    const corroboratingMoneyline = candidateRead(game, "moneyline", policy);
    if (corroboratingMoneyline?.side !== sign(margin)) margin = incumbentWinner * 0.25;
  }
  const moneyline = candidateRead(game, "moneyline", policy);
  if (moneyline?.side !== null && moneyline?.side !== undefined && sign(margin) !== moneyline.side) {
    const relatedSpread = candidateRead(game, "spread", policy);
    if (relatedSpread?.side === moneyline.side) margin = -margin;
  }
  const totalRead = candidateRead(game, "total", policy);
  if (totalRead?.side !== null && totalRead?.side !== undefined && totalLine !== null && sign(total - totalLine) !== totalRead.side) {
    total = 2 * totalLine - total;
  }
  total = Math.max(total, Math.abs(margin) + 1);
  return {
    margin,
    total,
    home: (total + margin) / 2,
    away: (total - margin) / 2,
    reads: { moneyline, spread, total: totalRead },
  };
}

function candidateSummary(games: Game[], policy: CandidatePolicy) {
  const settledGames = games.filter((game): game is Game & { actualHome: number; actualAway: number } =>
    game.actualHome !== null && game.actualAway !== null);
  const rows = settledGames.map((game) => ({ game, projection: candidateProjection(game, policy) }));
  const markets = Object.fromEntries(MARKETS.map((market) => {
    const results = rows.map(({ game, projection }) => {
      const line = marketLine(game, market);
      const value = market === "moneyline" ? projection.margin
        : market === "spread" && line !== null ? projection.margin + line
          : market === "total" && line !== null ? projection.total - line : null;
      const candidate = value === null || Math.abs(value) < 1e-9 ? null : sign(value);
      const incumbent = authoritativeSide(game, market);
      const result = candidate === null ? null : settle(game, market, candidate);
      const incumbentResult = incumbent === null ? null : settle(game, market, incumbent);
      return { game, candidate, incumbent, result, incumbentResult };
    }).filter((row): row is typeof row & { candidate: Side; result: Result } => row.candidate !== null && row.result !== null);
    const resolved = results.filter((row) => row.result !== "push");
    const wins = resolved.filter((row) => row.result === "win").length;
    const changed = results.filter((row) => row.incumbent !== null && row.candidate !== row.incumbent);
    return [market, {
      rows: results.length,
      wins,
      losses: resolved.length - wins,
      pushes: results.length - resolved.length,
      accuracy: resolved.length ? wins / resolved.length : null,
      accuracyWilson95: wilson95(wins, resolved.length - wins),
      changed: changed.length,
      corrections: changed.filter((row) => row.result === "win" && row.incumbentResult === "loss").length,
      harms: changed.filter((row) => row.result === "loss" && row.incumbentResult === "win").length,
      byWeek: Object.fromEntries([...new Set(results.map((row) => row.game.week))].map((week) => {
        const selected = results.filter((row) => row.game.week === week);
        const selectedResolved = selected.filter((row) => row.result !== "push");
        const selectedWins = selectedResolved.filter((row) => row.result === "win").length;
        return [week, { wins: selectedWins, losses: selectedResolved.length - selectedWins, pushes: selected.length - selectedResolved.length }];
      })),
      changeLedger: changed.map((row) => ({
        week: row.game.week,
        game: `${row.game.away}@${row.game.home}`,
        independentRelease: row.game.payload.decisions.modelPromotionStatus,
        incumbent: sideLabel(market, row.incumbent!),
        candidate: sideLabel(market, row.candidate),
        incumbentResult: row.incumbentResult,
        candidateResult: row.result,
        candidateRead: candidateRead(row.game, market, policy),
        targetExcludedState: {
          resistance: row.game.targetExcludedStates[market].resistance,
          splits: row.game.targetExcludedStates[market].splits,
          trails: row.game.targetExcludedStates[market].trails.map((trail) => ({
            source: trail.source,
            sourceClass: trail.sourceClass,
            numberDelta: trail.numberDelta,
            fairProbabilityDeltaPp: trail.fairProbabilityDeltaPp,
            numberDirection: trail.numberDirection,
            priceDirection: trail.priceDirection,
            moveOrder: trail.moveOrder,
            persistence: trail.persistenceTimeShare,
            reversalMagnitude: trail.reversalMagnitude,
            buyback: trail.buybackToOpening,
            firstNumberMoveAt: trail.firstNumberMoveAt,
            firstPriceMoveAt: trail.firstPriceMoveAt,
          })),
        },
        selectedBookRead: signal(row.game, market, "selected_book_direction"),
        namedBookRead: signal(row.game, market, "target_excluded_named_direction"),
      })),
    }];
  }));
  return {
    markets,
    score: {
      teamMae: mean(rows.map(({ game, projection }) =>
        (Math.abs(projection.home - game.actualHome) + Math.abs(projection.away - game.actualAway)) / 2)),
      marginMae: mean(rows.map(({ game, projection }) => Math.abs(projection.margin - (game.actualHome - game.actualAway)))),
      totalMae: mean(rows.map(({ game, projection }) => Math.abs(projection.total - (game.actualHome + game.actualAway)))),
    },
  };
}

function trailInformation(games: Game[], market: Market) {
  const rows = games.flatMap((game) => {
    if (game.actualHome === null || game.actualAway === null) return [];
    const actualMargin = game.actualHome - game.actualAway;
    const actualTotal = game.actualHome + game.actualAway;
    return game.states[market].trails.map((trail) => {
      const openingError = market === "moneyline"
        ? (trail.openingFairFirstProbability - (actualMargin > 0 ? 1 : 0)) ** 2
        : Math.abs((trail.openingNumber as number) - (market === "spread" ? actualMargin : actualTotal));
      const currentError = market === "moneyline"
        ? (trail.currentFairFirstProbability - (actualMargin > 0 ? 1 : 0)) ** 2
        : Math.abs((trail.currentNumber as number) - (market === "spread" ? actualMargin : actualTotal));
      const firstMoveAt = [trail.firstNumberMoveAt, trail.firstPriceMoveAt].filter((value): value is string => value !== null).sort()[0] ?? null;
      const minutesToLock = firstMoveAt === null ? null : (Date.parse(game.lockedAt) - Date.parse(firstMoveAt)) / 60_000;
      const magnitude = trail.numberDelta ?? trail.fairProbabilityDeltaPp;
      return {
        week: game.week,
        game: `${game.away}@${game.home}`,
        source: trail.source,
        sourceClass: trail.sourceClass,
        moveOrder: trail.moveOrder,
        direction: trail.direction,
        openingError,
        currentError,
        improvement: openingError - currentError,
        improved: currentError < openingError,
        minutesToLock,
        timingBin: minutesToLock === null ? "no_material_move" : timingBin(minutesToLock),
        magnitude,
        magnitudeBin: magnitudeBin(magnitude),
        persistence: trail.persistenceTimeShare,
        buyback: trail.buybackToOpening,
        reversalMagnitude: trail.reversalMagnitude,
        crossedKeyNumbers: trail.crossedKeyNumbers,
      };
    });
  });
  const grouped = <T extends string>(selector: (row: typeof rows[number]) => T) => Object.fromEntries(
    [...new Set(rows.map(selector))].map((key) => {
      const selected = rows.filter((row) => selector(row) === key);
      return [key, {
        rows: selected.length,
        improved: selected.filter((row) => row.improved).length,
        meanErrorImprovement: mean(selected.map((row) => row.improvement)),
      }];
    }),
  );
  return {
    rows: rows.length,
    improved: rows.filter((row) => row.improved).length,
    meanErrorImprovement: mean(rows.map((row) => row.improvement)),
    bySourceClass: grouped((row) => row.sourceClass),
    byMoveOrder: grouped((row) => row.moveOrder),
    byTiming: grouped((row) => row.timingBin),
    byMagnitude: grouped((row) => row.magnitudeBin),
    buybacks: rows.filter((row) => row.buyback).length,
    reversals: rows.filter((row) => row.reversalMagnitude > 0).length,
    keyCrossings: rows.filter((row) => row.crossedKeyNumbers.length > 0).length,
    ledger: rows,
  };
}

function interactionLedger(games: Game[]) {
  return games.flatMap((game) => MARKETS.flatMap((market) => {
    const official = authoritativeSide(game, market);
    const officialResult = official === null ? null : settle(game, market, official);
    const reads = game.signals[market].filter((signal) => signal.side !== null);
    const disagreements = reads.filter((signal) => official !== null && signal.side !== official);
    const agreements = reads.filter((signal) => official !== null && signal.side === official);
    if (officialResult !== "loss" && disagreements.length === 0) return [];
    return [{
      week: game.week,
      game: `${game.away}@${game.home}`,
      market,
      independentRelease: game.payload.decisions.modelPromotionStatus,
      authoritativeSide: official === null ? null : sideLabel(market, official),
      authoritativeResult: officialResult,
      exactLine: marketLine(game, market),
      disagreements: disagreements.map((signal) => ({
        family: signal.family,
        side: sideLabel(market, signal.side!),
        result: settle(game, market, signal.side!),
        reason: signal.reason,
        sources: signal.sources,
      })),
      confirmations: agreements.map((signal) => ({ family: signal.family, result: settle(game, market, signal.side!) })),
    }];
  }));
}

function jointMarketLedger(games: Game[]) {
  return games.flatMap((game) => {
    const moneyline = game.signals.moneyline.find((signal) => signal.family === "qualified_named_sequence");
    const spread = game.signals.spread.find((signal) => signal.family === "qualified_named_sequence");
    const line = marketLine(game, "spread");
    const shortSpread = line !== null && Math.abs(line) <= 2.5;
    if (!shortSpread && moneyline?.side === null && spread?.side === null) return [];
    return [{
      week: game.week,
      game: `${game.away}@${game.home}`,
      homeSpread: line,
      shortSpread,
      moneylineSide: moneyline?.side === null || moneyline?.side === undefined ? null : sideLabel("moneyline", moneyline.side),
      spreadSide: spread?.side === null || spread?.side === undefined ? null : sideLabel("spread", spread.side),
      agreement: moneyline?.side !== null && moneyline?.side !== undefined && moneyline.side === spread?.side,
      actualWinner: game.actualHome === null || game.actualAway === null ? null : game.actualHome > game.actualAway ? "home" : "away",
      moneylineResult: moneyline?.side === null || moneyline?.side === undefined ? null : settle(game, "moneyline", moneyline.side),
      spreadResult: spread?.side === null || spread?.side === undefined ? null : settle(game, "spread", spread.side),
    }];
  });
}

function dataCoverage(games: Game[]) {
  return {
    lockedGames: games.length,
    settledGames: games.filter((game) => game.actualHome !== null && game.actualAway !== null).length,
    byWeek: Object.fromEntries([...new Set(games.map((game) => game.week))].map((week) => [week, {
      games: games.filter((game) => game.week === week).length,
      settled: games.filter((game) => game.week === week && game.actualHome !== null && game.actualAway !== null).length,
    }])),
    byIndependentRelease: Object.fromEntries([...new Set(games.map((game) => game.payload.decisions.modelPromotionStatus))]
      .map((release) => [release, games.filter((game) => game.payload.decisions.modelPromotionStatus === release).length])),
    marketCoverage: Object.fromEntries(MARKETS.map((market) => [market, {
      anyTrail: games.filter((game) => game.states[market].trails.length > 0).length,
      twoNamedTrails: games.filter((game) => game.states[market].trails.filter((trail) => trail.sourceClass === "named").length >= 2).length,
      publicSplit: games.filter((game) => game.states[market].splits.some((split) => split.source === "public_consensus")).length,
      namedBookSplit: games.filter((game) => game.states[market].splits.some((split) => split.source === "named_book")).length,
      retailBookSplit: games.filter((game) => game.states[market].splits.some((split) => split.source === "retail_book")).length,
      unknownBookSplit: games.filter((game) => game.states[market].splits.some((split) => split.source === "unknown_book")).length,
      qualifiedNamedSequence: games.filter((game) => game.signals[market]
        .some((signal) => signal.family === "qualified_named_sequence" && signal.side !== null)).length,
      resistance: games.filter((game) => game.states[market].resistance !== "none").length,
      buyback: games.filter((game) => game.states[market].trails.some((trail) => trail.buybackToOpening)).length,
      reversal: games.filter((game) => game.states[market].trails.some((trail) => trail.reversalMagnitude > 0)).length,
    }])),
    unavailableEverywhere: {
      absoluteHandle: true,
      ticketCount: true,
      betSize: true,
      limits: true,
      originatingMarket: true,
      suspensionLifecycle: true,
    },
  };
}

async function readAll<T>(queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await queryPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const evidence = await readAll<EvidenceRow>((from, to) => client.from("nfl_forward_evidence_snapshots")
    .select("id,provider_game_id,stage,captured_at,game_start_at,payload_sha256,payload")
    .eq("season", 2026)
    .eq("evidence_release", NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE)
    .order("captured_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to) as never);
  const records = await readAll<PredictionRecord>((from, to) => client.from("prediction_records")
    .select("id,market,pick,line_value,odds_american,play_grade,no_bet,best_angle,model_version,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
    .eq("sport", "nfl")
    .not("locked_at", "is", null)
    .in("market", MARKETS)
    .order("id", { ascending: true })
    .range(from, to) as never);
  const recordsByHash = new Map<string, PredictionRecord[]>();
  for (const record of records) {
    if (typeof record.snapshot_json?.supersedes_prediction_record_id === "number") continue;
    const hash = record.snapshot_json?.evidence_payload_sha256;
    if (typeof hash === "string") recordsByHash.set(hash, [...(recordsByHash.get(hash) ?? []), record]);
  }
  const historyByGame = new Map<string, EvidenceRow[]>();
  for (const row of evidence) {
    historyByGame.set(row.provider_game_id, [...(historyByGame.get(row.provider_game_id) ?? []), row]);
  }
  const games = evidence.filter((row) => row.stage === "t60").map((lock): Game => {
    const payload = lock.payload;
    const history = (historyByGame.get(lock.provider_game_id) ?? [])
      .filter((row) => Date.parse(row.captured_at) <= Date.parse(lock.captured_at));
    const snapshots = history.flatMap((row) => row.payload.contextualEvidenceCapture
      ? [{ capturedAt: row.captured_at, markets: row.payload.contextualEvidenceCapture.markets }]
      : []);
    const states = Object.fromEntries(MARKETS.map((market) => [market, buildNflMarketState({
      market,
      evaluatedAt: lock.captured_at,
      snapshots,
      current: payload.market.current,
      playbookLine: payload.market.playbookLine,
      playbookSplits: payload.market.playbookSplits,
      sharpSplits: payload.market.sharpApiSplits,
    })])) as Record<Market, NflMarketState>;
    const targetExcludedStates = Object.fromEntries(MARKETS.map((market) => {
      const evaluatedBook = payload.decisions.evaluatedBets.find((decision) => decision.market === market)
        ?.evaluatedQuote.sportsbook ?? payload.market.current.sportsbook;
      return [market, buildNflMarketState({
        market,
        evaluatedAt: lock.captured_at,
        snapshots,
        excludedFamilies: [evaluatedBook],
        current: payload.market.current,
        playbookLine: payload.market.playbookLine,
        playbookSplits: payload.market.playbookSplits,
        sharpSplits: payload.market.sharpApiSplits,
      })];
    })) as Record<Market, NflMarketState>;
    const related = recordsByHash.get(lock.payload_sha256) ?? [];
    const grade = one(related.find((record) => one(record.prediction_grades)?.actual_home_score !== null)?.prediction_grades ?? null);
    const base = {
      providerGameId: lock.provider_game_id,
      week: payload.week,
      away: payload.game.away.abbreviation,
      home: payload.game.home.abbreviation,
      lockedAt: new Date(lock.captured_at).toISOString(),
      kickoffAt: new Date(lock.game_start_at).toISOString(),
      payloadSha256: lock.payload_sha256,
      payload,
      history,
      records: related,
      actualHome: Number.isFinite(grade?.actual_home_score) ? grade!.actual_home_score : null,
      actualAway: Number.isFinite(grade?.actual_away_score) ? grade!.actual_away_score : null,
      states,
      targetExcludedStates,
    };
    return { ...base, signals: Object.fromEntries(MARKETS.map((market) => [market, signalsForGame(base as Game, market)])) as Record<Market, Signal[]> };
  }).sort((a, b) => a.week - b.week || a.kickoffAt.localeCompare(b.kickoffAt));
  const families = [...new Set(games.flatMap((game) => MARKETS.flatMap((market) => game.signals[market].map((signal) => signal.family))))];
  const signalScorecards = Object.fromEntries(families.map((family) => [family,
    Object.fromEntries(MARKETS.map((market) => [market, summarizeSignal(games, market, family)])),
  ]));
  const candidatePolicies: CandidatePolicy[] = [
    "incumbent",
    "strict_sequence",
    "number_price",
    "total_selected",
    "total_number",
    "total_all_book",
    "two_of_three",
    "professional_composite",
    "target_excluded_number_price",
    "target_excluded_total_number",
    "target_excluded_composite",
    "qualified_professional_composite",
  ];
  const candidates = Object.fromEntries(candidatePolicies.map((policy) => [policy, candidateSummary(games, policy)]));
  const report = {
    release: "nfl_2026_professional_market_reader_certification_r1",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    providerCalls: 0,
    writes: 0,
    evidenceRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
    coverage: dataCoverage(games),
    informationQuality: Object.fromEntries(MARKETS.map((market) => [market, trailInformation(games, market)])),
    signalScorecards,
    candidates,
    jointMoneylineSpread: jointMarketLedger(games),
    lossesAndConflicts: interactionLedger(games),
  };
  if (process.argv.includes("--qualified")) {
    console.log(JSON.stringify({
      qualifiedTotalSignal: signalScorecards.qualified_target_excluded_total_number,
      qualifiedComposite: candidates.qualified_professional_composite,
    }, null, 2));
    return;
  }
  if (process.argv.includes("--total-ledger")) {
    const rows = games.flatMap((game) => {
      const read = candidateRead(game, "total", "target_excluded_total_number");
      const incumbent = authoritativeSide(game, "total");
      if (read?.side === null || read?.side === undefined || incumbent === null || read.side === incumbent) return [];
      const candidateSide = read.side;
      const state = game.targetExcludedStates.total;
      const aligned = state.trails.filter((trail) => trail.numberDirection === candidateSide);
      const opposed = state.trails.filter((trail) => trail.numberDirection === -candidateSide);
      const firstMoves = aligned.flatMap((trail) => trail.firstNumberMoveAt ? [trail.firstNumberMoveAt] : []);
      const totalLine = marketLine(game, "total");
      return [{
        week: game.week,
        game: `${game.away}@${game.home}`,
        independentRelease: game.payload.decisions.modelPromotionStatus,
        incumbent: sideLabel("total", incumbent),
        candidate: sideLabel("total", candidateSide),
        incumbentResult: settle(game, "total", incumbent),
        candidateResult: settle(game, "total", candidateSide),
        line: totalLine,
        actualTotal: game.actualHome === null || game.actualAway === null ? null : game.actualHome + game.actualAway,
        incumbentProjection: game.payload.outcomeForecast.expectedHomeScore + game.payload.outcomeForecast.expectedAwayScore,
        sources: read.sources,
        alignedSources: aligned.length,
        opposedSources: opposed.length,
        namedAligned: aligned.filter((trail) => trail.sourceClass === "named").length,
        namedOpposed: opposed.filter((trail) => trail.sourceClass === "named").length,
        selectedBookSide: signal(game, "total", "selected_book_direction")?.side ?? null,
        allBookSide: signal(game, "total", "all_book_direction")?.side ?? null,
        numberPriceAlignedSources: aligned.filter((trail) => trail.priceDirection === read.side).length,
        persistentSources: aligned.filter((trail) => trail.persistenceTimeShare >= 2 / 3).length,
        reversalSources: aligned.filter((trail) => trail.reversalMagnitude > 0).length,
        buybackSources: state.trails.filter((trail) => trail.buybackToOpening).length,
        meanAlignedNumberMove: mean(aligned.flatMap((trail) => trail.numberDelta === null ? [] : [Math.abs(trail.numberDelta)])),
        minutesFromFirstAlignedMove: firstMoves.length
          ? (Date.parse(game.lockedAt) - Math.min(...firstMoves.map(Date.parse))) / 60_000
          : null,
        minutesFromLastAlignedMove: firstMoves.length
          ? (Date.parse(game.lockedAt) - Math.max(...firstMoves.map(Date.parse))) / 60_000
          : null,
        resistance: state.resistance,
        splits: state.splits,
      }];
    });
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (process.argv.includes("--focus")) {
    console.log(JSON.stringify({
      targetExcludedComposite: candidates.target_excluded_composite,
      targetExcludedNumberSignal: signalScorecards.target_excluded_number_movement,
      targetExcludedNumberPriceSignal: signalScorecards.target_excluded_number_and_price_alignment,
    }, null, 2));
    return;
  }
  if (process.argv.includes("--candidates")) {
    const targetFamilies = [
      "qualified_named_sequence",
      "target_excluded_named_direction",
      "target_excluded_all_book_direction",
      "target_excluded_number_movement",
      "target_excluded_number_and_price_alignment",
    ];
    console.log(JSON.stringify({
      release: report.release,
      coverage: report.coverage,
      targetExcludedSignals: Object.fromEntries(targetFamilies.map((family) => [family, signalScorecards[family]])),
      candidates: Object.fromEntries(Object.entries(candidates).map(([policy, value]) => [policy, {
        markets: Object.fromEntries(Object.entries(value.markets).map(([market, summary]) => [market, {
          rows: summary.rows,
          wins: summary.wins,
          losses: summary.losses,
          pushes: summary.pushes,
          changed: summary.changed,
          corrections: summary.corrections,
          harms: summary.harms,
          byWeek: summary.byWeek,
          changeLedger: summary.changeLedger,
        }])),
        score: value.score,
      }])),
    }, null, 2));
    return;
  }
  if (process.env.NFL_PROFESSIONAL_MARKET_AUDIT_SUMMARY_ONLY === "1" || process.argv.includes("--summary")) {
    const compactScorecards = Object.fromEntries(Object.entries(signalScorecards).map(([family, markets]) => [family,
      Object.fromEntries(Object.entries(markets).map(([market, value]) => [market, {
        coverage: value.coverage,
        settled: value.settled,
        wins: value.wins,
        losses: value.losses,
        pushes: value.pushes,
        exactPriceUnits: value.exactPriceUnits,
        disagreements: value.disagreements,
        corrections: value.corrections,
        harms: value.harms,
      }])),
    ]));
    console.log(JSON.stringify({
      release: report.release,
      generatedAt: report.generatedAt,
      readOnly: true,
      providerCalls: 0,
      writes: 0,
      coverage: report.coverage,
      informationQuality: Object.fromEntries(MARKETS.map((market) => [market, {
        rows: report.informationQuality[market].rows,
        improved: report.informationQuality[market].improved,
        meanErrorImprovement: report.informationQuality[market].meanErrorImprovement,
        bySourceClass: report.informationQuality[market].bySourceClass,
        byMoveOrder: report.informationQuality[market].byMoveOrder,
        byTiming: report.informationQuality[market].byTiming,
        byMagnitude: report.informationQuality[market].byMagnitude,
        buybacks: report.informationQuality[market].buybacks,
        reversals: report.informationQuality[market].reversals,
        keyCrossings: report.informationQuality[market].keyCrossings,
      }])),
      signalScorecards: compactScorecards,
      candidates: Object.fromEntries(Object.entries(candidates).map(([policy, value]) => [policy, {
        markets: Object.fromEntries(Object.entries(value.markets).map(([market, summary]) => [market, {
          rows: summary.rows,
          wins: summary.wins,
          losses: summary.losses,
          pushes: summary.pushes,
          changed: summary.changed,
          corrections: summary.corrections,
          harms: summary.harms,
          byWeek: summary.byWeek,
        }])),
        score: value.score,
      }])),
      jointMoneylineSpreadRows: report.jointMoneylineSpread.length,
      lossesAndConflictsRows: report.lossesAndConflicts.length,
    }, null, 2));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
