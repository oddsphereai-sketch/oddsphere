import { unstable_cache } from "next/cache";
import type { DailyEdgeResponse, SlateState } from "@/app/lab/lib/labTypes";
import { DAILY_EDGE_MEMBER_PRESENTATION_RELEASE_ID } from "@/app/lab/lib/dailyEdgeMarketPresentation";
import { finalizeDailyEdgeResponseCoherence } from "@/app/lab/lib/dailyEdgeResponseCoherence";
import type { Sport } from "@/lib/types/domain/Sport";
import { supabase } from "@/lib/db/supabase";
import {
  currentDailyEdgeBoardDate,
  currentSlateDate,
  currentSoccerBoardDate,
  previousReadyBoardDate,
} from "@/lib/dates/slateDate";
import {
  dailyEdgeSnapshotKey,
  readLabResponseSnapshot,
  readLatestLabResponseSnapshot,
} from "@/lib/services/labResponseSnapshots";
import type {
  PreviewHistoryByTeam,
  PreviewPitcherFirstInningByGame,
} from "./ActualDailyEdgePreview";
import { pitcherFirstInningPoint } from "@/app/lab/lib/dailyEdgeFirstInningHistory";

export async function loadDailyEdgeSnapshot(
  sport: Sport,
  date?: string,
  freshContractRead: boolean = false,
): Promise<DailyEdgeResponse> {
  const params = new URLSearchParams({ sport });
  if (date) params.set("date", date);
  if (freshContractRead) params.set("snapshotBypass", "true");
  // Normal preview traffic uses the same warm read path as the member board.
  // The founder hub can explicitly request a fresh, read-only contract
  // assembly for in-season slates so new additive DTO evidence can be reviewed
  // before the stored member snapshot is republished at cutover.
  // Keep the full contract assembler out of the member page's cold-start
  // module graph. It is intentionally loaded only by explicit preview/review
  // callers and the scheduled snapshot writer.
  const { GET: getDailyEdge } = await import("@/app/api/lab/daily-edge/route");
  const response = await getDailyEdge(
    new Request(`http://localhost/api/lab/daily-edge?${params.toString()}`),
  );
  if (!response.ok) throw new Error(`Daily Edge snapshot unavailable (${response.status})`);
  return (await response.json()) as DailyEdgeResponse;
}

function publishedDailyEdgeDate(sport: Sport, explicitDate?: string): string {
  if (explicitDate) return explicitDate;
  if (sport === "soccer" || sport === "ucl") return currentSoccerBoardDate();
  if (sport === "mlb" || sport === "nba" || sport === "nhl" || sport === "wnba") {
    return currentDailyEdgeBoardDate(sport);
  }
  return currentSlateDate(sport);
}

/**
 * Read the sole-writer member artifact directly instead of importing and
 * invoking the full Daily Edge assembler inside a page request. This keeps a
 * cold NHL server function from spending the page's eight-second availability
 * budget loading every model/provider dependency before it reaches the stored
 * 14-game response.
 */
export async function loadPublishedDailyEdgeSnapshot(
  sport: Sport,
  date?: string,
): Promise<DailyEdgeResponse> {
  const requestedDate = publishedDailyEdgeDate(sport, date);
  const snapshotKey = dailyEdgeSnapshotKey({
    sport,
    requestedDate,
    allowStale: false,
    copyPreview: false,
  });
  const fresh = await readLabResponseSnapshot<DailyEdgeResponse>(snapshotKey, "fresh");
  const stored = fresh ?? await readLabResponseSnapshot<DailyEdgeResponse>(snapshotKey, "stale");
  let selected = stored;

  if (!selected && !date && (sport === "mlb" || sport === "nba" || sport === "nhl" || sport === "wnba")) {
    const fallbackDate = previousReadyBoardDate({ sport, requestedDate });
    if (fallbackDate) {
      selected = await readLatestLabResponseSnapshot<DailyEdgeResponse>(dailyEdgeSnapshotKey({
        sport,
        requestedDate: fallbackDate,
        allowStale: false,
        copyPreview: false,
      }));
    }
  }

  if (!selected) {
    throw new Error(`Published Daily Edge snapshot unavailable (${sport} ${requestedDate})`);
  }
  const storedPresentationRelease = selected.payload.memberPresentation?.releaseId;
  if (storedPresentationRelease && storedPresentationRelease !== DAILY_EDGE_MEMBER_PRESENTATION_RELEASE_ID) {
    throw new Error(`Published Daily Edge snapshot contract is outdated (${sport} ${requestedDate})`);
  }
  // Older adapted-sport writers did not persist the derived presentation
  // envelope. Rebuild only that read-time envelope on an isolated payload;
  // the stored game, lock, projection, probability, pick, grade, and evidence
  // tuples remain untouched and authoritative.
  return finalizeDailyEdgeResponseCoherence(structuredClone(selected.payload));
}

