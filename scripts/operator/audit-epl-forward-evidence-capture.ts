/** Read-only coverage audit for behavior-neutral EPL forward evidence. */
import { supabase } from "../../lib/db/supabase";
import {
  EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE,
  eplForwardEvidenceByteLength,
  type EplForwardEvidenceHistory,
  type EplForwardMarket,
} from "../../lib/services/epl/eplForwardEvidenceCapture";

const PAGE_SIZE = 500;
const MAX_ROWS = 5_000;
const MARKETS: EplForwardMarket[] = ["match_result", "double_chance", "total", "btts"];

type Row = {
  game_id: number;
  slate_date: string;
  model_version: string;
  locked_at: string | null;
  snapshot_json: Record<string, unknown> | null;
};

async function loadRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select("game_id,slate_date,model_version,locked_at,snapshot_json")
      .eq("sport", "soccer")
      .eq("market", "match_result")
      .order("slate_date", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`read EPL evidence snapshots: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  if (rows.length >= MAX_ROWS) throw new Error(`EPL evidence audit exceeded bounded ${MAX_ROWS}-row limit`);
  return rows;
}

function history(row: Row): EplForwardEvidenceHistory | null {
  const value = row.snapshot_json?.epl_forward_evidence_history;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EplForwardEvidenceHistory>;
  return candidate.captureRelease === EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE && Array.isArray(candidate.captures)
    ? candidate as EplForwardEvidenceHistory
    : null;
}

async function main() {
  const rows = await loadRows();
  const captured = rows.flatMap((row) => {
    const evidence = history(row);
    return evidence ? [{ row, evidence }] : [];
  });
  const marketCoverage = Object.fromEntries(MARKETS.map((market) => [market, {
    captures: 0,
    evaluated: 0,
    targetExcludedVectors: 0,
    public: 0,
    circa: 0,
    movement: 0,
    maxVectorSkewMs: 0,
  }])) as Record<EplForwardMarket, { captures: number; evaluated: number; targetExcludedVectors: number; public: number; circa: number; movement: number; maxVectorSkewMs: number }>;
  const modelReleases: Record<string, number> = {};
  let omittedCaptures = 0;
  let maxBytes = 0;
  for (const { row, evidence } of captured) {
    modelReleases[row.model_version] = (modelReleases[row.model_version] ?? 0) + 1;
    omittedCaptures += evidence.omittedCaptureCount;
    maxBytes = Math.max(maxBytes, eplForwardEvidenceByteLength(evidence));
    for (const capture of evidence.captures) {
      for (const market of MARKETS) {
        const slice = capture.markets[market];
        const summary = marketCoverage[market];
        summary.captures++;
        summary.evaluated += Number(Boolean(slice.evaluated));
        summary.targetExcludedVectors += slice.targetExcluded.length;
        summary.public += Number(Boolean(slice.publicEvidence));
        summary.circa += Number(Boolean(slice.circaVectorIdentity));
        summary.movement += slice.movements.length;
        for (const vector of [...(slice.evaluated ? [slice.evaluated] : []), ...slice.targetExcluded]) {
          summary.maxVectorSkewMs = Math.max(summary.maxVectorSkewMs, vector.vectorSkewMs ?? 0);
        }
      }
    }
  }
  console.log(JSON.stringify({
    captureRelease: EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE,
    rowsScanned: rows.length,
    capturedGames: captured.length,
    lockedCapturedGames: captured.filter(({ row }) => Boolean(row.locked_at)).length,
    modelReleases,
    omittedCaptures,
    maxRetainedBytes: maxBytes,
    marketCoverage,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
