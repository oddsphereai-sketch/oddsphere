import type {
  DailyEdgeAvailabilityPlayer,
  DailyEdgeGameAvailability,
} from "@/lib/services/dailyEdge/gameAvailability";
import type { NcaafGame, NcaafTeam } from "./balldontlieNcaafSlate";
import { cfbProviderTeamMatches } from "./cfbProviderTeamIdentity";

export const CFB_ESPN_INJURY_NEWS_AVAILABILITY_RELEASE =
  "cfb_espn_injury_news_availability_2026_10_21_r1_strict_public_status" as const;
export const CFB_ESPN_INJURY_NEWS_MAX_REQUESTS = 1 as const;
export const CFB_ESPN_INJURY_NEWS_TIMEOUT_MS = 8_000 as const;
export const CFB_ESPN_INJURY_NEWS_MAX_RESPONSE_BYTES = 8_000_000 as const;

const ESPN_CFB_NEWS_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/news?limit=100";
const ESPN_CFB_NEWS_SOURCE_URL = "https://www.espn.com/college-football/";
const ORDINARY_STATUS_MAX_AGE_MS = 21 * 24 * 60 * 60_000;
const LONG_TERM_STATUS_MAX_AGE_MS = 120 * 24 * 60 * 60_000;
const POSITION = "QB|RB|FB|WR|TE|OL|OT|OG|C|DL|DE|DT|EDGE|LB|CB|DB|S|K|P|LS";
const NAME_WORD = "[A-Z][\\p{L}'’.-]+|(?:Jr\\.|Sr\\.|II|III|IV)";
const PLAYER_NAME = `[A-Z][\\p{L}'’.-]+(?:\\s+(?:${NAME_WORD})){1,3}`;

type JsonRecord = Record<string, unknown>;
type ParsedStatus = {
  name: string;
  position: string | null;
  status: "Out" | "Doubtful" | "Questionable" | "Probable" | "Available";
  longTerm: boolean;
};
type ArticleTeam = { labels: string[] };
type AcceptedArticle = {
  game: NcaafGame;
  team: NcaafTeam;
  player: DailyEdgeAvailabilityPlayer;
  publishedAt: string;
  sourceUrl: string;
};

export type CfbEspnInjuryNewsAvailabilityResult = {
  release: typeof CFB_ESPN_INJURY_NEWS_AVAILABILITY_RELEASE;
  requests: number;
  articlesRead: number;
  acceptedPlayers: number;
  reportsByGame: Record<string, DailyEdgeGameAvailability>;
};

/**
 * One bounded, no-key ESPN news read for explicit public player statuses. This
 * is intentionally a partial injury-news fallback, never a verified-clear
 * feed. Generic injury discussion and ambiguous team/player attribution fail
 * closed.
 */
