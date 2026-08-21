import {
  MLB_STATS_TEAM_IDS,
  normalizeMlbTeamName,
  type MlbTeamAbbrev,
} from "@/lib/providers/real_api/_teamNameNormalizer";
import { PlaybookClient } from "@/lib/providers/playbook/playbookClient";
import type { PlaybookInjuryTeamRow } from "@/lib/providers/playbook/types";
import type {
  DailyEdgeGameAvailability,
  DailyEdgeTeamAvailability,
} from "@/lib/services/dailyEdge/gameAvailability";

export type MlbAvailabilityMatchup = {
  id: string;
  awayTeam: string;
  homeTeam: string;
};

type NormalizedMlbAvailabilityReport = {
  reportDate: string | null;
  updatedAt: string | null;
  teams: DailyEdgeTeamAvailability[];
};

export type MlbDailyEdgeGameAvailability = Omit<DailyEdgeGameAvailability, "source"> & {
  source: DailyEdgeGameAvailability["source"] | "MLB Stats";
  providerHealth: "verified_current" | "verified_previous_day" | "official_fallback_current";
  fallbackReason: string | null;
  verifiedAt: string;
};

type MlbStatsRosterRow = {
  person?: { id?: unknown; fullName?: unknown };
  position?: { abbreviation?: unknown };
  status?: { code?: unknown; description?: unknown };
  note?: unknown;
};

/**
 * Read-only MLB injury context for the Daily Edge presentation. Playbook's
 * response is team-wide, so reports are attached only after both matchup
 * abbreviations resolve deterministically. Any missing key, provider error,
 * report older than the previous calendar day, or unmatched team fails closed.
 * A previous-day report is allowed only as explicitly labeled stale context;
 * it is never presented as today's verified report.
 */
export async function fetchPlaybookMlbSlateAvailability(
  slateDate: string,
  matchups: MlbAvailabilityMatchup[],
): Promise<MlbDailyEdgeGameAvailability[] | null> {
  const apiKey = process.env.PLAYBOOK_API_KEY;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) return null;

  if (apiKey) try {
    // Availability is supplementary context and must never hold the primary
    // reader open for the client's broader 20-second audit timeout.
    const response = await new PlaybookClient(apiKey, { timeoutMs: 2_500 }).injuries("mlb");
    const parsed = parsePlaybookMlbInjuries(response.body);
    if (
      parsed === null ||
      !isAcceptableReportDate(parsed.reportDate, slateDate) ||
      !hasPlausiblePlaybookReport(parsed)
    ) throw new Error("playbook_report_stale_or_implausible");
    const freshnessStatus = parsed.reportDate === slateDate ? "current" : "previous_day";

    const teamByAbbreviation = new Map(
      parsed.teams.map((team) => [team.abbreviation, team]),
    );
    const reports: MlbDailyEdgeGameAvailability[] = [];
    for (const matchup of matchups) {
      const away = teamByAbbreviation.get(matchup.awayTeam);
      const home = teamByAbbreviation.get(matchup.homeTeam);
      if (!away || !home) continue;
      reports.push({
        eventId: matchup.id,
        awayTeam: matchup.awayTeam,
        homeTeam: matchup.homeTeam,
        source: "Playbook",
        sourceLabel: "Playbook MLB injury report",
        sourceUrl: null,
        reportDate: parsed.reportDate,
        freshnessStatus,
        reportUpdatedAt: parsed.updatedAt,
        teams: [away, home],
        providerHealth: freshnessStatus === "current" ? "verified_current" : "verified_previous_day",
        fallbackReason: null,
        verifiedAt: new Date().toISOString(),
      });
    }
    if (reports.length === matchups.length) return reports;
  } catch {
    // Continue to the official roster fallback. A provider failure never makes
    // a stale or incomplete Playbook report eligible for display.
  }

  return fetchMlbStatsOfficialAvailability(slateDate, matchups);
}

function hasPlausiblePlaybookReport(report: NormalizedMlbAvailabilityReport): boolean {
  const players = report.teams.flatMap((team) => team.players);
  if (players.length === 0) return false;
  if (players.length < 20) return true;
  const statuses = new Set(players.map((player) => player.status.trim().toLowerCase()));
  return !(statuses.size === 1 && statuses.has("out"));
}

