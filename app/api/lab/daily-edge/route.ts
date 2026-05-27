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
import type { Side } from "@/lib/types/domain/Lines";
import type { Sport } from "@/lib/types/domain/Sport";
import type {
  Grade,
  MarketSignal,
  SignalType,
} from "@/lib/types/domain/Grade";
import { currentSlateDate, isSlateDate } from "@/lib/dates/slateDate";
import type {
  DailyEdgeGameDto,
  DailyEdgeResponse,
  SharpSignalCategory,
  SharpSignalDto,
  SharpStatus,
} from "@/app/lab/lib/labTypes";

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
 * Resolve the slate_date to query. If `requested` has visible games for this
 * sport, use it. Otherwise return the most recent visible slate_date for the
 * sport — so the page never goes blank when a member loads it during the
 * morning before tonight's slate is up, or on an off-day.
 *
 * Visibility is gated by VISIBLE_SLATE_STATUSES — draft / hidden slates are
 * invisible to the resolver too, so a draft slate doesn't trigger a stale
 * fallback to an older published one. If only drafts exist, fallback finds
 * the latest published slate from history.
 */
async function resolveSlateDate(sport: Sport, requested: string): Promise<string> {
  const { data: probe } = await supabase
    .from("games")
    .select("slate_date")
    .eq("sport", sport)
    .eq("slate_date", requested)
    .in("slate_status", [...VISIBLE_SLATE_STATUSES])
    .limit(1);
  if ((probe ?? []).length > 0) return requested;

  // Fallback: most recent visible slate_date for the sport.
  const { data: latest } = await supabase
    .from("games")
    .select("slate_date")
    .eq("sport", sport)
    .in("slate_status", [...VISIBLE_SLATE_STATUSES])
    .order("slate_date", { ascending: false })
    .limit(1);
  const fallback = (latest ?? [])[0]?.slate_date;
  return fallback ?? requested;
}

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
};

type GameRow = {
  id: number;
  external_id: number;
  sport: string;
  game_date: string;
  // To-one FK expansions: Supabase typegen renders these as arrays but the
  // runtime returns a single object. game_predictions has UNIQUE(game_id)
  // and team FKs are to-one. Cast as single-object | null.
  home_team: { abbreviation: string; logo_url: string | null } | null;
  away_team: { abbreviation: string; logo_url: string | null } | null;
  game_predictions: PredictionRow | null;
};

