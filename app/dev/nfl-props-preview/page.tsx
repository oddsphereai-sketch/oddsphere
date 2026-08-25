import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import { NflPlayerPropsDashboard } from "@/app/player-props/components/NflPlayerPropsDashboard";
import { PlayerPropsLeaguePills } from "@/app/player-props/components/PlayerPropsLeaguePills";
import { isProductExperiencePreviewAvailable } from "@/lib/config/productExperience";
import {
  NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE,
  NFL_PLAYER_PROPS_WRITER_LEASE_GROUP,
  type NflPlayerPropsProductionSnapshot,
} from "@/lib/services/football/nflPlayerPropsProductionContract";
import type { NflPlayerPropsRuntimeBoard, NflPlayerPropsRuntimeDecision } from "@/lib/services/football/nflPlayerPropsRuntime";

export const dynamic = "force-dynamic";
export const metadata = { title: "NFL Player Props Preview", robots: { index: false, follow: false } };

const LOCAL_BOARD = "football-research/cache/nfl-player-props-production-candidate/nfl_player_props_2026_week_1_runtime_board_r1.json";

export default async function NflPropsPreviewPage({ searchParams }: { searchParams: Promise<{ reader?: string | string[] }> }) {
  if (!isProductExperiencePreviewAvailable()) notFound();
  const snapshot = await loadLocalReviewSnapshot();
  const query = await searchParams;
  const requestedReader = typeof query.reader === "string" ? query.reader : null;
  const initialSelectedKey = snapshot?.memberDecisions.some((row) => decisionKey(row) === requestedReader) ? requestedReader : null;
  return <ProductAppFrame><PlayerPropsLeaguePills league="nfl" nflEnabled reviewMode /><NflPlayerPropsDashboard snapshot={snapshot} reviewMode initialSelectedKey={initialSelectedKey} /></ProductAppFrame>;
}

async function loadLocalReviewSnapshot(): Promise<NflPlayerPropsProductionSnapshot | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(process.cwd(), LOCAL_BOARD), "utf8")) as NflPlayerPropsRuntimeBoard;
    const decisions = raw.decisions.map((row) => ({ ...row, providerPlayerId: row.providerPlayerId ?? null })) as NflPlayerPropsRuntimeDecision[];
    const board = { ...raw, publicationEnabled: true as const, trackingEnabled: true as const, decisions };
    return {
      release: NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE,
      season: 2026,
      week: 1,
      generatedAt: raw.generatedAt,
      writerLeaseGroup: NFL_PLAYER_PROPS_WRITER_LEASE_GROUP,
      publicationEligible: true,
      trackingEligible: true,
      riskLabel: "forward_monitoring_2025_exact_price_confirmation",
      board,
      memberDecisions: decisions.filter((row) => row.grade !== "Held"),
      lifecycle: { recomputedUnlocked: decisions.filter((row) => row.state === "unlocked").length, frozenAtLock: 0, retainedPreviouslyLocked: 0 },
    };
  } catch {
    return null;
  }
}

function decisionKey(row: { gameId: string; playerName: string; market: string; line: number; side: string }): string { return [row.gameId, row.playerName, row.market, row.line, row.side].join("|"); }
