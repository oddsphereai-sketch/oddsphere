import type {
  MarketIntelligenceMarketType,
  MarketReadValidityStatus,
} from "../../types/domain/MarketIntelligenceV2";

export type MarketIntelligenceSnapshotV2Row = {
  id: number;
  canonical_event_id: string;
  canonical_market_id: string;
  selection_key: string;
  league: string;
  market_type: MarketIntelligenceMarketType;
  resolver_version: string;
  score: number;
  label: string;
  explanation: string;
  evidence_json: unknown;
  generated_at: string;
  evidence_as_of: string | null;
  event_start_time: string | null;
  recommendation_snapshot_id: number | null;
  recommendation_locked_at: string | null;
  selected_side: string | null;
  selected_line: number | null;
  selected_price: number | null;
  validity_status: MarketReadValidityStatus;
};

export type MarketReadSelectionMode =
  | { kind: "unlocked"; responseAsOf: string }
  | { kind: "locked"; recommendationLockedAt: string; recommendationSnapshotId?: number | null };

function timeMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function atOrBefore(raw: string | null | undefined, cutoff: number): boolean {
  const t = timeMs(raw);
  return t !== null && t <= cutoff;
}

function evidenceOrGeneratedAtOrBefore(row: MarketIntelligenceSnapshotV2Row, cutoff: number): boolean {
  return row.evidence_as_of !== null
    ? atOrBefore(row.evidence_as_of, cutoff)
    : atOrBefore(row.generated_at, cutoff);
}

function isValidStatus(status: MarketReadValidityStatus): boolean {
  return status === "valid_directional" || status === "valid_nondirectional";
}

export function selectMarketIntelligenceSnapshotV2(opts: {
  rows: readonly MarketIntelligenceSnapshotV2Row[];
  mode: MarketReadSelectionMode;
  canonicalEventId: string;
  marketType: MarketIntelligenceMarketType;
  selectionKey: string;
}): MarketIntelligenceSnapshotV2Row | null {
  const cutoff =
    opts.mode.kind === "locked"
      ? timeMs(opts.mode.recommendationLockedAt)
      : timeMs(opts.mode.responseAsOf);
  if (cutoff === null) return null;

  const candidates = opts.rows.filter((row) => {
    if (row.canonical_event_id !== opts.canonicalEventId) return false;
    if (row.market_type !== opts.marketType) return false;
    if (row.selection_key !== opts.selectionKey) return false;
    if (!isValidStatus(row.validity_status)) return false;
    // Lock means the rendered market read existed by the lock instant—not
    // merely that a later-generated read reused older evidence. Otherwise a
    // post-lock resolver run can rewrite the frozen card and its split copy.
    if (!atOrBefore(row.generated_at, cutoff)) return false;
    if (!evidenceOrGeneratedAtOrBefore(row, cutoff)) return false;

    const start = timeMs(row.event_start_time);
    if (start !== null) {
      if (!evidenceOrGeneratedAtOrBefore(row, start)) return false;
    }

    if (opts.mode.kind === "locked") {
      if (
        row.recommendation_locked_at !== null &&
        !evidenceOrGeneratedAtOrBefore(row, timeMs(row.recommendation_locked_at) ?? cutoff)
      ) return false;
      if (
        opts.mode.recommendationSnapshotId !== null &&
        opts.mode.recommendationSnapshotId !== undefined &&
        row.recommendation_snapshot_id !== opts.mode.recommendationSnapshotId
      ) {
        return false;
      }
    }
    return true;
  });

  candidates.sort((a, b) => {
    const generated = (timeMs(b.generated_at) ?? 0) - (timeMs(a.generated_at) ?? 0);
    if (generated !== 0) return generated;
    return (timeMs(b.evidence_as_of) ?? 0) - (timeMs(a.evidence_as_of) ?? 0);
  });

  return candidates[0] ?? null;
}
