/**
 * Phase 7H — NBA prediction_records writer.
 *
 * Reads the same NBA pipeline that powers the member-facing Daily
 * Edge (so tracked picks match what users saw) and writes one
 * `prediction_records` row per non-held market.
 *
 * Scope (V1):
 *   • Markets: `moneyline` and `total` ONLY.
 *   • Spread (the NBA pipeline's `intel.spread`) is intentionally NOT
 *     written. The adapter exposes it through the `first_inning` slot
 *     for UI compatibility, but tracking uses real-market semantics
 *     and we're skipping spread tracking until calibration data
 *     justifies it.
 *   • No NRFI / YRFI / FI — those are MLB-only concepts.
 *
 * Idempotency:
 *   • Upsert on (game_id, market, model_version, slate_date) — the
 *     same v17 unique key MLB uses. Re-running on the same slate is
 *     a no-op for already-existing rows.
 *   • Locked-row preservation: once a row has `locked_at IS NOT NULL`,
 *     subsequent passes SKIP it. The lock captures the snapshot
 *     members saw at T-60 / tip-off; we never re-mutate it after lock.
 *
 * Lock timing (V1 approximation):
 *   • Set `locked_at = now()` when tip is within `LOCK_MINUTES_BEFORE_TIP`
 *     of now, or already past. With the existing tracking-refresh cron
 *     cadence (every 2hr) and NBA's 7-8pm tip-offs, this gives
 *     "locked within 2hr of tip", which is operationally close enough
 *     to MLB's T-60 dedicated lock cron for V1. A proper NBA pregame
 *     sweep at ~5min cadence is a Phase 2 enhancement; the bones for
 *     it (lock-aware upsert + locked_at column) are in place today.
 *
 * Sport-safety:
 *   • Never queries / writes MLB rows.
 *   • Writes `sport='nba'` only.
 *   • Stores semantically correct market names (`moneyline`, `total`) —
 *     never `first_inning` for NBA spread.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildNbaDailyEdgePipeline } from "./buildNbaDailyEdgeAdapted";
import type { NbaDailyEdgeDto } from "./buildNbaDailyEdgeDto";
import type {
  MarketIntelligence,
} from "./buildNbaDailyEdgeDto";
import type { PredictionRecordRow, TrackedMarketV17 } from "../../types/domain/Tracking";
import type { RecommendationGrade } from "./nbaMarketReview";

/** Within this many minutes of tip-off, the lock seals the snapshot. */
const LOCK_MINUTES_BEFORE_TIP = 60;

/** Model version tag — must be stable across passes for the unique key
 * to dedupe properly. v0 is the active NBA model (nbaAutoModelV1). */
const NBA_MODEL_VERSION = "nba_v0_2026";

export type CreateNbaRecordsOptions = {
  slateDate: string;
  /** When false → dry-run; no DB writes. */
  apply: boolean;
  /** Used to tag launch-day records the admin UI may want to exclude. */
  launchDay: boolean;
  supabase: SupabaseClient;
};

export type ProposedNbaRecord = {
  game_id: number;
  external_id: number;
  matchup: string;
  market: "moneyline" | "total";
  pick: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  confidence: number;
  model_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  play_grade: string;
  best_angle: boolean;
  game_date: string | null;
  locked_at: string | null;
  reason_if_skipped?: string;
  /** True when the row would be a fresh insert; false when already exists. */
  wouldInsert: boolean;
};

export type CreateNbaRecordsResult = {
  slateDate: string;
  apply: boolean;
  scanned: number;
  proposed: ProposedNbaRecord[];
  insertedCount: number;
  skippedExisting: number;
  skippedHeld: number;
  skippedLocked: number;
  errors: Array<{ game_id: number | null; market: string; reason: string }>;
};

// Translate NBA recommendation grade into the v17 prediction_records
// public play_grade taxonomy. Falls back to "lean" — the safest neutral
// when the source grade doesn't map cleanly.
function gradeToPlayGrade(g: RecommendationGrade): string {
  switch (g) {
    case "best_angle": return "best_angle";
    case "lean":       return "lean";
    case "watch":      return "market_aligned";
    case "caution":    return "market_aligned";
    case "no_market":  return "provisional";
    case "held":       return "provisional";
  }
}

// Public side token the grader expects: "home"|"away" for ML,
// "over"|"under" for totals. Matches gradePrediction()'s switch.
function normalizeSide(rawPickSide: string | null): string | null {
  if (rawPickSide === null) return null;
  const v = rawPickSide.toLowerCase();
  if (v === "home" || v === "away" || v === "over" || v === "under") return v;
  return null;
}

function shouldBeLocked(tipIsoUtc: string | null, now: Date): boolean {
  if (tipIsoUtc === null) return false;
  const tipMs = new Date(tipIsoUtc).getTime();
  if (!Number.isFinite(tipMs)) return false;
  const lockBoundaryMs = tipMs - LOCK_MINUTES_BEFORE_TIP * 60 * 1000;
  return now.getTime() >= lockBoundaryMs;
}