export const loadCachedFreshContractSnapshot = unstable_cache(
  (sport: Sport, date: string) => loadDailyEdgeSnapshot(sport, date || undefined, true),
  // Version the private-review cache whenever the response contract gains
  // required evidence. Otherwise a previously cached DTO can keep rendering
  // missing trails even though the authoritative assembly now supplies them.
  ["daily-edge-experience-fresh-contract-v2"],
  { revalidate: 60, tags: ["daily-edge-experience-fresh-contract"] },
);

export function emptyPreviewSnapshot(
  sport: Sport,
  slateState: SlateState = "no_data",
): DailyEdgeResponse {
  const asOf = new Date().toISOString();
  return {
    as_of: asOf,
    sport,
    date: asOf.slice(0, 10),
    requested_date: asOf.slice(0, 10),
    fallback_used: false,
    slateState,
    slate_status: null,
    last_slate_update_at: null,
    games: [],
  };
}

type SoccerHistoryCompetition = "english_premier_league" | "uefa_champions_league" | "fifa_world_cup";

export function dailyEdgeTeamHistoryScope(sport: Sport, competition: SoccerHistoryCompetition | null) {
  return { storedSport: sport === "ucl" ? "soccer" as const : sport, competition };
}

export async function loadTeamHistory(
  snapshot: DailyEdgeResponse,
  sport: Sport,
  requestedCompetition?: SoccerHistoryCompetition,
): Promise<PreviewHistoryByTeam> {
  const abbreviations = Array.from(
    new Set(snapshot.games.flatMap((game) => [game.awayTeam, game.homeTeam])),
  ).sort();
  if (abbreviations.length === 0) return {};

  const snapshotCompetition = snapshot.games.find((game) => game.soccerCompetitionContext)?.soccerCompetitionContext?.competition;
  const competition = requestedCompetition ?? snapshotCompetition ?? (sport === "ucl" ? "uefa_champions_league" : undefined);
  return loadCachedTeamHistory(sport, snapshot.date, abbreviations, competition ?? null);
}

const loadCachedTeamHistory = unstable_cache(
  queryTeamHistory,
  ["daily-edge-experience-team-history-v4-competition-scoped"],
  { revalidate: 5 * 60, tags: ["daily-edge-experience-team-history"] },
);

async function queryTeamHistory(
  sport: Sport,
  slateDate: string,
  abbreviations: string[],
  competition: SoccerHistoryCompetition | null,
): Promise<PreviewHistoryByTeam> {
  const { storedSport } = dailyEdgeTeamHistoryScope(sport, competition);
  let teamsQuery = supabase
    .from("teams")
    .select("id, abbreviation")
    .eq("sport", storedSport)
    .in("abbreviation", abbreviations);
  if (competition) teamsQuery = teamsQuery.eq("league", competition);
  const { data: teams, error: teamError } = await teamsQuery;
  if (teamError || !teams) return {};

  const abbreviationById = new Map<number, string>();
  for (const team of teams) {
    if (typeof team.id === "number" && typeof team.abbreviation === "string") {
      abbreviationById.set(team.id, team.abbreviation);
    }
  }
  const teamIds = Array.from(abbreviationById.keys());
  if (teamIds.length === 0) return {};

  const idList = teamIds.join(",");
  const { data: rows, error: gamesError } = await supabase
    .from("games")
    .select("game_date, home_team_id, away_team_id, home_score, away_score, total_runs, first_inning_runs")
    .eq("sport", storedSport)
    // Recent form is pre-slate context. Excluding the current slate keeps a
    // completed game from entering its own L10 reader after the card locks.
    .lt("slate_date", slateDate)
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .or(`home_team_id.in.(${idList}),away_team_id.in.(${idList})`)
    .order("game_date", { ascending: false })
    .limit(600);
  if (gamesError || !rows) return {};

  const result: PreviewHistoryByTeam = {};
  for (const abbreviation of abbreviations) result[abbreviation] = [];

  for (const row of rows) {
    if (
      typeof row.home_team_id !== "number" ||
      typeof row.away_team_id !== "number" ||
      typeof row.home_score !== "number" ||
      typeof row.away_score !== "number"
    ) continue;

    const home = abbreviationById.get(row.home_team_id);
    const away = abbreviationById.get(row.away_team_id);
    const date = typeof row.game_date === "string" ? row.game_date : null;
    const firstInningRuns = typeof row.first_inning_runs === "number" ? row.first_inning_runs : null;
    if (home && result[home] && result[home].length < 10) {
      result[home].push({
        date,
        opponent: away ?? "—",
        runsFor: row.home_score,
        runsAgainst: row.away_score,
        totalRuns: typeof row.total_runs === "number" ? row.total_runs : row.home_score + row.away_score,
        firstInningRuns,
        won: row.home_score > row.away_score,
      });
    }
    if (away && result[away] && result[away].length < 10) {
      result[away].push({
        date,
        opponent: home ?? "—",
        runsFor: row.away_score,
        runsAgainst: row.home_score,
        totalRuns: typeof row.total_runs === "number" ? row.total_runs : row.home_score + row.away_score,
        firstInningRuns,
        won: row.away_score > row.home_score,
      });
    }
  }

  return result;
}

