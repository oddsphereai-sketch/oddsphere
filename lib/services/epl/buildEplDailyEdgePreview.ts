import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import { SharpApiClient } from "@/lib/providers/real_api/_sharpApiClient";
import { SharpApiEplMarketProvider, type EplSharpFixtureMarket, type EplSharpSplitsEvent } from "@/lib/providers/real_api/SharpApiEplMarketProvider";
import type { NormalizedSoccerOddsRecord } from "@/lib/providers/real_api/_soccerMarketNormalizer";
import type { BdlEplOdds } from "@/lib/providers/real_api/BallDontLieEplProvider";
import type { EplShadowSlate, EplShadowSlateMatch } from "./buildEplShadowSlate";
import { eplTeamLogo } from "./eplTeamAssets";
import { deriveEplMatchResultDecision, deriveEplPreviewGrade, EPL_PREVIEW_GRADE_RELEASE, type EplPreviewGrade } from "./eplPreviewGrade";
import {
  buildEplForwardEvidenceCaptures,
  canonicalEplBook,
  eplCurrentBookVectors,
  type EplForwardEvidenceCapture,
} from "./eplForwardEvidenceCapture";
import { deriveEplCoherentMarketOutcome } from "./eplCoherentMarketOutcome";

const BOOK_PRIORITY = ["pinnacle", "circa", "draftkings", "fanduel", "betmgm", "caesars"];
const MAX_FIXTURE_RECOVERY_LOADS = 4;

type Selection = "home" | "draw" | "away" | "over" | "under" | "yes" | "no" | "home_or_draw" | "away_or_draw" | "home_or_away";
type MarketRead = { probabilities: Partial<Record<Selection, number>>; prices: Partial<Record<Selection, number>>; sportsbook: string | null; observedAt: string | null; line: number | null; provider: "sharpapi" | "balldontlie" };
const priceHistory = new Map<string, NonNullable<MarketEdgeDto["oddsTrail"]>>();
const earliestMarketQuotes = new Map<string, NonNullable<NonNullable<MarketEdgeDto["soccerPriceBoard"]>["rows"][number]["earliest_market_quote"]>>();
const previewCache = new Map<string, { expiresAt: number; response: DailyEdgeResponse; allBookPrices: EplStoredPriceObservation[]; forwardEvidence: EplForwardEvidenceCapture[] }>();

type OpeningPrice = { price: number; sportsbook: string | null; observedAt: string | null };

export type EplMatchResultSide = "home" | "draw" | "away";
export type EplDoubleChanceSide = "home_or_draw" | "away_or_draw";

/**
 * Double Chance is coverage for the primary Match Result forecast, not an
 * independent value-selection engine. If Draw is the forecast, cover it with
 * whichever club has the higher win probability.
 */
export function forecastAnchoredDoubleChanceSide(
  forecastSide: EplMatchResultSide,
  probabilities: Pick<EplShadowSlateMatch["prediction"]["probabilities"], "home" | "draw" | "away">,
): EplDoubleChanceSide {
  if (forecastSide === "home") return "home_or_draw";
  if (forecastSide === "away") return "away_or_draw";
  return probabilities.home >= probabilities.away ? "home_or_draw" : "away_or_draw";
}

export type EplStoredPriceObservation = {
  providerId: number;
  market: "match_result" | "double_chance" | "total" | "btts";
  side: string;
  line: number | null;
  american: number;
  sportsbook: string | null;
  recordedAt: string;
  isOpener: boolean;
};

export type EplPreviewBuildOptions = {
  captureAllBookPrices?: (rows: EplStoredPriceObservation[]) => void;
  storedPriceHistory?: EplStoredPriceObservation[];
  captureForwardEvidence?: (captures: EplForwardEvidenceCapture[]) => void;
  marketProvider?: Pick<SharpApiEplMarketProvider, "loadFixture"> | null;
  cacheNamespace?: string;
  cacheIdentity?: string;
  skipForwardEvidence?: boolean;
  maxFixtureRecoveryLoads?: number;
  competitionLabel?: string;
  authorities?: {
    gradeRelease: string;
    deriveCoherentOutcome: typeof deriveEplCoherentMarketOutcome;
    deriveMatchResultDecision: typeof deriveEplMatchResultDecision;
    derivePreviewGrade: typeof deriveEplPreviewGrade;
  };
};

export function buildEplPreviewCacheKey(slate: EplShadowSlate, options: EplPreviewBuildOptions = {}): string {
  const gradeRelease = options.authorities?.gradeRelease ?? EPL_PREVIEW_GRADE_RELEASE;
  const fixtureIdentity = slate.matches.map((match) => `${match.id}@${match.kickoff}`).join(",");
  return `${options.cacheNamespace ?? "epl"}:${slate.round}:${slate.modelRelease}:${gradeRelease}:${options.cacheIdentity ?? fixtureIdentity}`;
}

function boundedTrail(trail: NonNullable<MarketEdgeDto["oddsTrail"]>): NonNullable<MarketEdgeDto["oddsTrail"]> {
  const ordered = [...trail].sort((a, b) => {
    if (a.source === "provider_opening" && b.source !== "provider_opening") return -1;
    if (b.source === "provider_opening" && a.source !== "provider_opening") return 1;
    return Date.parse(a.observedAt ?? "") - Date.parse(b.observedAt ?? "");
  });
  const compact: NonNullable<MarketEdgeDto["oddsTrail"]> = [];
  const terminalQuoteCountByBook = new Map<string, number>();
  for (const stop of ordered) {
    const prior = compact.at(-1);
    const trailKey = `${stop.source}:${stop.sportsbook ?? "unknown"}`;
    const sameQuote = prior
      && prior.source === stop.source
      && prior.american === stop.american
      && prior.line === stop.line
      && prior.sportsbook === stop.sportsbook;
    const sameTimestamp = sameQuote
      && canonicalEplLineHistoryTimestamp(prior.observedAt ?? "") === canonicalEplLineHistoryTimestamp(stop.observedAt ?? "");
    if (sameTimestamp || (sameQuote && (terminalQuoteCountByBook.get(trailKey) ?? 1) >= 2)) continue;
    compact.push({ ...stop });
    terminalQuoteCountByBook.set(trailKey, sameQuote ? 2 : 1);
  }
  const opening = compact.find((stop) => stop.label === "open") ?? null;
  const observed = compact.filter((stop) => stop !== opening);
  const boundedObserved = opening
    ? observed.slice(-7)
    : observed.length <= 8
      ? observed
      : [observed[0]!, ...observed.slice(-7)];
  // Normalize after bounding. If the original first observation falls outside
  // the eight-stop display window, normalizing before the slice leaves no
  // `first` marker. trackedPrice then mistakes the terminal `current` stop for
  // the first observation, and the reader rejects a real long same-book trail.
  boundedObserved.forEach((stop, index) => {
    stop.label = index === 0 ? "first" : index === boundedObserved.length - 1 ? "current" : "move";
  });
  return opening ? [opening, ...boundedObserved] : boundedObserved;
}

function mergePriceTrail(key: string, incoming: NonNullable<MarketEdgeDto["oddsTrail"]>): void {
  const merged = boundedTrail([...(priceHistory.get(key) ?? []), ...incoming]);
  if (merged.length > 0) priceHistory.set(key, merged);
}

function scopedPriceHistoryKey(key: string, sportsbook: string | null): string {
  return `${key}:book:${bookKey(sportsbook) || "unknown"}`;
}

function rememberEarliestMarketQuote(key: string, stop: NonNullable<MarketEdgeDto["oddsTrail"]>[number]): void {
  if (stop.source === "provider_opening" || !Number.isFinite(stop.american) || !stop.observedAt) return;
  const observed = Date.parse(stop.observedAt);
  if (!Number.isFinite(observed)) return;
  const current = earliestMarketQuotes.get(key);
  if (!current || !current.observed_at || observed < Date.parse(current.observed_at)) {
    earliestMarketQuotes.set(key, { american: stop.american, sportsbook: stop.sportsbook, observed_at: stop.observedAt });
  }
}

