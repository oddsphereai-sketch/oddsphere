import { canonicalCbbTeamName, matchCbbVenue, type EspnCbbEvent } from "./dataset";
import type { CbbGame, CbbTeam } from "./types";

/** ESPN's public men's college basketball team catalog, not a betting or roster feed. */
export type EspnCbbTeam = {
  id: string;
  displayName: string;
  abbreviation?: string;
  logos?: Array<{ href?: string }>;
};

export type CbbTeamIdentity = {
  bdlTeamId: number;
  bdlName: string;
  bdlAbbreviation: string;
  espnTeamId: string | null;
  espnAbbreviation: string | null;
  logoUrl: string | null;
  status: "verified_exact_name" | "verified_exact_event" | "unverified" | "ambiguous";
};

function verifiedEspnLogo(href: string | undefined, id: string): string | null {
  if (!href || !/^\d+$/.test(id)) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || url.hostname !== "a.espncdn.com" ||
      !new RegExp(`^/i/teamlogos/ncaa/(?:[0-9]+/)?${id}\\.(?:png|svg)$`).test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Never use an abbreviation as an identity key: CBB abbreviations collide across schools. */
export function resolveCbbTeamIdentities(bdlTeams: CbbTeam[], espnTeams: EspnCbbTeam[]) {
  const byName = new Map<string, EspnCbbTeam[]>();
  for (const team of espnTeams) {
    if (!/^\d+$/.test(team.id) || !team.displayName) continue;
    const name = canonicalCbbTeamName(team.displayName);
    byName.set(name, [...(byName.get(name) ?? []), team]);
  }
  const out = new Map<number, CbbTeamIdentity>();
  for (const team of bdlTeams) {
    if (out.has(team.id)) throw new Error(`duplicate BDL CBB team ID ${team.id}`);
    const matches = byName.get(canonicalCbbTeamName(team.full_name)) ?? [];
    const match = matches.length === 1 ? matches[0] : null;
    const logo = match?.logos?.map(item => verifiedEspnLogo(item.href, match.id)).find(Boolean) ?? null;
    out.set(team.id, {
      bdlTeamId: team.id, bdlName: team.full_name, bdlAbbreviation: team.abbreviation,
      espnTeamId: match?.id ?? null, espnAbbreviation: match?.abbreviation ?? null,
      logoUrl: logo, status: matches.length > 1 ? "ambiguous" : match ? "verified_exact_name" : "unverified",
    });
  }
  return out;
}

/**
 * ESPN's catalog omits some schools that its exact-game scoreboard includes.
 * A unique, time-confirmed event matched by both full participants may fill
 * that catalog gap. An abbreviation, opponent-only match, or logo URL guess
 * never supplies identity.
 */
export function completeCbbTeamIdentitiesFromEvents(args: {
  identities: Map<number, CbbTeamIdentity>;
  games: CbbGame[];
  events: EspnCbbEvent[];
  fetchedAt: string;
}) {
  const out = new Map(args.identities);
  for (const game of args.games) {
    const venue = matchCbbVenue(game, args.events, args.fetchedAt);
    if (!venue?.timeConfirmed) continue;
    const matchedEvents = args.events.filter(row => row.id === venue.espnEventId);
    if (matchedEvents.length !== 1) continue;
    const event = matchedEvents[0];
    const competitors = event.competitions[0]?.competitors ?? [];
    if (competitors.length !== 2 || competitors.filter(row => row.homeAway === "home").length !== 1 ||
      competitors.filter(row => row.homeAway === "away").length !== 1) continue;
    for (const [side, team] of [["home", game.home_team], ["away", game.visitor_team]] as const) {
      const candidate = competitors.find(row => row.homeAway === side)?.team;
      const previous = out.get(team.id);
      if (!candidate || !previous || !/^\d+$/.test(candidate.id ?? "")) continue;
      const names = [team.full_name, team.college].filter(Boolean).map(value => canonicalCbbTeamName(value!));
      if (![candidate.displayName, candidate.location].some(value => value && names.includes(canonicalCbbTeamName(value)))) continue;
      if (previous.espnTeamId && previous.espnTeamId !== candidate.id) {
        throw new Error(`CBB ESPN catalog/event identity conflict for BDL team ${team.id}`);
      }
      const logo = verifiedEspnLogo(candidate.logo, candidate.id!);
      if (!logo) continue;
      out.set(team.id, { ...previous, espnTeamId: candidate.id!,
        espnAbbreviation: candidate.abbreviation ?? previous.espnAbbreviation,
        logoUrl: previous.logoUrl ?? logo,
        status: previous.status === "verified_exact_name" ? previous.status : "verified_exact_event" });
    }
  }
  return out;
}
