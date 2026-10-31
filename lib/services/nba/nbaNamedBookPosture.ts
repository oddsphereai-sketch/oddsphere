import type { NbaProfessionalMarketReader, NbaReaderSide } from "./nbaProfessionalMarketReader";
import type { NbaMovementMarket } from "./nbaSameBookMovement";
import { readNbaPricedMarketMovement, type NbaPriceCoordinateLaw } from "./nbaPricedMarketMovement";
import type { reconcileNbaMarketConsequence } from "./nbaMarketConsequence";

export const NBA_NAMED_BOOK_POSTURE_RELEASE =
  "nba_named_book_posture_2026_10_31_r4_episode_and_static_context" as const;

export type NbaNamedBookPosture = {
  release: typeof NBA_NAMED_BOOK_POSTURE_RELEASE;
  evaluatedAt: string | null;
  market: NbaMovementMarket;
  pickedSide: NbaReaderSide;
  supportingSources: string[];
  opposingSources: string[];
  conflictingSources: string[];
  convictionRiskSources?: string[];
  staticSupportingSources?: string[];
  staticOpposingSources?: string[];
  flowInterpretations?: { source: string; sourceType: string; book: string | null; pressureSide: string; reaction: string; quoteSide: string | null }[];
  knowledgeAt?: string;
  consequence?: string;
  scoreEffectApplied?: boolean;
  forecastAuthorityGranted: false;
};

export function resolveNbaConsequencePosture(args: {
  consequence: ReturnType<typeof reconcileNbaMarketConsequence>; market: NbaMovementMarket; pickedSide: NbaReaderSide;
}): NbaNamedBookPosture {
  const c = args.consequence;
  const result: NbaNamedBookPosture = { release: NBA_NAMED_BOOK_POSTURE_RELEASE, evaluatedAt: null, market: args.market,
    pickedSide: args.pickedSide, supportingSources: [], opposingSources: [], conflictingSources: [], convictionRiskSources: [],
    staticSupportingSources: [], staticOpposingSources: [],
    flowInterpretations: [],
    // Posture itself grants no second adjustment. This explicitly identifies
    // the already applied forecast consequence instead of denying its effect.
    forecastAuthorityGranted: false, scoreEffectApplied: args.market === "total" ? c.totalApplied : c.marginApplied,
    knowledgeAt: c.state.knowledgeAt, consequence: args.market === "total" ? c.actions.total : c.actions.margin };
  for (const book of c.books) {
    const p = book.proposals.find(p => p.market === args.market);
    if (!p) continue;
    result.evaluatedAt = p.current.captureAt;
    if (book.jointStatus === "joint_conflict" && args.market !== "total" || book.ignoredMarkets?.includes(args.market)) { result.conflictingSources.push(book.book); continue; }
    if (Math.abs(p.observedLocationDelta) <= 1e-9) continue;
    const side = args.market === "total" ? p.observedLocationDelta > 0 ? "over" : "under" : p.observedLocationDelta > 0 ? "home" : "away";
    (side === args.pickedSide ? result.supportingSources : result.opposingSources).push(book.book);
    if (p.path.retracement > 1e-9 && Math.sign(p.path.latestLeg) !== 0 && Math.sign(p.path.latestLeg) !== Math.sign(p.path.netLocationChange)) {
      result.convictionRiskSources!.push(`${book.book}:recent_buyback`);
    }
  }
  for (const reason of c.reasons) if (reason.includes(":provider_economic_conflict") && reason.includes(`:${args.market}:`)) result.conflictingSources.push(reason.split(":")[0]!);
  const arbitration = args.market === "total" ? c.arbitration.total : c.arbitration.margin;
  result.conflictingSources.push(...arbitration.conflicts);
  for (const source of arbitration.heldSources ?? []) result.convictionRiskSources!.push(`${source}:named_quote_held_after_lead`);
  for (const source of arbitration.cancelledBy ?? []) result.convictionRiskSources!.push(`${source}:episode_fully_bought_back`);
  for (const context of c.currentContexts) if (context.market === args.market && context.favoredSide !== null) {
    if (context.conflicted) { result.conflictingSources.push(context.book); continue; }
    if (context.favoredSide === args.pickedSide) result.staticSupportingSources!.push(context.book);
    else {
      result.staticOpposingSources!.push(context.book);
      result.convictionRiskSources!.push(`${context.book}:static_current_opposition`);
    }
  }
  for (const pressure of c.pressure) if (pressure.market === args.market && pressure.side === args.pickedSide && pressure.reaction === "held") {
    result.convictionRiskSources!.push(`${pressure.source}:${pressure.reactionBook}:held_under_pressure`);
  }
  for (const pressure of c.pressure) if (pressure.market === args.market) {
    const opposite = pressure.side === "home" ? "away" : pressure.side === "away" ? "home" : pressure.side === "over" ? "under" : "over";
    const quoteSide = pressure.reaction === "aligned" ? pressure.side : pressure.reaction === "opposed" ? opposite : null;
    result.flowInterpretations!.push({ source: pressure.source, sourceType: pressure.sourceType, book: pressure.reactionBook,
      pressureSide: pressure.side, reaction: pressure.reaction, quoteSide });
    if (quoteSide !== null && pressure.reactionBook !== null) {
      if (quoteSide === args.pickedSide) result.supportingSources.push(pressure.reactionBook);
      else result.convictionRiskSources!.push(`${pressure.reactionBook}:timed_price_reaction_against_pick`);
    }
  }
  for (const follower of c.followers) if (follower.market === args.market && follower.reaction === "rejected") {
    result.convictionRiskSources!.push(`${follower.leader}:${follower.follower}:follow_through_rejected`);
  }
  for (const field of ["supportingSources", "opposingSources", "conflictingSources", "convictionRiskSources"] as const) result[field] = [...new Set(result[field])].sort();
  if (result.supportingSources.length && result.opposingSources.length) result.convictionRiskSources!.push("named_book_disagreement");
  return result;
}

/** Price observations can challenge the strongest recommendation without
 * identifying a new score, changing a probability, or requiring a flip. The
 * incumbent's unavailable mixed-market state must not erase its source facts. */
export function resolveNbaNamedBookPosture(args: {
  reader: NbaProfessionalMarketReader | null | undefined;
  market: NbaMovementMarket;
  pickedSide: NbaReaderSide;
  priceLaw?: NbaPriceCoordinateLaw;
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
  if (!reader || reader.evidenceStatus === "unavailable" || !Number.isFinite(evaluated) ||
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
    let side = market === "moneyline" ? trail.priceDirection : trail.numberDirection;
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
      if (args.priceLaw !== undefined) {
        side = readNbaPricedMarketMovement({ market, trail, law: args.priceLaw }).economicSide;
        if (side === null) continue;
      } else if (direction * (currentFair - openingFair) < 0) {
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
