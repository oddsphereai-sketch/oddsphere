import { loadCachedLatestMlbPropsDisplaySnapshot } from "@/lib/mlb/props/boardSnapshotStore";
import { easternSlateDate, mlbPropsSnapshotIsFresh } from "@/lib/mlb/props/liveBoard";
import { getPublicPicksMode } from "@/lib/mlb/props/publicPicksSafety";

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
    board: snapshot.data,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
