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
import { resolveWnbaMoneylineSide, wnbaLogoUrl } from "./wnbaTeams";
import { wnbaPredictionReleaseMismatches } from "@/lib/automodel/wnbaChampionRuntime";
import { supabase } from "@/lib/db/supabase";
import { computeSlateDate, currentSlateDate } from "@/lib/dates/slateDate";
import {
  marketIntelligenceV2UiEnabledForWnbaMarket,
  readMarketIntelligenceV2Config,
} from "@/lib/config/marketIntelligenceV2";
import {
  selectMarketIntelligenceSnapshotV2,
  type MarketIntelligenceSnapshotV2Row,
} from "@/lib/services/marketIntelligenceV2/snapshotSelector";
import { marketReadV2DtoFromSnapshot } from "@/lib/services/marketIntelligenceV2/dto";
import { projectionLedMarketRead, withConfirmedSharpMoney } from "@/lib/services/marketIntelligenceV2/displayCoherence";
import type { MarketReadV2Dto } from "@/lib/types/domain/MarketIntelligenceV2";
import { buildRecommendationDecision } from "@/lib/services/recommendationDecision";
import {
  applyDailyEdgeRenderedCopyFlags,
  type DailyEdgeRenderedCopyFlagOverrides,
} from "@/lib/services/dailyEdge/memberFacingCopyRenderer";

const HISTORY_PAGE_SIZE = 1000;
const ENABLE_WNBA_LIVE_PREVIEW_FALLBACK =
  process.env.WNBA_DAILY_EDGE_PREVIEW_FALLBACK === "true";
const DAILY_EDGE_MARKET_INTELLIGENCE_OVERLAY_ENABLED =
  process.env.DAILY_EDGE_MARKET_INTELLIGENCE_OVERLAY_ENABLED === "true";
const WNBA_ADAPTED_RESPONSE_CACHE_TTL_MS = Number(
  process.env.WNBA_ADAPTED_RESPONSE_CACHE_TTL_MS ?? 60 * 1000,
);
const WNBA_ADAPTED_RESPONSE_STALE_MS = Number(
  process.env.WNBA_ADAPTED_RESPONSE_STALE_MS ?? 15 * 60 * 1000,
);

type WnbaAdaptedResponseCacheEntry = {
  body: DailyEdgeResponse;
  expiresAt: number;
  staleUntil: number;
};

const wnbaAdaptedResponseCache = new Map<string, WnbaAdaptedResponseCacheEntry>();

function wnbaAdaptedCacheKey(
  requestedDate: string,
  renderedCopyFlagOverrides: DailyEdgeRenderedCopyFlagOverrides | null,
): string {
  const flags = renderedCopyFlagOverrides === null
    ? "default"
    : JSON.stringify(renderedCopyFlagOverrides);
  return `${requestedDate}::${flags}`;
}

function readWnbaAdaptedCache(key: string, mode: "fresh" | "stale"): DailyEdgeResponse | null {
  const entry = wnbaAdaptedResponseCache.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (mode === "fresh") return now < entry.expiresAt ? entry.body : null;
  return now < entry.staleUntil ? entry.body : null;
}

function writeWnbaAdaptedCache(key: string, body: DailyEdgeResponse): void {
  const now = Date.now();
  wnbaAdaptedResponseCache.set(key, {
    body,
    expiresAt: now + WNBA_ADAPTED_RESPONSE_CACHE_TTL_MS,
    staleUntil: now + WNBA_ADAPTED_RESPONSE_STALE_MS,
  });
}

/**
 * Reconstruct the PreviewGame shape from stored game_predictions (written by
 * runWnbaModel). The DB row carries the full model output in sport_specific, so
 * the route serves the EXACT applied rows — no recompute, no model duplication.
 * Loads one slate_date, ordered by tip. Finished same-day games stay visible
 * because the board is scoped by slate date, not by scheduled-only status.
 */
