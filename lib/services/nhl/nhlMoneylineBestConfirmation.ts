import { NHL_REGULAR_MODEL_RELEASE, NHL_REGULAR_CALIBRATION_RELEASE, NHL_REGULAR_DECISION_RELEASE,
  resolveNhlPriceAwareVerdict, type NhlVerdictKey, type NhlModelOutput } from "../../automodel/nhlRegularModelV1";
import { buildNhlReaderReceipt, decodeNhlReaderReceipt, NHL_READER_RECEIPT_RELEASE, type NhlReaderReceipt,
  type NhlReaderReceiptExpectedIdentity } from "./nhlReaderReceipt";
import type { NhlSelectedPriceQuote } from "./nhlLineBoard";
import { canonicalNhlSportsbookFamily as family } from "./nhlSportsbookFamily";
import { arbitrateNhlMarketEpisode } from "./nhlMarketEpisodeArbiter";

const professional = (book: string) => ["circa", "pinnacle", "bookmaker"].includes(family(book));
const implied = (price: number) => price > 0 ? 100 / (100 + price) : -price / (100 - price);
const maximumAge = 3 * 60 * 60_000;

/** Eligibility for an existing Best, never another probability adjustment.
 * Both writer passes use the same hash/identity/price-bound source receipt. */
export function resolveNhlMoneylineBestVerdict(args: {
  verdict: NhlVerdictKey; probability: number; quote: NhlSelectedPriceQuote | null;
  receipt: NhlReaderReceipt; expected: NhlReaderReceiptExpectedIdentity;
}): NhlVerdictKey {
  const price = args.quote?.odds_american ?? null;
  const ordinary = resolveNhlPriceAwareVerdict("moneyline", args.verdict, price, args.probability);
  if (args.verdict !== "best_angle" || ordinary !== "lean" || price === null || price <= -900
    || !Number.isFinite(args.probability) || args.probability - implied(price) < .05 - 1e-12) return ordinary;
  const decoded = decodeNhlReaderReceipt(args.receipt, args.expected);
  if (decoded.status !== "valid" || decoded.receipt.release !== NHL_READER_RECEIPT_RELEASE
    || args.expected.modelVersion !== NHL_REGULAR_MODEL_RELEASE
    || args.expected.calibrationVersion !== NHL_REGULAR_CALIBRATION_RELEASE
    || args.expected.decisionVersion !== NHL_REGULAR_DECISION_RELEASE) return ordinary;
  const receipt = decoded.receipt, market = receipt.markets.moneyline, quote = market.evaluatedQuote;
  const at = Date.parse(receipt.cutoffAt), captured = Date.parse(receipt.capturedAt);
  const fresh = (clock: { sourceObservedAt: string | null; receivedAt: string; capturedAt: string }) => {
    const observed = Date.parse(clock.sourceObservedAt ?? ""), received = Date.parse(clock.receivedAt);
    // A capture is only an availability upper bound. Evidence received after
    // the forecast cutoff cannot qualify this prospective grade exception.
    return Number.isFinite(observed) && observed <= received && received <= at && received <= captured
      && observed <= at && at - observed <= maximumAge && clock.capturedAt === receipt.capturedAt;
  };
  if (!args.quote || !quote || args.quote.market_type !== "moneyline" || quote.line !== null
    || args.quote.line_value !== null || args.quote.side !== quote.side || args.quote.sportsbook !== quote.sportsbook
    || args.quote.odds_american !== quote.american || args.quote.observed_at !== quote.clock.sourceObservedAt
    || !fresh(quote.clock) || Math.max(captured, at) >= Date.parse(receipt.identity.gameStartAt)
    || market.after.probability !== args.probability
    || market.after.pick !== `${quote.side === "home" ? receipt.identity.homeAbbr : receipt.identity.awayAbbr} ML`
    || market.after.homeScore !== receipt.finalDecision.finalHomeGoals
    || market.after.awayScore !== receipt.finalDecision.finalAwayGoals) return ordinary;
  const read = market.interpretation, sign = quote.side === "home" ? 1 : -1;
  if (read.state !== "confirmation" || read.side !== quote.side || read.authoritySource !== "market_episode"
    || read.observedInnovation === null || read.observedInnovation * sign <= 0
    || read.appliedInnovation * sign <= 0 || !read.reasonCodes.includes("qualified_split_response")) return ordinary;
  const selected = market.consideredPaths.filter(path => path.selected);
  if (selected.length !== 1) return ordinary;
  const author = selected[0], pair = market.confirmationQuotePair;
  if (!pair || !professional(author.sportsbook) || author.sourceClass !== "named"
    || family(author.sportsbook) === family(quote.sportsbook) || !fresh(author.clock)
    || author.currentCoordinate === null || author.currentCoordinate <= 0 || author.currentCoordinate >= 1) return ordinary;
  const movedAt = Date.parse(read.selectedMoveAt ?? "");
  const pressure = market.splits.professionalBooks.filter(split => split.selectedForPressure && split.rejectionReason === null
    && split.confidence === "high" && split.selectedSide === quote.side && split.sourceBook
    && professional(split.sourceBook) && family(split.sourceBook) !== family(quote.sportsbook)
    && split.marketLine === null && fresh(split.clock)
    && movedAt > Date.parse(split.clock.receivedAt) && movedAt <= Date.parse(author.clock.sourceObservedAt ?? "")
    && Math.abs(split.selectedMoneyPct + split.opposingMoneyPct - 100) < 1e-8
    && Math.abs(split.selectedBetsPct + split.opposingBetsPct - 100) < 1e-8
    && (split.selectedMoneyPct - split.selectedBetsPct >= 10
      || Math.abs(split.selectedMoneyPct - split.selectedBetsPct) < 10 && split.selectedMoneyPct >= 55 && split.selectedBetsPct >= 55));
  if (pressure.length !== 1 || market.splits.professionalBooks.some(split => split.rejectionReason === "professional_conflict")) return ordinary;
  const paths = market.confirmationSourcePaths ?? [], split = pressure[0];
  const matching = paths.filter(path => family(path.sportsbook) === family(author.sportsbook));
  if (matching.length !== 1) return ordinary;
  const path = matching[0];
  if (!path || path.market !== "moneyline" || path.contractKey !== "full_game_ml" || !path.complete
    || path.sourceClass !== "named" || family(path.sportsbook) !== family(author.sportsbook)
    || family(path.sportsbookFamily) !== family(author.sportsbook)
    || path.currentObservedAt !== author.clock.sourceObservedAt || path.currentValue !== author.currentCoordinate
    || path.observations[0]?.value !== path.openingValue || path.observations.at(-1)?.value !== path.currentValue) return ordinary;
  // Reuse r27's exact causal-leg arbiter. Full-window buyback/reversal and old
  // net direction do not veto a clean post-availability professional response.
  const causal = arbitrateNhlMarketEpisode({ market: "moneyline", contractKey: "full_game_ml", decisionAt: receipt.cutoffAt,
    executionSportsbookFamily: quote.sportsbook, paths, materialMove: .01,
    maximumPathAgeMs: maximumAge, maximumPressureAgeMs: maximumAge, followerWindowMs: 45 * 60_000,
    pressure: { market: "moneyline", source: "identified_professional_split", sourceClass: "sharp", sourceBook: split.sourceBook,
      pressureSide: quote.side as "home" | "away", moneyPct: split.selectedMoneyPct, ticketsPct: split.selectedBetsPct,
      confidence: split.confidence, completePair: true, observedAt: split.clock.sourceObservedAt!, receivedAt: split.clock.receivedAt } });
  if (causal.state !== "confirmation" || causal.direction !== quote.side || !causal.author
    || family(causal.author.sportsbook) !== family(author.sportsbook) || causal.selectedMoveAt !== read.selectedMoveAt
    || Math.abs(causal.innovation - read.observedInnovation) > 1e-10) return ordinary;
  if ([pair.home, pair.away].some(stop => stop.line !== null || !Number.isSafeInteger(stop.american)
    || Math.abs(stop.american) < 100 || family(stop.sportsbook) !== family(author.sportsbook)
    || stop.clock.sourceObservedAt !== author.clock.sourceObservedAt || !fresh(stop.clock))
    || pair.home.side !== "home" || pair.away.side !== "away") return ordinary;
  const hold = implied(pair.home.american) + implied(pair.away.american);
  const homeFair = implied(pair.home.american) / hold;
  if (hold < .98 || hold > 1.3 || Math.abs(homeFair - author.currentCoordinate) > 1e-10) return ordinary;
  const sourceFair = quote.side === "home" ? homeFair : 1 - homeFair;
  const profit = price > 0 ? price / 100 : 100 / -price;
  return sourceFair * profit - (1 - sourceFair) > 1e-12 ? "best_angle" : ordinary;
}

