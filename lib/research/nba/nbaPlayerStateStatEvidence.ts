import { decodeNbaPlayerStatObservation, selectNbaPlayerStatEvidenceAtCutoff } from "../../services/nba/nbaPlayerStatEvidence";
import type { NbaPlayerStateObservation } from "./nbaPlayerStateLedger";

/** Reuses the released correction/reversion selector. Normalized stat receipts
 * are not raw HTTP or historical first-publication evidence. No new collector. */
export function nbaPlayerStateStatsFromRetainedEvidence(args: { cutoff: string; targetGameId: number;
  observations: readonly unknown[]; bodies: ReadonlyMap<string, unknown> }): NbaPlayerStateObservation[] {
  const cutoff = Date.parse(args.cutoff); if (!Number.isFinite(cutoff)) throw Error("invalid_cutoff");
  const references = args.observations.filter(value => {
    if (!value || typeof value !== "object") throw Error("invalid_reference");
    const clocks = value as { firstRetainedAt: string; sourceStateUpdatedAt: string };
    const seen = Date.parse(clocks.firstRetainedAt), source = Date.parse(clocks.sourceStateUpdatedAt);
    if (!Number.isFinite(seen) || !Number.isFinite(source)) throw Error("invalid_reference_clock");
    return seen <= cutoff && source <= cutoff;
  }).map(decodeNbaPlayerStatObservation);
  const gameIds = [...new Set(references.filter(o => Date.parse(o.firstRetainedAt) <= cutoff && Date.parse(o.sourceStateUpdatedAt) <= cutoff)
    .map(o => o.gameId))].sort((a, b) => a - b);
  const result: NbaPlayerStateObservation[] = [];
  for (const gameId of gameIds) {
    const body = selectNbaPlayerStatEvidenceAtCutoff({ ...args, gameId }); if (!body) continue;
    const eligible = references.filter(o => o.gameId === gameId && Date.parse(o.firstRetainedAt) <= cutoff && Date.parse(o.sourceStateUpdatedAt) <= cutoff)
      .sort((a, b) => Date.parse(b.sourceStateUpdatedAt) - Date.parse(a.sourceStateUpdatedAt) || a.bodyKey.localeCompare(b.bodyKey));
    const ref = eligible[0]!;
    const receipt = { provider: "balldontlie" as const, publishedAt: ref.sourceStateUpdatedAt, effectiveAt: ref.sourceStateUpdatedAt,
      fetchedAt: ref.firstRetainedAt, payloadSha256: ref.bodySha256, collectorRelease: ref.release };
    for (const teamId of [body.game.homeTeamId, body.game.awayTeamId]) {
      const boxes = body.boxes.filter(b => b.teamId === teamId && b.minutes > 0);
      const players = boxes.map(box => {
        const advanced = body.advanced.filter(a => a.teamId === teamId && a.playerId === box.playerId && a.period === 0);
        if (advanced.length !== 1) throw Error("ambiguous_or_missing_player_advanced");
        return { nativePlayer: `balldontlie:${box.playerId}` as const, minutes: box.minutes,
          estimatedNet: advanced[0]!.estimatedNetRating, pie: advanced[0]!.playerImpactEstimate ?? null };
      });
      result.push({ ...receipt, id: `${ref.bodyKey}:${ref.sourceStateUpdatedAt}:team:${teamId}`, kind: "stat", gameId,
        teamId, season: body.season, startedAt: body.game.startTime, final: true,
        complete: body.coverage.completeForRotationResearch, players });
      // Native BALLDONTLIE identities are self-identities, never cross-provider name matches.
      for (const box of boxes) result.push({ ...receipt, id: `${ref.bodyKey}:${ref.sourceStateUpdatedAt}:identity:${box.playerId}`, kind: "identity",
        nativePlayer: `balldontlie:${box.playerId}`, playerId: box.playerId });
    }
  }
  return result;
}
