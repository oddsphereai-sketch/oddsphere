/**
 * WNBA → DailyEdgeResponse adapter (Phase 2, 2026-06-23).
 *
 * Wraps the validated WNBA model (buildWnbaDailyEdgePreview — independent Elo+
 * Platt, market-assisted dynamic blend, cold-start prior, per-market confidence)
 * and shapes its output into the MLB-style DailyEdgeResponse so the SAME
 * DailyEdgeShell renders WNBA through the same components as MLB/NBA/NHL. The
 * shell's `sport === "wnba"` guards relabel the spread slot ("Sprd*") and pick
 * "points" units; team logos + color accents come from the canonical team map.
 *
 * Market slot mapping (identical to NBA):
 *     ML     → predictions.ml      / markets.moneyline
 *     Total  → predictions.total   / markets.total
 *     Spread → predictions.nrfi    / markets.first_inning   ← relabeled "Sprd*"
 *
 * Read-only. No DB writes, no cron, no lock, no tracking yet (Phase 2 pipeline
 * follows). Reachable via ?sport=wnba; NOT member-live until the UI smoke +
 * forward evidence gate clears.
 */

import type {
  DailyEdgeGameDto,
  DailyEdgePredictionDto,
  DailyEdgeResponse,
  DailyEdgeTotalPredictionDto,
  MarketEdgeDto,
} from "../../../app/lab/lib/labTypes";
import type { Grade, MarketSignal, SignalType } from "../../../lib/types/domain/Grade";
import type { Verdict } from "../verdictDerivation";
import { SHARP_READ_SENTENCES, type SharpReadKey } from "../sharpReadSelector";
import { buildWnbaDailyEdgePreview } from "./buildWnbaDailyEdgePreview";
import { wnbaLogoUrl } from "./wnbaTeams";
import { supabase } from "@/lib/db/supabase";
import { addDaysToSlate, currentSlateDate } from "@/lib/dates/slateDate";
import { loadSplitsHistoryForSlate, type SplitsHistoryHit } from "@/lib/services/lastKnownGoodReader";

/**
 * Reconstruct the PreviewGame shape from stored game_predictions (written by
 * runWnbaModel). The DB row carries the full model output in sport_specific, so
 * the route serves the EXACT applied rows — no recompute, no model duplication.
 * Loads the upcoming scheduled-game window (WNBA's bettable slate), ordered by
 * tip; returns [] when nothing is stored (caller falls back to live compute).
 */
