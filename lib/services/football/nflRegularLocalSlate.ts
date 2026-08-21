import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { PreviewAvailabilityByGame, PreviewHistoryByTeam } from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import type { NflPreviewBookOdds, NflRegularProviderSlate } from "./balldontlieNflPreviewSlate";
import { loadNflRecentCompletedContext, type NflRecentTeamSummary } from "./nflLocalShadowSlate";
import {
  NFL_REGULAR_MARKET_EVIDENCE_RELEASE,
  overlayNflRegularMarketEvidence,
  readCurrentNflRegularMarketEvidence,
  type NflRegularConsensusSplit,
} from "./nflRegularMarketEvidence";

export const NFL_REGULAR_LOCAL_MODEL_RELEASE =
  "nfl_market_reference_player_value_runtime_2026_08_20_r3" as const;
export const NFL_REGULAR_LOCAL_SOURCE_MODEL_RELEASE =
  "nfl_market_residual_player_value_shadow_2026_08_20_r2" as const;
export const NFL_REGULAR_LOCAL_FEATURE_RELEASE =
  "nfl_player_value_features_2016_2025_2026_08_20_r3" as const;
export const NFL_REGULAR_LOCAL_SNAPSHOT_RELEASE =
  "nfl_daily_edge_local_snapshot_2026_08_20_r3" as const;
export const NFL_REGULAR_LOCAL_REFERENCE_RELEASE =
  "nfl_market_reference_core_2026_08_20_r1" as const;
export const NFL_REGULAR_LOCAL_CALIBRATION_RELEASE =
  "nfl_market_logit_player_value_adjustment_2026_08_20_r2" as const;
const NFL_PRESEASON_REHEARSAL_MODEL_RELEASE =
  "nfl_pregame_real_local_current_refit_2026_08_19_r3" as const;
const NFL_PRESEASON_REHEARSAL_SOURCE_MODEL_RELEASE =
  "nfl_pregame_real_local_candidate_2026_08_19_r2" as const;
const NFL_PRESEASON_REHEARSAL_FEATURE_RELEASE =
  "nfl_real_pregame_features_2016_2025_2026_08_19_r1" as const;
export const NFL_REGULAR_PIPELINE_PRESEASON_SNAPSHOT_RELEASE =
  "nfl_regular_pipeline_preseason_rehearsal_snapshot_2026_08_20_r1" as const;

export type NflRegularTeamContext = {
  opponentAdjustedOffenseEpaPerPlay: number;
  opponentAdjustedDefenseEpaAllowedPerPlay: number;
  opponentAdjustedSuccessRate: number;
  opponentAdjustedExplosivePlayRate: number;
  estimatedPlays: number;
  quarterbackEpaPerDropback: number;
  injuryBurden: number;
};

export type NflRegularLocalProjection = {
  providerGameId: string;
  home: string;
  away: string;
  scheduledStart: string;
  release: typeof NFL_REGULAR_LOCAL_MODEL_RELEASE | typeof NFL_PRESEASON_REHEARSAL_MODEL_RELEASE;
  featureRelease: typeof NFL_REGULAR_LOCAL_FEATURE_RELEASE | typeof NFL_PRESEASON_REHEARSAL_FEATURE_RELEASE;
  generatedAt: string;
  trainedThrough: "2025-12-31";
  projectedHomeMargin: number;
  projectedTotal: number;
  projectedHomeScore: number;
  projectedAwayScore: number;
  referenceProjectedHomeMargin?: number;
  referenceProjectedTotal?: number;
  playerValueTotalCorrection?: number;
  independentProjectedHomeMargin?: number;
  independentProjectedTotal?: number;
  homeWinProbability: number;
  homeCoverProbability: number;
  overProbability: number;
  marginStdDev: number;
  totalStdDev: number;
  homeStartingQuarterback: string | null;
  awayStartingQuarterback: string | null;
  homeQuarterbackHistoryMatched: boolean;
  awayQuarterbackHistoryMatched: boolean;
  homeTeamContext: NflRegularTeamContext;
  awayTeamContext: NflRegularTeamContext;
  homeRecent: NflRecentTeamSummary;
  awayRecent: NflRecentTeamSummary;
  dataHealthFindings: string[];
  actionable: false;
};

