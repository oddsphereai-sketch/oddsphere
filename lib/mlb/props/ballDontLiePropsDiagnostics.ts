import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { BdlClient, BdlNotFoundError } from "../../providers/real_api/_bdlClient";
import { parseBallDontLiePlayerProps } from "./providerClients";

type BdlDiagnosticGame = {
  id?: number | string | null;
  date?: string | null;
  game_date?: string | null;
  status?: string | null;
  home_team?: Record<string, unknown> | null;
  away_team?: Record<string, unknown> | null;
};

export type BallDontLiePropsAvailabilityReport = {
  provider: "balldontlie";
  date: string;
  outputPath: string;
  deep: boolean;
  writesToSupabase: false;
  bdlGamesFound: number;
  gamesWithPlayerProps: number;
  totalPlayerProps: number;
  normalizedRawProps: number;
  droppedRawProps: number;
  normalizedRows: number;
  pitcherStrikeoutRows: number;
  pitcherOutsRows: number;
  overUnderRows: number;
  milestoneRows: number;
  marketTypeCounts: Record<string, number>;
  droppedMarketTypes: string[];
  vendorsFound: string[];
  hardRockFound: boolean;
  hardRockRows: number;
  staleUpdatedAtCount: number;
  gamesWithZeroProps: string[];
  errorsByGame: Record<string, string>;
  eventSummaries: Array<{
    gameId: string;
    scheduledStart: string | null;
    minutesUntilScheduledStart: number | null;
    eventStatus: string | null;
    homeTeam: string | null;
    awayTeam: string | null;
    propsExist: boolean;
    rawProps: number;
    normalizedRawProps: number;
    droppedRawProps: number;
    normalizedRows: number;
    marketTypesFound: string[];
    pitcherStrikeoutRows: number;
    pitcherOutsRows: number;
    vendorsFound: string[];
    hardRockRows: number;
    updatedAtMin: string | null;
    updatedAtMax: string | null;
  }>;
  summary: {
    providerAvailabilityStatus: "available" | "unavailable" | "request_error" | "no_events";
    blockerReason: "PROPS_AVAILABLE" | "NO_MLB_EVENTS_FOUND" | "PROVIDER_PROP_ODDS_UNAVAILABLE" | "PROVIDER_REQUEST_ERRORS";
    selectedOddsProviderIfSharpEmpty: "balldontlie" | "none";
    timingWindowReport: {
      generatedAt: string;
      propAvailabilityByPregameWindow: Record<string, { eventCount: number; eventsWithProps: number; propRowsFound: number }>;
      propRowsFoundByBook: Record<string, number>;
      propsFoundOnlyForBooks: string[];
      propsFoundOnlyWithinPregameWindow: string | null;
    };
  };
};

