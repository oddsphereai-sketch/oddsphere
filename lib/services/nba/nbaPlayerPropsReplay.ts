import type { NbaPlayerPropMarket, NbaPlayerPropPriceObservation } from "./nbaPlayerPropsContract";
import {
  fitNbaPlayerPropsIndependentResearchModel,
  nbaPlayerPropsProbabilityOver,
  projectNbaPlayerPropsIndependent,
  type NbaPlayerPropCombination,
} from "./nbaPlayerPropsIndependentModel";
import { selectNbaPlayerPropsCanonicalOfferSets } from "./nbaPlayerPropsMarketEvidence";
import type { NbaPlayerPropFeatureRow } from "./nbaPlayerPropsPointInTimeFeatures";

export const NBA_PLAYER_PROPS_REPLAY_RELEASE =
  "nba_player_props_chronological_replay_research_2026_10_20_r1" as const;

export type NbaPlayerPropsReplayMarketMetrics = {
  rowsWithOutcome: number;
  rowsWithOpeningLine: number;
  gradableSides: number;
  pushes: number;
  projectionMae: number | null;
  projectionRmse: number | null;
  projectionMedianAbsoluteError: number | null;
  independentSideHitRate: number | null;
  independentBrier: number | null;
  independentLogLoss: number | null;
  marketDiagnosticHitRate: number | null;
};

export type NbaPlayerPropsChronologicalReplay = {
  release: typeof NBA_PLAYER_PROPS_REPLAY_RELEASE;
  mode: "offline_research_only";
  actionable: false;
  trainThrough: string;
  confirmationFrom: string;
  confirmationThrough: string;
  modelRelease: string;
  marketMetrics: Partial<Record<NbaPlayerPropMarket, NbaPlayerPropsReplayMarketMetrics>>;
  finalMarketReaderStatus: "not_fit";
  notes: string[];
};

const REPLAY_MARKETS: NbaPlayerPropCombination[] = [
  "points",
  "rebounds",
  "assists",
  "threes",
  "points_rebounds_assists",
  "points_rebounds",
  "points_assists",
  "rebounds_assists",
];

/**
 * Release-pure chronological confirmation. Market-only is a diagnostic, not a
 * forecast. A final married model remains forbidden until a separate
 * arbitration candidate improves this untouched confirmation window.
 */
