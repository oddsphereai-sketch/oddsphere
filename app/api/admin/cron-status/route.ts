/**
 * GET /api/admin/cron-status
 *
 * Production monitoring endpoint — surfaces the latest data_refresh_log row
 * per known cron source, plus derived health state (live / stale / error /
 * unknown). Powers the /admin/cron-status dashboard page.
 *
 * Mirrors the canonical CRON_CONFIGS list from /api/lab/refresh-status so
 * one source of truth covers both the member-facing RefreshIndicator and
 * the admin dashboard. Difference: this endpoint always returns every
 * known cron (cross-sport + per-sport for MLB) — admin needs the full
 * picture, not just frontline.
 *
 * Auth: admin allowlist (same gate as the upload UI).
 */

import { supabase } from "@/lib/db/supabase";
import { validateAdminAuth } from "@/lib/auth/admin";
import type { Sport } from "@/lib/types/domain/Sport";

type CronCfg = {
  data_source: string;
  per_sport: boolean;
  cadence_minutes: number;
  /** Human-readable label for the table. */
  display_name: string;
  /** Schedule string echoed from vercel.json for the dashboard. */
  schedule: string;
};

const CRON_CONFIGS: CronCfg[] = [
  // R-19 Phase 5g.2 — Slate-cycle automation is the cron data_source label
  // written by /api/cron/slate-cycle (cronHandlerPerSport's data_source
  // argument). Added so the dashboard surfaces the Phase 5g schedule's
  // last_started_at / last_status / records_updated for monitoring.
  // Cadence 120 min reflects the 2-hour interval between scheduled fires
  // (3 morning + 6 intraday entries). Schedule string echoes the vercel.json
  // entries so the operator can verify what's actually scheduled.
  { data_source: "slate_cycle_automation", per_sport: true,  cadence_minutes: 120,   display_name: "Slate-cycle automation", schedule: "Every 2hrs · 4 AM–8 PM ET · morning + intraday split" },
  { data_source: "morning_slate",       per_sport: true,  cadence_minutes: 1440,  display_name: "Morning slate refresh",  schedule: "8am ET daily" },
  { data_source: "daily_refresh",       per_sport: true,  cadence_minutes: 1440,  display_name: "Daily refresh",          schedule: "4am ET daily" },
  { data_source: "midday_refresh",      per_sport: true,  cadence_minutes: 1440,  display_name: "Midday refresh",         schedule: "12pm ET daily" },
  { data_source: "afternoon_refresh",   per_sport: true,  cadence_minutes: 1440,  display_name: "Afternoon refresh",      schedule: "4pm ET daily" },
  { data_source: "evening_refresh",     per_sport: true,  cadence_minutes: 1440,  display_name: "Evening refresh",        schedule: "7pm ET daily" },
  { data_source: "lineup_watch",        per_sport: true,  cadence_minutes: 30,    display_name: "Lineup watch",           schedule: "Every 30m · 6–10pm ET" },
  { data_source: "pregame_sweep",       per_sport: true,  cadence_minutes: 15,    display_name: "Pre-game sweep",         schedule: "Every 15m · final 90m" },
  { data_source: "post_game_results",   per_sport: false, cadence_minutes: 1440,  display_name: "Post-game results",      schedule: "1am ET daily" },
  { data_source: "weekly_park_factors", per_sport: false, cadence_minutes: 10080, display_name: "Weekly park factors",    schedule: "Mondays · 4am ET" },
  { data_source: "weekly_calibration",  per_sport: false, cadence_minutes: 10080, display_name: "Weekly calibration",     schedule: "Sundays · 3am ET" },
  { data_source: "daniel_scores_model", per_sport: true,  cadence_minutes: 1440,  display_name: "Scores model upload",    schedule: "Manual · Daniel" },
];

const IN_PROGRESS_WINDOW_MS = 5 * 60 * 1000;

type LogRow = {
  refresh_started_at: string;
  refresh_completed_at: string | null;
  refresh_status: "success" | "partial" | "failed" | "in_progress";
  records_updated: number | null;
  scheduled_next_refresh: string | null;
};

type SourceState = "live" | "updating" | "stale" | "error" | "unknown";

