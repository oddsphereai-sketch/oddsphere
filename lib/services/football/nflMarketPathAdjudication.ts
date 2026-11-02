import {
  selectNflNamedMoneylineEpisodeAfterKnowledge, selectNflNamedPricedLineEpisodeAfterKnowledge,
  transportNflMoneylineEpisode, transportNflPricedLineEpisode,
  type NflEpisodeHistoryBook, type NflNamedMoneylineEpisode, type NflPricedLineEpisode,
} from "./nflMoneylineEpisodeTransport";
import type { NflV1WeekOneOutcomeForecast } from "./nflV1WeekOneOutcome";

export const NFL_MARKET_PATH_ADJUDICATION_RELEASE = "nfl_market_path_adjudication_2026_11_02_r1_economic_legs" as const;
type Market = "moneyline" | "spread" | "total";
type Direction = -1 | 1 | null;
type Episode = NflNamedMoneylineEpisode | NflPricedLineEpisode;
export type NflMarketPathAdjudication = {
  release: typeof NFL_MARKET_PATH_ADJUDICATION_RELEASE;
  market: Market; book: string;
  openingAt: string | null; currentAt: string | null;
  netDirection: Direction; netMagnitude: number;
  latestEconomicDirection: Direction; latestEconomicMoveAt: string | null; latestEconomicMagnitude: number;
  retracementMagnitude: number; peakAt: string | null;
  pathStatus: "steady" | "partial_buyback" | "full_buyback" | "reversal" | "unchanged" | "unidentified";
  sourcePosture: "supports_net" | "resists_net" | "fully_bought_back" | "no_economic_episode" | "unidentified";
  hasUnresolvedAdverseLeg: boolean;
  reason: string;
  coordinates: Array<{ observedAt: string; displacement: number }>;
  sourceProvenance?: Episode["sourceProvenance"];
};

/** Original source clocks and one frozen score law define every economic leg.
 * ML uses probability displacement; Spread/Total use inferred mean displacement.
 * No source vote, threshold-sized permission, extra point shift or flow is needed.
 */
