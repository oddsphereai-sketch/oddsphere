import type { FootballLeague, FootballMarket, FootballSeasonPhase } from "./footballModelContract";
import {
  type FootballDataHealthValue,
  type FootballWeeklyGame,
  type FootballWeeklySlate,
  footballGameCompletesWeek,
} from "./footballWeeklySlate";

export const FOOTBALL_WEEKLY_READER_CONTRACT_RELEASE =
  "football_weekly_reader_contract_2026_08_19_r1" as const;

export type FootballWeeklyReaderDay = {
  dateKey: string;
  label: string;
  games: FootballWeeklyGame[];
};

export type FootballWeeklyReaderSummary = {
  scheduled: number;
  live: number;
  final: number;
  held: number;
  projectionReady: number;
  priceReady: number;
  publicConsensusReady: number;
};

export type FootballWeeklyReader = {
  readerRelease: typeof FOOTBALL_WEEKLY_READER_CONTRACT_RELEASE;
  league: FootballLeague;
  season: number;
  seasonPhase: FootballSeasonPhase;
  week: number;
  weekLabel: string;
  generatedAt: string;
  state: FootballWeeklySlate["state"];
  selectedGameId: string | null;
  summary: FootballWeeklyReaderSummary;
  days: FootballWeeklyReaderDay[];
  markets: readonly FootballMarket[];
  localOnly: true;
  actionable: false;
};

function etDateParts(timestamp: string): { dateKey: string; label: string } {
  const date = new Date(timestamp);
  const keyParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => keyParts.find((part) => part.type === type)?.value ?? "";
  return {
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    label: new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(date),
  };
}

export function groupFootballWeeklyGamesByDay(games: FootballWeeklyGame[]): FootballWeeklyReaderDay[] {
  const groups = new Map<string, FootballWeeklyReaderDay>();
  for (const game of [...games].sort((a, b) => Date.parse(a.identity.scheduledStart) - Date.parse(b.identity.scheduledStart))) {
    const parts = etDateParts(game.identity.scheduledStart);
    const group = groups.get(parts.dateKey) ?? { ...parts, games: [] };
    group.games.push(game);
    groups.set(parts.dateKey, group);
  }
  return [...groups.values()];
}

function hasHealth(game: FootballWeeklyGame, value: keyof Omit<FootballWeeklyGame["dataHealth"], "findings">, expected: FootballDataHealthValue): boolean {
  return game.dataHealth[value] === expected;
}

function gameHeld(game: FootballWeeklyGame): boolean {
  if (game.status === "final" || game.status === "canceled") return false;
  return game.forecast?.status === "hold" ||
    game.dataHealth.identity === "missing" ||
    game.dataHealth.schedule === "missing" ||
    game.dataHealth.independentProjection === "missing" ||
    game.dataHealth.independentProjection === "stale";
}

function phaseLabel(phase: FootballSeasonPhase): string {
  switch (phase) {
    case "preseason": return "Preseason";
    case "regular": return "Week";
    case "postseason": return "Postseason";
    case "bowl": return "Bowls";
  }
}

function defaultSelectedGame(games: FootballWeeklyGame[]): string | null {
  return games.find((game) => game.status === "in_progress")?.identity.providerGameId ??
    games.find((game) => !footballGameCompletesWeek(game))?.identity.providerGameId ??
    games.at(-1)?.identity.providerGameId ??
    null;
}

export function buildFootballWeeklyReader(slate: FootballWeeklySlate): FootballWeeklyReader {
  const games = slate.games;
  return {
    readerRelease: FOOTBALL_WEEKLY_READER_CONTRACT_RELEASE,
    league: slate.week.league,
    season: slate.week.season,
    seasonPhase: slate.week.seasonPhase,
    week: slate.week.week,
    weekLabel: `${slate.week.league === "nfl" ? "NFL" : "College Football"} ${phaseLabel(slate.week.seasonPhase)} ${slate.week.week}`,
    generatedAt: slate.generatedAt,
    state: slate.state,
    selectedGameId: defaultSelectedGame(games),
    summary: {
      scheduled: games.filter((game) => game.status === "scheduled" || game.status === "postponed").length,
      live: games.filter((game) => game.status === "in_progress").length,
      final: games.filter((game) => game.status === "final").length,
      held: games.filter(gameHeld).length,
      projectionReady: games.filter((game) => hasHealth(game, "independentProjection", "ready")).length,
      priceReady: games.filter((game) => hasHealth(game, "currentPrices", "ready")).length,
      publicConsensusReady: games.filter((game) => hasHealth(game, "publicConsensusSplits", "ready")).length,
    },
    days: groupFootballWeeklyGamesByDay(games),
    markets: ["moneyline", "spread", "total"],
    localOnly: true,
    actionable: false,
  };
}
