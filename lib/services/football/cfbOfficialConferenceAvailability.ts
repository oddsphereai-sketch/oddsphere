import type { DailyEdgeGameAvailability, DailyEdgeAvailabilityPlayer } from "@/lib/services/dailyEdge/gameAvailability";
import type { NcaafGame } from "./balldontlieNcaafSlate";
import { cfbProviderTeamMatches } from "./cfbProviderTeamIdentity";

export const CFB_OFFICIAL_CONFERENCE_AVAILABILITY_RELEASE =
  "cfb_official_conference_availability_2026_10_17_r2_all_published_fbs_feeds" as const;
export const CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_REQUESTS = 12 as const;
export const CFB_OFFICIAL_CONFERENCE_AVAILABILITY_TIMEOUT_MS = 10_000 as const;
export const CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_RESPONSE_BYTES = 20_000_000 as const;
export const CFB_OFFICIAL_CONFERENCE_AVAILABILITY_REFRESH_MINUTES = 360 as const;
export const CFB_OFFICIAL_CONFERENCE_AVAILABILITY_PREGAME_REFRESH_MINUTES = 60 as const;

const HDI_PUBLIC_ENDPOINT = "https://app.hdintelligence.com/api/get-publish-public";
const HDI_CONFERENCES = [
  { organization: "SEC", sourceUrl: "https://www.secsports.com/fbreports" },
  { organization: "ACC", sourceUrl: "https://theacc.com/sports/2025/8/28/availability-reporting-football.aspx" },
  { organization: "B10", sourceUrl: "https://bigten.org/sports/2026/9/10/FB_Availability_Reports.aspx" },
  { organization: "B12", sourceUrl: "https://big12sports.com/sports/2025/8/14/FBreporting.aspx" },
  { organization: "American", sourceUrl: "https://theamerican.org/sports/2026/8/6/football_player_availability.aspx" },
  { organization: "MAC", sourceUrl: "https://getsomemaction.com/sports/2026/7/28/FB_0728265050.aspx.aspx" },
] as const;
const JSON_CONFERENCES = [
  { key: "SunBelt", feedUrl: "https://sbcautostorage.blob.core.windows.net/availability-reports/sunbelt-football/prod/report.json", sourceUrl: "https://sunbeltsports.org/news/2025/8/11/football-availability-report-new.aspx" },
  { key: "Pac12", feedUrl: "https://sbcautostorage.blob.core.windows.net/availability-reports/pac12-football/prod/report.json", sourceUrl: "https://pac-12.com/news/2026/9/11/2026-football-reports.aspx" },
] as const;
const FAKTOR_CONFERENCES = [
  { key: "MountainWest", landingUrl: "https://themw.com/sports/2026/8/21/football_reports.aspx", referer: "https://themw.com/" },
  { key: "CUSA", landingUrl: "https://conferenceusa.com/sports/2025/8/23/FB_0823254134.aspx", referer: "https://conferenceusa.com/" },
] as const;

