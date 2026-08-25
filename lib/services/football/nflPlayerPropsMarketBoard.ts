import {
  NFL_PLAYER_PROPS_PHASE_ONE_MARKETS,
  type NflPlayerPropMarket,
  type NflPlayerPropPriceObservation,
  type NflPlayerPropsObservationSnapshot,
} from "./nflPlayerPropsContract";

export const NFL_PLAYER_PROPS_MARKET_BOARD_RELEASE =
  "nfl_player_props_exact_market_board_2026_08_25_r1" as const;
export const NFL_PLAYER_PROPS_LOCK_LEAD_MINUTES = 60 as const;
const MAX_PROVIDER_CLOCK_SKEW_MS = 60_000;

export type NflPlayerPropsExactOffer = {
  release: typeof NFL_PLAYER_PROPS_MARKET_BOARD_RELEASE;
  offerKey: string;
  canonicalGameId: string;
  provider: NflPlayerPropPriceObservation["provider"];
  providerEventId: string;
  providerPlayerId: string | null;
  playerName: string;
  playerTeam: string | null;
  sportsbook: string;
  market: NflPlayerPropMarket;
  offerType: NflPlayerPropPriceObservation["offerType"];
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  yesPrice: number | null;
  overNoVigProbability: number | null;
  underNoVigProbability: number | null;
  observedAt: string;
  fetchedAt: string;
  openingObservedAt: string | null;
  openingOverPrice: number | null;
  openingUnderPrice: number | null;
  openingYesPrice: number | null;
  scheduledStart: string;
  lockAt: string;
  state: "unlocked" | "locked";
  exactPriceComplete: boolean;
  gradeEligibleMarket: boolean;
  healthHolds: string[];
};

type Capture = {
  observedAt: string;
  fetchedAt: string;
  rows: NflPlayerPropPriceObservation[];
};

