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
import type {
  DailyEdgeResponse,
  DailyEdgeGameDto,
  DailyEdgePredictionDto,
  DailyEdgeTotalPredictionDto,
  MarketEdgeDto,
} from "../../../app/lab/lib/labTypes";
import type { Verdict } from "../verdictDerivation";
import type { SharpReadKey } from "../sharpReadSelector";

const SOCCER_MODEL_VERSION = "soccer_dixon_coles_v1";
const LOCK_WINDOW_MINUTES = 60;

type DbGame = {
  id: number;
  external_id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  game_date: string;
  slate_date: string;
  status: string | null;
};

type TeamRow = { id: number; abbreviation: string; display_name: string | null };

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

function gradeToVerdict(playGrade: string | null, held: boolean): { key: Verdict; label: string } {
  if (held) return { key: "no_play", label: "Held" };
  if (playGrade === "best_angle") return { key: "best_angle", label: "Best Angle" };
  if (playGrade === "lean") return { key: "lean", label: "Lean" };
  if (playGrade === "watchlist") return { key: "watchlist", label: "Watchlist" };
  if (playGrade === "caution") return { key: "caution", label: "Caution" };
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

function buildMarketEdgeDto(r: PredictionRecordSlim | null): MarketEdgeDto {
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
    };
  }
  return {
    pick: r.held ? null : r.pick,
    confidence: r.held || r.confidence === null ? null : r.confidence / 100,
    grade: null,
    signalType: null,
    marketSignal: null,
    sharpStatus: "caution",
    held: r.held,
    verdict: gradeToVerdict(r.play_grade, r.held),
    guidedGuide: "",
    guidedWatchOut: "",
    whyLine: "",
    riskLine: "",
    modelProb: r.model_probability,
    marketFairProb: r.market_probability,
    pinnacleEvPct: null,
    moneyPct: null,
    betsPct: null,
    publicSplits: [],
    priceAmerican: r.odds_american,
    lineOpenAmerican: null,
    modelTotal: null,
    marketTotal: null,
    line: r.line_value,
    keyStats: [],
  };
}

function buildDecisionLine(matchup: string, perMarket: Map<string, PredictionRecordSlim>): string {
  // If any market is unheld and graded, lead with that; otherwise honest hold copy.
  const playable = Array.from(perMarket.values()).find((r) => !r.held && r.play_grade !== null);
  if (playable !== undefined) {
    const label =
      playable.play_grade === "best_angle"
        ? "Best angle"
        : playable.play_grade === "lean"
          ? "Model lean"
          : "Watchlist";
    return `${label} tonight: ${matchup} ${marketDisplayName(playable.market)} ${playable.pick}.`;
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
      key: "no_signal",
      sentence:
        "Pre-tournament: model and market disagree by too much without in-tournament calibration evidence yet.",
    };
  }
  return {
    key: "no_signal",
    sentence: "No sharp-signal data available for FIFA World Cup fixtures at this stage.",
  };
}

