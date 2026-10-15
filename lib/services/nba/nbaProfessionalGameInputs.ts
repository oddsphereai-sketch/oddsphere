import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchNbaBdlHistoricalRows } from "./balldontlieNbaHistorical";
import {
  normalizeNbaHistoricalGame,
  normalizeNbaHistoricalPlayerBox,
  type NbaHistoricalGame,
  type NbaHistoricalPlayerBox,
} from "./nbaPointInTimeFeatures";

export const NBA_PROFESSIONAL_GAME_INPUT_COLLECTOR_RELEASE =
  "nba_professional_game_inputs_2026_10_15_r1_append_only_finals" as const;

type StoredInput = {
  collector_release: string;
  provider_game_id: number;
  season: number;
  game_started_at: string;
  game_json: unknown;
  home_box_json: unknown;
  away_box_json: unknown;
};

function aggregateBox(
  gameId: number,
  teamId: number,
  rows: readonly NbaHistoricalPlayerBox[],
): NbaHistoricalPlayerBox {
  const team = rows.filter((row) => row.gameId === gameId && row.teamId === teamId);
  if (team.length === 0) throw new Error(`NBA professional input game ${gameId} is missing team ${teamId}.`);
  const sum = (key: keyof NbaHistoricalPlayerBox) =>
    team.reduce((total, row) => total + Number(row[key]), 0);
  return {
    rowId: gameId * 100 + teamId,
    gameId,
    teamId,
    playerId: teamId,
    minutes: sum("minutes"),
    fgm: sum("fgm"),
    fga: sum("fga"),
    fg3m: sum("fg3m"),
    fg3a: sum("fg3a"),
    ftm: sum("ftm"),
    fta: sum("fta"),
    oreb: sum("oreb"),
    dreb: sum("dreb"),
    ast: sum("ast"),
    stl: sum("stl"),
    blk: sum("blk"),
    turnover: sum("turnover"),
    pf: sum("pf"),
    points: sum("points"),
    plusMinus: sum("plusMinus"),
  };
}

export function normalizeNbaProfessionalGameInput(args: {
  game: Record<string, unknown>;
  boxes: readonly Record<string, unknown>[];
  capturedAt: string;
}): {
  game: NbaHistoricalGame;
  homeBox: NbaHistoricalPlayerBox;
  awayBox: NbaHistoricalPlayerBox;
  insert: Record<string, unknown>;
} {
  const game = normalizeNbaHistoricalGame(args.game);
  const boxes = args.boxes.map(normalizeNbaHistoricalPlayerBox);
  const homeBox = aggregateBox(game.gameId, game.homeTeamId, boxes);
  const awayBox = aggregateBox(game.gameId, game.awayTeamId, boxes);
  return {
    game,
    homeBox,
    awayBox,
    insert: {
      collector_release: NBA_PROFESSIONAL_GAME_INPUT_COLLECTOR_RELEASE,
      provider: "balldontlie",
      provider_game_id: game.gameId,
      season: game.season,
      game_started_at: game.startTime,
      home_provider_team_id: game.homeTeamId,
      away_provider_team_id: game.awayTeamId,
      home_team_abbreviation: game.homeTeam,
      away_team_abbreviation: game.awayTeam,
      game_json: game,
      home_box_json: homeBox,
      away_box_json: awayBox,
      captured_at: args.capturedAt,
    },
  };
}

