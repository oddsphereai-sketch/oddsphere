import { nbaResidualCdf, nbaResidualQuantile, type NbaPriceCoordinateLaw } from "./nbaPricedMarketMovement";
import type { NbaReaderPriceRow, NbaReaderSplitRow } from "./nbaProfessionalMarketReader";

export const NBA_MARKET_CONSEQUENCE_RELEASE = "nba_market_consequence_2026_10_31_r1_semantic_epoch_transport" as const;
type Market = "moneyline" | "spread" | "total";
type Frame = { book: string; provider: string; market: Market; captureAt: string; sourceAt: string;
  run: string; event: string; threshold: number; fair: number };
export type NbaMarketKnowledgeState = {
  release: typeof NBA_MARKET_CONSEQUENCE_RELEASE;
  eventId: string;
  inputFingerprint: string;
  knowledgeAt: string;
  anchors: Record<string, Frame>;
};
export type NbaMarketConsequenceContext = {
  eventId: string;
  inputFingerprint: string;
  evaluatedAt: string;
  previousState?: NbaMarketKnowledgeState | null;
  priceRows: readonly NbaReaderPriceRow[];
  splitRows: readonly NbaReaderSplitRow[];
  pricesTrusted: boolean;
  splitsTrusted: boolean;
  excludedSportsbooksByMarket?: Partial<Record<Market, readonly string[]>>;
  disabledMarkets?: readonly Market[];
};
type Proposal = { book: string; provider: string; market: Market; anchor: Frame; current: Frame;
  innovationLogOdds: number; probability: number; location: number; delta: number;
  path: { peakLocation: number; troughLocation: number; netLocationChange: number; retracement: number;
    onsetAt: string | null; latestLeg: number; captures: number } };
type BookDecision = { book: string; margin: number | null; marginScale: number; total: number | null;
  jointStatus: "joint_constraints" | "single_contract" | "joint_conflict" | "no_side_update";
  ignoredMarkets?: Market[];
  proposals: Proposal[] };
const canonical = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const names = new Set(["circa", "pinnacle", "bookmaker"]);
const key = (p: Pick<Frame, "book" | "provider" | "market">) => `${p.book}|${p.provider}|${p.market}`;
const numericalZero = (n: number) => Math.abs(n) <= 1e-9;
const logit = (p: number) => {
  if (!(p > 0 && p < 1)) throw new Error("Unresolved tail probability");
  return Math.log(p) - Math.log1p(-p);
};
const logistic = (z: number) => z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b), i = Math.floor(v.length / 2);
  return v.length % 2 ? v[i]! : (v[i - 1]! + v[i]!) / 2;
};
const axis = (market: Market) => market === "total" ? "total" as const : "spread" as const;
const location = (frame: Frame, law: NbaPriceCoordinateLaw) => frame.threshold + nbaResidualQuantile(axis(frame.market), frame.fair, law);

// The released A&S CDF approximation has <1.5e-7 absolute error. Two
// constraints closer than their combined numerical uncertainty do not identify
// scale. This is numerical identifiability, not a market-amplitude threshold.
function jointLaw(pWin: number, pCover: number, threshold: number, law: NbaPriceCoordinateLaw) {
  if (numericalZero(threshold)) return Math.abs(pWin - pCover) <= 3e-7
    ? { margin: nbaResidualQuantile("spread", pWin, law), scale: 1 } : null;
  if (Math.abs(pWin - pCover) <= 3e-7 || Math.sign(pWin - pCover) !== Math.sign(threshold)) return null;
  const qWin = nbaResidualQuantile("spread", pWin, law), qCover = nbaResidualQuantile("spread", pCover, law);
  const difference = qWin - qCover, scale = threshold / difference, margin = scale * qWin;
  const condition = (Math.abs(qWin) + Math.abs(qCover)) / Math.abs(difference);
  return Number.isFinite(scale) && Number.isFinite(margin) && scale > 0 && condition * Number.EPSILON < 1e-9
    ? { margin, scale } : null;
}