/** Earliest verified OddSphere capture across books for one exact outcome.
 * Directional movement remains scoped to a single sportsbook. */
export function earliestEplMarketQuote(key: string) {
  const quote = earliestMarketQuotes.get(key);
  return quote ? { ...quote } : null;
}

function mergePriceTrailByBook(key: string, incoming: NonNullable<MarketEdgeDto["oddsTrail"]>): void {
  const grouped = new Map<string, NonNullable<MarketEdgeDto["oddsTrail"]>>();
  for (const stop of incoming) {
    rememberEarliestMarketQuote(key, stop);
    const scoped = scopedPriceHistoryKey(key, stop.sportsbook);
    grouped.set(scoped, [...(grouped.get(scoped) ?? []), stop]);
  }
  for (const [scoped, trail] of grouped) mergePriceTrail(scoped, trail);
}

/** Restore the observed trail after a serverless cold start. */
export function hydrateEplPriceHistory(response: DailyEdgeResponse | null): void {
  if (!response) return;
  for (const game of response.games) {
    const providerId = Number(game.external_id);
    if (!Number.isFinite(providerId)) continue;
    const markets: Array<{ name: "match_result" | "double_chance" | "total" | "btts"; value: MarketEdgeDto }> = [
      { name: "match_result", value: game.markets.moneyline },
      ...(game.soccerDoubleChanceMarket ? [{ name: "double_chance" as const, value: game.soccerDoubleChanceMarket }] : []),
      { name: "total", value: game.markets.total },
      { name: "btts", value: game.markets.first_inning },
    ];
    for (const { name, value } of markets) {
      for (const row of value.soccerPriceBoard?.rows ?? []) {
        if (!row.odds_trail?.length) continue;
        const key = name === "total" ? `${providerId}:total:${row.side}:${value.line ?? 2.5}` : `${providerId}:${name}:${row.side}`;
        mergePriceTrailByBook(key, [...row.odds_trail]);
      }
      const selected = value.soccerPriceBoard?.rows.find((row) => row.selected)?.side;
      if (!selected || !value.oddsTrail?.length) continue;
      const selectedKey = name === "total" ? `${providerId}:total:${selected}:${value.line ?? 2.5}` : `${providerId}:${name}:${selected}`;
      mergePriceTrailByBook(selectedKey, [...value.oddsTrail]);
    }
  }
}

/** Restore durable quote changes when the member snapshot is unavailable or
 * belongs to an older release. Stored rows contain economic changes only. */
