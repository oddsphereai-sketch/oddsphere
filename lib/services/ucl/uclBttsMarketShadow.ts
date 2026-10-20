import type { EplForwardBookVector } from "@/lib/services/epl/eplForwardEvidenceCapture";

export const UCL_BTTS_MARKET_SHADOW_RELEASE =
  "ucl_btts_market_shadow_2026_10_20_r2_three_lane_target_excluded" as const;

type Side = "yes" | "no";
type Lane = "unavailable" | "aligned" | "conflicted" | "corrected";
type MovementSide = Side | "stable" | null;
type EvidenceQuality = "thin" | "medium" | "strong";
type Verdict = "no_play" | "watchlist" | "lean";

export type UclBttsHistoryObservation = {
  providerId: number;
  market: "match_result" | "double_chance" | "total" | "btts";
  side: string;
  american: number;
  sportsbook: string | null;
  recordedAt: string;
};

export type UclBttsMarketShadow = {
  release: typeof UCL_BTTS_MARKET_SHADOW_RELEASE;
  productionAuthority: false;
  available: boolean;
  lane: Lane;
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
  baseAuthority: number;
  authority: number;
  modelEvidenceQuality: EvidenceQuality;
  movementBooks: string[];
  movementYesDelta: number | null;
  movementSide: MovementSide;
  movementCorroboratesConsensus: boolean;
  movementResistsConsensus: boolean;
  currentVerdict: Verdict | null;
  candidateVerdict: Verdict | null;
  gradeEffect: "promotion" | "demotion" | "unchanged" | "unavailable";
  candidatePriceAmerican: number | null;
  gateReasons: string[];
};

const EXCLUDED_BOOKS = new Set(["polymarket", "kalshi"]);
const clip = (value: number) => Math.max(1e-8, Math.min(1 - 1e-8, value));
const logit = (value: number) => Math.log(clip(value) / (1 - clip(value)));
const sigmoid = (value: number) => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
const canonicalBook = (value: string | null) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

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

function rawImplied(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}

