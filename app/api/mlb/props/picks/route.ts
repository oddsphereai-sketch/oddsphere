import { loadCachedLatestMlbPropsDisplaySnapshot } from "@/lib/mlb/props/boardSnapshotStore";
import { easternSlateDate, mlbPropsSnapshotIsFresh } from "@/lib/mlb/props/liveBoard";
import {
  buildMlbPropsMemberBoardData,
  buildMlbPropsScopedMemberBoardData,
  type MlbPropsMemberBoardScope,
} from "@/lib/mlb/props/memberPayload";
import { getPublicPicksMode } from "@/lib/mlb/props/publicPicksSafety";
import { loadMlbPropsMemberBoardSnapshot } from "@/lib/mlb/props/memberReadSnapshotStore";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");
  const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : easternSlateDate();
  const publicMode = getPublicPicksMode();
  if (publicMode.mode === "disabled") {
    return Response.json({
      ok: false,
      mode: "disabled",
      date,
      board: null,
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  const full = url.searchParams.get("full") === "true";
  const marketParam = url.searchParams.get("market");
  const familyParam = url.searchParams.get("family");
  const gameIdParam = url.searchParams.get("game_id");
  const scope: MlbPropsMemberBoardScope = {
    market: marketParam && /^[a-z0-9_]{1,64}$/.test(marketParam) ? marketParam : undefined,
    family: familyParam === "pitcher" || familyParam === "batter" || familyParam === "milestone"
      ? familyParam
      : undefined,
    gameId: gameIdParam && gameIdParam.length <= 128 ? gameIdParam : undefined,
  };
  const scoped = full || Boolean(scope.market || scope.family || scope.gameId);
  {
    // The compact member snapshot is rewritten on every fast refresh. Full
    // shards intentionally are not, so never serve them for a scoped member
    // request: doing so can roll current odds back to an older full refresh.
    const memberSnapshot = scoped
      ? null
      : await loadMlbPropsMemberBoardSnapshot(date).catch(() => null);
    if (memberSnapshot) {
      return Response.json({
        ok: true,
        mode: "display_enabled",
        date,
        snapshotId: memberSnapshot.snapshotId,
        asOfTimestamp: memberSnapshot.asOfTimestamp,
        board: memberSnapshot.data,
      }, { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" } });
    }
  }
  const snapshot = await loadCachedLatestMlbPropsDisplaySnapshot(date);
  if (!snapshot || !mlbPropsSnapshotIsFresh(snapshot)) {
    return Response.json({
      ok: false,
      mode: "temporarily_unavailable",
      date,
      board: null,
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  return Response.json({
    ok: true,
    mode: "display_enabled",
    date,
    snapshotId: snapshot.snapshotId,
    asOfTimestamp: snapshot.asOfTimestamp,
    movement: snapshot.movement,
    // The full research map is loaded per player by the reader endpoint. Do
    // not duplicate that multi-megabyte evidence blob in the board response.
    // Every prop row and market remains present.
    board: scoped
      ? buildMlbPropsScopedMemberBoardData(snapshot.data, scope)
      : buildMlbPropsMemberBoardData(snapshot.data),
  }, { headers: { "Cache-Control": scoped ? "private, max-age=30" : "private, no-store" } });
}
