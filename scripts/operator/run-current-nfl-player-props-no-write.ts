import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runNflPlayerPropsProductionWriter } from "../../lib/services/football/nflPlayerPropsProductionWriter";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const season = Number(argument("season") ?? 2026);
  const week = Number(argument("week") ?? 2);
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const result = await runNflPlayerPropsProductionWriter({
    client: createClient(url, serviceKey, { auth: { persistSession: false } }),
    season,
    week,
    now: new Date().toISOString(),
    apply: false,
    ballDontLieApiKey: requiredEnv("BALLDONTLIE_API_KEY"),
    sharpApiKey: process.env.SHARPAPI_KEY,
  });
  console.log(JSON.stringify({ readOnly: true, season, week, ...result }, null, 2));
}

function argument(name: string): string | null { return process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? null; }
function requiredEnv(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }

void main().catch((error) => { console.error(error); process.exitCode = 1; });