async function loadWnbaPredictionsFromDb(date: string): Promise<PreviewGame[]> {
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, external_id, slate_date, game_date, status, home_team_id, away_team_id")
    .eq("sport", "wnba")
    .eq("slate_date", date)
    .order("game_date");
  if (gamesError) throw new Error(gamesError.message);
  if (!games || games.length === 0) return [];
  const allIds = games.map((g) => g.id as number);
  const { data: predictionRecords } = await supabase
    .from("prediction_records")
    .select("game_id, market, pick, side, line_value, odds_american, confidence, play_grade, locked_at")
    .eq("sport", "wnba")
    .eq("slate_date", date)
    .in("game_id", allIds);
  const allRecords = (predictionRecords ?? []) as WnbaLockedRecord[];
  const recordGameIds = new Set(allRecords.map((r) => r.game_id));
  const retainedGames = games.filter((g) => {
    const status = String(g.status ?? "").toLowerCase();
    const isFinished = status === "final" || status === "completed";
    const startsOnRequestedSlate =
      !g.game_date ||
      (() => {
        try {
          return computeSlateDate("wnba", g.game_date as string) === date;
        } catch {
          return true;
        }
      })();
    if (isFinished && !startsOnRequestedSlate) return false;
    return !isFinished || recordGameIds.has(g.id as number);
  });
  const ids = retainedGames.map((g) => g.id as number);
  if (ids.length === 0) return [];
  const retainedIdSet = new Set(ids);
  const retainedRecords = allRecords.filter((r) => retainedIdSet.has(r.game_id));
  const { data: gps } = await supabase
    .from("game_predictions")
    .select("game_id, predicted_home_score, predicted_away_score, predicted_total, locked_at, sport_specific")
    .in("game_id", ids);
  const gpByGame = new Map((gps ?? []).map((r) => [r.game_id as number, r]));
  const recordsByGame = new Map<number, Map<string, WnbaLockedRecord>>();
  for (const r of retainedRecords) {
    // Only a genuinely locked record may override the current coherent model
    // payload. Unlocked records are a tracking mirror and can briefly lag the
    // game_predictions writer during a partial refresh.
    if (r.locked_at === null) continue;
    const gid = r.game_id;
    const byMarket = recordsByGame.get(gid) ?? new Map<string, WnbaLockedRecord>();
    byMarket.set(r.market, r);
    recordsByGame.set(gid, byMarket);
  }
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
  const { data: lineRows } = await supabase
    .from("lines")
    .select("game_id, market_type, side, sportsbook, line_value, odds_american")
    .in("game_id", ids)
    .in("market_type", ["moneyline", "total", "spread"]);
  const linesByGame = new Map<number, NonNullable<typeof lineRows>>();
  for (const r of lineRows ?? []) {
    const gid = r.game_id as number;
    if (!linesByGame.has(gid)) linesByGame.set(gid, []);
    linesByGame.get(gid)!.push(r);
  }
  const historyRows: Array<{
    game_id: number;
    market_type: string;
    side: string;
    line_value: number | null;
    odds_american: number | null;
    recorded_at: string | null;
  }> = [];
  for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
    const { data: page } = await supabase
      .from("line_history")
      .select("game_id, market_type, side, sportsbook, line_value, odds_american, recorded_at")
      .in("game_id", ids)
      .in("market_type", ["moneyline", "total", "spread"])
      .order("recorded_at", { ascending: true })
      .range(from, from + HISTORY_PAGE_SIZE - 1);
    historyRows.push(...((page ?? []) as typeof historyRows));
    if ((page ?? []).length < HISTORY_PAGE_SIZE) break;
  }
  const historyByGame = new Map<number, NonNullable<typeof historyRows>>();
  for (const r of historyRows) {
    const gid = r.game_id as number;
    if (!historyByGame.has(gid)) historyByGame.set(gid, []);
    historyByGame.get(gid)!.push(r);
  }
  const splitsAsOf = Date.now();
  const { data: teams } = await supabase.from("teams").select("id, abbreviation, name").eq("sport", "wnba");
  const tById = new Map((teams ?? []).map((t) => [t.id as number, t]));
  const out: PreviewGame[] = [];
  const seen = new Set<number>();
  for (const g of retainedGames) {
    const gp = gpByGame.get(g.id as number) as { sport_specific?: Record<string, unknown>; predicted_home_score?: number; predicted_away_score?: number; predicted_total?: number; locked_at?: string | null } | undefined;
    const ss = (gp?.sport_specific ?? {}) as Record<string, unknown>;
    const home = tById.get(g.home_team_id as number), away = tById.get(g.away_team_id as number);
    if (!gp || !home || !away || !ss.moneyline) continue;
    const extId = (g.external_id as number) ?? (g.id as number);
    if (seen.has(extId)) continue; // no duplicate games
    const ml = ss.moneyline as PreviewGame["moneyline"];
    const lockedRecordsForGame = recordsByGame.get(g.id as number) ?? new Map<string, WnbaLockedRecord>();
    const lockedMl = lockedRecordsForGame.get("moneyline");
    const lockedTotal = lockedRecordsForGame.get("total");
    const lockedSpread = lockedRecordsForGame.get("spread");
    const lockedAt =
      gp.locked_at ??
      Array.from(lockedRecordsForGame.values()).find((r) => r.locked_at !== null)?.locked_at ??
      null;
    // Preserve locked history, but never display an unlocked payload from an
    // older model/distribution/grade-policy release under the new runtime.
    if (lockedAt === null && wnbaPredictionReleaseMismatches(ss).length > 0) continue;
    seen.add(extId);
    const lockedMoneyline =
      lockedMl === undefined
        ? ml
        : {
            ...ml,
            side:
              lockedMl.side === "home"
                ? (home.name as string)
                : lockedMl.side === "away"
                  ? (away.name as string)
                  : ml.side,
            price: lockedMl.odds_american,
            confidence: normalizePctConfidence(lockedMl.confidence) ?? ml.confidence,
            grade: previewGradeFromPlayGrade(lockedMl.play_grade) ?? ml.grade,
          };
    const ssTotal = (ss.total as PreviewGame["total"]) ?? { side: null, line: null, confidence: null, grade: null };
    const lockedTotalMarket =
      lockedTotal === undefined
        ? ssTotal
        : {
            ...ssTotal,
            side: lockedTotal.pick,
            line: lockedTotal.line_value,
            confidence: normalizePctConfidence(lockedTotal.confidence) ?? ssTotal.confidence,
            grade: previewGradeFromPlayGrade(lockedTotal.play_grade) ?? ssTotal.grade,
          };
    const ssSpread = (ss.spread as PreviewGame["spread"]) ?? { side: null, line: null, confidence: null, grade: null };
    const lockedSpreadLine =
      lockedSpread?.line_value == null
        ? ssSpread.line
        : lockedSpread.side === "away"
          ? -lockedSpread.line_value
          : lockedSpread.line_value;
    const lockedSpreadMarket =
      lockedSpread === undefined
        ? ssSpread
        : {
            ...ssSpread,
            side: lockedSpread.pick,
            line: lockedSpreadLine,
            confidence: normalizePctConfidence(lockedSpread.confidence) ?? ssSpread.confidence,
            grade: previewGradeFromPlayGrade(lockedSpread.play_grade) ?? ssSpread.grade,
          };
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
      moneyline: lockedMoneyline,
      spread: lockedSpreadMarket,
      total: lockedTotalMarket,
      model: (ss.model as PreviewGame["model"]) ?? { home_win_prob: 0.5, margin: 0, total: gp.predicted_total ?? 0 },
      market: (ss.market as PreviewGame["market"]) ?? { home_win_prob: null, spread: null, total: null, book_count: 0, dispersion: { spread: 0, total: 0 } },
      data_quality: (ss.data_quality as PreviewGame["data_quality"]) ?? { ml_books: 0, spread_books: 0, total_books: 0, flags: [] },
      publicSplits: buildWnbaPublicSplits(
        signalsByGame.get(g.id as number) ?? [],
        linesByGame.get(g.id as number) ?? [],
        home.abbreviation as string,
        away.abbreviation as string,
        splitsAsOf,
      ),
      pickedPrices: buildWnbaPickedPrices(
        linesByGame.get(g.id as number) ?? [],
        historyByGame.get(g.id as number) ?? [],
        lockedRecordsForGame,
        ml,
        (ss.total as PreviewGame["total"]) ?? { side: null, line: null, confidence: null, grade: null },
        (ss.spread as PreviewGame["spread"]) ?? { side: null, line: null, confidence: null, grade: null },
        home.abbreviation as string,
        away.abbreviation as string,
        home.name as string,
        away.name as string,
        lockedAt,
      ),
      lockedAt,
    });
  }
  return out;
}

async function countWnbaGamesForSlate(date: string): Promise<number> {
  const { count, error } = await supabase
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("sport", "wnba")
    .eq("slate_date", date);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

type PreviewModelGrade = "Best Angle" | "Lean" | "Watchlist" | "Caution";

/** One public-split row in the DTO (Playbook bet%/money% + freshness). */
type WnbaPublicSplit = MarketEdgeDto["publicSplits"][number];
type MarketReadV2Lookup = {
  enabled: boolean;
  enabledByMarket: Record<"moneyline" | "total" | "spread", boolean>;
  responseAsOf: string;
  rows: readonly MarketIntelligenceSnapshotV2Row[];
};

/** Stale threshold for the freshness flag: public splits older than 6h. */
const PUBLIC_SPLIT_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * Convert this game's sharp_signals public-split rows (filled from Playbook by
 * refreshWnbaPlaybookSplits) into the DTO's publicSplits shape for ML, total,
 * and spread.
 * Display-context only — never reads +EV/steam/RLM/CLV (those stay null).
 */