export function isNbaMarketKnowledgeState(value: unknown): value is NbaMarketKnowledgeState {
  if (!value || typeof value !== "object") return false;
  const v = value as NbaMarketKnowledgeState;
  if (v.release !== NBA_MARKET_CONSEQUENCE_RELEASE || typeof v.eventId !== "string" || typeof v.inputFingerprint !== "string" ||
      !Number.isFinite(Date.parse(v.knowledgeAt)) || !v.anchors || typeof v.anchors !== "object" || Array.isArray(v.anchors)) return false;
  return Object.entries(v.anchors).every(([laneKey, f]) => f && typeof f.book === "string" && typeof f.provider === "string" &&
    typeof f.event === "string" && !!f.run && ["moneyline", "spread", "total"].includes(f.market) &&
    [Date.parse(f.captureAt), Date.parse(f.sourceAt), f.threshold, f.fair].every(Number.isFinite) &&
    Date.parse(f.captureAt) >= Date.parse(v.knowledgeAt) && Date.parse(f.sourceAt) >= Date.parse(v.knowledgeAt) && Date.parse(f.sourceAt) <= Date.parse(f.captureAt) &&
    f.fair > 0 && f.fair < 1 && key(f) === laneKey);
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
    const pa = implied(a[0]!.americanPrice!), pb = implied(b[0]!.americanPrice!);
    result.push({ book: canonical(first.sportsbook), provider: first.provider!, market, captureAt: first.fetchedAt,
      sourceAt: new Date(Math.max(...rows.map(r => Date.parse(r.providerTimestamp ?? r.fetchedAt)))).toISOString(),
      run: first.ingestionRunId!, event: first.providerEventId ?? context.eventId,
      threshold: market === "moneyline" ? 0 : market === "spread" ? -a[0]!.line! : a[0]!.line!, fair: pa / (pa + pb) });
  }
  return { frames: result.sort((a, b) => Date.parse(a.captureAt) - Date.parse(b.captureAt)), issues };
}

/** Continuous relative-odds transport, not a current-market forecast anchor.
 * Same-book ML/Spread constrain one location/scale jointly (never added or
 * fixed 50/50). The released residual family is retained; impossible ordering
 * produces explicit conflict rather than an invented forced crossing.
 */
