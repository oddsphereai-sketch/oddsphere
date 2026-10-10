import type { PlaybookInjuryTeamRow } from "@/lib/providers/playbook/types";
import type { DailyEdgeGameAvailability, DailyEdgeTeamAvailability } from "@/lib/services/dailyEdge/gameAvailability";
import type { NcaafGame } from "./balldontlieNcaafSlate";
import type { CfbForwardStoredEvidence } from "./cfbForwardEvidence";
import { matchCfbPlaybookTeam } from "./cfbPlaybookEvidence";

/**
 * Select the newest verified exact-game report from the complete bounded
 * evidence history. The newest evidence row is allowed to have no report: a
 * failed or omitted provider refresh must not erase an older verified report.
 */
export function latestVerifiedCfbGameAvailabilityByGame(
  rows: readonly CfbForwardStoredEvidence[],
): Map<string, DailyEdgeGameAvailability> {
  const latest = new Map<string, { report: DailyEdgeGameAvailability; reportAt: number; capturedAt: number }>();
  for (const row of rows) {
    const report = row.payload.availability.report ?? null;
    if (!report || report.eventId !== row.providerGameId || report.teams.length !== 2) continue;
    const reportAt = timestamp(report.reportUpdatedAt) ?? timestamp(report.reportDate) ?? timestamp(row.capturedAt);
    const capturedAt = timestamp(row.capturedAt);
    if (reportAt === null || capturedAt === null) continue;
    const current = latest.get(row.providerGameId);
    if (!current || reportAt > current.reportAt || (reportAt === current.reportAt && capturedAt > current.capturedAt)) {
      latest.set(row.providerGameId, { report, reportAt, capturedAt });
    }
  }
  return new Map([...latest].map(([gameId, selected]) => [gameId, selected.report]));
}

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
  const timestamps = [
    away.updatedAt,
    away.reportDate,
    home.updatedAt,
    home.reportDate,
    ...teams.flatMap((team) => team.players.map((player) => player.reportedAt)),
  ].flatMap((value) => {
    const timestamp = validIso(value);
    return timestamp ? [timestamp] : [];
  });
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
  const matches = rows.filter((row) =>
    String(row.teamId ?? "") === String(team.id) ||
    matchCfbPlaybookTeam(row.teamAbbr, team) ||
    matchCfbPlaybookTeam(row.teamName, team));
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
function timestamp(value: string | null | undefined): number | null {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}
function validIso(value: string | null | undefined): string | null { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