function buildWnbaPublicSplits(
  rows: Array<{ market_type: string; side: string; public_betting_pct: number | null; public_money_pct: number | null; computed_at: string | null }>,
  lineRows: WnbaLineRow[],
  homeAbbr: string,
  awayAbbr: string,
  asOf: number
): { ml: WnbaPublicSplit[]; total: WnbaPublicSplit[]; spread: WnbaPublicSplit[] } {
  const fmtSpread = (line: number): string => `${line > 0 ? "+" : ""}${line}`;
  const spreadLineForSide = (side: string): number | null => {
    const vals = lineRows
      .filter((r) => r.market_type === "spread" && r.side === side && r.line_value !== null)
      .map((r) => r.line_value as number);
    const direct = medianNumber(vals);
    if (direct !== null) return direct;
    const opp = side === "home" ? "away" : side === "away" ? "home" : null;
    if (opp === null) return null;
    const oppVals = lineRows
      .filter((r) => r.market_type === "spread" && r.side === opp && r.line_value !== null)
      .map((r) => r.line_value as number);
    const oppLine = medianNumber(oppVals);
    return oppLine !== null ? -oppLine : null;
  };
  const labelFor = (market: string, side: string): string => {
    if (market === "total") return side === "over" ? "Over" : "Under";
    const abbr = side === "home" ? homeAbbr : awayAbbr;
    if (market === "spread") {
      const line = spreadLineForSide(side);
      if (line !== null) return `${abbr} ${fmtSpread(line)}`;
    }
    return abbr;
  };
  const mk = (market: "moneyline" | "total" | "spread"): WnbaPublicSplit[] =>
    rows
      .filter((r) => r.market_type === market && (r.public_betting_pct !== null || r.public_money_pct !== null))
      .map((r) => {
        const observedAt = r.computed_at ?? null;
        const ageMs = observedAt ? asOf - new Date(observedAt).getTime() : 0;
        return {
          side: r.side as WnbaPublicSplit["side"],
          label: labelFor(market, r.side),
          moneyPct: r.public_money_pct,
          betsPct: r.public_betting_pct,
          observedAt,
          isStale: observedAt ? ageMs > PUBLIC_SPLIT_STALE_MS : false,
        };
      });
  return { ml: mk("moneyline"), total: mk("total"), spread: mk("spread") };
}

type WnbaLineRow = {
  market_type: string;
  side: string;
  sportsbook?: string | null;
  line_value: number | null;
  odds_american: number | null;
  recorded_at?: string | null;
};

type WnbaLockedRecord = {
  game_id: number;
  market: string;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  confidence: number | null;
  play_grade: string | null;
  locked_at: string | null;
};

function normalizePctConfidence(value: number | null): number | null {
  if (value === null) return null;
  return value <= 1 ? value * 100 : value;
}

function previewGradeFromPlayGrade(value: string | null): PreviewModelGrade | null {
  switch (value) {
    case "best_angle":
      return "Best Angle";
    case "lean":
      return "Lean";
    case "watchlist":
    case "market_watch":
    case "model_only":
    case "market_aligned":
      return "Watchlist";
    case "caution":
    case "sharp_conflict":
    case "provisional":
      return "Caution";
    default:
      return null;
  }
}

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

