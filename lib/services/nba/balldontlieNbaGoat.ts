/**
 * BALLDONTLIE NBA GOAT team-feature client.
 *
 * This module is deliberately DB-free. It captures the provider's full team
 * season-average surface for research/shadow storage without deciding which
 * features belong in the production model. Production promotion is a separate
 * chronological model-change decision.
 */

export const NBA_BDL_GOAT_TEAM_FEATURE_RELEASE =
  "nba_bdl_goat_team_features_2026_10_15_r1" as const;

const NBA_BDL_BASE_URL = "https://api.balldontlie.io/nba/v1";
const DEFAULT_MAX_PAGES_PER_FEATURE = 2;
const DEFAULT_PER_PAGE = 100;

export type NbaBdlSeasonType = "regular" | "playoffs" | "ist";

export type NbaBdlTeamFeatureSelection = Readonly<{
  category:
    | "general"
    | "clutch"
    | "shooting"
    | "playtype"
    | "tracking"
    | "hustle"
    | "shotdashboard";
  type: string | null;
  researchRole: "core" | "matchup" | "rotation_context" | "exploratory";
}>;

const selections = (
  category: NbaBdlTeamFeatureSelection["category"],
  types: readonly string[],
  researchRole: NbaBdlTeamFeatureSelection["researchRole"],
): NbaBdlTeamFeatureSelection[] =>
  types.map((type) => ({ category, type, researchRole }));

/**
 * Provider-complete manifest as documented on 2026-10-15.
 *
 * Completeness here means "capture for research," not "put every field in the
 * model." Each family must earn production use on chronological holdout data.
 */
export const NBA_BDL_TEAM_FEATURE_MANIFEST: readonly NbaBdlTeamFeatureSelection[] = [
  ...selections(
    "general",
    ["base", "advanced", "scoring", "misc", "opponent", "defense"],
    "core",
  ),
  ...selections("general", ["violations"], "exploratory"),
  ...selections("clutch", ["base", "advanced", "misc", "scoring"], "exploratory"),
  ...selections(
    "shooting",
    ["by_zone_base", "by_zone_opponent", "5ft_range_base", "5ft_range_opponent"],
    "matchup",
  ),
  ...selections(
    "playtype",
    [
      "cut",
      "handoff",
      "isolation",
      "offrebound",
      "offscreen",
      "postup",
      "prballhandler",
      "prrollman",
      "spotup",
      "transition",
      "misc",
    ],
    "matchup",
  ),
  ...selections(
    "tracking",
    [
      "painttouch",
      "efficiency",
      "speeddistance",
      "defense",
      "elbowtouch",
      "posttouch",
      "passing",
      "drives",
      "rebounding",
      "catchshoot",
      "pullupshot",
      "possessions",
    ],
    "matchup",
  ),
  { category: "hustle", type: null, researchRole: "rotation_context" },
  ...selections(
    "shotdashboard",
    ["overall", "pullups", "catch_and_shoot", "less_than_10_ft"],
    "matchup",
  ),
] as const;

type JsonScalar = string | number | boolean | null;

export type NbaBdlTeamFeatureObservation = {
  providerTeamId: number;
  abbreviation: string;
  teamName: string;
  season: number;
  seasonType: NbaBdlSeasonType;
  category: NbaBdlTeamFeatureSelection["category"];
  statType: string | null;
  researchRole: NbaBdlTeamFeatureSelection["researchRole"];
  stats: Record<string, JsonScalar>;
  sourcePath: string;
};

export type NbaBdlTeamFeatureSnapshot = {
  release: typeof NBA_BDL_GOAT_TEAM_FEATURE_RELEASE;
  fetchedAt: string;
  season: number;
  seasonType: NbaBdlSeasonType;
  selectionsRequested: number;
  providerRequests: number;
  observations: NbaBdlTeamFeatureObservation[];
};

type RawTeam = {
  id?: unknown;
  abbreviation?: unknown;
  full_name?: unknown;
  name?: unknown;
};

type RawTeamFeatureRow = {
  team?: RawTeam | null;
  season?: unknown;
  season_type?: unknown;
  stats?: unknown;
};

type RawEnvelope = {
  data?: unknown;
  meta?: { next_cursor?: unknown } | null;
  error?: unknown;
};

function asFiniteInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && Number.isFinite(number) ? number : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStats(value: unknown): Record<string, JsonScalar> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized: Record<string, JsonScalar> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (
      raw === null ||
      typeof raw === "string" ||
      typeof raw === "boolean" ||
      (typeof raw === "number" && Number.isFinite(raw))
    ) {
      normalized[key] = raw;
    }
  }
  return normalized;
}

function queryString(args: {
  season: number;
  seasonType: NbaBdlSeasonType;
  type: string | null;
  cursor?: string | number;
}): string {
  const query = new URLSearchParams({
    season: String(args.season),
    season_type: args.seasonType,
    per_page: String(DEFAULT_PER_PAGE),
  });
  if (args.type !== null) query.set("type", args.type);
  if (args.cursor !== undefined) query.set("cursor", String(args.cursor));
  return query.toString();
}

