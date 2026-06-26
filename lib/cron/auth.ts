/**
 * Cron authentication helper.
 *
 * Every cron route handler invokes validateCronAuth() at the top. Vercel's
 * cron infrastructure automatically sends `Authorization: Bearer <CRON_SECRET>`
 * when invoking our `/api/cron/*` routes. Anyone hitting these routes from
 * outside Vercel must supply the same header.
 *
 * Returns a structured result rather than a Response directly so callers
 * can choose to wrap it in JSON or short-circuit with the raw 401 — the
 * cronHandler() wrapper in runCron.ts does the latter.
 *
 * CRON_SECRET is provisioned in .env.local from Phase 1.2; it MUST be
 * present in production env or this helper returns 500.
 */

export type AuthResult =
  | { ok: true }
  | { ok: false; response: Response };

const UNAUTHORIZED_BODY = "Unauthorized";

const CRON_ROUTE_FLAGS: Record<string, { env: string; defaultEnabled: boolean }> = {
  "/api/cron/slate-cycle": { env: "CRON_SLATE_CYCLE_ENABLED", defaultEnabled: true },
  "/api/cron/pregame-sweep": { env: "CRON_PREGAME_SWEEP_ENABLED", defaultEnabled: true },
  "/api/cron/tracking-refresh": { env: "CRON_TRACKING_REFRESH_ENABLED", defaultEnabled: true },
  "/api/cron/cleanup-stream-tables": { env: "CRON_CLEANUP_ENABLED", defaultEnabled: true },
};

function cronRouteEnabled(pathname: string): { enabled: true } | { enabled: false; env: string; reason: string } {
  const cfg = CRON_ROUTE_FLAGS[pathname];
  if (!cfg) return { enabled: true };
  const raw = process.env[cfg.env];
  if (raw === undefined || raw === "") {
    return cfg.defaultEnabled
      ? { enabled: true }
      : { enabled: false, env: cfg.env, reason: `${cfg.env} missing; default disabled` };
  }
  if (raw === "false") {
    return { enabled: false, env: cfg.env, reason: `${cfg.env}=false` };
  }
  if (raw === "true") return { enabled: true };
  return cfg.defaultEnabled
    ? { enabled: true }
    : { enabled: false, env: cfg.env, reason: `${cfg.env} is not true; default disabled` };
}

export function validateCronAuth(request: Request): AuthResult {
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return {
      ok: false,
      response: new Response(
        "Server misconfiguration: CRON_SECRET not set",
        { status: 500 }
      ),
    };
  }
  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return {
      ok: false,
      response: new Response(UNAUTHORIZED_BODY, { status: 401 }),
    };
  }
  if (process.env.ODDSPHERE_CRONS_DISABLED === "true") {
    return {
      ok: false,
      response: Response.json(
        {
          ok: true,
          skipped: true,
          disabled: true,
          reason: "ODDSPHERE_CRONS_DISABLED=true",
          path: url.pathname,
        },
        { status: 200 },
      ),
    };
  }
  const routeFlag = cronRouteEnabled(url.pathname);
  if (!routeFlag.enabled) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: true,
          skipped: true,
          disabled: true,
          reason: routeFlag.reason,
          env_flag: routeFlag.env,
          path: url.pathname,
        },
        { status: 200 },
      ),
    };
  }
  return { ok: true };
}
