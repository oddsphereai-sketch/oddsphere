import { notFound } from "next/navigation";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import ActualDailyEdgePreview from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import { buildEplShadowSlate } from "@/lib/services/epl/buildEplShadowSlate";
import { buildEplDailyEdgePreview } from "@/lib/services/epl/buildEplDailyEdgePreview";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Premier League Daily Edge Preview — OddSphere AI",
  robots: { index: false, follow: false },
};

export default async function PremierLeaguePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string | string[] }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const parsedRound = Number(Array.isArray(query.round) ? query.round[0] : query.round);
  const slate = await buildEplShadowSlate(Number.isInteger(parsedRound) ? parsedRound : undefined);
  const snapshot = await buildEplDailyEdgePreview(slate);
  const roundIndex = slate.availableRounds.indexOf(slate.round);
  const previousRound = slate.availableRounds[roundIndex - 1] ?? null;
  const nextRound = slate.availableRounds[roundIndex + 1] ?? null;
  const slateDates = [...new Set(slate.matches.map((match) => match.kickoff.slice(0, 10)))];
  const day = (date: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
  const history = Object.fromEntries(Object.entries(slate.recentHistory).map(([team, rows]) => [team, rows.map((row) => ({
    date: row.date,
    opponent: row.opponent,
    runsFor: row.goalsFor,
    runsAgainst: row.goalsAgainst,
    totalRuns: row.goalsFor + row.goalsAgainst,
    firstInningRuns: null,
    won: row.won,
    drawn: row.drawn,
  }))]));

  return (
    <ProductAppFrame>
      <ActualDailyEdgePreview
        key={`epl-${slate.round}-${snapshot.as_of}`}
        snapshot={snapshot}
        history={history}
        pitcherFirstInningHistory={{}}
        sport="soccer"
        freshContractRead
        reviewMode
        soccerCompetition={{ active: "premier_league", label: "Premier League" }}
        weeklySlate={{
          label: `Gameweek ${slate.round} · ${slate.matches.length} matches · ${slateDates.length ? `${day(slateDates[0])}–${day(slateDates.at(-1)!)} ` : ""}weekly slate`,
          previousHref: previousRound === null ? null : `/dev/premier-league-preview?round=${previousRound}`,
          nextHref: nextRound === null ? null : `/dev/premier-league-preview?round=${nextRound}`,
        }}
      />
    </ProductAppFrame>
  );
}
