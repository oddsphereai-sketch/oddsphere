import type { DailyEdgeGameAvailability, DailyEdgeAvailabilityPlayer } from "@/lib/services/dailyEdge/gameAvailability";
import type { NcaafGame } from "./balldontlieNcaafSlate";

export const CFB_OFFICIAL_CONFERENCE_AVAILABILITY_RELEASE =
  "cfb_official_conference_availability_2026_10_07_r1_public_report_exact_event" as const;
export const CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_REQUESTS = 4 as const;
export const CFB_OFFICIAL_CONFERENCE_AVAILABILITY_TIMEOUT_MS = 10_000 as const;
export const CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_RESPONSE_BYTES = 20_000_000 as const;
export const CFB_OFFICIAL_CONFERENCE_AVAILABILITY_REFRESH_MINUTES = 360 as const;
export const CFB_OFFICIAL_CONFERENCE_AVAILABILITY_PREGAME_REFRESH_MINUTES = 60 as const;

const HDI_PUBLIC_ENDPOINT = "https://app.hdintelligence.com/api/get-publish-public";
const CONFERENCES = [
  { organization: "SEC", sourceUrl: "https://www.secsports.com/fbreports" },
  { organization: "ACC", sourceUrl: "https://theacc.com/sports/2025/8/28/availability-reporting-football.aspx" },
  { organization: "B10", sourceUrl: "https://bigten.org/sports/2026/9/10/FB_Availability_Reports.aspx" },
  { organization: "B12", sourceUrl: "https://big12sports.com/sports/2025/8/14/FBreporting.aspx" },
] as const;

type OfficialReportRow = { name?: unknown; status?: unknown };
type OfficialTeam = { rows?: unknown; teamDisplayName?: unknown; teamName?: unknown };
type OfficialReport = {
  ReportType?: unknown;
  conferenceTimeZone?: unknown;
  games?: unknown;
  postedTime?: unknown;
  publishDate?: unknown;
  footer?: unknown;
};

export type CfbOfficialConferenceAvailabilityResult = {
  release: typeof CFB_OFFICIAL_CONFERENCE_AVAILABILITY_RELEASE;
  requests: number;
  failures: string[];
  reportsByGame: Record<string, DailyEdgeGameAvailability>;
};

export async function fetchCfbOfficialConferenceAvailability(args: {
  games: NcaafGame[];
  capturedAt: string;
  fetchImpl?: typeof fetch;
}): Promise<CfbOfficialConferenceAvailabilityResult> {
  const games = [...new Map(args.games.map((game) => [game.providerGameId, game])).values()];
  if (games.length === 0) return emptyResult();
  const fetchImpl = args.fetchImpl ?? fetch;
  const failures: string[] = [];
  const parsed = await Promise.all(CONFERENCES.map(async (conference) => {
    try {
      const response = await fetchImpl(HDI_PUBLIC_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "OddSphere/1.0 (+https://www.oddsphereai.com/)",
        },
        body: JSON.stringify({ sport: "Football", organization: conference.organization, conference: conference.organization }),
        cache: "no-store",
        signal: AbortSignal.timeout(CFB_OFFICIAL_CONFERENCE_AVAILABILITY_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_RESPONSE_BYTES) {
        throw new Error("response_too_large");
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_RESPONSE_BYTES) throw new Error("response_too_large");
      const json = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      return parseCfbOfficialConferenceAvailability({
        json,
        games,
        capturedAt: args.capturedAt,
        sourceUrl: conference.sourceUrl,
      });
    } catch (error) {
      failures.push(`${conference.organization}:${error instanceof Error ? error.message : "request_failed"}`);
      return {};
    }
  }));
  return {
    release: CFB_OFFICIAL_CONFERENCE_AVAILABILITY_RELEASE,
    requests: CONFERENCES.length,
    failures,
    reportsByGame: Object.assign({}, ...parsed),
  };
}

export function parseCfbOfficialConferenceAvailability(args: {
  json: unknown;
  games: NcaafGame[];
  capturedAt: string;
  sourceUrl: string;
}): Record<string, DailyEdgeGameAvailability> {
  const root = record(args.json);
  if (!root) throw new Error("invalid_official_report_envelope");
  const reportsByGame: Record<string, DailyEdgeGameAvailability> = {};
  for (const reportValue of Object.values(root)) {
    const report = record(reportValue) as OfficialReport | null;
    const reportType = text(report?.ReportType);
    if (!report || !reportType || normalize(reportType) === "reportpending") continue;
    const teams = Array.isArray(report.games) ? report.games.map(record).filter((value): value is OfficialTeam => value !== null) : [];
    const eventDate = text(record(report.footer)?.date);
    if (teams.length !== 2 || !validDate(eventDate)) continue;
    const matchingGames = args.games.filter((game) => strictEventMatch(game, teams, eventDate!));
    if (matchingGames.length !== 1) continue;
    const game = matchingGames[0]!;
    const reportUpdatedAt = officialTimestamp({
      date: text(report.publishDate),
      time: text(report.postedTime),
      timeZone: text(report.conferenceTimeZone),
    }) ?? new Date(args.capturedAt).toISOString();
    const mappedTeams = teams.map((team, index) => ({
      abbreviation: index === 0 ? game.away.abbreviation : game.home.abbreviation,
      teamName: index === 0 ? game.away.name : game.home.name,
      players: officialPlayers(team.rows, reportUpdatedAt),
    }));
    if (mappedTeams.every((team) => team.players.length === 0)) continue;
    reportsByGame[game.providerGameId] = {
      eventId: game.providerGameId,
      awayTeam: game.away.abbreviation,
      homeTeam: game.home.abbreviation,
      source: "Conference",
      sourceLabel: "Injury report",
      sourceUrl: args.sourceUrl,
      reportDate: eventDate,
      reportUpdatedAt,
      teams: mappedTeams,
    };
  }
  return reportsByGame;
}