export async function fetchCfbEspnInjuryNewsAvailability(args: {
  games: NcaafGame[];
  capturedAt: string;
  fetchImpl?: typeof fetch;
}): Promise<CfbEspnInjuryNewsAvailabilityResult> {
  const games = uniqueGames(args.games);
  if (games.length === 0) return emptyResult();
  const response = await (args.fetchImpl ?? fetch)(ESPN_CFB_NEWS_URL, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(CFB_ESPN_INJURY_NEWS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`espn_cfb_injury_news_http_${response.status}`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > CFB_ESPN_INJURY_NEWS_MAX_RESPONSE_BYTES) {
    throw new Error("espn_cfb_injury_news_response_too_large");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > CFB_ESPN_INJURY_NEWS_MAX_RESPONSE_BYTES) {
    throw new Error("espn_cfb_injury_news_response_too_large");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("espn_cfb_injury_news_invalid_json");
  }
  return parseCfbEspnInjuryNewsAvailability({ games, capturedAt: args.capturedAt, json, requests: 1 });
}

export function parseCfbEspnInjuryNewsAvailability(args: {
  games: NcaafGame[];
  capturedAt: string;
  json: unknown;
  requests?: number;
}): CfbEspnInjuryNewsAvailabilityResult {
  const capturedAtMs = Date.parse(args.capturedAt);
  if (!Number.isFinite(capturedAtMs)) throw new Error("ESPN CFB injury-news capture timestamp is invalid.");
  const root = record(args.json);
  if (!root || !Array.isArray(root.articles)) throw new Error("ESPN CFB injury-news response is invalid.");
  const games = uniqueGames(args.games);
  const accepted = root.articles.flatMap((article): AcceptedArticle[] => {
    const parsed = parseArticle(article, games, capturedAtMs);
    return parsed ? [parsed] : [];
  });
  const reportsByGame = buildReports(games, accepted);
  return {
    release: CFB_ESPN_INJURY_NEWS_AVAILABILITY_RELEASE,
    requests: args.requests ?? 0,
    articlesRead: root.articles.length,
    acceptedPlayers: accepted.length,
    reportsByGame,
  };
}

function parseArticle(value: unknown, games: NcaafGame[], capturedAtMs: number): AcceptedArticle | null {
  const article = record(value);
  if (!article) return null;
  const headline = text(article.headline);
  const description = text(article.description);
  const publishedAt = validIso(article.published) ?? validIso(article.lastModified);
  const sourceUrl = articleSourceUrl(article);
  if (!headline || !publishedAt || !sourceUrl) return null;
  const publishedAtMs = Date.parse(publishedAt);
  if (!Number.isFinite(publishedAtMs) || publishedAtMs > capturedAtMs + 5 * 60_000) return null;

  const articleTeams = parseArticleTeams(article.categories);
  const matchedTeams = uniqueMatchedTeams(games, articleTeams);
  const team = selectArticleTeam(headline, matchedTeams, articleTeams);
  if (!team) return null;

  const parsedStatus = explicitPlayerStatus(headline, description, team, articleTeams);
  if (!parsedStatus) return null;
  const maximumAge = parsedStatus.longTerm ? LONG_TERM_STATUS_MAX_AGE_MS : ORDINARY_STATUS_MAX_AGE_MS;
  const matchingGames = games.filter((game) => {
    const kickoff = Date.parse(game.scheduledStart);
    return Number.isFinite(kickoff) && publishedAtMs <= kickoff && kickoff - publishedAtMs <= maximumAge && gameHasTeam(game, team);
  });
  if (matchingGames.length !== 1) return null;

  return {
    game: matchingGames[0]!,
    team,
    player: {
      name: parsedStatus.name,
      status: parsedStatus.status,
      detail: headline,
      position: parsedStatus.position,
      reportedAt: publishedAt,
    },
    publishedAt,
    sourceUrl,
  };
}

function explicitPlayerStatus(
  headline: string,
  description: string | null,
  team: NcaafTeam,
  articleTeams: ArticleTeam[],
): ParsedStatus | null {
  const teamLabels = articleTeams
    .flatMap((entry) => entry.labels)
    .filter((label) => cfbProviderTeamMatches({ observed: label, abbreviation: team.abbreviation, expectedName: team.name }));
  const strippedHeadline = stripLeadingTeam(headline, [team.name, team.abbreviation, ...teamLabels]);
  const texts = [strippedHeadline, description].filter((entry): entry is string => Boolean(entry));
  const afterName = new RegExp(
    `^(?:(?<position>${POSITION})\\s+)?(?<name>${PLAYER_NAME})\\s+(?<phrase>(?:is\\s+|has\\s+been\\s+)?(?:ruled\\s+out|out\\b|doubtful\\b|questionable\\b|probable\\b|available\\b|cleared\\s+to\\s+play|expected\\s+to\\s+play|will\\s+miss|will\\s+sit\\s+out|won't\\s+play|to\\s+undergo\\s+season[- ]ending|undergoes?\\s+season[- ]ending)[^.;]*)`,
    "iu",
  );
  const positioned = new RegExp(
    `\\b(?<position>${POSITION})\\s+(?<name>${PLAYER_NAME})\\s+(?<phrase>(?:is\\s+|has\\s+been\\s+)?(?:ruled\\s+out|out\\b|doubtful\\b|questionable\\b|probable\\b|available\\b|cleared\\s+to\\s+play|expected\\s+to\\s+play|will\\s+miss|will\\s+sit\\s+out|won't\\s+play|to\\s+undergo\\s+season[- ]ending|undergoes?\\s+season[- ]ending)[^.;]*)`,
    "iu",
  );
  const withoutPlayer = new RegExp(
    `\\b(?:without|move\\s+forward\\s+without)\\s+(?:(?<position>${POSITION})\\s+)?(?<name>${PLAYER_NAME})\\s+(?<phrase>(?:for|through)\\s+[^.;]+)`,
    "iu",
  );
  const playerWill = new RegExp(
    `\\b(?<name>${PLAYER_NAME})\\s+(?<phrase>(?:has\\s+been\\s+ruled\\s+out|is\\s+ruled\\s+out|will\\s+miss|will\\s+sit\\s+out|won't\\s+play|is\\s+doubtful|is\\s+questionable|is\\s+probable|is\\s+expected\\s+to\\s+play|has\\s+been\\s+cleared)[^.;]*)`,
    "iu",
  );
  for (const value of texts) {
    for (const pattern of [afterName, positioned, withoutPlayer, playerWill]) {
      const match = pattern.exec(value);
      const name = cleanPlayerName(match?.groups?.name ?? null);
      const phrase = match?.groups?.phrase ?? null;
      if (!name || !phrase) continue;
      const position = normalizePosition(match?.groups?.position ?? null);
      if (!position && !hasMedicalOrStrongStatusContext(`${headline} ${description ?? ""}`, phrase)) continue;
      const classified = classifyStatus(phrase, `${headline} ${description ?? ""}`);
      if (!classified) continue;
      return { name, position, ...classified };
    }
  }
  return null;
}

function classifyStatus(phrase: string, context: string): Pick<ParsedStatus, "status" | "longTerm"> | null {
  const value = `${phrase} ${context}`.toLowerCase();
  const longTerm = /season[- ]ending|out for (?:the )?(?:rest|remainder) of (?:the )?season|sit out (?:the )?rest of (?:the )?season|through (?:the )?postseason|out indefinitely/.test(value);
  if (longTerm || /ruled out|will miss|will sit out|won't play|\bout\b/.test(phrase.toLowerCase())) return { status: "Out", longTerm };
  if (/doubtful/.test(value)) return { status: "Doubtful", longTerm: false };
  if (/questionable|game[- ]time decision/.test(value)) return { status: "Questionable", longTerm: false };
  if (/probable/.test(value)) return { status: "Probable", longTerm: false };
  if (/available|cleared|expected to play/.test(value)) return { status: "Available", longTerm: false };
  return null;
}

function hasMedicalOrStrongStatusContext(context: string, phrase: string): boolean {
  return /injur|surgery|concussion|fracture|sprain|strain|knee|ankle|shoulder|arm|leg|foot|back|illness|protocol/i.test(context) ||
    /season[- ]ending|ruled out|doubtful|questionable|probable|game[- ]time decision|cleared to play|expected to play|will miss|will sit out|won't play/i.test(phrase);
}

function selectArticleTeam(
  headline: string,
  matchedTeams: NcaafTeam[],
  articleTeams: ArticleTeam[],
): NcaafTeam | null {
  if (matchedTeams.length === 1) return matchedTeams[0]!;
  const named = matchedTeams.filter((team) => articleTeams.some((entry) => entry.labels.some((label) =>
    cfbProviderTeamMatches({ observed: label, abbreviation: team.abbreviation, expectedName: team.name }) &&
    containsLabel(headline, label),
  )));
  return named.length === 1 ? named[0]! : null;
}

function parseArticleTeams(value: unknown): ArticleTeam[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): ArticleTeam[] => {
    const category = record(candidate);
    const team = record(category?.team);
    if (!category || category.type !== "team") return [];
    const labels = [category.description, team?.description, team?.abbreviation, team?.shortDisplayName]
      .map(text)
      .filter((label): label is string => label !== null);
    return labels.length > 0 ? [{ labels }] : [];
  });
}

