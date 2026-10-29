import { computeSlateDate } from "../dates/slateDate";
import type { CbbGame, CbbTeam } from "./types";
import type { CbbTeamIdentity } from "./teamIdentity";

export type CbbCanonicalStatus =
  | "STATUS_SCHEDULED"
  | "STATUS_IN_PROGRESS"
  | "STATUS_FINAL"
  | "STATUS_POSTPONED"
  | "STATUS_CANCELED";

/** Never infer a playable scheduled game from an unknown provider state. */
export function cbbCanonicalStatus(game: Pick<CbbGame, "status" | "status_state">): CbbCanonicalStatus {
  const state = game.status_state?.toLowerCase();
  switch (state) {
    case "scheduled": return "STATUS_SCHEDULED";
    case "in_progress": return "STATUS_IN_PROGRESS";
    case "final": return "STATUS_FINAL";
    case "postponed":
    case "delayed":
    case "suspended": return "STATUS_POSTPONED";
    case "canceled":
    case "abandoned": return "STATUS_CANCELED";
    case "unknown": throw new Error("CBB provider lifecycle is unknown");
  }
  // Older BDL payloads may omit status_state. Only the documented compact
  // status values are accepted; novel text is a hold, not a scheduled slate.
  if (state !== undefined) throw new Error(`Unsupported CBB lifecycle ${state}`);
  if (game.status === "pre") return "STATUS_SCHEDULED";
  if (game.status === "live") return "STATUS_IN_PROGRESS";
  if (game.status === "post") return "STATUS_FINAL";
  throw new Error(`Unsupported CBB status ${game.status}`);
}

export function cbbCanonicalTeamPayload(team: CbbTeam, identity?: CbbTeamIdentity) {
  if (!Number.isInteger(team.id) || team.id <= 0 || !team.full_name?.trim() ||
    !team.abbreviation?.trim()) throw new Error("Incomplete CBB team identity");
  if (identity && (identity.bdlTeamId !== team.id || identity.bdlName !== team.full_name)) {
    throw new Error("CBB logo evidence crossed canonical team identity");
  }
  const verified = identity?.status.startsWith("verified_") && identity.espnTeamId && identity.logoUrl;
  return {
    external_id: team.id,
    sport: "cbb" as const,
    slug: `cbb-${team.id}`,
    abbreviation: team.abbreviation,
    display_name: team.full_name,
    short_display_name: team.college || team.full_name,
    name: team.name || team.full_name,
    location: team.college || "",
    ...(verified ? { logo_url: identity!.logoUrl } : {}),
    provider_ids: { balldontlie: { id: team.id },
      ...(verified ? { espn: { id: identity!.espnTeamId } } : {}) },
  };
}

export function cbbCanonicalGamePayload(game: CbbGame, homeDbId: number, awayDbId: number) {
  if (!Number.isInteger(game.id) || game.id <= 0 || !Number.isInteger(game.season) ||
    !Number.isInteger(homeDbId) || !Number.isInteger(awayDbId) || homeDbId === awayDbId ||
    game.home_team.id === game.visitor_team.id || !Number.isFinite(Date.parse(game.date))) {
    throw new Error("Incomplete CBB fixture identity");
  }
  const status = cbbCanonicalStatus(game);
  const final = status === "STATUS_FINAL";
  const hasScore = final || status === "STATUS_IN_PROGRESS";
  if (hasScore && (![game.home_score, game.away_score].every(Number.isInteger) ||
    game.home_score < 0 || game.away_score < 0)) {
    throw new Error("Scored CBB fixture lacks a valid score");
  }
  return {
    external_id: game.id,
    sport: "cbb" as const,
    home_team_id: homeDbId,
    away_team_id: awayDbId,
    game_date: game.date,
    slate_date: computeSlateDate("cbb", game.date),
    season: game.season,
    status,
    period: game.period,
    home_score: hasScore ? game.home_score : null,
    away_score: hasScore ? game.away_score : null,
  };
}

export type CbbExistingFixture = {
  id: number;
  status: string;
  game_date: string;
  home_team_id: number | null;
  away_team_id: number | null;
};

/** A provider refresh may not move or reassign a locked public fixture. */
export function assertCbbFixtureRefreshSafe(previous: CbbExistingFixture | undefined,
  payload: ReturnType<typeof cbbCanonicalGamePayload>, locked: boolean): void {
  if (!previous) return;
  if (previous.status === "STATUS_FINAL" && payload.status !== "STATUS_FINAL") {
    throw new Error(`CBB fixture ${payload.external_id} would regress from final`);
  }
  if (locked && (Date.parse(previous.game_date) !== Date.parse(payload.game_date) ||
    previous.home_team_id !== payload.home_team_id ||
    previous.away_team_id !== payload.away_team_id)) {
    throw new Error(`CBB fixture ${payload.external_id} would change locked identity or start`);
  }
}
