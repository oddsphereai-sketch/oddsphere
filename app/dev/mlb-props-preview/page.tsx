import { notFound } from "next/navigation";
import fixture from "@/tests/fixtures/mlb-props/player-props-preview-full.json";
import { PlayerPropsDashboard, type PlayerPropsDashboardData } from "@/app/mlb/props/components/PlayerPropsDashboard";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import { easternSlateDate } from "@/lib/mlb/props/liveBoard";
import { loadMlbPropsLivePreviewSnapshot } from "@/lib/mlb/props/livePreviewStore";

export const metadata = {
  title: "MLB Player Props Preview",
  robots: { index: false, follow: false },
};

type PreviewSearchParams = {
  date?: string | string[];
  reader?: string | string[];
  source?: string | string[];
};

export default async function MlbPropsPreviewPage({ searchParams }: { searchParams: Promise<PreviewSearchParams> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const requestedReader = firstQueryValue(query.reader);
  const requestedDate = firstQueryValue(query.date);
  const slateDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : easternSlateDate();

  if (firstQueryValue(query.source) === "fixture") {
    const data = fixture as PlayerPropsDashboardData;
    const initialSelectedId = data.props.some((row) => row.id === requestedReader) ? requestedReader : null;
    return <ProductAppFrame><PlayerPropsDashboard data={data} mode="preview" initialSelectedId={initialSelectedId} /></ProductAppFrame>;
  }

  const snapshot = await loadMlbPropsLivePreviewSnapshot(slateDate);
  if (!snapshot) {
    return <ProductAppFrame><LivePreviewUnavailable slateDate={slateDate} /></ProductAppFrame>;
  }
  const initialSelectedId = snapshot.data.props.some((row) => row.id === requestedReader) ? requestedReader : null;
  return <ProductAppFrame><PlayerPropsDashboard data={snapshot.data} mode="live-preview" initialSelectedId={initialSelectedId} /></ProductAppFrame>;
}

function firstQueryValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : value?.[0] ?? null;
}

function LivePreviewUnavailable({ slateDate }: { slateDate: string }) {
  return <section className="mx-auto max-w-3xl border-y border-gray-800 py-12 sm:py-20">
    <p className="text-[10px] font-black uppercase text-emerald-300">MLB Prop Researcher</p>
    <h1 className="mt-3 text-3xl font-black text-white">Live preview snapshot unavailable</h1>
    <p className="mt-3 text-sm leading-6 text-gray-400">No read-only live snapshot has been generated for {slateDate}.</p>
  </section>;
}
