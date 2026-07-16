import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import { PlayerPropsDashboard } from "./components/PlayerPropsDashboard";
import { loadCachedLatestMlbPropsDisplaySnapshot } from "@/lib/mlb/props/boardSnapshotStore";
import { easternSlateDate, mlbPropsSnapshotIsFresh } from "@/lib/mlb/props/liveBoard";
import { getPublicPicksMode } from "@/lib/mlb/props/publicPicksSafety";

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
  if (mode.mode === "display_enabled") {
    const snapshot = await loadCachedLatestMlbPropsDisplaySnapshot(easternSlateDate()).catch(() => null);
    if (snapshot && mlbPropsSnapshotIsFresh(snapshot)) {
      const initialSelectedId = snapshot.data.props.some((row) => row.id === requestedReader) ? requestedReader : null;
      return <ProductAppFrame><PlayerPropsDashboard data={snapshot.data} mode="member" initialSelectedId={initialSelectedId} /></ProductAppFrame>;
    }
  }

  return <ProductAppFrame>
    <section className="mx-auto max-w-4xl py-10 sm:py-20">
      <div className="border-y border-gray-800 py-10 sm:py-14">
        <div className="flex items-center gap-3 text-xs font-bold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" />MLB Prop Researcher</div>
        <h1 className="mt-5 max-w-2xl text-4xl font-black leading-tight text-white sm:text-5xl">Today’s prop board is loading.</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-gray-400">The latest complete market snapshot will appear here as soon as sportsbook prices are ready.</p>
      </div>
    </section>
  </ProductAppFrame>;
}
