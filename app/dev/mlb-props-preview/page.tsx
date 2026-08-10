import { notFound } from "next/navigation";
import fixture from "@/tests/fixtures/mlb-props/player-props-preview-full.json";
import { PlayerPropsDashboard, type PlayerPropsDashboardData } from "@/app/mlb/props/components/PlayerPropsDashboard";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import { easternSlateDate } from "@/lib/mlb/props/liveBoard";
import { loadMlbPropsLivePreviewSnapshot } from "@/lib/mlb/props/livePreviewStore";
import { loadMlbPropsMemberBoardSnapshot } from "@/lib/mlb/props/memberReadSnapshotStore";
import { isProductExperiencePreviewAvailable } from "@/lib/config/productExperience";
import {
  buildMlbPropsInitialMemberBoardData,
  selectMlbPropsResearchForRows,
} from "@/lib/mlb/props/memberPayload";

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
  if (!isProductExperiencePreviewAvailable()) notFound();
  const query = await searchParams;
  const requestedReader = firstQueryValue(query.reader);
  const requestedDate = firstQueryValue(query.date);
  const slateDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : easternSlateDate();

  if (firstQueryValue(query.source) === "fixture") {
    const data = fixture as PlayerPropsDashboardData;
    const initialSelectedId = data.props.some((row) => row.id === requestedReader) ? requestedReader : null;
    return <ProductAppFrame><PlayerPropsDashboard data={data} mode="preview" initialSelectedId={initialSelectedId} presentation="candidate" /></ProductAppFrame>;
  }

  const candidate = await loadCandidateSnapshot(slateDate);
  if (!candidate) {
    return <ProductAppFrame><LivePreviewUnavailable slateDate={slateDate} /></ProductAppFrame>;
  }
  // Mirror the member fast path instead of serializing the multi-megabyte
  // canonical board into the private review page. The bounded board preserves
  // every actionable row plus market/player discovery, while the included
  // evidence map is limited to the rows the reviewer can actually open.
  const previewData = candidate.memberData ?? (() => {
    const bounded = buildMlbPropsInitialMemberBoardData(candidate.snapshot!.data);
    return {
      ...bounded,
      research: selectMlbPropsResearchForRows(candidate.snapshot!.data, bounded.props),
    } satisfies PlayerPropsDashboardData;
  })();
  const initialSelectedId = previewData.props.some((row) => row.id === requestedReader) ? requestedReader : null;
  // Use the production member behavior in review as well. This keeps scoped
  // board hydration and on-demand player research identical at cutover.
  return <ProductAppFrame><PlayerPropsDashboard data={previewData} mode="member" initialSelectedId={initialSelectedId} presentation="candidate" /></ProductAppFrame>;
}

async function loadCandidateSnapshot(slateDate: string) {
  // Review the newest valid source. A local no-write build is useful before
  // priming, but it must not shadow a newer persisted member snapshot during
  // final cutover QA.
  const [localSnapshot, memberSnapshot] = await Promise.all([
    loadMlbPropsLivePreviewSnapshot(slateDate),
    loadMlbPropsMemberBoardSnapshot(slateDate).catch(() => null),
  ]);
  if (memberSnapshot && (!localSnapshot || Date.parse(memberSnapshot.asOfTimestamp) >= Date.parse(localSnapshot.asOfTimestamp))) {
    return { memberData: memberSnapshot.data, snapshot: null };
  }
  if (localSnapshot) return { memberData: null, snapshot: localSnapshot };
  // Do not decode the multi-megabyte canonical scoring snapshot in a member
  // page request. The candidate intentionally exercises the same compact
  // read model required at launch and fails quickly when that substrate has
  // not been primed. A local read-only snapshot remains available for review.
  return null;
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
