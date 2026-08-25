import type { MarketSplitDisplaySection } from "@/lib/types/domain/RecommendationDecision";

const DEFAULT_SPLIT_STALE_AFTER_MINUTES = 75;

export function marketSplitSectionIsStale(
  section: MarketSplitDisplaySection | null,
  nowMs = Date.now(),
): boolean {
  if (!section) return false;
  if (section.rows.some((row) => row.isStale === true)) return true;
  const timestampedRows = section.rows.filter((row) => Boolean(row.observedAt));
  if (timestampedRows.length > 0) {
    return timestampedRows.some((row) => {
      const observedAtMs = Date.parse(row.observedAt!);
      const staleAfterMinutes = Number.isFinite(row.staleAfterMinutes)
        ? Math.max(1, row.staleAfterMinutes!)
        : DEFAULT_SPLIT_STALE_AFTER_MINUTES;
      return Number.isFinite(observedAtMs) && nowMs - observedAtMs > staleAfterMinutes * 60 * 1000;
    });
  }
  if (!section.lastUpdated) return false;
  const observedAtMs = Date.parse(section.lastUpdated);
  return Number.isFinite(observedAtMs) &&
    nowMs - observedAtMs > DEFAULT_SPLIT_STALE_AFTER_MINUTES * 60 * 1000;
}