type SourceStatus = {
  data_source: string;
  display_name: string;
  schedule: string;
  sport: Sport | null;
  cadence_minutes: number;
  last_started_at: string | null;
  last_completed_at: string | null;
  last_status: LogRow["refresh_status"] | null;
  records_updated: number | null;
  age_minutes: number | null;
  state: SourceState;
};

async function loadLatest(data_source: string, sport: Sport | null): Promise<{ latest: LogRow | null; active: LogRow | null }> {
  // Latest completed run.
  let qCompleted = supabase
    .from("data_refresh_log")
    .select("refresh_started_at, refresh_completed_at, refresh_status, records_updated, scheduled_next_refresh")
    .eq("data_source", data_source)
    .neq("refresh_status", "in_progress")
    .order("refresh_started_at", { ascending: false })
    .limit(1);
  qCompleted = sport === null ? qCompleted.is("sport", null) : qCompleted.eq("sport", sport);
  const { data: completed } = await qCompleted;
  const latest = ((completed ?? []) as LogRow[])[0] ?? null;

  // Active in-progress (within 5min).
  const threshold = new Date(Date.now() - IN_PROGRESS_WINDOW_MS).toISOString();
  let qActive = supabase
    .from("data_refresh_log")
    .select("refresh_started_at, refresh_completed_at, refresh_status, records_updated, scheduled_next_refresh")
    .eq("data_source", data_source)
    .eq("refresh_status", "in_progress")
    .gte("refresh_started_at", threshold)
    .order("refresh_started_at", { ascending: false })
    .limit(1);
  qActive = sport === null ? qActive.is("sport", null) : qActive.eq("sport", sport);
  const { data: activeRows } = await qActive;
  const active = ((activeRows ?? []) as LogRow[])[0] ?? null;

  return { latest, active };
}

function deriveState(
  cfg: CronCfg,
  now: Date,
  latest: LogRow | null,
  active: LogRow | null
): SourceState {
  if (active) return "updating";
  if (!latest) return "unknown";
  if (latest.refresh_status === "failed") return "error";
  if (!latest.refresh_completed_at) return "unknown";
  const ageMs = now.getTime() - new Date(latest.refresh_completed_at).getTime();
  const ageMinutes = ageMs / 60_000;
  if (ageMinutes > cfg.cadence_minutes * 2) return "stale";
  return "live";
}

export async function GET(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const sources: SourceStatus[] = [];

  for (const cfg of CRON_CONFIGS) {
    // Per-sport crons report MLB only in V1 (the only live sport). Cross-sport
    // crons (post-game, weekly_*) use sport=null.
    const sport: Sport | null = cfg.per_sport ? "mlb" : null;
    const { latest, active } = await loadLatest(cfg.data_source, sport);
    const ageMinutes = latest?.refresh_completed_at
      ? (now.getTime() - new Date(latest.refresh_completed_at).getTime()) / 60_000
      : null;
    sources.push({
      data_source: cfg.data_source,
      display_name: cfg.display_name,
      schedule: cfg.schedule,
      sport,
      cadence_minutes: cfg.cadence_minutes,
      last_started_at: active?.refresh_started_at ?? latest?.refresh_started_at ?? null,
      last_completed_at: latest?.refresh_completed_at ?? null,
      last_status: active ? "in_progress" : latest?.refresh_status ?? null,
      records_updated: latest?.records_updated ?? null,
      age_minutes: ageMinutes,
      state: deriveState(cfg, now, latest, active),
    });
  }

  // Sort: errors first, then stale, then updating, then live, then unknown.
  // Within each bucket, oldest first so the most-out-of-date catches the eye.
  const STATE_ORDER: Record<SourceState, number> = {
    error: 0, stale: 1, updating: 2, live: 3, unknown: 4,
  };
  sources.sort((a, b) => {
    if (STATE_ORDER[a.state] !== STATE_ORDER[b.state]) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
    const ageA = a.age_minutes ?? Number.MAX_SAFE_INTEGER;
    const ageB = b.age_minutes ?? Number.MAX_SAFE_INTEGER;
    return ageB - ageA;
  });

  return Response.json({
    as_of: now.toISOString(),
    sources,
  });
}
