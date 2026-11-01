import { buildNflFullGameEvidenceLedger } from "./nflFullGameEvidenceLedger";
import { arbitrateNflFullGameEvidence, type NflMarketResolution } from "./nflFullGameEvidenceArbiter";
import { deriveNflEvaluatedMarketContract, NFL_FULL_GAME_EVIDENCE_RUNTIME_RELEASE,
  type applyNflFullGameEvidenceRuntime } from "./nflFullGameEvidenceRuntime";
import { buildNflV1ActionableGradeBundle } from "./nflV1ActionableGradeCandidate";
import { readNflJointMarketEpisode } from "./nflJointMarketEpisodeRead";
import { selectNflNamedMoneylineEpisodeAfterKnowledge, selectNflNamedPricedLineEpisodeAfterKnowledge,
  transportNflMoneylineEpisode, transportNflPricedLineEpisode,
  type NflEpisodeHistoryBook, type NflNamedMoneylineEpisode, type NflPricedLineEpisode } from "./nflMoneylineEpisodeTransport";
import type { NflV1WeekOneOutcomeForecast } from "./nflV1WeekOneOutcome";
import { NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE } from "./nflTargetExcludedMarketOutcome";
import { applyNflMarketInnovationPosture, type NflMarketInnovationPostureReceipt } from "./nflMarketInnovationPosture";

export const NFL_MARKET_INNOVATION_RELEASE = "nfl_market_innovation_2026_11_01_r1_relative_joint_law" as const;
type Market = "moneyline" | "spread" | "total";
type Book = "circa" | "pinnacle";
type Episode = NflNamedMoneylineEpisode | NflPricedLineEpisode;
type Candidate = { book: Book; market: Market; episode: Episode; direction: -1 | 1;
  firstMoveAt: string; currentAt: string; magnitude: number; reactionAfterFlow: boolean };
export type NflInnovationReactionContext = Partial<Record<Market, {
  flows: Array<{ observedAt: string; direction: -1 | 1 }>;
  books: Array<{ book: string; lastEconomicMoveAt: string | null; lastEconomicDirection: -1 | 1 | null }>;
}>>;
export type NflMarketInnovationReceipt = {
  release: typeof NFL_MARKET_INNOVATION_RELEASE;
  informationOverlap: "not_attested";
  referencePolicy: "observed_same_book_episode";
  selectedSources: Partial<Record<Market, string>>;
  reasons: Record<Market, string>;
  episodes: Array<{ market: Market; book: Book; openingAt: string; currentAt: string;
    firstMoveAt: string; direction: -1 | 1; selected: boolean; magnitude: number;
    sourceProvenance?: NflNamedMoneylineEpisode["sourceProvenance"] }>;
  staticMarketCoordinates: Record<Market, number | null>;
  baseHomeMargin: number;
  baseTotal: number;
  finalHomeMargin: number;
  finalTotal: number;
  constraints: Array<{ market: Market; targetProbability: number; achievedProbability: number }>;
  reactionContext?: NflInnovationReactionContext;
  posture?: NflMarketInnovationPostureReceipt;
};

/**
 * One independent law plus observed economic innovations. Current market
 * levels remain evidence; they are never substituted for the independent law.
 * Unknown news overlap is explicit, not fabricated from a cache-fetch clock.
 * Rebuilding from the original law makes repeated refreshes idempotent.
 */
