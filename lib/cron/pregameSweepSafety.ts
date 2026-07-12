import type { Sport } from "@/lib/types/domain/Sport";

/**
 * Env var operator sets when pregame-sweep is scheduled in vercel.json
 * and intended to perform writes. Strict equality with "true".
 */
export const PREGAME_SWEEP_CRON_ACTIVE_ENV = "PREGAME_SWEEP_CRON_ACTIVE";

/**
 * Load-control mode for scheduled T-60 checks. When true, the route does only
 * lock lifecycle work and skips the expensive slate-wide refresh.
 */
export const PREGAME_SWEEP_LOCK_ONLY_ENV = "PREGAME_SWEEP_LOCK_ONLY";

/**
 * Env var for dry-run mode, alternative to ?dryRun=true query param.
 */
export const PREGAME_SWEEP_DRY_RUN_ENV = "PREGAME_SWEEP_DRY_RUN";

export function isPregameSweepDryRun(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("dryRun") === "true") return true;
  } catch {
    // Malformed URL: fall through to env check.
  }
  return env[PREGAME_SWEEP_DRY_RUN_ENV] === "true";
}

export function isPregameSweepGateActive(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[PREGAME_SWEEP_CRON_ACTIVE_ENV] === "true";
}

export function isPregameSweepLockOnly(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("lockOnly") === "true") return true;
  } catch {
    // Malformed URL: fall through to env check.
  }
  return env[PREGAME_SWEEP_LOCK_ONLY_ENV] === "true";
}

export function buildPregameSweepBlockedDetails(opts: {
  sport: Sport;
  date: string;
}): Record<string, unknown> {
  return {
    blocked: true,
    reason:
      `${PREGAME_SWEEP_CRON_ACTIVE_ENV} env var must be 'true' for non-dry-run ` +
      `cron execution. Pass ?dryRun=true to invoke in read-only mode.`,
    env_flag_required: PREGAME_SWEEP_CRON_ACTIVE_ENV,
    dry_run: false,
    pregame_sweep_active: false,
    sport: opts.sport,
    date: opts.date,
  };
}