function buildModelBreakdown(
  matchup: string,
  perMarket: Map<string, PredictionRecordSlim>,
): string | null {
  const mr = perMarket.get("match_result");
  const total = perMarket.get("total");
  const btts = perMarket.get("btts");
  if (mr === undefined && total === undefined && btts === undefined) return null;

  const fmtRow = (r: PredictionRecordSlim | undefined, label: string): string => {
    if (r === undefined) return "";
    const tag = r.held ? `Held (${r.hold_reason ?? "no reason"})` : (r.play_grade ?? "graded");
    const conf = r.confidence === null ? "" : ` conf=${r.confidence.toFixed(0)}%`;
    return `${label}: ${r.pick}${r.line_value !== null ? ` @ ${r.line_value}` : ""} — ${tag}${conf}.`;
  };

  const lines = [
    fmtRow(mr, "Match result"),
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
  // Prefer the fixture-level reason from any row's snapshot_json.
  for (const r of rows) {
    const snapJson = r.snapshot_json;
    if (snapJson !== null && typeof snapJson === "object") {
      const fixtureHold = (snapJson as { fixture_hold_reason?: unknown }).fixture_hold_reason;
      if (typeof fixtureHold === "string" && fixtureHold.length > 0) return fixtureHold;
    }
  }
  return rows[0].hold_reason ?? "all_markets_held";
}

function deriveLockState(lockedAt: string | null, gameDateIso: string): "open" | "locking" | "locked" {
  if (lockedAt !== null) return "locked";
  const now = Date.now();
  const tip = new Date(gameDateIso).getTime();
  if (tip <= now) return "locked";
  if (tip - now <= LOCK_WINDOW_MINUTES * 60 * 1000) return "locking";
  return "open";
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

  // 1. Load soccer games for the slate.
  const { data: gamesData, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date, slate_date, status")
    .eq("sport", "soccer")
    .eq("slate_date", requestedDate);
  if (gamesErr !== null) throw new Error(`load soccer games: ${gamesErr.message}`);
  const games = (gamesData as DbGame[] | null) ?? [];

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
    .select("id, abbreviation, display_name")
    .in("id", [...teamIds]);
  const teamById = new Map<number, TeamRow>(
    ((teamsData as TeamRow[] | null) ?? []).map((t) => [t.id, t]),
  );

  // 3. Load prediction_records for this slate.
  const { data: predsData } = await supabase
    .from("prediction_records")
    .select(
      "id, game_id, market, pick, side, line_value, odds_american, confidence, model_probability, " +
        "market_probability, edge, play_grade, best_angle, no_bet, no_bet_reason, held, hold_reason, " +
        "locked_at, snapshot_json",
    )
    .eq("sport", "soccer")
    .eq("model_version", SOCCER_MODEL_VERSION)
    .eq("slate_date", requestedDate);
  const allPreds = (predsData as PredictionRecordSlim[] | null) ?? [];

  // 4. Bucket predictions by game_id × market.
  const byGameMarket = new Map<number, Map<string, PredictionRecordSlim>>();
  for (const p of allPreds) {
    if (!byGameMarket.has(p.game_id)) byGameMarket.set(p.game_id, new Map());
    byGameMarket.get(p.game_id)!.set(p.market, p);
  }

  // 5. Build DTO per game.
  const dtos: DailyEdgeGameDto[] = games.map((g) => {
    const homeTeam = g.home_team_id !== null ? teamById.get(g.home_team_id) : undefined;
    const awayTeam = g.away_team_id !== null ? teamById.get(g.away_team_id) : undefined;
    const homeAbbr = homeTeam?.abbreviation ?? "?";
    const awayAbbr = awayTeam?.abbreviation ?? "?";
    const matchup = `${awayAbbr} @ ${homeAbbr}`;

    const perMarket = byGameMarket.get(g.id) ?? new Map<string, PredictionRecordSlim>();
    const rows = Array.from(perMarket.values());

    const mr = perMarket.get("match_result") ?? null;
    const total = perMarket.get("total") ?? null;
    const btts = perMarket.get("btts") ?? null;

    const lockedAt = pickFreshestLockedAt(rows);
    const { time: gameTime, minutes: gameStartMinutes } = et(g.game_date);
    const lockState = deriveLockState(lockedAt, g.game_date);
    const holdReason = deriveGameHoldReason(perMarket);
    const decisionLine = buildDecisionLine(matchup, perMarket);
    const sharpRead = buildSharpRead(perMarket);
    const modelBreakdown = buildModelBreakdown(matchup, perMarket);

    return {
      id: `soccer-${g.external_id}`,
      sport: "soccer",
      external_id: g.external_id,
      awayTeam: awayAbbr,
      awayTeamLogo: null,
      homeTeam: homeAbbr,
      homeTeamLogo: null,
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
        moneyline: buildMarketEdgeDto(mr),
        total: buildMarketEdgeDto(total),
        first_inning: buildMarketEdgeDto(btts),
      },
      decisionLine,
      projected: { away: 0, home: 0 },
      sharpSignals: [],
      status: {
        lineupConfirmed: null,
        linesLocked: false,
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
