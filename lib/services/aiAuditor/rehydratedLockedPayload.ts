import crypto from "node:crypto";

export type RehydratedMarketKey = "moneyline" | "total" | "first_inning";
export type RehydratedMarketRead =
  | "aligned"
  | "mixed"
  | "resistance"
  | "consensus_support"
  | "consensus_resistance"
  | "no_clear_signal"
  | "historical_market_read_not_persisted";

export type RehydratedPredictionRecord = {
  id: number;
  game_id: number;
  external_id: number;
  sport: string;
  slate_date: string;
  game_date: string | null;
  matchup: string;
  market: RehydratedMarketKey;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  model_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  play_grade: string | null;
  no_bet: boolean | null;
  confidence: number | null;
  locked_at: string | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades?: { result: string | null } | Array<{ result: string | null }> | null;
};

export type RehydratedSplitRow = {
  side: string;
  label: string;
  moneyPct: number | null;
  betsPct: number | null;
  observedAt: string | null;
  isStale: boolean;
};

export type RehydratedLockedMarketPayload = {
  schemaVersion: "rehydrated-locked-card-v1";
  sport: string;
  slateDate: string;
  gameId: number;
  externalId: number;
  matchup: string;
  market: RehydratedMarketKey;
  pick: string | null;
  selectedSide: string | null;
  originalGrade: string | null;
  displayPriceAmerican: number | null;
  priceSource: "prediction_records" | "snapshot_json" | "unavailable";
  priceNullReason: string | null;
  sportsbook: string | null;
  marketImpliedProbabilityPct: number | null;
  modelProbabilityPct: number | null;
  edgePct: number | null;
  projectedScore: { away: number | null; home: number | null } | null;
  lineValue: number | null;
  openLineValue: number | null;
  currentLineValue: number | null;
  openPriceAmerican: number | null;
  currentPriceAmerican: number | null;
  lockedPriceAmerican: number | null;
  lineMovementDirection: string | null;
  consensusSplits: {
    available: boolean;
    rows: RehydratedSplitRow[];
    source: "snapshot_source_aware_split_rows_at_lock" | "snapshot_signal_rows_at_lock" | "historical_source_not_persisted";
    freshness: "fresh_at_lock" | "historical_source_not_persisted";
  };
  sharpBookSplitsOrSignal: {
    available: boolean;
    label: "Sharp Book Splits" | "Sharp Book Signal" | null;
    rows: RehydratedSplitRow[];
    signal: string | null;
    source: "snapshot_source_aware_split_rows_at_lock" | "snapshot_signal_rows_at_lock" | "historical_source_not_persisted";
    freshness: "fresh_at_lock" | "historical_source_not_persisted";
  };
  sourceAvailability: {
    consensusSplitsAvailable: boolean;
    sharpBookSplitsOrSignalAvailable: boolean;
    historicalMarketReadPersisted: boolean;
    historicalMarketReadReconstructed: boolean;
    historicalMarketReadMissingReason: string | null;
  };
  sourceConflict: boolean | null;
  marketRead: {
    status: RehydratedMarketRead;
    label: string;
    copy: string;
    source: "persisted" | "reconstructed" | "historical_market_read_not_persisted";
    reasonCodes: string[];
  };
  dataWarnings: string[];
  fiContext: {
    isFirstInning: boolean;
    oddsAvailable: boolean;
    marketProbabilityAvailable: boolean;
    expectedSplitSourceAvailable: boolean;
    note: string | null;
  };
  lock: {
    asOfTimestamp: string | null;
    lockedAt: string | null;
  };
  postgameExcludedFromAiPayload: true;
  payloadHash: string;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function toPct(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return +(value <= 1 ? value * 100 : value).toFixed(2);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function sideLabel(side: string | null, market: RehydratedMarketKey, matchup: string): string {
  if (market === "total") {
    if (side === "over") return "Over";
    if (side === "under") return "Under";
  }
  if (market === "first_inning") {
    if (side === "over") return "YRFI";
    if (side === "under") return "NRFI";
  }
  const [away, home] = matchup.includes("@")
    ? matchup.split("@").map((part) => part.trim())
    : matchup.split(" @ ").map((part) => part.trim());
  if (side === "away") return away || "Away";
  if (side === "home") return home || "Home";
  return side ?? "Unknown";
}

function snapshotSignalRows(snapshot: Record<string, unknown> | null, market: RehydratedMarketKey): Array<Record<string, unknown>> {
  const raw = snapshot?.signal_rows_at_lock;
  if (!Array.isArray(raw)) return [];
  const dbMarket = market === "first_inning" ? "first_inning_total" : market;
  return raw.filter((row): row is Record<string, unknown> => {
    return row !== null && typeof row === "object" && (row as Record<string, unknown>).market_type === dbMarket;
  });
}

function pctFromStoredSplit(value: unknown): number | null {
  const n = num(value);
  if (n === null) return null;
  return Math.max(0, Math.min(100, Math.round(n <= 1 ? n * 100 : n)));
}

function sideFromSelectionKey(selectionKey: string | null): string | null {
  if (!selectionKey) return null;
  const side = selectionKey.split(":").pop();
  if (side === "home" || side === "away" || side === "over" || side === "under") return side;
  return null;
}

function snapshotSourceAwareRows(
  snapshot: Record<string, unknown> | null,
  market: RehydratedMarketKey,
  source: "consensus" | "sharp",
): RehydratedSplitRow[] {
  if (market === "first_inning") return [];
  const raw = snapshot?.source_aware_split_rows_at_lock;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => {
      if (row === null || typeof row !== "object") return false;
      if (str((row as Record<string, unknown>).market_type) !== market) return false;
      const provider = (str((row as Record<string, unknown>).provider) ?? "").toLowerCase();
      const sourceType = (str((row as Record<string, unknown>).source_type) ?? "").toLowerCase();
      if (source === "consensus") return provider === "playbook" || sourceType === "multi_book_consensus";
      return provider === "sharpapi" && sourceType === "sharp_adjacent_book";
    })
    .map((row) => {
      const side = sideFromSelectionKey(str(row.selection_key)) ?? "unknown";
      return {
        side,
        label: sideLabel(side, market, ""),
        moneyPct: pctFromStoredSplit(row.money_pct),
        betsPct: pctFromStoredSplit(row.bets_pct),
        observedAt: str(row.source_observed_at) ?? str(row.fetched_at),
        isStale: false,
      };
    })
    .filter((row) => row.moneyPct !== null || row.betsPct !== null);
}

function splitRows(record: RehydratedPredictionRecord): RehydratedSplitRow[] {
  const sourceAwareConsensus = snapshotSourceAwareRows(record.snapshot_json, record.market, "consensus")
    .map((row) => ({ ...row, label: sideLabel(row.side, record.market, record.matchup) }));
  if (sourceAwareConsensus.length > 0) return sourceAwareConsensus;
  return snapshotSignalRows(record.snapshot_json, record.market).map((row) => ({
    side: str(row.side) ?? "unknown",
    label: sideLabel(str(row.side), record.market, record.matchup),
    moneyPct: num(row.public_money_pct),
    betsPct: num(row.public_betting_pct),
    observedAt: str(row.computed_at),
    isStale: false,
  })).filter((row) => row.moneyPct !== null || row.betsPct !== null);
}

function pickedSplit(rows: RehydratedSplitRow[], selectedSide: string | null): RehydratedSplitRow | null {
  if (!selectedSide) return null;
  return rows.find((row) => row.side === selectedSide) ?? null;
}

function splitLean(row: RehydratedSplitRow | null): "support" | "resistance" | "mixed" | "none" {
  if (!row) return "none";
  const money = row.moneyPct;
  const bets = row.betsPct;
  if (money !== null && bets !== null) {
    if (money >= 50 && bets >= 50) return "support";
    if (money < 50 && bets < 50) return "resistance";
    return "mixed";
  }
  const v = money ?? bets;
  if (v === null) return "none";
  return v >= 50 ? "support" : "resistance";
}

function lineMovement(snapshot: Record<string, unknown> | null): Record<string, unknown> | null {
  const raw = snapshot?.line_movement;
  return raw !== null && typeof raw === "object" ? raw as Record<string, unknown> : null;
}

function projectedScore(snapshot: Record<string, unknown> | null): { away: number | null; home: number | null } | null {
  const raw = snapshot?.predicted_scores_at_lock;
  let record: Record<string, unknown> | null = null;
  if (raw !== null && typeof raw === "object") {
    record = raw as Record<string, unknown>;
  } else if (snapshot?.projected_score !== null && typeof snapshot?.projected_score === "object") {
    record = snapshot.projected_score as Record<string, unknown>;
  } else if (snapshot?.model !== null && typeof snapshot?.model === "object") {
    // Soccer locked snapshots store expected goals under `model.lambda_*`
    // rather than the MLB/NBA-style predicted_scores_at_lock object.
    record = snapshot.model as Record<string, unknown>;
  }
  if (record === null) return null;
  const away =
    num(record.away) ??
    num(record.away_score) ??
    num(record.away_runs) ??
    num(record.lambda_away) ??
    num(record.raw_projected_away_goals) ??
    num(record.reconciled_away_goals);
  const home =
    num(record.home) ??
    num(record.home_score) ??
    num(record.home_runs) ??
    num(record.lambda_home) ??
    num(record.raw_projected_home_goals) ??
    num(record.reconciled_home_goals);
  return away !== null || home !== null ? { away, home } : null;
}

function americanToImpliedPct(american: number | null | undefined): number | null {
  if (typeof american !== "number" || !Number.isFinite(american) || american === 0) return null;
  const implied = american < 0 ? -american / (-american + 100) : 100 / (american + 100);
  return +(implied * 100).toFixed(2);
}

function marketImpliedProbabilityPct(record: RehydratedPredictionRecord, effectivePriceAmerican: number | null = record.odds_american): number | null {
  const persisted = toPct(record.market_probability);
  if (persisted !== null) return persisted;
  return americanToImpliedPct(effectivePriceAmerican);
}

function fiLockedEdgePct(record: RehydratedPredictionRecord): number | null {
  if (record.market !== "first_inning") return null;
  const fi = record.snapshot_json?.fi_v2_audit;
  if (fi === null || typeof fi !== "object") return null;
  return num((fi as Record<string, unknown>).fi_edge_pct);
}

function edgePct(record: RehydratedPredictionRecord, marketImpliedPct: number | null): number | null {
  if (record.edge !== null && Number.isFinite(record.edge)) return record.edge;
  const fiEdge = fiLockedEdgePct(record);
  if (fiEdge !== null) return +fiEdge.toFixed(2);
  const model = toPct(record.model_probability);
  if (model !== null && marketImpliedPct !== null) return +(model - marketImpliedPct).toFixed(2);
  return null;
}

function dataWarnings(snapshot: Record<string, unknown> | null, market: RehydratedMarketKey): string[] {
  const warnings = new Set<string>();
  const review = snapshot?.review_v1 as Record<string, unknown> | undefined;
  const marketReview = review?.[market === "first_inning" ? "fi" : market === "moneyline" ? "ml" : "ou"];
  if (marketReview && typeof marketReview === "object") {
    const flags = (marketReview as Record<string, unknown>).flags;
    if (Array.isArray(flags)) for (const flag of flags) if (typeof flag === "string") warnings.add(flag);
  }
  const integrity = snapshot?.data_integrity;
  if (integrity && typeof integrity === "object") {
    const flags = (integrity as Record<string, unknown>).flags;
    if (Array.isArray(flags)) for (const flag of flags) if (typeof flag === "string") warnings.add(flag);
  }
  const v22 = snapshot?.v2_2_audit as Record<string, unknown> | undefined;
  const fi = snapshot?.fi_v2_audit as Record<string, unknown> | undefined;
  const reasonCodes = market === "first_inning" ? fi?.feature_audit : v22?.feature_reason_codes;
  if (Array.isArray(reasonCodes)) for (const code of reasonCodes) if (typeof code === "string" && /missing|fallback|proxy|stale/i.test(code)) warnings.add(code);
  if (reasonCodes && typeof reasonCodes === "object") {
    const codes = (reasonCodes as Record<string, unknown>).reason_codes;
    if (Array.isArray(codes)) for (const code of codes) if (typeof code === "string" && /missing|fallback|proxy|stale/i.test(code)) warnings.add(code);
  }
  return Array.from(warnings);
}

function snapshotGrade(record: RehydratedPredictionRecord): string | null {
  const key = record.market === "moneyline" ? "ml_play_grade" : record.market === "total" ? "ou_play_grade" : "fi_play_grade";
  const direct = str(record.snapshot_json?.[key]);
  if (direct) return direct;
  const framework = record.snapshot_json?.framework_grades_at_lock;
  if (framework && typeof framework === "object") {
    const frameworkKey = record.market === "moneyline" ? "ml_grade" : record.market === "total" ? "ou_grade" : "nrfi_grade";
    return str((framework as Record<string, unknown>)[frameworkKey]);
  }
  return null;
}

function normalizeGradeToken(value: string | null): string | null {
  const raw = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) {
    return null;
  }
  if (raw === "best_angle" || raw === "bestangle") return "Best Angle";
  if (raw === "lean") return "Lean";
  if (raw === "watchlist" || raw === "watch" || raw === "market_watch" || raw === "market_aligned" || raw === "provisional") return "Watchlist";
  if (raw === "caution" || raw === "public_smoke") return "Caution";
  if (raw === "no_play" || raw === "noplay" || raw === "pass" || raw === "held" || raw === "toss_up") return "No Play";
  return null;
}

