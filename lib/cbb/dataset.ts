import type { CbbBox, CbbFourFactors, CbbGame, CbbTrainingGame, CbbVenue } from "./types";

export function estimatedPossessions(box: CbbBox): number | null {
  const { fga, oreb, turnovers, fta } = box;
  if ([fga, oreb, turnovers, fta].some(value => value === null || !Number.isFinite(value) || value < 0)) return null;
  const value = fga! - oreb! + turnovers! + 0.475 * fta!;
  return value > 30 && value < 150 ? value : null;
}

function factors(box: CbbBox, opponent: CbbBox, possessions: number): CbbFourFactors | null {
  if ([box.fgm, box.fg3m, box.fga, box.turnovers, box.oreb, opponent.dreb, box.fta]
    .some(value => value === null || !Number.isFinite(value) || value < 0)) return null;
  if (!box.fga || !(box.oreb! + opponent.dreb!)) return null;
  return {
    efg: (box.fgm! + 0.5 * box.fg3m!) / box.fga,
    turnoverRate: box.turnovers! / possessions,
    offensiveReboundRate: box.oreb! / (box.oreb! + opponent.dreb!),
    freeThrowRate: box.fta! / box.fga,
  };
}

export function buildCbbTrainingGames(games: CbbGame[], boxes: CbbBox[], venues: CbbVenue[]) {
  const boxMap = new Map(boxes.map(box => [`${box.game.id}:${box.team.id}`, box]));
  const venueMap = new Map(venues.map(venue => [venue.gameId, venue]));
  const accepted: CbbTrainingGame[] = [];
  const rejected: Record<string, number> = {};
  const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
  for (const game of games) {
    if (game.status !== "post" || game.status_state !== "final") { reject("not_final"); continue; }
    if (!game.home_team.conference_id || !game.visitor_team.conference_id) { reject("non_di_or_unknown"); continue; }
    if (!Number.isFinite(Date.parse(game.date)) || game.home_team.id === game.visitor_team.id ||
      !Number.isInteger(game.home_score) || !Number.isInteger(game.away_score) ||
      game.home_score <= 0 || game.away_score <= 0 || game.home_score === game.away_score) {
      reject("invalid_final"); continue;
    }
    const home = boxMap.get(`${game.id}:${game.home_team.id}`);
    const away = boxMap.get(`${game.id}:${game.visitor_team.id}`);
    if (!home || !away) { reject("missing_box_pair"); continue; }
    const coherentBox = (box: CbbBox, score: number) => {
      const counts = [box.fgm, box.fga, box.fg3m, box.fg3a, box.ftm, box.fta, box.oreb, box.dreb, box.turnovers];
      return counts.every(value => value !== null && Number.isInteger(value) && value >= 0) &&
        box.fgm! <= box.fga! && box.fg3m! <= box.fgm! && box.fg3m! <= box.fg3a! &&
        box.fg3a! <= box.fga! && box.ftm! <= box.fta! && 2 * box.fgm! + box.fg3m! + box.ftm! === score;
    };
    if (!coherentBox(home, game.home_score) || !coherentBox(away, game.away_score)) { reject("box_score_identity_mismatch"); continue; }
    const hPoss = estimatedPossessions(home), aPoss = estimatedPossessions(away);
    if (hPoss === null || aPoss === null || Math.abs(hPoss - aPoss) > 12) { reject("invalid_possessions"); continue; }
    const possessions = (hPoss + aPoss) / 2;
    const homeFactors = factors(home, away, possessions), awayFactors = factors(away, home, possessions);
    if (!homeFactors || !awayFactors) { reject("missing_four_factors"); continue; }
    const homeRegulation = typeof game.home_score_h1 === "number" && typeof game.home_score_h2 === "number"
      ? game.home_score_h1 + game.home_score_h2 : null;
    const awayRegulation = typeof game.away_score_h1 === "number" && typeof game.away_score_h2 === "number"
      ? game.away_score_h1 + game.away_score_h2 : null;
    if (homeRegulation === null || awayRegulation === null || homeRegulation > game.home_score || awayRegulation > game.away_score) {
      reject("missing_regulation_score"); continue;
    }
    const overtime = homeRegulation !== game.home_score || awayRegulation !== game.away_score;
    // NCAA men play two regulation periods followed by five-minute OT periods.
    const otCount = overtime ? Math.max(game.home_ot_scores?.length ?? 0, game.away_ot_scores?.length ?? 0, game.period - 2) : 0;
    if (overtime && (otCount < 1 || homeRegulation !== awayRegulation)) { reject("invalid_overtime"); continue; }
    accepted.push({
      id: game.id, date: game.date, season: game.season,
      homeId: game.home_team.id, awayId: game.visitor_team.id,
      homeScore: game.home_score, awayScore: game.away_score, homeRegulation, awayRegulation,
      overtime, possessions, tempo: possessions * 40 / (40 + 5 * otCount),
      neutral: venueMap.get(game.id)?.neutral ?? null, homeFactors, awayFactors,
    });
  }
  accepted.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return { games: accepted, rejected };
}

export type EspnCbbEvent = {
  id: string; date: string;
  competitions: Array<{
    neutralSite?: boolean; timeValid?: boolean; venue?: { fullName?: string };
    competitors: Array<{ homeAway: string; team: { displayName: string; location?: string } }>;
  }>;
};

export function canonicalCbbTeamName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

/** Whole names and orientation, unique event, kickoff proximity. Abbreviations alone never match. */
export function matchCbbVenue(game: CbbGame, events: EspnCbbEvent[], fetchedAt: string): CbbVenue | null {
  const homeNames = [game.home_team.full_name, game.home_team.college].filter(Boolean).map(value => canonicalCbbTeamName(value!));
  const awayNames = [game.visitor_team.full_name, game.visitor_team.college].filter(Boolean).map(value => canonicalCbbTeamName(value!));
  const matches = events.filter(event => {
    const comp = event.competitions?.[0];
    const h = comp?.competitors.find(team => team.homeAway === "home")?.team;
    const a = comp?.competitors.find(team => team.homeAway === "away")?.team;
    return h && a && typeof comp.neutralSite === "boolean" &&
      Math.abs(Date.parse(game.date) - Date.parse(event.date)) <= 2 * 60 * 60 * 1000 &&
      [h.displayName, h.location].some(value => value && homeNames.includes(canonicalCbbTeamName(value))) &&
      [a.displayName, a.location].some(value => value && awayNames.includes(canonicalCbbTeamName(value)));
  });
  if (matches.length !== 1) return null;
  const event = matches[0], comp = event.competitions[0];
  return { gameId: game.id, espnEventId: event.id, neutral: comp.neutralSite!, venue: comp.venue?.fullName ?? null,
    source: "espn_scoreboard", fetchedAt, timeConfirmed: comp.timeValid === true };
}
