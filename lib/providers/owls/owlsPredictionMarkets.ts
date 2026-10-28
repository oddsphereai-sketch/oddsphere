/** Display-only Kalshi game markets. Never enters a prediction DTO or writer. */
import { normalizeMlbTeamName } from "../real_api/_teamNameNormalizer";
import { normalizeNhlTeamName } from "../nhl/_teamNameNormalizer";
import { normalizeTeamAbbr } from "../playbook/playbookTeamNormalizer";
import { cfbProviderTeamMatches } from "../../services/football/cfbProviderTeamIdentity";
import { uclTeamAsset } from "../../services/ucl/uclTeamAssets";

export const PREDICTION_MARKET_RELEASE = "owls_kalshi_display_2026_10_28_r1";
export const PREDICTION_MARKET_TARGETS = {
  nba: { sport: "nba", series: "kxnbagame" },
  nhl: { sport: "nhl", series: "kxnhlgame" },
  nfl: { sport: "nfl", series: "kxnflgame" },
  cfb: { sport: "ncaaf", series: "kxncaafgame" },
  mlb: { sport: "mlb", series: "kxmlbgame" },
  wnba: { sport: "wnba", series: "kxwnbagame" },
  soccer: { sport: "soccer", series: "kxeplgame" },
  ucl: { sport: "soccer", series: "kxuclgame" },
} as const;
export type PredictionMarketSport = keyof typeof PREDICTION_MARKET_TARGETS;
/** [source receipt epoch milliseconds, YES bid/ask midpoint, total contracts] */
export type PredictionMarketPoint = [number, number, number | null];
export type PredictionMarketRow = {
  ticker: string;
  eventTicker: string;
  sideCode: string;
  team: string;
  gameDate: string;
  bid: number;
  ask: number;
  probability: number;
  volume24h: number | null;
  totalVolume: number | null;
  asOf: string;
  history: PredictionMarketPoint[];
  /** Real five-minute candles from Kalshi; volume is per interval, not cumulative. */
  historicalCandles?: PredictionMarketPoint[];
  historicalCheckedAt?: string;
  historicalRelease?: string;
};
export type PredictionMarketFeed = {
  release: typeof PREDICTION_MARKET_RELEASE;
  sport: PredictionMarketSport;
  fetchedAt: string;
  rows: PredictionMarketRow[];
};
export type PredictionMarketGameIdentity = {
  sport: PredictionMarketSport;
  gameStartAt: string;
  awayTeam: string;
  homeTeam: string;
  awayName?: string | null;
  homeName?: string | null;
};
export type PredictionMarketMatch = {
  eventTicker: string;
  source: "Kalshi via OWLS";
  status: "current" | "retained";
  asOf: string;
  outcomes: Array<PredictionMarketRow & { side: "away" | "home" | "draw"; label: string }>;
};

type Json = Record<string, unknown>;
function object(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}
function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function price(value: unknown): number | null {
  const n = number(value);
  return n !== null && n >= 0 && n <= 1 ? n : null;
}
function volume(value: unknown): number | null {
  const n = number(value);
  return n !== null && n >= 0 ? n : null;
}
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export function kalshiGameDate(eventTicker: string): string | null {
  const match = /^[A-Z0-9]+-(\d{2})([A-Z]{3})(\d{2})[A-Z0-9]*$/.exec(eventTicker);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2]);
  if (month < 0) return null;
  const date = `20${match[1]}-${String(month + 1).padStart(2, "0")}-${match[3]}`;
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().startsWith(date) ? date : null;
}

