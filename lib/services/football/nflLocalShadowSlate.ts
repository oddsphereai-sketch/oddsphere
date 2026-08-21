import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  PreviewAvailabilityByGame,
  PreviewHistoryByTeam,
} from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import {
  footballNormalCdf,
  type CompletedMarginGame,
} from "./footballDynamicMarginBenchmark";
import type { NflPreviewProviderSlate } from "./balldontlieNflPreviewSlate";

export const NFL_LOCAL_SHADOW_MODEL_RELEASE =
  "nfl_preseason_real_local_candidate_2026_08_19_r2" as const;
export const NFL_LOCAL_SHADOW_FEATURE_RELEASE =
  "nfl_preseason_prior_regular_state_features_2026_08_19_r1" as const;
export const NFL_LOCAL_SHADOW_SNAPSHOT_RELEASE =
  "nfl_preseason_real_current_snapshot_2026_08_19_r2" as const;
export const NFL_LOCAL_SHADOW_INPUT_RELEASE =
  "nfl_preseason_current_provider_inputs_2026_08_19_r2" as const;

export type NflRecentTeamSummary = {
  games: number;
  wins: number;
  losses: number;
  ties: number;
  averagePointsFor: number;
  averagePointsAgainst: number;
  averageMargin: number;
  averageGameTotal: number;
};

export type NflLocalShadowProjection = {
  providerGameId: string;
  release: typeof NFL_LOCAL_SHADOW_MODEL_RELEASE;
  featureRelease: typeof NFL_LOCAL_SHADOW_FEATURE_RELEASE;
  generatedAt: string;
  trainedThrough: string | null;
  projectedHomeMargin: number;
  projectedTotal: number;
  projectedHomeScore: number;
  projectedAwayScore: number;
  homeWinProbability: number;
  homeCoverProbability: number;
  overProbability: number;
  marginStdDev: number;
  totalStdDev: number;
  homeRecent: NflRecentTeamSummary;
  awayRecent: NflRecentTeamSummary;
  dataHealthFindings: string[];
  actionable: false;
};

export type NflLocalShadowSlate = {
  modelRelease: typeof NFL_LOCAL_SHADOW_MODEL_RELEASE;
  featureRelease: typeof NFL_LOCAL_SHADOW_FEATURE_RELEASE;
  source: "BALLDONTLIE preseason outcomes + nflverse play-by-play/team state";
  sourceChecksum: string;
  sourceFetchedAt: string;
  generatedAt: string;
  projectionsByGame: Record<string, NflLocalShadowProjection>;
  history: PreviewHistoryByTeam;
  validation: {
    selectionSeasons: readonly [2022, 2023, 2024];
    holdoutSeason: 2025;
    holdoutGames: 49;
    holdoutMarginMae: number;
    holdoutTotalMae: number;
    holdoutHomeWinBrier: number;
    passedPredictiveGate: false;
  };
  localOnly: true;
  actionable: false;
};

type CsvRow = Record<string, string>;
type HistoricalResult = CompletedMarginGame & {
  gameType: string;
  gameDate: string;
};

const EXPECTED_TOURNAMENT_RELEASE = "nfl_preseason_real_model_tournament_2026_08_19_r1";

type ScoredPreseasonSnapshot = {
  snapshotRelease: string;
  modelRelease: string;
  featureRelease: string;
  productWeek: number;
  providerInputSha256: string;
  modelArtifactSha256: string;
  distribution: {
    kernelBandwidthPoints: number;
    marginResiduals: number[];
    totalResiduals: number[];
  };
  projectionsByGame: Record<string, {
    providerGameId: string;
    home: string;
    away: string;
    projectedHomeMargin: number;
    projectedTotal: number;
    projectedHomeScore: number;
    projectedAwayScore: number;
    marginStdDev: number;
    totalStdDev: number;
    dataHealthFindings: string[];
  }>;
};

type PreseasonInputBundle = {
  inputRelease: typeof NFL_LOCAL_SHADOW_INPUT_RELEASE;
  exportedAt: string;
  slate: NflPreviewProviderSlate;
  availability: PreviewAvailabilityByGame;
};

