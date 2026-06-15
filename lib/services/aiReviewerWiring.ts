/**
 * Phase 4.2.C.1.R-16 — wiring helpers for the AI reviewer.
 *
 * Bridges raw `mlbAutoModelV1` output → reviewer input → reviewed output
 * → reviewed `AutoModelOutput`. Pure where possible; the slate-context
 * fetch is the one I/O entry point (a single Supabase query for the
 * slate's lines, used to compute no-vig market probabilities).
 *
 * Integration order inside `generatePredictionsForSlate`:
 *   1. featureSnapshot per slate                 (existing)
 *   2. `fetchReviewerSlateContext` (this file)   (new — one DB query)
 *   3. Per game:
 *      a. runMlbAutoModelV1 → rawPrediction      (existing)
 *      b. AI sanity boundary stub                (existing)
 *      c. buildReviewerInput → reviewGamePrediction → applyReviewed
 *      d. enrichmentHook                         (existing)
 *      e. pickBreakdownGenerator                 (existing — now sees reviewed)
 *
 * Failure mode (logic_audit_passed === false):
 *   The wiring marks all three markets as held with an explicit hold
 *   reason "reviewer_logic_audit_failed". The prediction is still
 *   written (so operator visibility is preserved) but no actionable
 *   pick reaches the page. Grade/verdict layer sees null winners and
 *   produces no_play. The audit record carries the error list.
 *
 * Gating:
 *   The orchestrator calls `applyReviewer` only when
 *   `process.env.REVIEWER_V1_ENABLED === "true"`. When disabled, the
 *   wiring is a no-op — current behavior preserved. Default OFF for
 *   safety on first integration; flip ON in operator env once
 *   confidence in the wiring is established.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { americanToImplied } from "../utils/odds";
import type {
  AutoModelOutput,
  AutoModelSportSpecific,
  GameSnapshot,
  ModelStage,
} from "../automodel/types";
import {
  reviewGamePrediction,
  buildAuditRecord,
  type ReviewerInput,
  type ReviewedOutput,
  type ReviewV1AuditRecord,
  type Side,
  type OuSide,
} from "./aiReviewerV1";
import { isBlockedSportsbook } from "../config/blockedSportsbooks";

// ─── Slate context shape ─────────────────────────────────────────────

/**
 * Slate-scoped market context the reviewer needs. Built once per slate
 * via `fetchReviewerSlateContext`. Maps keyed on `games.external_id`
 * so the per-game lookup is O(1).
 */
export type ReviewerSlateContext = {
  /** No-vig ML probability per game keyed on game external_id. */
  noVigByExternalId: Map<
    number,
    {
      home_novig: number | null;
      away_novig: number | null;
      source_book: string | null;
    }
  >;
};

// #39 fix (2026-06-15): fliff + kalshi REMOVED — they are blocklisted
// platform-wide (corrupted/flipped lines) but were leaking into the AI
// reviewer's no-vig calculation, which can cap confidence / hold / adjust
// scores on production picks. The isBlockedSportsbook guard in the selection
// loop is defense-in-depth so any future blocked book inherits exclusion.
export const NO_VIG_BOOK_PRIORITY = [
  "pinnacle",
  "draftkings",
  "bet365 us",
  "bookmaker",
  "ballybet",
  "onexbet",
  "saba",
].filter((b) => !isBlockedSportsbook(b));

/**
 * One-time slate-level lines fetch for no-vig calculation. Single query.
 * Builds a per-game lookup keyed on `games.external_id`. Defensive: if
 * the slate has no lines, the returned map is empty and the reviewer
 * sees null no-vig probs (which it handles gracefully).
 */
export async function fetchReviewerSlateContext(
  supabase: SupabaseClient,
  sport: "mlb",
  slate_date: string
): Promise<ReviewerSlateContext> {
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id")
    .eq("sport", sport)
    .eq("slate_date", slate_date);
  const gameIds = ((games ?? []) as Array<{ id: number; external_id: number }>).map(
    (g) => g.id
  );
  const externalByGameId = new Map<number, number>();
  for (const g of (games ?? []) as Array<{ id: number; external_id: number }>) {
    externalByGameId.set(g.id, g.external_id);
  }

  const noVigByExternalId = new Map<number, {
    home_novig: number | null;
    away_novig: number | null;
    source_book: string | null;
  }>();
  if (gameIds.length === 0) return { noVigByExternalId };

  const { data: lines } = await supabase
    .from("lines")
    .select("game_id, sportsbook, market_type, side, odds_american, fetched_at")
    .in("game_id", gameIds)
    .eq("market_type", "moneyline");

  type LineRow = {
    game_id: number;
    sportsbook: string;
    market_type: string;
    side: string;
    odds_american: number;
    fetched_at: string;
  };
  const byGameBookSide = new Map<string, LineRow>();
  for (const l of (lines ?? []) as LineRow[]) {
    const key = `${l.game_id}|${l.sportsbook}|${l.side}`;
    const prior = byGameBookSide.get(key);
    if (!prior || new Date(l.fetched_at) > new Date(prior.fetched_at)) {
      byGameBookSide.set(key, l);
    }
  }

  for (const [gameId, externalId] of externalByGameId) {
    let chosen: { home: LineRow; away: LineRow; book: string } | null = null;
    for (const book of NO_VIG_BOOK_PRIORITY) {
      if (isBlockedSportsbook(book)) continue; // defense-in-depth — never source no-vig off a blocked book
      const h = byGameBookSide.get(`${gameId}|${book}|home`);
      const a = byGameBookSide.get(`${gameId}|${book}|away`);
      if (h && a) {
        chosen = { home: h, away: a, book };
        break;
      }
    }
    if (chosen === null) {
      noVigByExternalId.set(externalId, {
        home_novig: null,
        away_novig: null,
        source_book: null,
      });
      continue;
    }
    const hImp = americanToImplied(chosen.home.odds_american);
    const aImp = americanToImplied(chosen.away.odds_american);
    const sum = hImp + aImp;
    noVigByExternalId.set(externalId, {
      home_novig: hImp / sum,
      away_novig: aImp / sum,
      source_book: chosen.book,
    });
  }

  return { noVigByExternalId };
}

