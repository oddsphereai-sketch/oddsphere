/**
 * Phase 4.2.C.1.R-19 Phase 4a — slate-safety gates G1 + G2 + G3.
 *
 * The R-18 / R-19 slate-history audit found three failure modes that
 * could let a degraded slate slip past unattended cron and reach
 * members:
 *
 *   G1 — unexpectedly small slate (BDL returned too few games)
 *   G2 — too many games missing probable starters after refresh
 *   G3 — slate ingested AFTER games already in progress (late-night
 *        ingest of a partially-played day)
 *
 * 2026-06-01 stuck-draft (G3 example): operator ran ingest at 8:57 PM
 * ET on June 1; 6 of 9 games were already STATUS_IN_PROGRESS; all
 * starter ids resolved as null; operator (correctly) didn't publish.
 *
 * 2026-06-03 hidden-after-publish (G2 example): operator published 15
 * games at 14:48; 45 minutes later hid the slate with reason "BDL
 * returned 0 probable starters; investiga…" — auto-publish would have
 * sent the bad slate to members.
 *
 * These three gates plug into the cron-safe orchestrator and:
 *
 *   • report a structured verdict on the AutomationRunReport
 *   • push to `blocking_reasons` on fail_closed (forces overall_status
 *     = "blocked")
 *   • cascade into `effective_write_mode = false` for downstream steps
 *     when an upstream gate fail_closes
 *   • make auto-publish IMPOSSIBLE when ANY gate fails — even if
 *     MORNING_SLATE_AUTO_PUBLISH=true and the orchestrator gate is
 *     enabled
 *
 * Pure module — no DB imports, no provider clients, no env reads. Each
 * helper takes the data it needs as inputs and returns a verdict.
 * Easy to unit-test in isolation and embed in the orchestrator without
 * a DB roundtrip.
 *
 * Operator path (`scripts/operator/automation/run-slate-cycle.ts`) is
 * INTENTIONALLY not coupled to these gates — operators can still
 * hand-run small/test/incomplete slates via the interactive CLI. The
 * gates only fire on the automation path.
 */

import type { Sport } from "../types/domain/Sport";

// ─── G1 — Minimum game count ─────────────────────────────────────────────

/**
 * MLB regular-season slate floor. The R-18 / R-19 audit observed:
 *   - Real MLB days: 9–15 games (2026-06-01 = 9; 2026-06-04 = 9; 2026-06-05 = 15)
 *   - Mock-fixture days: 5 games (all 23:10Z, fictitious IDs)
 *   - 2026-06-01 stuck-draft had 9 games (above floor) → G1 wouldn't
 *     have caught it, but G3 would have
 *
 * 8 is the conservative floor: catches the May 5-game fixture pattern
 * without flagging legitimate light Monday slates (~9 games minimum on
 * full schedule). Operators with legitimate small slates can override
 * by passing minGameCount explicitly.
 */
export const DEFAULT_MIN_MLB_GAMES = 8;

export interface MinimumGameCountInput {
  sport: Sport;
  bdlGameCount: number;
  /** Optional override — defaults to DEFAULT_MIN_MLB_GAMES for MLB. */
  minGameCount?: number;
}

export interface MinimumGameCountResult {
  status: "ok" | "fail_closed";
  threshold: number;
  observed: number;
  reason: string;
}

export function assessMinimumGameCount(
  opts: MinimumGameCountInput
): MinimumGameCountResult {
  const threshold =
    opts.minGameCount ??
    (opts.sport === "mlb" ? DEFAULT_MIN_MLB_GAMES : 1);
  const observed = opts.bdlGameCount;
  if (observed >= threshold) {
    return {
      status: "ok",
      threshold,
      observed,
      reason: `BDL returned ${observed} game(s); ≥ threshold ${threshold}`,
    };
  }
  return {
    status: "fail_closed",
    threshold,
    observed,
    reason:
      `BDL returned only ${observed} game(s) — below ${opts.sport.toUpperCase()} ` +
      `floor of ${threshold}. Slate likely incomplete or mock-fixture; ` +
      `blocking unattended writes and publish.`,
  };
}

// ─── G2 — Starter coverage ───────────────────────────────────────────────

