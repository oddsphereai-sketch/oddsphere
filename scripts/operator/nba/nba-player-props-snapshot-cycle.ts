import type { NbaPlayerPropPriceObservation } from "../../../lib/services/nba/nbaPlayerPropsContract";

/**
 * Recover the provider cycle that produced a stored snapshot.
 *
 * Market history contains openings and many refreshes. Production scores only
 * the current observations returned by one provider refresh, so replaying the
 * entire history as current can manufacture duplicate canonical scopes or
 * select a quote that was not present when the snapshot was written.
 */
export function selectNbaPlayerPropsSnapshotCurrentObservations(
  observations: readonly NbaPlayerPropPriceObservation[],
  snapshotGeneratedAt: string,
): NbaPlayerPropPriceObservation[] {
  const snapshotGeneratedMs = Date.parse(snapshotGeneratedAt);
  if (!Number.isFinite(snapshotGeneratedMs)) throw new Error("NBA props snapshot has an invalid generatedAt timestamp.");
  const eligible = observations.filter((row) => !row.isOpening && !row.isLive);
  const currentCycleFetchedAt = eligible.reduce<string | null>((closest, row) => {
    if (closest === null) return row.fetchedAt;
    return Math.abs(Date.parse(row.fetchedAt) - snapshotGeneratedMs)
      < Math.abs(Date.parse(closest) - snapshotGeneratedMs)
      ? row.fetchedAt
      : closest;
  }, null);
  if (!currentCycleFetchedAt) throw new Error("Stored market history has no current NBA prop observation cycle.");
  return eligible.filter((row) => row.fetchedAt === currentCycleFetchedAt);
}