export async function diagnoseBallDontLieMlbPropsAvailability(args: {
  date: string;
  deep?: boolean;
  maxPages?: number;
  outputDir?: string;
  apiKey?: string;
  client?: BdlClient;
}): Promise<BallDontLiePropsAvailabilityReport> {
  const apiKey = args.apiKey ?? process.env.BALLDONTLIE_API_KEY;
  const client = args.client ?? (apiKey ? new BdlClient(apiKey) : null);
  if (!client) throw new Error("BALLDONTLIE_API_KEY is required for Ball Don't Lie diagnostics");
  const maxPages = Math.max(1, Math.min(args.maxPages ?? 5, 20));
  const outputDir = args.outputDir ?? path.join(process.cwd(), "tmp/mlb-props/reports");
  await mkdir(outputDir, { recursive: true });
  const games = await getBdlGamesForDate(client, args.date, maxPages);
  const generatedAt = new Date().toISOString();
  const eventSummaries: BallDontLiePropsAvailabilityReport["eventSummaries"] = [];
  const errorsByGame: Record<string, string> = {};
  const gamesWithZeroProps: string[] = [];
  const allRows = [];
  let totalPlayerProps = 0;
  let normalizedRawProps = 0;
  let overUnderRows = 0;
  let milestoneRows = 0;
  const marketTypeCounts: Record<string, number> = {};
  const droppedMarketTypes = new Set<string>();

  for (const game of games) {
    const gameId = stringOrNull(game.id);
    if (!gameId) continue;
    let rawProps: Record<string, unknown>[] = [];
    try {
      rawProps = await client.fetchAll<Record<string, unknown>>({
        path: "/odds/player_props",
        query: { game_id: gameId, per_page: 100 },
        maxPages,
      });
    } catch (e) {
      if (e instanceof BdlNotFoundError) rawProps = [];
      else errorsByGame[gameId] = e instanceof Error ? e.message : String(e);
    }
    totalPlayerProps += rawProps.length;
    if (rawProps.length === 0) gamesWithZeroProps.push(gameId);
    overUnderRows += rawProps.filter((row) => stringOrNull(record(row.market).type)?.toLowerCase() === "over_under").length;
    milestoneRows += rawProps.filter((row) => stringOrNull(record(row.market).type)?.toLowerCase() === "milestone").length;
    const normalizedByRaw = rawProps.map((rawProp) => {
      const marketType = stringOrNull(rawProp.prop_type)?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "missing";
      marketTypeCounts[marketType] = (marketTypeCounts[marketType] ?? 0) + 1;
      const rows = parseBallDontLiePlayerProps([rawProp], generatedAt, game);
      if (rows.length === 0) droppedMarketTypes.add(marketType);
      return { marketType, rows };
    });
    const normalizedForGame = normalizedByRaw.filter((entry) => entry.rows.length > 0).length;
    normalizedRawProps += normalizedForGame;
    const normalized = normalizedByRaw.flatMap((entry) => entry.rows);
    allRows.push(...normalized);
    const updatedAts = rawProps.map((row) => stringOrNull(row.updated_at)).filter((v): v is string => Boolean(v)).sort();
    const vendors = [...new Set(normalized.map((row) => row.sportsbook))].sort();
    eventSummaries.push({
      gameId,
      scheduledStart: bdlStart(game),
      minutesUntilScheduledStart: minutesUntil(bdlStart(game), generatedAt),
      eventStatus: stringOrNull(game.status),
      homeTeam: bdlTeam(game, "home"),
      awayTeam: bdlTeam(game, "away"),
      propsExist: rawProps.length > 0,
      rawProps: rawProps.length,
      normalizedRawProps: normalizedForGame,
      droppedRawProps: rawProps.length - normalizedForGame,
      normalizedRows: normalized.length,
      marketTypesFound: [...new Set(normalizedByRaw.map((entry) => entry.marketType))].sort(),
      pitcherStrikeoutRows: normalized.filter((row) => row.marketKey === "pitcher_strikeouts").length,
      pitcherOutsRows: normalized.filter((row) => row.marketKey === "pitcher_outs").length,
      vendorsFound: vendors,
      hardRockRows: normalized.filter((row) => row.sportsbook === "hardrock").length,
      updatedAtMin: updatedAts[0] ?? null,
      updatedAtMax: updatedAts[updatedAts.length - 1] ?? null,
    });
  }

  const vendorsFound = [...new Set(allRows.map((row) => row.sportsbook))].sort();
  const outputPath = path.join(outputDir, `${args.date}-balldontlie-prop-availability${args.deep ? "-deep" : ""}.json`);
  const timingWindowReport = buildTimingWindowReport(eventSummaries, generatedAt);
  const blockerReason = games.length === 0
    ? "NO_MLB_EVENTS_FOUND"
    : Object.keys(errorsByGame).length > 0 && allRows.length === 0
      ? "PROVIDER_REQUEST_ERRORS"
      : allRows.length > 0
        ? "PROPS_AVAILABLE"
        : "PROVIDER_PROP_ODDS_UNAVAILABLE";
  const report: BallDontLiePropsAvailabilityReport = {
    provider: "balldontlie",
    date: args.date,
    outputPath,
    deep: args.deep === true,
    writesToSupabase: false,
    bdlGamesFound: games.length,
    gamesWithPlayerProps: eventSummaries.filter((event) => event.propsExist).length,
    totalPlayerProps,
    normalizedRawProps,
    droppedRawProps: totalPlayerProps - normalizedRawProps,
    normalizedRows: allRows.length,
    pitcherStrikeoutRows: allRows.filter((row) => row.marketKey === "pitcher_strikeouts").length,
    pitcherOutsRows: allRows.filter((row) => row.marketKey === "pitcher_outs").length,
    overUnderRows,
    milestoneRows,
    marketTypeCounts,
    droppedMarketTypes: [...droppedMarketTypes].sort(),
    vendorsFound,
    hardRockFound: vendorsFound.includes("hardrock"),
    hardRockRows: allRows.filter((row) => row.sportsbook === "hardrock").length,
    staleUpdatedAtCount: allRows.filter((row) => minutesUntil(row.asOfTimestamp, generatedAt) !== null && Math.abs(minutesUntil(row.asOfTimestamp, generatedAt) ?? 0) > 60).length,
    gamesWithZeroProps,
    errorsByGame,
    eventSummaries,
    summary: {
      providerAvailabilityStatus: blockerReason === "PROPS_AVAILABLE" ? "available" : blockerReason === "NO_MLB_EVENTS_FOUND" ? "no_events" : blockerReason === "PROVIDER_REQUEST_ERRORS" ? "request_error" : "unavailable",
      blockerReason,
      selectedOddsProviderIfSharpEmpty: allRows.length > 0 ? "balldontlie" : "none",
      timingWindowReport,
    },
  };
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  return report;
}