function buildSnapshot(opts: {
  dto: NbaDailyEdgeDto;
  matchup: string;
  market: "moneyline" | "total";
  intel: MarketIntelligence;
  dataQualityTier: string | null;
  sources: {
    has_lines: boolean;
    has_splits: boolean;
    has_opportunities: boolean;
    limited_book_coverage: boolean;
    book_count: number;
  };
}): Record<string, unknown> {
  // Compact snapshot — enough context for post-grade audits but no
  // payload bloat. Mirrors MLB writer's namespaced shape so the
  // calibrationReport extractor can read NBA paths consistently.
  return {
    sport: "nba",
    model_version: NBA_MODEL_VERSION,
    as_of: opts.dto.as_of,
    matchup: opts.matchup,
    market: opts.market,
    pick_label: opts.intel.pick_label,
    rationale: opts.intel.rationale,
    public_splits: opts.intel.splits.pick_side !== null && opts.intel.splits.other_side !== null
      ? {
          picked_side: opts.intel.pick_side,
          picked_handle_pct: opts.intel.splits.pick_side.handle_pct,
          picked_bets_pct: opts.intel.splits.pick_side.bets_pct,
          opp_handle_pct: opts.intel.splits.other_side.handle_pct,
          opp_bets_pct: opts.intel.splits.other_side.bets_pct,
        }
      : null,
    line_movement: {
      current_price_american: opts.intel.current_price.odds_american,
      current_book: opts.intel.current_price.sportsbook,
    },
    data_integrity: {
      data_quality_tier: opts.dataQualityTier,
      limited_book_coverage: opts.sources.limited_book_coverage,
      book_count: opts.sources.book_count,
      has_lines: opts.sources.has_lines,
      has_splits: opts.sources.has_splits,
      has_opportunities: opts.sources.has_opportunities,
    },
  };
}

