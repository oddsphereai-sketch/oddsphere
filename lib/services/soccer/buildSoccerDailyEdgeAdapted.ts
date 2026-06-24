/**
 * WC-4 Phase D — Soccer → DailyEdgeResponse adapter + route entry.
 *
 * Single entry point that the /api/lab/daily-edge route's soccer
 * branch calls. Reads soccer prediction_records + games + teams for
 * the slate, shapes them into the MLB-style DailyEdgeResponse so the
 * DailyEdgeShell can render WC games through the same components.
 *
 * Soccer markets are mapped into the existing DTO slots per the
 * NBA-Path-A precedent (Phase 7F):
 *
 *     soccer match_result  → predictions.ml      / markets.moneyline
 *     soccer total         → predictions.total   / markets.total
 *     soccer btts          → predictions.nrfi    / markets.first_inning  ← relabeled
 *                                                  in the shell when sport === "soccer"
 *
 * soccer double_chance is WRITTEN to prediction_records by the WC-3
 * writer (Phase C) for tracking/auditor purposes but is NOT surfaced
 * on the card in this launch slice. Adding a dedicated slot for it is
 * a follow-up.
 *
 * What we deliberately do NOT populate (no soccer equivalent in
 * existing DTO fields):
 *   - homeStarter / awayStarter  → null (no pitcher-equivalent)
 *   - keyStats[]                 → empty
 *   - sharpSignals[]             → empty (WC splits are
 *                                  empty_as_of_probe per WC-2)
 *   - publicSplits[] per market  → empty array (same reason)
 *   - logos                      → null (UI falls back to abbreviation)
 *
 * Read-only. Pure DB + transform.
 */

import { supabase } from "../../db/supabase";
import {
  loadStreamCurrentForSlate,
  loadLastMovesForSlate,
  streamKey,
  type StreamCurrent,
  type LastMove,
} from "../streamOverlay";
import { interpretMarket } from "../../streaming/marketInterpretation";
import { addDaysToSlate, SOCCER_BOARD_ROLL_HOUR } from "../../dates/slateDate";
import type {
  DailyEdgeResponse,
  DailyEdgeGameDto,
  DailyEdgePredictionDto,
  DailyEdgeTotalPredictionDto,
  MarketEdgeDto,
} from "../../../app/lab/lib/labTypes";
import type { Verdict } from "../verdictDerivation";
import type { SharpReadKey } from "../sharpReadSelector";
import { flagCdnUrl } from "./_countryFlags";
import { soccerPickLabel } from "./soccerPickLabel";

const SOCCER_MODEL_VERSION = "soccer_dixon_coles_v1";
const LOCK_WINDOW_MINUTES = 60;

/**
 * Slate-boundary "late tonight" carryover cutoff (2026-06-16).
 *
 * A WC fixture can kick off in the small hours of the NEXT ET day
 * (e.g. AUT vs JOR at 04:00 UTC = 00:00 ET), which the ET-anchored
 * slate convention assigns to slate_date = D+1 — even though a US
 * audience experiences it as part of *tonight's* (day D) slate. This
 * cutoff (minutes-from-ET-midnight) defines which D+1 fixtures are
 * surfaced on the day-D board: any kicking off before the board-roll hour
 * (SOCCER_BOARD_ROLL_HOUR = 2:00 AM ET). Aligned with the board's "today"
 * rollover so the boundary is consistent — the soccer board day runs 2 AM → 2 AM.
 * The slate_date / locking / tracking / grading of those rows is UNCHANGED
 * — they still belong to D+1 for every server-side purpose; the read
 * simply makes them VISIBLE the night they're played. MLB/NBA/NHL never
 * kick off in this window, so the carryover is soccer-specific.
 */
const CARRYOVER_ET_MINUTES_CUTOFF = SOCCER_BOARD_ROLL_HOUR * 60;

/**
 * Does `game` belong on the day-`requestedDate` soccer board?
 *
 * A wee-hours (e.g. 00:00 ET) kickoff belongs to the EVENING BEFORE — a US
 * audience experiences a midnight-ET match as the late game of the prior day,
 * not the first game of its own calendar date. So (2026-06-17, per Daniel) a
 * wee-hours game shows ONLY on the prior day's board (the carryover branch) and
 * is NOT shown on its own calendar/slate day. Non-wee-hours games show natively.
 *
 * True when either:
 *   • the game's slate_date IS the requested day AND it's NOT a wee-hours
 *     kickoff (native), OR
 *   • the game's slate_date is the NEXT day AND it IS a wee-hours kickoff (the
 *     "belongs to the evening before" carryover — see CARRYOVER_ET_MINUTES_CUTOFF).
 *
 * slate_date / locking / tracking / grading are UNCHANGED — this is display-only.
 * Pure function — exported for deterministic regression testing. `etMinutes` is
 * the minutes-from-ET-midnight of the kickoff (computed via `et()` at the call
 * site so the timezone math lives in one place).
 */
export function qualifiesForSoccerBoard(
  requestedDate: string,
  game: { slate_date: string },
  nextDate: string,
  etMinutes: number,
): boolean {
  const isWeeHours = etMinutes < CARRYOVER_ET_MINUTES_CUTOFF;
  if (game.slate_date === requestedDate && !isWeeHours) return true;
  if (game.slate_date === nextDate && isWeeHours) return true;
  return false;
}

/**
 * Competition discriminator. WC-4 launches with `sport='soccer'`
 * as the umbrella sport key; future UCL / league play will use the
 * same sport key but carry a different competition value in
 * `snapshot_json.competition`. This adapter filters prediction_records
 * to the WC competition only, so the World Cup Daily Edge tab can
 * never accidentally surface a UCL row (or vice versa).
 *
 * Future UCL launches a sibling adapter with `WC_COMPETITION_UCL`,
 * keyed off `competition='uefa_champions_league'`, exposed on its
 * own member-facing Daily Edge tab.
 */
const WC_COMPETITION_FIFA_WORLD_CUP = "fifa_world_cup";

type DbGame = {
  id: number;
  external_id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  game_date: string;
  slate_date: string;
  status: string | null;
};

type TeamRow = {
  id: number;
  abbreviation: string;
  display_name: string | null;
  /** ISO 3166-1 alpha-3 country code from BDL ("MEX", "RSA", …). */
  location: string | null;
};

type PredictionRecordSlim = {
  id: number;
  game_id: number;
  market: string;
  pick: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  confidence: number | null;
  model_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  play_grade: string | null;
  best_angle: boolean;
  no_bet: boolean;
  no_bet_reason: string | null;
  held: boolean;
  hold_reason: string | null;
  locked_at: string | null;
  snapshot_json: Record<string, unknown> | null;
};

function et(dateIso: string): { time: string; minutes: number } {
  const d = new Date(dateIso);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
  const time = fmt.format(d);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
    minute: "2-digit",
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { time, minutes: h * 60 + m };
}

function computeLocksAtIso(gameDateIso: string): string {
  const t = new Date(gameDateIso).getTime();
  return new Date(t - LOCK_WINDOW_MINUTES * 60 * 1000).toISOString();
}

/**
 * Normalize a stored `play_grade` to its canonical snake_case key.
 *
 * The soccer writer persists Title-Case-with-spaces grades
 * ("Best Angle", "Lean", "Watchlist", "Caution") via the
 * SoccerGradeVerdict enum, while earlier/other writers used snake_case.
 * Pre-stabilization `gradeToVerdict` only matched snake_case, so every
 * Title-Case row fell through to No Play. Normalizing here makes the
 * mapping robust to either representation without changing the writer.
 */