function normalizeRow(args: {
  row: RawTeamFeatureRow;
  expectedSeason: number;
  expectedSeasonType: NbaBdlSeasonType;
  selection: NbaBdlTeamFeatureSelection;
  sourcePath: string;
}): NbaBdlTeamFeatureObservation {
  const providerTeamId = asFiniteInteger(args.row.team?.id);
  const abbreviation = asNonEmptyString(args.row.team?.abbreviation);
  const teamName =
    asNonEmptyString(args.row.team?.full_name) ?? asNonEmptyString(args.row.team?.name);
  const season = asFiniteInteger(args.row.season);
  const seasonType = asNonEmptyString(args.row.season_type);
  const stats = normalizeStats(args.row.stats);
  if (providerTeamId === null || abbreviation === null || teamName === null || stats === null) {
    throw new Error(
      `BALLDONTLIE NBA ${args.selection.category}/${args.selection.type ?? "none"} returned a malformed team row.`,
    );
  }
  if (season !== args.expectedSeason || seasonType !== args.expectedSeasonType) {
    throw new Error(
      `BALLDONTLIE NBA team feature identity mismatch: expected ${args.expectedSeason}/${args.expectedSeasonType}, received ${season}/${seasonType ?? "unknown"}.`,
    );
  }
  return {
    providerTeamId,
    abbreviation: abbreviation.toUpperCase(),
    teamName,
    season,
    seasonType: args.expectedSeasonType,
    category: args.selection.category,
    statType: args.selection.type,
    researchRole: args.selection.researchRole,
    stats,
    sourcePath: args.sourcePath,
  };
}

export async function fetchNbaBdlTeamFeatureSnapshot(args: {
  season: number;
  seasonType: NbaBdlSeasonType;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  manifest?: readonly NbaBdlTeamFeatureSelection[];
  maxPagesPerFeature?: number;
}): Promise<NbaBdlTeamFeatureSnapshot> {
  if (!Number.isInteger(args.season) || args.season < 1996 || args.season > 2100) {
    throw new Error("BALLDONTLIE NBA team feature season must be an integer from 1996 through 2100.");
  }
  const apiKey = args.apiKey ?? process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for NBA GOAT team features.");
  const fetchImpl = args.fetchImpl ?? fetch;
  const manifest = args.manifest ?? NBA_BDL_TEAM_FEATURE_MANIFEST;
  const maxPages = args.maxPagesPerFeature ?? DEFAULT_MAX_PAGES_PER_FEATURE;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) {
    throw new Error("NBA GOAT maxPagesPerFeature must be an integer from 1 through 10.");
  }

  const observations: NbaBdlTeamFeatureObservation[] = [];
  let providerRequests = 0;
  for (const selection of manifest) {
    const sourcePath = `/team_season_averages/${selection.category}`;
    let cursor: string | number | undefined;
    let completed = false;
    const seenTeams = new Set<number>();
    for (let page = 0; page < maxPages; page += 1) {
      const response = await fetchImpl(
        `${NBA_BDL_BASE_URL}${sourcePath}?${queryString({
          season: args.season,
          seasonType: args.seasonType,
          type: selection.type,
          cursor,
        })}`,
        { headers: { Authorization: apiKey, Accept: "application/json" } },
      );
      providerRequests += 1;
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `BALLDONTLIE NBA ${sourcePath} failed with HTTP ${response.status}: ${text.slice(0, 200)}`,
        );
      }
      let envelope: RawEnvelope;
      try {
        envelope = JSON.parse(text) as RawEnvelope;
      } catch {
        throw new Error(`BALLDONTLIE NBA ${sourcePath} returned invalid JSON.`);
      }
      if (!Array.isArray(envelope.data)) {
        throw new Error(`BALLDONTLIE NBA ${sourcePath} returned a malformed data envelope.`);
      }
      for (const raw of envelope.data as RawTeamFeatureRow[]) {
        const observation = normalizeRow({
          row: raw,
          expectedSeason: args.season,
          expectedSeasonType: args.seasonType,
          selection,
          sourcePath,
        });
        if (seenTeams.has(observation.providerTeamId)) {
          throw new Error(
            `BALLDONTLIE NBA ${selection.category}/${selection.type ?? "none"} returned duplicate team ${observation.providerTeamId}.`,
          );
        }
        seenTeams.add(observation.providerTeamId);
        observations.push(observation);
      }
      const nextCursor = envelope.meta?.next_cursor;
      if (nextCursor === null || nextCursor === undefined || envelope.data.length === 0) {
        completed = true;
        break;
      }
      if (typeof nextCursor !== "string" && typeof nextCursor !== "number") {
        throw new Error(`BALLDONTLIE NBA ${sourcePath} returned an invalid pagination cursor.`);
      }
      cursor = nextCursor;
    }
    if (!completed) {
      throw new Error(
        `BALLDONTLIE NBA ${selection.category}/${selection.type ?? "none"} exceeded ${maxPages} pages.`,
      );
    }
  }

  return {
    release: NBA_BDL_GOAT_TEAM_FEATURE_RELEASE,
    fetchedAt: new Date().toISOString(),
    season: args.season,
    seasonType: args.seasonType,
    selectionsRequested: manifest.length,
    providerRequests,
    observations,
  };
}

export const __NBA_BDL_GOAT_TEST__ = { normalizeStats, normalizeRow, queryString };