/** The raw market's updated_time is metadata time, NOT a quote timestamp. */
export function parseOwlsPredictionMarkets(body: unknown, sport: PredictionMarketSport, now = Date.now()): PredictionMarketFeed | null {
  const envelope = object(body);
  const meta = object(envelope?.meta);
  const data = object(envelope?.data);
  if (envelope?.success !== true || !meta || !data) return null;
  const explicit = typeof meta.cacheTimestamp === "string" ? Date.parse(meta.cacheTimestamp) : NaN;
  const stamped = typeof meta.timestamp === "string" ? Date.parse(meta.timestamp) : NaN;
  const age = number(meta.ageSeconds);
  const observed = Number.isFinite(explicit) ? explicit : Number.isFinite(stamped) && age !== null && age >= 0 ? stamped - age * 1000 : NaN;
  if (!Number.isFinite(observed) || observed > now + 60_000 || now - observed > 10 * 60_000) return null;
  const asOf = new Date(observed).toISOString();
  const series = PREDICTION_MARKET_TARGETS[sport].series.toUpperCase();
  const today = new Date(now).toISOString().slice(0, 10);
  const earliest = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
  const latest = new Date(Date.parse(today) + 8 * 86_400_000).toISOString().slice(0, 10);
  const rows: PredictionMarketRow[] = [];
  for (const value of Object.values(data).slice(0, 1200)) {
    const raw = object(value);
    if (!raw || raw.status !== "active" || raw.market_type !== "binary") continue;
    const ticker = typeof raw.ticker === "string" ? raw.ticker.toUpperCase() : "";
    const eventTicker = typeof raw.event_ticker === "string" ? raw.event_ticker.toUpperCase() : "";
    if (!eventTicker.startsWith(`${series}-`) || !ticker.startsWith(`${eventTicker}-`)) continue;
    const gameDate = kalshiGameDate(eventTicker);
    const sideCode = ticker.slice(eventTicker.length + 1);
    const team = typeof raw.yes_sub_title === "string" ? raw.yes_sub_title.trim() : "";
    const bid = price(raw.yes_bid_dollars);
    const ask = price(raw.yes_ask_dollars);
    if (!gameDate || gameDate < earliest || gameDate > latest || !team || team.length > 100 || ticker.length > 120 || !/^[A-Z0-9]+$/.test(sideCode)) continue;
    if (bid === null || ask === null || bid > ask || ask - bid > .2 || (bid === 0 && ask === 0) || (bid === 1 && ask === 1)) continue;
    const probability = Math.round((bid + ask) / 2 * 10000) / 10000;
    const totalVolume = volume(raw.volume_fp);
    rows.push({ ticker, eventTicker, sideCode, team, gameDate, bid, ask, probability,
      volume24h: volume(raw.volume_24h_fp), totalVolume, asOf,
      history: [[observed, probability, totalVolume]] });
  }
  if (new Set(rows.map(row => row.ticker)).size !== rows.length) return null;
  const expectedCount = sport === "soccer" || sport === "ucl" ? 3 : 2;
  const grouped = new Map<string, PredictionMarketRow[]>();
  for (const row of rows) { const group = grouped.get(row.eventTicker) ?? []; group.push(row); grouped.set(row.eventTicker,group); }
  // Do not overwrite half of a previously coherent event with a partial refresh.
  const complete = [...grouped.values()].filter(group => group.length === expectedCount && group.reduce((sum,row)=>sum+row.probability,0) >= .85 && group.reduce((sum,row)=>sum+row.probability,0) <= 1.15).flat();
  return { release: PREDICTION_MARKET_RELEASE, sport, fetchedAt: new Date(now).toISOString(), rows:complete };
}

export function isPredictionMarketFeed(value: unknown, sport: PredictionMarketSport): value is PredictionMarketFeed {
  const feed = object(value);
  return feed?.release === PREDICTION_MARKET_RELEASE && feed.sport === sport && typeof feed.fetchedAt === "string" && Array.isArray(feed.rows) && feed.rows.length <= 1200 && feed.rows.every(value => {
    const row = object(value);
    if(row?.historicalCheckedAt !== undefined && (typeof row.historicalCheckedAt !== "string" || !Number.isFinite(Date.parse(row.historicalCheckedAt))))return false;
    if(row?.historicalRelease !== undefined && typeof row.historicalRelease!=="string")return false;
    if(row?.historicalCandles !== undefined && (!Array.isArray(row.historicalCandles) || row.historicalCandles.length>96 || !row.historicalCandles.every(point=>Array.isArray(point)&&point.length===3&&Number.isFinite(point[0])&&price(point[1])!==null&&(point[2]===null||volume(point[2])!==null))))return false;
    return row && typeof row.ticker === "string" && typeof row.eventTicker === "string" && typeof row.sideCode === "string" && typeof row.team === "string" && typeof row.gameDate === "string" && typeof row.asOf === "string" && Number.isFinite(Date.parse(row.asOf)) && price(row.probability) !== null && price(row.bid) !== null && price(row.ask) !== null && Array.isArray(row.history) && row.history.length >= 1 && row.history.length <= 100 && row.history.every(point => Array.isArray(point) && point.length === 3 && Number.isFinite(point[0]) && price(point[1]) !== null && (point[2] === null || volume(point[2]) !== null));
  });
}

