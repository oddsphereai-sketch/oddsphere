import type { PlaybookInjuryTeamRow } from "@/lib/providers/playbook/types";
import type { DailyEdgeGameAvailability, DailyEdgeTeamAvailability } from "@/lib/services/dailyEdge/gameAvailability";
import type { NcaafGame } from "./balldontlieNcaafSlate";

export function buildCfbGameAvailability(args: {
  game: NcaafGame;
  capturedAt: string;
  playbookRows: PlaybookInjuryTeamRow[];
  conferenceReport?: DailyEdgeGameAvailability | null;
  previous?: DailyEdgeGameAvailability | null;
}): DailyEdgeGameAvailability | null {
  const fresh = buildPlaybookAvailability(args.game, args.playbookRows, args.capturedAt) ??
    validConferenceReport(args.game, args.conferenceReport ?? null);
  if (!fresh) return args.previous ?? null;
  if (!args.previous) return fresh;
  const freshAt = Date.parse(fresh.reportUpdatedAt ?? "");
  const previousAt = Date.parse(args.previous.reportUpdatedAt ?? "");
  return !Number.isFinite(previousAt) || (Number.isFinite(freshAt) && freshAt >= previousAt) ? fresh : args.previous;
}

function validConferenceReport(game: NcaafGame, report: DailyEdgeGameAvailability | null): DailyEdgeGameAvailability | null {
  if (!report || report.source !== "Conference" || report.eventId !== game.providerGameId) return null;
  if (report.teams.length !== 2 || report.teams.every((team) => team.players.length === 0)) return null;
  return report;
}

function buildPlaybookAvailability(game: NcaafGame, rows: PlaybookInjuryTeamRow[], capturedAt: string): DailyEdgeGameAvailability | null {
  const away = exactPlaybookTeam(game.away, rows);
  const home = exactPlaybookTeam(game.home, rows);
  if (!away || !home) return null;
  const teams = [toPlaybookTeam(game.away, away), toPlaybookTeam(game.home, home)];
  const timestamps = teams.flatMap((team) => team.players.map((player) => player.reportedAt)).filter((value): value is string => value !== null);
  return {
    eventId: game.providerGameId,
    awayTeam: game.away.abbreviation,
    homeTeam: game.home.abbreviation,
    source: "Playbook",
    sourceLabel: "Injury report",
    sourceUrl: null,
    reportDate: latestIso(timestamps) ?? new Date(capturedAt).toISOString(),
    reportUpdatedAt: latestIso(timestamps) ?? new Date(capturedAt).toISOString(),
    teams,
  };
}

function exactPlaybookTeam(team: NcaafGame["away"], rows: PlaybookInjuryTeamRow[]): PlaybookInjuryTeamRow | null {
  const matches = rows.filter((row) => String(row.teamId ?? "") === String(team.id) || normalize(row.teamAbbr ?? "") === normalize(team.abbreviation));
  return matches.length === 1 ? matches[0]! : null;
}

function toPlaybookTeam(team: NcaafGame["away"], row: PlaybookInjuryTeamRow): DailyEdgeTeamAvailability {
  const reportedAt = validIso(row.updatedAt) ?? validIso(row.reportDate);
  return {
    abbreviation: team.abbreviation,
    teamName: team.name,
    players: (row.players ?? []).flatMap((player) => {
      const name = player.name?.trim();
      const status = (player.status ?? player.statusContext)?.trim();
      return name && status ? [{ name, status, detail: player.reason?.trim() || null, position: null, reportedAt }] : [];
    }),
  };
}

function latestIso(values: string[]): string | null {
  return values.sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? null;
}
function validIso(value: string | null | undefined): string | null { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
