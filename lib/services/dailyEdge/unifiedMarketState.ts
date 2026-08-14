/**
 * Side-neutral point-in-time contract for unified market synthesis research.
 *
 * This module is deliberately not connected to the production prediction writer.
 * It contains no play-grade thresholds and makes no betting decision.
 */

export type UnifiedMarketKind =
  | "moneyline"
  | "spread"
  | "total"
  | "team_total"
  | "first_inning_moneyline"
  | "first_inning_total";

export type MarketBookClass = "high_limit_reference" | "retail" | "exchange" | "unknown";

export type EvidenceAvailability =
  | { status: "available" }
  | { status: "unavailable"; reason: string }
  | { status: "invalid"; reason: string };

export type UnifiedReleaseStamp = {
  projectionRelease: string | null;
  calibrationRelease: string | null;
  decisionRelease: string | null;
  ruleBundleRelease: string | null;
  gradePolicyRelease: string | null;
  writerRelease: string | null;
};

export type UnifiedEventIdentity = {
  sport: string;
  league: string;
  slateDate: string;
  gameId: string;
  providerEventIds: Record<string, string>;
  awayTeam: string;
  homeTeam: string;
  venue: string | null;
  scheduledStart: string;
  decisionTimestamp: string;
  lockedAt: string | null;
  releases: UnifiedReleaseStamp;
};

export type ParticipantStatusObservation = {
  participantId: string | null;
  participantName: string | null;
  side: "away" | "home";
  role: "probable_starter" | "confirmed_starter" | "projected_lineup" | "confirmed_lineup";
  status: "probable" | "confirmed" | "scratched" | "unavailable";
  observedAt: string;
  fetchedAt: string;
  source: string;
};

export type PriceObservation = {
  provider: string;
  providerEventId: string | null;
  sportsbook: string;
  bookClass: MarketBookClass;
  market: UnifiedMarketKind;
  outcomeKey: string;
  lineValue: number | null;
  americanPrice: number;
  providerObservedAt: string | null;
  fetchedAt: string;
  sourceQuality: "high" | "medium" | "low" | "unknown";
  availability: EvidenceAvailability;
};

export type SplitObservation = {
  provider: string;
  sourceBook: string | null;
  sourceType: "consensus" | "sharp_adjacent_book" | "single_book" | "unknown";
  providerEventId: string | null;
  market: UnifiedMarketKind;
  outcomeKey: string;
  lineValue: number | null;
  ticketsPct: number | null;
  moneyPct: number | null;
  contributingBooks: number | null;
  providerObservedAt: string | null;
  fetchedAt: string;
  pairedMarketPrice: number | null;
  derivedComplement: boolean;
  availability: EvidenceAvailability;
};

export type KnownInformationEvent = {
  kind:
    | "starter_status"
    | "lineup"
    | "injury"
    | "weather"
    | "venue"
    | "schedule"
    | "other";
  occurredAt: string;
  firstKnownAt: string;
  source: string;
  affectedSides: Array<"away" | "home" | "both" | "unknown">;
  summary: string;
};

export type IndependentMatchupDistribution = {
  modelRelease: string;
  marketIndependent: boolean;
  generatedAt: string;
  outcomeProbabilities: Record<string, number>;
  projectedAwayScore: number | null;
  projectedHomeScore: number | null;
  uncertainty: {
    kind: "interval" | "standard_deviation" | "ensemble" | "unavailable";
    lower: number | null;
    upper: number | null;
    value: number | null;
  };
  inputProvenance: string[];
  warnings: string[];
};

export type MarketIntegrityFinding = {
  code:
    | "future_observation"
    | "event_identity_mismatch"
    | "unpaired_market"
    | "line_value_mismatch"
    | "timestamp_skew"
    | "stale_source"
    | "invalid_price"
    | "invalid_split"
    | "source_unavailable"
    | "outlier_quote"
    | "participant_status_conflict";
  severity: "info" | "warning" | "blocking";
  source: string | null;
  detail: string;
};

