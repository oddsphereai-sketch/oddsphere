import { loadEnvConfig } from "@next/env";
import { collectNflPlayerPropsObservations } from "../../lib/services/football/nflPlayerPropsCollector";
import type { NflPlayerPropPhase } from "../../lib/services/football/nflPlayerPropsContract";
import { buildNflPlayerPropsExactBoard } from "../../lib/services/football/nflPlayerPropsMarketBoard";
import {
  NFL_PLAYER_PROPS_WRITER_RELEASE,
  nflPlayerPropsReferenceEvaluationTime,
} from "../../lib/services/football/nflPlayerPropsProductionWriter";
import {
  buildNflPlayerPropsResearchOfferUniverseRows,
  encodeNflPlayerPropsResearchOfferUniverseHistory,
  NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS,
  NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_GZIP_BYTES,
  NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_JSON_BYTES,
  NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS,
  NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE,
  NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_SCHEMA,
  type NflPlayerPropsResearchOfferUniverseHistory,
  type NflPlayerPropsResearchOfferUniverseRow,
} from "../../lib/services/football/nflPlayerPropsResearchOfferUniverseStore";
import { nflPlayerPropsRuntimePolicy } from "../../lib/services/football/nflPlayerPropsRuntime";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const season = integerArg("season", 2026);
  const week = integerArg("week", 7);
  const phase = phaseArg("phase", "regular");
  const evaluatedAt = stringArg("now", new Date().toISOString());
  if (!Number.isFinite(Date.parse(evaluatedAt))) throw new Error("--now must be an ISO timestamp.");
  const collection = await collectNflPlayerPropsObservations({ season, week, phase, includeOpenings: true, includeReferenceResearch: true });
  const retailOffers = buildNflPlayerPropsExactBoard({ snapshots: [collection.snapshot], evaluatedAt });
  const referenceEvaluatedAt = nflPlayerPropsReferenceEvaluationTime({
    writerStartedAt: evaluatedAt,
    referenceObservations: collection.referenceResearchObservations,
  });
  const referenceOffers = buildNflPlayerPropsExactBoard({
    snapshots: [{ ...collection.snapshot, observations: collection.referenceResearchObservations }],
    evaluatedAt: referenceEvaluatedAt,
    referenceOfferPairing: "same_fetch_player_name",
  });
  const offers = [...retailOffers, ...referenceOffers];
  const built = buildNflPlayerPropsResearchOfferUniverseRows({
    offers,
    evaluatedAt,
    maximumLockQuoteAgeHours: nflPlayerPropsRuntimePolicy().maximumQuoteAgeHours,
    writerRelease: NFL_PLAYER_PROPS_WRITER_RELEASE,
  });
  const history: NflPlayerPropsResearchOfferUniverseHistory = {
    kind: "nfl_player_props_research_offer_universe_v1",
    schema: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_SCHEMA,
    captureRelease: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE,
    season,
    week,
    createdAt: evaluatedAt,
    updatedAt: evaluatedAt,
    boundaryPolicy: "opening_t24_t6_t60_first_observation_immutable",
    rowLimit: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS,
    rows: built.rows,
  };
  const envelope = encodeNflPlayerPropsResearchOfferUniverseHistory(history);
  const rowsFor = (market: (typeof NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS)[number]) => built.rows.filter((row) => row.market === market);
  console.log(JSON.stringify({
    mode: "read_only_zero_extra_provider_calls",
    persisted: false,
    identity: { season, week, phase, evaluatedAt },
    releases: { writer: NFL_PLAYER_PROPS_WRITER_RELEASE, capture: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE, exactBoard: offers[0]?.release ?? null },
    providerRequests: collection.snapshot.providerRequests,
    providerComplete: collection.snapshot.providerComplete,
    collectionHealthFindings: collection.snapshot.healthFindings,
    games: collection.snapshot.games.length,
    observations: collection.snapshot.observations.length,
    exactBoardOffers: offers.length,
    retailExactBoardOffers: retailOffers.length,
    referenceObservations: collection.referenceResearchObservations.length,
    referenceExactBoardOffers: referenceOffers.length,
    referenceEvaluatedAt,
    researchInputOffers: built.health.eligibleOffers,
    exactPriceCompleteOffers: built.health.completeOffers,
    rowsBuilt: built.rows.length,
    byLandmark: countBy(built.rows, (row) => row.landmark),
    byMarket: Object.fromEntries(NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS.map((market) => [market, summarizeMarket(rowsFor(market), built.health.byMarket[market])])),
    storage: {
      rows: built.rows.length,
      rowLimit: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS,
      jsonBytes: envelope.uncompressedBytes,
      jsonLimitBytes: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_JSON_BYTES,
      gzipBytes: envelope.compressedBytes,
      gzipLimitBytes: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_GZIP_BYTES,
    },
  }, null, 2));
}

function summarizeMarket(rows: readonly NflPlayerPropsResearchOfferUniverseRow[], health: { inputOffers: number; completeOffers: number; rowsBuilt: number; books: readonly string[] }) {
  return {
    ...health,
    lines: numericRange(rows.map((row) => row.line)),
    overPrices: numericRange(rows.map((row) => row.overPrice)),
    underPrices: numericRange(rows.map((row) => row.underPrice)),
    yesPrices: numericRange(rows.map((row) => row.yesPrice)),
    observedAt: timestampRange(rows.map((row) => row.observedAt)),
    samples: rows.slice(0, 3).map((row) => ({
      gameId: row.gameId,
      player: row.playerName,
      book: row.sportsbook,
      provider: row.provider,
      landmark: row.landmark,
      line: row.line,
      overPrice: row.overPrice,
      underPrice: row.underPrice,
      yesPrice: row.yesPrice,
      complete: row.exactPriceComplete,
      observedAt: row.observedAt,
      fetchedAt: row.fetchedAt,
      scheduledStart: row.scheduledStart,
    })),
  };
}

function countBy<T>(rows: readonly T[], select: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const key = select(row);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function numericRange(values: readonly (number | null)[]): { minimum: number; maximum: number } | null {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length === 0 ? null : { minimum: Math.min(...present), maximum: Math.max(...present) };
}

function timestampRange(values: readonly string[]): { earliest: string; latest: string } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((first, second) => Date.parse(first) - Date.parse(second));
  return { earliest: sorted[0]!, latest: sorted.at(-1)! };
}

function stringArg(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

function integerArg(name: string, fallback: number): number {
  const parsed = Number(stringArg(name, String(fallback)));
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer.`);
  return parsed;
}

function phaseArg(name: string, fallback: NflPlayerPropPhase): NflPlayerPropPhase {
  const phase = stringArg(name, fallback);
  if (phase !== "preseason" && phase !== "regular" && phase !== "postseason") throw new Error(`--${name} must be preseason, regular, or postseason.`);
  return phase;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