export function hydrateEplStoredPriceHistory(rows: EplStoredPriceObservation[]): void {
  const grouped = new Map<string, EplStoredPriceObservation[]>();
  for (const row of rows) {
    const key = row.market === "total"
      ? `${row.providerId}:total:${row.side}:${row.line ?? 2.5}`
      : `${row.providerId}:${row.market}:${row.side}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  for (const [key, observations] of grouped) {
    const sorted = observations.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
    const trail = sorted.map((row, index) => ({
      label: index === 0 ? "first" as const : index === sorted.length - 1 ? "current" as const : "move" as const,
      american: row.american,
      line: row.line,
      sportsbook: row.sportsbook,
      source: "current_line" as const,
      observedAt: row.recordedAt,
    }));
    if (trail.length > 0) mergePriceTrailByBook(key, trail);
  }
}

function bookKey(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function canonicalEplLineHistoryTimestamp(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

export function compactEplStoredPriceHistory(rows: EplStoredPriceObservation[]): EplStoredPriceObservation[] {
  const compact: EplStoredPriceObservation[] = [];
  const lastByTrail = new Map<string, EplStoredPriceObservation>();
  const terminalQuoteCountByTrail = new Map<string, number>();
  for (const row of [...rows].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))) {
    const key = `${row.providerId}:${row.market}:${row.side}:${row.sportsbook ?? "unknown"}`;
    const prior = lastByTrail.get(key);
    const sameQuote = prior && prior.american === row.american && prior.line === row.line;
    const sameTimestamp = prior
      && canonicalEplLineHistoryTimestamp(prior.recordedAt) === canonicalEplLineHistoryTimestamp(row.recordedAt);
    // Two independently timestamped captures verify a flat quote. Legacy
    // duplicate rows at one capture time count once; later unchanged polls are
    // compacted after the verification checkpoint.
    if (sameTimestamp || (sameQuote && (terminalQuoteCountByTrail.get(key) ?? 1) >= 2)) continue;
    compact.push(row);
    lastByTrail.set(key, row);
    terminalQuoteCountByTrail.set(key, sameQuote ? 2 : 1);
  }
  return compact;
}

function openingMoneylinePrice(rows: BdlEplOdds[], side: "home" | "draw" | "away", currentBook: string | null): OpeningPrice | null {
  const priceField = side === "home" ? "moneyline_home_odds" : side === "away" ? "moneyline_away_odds" : "moneyline_draw_odds";
  const complete = rows.filter((row) => typeof row[priceField] === "number" && Number.isFinite(row[priceField]));
  const sameBook = currentBook ? complete.find((row) => bookKey(row.vendor) === bookKey(currentBook)) : null;
  const row = sameBook ?? complete[0];
  if (!row) return null;
  return { price: row[priceField]!, sportsbook: row.vendor || null, observedAt: row.opened_at ?? row.updated_at ?? null };
}

export function trackedPrice(key: string, price: number | null, sportsbook: string | null, providerObservedAt: string | null, line: number | null, opening: OpeningPrice | null = null, capturedAt = new Date().toISOString()): MarketEdgeDto["oddsTrail"] {
  if (price === null) return [];
  rememberEarliestMarketQuote(key, { label: "current", american: price, line, sportsbook, source: "current_line", observedAt: capturedAt });
  const scopedKey = scopedPriceHistoryKey(key, sportsbook);
  const trail = priceHistory.get(scopedKey) ?? [];
  // This is the time OddSphere actually captured the economic quote. Provider
  // freshness remains available on currentPriceObservedAt, but it must not be
  // substituted for our durable observation time or a changed price can be
  // overwritten by a later snapshot carrying the same upstream timestamp.
  const observedAt = capturedAt;
  if (opening && !trail.some((stop) => stop.label === "open")) {
    trail.unshift({ label: "open", american: opening.price, line, sportsbook: opening.sportsbook, source: "provider_opening", observedAt: opening.observedAt });
  }
  if (!trail.some((stop) => stop.label === "first") && trail.filter((stop) => stop.label === "current").length === 1) {
    const firstCurrent = trail.find((stop) => stop.label === "current");
    if (firstCurrent) firstCurrent.label = "first";
  }
  const prior = trail.at(-1);
  const quoteChanged = !prior || prior.american !== price || prior.line !== line || prior.sportsbook !== sportsbook;
  if (quoteChanged) {
    if (prior?.label === "current") prior.label = trail.some((stop) => stop.label === "first" || stop.label === "move") ? "move" : "first";
    trail.push({ label: prior ? "current" : "first", american: price, line, sportsbook, source: "current_line", observedAt });
    const bounded = boundedTrail(trail);
    priceHistory.set(scopedKey, bounded);
    return [...bounded];
  }
  // A provider freshness timestamp is not a price move. Freshness is carried
  // separately by currentPriceObservedAt, so the economic trail is unchanged.
  return [...trail];
}

function display(value: number | null, digits = 1, suffix = ""): string {
  return value === null ? "Not reported" : `${value.toFixed(digits)}${suffix}`;
}

function formString(form: Array<"W" | "D" | "L">, source: "club_history" | "promoted_proxy", competitionLabel: string): string {
  return form.length ? form.join(" · ") : source === "promoted_proxy" ? "Promoted-team proxy" : `No recent ${competitionLabel} sample`;
}

function pctTo100(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value <= 1 ? value * 100 : value;
}

function bestSplits(rows: EplSharpSplitsEvent[]): EplSharpSplitsEvent | null {
  return [...rows].sort((a, b) => Number(Boolean(b.moneyline)) + Number(Boolean(b.total)) + Number(Boolean(b.btts)) - Number(Boolean(a.moneyline)) - Number(Boolean(a.total)) - Number(Boolean(a.btts)))[0] ?? null;
}

function publicSplits(input: { market: "moneyline" | "total" | "btts"; split: EplSharpSplitsEvent | null; home: string; away: string; pick: Selection }): MarketEdgeDto["publicSplits"] {
  const observedAt = input.split?.fetched_at ?? null;
  if (input.market === "btts") {
    const block = input.split?.btts;
    if (!block) return [];
    const rows: MarketEdgeDto["publicSplits"] = [
      { side: "yes", label: "Yes", moneyPct: pctTo100(block.handle_pct?.yes), betsPct: pctTo100(block.bets_pct?.yes), observedAt },
      { side: "no", label: "No", moneyPct: pctTo100(block.handle_pct?.no), betsPct: pctTo100(block.bets_pct?.no), observedAt },
    ];
    if (rows.every((row) => row.moneyPct === null && row.betsPct === null)) return [];
    return rows.sort((a) => a.side === input.pick ? -1 : 1);
  }
  if (input.market === "total") {
    const block = input.split?.total;
    if (!block) return [];
    const rows: MarketEdgeDto["publicSplits"] = [
      { side: "over", label: "Over", moneyPct: pctTo100(block.handle_pct?.over), betsPct: pctTo100(block.bets_pct?.over), observedAt },
      { side: "under", label: "Under", moneyPct: pctTo100(block.handle_pct?.under), betsPct: pctTo100(block.bets_pct?.under), observedAt },
    ];
    if (rows.every((row) => row.moneyPct === null && row.betsPct === null)) return [];
    return rows.sort((a) => a.side === input.pick ? -1 : 1);
  }
  const block = input.split?.moneyline;
  if (!block) return [];
  const rows: MarketEdgeDto["publicSplits"] = [
    { side: "home", label: input.home, moneyPct: pctTo100(block.handle_pct?.home), betsPct: pctTo100(block.bets_pct?.home), observedAt },
    { side: "draw", label: "Draw", moneyPct: pctTo100(block.handle_pct?.draw), betsPct: pctTo100(block.bets_pct?.draw), observedAt },
    { side: "away", label: input.away, moneyPct: pctTo100(block.handle_pct?.away), betsPct: pctTo100(block.bets_pct?.away), observedAt },
  ];
  if (rows.every((row) => row.moneyPct === null && row.betsPct === null)) return [];
  return rows.sort((a) => a.side === input.pick ? -1 : 1);
}

function decimal(row: NormalizedSoccerOddsRecord): number | null {
  if (row.odds_decimal !== null && row.odds_decimal > 1) return row.odds_decimal;
  if (row.odds_american === null) return null;
  return row.odds_american > 0 ? 1 + row.odds_american / 100 : 1 + 100 / Math.abs(row.odds_american);
}

function americanDecimal(price: number | null): number | null {
  if (price === null || !Number.isFinite(price) || price === 0) return null;
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

/**
 * BALLDONTLIE's EPL odds endpoint is a three-way moneyline feed. It is kept
 * strictly as a coherent same-vendor fallback; outcomes are never mixed across
 * books and it never fabricates Total, BTTS, Double Chance, or opening prices.
 */
export function bdlMoneylineRead(rows: BdlEplOdds[]): MarketRead | null {
  const complete = rows.filter((row) =>
    americanDecimal(row.moneyline_home_odds) !== null
    && americanDecimal(row.moneyline_draw_odds) !== null
    && americanDecimal(row.moneyline_away_odds) !== null
  );
  const vendors = [...new Set(complete.map((row) => row.vendor).filter(Boolean))];
  vendors.sort((a, b) => {
    const ai = BOOK_PRIORITY.indexOf(bookKey(a));
    const bi = BOOK_PRIORITY.indexOf(bookKey(b));
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  for (const vendor of vendors) {
    const row = complete.find((candidate) => candidate.vendor === vendor);
    if (!row) continue;
    const prices = {
      home: row.moneyline_home_odds!,
      draw: row.moneyline_draw_odds!,
      away: row.moneyline_away_odds!,
    };
    const raw = {
      home: 1 / americanDecimal(prices.home)!,
      draw: 1 / americanDecimal(prices.draw)!,
      away: 1 / americanDecimal(prices.away)!,
    };
    const overround = raw.home + raw.draw + raw.away;
    if (!Number.isFinite(overround) || overround <= 0) continue;
    return {
      probabilities: { home: raw.home / overround, draw: raw.draw / overround, away: raw.away / overround },
      prices,
      sportsbook: vendor,
      observedAt: row.updated_at,
      line: null,
      provider: "balldontlie",
    };
  }
  return null;
}

function coherentRead(rows: NormalizedSoccerOddsRecord[], market: "match_result" | "double_chance" | "total" | "btts", selections: Selection[], line: number | null = null, probabilityTotal = 1): MarketRead | null {
  const candidates = rows.filter((row) => row.market === market && (line === null || row.line === line));
  const books = [...new Set(candidates.map((row) => row.sportsbook).filter((book): book is string => Boolean(book)))];
  books.sort((a, b) => {
    const ai = BOOK_PRIORITY.indexOf(a.toLowerCase());
    const bi = BOOK_PRIORITY.indexOf(b.toLowerCase());
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  for (const sportsbook of books) {
    const atBook = candidates.filter((row) => row.sportsbook === sportsbook);
    const picked = selections.map((selection) => atBook.find((row) => row.selection === selection));
    if (picked.some((row) => !row || decimal(row) === null)) continue;
    const raw = picked.map((row) => 1 / decimal(row!)!);
    const overround = raw.reduce((sum, value) => sum + value, 0);
    return {
      probabilities: Object.fromEntries(selections.map((selection, index) => [selection, raw[index] / overround * probabilityTotal])),
      prices: Object.fromEntries(selections.map((selection, index) => [selection, picked[index]!.odds_american!])) as Partial<Record<Selection, number>>,
      sportsbook,
      observedAt: picked.map((row) => row!.fetched_at).sort().at(-1) ?? null,
      line,
      provider: "sharpapi",
    };
  }
  return null;
}

function totalRead(rows: NormalizedSoccerOddsRecord[]): MarketRead | null {
  // The released probability and chronological validation are specifically
  // for Over/Under 2.5. Never grade the 2.5 head against a nearby 2.0/3.0 book.
  return coherentRead(rows, "total", ["over", "under"], 2.5);
}

function completeSharpMarkets(rows: NormalizedSoccerOddsRecord[]): Set<NormalizedSoccerOddsRecord["market"]> {
  const complete = new Set<NormalizedSoccerOddsRecord["market"]>();
  if (coherentRead(rows, "match_result", ["home", "draw", "away"])) complete.add("match_result");
  if (coherentRead(rows, "double_chance", ["home_or_draw", "away_or_draw", "home_or_away"], null, 2)) complete.add("double_chance");
  if (totalRead(rows)) complete.add("total");
  if (coherentRead(rows, "btts", ["yes", "no"])) complete.add("btts");
  return complete;
}

function allBookPriceObservations(
  slate: EplShadowSlate,
  fixtureMarkets: EplSharpFixtureMarket[],
  capturedAt: string,
): EplStoredPriceObservation[] {
  const required: Record<EplStoredPriceObservation["market"], string[]> = {
    match_result: ["home", "draw", "away"],
    double_chance: ["home_or_draw", "away_or_draw", "home_or_away"],
    total: ["over", "under"],
    btts: ["yes", "no"],
  };
  const output: EplStoredPriceObservation[] = [];
  fixtureMarkets.forEach((fixture, index) => {
    const providerId = slate.matches[index]?.id;
    if (providerId === undefined) return;
    const groups = new Map<string, NormalizedSoccerOddsRecord[]>();
    for (const row of fixture.odds) {
      if (row.odds_american === null || !Number.isFinite(row.odds_american) || !row.sportsbook) continue;
      if (row.market === "total" && row.line !== 2.5) continue;
      const key = `${row.market}:${bookKey(row.sportsbook)}:${row.market === "total" ? row.line : "main"}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const rows of groups.values()) {
      const first = rows[0];
      if (!first) continue;
      const selections = new Set<string>(rows.map((row) => row.selection));
      if (!required[first.market].every((selection) => selections.has(selection))) continue;
      for (const row of rows) output.push({
        providerId,
        market: row.market,
        side: row.selection,
        line: row.market === "total" ? row.line : null,
        american: row.odds_american!,
        sportsbook: row.sportsbook,
        recordedAt: capturedAt,
        isOpener: false,
      });
    }
  });
  return output;
}