async function loadWnbaPredictionsFromDb(date: string | null): Promise<PreviewGame[]> {
  const today = currentSlateDate("wnba");
  const end = addDaysToSlate(today, 3);
  let q = supabase
    .from("games")
    .select("id, external_id, slate_date, game_date, home_team_id, away_team_id")
    .eq("sport", "wnba").eq("status", "scheduled");
  q = date ? q.eq("slate_date", date) : q.gte("slate_date", today).lte("slate_date", end);
  const { data: games } = await q.order("game_date");
  if (!games || games.length === 0) return [];
  const ids = games.map((g) => g.id as number);
  const { data: gps } = await supabase
    .from("game_predictions")
    .select("game_id, predicted_home_score, predicted_away_score, predicted_total, sport_specific")
    .in("game_id", ids);
  const gpByGame = new Map((gps ?? []).map((r) => [r.game_id as number, r]));
  // Playbook public splits (display context only) — filled by refreshWnbaPlaybookSplits.
  const { data: signalRows } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type, side, public_betting_pct, public_money_pct, computed_at")
    .in("game_id", ids)
    .in("market_type", ["moneyline", "total", "spread"]);
  const signalsByGame = new Map<number, NonNullable<typeof signalRows>>();
  for (const r of signalRows ?? []) {
    const gid = r.game_id as number;
    if (!signalsByGame.has(gid)) signalsByGame.set(gid, []);
    signalsByGame.get(gid)!.push(r);
  }
  // Last-Known-Good: newest non-null public split per (game, market, side) from
  // sharp_signals_history, so a bar never blanks when the current row is missing
  // or was overwritten with null by a thin Playbook refresh (MLB no-blank parity).
  // Display fallback only — never feeds the WNBA model/grade (that path reads the
  // live sharp_signals rows in runWnbaModel, untouched here).
  const splitsHistByGame = new Map<number, SplitsHistoryHit[]>();
  for (const h of await loadSplitsHistoryForSlate(supabase, ids)) {
    if (!splitsHistByGame.has(h.game_id)) splitsHistByGame.set(h.game_id, []);
    splitsHistByGame.get(h.game_id)!.push(h);
  }
  const { data: lineRows } = await supabase
    .from("lines")
    .select("game_id, market_type, side, line_value, odds_american")
    .in("game_id", ids)
    .in("market_type", ["moneyline", "total", "spread"]);
  const linesByGame = new Map<number, NonNullable<typeof lineRows>>();
  for (const r of lineRows ?? []) {
    const gid = r.game_id as number;
    if (!linesByGame.has(gid)) linesByGame.set(gid, []);
    linesByGame.get(gid)!.push(r);
  }
  const { data: historyRows } = await supabase
    .from("line_history")
    .select("game_id, market_type, side, line_value, odds_american, recorded_at")
    .in("game_id", ids)
    .in("market_type", ["moneyline", "total", "spread"])
    .order("recorded_at", { ascending: true });
  const historyByGame = new Map<number, NonNullable<typeof historyRows>>();
  for (const r of historyRows ?? []) {
    const gid = r.game_id as number;
    if (!historyByGame.has(gid)) historyByGame.set(gid, []);
    historyByGame.get(gid)!.push(r);
  }
  const splitsAsOf = Date.now();
  const { data: teams } = await supabase.from("teams").select("id, abbreviation, name").eq("sport", "wnba");
  const tById = new Map((teams ?? []).map((t) => [t.id as number, t]));
  const out: PreviewGame[] = [];
  const seen = new Set<number>();
  for (const g of games) {
    const gp = gpByGame.get(g.id as number) as { sport_specific?: Record<string, unknown>; predicted_home_score?: number; predicted_away_score?: number; predicted_total?: number } | undefined;
    const ss = (gp?.sport_specific ?? {}) as Record<string, unknown>;
    const home = tById.get(g.home_team_id as number), away = tById.get(g.away_team_id as number);
    if (!gp || !home || !away || !ss.moneyline) continue;
    const extId = (g.external_id as number) ?? (g.id as number);
    if (seen.has(extId)) continue; // no duplicate games
    seen.add(extId);
    const ml = ss.moneyline as PreviewGame["moneyline"];
    out.push({
      game_id: extId,
      date: g.slate_date as string,
      start_time: (g.game_date as string) ?? (g.slate_date as string),
      home_team_id: g.home_team_id as number,
      away_team_id: g.away_team_id as number,
      home_abbr: home.abbreviation as string,
      away_abbr: away.abbreviation as string,
      home: home.name as string,
      away: away.name as string,
      projected_score: (ss.projected_score as { home: number; away: number }) ?? { home: gp.predicted_home_score ?? 0, away: gp.predicted_away_score ?? 0 },
      moneyline: ml,
      spread: (ss.spread as PreviewGame["spread"]) ?? { side: null, line: null, confidence: null, grade: null },
      total: (ss.total as PreviewGame["total"]) ?? { side: null, line: null, confidence: null, grade: null },
      model: (ss.model as PreviewGame["model"]) ?? { home_win_prob: 0.5, margin: 0, total: gp.predicted_total ?? 0 },
      market: (ss.market as PreviewGame["market"]) ?? { home_win_prob: null, spread: null, total: null, book_count: 0, dispersion: { spread: 0, total: 0 } },
      data_quality: (ss.data_quality as PreviewGame["data_quality"]) ?? { ml_books: 0, spread_books: 0, total_books: 0, flags: [] },
      publicSplits: buildWnbaPublicSplits(
        signalsByGame.get(g.id as number) ?? [],
        splitsHistByGame.get(g.id as number) ?? [],
        home.abbreviation as string,
        away.abbreviation as string,
        splitsAsOf,
      ),
      pickedPrices: buildWnbaPickedPrices(
        linesByGame.get(g.id as number) ?? [],
        historyByGame.get(g.id as number) ?? [],
        ml,
        (ss.total as PreviewGame["total"]) ?? { side: null, line: null, confidence: null, grade: null },
        (ss.spread as PreviewGame["spread"]) ?? { side: null, line: null, confidence: null, grade: null },
        home.abbreviation as string,
        away.abbreviation as string,
        home.name as string,
        away.name as string,
      ),
    });
  }
  return out;
}