export async function loadPitcherFirstInningHistory(
  snapshot: DailyEdgeResponse,
  sport: Sport,
): Promise<PreviewPitcherFirstInningByGame> {
  if (sport !== "mlb" || snapshot.games.length === 0) return {};
  return loadCachedPitcherFirstInningHistory(
    snapshot.date,
    snapshot.games.map((game) => game.external_id).sort((a, b) => a - b),
  );
}

const loadCachedPitcherFirstInningHistory = unstable_cache(
  queryPitcherFirstInningHistory,
  ["daily-edge-experience-pitcher-first-inning-history-v3"],
  { revalidate: 5 * 60, tags: ["daily-edge-experience-pitcher-first-inning-history"] },
);

type CurrentMlbGameRow = {
  id: number;
  external_id: number;
  game_date: string;
  home_pitcher_id: number | null;
  away_pitcher_id: number | null;
};

type HistoricalMlbGameRow = {
  id: number;
  game_date: string;
  home_pitcher_id: number | null;
  away_pitcher_id: number | null;
  inning_scores: unknown;
};

async function queryPitcherFirstInningHistory(
  slateDate: string,
  externalIds: number[],
): Promise<PreviewPitcherFirstInningByGame> {
  if (externalIds.length === 0) return {};
  const { data: currentRows, error: currentError } = await supabase
    .from("games")
    .select("id, external_id, game_date, home_pitcher_id, away_pitcher_id")
    .eq("sport", "mlb")
    .in("external_id", externalIds);
  if (currentError || !currentRows) return {};

  const current = currentRows as CurrentMlbGameRow[];
  const pitcherIds = Array.from(new Set(current.flatMap((game) => [game.away_pitcher_id, game.home_pitcher_id]).filter((id): id is number => typeof id === "number")));
  if (pitcherIds.length === 0) return {};

  const pitcherList = pitcherIds.join(",");
  const [playersResult, historyResult] = await Promise.all([
    supabase.from("players").select("id, full_name").in("id", pitcherIds),
    supabase
      .from("games")
      .select("id, game_date, home_pitcher_id, away_pitcher_id, inning_scores")
      .eq("sport", "mlb")
      .lt("game_date", `${slateDate}T23:59:59Z`)
      .not("inning_scores", "is", null)
      .or(`home_pitcher_id.in.(${pitcherList}),away_pitcher_id.in.(${pitcherList})`)
      .order("game_date", { ascending: false })
      .limit(1000),
  ]);
  if (playersResult.error || historyResult.error || !historyResult.data) return {};

  const nameById = new Map<number, string>();
  for (const player of playersResult.data ?? []) {
    if (typeof player.id === "number" && typeof player.full_name === "string") nameById.set(player.id, player.full_name);
  }
  const history = historyResult.data as HistoricalMlbGameRow[];
  const result: PreviewPitcherFirstInningByGame = {};

  for (const game of current) {
    const pointsFor = (pitcherId: number | null) => {
      if (pitcherId === null) return [];
      return history
        .filter((row) => row.id !== game.id && row.game_date < game.game_date && (row.away_pitcher_id === pitcherId || row.home_pitcher_id === pitcherId))
        .map((row) => pitcherFirstInningPoint(row, pitcherId))
        .filter((point): point is { date: string; runsAllowed: number } => point !== null)
        .slice(0, 10);
    };
    result[`mlb-${game.external_id}`] = {
      away: game.away_pitcher_id === null ? null : { name: nameById.get(game.away_pitcher_id) ?? "Away starter", points: pointsFor(game.away_pitcher_id) },
      home: game.home_pitcher_id === null ? null : { name: nameById.get(game.home_pitcher_id) ?? "Home starter", points: pointsFor(game.home_pitcher_id) },
    };
  }
  return result;
}
