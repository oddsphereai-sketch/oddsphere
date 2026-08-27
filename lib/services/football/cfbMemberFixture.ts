import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyEdgeGameDto, DailyEdgePredictionDto, MarketEdgeDto, OddsTrailStopDto } from "@/app/lab/lib/labTypes";
import type { PreviewHistoryByTeam } from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import {
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_LEGACY_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MEMBER_RELEASE,
  type CfbForwardMarketOutlook,
  type CfbForwardEvidencePayload,
  type CfbForwardPlaybookSplit,
  type CfbForwardStoredEvidence,
} from "./cfbForwardEvidence";
import { readCfbForwardEvidence } from "./cfbForwardEvidenceStore";
import {
  CFB_V1_DECISION_RELEASE,
  CFB_V1_DISTRIBUTION_RELEASE,
  CFB_V1_MODEL_RELEASE,
  CFB_V1_PROBABILITY_RELEASE,
  CFB_V1_SCORE_ARTIFACT_RELEASE,
  type CfbV1ExactPriceDecision,
  type CfbV1Market,
} from "./cfbV1Decision";
import { activeCfbWeeklyWindow, isGameInCfbWeeklyWindow } from "./cfbWeeklyWindow";
import { cfbFootballEvidenceStats } from "./footballMemberEvidence";

export const CFB_MEMBER_FIXTURE_RELEASE =
  "cfb_v1_member_fixture_2026_08_27_r6_pmf_side_guard" as const;
const CFB_PRIOR_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_26_r4_price_provenance" as const;
const CFB_PRIOR_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_26_r7_sharpapi_price_fallback" as const;
const CFB_LEGACY_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_25_r2_weekly" as const;
const CFB_LEGACY_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_25_r5_weekly" as const;

export type CfbMemberFixture = {
  fixtureRelease: typeof CFB_MEMBER_FIXTURE_RELEASE;
  capturedAt: string;
  snapshot: { as_of: string; sport: "cfb"; date: string; requested_date: string; fallback_used: false; slateState: "today_draft_only"; slate_status: string; last_slate_update_at: string; games: DailyEdgeGameDto[] };
  history: PreviewHistoryByTeam;
  week: { label: string };
  provenance: { sourceChecksum: string; openingCoverageGames: number; splitCoverageGames: number; quarterbackCoverageGames: number; currentOddsGames: number };
  tracking: { trackingEligible: boolean; reason: string };
};

export async function readCurrentCfbMemberFixture(args: { client: SupabaseClient; season?: number }): Promise<CfbMemberFixture> {
  return buildCfbMemberFixture(await readCfbForwardEvidence({ client: args.client, season: args.season ?? 2026 }));
}

export function buildCfbMemberFixture(rows: CfbForwardStoredEvidence[], now = new Date().toISOString()): CfbMemberFixture {
  const window = activeCfbWeeklyWindow(now);
  const windowRows = rows.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window));
  const latest = latestCompleteRows(windowRows);
  const movementRowsByGame = new Map(latest.map((row) => [
    row.providerGameId,
    movementRowsForGame(windowRows, row),
  ]));
  const capturedAt = latest.reduce((value, row) => Date.parse(row.capturedAt) > Date.parse(value) ? row.capturedAt : value, latest[0]!.capturedAt);
  const games = latest
    .map((row) => buildGame(row, movementRowsByGame.get(row.providerGameId)!))
    .sort((a, b) => Date.parse(a.gameStartAt ?? "") - Date.parse(b.gameStartAt ?? ""));
  const date = localDate(games[0]!.gameStartAt!);
  const sourceChecksum = createHash("sha256")
    .update([...movementRowsByGame.values()].flat()
      .map((row) => `${row.providerGameId}:${row.capturedAt}:${row.payloadSha256}`)
      .sort()
      .join("|"))
    .digest("hex");
  const trackingGames = latest.filter((row) => row.payload.decisions.trackingEnabled).length;
  return {
    fixtureRelease: CFB_MEMBER_FIXTURE_RELEASE,
    capturedAt,
    snapshot: { as_of: capturedAt, sport: "cfb", date, requested_date: date, fallback_used: false, slateState: "today_draft_only", slate_status: "cfb_week_one_model_live", last_slate_update_at: capturedAt, games },
    history: {},
    week: { label: window.boardStartDate === "2026-08-27" ? "Opening Week" : `Week of ${shortDate(window.boardStartDate)}` },
    provenance: {
      sourceChecksum,
      openingCoverageGames: latest.filter((row) => row.payload.market.operationalOpening !== null).length,
      splitCoverageGames: latest.filter((row) => row.payload.market.playbookSplits !== null).length,
      quarterbackCoverageGames: latest.filter((row) => row.payload.coverage.activeQuarterbacks).length,
      currentOddsGames: latest.filter((row) => row.payload.market.current !== null).length,
    },
    tracking: { trackingEligible: trackingGames > 0, reason: trackingGames > 0 ? `${trackingGames} game${trackingGames === 1 ? " has" : "s have"} a valid immutable T-60 exact-price tuple.` : "Official CFB tracking begins game by game only after a valid T-60 lock; unlocked grades are not counted yet." },
  };
}