type PreviewModelGrade = "Best Angle" | "Lean" | "Watchlist" | "Caution";

/** One public-split row in the DTO (Playbook bet%/money% + freshness). */
type WnbaPublicSplit = MarketEdgeDto["publicSplits"][number];

/** Stale threshold for the freshness flag: public splits older than 6h. */
const PUBLIC_SPLIT_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * Convert this game's sharp_signals public-split rows (filled from Playbook by
 * refreshWnbaPlaybookSplits) into the DTO's publicSplits shape for ML, total,
 * and spread.
 * Display-context only — never reads +EV/steam/RLM/CLV (those stay null).
 */
export function buildWnbaPublicSplits(
  rows: Array<{ market_type: string; side: string; public_betting_pct: number | null; public_money_pct: number | null; computed_at: string | null }>,
  history: SplitsHistoryHit[],
  homeAbbr: string,
  awayAbbr: string,
  asOf: number
): { ml: WnbaPublicSplit[]; total: WnbaPublicSplit[]; spread: WnbaPublicSplit[] } {
  const labelFor = (market: string, side: string): string =>
    market === "total" ? (side === "over" ? "Over" : "Under") : side === "home" ? homeAbbr : awayAbbr;
  const curByKey = new Map(rows.map((r) => [`${r.market_type}::${r.side}`, r]));
  const histByKey = new Map(history.map((h) => [`${h.market_type}::${h.side}`, h]));
  const freshest = (a: string | null, b: string | null): string | null =>
    !a ? b : !b ? a : new Date(a).getTime() >= new Date(b).getTime() ? a : b;
  const mk = (market: "moneyline" | "total" | "spread"): WnbaPublicSplit[] => {
    // Sides present in the current rows (preserve their order), then any side
    // that exists ONLY in history (so a fully-missing current cell still shows).
    const sides: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) if (r.market_type === market && !seen.has(r.side)) { seen.add(r.side); sides.push(r.side); }
    for (const h of history) if (h.market_type === market && !seen.has(h.side)) { seen.add(h.side); sides.push(h.side); }
    const out: WnbaPublicSplit[] = [];
    for (const side of sides) {
      const cur = curByKey.get(`${market}::${side}`);
      const hist = histByKey.get(`${market}::${side}`);
      // Per field: prefer the current non-null value; fall back to last-known
      // history when current is missing/null. Never blend providers — WNBA has
      // a single split source (Playbook); this only recovers its own last value.
      let betsPct = cur?.public_betting_pct ?? null;
      let betsObs = betsPct !== null ? (cur?.computed_at ?? null) : null;
      if (betsPct === null && hist?.public_betting_pct != null) {
        betsPct = hist.public_betting_pct;
        betsObs = hist.public_betting_pct_observed_at;
      }
      let moneyPct = cur?.public_money_pct ?? null;
      let moneyObs = moneyPct !== null ? (cur?.computed_at ?? null) : null;
      if (moneyPct === null && hist?.public_money_pct != null) {
        moneyPct = hist.public_money_pct;
        moneyObs = hist.public_money_pct_observed_at;
      }
      if (betsPct === null && moneyPct === null) continue; // genuinely no source, current or historical
      const observedAt = freshest(betsObs, moneyObs);
      const ageMs = observedAt ? asOf - new Date(observedAt).getTime() : 0;
      out.push({
        side: side as WnbaPublicSplit["side"],
        label: labelFor(market, side),
        moneyPct,
        betsPct,
        observedAt,
        isStale: observedAt ? ageMs > PUBLIC_SPLIT_STALE_MS : false,
      });
    }
    return out;
  };
  return { ml: mk("moneyline"), total: mk("total"), spread: mk("spread") };
}