export function readNflMarketPathAdjudication(args: {
  independentForecast: NflV1WeekOneOutcomeForecast;
  history: NflEpisodeHistoryBook[];
  book: string; market: Market; evaluatedAt: string; gameStartsAt: string;
  excludedFamilies?: string[];
}): NflMarketPathAdjudication {
  const book = canonical(args.book);
  const result: NflMarketPathAdjudication = {
    release: NFL_MARKET_PATH_ADJUDICATION_RELEASE, market: args.market, book,
    openingAt: null, currentAt: null, netDirection: null, netMagnitude: 0,
    latestEconomicDirection: null, latestEconomicMoveAt: null, latestEconomicMagnitude: 0,
    retracementMagnitude: 0, peakAt: null, pathStatus: "unidentified", sourcePosture: "unidentified",
    hasUnresolvedAdverseLeg: false, reason: "no_qualified_source_path", coordinates: [],
  };
  if (args.excludedFamilies?.some(x => canonical(x) === book)) return { ...result, reason: "evaluated_family_excluded" };
  const select = (history: NflEpisodeHistoryBook[], evaluatedAt: string) => {
    const common = { history, sportsbook: book, providerGameId: args.independentForecast.providerGameId,
      evaluatedAt, gameStartsAt: args.gameStartsAt, statisticalKnowledgeAt: null, informationOverlap: "not_attested" as const };
    return args.market === "moneyline" ? selectNflNamedMoneylineEpisodeAfterKnowledge(common)
      : selectNflNamedPricedLineEpisodeAfterKnowledge({ ...common, market: args.market });
  };
  const whole = select(args.history, args.evaluatedAt);
  if (!whole) return result;
  const tolerance = args.market === "moneyline" ? 1e-12 : 1e-9;
  const direction = (value: number): Direction => Math.abs(value) <= tolerance ? null : value > 0 ? 1 : -1;
  const at = (row: NflEpisodeHistoryBook) => row.marketObservedAt?.[args.market] ?? row.observedAt;
  const rows = args.history.filter(row => canonical(row.sportsbook) === book &&
    row.providerGameId === args.independentForecast.providerGameId && row[args.market] &&
    Date.parse(at(row)) >= Date.parse(whole.openingAt) && Date.parse(at(row)) <= Date.parse(whole.currentAt))
    .sort((a, b) => Date.parse(at(a)) - Date.parse(at(b)));
  const endingRows = rows.filter(row => Date.parse(at(row)) === Date.parse(whole.currentAt));
  const opening = rows.find(row => Date.parse(at(row)) === Date.parse(whole.openingAt) &&
    endingRows.some(last => !!select([row, last], whole.currentAt)));
  if (!opening) return { ...result, reason: "opening_identity_unidentified" };
  const coordinate = (episode: Episode): number | null => {
    const transported = args.market === "moneyline"
      ? transportNflMoneylineEpisode({ statisticalForecast: args.independentForecast, statisticalKnowledgeAt: null,
        informationOverlap: "not_attested", episode: episode as NflNamedMoneylineEpisode })
      : transportNflPricedLineEpisode({ statisticalForecast: args.independentForecast, statisticalKnowledgeAt: null,
        informationOverlap: "not_attested", episode: episode as NflPricedLineEpisode });
    return transported.status === "unidentified" ? null : "finalHomeWinProbability" in transported
      ? transported.finalHomeWinProbability - transported.statisticalHomeWinProbability
      : transported.finalMean - transported.statisticalMean;
  };
  const points: NflMarketPathAdjudication["coordinates"] = [{ observedAt: whole.openingAt, displacement: 0 }];
  const cache = new Map<string, number>();
  cache.set(JSON.stringify(opening[args.market]), 0);
  for (const row of rows) {
    if (Date.parse(at(row)) === Date.parse(whole.openingAt)) continue;
    const episode = select([opening, row], new Date(Date.parse(at(row))).toISOString());
    if (!episode || Date.parse(episode.currentAt) !== Date.parse(at(row))) continue;
    const key = JSON.stringify(row[args.market]);
    let value = cache.get(key);
    if (value === undefined) {
      const inferred = coordinate(episode);
      if (inferred === null) return { ...result, openingAt: whole.openingAt, currentAt: whole.currentAt,
        sourceProvenance: whole.sourceProvenance, reason: "intermediate_economic_coordinate_unidentified" };
      value = inferred; cache.set(key, value);
    }
    if (direction(value - points.at(-1)!.displacement) !== null) points.push({ observedAt: episode.currentAt, displacement: value });
  }
  const net = coordinate(whole);
  if (net === null) return { ...result, reason: "net_economic_coordinate_unidentified" };
  const netDirection = direction(net);
  const latest = points.at(-1)!;
  const previous = points.at(-2);
  const latestDelta = previous ? latest.displacement - previous.displacement : 0;
  const latestDirection = direction(latestDelta);
  const excursionDirection = netDirection ?? direction(points.reduce((peak, point) =>
    Math.abs(point.displacement) > Math.abs(peak) ? point.displacement : peak, 0));
  const peak = points.reduce((peak, point) => excursionDirection !== null &&
    point.displacement * excursionDirection > peak.displacement * excursionDirection ? point : peak, points[0]!);
  const retracement = excursionDirection === null ? 0 : Math.max(0, (peak.displacement - net) * excursionDirection);
  const reversal = netDirection !== null && points.some(point => direction(point.displacement) !== null && direction(point.displacement) !== netDirection);
  const adverse = latestDirection !== null && netDirection !== null && latestDirection !== netDirection;
  const pathStatus = points.length === 1 ? "unchanged" : netDirection === null ? "full_buyback"
    : adverse || retracement > tolerance ? "partial_buyback" : reversal ? "reversal" : "steady";
  return { ...result, openingAt: whole.openingAt, currentAt: whole.currentAt,
    netDirection, netMagnitude: net, latestEconomicDirection: latestDirection,
    latestEconomicMoveAt: previous ? latest.observedAt : null, latestEconomicMagnitude: latestDelta,
    retracementMagnitude: retracement, peakAt: direction(peak.displacement) === null ? null : peak.observedAt,
    pathStatus, sourcePosture: pathStatus === "unchanged" ? "no_economic_episode"
      : pathStatus === "full_buyback" ? "fully_bought_back" : adverse ? "resists_net" : "supports_net",
    hasUnresolvedAdverseLeg: adverse, reason: "same_book_paired_economic_path", coordinates: points,
    sourceProvenance: whole.sourceProvenance };
}

function canonical(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
