import type { EplForwardBookVector } from "@/lib/services/epl/eplForwardEvidenceCapture";

export const UCL_BTTS_MARKET_SHADOW_RELEASE =
  "ucl_btts_market_shadow_2026_10_20_r1_target_excluded_consensus" as const;

type Side = "yes" | "no";

export type UclBttsMarketShadow = {
  release: typeof UCL_BTTS_MARKET_SHADOW_RELEASE;
  productionAuthority: false;
  available: boolean;
  modelYes: number;
  consensusYes: number | null;
  candidateYes: number;
  modelSide: Side;
  consensusSide: Side | null;
  candidateSide: Side;
  eligibleBooks: string[];
  leaveOneOutYesRange: { minimum: number; maximum: number } | null;
  agreement: number;
  dispersion: number | null;
  authority: number;
  gateReasons: string[];
};

const EXCLUDED_BOOKS = new Set(["polymarket", "kalshi"]);
const clip = (value: number) => Math.max(1e-8, Math.min(1 - 1e-8, value));
const logit = (value: number) => Math.log(clip(value) / (1 - clip(value)));
const sigmoid = (value: number) => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function vectorYes(vector: EplForwardBookVector): number | null {
  const yes = vector.outcomes.find((outcome) => outcome.side === "yes")?.noVigProbability;
  const no = vector.outcomes.find((outcome) => outcome.side === "no")?.noVigProbability;
  if (typeof yes !== "number" || typeof no !== "number" || !Number.isFinite(yes) || !Number.isFinite(no) || yes <= 0 || no <= 0) return null;
  return yes / (yes + no);
}

function ineligibleReason(input: {
  vector: EplForwardBookVector;
  evaluatedBook: string | null;
  providerEventId: string | null;
  decisionAt: number;
  kickoff: number;
}): string | null {
  const { vector } = input;
  if (vector.market !== "btts") return "not_btts";
  if (!vector.canonicalBook || vector.canonicalBook === input.evaluatedBook) return "evaluated_canonical_book_excluded";
  if (EXCLUDED_BOOKS.has(vector.canonicalBook)) return "prediction_market_excluded";
  if (vector.sourceClass !== "named_originator" && vector.sourceClass !== "named_retail" && vector.sourceClass !== "named_other") return "source_not_named_book";
  if (!input.providerEventId || vector.providerEventId !== input.providerEventId) return "provider_event_identity_mismatch";
  if (vectorYes(vector) === null) return "complete_two_sided_probability_missing";
  const timestamps = vector.outcomes.map((outcome) => Date.parse(outcome.fetchedAt ?? ""));
  if (timestamps.length !== 2 || timestamps.some((value) => !Number.isFinite(value))) return "outcome_timestamp_missing";
  if (Math.max(...timestamps) > input.decisionAt || Math.max(...timestamps) >= input.kickoff) return "outcome_timestamp_future_or_postdecision";
  return null;
}

export function deriveUclBttsMarketShadow(input: {
  modelYes: number;
  vectors: EplForwardBookVector[];
  evaluatedBook: string | null;
  providerEventId: string | null;
  decisionAt: string;
  kickoff: string;
}): UclBttsMarketShadow {
  const decisionAt = Date.parse(input.decisionAt);
  const kickoff = Date.parse(input.kickoff);
  const gateReasons: string[] = [];
  const eligibleByBook = new Map<string, EplForwardBookVector>();
  if (!Number.isFinite(decisionAt) || !Number.isFinite(kickoff) || decisionAt >= kickoff) {
    gateReasons.push("decision_not_strictly_pregame");
  } else {
    for (const vector of input.vectors) {
      const reason = ineligibleReason({ vector, evaluatedBook: input.evaluatedBook, providerEventId: input.providerEventId, decisionAt, kickoff });
      if (reason) continue;
      const prior = eligibleByBook.get(vector.canonicalBook);
      if (!prior || Date.parse(vector.fetchedAtMax ?? "") > Date.parse(prior.fetchedAtMax ?? "")) eligibleByBook.set(vector.canonicalBook, vector);
    }
  }
  const eligible = [...eligibleByBook.values()].sort((left, right) => left.canonicalBook.localeCompare(right.canonicalBook));
  const yes = eligible.map((vector) => vectorYes(vector)!);
  if (yes.length < 3) gateReasons.push("eligible_target_excluded_books_below_3");
  const consensusYes = yes.length >= 3 ? median(yes) : null;
  const leaveOneOut = yes.length >= 3 ? yes.map((_, index) => median(yes.filter((__, candidate) => candidate !== index))) : [];
  const consensusSide: Side | null = consensusYes === null ? null : consensusYes >= 0.5 ? "yes" : "no";
  const leaveOneOutStable = consensusSide !== null && leaveOneOut.every((value) => (value >= 0.5 ? "yes" : "no") === consensusSide);
  if (consensusYes !== null && !leaveOneOutStable) gateReasons.push("leave_one_out_side_unstable");
  const agreement = consensusSide === null ? 0 : yes.filter((value) => (value >= 0.5 ? "yes" : "no") === consensusSide).length / yes.length;
  const dispersion = consensusYes === null ? null : yes.reduce((sum, value) => sum + Math.abs(value - consensusYes), 0) / yes.length;
  if (dispersion !== null && dispersion > 0.06) gateReasons.push("consensus_dispersion_above_0_06");
  const available = consensusYes !== null && leaveOneOutStable && dispersion !== null && dispersion <= 0.06;
  const stability = dispersion === null ? 0 : Math.max(0, 1 - dispersion / 0.06);
  const authority = available ? 0.30 * agreement * stability : 0;
  const candidateYes = available ? sigmoid((1 - authority) * logit(input.modelYes) + authority * logit(consensusYes)) : input.modelYes;
  return {
    release: UCL_BTTS_MARKET_SHADOW_RELEASE,
    productionAuthority: false,
    available,
    modelYes: input.modelYes,
    consensusYes,
    candidateYes,
    modelSide: input.modelYes >= 0.5 ? "yes" : "no",
    consensusSide,
    candidateSide: candidateYes >= 0.5 ? "yes" : "no",
    eligibleBooks: eligible.map((vector) => vector.canonicalBook),
    leaveOneOutYesRange: leaveOneOut.length ? { minimum: Math.min(...leaveOneOut), maximum: Math.max(...leaveOneOut) } : null,
    agreement,
    dispersion,
    authority,
    gateReasons,
  };
}