export function replayNbaPlayerPropsFoundation(args: {
  trainingRows: readonly NbaPlayerPropFeatureRow[];
  confirmationRows: readonly NbaPlayerPropFeatureRow[];
  openingObservations: readonly NbaPlayerPropPriceObservation[];
}): NbaPlayerPropsChronologicalReplay {
  const training = chronologically(args.trainingRows);
  const confirmation = chronologically(args.confirmationRows);
  if (training.length < 8 || confirmation.length === 0) {
    throw new Error("NBA props replay requires at least 8 training rows and a non-empty confirmation window.");
  }
  if (Date.parse(training.at(-1)!.feature_cutoff) >= Date.parse(confirmation[0]!.feature_cutoff)) {
    throw new Error("NBA props confirmation must begin strictly after the training window.");
  }
  const model = fitNbaPlayerPropsIndependentResearchModel(training);
  const canonical = selectNbaPlayerPropsCanonicalOfferSets(args.openingObservations.filter((row) => row.isOpening));
  const canonicalByScope = new Map(canonical.map((row) => [row.scopeKey, row]));
  const marketMetrics: Partial<Record<NbaPlayerPropMarket, NbaPlayerPropsReplayMarketMetrics>> = {};

  for (const market of REPLAY_MARKETS) {
    const errors: number[] = [];
    const briers: number[] = [];
    const logLosses: number[] = [];
    const independentHits: number[] = [];
    const marketHits: number[] = [];
    let rowsWithOutcome = 0;
    let rowsWithOpeningLine = 0;
    let pushes = 0;
    for (const row of confirmation) {
      const actual = target(row, market);
      if (actual === null) continue;
      rowsWithOutcome += 1;
      const projection = projectNbaPlayerPropsIndependent(row, model);
      const center = projection.combinations[market];
      errors.push(center - actual);
      const scope = [`nba-bdl:${row.game_id}`, `nba-bdl-player:${row.player_id}`, market].join("|");
      const offers = canonicalByScope.get(scope);
      if (!offers) continue;
      rowsWithOpeningLine += 1;
      if (actual === offers.canonicalLine) {
        pushes += 1;
        continue;
      }
      const probability = nbaPlayerPropsProbabilityOver({ projection, model, market, line: offers.canonicalLine });
      if (probability === null) continue;
      const outcome = Number(actual > offers.canonicalLine);
      briers.push((probability - outcome) ** 2);
      logLosses.push(-(outcome * Math.log(clampProbability(probability)) + (1 - outcome) * Math.log(1 - clampProbability(probability))));
      independentHits.push(Number((probability >= 0.5) === Boolean(outcome)));
      const marketOver = consensusNoVigOver(offers.observations);
      if (marketOver !== null) marketHits.push(Number((marketOver >= 0.5) === Boolean(outcome)));
    }
    marketMetrics[market] = {
      rowsWithOutcome,
      rowsWithOpeningLine,
      gradableSides: independentHits.length,
      pushes,
      projectionMae: mean(errors.map(Math.abs)),
      projectionRmse: errors.length > 0 ? Math.sqrt(mean(errors.map((value) => value ** 2))!) : null,
      projectionMedianAbsoluteError: median(errors.map(Math.abs)),
      independentSideHitRate: mean(independentHits),
      independentBrier: mean(briers),
      independentLogLoss: mean(logLosses),
      marketDiagnosticHitRate: mean(marketHits),
    };
  }

  return {
    release: NBA_PLAYER_PROPS_REPLAY_RELEASE,
    mode: "offline_research_only",
    actionable: false,
    trainThrough: training.at(-1)!.feature_cutoff,
    confirmationFrom: confirmation[0]!.feature_cutoff,
    confirmationThrough: confirmation.at(-1)!.feature_cutoff,
    modelRelease: model.release,
    marketMetrics,
    finalMarketReaderStatus: "not_fit",
    notes: [
      "Independent and market-only results are reported separately.",
      "No market adjustment, flip, grade, or stake is inferred from this diagnostic.",
      "A future arbitration rule must be selected before this confirmation window and tested on a later untouched window.",
    ],
  };
}

function target(row: NbaPlayerPropFeatureRow, market: NbaPlayerPropCombination): number | null {
  if (market === "points") return row.target_points;
  if (market === "rebounds") return row.target_rebounds;
  if (market === "assists") return row.target_assists;
  if (market === "threes") return row.target_threes;
  if (market === "points_rebounds_assists") return row.target_points_rebounds_assists;
  if (market === "points_rebounds") return row.target_points_rebounds;
  if (market === "points_assists") return row.target_points_assists;
  return row.target_rebounds_assists;
}

function consensusNoVigOver(rows: readonly NbaPlayerPropPriceObservation[]): number | null {
  const byBook = new Map<string, NbaPlayerPropPriceObservation[]>();
  for (const row of rows) {
    const book = row.sportsbook.toLowerCase().replace(/[^a-z0-9]/g, "");
    byBook.set(book, [...(byBook.get(book) ?? []), row]);
  }
  const values: number[] = [];
  for (const bookRows of byBook.values()) {
    const over = bookRows.find((row) => row.side === "over");
    const under = bookRows.find((row) => row.side === "under");
    if (!over || !under) continue;
    const overImplied = implied(over.americanPrice);
    const underImplied = implied(under.americanPrice);
    values.push(overImplied / (overImplied + underImplied));
  }
  return median(values);
}

function implied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
function clampProbability(value: number): number { return Math.min(1 - 1e-9, Math.max(1e-9, value)); }
function chronologically(rows: readonly NbaPlayerPropFeatureRow[]): NbaPlayerPropFeatureRow[] {
  return [...rows].sort((a, b) => Date.parse(a.feature_cutoff) - Date.parse(b.feature_cutoff) || a.game_id - b.game_id || a.player_id - b.player_id);
}
function mean(values: readonly number[]): number | null { return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
