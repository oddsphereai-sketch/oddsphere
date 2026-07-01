import {
  buildPredictionEvidenceObject,
  buildPredictionEvidenceObjectFromLockedPayload,
  type PredictionEvidenceObject,
} from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import {
  buildRehydratedLockedMarketPayload,
  type RehydratedPredictionRecord,
} from "@/lib/services/aiAuditor/rehydratedLockedPayload";
import {
  buildAiAuditorCostPreview,
  type AiAuditorMarketKey,
  type AiAuditorPayloadEstimate,
} from "@/lib/services/aiAuditor/costPreview";
import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";

export type PredictionEvidenceSelection = {
  evidence: PredictionEvidenceObject[];
  currentLiveEvidence: PredictionEvidenceObject[];
  lockedSnapshotEvidence: PredictionEvidenceObject[];
  selectionSummary: {
    sourceOfTruth: "locked_snapshot_preferred";
    lockedSnapshotRows: number;
    currentLiveRows: number;
    selectedLockedRows: number;
    selectedCurrentLiveRows: number;
    note: string;
  };
};

type PredictionRecordWithJoin = RehydratedPredictionRecord & {
  game_predictions?: { locked_at: string | null } | Array<{ locked_at: string | null }> | null;
};

type TrustedRecoveryRow = {
  external_id: number | null;
  game_id: string | number | null;
  market: AiAuditorMarketKey | null;
  odds_american: number | null;
  edge: number | null;
};

function evidenceKey(row: Pick<PredictionEvidenceObject, "identity">): string {
  return `${row.identity.externalId}:${row.identity.normalizedMarket}`;
}

function priceQualityScore(price: number | null): number {
  if (price === null || !Number.isFinite(price)) return 45;
  if (price > 0) return Math.max(0, Math.min(100, +(70 + Math.min(20, price / 20)).toFixed(1)));
  const juice = Math.abs(price);
  if (juice <= 115) return 80;
  if (juice <= 135) return 65;
  if (juice <= 155) return 48;
  return 30;
}

function modelEdgeScore(edge: number | null, probability: number | null): number {
  const gap = Math.abs(Number(edge ?? 0));
  const prob = Number(probability ?? 0);
  const probBonus = prob >= 60 ? 15 : prob >= 56 ? 8 : prob >= 53 ? 4 : 0;
  return Math.max(0, Math.min(100, +(Math.min(75, gap * 7.5) + probBonus).toFixed(1)));
}

function withRecoveredTotalPrice(row: PredictionEvidenceObject, price: number): PredictionEvidenceObject {
  const score = priceQualityScore(price);
  const edge = row.modelStatsEvidence.edge;
  return {
    ...row,
    identity: {
      ...row.identity,
      priceAmerican: price,
    },
    priceValueEvidence: {
      ...row.priceValueEvidence,
      priceAmerican: price,
      priceSource: "prediction_records_recovered",
      priceNullReason: null,
      priceQualityScore: score,
      heavyJuiceWarning: price <= -150,
      plusMoneyValueFlag: price > 0 && (edge ?? 0) > 0,
      priceBecameUnplayable: score < 20,
      priceRecovered: true,
      priceRecoverySource: "prediction_records",
      priceRecoveryConfidence: "high",
      priceDisplayAllowed: true,
    },
    internalGradeDimensions: {
      ...row.internalGradeDimensions,
      priceQualityScore: score,
    },
  };
}