function mergeRecoveredFixture(primary: EplSharpFixtureMarket, recovery: EplSharpFixtureMarket): EplSharpFixtureMarket {
  const recoveredMarkets = completeSharpMarkets(recovery.odds);
  const markets = ["match_result", "double_chance", "total", "btts"] as const;
  const odds = markets.flatMap((market) => {
    const source = recoveredMarkets.has(market) ? recovery.odds : primary.odds;
    return source.filter((row) => row.market === market);
  });
  return {
    eventId: recovery.eventId ?? primary.eventId,
    odds,
    splits: recovery.splits.length ? recovery.splits : primary.splits,
    splitsState: recovery.splitsState === "present" ? "present" : primary.splitsState,
  };
}

function marketBase(input: {
  pick: string;
  modelProb: number;
  marketProb: number | null;
  price: number | null;
  sportsbook: string | null;
  observedAt: string | null;
  line?: number | null;
  modelTotal?: number | null;
  guide: string;
  risk: string;
  keyStats: MarketEdgeDto["keyStats"];
  publicSplits?: MarketEdgeDto["publicSplits"];
  gradeDecision: EplPreviewGrade;
  trailKey: string;
  capturedAt: string;
  opening?: OpeningPrice | null;
  gradeRelease?: string;
  context?: Partial<Pick<MarketEdgeDto, "matchResultThreeWayProbs" | "soccerMatchResultContext" | "soccerDoubleChanceContext" | "soccerPriceBoard" | "soccerTotalContext" | "soccerBttsContext" | "soccerGradeContext">>;
}): MarketEdgeDto {
  const gap = input.marketProb === null ? null : (input.modelProb - input.marketProb) * 100;
  const oddsTrail = trackedPrice(input.trailKey, input.price, input.sportsbook, input.observedAt, input.line ?? null, input.opening ?? null, input.capturedAt) ?? [];
  const sameBookTrail = oddsTrail.filter((stop) => !input.sportsbook || stop.sportsbook === input.sportsbook);
  const operationalOpening = input.opening?.price ?? sameBookTrail[0]?.american ?? input.price;
  return {
    pick: input.pick,
    confidence: input.modelProb,
    grade: input.gradeDecision.grade,
    signalType: null,
    marketSignal: null,
    sharpStatus: input.gradeDecision.verdict.key === "caution" ? "caution" : "mixed",
    held: input.price === null || input.marketProb === null,
    verdict: input.gradeDecision.verdict,
    rawGrade: input.gradeDecision.grade,
    rawRecScore: input.gradeDecision.recommendationScore,
    capReasons: input.gradeDecision.reasons,
    finalGrade: input.gradeDecision.grade,
    finalRecScore: input.gradeDecision.recommendationScore,
    actionabilityLabel: input.gradeDecision.verdict.label,
    displayReason: input.guide,
    guidedGuide: input.guide,
    guidedWatchOut: input.risk,
    whyLine: input.guide,
    riskLine: input.risk,
    modelProb: input.modelProb,
    marketFairProb: input.marketProb,
    pinnacleEvPct: input.price === null ? null : (input.modelProb * (input.price > 0 ? 1 + input.price / 100 : 1 + 100 / Math.abs(input.price)) - 1) * 100,
    moneyPct: null,
    betsPct: null,
    publicSplits: input.publicSplits ?? [],
    priceAmerican: input.price,
    currentPriceAmerican: input.price,
    currentPriceSportsbook: input.sportsbook,
    currentPriceObservedAt: input.observedAt,
    // Daily Edge defines Opening as the earliest verified same-book quote we
    // possess. A provider-native opener wins when available; otherwise the
    // first persisted capture becomes the operational opening observation.
    lineOpenAmerican: operationalOpening,
    oddsTrail,
    modelTotal: input.modelTotal ?? null,
    marketTotal: input.line ?? null,
    line: input.line ?? null,
    keyStats: input.keyStats,
    modelTrustPct: input.modelProb * 100,
    marketImpliedPct: input.marketProb === null ? null : input.marketProb * 100,
    modelMarketGapPct: gap,
    recommendationConfidence: input.gradeDecision.recommendationScore,
    marketSource: input.sportsbook,
    marketDataQuality: input.marketProb === null ? "unavailable" : "two_sided_consensus",
    reviewFlags: [input.gradeRelease ?? EPL_PREVIEW_GRADE_RELEASE, "chronological_tournament_r2"],
    reviewActionSummary: "keep",
    ...input.context,
  };
}

function bestMatchResultSide(match: EplShadowSlateMatch): "home" | "draw" | "away" {
  const p = match.prediction.probabilities;
  const sides: Array<"home" | "draw" | "away"> = ["home", "draw", "away"];
  return sides.sort((a, b) => p[b] - p[a])[0];
}

