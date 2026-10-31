import { nbaResidualCdf, nbaResidualQuantile, type NbaPriceCoordinateLaw } from "./nbaPricedMarketMovement";
import type { NbaReaderPriceRow, NbaReaderSplitRow } from "./nbaProfessionalMarketReader";

export const NBA_MARKET_CONSEQUENCE_RELEASE = "nba_market_consequence_2026_10_31_r5_chronology_fitted_innovation" as const;
export const NBA_MARKET_CONSEQUENCE_COEFFICIENTS = {
  margin: 1.813,
  total: 1,
} as const;
type Market = "moneyline" | "spread" | "total";
type Coordinate = "margin" | "total";
type ConsumptionReceipt = { at: string; coordinates: readonly Coordinate[]; evidenceIds: readonly string[] };
type Frame = { book: string; provider: string; market: Market; captureAt: string; sourceAt: string;
  run: string; event: string; threshold: number; fair: number; fairLow: number; fairHigh: number };
export type NbaMarketKnowledgeState = {
  release: typeof NBA_MARKET_CONSEQUENCE_RELEASE;
  eventId: string;
  inputFingerprint: string;
  knowledgeAt: string;
  retiredBefore: Partial<Record<Coordinate, { at: string; evidenceIds: string[] }>>;
  independentInput: { margin: number; total: number; marginSigma: number; totalSigma: number; mixture: string };
  unresolvedInputRevisions: Coordinate[];
  anchors: Record<string, Frame>;
};
export type NbaMarketConsequenceContext = {
  eventId: string;
  inputFingerprint: string;
  evaluatedAt: string;
  previousState?: NbaMarketKnowledgeState | null;
  /** A numerical forecast revision is NOT proof of consumed information.
   * Only an attested information receipt may retire overlapping quote history. */
  consumedInformation?: readonly ConsumptionReceipt[];
  priceRows: readonly NbaReaderPriceRow[];
  splitRows: readonly NbaReaderSplitRow[];
  pricesTrusted: boolean;
  splitsTrusted: boolean;
  excludedSportsbooksByMarket?: Partial<Record<Market, readonly string[]>>;
  disabledMarkets?: readonly Market[];
};
type Proposal = { book: string; provider: string; market: Market; anchor: Frame; current: Frame;
  observedLocationDelta: number; probability: number; location: number; locationLow: number; locationHigh: number; delta: number;
  innovation: number; consequenceCoefficient: number;
  application: "no_movement" | "confirmation_only" | "corrective_innovation" | "overshoot_innovation";
  path: { peakLocation: number; troughLocation: number; netLocationChange: number; retracement: number;
    onsetAt: string | null; onsetSourceAt: string | null; regimeOnsetAt: string | null; regimeSourceAt: string | null;
    lastEconomicSourceAt: string | null; latestLeg: number; captures: number } };
type BookDecision = { book: string; margin: number | null; marginScale: number; total: number | null;
  jointStatus: "joint_constraints" | "single_contract" | "joint_conflict" | "no_side_update";
  ignoredMarkets?: Market[];
  proposals: Proposal[] };
const canonical = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const names = new Set(["circa", "pinnacle", "bookmaker"]);
const key = (p: Pick<Frame, "book" | "provider" | "market">) => `${p.book}|${p.provider}|${p.market}`;
const numericalZero = (n: number) => Math.abs(n) <= 1e-9;
const axis = (market: Market) => market === "total" ? "total" as const : "spread" as const;
const location = (frame: Frame, law: NbaPriceCoordinateLaw) => frame.threshold + nbaResidualQuantile(axis(frame.market), frame.fair, law);
const locationInterval = (frame: Frame, law: NbaPriceCoordinateLaw) => ({
  low: frame.threshold + nbaResidualQuantile(axis(frame.market), frame.fairLow, law),
  high: frame.threshold + nbaResidualQuantile(axis(frame.market), frame.fairHigh, law),
});
const coordinateOf = (market: Market): Coordinate => market === "total" ? "total" : "margin";
const knowledgeCutoff = (state: NbaMarketKnowledgeState, market: Market) => state.retiredBefore[coordinateOf(market)]?.at ?? state.knowledgeAt;

/** Remove the portion of a move already expressed by the independent score.
 * A named book moving from its anchor toward the independent forecast confirms
 * that forecast; applying the same displacement again would double count it.
 * Movement away from the forecast is new corrective information. If the book
 * passes through the independent coordinate, only the overshoot is new. The
 * remaining innovation uses the frozen coordinate-specific coefficient that
 * improved both score error and market-side direction on chronology-later
 * confirmation data. This is an explicit fitted influence law, not a hidden
 * gate, arbitrary per-game cap, source vote, or dynamic model/market blend.
 */
function independentRelativeInnovation(independent: number, anchor: number, current: number, coordinate: Coordinate) {
  const gap = independent - anchor, movement = current - anchor;
  const coefficient = NBA_MARKET_CONSEQUENCE_COEFFICIENTS[coordinate];
  if (numericalZero(movement)) return { location: independent, innovation: 0, coefficient, application: "no_movement" as const };
  if (numericalZero(gap) || Math.sign(movement) !== Math.sign(gap)) {
    return { location: independent + coefficient * movement, innovation: movement, coefficient,
      application: "corrective_innovation" as const };
  }
  const innovation = Math.sign(movement) * Math.max(0, Math.abs(movement) - Math.abs(gap));
  return { location: independent + coefficient * innovation, innovation, coefficient,
    application: numericalZero(innovation) ? "confirmation_only" as const : "overshoot_innovation" as const };
}

function innovationInterval(independent: number, anchor: Frame, current: Frame, law: NbaPriceCoordinateLaw, coordinate: Coordinate) {
  const a = locationInterval(anchor, law), c = locationInterval(current, law);
  const anchorPoints = [a.low, location(anchor, law), a.high];
  const currentPoints = [c.low, location(current, law), c.high];
  if (independent >= c.low && independent <= c.high) currentPoints.push(independent);
  const values = anchorPoints.flatMap(anchorPoint => currentPoints.map(currentPoint =>
    independentRelativeInnovation(independent, anchorPoint, currentPoint, coordinate).location));
  return { low: Math.min(...values), high: Math.max(...values) };
}

