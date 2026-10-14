import type { BdlUclMatch } from "@/lib/providers/real_api/BallDontLieUclProvider";
import {
  readLabResponseSnapshot,
  readLatestLabResponseSnapshot,
  upsertLabResponseSnapshot,
} from "@/lib/services/labResponseSnapshots";
import { regulationScore } from "./uclCompetitionContext";

export const UCL_ELO_STRENGTH_FOUNDATION_RELEASE =
  "ucl_elo_strength_foundation_2026_10_14_r1_local_public_consensus" as const;

const SNAPSHOT_KEY = "soccer::uefa_champions_league::elo-strength-foundation::r1";
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60_000;
const SNAPSHOT_STALE_MS = 35 * 24 * 60 * 60_000;
const PUBLIC_ELO_URL = "https://raw.githubusercontent.com/xgabora/Club-Football-Match-Data/main/data/EloRatings.csv";
const DOMESTIC_SEASONS = ["2324", "2425", "2526", "2627"] as const;
const DOMESTIC_LEAGUES = ["E0", "D1", "I1", "SP1", "F1", "N1", "P1", "B1", "T1", "G1", "SC0"] as const;

type DomesticMatch = {
  date: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
};

export type UclEloClubRating = {
  localElo: number;
  localGames: number;
  publicElo: number | null;
};

export type UclEloStrengthFoundationPayload = {
  schemaVersion: 1;
  release: typeof UCL_ELO_STRENGTH_FOUNDATION_RELEASE;
  generatedAt: string;
  domesticMatches: number;
  uclMatches: number;
  clubs: Record<string, UclEloClubRating>;
};

export type UclEloPair = {
  homeLocal: number;
  awayLocal: number;
  homePublic: number | null;
  awayPublic: number | null;
  homeGames: number;
  awayGames: number;
  sourceRelease: typeof UCL_ELO_STRENGTH_FOUNDATION_RELEASE;
};

