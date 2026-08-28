/**
 * Dual-source public splits — Phase 2 DISPLAY overlay (MLB), additive.
 *
 * Loads provider-separated observations and produces, per game, the resolved
 * public-split DISPLAY for moneyline + total:
 *   - Playbook preferred when fresh+complete;
 *   - SharpAPI fallback when Playbook missing/stale;
 *   - STALE-BUT-VALID: when neither is fresh, show the freshest complete
 *     observation with isStale=true so bars NEVER disappear (LKG behavior);
 *   - never blends two providers into one number.
 *
 * `overlayResolvedPublicSplits` replaces ONLY display split fields on
 * game.markets.{moneyline,total}: publicSplits plus the picked-side scalar
 * moneyPct/betsPct mirrors used by the Supporting Evidence row. It touches NO
 * grade/prediction/model field — grades are unchanged by construction.
 * FI/spread untouched (FI has no public splits).
 *
 * Gated by the caller (flag); MLB only for now.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketEdgeDto, DailyEdgeGameDto } from "../../app/lab/lib/labTypes";
import type { MarketReadV2Dto } from "../types/domain/MarketIntelligenceV2";
import type { MarketDecision, ResolvedMarketRead } from "../types/domain/RecommendationDecision";
import { STALE_AGE_MINUTES } from "./lastKnownGoodReader";
import { verifiedHundredSplitPct } from "./splitEvidenceQuality";

type Market = "moneyline" | "total";
type Side = "home" | "away" | "over" | "under";
type PublicSplit = MarketEdgeDto["publicSplits"][number];

type ObsRow = {
  provider: "playbook" | "sharpapi";
  game_id: number; market_type: string; side: string;
  public_betting_pct: number | null; public_money_pct: number | null;
  books_used: number | null; observed_at: string | null;
};

const SIDES: Record<Market, Side[]> = { moneyline: ["home", "away"], total: ["over", "under"] };

function isPct(v: number | null | undefined): v is number {
  return verifiedHundredSplitPct(v) !== null;
}
function complete(o: ObsRow | undefined): o is ObsRow {
  return Boolean(o && (isPct(o.public_betting_pct) || isPct(o.public_money_pct)));
}
function ageMin(iso: string | null, now: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now - t) / 60000 : Infinity;
}
function fresh(o: ObsRow | undefined, now: number): boolean {
  return Boolean(o && ageMin(o.observed_at, now) <= STALE_AGE_MINUTES);
}

function observationIsStale(
  observedAt: string | null | undefined,
  now: number,
  staleAfterMinutes: number = STALE_AGE_MINUTES,
): boolean {
  if (!observedAt) return false;
  return ageMin(observedAt, now) > staleAfterMinutes;
}

/** Display pick: fresh Playbook > fresh SharpAPI > freshest-complete (stale). */
function pickDisplay(playbook: ObsRow | undefined, sharpapi: ObsRow | undefined, now: number):
  { betsPct: number | null; moneyPct: number | null; booksUsed?: number | null; observedAt: string | null; isStale: boolean } | null {
  const mk = (o: ObsRow, stale: boolean) => ({
    betsPct: verifiedHundredSplitPct(o.public_betting_pct),
    moneyPct: verifiedHundredSplitPct(o.public_money_pct),
    booksUsed: o.books_used,
    observedAt: o.observed_at,
    isStale: stale,
  });
  if (complete(playbook) && fresh(playbook, now)) return mk(playbook, false);
  if (complete(sharpapi) && fresh(sharpapi, now)) return mk(sharpapi, false);
  // stale-but-valid: freshest complete observation (never blank an available bar).
  const cands = [playbook, sharpapi].filter(complete) as ObsRow[];
  if (cands.length === 0) return null;
  cands.sort((a, b) => ageMin(a.observed_at, now) - ageMin(b.observed_at, now));
  return mk(cands[0]!, true);
}

export type ResolvedDisplayByExtId = Map<number, Partial<Record<Market, Partial<Record<Side, NonNullable<ReturnType<typeof pickDisplay>>>>>>>;

