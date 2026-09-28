import type { NflPreviewGame } from "./balldontlieNflPreviewSlate";

export const NFL_PAID_PROJECTION_SHADOW_RELEASE =
  "nfl_paid_projection_shadow_2026_09_28_r2_direct_score" as const;
export const NFL_PAID_PROJECTION_MAX_PAGES = 10 as const;
export const NFL_PAID_PROJECTION_PAGE_SIZE = 100 as const;
export const NFL_PAID_PROJECTION_REFRESH_MINUTES = 360 as const;

const BASE_URL = "https://api.balldontlie.io/nfl/v1/fantasy/projections";

type ProjectionTeam = { id?: number; abbreviation?: string };
type ProjectionGame = {
  id?: number;
  date?: string;
  visitor_team?: ProjectionTeam;
  home_team?: ProjectionTeam;
};
type ProjectionRow = {
  id?: number;
  season?: number;
  week?: number | null;
  date?: string | null;
  collected_at?: string | null;
  position?: string | null;
  team?: ProjectionTeam | null;
  game?: ProjectionGame | null;
  stats?: Record<string, number | null> | null;
};
type ProjectionPage = {
  data?: ProjectionRow[];
  meta?: { next_cursor?: number | string | null };
};

export type NflPaidProjectionShadow = {
  release: typeof NFL_PAID_PROJECTION_SHADOW_RELEASE;
  source: "balldontlie_weekly_projections";
  fetchedAt: string;
  providerCollectedAt: string;
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  awayComponentScore: number;
  homeComponentScore: number;
  awayOpponentDstScore: number;
  homeOpponentDstScore: number;
  expectedAwayScore: number;
  expectedHomeScore: number;
  projectedHomeMargin: number;
  projectedTotal: number;
  rowCount: number;
  awayRowCount: number;
  homeRowCount: number;
  positions: string[];
};

export type NflPaidProjectionShadowFetch = {
  release: typeof NFL_PAID_PROJECTION_SHADOW_RELEASE;
  requests: number;
  rows: number;
  gamesRequested: number;
  gamesComplete: number;
  byGame: Record<string, NflPaidProjectionShadow>;
  incompleteGameIds: string[];
};

export function shouldRefreshNflPaidProjectionShadows(args: {
  byGame: Record<string, Pick<NflPaidProjectionShadow, "fetchedAt">>;
  requiredGameIds: Set<string>;
  now: string;
}): boolean {
  const now = Date.parse(args.now);
  if (!Number.isFinite(now)) throw new Error("Invalid NFL paid-projection refresh time.");
  const required = [...args.requiredGameIds];
  if (required.length === 0 || required.some((gameId) => !args.byGame[gameId])) return true;
  const oldest = Math.min(...required.map((gameId) => Date.parse(args.byGame[gameId]!.fetchedAt)));
  return !Number.isFinite(oldest) || now - oldest >= NFL_PAID_PROJECTION_REFRESH_MINUTES * 60_000;
}

export async function fetchBalldontlieNflWeeklyProjectionShadows(args: {
  apiKey: string;
  season: number;
  week: number;
  games: NflPreviewGame[];
  fetchedAt: string;
  fetchImpl?: typeof fetch;
}): Promise<NflPaidProjectionShadowFetch> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const fetchedAt = timestamp(args.fetchedAt, "fetchedAt");
  const rows: ProjectionRow[] = [];
  let requests = 0;
  let cursor: string | null = null;
  for (let page = 0; page < NFL_PAID_PROJECTION_MAX_PAGES; page += 1) {
    const url = new URL(BASE_URL);
    url.searchParams.set("season", String(args.season));
    url.searchParams.set("week", String(args.week));
    url.searchParams.set("per_page", String(NFL_PAID_PROJECTION_PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);
    requests += 1;
    const response = await fetchImpl(url, { headers: { Authorization: args.apiKey } });
    if (!response.ok) throw new Error(`BALLDONTLIE NFL weekly projections failed with HTTP ${response.status}.`);
    const body = (await response.json()) as ProjectionPage;
    if (!Array.isArray(body.data)) throw new Error("BALLDONTLIE NFL weekly projections returned malformed data.");
    rows.push(...body.data);
    const next = body.meta?.next_cursor;
    if (next === undefined || next === null || next === "") {
      return buildShadows({ ...args, fetchedAt, rows, requests });
    }
    cursor = String(next);
  }
  throw new Error(`BALLDONTLIE NFL weekly projections exceeded ${NFL_PAID_PROJECTION_MAX_PAGES} pages.`);
}

