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
import type { Sport } from "@/lib/types/domain/Sport";
import type {
  DailyEdgeGameDto,
  DailyEdgeResponse,
  DailyEdgeVerdict,
  SharpSignalCategory,
  SharpSignalDto,
  SharpStatus,
} from "@/app/lab/lib/labTypes";

const VALID_SPORTS: Sport[] = ["mlb", "nba", "nfl", "cbb", "cfb", "nhl", "ucl"];
const LIVE_SPORTS: Sport[] = ["mlb"];

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

// ───────────────────────────────────────────────────────────────────────────
// Slate-date window
// ───────────────────────────────────────────────────────────────────────────

function slateWindow(date: string): { startIso: string; endIso: string } {
  const startIso = `${date}T00:00:00.000Z`;
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(6, 0, 0, 0);
  return { startIso, endIso: next.toISOString() };
}

function todayUTC(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// ───────────────────────────────────────────────────────────────────────────
// Sharp signal mapping
// ───────────────────────────────────────────────────────────────────────────

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
  signal_strength: string | null;
  signal_summary: string | null;
  computed_at: string | null;
};

const MARKET_LABEL: Record<string, SharpSignalDto["market"]> = {
  moneyline: "ML",
  total: "OU",
  first_inning_total: "NRFI",
};

function deriveSharpStatus(
  signal: SignalRow | undefined,
  predictedSide: string
): SharpStatus {
  if (!signal) return "mixed";
  const strength = (signal.signal_strength ?? "").toLowerCase();
  const sameSide = signal.side === predictedSide;

  if (sameSide && strength === "strong") return "confirm";
  if (sameSide && strength === "caution") return "caution";
  if (!sameSide && strength === "strong") return "caution"; // sharps strong on opposite side
  return "mixed";
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
  if (s.signal_strength === "caution") return "pinnacle_disagree";
  return "no_signal";
}

function buildSignalDtos(rows: SignalRow[]): SharpSignalDto[] {
  return rows
    .map((s): SharpSignalDto | null => {
      const market = MARKET_LABEL[s.market_type];
      if (!market) return null;
      const strength = (s.signal_strength ?? "").toLowerCase();
      const direction: SharpSignalDto["direction"] =
        strength === "strong"
          ? "positive"
          : strength === "caution"
          ? "negative"
          : "neutral";
      const category = categorizeSignal(s);
      return {
        market,
        category,
        description: s.signal_summary ?? "",
        source: s.is_plus_ev ? "PINNACLE" : "MARKET",
        timestamp: relativeTimeAgo(s.steam_detected_at ?? s.computed_at),
        direction,
      };
    })
    .filter((x): x is SharpSignalDto => x !== null);
}

// ───────────────────────────────────────────────────────────────────────────
// Verdict aggregation (server-side per Decision G)
// ───────────────────────────────────────────────────────────────────────────

function computeVerdict(
  mlStatus: SharpStatus,
  totalStatus: SharpStatus,
  nrfiStatus: SharpStatus
): DailyEdgeVerdict {
  const statuses = [mlStatus, totalStatus, nrfiStatus];
  const confirms = statuses.filter((s) => s === "confirm").length;
  const cautions = statuses.filter((s) => s === "caution").length;
  if (confirms === 3) return "triple_lock";
  if (confirms === 2) return "strong";
  if (confirms === 1 && cautions === 0) return "lean";
  return "caution";
}

function composeVerdictSubtitle(
  verdict: DailyEdgeVerdict,
  mlPick: string,
  mlStatus: SharpStatus,
  totalStatus: SharpStatus,
  nrfiStatus: SharpStatus
): string {
  const confirmed: string[] = [];
  if (mlStatus === "confirm") confirmed.push("ML");
  if (totalStatus === "confirm") confirmed.push("Total");
  if (nrfiStatus === "confirm") confirmed.push("NRFI");

  if (verdict === "triple_lock") {
    return `All three confirm · ${mlPick} ML lead`;
  }
  if (verdict === "strong") {
    return `${confirmed.join(" + ")} · sharps confirm`;
  }
  if (verdict === "lean") {
    return `${confirmed[0]} only · proceed with care`;
  }
  return "Mixed signals · proceed with caution";
}

// ───────────────────────────────────────────────────────────────────────────
// Row → DTO
// ───────────────────────────────────────────────────────────────────────────

type PredictionRow = {
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_total: number | null;
  predicted_ml_winner: string | null;
  ml_confidence: number | null;
  predicted_ou_side: string | null;
  ou_confidence: number | null;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
};

type GameRow = {
  id: number;
  external_id: number;
  sport: string;
  game_date: string;
  // To-one FK expansions: Supabase typegen renders these as arrays but the
  // runtime returns a single object. game_predictions has UNIQUE(game_id)
  // and team FKs are to-one. Cast as single-object | null.
  home_team: { abbreviation: string } | null;
  away_team: { abbreviation: string } | null;
  game_predictions: PredictionRow | null;
};