type WnbaLineRow = {
  market_type: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  recorded_at?: string | null;
};

function medianNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function closeLine(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 0.01;
}

function lineDistance(a: number | null, b: number | null): number {
  if (a === null || b === null) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b);
}

function pickedRows(rows: WnbaLineRow[], market: string, side: string | null, line: number | null): WnbaLineRow[] {
  if (side === null) return [];
  const sideRows = rows.filter((r) =>
    r.market_type === market &&
    r.side === side &&
    typeof r.odds_american === "number"
  );
  if (line === null) return sideRows;
  const exactRows = sideRows.filter((r) => closeLine(r.line_value, line));
  if (exactRows.length > 0) return exactRows;
  const nearest = sideRows
    .filter((r) => r.line_value !== null)
    .sort((a, b) => lineDistance(a.line_value, line) - lineDistance(b.line_value, line))[0];
  return nearest ? sideRows.filter((r) => closeLine(r.line_value, nearest.line_value)) : [];
}

function pickedPrice(rows: WnbaLineRow[], market: string, side: string | null, line: number | null): number | null {
  const candidates = pickedRows(rows, market, side, line);
  return medianNumber(candidates.map((r) => r.odds_american as number));
}

function latestPickedPrice(rows: WnbaLineRow[], market: string, side: string | null, line: number | null): number | null {
  const candidates = pickedRows(rows, market, side, line).filter((r) => r.recorded_at);
  if (candidates.length === 0) return null;
  const latest = candidates.reduce((max, r) => {
    const ts = new Date(r.recorded_at as string).getTime();
    return Number.isFinite(ts) && ts > max ? ts : max;
  }, 0);
  if (latest === 0) return null;
  return medianNumber(
    candidates
      .filter((r) => new Date(r.recorded_at as string).getTime() === latest)
      .map((r) => r.odds_american as number)
  );
}

function firstObservedPrice(rows: WnbaLineRow[], market: string, side: string | null, line: number | null): number | null {
  const candidates = pickedRows(rows, market, side, line);
  return candidates.length > 0 ? (candidates[0]!.odds_american as number) : null;
}

function previousObservedPrice(rows: WnbaLineRow[], market: string, side: string | null, line: number | null, current: number | null): number | null {
  if (current === null) return null;
  const candidates = pickedRows(rows, market, side, line);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const price = candidates[i]!.odds_american as number;
    if (price !== current) return price;
  }
  return null;
}

function priceTrail(rows: WnbaLineRow[], market: string, side: string | null, line: number | null, current: number | null): WnbaPriceTrail {
  const open = firstObservedPrice(rows, market, side, line);
  const previousRaw = previousObservedPrice(rows, market, side, line, current);
  const previous = previousRaw !== null && previousRaw !== open ? previousRaw : null;
  return { current, open, previous };
}