export type UnifiedMarketState = {
  schemaVersion: "unified-market-state-v1";
  identity: UnifiedEventIdentity;
  participantStatus: ParticipantStatusObservation[];
  priceObservations: PriceObservation[];
  splitObservations: SplitObservation[];
  knownInformationEvents: KnownInformationEvent[];
  independentMatchup: IndependentMatchupDistribution | null;
  integrityFindings: MarketIntegrityFinding[];
  provenance: {
    assembledAt: string;
    assemblerVersion: "unified-market-state-assembler-v1";
    sourceSnapshotIds: string[];
  };
};

export type UnifiedMarketStateAssemblerInput = {
  identity: UnifiedEventIdentity;
  participantStatus?: ParticipantStatusObservation[];
  priceObservations?: PriceObservation[];
  splitObservations?: SplitObservation[];
  knownInformationEvents?: KnownInformationEvent[];
  independentMatchup?: IndependentMatchupDistribution | null;
  integrityFindings?: MarketIntegrityFinding[];
  assembledAt: string;
  sourceSnapshotIds?: string[];
};

export type PairedNoVigQuote = {
  firstOutcomeKey: string;
  secondOutcomeKey: string;
  firstAmericanPrice: number;
  secondAmericanPrice: number;
  firstRawImpliedProbability: number;
  secondRawImpliedProbability: number;
  overround: number;
  firstNoVigProbability: number;
  secondNoVigProbability: number;
  observationGapMs: number | null;
};

export function americanToImpliedProbability(americanPrice: number): number {
  if (!Number.isFinite(americanPrice) || americanPrice === 0) {
    throw new Error(`Invalid American price: ${americanPrice}`);
  }
  return americanPrice > 0
    ? 100 / (americanPrice + 100)
    : Math.abs(americanPrice) / (Math.abs(americanPrice) + 100);
}

