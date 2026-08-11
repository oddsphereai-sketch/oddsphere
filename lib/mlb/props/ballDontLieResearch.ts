import { BdlClient } from "@/lib/providers/real_api/_bdlClient";

export type BdlResearchPlayer = {
  playerId: number;
  fullName: string;
  bats: "L" | "R" | "S" | null;
  throws: "L" | "R" | null;
  position: string | null;
  teamAbbreviation: string | null;
};

export type BdlPitchTypeStat = {
  playerId: number;
  pitchType: string;
  pitchName: string;
  pitchCount: number;
  usagePercent: number;
  zonePercent: number | null;
  chasePercent: number | null;
  whiffPercent: number | null;
  contactPercent: number | null;
  plateAppearances: number | null;
  strikeouts: number | null;
  battingAverageAllowed: number | null;
  sluggingAllowed: number | null;
  wobaAllowed: number | null;
  xwobaAllowed: number | null;
  gamesBackfilled: number | null;
  seasonPitchCount: number | null;
  lastGameDate: string;
  season: number;
  source: "Ball Don't Lie";
};

export type BdlHitterPitchTypeStat = {
  playerId: number;
  pitchType: string;
  pitchName: string;
  pitchCount: number;
  plateAppearances: number | null;
  strikeouts: number | null;
  homeRuns: number | null;
  battingAverage: number | null;
  slugging: number | null;
  woba: number | null;
  xwoba: number | null;
  whiffPercent: number | null;
  contactPercent: number | null;
  gamesBackfilled: number | null;
  seasonPitchCount: number | null;
  lastGameDate: string;
  season: number;
  source: "Ball Don't Lie";
};

export function parseBdlResearchPlayer(payload: unknown): BdlResearchPlayer | null {
  if (!isObject(payload)) return null;
  const playerId = finiteNumber(payload.id);
  const fullName = stringValue(payload.full_name);
  if (playerId === null || fullName === null) return null;
  const [batsRaw, throwsRaw] = (stringValue(payload.bats_throws) ?? "").split("/");
  const team = isObject(payload.team) ? payload.team : null;
  return {
    playerId,
    fullName,
    bats: batsRaw === "L" || batsRaw === "R" || batsRaw === "S" ? batsRaw : null,
    throws: throwsRaw === "L" || throwsRaw === "R" ? throwsRaw : null,
    position: stringValue(payload.position),
    teamAbbreviation: stringValue(team?.abbreviation),
  };
}

export function parseBdlPitchTypeStats(
  payload: unknown,
  playerId: number,
  season: number
): BdlPitchTypeStat[] {
  if (!Array.isArray(payload)) return [];
  const rows: BdlPitchTypeStat[] = [];
  for (const candidate of payload) {
    if (!isObject(candidate) || finiteNumber(candidate.player_id) !== playerId) continue;
    const pitchType = stringValue(candidate.pitch_type);
    const pitchName = stringValue(candidate.pitch_name);
    const pitchCount = finiteNumber(candidate.pitch_count);
    const usagePercent = finiteNumber(candidate.pitch_usage_percent);
    const lastGameDate = stringValue(candidate.last_game_date);
    if (!pitchType || !pitchName || pitchCount === null || usagePercent === null || !lastGameDate) continue;
    rows.push({
      playerId,
      pitchType,
      pitchName,
      pitchCount,
      usagePercent,
      zonePercent: finiteNumber(candidate.zone_percent),
      chasePercent: finiteNumber(candidate.chase_percent),
      whiffPercent: finiteNumber(candidate.whiff_percent),
      contactPercent: finiteNumber(candidate.contact_percent),
      plateAppearances: finiteNumber(candidate.pa_count),
      strikeouts: finiteNumber(candidate.strikeout_count),
      battingAverageAllowed: finiteNumber(candidate.ba),
      sluggingAllowed: finiteNumber(candidate.slg),
      wobaAllowed: finiteNumber(candidate.woba),
      xwobaAllowed: finiteNumber(candidate.xwoba),
      gamesBackfilled: finiteNumber(candidate.games_backfilled),
      seasonPitchCount: finiteNumber(candidate.season_pitch_count),
      lastGameDate,
      season,
      source: "Ball Don't Lie",
    });
  }
  return rows.sort((a, b) => b.usagePercent - a.usagePercent);
}

export function parseBdlHitterPitchTypeStats(
  payload: unknown,
  playerId: number,
  season: number
): BdlHitterPitchTypeStat[] {
  if (!Array.isArray(payload)) return [];
  const rows: BdlHitterPitchTypeStat[] = [];
  for (const candidate of payload) {
    if (!isObject(candidate) || finiteNumber(candidate.player_id) !== playerId) continue;
    const pitchType = stringValue(candidate.pitch_type);
    const pitchName = stringValue(candidate.pitch_name);
    const pitchCount = finiteNumber(candidate.pitch_count);
    const lastGameDate = stringValue(candidate.last_game_date);
    if (!pitchType || !pitchName || pitchCount === null || !lastGameDate) continue;
    rows.push({
      playerId,
      pitchType,
      pitchName,
      pitchCount,
      plateAppearances: finiteNumber(candidate.pa_count),
      strikeouts: finiteNumber(candidate.strikeout_count),
      homeRuns: finiteNumber(candidate.home_run_count),
      battingAverage: finiteNumber(candidate.ba),
      slugging: finiteNumber(candidate.slg),
      woba: finiteNumber(candidate.woba),
      xwoba: finiteNumber(candidate.xwoba),
      whiffPercent: finiteNumber(candidate.whiff_percent),
      contactPercent: finiteNumber(candidate.contact_percent),
      gamesBackfilled: finiteNumber(candidate.games_backfilled),
      seasonPitchCount: finiteNumber(candidate.season_pitch_count),
      lastGameDate,
      season,
      source: "Ball Don't Lie",
    });
  }
  return rows.sort((a, b) => b.pitchCount - a.pitchCount);
}