export async function loadNflPreseasonLocalSlate(productWeek: number): Promise<{
  providerSlate: NflPreviewProviderSlate;
  availability: PreviewAvailabilityByGame;
  localSlate: NflLocalShadowSlate;
}> {
  const currentRoot = path.resolve(process.cwd(), "football-research/cache/nfl-model/current");
  const manifestPath = path.join(currentRoot, `nfl_preseason_2026_product_week_${productWeek}.latest.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    inputRelease?: unknown;
    filename?: unknown;
    sha256?: unknown;
  };
  if (
    manifest.inputRelease !== NFL_LOCAL_SHADOW_INPUT_RELEASE ||
    typeof manifest.filename !== "string" ||
    path.basename(manifest.filename) !== manifest.filename ||
    typeof manifest.sha256 !== "string"
  ) {
    throw new Error("Invalid current NFL preseason provider manifest.");
  }
  const inputBytes = await readFile(path.join(currentRoot, manifest.filename));
  const inputChecksum = createHash("sha256").update(inputBytes).digest("hex");
  if (inputChecksum !== manifest.sha256) throw new Error("Current NFL preseason provider checksum mismatch.");
  const input = JSON.parse(inputBytes.toString("utf8")) as PreseasonInputBundle;
  if (
    input.inputRelease !== NFL_LOCAL_SHADOW_INPUT_RELEASE ||
    input.slate.productWeek !== productWeek ||
    input.slate.games.length === 0 ||
    Object.keys(input.availability).length !== input.slate.games.length
  ) {
    throw new Error("Current NFL preseason stored slate is incomplete.");
  }
  const localSlate = await buildNflLocalShadowSlate(input.slate, inputChecksum);
  return { providerSlate: input.slate, availability: input.availability, localSlate };
}

/**
 * Genuine local shadow calculation from the frozen preseason model artifact.
 * The fitted model uses real 2019-2024 preseason outcomes and prior-regular-
 * season nflverse state. It remains non-actionable because 2025 confirmed that
 * side prediction without historical rotation plans is not reliable.
 */
export async function buildNflLocalShadowSlate(
  providerSlate: NflPreviewProviderSlate,
  providerInputSha256: string,
): Promise<NflLocalShadowSlate> {
  const scoredPath = path.resolve(
    process.cwd(),
    `football-research/cache/nfl-model/current/nfl_preseason_2026_product_week_${providerSlate.productWeek}.scored.json`,
  );
  const scoredBytes = await readFile(scoredPath);
  const scoredChecksum = createHash("sha256").update(scoredBytes).digest("hex");
  const scored = JSON.parse(scoredBytes.toString("utf8")) as ScoredPreseasonSnapshot;
  if (
    scored.snapshotRelease !== NFL_LOCAL_SHADOW_SNAPSHOT_RELEASE ||
    scored.modelRelease !== NFL_LOCAL_SHADOW_MODEL_RELEASE ||
    scored.featureRelease !== NFL_LOCAL_SHADOW_FEATURE_RELEASE ||
    scored.productWeek !== providerSlate.productWeek ||
    scored.providerInputSha256 !== providerInputSha256
  ) {
    throw new Error("NFL preseason scored snapshot release/week mismatch.");
  }
  if (
    scored.distribution.marginResiduals.length < 100 ||
    scored.distribution.totalResiduals.length < 100 ||
    !Number.isFinite(scored.distribution.kernelBandwidthPoints) ||
    scored.distribution.kernelBandwidthPoints <= 0
  ) {
    throw new Error("NFL preseason scored snapshot is missing its fitted predictive distribution.");
  }
  const cacheRoot = path.resolve(process.cwd(), "football-research/cache/nflverse");
  const manifest = JSON.parse(await readFile(path.join(cacheRoot, "games.latest.json"), "utf8")) as {
    filename?: unknown;
    sha256?: unknown;
    fetchedAt?: unknown;
  };
  if (typeof manifest.filename !== "string" || typeof manifest.sha256 !== "string" || typeof manifest.fetchedAt !== "string") {
    throw new Error("Invalid nflverse games cache manifest.");
  }
  const bytes = await readFile(path.join(cacheRoot, manifest.filename));
  const sourceChecksum = createHash("sha256").update(bytes).digest("hex");
  if (sourceChecksum !== manifest.sha256) throw new Error("nflverse games cache checksum mismatch.");
  const historyRows = parseCsv(bytes.toString("utf8")).map(toHistoricalResult)
    .filter((row): row is HistoricalResult => row !== null);
  const completedRegular = historyRows.filter((row) => row.gameType === "REG" && row.season >= 2010 && row.season <= 2025);
  if (completedRegular.length < 4_000) throw new Error("nflverse history is too small for the pinned NFL shadow benchmark.");

  const report = JSON.parse(await readFile(
    path.resolve(process.cwd(), "football-research/reports/nfl_preseason_real_model_tournament_2026_08_19_r1.json"),
    "utf8",
  )) as Record<string, unknown>;
  const validation = validatedReport(report, scored.modelArtifactSha256);
  const generatedAt = providerSlate.fetchedAt;
  const projectionsByGame: Record<string, NflLocalShadowProjection> = {};
  const displayTeams = new Set(providerSlate.games.flatMap((game) => [game.away.abbreviation, game.home.abbreviation]));
  const history = buildRealHistory(historyRows, displayTeams);

  for (const game of providerSlate.games) {
    const homeTeamId = toNflverseAbbreviation(game.home.abbreviation);
    const awayTeamId = toNflverseAbbreviation(game.away.abbreviation);
    const recentHomeRows = recentRowsForTeam(historyRows, homeTeamId, 10);
    const recentAwayRows = recentRowsForTeam(historyRows, awayTeamId, 10);
    if (recentHomeRows.length < 10 || recentAwayRows.length < 10) {
      throw new Error(`Insufficient real recent-game history for ${game.away.abbreviation} at ${game.home.abbreviation}.`);
    }
    const current = providerSlate.currentOddsByGame[game.providerGameId];
    const frozen = scored.projectionsByGame[game.providerGameId];
    if (!current?.spread || !current.total || !frozen || frozen.home !== game.home.abbreviation || frozen.away !== game.away.abbreviation) {
      throw new Error(`Scored NFL preseason evidence is incomplete for ${game.providerGameId}.`);
    }
    const marketHomeMargin = -current.spread.homeLine;
    const homeWinProbability = empiricalProbability({
      prediction: frozen.projectedHomeMargin,
      threshold: 0,
      residuals: scored.distribution.marginResiduals,
      bandwidth: scored.distribution.kernelBandwidthPoints,
    });
    const homeCoverProbability = empiricalProbability({
      prediction: frozen.projectedHomeMargin,
      threshold: marketHomeMargin,
      residuals: scored.distribution.marginResiduals,
      bandwidth: scored.distribution.kernelBandwidthPoints,
    });
    const overProbability = empiricalProbability({
      prediction: frozen.projectedTotal,
      threshold: current.total.line,
      residuals: scored.distribution.totalResiduals,
      bandwidth: scored.distribution.kernelBandwidthPoints,
    });
    projectionsByGame[game.providerGameId] = {
      providerGameId: game.providerGameId,
      release: NFL_LOCAL_SHADOW_MODEL_RELEASE,
      featureRelease: NFL_LOCAL_SHADOW_FEATURE_RELEASE,
      generatedAt,
      trainedThrough: "2024-08-31",
      projectedHomeMargin: frozen.projectedHomeMargin,
      projectedTotal: frozen.projectedTotal,
      projectedHomeScore: frozen.projectedHomeScore,
      projectedAwayScore: frozen.projectedAwayScore,
      homeWinProbability,
      homeCoverProbability,
      overProbability,
      marginStdDev: frozen.marginStdDev,
      totalStdDev: frozen.totalStdDev,
      homeRecent: summarizeTeam(recentHomeRows, homeTeamId),
      awayRecent: summarizeTeam(recentAwayRows, awayTeamId),
      dataHealthFindings: [
        ...frozen.dataHealthFindings,
        "preseason_side_candidate_failed_2025_predictive_gate",
      ],
      actionable: false,
    };
  }

  return {
    modelRelease: NFL_LOCAL_SHADOW_MODEL_RELEASE,
    featureRelease: NFL_LOCAL_SHADOW_FEATURE_RELEASE,
    source: "BALLDONTLIE preseason outcomes + nflverse play-by-play/team state",
    sourceChecksum: scoredChecksum,
    sourceFetchedAt: manifest.fetchedAt,
    generatedAt,
    projectionsByGame,
    history,
    validation,
    localOnly: true,
    actionable: false,
  };
}

function validatedReport(report: Record<string, unknown>, artifactChecksum: string): NflLocalShadowSlate["validation"] {
  const margin = record(report.margin);
  const total = record(report.total);
  const marginHoldout = record(margin.holdout);
  const totalHoldout = record(total.holdout);
  if (
    report.tournamentRelease !== EXPECTED_TOURNAMENT_RELEASE ||
    report.modelRelease !== NFL_LOCAL_SHADOW_MODEL_RELEASE ||
    report.featureRelease !== NFL_LOCAL_SHADOW_FEATURE_RELEASE ||
    report.artifactSha256 !== artifactChecksum
  ) {
    throw new Error("NFL preseason model report release/checksum does not match the scored artifact.");
  }
  const holdoutGames = finite(marginHoldout.rows);
  const holdoutMarginMae = finite(marginHoldout.mae);
  const holdoutTotalMae = finite(totalHoldout.mae);
  const holdoutHomeWinBrier = finite(report.holdoutHomeWinBrier);
  if ([holdoutGames, holdoutMarginMae, holdoutTotalMae, holdoutHomeWinBrier].some((value) => value === null)) {
    throw new Error("NFL preseason report is missing required holdout metrics.");
  }
  if (holdoutGames !== 49 || holdoutHomeWinBrier! <= 0.25) {
    throw new Error("NFL preseason gate status changed; create a new immutable release before presenting it.");
  }
  return {
    selectionSeasons: [2022, 2023, 2024],
    holdoutSeason: 2025,
    holdoutGames: 49,
    holdoutMarginMae: holdoutMarginMae!,
    holdoutTotalMae: holdoutTotalMae!,
    holdoutHomeWinBrier: holdoutHomeWinBrier!,
    passedPredictiveGate: false,
  };
}

function empiricalProbability(args: {
  prediction: number;
  threshold: number;
  residuals: number[];
  bandwidth: number;
}): number {
  const probability = args.residuals.reduce((sum, residual) => (
    sum + footballNormalCdf((args.prediction + residual - args.threshold) / args.bandwidth)
  ), 0) / args.residuals.length;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("NFL preseason empirical probability is invalid.");
  }
  return probability;
}

function buildRealHistory(rows: HistoricalResult[], displayTeams: ReadonlySet<string>): PreviewHistoryByTeam {
  const result: PreviewHistoryByTeam = {};
  for (const displayTeam of displayTeams) {
    const team = toNflverseAbbreviation(displayTeam);
    result[displayTeam] = recentRowsForTeam(rows, team, 10).map((row) => {
      const home = row.homeTeamId === team;
      const pointsFor = home ? row.homeScore : row.awayScore;
      const pointsAgainst = home ? row.awayScore : row.homeScore;
      return {
        date: row.gameDate,
        opponent: fromNflverseAbbreviation(home ? row.awayTeamId : row.homeTeamId),
        runsFor: pointsFor,
        runsAgainst: pointsAgainst,
        totalRuns: pointsFor + pointsAgainst,
        firstInningRuns: null,
        won: pointsFor > pointsAgainst,
        drawn: pointsFor === pointsAgainst,
      };
    });
  }
  return result;
}

function recentRowsForTeam(rows: HistoricalResult[], team: string, limit: number): HistoricalResult[] {
  return rows
    .filter((row) => row.season === 2025 && (row.gameType === "REG" || row.gameType === "POST"))
    .filter((row) => row.homeTeamId === team || row.awayTeamId === team)
    .sort((first, second) => Date.parse(second.kickoff) - Date.parse(first.kickoff))
    .slice(0, limit);
}

function summarizeTeam(rows: HistoricalResult[], team: string): NflRecentTeamSummary {
  const sides = rows.map((row) => {
    const home = row.homeTeamId === team;
    const pointsFor = home ? row.homeScore : row.awayScore;
    const pointsAgainst = home ? row.awayScore : row.homeScore;
    return { pointsFor, pointsAgainst };
  });
  return {
    games: sides.length,
    wins: sides.filter((row) => row.pointsFor > row.pointsAgainst).length,
    losses: sides.filter((row) => row.pointsFor < row.pointsAgainst).length,
    ties: sides.filter((row) => row.pointsFor === row.pointsAgainst).length,
    averagePointsFor: mean(sides.map((row) => row.pointsFor)),
    averagePointsAgainst: mean(sides.map((row) => row.pointsAgainst)),
    averageMargin: mean(sides.map((row) => row.pointsFor - row.pointsAgainst)),
    averageGameTotal: mean(sides.map((row) => row.pointsFor + row.pointsAgainst)),
  };
}

function toHistoricalResult(row: CsvRow): HistoricalResult | null {
  const season = finiteString(row.season);
  const week = finiteString(row.week);
  const homeScore = finiteString(row.home_score);
  const awayScore = finiteString(row.away_score);
  if (season === null || week === null || homeScore === null || awayScore === null || !row.home_team || !row.away_team || !row.game_id) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.gameday)) return null;
  return {
    league: "nfl",
    gameId: row.game_id,
    season,
    week,
    seasonPhase: row.game_type === "REG" ? "regular" : row.game_type === "POST" ? "postseason" : "preseason",
    kickoff: `${row.gameday}T17:00:00.000Z`,
    homeTeamId: row.home_team,
    awayTeamId: row.away_team,
    neutralSite: row.location === "Neutral",
    homeScore,
    awayScore,
    gameType: row.game_type,
    gameDate: row.gameday,
  };
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.trimEnd().split(/\r?\n/);
  const header = parseCsvLine(lines[0] ?? "");
  return lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    if (values.length !== header.length) throw new Error(`Malformed nflverse CSV row ${rowIndex + 2}.`);
    return Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]));
  });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function toNflverseAbbreviation(value: string): string {
  const normalized = value.toUpperCase();
  if (normalized === "LAR") return "LA";
  if (normalized === "WSH") return "WAS";
  return normalized;
}

function fromNflverseAbbreviation(value: string): string {
  if (value === "LA") return "LAR";
  if (value === "WAS") return "WSH";
  return value;
}

function mean(values: number[]): number {
  if (values.length === 0) throw new Error("Cannot calculate a mean from an empty sample.");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function finiteString(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export const __NFL_LOCAL_SHADOW_SLATE_TEST__ = {
  parseCsvLine,
  toNflverseAbbreviation,
  fromNflverseAbbreviation,
  summarizeTeam,
};

export async function loadNflRecentCompletedContext(
  displayTeams: ReadonlySet<string>,
): Promise<{
  history: PreviewHistoryByTeam;
  summariesByTeam: Record<string, NflRecentTeamSummary>;
  sourceChecksum: string;
  sourceFetchedAt: string;
}> {
  const cacheRoot = path.resolve(process.cwd(), "football-research/cache/nflverse");
  const manifest = JSON.parse(await readFile(path.join(cacheRoot, "games.latest.json"), "utf8")) as {
    filename?: unknown;
    sha256?: unknown;
    fetchedAt?: unknown;
  };
  if (typeof manifest.filename !== "string" || typeof manifest.sha256 !== "string" || typeof manifest.fetchedAt !== "string") {
    throw new Error("Invalid nflverse games cache manifest.");
  }
  const bytes = await readFile(path.join(cacheRoot, manifest.filename));
  const sourceChecksum = createHash("sha256").update(bytes).digest("hex");
  if (sourceChecksum !== manifest.sha256) throw new Error("nflverse games cache checksum mismatch.");
  const rows = parseCsv(bytes.toString("utf8")).map(toHistoricalResult)
    .filter((row): row is HistoricalResult => row !== null);
  const summariesByTeam = Object.fromEntries([...displayTeams].map((displayTeam) => {
    const team = toNflverseAbbreviation(displayTeam);
    const recent = recentRowsForTeam(rows, team, 10);
    if (recent.length < 10) throw new Error(`Insufficient recent completed history for ${displayTeam}.`);
    return [displayTeam, summarizeTeam(recent, team)];
  }));
  return {
    history: buildRealHistory(rows, displayTeams),
    summariesByTeam,
    sourceChecksum,
    sourceFetchedAt: manifest.fetchedAt,
  };
}