export function isNbaMarketKnowledgeState(value: unknown): value is NbaMarketKnowledgeState {
  if (!value || typeof value !== "object") return false;
  const v = value as NbaMarketKnowledgeState;
  if (v.release !== NBA_MARKET_CONSEQUENCE_RELEASE || typeof v.eventId !== "string" || typeof v.inputFingerprint !== "string" ||
      !Number.isFinite(Date.parse(v.knowledgeAt)) || !v.anchors || typeof v.anchors !== "object" || Array.isArray(v.anchors) ||
      !v.retiredBefore || typeof v.retiredBefore !== "object" || Array.isArray(v.retiredBefore) ||
      !v.independentInput || ![v.independentInput.margin, v.independentInput.total, v.independentInput.marginSigma, v.independentInput.totalSigma].every(Number.isFinite) ||
      v.independentInput.marginSigma <= 0 || v.independentInput.totalSigma <= 0 || v.independentInput.total <= 0 ||
      typeof v.independentInput.mixture !== "string" || !Array.isArray(v.unresolvedInputRevisions) ||
      v.unresolvedInputRevisions.some(c => c !== "margin" && c !== "total")) return false;
  if (!Object.entries(v.retiredBefore).every(([c, r]) => (c === "margin" || c === "total") && r && Number.isFinite(Date.parse(r.at)) &&
      Date.parse(r.at) >= Date.parse(v.knowledgeAt) && Array.isArray(r.evidenceIds) && r.evidenceIds.length > 0 &&
      r.evidenceIds.length <= 32 && r.evidenceIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 256))) return false;
  return Object.entries(v.anchors).every(([laneKey, f]) => f && typeof f.book === "string" && typeof f.provider === "string" &&
    typeof f.event === "string" && !!f.run && ["moneyline", "spread", "total"].includes(f.market) &&
    [Date.parse(f.captureAt), Date.parse(f.sourceAt), f.threshold, f.fair, f.fairLow, f.fairHigh].every(Number.isFinite) &&
    Date.parse(f.captureAt) >= Date.parse(knowledgeCutoff(v, f.market)) && Date.parse(f.sourceAt) >= Date.parse(knowledgeCutoff(v, f.market)) && Date.parse(f.sourceAt) <= Date.parse(f.captureAt) &&
    f.fairLow > 0 && f.fairLow <= f.fair && f.fair <= f.fairHigh && f.fairHigh < 1 && key(f) === laneKey);
}

/** Complete captured contracts only. Malformed frames do not erase unrelated
 * games/books/markets or earlier complete frames; they remain diagnostics.
 * Identical duplicate rows are deduplicated, divergent duplicate sides fail.
 */