/** Load + resolve the slate's public-split DISPLAY, keyed by game external_id. */
export async function loadResolvedPublicSplitsForDisplay(opts: {
  supabase: SupabaseClient; sport: string; slateDate: string; now?: Date;
}): Promise<ResolvedDisplayByExtId> {
  const { supabase, sport, slateDate, now = new Date() } = opts;
  const result: ResolvedDisplayByExtId = new Map();

  const { data: games } = await supabase.from("games").select("id, external_id").eq("sport", sport).eq("slate_date", slateDate);
  const extByGameId = new Map<number, number>();
  const ids: number[] = [];
  for (const g of games ?? []) { const ext = (g.external_id as number) ?? null; if (ext != null) { extByGameId.set(g.id as number, ext); ids.push(g.id as number); } }
  if (ids.length === 0) return result;

  const { data, error } = await supabase
    .from("public_splits_observations")
    .select("provider, game_id, market_type, side, public_betting_pct, public_money_pct, books_used, observed_at")
    .in("game_id", ids).in("market_type", ["moneyline", "total"]);
  if (error || !data) return result;

  const byKeyProvider = new Map<string, ObsRow>();
  for (const r of data as ObsRow[]) byKeyProvider.set(`${r.game_id}:${r.market_type}:${r.side}:${r.provider}`, r);

  const nowMs = now.getTime();
  for (const [gameId, ext] of extByGameId) {
    for (const market of ["moneyline", "total"] as Market[]) {
      for (const side of SIDES[market]) {
        const pick = pickDisplay(
          byKeyProvider.get(`${gameId}:${market}:${side}:playbook`),
          byKeyProvider.get(`${gameId}:${market}:${side}:sharpapi`),
          nowMs,
        );
        if (!pick) continue;
        if (!result.has(ext)) result.set(ext, {});
        const g = result.get(ext)!;
        (g[market] ??= {})[side] = pick;
      }
    }
  }
  return result;
}

function labelFor(market: Market, side: Side, homeAbbr: string, awayAbbr: string): string {
  if (market === "total") return side === "over" ? "Over" : "Under";
  return side === "home" ? homeAbbr : awayAbbr;
}

function pickedDisplaySide(
  market: Market,
  dto: MarketEdgeDto,
  homeAbbr: string,
  awayAbbr: string,
): Side | null {
  const pick = typeof dto.pick === "string" ? dto.pick.trim().toUpperCase() : "";
  if (!pick) return null;
  if (market === "total") {
    if (pick.includes("UNDER")) return "under";
    if (pick.includes("OVER")) return "over";
    return null;
  }
  if (pick === homeAbbr.toUpperCase() || pick.includes(`${homeAbbr.toUpperCase()} ML`)) return "home";
  if (pick === awayAbbr.toUpperCase() || pick.includes(`${awayAbbr.toUpperCase()} ML`)) return "away";
  return null;
}

function consensusLean(
  moneyPct: number | null,
  betsPct: number | null,
): "our_way" | "against" | "mixed" | null {
  if (moneyPct === null && betsPct === null) return null;
  const money = moneyPct === null ? null : moneyPct / 100;
  const bets = betsPct === null ? null : betsPct / 100;
  if (money !== null && bets !== null) {
    if (money >= 0.5 && bets >= 0.5) return "our_way";
    if (money < 0.5 && bets < 0.5) return "against";
    return "mixed";
  }
  return (money ?? bets ?? 0) >= 0.5 ? "our_way" : "against";
}

function priceActionForResolvedConsensus(
  read: MarketReadV2Dto,
  moneyPct: number | null,
  betsPct: number | null,
): string | null {
  // Preserve a snapshot that intentionally had no price-action summary. When
  // one exists, rebuild it from the final display consensus so qualitative
  // copy cannot disagree with the bars after the dual-provider overlay.
  if (read.sourceSummary.priceAction === null) return null;
  const lean = consensusLean(moneyPct, betsPct);
  const relative = read.movement?.directionRelativeToPick ?? "neutral";
  const score = read.score;
  if (relative === "neutral" || score === 0) {
    if (lean === "our_way") return "Consensus leans our way, but the line has not confirmed the move.";
    if (lean === "against" || lean === "mixed") return "The model edge is clear, but betting consensus is not fully aligned.";
    return "No clear market move. This pick is driven by the model edge.";
  }
  if (relative === "support") {
    if (score >= 4) return "The line has clearly moved toward our pick.";
    if (score >= 2) {
      return lean === "mixed" || lean === "against"
        ? "The line has moved toward our pick, while consensus is mixed."
        : "The line has moved toward our pick.";
    }
    if (lean === "against" || lean === "mixed") {
      return "The line is nudging toward our pick, while consensus is not fully aligned.";
    }
    return "The line is nudging slightly toward our pick.";
  }
  if (lean === "our_way") {
    if (score <= -4) return "Consensus leans our way, but the line has moved clearly against our pick.";
    if (score <= -2) return "Consensus leans our way, but the line has moved against our pick, adding risk.";
    return "Consensus leans our way, but the line has drifted slightly against our pick.";
  }
  if (score <= -4) return "The line has moved clearly against our pick.";
  if (score <= -2) return "The line has moved against our pick, adding risk.";
  return "The line has drifted slightly against our pick.";
}

