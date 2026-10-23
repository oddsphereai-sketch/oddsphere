/**
 * Official NBA injury-report fallback.
 *
 * The NBA publishes a rolling PDF for each report date. This reader is used
 * only when ESPN's exact-event summary does not publish a complete two-team
 * injury payload. It fails closed unless the report date, matchup, and both
 * exact team sections are present and structurally parseable.
 */

import type { NbaInjuryStatus, NbaPlayerInjury } from "../../automodel/nba/types";

export type OfficialNbaInjuryRequest = {
  gameStartsAt: string;
  teamAbbreviation: string;
  awayTeamAbbreviation: string;
  homeTeamAbbreviation: string;
};

export type OfficialNbaInjuryReportOptions = {
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  extractPdfText?: (bytes: Uint8Array) => Promise<{ text: string; totalPages: number }>;
};

export type OfficialNbaInjuryReport = {
  reportDate: string;
  reportUrl: string;
  text: string;
};

const OFFICIAL_NBA_ROOT = "https://official.nba.com";
const OFFICIAL_NBA_REPORT_HOST = "ak-static.cms.nba.com";
const MAX_INDEX_BYTES = 2_000_000;
const MAX_PDF_BYTES = 8_000_000;
const MAX_PDF_PAGES = 20;

const NBA_TEAM_NAMES: Readonly<Record<string, string>> = {
  ATL: "Atlanta Hawks",
  BOS: "Boston Celtics",
  BKN: "Brooklyn Nets",
  CHA: "Charlotte Hornets",
  CHI: "Chicago Bulls",
  CLE: "Cleveland Cavaliers",
  DAL: "Dallas Mavericks",
  DEN: "Denver Nuggets",
  DET: "Detroit Pistons",
  GSW: "Golden State Warriors",
  HOU: "Houston Rockets",
  IND: "Indiana Pacers",
  LAC: "LA Clippers",
  LAL: "Los Angeles Lakers",
  MEM: "Memphis Grizzlies",
  MIA: "Miami Heat",
  MIL: "Milwaukee Bucks",
  MIN: "Minnesota Timberwolves",
  NOP: "New Orleans Pelicans",
  NYK: "New York Knicks",
  OKC: "Oklahoma City Thunder",
  ORL: "Orlando Magic",
  PHI: "Philadelphia 76ers",
  PHX: "Phoenix Suns",
  POR: "Portland Trail Blazers",
  SAC: "Sacramento Kings",
  SAS: "San Antonio Spurs",
  TOR: "Toronto Raptors",
  UTA: "Utah Jazz",
  WAS: "Washington Wizards",
};

function canonicalNbaAbbreviation(value: string): string {
  const abbreviation = value.trim().toUpperCase();
  return ({
    GS: "GSW",
    NO: "NOP",
    NY: "NYK",
    SA: "SAS",
    UTAH: "UTA",
    WSH: "WAS",
  } as Record<string, string>)[abbreviation] ?? abbreviation;
}

