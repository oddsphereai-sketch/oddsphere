/** SELECT-only NFL market-sequence audit. No provider calls and no writes. */

import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/db/supabase";
import { readNflForwardEvidence } from "@/lib/services/football/nflForwardEvidenceStore";
import type { NflForwardContextFamily } from "@/lib/services/football/nflForwardEvidenceCapture";
import type {
  NflForwardEvidencePayload,
  NflForwardStoredEvidence,
} from "@/lib/services/football/nflForwardEvidence";
import { buildNflNamedMarketSequenceAuthority } from "@/lib/services/football/nflNamedMarketSequence";

type Market = "moneyline" | "spread" | "total";
type Side = -1 | 1;
type Result = "win" | "loss" | "push";
type Grade = {
  result: Result | "void" | "pending";
  actual_home_score: number | null;
  actual_away_score: number | null;
};
type RecordRow = {
  id: number;
  market: Market;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: Grade | Grade[] | null;
};
type Trail = {
  source: string;
  sourceClass: "named" | "retail";
  openingAxis: number;
  currentAxis: number;
  movement: number;
  direction: Side | null;
  firstMoveAt: string | null;
  persistence: number;
  reversed: boolean;
  observations: number;
};
type Signal = {
  side: Side | null;
  reason: string;
  sources: string[];
};
type EvidenceTier = 0 | 1 | 2 | 3;
type TieredRead = Signal & { tier: EvidenceTier; alignedFamilies: string[]; conflicts: string[] };
type TierWeights = Record<Exclude<EvidenceTier, 0>, number>;
type Game = {
  id: string;
  week: number;
  away: string;
  home: string;
  kickoffAt: string;
  actualAway: number;
  actualHome: number;
  homeLine: number;
  totalLine: number;
  payload: NflForwardEvidencePayload;
  histories: NflForwardStoredEvidence[];
  trails: Record<Market, Trail[]>;
};

const MARKETS: Market[] = ["moneyline", "spread", "total"];
const NAMED = new Set(["circa", "pinnacle", "bookmaker"]);

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function fairHome(landmark: NflForwardContextFamily[5]): number {
  const away = implied(landmark[4]);
  const home = implied(landmark[5]);
  return home / (away + home);
}

function threshold(market: Market): number {
  return market === "moneyline" ? 0.01 : 0.5;
}

function axis(market: Market, landmark: NflForwardContextFamily[5]): number | null {
  if (market === "moneyline") return fairHome(landmark);
  if (landmark[3] === null) return null;
  return market === "spread" ? -landmark[3] : landmark[3];
}

function sign(value: number): Side {
  return value >= 0 ? 1 : -1;
}