function alignMarketReadToResolvedConsensus(
  read: MarketReadV2Dto | null | undefined,
  resolved: {
    moneyPct: number | null;
    betsPct: number | null;
    booksUsed?: number | null;
    observedAt: string | null;
  },
): MarketReadV2Dto | null | undefined {
  if (!read) return read;
  const moneyPct = isPct(resolved.moneyPct) ? resolved.moneyPct : null;
  const betsPct = isPct(resolved.betsPct) ? resolved.betsPct : null;
  if (moneyPct === null && betsPct === null) return read;
  const priceAction = priceActionForResolvedConsensus(read, moneyPct, betsPct);
  const summaryParts = [
    moneyPct === null ? null : `${Math.round(moneyPct)}% money`,
    betsPct === null ? null : `${Math.round(betsPct)}% bets`,
  ].filter((part): part is string => part !== null);
  const booksUsed = resolved.booksUsed === undefined
    ? read.consensus?.booksUsed ?? null
    : resolved.booksUsed;
  const books = booksUsed !== null
    ? ` across ${booksUsed} book${booksUsed === 1 ? "" : "s"}`
    : "";
  const replaceExplanation =
    priceAction !== null && read.explanation === read.sourceSummary.priceAction;
  return {
    ...read,
    evidenceAsOf: resolved.observedAt ?? read.evidenceAsOf,
    explanation: replaceExplanation ? priceAction : read.explanation,
    consensus: {
      betsPct: betsPct === null ? null : betsPct / 100,
      moneyPct: moneyPct === null ? null : moneyPct / 100,
      booksUsed,
      lineBasis: read.consensus?.lineBasis ?? "unknown",
    },
    sourceSummary: {
      ...read.sourceSummary,
      priceAction,
      playbookConsensus: `Consensus: ${summaryParts.join(" / ")}${books}.`,
    },
  };
}

/**
 * Final response-coherence pass. Some source-aware recommendation inputs and
 * the optional dual-provider display overlay are resolved after the initial
 * Market Read snapshot. The already-resolved `publicSplits` rows are the
 * display authority: mirror their picked-side values into the collapsed
 * scalars and Market Read copy.
 *
 * Do not copy `recommendationDecision.consensusSplits` back over these rows.
 * That section records the evidence used when the recommendation was built;
 * it may legitimately be older than a later display-only observation. Making
 * it authoritative here silently undoes the freshness overlay.
 *
 * This never changes a pick, model value, price, probability, edge, verdict,
 * or grade.
 */
export function alignMarketReadsToDisplayedPublicSplits(
  games: DailyEdgeGameDto[],
): DailyEdgeGameDto[] {
  for (const game of games) {
    for (const market of ["moneyline", "total"] as Market[]) {
      const dto = (game.markets as Record<string, MarketEdgeDto | undefined>)[market];
      if (!dto) continue;
      const picked = pickedDisplaySide(market, dto, game.homeTeam, game.awayTeam);
      const pickedRow = picked
        ? dto.publicSplits.find((row) => row.side === picked)
        : null;
      if (!pickedRow) continue;

      dto.moneyPct = pickedRow.moneyPct;
      dto.betsPct = pickedRow.betsPct;
      dto.moneyPctObservedAt = pickedRow.observedAt ?? null;
      dto.betsPctObservedAt = pickedRow.observedAt ?? null;
      dto.moneyPctIsStale = pickedRow.isStale ?? false;
      dto.betsPctIsStale = pickedRow.isStale ?? false;
      if (dto.marketReadV2) {
        dto.marketReadV2 = alignMarketReadToResolvedConsensus(dto.marketReadV2, {
          moneyPct: pickedRow.moneyPct,
          betsPct: pickedRow.betsPct,
          observedAt: pickedRow.observedAt ?? null,
        });
      }
    }
  }
  return games;
}