export type NflRegularLocalSlate = {
  modelRelease: typeof NFL_REGULAR_LOCAL_MODEL_RELEASE | typeof NFL_PRESEASON_REHEARSAL_MODEL_RELEASE;
  featureRelease: typeof NFL_REGULAR_LOCAL_FEATURE_RELEASE | typeof NFL_PRESEASON_REHEARSAL_FEATURE_RELEASE;
  source: string;
  sourceChecksum: string;
  sourceFetchedAt: string;
  generatedAt: string;
  projectionsByGame: Record<string, NflRegularLocalProjection>;
  history: PreviewHistoryByTeam;
  validation: {
    historicalHoldoutSeason: 2025;
    marginMae: number;
    marketMarginMae: number;
    totalMae: number;
    marketTotalMae: number;
    forwardSeason: 2026;
    passedLaunchGate: false;
  };
  localOnly: true;
  actionable: false;
};

type InputBundle = {
  inputRelease: string;
  exportedAt: string;
  slate: NflRegularProviderSlate;
  availability: PreviewAvailabilityByGame;
};

export type NflStoredPriceHistoryByGame = Record<string, NflPreviewBookOdds[]>;

type ScoredProjection = Omit<NflRegularLocalProjection, "release" | "featureRelease" | "trainedThrough" | "homeRecent" | "awayRecent">;
type ScoredSnapshot = {
  snapshotRelease: string;
  modelRelease: string;
  sourceTournamentModelRelease?: string;
  sourceModelRelease?: string;
  referenceRelease?: string;
  calibrationRelease?: string;
  featureRelease: string;
  generatedAt: string;
  week: number;
  seasonPhase?: "regular" | "preseason";
  productWeek?: number | null;
  providerInputSha256: string;
  marketEvidenceRelease?: string;
  marketEvidenceSha256?: string;
  rosterInputSha256?: string;
  modelArtifactSha256: string;
  stateArtifactSha256: string;
  projectionsByGame: Record<string, ScoredProjection>;
  actionable: false;
};

