/**
 * SELECT-only audit for persisted MLB full-game forward evidence.
 * This script never invokes a provider, prediction builder, writer, or cron.
 */
import { supabase } from "../../lib/db/supabase";
import {
  mlbFullGameEvidenceAddedBytes,
  MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_CONTRACT,
  MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_KEY,
  MLB_FULLGAME_MARKET_EVIDENCE_MAX_GAME_BYTES,
  MLB_FULLGAME_MARKET_EVIDENCE_MAX_MARKET_BYTES,
} from "../../lib/services/mlb/mlbFullGameForwardEvidenceCapture";

type Row = {
  id: number;
  game_id: number;
  slate_date: string;
  market: string;
  matchup: string;
  locked_at: string | null;
  model_version: string | null;
  side: string | null;
  snapshot_json: unknown;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function main(): Promise<void> {
  const from = process.argv[2] ?? new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  const query = await supabase
    .from("prediction_records")
    .select("id,game_id,slate_date,market,matchup,locked_at,model_version,side,snapshot_json")
    .eq("sport", "mlb")
    .in("market", ["moneyline", "total"])
    .gte("slate_date", from)
    .order("id", { ascending: false })
    .limit(2000);
  if (query.error) throw new Error(query.error.message);

  const rows = (query.data ?? []) as Row[];
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const key = `${row.game_id}:${row.market}:${row.model_version ?? "unknown"}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  const current = [...latest.values()];
  const captures = current.flatMap((row) => {
    const snapshot = object(row.snapshot_json);
    const artifact = object(snapshot?.[MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_KEY]);
    return artifact === null ? [] : [{ row, artifact }];
  });
  const byGame = new Map<number, number>();
  for (const { row, artifact } of captures) {
    byGame.set(
      row.game_id,
      (byGame.get(row.game_id) ?? 0) + mlbFullGameEvidenceAddedBytes(
        artifact as Parameters<typeof mlbFullGameEvidenceAddedBytes>[0],
      ),
    );
  }
  const mismatches = captures.filter(({ row, artifact }) => {
    const correction = object(artifact.publication_correction);
    return correction?.published_side_matches_score === false && row.side !== null;
  });
  const contractCounts: Record<string, number> = {};
  for (const { artifact } of captures) {
    const contract = String(artifact.contract ?? "missing");
    contractCounts[contract] = (contractCounts[contract] ?? 0) + 1;
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    providerCalls: 0,
    writerCalls: 0,
    writes: 0,
    fromSlateDate: from,
    rows: current.length,
    captures: captures.length,
    unlockedCaptures: captures.filter(({ row }) => row.locked_at === null).length,
    lockedCaptures: captures.filter(({ row }) => row.locked_at !== null).length,
    expectedContract: MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_CONTRACT,
    contractCounts,
    bounds: {
      maxMarketBytes: MLB_FULLGAME_MARKET_EVIDENCE_MAX_MARKET_BYTES,
      maxGameBytes: MLB_FULLGAME_MARKET_EVIDENCE_MAX_GAME_BYTES,
      marketViolations: captures.filter(({ artifact }) =>
        (number(artifact.payload_bytes) ?? Number.POSITIVE_INFINITY) > MLB_FULLGAME_MARKET_EVIDENCE_MAX_MARKET_BYTES
      ).length,
      gameViolations: [...byGame.values()].filter((bytes) => bytes > MLB_FULLGAME_MARKET_EVIDENCE_MAX_GAME_BYTES).length,
      maxMarketBytesSeen: Math.max(0, ...captures.map(({ artifact }) => number(artifact.payload_bytes) ?? 0)),
      maxGameBytesSeen: Math.max(0, ...byGame.values()),
    },
    targetExclusion: {
      capturedMarkets: captures.length,
      singletonEvaluationOnly: captures.filter(({ artifact }) =>
        object(artifact.target_excluded_cohort)?.singleton_evaluation_only === true
      ).length,
      breadthEligible: captures.filter(({ artifact }) =>
        object(artifact.target_excluded_cohort)?.incumbent_r76_breadth_eligible === true
      ).length,
      omittedPairs: captures.reduce((sum, { artifact }) =>
        sum + (number(object(artifact.omitted_counts)?.named_book_pairs) ?? 0), 0),
    },
    publicationCorrection: {
      scoreSideMismatchCount: mismatches.length,
      rows: mismatches.map(({ row, artifact }) => ({
        slateDate: row.slate_date,
        matchup: row.matchup,
        market: row.market,
        modelVersion: row.model_version,
        correction: artifact.publication_correction,
      })),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