export function reconcileNbaMarketConsequence(args: {
  independentMargin: number; independentTotal: number; law: NbaPriceCoordinateLaw; context: NbaMarketConsequenceContext;
  spreadHome?: number | null; totalLine?: number | null;
}) {
  const { context, law } = args, evaluated = Date.parse(context.evaluatedAt);
  if (!Number.isFinite(evaluated) || !context.inputFingerprint || !context.eventId ||
      ![args.independentMargin, args.independentTotal, law.marginSigma, law.totalSigma].every(Number.isFinite) ||
      args.independentTotal <= 0 || law.marginSigma <= 0 || law.totalSigma <= 0) throw new Error("Invalid NBA consequence context");
  const previous = context.previousState;
  const continuing = isNbaMarketKnowledgeState(previous) && previous.eventId === context.eventId &&
    previous.inputFingerprint === context.inputFingerprint && Number.isFinite(Date.parse(previous.knowledgeAt)) && Date.parse(previous.knowledgeAt) <= evaluated;
  const state: NbaMarketKnowledgeState = { release: NBA_MARKET_CONSEQUENCE_RELEASE, eventId: context.eventId,
    inputFingerprint: context.inputFingerprint, knowledgeAt: continuing ? previous!.knowledgeAt : context.evaluatedAt,
    anchors: continuing ? structuredClone(previous!.anchors) : {} };
  const captured = frames(context), reasons: string[] = [...captured.issues];
  for (const market of context.disabledMarkets ?? []) reasons.push(`${market}:execution_target_cycle_coordinate_retired`);
  if (!context.pricesTrusted) reasons.push("price_family_failed_valid_other_families_retained");
  if (!context.splitsTrusted) reasons.push("split_family_failed_price_authority_retained");
  const lanes = new Map<string, Frame[]>();
  for (const frame of captured.frames) lanes.set(key(frame), [...(lanes.get(key(frame)) ?? []), frame]);
  const causalLanes = new Map<string, Frame[]>();
  const proposals: Proposal[] = [];
  for (const [laneKey, capturedSequence] of lanes) {
    let latestSource = Date.parse(state.anchors[laneKey]?.sourceAt ?? state.knowledgeAt);
    let lastSourceFrame: Frame | undefined = state.anchors[laneKey];
    const sequence = capturedSequence.filter(f => {
      const source = Date.parse(f.sourceAt);
      if (source < Date.parse(state.knowledgeAt) || source < latestSource ||
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
    if (anchor && (key(anchor) !== laneKey || Date.parse(anchor.captureAt) < Date.parse(state.knowledgeAt) ||
        Date.parse(anchor.captureAt) > evaluated || anchor.event !== latest.event)) { reasons.push(`${laneKey}:invalid_saved_anchor`); continue; }
    if (!anchor) {
      anchor = sequence.find(f => Date.parse(f.captureAt) >= Date.parse(state.knowledgeAt) && Date.parse(f.sourceAt) >= Date.parse(state.knowledgeAt));
      if (anchor) state.anchors[laneKey] = anchor;
    }
    if (!anchor) { reasons.push(`${laneKey}:awaiting_post_input_anchor`); continue; }
    if (Date.parse(latest.captureAt) <= Date.parse(anchor.captureAt)) { reasons.push(`${laneKey}:anchor_is_not_movement`); continue; }
    // Fresh collection of an unchanged quote is valid held-price evidence.
    // This existing data-health window is not an amplitude activation rule.
    if (evaluated - Date.parse(latest.captureAt) > 120 * 60_000) { reasons.push(`${laneKey}:stale_current_capture`); continue; }
    try {
      const kind = axis(latest.market), independent = kind === "total" ? args.independentTotal : args.independentMargin;
      const openingAtCurrent = nbaResidualCdf(kind, location(anchor, law) - latest.threshold, law);
      const independentProbability = nbaResidualCdf(kind, independent - latest.threshold, law);
      const innovation = logit(latest.fair) - logit(openingAtCurrent);
      const probability = logistic(logit(independentProbability) + innovation);
      const proposed = numericalZero(innovation) ? independent : latest.threshold + nbaResidualQuantile(kind, probability, law);
      const path = [anchor, ...sequence.filter(f => Date.parse(f.captureAt) > Date.parse(anchor!.captureAt))];
      const points = path.map(f => location(f, law)), first = points[0]!, end = points.at(-1)!;
      const peak = Math.max(...points), trough = Math.min(...points), net = end - first;
      proposals.push({ book: latest.book, provider: latest.provider, market: latest.market, anchor, current: latest,
        innovationLogOdds: innovation, probability, location: proposed, delta: proposed - independent,
        path: { peakLocation: peak, troughLocation: trough, netLocationChange: net,
          retracement: net >= 0 ? peak - end : end - trough,
          onsetAt: path.find((f, i) => !numericalZero(points[i]! - first))?.captureAt ?? null,
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
    let margin: number | null = null, scale = 1, jointStatus: BookDecision["jointStatus"] = "no_side_update";
    if (ml && spread) {
      if (numericalZero(ml.innovationLogOdds) && numericalZero(spread.innovationLogOdds)) {
        margin = args.independentMargin; jointStatus = "joint_constraints";
        if (rows.length) books.push({ book, margin, marginScale: scale, total: total?.location ?? null, jointStatus, proposals: rows });
        continue;
      }
      const solved = jointLaw(ml.probability, spread.probability, spread.current.threshold, law);
      if (solved && Math.abs(solved.margin) <= args.independentTotal) {
        margin = solved.margin; scale = solved.scale; jointStatus = "joint_constraints";
      } else if (Math.abs(ml.probability - spread.probability) <= 3e-7 && !numericalZero(spread.current.threshold)) {
        margin = ml.location; jointStatus = "single_contract";
        reasons.push(`${book}:spread_scale_unidentified_moneyline_scalar_retained`);
      } else jointStatus = "joint_conflict";
      if (jointStatus === "joint_conflict") reasons.push(`${book}:moneyline_spread_joint_conflict`);
    } else if (ml || spread) { margin = (ml ?? spread)!.location; jointStatus = "single_contract"; }
    if (rows.length) books.push({ book, margin, marginScale: scale, total: total?.location ?? null, jointStatus, proposals: rows,
      ignoredMarkets: reasons.includes(`${book}:spread_scale_unidentified_moneyline_scalar_retained`) ? ["spread"] : [] });
  }
  const sideBooks = books.filter(b => b.margin !== null), totalBooks = books.filter(b => b.total !== null);
  // Pool probabilities on COMMON contracts, not separately averaged parameters:
  // combining (mu=6,s=1) and (mu=24,s=4) must preserve their unanimous ML.
  const pWin = sideBooks.length ? median(sideBooks.map(b => nbaResidualCdf("spread", b.margin! / b.marginScale, law))) : null;
  const coverThreshold = args.spreadHome == null ? null : -args.spreadHome;
  const pCover = coverThreshold === null || !sideBooks.length ? null : median(sideBooks.map(b => nbaResidualCdf("spread", (b.margin! - coverThreshold) / b.marginScale, law)));
  const aggregate = pWin === null ? null : pCover === null ? { margin: nbaResidualQuantile("spread", pWin, law), scale: 1 }
    : jointLaw(pWin, pCover, coverThreshold!, law);
  if (pWin !== null && aggregate === null) reasons.push("aggregate_scale_unidentified_moneyline_scalar_retained");
  let margin = aggregate?.margin ?? (pWin === null ? args.independentMargin : nbaResidualQuantile("spread", pWin, law));
  let marginScale = aggregate?.scale ?? 1;
  const totalThreshold = args.totalLine ?? args.independentTotal;
  let total = totalBooks.length ? totalThreshold + nbaResidualQuantile("total", median(totalBooks.map(b => nbaResidualCdf("total", b.total! - totalThreshold, law))), law) : args.independentTotal;
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
  return { release: NBA_MARKET_CONSEQUENCE_RELEASE, state, margin, total, marginScale,
    homeScore: (total + margin) / 2, awayScore: (total - margin) / 2,
    marginApplied, totalApplied, books, pressure, sequences, followers,
    independentInputChanged: !continuing, reasons: [...new Set(reasons)],
    diagnosticCounts,
    actions: { margin: marginApplied ? "adjusted_from_post_input_evidence" : sideBooks.length ? "confirmed_or_offset" : "retained_with_reason",
      total: totalApplied ? "adjusted_from_post_input_evidence" : totalBooks.length ? "confirmed_or_offset" : "retained_with_reason" },
    providerCalls: 0, productionWrites: 0 };
}