function buildWnbaPickedPrices(
  rows: WnbaLineRow[],
  historyRows: WnbaLineRow[],
  ml: PreviewMarket & { price: number | null },
  total: PreviewMarket & { line: number | null },
  spread: PreviewMarket & { line: number | null },
  homeAbbr: string,
  awayAbbr: string,
  homeName: string,
  awayName: string,
): WnbaPickedPrices {
  const mlSide =
    ml.side === homeAbbr || ml.side === homeName ? "home" :
    ml.side === awayAbbr || ml.side === awayName ? "away" :
    null;
  const totalSide =
    total.side?.toLowerCase().startsWith("over") ? "over" :
    total.side?.toLowerCase().startsWith("under") ? "under" :
    null;
  const spreadSide =
    spread.side?.startsWith(homeAbbr) || spread.side?.startsWith(homeName) ? "home" :
    spread.side?.startsWith(awayAbbr) || spread.side?.startsWith(awayName) ? "away" :
    null;
  const pickedSpreadLine =
    spreadSide === "home" ? spread.line :
    spreadSide === "away" && spread.line !== null ? -spread.line :
    null;
  const mlCurrent = pickedPrice(rows, "moneyline", mlSide, null) ?? latestPickedPrice(historyRows, "moneyline", mlSide, null);
  const totalCurrent = pickedPrice(rows, "total", totalSide, total.line) ?? latestPickedPrice(historyRows, "total", totalSide, total.line);
  const spreadCurrent = pickedPrice(rows, "spread", spreadSide, pickedSpreadLine) ?? latestPickedPrice(historyRows, "spread", spreadSide, pickedSpreadLine);
  return {
    ml: priceTrail(historyRows, "moneyline", mlSide, null, mlCurrent),
    total: priceTrail(historyRows, "total", totalSide, total.line, totalCurrent),
    spread: priceTrail(historyRows, "spread", spreadSide, pickedSpreadLine, spreadCurrent),
  };
}

type PreviewMarket = { side: string | null; confidence: number | null; grade: PreviewModelGrade | null };
type WnbaPriceTrail = { current: number | null; open: number | null; previous: number | null };
type WnbaPickedPrices = { ml: WnbaPriceTrail; total: WnbaPriceTrail; spread: WnbaPriceTrail };
type PreviewGame = {
  game_id: number;
  date: string;
  start_time: string;
  home_team_id: number;
  away_team_id: number;
  home_abbr: string | null;
  away_abbr: string | null;
  home: string;
  away: string;
  projected_score: { home: number; away: number };
  moneyline: PreviewMarket & { price: number | null };
  spread: PreviewMarket & { line: number | null };
  total: PreviewMarket & { line: number | null };
  model: { home_win_prob: number; margin: number; total: number };
  market: { home_win_prob: number | null; spread: number | null; total: number | null; book_count: number; dispersion: { spread: number; total: number } };
  data_quality: { ml_books: number; spread_books: number; total_books: number; flags: string[] };
  /** Playbook public splits (ML, total, spread) for display; absent on live fallback. */
  publicSplits?: { ml: WnbaPublicSplit[]; total: WnbaPublicSplit[]; spread: WnbaPublicSplit[] };
  /** Current picked-side prices from `lines`; absent on live fallback. */
  pickedPrices?: WnbaPickedPrices;
};

function gradeToVerdict(g: PreviewModelGrade): Verdict {
  switch (g) {
    case "Best Angle": return "best_angle";
    case "Lean":       return "lean";
    case "Watchlist":  return "watchlist";
    case "Caution":    return "caution";
  }
}
function verdictLabel(g: PreviewModelGrade): string {
  return g; // labels already match ("Best Angle" / "Lean" / "Watchlist" / "Caution")
}
function gradeToMlbGrade(g: PreviewModelGrade): Grade {
  switch (g) {
    case "Best Angle": return "best_signal";
    case "Lean":       return "model_only";
    case "Watchlist":  return "market_watch";
    case "Caution":    return "sharp_conflict";
  }
}
function sharpStatusFromGrade(g: PreviewModelGrade): "confirm" | "mixed" | "caution" {
  if (g === "Best Angle" || g === "Lean") return "confirm";
  if (g === "Caution") return "caution";
  return "mixed";
}

