import { scoreMlbPropSlate } from "../lib/mlb/props/liveScoring";
import { MockMLBProvider } from "../lib/mlb/props/providerClients";
import { buildRealProviderClients, resolveProviderMode } from "../lib/mlb/props/providerFactory";
import { persistMlbPropScore } from "../lib/mlb/props/propPersistence";
import { writeMlbPropsLocalReport, writeMlbPropsRealPaperRunReport } from "../lib/mlb/props/reporting";
import { scoreRealMlbPropsDryRun, scoreRealMlbPropsForPaper } from "../lib/mlb/props/realScoring";
import type { RealPitcherSeasonStat } from "../lib/mlb/props/realScoring";
import { assertRealPaperPersistenceAllowed } from "../lib/mlb/props/paperTrading";
import { BdlClient, BdlNotFoundError } from "../lib/providers/real_api/_bdlClient";
import { createClient } from "@supabase/supabase-js";
import { access } from "fs/promises";
import path from "path";

type Args = {
  command: string;
  date: string;
  provider: string;
  dryRun: boolean;
  persist: boolean;
  maxPages?: number;
};

async function main() {
  const args = parseArgs();
  const mode = resolveProviderMode(args.provider);
  const provider = new MockMLBProvider();
  const asOfTimestamp = `${args.date}T15:00:00.000Z`;
  const output = {
    command: args.command,
    date: args.date,
    provider: mode,
    dryRun: args.dryRun,
    applied: false as boolean,
    timestamp: new Date().toISOString(),
    result: null as unknown,
    persist: args.persist,
  };

  if (mode === "real") {
    if (args.persist) {
      if (args.command !== "score-mlb-prop-slate") {
        throw new Error("Real MLB props paper persistence is only allowed for score-mlb-prop-slate.");
      }
      assertRealPaperPersistenceAllowed({
        providerMode: "real",
        persist: args.persist,
        dryRun: args.dryRun,
      });
    }
    if (args.persist) await assertRealContractInspectionCompleted(args.date);
    const real = buildRealProviderClients();
    output.result = args.persist
      ? await runRealPaperPersist(args.date, asOfTimestamp, real, args.maxPages)
      : await runRealDryRun(args.command, args.date, asOfTimestamp, real, args.maxPages);
    output.applied = args.persist;
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  switch (args.command) {
    case "ingest-mlb-slate":
      output.result = { games: await provider.getGames({ date: args.date }) };
      break;
    case "ingest-mlb-odds":
      output.result = { odds: await provider.getPropOdds({ date: args.date, asOfTimestamp }) };
      break;
    case "ingest-mlb-lineups":
      output.result = { lineups: await provider.getLineups({ date: args.date, asOfTimestamp }) };
      break;
    case "ingest-mlb-injuries":
      output.result = { injuries: await provider.getInjuries({ date: args.date, asOfTimestamp }) };
      break;
    case "ingest-mlb-weather":
      output.result = { weather: await provider.getWeather({ date: args.date, asOfTimestamp }) };
      break;
    case "build-mlb-prop-features":
    case "train-mlb-prop-models":
    case "backtest-mlb-prop-models":
    case "score-mlb-prop-slate":
    case "settle-mlb-props":
    case "publish-mlb-prop-picks":
      output.result = await scoreMlbPropSlate({ provider, date: args.date, asOfTimestamp });
      output.result = {
        scoring: output.result,
        report: await writeMlbPropsLocalReport({ date: args.date, providerMode: mode, scored: output.result as Awaited<ReturnType<typeof scoreMlbPropSlate>> }),
      };
      break;
    default:
      throw new Error(`Unknown MLB props command: ${args.command}`);
  }

  if (args.persist) {
    if (args.dryRun) {
      output.result = { dryRunPersistSkipped: true, preview: output.result };
    } else if (args.command === "score-mlb-prop-slate" || args.command === "publish-mlb-prop-picks") {
      const scored = await scoreMlbPropSlate({ provider, date: args.date, asOfTimestamp });
      output.result = {
        scoring: scored,
        report: await writeMlbPropsLocalReport({ date: args.date, providerMode: mode, scored }),
        persisted: await persistMlbPropScore({
          scored,
          asOfTimestamp,
          source: "mock",
          date: args.date,
          dryRun: args.dryRun,
          paperTrading: false,
        }),
      };
      output.applied = true;
    }
  }

  console.log(JSON.stringify(output, null, 2));
}

async function assertRealContractInspectionCompleted(date: string) {
  if (process.env.ODDSPHERE_PROPS_REAL_CONTRACT_OVERRIDE === "true") return;
  const required = [
    "mlbstats-games.json",
    "mlbstats-probables.json",
    "sharpapi-props.json",
    "balldontlie-games.json",
    "balldontlie-players.json",
    "balldontlie-season-stats.json",
    "playbook-lines.json",
    "playbook-splits.json",
    "playbook-startingPitchers.json",
  ];
  const dir = path.join(process.cwd(), "tmp/mlb-props/provider-samples", date);
  const missing: string[] = [];
  for (const filename of required) {
    try {
      await access(path.join(dir, filename));
    } catch {
      missing.push(filename);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Real MLB props persist blocked: provider contract inspection missing for ${date}. Run npm run inspect:mlb-props-real -- --date=${date}. Missing: ${missing.join(", ")}`);
  }
}

async function runRealDryRun(command: string, date: string, asOfTimestamp: string, real: ReturnType<typeof buildRealProviderClients>, maxPages?: number) {
  switch (command) {
    case "ingest-mlb-slate":
      return { games: await real.mlbStats.getGames({ date }), receivedTimestamp: new Date().toISOString() };
    case "ingest-mlb-odds":
      return { odds: await real.odds.getPropOdds({ date, asOfTimestamp, maxPages }), receivedTimestamp: new Date().toISOString() };
    case "ingest-mlb-lineups":
      return { safeBlocked: true, provider: "playbook", reason: "Playbook MLB lineup/context contract is pending for props real mode." };
    case "ingest-mlb-injuries":
      return { safeBlocked: true, provider: "playbook", reason: "Playbook MLB injury/context contract is pending for props real mode." };
    case "ingest-mlb-weather":
      return real.weather
        ? { weather: await real.weather.getWeather({ date, asOfTimestamp }), receivedTimestamp: new Date().toISOString() }
        : { weather: [], warning: "ODDSPHERE_WEATHER_API_KEY not set or venue mapping unavailable" };
    case "score-mlb-prop-slate":
    case "publish-mlb-prop-picks":
      return summarizeRealPropsDryRun(date, asOfTimestamp, real, maxPages);
    case "settle-mlb-props":
      return reviewRealPaperSettlementDryRun(date);
    default:
      return {
        safeBlocked: true,
        reason: `${command} in real mode is dry-run ingestion only until real provider bundle persistence is promoted.`,
      };
  }
}

async function reviewRealPaperSettlementDryRun(date: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      safeBlocked: true,
      reason: "Supabase env vars are required to review persisted paper props for settlement.",
    };
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const start = `${date}T00:00:00.000Z`;
  const end = `${date}T23:59:59.999Z`;
  const { data, error } = await supabase
    .from("recommended_bets")
    .select("id,recommendation_status,result_status,metadata_json,created_at")
    .eq("recommendation_status", "paper")
    .gte("created_at", start)
    .lte("created_at", end)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return {
    dryRun: true,
    persisted: false,
    provider: "real",
    settlementProvider: "balldontlie",
    paperRecommendationsFound: data?.length ?? 0,
    pending: (data ?? []).filter((row) => !row.result_status || row.result_status === "pending").length,
    settled: (data ?? []).filter((row) => row.result_status === "settled").length,
    unresolved: 0,
    note: "Dry-run review only. Final Ball Don't Lie settlement write path remains disabled until explicitly approved.",
  };
}

async function summarizeRealPropsDryRun(date: string, asOfTimestamp: string, real: ReturnType<typeof buildRealProviderClients>, maxPages?: number) {
  const [games, probables] = await Promise.all([
    real.mlbStats.getGames({ date }),
    real.mlbStats.getProbablePitchers({ date, asOfTimestamp }),
  ]);
  const selectedOdds = await selectRealPropOdds({ date, asOfTimestamp, real, maxPages });
  const seasonStatsByPlayerId = await loadRealPitcherSeasonStats(probables, date, selectedOdds.odds);
  return scoreRealMlbPropsDryRun({
    games,
    probablePitchers: probables,
    odds: selectedOdds.odds,
    date,
    asOfTimestamp,
    seasonStatsByPlayerId,
    providerContext: selectedOdds.providerContext,
  });
}

async function runRealPaperPersist(date: string, asOfTimestamp: string, real: ReturnType<typeof buildRealProviderClients>, maxPages?: number) {
  const [games, probables] = await Promise.all([
    real.mlbStats.getGames({ date }),
    real.mlbStats.getProbablePitchers({ date, asOfTimestamp }),
  ]);
  const selectedOdds = await selectRealPropOdds({ date, asOfTimestamp, real, maxPages });
  const seasonStatsByPlayerId = await loadRealPitcherSeasonStats(probables, date, selectedOdds.odds);
  const bundle = await scoreRealMlbPropsForPaper({
    games,
    probablePitchers: probables,
    odds: selectedOdds.odds,
    date,
    asOfTimestamp,
    seasonStatsByPlayerId,
    providerContext: selectedOdds.providerContext,
  });
  const persisted = await persistMlbPropScore({
    scored: bundle.paperScored,
    asOfTimestamp,
    source: "real",
    date,
    dryRun: false,
    paperTrading: true,
  });
  const report = await writeMlbPropsRealPaperRunReport({
    date,
    summary: bundle.summary,
    recommendationsPersisted: persisted.recommendedBets,
    supabaseWritesCount: persisted.totalWrites,
    runId: persisted.scoringRunId,
  });
  return {
    paperPersisted: true,
    recommendationStatus: "paper",
    publicDisplayEnabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
    realPublishEnabled: process.env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true",
    scoring: bundle.summary,
    persisted,
    report,
  };
}

async function selectRealPropOdds(args: {
  date: string;
  asOfTimestamp: string;
  real: ReturnType<typeof buildRealProviderClients>;
  maxPages?: number;
}) {
  const sharpOdds = await args.real.odds.getPropOdds({
    date: args.date,
    asOfTimestamp: args.asOfTimestamp,
    maxPages: args.maxPages,
  });
  const sharpPlayerPropRows = sharpOdds.length;
  if (sharpPlayerPropRows > 0) {
    return {
      odds: sharpOdds,
      providerContext: {
        selectedOddsProvider: "sharpapi",
        sharpApiPropRows: sharpPlayerPropRows,
        bdlPropRows: 0,
        fallbackReason: null,
      },
    };
  }
  const bdlOdds = await args.real.ballDontLie.getPropOdds({
    date: args.date,
    asOfTimestamp: args.asOfTimestamp,
    maxPages: args.maxPages,
  });
  return {
    odds: bdlOdds,
    providerContext: {
      selectedOddsProvider: bdlOdds.length > 0 ? "balldontlie" : "none",
      sharpApiPropRows: sharpPlayerPropRows,
      bdlPropRows: bdlOdds.length,
      fallbackReason: "SHARPAPI_PLAYER_PROPS_EMPTY",
    },
  };
}

async function loadRealPitcherSeasonStats(
  probables: Awaited<ReturnType<ReturnType<typeof buildRealProviderClients>["mlbStats"]["getProbablePitchers"]>>,
  date: string,
  odds: Array<{ playerId: string; provider?: string; rawPayload?: unknown }> = [],
): Promise<Map<string, RealPitcherSeasonStat>> {
  const out = await loadSupabasePitcherSeasonStats(probables, date);
  const bdl = await loadBallDontLiePitcherSeasonStats(odds, date);
  for (const [playerId, stat] of bdl) out.set(playerId, stat);
  return out;
}

async function loadSupabasePitcherSeasonStats(probables: Awaited<ReturnType<ReturnType<typeof buildRealProviderClients>["mlbStats"]["getProbablePitchers"]>>, date: string): Promise<Map<string, RealPitcherSeasonStat>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Map();
  const externalIds = Array.from(new Set(
    probables
      .map((row) => row.playerId?.replace(/^mlbstats-player-/, ""))
      .filter((id): id is string => Boolean(id)),
  ));
  if (externalIds.length === 0) return new Map();
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id, external_id, provider_ids")
    .or(externalIds.map((id) => `provider_ids->mlb_stats->>id.eq.${id}`).join(","));
  if (playersError || !players) return new Map();
  const internalToExternal = new Map<number, string>();
  const wantedIds = new Set(externalIds);
  for (const row of players as Array<{ id: number; external_id: number | null; provider_ids: unknown }>) {
    const mlbStatsId = readMlbStatsProviderId(row.provider_ids) ?? (row.external_id !== null && wantedIds.has(String(row.external_id)) ? String(row.external_id) : null);
    if (mlbStatsId && wantedIds.has(mlbStatsId)) internalToExternal.set(row.id, `mlbstats-player-${mlbStatsId}`);
  }
  const internalIds = [...internalToExternal.keys()];
  if (internalIds.length === 0) return new Map();
  const season = Number(date.slice(0, 4));
  const { data: stats, error: statsError } = await supabase
    .from("player_season_stats")
    .select("player_id, pitching_gs, pitching_gp, pitching_ip, pitching_k, pitching_k_per_9")
    .eq("season", season)
    .in("player_id", internalIds);
  if (statsError || !stats) return new Map();
  const out = new Map<string, RealPitcherSeasonStat>();
  for (const row of stats as Array<{
    player_id: number;
    pitching_gs: number | null;
    pitching_gp: number | null;
    pitching_ip: number | null;
    pitching_k: number | null;
    pitching_k_per_9: number | null;
  }>) {
    const playerId = internalToExternal.get(row.player_id);
    if (!playerId) continue;
    out.set(playerId, {
      playerId,
      pitchingGs: row.pitching_gs,
      pitchingGp: row.pitching_gp,
      pitchingIp: row.pitching_ip,
      pitchingK: row.pitching_k,
      pitchingKPer9: row.pitching_k_per_9,
    });
  }
  return out;
}

async function loadBallDontLiePitcherSeasonStats(
  odds: Array<{ playerId: string; provider?: string; rawPayload?: unknown }>,
  date: string,
): Promise<Map<string, RealPitcherSeasonStat>> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) return new Map();
  const ids = Array.from(new Set(
    odds
      .filter((row) => row.provider === "balldontlie" || readRecord(row.rawPayload).provider === "balldontlie")
      .map((row) => String(readRecord(row.rawPayload).bdl_player_id ?? row.playerId.replace(/^balldontlie-player-/, "")))
      .filter((id) => /^\d+$/.test(id)),
  ));
  if (ids.length === 0) return new Map();
  const client = new BdlClient(apiKey);
  const season = Number(date.slice(0, 4));
  const out = new Map<string, RealPitcherSeasonStat>();
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    try {
      const rows = await client.fetchAll<Record<string, unknown>>({
        path: "/season_stats",
        query: { season, "player_ids[]": batch, per_page: 100 },
        maxPages: 5,
      });
      for (const row of rows) {
        const playerId = readBdlStatPlayerId(row);
        if (!playerId) continue;
        const stat = parseBdlPitcherSeasonStat(row, playerId);
        if (stat) out.set(stat.playerId, stat);
      }
    } catch (e) {
      if (e instanceof BdlNotFoundError) continue;
      return out;
    }
  }
  return out;
}

function parseBdlPitcherSeasonStat(row: Record<string, unknown>, bdlPlayerId: string): RealPitcherSeasonStat | null {
  const pitchingIp = numberFromAny(row.pitching_ip ?? row.ip ?? row.innings_pitched);
  const pitchingK = numberFromAny(row.pitching_k ?? row.strikeouts ?? row.so);
  const pitchingGp = numberFromAny(row.pitching_gp ?? row.games_pitched ?? row.g);
  const pitchingGs = numberFromAny(row.pitching_gs ?? row.games_started ?? row.gs);
  const pitchingBb = numberFromAny(row.pitching_bb ?? row.walks ?? row.bb);
  const pitchingH = numberFromAny(row.pitching_h ?? row.hits_allowed ?? row.h);
  const pitchingEr = numberFromAny(row.pitching_er ?? row.earned_runs ?? row.er);
  const battersFaced = numberFromAny(row.batters_faced ?? row.pitching_bf ?? row.bf);
  const pitchCount = numberFromAny(row.pitch_count ?? row.pitching_pitch_count ?? row.pitches);
  const kPer9 = numberFromAny(row.pitching_k_per_9 ?? row.k_per_9) ?? (pitchingIp && pitchingK ? (pitchingK * 9) / pitchingIp : null);
  if (pitchingIp === null && pitchingK === null && pitchingGp === null && pitchingGs === null) return null;
  return {
    playerId: `balldontlie-player-${bdlPlayerId}`,
    pitchingGs,
    pitchingGp,
    pitchingIp,
    pitchingK,
    pitchingKPer9: kPer9,
    pitchingBb,
    pitchingH,
    pitchingEr,
    battersFaced,
    pitchCount,
  };
}

function readBdlStatPlayerId(row: Record<string, unknown>): string | null {
  const direct = row.player_id ?? row.playerId;
  if (typeof direct === "number" && Number.isFinite(direct)) return String(direct);
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const player = readRecord(row.player);
  const nested = player.id;
  if (typeof nested === "number" && Number.isFinite(nested)) return String(nested);
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  return null;
}

function numberFromAny(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const match = raw.match(/^(\d+)\.(\d)$/);
  if (match && Number(match[2]) <= 2) return Number(match[1]) + Number(match[2]) / 3;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readMlbStatsProviderId(providerIds: unknown): string | null {
  if (!providerIds || typeof providerIds !== "object") return null;
  const value = (providerIds as { mlb_stats?: { id?: unknown } }).mlb_stats?.id;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const command = argv.find((arg) => !arg.startsWith("--")) ?? "score-mlb-prop-slate";
  const get = (name: string, fallback: string) => {
    const prefix = `--${name}=`;
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
  };
  const maxPagesRaw = get("max-pages", "");
  const maxPages = maxPagesRaw ? Number(maxPagesRaw) : undefined;
  return {
    command,
    date: get("date", "2026-07-07"),
    provider: get("provider", "mock"),
    dryRun: argv.includes("--dry-run") || get("dry-run", "true") !== "false",
    persist: argv.includes("--persist") || get("persist", "false") === "true",
    maxPages: Number.isFinite(maxPages) && maxPages ? maxPages : undefined,
  };
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: serializeError(error) }, null, 2));
  process.exit(1);
});

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    };
  }
  if (typeof error === "object" && error !== null) {
    return error;
  }
  return { message: String(error) };
}