/**
 * Re-evaluate split freshness at response-read time.
 *
 * Daily Edge response snapshots are intentionally reused between writer
 * cycles. A row that was fresh when the snapshot was published can cross the
 * observation TTL before the next publish. Never preserve the old `isStale`
 * boolean in that case: recompute it from the immutable observation timestamp
 * for both the collapsed display and the canonical recommendation evidence.
 *
 * Display-only. Picks, probabilities, grades, prices, and locked decisions are
 * untouched.
 */
export function refreshDisplayedSplitFreshness(
  games: DailyEdgeGameDto[],
  now: Date = new Date(),
): DailyEdgeGameDto[] {
  const nowMs = now.getTime();
  const refreshDecision = (
    decision: MarketEdgeDto["recommendationDecision"] | null | undefined,
  ): void => {
    if (!decision) return;
    for (const section of [decision.consensusSplits, decision.sharpBookSplits]) {
      if (!section) continue;
      section.rows = section.rows.map((row) => ({
        ...row,
        isStale: observationIsStale(
          row.freshnessCheckedAt ?? row.observedAt,
          nowMs,
          row.staleAfterMinutes,
        ),
      }));
    }
  };

  for (const game of games) {
    for (const market of ["moneyline", "total"] as Market[]) {
      const dto = (game.markets as Record<string, MarketEdgeDto | undefined>)[market];
      if (!dto) continue;

      dto.publicSplits = dto.publicSplits.map((row) => ({
        ...row,
        isStale: observationIsStale(row.observedAt, nowMs),
      }));

      refreshDecision(dto.recommendationDecision);
      refreshDecision(game.recommendationDecision?.markets[market]);
    }
  }
  return games;
}

function consensusOnlyRead(decision: MarketDecision): ResolvedMarketRead {
  const pick = (decision.pick ?? "the pick").trim();
  const pickUpper = pick.toUpperCase();
  const selected = decision.consensusSplits?.rows.find((row) =>
    row.label.trim().toUpperCase() === pickUpper ||
    (pickUpper.includes("OVER") && row.side === "over") ||
    (pickUpper.includes("UNDER") && row.side === "under")
  ) ?? null;
  const money = selected?.moneyPct ?? null;
  const bets = selected?.betsPct ?? null;
  const values = [money, bets].filter((value): value is number => value !== null);
  if (values.length > 0 && values.every((value) => value >= 50)) {
    return { status: "consensus_support", label: "Consensus Support", tone: "emerald", copy: `Consensus splits support ${pick}.` };
  }
  if (values.length > 0 && values.every((value) => value < 50)) {
    return { status: "consensus_resistance", label: "Consensus Resistance", tone: "amber", copy: `Consensus splits show resistance against ${pick}.` };
  }
  return { status: "no_clear_signal", label: "No Clear Signal", tone: "gray", copy: "No clear market signal." };
}

function stripSharpSection(decision: MarketDecision | null | undefined): void {
  if (!decision?.sharpBookSplits) return;
  const previousReadCopy = decision.resolvedMarketRead.copy;
  const resolvedMarketRead = consensusOnlyRead(decision);
  decision.sharpBookSplits = null;
  decision.resolvedMarketRead = resolvedMarketRead;
  decision.sourceConflict = false;
  decision.reasonCodes = [
    ...decision.reasonCodes.filter((code) =>
      code !== "sharp_book_splits_available" &&
      code !== "source_conflict" &&
      code !== "market_resistance" &&
      !code.startsWith("market_read_")
    ),
    "sharp_book_splits_unavailable",
    `market_read_${resolvedMarketRead.status}`,
    ...(resolvedMarketRead.status === "consensus_resistance" ? ["market_resistance"] : []),
  ];
  decision.supportingEvidence = [
    ...decision.supportingEvidence.filter((line) =>
      line !== previousReadCopy && !/sharp(?:-| )book/i.test(line)
    ),
    "Sharp book splits unavailable.",
    resolvedMarketRead.copy,
  ];
  if (/sharp(?:-| )book/i.test(decision.quickRead)) decision.quickRead = resolvedMarketRead.copy;
  if (/sharp(?:-| )book/i.test(decision.renderedQuickReadCopy ?? "")) decision.renderedQuickReadCopy = null;
  if (/sharp(?:-| )book/i.test(decision.renderedSupportingEvidenceCopy ?? "")) decision.renderedSupportingEvidenceCopy = null;
}

