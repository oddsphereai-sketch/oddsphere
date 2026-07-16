import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { BdlClient } from "../../providers/real_api/_bdlClient";
import { PlaybookClient } from "../../providers/playbook/playbookClient";
import { MockMLBProvider } from "./providerClients";
import { buildRealProviderClients, resolveProviderMode } from "./providerFactory";
import type { MlbPropProviderBundle, PropOddsSnapshot } from "./providers";

export type ProviderInspectionSummary = {
  providerMode: "mock" | "real";
  date: string;
  outputDir: string;
  sources: Array<{
    provider: string;
    functionUsed: string;
    countReturned: number;
    keyFieldsDetected: string[];
    firstGameIds: string[];
    firstPlayerIds: string[];
    marketsDetected: string[];
    oddsBooksDetected: string[];
    timestampsDetected: string[];
    mappingFailures: number;
    unsupportedPayloadFields: string[];
  }>;
  contractChecklist: Array<{ field: string; status: "confirmed" | "unconfirmed"; note: string }>;
  writesToSupabase: false;
};

export async function inspectMlbPropsProviders(args: {
  date: string;
  providerMode?: string;
  outputDir?: string;
}): Promise<ProviderInspectionSummary> {
  const providerMode = resolveProviderMode(args.providerMode);
  const outputDir = args.outputDir ?? path.join(process.cwd(), "tmp/mlb-props/provider-samples", args.date);
  await mkdir(outputDir, { recursive: true });

  if (providerMode === "mock") {
    const provider = new MockMLBProvider();
    const sources = await inspectBundle(provider, args.date, outputDir, "mock");
    return { providerMode, date: args.date, outputDir, sources, contractChecklist: buildContractChecklist(sources, providerMode), writesToSupabase: false };
  }

  const real = buildRealProviderClients();
  const sources: ProviderInspectionSummary["sources"] = [];
  const [games, probables] = await Promise.all([
    real.mlbStats.getGames({ date: args.date }),
    real.mlbStats.getProbablePitchers({ date: args.date }),
  ]);
  await writeRedacted(outputDir, "mlbstats-games.json", games);
  await writeRedacted(outputDir, "mlbstats-probables.json", probables);
  sources.push(summarizeRows("mlbstats", "getGames", games));
  sources.push(summarizeRows("mlbstats", "getProbablePitchers", probables));

  const odds = await real.odds.getPropOdds({ date: args.date });
  await writeRedacted(outputDir, "sharpapi-props.json", odds.slice(0, 50));
  sources.push(summarizeOddsRows("sharpapi", "getPropOdds", odds));
  sources.push(...await inspectBallDontLie(args.date, outputDir));
  sources.push(...await inspectPlaybook(outputDir));

  if (real.weather) {
    try {
      const weather = await real.weather.getWeather({ date: args.date });
      await writeRedacted(outputDir, "weather.json", weather.slice(0, 50));
      sources.push(summarizeRows("weather", "getWeather", weather));
    } catch (error) {
      sources.push({
        provider: "weather",
        functionUsed: "getWeather",
        countReturned: 0,
        keyFieldsDetected: [],
        firstGameIds: [],
        firstPlayerIds: [],
        marketsDetected: [],
        oddsBooksDetected: [],
        timestampsDetected: [],
        mappingFailures: 0,
        unsupportedPayloadFields: [`not_configured:${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }

  return { providerMode, date: args.date, outputDir, sources, contractChecklist: buildContractChecklist(sources, providerMode), writesToSupabase: false };
}

async function inspectBallDontLie(date: string, outputDir: string): Promise<ProviderInspectionSummary["sources"]> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) return [summarizeRows("balldontlie", "missingEnv", [])];
  const client = new BdlClient(apiKey);
  const season = Number(date.slice(0, 4));
  const sources: ProviderInspectionSummary["sources"] = [];
  try {
    const games = await client.fetch<unknown[]>({ path: "/games", query: { "dates[]": [date], per_page: 5 } });
    const gameRows = Array.isArray(games.data) ? games.data : [];
    await writeRedacted(outputDir, "balldontlie-games.json", gameRows.slice(0, 5));
    sources.push(summarizeRows("balldontlie", "getGames", gameRows));
    const sampleGameId = firstId(gameRows);
    const players = await client.fetch<unknown[]>({ path: "/players", query: { per_page: 5 } });
    const playerRows = Array.isArray(players.data) ? players.data : [];
    await writeRedacted(outputDir, "balldontlie-players.json", playerRows.slice(0, 5));
    sources.push(summarizeRows("balldontlie", "getPlayers", playerRows));
    const stats = await client.fetch<unknown[]>({ path: "/season_stats", query: { season, per_page: 5 } });
    const statRows = Array.isArray(stats.data) ? stats.data : [];
    await writeRedacted(outputDir, "balldontlie-season-stats.json", statRows.slice(0, 5));
    sources.push(summarizeRows("balldontlie", "getSeasonStats", statRows));
    if (sampleGameId !== null) {
      const lineups = await client.fetch<unknown[]>({ path: "/lineups", query: { "game_ids[]": [sampleGameId], per_page: 25 } });
      const lineupRows = Array.isArray(lineups.data) ? lineups.data : [];
      await writeRedacted(outputDir, "balldontlie-lineups.json", lineupRows.slice(0, 25));
      sources.push(summarizeRows("balldontlie", "getLineups", lineupRows));
    }
  } catch (error) {
    sources.push({
      provider: "balldontlie",
      functionUsed: "contractInspection",
      countReturned: 0,
      keyFieldsDetected: [],
      firstGameIds: [],
      firstPlayerIds: [],
      marketsDetected: [],
      oddsBooksDetected: [],
      timestampsDetected: [],
      mappingFailures: 0,
      unsupportedPayloadFields: [`error:${error instanceof Error ? error.message : String(error)}`],
    });
  }
  return sources;
}

async function inspectPlaybook(outputDir: string): Promise<ProviderInspectionSummary["sources"]> {
  const apiKey = process.env.PLAYBOOK_API_KEY;
  if (!apiKey) return [summarizeRows("playbook", "missingEnv", [])];
  const client = new PlaybookClient(apiKey);
  const sources: ProviderInspectionSummary["sources"] = [];
  const calls: Array<[string, () => Promise<{ body: unknown }>]> = [
    ["lines", () => client.lines("mlb")],
    ["splits", () => client.splits("mlb")],
    ["startingPitchers", () => client.mlbStartingPitchers()],
    ["injuries", () => client.injuries("mlb")],
    ["venueWeather", () => client.mlbVenueWeather()],
  ];
  for (const [name, call] of calls) {
    try {
      const result = await call();
      const rows = Array.isArray((result.body as { data?: unknown }).data) ? (result.body as { data: unknown[] }).data : [];
      await writeRedacted(outputDir, `playbook-${name}.json`, rows.slice(0, 25));
      sources.push(summarizeRows("playbook", name, rows));
    } catch (error) {
      sources.push({
        provider: "playbook",
        functionUsed: name,
        countReturned: 0,
        keyFieldsDetected: [],
        firstGameIds: [],
        firstPlayerIds: [],
        marketsDetected: [],
        oddsBooksDetected: [],
        timestampsDetected: [],
        mappingFailures: 0,
        unsupportedPayloadFields: [`error:${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }
  return sources;
}

async function inspectBundle(provider: MlbPropProviderBundle, date: string, outputDir: string, name: string) {
  const [games, players, probables, lineups, injuries, weather, odds] = await Promise.all([
    provider.getGames({ date }),
    provider.getPlayers(),
    provider.getProbablePitchers({ date }),
    provider.getLineups({ date }),
    provider.getInjuries({ date }),
    provider.getWeather({ date }),
    provider.getPropOdds({ date }),
  ]);
  await writeRedacted(outputDir, `${name}-games.json`, games);
  await writeRedacted(outputDir, `${name}-players.json`, players);
  await writeRedacted(outputDir, `${name}-probables.json`, probables);
  await writeRedacted(outputDir, `${name}-lineups.json`, lineups);
  await writeRedacted(outputDir, `${name}-injuries.json`, injuries);
  await writeRedacted(outputDir, `${name}-weather.json`, weather);
  await writeRedacted(outputDir, `${name}-odds.json`, odds);
  return [
    summarizeRows(name, "getGames", games),
    summarizeRows(name, "getPlayers", players),
    summarizeRows(name, "getProbablePitchers", probables),
    summarizeRows(name, "getLineups", lineups),
    summarizeRows(name, "getInjuries", injuries),
    summarizeRows(name, "getWeather", weather),
    summarizeOddsRows(name, "getPropOdds", odds),
  ];
}

async function writeRedacted(outputDir: string, filename: string, value: unknown) {
  await writeFile(path.join(outputDir, filename), JSON.stringify(redact(value), null, 2));
}

function summarizeRows(provider: string, functionUsed: string, rows: unknown[]): ProviderInspectionSummary["sources"][number] {
  const objects = rows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
  return {
    provider,
    functionUsed,
    countReturned: rows.length,
    keyFieldsDetected: [...new Set(objects.flatMap((row) => Object.keys(row)))].slice(0, 40),
    firstGameIds: uniq(objects.map((row) => String(row.gameId ?? row.id ?? "")).filter(Boolean)).slice(0, 5),
    firstPlayerIds: uniq(objects.map((row) => String(row.playerId ?? row.id ?? "")).filter(Boolean)).slice(0, 5),
    marketsDetected: [],
    oddsBooksDetected: [],
    timestampsDetected: uniq(objects.flatMap((row) => [row.asOfTimestamp, row.scheduledStart, row.created_at]).map(String).filter((value) => value && value !== "undefined")).slice(0, 5),
    mappingFailures: 0,
    unsupportedPayloadFields: [],
  };
}

function summarizeOddsRows(provider: string, functionUsed: string, rows: PropOddsSnapshot[]): ProviderInspectionSummary["sources"][number] {
  const summary = summarizeRows(provider, functionUsed, rows);
  return {
    ...summary,
    marketsDetected: uniq(rows.map((row) => row.marketKey)).sort(),
    oddsBooksDetected: uniq(rows.map((row) => row.sportsbook)).sort(),
    firstGameIds: uniq(rows.map((row) => row.gameId)).slice(0, 5),
    firstPlayerIds: uniq(rows.map((row) => row.playerId)).slice(0, 5),
    timestampsDetected: uniq(rows.map((row) => row.asOfTimestamp)).slice(0, 5),
    mappingFailures: rows.filter((row) => !row.playerId || !row.sportsbook).length,
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (/key|token|secret|authorization|password/i.test(key)) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = redact(raw);
    }
  }
  return output;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function firstId(rows: unknown[]): string | number | null {
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const value = (row as Record<string, unknown>).id ?? (row as Record<string, unknown>).game_id;
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return null;
}

function buildContractChecklist(
  sources: ProviderInspectionSummary["sources"],
  providerMode: "mock" | "real",
): ProviderInspectionSummary["contractChecklist"] {
  const odds = sources.find((source) => source.provider === "sharpapi" || source.functionUsed === "getPropOdds");
  const probables = sources.find((source) => source.functionUsed === "getProbablePitchers");
  const bdlGames = sources.find((source) => source.provider === "balldontlie" && source.functionUsed === "getGames");
  const bdlPlayers = sources.find((source) => source.provider === "balldontlie" && source.functionUsed === "getPlayers");
  const bdlStats = sources.find((source) => source.provider === "balldontlie" && source.functionUsed === "getSeasonStats");
  const bdlLineups = sources.find((source) => source.provider === "balldontlie" && source.functionUsed === "getLineups");
  const playbookSplits = sources.find((source) => source.provider === "playbook" && source.functionUsed === "splits");
  const playbookLines = sources.find((source) => source.provider === "playbook" && source.functionUsed === "lines");
  const playbookStarters = sources.find((source) => source.provider === "playbook" && source.functionUsed === "startingPitchers");
  const playbookInjuries = sources.find((source) => source.provider === "playbook" && source.functionUsed === "injuries");
  const realOnly = providerMode === "real";
  const bdlStatKeys = bdlStats?.keyFieldsDetected.join(" ").toLowerCase() ?? "";
  return [
    checklist("Sharp API market keys for MLB props", realOnly && !!odds?.marketsDetected.length, odds?.marketsDetected.join(", ") || "not observed"),
    checklist("Sharp API player display format", realOnly && !!odds?.firstPlayerIds.length, odds?.firstPlayerIds[0] ?? "not observed"),
    checklist("Sharp API book names and keys", realOnly && !!odds?.oddsBooksDetected.length, odds?.oddsBooksDetected.join(", ") || "not observed"),
    checklist("Sharp API odds timestamp field", realOnly && !!odds?.timestampsDetected.length, odds?.timestampsDetected.join(", ") || "not observed"),
    checklist("Sharp API line format for pitcher strikeouts and outs", realOnly && !!odds?.marketsDetected.some((market) => market === "pitcher_strikeouts" || market === "pitcher_outs"), odds?.marketsDetected.join(", ") || "not observed"),
    checklist("Sharp API over/under side labels", realOnly && !!odds && odds.mappingFailures === 0 && odds.countReturned > 0, odds ? `rows=${odds.countReturned} mappingFailures=${odds.mappingFailures}` : "not observed"),
    checklist("MLB Stats probable pitcher IDs", realOnly && !!probables?.firstPlayerIds.length, probables?.firstPlayerIds[0] ?? "not observed"),
    checklist("Ball Don't Lie player/team/game IDs", realOnly && !!bdlGames?.countReturned && !!bdlPlayers?.countReturned, `games=${bdlGames?.countReturned ?? 0} players=${bdlPlayers?.countReturned ?? 0}`),
    checklist("Ball Don't Lie pitcher strikeouts/outs settlement fields", realOnly && /pitching_k|innings_pitched|pitching_ip|strikeout/.test(bdlStatKeys), bdlStats?.keyFieldsDetected.join(", ") || "not observed"),
    checklist("Ball Don't Lie batter stat fields", realOnly && /batting_h|batting_2b|batting_3b|batting_hr|batting_tb|batting_sb/.test(bdlStatKeys), bdlStats?.keyFieldsDetected.join(", ") || "not observed"),
    checklist("Ball Don't Lie lineups", realOnly && !!bdlLineups && bdlLineups.countReturned >= 0, `rows=${bdlLineups?.countReturned ?? 0}`),
    checklist("Playbook public betting splits", realOnly && !!playbookSplits?.countReturned, `rows=${playbookSplits?.countReturned ?? 0}`),
    checklist("Playbook consensus lines", realOnly && !!playbookLines?.countReturned, `rows=${playbookLines?.countReturned ?? 0}`),
    checklist("Playbook probable pitchers", realOnly && !!playbookStarters?.countReturned, `rows=${playbookStarters?.countReturned ?? 0}`),
    checklist("Playbook injuries/status values", realOnly && !!playbookInjuries?.countReturned, `rows=${playbookInjuries?.countReturned ?? 0}`),
  ];
}

function checklist(field: string, confirmed: boolean, note: string) {
  return {
    field,
    status: confirmed ? "confirmed" as const : "unconfirmed" as const,
    note,
  };
}