/** Keep real receipts during an upstream gap; never re-stamp an old quote. */
export function mergePredictionMarketFeeds(previous: PredictionMarketFeed | null, current: PredictionMarketFeed, now = Date.now()): PredictionMarketFeed {
  const rows = new Map((previous?.sport === current.sport ? previous.rows : []).filter(row => now - Date.parse(row.asOf) <= 24 * 60 * 60_000).map(row => [row.ticker, row]));
  for (const row of current.rows) {
    const prior = rows.get(row.ticker);
    if (prior && Date.parse(prior.asOf) > Date.parse(row.asOf)) continue;
    const history = new Map<number, PredictionMarketPoint>();
    for (const point of [...(prior?.history ?? []), ...row.history]) {
      if (point[0] >= now - 8 * 60 * 60_000 && point[0] <= now + 60_000) history.set(point[0], point);
    }
    rows.set(row.ticker, { ...row, history: [...history.values()].sort((a,b) => a[0]-b[0]).slice(-100),
      ...(prior?.historicalCandles ? {historicalCandles:prior.historicalCandles.filter(point=>point[0]>=now-8*60*60_000)} : {}),
      ...(prior?.historicalCheckedAt ? {historicalCheckedAt:prior.historicalCheckedAt} : {}),
      ...(prior?.historicalRelease ? {historicalRelease:prior.historicalRelease} : {}) });
  }
  const feed = { ...current, rows: [...rows.values()].sort((a,b) => b.asOf.localeCompare(a.asOf)).slice(0, 1200) };
  // Next's shared data cache has a response-size ceiling. Preserve current
  // quotes first and bound history before a busy college slate can exceed it.
  while (JSON.stringify(feed).length > 1_500_000 && feed.rows.some(row=>row.history.length>2 || (row.historicalCandles?.length ?? 0)>2)) {
    feed.rows=feed.rows.map(row=>({...row,history:row.history.slice(-Math.max(2,Math.ceil(row.history.length/2))),
      ...(row.historicalCandles ? {historicalCandles:row.historicalCandles.slice(-Math.max(2,Math.ceil(row.historicalCandles.length/2)))} : {})}));
  }
  return feed;
}