export async function collectNbaProfessionalGameInputs(args: {
  supabase: SupabaseClient;
  season: number;
  dates: readonly string[];
  apiKey?: string;
  fetchImpl?: typeof fetch;
  apply: boolean;
}): Promise<{
  release: typeof NBA_PROFESSIONAL_GAME_INPUT_COLLECTOR_RELEASE;
  providerRequests: number;
  finalGamesFound: number;
  alreadyStored: number;
  written: number;
}> {
  const gamesResult = await fetchNbaBdlHistoricalRows({
    dataset: "games",
    dates: args.dates,
    apiKey: args.apiKey,
    fetchImpl: args.fetchImpl,
  });
  const rawGames = gamesResult.rows.filter((row) =>
    (row.status_state === "final" || row.status === "Final") &&
    row.postseason !== true && row.ist_stage !== "Championship" &&
    Number(row.season) === args.season);
  const gameIds = rawGames.map((row) => Number(row.id)).filter(Number.isInteger);
  if (gameIds.length === 0) {
    return {
      release: NBA_PROFESSIONAL_GAME_INPUT_COLLECTOR_RELEASE,
      providerRequests: gamesResult.requests,
      finalGamesFound: 0,
      alreadyStored: 0,
      written: 0,
    };
  }
  const { data: existing, error: existingError } = await args.supabase
    .from("nba_professional_game_inputs")
    .select("provider_game_id")
    .eq("collector_release", NBA_PROFESSIONAL_GAME_INPUT_COLLECTOR_RELEASE)
    .in("provider_game_id", gameIds);
  if (existingError) throw new Error(`NBA professional input lookup failed: ${existingError.message}`);
  const existingIds = new Set((existing ?? []).map((row) => Number(row.provider_game_id)));
  const missingGames = rawGames.filter((row) => !existingIds.has(Number(row.id)));
  if (missingGames.length === 0) {
    return {
      release: NBA_PROFESSIONAL_GAME_INPUT_COLLECTOR_RELEASE,
      providerRequests: gamesResult.requests,
      finalGamesFound: rawGames.length,
      alreadyStored: existingIds.size,
      written: 0,
    };
  }
  const boxResult = await fetchNbaBdlHistoricalRows({
    dataset: "box",
    gameIds: missingGames.map((row) => Number(row.id)),
    apiKey: args.apiKey,
    fetchImpl: args.fetchImpl,
  });
  const capturedAt = new Date().toISOString();
  const normalized = missingGames.map((game) => normalizeNbaProfessionalGameInput({
    game,
    boxes: boxResult.rows.filter((row) => {
      const nested = row.game;
      return nested !== null && typeof nested === "object" && !Array.isArray(nested) &&
        Number((nested as Record<string, unknown>).id) === Number(game.id);
    }),
    capturedAt,
  }));
  if (!args.apply) {
    return {
      release: NBA_PROFESSIONAL_GAME_INPUT_COLLECTOR_RELEASE,
      providerRequests: gamesResult.requests + boxResult.requests,
      finalGamesFound: rawGames.length,
      alreadyStored: existingIds.size,
      written: 0,
    };
  }
  const { data: inserted, error: insertError } = await args.supabase
    .from("nba_professional_game_inputs")
    .insert(normalized.map((row) => row.insert))
    .select("provider_game_id");
  if (insertError) throw new Error(`NBA professional input insert failed: ${insertError.message}`);
  return {
    release: NBA_PROFESSIONAL_GAME_INPUT_COLLECTOR_RELEASE,
    providerRequests: gamesResult.requests + boxResult.requests,
    finalGamesFound: rawGames.length,
    alreadyStored: existingIds.size,
    written: (inserted ?? []).length,
  };
}

export async function loadNbaProfessionalCurrentState(args: {
  supabase: SupabaseClient;
  season: number;
}): Promise<{ games: NbaHistoricalGame[]; boxes: NbaHistoricalPlayerBox[] }> {
  const { data, error } = await args.supabase
    .from("nba_professional_game_inputs")
    .select("collector_release,provider_game_id,season,game_started_at,game_json,home_box_json,away_box_json")
    .eq("collector_release", NBA_PROFESSIONAL_GAME_INPUT_COLLECTOR_RELEASE)
    .eq("season", args.season)
    .order("game_started_at", { ascending: true });
  if (error) throw new Error(`NBA professional current-state load failed: ${error.message}`);
  const games: NbaHistoricalGame[] = [];
  const boxes: NbaHistoricalPlayerBox[] = [];
  const seen = new Set<number>();
  for (const row of (data ?? []) as StoredInput[]) {
    if (seen.has(row.provider_game_id)) throw new Error(`Duplicate NBA professional input ${row.provider_game_id}.`);
    const game = row.game_json as NbaHistoricalGame;
    const homeBox = row.home_box_json as NbaHistoricalPlayerBox;
    const awayBox = row.away_box_json as NbaHistoricalPlayerBox;
    if (
      game.gameId !== row.provider_game_id || game.season !== row.season ||
      homeBox.gameId !== game.gameId || awayBox.gameId !== game.gameId ||
      homeBox.teamId !== game.homeTeamId || awayBox.teamId !== game.awayTeamId
    ) {
      throw new Error(`NBA professional stored input ${row.provider_game_id} is incoherent.`);
    }
    seen.add(row.provider_game_id);
    games.push(game);
    boxes.push(homeBox, awayBox);
  }
  return { games, boxes };
}
