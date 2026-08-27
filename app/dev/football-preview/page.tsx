import { notFound } from "next/navigation";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import ActualDailyEdgePreview from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import type { Sport } from "@/lib/types/domain/Sport";
import { supabase } from "@/lib/db/supabase";
import { readCurrentNflWeekOneHeldMemberFixture } from "@/lib/services/football/nflWeekOneHeldMemberFixture";
import type { FootballPreviewSport } from "./footballPreviewFixture";

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
  // One provider-backed Week 1 product board. This route intentionally reads
  // the same append-only evidence used by the member candidate so founder QA
  // never falls back to the retired preseason package or a fixture slate.
  let fixture: Awaited<ReturnType<typeof readCurrentNflWeekOneHeldMemberFixture>>;
  try {
    fixture = await readCurrentNflWeekOneHeldMemberFixture({
      client: supabase,
      season: Number(process.env.NFL_FORWARD_SEASON ?? "2026"),
      week: Number(process.env.NFL_FORWARD_WEEK ?? "1"),
    });
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
          label: `NFL · ${fixture.week.label} · ${fixture.snapshot.games.length} games · ${fixture.snapshot.games.length * 3} predictions · ${range} · live predictions and exact-price Bet grades`,
          previousHref: null,
          nextHref: null,
          asOf: fixture.capturedAt,
          cadenceLabel: "six-hour early evidence · hourly inside 48h · 15-minute T-60 checks",
        }}
      />
    </ProductAppFrame>
  );
}

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