export function readNflMarketInnovation(args: {
  independentForecast: NflV1WeekOneOutcomeForecast;
  independentInputPolicy: "market_inputs_prohibited";
  history: NflEpisodeHistoryBook[];
  evaluatedAt: string;
  gameStartsAt: string;
  excludedFamiliesByMarket: Record<Market, string[]>;
  staticMarketCoordinates?: Record<Market, number | null>;
  marketReactionContext?: NflInnovationReactionContext;
}): { outcome: NflV1WeekOneOutcomeForecast; receipt: NflMarketInnovationReceipt } {
  const base = args.independentForecast;
  if (args.independentInputPolicy !== "market_inputs_prohibited") {
    throw new Error("NFL innovations require an attested market-free independent forecast.");
  }
  const candidates: Record<Market, Candidate[]> = { moneyline: [], spread: [], total: [] };
  const reasons: Record<Market, string> = { moneyline: "no_qualified_economic_episode",
    spread: "no_qualified_economic_episode", total: "no_qualified_economic_episode" };
  for (const book of ["circa", "pinnacle"] as const) for (const market of ["moneyline", "spread", "total"] as const) {
    if (args.excludedFamiliesByMarket[market].some(x => canonical(x) === book)) continue;
    const common = { history: args.history, sportsbook: book, providerGameId: base.providerGameId,
      statisticalKnowledgeAt: null, informationOverlap: "not_attested" as const,
      evaluatedAt: args.evaluatedAt, gameStartsAt: args.gameStartsAt };
    const episode = market === "moneyline" ? selectNflNamedMoneylineEpisodeAfterKnowledge(common)
      : selectNflNamedPricedLineEpisodeAfterKnowledge({ ...common, market });
    if (!episode) continue;
    const transport = market === "moneyline"
      ? transportNflMoneylineEpisode({ statisticalForecast: base, statisticalKnowledgeAt: null,
          informationOverlap: "not_attested", episode: episode as NflNamedMoneylineEpisode })
      : transportNflPricedLineEpisode({ statisticalForecast: base, statisticalKnowledgeAt: null,
          informationOverlap: "not_attested", episode: episode as NflPricedLineEpisode });
    if (transport.status === "unidentified") { reasons[market] = transport.reason; continue; }
    const delta = "finalHomeWinProbability" in transport
      ? transport.finalHomeWinProbability - transport.statisticalHomeWinProbability
      : transport.finalMean - transport.statisticalMean;
    if (transport.status === "unchanged" || Math.abs(delta) < 1e-12) {
      reasons[market] = "no_net_economic_change"; continue;
    }
    const direction = delta > 0 ? 1 as const : -1 as const;
    const context = args.marketReactionContext?.[market];
    // Re-read the actual post-flow pairs with the same number/juice economics.
    // A raw handicap direction, refreshed quote clock or public majority is
    // not proof of an economic reaction, nor evidence of bookmaker intent.
    const reactionAfterFlow = context?.books.some(trail => canonical(trail.book) === book &&
      context.flows.some(flow => {
        const window = { ...common, statisticalKnowledgeAt: flow.observedAt };
        const postFlow = market === "moneyline" ? selectNflNamedMoneylineEpisodeAfterKnowledge(window)
          : selectNflNamedPricedLineEpisodeAfterKnowledge({ ...window, market });
        if (!postFlow) return false;
        const effect = market === "moneyline"
          ? transportNflMoneylineEpisode({ statisticalForecast: base, statisticalKnowledgeAt: null,
              informationOverlap: "not_attested", episode: postFlow as NflNamedMoneylineEpisode })
          : transportNflPricedLineEpisode({ statisticalForecast: base, statisticalKnowledgeAt: null,
              informationOverlap: "not_attested", episode: postFlow as NflPricedLineEpisode });
        if (effect.status !== "transported") return false;
        const reaction = "finalHomeWinProbability" in effect
          ? effect.finalHomeWinProbability - effect.statisticalHomeWinProbability : effect.finalMean - effect.statisticalMean;
        return Math.sign(reaction) === direction;
      })) ?? false;
    candidates[market].push({ book, market, episode, direction,
      firstMoveAt: firstEconomicMoveAt(args.history, book, market, episode, base, args.gameStartsAt),
      currentAt: episode.currentAt, magnitude: delta, reactionAfterFlow });
  }
  // Actual opposing discoveries are context, not two additive votes. A
  // disagreement on one market cannot erase another qualified market.
  const allCandidates = [...candidates.moneyline, ...candidates.spread, ...candidates.total];
  for (const market of ["moneyline", "spread", "total"] as const) {
    if (new Set(candidates[market].map(x => x.direction)).size > 1) {
      const reacting = candidates[market].filter(x => x.reactionAfterFlow);
      if (reacting.length === 1) {
        candidates[market] = reacting;
        reasons[market] = "price_reaction_adjudicates_older_opposed_episode";
      } else {
        reasons[market] = "opposed_named_economic_episodes";
        candidates[market] = [];
      }
    }
  }
  const order = (a: Candidate, b: Candidate) => Number(b.reactionAfterFlow) - Number(a.reactionAfterFlow) ||
    Date.parse(a.firstMoveAt) - Date.parse(b.firstMoveAt) ||
    Date.parse(b.currentAt) - Date.parse(a.currentAt) || a.book.localeCompare(b.book);
  // Choose an observed physical leader, never average books or take the
  // smaller change as an arbitrary damping policy. A complete same-book
  // ML/Spread episode keeps both constraints on one margin distribution.
  const marginBooks = (["circa", "pinnacle"] as const).flatMap(book => {
    const rows = [...candidates.moneyline, ...candidates.spread].filter(x => x.book === book).sort(order);
    return rows.length ? [{ book, rows, first: rows[0]! }] : [];
  }).sort((a, b) => Number(b.rows.some(x => x.reactionAfterFlow)) - Number(a.rows.some(x => x.reactionAfterFlow)) ||
    b.rows.length - a.rows.length || order(a.first, b.first));
  const marginSource = marginBooks[0]?.book;
  const ml = candidates.moneyline.find(x => x.book === marginSource);
  const sp = candidates.spread.find(x => x.book === marginSource);
  const total = [...candidates.total].sort(order)[0];
  const selected = [ml, sp, total].filter((x): x is Candidate => !!x);
  for (const item of selected) if (reasons[item.market] !== "price_reaction_adjudicates_older_opposed_episode") {
    reasons[item.market] = item.reactionAfterFlow ? "observed_named_price_reaction_after_qualified_flow"
      : candidates[item.market].length > 1
        ? "originating_same_book_episode_with_named_follow_through" : "single_named_economic_episode";
  }
  const read = readNflJointMarketEpisode({ statisticalForecast: base, statisticalKnowledgeAt: null,
    informationOverlap: "not_attested", moneyline: ml?.episode as NflNamedMoneylineEpisode ?? null,
    spread: sp?.episode as NflPricedLineEpisode ?? null, total: total?.episode as NflPricedLineEpisode ?? null });
  if (read.axisReasons?.margin) for (const market of ["moneyline", "spread"] as const) {
    if (selected.some(x => x.market === market)) reasons[market] = read.axisReasons.margin;
  }
  if (read.axisReasons?.total && total) reasons.total = read.axisReasons.total;
  const outcome = read.outcome;
  return { outcome, receipt: {
    release: NFL_MARKET_INNOVATION_RELEASE, informationOverlap: "not_attested",
    referencePolicy: "observed_same_book_episode", selectedSources: read.selectedSources, reasons,
    episodes: allCandidates.map(x => ({
      market: x.market, book: x.book, openingAt: x.episode.openingAt, currentAt: x.currentAt,
      firstMoveAt: x.firstMoveAt, direction: x.direction,
      sourceProvenance: x.episode.sourceProvenance,
      selected: read.selectedSources[x.market] === x.book, magnitude: x.magnitude })),
    staticMarketCoordinates: args.staticMarketCoordinates ?? { moneyline: null, spread: null, total: null },
    baseHomeMargin: base.expectedHomeScore - base.expectedAwayScore,
    baseTotal: base.expectedHomeScore + base.expectedAwayScore,
    finalHomeMargin: outcome.expectedHomeScore - outcome.expectedAwayScore,
    finalTotal: outcome.expectedHomeScore + outcome.expectedAwayScore, constraints: read.constraints,
    reactionContext: args.marketReactionContext,
  } };
}