const ALIASES: Record<string, string> = { WAS: "WSH", WSH: "WSH", NYK: "NY", GSW: "GS", NOP: "NO", SAS: "SA", UTA: "UTAH", UTH: "UTAH", PHO: "PHX", JAC: "JAX" };
// Provider -> member abbreviations, NOT a canonicalizer for member inputs.
// In our UCL roster MUN is Bayern Munich, while Kalshi MUN is Manchester United.
const SOCCER_ALIASES: Record<string, string> = {
  LFC:"LIV",MUN:"MAN",MCI:"MNC",CFC:"CHE",BRI:"BHA",AV:"AVL",BHAFC:"BHA",NFFC:"NFO",CP:"CRY",
  BMU:"MUN",BAY:"MUN",SPO:"SCP",SHA:"SHK",BOG:"BODO",LIL:"LILL",ASK:"LAS",SLO:"SLB",ROM:"ROMA",
  BVB:"DOR",RBB:"BET",SBH:"SAB",VIK:"VFK",COM:"COMO",SLA:"SLP",STU:"VFB",
};
function clean(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(fc|afc|cf)\b/g, "").replace(/[^a-z0-9]/g, ""); }
function teamMatches(row: PredictionMarketRow, abbreviation: string, name: string | null | undefined, sport: PredictionMarketSport): boolean {
  if (sport === "cfb") return row.sideCode === abbreviation.toUpperCase() || cfbProviderTeamMatches({ observed: row.team, abbreviation, expectedName: name }) || cfbProviderTeamMatches({ observed: row.sideCode, abbreviation, expectedName: name });
  if (sport === "soccer" || sport === "ucl") {
    const providerCode = SOCCER_ALIASES[row.sideCode] ?? row.sideCode;
    return providerCode === abbreviation.toUpperCase() || [name, uclTeamAsset(abbreviation)?.displayName].some(expected => expected && clean(expected) === clean(row.team));
  }
  if (sport === "mlb") return normalizeMlbTeamName(row.sideCode) === normalizeMlbTeamName(abbreviation) && normalizeMlbTeamName(abbreviation) !== null;
  if (sport === "nhl") return normalizeNhlTeamName(row.sideCode) === normalizeNhlTeamName(abbreviation) && normalizeNhlTeamName(abbreviation) !== null;
  if (sport === "nba" || sport === "wnba") {
    // Raw YES ticker identity is stronger than ambiguous city-only text such
    // as "Los Angeles C", which the older public provider normalizer reads LAL.
    const a = normalizeTeamAbbr(sport, row.sideCode) ?? normalizeTeamAbbr(sport, row.team);
    const b = normalizeTeamAbbr(sport, abbreviation);
    return a !== null && b !== null && (ALIASES[a] ?? a) === (ALIASES[b] ?? b);
  }
  return (ALIASES[row.sideCode] ?? row.sideCode) === (ALIASES[abbreviation.toUpperCase()] ?? abbreviation.toUpperCase());
}

/** Exact league + original game date + both opponents; ambiguous events stay absent. */
export function matchPredictionMarketGame(feed: PredictionMarketFeed | null, game: PredictionMarketGameIdentity, now = Date.now()): PredictionMarketMatch | null {
  if (!feed || feed.sport !== game.sport || !Number.isFinite(Date.parse(game.gameStartAt))) return null;
  const gameDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(game.gameStartAt));
  const groups = new Map<string, PredictionMarketRow[]>();
  for (const row of feed.rows) {
    const age = now - Date.parse(row.asOf);
    if (row.gameDate !== gameDate || age < -60_000 || age > 24 * 60 * 60_000) continue;
    const rows = groups.get(row.eventTicker) ?? []; rows.push(row); groups.set(row.eventTicker, rows);
  }
  const matches: PredictionMarketMatch[] = [];
  for (const [eventTicker, rows] of groups) {
    const away = rows.filter(row => teamMatches(row, game.awayTeam, game.awayName, game.sport));
    const home = rows.filter(row => teamMatches(row, game.homeTeam, game.homeName, game.sport));
    const draw = rows.filter(row => /^(TIE|DRAW)$/.test(row.sideCode));
    const soccer = game.sport === "soccer" || game.sport === "ucl";
    if (away.length !== 1 || home.length !== 1 || away[0].ticker === home[0].ticker || (soccer && draw.length !== 1)) continue;
    if (rows.length !== (soccer ? 3 : 2)) continue;
    const selected = [...away, ...home, ...(soccer ? draw : [])];
    const stamps = selected.map(row => Date.parse(row.asOf));
    if (Math.max(...stamps) - Math.min(...stamps) > 60_000) continue;
    const sum = selected.reduce((total,row) => total + row.probability, 0);
    if (sum < .85 || sum > 1.15) continue;
    const asOf = new Date(Math.min(...stamps)).toISOString();
    matches.push({ eventTicker, source:"Kalshi via OWLS", status:now - Math.min(...stamps) <= 10 * 60_000 ? "current" : "retained", asOf,
      outcomes:[{...away[0],side:"away",label:game.awayTeam},{...home[0],side:"home",label:game.homeTeam},...(soccer ? [{...draw[0],side:"draw" as const,label:"Draw"}] : [])] });
  }
  return matches.length === 1 ? matches[0] : null;
}
