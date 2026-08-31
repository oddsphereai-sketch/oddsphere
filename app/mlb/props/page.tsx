import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import { PlayerPropsDashboard } from "./components/PlayerPropsDashboard";
import { loadCachedLatestMlbPropsDisplaySnapshot } from "@/lib/mlb/props/boardSnapshotStore";
import { easternSlateDate, mlbPropsSnapshotIsFresh } from "@/lib/mlb/props/liveBoard";
import { getPublicPicksMode } from "@/lib/mlb/props/publicPicksSafety";
import { buildMlbPropsMemberBoardData } from "@/lib/mlb/props/memberPayload";
import { loadMlbPropsMemberBoardSnapshot } from "@/lib/mlb/props/memberReadSnapshotStore";
import { isPlayerPropsExperienceCandidateEnabled } from "@/lib/config/productExperience";
import { PlayerPropsLeaguePills } from "@/app/player-props/components/PlayerPropsLeaguePills";
import { readMemberDataWithDeadline } from "@/lib/services/memberDataAvailability";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "MLB Prop Researcher | Oddsphere",
  robots: { index: false, follow: false },
};

export default async function MlbPropsMemberPage({
  searchParams,
}: {
  searchParams: Promise<{ reader?: string | string[] }>;
}) {
  const mode = getPublicPicksMode();
  const query = await searchParams;
  const requestedReader = typeof query.reader === "string" ? query.reader : null;
  const presentation = isPlayerPropsExperienceCandidateEnabled() ? "candidate" : "current";
  let dataUnavailable = false;
  if (mode.mode === "display_enabled") {
    const memberResult = await readMemberDataWithDeadline({
      label: "mlb-player-props-member-snapshot",
      fallback: null,
      read: () => loadMlbPropsMemberBoardSnapshot(easternSlateDate()),
    });
    const memberSnapshot = memberResult.value;
    dataUnavailable ||= memberResult.unavailable;
    if (memberSnapshot && (!requestedReader || memberSnapshot.data.props.some((row) => row.id === requestedReader))) {
      return <ProductAppFrame><PlayerPropsLeaguePills league="mlb" nflEnabled={process.env.NFL_PLAYER_PROPS_MEMBER_ENABLED === "true"} /><PlayerPropsDashboard data={memberSnapshot.data} mode="member" initialSelectedId={requestedReader} presentation={presentation} /></ProductAppFrame>;
    }
    const displayResult = await readMemberDataWithDeadline({
      label: "mlb-player-props-display-snapshot",
      fallback: null,
      read: () => loadCachedLatestMlbPropsDisplaySnapshot(easternSlateDate()),
    });
    const snapshot = displayResult.value;
    dataUnavailable ||= displayResult.unavailable;
    if (snapshot && mlbPropsSnapshotIsFresh(snapshot)) {
      const initialSelectedId = snapshot.data.props.some((row) => row.id === requestedReader) ? requestedReader : null;
      // Research evidence accounts for most of the member payload and is only
      // rendered after a prop is opened. Keep the board's price/model rows
      // byte-for-byte intact and load that evidence on demand per player.
      const memberData = buildMlbPropsMemberBoardData(snapshot.data);
      return <ProductAppFrame><PlayerPropsLeaguePills league="mlb" nflEnabled={process.env.NFL_PLAYER_PROPS_MEMBER_ENABLED === "true"} /><PlayerPropsDashboard data={memberData} mode="member" initialSelectedId={initialSelectedId} presentation={presentation} /></ProductAppFrame>;
    }
  }

  return <ProductAppFrame>
    <PlayerPropsLeaguePills league="mlb" nflEnabled={process.env.NFL_PLAYER_PROPS_MEMBER_ENABLED === "true"} />
    <section className="mx-auto max-w-4xl py-10 sm:py-20">
      <div className="border-y border-gray-800 py-10 sm:py-14">
        <div className="flex items-center gap-3 text-xs font-bold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" />MLB Prop Researcher</div>
        <h1 className="mt-5 max-w-2xl text-4xl font-black leading-tight text-white sm:text-5xl">{dataUnavailable ? "Player Props data is temporarily unavailable." : "Today’s prop board is loading."}</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-gray-400">{dataUnavailable ? "The data service did not respond in time. Please refresh in a moment; no picks or prices were changed." : "The latest complete market snapshot will appear here as soon as sportsbook prices are ready."}</p>
      </div>
    </section>
  </ProductAppFrame>;
}