export function normalizeGradeKey(playGrade: string | null): string | null {
  if (playGrade === null) return null;
  const trimmed = playGrade.trim();
  if (trimmed === "") return null;
  // Hyphens + spaces → "_" so "Market-Aligned" → "market_aligned".
  return trimmed.toLowerCase().replace(/[\s-]+/g, "_");
}

export function gradeToVerdict(playGrade: string | null, held: boolean, noBet = false): { key: Verdict; label: string } {
  // True blockers win: a held market shows Held regardless of the
  // underlying grade. This is intentional (see WC integrity contract) and
  // is NOT the casing bug — the casing fix below only affects non-held rows.
  if (held) return { key: "no_play", label: "Held" };
  if (noBet) return { key: "no_play", label: "No Play" };
  const g = normalizeGradeKey(playGrade);
  if (g === "best_angle") return { key: "best_angle", label: "Best Angle" };
  if (g === "lean") return { key: "lean", label: "Lean" };
  if (g === "watchlist") return { key: "watchlist", label: "Watchlist" };
  // Neutral/informational: model agrees with the sharp market (no actionable
  // edge). Uses the neutral Watchlist pill styling but its own honest label —
  // NOT "Caution" (which is reserved for the model being on the wrong side).
  if (g === "market_aligned") return { key: "watchlist", label: "Market-Aligned" };
  if (g === "caution") return { key: "caution", label: "Caution" };
  return { key: "no_play", label: "No Play" };
}

function buildPredictionDto(r: PredictionRecordSlim | null): DailyEdgePredictionDto {
  if (r === null) {
    return {
      pick: null,
      confidence: null,
      sharpStatus: "caution",
      grade: null,
      signalType: null,
      marketSignal: null,
    };
  }
  return {
    pick: r.held ? null : r.pick,
    confidence: r.held || r.confidence === null ? null : r.confidence / 100,
    sharpStatus: "caution",
    grade: null,
    signalType: null,
    marketSignal: null,
  };
}

function buildTotalPredictionDto(r: PredictionRecordSlim | null): DailyEdgeTotalPredictionDto {
  return {
    ...buildPredictionDto(r),
    line: r?.line_value ?? null,
  };
}

/**
 * Opener lookup keyed by (game_id, market_type, side). Built once from
 * line_history at the top of the adapter (one batched query) and threaded
 * through buildMarketEdgeDto so each market can stamp a real
 * `lineOpenAmerican` instead of null. The earliest recorded_at row per
 * (game, market, side) wins — that's the closest approximation of the
 * opener we have when is_opener wasn't flagged at write-time.
 */
type OpenerLookup = (gameId: number, market: string, side: string | null) => number | null;

/**
 * Extract Match Result three-way probabilities (home / draw / away)
 * from the Dixon-Coles snapshot. Returns null when the snapshot is
 * missing the path or any of the three required keys, so the reader
 * hides the section instead of inventing zeros.
 *
 * Source path: `snapshot_json.model.raw_probabilities.match_result`.
 */
function extractMatchResultThreeWayProbs(
  snapshot: Record<string, unknown> | null,
): { home: number; draw: number; away: number } | null {
  if (snapshot === null) return null;
  const model = (snapshot as { model?: unknown }).model;
  if (model === null || typeof model !== "object") return null;
  const raw = (model as { raw_probabilities?: unknown }).raw_probabilities;
  if (raw === null || typeof raw !== "object") return null;
  const mr = (raw as { match_result?: unknown }).match_result;
  if (mr === null || typeof mr !== "object") return null;
  const home = (mr as { home?: unknown }).home;
  const draw = (mr as { draw?: unknown }).draw;
  const away = (mr as { away?: unknown }).away;
  if (typeof home !== "number" || typeof draw !== "number" || typeof away !== "number") return null;
  // Clamp into [0,1] defensively — snapshot might persist outside range via rounding.
  return {
    home: Math.max(0, Math.min(1, home)),
    draw: Math.max(0, Math.min(1, draw)),
    away: Math.max(0, Math.min(1, away)),
  };
}

/**
 * 2026-06-12 — WC Daily Edge full completion pass.
 *
 * Read helpers for the four soccer "Market Context" reader blocks.
 * Each helper pulls ONLY from the persisted snapshot — never invents
 * numbers, never derives a market field when the source path is
 * missing. The reader uses null to mean "show '—'" instead of zero.
 */
function getModelMatchResult(
  snapshot: Record<string, unknown> | null,
): { home: number; draw: number; away: number } | null {
  return extractMatchResultThreeWayProbs(snapshot);
}

function getModelDoubleChance(
  snapshot: Record<string, unknown> | null,
): { home_or_draw: number; away_or_draw: number; home_or_away: number } | null {
  if (snapshot === null) return null;
  const model = (snapshot as { model?: unknown }).model;
  if (model === null || typeof model !== "object") return null;
  const raw = (model as { raw_probabilities?: unknown }).raw_probabilities;
  if (raw === null || typeof raw !== "object") return null;
  const dc = (raw as { double_chance?: unknown }).double_chance;
  if (dc === null || typeof dc !== "object") return null;
  const hd = (dc as { home_or_draw?: unknown }).home_or_draw;
  const ad = (dc as { away_or_draw?: unknown }).away_or_draw;
  const ha = (dc as { home_or_away?: unknown }).home_or_away;
  if (typeof hd !== "number" || typeof ad !== "number" || typeof ha !== "number") return null;
  return { home_or_draw: hd, away_or_draw: ad, home_or_away: ha };
}

function getModelTotalAtLine(
  snapshot: Record<string, unknown> | null,
): { line: number; over: number; under: number } | null {
  if (snapshot === null) return null;
  const model = (snapshot as { model?: unknown }).model;
  if (model === null || typeof model !== "object") return null;
  const raw = (model as { raw_probabilities?: unknown }).raw_probabilities;
  if (raw === null || typeof raw !== "object") return null;
  const t = (raw as { total_at_canonical?: unknown }).total_at_canonical;
  if (t === null || typeof t !== "object") return null;
  const line = (t as { line?: unknown }).line;
  const over = (t as { over?: unknown }).over;
  const under = (t as { under?: unknown }).under;
  if (typeof line !== "number" || typeof over !== "number" || typeof under !== "number") return null;
  return { line, over, under };
}

function getModelBtts(
  snapshot: Record<string, unknown> | null,
): { yes: number; no: number } | null {
  if (snapshot === null) return null;
  const model = (snapshot as { model?: unknown }).model;
  if (model === null || typeof model !== "object") return null;
  const raw = (model as { raw_probabilities?: unknown }).raw_probabilities;
  if (raw === null || typeof raw !== "object") return null;
  const b = (raw as { btts?: unknown }).btts;
  if (b === null || typeof b !== "object") return null;
  const yes = (b as { yes?: unknown }).yes;
  const no = (b as { no?: unknown }).no;
  if (typeof yes !== "number" || typeof no !== "number") return null;
  return { yes, no };
}

function getModelLambdas(
  snapshot: Record<string, unknown> | null,
): { home: number; away: number; total: number } | null {
  if (snapshot === null) return null;
  const model = (snapshot as { model?: unknown }).model;
  if (model === null || typeof model !== "object") return null;
  const lh = (model as { lambda_home?: unknown }).lambda_home;
  const la = (model as { lambda_away?: unknown }).lambda_away;
  const et = (model as { expected_total?: unknown }).expected_total;
  if (typeof lh !== "number" || typeof la !== "number") return null;
  const total = typeof et === "number" ? et : lh + la;
  return { home: lh, away: la, total };
}

