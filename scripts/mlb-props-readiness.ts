import { createClient } from "@supabase/supabase-js";
import { diagnoseBallDontLieMlbPropsAvailability } from "../lib/mlb/props/ballDontLiePropsDiagnostics";
import { MLBStatsAPIClient } from "../lib/mlb/props/providerClients";
import { diagnoseSharpApiMlbPropsAvailability } from "../lib/mlb/props/sharpApiAvailabilityDiagnostics";
import { resolveProviderMode } from "../lib/mlb/props/providerFactory";

type ReadinessCheck = {
  name: string;
  ok: boolean;
  status: "ready" | "pending" | "blocked" | "warning";
  detail?: string;
};

async function main() {
  const args = parseArgs();
  const checks: ReadinessCheck[] = [];
  const env = process.env;
  const providerMode = resolveProviderMode(args.provider);
  const keys = {
    sharpapi: Boolean(env.SHARPAPI_KEY),
    ballDontLie: Boolean(env.BALLDONTLIE_API_KEY),
    playbook: Boolean(env.PLAYBOOK_API_KEY),
    supabaseUrl: Boolean(env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseServiceRole: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
  };

  checks.push({
    name: "provider_mode",
    ok: providerMode === "real",
    status: providerMode === "real" ? "ready" : "warning",
    detail: `requested=${args.provider}; resolved=${providerMode}`,
  });
  checks.push({
    name: "env_keys",
    ok: keys.sharpapi && keys.ballDontLie && keys.playbook && keys.supabaseUrl && keys.supabaseServiceRole,
    status: keys.sharpapi && keys.ballDontLie && keys.playbook && keys.supabaseUrl && keys.supabaseServiceRole ? "ready" : "blocked",
    detail: missingKeys(keys).length === 0 ? "required keys present" : `missing: ${missingKeys(keys).join(", ")}`,
  });

  const flags = {
    publicDisplayEnabled: env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
    publicApiEnabled: env.ODDSPHERE_PROPS_PUBLIC_API_ENABLED === "true",
    realPublishEnabled: env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true",
    paperTradingEnabled: env.ODDSPHERE_PROPS_PAPER_TRADING_ENABLED === "true",
  };
  const publicFlagsSafe = !flags.publicDisplayEnabled && !flags.publicApiEnabled && !flags.realPublishEnabled;
  checks.push({
    name: "public_publish_flags",
    ok: publicFlagsSafe,
    status: publicFlagsSafe ? "ready" : "blocked",
    detail: JSON.stringify(flags),
  });
  checks.push({
    name: "paper_flag_for_readiness",
    ok: !flags.paperTradingEnabled,
    status: flags.paperTradingEnabled ? "warning" : "ready",
    detail: flags.paperTradingEnabled ? "paper trading should remain off until the explicit persist command" : "paper trading disabled",
  });

  const dbSmoke = await smokeDb();
  checks.push({
    name: "db_smoke",
    ok: dbSmoke.ok,
    status: dbSmoke.ok ? "ready" : "blocked",
    detail: dbSmoke.detail,
  });

  let games: Awaited<ReturnType<MLBStatsAPIClient["getGames"]>> = [];
  let probables: Awaited<ReturnType<MLBStatsAPIClient["getProbablePitchers"]>> = [];
  if (keys.sharpapi && keys.ballDontLie) {
    const mlbStats = new MLBStatsAPIClient();
    try {
      [games, probables] = await Promise.all([
        mlbStats.getGames({ date: args.date }),
        mlbStats.getProbablePitchers({ date: args.date, asOfTimestamp: `${args.date}T15:00:00.000Z` }),
      ]);
      checks.push({
        name: "mlb_schedule",
        ok: games.length > 0,
        status: games.length > 0 ? "ready" : "pending",
        detail: `${games.length} game(s) found`,
      });
      checks.push({
        name: "probable_pitchers",
        ok: probables.filter((row) => row.playerId).length > 0,
        status: probables.filter((row) => row.playerId).length > 0 ? "ready" : "pending",
        detail: `${probables.filter((row) => row.playerId).length}/${Math.max(1, probables.length)} probable pitcher entries populated`,
      });
    } catch (error) {
      checks.push({
        name: "mlb_schedule",
        ok: false,
        status: "blocked",
        detail: errorMessage(error),
      });
    }
  }

  const sharpapi = keys.sharpapi
    ? await safeSharpDiagnostic(args.date)
    : null;
  if (sharpapi) {
    checks.push({
      name: "sharpapi_events",
      ok: sharpapi.eventsFound > 0,
      status: sharpapi.eventsFound > 0 ? "ready" : "pending",
      detail: `${sharpapi.eventsFound} event(s), ${sharpapi.propRowsFound} prop row(s), blocker=${sharpapi.blockerReason}`,
    });
    checks.push({
      name: "sharpapi_props",
      ok: sharpapi.propRowsFound > 0,
      status: sharpapi.propRowsFound > 0 ? "ready" : "pending",
      detail: sharpapi.propRowsFound > 0 ? "props available" : "props pending; not an error before the market window",
    });
  }

  const bdl = keys.ballDontLie
    ? await safeBdlDiagnostic(args.date)
    : null;
  if (bdl) {
    checks.push({
      name: "bdl_games",
      ok: bdl.gamesFound > 0,
      status: bdl.gamesFound > 0 ? "ready" : "pending",
      detail: `${bdl.gamesFound} BDL game(s), ${bdl.normalizedRows} normalized prop row(s), blocker=${bdl.blockerReason}`,
    });
    checks.push({
      name: "bdl_props",
      ok: bdl.normalizedRows > 0,
      status: bdl.normalizedRows > 0 ? "ready" : "pending",
      detail: bdl.normalizedRows > 0 ? "props available" : "props pending; not an error before the market window",
    });
  }

  checks.push({
    name: "playbook_context",
    ok: keys.playbook,
    status: keys.playbook ? "warning" : "pending",
    detail: keys.playbook ? "key present; props engine currently treats Playbook as optional context/contract-pending" : "PLAYBOOK_API_KEY missing",
  });

  const blocked = checks.filter((check) => check.status === "blocked");
  const propsAvailable = (sharpapi?.propRowsFound ?? 0) > 0 || (bdl?.normalizedRows ?? 0) > 0;
  const ready = blocked.length === 0 && games.length > 0 && propsAvailable && publicFlagsSafe;
  const output = {
    ok: true,
    ready,
    status: ready ? "ready" : blocked.length > 0 ? "not_ready" : "pending",
    date: args.date,
    writesToSupabase: false,
    providerMode,
    checks,
    summary: {
      nextSlateGamesFound: games.length,
      probablePitchersAvailable: probables.filter((row) => row.playerId).length,
      bdlGamesFound: bdl?.gamesFound ?? null,
      bdlPropsStatus: (bdl?.normalizedRows ?? 0) > 0 ? "available" : bdl ? "pending" : "not_checked",
      bdlPitcherStrikeoutRows: bdl?.pitcherStrikeoutRows ?? null,
      bdlPitcherOutsRows: bdl?.pitcherOutsRows ?? null,
      sharpapiEventsFound: sharpapi?.eventsFound ?? null,
      sharpapiPropsStatus: (sharpapi?.propRowsFound ?? 0) > 0 ? "available" : sharpapi ? "pending" : "not_checked",
      sharpapiPitcherStrikeoutRows: sharpapi?.pitcherStrikeoutRows ?? null,
      sharpapiPitcherOutsRows: sharpapi?.pitcherOutsRows ?? null,
      publicDisplayDisabled: !flags.publicDisplayEnabled,
      publicApiDisabled: !flags.publicApiEnabled,
      realPublishDisabled: !flags.realPublishEnabled,
      paperPersistenceDisabled: !flags.paperTradingEnabled,
      noSupabaseWrites: true,
    },
    nextCommands: {
      nowReadiness: `npm run readiness:mlb-props -- --date=${args.date}`,
      thursdayMorningSharp: `npm run diagnose:mlb-props-provider -- --date=${args.date} --provider=sharpapi --deep --discover-markets`,
      thursdayMorningBdl: `npm run diagnose:mlb-props-provider -- --date=${args.date} --provider=balldontlie --deep`,
      pregameDryRun: `npm run score:mlb-props -- --date=${args.date} --provider=real --dry-run`,
      hiddenPaperPersistAfterCleanDryRun: `ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=true ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false ODDSPHERE_PROPS_DISPLAY_ENABLED=false ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false npm run score:mlb-props -- --date=${args.date} --provider=real --persist --dry-run=false`,
      postgameSettlementDryRun: `npm run settle-mlb-props -- --date=${args.date} --provider=real --dry-run`,
    },
    remainingBlockers: checks
      .filter((check) => check.status === "blocked" || check.status === "pending")
      .map((check) => `${check.name}: ${check.detail ?? check.status}`),
  };

  console.log(JSON.stringify(output, null, 2));
  if (blocked.length > 0) process.exit(1);
}

async function safeSharpDiagnostic(date: string): Promise<{
  eventsFound: number;
  propRowsFound: number;
  pitcherStrikeoutRows: number;
  pitcherOutsRows: number;
  blockerReason: string;
} | null> {
  try {
    const report = await diagnoseSharpApiMlbPropsAvailability({ date, maxEvents: 3, maxPages: 1, maxMarkets: 8 });
    return {
      eventsFound: report.summary.eventsFound,
      propRowsFound: report.summary.propRowsFound,
      pitcherStrikeoutRows: report.summary.propRowsFoundByMarket.pitcher_strikeouts ?? 0,
      pitcherOutsRows: report.summary.propRowsFoundByMarket.pitcher_outs ?? 0,
      blockerReason: report.summary.blockerReason,
    };
  } catch (error) {
    return {
      eventsFound: 0,
      propRowsFound: 0,
      pitcherStrikeoutRows: 0,
      pitcherOutsRows: 0,
      blockerReason: errorMessage(error),
    };
  }
}

async function safeBdlDiagnostic(date: string): Promise<{
  gamesFound: number;
  normalizedRows: number;
  pitcherStrikeoutRows: number;
  pitcherOutsRows: number;
  blockerReason: string;
} | null> {
  try {
    const report = await diagnoseBallDontLieMlbPropsAvailability({ date, maxPages: 2 });
    return {
      gamesFound: report.bdlGamesFound,
      normalizedRows: report.normalizedRows,
      pitcherStrikeoutRows: report.pitcherStrikeoutRows,
      pitcherOutsRows: report.pitcherOutsRows,
      blockerReason: report.summary.blockerReason,
    };
  } catch (error) {
    return {
      gamesFound: 0,
      normalizedRows: 0,
      pitcherStrikeoutRows: 0,
      pitcherOutsRows: 0,
      blockerReason: errorMessage(error),
    };
  }
}

async function smokeDb(): Promise<{ ok: boolean; detail: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, detail: "missing Supabase URL or service role key" };
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const tables = ["prop_scoring_runs", "recommended_bets", "prop_predictions", "prop_odds_snapshots"];
  const missing: string[] = [];
  for (const table of tables) {
    const { error } = await supabase.from(table).select("*").limit(1);
    if (error) missing.push(`${table}: ${error.message}`);
  }
  return missing.length === 0
    ? { ok: true, detail: `${tables.length} core props tables visible` }
    : { ok: false, detail: missing.join("; ") };
}

function missingKeys(keys: Record<string, boolean>): string[] {
  return Object.entries(keys).filter(([, present]) => !present).map(([name]) => name);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback: string) => {
    const prefix = `--${name}=`;
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
  };
  return {
    date: get("date", "2026-07-16"),
    provider: get("provider", "real"),
  };
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    ready: false,
    status: "not_ready",
    writesToSupabase: false,
    error: errorMessage(error),
  }, null, 2));
  process.exit(1);
});
