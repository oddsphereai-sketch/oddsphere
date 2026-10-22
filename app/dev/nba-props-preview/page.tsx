import { notFound } from "next/navigation";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import { NbaPlayerPropsProductDashboard } from "@/app/player-props/components/NbaPlayerPropsProductDashboard";
import { PlayerPropsLeaguePills } from "@/app/player-props/components/PlayerPropsLeaguePills";
import { isProductExperiencePreviewAvailable } from "@/lib/config/productExperience";
import { nbaPlayerPropsSlateDate } from "@/lib/services/nba/nbaPlayerPropsLifecycle";
import { readNbaPlayerPropsPrivateSnapshot } from "@/lib/services/nba/nbaPlayerPropsPrivateStore";
import fixture from "@/lib/services/nba/fixtures/nbaPlayerPropsProductPreview.json";
import type { NbaPlayerPropsMemberSnapshot } from "@/lib/services/nba/nbaPlayerPropsProductContract";

export const metadata = {
  title: "NBA Player Props Preview",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function NbaPropsPreviewPage({ searchParams }: { searchParams: Promise<{ reader?: string | string[] }> }) {
  if (!isProductExperiencePreviewAvailable()) notFound();
  const currentSlateDate = nbaPlayerPropsSlateDate();
  const currentCandidate = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await import("@/lib/db/supabase").then(({ supabase }) => readNbaPlayerPropsPrivateSnapshot({
        client: supabase,
        slateDate: currentSlateDate,
      })).catch(() => null)
    : null;
  const snapshot = currentCandidate ?? fixture as NbaPlayerPropsMemberSnapshot;
  const query = await searchParams;
  const requested = typeof query.reader === "string" ? query.reader : null;
  const initialSelectedKey = snapshot.decisions.some((row) => row.decisionKey === requested) ? requested : null;
  return <ProductAppFrame>
    <PlayerPropsLeaguePills league="nba" nflEnabled nbaEnabled reviewMode />
    <NbaPlayerPropsProductDashboard snapshot={snapshot} initialSelectedKey={initialSelectedKey} reviewSource={currentCandidate ? "live" : "historical"} />
  </ProductAppFrame>;
}