function uniqueMatchedTeams(games: NcaafGame[], articleTeams: ArticleTeam[]): NcaafTeam[] {
  const scheduled = [...new Map(games.flatMap((game) => [[game.away.id, game.away], [game.home.id, game.home]])).values()];
  return scheduled.filter((team) => articleTeams.some((entry) => entry.labels.some((observed) =>
    cfbProviderTeamMatches({ observed, abbreviation: team.abbreviation, expectedName: team.name }))));
}

function buildReports(games: NcaafGame[], accepted: AcceptedArticle[]): Record<string, DailyEdgeGameAvailability> {
  const reports: Record<string, DailyEdgeGameAvailability> = {};
  for (const game of games) {
    const rows = accepted.filter((entry) => entry.game.providerGameId === game.providerGameId);
    if (rows.length === 0) continue;
    const latestByPlayer = new Map<string, AcceptedArticle>();
    for (const row of rows) {
      const key = `${row.team.id}:${normalize(row.player.name)}`;
      const previous = latestByPlayer.get(key);
      if (!previous || Date.parse(row.publishedAt) > Date.parse(previous.publishedAt)) latestByPlayer.set(key, row);
    }
    const selected = [...latestByPlayer.values()];
    const latest = selected.sort((first, second) => Date.parse(second.publishedAt) - Date.parse(first.publishedAt))[0]!;
    reports[game.providerGameId] = {
      eventId: game.providerGameId,
      awayTeam: game.away.abbreviation,
      homeTeam: game.home.abbreviation,
      source: "ESPN",
      sourceLabel: "ESPN public injury news",
      sourceUrl: latest.sourceUrl || ESPN_CFB_NEWS_SOURCE_URL,
      reportDate: latest.publishedAt,
      reportUpdatedAt: latest.publishedAt,
      teams: [game.away, game.home].map((team) => ({
        abbreviation: team.abbreviation,
        teamName: team.name,
        players: selected.filter((entry) => entry.team.id === team.id).map((entry) => entry.player),
      })),
    };
  }
  return reports;
}