function gameDto(match: EplShadowSlateMatch, sharp: EplSharpFixtureMarket, capturedAt: string, authorities: NonNullable<EplPreviewBuildOptions["authorities"]> = {
  gradeRelease: EPL_PREVIEW_GRADE_RELEASE,
  deriveCoherentOutcome: deriveEplCoherentMarketOutcome,
  deriveMatchResultDecision: deriveEplMatchResultDecision,
  derivePreviewGrade: deriveEplPreviewGrade,
}, competitionLabel = "EPL"): DailyEdgeGameDto {
  const clubP = match.prediction.probabilities;
  const mr = coherentRead(sharp.odds, "match_result", ["home", "draw", "away"])
    ?? bdlMoneylineRead(match.currentMoneylineOdds);
  const dc = coherentRead(sharp.odds, "double_chance", ["home_or_draw", "away_or_draw", "home_or_away"], null, 2);
  const total = totalRead(sharp.odds);
  const btts = coherentRead(sharp.odds, "btts", ["yes", "no"]);
  const currentTotalVectors = eplCurrentBookVectors(sharp, "total", capturedAt);
  const evaluatedTotalCanonicalBook = canonicalEplBook(total?.sportsbook ?? null);
  const coherentOutcome = authorities.deriveCoherentOutcome({
    independentLambdaHome: match.prediction.lambdaHome,
    independentLambdaAway: match.prediction.lambdaAway,
    totalVectors: currentTotalVectors,
    evaluatedMatchResultCanonicalBook: canonicalEplBook(mr?.sportsbook ?? null),
    evaluatedTotalCanonicalBook,
    evaluatedBttsCanonicalBook: canonicalEplBook(btts?.sportsbook ?? null),
    providerEventId: sharp.eventId,
    decisionAt: capturedAt,
    kickoff: match.kickoff,
  });
  const publishedGoals = coherentOutcome.expectedGoals;
  const publishedTotal = publishedGoals.home + publishedGoals.away;
  const goalOutlookProbabilities = coherentOutcome.markets;
  const p = {
    ...clubP,
    over25: coherentOutcome.markets.total.over,
    under25: coherentOutcome.markets.total.under,
    bttsYes: coherentOutcome.markets.btts.yes,
    bttsNo: coherentOutcome.markets.btts.no,
  };
  const forecastSide = bestMatchResultSide(match);
  const mrDecision = authorities.deriveMatchResultDecision({
    model: { home: p.home, draw: p.draw, away: p.away },
    market: mr ? { home: mr.probabilities.home!, draw: mr.probabilities.draw!, away: mr.probabilities.away! } : null,
    prices: mr ? { home: mr.prices.home!, draw: mr.prices.draw!, away: mr.prices.away! } : null,
    promotedProxy: match.prediction.homeStrengthSource === "promoted_proxy" || match.prediction.awayStrengthSource === "promoted_proxy",
  });
  const resultSide = mrDecision.selectedSide;
  const resultPick = resultSide === "home" ? match.homeTeam.abbreviation : resultSide === "away" ? match.awayTeam.abbreviation : "Draw";
  const forecastPick = forecastSide === "home" ? match.homeTeam.abbreviation : forecastSide === "away" ? match.awayTeam.abbreviation : "Draw";
  const totalForecastSide = p.over25 >= p.under25 ? "over" : "under";
  const totalSide = totalForecastSide;
  const bttsForecastSide = p.bttsYes >= p.bttsNo ? "yes" : "no";
  const bttsSide = bttsForecastSide;
  const representativeScore = coherentOutcome.representativeScore;
  const split = bestSplits(sharp.splits);
  const matchResultSplits = publicSplits({ market: "moneyline", split, home: match.homeTeam.abbreviation, away: match.awayTeam.abbreviation, pick: resultSide });
  const totalSplits = publicSplits({ market: "total", split, home: match.homeTeam.abbreviation, away: match.awayTeam.abbreviation, pick: totalSide });
  const bttsSplits = publicSplits({ market: "btts", split, home: match.homeTeam.abbreviation, away: match.awayTeam.abbreviation, pick: bttsSide });
  const promotedProxy = match.prediction.homeStrengthSource === "promoted_proxy" || match.prediction.awayStrengthSource === "promoted_proxy";
  const splitCopy = sharp.splitsState === "present"
    ? "Current consensus split rows are available as secondary context."
    : sharp.splitsState === "error"
      ? "Consensus betting splits could not be checked on this refresh."
      : `The splits endpoint is connected, but no ${competitionLabel} split rows are currently reported for this fixture.`;
  const mrEdge = mr ? (p[resultSide] - mr.probabilities[resultSide]!) * 100 : null;
  const mrGrade = mrDecision.grade;
  const mrOpening = openingMoneylinePrice(match.openingOdds, resultSide, mr?.sportsbook ?? null);
  const mrMarket = marketBase({
    pick: resultPick,
    modelProb: p[resultSide],
    marketProb: mr?.probabilities[resultSide] ?? null,
    price: mr?.prices[resultSide] ?? null,
    sportsbook: mr?.sportsbook ?? null,
    observedAt: mr?.observedAt ?? null,
    guide: resultSide === forecastSide
      ? `The club model makes ${forecastPick} the most likely regulation result. ${mr ? "The reader compares that probability with a coherent three-way book." : "A coherent three-way market price is still pending."}`
      : `The club model makes ${forecastPick} the most likely result, while ${resultPick} is the strongest price-adjusted 1X2 value. Forecast and betting side are intentionally shown separately.`,
    risk: mrGrade.reasons.join(" "),
    publicSplits: matchResultSplits,
    gradeDecision: mrGrade,
    trailKey: `${match.id}:match_result:${resultSide}`,
    capturedAt,
    opening: mrOpening,
    gradeRelease: authorities.gradeRelease,
    keyStats: [
      { label: "Expected goals", awayValue: publishedGoals.away.toFixed(2), homeValue: publishedGoals.home.toFixed(2), source: "computed" },
      { label: "Recent form", awayValue: formString(match.evidence.away.recentForm, match.prediction.awayStrengthSource, competitionLabel), homeValue: formString(match.evidence.home.recentForm, match.prediction.homeStrengthSource, competitionLabel), source: "feature_snapshot" },
      { label: "Goals for / against · recent", awayValue: `${display(match.evidence.away.avgGoalsFor, 2)} / ${display(match.evidence.away.avgGoalsAgainst, 2)}`, homeValue: `${display(match.evidence.home.avgGoalsFor, 2)} / ${display(match.evidence.home.avgGoalsAgainst, 2)}`, source: "feature_snapshot" },
      { label: "Recent xG created", awayValue: display(match.evidence.away.avgXgFor, 2), homeValue: display(match.evidence.home.avgXgFor, 2), source: "feature_snapshot" },
      { label: "Recent xG allowed", awayValue: display(match.evidence.away.avgXgAgainst, 2), homeValue: display(match.evidence.home.avgXgAgainst, 2), source: "feature_snapshot" },
      { label: "Shots / on target", awayValue: `${display(match.evidence.away.avgShots)} / ${display(match.evidence.away.avgShotsOnTarget)}`, homeValue: `${display(match.evidence.home.avgShots)} / ${display(match.evidence.home.avgShotsOnTarget)}`, source: "feature_snapshot" },
      { label: "Points from recent form", awayValue: `${match.evidence.away.recentPoints} pts`, homeValue: `${match.evidence.home.recentPoints} pts`, source: "feature_snapshot" },
      { label: "Result probabilities", awayValue: `${Math.round(p.away * 100)}% away · ${Math.round(p.draw * 100)}% draw`, homeValue: `${Math.round(p.home * 100)}% home`, source: "computed" },
      { label: "Provider stat sample", awayValue: `${match.evidence.away.statMatches}/${match.evidence.away.sampleMatches} matches · xG ${match.evidence.away.xgMatches}`, homeValue: `${match.evidence.home.statMatches}/${match.evidence.home.sampleMatches} matches · xG ${match.evidence.home.xgMatches}`, source: "feature_snapshot" },
    ],
    context: {
      matchResultThreeWayProbs: { home: p.home, draw: p.draw, away: p.away },
      soccerMatchResultContext: {
        model: { home: p.home, draw: p.draw, away: p.away },
        market: mr ? { home: mr.probabilities.home!, draw: mr.probabilities.draw!, away: mr.probabilities.away! } : null,
        edge_pp: mr ? { home: (p.home - mr.probabilities.home!) * 100, draw: (p.draw - mr.probabilities.draw!) * 100, away: (p.away - mr.probabilities.away!) * 100 } : null,
        displayed_side: forecastSide,
        note: mr ? `Model forecast and de-vigged market are shown side by side. The graded side is ${resultPick}${resultSide === forecastSide ? ", which matches the forecast." : `; the most likely result remains ${forecastPick}.`}` : "Three-way market comparison pending.",
      },
      soccerPriceBoard: mr ? {
        sportsbook: mr.sportsbook,
        observed_at: mr.observedAt,
        rows: (["away", "draw", "home"] as const).map((side) => ({
          side,
          label: side === "away" ? match.awayTeam.abbreviation : side === "home" ? match.homeTeam.abbreviation : "Draw",
          price_american: mr.prices[side]!,
          model_probability: p[side],
          market_probability: mr.probabilities[side]!,
          edge_pp: (p[side] - mr.probabilities[side]!) * 100,
          selected: side === resultSide,
          odds_trail: trackedPrice(`${match.id}:match_result:${side}`, mr.prices[side]!, mr.sportsbook, mr.observedAt, null, openingMoneylinePrice(match.openingOdds, side, mr.sportsbook), capturedAt),
          earliest_market_quote: earliestEplMarketQuote(`${match.id}:match_result:${side}`),
        })),
      } : null,
      soccerGradeContext: { calibration_label: mrGrade.verdict.key === "best_angle" ? "Validated value path: ≥5 pp, price > -300" : mrGrade.verdict.key === "lean" ? "Validated winner-confidence path: ≥50%, market agreement, price > -300" : "EPL production-candidate hierarchy", model_pct: p[resultSide] * 100, market_pct: mr?.probabilities[resultSide] === undefined ? null : mr.probabilities[resultSide]! * 100, edge_pp: mrEdge, grade_reason: mrGrade.reasons.join(" "), miscalibration_flag: mrGrade.candidateTier === "caution" },
    },
  });
  const dcProbabilities = {
    home_or_draw: p.home + p.draw,
    away_or_draw: p.away + p.draw,
    home_or_away: p.home + p.away,
  } as const;
  const dcSides = ["home_or_draw", "away_or_draw", "home_or_away"] as const;
  const dcSide = forecastAnchoredDoubleChanceSide(forecastSide, p);
  const dcLabel = (side: (typeof dcSides)[number]) => side === "home_or_draw"
    ? `${match.homeTeam.abbreviation} or Draw`
    : side === "away_or_draw"
      ? `${match.awayTeam.abbreviation} or Draw`
      : `${match.homeTeam.abbreviation} or ${match.awayTeam.abbreviation}`;
  const dcEdge = dc ? (dcProbabilities[dcSide] - dc.probabilities[dcSide]!) * 100 : null;
  const dcGrade = authorities.derivePreviewGrade({ market: "double_chance", modelProbability: dcProbabilities[dcSide], edgePp: dcEdge, priceAmerican: dc?.prices[dcSide] ?? null, coherentMarket: dc !== null, promotedProxy });
  const dcMarket = marketBase({
    pick: dcLabel(dcSide),
    modelProb: dcProbabilities[dcSide],
    marketProb: dc?.probabilities[dcSide] ?? null,
    price: dc?.prices[dcSide] ?? null,
    sportsbook: dc?.sportsbook ?? null,
    observedAt: dc?.observedAt ?? null,
    guide: `${dcLabel(dcSide)} protects the Match Result forecast by also covering a draw.`,
    risk: dcGrade.reasons.join(" "),
    gradeDecision: dcGrade,
    trailKey: `${match.id}:double_chance:${dcSide}`,
    capturedAt,
    gradeRelease: authorities.gradeRelease,
    keyStats: [
      { label: "Double Chance coverage", awayValue: `${match.awayTeam.abbreviation}/Draw ${Math.round(dcProbabilities.away_or_draw * 100)}%`, homeValue: `${match.homeTeam.abbreviation}/Draw ${Math.round(dcProbabilities.home_or_draw * 100)}%`, source: "computed" },
      { label: "No-draw coverage", awayValue: null, homeValue: `${Math.round(dcProbabilities.home_or_away * 100)}%`, source: "computed" },
      { label: "Draw probability", awayValue: null, homeValue: `${Math.round(p.draw * 100)}%`, source: "computed" },
      { label: "Expected goals", awayValue: publishedGoals.away.toFixed(2), homeValue: publishedGoals.home.toFixed(2), source: "computed" },
      { label: "Recent form", awayValue: formString(match.evidence.away.recentForm, match.prediction.awayStrengthSource, competitionLabel), homeValue: formString(match.evidence.home.recentForm, match.prediction.homeStrengthSource, competitionLabel), source: "feature_snapshot" },
      { label: "Recent xG created", awayValue: display(match.evidence.away.avgXgFor, 2), homeValue: display(match.evidence.home.avgXgFor, 2), source: "feature_snapshot" },
    ],
    context: {
      soccerDoubleChanceContext: {
        displayed_side: dcSide,
        home_abbr: match.homeTeam.abbreviation,
        away_abbr: match.awayTeam.abbreviation,
        model_coverage: dcProbabilities[dcSide],
        market_coverage: dc?.probabilities[dcSide] ?? null,
        edge_pp: dcEdge,
        side_explanation: `${dcLabel(dcSide)} follows the Match Result forecast; price affects the grade, not which club is covered.`,
        other_sides: dcSides.filter((side) => side !== dcSide).map((side) => ({ side, model: dcProbabilities[side], market: dc?.probabilities[side] ?? null })),
        note: "The headline covers the Match Result forecast. All three prices remain visible as market context.",
      },
      soccerPriceBoard: dc ? {
        sportsbook: dc.sportsbook,
        observed_at: dc.observedAt,
        rows: dcSides.map((side) => ({
          side,
          label: dcLabel(side),
          price_american: dc.prices[side]!,
          model_probability: dcProbabilities[side],
          market_probability: dc.probabilities[side]!,
          edge_pp: (dcProbabilities[side] - dc.probabilities[side]!) * 100,
          selected: side === dcSide,
          odds_trail: trackedPrice(`${match.id}:double_chance:${side}`, dc.prices[side]!, dc.sportsbook, dc.observedAt, null, null, capturedAt),
          earliest_market_quote: earliestEplMarketQuote(`${match.id}:double_chance:${side}`),
        })),
      } : null,
      soccerGradeContext: { calibration_label: "Tracked coverage market; EPL price thresholds not validated", model_pct: dcProbabilities[dcSide] * 100, market_pct: dc?.probabilities[dcSide] === undefined ? null : dc.probabilities[dcSide]! * 100, edge_pp: dcEdge, grade_reason: dcGrade.reasons.join(" "), miscalibration_flag: dcGrade.candidateTier === "research_only" },
    },
  });
  const totalModelProb = totalSide === "over" ? p.over25 : p.under25;
  const totalEdge = total ? (totalModelProb - total.probabilities[totalSide]!) * 100 : null;
  const meanDirection = publishedTotal >= (total?.line ?? 2.5) ? "over" : "under";
  const totalGrade = authorities.derivePreviewGrade({ market: "total", modelProbability: totalModelProb, edgePp: totalEdge, priceAmerican: total?.prices[totalSide] ?? null, coherentMarket: total !== null, promotedProxy, meanProbabilityDisagree: meanDirection !== totalSide });
  const totalMarket = marketBase({
    pick: totalSide === "over" ? "Over" : "Under",
    modelProb: totalModelProb,
    marketProb: total?.probabilities[totalSide] ?? null,
    price: total?.prices[totalSide] ?? null,
    sportsbook: total?.sportsbook ?? null,
    observedAt: total?.observedAt ?? null,
    line: total?.line ?? 2.5,
    modelTotal: publishedTotal,
    guide: `The coherent Total forecast uses eligible target-excluded books or the exact club PMF. It favors ${totalSide === "over" ? "Over" : "Under"}; projected mean ${publishedTotal.toFixed(2)}.`,
    risk: totalGrade.reasons.join(" "),
    publicSplits: totalSplits,
    gradeDecision: totalGrade,
    trailKey: `${match.id}:total:${totalSide}:${total?.line ?? 2.5}`,
    capturedAt,
    gradeRelease: authorities.gradeRelease,
    keyStats: [
      { label: "Projected total goals", awayValue: null, homeValue: publishedTotal.toFixed(2), source: "computed" },
      { label: "Goals for / against · recent", awayValue: `${display(match.evidence.away.avgGoalsFor, 2)} / ${display(match.evidence.away.avgGoalsAgainst, 2)}`, homeValue: `${display(match.evidence.home.avgGoalsFor, 2)} / ${display(match.evidence.home.avgGoalsAgainst, 2)}`, source: "feature_snapshot" },
      { label: "Avg xG created · recent sample", awayValue: display(match.evidence.away.avgXgFor, 2), homeValue: display(match.evidence.home.avgXgFor, 2), source: "feature_snapshot" },
      { label: "Avg xG allowed · recent sample", awayValue: display(match.evidence.away.avgXgAgainst, 2), homeValue: display(match.evidence.home.avgXgAgainst, 2), source: "feature_snapshot" },
      { label: "Shots / on target", awayValue: `${display(match.evidence.away.avgShots)} / ${display(match.evidence.away.avgShotsOnTarget)}`, homeValue: `${display(match.evidence.home.avgShots)} / ${display(match.evidence.home.avgShotsOnTarget)}`, source: "feature_snapshot" },
      { label: "Over / Under 2.5", awayValue: `${Math.round(p.over25 * 100)}% over`, homeValue: `${Math.round(p.under25 * 100)}% under`, source: "computed" },
      { label: "Avg possession", awayValue: display(match.evidence.away.avgPossession, 1, "%"), homeValue: display(match.evidence.home.avgPossession, 1, "%"), source: "feature_snapshot" },
      { label: "Provider stat sample", awayValue: `${match.evidence.away.statMatches}/${match.evidence.away.sampleMatches} matches · xG ${match.evidence.away.xgMatches}`, homeValue: `${match.evidence.home.statMatches}/${match.evidence.home.sampleMatches} matches · xG ${match.evidence.home.xgMatches}`, source: "feature_snapshot" },
    ],
    context: {
      soccerTotalContext: {
        projected_total: publishedTotal,
        line: total?.line ?? 2.5,
        over_p: p.over25,
        under_p: p.under25,
        edge_pp: totalEdge,
        displayed_side: totalSide,
        mean_direction_side: meanDirection,
        mean_vs_probability_disagree: meanDirection !== totalSide,
        note: "The probability, scoring mean, BTTS, and score outlook come from one target-excluded or exact club fallback PMF.",
        provider_divergence: false,
      },
      soccerPriceBoard: total ? {
        sportsbook: total.sportsbook,
        observed_at: total.observedAt,
        rows: (["over", "under"] as const).map((side) => ({
          side,
          label: `${side === "over" ? "Over" : "Under"} ${total.line}`,
          price_american: total.prices[side]!,
          model_probability: side === "over" ? p.over25 : p.under25,
          market_probability: total.probabilities[side]!,
          edge_pp: ((side === "over" ? p.over25 : p.under25) - total.probabilities[side]!) * 100,
          selected: side === totalSide,
          odds_trail: trackedPrice(`${match.id}:total:${side}:${total.line}`, total.prices[side]!, total.sportsbook, total.observedAt, total.line, null, capturedAt),
          earliest_market_quote: earliestEplMarketQuote(`${match.id}:total:${side}:${total.line}`),
        })),
      } : null,
      soccerGradeContext: { calibration_label: "Validated 55% winner-confidence Lean floor", model_pct: totalModelProb * 100, market_pct: total?.probabilities[totalSide] === undefined ? null : total.probabilities[totalSide]! * 100, edge_pp: totalEdge, grade_reason: totalGrade.reasons.join(" "), miscalibration_flag: totalGrade.candidateTier === "research_only" },
    },
  });
  const bttsModelProb = bttsSide === "yes" ? p.bttsYes : p.bttsNo;
  const bttsEdge = btts ? (bttsModelProb - btts.probabilities[bttsSide]!) * 100 : null;
  const bttsGrade = authorities.derivePreviewGrade({ market: "btts", modelProbability: bttsModelProb, edgePp: bttsEdge, priceAmerican: btts?.prices[bttsSide] ?? null, coherentMarket: btts !== null, promotedProxy });
  const bttsMarket = marketBase({
    pick: bttsSide === "yes" ? "Yes" : "No",
    modelProb: bttsModelProb,
    marketProb: btts?.probabilities[bttsSide] ?? null,
    price: btts?.prices[bttsSide] ?? null,
    sportsbook: btts?.sportsbook ?? null,
    observedAt: btts?.observedAt ?? null,
    guide: `The coherent score PMF favors BTTS ${bttsSide === "yes" ? "Yes" : "No"}. The offered BTTS price is evaluated separately and never enters the forecast.`,
    risk: bttsGrade.reasons.join(" "),
    publicSplits: bttsSplits,
    gradeDecision: bttsGrade,
    trailKey: `${match.id}:btts:${bttsSide}`,
    capturedAt,
    gradeRelease: authorities.gradeRelease,
    keyStats: [
      { label: "Expected goals by side", awayValue: publishedGoals.away.toFixed(2), homeValue: publishedGoals.home.toFixed(2), source: "computed" },
      { label: "Goals for / against · recent", awayValue: `${display(match.evidence.away.avgGoalsFor, 2)} / ${display(match.evidence.away.avgGoalsAgainst, 2)}`, homeValue: `${display(match.evidence.home.avgGoalsFor, 2)} / ${display(match.evidence.home.avgGoalsAgainst, 2)}`, source: "feature_snapshot" },
      { label: "Avg xG created", awayValue: display(match.evidence.away.avgXgFor, 2), homeValue: display(match.evidence.home.avgXgFor, 2), source: "feature_snapshot" },
      { label: "Avg xG allowed", awayValue: display(match.evidence.away.avgXgAgainst, 2), homeValue: display(match.evidence.home.avgXgAgainst, 2), source: "feature_snapshot" },
      { label: "Avg big chances", awayValue: display(match.evidence.away.avgBigChances, 1), homeValue: display(match.evidence.home.avgBigChances, 1), source: "feature_snapshot" },
      { label: "BTTS Yes / No", awayValue: `${Math.round(p.bttsYes * 100)}% yes`, homeValue: `${Math.round(p.bttsNo * 100)}% no`, source: "computed" },
      { label: "Provider stat sample", awayValue: `${match.evidence.away.statMatches}/${match.evidence.away.sampleMatches} matches · xG ${match.evidence.away.xgMatches}`, homeValue: `${match.evidence.home.statMatches}/${match.evidence.home.sampleMatches} matches · xG ${match.evidence.home.xgMatches}`, source: "feature_snapshot" },
    ],
    context: {
      soccerBttsContext: {
        yes_p: p.bttsYes,
        no_p: p.bttsNo,
        market_yes: btts?.probabilities.yes ?? null,
        edge_pp: bttsEdge,
        displayed_side: bttsSide,
        scoring_context: `${match.awayTeam.abbreviation} ${publishedGoals.away.toFixed(2)} · ${match.homeTeam.abbreviation} ${publishedGoals.home.toFixed(2)} expected goals`,
        note: "Derived from the same target-excluded or exact club fallback regulation PMF; the BTTS quote is economics only.",
      },
      soccerPriceBoard: btts ? {
        sportsbook: btts.sportsbook,
        observed_at: btts.observedAt,
        rows: (["yes", "no"] as const).map((side) => ({
          side,
          label: side === "yes" ? "Yes" : "No",
          price_american: btts.prices[side]!,
          model_probability: side === "yes" ? p.bttsYes : p.bttsNo,
          market_probability: btts.probabilities[side]!,
          edge_pp: ((side === "yes" ? p.bttsYes : p.bttsNo) - btts.probabilities[side]!) * 100,
          selected: side === bttsSide,
          odds_trail: trackedPrice(`${match.id}:btts:${side}`, btts.prices[side]!, btts.sportsbook, btts.observedAt, null, null, capturedAt),
          earliest_market_quote: earliestEplMarketQuote(`${match.id}:btts:${side}`),
        })),
      } : null,
      soccerGradeContext: { calibration_label: "Validated 55% winner-confidence Lean floor", model_pct: bttsModelProb * 100, market_pct: btts?.probabilities[bttsSide] === undefined ? null : btts.probabilities[bttsSide]! * 100, edge_pp: bttsEdge, grade_reason: bttsGrade.reasons.join(" "), miscalibration_flag: bttsGrade.candidateTier === "research_only" },
    },
  });
  const kickoff = Date.parse(match.kickoff);
  const scheduledLockAt = new Date(kickoff - 60 * 60_000).toISOString();
  const gameTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(match.kickoff));
  return {
    id: `soccer-epl-${match.id}`,
    sport: "soccer",
    external_id: match.id,
    awayTeam: match.awayTeam.abbreviation,
    awayTeamLogo: eplTeamLogo(match.awayTeam.abbreviation),
    homeTeam: match.homeTeam.abbreviation,
    homeTeamLogo: eplTeamLogo(match.homeTeam.abbreviation),
    gameTime,
    gameStartAt: match.kickoff,
    gameStartMinutes: 0,
    scheduledLockAt,
    lockState: Date.now() >= kickoff ? "locked" : Date.now() >= kickoff - 60 * 60_000 ? "locking" : "open",
    lockedAt: null,
    updatedAt: null,
    generatedAt: new Date().toISOString(),
    holdReason: "Local EPL production candidate — grades are fully computed, while publication and database writes remain disabled pending founder approval.",
    homeStarter: null,
    awayStarter: null,
    predictions: {
      ml: { pick: resultPick, confidence: p[resultSide], sharpStatus: mrMarket.sharpStatus, grade: mrMarket.grade, signalType: null, marketSignal: null },
      total: { pick: totalSide, confidence: totalModelProb, sharpStatus: totalMarket.sharpStatus, grade: totalMarket.grade, signalType: null, marketSignal: null, line: total?.line ?? 2.5 },
      nrfi: { pick: bttsSide, confidence: bttsModelProb, sharpStatus: bttsMarket.sharpStatus, grade: bttsMarket.grade, signalType: null, marketSignal: null },
    },
    markets: { moneyline: mrMarket, total: totalMarket, first_inning: bttsMarket },
    soccerDoubleChanceMarket: dcMarket,
    soccerAvailability: {
      away: { startersPosted: match.evidence.away.startersPosted, listedPlayerCount: match.evidence.away.injuryCount, injuries: match.evidence.away.injuries },
      home: { startersPosted: match.evidence.home.startersPosted, listedPlayerCount: match.evidence.home.injuryCount, injuries: match.evidence.home.injuries },
    },
    soccerModelProvenance: {
      coherentOutcomeRelease: coherentOutcome.release,
      source: coherentOutcome.source,
      evaluatedQuoteRole: "economics_and_grade_only",
      targetExcludedBooks: coherentOutcome.audit.evaluatedCanonicalBooksExcluded,
      eligibleAlternativeBooks: coherentOutcome.audit.eligibleAlternativeBooks,
      regulationTime: true,
    },
    decisionLine: `${mrGrade.verdict.label}: ${resultPick}${resultSide === forecastSide ? " is also the most likely result" : ` is the value side; ${forecastPick} remains the most likely result`}.`,
    projected: { away: publishedGoals.away, home: publishedGoals.home },
    soccerProjection: {
      matchResultOutlook: {
        expectedGoals: { away: publishedGoals.away, home: publishedGoals.home },
        likelyScore: { away: coherentOutcome.likelyScore.away, home: coherentOutcome.likelyScore.home },
        likelyScoreProbability: coherentOutcome.likelyScore.probability,
        medianTotal: coherentOutcome.medianTotal,
        mostLikelyTotal: coherentOutcome.mostLikelyTotal,
      },
      expectedGoals: { away: publishedGoals.away, home: publishedGoals.home },
      goalOutlookProbabilities: {
        home: goalOutlookProbabilities.match_result.home,
        draw: goalOutlookProbabilities.match_result.draw,
        away: goalOutlookProbabilities.match_result.away,
        over25: goalOutlookProbabilities.total.over,
        under25: goalOutlookProbabilities.total.under,
        bttsYes: goalOutlookProbabilities.btts.yes,
        bttsNo: goalOutlookProbabilities.btts.no,
      },
      likelyScore: { away: coherentOutcome.likelyScore.away, home: coherentOutcome.likelyScore.home },
      likelyScoreProbability: coherentOutcome.likelyScore.probability,
      representativeScore: representativeScore
        ? { away: representativeScore.away, home: representativeScore.home }
        : null,
      representativeScoreProbability: representativeScore?.probability ?? null,
      medianTotal: coherentOutcome.medianTotal,
      mostLikelyTotal: coherentOutcome.mostLikelyTotal,
    },
    sharpSignals: [],
    status: { lineupConfirmed: match.evidence.home.startersPosted >= 11 && match.evidence.away.startersPosted >= 11 ? true : null, linesLocked: Boolean(mr || dc || total || btts), sharpSignalPending: sharp.splitsState !== "present", marketDataLimited: !mr && !dc && !total && !btts },
    result: match.status === "final" && match.awayScore !== null && match.homeScore !== null
      ? {
          finalScore: { away: match.awayScore, home: match.homeScore },
          markets: {
            moneyline: { pickResult: null, gradeUnits: null },
            total: { pickResult: null, gradeUnits: null },
            first_inning: { pickResult: null, gradeUnits: null },
          },
        }
      : null,
    breakdown: {
      verdict: mrGrade.verdict,
      sharpRead: { key: "no_data", sentence: splitCopy },
      modelBreakdown: `Club-strength Dixon–Coles model trained only on matches available before kickoff. Release ${match.prediction.release}.`,
    },
  };
}

