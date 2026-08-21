import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import ActualDailyEdgePreview from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import type { Sport } from "@/lib/types/domain/Sport";
import { loadNflRegularPipelinePreseasonSlate } from "@/lib/services/football/nflRegularLocalSlate";
import { loadNflPreseasonLocalSlate } from "@/lib/services/football/nflLocalShadowSlate";
import {
  buildFootballPreviewFixture,
  resolveNflPreviewWeek,
  type FootballPreviewSport,
} from "./footballPreviewFixture";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Football Daily Edge — OddSphere AI",
  robots: { index: false, follow: false },
};

type FootballPreviewSearchParams = Promise<{
  sport?: string | string[];
}>;

const SPORT_SWITCH_DESTINATIONS: Partial<Record<Sport, string>> = {
  mlb: "/lab/daily-edge?sport=mlb",
  wnba: "/lab/daily-edge?sport=wnba",
  soccer: "/lab/daily-edge?sport=soccer",
  nba: "/lab/daily-edge?sport=nba",
  nhl: "/lab/daily-edge?sport=nhl",
  cbb: "/lab/daily-edge?sport=cbb",
  nfl: "/dev/football-preview?sport=nfl",
  cfb: "/dev/football-preview?sport=cfb&week=0",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function dayLabel(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

export default async function FootballPreviewPage({
  searchParams,
}: {
  searchParams: FootballPreviewSearchParams;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const query = await searchParams;
  const requestedSport = first(query.sport);
  const sport: FootballPreviewSport = requestedSport === "cfb" ? "cfb" : "nfl";
  if (sport === "cfb") {
    return <FootballPreviewUnavailable detail="The real college-football slate adapter is not complete. No sample schedule, projections, prices, results, or injuries are being substituted." />;
  }
  // One NFL product board. This explicit local pointer advances only after a
  // complete, checksum-verified snapshot exists; query parameters cannot open
  // a second or partially assembled board.
  const week = resolveNflPreviewWeek(2);
  let fixture: Awaited<ReturnType<typeof loadCachedNflPreview>>;
  try {
    fixture = await loadCachedNflPreview(week.week);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown local preview error.";
    return <FootballPreviewUnavailable detail={`${detail} No fallback or fabricated slate is shown.`} />;
  }
  const firstKickoff = fixture.snapshot.games[0]?.gameStartAt;
  const lastKickoff = fixture.snapshot.games.at(-1)?.gameStartAt;
  const range = firstKickoff && lastKickoff
    ? `${dayLabel(firstKickoff)}–${dayLabel(lastKickoff)}`
    : "Weekly slate";

  return (
    <ProductAppFrame>
      <ActualDailyEdgePreview
        key={`${sport}-${fixture.week.week}-${fixture.snapshot.as_of}`}
        snapshot={fixture.snapshot}
        history={fixture.history}
        pitcherFirstInningHistory={{}}
        initialAvailability={fixture.availability}
        sport={sport}
        freshContractRead={false}
        reviewMode={false}
        activePreviewSports={["nfl"]}
        sportSwitchDestinations={SPORT_SWITCH_DESTINATIONS}
        weeklySlate={{
          label: `NFL · ${fixture.week.label} · ${fixture.snapshot.games.length} games · ${fixture.snapshot.games.length * 3} predictions · ${range} · one verified board · preseason never tracked`,
          evidence: `Stored snapshot · regular-season candidate pipeline on the real ${fixture.week.label} slate · ${fixture.provenance.modelRelease} uses nflverse play-by-play/QB/team state + BALLDONTLIE odds/injuries/depth · preseason phase comparison prevents false all-Over confidence · dry-run grades ${fixture.provenance.decisionRelease} are never official or tracked · Opening trails ${fixture.provenance.firstObservedCoverageGames}/${fixture.snapshot.games.length} (${fixture.provenance.minimumStoredPriceObservations}+ verified same-book snapshots/game) · public/sharp splits unavailable`,
          previousHref: null,
          nextHref: null,
        }}
      />
    </ProductAppFrame>
  );
}

const loadCachedNflPreview = unstable_cache(
  async (productWeek: number) => {
    const [loaded, phaseComparison] = await Promise.all([
      loadNflRegularPipelinePreseasonSlate(productWeek),
      loadNflPreseasonLocalSlate(productWeek),
    ]);
    if (loaded.providerSlate.fetchedAt !== phaseComparison.providerSlate.fetchedAt) {
      throw new Error("NFL regular-core and preseason phase-comparison snapshots do not share one provider observation.");
    }
    return buildFootballPreviewFixture({
      providerSlate: loaded.providerSlate,
      shadowSlate: loaded.localSlate,
      phaseComparisonSlate: phaseComparison.localSlate,
      availability: loaded.availability,
      priceHistoryByGame: loaded.priceHistoryByGame,
      previousWeek: null,
      nextWeek: null,
    });
  },
  ["football-preview-real-nfl-single-stored-slate-v9"],
  { revalidate: 5 * 60, tags: ["football-preview-real-nfl-slate"] },
);

function FootballPreviewUnavailable({ detail }: { detail: string }) {
  return (
    <ProductAppFrame>
      <main className="mx-auto flex min-h-[70vh] w-full max-w-5xl items-center px-5 py-16">
        <section className="w-full rounded-2xl border border-amber-300/20 bg-[#0d0b16] p-6 shadow-2xl sm:p-8">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">Football Daily Edge</p>
          <h1 className="mt-3 text-2xl font-black text-white">Verified slate unavailable</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-gray-400">{detail}</p>
          <p className="mt-5 text-xs font-bold text-gray-500">Fail-closed rule: only provider-backed games and calculated real-data model outputs can render here.</p>
        </section>
      </main>
    </ProductAppFrame>
  );
}