function buildGameDto(
  row: GameRow,
  signals: SignalRow[]
): DailyEdgeGameDto | null {
  const home = row.home_team?.abbreviation ?? "—";
  const away = row.away_team?.abbreviation ?? "—";
  const pred = row.game_predictions;
  if (!pred) return null; // Skip games without a model prediction.

  // ── ML ──
  const mlWinnerKey = pred.predicted_ml_winner ?? "home";
  const mlPick = mlWinnerKey === "home" ? home : away;
  const mlSignal = signals.find((s) => s.market_type === "moneyline");
  const mlStatus = deriveSharpStatus(mlSignal, mlWinnerKey);

  // ── Total ──
  const ouSide = pred.predicted_ou_side ?? "under";
  const totalLine = pred.predicted_total ?? 0;
  const totalSignal = signals.find((s) => s.market_type === "total");
  const totalStatus = deriveSharpStatus(totalSignal, ouSide);
  const totalPick = ouSide === "over" ? "Over" : "Under";

  // ── NRFI ──
  const isNrfi = pred.predicted_nrfi ?? true;
  const nrfiSide = isNrfi ? "under" : "over"; // sharp_signals.side for first_inning_total
  const nrfiSignal = signals.find((s) => s.market_type === "first_inning_total");
  const nrfiStatus = deriveSharpStatus(nrfiSignal, nrfiSide);
  const nrfiPick = isNrfi ? "NRFI" : "YRFI";

  const verdict = computeVerdict(mlStatus, totalStatus, nrfiStatus);
  const subtitle = composeVerdictSubtitle(
    verdict,
    mlPick,
    mlStatus,
    totalStatus,
    nrfiStatus
  );

  return {
    id: `${row.sport}-${row.external_id}`,
    sport: row.sport as Sport,
    external_id: row.external_id,
    awayTeam: away,
    homeTeam: home,
    gameTime: formatTimeET(row.game_date),
    gameStartMinutes: minutesFromMidnightET(row.game_date),
    predictions: {
      ml: {
        pick: mlPick,
        confidence: Math.max(0, Math.min(1, (pred.ml_confidence ?? 0) / 100)),
        sharpStatus: mlStatus,
      },
      total: {
        pick: totalPick,
        confidence: Math.max(0, Math.min(1, (pred.ou_confidence ?? 0) / 100)),
        sharpStatus: totalStatus,
        line: totalLine,
      },
      nrfi: {
        pick: nrfiPick,
        confidence: Math.max(0, Math.min(1, (pred.nrfi_confidence ?? 0) / 100)),
        sharpStatus: nrfiStatus,
      },
    },
    projected: {
      away: pred.predicted_away_score ?? 0,
      home: pred.predicted_home_score ?? 0,
    },
    sharpSignals: buildSignalDtos(signals),
    verdict,
    verdictSubtitle: subtitle,
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

  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ? dateParam
    : todayUTC();

  // Non-live sports return empty — UI's ComingSoonState handles the message.
  if (!LIVE_SPORTS.includes(sport)) {
    const body: DailyEdgeResponse = {
      as_of: new Date().toISOString(),
      sport,
      date,
      games: [],
    };
    return Response.json(body, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  }

  const { startIso, endIso } = slateWindow(date);

  // ─── Games + teams + predictions (one round-trip) ────────────────────────
  const { data: gameData, error: gamesErr } = await supabase
    .from("games")
    .select(
      `id, external_id, sport, game_date,
       home_team:home_team_id (abbreviation),
       away_team:away_team_id (abbreviation),
       game_predictions (
         predicted_home_score, predicted_away_score, predicted_total,
         predicted_ml_winner, ml_confidence,
         predicted_ou_side, ou_confidence,
         predicted_nrfi, nrfi_confidence
       )`
    )
    .eq("sport", sport)
    .gte("game_date", startIso)
    .lt("game_date", endIso)
    .order("game_date", { ascending: true });

  if (gamesErr) {
    return Response.json({ error: gamesErr.message }, { status: 500 });
  }

  // Supabase typegen renders FK expansions as arrays; runtime returns the
  // single object for to-one relations. Cast accordingly.
  const games = (gameData ?? []) as unknown as GameRow[];

  // ─── Sharp signals for these games (batched) ─────────────────────────────
  const gameIds = games.map((g) => g.id);
  let signalsByGame = new Map<number, SignalRow[]>();
  if (gameIds.length > 0) {
    const { data: signalData, error: sigErr } = await supabase
      .from("sharp_signals")
      .select(
        "game_id, market_type, side, pinnacle_fair_probability, is_plus_ev, ev_pct, has_steam_move, steam_detected_at, steam_books_count, has_reverse_line_movement, rlm_direction, public_betting_pct, public_money_pct, signal_strength, signal_summary, computed_at"
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
  }

  // ─── Assemble DTOs ───────────────────────────────────────────────────────
  const dtos: DailyEdgeGameDto[] = [];
  for (const g of games) {
    const dto = buildGameDto(g, signalsByGame.get(g.id) ?? []);
    if (dto) dtos.push(dto);
  }

  const body: DailyEdgeResponse = {
    as_of: new Date().toISOString(),
    sport,
    date,
    games: dtos,
  };
  return Response.json(body, {
    headers: {
      // Short edge cache keeps stampedes off Supabase; clients also poll.
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
    },
  });
}
