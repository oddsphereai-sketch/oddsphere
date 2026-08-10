import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import { GET as getDailyEdge } from "@/app/api/lab/daily-edge/route";
import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";
import { supabase } from "@/lib/db/supabase";
import { isDailyEdgeExperiencePreviewAvailable } from "@/lib/config/dailyEdgeExperience";
import {
  AVAILABLE_DAILY_EDGE_SPORTS,
  DAILY_EDGE_SPORT_KEYS,
} from "@/app/lab/lib/dailyEdgeSports";
import ActualDailyEdgePreview, {
  type PreviewHistoryByTeam,
  type PreviewPitcherFirstInningByGame,
} from "./ActualDailyEdgePreview";
import { pitcherFirstInningPoint } from "@/app/lab/lib/dailyEdgeFirstInningHistory";

export const metadata = {
  title: "OddSphere Experience Preview",
  robots: { index: false, follow: false },
};

type PreviewSearchParams = Promise<{
  sport?: string | string[];
  date?: string | string[];
  fresh?: string | string[];
}>;

export default async function PrivateExperiencePreviewPage({
  searchParams,
}: {
  searchParams: PreviewSearchParams;
}) {
  if (!isDailyEdgeExperiencePreviewAvailable()) notFound();

  const query = await searchParams;
  const requestedSport = query.sport;
  const sport = DAILY_EDGE_SPORT_KEYS.includes(requestedSport as Sport)
    ? (requestedSport as Sport)
    : "mlb";
  const requestedDate =
    typeof query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date)
      ? query.date
      : undefined;
  const freshContractRead = query.fresh === "1";

  const snapshot = AVAILABLE_DAILY_EDGE_SPORTS.includes(sport)
    ? freshContractRead
      ? await loadCachedFreshContractSnapshot(sport, requestedDate ?? "")
      : await loadDailyEdgeSnapshot(sport, requestedDate)
    : emptyPreviewSnapshot(sport);
  const [history, pitcherFirstInningHistory] = await Promise.all([
    loadTeamHistory(snapshot, sport),
    loadPitcherFirstInningHistory(snapshot, sport),
  ]);

  return (
    <ProductAppFrame>
      <ActualDailyEdgePreview
        key={`${sport}-${snapshot.date}`}
        snapshot={snapshot}
        history={history}
        pitcherFirstInningHistory={pitcherFirstInningHistory}
        sport={sport}
        freshContractRead={freshContractRead}
        reviewMode
      />
    </ProductAppFrame>
  );
}

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
  const response = await getDailyEdge(
    new Request(`http://localhost/api/lab/daily-edge?${params.toString()}`),
  );
  if (!response.ok) throw new Error(`Daily Edge snapshot unavailable (${response.status})`);
  return (await response.json()) as DailyEdgeResponse;
}

const loadCachedFreshContractSnapshot = unstable_cache(
  (sport: Sport, date: string) => loadDailyEdgeSnapshot(sport, date || undefined, true),
  // Version the private-review cache whenever the response contract gains
  // required evidence. Otherwise a previously cached DTO can keep rendering
  // missing trails even though the authoritative assembly now supplies them.
  ["daily-edge-experience-fresh-contract-v2"],
  { revalidate: 60, tags: ["daily-edge-experience-fresh-contract"] },
);

export function emptyPreviewSnapshot(sport: Sport): DailyEdgeResponse {
  const asOf = new Date().toISOString();
  return {
    as_of: asOf,
    sport,
    date: asOf.slice(0, 10),
    requested_date: asOf.slice(0, 10),
    fallback_used: false,
    slateState: "no_data",
    slate_status: null,
    last_slate_update_at: null,
    games: [],
  };
}

export async function loadTeamHistory(snapshot: DailyEdgeResponse, sport: Sport): Promise<PreviewHistoryByTeam> {
  const abbreviations = Array.from(
    new Set(snapshot.games.flatMap((game) => [game.awayTeam, game.homeTeam])),
  ).sort();
  if (abbreviations.length === 0) return {};

  return loadCachedTeamHistory(sport, snapshot.date, abbreviations);
}

const loadCachedTeamHistory = unstable_cache(
  queryTeamHistory,
  ["daily-edge-experience-team-history-v2"],
  { revalidate: 5 * 60, tags: ["daily-edge-experience-team-history"] },
);

async function queryTeamHistory(
  sport: Sport,
  slateDate: string,
  abbreviations: string[],
): Promise<PreviewHistoryByTeam> {

  const { data: teams, error: teamError } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .eq("sport", sport)
    .in("abbreviation", abbreviations);
  if (teamError || !teams) return {};

  const abbreviationById = new Map<number, string>();
  for (const team of teams) {
    if (typeof team.id === "number" && typeof team.abbreviation === "string") {
      abbreviationById.set(team.id, team.abbreviation);
    }
  }
  const teamIds = Array.from(abbreviationById.keys());
  if (teamIds.length === 0) return {};

  const dateCeiling = `${slateDate}T23:59:59Z`;
  const idList = teamIds.join(",");
  const { data: rows, error: gamesError } = await supabase
    .from("games")
    .select("game_date, home_team_id, away_team_id, home_score, away_score, total_runs, first_inning_runs")
    .eq("sport", sport)
    .lt("game_date", dateCeiling)
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