async function fetchMlbStatsOfficialAvailability(
  slateDate: string,
  matchups: MlbAvailabilityMatchup[],
): Promise<MlbDailyEdgeGameAvailability[] | null> {
  const abbreviations = [...new Set(matchups.flatMap((matchup) => [matchup.awayTeam, matchup.homeTeam]))]
    .filter((abbr): abbr is MlbTeamAbbrev => abbr in MLB_STATS_TEAM_IDS);
  if (abbreviations.length === 0) return null;
  const verifiedAt = new Date().toISOString();
  const teams = new Map<string, DailyEdgeTeamAvailability>();
  // Six requests at a time bounds pressure on MLB Stats while keeping a full
  // 15-game slate comfortably inside the supplementary reader timeout.
  for (let offset = 0; offset < abbreviations.length; offset += 6) {
    const batch = abbreviations.slice(offset, offset + 6);
    const rows = await Promise.all(batch.map(async (abbreviation) => {
      const teamId = MLB_STATS_TEAM_IDS[abbreviation];
      try {
        const response = await fetch(
          `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=40Man`,
          { signal: AbortSignal.timeout(2_500), headers: { Accept: "application/json" } },
        );
        if (!response.ok) return null;
        const body = await response.json() as { roster?: unknown };
        return parseMlbStatsFortyManRoster(abbreviation, body.roster);
      } catch {
        return null;
      }
    }));
    for (const row of rows) if (row !== null) teams.set(row.abbreviation, row);
  }
  const reports: MlbDailyEdgeGameAvailability[] = [];
  for (const matchup of matchups) {
    const away = teams.get(matchup.awayTeam);
    const home = teams.get(matchup.homeTeam);
    if (!away || !home) continue;
    reports.push({
      eventId: matchup.id,
      awayTeam: matchup.awayTeam,
      homeTeam: matchup.homeTeam,
      source: "MLB Stats",
      sourceLabel: "Official MLB 40-man injury status",
      sourceUrl: "https://www.mlb.com/injury-report",
      reportDate: slateDate,
      freshnessStatus: "current",
      reportUpdatedAt: verifiedAt,
      teams: [away, home],
      providerHealth: "official_fallback_current",
      fallbackReason: "playbook_report_unavailable_stale_or_implausible",
      verifiedAt,
    });
  }
  return reports.length > 0 ? reports : null;
}

function parseMlbStatsFortyManRoster(
  abbreviation: MlbTeamAbbrev,
  value: unknown,
): DailyEdgeTeamAvailability | null {
  if (!Array.isArray(value)) return null;
  const players = value
    .map((candidate) => {
      if (candidate === null || typeof candidate !== "object") return null;
      const row = candidate as MlbStatsRosterRow;
      const name = typeof row.person?.fullName === "string" ? row.person.fullName.trim() : "";
      const code = typeof row.status?.code === "string" ? row.status.code.toUpperCase() : "";
      const status = typeof row.status?.description === "string" ? row.status.description.trim() : "";
      const injured = /^D(?:7|10|15|60)$/.test(code) || /^injured\b/i.test(status);
      if (!name || !injured) return null;
      return {
        name,
        status: status || `Injured list (${code})`,
        detail: typeof row.note === "string" && row.note.trim() ? row.note.trim() : null,
        position: typeof row.position?.abbreviation === "string" ? row.position.abbreviation : null,
        reportedAt: null,
      };
    })
    .filter((player): player is NonNullable<typeof player> => player !== null);
  return { abbreviation, teamName: abbreviation, players };
}

function isAcceptableReportDate(reportDate: string | null, slateDate: string): boolean {
  if (reportDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) return false;
  if (reportDate === slateDate) return true;
  const [year, month, day] = slateDate.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  return reportDate === previous;
}

function parsePlaybookMlbInjuries(value: unknown): NormalizedMlbAvailabilityReport | null {
  if (value === null || typeof value !== "object") return null;
  const body = value as {
    reportDate?: unknown;
    updatedAt?: unknown;
    data?: unknown;
  };
  if (!Array.isArray(body.data)) return null;

  const teams = body.data
    .map(parseTeam)
    .filter((team): team is DailyEdgeTeamAvailability => team !== null);
  if (teams.length === 0) return null;
  return {
    reportDate: typeof body.reportDate === "string" ? body.reportDate : null,
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
    teams,
  };
}

function parseTeam(value: unknown): DailyEdgeTeamAvailability | null {
  if (value === null || typeof value !== "object") return null;
  const row = value as PlaybookInjuryTeamRow;
  const abbreviation = normalizeMlbTeamName(row.teamName ?? row.teamAbbr ?? "");
  if (!abbreviation || typeof row.teamName !== "string") return null;
  const players = (Array.isArray(row.players) ? row.players : [])
    .map((player) => {
      if (typeof player?.name !== "string") return null;
      const detail = [player.statusContext, player.reason]
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join(" · ");
      return {
        name: player.name,
        status: typeof player.status === "string" ? player.status : "Status unavailable",
        detail: detail || null,
        position: null,
        reportedAt: null,
      };
    })
    .filter((player): player is NonNullable<typeof player> => player !== null);
  return { abbreviation, teamName: row.teamName, players };
}

export const __MLB_AVAILABILITY_TEST__ = {
  parsePlaybookMlbInjuries,
  isAcceptableReportDate,
  hasPlausiblePlaybookReport,
  parseMlbStatsFortyManRoster,
};