function noVigYes(yesAmerican: number, noAmerican: number): number | null {
  const yes = rawImplied(yesAmerican);
  const no = rawImplied(noAmerican);
  return yes === null || no === null || yes + no <= 0 ? null : yes / (yes + no);
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

function evidenceQuality(input: {
  homeStatMatches: number;
  awayStatMatches: number;
  homeXgMatches: number;
  awayXgMatches: number;
  promotedProxy: boolean;
} | undefined): EvidenceQuality {
  if (!input || input.promotedProxy) return "thin";
  const statMatches = Math.min(input.homeStatMatches, input.awayStatMatches);
  const xgMatches = Math.min(input.homeXgMatches, input.awayXgMatches);
  if (statMatches >= 5 && xgMatches >= 3) return "strong";
  if (statMatches >= 3 && xgMatches >= 2) return "medium";
  return "thin";
}

function movement(input: {
  providerId: number | undefined;
  history: UclBttsHistoryObservation[];
  eligible: EplForwardBookVector[];
  decisionAt: number;
  kickoff: number;
}): { books: string[]; delta: number | null; side: MovementSide } {
  if (input.providerId === undefined) return { books: [], delta: null, side: null };
  const deltas: Array<{ book: string; delta: number }> = [];
  for (const vector of input.eligible) {
    const currentYes = vectorYes(vector);
    if (currentYes === null) continue;
    const rows = input.history.filter((row) => row.providerId === input.providerId
      && row.market === "btts"
      && canonicalBook(row.sportsbook) === vector.canonicalBook
      && Number.isFinite(Date.parse(row.recordedAt))
      && Date.parse(row.recordedAt) < input.decisionAt
      && Date.parse(row.recordedAt) < input.kickoff);
    const byCapture = new Map<string, Partial<Record<Side, number>>>();
    for (const row of rows) {
      if (row.side !== "yes" && row.side !== "no") continue;
      const capture = byCapture.get(row.recordedAt) ?? {};
      capture[row.side] = row.american;
      byCapture.set(row.recordedAt, capture);
    }
    const opening = [...byCapture.entries()]
      .sort(([left], [right]) => Date.parse(left) - Date.parse(right))
      .map(([, prices]) => prices.yes === undefined || prices.no === undefined ? null : noVigYes(prices.yes, prices.no))
      .find((value): value is number => value !== null);
    if (opening !== undefined) deltas.push({ book: vector.canonicalBook, delta: currentYes - opening });
  }
  if (deltas.length < 2) return { books: deltas.map((row) => row.book).sort(), delta: null, side: null };
  const delta = median(deltas.map((row) => row.delta));
  return {
    books: deltas.map((row) => row.book).sort(),
    delta,
    side: delta >= 0.01 ? "yes" : delta <= -0.01 ? "no" : "stable",
  };
}

function expectedValue(probability: number, american: number): number {
  const decimal = american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
  return probability * decimal - 1;
}

function verdict(probability: number, price: number | null): Verdict | null {
  if (price === null || !Number.isFinite(price)) return null;
  if (probability >= 0.55 && expectedValue(probability, price) > 0) return "lean";
  if (probability >= 0.53) return "watchlist";
  return "no_play";
}

const verdictRank: Record<Verdict, number> = { no_play: 0, watchlist: 1, lean: 2 };

export function deriveUclBttsMarketShadow(input: {
  modelYes: number;
  vectors: EplForwardBookVector[];
  evaluatedBook: string | null;
  evaluatedPrices?: Partial<Record<Side, number>> | null;
  providerEventId: string | null;
  providerId?: number;
  history?: UclBttsHistoryObservation[];
  modelEvidence?: {
    homeStatMatches: number;
    awayStatMatches: number;
    homeXgMatches: number;
    awayXgMatches: number;
    promotedProxy: boolean;
  };
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
  const baseAuthority = available ? 0.30 * agreement * stability : 0;
  const movementRead = movement({ providerId: input.providerId, history: input.history ?? [], eligible, decisionAt, kickoff });
  if (movementRead.books.length < 2) gateReasons.push("target_excluded_movement_books_below_2");
  const movementCorroboratesConsensus = consensusSide !== null && movementRead.side === consensusSide;
  const movementResistsConsensus = consensusSide !== null && movementRead.side !== null && movementRead.side !== "stable" && movementRead.side !== consensusSide;
  const quality = evidenceQuality(input.modelEvidence);
  const movementMultiplier = movementCorroboratesConsensus ? 1.25 : movementResistsConsensus ? 0.75 : 1;
  const evidenceMultiplier = quality === "thin" ? 1.25 : quality === "medium" ? 1.10 : 1;
  const authority = available ? Math.min(0.45, baseAuthority * movementMultiplier * evidenceMultiplier) : 0;
  const candidateYes = available ? sigmoid((1 - authority) * logit(input.modelYes) + authority * logit(consensusYes)) : input.modelYes;
  const modelSide: Side = input.modelYes >= 0.5 ? "yes" : "no";
  const candidateSide: Side = candidateYes >= 0.5 ? "yes" : "no";
  const lane: Lane = !available || consensusSide === null
    ? "unavailable"
    : candidateSide !== modelSide
      ? "corrected"
      : consensusSide === modelSide
        ? "aligned"
        : "conflicted";
  const modelProbability = modelSide === "yes" ? input.modelYes : 1 - input.modelYes;
  const candidateProbability = candidateSide === "yes" ? candidateYes : 1 - candidateYes;
  const currentPrice = input.evaluatedPrices?.[modelSide] ?? null;
  const candidatePrice = input.evaluatedPrices?.[candidateSide] ?? null;
  const currentVerdict = verdict(modelProbability, currentPrice);
  let candidateVerdict = verdict(candidateProbability, candidatePrice);
  if (candidateVerdict === "lean" && ((lane === "conflicted" && movementCorroboratesConsensus) || lane === "corrected")) {
    candidateVerdict = "watchlist";
  }
  const gradeEffect = currentVerdict === null || candidateVerdict === null
    ? "unavailable"
    : verdictRank[candidateVerdict] > verdictRank[currentVerdict]
      ? "promotion"
      : verdictRank[candidateVerdict] < verdictRank[currentVerdict]
        ? "demotion"
        : "unchanged";
  return {
    release: UCL_BTTS_MARKET_SHADOW_RELEASE,
    productionAuthority: false,
    available,
    lane,
    modelYes: input.modelYes,
    consensusYes,
    candidateYes,
    modelSide,
    consensusSide,
    candidateSide,
    eligibleBooks: eligible.map((vector) => vector.canonicalBook),
    leaveOneOutYesRange: leaveOneOut.length ? { minimum: Math.min(...leaveOneOut), maximum: Math.max(...leaveOneOut) } : null,
    agreement,
    dispersion,
    baseAuthority,
    authority,
    modelEvidenceQuality: quality,
    movementBooks: movementRead.books,
    movementYesDelta: movementRead.delta,
    movementSide: movementRead.side,
    movementCorroboratesConsensus,
    movementResistsConsensus,
    currentVerdict,
    candidateVerdict,
    gradeEffect,
    candidatePriceAmerican: candidatePrice,
    gateReasons,
  };
}