function impliedProb(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function oppositeSide(market: string, side: string | null): string | null {
  if (side === null) return null;
  if (market === "moneyline" || market === "spread") {
    if (side === "home") return "away";
    if (side === "away") return "home";
  }
  if (market === "total") {
    if (side === "over") return "under";
    if (side === "under") return "over";
  }
  return null;
}

function oppositeLine(market: string, line: number | null): number | null {
  if (line === null) return null;
  return market === "spread" ? -line : line;
}

function pickedNoVigProb(rows: WnbaLineRow[], market: string, side: string | null, line: number | null): number | null {
  const pickOdds = pickedPrice(rows, market, side, line);
  const opp = oppositeSide(market, side);
  const oppOdds = pickedPrice(rows, market, opp, oppositeLine(market, line));
  const pickImp = impliedProb(pickOdds);
  const oppImp = impliedProb(oppOdds);
  if (pickImp === null || oppImp === null || pickImp + oppImp <= 0) return null;
  return pickImp / (pickImp + oppImp);
}

function rowsAtOrBefore(rows: WnbaLineRow[], iso: string | null): WnbaLineRow[] {
  if (iso === null) return rows;
  const cutoff = new Date(iso).getTime();
  if (!Number.isFinite(cutoff)) return rows;
  return rows.filter((r) => {
    if (!r.recorded_at) return true;
    const ts = new Date(r.recorded_at).getTime();
    return Number.isFinite(ts) && ts <= cutoff;
  });
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

const WNBA_MOVEMENT_BOOK_PRIORITY = [
  "fanduel",
  "betmgm",
  "hardrock",
  "pinnacle",
  "caesars",
  "betonline",
  "thescorebet",
];

function coherentPriceTrail(
  liveRows: WnbaLineRow[],
  historyRows: WnbaLineRow[],
  market: string,
  side: string | null,
  currentLine: number | null,
  fallbackCurrent: number | null,
): WnbaPriceTrail {
  if (side === null) return { current: fallbackCurrent, open: null, previous: null, coherent: false };
  const books = new Set(
    [...historyRows, ...liveRows]
      .filter((row) => row.market_type === market && row.side === side && row.sportsbook)
      .map((row) => row.sportsbook as string),
  );
  const rankedBooks = [...books].sort((a, b) => {
    const aRank = WNBA_MOVEMENT_BOOK_PRIORITY.indexOf(a);
    const bRank = WNBA_MOVEMENT_BOOK_PRIORITY.indexOf(b);
    return (aRank < 0 ? 999 : aRank) - (bRank < 0 ? 999 : bRank) || a.localeCompare(b);
  });

  for (const sportsbook of rankedBooks) {
    const history = historyRows
      .filter((row) => row.market_type === market && row.side === side && row.sportsbook === sportsbook && typeof row.odds_american === "number")
      .sort((a, b) => new Date(a.recorded_at ?? 0).getTime() - new Date(b.recorded_at ?? 0).getTime());
    const liveCandidates = liveRows.filter((row) =>
      row.market_type === market &&
      row.side === side &&
      row.sportsbook === sportsbook &&
      typeof row.odds_american === "number",
    );
    const currentLineCandidates = currentLine === null
      ? liveCandidates
      : liveCandidates.filter((row) => closeLine(row.line_value, currentLine));
    // line_history is loaded oldest → newest. The terminal stop must be the
    // latest observation at this same book/side/line; selecting index 0 sent a
    // completed trail back to its opener and made the UI correctly reject it.
    const live = currentLineCandidates[currentLineCandidates.length - 1] ?? null;
    if (history.length === 0 || !live) continue;

    const stops: WnbaPriceTrailStop[] = [];
    for (const row of [...history, live]) {
      const stop = {
        american: row.odds_american as number,
        line: row.line_value,
        observedAt: row.recorded_at ?? null,
      };
      const prior = stops[stops.length - 1];
      // A repeated price at a later timestamp is still a real prior
      // observation. Preserve it so the reader can distinguish "steady across
      // several checks" from "only one price was ever captured". Only discard
      // an exact duplicate row.
      if (
        prior &&
        prior.american === stop.american &&
        prior.line === stop.line &&
        prior.observedAt === stop.observedAt
      ) continue;
      stops.push(stop);
    }
    if (stops.length < 2) continue;
    const open = stops[0]!;
    const current = stops[stops.length - 1]!;
    const previous = stops.length > 2 ? stops[stops.length - 2]! : null;
    return {
      current: fallbackCurrent,
      open: open.american,
      previous: previous?.american ?? null,
      movementCurrent: current.american,
      openLine: open.line,
      previousLine: previous?.line ?? null,
      currentLine: current.line,
      sportsbook,
      coherent: true,
      stops,
    };
  }
  return { current: fallbackCurrent, open: null, previous: null, currentLine, coherent: false };
}

function currentLineValue(rows: WnbaLineRow[], market: string, side: string | null, line: number | null): number | null {
  if (side === null) return null;
  const sideRows = rows.filter((r) => r.market_type === market && r.side === side && r.line_value !== null);
  if (sideRows.length === 0) return null;
  if (line !== null) {
    const exact = sideRows.filter((r) => closeLine(r.line_value, line));
    if (exact.length > 0) return medianNumber(exact.map((r) => r.line_value as number));
  }
  return medianNumber(sideRows.map((r) => r.line_value as number));
}

function buildWnbaPickedPrices(
  rows: WnbaLineRow[],
  historyRows: WnbaLineRow[],
  lockedRecords: ReadonlyMap<string, WnbaLockedRecord>,
  ml: PreviewMarket & { price: number | null },
  total: PreviewMarket & { line: number | null },
  spread: PreviewMarket & { line: number | null },
  homeAbbr: string,
  awayAbbr: string,
  homeName: string,
  awayName: string,
  lockedAt: string | null,
): WnbaPickedPrices {
  const liveRows = lockedAt === null ? rows : rowsAtOrBefore(historyRows, lockedAt);
  const cappedHistoryRows = rowsAtOrBefore(historyRows, lockedAt);
  const lockedMl = lockedRecords.get("moneyline");
  const lockedTotal = lockedRecords.get("total");
  const lockedSpread = lockedRecords.get("spread");
  const mlSide = resolveWnbaMoneylineSide(ml.side, homeAbbr, awayAbbr);
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
  const totalLockedLine = lockedTotal?.line_value ?? total.line;
  const spreadLockedLine = lockedSpread?.line_value ?? pickedSpreadLine;
  const mlCurrent = lockedMl?.odds_american ?? pickedPrice(liveRows, "moneyline", mlSide, null) ?? latestPickedPrice(cappedHistoryRows, "moneyline", mlSide, null);
  const totalCurrent = lockedTotal?.odds_american ?? pickedPrice(liveRows, "total", totalSide, totalLockedLine) ?? latestPickedPrice(cappedHistoryRows, "total", totalSide, totalLockedLine);
  const spreadCurrent = lockedSpread?.odds_american ?? pickedPrice(liveRows, "spread", spreadSide, spreadLockedLine) ?? latestPickedPrice(cappedHistoryRows, "spread", spreadSide, spreadLockedLine);
  const totalCurrentLine = lockedTotal?.line_value ?? currentLineValue(liveRows, "total", totalSide, totalLockedLine) ?? totalLockedLine;
  const spreadCurrentLine = lockedSpread?.line_value ?? currentLineValue(liveRows, "spread", spreadSide, spreadLockedLine) ?? spreadLockedLine;
  return {
    ml: { ...coherentPriceTrail(liveRows, cappedHistoryRows, "moneyline", mlSide, null, mlCurrent), marketProb: pickedNoVigProb(liveRows, "moneyline", mlSide, null) },
    total: { ...coherentPriceTrail(liveRows, cappedHistoryRows, "total", totalSide, totalCurrentLine, totalCurrent), marketProb: pickedNoVigProb(liveRows, "total", totalSide, totalLockedLine) },
    spread: { ...coherentPriceTrail(liveRows, cappedHistoryRows, "spread", spreadSide, spreadCurrentLine, spreadCurrent), marketProb: pickedNoVigProb(liveRows, "spread", spreadSide, spreadLockedLine) },
  };
}

type PreviewMarket = { side: string | null; confidence: number | null; grade: PreviewModelGrade | null };
type WnbaPriceTrailStop = { american: number; line: number | null; observedAt: string | null };
type WnbaPriceTrail = {
  current: number | null;
  open: number | null;
  previous: number | null;
  movementCurrent?: number | null;
  openLine?: number | null;
  previousLine?: number | null;
  currentLine?: number | null;
  sportsbook?: string | null;
  coherent: boolean;
  stops?: WnbaPriceTrailStop[];
  marketProb?: number | null;
};
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
  model: {
    home_win_prob: number;
    final_home_win_prob?: number;
    margin: number;
    total: number;
    components?: {
      blended_precalibration_margin?: number;
      calibrated_spread_margin?: number;
      canonical_home_margin?: number;
      raw_projected_total?: number;
      canonical_projected_total?: number;
    };
  };
  market: { home_win_prob: number | null; spread: number | null; total: number | null; book_count: number; dispersion: { spread: number; total: number } };
  data_quality: { ml_books: number; spread_books: number; total_books: number; flags: string[] };
  /** Playbook public splits (ML, total, spread) for display; absent on live fallback. */
  publicSplits?: { ml: WnbaPublicSplit[]; total: WnbaPublicSplit[]; spread: WnbaPublicSplit[] };
  /** Current picked-side prices from `lines`; absent on live fallback. */
  pickedPrices?: WnbaPickedPrices;
  lockedAt?: string | null;
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

function pctFromConsensus(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

function alignWnbaSplitsToReadConsensus(
  splits: WnbaPublicSplit[],
  read: MarketReadV2Dto | null | undefined,
  pick: string | null,
): WnbaPublicSplit[] {
  if (!read?.consensus || pick === null) return splits;
  const moneyPct = pctFromConsensus(read.consensus.moneyPct);
  const betsPct = pctFromConsensus(read.consensus.betsPct);
  if (moneyPct === null && betsPct === null) return splits;
  const pickText = pick.toLowerCase();
  const selectedIndex = splits.findIndex((s) => {
    const label = s.label.toLowerCase();
    return label === pickText ||
      label.includes(pickText) ||
      pickText.includes(label) ||
      (pickText.startsWith("over") && s.side === "over") ||
      (pickText.startsWith("under") && s.side === "under");
  });
  if (selectedIndex < 0) return splits;
  return splits.map((row, idx) => {
    if (idx === selectedIndex) {
      return {
        ...row,
        moneyPct: moneyPct ?? row.moneyPct,
        betsPct: betsPct ?? row.betsPct,
        observedAt: read.evidenceAsOf ?? row.observedAt,
      };
    }
    return {
      ...row,
      moneyPct: moneyPct !== null ? 100 - moneyPct : row.moneyPct,
      betsPct: betsPct !== null ? 100 - betsPct : row.betsPct,
      observedAt: read.evidenceAsOf ?? row.observedAt,
    };
  });
}

function marketReadV2ForWnba(opts: {
  lookup: MarketReadV2Lookup | null;
  game: PreviewGame;
  marketType: "moneyline" | "total" | "spread";
  selectedSide: string | null;
}): MarketReadV2Dto | null {
  if (!opts.lookup?.enabled) return null;
  if (!opts.lookup.enabledByMarket[opts.marketType]) return null;
  const selectedSide = opts.selectedSide;
  if (
    selectedSide !== "home" &&
    selectedSide !== "away" &&
    selectedSide !== "over" &&
    selectedSide !== "under"
  ) {
    return null;
  }
  const canonicalEventId = String(opts.game.game_id);
  const snapshot = selectMarketIntelligenceSnapshotV2({
    rows: opts.lookup.rows,
    mode: opts.game.lockedAt
      ? { kind: "locked", recommendationLockedAt: opts.game.lockedAt }
      : { kind: "unlocked", responseAsOf: opts.lookup.responseAsOf },
    canonicalEventId,
    marketType: opts.marketType,
    selectionKey: `${canonicalEventId}:${opts.marketType}:${selectedSide}`,
  });
  return marketReadV2DtoFromSnapshot(snapshot);
}

function marketReadLabel(score: number): string {
  if (score >= 4) return "Strong Market Support";
  if (score >= 2) return "Market Support";
  if (score > 0) return "Slight Market Support";
  if (score <= -4) return "Strong Market Resistance";
  if (score <= -2) return "Market Resistance";
  if (score < 0) return "Slight Market Resistance";
  return "Projection-Led";
}

function marketReadExplanation(score: number): string {
  if (score >= 4) return "Strong Market Support · The line has clearly moved toward our pick.";
  if (score >= 2) return "Market Support · The line has moved toward our pick.";
  if (score > 0) return "Slight Market Support · The line is nudging slightly toward our pick.";
  if (score <= -4) return "Strong Market Resistance · The line has moved clearly against our pick.";
  if (score <= -2) return "Market Resistance · The line has moved against our pick, adding risk.";
  if (score < 0) return "Slight Market Resistance · The line has drifted slightly against our pick.";
  return "Projection-Led · No clear market move. This pick is driven by the model edge.";
}

function marketReadBody(score: number): string {
  if (score >= 4) return "The line has clearly moved toward our pick.";
  if (score >= 2) return "The line has moved toward our pick.";
  if (score > 0) return "The line is nudging slightly toward our pick.";
  if (score <= -4) return "The line has moved clearly against our pick.";
  if (score <= -2) return "The line has moved against our pick, adding risk.";
  if (score < 0) return "The line has drifted slightly against our pick.";
  return "No clear market move. This pick is driven by the model edge.";
}

function scoreFromDirection(direction: "support" | "resistance", strength: number): number {
  const magnitude = strength >= 0.04 ? 4 : strength >= 0.02 ? 3 : 1;
  return direction === "support" ? magnitude : -magnitude;
}

function priceTrailMovementRead(
  slot: "ml" | "total" | "spread",
  pick: string | null,
  trail: WnbaPriceTrail | undefined,
  generatedAt: string | null,
): MarketReadV2Dto | null {
  if (!trail?.coherent || pick === null) return null;
  let direction: "support" | "resistance" | null = null;
  let strength = 0;
  let firstLine: number | null = null;
  let currentLine: number | null = null;

  if (slot !== "ml") {
    // For totals/spreads, the point line is the market direction. Juice can
    // improve while the main line moves away from the pick; member-facing
    // Market Read should follow the main line and leave bettor price value to
    // the Odds Move row.
    firstLine = trail.openLine ?? null;
    currentLine = trail.currentLine ?? null;
    if (firstLine !== null && currentLine !== null && !closeLine(firstLine, currentLine)) {
      const delta = currentLine - firstLine;
      const p = pick.toLowerCase();
      if (slot === "total") {
        direction =
          p.startsWith("over")
            ? delta > 0 ? "support" : "resistance"
            : p.startsWith("under")
              ? delta < 0 ? "support" : "resistance"
              : null;
      } else {
        direction = delta < 0 ? "support" : "resistance";
      }
      strength = Math.min(0.05, Math.abs(delta) / 20);
    }
  }

  if (direction === null) {
    const firstProb = impliedProb(trail.open);
    const movementCurrent = trail.movementCurrent ?? trail.current;
    const currentProb = impliedProb(movementCurrent);
    if (firstProb !== null && currentProb !== null && trail.open !== null && movementCurrent !== null) {
      const delta = currentProb - firstProb;
      if (Math.abs(delta) >= 0.01) {
        direction = delta > 0 ? "support" : "resistance";
        strength = Math.abs(delta);
      }
    }
  }
  if (direction === null) return null;
  const score = scoreFromDirection(direction, strength);
  const generated = generatedAt ?? new Date().toISOString();
  return {
    label: marketReadLabel(score),
    score,
    tone: score > 0 ? "emerald" : "amber",
    explanation: marketReadExplanation(score),
    copyMode: "context_only_not_pick_changing",
    exactLineEvidenceStatus: "display_price_trail",
    evidenceAsOf: generatedAt,
    generatedAt: generated,
    validityStatus: "valid_directional",
    movement: {
      firstTrackedLine: firstLine,
      firstTrackedPrice: trail.open,
      currentLine,
      currentPrice: trail.movementCurrent ?? trail.current,
      directionRelativeToPick: direction,
      observedAt: generatedAt,
    },
    consensus: null,
    sourceSummary: {
      priceAction: marketReadBody(score),
      playbookConsensus: null,
      sharpApiSourceSpecific: null,
      sharpMoney: null,
    },
  };
}

function withVisiblePriceTrailMarketRead(opts: {
  existing: MarketReadV2Dto | null;
  slot: "ml" | "total" | "spread";
  pick: string | null;
  trail?: WnbaPriceTrail;
  generatedAt: string | null;
}): MarketReadV2Dto | null {
  const trailRead = priceTrailMovementRead(opts.slot, opts.pick, opts.trail, opts.generatedAt);
  if (!trailRead) {
    const projectionLed = projectionLedMarketRead(opts.existing, {
      evidenceAsOf: opts.generatedAt,
      generatedAt: opts.generatedAt ?? new Date().toISOString(),
    });
    if (!projectionLed) return null;
    return {
      ...projectionLed,
      movement: {
        firstTrackedLine: null,
        firstTrackedPrice: null,
        currentLine: opts.trail?.currentLine ?? null,
        currentPrice: opts.trail?.current ?? null,
        directionRelativeToPick: "neutral",
        observedAt: opts.generatedAt,
      },
    };
  }
  const existingDirection = opts.existing?.movement?.directionRelativeToPick ?? "neutral";
  if (!opts.existing || opts.existing.label === "Projection-Led" || existingDirection === "neutral") {
    return {
      ...trailRead,
      consensus: opts.existing?.consensus ?? null,
      sourceSummary: {
        ...trailRead.sourceSummary,
        playbookConsensus: opts.existing?.sourceSummary.playbookConsensus ?? null,
        sharpMoney: withConfirmedSharpMoney(opts.existing, trailRead.movement?.directionRelativeToPick ?? "neutral")
          ?.sourceSummary.sharpMoney ?? trailRead.sourceSummary.sharpMoney,
      },
    };
  }
  if (existingDirection !== trailRead.movement?.directionRelativeToPick) {
    return {
      ...trailRead,
      consensus: opts.existing.consensus,
      sourceSummary: {
        ...trailRead.sourceSummary,
        playbookConsensus: opts.existing.sourceSummary.playbookConsensus,
        sharpMoney: withConfirmedSharpMoney(opts.existing, trailRead.movement?.directionRelativeToPick ?? "neutral")
          ?.sourceSummary.sharpMoney ?? trailRead.sourceSummary.sharpMoney,
      },
    };
  }
  return {
    ...trailRead,
    consensus: opts.existing.consensus,
    sourceSummary: {
      ...trailRead.sourceSummary,
      playbookConsensus: opts.existing.sourceSummary.playbookConsensus,
      sharpMoney: withConfirmedSharpMoney(opts.existing, existingDirection)
        ?.sourceSummary.sharpMoney ?? trailRead.sourceSummary.sharpMoney,
    },
  };
}

function capWnbaGradeForPickedEdge(
  grade: PreviewModelGrade | null,
  modelProbPick: number | null,
  marketFairProbPick: number | null,
  aligned: boolean | null,
): PreviewModelGrade | null {
  if (grade === null || modelProbPick === null || marketFairProbPick === null) return grade;
  if (modelProbPick - marketFairProbPick >= -0.001) return grade;
  if (grade === "Caution" && aligned !== false) return "Watchlist";
  if (grade === "Best Angle" || grade === "Lean") return "Watchlist";
  return grade;
}

function wnbaPickProbabilityFromConfidence(confidence: number | null): number | null {
  if (confidence === null) return null;
  return Math.max(0, Math.min(1, confidence / 100));
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
  lockedAt?: string | null;
  marketReadV2?: MarketReadV2Dto | null;
  marketReadV2Enabled?: boolean;
}): MarketEdgeDto {
  const { slot, pick, confFrac, grade, modelProbPick, marketFairProbPick, priceAmerican, line, modelTotal, marketTotal, bookCount, aligned, whyLine } = opts;
  const effectiveGrade = capWnbaGradeForPickedEdge(grade, modelProbPick, marketFairProbPick, aligned);
  const held = pick === null || effectiveGrade === null;
  const g: PreviewModelGrade = effectiveGrade ?? "Watchlist";
  const verdict: { key: Verdict; label: string } = { key: gradeToVerdict(g), label: verdictLabel(g) };
  const marketSignal: MarketSignal = aligned === null ? "market_neutral" : aligned ? "market_confirmed" : "market_resistance";
  const signalType: SignalType = marketFairProbPick !== null ? "balanced" : "model_only";
  const confPct = confFrac !== null ? Math.round(confFrac * 100) : null;
  const modelProbPct = modelProbPick !== null ? +(modelProbPick * 100).toFixed(1) : null;
  const marketImpliedPct = marketFairProbPick !== null ? +(marketFairProbPick * 100).toFixed(1) : null;
  const modelMarketGapPct =
    modelProbPick === null || marketFairProbPick === null
      ? null
      : +((modelProbPick - marketFairProbPick) * 100).toFixed(1);
  const recommendationConfidence =
    held
      ? null
      : modelMarketGapPct !== null && modelMarketGapPct < 0
        ? Math.min(confPct ?? 0, 40)
        : confPct;
  const publicSplits = alignWnbaSplitsToReadConsensus(opts.publicSplits ?? [], opts.marketReadV2, pick);
  const pickedSplit = (() => {
    if (pick === null) return null;
    const p = pick.toLowerCase();
    return publicSplits.find((s) => {
      const label = s.label.toLowerCase();
      return (
        label === p ||
        label.includes(p) ||
        p.includes(label) ||
        (p.startsWith("over") && s.side === "over") ||
        (p.startsWith("under") && s.side === "under")
      );
    }) ?? null;
  })();
  const finalGrade = held ? null : gradeToMlbGrade(g);
  const finalRecScore = held ? null : recommendationConfidence;
  const finalVerdict = held
    ? { key: "no_play" as Verdict, label: "No Play" }
    : verdict;
  return {
    pick,
    confidence: confFrac,
    grade: finalGrade,
    signalType,
    marketSignal,
    sharpStatus: sharpStatusFromGrade(g),
    held,
    verdict: finalVerdict,
    rawGrade: finalGrade,
    rawRecScore: finalRecScore,
    capReasons: [],
    finalGrade,
    finalRecScore,
    actionabilityLabel: finalVerdict.label,
    displayReason: null,
    guidedGuide: held ? "Model is not picking a side here." : `Model lean: ${pick}.`,
    guidedWatchOut: whyLine,
    whyLine,
    riskLine: "Forward line tracking begins at the first observed price.",
    modelProb: modelProbPick,
    marketFairProb: marketFairProbPick,
    pinnacleEvPct: null,
    moneyPct: pickedSplit?.moneyPct ?? null,
    betsPct: pickedSplit?.betsPct ?? null,
    publicSplits,
    priceAmerican,
    lineOpenAmerican: opts.priceTrail?.open ?? null,
    lockedLineAmerican: opts.lockedAt ? priceAmerican : null,
    lockedLineAt: opts.lockedAt ?? null,
    lastMovePrevAmerican: opts.priceTrail?.previous ?? null,
    lastMoveLinePrev: opts.priceTrail?.previousLine ?? null,
    lastMoveLineNext: opts.priceTrail?.currentLine ?? null,
    oddsTrail: opts.priceTrail?.coherent
      ? (opts.priceTrail.stops ?? []).map((stop, index, stops) => ({
          american: stop.american,
          line: stop.line,
          observedAt: stop.observedAt,
          sportsbook: opts.priceTrail?.sportsbook ?? null,
          source: index === stops.length - 1 ? "current_line" as const : "line_history" as const,
          label: index === 0 ? "first" as const : index === stops.length - 1 ? "current" as const : "move" as const,
        }))
      : undefined,
    modelTotal: slot === "total" ? modelTotal : null,
    marketTotal: slot === "total" ? marketTotal : null,
    line: slot === "ml" ? null : line,
    keyStats: [],
    modelTrustPct: held ? null : modelProbPct ?? confPct,
    marketImpliedPct,
    modelMarketGapPct: held ? null : modelMarketGapPct,
    recommendationConfidence: finalRecScore,
    marketSource: bookCount > 0 ? "consensus" : null,
    marketDataQuality: bookCount >= 2 ? "two_sided_consensus" : bookCount === 1 ? "single_book" : "unavailable",
    marketReadV2: opts.marketReadV2 ?? null,
    marketReadV2Enabled: opts.marketReadV2Enabled === true,
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

function adaptGame(
  game: PreviewGame,
  asOf: string,
  marketReadV2Lookup: MarketReadV2Lookup | null,
  renderedCopyFlagOverrides: DailyEdgeRenderedCopyFlagOverrides | null,
): DailyEdgeGameDto {
  const homeAbbr = game.home_abbr ?? game.home.slice(0, 3).toUpperCase();
  const awayAbbr = game.away_abbr ?? game.away.slice(0, 3).toUpperCase();

  // ── ML ──
  const mlSelection = resolveWnbaMoneylineSide(
    game.moneyline.side,
    homeAbbr,
    awayAbbr,
  );
  const mlPickIsHome = mlSelection === "home";
  const mlModelProb =
    wnbaPickProbabilityFromConfidence(game.moneyline.confidence) ??
    (mlPickIsHome ? game.model.home_win_prob : 1 - game.model.home_win_prob);
  const mlMarketFair = game.market.home_win_prob !== null ? (mlPickIsHome ? game.market.home_win_prob : 1 - game.market.home_win_prob) : null;
  const mlAligned = game.market.home_win_prob !== null ? mlPickIsHome === game.market.home_win_prob >= 0.5 : null;
  const mlSelectedSide = mlSelection;
  const totalSelectedSide =
    game.total.side?.toLowerCase().startsWith("over") === true
      ? "over"
      : game.total.side?.toLowerCase().startsWith("under") === true
        ? "under"
        : null;
  const mlMarketRead = withVisiblePriceTrailMarketRead({
    existing: marketReadV2ForWnba({
      lookup: marketReadV2Lookup,
      game,
      marketType: "moneyline",
      selectedSide: mlSelectedSide,
    }),
    slot: "ml",
    pick: game.moneyline.side,
    trail: game.pickedPrices?.ml,
    generatedAt: asOf,
  });
  const ml = buildMarket({
    slot: "ml",
    pick: mlSelection === "home" ? homeAbbr : mlSelection === "away" ? awayAbbr : null,
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
    lockedAt: game.lockedAt ?? null,
    marketReadV2: mlMarketRead,
    marketReadV2Enabled: marketReadV2Lookup?.enabledByMarket.moneyline === true,
  });

  // ── Total ──
  const totalMarketRead = withVisiblePriceTrailMarketRead({
    existing: marketReadV2ForWnba({
      lookup: marketReadV2Lookup,
      game,
      marketType: "total",
      selectedSide: totalSelectedSide,
    }),
    slot: "total",
    pick: game.total.side,
    trail: game.pickedPrices?.total,
    generatedAt: asOf,
  });
  const total = buildMarket({
    slot: "total",
    pick: game.total.side,
    confFrac: game.total.confidence !== null ? game.total.confidence / 100 : null,
    grade: game.total.grade,
    modelProbPick: game.total.confidence !== null ? game.total.confidence / 100 : null,
    marketFairProbPick: game.pickedPrices?.total.marketProb ?? null,
    priceAmerican: game.pickedPrices?.total.current ?? null,
    line: game.total.line, modelTotal: game.model.total, marketTotal: game.total.line,
    bookCount: game.data_quality.total_books,
    aligned: null,
    whyLine: `Model projects ${game.model.total} pts vs market line ${game.total.line ?? "n/a"}.`,
    publicSplits: game.publicSplits?.total,
    priceTrail: game.pickedPrices?.total,
    lockedAt: game.lockedAt ?? null,
    marketReadV2: totalMarketRead,
    marketReadV2Enabled: marketReadV2Lookup?.enabledByMarket.total === true,
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
  const spreadMarketRead = withVisiblePriceTrailMarketRead({
    existing: marketReadV2ForWnba({
      lookup: marketReadV2Lookup,
      game,
      marketType: "spread",
      selectedSide: spreadPickIsHome ? "home" : spreadPickIsAway ? "away" : null,
    }),
    slot: "spread",
    pick: spreadPick,
    trail: game.pickedPrices?.spread,
    generatedAt: asOf,
  });
  const spread = buildMarket({
    slot: "spread",
    pick: spreadPick,
    confFrac: game.spread.confidence !== null ? game.spread.confidence / 100 : null,
    grade: game.spread.grade,
    modelProbPick: game.spread.confidence !== null ? game.spread.confidence / 100 : null,
    marketFairProbPick: game.pickedPrices?.spread.marketProb ?? null,
    priceAmerican: game.pickedPrices?.spread.current ?? null,
    line: spreadDisplayLine, modelTotal: null, marketTotal: null,
    bookCount: game.data_quality.spread_books,
    aligned: null,
    whyLine: `Model margin ${game.model.margin > 0 ? "+" : ""}${game.model.margin} vs market spread ${game.market.spread ?? "n/a"}.`,
    publicSplits: game.publicSplits?.spread,
    priceTrail: game.pickedPrices?.spread,
    lockedAt: game.lockedAt ?? null,
    marketReadV2: spreadMarketRead,
    marketReadV2Enabled: marketReadV2Lookup?.enabledByMarket.spread === true,
  });

  // Top grade across the three markets drives the card verdict pill.
  const order: Record<PreviewModelGrade, number> = { "Best Angle": 3, "Lean": 2, "Watchlist": 1, "Caution": 0 };
  const effectiveGrades = [ml, total, spread]
    .map((m) => (m.held ? null : m.verdict.label))
    .filter(Boolean) as PreviewModelGrade[];
  const topGrade = effectiveGrades.sort((a, b) => order[b] - order[a])[0] ?? "Watchlist";

  const decisionLine = `${game.moneyline.side} ML (${game.moneyline.confidence ?? "—"}%) · ${game.total.side ?? "total n/a"} · ${game.spread.side ?? "spread n/a"}`;
  const modelBreakdown = `Independent Elo+Platt with market-assisted blend. ML lean ${game.moneyline.side}. Total: ${game.total.side ?? "n/a"} (proj ${game.model.total}). Spread: ${game.spread.side ?? "n/a"} (proj margin ${game.model.margin}).${game.data_quality.flags.includes("low_history_team") ? " Cold-start prior applied (low game history)." : ""}`;
  const recommendationDecision = applyDailyEdgeRenderedCopyFlags(buildRecommendationDecision({
    sport: "wnba",
    slateDate: game.date,
    gameId: String(game.game_id),
    homeTeam: homeAbbr,
    awayTeam: awayAbbr,
    projectedScore: { away: game.projected_score.away, home: game.projected_score.home },
    markets: [
      {
        key: "moneyline",
        pick: ml.pick,
        selectedSide: mlSelectedSide,
        modelProbability: ml.modelProb,
        marketImplied: ml.marketImpliedPct,
        edgePp: ml.modelMarketGapPct,
        price: ml.priceAmerican,
        playGrade: ml.verdict.label,
        quickRead: ml.guidedGuide,
        riskNote: ml.riskLine,
        publicSplits: ml.publicSplits,
        marketReadV2: ml.marketReadV2 ?? null,
        marketReadV2Enabled: ml.marketReadV2Enabled === true,
        // The WNBA writer has already applied its versioned market-aware
        // grade policy. The shared presentation builder must describe that
        // authoritative grade, not silently downgrade it a second time.
        allowBestAngleMarketConflict: ml.verdict.key === "best_angle",
      },
      {
        key: "total",
        pick: total.pick,
        selectedSide: totalSelectedSide,
        modelProbability: total.modelProb,
        marketImplied: total.marketImpliedPct,
        edgePp: total.modelMarketGapPct,
        price: total.priceAmerican,
        playGrade: total.verdict.label,
        quickRead: total.guidedGuide,
        riskNote: total.riskLine,
        publicSplits: total.publicSplits,
        marketReadV2: total.marketReadV2 ?? null,
        marketReadV2Enabled: total.marketReadV2Enabled === true,
        allowBestAngleMarketConflict: total.verdict.key === "best_angle",
      },
      {
        key: "firstInning",
        pick: spread.pick,
        selectedSide: spreadPickIsHome ? "home" : spreadPickIsAway ? "away" : null,
        modelProbability: spread.modelProb,
        marketImplied: spread.marketImpliedPct,
        edgePp: spread.modelMarketGapPct,
        price: spread.priceAmerican,
        playGrade: spread.verdict.label,
        quickRead: spread.guidedGuide,
        riskNote: spread.riskLine,
        publicSplits: spread.publicSplits,
        marketReadV2: spread.marketReadV2 ?? null,
        marketReadV2Enabled: spread.marketReadV2Enabled === true,
        allowBestAngleMarketConflict: spread.verdict.key === "best_angle",
      },
    ],
  }), renderedCopyFlagOverrides);
  if (recommendationDecision.markets.moneyline?.renderedQuickReadCopy) {
    ml.guidedGuide = recommendationDecision.markets.moneyline.renderedQuickReadCopy;
  }
  if (recommendationDecision.markets.total?.renderedQuickReadCopy) {
    total.guidedGuide = recommendationDecision.markets.total.renderedQuickReadCopy;
  }
  if (recommendationDecision.markets.firstInning?.renderedQuickReadCopy) {
    spread.guidedGuide = recommendationDecision.markets.firstInning.renderedQuickReadCopy;
  }
  ml.recommendationDecision = recommendationDecision.markets.moneyline;
  total.recommendationDecision = recommendationDecision.markets.total;
  spread.recommendationDecision = recommendationDecision.markets.firstInning;

  return {
    id: `wnba-${game.game_id}`,
    sport: "wnba",
    external_id: game.game_id,
    awayTeam: awayAbbr,
    awayTeamLogo: wnbaLogoUrl(awayAbbr),
    homeTeam: homeAbbr,
    homeTeamLogo: wnbaLogoUrl(homeAbbr),
    gameTime: tipDisplayEt(game.start_time),
    gameStartAt: game.start_time,
    gameStartMinutes: 0,
    scheduledLockAt: game.start_time,
    lockState: game.lockedAt ? "locked" : "open",
    lockedAt: game.lockedAt ?? null,
    updatedAt: asOf,
    generatedAt: asOf,
    holdReason: null,
    homeStarter: null,
    awayStarter: null,
    predictions: { ml: predictionDto(ml), total: { ...predictionDto(total), line: game.total.line } as DailyEdgeTotalPredictionDto, nrfi: predictionDto(spread) },
    markets: { moneyline: ml, total, first_inning: spread },
    recommendationDecision,
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

export async function buildWnbaDailyEdgeAdapted(
  date: string | null,
  renderedCopyFlagOverrides: DailyEdgeRenderedCopyFlagOverrides | null = null,
): Promise<DailyEdgeResponse> {
  const asOf = new Date().toISOString();
  const requestedDate = date ?? currentSlateDate("wnba");
  const cacheKey = wnbaAdaptedCacheKey(requestedDate, renderedCopyFlagOverrides);
  const freshCached = readWnbaAdaptedCache(cacheKey, "fresh");
  if (freshCached !== null) return freshCached;
  try {
    // DB-FIRST: serve the stored game_predictions snapshots (instant; the exact
    // applied rows). These match what the cron wrote — no recompute.
    const dbGames = await loadWnbaPredictionsFromDb(requestedDate);
    if (dbGames.length > 0) {
      const config = readMarketIntelligenceV2Config();
      const enabledByMarket = {
        moneyline: marketIntelligenceV2UiEnabledForWnbaMarket(config, "moneyline"),
        total: marketIntelligenceV2UiEnabledForWnbaMarket(config, "total"),
        spread: marketIntelligenceV2UiEnabledForWnbaMarket(config, "spread"),
      };
      const marketReadV2Enabled =
        DAILY_EDGE_MARKET_INTELLIGENCE_OVERLAY_ENABLED &&
        Object.values(enabledByMarket).some(Boolean);
      let marketReadV2Lookup: MarketReadV2Lookup | null = marketReadV2Enabled
        ? { enabled: true, enabledByMarket, responseAsOf: asOf, rows: [] }
        : null;
      if (marketReadV2Enabled) {
        const eventIds = dbGames.map((g) => String(g.game_id));
        const { data, error } = await supabase
          .from("market_intelligence_snapshots_v2")
          .select(
            "id, canonical_event_id, canonical_market_id, selection_key, league, market_type, resolver_version, score, label, explanation, evidence_json, generated_at, evidence_as_of, event_start_time, recommendation_snapshot_id, recommendation_locked_at, selected_side, selected_line, selected_price, validity_status",
          )
          .eq("league", "wnba")
          .in("canonical_event_id", eventIds)
          .in("market_type", ["moneyline", "total", "spread"]);
        if (error) {
          console.warn(`wnba daily-edge: market_intelligence_snapshots_v2 unavailable: ${error.message}`);
        } else {
          marketReadV2Lookup = {
            enabled: true,
            enabledByMarket,
            responseAsOf: asOf,
            rows: (data ?? []) as MarketIntelligenceSnapshotV2Row[],
          };
        }
      }
      const games = dbGames.map((g) => adaptGame(g, asOf, marketReadV2Lookup, renderedCopyFlagOverrides));
      const body: DailyEdgeResponse = {
        as_of: asOf, sport: "wnba", date: requestedDate, requested_date: requestedDate,
        fallback_used: false, slateState: "today_published", slate_status: "published",
        last_slate_update_at: asOf, games,
      };
      writeWnbaAdaptedCache(cacheKey, body);
      return body;
    }
    const slateGameCount = await countWnbaGamesForSlate(requestedDate);
    if (slateGameCount === 0) {
      return {
        as_of: asOf,
        sport: "wnba",
        date: requestedDate,
        requested_date: requestedDate,
        fallback_used: false,
        slateState: "no_data",
        slate_status: null,
        last_slate_update_at: null,
        games: [],
      };
    }
    if (!ENABLE_WNBA_LIVE_PREVIEW_FALLBACK) {
      return {
        as_of: asOf,
        sport: "wnba",
        date: requestedDate,
        requested_date: requestedDate,
        fallback_used: false,
        slateState: "today_pending_ingest",
        slate_status: null,
        last_slate_update_at: null,
        games: [],
      };
    }

    // DEV/FALLBACK: nothing stored → live compute (cron hasn't run / local dev).
    // Keep fallback scoped to the requested slate so an off-day cannot display
    // the next available future WNBA slate as today's board.
    const raw = await buildWnbaDailyEdgePreview(requestedDate);
    const previewGames = (raw.games as unknown as PreviewGame[])
      .filter((g) => g.date === requestedDate);
    const games = previewGames.map((g) => adaptGame(g, asOf, null, renderedCopyFlagOverrides));
    const body: DailyEdgeResponse = {
      as_of: asOf, sport: "wnba", date: requestedDate, requested_date: requestedDate,
      fallback_used: true, slateState: games.length > 0 ? "today_published" : "no_data",
      slate_status: games.length > 0 ? "published" : null, last_slate_update_at: asOf, games,
    };
    writeWnbaAdaptedCache(cacheKey, body);
    return body;
  } catch (e) {
    // HONEST failure state — NOT "no games". "today_pending_ingest" renders
    // "being ingested, check back shortly" rather than implying an empty slate.
    console.warn(`wnba daily-edge adapter error: ${(e as Error).message}`);
    const stale = readWnbaAdaptedCache(cacheKey, "stale");
    if (stale !== null) return stale;
    return {
      as_of: asOf, sport: "wnba", date: requestedDate,
      requested_date: requestedDate, fallback_used: false,
      slateState: "today_pending_ingest", slate_status: null, last_slate_update_at: asOf, games: [],
    };
  }
}