function getMarketDevigByKey(
  snapshot: Record<string, unknown> | null,
  key: string,
): number | null {
  if (snapshot === null) return null;
  const market = (snapshot as { market?: unknown }).market;
  if (market === null || typeof market !== "object") return null;
  const devig = (market as { devigged_probabilities?: unknown }).devigged_probabilities;
  if (devig === null || typeof devig !== "object") return null;
  const v = (devig as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

function getMarketEdgePpByKey(
  snapshot: Record<string, unknown> | null,
  key: string,
): number | null {
  if (snapshot === null) return null;
  const market = (snapshot as { market?: unknown }).market;
  if (market === null || typeof market !== "object") return null;
  const edge = (market as { edge_pp?: unknown }).edge_pp;
  if (edge === null || typeof edge !== "object") return null;
  const v = (edge as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

function getDisplayedSide(snapshot: Record<string, unknown> | null): string | null {
  if (snapshot === null) return null;
  const d = (snapshot as { decision?: unknown }).decision;
  if (d === null || typeof d !== "object") return null;
  const ds = (d as { displayed_side?: unknown }).displayed_side;
  return typeof ds === "string" ? ds : null;
}

function getTotalDivergenceHold(snapshot: Record<string, unknown> | null): boolean {
  if (snapshot === null) return false;
  const d = (snapshot as { decision?: unknown }).decision;
  if (d === null || typeof d !== "object") return false;
  // Pre-WC-MODEL-4 this was a hard hold (no_bet_reason). It is now a soft
  // Caution cap, recorded in decision.side_disagree_flags. Detect either
  // representation so locked-pre-fix rows still surface the divergence note.
  const flags = (d as { side_disagree_flags?: unknown }).side_disagree_flags;
  if (Array.isArray(flags) && flags.includes("total_lines_diverge")) return true;
  const reason = (d as { no_bet_reason?: unknown }).no_bet_reason;
  return typeof reason === "string" && reason.startsWith("TOTAL_LINES_DIVERGE");
}

function getTotalReconciliationSummary(snapshot: Record<string, unknown> | null): {
  reason: string | null;
  flipped: boolean;
} {
  if (snapshot === null) return { reason: null, flipped: false };
  const d = (snapshot as { decision?: unknown }).decision;
  if (d === null || typeof d !== "object") return { reason: null, flipped: false };
  const tr = (d as { total_projection_reconciliation?: unknown }).total_projection_reconciliation;
  if (tr === null || typeof tr !== "object") return { reason: null, flipped: false };
  const reason = (tr as { side_selection_reason?: unknown }).side_selection_reason;
  const mean = (tr as { mean_direction_side?: unknown }).mean_direction_side;
  const reconciled = (tr as { reconciled_total_side?: unknown }).reconciled_total_side;
  const flipped =
    typeof mean === "string" && typeof reconciled === "string" && mean === reconciled
      ? false
      : typeof mean === "string" && typeof reconciled === "string" && mean !== reconciled
        ? true
        : false;
  // mean_direction_side==reconciled_side → not flipped vs mean
  // We define "flipped" relative to whichever raw side the holistic vote
  // disagreed with; surface honestly so the reader copy can phrase it.
  return {
    reason: typeof reason === "string" ? reason : null,
    flipped,
  };
}

function roundPct(x: number, digits = 1): string {
  return (x * 100).toFixed(digits);
}

function fmtEdgePp(x: number): string {
  const v = x;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}pp`;
}

function buildSoccerMatchResultContext(
  r: PredictionRecordSlim | null,
): NonNullable<MarketEdgeDto["soccerMatchResultContext"]> | null {
  if (r === null) return null;
  const snap = r.snapshot_json ?? null;
  const model = getModelMatchResult(snap);
  if (model === null) return null;
  const market = {
    home: getMarketDevigByKey(snap, "match_result|home"),
    draw: getMarketDevigByKey(snap, "match_result|draw"),
    away: getMarketDevigByKey(snap, "match_result|away"),
  };
  const haveMarket =
    market.home !== null && market.draw !== null && market.away !== null;
  const edge = haveMarket
    ? {
        home: (model.home - (market.home as number)) * 100,
        draw: (model.draw - (market.draw as number)) * 100,
        away: (model.away - (market.away as number)) * 100,
      }
    : null;
  const displayedSide = ((): "home" | "draw" | "away" => {
    const ds = getDisplayedSide(snap);
    if (ds === "home" || ds === "draw" || ds === "away") return ds;
    const best = Math.max(model.home, model.draw, model.away);
    if (model.home === best) return "home";
    if (model.draw === best) return "draw";
    return "away";
  })();
  const note = haveMarket && edge !== null
    ? `Model ${roundPct(model[displayedSide])}% on ${displayedSide.toUpperCase()} vs. market ${roundPct(market[displayedSide] as number)}% (${fmtEdgePp(edge[displayedSide])} edge).`
    : `Model ${roundPct(model[displayedSide])}% on ${displayedSide.toUpperCase()}. Market three-way prices unavailable.`;
  return {
    model: { home: model.home, draw: model.draw, away: model.away },
    market: haveMarket ? (market as { home: number; draw: number; away: number }) : null,
    edge_pp: edge,
    displayed_side: displayedSide,
    note,
  };
}

function buildSoccerDoubleChanceContext(
  r: PredictionRecordSlim | null,
  homeAbbr: string,
  awayAbbr: string,
): NonNullable<MarketEdgeDto["soccerDoubleChanceContext"]> | null {
  if (r === null) return null;
  const snap = r.snapshot_json ?? null;
  const model = getModelDoubleChance(snap);
  if (model === null) return null;
  const ds = getDisplayedSide(snap);
  const displayedSide: "home_or_draw" | "away_or_draw" | "home_or_away" =
    ds === "home_or_draw" || ds === "away_or_draw" || ds === "home_or_away"
      ? ds
      : ((): "home_or_draw" | "away_or_draw" | "home_or_away" => {
          const entries: Array<["home_or_draw" | "away_or_draw" | "home_or_away", number]> = [
            ["home_or_draw", model.home_or_draw],
            ["away_or_draw", model.away_or_draw],
            ["home_or_away", model.home_or_away],
          ];
          entries.sort((a, b) => b[1] - a[1]);
          return entries[0][0];
        })();
  const dcKey = `double_chance|${displayedSide}`;
  const marketCoverage = getMarketDevigByKey(snap, dcKey);
  const modelCoverage = model[displayedSide];
  const edgePp = marketCoverage !== null ? (modelCoverage - marketCoverage) * 100 : null;
  const sideExplanation = ((): string => {
    if (displayedSide === "home_or_draw") return `Covers ${homeAbbr} win OR draw.`;
    if (displayedSide === "away_or_draw") return `Covers ${awayAbbr} win OR draw.`;
    return `Covers ${homeAbbr} win OR ${awayAbbr} win (no draw).`;
  })();
  const others: Array<{ side: string; model: number; market: number | null }> = [];
  for (const s of ["home_or_draw", "away_or_draw", "home_or_away"] as const) {
    if (s === displayedSide) continue;
    others.push({
      side: s,
      model: model[s],
      market: getMarketDevigByKey(snap, `double_chance|${s}`),
    });
  }
  const note = marketCoverage !== null && edgePp !== null
    ? `Model coverage ${roundPct(modelCoverage)}% vs. market ${roundPct(marketCoverage)}% (${fmtEdgePp(edgePp)} edge).`
    : `Model coverage ${roundPct(modelCoverage)}%. Market double-chance pricing unavailable.`;
  return {
    displayed_side: displayedSide,
    home_abbr: homeAbbr,
    away_abbr: awayAbbr,
    model_coverage: modelCoverage,
    market_coverage: marketCoverage,
    edge_pp: edgePp,
    side_explanation: sideExplanation,
    other_sides: others,
    note,
  };
}

function buildSoccerTotalContext(
  r: PredictionRecordSlim | null,
): NonNullable<MarketEdgeDto["soccerTotalContext"]> | null {
  if (r === null) return null;
  const snap = r.snapshot_json ?? null;
  const lambdas = getModelLambdas(snap);
  const t = getModelTotalAtLine(snap);
  if (lambdas === null || t === null) return null;
  const ds = getDisplayedSide(snap);
  const displayedSide: "over" | "under" =
    ds === "over" || ds === "under" ? ds : t.over >= t.under ? "over" : "under";
  const edgeKey = `total|${displayedSide}|${t.line}`;
  const edgePp = getMarketEdgePpByKey(snap, edgeKey);
  const divergence = getTotalDivergenceHold(snap);
  const projection = lambdas.total;
  // Mean direction = side implied by expected goals vs the line. For
  // soccer this can legitimately disagree with the probability/value side
  // the model displays: a low-λ score distribution can put more mass on
  // Under even when E[goals] sits slightly above the line (0-0/1-0/1-1/2-0
  // carry real weight). We surface BOTH and explain the disagreement
  // rather than showing a bare "Projected 2.6 / Under 2.5" contradiction.
  const meanSide: "over" | "under" = projection > t.line ? "over" : "under";
  const meanVsProbDisagree = meanSide !== displayedSide;
  const note = ((): string => {
    const base = `Projected ${projection.toFixed(2)} goals vs. line ${t.line.toFixed(2)}.`;
    const dispPct = Math.round((displayedSide === "over" ? t.over : t.under) * 100);
    // Provider divergence is now a soft Caution cap (not a hold): the market
    // still publishes, just graded with caution.
    const heldTail = divergence ? " Providers differ on the total line — graded with caution." : "";
    if (meanVsProbDisagree) {
      return (
        `${base} Expected goals lean ${meanSide.toUpperCase()}, but the discrete score ` +
        `distribution gives ${displayedSide.toUpperCase()} the higher hit probability ` +
        `(${dispPct}%). Soccer totals behave this way near ${t.line.toFixed(1)} — low-scoring ` +
        `results (0-0, 1-0, 1-1, 2-0) carry meaningful mass.${heldTail}`
      );
    }
    return `${base} Expected goals and probability both lean ${displayedSide.toUpperCase()} (${dispPct}%).${heldTail}`;
  })();
  return {
    projected_total: projection,
    line: t.line,
    over_p: t.over,
    under_p: t.under,
    edge_pp: edgePp,
    displayed_side: displayedSide,
    mean_direction_side: meanSide,
    mean_vs_probability_disagree: meanVsProbDisagree,
    note,
    provider_divergence: divergence,
  };
}

function buildSoccerBttsContext(
  r: PredictionRecordSlim | null,
): NonNullable<MarketEdgeDto["soccerBttsContext"]> | null {
  if (r === null) return null;
  const snap = r.snapshot_json ?? null;
  const m = getModelBtts(snap);
  const lambdas = getModelLambdas(snap);
  if (m === null) return null;
  const ds = getDisplayedSide(snap);
  const displayedSide: "yes" | "no" = ds === "yes" || ds === "no" ? ds : m.yes >= m.no ? "yes" : "no";
  const marketYes = getMarketDevigByKey(snap, "btts|yes");
  const marketDisplayed = displayedSide === "yes" ? marketYes : marketYes !== null ? 1 - marketYes : null;
  const modelDisplayed = displayedSide === "yes" ? m.yes : m.no;
  const edgePp = marketDisplayed !== null ? (modelDisplayed - marketDisplayed) * 100 : null;
  const scoringContext = lambdas !== null
    ? `Projected goals: home ${lambdas.home.toFixed(2)} / away ${lambdas.away.toFixed(2)}.`
    : "Projected goals unavailable.";
  const note = marketDisplayed !== null && edgePp !== null
    ? `Model ${roundPct(modelDisplayed)}% on ${displayedSide.toUpperCase()} vs. market ${roundPct(marketDisplayed)}% (${fmtEdgePp(edgePp)} edge).`
    : `Model ${roundPct(modelDisplayed)}% on ${displayedSide.toUpperCase()}. Market BTTS pricing unavailable.`;
  return {
    yes_p: m.yes,
    no_p: m.no,
    market_yes: marketYes,
    edge_pp: edgePp,
    displayed_side: displayedSide,
    scoring_context: scoringContext,
    note,
  };
}

function getMiscalibrationFlag(snapshot: Record<string, unknown> | null): boolean {
  if (snapshot === null) return false;
  const d = (snapshot as { decision?: unknown }).decision;
  if (d === null || typeof d !== "object") return false;
  return (d as { miscalibration_flag?: unknown }).miscalibration_flag === true;
}

function getCalibrationLevel(snapshot: Record<string, unknown> | null): string {
  const lvl =
    snapshot !== null
      ? (snapshot as { calibration_evidence_level?: unknown }).calibration_evidence_level
      : null;
  return typeof lvl === "string" ? lvl : "external_priors_only";
}

const SOCCER_MARKET_LABEL: Record<string, string> = {
  match_result: "Match Result",
  double_chance: "Double Chance",
  total: "Total",
  btts: "BTTS",
};

/**
 * WC-MODEL-5 grade-honesty block. Explains the grade with model/market
 * probabilities + edge, the research-calibrated reason it's not higher, and
 * the upgrade path — so a Caution/Watchlist is informative, not dead. No
 * fabricated data: every field is derived from the stored decision.
 */
function buildSoccerGradeContext(
  r: PredictionRecordSlim | null,
): NonNullable<MarketEdgeDto["soccerGradeContext"]> | null {
  if (r === null) return null;
  const snap = r.snapshot_json ?? null;
  const gradeKey = normalizeGradeKey(r.play_grade);
  const miscal = getMiscalibrationFlag(snap);
  const level = getCalibrationLevel(snap);
  // 2026-06-16: the pre-calibration disclaimer is internal — not public-facing.
  // Empty under external_priors_only so the reader hides it; only the
  // post-calibration label shows (when we actually have historical calibration).
  const calibrationLabel = level === "external_priors_only" ? "" : "Calibrated on historical results.";
  const modelPct = r.model_probability !== null ? Math.round(r.model_probability * 1000) / 10 : null;
  const marketPct = r.market_probability !== null ? Math.round(r.market_probability * 1000) / 10 : null;
  const edgePp = r.edge;
  const label = SOCCER_MARKET_LABEL[r.market] ?? r.market;
  const edgeStr = edgePp !== null ? `${edgePp >= 0 ? "+" : ""}${edgePp.toFixed(1)}pp` : "n/a";

  const reason = ((): string => {
    if (r.held) {
      // Customer-facing: never expose the raw internal hold code/threshold
      // jargon ("model on wrong side by X pp below floor"). Translate to a
      // plain, confident "why we're passing" sentence.
      const hr = `${r.hold_reason ?? ""} ${r.no_bet_reason ?? ""}`.toLowerCase();
      if (hr.includes("push") || hr.includes("within") || hr.includes("on the line"))
        return `Our projection lands right on this line — too close to call, so we're passing.`;
      if (hr.includes("odds") || hr.includes("stale") || hr.includes("provider") || hr.includes("missing") || hr.includes("data"))
        return `Live market data for this market is still settling — holding off until it's clean.`;
      if (hr.includes("wrong side") || hr.includes("disagree") || hr.includes("conflict") || hr.includes("ceiling") || hr.includes("exceeds"))
        return `Our read differs enough from the market here that we'd rather pass than force a play.`;
      return `No clean edge on this market — we're passing.`;
    }
    if (miscal) {
      // WC-MODEL-8 (2026-06-16): a sanity-ceiling hit now means likely bad
      // INPUT DATA (not a model-vs-market opinion), parked at Watchlist — no
      // "implausible edge" scare copy.
      return `Market inputs for ${label} look unsettled right now — keeping this on the Watchlist until the data is clean.`;
    }
    const dcNote =
      r.market === "double_chance"
        ? " Double Chance needs a larger edge because it is short-priced and margin-heavy."
        : "";
    if (gradeKey === "lean" || gradeKey === "best_angle") {
      return `Edge ${edgeStr} clears the Lean bar for ${label}.`;
    }
    if (gradeKey === "watchlist") {
      return `Edge ${edgeStr} is in the Watchlist band for ${label} — noted, not yet an actionable Lean.${dcNote} A larger edge with market agreement would upgrade it.`;
    }
    // caution / no-play
    return `Edge ${edgeStr} is below the actionable threshold for ${label}. Soccer closing lines are efficient, so small edges aren't played.${dcNote} A larger calibrated edge with market agreement would upgrade it.`;
  })();

  return {
    calibration_label: calibrationLabel,
    model_pct: modelPct,
    market_pct: marketPct,
    edge_pp: edgePp,
    grade_reason: reason,
    miscalibration_flag: miscal,
  };
}