function officialPlayers(value: unknown, reportedAt: string): DailyEdgeAvailabilityPlayer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): DailyEdgeAvailabilityPlayer[] => {
    const row = record(candidate) as OfficialReportRow | null;
    const status = text(row?.status)?.trim() ?? null;
    const rawName = text(row?.name)?.trim() ?? null;
    if (!status || !rawName || /^(available|exempt)$/i.test(status)) return [];
    const parsed = /^([A-Z]{1,3})\s+#?\d+\s+(.+)$/i.exec(rawName);
    return [{
      name: parsed?.[2]?.trim() ?? rawName,
      status,
      detail: null,
      position: parsed?.[1]?.toUpperCase() ?? null,
      reportedAt,
    }];
  });
}

function strictEventMatch(game: NcaafGame, teams: OfficialTeam[], eventDate: string): boolean {
  if (easternDate(game.scheduledStart) !== eventDate) return false;
  return teamMatches(game.away, teams[0]!) && teamMatches(game.home, teams[1]!);
}

function teamMatches(team: NcaafGame["away"], report: OfficialTeam): boolean {
  const candidates = [text(report.teamDisplayName), text(report.teamName)].filter((value): value is string => Boolean(value));
  const accepted = new Set([canonicalTeam(team.name), canonicalTeam(team.abbreviation)]);
  return candidates.some((value) => accepted.has(canonicalTeam(value)));
}

function canonicalTeam(value: string): string {
  let normalized = normalize(value);
  for (const mascot of OFFICIAL_REPORT_MASCOT_SUFFIXES) {
    if (normalized.endsWith(mascot) && normalized.length > mascot.length) {
      normalized = normalized.slice(0, -mascot.length);
      break;
    }
  }
  return ({
    floridast: "floridastate",
    ncst: "northcarolinastate",
    ncstate: "northcarolinastate",
    mississippi: "olemiss",
    southerncalifornia: "usc",
    pitt: "pittsburgh",
  } as Record<string, string>)[normalized] ?? normalized;
}

const OFFICIAL_REPORT_MASCOT_SUFFIXES = [
  "fightingillini", "goldengophers", "yellowjackets", "mountaineers", "crimsontide",
  "southcarolinagamecocks", "ragincajuns", "nittanylions", "demondeacons", "cornhuskers",
  "boilermakers", "commodores", "terrapins", "seminoles", "hurricanes", "cavaliers",
  "razorbacks", "longhorns", "volunteers", "wildcats", "cardinals", "gamecocks",
  "wolverines", "spartans", "hawkeyes", "huskies", "buckeyes", "badgers",
  "scarletknights", "fightingirish", "tarheels", "wolfpack", "bluedevils",
  "goldenbears", "orangemen", "hokies", "panthers", "tigers", "aggies", "gators",
  "sooners", "rebels", "bulldogs", "bayoubengals", "cyclones", "jayhawks", "utes",
  "knights", "cowboys", "cougars", "redraiders", "hornedfrogs", "sundevils",
  "bearcats", "buffaloes", "bears", "ducks", "bruins", "trojans", "hoosiers",
  "huskers", "orange", "cavaliers", "cardinal", "owls",
].sort((first, second) => second.length - first.length);

function easternDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function officialTimestamp(args: { date: string | null; time: string | null; timeZone: string | null }): string | null {
  if (!validDate(args.date) || !/^\d{2}:\d{2}:\d{2}$/.test(args.time ?? "")) return null;
  const zone = args.timeZone === "CT" ? "America/Chicago" : args.timeZone === "ET" ? "America/New_York" : null;
  if (!zone) return null;
  const desired = `${args.date}T${args.time}`;
  for (const offset of zone === "America/Chicago" ? ["-05:00", "-06:00"] : ["-04:00", "-05:00"]) {
    const candidate = new Date(`${desired}${offset}`);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(candidate).replace(", ", "T");
    if (parts === desired) return candidate.toISOString();
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function validDate(value: string | null): value is string { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)); }
function emptyResult(): CfbOfficialConferenceAvailabilityResult {
  return { release: CFB_OFFICIAL_CONFERENCE_AVAILABILITY_RELEASE, requests: 0, failures: [], reportsByGame: {} };
}