function articleSourceUrl(article: JsonRecord): string | null {
  const links = record(article.links);
  const web = record(links?.web);
  const href = text(web?.href);
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === "https:" && url.hostname === "www.espn.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

function stripLeadingTeam(headline: string, labels: string[]): string {
  const ordered = [...new Set(labels)].sort((first, second) => second.length - first.length);
  for (const label of ordered) {
    const pattern = new RegExp(`^(?:No\\.\\s*\\d+\\s+)?${escapeRegex(label)}(?:\\s+football)?[\\s:–—-]+`, "iu");
    if (pattern.test(headline)) return headline.replace(pattern, "").trim();
  }
  return headline.trim();
}

function containsLabel(value: string, label: string): boolean {
  if (label.length < 3) return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(label)}(?:$|[^\\p{L}\\p{N}])`, "iu").test(value);
}

function cleanPlayerName(value: string | null): string | null {
  const name = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!name || name.length > 80 || /\b(?:coach|team|staff|offense|defense)\b/i.test(name)) return null;
  return name;
}

function normalizePosition(value: string | null): string | null {
  const position = value?.trim().toUpperCase() ?? "";
  return position && new RegExp(`^(?:${POSITION})$`).test(position) ? position : null;
}

function gameHasTeam(game: NcaafGame, team: NcaafTeam): boolean {
  return game.away.id === team.id || game.home.id === team.id;
}

function uniqueGames(games: NcaafGame[]): NcaafGame[] {
  return [...new Map(games.map((game) => [game.providerGameId, game])).values()];
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function validIso(value: unknown): string | null {
  const parsed = Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function emptyResult(): CfbEspnInjuryNewsAvailabilityResult {
  return { release: CFB_ESPN_INJURY_NEWS_AVAILABILITY_RELEASE, requests: 0, articlesRead: 0, acceptedPlayers: 0, reportsByGame: {} };
}
