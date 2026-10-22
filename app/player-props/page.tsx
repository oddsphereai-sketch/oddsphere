import { redirect } from "next/navigation";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import { supabase } from "@/lib/db/supabase";
import { readNflPlayerPropsMemberSnapshot } from "@/lib/services/football/nflPlayerPropsSnapshotStore";
import { encodeNflPlayerPropsMemberTransport } from "@/lib/services/football/nflPlayerPropsMemberTransport.server";
import { NflPlayerPropsProductDashboardTransport } from "./components/NflPlayerPropsProductDashboardTransport";
import { NbaPlayerPropsProductDashboard } from "./components/NbaPlayerPropsProductDashboard";
import { PlayerPropsLeaguePills } from "./components/PlayerPropsLeaguePills";
import { readMemberDataWithDeadline } from "@/lib/services/memberDataAvailability";
import { resolveNflForwardWeek } from "@/lib/services/football/nflForwardWeekSelection";
import { nbaPlayerPropsSlateDate } from "@/lib/services/nba/nbaPlayerPropsLifecycle";
import { readNbaPlayerPropsPrivateSnapshot } from "@/lib/services/nba/nbaPlayerPropsPrivateStore";
import { buildNbaPlayerPropsMemberSnapshot } from "@/lib/services/nba/nbaPlayerPropsProductContract";
import { readPlayerPropsLeagueActivity } from "@/lib/services/playerProps/playerPropsLeagueActivity.server";
import { preferredPlayerPropsHref } from "./lib/playerPropsLeagues";

export const dynamic = "force-dynamic";
export const metadata = { title: "Player Props | Oddsphere", robots: { index: false, follow: false } };

export default async function PlayerPropsPage({ searchParams }: { searchParams: Promise<{ league?: string | string[]; reader?: string | string[] }> }) {
  const query = await searchParams;
  const nflEnabled = process.env.NFL_PLAYER_PROPS_MEMBER_ENABLED === "true";
  const nbaEnabled = process.env.NBA_PLAYER_PROPS_MEMBER_ENABLED === "true";
  if (query.league !== "nba" && query.league !== "nfl") {
    const activity = await readPlayerPropsLeagueActivity().catch(() => ({}));
    redirect(preferredPlayerPropsHref(activity, { nflEnabled, nbaEnabled }));
  }
  if (query.league === "nba") {
    if (!nbaEnabled) redirect("/player-props");
    const slateDate = nbaPlayerPropsSlateDate();
    const snapshotResult = await readMemberDataWithDeadline({
      label: "nba-player-props-snapshot",
      fallback: null,
      read: () => readNbaPlayerPropsPrivateSnapshot({ client: supabase, slateDate }),
    });
    const snapshot = snapshotResult.value ?? buildNbaPlayerPropsMemberSnapshot({
      mode: "private_forward_candidate",
      generatedAt: new Date().toISOString(),
      slateDate,
      games: [],
      decisions: [],
      inputRows: 0,
    });
    const requestedReader = typeof query.reader === "string" ? query.reader : null;
    const initialSelectedKey = snapshot.decisions.some((row) => row.decisionKey === requestedReader) ? requestedReader : null;
    return <ProductAppFrame>
      <PlayerPropsLeaguePills league="nba" nflEnabled={nflEnabled} nbaEnabled currentGameCount={snapshot.games.length} currentPropCount={snapshot.decisions.length} />
      <NbaPlayerPropsProductDashboard snapshot={snapshot} initialSelectedKey={initialSelectedKey} />
    </ProductAppFrame>;
  }
  if (!nflEnabled || query.league !== "nfl") redirect("/player-props");
  const season = bounded(process.env.NFL_FORWARD_SEASON, 2026);
  const configuredWeek = bounded(process.env.NFL_FORWARD_WEEK, 1);
  const calendarWeek = resolveNflForwardWeek({ season, configuredWeek });
  const snapshotResult = await readMemberDataWithDeadline({
    label: "nfl-player-props-snapshot",
    fallback: null,
    read: async () => {
      const current = await readNflPlayerPropsMemberSnapshot({ client: supabase, season, week: calendarWeek });
      if ((current?.memberDecisions.length ?? 0) > 0 || calendarWeek >= 18) return current;
      const next = await readNflPlayerPropsMemberSnapshot({ client: supabase, season, week: calendarWeek + 1 });
      return (next?.memberDecisions.length ?? 0) > 0 ? next : current;
    },
  });
  // The member-only store now performs buildNflPlayerPropsMemberSnapshot(snapshot) before caching.
  const memberSnapshot = snapshotResult.value;
  const requestedReader = typeof query.reader === "string" ? query.reader : null;
  const initialSelectedKey = memberSnapshot?.memberDecisions.some((row) => decisionKey(row) === requestedReader) ? requestedReader : null;
  const transport = memberSnapshot ? encodeNflPlayerPropsMemberTransport(memberSnapshot) : null;
  return <ProductAppFrame><PlayerPropsLeaguePills league="nfl" nflEnabled nbaEnabled={nbaEnabled} currentGameCount={new Set(memberSnapshot?.memberDecisions.map((row) => row.gameId) ?? []).size} currentPropCount={memberSnapshot?.memberDecisions.length ?? 0} /><NflPlayerPropsProductDashboardTransport transport={transport} initialSelectedKey={initialSelectedKey} dataUnavailable={snapshotResult.unavailable} /></ProductAppFrame>;
}

function bounded(value: string | undefined, fallback: number): number { const parsed = Number(value ?? fallback); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function decisionKey(row: { gameId: string; playerName: string; market: string; line: number; side: string }): string { return [row.gameId, row.playerName, row.market, row.line, row.side].join("|"); }