/** Build a MarketEdgeDto from the WNBA model's per-market output. */
function buildMarket(opts: {
  slot: "ml" | "total" | "spread";
  pick: string | null;
  confFrac: number | null;
  grade: PreviewModelGrade | null;
  modelProbPick: number | null;
  marketFairProbPick: number | null;
  priceAmerican: number | null;
  line: number | null;
  modelTotal: number | null;
  marketTotal: number | null;
  bookCount: number;
  aligned: boolean | null;
  whyLine: string;
  publicSplits?: WnbaPublicSplit[];
  priceTrail?: WnbaPriceTrail;
}): MarketEdgeDto {
  const { slot, pick, confFrac, grade, modelProbPick, marketFairProbPick, priceAmerican, line, modelTotal, marketTotal, bookCount, aligned, whyLine } = opts;
  const held = pick === null || grade === null;
  const g: PreviewModelGrade = grade ?? "Watchlist";
  const verdict: { key: Verdict; label: string } = { key: gradeToVerdict(g), label: verdictLabel(g) };
  const marketSignal: MarketSignal = aligned === null ? "market_neutral" : aligned ? "market_confirmed" : "market_resistance";
  const signalType: SignalType = marketFairProbPick !== null ? "balanced" : "model_only";
  const confPct = confFrac !== null ? Math.round(confFrac * 100) : null;
  return {
    pick,
    confidence: confFrac,
    grade: held ? null : gradeToMlbGrade(g),
    signalType,
    marketSignal,
    sharpStatus: sharpStatusFromGrade(g),
    held,
    verdict,
    guidedGuide: held ? "Model is not picking a side here." : `Model lean: ${pick}.`,
    guidedWatchOut: whyLine,
    whyLine,
    riskLine: "Forward line tracking begins at the first observed price.",
    modelProb: modelProbPick,
    marketFairProb: marketFairProbPick,
    pinnacleEvPct: null,
    moneyPct: null,
    betsPct: null,
    publicSplits: opts.publicSplits ?? [],
    priceAmerican,
    lineOpenAmerican: opts.priceTrail?.open ?? null,
    lastMovePrevAmerican: opts.priceTrail?.previous ?? null,
    modelTotal: slot === "total" ? modelTotal : null,
    marketTotal: slot === "total" ? marketTotal : null,
    line: slot === "ml" ? null : line,
    keyStats: [],
    modelTrustPct: held ? null : confPct,
    marketImpliedPct: marketFairProbPick !== null ? marketFairProbPick * 100 : null,
    modelMarketGapPct: held || modelProbPick === null || marketFairProbPick === null ? null : (modelProbPick - marketFairProbPick) * 100,
    recommendationConfidence: held ? null : confPct,
    marketSource: bookCount > 0 ? "consensus" : null,
    marketDataQuality: bookCount >= 2 ? "two_sided_consensus" : bookCount === 1 ? "single_book" : "unavailable",
    reviewFlags: [],
    reviewActionSummary: "keep",
  };
}

function predictionDto(m: MarketEdgeDto): DailyEdgePredictionDto {
  return { pick: m.pick, confidence: m.confidence, sharpStatus: m.sharpStatus, grade: m.grade, signalType: m.signalType, marketSignal: m.marketSignal };
}

function tipDisplayEt(iso: string): string {
  // Preview surfaces an event date (YYYY-MM-DD), not a tip clock, until the
  // Phase 2 line/schedule pipeline lands. Show the slate date, not a fake time.
  return iso.length === 10 ? "tip TBD" : (() => { try { return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }); } catch { return "tip TBD"; } })();
}

