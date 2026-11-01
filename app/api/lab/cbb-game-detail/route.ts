import type { NextRequest } from "next/server";
import { loadPublishedDailyEdgeSnapshot } from "@/app/dev/experience-preview/previewData";
import { BETA_SESSION_COOKIE_NAME, isValidBetaSession } from "@/lib/auth/betaSession";
import { WHOP_SESSION_COOKIE_NAME, verifyWhopSession } from "@/lib/auth/whopSession";
import { CBB_ACTIVATION } from "@/lib/cbb/releases";
import { overlayCbbLockedMemberGames } from "@/lib/services/cbb/cbbMemberReader";
import { overlayCbbReaderMarketEvidence } from "@/lib/services/cbb/cbbReaderMarketEvidence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  if (!await verifyWhopSession(request.cookies.get(WHOP_SESSION_COOKIE_NAME)?.value) &&
      !await isValidBetaSession(request.cookies.get(BETA_SESSION_COOKIE_NAME)?.value)) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }
  const gameId = request.nextUrl.searchParams.get("game")?.trim() ?? "";
  if (!gameId || gameId.length > 120 || !/^[a-zA-Z0-9:_-]+$/.test(gameId)) {
    return Response.json({ game: null }, { status: 400 });
  }
  if (!CBB_ACTIVATION.memberPublication) return Response.json({ game: null }, { status: 404 });
  try {
    const board = await loadPublishedDailyEdgeSnapshot("cbb");
    const indexed = board.games.find(game => game.id === gameId);
    if (!indexed) return Response.json({ game: null }, { status: 404 });
    // Read the immutable member record before any optional display overlay.
    const locked = await overlayCbbLockedMemberGames({ ...board, games: [indexed] });
    const context = { ...board, games: board.games.map(game => game.id === gameId ? locked.games[0]! : game) };
    const detail = await overlayCbbReaderMarketEvidence(context, { gameIds: [gameId] });
    return Response.json({ game: detail.games.find(game => game.id === gameId) },
      { headers: { "Cache-Control": "private, max-age=15" } });
  } catch (error) {
    console.warn("CBB member detail read failed", error instanceof Error ? error.message : String(error));
    return Response.json({ game: null }, { status: 503 });
  }
}
