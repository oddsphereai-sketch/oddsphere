import { espnCfbTeamId } from "./cfbEspnReferenceLine";

export const CFB_ESPN_SCORE_FALLBACK_RELEASE =
  "cfb_espn_score_fallback_2026_10_08_r1_exact_team_time_final" as const;
export const CFB_ESPN_SCORE_MAX_GAMES = 200 as const;
export const CFB_ESPN_SCORE_MAX_DATES = 6 as const;
export const CFB_ESPN_SCORE_MAX_REQUESTS = CFB_ESPN_SCORE_MAX_DATES * 2;
export const CFB_ESPN_SCORE_TIMEOUT_MS = 6_000 as const;
export const CFB_ESPN_SCORE_KICKOFF_TOLERANCE_MS = 90 * 60_000;

export type CfbEspnScoreCandidate = {
  providerGameId: string;
  scheduledStart: string;
  awayAbbreviation: string;
  homeAbbreviation: string;
};

export type CfbEspnFinalScore = {
  release: typeof CFB_ESPN_SCORE_FALLBACK_RELEASE;
  provider: "espn";
  providerEventId: string;
  providerGameId: string;
  homeScore: number;
  awayScore: number;
};

export type CfbEspnScoreFallbackResult = {
  release: typeof CFB_ESPN_SCORE_FALLBACK_RELEASE;
  requests: number;
  finalsByGame: Record<string, CfbEspnFinalScore>;
  failuresByGame: Record<string, string>;
};

type JsonRecord = Record<string, unknown>;
type EspnCompetitor = {
  homeAway?: unknown;
  score?: unknown;
  team?: { id?: unknown };
};
type EspnEvent = {
  id?: unknown;
  date?: unknown;
  status?: { type?: { completed?: unknown; state?: unknown; name?: unknown } };
  competitions?: Array<{ competitors?: EspnCompetitor[] }>;
};

/**
 * Bounded official-score fallback for exact CFB games omitted by the primary
 * settlement feed. It performs only slate-level scoreboard reads and requires
 * one unambiguous team-pair + kickoff match before accepting a completed score.
 */
export async function fetchCfbEspnFinalScores(args: {
  games: CfbEspnScoreCandidate[];
  fetchImpl?: typeof fetch;
}): Promise<CfbEspnScoreFallbackResult> {
  const games = [...new Map(args.games.map((game) => [game.providerGameId, game])).values()];
  if (games.length === 0) return emptyResult();
  if (games.length > CFB_ESPN_SCORE_MAX_GAMES) {
    throw new Error(`CFB ESPN score fallback exceeds its ${CFB_ESPN_SCORE_MAX_GAMES}-game bound.`);
  }
  const dates = [...new Set(games.flatMap(scoreboardDates))].sort();
  if (dates.length > CFB_ESPN_SCORE_MAX_DATES) {
    throw new Error(`CFB ESPN score fallback exceeds its ${CFB_ESPN_SCORE_MAX_DATES}-date bound.`);
  }

  const fetchImpl = args.fetchImpl ?? fetch;
  let requests = 0;
  const reads = await Promise.allSettled(dates.flatMap((date) => [80, 81].map(async (group) => {
    requests += 1;
    return fetchJson(fetchImpl, `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}&limit=400&groups=${group}`);
  })));
  if (requests > CFB_ESPN_SCORE_MAX_REQUESTS) throw new Error("CFB ESPN score fallback exceeded its request bound.");
  const payloads = reads.flatMap((read) => read.status === "fulfilled" ? [read.value] : []);
  const events = dedupeEvents(payloads.flatMap((payload) => Array.isArray(payload.events) ? payload.events as EspnEvent[] : []));
  const failuresByGame: Record<string, string> = {};
  const finalsByGame: Record<string, CfbEspnFinalScore> = {};

  for (const game of games) {
    const matched = matchEvent(game, events);
    if (typeof matched === "string") {
      failuresByGame[game.providerGameId] = matched;
      continue;
    }
    const score = finalScore(matched);
    if (!score) {
      failuresByGame[game.providerGameId] = "strict_event_not_final";
      continue;
    }
    finalsByGame[game.providerGameId] = {
      release: CFB_ESPN_SCORE_FALLBACK_RELEASE,
      provider: "espn",
      providerEventId: String(matched.id),
      providerGameId: game.providerGameId,
      homeScore: score.home,
      awayScore: score.away,
    };
  }

  return { release: CFB_ESPN_SCORE_FALLBACK_RELEASE, requests, finalsByGame, failuresByGame };
}

