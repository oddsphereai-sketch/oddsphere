import type { NbaProfessionalMarketReader, NbaReaderSide } from "./nbaProfessionalMarketReader";
import type { NbaMovementMarket } from "./nbaSameBookMovement";

export const NBA_NAMED_BOOK_POSTURE_RELEASE =
  "nba_named_book_posture_2026_10_31_r1_observed_opposition" as const;

export type NbaNamedBookPosture = {
  release: typeof NBA_NAMED_BOOK_POSTURE_RELEASE;
  evaluatedAt: string | null;
  market: NbaMovementMarket;
  pickedSide: NbaReaderSide;
  supportingSources: string[];
  opposingSources: string[];
  conflictingSources: string[];
  forecastAuthorityGranted: false;
};

/** Price observations can challenge the strongest recommendation without
 * identifying a new score, changing a probability, or requiring a flip. The
 * incumbent's unavailable mixed-market state must not erase its source facts. */
export function resolveNbaNamedBookPosture(args: {
  reader: NbaProfessionalMarketReader | null | undefined;
  market: NbaMovementMarket;
  pickedSide: NbaReaderSide;
}): NbaNamedBookPosture {
  const { reader, market, pickedSide } = args;
  const result: NbaNamedBookPosture = {
    release: NBA_NAMED_BOOK_POSTURE_RELEASE,
    evaluatedAt: reader?.evaluatedAt ?? null,
    market,
    pickedSide,
    supportingSources: [], opposingSources: [], conflictingSources: [],
    forecastAuthorityGranted: false,
  };
  const evaluated = Date.parse(reader?.evaluatedAt ?? "");
  if (reader?.evidenceStatus !== "complete" || !Number.isFinite(evaluated) ||
      (market === "total" ? !["over", "under"].includes(pickedSide) : !["home", "away"].includes(pickedSide))) return result;
  const read = reader.reads[market];
  const canonical = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const excluded = new Set(read.excludedSportsbooks.map(canonical));
  const names = new Set(["circa", "pinnacle", "bookmaker"]);
  for (const trail of read.namedBookPostureTrails ?? []) {
    const source = canonical(trail.sportsbook);
    const opening = Date.parse(trail.openingAt), current = Date.parse(trail.currentAt);
    if (trail.sourceClass !== "named" || !names.has(source) || excluded.has(source) ||
        !trail.provider || !trail.openingIngestionRunId || !trail.currentIngestionRunId ||
        !Number.isFinite(opening) || !Number.isFinite(current) || opening >= current || current > evaluated ||
        evaluated - current > 120 * 60_000 || trail.observations < 2 ||
        !Number.isFinite(trail.persistenceTimeShare) || trail.persistenceTimeShare < 2 / 3 || trail.persistenceTimeShare > 1 ||
        trail.reversalMagnitude !== 0 || trail.buybackToOpening || !Number.isFinite(trail.fairProbabilityDeltaPp)) continue;
    const side = market === "moneyline" ? trail.priceDirection : trail.numberDirection;
    if (side === null || side !== trail.direction) continue;
    const first = market === "total" ? "over" : "home";
    const direction = side === first ? 1 : -1;
    if (market === "moneyline") {
      if (!["home", "away"].includes(side) || direction * trail.fairProbabilityDeltaPp < 1) continue;
    } else {
      const delta = trail.numberDelta;
      if (delta === null || !Number.isFinite(delta) || direction * delta < 0.5 ||
          trail.openingNumber === null || trail.currentNumber === null ||
          !Number.isFinite(trail.openingNumber) || !Number.isFinite(trail.currentNumber) ||
          Math.abs(trail.currentNumber - trail.openingNumber - delta) > 1e-9) continue;
      // A different-priced contract can offset a displayed number change.
      // Do not infer its net direction or a projection amplitude here.
      const openingFair = trail.openingFairFirstProbability;
      const currentFair = trail.currentFairFirstProbability;
      // A legacy trail's same-current-number price delta cannot attest the
      // price compensation between opening and current DIFFERENT numbers.
      if (openingFair === undefined || currentFair === undefined ||
          !Number.isFinite(openingFair) || !Number.isFinite(currentFair) ||
          openingFair <= 0 || openingFair >= 1 || currentFair <= 0 || currentFair >= 1) continue;
      if (direction * (currentFair - openingFair) < 0) {
        result.conflictingSources.push(source);
        continue;
      }
    }
    (side === pickedSide ? result.supportingSources : result.opposingSources).push(source);
  }
  for (const key of ["supportingSources", "opposingSources", "conflictingSources"] as const) {
    result[key] = [...new Set(result[key])].sort();
  }
  // Two provider lanes for one actual book are not independent votes. If they
  // disagree, preserve that conflict instead of selecting the convenient feed.
  const disputed = result.supportingSources.filter(source => result.opposingSources.includes(source));
  result.conflictingSources = [...new Set([...result.conflictingSources, ...disputed])].sort();
  result.supportingSources = result.supportingSources.filter(source => !result.conflictingSources.includes(source));
  result.opposingSources = result.opposingSources.filter(source => !result.conflictingSources.includes(source));
  return result;
}
