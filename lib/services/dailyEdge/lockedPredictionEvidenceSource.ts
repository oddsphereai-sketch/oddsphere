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
import { getCurrentOrLastKnownLine } from "@/lib/services/lastKnownGoodReader";
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

function withRecoveredMarketPrice(args: {
  row: PredictionEvidenceObject;
  price: number;
  oppositePrice?: number | null;
  source: "current" | "history";
  observedAt: string | null;
}): PredictionEvidenceObject {
  const { row, price, oppositePrice = null, source, observedAt } = args;
  const score = priceQualityScore(price);
  const marketImplied = noVigPickedPct(price, oppositePrice);
  const model = row.modelStatsEvidence.modelProbability;
  const edge = typeof model === "number" && marketImplied !== null
    ? +(model - marketImplied).toFixed(2)
    : row.modelStatsEvidence.edge;
  const edgeScore = modelEdgeScore(edge, model);
  const recoverySource = source === "history" ? "line_history" : "current_source";
  return {
    ...row,
    identity: {
      ...row.identity,
      priceAmerican: price,
    },
    marketEvidence: {
      ...row.marketEvidence,
      lineMovement: {
        ...row.marketEvidence.lineMovement,
        currentAmerican: row.marketEvidence.lineMovement.currentAmerican ?? price,
        displayCurrentAmerican: row.marketEvidence.lineMovement.displayCurrentAmerican ?? price,
        lastMoveCurrentAmerican: row.marketEvidence.lineMovement.lastMoveCurrentAmerican ?? price,
        lastMoveAt: row.marketEvidence.lineMovement.lastMoveAt ?? observedAt,
      },
    },
    modelStatsEvidence: {
      ...row.modelStatsEvidence,
      marketImpliedProbability: marketImplied ?? row.modelStatsEvidence.marketImpliedProbability,
      edge,
      deterministicScores: {
        ...row.modelStatsEvidence.deterministicScores,
        modelEdgeScore: edgeScore,
        priceQualityScore: score,
      },
      edgeRecovered: edge !== null && row.modelStatsEvidence.edge === null,
      edgeRecoverySource: edge !== null && row.modelStatsEvidence.edge === null ? "model_minus_market_implied" : row.modelStatsEvidence.edgeRecoverySource,
      edgeRecoveryConfidence: edge !== null && row.modelStatsEvidence.edge === null ? "high" : row.modelStatsEvidence.edgeRecoveryConfidence,
      edgeMissingReason: edge !== null ? null : row.modelStatsEvidence.edgeMissingReason,
    },
    priceValueEvidence: {
      ...row.priceValueEvidence,
      priceAmerican: price,
      priceSource: `${recoverySource}_recovered`,
      priceNullReason: null,
      marketImpliedProbability: marketImplied ?? row.priceValueEvidence.marketImpliedProbability,
      edge,
      priceQualityScore: score,
      heavyJuiceWarning: price <= -150,
      plusMoneyValueFlag: price > 0 && (edge ?? 0) > 0,
      priceBecameUnplayable: score < 20,
      priceRecovered: true,
      priceRecoverySource: recoverySource,
      priceRecoveryConfidence: "high",
      priceDisplayAllowed: true,
    },
    internalGradeDimensions: {
      ...row.internalGradeDimensions,
      priceQualityScore: score,
      modelStatSupportScore: edgeScore,
      bettingValueStrengthScore: Math.max(
        row.internalGradeDimensions.bettingValueStrengthScore,
        Math.min(100, score * 0.45 + Math.max(0, edge ?? 0) * 5),
      ),
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

function americanToImpliedPct(american: number | null): number | null {
  if (american === null || !Number.isFinite(american) || american === 0) return null;
  const implied = american < 0 ? -american / (-american + 100) : 100 / (american + 100);
  return +(implied * 100).toFixed(2);
}

function noVigPickedPct(pickedAmerican: number | null, oppositeAmerican: number | null): number | null {
  const picked = americanToImpliedPct(pickedAmerican);
  const opposite = americanToImpliedPct(oppositeAmerican);
  if (picked === null || opposite === null || picked + opposite <= 0) return null;
  return +((picked / (picked + opposite)) * 100).toFixed(2);
}

function fiSide(row: PredictionEvidenceObject): "over" | "under" | null {
  if (row.identity.marketType !== "FI") return null;
  const pick = String(row.identity.pick ?? "").toLowerCase();
  if (pick.includes("yrfi") || pick.includes("over")) return "over";
  if (pick.includes("nrfi") || pick.includes("under")) return "under";
  return null;
}

function oppositeSide(side: "over" | "under"): "over" | "under" {
  return side === "over" ? "under" : "over";
}

function marketSide(row: PredictionEvidenceObject): "home" | "away" | "over" | "under" | null {
  const pick = String(row.identity.pick ?? "").trim().toLowerCase();
  if (row.identity.marketType === "ML") {
    if (pick === String(row.identity.homeTeam ?? "").trim().toLowerCase()) return "home";
    if (pick === String(row.identity.awayTeam ?? "").trim().toLowerCase()) return "away";
  }
  if (row.identity.marketType === "TOTAL") {
    if (pick.includes("over")) return "over";
    if (pick.includes("under")) return "under";
  }
  return null;
}

function withRecoveredFiPricing(args: {
  row: PredictionEvidenceObject;
  pickedPrice: number;
  oppositePrice: number | null;
  source: "current" | "history";
  observedAt: string | null;
}): PredictionEvidenceObject {
  const { row, pickedPrice, oppositePrice, source, observedAt } = args;
  const marketImplied = noVigPickedPct(pickedPrice, oppositePrice);
  const model = row.modelStatsEvidence.modelProbability;
  const edge = typeof model === "number" && marketImplied !== null
    ? +(model - marketImplied).toFixed(2)
    : row.modelStatsEvidence.edge;
  const priceScore = priceQualityScore(pickedPrice);
  const edgeScore = modelEdgeScore(edge, model);
  const recoverySource = source === "history" ? "line_history" : "current_source";
  return {
    ...row,
    identity: {
      ...row.identity,
      priceAmerican: pickedPrice,
    },
    modelStatsEvidence: {
      ...row.modelStatsEvidence,
      marketImpliedProbability: marketImplied ?? row.modelStatsEvidence.marketImpliedProbability,
      edge,
      deterministicScores: {
        ...row.modelStatsEvidence.deterministicScores,
        modelEdgeScore: edgeScore,
        priceQualityScore: priceScore,
      },
      edgeRecovered: edge !== null && row.modelStatsEvidence.edge === null,
      edgeRecoverySource: edge !== null && row.modelStatsEvidence.edge === null ? "model_minus_market_implied" : row.modelStatsEvidence.edgeRecoverySource,
      edgeRecoveryConfidence: edge !== null && row.modelStatsEvidence.edge === null ? "high" : row.modelStatsEvidence.edgeRecoveryConfidence,
      edgeMissingReason: edge !== null ? null : row.modelStatsEvidence.edgeMissingReason,
    },
    marketEvidence: {
      ...row.marketEvidence,
      lineMovement: {
        ...row.marketEvidence.lineMovement,
        currentAmerican: row.marketEvidence.lineMovement.currentAmerican ?? pickedPrice,
        displayCurrentAmerican: row.marketEvidence.lineMovement.displayCurrentAmerican ?? pickedPrice,
        lastMoveCurrentAmerican: row.marketEvidence.lineMovement.lastMoveCurrentAmerican ?? pickedPrice,
        lastMoveAt: row.marketEvidence.lineMovement.lastMoveAt ?? observedAt,
      },
    },
    priceValueEvidence: {
      ...row.priceValueEvidence,
      priceAmerican: pickedPrice,
      priceSource: `${recoverySource}_recovered`,
      priceNullReason: null,
      marketImpliedProbability: marketImplied ?? row.priceValueEvidence.marketImpliedProbability,
      edge,
      priceQualityScore: priceScore,
      heavyJuiceWarning: pickedPrice <= -150,
      plusMoneyValueFlag: pickedPrice > 0 && (edge ?? 0) > 0,
      priceBecameUnplayable: priceScore < 20,
      priceRecovered: true,
      priceRecoverySource: recoverySource,
      priceRecoveryConfidence: marketImplied !== null ? "high" : "medium",
      priceDisplayAllowed: true,
    },
    internalGradeDimensions: {
      ...row.internalGradeDimensions,
      priceQualityScore: priceScore,
      modelStatSupportScore: edgeScore,
      bettingValueStrengthScore: Math.max(row.internalGradeDimensions.bettingValueStrengthScore, Math.min(100, priceScore * 0.45 + Math.max(0, edge ?? 0) * 5)),
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
    .select("id,game_prediction_id,game_id,external_id,sport,slate_date,game_date,matchup,market,pick,side,line_value,odds_american,model_probability,market_probability,edge,play_grade,no_bet,confidence,locked_at,snapshot_json,game_predictions(locked_at)")
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
  const { supabase } = await import("@/lib/db/supabase");
  const externalIdsNeedingLineRecovery = Array.from(new Set(args.selected
    .filter((row) =>
      row.evidenceSource.kind === "current_live" &&
      (
        row.priceValueEvidence.priceAmerican === null ||
        row.modelStatsEvidence.marketImpliedProbability === null ||
        row.modelStatsEvidence.edge === null
      ) &&
      (row.identity.marketType === "ML" || row.identity.marketType === "TOTAL" || row.identity.marketType === "FI")
    )
    .map((row) => row.identity.externalId)
    .filter((id) => Number.isFinite(id))));
  let internalGameIdByExternal = new Map<number, number>();
  if (externalIdsNeedingLineRecovery.length > 0) {
    const { data, error } = await supabase
      .from("games")
      .select("id, external_id")
      .eq("sport", args.sport)
      .eq("slate_date", args.date)
      .in("external_id", externalIdsNeedingLineRecovery);
    if (error) throw new Error(`games trusted recovery load failed: ${error.message}`);
    internalGameIdByExternal = new Map(((data ?? []) as Array<{ id: number; external_id: number | null }>).flatMap((row) =>
      row.external_id === null ? [] : [[row.external_id, row.id] as const],
    ));
  }
  const internalGameIdFor = (row: PredictionEvidenceObject): number | null => {
    const fromIdentity = Number(row.identity.gameId);
    if (Number.isFinite(fromIdentity)) return fromIdentity;
    return internalGameIdByExternal.get(row.identity.externalId) ?? null;
  };
  const recoverMarketPrice = async (row: PredictionEvidenceObject): Promise<PredictionEvidenceObject> => {
    if (
      row.evidenceSource.kind !== "current_live" ||
      (
        row.priceValueEvidence.priceAmerican !== null &&
        row.modelStatsEvidence.marketImpliedProbability !== null &&
        row.modelStatsEvidence.edge !== null
      ) ||
      (row.identity.marketType !== "ML" && row.identity.marketType !== "TOTAL")
    ) {
      return row;
    }
    const side = marketSide(row);
    const gameId = internalGameIdFor(row);
    if (side === null || gameId === null) return row;
    const marketType = row.identity.marketType === "ML" ? "moneyline" : "total";
    const picked = await getCurrentOrLastKnownLine({
      supabase,
      gameId,
      marketType,
      side,
      field: "odds_american",
    });
    const pickedPrice = picked.value ?? row.priceValueEvidence.priceAmerican;
    if (pickedPrice === null || !Number.isFinite(pickedPrice)) return row;
    const opposite = await getCurrentOrLastKnownLine({
      supabase,
      gameId,
      marketType,
      side: side === "home" ? "away" : side === "away" ? "home" : oppositeSide(side),
      field: "odds_american",
    });
    return withRecoveredMarketPrice({
      row,
      price: pickedPrice,
      oppositePrice: opposite.value,
      source: picked.source ?? "history",
      observedAt: picked.observed_at,
    });
  };
  const recoverFiPricing = async (row: PredictionEvidenceObject): Promise<PredictionEvidenceObject> => {
    if (
      row.evidenceSource.kind !== "current_live" ||
      row.identity.marketType !== "FI" ||
      row.priceValueEvidence.priceAmerican !== null
    ) {
      return row;
    }
    const side = fiSide(row);
    const gameId = internalGameIdFor(row);
    if (side === null || gameId === null) return row;
    const picked = await getCurrentOrLastKnownLine({
      supabase,
      gameId,
      marketType: "first_inning_total",
      side,
      field: "odds_american",
    });
    if (picked.value === null || !Number.isFinite(picked.value)) return row;
    const opposite = await getCurrentOrLastKnownLine({
      supabase,
      gameId,
      marketType: "first_inning_total",
      side: oppositeSide(side),
      field: "odds_american",
    });
    return withRecoveredFiPricing({
      row,
      pickedPrice: picked.value,
      oppositePrice: opposite.value,
      source: picked.source ?? "history",
      observedAt: picked.observed_at,
    });
  };

  const recovered = await Promise.all(args.selected.map(async (row) => {
    let next = await recoverMarketPrice(row);
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
    next = await recoverFiPricing(next);
    return next;
  }));
  return recovered;
}