export async function loadNflRegularPipelinePreseasonSlate(productWeek: number): Promise<{
  providerSlate: NflRegularProviderSlate;
  availability: PreviewAvailabilityByGame;
  localSlate: NflRegularLocalSlate;
  priceHistoryByGame: NflStoredPriceHistoryByGame;
}> {
  const currentRoot = path.resolve(process.cwd(), "football-research/cache/nfl-model/current");
  const manifestPath = path.join(currentRoot, `nfl_preseason_2026_product_week_${productWeek}.latest.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    inputRelease?: unknown;
    filename?: unknown;
    sha256?: unknown;
  };
  if (
    manifest.inputRelease !== "nfl_preseason_current_provider_inputs_2026_08_19_r2" ||
    typeof manifest.filename !== "string" ||
    typeof manifest.sha256 !== "string"
  ) {
    throw new Error("Invalid NFL preseason rehearsal provider manifest.");
  }
  const inputBytes = await readFile(path.join(currentRoot, manifest.filename));
  const inputChecksum = createHash("sha256").update(inputBytes).digest("hex");
  if (inputChecksum !== manifest.sha256) throw new Error("NFL preseason rehearsal provider checksum mismatch.");
  const input = JSON.parse(inputBytes.toString("utf8")) as InputBundle;

  const rosterManifest = JSON.parse(await readFile(
    path.join(currentRoot, "nfl_regular_2026_week_1.latest.json"),
    "utf8",
  )) as { inputRelease?: unknown; sha256?: unknown };
  if (
    rosterManifest.inputRelease !== "nfl_regular_current_provider_inputs_2026_08_19_r1" ||
    typeof rosterManifest.sha256 !== "string"
  ) {
    throw new Error("Invalid NFL preseason rehearsal roster manifest.");
  }

  const scoredBytes = await readFile(path.join(
    currentRoot,
    `nfl_preseason_2026_product_week_${productWeek}.regular-rehearsal.scored.json`,
  ));
  const scoredChecksum = createHash("sha256").update(scoredBytes).digest("hex");
  const scored = JSON.parse(scoredBytes.toString("utf8")) as ScoredSnapshot;
  if (
    scored.snapshotRelease !== NFL_REGULAR_PIPELINE_PRESEASON_SNAPSHOT_RELEASE ||
    scored.modelRelease !== NFL_PRESEASON_REHEARSAL_MODEL_RELEASE ||
    scored.sourceTournamentModelRelease !== NFL_PRESEASON_REHEARSAL_SOURCE_MODEL_RELEASE ||
    scored.featureRelease !== NFL_PRESEASON_REHEARSAL_FEATURE_RELEASE ||
    scored.seasonPhase !== "preseason" ||
    scored.productWeek !== productWeek ||
    scored.providerInputSha256 !== inputChecksum ||
    scored.rosterInputSha256 !== rosterManifest.sha256 ||
    scored.actionable !== false
  ) {
    throw new Error("NFL regular-pipeline preseason snapshot release/input mismatch.");
  }
  if (
    input.slate.games.length === 0 ||
    Object.keys(input.availability).length !== input.slate.games.length
  ) {
    throw new Error("NFL regular-pipeline preseason input is incomplete.");
  }
  const assembled = await assembleRegularLocalSlate({ input, scored, scoredChecksum });
  const priceHistoryByGame = await loadStoredPreseasonPriceHistory({
    currentRoot,
    productWeek,
    providerSlate: input.slate,
  });
  return { ...assembled, priceHistoryByGame };
}

export async function loadNflRegularLocalSlate(week: number): Promise<{
  providerSlate: NflRegularProviderSlate;
  availability: PreviewAvailabilityByGame;
  localSlate: NflRegularLocalSlate;
  priceHistoryByGame: NflStoredPriceHistoryByGame;
  consensusSplitsByGame: Record<string, Record<"moneyline" | "spread" | "total", NflRegularConsensusSplit>>;
}> {
  const currentRoot = path.resolve(process.cwd(), "football-research/cache/nfl-model/current");
  const manifestPath = path.join(currentRoot, `nfl_regular_2026_week_${week}.latest.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    inputRelease?: unknown;
    filename?: unknown;
    sha256?: unknown;
  };
  if (manifest.inputRelease !== "nfl_regular_current_provider_inputs_2026_08_19_r1" || typeof manifest.filename !== "string" || typeof manifest.sha256 !== "string") {
    throw new Error("Invalid current NFL regular provider manifest.");
  }
  const inputBytes = await readFile(path.join(currentRoot, manifest.filename));
  const inputChecksum = createHash("sha256").update(inputBytes).digest("hex");
  if (inputChecksum !== manifest.sha256) throw new Error("Current NFL regular provider checksum mismatch.");
  const input = JSON.parse(inputBytes.toString("utf8")) as InputBundle;
  const marketEvidence = await readCurrentNflRegularMarketEvidence(week);
  const scoredBytes = await readFile(path.join(currentRoot, `nfl_regular_2026_week_${week}.daily-edge.scored.json`));
  const scoredChecksum = createHash("sha256").update(scoredBytes).digest("hex");
  const scored = JSON.parse(scoredBytes.toString("utf8")) as ScoredSnapshot;
  if (
    scored.snapshotRelease !== NFL_REGULAR_LOCAL_SNAPSHOT_RELEASE ||
    scored.modelRelease !== NFL_REGULAR_LOCAL_MODEL_RELEASE ||
    scored.sourceModelRelease !== NFL_REGULAR_LOCAL_SOURCE_MODEL_RELEASE ||
    scored.referenceRelease !== NFL_REGULAR_LOCAL_REFERENCE_RELEASE ||
    scored.calibrationRelease !== NFL_REGULAR_LOCAL_CALIBRATION_RELEASE ||
    scored.featureRelease !== NFL_REGULAR_LOCAL_FEATURE_RELEASE ||
    scored.marketEvidenceRelease !== NFL_REGULAR_MARKET_EVIDENCE_RELEASE ||
    scored.marketEvidenceSha256 !== marketEvidence.pointer.sha256 ||
    scored.week !== week ||
    scored.providerInputSha256 !== inputChecksum ||
    scored.actionable !== false
  ) {
    throw new Error("NFL regular scored snapshot release/input mismatch.");
  }
  const providerSlate = overlayNflRegularMarketEvidence(input.slate, marketEvidence.payload);
  const assembled = await assembleRegularLocalSlate({ input: { ...input, slate: providerSlate }, scored, scoredChecksum });
  return {
    ...assembled,
    priceHistoryByGame: marketEvidence.payload.priceHistoryByGame,
    consensusSplitsByGame: marketEvidence.payload.consensusSplitsByGame,
  };
}