type OfficialReportRow = { name?: unknown; status?: unknown };
type OfficialTeam = { rows?: unknown; teamDisplayName?: unknown; teamName?: unknown };
type OfficialReport = { ReportType?: unknown; conferenceTimeZone?: unknown; games?: unknown; postedTime?: unknown; publishDate?: unknown; footer?: unknown };

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
  /** SELECT-only operator rehearsal for the pending midweek recovery. */
  auditUseMidweekRecoveryCandidate?: boolean;
}): Promise<CfbOfficialConferenceAvailabilityResult> {
  const games = [...new Map(args.games.map((game) => [game.providerGameId, game])).values()];
  if (games.length === 0) return emptyResult();
  const fetchImpl = args.fetchImpl ?? fetch;
  const failures: string[] = [];
  let requests = 0;
  const requestText = async (url: string, init: RequestInit): Promise<string> => {
    requests += 1;
    const response = await fetchImpl(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(CFB_OFFICIAL_CONFERENCE_AVAILABILITY_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_RESPONSE_BYTES) throw new Error("response_too_large");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_RESPONSE_BYTES) throw new Error("response_too_large");
    return new TextDecoder().decode(bytes);
  };

  const hdi = HDI_CONFERENCES.map(async (conference) => {
    try {
      const body = await requestText(HDI_PUBLIC_ENDPOINT, {
        method: "POST",
        headers: headers("application/json"),
        body: JSON.stringify({ sport: "Football", organization: conference.organization, conference: conference.organization }),
      });
      return parseCfbOfficialConferenceAvailability({ json: JSON.parse(body) as unknown, games, capturedAt: args.capturedAt, sourceUrl: conference.sourceUrl, auditUseMidweekRecoveryCandidate: args.auditUseMidweekRecoveryCandidate });
    } catch (error) {
      failures.push(`${conference.organization}:${errorMessage(error)}`);
      return {};
    }
  });
  const jsonFeeds = JSON_CONFERENCES.map(async (conference) => {
    try {
      const body = await requestText(conference.feedUrl, { method: "GET", headers: headers("application/json") });
      return parseCfbOfficialJsonAvailability({ json: JSON.parse(body) as unknown, games, capturedAt: args.capturedAt, sourceUrl: conference.sourceUrl, auditUseMidweekRecoveryCandidate: args.auditUseMidweekRecoveryCandidate });
    } catch (error) {
      failures.push(`${conference.key}:${errorMessage(error)}`);
      return {};
    }
  });
  const faktorFeeds = FAKTOR_CONFERENCES.map(async (conference) => {
    try {
      const landing = await requestText(conference.landingUrl, { method: "GET", headers: headers("text/html") });
      const embedUrl = extractFaktorEmbedUrl(landing);
      const report = await requestText(embedUrl, {
        method: "GET",
        headers: { ...headers("text/html"), origin: new URL(conference.referer).origin, referer: conference.referer, "sec-fetch-dest": "iframe" },
      });
      return parseCfbFaktorAvailability({ html: report, games, capturedAt: args.capturedAt, sourceUrl: conference.landingUrl, auditUseMidweekRecoveryCandidate: args.auditUseMidweekRecoveryCandidate });
    } catch (error) {
      failures.push(`${conference.key}:${errorMessage(error)}`);
      return {};
    }
  });
  const parsed = await Promise.all([...hdi, ...jsonFeeds, ...faktorFeeds]);
  if (requests > CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_REQUESTS) throw new Error(`CFB official availability exceeded its ${CFB_OFFICIAL_CONFERENCE_AVAILABILITY_MAX_REQUESTS}-request ceiling.`);
  return { release: CFB_OFFICIAL_CONFERENCE_AVAILABILITY_RELEASE, requests, failures, reportsByGame: mergeReports(parsed) };
}

export function parseCfbOfficialConferenceAvailability(args: {
  json: unknown;
  games: NcaafGame[];
  capturedAt: string;
  sourceUrl: string;
  auditUseMidweekRecoveryCandidate?: boolean;
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
    const matchingGames = args.games.filter((game) => strictEventMatch(game, teams, eventDate, args.auditUseMidweekRecoveryCandidate));
    if (matchingGames.length !== 1) continue;
    const game = matchingGames[0]!;
    const reportUpdatedAt = officialTimestamp({ date: text(report.publishDate), time: text(report.postedTime), timeZone: text(report.conferenceTimeZone) }) ?? new Date(args.capturedAt).toISOString();
    reportsByGame[game.providerGameId] = buildReport(game, args.sourceUrl, eventDate, reportUpdatedAt, teams.map((team) => officialPlayers(team.rows, reportUpdatedAt)));
  }
  return reportsByGame;
}

