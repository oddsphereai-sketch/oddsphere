import type {
  GameSnapshot,
  ParkSnapshot,
  WeatherSnapshot,
} from "../automodel/types";
import type { PlaybookVenueWeatherRow } from "../providers/playbook/types";

const PLAYBOOK_MLB_TEAM_ID_BY_ODDSPHERE_ABBR: Record<string, string> = {
  LAA: "ANA",
  CWS: "CHA",
  CHC: "CHN",
  KC: "KCA",
  LAD: "LAN",
  NYY: "NYA",
  NYM: "NYN",
  SD: "SDN",
  SF: "SFN",
  STL: "SLN",
  TB: "TBA",
  WSH: "WAS",
};

export type MlbPlaybookVenueWeatherAudit = {
  enabled: boolean;
  applied: boolean;
  reason: string;
  team_id: string | null;
  stale: boolean | null;
  stale_reason: string | null;
  roof_status: string | null;
  roof_confidence: string | null;
  park_profile: string | null;
  temp_f: number | null;
  wind_mph: number | null;
  wind_type: string | null;
  weather_source: string | null;
  fetched_at: string | null;
  provider_status:
    | "fresh"
    | "missing"
    | "stale"
    | "rate_limited"
    | "unavailable"
    | "provider_error";
  fallback_source:
    | "weather_forecasts"
    | "legacy_weather_snapshot"
    | "unavailable"
    | null;
};

export type MlbPlaybookVenueWeatherOverlayResult = {
  snapshots: GameSnapshot[];
  auditByExternalId: Map<number, MlbPlaybookVenueWeatherAudit>;
};

