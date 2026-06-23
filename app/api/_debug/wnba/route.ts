/**
 * TEMPORARY preview-only diagnostic — /api/_debug/wnba.
 *
 * Reachable WITHOUT the beta cookie (middleware only gates /api/lab/*), so we
 * can verify exactly what a deployed preview is doing for WNBA without an auth
 * round-trip. Returns the deployed git SHA, env-key PRESENCE (booleans, never
 * values), and the live result of the WNBA model (game count / timing / the
 * actual error if it fails — so an empty slate is never confused with a failed
 * fetch).
 *
 * Hard-disabled on production (VERCEL_ENV==="production" → 404). Remove before
 * any prod launch of WNBA.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const meta = {
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    region: process.env.VERCEL_REGION ?? null,
    env: {
      BALLDONTLIE_API_KEY: !!process.env.BALLDONTLIE_API_KEY,
      SHARPAPI_KEY: !!process.env.SHARPAPI_KEY,
    },
  };

  const t0 = Date.now();
  try {
    const { buildWnbaDailyEdgeAdapted } = await import(
      "@/lib/services/wnba/buildWnbaDailyEdgeAdapted"
    );
    const r = await buildWnbaDailyEdgeAdapted(null);
    return NextResponse.json(
      {
        ...meta,
        wnba: {
          ok: true,
          ms: Date.now() - t0,
          slateState: r.slateState,
          games: r.games.length,
          sample: r.games.slice(0, 3).map((g) => ({
            id: g.id,
            away: g.awayTeam,
            home: g.homeTeam,
            awayLogo: g.awayTeamLogo,
            homeLogo: g.homeTeamLogo,
            ml: g.markets.moneyline.pick,
          })),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        ...meta,
        wnba: {
          ok: false,
          ms: Date.now() - t0,
          error: (e instanceof Error ? e.message : String(e)).slice(0, 400),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