export async function buildEplDailyEdgePreview(slate: EplShadowSlate, options: EplPreviewBuildOptions = {}): Promise<DailyEdgeResponse> {
  const cacheKey = buildEplPreviewCacheKey(slate, options);
  const cached = previewCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    options.captureAllBookPrices?.(cached.allBookPrices);
    options.captureForwardEvidence?.(cached.forwardEvidence);
    return cached.response;
  }
  const key = process.env.SHARPAPI_KEY;
  const provider = options.marketProvider !== undefined
    ? options.marketProvider
    : key ? new SharpApiEplMarketProvider(new SharpApiClient(key)) : null;
  const markets: EplSharpFixtureMarket[] = new Array(slate.matches.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < slate.matches.length) {
      const index = nextIndex++;
      const match = slate.matches[index];
      markets[index] = provider
        ? await provider.loadFixture({ home: match.homeTeam.short_name, away: match.awayTeam.short_name, kickoff: match.kickoff }).catch(() => ({ eventId: null, odds: [], splits: [], splitsState: "error" as const }))
        : { eventId: null, odds: [], splits: [], splitsState: "error" as const };
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, slate.matches.length) }, () => worker()));
  if (provider) {
    // Sharp occasionally returns a partial duplicate-event bucket from a
    // serverless region even when an immediate independent request is
    // complete. Retry only incomplete fixtures, sequentially, and cap the
    // recovery work so an upstream outage cannot multiply paid API traffic.
    const incomplete = markets
      .map((market, index) => ({ index, complete: completeSharpMarkets(market.odds) }))
      .filter(({ complete }) => complete.size < 4)
      .slice(0, options.maxFixtureRecoveryLoads ?? MAX_FIXTURE_RECOVERY_LOADS);
    for (const { index } of incomplete) {
      const match = slate.matches[index];
      const recovery = await provider.loadFixture({ home: match.homeTeam.short_name, away: match.awayTeam.short_name, kickoff: match.kickoff })
        .catch(() => ({ eventId: null, odds: [], splits: [], splitsState: "error" as const }));
      markets[index] = mergeRecoveredFixture(markets[index], recovery);
    }
  }
  const date = slate.matches[0]?.kickoff.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const capturedAt = new Date().toISOString();
  const response: DailyEdgeResponse = {
    as_of: slate.generatedAt,
    sport: "soccer",
    date,
    requested_date: date,
    fallback_used: false,
    slateState: "today_draft_only",
    slate_status: "draft",
    last_slate_update_at: slate.generatedAt,
    games: slate.matches.map((match, index) => gameDto(match, markets[index], capturedAt, options.authorities, options.competitionLabel ?? "EPL")),
  };
  const allBookPrices = allBookPriceObservations(slate, markets, capturedAt);
  options.captureAllBookPrices?.(allBookPrices);
  let forwardEvidence: EplForwardEvidenceCapture[] = [];
  if (!options.skipForwardEvidence) {
    try {
      forwardEvidence = buildEplForwardEvidenceCaptures({
        slate,
        response,
        fixtureMarkets: markets,
        storedPriceHistory: options.storedPriceHistory ?? [],
        capturedAt,
      });
    } catch {
      // Evidence capture is observational. A serialization/provenance failure
      // must never change or suppress the coherent prediction/member response.
      forwardEvidence = [];
    }
  }
  options.captureForwardEvidence?.(forwardEvidence);
  previewCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, response, allBookPrices, forwardEvidence });
  return response;
}
