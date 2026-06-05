/**
 * GET /api/lab/daily-edge?sport=mlb&date=YYYY-MM-DD
 *
 * Tonight's slate for the Daily Edge view. Joins:
 *   • games + teams (abbreviations)
 *   • game_predictions (model picks + confidences + projected scores)
 *   • sharp_signals (per-market posture, batched by game_id)
 *
 * Per Decision G: the route is the single source of truth for game-level
 * verdicts. Per-market sharpStatus is derived from the authoritative
 * sharp_signals.signal_strength column (compared against the predicted
 * side); the 4-tier verdict (triple_lock/strong/lean/caution) is aggregated
 * server-side from those statuses. UI components do not re-derive.
 *
 * Auth: public read. Data is identical to what members see in /lab.
 *
 * Slate-date convention: games starting before 06:00 UTC on date+1 belong
 * to `date`'s slate (matches /api/admin/games). Default `date` = today UTC.
 *
 * Sports without live coverage (anything other than MLB in V1) return
 * `{ games: [] }` — UI's ComingSoonState handles the empty case.
 */

import { supabase } from "@/lib/db/supabase";
import { filterMockSourceRows } from "@/lib/db/productionFilter";
import { classifyEvidence } from "@/lib/services/signalEvidenceClassifier";
import { generateSignalSummary } from "@/lib/services/signalSummaryGenerator";
import {
  deriveVerdict,
  VERDICT_LABEL,
  type Verdict,
} from "@/lib/services/verdictDerivation";
import {
  selectSharpReadKey,
  SHARP_READ_SENTENCES,
  type SharpReadKey,
  type SharpReadMarket,
  type SharpSignalProjection,
} from "@/lib/services/sharpReadSelector";
import type { Side } from "@/lib/types/domain/Lines";
import { computeMarketImplied } from "@/app/lab/lib/marketImplied";
import type { Sport } from "@/lib/types/domain/Sport";
import type {
  Grade,
  MarketSignal,
  SignalType,
} from "@/lib/types/domain/Grade";
import { currentSlateDate, isSlateDate } from "@/lib/dates/slateDate";
import { determineSlateState } from "@/lib/services/dailyEdgeSlateResolution";
import {
  classifyLockState,
  computeLocksAt,
} from "@/lib/automodel/lockState";
import type { LockState as DtoLockState } from "@/app/lab/lib/labTypes";
import type {
  DailyEdgeGameDto,
  DailyEdgeResponse,
  MarketEdgeDto,
  GameStatusDto,
  SharpSignalCategory,
  SharpSignalDto,
  SharpStatus,
} from "@/app/lab/lib/labTypes";
import {
  marketVerdictFor,
  type SharpDirection,
  type MarketVerdict,
  type ReviewerSignals,
} from "@/lib/services/marketVerdictDerivation";
import { generatePerMarketCopy } from "@/lib/services/perMarketCopyGenerator";
import { formatKeyStats } from "@/lib/services/keyStatsFormatter";
import { assertNoBannedTerms } from "@/lib/services/bannedTermsLinter";

const VALID_SPORTS: Sport[] = ["mlb", "nba", "nfl", "cbb", "cfb", "nhl", "ucl"];
const LIVE_SPORTS: Sport[] = ["mlb"];

/**
 * V2.1 Part 9 — only `published` and `final` slates are visible to members.
 * `draft` slates are admin-loaded but not yet live; `hidden` slates have
 * been retracted. This array is the single source of truth for the filter
 * applied to every games query in this route.
 */
const VISIBLE_SLATE_STATUSES = ["published", "final"] as const;

/**
 * R-19 Phase 1 (C7) — slate-resolution moved to a pure state machine
 * (`lib/services/dailyEdgeSlateResolution.ts`). The route now:
 *   1. Probes the requested date for all `slate_status` rows.
 *   2. If `?allowStale=true` is set, probes for the most recent visible
 *      slate to use as fallback. Default = no fallback query.
 *   3. Hands the rows to `determineSlateState` and renders the response
 *      according to the returned state machine result.
 *
 * Pre-R-19 the route silently fell back to the most recent visible slate
 * — surfacing yesterday's picks under today's date. That regression mode
 * is now gated behind the explicit `?allowStale=true` query opt-in, and
 * even there the response carries `slateState="stale_fallback"` +
 * `fallback_used=true` for the UI to render an unambiguous label.
 */

// ───────────────────────────────────────────────────────────────────────────
// Time helpers (ET display)
// ───────────────────────────────────────────────────────────────────────────