function memberFacingAtLock(record: RehydratedPredictionRecord): Record<string, unknown> | null {
  const raw = record.snapshot_json?.member_facing_at_lock;
  return raw !== null && typeof raw === "object" ? raw as Record<string, unknown> : null;
}

function fallbackStoredGrade(record: RehydratedPredictionRecord): string | null {
  if (record.no_bet === true) return "No Play";
  if (record.play_grade === null && record.no_bet === false) {
    if (record.market === "first_inning" && /toss[\s-]*up/i.test(record.pick ?? "")) return "No Play";
    return "Watchlist";
  }
  if (record.market === "first_inning" && /toss[\s-]*up/i.test(record.pick ?? "")) return "No Play";
  return null;
}

function normalizePublicGrade(value: string | null, record: RehydratedPredictionRecord): string | null {
  const memberFacing = memberFacingAtLock(record);
  if (memberFacing !== null) {
    const memberRaw = str(memberFacing.play_grade) ?? str(memberFacing.grade);
    const memberGrade = normalizeGradeToken(memberRaw);
    if (memberGrade !== null) return memberGrade;
    return fallbackStoredGrade(record);
  }

  const storedGrade = normalizeGradeToken(value);
  if (storedGrade !== null) return storedGrade;
  const fallback = fallbackStoredGrade(record);
  if (fallback !== null) return fallback;
  return normalizeGradeToken(snapshotGrade(record));
}