function buildShadows(args: {
  season: number;
  week: number;
  games: NflPreviewGame[];
  fetchedAt: string;
  rows: ProjectionRow[];
  requests: number;
}): NflPaidProjectionShadowFetch {
  const expectedIds = new Set(args.games.map((game) => game.providerGameId));
  const invalidIdentity = args.rows.find((row) => row.season !== args.season || row.week !== args.week);
  if (invalidIdentity) throw new Error("BALLDONTLIE NFL weekly projection identity mismatch.");
  const rowsByGame = new Map<string, ProjectionRow[]>();
  for (const row of args.rows) {
    const id = integer(row.game?.id);
    if (id === null) continue;
    const key = String(id);
    if (!expectedIds.has(key)) continue;
    const current = rowsByGame.get(key) ?? [];
    current.push(row);
    rowsByGame.set(key, current);
  }
  const byGame: Record<string, NflPaidProjectionShadow> = {};
  const incompleteGameIds: string[] = [];
  for (const game of args.games) {
    const gameRows = rowsByGame.get(game.providerGameId) ?? [];
    const shadow = buildGameShadow({ game, rows: gameRows, fetchedAt: args.fetchedAt });
    if (shadow) byGame[game.providerGameId] = shadow;
    else incompleteGameIds.push(game.providerGameId);
  }
  return {
    release: NFL_PAID_PROJECTION_SHADOW_RELEASE,
    requests: args.requests,
    rows: args.rows.length,
    gamesRequested: args.games.length,
    gamesComplete: Object.keys(byGame).length,
    byGame,
    incompleteGameIds,
  };
}

function buildGameShadow(args: {
  game: NflPreviewGame;
  rows: ProjectionRow[];
  fetchedAt: string;
}): NflPaidProjectionShadow | null {
  if (args.rows.length === 0) return null;
  const awayRows = args.rows.filter((row) => integer(row.team?.id) === args.game.away.id);
  const homeRows = args.rows.filter((row) => integer(row.team?.id) === args.game.home.id);
  if (awayRows.length === 0 || homeRows.length === 0) return null;
  const collected = args.rows.map((row) => timestampOrNull(row.collected_at)).filter((value): value is string => value !== null);
  if (collected.length !== args.rows.length) return null;
  const providerCollectedAt = collected.sort().at(-1)!;
  if (Date.parse(providerCollectedAt) >= Date.parse(args.game.scheduledStart)) return null;
  const awayComponentScore = componentScore(awayRows);
  const homeComponentScore = componentScore(homeRows);
  const awayOpponentDstScore = dstPointsAllowed(homeRows);
  const homeOpponentDstScore = dstPointsAllowed(awayRows);
  if ([awayComponentScore, homeComponentScore, awayOpponentDstScore, homeOpponentDstScore].some((value) => value === null)) {
    return null;
  }
  // points_allowed is the provider's direct projection for the opponent's team
  // score. Keep the component score as a health cross-check without averaging
  // a second representation of substantially the same underlying forecast.
  const expectedAwayScore = round(awayOpponentDstScore!);
  const expectedHomeScore = round(homeOpponentDstScore!);
  return {
    release: NFL_PAID_PROJECTION_SHADOW_RELEASE,
    source: "balldontlie_weekly_projections",
    fetchedAt: args.fetchedAt,
    providerCollectedAt,
    providerGameId: args.game.providerGameId,
    awayTeam: args.game.away.abbreviation,
    homeTeam: args.game.home.abbreviation,
    awayComponentScore: round(awayComponentScore!),
    homeComponentScore: round(homeComponentScore!),
    awayOpponentDstScore: round(awayOpponentDstScore!),
    homeOpponentDstScore: round(homeOpponentDstScore!),
    expectedAwayScore,
    expectedHomeScore,
    projectedHomeMargin: round(expectedHomeScore - expectedAwayScore),
    projectedTotal: round(expectedHomeScore + expectedAwayScore),
    rowCount: args.rows.length,
    awayRowCount: awayRows.length,
    homeRowCount: homeRows.length,
    positions: [...new Set(args.rows.map((row) => row.position).filter((value): value is string => Boolean(value)))].sort(),
  };
}

function componentScore(rows: ProjectionRow[]): number | null {
  const quarterbacks = rows.filter((row) => row.position === "QB");
  const kickers = rows.filter((row) => row.position === "K");
  const defenses = rows.filter((row) => row.position === "DST");
  if (quarterbacks.length === 0 || kickers.length === 0 || defenses.length !== 1) return null;
  const passingTouchdowns = sum(quarterbacks, "passing_touchdowns");
  const rushingTouchdowns = sum(rows, "rushing_touchdowns");
  const recoveryTouchdowns = sum(rows, "offensive_fumble_recovery_touchdowns");
  const returnTouchdowns = sum(defenses, "total_return_touchdowns");
  const safeties = sum(defenses, "defensive_safeties");
  const extraPoints = sum(kickers, "extra_points_made");
  const fieldGoals = sum(kickers, "field_goals_made");
  return 6 * (passingTouchdowns + rushingTouchdowns + recoveryTouchdowns + returnTouchdowns)
    + extraPoints + 3 * fieldGoals + 2 * safeties;
}

function dstPointsAllowed(rows: ProjectionRow[]): number | null {
  const defenses = rows.filter((row) => row.position === "DST");
  if (defenses.length !== 1) return null;
  const value = defenses[0]?.stats?.points_allowed;
  return finiteNonnegative(value);
}

function sum(rows: ProjectionRow[], key: string): number {
  return rows.reduce((total, row) => total + (finiteNonnegative(row.stats?.[key]) ?? 0), 0);
}

function finiteNonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function timestamp(value: string, label: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`Invalid ${label}.`);
  return new Date(time).toISOString();
}

function timestampOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export const __BALLDONTLIE_NFL_WEEKLY_PROJECTION_SHADOW_TEST__ = {
  buildShadows,
};
