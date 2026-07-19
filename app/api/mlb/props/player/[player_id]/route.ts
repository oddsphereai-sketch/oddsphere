import { loadCachedLatestMlbPropsDisplaySnapshot } from "@/lib/mlb/props/boardSnapshotStore";
import { easternSlateDate, mlbPropsSnapshotIsFresh } from "@/lib/mlb/props/liveBoard";
import { getPublicPicksMode } from "@/lib/mlb/props/publicPicksSafety";
import { selectMlbPropsResearchForRows } from "@/lib/mlb/props/memberPayload";
import { loadMlbPropsPlayerReadSnapshot } from "@/lib/mlb/props/memberReadSnapshotStore";

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
  const readSnapshot = await loadMlbPropsPlayerReadSnapshot(easternSlateDate(), playerId).catch(() => null);
  if (readSnapshot) {
    return Response.json({
      ok: true,
      mode: "display_enabled",
      asOfTimestamp: readSnapshot.asOfTimestamp,
      props: readSnapshot.props ?? [],
      research: readSnapshot.research,
    }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const snapshot = await loadCachedLatestMlbPropsDisplaySnapshot(easternSlateDate());
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
  const research = selectMlbPropsResearchForRows(snapshot.data, rows);
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
    research,
  }, { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=60" } });
}