export function applyNflMarketInnovationRuntime(args: Parameters<typeof applyNflFullGameEvidenceRuntime>[0] & {
  history: NflEpisodeHistoryBook[];
  independentInputPolicy: "market_inputs_prohibited";
}): ReturnType<typeof applyNflFullGameEvidenceRuntime> & { innovation: NflMarketInnovationReceipt } {
  const contract = deriveNflEvaluatedMarketContract({ baselineProduction: args.evaluatedProduction ?? args.baselineProduction,
    homeTeam: args.homeTeam });
  const ledger = buildNflFullGameEvidenceLedger({ evaluatedAt: args.evaluatedAt, finalForecast: args.releasedForecast,
    currentSpreadBoundary: contract.spread ? -contract.spread.homeLine : null,
    currentTotalLine: contract.total?.line ?? null, targetExcludedMarket: args.targetExcludedMarket,
    states: args.states, excludedFamiliesByMarket: args.excludedFamiliesByMarket,
    playbookSplits: args.playbookSplits, sharpSplits: args.sharpSplits,
    forecastCandidates: args.forecastCandidates, availability: args.availability });
  const interpreted = arbitrateNflFullGameEvidence({ releasedForecast: args.releasedForecast, ledger });
  const staticValues = Object.fromEntries((["moneyline", "spread", "total"] as const).map(m => [m,
    ledger.signals.find(s => s.market === m && s.source === "target_excluded_paired_price_score" && s.status === "usable")?.value ?? null,
  ])) as Record<Market, number | null>;
  const read = readNflMarketInnovation({ independentForecast: args.releasedForecast, independentInputPolicy: args.independentInputPolicy,
    history: args.history,
    evaluatedAt: args.evaluatedAt, gameStartsAt: args.gameStartsAt,
    excludedFamiliesByMarket: args.excludedFamiliesByMarket, staticMarketCoordinates: staticValues,
    marketReactionContext: Object.fromEntries((["moneyline", "spread", "total"] as const).map(market => [market, {
      flows: ledger.signals.flatMap(s => s.market === market && s.kind === "split" && s.status === "usable" &&
        s.splitContext?.qualifiedForDirection && s.observedAt && s.side
        ? [{ observedAt: s.observedAt, direction: s.side === "home" || s.side === "over" ? 1 as const : -1 as const }] : []),
      books: ledger.signals.flatMap(s => s.market === market && s.kind === "book_trail" &&
        s.sourceClass === "named" && s.status === "usable" && s.targetExcluded === true
        ? [{ book: s.source, lastEconomicMoveAt: s.marketObservation?.lastEconomicMoveAt ?? null,
            lastEconomicDirection: s.marketPath?.lastEconomicDirection ?? null }] : []),
    }])) });
  const outcome: NflV1WeekOneOutcomeForecast = args.existingLockedRecord ? args.releasedForecast : {
    ...read.outcome,
    targetExclusion: {
      release: NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE,
      status: Object.keys(read.receipt.selectedSources).length ? "target_excluded_market" : "incumbent_fallback",
      reason: Object.keys(read.receipt.selectedSources).length ? "stable_complete_tuple" : "insufficient_or_unstable_target_free_evidence",
      marginFamilyCount: args.targetExcludedMarket?.marginFamilyCount ?? 0,
      moneylineFamilyCount: args.targetExcludedMarket?.moneylineFamilyCount ?? 0,
      totalFamilyCount: args.targetExcludedMarket?.totalFamilyCount ?? 0,
      availableMarkets: Object.keys(read.receipt.selectedSources) as Market[],
      marginExcludedSportsbooks: [...args.excludedFamiliesByMarket.moneyline],
      totalExcludedSportsbooks: [...args.excludedFamiliesByMarket.total],
    },
  };
  const margin = outcome.expectedHomeScore - outcome.expectedAwayScore;
  const total = outcome.expectedHomeScore + outcome.expectedAwayScore;
  const changedMargin = Math.abs(margin - read.receipt.baseHomeMargin) > 1e-9;
  const changedTotal = Math.abs(total - read.receipt.baseTotal) > 1e-9;
  const resolutions = Object.fromEntries((["moneyline", "spread", "total"] as const).map(m => {
    const before = m === "total" ? read.receipt.baseTotal : read.receipt.baseHomeMargin;
    const after = m === "total" ? total : margin;
    const boundary = m === "moneyline" ? 0 : m === "spread" ? ledger.evaluatedContract.spreadHomeMarginBoundary
      : ledger.evaluatedContract.totalLine;
    const old = interpreted.marketResolutions?.[m];
    return [m, { ...old, action: Math.abs(after - before) > 1e-9 ? "changed" : "held",
      reason: read.receipt.reasons[m], releasedValue: before, finalValue: after,
      pairedPriceValue: staticValues[m], namedDirection: ledger.marketContexts[m].namedDirection,
      correctionDirection: Math.sign(after - before), contractDirection: boundary === null ? 0 : Math.sign(after - boundary),
      pairedPriceCorrectionDirection: staticValues[m] === null ? 0 : Math.sign(staticValues[m]! - before),
      corroboratedSingleEpisode: false, flow: old?.flow ?? "unavailable", supportingSignalIds: old?.supportingSignalIds ?? [],
      opposingSignalIds: old?.opposingSignalIds ?? [], contextSignalIds: old?.contextSignalIds ?? [] }];
  })) as Record<Market, NflMarketResolution>;
  const arbitration = { ...interpreted, status: changedMargin || changedTotal ? "applied" as const : "neutral" as const,
    reason: changedMargin || changedTotal ? "semantic_game_story" as const : "coherent_evidence_without_score_authority" as const,
    sideStory: changedMargin ? Math.sign(margin) !== Math.sign(read.receipt.baseHomeMargin)
      ? "winner_regime_change" as const : "same_winner_repricing" as const : "market_story_unavailable" as const,
    totalStory: changedTotal ? "scoring_environment_change" as const : "market_story_unavailable" as const,
    releasedHomeMargin: read.receipt.baseHomeMargin, releasedTotal: read.receipt.baseTotal,
    finalHomeMargin: margin, finalTotal: total, expectedAwayScore: outcome.expectedAwayScore,
    expectedHomeScore: outcome.expectedHomeScore, marketResolutions: resolutions };
  const graded = args.existingLockedRecord ? args.baselineProduction : buildNflV1ActionableGradeBundle({
    providerGameId: args.providerGameId, awayTeam: args.awayTeam, homeTeam: args.homeTeam,
    gameStartsAt: args.gameStartsAt, current: args.current, comparableCurrentBooks: args.comparableCurrentBooks,
    shadowMoneyline: args.shadowMoneyline, outcomeForecast: outcome,
    qualifiedJointForecast: interpreted.interpretationAccounting.allCapturedInterpreted });
  const posture = applyNflMarketInnovationPosture({ production: graded, innovation: read.receipt,
    homeTeam: args.homeTeam, existingLockedRecord: args.existingLockedRecord,
    creatingNewLock: !args.existingLockedRecord && args.shadowMoneyline.decisionStage === "t60_locked" });
  const innovation = args.existingLockedRecord ? { ...read.receipt, selectedSources: {}, episodes: [], constraints: [],
    finalHomeMargin: margin, finalTotal: total } : { ...read.receipt, posture: posture.posture };
  return { release: NFL_FULL_GAME_EVIDENCE_RUNTIME_RELEASE, ledger, arbitration, outcome,
    production: posture.production, innovation };
}

