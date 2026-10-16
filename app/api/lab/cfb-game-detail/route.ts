import type { NextRequest } from "next/server";

import {
  BETA_SESSION_COOKIE_NAME,
  isValidBetaSession,
} from "@/lib/auth/betaSession";
import {
  WHOP_SESSION_COOKIE_NAME,
  verifyWhopSession,
} from "@/lib/auth/whopSession";
import { populateDailyEdgeStoredSplitFallback } from "@/lib/providers/draftkings/draftKingsNetworkSplits";
import { readResilientCfbMemberFixture } from "@/lib/services/football/cfbMemberReader";

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
  const season = Number(request.nextUrl.searchParams.get("season") ?? process.env.CFB_FORWARD_SEASON ?? "2026");
  if (!gameId || gameId.length > 120 || !/^[a-zA-Z0-9:_-]+$/.test(gameId) || !Number.isInteger(season)) {
    return Response.json({ game: null, availability: null }, { status: 400 });
  }

  const fixture = await readResilientCfbMemberFixture(season).catch(() => null);
  if (!fixture) {
    return Response.json({ game: null, availability: null }, { status: 503 });
  }
  const game = fixture.snapshot.games.find((candidate) => candidate.id === gameId);
  if (!game) {
    return Response.json({ game: null, availability: null }, { status: 404 });
  }

  const detailSnapshot = { ...fixture.snapshot, games: [game] };
  await populateDailyEdgeStoredSplitFallback(detailSnapshot, "cfb");
  const providerGameId = game.id.startsWith("cfb-") ? game.id.slice(4) : game.id;
  const availability = fixture.availability?.[game.id] ?? fixture.availability?.[providerGameId] ?? null;
  return Response.json(
    { game: detailSnapshot.games[0] ?? game, availability },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