function withRecoveredEdge(row: PredictionEvidenceObject, edge: number): PredictionEvidenceObject {
  const score = modelEdgeScore(edge, row.modelStatsEvidence.modelProbability);
  return {
    ...row,
    modelStatsEvidence: {
      ...row.modelStatsEvidence,
      edge,
      deterministicScores: {
        ...row.modelStatsEvidence.deterministicScores,
        modelEdgeScore: score,
      },
      edgeRecovered: true,
      edgeRecoverySource: "model_minus_market_implied",
      edgeRecoveryConfidence: "high",
      edgeMissingReason: null,
    },
    priceValueEvidence: {
      ...row.priceValueEvidence,
      edge,
      plusMoneyValueFlag: row.priceValueEvidence.priceAmerican !== null && row.priceValueEvidence.priceAmerican > 0 && edge > 0,
    },
    internalGradeDimensions: {
      ...row.internalGradeDimensions,
      modelStatSupportScore: score,
      bettingValueStrengthScore: Math.max(row.internalGradeDimensions.bettingValueStrengthScore, Math.min(100, row.internalGradeDimensions.priceQualityScore * 0.45 + Math.max(0, edge) * 5)),
    },
  };
}

function withUnavailableEdge(row: PredictionEvidenceObject): PredictionEvidenceObject {
  const warning = "edge_unavailable";
  return {
    ...row,
    modelStatsEvidence: {
      ...row.modelStatsEvidence,
      dataQualityWarnings: row.modelStatsEvidence.dataQualityWarnings.includes(warning)
        ? row.modelStatsEvidence.dataQualityWarnings
        : [...row.modelStatsEvidence.dataQualityWarnings, warning],
      edgeRecovered: false,
      edgeRecoverySource: null,
      edgeRecoveryConfidence: null,
      edgeMissingReason: "edge_unavailable",
    },
  };
}

function normalizeLockedRow(row: PredictionRecordWithJoin): RehydratedPredictionRecord {
  const gp = Array.isArray(row.game_predictions) ? row.game_predictions[0] : row.game_predictions;
  return {
    ...row,
    locked_at: row.locked_at ?? gp?.locked_at ?? null,
  };
}

export async function loadLockedPredictionEvidence(args: {
  sport: Sport;
  date: string;
  markets: AiAuditorMarketKey[];
}): Promise<PredictionEvidenceObject[]> {
  const { supabase } = await import("@/lib/db/supabase");
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id,game_prediction_id,game_id,external_id,sport,slate_date,game_date,matchup,market,pick,side,line_value,odds_american,model_probability,market_probability,edge,play_grade,confidence,locked_at,snapshot_json,game_predictions(locked_at)")
    .eq("sport", args.sport)
    .eq("slate_date", args.date)
    .in("market", args.markets)
    .limit(10000);
  if (error) throw new Error(`prediction_records locked evidence load failed: ${error.message}`);
  return ((data ?? []) as PredictionRecordWithJoin[])
    .map(normalizeLockedRow)
    .filter((row) => row.locked_at !== null)
    .map(buildRehydratedLockedMarketPayload)
    .map(buildPredictionEvidenceObjectFromLockedPayload);
}

export function buildCurrentLivePredictionEvidence(args: {
  response: DailyEdgeResponse;
  markets: AiAuditorMarketKey[];
}): PredictionEvidenceObject[] {
  const preview = buildAiAuditorCostPreview({
    sport: args.response.sport,
    from: args.response.date,
    to: args.response.date,
    markets: args.markets,
    refreshesPerDay: 1,
    miniEscalationRates: [],
    skipUnchangedPayloads: false,
    oneCallPerGameCard: true,
    includePeakSlateAssumptions: false,
    payloadsByDate: [{ date: args.response.date, response: args.response }],
  });
  return preview.payloads.flatMap((card: AiAuditorPayloadEstimate) =>
    card.payload.markets.map((market) => buildPredictionEvidenceObject({ card, market })),
  );
}

