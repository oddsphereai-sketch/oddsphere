import { redirect } from "next/navigation";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import { supabase } from "@/lib/db/supabase";
import { readNflPlayerPropsMemberSnapshot } from "@/lib/services/football/nflPlayerPropsSnapshotStore";
import { NflPlayerPropsProductDashboard } from "./components/NflPlayerPropsProductDashboard";
import { PlayerPropsLeaguePills } from "./components/PlayerPropsLeaguePills";
import { readMemberDataWithDeadline } from "@/lib/services/memberDataAvailability";

export const dynamic = "force-dynamic";
export const metadata = { title: "NFL Player Props | Oddsphere", robots: { index: false, follow: false } };

export default async function PlayerPropsPage({ searchParams }: { searchParams: Promise<{ league?: string | string[]; reader?: string | string[] }> }) {
  const query = await searchParams;
  const enabled = process.env.NFL_PLAYER_PROPS_MEMBER_ENABLED === "true";
  if (!enabled || query.league !== "nfl") redirect("/mlb/props");
  const season = bounded(process.env.NFL_FORWARD_SEASON, 2026);
  const week = bounded(process.env.NFL_FORWARD_WEEK, 1);
  const snapshotResult = await readMemberDataWithDeadline({
    label: "nfl-player-props-snapshot",
    fallback: null,
    read: () => readNflPlayerPropsMemberSnapshot({ client: supabase, season, week }),
  });
  // The member-only store now performs buildNflPlayerPropsMemberSnapshot(snapshot) before caching.
  const memberSnapshot = snapshotResult.value;
  const requestedReader = typeof query.reader === "string" ? query.reader : null;
  const initialSelectedKey = memberSnapshot?.memberDecisions.some((row) => decisionKey(row) === requestedReader) ? requestedReader : null;
  return <ProductAppFrame><PlayerPropsLeaguePills league="nfl" nflEnabled /><NflPlayerPropsProductDashboard snapshot={memberSnapshot} initialSelectedKey={initialSelectedKey} dataUnavailable={snapshotResult.unavailable} /></ProductAppFrame>;
}

function bounded(value: string | undefined, fallback: number): number { const parsed = Number(value ?? fallback); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function decisionKey(row: { gameId: string; playerName: string; market: string; line: number; side: string }): string { return [row.gameId, row.playerName, row.market, row.line, row.side].join("|"); }
