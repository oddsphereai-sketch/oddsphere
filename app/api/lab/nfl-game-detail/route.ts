import type { NextRequest } from "next/server";

import {
  BETA_SESSION_COOKIE_NAME,
  isValidBetaSession,
} from "@/lib/auth/betaSession";
import {
  WHOP_SESSION_COOKIE_NAME,
  verifyWhopSession,
} from "@/lib/auth/whopSession";
import { readCachedNflMemberFixture } from "@/lib/services/football/nflMemberReader";
import { resolveNflForwardWeek } from "@/lib/services/football/nflForwardWeekSelection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function hasMemberSession(request: NextRequest): Promise<boolean> {
  const whopCookie = request.cookies.get(WHOP_SESSION_COOKIE_NAME)?.value;
  if (await verifyWhopSession(whopCookie)) return true;
  const betaCookie = request.cookies.get(BETA_SESSION_COOKIE_NAME)?.value;
  return isValidBetaSession(betaCookie);
}

export async function GET(request: NextRequest) {
  if (!await hasMemberSession(request)) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }

  const gameId = request.nextUrl.searchParams.get("game")?.trim() ?? "";
  const season = Number(request.nextUrl.searchParams.get("season") ?? process.env.NFL_FORWARD_SEASON ?? "2026");
  const configuredWeek = Number(request.nextUrl.searchParams.get("week") ?? process.env.NFL_FORWARD_WEEK ?? "1");
  if (!gameId || gameId.length > 120 || !/^[a-zA-Z0-9:_-]+$/.test(gameId) ||
    !Number.isInteger(season) || season < 2026 || season > 2100 ||
    !Number.isInteger(configuredWeek) || configuredWeek < 1 || configuredWeek > 18) {
    return Response.json({ game: null, availability: null }, { status: 400 });
  }
  const week = resolveNflForwardWeek({ season, configuredWeek });

  const fixture = await readCachedNflMemberFixture(season, week).catch(() => null);
  if (!fixture) {
    return Response.json({ game: null, availability: null }, { status: 503 });
  }
  const game = fixture.snapshot.games.find((candidate) => candidate.id === gameId);
  if (!game) {
    return Response.json({ game: null, availability: null }, { status: 404 });
  }

  return Response.json(
    { game, availability: fixture.availability?.[game.id] ?? null },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