// ─── Reviewer input builder ───────────────────────────────────────────

const PUBLIC_SMOKE_TICKETS_THRESHOLD = 65;
const PUBLIC_SMOKE_FLAT_GAP_MAX = 8;

/**
 * Build the `ReviewerInput` for one game from the raw model output, the
 * GameSnapshot, and slate-level market context. Pure.
 */
export function buildReviewerInput(
  snap: GameSnapshot,
  rawPrediction: AutoModelOutput,
  stage: ModelStage,
  ctx: ReviewerSlateContext
): ReviewerInput {
  const af = rawPrediction.sport_specific.auto_factors as
    | (typeof rawPrediction.sport_specific.auto_factors & {
        ml_raw_confidence?: number | null;
        ou_raw_confidence?: number | null;
        nrfi_expected_runs?: number | null;
      });

  const novig = ctx.noVigByExternalId.get(snap.game_external_id);
  const pick = rawPrediction.predicted_ml_winner;
  const ml_novig_pick_prob =
    novig && pick === "home"
      ? novig.home_novig
      : novig && pick === "away"
        ? novig.away_novig
        : null;
  const ml_novig_opposite_prob =
    novig && pick === "home"
      ? novig.away_novig
      : novig && pick === "away"
        ? novig.home_novig
        : null;

  const sharp = snap.sharp;
  const pickIsHome = pick === "home";
  const homeBets = sharp?.public_betting_pct_home ?? null;
  const homeMoney = sharp?.public_money_pct_home ?? null;
  const pickBetsPct = pickIsHome
    ? homeBets
    : homeBets !== null
      ? 100 - homeBets
      : null;
  const pickMoneyPct = pickIsHome
    ? homeMoney
    : homeMoney !== null
      ? 100 - homeMoney
      : null;

  const public_smoke_aligned_with_pick =
    pickBetsPct !== null &&
    pickMoneyPct !== null &&
    pickBetsPct >= PUBLIC_SMOKE_TICKETS_THRESHOLD &&
    Math.abs(pickBetsPct - pickMoneyPct) <= PUBLIC_SMOKE_FLAT_GAP_MAX;

  const bullpen_fallback =
    snap.home_team.bullpen_era_proxy === null ||
    snap.away_team.bullpen_era_proxy === null;

  const nrfi_decision_kind =
    rawPrediction.sport_specific.nrfi_decision_kind ?? "held";

  return {
    game_external_id: snap.game_external_id,
    stage,
    raw: {
      predicted_home_score: rawPrediction.predicted_home_score,
      predicted_away_score: rawPrediction.predicted_away_score,
      predicted_total: rawPrediction.predicted_total,
      listed_total: snap.market.listed_total,
      predicted_ml_winner: pick as Side | null,
      ml_confidence: rawPrediction.ml_confidence,
      ml_raw_confidence: af.ml_raw_confidence ?? null,
      predicted_ou_side: rawPrediction.predicted_ou_side as OuSide | null,
      ou_confidence: rawPrediction.ou_confidence,
      ou_raw_confidence: af.ou_raw_confidence ?? null,
      predicted_nrfi: rawPrediction.predicted_nrfi,
      nrfi_decision_kind,
      nrfi_confidence: rawPrediction.nrfi_confidence,
      nrfi_expected_runs: af.nrfi_expected_runs ?? null,
    },
    starters: {
      // R-16 wiring: the reviewer treats `home_starter_id !== null` as
      // "starter present". For MLB-Stats-only players (post-Phase-H-0
      // convention), `player_external_id` can be null even when the
      // starter exists. Use a presence marker that resolves correctly
      // for both BDL-mapped and MLB-only players: prefer external_id
      // when present, fall back to a sentinel (1) when the starter
      // object itself exists, null only when truly absent or scratched.
      home_starter_id:
        snap.home_starter === null || snap.home_starter.is_scratched
          ? null
          : snap.home_starter.player_external_id ?? 1,
      home_starter_era: snap.home_starter?.season_era ?? null,
      home_starter_gs: snap.home_starter?.season_games_started ?? null,
      home_starter_ip: snap.home_starter?.season_innings_pitched ?? null,
      away_starter_id:
        snap.away_starter === null || snap.away_starter.is_scratched
          ? null
          : snap.away_starter.player_external_id ?? 1,
      away_starter_era: snap.away_starter?.season_era ?? null,
      away_starter_gs: snap.away_starter?.season_games_started ?? null,
      away_starter_ip: snap.away_starter?.season_innings_pitched ?? null,
    },
    bullpen: {
      home_bullpen_era_proxy: snap.home_team.bullpen_era_proxy,
      away_bullpen_era_proxy: snap.away_team.bullpen_era_proxy,
    },
    market: {
      ml_novig_pick_prob,
      ml_novig_opposite_prob,
      public_bets_pick_pct: pickBetsPct,
      public_money_pick_pct: pickMoneyPct,
      ml_plus_ev_side: (sharp?.ml_plus_ev_side ?? null) as Side | null,
      total_plus_ev_side: (sharp?.total_plus_ev_side ?? null) as OuSide | null,
      public_smoke_aligned_with_pick,
    },
    data_quality: {
      starter_confirmed: snap.data_quality.starter_confirmed,
      lineup_confirmed: snap.data_quality.lineup_confirmed,
      market_line_available: snap.market.listed_total !== null,
      bullpen_fallback,
    },
  };
}

