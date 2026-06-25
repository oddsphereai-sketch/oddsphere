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

export function validateCronAuth(request: Request): AuthResult {
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
          path: new URL(request.url).pathname,
        },
        { status: 200 },
      ),
    };
  }
  return { ok: true };
}
