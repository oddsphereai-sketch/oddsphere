import { redirect } from "next/navigation";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import { supabase } from "@/lib/db/supabase";
import { readNflPlayerPropsSnapshot } from "@/lib/services/football/nflPlayerPropsSnapshotStore";
import { buildNflPlayerPropsMemberSnapshot } from "@/lib/services/football/nflPlayerPropsProductionContract";
import { NflPlayerPropsProductDashboard } from "./components/NflPlayerPropsProductDashboard";
import { PlayerPropsLeaguePills } from "./components/PlayerPropsLeaguePills";

export const dynamic = "force-dynamic";
export const metadata = { title: "NFL Player Props | Oddsphere", robots: { index: false, follow: false } };

export default async function PlayerPropsPage({ searchParams }: { searchParams: Promise<{ league?: string | string[]; reader?: string | string[] }> }) {
  const query = await searchParams;
  const enabled = process.env.NFL_PLAYER_PROPS_MEMBER_ENABLED === "true";
  if (!enabled || query.league !== "nfl") redirect("/mlb/props");
  const season = bounded(process.env.NFL_FORWARD_SEASON, 2026);
  const week = bounded(process.env.NFL_FORWARD_WEEK, 1);
  const snapshot = await readNflPlayerPropsSnapshot({ client: supabase, season, week }).catch(() => null);
  const memberSnapshot = snapshot ? buildNflPlayerPropsMemberSnapshot(snapshot) : null;
  const requestedReader = typeof query.reader === "string" ? query.reader : null;
  const initialSelectedKey = snapshot?.memberDecisions.some((row) => decisionKey(row) === requestedReader) ? requestedReader : null;
  return <ProductAppFrame><PlayerPropsLeaguePills league="nfl" nflEnabled /><NflPlayerPropsProductDashboard snapshot={memberSnapshot} initialSelectedKey={initialSelectedKey} /></ProductAppFrame>;
}

function bounded(value: string | undefined, fallback: number): number { const parsed = Number(value ?? fallback); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function decisionKey(row: { gameId: string; playerName: string; market: string; line: number; side: string }): string { return [row.gameId, row.playerName, row.market, row.line, row.side].join("|"); }