function matchEvent(game: CfbEspnScoreCandidate, events: EspnEvent[]): EspnEvent | string {
  const awayId = espnCfbTeamId(game.awayAbbreviation);
  const homeId = espnCfbTeamId(game.homeAbbreviation);
  if (!awayId || !homeId) return "espn_team_identity_unavailable";
  const kickoff = Date.parse(game.scheduledStart);
  if (!Number.isFinite(kickoff)) return "invalid_persisted_kickoff";
  const matches = events.filter((event) => {
    const pair = eventPair(event);
    const eventAt = Date.parse(typeof event.date === "string" ? event.date : "");
    return pair?.away === awayId && pair.home === homeId && Number.isFinite(eventAt) &&
      Math.abs(eventAt - kickoff) <= CFB_ESPN_SCORE_KICKOFF_TOLERANCE_MS;
  });
  if (matches.length === 0) return "strict_event_not_found";
  if (matches.length !== 1 || typeof matches[0]?.id !== "string") return "strict_event_ambiguous";
  return matches[0];
}

function finalScore(event: EspnEvent): { home: number; away: number } | null {
  const type = event.status?.type;
  const completed = type?.completed === true || type?.state === "post" || type?.name === "STATUS_FINAL";
  if (!completed) return null;
  const competitors = event.competitions?.[0]?.competitors ?? [];
  const home = competitors.find((row) => row.homeAway === "home");
  const away = competitors.find((row) => row.homeAway === "away");
  const homeScore = scoreValue(home?.score);
  const awayScore = scoreValue(away?.score);
  return homeScore !== null && awayScore !== null && homeScore + awayScore > 0
    ? { home: homeScore, away: awayScore }
    : null;
}

function scoreValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function eventPair(event: EspnEvent): { away: string; home: string } | null {
  const competitors = event.competitions?.[0]?.competitors ?? [];
  const away = competitors.find((row) => row.homeAway === "away")?.team?.id;
  const home = competitors.find((row) => row.homeAway === "home")?.team?.id;
  return typeof away === "string" && typeof home === "string" ? { away, home } : null;
}

function scoreboardDates(game: CfbEspnScoreCandidate): string[] {
  const instant = new Date(game.scheduledStart);
  if (!Number.isFinite(instant.getTime())) throw new Error(`CFB ESPN score game ${game.providerGameId} has an invalid kickoff.`);
  const eastern = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string) => eastern.find((value) => value.type === type)?.value;
  const easternDate = `${part("year")}${part("month")}${part("day")}`;
  return [...new Set([game.scheduledStart.slice(0, 10).replaceAll("-", ""), easternDate])];
}

function dedupeEvents(events: EspnEvent[]): EspnEvent[] {
  return [...new Map(events.filter((event) => typeof event.id === "string").map((event) => [String(event.id), event])).values()];
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<JsonRecord> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(CFB_ESPN_SCORE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`ESPN CFB score request failed (${response.status}).`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("ESPN CFB score response is invalid.");
  return payload as JsonRecord;
}

function emptyResult(): CfbEspnScoreFallbackResult {
  return { release: CFB_ESPN_SCORE_FALLBACK_RELEASE, requests: 0, finalsByGame: {}, failuresByGame: {} };
}