/** Format UTC ISO timestamp as "7:10 PM" in ET. Approximation: UTC-4 (EDT). */
function formatTimeET(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hour24 = (d.getUTCHours() + 24 - 4) % 24;
  const minutes = d.getUTCMinutes();
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const display = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${display}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

/** Minutes-from-midnight-ET for stable sort ordering. */
function minutesFromMidnightET(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const hour24 = (d.getUTCHours() + 24 - 4) % 24;
  return hour24 * 60 + d.getUTCMinutes();
}

/** Compose "3H AGO" / "12M AGO" / "JUST NOW". */
function relativeTimeAgo(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return undefined;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H AGO`;
  const days = Math.floor(hours / 24);
  return `${days}D AGO`;
}

// (slate-date window helpers removed in 5E.1 — filters now hit
// games.slate_date directly. See lib/dates/slateDate.ts for the canonical
// "today's slate" computation.)

// ───────────────────────────────────────────────────────────────────────────
// Sharp signal mapping
// ───────────────────────────────────────────────────────────────────────────

/**
 * Sharp signal row shape consumed by the route. Fix 4.1 (K1) dropped
 * `signal_strength` and `signal_summary` from the SELECT — those legacy
 * columns are no longer the source of truth for member-facing signal data.
 * sharpStatus and direction now derive from the per-pick grade; description
 * text comes from generateSignalSummary() at response time.
 */
type SignalRow = {
  game_id: number;
  market_type: string;
  side: string;
  pinnacle_fair_probability: number | null;
  is_plus_ev: boolean | null;
  ev_pct: number | null;
  has_steam_move: boolean | null;
  steam_detected_at: string | null;
  steam_books_count: number | null;
  has_reverse_line_movement: boolean | null;
  rlm_direction: string | null;
  public_betting_pct: number | null;
  public_money_pct: number | null;
  computed_at: string | null;
};

/**
 * 4.1.10 — current `lines` row for the v13.1 Edge Stack per-market price.
 * Selected with `player_id IS NULL` so player props don't leak in.
 */
type LineRow = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  fetched_at: string | null;
};

/**
 * 4.1.10 — first-seen line for `lineOpenAmerican`. Per 4.1.9.B section 10,
 * we derive "first seen" from MIN(recorded_at) on `line_history` because
 * `linesService.refreshGameLines` hardcodes `is_opener=false` today.
 */
type LineHistoryRow = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  odds_american: number | null;
  recorded_at: string;
};

const MARKET_LABEL: Record<string, SharpSignalDto["market"]> = {
  moneyline: "ML",
  total: "OU",
  first_inning_total: "NRFI",
};

/**
 * Fix 4.1 (Flag D1): three-state sharpStatus derived from the per-pick
 * grade rather than legacy `signal_strength`. Per the framework's grade
 * vocabulary, the grade IS the user-facing verdict — sharpStatus is the
 * compact per-tile visualization of that verdict.
 *
 *   best_signal / sharp_confirmed → confirm  (market agrees with model)
 *   sharp_conflict               → caution   (market opposes model)
 *   everything else              → mixed     (no clear verdict)
 *
 * Gap-19.5 follow-up: the "mixed" label is shared by genuinely silent
 * states (model_only) and middle-tier states (market_watch, market_led).
 * Member feedback post-launch should inform whether to split this into
 * "neutral" / "quiet" sub-states. Not a launch blocker.
 */
function deriveSharpStatus(grade: Grade | null): SharpStatus {
  if (grade === "best_signal" || grade === "sharp_confirmed") return "confirm";
  if (grade === "sharp_conflict") return "caution";
  return "mixed";
}

/**
 * Direction maps to the same three-state grade-derived verdict. Drives the
 * signal-row border color (emerald / amber / gray). Mirrors the legacy
 * mapping post-Fix-4.1 but sourced from grade instead of signal_strength.
 */
function deriveDirection(grade: Grade | null): SharpSignalDto["direction"] {
  if (grade === "best_signal" || grade === "sharp_confirmed") return "positive";
  if (grade === "sharp_conflict") return "negative";
  return "neutral";
}

function categorizeSignal(s: SignalRow): SharpSignalCategory {
  if (s.has_steam_move && (s.steam_books_count ?? 0) >= 2) return "steam";
  if (s.has_reverse_line_movement) {
    // rlm_direction stored as "toward_home" / "toward_away" / "toward_over" / "toward_under".
    // For UI we only need toward vs. away from the SIGNAL's side.
    const target = s.rlm_direction ?? "";
    if (target.includes(s.side)) return "line_move_toward";
    return "line_move_away";
  }
  if (
    s.public_money_pct !== null &&
    s.public_betting_pct !== null &&
    s.public_money_pct - s.public_betting_pct >= 12
  ) {
    return "handle_gap";
  }
  if (s.is_plus_ev) return "pinnacle_agree";
  return "no_signal";
}

/**
 * Project the per-pick grade and modelSide for a given (market, prediction)
 * tuple. Returns null when the model didn't pick that market (per-pick
 * triplet all-null upstream).
 */
type MarketSignalLookup = {
  modelSide: Side;
  grade: Grade | null;
};

function buildSignalDtos(
  rows: SignalRow[],
  lookup: Map<string, MarketSignalLookup>,
  ctx: { homeTeamAbbr: string; awayTeamAbbr: string }
): SharpSignalDto[] {
  return rows
    .map((s): SharpSignalDto | null => {
      const market = MARKET_LABEL[s.market_type];
      if (!market) return null;

      // Look up the per-pick grade + modelSide for this market. When the
      // model didn't pick, fall back to the signal's own side and grade=null
      // (generator yields the honest fallback copy).
      const pick = lookup.get(s.market_type);
      const modelSide: Side = (pick?.modelSide ?? (s.side as Side));
      const grade = pick?.grade ?? null;

      // Fix 4.1: classifyEvidence + generateSignalSummary derive the text
      // at response time from the same evidence record the grade engine
      // already computed. One pipeline. Replaces the legacy
      // verdictGenerator pre-write path.
      const evidence = classifyEvidence(modelSide, {
        side: s.side as Side,
        is_plus_ev: s.is_plus_ev ?? false,
        ev_pct: s.ev_pct,
        has_steam_move: s.has_steam_move ?? false,
        steam_books_count: s.steam_books_count,
        has_reverse_line_movement: s.has_reverse_line_movement ?? false,
        rlm_direction: s.rlm_direction,
        public_betting_pct: s.public_betting_pct,
        public_money_pct: s.public_money_pct,
      });
      const description = generateSignalSummary(
        modelSide,
        s.market_type,
        {
          side: s.side as Side,
          is_plus_ev: s.is_plus_ev ?? false,
          ev_pct: s.ev_pct,
          has_steam_move: s.has_steam_move ?? false,
          steam_books_count: s.steam_books_count,
          has_reverse_line_movement: s.has_reverse_line_movement ?? false,
          rlm_direction: s.rlm_direction,
          public_betting_pct: s.public_betting_pct,
          public_money_pct: s.public_money_pct,
        },
        evidence,
        grade,
        {
          homeTeamAbbr: ctx.homeTeamAbbr,
          awayTeamAbbr: ctx.awayTeamAbbr,
          steamDetectedAt: s.steam_detected_at,
        }
      );

      const category = categorizeSignal(s);
      return {
        market,
        category,
        description,
        source: s.is_plus_ev ? "PINNACLE" : "MARKET",
        timestamp: relativeTimeAgo(s.steam_detected_at ?? s.computed_at),
        direction: deriveDirection(grade),
      };
    })
    .filter((x): x is SharpSignalDto => x !== null);
}

// ───────────────────────────────────────────────────────────────────────────
// Row → DTO
//
// Note: pre-6.4 a 3-state verdict banner (strong/caution/null) was computed
// here from per-market sharpStatus values. Phase 6.4b replaces the banner
// with the V2.1 grade badge (Grade + SignalType + MarketSignal, populated
// upstream by gradeDerivationService) and removes the verdict aggregator
// helpers entirely — the per-tile sharpStatus on each pick tile is the
// only remaining per-market signal on the card.
// ───────────────────────────────────────────────────────────────────────────

type PredictionRow = {
  /** Data provenance (V11 migration). Read by the production data-mode
   * filter to suppress mock rows from member-facing responses per
   * SHARP_SIGNAL_FRAMEWORK.md §"Signal Source Quality". */
  source_type: string | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_total: number | null;
  predicted_ml_winner: string | null;
  ml_confidence: number | null;
  predicted_ou_side: string | null;
  ou_confidence: number | null;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  /** V13 per-pick grade triplets (Phase 6.3.5). All three fields per
   * market are NULL together when the model didn't pick that market.
   * Column names use the DB convention: ml_* / ou_* / nrfi_* — the
   * DTO surfaces them as predictions.ml / predictions.total / predictions.nrfi
   * respectively (note ou_ → total name swap).
   *
   * 6.3.5e dropped the legacy single-grade columns (grade, signal_type,
   * market_signal) from this type and from the SELECT — those DB columns
   * are now orphaned and get cleaned up by a future V14 migration. */
  ml_grade: Grade | null;
  ml_signal_type: SignalType | null;
  ml_market_signal: MarketSignal | null;
  ou_grade: Grade | null;
  ou_signal_type: SignalType | null;
  ou_market_signal: MarketSignal | null;
  nrfi_grade: Grade | null;
  nrfi_signal_type: SignalType | null;
  nrfi_market_signal: MarketSignal | null;
  /**
   * Fix 7.2.5: sport_specific JSONB — operator-entered listed_line
   * (MLB) or other per-sport extras. Daily Edge prefers the lines
   * table sportsbook total; falls back to sport_specific.listed_line
   * when no lines row exists.
   */
  sport_specific: Record<string, unknown> | null;
  /**
   * Phase 4.2.B — when the prediction was last refreshed. Surfaces as
   * `updatedAt` in the DTO so the UI can show "Updated 4:12 PM".
   */
  computed_at: string | null;
  /**
   * Phase 4.2.B — per-game T-60 lock timestamp. NULL = unlocked.
   * Surfaces as `lockedAt` in the DTO and feeds the `lockState`
   * classification via lockState.classifyLockState.
   */
  locked_at: string | null;
};

type GameRow = {
  id: number;
  external_id: number;
  sport: string;
  game_date: string;
  /** R-19 Phase 1 — `games.updated_at`; route uses it to compute
   *  `last_slate_update_at` for the slate displayed in the response. */
  updated_at: string | null;
  // To-one FK expansions: Supabase typegen renders these as arrays but the
  // runtime returns a single object. game_predictions has UNIQUE(game_id)
  // and team FKs are to-one. Cast as single-object | null.
  home_team: { abbreviation: string; logo_url: string | null } | null;
  away_team: { abbreviation: string; logo_url: string | null } | null;
  /**
   * Phase 4.2.C.1.R-10 — joined starter rows. Null when
   * `games.{home,away}_pitcher_id` is null (probable starter not
   * posted yet). The relation alias forces Supabase to expand the
   * FK rather than returning the id.
   */
  home_pitcher: { first_name: string | null; last_name: string | null; throws: string | null } | null;
  away_pitcher: { first_name: string | null; last_name: string | null; throws: string | null } | null;
  game_predictions: PredictionRow | null;
};

/**
 * Phase R-10 — project a joined `players` FK expansion into the DTO
 * starter shape. Returns null when the FK was null (no probable
 * starter posted) or when the row is too sparse to render (no name
 * at all). Normalizes `throws` to the "L" | "R" | null contract.
 */
function buildStarterDto(
  raw: { first_name: string | null; last_name: string | null; throws: string | null } | null
): { name: string; throws: "L" | "R" | null } | null {
  if (raw === null) return null;
  const first = raw.first_name?.trim() ?? "";
  const last = raw.last_name?.trim() ?? "";
  const name = `${first} ${last}`.trim();
  if (name.length === 0) return null;
  const throws: "L" | "R" | null =
    raw.throws === "L" ? "L" : raw.throws === "R" ? "R" : null;
  return { name, throws };
}

function buildGameDto(
  row: GameRow,
  signals: SignalRow[],
  sportsbookTotalLine: number | null,
  currentLinesByGameMarket: Map<string, LineRow[]>,
  openLinesByGameMarket: Map<string, LineHistoryRow>
): DailyEdgeGameDto | null {
  const home = row.home_team?.abbreviation ?? "—";
  const away = row.away_team?.abbreviation ?? "—";
  const homeLogo = row.home_team?.logo_url ?? null;
  const awayLogo = row.away_team?.logo_url ?? null;
  const pred = row.game_predictions;
  if (!pred) return null; // Skip games without a model prediction.

  // Phase 4.2.C.2 — held extraction. The auto-model marks a market as
  // held when it refuses to make a pick (e.g., missing starter, scratched
  // starter, insufficient data). Held markets carry null pick / null
  // confidence / null grade — the UI must render "Held", NEVER a fake
  // default. Pre-4.2.C.2 the route used `?? "home"` / `?? "under"` /
  // `?? true` defaults which surfaced as misleading 0%/Under/NRFI on the
  // card. Those defaults are removed below.
  const heldFlag =
    pred.sport_specific !== null &&
    (pred.sport_specific as Record<string, unknown>).held === true;
  const holdPicksRaw =
    pred.sport_specific === null
      ? []
      : ((pred.sport_specific as Record<string, unknown>).hold_picks as
          | string[]
          | undefined) ?? [];
  const holdPicks = Array.isArray(holdPicksRaw) ? holdPicksRaw : [];
  const isMlHeld = heldFlag && holdPicks.includes("ml");
  const isOuHeld = heldFlag && holdPicks.includes("ou");
  const isNrfiHeld = heldFlag && holdPicks.includes("nrfi");
  const holdReason =
    pred.sport_specific === null
      ? null
      : (((pred.sport_specific as Record<string, unknown>).hold_reason as
          | string
          | undefined) ?? null);

  // ── ML ──
  // Phase 4.2.C.2 — null pick passes through honestly when held. The
  // home/away resolution only fires when predicted_ml_winner is non-null.
  // UI renders the null pick as "Held" via MarketEdgeDto.held.
  const mlWinnerKey = pred.predicted_ml_winner;
  const mlPick: string | null =
    mlWinnerKey === null ? null
      : mlWinnerKey === "home" ? home
        : away;
  // Fix 4.1 (Flag D1): sharpStatus derives from the per-pick grade, not
  // from legacy signal_strength. See deriveSharpStatus() comment.
  const mlStatus = deriveSharpStatus(pred.ml_grade);

  // ── Total ──
  // 5F.1 / Fix 7.2.5: display the SPORTSBOOK total line — what members
  // would actually bet on. The model projection lives separately in
  // `projected` (hero stat) and never substitutes here.
  //
  // Priority chain (Fix 7.2.5):
  //   1. lines table (Pinnacle preferred, then DK/FD/MGM/Caesars) —
  //      most current; populated by sharp-signal provider
  //   2. game_predictions.sport_specific.listed_line — operator-
  //      entered at upload time; useful for manual MLB slates without
  //      sharp data
  //   3. null — neither source available; UI renders the side alone
  //      ("Under") rather than misleadingly showing predicted_total
  //
  // Pre-Fix-7.2.5 the route fell through to `pred.predicted_total ?? 0`
  // which surfaced "Under 7.8" on manual slates — the 7.8 looked like
  // a market line but was actually the model projection (home + away).
  // The fallback is removed; the field is now allowed to be null and
  // the UI handles null cleanly.
  // Phase 4.2.C.2 — held total. Pre-4.2.C.2 `?? "under"` defaulted the
  // ou_side to "under" when null, which surfaced as fake "Under" picks
  // on held games (one of the symptoms in the 2026-06-03 smoke test).
  // Null is now passed through honestly; the UI renders held markets
  // explicitly.
  const ouSide = pred.predicted_ou_side;
  const manualListedLine =
    typeof pred.sport_specific?.listed_line === "number"
      ? pred.sport_specific.listed_line
      : null;
  const totalLine: number | null =
    sportsbookTotalLine ?? manualListedLine ?? null;
  const totalStatus = deriveSharpStatus(pred.ou_grade);
  const totalPick: string | null =
    ouSide === null ? null
      : ouSide === "over" ? "Over"
        : "Under";

  // ── NRFI ──
  //
  // Toss-Up display fix (Change A):
  //   The legacy `predicted_nrfi` boolean column can't represent the
  //   model's Phase 4D.1 5-zone Toss-Up state — it always collapses to
  //   true (NRFI) for Toss-Up rows. That makes the displayed pick read
  //   as "NRFI 52%" with a projection of ~1.00 runs, which is squarely
  //   in the model's Toss-Up band [0.85, 1.15] and reads as a
  //   contradiction to users.
  //
  //   Detection strategy (safest signal first):
  //     1. `sport_specific.nrfi_decision_kind === "toss_up"` — the
  //        canonical model field added in Phase 4D.1. Honest, distinguishes
  //        Toss-Up from held cleanly.
  //     2. Heuristic fallback for pre-4D.1 rows that don't have
  //        nrfi_decision_kind populated: nrfi_confidence === 52 (the
  //        sentinel) AND nrfi_expected_runs in [0.85, 1.15) (the exact
  //        Toss-Up band the model uses).
  //
  //   This is a DISPLAY-only fix. Model, thresholds, confidence,
  //   projected runs, and the underlying DB columns are unchanged. The
  //   route just chooses a different pick label for Toss-Up zone rows.
  // Phase 4.2.C.2 — held FI. Pre-4.2.C.2 `?? true` defaulted predicted_nrfi
  // to NRFI when null, surfacing fake "NRFI" picks on held games. Null
  // is now passed through honestly. Toss-Up display logic still fires
  // for valid non-held Toss-Up rows (nrfi_decision_kind="toss_up") —
  // those have non-null predicted_nrfi and aren't in hold_picks, so they
  // remain unaffected.
  const isNrfi = pred.predicted_nrfi; // boolean | null — null when held
  // nrfiSide used for sharp_signals lookup; defensive default when null
  // doesn't affect display because nrfiPick handles null separately
  const nrfiSide: Side = isNrfi === true || isNrfi === null ? "under" : "over";
  const nrfiStatus = deriveSharpStatus(pred.nrfi_grade);
  const nrfiDecisionKind =
    typeof pred.sport_specific?.nrfi_decision_kind === "string"
      ? pred.sport_specific.nrfi_decision_kind
      : null;
  const nrfiExpectedRunsRaw =
    pred.sport_specific?.auto_factors &&
    typeof pred.sport_specific.auto_factors === "object"
      ? (pred.sport_specific.auto_factors as Record<string, unknown>).nrfi_expected_runs
      : null;
  const nrfiExpectedRuns =
    typeof nrfiExpectedRunsRaw === "number" && Number.isFinite(nrfiExpectedRunsRaw)
      ? nrfiExpectedRunsRaw
      : null;
  // Toss-Up detection only fires for non-held games. Held games always
  // route to nrfiPick=null below, regardless of decision_kind.
  const isNrfiTossUp =
    !isNrfiHeld &&
    (nrfiDecisionKind === "toss_up" ||
      (nrfiDecisionKind === null &&
        pred.nrfi_confidence !== null &&
        Math.round(pred.nrfi_confidence) === 52 &&
        nrfiExpectedRuns !== null &&
        nrfiExpectedRuns >= 0.85 &&
        nrfiExpectedRuns < 1.15));
  const nrfiPick: string | null =
    isNrfi === null ? null
      : isNrfiTossUp ? "Toss-Up"
        : isNrfi ? "NRFI"
          : "YRFI";

  // Build the (market → modelSide + grade) lookup that buildSignalDtos
  // consumes for both alignment-aware text generation and direction color.
  const signalLookup = new Map<string, MarketSignalLookup>();
  if (pred.predicted_ml_winner !== null) {
    signalLookup.set("moneyline", {
      modelSide: pred.predicted_ml_winner as Side,
      grade: pred.ml_grade,
    });
  }
  if (pred.predicted_ou_side !== null) {
    signalLookup.set("total", {
      modelSide: pred.predicted_ou_side as Side,
      grade: pred.ou_grade,
    });
  }
  if (pred.predicted_nrfi !== null) {
    signalLookup.set("first_inning_total", {
      modelSide: nrfiSide,
      grade: pred.nrfi_grade,
    });
  }

  // 4.1.10 — assemble per-market enriched MarketEdgeDto for the v13.1 UI
  // alongside the legacy `predictions` block. Each market gets its own
  // verdict / copy / quantification / keyStats. First-inning is treated
  // specially: marketDataLimited never downgrades, sharpDirection is forced
  // to "none" (V1 has no first-inning sharp data), and copy never refers
  // to splits.
  // Phase 4.2.C.2 — null confidence passes through honestly for held
  // markets. Pre-4.2.C.2 the route coerced null→0 here which surfaced as
  // "0%" on the card. The MarketEdgeDto.confidence field is now nullable
  // (lib/lab/labTypes.ts) and UI helpers render "—" for null.
  const mlConfidence: number | null =
    pred.ml_confidence === null
      ? null
      : Math.max(0, Math.min(1, pred.ml_confidence / 100));
  const ouConfidence: number | null =
    pred.ou_confidence === null
      ? null
      : Math.max(0, Math.min(1, pred.ou_confidence / 100));
  const nrfiConfidence: number | null =
    pred.nrfi_confidence === null
      ? null
      : Math.max(0, Math.min(1, pred.nrfi_confidence / 100));

  const autoFactors = extractAutoFactors(pred.sport_specific);
  const ml = buildMarketEdge({
    market: "moneyline",
    pick: mlPick,
    confidence: mlConfidence,
    grade: pred.ml_grade,
    signalType: pred.ml_signal_type,
    marketSignal: pred.ml_market_signal,
    sharpStatus: mlStatus,
    modelSide: pred.predicted_ml_winner as Side | null,
    signals,
    linesCurrent: currentLinesByGameMarket.get(`${row.id}::moneyline`) ?? [],
    lineOpen: openLinesByGameMarket.get(`${row.id}::moneyline`) ?? null,
    autoFactors,
    homeAbbr: home,
    awayAbbr: away,
    held: isMlHeld,
    sportSpecific: pred.sport_specific,
  });
  const total = buildMarketEdge({
    market: "total",
    pick: totalPick,
    confidence: ouConfidence,
    grade: pred.ou_grade,
    signalType: pred.ou_signal_type,
    marketSignal: pred.ou_market_signal,
    sharpStatus: totalStatus,
    modelSide: pred.predicted_ou_side as Side | null,
    signals,
    linesCurrent: currentLinesByGameMarket.get(`${row.id}::total`) ?? [],
    lineOpen: openLinesByGameMarket.get(`${row.id}::total`) ?? null,
    autoFactors,
    homeAbbr: home,
    awayAbbr: away,
    held: isOuHeld,
    sportSpecific: pred.sport_specific,
    totalsExtras: {
      modelTotal: pred.predicted_total,
      marketTotal: totalLine,
      sportsbookLine: totalLine,
    },
  });
  const firstInning = buildMarketEdge({
    market: "first_inning",
    pick: nrfiPick,
    confidence: nrfiConfidence,
    grade: pred.nrfi_grade,
    signalType: pred.nrfi_signal_type,
    marketSignal: pred.nrfi_market_signal,
    sharpStatus: nrfiStatus,
    modelSide: nrfiSide as Side,
    signals,
    linesCurrent: currentLinesByGameMarket.get(`${row.id}::first_inning_total`) ?? [],
    lineOpen: openLinesByGameMarket.get(`${row.id}::first_inning_total`) ?? null,
    autoFactors,
    homeAbbr: home,
    awayAbbr: away,
    held: isNrfiHeld,
    sportSpecific: pred.sport_specific,
  });

  // 4.1.10 — per-game status flags.
  const status: GameStatusDto = {
    lineupConfirmed: extractLineupConfirmed(pred.sport_specific),
    linesLocked:
      (currentLinesByGameMarket.get(`${row.id}::moneyline`)?.length ?? 0) > 0 ||
      (currentLinesByGameMarket.get(`${row.id}::total`)?.length ?? 0) > 0 ||
      (currentLinesByGameMarket.get(`${row.id}::first_inning_total`)?.length ?? 0) > 0,
    sharpSignalPending: signals.length === 0,
    marketDataLimited: computeGameMarketDataLimited({ ml, total, firstInning }),
  };

  // 4.1.10 — decision line for the v13.1 Edge Board card. Picks the strongest
  // (rank-by-grade) market and frames it directively.
  const decisionLine = buildDecisionLine({ ml, total, firstInning, awayAbbr: away, homeAbbr: home });

  // 4.1.10 — generatedAt from sport_specific.breakdown_generated_at when
  // present. Reflects WHEN the model output was last refreshed for this row.
  const generatedAt = extractGeneratedAt(pred.sport_specific);

  // Phase 4.2.B — derive lock state for the DTO surface.
  //   • scheduledLockAt = game_date minus the lock window (default 60min).
  //     This is when the per-game cron will set locked_at; the UI uses it
  //     for "Locks in 23 min" copy. If game_date is invalid this resolves
  //     to row.game_date as a defensive fallback so the UI still has a
  //     usable string to render.
  //   • lockedAt        = the actual locked_at timestamp from
  //     game_predictions. Null when the row hasn't been locked yet.
  //   • lockState       = three-state DTO enum mapped from our four-state
  //     classifier output: locked|already_started → "locked";
  //     entering_lock → "locking"; still_unlocked → "open".
  //   • updatedAt       = game_predictions.computed_at. Surfaces "when did
  //     this prediction last refresh" so the UI can render "Updated 4:12 PM".
  const lockClassification = classifyLockState(
    { locked_at: pred.locked_at, game_date: row.game_date },
    new Date()
  );
  const dtoLockState: DtoLockState =
    lockClassification === "locked" || lockClassification === "already_started"
      ? "locked"
      : lockClassification === "entering_lock"
        ? "locking"
        : "open";
  const scheduledLockAt = computeLocksAt(row.game_date) ?? row.game_date;

  // Phase R-10 — surface starter info per side. Joined from `players`
  // via games.home_pitcher_id / away_pitcher_id. Null when the probable
  // starter isn't posted yet. Handedness limited to "L" / "R" / null.
  const homeStarter = buildStarterDto(row.home_pitcher);
  const awayStarter = buildStarterDto(row.away_pitcher);

  return {
    id: `${row.sport}-${row.external_id}`,
    sport: row.sport as Sport,
    external_id: row.external_id,
    awayTeam: away,
    awayTeamLogo: awayLogo,
    homeTeam: home,
    homeTeamLogo: homeLogo,
    gameTime: formatTimeET(row.game_date),
    gameStartMinutes: minutesFromMidnightET(row.game_date),
    // Phase 4.2.B — actual lock-time ISO + per-game lock state from
    // game_predictions.locked_at. Pre-4.2.B these were placeholders.
    scheduledLockAt,
    lockState: dtoLockState,
    lockedAt: pred.locked_at,
    generatedAt,
    updatedAt: pred.computed_at,
    holdReason,
    homeStarter,
    awayStarter,
    markets: { moneyline: ml, total, first_inning: firstInning },
    decisionLine,
    status,
    result: null,
    // Phase 4.2.C.2 — legacy predictions block. Null picks and null
    // confidences pass through honestly (was `?? 0` / fake defaults
    // pre-4.2.C.2). The canonical member surface is `markets.*` above;
    // this block remains for back-compat consumers.
    predictions: {
      ml: {
        pick: mlPick,
        confidence: mlConfidence,
        sharpStatus: mlStatus,
        // V13 per-pick triplet for ML — sourced from ml_* DB columns.
        grade: pred.ml_grade,
        signalType: pred.ml_signal_type,
        marketSignal: pred.ml_market_signal,
      },
      total: {
        pick: totalPick,
        confidence: ouConfidence,
        sharpStatus: totalStatus,
        line: totalLine,
        // V13 per-pick triplet for the total — sourced from ou_* DB columns
        // (note DB ou_* ↔ DTO predictions.total name asymmetry).
        grade: pred.ou_grade,
        signalType: pred.ou_signal_type,
        marketSignal: pred.ou_market_signal,
      },
      nrfi: {
        pick: nrfiPick,
        confidence: nrfiConfidence,
        sharpStatus: nrfiStatus,
        // V13 per-pick triplet for 1st inning — sourced from nrfi_* DB columns.
        grade: pred.nrfi_grade,
        signalType: pred.nrfi_signal_type,
        marketSignal: pred.nrfi_market_signal,
      },
    },
    projected: {
      away: pred.predicted_away_score ?? 0,
      home: pred.predicted_home_score ?? 0,
    },
    sharpSignals: buildSignalDtos(signals, signalLookup, {
      homeTeamAbbr: home,
      awayTeamAbbr: away,
    }),
    // Phase 4.1.8.B — member-facing breakdown surface. Three fields:
    //   • verdict       — derived at read time from headline grade +
    //                     per-market confidences (never persisted)
    //   • sharpRead     — derived at read time from headline grade +
    //                     sharp signals (never persisted)
    //   • modelBreakdown— prefers sport_specific.breakdown_v2.model_breakdown
    //                     (v2), falls back to sport_specific.member_summary
    //                     (legacy v1) for rows that haven't been regenerated
    //                     under 4.1.8.B yet
    // operator_detail / breakdown_version / breakdown_generated_at
    // remain server-side and are never sent to the public API — this
    // function builds the DTO field-by-field; never spreads sport_specific.
    breakdown: buildBreakdownDto(pred, signals),
    // V2.1.1 (Phase 6.3.5e): legacy top-level grade / signalType /
    // marketSignal / primaryMarket dropped. Headline derivation lives in
    // perPickHeadline.ts (client-side) reading the per-pick fields below.
  };
}

// ─────────────────────────────────────────────────────────────────────
// 4.1.10 — per-market enrichment helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * R-16G-A — display-price book priority.
 *
 * Pre-R-16G-A this list was only the legacy US-tier-1 books
 * (`pinnacle/draftkings/fanduel/betmgm/caesars`), NONE of which exist
 * in our actual `lines` table at our current SharpAPI tier. The
 * function fell through to `pool.find((r) => r.odds_american !== null)`
 * — i.e. the first row in DB-return order — which could surface a
 * kalshi row (whose home/away semantics are inverted at our provider,
 * see SharpAPIOddsProvider). That is how a wrong-side price could
 * reach the reader.
 *
 * The new list:
 *   • keeps the tier-1 books at the top so future tier upgrades take
 *     priority automatically,
 *   • adds the real books actually returned at our current tier in
 *     trusted order,
 *   • excludes `kalshi` (audit found side flips; safer to omit until
 *     SharpAPI's normalization is fixed or we add a per-book sanity
 *     check),
 *   • ends with `splits_consensus` (R-16E synthetic — last resort).
 *
 * Together with `pickPriceRow`'s tightened fallback (returns null
 * instead of an arbitrary row when the priority list misses), this
 * removes the wrong-side-price path entirely.
 */
const BOOK_PRIORITY = [
  "pinnacle",
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "bet365 us",
  "bookmaker",
  "ballybet",
  "onexbet",
  "saba",
  "fliff",
  // kalshi — intentionally excluded (R-16G-A side-flip safety)
  "splits_consensus",
] as const;

/** Pick the best (by book priority + matching side) row from a candidate set. */
/**
 * R-16G-A — pick a deterministic price row from BOOK_PRIORITY.
 *
 * Returns the first row matching `preferredSide` from the highest-
 * priority trusted book in `BOOK_PRIORITY` that has a non-null
 * `odds_american`. If NO trusted book has a price for the picked
 * side, returns `null` — better to show no price than a wrong-side
 * one. This is the "fail-closed" hardening from R-16G-A audit; the
 * pre-fix code fell back to `pool.find(...)` (first row in
 * DB-return order) which could surface a kalshi flipped row.
 *
 * When `preferredSide` is null (model held), we still walk the
 * priority list across all sides and return the first trusted row.
 * Caller is expected to gate display on the model side existing.
 */
function pickPriceRow<T extends { sportsbook: string; side: string | null; odds_american: number | null }>(
  rows: T[],
  preferredSide: Side | null
): T | null {
  if (rows.length === 0) return null;
  const sideMatch = preferredSide === null ? rows : rows.filter((r) => r.side === preferredSide);
  const pool = sideMatch.length > 0 ? sideMatch : rows;
  for (const book of BOOK_PRIORITY) {
    const hit = pool.find((r) => r.sportsbook === book && r.odds_american !== null);
    if (hit) return hit;
  }
  // No trusted book had a price for this side. Return null rather
  // than an arbitrary row — better honest empty than wrong odds.
  return null;
}

function extractAutoFactors(
  ss: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!ss) return null;
  const af = ss.auto_factors;
  if (af && typeof af === "object" && af !== null) {
    return af as Record<string, unknown>;
  }
  return null;
}

function extractLineupConfirmed(
  ss: Record<string, unknown> | null | undefined
): boolean | null {
  if (!ss) return null;
  const v = ss.lineup_confirmed;
  if (v === true || v === false) return v;
  return null;
}

function extractGeneratedAt(
  ss: Record<string, unknown> | null | undefined
): string | null {
  if (!ss) return null;
  const v = ss.breakdown_generated_at;
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

/**
 * Derive `sharpDirection` for a single market from sharp_signals + the
 * model's picked side. "support" when a +EV row exists on the same side;
 * "push_against" when sharp signals back the OPPOSITE side; "none"
 * otherwise. First_inning callers should pass an empty signals array;
 * the helper returns "none".
 */
function deriveSharpDirection(
  signals: SignalRow[],
  marketDbKey: "moneyline" | "total" | "first_inning_total",
  modelSide: Side | null
): SharpDirection {
  if (modelSide === null) return "none";
  const relevant = signals.filter((s) => s.market_type === marketDbKey);
  if (relevant.length === 0) return "none";

  // Look for ANY +EV signal on the same side OR opposite side. Same-side
  // is "support"; opposite is "push_against".
  const sameSide = relevant.find((s) => s.side === modelSide && s.is_plus_ev === true);
  if (sameSide !== undefined) return "support";
  const oppositeSide = relevant.find((s) => s.side !== modelSide && s.is_plus_ev === true);
  if (oppositeSide !== undefined) return "push_against";
  return "none";
}

/**
 * 4.1.10 — short technical phrase to surface as the "primary driver"
 * in whyLine. Picked greedily from auto_factors based on which factor
 * is most extreme. Returns null when no factor is dominant enough.
 */
function pickModelDriver(
  af: Record<string, unknown> | null,
  market: "moneyline" | "total" | "first_inning"
): string | null {
  if (!af) return null;
  const n = (k: string): number | null => {
    const v = af[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  if (market === "moneyline") {
    const hsf = n("home_starter_era_factor");
    const asf = n("away_starter_era_factor");
    if (hsf !== null && asf !== null && Math.abs(hsf - asf) > 0.1) {
      return "starter ERA edge";
    }
    const hlf = n("home_lineup_ops_factor_adjusted");
    const alf = n("away_lineup_ops_factor_adjusted");
    if (hlf !== null && alf !== null && Math.abs(hlf - alf) > 0.06) {
      return "lineup-vs-starter matchup";
    }
    return null;
  }
  if (market === "total") {
    const park = n("park_factor_runs");
    if (park !== null && Math.abs(park - 1) > 0.07) {
      return park > 1 ? "hitter-friendly park" : "pitcher-friendly park";
    }
    const w = n("weather_total_adjust");
    if (w !== null && Math.abs(w) > 0.25) {
      return w > 0 ? "weather favors offense" : "weather suppresses offense";
    }
    return null;
  }
  // first_inning
  const fiRuns = n("nrfi_expected_runs");
  if (fiRuns !== null && (fiRuns < 0.7 || fiRuns > 1.1)) {
    return fiRuns < 0.7
      ? "low projected 1st-inning runs"
      : "elevated projected 1st-inning runs";
  }
  const top = af.nrfi_used_top_of_order_data;
  if (top === true) return "confirmed top-of-order matchup";
  return null;
}

function pickRiskDriver(
  af: Record<string, unknown> | null,
  market: "moneyline" | "total" | "first_inning"
): string | null {
  if (!af) return null;
  const n = (k: string): number | null => {
    const v = af[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  if (market === "moneyline") {
    const hb = n("home_bullpen_factor");
    const ab = n("away_bullpen_factor");
    // "Risk" = the WORSE bullpen for the side we'd be backing. Without knowing
    // which side, just flag any clearly bad bullpen as a risk.
    if (hb !== null && hb > 1.1) return "home bullpen below league average";
    if (ab !== null && ab > 1.1) return "away bullpen below league average";
    return null;
  }
  if (market === "total") {
    const w = n("weather_total_adjust");
    if (w !== null && Math.abs(w) > 0.4) {
      return "weather effect could shift the line";
    }
    return null;
  }
  // first_inning
  const top = af.nrfi_used_top_of_order_data;
  if (top === false || top === null || top === undefined) {
    return "top-of-order data not yet confirmed";
  }
  return null;
}

type BuildMarketEdgeInput = {
  market: "moneyline" | "total" | "first_inning";
  pick: string | null;
  /**
   * Phase 4.2.C.2 — null when this market is held by the auto-model.
   * Pre-4.2.C.2 callers coerced null to 0 with `?? 0`, which surfaced
   * as a misleading "0%" label. The DTO now passes null through honestly
   * and the UI renders "—" for held confidence.
   */
  confidence: number | null;
  grade: Grade | null;
  signalType: SignalType | null;
  marketSignal: MarketSignal | null;
  sharpStatus: SharpStatus;
  modelSide: Side | null;
  signals: SignalRow[];
  linesCurrent: LineRow[];
  lineOpen: LineHistoryRow | null;
  autoFactors: Record<string, unknown> | null;
  homeAbbr: string;
  awayAbbr: string;
  /**
   * Phase 4.2.C.2 — true when this specific market is in the auto-model's
   * hold_picks list. Surfaces to MarketEdgeDto.held so the UI renders
   * "Held" instead of a fake default pick.
   */
  held: boolean;
  /** Totals-only — when supplied, modelTotal/marketTotal/line get populated. */
  totalsExtras?: {
    modelTotal: number | null;
    marketTotal: number | null;
    sportsbookLine: number | null;
  };
  /**
   * R-14C1 — full sport_specific JSONB. Used to extract `review_v1`
   * (reviewer audit record) for the Model/Market/Take strip. Optional
   * for backward compatibility with callers that don't surface review
   * metadata. Never spread into the DTO — only specific fields are
   * extracted via the typed helper.
   */
  sportSpecific?: Record<string, unknown> | null;
};

// ─────────────────────────────────────────────────────────────
// Phase 4.2.C.1.R-14C1 / R-16E / R-16F-D — Model / Market / Take strip
// ─────────────────────────────────────────────────────────────
// R-16F-D — no-vig math + book priority extracted to
// `app/lab/lib/marketImplied.ts` so it can be unit-tested without
// setting up the full DTO build path. The route still owns invocation
// + DTO wiring; the helper module owns the math.
//
// The extracted version also dropped the `market === "first_inning"`
// short-circuit so the same no-vig path runs for FI markets whenever
// two-sided FI odds exist in `lines` (R-16F-C captured these rows).
// The `modelSide === null` guard remains — held / toss-up picks still
// honestly return "unavailable".

/**
 * Extract review flags + per-market action from `sport_specific.review_v1`.
 * Returns "keep" + [] when the reviewer didn't run for this row.
 */
function extractReviewMeta(
  ss: Record<string, unknown> | null | undefined,
  market: "moneyline" | "total" | "first_inning"
): {
  flags: string[];
  action:
    | "keep"
    | "cap_confidence"
    | "hold"
    | "adjust_score_toward_market"
    | "flip_side"
    | "dampen_confidence"
    | "downgrade_grade";
} {
  if (!ss || typeof ss !== "object") {
    return { flags: [], action: "keep" };
  }
  const review = (ss as { review_v1?: unknown }).review_v1;
  if (!review || typeof review !== "object") {
    return { flags: [], action: "keep" };
  }
  const r = review as Record<string, unknown>;
  const flags = Array.isArray(r.flags) ? (r.flags as string[]) : [];
  const actions = (r.actions ?? {}) as Record<string, unknown>;
  const marketKey =
    market === "moneyline" ? "ml" : market === "total" ? "ou" : "nrfi";
  const raw = actions[marketKey];
  const allowed = new Set([
    "keep",
    "cap_confidence",
    "hold",
    "adjust_score_toward_market",
    "flip_side",
    "dampen_confidence",
    "downgrade_grade",
  ]);
  const action =
    typeof raw === "string" && allowed.has(raw)
      ? (raw as
          | "keep"
          | "cap_confidence"
          | "hold"
          | "adjust_score_toward_market"
          | "flip_side"
          | "dampen_confidence"
          | "downgrade_grade")
      : "keep";
  return { flags, action };
}

/**
 * R-16I Phase 1 — translate the reviewer's flag array into per-market
 * `ReviewerSignals` consumed by `marketVerdictFor`. The reviewer's flag
 * array is global (not per-market) so each market consumes only the
 * flags that apply to it.
 *
 * Mapping today:
 *   total      → sharpConflict ← "ou_sharp_conflict"
 *   moneyline  → publicSmokeAligned ← "public_smoke_aligned_with_pick"
 *                hasFragilityFlag  ← any of the 4 strong fragility flags
 *   first_inning → all false (V1 has no FI-side reviewer surface)
 *
 * Note: `review_recommends_caution` is the reviewer's POST-cap label
 * (synthesized when STRONG_INTERVENTION_CAP fires). It's intentionally
 * NOT counted here — the cap already takes ML confidence to 52% which
 * routes to no_play via the existing confidence floor, so re-flagging
 * the same condition would double-downgrade.
 */
const STRONG_FRAGILITY_ML_FLAGS = new Set<string>([
  "extreme_run_diff_with_coinflip_market",
  "small_sample_starter_driver",
  "raw_conf_extreme_fragile",
  "huge_model_market_gap",
]);

function deriveReviewerSignals(
  flags: string[],
  market: "moneyline" | "total" | "first_inning"
): ReviewerSignals {
  if (market === "total") {
    return {
      sharpConflict: flags.includes("ou_sharp_conflict"),
      publicSmokeAligned: false,
      hasFragilityFlag: false,
    };
  }
  if (market === "moneyline") {
    return {
      sharpConflict: false,
      publicSmokeAligned: flags.includes("public_smoke_aligned_with_pick"),
      hasFragilityFlag: flags.some((f) => STRONG_FRAGILITY_ML_FLAGS.has(f)),
    };
  }
  // first_inning — no reviewer-derived warnings in V1.
  return {
    sharpConflict: false,
    publicSmokeAligned: false,
    hasFragilityFlag: false,
  };
}

function buildMarketEdge(input: BuildMarketEdgeInput): MarketEdgeDto {
  // DB key — the JSONB uses "first_inning_total" for the FI market.
  const dbMarket: "moneyline" | "total" | "first_inning_total" =
    input.market === "first_inning" ? "first_inning_total" : input.market;

  // Sharp direction (per-market, forced "none" for first_inning by the
  // verdict helper but useful here too for copy phrasing).
  const sharpDirection: SharpDirection =
    input.market === "first_inning"
      ? "none"
      : deriveSharpDirection(input.signals, dbMarket, input.modelSide);

  // Pricing — best available American odds for the picked side.
  const priceRow = pickPriceRow(input.linesCurrent, input.modelSide);
  const priceAmerican = priceRow?.odds_american ?? null;

  // First-seen line for the same side.
  const openAmerican: number | null = (() => {
    if (input.lineOpen === null) return null;
    if (input.modelSide !== null && input.lineOpen.side !== input.modelSide) {
      return null;
    }
    return input.lineOpen.odds_american;
  })();

  // Per-market signal-derived quantitative fields. Pick the +EV signal on
  // the model's side (preferred), falling back to ANY signal for this
  // market-side. nulls allowed when no signal row exists.
  const sigForSide =
    input.modelSide !== null
      ? input.signals.find(
          (s) => s.market_type === dbMarket && s.side === input.modelSide
        ) ?? null
      : input.signals.find((s) => s.market_type === dbMarket) ?? null;

  const marketFairProb = sigForSide?.pinnacle_fair_probability ?? null;
  const pinnacleEvPct = sigForSide?.ev_pct ?? null;
  const moneyPct = sigForSide?.public_money_pct ?? null;
  const betsPct = sigForSide?.public_betting_pct ?? null;

  // marketDataLimited rule diverges per Daniel's adjustment #3:
  //   ML/Total:     true when EVERY quant field is null (no quantitative data)
  //   first_inning: true only when BOTH priceAmerican is null AND
  //                 nrfi_expected_runs is null (truly nothing to show)
  const marketDataLimited =
    input.market === "first_inning"
      ? priceAmerican === null &&
        (input.autoFactors === null ||
          input.autoFactors.nrfi_expected_runs === null ||
          input.autoFactors.nrfi_expected_runs === undefined)
      : pinnacleEvPct === null &&
        marketFairProb === null &&
        moneyPct === null &&
        betsPct === null &&
        openAmerican === null;

  // Reviewer trail from sport_specific.review_v1 (R-16 wiring). Hoisted
  // above the verdict call so R-16I Phase 1 can route reviewer signals
  // into marketVerdictFor.
  const reviewMeta = extractReviewMeta(input.sportSpecific, input.market);

  // Per-market verdict.
  //
  // Phase 4.2.C.2 — held markets route to "no_play" directly. The
  // marketVerdictFor function takes a numeric confidence, so we'd need
  // to pass 0 anyway when confidence is null; the floor checks would
  // route a 0-confidence call to no_play. The short-circuit here is
  // explicit and avoids passing misleading 0 values through the verdict
  // engine for held markets.
  //
  // R-16I Phase 1 — derive reviewer-authority signals from the flag
  // array we already extracted via extractReviewMeta. The reviewer's
  // intelligence (ou_sharp_conflict, public_smoke_aligned_with_pick,
  // single-flag fragility) flows into the verdict layer here so the
  // final user-facing verdict reflects what the reviewer actually saw,
  // not just what the grade column happens to hold.
  const reviewerSignals = deriveReviewerSignals(
    reviewMeta.flags,
    input.market
  );
  const verdict: { key: MarketVerdict; label: string } =
    input.held || input.confidence === null
      ? { key: "no_play", label: "No Play" }
      : marketVerdictFor({
          market: input.market,
          confidence: input.confidence,
          grade: input.grade ?? ("market_watch" as Grade),
          sharpDirection,
          marketDataLimited,
          reviewerSignals,
        });

  // Server-generated copy (banned-terms-linted at output time).
  const modelDriver = pickModelDriver(input.autoFactors, input.market);
  const riskDriver = pickRiskDriver(input.autoFactors, input.market);
  // Phase 4.2.C.2 — held markets pass 0 confidence to the copy generator.
  // generatePerMarketCopy takes a numeric confidence; held markets always
  // route to verdict="no_play" (short-circuit above) so the no_play
  // template fires regardless of the confidence value.
  const copy = generatePerMarketCopy({
    market: input.market,
    verdict: verdict.key,
    pick: input.pick ?? "—",
    confidence: input.confidence ?? 0,
    sharpDirection,
    modelDriver,
    riskDriver,
    marketDataLimited,
  });

  // KeyStats.
  const keyStats = formatKeyStats(input.autoFactors, input.market);

  // Phase R-13C — two-sided publicSplits. The pre-R-13C scalars
  // (moneyPct / betsPct above) carry only the picked side's data, so
  // the reader's MarketPulse panel was pick-centered. Build an array
  // covering both sides for this (game, market) from the same
  // signal rows the picker uses. FI returns [] because /splits
  // doesn't cover first_inning_total — UI keeps the provider-
  // limitation copy already in place.
  const publicSplits = buildPublicSplits({
    market: input.market,
    dbMarket,
    signals: input.signals,
    homeAbbr: input.homeAbbr,
    awayAbbr: input.awayAbbr,
    totalsLine: input.totalsExtras?.sportsbookLine ?? null,
  });

  // ── R-14C1 — Model / Market / Take strip fields ────────────────
  // modelTrustPct mirrors `confidence` on a 0..100 scale for the strip
  // (the existing `confidence` field is 0..1 to match
  // DailyEdgePredictionDto.confidence). Null when held.
  const modelTrustPct = input.confidence !== null ? input.confidence * 100 : null;
  // marketImplied: compute no-vig from a two-sided book; fall back to
  // Pinnacle fair-prob from sharp_signals when no book has both sides.
  const implied = computeMarketImplied(
    input.market,
    dbMarket,
    input.linesCurrent,
    input.modelSide,
    marketFairProb,
  );
  const marketImpliedPct = implied.pickPct;
  const marketSource = implied.source;
  const marketDataQuality = implied.quality;
  const modelMarketGapPct =
    modelTrustPct !== null && marketImpliedPct !== null
      ? +(modelTrustPct - marketImpliedPct).toFixed(1)
      : null;

  return {
    pick: input.pick,
    confidence: input.confidence,
    grade: input.grade,
    signalType: input.signalType,
    marketSignal: input.marketSignal,
    sharpStatus: input.sharpStatus,
    held: input.held,
    verdict,
    guidedGuide: copy.guidedGuide,
    guidedWatchOut: copy.guidedWatchOut,
    whyLine: copy.whyLine,
    riskLine: copy.riskLine,
    modelProb: input.confidence,        // already 0-1 by the caller; null for held
    marketFairProb,
    pinnacleEvPct,
    moneyPct,
    betsPct,
    publicSplits,
    priceAmerican,
    lineOpenAmerican: openAmerican,
    modelTotal: input.totalsExtras?.modelTotal ?? null,
    marketTotal: input.totalsExtras?.marketTotal ?? null,
    line: input.totalsExtras?.sportsbookLine ?? null,
    keyStats,
    // R-14C1 additions
    modelTrustPct,
    marketImpliedPct,
    modelMarketGapPct,
    marketSource,
    marketDataQuality,
    reviewFlags: reviewMeta.flags,
    reviewActionSummary: reviewMeta.action,
  };
}

/**
 * Phase R-13C — assemble the two-sided publicSplits array for one
 * (game, market). Returns the picked-side row first when the model
 * has a side, then the opposing side, so the reader can render in a
 * stable order (pick on the left).
 *
 * Side label conventions:
 *   moneyline / spread → home/away abbreviation (PHI / SD)
 *   total              → "Over" / "Under"
 *   first_inning       → [] (provider doesn't offer; UI shows the
 *                            existing limitation copy)
 */
function buildPublicSplits(args: {
  market: "moneyline" | "total" | "first_inning";
  dbMarket: "moneyline" | "total" | "first_inning_total";
  signals: SignalRow[];
  homeAbbr: string;
  awayAbbr: string;
  totalsLine: number | null;
}): MarketEdgeDto["publicSplits"] {
  if (args.market === "first_inning") return [];

  const rows = args.signals.filter((s) => s.market_type === args.dbMarket);
  if (rows.length === 0) return [];

  const labelFor = (side: string): { side: "home" | "away" | "over" | "under"; label: string } | null => {
    if (args.market === "moneyline") {
      if (side === "home") return { side: "home", label: args.homeAbbr };
      if (side === "away") return { side: "away", label: args.awayAbbr };
      return null;
    }
    if (args.market === "total") {
      if (side === "over") return { side: "over", label: "Over" };
      if (side === "under") return { side: "under", label: "Under" };
      return null;
    }
    return null;
  };

  // Build the side rows in canonical order so the UI render order is
  // deterministic regardless of provider row ordering.
  const canonicalOrder: ReadonlyArray<"home" | "away" | "over" | "under"> =
    args.market === "moneyline" ? ["home", "away"] : ["over", "under"];

  const out: MarketEdgeDto["publicSplits"] = [];
  for (const side of canonicalOrder) {
    const sig = rows.find((r) => r.side === side);
    const meta = labelFor(side);
    if (meta === null) continue;
    out.push({
      side: meta.side,
      label: meta.label,
      moneyPct: sig?.public_money_pct ?? null,
      betsPct: sig?.public_betting_pct ?? null,
    });
  }
  // Drop rows where BOTH money and bets are null AND no row existed —
  // i.e. the side wasn't reported at all. Keep partial-coverage rows.
  return out.filter((r) => r.moneyPct !== null || r.betsPct !== null || rows.find((sig) => sig.side === r.side) !== undefined);
}

/**
 * 4.1.10 — true when every market lacks quantitative data. For first_inning,
 * its own marketDataLimited rule applies (see buildMarketEdge); the game-level
 * status field combines all three.
 */
function computeGameMarketDataLimited(args: {
  ml: MarketEdgeDto;
  total: MarketEdgeDto;
  firstInning: MarketEdgeDto;
}): boolean {
  const nullish = (m: MarketEdgeDto) =>
    m.pinnacleEvPct === null &&
    m.marketFairProb === null &&
    m.moneyPct === null &&
    m.betsPct === null &&
    m.lineOpenAmerican === null &&
    m.priceAmerican === null;
  return nullish(args.ml) && nullish(args.total) && nullish(args.firstInning);
}

/**
 * 4.1.10 — short directive sentence for the v13.1 Edge Board card. Picks
 * the strongest verdict across the three markets and frames it. Banned-
 * terms-linted at output.
 */
function buildDecisionLine(args: {
  ml: MarketEdgeDto;
  total: MarketEdgeDto;
  firstInning: MarketEdgeDto;
  awayAbbr: string;
  homeAbbr: string;
}): string {
  const verdictRank: Record<MarketVerdict, number> = {
    best_angle: 4,
    lean: 3,
    watchlist: 2,
    caution: 1,
    no_play: 0,
  };
  const candidates: Array<{ m: MarketEdgeDto; label: string }> = [
    { m: args.ml, label: "moneyline" },
    { m: args.total, label: "total" },
    { m: args.firstInning, label: "1st inning" },
  ];
  candidates.sort((a, b) => verdictRank[b.m.verdict.key] - verdictRank[a.m.verdict.key]);
  const top = candidates[0]!;
  const pick = top.m.pick ?? "—";
  let line: string;
  if (top.m.verdict.key === "best_angle") {
    line = `Best angle tonight: ${pick} on the ${top.label}.`;
  } else if (top.m.verdict.key === "lean") {
    line = `Lean toward ${pick} on the ${top.label}.`;
  } else if (top.m.verdict.key === "watchlist") {
    line = `On the watchlist: ${pick} on the ${top.label}.`;
  } else if (top.m.verdict.key === "caution") {
    line = `Caution flagged on the ${top.label} — model and market disagree.`;
  } else {
    line = `No clean play on this slate.`;
  }
  assertNoBannedTerms(line, "decisionLine");
  return line;
}

/**
 * Phase 4.1.8.B — Extracts the model-side breakdown prose from a
 * prediction's sport_specific JSONB. Reader-tolerant: prefers the v2
 * namespace (`sport_specific.breakdown_v2.model_breakdown`), falls back
 * to the legacy v1 single-blob (`sport_specific.member_summary`) for
 * rows that haven't been regenerated under Phase 4.1.8.B yet.
 *
 * Returns null when:
 *   • sport_specific is null/missing (older predictions)
 *   • Neither breakdown_v2.model_breakdown nor member_summary is a
 *     non-empty string
 *
 * Operator-only keys (operator_detail, breakdown_version,
 * breakdown_generated_at) are intentionally ignored — they never appear
 * in the member API response.
 */
function extractModelBreakdown(
  sportSpecific: Record<string, unknown> | null | undefined
): string | null {
  if (!sportSpecific) return null;

  // Prefer v2.
  const v2 = sportSpecific.breakdown_v2;
  if (v2 && typeof v2 === "object" && v2 !== null) {
    const mb = (v2 as Record<string, unknown>).model_breakdown;
    if (typeof mb === "string" && mb.length > 0) return mb;
  }

  // Fall back to legacy member_summary.
  const legacy = sportSpecific.member_summary;
  if (typeof legacy === "string" && legacy.length > 0) return legacy;

  return null;
}

/**
 * Phase 4.1.8.B — headline-grade derivation for verdict computation.
 *
 * Mirrors the ranking logic in app/lab/lib/perPickHeadline.ts exactly,
 * inlined here per Sub-D2: keep 4.1.8.B scope tight; consolidation
 * deferred to 4.1.8.C. Tests verify both implementations stay in sync.
 *
 * Ranking: GRADE_RANK descending, ML → OU → NRFI precedence on ties.
 * Returns null grade + null market when the model picked no markets
 * (all three per-pick grades null).
 */
const GRADE_RANK: Record<Grade, number> = {
  best_signal: 70,
  sharp_confirmed: 60,
  sharp_conflict: 50,
  market_led: 40,
  public_smoke: 30,
  model_only: 20,
  market_watch: 10,
};

function deriveVerdictForRow(pred: PredictionRow): {
  headlineGrade: Grade | null;
  headlineMarket: SharpReadMarket | null;
  verdict: Verdict;
} {
  const candidates: Array<{
    grade: Grade;
    market: SharpReadMarket;
    precedence: number;
  }> = [];
  if (pred.ml_grade !== null) {
    candidates.push({ grade: pred.ml_grade, market: "ml", precedence: 0 });
  }
  if (pred.ou_grade !== null) {
    candidates.push({ grade: pred.ou_grade, market: "total", precedence: 1 });
  }
  if (pred.nrfi_grade !== null) {
    candidates.push({ grade: pred.nrfi_grade, market: "nrfi", precedence: 2 });
  }
  candidates.sort((a, b) => {
    const r = GRADE_RANK[b.grade] - GRADE_RANK[a.grade];
    if (r !== 0) return r;
    return a.precedence - b.precedence;
  });

  const headline = candidates[0] ?? null;
  const headlineGrade = headline?.grade ?? null;
  const headlineMarket = headline?.market ?? null;

  const verdict = deriveVerdict({
    headlineGrade,
    perMarketConfidence: {
      ml: pred.ml_confidence !== null ? pred.ml_confidence / 100 : null,
      total: pred.ou_confidence !== null ? pred.ou_confidence / 100 : null,
      nrfi: pred.nrfi_confidence !== null ? pred.nrfi_confidence / 100 : null,
    },
  });
  return { headlineGrade, headlineMarket, verdict };
}

/**
 * Project the row's sharp_signals into the minimal {market, direction}
 * shape that sharpReadSelector consumes. Direction is derived from the
 * matching per-market grade (mirrors deriveDirection on the SharpSignalDto
 * side — both surfaces compute direction from grade, not from raw signal
 * row fields).
 */
function projectSharpSignalsForRead(
  signals: SignalRow[],
  pred: PredictionRow
): SharpSignalProjection[] {
  return signals.map((s) => {
    let market: SharpReadMarket;
    let gradeForMarket: Grade | null;
    if (s.market_type === "moneyline") {
      market = "ml";
      gradeForMarket = pred.ml_grade;
    } else if (s.market_type === "total") {
      market = "total";
      gradeForMarket = pred.ou_grade;
    } else {
      market = "nrfi";
      gradeForMarket = pred.nrfi_grade;
    }
    return { market, direction: deriveDirection(gradeForMarket) };
  });
}

/**
 * Phase 4.1.8.B — assemble the breakdown DTO field. ALWAYS returns a
 * populated object — verdict + sharpRead derive deterministically from
 * the row's grades + signals (with "no_play" / "no_data" branches for
 * empty states). modelBreakdown is the only field that can be null.
 */
function buildBreakdownDto(
  pred: PredictionRow,
  signals: SignalRow[]
): DailyEdgeGameDto["breakdown"] {
  const { headlineGrade, headlineMarket, verdict } = deriveVerdictForRow(pred);

  const sharpProjection = projectSharpSignalsForRead(signals, pred);
  const sharpReadKey = selectSharpReadKey({
    headlineGrade,
    headlineMarket,
    sharpSignals: sharpProjection,
  });

  return {
    verdict: { key: verdict, label: VERDICT_LABEL[verdict] },
    sharpRead: {
      key: sharpReadKey,
      sentence: SHARP_READ_SENTENCES[sharpReadKey],
    },
    modelBreakdown: extractModelBreakdown(pred.sport_specific),
  };
}

// Exported for unit-test access (mirrors the __TEST__ pattern in
// featureSnapshot.ts). Production callers go through the GET handler.
export const __TEST__ = {
  buildGameDto,
  extractModelBreakdown,
  deriveVerdictForRow,
  projectSharpSignalsForRead,
  buildBreakdownDto,
  GRADE_RANK,
};

// ───────────────────────────────────────────────────────────────────────────
// Route handler
// ───────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sportParam = url.searchParams.get("sport");
  const dateParam = url.searchParams.get("date");
  // R-19 Phase 1 (C7) — explicit opt-in for stale-slate fallback. Default
  // (no param, or any value other than "true") = no fallback; route
  // surfaces an explicit pending/empty state via `slateState`. Callers
  // that genuinely want "show me whatever's most recent" pass
  // `?allowStale=true` and accept the labeled stale response.
  const allowStale = url.searchParams.get("allowStale") === "true";

  const sport: Sport =
    sportParam && (VALID_SPORTS as string[]).includes(sportParam)
      ? (sportParam as Sport)
      : "mlb";

  // Resolve the requested slate_date. Explicit ?date= wins; otherwise today's
  // slate in the sport's anchor timezone (ET for North American, London for UCL).
  const requestedDate = isSlateDate(dateParam) ? dateParam : currentSlateDate(sport);

  // Non-live sports return empty — UI's ComingSoonState handles the message.
  if (!LIVE_SPORTS.includes(sport)) {
    const body: DailyEdgeResponse = {
      as_of: new Date().toISOString(),
      sport,
      date: requestedDate,
      requested_date: requestedDate,
      fallback_used: false,
      slateState: "no_data",
      slate_status: null,
      last_slate_update_at: null,
      games: [],
    };
    return Response.json(body, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  }

  // ─── R-19 Phase 1 (C7) — slate-state resolution ──────────────────────
  //
  // Step 1: probe the requested date for every `slate_status` row. The
  // determineSlateState helper classifies into one of six states based
  // on what (if anything) lives on the requested date.
  const { data: probeRows } = await supabase
    .from("games")
    .select("slate_status")
    .eq("sport", sport)
    .eq("slate_date", requestedDate);

  // Step 2: only query for the fallback when the caller opted in. The
  // helper handles all branches; when allowStale=false we pass null so
  // there is no silent fallback path.
  let mostRecentVisibleFallback:
    | { slate_date: string; slate_status: string }
    | null = null;
  if (allowStale) {
    const { data: latest } = await supabase
      .from("games")
      .select("slate_date, slate_status")
      .eq("sport", sport)
      .neq("slate_date", requestedDate)
      .in("slate_status", [...VISIBLE_SLATE_STATUSES])
      .order("slate_date", { ascending: false })
      .limit(1);
    const row = (latest ?? [])[0];
    if (row) {
      mostRecentVisibleFallback = {
        slate_date: row.slate_date,
        slate_status: row.slate_status,
      };
    }
  }

  const slateResult = determineSlateState({
    requestedDate,
    rowsForRequestedDate: (probeRows ?? []) as Array<{ slate_status: string }>,
    mostRecentVisibleFallback,
    allowStale,
  });
  const effectiveDate = slateResult.effectiveDate;

  // Step 3: when no games to render (pending / draft-only / hidden-only /
  // no_data), short-circuit with an explicit empty response. The UI
  // reads `slateState` to render honest copy. Avoids the heavy join
  // queries when there's nothing to display.
  if (!slateResult.shouldFetchGames) {
    const body: DailyEdgeResponse = {
      as_of: new Date().toISOString(),
      sport,
      date: effectiveDate,
      requested_date: requestedDate,
      fallback_used: false,
      slateState: slateResult.slateState,
      slate_status: slateResult.slate_status,
      last_slate_update_at: null,
      games: [],
    };
    return Response.json(body, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  }

  // ─── Games + teams + predictions (one round-trip) ────────────────────────
  // VISIBLE_SLATE_STATUSES gates draft / hidden slates out of member view per
  // V2.1 Part 9. Both the resolver (above) and this query use the same filter
  // so the response is consistent across the date fallback path.
  const { data: gameData, error: gamesErr } = await supabase
    .from("games")
    .select(
      `id, external_id, sport, game_date, slate_date, updated_at,
       home_team:home_team_id (abbreviation, logo_url),
       away_team:away_team_id (abbreviation, logo_url),
       home_pitcher:home_pitcher_id (first_name, last_name, throws),
       away_pitcher:away_pitcher_id (first_name, last_name, throws),
       game_predictions (
         source_type,
         predicted_home_score, predicted_away_score, predicted_total,
         predicted_ml_winner, ml_confidence,
         predicted_ou_side, ou_confidence,
         predicted_nrfi, nrfi_confidence,
         ml_grade, ml_signal_type, ml_market_signal,
         ou_grade, ou_signal_type, ou_market_signal,
         nrfi_grade, nrfi_signal_type, nrfi_market_signal,
         sport_specific,
         computed_at, locked_at
       )`
    )
    .eq("sport", sport)
    .eq("slate_date", effectiveDate)
    .in("slate_status", [...VISIBLE_SLATE_STATUSES])
    .order("game_date", { ascending: true });

  if (gamesErr) {
    return Response.json({ error: gamesErr.message }, { status: 500 });
  }

  // Supabase typegen renders FK expansions as arrays; runtime returns the
  // single object for to-one relations. Cast accordingly.
  const rawGames = (gameData ?? []) as unknown as GameRow[];

  // ─── Production data-mode filter (Framework §"Signal Source Quality") ──
  // Drops mock-sourced predictions before they reach members. No-op in
  // dev / preview modes; activated by ODDSPHERE_DATA_MODE=production.
  // TODO Gap-25: sharp_signals table needs source_type column. Currently
  // transitively safe because mock predictions get filtered here, before
  // their sharp_signals are even joined below.
  const games = filterMockSourceRows(
    rawGames,
    (g) => g.game_predictions?.source_type
  );

  // ─── Sharp signals for these games (batched) ─────────────────────────────
  const gameIds = games.map((g) => g.id);
  let signalsByGame = new Map<number, SignalRow[]>();
  // Sportsbook total lines per game (5F.1). Prefer Pinnacle as the de-vig
  // reference; fall back to DraftKings, then the first book we see.
  const totalLineByGame = new Map<number, number>();
  // 4.1.10 — per-market price + open price for the v13.1 Edge Stack.
  const currentLinesByGameMarket = new Map<string, LineRow[]>();
  const openLinesByGameMarket = new Map<string, LineHistoryRow>();
  if (gameIds.length > 0) {
    const { data: signalData, error: sigErr } = await supabase
      .from("sharp_signals")
      .select(
        // Fix 4.1: dropped signal_strength + signal_summary — those legacy
      // DB columns are orphaned post-Fix-4.1 (V15 future migration drops
      // them). sharpStatus and description now derive at response time
      // from the per-pick grade + classifyEvidence + generateSignalSummary.
      "game_id, market_type, side, pinnacle_fair_probability, is_plus_ev, ev_pct, has_steam_move, steam_detected_at, steam_books_count, has_reverse_line_movement, rlm_direction, public_betting_pct, public_money_pct, computed_at"
      )
      .in("game_id", gameIds);
    if (sigErr) {
      return Response.json({ error: sigErr.message }, { status: 500 });
    }
    for (const row of (signalData ?? []) as SignalRow[]) {
      const arr = signalsByGame.get(row.game_id) ?? [];
      arr.push(row);
      signalsByGame.set(row.game_id, arr);
    }

    // 4.1.10 — pull lines for ALL three game-level markets, with odds_american
    // and side, so per-market priceAmerican + the totals line both come from
    // the same fetch. Player-prop rows are filtered server-side via player_id IS NULL.
    const { data: lineData, error: lineErr } = await supabase
      .from("lines")
      .select(
        "game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at"
      )
      .in("game_id", gameIds)
      .in("market_type", ["moneyline", "total", "first_inning_total"])
      .is("player_id", null);
    if (lineErr) {
      return Response.json({ error: lineErr.message }, { status: 500 });
    }
    // Group by game, then pick the preferred book per game.
    const totalsByGame = new Map<number, Array<{ sportsbook: string; line_value: number | null }>>();
    for (const row of (lineData ?? []) as LineRow[]) {
      const key = `${row.game_id}::${row.market_type}`;
      const arr = currentLinesByGameMarket.get(key) ?? [];
      arr.push(row);
      currentLinesByGameMarket.set(key, arr);

      // Maintain the legacy totals-line map for predictions.total.line.
      if (row.market_type === "total") {
        const tot = totalsByGame.get(row.game_id) ?? [];
        tot.push({ sportsbook: row.sportsbook, line_value: row.line_value });
        totalsByGame.set(row.game_id, tot);
      }
    }
    // R-16G-A — totals-line selection now uses the same hardened
    // BOOK_PRIORITY as `pickPriceRow`. The pre-fix fallback to "any row
    // with a line_value" was untrusted; the new behavior returns null
    // when no trusted book has the line (rather than an arbitrary
    // book's value).
    for (const [gameId, rows] of totalsByGame.entries()) {
      let chosen: number | null = null;
      for (const book of BOOK_PRIORITY) {
        const hit = rows.find((r) => r.sportsbook === book && r.line_value !== null);
        if (hit) { chosen = hit.line_value!; break; }
      }
      if (chosen !== null) totalLineByGame.set(gameId, chosen);
    }

    // 4.1.10 — per-game-market first-seen line price for `lineOpenAmerican`.
    // Per Daniel's direction (4.1.9.B section 10): use MIN(recorded_at) as
    // the "first seen" since linesService hardcodes is_opener=false.
    const { data: histData, error: histErr } = await supabase
      .from("line_history")
      .select("game_id, market_type, sportsbook, side, odds_american, recorded_at")
      .in("game_id", gameIds)
      .in("market_type", ["moneyline", "total", "first_inning_total"])
      .is("player_id", null)
      .order("recorded_at", { ascending: true });
    if (histErr) {
      return Response.json({ error: histErr.message }, { status: 500 });
    }
    for (const row of (histData ?? []) as LineHistoryRow[]) {
      // First seen wins (ASC order, first insert sticks).
      const key = `${row.game_id}::${row.market_type}`;
      if (!openLinesByGameMarket.has(key)) {
        openLinesByGameMarket.set(key, row);
      }
    }
  }

  // ─── Assemble DTOs ───────────────────────────────────────────────────────
  const dtos: DailyEdgeGameDto[] = [];
  for (const g of games) {
    const dto = buildGameDto(
      g,
      signalsByGame.get(g.id) ?? [],
      totalLineByGame.get(g.id) ?? null,
      currentLinesByGameMarket,
      openLinesByGameMarket
    );
    if (dto) dtos.push(dto);
  }

  // R-19 Phase 1 — last_slate_update_at = max(games.updated_at) across
  // the displayed slate. Null when no rows carry an updated_at.
  let lastSlateUpdateAt: string | null = null;
  for (const g of games) {
    if (g.updated_at === null || g.updated_at === undefined) continue;
    if (lastSlateUpdateAt === null || g.updated_at > lastSlateUpdateAt) {
      lastSlateUpdateAt = g.updated_at;
    }
  }

  const body: DailyEdgeResponse = {
    as_of: new Date().toISOString(),
    sport,
    date: effectiveDate,
    requested_date: requestedDate,
    fallback_used: effectiveDate !== requestedDate,
    slateState: slateResult.slateState,
    slate_status: slateResult.slate_status,
    last_slate_update_at: lastSlateUpdateAt,
    games: dtos,
  };
  return Response.json(body, {
    headers: {
      // Short edge cache keeps stampedes off Supabase; clients also poll.
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
    },
  });
}