export function parseCfbOfficialJsonAvailability(args: {
  json: unknown;
  games: NcaafGame[];
  capturedAt: string;
  sourceUrl: string;
  auditUseMidweekRecoveryCandidate?: boolean;
}): Record<string, DailyEdgeGameAvailability> {
  const root = record(args.json);
  if (!root || !Array.isArray(root.games)) throw new Error("invalid_official_json_report_envelope");
  const reportsByGame: Record<string, DailyEdgeGameAvailability> = {};
  for (const value of root.games) {
    const report = record(value);
    const away = record(report?.away);
    const home = record(report?.home);
    const eventDate = text(report?.dateISO);
    if (!report || !away || !home || !validDate(eventDate)) continue;
    const teams: OfficialTeam[] = [{ teamName: away.name }, { teamName: home.name }];
    const matchingGames = args.games.filter((game) => strictEventMatch(game, teams, eventDate, args.auditUseMidweekRecoveryCandidate));
    if (matchingGames.length !== 1) continue;
    const game = matchingGames[0]!;
    const reportUpdatedAt = validIso(text(report.updatedAtUTC)) ?? new Date(args.capturedAt).toISOString();
    reportsByGame[game.providerGameId] = buildReport(game, args.sourceUrl, eventDate, reportUpdatedAt, [jsonPlayers(away.players, reportUpdatedAt), jsonPlayers(home.players, reportUpdatedAt)]);
  }
  return reportsByGame;
}