export function buildNflPlayerPropsExactBoard(args: {
  snapshots: NflPlayerPropsObservationSnapshot[];
  evaluatedAt: string;
  lockLeadMinutes?: number;
}): NflPlayerPropsExactOffer[] {
  const evaluatedAt = timestamp(args.evaluatedAt, "evaluatedAt");
  const lockLeadMinutes = args.lockLeadMinutes ?? NFL_PLAYER_PROPS_LOCK_LEAD_MINUTES;
  if (!Number.isFinite(lockLeadMinutes) || lockLeadMinutes < 0 || lockLeadMinutes > 24 * 60) {
    throw new Error("NFL props lock lead is invalid.");
  }
  const games = new Map(args.snapshots.flatMap((snapshot) => snapshot.games)
    .map((game) => [game.providerGameId, game] as const));
  const groups = new Map<string, NflPlayerPropPriceObservation[]>();
  for (const row of args.snapshots.flatMap((snapshot) => snapshot.observations)) {
    if (row.isLive || !row.canonicalGameId || !row.playerName) continue;
    const key = logicalOfferKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const offers: NflPlayerPropsExactOffer[] = [];
  for (const [offerKey, rows] of groups) {
    const game = games.get(rows[0]!.providerEventId) ?? games.get(rows[0]!.canonicalGameId!);
    if (!game) continue;
    const startsAt = timestamp(game.scheduledStart, "scheduledStart");
    const lockAt = startsAt - lockLeadMinutes * 60_000;
    const cutoff = Math.min(evaluatedAt, lockAt);
    const current = latestCapture(rows.filter((row) => !row.isOpening), cutoff);
    if (!current) continue;
    const opening = earliestCapture(rows.filter((row) => row.isOpening), cutoff);
    const first = current.rows[0]!;
    const overPrice = sidePrice(current.rows, "over");
    const underPrice = sidePrice(current.rows, "under");
    const yesPrice = sidePrice(current.rows, "yes");
    const probabilities = noVigPair(overPrice, underPrice);
    const ordinaryTwoWay = first.offerType === "over_under" && overPrice !== null && underPrice !== null;
    const validAnytimeTd = first.market !== "anytime_td" || first.line === 0.5;
    const healthHolds = [
      ordinaryTwoWay || (first.offerType === "milestone" && yesPrice !== null) ? null : "incomplete_exact_side_prices",
      validAnytimeTd ? null : "touchdown_ladder_not_anytime_td",
      Date.parse(current.fetchedAt) + MAX_PROVIDER_CLOCK_SKEW_MS >= Date.parse(current.observedAt) ? null : "provider_fetch_precedes_observation",
    ].filter((value): value is string => value !== null);
    offers.push({
      release: NFL_PLAYER_PROPS_MARKET_BOARD_RELEASE,
      offerKey,
      canonicalGameId: first.canonicalGameId!,
      provider: first.provider,
      providerEventId: first.providerEventId,
      providerPlayerId: first.providerPlayerId,
      playerName: first.playerName!,
      playerTeam: first.playerTeam,
      sportsbook: first.sportsbook,
      market: first.market,
      offerType: first.offerType,
      line: first.line,
      overPrice,
      underPrice,
      yesPrice,
      overNoVigProbability: probabilities?.over ?? null,
      underNoVigProbability: probabilities?.under ?? null,
      observedAt: current.observedAt,
      fetchedAt: current.fetchedAt,
      openingObservedAt: opening?.observedAt ?? null,
      openingOverPrice: opening ? sidePrice(opening.rows, "over") : null,
      openingUnderPrice: opening ? sidePrice(opening.rows, "under") : null,
      openingYesPrice: opening ? sidePrice(opening.rows, "yes") : null,
      scheduledStart: new Date(startsAt).toISOString(),
      lockAt: new Date(lockAt).toISOString(),
      state: evaluatedAt >= lockAt ? "locked" : "unlocked",
      exactPriceComplete: ordinaryTwoWay || (first.offerType === "milestone" && yesPrice !== null),
      gradeEligibleMarket: (
        (first.offerType === "over_under"
          && NFL_PLAYER_PROPS_PHASE_ONE_MARKETS.includes(first.market as (typeof NFL_PLAYER_PROPS_PHASE_ONE_MARKETS)[number]))
        || (first.market === "anytime_td" && first.line === 0.5)
      ),
      healthHolds,
    });
  }
  return offers.sort((first, second) => first.canonicalGameId.localeCompare(second.canonicalGameId)
    || first.playerName.localeCompare(second.playerName)
    || first.market.localeCompare(second.market)
    || first.line - second.line
    || first.sportsbook.localeCompare(second.sportsbook));
}

export function materiallyChangedNflPropsOffer(args: {
  previous: NflPlayerPropsExactOffer;
  current: NflPlayerPropsExactOffer;
  previousRoleFingerprint: string;
  currentRoleFingerprint: string;
}): boolean {
  if (args.previous.offerKey !== args.current.offerKey) return true;
  return args.previous.line !== args.current.line
    || args.previous.overPrice !== args.current.overPrice
    || args.previous.underPrice !== args.current.underPrice
    || args.previous.yesPrice !== args.current.yesPrice
    || args.previousRoleFingerprint !== args.currentRoleFingerprint;
}

export function americanImpliedProbability(price: number): number {
  if (!Number.isInteger(price) || price === 0) throw new Error("American price is invalid.");
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function noVigPair(overPrice: number | null, underPrice: number | null): { over: number; under: number } | null {
  if (overPrice === null || underPrice === null) return null;
  const over = americanImpliedProbability(overPrice);
  const under = americanImpliedProbability(underPrice);
  return { over: over / (over + under), under: under / (over + under) };
}

function logicalOfferKey(row: NflPlayerPropPriceObservation): string {
  return [row.provider, row.canonicalGameId, row.providerPlayerId ?? row.playerName?.toLowerCase(), row.sportsbook, row.market, row.offerType, row.line].join("|");
}

function captures(rows: NflPlayerPropPriceObservation[]): Capture[] {
  const byTime = new Map<string, NflPlayerPropPriceObservation[]>();
  for (const row of rows) byTime.set(row.observedAt, [...(byTime.get(row.observedAt) ?? []), row]);
  return [...byTime].map(([observedAt, captureRows]) => ({
    observedAt,
    fetchedAt: [...captureRows].sort((first, second) => Date.parse(second.fetchedAt) - Date.parse(first.fetchedAt))[0]!.fetchedAt,
    rows: captureRows,
  }));
}

function latestCapture(rows: NflPlayerPropPriceObservation[], cutoff: number): Capture | null {
  return captures(rows).filter((capture) => Date.parse(capture.observedAt) <= cutoff)
    .sort((first, second) => Date.parse(second.observedAt) - Date.parse(first.observedAt))[0] ?? null;
}

function earliestCapture(rows: NflPlayerPropPriceObservation[], cutoff: number): Capture | null {
  return captures(rows).filter((capture) => Date.parse(capture.observedAt) <= cutoff)
    .sort((first, second) => Date.parse(first.observedAt) - Date.parse(second.observedAt))[0] ?? null;
}

function sidePrice(rows: NflPlayerPropPriceObservation[], side: NflPlayerPropPriceObservation["side"]): number | null {
  return rows.find((row) => row.side === side)?.americanPrice ?? null;
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`NFL props ${label} is invalid.`);
  return parsed;
}