function parseCsv(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

export function normalizeUclEloClub(value: string): string {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(fc|cf|afc|calcio|football club|futbol club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    "paris saint germain": "paris sg",
    "internazionale": "inter",
    "manchester united": "man united",
    "manchester city": "man city",
    "bayern munich": "bayern",
    "real betis": "betis",
    "atletico madrid": "ath madrid",
    "sporting cp": "sp lisbon",
    "borussia dortmund": "dortmund",
    "as roma": "roma",
    "feyenoord rotterdam": "feyenoord",
    "bayer leverkusen": "leverkusen",
    "ac milan": "milan",
    "as monaco": "monaco",
    "vfb stuttgart": "stuttgart",
    "tottenham hotspur": "tottenham",
    "newcastle united": "newcastle",
    "athletic club": "ath bilbao",
    "ajax amsterdam": "ajax",
    "eintracht frankfurt": "ein frankfurt",
    "union st gilloise": "st gilloise",
    "olympiacos": "olympiakos",
    "psv eindhoven": "psv",
    "slavia prague": "slavia praha",
    "f c kobenhavn": "kobenhavn",
    "fc kobenhavn": "kobenhavn",
    "red star belgrade": "red star",
    "fk qarabag": "qarabag",
    "bodo glimt": "bodoe glimt",
    "shakhtar donetsk": "shakhtar",
  };
  return aliases[normalized] ?? normalized;
}

function footballDataDate(value: string): string | null {
  const parts = value.trim().split(/[\/-]/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [day, month, rawYear] = parts;
  const year = rawYear! < 100 ? 2000 + rawYear! : rawYear!;
  return new Date(Date.UTC(year, month! - 1, day!)).toISOString();
}

async function fetchWithRetry(url: string): Promise<Response> {
  let failure: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (response.ok) return response;
      failure = new Error(`UCL Elo source ${url} returned ${response.status}`);
    } catch (error) {
      failure = error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw failure instanceof Error ? failure : new Error(`UCL Elo source ${url} failed`);
}

async function fetchDomesticFile(season: string, league: string): Promise<DomesticMatch[]> {
  const response = await fetchWithRetry(`https://football-data.co.uk/mmz4281/${season}/${league}.csv`);
  const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
  const header = parseCsv(lines[0] ?? "");
  const indexes = [header.indexOf("Date"), header.indexOf("HomeTeam"), header.indexOf("AwayTeam"), header.indexOf("FTHG"), header.indexOf("FTAG")];
  if (indexes.some((index) => index < 0)) return [];
  const [dateAt, homeAt, awayAt, homeGoalsAt, awayGoalsAt] = indexes;
  return lines.slice(1).flatMap((line): DomesticMatch[] => {
    const row = parseCsv(line);
    const date = footballDataDate(row[dateAt] ?? "");
    const homeGoals = Number(row[homeGoalsAt]);
    const awayGoals = Number(row[awayGoalsAt]);
    if (!date || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return [];
    return [{
      date,
      home: normalizeUclEloClub(row[homeAt] ?? ""),
      away: normalizeUclEloClub(row[awayAt] ?? ""),
      homeGoals,
      awayGoals,
    }];
  });
}

async function fetchDomesticMatches(): Promise<DomesticMatch[]> {
  const jobs = DOMESTIC_SEASONS.flatMap((season) => DOMESTIC_LEAGUES.map((league) => ({ season, league })));
  const results: DomesticMatch[][] = [];
  for (let index = 0; index < jobs.length; index += 4) {
    const batch = jobs.slice(index, index + 4);
    results.push(...await Promise.all(batch.map(({ season, league }) => fetchDomesticFile(season, league))));
  }
  return results.flat().sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}

async function fetchPublicElo(): Promise<Map<string, number>> {
  const response = await fetchWithRetry(PUBLIC_ELO_URL);
  const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
  const header = parseCsv(lines[0] ?? "");
  const dateAt = header.indexOf("date");
  const clubAt = header.indexOf("club");
  const eloAt = header.indexOf("elo");
  if ([dateAt, clubAt, eloAt].some((index) => index < 0)) throw new Error("UCL public Elo schema mismatch");
  const latest = new Map<string, { date: number; elo: number }>();
  for (const line of lines.slice(1)) {
    const row = parseCsv(line);
    const date = Date.parse(row[dateAt] ?? "");
    const elo = Number(row[eloAt]);
    const club = normalizeUclEloClub(row[clubAt] ?? "");
    const prior = latest.get(club);
    if (club && Number.isFinite(date) && Number.isFinite(elo) && (!prior || date > prior.date)) latest.set(club, { date, elo });
  }
  return new Map([...latest].map(([club, value]) => [club, value.elo]));
}

export function buildUclEloStrengthFoundation(input: {
  domestic: DomesticMatch[];
  uclMatches: BdlUclMatch[];
  teamNames: Map<number, string>;
  publicElo: Map<string, number>;
  generatedAt?: string;
}): UclEloStrengthFoundationPayload {
  type Event = { date: number; home: string; away: string; homeGoals: number; awayGoals: number; kind: "domestic" | "ucl" };
  const events: Event[] = input.domestic.map((match) => ({ ...match, date: Date.parse(match.date), kind: "domestic" }));
  for (const match of input.uclMatches) {
    const score = regulationScore(match).score;
    const home = input.teamNames.get(match.home_team_id);
    const away = input.teamNames.get(match.away_team_id);
    if (!score || !home || !away) continue;
    events.push({
      date: Date.parse(match.date),
      home: normalizeUclEloClub(home),
      away: normalizeUclEloClub(away),
      homeGoals: score.home,
      awayGoals: score.away,
      kind: "ucl",
    });
  }
  events.sort((left, right) => left.date - right.date || left.home.localeCompare(right.home) || left.away.localeCompare(right.away));
  const ratings = new Map<string, number>();
  const games = new Map<string, number>();
  const rating = (club: string) => ratings.get(club) ?? 1500;
  for (const event of events) {
    if (!Number.isFinite(event.date) || !event.home || !event.away) continue;
    const home = rating(event.home);
    const away = rating(event.away);
    const expected = 1 / (1 + 10 ** (-((home + (event.kind === "domestic" ? 60 : 45) - away) / 400)));
    const actual = event.homeGoals > event.awayGoals ? 1 : event.homeGoals < event.awayGoals ? 0 : 0.5;
    const adjustment = (event.kind === "domestic" ? 20 : 28) * (actual - expected);
    ratings.set(event.home, home + adjustment);
    ratings.set(event.away, away - adjustment);
    games.set(event.home, (games.get(event.home) ?? 0) + 1);
    games.set(event.away, (games.get(event.away) ?? 0) + 1);
  }
  const clubs = new Set([...ratings.keys(), ...input.publicElo.keys()]);
  return {
    schemaVersion: 1,
    release: UCL_ELO_STRENGTH_FOUNDATION_RELEASE,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    domesticMatches: input.domestic.length,
    uclMatches: events.filter((event) => event.kind === "ucl").length,
    clubs: Object.fromEntries([...clubs].sort().map((club) => [club, {
      localElo: ratings.get(club) ?? 1500,
      localGames: games.get(club) ?? 0,
      publicElo: input.publicElo.get(club) ?? null,
    }])),
  };
}

export function validateUclEloStrengthFoundation(payload: UclEloStrengthFoundationPayload): UclEloStrengthFoundationPayload {
  if (payload.schemaVersion !== 1 || payload.release !== UCL_ELO_STRENGTH_FOUNDATION_RELEASE) throw new Error("UCL Elo foundation release mismatch");
  if (!Number.isFinite(Date.parse(payload.generatedAt)) || payload.domesticMatches < 1_000 || payload.uclMatches < 100) throw new Error("UCL Elo foundation coverage incomplete");
  const valid = Object.values(payload.clubs).filter((club) => Number.isFinite(club.localElo) && club.localGames >= 0);
  if (valid.length < 100) throw new Error("UCL Elo foundation club coverage incomplete");
  return payload;
}

export function uclEloPair(
  payload: UclEloStrengthFoundationPayload,
  homeName: string,
  awayName: string,
): UclEloPair {
  const home = payload.clubs[normalizeUclEloClub(homeName)] ?? { localElo: 1500, localGames: 0, publicElo: null };
  const away = payload.clubs[normalizeUclEloClub(awayName)] ?? { localElo: 1500, localGames: 0, publicElo: null };
  return {
    homeLocal: home.localElo,
    awayLocal: away.localElo,
    homePublic: home.publicElo,
    awayPublic: away.publicElo,
    homeGames: home.localGames,
    awayGames: away.localGames,
    sourceRelease: payload.release,
  };
}

export async function loadUclEloStrengthFoundation(input: {
  uclMatches: BdlUclMatch[];
  teamNames: Map<number, string>;
  allowWrite: boolean;
}): Promise<UclEloStrengthFoundationPayload> {
  const fresh = (await readLabResponseSnapshot<UclEloStrengthFoundationPayload>(SNAPSHOT_KEY, "fresh").catch(() => null))?.payload;
  if (fresh) return validateUclEloStrengthFoundation(fresh);
  try {
    const [domestic, publicElo] = await Promise.all([fetchDomesticMatches(), fetchPublicElo()]);
    const payload = validateUclEloStrengthFoundation(buildUclEloStrengthFoundation({
      domestic,
      uclMatches: input.uclMatches,
      teamNames: input.teamNames,
      publicElo,
    }));
    if (input.allowWrite) {
      const write = await upsertLabResponseSnapshot({
        snapshotKey: SNAPSHOT_KEY,
        kind: "daily_edge",
        sport: "soccer",
        slateDate: payload.generatedAt.slice(0, 10),
        payload,
        ttlMs: SNAPSHOT_TTL_MS,
        staleMs: SNAPSHOT_STALE_MS,
        source: "ucl_elo_strength_foundation",
        payloadVersion: UCL_ELO_STRENGTH_FOUNDATION_RELEASE,
      });
      if (!write.ok) throw new Error(`UCL Elo foundation persistence failed: ${write.error}`);
    }
    return payload;
  } catch (error) {
    const latest = (await readLatestLabResponseSnapshot<UclEloStrengthFoundationPayload>(SNAPSHOT_KEY).catch(() => null))?.payload;
    if (latest) return validateUclEloStrengthFoundation(latest);
    throw error;
  }
}