function buildGameDto(
  row: GameRow,
  signals: SignalRow[],
  sportsbookTotalLine: number | null
): DailyEdgeGameDto | null {
  const home = row.home_team?.abbreviation ?? "—";
  const away = row.away_team?.abbreviation ?? "—";
  const homeLogo = row.home_team?.logo_url ?? null;
  const awayLogo = row.away_team?.logo_url ?? null;
  const pred = row.game_predictions;
  if (!pred) return null; // Skip games without a model prediction.

  // ── ML ──
  const mlWinnerKey = pred.predicted_ml_winner ?? "home";
  const mlPick = mlWinnerKey === "home" ? home : away;
  // Fix 4.1 (Flag D1): sharpStatus derives from the per-pick grade, not
  // from legacy signal_strength. See deriveSharpStatus() comment.
  const mlStatus = deriveSharpStatus(pred.ml_grade);

  // ── Total ──
  // 5F.1: display the SPORTSBOOK total line for betting, not the model
  // projection. The model projection lives in `projected` (hero stat); the
  // O/U pick box shows what members would actually bet on. Fall back to
  // the model projection only when no lines.total row exists.
  const ouSide = pred.predicted_ou_side ?? "under";
  const totalLine = sportsbookTotalLine ?? pred.predicted_total ?? 0;
  const totalStatus = deriveSharpStatus(pred.ou_grade);
  const totalPick = ouSide === "over" ? "Over" : "Under";

  // ── NRFI ──
  const isNrfi = pred.predicted_nrfi ?? true;
  const nrfiSide = isNrfi ? "under" : "over"; // sharp_signals.side for first_inning_total
  const nrfiStatus = deriveSharpStatus(pred.nrfi_grade);
  const nrfiPick = isNrfi ? "NRFI" : "YRFI";

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
    predictions: {
      ml: {
        pick: mlPick,
        confidence: Math.max(0, Math.min(1, (pred.ml_confidence ?? 0) / 100)),
        sharpStatus: mlStatus,
        // V13 per-pick triplet for ML — sourced from ml_* DB columns.
        grade: pred.ml_grade,
        signalType: pred.ml_signal_type,
        marketSignal: pred.ml_market_signal,
      },
      total: {
        pick: totalPick,
        confidence: Math.max(0, Math.min(1, (pred.ou_confidence ?? 0) / 100)),
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
        confidence: Math.max(0, Math.min(1, (pred.nrfi_confidence ?? 0) / 100)),
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
    // V2.1.1 (Phase 6.3.5e): legacy top-level grade / signalType /
    // marketSignal / primaryMarket dropped. Headline derivation lives in
    // perPickHeadline.ts (client-side) reading the per-pick fields below.
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Route handler
// ───────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sportParam = url.searchParams.get("sport");
  const dateParam = url.searchParams.get("date");

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
      games: [],
    };
    return Response.json(body, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  }

  // Resolve the slate_date actually used: prefer the requested date; if empty,
  // fall back to the most recent slate_date that has games for this sport.
  // The UI can detect the fallback by comparing response.date to the URL param.
  const effectiveDate = await resolveSlateDate(sport, requestedDate);

  // ─── Games + teams + predictions (one round-trip) ────────────────────────
  // VISIBLE_SLATE_STATUSES gates draft / hidden slates out of member view per
  // V2.1 Part 9. Both the resolver (above) and this query use the same filter
  // so the response is consistent across the date fallback path.
  const { data: gameData, error: gamesErr } = await supabase
    .from("games")
    .select(
      `id, external_id, sport, game_date, slate_date,
       home_team:home_team_id (abbreviation, logo_url),
       away_team:away_team_id (abbreviation, logo_url),
       game_predictions (
         source_type,
         predicted_home_score, predicted_away_score, predicted_total,
         predicted_ml_winner, ml_confidence,
         predicted_ou_side, ou_confidence,
         predicted_nrfi, nrfi_confidence,
         ml_grade, ml_signal_type, ml_market_signal,
         ou_grade, ou_signal_type, ou_market_signal,
         nrfi_grade, nrfi_signal_type, nrfi_market_signal
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

    // Pull totals lines for the slate's games.
    const { data: lineData, error: lineErr } = await supabase
      .from("lines")
      .select("game_id, sportsbook, line_value")
      .in("game_id", gameIds)
      .eq("market_type", "total");
    if (lineErr) {
      return Response.json({ error: lineErr.message }, { status: 500 });
    }
    // Group by game, then pick the preferred book per game.
    const grouped = new Map<number, Array<{ sportsbook: string; line_value: number | null }>>();
    for (const row of (lineData ?? []) as Array<{ game_id: number; sportsbook: string; line_value: number | null }>) {
      const arr = grouped.get(row.game_id) ?? [];
      arr.push({ sportsbook: row.sportsbook, line_value: row.line_value });
      grouped.set(row.game_id, arr);
    }
    const BOOK_PRIORITY = ["pinnacle", "draftkings", "fanduel", "betmgm", "caesars"];
    for (const [gameId, rows] of grouped.entries()) {
      let chosen: number | null = null;
      for (const book of BOOK_PRIORITY) {
        const hit = rows.find((r) => r.sportsbook === book && r.line_value !== null);
        if (hit) { chosen = hit.line_value!; break; }
      }
      if (chosen === null) {
        const any = rows.find((r) => r.line_value !== null);
        if (any) chosen = any.line_value!;
      }
      if (chosen !== null) totalLineByGame.set(gameId, chosen);
    }
  }

  // ─── Assemble DTOs ───────────────────────────────────────────────────────
  const dtos: DailyEdgeGameDto[] = [];
  for (const g of games) {
    const dto = buildGameDto(
      g,
      signalsByGame.get(g.id) ?? [],
      totalLineByGame.get(g.id) ?? null
    );
    if (dto) dtos.push(dto);
  }

  const body: DailyEdgeResponse = {
    as_of: new Date().toISOString(),
    sport,
    date: effectiveDate,
    requested_date: requestedDate,
    fallback_used: effectiveDate !== requestedDate,
    games: dtos,
  };
  return Response.json(body, {
    headers: {
      // Short edge cache keeps stampedes off Supabase; clients also poll.
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
    },
  });
}
