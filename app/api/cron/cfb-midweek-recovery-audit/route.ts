import { cronHandler } from "@/lib/cron/runCron";
import { validateCronAuth } from "@/lib/cron/auth";
import { supabase } from "@/lib/db/supabase";
import { CFB_MIDWEEK_RECOVERY_AUDIT_SNAPSHOT_KEY, runCfbMidweekRecoveryAudit } from "@/lib/services/football/cfbMidweekRecoveryAudit";
import { readLatestLabResponseSnapshot } from "@/lib/services/labResponseSnapshots";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  if (new URL(request.url).searchParams.get("read") === "1") {
    const auth = validateCronAuth(request);
    if (!auth.ok) return auth.response;
    const snapshot = await readLatestLabResponseSnapshot<Record<string, unknown>>(CFB_MIDWEEK_RECOVERY_AUDIT_SNAPSHOT_KEY);
    return snapshot
      ? Response.json({ ok: true, generatedAt: snapshot.generatedAt, audit: snapshot.payload })
      : Response.json({ ok: false, error: "CFB midweek recovery audit result is unavailable." }, { status: 404 });
  }
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
