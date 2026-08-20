import { normalizeMlbTeamName } from "@/lib/providers/real_api/_teamNameNormalizer";
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
): Promise<DailyEdgeGameAvailability[] | null> {
  const apiKey = process.env.PLAYBOOK_API_KEY;
  if (!apiKey || !/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) return null;

  try {
    // Availability is supplementary context and must never hold the primary
    // reader open for the client's broader 20-second audit timeout.
    const response = await new PlaybookClient(apiKey, { timeoutMs: 2_500 }).injuries("mlb");
    const parsed = parsePlaybookMlbInjuries(response.body);
    if (parsed === null || !isAcceptableReportDate(parsed.reportDate, slateDate)) return null;
    const freshnessStatus = parsed.reportDate === slateDate ? "current" : "previous_day";

    const teamByAbbreviation = new Map(
      parsed.teams.map((team) => [team.abbreviation, team]),
    );
    const reports: DailyEdgeGameAvailability[] = [];
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
      });
    }
    return reports;
  } catch {
    return null;
  }
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

export const __MLB_AVAILABILITY_TEST__ = { parsePlaybookMlbInjuries, isAcceptableReportDate };