/**
 * Live WS stream overlay for the WC card (2026-06-16, step 3). The soccer
 * market names (match_result / total / btts) match the stream `market_type`
 * 1:1, so streamKey(game_id, r.market, r.side) addresses the stream rows
 * directly. DEFENSIVE/optional — when absent the card degrades to the cron
 * price + opener exactly as before.
 */
type SoccerStreamContext = {
  current: Map<string, StreamCurrent>;
  lastMove: Map<string, LastMove>;
  nowMs: number;
};

function buildMarketEdgeDto(
  r: PredictionRecordSlim | null,
  openerLookup: OpenerLookup,
  stream?: SoccerStreamContext | null,
): MarketEdgeDto {
  if (r === null) {
    return {
      pick: null,
      confidence: null,
      grade: null,
      signalType: null,
      marketSignal: null,
      sharpStatus: "caution",
      held: true,
      verdict: { key: "no_play", label: "No Play" },
      guidedGuide: "",
      guidedWatchOut: "",
      whyLine: "",
      riskLine: "",
      modelProb: null,
      marketFairProb: null,
      pinnacleEvPct: null,
      moneyPct: null,
      betsPct: null,
      publicSplits: [],
      priceAmerican: null,
      lineOpenAmerican: null,
      modelTotal: null,
      marketTotal: null,
      line: null,
      keyStats: [],
      modelTrustPct: null,
      marketImpliedPct: null,
      modelMarketGapPct: null,
      marketSource: null,
      marketDataQuality: "unavailable",
      reviewFlags: [],
      reviewActionSummary: "keep",
    };
  }
  // prediction_records.confidence is stored 0..100; modelTrustPct is
  // also 0..100. prediction_records.market_probability is stored 0..1;
  // marketImpliedPct is 0..100 — convert here. modelMarketGapPct is in
  // percentage points (both inputs in percent).
  //
  // CHANGE 2026-06-11: For soccer/WC we ALWAYS surface modelTrustPct and
  // marketImpliedPct even when held. The pre-calibration WC contract
  // means almost everything is held; if we null these out, the card
  // reads as broken instead of "held with honest model vs market read".
  // Members need to see the numbers + the hold reason together.
  const modelTrustPct = r.confidence;
  const marketImpliedPct = r.market_probability === null ? null : r.market_probability * 100;
  const gap =
    modelTrustPct === null || marketImpliedPct === null
      ? null
      : modelTrustPct - marketImpliedPct;
  // For held rows: pick/confidence are still shown so the card is honest
  // about the model's read. The verdict pill ("Held / No Play") + the
  // whyLine carry the "don't bet this" framing.
  // Held markets: suppress the per-market PICK label. Showing "Over 2.5" next to
  // a "No Play" verdict reads as contradictory (Daniel, 2026-06-13). The model's
  // numeric read still lives in the projection block; the verdict pill + the
  // clean held sentence carry the "we're passing" message.
  const heldHelp = buildHeldHelpLine(r);

  // 2026-06-16 step 3 — live WS stream overlay. Soccer market names match the
  // stream market_type 1:1, so the key is direct. Current price prefers the live
  // stream observation over the cron-recorded odds; last-move feeds the line
  // tracker's "Previous" stop + the derived market-intelligence chip. Splits are
  // null for WC (SharpAPI /splits is empty for FIFA), so the chip is driven by
  // movement. All optional → degrades to cron price + opener when absent.
  // 2026-06-17 — FREEZE AT LOCK. Once the row is locked (locked_at set), the
  // card must reflect the frozen snapshot, not the still-updating stream tables.
  // Suppress the live overlays so price/line stop moving post-lock; current
  // falls back to the locked odds (r.odds_american).
  const isLockedRow = r.locked_at !== null;
  const sKey = !isLockedRow && r.side !== null && stream ? streamKey(r.game_id, r.market, r.side) : null;
  const streamCurrent = sKey ? stream!.current.get(sKey) ?? null : null;
  const lastMove = sKey ? stream!.lastMove.get(sKey) ?? null : null;
  const currentAmerican = streamCurrent?.american ?? r.odds_american;
  const openAmerican = openerLookup(r.game_id, r.market, r.side);
  const marketInterpretation = stream
    ? interpretMarket({
        pickSide: r.side,
        openAmerican,
        postedAmerican: null,
        currentAmerican,
        lastMove,
        splits: null,
        nowMs: stream.nowMs,
      })
    : undefined;

  return {
    pick: r.held ? null : r.pick,
    confidence: r.held || r.confidence === null ? null : r.confidence / 100,
    grade: null,
    signalType: null,
    marketSignal: null,
    sharpStatus: "caution",
    held: r.held,
    verdict: gradeToVerdict(r.play_grade, r.held, r.no_bet),
    guidedGuide: heldHelp,
    guidedWatchOut: "",
    whyLine: heldHelp,
    riskLine: "",
    modelProb: r.model_probability,
    marketFairProb: r.market_probability,
    pinnacleEvPct: null,
    moneyPct: null,
    betsPct: null,
    publicSplits: [],
    priceAmerican: currentAmerican,
    lineOpenAmerican: openAmerican,
    // 2026-06-16 line-tracker (step 3): live WS overlay now wired for WC. Open
    // from line_history opener; Previous from the last WS move; Current from the
    // live stream (fallback cron); Locked frozen at lock. First Published has no
    // soccer source yet (deferred).
    lastMovePrevAmerican: lastMove?.prevAmerican ?? null,
    lastMoveNextAmerican: lastMove?.nextAmerican ?? null,
    lastMoveAtIso: lastMove?.movedAtIso ?? null,
    lastMoveLinePrev: lastMove?.prevLineValue ?? null,
    lastMoveLineNext: lastMove?.nextLineValue ?? null,
    marketInterpretation,
    lockedLineAmerican: r.locked_at !== null ? r.odds_american : null,
    lockedLineAt: r.locked_at,
    oddspherePostedAmerican: null,
    oddspherePostedAt: null,
    modelTotal: null,
    marketTotal: null,
    line: r.line_value,
    keyStats: [],
    modelTrustPct,
    marketImpliedPct,
    modelMarketGapPct: gap,
    marketSource: "Market odds (prematch)",
    // WC-2 contract: SharpAPI /splits is empty_as_of_probe for FIFA WC,
    // so calling this "two_sided_consensus" would imply public-split
    // depth we don't have. The DTO's enum is a closed union; the
    // closest honest value is "single_book" — limited market depth,
    // treat with care. The card maps this to a "Limited" badge instead
    // of the "Consensus" badge MLB shows.
    marketDataQuality: r.market_probability === null ? "unavailable" : "single_book",
    reviewFlags: [],
    reviewActionSummary: "keep",
  };
}