/**
 * Starter-coverage thresholds. R-19 Phase 5g.4 introduced per-game
 * exclusion. Phase 6B.30C split the per-game list into two explicit
 * concepts to remove the ambiguity that previously merged "operator
 * visibility" with "M2 must not generate":
 *
 *   `starter_warning_external_ids` — every game with ≥1 missing
 *   starter. Visibility-only: surfaced to operator reports + admin
 *   display + the Data Completeness Audit so source gaps are
 *   auditable. NEVER fed to M2 as an exclusion filter.
 *
 *   `m2_excluded_external_ids` — the subset of warned games that M2
 *   should not generate a prediction for. Phase 6B.30C policy:
 *   - missing_both → excluded (V2.2 has no fallback for zero starter info)
 *   - missing_home / missing_away → NOT excluded (V2.2 emits real-data
 *     fallback predictions with data_quality_tier="fallback" and
 *     provisional=true for single-side-missing games)
 *   - status === "fail_closed" → all warned games excluded (catastrophic;
 *     g2Blocking also slate-wide blocks M2 separately at the orchestrator)
 *
 * Three tiers (unchanged from Phase 5g.4):
 *   1. coveragePct ≥ DEFAULT_MIN_STARTER_COVERAGE_PCT → status "ok"
 *      Warning list still populates for missing-starter games.
 *
 *   2. coveragePct below threshold but NOT catastrophic →
 *      status "partial_ok". Warning list populated; M2 still runs for
 *      complete games + single-side-missing games (real-data fallback).
 *
 *   3. Catastrophic (coveragePct < CATASTROPHIC_PCT OR
 *      gamesMissingBoth ≥ CATASTROPHIC_MISSING_BOTH) → status
 *      "fail_closed". Slate-wide block via g2Blocking. m2_excluded
 *      list = all warned games for defense-in-depth.
 *
 * Background: the 2026-06-03 incident — "BDL returned 0 probable
 * starters" — was a catastrophic case (0% coverage). The 2026-06-08
 * incident — SEA@BAL missing home probable (87.5%) silently dropping
 * from Daily Edge — was the Phase 6B.30C trigger. The previous Phase
 * 5g.4 design correctly flagged the game but incorrectly pre-excluded
 * it from M2; V2.2's per-feature fallback can safely produce a
 * provisional prediction with the away starter + real team/park/market
 * data and only neutralize the missing-side-specific fields.
 *
 * 90%-threshold means at most 1 of 9, or 1 of 10, or 2 of 15 games can
 * be starter-incomplete before status drops to "partial_ok". Catastrophic
 * threshold is 50% OR ≥ 3 games with BOTH sides missing.
 */
export const DEFAULT_MIN_STARTER_COVERAGE_PCT = 90;

/**
 * Below this coverage, the slate is considered catastrophically
 * incomplete and gets a slate-wide block. Distinct from the 90%
 * threshold above — between 50% and 90% is the per-game-exclusion
 * window where M2 still runs for complete games.
 */
export const DEFAULT_MIN_STARTER_COVERAGE_CATASTROPHIC_PCT = 50;

/**
 * If this many (or more) games on the slate have BOTH sides missing,
 * treat as catastrophic regardless of overall coverage %. Three games
 * with both pitchers missing is a strong signature of provider
 * serving wrong-day data or experiencing systemic outage — a per-game
 * exclusion under that condition would silently degrade the slate.
 */
export const DEFAULT_MAX_MISSING_BOTH_FOR_CATASTROPHIC = 3;

export interface StarterCoverageInput {
  sport: Sport;
  /**
   * Game rows from the games table for the slate. Each row must carry
   * `external_id` so the gate can build a per-game exclusion list and
   * a held-reasons map. When this array is empty (e.g. pure dry-run
   * before S1 has written anything), the gate returns
   * `status: "deferred"` — neither pass nor fail.
   */
  games: ReadonlyArray<{
    external_id: number;
    home_pitcher_id: number | null;
    away_pitcher_id: number | null;
  }>;
  /** Optional override — defaults to DEFAULT_MIN_STARTER_COVERAGE_PCT. */
  minCoveragePct?: number;
  /** Optional override — defaults to DEFAULT_MIN_STARTER_COVERAGE_CATASTROPHIC_PCT. */
  catastrophicMinPct?: number;
  /** Optional override — defaults to DEFAULT_MAX_MISSING_BOTH_FOR_CATASTROPHIC. */
  catastrophicMaxMissingBoth?: number;
}

/**
 * Per-game held reason — surfaced in the orchestrator report and in
 * `/admin/auto-predictions` so operators see "G2 starter missing —
 * no home probable" instead of "cause unknown."
 */
export type StarterHeldReason = "missing_home" | "missing_away" | "missing_both";