function reconstructRead(record: RehydratedPredictionRecord, splits: RehydratedSplitRow[]): RehydratedLockedMarketPayload["marketRead"] {
  const persisted = record.snapshot_json?.recommendationDecision ?? record.snapshot_json?.market_read ?? null;
  if (persisted && typeof persisted === "object") {
    const json = persisted as Record<string, unknown>;
    const status = str(json.status) as RehydratedMarketRead | null;
    if (status) {
      return {
        status,
        label: str(json.label) ?? status,
        copy: str(json.copy) ?? "Persisted historical Market Read.",
        source: "persisted",
        reasonCodes: ["historical_market_read_persisted"],
      };
    }
  }

  const selected = pickedSplit(splits, record.side);
  const consensusLean = splitLean(selected);
  const movement = lineMovement(record.snapshot_json);
  const movementDirection = str(movement?.direction);
  const movementSupport = movementDirection === "with_pick" || movementDirection === "toward_pick" || movementDirection === "support";
  const movementResistance = movementDirection === "against_pick" || movementDirection === "resistance";
  const reasons = ["historical_market_read_reconstructed"];
  if (splits.length === 0) reasons.push("historical_split_source_not_persisted");
  if (movementDirection) reasons.push(`line_movement_${movementDirection}`);

  if (record.market === "first_inning" && splits.length === 0) {
    return {
      status: "historical_market_read_not_persisted",
      label: "Historical Market Read Not Persisted",
      copy: "FI market read was not persisted in the historical canonical layer; use FI price, model edge, and data context instead of treating this as a live data failure.",
      source: "historical_market_read_not_persisted",
      reasonCodes: reasons,
    };
  }

  if ((consensusLean === "support" && movementResistance) || (consensusLean === "resistance" && movementSupport)) {
    return {
      status: "mixed",
      label: "Mixed",
      copy: "Historical split and line movement signals conflict.",
      source: "reconstructed",
      reasonCodes: [...reasons, "source_conflict"],
    };
  }
  if (consensusLean === "resistance" || movementResistance) {
    return {
      status: splits.length > 0 ? "consensus_resistance" : "resistance",
      label: splits.length > 0 ? "Consensus Resistance" : "Market Resistance",
      copy: "Historical market evidence shows resistance against the pick.",
      source: "reconstructed",
      reasonCodes: [...reasons, "market_resistance"],
    };
  }
  if (consensusLean === "support" || movementSupport) {
    return {
      status: splits.length > 0 ? "consensus_support" : "aligned",
      label: splits.length > 0 ? "Consensus Support" : "Market Support",
      copy: "Historical market evidence supports the pick.",
      source: "reconstructed",
      reasonCodes: reasons,
    };
  }
  if (splits.length > 0) {
    return {
      status: "no_clear_signal",
      label: "No Clear Signal",
      copy: "Historical split rows were present but did not show a clear directional signal.",
      source: "reconstructed",
      reasonCodes: reasons,
    };
  }
  return {
    status: "historical_market_read_not_persisted",
    label: "Historical Market Read Not Persisted",
    copy: "Canonical Market Read was not persisted for this older locked row.",
    source: "historical_market_read_not_persisted",
    reasonCodes: reasons,
  };
}