function playbookTeamId(abbr: string | undefined): string | null {
  if (!abbr) return null;
  const upper = abbr.toUpperCase();
  return PLAYBOOK_MLB_TEAM_ID_BY_ODDSPHERE_ABBR[upper] ?? upper;
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function classifyProviderFailure(
  value: unknown,
): "rate_limited" | "unavailable" | "provider_error" {
  const message = value instanceof Error ? value.message : String(value ?? "");
  const normalized = message.toLowerCase();
  if (
    /(^|\D)429(\D|$)/.test(normalized) ||
    normalized.includes("rate limit") ||
    normalized.includes("requests limitation") ||
    normalized.includes("temporary blocked")
  ) {
    return "rate_limited";
  }
  if (
    normalized.includes("unavailable") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("fetch failed") ||
    normalized.includes("econn") ||
    normalized.includes("enotfound")
  ) {
    return "unavailable";
  }
  return "provider_error";
}

function fallbackSource(
  weather: WeatherSnapshot | null,
): MlbPlaybookVenueWeatherAudit["fallback_source"] {
  if (!weather) return "unavailable";
  return weather.standard_source ?? "legacy_weather_snapshot";
}

function buildWeatherOverlay(
  existing: WeatherSnapshot | null,
  row: PlaybookVenueWeatherRow,
): WeatherSnapshot | null {
  const tempF = cleanNumber(row.conditions?.tempF);
  const windMph = cleanNumber(row.conditions?.wind?.mph);
  const windType = cleanString(row.conditions?.wind?.type)?.toUpperCase() ?? null;

  if (tempF === null && windMph === null && windType === null) {
    return existing;
  }

  const notableReasons: string[] = [];
  if (windMph !== null && windMph >= 10 && windType !== null) {
    if (windType.includes("OUT")) notableReasons.push(`wind out ${windMph} mph`);
    else if (windType.includes("IN")) notableReasons.push(`wind in ${windMph} mph`);
  }
  if (tempF !== null && tempF >= 80) notableReasons.push(`high temp ${tempF}F`);
  else if (tempF !== null && tempF <= 55) notableReasons.push(`low temp ${tempF}F`);

  return {
    temperature_f: tempF ?? existing?.temperature_f ?? null,
    humidity_pct: existing?.humidity_pct ?? null,
    wind_speed_mph: windMph ?? existing?.wind_speed_mph ?? null,
    wind_direction_degrees: existing?.wind_direction_degrees ?? null,
    is_notable: notableReasons.length > 0 || existing?.is_notable === true,
    notable_reason:
      notableReasons.length > 0
        ? notableReasons.join("; ")
        : existing?.notable_reason ?? null,
    standard_source: existing?.standard_source,
    standard_fetched_at: existing?.standard_fetched_at ?? null,
  };
}

function buildClosedRoofWeather(
  existing: WeatherSnapshot | null,
  row: PlaybookVenueWeatherRow,
): WeatherSnapshot {
  return {
    temperature_f:
      cleanNumber(row.conditions?.tempF) ?? existing?.temperature_f ?? null,
    humidity_pct: existing?.humidity_pct ?? null,
    wind_speed_mph: 0,
    wind_direction_degrees: existing?.wind_direction_degrees ?? null,
    is_notable: false,
    notable_reason: null,
    standard_source: existing?.standard_source,
    standard_fetched_at: existing?.standard_fetched_at ?? null,
  };
}

function buildAudit(
  row: PlaybookVenueWeatherRow | undefined,
  teamId: string | null,
  applied: boolean,
  reason: string,
  fallback: MlbPlaybookVenueWeatherAudit["fallback_source"],
  providerStatus?: MlbPlaybookVenueWeatherAudit["provider_status"],
): MlbPlaybookVenueWeatherAudit {
  const staleReason = cleanString(row?.staleReason);
  return {
    enabled: true,
    applied,
    reason,
    team_id: teamId,
    stale: typeof row?.stale === "boolean" ? row.stale : null,
    stale_reason: staleReason,
    roof_status: cleanString(row?.venue?.roofStatus?.status),
    roof_confidence: cleanString(row?.venue?.roofStatus?.confidence),
    park_profile: cleanString(row?.venue?.parkProfile),
    temp_f: cleanNumber(row?.conditions?.tempF),
    wind_mph: cleanNumber(row?.conditions?.wind?.mph),
    wind_type: cleanString(row?.conditions?.wind?.type),
    weather_source: cleanString(row?.weatherSource),
    fetched_at: cleanString(row?.fetchedAt),
    provider_status:
      providerStatus ??
      (!row
        ? "missing"
        : row.stale === true
          ? staleReason
            ? classifyProviderFailure(staleReason)
            : "stale"
          : "fresh"),
    fallback_source: applied ? null : fallback,
  };
}

/**
 * Convert a call-level Playbook failure into bounded, per-game provenance.
 * The raw error is intentionally not persisted. Model inputs stay unchanged
 * and the already-loaded standard weather snapshot remains authoritative.
 */
export function buildMlbPlaybookVenueWeatherFailureAudits(
  snapshots: GameSnapshot[],
  error: unknown,
): Map<number, MlbPlaybookVenueWeatherAudit> {
  const providerStatus = classifyProviderFailure(error);
  return new Map(
    snapshots.map((snap) => {
      const teamId = playbookTeamId(snap.home_team.abbreviation);
      return [
        snap.game_external_id,
        buildAudit(
          undefined,
          teamId,
          false,
          "playbook_fetch_failed",
          fallbackSource(snap.weather),
          providerStatus,
        ),
      ];
    }),
  );
}

export function applyMlbPlaybookVenueWeatherOverlay(
  snapshots: GameSnapshot[],
  rows: PlaybookVenueWeatherRow[],
): MlbPlaybookVenueWeatherOverlayResult {
  const byTeamId = new Map<string, PlaybookVenueWeatherRow>();
  for (const row of rows) {
    const id = cleanString(row.teamId)?.toUpperCase();
    if (id) byTeamId.set(id, row);
  }

  const auditByExternalId = new Map<number, MlbPlaybookVenueWeatherAudit>();

  const overlaid = snapshots.map((snap) => {
    const teamId = playbookTeamId(snap.home_team.abbreviation);
    const row = teamId ? byTeamId.get(teamId) : undefined;

    if (!row) {
      auditByExternalId.set(
        snap.game_external_id,
        buildAudit(
          undefined,
          teamId,
          false,
          "missing_playbook_home_team_row",
          fallbackSource(snap.weather),
        ),
      );
      return snap;
    }
    if (row.stale === true) {
      auditByExternalId.set(
        snap.game_external_id,
        buildAudit(
          row,
          teamId,
          false,
          "playbook_row_stale",
          fallbackSource(snap.weather),
        ),
      );
      return snap;
    }

    const roofStatus = cleanString(row.venue?.roofStatus?.status)?.toUpperCase() ?? null;
    const park: ParkSnapshot | null = snap.ballpark
      ? { ...snap.ballpark }
      : { park_factor_runs: null, is_dome: false };

    if (roofStatus === "CLOSED") {
      const nextWeather = buildClosedRoofWeather(snap.weather, row);
      const nextSnap: GameSnapshot = {
        ...snap,
        ballpark: { ...park, is_dome: true },
        weather: nextWeather,
        data_quality: {
          ...snap.data_quality,
          weather_available: true,
        },
      };
      auditByExternalId.set(
        snap.game_external_id,
        buildAudit(row, teamId, true, "closed_roof_weather_neutralized", null),
      );
      return nextSnap;
    }

    const nextWeather = buildWeatherOverlay(snap.weather, row);
    const changedWeather = nextWeather !== snap.weather;
    const changedRoof =
      (roofStatus === "OPEN" || roofStatus === "OUTDOOR") && park.is_dome === true;

    if (!changedWeather && !changedRoof) {
      auditByExternalId.set(
        snap.game_external_id,
        buildAudit(
          row,
          teamId,
          false,
          "no_projection_weather_change",
          fallbackSource(snap.weather),
        ),
      );
      return snap;
    }

    const nextSnap: GameSnapshot = {
      ...snap,
      ballpark: changedRoof ? { ...park, is_dome: false } : snap.ballpark,
      weather: nextWeather,
      data_quality: {
        ...snap.data_quality,
        weather_available: nextWeather !== null,
      },
    };
    auditByExternalId.set(
      snap.game_external_id,
      buildAudit(row, teamId, true, "playbook_weather_overlay_applied", null),
    );
    return nextSnap;
  });

  return { snapshots: overlaid, auditByExternalId };
}