function trails(histories: NflForwardStoredEvidence[], market: Market): Trail[] {
  const bySource = new Map<string, Array<{ at: string; family: NflForwardContextFamily }>>();
  for (const history of histories) {
    const families = history.payload.contextualEvidenceCapture?.markets[market].families ?? [];
    for (const family of families) {
      const source = canonical(family[0]);
      bySource.set(source, [...(bySource.get(source) ?? []), { at: history.capturedAt, family }]);
    }
  }
  return [...bySource.entries()].flatMap(([source, rows]): Trail[] => {
    const ordered = rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const openingRow = ordered.find((row) => row.family[4] !== null && row.family[4]![0] < row.family[5][0]);
    if (!openingRow?.family[4]) return [];
    const openingAxis = axis(market, openingRow.family[4]);
    if (openingAxis === null) return [];
    const series = [...new Map(ordered.flatMap((row) => {
      const value = axis(market, row.family[5]);
      return value === null ? [] : [[row.family[5][0], { at: row.family[5][0], value }] as const];
    })).values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const last = series.at(-1);
    if (!last) return [];
    const movement = last.value - openingAxis;
    const minimum = threshold(market);
    const direction = Math.abs(movement) >= minimum ? sign(movement) : null;
    const moved = series.filter((row) => Math.abs(row.value - openingAxis) >= minimum);
    const firstMove = moved[0] ?? null;
    const directional = direction === null ? [] : moved.filter((row) => sign(row.value - openingAxis) === direction);
    return [{
      source,
      sourceClass: NAMED.has(source) ? "named" : "retail",
      openingAxis,
      currentAxis: last.value,
      movement,
      direction,
      firstMoveAt: firstMove?.at ?? null,
      persistence: moved.length ? directional.length / moved.length : 0,
      reversed: direction !== null && moved.some((row) => sign(row.value - openingAxis) !== direction),
      observations: series.length,
    }];
  });
}

function consensus(rows: Trail[], minimumSources: number, minimumAgreement = 0.75): Signal {
  const moved = rows.filter((row): row is Trail & { direction: Side } => row.direction !== null);
  if (moved.length < minimumSources) return { side: null, reason: "insufficient_sources", sources: moved.map((row) => row.source) };
  const homeOrOver = moved.filter((row) => row.direction === 1);
  const awayOrUnder = moved.filter((row) => row.direction === -1);
  const selected = homeOrOver.length >= awayOrUnder.length ? homeOrOver : awayOrUnder;
  if (selected.length / moved.length < minimumAgreement) {
    return { side: null, reason: "book_disagreement", sources: moved.map((row) => row.source) };
  }
  return { side: selected[0]!.direction, reason: "consensus", sources: selected.map((row) => row.source) };
}

function namedConsensus(game: Game, market: Market): Signal {
  return consensus(game.trails[market].filter((row) => row.sourceClass === "named"), 2, 1);
}

function allConsensus(game: Game, market: Market): Signal {
  return consensus(game.trails[market], 4, 0.75);
}

function splitSignal(
  payload: NflForwardEvidencePayload,
  market: Market,
  source: "public" | "sharp",
  overrideMinimum?: number,
): Signal {
  const split = source === "public" ? payload.market.playbookSplits?.[market] : payload.market.sharpApiSplits?.[market];
  if (!split) return { side: null, reason: "unavailable", sources: [] };
  const money = market === "total" ? split.overMoneyPct : split.homeMoneyPct;
  const tickets = market === "total" ? split.overBetsPct : split.homeBetsPct;
  if (!Number.isFinite(money) || !Number.isFinite(tickets)) return { side: null, reason: "incomplete", sources: [] };
  const gap = (money as number) - (tickets as number);
  const minimum = overrideMinimum ?? (source === "sharp" ? 10 : 8);
  return Math.abs(gap) >= minimum
    ? { side: sign(gap), reason: `${source}_money_ticket_gap`, sources: [source] }
    : { side: null, reason: "below_threshold", sources: [source] };
}

function alignedSignal(
  game: Game,
  market: Market,
  first: (game: Game, market: Market) => Signal,
  second: (game: Game, market: Market) => Signal,
  reason: string,
): Signal {
  const firstRead = first(game, market);
  const secondRead = second(game, market);
  return firstRead.side !== null && firstRead.side === secondRead.side
    ? { side: firstRead.side, reason, sources: [...new Set([...firstRead.sources, ...secondRead.sources])] }
    : { side: null, reason: "not_aligned", sources: [...new Set([...firstRead.sources, ...secondRead.sources])] };
}

function publicAlignedProduction(game: Game, market: Market): Signal {
  return alignedSignal(
    game,
    market,
    (value, selected) => splitSignal(value.payload, selected, "public"),
    productionMovement,
    "public_gap_aligned_with_selected_book_movement",
  );
}

function publicAlignedNamed(game: Game, market: Market): Signal {
  return alignedSignal(
    game,
    market,
    (value, selected) => splitSignal(value.payload, selected, "public"),
    namedConsensus,
    "public_gap_aligned_with_named_book_consensus",
  );
}

function productionAlignedNamed(game: Game, market: Market): Signal {
  return alignedSignal(
    game,
    market,
    productionMovement,
    namedConsensus,
    "selected_book_movement_aligned_with_named_book_consensus",
  );
}

function publicProductionNamed(game: Game, market: Market): Signal {
  const publicProduction = publicAlignedProduction(game, market);
  const named = namedConsensus(game, market);
  return publicProduction.side !== null && publicProduction.side === named.side
    ? {
        side: publicProduction.side,
        reason: "public_gap_selected_book_and_named_consensus_aligned",
        sources: [...new Set([...publicProduction.sources, ...named.sources])],
      }
    : { side: null, reason: "not_three_way_aligned", sources: [...new Set([...publicProduction.sources, ...named.sources])] };
}

function publicTicketSignal(payload: NflForwardEvidencePayload, market: Market): Signal {
  const split = payload.market.playbookSplits?.[market];
  if (!split) return { side: null, reason: "unavailable", sources: [] };
  const first = market === "total" ? split.overBetsPct : split.homeBetsPct;
  const second = market === "total" ? split.underBetsPct : split.awayBetsPct;
  if (!Number.isFinite(first) || !Number.isFinite(second) || Math.abs((first as number) - (second as number)) < 10) {
    return { side: null, reason: "below_threshold", sources: ["public"] };
  }
  return { side: (first as number) > (second as number) ? 1 : -1, reason: "public_ticket_majority", sources: ["public"] };
}

function qualifiedSequence(game: Game, market: Market): Signal {
  const named = namedConsensus(game, market);
  if (named.side === null) return named;
  const namedRows = game.trails[market].filter((row) =>
    row.sourceClass === "named" && row.direction === named.side);
  if (namedRows.some((row) => row.reversed || row.persistence < 0.67)) {
    return { side: null, reason: "named_buyback_or_instability", sources: namedRows.map((row) => row.source) };
  }
  const firstNamedAt = Math.min(...namedRows.flatMap((row) => row.firstMoveAt ? [Date.parse(row.firstMoveAt)] : []));
  const followers = game.trails[market].filter((row) =>
    row.sourceClass === "retail" && row.direction === named.side && !row.reversed && row.persistence >= 0.67 &&
    row.firstMoveAt !== null && Date.parse(row.firstMoveAt) >= firstNamedAt);
  const publicSplit = splitSignal(game.payload, market, "public");
  const sharpSplit = splitSignal(game.payload, market, "sharp");
  const alignedSplit = publicSplit.side === named.side || sharpSplit.side === named.side;
  if (followers.length < 2 && !alignedSplit) {
    return { side: null, reason: "unconfirmed_named_move", sources: namedRows.map((row) => row.source) };
  }
  return {
    side: named.side,
    reason: followers.length >= 2 ? "named_lead_retail_follow" : "named_move_split_confirmed",
    sources: [...namedRows.map((row) => row.source), ...followers.map((row) => row.source)],
  };
}

function releaseSequence(game: Game, market: Market): Signal {
  const authority = buildNflNamedMarketSequenceAuthority({
    evaluatedAt: game.payload.capturedAt,
    snapshots: game.histories.flatMap((row) => row.payload.contextualEvidenceCapture
      ? [{ capturedAt: row.capturedAt, markets: row.payload.contextualEvidenceCapture.markets }]
      : []),
    current: game.payload.market.current,
    playbookLine: game.payload.market.playbookLine,
    playbookSplits: game.payload.market.playbookSplits,
    sharpSplits: game.payload.market.sharpApiSplits,
  });
  const read = authority.reads[market];
  const side = read.side === null ? null : read.side === "home" || read.side === "over" ? 1 : -1;
  return { side, reason: read.reason, sources: [...read.namedSources, ...read.followerSources] };
}

function reverseLineMovement(game: Game, market: Market): Signal {
  const movement = namedConsensus(game, market);
  const tickets = publicTicketSignal(game.payload, market);
  return movement.side !== null && tickets.side !== null && movement.side !== tickets.side
    ? { side: movement.side, reason: "named_move_against_public_tickets", sources: movement.sources }
    : { side: null, reason: "not_rlm", sources: movement.sources };
}

function productionMovement(game: Game, market: Market): Signal {
  const evidence = game.payload.outcomeForecast.marketEvidence;
  if (market === "spread") {
    const value = evidence?.spreadDirection;
    return value?.status === "available" && value.side
      ? { side: value.side === "home" ? 1 : -1, reason: value.reason ?? "available", sources: ["production_selected_book"] }
      : { side: null, reason: "unavailable", sources: [] };
  }
  if (market === "total") {
    const value = evidence?.totalDirection;
    return value?.status === "available" && value.side
      ? { side: value.side === "over" ? 1 : -1, reason: value.reason ?? "available", sources: ["production_selected_book"] }
      : { side: null, reason: "unavailable", sources: [] };
  }
  const delta = evidence?.movement.moneylineHomeFairProbabilityDeltaPp;
  return Number.isFinite(delta) && Math.abs(delta as number) >= 1
    ? { side: sign(delta as number), reason: "selected_book_price_move", sources: ["production_selected_book"] }
    : { side: null, reason: "unavailable", sources: [] };
}

function tieredMarketRead(game: Game, market: Market): TieredRead {
  const inputs = [
    { name: "selected_book", weight: 2, read: productionMovement(game, market) },
    { name: "named_books", weight: 2, read: namedConsensus(game, market) },
    { name: "all_books", weight: 1, read: allConsensus(game, market) },
    { name: "named_split", weight: 1, read: splitSignal(game.payload, market, "sharp") },
    { name: "public_split", weight: 0.5, read: splitSignal(game.payload, market, "public") },
  ].filter((value): value is { name: string; weight: number; read: Signal & { side: Side } } => value.read.side !== null);
  const sequenced = qualifiedSequence(game, market);
  if (sequenced.side !== null) {
    const aligned = inputs.filter((value) => value.read.side === sequenced.side).map((value) => value.name);
    const conflicts = inputs.filter((value) => value.read.side !== sequenced.side).map((value) => value.name);
    return {
      side: sequenced.side,
      tier: 3,
      reason: "named_lead_follow_strong",
      sources: [...new Set([...sequenced.sources, ...inputs.flatMap((value) => value.read.sources)])],
      alignedFamilies: ["named_sequence", ...aligned],
      conflicts,
    };
  }
  if (inputs.length === 0) {
    return { side: null, tier: 0, reason: "no_qualified_evidence", sources: [], alignedFamilies: [], conflicts: [] };
  }
  const score = inputs.reduce((sum, value) => sum + value.weight * value.read.side, 0);
  const side = sign(score === 0 ? inputs[0]!.read.side : score);
  const aligned = inputs.filter((value) => value.read.side === side);
  const conflicts = inputs.filter((value) => value.read.side !== side);
  const independentFamilies = new Set(aligned.map((value) => value.name));
  const selectedAndNamed = independentFamilies.has("selected_book") && independentFamilies.has("named_books");
  const priceAndSplit = (independentFamilies.has("selected_book") || independentFamilies.has("named_books")) &&
    (independentFamilies.has("named_split") || independentFamilies.has("public_split"));
  const threeWay = selectedAndNamed &&
    (independentFamilies.has("named_split") || independentFamilies.has("public_split") || independentFamilies.has("all_books"));
  const tier: EvidenceTier = threeWay && conflicts.length === 0
    ? 3
    : (selectedAndNamed || priceAndSplit) && conflicts.length <= 1
      ? 2
      : 1;
  return {
    side,
    tier,
    reason: tier === 3 ? "three_family_alignment" : tier === 2 ? "two_family_alignment" : "isolated_or_conflicted",
    sources: [...new Set(aligned.flatMap((value) => value.read.sources))],
    alignedFamilies: [...independentFamilies],
    conflicts: conflicts.map((value) => value.name),
  };
}

function tieredProjection(game: Game, weights: TierWeights): { margin: number; total: number; reads: Record<Market, TieredRead> } | null {
  const independent = game.payload.paidProjectionShadow;
  if (!independent) return null;
  const reads = Object.fromEntries(MARKETS.map((market) => [market, tieredMarketRead(game, market)])) as Record<Market, TieredRead>;
  const spreadRead = reads.spread;
  const moneylineRead = reads.moneyline;
  const totalRead = reads.total;
  let margin = independent.projectedHomeMargin;
  let total = independent.projectedTotal;
  if (spreadRead.side !== null && spreadRead.tier > 0) {
    const target = -game.homeLine + spreadRead.side * 0.5;
    margin += weights[spreadRead.tier as Exclude<EvidenceTier, 0>] * (target - margin);
  }
  if (moneylineRead.side !== null && moneylineRead.tier > 0) {
    const target = moneylineRead.side * Math.max(1, Math.min(7, Math.abs(game.homeLine)));
    const mlWeight = 0.5 * weights[moneylineRead.tier as Exclude<EvidenceTier, 0>];
    margin += mlWeight * (target - margin);
  }
  const independentWinner = sign(independent.projectedHomeMargin);
  const proposedWinner = sign(margin);
  if (proposedWinner !== independentWinner) {
    const winnerConfirmed = moneylineRead.side === proposedWinner && (
      moneylineRead.tier === 3 ||
      moneylineRead.tier >= 2 && spreadRead.tier >= 2 && spreadRead.side === proposedWinner
    );
    if (!winnerConfirmed) margin = independentWinner * 0.25;
  }
  if (totalRead.side !== null && totalRead.tier > 0) {
    const target = game.totalLine + totalRead.side * 0.5;
    total += weights[totalRead.tier as Exclude<EvidenceTier, 0>] * (target - total);
  }
  total = Math.max(total, Math.abs(margin) + 1);
  return { margin, total, reads };
}

function settled(game: Game, market: Market, side: Side): Result {
  const actualMargin = game.actualHome - game.actualAway;
  const value = market === "moneyline"
    ? actualMargin
    : market === "spread"
      ? actualMargin + game.homeLine
      : game.actualHome + game.actualAway - game.totalLine;
  if (Math.abs(value) < 1e-9) return "push";
  return sign(value) === side ? "win" : "loss";
}

function forecastSide(
  game: Game,
  market: Market,
  kind: "authoritative" | "independent" | "gated" | "sequence_override" | "tiered_conservative" | "tiered_balanced" | "tiered_aggressive",
): Side | null {
  const independent = game.payload.paidProjectionShadow;
  const tierWeights: Record<"tiered_conservative" | "tiered_balanced" | "tiered_aggressive", TierWeights> = {
    tiered_conservative: { 1: 0.1, 2: 0.3, 3: 0.6 },
    tiered_balanced: { 1: 0.15, 2: 0.45, 3: 0.8 },
    tiered_aggressive: { 1: 0.25, 2: 0.6, 3: 1 },
  };
  const tiered = kind.startsWith("tiered_")
    ? tieredProjection(game, tierWeights[kind as keyof typeof tierWeights])
    : null;
  let margin = kind === "authoritative" || kind === "sequence_override"
    ? game.payload.outcomeForecast.expectedHomeScore - game.payload.outcomeForecast.expectedAwayScore
    : tiered?.margin ?? independent?.projectedHomeMargin ?? null;
  let total = kind === "authoritative" || kind === "sequence_override"
    ? game.payload.outcomeForecast.expectedHomeScore + game.payload.outcomeForecast.expectedAwayScore
    : tiered?.total ?? independent?.projectedTotal ?? null;
  if (margin === null || total === null) return null;
  if (kind === "gated" || kind === "sequence_override") {
    const spread = releaseSequence(game, "spread");
    if (spread.side !== null && sign(margin + game.homeLine) !== spread.side) {
      margin = 2 * -game.homeLine - margin;
    }
    const moneyline = releaseSequence(game, "moneyline");
    if (moneyline.side !== null && moneyline.side === spread.side && sign(margin) !== moneyline.side) {
      margin = -margin;
    }
    const totalRead = releaseSequence(game, "total");
    if (totalRead.side !== null && sign(total - game.totalLine) !== totalRead.side) {
      total = 2 * game.totalLine - total;
    }
  }
  return market === "moneyline" ? sign(margin) : market === "spread" ? sign(margin + game.homeLine) : sign(total - game.totalLine);
}

function summarizeSignals(games: Game[], market: Market, signal: (game: Game, market: Market) => Signal) {
  const rows = games.flatMap((game) => {
    const read = signal(game, market);
    return read.side === null ? [] : [{ game, read, result: settled(game, market, read.side) }];
  });
  const resolved = rows.filter((row) => row.result !== "push");
  const wins = resolved.filter((row) => row.result === "win").length;
  const disagreement = rows.filter((row) => {
    const side = forecastSide(row.game, market, "authoritative");
    return side !== null && side !== row.read.side;
  });
  const corrections = disagreement.filter((row) =>
    settled(row.game, market, forecastSide(row.game, market, "authoritative")!) === "loss" && row.result === "win").length;
  const harms = disagreement.filter((row) =>
    settled(row.game, market, forecastSide(row.game, market, "authoritative")!) === "win" && row.result === "loss").length;
  return {
    coverage: rows.length,
    resolved: resolved.length,
    wins,
    losses: resolved.length - wins,
    pushes: rows.length - resolved.length,
    accuracy: resolved.length ? wins / resolved.length : null,
    disagreementsWithAuthoritative: disagreement.length,
    corrections,
    harms,
    byWeek: Object.fromEntries([3, 4].map((week) => {
      const selected = rows.filter((row) => row.game.week === week);
      const selectedResolved = selected.filter((row) => row.result !== "push");
      const selectedWins = selectedResolved.filter((row) => row.result === "win").length;
      return [week, {
        coverage: selected.length,
        wins: selectedWins,
        losses: selectedResolved.length - selectedWins,
        pushes: selected.length - selectedResolved.length,
        accuracy: selectedResolved.length ? selectedWins / selectedResolved.length : null,
      }];
    })),
    rows: rows.map(({ game, read, result }) => ({
      week: game.week,
      game: `${game.away}@${game.home}`,
      side: read.side === 1 ? market === "total" ? "over" : "home" : market === "total" ? "under" : "away",
      reason: read.reason,
      sources: read.sources,
      result,
    })),
  };
}

function forecastSummary(
  games: Game[],
  kind: "authoritative" | "independent" | "gated" | "sequence_override" | "tiered_conservative" | "tiered_balanced" | "tiered_aggressive",
) {
  const eligible = kind === "authoritative" ? games : games.filter((game) => game.payload.paidProjectionShadow);
  const markets = Object.fromEntries(MARKETS.map((market) => {
    const rows = eligible.flatMap((game) => {
      const side = forecastSide(game, market, kind);
      return side === null ? [] : [{ game, result: settled(game, market, side) }];
    });
    const resolved = rows.filter((row) => row.result !== "push");
    const wins = resolved.filter((row) => row.result === "win").length;
    return [market, { rows: rows.length, wins, losses: resolved.length - wins, pushes: rows.length - resolved.length, accuracy: resolved.length ? wins / resolved.length : null }];
  }));
  const scoreRows = eligible.flatMap((game) => {
    const independent = game.payload.paidProjectionShadow;
    const tierWeights: Record<"tiered_conservative" | "tiered_balanced" | "tiered_aggressive", TierWeights> = {
      tiered_conservative: { 1: 0.1, 2: 0.3, 3: 0.6 },
      tiered_balanced: { 1: 0.15, 2: 0.45, 3: 0.8 },
      tiered_aggressive: { 1: 0.25, 2: 0.6, 3: 1 },
    };
    const tiered = kind.startsWith("tiered_")
      ? tieredProjection(game, tierWeights[kind as keyof typeof tierWeights])
      : null;
    let margin = kind === "authoritative" || kind === "sequence_override"
      ? game.payload.outcomeForecast.expectedHomeScore - game.payload.outcomeForecast.expectedAwayScore
      : tiered?.margin ?? independent?.projectedHomeMargin ?? null;
    let total = kind === "authoritative" || kind === "sequence_override"
      ? game.payload.outcomeForecast.expectedHomeScore + game.payload.outcomeForecast.expectedAwayScore
      : tiered?.total ?? independent?.projectedTotal ?? null;
    if (margin === null || total === null) return [];
    if (kind === "gated" || kind === "sequence_override") {
      const spread = releaseSequence(game, "spread");
      if (spread.side !== null && sign(margin + game.homeLine) !== spread.side) margin = 2 * -game.homeLine - margin;
      const ml = releaseSequence(game, "moneyline");
      if (ml.side !== null && ml.side === spread.side && sign(margin) !== ml.side) margin = -margin;
      const totals = releaseSequence(game, "total");
      if (totals.side !== null && sign(total - game.totalLine) !== totals.side) total = 2 * game.totalLine - total;
    }
    const expectedHome = (total + margin) / 2;
    const expectedAway = (total - margin) / 2;
    return [{ game, margin, total, expectedHome, expectedAway }];
  });
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return {
    games: eligible.length,
    markets,
    score: {
      teamMae: mean(scoreRows.map((row) => (Math.abs(row.expectedHome - row.game.actualHome) + Math.abs(row.expectedAway - row.game.actualAway)) / 2)),
      marginMae: mean(scoreRows.map((row) => Math.abs(row.margin - (row.game.actualHome - row.game.actualAway)))),
      totalMae: mean(scoreRows.map((row) => Math.abs(row.total - (row.game.actualHome + row.game.actualAway)))),
    },
    changesFromIndependent: kind === "authoritative" || kind === "independent" ? null : Object.fromEntries(MARKETS.map((market) => [market,
      eligible.filter((game) => forecastSide(game, market, "independent") !== forecastSide(game, market, kind)).length,
    ])),
  };
}

function conflictSummary(
  games: Game[],
  firstName: string,
  first: (game: Game, market: Market) => Signal,
  secondName: string,
  second: (game: Game, market: Market) => Signal,
) {
  return Object.fromEntries(MARKETS.map((market) => {
    const comparable = games.flatMap((game) => {
      const firstRead = first(game, market);
      const secondRead = second(game, market);
      if (firstRead.side === null || secondRead.side === null) return [];
      return [{ game, firstRead, secondRead }];
    });
    const conflicts = comparable.filter((row) => row.firstRead.side !== row.secondRead.side);
    const firstWins = conflicts.filter((row) => settled(row.game, market, row.firstRead.side!) === "win").length;
    const secondWins = conflicts.filter((row) => settled(row.game, market, row.secondRead.side!) === "win").length;
    return [market, {
      comparable: comparable.length,
      agreements: comparable.length - conflicts.length,
      conflicts: conflicts.length,
      [`${firstName}Wins`]: firstWins,
      [`${secondName}Wins`]: secondWins,
      pushes: conflicts.length - firstWins - secondWins,
      rows: conflicts.map((row) => ({
        week: row.game.week,
        game: `${row.game.away}@${row.game.home}`,
        [firstName]: row.firstRead.side === 1 ? market === "total" ? "over" : "home" : market === "total" ? "under" : "away",
        [secondName]: row.secondRead.side === 1 ? market === "total" ? "over" : "home" : market === "total" ? "under" : "away",
        firstResult: settled(row.game, market, row.firstRead.side!),
        secondResult: settled(row.game, market, row.secondRead.side!),
      })),
    }];
  }));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const recordRead = await supabase.from("prediction_records")
    .select("id,market,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
    .eq("sport", "nfl")
    .not("locked_at", "is", null)
    .in("market", MARKETS)
    .order("id", { ascending: true });
  if (recordRead.error) throw new Error(recordRead.error.message);
  const allRecords = (recordRead.data ?? []) as unknown as RecordRow[];
  const records = allRecords.filter((row) => typeof row.snapshot_json?.supersedes_prediction_record_id !== "number");
  const byHash = new Map<string, RecordRow[]>();
  for (const record of records) {
    const hash = record.snapshot_json?.evidence_payload_sha256;
    if (typeof hash === "string") byHash.set(hash, [...(byHash.get(hash) ?? []), record]);
  }
  const history = (await Promise.all([3, 4].map((week) => readNflForwardEvidence({ client, season: 2026, week })))).flat();
  const locked = history.filter((row) => byHash.has(row.payloadSha256));
  const games: Game[] = locked.map((row) => {
    const related = byHash.get(row.payloadSha256) ?? [];
    const grade = one(related[0]?.prediction_grades ?? null);
    const spread = row.payload.market.current.spread;
    const total = row.payload.market.current.total;
    if (!grade || !Number.isFinite(grade.actual_home_score) || !Number.isFinite(grade.actual_away_score) || !spread || !total) {
      throw new Error(`Incomplete locked game ${row.providerGameId}.`);
    }
    const histories = history.filter((candidate) => candidate.providerGameId === row.providerGameId && candidate.capturedAt <= row.capturedAt);
    const game = {
      id: row.providerGameId,
      week: row.payload.week,
      away: row.payload.game.away.abbreviation,
      home: row.payload.game.home.abbreviation,
      kickoffAt: row.payload.game.scheduledStart,
      actualAway: grade.actual_away_score as number,
      actualHome: grade.actual_home_score as number,
      homeLine: spread.homeLine,
      totalLine: total.line,
      payload: row.payload as NflForwardEvidencePayload,
      histories,
      trails: {} as Record<Market, Trail[]>,
    };
    game.trails = Object.fromEntries(MARKETS.map((market) => [market, trails(histories, market)])) as Record<Market, Trail[]>;
    return game;
  }).sort((a, b) => a.week - b.week || a.kickoffAt.localeCompare(b.kickoffAt));
  if (games.length !== 32) throw new Error(`Expected 32 locked Week 3-4 games; got ${games.length}.`);
  const candidates = {
    productionSelectedBook: productionMovement,
    allBookConsensus: allConsensus,
    namedSharpConsensus: namedConsensus,
    namedLeadFollowQualified: qualifiedSequence,
    releaseNamedSequence: releaseSequence,
    reverseLineMovement: reverseLineMovement,
    publicMoneyTicketGap: (game: Game, market: Market) => splitSignal(game.payload, market, "public"),
    publicGap15pp: (game: Game, market: Market) => splitSignal(game.payload, market, "public", 15),
    publicGap25pp: (game: Game, market: Market) => splitSignal(game.payload, market, "public", 25),
    publicAlignedProduction,
    publicAlignedNamed,
    productionAlignedNamed,
    publicProductionNamed,
    namedSharpMoneyTicketGap: (game: Game, market: Market) => splitSignal(game.payload, market, "sharp"),
  };
  const report = {
    release: "nfl_2026_market_sequence_tournament_r1",
    readOnly: true,
    writes: 0,
    cohort: {
      games: games.length,
      weeks: Object.fromEntries([3, 4].map((week) => [week, games.filter((game) => game.week === week).length])),
      paidIndependentGames: games.filter((game) => game.payload.paidProjectionShadow).length,
      namedBookTrails: Object.fromEntries(MARKETS.map((market) => [market, games.filter((game) => game.trails[market].filter((trail) => trail.sourceClass === "named").length >= 2).length])),
    },
    signalPerformance: Object.fromEntries(Object.entries(candidates).map(([name, candidate]) => [name,
      Object.fromEntries(MARKETS.map((market) => [market, summarizeSignals(games, market, candidate)])),
    ])),
    signalConflicts: {
      productionVersusNamed: conflictSummary(games, "production", productionMovement, "named", namedConsensus),
      productionVersusAllBook: conflictSummary(games, "production", productionMovement, "allBook", allConsensus),
      productionVersusPublicSplit: conflictSummary(
        games,
        "production",
        productionMovement,
        "publicSplit",
        (game, market) => splitSignal(game.payload, market, "public"),
      ),
      productionVersusSharpSplit: conflictSummary(
        games,
        "production",
        productionMovement,
        "sharpSplit",
        (game, market) => splitSignal(game.payload, market, "sharp"),
      ),
    },
    forecasts: {
      authoritative: forecastSummary(games, "authoritative"),
      authoritativePaidCohort: forecastSummary(games.filter((game) => game.payload.paidProjectionShadow), "authoritative"),
      paidIndependent: forecastSummary(games, "independent"),
      sequenceGated: forecastSummary(games, "gated"),
      sequenceOverride: forecastSummary(games, "sequence_override"),
      tieredConservative: forecastSummary(games, "tiered_conservative"),
      tieredBalanced: forecastSummary(games, "tiered_balanced"),
      tieredAggressive: forecastSummary(games, "tiered_aggressive"),
    },
  };
  if (process.env.NFL_MARKET_SEQUENCE_CANDIDATE_ONLY === "1") {
    console.log(JSON.stringify({
      cohort: report.cohort,
      releaseNamedSequence: report.signalPerformance.releaseNamedSequence,
      sequenceOverride: report.forecasts.sequenceOverride,
    }, null, 2));
    return;
  }
  if (process.env.NFL_MARKET_AUDIT_SUMMARY_ONLY === "1") {
    const compact = Object.fromEntries(Object.entries(report.signalPerformance).map(([name, markets]) => [
      name,
      Object.fromEntries(Object.entries(markets).map(([market, value]) => [market, {
        coverage: value.coverage,
        wins: value.wins,
        losses: value.losses,
        pushes: value.pushes,
        disagreementsWithAuthoritative: value.disagreementsWithAuthoritative,
        corrections: value.corrections,
        harms: value.harms,
        byWeek: value.byWeek,
      }])),
    ]));
    console.log(JSON.stringify({ cohort: report.cohort, signalPerformance: compact, forecasts: report.forecasts }, null, 2));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