function adaptGame(game: PreviewGame, asOf: string): DailyEdgeGameDto {
  const homeAbbr = game.home_abbr ?? game.home.slice(0, 3).toUpperCase();
  const awayAbbr = game.away_abbr ?? game.away.slice(0, 3).toUpperCase();

  // ── ML ──
  const mlPickIsHome = game.moneyline.side === game.home;
  const mlModelProb = mlPickIsHome ? game.model.home_win_prob : 1 - game.model.home_win_prob;
  const mlMarketFair = game.market.home_win_prob !== null ? (mlPickIsHome ? game.market.home_win_prob : 1 - game.market.home_win_prob) : null;
  const mlAligned = game.market.home_win_prob !== null ? mlPickIsHome === game.market.home_win_prob >= 0.5 : null;
  const ml = buildMarket({
    slot: "ml",
    pick: game.moneyline.side === game.home ? homeAbbr : game.moneyline.side === game.away ? awayAbbr : game.moneyline.side,
    confFrac: game.moneyline.confidence !== null ? game.moneyline.confidence / 100 : null,
    grade: game.moneyline.grade,
    modelProbPick: mlModelProb,
    marketFairProbPick: mlMarketFair,
    priceAmerican: game.pickedPrices?.ml.current ?? game.moneyline.price,
    line: null, modelTotal: null, marketTotal: null,
    bookCount: game.data_quality.ml_books,
    aligned: mlAligned,
    whyLine: `Independent model ${Math.round(mlModelProb * 100)}% vs market ${mlMarketFair !== null ? Math.round(mlMarketFair * 100) + "%" : "n/a"} on ${game.moneyline.side}.`,
    publicSplits: game.publicSplits?.ml,
    priceTrail: game.pickedPrices?.ml,
  });

  // ── Total ──
  const total = buildMarket({
    slot: "total",
    pick: game.total.side,
    confFrac: game.total.confidence !== null ? game.total.confidence / 100 : null,
    grade: game.total.grade,
    modelProbPick: game.total.confidence !== null ? game.total.confidence / 100 : null,
    marketFairProbPick: null,
    priceAmerican: game.pickedPrices?.total.current ?? null,
    line: game.total.line, modelTotal: game.model.total, marketTotal: game.total.line,
    bookCount: game.data_quality.total_books,
    aligned: null,
    whyLine: `Model projects ${game.model.total} pts vs market line ${game.total.line ?? "n/a"}.`,
    publicSplits: game.publicSplits?.total,
    priceTrail: game.pickedPrices?.total,
  });

  // ── Spread (rendered on the first_inning slot, relabeled "Sprd*") ──
  const spreadPick = game.spread.side
    ? game.spread.side.replace(game.home, homeAbbr).replace(game.away, awayAbbr)
    : null;
  const spreadPickIsHome =
    game.spread.side?.startsWith(game.home) === true ||
    game.spread.side?.startsWith(homeAbbr) === true;
  const spreadPickIsAway =
    game.spread.side?.startsWith(game.away) === true ||
    game.spread.side?.startsWith(awayAbbr) === true;
  const spreadDisplayLine =
    game.spread.line === null
      ? null
      : spreadPickIsHome
        ? game.spread.line
        : spreadPickIsAway
          ? -game.spread.line
          : game.spread.line;
  const spread = buildMarket({
    slot: "spread",
    pick: spreadPick,
    confFrac: game.spread.confidence !== null ? game.spread.confidence / 100 : null,
    grade: game.spread.grade,
    modelProbPick: game.spread.confidence !== null ? game.spread.confidence / 100 : null,
    marketFairProbPick: null,
    priceAmerican: game.pickedPrices?.spread.current ?? null,
    line: spreadDisplayLine, modelTotal: null, marketTotal: null,
    bookCount: game.data_quality.spread_books,
    aligned: null,
    whyLine: `Model margin ${game.model.margin > 0 ? "+" : ""}${game.model.margin} vs market spread ${game.market.spread ?? "n/a"}.`,
    publicSplits: game.publicSplits?.spread,
    priceTrail: game.pickedPrices?.spread,
  });

  // Top grade across the three markets drives the card verdict pill.
  const order: Record<PreviewModelGrade, number> = { "Best Angle": 3, "Lean": 2, "Watchlist": 1, "Caution": 0 };
  const grades = [game.moneyline.grade, game.total.grade, game.spread.grade].filter(Boolean) as PreviewModelGrade[];
  const topGrade = grades.sort((a, b) => order[b] - order[a])[0] ?? "Watchlist";

  const decisionLine = `${game.moneyline.side} ML (${game.moneyline.confidence ?? "—"}%) · ${game.total.side ?? "total n/a"} · ${game.spread.side ?? "spread n/a"}`;
  const modelBreakdown = `Independent Elo+Platt with market-assisted blend. ML lean ${game.moneyline.side}. Total: ${game.total.side ?? "n/a"} (proj ${game.model.total}). Spread: ${game.spread.side ?? "n/a"} (proj margin ${game.model.margin}).${game.data_quality.flags.includes("low_history_team") ? " Cold-start prior applied (low game history)." : ""}`;

  return {
    id: `wnba-${game.game_id}`,
    sport: "wnba",
    external_id: game.game_id,
    awayTeam: awayAbbr,
    awayTeamLogo: wnbaLogoUrl(awayAbbr),
    homeTeam: homeAbbr,
    homeTeamLogo: wnbaLogoUrl(homeAbbr),
    gameTime: tipDisplayEt(game.start_time),
    gameStartMinutes: 0,
    scheduledLockAt: game.start_time,
    lockState: "open",
    lockedAt: null,
    updatedAt: asOf,
    generatedAt: asOf,
    holdReason: null,
    homeStarter: null,
    awayStarter: null,
    predictions: { ml: predictionDto(ml), total: { ...predictionDto(total), line: game.total.line } as DailyEdgeTotalPredictionDto, nrfi: predictionDto(spread) },
    markets: { moneyline: ml, total, first_inning: spread },
    decisionLine,
    projected: { away: game.projected_score.away, home: game.projected_score.home },
    sharpSignals: [],
    status: {
      lineupConfirmed: null,
      linesLocked: game.data_quality.ml_books > 0,
      sharpSignalPending: false,
      marketDataLimited: game.data_quality.ml_books === 0,
    },
    result: null,
    breakdown: {
      verdict: { key: gradeToVerdict(topGrade), label: verdictLabel(topGrade) },
      sharpRead: { key: "no_data" as SharpReadKey, sentence: SHARP_READ_SENTENCES.no_data },
      modelBreakdown,
    },
  };
}