function postedLinePrice(record: RehydratedPredictionRecord): { price: number | null; sportsbook: string | null } {
  const key = record.market === "moneyline" ? "moneyline" : record.market === "total" ? "total" : "first_inning";
  const postedLines = record.snapshot_json?.posted_lines;
  const raw = postedLines && typeof postedLines === "object"
    ? (postedLines as Record<string, unknown>)[key]
    : null;
  if (!raw || typeof raw !== "object") return { price: null, sportsbook: null };
  const line = raw as Record<string, unknown>;
  const side = str(line.side);
  if (side && record.side && side !== record.side) return { price: null, sportsbook: null };
  return {
    price: num(line.odds_american),
    sportsbook: str(line.book) ?? str(line.sportsbook),
  };
}

function auditPrice(record: RehydratedPredictionRecord): number | null {
  if (record.market === "total") {
    const audit = record.snapshot_json?.v2_2_audit;
    if (!audit || typeof audit !== "object") return null;
    const row = audit as Record<string, unknown>;
    if (record.side === "over") return num(row.over_odds_american);
    if (record.side === "under") return num(row.under_odds_american);
  }
  if (record.market === "first_inning") {
    const audit = record.snapshot_json?.fi_v2_audit;
    if (!audit || typeof audit !== "object") return null;
    const row = audit as Record<string, unknown>;
    if (record.side === "over") return num(row.market_yrfi_odds_american);
    if (record.side === "under") return num(row.market_nrfi_odds_american);
  }
  return null;
}