async function getBdlGamesForDate(client: BdlClient, date: string, maxPages: number): Promise<BdlDiagnosticGame[]> {
  const byId = new Map<string, BdlDiagnosticGame>();
  for (const d of [date, addOneCalendarDayUTC(date)]) {
    try {
      const rows = await client.fetchAll<BdlDiagnosticGame>({
        path: "/games",
        query: { "dates[]": [d], per_page: 100 },
        maxPages,
      });
      for (const row of rows) {
        const id = stringOrNull(row.id);
        if (!id || byId.has(id)) continue;
        const start = bdlStart(row);
        if ((start && etDate(start) === date) || (!start && String(row.date ?? row.game_date ?? "").slice(0, 10) === date)) {
          byId.set(id, row);
        }
      }
    } catch (e) {
      if (e instanceof BdlNotFoundError) continue;
      throw e;
    }
  }
  return [...byId.values()];
}

function buildTimingWindowReport(
  events: BallDontLiePropsAvailabilityReport["eventSummaries"],
  generatedAt: string,
): BallDontLiePropsAvailabilityReport["summary"]["timingWindowReport"] {
  const byWindow: Record<string, { eventCount: number; eventsWithProps: number; propRowsFound: number }> = {};
  const byBook: Record<string, number> = {};
  for (const event of events) {
    const bucket = timingBucket(event.minutesUntilScheduledStart);
    byWindow[bucket] = byWindow[bucket] ?? { eventCount: 0, eventsWithProps: 0, propRowsFound: 0 };
    byWindow[bucket].eventCount++;
    if (event.propsExist) byWindow[bucket].eventsWithProps++;
    byWindow[bucket].propRowsFound += event.normalizedRows;
    for (const book of event.vendorsFound) byBook[book] = (byBook[book] ?? 0) + event.normalizedRows;
  }
  const windowsWithProps = Object.entries(byWindow).filter(([, row]) => row.propRowsFound > 0).map(([bucket]) => bucket);
  return {
    generatedAt,
    propAvailabilityByPregameWindow: byWindow,
    propRowsFoundByBook: byBook,
    propsFoundOnlyForBooks: Object.entries(byBook).filter(([, count]) => count > 0).map(([book]) => book).sort(),
    propsFoundOnlyWithinPregameWindow: windowsWithProps.length === 1 ? windowsWithProps[0] : null,
  };
}

function timingBucket(minutes: number | null): string {
  if (minutes === null) return "unknown";
  if (minutes < -30) return "post_start";
  if (minutes < 0) return "near_start_or_live";
  if (minutes <= 60) return "0_60_min";
  if (minutes <= 180) return "1_3_hours";
  if (minutes <= 360) return "3_6_hours";
  if (minutes <= 720) return "6_12_hours";
  return "12h_plus";
}

function minutesUntil(start: string | null, now: string): number | null {
  if (!start) return null;
  const a = Date.parse(start);
  const b = Date.parse(now);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) / 60_000) : null;
}

function bdlStart(game: BdlDiagnosticGame): string | null {
  return stringOrNull(game.game_date ?? game.date);
}

function bdlTeam(game: BdlDiagnosticGame, side: "home" | "away"): string | null {
  const team = side === "home" ? game.home_team : game.away_team;
  return stringOrNull(record(team).full_name) ?? stringOrNull(record(team).display_name) ?? stringOrNull(record(team).name) ?? stringOrNull(record(team).abbreviation);
}

function etDate(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addOneCalendarDayUTC(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