export interface StarterCoverageResult {
  status: "ok" | "partial_ok" | "warn" | "fail_closed" | "deferred";
  totalGames: number;
  gamesWithBothStarters: number;
  gamesMissingOne: number;
  gamesMissingBoth: number;
  coveragePct: number;
  threshold: number;
  catastrophicThreshold: number;
  catastrophicMissingBothThreshold: number;
  /**
   * Phase 6B.30C — visibility list. external_ids of every game with ≥1
   * missing starter. Populated whenever the gate sees missing starters
   * (ok, partial_ok, or fail_closed). Surfaced in operator reports,
   * admin display, and the Data Completeness Audit so source gaps are
   * auditable. NOT used by the orchestrator to filter M2's input — see
   * `m2_excluded_external_ids` for that.
   */
  starter_warning_external_ids: number[];
  /**
   * Phase 6B.30C — M2 exclusion list. Strict subset of
   * `starter_warning_external_ids`. Currently:
   *   - games where `held_reasons[id] === "missing_both"` (V2.2 has no
   *     fallback for zero starter info)
   *   - when status === "fail_closed", all warned games (defense in
   *     depth; the slate-wide g2Blocking also blocks M2 separately)
   *
   * Single-side-missing games (missing_home / missing_away) are
   * intentionally NOT here — V2.2 produces real-data fallback
   * (data_quality_tier="fallback", provisional=true, Best Angle gated)
   * for them. The orchestrator passes this list to M2 as
   * `excludeGameExternalIds`.
   */
  m2_excluded_external_ids: number[];
  /**
   * Map from external_id → which side(s) are missing. Same key set as
   * `starter_warning_external_ids`. Used by the admin display to
   * surface the specific reason ("missing home probable" vs
   * "missing both").
   */
  held_reasons: Record<number, StarterHeldReason>;
  reason: string;
}

export function assessStarterCoverage(
  opts: StarterCoverageInput
): StarterCoverageResult {
  const threshold = opts.minCoveragePct ?? DEFAULT_MIN_STARTER_COVERAGE_PCT;
  const catastrophicPct =
    opts.catastrophicMinPct ?? DEFAULT_MIN_STARTER_COVERAGE_CATASTROPHIC_PCT;
  const catastrophicMissingBoth =
    opts.catastrophicMaxMissingBoth ?? DEFAULT_MAX_MISSING_BOTH_FOR_CATASTROPHIC;
  const total = opts.games.length;
  if (total === 0) {
    return {
      status: "deferred",
      totalGames: 0,
      gamesWithBothStarters: 0,
      gamesMissingOne: 0,
      gamesMissingBoth: 0,
      coveragePct: 0,
      threshold,
      catastrophicThreshold: catastrophicPct,
      catastrophicMissingBothThreshold: catastrophicMissingBoth,
      starter_warning_external_ids: [],
      m2_excluded_external_ids: [],
      held_reasons: {},
      reason:
        "No games in DB for this slate yet — gate deferred until slate has been ingested",
    };
  }
  let both = 0;
  let missingOne = 0;
  let missingBoth = 0;
  const warningIds: number[] = [];
  const heldReasons: Record<number, StarterHeldReason> = {};
  for (const g of opts.games) {
    const h = g.home_pitcher_id !== null && g.home_pitcher_id !== undefined;
    const a = g.away_pitcher_id !== null && g.away_pitcher_id !== undefined;
    if (h && a) {
      both++;
      continue;
    }
    warningIds.push(g.external_id);
    if (!h && !a) {
      missingBoth++;
      heldReasons[g.external_id] = "missing_both";
    } else if (!h) {
      missingOne++;
      heldReasons[g.external_id] = "missing_home";
    } else {
      missingOne++;
      heldReasons[g.external_id] = "missing_away";
    }
  }
  warningIds.sort((a, b) => a - b);
  const m2ExcludedFromMissingBoth = warningIds
    .filter((id) => heldReasons[id] === "missing_both")
    .sort((a, b) => a - b);
  const coveragePct = Math.round((both / total) * 1000) / 10;
  const isCatastrophic =
    coveragePct < catastrophicPct || missingBoth >= catastrophicMissingBoth;
  const base = {
    totalGames: total,
    gamesWithBothStarters: both,
    gamesMissingOne: missingOne,
    gamesMissingBoth: missingBoth,
    coveragePct,
    threshold,
    catastrophicThreshold: catastrophicPct,
    catastrophicMissingBothThreshold: catastrophicMissingBoth,
    starter_warning_external_ids: warningIds,
    held_reasons: heldReasons,
  };
  if (isCatastrophic) {
    return {
      ...base,
      // Defense in depth: in fail_closed, exclude every warned game from
      // M2. The slate-wide g2Blocking cascade in the orchestrator also
      // blocks M2 entirely, so this list is informational, but keeping
      // it complete avoids any chance of half-processing a catastrophic
      // slate if the slate-wide block is ever bypassed.
      m2_excluded_external_ids: [...warningIds],
      status: "fail_closed",
      reason:
        `Catastrophic starter coverage: ${coveragePct}% (${both}/${total} games ` +
        `with both starters); ${missingBoth} game(s) missing BOTH. ` +
        `Catastrophic threshold = ${catastrophicPct}% coverage OR ` +
        `≥${catastrophicMissingBoth} games missing both. Likely wrong-day ` +
        `provider data or systemic outage; blocking slate-wide to prevent ` +
        `the 2026-06-03 failure pattern.`,
    };
  }
  if (coveragePct >= threshold) {
    return {
      ...base,
      m2_excluded_external_ids: m2ExcludedFromMissingBoth,
      status: "ok",
      reason:
        warningIds.length === 0
          ? `${both}/${total} game(s) have both starters (${coveragePct}% ≥ ${threshold}% threshold)`
          : `${both}/${total} game(s) have both starters (${coveragePct}% ≥ ${threshold}% threshold); ` +
            `${warningIds.length} game(s) flagged as starter warning (` +
            `${m2ExcludedFromMissingBoth.length} excluded from M2 for missing-both, ` +
            `${warningIds.length - m2ExcludedFromMissingBoth.length} allowed through ` +
            `for real-data fallback prediction)`,
    };
  }
  return {
    ...base,
    m2_excluded_external_ids: m2ExcludedFromMissingBoth,
    status: "partial_ok",
    reason:
      `Partial-OK starter coverage: ${coveragePct}% (${both}/${total} games ` +
      `with both starters) is below ${threshold}% threshold but above catastrophic ` +
      `${catastrophicPct}%. Starter warning: ${warningIds.length} game(s); ` +
      `M2 exclusion: ${m2ExcludedFromMissingBoth.length} game(s) (missing both). ` +
      `M2 writes predictions for the ${both} game(s) with full starter data + ` +
      `single-side-missing games via V2.2 real-data fallback.`,
  };
}