function oddsSourceAtLockPrice(record: RehydratedPredictionRecord): { price: number | null; sportsbook: string | null } {
  const marketKey = record.market === "moneyline" ? "ml" : record.market === "total" ? "ou" : "fi";
  const raw = record.snapshot_json?.[`odds_source_at_lock_${marketKey}`];
  if (!raw || typeof raw !== "object") return { price: null, sportsbook: null };
  const obj = raw as Record<string, unknown>;
  const sideRaw = record.side ? obj[record.side] : null;
  if (sideRaw && typeof sideRaw === "object") {
    const sideObj = sideRaw as Record<string, unknown>;
    return {
      price: num(sideObj.odds) ?? num(sideObj.odds_american),
      sportsbook: str(sideObj.book) ?? str(sideObj.sportsbook),
    };
  }
  return {
    price: num(obj.odds) ?? num(obj.odds_american),
    sportsbook: str(obj.book) ?? str(obj.sportsbook),
  };
}

function linesAtLockPrice(record: RehydratedPredictionRecord): { price: number | null; sportsbook: string | null } {
  const raw = record.snapshot_json?.lines_at_lock;
  if (!Array.isArray(raw)) return { price: null, sportsbook: null };
  const marketType = record.market === "first_inning" ? "first_inning_total" : record.market;
  const match = raw.find((row): row is Record<string, unknown> => {
    if (!row || typeof row !== "object") return false;
    return str(row.market_type) === marketType &&
      (!record.side || str(row.side) === record.side) &&
      typeof row.odds_american === "number";
  });
  if (!match) return { price: null, sportsbook: null };
  return {
    price: num(match.odds_american),
    sportsbook: str(match.book) ?? str(match.sportsbook),
  };
}

