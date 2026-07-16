import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Check = {
  name: string;
  ok: boolean;
  error?: string;
};

const REQUIRED_TABLES = [
  "sportsbooks",
  "mlb_teams",
  "mlb_players",
  "mlb_games",
  "mlb_probable_pitchers",
  "mlb_lineups",
  "mlb_injuries",
  "mlb_weather",
  "player_game_logs",
  "statcast_pitches",
  "prop_markets",
  "prop_odds_snapshots",
  "prop_results",
  "feature_snapshots",
  "model_versions",
  "prop_predictions",
  "prop_edges",
  "recommended_bets",
  "backtest_runs",
  "backtest_results",
  "data_quality_events",
  "prop_scoring_runs",
  "provider_entity_mappings",
  "prop_settlement_runs",
  "mlb_prop_tracking_entries",
];

const REQUIRED_COLUMNS: Record<string, string[]> = {
  prop_predictions: [
    "model_version_id",
    "market_key",
    "line",
    "side",
    "fair_decimal_odds",
    "fair_american_odds",
    "feature_snapshot_id",
    "prediction_timestamp",
    "explanation_json",
  ],
  recommended_bets: [
    "recommendation_status",
    "published_at",
    "created_at",
    "updated_at",
    "result_status",
    "result_units",
    "clv_status",
    "clv_value",
    "metadata_json",
  ],
  prop_scoring_runs: [
    "odds_provider",
    "stats_provider",
    "context_provider",
    "metadata_json",
    "created_at",
    "completed_at",
  ],
  prop_odds_snapshots: [
    "snapshot_role",
    "provider",
    "raw_payload_json",
    "created_at",
  ],
  mlb_prop_tracking_entries: [
    "tracking_key",
    "slate_date",
    "external_game_id",
    "mlb_player_id",
    "game_start_timestamp",
    "market_key",
    "locked_american_odds",
    "locked_final_probability",
    "tracking_cohort",
    "locked_at",
    "closing_american_odds",
    "clv_status",
    "result_status",
    "result_units",
    "settlement_attempts",
    "metadata_json",
  ],
  prop_settlement_runs: ["metadata_json"],
};

async function main() {
  const args = parseArgs();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(JSON.stringify({
      ok: false,
      error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      writes: false,
    }, null, 2));
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const checks: Check[] = [];
  const target = describeSupabaseTarget(url);
  const infoSchema = await probeInformationSchema(supabase);

  for (const table of REQUIRED_TABLES) {
    const { error } = await supabase.from(table).select("*").limit(1);
    checks.push({
      name: `table:${table}`,
      ok: !error,
      error: error?.message,
    });
  }

  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of columns) {
      const { error } = await supabase.from(table).select(column).limit(1);
      checks.push({
        name: `column:${table}.${column}`,
        ok: !error,
        error: error?.message,
      });
    }
  }

  const missing = checks.filter((check) => !check.ok);
  const missingTables = missing
    .filter((check) => check.name.startsWith("table:"))
    .map((check) => check.name.slice("table:".length));
  const missingColumns = missing
    .filter((check) => check.name.startsWith("column:"))
    .map((check) => check.name.slice("column:".length));
  const output = {
    ok: missing.length === 0,
    date: args.date,
    writes: false,
    supabaseTarget: target,
    credentialMode: {
      anonKeyPresent: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      serviceRoleKeyPresent: true,
      smokeUses: "service_role",
    },
    restTableVisibility: {
      ok: missingTables.length === 0,
      missingTables,
    },
    informationSchema: infoSchema,
    missingTables,
    missingColumns,
    checkedTables: REQUIRED_TABLES.length,
    checkedColumns: Object.values(REQUIRED_COLUMNS).reduce((sum, cols) => sum + cols.length, 0),
    missing,
    checks,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`MLB props DB smoke: ${output.ok ? "OK" : "FAILED"}`);
    for (const check of checks) {
      console.log(`${check.ok ? "✓" : "✗"} ${check.name}${check.error ? ` — ${check.error}` : ""}`);
    }
  }

  if (!output.ok) process.exit(1);
}

function describeSupabaseTarget(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.host;
    const projectRef = host.endsWith(".supabase.co") ? host.split(".")[0] : null;
    return {
      host,
      projectRef: projectRef ? redactMiddle(projectRef) : null,
    };
  } catch {
    return {
      host: "invalid_url",
      projectRef: null,
    };
  }
}

function redactMiddle(value: string): string {
  if (value.length <= 8) return "[redacted]";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function probeInformationSchema(supabase: SupabaseClient) {
  const { error } = await supabase
    .from("information_schema.tables")
    .select("table_schema,table_name")
    .eq("table_schema", "public")
    .limit(1);
  if (error) {
    return {
      available: false,
      error: error.message,
    };
  }
  return {
    available: true,
  };
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback: string) => {
    const prefix = `--${name}=`;
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
  };
  return {
    json: argv.includes("--json"),
    date: get("date", new Date().toISOString().slice(0, 10)),
  };
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    writes: false,
  }, null, 2));
  process.exit(1);
});
