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
import { flagEmoji } from "./_countryFlags";

/**
 * Translate a WC-3 model pick token (`home` / `away` / `draw` /
 * `home_or_away` / `home_or_draw` / `away_or_draw` / `yes` / `no` /
 * `over` / `under`) into a readable member-facing label for the named
 * market. Falls back to the raw token in title case if we can't resolve
 * the team names (defensive — the adapter always knows the teams when
 * it has prediction_records).
 */
function readablePickForSoccer(args: {
  rawPick: string | null;
  market: string;
  homeDisplay: string;
  awayDisplay: string;
}): string | null {
  const { rawPick, market, homeDisplay, awayDisplay } = args;
  if (rawPick === null) return null;
  const p = rawPick.toLowerCase();
  if (market === "match_result") {
    if (p === "home") return homeDisplay;
    if (p === "away") return awayDisplay;
    if (p === "draw") return "Draw";
  }
  if (market === "double_chance") {
    if (p === "home_or_away") return `${homeDisplay} or ${awayDisplay} (no draw)`;
    if (p === "home_or_draw") return `${homeDisplay} or Draw`;
    if (p === "away_or_draw") return `${awayDisplay} or Draw`;
  }
  if (market === "btts") {
    if (p === "yes") return "BTTS Yes";
    if (p === "no") return "BTTS No";
  }
  if (market === "total") {
    if (p === "over") return "Over";
    if (p === "under") return "Under";
  }
  // Fallback: title-case the raw token so we never leak `home_or_draw` style.
  return rawPick
    .split("_")
    .map((w) => (w.length === 0 ? "" : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

const SOCCER_MODEL_VERSION = "soccer_dixon_coles_v1";
const LOCK_WINDOW_MINUTES = 60;

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

function gradeToVerdict(playGrade: string | null, held: boolean): { key: Verdict; label: string } {
  if (held) return { key: "no_play", label: "Held" };
  if (playGrade === "best_angle") return { key: "best_angle", label: "Best Angle" };
  if (playGrade === "lean") return { key: "lean", label: "Lean" };
  if (playGrade === "watchlist") return { key: "watchlist", label: "Watchlist" };
  if (playGrade === "caution") return { key: "caution", label: "Caution" };
  return { key: "no_play", label: "No Play" };
}

function buildPredictionDto(
  r: PredictionRecordSlim | null,
  ctx?: { homeDisplay: string; awayDisplay: string },
): DailyEdgePredictionDto {
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
  const readable = ctx === undefined
    ? r.pick
    : readablePickForSoccer({
        rawPick: r.pick,
        market: r.market,
        homeDisplay: ctx.homeDisplay,
        awayDisplay: ctx.awayDisplay,
      });
  return {
    // Soccer surfaces the readable pick even when held so the Quick
    // Read headline reads "Held — South Korea" instead of "Held — —".
    // The verdict pill carries the "do not bet" framing; nulling the
    // pick at this layer just made the card look broken.
    pick: readable,
    confidence: r.confidence === null ? null : r.confidence / 100,
    sharpStatus: "caution",
    grade: null,
    signalType: null,
    marketSignal: null,
  };
}

function buildTotalPredictionDto(
  r: PredictionRecordSlim | null,
  ctx?: { homeDisplay: string; awayDisplay: string },
): DailyEdgeTotalPredictionDto {
  return {
    ...buildPredictionDto(r, ctx),
    line: r?.line_value ?? null,
  };
}

function buildMarketEdgeDto(
  r: PredictionRecordSlim | null,
  ctx?: { homeDisplay: string; awayDisplay: string },
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
  const showPick = !r.held || (r.pick !== null && r.pick !== "");
  const heldHelp = buildHeldHelpLine(r);
  // Convert internal pick tokens ("home", "away", "home_or_draw",
  // "yes", "no", "over", "under") into readable text using the actual
  // country / market names. Members never see raw `home_or_draw`.
  const readablePick = ctx === undefined
    ? r.pick
    : readablePickForSoccer({
        rawPick: r.pick,
        market: String(r.market ?? ""),
        homeDisplay: ctx.homeDisplay,
        awayDisplay: ctx.awayDisplay,
      });
  return {
    pick: showPick ? readablePick : null,
    confidence: r.confidence === null ? null : r.confidence / 100,
    grade: null,
    signalType: null,
    marketSignal: null,
    sharpStatus: "caution",
    held: r.held,
    verdict: gradeToVerdict(r.play_grade, r.held),
    guidedGuide: r.held && r.hold_reason !== null ? `Held: ${r.hold_reason}` : "",
    guidedWatchOut: r.held && r.no_bet_reason !== null ? `Reason code: ${r.no_bet_reason}` : "",
    whyLine: heldHelp,
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
    modelTrustPct,
    marketImpliedPct,
    modelMarketGapPct: gap,
    // Member-facing copy. Internal source ids ("bdl_fifa", "sharpapi")
    // belong in operator/debug logs, not the card.
    marketSource: "Prematch market reference",
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
 * Compose the single sentence shown under each held market on the card.
 * Honest about why the model is holding without leaking internal jargon.
 * Returns "" for unheld rows — the card already shows the verdict pill.
 */
function buildHeldHelpLine(r: PredictionRecordSlim): string {
  if (!r.held) return "";
  if (r.hold_reason !== null && r.hold_reason.length > 0) {
    return r.hold_reason;
  }
  return "Held pre-tournament; waiting on in-tournament calibration evidence before publishing a play.";
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
  ctx?: { homeDisplay: string; awayDisplay: string },
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
    const readable = ctx === undefined
      ? r.pick
      : readablePickForSoccer({
          rawPick: r.pick,
          market: r.market,
          homeDisplay: ctx.homeDisplay,
          awayDisplay: ctx.awayDisplay,
        });
    return `${label}: ${readable}${r.line_value !== null ? ` @ ${r.line_value}` : ""} — ${tag}${conf}.`;
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
    .eq("slate_date", requestedDate);
  const rawPreds = (predsData as PredictionRecordSlim[] | null) ?? [];

  // Competition filter — World Cup only. Rows without a competition
  // field stamped in snapshot_json fall through to the WC bucket too
  // (legacy rows from before the discriminator was wired). Once UCL
  // launches, those legacy rows must be backfilled, but for tonight
  // it preserves the existing in-DB rows that don't yet carry the
  // stamp.
  const allPreds = rawPreds.filter((p) => {
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

  // Hide kicked-off fixtures from the slate. The WC charter does not
  // distinguish between "missed pre-kickoff" and "currently live" for
  // launch purposes — either way, surfacing a started fixture as a
  // selectable Daily Edge card is misleading (the model already locked
  // its read, or never locked because it wasn't seeded in time). The
  // underlying prediction_records stay in the DB so post-match grading
  // still works; we just don't render them. Sorted by kickoff ascending
  // so the next-upcoming fixture is the natural hero.
  const nowMs = Date.now();
  const wcGames = wcGamesWithPreds
    .filter((g) => {
      const startedStatus =
        g.status !== null && g.status !== "scheduled" && g.status !== "pre_match";
      const kickedOff = new Date(g.game_date).getTime() <= nowMs;
      return !(startedStatus || kickedOff);
    })
    .sort((a, b) => new Date(a.game_date).getTime() - new Date(b.game_date).getTime());

  // 5. Build DTO per game.
  const dtos: DailyEdgeGameDto[] = wcGames.map((g) => {
    const homeTeam = g.home_team_id !== null ? teamById.get(g.home_team_id) : undefined;
    const awayTeam = g.away_team_id !== null ? teamById.get(g.away_team_id) : undefined;
    const homeAbbr = homeTeam?.abbreviation ?? "?";
    const awayAbbr = awayTeam?.abbreviation ?? "?";
    // Country flag emoji prefix — reliable, no asset fetch, no broken
    // images. flagcdn.com URLs were not in next.config.ts allow-list so
    // every WC card was rendering broken image icons. Emoji renders
    // everywhere we render text and survives the SSR pipeline.
    const homeFlag = flagEmoji(homeTeam?.location);
    const awayFlag = flagEmoji(awayTeam?.location);
    // Full country names from teams.display_name when available — these
    // drive the readable pick labels ("South Korea" instead of "home")
    // and the matchup line. Fall back to abbreviation to stay safe.
    const homeName = homeTeam?.display_name ?? homeAbbr;
    const awayName = awayTeam?.display_name ?? awayAbbr;
    // Render the team chip as "🇰🇷 KOR" — emoji first so the card has
    // an immediate visual id, abbreviation behind it for tabular layouts.
    const homeChip = homeFlag.length > 0 ? `${homeFlag} ${homeAbbr}` : homeAbbr;
    const awayChip = awayFlag.length > 0 ? `${awayFlag} ${awayAbbr}` : awayAbbr;
    const matchup = `${awayName} vs ${homeName}`;

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
    const modelBreakdown = buildModelBreakdown(matchup, perMarket, {
      homeDisplay: homeName,
      awayDisplay: awayName,
    });

    // Expected goals (Dixon-Coles λ) come from the WC-3 snapshot. Same
    // model output is stamped on every market's snapshot for the game,
    // so we read whichever market we have. These drive the per-card
    // "Projection" display so it no longer reads 0–0.
    const lambdas = extractFixtureLambdas(rows);

    const labelCtx = { homeDisplay: homeName, awayDisplay: awayName };

    return {
      id: `soccer-${g.external_id}`,
      sport: "soccer",
      external_id: g.external_id,
      // Emoji-prefixed abbreviation gives every render context a flag.
      awayTeam: awayChip,
      // Null logo — UI falls back cleanly to the abbreviation text.
      // flagcdn.com URLs were 404-ing through Next/Image on prod.
      awayTeamLogo: null,
      homeTeam: homeChip,
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
        ml: buildPredictionDto(mr, labelCtx),
        total: buildTotalPredictionDto(total, labelCtx),
        nrfi: buildPredictionDto(btts, labelCtx),
      },
      markets: {
        moneyline: buildMarketEdgeDto(mr, labelCtx),
        total: buildMarketEdgeDto(total, labelCtx),
        first_inning: buildMarketEdgeDto(btts, labelCtx),
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