function reportDateInEastern(gameStartsAt: string): string | null {
  const date = new Date(gameStartsAt);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function seasonSlugForReportDate(reportDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(reportDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function reportUrlTimestamp(url: string): number {
  const match = /_(\d{2})_(\d{2})(AM|PM)\.pdf(?:$|[?#])/i.exec(url);
  if (!match) return -1;
  let hour = Number(match[1]) % 12;
  if (match[3]?.toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

export function selectLatestOfficialNbaReportUrl(html: string, reportDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return null;
  const escapedDate = reportDate.replaceAll("-", "\\-");
  const pattern = new RegExp(
    `https?:\\/\\/ak-static\\.cms\\.nba\\.com\\/referee\\/injury\\/Injury-Report_${escapedDate}_[^"'<>\\s]+?\\.pdf`,
    "gi",
  );
  const candidates = [...new Set(html.match(pattern) ?? [])]
    .filter((candidate) => {
      try {
        const url = new URL(candidate);
        return url.protocol === "https:" && url.hostname === OFFICIAL_NBA_REPORT_HOST;
      } catch {
        return false;
      }
    })
    .sort((left, right) => reportUrlTimestamp(right) - reportUrlTimestamp(left));
  return candidates[0] ?? null;
}

function normalizeOfficialStatus(raw: string): NbaInjuryStatus {
  switch (raw.toLowerCase()) {
    case "out": return "out";
    case "questionable":
    case "doubtful": return "questionable";
    case "probable": return "probable";
    case "available": return "available";
    default: return "unknown";
  }
}

function normalizePlayerName(value: string): string {
  const match = /^(.+),\s*(.+)$/.exec(value.trim());
  return match ? `${match[2]} ${match[1]}`.replace(/\s+/g, " ").trim() : value.trim();
}

function mmddyyyy(reportDate: string): string {
  const [year, month, day] = reportDate.split("-");
  return `${month}/${day}/${year}`;
}

function findExactMatchupBlock(
  text: string,
  reportDate: string,
  matchup: string,
): string[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && !/^Page \d+ of \d+$/i.test(line) &&
      !/^Injury Report:/i.test(line) && !/^Game Date Game Time Matchup Team Player Name/i.test(line));
  let activeDate: string | null = null;
  const starts: Array<{ index: number; date: string; matchup: string }> = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const dateMatch = /^(\d{2}\/\d{2}\/\d{4})\b/.exec(line);
    if (dateMatch) activeDate = dateMatch[1]!;
    const matchupMatch = /\b([A-Z]{2,3}@[A-Z]{2,3})\b/.exec(line);
    if (matchupMatch && activeDate) {
      starts.push({ index, date: activeDate, matchup: matchupMatch[1]! });
    }
  }
  const expectedDate = mmddyyyy(reportDate);
  const startPosition = starts.findIndex((entry) => entry.date === expectedDate && entry.matchup === matchup);
  if (startPosition < 0) return null;
  const start = starts[startPosition]!;
  const end = starts[startPosition + 1]?.index ?? lines.length;
  const block = lines.slice(start.index, end);
  block[0] = block[0]!.replace(new RegExp(`^.*?\\b${matchup.replace("@", "\\@")}\\b\\s*`), "");
  return block;
}

function parseTeamSegment(lines: string[], teamName: string): NbaPlayerInjury[] | null {
  if (lines.length === 0 || !lines[0]!.startsWith(teamName)) return null;
  const normalized = [...lines];
  normalized[0] = normalized[0]!.slice(teamName.length).trim();
  const joined = normalized.join("\n");
  if (/\bNOT YET SUBMITTED\b/i.test(joined)) return null;
  if (/\bNO INJURIES(?: REPORTED)?\b/i.test(joined)) return [];
  const players: NbaPlayerInjury[] = [];
  for (const line of normalized) {
    const row = /^(.+?,\s*.+?)\s+(Available|Out|Questionable|Doubtful|Probable)(?:\s+(.*))?$/i.exec(line);
    if (!row) continue;
    players.push({
      player_id: null,
      source_player_id: null,
      name: normalizePlayerName(row[1]!),
      status: normalizeOfficialStatus(row[2]!),
      position: null,
      injury_type: row[3]?.trim() || null,
      reported_at: null,
      expected_return_at: null,
    });
  }
  return players.length > 0 ? players : null;
}

export function parseOfficialNbaGameInjuries(
  text: string,
  reportDate: string,
  awayTeamAbbreviation: string,
  homeTeamAbbreviation: string,
): ReadonlyMap<string, NbaPlayerInjury[]> | null {
  const away = canonicalNbaAbbreviation(awayTeamAbbreviation);
  const home = canonicalNbaAbbreviation(homeTeamAbbreviation);
  const awayName = NBA_TEAM_NAMES[away];
  const homeName = NBA_TEAM_NAMES[home];
  if (!awayName || !homeName || away === home) return null;
  const block = findExactMatchupBlock(text, reportDate, `${away}@${home}`);
  if (!block) return null;
  const awayIndex = block.findIndex((line) => line.startsWith(awayName));
  const homeIndex = block.findIndex((line) => line.startsWith(homeName));
  if (awayIndex < 0 || homeIndex <= awayIndex) return null;
  const awayPlayers = parseTeamSegment(block.slice(awayIndex, homeIndex), awayName);
  const homePlayers = parseTeamSegment(block.slice(homeIndex), homeName);
  if (awayPlayers === null || homePlayers === null) return null;
  return new Map([[away, awayPlayers], [home, homePlayers]]);
}

async function responseBodyWithinLimit(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength <= maxBytes ? bytes : null;
}

export async function fetchLatestOfficialNbaInjuryReport(
  reportDate: string,
  options: OfficialNbaInjuryReportOptions = {},
): Promise<OfficialNbaInjuryReport | null> {
  const log = options.log ?? (() => {});
  const fetchFn = options.fetchImpl ?? fetch;
  const season = seasonSlugForReportDate(reportDate);
  if (!season) return null;
  try {
    const indexResponse = await fetchFn(`${OFFICIAL_NBA_ROOT}/nba-injury-report-${season}-season/`, {
      headers: { "User-Agent": "Mozilla/5.0 oddsphere/nba-official-injury-report", accept: "text/html" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!indexResponse.ok) return null;
    const indexBytes = await responseBodyWithinLimit(indexResponse, MAX_INDEX_BYTES);
    if (!indexBytes) return null;
    const reportUrl = selectLatestOfficialNbaReportUrl(new TextDecoder().decode(indexBytes), reportDate);
    if (!reportUrl) return null;
    const parsedUrl = new URL(reportUrl);
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== OFFICIAL_NBA_REPORT_HOST) return null;
    const pdfResponse = await fetchFn(reportUrl, {
      headers: { "User-Agent": "Mozilla/5.0 oddsphere/nba-official-injury-report", accept: "application/pdf" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!pdfResponse.ok) return null;
    const pdfBytes = await responseBodyWithinLimit(pdfResponse, MAX_PDF_BYTES);
    if (!pdfBytes) return null;
    const extractPdfText = options.extractPdfText ?? (async (bytes: Uint8Array) => {
      const { extractText } = await import("unpdf");
      return extractText(bytes, { mergePages: true });
    });
    const extracted = await extractPdfText(pdfBytes);
    if (!Number.isInteger(extracted.totalPages) || extracted.totalPages < 1 || extracted.totalPages > MAX_PDF_PAGES) {
      return null;
    }
    if (!extracted.text.includes(`Injury Report: ${reportDate.slice(5, 7)}/${reportDate.slice(8, 10)}/${reportDate.slice(2, 4)}`)) {
      return null;
    }
    return { reportDate, reportUrl, text: extracted.text };
  } catch (error) {
    log(`[officialNbaInjuryReport] ${reportDate} fetch failed: ${(error as Error).message}`);
    return null;
  }
}

export function createOfficialNbaGameInjuryResolver(
  options: OfficialNbaInjuryReportOptions = {},
): (request: OfficialNbaInjuryRequest) => Promise<NbaPlayerInjury[] | null> {
  const reportCache = new Map<string, Promise<OfficialNbaInjuryReport | null>>();
  const gameCache = new Map<string, ReadonlyMap<string, NbaPlayerInjury[]> | null>();
  return async (request) => {
    const reportDate = reportDateInEastern(request.gameStartsAt);
    if (!reportDate) return null;
    let reportPromise = reportCache.get(reportDate);
    if (!reportPromise) {
      reportPromise = fetchLatestOfficialNbaInjuryReport(reportDate, options);
      reportCache.set(reportDate, reportPromise);
    }
    const report = await reportPromise;
    if (!report) return null;
    const away = canonicalNbaAbbreviation(request.awayTeamAbbreviation);
    const home = canonicalNbaAbbreviation(request.homeTeamAbbreviation);
    const gameKey = `${reportDate}:${away}@${home}`;
    if (!gameCache.has(gameKey)) {
      gameCache.set(gameKey, parseOfficialNbaGameInjuries(report.text, reportDate, away, home));
    }
    return gameCache.get(gameKey)?.get(canonicalNbaAbbreviation(request.teamAbbreviation)) ?? null;
  };
}

export const __OFFICIAL_NBA_INJURIES_TEST__ = {
  reportDateInEastern,
  seasonSlugForReportDate,
  normalizeOfficialStatus,
};
