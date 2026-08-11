import {
  fetchEspnProbablePitchers,
} from "@/lib/services/espnProbablePitcherService";
import {
  getActiveRoster,
  type MlbRosterEntry,
} from "@/lib/providers/real_api/_mlbStatsApiClient";
import { normalizePlayerName } from "./entityResolution";
import { resolveMlbStatsTeamId } from "./mlbTeamAliases";
import type { MlbGameEntity, MlbProbablePitcher } from "./providers";

export type MlbPropsProbablePitcherResolution = {
  probablePitchers: MlbProbablePitcher[];
  findings: string[];
  fallbackAssignments: Array<{
    gameId: string;
    teamId: string;
    playerId: string;
    playerName: string;
    provider: "espn_scoreboard";
  }>;
};

type ResolutionDependencies = {
  fetchEspn?: typeof fetchEspnProbablePitchers;
  fetchAlternativeEspn?: typeof fetchEspnProbablePitchers;
  loadRoster?: typeof getActiveRoster;
  resolveBdlPlayerId?: (fullName: string, teamAbbreviation: string) => Promise<number | null>;
};

/**
 * Preserve MLB Stats as the authoritative starter source, but fill an empty
 * side from ESPN's published probable when it maps to exactly one active
 * pitcher on that MLB team. The next refresh automatically replaces the
 * fallback as soon as MLB Stats supplies a player id for the side.
 *
 * ESPN game identity is team-pair based, so it is intentionally skipped for
 * doubleheaders where it cannot safely identify game one versus game two.
 */
export async function resolveMlbPropsProbablePitchers(args: {
  games: MlbGameEntity[];
  mlbStatsProbablePitchers: MlbProbablePitcher[];
  slateDate: string;
  asOfTimestamp: string;
  fallbackEnabled?: boolean;
  dependencies?: ResolutionDependencies;
}): Promise<MlbPropsProbablePitcherResolution> {
  if (args.fallbackEnabled === false) {
    return { probablePitchers: args.mlbStatsProbablePitchers, fallbackAssignments: [], findings: ["PROBABLE_FALLBACK_DISABLED"] };
  }
  const missingSides = args.mlbStatsProbablePitchers.filter((row) => !row.playerId);
  if (missingSides.length === 0) {
    return { probablePitchers: args.mlbStatsProbablePitchers, fallbackAssignments: [], findings: [] };
  }

  const fetchEspn = args.dependencies?.fetchEspn ?? fetchEspnProbablePitchers;
  const loadRoster = args.dependencies?.loadRoster ?? getActiveRoster;
  let espnByGame = await fetchEspn(args.slateDate, { log: () => undefined });
  // ESPN's two official site API hosts serve the same scoreboard contract,
  // but the primary host can return an empty/failure response from some
  // serverless egress ranges. Retry only when the primary produced no slate;
  // never blend or override a valid primary response.
  if (espnByGame.size === 0 && (!args.dependencies?.fetchEspn || args.dependencies.fetchAlternativeEspn)) {
    const fetchAlternativeEspn = args.dependencies?.fetchAlternativeEspn
      ?? ((slateDate: string) => fetchEspnProbablePitchers(slateDate, {
        log: () => undefined,
        fetchImpl: (input, init) => {
          const url = String(input).replace("https://site.api.espn.com/", "https://site.web.api.espn.com/");
          return fetch(url, init);
        },
      }));
    espnByGame = await fetchAlternativeEspn(args.slateDate, { log: () => undefined });
  }
  if (espnByGame.size === 0) {
    return { probablePitchers: args.mlbStatsProbablePitchers, fallbackAssignments: [], findings: ["PROBABLE_FALLBACK_ESPN_SLATE_EMPTY"] };
  }

  const matchupCounts = new Map<string, number>();
  for (const game of args.games) {
    const key = gameKey(game);
    if (key) matchupCounts.set(key, (matchupCounts.get(key) ?? 0) + 1);
  }

  const rosterCache = new Map<number, Promise<MlbRosterEntry[] | null>>();
  const resolved = [...args.mlbStatsProbablePitchers];
  const assignments: MlbPropsProbablePitcherResolution["fallbackAssignments"] = [];
  const findings: string[] = [];

  for (const game of args.games) {
    const key = gameKey(game);
    if (!key || matchupCounts.get(key) !== 1) continue;
    const espn = espnByGame.get(key);
    if (!espn) {
      findings.push(`PROBABLE_FALLBACK_ESPN_GAME_MISSING_${key}`);
      continue;
    }

    for (const side of ["away", "home"] as const) {
      const teamId = side === "away" ? game.awayTeamId : game.homeTeamId;
      const currentIndex = resolved.findIndex((row) => row.gameId === game.id && row.teamId === teamId);
      const current = currentIndex >= 0 ? resolved[currentIndex] : null;
      if (current?.playerId) continue;
      const candidate = espn[side];
      if (!candidate) {
        findings.push(`PROBABLE_FALLBACK_ESPN_SIDE_MISSING_${key}_${side.toUpperCase()}`);
        continue;
      }

      const numericTeamId = Number(teamId.replace(/^mlbstats-team-/, ""));
      if (!Number.isInteger(numericTeamId)) continue;
      let rosterPromise = rosterCache.get(numericTeamId);
      if (!rosterPromise) {
        rosterPromise = loadRoster(numericTeamId, { quiet: true });
        rosterCache.set(numericTeamId, rosterPromise);
      }
      const roster = await rosterPromise;
      const matches = (roster ?? []).filter((row) =>
        normalizePlayerName(row.fullName) === normalizePlayerName(candidate.fullName)
        && (row.positionAbbreviation === "P" || row.positionType === "Pitcher")
      );
      if (matches.length !== 1) {
        findings.push(`PROBABLE_FALLBACK_ROSTER_MATCHES_${key}_${side.toUpperCase()}_${matches.length}`);
        continue;
      }

      const match = matches[0];
      const teamAbbreviation = resolveMlbStatsTeamId(teamId)?.abbreviation;
      const bdlPlayerId = teamAbbreviation && args.dependencies?.resolveBdlPlayerId
        ? await args.dependencies.resolveBdlPlayerId(match.fullName, teamAbbreviation)
        : null;
      const fallback: MlbProbablePitcher = {
        gameId: game.id,
        teamId,
        playerId: `mlbstats-player-${match.personId}`,
        status: "announced",
        asOfTimestamp: args.asOfTimestamp,
        provider: "espn_scoreboard",
        rawPayload: {
          probablePitcher: { id: match.personId, fullName: match.fullName },
          player_name: match.fullName,
          source: "espn_scoreboard",
          espn_event_id: espn.espnEventId,
          espn_athlete_id: candidate.espnAthleteId,
          bdl_player_id: bdlPlayerId,
        },
      };
      if (currentIndex >= 0) resolved[currentIndex] = fallback;
      else resolved.push(fallback);
      assignments.push({
        gameId: game.id,
        teamId,
        playerId: fallback.playerId!,
        playerName: match.fullName,
        provider: "espn_scoreboard",
      });
    }
  }

  return { probablePitchers: resolved, fallbackAssignments: assignments, findings };
}

function gameKey(game: MlbGameEntity): string | null {
  const away = resolveMlbStatsTeamId(game.awayTeamId)?.abbreviation;
  const home = resolveMlbStatsTeamId(game.homeTeamId)?.abbreviation;
  return away && home ? `${away}@${home}` : null;
}