export async function createNbaPredictionRecords(
  opts: CreateNbaRecordsOptions,
): Promise<CreateNbaRecordsResult> {
  const result: CreateNbaRecordsResult = {
    slateDate: opts.slateDate,
    apply: opts.apply,
    scanned: 0,
    proposed: [],
    insertedCount: 0,
    skippedExisting: 0,
    skippedHeld: 0,
    skippedLocked: 0,
    errors: [],
  };

  // Run the same NBA pipeline that powers the member Daily Edge so
  // tracking matches what users saw. The pipeline is read-only.
  let pipelineResult: Awaited<ReturnType<typeof buildNbaDailyEdgePipeline>>;
  try {
    pipelineResult = await buildNbaDailyEdgePipeline(opts.slateDate);
  } catch (e) {
    result.errors.push({
      game_id: null,
      market: "pipeline",
      reason: `nba pipeline failed: ${e instanceof Error ? e.message : String(e)}`,
    });
    return result;
  }
  const { nbaDto, dbIdByExternalId } = pipelineResult;

  result.scanned = nbaDto.games.length;
  if (nbaDto.games.length === 0) return result;

  // Pull existing rows for this slate so we can dedupe + respect locks.
  const { data: existingRows, error: exErr } = await opts.supabase
    .from("prediction_records")
    .select("id, game_id, market, model_version, locked_at")
    .eq("sport", "nba")
    .eq("slate_date", opts.slateDate)
    .eq("model_version", NBA_MODEL_VERSION);
  if (exErr) {
    result.errors.push({
      game_id: null,
      market: "lookup",
      reason: `existing-records fetch failed: ${exErr.message}`,
    });
    return result;
  }
  const existingByKey = new Map<string, { id: number; locked_at: string | null }>();
  for (const r of (existingRows ?? []) as Array<{
    id: number;
    game_id: number;
    market: string;
    locked_at: string | null;
  }>) {
    existingByKey.set(`${r.game_id}::${r.market}`, { id: r.id, locked_at: r.locked_at });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const toInsert: PredictionRecordRow[] = [];

  for (const g of nbaDto.games) {
    const game_id = dbIdByExternalId.get(g.game_external_id);
    if (game_id === undefined) {
      result.errors.push({
        game_id: null,
        market: "game_lookup",
        reason: `external_id=${g.game_external_id} has no games.id row`,
      });
      continue;
    }
    const matchup = `${g.away_abbr}@${g.home_abbr}`;
    const lockNow = shouldBeLocked(g.tip_iso_utc, now);

    const perGameSources = g.intelligence.sources;
    const dataQualityTier = g.data_quality_tier ?? null;

    for (const market of ["moneyline", "total"] as const) {
      const intel = market === "moneyline" ? g.intelligence.ml : g.intelligence.total;
      if (intel.pick_side === null) {
        result.skippedHeld++;
        continue;
      }
      const sideToken = normalizeSide(intel.pick_side);
      if (sideToken === null) {
        result.errors.push({
          game_id,
          market,
          reason: `unrecognised pick_side="${intel.pick_side}"`,
        });
        continue;
      }
      const existing = existingByKey.get(`${game_id}::${market}`);
      if (existing !== undefined && existing.locked_at !== null) {
        result.skippedLocked++;
        result.proposed.push({
          game_id,
          external_id: g.game_external_id,
          matchup,
          market,
          pick: sideToken,
          side: sideToken,
          line_value: market === "total" ? intel.consensus_line : null,
          odds_american: intel.current_price.odds_american,
          confidence: intel.effective_confidence,
          model_probability: intel.model_prob_on_pick,
          market_probability: intel.market_no_vig_prob_pick,
          edge: intel.model_prob_on_pick !== null && intel.market_no_vig_prob_pick !== null
            ? intel.model_prob_on_pick - intel.market_no_vig_prob_pick
            : null,
          play_grade: gradeToPlayGrade(intel.grade),
          best_angle: intel.grade === "best_angle",
          game_date: g.tip_iso_utc,
          locked_at: existing.locked_at,
          reason_if_skipped: "row already locked — preserved",
          wouldInsert: false,
        });
        continue;
      }
      if (existing !== undefined) {
        // Row exists, not locked. Mark as "would update" — but our v1
        // policy is INSERT-only. Pre-lock updates are deferred until
        // we have a proven need for them (otherwise we'd churn
        // confidence/prob fields on every cron tick).
        result.skippedExisting++;
        result.proposed.push({
          game_id,
          external_id: g.game_external_id,
          matchup,
          market,
          pick: sideToken,
          side: sideToken,
          line_value: market === "total" ? intel.consensus_line : null,
          odds_american: intel.current_price.odds_american,
          confidence: intel.effective_confidence,
          model_probability: intel.model_prob_on_pick,
          market_probability: intel.market_no_vig_prob_pick,
          edge: intel.model_prob_on_pick !== null && intel.market_no_vig_prob_pick !== null
            ? intel.model_prob_on_pick - intel.market_no_vig_prob_pick
            : null,
          play_grade: gradeToPlayGrade(intel.grade),
          best_angle: intel.grade === "best_angle",
          game_date: g.tip_iso_utc,
          locked_at: lockNow ? nowIso : null,
          reason_if_skipped: lockNow
            ? "row exists; lock policy deferred to v1 (no pre-lock update)"
            : "row exists; insert-only on first pass",
          wouldInsert: false,
        });
        continue;
      }

      const row: PredictionRecordRow = {
        game_prediction_id: null,
        game_id,
        external_id: g.game_external_id,
        sport: "nba",
        slate_date: opts.slateDate,
        game_date: g.tip_iso_utc,
        matchup,
        market: market as TrackedMarketV17,
        pick: sideToken,
        side: sideToken,
        line_value: market === "total" ? intel.consensus_line : null,
        odds_american: intel.current_price.odds_american,
        odds_decimal: null,
        model_used: "nbaAutoModelV1",
        model_version: NBA_MODEL_VERSION,
        prediction_source: "nba_daily_edge",
        confidence: intel.effective_confidence,
        model_probability: intel.model_prob_on_pick,
        market_probability: intel.market_no_vig_prob_pick,
        edge: intel.model_prob_on_pick !== null && intel.market_no_vig_prob_pick !== null
          ? intel.model_prob_on_pick - intel.market_no_vig_prob_pick
          : null,
        expected_value: intel.opp_ev_percentage_pick !== null
          ? intel.opp_ev_percentage_pick / 100
          : null,
        play_grade: gradeToPlayGrade(intel.grade),
        prediction_type: market === "moneyline" ? "game_ml" : "game_total",
        best_angle: intel.grade === "best_angle",
        no_bet: false,
        no_bet_reason: null,
        market_aligned: intel.grade === "lean" || intel.grade === "best_angle",
        data_quality_tier: dataQualityTier,
        source_quality: perGameSources.has_lines ? "live_book" : null,
        provisional: false,
        held: false,
        hold_reason: null,
        launch_day: opts.launchDay,
        manual_outcome_expected: false,
        locked_at: lockNow ? nowIso : null,
        published_at: nbaDto.as_of,
        snapshot_json: buildSnapshot({
          dto: nbaDto,
          matchup,
          market,
          intel,
          dataQualityTier,
          sources: perGameSources,
        }),
      };
      toInsert.push(row);

      result.proposed.push({
        game_id,
        external_id: g.game_external_id,
        matchup,
        market,
        pick: sideToken,
        side: sideToken,
        line_value: row.line_value,
        odds_american: row.odds_american,
        confidence: row.confidence ?? 0,
        model_probability: row.model_probability,
        market_probability: row.market_probability,
        edge: row.edge,
        play_grade: row.play_grade ?? "lean",
        best_angle: row.best_angle,
        game_date: row.game_date,
        locked_at: row.locked_at,
        wouldInsert: true,
      });
    }
  }

  if (!opts.apply || toInsert.length === 0) {
    return result;
  }

  // Insert in one batch — small slate size (NBA Finals = 1 game; reg
  // season peaks ~15 games × 2 markets = 30 rows max). The unique
  // constraint catches concurrent races defensively.
  const { error: insErr, count } = await opts.supabase
    .from("prediction_records")
    .insert(toInsert, { count: "exact" });
  if (insErr) {
    result.errors.push({
      game_id: null,
      market: "insert",
      reason: insErr.message,
    });
    return result;
  }
  result.insertedCount = count ?? toInsert.length;
  return result;
}