async function assembleRegularLocalSlate(args: {
  input: InputBundle;
  scored: ScoredSnapshot;
  scoredChecksum: string;
}): Promise<{
  providerSlate: NflRegularProviderSlate;
  availability: PreviewAvailabilityByGame;
  localSlate: NflRegularLocalSlate;
}> {
  const { input, scored, scoredChecksum } = args;
  const displayTeams = new Set(input.slate.games.flatMap((game) => [game.away.abbreviation, game.home.abbreviation]));
  const recent = await loadNflRecentCompletedContext(displayTeams);
  const projectionsByGame = Object.fromEntries(input.slate.games.map((game) => {
    const frozen = scored.projectionsByGame[game.providerGameId];
    if (!frozen || frozen.home !== game.home.abbreviation || frozen.away !== game.away.abbreviation) {
      throw new Error(`NFL regular scored game identity mismatch for ${game.providerGameId}.`);
    }
    return [game.providerGameId, {
      ...frozen,
      release: scored.modelRelease as NflRegularLocalProjection["release"],
      featureRelease: scored.featureRelease as NflRegularLocalProjection["featureRelease"],
      trainedThrough: "2025-12-31" as const,
      homeRecent: recent.summariesByTeam[game.home.abbreviation],
      awayRecent: recent.summariesByTeam[game.away.abbreviation],
      actionable: false as const,
    }];
  }));
  if (Object.keys(projectionsByGame).length !== input.slate.games.length) {
    throw new Error("NFL regular provider/projection count mismatch.");
  }
  return {
    providerSlate: input.slate,
    availability: input.availability,
    localSlate: {
      modelRelease: scored.modelRelease as NflRegularLocalSlate["modelRelease"],
      featureRelease: scored.featureRelease as NflRegularLocalSlate["featureRelease"],
      source: scored.modelRelease === NFL_REGULAR_LOCAL_MODEL_RELEASE
        ? "accepted market reference + nflverse player-value/QB state + BALLDONTLIE schedule/odds/injuries/depth"
        : "nflverse play-by-play/QB/roster state + BALLDONTLIE schedule/odds/injuries/depth",
      sourceChecksum: scoredChecksum,
      sourceFetchedAt: recent.sourceFetchedAt,
      generatedAt: scored.generatedAt,
      projectionsByGame,
      history: recent.history,
      validation: {
        historicalHoldoutSeason: 2025,
        marginMae: scored.modelRelease === NFL_REGULAR_LOCAL_MODEL_RELEASE ? 9.722426470588236 : 9.75704420076305,
        marketMarginMae: 9.722426470588236,
        totalMae: scored.modelRelease === NFL_REGULAR_LOCAL_MODEL_RELEASE ? 10.385639566193708 : 10.45073002928054,
        marketTotalMae: 10.393382352941176,
        forwardSeason: 2026,
        passedLaunchGate: false,
      },
      localOnly: true,
      actionable: false,
    },
  };
}

async function loadStoredPreseasonPriceHistory(args: {
  currentRoot: string;
  productWeek: number;
  providerSlate: NflRegularProviderSlate;
}): Promise<NflStoredPriceHistoryByGame> {
  const prefix = `nfl_preseason_2026_product_week_${args.productWeek}_`;
  const filenames = (await readdir(args.currentRoot))
    .filter((filename) => filename.startsWith(prefix) && /^nfl_preseason_2026_product_week_\d+_[a-f0-9]{16}\.json$/.test(filename))
    .sort();
  if (filenames.length === 0) throw new Error("NFL preseason price history has no checksum-backed observations.");

  const expectedGameIds = args.providerSlate.games.map((game) => game.providerGameId).sort();
  const history: NflStoredPriceHistoryByGame = Object.fromEntries(expectedGameIds.map((gameId) => [gameId, []]));
  for (const filename of filenames) {
    const bytes = await readFile(path.join(args.currentRoot, filename));
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const suffix = filename.slice(prefix.length, -".json".length);
    if (!checksum.startsWith(suffix)) throw new Error(`NFL preseason price-history checksum mismatch for ${filename}.`);
    const input = JSON.parse(bytes.toString("utf8")) as InputBundle;
    const observedGameIds = input.slate.games.map((game) => game.providerGameId).sort();
    if (
      !input.inputRelease.startsWith("nfl_preseason_current_provider_inputs_2026_08_19_r") ||
      input.slate.season !== args.providerSlate.season ||
      input.slate.productWeek !== args.providerSlate.productWeek ||
      input.slate.providerWeek !== args.providerSlate.providerWeek ||
      observedGameIds.join("|") !== expectedGameIds.join("|")
    ) {
      throw new Error(`NFL preseason price-history identity mismatch for ${filename}.`);
    }
    for (const gameId of expectedGameIds) {
      const odds = input.slate.currentOddsByGame[gameId];
      if (!odds) throw new Error(`NFL preseason price history is missing game ${gameId} in ${filename}.`);
      history[gameId]!.push(odds);
    }
  }

  for (const gameId of expectedGameIds) {
    const observations = history[gameId]!
      .sort((first, second) => Date.parse(first.observedAt) - Date.parse(second.observedAt))
      .filter((value, index, rows) => index === 0 || value.observedAt !== rows[index - 1]!.observedAt);
    history[gameId] = observations;
  }
  return history;
}
