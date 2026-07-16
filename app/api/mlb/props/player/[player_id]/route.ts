import { loadLatestMlbPropsBoardSnapshot } from "@/lib/mlb/props/boardSnapshotStore";
import { easternSlateDate, mlbPropsSnapshotIsFresh } from "@/lib/mlb/props/liveBoard";
import { getPublicPicksMode } from "@/lib/mlb/props/publicPicksSafety";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ player_id: string }> },
) {
  if (getPublicPicksMode().mode !== "display_enabled") {
    return Response.json({ ok: false, mode: "disabled", player: null }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const { player_id: playerId } = await params;
  const snapshot = await loadLatestMlbPropsBoardSnapshot(easternSlateDate());
  if (!snapshot || !mlbPropsSnapshotIsFresh(snapshot)) {
    return Response.json({ ok: false, mode: "temporarily_unavailable", player: null }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const rows = snapshot.data.props.filter((row) =>
    row.providerIds?.mlbStatsPlayerId === playerId
    || row.providerIds?.bdlPlayerId === Number(playerId)
    || row.id === playerId
  );
  if (!rows.length) return Response.json({ ok: false, player: null }, { status: 404 });
  const first = rows[0];
  return Response.json({
    ok: true,
    mode: "display_enabled",
    asOfTimestamp: snapshot.asOfTimestamp,
    player: {
      name: first.player,
      team: first.team,
      opponent: first.opponent,
      headshotUrl: first.headshotUrl ?? null,
      lineupStatus: first.lineupStatus ?? null,
    },
    props: rows,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
