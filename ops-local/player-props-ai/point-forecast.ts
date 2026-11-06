/** Offline point-forecast bridge. Distribution calibration/grades remain separate qualification work. */
import { COMBOS, type GamePacket } from "./catalog";
import { invariant, validateReview, type Review } from "./core";
export function pointForecasts(packet: GamePacket, review: Review) {
  validateReview(packet, review);
  return review.players.flatMap(p => {
    const source = packet.players.find(player => player.id === p.playerId)!;
    const projections = new Map(p.markets.map(m => [m.market, m.proposedProjection]));
    const terms: Record<string, [string, number][]> = {
      batter_hits: [["batter_singles", 1], ["batter_doubles", 1], ["batter_triples", 1], ["batter_home_runs", 1]],
      batter_total_bases: [["batter_singles", 1], ["batter_doubles", 2], ["batter_triples", 3], ["batter_home_runs", 4]],
      ...Object.fromEntries(Object.entries(COMBOS).map(([market, components]) => [market, components.map(c => [c, 1] as [string, number])])),
    };
    const derived = new Set<string>();
    for (const [market, components] of Object.entries(terms)) if (components.every(([c]) => typeof projections.get(c) === "number")) {
      projections.set(market, components.reduce((n, [c, w]) => n + projections.get(c)! * w, 0)); derived.add(market);
    }
    if (packet.sport === "nba" && typeof projections.get("points") === "number" && typeof projections.get("threes") === "number") invariant(projections.get("points")! >= 3 * projections.get("threes")!, "NBA points cannot be below three times made threes");
    if (packet.sport === "nfl" && typeof projections.get("passing_completions") === "number" && typeof projections.get("passing_attempts") === "number") invariant(projections.get("passing_completions")! <= projections.get("passing_attempts")!, "Completions exceed attempts");
    return p.markets.map(m => {
      const baselineEvidence = source.evidence.find(e => e.kind === "independent_model" && e.value && typeof e.value === "object" && !Array.isArray(e.value) && e.value.market === m.market);
      const value = baselineEvidence?.value as { independentProjection?: number | null; line?: number | null } | undefined;
      const baseline = typeof value?.independentProjection === "number" ? value.independentProjection : null;
      const canDerive = derived.has(m.market), proposed = projections.get(m.market) ?? null;
      if (proposed !== null) invariant(Number.isFinite(proposed) && (m.market.endsWith("yards") || proposed >= 0), "Invalid stat units/sign");
      if (m.market === "anytime_td") invariant(proposed === null, "Binary event requires a calibrated event law, not a point-mean proxy");
      const delta = proposed !== null && baseline !== null ? proposed - baseline : null;
      const direction = delta === null ? "insufficient_evidence" : Math.abs(delta) < 1e-6 ? "retain" : delta > 0 ? "raise" : "lower";
      const directionConsistent = canDerive || m.forecastDirection === "insufficient_evidence" || direction === "insufficient_evidence" || direction === m.forecastDirection;
      return { gameId: packet.gameId, playerId: source.id, sport: packet.sport, market: m.market,
        line: value?.line ?? null, independentProjection: baseline, aiProposedProjection: m.proposedProjection,
        coherentPointProjection: proposed, derivedFromComponents: !!canDerive, delta, direction, declaredDirection: m.forecastDirection, directionConsistent,
        evidence: m.evidenceIds, probability: null, grade: null, stake: null, productionQualified: false };
    });
  });
}