function movementRowsForGame(
  rows: CfbForwardStoredEvidence[],
  latest: CfbForwardStoredEvidence,
): CfbForwardStoredEvidence[] {
  return rows
    .filter((row) =>
      row.providerGameId === latest.providerGameId &&
      row.payload.schemaRelease === latest.payload.schemaRelease &&
      Date.parse(row.capturedAt) <= Date.parse(latest.capturedAt))
    .sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt));
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00.000Z`));
}

function latestCompleteRows(rows: CfbForwardStoredEvidence[]): CfbForwardStoredEvidence[] {
  if (rows.length === 0) throw new Error("CFB forward evidence is empty.");
  const current = completeRowsForRelease(rows, CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_MEMBER_RELEASE, CFB_V1_DECISION_RELEASE);
  if (current) return current;
  const transitionFallback = completeRowsForRelease(rows, CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE, CFB_PRIOR_MEMBER_RELEASE, CFB_PRIOR_DECISION_RELEASE);
  if (transitionFallback) return transitionFallback;
  const legacyFallback = completeRowsForRelease(rows, CFB_FORWARD_LEGACY_EVIDENCE_SCHEMA_RELEASE, CFB_LEGACY_MEMBER_RELEASE, CFB_LEGACY_DECISION_RELEASE);
  if (legacyFallback) return legacyFallback;
  throw new Error("CFB has no complete current or release-transition member evidence.");
}

function completeRowsForRelease(
  rows: CfbForwardStoredEvidence[],
  schemaRelease: string,
  memberRelease: string,
  decisionRelease: string,
): CfbForwardStoredEvidence[] | null {
  const latest = new Map<string, CfbForwardStoredEvidence>();
  for (const row of rows) {
    if (row.payload.schemaRelease !== schemaRelease || row.payload.memberRelease !== memberRelease) continue;
    const current = latest.get(row.providerGameId);
    if (!current || Date.parse(row.capturedAt) > Date.parse(current.capturedAt)) latest.set(row.providerGameId, row);
  }
  const values = [...latest.values()];
  if (values.length === 0) return null;
  const expected = Math.max(...values.map((row) => row.payload.slateGameCount));
  if (values.length !== expected) return null;
  if (values.some((row) =>
    !row.payload.decisions.publicationEnabled ||
    row.payload.decisions.decisionRelease !== decisionRelease ||
    row.payload.decisions.evaluatedBets.some((decision) => decision.decisionRelease !== decisionRelease)
  )) return null;
  return values;
}

function buildGame(row: CfbForwardStoredEvidence, movementRows: CfbForwardStoredEvidence[]): DailyEdgeGameDto {
  const payload = row.payload;
  const decisions = payload.decisions.evaluatedBets;
  const moneyline = buildMarket(payload, "moneyline", decisionFor(decisions, "moneyline"), movementRows);
  const total = buildMarket(payload, "total", decisionFor(decisions, "total"), movementRows);
  const spread = buildMarket(payload, "spread", decisionFor(decisions, "spread"), movementRows);
  const startsAt = payload.game.scheduledStart;
  const started = Date.parse(row.capturedAt) >= Date.parse(startsAt);
  const t60 = payload.stage === "t60";
  const allHeld = payload.decisions.heldMarkets.length === 3;
  const headline = [moneyline, total, spread].sort((a, b) => verdictRank(b.verdict.key) - verdictRank(a.verdict.key))[0]!;
  return {
    id: `cfb-${payload.game.providerGameId}`,
    sport: "cfb",
    external_id: Number(payload.game.providerGameId),
    awayTeam: payload.game.away.abbreviation,
    awayTeamLogo: null,
    homeTeam: payload.game.home.abbreviation,
    homeTeamLogo: null,
    gameTime: timeEt(startsAt),
    gameStartAt: startsAt,
    gameStartMinutes: minutesEt(startsAt),
    scheduledLockAt: new Date(Date.parse(startsAt) - 60 * 60_000).toISOString(),
    lockState: started || t60 ? "locked" : Date.parse(row.capturedAt) >= Date.parse(startsAt) - 60 * 60_000 ? "locking" : "open",
    lockedAt: t60 ? row.capturedAt : null,
    updatedAt: row.capturedAt,
    generatedAt: row.capturedAt,
    holdReason: allHeld ? "cfb_exact_price_tuple_incomplete" : null,
    homeStarter: null,
    awayStarter: null,
    predictions: { ml: legacyPrediction(moneyline), total: { ...legacyPrediction(total), line: total.line }, nrfi: legacyPrediction(spread) },
    markets: { moneyline, total, first_inning: spread },
    decisionLine: headline.verdict.key === "best_angle" ? `Best angle: ${headline.pick}` : headline.verdict.key === "lean" ? `Lean: ${headline.pick}` : headline.verdict.key === "watchlist" ? `Watchlist: ${headline.pick}` : allHeld ? "Bet grades Held · outcome forecast remains live" : "No exact-price play clears the current policy",
    projected: { away: payload.decisions.forecast.representativeScore.away, home: payload.decisions.forecast.representativeScore.home },
    footballProjection: { awayWinProbability: 1 - payload.decisions.forecast.homeWinProbability, homeWinProbability: payload.decisions.forecast.homeWinProbability, expectedAwayPoints: payload.decisions.forecast.expectedAwayPoints, expectedHomePoints: payload.decisions.forecast.expectedHomePoints, modelRelease: CFB_V1_MODEL_RELEASE, distributionRelease: CFB_V1_DISTRIBUTION_RELEASE, probabilityRelease: CFB_V1_PROBABILITY_RELEASE, artifactRelease: CFB_V1_SCORE_ARTIFACT_RELEASE },
    sharpSignals: buildSignals(payload),
    status: { lineupConfirmed: null, linesLocked: payload.market.current !== null || payload.market.playbookLine !== null, sharpSignalPending: payload.market.playbookSplits === null, marketDataLimited: payload.market.current === null && payload.market.playbookLine === null },
    result: null,
    breakdown: { verdict: headline.verdict, sharpRead: { key: "mixed", sentence: "The independent score distribution and exact-price market evaluation are shown separately." }, modelBreakdown: `OddSphere projects ${payload.game.away.abbreviation} ${payload.decisions.forecast.expectedAwayPoints.toFixed(1)}–${payload.decisions.forecast.expectedHomePoints.toFixed(1)} ${payload.game.home.abbreviation}; the reachable representative score is ${payload.decisions.forecast.representativeScore.away}–${payload.decisions.forecast.representativeScore.home}.` },
  };
}

function buildMarket(
  payload: CfbForwardEvidencePayload,
  market: CfbV1Market,
  decision: CfbV1ExactPriceDecision | null,
  movementRows: CfbForwardStoredEvidence[],
): MarketEdgeDto {
  const held = decision === null;
  const outlook = payload.decisions.marketOutlooks?.[market] ?? null;
  const displayedProbability = decision?.modelProbability ?? outlook?.independentProbability ?? null;
  const slot = market === "spread" ? payload.market.current?.spread : market === "total" ? payload.market.current?.total : payload.market.current?.moneyline;
  const split = payload.market.playbookSplits?.[market] ?? null;
  const selectedSide = decision ? canonicalSide(payload, decision) : outlook?.side ?? (market === "total" ? "over" : "home");
  const selectedSplit = splitValue(split, market, selectedSide);
  const trails = decision
    ? decisionTrails(payload, decision, movementRows)
    : { selected: [] as OddsTrailStopDto[], opposing: [] as OddsTrailStopDto[] };
  const isBest = decision?.grade === "Best Angle";
  const isLean = decision?.grade === "Lean";
  const isWatch = decision?.grade === "Watchlist";
  const actionability = isBest ? 82 : isLean ? 62 : isWatch ? 45 : decision ? 30 : null;
  const label = market === "moneyline" ? "moneyline" : market;
  const reason = held
    ? outlook
      ? `The ${label} Bet grade is Held because a named offered price or target-excluded same-line consensus is unavailable. The independent PMF still favors ${outlookLabel(payload, outlook)} at ${(100 * outlook.independentProbability).toFixed(1)}%; this is forecast context, not an offered sportsbook bet.`
      : `The ${label} Bet grade is Held because a named offered price or target-excluded same-line consensus is unavailable. No market-specific line context is available, so only the game-level independent forecast is published.`
    : `${decision.side} is evaluated at ${formatAmerican(decision.evaluatedQuote.price)} from ${decision.evaluatedQuote.sportsbook}; the ${decision.grade} grade uses that exact quote, the independent PMF, and other-book fair consensus.`;
  const publicSplits = buildPublicSplits(payload, market);
  return {
    pick: decision?.side ?? null,
    confidence: displayedProbability,
    grade: isBest ? "best_signal" : isLean ? "model_only" : isWatch ? "market_watch" : null,
    signalType: isBest ? "balanced" : isLean ? "model_only" : null,
    marketSignal: "market_neutral",
    sharpStatus: "mixed",
    held,
    verdict: held ? { key: "no_play", label: "Held" } : isBest ? { key: "best_angle", label: "Best Angle" } : isLean ? { key: "lean", label: "Lean" } : isWatch ? { key: "watchlist", label: "Watchlist" } : { key: "no_play", label: "No Play" },
    rawGrade: isBest ? "best_signal" : isLean ? "model_only" : isWatch ? "market_watch" : null,
    rawRecScore: actionability,
    capReasons: held ? ["cfb_exact_price_tuple_incomplete"] : [`cfb_${decision.grade.toLowerCase().replace(/\s+/g, "_")}`, ...payload.coverage.availabilityWarnings],
    finalGrade: isBest ? "best_signal" : isLean ? "model_only" : isWatch ? "market_watch" : null,
    finalRecScore: actionability,
    actionabilityLabel: held ? "Held" : decision!.grade,
    displayReason: reason,
    guidedGuide: reason,
    guidedWatchOut: "Prices and projected quarterback context refresh until the immutable T-60 tuple. CFB injury and venue-weather feeds are not available from the current provider and are labeled honestly.",
    whyLine: reason,
    riskLine: "Outcome confidence and exact-price Bet grade are separate. Public splits are Playbook consensus, not a substitute for the model or SharpAPI.",
    modelProb: displayedProbability,
    marketFairProb: decision?.marketFairProbability ?? null,
    pinnacleEvPct: decision ? decision.expectedValue * 100 : null,
    moneyPct: selectedSplit.money,
    betsPct: selectedSplit.bets,
    publicSplits,
    sharpBookAvailability: { status: "provider_limited", message: "SharpAPI NCAAF betting-split rows are unavailable; Playbook public consensus is shown separately and is not relabeled as sharp-book money.", lastUpdated: null },
    priceAmerican: decision?.evaluatedQuote.price ?? null,
    currentPriceAmerican: decision?.evaluatedQuote.price ?? null,
    currentPriceSportsbook: decision?.evaluatedQuote.sportsbook ?? null,
    currentPriceObservedAt: decision?.evaluatedQuote.observedAt ?? null,
    bestAvailablePriceAmerican: null,
    bestAvailableSportsbook: null,
    bestAvailableObservedAt: null,
    gradePriceAmerican: decision?.evaluatedQuote.price ?? null,
    fiMarketBoard: null,
    lineOpenAmerican: trails.selected[0]?.american ?? null,
    priceUnavailableAtLock: false,
    priceObservedAt: decision?.evaluatedQuote.observedAt ?? null,
    priceIsStale: false,
    lineOpenObservedAt: trails.selected[0]?.observedAt ?? null,
    lineOpenIsStale: false,
    moneyPctObservedAt: split?.capturedAt ?? null,
    moneyPctIsStale: false,
    betsPctObservedAt: split?.capturedAt ?? null,
    betsPctIsStale: false,
    oddspherePostedAmerican: decision?.evaluatedQuote.price ?? null,
    oddspherePostedAt: decision?.evaluatedAt ?? null,
    oddspherePostedMatchesPick: decision !== null,
    lockedLineAmerican: decision?.stage === "t60_locked" ? decision.evaluatedQuote.price : null,
    lockedLineAt: decision?.lockedAt ?? null,
    oddsTrail: trails.selected,
    lineTrail: market === "moneyline" ? [] : trails.selected,
    opposingOddsTrail: { side: opposingCanonicalSide(selectedSide), label: opposingLabel(payload, market, selectedSide, decision?.evaluatedQuote.line ?? outlook?.line ?? lineFromSlot(slot)), stops: trails.opposing },
    marketInterpretation: null,
    marketReadV2: null,
    marketReadV2Enabled: false,
    lastMovePrevAmerican: trails.selected.length > 1 ? trails.selected.at(-2)!.american : null,
    lastMoveNextAmerican: trails.selected.at(-1)?.american ?? null,
    lastMoveAtIso: trails.selected.at(-1)?.observedAt ?? null,
    lastMoveLinePrev: trails.selected.length > 1 ? trails.selected.at(-2)!.line : null,
    lastMoveLineNext: trails.selected.at(-1)?.line ?? null,
    modelTotal: market === "total" ? payload.decisions.forecast.expectedTotal : null,
    marketTotal: market === "total" ? decision?.evaluatedQuote.line ?? outlook?.line ?? lineFromSlot(slot) : null,
    line: decision?.evaluatedQuote.line ?? outlook?.line ?? lineFromSlot(slot),
    keyStats: keyStats(payload, market),
    modelTrustPct: displayedProbability === null ? null : displayedProbability * 100,
    marketImpliedPct: decision ? decision.marketFairProbability * 100 : null,
    modelMarketGapPct: decision ? decision.edgePercentagePoints : null,
    recommendationConfidence: actionability,
    marketSource: decision?.evaluatedQuote.sportsbook ?? null,
    marketDataQuality: decision ? "two_sided_consensus" : payload.market.playbookLine ? "single_book" : "unavailable",
    reviewFlags: [CFB_MEMBER_FIXTURE_RELEASE, CFB_V1_MODEL_RELEASE, CFB_V1_DECISION_RELEASE],
    reviewActionSummary: held ? "hold" : "keep",
  };
}

function outlookLabel(payload: CfbForwardEvidencePayload, outlook: CfbForwardMarketOutlook): string {
  if (outlook.market === "moneyline") return outlook.side === "home" ? payload.game.home.abbreviation : payload.game.away.abbreviation;
  if (outlook.market === "spread") {
    const team = outlook.side === "home" ? payload.game.home.abbreviation : payload.game.away.abbreviation;
    return `${team} ${signed(outlook.line ?? 0)}`;
  }
  return `${outlook.side === "over" ? "Over" : "Under"} ${marketNumber(outlook.line ?? 0)}`;
}

function decisionTrails(
  payload: CfbForwardEvidencePayload,
  decision: CfbV1ExactPriceDecision,
  movementRows: CfbForwardStoredEvidence[],
): { selected: OddsTrailStopDto[]; opposing: OddsTrailStopDto[] } {
  const selectedSide = canonicalSide(payload, decision);
  const exactBook = payload.market.currentBooks.find((book) => normalizeBook(book.sportsbook) === normalizeBook(decision.evaluatedQuote.sportsbook));
  const opposingQuote = exactBook ? quoteFor(exactBook, decision.market, opposingCanonicalSide(selectedSide)) : null;
  const selected = buildSameBookTrail({
    rows: movementRows,
    sportsbook: decision.evaluatedQuote.sportsbook,
    market: decision.market,
    side: selectedSide,
    terminal: {
      american: decision.evaluatedQuote.price,
      line: decision.evaluatedQuote.line,
      observedAt: decision.evaluatedQuote.observedAt,
      locked: decision.stage === "t60_locked",
    },
  });
  const opposing = opposingQuote ? buildSameBookTrail({
    rows: movementRows,
    sportsbook: decision.evaluatedQuote.sportsbook,
    market: decision.market,
    side: opposingCanonicalSide(selectedSide),
    terminal: {
      american: opposingQuote.price,
      line: opposingQuote.line,
      observedAt: exactBook!.observedAt,
      locked: decision.stage === "t60_locked",
    },
  }) : [];
  return { selected, opposing };
}

function buildSameBookTrail(args: {
  rows: CfbForwardStoredEvidence[];
  sportsbook: string;
  market: CfbV1Market;
  side: "home" | "away" | "over" | "under";
  terminal: { american: number; line: number | null; observedAt: string; locked: boolean };
}): OddsTrailStopDto[] {
  const sportsbook = normalizeBook(args.sportsbook);
  const candidates: OddsTrailStopDto[] = [];
  const append = (stop: OddsTrailStopDto, replaceDuplicate = false) => {
    const key = `${normalizeBook(stop.sportsbook ?? "")}:${stop.observedAt}:${stop.american}:${stop.line ?? "null"}`;
    const duplicateIndex = candidates.findIndex((candidate) =>
      `${normalizeBook(candidate.sportsbook ?? "")}:${candidate.observedAt}:${candidate.american}:${candidate.line ?? "null"}` === key);
    if (duplicateIndex >= 0) {
      if (replaceDuplicate) candidates.splice(duplicateIndex, 1);
      else return;
    }
    candidates.push(stop);
  };

  for (const row of args.rows) {
    const opening = row.payload.market.providerOpening;
    if (!opening || normalizeBook(opening.sportsbook) !== sportsbook) continue;
    const value = quoteFor(opening, args.market, args.side);
    if (!value) continue;
    append({
      american: value.price,
      line: value.line,
      observedAt: opening.observedAt,
      sportsbook: opening.sportsbook,
      source: "provider_opening",
      label: "open",
    });
  }

  const operationalOpening = args.rows[0]?.payload.market.operationalOpening ?? null;
  if (operationalOpening && normalizeBook(operationalOpening.quote.sportsbook) === sportsbook) {
    const value = quoteFor(operationalOpening.quote, args.market, args.side);
    if (value) append({
      american: value.price,
      line: value.line,
      observedAt: operationalOpening.capturedAt,
      sportsbook: operationalOpening.quote.sportsbook,
      source: operationalOpening.provenance === "provider_opening" ? "provider_opening" : "line_history",
      label: operationalOpening.provenance === "provider_opening" ? "open" : "first",
    });
  }

  for (const row of args.rows.slice(0, -1)) {
    const current = row.payload.market.currentBooks.find((candidate) =>
      normalizeBook(candidate.sportsbook) === sportsbook) ??
      (row.payload.market.current && normalizeBook(row.payload.market.current.sportsbook) === sportsbook
        ? row.payload.market.current
        : null);
    if (!current) continue;
    const value = quoteFor(current, args.market, args.side);
    if (!value) continue;
    append({
      american: value.price,
      line: value.line,
      observedAt: current.observedAt,
      sportsbook: current.sportsbook,
      source: "line_history",
      label: "move",
    });
  }

  append({
    american: args.terminal.american,
    line: args.terminal.line,
    observedAt: args.terminal.observedAt,
    sportsbook: args.sportsbook,
    source: args.terminal.locked ? "locked_snapshot" : "current_line",
    label: args.terminal.locked ? "locked" : "current",
  }, true);

  candidates.sort((first, second) => Date.parse(first.observedAt ?? "") - Date.parse(second.observedAt ?? ""));
  const materialStops = candidates.reduce<OddsTrailStopDto[]>((stops, stop, index) => {
    if (index === 0) return [stop];
    const previous = stops[stops.length - 1]!;
    const changed = previous.american !== stop.american || previous.line !== stop.line;
    const terminal = index === candidates.length - 1;
    if (changed || terminal) stops.push(stop);
    return stops;
  }, []);

  return materialStops.map((stop, index, stops) => ({
    ...stop,
    source: index === stops.length - 1
      ? args.terminal.locked ? "locked_snapshot" : "current_line"
      : stop.source === "provider_opening" ? "provider_opening" : "line_history",
    label: index === stops.length - 1
      ? args.terminal.locked ? "locked" : "current"
      : index === 0
        ? stop.source === "provider_opening" ? "open" : "first"
        : "move",
  }));
}

function keyStats(payload: CfbForwardEvidencePayload, market: CfbV1Market): MarketEdgeDto["keyStats"] {
  const forecast = payload.decisions.forecast;
  const footballEvidence = cfbFootballEvidenceStats({
    awayTeamName: payload.game.away.name,
    homeTeamName: payload.game.home.name,
    market,
    awayQuarterback: { name: payload.quarterbacks.away.expectedStartingQuarterback?.name ?? null, status: payload.quarterbacks.away.starterStatus },
    homeQuarterback: { name: payload.quarterbacks.home.expectedStartingQuarterback?.name ?? null, status: payload.quarterbacks.home.starterStatus },
  });
  if (market === "moneyline") return [
    { label: "Projected winner probability", awayValue: `${((1 - forecast.homeWinProbability) * 100).toFixed(1)}%`, homeValue: `${(forecast.homeWinProbability * 100).toFixed(1)}%`, source: "computed" },
    { label: "Expected points", awayValue: forecast.expectedAwayPoints.toFixed(1), homeValue: forecast.expectedHomePoints.toFixed(1), source: "computed" },
    ...footballEvidence,
  ];
  if (market === "spread") return [
    { label: "Model scoring margin", awayValue: forecast.expectedMarginHome < 0 ? `${payload.game.away.abbreviation} by ${Math.abs(forecast.expectedMarginHome).toFixed(1)}` : null, homeValue: forecast.expectedMarginHome >= 0 ? `${payload.game.home.abbreviation} by ${forecast.expectedMarginHome.toFixed(1)}` : null, source: "computed" },
    { label: "80% margin range", awayValue: null, homeValue: `${forecast.interval80.marginHome[0].toFixed(0)} to ${forecast.interval80.marginHome[1].toFixed(0)}`, source: "computed" },
    ...footballEvidence,
  ];
  return [
    { label: "Model expected total", awayValue: null, homeValue: forecast.expectedTotal.toFixed(1), source: "computed" },
    { label: "Expected points", awayValue: forecast.expectedAwayPoints.toFixed(1), homeValue: forecast.expectedHomePoints.toFixed(1), source: "computed" },
    { label: "80% total range", awayValue: null, homeValue: `${forecast.interval80.total[0].toFixed(0)} to ${forecast.interval80.total[1].toFixed(0)}`, source: "computed" },
    ...footballEvidence,
  ];
}

function buildPublicSplits(payload: CfbForwardEvidencePayload, market: CfbV1Market): MarketEdgeDto["publicSplits"] {
  const split = payload.market.playbookSplits?.[market];
  if (!split) return [];
  const stamp = {
    observedAt: split.capturedAt,
    freshnessCheckedAt: split.capturedAt,
    staleAfterMinutes: cfbSplitStaleAfterMinutes(payload.game.scheduledStart, split.capturedAt),
    isStale: false,
  };
  if (market === "total") return [
    { side: "over", label: "Over", moneyPct: split.overMoneyPct, betsPct: split.overBetsPct, ...stamp },
    { side: "under", label: "Under", moneyPct: split.underMoneyPct, betsPct: split.underBetsPct, ...stamp },
  ];
  return [
    { side: "home", label: payload.game.home.abbreviation, moneyPct: split.homeMoneyPct, betsPct: split.homeBetsPct, ...stamp },
    { side: "away", label: payload.game.away.abbreviation, moneyPct: split.awayMoneyPct, betsPct: split.awayBetsPct, ...stamp },
  ];
}

function cfbSplitStaleAfterMinutes(gameStartsAt: string, observedAt: string): number {
  const untilKickoff = Date.parse(gameStartsAt) - Date.parse(observedAt);
  return untilKickoff <= 48 * 60 * 60_000 ? 90 : 390;
}

function splitValue(split: CfbForwardPlaybookSplit | null, market: CfbV1Market, side: string): { money: number | null; bets: number | null } {
  if (!split) return { money: null, bets: null };
  if (market === "total") return side === "over" ? { money: split.overMoneyPct, bets: split.overBetsPct } : { money: split.underMoneyPct, bets: split.underBetsPct };
  return side === "home" ? { money: split.homeMoneyPct, bets: split.homeBetsPct } : { money: split.awayMoneyPct, bets: split.awayBetsPct };
}

function buildSignals(payload: CfbForwardEvidencePayload): DailyEdgeGameDto["sharpSignals"] {
  if (!payload.market.playbookSplits) return [];
  return [
    { market: "ML", category: "handle_gap", description: "Playbook public money and ticket consensus is available for both teams.", source: "Playbook public consensus", direction: "neutral" },
    { market: "OU", category: "handle_gap", description: "Playbook public money and ticket consensus is available for Over and Under.", source: "Playbook public consensus", direction: "neutral" },
    { market: "NRFI", category: "handle_gap", description: "Playbook public money and ticket consensus is available for both spread sides.", source: "Playbook public consensus", direction: "neutral" },
  ];
}

function legacyPrediction(market: MarketEdgeDto): DailyEdgePredictionDto { return { pick: market.pick, confidence: market.confidence, grade: market.grade, signalType: market.signalType, marketSignal: market.marketSignal, sharpStatus: market.sharpStatus }; }
function decisionFor(decisions: CfbV1ExactPriceDecision[], market: CfbV1Market): CfbV1ExactPriceDecision | null { const matches = decisions.filter((row) => row.market === market); if (matches.length > 1) throw new Error(`CFB member fixture has duplicate ${market} decisions.`); return matches[0] ?? null; }
function canonicalSide(payload: CfbForwardEvidencePayload, decision: CfbV1ExactPriceDecision): "home" | "away" | "over" | "under" { if (decision.market === "total") return /^over\b/i.test(decision.side) ? "over" : "under"; return decision.side.startsWith(payload.game.home.abbreviation) ? "home" : "away"; }
function opposingCanonicalSide(side: string): "home" | "away" | "over" | "under" { return side === "home" ? "away" : side === "away" ? "home" : side === "over" ? "under" : "over"; }
function opposingLabel(payload: CfbForwardEvidencePayload, market: CfbV1Market, side: string, line: number | null): string { if (market === "moneyline") return side === "home" ? payload.game.away.abbreviation : payload.game.home.abbreviation; if (market === "spread") return `${side === "home" ? payload.game.away.abbreviation : payload.game.home.abbreviation} ${signed(line === null ? 0 : -line)}`; return `${side === "over" ? "Under" : "Over"} ${marketNumber(line ?? 0)}`; }
function quoteFor(book: NonNullable<CfbForwardEvidencePayload["market"]["current"]>, market: CfbV1Market, side: string): { price: number; line: number | null } | null { if (market === "moneyline" && book.moneyline) return { price: side === "home" ? book.moneyline.homePrice : book.moneyline.awayPrice, line: null }; if (market === "spread" && book.spread) return { price: side === "home" ? book.spread.homePrice : book.spread.awayPrice, line: side === "home" ? book.spread.homeLine : book.spread.awayLine }; if (market === "total" && book.total) return { price: side === "over" ? book.total.overPrice : book.total.underPrice, line: book.total.line }; return null; }
function lineFromSlot(slot: CfbForwardEvidencePayload["market"]["current"] extends never ? never : unknown): number | null { if (!slot || typeof slot !== "object") return null; const record = slot as Record<string, unknown>; return typeof record.line === "number" ? record.line : typeof record.homeLine === "number" ? record.homeLine : null; }
function normalizeBook(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function formatAmerican(value: number): string { return value > 0 ? `+${value}` : String(value); }
function marketNumber(value: number): string { return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1); }
function signed(value: number): string { return value > 0 ? `+${marketNumber(value)}` : marketNumber(value); }
function verdictRank(value: string): number { return value === "best_angle" ? 3 : value === "lean" ? 2 : value === "watchlist" ? 1 : 0; }
function localDate(value: string): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
function timeEt(value: string): string { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function minutesEt(value: string): number { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(value)); return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0); }