export function parseCfbFaktorAvailability(args: {
  html: string;
  games: NcaafGame[];
  capturedAt: string;
  sourceUrl: string;
  auditUseMidweekRecoveryCandidate?: boolean;
}): Record<string, DailyEdgeGameAvailability> {
  const reportsByGame: Record<string, DailyEdgeGameAvailability> = {};
  const containerPattern = args.auditUseMidweekRecoveryCandidate
    ? /<(article|section)\b[^>]*data-availability-graphic-card=["']true["'][^>]*>([\s\S]*?)<\/\1>/gi
    : /<(article)\b[^>]*data-availability-graphic-card=["']true["'][^>]*>([\s\S]*?)<\/\1>/gi;
  const articles = [...args.html.matchAll(containerPattern)];
  for (const match of articles) {
    const article = match[0] ?? "";
    if (/graphics-empty-card/i.test(article)) continue;
    const eventAt = faktorUtcTimestamp(attributeFrom(article, "data-kickoff-at"));
    if (!eventAt) continue;
    const eventDate = easternDate(eventAt);
    const tables = [...article.matchAll(/<div\b[^>]*class=["'][^"']*availability-team-table[^"']*["'][^>]*aria-label=["']([^"']+) availability["'][^>]*>([\s\S]*?)<\/div>/gi)];
    if (tables.length !== 2) continue;
    const teams: OfficialTeam[] = tables.map((table) => ({ teamName: decodeHtml(table[1] ?? "") }));
    const matchingGames = args.games.filter((game) => strictEventMatch(game, teams, eventDate, args.auditUseMidweekRecoveryCandidate));
    if (matchingGames.length !== 1) continue;
    const reportUpdatedAt = faktorUtcTimestamp(attributeFrom(article, "data-updated-at")) ?? new Date(args.capturedAt).toISOString();
    const game = matchingGames[0]!;
    reportsByGame[game.providerGameId] = buildReport(game, args.sourceUrl, eventDate, reportUpdatedAt, tables.map((table) => faktorPlayers(table[2] ?? "", reportUpdatedAt)));
  }
  return reportsByGame;
}

export function extractFaktorEmbedUrl(html: string): string {
  const candidates = [...html.matchAll(/https:\/\/faktorsports\.com\/k\/embed\/player-availability\/[^"'<>\s]+/gi)].map((match) => decodeHtml(match[0] ?? ""));
  if (candidates.length !== 1) throw new Error(`faktor_embed_count_${candidates.length}`);
  const parsed = new URL(candidates[0]!);
  if (parsed.origin !== "https://faktorsports.com" || !parsed.pathname.startsWith("/k/embed/player-availability/")) throw new Error("invalid_faktor_embed_url");
  return parsed.toString();
}

function officialPlayers(value: unknown, reportedAt: string): DailyEdgeAvailabilityPlayer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): DailyEdgeAvailabilityPlayer[] => {
    const row = record(candidate) as OfficialReportRow | null;
    const status = text(row?.status);
    const rawName = text(row?.name);
    if (!status || !rawName || /^(available|exempt)$/i.test(status)) return [];
    const parsed = /^([A-Z]{1,3})\s+#?\d+\s+(.+)$/i.exec(rawName);
    return [{ name: parsed?.[2]?.trim() ?? rawName, status, detail: null, position: parsed?.[1]?.toUpperCase() ?? null, reportedAt }];
  });
}

function jsonPlayers(value: unknown, reportedAt: string): DailyEdgeAvailabilityPlayer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): DailyEdgeAvailabilityPlayer[] => {
    const player = record(candidate);
    const name = text(player?.name);
    const status = text(player?.status);
    if (!name || !status || /^(available|exempt)$/i.test(status)) return [];
    return [{ name, status, detail: null, position: text(player?.position)?.toUpperCase() ?? null, reportedAt }];
  });
}

function faktorPlayers(html: string, reportedAt: string): DailyEdgeAvailabilityPlayer[] {
  const players: DailyEdgeAvailabilityPlayer[] = [];
  for (const section of html.matchAll(/<tbody\b[^>]*class=["'][^"']*availability-status-section[^"']*["'][^>]*>([\s\S]*?)<\/tbody>/gi)) {
    const body = section[1] ?? "";
    const status = htmlText(/status-section-heading[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/i.exec(body)?.[1] ?? "");
    if (!status || /^(available|exempt)$/i.test(status)) continue;
    for (const row of body.matchAll(/<tr\b[^>]*class=["'][^"']*availability-player-row[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = row[1] ?? "";
      const name = htmlText(/class=["'][^"']*player-cell[^"']*["'][^>]*>([\s\S]*?)<\/td>/i.exec(rowHtml)?.[1] ?? "");
      const position = htmlText(/class=["'][^"']*position-cell[^"']*["'][^>]*>([\s\S]*?)<\/td>/i.exec(rowHtml)?.[1] ?? "");
      if (name) players.push({ name, status, detail: null, position: position || null, reportedAt });
    }
  }
  return players;
}

function buildReport(game: NcaafGame, sourceUrl: string, reportDate: string, reportUpdatedAt: string, players: DailyEdgeAvailabilityPlayer[][]): DailyEdgeGameAvailability {
  return {
    eventId: game.providerGameId,
    awayTeam: game.away.abbreviation,
    homeTeam: game.home.abbreviation,
    source: "Conference",
    sourceLabel: "Injury report",
    sourceUrl,
    reportDate,
    reportUpdatedAt,
    teams: [
      { abbreviation: game.away.abbreviation, teamName: game.away.name, players: players[0] ?? [] },
      { abbreviation: game.home.abbreviation, teamName: game.home.name, players: players[1] ?? [] },
    ],
  };
}

function mergeReports(groups: Array<Record<string, DailyEdgeGameAvailability>>): Record<string, DailyEdgeGameAvailability> {
  const merged: Record<string, DailyEdgeGameAvailability> = {};
  for (const reports of groups) for (const [gameId, report] of Object.entries(reports)) {
    const previous = merged[gameId];
    if (!previous || Date.parse(report.reportUpdatedAt ?? "") > Date.parse(previous.reportUpdatedAt ?? "")) merged[gameId] = report;
  }
  return merged;
}

function strictEventMatch(game: NcaafGame, teams: OfficialTeam[], eventDate: string, auditUseMidweekRecoveryCandidate = false): boolean {
  return easternDate(game.scheduledStart) === eventDate &&
    teamMatches(game.away, teams[0]!, auditUseMidweekRecoveryCandidate) &&
    teamMatches(game.home, teams[1]!, auditUseMidweekRecoveryCandidate);
}
function teamMatches(team: NcaafGame["away"], report: OfficialTeam, auditUseMidweekRecoveryCandidate: boolean): boolean {
  const candidates = [text(report.teamDisplayName), text(report.teamName)].filter((value): value is string => Boolean(value));
  if (auditUseMidweekRecoveryCandidate) {
    return candidates.some((observed) =>
      cfbProviderTeamMatches({ observed, abbreviation: team.abbreviation, expectedName: team.name }) ||
      (team.abbreviation === "NMSU" && ["nmstate", "newmexicostate"].includes(normalize(observed))));
  }
  const accepted = new Set([canonicalTeam(team.name), canonicalTeam(team.abbreviation)]);
  return candidates.some((value) => accepted.has(canonicalTeam(value)));
}
function canonicalTeam(value: string): string {
  let normalized = normalize(value);
  for (const mascot of MASCOT_SUFFIXES) if (normalized.endsWith(mascot) && normalized.length > mascot.length) { normalized = normalized.slice(0, -mascot.length); break; }
  return ({
    appstate: "appalachianstate",
    connecticut: "uconn",
    floridast: "floridastate",
    gasouthern: "georgiasouthern",
    gastate: "georgiastate",
    latech: "louisianatech",
    massachusetts: "umass",
    ncst: "northcarolinastate",
    ncstate: "northcarolinastate",
    mississippi: "olemiss",
    southerncalifornia: "usc",
    southernmississippi: "southernmiss",
    pitt: "pittsburgh",
    utsanantonio: "utsa",
  } as Record<string, string>)[normalized] ?? normalized;
}
const MASCOT_SUFFIXES = [
  "fightingillini", "goldengophers", "yellowjackets", "mountaineers", "crimsontide", "southcarolinagamecocks", "ragincajuns", "nittanylions", "demondeacons", "cornhuskers", "boilermakers", "commodores", "terrapins", "seminoles", "hurricanes", "cavaliers", "razorbacks", "longhorns", "volunteers", "wildcats", "cardinals", "gamecocks", "wolverines", "spartans", "hawkeyes", "huskies", "buckeyes", "badgers", "scarletknights", "fightingirish", "tarheels", "wolfpack", "bluedevils", "goldenbears", "orangemen", "hokies", "panthers", "tigers", "aggies", "gators", "sooners", "rebels", "bulldogs", "bayoubengals", "cyclones", "jayhawks", "utes", "knights", "blackknights", "cowboys", "cougars", "redraiders", "hornedfrogs", "sundevils", "bearcats", "buffaloes", "bears", "ducks", "bruins", "trojans", "hoosiers", "huskers", "orange", "cardinal", "owls", "eagles", "falcons", "warhawks",
].sort((first, second) => second.length - first.length);

function easternDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
function officialTimestamp(args: { date: string | null; time: string | null; timeZone: string | null }): string | null {
  if (!validDate(args.date) || !/^\d{2}:\d{2}:\d{2}$/.test(args.time ?? "")) return null;
  const zone = args.timeZone === "CT" ? "America/Chicago" : args.timeZone === "ET" ? "America/New_York" : null;
  return zone ? zonedTimestamp(`${args.date} ${args.time}`, zone) : null;
}
function faktorUtcTimestamp(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  return validIso(`${value.replace(" ", "T")}Z`);
}
function zonedTimestamp(value: string | null, timeZone: string | null): string | null {
  if (!value || !timeZone || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  if (!["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"].includes(timeZone)) return null;
  const desired = value.replace(" ", "T");
  for (const offset of ["-04:00", "-05:00", "-06:00", "-07:00", "-08:00"]) {
    const candidate = new Date(`${desired}${offset}`);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(candidate).replace(", ", "T");
    if (parts === desired) return candidate.toISOString();
  }
  return null;
}

function attributeFrom(html: string, name: string): string | null { return decodeHtml(new RegExp(`${name}=["']([^"']+)["']`, "i").exec(html)?.[1] ?? "") || null; }
function htmlText(value: string): string { return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
function decodeHtml(value: string): string {
  return value.replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16))).replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}
function headers(accept: string): Record<string, string> { return { accept, "content-type": accept === "application/json" ? "application/json" : "text/html", "user-agent": "OddSphere/1.0 (+https://www.oddsphereai.com/)" }; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "request_failed"; }
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function validDate(value: string | null): value is string { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)); }
function validIso(value: string | null): string | null { const parsed = Date.parse(value ?? ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function emptyResult(): CfbOfficialConferenceAvailabilityResult { return { release: CFB_OFFICIAL_CONFERENCE_AVAILABILITY_RELEASE, requests: 0, failures: [], reportsByGame: {} }; }