/**
 * Compose the single sentence shown under held/no-bet markets on the card.
 * Honest about why the model is passing without leaking internal jargon.
 * Returns "" for fully actionable rows — the card already shows the verdict pill.
 */
function buildHeldHelpLine(r: PredictionRecordSlim): string {
  if (!r.held && !r.no_bet) return "";
  return cleanHoldSentence(r.hold_reason, r.no_bet_reason);
}

/**
 * Translate the internal hold code/threshold string into a plain, confident
 * customer sentence. NEVER expose raw jargon ("model on wrong side by X pp
 * below floor", "Reason code: ...", "exceeds ceiling", snake_case codes).
 */
function cleanHoldSentence(holdReason: string | null, noBetReason: string | null): string {
  const hr = `${holdReason ?? ""} ${noBetReason ?? ""}`.toLowerCase();
  if (hr.includes("soccer_total_low_model_probability"))
    return "The model has a total read, but this confidence range has not been strong enough to bet.";
  if (hr.includes("push") || hr.includes("within") || hr.includes("on the line"))
    return "Our projection lands right on this line — too close to call, so we're passing.";
  if (hr.includes("odds") || hr.includes("stale") || hr.includes("provider") || hr.includes("missing") || hr.includes("data"))
    return "Live market data for this market is still settling — holding off until it's clean.";
  if (hr.includes("wrong side") || hr.includes("disagree") || hr.includes("conflict") || hr.includes("ceiling") || hr.includes("exceeds"))
    return "Our read differs enough from the market here that we'd rather pass than force a play.";
  return "No clean edge on this market — we're passing.";
}