/**
 * A provider matchup id without a game number cannot be attributed safely to
 * either half of an MLB doubleheader. Until the response carries exact
 * provider-event provenance, fail closed for duplicate team-pair cards rather
 * than displaying a potentially copied sharp-book section.
 *
 * Display/evidence correction only: picks, probabilities, prices, grades and
 * locked outcomes remain untouched.
 */
export function stripAmbiguousDoubleheaderSharpSplits(
  games: DailyEdgeGameDto[],
): DailyEdgeGameDto[] {
  const pairCounts = new Map<string, number>();
  for (const game of games) {
    const key = `${game.awayTeam.trim().toUpperCase()}@${game.homeTeam.trim().toUpperCase()}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  for (const game of games) {
    const key = `${game.awayTeam.trim().toUpperCase()}@${game.homeTeam.trim().toUpperCase()}`;
    if ((pairCounts.get(key) ?? 0) < 2) continue;
    for (const market of ["moneyline", "total"] as const) {
      stripSharpSection(game.markets[market]?.recommendationDecision);
      stripSharpSection(game.recommendationDecision?.markets[market]);
    }
    if (game.recommendationDecision) {
      const decisions = Object.values(game.recommendationDecision.markets).filter(Boolean) as MarketDecision[];
      const sharpAvailable = decisions.some((decision) => decision.sharpBookSplits !== null);
      game.recommendationDecision.sourceState.sharpBookSplitsAvailable = sharpAvailable;
      game.recommendationDecision.sourceState.sourceConflict = decisions.some((decision) => decision.sourceConflict);
      game.recommendationDecision.sourceState.staleSources = game.recommendationDecision.sourceState.staleSources
        .filter((source) => source !== "Sharp Book Splits");
      game.recommendationDecision.sourceState.missingExpectedSources = sharpAvailable
        ? game.recommendationDecision.sourceState.missingExpectedSources
        : Array.from(new Set([...game.recommendationDecision.sourceState.missingExpectedSources, "Sharp Book Splits"]));
    }
  }
  return games;
}

/**
 * Overlay resolved DISPLAY onto the DTO games' moneyline/total publicSplits.
 * Only replaces a market's split display when resolved data exists for it; else
 * leaves the existing (current-source) fields untouched. Mutates + returns games.
 */
export function overlayResolvedPublicSplits(
  games: DailyEdgeGameDto[],
  resolved: ResolvedDisplayByExtId,
): DailyEdgeGameDto[] {
  for (const game of games) {
    // The dual-provider overlay is response-time context for open cards only.
    // A locked card must continue to render the split rows persisted in its
    // recommendation snapshot; otherwise consensus can drift after T-60 even
    // though the pick, grade, and price are frozen.
    if (game.lockState === "locked") continue;
    const r = resolved.get(game.external_id);
    if (!r) continue;
    for (const market of ["moneyline", "total"] as Market[]) {
      const sides = r[market];
      if (!sides) continue;
      const dto = (game.markets as Record<string, MarketEdgeDto | undefined>)[market];
      if (!dto) continue;
      const out: PublicSplit[] = [];
      for (const side of SIDES[market]) {
        const d = sides[side];
        if (!d) continue;
        out.push({
          side, label: labelFor(market, side, game.homeTeam, game.awayTeam),
          moneyPct: d.moneyPct, betsPct: d.betsPct, observedAt: d.observedAt, isStale: d.isStale,
        });
      }
      if (out.length > 0) {
        dto.publicSplits = out;
        const picked = pickedDisplaySide(market, dto, game.homeTeam, game.awayTeam);
        const pickedRow = picked ? out.find((row) => row.side === picked) : null;
        const pickedResolved = picked ? sides[picked] : null;
        if (pickedRow) {
          dto.moneyPct = pickedRow.moneyPct;
          dto.betsPct = pickedRow.betsPct;
          dto.moneyPctObservedAt = pickedRow.observedAt ?? null;
          dto.betsPctObservedAt = pickedRow.observedAt ?? null;
          dto.moneyPctIsStale = pickedRow.isStale ?? false;
          dto.betsPctIsStale = pickedRow.isStale ?? false;
        }
        if (pickedResolved) {
          dto.marketReadV2 = alignMarketReadToResolvedConsensus(dto.marketReadV2, {
            moneyPct: pickedResolved.moneyPct,
            betsPct: pickedResolved.betsPct,
            booksUsed: pickedResolved.booksUsed ?? null,
            observedAt: pickedResolved.observedAt,
          });
        }
      }
    }
  }
  return games;
}
