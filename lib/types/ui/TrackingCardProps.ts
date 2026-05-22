import type { Sport } from "../domain/Sport";
import type { TimeWindow, TrackingAggregate } from "../domain/Tracking";

/**
 * Props for a Tracking page per-sport card.
 *
 * Each card shows one sport's per-market breakdown for a single time window.
 * Top-level sport totals are intentionally NOT supported — Daniel rejected
 * aggregate sport-level numbers on the Tracking page (per FOUNDATION.md).
 */
export type TrackingCardProps = {
  sport: Sport;
  timeWindow: TimeWindow;
  aggregates: TrackingAggregate[]; // per-market rows for this sport+window
};
