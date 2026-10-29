import type { CbbBox, CbbGame, CbbOdds, CbbPlayer, CbbPlayerGame, CbbPlayerSeason, CbbTeam } from "./types";

type Query = Record<string, string | number | readonly (string | number)[] | undefined>;
type Page<T> = { data: T[]; meta?: { next_cursor?: number | string | null } };

/** Bounded HTTP only: no database dependency or production writer. */
export class CbbBallDontLieClient {
  calls = 0;
  constructor(private readonly apiKey: string, private readonly options: {
    fetch?: typeof fetch; maxRequests?: number; delayMs?: number;
  } = {}) {
    if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required");
  }

  async all<T>(path: string, query: Query, identity: (row: T) => string): Promise<T[]> {
    const rows = new Map<string, T>();
    const cursors = new Set<string>();
    let cursor: string | number | undefined;
    for (let page = 0; page < 250; page++) {
      const url = new URL(`https://api.balldontlie.io/ncaab/v1/${path}`);
      for (const [key, value] of Object.entries({ ...query, per_page: 100, cursor })) {
        if (value === undefined) continue;
        if (Array.isArray(value)) for (const item of value) url.searchParams.append(`${key}[]`, String(item));
        else url.searchParams.set(key, String(value));
      }
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (++this.calls > (this.options.maxRequests ?? 1400)) throw new Error("CBB provider request budget exhausted");
        response = await (this.options.fetch ?? fetch)(url, {
          headers: { Authorization: this.apiKey }, signal: AbortSignal.timeout(20_000),
        });
        if (response.ok || (response.status < 500 && response.status !== 429)) break;
        if (attempt < 2) {
          const retry = Number(response.headers.get("retry-after"));
          await new Promise(resolve => setTimeout(resolve, Number.isFinite(retry) && retry > 0 ? Math.min(30_000, retry * 1000) : 500 * 2 ** attempt));
        }
      }
      // Do not include the response body: providers may echo credentials.
      if (!response?.ok) throw new Error(`CBB BALLDONTLIE ${path}: HTTP ${response?.status ?? "network"}`);
      const body = await response.json() as Page<T>;
      if (!Array.isArray(body.data)) throw new Error(`CBB ${path}: missing data array`);
      for (const row of body.data) {
        const id = identity(row);
        if (rows.has(id) && JSON.stringify(rows.get(id)) !== JSON.stringify(row)) {
          throw new Error(`CBB ${path}: conflicting duplicate ${id}`);
        }
        rows.set(id, row);
      }
      const next = body.meta?.next_cursor;
      if (next === undefined || next === null) return [...rows.values()];
      if (!body.data.length || cursors.has(String(next))) throw new Error(`CBB ${path}: pagination did not advance`);
      cursors.add(String(next));
      cursor = next;
      await new Promise(resolve => setTimeout(resolve, this.options.delayMs ?? 110));
    }
    throw new Error(`CBB ${path}: page budget exhausted; partial data rejected`);
  }

  teams() { return this.all<CbbTeam>("teams", {}, row => String(row.id)); }
  games(season: number) {
    return this.all<CbbGame>("games", { seasons: [season] }, row => String(row.id)).then(rows => {
      if (rows.some(row => row.season !== season)) throw new Error("CBB game season filter was not honored");
      return rows;
    });
  }
  /** Date-bounded slate capture; callers still verify the ET slate date. */
  gamesForDates(dates: readonly string[], season: number) {
    if (!Number.isInteger(season) || dates.length < 1 || dates.length > 7 ||
      dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date)) || new Set(dates).size !== dates.length) {
      throw new Error("CBB game capture requires 1–7 distinct YYYY-MM-DD dates and a season");
    }
    return this.all<CbbGame>("games", { dates, seasons: [season] }, row => String(row.id)).then(rows => {
      if (rows.some(row => row.season !== season)) throw new Error("CBB game date/season filter was not honored");
      return rows;
    });
  }
  boxes(season: number) {
    return this.all<CbbBox>("team_stats", { seasons: [season] }, row => `${row.game.id}:${row.team.id}`).then(rows => {
      if (rows.some(row => row.game.season !== season)) throw new Error("CBB box season filter was not honored");
      return rows;
    });
  }
  activePlayers() { return this.all<CbbPlayer>("players/active", {}, row => String(row.id)); }
  playerSeasons(season: number) {
    return this.all<CbbPlayerSeason>("player_season_stats", { season }, row => `${row.player.id}:${row.team.id}:${row.season}`).then(rows => {
      if (rows.some(row => row.season !== season)) throw new Error("CBB player season filter was not honored");
      return rows;
    });
  }
  playerGames(gameIds: readonly number[], season: number) {
    if (!gameIds.length || gameIds.length > 10 || gameIds.some(id => !Number.isInteger(id) || id <= 0)) {
      throw new Error("CBB player-game capture requires 1–10 exact games");
    }
    const ids = new Set(gameIds);
    return this.all<CbbPlayerGame>("player_stats", { game_ids: gameIds }, row => `${row.game.id}:${row.team.id}:${row.player.id}`).then(rows => {
      if (rows.some(row => !ids.has(row.game.id) || row.game.season !== season)) {
        throw new Error("CBB player-game filter was not honored");
      }
      return rows;
    });
  }
  odds(dates: readonly string[], phase: "opening" | "current") {
    return this.all<CbbOdds>(phase === "opening" ? "odds/opening" : "odds", { dates }, row => String(row.id));
  }
}