function observationTime(row: PriceObservation): number | null {
  const value = row.providerObservedAt ?? row.fetchedAt;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function samePairedMarket(first: PriceObservation, second: PriceObservation): boolean {
  return first.provider === second.provider &&
    first.sportsbook === second.sportsbook &&
    first.providerEventId === second.providerEventId &&
    first.market === second.market &&
    first.lineValue === second.lineValue &&
    first.outcomeKey !== second.outcomeKey;
}

/**
 * Remove vig from a synchronized two-outcome quote by proportional normalization.
 * Callers decide acceptable freshness and timestamp skew from provider contracts;
 * this function intentionally contains no arbitrary tolerance.
 */
export function derivePairedNoVigQuote(
  first: PriceObservation,
  second: PriceObservation,
): PairedNoVigQuote {
  if (!samePairedMarket(first, second)) {
    throw new Error("Cannot pair prices from different events, books, markets, lines, or outcomes.");
  }
  const firstRaw = americanToImpliedProbability(first.americanPrice);
  const secondRaw = americanToImpliedProbability(second.americanPrice);
  const probabilitySum = firstRaw + secondRaw;
  if (!Number.isFinite(probabilitySum) || probabilitySum <= 0) {
    throw new Error("Paired implied-probability sum must be positive.");
  }
  const firstTime = observationTime(first);
  const secondTime = observationTime(second);
  return {
    firstOutcomeKey: first.outcomeKey,
    secondOutcomeKey: second.outcomeKey,
    firstAmericanPrice: first.americanPrice,
    secondAmericanPrice: second.americanPrice,
    firstRawImpliedProbability: firstRaw,
    secondRawImpliedProbability: secondRaw,
    overround: probabilitySum - 1,
    firstNoVigProbability: firstRaw / probabilitySum,
    secondNoVigProbability: secondRaw / probabilitySum,
    observationGapMs:
      firstTime === null || secondTime === null ? null : Math.abs(firstTime - secondTime),
  };
}

/** Reject observations that were not knowable at the requested decision time. */
export function observationsAtOrBeforeDecision<T>(
  rows: T[],
  decisionTimestamp: string,
  observedAt: (row: T) => string | null,
): T[] {
  const decisionMs = Date.parse(decisionTimestamp);
  if (!Number.isFinite(decisionMs)) throw new Error(`Invalid decision timestamp: ${decisionTimestamp}`);
  return rows.filter((row) => {
    const value = observedAt(row);
    if (value === null) return false;
    const rowMs = Date.parse(value);
    return Number.isFinite(rowMs) && rowMs <= decisionMs;
  });
}

function parsedTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evidenceTime(row: { providerObservedAt?: string | null; sourceObservedAt?: string | null; fetchedAt: string }): string | null {
  return row.providerObservedAt ?? row.sourceObservedAt ?? row.fetchedAt;
}

function futureFinding(source: string, kind: string, timestamp: string | null): MarketIntegrityFinding {
  return {
    code: "future_observation",
    severity: "blocking",
    source,
    detail: `${kind} observation at ${timestamp ?? "an invalid timestamp"} was not knowable at the decision time.`,
  };
}

/**
 * Assemble an immutable point-in-time state. Rows newer than the decision time
 * are excluded and recorded as blocking integrity findings instead of leaking
 * into historical replay.
 */
export function assembleUnifiedMarketState(input: UnifiedMarketStateAssemblerInput): UnifiedMarketState {
  const decisionMs = parsedTime(input.identity.decisionTimestamp);
  const assembledMs = parsedTime(input.assembledAt);
  if (decisionMs === null) throw new Error(`Invalid decision timestamp: ${input.identity.decisionTimestamp}`);
  if (assembledMs === null) throw new Error(`Invalid assembled timestamp: ${input.assembledAt}`);

  const findings = [...(input.integrityFindings ?? [])];
  const participantStatus = (input.participantStatus ?? []).filter((row) => {
    const at = parsedTime(row.observedAt);
    if (at !== null && at <= decisionMs) return true;
    findings.push(futureFinding(row.source, "participant-status", row.observedAt));
    return false;
  });
  const priceObservations = (input.priceObservations ?? []).filter((row) => {
    const at = evidenceTime(row);
    const time = parsedTime(at);
    const validPrice = Number.isFinite(row.americanPrice) && row.americanPrice !== 0;
    if (!validPrice) {
      findings.push({
        code: "invalid_price",
        severity: "blocking",
        source: `${row.provider}:${row.sportsbook}`,
        detail: `Invalid American price for ${row.market}:${row.outcomeKey}.`,
      });
      return false;
    }
    if (time !== null && time <= decisionMs) return true;
    findings.push(futureFinding(`${row.provider}:${row.sportsbook}`, "price", at));
    return false;
  });
  const splitObservations = (input.splitObservations ?? []).filter((row) => {
    const at = evidenceTime(row);
    const time = parsedTime(at);
    const percentages = [row.ticketsPct, row.moneyPct].filter((value): value is number => value !== null);
    if (percentages.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
      findings.push({
        code: "invalid_split",
        severity: "blocking",
        source: `${row.provider}:${row.sourceBook ?? "unknown"}`,
        detail: `Invalid split percentage for ${row.market}:${row.outcomeKey}.`,
      });
      return false;
    }
    if (time !== null && time <= decisionMs) return true;
    findings.push(futureFinding(`${row.provider}:${row.sourceBook ?? "unknown"}`, "split", at));
    return false;
  });
  const knownInformationEvents = (input.knownInformationEvents ?? []).filter((row) => {
    const at = parsedTime(row.firstKnownAt);
    if (at !== null && at <= decisionMs) return true;
    findings.push(futureFinding(row.source, "information-event", row.firstKnownAt));
    return false;
  });
  const independentMatchup = input.independentMatchup ?? null;
  const usableIndependentMatchup = independentMatchup !== null &&
    parsedTime(independentMatchup.generatedAt) !== null &&
    parsedTime(independentMatchup.generatedAt)! <= decisionMs
    ? independentMatchup
    : null;
  if (independentMatchup !== null && usableIndependentMatchup === null) {
    findings.push(futureFinding(independentMatchup.modelRelease, "independent-matchup", independentMatchup.generatedAt));
  }

  return {
    schemaVersion: "unified-market-state-v1",
    identity: input.identity,
    participantStatus,
    priceObservations,
    splitObservations,
    knownInformationEvents,
    independentMatchup: usableIndependentMatchup,
    integrityFindings: findings,
    provenance: {
      assembledAt: input.assembledAt,
      assemblerVersion: "unified-market-state-assembler-v1",
      sourceSnapshotIds: [...new Set(input.sourceSnapshotIds ?? [])].sort(),
    },
  };
}
