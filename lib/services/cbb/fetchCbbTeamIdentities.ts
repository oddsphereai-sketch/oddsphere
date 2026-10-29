import { completeCbbTeamIdentitiesFromEvents, resolveCbbTeamIdentities,
  type CbbTeamIdentity, type EspnCbbTeam } from "../../cbb/teamIdentity";
import type { EspnCbbEvent } from "../../cbb/dataset";
import type { CbbGame, CbbTeam } from "../../cbb/types";

const ESPN_CBB = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";

/** Public ESPN identity evidence; no abbreviation-only reconciliation. */
export async function fetchCbbTeamIdentities(args: {
  games: CbbGame[];
  slateDate: string;
  fetcher?: typeof fetch;
}): Promise<Map<number, CbbTeamIdentity>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.slateDate)) throw new Error("Invalid CBB ESPN slate date");
  if (!args.games.length) return new Map();
  const fetcher = args.fetcher ?? fetch;
  const scoreboardUrl = new URL(`${ESPN_CBB}/scoreboard`);
  scoreboardUrl.searchParams.set("dates", args.slateDate.replaceAll("-", ""));
  scoreboardUrl.searchParams.set("groups", "50");
  scoreboardUrl.searchParams.set("limit", "500");
  const [catalogResponse, scoreboardResponse] = await Promise.all([
    fetcher(`${ESPN_CBB}/teams?limit=500`, { signal: AbortSignal.timeout(20_000) }),
    fetcher(scoreboardUrl, { signal: AbortSignal.timeout(20_000) }),
  ]);
  if (!catalogResponse.ok || !scoreboardResponse.ok) {
    throw new Error(`CBB ESPN identity source unavailable: catalog=${catalogResponse.status} scoreboard=${scoreboardResponse.status}`);
  }
  const catalogBody = await catalogResponse.json();
  const scoreboardBody = await scoreboardResponse.json();
  const catalog = catalogBody?.sports?.[0]?.leagues?.[0]?.teams?.map((row: { team: EspnCbbTeam }) => row.team);
  const events: EspnCbbEvent[] = scoreboardBody?.events;
  if (!Array.isArray(catalog) || catalog.length < 300 || !Array.isArray(events) || events.length >= 500) {
    throw new Error("CBB ESPN identity source incomplete");
  }
  const teams = new Map<number, CbbTeam>();
  for (const game of args.games) for (const team of [game.home_team, game.visitor_team]) {
    const existing = teams.get(team.id);
    if (existing && existing.full_name !== team.full_name) throw new Error(`CBB BDL team ${team.id} changed name within slate`);
    teams.set(team.id, team);
  }
  const fetchedAt = new Date().toISOString();
  return completeCbbTeamIdentitiesFromEvents({ identities: resolveCbbTeamIdentities([...teams.values()], catalog),
    games: args.games, events, fetchedAt });
}