export async function buildPredictionEvidenceForDailyEdgeEvaluation(args: {
  sport: Sport;
  date: string;
  markets: AiAuditorMarketKey[];
  response: DailyEdgeResponse;
}): Promise<PredictionEvidenceSelection> {
  const currentLiveEvidence = buildCurrentLivePredictionEvidence({
    response: args.response,
    markets: args.markets,
  });
  const lockedSnapshotEvidence = await loadLockedPredictionEvidence({
    sport: args.sport,
    date: args.date,
    markets: args.markets,
  });
  const lockedByKey = new Map(lockedSnapshotEvidence.map((row) => [evidenceKey(row), row]));
  const selected: PredictionEvidenceObject[] = [];
  const seen = new Set<string>();
  for (const current of currentLiveEvidence) {
    const key = evidenceKey(current);
    selected.push(lockedByKey.get(key) ?? current);
    seen.add(key);
  }
  for (const locked of lockedSnapshotEvidence) {
    const key = evidenceKey(locked);
    if (!seen.has(key)) selected.push(locked);
  }
  const selectedWithRecovery = await applyTrustedEvidenceRecovery({
    sport: args.sport,
    date: args.date,
    selected,
  });
  const selectedLockedRows = selectedWithRecovery.filter((row) => row.evidenceSource.kind === "locked_snapshot").length;
  return {
    evidence: selectedWithRecovery,
    currentLiveEvidence,
    lockedSnapshotEvidence,
    selectionSummary: {
      sourceOfTruth: "locked_snapshot_preferred",
      lockedSnapshotRows: lockedSnapshotEvidence.length,
      currentLiveRows: currentLiveEvidence.length,
      selectedLockedRows,
      selectedCurrentLiveRows: selectedWithRecovery.length - selectedLockedRows,
      note: "Locked/started/completed markets use prediction_records locked fields and snapshot_json; current/live DTOs are retained only for true pre-lock markets and diagnostics.",
    },
  };
}

async function applyTrustedEvidenceRecovery(args: {
  sport: Sport;
  date: string;
  selected: PredictionEvidenceObject[];
}): Promise<PredictionEvidenceObject[]> {
  const needsRecordRecovery = args.selected.some((row) =>
    row.evidenceSource.kind === "current_live" &&
    row.identity.normalizedMarket === "total" &&
    row.priceValueEvidence.priceAmerican === null
  );
  let recoveryByKey = new Map<string, TrustedRecoveryRow>();
  if (needsRecordRecovery) {
    const { supabase } = await import("@/lib/db/supabase");
    const { data, error } = await supabase
      .from("prediction_records")
      .select("external_id,game_id,market,odds_american,edge")
      .eq("sport", args.sport)
      .eq("slate_date", args.date)
      .in("market", ["total"])
      .not("odds_american", "is", null)
      .limit(10000);
    if (error) throw new Error(`prediction_records trusted recovery load failed: ${error.message}`);
    recoveryByKey = new Map(((data ?? []) as TrustedRecoveryRow[]).flatMap((row) => {
      if (!row.market) return [];
      const entries: Array<[string, TrustedRecoveryRow]> = [];
      if (row.external_id !== null) entries.push([`${row.external_id}:${row.market}`, row]);
      if (row.game_id !== null) entries.push([`${row.game_id}:${row.market}`, row]);
      return entries;
    }));
  }
  return args.selected.map((row) => {
    let next = row;
    if (
      next.evidenceSource.kind === "current_live" &&
      next.identity.normalizedMarket === "total" &&
      next.priceValueEvidence.priceAmerican === null
    ) {
      const recovered = recoveryByKey.get(evidenceKey(next)) ?? recoveryByKey.get(`${next.identity.gameId}:${next.identity.normalizedMarket}`);
      if (typeof recovered?.odds_american === "number" && Number.isFinite(recovered.odds_american)) {
        next = withRecoveredTotalPrice(next, recovered.odds_american);
      }
    }
    if (next.identity.marketType === "ML" && next.modelStatsEvidence.edge === null) {
      const model = next.modelStatsEvidence.modelProbability;
      const implied = next.modelStatsEvidence.marketImpliedProbability;
      if (typeof model === "number" && Number.isFinite(model) && typeof implied === "number" && Number.isFinite(implied)) {
        next = withRecoveredEdge(next, +(model - implied).toFixed(2));
      } else {
        next = withUnavailableEdge(next);
      }
    }
    return next;
  });
}
