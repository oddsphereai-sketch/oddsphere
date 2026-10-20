import { cronHandler } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import { runCfbMidweekRecoveryAudit } from "@/lib/services/football/cfbMidweekRecoveryAudit";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "cfb_midweek_recovery_audit", async ({ runId }) => {
    const audit = await runCfbMidweekRecoveryAudit({
      client: supabase,
      season: boundedInteger(process.env.CFB_FORWARD_SEASON ?? "2026", 2026, 2100, "CFB_FORWARD_SEASON"),
      now: new Date().toISOString(),
      runId,
      balldontlieApiKey: requiredEnv("BALLDONTLIE_API_KEY"),
      playbookApiKey: requiredEnv("PLAYBOOK_API_KEY"),
      sharpApiKey: requiredEnv("SHARPAPI_KEY"),
      collegeFootballDataApiKey: process.env.CFBD_API_KEY?.trim() || null,
      theOddsApiKey: requiredEnv("THE_ODDS_API_KEY"),
    });
    return {
      records_updated: 0,
      api_calls_made: typeof audit.apiCallsMaximum === "number" ? audit.apiCallsMaximum : 0,
      details: audit,
    };
  }, { sport: "cfb", leaseGroup: "prediction_pipeline", requireLease: true, lockMinutes: 8 });
}

export const POST = GET;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required for the CFB midweek recovery audit.`);
  return value;
}

function boundedInteger(value: string, minimum: number, maximum: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  return parsed;
}