function frames(context: NbaMarketConsequenceContext) {
  const groups = new Map<string, NbaReaderPriceRow[]>(), issues: string[] = [];
  const evaluated = Date.parse(context.evaluatedAt);
  for (const row of context.priceRows) {
    const captured = Date.parse(row.fetchedAt), observed = Date.parse(row.providerTimestamp ?? row.fetchedAt);
    if (![captured, observed].every(Number.isFinite) || captured > evaluated || observed > captured ||
        !row.selectionKey.startsWith(`${context.eventId}:${row.market}:`) ||
        !["owls", "canonical_lines"].includes(row.provider ?? "")) continue;
    const book = canonical(row.sportsbook);
    if ((context.excludedSportsbooksByMarket?.[row.market] ?? []).map(canonical).includes(book)) continue;
    const groupKey = `${book}|${row.provider}|${row.market}|${row.fetchedAt}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), row]);
  }
  const result: Frame[] = [];
  for (const [groupKey, original] of groups) {
    const rows = [...new Map(original.map(r => [JSON.stringify([r.selectionKey, r.americanPrice, r.line, r.providerEventId,
      r.ingestionRunId, r.providerTimestamp, r.fetchedAt]), r])).values()];
    const first = rows[0]!, market = first.market;
    const a = rows.filter(r => r.selectionKey.endsWith(market === "total" ? ":over" : ":home"));
    const b = rows.filter(r => r.selectionKey.endsWith(market === "total" ? ":under" : ":away"));
    const invalid = rows.length !== 2 || a.length !== 1 || b.length !== 1 ||
      new Set(rows.map(r => r.ingestionRunId)).size !== 1 || !first.ingestionRunId ||
      new Set(rows.map(r => r.providerEventId)).size !== 1 || (first.provider === "owls" && !first.providerEventId) ||
      new Set(rows.map(r => Date.parse(r.providerTimestamp ?? r.fetchedAt))).size !== 1 ||
      rows.some(r => !Number.isFinite(r.americanPrice) || r.americanPrice === 0) ||
      (market !== "moneyline" && (a[0]?.line === null || b[0]?.line === null ||
        !Number.isFinite(a[0]?.line) || !Number.isFinite(b[0]?.line) ||
        Math.abs(a[0]!.line! + (market === "spread" ? 1 : -1) * b[0]!.line!) > 1e-9));
    if (invalid) { issues.push(`${groupKey.split("|").slice(0, 3).join("|")}:incomplete_or_ambiguous_pair`); continue; }
    const implied = (p: number) => p < 0 ? -p / (100 - p) : 100 / (100 + p);
    const priceBin = (price: number) => {
      const text = String(price), decimals = text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
      const halfTick = 0.5 * 10 ** -Math.min(decimals, 6);
      const values = [price - halfTick, price, price + halfTick]
        .filter(value => Math.sign(value) === Math.sign(price) && Math.abs(value) >= 100);
      return values.length ? values : [price];
    };
    const pa = implied(a[0]!.americanPrice!), pb = implied(b[0]!.americanPrice!);
    const fairValues = priceBin(a[0]!.americanPrice!).flatMap(priceA => priceBin(b[0]!.americanPrice!)
      .map(priceB => implied(priceA) / (implied(priceA) + implied(priceB))));
    const fairLow = Math.min(...fairValues), fairHigh = Math.max(...fairValues);
    result.push({ book: canonical(first.sportsbook), provider: first.provider!, market, captureAt: first.fetchedAt,
      sourceAt: new Date(Math.max(...rows.map(r => Date.parse(r.providerTimestamp ?? r.fetchedAt)))).toISOString(),
      run: first.ingestionRunId!, event: first.providerEventId ?? context.eventId,
      threshold: market === "moneyline" ? 0 : market === "spread" ? -a[0]!.line! : a[0]!.line!,
      fair: pa / (pa + pb), fairLow, fairHigh });
  }
  return { frames: result.sort((a, b) => Date.parse(a.captureAt) - Date.parse(b.captureAt)), issues };
}

/** Event-selected economic displacement, not a current-market forecast anchor.
 * Same-book ML/Spread constrain one fixed-scale location jointly. Quote-bin
 * intersection is a measurement constraint, never a percentage blend or a
 * game-specific dispersion estimate. Incompatible contracts fail closed.
 */
export function reconcileNbaMarketConsequence(args: {
  independentMargin: number; independentTotal: number; law: NbaPriceCoordinateLaw; context: NbaMarketConsequenceContext;
  spreadHome?: number | null; totalLine?: number | null;
}) {
  const { context, law } = args, evaluated = Date.parse(context.evaluatedAt);
  if (!Number.isFinite(evaluated) || !context.inputFingerprint || !context.eventId ||
      ![args.independentMargin, args.independentTotal, law.marginSigma, law.totalSigma].every(Number.isFinite) ||
      args.independentTotal <= 0 || law.marginSigma <= 0 || law.totalSigma <= 0) throw new Error("Invalid NBA consequence context");
  const captured = frames(context);
  const previous = context.previousState;
  const continuing = isNbaMarketKnowledgeState(previous) && previous.eventId === context.eventId &&
    Number.isFinite(Date.parse(previous.knowledgeAt)) && Date.parse(previous.knowledgeAt) <= evaluated &&
    Object.values(previous.retiredBefore).every(r => Date.parse(r.at) <= evaluated);
  const independentInput = { margin: args.independentMargin, total: args.independentTotal,
    marginSigma: law.marginSigma, totalSigma: law.totalSigma, mixture: JSON.stringify(law.marginMixture ?? null) };
  // A new release must not erase already captured opening-to-pregame history.
  // The chronology-fitted law was qualified from a current independent score
  // plus the complete prior exact-contract trail. Bootstrap only from the
  // earliest verified source clock in this event; malformed/future/cross-event
  // rows were already rejected by frames().
  const bootstrapKnowledgeAt = captured.frames.length === 0
    ? context.evaluatedAt
    : new Date(Math.min(...captured.frames.map(frame => Date.parse(frame.sourceAt)))).toISOString();
  const state: NbaMarketKnowledgeState = { release: NBA_MARKET_CONSEQUENCE_RELEASE, eventId: context.eventId,
    inputFingerprint: context.inputFingerprint, knowledgeAt: continuing ? previous!.knowledgeAt : bootstrapKnowledgeAt,
    anchors: continuing ? structuredClone(previous!.anchors) : {}, retiredBefore: continuing ? structuredClone(previous!.retiredBefore) : {},
    independentInput, unresolvedInputRevisions: continuing ? [...previous!.unresolvedInputRevisions] : [] };
  const independentInputChanged = !continuing || previous!.inputFingerprint !== context.inputFingerprint ||
    JSON.stringify(previous!.independentInput) !== JSON.stringify(independentInput);
  if (continuing) {
    if (previous!.independentInput.margin !== independentInput.margin || previous!.independentInput.marginSigma !== independentInput.marginSigma || previous!.independentInput.mixture !== independentInput.mixture) state.unresolvedInputRevisions.push("margin");
    if (previous!.independentInput.total !== independentInput.total || previous!.independentInput.totalSigma !== independentInput.totalSigma) state.unresolvedInputRevisions.push("total");
  }
  if ((context.consumedInformation?.length ?? 0) > 32) throw new Error("NBA information-consumption receipt budget exceeded");
  for (const receipt of context.consumedInformation ?? []) {
    if (!receipt || !Number.isFinite(Date.parse(receipt.at)) || Date.parse(receipt.at) > evaluated ||
        !Array.isArray(receipt.coordinates) || !receipt.coordinates.length || receipt.coordinates.some(c => c !== "margin" && c !== "total") ||
        !Array.isArray(receipt.evidenceIds) || !receipt.evidenceIds.length || receipt.evidenceIds.length > 32 ||
        receipt.evidenceIds.some(id => typeof id !== "string" || !id.length || id.length > 256)) {
      throw new Error("Invalid NBA information-consumption receipt");
    }
    for (const coordinate of receipt.coordinates as readonly Coordinate[]) {
      const retired = state.retiredBefore[coordinate];
      const oldAt = retired?.at ?? state.knowledgeAt;
      // Replaying an old attestation cannot clear uncertainty introduced by
      // a later independent revision. A new retirement must advance its clock.
      if (Date.parse(receipt.at) >= Date.parse(oldAt) && (!retired || Date.parse(receipt.at) > Date.parse(oldAt))) {
        state.retiredBefore[coordinate] = { at: receipt.at, evidenceIds: [...receipt.evidenceIds] };
        state.unresolvedInputRevisions = state.unresolvedInputRevisions.filter(c => c !== coordinate);
      }
    }
  }
  state.unresolvedInputRevisions = [...new Set(state.unresolvedInputRevisions)];
  for (const [lane, anchor] of Object.entries(state.anchors)) if (Date.parse(anchor.sourceAt) < Date.parse(knowledgeCutoff(state, anchor.market))) delete state.anchors[lane];
  const reasons: string[] = [...captured.issues];
  for (const coordinate of state.unresolvedInputRevisions) reasons.push(`${coordinate}:independent_revision_overlap_unresolved_market_knowledge_preserved`);
  for (const market of context.disabledMarkets ?? []) reasons.push(`${market}:execution_target_cycle_coordinate_retired`);
  if (!context.pricesTrusted) reasons.push("price_family_failed_valid_other_families_retained");
  if (!context.splitsTrusted) reasons.push("split_family_failed_price_authority_retained");
  const lanes = new Map<string, Frame[]>();
  for (const frame of captured.frames) lanes.set(key(frame), [...(lanes.get(key(frame)) ?? []), frame]);
  const causalLanes = new Map<string, Frame[]>();
  const contextFrames: Frame[] = [];
  const proposals: Proposal[] = [];
  for (const [laneKey, capturedSequence] of lanes) {
    const cutoff = knowledgeCutoff(state, capturedSequence[0]!.market);
    let contextSource = Date.parse(state.anchors[laneKey]?.sourceAt ?? "") || -Infinity;
    let contextPrior: Frame | undefined = state.anchors[laneKey];
    for (const f of capturedSequence) {
      const source = Date.parse(f.sourceAt);
      if (source < contextSource || contextPrior && source === contextSource &&
          (Math.abs(f.fair - contextPrior.fair) > 1e-9 || f.threshold !== contextPrior.threshold)) continue;
      contextFrames.push(f); contextSource = source; contextPrior = f;
    }
    let latestSource = Date.parse(state.anchors[laneKey]?.sourceAt ?? cutoff);
    let lastSourceFrame: Frame | undefined = state.anchors[laneKey];
    const sequence = capturedSequence.filter(f => {
      const source = Date.parse(f.sourceAt);
      if (source < Date.parse(cutoff) || source < latestSource ||
          lastSourceFrame && source === latestSource && (Math.abs(f.fair - lastSourceFrame.fair) > 1e-9 || f.threshold !== lastSourceFrame.threshold)) {
        reasons.push(`${laneKey}:regressed_or_contradictory_source_clock`); return false;
      }
      latestSource = source; lastSourceFrame = f; return true;
    });
    const latest = sequence.at(-1);
    causalLanes.set(laneKey, sequence);
    if (!latest) { reasons.push(`${laneKey}:awaiting_post_input_anchor`); continue; }
    if (!names.has(latest.book) || !context.pricesTrusted || context.disabledMarkets?.includes(latest.market)) continue;
    let anchor: Frame | undefined = state.anchors[laneKey];
    if (anchor && (key(anchor) !== laneKey || Date.parse(anchor.captureAt) < Date.parse(cutoff) ||
        Date.parse(anchor.captureAt) > evaluated || anchor.event !== latest.event)) { reasons.push(`${laneKey}:invalid_saved_anchor`); continue; }
    if (!anchor) {
      anchor = sequence.find(f => Date.parse(f.captureAt) >= Date.parse(cutoff) && Date.parse(f.sourceAt) >= Date.parse(cutoff));
      if (anchor) state.anchors[laneKey] = anchor;
    }
    if (!anchor) { reasons.push(`${laneKey}:awaiting_post_input_anchor`); continue; }
    if (Date.parse(latest.captureAt) <= Date.parse(anchor.captureAt)) { reasons.push(`${laneKey}:anchor_is_not_movement`); continue; }
    // Fresh collection of an unchanged quote is valid held-price evidence.
    // This existing data-health window is not an amplitude activation rule.
    if (evaluated - Date.parse(latest.captureAt) > 120 * 60_000) { reasons.push(`${laneKey}:stale_current_capture`); continue; }
    try {
      const kind = axis(latest.market), independent = kind === "total" ? args.independentTotal : args.independentMargin;
      const path = [anchor, ...sequence.filter(f => Date.parse(f.captureAt) > Date.parse(anchor!.captureAt))];
      const points = path.map(f => location(f, law)), first = points[0]!, end = points.at(-1)!;
      const peak = Math.max(...points), trough = Math.min(...points), net = end - first;
      const coordinate = coordinateOf(latest.market);
      const innovation = independentRelativeInnovation(independent, first, end, coordinate);
      const proposed = innovation.location;
      const proposedInterval = innovationInterval(independent, anchor, latest, law, coordinate);
      const probability = nbaResidualCdf(kind, proposed - latest.threshold, law);
      let regimeStart: number | null = null;
      let lastEconomicIndex: number | null = null;
      for (let i = 1; i < points.length; i++) {
        if (!numericalZero(points[i]! - points[i - 1]!)) lastEconomicIndex = i;
        const signed = points[i]! - first;
        if (numericalZero(signed) || Math.sign(signed) !== Math.sign(net)) regimeStart = null;
        else if (regimeStart === null) regimeStart = i;
      }
      proposals.push({ book: latest.book, provider: latest.provider, market: latest.market, anchor, current: latest,
        observedLocationDelta: numericalZero(net) ? 0 : net, probability, location: proposed,
        locationLow: proposedInterval.low, locationHigh: proposedInterval.high, delta: proposed - independent,
        innovation: innovation.innovation, consequenceCoefficient: innovation.coefficient,
        application: innovation.application,
        path: { peakLocation: peak, troughLocation: trough, netLocationChange: net,
          retracement: net >= 0 ? peak - end : end - trough,
          onsetAt: path.find((f, i) => !numericalZero(points[i]! - first))?.captureAt ?? null,
          onsetSourceAt: path.find((f, i) => !numericalZero(points[i]! - first))?.sourceAt ?? null,
          regimeOnsetAt: regimeStart === null ? null : path[regimeStart]!.captureAt,
          regimeSourceAt: regimeStart === null ? null : path[regimeStart]!.sourceAt,
          lastEconomicSourceAt: lastEconomicIndex === null ? null : path[lastEconomicIndex]!.sourceAt,
          latestLeg: points.length >= 2 ? end - points[points.length - 2]! : 0, captures: points.length } });
    } catch { reasons.push(`${laneKey}:numerically_unresolved_contract`); }
  }
  const selected: Proposal[] = [];
  for (const book of names) for (const market of ["moneyline", "spread", "total"] as const) {
    const choices = proposals.filter(p => p.book === book && p.market === market);
    const directions = new Set(choices.filter(p => !numericalZero(p.delta)).map(p => Math.sign(p.delta)));
    if (directions.size > 1) { reasons.push(`${book}:${market}:provider_economic_conflict`); continue; }
    const chosen = [...choices].sort((a, b) => Date.parse(b.current.captureAt) - Date.parse(a.current.captureAt) ||
      Number(b.provider === "owls") - Number(a.provider === "owls"))[0];
    if (chosen) selected.push(chosen);
  }
  const books: BookDecision[] = [];
  for (const book of names) {
    const rows = selected.filter(p => p.book === book);
    const ml = rows.find(p => p.market === "moneyline"), spread = rows.find(p => p.market === "spread"), total = rows.find(p => p.market === "total");
    let margin: number | null = null, jointStatus: BookDecision["jointStatus"] = "no_side_update";
    const scale = 1;
    const ignoredMarkets: Market[] = [];
    if (ml && spread) {
      if (numericalZero(ml.observedLocationDelta) && numericalZero(spread.observedLocationDelta)) {
        margin = args.independentMargin; jointStatus = "joint_constraints";
        if (rows.length) books.push({ book, margin, marginScale: scale, total: total?.location ?? null, jointStatus, proposals: rows });
        continue;
      }
      // Relative movement was already translated under the released fixed
      // residual law. Inferring a second, game-specific scale from those
      // independent-relative pseudo-probabilities is circular and becomes
      // unbounded at ordinary one-tick quote resolution. Keep scale frozen and
      // require the two same-book measurements to share a feasible location.
      const overlapLow = Math.max(ml.locationLow, spread.locationLow);
      const overlapHigh = Math.min(ml.locationHigh, spread.locationHigh);
      if (overlapLow <= overlapHigh + 1e-9) {
        margin = (overlapLow + overlapHigh) / 2; jointStatus = "joint_constraints";
        reasons.push(`${book}:fixed_scale_contract_intersection`);
      } else {
        // Spread is the direct margin contract used by the chronology-fitted
        // release. If the simultaneously observed ML transform is incompatible
        // under the frozen residual scale, keep the coherent Spread consequence
        // and retain ML as diagnostic context. Rejecting both erased valid
        // Spread movement on most real T-60 games.
        margin = spread.location; jointStatus = "single_contract";
        ignoredMarkets.push("moneyline");
        reasons.push(`${book}:moneyline_spread_fixed_scale_conflict_spread_authority`);
      }
    } else if (ml || spread) { margin = (ml ?? spread)!.location; jointStatus = "single_contract"; }
    if (rows.length) books.push({ book, margin, marginScale: scale, total: total?.location ?? null, jointStatus, proposals: rows,
      ignoredMarkets: ignoredMarkets.length ? ignoredMarkets : undefined });
  }
  // One physical source/episode authors each coordinate. No averaging,
  // probability pooling, source-count vote or model/market percentage.
  const arbitrate = (coordinate: "margin" | "total") => {
    const relevant = (book: BookDecision) => book.proposals.filter(p => coordinate === "total" ? p.market === "total" : p.market !== "total" && !book.ignoredMarkets?.includes(p.market));
    const cancellations = books.flatMap(book => {
      const ps = relevant(book);
      const unchanged = coordinate === "total" ? book.total !== null && numericalZero(book.total - args.independentTotal)
        : book.margin !== null && numericalZero(book.margin - args.independentMargin) && numericalZero(book.marginScale - 1);
      const changed = ps.filter(p => p.path.lastEconomicSourceAt !== null && p.path.onsetSourceAt !== null);
      if (!unchanged || !changed.length || !ps.every(p => numericalZero(p.observedLocationDelta))) return [];
      // A cancellation can retire an observed copy of its own excursion,
      // never every other book that happened to change during that window.
      const excursions = changed.map(p => ({ market: p.market, deltas: (causalLanes.get(key(p.anchor)) ?? [])
        .filter(f => Date.parse(f.sourceAt) < Date.parse(p.path.lastEconomicSourceAt!))
        .map(f => ({ delta: location(f, law) - location(p.anchor, law), at: Date.parse(f.sourceAt) }))
        .filter(d => !numericalZero(d.delta)) }));
      return [{ book: book.book, from: Math.min(...changed.map(p => Date.parse(p.path.onsetSourceAt!))),
        at: Math.max(...changed.map(p => Date.parse(p.path.lastEconomicSourceAt!))), excursions }];
    });
    const signals = books.filter(b => coordinate === "total" ? b.total !== null : b.margin !== null && b.jointStatus !== "joint_conflict")
      .map(book => {
        const ps = relevant(book);
        const delta = coordinate === "total" ? book.total! - args.independentTotal : book.margin! - args.independentMargin;
        const scaleDelta = coordinate === "total" ? 0 : book.marginScale - 1;
        const times = ps.flatMap(p => p.path.regimeSourceAt ? [Date.parse(p.path.regimeSourceAt)] : []);
        const observedDirections = [...new Set(ps.map(p => Math.sign(p.observedLocationDelta)).filter(Boolean))];
        return { book, delta, scaleDelta, onset: times.length ? Math.min(...times) : Infinity,
          latestEconomic: Math.max(...ps.flatMap(p => p.path.lastEconomicSourceAt ? [Date.parse(p.path.lastEconomicSourceAt)] : [])),
          current: ps.length ? Math.max(...ps.map(p => Date.parse(p.current.captureAt))) : -Infinity,
          observedDirection: observedDirections.length === 1 ? observedDirections[0]! : 0 };
      });
    const candidates = signals.filter(c => !numericalZero(c.delta) || !numericalZero(c.scaleDelta));
    const cancelledFollowers = candidates.filter(c => cancellations.some(cancel => c.onset >= cancel.from && c.latestEconomic <= cancel.at &&
      numericalZero(c.scaleDelta) && relevant(c.book).filter(p => !numericalZero(p.observedLocationDelta)).every(p =>
        cancel.excursions.some(e => e.market === p.market && e.deltas.some(d => d.at <= c.onset && numericalZero(d.delta - p.observedLocationDelta)))))).map(c => c.book.book);
    const activeCandidates = candidates.filter(c => !cancelledFollowers.includes(c.book.book));
    const confirmations = signals.filter(c => numericalZero(c.delta) && numericalZero(c.scaleDelta) && c.observedDirection !== 0 &&
      relevant(c.book).some(p => p.application === "confirmation_only"));
    // A zero-point confirmation is still evidence. If another named book moves
    // away from the independent forecast during the same episode, allowing the
    // corrective book to own the score merely because confirmation is encoded
    // as zero would silently discard half of the market read. Resolve only when
    // chronology separates the events: a later confirmation cancels the prior
    // correction; a later correction may supersede the earlier confirmation.
    for (const correction of activeCandidates) for (const confirmation of confirmations) {
      if (!correction.observedDirection || Math.sign(correction.observedDirection) === Math.sign(confirmation.observedDirection)) continue;
      if (confirmation.onset > correction.latestEconomic) {
        reasons.push(`${coordinate}:later_confirmation_supersedes_prior_correction`);
        return { authority: "context_only" as const, status: "later_confirmation_supersedes_prior_correction", leader: null,
          selected: null, followers: [], lagging: [correction.book.book], conflicts: [], episodeAt: new Date(confirmation.onset).toISOString(),
          cancelledBy: [confirmation.book.book], heldSources: [] as string[] };
      }
      if (correction.onset <= confirmation.latestEconomic) {
        reasons.push(`${coordinate}:unresolved_correction_confirmation_conflict`);
        return { authority: "context_only" as const, status: "unresolved_correction_confirmation_conflict", leader: null,
          selected: null, followers: [], lagging: [], conflicts: [correction.book.book, confirmation.book.book], episodeAt: null,
          cancelledBy: [] as string[], heldSources: [] as string[] };
      }
    }
    const opposite = (a: typeof candidates[number], b: typeof candidates[number]) =>
      !numericalZero(a.delta) && !numericalZero(b.delta) && Math.sign(a.delta) !== Math.sign(b.delta) ||
      !numericalZero(a.scaleDelta) && !numericalZero(b.scaleDelta) && Math.sign(a.scaleDelta) !== Math.sign(b.scaleDelta);
    const order = (a: typeof candidates[number], b: typeof candidates[number]) => a.onset - b.onset;
    const sameEffect = (a: typeof candidates[number], b: typeof candidates[number]) =>
      numericalZero(a.delta - b.delta) && numericalZero(a.scaleDelta - b.scaleDelta);
    const equivalentRepresentative = (group: typeof candidates) => ({ ...group[0]!, current: Math.max(...group.map(c => c.current)) });
    const leaders = [...activeCandidates].sort(order);
    if (!leaders.length) return { authority: "context_only" as const, status: "no_causal_displacement", leader: null as string | null,
      selected: null as BookDecision | null, followers: [] as string[], lagging: cancelledFollowers, conflicts: [] as string[], episodeAt: null as string | null,
      cancelledBy: cancellations.map(c => c.book), heldSources: [] as string[] };
    let leader = leaders[0]!;
    let leaderSources = [leader.book.book];
    const initialGroup = leaders.filter(c => c.onset === leader.onset);
    if (initialGroup.length > 1 && !initialGroup.every(c => sameEffect(c, leader))) {
      reasons.push(`${coordinate}:leader_unidentified_equal_source_instant`);
      return { authority: "context_only" as const, status: "leader_unidentified", leader: null,
        selected: null, followers: [], lagging: [], conflicts: leaders.filter(c => c.onset === leader.onset).map(c => c.book.book), episodeAt: null };
    }
    if (initialGroup.length > 1) {
      leader = equivalentRepresentative(initialGroup); leaderSources = initialGroup.map(c => c.book.book);
    }
    const conflicting = activeCandidates.filter(c => opposite(c, leader));
    const lagging: string[] = [];
    if (conflicting.length) {
      let latestEpisode = [...activeCandidates].sort((a, b) => b.onset - a.onset || order(a, b))[0]!;
      const latestGroup = activeCandidates.filter(c => c.onset === latestEpisode.onset);
      if (latestGroup.length > 1 && !latestGroup.every(c => sameEffect(c, latestEpisode))) {
        reasons.push(`${coordinate}:leader_unidentified_equal_source_instant`);
        return { authority: "context_only" as const, status: "leader_unidentified", leader: null,
          selected: null, followers: [], lagging: [], conflicts: activeCandidates.filter(c => c.onset === latestEpisode.onset).map(c => c.book.book), episodeAt: null };
      }
      if (latestGroup.length > 1) latestEpisode = equivalentRepresentative(latestGroup);
      const opponents = activeCandidates.filter(c => opposite(c, latestEpisode));
      if (opponents.every(c => c.current < latestEpisode.onset)) {
        leader = latestEpisode; leaderSources = latestGroup.map(c => c.book.book); lagging.push(...opponents.map(c => c.book.book));
      } else {
        reasons.push(`${coordinate}:unresolved_named_episode_conflict`);
        return { authority: "context_only" as const, status: "unresolved_conflict", leader: null,
          selected: null, followers: [], lagging: [], conflicts: activeCandidates.map(c => c.book.book), episodeAt: null };
      }
    }
    let priorFrontierSource: string | null = null, incrementalExtension = 0;
    let frontierExtended = false;
    let ambiguousExtensions = false;
    let extensionConflicts: string[] = [];
    const frontierPath = [...leaderSources];
    // Walk the chronology through every new frontier; a third distinct event
    // must not be mislabeled a copied follower after processing only the first.
    for (let step = 0; step < activeCandidates.length; step++) {
      const extensions = activeCandidates.filter(c => c !== leader && !opposite(c, leader) && c.latestEconomic > leader.onset &&
        leader.current < c.latestEconomic && Math.abs(c.delta) > Math.abs(leader.delta) && numericalZero(c.scaleDelta - leader.scaleDelta))
        .sort((a, b) => a.latestEconomic - b.latestEconomic);
      if (!extensions.length) break;
      const extensionGroup = extensions.filter(c => c.latestEconomic === extensions[0]!.latestEconomic);
      ambiguousExtensions = extensionGroup.length > 1 && !extensionGroup.every(c => sameEffect(c, extensionGroup[0]!));
      if (ambiguousExtensions) {
        reasons.push(`${coordinate}:frontier_extension_leader_unidentified`);
        extensionConflicts = extensionGroup.map(c => c.book.book);
        break;
      }
      const extension = equivalentRepresentative(extensionGroup);
      priorFrontierSource = leaderSources.length === 1 ? leaderSources[0]! : null;
      incrementalExtension = extension.delta - leader.delta; leader = extension; frontierExtended = true;
      leaderSources = extensionGroup.map(c => c.book.book);
      frontierPath.push(...leaderSources);
    }
    const heldSources = books.filter(b => !leaderSources.includes(b.book) && !cancellations.some(c => c.book === b.book) && relevant(b).length &&
      relevant(b).every(p => numericalZero(p.observedLocationDelta)) && relevant(b).some(p => Date.parse(p.current.captureAt) >= leader.onset)).map(b => b.book);
    return { authority: "causal_authority" as const, status: ambiguousExtensions ? "frontier_extension_unresolved" : frontierExtended ? "frontier_extension" : lagging.length ? "later_episode_supersedes_unobserved_laggards" : leaderSources.length > 1 ? "equivalent_simultaneous_episode" : "observed_named_leader",
      leader: leaderSources.length === 1 ? leaderSources[0]! : null, selected: leader.book,
      equivalentSources: leaderSources.length > 1 ? leaderSources : [],
      selectionBasis: leaderSources.length > 1 ? "identical_coordinate_receipt" : "observed_source_chronology",
      followers: activeCandidates.filter(c => !leaderSources.includes(c.book.book) && !opposite(c, leader)).map(c => c.book.book),
      lagging: [...lagging, ...cancelledFollowers], heldSources, cancelledBy: cancellations.map(c => c.book),
      conflicts: extensionConflicts,
      episodeAt: new Date(frontierExtended ? leader.latestEconomic : leader.onset).toISOString(), priorFrontierSource, incrementalExtension, frontierPath };
  };
  const marginEpisode = arbitrate("margin"), totalEpisode = arbitrate("total");
  // Apply only the selected chronology-fitted innovation. Static market level
  // remains value/opposition context; adopting it as a score without observed
  // chronology would reintroduce the rejected discontinuous market replacement.
  let margin = marginEpisode.selected?.margin ?? args.independentMargin;
  let marginScale = marginEpisode.selected?.marginScale ?? 1;
  let total = totalEpisode.selected?.total ?? args.independentTotal;
  if (![margin, marginScale, total].every(Number.isFinite) || marginScale <= 0 || total <= 0 || Math.abs(margin) > total) {
    reasons.push("joint_score_support_conflict"); margin = args.independentMargin; total = args.independentTotal; marginScale = 1;
  }
  const pressure: { source: string; provider: string; sourceType: string; reactionBook: string | null; market: Market; side: string;
    majoritySide: string | null; differentialSide: string | null; basis: "handle_ticket_differential" | "handle_concentration";
    reaction: "held" | "aligned" | "opposed" | "unmatched_quote_context"; gapPp: number | null }[] = [];
  const latestSplits = new Map<string, NbaReaderSplitRow>();
  for (const row of context.splitRows) {
    const captured = Date.parse(row.fetchedAt), observed = Date.parse(row.sourceObservedAt ?? row.fetchedAt);
    if (![captured, observed].every(Number.isFinite) || captured > evaluated || observed > captured) continue;
    const source = `${row.provider}|${canonical(row.sourceBook)}|${row.market}|${row.selectionKey}`;
    const prior = latestSplits.get(source);
    if (!prior || captured > Date.parse(prior.fetchedAt)) latestSplits.set(source, row);
  }
  const processedSplits = new Set<string>();
  if (context.splitsTrusted) for (const split of [...latestSplits.values()].sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))) {
    const side = split.selectionKey.split(":").at(-1), source = canonical(split.sourceBook);
    const firstSide = split.market === "total" ? "over" : "home", secondSide = split.market === "total" ? "under" : "away";
    const splitKey = `${split.provider}|${source}|${split.market}`;
    if (processedSplits.has(splitKey) || !split.selectionKey.startsWith(`${context.eventId}:${split.market}:`) ||
        ![firstSide, secondSide].includes(side ?? "") || split.moneyPct === null || !Number.isFinite(split.moneyPct) ||
        split.betsPct !== null && !Number.isFinite(split.betsPct)) continue;
    const observed = Date.parse(split.sourceObservedAt ?? split.fetchedAt), capture = Date.parse(split.fetchedAt);
    if (![observed, capture].every(Number.isFinite) || observed > capture || capture > evaluated || evaluated - capture > 120 * 60_000) continue;
    const unit = (v: number) => Math.abs(v) <= 1 ? v : v / 100;
    const rawBets = split.betsPct === null ? null : unit(split.betsPct), rawMoney = unit(split.moneyPct);
    if (rawBets !== null && (rawBets < 0 || rawBets > 1) || rawMoney < 0 || rawMoney > 1) continue;
    processedSplits.add(splitKey);
    const opposite = latestSplits.get(`${split.provider}|${source}|${split.market}|${context.eventId}:${split.market}:${side === firstSide ? secondSide : firstSide}`);
    if (opposite && Date.parse(opposite.sourceObservedAt ?? opposite.fetchedAt) === observed &&
        (opposite.moneyPct !== null && Math.abs(rawMoney + unit(opposite.moneyPct) - 1) > .01 ||
          rawBets !== null && opposite.betsPct !== null && Math.abs(rawBets + unit(opposite.betsPct) - 1) > .01)) {
      reasons.push(`${splitKey}:conflicting_split_pair`); continue;
    }
    const bets = rawBets === null ? null : side === firstSide ? rawBets : 1 - rawBets, money = side === firstSide ? rawMoney : 1 - rawMoney;
    const gap = bets === null ? null : money - bets, differential = gap !== null && !numericalZero(gap);
    const direction = differential ? Math.sign(gap!) : Math.sign(money - .5);
    if (direction === 0) continue;
    const contract = split.market === "moneyline" ? 0 : split.marketLine === null ? null : split.market === "spread"
      ? (side === firstSide ? -split.marketLine : split.marketLine) : split.marketLine;
    // A reaction begins at the actual quote at/before the split observation,
    // not at the day's opening and not at the later current quote's line.
    const linked = [...causalLanes.values()].flatMap(sequence => {
      const current = sequence.at(-1);
      if (!current) return [];
      if (!context.pricesTrusted || !names.has(current.book) || (current.book !== source && source !== "consensus") ||
          current.market !== split.market || Date.parse(current.captureAt) <= observed || Date.parse(current.captureAt) < capture ||
          evaluated - Date.parse(current.captureAt) > 120 * 60_000) return [];
      const before = sequence.filter(f => Date.parse(f.captureAt) <= observed && Date.parse(f.sourceAt) <= observed).at(-1);
      if (!before || contract === null || Math.abs(before.threshold - contract) > 1e-9) return [];
      return [{ current, before }];
    }).sort((a, b) => Date.parse(b.current.captureAt) - Date.parse(a.current.captureAt) || Number(b.current.provider === "owls") - Number(a.current.provider === "owls"));
    const common = { source, provider: split.provider, sourceType: split.sourceType, market: split.market,
      side: direction > 0 ? firstSide : secondSide,
      majoritySide: money === .5 ? null : money > .5 ? firstSide : secondSide,
      differentialSide: !differential ? null : gap! > 0 ? firstSide : secondSide,
      basis: !differential ? "handle_concentration" as const : "handle_ticket_differential" as const,
      gapPp: gap === null ? null : 100 * gap };
    // Public consensus is explicitly NOT called the sharp book's handle.
    // Unmatched pressure remains context, never a fabricated quote reaction.
    if (!linked.length) pressure.push({ ...common, reactionBook: null, reaction: "unmatched_quote_context" });
    const seen = new Set<string>();
    for (const p of linked) {
      if (seen.has(p.current.book)) continue;
      seen.add(p.current.book);
      const reaction = location(p.current, law) - location(p.before, law);
      pressure.push({ ...common, reactionBook: p.current.book,
        reaction: numericalZero(reaction) ? "held" : Math.sign(reaction) === direction ? "aligned" : "opposed" });
    }
  }
  const sequences = selected.map(p => ({ source: p.book, market: p.market, onsetAt: p.path.onsetAt,
    retracement: p.path.retracement, latestLeg: p.path.latestLeg, net: p.path.netLocationChange }));
  // O(lanes × named sources), with one summary per book, not a persisted row
  // for every tick and no per-card/provider fetches.
  const followers = [...causalLanes.values()].filter(sequence => sequence.length && !names.has(sequence[0]!.book)).flatMap(sequence => {
    const retail = sequence.filter(f => Date.parse(f.captureAt) >= Date.parse(state.knowledgeAt));
    const first = retail[0], last = retail.at(-1);
    if (!first || !last || first.captureAt === last.captureAt) return [];
    const start = location(first, law), move = location(last, law) - start;
    const onset = retail.find(f => !numericalZero(location(f, law) - start));
    if (!onset) return [];
    return selected.flatMap(leader => {
      if (leader.market !== last.market || !leader.path.onsetAt) return [];
      return [{ leader: leader.book, follower: last.book, market: last.market, observedAt: last.captureAt,
        reaction: Date.parse(onset.captureAt) <= Date.parse(leader.path.onsetAt) ? "preceded" :
          Math.sign(move) === Math.sign(leader.path.netLocationChange) ? "followed" : "rejected", scoreVotesAdded: 0 }];
    });
  });
  const marginApplied = !numericalZero(margin - args.independentMargin) || !numericalZero(marginScale - 1);
  const totalApplied = !numericalZero(total - args.independentTotal);
  const diagnosticCounts: Record<string, number> = {};
  for (const reason of reasons) diagnosticCounts[reason] = (diagnosticCounts[reason] ?? 0) + 1;
  const currentContexts = [...names].flatMap(book => (["moneyline", "spread", "total"] as const).flatMap(market => {
    const current = contextFrames.filter(f => f.book === book && f.market === market && context.pricesTrusted &&
      evaluated - Date.parse(f.captureAt) <= 120 * 60_000)
      .sort((a, b) => Date.parse(b.captureAt) - Date.parse(a.captureAt) || Number(b.provider === "owls") - Number(a.provider === "owls"))[0];
    if (!current) return [];
    const evaluatedThreshold = market === "moneyline" ? 0 : market === "spread" ? args.spreadHome == null ? null : -args.spreadHome : args.totalLine ?? null;
    const threshold = current.threshold, matchesEvaluatedContract = evaluatedThreshold !== null && numericalZero(threshold - evaluatedThreshold);
    const fairAtBookContract = current.fair;
    const independent = market === "total" ? args.independentTotal : args.independentMargin;
    return [{ book, market, provider: current.provider, captureAt: current.captureAt, sourceAt: current.sourceAt,
      conflicted: reasons.includes(`${book}:${market}:provider_economic_conflict`),
      threshold, fairAtBookContract, independentProbability: nbaResidualCdf(axis(market), independent - threshold, law), matchesEvaluatedContract,
      favoredSide: !matchesEvaluatedContract || numericalZero(fairAtBookContract - .5) ? null : market === "total" ? fairAtBookContract > .5 ? "over" : "under" : fairAtBookContract > .5 ? "home" : "away",
      authority: "context_only" as const, scoreDelta: 0 }];
  }));
  const receipt = ({ selected, ...r }: ReturnType<typeof arbitrate>) => ({ ...r,
    selectedSource: r.equivalentSources?.length ? null : selected?.book ?? null });
  return { release: NBA_MARKET_CONSEQUENCE_RELEASE, state, margin, total, marginScale,
    homeScore: (total + margin) / 2, awayScore: (total - margin) / 2,
    marginApplied, totalApplied, books, pressure, sequences, followers, currentContexts,
    arbitration: { margin: receipt(marginEpisode), total: receipt(totalEpisode) },
    independentInputChanged, reasons: [...new Set(reasons)],
    diagnosticCounts,
    actions: { margin: marginEpisode.status === "frontier_extension_unresolved" ? "retain_last_uncontested" : ["unresolved_conflict", "leader_unidentified"].includes(marginEpisode.status) ? "unresolved" : marginApplied ? "correct" : "context_only",
      total: totalEpisode.status === "frontier_extension_unresolved" ? "retain_last_uncontested" : ["unresolved_conflict", "leader_unidentified"].includes(totalEpisode.status) ? "unresolved" : totalApplied ? "correct" : "context_only" },
    providerCalls: 0, productionWrites: 0 };
}