export async function buildWnbaDailyEdgeAdapted(date: string | null): Promise<DailyEdgeResponse> {
  const asOf = new Date().toISOString();
  try {
    // DB-FIRST: serve the stored game_predictions snapshots (instant; the exact
    // applied rows). These match what the cron wrote — no recompute.
    const dbGames = await loadWnbaPredictionsFromDb(date);
    if (dbGames.length > 0) {
      const games = dbGames.map((g) => adaptGame(g, asOf));
      return {
        as_of: asOf, sport: "wnba", date: date ?? dbGames[0]!.date, requested_date: date ?? dbGames[0]!.date,
        fallback_used: false, slateState: "today_published", slate_status: "published",
        last_slate_update_at: asOf, games,
      };
    }
    // DEV/FALLBACK: nothing stored → live compute (cron hasn't run / local dev).
    const raw = await buildWnbaDailyEdgePreview(date);
    const games = (raw.games as unknown as PreviewGame[]).map((g) => adaptGame(g, asOf));
    return {
      as_of: asOf, sport: "wnba", date: raw.slate_date, requested_date: date ?? raw.slate_date,
      fallback_used: true, slateState: games.length > 0 ? "today_published" : "no_data",
      slate_status: games.length > 0 ? "published" : null, last_slate_update_at: asOf, games,
    };
  } catch (e) {
    // HONEST failure state — NOT "no games". "today_pending_ingest" renders
    // "being ingested, check back shortly" rather than implying an empty slate.
    console.warn(`wnba daily-edge adapter error: ${(e as Error).message}`);
    const fallbackDate = date ?? currentSlateDate("wnba");
    return {
      as_of: asOf, sport: "wnba", date: fallbackDate,
      requested_date: fallbackDate, fallback_used: false,
      slateState: "today_pending_ingest", slate_status: null, last_slate_update_at: asOf, games: [],
    };
  }
}