function canonical(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function firstEconomicMoveAt(history: NflEpisodeHistoryBook[], book: Book, market: Market, episode: Episode,
  forecast: NflV1WeekOneOutcomeForecast, gameStartsAt: string): string {
  const rows = history.filter(x => x.providerGameId === forecast.providerGameId &&
    ((x.provider === "owls" && !!x.providerEventId) ||
      (x.storedCanonicalEvent?.canonicalGameId === forecast.providerGameId &&
       x.storedCanonicalEvent.sourceProvider === x.provider &&
       x.storedCanonicalEvent.sourceObservedAt === (x.marketObservedAt?.[market] ?? x.observedAt))) &&
    canonical(x.sportsbook) === book && x[market])
    .map(x => ({ at: x.marketObservedAt?.[market] ?? x.observedAt, quote: x[market] }))
    .filter(x => Date.parse(x.at) >= Date.parse(episode.openingAt) && Date.parse(x.at) <= Date.parse(episode.currentAt))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const seen = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify(row.quote); if (seen.has(key)) continue;
    // Reuse the same exact-event/pair validator for every possible origin.
    // A malformed row or a fully compensated number/juice revision cannot
    // create a false leadership clock.
    const common = { history, sportsbook: book, providerGameId: forecast.providerGameId,
      statisticalKnowledgeAt: null, informationOverlap: "not_attested" as const,
      evaluatedAt: row.at, gameStartsAt };
    const prefix = market === "moneyline" ? selectNflNamedMoneylineEpisodeAfterKnowledge(common)
      : selectNflNamedPricedLineEpisodeAfterKnowledge({ ...common, market });
    if (!prefix || Date.parse(prefix.currentAt) !== Date.parse(row.at)) continue;
    seen.add(key);
    const effect = market === "moneyline"
      ? transportNflMoneylineEpisode({ statisticalForecast: forecast, statisticalKnowledgeAt: null,
          informationOverlap: "not_attested", episode: prefix as NflNamedMoneylineEpisode })
      : transportNflPricedLineEpisode({ statisticalForecast: forecast, statisticalKnowledgeAt: null,
          informationOverlap: "not_attested", episode: prefix as NflPricedLineEpisode });
    if (effect.status === "transported") return prefix.currentAt;
  }
  return episode.currentAt;
}