// ─── Apply reviewer to a raw prediction ──────────────────────────────

/**
 * Compose a reviewed `AutoModelOutput` from the raw prediction + the
 * reviewer's output + the audit record.
 *
 * Behavior on logic_audit_passed === false: fail-closed. Forces all
 * three markets to held, sets a recognizable hold_reason, and writes
 * the audit record with the logic_audit_errors list. The prediction
 * row still writes so the operator sees the failure; nothing playable
 * reaches the page.
 */
export function composeReviewedPrediction(
  rawPrediction: AutoModelOutput,
  reviewerInput: ReviewerInput,
  reviewed: ReviewedOutput
): AutoModelOutput {
  const audit: ReviewV1AuditRecord = buildAuditRecord(reviewerInput, reviewed);

  if (!reviewed.logic_audit_passed) {
    // Fail-closed: hold all markets.
    const heldSportSpecific: AutoModelSportSpecific = {
      ...rawPrediction.sport_specific,
      held: true,
      hold_reason: "reviewer_logic_audit_failed",
      hold_picks: ["ml", "ou", "nrfi"],
      review_v1: audit,
    };
    return {
      ...rawPrediction,
      predicted_ml_winner: null,
      ml_confidence: null,
      predicted_ou_side: null,
      ou_confidence: null,
      predicted_nrfi: null,
      nrfi_confidence: null,
      sport_specific: heldSportSpecific,
    };
  }

  // Apply reviewed values; preserve everything else from raw.
  const reviewedSportSpecific: AutoModelSportSpecific = {
    ...rawPrediction.sport_specific,
    review_v1: audit,
  };
  return {
    ...rawPrediction,
    predicted_home_score: reviewed.predicted_home_score,
    predicted_away_score: reviewed.predicted_away_score,
    predicted_total: reviewed.predicted_total,
    predicted_ml_winner: reviewed.predicted_ml_winner,
    ml_confidence: reviewed.ml_confidence,
    predicted_ou_side: reviewed.predicted_ou_side,
    ou_confidence: reviewed.ou_confidence,
    // NRFI passthrough (V1 invariant — reviewer doesn't touch NRFI yet).
    predicted_nrfi: reviewed.predicted_nrfi,
    nrfi_confidence: reviewed.nrfi_confidence,
    sport_specific: reviewedSportSpecific,
  };
}

/**
 * One-shot wrapper: build input, review, compose output. Pure given the
 * slate context. Called from `generatePredictionsForSlate` inside the
 * per-game loop. Returns the original raw prediction unchanged when
 * `REVIEWER_V1_ENABLED !== "true"`, so flipping the env flag is the
 * only switch between current behavior and reviewed behavior.
 */
export function applyReviewerIfEnabled(
  snap: GameSnapshot,
  rawPrediction: AutoModelOutput,
  stage: ModelStage,
  ctx: ReviewerSlateContext
): AutoModelOutput {
  if (process.env.REVIEWER_V1_ENABLED !== "true") {
    return rawPrediction;
  }
  const input = buildReviewerInput(snap, rawPrediction, stage, ctx);
  const reviewed = reviewGamePrediction(input);
  return composeReviewedPrediction(rawPrediction, input, reviewed);
}