function effectiveLockedPrice(record: RehydratedPredictionRecord): { price: number | null; sportsbook: string | null; source: "prediction_records" | "snapshot_json" | "unavailable" } {
  if (record.odds_american !== null) return { price: record.odds_american, sportsbook: null, source: "prediction_records" };
  const candidates = [
    oddsSourceAtLockPrice(record),
    linesAtLockPrice(record),
    { price: auditPrice(record), sportsbook: null },
    postedLinePrice(record),
  ];
  for (const candidate of candidates) {
    if (typeof candidate.price === "number" && Number.isFinite(candidate.price)) {
      return { price: candidate.price, sportsbook: candidate.sportsbook, source: "snapshot_json" };
    }
  }
  return { price: null, sportsbook: null, source: "unavailable" };
}

function oddsSource(record: RehydratedPredictionRecord): { sportsbook: string | null; source: "prediction_records" | "snapshot_json" | "unavailable" } {
  if (record.odds_american !== null) return { sportsbook: null, source: "prediction_records" };
  const effective = effectiveLockedPrice(record);
  if (effective.source === "snapshot_json") return { sportsbook: effective.sportsbook, source: "snapshot_json" };
  const marketKey = record.market === "moneyline" ? "ml" : record.market === "total" ? "ou" : "fi";
  const raw = record.snapshot_json?.[`odds_source_at_lock_${marketKey}`];
  if (raw && typeof raw === "object") {
    const sportsbook = str((raw as Record<string, unknown>).sportsbook) ?? str((raw as Record<string, unknown>).book);
    return { sportsbook, source: "snapshot_json" };
  }
  return { sportsbook: null, source: "unavailable" };
}

