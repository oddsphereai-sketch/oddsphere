/** Uncalibrated, offline hypotheses for proper prospective scoring. Never production probabilities. */
import type { GamePacket } from "./catalog";
import { etDate, eventTarget, instant, invariant, validateReview, type Review } from "./core";
export const AI_REVIEW_BEHAVIOR_RELEASE = "player_props_ai_research_2026_11_06_r8_source_clock_process";
export function probabilityProposals(packet: GamePacket, review: Review, model: string, issuedAt: string) {
  validateReview(packet, review);
  return review.players.flatMap(p => p.markets.map(m => {
    const target = eventTarget(packet, p.playerId, m.market), probability = m.proposedEventProbability ?? null;
    invariant(probability === null || target.probabilityBenchmarkEligible, "Probability supplied without a supported exact event target");
    return { id: `${packet.sport}|${packet.gameId}|${etDate(packet.start)}|${p.playerId}|${m.market}|${target.line}|${target.event}`,
      candidateRelease: `${AI_REVIEW_BEHAVIOR_RELEASE}:${model}`, baselineRelease: target.source,
      sport: packet.sport, gameId: packet.gameId, playerId: p.playerId, market: m.market, stage: packet.stage,
      line: target.line, event: target.event, lock: packet.lock, featureCutoff: packet.cutoff, issuedAt,
      uncalibratedProbability: probability, independentBaselineProbability: target.baselineProbability,
      pointProjection: m.proposedProjection, evidence: m.evidenceIds, productionQualified: false,
      restrictions: ["raw AI hypothesis, not calibrated confidence", "full joint-law and grade/stake adapters not qualified", "retrospective/rehearsal issues excluded by prospective scoring"] };
  }));
}
export type ProbabilityProposal = ReturnType<typeof probabilityProposals>[number];
export type SettledOutcome = { id: string; status: "settled" | "void" | "push"; stat: number | null; availableAt: string; source: string };
export function scoreProspective(proposals: ProbabilityProposal[], outcomes: SettledOutcome[]) {
  invariant(new Set(proposals.map(p => `${p.candidateRelease}|${p.stage}|${p.id}`)).size === proposals.length, "Duplicate stage forecasts; predeclare one admissible issue, not best-of-retries");
  const byId = new Map(outcomes.map(o => [o.id, o]));
  invariant(byId.size === outcomes.length, "Duplicate outcomes");
  for (const p of proposals) {
    invariant([p.uncalibratedProbability, p.independentBaselineProbability].every(v => v === null || Number.isFinite(v) && v >= 0 && v <= 1), "Invalid forecast probability");
    invariant(p.uncalibratedProbability === null || Number.isFinite(p.line) && ["over", "at_least"].includes(p.event!), "Invalid exact forecast event");
    invariant(instant(p.featureCutoff) < instant(p.lock), "Feature cutoff must precede lock");
  }
  const rows = proposals.map(p => {
    const outcome = byId.get(p.id);
    const reason = instant(p.issuedAt) >= instant(p.lock) ? "issued_after_lock" : instant(p.featureCutoff) > instant(p.issuedAt) ? "future_feature_cutoff" : p.uncalibratedProbability === null ? "no_probability_proposal" : !outcome ? "awaiting_outcome" : outcome.status !== "settled" ? outcome.status : null;
    if (reason) return { id: p.id, scored: false as const, reason };
    invariant(outcome && outcome.stat !== null && Number.isFinite(outcome.stat) && instant(outcome.availableAt) > instant(p.lock) && outcome.source, "Invalid official outcome provenance");
    const won = p.event === "at_least" ? outcome.stat >= p.line! : outcome.stat > p.line!;
    const brier = (probability: number) => (probability - Number(won)) ** 2;
    const log = (probability: number) => { const v = Math.max(1e-12, Math.min(1 - 1e-12, probability)); return -(Number(won) * Math.log(v) + Number(!won) * Math.log(1 - v)); };
    return { id: p.id, scored: true as const, gameId: p.gameId, group: `${p.sport}|${p.market}|${p.stage}|${p.baselineRelease}|${p.candidateRelease}`,
      outcome: Number(won), candidateBrier: brier(p.uncalibratedProbability!), candidateLogLoss: log(p.uncalibratedProbability!),
      baselineBrier: p.independentBaselineProbability === null ? null : brier(p.independentBaselineProbability),
      baselineLogLoss: p.independentBaselineProbability === null ? null : log(p.independentBaselineProbability) };
  });
  return { candidateQualified: false, rows, pending: rows.filter(r => !r.scored && r.reason === "awaiting_outcome").length,
    excluded: rows.filter(r => !r.scored && r.reason !== "awaiting_outcome").length,
    notes: ["group by release, market and locked timestamp; do not mix cohorts", "cluster uncertainty by game; multiple props are correlated", "void/DNP is never scored as an Under win"] };
}