function buildDecisionLine(
  matchup: string,
  perMarket: Map<string, PredictionRecordSlim>,
  awayAbbr: string | null = null,
  homeAbbr: string | null = null,
): string {
  // If any market is unheld and graded, lead with that; otherwise honest hold copy.
  const playable = Array.from(perMarket.values()).find((r) => !r.held && r.play_grade !== null);
  if (playable !== undefined) {
    const gradeKey = normalizeGradeKey(playable.play_grade);
    const label =
      gradeKey === "best_angle"
        ? "Best angle"
        : gradeKey === "lean"
          ? "Model lean"
          : gradeKey === "caution"
            ? "Caution"
            : "Watchlist";
    const pickLabel =
      soccerPickLabel(playable.market, playable.pick, playable.line_value, awayAbbr, homeAbbr) ??
      playable.pick;
    return `${label} tonight: ${matchup} ${marketDisplayName(playable.market)} ${pickLabel}.`;
  }
  return `${matchup} — model holding all markets pending in-tournament calibration.`;
}

function marketDisplayName(market: string): string {
  if (market === "match_result") return "Match Result";
  if (market === "total") return "Total";
  if (market === "btts") return "BTTS";
  if (market === "double_chance") return "Double Chance";
  return market;
}

function buildSharpRead(perMarket: Map<string, PredictionRecordSlim>): {
  key: SharpReadKey;
  sentence: string;
} {
  const anyHeld = Array.from(perMarket.values()).some((r) => r.held);
  if (anyHeld) {
    return {
      key: "no_data",
      sentence:
        "Pre-tournament: model and market disagree by too much without in-tournament calibration evidence yet.",
    };
  }
  return {
    key: "no_data",
    sentence: "No sharp-signal data available for FIFA World Cup fixtures at this stage.",
  };
}

function buildModelBreakdown(
  matchup: string,
  perMarket: Map<string, PredictionRecordSlim>,
  awayAbbr: string | null = null,
  homeAbbr: string | null = null,
): string | null {
  const mr = perMarket.get("match_result");
  const total = perMarket.get("total");
  const btts = perMarket.get("btts");
  const doubleChance = perMarket.get("double_chance");
  if (
    mr === undefined &&
    total === undefined &&
    btts === undefined &&
    doubleChance === undefined
  ) {
    return null;
  }

  const fmtRow = (r: PredictionRecordSlim | undefined, label: string): string => {
    if (r === undefined) return "";
    const tag = r.held ? `Held (${r.hold_reason ?? "no reason"})` : (r.play_grade ?? "graded");
    const conf = r.confidence === null ? "" : ` conf=${r.confidence.toFixed(0)}%`;
    const pickLabel = soccerPickLabel(r.market, r.pick, r.line_value, awayAbbr, homeAbbr) ?? r.pick;
    return `${label}: ${pickLabel} — ${tag}${conf}.`;
  };

  const lines = [
    fmtRow(mr, "Match result"),
    fmtRow(doubleChance, "Double chance"),
    fmtRow(total, "Total"),
    fmtRow(btts, "BTTS"),
  ].filter((l) => l.length > 0);
  return `${matchup}. ${lines.join(" ")}`.trim();
}

/**
 * Resolve the per-game holdReason. Returns the snapshot fixture-level
 * hold if every market is held; null when at least one market is
 * playable.
 */
function deriveGameHoldReason(perMarket: Map<string, PredictionRecordSlim>): string | null {
  const rows = Array.from(perMarket.values());
  if (rows.length === 0) return null;
  if (!rows.every((r) => r.held)) return null;
  // Customer-facing: a clean sentence, never the raw fixture/hold code.
  for (const r of rows) {
    const snapJson = r.snapshot_json;
    if (snapJson !== null && typeof snapJson === "object") {
      const fixtureHold = (snapJson as { fixture_hold_reason?: unknown }).fixture_hold_reason;
      if (typeof fixtureHold === "string" && fixtureHold.length > 0) {
        return cleanHoldSentence(fixtureHold, null);
      }
    }
  }
  return cleanHoldSentence(rows[0].hold_reason, rows[0].no_bet_reason);
}

function deriveLockState(lockedAt: string | null, gameDateIso: string): "open" | "locking" | "locked" {
  if (lockedAt !== null) return "locked";
  const now = Date.now();
  const tip = new Date(gameDateIso).getTime();
  if (tip <= now) return "locked";
  if (tip - now <= LOCK_WINDOW_MINUTES * 60 * 1000) return "locking";
  return "open";
}

/**
 * Pull the Dixon-Coles expected-goals (λ_home, λ_away) from any one
 * prediction_records row's snapshot_json.model block. Same value is
 * stamped on every row of the same fixture, so the first row that has
 * it wins. Falls back to {home:null, away:null} when no row carries
 * the snapshot — the caller renders the `projected` field as 0–0 in
 * that case so the card never displays NaN.
 *
 * Why this matters: pre-2026-06-11 the adapter hardcoded projected to
 * {away:0, home:0}, producing the "model is showing 0.0" reading on
 * the WC card. The model HAS the right number — the adapter was just
 * dropping it.
 */
