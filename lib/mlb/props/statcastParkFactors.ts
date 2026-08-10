type CachedRequestInit = RequestInit & { next?: { revalidate?: number; tags?: string[] } };
type FetchLike = (input: string | URL | Request, init?: CachedRequestInit) => Promise<Response>;

export type StatcastParkFactor = {
  venueId: number;
  venue: string;
  teamId: number;
  team: string;
  season: number;
  yearRange: string;
  plateAppearances: number;
  runFactor: number | null;
  homeRunFactor: number | null;
  strikeoutFactor: number | null;
  overallFactor: number | null;
  source: "Baseball Savant Statcast";
};

export class StatcastParkFactorClient {
  private readonly cache = new Map<number, Promise<StatcastParkFactor[]>>();

  constructor(private readonly fetcher: FetchLike = globalThis.fetch) {}

  getParkFactors(season: number): Promise<StatcastParkFactor[]> {
    const existing = this.cache.get(season);
    if (existing) return existing;
    const pending = this.fetchParkFactors(season);
    this.cache.set(season, pending);
    return pending;
  }

  async getVenueFactor(venue: string, season: number): Promise<StatcastParkFactor | null> {
    const requested = normalizeVenue(venue);
    return (await this.getParkFactors(season)).find((row) => normalizeVenue(row.venue) === requested) ?? null;
  }

  private async fetchParkFactors(season: number): Promise<StatcastParkFactor[]> {
    const [multiYear, singleYear] = await Promise.all([
      this.fetchParkFactorsForRolling(season, 3),
      // A new venue cannot appear in the three-year table until it has a
      // multi-season sample. Merge only missing venues from the current-year
      // official table (for example Sutter Health Park) while preserving the
      // established three-year factors everywhere else.
      this.fetchParkFactorsForRolling(season, 1),
    ]);
    const knownTeams = new Set(multiYear.map((row) => row.teamId));
    const knownVenues = new Set(multiYear.map((row) => normalizeVenue(row.venue)));
    return [
      ...multiYear,
      ...singleYear.filter((row) => !knownTeams.has(row.teamId) && !knownVenues.has(normalizeVenue(row.venue))),
    ];
  }

  private async fetchParkFactorsForRolling(season: number, rolling: 1 | 3): Promise<StatcastParkFactor[]> {
    const url = new URL("https://baseballsavant.mlb.com/leaderboard/statcast-park-factors");
    url.searchParams.set("type", "year");
    url.searchParams.set("year", String(season));
    url.searchParams.set("condition", "All");
    url.searchParams.set("batSide", "");
    url.searchParams.set("stat", "index_wOBA");
    url.searchParams.set("rolling", String(rolling));
    const response = await this.fetcher(url, {
      headers: { Accept: "text/html" },
      next: { revalidate: 86_400, tags: [`mlb-statcast-park-factors-${season}-${rolling}`] },
    });
    if (!response.ok) throw new Error(`Baseball Savant park factors failed ${response.status}`);
    return parseStatcastParkFactorsHtml(await response.text(), season);
  }
}

export function parseStatcastParkFactorsHtml(html: string, season: number): StatcastParkFactor[] {
  const payload = extractAssignedJsonArray(html, "data");
  if (!payload) return [];
  const rows = JSON.parse(payload) as unknown;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((candidate) => {
    const row = asRecord(candidate);
    if (stringValue(row.grouping_venue_conditions) !== "All") return [];
    if (stringValue(row.key_bat_side) !== "All") return [];
    if (finiteNumber(row.key_year) !== season) return [];
    const venueId = finiteNumber(row.venue_id);
    const venue = stringValue(row.venue_name);
    const teamId = finiteNumber(row.main_team_id);
    const team = stringValue(row.name_display_club);
    const yearRange = stringValue(row.year_range);
    const plateAppearances = finiteNumber(row.n_pa);
    if (venueId === null || !venue || teamId === null || !team || !yearRange || plateAppearances === null) return [];
    return [{
      venueId,
      venue,
      teamId,
      team,
      season,
      yearRange,
      plateAppearances,
      runFactor: finiteNumber(row.index_runs),
      homeRunFactor: finiteNumber(row.index_hr),
      strikeoutFactor: finiteNumber(row.index_so),
      overallFactor: finiteNumber(row.index_woba),
      source: "Baseball Savant Statcast" as const,
    }];
  });
}

function extractAssignedJsonArray(html: string, variable: string): string | null {
  const marker = `var ${variable} = `;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf("[", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[") depth++;
    else if (character === "]") {
      depth--;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  return null;
}

function normalizeVenue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