export function buildRehydratedLockedMarketPayload(record: RehydratedPredictionRecord): RehydratedLockedMarketPayload {
  const splits = splitRows(record);
  const sourceAwareConsensus = snapshotSourceAwareRows(record.snapshot_json, record.market, "consensus")
    .map((row) => ({ ...row, label: sideLabel(row.side, record.market, record.matchup) }));
  const sourceAwareSharp = snapshotSourceAwareRows(record.snapshot_json, record.market, "sharp")
    .map((row) => ({ ...row, label: sideLabel(row.side, record.market, record.matchup) }));
  const movement = lineMovement(record.snapshot_json);
  const read = reconstructRead(record, splits);
  const effectivePrice = effectiveLockedPrice(record);
  const source = effectivePrice.source === "unavailable" ? oddsSource(record) : { sportsbook: effectivePrice.sportsbook, source: effectivePrice.source };
  const originalGrade = normalizePublicGrade(record.play_grade, record);
  const marketImpliedPct = marketImpliedProbabilityPct(record, effectivePrice.price);
  const computedEdgePct = edgePct(record, marketImpliedPct);
  const isFiTossUp = record.market === "first_inning" && /toss[\s-]*up/i.test(record.pick ?? "");
  const marketSignalRows = snapshotSignalRows(record.snapshot_json, record.market);
  const hasSharpSignal = sourceAwareSharp.length > 0 || marketSignalRows.some((row) =>
    str(row.signal_strength) !== null ||
    num(row.ev_pct) !== null ||
    row.is_plus_ev === true ||
    num(row.pinnacle_fair_probability) !== null ||
    row.has_steam_move === true ||
    row.has_reverse_line_movement === true ||
    str(row.rlm_direction) !== null
  );
  const sharpSignal = hasSharpSignal
    ? "Historical lock-time sharp book signal fields were present."
    : null;
  const payloadWithoutHash = {
    schemaVersion: "rehydrated-locked-card-v1" as const,
    sport: record.sport,
    slateDate: record.slate_date,
    gameId: record.game_id,
    externalId: record.external_id,
    matchup: record.matchup,
    market: record.market,
    pick: record.pick,
    selectedSide: record.side,
    originalGrade,
    displayPriceAmerican: effectivePrice.price,
    priceSource: source.source,
    priceNullReason: effectivePrice.price === null
      ? isFiTossUp
        ? "fi_toss_up_no_actionable_side_price_not_required"
        : "historical_locked_price_not_persisted"
      : null,
    sportsbook: source.sportsbook,
    marketImpliedProbabilityPct: marketImpliedPct,
    modelProbabilityPct: toPct(record.model_probability),
    edgePct: computedEdgePct,
    projectedScore: projectedScore(record.snapshot_json),
    lineValue: record.line_value,
    openLineValue: num(movement?.total_open),
    currentLineValue: num(movement?.total_current) ?? record.line_value,
    openPriceAmerican: num(movement?.open_odds_american),
    currentPriceAmerican: num(movement?.current_odds_american) ?? effectivePrice.price,
    lockedPriceAmerican: effectivePrice.price,
    lineMovementDirection: str(movement?.direction),
    consensusSplits: {
      available: splits.length > 0,
      rows: splits,
      source: sourceAwareConsensus.length > 0
        ? "snapshot_source_aware_split_rows_at_lock" as const
        : splits.length > 0 ? "snapshot_signal_rows_at_lock" as const : "historical_source_not_persisted" as const,
      freshness: splits.length > 0 ? "fresh_at_lock" as const : "historical_source_not_persisted" as const,
    },
    sharpBookSplitsOrSignal: {
      available: hasSharpSignal,
      label: sourceAwareSharp.length > 0 ? "Sharp Book Splits" as const : hasSharpSignal ? "Sharp Book Signal" as const : null,
      rows: sourceAwareSharp,
      signal: sourceAwareSharp.length > 0 ? null : sharpSignal,
      source: sourceAwareSharp.length > 0
        ? "snapshot_source_aware_split_rows_at_lock" as const
        : hasSharpSignal ? "snapshot_signal_rows_at_lock" as const : "historical_source_not_persisted" as const,
      freshness: hasSharpSignal ? "fresh_at_lock" as const : "historical_source_not_persisted" as const,
    },
    sourceAvailability: {
      consensusSplitsAvailable: splits.length > 0,
      sharpBookSplitsOrSignalAvailable: hasSharpSignal,
      historicalMarketReadPersisted: read.source === "persisted",
      historicalMarketReadReconstructed: read.source === "reconstructed",
      historicalMarketReadMissingReason: read.source === "historical_market_read_not_persisted"
        ? "historical_market_read_not_persisted"
        : null,
    },
    sourceConflict: read.status === "mixed" ? true : read.source === "historical_market_read_not_persisted" ? null : false,
    marketRead: read,
    dataWarnings: dataWarnings(record.snapshot_json, record.market),
    fiContext: {
      isFirstInning: record.market === "first_inning",
      oddsAvailable: record.market === "first_inning" ? effectivePrice.price !== null : false,
      marketProbabilityAvailable: record.market === "first_inning" ? (record.market_probability !== null || isFiTossUp) : false,
      expectedSplitSourceAvailable: false,
      note: record.market === "first_inning"
        ? isFiTossUp
          ? "FI locked as Toss-Up: no actionable YRFI/NRFI side, so picked-side price/value is not required. FI split source is not expected and should not be treated as a data failure."
          : "FI price/model/market fields are actionable; FI consensus/sharp split source is not expected historically and should not force a downgrade by itself."
        : null,
    },
    lock: {
      asOfTimestamp: record.locked_at,
      lockedAt: record.locked_at,
    },
    postgameExcludedFromAiPayload: true as const,
  };
  return {
    ...payloadWithoutHash,
    payloadHash: crypto.createHash("sha256").update(stableJson(payloadWithoutHash)).digest("hex"),
  };
}