export class BallDontLieResearchClient {
  private readonly client: BdlClient;

  constructor(apiKey: string) {
    this.client = new BdlClient(apiKey);
  }

  getClient(): BdlClient {
    return this.client;
  }

  async findPlayer(args: { firstName: string; lastName: string }): Promise<BdlResearchPlayer | null> {
    const rows = await this.client.fetch<Record<string, unknown>[]>({
      path: "/players",
      query: { first_name: args.firstName, last_name: args.lastName, per_page: 10 },
    });
    const exact = rows.data
      .map(parseBdlResearchPlayer)
      .filter((row): row is BdlResearchPlayer => row !== null)
      .filter((row) => row.fullName.toLowerCase() === `${args.firstName} ${args.lastName}`.toLowerCase());
    return exact.length === 1 ? exact[0] : null;
  }

  async findPlayerByFullName(fullName: string): Promise<BdlResearchPlayer | null> {
    const normalized = normalizeResearchPlayerName(fullName);
    if (!normalized) return null;
    const rows = await this.client.fetchAll<Record<string, unknown>>({
      path: "/players",
      query: { search: fullName.trim(), per_page: 100 },
      maxPages: 2,
    });
    const exact = rows
      .map(parseBdlResearchPlayer)
      .filter((row): row is BdlResearchPlayer => row !== null)
      .filter((row) => normalizeResearchPlayerName(row.fullName) === normalized);
    if (exact.length === 1) return exact[0];
    const parts = fullName.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const byFields = await this.findPlayer({
      firstName: parts[0],
      lastName: parts[parts.length - 1],
    });
    return byFields && normalizeResearchPlayerName(byFields.fullName) === normalized ? byFields : null;
  }

  async getPlayerById(playerId: number): Promise<BdlResearchPlayer | null> {
    const response = await this.client.fetch<Record<string, unknown> | Record<string, unknown>[]>({
      path: `/players/${playerId}`,
    });
    const payload = Array.isArray(response.data) ? response.data[0] : response.data;
    const player = parseBdlResearchPlayer(payload);
    return player?.playerId === playerId ? player : null;
  }

  async getPlayersByIds(playerIds: number[]): Promise<Map<number, BdlResearchPlayer>> {
    const out = new Map<number, BdlResearchPlayer>();
    for (const ids of chunks(uniquePositiveIntegers(playerIds), 75)) {
      const rows = await this.client.fetchAll<Record<string, unknown>>({
        path: "/players",
        query: { "player_ids[]": ids, per_page: 100 },
        maxPages: 2,
      });
      for (const row of rows) {
        const player = parseBdlResearchPlayer(row);
        if (player) out.set(player.playerId, player);
      }
    }
    return out;
  }

  async getPitcherPitchTypes(args: { playerId: number; season: number }): Promise<BdlPitchTypeStat[]> {
    const rows = await this.client.fetchAll<Record<string, unknown>>({
      path: "/pitcher_pitch_type_season_stats",
      query: {
        season: args.season,
        season_type: "regular",
        "player_ids[]": [args.playerId],
        per_page: 100,
      },
      maxPages: 2,
    });
    return parseBdlPitchTypeStats(rows, args.playerId, args.season);
  }

  async getHitterPitchTypes(args: { playerId: number; season: number }): Promise<BdlHitterPitchTypeStat[]> {
    const rows = await this.client.fetchAll<Record<string, unknown>>({
      path: "/hitter_pitch_type_season_stats",
      query: {
        season: args.season,
        season_type: "regular",
        "player_ids[]": [args.playerId],
        per_page: 100,
      },
      maxPages: 2,
    });
    return parseBdlHitterPitchTypeStats(rows, args.playerId, args.season);
  }

  async getPitcherPitchTypesForPlayers(args: {
    playerIds: number[];
    season: number;
  }): Promise<Map<number, BdlPitchTypeStat[]>> {
    const out = new Map<number, BdlPitchTypeStat[]>();
    for (const ids of chunks(uniquePositiveIntegers(args.playerIds), 40)) {
      const rows = await this.client.fetchAll<Record<string, unknown>>({
        path: "/pitcher_pitch_type_season_stats",
        query: {
          season: args.season,
          season_type: "regular",
          "player_ids[]": ids,
          per_page: 100,
        },
        maxPages: 10,
      });
      for (const id of ids) out.set(id, parseBdlPitchTypeStats(rows, id, args.season));
    }
    return out;
  }

  async getHitterPitchTypesForPlayers(args: {
    playerIds: number[];
    season: number;
  }): Promise<Map<number, BdlHitterPitchTypeStat[]>> {
    const out = new Map<number, BdlHitterPitchTypeStat[]>();
    for (const ids of chunks(uniquePositiveIntegers(args.playerIds), 40)) {
      const rows = await this.client.fetchAll<Record<string, unknown>>({
        path: "/hitter_pitch_type_season_stats",
        query: {
          season: args.season,
          season_type: "regular",
          "player_ids[]": ids,
          per_page: 100,
        },
        maxPages: 10,
      });
      for (const id of ids) out.set(id, parseBdlHitterPitchTypeStats(rows, id, args.season));
    }
    return out;
  }
}

function normalizeResearchPlayerName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function uniquePositiveIntegers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))];
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