function extractFixtureLambdas(rows: PredictionRecordSlim[]): {
  home: number | null;
  away: number | null;
} {
  for (const r of rows) {
    const sj = r.snapshot_json;
    if (sj === null || typeof sj !== "object") continue;
    const model = (sj as { model?: unknown }).model;
    if (model === null || typeof model !== "object") continue;
    const m = model as { lambda_home?: unknown; lambda_away?: unknown };
    const home = typeof m.lambda_home === "number" ? m.lambda_home : null;
    const away = typeof m.lambda_away === "number" ? m.lambda_away : null;
    if (home !== null || away !== null) return { home, away };
  }
  return { home: null, away: null };
}

function pickFreshestLockedAt(rows: PredictionRecordSlim[]): string | null {
  const stamps = rows.map((r) => r.locked_at).filter((s): s is string => s !== null);
  if (stamps.length === 0) return null;
  return stamps.reduce((max, cur) => (cur > max ? cur : max), stamps[0]);
}

export async function buildSoccerDailyEdgeAdapted(
  requestedDate: string,
): Promise<DailyEdgeResponse> {
  const asOf = new Date().toISOString();

  // 1. Load soccer games for the slate — PLUS "late tonight" carryover
  //    (see CARRYOVER_ET_MINUTES_CUTOFF). We pull both the requested
  //    slate (D) and the next slate (D+1), then keep every D fixture
  //    plus only those D+1 fixtures that kick off before the wee-hours
  //    ET cutoff. This is a READ-only widening: slate_date assignment,
  //    locking, tracking, and grading of the carried-over rows are
  //    untouched — they still belong to D+1 server-side.
  const nextDate = addDaysToSlate(requestedDate, 1);
  const { data: gamesData, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date, slate_date, status")
    .eq("sport", "soccer")
    .in("slate_date", [requestedDate, nextDate]);
  if (gamesErr !== null) throw new Error(`load soccer games: ${gamesErr.message}`);
  const allSlateGames = (gamesData as DbGame[] | null) ?? [];
  // Finished games STAY on the board all day (reverted 2026-06-17 per Daniel —
  // members want to look back on the day's matches until the slate rolls over).
  const games = allSlateGames.filter((g) =>
    qualifiesForSoccerBoard(requestedDate, g, nextDate, et(g.game_date).minutes),
  );
  // Eligible game ids — used to restrict the next-slate prediction_records
  // fetch so non-carryover D+1 fixtures never leak onto the day-D board.
  const eligibleGameIds = new Set(games.map((g) => g.id));

  if (games.length === 0) {
    return {
      as_of: asOf,
      sport: "soccer",
      date: requestedDate,
      requested_date: requestedDate,
      fallback_used: false,
      slateState: "no_data",
      slate_status: null,
      last_slate_update_at: null,
      games: [],
    };
  }

  // 2. Load team abbreviations.
  const teamIds = new Set<number>();
  for (const g of games) {
    if (g.home_team_id !== null) teamIds.add(g.home_team_id);
    if (g.away_team_id !== null) teamIds.add(g.away_team_id);
  }
  const { data: teamsData } = await supabase
    .from("teams")
    .select("id, abbreviation, display_name, location")
    .in("id", [...teamIds]);
  const teamById = new Map<number, TeamRow>(
    ((teamsData as TeamRow[] | null) ?? []).map((t) => [t.id, t]),
  );

  // 3. Load prediction_records for this slate.
  //
  // The DB filter is sport+model_version+slate_date; the competition
  // discriminator lives in snapshot_json (no top-level column on
  // prediction_records), so we filter that in-memory below.
  const { data: predsData } = await supabase
    .from("prediction_records")
    .select(
      "id, game_id, market, pick, side, line_value, odds_american, confidence, model_probability, " +
        "market_probability, edge, play_grade, best_angle, no_bet, no_bet_reason, held, hold_reason, " +
        "locked_at, snapshot_json",
    )
    .eq("sport", "soccer")
    .eq("model_version", SOCCER_MODEL_VERSION)
    .in("slate_date", [requestedDate, nextDate]);
  const rawPreds = (predsData as PredictionRecordSlim[] | null) ?? [];

  // Competition filter — World Cup only. Rows without a competition
  // field stamped in snapshot_json fall through to the WC bucket too
  // (legacy rows from before the discriminator was wired). Once UCL
  // launches, those legacy rows must be backfilled, but for tonight
  // it preserves the existing in-DB rows that don't yet carry the
  // stamp.
  //
  // The eligibleGameIds gate drops next-slate (D+1) prediction rows for
  // fixtures that did NOT clear the wee-hours carryover cutoff, so only
  // genuine "late tonight" D+1 games join the day-D board.
  const allPreds = rawPreds.filter((p) => {
    if (!eligibleGameIds.has(p.game_id)) return false;
    const comp = (p.snapshot_json as { competition?: string } | null)?.competition;
    return comp === undefined || comp === WC_COMPETITION_FIFA_WORLD_CUP;
  });

  // 4. Bucket predictions by game_id × market.
  const byGameMarket = new Map<number, Map<string, PredictionRecordSlim>>();
  for (const p of allPreds) {
    if (!byGameMarket.has(p.game_id)) byGameMarket.set(p.game_id, new Map());
    byGameMarket.get(p.game_id)!.set(p.market, p);
  }

  // Narrow the games list to only games that have a WC prediction row.
  // Prevents stray soccer games (e.g., future UCL fixtures seeded later)
  // from appearing on the WC tab even if they share slate_date.
  const wcGameIds = new Set(allPreds.map((p) => p.game_id));
  const wcGamesWithPreds = games.filter((g) =>
    wcGameIds.size === 0 ? true : wcGameIds.has(g.id),
  );

  // Universal locked-snapshot contract (P0F fix, 2026-06-12): a fixture
  // that has locked / started / passed kickoff must STAY VISIBLE, reading
  // its frozen snapshot — it must not vanish from the slate. The previous
  // soccer-specific post-kickoff filter dropped cards the instant kickoff
  // passed (e.g. BIH/CAN disappeared at 19:00 UTC while still locked with
  // full line data), diverging from MLB/NBA/NHL which keep started games
  // visible via lockState="locked". deriveLockState() already returns
  // "locked" for past-kickoff rows, so started/locked cards render with
  // the correct locked pill and no live recompute. Sorted by kickoff
  // ascending so the next-upcoming fixture is the natural hero.
  const wcGames = [...wcGamesWithPreds].sort(
    (a, b) => new Date(a.game_date).getTime() - new Date(b.game_date).getTime(),
  );

  // 4.5. Load line_history to compute opener per (game, market, side).
  //
  // The earliest recorded_at row per (game_id, market_type, side) is the
  // opener we surface to the card's "Line move" field. We prefer rows
  // flagged is_opener=true when available, falling back to the oldest
  // recorded row when the flag is missing. One batched query keeps this
  // adapter to its existing 4-query budget (games, teams, preds, lines).
  const wcGameIdsForOpener = wcGamesWithPreds.map((g) => g.id);
  const openerMap = new Map<string, number>();
  if (wcGameIdsForOpener.length > 0) {
    const { data: histData } = await supabase
      .from("line_history")
      .select("game_id, market_type, side, odds_american, is_opener, recorded_at")
      .in("game_id", wcGameIdsForOpener)
      .in("market_type", ["match_result", "double_chance", "total", "btts"])
      .order("recorded_at", { ascending: true });
    type HistRow = {
      game_id: number;
      market_type: string;
      side: string | null;
      odds_american: number | null;
      is_opener: boolean | null;
      recorded_at: string;
    };
    const rows = (histData as HistRow[] | null) ?? [];
    // First pass: prefer is_opener=true rows.
    for (const row of rows) {
      if (row.odds_american === null || row.side === null) continue;
      if (row.is_opener !== true) continue;
      const key = `${row.game_id}|${row.market_type}|${row.side}`;
      if (openerMap.has(key)) continue;
      openerMap.set(key, row.odds_american);
    }
    // Second pass: fill any remaining keys with the oldest known row.
    for (const row of rows) {
      if (row.odds_american === null || row.side === null) continue;
      const key = `${row.game_id}|${row.market_type}|${row.side}`;
      if (openerMap.has(key)) continue;
      openerMap.set(key, row.odds_american);
    }
  }
  const openerLookup: OpenerLookup = (gameId, market, side) => {
    if (side === null) return null;
    return openerMap.get(`${gameId}|${market}|${side}`) ?? null;
  };

  // 2026-06-16 step 3 — live WS stream maps for the WC card (current price +
  // last move per game/market/side). DEFENSIVE: both loaders return empty maps
  // on any error (table missing / RLS), so the card degrades cleanly to the
  // cron price + opener. Keyed by streamKey(game_id, market_type, side); soccer
  // market names match the stream market_type 1:1.
  const streamNowMs = Date.now();
  const soccerStream: SoccerStreamContext = {
    current: await loadStreamCurrentForSlate(supabase, wcGameIdsForOpener),
    lastMove: await loadLastMovesForSlate(supabase, wcGameIdsForOpener, streamNowMs),
    nowMs: streamNowMs,
  };

  // 5. Build DTO per game.
  const dtos: DailyEdgeGameDto[] = wcGames.map((g) => {
    const homeTeam = g.home_team_id !== null ? teamById.get(g.home_team_id) : undefined;
    const awayTeam = g.away_team_id !== null ? teamById.get(g.away_team_id) : undefined;
    const homeAbbr = homeTeam?.abbreviation ?? "?";
    const awayAbbr = awayTeam?.abbreviation ?? "?";
    // Soccer matchup separator: " vs " (not "@") since World Cup fixtures
    // are neutral-venue and "@" reads as MLB-style home/away that doesn't
    // map to international football conventions.
    const matchup = `${awayAbbr} vs ${homeAbbr}`;

    const perMarket = byGameMarket.get(g.id) ?? new Map<string, PredictionRecordSlim>();
    const rows = Array.from(perMarket.values());

    const mr = perMarket.get("match_result") ?? null;
    const total = perMarket.get("total") ?? null;
    const btts = perMarket.get("btts") ?? null;
    // WC reader full-completion pass (2026-06-12): the Double Chance
    // prediction_record is the source for the soccerDoubleChanceContext
    // reader block. The DC market always gets its own row in
    // prediction_records (writer creates one per market), and is
    // distinct from the BTTS row that drives the BTTS reader content.
    const dc = perMarket.get("double_chance") ?? null;

    const lockedAt = pickFreshestLockedAt(rows);
    const { time: gameTime, minutes: gameStartMinutes } = et(g.game_date);
    const lockState = deriveLockState(lockedAt, g.game_date);
    const holdReason = deriveGameHoldReason(perMarket);
    const decisionLine = buildDecisionLine(matchup, perMarket, awayAbbr, homeAbbr);
    const sharpRead = buildSharpRead(perMarket);
    const modelBreakdown = buildModelBreakdown(matchup, perMarket, awayAbbr, homeAbbr);

    // Country flags from BDL alpha-3 code (teams.location). UI falls
    // back to abbreviation when the flag URL is null.
    const homeFlagUrl = flagCdnUrl(homeTeam?.location);
    const awayFlagUrl = flagCdnUrl(awayTeam?.location);

    // Expected goals (Dixon-Coles λ) come from the WC-3 snapshot. Same
    // model output is stamped on every market's snapshot for the game,
    // so we read whichever market we have. These drive the per-card
    // "Projection" display so it no longer reads 0–0.
    const lambdas = extractFixtureLambdas(rows);

    return {
      id: `soccer-${g.external_id}`,
      sport: "soccer",
      external_id: g.external_id,
      awayTeam: awayAbbr,
      awayTeamLogo: awayFlagUrl,
      homeTeam: homeAbbr,
      homeTeamLogo: homeFlagUrl,
      gameTime,
      gameStartMinutes,
      scheduledLockAt: computeLocksAtIso(g.game_date),
      lockState,
      lockedAt,
      updatedAt: asOf,
      generatedAt: asOf,
      holdReason,
      homeStarter: null,
      awayStarter: null,
      predictions: {
        ml: buildPredictionDto(mr),
        total: buildTotalPredictionDto(total),
        nrfi: buildPredictionDto(btts),
      },
      markets: {
        // WC reader follow-up (2026-06-12): attach the Match Result
        // three-way model probabilities to the moneyline slot. Pulled
        // from the Dixon-Coles snapshot via extractMatchResultThreeWayProbs.
        // The reader hides the W/D/L band when this field is null, so
        // soccer rows without an mr snapshot stay clean.
        moneyline: {
          ...buildMarketEdgeDto(mr, openerLookup, soccerStream),
          matchResultThreeWayProbs: extractMatchResultThreeWayProbs(mr?.snapshot_json ?? null),
          // WC reader full-completion pass (2026-06-12):
          // Soccer-only reader context blocks. The moneyline slot
          // carries both Match Result and BTTS context — the reader
          // surfaces BTTS alongside Match Result rather than as its
          // own card slot, because the soccer card has no nrfi slot.
          soccerMatchResultContext: buildSoccerMatchResultContext(mr),
          // 2026-06-13 swap: Double Chance rides the Match Result slot as a
          // reader context block; BTTS now owns the first_inning pill.
          soccerDoubleChanceContext: buildSoccerDoubleChanceContext(dc, homeAbbr, awayAbbr),
          // WC-MODEL-5 grade-honesty block for the Match Result headline.
          soccerGradeContext: buildSoccerGradeContext(mr),
        },
        total: {
          ...buildMarketEdgeDto(total, openerLookup, soccerStream),
          soccerTotalContext: buildSoccerTotalContext(total),
          soccerGradeContext: buildSoccerGradeContext(total),
        },
        first_inning: {
          // The "first_inning" slot is the soccer BTTS carrier (pill +
          // headline). 2026-06-13 swap: BTTS moved here from the Match
          // Result context block, and Double Chance moved to the Match
          // Result slot's reader context. Headline pick/price come from the
          // real `btts` prediction_record.
          ...buildMarketEdgeDto(btts, openerLookup, soccerStream),
          soccerBttsContext: buildSoccerBttsContext(btts),
          soccerGradeContext: buildSoccerGradeContext(btts),
        },
      },
      decisionLine,
      projected: {
        away: lambdas.away ?? 0,
        home: lambdas.home ?? 0,
      },
      sharpSignals: [],
      status: {
        lineupConfirmed: null,
        linesLocked: false,
        // Honest signal: prematch only; sharp/public data not surfaced
        // for FIFA WC at this stage. Card components key off these to
        // render "—" instead of an empty stat slot.
        sharpSignalPending: true,
        marketDataLimited: true,
      },
      result: null,
      breakdown: {
        verdict: gradeToVerdict(
          rows.find((r) => !r.held)?.play_grade ?? null,
          rows.every((r) => r.held),
        ),
        sharpRead,
        modelBreakdown,
      },
    };
  });

  return {
    as_of: asOf,
    sport: "soccer",
    date: requestedDate,
    requested_date: requestedDate,
    fallback_used: false,
    slateState: dtos.length > 0 ? "today_published" : "no_data",
    slate_status: dtos.length > 0 ? "published" : null,
    last_slate_update_at: asOf,
    games: dtos,
  };
}