// ─── G3 — In-progress ingest ─────────────────────────────────────────────

/**
 * BDL game-status values that indicate the game has already started
 * (or is over). If ANY of these appear on a slate at the moment of
 * automated ingest, that's the 2026-06-01 pattern — operator ran
 * ingest at 8:57 PM ET; 6 of 9 games were already STATUS_IN_PROGRESS;
 * starter resolution failed silently because BDL /lineups doesn't
 * reliably serve mid-game probable-pitcher info.
 *
 * For unattended automation, ANY game already in progress means the
 * cron is firing too late in the day. Hard block.
 *
 * Note: STATUS_POSTPONED is NOT in this set — postponements are
 * legitimately handled downstream (they get ingested with status set,
 * but the rest of the slate is fine).
 */
export const IN_PROGRESS_BDL_STATUSES = new Set<string>([
  "STATUS_IN_PROGRESS",
  "STATUS_FINAL",
  "STATUS_END_OF_GAME",
]);

export interface InProgressGamesInput {
  sport: Sport;
  /**
   * Game rows from BDL provider. The gate reads `status` and the
   * external id (for the affected-games list in the report).
   */
  bdlGames: ReadonlyArray<{
    status?: string | null;
    external_id?: number | null;
  }>;
}

export interface InProgressGamesResult {
  status: "ok" | "fail_closed";
  totalGames: number;
  inProgressCount: number;
  affectedExternalIds: number[];
  reason: string;
}

export function assessInProgressGames(
  opts: InProgressGamesInput
): InProgressGamesResult {
  const total = opts.bdlGames.length;
  const affected: number[] = [];
  for (const g of opts.bdlGames) {
    const s = typeof g.status === "string" ? g.status : "";
    if (IN_PROGRESS_BDL_STATUSES.has(s)) {
      const ext = typeof g.external_id === "number" ? g.external_id : null;
      if (ext !== null) affected.push(ext);
    }
  }
  if (affected.length === 0) {
    return {
      status: "ok",
      totalGames: total,
      inProgressCount: 0,
      affectedExternalIds: [],
      reason: `No games already in progress (0/${total})`,
    };
  }
  affected.sort((a, b) => a - b);
  return {
    status: "fail_closed",
    totalGames: total,
    inProgressCount: affected.length,
    affectedExternalIds: affected,
    reason:
      `${affected.length}/${total} game(s) already in progress at ingest time. ` +
      `Cron firing too late — BDL probable-starter resolution unreliable for ` +
      `mid-game and final games. Blocking unattended writes and publish.`,
  };
}

// ─── Compound check ─────────────────────────────────────────────────────

/**
 * True iff any of the three gates is in `fail_closed` state. Useful
 * for the publish-gate step that must refuse auto-publish when any
 * safety gate failed.
 */
export function anyGateFailedClosed(
  g1: MinimumGameCountResult | null,
  g2: StarterCoverageResult | null,
  g3: InProgressGamesResult | null
): boolean {
  if (g1 !== null && g1.status === "fail_closed") return true;
  if (g2 !== null && g2.status === "fail_closed") return true;
  if (g3 !== null && g3.status === "fail_closed") return true;
  return false;
}
