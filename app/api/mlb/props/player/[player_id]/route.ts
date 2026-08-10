import { loadCachedLatestMlbPropsDisplaySnapshot } from "@/lib/mlb/props/boardSnapshotStore";
import { easternSlateDate, mlbPropsSnapshotIsFresh } from "@/lib/mlb/props/liveBoard";
import { getPublicPicksMode } from "@/lib/mlb/props/publicPicksSafety";
import { mlbPropsPlayerResearchGaps, selectMlbPropsResearchForRows } from "@/lib/mlb/props/memberPayload";
import { loadMlbPropsPlayerReadSnapshot } from "@/lib/mlb/props/memberReadSnapshotStore";
import { loadMlbPropsLivePreviewSnapshot } from "@/lib/mlb/props/livePreviewStore";
import { isProductExperiencePreviewAvailable } from "@/lib/config/productExperience";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ player_id: string }> },
) {
  const privatePreviewRead = new URL(request.url).searchParams.get("preview") === "1"
    && isProductExperiencePreviewAvailable();
  if (getPublicPicksMode().mode !== "display_enabled" && !privatePreviewRead) {
    return Response.json({ ok: false, mode: "disabled", player: null }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const { player_id: playerId } = await params;
  const readSnapshot = await loadMlbPropsPlayerReadSnapshot(easternSlateDate(), playerId).catch(() => null);
  const readSnapshotGaps = readSnapshot
    ? mlbPropsPlayerResearchGaps(readSnapshot.props ?? [], readSnapshot.research)
    : [];
  // Direct batter-vs-pitcher history is additive research and can be absent
  // even when recent form, pitch-mix matchup, and environment are complete.
  // Do not withhold those verified modules or decode the 22 MB canonical
  // board merely to repair one optional head-to-head card on a page request.
  const blockingReadSnapshotGaps = readSnapshotGaps.filter((gap) => !gap.endsWith(":matchup_history"));
  if (readSnapshot && blockingReadSnapshotGaps.length === 0) {
    return Response.json({
      ok: true,
      mode: "display_enabled",
      asOfTimestamp: readSnapshot.asOfTimestamp,
      props: readSnapshot.props ?? [],
      research: readSnapshot.research,
      coverageGaps: readSnapshotGaps,
    }, { headers: { "Cache-Control": "private, no-store" } });
  }
  // The private redesign review can be newer than the last persisted member
  // shard. Read its immutable local snapshot before falling back to the
  // canonical store so opening a player never turns a healthy preview board
  // into a permanently loading reader. Public/member traffic continues to use
  // only the persisted production read path.
  const privatePreviewSnapshot = privatePreviewRead
    ? await loadMlbPropsLivePreviewSnapshot(easternSlateDate()).catch(() => null)
    : null;
  const snapshot = privatePreviewSnapshot
    ?? await loadCachedLatestMlbPropsDisplaySnapshot(easternSlateDate());
  if (!snapshot || !mlbPropsSnapshotIsFresh(snapshot)) {
    if (readSnapshot) {
      return Response.json({
        ok: true,
        mode: "display_enabled",
        asOfTimestamp: readSnapshot.asOfTimestamp,
        props: readSnapshot.props ?? [],
        research: readSnapshot.research,
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
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