/** Freeze the same price-aware verdicts used by prediction_records. */
export function priceNhlModelWithReaderReceipt(args: {
  model: NhlModelOutput; receipt: NhlReaderReceipt; expected: NhlReaderReceiptExpectedIdentity;
  quotes: Record<"moneyline" | "total" | "spread", NhlSelectedPriceQuote | null>;
}): { model: NhlModelOutput; receipt: NhlReaderReceipt } {
  const model = structuredClone(args.model);
  model.moneyline.verdict = resolveNhlMoneylineBestVerdict({ verdict: model.moneyline.verdict,
    probability: model.moneyline.probability, quote: args.quotes.moneyline, receipt: args.receipt, expected: args.expected });
  model.total.verdict = resolveNhlPriceAwareVerdict("total", model.total.verdict, args.quotes.total?.odds_american ?? null, model.total.probability);
  model.puck_line.verdict = resolveNhlPriceAwareVerdict("spread", model.puck_line.verdict, args.quotes.spread?.odds_american ?? null, model.puck_line.probability);
  const { receiptHash: _hash, ...body } = structuredClone(args.receipt);
  body.markets.moneyline.after.verdict = model.moneyline.verdict;
  body.markets.total.after.verdict = model.total.verdict;
  body.markets.spread.after.verdict = model.puck_line.verdict;
  return { model, receipt: buildNhlReaderReceipt(body) };
}
